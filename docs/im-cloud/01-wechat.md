# 微信个人号 Bot 通道调研

> 归档说明：本文记录当时的微信通道调研与技术评估；0.11 当前功能与使用指南请查阅 [文档入口](../README.md)（[English overview](../en/index.md)）。

> 最后更新：2026-11-18 01:30
> 结论先行：**2026 年 3 月起，微信官方为个人账号开放了合规的 AI Bot 接入通道（iLink Bot / ClawBot 插件），OneTHU 应优先采用该官方路径；各类非官方协议（Web 协议模拟、PC 客户端 Hook 注入、第三方 Pad 协议）均存在较高的账号封禁风险，不宜纳入产品方案。**

## 1. 官方通道：微信 iLink Bot（ClawBot 插件）

### 1.1 背景与时间线

- 微信于 **2026 年 3 月**正式上线 ClawBot 插件入口：客户端版本需 **8.0.70+**，入口位于「我 → 设置 → 插件」，由腾讯**分批灰度**向个人账号开放（转引自[七牛云 DSH 接入微信实操文](https://news.qiniu.com/archives/1787733470435)，原始出处为新浪财经 2026-03-22 报道，具体灰度覆盖比例有待实测确认）。
- 同期腾讯微信团队在 GitHub 开源了 OpenClaw 渠道插件 [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin)（npm：[`@tencent-weixin/openclaw-weixin`](https://www.npmjs.com/package/@tencent-weixin/openclaw-weixin)，MIT 协议，维护者均为 `@tencent.com` 邮箱），首版发布于 2026-03-21，截至 2026-10 最新版本为 2.4.9（2026-09-17 发布）。
- 这是**微信个人号目前唯一的官方合规机器人接入路径**；在此之前，个人号自动化普遍依赖逆向或客户端注入等非官方手段（详见 §3）。

### 1.2 接入方式与协议

iLink Bot 后端 API（默认端点 `https://ilinkai.weixin.qq.com`）采用 HTTPS + JSON 通信，完整协议定义见[微信后端 API 协议](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol_zh_CN.md)。核心流程如下：

| 环节 | 机制 |
| --- | --- |
| 登录 | `POST /ilink/bot/get_bot_qrcode?bot_type=3` 获取二维码 → 手机微信扫码授权（按提示可能触发验证码 `need_verifycode`）→ `GET /get_qrcode_status` 轮询至 `confirmed`，返回 `bot_token`、`ilink_bot_id` 与扫码人 `ilink_user_id`，凭据加密保存于本地 |
| 认证 | 请求头携带 `AuthorizationType: ilink_bot_token`、`Authorization: Bearer <bot_token>`、`iLink-App-Id: bot` 及随机生成的 `X-WECHAT-UIN` |
| 收消息 | `POST /ilink/bot/getupdates` **HTTP 长轮询**（服务端建议超时 35s），每次回传游标 `get_updates_buf`；若返回 `ret/errcode == -14`，需按服务端保护策略暂停会话 1 小时 |
| 发消息 | `POST /ilink/bot/sendmessage`，消息体 `item_list` 支持文本（1）、图片（2）、语音（3）、文件（4）、视频（5），回复时需附带入站消息的 `context_token` 会话上下文令牌 |
| 文件收发 | 先调用 `POST /ilink/bot/getuploadurl`（提交文件明文 MD5 及 AES-128-ECB/PKCS#7 密文大小）→ 将加密内容 PUT 上传至 CDN（默认 `novac2c.cdn.weixin.qq.com/c2c`）→ 再通过 `sendMessage` 携带媒体引用（`encrypt_query_param` + `aes_key`）发出；接收附件则从 `full_url` 或 CDN `/download` 下载后做 AES 解密 |
| 输入状态 | 调用 `getConfig` 获取 `typing_ticket` → `sendTyping`（status 1 正在输入 / 2 取消） |
| 生命周期 | 通道启动或停止时调用 `notifyStart` / `notifyStop` |

这套消息模型原生围绕 AI Agent 交互设计：内建 `message_type`（1 用户 / 2 Bot）、`message_state`（0 新建 / 1 生成中 / 2 完成）与 `run_id`（运行标识），并预留了 `tool_call_start_item` / `tool_call_result_item` 等结构，便于后续展示工具调用进度。

### 1.3 能力边界（截至 2026-10，openclaw-weixin 2.4.x）

- **当前面向单聊（DM）场景开放**（底层协议结构虽预留了 `group_id` 字段，官方插件能力声明仍限定为单聊模式，参见 [OpenClaw 微信通道文档](https://docs.openclaw.ai/channels/wechat)）。
- 支持文本、图片、语音、文件、视频双向收发；入站语音消息可直接附带官方语音转文字结果（`voice_item.text`）。
- 单个宿主可同时挂载多个扫码授权的微信通道实例。
- 出站发送媒体时默认省略缩略图（`no_need_thumb: true`）；官方文档暂未公布单文件大小上限与请求配额（**待实测确认**，社区项目 [dsh-channels 文档](https://github.com/wsz987/dsh-channels) 实测反馈单文件入站上限约为 100 MiB 量级）。
- 引用回复（quote）依赖客户端本地消息缓存还原上下文（官方插件默认缓存文本 30 天、媒体 7 天 / 256 MiB）。

### 1.4 账号与合规风险评估

- **协议层安全合规**：iLink 后端直接运行在腾讯官方 `weixin.qq.com` 域名下。用户扫码的本质是授权开通与指定机器人的私聊通道，个人账号仍在手机微信官方客户端正常在线，规避了第三方模拟客户端登录引发的账号风控。
- **平台处于早期演进阶段**：目前插件入口仍按批次灰度开放，且协议中设有 `ret == -14` 会话暂停 1 小时等服务端主动限流保护，后续配额与频控策略可能随业务演进调整（**待持续观察**）。此外，OpenClaw 官方文档指出其 2.4.8 版本因缺少 pairing 适配器，在空 allowlist 且未记录扫码人 ID 时会放行任意发送者；OneTHU 自研接入时**必须在核心层独立落实发送者白名单校验**（参见 [WeChat channel 文档 Access control 节](https://docs.openclaw.ai/channels/wechat)）。
- **回复内容合规与隐私保护**：机器人发送的消息同样受微信平台内容规范约束，对课表、成绩等校园个人敏感信息应做好摘要脱敏，完整数据引导用户回到 OneTHU 应用内查看。
- 小结：采用官方 iLink 通道后，账号安全风险已由传统非官方方案的**高风险**降至**低至中等可控水平**（日常只需做好发送频率控制与防滥用限流）。

### 1.5 SDK 生态

- 腾讯官方提供 TypeScript 参考实现（`Tencent/openclaw-weixin`，依赖精简，仅用 `zod` 与 `qrcode-terminal`），采用 MIT 协议，非常适合直接参考移植到桌面端 TS 层。
- 社区 dsh 生态已有多个独立移植案例：[xmanrui/dsh-im](https://github.com/xmanrui/dsh-im)（支持 9 种渠道，约 393 star，2026-08）、[wsz987/dsh-channels](https://github.com/wsz987/dsh-channels)（支持 PDF/DOCX 附件提取、单文件 100 MiB 上限）以及轻量级单渠道实现 `dsh-weixin`，充分验证了该协议脱离 openclaw 宿主独立运行的可行性。
- Rust 生态暂未出现现成 crate；由于协议接口精简（二维码轮询 + 长轮询 + AES-ECB CDN），若后续有原生实现需求，开发工作量也在可控的数天级别。

## 2. 其他生态宿主方案

| 方案 | 形态 | 说明 |
| --- | --- | --- |
| [OpenClaw](https://openclaw.ai/) | 独立 Agent 网关 | 腾讯官方插件即面向其渠道生态发布，详见 [02 篇](02-openclaw-architecture.md) |
| dsh 插件族 | Harness 内置渠道插件 | 包括 dsh-im / dsh-channels / dsh-weixin，见上文 |
| Linclaw 等桌面集成 | 桌面 Agent 预置渠道 | 七牛云 Linclaw 等桌面端集成实践（转引） |

OneTHU 在桌面宿主 TS 层直接内建轻量 iLink 协议适配器即可，整体分层契约详见 [00-architecture.md](00-architecture.md)。

## 3. 非官方个人号方案现状（风险对照）

> 背景说明：下表前几类非官方方案均依赖**协议逆向模拟或客户端注入**，违反微信软件许可及服务协议，长期处于平台安全风控的重点治理范围内。OneTHU 面向在校师生提供日常服务，必须优先保障用户个人社交账号的安全。

| 方案 | 原理 | 2025–2026 现状 | 风险评级 |
| --- | --- | --- | --- |
| **wechaty**（及各 puppet） | puppet 抽象层：Web 协议（wechat4u）/ Pad 协议（第三方付费 token 服务）/ Windows Hook（wechaty-puppet-xp） | 项目仍在维护，可用性取决于底层 puppet：Web 协议自 2017 年起限制大部分账号登录；Pad 协议依赖外部灰色商业服务，存在合规与服务中断风险；Hook 方案强绑定 Windows 与特定微信客户端版本 | **高**（Web 多数账号受限；Pad 依赖灰色付费服务；Hook 随客户端升级失效） |
| **WeChatFerry / wcferry** | 向 Windows 微信客户端注入 DLL（Hook），通过 Python/HTTP RPC 暴露收发接口 | [lich0821/WeChatFerry](https://github.com/lich0821/WeChatFerry) 持续跟进 Windows 微信版本更新（发版延续至 2026 年），每次客户端升级均需重新适配，且必须常驻运行真实 Windows 微信客户端 | **高**（客户端注入检测 + 版本强耦合 + 依赖特定桌面环境） |
| **chatgpt-on-wechat / ntchat / xbot 等** | 多为上述底层协议的上层封装 | 随着官方通道开放，社区项目明显分化，主流维护活跃项目已逐步迁移至官方 iLink、企业微信或公众号 | **高** |
| **公众号 / 微信客服（官方）** | 服务号客服消息、微信客服开放接口 | 官方合规路径，面向组织或企业服务号主体，受 48 小时互动回复窗口与主体认证要求限制 | **合规但场景受限**（需企业或组织主体认证，与个人学习助理私聊体验差异较大） |

**平台治理背景**：微信长期严格管控第三方非官方客户端接入（例如 2017 年起逐步收回大部分账号的网页版微信登录权限），并在 2026 年直接推出官方 iLink Bot 通道来承接个人 AI 助手需求。社区中因使用逆向或注入工具导致个人微信号受限乃至封禁的案例长期存在，且通常难以申诉解封，因此**切勿在承载真实社交关系的个人微信号上尝试非官方接入方案**。

## 4. 对 OneTHU 的结论

1. **采用官方 iLink Bot 作为主力通道**：合法合规、支持双向文件收发、基于纯出站 HTTP 长轮询（天然契合桌面端直连），且腾讯官方参考实现采用 MIT 协议开源，便于移植维护；后续需实测确认灰度覆盖率以及文件大小和频率配额。
2. **内建严格的身份绑定与白名单**：在核心层实现 OneTHU 账号与微信 `ilink_user_id` 的一对一绑定及发送者白名单校验，补齐早期第三方插件的访问控制短板。
3. **坚守官方合规边界**：产品主路径仅集成官方 iLink 通道，规避 wechaty-pad、hook、wcferry 等非官方方案带来的账号安全隐患。
4. **多通道互补兜底**：若部分用户的微信客户端暂未灰度到 ClawBot 插件入口，可在设置页引导其选用飞书长连接通道（详见 [00-architecture.md](00-architecture.md) §5）。

## 参考

- [Tencent/openclaw-weixin（源码 + 协议文档）](https://github.com/Tencent/openclaw-weixin)
- [微信后端 API 协议（protocol_zh_CN.md）](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol_zh_CN.md)
- [OpenClaw WeChat 通道文档](https://docs.openclaw.ai/channels/wechat)
- [npm @tencent-weixin/openclaw-weixin（版本与维护者信息）](https://registry.npmjs.org/@tencent-weixin/openclaw-weixin)
- [七牛云：DeepSeek Harness 如何连接微信（四条路线与扫码接入实操）](https://news.qiniu.com/archives/1787733470435)
- [CSDN：把 AI 智能体接入微信（腾讯官方 iLink Bot API）](https://grapecity.csdn.net/6a8936c710ee7a33f29dae65.html)（转引，供交叉印证）
- [lich0821/WeChatFerry](https://github.com/lich0821/WeChatFerry)
