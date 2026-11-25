# 自动重登链路的 10 项缺陷与风险（维护交接）

日期：2026-11-11。基线：`799aa7843d235800d02b59e7d5644b219747c07d`（文档写作时的 HEAD）。
范围：`apps/desktop` 的会话守卫与保活、`packages/info-lib` 的登录/漫游、`packages/core` 的 HTTP/learn/选课/外网作业/GitLab 重登钩子、`packages/sdk` 的独立运行时。
性质：**静态源码审计**。没有对学校服务发起真实登录，也没有在运行时复现任何一条；下文每条都给出可复现的验证方案与证据边界。

本文是三张图示的权威文本版本；图示已按 R1–R10 重新标注。初稿里的「V1 登前清空全站 Cookie」经本轮复核**不成立**，见附录 A。

## 摘要

| 编号 | 缺陷 | 严重度 | 主要位置 | 建议 |
|---|---|---|---|---|
| R1 | 重登后无条件重放原请求，写操作可能重复执行 | 高 | `packages/core/src/http.ts:476-484`；`packages/core/src/learn/client.ts:1069-1093` | P0 |
| R2 | 显式登出后，10 分钟保活可把账号自动登回 | 高 | `apps/desktop/src/lib/reload.ts:118-146`；`apps/desktop/src/lib/infoLib.ts:618-632` | P0 |
| R3 | 后台重登可能进入 2FA 等待，占住全局登录锁最长 3 分钟 | 高 | `packages/info-lib/src/lib/core.ts:338-399,468-470`；`apps/desktop/src/lib/infoLib.ts:634-645` | P0 |
| R4 | 无凭据时的只读探针凭网关票判「活着」，制造假活 | 中 | `apps/desktop/src/lib/infoLib.ts:641-666` | P1 |
| R5 | 失登判据只看页面形态，正常页面可误触发密码提交 | 中 | `packages/core/src/http.ts:607-614` | P1 |
| R6 | 频控与重登名额是进程级/全局键，跨账号、跨登录继承 | 中 | `packages/core/src/exthw/index.ts:139-173`；`apps/desktop/src/lib/loginGate.ts:1-24` | P1 |
| R7 | 「记住密码」仅逐字节 XOR + base64，可逆 | 中高 | `apps/desktop/src/lib/clients.ts:109-127` | P1 |
| R8 | 选课的强制重登绕开登录冷却，可反复提交密码 | 中 | `apps/desktop/src/lib/infoLib.ts:748-762` | P2 |
| R9 | 并发接力直接返回成功，不校验目标域会话 | 低中 | `packages/info-lib/src/lib/core.ts:674-678` | P2 |
| R10 | 20 秒静默恢复窗口直接失败且不排队，失登停在错误态 | 中 | `apps/desktop/src/lib/reload.ts:20-26,100-111` | P2 |

## 复核方法与证据边界

- 逐条读源码，记录文件与**含端点的行区间**；文中行号对应当前 HEAD，改动后需要重新定位。
- 「已确认」= 代码路径可读地成立；「需真机」= 依赖服务端行为或时序，静态无法判定。R1、R3、R5 的**损害是否实际发生**依赖学校服务端的响应形态，本文只断言代码没设防，不断言线上已发生。
- 本轮没有执行真实登录/提交。下面每条给的验证方案都尽量不依赖真实账号（mock 传输层或合成 HTML）。
- 与初稿图示的编号差异见附录 A；两套编号不要混用。

## 逐条分析

### R1 重登后无条件重放原请求，写操作可能重复执行

**严重度**：高（数据重复/重复提交，不可回滚）。

**位置**
- `packages/core/src/http.ts:476-484`：`text()` 命中 `#looksLoggedOut` 后 `await` 重登，**无论重登返回什么**都再发一次原请求。
- `packages/core/src/http.ts:595-597`：`postForm()` 直接走 `text()`，所以所有 POST 继承同一行为。
- `packages/core/src/learn/client.ts:1069-1093`：`submitHomework` 把「POST 提交」整个包在 `#withRelogin` 里；响应像登录页时在**提交之后**抛 `SessionExpiredError`，`#withRelogin` 捕获后重跑整个闭包（`learn/client.ts:773-790`）——即第二次 POST 作业。

