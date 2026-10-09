# Telegram Bot API 通道调研

> 最后更新：2026-10-09 ｜ 调研基线：core.telegram.org 官方文档
> 结论先行：**API 能力是六通道中最自由完整的（无消息窗口、文件闭环、限速宽松），但大陆网络不可直连 + 平台本身在大陆的合规风险，决定它只能是「海外部署/自备代理」的可选通道。**

## 1. 接入路径与认证

- @BotFather 创建 bot 得 token（`<bot_id>:<secret>`），免注册开发者账号、即开即用。
- 两种收消息方式：
  - **getUpdates 长轮询**：纯出站，无需公网入口（NAS 友好；但大陆网络下 api.telegram.org 被封锁，需代理出站）。
  - **setWebhook**：要求公网 HTTPS（端口仅 443/80/88/8443），可设 `secret_token` 请求头校验防伪造；证书 LetsEncrypt 免费。
- 鉴权即 token 本身（URL 参数或 `Authorization: Bearer`）；泄漏即失控，注意保管与 rotate。

## 2. 消息能力

- `sendMessage`（MarkdownV2/HTML/原生）、sendPhoto/sendDocument/sendAudio/sendVideo/sendAnimation/sendVoice/sendVideoNote/sendMediaGroup(相册)、sendChatAction（正在输入…）、editMessageText/editMessageCaption（原地编辑，适合流式回复）、inline keyboard / reply keyboard（按钮回调 `callback_query`）、消息回复引用、话题群（forum topics）与超级群支持。
- **Privacy mode**：默认群内 bot 只能看到 @ 它的消息与命令（`/setprivacy` 可关，或提升 bot 为管理员获得全量消息）——群场景注意默认行为，openclaw/各框架均以 mention 门控配合。
- 主动消息：**无窗口概念**，bot 可随时主动发消息（受频控）；用户可 /stop 屏蔽 bot。
- 2025–2026 新能力一笔带过：业务模式 bot（绑定个人 Telegram 账号代收发）、Mini Apps、付费广播（Paid Broadcasts，Stars 计费提升广播速率上限）。

## 3. 频率限制（官方 Bot FAQ 数值）

来源：[Telegram Bot FAQ](https://core.telegram.org/bots/faq)（转引核对：[teleclaw 限速综述](https://teleclaw.com/blog/telegram-bot-rate-limits)）：

| 层 | 限制 |
| --- | --- |
| 全局 | ~30 条/秒（所有会话合计） |
| 单会话 | ~1 条/秒（允许短突发） |
| 群 | 20 条/分钟（每群独立计） |

超限返回 HTTP 429 + `parameters.retry_after`（秒），必须按该值退避。付费广播可提升至 1000 条/秒（0.1 Stars/条超出部分）。

## 4. 文件收发（硬需求）

- **发送**：sendDocument 等 multipart 直传，**上限 50 MB**（Bot API 文档标注）。
- **接收**：`getFile` → `file_path` → `GET https://api.telegram.org/file/bot<token>/<file_path>` 下载，**bot 下载上限 20 MB**（Bots FAQ：bot 只能下载 20MB 以内文件）。
- 结论：双向闭环但**入站 20MB 上限**是硬天花板——大于 20MB 的文件建议引导用户走云盘分享链接；转存云盘流程同样适用（收到即上传 seafile）。

## 5. SDK 生态（六通道中最成熟）

- Rust：[teloxide](https://github.com/teloxide/teloxide)（活跃、功能全）、frankenstein（轻量）。
- TS：grammY / telegraf；Python：aiogram / python-telegram-bot。
- openclaw 桌面/服务器形态即用 grammY 系。

## 6. 网络与合规风险（如实评估）

- **大陆直连不可用**：api.telegram.org 在 GFW 封锁列表。网关部署在家庭 NAS 时需自带代理（用户已有相关网络基础）；或网关部署海外 VPS（但那样与「云端常驻 NAS」目标冲突，且访问清华内网服务需再打通回校园网——成本高）。
- **平台合规**：Telegram 未在大陆备案，在境内提供 Telegram 机器人服务属灰色地带；校园场景公开推广需谨慎，建议定位为「用户自选、自备网络环境」。
- 账号风险：bot 本体无封号敏感点（依平台 ToS），但使用的代理 IP 质量差可能触发限速。

## 7. 云端常驻（NAS Docker）适配

- 长轮询 + 纯出站 = 容器友好；唯一前提是容器内有可用代理出站。
- webhook 模式在 NAS 场景不必用（长轮询足够，openclaw 亦以长轮询为主、webhook 可选）。
- 结论：**技术适合度：高（有代理前提）；合规/网络适合度：低（大陆场景）。** 建议作为 P2 可选通道，由用户显式开启并提供代理配置。

## 参考

- [Telegram Bot API](https://core.telegram.org/bots/api) ｜ [Bots FAQ（限速/文件限制）](https://core.telegram.org/bots/faq)
- [OpenClaw Telegram 通道文档](https://docs.openclaw.ai/channels/telegram)
- [teleclaw：Telegram Bot Rate Limits 2026](https://teleclaw.com/blog/telegram-bot-rate-limits)
- [teloxide（Rust）](https://github.com/teloxide/teloxide)
