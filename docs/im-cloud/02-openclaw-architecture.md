# openclaw 网关/适配器架构调研（附 zcode 通道层）

> 最后更新：2026-10-09 ｜ 调研基线：openclaw 官方文档（docs.openclaw.ai）与 npm/GitHub 公开仓库
> openclaw 即原 clawdbot（Peter Steinberger 项目，2026 年初爆火后因商标问题更名 openclaw，版本号采用日期制 `2026.x`），是目前个人 AI agent 网关事实上的参考架构。

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

关键设计决定（对 OneTHU 有直接参考价值）：

1. **一个 Gateway 进程独占全部 IM 会话**（"One Gateway per host. It is the only place that opens a WhatsApp session."）。IM 长连接资源（登录态、长轮询游标、WebSocket）收敛到单一所有者，避免多处登录互踢。
2. **控制面协议**：WebSocket 文本帧 JSON。首帧必须是 `connect`（强制握手）；其后 `req/res`（`{type:"req", id, method, params}` → `{type:"res", id, ok, payload|error}`）与事件推送（`{type:"event", event, payload}`）。**副作用方法（send/agent）强制幂等键**，服务端短窗去重。
3. **鉴权分层**：本机回环自动批准；LAN/Tailnet 需显式配对批准（设备身份 + challenge 签名，配对发设备 token）；`gateway.auth.*`（shared secret / Tailscale Serve / trusted-proxy / none）作用于所有连接。远程推荐 Tailscale/SSH 隧道而非裸暴露。
4. **事件不重放**（"Events are not replayed. Clients must refresh on gaps."）——控制面事件是通知，真相在网关内的存储里。
5. **TypeBox 定义协议 → 生成 JSON Schema → 生成 Swift/TS 模型**：协议先契约化再代码化。

## 2. 渠道插件契约（核心抽象）

