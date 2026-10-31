# 微信「清小搭 / 行在清华」REA 完成与网络事故交接报告

日期：2026-11-01 凌晨，Asia/Shanghai。接手自 [2026-10-31 条件性交接](2026-10-31-wechat-mini-program-rea-handoff.md)。用户随后授权执行，中途因网络中断要求停止并要求本报告。

## 0. 当前状态（最重要的部分）

| 项 | 状态 |
| --- | --- |
| 用户网络 | **已恢复**。`gateway system-disable --confirm` 已执行，系统代理回到原始 Clash 手动代理 `127.0.0.1:7897`（scutil 确认 HTTP/HTTPS=7897、PAC 已卸载）。info.tsinghua.edu.cn 302、www.xiaoda.tsinghua.edu.cn 200、经 Clash 外网 200，均实测可达。 |
| OneTHU 后台 daemon | 运行中（新 runtime，见下），会话完好：authenticated、ready、epoch 19、账号 ***3332。 |
| 校园会话借用（系统代理 PAC） | **暂时关闭**（system-disable）。这是恢复用户网络的代价，重新开启步骤见 §4.3。 |
| dev 预览 GUI（5180 + dev wrapper） | 未动、未重启。 |
| 仓库 | `web` 分支，HEAD `7554b8af`，工作区干净。 |
| 事故责任 | 本 agent 在部署重启 daemon 后未先验证 CONNECT 全链路，触发既有 lsof 缺陷导致校园 HTTPS 全部 503，已回滚网络设置并停手。详见 §4。 |

## 1. 静态 REA 结论（两个小程序，已完成）

### 1.1 清小搭小程序（wxc607b8a0063e7426，包版本目录 177）

用户 2026-10-31 22:16 打开；包 2,877,806 字节，V1MMWX 加密，用既有工具链解密成功（密钥材料=appid，配方见记忆笔记「学生清华小程序 API 拆解」）。解包产物 `/tmp/wxapkg-candidates/wxc607b8a0063e7426/src/`（293 文件，会随 /tmp 丢失；工具在 `/Volumes/PortableSSD/Projects/thuapp/miniapp-analysis/`）。

关键事实（源码实锤，模块号按 app-service.js）：

| 项 | 结论 |
| --- | --- |
| 入口页 | `pages/login/index`；登录组件 `components/oauth-popup`（模块 85332） |
| 后端 | 与网页版**同一个** `https://www.xiaoda.tsinghua.edu.cn`（模块 14537 `Api_url`） |
| 业务鉴权 | 自定义 `token` 头 = `getStorageSync("token")`（模块 71107），业务码 2001/2002 清 token 重登——与 OneTHU `XiaodaClient` 的 JWT 同一体系 |
| 登录链路 | **原生 `wx.request`（非 web-view）完整 ITS 表单登录**：`GET id.tsinghua.edu.cn/do/off/ui/auth/login/form/d982b795884e882abfa8ff3167aeb03e/0?/login.html`（**与 OneTHU 网页客户端同一 service id**）→ `POST …/login/check`（i_user / i_pass(SM2) / fingerPrint / i_captcha）→ 2FA（`id.tsinghua.edu.cn/b/doubleAuth/login`，企业微信验证码 / TOTP / 短信）→ 成功页锚点 → 必要时 `roam("id","10000ea055dd8d81d09d5a1ba55d39ad")` → `GET www.xiaoda…/api/token/login?ticket=…` 换 JWT |
| Cookie 管理 | 小程序内存 jar（idp 域单独一组，模块 43737），手动跟 302/307/308，不落系统 cookie store |
| 凭据存放 | storage 键 `token`（JWT≈30 天）、`oAuthInfo`（学号+密码，即「记住密码并信任设备」）、`loginInfo` |
| 附属爬虫 | webvpn 加密主机表（课表 jxgl.cic、体测、图书馆座位 cab、校园卡 card、体育 sports 域名常量表） |
| 结论 | **复用 OneTHU 会话的理论注入点 = id.tsinghua.edu.cn 隧道内合并共享 ITS Cookie**（登录将零密码出票）。但见 §3 边界。 |

