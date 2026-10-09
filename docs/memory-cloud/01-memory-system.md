# 01 · OH 云端记忆系统设计（OH-Memory）

> 状态：设计稿（原型级，未实现） · 分支 dev-memory-cloud · 2026-10-09
> 姊妹篇：[02-files-hub.md](./02-files-hub.md)（文件汇聚管道）、[03-sync-conflict.md](./03-sync-conflict.md)（同步/冲突/缓存细节）

## 0. 一句话架构

**记忆 = 清华云盘上一个资料库里的 markdown 文件树；本地全量镜像 + 纯文本索引（frontmatter 过滤 + 关键词匹配 + 时间倒序）；三端（手机/桌面/云端 bot）经各自的 Host 后端读写同一棵树，冲突用「append 优先合并 + 内容哈希指纹 + last-write-wins 兜底」解决；全程无向量、无嵌入、无外部服务。**

## 1. 目标与非目标

**目标**
- OH 在任意一端的对话中获得跨会话、跨设备的长期记忆（用户偏好、课程上下文、任务状态、经验结论）。
- 记忆可由用户在云盘网页端直接看到、直接编辑（人对 AI 双向可读写，同 basic-memory 理念）。
- 只依赖 seafile.rs 已实现/已验证的 API 能力，外加少量已在清华实例被 thufs 验证、但 seafile.rs 尚未封装的端点（§4.2，逐条标注）。

**非目标（明确不做）**
- 向量检索 / 嵌入模型 / 语义排序（用户明确否决）。
- 实时多端同步（云盘无推送能力，见 §4.3；接受分钟级延迟）。
- 代替会话历史（session.rs 已管会话；记忆只存「值得长期记住的结论」）。
- 给记忆内容做加密存储（云盘本身就是用户账号私有空间；如未来需要，frontmatter 加 sensitivity 标记即可演进）。

## 2. basic-memory 架构精髓剖析

参考实现：github.com/basicmachines-co/basic-memory（**License 为 AGPL-3.0**——注意任务简报里写的 Apache-2.0 已过时。本文档只提炼其架构思想与文件格式约定，不复制其代码，规避 AGPL 传染）。

### 2.1 三层结构：文件是唯一真相

```
markdown 文件（source of truth）
        │  解析（frontmatter + observation + relation 语法）
        ▼
SQLite 索引（FTS5 全文倒排 + 关系表 + 元数据列）——只是缓存
        │  search_notes / build_context 查询
        ▼
MCP 工具（write_note / read_note / search_notes / build_context …）
```

关键点：
1. **文件可被人直接编辑**（Obsidian/任意编辑器），索引通过文件监听或 `bm doctor` 对账重建。索引损坏 ≠ 数据丢失，任何时候可以 `reindex` 全量重建。
2. **索引 ≠ 数据库**。basic-memory 的 SQLite 里没有独占信息：每张表都能从文件重新推导。这是「弱智架构」的精髓——复杂度只放在「解析和检索」这一层，而解析器输入输出都是人可读的文本。
3. 官方云端版（basicmemory.com）同样不引入数据库同步协议，而是 **rclone 文件同步 + 冲突解决**——印证「文件树 + 同步」是多端共享的充分方案。

### 2.2 知识语法（我们直接借鉴的部分）

一个文件 = 一个实体（Entity），三段式：

```markdown
---
title: 数据结构（2026 秋）
type: course                    # 实体类型：note / course / task / preference / fact …
permalink: ds-course-2026f      # 稳定标识，文件改名/移动不影响寻址
tags: [课程, 大二上]
created: 2026-09-20T10:00:00    # 语义时间戳（区别于文件系统 mtime）
modified: 2026-10-09T12:00:00
---

# 数据结构（2026 秋）

## Observations（观察 = 一条条事实）
- [teacher] 邓俊辉 #重要 (讲得快，坐前排)
- [deadline] 大作业 12 月第 2 周截止
- [exam] 期中闭卷，考到 AVL 删除

## Relations（关系 = wikilink 图）
- belongs_to [[我的课表 2026 秋]]
- relates_to [[OH-Memory 使用记录]]
```

