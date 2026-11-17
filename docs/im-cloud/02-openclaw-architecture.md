# openclaw 网关/适配器架构调研（附 zcode 通道层）

> 归档说明：本文记录当时的 openclaw 与 ZCode 通道架构调研；0.11 当前功能与使用指南请查阅 [文档入口](../README.md)（[English overview](../en/index.md)）。

> 最后更新：2026-11-18 01:30
> openclaw 前身为 clawdbot（Peter Steinberger 发起的开源项目，2026 年初走红后因商标原因更名为 openclaw，版本号采用日期制 `2026.x`），是目前个人 AI Agent 多通道接入领域最具代表性的参考架构。

## 1. 总体形态：单网关守护进程 + WebSocket 控制面

来源：[Gateway architecture](https://docs.openclaw.ai/concepts/architecture)。

```
┌─ Gateway（每主机一个，常驻守护进程，默认 127.0.0.1:18789）────────┐
│  持有全部消息面连接：                                                │
│   WhatsApp(Baileys) / Telegram(grammY) / Slack / Discord /          │
│   Signal / iMessage / Matrix / Teams / Feishu / IRC / ...           │
│   外部插件：WeChat(iLink) / QQ bot / WeCom（腾讯各团队官方维护）       │
│  对外暴露：                                                          │
│   · WS API（控制面：macOS app / CLI / Web UI / 自动化）               │
│   · WS API（node 面：role:"node" 的设备，带 caps/commands 能力声明）   │
│   · HTTP（WebChat 托管面 /feishu/events 等 webhook 共用同端口）        │
└──────────────────────────────────────────────────────────────────────┘
```

其中几项核心设计决策对 OneTHU 极具参考价值：

1. **单网关独占全部 IM 会话**（"One Gateway per host. It is the only place that opens a WhatsApp session."）：将登录态、长轮询游标与 WebSocket 长连接统一收口到单一宿主实例管理，避免多处同时登录引发互踢或游标错乱。
2. **控制面协议**：采用 WebSocket JSON 文本帧。连接建立后首帧必须完成 `connect` 握手，随后交互分为 `req/res` 请求响应（`{type:"req", id, method, params}` → `{type:"res", id, ok, payload|error}`）与单向事件推送（`{type:"event", event, payload}`）。**带有副作用的方法（如 `send`、`agent`）强制要求携带幂等键**，由服务端在时间窗口内自动去重。
3. **分层鉴权机制**：本机回环地址连接可自动放行；局域网或 Tailnet 访问需完成显式设备配对审批（基于设备身份与 challenge 签名颁发设备 token）；`gateway.auth.*`（支持 shared secret、Tailscale Serve、trusted-proxy、none）统一管控所有接入连接。远程访问推荐使用 Tailscale 或 SSH 隧道加密转发，避免直接将网关端口暴露在公网。
4. **控制面事件轻量通知**（"Events are not replayed. Clients must refresh on gaps."）：实时事件流仅承担变更通知职责，完整状态以网关内部持久化存储为准，客户端断线重连后主动拉取最新状态即可。
5. **契约先行代码生成**：通过 TypeBox 定义协议结构，自动导出 JSON Schema 并生成 Swift 与 TypeScript 数据模型，保证跨端类型严格对齐。

## 2. 渠道插件契约（核心抽象）

来源：[Building channel plugins](https://docs.openclaw.ai/plugins/sdk-channel-plugins)。

### 2.1 职责切分：core 与 channel plugin

openclaw 多通道抽象最核心的设计价值在于清晰的**职责边界划分**：

| 归 core（框架） | 归 channel plugin（适配器） |
| --- | --- |
| 共享 `message` 工具（Agent 统一发消息出口） | **Config**：账号配置解析与设置向导 |
| prompt 组装接线、外层 `session-key` 规范 | **Security**：DM 访问策略与 allowlist 声明 |
| 通用会话线程记账与消息派发 | **Pairing**：DM 配对码下发与批准流程 |
| 群聊参与者选择、追问轮次与 turn 预算管理 | **Session grammar**：平台原始会话 ID 到 chat/thread/parent 的映射 |
| 模型选择器等产品交互指令的统一编码 | **Outbound**：`sendText` / `sendMedia` / 长文本分片（chunker） |
| 速率限制、失败重试、每会话串行消息队列 | **Threading**：平台内回复引用与线程串联方式 |
| | **Typing/heartbeat**：正在输入等状态信号 |
| | **Formatting contract**：平台富文本与 Markdown 格式转换 |

通过这一划分，**适配器专注于各平台的协议读写与格式转换，而访问控制、发送限流、会话串联等核心策略全部收口在框架层统一执行**。这样既能保证 30 余种通道的交互行为一致，也能确保安全策略在全局层面得到严格落实。

### 2.2 插件形态

- 以独立 npm 包配合 `openclaw.plugin.json` 清单分发（`channels` 字段声明所托管的通道，`channelConfigs.<id>.schema` 声明账号配置 Schema 与界面渲染提示）。
- 运行时按需从 `openclaw/plugin-sdk/*` 子路径（`channel-core`、`channel-outbound`、`channel-contract`、`fetch-runtime` 等）引入带版本约束的能力接口，并支持声明最低宿主版本要求（如微信官方插件要求宿主 `>=2026.5.12`）。
- 提供 `createChatChannelPlugin()` 辅助函数，支持通过声明式配置项（`security.dm`、`pairing.text`、`threading`、`outbound.attachedResults` 等）快速组装标准适配器，也允许直接传入底层 adapter 对象精细接管。
- 具备完整的渠道生命周期钩子：涵盖账号启停（`notifyStart/Stop`）、运行状态上报（`setStatus`）与同步只读健康诊断（`inspectAccount`）。

### 2.3 可靠性语义

- **持久化入站队列（Durable ingress）**：收到平台事件后先落盘持久化，再推进消费游标（例如 QQ bot 插件文档明确说明「先持久化原始事件再推进 resume 序列，进程重启后未完成的待处理 turn 自动恢复，配合事件 ID 去重实现至少一次投递」）。
- **至少一次投递 + 幂等去重**：各通道统一按 at-least-once 语义接入，依托平台下发的 `event_id`、`uuid` 或 `msg_id + seq` 组合键执行去重。
- **按会话（per-peer）串行队列**：同一会话的消息严格按序串行处理；队列达到上限时优先丢弃机器人自身发出的辅助消息，尽量保留用户输入；群聊短时间内的密集发言可自动合并为单次带发言人归属的上下文输入。
- **统一媒体收口目录**（`~/.openclaw/media/<channel>`）：附件上传、下载与转码缓存集中管理，便于定期清理与转存。
- **速率限制**：框架层提供按通道维度的限速配置与 `limits` 配额优化指南（例如飞书通道设有专门的 message limits 与配额优化文档），具体平台的底层节流队列（如 Twitch 借助 Twurple 队列避免触发 429）则由各通道协同配合。

### 2.4 会话与访问控制模型

- **Pairing 配对机制**：陌生私聊联系人默认需通过配对码审批（文本配对码经当前 IM 私聊发送，确认后写入本地 SQLite）；openclaw 微信插件 2.4.8 版本因遗漏 pairing 适配器而在特定条件下放行任意发送者，正是值得警惕的前车之鉴（详见 [01 篇 §1.4](01-wechat.md)）。
- **私聊与群聊分级策略**：提供 `dmPolicy` / `groupPolicy`（`open | allowlist | disabled`）及 `allowFrom` / `groupAllowFrom` 名单；群聊维度细化支持 `requireMention`、`commandLevel`、`historyLimit` 以及按群隔离的 `tools` 工具权限策略（群聊环境下默认禁用 `exec`、`read`、`write` 等高危本地工具）。
- **会话隔离粒度（`session.dmScope`）**：支持 `per-account-channel-peer` 等多档隔离维度，确保多账号同时在线时各会话上下文清晰独立。
- **循环触发保护（Bot loop protection）**：自动识别并阻断多个机器人之间的循环互回。
- **实用内建指令**：如 `/bot-me`（快速回显发送者在当前平台的唯一身份 ID，方便配置白名单）等轻量运维指令非常实用。

### 2.5 腾讯系官方插件的启示

微信个人号（`@tencent-weixin/openclaw-weixin`）、QQ 开放平台机器人（`@tencent-connect/openclaw-qqbot`）与企业微信（`@wecom/wecom-openclaw-plugin`）均由腾讯对应产品团队**官方维护并以外部插件形式**接入 openclaw，飞书也有成熟的一方插件 `@openclaw/feishu`（默认启用免公网 WebSocket 长连接，同时支持共用 HTTP 端口的 `/feishu/events` Webhook 模式）。这表明 openclaw 提炼的渠道适配器契约中立清晰，已成为当前行业普遍认可的事实标准。

## 3. zcode 的通道层（Bot Channel）

本文调研的「zcode」指 **Z.ai（智谱）推出的编程智能体工具 ZCode**（开源仓库见 [github.com/zai-org/ZCode](https://github.com/zai-org/ZCode)，涵盖桌面、Web 与终端三种形态；通道说明见[官网文档](https://zcode.z.ai/cn/docs/bot-channel)）。

ZCode 通道层与 openclaw 的独立网关定位各有侧重——它**直接内嵌于桌面端，作为桌面 Agent 的「移动端远程遥控面」**：

- 在桌面端「移动端远程控制」弹窗内提供 Bot Channel 入口；目前已上线 **微信（扫码自动完成授权绑定）** 与 **飞书（扫码引导创建自建应用 → 在飞书会话内发送 `/bind C67356` 限时绑定口令完成身份与工作区关联）**，钉钉、Discord 与企业微信也在演进路线图中。
- 内置直观的机器人管理面板：支持一键启停、查看实时连接状态、调节**回复颗粒度**（标准 / 完整 / 摘要）以及限定**可访问的工作区目录范围**。
- 飞书端采用**流式卡片交互**：在同一张消息卡片上原地实时刷新输出（正文回复与可折叠的工具调用摘要按时间线交错排布）；当任务执行到需要人工确认的节点时，自动定格当前进度卡片并另发一张独立的审批卡片。这套设计非常贴合长耗时 Agent 任务在移动端上的阅读与决策习惯。
- 定位对比：ZCode 的聊天通道**直接操控桌面端现有工作区会话**（代码与工具仍在本地桌面环境运行），主打「人在外出、Agent 留守桌面」的远程协同；openclaw 则是将 Agent 与消息通道一同托管在常驻网关进程内。结合 OneTHU 的无后端直连架构，运行载体形态与 ZCode 高度一致，而内部模块分层则可充分吸收 openclaw 的插件契约经验。

ZCode 有两项交互设计尤其值得 OneTHU 借鉴：一是 `/bind` 限时绑定口令，让用户在同一聊天窗口内即可顺畅完成平台身份与本地账号的关联；二是飞书「流式进度卡片 + 独立审批卡片」的二段式交互体验。

## 4. 对 OneTHU 的启示清单

1. 单宿主实例集中管理全部 IM 会话连接；内部调用采用幂等键与清晰的状态同步机制。
2. 通道契约按「core 统一管控策略 / 适配器专注平台转换」分层，账号配置 Schema 随适配器声明并自动渲染设置界面。
3. 落实事件 ID 幂等去重、游标断点续传与按会话（per-peer）串行队列。
4. 配对绑定、`dmPolicy`/`allowFrom` 白名单以及群聊 `requireMention` 与工具权限限制**全部在 core 框架层集中强制执行**。
5. 统一收口本地媒体暂存目录，并支持按通道维度灵活配置发送限速。
6. 提供只读健康探测接口（类似 `inspectAccount`）以及 `/me` 等便于用户自助查询平台 ID 的轻量运维命令。
7. 交互体验融合 ZCode 优点：引入 `/bind` 限时口令绑定流程，并在飞书通道落地流式进度卡片与审批卡片。

具体落地方案详见 [00-architecture.md](00-architecture.md)。
