# 00 · OH 多通道 IM 接入架构建议

> 最后更新：2026-10-09 ｜ 依据：本目录 01–06 平台调研 + OneTHU 现状（OH sidecar、onethu.call 门面、seafile 集成、绿联 NAS DXP2800）
> 一句话结论：**新建独立 Rust 网关进程 OneTHU-IM（子模块挂 `plugins/`，与 OneTHU-Harness 同构），借鉴 openclaw 的「core 持策略 / 适配器持翻译」契约；P0 落 微信官方 iLink + 飞书长连接 双通道，文件一律「收到即转存云盘」；OH 侧改动最小化（出站走既有 MCP 机制，入站新增一个 JSON-RPC method）。**

## 1. 设计目标与约束

| 目标 | 说明 |
| --- | --- |
| G1 IM 传入文件 → 清华云盘 | 硬需求；所有通道统一「收到即转存 seafile，回执带链接」 |
| G2 云端常驻 | 绿联 DXP2800 Docker，家庭网络，**无公网入站为默认假设**（可选穿透增强） |
| G3 OH 是唯一 agent | 网关不跑 LLM、不执行校园工具；工具仍经 onethu.call 门禁 |
| G4 多用户安全 | IM 身份 ↔ OneTHU 身份显式绑定；DM 白名单；通道凭据按账号隔离 |
| G5 最小侵入主仓 | OneTHU-Harness 与主仓改动收敛为个位数 PR |

明确非目标：群聊全量消息处理（仅 @ 触发）、非官方协议默认集成（见各平台篇风险）。

## 2. 进程形态：独立网关，而非 OH sidecar 复用

```
┌─ 形态 A：随桌面 App（本地网关，可选）───────┐
│ OneTHU app                                │
│  ├ src-tauri（宿主）                       │
│  ├ onethu.harness sidecar ── stdio RPC ──┐│
│  └ onethu-im sidecar（本方案）←─ 同上 ────┘│
└────────────────────────────────────────────┘
┌─ 形态 B：NAS 常驻（主推）───────────────────┐
│ DXP2800 Docker                             │
│  ┌ onethu-im-gateway 容器 ─────────────┐   │
│  │ 通道适配器×N（出站长连/长轮询）        │   │
│  │ durable ingress(SQLite) / media store │   │
│  │ seafile 转存 / 限速 / 配对绑定         │   │
│  └── WS(JSON-RPC) ─┬───────────────────┘   │
└────────────────────┼───────────────────────┘
                     │（回注桌面 OH；或后续 headless OH）
        ┌─ 用户桌面 OneTHU（OH sidecar 在线时）─┐
```

**不复用 OH sidecar 进程承载通道**，理由：

1. **生命周期不同**：通道要求 7×24 常驻登录态（微信 bot_token、飞书 WS、QQ resume 序列），OH sidecar 随 App 启停；塞进 OH 会让协议会话随 App 退出反复重建。
2. **失败域隔离**：逆向/新协议崩溃（如 CDN 加密变更）不能拖垮 agent 主循环；重连风暴也不该占用 agent 的 turn 预算。
3. **云端形态 OH 不在场**：NAS 上首期只有网关；网关独立于 OH 才能先落地（见 §5 的两种 OH 对接形态）。
4. openclaw 同构印证：gateway（常驻）与 agent runtime（按需起停）也是分开的所有权边界。

网关与 OH、宿主同用一套「独立仓库子模块挂 `plugins/`」的组织方式（OneTHU-Harness 先例），workspace 内含 `gateway`（服务器二进制）与 `core`（协议适配器库），Android/桌面形态未来可复用 `core` 编成 in-process 库（对齐 OH 的双形态惯例）。

## 3. 通道适配器契约（借鉴 openclaw，适配 OH）

### 3.1 职责切分（照抄 openclaw 的最重要一课）

| 归网关 core（策略层） | 归适配器（翻译层） |
| --- | --- |
| DM 白名单 / 配对绑定 / 群 @ 门控 | 平台登录与凭据保存（QR 扫码 / token） |
| 会话键 `session_key=(channel,account,chat)` → OH 会话映射 | 平台会话 ID → chat/thread 的翻译 |
| 入站持久化 + 事件 ID 去重（at-least-once） | 收消息（长轮询/WS/webhook）原始事件 |
| 每 peer 串行队列、全局令牌桶限速 | 发文本/媒体/编辑/typing 的平台 API |
| 媒体统一收口目录 + seafile 转存管线 | 平台限额与格式降级（markdown flavor、分片） |
| 出站幂等键、429/`ret==-14` 退避 | 平台错误码 → 统一错误的映射 |