语法规则（摘自其 NOTE-FORMAT.md，均已在 README/文档核实）：
- observation：`- [category] 内容 #tag (上下文)`，category 必填、#tag 与 (context) 可选；checkbox/链接/裸 wikilink 行不算 observation。
- relation：`- relation_type [[目标]] (context)`，多词关系类型要加引号；正文中的 `[[...]]` 自动索引为隐式 `links_to`；**允许前向引用**（目标实体不存在也可以先写，待目标创建时解析生效）。
- frontmatter 标准字段 title/type/tags/permalink/created/modified + **任意自定义字段**（全部进元数据索引，可结构化过滤）。

### 2.3 没有向量时它怎么做到可用检索

basic-memory 的检索是四条腿，全部纯文本：

| 手段 | 机制 | 对 LLM 的价值 |
|---|---|---|
| **FTS 全文检索** | SQLite FTS5（BM25 排序）建在 title + 正文上 | 「找提到 X 的一切」 |
| **permalink/标题精确与前缀匹配** | `memory://auth*` 通配 | 「我知道它叫什么，直接拿」 |
| **元数据结构化过滤** | frontmatter 任意字段 → `{"status":"active"}`、`{"confidence":{"$gt":0.7}}`、`tag:xxx` | 「把某一类全列出来」 |
| **图遍历** | `build_context` 沿 relation 展开（memory:// URL 导航，带 timeframe/deepth 参数） | 「顺着关联把上下文一次带齐」 |

排序信号 = BM25 相关性 + 时间新旧。它后来的 vector/hybrid（FastEmbed）是**可选插件**，默认装机没有它也完全可用——这正是我们要抄的形态。

> 一个常被忽略的细节：basic-memory 的检索质量一半来自**写入纪律**——每次 write_note 时由 LLM 把松散对话压缩成短句 observation、打上 category/tag、挂上 relation。检索是弱智的，但写入是聪明的（LLM 在写入时做了「离线嵌入」：把语义折叠进关键词和标签）。我们的系统提示词必须同样强调这一点（§6.3）。

### 2.4 多项目 = 多目录

basic-memory 以「项目目录」为单位建库（默认 ~/basic-memory），多项目 = 多个互不相干的目录 + 各自一份索引。我们的对应物：**云盘上一个专用资料库 = 一个记忆项目**（§3.1）。

## 3. 映射到清华云盘

### 3.1 总体布局

用户云盘里**新建（或指定）一个资料库**，名字默认 `OH-Memory`（seafile.rs 已有建库 API 的验证记录：POST /api2/repos/ form(name)，见 aimemory 历史记忆；seafile.rs 本身尚未封装建库，首启引导时可让用户在网页端手建，或后续补 `seafile_create_repo`——「待验证」标注见 §4.2）。

库内目录树（首版）：

```
/OH-Memory/
├── index.md                 # 库级导航：目录说明 + 最近变更摘要（agent 维护，非权威）
├── preferences/             # type: preference —— 用户偏好（称呼/作息/习惯）
│   └── 用户画像.md
├── courses/                 # type: course —— 课程上下文（每课一文件）
│   ├── 数据结构-2026秋.md
│   └── 线性代数-2026秋.md
├── tasks/                   # type: task —— 跨会话任务状态（进行中的事）
│   └── 保研材料准备.md
├── knowledge/               # type: fact/note —— 经验结论、办事指南
│   └── 图书馆研讨间预约技巧.md
├── journal/                 # type: journal —— 按月滚动的会话沉淀（append-only）
│   └── 2026-10.md
└── .trash/                  # 软删除归档（memory_delete 不做硬删）
```

分片规则：**每类一个目录、每实体一个文件**。单目录文件数超过 ~300（一次列目录响应开始变得笨重）后，journal 已按月分片、其余按需加二级目录（如 courses/2026-2027-1/）。规模上界评估见 §7。

### 3.2 文件格式

完全沿用 §2.2 三段式（frontmatter + observations + relations），约束如下：

