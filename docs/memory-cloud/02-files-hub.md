# 02 · Files Hub 文件汇聚管道设计

> 状态：设计稿（原型级，未实现） · 分支 dev-memory-cloud · 2026-10-09
> 姊妹篇：[01-memory-system.md](./01-memory-system.md)（记忆系统）、[03-sync-conflict.md](./03-sync-conflict.md)（同步/冲突/缓存）

## 0. 一句话架构

**三个来源（网络学堂附件 / App 内下载 / IM bot 传入）的文件统一汇入云盘 `/Files/` 目录树；agent 按「LLM 建议分类重命名 → 两段式确认 → mkdir+upload 落盘 → 文本类生成 .md 摘要 sidecar → 写一条记忆 observation」五步走完入库；上传走 thufs 已验证的断点续传原语，落盘前查配额。**

## 1. 目标

- 用户说「把数据结构这周的课件存云盘」「把这个文件归档」时，OH 一次对话完成：取文件 → 分类 → 重命名 → 入库 → 摘要 → 记忆登记。
- 云盘里长出一棵**人和 agent 都能导航**的目录树（人按学期/课程找课件，agent 按 frontmatter 找摘要）。
- 三个来源共用同一条入库管线与同一套确认纪律，IM bot 通道只定义接口（网关本体另一条线在做）。

非目标：不做全盘去重（同名同大小跳过即可，不做内容级 dedup）；不做云盘内文件的批量搬家公司（用户自己整理的自由不被打扰）；不做 OCR（扫描版 PDF 摘要能力受限，如实报告）。

## 2. 三源与现有能力盘点（贴代码）

| 源 | 现有能力 | 代码位置 | 缺口 |
|---|---|---|---|
| ① 网络学堂课件/作业附件 | 列课程文件：OH 工具 `query_learn_files`（tools.rs:301，经 facade learn ns `files` → learn.getFileList）；**下载**：宿主 TS 层已有 `downloadLearnFile(fileId, filename)` / `downloadLearnUrl(url, filename)`（clients.ts:699/720，带会话 Cookie + `_csrf` 修补 + Content-Disposition 真名），落盘到 downloads.rs 管理的下载目录 | clients.ts / downloads.rs | facade 的 learn ns **未暴露 download 方法**给插件——需在 facade 增补一个 `learn.download(fileId, filename)`（门禁挂 `learn:read`，属宿主侧小改，不新增后端能力） |
| ② App 内任意下载 | 宿主统一下载管线（lib.rs download_file / downloads.rs 目录：桌面系统「下载」、Android MediaStore/SAF）；`cloud_upload_file` 工具已能把本地路径（`~/Downloads/x.pdf`）传云盘（tools.rs:207） | downloads.rs / seafile.rs:248 | 无「归档即分类」语义：现在只能传到用户手填的目录 |
| ③ IM bot 通道传入 | （未来）bot 收到附件 → 存对象存储/临时目录 → 作为文件引用进入同一管线 | 接口设计见 §6 | 网关本体另一条线在做，本文只定义交接接口 |

既有解析能力（摘要用，无需新增依赖）：App 已内置 `pdfjs-dist`（PDF）、`mammoth`（docx→文本）、`xlsx`（表格）（apps/desktop/package.json:33-41），文件预览链路已在用。

## 3. 云盘目录树

```
/Files/
├── learn/                          # 源①：网络学堂
│   └── 2026-2027-1/                # 学期（来自 query_learn_courses 的 semester）
│       └── 数据结构/               # 课程名（官方课名，LLM 建议时用课名精确匹配）
│           ├── 课件/
│           │   ├── w02-图论基础-讲义.pdf
│           │   └── w02-图论基础-讲义.pdf.md      # 摘要 sidecar
│           └── 作业/
│               └── hw3-提交要求.pdf
├── downloads/                      # 源②：App 下载归档（默认分类，用户可改）
│   └── 2026-10/
│       └── 实验报告-v2.docx
├── im/                             # 源③：IM bot 传入
│   └── 2026-10/
│       └── 群文件-通知原文.pdf
└── _inbox/                         # 兜底：分类置信度不足时的待归类区
    └── 2026-10-09-某文件.bin
```

规则：
- 深度上限 4 级（`{source}/{学期|月份}/{课程|分类}/{文件}`），LLM 建议超出即截断。
- 重命名建议格式：`{语义前缀}-{原名去冗余}`（如 `w02-图论基础-讲义.pdf`），**保留原扩展名**；用户拒绝重命名则用原名。
- 摘要 sidecar 恒为 `同名 + .md`，与源文件同目录——云盘网页端两者天然相邻。
- `_inbox/` 是「不确定就别乱放」的落地：宁进收件箱不进错目录，用户/agent 后续可再整理。

## 4. 入库管线（五步）

