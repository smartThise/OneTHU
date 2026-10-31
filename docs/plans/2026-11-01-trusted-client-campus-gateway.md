# 微信与跨平台校园网关实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 保留已恢复的 Mac 浏览器 / WebDAV，接入清小搭与行在清华的受限学校会话，并补齐 Windows 与手机的接入能力、入口和真实限制。

**Architecture:** 共享学校会话仍由现有 SDK / 原生账号权威持有。系统代理区分普通浏览器透明身份流量与有进程、应用和服务约束的微信身份请求；服务票据由学校签发，账号、设备和 epoch 继续隔离。各平台分别实现连接归因和代理接入，手机的代理 / 证书 / VPN 能力显式检测，不把 Mac PAC 当成通用全设备方案。

**Tech Stack:** Node HTTP/TLS、现有 gateway / SDK / Tauri、macOS lsof/codesign、Windows 当前 SID / TCP / Authenticode、React 设置与中英 i18n、Node test fixtures。

---

## 约束与检查点

- 网络恢复检查点：`web` / `1a8b1949`。当前后台 `6c4966f138e4…`；GUI 和 WebDAV 保持原样。
- 本 agent 不运行 REA、不重新解包微信、不修改微信程序或绕过第三方证书保护。使用已有报告及本项目源码。
- 不要求用户半夜操作；实现、离线验证与当前 Mac 的可执行验证连续推进，真实设备缺失的项目如实记录。
- 每次部署先校验完整 artifact，先影子验证，再切系统设置；失败恢复原网络。
- 用户已要求本会话连续完成，按以下顺序执行，不再询问执行方式。

## ADR：接入位置

选择“受限客户端桥 + 透明浏览器通路”，不选择全局解除身份域保护，也不注入或修改微信程序。原因是普通浏览器应保留自己的身份站 TLS 和会话；微信请求只有满足可信进程与应用 / 服务约束时才可借用当前学校身份。系统证书、TLS 验证、账号退出撤销和原代理共存是非功能要求。

手机有独立约束：Wi-Fi 手动代理、系统证书、Android VPN 与其他 VPN 冲突、目标 App 的 CA 信任不能从桌面推定。实现中需要区分“可用入口”“需要设备配置”“该平台当前不具备能力”，不提供伪成功状态。

## Task 1：连接归因与可信微信客户端

**Files:**
- Modify: `packages/gateway/src/macPeer.mjs`
- Create: `packages/gateway/src/windowsPeer.mjs`
- Create: `packages/gateway/src/trustedClient.mjs`
- Test: `packages/gateway/test/macPeer.test.mjs`
- Create: `packages/gateway/test/windowsPeer.test.mjs`
- Create: `packages/gateway/test/trustedClient.test.mjs`

1. 增加精确 TCP 归因的 PID / 用户记录，保留现有返回 true 的兼容接口。
2. 验证安装位置与当前运行文件的系统签名，缓存绑定同一活跃 socket；Mac 腾讯签名团队当前观察为 `5A4RE8SF68`。
3. Windows 采用当前 SID、目标 TCP 客户端 PID 与有效 Authenticode，构造与系统命令均需有界、无 shell 拼接。
4. 拒绝另一用户、伪造进程名、未签名文件、PID/连接变化和超时。
5. 运行对应离线测试和当前 Mac 的签名 / TCP 验证；提交检查点。

## Task 2：身份请求约束与普通浏览器保留

**Files:**
- Create: `packages/gateway/src/clientIdentity.mjs`
- Modify: `packages/gateway/src/index.mjs`
- Modify: `packages/gateway/src/pac.mjs`
- Modify: `packages/gateway/src/manager.mjs`
- Modify: `packages/gateway/src/certificates.mjs`
- Create: `packages/gateway/test/clientIdentity.test.mjs`
- Modify: `packages/gateway/test/manager.test.mjs`

1. 明确注册两小程序及学校服务来源：清小搭 `wxc607b8a0063e7426`，行在清华 `wx3cfa534a23db4039`。
2. 身份站 CONNECT 仅在该能力启用后进入分流；普通浏览器继续端到端透明 TLS，并使用原出口。
3. 微信流量先验证进程，再验证实际小程序 Referer / 业务来源与受限学校服务，浏览器来源请求不能伪装成原生客户端。
4. 学校服务表单、确认、回调分别设约束；不接受任意目标、账号修改、密码变更或任意验证码投递。
5. 退出、账号切换、能力关闭撤销桥接；用 fixtures 验证普通浏览器身份 Cookie 不进入共享通道。

## Task 3：SDK 学校会话与桌面服务的衔接