安全策略**只在 core**：适配器不能自判放行（openclaw 微信插件 2.4.8 的教训，见 [01 篇 §1.4](01-wechat.md)）。

### 3.2 Rust trait 草案

```rust
struct ChannelManifest {
    id: &'static str,                    // "wechat-ilink" | "feishu" | ...
    chat_types: ChatTypes,               // DM / GROUP_MENTION / GROUP_ALL
    caps: Caps,                          // EDIT / TYPING / BUTTONS / FILE_IN / FILE_OUT ...
    rate_profile: RateProfile,           // 令牌桶参数 + 平台特例（-14 暂停等）
    config_schema: schemars::Schema,     // 账号配置（UI 自动渲染）
}

#[async_trait]
trait ChannelAdapter: Send {
    fn manifest(&self) -> &'static ChannelManifest;
    async fn start(&self, acct: AccountId, ctx: AdapterCtx) -> Result<()>;
    async fn stop(&self, acct: AccountId) -> Result<()>;
    async fn probe(&self, acct: AccountId) -> AccountStatus;      // 只读诊断
    async fn login_challenge(&self, acct: AccountId) -> LoginFlow; // QR / URL / bind-code
    async fn send(&self, acct: AccountId, out: Outbound, io: IdempotencyKey) -> Result<MsgReceipt>;
    async fn fetch_attachment(&self, a: &AttachmentRef) -> Result<ByteStream>; // 收到即转存用
}
// 入站方向：适配器把原始事件投给 ctx.ingest()，core 负责持久化/去重/入队/派发
```

配套 core 内组件：`DurableIngress`（SQLite，先落盘再推平台游标）、`SessionRouter`（session_key → OH 会话）、`PairingStore`（绑定表：平台用户 ID ↔ OneTHU 账号，附 `/bind XXXX` 限时码流，借鉴 zcode）、`MediaStore`（单根目录 `/data/media/<channel>/`）、`CloudSink`（seafile 客户端：上传/分享链接）。

### 3.3 通道清单与优先级

| 优先级 | 通道 | 接入面 | 理由 |
| --- | --- | --- | --- |
| **P0** | 微信个人号（官方 iLink） | 长轮询，纯出站 | 清华学生覆盖最广；官方合法；文件闭环；[01](01-wechat.md) |
| **P0** | 飞书（自建应用） | WS 长连接，纯出站 | 能力最全（卡片/流式/文件）；个人版可注册；[05](05-feishu.md) |
| P1 | 企业微信（自建应用） | 回调，需公网入口（穿透/Lucky） | 组织形态强、文件 20MB/3 天；与个人微信互通需关注插件；[03](03-wecom.md) |
| P2 | QQ 官方 bot | WS，纯出站 | 文件不开放+主动停发，仅弱通知定位；[04](04-qq.md) |
| P2 | Telegram | 长轮询+代理 | 技术最自由，但大陆网络/合规双重约束，用户自选；[06](06-telegram.md) |
| 不做 | 非官方协议（wechaty-pad / wcferry / NapCat 系） | — | 封号风险高且持续被打压；如未来提供，仅作用户自担风险的可选插件，不进默认（[01 §3](01-wechat.md)、[04 §2](04-qq.md)） |

## 4. 统一消息与文件模型

```rust
struct InboundMessage {
    event_id: String,            // 平台事件 ID（幂等去重键）
    channel: ChannelId, account: AccountId,
    chat: ChatRef,               // Dm(peer) | Group(id) | Topic(group, topic)
    sender: SenderRef,           // 平台侧稳定 ID（openid / ilink_user_id …）
    text: String, mentions: Vec<SenderRef>,
    attachments: Vec<Attachment>,// {kind: Image|File|Audio|Video, name, size, ref}
    reply_to: Option<MsgId>, ts: DateTime,
}
struct OutboundMessage {
    chat: ChatRef, text: Markdown, // core 按通道 caps 降级：卡片→markdown→纯文本+分片
    attachments: Vec<OutboundFile>,// Local(path) | CloudLink(share_url)（按通道限额自动二选一）
    reply_to: Option<MsgId>, edit_target: Option<MsgId>, // 流式原地更新（飞书卡片/TG editMessage）
}
```

**文件管线（G1）**：入站 attachment → `fetch_attachment()` 流式落 `MediaStore` → `CloudSink` 上传 seafile `/im-import/<channel>/<YYYY-MM-DD>/`（文件名去重）→ 回执「已存云盘：<链接>」；出站文件 > 通道限额（微信 ~100MiB 待验证 / 企微 20MB / 飞书 30MB 待验证 / QQ 官方不支持 / TG 入 20MB 出 50MB）自动改发云盘分享链接。seafile token 走用户在 OneTHU 内授权后下发给网关的受控凭据，网关不存明文密码。

