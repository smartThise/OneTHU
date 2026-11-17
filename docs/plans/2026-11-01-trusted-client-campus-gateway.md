# 微信与跨平台校园网关实施计划


> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在完整保留已恢复的 Mac 日常浏览器与 WebDAV 通路的前提下，为「清小搭」与「行在清华」微信小程序打通受限的学校会话复用，并补齐 Windows 与移动端的接入能力、设置入口及平台边界说明。

**Architecture:** 共享学校会话继续由既有的 SDK 与原生账号权威统一持有。系统代理在入口处精细分流：普通浏览器的统一身份请求保持透明直通，而来自微信客户端的身份请求在通过进程签名、目标小程序与学校服务白名单校验后接入受控会话桥；服务票据全部由学校官方接口签发，并严格执行账号、设备与 epoch 隔离。各平台按自身系统机制独立实现连接归因与代理配置，移动端的代理、证书与 VPN 条件均按实机能力显式检测与呈现。

**Tech Stack:** Node HTTP/TLS、现有 gateway / SDK / Tauri、macOS lsof/codesign、Windows 当前 SID / TCP / Authenticode、React 设置与中英 i18n、Node test fixtures。

---

## 约束与检查点

- 网络恢复基线检查点为 `web` 分支 `1a8b1949`，当前运行中的常驻后台为 `6c4966f138e4…`，保持已打开的桌面 GUI 与 WebDAV 挂载稳定不变。
- 全程基于前期调研报告与本项目源码实现协议对接，保持微信客户端安装包、系统签名及第三方证书校验机制完好无损。
- 代码实现、离线测试与本机 Mac 上可自动完成的实测连续推进，免去夜间人工值守配合；暂缺目标真机的测试项在验收报告中如实列明。
- 每次更新常驻后台前均先核验完整的构建产物摘要，通过独立端口完成影子验证后再平滑切换系统代理配置，一旦遇到异常立即回滚至原网络设置。
- 各阶段按下方任务顺序依次闭环推进。

## ADR：接入位置

架构上选定“受限客户端桥 + 透明浏览器通路”的组合方案：普通浏览器访问统一身份站点时保留端到端透明 TLS 与浏览器自身的登录态；微信客户端发起的请求则需同时满足可信进程签名、指定小程序来源与受控学校服务三项条件，方可借用当前 OneTHU 已登录的学校身份。整套方案同步满足系统证书管理、标准 TLS 校验、退出账号即时吊销以及与外部代理和平共存等基础要求。

移动端遵循各自独立的操作系统约束，涵盖 Wi-Fi 手动代理配置、系统级与用户级证书信任差异、Android 单活动 VPN 互斥以及目标应用自身的证书校验策略。为此能力模型明确划分“直接可用”“需完成设备配置”与“当前平台暂未支持”三档状态，在界面中给用户清晰准确的预期。

## Task 1：连接归因与可信微信客户端

**Files:**
- Modify: `packages/gateway/src/macPeer.mjs`
- Create: `packages/gateway/src/windowsPeer.mjs`
- Create: `packages/gateway/src/trustedClient.mjs`
- Test: `packages/gateway/test/macPeer.test.mjs`
- Create: `packages/gateway/test/windowsPeer.test.mjs`
- Create: `packages/gateway/test/trustedClient.test.mjs`

1. 为本机 TCP 连接归因补充精确的客户端 PID 与系统用户记录，同时向后兼容原有的布尔判断接口。
2. 核验客户端安装路径与当前运行二进制的系统代码签名，并将校验结果与当前活跃 socket 生命周期绑定（当前实测观察到的 macOS 腾讯签名团队标识为 `5A4RE8SF68`）。
3. Windows 端联合校验当前用户 SID、目标 TCP 客户端 PID 与有效的 Authenticode 数字签名，所有底层系统工具调用均限定参数边界并设置超时，杜绝 shell 字符串拼接。
4. 严格拦截跨系统用户连接、同名伪造进程、未签名二进制、中途 PID 或套接字变更以及签名检查超时。
5. 跑通全套离线单测及本机 Mac 上的真实签名与 TCP 归因检查，提交阶段性检查点。

## Task 2：身份请求约束与普通浏览器保留