### 1.2 行在清华小程序（wx3cfa534a23db4039，包版本目录 43）

结论与 2026-10-15 记忆笔记一致并补齐：

| 项 | 结论 |
| --- | --- |
| 本体 | 高德地图/路况（restapi.amap.com + `traffic.tsinghua.edu.cn:8443`、traffic2）+ 首页 16 卡片目录 |
| 校园业务 | **全部 web-view**：visit.tsinghua.edu.cn（临时来访报备）、thos.tsinghua.edu.cn/fp/visitService?service_id=…×5、vehicle（公车）、thupark（停车）、jdcczgl（车证） |
| 原生认证 | 无原生校园业务认证；web-view 内页面即普通网页（浏览器形态请求） |
| 8443 | `traffic.tsinghua.edu.cn:8443` 只出现在本小程序静态代码中——归因锚点 |

## 2. 运行时证据（已完成）

- 网关只读状态确认：daemon authenticated/ready；基线 hosts = info/zhjwxk/zhjw/cloud。
- 本地探针（curl 对网关监听，无凭据）：
  - `CONNECT traffic.tsinghua.edu.cn:8443` → **403 GATEWAY_TARGET_REJECTED（host=null）**，与 2026-10-31 22:16 的两条拒绝**同分支同形态**——归因成立：**微信小程序网络栈遵守系统 PAC**；行在清华路况请求被端口校验拒绝。
  - `CONNECT www.xiaoda.tsinghua.edu.cn:443` / `visit…:443` → 200（connectPassthrough 透明转发，业务靠小程序自己的 JWT，现状已可用）。
  - `CONNECT id.tsinghua.edu.cn:443` → 401 GATEWAY_AUTH_REQUIRED：**身份域被 PAC 排除（DIRECT）+ 网关硬拒**——这是小程序无法借用 OneTHU 会话的根本卡点。
- 附：`GATEWAY_PEER_SOCKET_INVALID` 是另一分支（对端 socket 元组校验），不与上述合并根因。

## 3. 适配判定（阶段 D，供决策，未实现）

1. **8443 端口盲区（已修，见 §4）**：PAC 不分端口把校园域送进网关，网关只收 443。
2. **清小搭免密登录**：需要「受限本机客户端授权」新边界——macPeer 的 lsof 输出已含 PID（当前只用 UID），可扩展为进程归因（WeChatAppEx 路径/签名）+ 身份域定向放行 + 共享 ITS 会话注入。**按原交接约束，这需要先向用户说明授权依据，不得擅自实现。**
3. **行在清华 web-view**：web-view 请求带浏览器形态 Origin/Referer，理论上可走现有「注册业务 origin + 会话合并」路径（visit = token 头 + JSESSIONID 配对，OneTHU 已有 `VisitClient` 产物），但其 SSO 前置仍要 ITS 票，同样撞身份域边界。
4. **现实短期结论**：清小搭小程序首次使用需用户在小程序内输一次学号密码（小程序自己记住并自动登录）；OneTHU 内置清小搭页仍是免密入口，两者并行不冲突。

## 4. 已完成修复与事故记录

### 4.1 源码修复（已提交 `7554b8af`，gateway 测试 137/137、SDK 295/295 通过）

1. `parseCampusConnectAuthority`（policy.mjs）：passthrough 分支接受校园域任意合法端口；身份域仍 401；Host 一致性校验保留。`cleanUrl` 禁端口，故独立校验路径。
2. `passthrough.mjs`：透传保留原始端口（443 缺省）。
3. `lsofFatalStderr`（macPeer.mjs）：**lsof 对不可 stat 的挂载卷（如 WebDAV `/Volumes/dav.stcloud.cc.cd`）在 exit 0 时输出 WARNING 到 stderr，旧代码把任何非空 stderr 当致命**，导致 webdav 挂载后所有新 CONNECT 503 GATEWAY_PEER_UNAVAILABLE。现在仅容忍 `lsof: WARNING:` 块，其余 stderr 仍致命；TCP 条目缺失仍走 GATEWAY_PEER_UNVERIFIED 安全失败。

