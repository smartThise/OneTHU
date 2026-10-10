# 微信个人号 Bot 通道调研

> 最后更新：2026-10-09 ｜ 调研基线：2026 年 10 月公开资料
> 结论先行：**2026 年 3 月起微信官方为个人号开通了 AI Bot 合法通道（iLink Bot / ClawBot 插件），应优先走官方通道；一切非官方协议（web 注入 / PC hook / 协议模拟）继续维持高封号风险，不建议 OneTHU 采用。**

## 1. 官方通道：微信 iLink Bot（ClawBot 插件）

### 1.1 背景与时间线

- 微信于 **2026 年 3 月**正式上线 ClawBot 插件入口：客户端需 **8.0.70+**，入口位于「我 → 设置 → 插件」，由腾讯**分批灰度**向账号开放（转引 [七牛云 DSH 接入微信实操文](https://news.qiniu.com/archives/1787733470435)，原始出处为新浪财经 2026-03-22 报道，待验证灰度覆盖比例）。
- 同期腾讯微信团队在 GitHub 开源了 OpenClaw 渠道插件 [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin)（npm：[`@tencent-weixin/openclaw-weixin`](https://www.npmjs.com/package/@tencent-weixin/openclaw-weixin)，MIT 协议，维护者全部为 @tencent.com 邮箱），首版发布于 2026-03-21，截至 2026-10 最新版 2.4.9（2026-09-17 发布）。
- 这是**微信个人号目前唯一的官方 bot 接入路径**；之前个人号 bot 全部依赖非官方手段（见 §3）。

### 1.2 接入方式与协议

iLink Bot 后端 API（默认 `https://ilinkai.weixin.qq.com`）为 HTTPS + JSON 协议，完整协议文档见[微信后端 API 协议](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol_zh_CN.md)。要点：

| 环节 | 机制 |
| --- | --- |
| 登录 | `POST /ilink/bot/get_bot_qrcode?bot_type=3` 取二维码 → 手机微信扫码（可能需输验证码 `need_verifycode`）→ `GET /get_qrcode_status` 轮询至 `confirmed`，返回 `bot_token`、`ilink_bot_id`、`ilink_user_id`（扫码用户），凭据本地保存 |
| 认证 | 请求头 `AuthorizationType: ilink_bot_token` + `Authorization: Bearer <bot_token>`；`iLink-App-Id: bot`；随机 `X-WECHAT-UIN` |
| 收消息 | `POST /ilink/bot/getupdates` **HTTP 长轮询**（服务端建议超时 35s），游标 `get_updates_buf` 回传；`ret/errcode == -14` 时账号会话暂停 1 小时 |
| 发消息 | `POST /ilink/bot/sendmessage`，消息体 `item_list`（type 1 文本 / 2 图片 / 3 语音 / 4 文件 / 5 视频），回复需回传入站消息的 `context_token`（会话上下文令牌） |
| 文件收发 | `POST /ilink/bot/getuploadurl`（文件明文 MD5 + AES-128-ECB/PKCS#7 密文大小）→ 密文 PUT 到 CDN（默认 `novac2c.cdn.weixin.qq.com/c2c`）→ `sendMessage` 携带媒体引用（`encrypt_query_param` + `aes_key`）；下载走 `full_url` 或 CDN `/download` + AES 解密 |
| 输入状态 | `getConfig` 取 `typing_ticket` → `sendTyping`（status 1 正在输入 / 2 取消） |
| 生命周期 | 启动/停止时 `notifyStart` / `notifyStop` |

消息模型本身就为 AI agent 设计：`message_type`（1 用户 / 2 Bot）、`message_state`（0 新 / 1 生成中 / 2 完成）、`run_id`（生成运行 ID）、甚至预留了 `tool_call_start_item` / `tool_call_result_item` 消息项——即官方规划了 agent 工具调用进度的展示形态。

### 1.3 能力边界（截至 2026-10，openclaw-weixin 2.4.x）

- **仅支持单聊（DM）**，不支持群聊（协议类型里有 `group_id` 字段但插件能力声明 direct chats only；[OpenClaw 微信通道文档](https://docs.openclaw.ai/channels/wechat)）。
- 支持文本、图片、语音、文件、视频收发；语音消息可携带官方转写文本（`voice_item.text`）。
- 一个 Gateway 可同时挂多个微信账号（多次扫码）。
- 出站固定不上传缩略图（`no_need_thumb: true`）；协议未公开文件大小上限与频率配额——**待验证**（实际以服务端约束为准，社区报告单文件入站上限约 100 MiB 量级，转引自 [dsh-channels 文档](https://github.com/wsz987/dsh-channels)，未经官方确认）。
- 引用消息（quote）需本地缓存还原（插件默认文本 30 天 / 媒体 7 天 256 MiB）。

### 1.4 账号与合规风险（如实评估）

- **协议层风险低**：这是腾讯自己运营的官方后端（weixin.qq.com 域），不是第三方模拟客户端。扫码授权的用户视角是「给这个 bot 开了私聊通道」，不存在「用外挂软件登录我的号」的问题。
- **但仍是新平台，规则未稳**：功能灰度（部分账号没有入口）、`ret == -14` 会话暂停机制说明服务端有主动风控；配额、频控政策可能随时收紧（**待验证**）。OpenClaw 文档也提醒其 2.4.8 版 pairing 适配器缺失，访问控制有洞（空 allowlist + 无扫码人 ID 时放行任意发送者），自建网关时**必须自己实现发送者白名单**，不能照抄其默认行为（见 [WeChat channel 文档 Access control 节](https://docs.openclaw.ai/channels/wechat)）。
- **内容合规**：bot 回复内容仍受微信平台内容规范约束，AI 生成内容有被平台侧过滤的可能；对学生场景（课表/成绩等个人信息）注意不要在回复中回显敏感数据。
- 结论：官方通道的「封号风险」从旧方案的**高**降为**低-中**（残余风险来自平台政策变化与滥用行为，如高频轰炸、垃圾消息）。

### 1.5 SDK 生态

- 官方参考实现是 TS（Tencent/openclaw-weixin，依赖极简：zod + qrcode-terminal），MIT 可移植。
- dsh 生态已有第三方适配：[xmanrui/dsh-im](https://github.com/xmanrui/dsh-im)（9 渠道，约 393 star，2026-08）、[wsz987/dsh-channels](https://github.com/wsz987/dsh-channels)（含 PDF/DOCX 附件提取、单文件 100 MiB 上限）、dsh-weixin（单渠道轻量）——证明协议可在非 openclaw 宿主上独立实现。
- Rust：无现成 crate；协议面小（二维码轮询 + 长轮询 + AES-ECB CDN），自研客户端工作量约数天级。

## 2. 其他生态方案（官方通道的宿主）

| 方案 | 形态 | 说明 |
| --- | --- | --- |
| [OpenClaw](https://openclaw.ai/) | 独立 agent 网关 | 官方插件即为其渠道生态出品，见[02 篇](02-openclaw-architecture.md) |
| dsh 插件族 | 宿主 harness 的渠道插件 | dsh-im / dsh-channels / dsh-weixin，见上文 |
| Linclaw 等桌面集成 | 桌面 Agent 预装渠道 | 七牛云 Linclaw 等（转引） |

若 OneTHU 不自研 iLink 客户端，可「借用 openclaw gateway 只当消息桥」（见架构篇 §6 的评估）。

## 3. 非官方个人号方案现状（风险对照，均不建议采用）

> 直说：以下所有方案的本质都是**模拟/注入非官方客户端**，违反微信服务条款，微信团队持续打击。海豹手册对同类 QQ 生态的判断同样适用于微信：官方视角等同「外挂软件」。OneTHU 是面向清华学生的公开产品，不应承担让学生个人微信号被封的风险。

| 方案 | 原理 | 2025–2026 现状 | 风险评级 |
| --- | --- | --- | --- |
| **wechaty**（+ 各 puppet） | puppet 抽象：web 协议（wechat4u）/ pad 协议（付费 token 服务商）/ Windows hook（wechaty-puppet-xp） | 项目仍维护但核心价值在 puppet 层；web 协议 2017 年后大规模回收，多数个人号已无法登录 web；pad 协议依赖第三方付费服务商（如 Wechat4u 之外的 padlocal 等，法律与服务连续性风险）；hook 系需 Windows + 特定微信版本 | **高**（web：多数账号不可用；pad：灰色付费服务；hook：随版本失效） |
| **WeChatFerry / wcferry** | Windows 微信客户端 DLL 注入（hook），Python/HTTP RPC 暴露收发 | [lich0821/WeChatFerry](https://github.com/lich0821/WeChatFerry) 仍随微信 Windows 版本追更（release 持续到 2026），但每次微信升级都可能失效；需要常驻 Windows 环境跑真实客户端 | **高**（注入检测 + 版本耦合 + 无法 headless 云端常驻） |
| **chatgpt-on-wechat / ntchat / xbot 等** | 多为上述协议的封装 | 社区活跃度随官方通道出现明显分化，头部项目逐步转向官方 iLink 或企微/公众号 | **高** |
| **公众号 / 微信客服（官方）** | 服务号客服消息、微信客服 open API | 官方合规，但形态是「服务号/企业主体客服」，非个人号私聊；触达有时效与 48h 窗口限制，个人开发者主体难办 | **合规但形态不符**（OneTHU 场景不适合做主通道，一句话带过） |

**微信对第三方客户端的打击事实**：微信长期未开放个人号 API，且对 web/pad/hook 各协议链路均有检测与回收历史（web 微信 2017 年起限制大部分账号登录即为先例）；2025–2026 官方选择「自己下场开官方 bot 通道」而非放开协议，态度明确。非官方方案的封号案例在社区长期存在且不可申诉恢复，**如实告知：不要用于任何承载真实社交关系的微信号**。

## 4. 对 OneTHU 的结论

1. **主推官方 iLink Bot 通道**：合法、支持文件收发、长轮询免公网入站（桌面直连/NAS 均友好）、协议 MIT 开源可移植。限制：仅单聊、灰度覆盖待确认、配额未文档化。
2. 自研时实现自己的 sender 白名单 + 会话绑定（OneTHU 账号 ↔ 微信 `ilink_user_id`），不重蹈 openclaw 插件 2.4.8 的访问控制缺陷。
3. 非官方协议（wechaty-pad/hook/wcferry）一律不做默认能力，最多以「用户自担风险的自选组件」存在于文档附录，不进产品主路径。
4. 灰度兜底：账号无 ClawBot 入口时引导用户走飞书通道（企微已在无后端主案下出局，见 [00-architecture.md](00-architecture.md) §5）。

## 参考

- [Tencent/openclaw-weixin（源码 + 协议文档）](https://github.com/Tencent/openclaw-weixin)
- [微信后端 API 协议（protocol_zh_CN.md）](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol_zh_CN.md)
- [OpenClaw WeChat 通道文档](https://docs.openclaw.ai/channels/wechat)
- [npm @tencent-weixin/openclaw-weixin（版本与维护者信息）](https://registry.npmjs.org/@tencent-weixin/openclaw-weixin)
- [七牛云：DeepSeek Harness 如何连接微信（四条路线与扫码接入实操）](https://news.qiniu.com/archives/1787733470435)
- [CSDN：把 AI 智能体接入微信（腾讯官方 iLink Bot API）](https://grapecity.csdn.net/6a8936c710ee7a33f29dae65.html)（转引，质量一般仅作交叉印证）
- [lich0821/WeChatFerry](https://github.com/lich0821/WeChatFerry)
