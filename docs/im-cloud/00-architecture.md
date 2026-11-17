# 00 · OH 多通道 IM 接入架构建议（无后端形态）

> 归档说明：本文记录当时的多通道接入架构设计方案；0.11 当前功能与使用指南请查阅 [文档入口](../README.md)（[English overview](../en/index.md)）。

> 最后更新：2026-11-18 01:30
> 依据：本目录 01–06 平台调研 + OneTHU 现有架构（OH sidecar、`onethu.call` 门面、Seafile 集成）
> 核心结论：**通道层直接运行在桌面端 OneTHU App 的宿主 TS 层（桌面常驻期间机器人在线，退出即离线）；首期（P0）落地微信官方 iLink 与飞书长连接双通道；入站消息经 `callRust` 注入 OH（`agent.inject`），回复沿既有输出流原路发回（OH 出站零改动）；IM 文件经 `seafile.rs` 直接上传清华云盘并与 Files Hub 汇合。**

## 1. 设计目标与约束

| 目标 | 说明 |
| --- | --- |
| G1 IM 传入文件 → 清华云盘 | 核心需求；收到附件后立即转存 Seafile 并在回执中附带云盘链接，与 `dev-memory-cloud` 的 Files Hub 统一汇合 |
| G2 **无后端直连** | 纯本地运行，免除 NAS 或云端服务器部署维护成本；以桌面端 App 为唯一运行载体，机器人在线状态随桌面端生命周期同步（详见 §6） |
| G3 OH 集中推理 | 通道层专注于消息收发与协议转换，模型推理与校园工具调用全部交由 OH 统一处理，继续受 `onethu.call` 权限门禁保护 |
| G4 多用户安全 | IM 身份与 OneTHU 账号显式绑定，配合私聊白名单过滤；各通道凭据按账号隔离保存在本机安全存储中 |
| G5 最小侵入 | OneTHU-Harness 侧仅新增一个 `agent.inject` JSON-RPC 方法，主仓库新增独立的 `im` 模块 |

方案范围聚焦于桌面端直连、私聊与群内 @ 提及触发，以及各平台官方合规接口接入（非官方协议风险详见各平台分篇）。

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

### 2.1 为什么通道层放在宿主 TS 层

1. **生命周期天然一致**：通道登录态（飞书 WebSocket 连接、微信 `bot_token` 与长轮询游标）随客户端实例驻留，无后端架构下桌面宿主 TS 层正是常驻执行环境。
2. **协议生态成熟**：飞书官方 Node SDK 原生内建长连接；微信 iLink 协议面精简（二维码轮询 + `getupdates` + AES-ECB CDN），可直接对照腾讯开源的 TS 参考实现（`Tencent/openclaw-weixin`，MIT）移植；Telegram 也有成熟的 grammY 与 telegraf 生态，比用 Rust 从头手写协议客户端效率更高。
3. **出站零改动**：通道位于 JS 层，`loader.ts` 既有运行闭包的回复流原本就会回到 JS——im core 只需捕获最终回复并按 `return_route` 原路发回对应会话，**OH 核心无需新增任何出站适配逻辑**。
4. **文件链路最短**：附件字节流在 JS 层接收后直接经 `callRust` 调用 `seafile.rs` 上传，数据流全程留在本地应用内，并与 Files Hub（`dev-memory-cloud`）直接共用上传、目录组织与分享逻辑。

### 2.2 消息链路

- **入站**：适配器收到平台事件 → im core 完成白名单与绑定校验、会话映射和事件去重 → 调用 `callRust('harness_agent_inject', {session_key, text, attachments:[云盘链接]})` → sidecar `agent.inject` 创建或续接运行。附件先行转存 Seafile，向 prompt 注入云盘链接；Agent 需要读取文件内容时，直接通过既有云盘工具拉取。
- **出站（被动回复）**：运行结束后的最终回复文本流回 JS → im core 按目标通道能力自动降级（交互卡片 → Markdown → 纯文本分片）→ 交由对应适配器发回。
- **出站（主动推送，P1 可选）**：后续若需支持 Agent 在工具执行中途或跨会话主动发消息，可将 im core 封装为 MCP server（`im_send`）挂载至 OH `mcp.rs`；首期被动回复已能覆盖常规对话，该能力留作扩展点。
- **运维命令**：`/bind`、`/reset`、`/me`（查询当前平台身份 ID 以便配置白名单）由 im core 层直接拦截响应，无需唤醒底层 Agent。

### 2.3 与 OneTHU 主仓的关系

