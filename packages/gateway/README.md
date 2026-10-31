# OneTHU Campus Gateway

无浏览器扩展的校园代理，开发于 `web` 分支。网关复用既有 SDK / CLI daemon 的账号会话；桌面主入口是 **启动代理 → 授权信任证书 → 启用系统代理**，让遵循系统代理设置的日常浏览器访问校园网站。三个步骤都需要主动操作。独立校园浏览器保留为可选入口。

**当前验收边界（2026-10-31）：当前 Mac 已完成真实 CA 信任、四个网络服务的组合 PAC 启用，以及普通 Chrome 经系统设置读取网络学堂。原 Clash 手动代理被保留为非校园流量的后续路由。真实停用已完成，四个网络服务的原有路由与绕过规则已核对恢复；Ethernet 留有未启用的 PAC 地址。Safari 尚待验收，Windows 和 Android 不在本轮实机通过范围。**

阶段设计见[实施计划](../../docs/plans/2026-10-31-campus-super-proxy.md)。[共享会话与 Mac dev 验收](../../docs/reviews/2026-10-31-campus-gateway-integration.md)和[首轮协议记录](../../docs/reviews/2026-10-31-campus-gateway-prototype.md)保留为历史证据；其中“未执行系统信任或代理修改”“优先独立浏览器”等描述对应较早阶段，不代表当前系统接入状态。

最新通用 SSO、Info 转圈、云盘二次验证和后台重启结果见[校园服务验收](../../docs/reviews/2026-10-31-campus-service-coverage.md)。普通 Chrome 已通过云盘、培养方案、ITS、邮箱和体育只读页面验收，MadModel 页面可打开；未提交业务写操作。下文的 11 张 Learn 卡片和停用状态是早期系统接入快照，当前代理保持启用。

## 当前能力

- 只监听 `127.0.0.1`；支持 HTTP/1.1 forward proxy、经认证的 HTTPS CONNECT、精确 origin / Host / SNI 校验、流与背压、超时和账号 epoch 隔离。
- `createManagedGateway` 挂在已有 SDK 实例中，复用同一个 `NodeSession`。`gateway.control` 仅经私有 daemon 控制接口使用，不加入公开校园服务/MCP 工具目录；外部 CLI / MCP 访问开关不控制此功能。
- SDK 适配器明确选择直连或 WebVPN，学校 Cookie 保留在权威会话内；按允许来源反向改写重定向、HTML/CSS/JS 文本 URL 和 CSP 来源，不移除整个 CSP。二进制和 Range 响应不做正文改写。
- 对明确启用的旧 HTTP 校园网址，只有无请求体的 GET / HEAD 可以先重定向到对应 HTTPS 门面；该重定向不访问学校会话，后续 HTTPS 请求仍需来源校验。SDK 再将门面映射到学校实际的 HTTP / WebVPN 上游。POST / 上传不自动重放。
- 每个安装的数据目录拥有独立 CA 和代理凭据。准备证书、启动本机监听均不会自动安装证书或启用系统代理。私钥与代理凭据使用私有文件保存，状态响应只含公开证书信息。
- macOS 系统接入使用独立的同用户认证监听器和每个网络服务各自的组合 PAC。普通浏览器通过系统信任和系统代理访问，无需浏览器扩展、代理密码或忽略证书错误的启动参数。
- 可选「独立校园浏览器」使用独立 Chrome / Chromium / Edge 配置和私有 CDP pipe 提供代理认证，只对本次 CA 公钥建立进程内信任例外，不修改常用浏览器资料。它使用单独的认证入口，不是 macOS 系统接入的前提。

## macOS 系统接入与已有代理共存

启用前读取所有已启用网络服务的 PAC、自动发现、HTTP、HTTPS、SOCKS 和绕过规则，生成可核对的快照。每个服务拥有自己的 PAC URL，因此 Wi-Fi、USB 等服务可保留不同的原代理配置。启用时再次核对快照，先安装组合 PAC，再关闭被纳入 PAC 的手动代理开关。

组合规则按以下顺序处理：

1. 已登记的校园域名进入共享会话代理。支持原 HTTPS 手动代理或直连的 macOS 网络服务也会分流其余校园 HTTPS：未登记站点透明转发原始 CONNECT，沿原代理/绕过规则访问，保持网站自己的 TLS；不向它附加 SDK Cookie。SOCKS-only 配置暂保留精确登记模式。
2. 非校园域名匹配原有绕过规则时直连，支持普通主机模式、`<local>` 和 IPv4 CIDR（含 macOS 的缩写形式）。
3. 其余非校园流量沿用对应协议的原 HTTP / HTTPS 代理，或原 SOCKS 代理；原本没有代理时才直连。