**Files:**
- Create: `packages/gateway/src/clientIdentity.mjs`
- Modify: `packages/gateway/src/index.mjs`
- Modify: `packages/gateway/src/pac.mjs`
- Modify: `packages/gateway/src/manager.mjs`
- Modify: `packages/gateway/src/certificates.mjs`
- Create: `packages/gateway/test/clientIdentity.test.mjs`
- Modify: `packages/gateway/test/manager.test.mjs`

1. 显式登记目标小程序 AppID 与对应的学校业务域名白名单：清小搭 `wxc607b8a0063e7426`、行在清华 `wx3cfa534a23db4039`。
2. 仅当用户主动启用可信客户端接入后，才在 PAC 与网关入口对统一身份域名 `CONNECT` 流量启用按进程分流；普通浏览器流量继续走端到端透明 TLS 与原有网络出口。
3. 微信通道依次核验发起进程签名、小程序真实 `Referer`／业务来源及目标学校服务白名单，将普通网页请求与受信任的原生小程序流量严格区分开。
4. 为学校服务的登录表单页、确认授权页与回调地址分别配置精确的路径与参数白名单，仅处理受控的业务登录换票，拦截未知跳转目标、账号资料修改、密码重置或计划外的短信验证码下发请求。
5. 当用户退出登录、切换账号或关闭该功能开关时立即切断桥接通道，并通过测试夹具确认普通浏览器的身份站 Cookie 与共享会话完全隔离。

## Task 3：SDK 学校会话与桌面服务的衔接

**Files:**
- Create: `packages/sdk/src/node/clientIdentity.ts`
- Modify: `packages/sdk/src/node/session.ts`
- Modify: `packages/sdk/src/index.ts`
- Modify: `apps/desktop/src/lib/xiaoda.ts`
- Modify: `apps/desktop/src/lib/visit.ts`
- Test: `packages/sdk/test/auth-session.test.ts`
- Create: `packages/sdk/test/client-identity.test.ts`

1. 受控身份换票请求直接复用当前权威账号、安装设备指纹与既有信任凭据，自动忽略客户端请求中夹带的非权威身份 Cookie。
2. 官方登录确认沿用本机既有的信任设备身份；一旦学校服务端要求二次验证，原样保留官方验证挑战交由用户确认，免去后台静默下发验证码或新增注册信任设备的副作用。
3. 所有学校服务票据、业务 JWT 与小程序会话均通过官方真实协议申请与兑换，服务级 Cookie 与业务令牌严格按对应站点规范配对核验。
4. 桌面端内部的清小搭与入校报备模块在成功建立学校会话后，同步向后台发布最新的校园会话快照，复用经过验证的局部增量合并与会话归属版本栅栏（owner fencing）。
5. 编写覆盖会话过期刷新、并发请求、账号不匹配、敏感凭据型请求拦截、冷启动恢复与退出吊销的完整回归测试。

## Task 4：Windows 系统接入与共存

**Files:**
- Modify: `packages/gateway/src/platform.mjs`
- Modify: `packages/gateway/src/manager.mjs`
- Test: `packages/gateway/test/platform.test.mjs`
- Test: `packages/gateway/test/windowsPeer.test.mjs`

1. 解析当前 Windows 用户原有的 HTTP / HTTPS / SOCKS 代理与 `bypass` 绕过列表，复用预写恢复日志与逐字段比对还原机制；遇到已开启的第三方自定义 PAC 或 WPAD 时继续主动礼让并给出清晰提示。
2. 为 Windows 系统接入端口补齐当前用户 SID 归因校验与正式启用前的本机连通自检。
3. 清晰区分当前用户的 `CurrentUser`／WinINet 系统代理与部分程序独立维护的 WinHTTP 代理配置，仅在当前用户作用域内按记录接管与还原，保持系统全局及其他用户配置不变。
4. 跑通模拟注册表与系统命令回归测试，并准备好供后续 Windows 真机直接运行的验收脚本与诊断输出。

## Task 5：手机接入能力与配置入口

**Files:**
- Create: `packages/gateway/src/capabilities.mjs`
- Modify: `apps/desktop/src/plugins/panels/CliPanel.tsx`（先核对实际设置面板位置）
- Modify: 对应桌面/手机设置、公共操作目录和中英词典
- Create: `docs/guides/campus-gateway-mobile.md`

