# OneTHU Campus Gateway

无浏览器扩展的校园代理，开发于 `web` 分支。当前代码已接入既有 SDK / CLI daemon 的账号会话，并提供桌面设置、独立校园浏览器、本机 CA 和 macOS / Windows 系统代理适配器。

**当前验收边界：本地协议、模拟会话、独立 Chromium fixture，以及当前 Mac 上复用既有账号的网络学堂课程列表和首个课程页面读取已验证。系统证书授权与整机代理尚未实测验收。** 手机、微信小程序、LAN、WebSocket、HTTP/2/3、TUN 不在本轮已完成范围。阶段记录见[实施计划](../../docs/plans/2026-10-31-campus-super-proxy.md)，本轮证据见[共享会话与 Mac dev 验收](../../docs/reviews/2026-10-31-campus-gateway-integration.md)，早期协议验收见[首轮记录](../../docs/reviews/2026-10-31-campus-gateway-prototype.md)。

## 当前能力

- 只监听 `127.0.0.1`；HTTP/1.1 forward proxy、经认证的 HTTPS CONNECT、精确 origin / Host / SNI 校验、流与背压、超时和账号 epoch 隔离。
- `createManagedGateway` 挂在已有 SDK 实例中，复用同一个 `NodeSession`。`gateway.control` 仅经私有 daemon 控制接口使用，不加入公开的校园服务/MCP 工具目录；外部 CLI / MCP 访问开关不控制此功能。
- SDK 适配器明确选择直连或 WebVPN，保留学校 Cookie 于权威会话内；按已允许的来源反向改写重定向、HTML/CSS/JS 文本 URL 和 CSP 来源，不移除整个 CSP。二进制和 Range 响应不做正文改写。
- 对明确启用的旧 HTTP 校园网址，只有无请求体的 GET / HEAD 可以先重定向到对应 HTTPS 门面；该重定向不访问学校会话，HTTPS 请求随后仍需来源校验。SDK 再把门面映射到学校实际的 HTTP / WebVPN 上游。POST / 上传不自动重放。
- 每个安装的数据目录拥有独立 CA 和代理凭据。准备证书、启动本机监听均不会自动安装系统证书或启用系统代理。证书私钥与代理凭据使用私有文件保存，状态响应不含这些密钥。
- 「校园浏览器」启动独立的 Chrome / Chromium / Edge 配置，通过私有 CDP pipe 提供代理认证，只对本次 CA 公钥建立进程内信任例外；无需扩展，不改变常用浏览器资料或系统证书库。
- 系统接入使用范围受限的 PAC，需用户另行点击信任证书和启用代理。已有 Clash、PAC、HTTP(S) 或 SOCKS 代理启用时拒绝覆盖；恢复时保留其他应用后来修改的设置。遗留配置通过 `recoveryRequired` 与显式恢复操作处理。

## 2026-10-31 当前 Mac 实测 / Live Mac result

保留原有 Mac dev 应用进程（PID `67363`）和同一账号，仅更新 daemon 运行时；未重启 GUI、未重新登录、未执行系统证书信任或系统代理修改。使用独立的无界面 Chromium 访问真实网络学堂：

| 读取范围 | 实际结果 |
| --- | --- |
| 课程列表页 | 标题正确，11 张课程卡片、169 个链接；17 个 XHR 全部 HTTP 200；jQuery 类型为 function，防伪 Token 存在；没有密码输入框或 JavaScript 异常。 |
| 首个课程页面 | 跟随上述列表中的第一个逻辑课程链接进入 `/f/wlxt/index/course/student/course`，HTTP 200、578 个 DOM 节点、10 个作业/课件/通知等导航链接；8 个课程 XHR（通知、讨论、作业列表、课件）全部 HTTP 200；没有密码输入框、网关错误码或 JavaScript 异常。 |

另用实际 `openGatewayBrowser` helper 的私有 CDP pipe + PAC 路径加载真实学堂，确认 11 张课程卡片、无密码输入框；无界面对话框被拒绝，浏览器正常关闭。此项验证实际浏览器 helper，仍不是原生设置按钮的可见点击验收。

首页的 2 个学校 alert 对话框在无界面测试中被关闭，**不能据此声称可见窗口里没有弹窗或交互体验已完成验收**。本次没有提交作业、预约、修改业务数据或实际下载文件；其他校园服务仍需逐项验证。桌面设置按钮的验证来自 UI fixture，不能与真实原生窗口的点击验收混为一谈。

