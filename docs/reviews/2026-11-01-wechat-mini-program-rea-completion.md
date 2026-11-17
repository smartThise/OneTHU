# 微信「清小搭 / 行在清华」REA 完成与网络事故交接报告


日期：2026-11-01 凌晨，Asia/Shanghai。接续自 [2026-10-31 条件性交接](2026-10-31-wechat-mini-program-rea-handoff.md)；本轮获用户授权启动分析与验证，中途因触发校园网连接中断按用户要求暂停并整理本报告。

> 归档说明：后续网络恢复与完整验收已完成，当前运行状态请以 [浏览器 / WebDAV 恢复记录](2026-11-01-network-webdav-recovery.md) 为准。下文 §0 和 §4.3 保留事故发生时的现场状态与应急建议；现行方案已支持保持 WebDAV 挂载运行，后台更新请统一走完整构建与清单核验流程，避免仅复制部分 SDK 文件或手工重算哈希。阅读 §2 时请注意区分小程序静态代码分析与真实流量归因：本地 `curl` 触发相同拒绝分支仅验证了网关端口规则，微信客户端是否实际走系统 PAC 仍需结合进程连接记录确认。

## 0. 当前状态（最重要的部分）

| 项 | 状态 |
| --- | --- |
| 用户网络 | **已恢复**。`gateway system-disable --confirm` 已执行，系统代理切回原有的 Clash 手动代理 `127.0.0.1:7897`（`scutil` 确认 HTTP/HTTPS=7897、PAC 已卸载）。`info.tsinghua.edu.cn` 302、`www.xiaoda.tsinghua.edu.cn` 200、经 Clash 访问外网 200，均实测可达。 |
| OneTHU 后台 daemon | 运行中（新 runtime，见下），会话完好：`authenticated`、`ready`、`epoch` 19、账号 `***3332`。 |
| 校园会话借用（系统代理 PAC） | **暂时关闭**（`system-disable`）。为优先恢复用户日常网络而临时停用，重新开启步骤见 §4.3。 |
| dev 预览 GUI（5180 + dev wrapper） | 保持原状运行，未重启。 |
| 仓库 | `web` 分支，HEAD `7554b8af`，工作区干净。 |
| 事故责任 | 本轮在部署重启 daemon 后未先在本地预检 `CONNECT` 全链路，触发既有 `lsof` 挂载兼容缺陷导致校园 HTTPS 请求返回 503，随即回滚系统网络设置并停手交接，详见 §4。 |

## 1. 静态 REA 结论（两个小程序，已完成）

### 1.1 清小搭小程序（wxc607b8a0063e7426，包版本目录 177）

用户于 2026-10-31 22:16 打开；小程序包大小 2,877,806 字节，采用 `V1MMWX` 加密，已使用既有工具链完成解密（密钥材料为 `appid`，方法参见记忆笔记「学生清华小程序 API 拆解」）。解包产物位于 `/tmp/wxapkg-candidates/wxc607b8a0063e7426/src/`（共 293 个文件，随 `/tmp` 清理回收；解包工具位于 `/Volumes/PortableSSD/Projects/thuapp/miniapp-analysis/`）。

关键结论（经 `app-service.js` 模块静态核实）：

| 项 | 结论 |
| --- | --- |
| 入口页 | `pages/login/index`；登录组件 `components/oauth-popup`（模块 85332） |
| 后端 | 与网页版共用同一后端 `https://www.xiaoda.tsinghua.edu.cn`（模块 14537 `Api_url`） |
| 业务鉴权 | 自定义 `token` 头 = `getStorageSync("token")`（模块 71107），收到业务码 2001/2002 时清空 token 并重新登录，与 OneTHU `XiaodaClient` 的 JWT 属于同一认证体系 |
| 登录链路 | **原生 `wx.request`（非 `web-view`）执行完整 ITS 表单登录**：`GET id.tsinghua.edu.cn/do/off/ui/auth/login/form/d982b795884e882abfa8ff3167aeb03e/0?/login.html`（**与 OneTHU 网页客户端使用同一 service id**）→ `POST …/login/check`（`i_user` / `i_pass`(SM2) / `fingerPrint` / `i_captcha`）→ 2FA（`id.tsinghua.edu.cn/b/doubleAuth/login`，支持企业微信验证码 / TOTP / 短信）→ 成功页锚点 → 按需调用 `roam("id","10000ea055dd8d81d09d5a1ba55d39ad")` → `GET www.xiaoda…/api/token/login?ticket=…` 兑换 JWT |
| Cookie 管理 | 小程序自带内存 Cookie jar（`idp` 域单独分组，模块 43737），手动跟随 302/307/308 跳转，独立于系统 Cookie 存储 |
| 凭据存放 | storage 键 `token`（JWT 有效期约 30 天）、`oAuthInfo`（学号+密码，对应「记住密码并信任设备」）、`loginInfo` |
| 附属爬虫 | 内置 WebVPN 加密主机常量表（涵盖课表 `jxgl.cic`、体测、图书馆座位 `cab`、校园卡 `card`、体育 `sports` 域名） |
| 结论 | **复用 OneTHU 会话的可行切入点是在 `id.tsinghua.edu.cn` 隧道内衔接共享 ITS 认证会话或单次票据**，从而免输密码完成出票；具体安全边界见 §3。 |