- 文件名 = `{title}.md`，title 里的 `/ : * ? " < > |` 替换为全角或下划线（云盘对文件名字符集的容忍度未系统测试，「待验证」；seafile.rs 上传文件名由本地路径决定，PATH 安全字符集即可）。
- **permalink 必填**且全局唯一：由 OH 在写入时生成（`{拼音或英文 slug}-{短哈希}`，如 `ds-course-2026f-a3f2`）。它是三端唯一约定的稳定 ID——文件被人在网页端改名/移动后，靠它仍能找回。
- 时间字段用 ISO 8601 带 `+08:00` 偏移写入（云端 bot 可能跑在 UTC 容器里，绝不写裸本地时间）。
- 每次写入由 OH 维护 `modified`；`created` 首写后不变。
- frontmatter 增加两个本项目私有字段：
  - `origin: desktop | android | bot`（哪个端写的，冲突分析用）
  - `sensitivity: normal | sensitive`（默认 normal；sensitive 的内容不进 journal 汇总、不主动复述，见 §8）

### 3.3 三端架构图

```
┌─ 手机 OH（Android，编进 App）─────┐
│  onethu.harness core（tools.rs 新增 memory_* 工具）
│        │ onethu.call ns="memory"
│  TauriHost → facade.ts memory ns（权限门禁）
│        │ seafile_* Tauri 命令 + 本地镜像目录（App 沙盒）
└────────┼──────────────────────────┘
         │            HTTPS (Seafile Web API)
┌─ 桌面 OH（sidecar 进程）──────────┐         ┌───────────────────────┐
│  core（同一份 tools.rs）           │         │  清华云盘               │
│        │ onethu.call              │  HTTP   │  cloud.tsinghua.edu.cn │
│  StdioHost → facade memory ns     │────────▶│  资料库「OH-Memory」    │
│        │                          │         │   /preferences/… .md  │
│  本地镜像：~/…/app data/onethu-    │         │   /courses/… .md      │
│  memory-mirror/（全量 markdown）  │         │   /journal/… .md      │
└────────┼──────────────────────────┘         └───────────▲───────────┘
         │                                                │
┌─ 云端 IM bot OH（未来，另一条线）──┐                         │
│  core（同一份 tools.rs）           │────────────────────────┘
│        │                          │  直连 Seafile API 的 Host 实现
│  BotHost（seafile token 来自       │ （不走 Tauri；复用记忆引擎 crate）
│  环境变量/secret 管理）            │
└───────────────────────────────────┘
```

架构上的关键切分（对齐 host.rs:15 的 `Host` trait 设计）：

1. **记忆引擎独立成纯 Rust 模块**（如 `plugins/OneTHU-Harness/core/src/memory.rs`，或独立 crate `oh-memory`），不依赖 Tauri/JS。输入是一个极小的 `CloudFs` trait（`list_dir / read_file / write_file(replace) / mkdir`，见 §5.1 伪代码）。
2. **App 内**：宿主实现 `CloudFs`（内部调 seafile.rs 命令 + 本地镜像缓存），经 facade 新 `memory` ns 暴露给 core；权限门禁在 facade（同现有 cloud ns 模式，facade.ts:271-280）。
3. **云端 bot**：一个 ~200 行的 `SeafileHttpFs`（reqwest 直连，token 来自环境变量）实现同一 trait，core 与工具零改动。这保证「同一 core 三端复用」不变成「三份实现」。

## 4. API 能力清单与设计约束（以实测为准）

### 4.1 seafile.rs 已实现（可信基线）

| 能力 | 函数 | 设计用途 |
|---|---|---|
| 账号+配额 | `seafile_account`（seafile.rs:89） | 配额意识（§8 of 02） |
| 列库（去重/滤 virtual） | `seafile_repos`（:105） | 定位 OH-Memory 库 |
| 列目录（name/kind/size/mtime） | `seafile_dir`（:135） | 变更检测的主手段 |
| 下载单文件 | `seafile_download`（:176） | 拉取镜像（**注意：现有实现固定落盘到「下载」目录，记忆引擎需要的是「拿字节/内容」版本——需在宿主侧加一个内部变体，不新增 API**） |
| 上传（两步 upload-link + multipart，replace 参数） | `seafile_upload`（:248） | 写入记忆文件 |
| 递归建目录（幂等） | `seafile_mkdir`（:325） | 初始化目录树 |
| 分享链接 | `seafile_share`（:342） | （记忆库不应分享，工具层不暴露） |
| 库内文件名搜索 | `seafile_search`（:377） | 检索兜底（注意**服务端索引有延迟**：live 测试里轮询 5×2s 才命中，seafile.rs:539-549） |