统一认证的 `id.tsinghua.edu.cn` 与 `oauth.tsinghua.edu.cn` 始终按原网络规则访问，保留普通浏览器自己的认证及账号管理能力。它们不会进入共享会话代理或被该代理签发证书，即使调用方把它们放入自定义名单。SDK 内部的认证请求仍由账号运行时处理。

这允许当前 Mac 的 Clash 手动 HTTP / HTTPS / SOCKS 代理继续处理非校园网站。OneTHU 不读取或改写 Clash 配置、订阅或令牌。任意已有 PAC/WPAD、需要认证的手动代理及无法安全解析的配置仍拒绝合并，不会通过关闭旧代理强行启用。原代理应用后来再次接管系统设置时，OneTHU 不与它反复抢写。

macOS 系统监听器按已建立 loopback TCP 连接核对对端 UID；未能确定连接所属用户、用户不符或核对超时即拒绝。此认证区分本机用户，不提供同一用户下不同应用之间的隔离。每个校园 HTTP 请求仍须通过 Origin / Fetch Metadata、目标来源和账号 epoch 校验；同用户认证不会解除这些约束。

系统修改使用持久化的写前恢复日志。恢复前逐项比较当前值与 OneTHU 写入的值，只恢复仍归本次操作所有的设置，保留后来由用户或其他应用修改的字段。`status` 会只读核对真实设置并返回 `settingsChanged`、`settingsUnreadable` 和 `changedServices`；未完成的写入或恢复会设置 `restorePending`，管理器据此显示 `recoveryRequired`。崩溃后必须显式恢复遗留配置，再重新启动或启用。一次系统写入被拒绝后立即停止本轮后续写入，不自动继续逐服务请求授权。

原 PAC 地址为空时，恢复会关闭 PAC 并保留其未启用地址。`networksetup` 没有已验证的清空地址操作，因此不为清理无效元数据调用额外授权助手；`retainedInactivePacUrls` 返回对应网络服务名。此时原有代理路由已恢复，但不声称配置字节完全相同。当前 Mac 已完成四个网络服务的真实恢复核对，Ethernet 留有这样一条未启用地址。

## 2026-10-31 当前 Mac 实测 / Live Mac result

保留正在使用的 Mac dev GUI 和同一账号，更新 daemon 运行时，未重启 GUI 或重新登录。最新系统接入结果如下：

| 检查项 | 已观察到的结果 |
| --- | --- |
| 本机 CA | 已完成真实系统信任。 |
| 系统代理 | 曾在四个网络服务安装各自的组合 PAC；启用期间原 Clash 手动代理及绕过配置保留在非校园路由中，随后已完成停用恢复。 |
| 普通 Chrome | 使用系统代理与系统证书信任，没有指定代理启动参数、代理认证注入或 CA 例外；网络学堂显示 11 张课程卡片，系统监听器记录 101 个请求。 |
| 非校园网站 | Google favicon 返回 HTTP 200，未被校园代理处理。此项验证一个非校园请求，不代表已覆盖所有网站。 |
| 真实停用与恢复 | 已通过：四个服务的 HTTP / HTTPS / SOCKS 与绕过规则和启用前一致。Ethernet 与 Wi-Fi 恢复 Clash，USB LAN 与 Thunderbolt Bridge 恢复直连；Ethernet 的 PAC 已关闭但保留未启用地址。 |
| Safari | **待验收**；不能从 Chrome 结果推断 Safari 已通过。 |

较早的独立 Chromium 路径已读取网络学堂列表（11 张课程卡片、169 个链接、17 个 XHR 全部 HTTP 200）和首个课程页面（10 个课程导航链接、8 个课程 XHR 全部 HTTP 200）。实际 `openGatewayBrowser` helper 也通过私有 CDP pipe + PAC 加载过 11 张课程卡片。它们是独立入口的历史验证，与上表普通 Chrome 系统接入结果分开记录。

