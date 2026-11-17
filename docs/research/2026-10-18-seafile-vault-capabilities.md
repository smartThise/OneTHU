# 清华云盘（Seafile）能力与暂存箱/口令落地调研（2026-10-18）


> 归档说明：本文记录当时的技术调研与方案评估；0.11 当前功能与使用指南请查阅 [文档入口](../README.md)（[English overview](../en/index.md)）。

> 本次只读调研基于 `35cef40f`，结论用于 `docs/plans/2026-10-18-organization-vault-share.md` 的 Phase 2+ 设计。
> 文中各项现状均已在仓库代码内复核，标记「待 live 验证」的条目需在正式开发前先跑通线上冒烟。

## 1. 现有能力盘点

Rust 端实现位于 `apps/desktop/src-tauri/src/seafile.rs`，TypeScript 状态层位于 `apps/desktop/src/state/seafile.ts`。

| 能力 | 现状 | 缺口/风险 |
|---|---|---|
| 账号/配额/资料库 | `seafile_account/repos`；可建库 | 仅返回总配额，缺少上传前容量预检 |
| 列目录/建目录 | `seafile_dir/mkdir` | 6 处调用各自逐级 `mkdir`，尚待收拢为统一封装 |
| 上传/覆写 | `seafile_upload/update_file`；整文件读入内存；`replace` 覆盖 | 缺少进度、取消与分片支持；`update_file` 暂无调用；同名 `replace` 直接覆盖，需另建内容级去重 |
| 断点续传 | `seafile_uploaded_bytes/upload_resume` 已实现 | 暂无调用；仍整文件读入内存；代码注释提示 `>200MB` 宜改为流式传输 |
| 下载/读字节 | `seafile_download/read_bytes`（调用方限制上限 48MB） | 整包读入内存，缺少进度反馈 |
| 删除/移动/改名 | `seafile_delete/move` | 直接永久删除、未接回收站；前端尚无改名入口 |
| **创建分享链接** | `seafile_share` 支持 `expire_days`、`password` | TS 侧固定传 `password:""`；CloudPage 传入 `0`（永久有效）但界面文案写为 7 天；**缺少查询、撤销与密码设置界面** |
| 库内搜索 | `seafile_search` | 存在一定索引延迟，整体可用 |
| 系统文件选择直传 | `seafile_pick_upload` | 目前仅向云盘页面开放 |
| 共享给用户/群组 | 暂未接入 | 好友共享云盘需新增对应 API 并完成线上实测 |
| 回收站/还原 | 暂未接入 | — |

插件门面目前开放了 6 个接口：`cloud.repos/list/search/download/upload/share`；其余 `mkdir`、`delete`、`move`、`read_bytes`、`pick_upload` 仅供宿主内部调用。

## 2. 现有同步模式可复用点

- **自动建库与同名复查**：`memory/sync.ts:34-52` 与 `wallpsync.ts:41-65` 的建库及二次核验流程可直接沿用。
- **轻量清单整包覆写**：参考 `wallpsync.ts:86-108` 将小型 JSON 清单以 `replace` 方式整文件上传；暂存箱为每个箱体维护一份 `manifest.json` 最为稳妥。
- **本地账本与哈希粗筛**：memory 模块已采用「本地账本 + 内容 sha1 + mtime」比对，不过其冲突策略固定信任远端较新版本、忽略删除同步且静默吞掉异常，暂存箱需在此基础上补齐显式冲突、删除传播与错误提示。
- **暂存确认提交流水线**：可参考 IM 附件的 `stage → 确认 → commit` 机制（`im/mediaPipe.ts`、`im/registry.ts`），并将待提交队列持久化落盘。
- **内存读取清单**：拉取远端 `manifest.json` 时直接走 `seafile_read_bytes`，避免落入系统 Downloads 目录污染用户文件。

## 3. 内容哈希与去重方案

- 仓库目前仅有面向文本的 WebCrypto SHA-1（`memory/format.ts:225-231`）以及 updater 内部自用的 Rust SHA-256（尚未对外暴露 Tauri 命令）。
- `vault.ts` 虽定义了 `file.hash` 与 `isDuplicate/fileHashIndex`，但尚无上游写入哈希值，去重逻辑暂未激活。
- Seafile 目录项 `id` 与上传返回的 `id` 目前均未保存，其是否对应底层内容 oid 仍待线上验证，去重体系宜建立在客户端可控的文件内容哈希之上。
- **落地建议**：在 Rust 端新增流式计算的 `file_sha256(path)` 命令，统一以 `sha256(bytes)` 作为去重键；上传前先检索本地哈希索引与云端 `_index/files.json`，命中后再直接复用已有对象引用，避免依赖同名 `replace` 盲目重传。

## 4. 分享链接生命周期（核心关注点）

