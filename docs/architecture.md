# 系统架构

本文档描述 OneTHU 的进程模型与各子系统设计，面向宿主贡献者。

## 1. 进程模型

```
┌─ 桌面（macOS / Windows / Linux）─────┐   ┌─ Android ─────────────────────┐
│  webview（React 应用）               │   │  webview（同一 React 应用）    │
│   ├ JS 插件：同域执行                │   │   ├ JS 插件：同左              │
│   ├ Rust sidecar 插件：独立进程      │   │   ├ onethu.harness：Rust 核心 │
│   │  stdio JSON-RPC                  │   │   │  编译进动态库（命令桥）    │
│   └ src-tauri（reqwest 传输层）      │   │   └ src-tauri：同左            │
└──────────────────────────────────────┘   └───────────────────────────────┘
```

会话维护、超时、重试与权限校验均在宿主侧实现（webview 门面与 Rust 传输层）。
`onethu.harness` 为官方骨干插件，桌面形态为独立进程，Android 形态将同一份
`core` 编译进应用进程。

网络请求统一经 Tauri 的 `http_request`（Rust reqwest 异步）发出，规避 WebView 的
同源策略与请求头限制，并设置 45 秒超时。

## 2. 会话管线

- **单一管线**：CAS 票据兑换后建立 webvpn 会话，learn 与 info 请求经包装域由
  wengine SSO 透明建立。旧的 demo 链路已移除。
- **会话守卫**：HttpClient 检测到响应含登录页特征时，先探活，失效则使用内存凭据
  完整重登（受信凭据免二次认证），随后自动重放原请求。重登失败时按指数退避冷却
  （初始 30 秒，上限 10 分钟），避免触发风控。
- **网络学堂静默重登**（R21c）：learn 专线的响应为登录页或网关页时抛出
  `SessionExpiredError`，由 `#withRelogin` 静默重登一次并重放原请求；仅该类错误触发重登，
  启动期无会话时抛出的 `AuthRequiredError` 仍直接上抛，避免无凭据时空转重登。重登只重试
  一次，仍失败则交还上层提示。
- **登录链路重试**：登录过程首次失败（校园网冷漫游中断等）时使用同一凭据静默重试一次，
  期间保持 connecting 状态，两次均失败才回到登录页。
- **设备指纹策略**（2026-09-18 决议）：设备指纹固定，不执行轮换。轮换方案会使
  强制二次认证链路与保活、静默重登、lib 会话链相互干扰，稳定性不可控。指纹缺失时
  由选课模块的死结自愈机制处理（确认失败后清除账密凭据直接登录）。
- **状态持久化**：WKWebView 的 localStorage 可能被系统清理。会话快照与记住的密码
  同时镜像到应用数据目录的普通文件，启动时优先读取 localStorage，缺失则从文件恢复。
- **对外复用**：上述能力经 `onethu.ts` SDK 开放给插件（`TsHttpClient` 直接复用宿主
  HttpClient 实例，共享 cookie 池、通道分流与自愈重放），使插件可在不重复实现认证
  与通道逻辑的前提下接入新的校内服务。见
  [plugin-development.md §6](./plugin-development.md)。

## 3. 插件宿主

三种插件形态使用同一套权限门禁与数据接口。权限校验在 `facade.ts` 中按方法执行，
Rust 插件的 `onethu.call` 请求经 webview 门面执行相同校验。协议细节见
[plugin-development.md](./plugin-development.md)。

- **内置插件清单自愈**：启动阶段比对内置插件清单与镜像，不一致时重新注册，用户设置
  值保留。
- **Android 宿主判定**：`tauri.conf.json` 为适配 wengine 指纹固定了 Windows 版
  Chrome UA，导致 JavaScript 侧基于 UA 的平台判定失效。现改用 Rust 编译期命令
  `os_is_android()`，并以 `androidHost.ts` 的多信号判定作为补充。
- **插件功能页**：插件经 `registerTab` 注册页签，注册表由 `plugins/tabs.ts` 维护，
  路由为 `plugin:<插件id>:<页签id>`；`PluginTabHost` 渲染页头与挂载容器，容器常驻
  （切页仅切换显示，插件内部状态保留），容器经 `setTabRoot` 登记后由插件全权渲染。
  注册表的快照按 emit 重建并缓存，订阅端（`useSyncExternalStore`）不得拿到每次新建
  的数组，否则无限重渲染导致白屏。插件的渲染回调异常在页面内提示，不静默忽略。
- **侧栏分组**：内置入口（含折叠组）、插件功能页、收藏夹三段分列并各带分组标题；
  收藏夹段限高滚动，收藏数量增长不挤压「新建收藏夹」与折叠组。