测试没有提交作业、预约、修改业务数据或实际下载文件，其他校园服务仍需逐项验证。早期无界面测试关闭过学校 alert 对话框，不能据此声称所有可见弹窗与交互已验收。桌面设置按钮的 32 项检查来自 UI fixture，不是所有原生按钮均已完成可见点击验收。

The existing Mac dev GUI and account were preserved. The local CA is now trusted and per-service composed PACs were enabled on four network services, retaining the previous Clash manual proxies for non-campus traffic. Ordinary Chrome used system settings without proxy launch flags, injected proxy credentials or certificate exceptions: Learn showed 11 course cards and the system listener counted 101 requests. A Google favicon request returned HTTP 200 outside the campus gateway. Actual restoration subsequently passed: the four services’ original proxy routes and bypass rules matched, with one inactive PAC URL retained on Ethernet. Safari remains pending; Windows, Android, writes and downloads are not accepted by these results.

## 当前 Mac dev 手动验收 / Current Mac dev walkthrough

前提：使用包含本次 Rust `gateway.control` 白名单和运行时包的桌面 dev 构建，已安装 OneTHU CLI 运行环境，并已在 OneTHU 登录。仅打开 `http://127.0.0.1:5180` 的网页预览不可运行代理；Vite 热更新也不能更新旧的原生宿主。自动 fixture 不会批准真实系统更改。

| 步骤 | 中文界面 | English UI |
| --- | --- | --- |
| 1 | 完整模式打开设置齿轮 → **Harness → 高级配置 → 模型 / MCP / 日志 → 校园超级代理**。 | In Full mode, open the settings gear → **Harness → Advanced configuration → Model / MCP / logs → Campus superproxy**. |
| 2 | 若缺少运行环境，在上方安装或更新 CLI，再刷新状态。「允许外部 CLI / MCP 访问」可保持关闭。 | Install/update the CLI runtime above if requested, then refresh status. **Allow external CLI / MCP access** can remain off. |
| 3 | 点击「启动代理」，确认显示运行状态。启动只准备本机材料与监听，不改变系统信任或代理。 | Choose **Start proxy**. This prepares local material and listeners without changing system trust or proxy settings. |
| 4 | 在主区域点击「授权信任证书」，完成系统确认。 | Choose **Trust certificate** in the main section and complete OS approval. |
| 5 | 点击主区域的「启用系统代理」。macOS 会检查现有配置并保留可合并的手动代理；成功后显示共存网络服务。 | Choose **Enable system proxy**. macOS checks the current settings and preserves compatible manual proxies; active network services appear after successful coexistence setup. |
| 6 | 使用遵循系统代理设置的日常浏览器打开网络学堂，检查校园页面与非校园网站。若学校要求重新认证，在 OneTHU 完成。 | Open Learn in a usual browser that follows system proxy settings, then check a non-campus site. Complete renewed campus verification in OneTHU. |
| 7 | 点击「恢复原代理设置」，核对原代理后再「停止代理」，按需「撤销信任」。原 PAC 地址为空时可能保留未启用地址，不影响恢复后的路由。 | Choose **Restore proxy settings**, verify the previous settings, then **Stop proxy** and optionally **Remove trust**. A formerly empty PAC URL may remain populated but disabled; it does not affect the restored routing. |

证书信任与系统代理按钮直接显示在主区域，无需展开。旧进程遗留配置或后续外部改动会提示恢复，停止状态下也能操作。恢复存在未完成的系统写入时会报告错误，不会声称已恢复；其他应用的后来修改会保留。

「可选浏览器与手动接入」内保留独立校园浏览器、平台说明、证书指纹、代理范围和手动凭据。普通 macOS 系统接入不需要打开此独立浏览器。「显示代理凭据」只用于手动配置其他客户端：显示的是独立本机代理用户名/密码，不是校园账号密码，仅主动请求时读取，60 秒后自动隐藏；不要将其写入日志或截图。

## 平台边界

| 平台 | 当前实现与限制 |
| --- | --- |
| macOS | 用户钥匙串信任、同 UID 系统监听器、按网络服务组合手动代理及绕过规则；当前 Chrome 系统接入已实测。已有 PAC/WPAD、需认证的手动代理不合并。真实恢复已核对通过，可能保留未启用的 PAC 地址；Safari 待验收。 |
| Windows | 有 CurrentUser CA 信任、旧式 PAC 设置/恢复和 WinINet 通知适配器；当前用户已存在手动代理、PAC/WPAD 或无法读取配置时拒绝覆盖。尚无 macOS 同 UID 免密码系统入口，浏览器可能需要本机代理凭据；组合已有手动代理未实现，所有系统行为仍需 Windows 实机验证。 |
| Android / iOS / 网页预览 | 当前没有系统接入入口。Android 需另行实现系统代理或 VPN 接入，并验证已有 VPN 共存及应用对用户 CA 的支持；不能承诺全部应用覆盖。网页预览不能调用桌面私有 daemon。 |