```
┌────────────────────────────────────────────────────────────────────┐
│ 用户对话：「把这周数据结构课件存到云盘」                              │
└────────────────────────────────────────────────────────────────────┘
   │
   ▼ ① 采集（源内取文件 → 本地暂存）
   agent: query_learn_files(课程=数据结构) → 拿 fileId 列表
   agent: files_fetch(source=learn, refs=[{fileId,name,course,semester}])
        宿主: learn.download(fileId) → 下载目录（已有能力，只差 facade 暴露）
   │
   ▼ ② 建议分类（LLM 就地决策，不新工具）
   agent 自己依据 文件名/来源/课程/时间 生成建议：
        { dest: "/Files/learn/2026-2027-1/数据结构/课件",
          rename: "w02-图论基础-讲义.pdf" }
   置信度低（课程名对不上/来源杂） → dest="/Files/_inbox/2026-10"，不猜
   │
   ▼ ③ 确认落盘（对齐 OH 写操作确认纪律，agent.rs:327-409）
   agent: files_commit(items=[{localPath, dest, rename}], summarize=true)
        → ToolOut::ConfirmNeeded（summary 逐条列「本地文件 → 云盘目标路径」）
        → 用户「确认」
        → 宿主: 逐条 seafile_mkdir_p(dest) → 断点续传上传（§5）
   │
   ▼ ④ 摘要（summarize=true 时，逐文件）
   文本类（pdf/docx/xlsx/md/txt/html，白名单按扩展名）：
        宿主解析（pdfjs/mammoth/xlsx）取前 N KB 文本 → LLM 摘要 ≤200 字
        → 写 sidecar .md（frontmatter 指回源文件，见下）
   非文本类：跳过，结果里如实说明「未生成摘要（二进制）」
   │
   ▼ ⑤ 记忆登记（联动 01 文档，observation 一条）
   已有该课程实体 → memory_append(permalink, category=[file],
        text="w02 课件已存 /Files/learn/2026-2027-1/数据结构/课件/，摘要：…")
   没有实体 → memory_write 新建（type: course）再 append
```

sidecar 格式：

```markdown
---
title: w02-图论基础-讲义 摘要
type: file-summary
ref: /Files/learn/2026-2027-1/数据结构/课件/w02-图论基础-讲义.pdf
origin: learn
generated: 2026-10-09T12:00:00+08:00
model: <生成摘要的模型名>
tags: [摘要, 数据结构]
---

## 摘要
（≤200 字：这文件讲什么、关键要点 3~5 条）

## 关键词
图论 / 最短路 / AVL
```

## 5. 上传与失败恢复

### 5.1 传输原语

- 小文件（<8MB，绝大多数附件）：现有 `seafile_upload`（seafile.rs:248）整传即可。
- 大文件：**断点续传**（thufs 已在同一实例验证的机制）：
  1. `GET /api/v2.1/repos/{id}/file-uploaded-bytes/?parent_dir=&file_name=` 探测已传字节数；
  2. `POST {upload-link}?ret-json=1` 携带 `Content-Range: bytes {start}-{total-1}/{total}` 续传剩余部分。
  seafile.rs 需新增封装（「待实现」，端点已在 thufs 验证）；memory 系统文件小，不用此路径，仅 Files Hub 用。
- 下载侧（源①取文件）：learn 下载本来就有完整会话管线（clients.ts），不动。

### 5.2 失败恢复矩阵

| 故障 | 检测 | 恢复动作 |
|---|---|---|
| 上传中断（网络断/进程退） | HTTP 错误 / 超时 | 小文件：原语幂等（replace=1 重传）；大文件：下次 files_commit 同目标时先探测 uploaded-bytes 续传。暂存本地文件不删（在下载目录里，重试清单见下） |
| 半途而废的会话（确认了没传完） | files_commit 未完成项 | 下次 OH 激活时对比「待办清单」（见下）与远端目录，续传或询问用户放弃 |
| 云盘满 / 接近满 | 上传前主动查 `seafile_account`（seafile.rs:89）：剩余 < max(200MB, 5% quota) → **先警告再执行**；上传中 4xx 满 → 停止后续条目，逐条报告成功/失败 | 建议用户清理：`_inbox/`、`.trash/`（记忆软删除区）、超大旧课件（agent 可代查 files_list 按大小排序） |
| 文件名非法/超长 | 上传 4xx | Rust 侧预清洗（§3 字符集）+ 失败时自动回退原名重试一次 |
| 目标目录被用户改名/删除 | mkdir_p 重建（幂等） | 无需特殊处理 |

**待办清单**（pending manifest）：`files_commit` 确认后先落一条本地记录（app state，同 seafile.cfg.json 的存储模式）：`{localPath, dest, rename, status: pending|done|failed}`，每条完成即更新。进程重启后按清单恢复。清单全空时删除——不引入常驻任务。

### 5.3 配额意识

- 每次会话首次 files_* 工具调用时缓存一次 account 信息（不逐条查）。
- 汇报口径统一 MB/GB（fmt_size 已有，tools.rs:2281）。
- 大文件（>100MB）入库前显式告知占配额比例，确认摘要里带「剩余空间 xx GB，本文件占 yy%」。