- **主题归属**：主题定义与提供它的插件是同一份状态。`installTheme` 记录 `owner`
  插件 id，插件卸载 / 停用 / 覆盖安装三条路径经 `removePluginThemes` 回收自己的
  主题（覆盖安装用 `keep` 保留新版定义，应用状态不中断）。历史上无 `owner` 的记录
  以「主题 id 与插件 id 同名」的约定与模块声明的主题 id 兜底匹配。
- **市场拉取通道**：插件安装/更新与市场名单刷新优先经 GitHub contents API，raw 域名
  降级兜底（缓存语义差异见 [plugin-development.md §8.4](./plugin-development.md)）。
- **系统通知投递**：规则在 JS 侧计算（`state/notifyPlan.ts` 生成计划、`state/notifyInputs.ts`
  取数、`notifyScheduler.ts` 与原生实际排程对账），原生仅负责投递；覆盖对象为**课表与考试、
  自定义日程（含 rrule 展开，用事件自带 alarmMinutes 优先）、未交作业 DDL、每日早报**
  （仅含日程的日期同样发送早报，避免用户将无提醒理解为无待办事项）：Android 经 `onethu-mobile` 插件落 AlarmManager，
  macOS 用 `UNUserNotificationCenter`，Windows 用 WinRT toast + `AddToSchedule`。
  落点（点击通知打开的页面）由原生存储、应用回前台时读取并导航：Android 由点击广播写入
  SharedPreferences，macOS 由 `UNUserNotificationCenterDelegate` 回调按通知 identifier 反查
  （映射落盘，以覆盖「点通知冷启动应用」这条路径）；**Windows 尚未接入**：toast 点击需注册
  COM 激活器（`INotificationActivationCallback` + `ToastActivatorCLSID`），当前点击仅将应用
  带到前台（见 `src/notify_windows.rs` 文件头）。
- **桌面小组件（Android）**：内容在 JS 侧计算完成（`state/widgetSnapshot.ts` 生成「今天」的内容与
  各形态构造器，`state/widgetSource.ts` 将用户绑定解析为行或图标），原生仅负责将内容填入 RemoteViews。
  小组件进程不含 WebView 与会话，任何需要网络或解析的逻辑均无法在该进程执行。
  **内容按块绑定**（`state/widgetInstances.ts`，键为 appWidgetId）：桌面可同时放置日程与 DDL、
  单个原子占满的详情、一个收藏夹的图标组、一个 1×1 快捷方式，四类内容互不影响；绑定的入口是
  AppWidget 的 configure 流程（放置时由 `OnethuWidgetConfigActivity` 将 `widget-config:<id>` 记录为
  落点后拉起应用，应用显示选择层），亦可点击桌面上未绑定的实例或在设置页逐块修改。原生按
  appWidgetId 存内容，实例清单由 `widget_instances` 命令报回（读不到时**不允许原生修剪**，
  否则会误删所有内容）。宿主小组件声明五种初始形态（1×1 快捷方式 / 2×1 / 2×2 / 3×2 / 4×1）：
  选择器内可选的形态数等于清单中的 provider 数，故形态只能通过多声明 provider 提供（五者共用同一套
  渲染与同一份实例内容，行数与图标格数按实际占位自适应，放置后仍可自由拖动）。插件小组件由于
  Android 不允许运行时注册 provider，采用**固定槽位**（3 个）按声明顺序占位。
  **图标同样由应用侧计算**：小组件中不含 WebView，插件的 SVG 与宿主 React 图标在该进程中均不可用，
  故 `state/widgetIcon.ts` 在前台将原子图标渲染为 SVG → canvas → PNG（按原子缓存）随内容下发。
  原生渲染只能用 RemoteViews 白名单里的控件（标了 `@RemoteView` 的类：LinearLayout / TextView /
  ImageView 等）：**未列入白名单的 `View` 会导致启动器 inflate 失败，整个小组件显示为「无法加载」的黑框**；
  同样地，RemoteViews 不能设置加粗（`setTypeface` 需要 Typeface 参数，反射式 `setInt` 会直接抛出异常），
  故主次层级通过每行两个 TextView（粗体/常规）切换可见性、`setTextViewTextSize` 字号与左侧色条
  （课程色 / 紧迫度色 / 状态色）表达。单屏可显示的行数必须按**真实高度**计算（一条带说明约 38dp），
  采用「矮/中/高」三档估算会导致矮尺寸上的第二行被挤出可视区。
  详情行同理：课程下次上课与作业截止由 `state/widgetDetail.ts` 从内存计算，**下沉原子**（教室占用、
  洗衣机状态）由 `state/widgetLive.ts` 在计算快照前统一抓取一次（与收藏夹方卡共用缓存键，带超时），
  解读逻辑放在纯函数 `state/widgetLiveParse.ts`（「现在第几节」「哪几节空着」的判断均在时间边界上易出错，
  必须可直接测试）；**拿不到实时数据时不写入**：桌面上显示错误数字的代价高于留空。点击落点是「页面 + 参数」的自描述
  字符串（`folder?folderId=f1`，编解码在 `state/widgetTarget.ts`，布尔值会被还原，字符串 `"false"`
  在 JS 中为真值），应用回前台时读取并解析后导航；未绑定实例的落点是 `widget-config:<id>`，
  应用据此弹出选择层，而非跳转至空页面。