### 4.2 thufs 已在清华实例验证、seafile.rs 未封装（需小幅扩展，逐条标注）

thufs（class-undefined/thufs，清华同学的云盘 CLI，同一实例 cloud.tsinghua.edu.cn）的 seafile.rs 直接使用以下端点且工作正常：

| 端点 | 用途 | 状态 |
|---|---|---|
| `GET /api2/repos/{id}/update-link/?p=/目录` → multipart(file, **target_file**) | **覆写已存在文件**（编辑记忆的原语；比 upload+replace 更语义化） | thufs 在用；seafile.rs 需新增封装「待实现」 |
| `GET /api2/repos/{id}/file/detail/?p=` → last_modified | 单文件精确 mtime | 同上 |
| `GET /api/v2.1/repos/{id}/dir/detail/?path=` → mtime | **目录级指纹**（任一子孙变更都会变？——不确定，目录 mtime 语义「待验证」） | 同上 |
| `GET /api/v2.1/repos/{id}/file-uploaded-bytes/?parent_dir=&file_name=` | 断点续传探测（Files Hub 大文件用） | 同上 |
| `GET/DELETE /api/v2.1/share-links/` | 分享管理 | 记忆库不用 |

### 4.3 官方文档有、清华实例未实测（设计按「有但保守使用」处理）

| 端点 | 用途 | 状态 |
|---|---|---|
| `DELETE /api2/repos/{id}/file/?p=` / `dir/?p=` | 硬删除 | **待验证**。首版设计不依赖硬删：memory_delete = 移入 `.trash/`（用 upload 到新路径 + 删除原文件，删除这步不可用时保留原位但 frontmatter 标 `status: trashed`） |
| `POST /api2/repos/{id}/file/?p=&operation=rename`（form: newname） | 重命名/移动单文件 | **待验证**。同上：移动 = 下载 + 上传新路径 + （可选）删旧 |
| `POST /api2/repos/` form(name) | 建库 | aimemory 历史记忆记为已验证（201 response）；正式接入前重测一次 |

### 4.4 明确不存在 / 未暴露的能力（设计前提）

- **无原子写、无锁、无 CAS**：上传 replace=1 直接覆盖。→ 冲突策略见 [03-sync-conflict.md](./03-sync-conflict.md)。
- **无实时通知/webhook**：Seafile 开源版的通知机制面向桌面客户端同步协议（seaf-daemon 专用信道），Web API 无 push；清华定制版是否保留未查证，且即使有也不应依赖。→ **轮询 + 惰性刷新**为唯一方案（§5.3）。
- **搜索索引有秒~分钟级延迟**：不能把服务端搜索当实时读己之写。

## 5. 核心机制设计

### 5.1 记忆引擎伪代码（core 侧，纯 Rust）

```rust
/// 记忆引擎的文件系统抽象：三端各给一个实现
pub trait CloudFs {
    fn list(&mut self, path: &str) -> Result<Vec<FsEntry>, String>;   // name/kind/size/mtime
    fn read(&mut self, path: &str) -> Result<Vec<u8>, String>;        // 下载到内存（记忆文件 <64KB）
    fn write(&mut self, path: &str, bytes: &[u8], replace: bool) -> Result<(), String>;
    fn mkdir_p(&mut self, path: &str) -> Result<(), String>;
}

pub struct FsEntry { pub name: String, pub kind: EntryKind, pub size: i64, pub mtime: i64 }

/// 本地镜像 + 索引（每端各一份，云盘文件是唯一权威）
pub struct MemoryEngine<F: CloudFs> {
    fs: F,                                   // App 端=SeafileFs(经宿主)；bot 端=SeafileHttpFs
    cache: MirrorCache,                      // 目录树快照 + (path → entry 快照 + content_hash)
    // 镜像目录：桌面 ~/…/onethu-memory-mirror/，Android App 沙盒同构子目录
}

impl<F: CloudFs> MemoryEngine<F> {
    /// 变更检测：列目录比对 (name,size,mtime) 三元组；mtime 秒级 → 辅以内容哈希
    pub fn refresh(&mut self, force: bool) -> Result<RefreshReport, String>;

    /// 检索（纯文本四段管线，§6）
    pub fn search(&self, q: &Query) -> Vec<Hit>;

    /// 读：permalink → path 反查（cache 索引）→ fs.read → 解析实体
    pub fn read_note(&mut self, id: &str) -> Result<Note, String>;

    /// 写：全走 merge_on_write（读最新 → 合并 → 覆写），见 03 文档
    pub fn write_note(&mut self, note: &Note, mode: WriteMode) -> Result<(), String>;

    /// 追加一条 observation（append 语义，冲突可 union 合并）
    pub fn append_observation(&mut self, id: &str, category: &str, text: &str)
        -> Result<(), String>;
}
```

