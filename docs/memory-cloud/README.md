# OH 云端记忆与文件管道设计（memory-cloud）

> 状态：设计稿（原型级，未实现） · 分支 dev-memory-cloud（基于 dev3/2b16fa1） · 2026-10-09
> 任务背景：OH（OneTHU Harness）需要跨设备长期记忆与文件自动归档，**用户明确要求「弱智架构」：不搞向量检索/嵌入模型，纯文本层面、贴着清华云盘（Seafile）实际 API 能力走。**

## 文档索引

| 文档 | 内容 |
|---|---|
| [01-memory-system.md](./01-memory-system.md) | 云端记忆系统：basic-memory 精髓剖析 → 映射清华云盘（目录树/文件格式/三端架构）→ 纯文本四段检索管线 → memory_* 工具契约 → 隐私红线 |
| [02-files-hub.md](./02-files-hub.md) | 文件汇聚管道：三源（学堂附件/App 下载/IM bot）五步入库（采集→LLM 分类建议→两段式确认→断点续传落盘→摘要 sidecar→记忆登记）→ files_* 工具契约 → 配额与失败恢复 |
| [03-sync-conflict.md](./03-sync-conflict.md) | 同步底座：无锁/无通知 API 现实下的指纹（sha1+三元组粗筛）、read-merge-write 写协议、union 合并、.conflict 归档、tombstone、时钟纪律 |

## 一页总览

```
                 ┌──────────────── 清华云盘（Seafile @ cloud.tsinghua.edu.cn）───────────────┐
                 │  资料库「OH-Memory」          资料库内 /Files/ 目录树                        │
                 │   /preferences|courses|        /learn/{学期}/{课程}/…                      │
                 │   tasks|knowledge|journal/     /downloads/{月}/  /im/{月}/  /_inbox/      │
                 │   markdown 实体文件             原文件 + 同名 .md 摘要 sidecar              │
                 └───────────▲──────────────────────────────▲────────────────────────────┘
                             │ Seafile Web API（列目录/读/上传/覆写/mkdir/搜索——无锁无通知）
        ┌────────────────────┴───────┐          ┌───────────┴──────────────┐
        │ 记忆引擎（三端复用）         │          │ Files Hub 管线            │
        │  本地镜像+sha1 账本          │          │  采集→分类→确认→传输      │
        │  纯文本检索（过滤/关键词/    │          │  →摘要→记忆登记           │
        │  时序/relation 展开）        │          │  断点续传+配额预警        │
        │  read-merge-write 协议      │          └───────────┬──────────────┘
        └────────────────────┬───────┘                      │
   ┌────────────────────────┼──────────────────────────────┼─────────────┐
   │ 手机 OH（core 编进 App） │ 桌面 OH（sidecar）             │ 云端 IM bot（未来）│
   │  Host=TauriHost→facade │  Host=StdioHost→facade        │  Host=直连 HTTP    │
   │  memory/files ns + 权限门禁                            │  同一 core 零改动  │
   └────────────────────────┴──────────────────────────────┴─────────────┘
```

## 核心决策摘要

1. **文件即真相**（借鉴 basic-memory，AGPL-3.0——只借鉴格式与机制思想，不抄代码）：云盘 markdown 是唯一权威，本地镜像+索引只是可全量重建的缓存。
2. **知识语法**：frontmatter（title/type/permalink/tags/created/modified/origin/sensitivity）+ observations（`- [category] 内容 #tag (context)`）+ relations（`- rel [[目标]]`）。
3. **检索无向量**：结构过滤 → 关键词加权匹配（title>permalink>tag>正文）→ 时间倒序 → relation 一跳展开；写入纪律（LLM 折叠同义词进 title/tags）是检索质量的另一半。
4. **正视无锁**：版本判定只看内容 sha1（不信秒级 mtime、不比跨端时钟）；append 型冲突 union 合并、结构性冲突 LWW+败者全量归档 `.conflict/`；写后回读校验。
5. **正视无通知**：会话驱动的惰性刷新（激活时 + 工具调用缓存龄>5min + 写后回读），无后台轮询默认值。
6. **API 边界三档**：seafile.rs 已实现（可信）/ thufs 同实例已验证待封装（update-link、file-uploaded-bytes 断点续传、file|dir detail）/ 官方文档有清华实例未实测（delete、rename——软删除设计不依赖它们）。
7. **权限**：新增 `memory:read` / `memory:write`；写工具全部 confirm 型（挂 agent.rs 既有两段式确认）；内容黑名单（token/证件/连续数字）在引擎层硬拦。

## 最大三个技术风险（详表见各文档）

1. **无锁环境丢更新**：read-merge-write 只能缩窗不能消灭窗口（03 §4.1 有概率论证）——靠 append 化 + union 合并 + .conflict 归档兜底。
2. **delete/rename 端点未在清华实例验证**：软删除/拷贝-覆写路径先行的保守设计，若端点不可用则记忆移动成本 = 下载+上传。
3. **facade learn ns 缺 download 方法 + seafile.rs 缺「读字节」变体**：Files Hub 源①与记忆镜像都卡在这两个宿主侧小缺口上（不改协议、只补转发），是动产品代码前的第一优先级。

## 对现有代码的改动面（实现阶段，全部「待 Lead 批准」）

| 位置 | 改动 | 性质 |
|---|---|---|
| `plugins/OneTHU-Harness/core/src/tools.rs` | 新增 memory_*/files_* 工具定义与执行 | 新增 |
| `plugins/OneTHU-Harness/manifest.json` | permissions 增 memory:read/write | 新增 |
| `plugins/OneTHU-Harness/core/src/agent.rs` | system_prompt 增记忆规范段 | 小改 |
| `apps/desktop/src/plugins/facade.ts` | 新 memory ns；learn ns 增 download | 新增+小改 |
| `apps/desktop/src-tauri/src/seafile.rs` | 增 seafile_read_bytes（内存版下载）/ update-link / 断点续传（可选 dir/file detail） | 新增函数 |
| 记忆引擎本体 | 建议宿主 TS 侧（三端含未来 Node bot 可复用）；core 保持薄转发 | 开放决策，见 01 §9 |