- **雨课堂题干原生渲染与提交入口**：外部作业源的正文是「加密字体 + LaTeX + 外链图片」的组合，
  在应用内直接内嵌官方页面会缺字体、缺公式，图片返回 401。做法是**正文本地渲染**：正文置于 `srcdoc`
  沙箱 iframe（脚本白名单、无网络权限），加密字体取自响应中 `data.font` 指向的 TTF 并以
  `@font-face` 应用（缓存 7 天，失败 10 分钟退避），公式用**随包内置的 KaTeX**（`vendor/katex`，
  懒加载，正文不外传），图片经应用侧带会话 Cookie 代理取回后内联；任一环节失败逐级降级至纯文本 +
  提示条，**不会出现白屏**。分数与评语使用结构化数据（`my_score` / `remark` / `comment[]`，同文去重），
  考试与已批改作业共用同一个显示函数与显示位。提交入口第一阶段内嵌官方作答页（`WebView`）并注入
  会话 Cookie，资格判定实现为纯函数；**试卷不显示任何提交入口**：只读为硬性约束，应用不代提交。
- **自检（设置 → 通知 → 自检）**：逐层探测后端类型、授权、精确提醒、小组件落地与快照时间、
  排程写入与回读、真实投递，最后撤销探针，给出「哪一层不通过」的结论。链路横跨 JS 调度、
  原生桥、系统权限、系统设置四层，用户仅能反馈「没收到」，因此将分层结论实现为一次点击即可获得的输出，
  编排逻辑在 `state/notifyDoctor.ts`（副作用全注入，可测）。
- **渠道管理与授权引导**：渠道与精确闹钟授权均在系统设置中，应用只能引导用户前往系统设置：`notify_open_settings`
  按 `channels` / `exact-alarm` / `app` 打开对应系统页（Android 使用 `Settings.ACTION_*`，
  macOS/Windows 使用 URL scheme）。设置页显示的文案与是否提供按钮，由纯函数
  `state/notifyStatus.ts` 决定（每种「后端 × 授权 × 精确」组合均需给出准确文案，故单独可测）。

## 3.x 洗衣机数据源（三个数据源）

`packages/core/src/info/washer.ts` 移植自 thu-info-app（含其 2026-09 新增的小兰智慧）：

| 数据源 | 端点 | 说明 |
|---|---|---|
| 捷利 | `api.cleverschool.cn/washapi4` + 校内 `JieliWashers` | 楼栋与设备状态；安装位置 best-effort |
| 海乐生活 | `yshz-user.haier-ioc.com` | 按清华两个坐标搜点位，只收名字含「清华」且非「清华中学」者 |
| 小兰智慧 | `wash-ltd-thu.aajax.top` | 第三方代理按机构 id 返回「楼栋 → 房间 → 设备」；上游 2026-09 新增 |

三处都是公开服务，不经校内会话（避免被 WebVPN 包装）。**楼栋用 `provider` 区分而非布尔值**：
数据源由一个增至三个后，「是否为海乐」已不足以区分，且楼栋 id 在不同数据源之间会重名，原子深链
必须携带数据源才能回到同一台设备（原子 key 第三段存 `"0"/"1"/"2"`，缺失或旧值一律按捷利解释，
原有收藏仍可正常使用；实时缓存键后缀 `j`/`h`/`x` 同理，否则两个数据源的同名楼栋会发生状态串扰）。
设备状态也按上游口径细分：**待机（可用未启动）与离线（网络断开）不是故障**，各自单列。

## 4. 主题系统

主题以插件形式提供（`manifest.category === "theme"`），实现方式为覆盖 `tokens.css`
的 CSS 变量，可选替换 logo 与附加 CSS。内置主题不可删除，仅插件主题可由用户删除
（历史上删除的内置主题可经「恢复内置主题」找回）。