`MirrorCache` 是纯内存结构（进程内）+ 磁盘镜像目录做冷启动加速；**没有任何本地数据库**——检索时对镜像目录顺序扫描 + 解析 frontmatter（千级文件、每文件几 KB 的量级下，顺序扫描毫秒级，无需倒排索引；量级论证见 §7）。

### 5.2 写路径（高概要，细节在 03 文档）

```
LLM 调 memory_write/memory_append（confirm 型）
  → 用户确认（agent.rs 两段式，:327-409 既有机制）
  → engine.write_note():
      1. 若目标文件存在：fs.read 远端最新（不信缓存）
      2. 与本地基线比对：
          a. 远端 == 缓存基线 → 正常写入（覆写 via update-link / upload replace=1）
          b. 远端 != 基线 且 双方都是 append 类变更 → union 合并（两边的 observations 都保留，按行去重）
          c. 远端 != 基线 且 无法合并 → last-write-wins：以我方为主覆写，
             远端版本原样存到 .conflict/{原路径}__{origin}__{时间}.md
      3. 写入后 re-read 校验内容哈希（防无锁窗口内被再次覆盖；不匹配则重走 2）
```

### 5.3 刷新策略（轮询，无通知能力下的现实方案）

| 时机 | 动作 |
|---|---|
| OH 会话开始（插件 activate / 首次 chat run） | 全量 `refresh()`：对每个一级子目录 `list` 比对三元组（name/size/mtime），变更者重拉文件内容 |
| memory_* 工具调用时缓存龄 > 5 分钟 | 先 `refresh()` 再执行（读工具也如此，保证不答旧账） |
| 写操作完成后 | 立即回读并更新本地缓存（读己之写） |
| 用户手动 | 「刷新记忆」入口（复用工具 memory_refresh 或设置页按钮） |
| 后台轮询 | **首版不做**。桌面端可配置 15 分钟低频轮询（设置项，默认关）；Android 不做（省电） |

成本估算：6 个一级目录 × 1 次 list ≈ 6 个 HTTP 请求/次刷新；文件变更时按需 +N 次下载。对个人库完全无害。

## 6. 检索设计（纯文本四段管线）

### 6.1 管线

```
输入：{ keywords?: string[], tags?: string[], type?: string, since?: Date, limit?: usize }
   │
   ① 结构过滤：frontmatter 的 tags / type / created / sensitivity
   │     （tags 全部包含 = AND；type 精确；sensitive 默认排除，除非显式要求）
   ▼
   ② 关键词匹配（对 title + permalink + observations 全文，大小写不敏感 substring）
   │     评分：title 命中 ×4 > permalink 命中 ×3 > tag 命中 ×2 > 正文命中 ×1
   │     多关键词 = 每词独立打分求和（等价 OR 加权；LLM 层自己决定给几个词）
   ▼
   ③ 时间倒序（modified 降序）作为同分排序键
   ▼
   ④ relation 展开（对 top-N 命中各展开一跳 [[wikilink]]，作为 related 附加返回，
      不参与排序）——LLM 需要「顺藤摸瓜」时再对 related 调 memory_read
   ▼
输出：[{ permalink, title, type, tags, modified, snippet(命中行±1 行), related[] }]，默认 limit=8
```

为什么不用云盘服务端搜索当主检索：① 索引延迟（实测秒~分钟级）；② 只覆盖文件名不覆盖内容；③ 中文分词行为未知。**它只做兜底**：本地索引里找不到且用户坚持「我明明存过」时，agent 可退回 search_cloud_files 按文件名再试一次。