**机制**
HTTP 层把「响应里出现登录页特征」当成「请求没被服务端受理」。但页面级判定无法区分两种情形：请求在鉴权阶段就被拒（重放安全），或请求已被业务处理、响应在回程被网关/会话跳转替换成登录页（重放即重复提交）。`submitHomework` 的注释自己写了「提交后没等到确认」，说明团队已知这一窗口，但仍选择重试。

**触发条件**
会话在请求发送与响应返回之间失效；或 WAF/网关把已提交成功的响应替换成登录页。learn 提交作业、带附件上传最典型；`http.postForm` 的调用方（`packages/core/src/info/client.ts` 的缴费/发票等写接口）同理。

**现有缓解**
`packages/info-lib/src/lib/core.ts:777-807` 的 `roamingWriteWrapper` 是应当复制的正面参照：写操作只在**原始端点明确 401** 时重试一次，且注释说明「不设第二层隐式重放」。这套克制没有下沉到 `core` 的 `HttpClient` 和 `LearnClient`。

**修复建议**
1. 给 `text()/postForm()` 加重放策略参数（`replay: "safe" | "never"`），默认按方法判定：GET/HEAD 可重放，POST/PUT/PATCH/DELETE 不自动重放。
2. `submitHomework` 这类写操作移出 `#withRelogin`：会话失效时先重登，再由调用方**显式**决定是否重提；或引入请求幂等键/提交前去重（服务端不支持幂等键时，至少生成客户端提交指纹）。
3. 写操作重登成功后只上报「会话已恢复，请重试」，不自动执行。

**验证方案**
mock learn 传输层：第一次 POST 返回含 `i_pass` 的 HTML，第二次返回成功页；断言 `tjzy` 端点的调用次数。修复后应为 1 次 + 明确的失败结果。

**关联**：R5（更宽的误判会放大重复提交概率）、R9。

### R2 显式登出后，10 分钟保活可把账号自动登回

**严重度**：高（共享设备上的隐私/越权使用；与「已登出」的用户预期直接冲突）。

**位置**
- `apps/desktop/src/lib/reload.ts:118-146`：`installKeepalive()` 每 10 分钟无条件调 `libEnsureSession()`，成功即把 `session.state` 置回 `ready` 并 `persist()`。
- `apps/desktop/src/lib/infoLib.ts:618-632`：`libHydrateCredentials()` 在 `helper.userId/password` 为空时从「记住密码」回灌，判定条件只要求 `!session.username || 同账号`。
- `apps/desktop/src/lib/clients.ts:1070-1122`：`logout()` 清 helper、清 jar、`session.reset()`，但**不调用 `clearRemembered()`**（只有登录时未勾选记住、或设置页手动清除才删文件，见 `clients.ts:416-417`、`pages/Settings.tsx:218`）。
- `apps/desktop/src/lib/authCookieBoundary.ts:37-45`：登出会写入 signed-out 墓碑，但墓碑只被启动/交接路径消费；运行中的保活不读它。

**机制**
登出把 `session.username` 置空，恰好满足回灌条件；下一次保活 `libEnsureSession()` → `verifyAndReLogin()` 探活失败（Cookie 已清）→ `login(helper, userId, password)` 用记住的密码完成一次完整登录。登出墓碑没有被查询，因此「已登出」只是 UI 状态，不是运行时不变量。

**触发条件**
登录时「记住密码」默认开启（`clients.ts:416`，`opts.remember ?? true`）→ 退出登录 → 主窗口保持打开 10 分钟（或跨过下一个保活节拍）。只有用户显式取消勾选，或在设置里清除过密码，才不成立。