### 1.2 行在清华小程序（wx3cfa534a23db4039，包版本目录 43）

分析结论与 2026-10-15 记忆笔记一致并完成补齐：

| 项 | 结论 |
| --- | --- |
| 本体 | 高德地图与校内路况（`restapi.amap.com` + `traffic.tsinghua.edu.cn:8443`、`traffic2`）+ 首页 16 张功能卡片目录 |
| 校园业务 | **全部通过 `web-view` 承载**：`visit.tsinghua.edu.cn`（临时来访报备）、`thos.tsinghua.edu.cn/fp/visitService?service_id=…`（5 项）、`vehicle`（公车）、`thupark`（停车）、`jdcczgl`（车证） |
| 原生认证 | 小程序壳层无原生校园业务认证；`web-view` 内加载的即为标准移动网页（发送浏览器形态请求） |
| 8443 | `traffic.tsinghua.edu.cn:8443` 仅出现在该小程序静态代码中，可作为特征端口线索 |

## 2. 运行时证据（已完成）

- 网关只读状态核实：daemon 处于 `authenticated` / `ready`，基线活跃主机为 `info` / `zhjwxk` / `zhjw` / `cloud`。
- 本地无凭据 `curl` 探针测试（直连本机网关监听端口）：
  - `CONNECT traffic.tsinghua.edu.cn:8443` → 返回 **403 `GATEWAY_TARGET_REJECTED`（`host=null`）**，与 2026-10-31 22:16 观测到的两条拒绝记录命中同一代码分支与输出形态，说明若微信流量进入系统 PAC，行在清华的路况 `8443` 请求会被旧版网关的 443 端口限制拦截。
  - `CONNECT www.xiaoda.tsinghua.edu.cn:443` 与 `visit…:443` → 返回 200（走 `connectPassthrough` 透明转发，业务层凭小程序自身的 JWT 访问，透明转发链路已通）。
  - `CONNECT id.tsinghua.edu.cn:443` → 返回 401 `GATEWAY_AUTH_REQUIRED`：**身份域同时被 PAC 设为 `DIRECT` 排除且在网关侧拦截**，这正是小程序当前无法直接复用 OneTHU 学校会话的核心阻点。
- 补充说明：`GATEWAY_PEER_SOCKET_INVALID` 来自对端 socket 元组核验分支，与上述端口拦截相互独立。

## 3. 适配判定（阶段 D，供决策，未实现）

1. **8443 端口盲区（源码已修，见 §4）**：PAC 按域名将校园流量导入网关，而旧版网关仅放行 443 端口。
2. **清小搭免密登录**：需要引入「受限本机客户端授权」新边界——`macPeer` 的 `lsof` 输出已包含客户端 PID（当时仅取用了 UID），可在此基础上扩展宿主进程路径与代码签名归因（如 `WeChatAppEx` 签名核验）、身份域受限放行与学校票据续接。**按照交接约定，涉及新增身份共享边界需先向用户说明授权依据并获确认后再落地实现。**
3. **行在清华 `web-view`**：`web-view` 请求自带浏览器形态的 `Origin` / `Referer`，业务侧可对接现有的「已登记业务 origin + 会话合并」机制（如 `visit` 采用 `token` 头与 `JSESSIONID` 配对，OneTHU 已有 `VisitClient` 实现），但其前置 SSO 跳转仍需向 ITS 申请票据，同样受限于当前的身份域直连隔离规则。
4. **阶段性使用方式**：在未开放身份域受限续接前，首次使用清小搭小程序可在小程序内输入一次学号密码（小程序本地支持保存登录态自动续期）；同时 OneTHU 桌面端内置的清小搭页面可直接免密使用，两条入口互不干扰。

## 4. 已完成修复与事故记录

### 4.1 源码修复（已提交 `7554b8af`，gateway 测试 137/137、SDK 295/295 通过）