昼夜调度实现于 `state/theme.ts`：

- 开启 `followSystem` 后，通过 `matchMedia("(prefers-color-scheme: dark)")` 监听系统
  深色模式变化，在 `dayThemeId` 与 `nightThemeId` 两个主题之间切换。
- 手动调用 `apply` 会关闭跟随模式，以保证手动选择后保持固定的语义。
- 声明 `dark: true` 的主题激活时，将 `document.documentElement.style.colorScheme`
  设为 `dark`，使原生控件与滚动条同步切换；切换回浅色主题或默认外观时恢复 `light`，
  维持原有针对 Android WebView 强制反色的防护。
- 内置深色主题「凝夜」（`onethu.theme.night`）在主题层以附加 CSS 修正
  `global.css` 中硬编码的浅色元素。

## 5. 模型调度（onethu.harness）

内置对话插件对接清华大学 MadModel 服务（`madmodel.cs.tsinghua.edu.cn`），该服务在
校园网内免登录提供 DeepSeek 模型，接口兼容 OpenAI 协议。

**服务端行为**（实测结论）：

| 行为 | 说明 |
|---|---|
| 令牌签发 | `GET /model-api/auth-login/check` 在校园网内返回有效期 6 小时的 JWT |
| 校外访问 | 校园网外 IP 的全部请求被重定向至统一认证（HTTP 307），该限制位于令牌校验之前，校外持有的令牌无效 |
| webvpn | 该域名未纳入 webvpn 服务范围，无法经 webvpn 建立会话 |

**模型源设置**：插件设置项 `provider` 提供三个取值——`madmodel`（清华免费服务）、
`custom`（自费 API）、空值（自动：已配置密钥时使用自费，否则使用免费服务）。设置入口
位于插件页的插件卡片内，由 `manifest.settings` 渲染。

**校外环境处理**：

1. **可达性探测**：后台任务每 10 分钟执行一次探测（直连
   `GET /model-api/auth-login/check`，不跟随重定向），每次对话前也会执行。探测结果
   写入 `madmodelReachable`，有效期为 10 分钟。
2. **状态调度**（Rust 侧 `config.rs`）：校园网内使用免费服务并自动续期令牌（阈值
   5 小时 50 分）；校外且已配置自费密钥时自动切换至自费 API；校外且无自费密钥时
   保持免费服务参数。
3. **错误提示**：校外且无自费密钥时，请求在发送前被拦截，返回包含处理指引的错误
   信息（连接校园网或学校 VPN，或在插件设置中切换至自费 API）。若仍出现 307 响应，
   宿主返回明确错误并触发一次令牌重签。

**MCP 服务器**：宿主侧配置存于 `localStorage` 键 `onethu.mcp.servers.v1`
（`lib/mcpStore.ts`，逐条增删改），在 `settings.get` 时以 `mcpServers` JSON 注入 OH
的插件设置。Rust 侧不读配置文件，仅在 `execute` 时接收该字段并据此派生
`mcp_<服务器名>_<工具名>` 工具。管理入口为插件页 OH 卡片内的「MCP」弹窗。

## 6. 外部作业源

雨课堂、TUOJ（AI 版与经典版）、Tyche 与 DSA OJ 统一映射为 `ExternalHomework` 模型，
以 `ext:` 前缀并入作业页。凭据维护、故障恢复与新源接入方式见
[external-homework.md](./external-homework.md)；作业区的交互能力（忽略、附件上传与必交
附件预检、雨课堂主观题原生作答、学术红线）见 [homework.md](./homework.md)。

**写入通道**：作业相关写请求的请求体统一经 `apps/desktop/src/lib/bodySerialize.ts`
序列化，该模块为唯一真源，nativeFetch 与 tauriFetch 共用；雨课堂正文插图上传与主观题
提交实现在 `packages/core/src/exthw/yuketang.ts`，multipart 由应用侧手工拼装。这两类
写能力**不注册进插件宿主的可调用工具清单**（护栏见 [homework.md §5](./homework.md)）。

**本机状态**：作业忽略（`onethu.hw.ignored.v1`）与必交附件记忆
（`onethu.learn.needFile.v1`）均为纯本机 localStorage 状态，不参与数据源同步。

## 7. 扫码与内嵌浏览

- **雨课堂扫码登录**：长轮询的传输层超时设置为本地计时加 10 秒，避免传输层先于本地
  计时中断请求而将「未扫码」误判为错误；传输层中断按未扫码处理，沿用同一令牌继续
  轮询，避免二维码失效。