**现有缓解**
无。`clients.ts` 的 `resumeGeneration++` 只保护启动期探测；`sharedLoggedOut` 只在共享运行时分支使用；两者都不拦保活。

**修复建议**
1. 在模块级维护 `signedOut` 运行时标志，`logout()` 置真、成功登录置假；`libEnsureSession()` 入口先判它。
2. `installKeepalive()` 的闭包同样读取该标志（或由 logout 卸载定时器并重装）。
3. 登出语义与「记住密码」解耦：登出时不必删密码，但**必须**让自动链失效；或引入与 `authCookieBoundary` 墓碑同源的查询（`readOwner() === null` 即拒绝自动重登）。

**验证方案**
不依赖真实账号：在 dev 面板/tests 中注入 remembered 凭据桩，调用 `logout()` 后手动触发一次保活回调，断言 `login()` 未被调用（mock `verifyAndReLogin`）。当前代码会失败。

**关联**：R6（全局冷却不能替代登出标志）、R8。

### R3 后台重登可能进入 2FA 等待，占住全局登录锁最长 3 分钟

**严重度**：高（可用性；用户在此期间无法手动登录，且看不到任何提示）。

**位置**
- `packages/info-lib/src/lib/core.ts:338-399`：`twoFactorAuth()` 依次调用 `helper.twoFactorMethodHook` / `twoFactorAuthHook`；没有钩子或钩子不返回时抛错。
- `apps/desktop/src/lib/infoLib.ts:325-355`：这两个钩子**常驻安装**，返回「等 UI 选方法/输码」的 Promise；`methodsNotify` 只有登录界面挂载后才会被赋值（`infoLib.ts:401-406`）。
- `packages/info-lib/src/lib/core.ts:468-470`：登录链有 3 分钟超时，超时以 `LoginError("Login timeout.")` 结束。
- `apps/desktop/src/lib/infoLib.ts:634-645`：`libEnsureSession()` 只检查凭据与 `loginCooldownLeftMs()`，**不检查 `libLoginPending()`**。对照 `state/gitlab.ts:105` 的哨兵，那里显式让路 2FA。

**机制**
后台链（保活、HTTP 透明重放、Learn 宿主钩子）可以走到 `login()`；若 id 要求二次认证，链会调用常驻 2FA 钩子。没有 UI adopt 时 `methodsNotify` 为空，`resolveMethod` 永不被调用，链一直挂到 3 分钟超时。期间 info-lib 的 `outstandingLoginPromise` 一直被占：同账号的手动登录会 `await` 它（`core.ts:416-421`），异账号直接 `AUTH_IN_PROGRESS`。用户看到的是「点了登录没反应」。

**触发条件**
会话过期 + 有可回灌凭据 + 不在冷却期 + 没有进行中的 lib 登录 + id 判定需要 2FA（finger3 缺失/失效/被清理）。选课 `libForceRelogin` 与后台保活都可能满足。

**现有缓解**
`loginBridge`（`infoLib.ts:470-485`）与 `outstandingLoginPromise` 保证不会并发提交密码，但**不缩短等待**；`libLoginPending()` 已存在（`infoLib.ts:765-767`），只是主守卫没用。仓库里还留着同类事故的记录：`clients.ts:413-415` 明确写了「强制 2FA 的链路被 keepalive/静默重登/lib 僵尸链三面夹击，稳定性失控」，最终撤除了指纹轮换实验——说明后台链与交互式 2FA 抢道是已经被观察到的问题，只是当时的解法是撤功能，不是加互斥。

**修复建议**
1. `libEnsureSession()` / `libSoftRelogin()` / `libForceRelogin()` 入口增加 `libLoginPending() || flow.pending` 早退，返回 `false` 而不是排队。
2. 后台链传入「禁止交互」上下文：`login()` 增加 `allowInteractive2FA` 参数，后台为 false 时 2FA 分支立即抛 `AUTH_2FA_REQUIRED`（专有错误码），由 UI 提示「需要重新登录并完成二次认证」。
3. 2FA 钩子在无 adopt 时立刻 reject，而不是挂起。

