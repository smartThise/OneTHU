# OH 云端记忆与文件管道设计（memory-cloud）


> 归档说明：本文记录当时的设计稿与方案论证；0.11 当前功能与使用说明请查阅 [文档入口](../README.md)（[English overview](../en/index.md)）。


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

1. **文件即唯一数据源**（借鉴 basic-memory 的格式约定与机制思路，独立编写全部代码，规避 AGPL-3.0 传染）：以云盘 Markdown 文件为准，本地镜像与索引均作为可随时全量重建的缓存。
2. **知识语法**：frontmatter（`title`/`type`/`permalink`/`tags`/`created`/`modified`/`origin`/`sensitivity`）+ observations（`- [category] 内容 #tag (context)`）+ relations（`- rel [[目标]]`）。
3. **纯文本无向量检索**：结构过滤 → 关键词加权匹配（title > permalink > tag > 正文）→ 时间倒序 → relation 一跳展开；配合写入纪律（由 LLM 在写入时将同义词收拢进 `title` 与 `tags`）共同保障召回质量。
4. **面向无锁 API 的冲突收敛**：版本判定统一采用文件内容 `sha1`（规避秒级 `mtime` 与跨端时钟误差），追加型变更按行并集合并，结构性冲突采用后写覆盖并将旧版完整归档至 `.conflict/`，每次写后执行回读校验。
5. **会话驱动的惰性刷新**：在插件激活、工具调用发现缓存超过 5 分钟以及每次写入完成后按需刷新，默认关闭后台定时轮询。
6. **API 能力分三档落地**：`seafile.rs` 已实现（基线可用）/ thufs 在同一实例已验证、待补封装（`update-link`、`file-uploaded-bytes` 断点续传、file/dir detail）/ 官方文档存在但清华实例待实测（`delete`、`rename`——首版采用软删除兼容方案，无硬性依赖）。
7. **权限与安全拦截**：新增 `memory:read` 与 `memory:write` 权限；所有写工具均走两段式确认（复用 `agent.rs` 既有确认流），并在引擎层通过正则硬性拦截 token、证件号与长串敏感数字。

## 三个重点技术风险（详表见各分册）

1. **无锁并发写窗口**：`read-merge-write` 可将并发覆盖窗口压缩至毫秒级（概率评估见 [03-sync-conflict.md](./03-sync-conflict.md) §4.1），再配合追加优先写入、行级并集合并与 `.conflict/` 归档兜底，确保数据可恢复。
2. **`delete`/`rename` 端点尚未在清华实例实测**：首版先行采用软删除与「下载+上传」兼容路径，待端点实测通过后再切换为原位移动与硬删。
3. **facade `learn` 命名空间待补 `download` 方法、`seafile.rs` 待补「读字节」内部变体**：Files Hub 源①采集与记忆镜像拉取均依赖这两处宿主侧转发补齐（保持现有协议，仅扩充内部方法），列为动手实现前的第一优先级。

## 对现有代码的改动面（实现阶段，全部「待 Lead 批准」）

| 位置 | 改动 | 性质 |
|---|---|---|
| `plugins/OneTHU-Harness/core/src/tools.rs` | 新增 memory_*/files_* 工具定义与执行 | 新增 |
| `plugins/OneTHU-Harness/manifest.json` | permissions 增 memory:read/write | 新增 |
| `plugins/OneTHU-Harness/core/src/agent.rs` | system_prompt 增记忆规范段 | 小改 |
| `apps/desktop/src/plugins/facade.ts` | 新 memory ns；learn ns 增 download | 新增+小改 |
| `apps/desktop/src-tauri/src/seafile.rs` | 增 seafile_read_bytes（内存版下载）/ update-link / 断点续传（可选 dir/file detail） | 新增函数 |
| 记忆引擎本体 | **已拍板（Lead，2026-10-09）：宿主 TS 侧实现**，core 薄转发；bot 网关若定 Rust 形态再复议 | 已定 |