### 6.2 可行性评估

- 中文 substring 匹配无分词需求，Rust `str::contains` 直接可用，天然「弱智」。
- 关键词召回的上限：用户问「我上学期那门数学课的作业习惯」→「数学课」「作业」未必出现在文件里（可能写成「线性代数」）。**这正是写入纪律要解决的**：memory_write 时 LLM 必须把同义词折叠进 title/tags（提示词强制，§6.3）；relation 管线提供第二召回路径（课表 → 课程 → 习惯）。评估结论：对「个人记忆」规模（千条内、单人使用、LLM 生成为主）足够；这不是搜索引擎问题，是「帮 LLM 找回自己写过什么」的问题。
- 退化路径（文件变多时，按序启用）：
  1. >300 文件/目录：二级目录分片（journal 已按月；courses 按学期）；
  2. >3000 文件：把顺序扫描换成磁盘镜像上的简易倒排（一个 JSON 索引文件，进程启动时重建——仍然无数据库）；
  3. 任何时候：`reindex` = 删镜像重新全量拉取（basic-memory doctor 同款兜底）。

### 6.3 写入纪律（系统提示词增量，与工具同等重要）

agent.rs system_prompt（:48）追加一段（示意）：

```
记忆规范：
- 用户表露偏好/事实/任务且说「记住」或明显值得长期记住时，调 memory_write。
  写入前先 memory_search 查重：已有同主题实体就 memory_append 追加观察，不新建。
- title 用可检索的具体名词（「数据结构（2026 秋）」而非「一门课」）；
  tags 折叠同义词（数学课/线代/linear-algebra）。
- 观察写短句事实，一事一行；不确定的事标 [question]。
- 绝不写入：密码/token/验证码、证件与银行卡号、健康与财务明细、他人隐私、
  成绩具体分数（除非用户明确要求，且标 sensitivity: sensitive）。
- 会话中出现「我之前说过什么」类问题时先 memory_search 再回答，找不到就直说没有记录。
```

## 7. 规模与配额

- 单条记忆 0.5~2KB；重度用户一年 2000 条 ≈ 4MB，含 journal ≈ 10MB。相对云盘配额（GB 级）忽略不计。
- 一次全量刷新 6 次 list + 冷启动全量拉取 ≤ 3000 文件 × 平均 2KB ≈ 6MB（一次性，Wi-Fi 下秒级）。
- LLM token 成本：每次 memory_search 返回 8 条 × (title+tags+snippet ≈ 150 tokens) ≈ 1.2k tokens，符合现有工具「结果聚合压缩」的纪律（tools.rs:9）。

## 8. 隐私与边界

**允许存（默认 sensitivity: normal）**
- 用户偏好：称呼、作息、口味、常用路线、界面习惯。
- 课程上下文：选课列表、教师印象、作业节奏（描述性，不含分数）。
- 任务状态：进行中的事、下一步、截止意识。
- 经验结论：办事流程、踩坑记录、工具用法。

**红线（工具层与提示词双重拦截）**
- 任何凭据：密码、token、验证码、cookie——memory_write 工具在 Rust 侧做内容黑名单正则（sk-[A-Za-z0-9]{20,}、Bearer …、验证码 \d{4,6} 上下文词）拦截，命中即拒绝并提示。
- 证件/银行卡/财务明细/健康信息：提示词禁止 + Rust 侧高置信模式（连续 15+ 数字）警告。
- 他人隐私：默认把对话中第三方信息折叠为最少必要（「室友」而非姓名学号）。
- 成绩分数：默认不写；用户明确要求时写但自动标 `sensitivity: sensitive`（该类内容不进 journal 汇总、search 默认过滤、bot 端只读不转述）。

**边界事实**：云盘资料库本身在用户清华账号下，权限等同用户本人云盘数据——记忆系统不扩大暴露面；但**分享链接绝不暴露给 memory 工具**（防误分享整库）。

## 9. 工具契约（tools.rs 新增，命名对齐现有风格）