## 6. IM bot 交接接口（占位设计，网关线对接用）

bot 网关收到附件后，向 OH 的 chat 请求附加一个**文件引用**结构（不内联字节）：

```jsonc
// bot → OH run 请求的 attachments 字段（网关侧实现落地暂存）
{
  "attachments": [
    { "id": "att_01", "filename": "通知原文.pdf", "size": 182044,
      "mime": "application/pdf", "origin": "im",
      "fetch": { "type": "url", "url": "https://bot-gw/…/att_01" } }  // 或 type:"local_path"
  ]
}
```

OH 侧映射：`files_fetch(source=im, refs=[attachment…])`，宿主（bot 形态的 Host）把 fetch 取回并落暂存，之后走 §4 同一管线（dest 默认 `/Files/im/{YYYY-MM}/`）。要点：**bot 通道只是多了一种 fetch 实现，管线与确认纪律不变**；群聊场景的确认语义（谁确认？）由 bot 网关定义后映射到 confirmed 标志，OH core 不感知。

## 7. 工具契约（tools.rs 新增）

| 工具 | 参数 | 权限 | 确认 | 语义 |
|---|---|---|---|---|
| `files_fetch` | `source: learn|local|im`、`refs: [{fileId?|localPath?|attachmentId?, name}]` | learn:read / storage /（im 权限随网关定） | 否（只是取到本地暂存） | 采集：源①走 learn.download，源②直接引用本地路径，源③按 fetch 描述取回。返回暂存路径列表 |
| `files_commit` | `items: [{localPath, dest, rename?}]`、`summarize?: bool` | cloud:write | **是**（summary 逐条「来源文件 → 云盘路径」，含配额提示） | mkdir_p + 断点续传上传 + 登记待办清单；summarize=true 时逐文本文件生成 sidecar |
| `files_list` | `path?: string`（缺省 /Files/）、`recursive?: bool` | cloud:read | 否 | 列目录（复用 seafile_dir；recursive 由 agent 逐层展开，不给服务端压力） |
| `files_locate` | `query: string` | cloud:read | 否 | 找文件：先本地记忆/清单，再 search_cloud_files 兜底（索引延迟容忍） |
| `files_summarize` | `path: string`（云盘内路径） | cloud:read + cloud:write | **是**（写 sidecar） | 对已入库文件补生成/更新摘要 sidecar |
| `files_move` | `from: string`、`to: string` | cloud:write | **是** | 整理：rename API 可用时直移（待验证）；否则下载+上传+软删旧位（`.trash` 语义同记忆） |

设计取舍：**不设 files_suggest 工具**——分类建议就是 LLM 的本职（它已有 query_learn_files 的课程上下文），再加一层工具只会丢上下文；Rust 侧只校验 dest 白名单（必须 `/Files/` 前缀、深度 ≤4、无 `..`）。

## 8. 与记忆系统的联动契约

- 入库成功（含摘要）→ 必写一条 observation（§4 第⑤步），挂到课程/主题实体上；找不到挂点就写进当月 journal。
- sidecar 本身**不进** OH-Memory 镜像（它是云盘文件，不是记忆实体）；记忆里只存「路径 + 一句摘要」，读记忆后 agent 需要**深读**时再走 files_locate + seafile_download。
- `files_move` 成功后自动 memory_edit 修正受影响的 observation 里的旧路径（find=旧路径字面量，replace=新路径）。

## 9. 风险清单

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| F1 | learn 附件下载 URL 形态随网络学堂改版漂移（历史事故：webvpn 双重包装 404，clients.ts:722 注释） | 中 | 复用宿主 downloadLearnUrl 的归一化兜底，不另起炉灶；失败如实报告 |
| F2 | 断点续传端点（file-uploaded-bytes/Content-Range）在清华实例的边角行为（如并发上传同名文件） | 中 | thufs 同实例已验证主路径；上线前用 autotest 目录做 live 冒烟（同 seafile.rs live 测试模式，:469-474） |
| F3 | LLM 分类建议质量差（课名对不上/乱建目录） | 中 | 目录白名单校验 + `_inbox/` 兜底 + 确认摘要让人眼可查；journal 记录误分类供复盘 |
| F4 | 大 PDF 摘要的 token 成本 | 低 | 解析只取前 N KB（如 24KB 文本），摘要限 200 字；非文本明确跳过 |
| F5 | 配额满在批量入库中途发生 | 中 | 逐条提交、失败即停，待办清单保留断点；配额预警前置 |
| F6 | Android 端 learn 附件先落 MediaStore 再上传，路径权限（SAF 目录树授权）不可用 | 中 | files_fetch 在 Android 走应用缓存目录暂存（同 seafile_download 的 onethu-dl 模式，seafile.rs:209-235），不经 MediaStore |