- im core 与各通道适配器作为 **主仓库 `apps/desktop/src/im/` 下的内建模块**随桌面端一体构建；微信 iLink 协议层可拆分为 `packages/` 子包以便独立编写单元测试。
- OneTHU-Harness 侧唯一改动：新增 `agent.inject` JSON-RPC 方法（接收会话键与注入文本，限定本机宿主调用并校验 sidecar 父进程链）。
- 通道凭据与身份绑定表保存在本机应用数据目录中（复用主仓现有凭据管理方案，敏感密钥存入系统 Keychain 等安全设施），**全部密钥均由用户本机自持**，从源头规避了云端集中托管凭据的安全风险。

## 3. 通道适配器契约（借鉴 openclaw，TS 化）

整体遵循 **core 统一管控策略、适配器专注协议转换** 的分层原则：所有访问控制与白名单校验均收口在 core 层集中执行，避免单个适配器遗漏鉴权（参见 openclaw 微信插件 2.4.8 因空 allowlist 放行任意发送者的案例，详见 [01 §1.4](01-wechat.md)）。

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

core 核心组件包括：`SessionRouter`（`session_key` 与 OH 会话映射）、`PairingStore`（平台用户与 OneTHU 账号绑定关系，持久化至本机数据目录）、`MediaStore`（统一媒体暂存目录）、`CloudSink`（经 `callRust` 编排 Seafile 上传）以及 `RateLimiter`。桌面直连形态下，入站队列可直接在内存中维护，本地仅需持久化身份绑定表与各通道同步游标，断线重连后按各平台协议能力拉取增量消息（详见 §6）。

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

**文件管线（G1）**：收到入站附件 → `fetchAttachment()` 流式写入本地 `MediaStore` → `callRust` 调用 Seafile 上传至 `/im-import/<channel>/<YYYY-MM-DD>/` → 回复确认回执「已存云盘：<分享链接>」→ **与 Files Hub 的入库事件汇合**。出站发送文件若超出对应通道上限（微信约 100 MiB 待实测 / 飞书约 30 MB 待实测 / QQ 官方暂未开放通用文件 / Telegram 入站 20 MB、出站 50 MB），会自动切换为发送云盘分享链接。

## 5. 逐通道无后端可行性（主案视角）

| 通道 | 无后端可行性 | 依据 |
| --- | --- | --- |
| **飞书** | ✅ 理想 | WebSocket 长连接订阅事件，纯出站通信、免公网入口（[05](05-feishu.md)）；官方 Node SDK 原生支持 |
| **微信官方 iLink** | ✅ 理想 | HTTP 长轮询纯出站通信（[01](01-wechat.md)）；TS 协议实现轻量清晰 |
| Telegram | ✅ 可用（自选） | `getUpdates` 长轮询纯出站；受境内网络环境影响需配置代理，列为 P2 用户自选（[06](06-telegram.md)） |
| 企业微信 | ❌ 暂缓接入 | 接收消息依赖公网 Webhook 回调，桌面端直连环境无法直接接收；后续仅视需求评估纯出站的「单向通知」模式（[03](03-wecom.md)） |
| QQ 官方 bot | ✅ 技术可行，列为 P2 | WebSocket 纯出站连接契合桌面端运行，受限于平台停发主动消息且暂未开放通用文件传输，列为 P2 备选（[04](04-qq.md)） |
| 非官方协议 | — 不予集成 | 存在较高的平台风控与账号封禁风险（[01 §3](01-wechat.md)、[04 §2](04-qq.md)） |

首期（P0）组合确定为 **飞书 + 微信 iLink 双通道**，兼顾深度交互能力与校园日常覆盖面。

## 6. 在线状态与运行边界

- **在线生命周期与桌面端同步**：OneTHU 桌面端运行期间，IM 机器人保持在线；电脑关机、进入系统休眠或合盖睡眠时，通道连接会随之挂起。
- **断线重连与离线消息处理**：不同平台对离线期间消息的保留策略存在差异——Telegram 的 `getUpdates` 游标机制支持重连后拉取约 24 小时内的积压消息；飞书长连接断线期间的事件补推机制，以及微信 iLink 离线消息保留时长与 `get_updates_buf` 游标行为仍有待实测确认。应用重新联网上线后，im core 会主动执行 `probe` 探活，并在界面提示离线期间可能存在消息遗漏；对到达率要求较高的关键提醒，统一走应用原生通知渠道。
- **桌面常驻辅助选项**：桌面端可支持最小化到系统托盘后台常驻，并提供默认关闭的「通道保活」可选开关（借助 macOS `caffeinate` 唤醒锁或 Windows `SetThreadExecutionState` 阻止自动休眠，由用户按功耗偏好自主开启）。
- **移动端与桌面端职责分工**：受移动端系统休眠（Doze）与厂商后台管控策略影响，长连接通道适配器集中在桌面端宿主 TS 层运行；Android 端专注于提供流畅的应用内直接对话体验。
- **异常隔离与稳定性保障**：由于通道适配器运行在桌面应用内部，需防止单通道协议异常波及主界面。各适配器通过独立的 Worker 或模块边界与宿主隔离，一旦发生未预期错误仅自动停用对应通道并提示用户，同时在 im core 层提供一键全局停用开关。