系统代理只适用于遵循相应系统设置的客户端。自行管理代理、拒绝用户 CA、使用证书固定或特殊网络栈的应用，均不能仅凭普通浏览器测试标为兼容。

## CLI 控制

`gateway` 命令只连接**已经运行**的私有 daemon；缺少 daemon 时返回 `DAEMON_REQUIRED`，不会静默创建另一套账号运行时。先打开 OneTHU，或由用户明确执行 `onethu daemon start`。如使用自定义数据目录，CLI 与桌面必须指向同一目录。

```sh
onethu gateway status
onethu gateway start --confirm
onethu gateway trust --confirm
onethu gateway system-enable --confirm
onethu gateway status
onethu gateway system-disable --confirm
onethu gateway stop --confirm
```

所有非 `status` 操作都要求 `--confirm`。另外支持 `setup`、`untrust`、`open-browser`、`credentials`；`open-browser` 是可选独立浏览器入口。`credentials --confirm` 会在终端输出代理密码，仅在确实需要手动接入时使用。`setup` 只准备本机密钥材料，不信任证书；`start` 只启动监听，不启用系统代理。`--desktop`、`--endpoint`、`--args` 不适用于 `gateway` 命令。

The CLI connects only to an existing private daemon. All changes and explicit credential disclosure require `--confirm`. Starting the gateway does not change system trust or proxy settings. `credentials --confirm` prints the local proxy password; it is not a routine status command.

## 自动验证

运行时要求 Node.js `^20.19.0 || >=22.12.0`。协议测试另外需要 `openssl` 生成临时 fixture 证书；运行时 CA 使用包内证书实现。测试不安装 fixture CA、不读取真实账户文件，也不访问学校服务。

```sh
pnpm test:gateway
pnpm test:sdk
pnpm test:cli
pnpm --filter @onethu/desktop typecheck
node tools/i18n-test.mjs
node --test tools/campus-gateway-start-test.mjs
```

可选真实 Chromium fixture：

```sh
node packages/gateway/test/browser-smoke.mjs
node packages/gateway/test/managed-browser-smoke.mjs
```

前者需要另行可用的 Playwright，并支持 `CHROME_BIN`；后者使用当前管理器的系统浏览器发现和私有 CDP pipe，无需浏览器扩展。两者均使用独立临时配置、本地模拟上游和进程内证书例外；2026-10-31 两项浏览器 fixture 均通过。

系统接入阶段回归结果：gateway 120/120（含平台恢复专项 27 项）、SDK 249/249、桌面 UI fixture 32/32，桌面 TypeScript 检查通过，中英字典各 7751 键、0 错误。UI 检查包括三个操作互不自动触发、主区域按钮、共存状态、配置改动后隐藏旧成功提示、凭据主动读取/复制/隐藏、恢复入口和英文窄窗排版。平台测试使用注入的命令执行器验证组合 PAC、原有路由恢复、未启用 PAC 地址保留、权限拒绝后停止、并发修改保留、读取失败及崩溃恢复，不执行真实系统修改。较早的 CLI 80/80、启动交接 guard 18/18 记录见历史验收报告；真实学校与系统操作结果单独列于上方，不从 fixture 推断其他服务或平台已兼容。

## 嵌入接口与会话契约

```js
import { createManagedGateway } from '@onethu/gateway/manager';

const gateway = createManagedGateway({
  dataDir: existingRuntimeDataDir,
  session: existingCampusProxySession,
});
await gateway.control({ action: 'status' });
// Mutations require an explicit caller decision:
await gateway.control({ action: 'start', confirm: true });
// await gateway.close();
```

`existingCampusProxySession` 必须来自现有账号拥有者，不得通过复制 Cookie 快照新建登录实例。低层 `createCampusGateway` 接受 `session.request/epoch/assertCurrent` 和 `tls(hostname, { signal })`，仅监听 loopback。认证配置必须二选一：`token` 对应 `Proxy-Authorization: Basic base64("onethu:" + token)`；`authorizeSocket(socket, { signal })` 对应受限的连接归属核验。后者由 macOS 系统入口使用，不接受 Basic 密码作为核验失败后的兜底。

