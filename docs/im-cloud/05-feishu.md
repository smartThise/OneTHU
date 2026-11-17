# 飞书（Lark）Bot 通道调研

> 归档说明：本文记录当时的飞书通道调研与技术评估；0.11 当前功能与使用指南请查阅 [文档入口](../README.md)（[English overview](../en/index.md)）。

> 最后更新：2026-11-18 01:30
> 结论先行：**飞书开放平台的官方 API 完整度最高：原生支持免公网入口的 WebSocket 长连接事件订阅、丰富的交互式流式卡片与双向通用文件收发，是 OneTHU 首期（P0）接入的理想标杆通道。**

## 1. 接入路径

- **企业自建应用**（OneTHU 推荐接入方式）：在[飞书开发者后台](https://open.feishu.cn/app)创建自建应用，开启「机器人」能力，按需勾选权限范围（scope）并设置**可用范围**（机器人仅能与可用范围内的成员收发消息），发布应用版本后即刻生效。个人用户免费注册飞书个人版团队即可创建自建应用（个人版与商业版在长连接配额等细节上的差异**待实测核对**）。
- **应用商店应用**：主要面向商业 ISV 跨租户分发，涉及上架审核与服务商资质；对于个人用户或院系、课题组飞书团队而言，直接创建自建应用最为轻便实用。
- **openclaw 生态印证**：一方插件 `@openclaw/feishu` 已稳定支持私聊与群聊生产环境，默认采用免公网 URL 的 WebSocket 长连接模式，同时兼容共用网关 HTTP 端口（`/feishu/events`）的 Webhook 模式，充分验证了飞书长连接方案的成熟度。

## 2. 认证方式

| Token | 用途 | 有效期 |
| --- | --- | --- |
| `tenant_access_token` | 以应用身份访问本租户资源（机器人收发消息主力凭证） | 2h（本地缓存并提前刷新） |
| `app_access_token` | 应用商店跨租户场景凭证 | 2h |
| `user_access_token` | 代表用户本人的 OAuth 授权凭证 | 约 2h + `refresh_token` |

获取方式：调用 `POST /open-apis/auth/v3/tenant_access_token/internal`（传入 `app_id` + `app_secret`）。事件订阅页面另提供 `Verification Token` 与 `Encrypt Key`（供 Webhook 模式验签解密使用；采用长连接模式时由官方 SDK 在握手阶段统一完成鉴权，**免除手动验签解密步骤**）。

## 3. 事件订阅（两种模式）

来源：[事件概述](https://open.feishu.cn/document/server-docs/event-subscription-guide/overview)。

- **长连接模式（首选推荐）**：飞书官方 SDK 原生内建——客户端与飞书开放平台建立 **WebSocket 全双工长连接**，平台事件直接沿该连接实时下发，**无需准备公网 URL，也无需处理回调解密验签**，宿主环境只需具备常规出站网络访问即可。该能力面向企业自建应用开放（商店应用支持范围与单应用并发连接/吞吐上限**待实测核实**）。
- **Webhook 模式**：需提供公网 HTTPS 回调地址，并在 3s 内返回 HTTP 200；超时或失败会按 15s / 5min / 1h / 6h 阶梯重试**至多 4 次**。由于采用 at-least-once 投递语义，接收端需基于 v2.0 `header.event_id`（或 v1.0 `uuid`）做好幂等去重；开启有序推送的事件需等待前序事件确认后才会继续下发。

## 4. 消息与卡片能力

- 发送接口：`POST /open-apis/im/v1/messages`（参见[发送消息](https://open.feishu.cn/document/server-docs/im-v1/message/create)），`receive_id_type` 支持 `open_id` / `union_id` / `user_id` / `email` / `chat_id`；消息类型全面覆盖 `text`、`post`（富文本）、`image`、**`file`**、`audio`、`media`、`sticker`、**`interactive`（交互卡片）**、`share_chat`、`share_user` 与 `system`。
- 交互式卡片（`interactive`）：支持按钮点击等交互事件回调（卡片动作回调同样可直接复用同一条 WebSocket 长连接通道）；ZCode 在飞书端实现的「流式原地刷新进度卡片 + 独立审批卡片」验证了飞书卡片对长耗时 Agent 任务的出色表现力。
- 主动推送：机器人可随时向可用范围内的成员主动发起私聊消息（若用户手动关闭接收机器人消息则返回错误码 `230053`）；群聊发送则要求机器人已在群内且未被禁言。
- 消息体积上限：普通文本 150KB，卡片与富文本 30KB。

## 5. 频率限制（官方数值）

来源：[im/v1/messages 文档](https://open.feishu.cn/document/server-docs/im-v1/message/create)：

- 接口总配额：单应用 **1000 次/分钟、50 次/秒**。
- 会话级限频：向同一用户发送上限 **5 QPS**；向同一群组发送上限 **5 QPS（群内所有机器人共享额度）**。
- 触发限频时接口返回错误码 `230020`。

## 6. 文件收发能力

- **发送文件**：先调用 `POST /open-apis/im/v1/files`（参见[上传文件](https://open.feishu.cn/document/server-docs/im-v1/file/create)）上传获取 `file_key`（音频、视频与通用文件共用此接口，图片单独调用 `im/v1/images`），再发送对应的 `file` / `media` / `audio` / `image` 消息。需注意：**机器人只能发送由自身上传生成的 `file_key`**（跨应用混用会返回错误码 `230017`）。单文件上传上限通行值为 30MB（具体配额与音频时长约束**待实测确认**）。
- **接收文件**：用户在会话中发送 `file` / `media` / `audio` / `image` 消息后，入站事件 `im.message.receive_v1` 会携带对应的 `file_key`，随后调用 `GET /open-apis/im/v1/messages/{message_id}/resources/{file_key}?type=file` 即可下载原始文件。由于消息资源 `file_key` 具有时效性（具体保留周期**待验证**），收到后立即经 `seafile.rs` 转存至清华云盘最为稳妥。
- 小结：**原生支持双向通用文件收发闭环，完全满足核心需求**（超出单文件体积上限的大文件可自动转为发送清华云盘分享链接）。

## 7. 合规与账号安全

- 平台内容合规：飞书设有敏感信息防泄漏检测机制（错误码 `230022` / `230028`——明文手机号、邮箱或证件号可能触发拦截，因此 Agent 出站回复需对个人敏感字段做好摘要脱敏）。
- 全程调用官方开放平台标准接口，按企业应用维度配置精细权限（scope + 可用范围 + 版本发布审批），安全可控，非常适合个人及课题组渐进推广。

## 8. SDK 生态

- 官方维护 `oapi-sdk-python`、`oapi-sdk-nodejs`、`oapi-sdk-go` 与 `oapi-sdk-java`，均已原生内置 WebSocket 长连接客户端。
- Rust 生态暂无官方 SDK，社区有 [larksuite-oapi-sdk-rs](https://docs.rs/larksuite-oapi-sdk-rs)（接口覆盖度与近期维护活跃度**待核实**）。在 OneTHU 桌面端宿主 TS 层架构下，可直接采用官方成熟的 `oapi-sdk-nodejs`（或参考 `@openclaw/feishu` 基于标准 HTTP + 官方 WS 端点的轻量实现）。

## 9. 部署形态适配与结论

- WebSocket 长连接事件模式**完全免除公网入站端口**，仅需常规出站网络连接，无论在本地桌面端直连还是容器环境中都极为理想。
- 文件上传下载与 token 刷新同样全部走标准出站 HTTPS 请求。
- 使用门槛说明：学校日常教学与通知以校内系统及微信生态为主，用户首次接入需注册或登录个人版/课题组飞书账号并创建自建应用。因此在产品组合上，由飞书提供功能最完备的交互标杆体验，同时搭配微信官方 iLink 通道覆盖更广泛的日常触达场景。
- 结论：**综合适配度高，列为 P0 首选通道。**