**验证方案**
单测：把 `verifyAndReLogin` 的探针桩成过期、`login` 桩成进入 2FA 分支，调用 `libEnsureSession()`，断言在 100ms 内返回 `false` 而不是等到超时；再断言此时手动 `libLogin()` 不会 `await` 挂起。

**关联**：R2、R8、R10。

### R4 无凭据时的只读探针凭网关票判「活着」，制造假活

**严重度**：中（反复失败、错误地报告已恢复；不直接造成数据损失）。

**位置**
`apps/desktop/src/lib/infoLib.ts:641-666`。有凭据且不在冷却期时走 `verifyAndReLogin`；否则用 `wengine-vpn/cookie` 探针，`status===200` 且响应体含 `XSRF-TOKEN=` 就 `return true`。

**机制**
`XSRF-TOKEN` 是网关层票据，只能证明「网关愿意为你签票」，不能证明 info 域会话仍属于本人。返回 `true` 的语义是「会话可用」，于是 `softRecover` / `installKeepalive` 会把 `session.state` 置回 `ready` 并持久化（`reload.ts:30-40,126-129`），页面据此重试，随后再 401，形成「恢复→重试→失败→冷却」的循环。代码注释已承认这条路径弱于 `verifyAndReLogin`（「只证明网关发了票」），但仍以 `true` 返回。

**触发条件**
重启恢复或凭据未回灌（无记住密码）、或处于冷却期时的任何失登。典型：冷启动后立刻点开数据页。

**现有缓解**
只在无凭据/冷却期使用；`softRecover` 的 20s 窗口避免紧循环（见 R10，但代价是别的缺陷）。

**修复建议**
把返回值从布尔改为三态 `alive | dead | unknown`；只读探针只能给 `unknown`，调用方保留原错误、不置 `ready`、不广播 `authRecovered`。

**验证方案**
单测：探针桩返回含 `XSRF-TOKEN=` 的 200、业务请求 401，断言 `libEnsureSession()` 不再报告已恢复（当前实现返回 true）。

**关联**：R10。

### R5 失登判据只看页面形态，正常页面可误触发密码提交

**严重度**：中（多余密码 POST，撞风控/锁定；误判会触发一次完整重登）。

**位置**
`packages/core/src/http.ts:607-614`：响应 URL 含 `/do/off/ui/auth/login/`、或头 `x-onethu-auth-dance: webvpn-login`、或**响应体**含 `id="sm2publicKey"` / `name="i_pass"` 即判失登。

**机制**
判定只看形态，不看身份与业务上下文。任何经 `HttpClient` 取回、正文里带这两个字面量的页面都会触发：帮助页/说明页、错误页回显表单、被代理的第三方页面、甚至 JSON 里恰好包含该字符串。触发后的动作是「清状态 + 重登 + 重放」，代价远大于误判成本。

**触发条件**
页面上出现同名字面量；网关把正常内容包装成登录页；后端错误页包含表单片段。

**现有缓解**
`libSoftRelogin` 的指数冷却（`clients.ts:287-306`）能抑制连锤，但抑制的是**频率**，不是**误判**；误判一次仍会提交一次密码。

**修复建议**
1. 增加负向证据：响应必须来自登录域名，且同一会话的业务端点确实返回未认证（或探针 `verifyAndReLogin` 明确过期）才进入重登。
2. 只对明确的 JSON `401`/`status:401`、明确的登录重定向链判定；正文特征降级为「疑似」，先探活再决定。
3. 误判要可观测：记录判定依据（哪个特征、哪个 URL），当前日志只记「会话失效」。

**验证方案**
构造一个 200 + 正常正文 + 含 `i_pass` 字面量的响应，断言不触发重登（当前实现会触发）。

**关联**：R1（误判直接放大为重复提交）。

### R6 频控与重登名额是进程级/全局键，跨账号、跨登录继承

