# 飞书（Lark）Bot 通道调研

> 最后更新：2026-10-09 ｜ 调研基线：飞书开放平台官方文档（open.feishu.cn）
> 结论先行：**官方 API 完整度最高：长连接事件订阅免公网入口、卡片交互丰富、文件收发闭环，是 OneTHU 云端网关的首选通道之一。**

## 1. 接入路径

- **自建应用**（OneTHU 场景）：[开发者后台](https://open.feishu.cn/app)创建应用，开启「机器人」能力，配置权限范围（scope）与**可用范围**（机器人能服务的用户集合——用户必须在可用范围内才能收发），发布版本生效。个人开发者注册个人版飞书团队即可创建应用（**待验证**个人版与商业版功能差异，如长连接事件是否全量开放）。
- **商店应用**：面向 ISV 上架，OneTHU 不适用（每个用户/组织要能用得走自建或商店；清华若有机房/院系飞书租户，自建应用最现实）。
- openclaw 生态：一方插件 `@openclaw/feishu`，DM + 群聊生产可用，默认 WebSocket 长连接事件（无公网 URL 要求），webhook 模式可选（共用网关 HTTP 端口 `/feishu/events`）——印证长连接模式的成熟度。

## 2. 认证方式

| Token | 用途 | 有效期 |
| --- | --- | --- |
| `tenant_access_token` | 应用身份操作本租户资源（bot 收发消息主用） | 2h（缓存刷新） |
| `app_access_token` | 应用身份跨租户/商店场景 | 2h |
| `user_access_token` | 用户 OAuth 授权身份 | ~2h + refresh_token |

获取：`POST /open-apis/auth/v3/tenant_access_token/internal`（app_id + app_secret）。事件回调另配 `Verification Token` / `Encrypt Key`（webhook 模式验签解密；长连接模式**免验签**，SDK 封装鉴权）。

## 3. 事件订阅（两种模式）

来源：[事件概述](https://open.feishu.cn/document/server-docs/event-subscription-guide/overview)。

- **长连接模式（推荐）**：飞书 SDK 内建能力——SDK 与开放平台建 **WebSocket 全双工通道**，事件经通道推送，**无需公网 URL、无需解密验签**，服务器仅需出站公网访问。限制：企业自建应用可用（商店应用不支持，**待验证**现行政策）；连接数/事件吞吐有上限（**待验证**具体配额）。
- **Webhook 模式**：公网 HTTPS 回调，3s 内需 HTTP 200，失败按 15s/5min/1h/6h 重试**至多 4 次**；at-least-once 投递，须按 v2.0 `header.event_id`（或 v1.0 `uuid`）做幂等去重；部分事件有序推送（前一事件确认后才推下一事件）。

## 4. 消息能力

- `POST /open-apis/im/v1/messages`（[发送消息](https://open.feishu.cn/document/server-docs/im-v1/message/create)），`receive_id_type` 支持 open_id/union_id/user_id/email/chat_id；类型：text / post(富文本) / image / **file** / audio / media / sticker / **interactive(卡片)** / share_chat / share_user / system。
- 卡片（interactive）：按钮等交互回调（卡片回调可走同一长连接通道）；zcode 的流式卡片（原地更新 + 审批卡）证明卡片适合 agent 长任务呈现。
- 主动消息：机器人可主动给可用范围内用户发 DM（无需用户先发消息）；但用户可关闭接收 bot 消息（错误码 230053）；群内需机器人在群且未禁言。
- 消息体上限：文本 150KB、卡片/富文本 30KB。

## 5. 频率限制（官方数值）

来源：[im/v1/messages 文档](https://open.feishu.cn/document/server-docs/im-v1/message/create)：

- 接口级：**1000 次/分钟、50 次/秒**（每应用）。
- 语义级：向同一用户 **5 QPS**；向同一群组 **5 QPS（群内机器人共享）**。
- 超频返回错误码 230020。

## 6. 文件收发（硬需求）

- **发送**：先 `POST /open-apis/im/v1/files`（[上传文件](https://open.feishu.cn/document/server-docs/im-v1/file/create)）得 `file_key`（音频/视频/文件共用此接口，图片走 im/v1/images）→ 发 file/media/audio/image 消息。注意：**机器人只能发送自己上传的文件**（230017）。文件大小上限（**待验证**，通行值为 30MB，音频有时长约束）。
- **接收**：用户发 file/media/audio/image 消息 → 事件 `im.message.receive_v1` 携带 `file_key` → `GET /open-apis/im/v1/messages/{message_id}/resources/{file_key}?type=file` 下载。素材有时效（file_key 与消息关联，**待验证**确切有效期，收到即转存云盘）。
- 结论：**双向通用文件闭环，满足硬需求**（受单文件上限约束，超大文件走云盘链接）。

## 7. 合规与账号风险

- 平台内容合规：消息内容敏感信息过滤（错误码 230022/230028——明文电话/邮箱可能触发防泄漏审查，agent 回复里注意脱敏）。
- 无逆向、无封号概念；应用维度治理（违规下架应用）。
- 权限模型清晰（scope + 可用范围 + 管理员审批发布），适合组织内灰度。

## 8. SDK 生态

- 官方：`oapi-sdk-python` / `oapi-sdk-nodejs` / `oapi-sdk-go` / `oapi-sdk-java`（含长连接事件支持）。
- Rust：无官方 SDK；社区 [larksuite-oapi-sdk-rs](https://docs.rs/larksuite-oapi-sdk-rs)（覆盖度有限，**待验证**维护状态）。Rust 网关建议按 HTTP API 手写（API 规整，OpenAPI 描述齐全），长连接 WebSocket 协议可参照官方 SDK 源码实现（**待验证**协议是否稳定公开——openclaw feishu 插件用 axios + 官方 ws 端点，证明可独立实现）。

## 9. 云端常驻（NAS Docker）适配

- 长连接事件模式**零公网入站**，纯出站——NAS Docker 场景理想形态。
- 文件上传/下载、token 刷新均出站 HTTP。
- 唯一摩擦：清华大学主用的是自有信息系统而非飞书租户，目标用户得有飞书账号（个人版可注册）。用户群覆盖率是产品问题不是技术问题。
- 结论：**适合度：高。**