1. `parseCampusConnectAuthority`（`policy.mjs`）：`passthrough` 透明转发分支支持校园域名的任意合法端口；身份域继续保持 401 拦截；保留 `Host` 一致性校验（因 `cleanUrl` 限制显式端口，为 `CONNECT` authority 单独提供端口校验路径）。
2. `passthrough.mjs`：透明转发保留客户端请求的原始目标端口（未指定时默认 443）。
3. `lsofFatalStderr`（`macPeer.mjs`）：**当系统存在响应受阻的远端挂载卷（如 WebDAV `/Volumes/dav.stcloud.cc.cd`）时，`lsof` 即使退出码为 0 也会向 stderr 输出 `WARNING`；旧代码将任何非空 stderr 一律视为致命错误**，导致挂载 WebDAV 时新建校园 `CONNECT` 全部返回 `503 GATEWAY_PEER_UNAVAILABLE`。该提交改为容忍 `lsof: WARNING:` 告警块，其余未知 stderr 仍按失败处理，若缺失精确 TCP 记录则继续按 `GATEWAY_PEER_UNVERIFIED` 安全拒绝。

### 4.2 部署与事故时间线

1. 执行 `pnpm --filter @onethu/cli build`，将 `packages/cli/dist/sdk` 同步至 `~/.local/share/onethu-cli/dist/sdk`，重算 `runtime.json`（`buildId` 为 `4218d310cc0f…`，`version` 保持 `0.11.4-fix-3` 以对齐 dev GUI）。
2. 执行 `daemon stop` + `daemon start`（PID `34867`），登录会话与 `epoch` 完整保留。
3. 执行 `gateway start` + `system-enable` 后，**所有新建校园 `CONNECT` 返回 503**（触发 §4.1.3 所述的 `lsof` WebDAV 告警问题），造成用户浏览器校园网访问中断。
4. 立即执行 `gateway system-disable --confirm` 回滚系统网络设置，实测普通外网、校园网直连及 Clash 代理均恢复正常。
5. **现场遗留注意点：当时已部署的 runtime（`4218d310`）仅包含修复 1 和 2，尚未打入修复 3（`macPeer.mjs` 的修改在打包之后才完成）。**

### 4.3 用户侧立即恢复完整功能的两个选项

- **选项 A（最快）**：先卸载 WebDAV 卷 `dav.stcloud.cc.cd`，再运行 `onethu gateway start --confirm && onethu gateway system-enable --confirm`，已部署的 runtime 在无挂载告警时即可正常工作。
- **选项 B（根治）**：部署包含 §4.1.3 的构建：在仓库根目录执行 `pnpm --filter @onethu/cli build` → 将 `packages/cli/dist/sdk/` 同步至 `~/.local/share/onethu-cli/dist/sdk/`（排除 `._*`）→ 重算 `runtime.json` 哈希与 `buildId` → 依次执行 `daemon stop/start`、`gateway start --confirm`、`system-enable --confirm` → 按 §5 完成验证。

## 5. 接手验证清单

1. `onethu daemon status`：确认处于 `running`、`runtimeId` 与 `~/.local/share/onethu-cli/runtime.json` 的 `buildId` 一致，且会话为 `authenticated` / `ready`。
2. `onethu gateway status`：确认 `enabled=true` 且各网络服务 PAC 均已就位。
3. 探针矩阵（经本机网关监听端口）：`traffic.tsinghua.edu.cn:8443` → **200**（验证修复 1 生效）；`www.xiaoda…:443` 与 `visit…:443` → 200；`id…:443` → 401（符合预期）；在保持 WebDAV 卷挂载状态下再次发起 `CONNECT`，确认无 `GATEWAY_PEER_UNAVAILABLE`（验证修复 3 生效）。
4. 浏览器基线：打开 Info 门户与选课页面确认正常加载。
5. 微信端实测（由用户操作）：行在清华路况卡片正常加载（`8443` 端口透明转发畅通）；清小搭点击「清华统一身份登录」在未启用新边界前仍走常规密码登录（见 §3）。
6. 自动化回归：`pnpm --filter @onethu/gateway test`（137 项）。

## 6. 边界与未做事项

- 暂未实现小程序会话共享与身份域受限放行（待用户确认 §3.2 授权方案后推进）。
- 因中途暂停，尚未开展微信客户端真机验收；微信进程、本地程序文件及聊天数据均保持未动。
- 解包产物暂存于 `/tmp/wxapkg-candidates/`（系统重启后自动清理）；如需留档请移至本机私有目录，公开文档中保持代码包内容脱敏。
- 系统网络设置已通过 `system-disable` 完整恢复至接入前的 Clash 手动代理状态。

## 7. 本次会话的其他事实

- DSH 面板中的 `aimemory` 工具连接旧地址 `ai-memory.cc.cd` 报错：当前 `cordis.patch.yml` 已更新为 `https://memory.stcloud.cc.cd/mcp`，系宿主进程缓存了旧端点，重启 Harness 即可恢复；Basic Memory MCP 服务本身正常可用，10-15 的两条历史小程序分析笔记均已顺利调取并作为本次分析起点。
- daemon 当前 PID 与监听端口均为动态分配，请勿在脚本或配置中写死；launchd 服务 `edu.tsinghua.onethu.cli.1252d4534d22` 的 `KeepAlive` 仅在非零退出时自动拉起。
