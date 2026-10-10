# 00 · OH 多通道 IM 接入架构建议（无后端形态）

> 最后更新：2026-10-09（修订版：用户拍板**否决任何后端网关**，NAS/服务器形态出局；本文为「无后端形态」主案，原独立网关方案移至附录 A 留档）
> 依据：本目录 01–06 平台调研 + OneTHU 现状（OH sidecar、onethu.call 门面、seafile 集成）
> 一句话结论：**通道层直接跑在桌面 OneTHU App 的宿主 TS 层（App 常驻=bot 在线，关机即离线）；P0 落 微信官方 iLink + 飞书长连接 双通道；入站消息经 callRust 注入 OH（`agent.inject`），回复原路发回（出站零 OH 改动）；IM 文件直接经 seafile.rs 上云盘，与 Files Hub 汇合。**

## 1. 设计目标与约束

| 目标 | 说明 |
| --- | --- |
| G1 IM 传入文件 → 清华云盘 | 硬需求；统一「收到即转存 seafile，回执带链接」，与 dev-memory-cloud 的 Files Hub 汇合 |
| G2 **无后端**（用户拍板） | 不部署任何 NAS/服务器网关；桌面 App 是唯一运行载体，接受「bot 在线=桌面开机」的代价（见 §6） |
| G3 OH 是唯一 agent | 通道层不跑 LLM、不执行校园工具；工具仍经 onethu.call 门禁 |
| G4 多用户安全 | IM 身份 ↔ OneTHU 身份显式绑定；DM 白名单；通道凭据按账号隔离存本机 |
| G5 最小侵入 | OneTHU-Harness 侧改动收敛为一个新增 JSON-RPC method（`agent.inject`）；主仓新增 im 模块 |

明确非目标：后端网关（已否决）、群聊全量消息处理（仅 @ 触发）、非官方协议默认集成（见各平台篇风险）。

## 2. 主案：桌面 App 直连承载通道

