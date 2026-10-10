# docs/im-cloud · IM Bot 通道调研与多通道接入架构（dev-im-cloud）

> 调研时间：2026-10-09（同日修订：无后端形态主案） ｜ 分支：`dev-im-cloud`（基于 dev3/2b16fa1） ｜ 性质：调研与设计文档，不含产品代码改动
> 背景：为 OneTHU Harness（OH）设计 IM 多通道接入——用户在微信/飞书/企微/QQ/TG 里指挥 OH 干活，**IM 传入文件统一转存清华云盘**。**用户拍板：不要任何后端网关（NAS/服务器否决），桌面 App 直连承载通道。**

## 阅读顺序

| 文档 | 内容 | 一句话结论 |
| --- | --- | --- |
| [00-architecture.md](00-architecture.md) | **OH 多通道架构建议（无后端主案）**（推荐先读） | 桌面 App 宿主 TS 层直连承载通道（App 常驻=bot 在线）；P0 = 微信官方 iLink + 飞书长连接；文件「收到即转存云盘」（seafile.rs→Files Hub）；OH 侧改动仅 `agent.inject` 入站、出站零改动；原独立 Rust 网关方案降为附录 A 留档（用户已否决） |
| [01-wechat.md](01-wechat.md) | 微信个人号 | 2026-03 起有**官方** iLink Bot 通道（腾讯开源 [openclaw-weixin](https://github.com/Tencent/openclaw-weixin)，扫码授权、长轮询、支持文件，仅单聊）；非官方方案（wechaty-pad/wcferry 等）封号风险高，一律不默认集成 |
| [02-openclaw-architecture.md](02-openclaw-architecture.md) | openclaw 网关与渠道插件架构（附 zcode） | 精髓是「core 持策略 / 适配器持平台翻译」+ durable ingress + pairing；腾讯系三大平台官方均按其契约出货插件；zcode 的 `/bind` 与流式卡片值得抄 |
| [03-wecom.md](03-wecom.md) | 企业微信 | 官方 API 成熟、文件 20MB/3 天闭环；回调模式需公网入口（穿透前提）；组织域通道，个人微信须经「微信插件」关注互通。**无后端主案下出局**（回调不可达），至多保留单向推送降级形态 |
| [04-qq.md](04-qq.md) | QQ 官方 + 非官方 | 官方：**主动消息 2025-04-21 起停发**、文件类富媒体不开放、被动 5min×5 次窗口——只配弱通知；非官方（NapCat/Milky 系）功能全但持续被打压、冻结不可申诉，不默认 |
| [05-feishu.md](05-feishu.md) | 飞书 | 能力最全：WS 长连接事件**免公网**、卡片交互、文件双向闭环、限频明确（同人/群 5 QPS）——桌面直连最友好，P0 通道 |
| [06-telegram.md](06-telegram.md) | Telegram | API 最自由（30/s 全局、文件 20MB 入/50MB 出）；但大陆网络+合规双重约束，定位 P2 用户自选（自带代理） |

## 核心对比（详见 00 §5/§8）

| | 微信官方 iLink | 飞书 | 企微 | QQ 官方 | TG | 非官方系 |
| --- | --- | --- | --- | --- | --- | --- |
| 合法性 | 官方 | 官方 | 官方 | 官方 | 官方 | 违规 |
| 文件闭环 | ✅ | ✅ | ✅(20MB/3天) | ❌ | ✅(20/50MB) | ✅ |
| 无公网纯出站（桌面直连可行） | ✅ | ✅ | ❌（回调需公网） | ✅ | ⚠️代理 | 视方案 |
| 账号风险 | 低-中 | 无 | 无 | 无 | 无 | **高** |

## 决策摘要

1. **无后端主案**：通道层跑在桌面 OneTHU App 宿主 TS 层（`apps/desktop/src/im/`），App 常驻=bot 在线、关机即离线（常驻性权衡见 00 §6，用户已接受；Android 受 DOZE/厂商后台限制不作通道载体）。
2. **P0 双通道**：微信官方 iLink（学生覆盖，HTTP 长轮询纯出站）+ 飞书自建应用（能力标杆，WS 长连接免公网）。
3. **OH 对接**：入站 `callRust → agent.inject`（唯一 harness 改动）；出站=run 回复原路发回（零改动）；附件经 seafile.rs 上云盘、与 Files Hub 汇合。
4. **企微出局**（无后端形态回调不可达）；**QQ 官方**维持 P2 弱通知；**TG** P2 自选（大陆网络约束不变）。
5. **不做**：非官方微信/QQ 协议默认集成（封号风险如实告知，见 01/04 风险节）。原「独立 Rust 网关 OneTHU-IM」方案见 00 附录 A（用户已否决，留档备查）。