**严重度**：中（换账号后被旧账号的冷却/名额拦住，用户表现为「换了账号还是登不上/不自动恢复」）。

**位置**
- `packages/core/src/exthw/index.ts:139-173`：`sessionRetryState` 是模块级对象，按源计「10 分钟 1 次、每进程 3 次」；`reset*SessionRetryState()` 只被测试调用，生产登录/登出不清零。
- `apps/desktop/src/lib/loginGate.ts:1-24`：`onethu.login-attempt-at` 是单一 sessionStorage 键，不区分账号；20 秒内任何新登录都抛 `AUTH_COOLDOWN`。
- `apps/desktop/src/lib/clients.ts:287-303`：`libSoftFailStreak` / `libSoftCooldownUntil` 是模块级变量，冷却最长 10 分钟，不随账号切换重置。
- `packages/sdk/src/node/session.ts:108-112`：`beforeLoginAttemptHook` 的 1500ms 限流同样是全局的。

**机制**
频控的目的是「对同一个会话/同一个源限速」，实现却挂在进程与浏览器存储上。换账号后，新账号继承了上一个账号的失败计数与冷却；外网作业源用满 3 次后，直到进程重启都不再自动恢复——而用户可能只是切了个账号。

**触发条件**
同进程内切换账号；外网作业源连续失败 3 次；20 秒内连续两次登录（含「退出后立刻换号登录」）。

**现有缓解**
冷却时间有限（20s / 10min）；重启进程可清空外网源计数。

**修复建议**
频控键改为 `account|source`（或 `account|scope`），并在登录成功、登出、账号切换时清零；外网源计数随账号走，不随进程走。

**验证方案**
单测：以账号 A 触发 3 次外网重登失败，切到账号 B，断言 B 仍有 3 次名额；当前实现会共享同一计数。

**关联**：R2（登出后继承冷却）、R8。

### R7 「记住密码」仅逐字节 XOR + base64，可逆

**严重度**：中高（威胁模型限定为「能读到该文件的本地主体」；但备份、同步盘、同用户进程都满足）。

**位置**
- `apps/desktop/src/lib/clients.ts:109-127`：`obfuscateSecret()` 用固定串 `OneTHU|<username>|remember` 逐字节 XOR，再 base64；注释自述「本机混淆、非明文；非加密承诺」。
- `apps/desktop/src/lib/clients.ts:56,138-156`：文件名为 `credentials`，经 `state_read/state_write`。
- `apps/desktop/src-tauri/src/lib.rs:730-734`：写入走 `native_security::private_atomic_write`，权限为当前用户私有（0600/ACL）——这是唯一实质保护。

**机制**
密钥是常量且可从源码读出，用户名在文件里同时明文保存；解密不需要任何秘密。私有文件权限只挡住其他 OS 用户，挡不住同一用户下的其他进程、备份/云同步、崩溃转储。

**触发条件**
攻击者取得该用户对应用数据目录的读权限（恶意软件、被同步的备份、取证镜像）。

**现有缓解**
文件权限 + 原子写；SDK 侧明确不支持保存密码（`packages/sdk/src/node/storage.ts:1`）。

**修复建议**
改用系统钥匙串（Windows DPAPI/Credential Manager、macOS Keychain、libsecret），只保存引用；无法使用钥匙串时至少不要「可逆」，改为服务端不可逆凭据（如设备令牌）并支持吊销。

**验证方案**
用源码里的常量对 `credentials.json` 的 `secret` 字段做 XOR+base64 解码，应还原出明文密码（离线可验，不需要 App）。

**关联**：R2（自动重登依赖这份凭据）。

### R8 选课的强制重登绕开登录冷却，可反复提交密码

**严重度**：中（风控/锁定风险；与 R6 叠加时用户会看到「等 20 秒」但实际没生效）。