1. 将系统全局代理、可信原生客户端分流、手动代理接入、根证书信任、多 VPN 互斥及跨设备配对等维度建成结构化的平台能力模型。
2. 在设置界面提供清晰可执行且随时可还原的配置入口，明确区分“本机内置网关”与“配对连接另一台设备的网关”，默认严禁无鉴权的局域网广播或开放校园会话。
3. 针对 Android 与 iOS 上涉及的系统权限授权、用户根证书安装及第三方应用的证书校验策略，在界面上如实展示当前状态与配置指引，把 OneTHU 应用内直连能力与微信等外部应用的覆盖进度清晰分开呈现。
4. 凡涉及移动端跨设备配对传输的接入凭据，均规划采用双向认证加密并与账号、设备吊销状态实时绑定，避免使用明文长期静态代理口令。
5. 使用能力模型与配置夹具验证桌面与移动三端的界面展示及错误提示，并整理出面向 Android 与 iOS 真机的逐项验收清单。

## Task 6：当前 Mac 验收与最终报告

1. 运行全套 gateway 与 SDK 单元测试、全工作区类型检查以及新增的安全边界回归用例。
2. 在保持现有系统网络配置不动的条件下，先通过影子端口验证新版代码的端到端链路，确认无误后再按既有授权平滑热替换至当前 dev 常驻后台。
3. 逐一复验信息门户（Info）、网络学堂（Learn）可见课程入口、常规公网网站访问，以及本机 WebDAV 挂载读写、新建连接与并发 TCP 稳定性。
4. 在桌面环境直接验证两个 Mac 微信小程序的真实业务登录表现；若个别子页面涉及手动交互或学校二次验证，则完整留存复现入口与实测日志，并在报告中如实标注。
5. 汇总更新实现细节、各平台能力对照、实测矩阵、一键恢复步骤及长期记忆（aimemory），同时保留前期静态协议分析记录与待验证项说明。

## 本轮执行状态

- Task 1–4：代码实现与自动化测试已全部通过；Windows 平台目前已覆盖模拟系统环境与签名边界回归，后续将在 Windows 真机上补充实测。
- Task 3 实测调优：真机联调发现仅挂载共享 ITS Cookie 时学校接口仍会返回密码登录页，因此调整为由桌面端按需申请官方未兑换的短时一次性票据并转交目标服务完成兑换，将单次服务换票与全局 ITS SSO 会话分开精细处理。
- Task 5：已完成跨平台能力模型、移动端设置状态说明及原生实施与真机验收指南；Android/iOS 原生 VPN 系统桥接与跨设备局域网加密配对排入后续独立阶段开发。
- Task 6：已完成本机 Mac dev 热更新部署、两项真实小程序服务官方换票及日常浏览器、学校 API 与 TLS 握手的全面复验；用户实测确认「清小搭」已顺畅进入真实业务主页，修复临时来访入口的官方双斜杠路径后，用户同样确认入校报备页面已正常打开（早期对“微信自身未登录”的初步推测已同步勘误撤回）。「行在清华」下的其余独立 H5 子栏目将继续按白名单逐项核验接入。
- 完整实测证据与系统恢复指引详见 `docs/reviews/2026-11-01-trusted-client-campus-gateway.md`。

- 同日后续跟进：真实跨站小程序子请求与无 `Referer` 顶层导航已分别补齐受限白名单支持；常驻后台热替换全程沿用既有的系统 PAC 地址与监听端口，保持已打开的桌面 GUI 与外部 Clash 代理平稳无感运行，详见审查报告后续检查点。

- 最终可见界面验收：经用户实机点击确认，「清小搭」与「行在清华」来访报备均已顺畅直达业务主页，来访认证请求准确命中共享换票通道并完成官方出票（定位确认学校前端拼接出的 `/login/form//<service>/0` 双斜杠路径即为此前漏配的根因）。最终自动化测试达 gateway 166 项、SDK 308 项全部通过；新版后台产物 `f356231f969e…` 已在当前 dev 环境稳定运行，本轮暂不打包发布新安装器。