| 工具 | 参数 | 权限 | 确认 | 语义 |
|---|---|---|---|---|
| `memory_search` | `query?: string`（空格分词）、`tags?: string[]`、`type?: string`、`limit?: int`（默认 8） | memory:read | 否 | §6 管线；返回 permalink 列表 + snippet |
| `memory_read` | `permalink: string` | memory:read | 否 | 全文（超 8KB 截断 + 提示） |
| `memory_list` | `folder?: string`（preferences/courses/tasks/knowledge/journal）、`tag?: string` | memory:read | 否 | 目录/标签清单（title+modified，不读正文） |
| `memory_write` | `title`、`observations: [{category, text}]`、`relations?: [{rel, target}]`、`tags?`、`type?`（缺省 note） | memory:write | **是** | 新建实体；Rust 侧生成 permalink + frontmatter；黑名单拦截先行 |
| `memory_append` | `permalink`、`category`、`text`、`context?` | memory:write | **是** | 追加一条观察（append 语义，可 union 合并） |
| `memory_edit` | `permalink`、`find`、`replace`（字面文本替换，对齐 basic-memory edit_note 的 find_replace） | memory:write | **是** | 定点改写；找不到 find 文本报错不猜 |
| `memory_delete` | `permalink`、`reason?` | memory:write | **是**（summary 里必须显示 title） | 软删除 → `.trash/`；rename API 不可用时原地标记 `status: trashed` |
| `memory_refresh` | — | memory:read | 否 | 强制全量 refresh（排障用） |

宿主侧配套：
- facade.ts 新 `memory` ns（`search/read/list/write/append/edit/delete/refresh`），内部调记忆引擎模块（宿主进程内，桌面=Tauri 主进程或 TS 侧均可，**建议 TS 侧**：解析/检索是纯文本逻辑，TS 实现三端可共享到未来 RN/云端 Node bot；Rust core 只做工具转发）。
- 权限清单增补：manifest.json permissions 加 `memory:read`、`memory:write`（用户安装/更新插件时按现有权限门禁流程知情）。
- **实现归属（已拍板，2026-10-09 Lead 决议）**：**宿主 TS 侧实现引擎 + core 只留工具定义**。理由：① OH core 保持宿主无关的既有架构纪律；② IM bot 网关大概率走 TS/Node 生态（openclaw 系是 TS），TS 引擎三端直接复用；③ facade 权限门禁体系现成。保留口子：若 im-cloud 调研最终把 bot 网关定为 Rust 形态再复议——工具契约不变，迁移成本可控。

## 10. 风险清单

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R1 | 无锁并发写丢更新（两端同秒写同一文件） | 中 | 读-合-写 + 写后回读校验 + .conflict 归档（03 文档详述）；append 语义使真实损失≈0 |
| R2 | 服务端搜索索引延迟造成「写完搜不到」假象 | 低 | 检索完全走本地镜像，不依赖服务端索引 |
| R3 | 云盘风控（高频轮询触发限流） | 低 | 刷新只在会话驱动 + 5 分钟阈值；无后台轮询默认值 |
| R4 | 文件被用户在网页端手改成坏格式 | 中 | 解析失败文件进「损坏清单」原样保留，agent 提示用户；绝不静默覆盖 |
| R5 | delete/rename API 在清华实例不可用 | 中 | §4.3 保守设计（软删除/重写路径），不阻塞首版 |
| R6 | token 失效（用户重置云盘 token） | 低 | 沿用 seafile.rs:34-39 的错误翻译（提示重连），memory 工具读缓存降级只读 |
| R7 | LLM 把不该写的写进记忆 | 中 | §8 双层拦截（提示词 + Rust/TS 内容黑名单） |

## 11. 实施切面建议（原型阶段顺序）

1. `CloudFs` trait + `SeafileFs`（宿主 TS 侧）+ 镜像目录 + refresh（纯读，可先行验证 API 行为）。
2. 检索管线 + `memory_search/memory_read/memory_list` 只读工具（不涉权限新面，先挂 cloud:read 临时验证）。
3. `memory_write/append` + 确认流 + 黑名单（引入 memory:write 权限）。
4. 冲突合并与 .conflict（03 文档）+ journal 滚动。
5. 云端 bot 的 `SeafileHttpFs`（等 bot 网关线定型后对接）。