**位置**
`apps/desktop/src/lib/infoLib.ts:748-762`：`libForceRelogin()` 先 `libHydrateCredentials()` 再直接 `libLogin()`，**不检查** `loginCooldownLeftMs()`、`libLoginPending()` 或失败计数。调用方是选课的 `xkReloginHook`（`clients.ts:189-192`），在 `checkSingle` 死结时触发（`packages/core/src/zhjwxk/client.ts:250-266`）。

**机制**
设计上「强制」就是要跳过探活短路，但实现同时跳过了所有准入闸门。选课页可以反复进入，每次死结都可能发起一次完整账密登录；`xkFailCooldownUntil` 只有 3 秒（`zhjwxk/client.ts:412`），不足以约束。与手动登录共享的 20s 冷却（R6）也拦不住它——它是另一条路径。

**触发条件**
选课 `checkSingle` 反复不落地；用户反复重开选课页。

**现有缓解**
`libLoginPending`/`loginBridge` 保证不并发提交；成功能结束死结。

**修复建议**
`libForceRelogin()` 复用统一准入：至少检查 `loginCooldownLeftMs()`、`libLoginPending()`，并为「强制重登」单独设更长的冷却（如 60s）与每次会话的尝试上限。

**验证方案**
单测：模拟 20s 内连续两次 `libForceRelogin()`，断言第二次返回 false 且不调用 `libLogin`（当前会调用）。

**关联**：R3（可能在后台触发 2FA）、R6。

### R9 并发接力直接返回成功，不校验目标域会话

**严重度**：低中（错误地把「别人在登录」当成「我已恢复」；通常表现为重试后仍失败）。

**位置**
`packages/info-lib/src/lib/core.ts:674-678`：`verifyAndReLogin()` 发现 `outstandingLoginPromise` 时 `await` 它并直接 `return true`。

**机制**
返回值语义是「会话已重建，可以重试」。接力路径没有重新探活，也不确认那条登录是否覆盖了当前调用方的目标域（info 门户 vs learn 的 CSRF 会话是两个域）。若接力者只完成了 id 层登录，调用方会重试一次然后仍然失败——错误被推迟并放大成「重登也没用」。身份本身由 `login()` 的 `AUTH_IN_PROGRESS` 保证同账号，所以这不是串号问题。

**触发条件**
两条通道同时在失登窗口内恢复；接力者失败会以 rejection 传播（这点是正确的），接力者只建立了部分会话时才有害。

**现有缓解**
`login()` 的同账号校验；调用方只重试一次。

**修复建议**
接力后重新跑一次目标探针，只有明确 alive 才 `return true`；否则返回 `false`，让调用方保留原错误。

**验证方案**
单测：外部挂起一个 `outstandingLoginPromise`，让它 resolve，同时让探针桩返回 dead，断言 `verifyAndReLogin()` 返回 false（当前返回 true）。

**关联**：R4（同样是「没验就报活」）。

### R10 20 秒静默恢复窗口直接失败且不排队，失登停在错误态

**严重度**：中（用户可见的失败；下一次自动恢复可能要在 10 分钟后）。

**位置**
- `apps/desktop/src/lib/reload.ts:20-51`：`softRecover()` 在 20s 窗口内直接 `return false`；失败也不排队。
- `apps/desktop/src/lib/reload.ts:100-111`：`installAuthWatchdog()` 丢弃 `softRecover()` 的返回值，失败后没有任何重试安排。
- `apps/desktop/src/lib/reload.ts:118-146`：唯一兜底是 10 分钟一次的保活。

**机制**
节流的目的（避免「恢复→重试→仍 auth 错→再恢复」紧循环）是对的，但实现把「窗口内暂不恢复」变成了「本次失败」。窗口内真正需要恢复的请求既没有被记住，也没有被延迟重试；看门狗连结果都不看。若恢复确实失败（例如 R3 的超时），用户会停在错误页最久 10 分钟。

**触发条件**
同一 20s 窗口内的第二次失登；首次恢复因网络抖动/R3 失败。