```
┌─ OneTHU 桌面 App（macOS / Windows；App 常驻 ⇒ bot 在线，退出 ⇒ 离线）─┐
│ webview（React + 宿主 TS 层）                                          │
│  ┌ im/ core（TS，新增主仓模块）────────────────────────────┐          │
│  │ · 绑定/白名单/会话映射（/bind 限时码，借鉴 zcode）        │          │
│  │ · 限速（令牌桶）+ 出站幂等 + 分片降级（markdown→纯文本）   │          │
│  │ · 媒体收口（App 数据目录）+ seafile 转存编排              │          │
│  │ └ 通道适配器（各持平台登录态）：                          │          │
│  │    ├ adapter-feishu   WS 长连接（官方 oapi-sdk-nodejs）   │          │
│  │    ├ adapter-wechat   HTTP 长轮询（iLink 协议 TS 实现）    │          │
│  │    └ adapter-tg / adapter-qqbot（可选，P2）               │          │
│  └ seafile 上传：callRust → src-tauri/seafile.rs（复用现有集成）│        │
│ src-tauri（Rust 宿主）                                              │      │
│  └ onethu.harness sidecar（stdio JSON-RPC）                         │      │
│      · 入站：agent.inject(session_key, text, 附件云盘链接)  ← 新增    │      │
│      · 出站：回复经既有 run 输出流回 JS → im core 原路发回（零改动）   │      │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.1 为什么通道层放宿主 TS 层

1. **生命周期一致**：通道登录态（飞书 WS、微信 bot_token 长轮询游标）本就要求「App 在哪、bot 在哪」；无后端形态下宿主 TS 层是唯一常驻执行环境。
2. **协议生态**：飞书长连接官方 Node SDK 内建；微信 iLink 协议面小（QR 轮询 + getupdates + AES-ECB CDN），TS 参考实现（Tencent/openclaw-weixin，MIT）可直接对照移植；TG 有 grammY/telegraf。Rust 反而都要手写。
3. **出站零改动**：通道在 JS 层，`loader.ts` 既有 run 闭包的回复流天然回到 JS——im core 截获最终回复按 `return_route` 发回原会话即可，**OH 核心不用为出站做任何事**。
4. **文件链路最短**：附件字节流在 JS 层 → `callRust` → `seafile.rs` 上传，全程不离开 App，与 Files Hub（dev-memory-cloud）共用上传/目录/分享逻辑。

### 2.2 消息链路

- **入站**：适配器收到平台事件 → im core（白名单/绑定校验、会话映射、去重）→ `callRust('harness_agent_inject', {session_key, text, attachments:[云盘链接]})` → sidecar `agent.inject` 创建/续接 run。附件先转存 seafile，注入 prompt 的是链接；agent 需要内容时经既有云盘工具拉取。
- **出站（被动回复）**：run 最终回复文本回 JS → im core 按通道能力降级（卡片→markdown→纯文本分片）→ 适配器发回。
- **出站（主动，可选 P1）**：若要 agent 在工具调用中途/跨会话主动发消息，再把 im core 包成 MCP server（`im_send`）挂进 OH `mcp.rs`——主路径不需要，留作扩展点。
- **运维命令**：`/bind`、`/reset`、`/me`（查平台 ID 配白名单）在 im core 层终结，不打扰 agent。

### 2.3 与 OneTHU 主仓的关系（修订）

- im core 与适配器是 **主仓 `apps/desktop/src/im/` 的新模块**（无独立部署单元，不值得独立仓库）；微信 iLink 协议实现可拆 `packages/` 子包便于单测。
- OneTHU-Harness 侧唯一改动：新增 `agent.inject` JSON-RPC method（含会话键与注入文本；来源仅本机宿主，校验调用方为 sidecar 父进程链）。
- 通道凭据/绑定表存 App 本机数据目录（复用主仓既有凭据存储策略，敏感项走系统 Keychain 类设施），**不产生任何集中式凭据托管**（对比附录 A 的 R3，风险面显著缩小）。

## 3. 通道适配器契约（借鉴 openclaw，TS 化）

核心思想不变：**core 持策略 / 适配器持翻译**（安全策略只在 core，适配器不能自判放行——openclaw 微信插件 2.4.8 空 allowlist 放行任意 sender 的教训，见 [01 §1.4](01-wechat.md)）。

```ts
interface ChannelManifest {
  id: "wechat-ilink" | "feishu" | "telegram" | "qqbot";
  chatTypes: ChatTypes;               // DM / GROUP_MENTION / GROUP_ALL
  caps: Caps;                         // EDIT / TYPING / BUTTONS / FILE_IN / FILE_OUT …
  rateProfile: RateProfile;           // 令牌桶 + 平台特例（如微信 ret==-14 暂停 1h）
  configSchema: JSONSchema;           // 账号配置（设置页自动渲染）
}
interface ChannelAdapter {
  start(acct: AccountId, ctx: AdapterCtx): Promise<void>;
  stop(acct: AccountId): Promise<void>;
  probe(acct: AccountId): AccountStatus;          // 只读诊断（连通性/登录态）
  loginChallenge(acct: AccountId): LoginFlow;     // QR / URL / bind-code
  send(acct: AccountId, out: Outbound, key: IdempotencyKey): Promise<MsgReceipt>;
  fetchAttachment(a: AttachmentRef): Promise<ReadableStream<byte>>;  // 收到即转存
}
// 入站：适配器把原始事件投 ctx.ingest()；core 负责去重/入队/派发/注入 OH
```

core 组件：`SessionRouter`（session_key ↔ OH 会话）、`PairingStore`（平台用户 ↔ OneTHU 账号绑定，落盘 App 数据目录）、`MediaStore`（单一媒体目录）、`CloudSink`（seafile 上传编排，走 callRust）、`RateLimiter`。桌面形态下 durable ingress 轻量化：入站队列内存即可（App 离线本就无消息），持久化的只有绑定表与各通道游标，断线重连后按通道能力补收（见 §6）。

## 4. 统一消息与文件模型

```ts
type InboundMessage = {
  eventId: string;                    // 平台事件 ID（幂等去重键）
  channel: ChannelId; account: AccountId;
  chat: { kind: "dm" | "group" | "topic"; id: string };
  sender: SenderRef;                  // 平台稳定 ID（ilink_user_id / open_id …）
  text: string; mentions: SenderRef[];
  attachments: Attachment[];          // {kind, name, size, ref}
  replyTo?: MsgId; ts: number;
};
type OutboundMessage = {
  chat: ChatRef; text: Markdown;      // core 按通道 caps 降级
  files: Array<{ local: Path } | { cloudLink: ShareUrl }>;  // 按通道限额自动二选一
  replyTo?: MsgId; editTarget?: MsgId; // 流式原地更新（飞书卡片 / TG editMessage）
};
```

**文件管线（G1）**：入站 attachment → `fetchAttachment()` 流式落 `MediaStore` → `callRust(seafile 上传)` → `/im-import/<channel>/<YYYY-MM-DD>/` → 回执「已存云盘：<分享链接>」→ **与 Files Hub 的入库事件汇合**。出站文件 > 通道限额（微信 ~100MiB 待验证 / 飞书 ~30MB 待验证 / QQ 官方不支持 / TG 入 20MB 出 50MB）自动改发云盘分享链接。

## 5. 逐通道无后端可行性（主案视角）

| 通道 | 无后端可行性 | 依据 |
| --- | --- | --- |
| **飞书** | ✅ 理想 | WS 长连接事件订阅，纯出站、免公网入口（[05](05-feishu.md)）；官方 Node SDK 内建长连接 |
| **微信官方 iLink** | ✅ 理想 | HTTP 长轮询纯出站（[01](01-wechat.md)）；TS 移植协议面小 |
| Telegram | ✅ 可用（自选） | getUpdates 长轮询纯出站；**大陆网络约束不变**（App 内代理配置），P2 用户自选（[06](06-telegram.md)） |
| 企业微信 | ❌ 出局（或降级单向推送） | 收消息回调需公网入口，无后端形态不可达；仅保留主动推送的「单向通知」降级形态，价值有限，默认不做（[03](03-wecom.md)） |
| QQ 官方 bot | ✅ 技术可行，维持 P2 不默认 | WS 纯出站技术上无障碍，但主动消息停发 + 文件不开放的硬伤不变（[04](04-qq.md)） |
| 非官方协议 | — 不默认集成 | 与形态无关的封号风险（[01 §3](01-wechat.md)、[04 §2](04-qq.md)） |

P0 = 飞书 + 微信 iLink 双通道（两者恰好也是能力/覆盖互补：飞书=能力标杆，微信=学生覆盖）。

## 6. 常驻性权衡（用户已接受，如实记录）

- **bot 在线 = 桌面开机并运行 OneTHU**：关机/睡眠即离线。macOS 合盖、Windows 休眠都会断开通道连接。
- **离线期间的消息怎么办**：各通道补收能力不一——TG `getUpdates` 游标式可补收（服务端保留约 24h）；飞书长连接断开期间的事件投递、微信 iLink 离线期间消息的服务端保留时长均**待验证**（飞书长连接重连后是否补推、微信 `get_updates_buf` 游标重置行为）。缓解：重新上线后 im core 主动 `probe` + 提示用户「离线期间消息可能缺失」；对确定性要求高的通知走 App 推送而非 IM 通道。
- **缓解手段（可选，不承诺）**：桌面托盘常驻（关闭窗口不退出）；可选「通道保活」开关——macOS `caffeinate` 类唤醒锁 / Windows `SetThreadExecutionState` 防睡眠，代价是功耗，默认关。
- **Android 不作为通道载体**：DOZE/厂商后台查杀使常驻不可靠，通道适配器只编入桌面宿主 TS 层；Android 端维持「App 内对话 OH」形态，IM 通道不在其上承载。
- **稳定性新代价（相对附录 A 的反转）**：通道协议崩溃从「独立进程故障」变为「App 内故障」。缓解：适配器运行在隔离的 Worker/模块边界，异常只禁用该通道并通知用户，im core 整体提供一键全关开关。

## 7. 分期路线（修订）

- **P0**：`apps/desktop/src/im/` 骨架（core + feishu + wechat-ilink 适配器）、`/bind` 绑定、文件→seafile→Files Hub 管线、OH `agent.inject`（唯一 harness PR）、设置页通道管理（登录态/白名单/状态）。
- **P1**：流式卡片（飞书原地编辑）、TG 自选通道、多账号、（评估）企微单向推送降级形态。
- **P2**：QQ 官方弱通知；`im_send` MCP 主动消息扩展点。

## 8. 风险清单（修订）

| # | 风险 | 等级 | 缓解 |
| --- | --- | --- | --- |
| R1 | 微信 iLink 灰度未覆盖 / 政策收紧（配额、-14 频发） | 中 | 引导走飞书；协议层隔离便于跟进腾讯 MIT 源码追更；扫码重连 UX 与状态通知 |
| R2 | 通道访问控制缺陷被白名单外用户触达（openclaw 2.4.8 教训） | 高（安全） | 白名单/绑定只在 im core；默认 allowlist + `/bind` 显式绑定；上线前做未授权触达测试 |
| R3 | 离线消息丢失（各通道补收能力未验证，§6） | 中 | 上线前实测补收行为；UI 明示「桌面在线才可靠」；重要通知走 App 推送 |
| R4 | 通道故障影响 App 稳定性（无进程隔离） | 中 | 适配器 Worker 边界隔离；单通道异常自动禁用；全局开关 |
| R5 | IM 明文回显敏感数据（成绩/学号）触发审查或泄露 | 中 | 回复脱敏；敏感详情引导 App 内查看 |
| R6 | 桌面凭据本地保护（bot_token / app_secret / seafile token） | 中 | 系统 Keychain 类存储；不落明文；泄漏可单独吊销重扫 |
| R7 | TG 代理依赖与合规 | 中 | P2 自选，默认关闭，文档明示 |
| R8 | `agent.inject` 被滥用调用 | 低（本机） | 来源仅限宿主 callRust（同进程链路）；sidecar 校验调用方；未来若开放远程注入再引入设备配对鉴权 |
| R9 | 平台 API 变更（飞书限频、QQ 富媒体政策等） | 低-中 | 适配器隔离 + probe 探活 + 灰度通道先试 |

## 附录 A · 已否决方案留档：独立 Rust 网关 OneTHU-IM（2026-10-09 用户否决，仅备查）

原主案要点（详见 git 历史 4bc3ecd 版本）：独立 Rust 网关进程，git submodule 挂 `plugins/OneTHU-IM/`（对齐 OneTHU-Harness 先例），部署于绿联 NAS DXP2800 Docker，经 WS 与桌面 OH 对接（「NAS 回注桌面」形态）。否决原因：**用户不接受任何后端**。留档价值：

- 若未来恢复服务端形态（如多用户/离线补收/Android 载体需求变化），该方案的进程隔离、durable ingress、集中凭据托管设计仍可复用；本主案 §3 的适配器契约与其同构（TS↔Rust 可平移）。
- 原方案特有的风险项（云端凭据集中、企微公网回调面）随否决一并消失，不在本清单内。

## 参考

- 平台细节见本目录 [01 微信](01-wechat.md) ｜ [02 openclaw](02-openclaw-architecture.md) ｜ [03 企微](03-wecom.md) ｜ [04 QQ](04-qq.md) ｜ [05 飞书](05-feishu.md) ｜ [06 Telegram](06-telegram.md)
- openclaw：[Gateway architecture](https://docs.openclaw.ai/concepts/architecture) ｜ [Building channel plugins](https://docs.openclaw.ai/plugins/sdk-channel-plugins)
- zcode：[Bot Channel 文档](https://zcode.z.ai/cn/docs/bot-channel) ｜ [zai-org/ZCode](https://github.com/zai-org/ZCode)