### 4.2 部署与事故时间线

1. 构建 `pnpm --filter @onethu/cli build`；把 `packages/cli/dist/sdk` 同步到 `~/.local/share/onethu-cli/dist/sdk`，重算 runtime.json（buildId `4218d310cc0f…`，version 保持 0.11.4-fix-3 与 dev GUI 自洽）。
2. `daemon stop` + `daemon start`（pid 34867）→ 会话/epoch 保留成功。
3. `gateway start` + `system-enable` → **所有校园 CONNECT 503**（lsof webdav 缺陷，§4.1.3）。用户校园访问中断。
4. 立即 `gateway system-disable --confirm` 恢复原始网络设置，实测外网/校园直连/Clash 均恢复。
5. **注意：已部署 runtime（4218d310）含修复 1/2，不含修复 3（macPeer，构建于修复之前）。**

### 4.3 用户侧立即恢复完整功能的两个选项

- **选项 A（最快）**：卸载 WebDAV 卷 `dav.stcloud.cc.cd` 后，`onethu gateway start --confirm && onethu gateway system-enable --confirm`——当前已部署 runtime 即可正常工作（lsof 不再告警）。
- **选项 B（根治）**：部署含 §4.1.3 的构建：仓库根 `pnpm --filter @onethu/cli build` → 同步 `packages/cli/dist/sdk/` 到 `~/.local/share/onethu-cli/dist/sdk/`（排除 `._*`）→ 重算 runtime.json 哈希与 buildId → `daemon stop/start` → `gateway start --confirm` → `system-enable --confirm` → 验证 §5。

## 5. 接手验证清单

1. `onethu daemon status`：running、runtimeId 与 `~/.local/share/onethu-cli/runtime.json` 的 buildId 一致、authenticated/ready。
2. `onethu gateway status`：enabled、各网络服务 PAC 就位。
3. 探针矩阵（经网关监听端口）：`traffic.tsinghua.edu.cn:8443` → **200**（修复 1 生效）；`www.xiaoda…:443` / `visit…:443` → 200；`id…:443` → 401（预期）；再发一次 CONNECT 确认无 GATEWAY_PEER_UNAVAILABLE（修复 3 生效，需 webdav 卷保持挂载状态验证）。
4. 浏览器基线：Info 打开、选课可查（用户验收）。
5. 微信内（用户操作）：行在清华路况页应不再被拒（8443 passthrough）；清小搭「清华统一身份登录」仍需密码（§3.4 现实边界）。
6. 回归：`pnpm --filter @onethu/gateway test`（137 项）。

## 6. 边界与未做事项

- 未实现小程序会话借用/身份域放行（需用户对授权模型点头，§3.2）。
- 未跑微信真机验收（用户已叫停）；未动微信进程/文件；未读取聊天数据。
- 解包产物在 `/tmp/wxapkg-candidates/`（重启即失）；如需留存请复制到私有目录，公开文档不贴包内容。
- 网络设置的「恢复到接入前」已由 system-disable 完成（Clash 手动代理原样回归）。

## 7. 本次会话的其他事实

- `aimemory`（DSH 面板工具）连旧地址 `ai-memory.cc.cd` 失败：当前 `cordis.patch.yml` 已是 `https://memory.stcloud.cc.cd/mcp`，属宿主进程缓存旧端点，重启 Harness 即恢复；Basic Memory MCP 本身可用，历史 REA 结论（10-15 两条笔记）均已调出并作为本次起点。
- daemon 当前 pid/端口是临时的，勿写死；launchd `edu.tsinghua.onethu.cli.1252d4534d22` KeepAlive 仅非零退出。