**现有缓解**
各页面通常有手动「重试」；聚焦唤醒只探 learn（`reload.ts:150-161`）。

**修复建议**
1. 窗口内不要返回「失败」，而是返回「已排队」：记录待恢复的 scope，窗口结束后自动重跑一次（带次数上限）。
2. 看门狗消费返回值；失败时安排一次退避重试（例如 5s/15s/60s），而不是交给 10 分钟保活。
3. 恢复成功/失败都要 `emitAuthRecovered` 或 `emitAuthFailed`，让停在 error 的页面能自更新。

**验证方案**
单测：两次连续 `softRecover()`，断言第二次返回「queued」并在 20s 后自动执行（当前第二次返回 false 且永不执行，可用假定时器验证）。

**关联**：R3、R4。

## 结构性根因

1. **单飞分散在七处**：`http.ts:262-266`、`learn/client.ts:721-736`、`exthw/index.ts:167-168`、[state/gitlab.ts:87-118](../../apps/desktop/src/state/gitlab.ts)、`infoLib.ts:470-485`（`loginBridge`）、`core.ts:334`（`outstandingLoginPromise`）、`reload.ts:20-26`（`recoverInflight`）。彼此不可见，只靠最后的登录锁串行化。这解释了为什么「并发重登烧票」反复出现：每加一条通道就多一个锁。
2. **判定与执行耦合**：HTTP 层替业务层决定「这是失登、应该重放」，于是 R1/R5 天然存在。写操作是否重放应该由知道语义的业务层决定。
3. **凭据生命周期没有单一权威**：记住密码文件、`helper` 内存字段、`pendingSecret`、`session`、cookie jar、登出墓碑六处状态，登出只清了其中几处（R2）。
4. **「已恢复」没有统一语义**：布尔返回值混用「探到了」「别人登好了」「网关发了票」（R4/R9），调用方无法区分。

## 修复排序建议

- **P0（先做，都是小改动、收益最大）**
  - R2：加 `signedOut` 运行时标志，保活/守卫入口判它。
  - R3：守卫入口判 `libLoginPending()`；后台登录禁止交互式 2FA，失败即返。
  - R1：`HttpClient` 重放按方法分级；`submitHomework` 移出自动重放。
- **P1**
  - R5：判定加负向证据；误判日志。
  - R4：探针三态化，只读探针不再报 alive。
  - R6：频控键按账号；登录/登出清零。
  - R7：钥匙串迁移（可分两期：先 DPAPI/Keychain，再废弃密码保存）。
- **P2**
  - R8：强制重登纳入统一准入。
  - R9：接力后重探。
  - R10：窗口内排队 + 看门狗退避。
- **结构项（可与上面并行）**：把七处单飞收敛成一个「会话恢复协调器」（账号 + scope 键），把「已恢复」改成枚举，把登出墓碑变成运行时权威位。

## 验证清单（建议进 CI 的部分）

1. 写操作重放：mock 传输层，断言 `tjzy` POST 次数 = 1（R1）。
2. 登出后保活：注入 remembered 桩，`logout()` 后触发保活，断言 `login` 未调用（R2）。
3. 后台 2FA：探针桩过期 + 2FA 分支，断言 `libEnsureSession` 快速返回 false（R3）。
4. 只读探针：200 + `XSRF-TOKEN`，断言不再报 alive（R4）。
5. 误判：正文含 `i_pass` 的正常页，断言不触发重登（R5）。
6. 频控跨账号：账号 A 用尽名额后切 B，断言 B 有名额（R6）。
7. 强制重登冷却：20s 内两次 `libForceRelogin`，第二次 false（R8）。
8. 接力：挂起登录 resolve 但探针 dead，断言 false（R9）。
9. 20s 窗口：两次 `softRecover`，第二次排队并执行（R10）。
10. 凭据文件：只做读取格式断言，**不要在 CI 里还原真实密码**（R7 用手工离线验证）。

## 交付边界