管理器状态的 `endpoint` 是手动/独立浏览器认证入口；macOS 的 `systemEndpoint` 是系统 PAC 使用的同 UID 入口。`systemProxy` 含启用、共存网络服务与恢复状态。两种入口共享同一账号权威与校园范围，均不使用 daemon 管理凭据。浏览器对 ID/OAuth，以及已知登录、退出、漫游票据兑换入口的请求会在上游访问前被阻止，避免网页独立改变 SDK 账号身份；普通业务请求仍按既有权限与来源校验处理。

`session.request` 返回单跳 Fetch `Response`，请求体可能是 Node Readable，带 `duplex: 'half'`；应遵守取消和账号 epoch。采用 Fetch 已解压字节语义，优先请求 `Accept-Encoding: identity`，移除失效的长度/编码/摘要。压缩的 206/Content-Range 明确拒绝，避免声明范围与解压字节不符。独立 JavaScript 与 HTML 内联脚本中的已知 `vpn_eval` 包装会在有界字节流中还原，不增加 `eval` 助手、不放宽 CSP。SDK 只在识别到特定 WebVPN Cookie bootstrap 时，对 GET / HEAD 完成引导后重取一次；不会重放 POST 或上传。

浏览器 Cookie、认证类 `Set-Cookie` 和内部 `x-onethu-*` 头由共享会话边界隔离。标准 Authorization 仅在当前账号和目标来源的成功 JSON 中见证后透传，缓存保存令牌哈希；应用专用业务头保留原语义，由原站校验。Learn 与 Info 仅投影页面需要的 `XSRF-TOKEN`，优先精确 WebVPN 路径，显式 HttpOnly 不投影；Info 从 Cookie body 恢复且缺失属性的专用公开防伪 UUID 也可投影，jar 的属性保持原样。Learn 已知课程文档可提供比镜像 Cookie 更新的公开 nonce；适配器从最多 64 KiB 前缀中的同源业务链接提取唯一值，按账号 epoch 暂存，避免后续资源写回旧值。固定为 Secure / SameSite=Strict / Path=/，其余 Cookie 保持私有。其他页面内依赖 `document.cookie`、业务 token、未适配跨域 SSO 或 Service Worker 的服务仍须逐站验证。正文 URL 逆向改写不等于完整浏览器兼容。

服务由官方 Info 应用 ID 查询和有界 SSO 登记，CONNECT、动态单主机证书和每次请求共用账号作用域的实时登记。`id/oauth/webvpn` 的直接浏览器页面沿原网络路由；业务 SSO 使用后台已有 Cookie 与设备指纹。每个登记的来源和上游协议，以及未过期的令牌哈希，保存到现有私有会话存储并绑定账号摘要及 epoch；callback URL、ticket、令牌原文和未知字段不进入新缓存。原站可继续完成自己的 JWT 交换。

`session.authorizeTarget()` 和 `allowedOrigins()` 只查询后台已验证的登记；`authorizeBrowserCredential()` 只查询标准 Authorization 的来源见证。动态登记不会来自 CONNECT 头、请求 Referer 或网页里的任意链接。`connectPassthrough` 负责未登记校园 TLS 的原代理转发，不调用账号 transport 或 CA。

旧 native 快照的属性来源仍有迁移限制：早期导出曾把缺失 HttpOnly 属性记为 false，已有记录无法完全反推。公开防伪值的窄范围投影不代表允许导出其他 Cookie。

## 未完成的覆盖

除前述安全的 HTTP → HTTPS 门面跳转外，缺少 Origin 与 Fetch Metadata 的业务请求仍被拒绝。CONNECT 握手不要求页面来源，隧道内每个 HTTP 请求都校验。仅知道代理密码或运行于同一 UID，不授予任意页面借用学校会话的权限。

当前没有 LAN 监听/配对、手机系统入口、微信小程序业务接入、TUN、WebSocket 或 HTTP/2/3 支持。系统代理也不保证覆盖所有第三方网络库；拒绝用户 CA、证书固定或特殊认证的应用不能标为兼容。系统 CA 授权的权限范围与代码里的校园 origin 名单是不同层次，不能把名单描述为操作系统证书的密码学约束。