## 5. 与 OH 的对接（两种形态，P0 选 B）

| | 形态 B：回注桌面 OH（zcode 式遥控，**P0 推荐**） | 形态 C：NAS headless OH（P1 可选） |
| --- | --- | --- |
| agent 跑哪 | 用户桌面端 OH sidecar（在线时） | NAS 容器内 OH core（服务器二进制） |
| 校园工具 | 全量（宿主门面 onethu.call 就在桌面） | 仅无宿主依赖子集 + seafile + MCP；webvpn/learn 类凭据需托管，风险高 |
| 网关↔OH | 网关 WS 客户端连桌面 OneTHU（App 在线），断线时网关降级「留言+排队」 | 同容器/同机 RPC |
| 隐私 | 凭据不离用户设备 | 凭据集中托管在 NAS，须加固（盘加密、token 最小化） |

**OH 侧所需改动（两形态共用，改动量刻意收敛）**：

1. **出站（零核心改动）**：网关以 **MCP server** 形态暴露给 OH（复用 OH `mcp.rs` stdio 冷启动机制）：工具 `im_send(chat, text, files?)`、`im_status()`。OH 工具门禁规则照常适用（`onethu.call` 门面外的新 provider 也登记进权限清单）。
2. **入站（一个新 method）**：OneTHU-Harness 新增 JSON-RPC method `agent.inject`（带 session_key + 文本 + 附件云盘链接，创建/续接会话 run）——由桌面 loader 或直接 sidecar 暴露；这是唯一动 OH 核心的点，PR 面很小。附件以云盘链接注入 prompt，agent 需要文件内容时经既有云盘工具拉取。
3. **会话映射**：`SessionRouter` 表存 `(session_key ↔ OH conversation_id)`，`/reset` 类 slash 命令在网关层终结，不打扰 agent。

## 6. 与 OneTHU 主仓的关系

- **推荐：独立仓库 `OneTHU-IM`，以 git submodule 挂 `plugins/OneTHU-IM/`**（完全对齐 OneTHU-Harness 的组织先例）。理由：协议代码（尤其腾讯系新协议）变更频繁、风险面（逆向边界、凭据处理）需要独立审计与发版节奏；主仓只吸收稳定接口（MCP 注册 + `agent.inject` + 文档）。
- 备选否决项：并入 OneTHU-Harness（IO 与 agent 生命周期/失败域耦合）；放主仓 `apps/`（主仓发版被协议追更绑架）。
- 依赖方向：OneTHU-IM 不 import OneTHU-Harness 内部 crate；只依赖 JSON-RPC/MCP 契约（版本化）。

## 7. 部署形态（DXP2800 Docker）

```yaml
# compose 骨架
services:
  onethu-im:
    image: onethu/im-gateway:latest          # Rust 静态二进制 + 基础镜像
    volumes: [ "./data:/data" ]              # SQLite(绑定/ingest) + media + 凭据(加密)
    environment:
      OH_BRIDGE: ws://desktop-or-nas-oh:18790 # §5 对接端点
      SEAFILE_TOKEN_FILE: /data/secrets/seafile
    restart: unless-stopped
    # 网络：默认全出站（微信长轮询 / 飞书 WS / QQ WS / TG 长轮询[+HTTPS_PROXY]）
    # 企微回调启用时再暴露 :8443（经 Lucky/Cloudflare Tunnel 反代，复用用户既有穿透设施）
```

- 资源预估：Rust 单进程 + 2–4 条常驻连接，内存 <100MB 级，DXP2800 绰绰有余。
- 运维面（borrow openclaw）：`inspectAccount` 式只读探活、`/bot-me` 类查询自己平台 ID 的运维命令、通道状态推送（如微信 -14 暂停 1h 时通知用户重新扫码）。
- 桌面 App（形态 A）与 NAS（形态 B）**同一二进制不同开关**，用户可先用本地形态零成本试用，再迁移 NAS 常驻。

## 8. 六通道对比总表