- **前台服务保活**（Android）：扫码期间启动前台服务并显示常驻通知，避免应用在后台
  被系统冻结。
- **官方网页登录**（雨课堂）：在应用内 WebView 打开官方登录页并读取 Cookie。移动端
  使用全屏模态（Tauri 命令 `open_web_modal`，插件接口为 `ui.webModal`，需 `webview`
  权限）。
- **TUOJ 会话恢复**：接口返回 401 或 403 时静默重新漫游一次并重新拉取数据。限制条件
  为：同源两次自动重试间隔不小于 10 分钟，每进程每源不超过 3 次，同源并发 401 共享
  同一请求，用户显式退出后不自动重登。

## 8. 构建与发布

| 操作 | 命令 |
|---|---|
| 重建桌面 sidecar | `cd apps/desktop && node scripts/build-harness.mjs` |
| 启动开发环境 | `cd apps/desktop && ./scripts/dev-launch.sh` |
| 构建 Android 安装包 | `JAVA_HOME=… ANDROID_HOME=… npx tauri android build --apk --target aarch64`，随后执行 zipalign 与 apksigner 签名 |
| 前端类型检查 | `pnpm --filter @onethu/core typecheck`；`cd apps/desktop && npx tsc --noEmit` |
| Rust 检查 | `cd plugins/OneTHU-Harness/core && cargo check` |
| 数据层测试 | `node tools/exthw-status-test.mjs`、`tools/tuoj-cas-test.mjs`、`tools/ykt-qr-test.mjs` |
| SDK 分流测试 | `node --import ./tools/ts-resolve-register.mjs tools/ts-sdk-test.mjs` |
| 插件 UI 逻辑测试 | `node --import ./tools/ts-resolve-register.mjs tools/plugin-ui-test.mjs` |
| 主题插件联动测试 | `node --import ./tools/ts-resolve-register.mjs tools/theme-plugin-sync-test.mjs` |
| 通知状态文案测试 | `node --import ./tools/ts-resolve-register.mjs tools/notify-status-test.mjs` |
| 通知自检编排测试 | `node --import ./tools/ts-resolve-register.mjs tools/notify-doctor-test.mjs` |
| 通知 id 约定与归组测试 | `node --import ./tools/ts-resolve-register.mjs tools/notify-ids-test.mjs` |
| 小组件快照测试 | `node --import ./tools/ts-resolve-register.mjs tools/widget-snapshot-test.mjs` |
| 小组件内容来源解析测试 | `node --import ./tools/ts-resolve-register.mjs tools/widget-source-test.mjs` |
| 小组件详情补充测试 | `node --import ./tools/ts-resolve-register.mjs tools/widget-detail-test.mjs` |
| 小组件推送时机测试 | `node --import ./tools/ts-resolve-register.mjs tools/widget-runtime-test.mjs` |
| 插件小组件注册表测试 | `node --import ./tools/ts-resolve-register.mjs tools/plugin-widget-test.mjs` |
| Android 插件模块 Kotlin 编译 | `cd apps/desktop/src-tauri/gen/android && ./gradlew :tauri-plugin-onethu-mobile:compileDebugKotlin`（清单检查用 `:app:processArmDebugMainManifest`，不限定模块的任务名会产生歧义） |
| macOS 通知原生链路探针 | `cd apps/desktop/src-tauri && cargo build --features notify-probe --bin notify_probe`，再把二进制放进某个 `OneTHU.app/Contents/MacOS/` 并**改名为与 `CFBundleExecutable` 同名**（否则 `NSBundle` 无法识别包并报 not-bundled），运行即打印授权/排程/回读/撤销四步结果 |
| Windows 通知模块编译检查 | `cd tools/win-notify-check && cargo check --target x86_64-pc-windows-msvc` |
| Android 目标交叉检查 | `cd apps/desktop/src-tauri` 后设 `CC_aarch64_linux_android` / `AR_aarch64_linux_android` / `CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER` 指 NDK 的 `aarch64-linux-android24-clang`，再 `cargo check --target aarch64-linux-android`（桌面 `cargo check` 不编译 `#[cfg(mobile)]` 分支，这是唯一能提前发现 Android 侧编译错误的手段） |
| Rust 单测（通知载荷解析等） | `cd apps/desktop/src-tauri && cargo test --lib` |
| 市场名单解析测试 | `node --import ./tools/ts-resolve-register.mjs tools/market-parse-test.mjs` |

分支约定：开发在 `dev2` 分支，发布时推送至 `dev3`（GitHub 与清华 Git 两个远端）。