**Files:**
- Create: `packages/sdk/src/node/clientIdentity.ts`
- Modify: `packages/sdk/src/node/session.ts`
- Modify: `packages/sdk/src/index.ts`
- Modify: `apps/desktop/src/lib/xiaoda.ts`
- Modify: `apps/desktop/src/lib/visit.ts`
- Test: `packages/sdk/test/auth-session.test.ts`
- Create: `packages/sdk/test/client-identity.test.ts`

1. 身份请求复用当前账号、安装指纹和既有信任，忽略不属于当前权威的客户端身份 Cookie。
2. 对官方确认使用既有设备身份；实际二次验证保留官方挑战，不自动发验证码或登记新设备。
3. 不伪造学校票据、业务 JWT 或小程序已登录状态；服务 Cookie / 业务令牌按其真实协议配对和验证。
4. 桌面清小搭 / 来访服务成功建立学校会话后，发布 live 大学会话，沿用已验证的局部合并和 owner fencing。
5. 针对会话过期、并发、账号不符、凭据型请求、冷启动与撤销编写回归。

## Task 4：Windows 系统接入与共存

**Files:**
- Modify: `packages/gateway/src/platform.mjs`
- Modify: `packages/gateway/src/manager.mjs`
- Test: `packages/gateway/test/platform.test.mjs`
- Test: `packages/gateway/test/windowsPeer.test.mjs`

1. 解析当前用户原 HTTP / HTTPS / SOCKS / bypass，复用写前记录和比较恢复；未知 PAC / WPAD 继续明确拒绝。
2. 为 Windows 提供当前用户归因监听与启用前真实自检。
3. 区分 CurrentUser / WinINet 代理与自行配置的 WinHTTP 客户端，不擅自覆盖全系统或其他用户配置。
4. 完成模拟系统测试；没有 Windows 真机时提供可直接运行的验收入口和诊断。

## Task 5：手机接入能力与配置入口

**Files:**
- Create: `packages/gateway/src/capabilities.mjs`
- Modify: `apps/desktop/src/plugins/panels/CliPanel.tsx`（先核对实际设置面板位置）
- Modify: 对应桌面/手机设置、公共操作目录和中英词典
- Create: `docs/guides/campus-gateway-mobile.md`

1. 将系统代理、原生客户端、手动接入、证书信任、VPN 冲突、设备配对等能力显式建模。
2. 提供可执行、可恢复的配置入口，区分本机网关与另一个设备的网关；禁止无鉴权 LAN 广播或默认暴露学校会话。
3. Android / iOS 如需系统授权、证书或外部 App 信任配合，界面准确说明；不以修改 OneTHU 自身网络配置冒充微信已覆盖。
4. 手机跨设备链路如涉及凭据传输，使用受认证的加密与账号/设备撤销约束，避免明文长期代理口令。
5. 用能力/配置 fixture 验证三端 UI 与错误信息，给出 Android、iOS 真实验收清单。

## Task 6：当前 Mac 验收与最终报告

1. 完整 gateway / SDK 检查、类型检查和新增安全边界测试。
2. 原网络未改动时先验证新代码的端到端通路，再按当前授权加载到原 dev 后台。
3. 复验 Info、Learn 可见课程入口、原普通外网和 WebDAV 挂载 / 新连接 / 并发 TCP 证明。
4. 在界面可用的条件下验证两个 Mac 微信小程序的真实业务身份；界面或学校验证需要外部条件时，保留明确可验收入口与证据，不宣称完成真机测试。
5. 更新实现 / 平台能力 / 实测矩阵 / 恢复步骤报告和 aimemory，保留已有静态分析与其不确定性。

## 本轮执行状态

- Task 1–4：已实现与验证；Windows 仅有模拟系统 / 签名边界测试，未宣称真机验收。
- Task 3 最终调整：实测共享 ITS Cookie 仍返回密码表单，故采用 GUI 签发并转交未兑换的短时官方票据。没有把 GUI 业务登录成功当成全局 ITS SSO 成功。
- Task 5：完成能力模型、手机设置说明与原生实施 / 验收指南。Android/iOS 原生 VPN / 系统桥和跨设备 LAN 配对未实现。
- Task 6：完成原 Mac dev 部署、两项真实服务出票和浏览器 / 学校 API / TLS 复验；微信自身要求重新登录，阻塞两个小程序界面的最终实测。行在清华其他独立 H5 仍待逐项验收，未泛化放行未知 ITS 服务。
- 详细证据与恢复路径见 `docs/reviews/2026-11-01-trusted-client-campus-gateway.md`。