## 7. 分期路线

- **P0**：搭建 `apps/desktop/src/im/` 核心骨架（core + 飞书适配器 + 微信 iLink 适配器）、实现 `/bind` 限时绑定、打通「接收文件 → Seafile → Files Hub」管线、合入 OH `agent.inject` 入站接口、上线设置页通道管理面板（登录态、白名单与连接状态）。
- **P1**：支持飞书流式卡片原地更新、接入 Telegram 自选通道、支持单通道多账号挂载，并按需评估企业微信单向推送通知模式。
- **P2**：探索 QQ 官方通道轻量通知与群助手场景，预留 `im_send` MCP 主动发消息扩展能力。

## 8. 风险清单

| # | 风险 | 等级 | 缓解 |
| --- | --- | --- | --- |
| R1 | 微信 iLink 灰度未覆盖或平台频控收紧（配额调整、`-14` 频发） | 中 | 引导受影响用户切换飞书通道；协议层独立封装以便快速跟进腾讯 MIT 源码更新；完善扫码重连引导与状态提醒 |
| R2 | 通道访问控制疏漏导致未授权用户触达（openclaw 2.4.8 案例） | 高（安全） | 白名单与身份绑定统一收口至 im core 强制校验；默认启用 allowlist + `/bind` 显式绑定；上线前完成未授权触达专项测试 |
| R3 | 桌面离线期间遗漏消息（各通道补收表现待实测，见 §6） | 中 | 上线前实测各通道断线重连表现；界面清晰说明桌面端在线运行机制；重要提醒走应用原生推送 |
| R4 | 单通道异常波及桌面应用稳定性 | 中 | 适配器置于 Worker 隔离边界运行；单通道连续异常自动熔断停用；提供全局一键关闭开关 |
| R5 | IM 回复明文包含成绩、学号等敏感信息引发泄露或触发平台过滤 | 中 | 出站回复对敏感字段做摘要脱敏，完整详情引导用户在 OneTHU 应用内查看 |
| R6 | 本机通道凭据安全保护（`bot_token` / `app_secret` / Seafile token） | 中 | 接入系统 Keychain 安全存储，全程加密保存；支持按单通道独立吊销凭据并重新扫码授权 |
| R7 | Telegram 代理配置门槛与合规边界 | 中 | 列为默认关闭的 P2 自选通道，并在设置文档中清晰说明网络环境要求 |
| R8 | `agent.inject` 接口被未授权本地进程调用 | 低（本机） | 调用入口限定在宿主内部 `callRust` 同进程链路，sidecar 校验父进程调用方身份；未来若扩展远程注入再引入设备配对签名 |
| R9 | 第三方平台 API 规则变动（飞书限频、QQ 富媒体开放策略等） | 低-中 | 适配器分层解耦 + `probe` 定期健康检查 + 新能力先行小范围灰度 |

## 附录 A · 早期方案留档：独立 Rust 网关 OneTHU-IM（备查）

早期方案要点（详见 git 历史 `4bc3ecd` 版本）：构建独立的 Rust 网关守护进程，以 git submodule 形式挂载于 `plugins/OneTHU-IM/`（延续 OneTHU-Harness 的组织方式），容器化部署在绿联 NAS DXP2800 Docker 环境，再通过 WebSocket 与桌面端 OH 通信。结合纯本地轻量部署的产品定位，团队最终确立了本文的桌面端直连主案，将独立网关设计留档备查：

- 若后续衍生出多用户共享、7×24 小时离线代收或移动端远程接入等服务端场景，早期方案中的进程隔离、持久化入站队列（durable ingress）与凭据管理设计可直接复用；本文 §3 的 TS 适配器契约与原方案保持同构，便于跨语言平滑迁移。
- 独立网关涉及的云端凭据集中存储与企业微信公网回调暴露面等问题，在当前桌面端直连架构下已自然消解。

## 参考

- 平台细节见本目录 [01 微信](01-wechat.md) ｜ [02 openclaw](02-openclaw-architecture.md) ｜ [03 企微](03-wecom.md) ｜ [04 QQ](04-qq.md) ｜ [05 飞书](05-feishu.md) ｜ [06 Telegram](06-telegram.md)
- openclaw：[Gateway architecture](https://docs.openclaw.ai/concepts/architecture) ｜ [Building channel plugins](https://docs.openclaw.ai/plugins/sdk-channel-plugins)
- zcode：[Bot Channel 文档](https://zcode.z.ai/cn/docs/bot-channel) ｜ [zai-org/ZCode](https://github.com/zai-org/ZCode)