The existing Mac dev GUI process and account were preserved; only the daemon runtime was updated. A separate headless Chromium loaded the live Learn course list (11 cards, 169 links, all 17 XHRs HTTP 200), then followed its first course link successfully (10 navigation links, all 8 course XHRs HTTP 200). No password fields, gateway error codes on the course page, or JavaScript errors were observed. The actual `openGatewayBrowser` helper also loaded the live 11-card page through its private CDP pipe and PAC, then closed normally. Two school alert dialogs on the home page were dismissed by the test. Visible-window dialog UX, submissions, actual file downloads, other services and real OS trust/proxy changes remain unverified.

## 当前 Mac dev 手动验收 / Current Mac dev walkthrough

前提：使用包含本次 Rust `gateway.control` 白名单和运行时包的桌面 dev 构建，已安装 OneTHU CLI 运行环境，并已在 OneTHU 登录。仅打开 `http://127.0.0.1:5180` 的网页预览不可运行代理；仅 Vite 热更新也不能更新旧的原生宿主。本轮自动 fixture 不重启正在使用的应用，不执行真实登录或系统代理授权。

Prerequisites: a desktop dev build containing the native `gateway.control` allowlist and updated runtime, the OneTHU CLI runtime installed, and an existing OneTHU sign-in. The web preview alone cannot run the proxy, and Vite HMR cannot update an older native host. Automated fixtures do not restart the active app or approve real system changes.

| 步骤 | 中文界面 | English UI |
| --- | --- | --- |
| 1 | 完整模式打开设置齿轮 → **Harness → 高级配置 → 模型 / MCP / 日志 → 校园超级代理**。 | In Full mode, open the settings gear → **Harness → Advanced configuration → Model / MCP / logs → Campus superproxy**. |
| 2 | 若提示缺少运行环境，在上方安装或更新 CLI，再刷新状态。「允许外部 CLI / MCP 访问」可保持关闭。 | Install/update the CLI runtime above if requested, then refresh status. **Allow external CLI / MCP access** can remain off. |
| 3 | 点击「启动代理」，确认显示本机端口；然后「打开校园浏览器」。 | Choose **Start proxy**, verify the loopback endpoint, then **Open campus browser**. |
| 4 | 在独立窗口中检查网络学堂页面、导航与只读附件；记录实际账号、网址和功能结果。若学校要求再验证，在 OneTHU 完成。测试夹具成功不代表真实校园服务已经通过。 | In the separate window, check the Learn page, navigation and read-only attachments. Record the actual account, URL and feature results. Complete any renewed campus verification in OneTHU. Fixture success does not establish live-service compatibility. |
| 5 | 点击「停止代理」，确认监听停止、独立窗口关闭。若曾启用系统代理，先确认原代理已恢复。 | Choose **Stop proxy** and confirm the listener and isolated window close. If the system proxy was enabled, verify restoration first. |

可选系统接入：展开「系统代理与手动接入」，查看代理范围和证书指纹，主动选择「授权信任证书」后再「启用系统代理」。系统可能请求授权。如果已有代理，优先使用独立校园浏览器，或自行关闭旧代理后重试。退出时用「恢复原代理设置」，再按需「撤销信任」。有旧进程遗留配置时，恢复按钮直接显示在基本状态行，停止状态下也能操作。**本轮没有执行真实系统信任或代理修改，不能将模拟平台测试当作 macOS / Windows 实机验收。**

Optional system setup: expand **System proxy and manual setup**, inspect the scope/fingerprint, then explicitly choose **Trust certificate** and **Enable system proxy**. The OS may request approval. If another proxy is active, use the separate campus browser or turn off that proxy yourself first. Use **Restore proxy settings**, then **Remove trust** if desired. Recovery from an earlier process is available from the basic status row even while stopped. **Real OS trust and proxy changes have not been accepted in this round.**

「显示代理凭据」只用于手动配置其他客户端。它显示独立的本机代理用户名/密码，不是校园账号密码；仅主动请求时读取，60 秒后自动隐藏。不要将输出放入日志或截图。

## CLI 控制