| 维度 | 微信个人号（官方 iLink） | 飞书 | 企业微信 | QQ 官方 | Telegram | 非官方系（对照） |
| --- | --- | --- | --- | --- | --- | --- |
| 接入性质 | 官方（腾讯开源插件+协议） | 官方 | 官方 | 官方 | 官方 | 逆向/hook |
| 入站机制 | HTTP 长轮询 | WS 长连接 / webhook | 回调（需公网） | WS / webhook | 长轮询 / webhook | 各异 |
| 认证 | 扫码→bot_token | app_secret→tenant_token | corpid+secret→token | AppID+Secret | bot token | 账号密码/扫码模拟 |
| 收文件 | ✅（图片/语音/文件/视频） | ✅ 全类型 | ✅ media 3 天 | ⚠️ 仅图/视/音 | ✅ ≤20MB | ✅（完整） |
| 发文件 | ✅ | ✅ ~30MB(待验证) | ✅ ≤20MB | ❌ 文件类未开放 | ✅ ≤50MB | ✅ |
| 频控 | 未文档化（-14 暂停 1h） | 50 QPS；同人/群 5 QPS | 同成员 30 条/分；app 200×规模/天 | 被动 5 回复×窗口；主动停发 | 30/s 全局；群 20/分 | 无约束（更易触发风控） |
| 群聊 | ❌ 仅 DM | ✅（卡片/话题） | ✅ | ✅（@ 触发，窗口 5min） | ✅（privacy mode） | ✅ |
| 账号风险 | 低-中（新平台政策未稳） | 无（应用域治理） | 无 | 无 | 无（bot 域） | **高**（冻结不可申诉） |
| 大陆网络 | ✅ | ✅ | ✅ | ✅ | ❌ 需代理 | ✅ |
| NAS 常驻（无公网） | ✅ | ✅ | ❌（需穿透） | ✅ | ⚠️（代理出站） | ⚠️ |
| Rust SDK | 无（协议小，自研/移植） | 无官方（自写 HTTP+WS） | 无（自写） | 无（自写） | teloxide ✅ | — |
| OneTHU 定位 | **P0 主通道** | **P0 主通道** | P1 | P2 弱通知 | P2 自选 | 不默认集成 |

## 9. 风险清单

| # | 风险 | 等级 | 缓解 |
| --- | --- | --- | --- |
| R1 | 微信 iLink 灰度未覆盖 / 政策收紧（配额、-14 频发） | 中 | 引导走飞书；网关隔离协议层，可快速跟进协议变更（腾讯 MIT 源码在追）；扫码重连 UX 与状态通知 |
| R2 | 微信插件式访问控制缺陷（参考 openclaw 2.4.8 教训）被白名单外用户触达 | 高（安全） | 白名单/绑定逻辑只在 core；默认 `allowlist` 策略 + `/bind` 显式绑定；上线前做未授权触达测试 |
| R3 | 云端凭据集中（seafile token、各通道 bot 凭据） | 高（安全） | /data 加密存储、最小权限 token、桌面端授权下发而非手抄密码、泄漏可单独吊销 |
| R4 | IM 明文回显敏感数据（成绩/课表）触发平台内容审查或隐私泄露 | 中 | 回复脱敏（学号/成绩模糊化）；敏感详情引导 App 内查看 |
| R5 | 企微回调公网入口暴露面 | 中 | P1 再启；反代仅暴露回调路径 + EncodingAESKey 校验；限源 IP |
| R6 | TG 代理依赖与合规 | 中 | P2 自选，文档明示风险，默认关闭 |
| R7 | 非官方协议的用户侧误用 | 中 | 不进默认；文档标注封号事实（学生真实 QQ/微信号可能永久冻结） |
| R8 | OH `agent.inject` 通道被伪造调用 | 高（安全） | WS 鉴权（配对设备 token + challenge 签名，借鉴 openclaw pairing）；仅监听 tailnet/回环 |
| R9 | 平台 API 变更（飞书限频调整、QQ 富媒体政策） | 低-中 | 适配器隔离 + 通道状态探活 + 灰度通道先试 |

## 10. 分期路线

- **P0（本分支后续）**：OneTHU-IM 仓库骨架（gateway + core + wechat-ilink + feishu 适配器）、`/bind` 绑定、文件→seafile 管线、MCP 出站工具 + OH `agent.inject`、桌面本地形态跑通；NAS Docker compose 与镜像。
- **P1**：企微通道（含穿透回调）、流式卡片（飞书原地编辑）、多账号、状态推送与运维命令面板。
- **P2**：QQ 官方弱通知、Telegram 自选通道、（评估后）headless OH on NAS 形态 C。

## 参考

- 平台细节见本目录 [01 微信](01-wechat.md) ｜ [02 openclaw](02-openclaw-architecture.md) ｜ [03 企微](03-wecom.md) ｜ [04 QQ](04-qq.md) ｜ [05 飞书](05-feishu.md) ｜ [06 Telegram](06-telegram.md)
- openclaw：[Gateway architecture](https://docs.openclaw.ai/concepts/architecture) ｜ [Building channel plugins](https://docs.openclaw.ai/plugins/sdk-channel-plugins)
- zcode：[Bot Channel 文档](https://zcode.z.ai/cn/docs/bot-channel) ｜ [zai-org/ZCode](https://github.com/zai-org/ZCode)
