# Telegram Bot API 通道调研

> 归档说明：本文记录当时的 Telegram 通道调研与技术评估；0.11 当前功能与使用指南请查阅 [文档入口](../README.md)（[English overview](../en/index.md)）。

> 最后更新：2026-11-18 01:30
> 结论先行：**Telegram Bot API 在六个调研平台中开放度最高（随时可主动发消息、支持双向文件传输、限频宽松、免审核即开即用）；考虑到境内网络无法直连及平台合规边界，将其定位为面向有相应网络环境用户的 P2 自选扩展通道。**

## 1. 接入路径与认证

- 直接在客户端向 `@BotFather` 发送指令即可创建机器人并获取专属 token（格式为 `<bot_id>:<secret>`），无需额外注册开发者后台或等待人工审核，即开即用。
- 支持两种接收消息模式：
  - **`getUpdates` 长轮询**：纯出站 HTTP 请求，免公网入口（契合本地桌面端直连与内网容器部署；在境内网络环境下访问 `api.telegram.org` 需配置出站代理）。
  - **`setWebhook` 回调**：需提供公网 HTTPS 地址（仅支持 443 / 80 / 88 / 8443 端口），可配置 `secret_token` 请求头校验来源合法性，支持 Let's Encrypt 免费证书。
- 接口鉴权直接依赖 bot token（拼入请求路径或请求头），需存入本机安全存储并在疑似泄露时通过 `@BotFather` 及时轮换重置。

## 2. 消息能力

- 消息与交互接口丰富：支持 `sendMessage`（兼容 MarkdownV2 / HTML / 纯文本）、`sendPhoto` / `sendDocument` / `sendAudio` / `sendVideo` / `sendAnimation` / `sendVoice` / `sendVideoNote` / `sendMediaGroup`（相册组合）、`sendChatAction`（正在输入等状态提示）、`editMessageText` / `editMessageCaption`（原地编辑消息，非常适合流式输出刷新）、`inline keyboard` / `reply keyboard`（内联按钮与 `callback_query` 回调）、引用回复，以及超级群与话题群（Forum Topics）分组对话。
- **群聊隐私模式（Privacy mode）**：默认开启时，群内机器人仅接收 @ 提及它的消息与斜杠命令（可通过 `/setprivacy` 关闭或将机器人设为群管理员以接收全量消息）；与 openclaw 等主流框架一致，OneTHU 群聊场景默认采用 @ 提及门控触发。
- **主动推送**：机器人可随时向已建立对话的用户主动发送消息（仅受常规速率配额约束），用户也可随时通过 `/stop` 停用接收。
- 2025–2026 平台新增能力概览：支持绑定个人账号代管收发的 Business Mode 机器人、内嵌网页轻应用 Mini Apps，以及使用 Stars 计费提升吞吐上限的付费广播（Paid Broadcasts）。

## 3. 频率限制（官方 Bot FAQ 数值）

来源：[Telegram Bot FAQ](https://core.telegram.org/bots/faq)（交叉核对参考：[teleclaw 限速综述](https://teleclaw.com/blog/telegram-bot-rate-limits)）：

| 层 | 限制 |
| --- | --- |
| 全局总计 | 约 30 条/秒（所有会话合计） |
| 单个私聊会话 | 约 1 条/秒（允许短时小幅突发） |
| 单个群组 | 20 条/分钟（按群独立计数） |

超出速率限制时服务端返回 HTTP 429 及 `parameters.retry_after`（退避秒数），适配器按该秒数延迟重试即可。开启付费广播后全局上限最高可扩展至 1000 条/秒（超出免费额度的部分按 0.1 Stars/条计费）。

## 4. 文件收发能力

- **发送文件**：调用 `sendDocument` 等接口通过 multipart 表单直接上传，**单文件上限为 50 MB**（官方 Bot API 标准文档口径）。
- **接收文件**：先调用 `getFile` 换取 `file_path`，再请求 `GET https://api.telegram.org/file/bot<token>/<file_path>` 下载文件流，**官方限制机器人下载单文件上限为 20 MB**（参见 Bots FAQ）。
- 小结：原生支持双向通用文件闭环，收到 20 MB 以内的附件可直接流式转存至清华云盘；若用户需传输超过 20 MB 的大文件，可在回复中引导其直接上传清华云盘并发送链接。

## 5. SDK 生态

- Rust：[teloxide](https://github.com/teloxide/teloxide)（社区活跃、功能完备）、`frankenstein`（轻量级封装）。
- TypeScript：`grammY` / `telegraf`；Python：`aiogram` / `python-telegram-bot`。
- openclaw 官方通道即基于 `grammY` 构建，OneTHU 桌面端 TS 层接入可直接复用成熟的 TS 生态。

## 6. 网络连通性与合规评估

- **境内网络连通性**：`api.telegram.org` 在境内默认网络环境下无法直接访问，无论运行在本地桌面端还是家庭 NAS 容器中，均需由用户自行配置可用的网络代理；若将服务单独部署在海外服务器，又会显著增加回连校园网服务的链路复杂度。
- **合规与产品定位**：结合境内网络环境与高校公开产品的合规要求，Telegram 通道在应用内默认保持关闭，定位为面向海外交流或自备合规网络环境用户的自选扩展通道。
- **账号与风控**：官方 Bot API 规则透明稳定，日常只需注意低质量共享代理 IP 在高频请求时更容易触发平台限流。

## 7. 部署形态适配与结论

- 采用 `getUpdates` 长轮询配合纯出站请求，在本地桌面端直连或容器环境下都很轻量，只需在通道配置项中提供代理地址设置即可。
- 长轮询模式已能充分满足个人助理的交互实时性（openclaw 同样默认采用长轮询，Webhook 仅作可选配置），省去了额外部署公网 HTTPS 端点的步骤。
- 结论：**接口开放度高、技术接入轻便；综合境内网络与合规要求，列为默认关闭的 P2 自选通道，由用户按需开启并自配代理。**

## 参考

- [Telegram Bot API](https://core.telegram.org/bots/api) ｜ [Bots FAQ（限速/文件限制）](https://core.telegram.org/bots/faq)
- [OpenClaw Telegram 通道文档](https://docs.openclaw.ai/channels/telegram)
- [teleclaw：Telegram Bot Rate Limits 2026](https://teleclaw.com/blog/telegram-bot-rate-limits)
- [teloxide（Rust）](https://github.com/teloxide/teloxide)