`gateway` 命令只连接**已经运行**的私有 daemon；缺少 daemon 时返回 `DAEMON_REQUIRED`，不会静默创建另一套账号运行时。先打开 OneTHU，或由用户明确执行 `onethu daemon start`。如使用自定义数据目录，CLI 与桌面必须指向同一目录。

```sh
onethu gateway status
onethu gateway start --confirm
onethu gateway open-browser --confirm
onethu gateway stop --confirm
```

所有非 `status` 操作都要求 `--confirm`。另外支持 `setup`、`trust`、`untrust`、`system-enable`、`system-disable`、`credentials`。`credentials --confirm` 会在终端输出代理密码，仅在确实需要手动接入时使用。`setup` 只准备本机密钥材料，不信任证书；`start` 只启动监听，不启用系统代理。`--desktop`、`--endpoint`、`--args` 不适用于 `gateway` 命令。

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

同日回归结果：gateway 53/53、SDK 239/239、CLI 80/80、桌面 UI fixture 22/22、启动交接 guard 18/18，桌面 TypeScript 检查通过，中英字典各 7746 键、0 错误。UI 检查包含忙碌标签、凭据仅主动读取/复制/隐藏、现有代理冲突、停止状态恢复、缺少运行环境、手机不可用及英文窄窗排版。启动 guard 检查覆盖就绪账号不被替换、空账号 bootstrap、退出标记、认证中状态与异步账号变化；不会为了启动代理改写公开 CLI 策略。真实学校读取结果单独记录在上方，未将 fixture 结果外推到其他服务。

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

`existingCampusProxySession` 必须来自现有账号拥有者，不得通过复制 Cookie 快照新建登录实例。低层 `createCampusGateway` 仍接受 `session.request/epoch/assertCurrent` 和 `tls(hostname, { signal })`；默认只监听 loopback。客户端凭据格式为 `Proxy-Authorization: Basic base64("onethu:" + token)`，与 daemon 管理凭据分离。

`session.request` 返回单跳 Fetch `Response`，请求体可能是 Node Readable，带 `duplex: 'half'`；应遵守取消和账号 epoch。采用 Fetch 已解压字节语义，优先请求 `Accept-Encoding: identity`，移除失效的长度/编码/摘要。压缩的 206/Content-Range 明确拒绝，避免声明范围与解压字节不符。独立 JavaScript 与 HTML 内联脚本中的已知 `vpn_eval` 包装会在有界字节流中还原，不增加 `eval` 助手、不放宽 CSP。SDK 只在识别到特定 WebVPN Cookie bootstrap 时，对 GET / HEAD 完成引导后重取一次；不会重放 POST 或上传。

浏览器 Cookie、Authorization、认证类 `Set-Cookie` 和内部 `x-onethu-*` 头不会越过会话边界。网络学堂仅投影其页面需要的 `XSRF-TOKEN` 防伪 Cookie：要求当前权威 Cookie 仓中明确标记为非 HttpOnly，优先取精确的学堂 WebVPN 路径，固定为 Secure / SameSite=Strict / Path=/；其余 Cookie 保持私有。其他页面内依赖 `document.cookie`、业务 token、未适配跨域 SSO 或 Service Worker 的服务仍须逐站验证。正文 URL 逆向改写不等于完整浏览器兼容。

旧 native 快照的属性来源仍有迁移限制：新的 SDK/core bootstrap 保留未知 HttpOnly 状态，但旧版 native 导出曾把缺失属性记为 false。现有快照无法反推该 false 是否来自学校响应；当前投影只限 Learn 精确作用域的 `XSRF-TOKEN`，旧 native 记录的属性迁移需单独验证。

## 未完成的覆盖

除前述安全的 HTTP → HTTPS 门面跳转外，缺少 Origin 与 Fetch Metadata 的业务请求仍被拒绝。CONNECT 握手不要求页面来源，隧道内每个 HTTP 请求都校验。仅知道代理密码不授予任意页面借用学校会话的权限。

当前没有 LAN 监听/配对、手机系统入口、微信小程序业务接入、TUN、WebSocket 或 HTTP/2/3 支持。系统代理也不保证覆盖所有第三方网络库；拒绝用户 CA、证书固定或特殊认证的应用不能标为兼容。系统 CA 授权的权限范围与代码里的校园 origin 名单是不同层次，不能把名单描述为操作系统证书的密码学约束。