来源：[Building channel plugins](https://docs.openclaw.ai/plugins/sdk-channel-plugins)。

### 2.1 职责切分：core 与 channel plugin

openclaw 的多通道抽象最重要的一点是**职责切分**，而不是接口本身：

| 归 core（框架） | 归 channel plugin（适配器） |
| --- | --- |
| 共享 `message` 工具（agent 唯一发消息出口） | **Config**：账号解析、设置向导 |
| prompt 接线、外层 session-key 形态 | **Security**：DM 策略与 allowlist |
| 通用线程记账与派发 | **Pairing**：DM 配对/批准流 |
| 群会话的参与者选择、追问轮次、turn 预算 | **Session grammar**：平台会话 ID → chat/thread/parent 的映射 |
| 模型选择器等产品动作的统一编码 | **Outbound**：sendText / sendMedia / chunker |
| 速率限制、重试、消息队列（每 peer 串行） | **Threading**：回复如何串线程 |
| | **Typing/heartbeat**：输入状态等信号 |
| | **Formatting contract**：入站格式提示 |

也就是说：**适配器只做「平台翻译」，所有策略（谁能用、发什么、多快、串哪条线程）在框架层**。这保证了 30+ 通道行为一致，也保证了安全策略不被单个适配器绕过。

### 2.2 插件形态

- npm 包 + `openclaw.plugin.json` 清单（`channels` 字段声明拥有通道；`channelConfigs.<id>.schema` 声明账号配置 schema + UI hints）。
- 运行时经 `openclaw/plugin-sdk/*` 多个子路径（channel-core / channel-outbound / channel-contract / fetch-runtime…）获得带版本的能力面；宿主版本门槛（如微信插件要求 `>=2026.5.12`）。
- `createChatChannelPlugin()` 用声明式选项组合出适配器（security.dm / pairing.text / threading / outbound.attachedResults…），也可传原始 adapter 对象全接管。
- 渠道生命周期钩子齐全：账号启停（`notifyStart/Stop` 类）、状态上报（`setStatus`）、诊断（`inspectAccount` 同步只读）。

### 2.3 可靠性语义（值得照抄的部分）

- **Durable ingress**：入站事件先持久化再推进游标（QQ bot 文档明确写了「持久化原始事件后才推进 resume 序列，重启后待处理 turn 存活，事件 ID 去重，至少一次投递」）。
- **at-least-once + 幂等**：所有通道按 at-least-once 处理，靠 provider event ID / uuid / msg_id+seq 去重。
- **每 peer 入站队列**：同一会话串行，队列满时先驱逐 bot 自己的消息再驱逐人类消息；群消息 burst 合并为一个 attributed turn。
- **媒体单一根目录**（`~/.openclaw/media/<channel>`）：上传、下载、转码缓存统一收口。
- **速率限制**：openclaw 自身不帮通道全避 429（如 Twitch 走 Twurple 限速队列），框架提供 per-channel 限速配置与 `limits` 文档（飞书通道有 message limits / quota optimization 专页）。

### 2.4 会话与访问控制模型

- **Pairing**：新 DM 联系人默认需配对码/批准（文本配对码经平台 DM 送达），批准后入库 SQLite；openclaw 微信插件 2.4.8 缺 pairing 适配器导致放行任意 sender 是反面教材（见 [01 篇 §1.4](01-wechat.md)）。
- **dmPolicy / groupPolicy**（`open | allowlist | disabled`）+ `allowFrom / groupAllowFrom`；群维度 `requireMention`、`commandLevel`、`historyLimit`、`tools` per-group 工具策略（群内默认 deny exec/read/write）。
- **session.dmScope**：会话隔离粒度（per-account-channel-peer 等档位），多账号时防止跨账号串台。
- **Bot loop protection**：识别 bot↔bot 循环。
- **Slash commands**：`/bot-me`（查自己的平台 ID 便于配 allowlist）这类小工具值得抄。

### 2.5 腾讯系官方插件的启示

微信（`@tencent-weixin/openclaw-weixin`）、QQ bot（`@tencent-connect/openclaw-qqbot`）、企微（`@wecom/wecom-openclaw-plugin`）都由腾讯各产品团队**以外部插件形式**接入 openclaw，飞书是 `@openclaw/feishu` 一方插件（默认 WebSocket 长连接事件、免公网 webhook）。这说明 openclaw 的渠道契约足够中立，连平台官方都愿意按它出货——契约本身已是行业事实参考。

## 3. zcode 的通道层（Bot Channel）

「zcode」经查证指 **Z.ai（智谱）的 coding agent harness ZCode**（[github.com/zai-org/ZCode](https://github.com/zai-org/ZCode)，已开源桌面/Web/终端三形态；[官网文档](https://zcode.z.ai/cn/docs/bot-channel)）。不确定处：用户若另有所指（例如某个同名小项目），以本报告理解为准。

其通道层设计与 openclaw 定位不同——**不是网关进程，而是桌面 Agent 的「远程遥控面」**：

- 桌面端「移动端远程控制」弹窗内提供 Bot Channel 入口；渠道目前 **微信（扫码自动绑定）+ 飞书（扫码自动创建自建应用 → 会话内发 `/bind C67356` 限时绑定命令完成人↔工作区绑定）**，钉钉/Discord/企微在路线图上。
- 机器人管理面板：启停、连通状态、**回复颗粒度**（标准/完整/摘要）、**可访问 workspace 范围**限制。
- 飞书用**流式卡片**：同一张卡片原地更新（正文与折叠的工具调用摘要按时间线穿插），需要用户决策时定格当前卡片并另发一张审批卡片——这是 IM 端呈现长任务的优秀交互范式。
- 定位差异：zcode 的 chat 渠道**操作的是桌面端已有会话**（代码仍跑桌面环境），偏「人在别处、Agent 在桌面」；openclaw 的 gateway 是「Agent 与渠道都住在网关里」。OneTHU 两种形态都需要：桌面 sidecar（本地）与 NAS 常驻（云端）。

对 OneTHU 最值得抄的两点：`/bind` 限时绑定命令（把平台身份与 OneTHU 账号绑定的 UX，比 openclaw 的配对码更顺）；飞书流式卡片 + 审批卡片二段式交互。

## 4. 对 OneTHU 的启示清单

1. 单网关进程独占 IM 会话资源；控制面 WS + 幂等 req/res + 事件不重放。
2. 适配器契约按「core 持策略 / plugin 持平台翻译」切分；配置 schema 随插件声明。
3. Durable ingress（先落盘再推游标）+ at-least-once + 事件 ID 去重 + 每 peer 串行队列。
4. Pairing + dmPolicy/allowFrom + 群 requireMention/tools 策略，且**这些必须在框架层强制**，不信任适配器默认值。
5. 媒体统一收口目录 + 各通道限速配置化。
6. 渠道状态/诊断（`inspectAccount` 式只读探测）与 `/bot-me` 类运维小命令。
7. 交互层借鉴 zcode：绑定命令、流式卡片、审批卡片。

具体落地形态见 [00-architecture.md](00-architecture.md)。
