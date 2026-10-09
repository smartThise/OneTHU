# 企业微信（WeCom）Bot 通道调研

> 最后更新：2026-10-09 ｜ 调研基线：企业微信开发者中心官方文档（developer.work.weixin.qq.com）
> 结论先行：**官方 API 成熟、文件收发完备，是「组织内服务」的最稳通道；但它是企业域通道——用户必须进企微通讯录（或经微信插件），纯个人场景不适用。**

## 1. 接入路径

- **自建应用**（OneTHU 场景的唯一现实选择）：在企业（可免费注册，个人可建「组织」无需营业执照，未认证企业有功能与人数限制——具体上限**待验证**）后台创建自建应用，得到 `corpid` + 应用 `secret`。清华场景可考虑以实验室/社团主体注册。
- **第三方应用/代开发**：面向服务商，需要审核与上架流程，OneTHU 不适用。
- **openclaw 生态**：腾讯企微团队官方维护外部插件 [`@wecom/wecom-openclaw-plugin`](https://docs.openclaw.ai/channels/wecom)，说明官方 API 能力足以支撑 agent bot 形态。

## 2. 认证方式

| 项 | 说明 |
| --- | --- |
| 取 token | `GET /gettoken?corpid=&corpsecret=` → `access_token`（**7200s 有效**，需缓存并提前刷新；每企业每 secret 有获取频率限制，重复获取会使旧 token 失效） |
| 发消息 | `POST /message/send?access_token=`，指定 `touser/toparty/totag` + `agentid` |
| 收消息 | **回调模式**：管理后台配置回调 URL + Token + EncodingAESKey；微信服务器 GET 验证 URL（echostr 解密回显）后，消息以 AES 加密 POST 推送，需解密（官方提供各语言加解密库）；响应须 5s 内（超时重试，共 3 次，**待验证**最新重试参数） |
| 加解密 | AES-256-CBC（消息体）+ SHA1 签名（msg_signature 校验） |

## 3. 消息能力

- 应用消息类型：text / image / voice / video / file / textcard / news / mpnews / markdown / miniprogram / taskcard / template_card / update_taskcard 等（[发送应用消息](https://developer.work.weixin.qq.com/document/path/90236)）。
- markdown 消息仅在企微客户端内渲染良好，微信插件侧降级为文本（**待验证**最新表现）。
- **主动 vs 被动**：应用可随时主动推送（受频率限制）；被动回复也有 5s 内 HTTPS 响应的同步回复模式（`safe_duration` 内可多次？——企业微信应用消息无「48h 窗口」概念，这是与微信公众号客服消息的关键差异，主动推送权限更强）。

## 4. 文件收发（硬需求）

- **发送**：先 `POST /media/upload`（[上传临时素材](https://developer.work.weixin.qq.com/document/path/90253)）得 `media_id`（类型 image/voice/video/file），再发对应消息。大小限制（官方长期值，以文档为准）：图片 10MB、语音 2MB（≤60s）、视频 10MB、普通文件 20MB；**media_id 有效期 3 天**。更大文件走异步上传临时素材接口（[文档 97126](https://developer.work.weixin.qq.com/document/path/97126)，**待验证**上限）或转云盘链接。
- **接收**：用户发给应用的消息以回调推送（`msgtype: image/voice/video/file` 携带 `media_id`），`GET /media/get?access_token=&media_id=` 下载，同样受 3 天有效期约束——**收到即转存**是硬要求（OneTHU 管收到即传云盘，天然满足）。

## 5. 频率限制

来源：官方[访问频率限制](https://developer.work.weixin.qq.com/document/path/17009)（数值经[文档镜像](https://wdk-docs.github.io/wework-docs/appendix/access-frequency-restriction/)交叉核对，以官方现值为准）：

- 基础：每企业单个接口 ≤1 万次/分、15 万次/小时；每 IP ≤2 万次/分。
- 应用消息：每应用 ≤ 账号上限 × 200 人次/天；**每应用对同一成员 ≤30 条/分钟**（超出丢弃不报错）。
- 群机器人 webhook：≤20 条/分钟（仅群内推送，不能收消息，不适合 agent 场景，一笔带过）。
- 应用推送群消息（appchat）：每企业 2 万人次/分；成员群内 ≤200 条/分、1 万条/天。

## 6. 与个人微信互通（关键边界）

- 企微应用可通过「**微信插件**」（原企业号，配置见[官方帮助](https://open.work.weixin.qq.com/help2/pc/18121)）触达**关注了该企业微信插件的个人微信用户**：企微应用消息可推到用户微信的「企业微信通知」会话；个人微信用户也可在该会话中回复，消息以回调形式到达应用（[如何接收微信插件消息](https://open.work.weixin.qq.com/help2/pc/18121)）。
- 限制：微信插件侧的消息类型比企微内收敛（文件/图片可用，卡片类降级，**待验证**细节）；用户须先关注插件（扫码）；推送有频控（微信插件消息每人限制——具体条数**待验证**，历史上为每周/每月量级）。
- 这意味着「学生用个人微信 ↔ OneTHU bot」在企微通道是**可行但要先关注插件**，体验是「企业微信通知」号而非普通好友。

## 7. 合规与账号风险

- 自建应用**无需平台审核**（企业内部可见即用）；对外服务、跨企业可见需上架审核。
- 内容：企业微信对营销/骚扰有平台治理，正常助理型 bot 无虞。
- 无个人号封号问题（不涉及逆向）。
- 注意 secret 与 EncodingAESKey 的保管；access_token 泄漏等于应用控制权。

## 8. SDK 生态

- 官方：加解密库（各语言）+ API 无官方全家桶 SDK。
- 社区：Python（`wechatpy` 维护放缓，**待验证**）、Rust（`wecom`/`wecom-rs` 等小 crate，覆盖度参差，建议直接 reqwest 手写——API 面小）、TS（`wecom-sdk`、`@wecom/openapi` 类包若干）。openclaw 生态的 `@wecom/wecom-openclaw-plugin`（TS）可作协议参考。

## 9. 云端常驻（NAS Docker）适配

- 回调模式**需要公网可达 URL**（HTTPS，域名备案建议但非硬性，**待验证**：企业微信回调不强制备案域名）。NAS 家庭网络场景需内网穿透/Cloudflare Tunnel/Lucky STUN 方案（用户已有 Lucky 使用经验）；或借 openclaw 插件的思路改走轮询？——企微**无官方长轮询/长连接收消息**，回调是唯一路径，穿透是硬前提。
- 其余（token 刷新、media 上传下载）纯出站，Docker 友好。
- 结论：**适合云端常驻，前提是解决回调公网入口**。适合度：中高。
