# docs/im-cloud · IM Bot 通道调研与多通道接入架构（dev-im-cloud）

> 调研时间：2026-10-09 ｜ 分支：`dev-im-cloud`（基于 dev3/2b16fa1） ｜ 性质：调研与设计文档，不含产品代码改动
> 背景：为 OneTHU Harness（OH）设计 IM 多通道接入——用户在微信/飞书/企微/QQ/TG 里指挥 OH 干活，**IM 传入文件统一转存清华云盘**，网关候选常驻宿主为绿联 NAS DXP2800（Docker）。

## 阅读顺序

| 文档 | 内容 | 一句话结论 |
| --- | --- | --- |
| [00-architecture.md](00-architecture.md) | **OH 多通道架构建议**（推荐先读） | 独立 Rust 网关 OneTHU-IM（子模块挂 plugins/，与 OneTHU-Harness 同构）；P0 = 微信官方 iLink + 飞书长连接；文件「收到即转存云盘」；OH 侧改动收敛为 MCP 出站 + `agent.inject` 入站 |
| [01-wechat.md](01-wechat.md) | 微信个人号 | 2026-03 起有**官方** iLink Bot 通道（腾讯开源 [openclaw-weixin](https://github.com/Tencent/openclaw-weixin)，扫码授权、长轮询、支持文件，仅单聊）；非官方方案（wechaty-pad/wcferry 等）封号风险高，一律不默认集成 |
| [02-openclaw-architecture.md](02-openclaw-architecture.md) | openclaw 网关与渠道插件架构（附 zcode） | 精髓是「core 持策略 / 适配器持平台翻译」+ durable ingress + pairing；腾讯系三大平台官方均按其契约出货插件；zcode 的 `/bind` 与流式卡片值得抄 |
| [03-wecom.md](03-wecom.md) | 企业微信 | 官方 API 成熟、文件 20MB/3 天闭环；回调模式需公网入口（穿透前提）；组织域通道，个人微信须经「微信插件」关注互通 |
| [04-qq.md](04-qq.md) | QQ 官方 + 非官方 | 官方：**主动消息 2025-04-21 起停发**、文件类富媒体不开放、被动 5min×5 次窗口——只配弱通知；非官方（NapCat/Milky 系）功能全但持续被打压、冻结不可申诉，不默认 |
| [05-feishu.md](05-feishu.md) | 飞书 | 能力最全：WS 长连接事件**免公网**、卡片交互、文件双向闭环、限频明确（同人/群 5 QPS）——NAS 常驻最友好，P0 通道 |
| [06-telegram.md](06-telegram.md) | Telegram | API 最自由（30/s 全局、文件 20MB 入/50MB 出）；但大陆网络+合规双重约束，定位 P2 用户自选（自带代理） |

## 核心对比（详见 00 §8）

| | 微信官方 iLink | 飞书 | 企微 | QQ 官方 | TG | 非官方系 |
| --- | --- | --- | --- | --- | --- | --- |
| 合法性 | 官方 | 官方 | 官方 | 官方 | 官方 | 违规 |
| 文件闭环 | ✅ | ✅ | ✅(20MB/3天) | ❌ | ✅(20/50MB) | ✅ |
| 无公网可常驻 | ✅ | ✅ | ❌ | ✅ | ⚠️代理 | 视方案 |
| 账号风险 | 低-中 | 无 | 无 | 无 | 无 | **高** |

## 决策摘要

1. **P0 双通道**：微信官方 iLink（学生覆盖）+ 飞书自建应用（能力标杆），两者都纯出站、NAS Docker 直装。
2. **独立仓库** OneTHU-IM 子模块（对齐 OneTHU-Harness 先例），网关与 OH 解耦：OH 仍是唯一 agent，工具仍过 onethu.call 门禁。
3. **文件硬需求**统一管线：收到即转存 seafile → 回执云盘链接；出站超限额自动转云盘分享链接。
4. **不做**：非官方微信/QQ 协议默认集成（封号风险如实告知，见 01/04 风险节）；QQ 官方仅弱通知定位。