- 本文是静态审计结论，没有真实账号参与、没有对学校服务发起登录，也没有运行时复现 R1/R3/R5 的损害。凡涉及「服务端是否会重复落库」「2FA 是否会被后台触发」的判断，都以代码路径与现有注释为证据，需要维护者用真机或受控 mock 复核。
- 行号对应当前 HEAD；修复后请以函数名与语义定位，不要以行号为准。
- 本轮没有修改任何源码，没有提交 git；本文档落在 `docs/reviews/`，目录按 `node tools/docs-catalog.mjs` 的排序补入一行。完整重新生成会顺带新增 76 条此前未登记的历史文档，为避免无关 diff 没有纳入。

## 附录 A 与初稿图示的编号差异

初稿（2026-11-11 的三张 HTML 图）把 V1 记为「重登先清空全站 Cookie」。本轮复核**不成立**：

- `packages/info-lib/src/utils/network.ts:53-57` 的 `clearCookies()` 只清 lib 内部的 JS cookie 表，再调 `platformClearCookies`。
- 桌面端 `setPlatformClearCookies` 是显式空实现（`apps/desktop/src/lib/infoLib.ts:132-141`），注释说明「不清任何桶」是为避免 OAuth 已消费 code 的复用问题。
- SDK 同样是空实现（`packages/sdk/src/node/session.ts:107`）。
- 选课的「自清仓」实际是**域清**：只清 `id.tsinghua.edu.cn` / `oauth.tsinghua.edu.cn`（`apps/desktop/src/lib/transport.ts:139-150`）。

因此桌面/SDK 的重登**不会**清空全站票据；真正的缺陷是相反方向——登出后仍能自动登回（R2）。图示中其余编号与本文的对应关系：

| 初稿 | 本文 | 变化 |
|---|---|---|
| V1 清空全站 Cookie | — | 不成立，改为 R2（登出后自动登回） |
| V2 写请求被重放 | R1 | 同 |
| V3 只读探针假活 | R4 | 同 |
| V4 后台重登抢 2FA | R3 | 同，补上 3 分钟登录锁的机制 |
| V5 频控跨账号 | R6 | 同 |
| V6 特征误判 | R5 | 同 |
| V7 并发接力 | R9 | 同，严重度下调为低中（身份由登录锁保证） |
| V8 XOR 混淆 | R7 | 同，补上文件权限这一层缓解 |
| V9 单飞互不相通 | 结构项 | 降级为结构性根因，不再单列为漏洞 |
| V10 20 秒窗口 | R10 | 同 |
| — | R8 | 新增：`libForceRelogin` 绕开冷却 |

## 附录 B 文件索引

| 文件 | 作用 |
|---|---|
| `apps/desktop/src/lib/reload.ts` | 看门狗、20s 静默恢复、10 分钟保活 |
| `apps/desktop/src/lib/infoLib.ts` | lib 单例、凭据回灌、会话守卫、强制重登、2FA 钩子 |
| `apps/desktop/src/lib/clients.ts` | 客户端装配、透明重放钩子、冷却、记住密码、登出 |
| `apps/desktop/src/lib/loginGate.ts` | 20s 登录冷却（全局键） |
| `apps/desktop/src/lib/authCookieBoundary.ts` | 登出墓碑与账号边界 |
| `packages/info-lib/src/lib/core.ts` | 登录链、2FA、漫游、`verifyAndReLogin`、写包装器 |
| `packages/info-lib/src/utils/network.ts` | `clearCookies` 与平台钩子 |
| `packages/core/src/http.ts` | 失登判据、单飞、无条件重放、广播 |
| `packages/core/src/learn/client.ts` | Learn 会话错误、`#withRelogin`、作业提交 |
| `packages/core/src/exthw/index.ts` | 外网作业源级重登与进程级频控 |
| `packages/core/src/zhjwxk/client.ts` | 选课 id-bounce 与死结重登 |
| `packages/sdk/src/node/session.ts` | 独立运行时恢复、学习懒建、登录冷却 |