- **现状**：目前已支持创建分享链接，后续需补齐分享列表查询、主动撤销与访问密码配置。
- **匿名访问边界**：`lib/updater.ts:224-255` 已验证凭借固定 share token 即可匿名请求目录项并通过 `/d/<token>/files/?p=…&dl=1` 执行 Range 下载——这意味着一旦分享链接外泄，持有链接者即可遍历并下载其中内容。
- **目录分享待测**：`seafile.rs:41-50` 留有目录分享可能返回 403 的注释，清华实例的实际策略需以线上实测为准。
- **备选方案（按优先级排序）**：① 将多文件打包为 zip 或单文件 manifest 再走已验证的单文件分享；② 逐个文件创建分享并将链接内联进清单；③ 仅将邮件作为通知提醒通道（避免用 GitLab 承载通用文件分发）。
- **开发前必测项**：创建目录分享、密码保护、到期天数、`DELETE /api/v2.1/share-links/<token>/` 主动撤销，以及链接过期后的访问响应。

## 5. 强制接入云盘的影响评估

目前唯一的手动断开入口位于 `CloudPage.tsx:614-623`（调用 `clearSeafileToken()`）。未连接云盘时，OH 记忆、主对话同步、壁纸同步、IM 附件、OH 云盘工具与邮件附件转存等 6 处能力会静默退化。此外，退出登录或切换校园账号时暂未同步清除云盘 token（`lib/clients.ts:645-668`），存在跨账号残留风险。

**建议策略**：已缓存内容保持离线可读，写入、分享与新增文件操作统一引导连接云盘；移除手动断开按钮，启动期静默连接失败时弹出显式的 `ConnectGate` 引导重连；账号退出或切换时同步清理云盘凭据与缓存。

## 6. 统一文件中转架构设计

由 `lib/fileChannel.ts`（前端唯一文件出口）、`state/transferQueue.ts`（持久化传输队列）与 Rust 侧 `lib.rs`/`transfer.rs` 协同构成完整流水线：
`文件来源 → stage（本地暂存 + 流式 sha256）→ 哈希去重 → 上传（带进度/取消/重试）→ 写入对象引用 → 清理本地暂存`。

Rust 端最小增量包括：`file_sha256`、带进度与取消令牌的流式上传、`share_link_list/delete`，以及可选的匿名分享读取命令 `share_read`。本地暂存统一放入应用缓存目录下的 `staging/<uuid>` 并配 TTL 定期清理，避免使用固定文件名造成并发覆盖。

## 7. 课程内容分享边界

- **课程基础信息**：支持分享课程 `id`、中英文名称、课号与任课教师。
- **作业条目**：仅分享作业 `id`、所属课程、`title`、截止时间（DDL）与作业类型；**作业正文（`content`）、个人提交内容、成绩、教师批语、答案附件及带会话态的 URL 均严格保留在本地**。
- **课程通知**：仅分享标题、发布者、发布时间与重要标记，通知正文与附件留在各自客户端拉取。
- **课程文件**：默认仅传递文件引用与元数据，只有当用户显式执行「存入我的云盘」时才经文件通道上传字节，同时在界面上提示尊重课件版权。
- **OJ 编程作业**：严守学术诚信红线，仅提供题目名称与截止时间的只读引用，绝不触碰代码提交与参考答案。
- **默认时效**：新建分享默认设为 7 天有效期，需要长期有效时再由用户主动调整。

## 8. 文本摘录与净化

- **HTML 转纯文本**：复用 `packages/core/src/info/htmltext.ts`；校内新闻直接取 `NewsDetail.plain`；HTML 邮件经 `stripTags` 提取正文。
- **本地文档预览**：调用 Rust `im_peek_text`（默认截取 400 字，上限 60k 字，超过 8MB 的文件直接跳过）。
- **选区与剪贴板**：选区检测复用 `ContextMenu.tsx` 的 `hasTextSelection()`，剪贴板读取需在显式用户手势内调用 `navigator.clipboard.readText()`。
- **净化与限长**：依次剥离 `script/style`、去除标签、解码 HTML 实体并折叠多余空白，全程只存纯文本；限制正文 `≤4KB`、标题 `≤120` 字、摘要 `≤512` 字，并结合来源指纹与 `sha256` 去重。
- **隐私防误触**：鉴于系统剪贴板可能暂存密码或验证码，剪贴板文本须经用户显式确认后再收入暂存箱。

## 9. 对象可拖性普查摘要

- **仅差标记属性**：搜索、邮件、新闻、课程、作业、通知、文件、体育、图书馆、研讨间、公共空间、空教室等模块均已使用 `CollectStar` 原子组件，本轮已在 `CollectStar` 上统一补齐 `data-vault-catch`。
- **需补充对象类型与稳定 key**：白板卡片（`boardId+itemId`）、日程（事件 `uid` 或合成 key）、设置项（`routeId`）、主题、壁纸、选课、插件、OnePage、邀请与个人名片。
- **待建系统级入口**：桌面系统文件拖入、剪贴板文件粘贴以及 Android `ACTION_SEND` 接收。
- **需纳入统一手势仲裁**：白板卡片（500ms 长按 / 4px 阈值）、标签条（300/500ms）、作业轮播横向滑动、底部 OH 胶囊（450ms）。

## 10. 风险汇总

| 级别 | 风险 |
|---|---|
| 高 | 分享链接尚缺撤销能力且过期表现待测；链接一旦外泄即可被匿名枚举下载 |
| 高 | 尚未接入文件内容哈希，去重未生效，易重复占用云盘配额 |
| 高 | 上传与下载均整文件读入内存，缺少进度展示与中途取消 |
| 高 | 改为强制接入云盘后，离线与弱网体验及现有 6 处静默退化需妥善衔接 |
| 高 | 切换校园账号时未同步清理云盘 token，存在跨账号数据串读隐患 |
| 高 | 课程课件与作业分享涉及版权合规及学术诚信边界 |
| 中 | 目录分享待实测；inline 口令可携带任意 payload/cloudPath；现有 FNV 校验仅作防误输纠错，尚缺密码学签名 |
| 中 | Android 端尚无系统分享接收入口；本地缓存目录存在被系统回收清理的可能 |

## 11. 下一步实施计划（Phase 2）

1. 优先落地 `file_sha256`、统一文件通道与持久化传输队列（此部分与分享撤销解耦，可先行推进）。
2. 在真实清华云盘环境跑通分享链接全生命周期冒烟；若目录分享畅通则直接实现基于目录的 `vaultCloud` 适配器，若受限则采用单文件 zip/manifest 方案。
3. 将口令协议升级至 `ONV2`：引入 `sha256` 摘要、过期时间、字段白名单与长度上限，载荷仅保留云盘引用，同时向下兼容读取 `ONV1`。
4. 单独安排强制云盘改造批次：下线手动断开入口、上线阻塞式连接引导、打通账号切换清理凭据，并补齐存量状态迁移提示。
5. 严格按第 7、8 节规范落地课程与文本分享，首期聚焦「仅分享元数据引用」。

## 实测补充（2026-10-18 01:2x，真实清华云盘账号）

使用真实账号 token 在 `OneTHU` 资料库上执行了线上冒烟（前端脚本 `tools/cloud-smoke-live.mjs`，Rust 侧单测 `seafile::tests::live_share_read_dir_and_file`）：

| 项 | 结果 |
|---|---|
| 目录分享 `POST /api/v2.1/share-links/ {path: dir}` | ✅ 成功，生成链接 `https://cloud.tsinghua.edu.cn/d/<token>/` |
| 匿名列目录 `/api/v2.1/share-links/<token>/dirents/?path=/` | ✅ 200，返回结构为 **`{"dirent_list":[{file_size,is_dir,file_name,file_path,...}]}`**（区别于早期假设的 `data`/`name`/`type` 字段） |
| 匿名下载 `/d/<token>/files/?p=/manifest.json&dl=1` | ✅ 内容完全一致 |
| 撤销分享后匿名访问 | ✅ 服务端正确拒绝访问 |
| 单文件分享 | 生成链接为 **`/f/<token>/`**；调 `dirents` 返回 400 `not a folder share link`，改走 `/d/<token>/files/?p=/&dl=1` 可直接拉取文件内容（Rust `seafile_share_read` 已兼容 `/f/` token 与单文件直读回退） |
| 目录递归删除 | ✅ `DELETE /api2/repos/<repo>/dir/?p=...` |

**方案定型**：清华云盘实例完整支持目录分享，`vaultCloud` 可直接以目录分享作为主路径；单文件分享留作目录分享受策略限制时的备选方案，读取时走单文件直读通道。`seafile_share_read` 已按实测的 `dirent_list` 响应结构、`/f/` 链接形态与单文件回退逻辑同步更新。底层 API 验证至此闭环，下一步跟进应用界面的端到端冒烟。

### App 层线上 UI 冒烟补充（同日）

通过 `tools/cloud-ui-live-test.mjs` 在浏览器环境桥接真实云盘命令，完整跑通了界面层的生成与导入流程：

- 定位并修复：`payloadFromVault` 早先剥离了 `stagedPath` 导致云适配器取不到待传文件；现调整为上传阶段保留该路径、上传完成后立即剔除。
- 定位并修复：清单上传时的临时文件名此前未对齐，现已统一在分享目录根部直接写入 `manifest.json`。
- 实测结果：云端分享目录完整生成 `files/` 与 `manifest.json`，第二个独立上下文导入后文件引用准确保留 `files/...` 相对路径，随后主动撤销分享并清理远端目录，9/9 项断言全部通过。
