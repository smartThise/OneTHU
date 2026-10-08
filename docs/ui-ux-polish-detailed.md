# OneTHU UI/UX 打磨 · 执行细则

> 细化自 `docs/ui-ux-polish-plan.md`（霖，2026-09-29）。编号沿用原计划的 A1–F3，便于两处对照。
> 本文档是给执行 agent 的施工图：每条给出 **改动面 / 实现要点 / 护栏 / DoD / 反例** 五项。

## 0. 交接上下文（先读这一章）

### 0.1 仓库与分支
- 仓库根 `<仓库根>`（WSL/ArchLinux），pnpm monorepo；桌面端 `apps/desktop`：React 手写组件、**零 UI 组件库**、Tauri v2。
- 构建目标只有两个：`x86_64-pc-windows-msvc`（exe）与 Android arm64（APK）。没有 Mac/iOS。
- 全部改动落**当前分支**，**不合并、不推送**。基线提交 `9a9202f`。
- 路由是 hash 路由，现状**没有任何历史栈**（全仓 0 处 `pushState/popstate/history.back`）——E1 要新建。

### 0.2 每条改动都必须过的命令
- `pnpm guard`：门禁 **46 项**（M1 期间新增 pointer-hover / token-leak / mobile-chrome / page-title 四个护栏；M2 新增 haptics 与 context-menu 两个护栏）。**只拦新增违规**，存量按基线递减；被拦就修，不许改基线放行。
- `pnpm typecheck`、`pnpm test`：0 错、全绿。
- `pnpm lint:ui-copy`：用户可见文案的禁用语与长度（>42 字符会被拦），豁免写法 `// ui-copy-lint-ok: 原因`。
- 构建：exe 用 `bash <工具目录>/build-desktop-dev.sh`；APK 命令见 0.4。**两者绝不并发**，构建期间不改源码。

### 0.3 产物、设备与正式版边界
- 产物目录 `<分发目录>/`：`onethu-dev.exe`（固定名被占用时回落到 `onethu-dev-<HHMM>.exe`）、`onethu-android-arm64-dev.apk`。
- 设备：`<adb> -P 5137`，串号 `<设备>`，视口 400×805，导航栏顶 743。
- dev 包名 `app.onethu.desktop.dev`，允许覆盖安装；**正式版 `app.onethu.desktop` 与 `<分发目录>/` 的正式产物一律不碰**。
- DOM 探针用 `/tmp/probe.mjs`（CDP 包装）。**不要在 await 的探针里执行 `location.reload()`**——会打断 CDP 连接；要重载就单独发一次调用。
- `read_image` **可用**（2026-09-29 修好了 DSH 的注入 bug）。验收证据 = **DOM 数字 + 截图视觉**：数字做精确断言，截图判「好不好看」那类只能眼睛定的事（亮/暗、对比度、动效相位、断点破版）。

### 0.4 APK 构建命令（照抄）
```bash
export PATH="$HOME/.cargo/bin:$PATH"
JAVA_HOME=<工具目录>/jdk17 ANDROID_HOME=<工具目录>/android-sdk \
NDK_HOME=<工具目录>/android-sdk/ndk/27.2.12479018 \
ONETHU_APK_OUT=/tmp/onethu-dev-out ONETHU_DEV_KEYSTORE=<工具目录>/onethu-android-dev.keystore \
ONETHU_DEV_KEYSTORE_PASS=onethudev2026 pnpm --filter @onethu/desktop android:dev
```

### 0.5 目录地图与关键单点
| 位置 | 作用（改之前先读它） |
| --- | --- |
| `state/navigation.ts` | `NAV_REGISTRY` 40 条；`visibility = core/group/buried/advanced`；`matchNavQuery`；`byVisibility`/`byCategory` |
| `state/settingsMode.ts` | `SETTINGS_TAB_ORDER`（设置页签唯一来源）、`ADVANCED_SETTINGS_TABS` |
| `state/theme.ts` | **令牌层就在这里**（生成 `:root[data-theme=…]`）；双通道 `data-theme` 手动 / `data-scheme` 跟随系统；`theme.logoSvg` 主题接口 |
| `styles/global.css` | 约 6900 行，绝大部分页面样式 |
| `styles/motion.css` | 动效令牌（MD3 曲线、时长）与入场动画 |
| `components/Layout.tsx` | `NAV`（PC 侧栏手写 14 项）、`BOTTOM_NAV`（底栏 5 项 + `activePages`）、`BottomNav`、`HardRefreshButton`、`CommandPalette` 挂载 |
| `components/Ripple.tsx` | 涟漪反馈（按压反馈的既有实现，照它写新反馈） |
| `state/searchAll.ts` | 唯一搜索组合层（注册表 + 原子 + 设置页签），服务页与命令面板共用 |
| `state/hwIgnore.ts`、`state/hwRemind.ts`、`state/favs.tsx` | 忽略 / 提醒 / 收藏的既有数据层（A3 只调用，不重写） |
| `state/exthw.ts`、`lib/transport.ts`、`lib/clients.ts` | 外部站点请求与会话（F3 在这里收口） |
| `state/homeCards.ts` + `pages/Today.tsx` | 今日页卡片清单与顺序（E4 时段推荐） |
| `state/scheduleWindow.ts` | 时间轴时段窗口 `from/to` 分钟 + presets（C9 会用到） |
| `pages/TasksPage.tsx` | 待办页：作业卡片流 + 卡面动作排（收藏/提醒/忽略，353 行起）（C8、D7 在这里） |
| `pages/Schedule.tsx`、`pages/ScheduleAgenda.tsx` | 日程时间轴与列表（C9） |
| `pages/info/ThosPage.tsx` | 在线服务（B6 暗色对比度、C3 换行、A3 固定） |
| `pages/OtherInfoPage.tsx`、`pages/Plugins.tsx` | 更多 info 应用 / 插件（B3、B4 的风格割裂） |
| `pages/Settings.tsx` | 设置（E3 我的页改造的样板） |
| `tools/*-test.mjs` | 既有护栏，全是**源码级断言**；新护栏照这个风格写 |

### 0.6 红线（违反即回滚）
1. **不引入任何 UI/动画库**，不新增运行时依赖；FLIP、弹簧、圆角展开一律手写。
2. **收藏的数据与行为不动**（只搬入口）。
3. **不做功能减法**：只有霖明确要求「搬进二级菜单」的入口可以移位置，功能本身必须还在。
4. `src-tauri/gen/android` 是**符号链接**（指向 `<安卓工程目录>`）。不许提交它；要改 Android 清单只能由**构建期脚本**解析链接后改（C10）。
5. 不提交 `.tmp-shots/`、`docs/外部作业源-需求与实现方案.md`、`packages/core/src/exthw/yuketang.ts`、`tools/exthw-status-test.mjs`、`tools/ykt-exercise-detail-test.mjs`。
6. 不 push、不合并、不碰 `.onethu-creds.env`。
7. 样式只能用**已定义**的令牌（`--border` / `--border-soft` / `--border-strong` / `--text-1..3` / `--surface-*` / `--md-sys-*`）。引用未定义变量会被门禁令牌守卫拦下。
8. 间距走 4pt 网格、字号走既有阶梯；门禁 style 扫描**只拦新增**，新增违规必须清零，不许往基线里塞。

### 0.7 批次口径（霖已定）
- **M 批（本轮，本文档 §2–§7）**：移动端 + 两端共用的改动。
- **P 批（另开，见 §8）**：PC 专属——侧栏结构与动画、Ctrl+K 动画、logo 视觉、PC 收藏夹高度、侧栏滚轮 bug。
- 每批收尾：门禁 + 真机（+ PC 若有）走查 + 提交 + 出 dev 包 + 回填计划表勾选。

## 1. 通用验收口径（每条都适用）

### 1.1 通用 DoD
1. 门禁 46 项全绿（每加一个护栏项数就 +1，以 `pnpm guard` 实跑为准），`typecheck` 与 `test` 干净。
2. 真机实测：给出**数字证据**（矩形、计算样式、元素命中、滚动位置）**并附关键截图**；视觉类条目以截图为准，几何/状态类以数字为准。不接受「看起来好了」。
3. 该条的护栏文件已新增，且**能量化**（如「`:hover` 全部在 `media (hover: hover)` 内」）。
4. 计划表对应条目回填：勾选 + 一句实测结论。

### 1.2 通用反例（「假完成」长什么样）
- 只改了截图里看得见的那一处，同类问题在别的页面依旧存在；
- 用内联样式或魔法值绕过令牌与 4pt 网格；
- 把动画写成 `transition: all`，或动画 `width/height/top/left`（既有全站唯一例外是 `.dock-budget-bar` 进度条）；
- 新增入口但忘了给 `activePages` 挂归属，底栏出现「没有一项被选中」；
- 在 `prefers-reduced-motion` 下动画仍然播放；
- 触摸端仍然留下悬停态；
- 只写「已实现」却没给数字证据与截图。

### 1.3 省事三件套
- 改动前先 `grep` 同类问题的**全部**出现次数（例如 `:hover` 83 处），改完再 `grep` 一次对比；
- 新护栏写进 `tools/`，并在 `package.json` 的 guard 链上登记；
- 真机验证固定流程：装包 → `adb shell am start` → CDP 探针量数字 → 记进计划表。

## 2. M 批 · 手感

### A1 `:hover` 只作用于有指针的设备
- **现状证据**：`styles/global.css` 有 83 处 `:hover`，0 处 `media (hover: hover)` → 手机上点一下会留下悬停态，看起来像卡住。
- **改动面**：`apps/desktop/src/styles/global.css`（全部悬停规则）。
- **实现要点**：把悬停规则整体包进 `media (hover: hover) and (pointer: fine)`；不要用 UA 嗅探或 JS 加类。`.is-active`/`.is-current` 这类状态类不是悬停，不要误伤。
- **护栏**：新增 `tools/pointer-hover-test.mjs`——断言文件里 `:hover` 的出现次数等于处在 hover 媒体块内的次数（真需要例外时写 `/* pointer-hover-ok: 原因 */` 并在断言里登记）；登记进 `package.json` 的 guard 链。
- **DoD**：真机上点任意列表行与卡片，松手后 `getComputedStyle` 不残留悬停态（探针对比点击前后）；PC 悬停仍生效。
- **反例**：只改「看得见的那几处」；用 `media (any-hover: hover)` 蒙混（触屏笔记本会误判成有指针）。
- **落地（2026-09-29）**：91 处 `:hover`（`global.css` 83、`motion.css` 4、`base.css` 1、内联样式 3：MailPage iframe 滚动条 2 + Thubook 正文 1）全部包进 `@media (hover: hover) and (pointer: fine)`；规则原位包裹，相对顺序不变。3 条混合规则拆出非悬停分支（`.chip-btn::after`、`.wb-kind.is-active`、Quill 工具条 `button:focus`）。护栏 `tools/pointer-hover-test.mjs` 已登记进 guard 链：91 处 / 76 个媒体块 / 5 个文件，不出现 any-hover 与 pointer: coarse。数字证据：改造前后「选择器 + 声明」集合 1596 条逐条一致；真机（<设备>，400×805，dpr 3）原生触屏下 `matchMedia('(hover: hover) and (pointer: fine)')` = false，强制 `:hover` 后 `.row` 的 computed background 不变（旧包同一探针会变成 `rgba(226, 226, 233, 0.06)`）；PC 侧 Edge 154 加载真实样式表，指针态下 `.row` / `.home-card-head` / `.icon-btn` / `.course-card` 悬停均改变计算样式，触屏模拟态下 4 个目标 0 变化。`adb shell input tap`（tap / touchscreen tap / 同点 swipe / 微移 swipe / motionevent）在旧包与新包上均不残留悬停态。
- **边界（同日实测发现）**：打包进来的第三方样式表仍有 11 条未收敛的悬停规则——Quill 富文本工具条 8 条（其中一条在 `@media (pointer: coarse)` 内）、Leaflet 地图控件 3 条；它们在 `node_modules` 里，不在源码扫描范围内，触屏上仍可能残留悬停态。
- **处置（2026-10-01 霖定）**：**不动**。理由：这 11 条在第三方包内，改 `node_modules` 每次装依赖都会被覆盖，应用层再包一层覆盖收益也低；只在文档记一笔，不做源码改动。护栏口径不变（只扫源码，第三方样式不计入）。

### A2 振动反馈
- **现状证据**：已经有原生通路——`pages/TasksPage.tsx` 111–148 行调用 Tauri 命令 `ui_haptic_tick`，Rust 侧在 `src-tauri/src/lib.rs` 2876 行起（Android 12+ 用系统 `EFFECT_TICK`），前端 `navigator.vibrate(4)` 兜底，降级路径只记一次日志。
- **已定口径**：允许扩展 Rust；**不单设开关**（跟随系统）；PC 端静默跳过。
- **改动面**：`src-tauri/src/lib.rs`（命令加效果参数 + invoke_handler 登记）、新建 `apps/desktop/src/lib/haptics.ts`（前端唯一入口）、调用点：`components/Layout.tsx`（底栏点击/切 tab）、开关控件、`.btn` 系列、`components/ContextMenu.tsx`（A3 长按触发）。
- **实现要点**：
  - 效果矩阵（**混合口径**，霖 2026-09-30 拍板）：底栏与 tab 切换 → 预烘焙 `EFFECT_CLICK`（那里要的正是「与系统点击同源」）；其余四种走**自绘分档波形**——轻量按钮 18ms@0.59（脆）、长按 35ms@1.00、开关 60ms@1.00（最实）、操作被拒绝 16ms@0.86 + 隔 60ms + 24ms@1.00（双脉冲）。
  - **为什么不全用 prebaked**：本机（小米 25102RKBEC / MIUI，Android 15）的 HAL 把 `EFFECT_TICK` / `EFFECT_CLICK` / `EFFECT_HEAVY_CLICK` 全标定成同一条 `Prebaked=CLICK(MEDIUM, with fallback)` ≈ 61~63ms，官方 `View.performHapticFeedback(LONG_PRESS/REJECT)` 也落回同一条 → 「开关要实、轻量按钮要脆」会全塌成一个手感，DoD 的「强弱可区分」不可能达成。自绘波形实测原样落地（dumpsys 里 Step 包络时长/幅度分毫不差），且走 `USAGE_TOUCH` 仍跟随系统「触感反馈」开关与强度设置。
  - 坑：`VibrationEffect.EFFECT_LONG_PRESS` / `EFFECT_REJECT` **不是公开常量**（compileSdk 36 也解析不到），照文档想当然写会直接编译失败。
  - **与动画呼应**：底栏胶囊是弹性动画，所以触感要「弹」——用短促的 CLICK 而不是拖长的效果；开关要「实」，用 HEAVY_CLICK。
  - 降级链：Android 12+ prebaked → 旧版 `Vibrator.vibrate` 短脉冲 → `navigator.vibrate`；桌面端直接 return 且不打日志。
  - 调用一律 try/catch 静默失败，不阻塞主线程；同一控件 60ms 内只触发一次（防连点风暴）。
- **护栏**：新增 `tools/haptics-test.mjs`——断言 ①只有一个 `lib/haptics.ts` 入口、②效果名在白名单内、③PC 分支提前 return、④存在 60ms 节流、⑤底栏/tab/开关/按钮/长按五个调用点齐全。
- **DoD**：真机上逐个点：底栏项、tab、开关、普通按钮、长按菜单 → 都有振动且强弱可区分；用 adb logcat（`Vibrator`）或 Rust 侧日志给出数字证据。
- **反例**：只给底栏加；所有场景统一 `vibrate(50)` 一把梭（没有区分度）；PC 上刷日志。
- **落地（2026-09-30）**：前端唯一入口 `apps/desktop/src/lib/haptics.ts`（`HapticEffect` 白名单 tick/click/heavy/longPress/reject + 强度表 + 60ms 节流 + `isMobileShell()` 前置 return + `navigator.vibrate` 兜底），Rust `ui_haptic_tick` 透传 `effect`（PC 分支直接 `{"ok":false,"reason":"not-android"}` 且不打日志），Kotlin 插件 `hapticTick` 按混合口径分档（`shapedOnly` 集合跳过预烘焙，`predefinedId` 只服务 click）。护栏 `tools/haptics-test.mjs` 已进 guard 链（先遮蔽注释再断言：唯一入口、效果名与 Kotlin 分支两侧一致、PC 静默、60ms 节流、五个调用点、分档波形值、Kotlin 降级链 prebaked→legacy→waveform）；`pnpm guard` 44 → **45 步**（`&&` 段 43 → 44；此处与下文按 `pnpm guard` 实跑输出的通过行数计）。
  **设备数字**（<设备>，dev 包，`adb shell dumpsys vibrator_manager` 每条按时间戳取最新，字段为「duration / usage / played」）：
  - tick `36ms / TOUCH / [0ms@0.00, 18ms@0.59]`
  - click `64ms / TOUCH / Prebaked=CLICK(MEDIUM, with fallback)`（唯一保留预烘焙的档）
  - heavy `72ms / TOUCH / [0ms@0.00, 60ms@1.00]`
  - longPress `51ms / TOUCH / [0ms@0.00, 35ms@1.00]`
  - reject `115ms / TOUCH / [0ms@0.00, 16ms@0.86, 60ms@0.00, 24ms@1.00]`（双脉冲）
  五档时长与幅度两两不同 → DoD「强弱可区分」在真机成立。
  **五个调用点真手指点（`input tap`，物理=(clientY+48)×3）**：底栏项 → 预烘焙 CLICK 63ms；tab 切换 → 预烘焙 CLICK 62ms；开关（提醒总开关，`aria-checked false→true`，即确认真被点中）→ 分档 60ms@1.00；普通按钮「刷新」→ 分档 18ms@0.59；作业流在卡片流上滑切卡 → 分档 18ms@0.59。**60ms 节流**：同一控件同一 JS tick 内连点 3 次 → 记录只新增 1 条。长按/拒绝两档目前只有直调证据，真实调用点等 A3（长按接线 `haptic("longPress")`）与拒绝场景。
  **两条方法论教训（都白费了构建，记下来别再踩）**：①`dumpsys vibrator_manager` 的 **Recent vibrations 是按 usage 分组打印的，行序 ≠ 时间序**；按行序取「最后一条」会把五种效果全读成同一条 prebaked CLICK，从而误判「ROM 把自绘波形换掉了」并去改实现。必须按时间戳取最大（本次五种效果的判定全靠这个）。②真机点测试前要先确认**没有全屏弹层**：`.btn` 里的「导览」按钮会打开新手导览（`#root` 下 `position:fixed; z-index:2000` 的 scrim），之后所有真实点击都只落在遮罩上，表现为「按钮点了没反应、滑动也不滚动」——本轮 ③ 开关两次误判都是它。
  **A2 返工（2026-09-30，霖 #5「还是犯了刚开始做振动时的老毛病：自定义振动只是『震』，完全无法模拟触感；只有系统 prebake 的振动效果能做到模仿触感」）**：效果口径由「混合」改为**五档全部走系统预定义效果**。真机取证（<设备> / Android 16 / HyperOS 3 / compileSdk 36）：
  - `/vendor/etc/Hapticsconfig.xml`（Qualcomm 标定）里的预定义效果只有 6 个：**0 CLICK（35ms 脉冲、锐度 80）、1 DOUBLE CLICK（10/25/35ms PWL 包络）、2 TICK、3 THUD、4 POP、5 HEAVY CLICK**；`/vendor/etc/acdbdata/haptics_data/` 下对应有 `click.pcm`、`double_click.pcm`、`heavy_click.pcm`、`pop.pcm`、`texture_tick.pcm`、`thud.pcm`、`tick.pcm` **真波形采样**——自绘 `createWaveform` 只是方波脉冲，物理上不可能模仿触感，这就是「只是震」的根因。
  - `/vendor/etc/HapticsPolicy.xml`：`hapticsPerformAPI` 放行 `effect_id = 0,1,2,3,4,5`，`hapticsComposeAPI` 为空。探针回读能力表 `supportedPrimitives = []`；实测 `startComposition` 送两个原语后被系统标记 `ignored_unsupported`（组合原语这条路走不通）。
  - 新映射：`tick→2 TICK`、`click→0 CLICK`、`heavy→5 HEAVY_CLICK`、`longPress→3 THUD`、`reject→1 DOUBLE_CLICK`。`EFFECT_THUD`、`EFFECT_POP`、`EFFECT_LONG_PRESS`、`EFFECT_REJECT` **都不是公开常量**（compileSdk 36 也解析不到），只能写 id 字面量。
  - **推翻 A2 旧结论**：A2 曾据 `dumpsys` 记录断言「本机 MIUI 把 TICK/CLICK/HEAVY_CLICK 全标定成同一个 `Prebaked=CLICK(MEDIUM)`」——那是把记录里的**描述串当成了效果身份**。逐 id 打过之后，记录里 `played` 字段明确区分 `Prebaked=TICK / CLICK / HEAVY_CLICK / THUD / DOUBLE_CLICK`，`duration` 也各不相同。
  - **探针**：新增 `ui_haptic_probe`（Kotlin `hapticProbe` + Rust 命令 + `lib/haptics.ts` 的 `hapticProbe`），只做诊断，正式路径一次都不调（护栏断言全仓无第二处调用）。
  **设备数字**（<设备>，`dumpsys vibrator_manager` 按时间戳取最新；`mode` 是命令回传的实际路径）：tick `75ms / Prebaked=TICK`、click `63ms / Prebaked=CLICK`、heavy `58ms / Prebaked=HEAVY_CLICK`、longPress `63ms / Prebaked=THUD`、reject `68ms / Prebaked=DOUBLE_CLICK`，五档 `mode` 全为 `prebaked`（无一落到自绘波形）。手感待霖真手指复核（我按 tick→click→heavy→longPress→reject 顺序放过一轮）。
  **试听定档（同日，霖 A/B 试听后定稿）**：`tick→2 TICK`、`click→0 CLICK`、`heavy→4 POP`、`longPress→167`、`reject→186`；后三个不在 AOSP 六表里（167/186 超出 AOSP 范围），是厂商标定波形。找 167 的路径：打开系统「设置 → 触感演示」，用 `dumpsys vibrator_manager` 抓 `com.android.settings` 的长时长记录，得到同一族 `159=639ms / 171=499ms / 167=191ms / 169=120ms`（本应用回放 167 实测 **189ms**，与演示页 191ms 吻合）。**但没能把「趣味拟物·右下角」与具体 id 一一对应**：Settings 每次被 `input tap` 点到都会先发一条 40–80ms 的自身触摸反馈，把演示效果淹掉并错位。于是做成「按 id 对照试听」面板让霖用耳朵定，最终选 `167`（长按要的「弹」）与 `186`（拒绝）。另加一跳兜底：厂商 id 不被该 ROM 支持时退到 AOSP 标定 id（Kotlin `aospId`），两个都不行才自绘波形，护栏断言这个顺序。
  **强弱微调待办（2026-09-30 收工，明天继续）**：霖复核「手感都对了，只是强弱需要微调：TICK 稍强、CLICK 与 LONGPRESS 稍弱」。**公开 SDK 做不到逐档调振幅**：`VibrationEffect.Composition.addEffect(effect, scale)` 在 compileSdk 36 里不存在（实测编译报 `Unresolved reference: addEffect`），`VibrationAttributes.USAGE_ASSISTANCE_SONIFICATION` 也不存在，而 `createPredefined(id)` 自身不带振幅 → 只剩两条杠杆：**换 id**（同族里更强/更弱的波形）与**换 usage**（`touch` ↔ `hardware`，系统演示页走的就是 hardware）。探针已加 `usage` 参数（`hapticProbe({kind:"prebaked", id, usage})`，只诊断、生产不调用，护栏断言三端贯通）。
  **强弱微调定稿（2026-10-01）**：霖听三组候选后定为 `tick → 3 THUD`（要更强）、`click → 4 POP`（要稍弱）、`longPress → 167` 不变。客观依据取自厂商自己的 PCM（`/vendor/etc/acdbdata/haptics_data/`）：`tick.pcm` RMS 11831 < `thud.pcm` 12001 < `pop.pcm` 12894 < `click.pcm` 14251 < `heavy_click.pcm` 14343，`texture_tick.pcm` 9164 最轻；`/vendor/etc/Hapticsconfig.xml` 里六档预定义的强度参数完全相同（仅 CLICK 的 mid 为 65），所以强弱差异只体现在 PCM 本身。**click 与 heavy 现同为 POP(4)**：这是霖的选择，若要拆开需另定一档。自绘兜底波形同步调正为 `tick 20ms@190 > click 18ms@150`，避免兜底路径下强弱反转。
  **验收（2026-10-01）**：霖在真机听完最终面板两组（① 新五档顺序 / ② 变化前后对照）后确认「① ② 都行，收尾」——**包含 click 与 heavy 同为 POP(4) 的重叠在内**。面板截图 `.tmp-shots/r-strength-panel.png`（do-not-commit）。设备侧只以「安装包 md5 `c79a00b5` == 构建包」作为「手机跑的是新映射」的证据，振动历史回读不作为证据（见 §11 第 22 条）。

### A3 长按菜单（对应 PC 右键）
- **现状证据**：全仓 0 处 `contextmenu` 处理；移动端也没有长按菜单。
- **已定口径**：菜单项矩阵**就按霖那版**；全站禁浏览器右键，但**可选文本区域保留原生菜单**（否则没法复制公告/通知文字）；PC 右键绑定放到 P 批。
- **矩阵**：作业卡片 = 忽略 / 提醒 / 收藏；在线服务 = 固定 / 收藏；课程与页面 = 收藏；文件 = 下载 / 在文件夹中显示。
- **改动面**：新建 `components/ContextMenu.tsx`、`styles/global.css` 追加样式、`components/Layout.tsx` 挂全局 `contextmenu` 拦截、调用点 `pages/TasksPage.tsx`、`pages/info/ThosPage.tsx`、收藏夹/课程/页面项、文件项。
- **实现要点**：
  - 长按判定：`touchstart` 起 500ms 计时；`touchmove` 位移超过 10px 即取消（避免和滚动/滑动打架）；`touchend` 清理定时器。
  - 触发瞬间先振动（走 A2 的 `EFFECT_LONG_PRESS`）。
  - 定位：以手指按点为锚，四边夹紧不出屏；沿用 `SearchSelect`/`CommandPalette` 的「portal 到 body + fixed + getBoundingClientRect + 翻转」套路，避免被滚动容器裁掉。
  - 菜单项只调用**既有数据层**（`state/hwIgnore.ts`、`state/hwRemind.ts`、`state/favs.tsx`），不新写存储、不改数据语义。
  - 全局拦截：`contextmenu` 事件 `preventDefault()`；但若 `window.getSelection()?.toString()` 非空且命中可选文本容器 → 放行原生菜单。
  - 键盘可达：Esc 关闭、↑↓ 移动、Enter 触发（为 P 批的右键复用）。
- **护栏**：新增 `tools/context-menu-test.mjs`——①矩阵四类齐全、②调用既有 store 且不新增 localStorage key、③长按 500ms 与 10px 位移取消、④四边夹紧、⑤文本选区放行、⑥Esc/方向键、⑦触发时调 haptics。
- **DoD**：真机长按作业卡片 → 出菜单 → 选「忽略」后该作业从流里消失；长按在线服务 → 能固定；选中公告文字长按仍能复制；长按后不误触发卡片跳转。
- **反例**：长按与列表滚动互相打架（一滑就弹菜单）；菜单被屏幕边缘裁掉；为了「收藏」又写一份新存储。
- **落地（2026-09-30）**：新建 `components/ContextMenu.tsx`（菜单层 + 长按判定 + 键盘可达 + 点击抑制）与 `styles/global.css` 的 `.ctx-*` 样式；`components/Layout.tsx` 挂 `ContextMenuLayer` 与全局 `contextmenu` 拦截；调用点 = `pages/TasksPage.tsx`（作业卡片）、`pages/info/ThosPage.tsx`（在线服务行）、`pages/Learn.tsx`（课程卡片）、`pages/FolderPage.tsx`（收藏项长卡与方卡）、`pages/learn/shared.tsx`（文件行）。长按判定只有一份实现：按住 `LONG_PRESS_MS = 500` 起计时，`touchmove` 位移超过 `LONG_PRESS_MOVE = 10px` 即取消，`touchend`/`touchcancel` 清理；列表容器用事件委托（`useLongPressZone`，卡上的 `data-*` 回查数据），列表项本身是组件时用 `useLongPress`。菜单 portal 到 body + `position: fixed`，以按点为锚先用 `getBoundingClientRect` 量尺寸，再把左右与上下各自夹进视口（边距 8px），因此不会被滚动容器或屏幕边缘裁掉。触发瞬间走 `haptic("longPress")`（唯一入口仍是 `lib/haptics.ts`）。
  **长按后不误触发跳转**：长按抬手后浏览器仍会补一次 click（按住不动通常仍判定为点按），所以抑制必须挂 **document 捕获阶段**——React 把事件委托挂在根容器上，挂在目标元素上的监听器晚于它，那时 `stopPropagation` 已经来不及；并且只拦落在长按那个元素内部的 click，菜单挂在 body 上、不在它内部，菜单项照常可点；浏览器若因手势被接管而没有补 click，1s 后自行撤销。
  **只调既有数据层（本轮未新增 localStorage key）**：忽略 = `ignoreHw` + `CONFIRM_IGNORE_HW`/`confirmDanger`（与卡片动作钮共用同一个函数，确认文案不再有第二份）；提醒 = 已导出的 `HwRemindPop` + `setHwReminder`（菜单内把它由绝对定位浮层改为流内布局，去掉自身边框与投影；面板按订阅取当前值，所以「清除」后高亮档位与清除按钮同步变化，不是打开菜单那一刻的快照）；收藏 = `CollectModal`，与卡片星标同一条通路（收进任意收藏夹）；在线服务固定 = 本页既有的常用列表 `favorite()`；文件下载 = `downloadLearnFile`，定位 = `download_directory_get` + `revealLocalPath`。菜单组件内不含任何存储调用。
  **两处平台差异**：①「在文件夹中显示」只在非 Android 出现——那一端下载落在应用私有目录、系统文件管理器没有定位语义，与 `DownloadOpenButtons` 同一口径；②Rust 侧在响应头给出文件名时以真名为准，所以该动作优先用本次会话真实落盘路径，没有才按「下载目录 + 前端文件名」推算，两次都不命中时提示先下载。
  **文本放行**：全局 `contextmenu` 一律 `preventDefault()`，唯一放行口是 `hasTextSelection()`——选区非空且锚点的计算样式 `user-select` 不为 `none`；用计算样式而不是写死容器类名，将来新增可选文本容器自动跟随。键盘可达：Esc 关闭、↑↓ 移动、Enter 触发，面板态（提醒档位）在面板内元素间移动焦点（为 P 批右键复用）。
  **护栏**：新增 `tools/context-menu-test.mjs`，已登记 guard 链并紧跟 `tools/haptics-test.mjs`，断言施工图 A3 的七条并补一条（①矩阵四类齐全 ②调用既有 store 且菜单内无存储 API 与存储键名 ③500ms 与 10px 位移取消 ④portal + fixed + 四边夹紧 ⑤文本选区放行 ⑥Esc/↑↓/Enter 与 menu/menuitem 语义 ⑦`haptic("longPress")` 且不绕过 `lib/haptics.ts` ⑧长按后的 click 抑制挂在捕获阶段、且按「落点是否在长按元素内」判定）。guard 链 45 → **46** 步（`&&` 段 44 → 45）。
  **真机数字**（<设备>，dev 包；`input swipe x y x y 700` 即长按，坐标映射见 §11.13）：
  - **作业卡片全链路**：长按前台卡「实践与思考题03【不计分】」（id `26ef84e7…664cc`）→ 同一时刻新增一条触感 `89ms / TOUCH / [0ms@0.00, 35ms@1.00]`（正是 A2 的 longPress 档）→ 菜单 `rect [206,323,387,492]`、标题为作业名、项 =「忽略 / 提醒 / 收藏」→ 点「忽略」→ 确认弹层（`⚠️` / 取消 / 确认忽略）→ 点「确认忽略」→ 该 id 从流内 `[…664cc, …36d70, …70aed]` 变为 `[…36d70, ext:tuoj-8-87, …70aed]`（被忽略的已移出，外部源作业补位）。
  - **提醒面板**：菜单点「提醒」→ `.ctx-panel` 内出现 `.hwremind-pop`，档位按钮 11 个（10 分钟 / 30 分钟 / 1 小时 / 2 小时 / 6 小时 / 12 小时 / 1 天 / 2 天 / 3 天 / 7 天 / 设定）→ 点「10 分钟」→ 菜单关闭。
  - **不误触发跳转 / 滑动取消**：长按抬手后 `location.hash` 仍为 `#/tasks`（未跳详情页）；在卡片上竖向拖动 60px → 菜单未出现。
  - **四边夹紧**：在卡片四角长按（按点 58,245 / 353,245 / 58,401 / 353,401），菜单 rect 依次为 `[58,245,206,414]`、`[250,245,398,414]`、`[58,401,206,570]`、`[250,401,398,570]`，四边都在视口内；压屏幕下沿时按点 y=693 → 菜单上沿被夹到 676（下沿 802 < 805），未被裁掉。
  - **在线服务固定**：长按 `.thos-service-card`「缓考申请教务处表单」→ 菜单「取消固定 / 收藏」→ 点「取消固定」→ 再次长按菜单变成「固定」（状态真翻转）。
  - **文本选区放行**：在今日页选中一段文字（20 字）后长按 → 自定义菜单未出现、`getSelection()` 选区保持（原生复制菜单可用）。
  - **键盘可达**：菜单初始无高亮 → ↑↓ 逐格移动高亮（忽略 ↔ 提醒）、Enter 在「提醒」上展开档位面板、Esc 关闭菜单（捕获阶段阻断，不连带关掉页面自己的浮层）。
  - **本轮未验**：课程卡 / 收藏夹长卡与方卡 / 文件行三处宿主的真机长按（源码与护栏已覆盖，等走查这三页时一并确认）；「在文件夹中显示」只在桌面端出现，移动端未验。
  **A3/D9 返工（2026-09-30，霖 #3「右键菜单的动画完全不合格：没有面板的展开动画」+ #4「上下文菜单在大多数场景中无法触发，只有作业卡片可以」）**：
  - **#3 面板生长**（照 liquid_glass_widgets 的 Liquid Morph Engine 三条轨迹，不用它的着色器）：面板不再原地缩放了事，而是**从按点上一个 48px 正圆液团长成面板**——位移走 back-out J 曲线（amplitude 2.5，峰值过冲 18.9%）、尺寸走 easeOut、圆角从「面板半宽」（液团在角上仍是正圆）按 easeInExpo 收拢到 `--r-md`；520ms `linear`（曲线烘进 8 个关键帧），选项自行程 25%（+130ms）起按 36ms 步进 `scale(0.7)→1` 浮现；背景改毛玻璃（`backdrop-filter: blur(18px) saturate(1.6)` + 74% 透明容器色）。全程仍只动 `transform/opacity/clip-path`。
  - **#4 覆盖面**：新增**全局 `data-ctx-atom` 长按面**（挂在 `ContextMenuLayer`：任何元素加一个属性就有「收藏」菜单，复用同一个 `CollectModal`），并给 `useLongPressZone` 的容器打 `data-ctx-zone` 让全局层让路（长按判定仍只有 `createLongPress` 一份实现）。补齐宿主：今日页卡片（卡片自身操作）、待办页汇总卡与通知条（收藏「全部作业」「全部通知」页面原子）、作业列表行 `HomeworkRow`（忽略/提醒/收藏）。
  **真机数字**（<设备>）：
  - 生长：按点 (206,337) → 起始帧 **48×48 圆团 @(182,313)**（按点减半径 24）→ 稳定 **148×169 @(206,337)**；越过目标后回弹过冲 **4.0px**（≈18.1% × 24px 位移）；圆角 `inset(0 round 74px)` 收敛到 12px；选项延迟 `[0.13s, 0.166s, 0.202s]`；毛玻璃计算样式 `blur(18px) saturate(1.6)`。相位截图用 WAAPI `currentTime` 定格（`.tmp-shots/r-menu-early/mid/over/settled*.png`）。
  - 覆盖（逐处真机长按，括号内为菜单项）：今日页卡片 `收起/上移/下移/隐藏此卡片`、待办汇总卡 `收藏`（标题「全部作业」）、待办通知条 `收藏`（「全部通知」）、待办作业卡 `忽略/提醒/收藏`、**作业列表行 `忽略/提醒/收藏`**、课程卡 `收藏`、在线服务卡 `固定/收藏` —— 七处全部出菜单。
  - **未验**：收藏夹条目与课程文件行——本机收藏夹（`f_muj42rtm_5`）为空、课程「迈向通用的人工智能」文件页签 0 个文件，且 `CollectModal` 只提供「新建收藏夹」（不擅自改霖的收藏数据），故这两处只有源码级与护栏覆盖。

### 按压口径的显式例外（第 51 条；霖 2026-10-05 裁定）

- **口径**：整行 / 整卡按下去只压暗底色，**绝不改尺寸**（`transform` 不参与 `:active` 反馈）。
- **唯一例外**：`.svc-row:active` 与 `.task-row:active` **保留** `transform: scale(0.99)`。
  - 裁定理由：这两类行的点击目标就是整行、且没有别的按压反馈可用；0.99 的位移在真机手感上被判定为「可接受且有帮助」。
  - **新增行 / 卡不得引用本例外**：护栏 `tools/mine-page-test.mjs` 已钉住 `.mine-stat:active` 只能压暗底色、不许出现 `transform`/`scale`。
  - 本条是**文档侧收口**，代码不动（§19.2 的「等霖定」至此关闭）。

## 3. M 批 · 视觉一致

### B1 写死颜色清零
- **现状证据**：组件与页面里 121 处 `#hex`（不含 `Icons.tsx`）；`global.css` 里 56 处。
- **改动面**：`src/components/*.tsx`、`src/pages/**/*.tsx`、`styles/global.css`。
- **实现要点**：全部替换为令牌（`--surface-*` / `--text-1..3` / `--md-sys-color-*` / `--accent-*`）；连 `#fff`/`#000` 也要换；内联 style 与 SVG fill 同样处理。唯一合法例外是**令牌定义处**（`state/theme.ts`）。
- **护栏**：新增 `tools/token-leak-test.mjs`——断言 tsx 中颜色字面量为 0（含 `Icons.tsx`；确需例外要写 `/* token-ok: 原因 */`）；`global.css` 的存量按基线**只减不增**。
- **DoD**：亮/暗/动态取色三档各抽 5 个页面，用探针确认 critical 元素的 background/color 都解析自令牌（取值不出现在字面量表里）。
- **反例**：把 hex 挪进另一个文件的常量里（换汤不换药）；只清 tsx 不清 CSS。

- **落地（2026-09-29）**：护栏口径实测起点 **545 处 / 39 文件**（「121 处 `#hex`」只是其中一类；把 `rgb()`/`rgba()`/`hsl()` 一并计入后是这个量级）→ **0 处**。三类处理：①**272 处** `var(--令牌, 颜色)` 死回退——令牌在 `tokens.css` / `palette.css` / `theme.ts` 里都已定义，回退永不生效（srcdoc 独立文档里的回退是活值，不在此列）；②**149 处**语义映射——阴影→`--shadow-1/2/3`、遮罩→`--md-sys-color-scrim`、彩色底白字→`--on-primary`、状态色→`--green/--amber/--red`（含 `-soft`）、灰阶→`--text-1/2/3` 与 `--surface-2/3`、地图底→`--surface-2`、`.plugin-toast` 改反色对（`--text-1` 底 + `--surface` 字）、`Courses.tsx` 的占用紫/数据色收成具名常量；③**89 行** `token-ok` 显式豁免，按理由可 grep：srcdoc 独立文档 19（`yktBody` / `ProblemBody` / `MailPage`——opaque origin，CSS 变量进不去，主题色由组件层探针 `probeColor` 注入）、DevPanel 固定终端配色 18、课程与来源身份色 11、二维码与 PDF/PPT 纸张衬底 5、Canvas 2D 与 `data:` URL SVG 4、原生桌面小组件 3、语音坞雾白 3、轮播指示点 3、玻璃卡片 2 等。护栏 `tools/token-leak-test.mjs` 同时修掉三处误报/错位：动态 `hsl(\${…})` 不再算字面量、HTML 实体 `&#160;` 不再算 hex、`stripComments` 保留换行（此前多行注释会让遮蔽文本整体错位，`token-ok` 豁免落到别的行上）。基线 `tools/token-leak-baseline.json` 545 → 0。**真机双档证据**（<设备>，400×805，dpr 3，每页抽 120 个元素比较计算色集合）：暗档令牌 accent `#C0C6DC` / on-primary `#152E60` / scrim `rgba(0,0,0,.62)` / shadow-1 `0 2px 4px rgba(0,0,0,.4)` / body `rgb(34,35,40)`，亮档 `#575E71` / `#FFFFFF` / `rgba(15,23,42,.45)` / `0 2px 4px rgba(0,0,0,.05)` / `rgb(254,254,254)`；换档后 5 个页面（今日 / 设置 / 待办 / 网络学堂 / 服务）的计算色集合都有出入（今日 5↔6、设置 6↔6 其中仅亮 5 仅暗 5、待办 11↔12、网络学堂 12↔13、服务 6↔6 其中仅亮 5 仅暗 5）→ 采样到的颜色确实随主题变，即由令牌驱动。截图：今日页与设置页暗/亮各一张（临时目录 `/tmp/m1-*.png`，不入库）。

### B2 动效曲线收敛
- **现状证据**：`motion.css` 已定义 MD3 曲线令牌；`global.css` 仍有 10 处 `cubic-bezier(0.2, 0.7, 0.3, 1)`，另有一族 `0.22, 1.15~1.35` 过冲曲线尚未登记为令牌。
- **改动面**：`styles/global.css`（散落曲线）+ `styles/motion.css`（新增令牌）。
- **实现要点**：常规转场改用 `--md-sys-motion-easing-emphasized` / `-standard`；**过冲曲线不是脏数据**——把它登记为正式令牌（如 `--ease-overshoot`）并在 `motion.css` 注明用途（卡片入场、胶囊回弹）。
- **护栏**：新增 `tools/motion-token-test.mjs`——断言非令牌文件里裸 `cubic-bezier(` 为 0 次；时长字面量按基线只减不增。
- **DoD**：抽 3 处动画，探针断言 `transition-timing-function` 取到 `var(...)`，且视觉与改前一致。
- **反例**：把所有过冲曲线换成标准曲线——那不是收敛，是**手感退化**。
- **落地（2026-10-02，提交 `a69dfd6`）**：`styles/motion.css` 新增 5 个登记令牌 + 沿用既有 MD3 原语：
  `--ease-smooth`（常规 ease-out，原散落 10 处的 `0.2,0.7,0.3,1`）、`--ease-overshoot-soft`（1.1）、
  `--ease-overshoot`（1.2）、`--ease-overshoot-strong`（1.35）、`--ease-drop`（`0.2,0.85,0.3,1.3`，
  OH 胶囊换字的下坠）。`styles/global.css` 里 **23 处裸 `cubic-bezier(` 全部替换为令牌**，替换后
  剩余 **0** 处；取值与改前逐一对应，只有两处按强度归并（`0.22,0.9,0.3,1` → `--ease-smooth`；
  `1.05` / `1.15` 分别并入 soft / 标准档）。WAAPI 用不了 `var()`，所以曲线常量收进
  `lib/motion.ts`（新增 `EASE_EMPHASIZED`，与 `--md-sys-motion-easing-emphasized` 同值），
  `TasksPage` 的 FLIP 改用它；`lib/motion.ts` 与 `motion.css` 是唯二允许出现 `cubic-bezier(` 的文件。
  护栏 `tools/motion-tokens-test.mjs` 扩展：全仓扫 CSS/TS/TSX，裸曲线只许在这两个令牌文件里；
  6 个令牌必须存在且真的被 `var()` 用到；并加一条反例断言（过冲令牌不许被换成标准曲线）。
  **真机探针（DEV b12，读 computed `transition/animation-timing-function`）**：
  `.home-card` 的入场动画 = `cubic-bezier(0.2, 0.7, 0.3, 1)`（`--ease-smooth`）、
  `.content` = `cubic-bezier(0, 0, 0, 1)` 等价的 `cubic-bezier(0.2, 0, 0, 1)`（emphasized）、
  `.dock-island` 过渡 = `cubic-bezier(0.22, 1.2, 0.36, 1)`（`--ease-overshoot`）、其动画 =
  `cubic-bezier(0.22, 1.35, 0.36, 1)`（`--ease-overshoot-strong`）、`.bottom-nav-pill` =
  `cubic-bezier(0.2, 0, 0, 1)`、`.chip` = `cubic-bezier(0.34, 1.34, 0.5, 1)`（`--ease-spring`）——
  抽查 6 处全部取到令牌解析后的曲线（DoD 要求 3 处）。

### B3 「更多 info 应用」的标签风格
- **改动面**：`pages/OtherInfoPage.tsx` + `global.css` 里 otherinfo 相关块。
- **实现要点**：标签改用项目统一的分段控件/胶囊样式（参照设置页 tab 与 `.seg-*`），颜色走令牌；不得另建一套类名。
- **护栏**：并入 B1 的令牌断言 + 断言 OtherInfoPage 不自定义 tab 容器类。
- **DoD**：真机亮/暗两档下，标签与设置页同款（探针比对 `border-radius`/`background`/`font-size` 一致）。
- **反例**：只调了几个颜色，结构仍是另一套。
- **落地（2026-10-02，提交 `a69dfd6`）**：`pages/OtherInfoPage.tsx` 的分类标签从自建的
  `.chips` + `chip-blue/chip-gray` 选中态换成全局分段控件 `SegmentedOverflow`（容器 `.segmented` +
  滑动胶囊 `.seg-pill` + `is-active`，溢出时带位置指示条），`role="tab"` / `aria-selected` 齐备。
  **真机复验（DEV b12，其他 Info 应用页）**：`.seg-ov` 存在、老 `.chips` **不存在**，
  分类按钮依次为「全部（281）(选中) / 在线服务（55）/ 学习（55）/ 科研（75）/ 人事（1）…」，
  截图 `.tmp-shots/b3-info-segmented.png`（gitignore）。护栏 `tools/segmented-consistency-test.mjs`。

### B4 「插件」页三个分区的风格
- **改动面**：`pages/Plugins.tsx`（「全部 / 主题 / 通用」）。
- **实现要点**：同上，改用统一分段控件。
- **护栏**：同上。
- **DoD**：同上。
- **反例**：同上。
- **落地（2026-10-02，提交 `a69dfd6`）**：插件页两处手写切换器（「全部/主题/通用」分区、市场
  「按热度/按名称」排序）从 `.seg-track` + `.seg-item` 换成同一个 `SegmentedOverflow`。
  **真机复验（DEV b12，设置 → 插件）**：页面里 `.seg-item` 数量 **0**、`.seg-ov` **2** 个
  （分区 + 排序），老写法已清零。护栏同 B3。

### B6 暗色下的选中态对比度（在线服务 / 更多 info）
- **现状证据**：`.plg-pin.is-oh` 一带把底色写死 `#fff`、文字写死 `#000`（B1 的同源病灶）；在线服务页选中按钮是**亮底 + 白字** → 选中后什么都看不见。
- **改动面**：`global.css` 的 `.plg-pin.is-oh` 与在线服务页按钮类（`pages/info/ThosPage.tsx` 用到的类）。
- **实现要点**：选中态用**成对令牌**——底 `--md-sys-color-primary-container`、字 `--md-sys-color-on-primary-container`；所有选中/激活态逐一核对对比度 ≥ 4.5:1。
- **护栏**：新增 `tools/dark-contrast-test.mjs`（源码级）——断言不存在「写死亮底 + 写死白字」的选中态规则，并输出需人工核对的类清单。
- **DoD**：暗色下在线服务选中任一按钮，探针读 `color`/`background-color` 算出对比度 ≥ 4.5。
- **反例**：只把字改成黑色——亮色主题下又看不见了。
- **落地（2026-10-02，提交 `a69dfd6`）**：新增源码级护栏 `tools/dark-contrast-test.mjs`——
  扫全部 CSS，凡「选中态」选择器（`is-active` / `is-selected` / `is-cur` / `is-on` /
  `aria-selected` / `:checked` / `is-oh`）的规则体里**同时**出现写死的亮底与白字即判失败
  （`/* token-ok: 原因 */` 可豁免）；并点名两条：`.plg-pin.is-oh` 不许出现任何写死颜色、
  `.thos-tabs button.is-active` 的底与字都必须走 `var(...)` 令牌。当前扫过 **34 条**选中态规则，
  0 条违规；`DARK_CONTRAST_LIST=1` 可打印这 34 条供人工逐条核对。
  **真机数字（DEV b12，主题 = onethu.theme.night，在线服务页选中标签）**：底 `rgb(232,235,242)`、
  字 `rgb(14,17,23)`，对比度 **15.84:1**（DoD 要求 ≥ 4.5）。
  **与文档的差异（已报霖）**：文档点名的 `--md-sys-color-primary-container` /
  `--md-sys-color-on-primary-container` 在本仓主题系统里**不存在**（`getComputedStyle` 读回来是空串），
  仓库实际提供的是 MD3 的 primary 对 `--primary` / `--on-primary`（`state/theme.ts` + 动态取色下发），
  成对令牌的原则一致，故按实际令牌名判定与测量。

## 4. M 批 · 细节（手机端 C1–C10，通病 C16–C20）

### C1 顶栏/底栏固定 + 安全区空白
- **现状证据**：滚动发生在 window；上拉时底栏跟着拉伸、下拉时顶栏跟着拉伸（WebView 整页 overscroll）；首屏顶栏上方多一块空白（安全区加错层）；两栏没贴到屏幕边缘，向下滑动时顶栏还会整体下移。
- **改动面**：`components/Layout.tsx`（结构）、`styles/global.css`（滚动容器、安全区、媒体查询）。
- **实现要点**：把滚动收敛到内容区容器（如 `.app-scroll`）；`html, body { height: 100%; overflow: hidden }`；顶/底栏用 `position: fixed`（或 flex 两端固定）；关掉整页拉伸：`overscroll-behavior: none`（配合 D3）；安全区 padding 加在**栏自身**（`padding-top: env(safe-area-inset-top)`），不要加在内容区顶部；整组规则只在 `media (max-width: 840px)` 内生效，PC 结构不动。
- **护栏**：新增 `tools/mobile-chrome-test.mjs`——断言移动端媒体块内存在 overflow hidden / overscroll-behavior: none / 两栏 fixed + safe-area padding，且 PC 媒体块内不出现这些规则。
- **DoD**：真机把内容拉到顶与底，顶/底栏矩形前后完全一致（探针记录 rect）；首屏顶栏上方空白为 0 或等于安全区高度；下划时顶栏 top 不变。
- **反例**：只给顶栏加 fixed，底栏还在跑；用 JS 监听 scroll 硬改位置（抖动且掉帧）。

- **落地（2026-09-29；同日修正结构）**：**滚动容器就是 `.content` 本身**，不再套包裹层——`{children}`（即 `.page-anim`）仍是 `.content` 的直接子节点，顶栏与底栏上移成 `.shell` 的兄弟（≤840 媒体块内 `.shell` 改 `flex column + 100dvh`，两栏 `flex: none`，底栏由窗口级 fixed 改**流内末项**、栏高由内容决定；html/body `height:100% + overflow:hidden`）。PC 不动：`.shell` 仍是 grid 两端 + 整页滚动，新声明全在 `@media (max-width: 839.98px)` 内（护栏断言）。**为什么撤回第一版的包裹层**：包一层 `.app-scroll` 会切断既有「直接子节点」选择器链——待办页靠 `.content:has(.tasks-body) > .page-anim` 逐级传高度、PC 靠 `.content:has(> .page-anim[data-page=…])` 定宽。真机复现：`.content` 子元素变成 `[mobile-topbar, app-scroll]`、`.page-anim` 的 `flex-grow` 掉到 0、待办页多出 **33px** 滚动且「课程通知」被截在约一半处（霖报的第二个 bug）；改回后待办页 `clientHeight 685 = scrollHeight 685`（多出 0）、`flex-grow 1`、通知条完整。滚动读数 `readScrollTop()` / `scrollAppTop()` 认 `.content` + window **capture** 监听；换页（含进详情）把容器归零（旧偏移会跟到新页，真机取证容器 top=500 切页后仍 500；E1 做导航栈后改为按历史恢复）。**安全区按霖的决定走运行时判定**：实测屏幕 400×870、窗口高 805（原生壳已让开状态栏 48 + 手势条 17），而 WebView 仍把 `env(safe-area-inset-top)` 报成 48px，直接写会重复计算（顶栏 42 → 89.5、标题落到 y=60.8、首屏白多 48px）；`main.tsx` 的 `syncSafeTop()`：窗口比屏幕矮 ⇒ `--safe-top: 0px`，否则 `env(safe-area-inset-top)`（启动与 resize 各同步一次），顶栏 `padding-top: calc(10px + var(--safe-top, 0px))`；底部沿用改造前的 `env(safe-area-inset-bottom)`。护栏 `tools/mobile-chrome-test.mjs`（已登记 guard 链）断言：`{children}` 直挂 `.content`、两栏在 `.content` 之外、`.page-anim` 选择器链仍在、`.app-scroll` 不得复活、滚动约定、`--safe-top` 运行时判定、换页归零、PC 仍是 grid、末端反馈实现在位。**数字证据**（<设备>，400×805，dpr 3）：改造前顶栏 t=16 b=58 h=42（上方空白 16px，来自 `.content` padding）、滚动元素 = HTML、文档高 1972、`window.scrollY` 随滚动变化；改造后顶栏 t=0 b=42 h=42（空白 **0**）、底栏 t=727 b=805、`.content` t=42 b=727 h=685（可滚 1056）、`windowY` 恒 **0**；拉到顶与底 + 真手触越界拖拽四次测量，两栏矩形完全一致、文档高恒 = 视口 805。截图：今日页暗/亮、设置页暗/亮、设置页滚到底（滚动条只在内容区）。
- **落地（同日二修：顶栏毛玻璃与栏高）**：霖指出「顶栏太矮、基本卡着 logo 高度，毛玻璃也没了」。根因是结构二修的副作用：顶栏成了滚动容器的**上一个兄弟**、与内容上下分离，`backdrop-filter: blur(10px)` 虽在 CSS 里，但**后面没有任何东西可糊**（栏底色 86% 白叠在页面底色上），看起来既没有玻璃感、底边距也像没了。修法：**让滚动容器的上沿钻到顶栏底下**——顶栏 `margin-bottom: calc(-1 * var(--topbar-h, 46px))`，内容区 `padding-top: calc(var(--topbar-h) + 14px)` 让首行让开栏高；`--topbar-h` 由 Layout 里 `ResizeObserver` 实测写回（安全区/字号/密度档变化自动跟上，不写死像素），顶栏保持 `z-index: 30` 压在滚动容器（含它的滚动条）之上，所以**上沿那截滚动条仍看不见**（C2 不回退）；顶栏自身 `padding` 底边距由 8 → 12（栏高 42 → **46**）。护栏新增：`backdrop-filter` 在位、负 margin 用 `--topbar-h`、内容 `padding-top` 让开栏高、`z-index ≥ 30`、`--topbar-h` 由 ResizeObserver 写回。真机量（顶栏与内容同刻读数）：顶栏 `t=0 b=46 h=46`、`margin-bottom: -46px`、`--topbar-h: 46px`、内容区 `t=0`（上沿在栏下）`b=727`、`padding-top: 60px`、首行（`.page-head`）`60-98` = 栏下 **14px**；滚 260px 后有 **10 个内容元素**落在顶栏范围内（如 `.today-grid` top −17），即内容确实从栏下滚过、毛玻璃有东西可糊（截图里能看到被糊成半透明的鬼影）。

### C2 滚动条越界 + D5 滚动条出现导致内容位移
- **现状证据**：滚动条贯穿全屏，把顶/底栏右侧挤开一块空白；从无滚动条页面切到有滚动条的页面时，内容被推开一截。
- **改动面**：`styles/global.css`（滚动容器与其滚动条样式）。
- **实现要点**：C1 收敛滚动容器后，滚动条自然只属于内容区；给滚动容器加 `scrollbar-gutter: stable` 让**出现与否都不改变内容宽度**（Chromium/WebView 里真正的 overlay 滚动条已废弃，预留槽位是可靠做法——这是对「不挤动」最稳的落地）。滚动条做细（6px）、轨道透明、hover/滚动时才显色。
- **护栏**：断言滚动容器有 `scrollbar-gutter: stable`；断言顶/底栏不在滚动容器内部。
- **DoD**：从一个无滚动条页面切到长页面，内容 `left` 位移 = 0（探针量关键元素 rect）；滚动条竖直范围只在内容区（不进入顶/底栏高度）。
- **反例**：把滚动条 `display: none` 了事（用户失去位置感与拖拽能力）。

- **落地（2026-09-29）**：滚动容器（`.content`）加 `scrollbar-gutter: stable`（出现与否都不改内容宽度）；移动端 html 层原来的 `overflow-y: scroll` 被 `overflow: hidden` 取代，滚动条因此只属于内容区，竖直范围 42..727 **不进两栏高度**。真机量：短页（设置，容器高 708）↔ 长页（今日，容器高 1741）切换，内容 `left` 与滚动区 `left` 均 0、**位移 0**；滚动区右边界 400 = 视口宽（Android 是覆盖式滚动条，不占槽位）。护栏同 C1（`tools/mobile-chrome-test.mjs` 里的 `scrollbar-gutter: stable` 与「两栏不在滚动容器内」两条断言）；截图见设置页滚到底那张。

### C3 不自然的换行
- **现状证据**：在线服务页出现「一行只有两个字、堆五六行」；网络学堂四宫格出现 3+1。
- **改动面**：`pages/info/ThosPage.tsx` + `global.css` 对应块；四宫格在 `pages/Learn.tsx` 的 grid。
- **实现要点**：窄屏把卡片从「左右布局」改成**上下布局**（标题/说明在上，动作在下）；动作排按 A3 收进长按菜单，卡面只留最必要的一项；四宫格窄屏固定 `repeat(2, 1fr)`、宽屏 `repeat(4, 1fr)`，不要用 auto-fit（它就会给出 3+1）。
- **护栏**：新增 `tools/narrow-wrap-test.mjs`——断言窄屏媒体块内没有强制 nowrap 的行内动作排；断言四宫格用固定 2/4 列。
- **DoD**：真机 400px 宽下在线服务页最窄文本块宽度 ≥ 4 个字宽（探针量）；四宫格为 2×2 无落单。
- **反例**：只压 `font-size`/`padding` 硬凑，堆叠依旧难看。

- **落地（2026-10-02）**：真机复现（400px 宽、`#/thos`）：`.thos-grid` 排成 `174px 174px` 两列，服务卡里文本块只剩 **46px**，名字「亲友来访人员报备」被折成 **3 行**。改法两条：① 在线服务卡窄屏（≤839.98px）改单列 + 卡内上下布局（`flex-direction: column`、`.thos-service-open` 占满整行、动作落下一行右对齐），卡面动作只留「收藏」一项——「固定/取消固定」本来就在长按菜单（`serviceMenuItems` 的 `key: "pin"`），撤掉后不再占宽度；② 网络学堂四宫格从 `auto-fill + minmax(320px)` 改成**固定列数**（宽屏 `repeat(4, 1fr)`、手机 `repeat(2, 1fr)`，并删掉旧的 700px 单列覆盖）。护栏 `tools/narrow-wrap-test.mjs`（已登记 guard 链）：窄屏块存在且排在后、单列、上下布局、文本占满、无 nowrap、卡面只有一个动作、菜单仍有固定项、四宫格固定 4/2 列。

- **真机复测（2026-10-02，DEV b8，REDMI K90 Pro Max 400×805）**：卡内那条改动生效——服务名宽度 **46px → 110px**、「亲友来访人员报备」不再折成 3 行，卡面也只剩「收藏」一枚动作；但**单列没生效**，`.thos-grid` 仍是 `174px 174px`，卡里的长名字横向溢出、被卡边裁掉一半（霖复看：「每个卡片都被截断到了一半」）。
- **根因（2026-10-02 当天定位）**：文件中间那条窄屏兜底
  `@media (max-width:839.98px) { .content [class*="grid"], .content [class*="cards"] { grid-template-columns: repeat(auto-fill, minmax(min(100%,158px),1fr)) !important } }`
  ——它按类名子串匹配**一切网格**、且带 `!important`。`!important` 的优先**高于普通内联样式**，所以
  CDP 里写普通 `style.gridTemplateColumns = "1fr"` 无效、只有 `setProperty(..., "important")` 才生效：
  单列规则被它改写回 158px 两列。用 CDP 的 `CSS.getMatchedStylesForNode` 才看到这条（普通样式表遍历
  里它的选择器不含 `thos-grid`，因此先前扫描漏掉——这就是「机理未定位」的答案）。
- **真机复验（2026-10-02，DEV b9，同一台机 400×805）**：`.thos-grid` = **`358px` 单列**、卡 `358×132`、服务名一行放下（`120×24`，文本「亲友来访人员报备」）、`scrollWidth == clientWidth`（**无横向溢出**）、41 张卡全部完整；截图 `.tmp-shots/c3-b9-fixed.png`（gitignore）。窄屏 2 列的旧观感（174px 卡 + 名字被裁一半）已消失。
- **定版改法**：C3 的两条窄屏列数（服务单列、四宫格 2 列）都挪到文件**末尾**、加 `.content` 前缀
  （同特异性）并带 `!important`，靠**位置更后**压过那条兜底；`.thos-grid` 的宽屏基础列数同时改回
  原来的 `minmax(260px, 1fr)`（C3 只应改窄屏，不应连带改动 PC 的列数）。护栏 `tools/narrow-wrap-test.mjs`
  现在钉住三件事：宽屏基础列数是 260、窄屏两条都带 `!important` 且**排在那条兜底之后**。真机复验
  （注入同款 CSS 后量）：`.thos-grid` = **358px 单列**、卡宽 358、服务名一行放下（120px）。

### C4 底栏胶囊指示区太矮
- **改动面**：`components/Layout.tsx` 的 `BottomNav` 与 `global.css` 的 `.bottom-nav-pill` / `.bottom-nav-item`。
- **实现要点**：胶囊高度取自 item 的实际矩形（或与文字行高 + padding 联动的变量），不要写死小像素值；胶囊要完整包住文字。
- **护栏**：断言 pill 的高度不来自硬编码常量而来自 item 量测或共享变量（源码断言 + 真机数值断言）。
- **DoD**：真机探针：pill 的 rect 完全包含文字 rect（pill.top ≤ text.top 且 pill.bottom ≥ text.bottom），五个 tab 都成立。
- **反例**：把字号调小来「塞进去」。

- **落地（2026-10-02）**：胶囊原来 `top: 12px; height: 32px` 写死，而底栏项的内容盒是「图标 24 + gap 2 + 标签 14.4 ≈ 40px」——标签从胶囊下沿露出来。改为 `useBottomNavPill` 在每次定位时按**当前项的内容盒**量：高度 = item 高度 − 自身上下 padding（≈40.4px），top 从内容盒顶起算并换算到 `.bottom-nav` 的 padding box（8+6−8 = 6px），宽度取 `max(64, 标签宽 + 32)` 且不超单元格；CSS 侧只留 `var(--nav-pill-top, 14px)` / `var(--nav-pill-h, 42px)` 首帧兜底。护栏并入 `tools/mobile-chrome-test.mjs`：胶囊 top/高度必须是这两个变量、motion.ts 必须按内容盒实测写入、不得再出现 `height: 32px`。

### C5 刷新按钮移到顶栏右上角
- **现状证据**：`components/Layout.tsx` 的 `HardRefreshButton` 浮在右下角——占着最舒适的操作区却很少用。
- **改动面**：`components/Layout.tsx` + `global.css`。
- **实现要点**：移动端把刷新放进顶栏右侧（与标题同排），功能与提示文案不变；右下角不再有浮层按钮；PC 端不在本批（P 批再定）。
- **护栏**：断言移动端顶栏内出现刷新入口，且不存在固定在右下的刷新浮层。
- **DoD**：真机：顶栏右上角可点、确实触发刷新；右下角干净。
- **反例**：直接把按钮删了（功能减法）。

- **落地（2026-10-02）**：`MobileTopbar` 右侧新增 `.topbar-refresh`（排在「···」之后=最右上角，`aria-label="硬刷新"`，触发 `window.location.reload()`）；同一枚浮层的另一半「回到顶层」也搬进顶栏（滚过 240px 才出现，阈值与原浮层一致），手机上不丢这个功能。手机档新增 `.hard-refresh-fab { display: none; }`，右下角干净；PC 不在这条媒体块里，两枚浮层照旧（本批不动 PC）。护栏并入 `tools/mobile-chrome-test.mjs`：顶栏切片里必须有刷新入口、必须真的 reload、`HardRefreshButton` 组件不得被删、手机档必须藏掉浮层。

### C6 标题重复 + 设置页顶栏无名 + 顶栏文字放大
- **已定口径**：手机端隐藏页内大标题，PC 保留。
- **改动面**：`components/Layout.tsx`（路由→标题的**唯一映射表**）、各页面的页内标题元素、`global.css`。
- **实现要点**：顶栏标题走单一映射表（必须补上 `settings`，现在那里缺项才显示默认字样）；手机端隐藏页内大标题（区段小标题保留）；顶栏字号上调一档。
- **护栏**：新增 `tools/page-title-test.mjs`——断言每个路由都有标题映射（含 settings）、断言页内大标题在移动端被隐藏、断言映射表只有一处定义。
- **DoD**：真机切 5 个页面（含设置），顶栏都显示正确名字；页内不再重复大标题；顶栏文字比改前大。
- **反例**：只删首页的标题；设置页顶栏仍是 OneTHU。

- **落地（2026-09-29）**：`state/navigation.ts` 新增 **唯一映射表** `PAGE_TITLES`（`Record<Exclude<Page, \`plugin:\${string}\`>, string>`，30 个静态路由全覆盖；TypeScript 穷尽检查让「新增路由忘补标题」编译不过——`settings` 当初就是这么显示成 OneTHU 的）+ 唯一取值口 `pageTitle()`。Layout 顶栏标题改走它（删掉就地拼的三元兜底串），插件 tab 名仍取插件注册表、收藏夹名仍取用户数据。移动端 `.page-head h1 { display: none }`，**实体标题**（课程名/作业名/话题名）经 `.page-head-title-entity` 保留，判据只有一处 `title !== pageTitle(page)`；非字符串标题（收藏夹重命名的受控输入）一律保留——藏了就没法改名。顶栏字号 16px → `var(--text-lg)`（手机档 18px），并加省略号防插件长名挤压品牌标。护栏 `tools/page-title-test.mjs`（已登记 guard 链）：映射表全仓仅一处、静态路由全覆盖（含 settings）、Layout 不再就地拼标题、移动端隐藏而 PC 保留、字号确有上调。**真机**：7 个路由顶栏全对且 18px——今日 / 设置 / 待办 / 网络学堂 / 邮箱 / 服务 / 收藏；页内大标题 `display:none`（含 `.page-head` 手写标记的邮箱页与搜索页）；设置页顶栏由改造前的「OneTHU」变为「**设置**」（截图 `m1-settings-light.png`）。

### C7 左右滑动切换 tab
- **现状证据**：待办页的手势只在「最近新闻」标题区生效，列表里滑不动（手势被列表滚动与子元素抢占）。
- **改动面**：`pages/TasksPage.tsx` 的手势判定抽成公共 hook（如 `lib/useSwipeTabs.ts`），再接到含 tab 的页面：`pages/Settings.tsx`、`pages/info/InfoPage.tsx`、`pages/info/LifePage.tsx`、`pages/Plugins.tsx`、`pages/MailPage.tsx`、`pages/FolderPage.tsx`。
- **实现要点**：判主轴——横向位移 > 纵向位移且超过阈值（约 40px）才算切 tab，否则交还列表滚动；容器 `touch-action: pan-y`；**不要** preventDefault 掉纵向滚动。
- **护栏**：新增 `tools/swipe-tabs-test.mjs`——断言 hook 唯一、被目标页复用、含主轴判定与阈值、未禁用纵向滚动。
- **DoD**：真机：在待办列表内部（非标题区）左滑能切到生活；在长列表内上下滑动不误切。
- **反例**：引手势库（红线禁止）；把列表滚动禁掉换成「能滑但滚不动」。

- **落地（2026-10-02）**：手势搬进唯一实现 `apps/desktop/src/lib/useSwipeTabs.ts`——touch 事件（四条监听全 `passive`）、`touch-action: pan-y`、8px 死区先定主轴、抬手要 `|dx| ≥ 40` 且 `|dx| ≥ 2|dy|`，容器声明 `touch-action: pan-y`，**不** preventDefault；起手落在 `.seg-track` / `[data-swipe-ignore]` 上不算（分段控件自己要用横滑拖胶囊），嵌套手势区（收藏夹页每层 FolderView）只在最内层生效（受理时 `stopPropagation`）。接入 5 处：`TasksPage`（顺序 = render 的 学习/生活，宽屏双栏同显时 disabled；**换掉了原来的 pointerdown/pointerup 版**——那版被滚动引发的 `pointercancel` 掐死，只有标题区滑得动）、`Settings`（顺序 = 过滤后的 `visibleTabs`，与渲染同一份数组，含自定义排序/隐藏/高级模式）、`InfoPage` 与 `LifePage`（顺序 = `TAB_IDS`，走各自 `activate` 以维持 visited）、`FolderPage` 的 `FolderView`（顺序 = `visibleIds`，当前项 `effTab`）。`MailPage` / `Plugins` 没有页级 tab（前者是文件夹列表、后者的 tab 在添加插件的弹窗里），无可接入点。护栏 `tools/swipe-tabs-test.mjs`（已登记 guard 链）：唯一实现、5 处复用且 ref 确实挂上、不许再有就地 pointer 版、主轴判定与阈值、全 passive 且无 preventDefault、`.seg-track` 排除。

### C8 作业卡片上的按钮点不了
- **现状证据**：`pages/TasksPage.tsx` 353 行起的动作排（忽略/提醒/收藏）在手机上点不动，会直接打开作业卡片——按钮的点击被卡片命中层拦截。
- **改动面**：`pages/TasksPage.tsx` + `global.css` 卡片层级。
- **实现要点**：动作按钮 `stopPropagation` 且层级高于卡片点击层；触屏命中尺寸 ≥ 40px；不要用 `onClickCapture` 打补丁（会让整张卡片变哑）。
- **护栏**：新增 `tools/card-action-hit-test.mjs`——断言动作按钮 stopPropagation、命中尺寸下限、层级高于卡片命中层。
- **DoD**：真机：点「忽略」只走忽略流程（弹确认）且不打开详情；点卡片空白仍能打开详情。
- **反例**：把卡片点击整个关掉（详情也打不开了）。

- **落地（2026-10-02）**：根因是卡片用 `onClickCapture`（捕获阶段先跑），卡面动作钮的 `stopPropagation` 拦不住——点「忽略」时详情已经被打开。改成冒泡阶段的 `onClick`（拖拽过/非前台卡仍吞掉这次点击），「忽略」钮自己再加一道 `stopPropagation`；三个动作钮的命中盒统一抬到 **40×40**（`.hw-card-act` 直接 40×40、`.hwremind-bell` 与 `.collect-star` 走 `min-width/min-height: 40px`，图标大小不变），满足触屏 40px 下限；卡片 168px 高装得下（40 + 5 + 两行 39 + 底部 24 + padding 24 ≈ 132px）。护栏 `tools/card-action-hit-test.mjs`（已登记 guard 链）：不许回到 capture、动作排与忽略钮都要 stopPropagation、三钮命中盒 ≥40px、卡片空白仍打开详情。

### C9 日程时间轴视图
- **已定口径**：默认时间窗 6–24 点；打开即「尽收眼底」；「时段」「同步到系统日历」「手动切换学期」收进二级菜单。
- **改动面**：`pages/Schedule.tsx`、`pages/ScheduleAgenda.tsx`、`state/scheduleWindow.ts`（默认窗口改 6:00–24:00）。
- **实现要点**：顶部只留「时间轴 / 列表」切换 + 日期切换；其余控件进 A3 的二级菜单；时间轴高度与可视区联动（去掉把内容推下去的大 padding），空时段压缩显示；因为整屏已铺满全天，**打开时不需要自动滚动**。
- **护栏**：新增 `tools/schedule-timeline-test.mjs`——断言默认窗口为 6–24、三个功能入口在二级菜单里、时间轴高度取自可视区而非固定大值。
- **DoD**：真机打开日程：06:00 与 23:00 两个刻度同屏可见（探针量两者的 rect 都在视口内），无需手动滚动。
- **反例**：只把窗口改成 6–24 却仍需手动滚（没达到「尽收眼底」）。

- **落地（2026-10-02）**：① `state/scheduleWindow.ts` 新增 `DEFAULT_WINDOW = { from: 6*60, to: 1440 }`（`FULL_DAY` 仍保留为预设与「恢复全天」的目标），`load()` 的三处兜底全改走它；② 轴高不再写死 `const PX_PER_MIN = 0.52`，改成 `let` + 每次渲染按「可用高 ÷ 窗口分钟数」现算（可用高 = `window.innerHeight − 260`，夹在 0.34–0.62 之间），并算出 `axisFits = canvasH <= axisAvail`——整窗放得下时不再自动滚动（打开即尽收眼底）；③ 工具栏只留「时间轴 / 列表」与日期切换（日历快跳 + ‹ › 今天）＋状态/上云同步/新建，「显示时段…」「同步到系统日历」「跳转学期 / 周…」三项进 `PageHead` 的二级菜单，原先那两个绝对定位浮层改成工具栏下的 `Card` 面板（`winOpen` / `semJumpOpen`）。`ScheduleAgenda.tsx` 未改：这两块工具栏在 `Schedule.tsx` 里、两个视图共用。护栏 `tools/schedule-timeline-test.mjs`（已登记 guard 链）：默认窗口 6–24 且 load 兜底不再是全天、三入口在菜单、工具栏里没有时段按钮/系统日历按钮/下拉、学期下拉全仓只一处、`PX_PER_MIN` 是 let 且按视口折算、放得下不自动滚。

### C10 输入法把底栏顶起
- **已定口径**：由**构建期脚本**注入 `windowSoftInputMode`（`tauri.conf.json` 配不了——Tauri v2 窗口配置里没有软键盘键，只有 iOS 的 `disable_input_accessory_view`）。
- **改动面**：`tools/` 新增注入脚本（先 `readlink -f` 解析 `src-tauri/gen/android` 符号链接，再改 `app/src/main/AndroidManifest.xml` 的 activity 属性）、在 Android 构建脚本里调用它、门禁加断言。
- **实现要点**：目标只有一个——**键盘弹出时底栏位置不变**。优先试 `adjustNothing`（键盘覆盖底栏，底栏不动）；此时要保证输入框自身能滚到键盘上方（内容区可滚动 + `scrollIntoView`）。若输入框被遮，就退到 `adjustResize` + 前端把底栏钉在 layout viewport 底部（此时需用 `visualViewport` 补偿）。`adjustPan` 会整页平移、顶栏也动，不采用。
- **护栏**：新增 `tools/android-softinput-test.mjs`——断言注入脚本存在、**幂等**（重复跑不重复写）、解析了符号链接、门禁会校验注入结果。
- **DoD**：真机点开输入框，底栏 top 与弹出前一致（探针记录前后 rect）；输入框与候选词条可见可用。
- **反例**：手改 `gen/` 目录（不入库、换机器即丢）；只改属性不管输入框是否被键盘盖住。

- **状态（2026-10-02）**：**未做，等霖定**。仓库里已有幂等的构建期注入脚本基座（`tools/patch-android-dev.py`，由 `apps/desktop/scripts/build-dev-apk.sh` 以符号链接解析后的真实工程路径调用，改的是 `app/build.gradle.kts` / `AndroidManifest.xml` / 图标），C10 要加的是同一处的 `windowSoftInputMode`。搁置原因有二：① 它写的是仓库**外**的 Android 工程（`src-tauri/gen/android` → `<安卓工程目录>`），按红线要先问；② `adjustNothing` 要求前端配合把输入框滚到键盘上方，而桌面端目前没有任何 `visualViewport` / `scrollIntoView` 处理（全仓 0 处），也就是说这条改完必须真机敲一遍键盘才能确认「输入框没被盖住」，不是纯静态改动。霖点头后按「脚本注入 + 幂等断言 + 前端 visualViewport 补偿」一起做。

### C16 待办页下拉菜单是浏览器默认样式
- **改动面**：`pages/TasksPage.tsx` 的下拉处 + 既有下拉组件。
- **实现要点**：统一到项目自己的下拉（`SearchSelect` 已是 portal + fixed 的成熟实现，优先复用它或它的样式基座）；不要各处自造第二套。
- **护栏**：断言 TasksPage 不直接渲染裸 `<select>`（或裸 select 挂统一类）；断言复用共享组件。
- **DoD**：真机与 PC 上，该下拉的圆角/描边/阴影/字号与别处同款（探针比对计算样式）。
- **反例**：只给它加几行 CSS 覆盖，仍与别处不同源。

- **落地（2026-10-02）**：待办页那个裸 `<select className="hw-filter-select">` 换成全站共用的 `SearchSelect`（portal + fixed 面板、分组标题仍走 `group: "网络学堂"` / 外部源名），CSS 侧删掉 `hw-filter-select` 的整套样式、只留 `.hw-filter .filter-dd { flex: 1 }` 保证撑满。

### C17 输入框焦点环小于输入框
- **现状证据**：服务页搜索框「搜索」占了一整条，焦点环却只包住真正可输入的窄条，既没含左侧放大镜，也没含整条外框。
- **改动面**：`styles/global.css` 的 focus 规则 + 各输入容器类（如服务页搜索容器）。
- **实现要点**：焦点环画在**控件外框**上——给容器加 `:focus-within` 的 outline/box-shadow（圆角与容器一致），而不是只给 `<input>` 加；统一 `outline-offset`。
- **护栏**：新增 `tools/focus-ring-test.mjs`——断言焦点环走容器 `:focus-within`，断言不存在「只给裸 input 加环而容器更宽」的形态。
- **DoD**：探针：聚焦服务页搜索框，环的 rect 与容器 rect 宽高差 ≤ 2px。
- **反例**：只把 outline 加粗（仍然只包住 input）。

- **落地（2026-10-02）**：焦点环统一画在控件外框上——`.svc-search:focus-within`（服务页搜索：图标 + 输入框的容器，原来环只包住那一窄条）、`.thos-search:focus-within`（在线服务搜索）新增令牌环，`.cloud-search:focus-within`（云盘搜索，原来只换边色）补上 `outline: none` + `--md-sys-focus-ring`；`.search-box:focus-within` 早就是容器环，不动。护栏 `tools/focus-ring-test.mjs`（已登记 guard 链）：三类容器都要 `:focus-within` + 令牌环、内部 input 必须关掉默认 outline（否则双层环）、环里不许硬写 outline 宽度；并同时钉住 C16（待办页无裸 `<select>`、引用并接好共享 `SearchSelect`、分组标题未丢、`.hw-filter .filter-dd` 撑满）。

### C18 今日页「余额速览」
- **现状证据**：整页只有这一处多出外描边；宿舍电费当前查不了。
- **改动面**：`pages/Today.tsx`、`lib/homeCards.ts`、`global.css`。
- **实现要点**：去掉那处多余外描边（与今日页其他卡片同款）；余额项**降低优先级**——把它在默认顺序里后移，**不是删除**；先查清电费是「接口失效」还是「尚未接线」，结论写进提交信息（若只是失效，保留入口并给友好空态）。
- **护栏**：断言余额卡在默认顺序里位于后半段；断言没有额外 border 覆盖。
- **DoD**：真机：该卡不再有突兀描边；默认顺序里余额项在后。
- **反例**：把电费整块删掉（功能减法）。

- **落地（2026-10-02）**：`.balance-strip` 原来自带 `border: 1px solid var(--border)`——今日页其它卡片（`.card` 只有底色 + 圆角，无描边）都没有，只有它突兀，改成 `border: 0`；`homeCards.ts` 里 `balance-strip` 的 `defaultOrder` 由 **0 后移到 5.5**（排在「猜你喜欢」之后，属于后移不删除；用户自己存过顺序的仍按用户的走）。**电费结论（写进提交信息）**：属于「**尚未接线**」而不是接口失效——`packages/core/src/info/client.ts` 的 `getEleRemainder()`（`Netweb_Home_electricity_Detail.aspx`）实现完好、`standalone` 里也在用，但桌面端从未取数：`Today.tsx` 的余额条对电费只渲染静态「去查询」入口（源码注释即为「电费需宿舍上下文（P2 接入），先做入口」）。故按同样口径保留入口、不做功能减法。护栏并入 `tools/card-layers-test.mjs`：余额条不得有描边、必须显式 `border: 0`、`defaultOrder ≥ 4`、电费入口仍在。

### C19 寻迹页高德 Key 横幅
- **已定口径**：改成友好说明 + 引导到设置里自填 Key。
- **改动面**：`pages/Trace.tsx`（约 473 行的横幅）+ 设置里新增 Key 输入入口（本地保存，通道可沿用现有 `.env` 读取逻辑）。
- **实现要点**：去掉甩给用户看的开发者路径文案（`.env.example` 之类）；改成一句人话 + 「去设置填写」按钮；未配置时地图区显示友好占位而不是报错条；Key 只存本地，**不写死进包**。
- **护栏**：断言 Trace.tsx 不再出现开发者字样（`.env` / `TRACE_AMAP_KEY` 的说明性文案）；断言设置里存在 Key 入口。
- **DoD**：真机未配置时不出现大红横幅；点击引导能跳到设置；填入后地图恢复可用。
- **反例**：只把红底改成灰底（文案还是看不懂）。

- **落地（2026-10-02）**：① `Trace.tsx` 的未配置横幅不再给用户看开发者路径（`.env.example` / `TRACE_AMAP_KEY`）——改成一句人话「还没配置高德 Key，地点检索与路程估算暂时用不了（地图与今日日程照常查看）」+ 「去设置填写」按钮（`requestSettingsTab("数据与同步")` → `navigate("settings")`）；② 设置页新增「寻迹地图」分节（登记进 `SETTINGS_TAB_OF` 与 `SETTINGS_GROUPS` 的「数据与同步」组），里面是高德 Web 服务 Key 的输入框 + 保存/清除，密码型输入、只存本机 `localStorage`（`lib/trace.ts` 的 `readStoredTraceKey` / `saveStoredTraceKey`，key 为 `onethu.trace.amapKey`）；③ `lib/trace.ts` 的 `amapKey()` 取值顺序改为「运行时注入 → 内存缓存 → 本机存储」，`ensureTraceKey()` 也认本机存储——构建期 `.env` → Rust `trace_key` 那条内置通道仍然优先、仍然可用，自填只是让没有内置 Key 的人不必改仓库文件重装。护栏并入 `tools/settings-ia-test.mjs`：Trace 的**可见文案**里不许出现开发者字样（注释不算）、引导必须跳到设置对应栏目、设置里必须有「寻迹地图」分节与 Key 输入、分节↔页签映射双向一致、Key 只走本机存储且不得在源码里写死。

### C20 OH 聊天界面的互动
- **现状证据**：发送消息后会把「LLM 响应」之类的日志/统计直接摊在聊天里；下方统计文字用的是宋体。
- **改动面**：先定位（`grep -rn "深度求索\|LLM\|token" apps/desktop/src`）+ `global.css` 字体栈。
- **实现要点**：只显示「正在深度求索…」这类人话状态；原始响应/日志/耗时默认不展示（若开发者面板已有位置，就挪进去）；统计文字的字体栈改回正文无衬线栈（去掉 serif/宋体回退）。
- **护栏**：断言聊天组件不渲染原始日志字段；断言统计类不使用 serif 字体栈。
- **DoD**：真机发一条消息：只见「正在深度求索…」，无日志噪音；统计文字与正文同族。
- **反例**：把日志 `display: none` 但仍留在 DOM 里、读屏还能念出来。

- **落地（2026-10-02）**：① 流式期那条「工具调用」链不再默认展开（`defaultOpen` 去掉）——原始 R7 行（`→ LLM 请求 <model> · … · <端点 URL>`）与耗时不再摊在聊天里，进度由人话状态「思考中…」承担；落定后的链仍然保留、随时点开回看（不删功能、也不用 `display: none` 假隐藏）。② `.dock-foot` 的 `font-family` 从 `var(--font-mono)` 改成 `inherit`：这台机上等宽栈回退成了宋体观感，统计文字与正文不同族。护栏 `tools/dock-chat-test.mjs`（已登记 guard 链）：流式 trace 不得 `defaultOpen`、必须有人话状态、不许 `display: none` 假隐藏、`.dock-foot` 必须回正文栈且无 serif、落定后的工具调用链仍在。

## 5. M 批 · 动画

### D1 性能（按已认可的建议）
- **包含三件事**：①长列表上 `content-visibility: auto` + `contain-intrinsic-size`；②骨架屏→内容交叉淡入，杜绝闪跳（CLS）；③OH 聊天打开明显不流畅，要专项。
- **改动面**：`styles/global.css`（长列表容器）、`pages/learn/*`（作业/文件/通知列表）、骨架组件与使用者、OH 聊天组件。
- **实现要点**：长列表先上 `content-visibility`（改动小、收益大），真机量过再决定要不要虚拟化；骨架与内容交叉淡入用一个统一的过渡类；OH 打开时降低挂载成本（消息列表延迟渲染、避免一次性触发大量布局）。
- **护栏**：新增 `tools/perf-css-test.mjs`——断言长列表容器具备 `content-visibility` 与 `contain-intrinsic-size`；断言存在骨架→内容的过渡类。
- **DoD**：真机用 CDP 采样（滚动帧间隔 / 长任务）给出**前后数字**；OH 打开的可交互时间明显下降。
- **反例**：只加 `will-change` 或 `translateZ(0)` 了事。

- **状态（2026-10-04 复核）**：**已落地**，落地记录与真机数字见本批「性能收尾（2026-10-02）」段（`.content .list` / `.dock-msgs` 的 `content-visibility: auto` + `contain-intrinsic-size`、只动 opacity 的 `swap-in` 过渡、护栏 `tools/perf-css-test.mjs` 已登记 guard 链；含 42 行长列表 A/B 与 REDMI 对照）。此处补一条指针，避免按本小节搜索「落地」时误判为未做。

### D2 底栏胶囊的挤压回弹
- **改动面**：`components/Layout.tsx` 的胶囊动画 + `styles/motion.css`。
- **实现要点**：现有「拉伸」保留，在**减速接近目标**时加一段「挤压」（长度变短、宽度变长），然后弹回原位；只动 `transform`（scaleX/scaleY）；曲线用 B2 登记的过冲令牌。
- **护栏**：断言只动画 transform、存在挤压相位、reduced-motion 降级。
- **DoD**：真机探针逐帧读胶囊 rect：宽度出现「先增、回正」的相位；无掉帧。
- **反例**：用 `width` 做动画（触发布局与重排）。
- **落地（2026-09-30）**：改动只有一处——`lib/motion.ts` 的 `useBottomNavPill` 里加挤压相位，新增三个常量 `NAV_PILL_SQUASH_APEX = 0.06`（横向最多收 6%）、`NAV_PILL_SQUASH_WIDE = 1.6`（竖向变厚相对横向收量的比例，近似体积守恒）、`NAV_PILL_SQUASH_FRAMES = 6`；在**弹性收尾段**（从惯性顶点往目标收的那一段，`bounce > 0` 时才有）插入 6 帧，形变包络取 `Math.sin(Math.PI * sq)`（0 → 1 → 0，端点不起跳），位移与形变仍写在同一条 `transform` 上（分开写会各走一条线程而错位）。护栏加在既有 `tools/nav-shell-test.mjs`（不为 4 条断言新开文件）：挤压常量与 sin 包络存在、横向收与竖向厚按 `NAV_PILL_SQUASH_WIDE` 耦合、`frames.push` 里不出现 `width/height/left/top/margin/padding`、`prefersReducedMotion()` 仍在。
  **真机数字**（<设备>，探针逐帧读 `.bottom-nav-pill` 的 rect，静止 64×32，各采样约 60 帧）：
  - **跨一格（今日 → 待办，无弹性收尾）**：宽 64 ~ 89.6、高 26.2 ~ 32；横向收短相位 **无**、竖向变厚相位 **无** —— 与改造前基线逐帧一致（说明小距离手感没被动过，无回归）。
  - **跨三格（今日 → 收藏，有弹性收尾）**：宽 64 → **60.3**（0.942×）→ 64、高 32 → **35**（1.094×）→ 32；挤压窗口在第 16~27 帧，逐帧序列 `(64.5,31.9) (64,32) (63.3,32.6) (62.3,33.4) (61.5,34) (60.8,34.5) (60.4,34.9) (60.3,35) (60.3,35) (60.7,34.7)` —— 宽度（竖向厚度）**先增后回正**，横向同步收短，DoD 成立。
  - **无掉帧**：同一段动画 61.3fps，最大帧间隔 16.8ms。
  - **说明**：挤压相位只在「有弹性收尾的长距离移动」里出现——这是沿用既有设计（`NAV_ROWS_KNEE` 之内不做弹性，避免一格切换也晃）；若霖希望一格切换也挤压，需要单独改时间线，本轮没动。

### D3 滚动到末端的反馈
- **已定口径**：去掉浏览器默认的整页伸长，顶栏与底栏不参与。
- **改动面**：与 C1 同一处（`global.css` 滚动容器）。
- **实现要点**：`overscroll-behavior: none` 关掉默认拉伸；若要保留「到头了」的反馈，用内容区自身的轻微反馈（如内容上边距回弹），**顶/底栏绝不参与**。
- **护栏**：断言 `overscroll-behavior: none` 且没有对 `body` 做拉伸动画。
- **DoD**：真机拉到底：顶/底栏 rect 不变；内容不整页伸长。
- **反例**：只加注释不改行为。

- **落地（2026-09-29；同日补回反馈）**：①关掉整页拉伸——`overscroll-behavior: none` 落在 html / body / `.content` 三处，没有对 body 的拉伸动画。②**末端反馈只由内容区自己做**（第一版把反馈整个删掉了，霖指出「我说的是上下边栏不参与反馈动画，而不是整体把动画删掉」）：`Layout.tsx` 的 `attachEdgeFeedback()` 在越界拖拽时给 `.content` 加 `translateY`（阻尼 0.35、封顶 44px），松手 260ms 缓动归零。要点：监听挂 window **捕获**阶段（元素层会丢收尾——待办页卡片流上真机复现过内联 `translateY(44px)` 永久不回弹）；收尾认 `touchend`/`touchcancel`/`pointerup` + 900ms 保险丝（**`pointercancel` 不能当收尾**：浏览器一接管滚动就发它，回弹刚起来就被清零，实测只剩 2px）；`prefers-reduced-motion: reduce` 直接不接管；**内层归属避让**（`ownsEdge`：手指底下若还有纵向可滚容器就完全不接管，那是它的事）。原生拉伸救不回来：Chromium 只给**根**滚动器做拉伸/发光，子滚动器即使设 `overscroll-behavior: contain` 也毫无反馈（真机越界拖拽中的截图与静止帧逐字节相同），所以只能自己做。**真机证据**：今日页（可滚 1325px）顶部下拉位移 0→**+44**、底部上拉 0→**−44**，两栏全程 t=0/b=42 与 t=727/b=805 不动，松手逐帧 `3→0→0…`、`−4→0→0…` 归零；注入一个真实纵向滚动元素（高 200px、内容 1200px）后在其上拖：整页 `transform: none`、页 scrollTop 0，手指上滑时内层 scrollTop 0→149 —— 归属内层正确。扫描手机 6 个主路由（今日/设置/待办/网络学堂/服务/收藏）：**没有**纵向内层滚动器，卡片流是横向轮播（`overflow-y: hidden`），故这条避让目前是安全网。
- **落地（同日三修：惯性回弹）**：霖指出「末端回弹不只是到了末端继续滚动才出现，手指快速向下滑一下、页面靠自身惯性滑到顶后也要有」。原实现只在**手指还按着**且继续越界时跟手，手指一抬就再没有反馈。补法：`.content` 上加 `scroll` 监听，由滚动速度判定「惯性撞到末端」——越过末端的那一帧**前一帧**还有速度就弹一下（`translateY` 走 `amp * sin(πt)`、320ms 出去再回来，两端都是 0，不会突然跳；幅度 = 速度 × 9，夹在 8..26px），拖拽中与回弹中都不重复触发，`touchstart` 清空速度状态。两个真机踩出来的坑：①**末帧速度靠不住**——同一段惯性开头 1.6~6.9px/ms，撞到末端那一帧只剩 **0.4**px/ms（已经在减速），只看末帧必然时灵时不灵；改成取滚动中滑动 **300ms 窗口内的峰值速度**（阈值 `FLING_MIN = 0.45`）。②**`scrollHeight` 取整**会让 `scrollHeight - clientHeight` 比真实最大 `scrollTop` 大 1px（实测 room 1143、末帧 1142），判定要留 `EDGE_SNAP = 2px` 余量，否则底端永远判不到。诊断过程留痕：一开始用 CDP 包装 `CSSStyleDeclaration.prototype.transform` 与页面内 rAF 采样器取证，两个都给出假阴性（手写 `transform` 都记不到、回弹期间读到的全是 0），最后靠**在 app 内临时插探针读闭包状态**才定位（读数 `bounce:1 / amp:26 / raf:42`，即回弹确已进入动画，是测量工具坏了）。**真机证据**（<设备>）：惯性滑到顶 位移 0→**+26px**、页 scrollTop 0；惯性滑到底 0→**−26px**、页 scrollTop 1158 = 末端；两者两栏全程 `0-46` 与 `727-805` 不动；越界拖拽回归 位移 **+44px**、松手回 0。截图：惯性到顶峰值帧（内容被顶下 26px，顶栏内可见被糊过的内容鬼影）。
- **落地（同日四修：过冲改成橡皮筋 + 临界阻尼弹簧）**：霖指出「不管什么速度，都是过冲一个固定的距离后弹回，完全没有真实交互感。仿照微信 app 的过冲反馈做」。三修虽已按速度触发，但**幅度被夹在 8..26px 且几乎总是顶到 26**（峰速 ≥ 2.9px/ms 就饱和），回弹又是**固定 260ms 缓动**，拖拽还有**硬上限**（超过 126px 手指行程就不再增加）——三处都在「固定」。改成微信/iOS 那一套：①**橡皮筋**：`rubber(x) = EDGE_MAX·x/(EDGE_MAX+x)`（渐近上限 44px、起点近似 1:1、**永不撞硬墙**），拖得越深越难拉；②**临界阻尼弹簧**收尾 `x'' = -ω²x - 2ωx'`（ω=18 rad/s，半隐式欧拉分 4 小步），**初速度同时决定冲多远与收多快**——松手用「手指速度」（`dragV`，EMA）；惯性撞到末端用峰值速度当初速度，于是**幅度本身就是速度的连续函数**（模型：0.45px/ms→6.7px、1→12.6px、2→19.6px、4.5→28.3px、10→35.2px，可感知时长 304→525ms 同步变化）；③删掉 260ms CSS 缓动与 `sin(πt)` 往返。**符号坑（真机抓到）**：`over` 是「内容往下为正」的视觉量，而 `peak` 是 scrollTop 的速度，顶端撞入时 scrollTop 在减小而视觉上内容要往下走，所以两处都必须是 `springTo0(-peak * 1000)`——写反的话内容被推到顶栏底下、反馈几乎看不见。**边界按方向判**：底端越界是负值，收边界不能一律 `over < 0 → 0`，否则底端第一帧就被清零。**真机证据**（<设备>）：拖拽曲线 `172ms:7.8 → 386:24.4 → 594:30.4 → 811:33.6 → 1218:36.9 → 1849:39.2`（峰值 40.4px，渐近 44 且无硬停点，旧实现超 126px 就卡住）；惯性冲程随速度变（手势 90/160/240ms → **34.9 / 39.1 / 16.1px**，旧实现一律 26px），慢甩不到末端时正确地**不回弹**（顶 280ms 行程只到 scrollTop 361、底 280ms 只到 501）；两端方向正确（顶 **+35.8px**、底 **−29.6px**，松手后均归 0）；同一手指终点、松手速度 0.89/0.22/0.08px/ms 三档的过冲峰值 33.4/33.0/33.1px、可感知回弹 404/381/388ms —— **位移越深时速度差被橡皮筋压平是正确性质**（微信/iOS 同样），速度感主要体现在拖拽过程与惯性撞入。两栏全程 `0-46` 与 `727-805` 不动。**测量坑**：第一版速度对比脚本忘了导航回今日页，跑在设置页（可滚只有 **29px**）上，全部读数 0 属假阴性——测试已加「可滚量自检」；另有一次底端拖拽手触落在**底栏**（clientY 752 落在 727-805）被 `el.contains` 正确挡掉，也是测试坐标的问题。
- **落地（同日五修：卡片流等横向手势不再带动整页）**：霖报「待办界面的卡片流在滑动时会触发整个界面的过冲动画」。根因：卡片流是 `.hw-carousel`（`overflow: hidden` + `touch-action: none` + 组件自己 JS 驱动），**不是原生滚动器**，而 `ownsEdge` 当时只查祖先的 `overflow-y`，认不出它 → 整页在顶端把这个手势接管了（横向滑动也带出纵向过冲）。两层修：①`ownsEdge` 同时看 `touch-action`——祖先若有元素**不允许纵向 pan**（`none` / `pan-x` / `pan-left` / `pan-right`），说明手势已被子组件接管，整页一律不参与（滑块、横向分段器同理）；②**轴向锁定** `AXIS_MIN = 6px`：位移没超过 6px 前一动不动，超过后按 `|dx| > |dy|` 定轴，判为横向就放弃接管并把已有位移弹回——这条覆盖 `touch-action: auto` 的**原生横向滚动器**（如 `.seg-track`），是 touch-action 检查抓不到的。代价是竖向拖拽前 6px 不跟手（换来横向滑动不抖）。**真机证据**（<设备>，待办页 `.content` 可滚 0px、卡片流 `touch-action: none`）：在卡片流上横向 / 竖向 / 斜向滑动三次，**整页位移峰值均为 0px**，而卡片流自身状态三次都有变化（读 `.hw-card` 的 transform 前后不同），两栏恒 `0-46` / `727-805`；回归：卡片流**上方空白处**竖向下拉仍有 **32.2px** 末端反馈，今日页竖向拖拽 **38.8px**、设置页 **38px**，今日页横向滑动整页位移 **0.1px**（可忽略）。
- **落地（同日六修：按霖要求加大回弹力度）**：霖「回弹动画力度较小，放大一些」。三处加大：橡皮筋上限 `EDGE_MAX 44 → 68`、弹簧改欠阻尼 `ζ = 0.42`（`x'' = -ω²x - 2ζωx'`，ω 仍 18 rad/s）让它越过零点反向回弹、反向过冲封顶 `EDGE_BACK_MAX = 26px`（旧实现 `over*dir<0` 直接归零，所以此前根本没有反向回弹）。**真机证据**（<设备>：1400ms 长 swipe + 同帧采样内容位移与两条栏的矩形）：顶/下拉位移 `7.9→25.3→34.9→40.9→45.1→48.2→50.5→52.4→53.9`（峰值 **+54.0px**，旧口径封顶 44）→ 松手 **−18.8px**（新增的反向过冲）→ `5.2 → −0.8 →` 收住；底/上拉对称（峰值 **−52.7px**、反向 **+18.8px**）；**顶栏矩形全程 `0/60`、底栏 `727/805` 不变**（本节 DoD）。截图 `.tmp-shots/r-edge-peak.png`（按住峰值帧：内容被顶下约 54px，顶栏下方留白）。
  **口径以本条为准**：本节 ① 的「阻尼 0.35、封顶 44px」「260ms 缓动归零」以及三修、四修里的幅度模型，均已被六修取代。

- **落地（2026-10-02，性能收尾）**：`.content .list` 加 `content-visibility: auto` + `contain-intrinsic-size: auto 420px`（首帧按 420px 占位，`auto` 记住该元素上次的实测高）；`.dock-msgs` 的消息行同样处理（`auto 44px`）；新增只动 opacity 的 `@keyframes swap-in`（180ms）+ `.swap-in`，网络学堂的作业/文件/通知三个列表挂上，骨架→内容不再硬切；`prefers-reduced-motion` 下不播。护栏 `tools/perf-css-test.mjs`（已登记 guard 链）：断言两个容器都有 `content-visibility` 与占位尺寸、`swap-in` 只动 opacity 且有降级、禁止「伪优化」（滥用 `will-change`、空 `contain`）。
  **真机证据（b13）**：`.content .list` computed `content-visibility: auto`、`contain-intrinsic-size: auto 420px`（`.dock-msgs .dock-msg` 同）。同页对照——服务 → 信息 → 「其他 Info 应用」（内容高 10383px、281 行，正是 b11 基线那一页）：改造前 99 帧 / 均值 8.32ms / 最大 8.6ms / >32ms 0 帧 / long task 0；改造后 101 帧 / 均值 8.30ms / 最大 8.4ms / >32ms 0 / long task 0。这页是卡片网格、没有 `.list`，规则**不适用**，数字持平 = 无回归。
  **长列表 A/B（b14 补上 b13 没取到的数字）**：网络学堂 → 课程通知（42 行 / list 高 4492px / `.content` 可滚 3982px，是真正的长 `.list`）。同页同法两臂（每帧 70px、走满 4200px）：现值 `content-visibility: auto` = 59 帧 / 均值 8.20ms / p95 8.4 / 最大 8.5 / >32ms 0 / long task 0；注入 `.content .list{content-visibility:visible !important}`（等价改造前）并**重新挂载**后 = 59 帧 / 均值 8.24ms / p95 8.4 / 最大 8.4 / >32ms 0 / long task 0。**如实结论**：这台旗舰机上两臂没有可测差异——42 行 / 4492px 远未到渲染成本显形的量级；这条规则的价值在下限设备或更长列表，本机数字只能证明**无回归**。
  **代价也实测了**：首次挂载时列表按 420px 占位、随后长到实测 4492px（`.content` 727 → 4709），是一次性的高度增长（`auto` 会记住实测高），发生在用户滚动之前，不改变滚动位置。

### D4 数字递增
- **改动面**：新建 `components/CountUp.tsx`（或 `lib/useCountUp.ts`）；应用在余额、学分绩点、统计等展示型数字。
- **实现要点**：用 `requestAnimationFrame` 从 0（或旧值）递增到目标，默认 600ms；**每次进入该页面只播一次**（本挂载周期内用 ref 记住），再次进入照常播；`prefers-reduced-motion` 时直接显示终值；数字容器用 `font-variant-numeric: tabular-nums` 避免宽度跳动。
- **护栏**：新增 `tools/countup-test.mjs`——断言用 rAF、时长常量、只播一次、reduced-motion 分支、tabular-nums。
- **DoD**：真机：进入余额/统计页数字递增一次；离开再进入再播一次；无闪烁、无布局跳动。
- **反例**：用 CSS 动画从 0 到目标——DOM 里始终是终值，读屏与复制会拿到错数字。
- **落地（2026-10-02）**：新建 `components/CountUp.tsx`，导出 `useCountUp(target, fmt, ms?)` 与
  常量 `COUNTUP_MS = 600`。口径补齐了三处原实现没有的：①**每次挂载周期只播一次**（`played` ref
  记住；上一版是私有实现且数据一刷新就重播）；②收尾那一帧**显式写终值**（浮点插值的末帧未必正好
  等于目标）；③`null` 目标 → 占位符「—」。`pages/Mine.tsx` 删掉私有副本改用它（余额 / 学分 / GPA
  三处），`.mine-stat-num` 加 `font-variant-numeric: tabular-nums`（原本没有，递增时位宽变化会让
  整块左右抖）。护栏 `tools/countup-test.mjs`：rAF + 默认 600ms + 只播一次 ref + reduced-motion 分支
  + 收尾写终值 + 页面不许再各写私有实现 + 三等宽字；另加两条反例断言（CSS 计数方案 `@property`
  `<integer>` / `counter-reset` 一律判失败——那正是 D4 点名的反例）。
  **反例自检**：注入 `@property --cu { syntax: "<integer>" }` → 护栏红；把 `Mine.tsx` 的 import 换回
  私有 `function useCountUp` → 护栏红（2 条）；删掉 `.mine-stat-num` 的 `tabular-nums` → 护栏红。
  **真机数字（b13，REDMI K90 Pro Max / Android 16 / 400×805 / dev 包）**：进入「我的」，余额节点逐帧
  `¥0.00 → … → ¥2.15` 缓出到终值；离开到「今日」再进**重新从 0 播**（第二段采样完整复现递增序列）；
  同一帧内没有布局跳动（CLS 0.0026，1 次小位移），数字节点宽 49.0–49.3px（`tabular-nums`，漂移 ≤0.3px）。
  **真机才暴露的一个缺陷**：rAF 回调时间戳可能早于 `t0`（同帧取 `performance.now()`），`p` 会成负 →
  首帧闪一个 `¥-0.08`；修法是把 `p` 两侧夹紧（`Math.min(1, Math.max(0, …))`），护栏加断言、反例
  （去掉下界夹紧）已验红。**b14 复验通过**（251 帧采样）：值序列 `¥0.00 → ¥0.07 → ¥0.16 → … → ¥2.15`，全程**未出现负值**，数字节点宽稳定 49.3px。

### D7 待办页点新闻项：本页弹详情
- **已定口径**：不跳新闻页，在当前页右侧弹详情；只有点「全部新闻」才切页；新闻页的侧栏动画一并调整。
- **改动面**：`pages/TasksPage.tsx`、既有详情容器 `components/Details.tsx`、`pages/info/NewsTab.tsx` / `newsSearch.tsx`。
- **实现要点**：PC 的详情面板留 16–24px 页边距（现在是「顶天立地」）；**手机**上用底部抽屉（可下拉关闭），底栏保持可见；新闻页侧栏动画与新的呈现方式对齐。
- **护栏**：断言点新闻项不再触发页面跳转（源码断言）；断言手机走抽屉、PC 有边距常量。
- **DoD**：真机点新闻：当前页出现抽屉、底栏仍在、返回键先关抽屉（依赖 E1）；PC 侧栏有边距（P 批验收）。
- **反例**：手机上也硬套右侧栏（400px 宽放不下）。
- **落地（2026-10-02）**：新增 `components/NewsDetailDrawer.tsx`（详情正文取数、附件下载/预览、
  错误重试、返回键关闭全在组件里），`pages/info/NewsTab.tsx` 里那份内联抽屉（`drawerMaskStyle` /
  `drawerPanelStyle` + 附件下载状态）整体删除、改为引用该组件；`components/HomeWidgets.tsx` 的
  `NewsRows` 增加可选 `onOpen?: (n: NewsItem) => void`——传了就在本页弹（`pages/TasksPage.tsx` 生活
  tab），没传仍是原来的 `navigate("info", { infoNewsId })`（今日页与各类小组件行为不变）；
  「全部新闻 →」保持切页。
  **分层与形态**（`styles/global.css` 末尾）：遮罩 `position: fixed; z-index: 50`（**低于底栏的
  60**，所以手机上底栏一直露着）；PC 右对齐 + `padding: 20px`（= 组件里的 `NEWS_DRAWER_MARGIN`，
  落在 D7 要求的 16–24px 内，取代原来「顶天立地」的 `min(720px,94vw)` + `borderRight: none`，
  面板四周圆角）；手机（`@media (max-width: 839.98px)`）改底部抽屉——`align-items: flex-end`、
  顶部 18px 圆角、上滑进场 `news-drawer-up`、顶部 40×4 下拉把手（拖过 `DRAG_CLOSE_PX = 88px`
  关闭），并用 `--news-drawer-lift: calc(68px + env(safe-area-inset-bottom))` 把面板托到底栏之上，
  内容不会被底栏压住。插件附件下载等能力随组件一起搬走，未丢功能；横向内边距 26px 按 4pt 网格
  收敛到 24px。
  **返回键**：抽屉内 `useOverlayBack(NEWS_DETAIL_OVERLAY_ID, detail !== null, onClose)`（E1 的浮层帧
  机制，未新造一套）→ 返回键先关抽屉、再退页帧；新闻页与待办页共用同一个帧 id。
  **护栏** `tools/d7-news-drawer-test.mjs`（已注册进 `scripts.guard`，共 7 组断言）：①待办页源码里
  不再出现 `infoNewsId` 且 `NewsRows` 收到 `onOpen`、页面渲染了抽屉；②抽屉组件被 NewsTab 与
  TasksPage 共同引用、NewsTab 内联样式清零、`NewsRows` 的 `navigate` 兜底仍在、附件下载/预览/
  打开目录三个能力都只在抽屉组件里；③PC 页边距常量在 16–24px 且与 CSS 的 `padding` 一致；
  ④手机媒体块是贴底 + 顶部圆角 + 上滑动画 + 下拉把手；⑤`useOverlayBack` 接线与浮层帧 id 存在；
  ⑥「全部新闻 →」仍 `navigate("info", { infoTab: "news" })`；⑦遮罩 z-index < 底栏 z-index。
  **反例自检（4 例，全部确认护栏变红后恢复）**：①待办页去掉 `onOpen` → 「没给 NewsRows 传 onOpen」；
  ②手机分支改回右侧栏（`align-items: stretch` + 16px 四周圆角）→ 两条底部抽屉断言变红；
  ③摘掉 `useOverlayBack` → 「没接 E1 的 useOverlayBack」；④遮罩 z-index 提到 70 → 「不低于底栏 60」。
  恢复后护栏重新变绿。
  **真机数字（b13）**：信息 → 新闻点首行 → **本页**出现抽屉（`.news-drawer-panel` 高 628px、顶部 93px），
  顶栏仍是「信息」（没跳页）；遮罩 z-index 50 < 底栏 60、底栏可见（top 727、height>0）；抽屉底 721 ≤ 底栏顶
  727（`--news-drawer-lift` 正好托住，不叠不缝）；按返回键只关抽屉（页面仍「信息」，抽屉与遮罩均消失）。
  截图 `.tmp-shots/d7-news-drawer.png`。**本条未覆盖**：待办页新闻区的行在真机当前数据下是空的（只有
  「全部新闻 →」），待办入口没点着；走的是两端共用的同一个 `NewsDetailDrawer`（新闻页路径），待办入口
  由 `tools/d7-news-drawer-test.mjs` 的源码断言兜底。

### D9 二级菜单展开动画
- **改动面**：`components/ContextMenu.tsx` + `styles/motion.css`。
- **实现要点**：以**手指按点**所在角为原点展开圆角矩形（由点击坐标决定 `transform-origin`：x 小于中点取 left 否则 right，y 同理）；圆角由大收拢到标准值；选项逐个浮现（stagger 约 30–40ms）；MD3 弹性曲线（B2 的过冲令牌）；触发瞬间振动（A2）；只动画 `transform`/`opacity`/`clip-path`，并在低端机上验证 `clip-path` 不卡。
- **护栏**：断言 transform-origin 由点击坐标决定、存在 stagger、只动画 transform/opacity/clip-path、reduced-motion 降级为直接显示。
- **DoD**：真机在四角各长按一次：菜单都从按点方向展开、选项依次出现、无掉帧。
- **反例**：固定从中心放大；用 width/height 做动画。
- **落地（2026-09-30）**：`components/ContextMenu.tsx` 加 `CTX_STAGGER_MS = 36`、按点击坐标算展开原点（`(req.x < vw/2 ? "left" : "right") + " " + (req.y < vh/2 ? "top" : "bottom")` 写进 `transform-origin`）、把步进作为 CSS 变量 `--ctx-stagger` 下发（步进只有一个事实源），`prefersReducedMotion()` 为真时加 `.is-still`；`styles/global.css` 里 `ctx-in` 由「居中 scale(0.96)」改为「`scale(0.86)` + 圆角走 `clip-path`：`inset(0 round 22px)` → `inset(0 round var(--r-md))`」，新增 `ctx-item-in`（`opacity` + `translateY(6px)`）与 `animation-delay: calc(var(--ctx-i) * var(--ctx-stagger))`，曲线换成 B2 会登记的过冲令牌 `--ease-spring`，并补 `@media (prefers-reduced-motion: reduce)` 直接显示。护栏接在 `tools/context-menu-test.mjs`：原点由按点决定、stagger 在 30–40ms 且从 `CTX_STAGGER_MS` 一路接到 CSS、**解析 `ctx-in` / `ctx-item-in` 两个关键帧的全部属性并断言属性集合 ⊆ {opacity, transform, clip-path}**、reduced-motion 两侧齐备、用了 `--ease-spring`。
  **真机数字**（<设备>，菜单盒 148×169 或 148×127）：四个象限各长按一次，`transform-origin` 依次为 `0px 0px`（左上）、`148px 0px`（右上）、`0px 126.531px`（左下）、`148px 126.531px`（右下）——都落在按点那一角；选项动画 `delay` 集合 `[0, 36, 72]`（步进 36ms）；用 CDP `Emulation.setEmulatedMedia` 模拟 `prefers-reduced-motion: reduce` 后重开菜单，选项动画数 **0**（直接显示）；菜单展开期间 63 帧 / 1033ms = **61.0fps**，最大帧间隔 16.8ms，超过 32ms 的帧 **0** 个。
  **返工（2026-09-30，霖 #3）**：`ctx-in`（居中缩放到 `scale(0.86)`）整套换成 `ctx-bloom`（按点液团生长 + 毛玻璃 + 圆角自半宽收拢），选项浮现改 `scale(0.7)→1` 并从面板行程 25% 起延时；细节、曲线来源与真机数字见 §2「A3/D9 返工」。
  **未验**：施工图要求「在低端机上验证 `clip-path` 不卡」——手上只有小米 25102RKBEC（2025 年机型，非低端机），因此只给了帧率与帧间隔数字，没有低端机结论。

## 6. M 批 · 交互逻辑

### E1 返回：新建会话内导航栈
- **现状证据**：全仓 0 处 `pushState/popstate/history.back`——不是「返回跳错页」这么简单，是**根本没有返回栈**。各页返回按钮各自硬编码父页，于是「待办 → 全部作业 → 某作业」返回时掉回待办。
- **已定口径**：会话内自建栈 + 接系统返回键（先关弹层 → 再退栈 → 栈空才退出）。
- **改动面**：新建 `state/navStack.ts`（push / replace / back / canBack / 上限）、路由入口（现有 `navigate` 处收口）、`components/Layout.tsx` 的返回键、各页面的返回按钮改为 `navStack.back()`。
- **实现要点**：
  - push 规则：正常跳转 push；同页仅参数/页签变化用 replace；与栈顶同一路由去重；栈上限约 50（防内存）。
  - 浮层优先级：新增一个轻量「浮层登记」（二级菜单、抽屉、弹层注册自己）——返回时**先关最上层浮层**，再退栈，栈空才退出应用。
  - 系统返回键：先查证 Tauri v2 在 Android 上的返回键事件 API（查不到就用 WebView `popstate` 兜底），把这个结论写进提交信息。
  - 刷新/冷启动清空栈（会话内语义）。
- **护栏**：新增 `tools/nav-stack-test.mjs`——断言栈模块唯一、所有跳转经过它、返回按钮不再硬编码父页、浮层优先关闭、存在栈上限。
- **DoD**：真机：待办 → 全部作业 → 某作业 → 返回，落在「全部作业」（不是待办）；服务页内层同理；打开二级菜单按返回，菜单先关；栈空时按返回退出应用。
- **反例**：只改作业页的返回目标（其他路径照样错）；用 `history.back()` 而栈内并无内容。

- **落地（2026-10-01，dev 包已在 <设备> 走查）**：`state/navStack.ts` 唯一持有 history / 返回键 / 浮层登记，返回键机制三条结论都是这台机器实测出来的，不是查文档推断的：
  1. `TauriActivity.handleBackNavigation = false` → wry 的 `canGoBack()/goBack()` 这条路径**永不执行**，返回键只能落进 `app/tauri/AppPlugin.kt` 的 `OnBackPressedCallback`。
  2. 官方 JS 入口是 `@tauri-apps/api/app` 的 `onBackButtonPress`（内部 `addPluginListener('app','back-button')` → `invoke("plugin:app|register_listener")`）。**ACL 只放行 snake_case**：`register_listener` / `remove_listener` 允许，camelCase `registerListener` 被拒（`Command plugin:app|registerListener not allowed by ACL`）。
  3. `plugin:app|exit` 与 `plugin:window|close` 在本应用 ACL 下**永久被拒**（不存在 `core:app:allow-exit` 这条权限，`plugin:window|close` 同理），所以「栈空退出」必须由本应用自己的命令做：`plugin:onethu-mobile|mobile_exit` → Kotlin `exitApp()` → `activity.finish()`（与 Tauri 自己的 `AppPlugin.exit` 同语义）。
  4. **注册策略：一个 JS 会话只注册一次、永不注销**。曾按「进页面注册、离开注销」写，真机表现为根页按返回毫无反应（面板显示「栈深 1 · 未注册」）；用 CDP 自建 channel 实测：注销掉自己的 channel 后按返回**进程仍然活着**——Kotlin 侧 listener map 里那条 `back-button` 还挂着，注册与注销口径对不上。改成注册一次后根页返回即退出。
  - 真机数字（400×805 CSS / 1200×2608 物理 / dpr 3；系统在**手势导航** `navigation_mode=2`）：三键与手势两种模式都走通「详情 → 全部作业 → 待办 → 今日 → 根页退出」，逐级面板读数 `栈深 4→3→2→1`、`返回键监听 在册`，根页 `栈深 1 · 可返回 否`，再滑一次 **pid 消失**（`pidof` 空、焦点回桌面）。手势验证用 `input motionevent` 注入边缘滑（DOWN x=2 → MOVE 120/380 → UP 420，y=1200）——**返回键事件与全面屏手势不等价**，必须这样验，不能用 `input keyevent` 替代。
  - 浮层优先：`.drawer` 打开时一次边缘滑**只关抽屉**，页面仍停「今日」，app 进程不变。

### E3 手机端「我的」
- **已定口径**：由它取代设置入口；设置成为列表里的一项，**右上角再放齿轮**直进设置（P 批的 PC 侧栏不受影响）。
- **改动面**：新建 `pages/Mine.tsx`、`components/Layout.tsx` 的 `BOTTOM_NAV`（`settings` → `mine`，标签仍叫「我的」）与 `activePages`、路由表、`state/navigation.ts` 补注册。
- **实现要点**：模块与顺序固定为——个人信息（复用 `info-profile` 数据）、校园卡余额、学分与绩点（**当前学期**，页内可切学期）、云盘入口、邮件入口（**显示未读数**）、设置入口；排版照成熟 APP 的三段式（身份区 → 两个关键数字并列 → 入口列表），**保持简洁，不做大锅炖**。
- **护栏**：新增 `tools/mine-page-test.mjs`——断言 `mine` 路由存在且底栏高亮映射包含它、六个模块齐全、设置仍可从两处到达（齿轮 + 列表）。
- **DoD**：真机：底栏「我的」进入新页；六个模块都在且有真实数据；右上角齿轮直达设置；有未读邮件时显示数字。
- **反例**：只是把设置页改了个名；把一堆入口都堆上去。

- **2026-10-01 霖走查后改口径：本条的三段六模块排布被 §12 G3 整体重做**（「我的」页改成学生卡 + 渐变过渡带 + 三数字卡 + 五项服务列表，不再用 SectionHead 分段）。下面这段保留为历史记录，实现细节以 G3 为准。
- **落地（2026-10-01；顺序偏差：本条排在 E9 之后做，实际顺序 E1 → E6 → E9 → E3——E3 的「我的」页头要放齿轮，先把头部布局类定下来可少返工一次）**：`pages/Mine.tsx` + 共用 `lib/grades.ts`（`weightedAverage` / `creditsOf` / `groupBySemester`；成绩页 `ReportTab` 改用同一份，避免两套口径）。三段六模块的**顺序**被 `tools/mine-page-test.mjs` 钉死。个人信息来源与「信息 → 个人信息」同源（`useProfile` + 登录账号兜底），校园邮箱再退一层读 `getCampusSnapshot()` 缓存（**只读快照，不额外发请求**）。
  - 真机数字（<设备>）：个人信息 王傲霖 / 2026010465 / 计算机科学与技术系 / 计算机类 / wal26@mails.tsinghua.edu.cn；校园卡余额 **¥2.15**（与今日页「余额速览」一致）；学分与绩点 **2026-秋 · 1 门课 / 2 学分 / 加权绩点 —**（与信息页成绩栏同学期读数「加权平均 – · 1 门」一致：EX 类不计绩点）；邮箱显示「暂无未读」；齿轮 → `#/settings` 且底栏仍高亮「我的」；云盘行 → `#/cloud`、邮件行 → `#/mail`，两处手势返回都落回「我的」。
  - **未覆盖**：本账号只有 2026-秋 一个学期有成绩，页内学期切换控件因此**没有显示、真机未验**（护栏只断言控件与状态存在）。等多学期数据时补验。
  - 走查中发现（另案，未在本条修）：作业列表行里「忽略」按钮压在行的水平中心上，点行的正中间会弹出「忽略这条作业」确认卡而不是进详情——走查时误触过一次，已在 §11 记一条。

### E4 今日页「时段推荐」
- **已定口径**：编辑界面加「时段推荐」开关，默认开；用户自行编辑（动过排序**或**显隐任一项）后自动关闭，不再打扰；**休息日 = 当天课表无课**（覆盖「上四休三」这类自定义课表），有课即工作日规则。
- **改动面**：`lib/homeCards.ts`（推荐顺序）、`pages/Today.tsx`、今日页编辑界面、新建 `state/homeOrder.ts`（存模式 + 用户顺序 + 是否已手动编辑）。
- **规则表（工作日）**——「优先」是**排序**不是过滤，其余项按原有顺序接着排：
  - 05:00–11:00：上午有课 → 今日课表优先，随后最近通知；上午无课 → 未交作业 → 图书馆预约入口 → 最近通知。
  - 11:00–13:00：校园卡余额优先；随后若下午无课 → 图书馆预约入口。
  - 13:00–17:00：下午有课 → 今日课表优先；无课 → 未交作业 → 图书馆预约入口 → 最近通知。
  - 17:00–20:00：校园卡余额优先；有晚课 → 课表；无晚课 → 未交作业 + 最近通知。（**17–18 并入本段**，霖已定）
  - 20:00–21:00：按上一段同口径并入。
  - 21:00–次日 05:00：未交作业 + 最近通知；**但「课表优先」会动态延长**——若当天晚课还没结束（`now < 当天最后一节晚课的结束时间`），课表继续排在前面，直到晚课结束才让位给「未交作业 + 最近通知」（霖定：看当天晚课到几点）。晚课结束时间取自当天课表最后一节。
  - 因此 18:00 之后的实际规则是「余额 → 有晚课就课表并延长到晚课结束 → 否则未交作业 + 最近通知」，不再是固定切点。
- **规则表（休息日，即当天无课）**：未交作业与各类预约入口优先；饭点（11–13、17–20）优先校园卡余额。
- **实现要点**：排序函数**必须接受一个 now 参数**（便于测试与真机 mock）；跨时段边界要实时重排（每分钟 tick 或页面可见时重算）；开关关闭或已手动编辑时，一律用用户顺序；晚课延长要能跨过 21:00 这个固定切点（把「最后一节晚课的结束时间」作为该段的实际终点）。
- **护栏**：新增 `tools/home-timeorder-test.mjs`——断言时段表**连续覆盖 24 小时无空档**（含 17–18、20–21）、休息日判定取自课表、晚课动态延长（现在 20:30 且晚课到 21:20 时仍走课表优先）、开关与自动关闭逻辑、排序不改变卡片集合（只改顺序）。
- **DoD**：真机用 mock 时间跑 5 个时段，给出每段的顺序快照（DOM 顺序），与规则表逐条对照。
- **反例**：用固定顺序加一个「智能」标签；把不推荐的卡片**隐藏**掉（应为排序）。

- **落地（2026-10-04，dev 包在 <设备> 实测）**：
  - 改法（旧→新）：新建 `state/homeOrder.ts`（纯模块：规则表引擎 + `onethu.home.timeorder.v1` 存 mode / edited / order），`lib/homeCards.ts` 加 `sortPlacedByTimeOrder()` 作为排序入口，`pages/Today.tsx` 渲染改走排序后的 `shownFlat` / `shownMain` / `shownRail`，编辑态加「时段推荐」开关（复用既有 `Switch`，默认开）。旧行为是「一律按布局持久化顺序渲染」，新行为是「推荐开着时只重排展示序，布局表不动」。
  - 角色映射：今日课表 = `classes`、未交作业 = `homework`、最近通知 = `notices`、图书馆预约入口 = `reserve-lib`、校园卡余额 = `balance-strip` 与 `cardEntry`（两张余额卡同角色，按用户相对顺序）、休息日「各类预约入口」= 注册表里全部指向预约页的入口卡。
  - now 参数：`applyHomeTimeOrder(items, { now, events })`；页面每分钟 tick + `visibilitychange` 重算，跨时段边界实时重排。真机 mock 走 `window.__onethuHomeMock = { now, events }`（`events: []` 即休息日）再加 `window.__onethuHomeReeval()`，不写进状态模块。
  - 自动关闭：列内移动 / 跨栏移动 / 隐藏 / 加回四处调 `markHomeManualEdit()`（`mode="manual"`、`edited=true`），此后一律用户顺序；编辑态重新拨开开关即明确要求按时段排（同时清 `edited`），开关不是死键。
  - 「优先」是排序不是过滤：`applyHomeTimeOrder` 稳定重排，未点名卡片保持用户相对顺序跟在后面，卡片集合不变；`off` 卡片不会被推荐放出来。
  - 口径歧义一处（按保守方式实现并留痕）：21:00 之后晚课未结束的延长段，把 594 行的「余额 → 课表并延长到晚课结束」与 593 行的「21:00–05:00 未交作业 + 最近通知」叠加，取「余额 → 课表 → 未交作业 + 最近通知」；晚课结束后回到「未交作业 + 最近通知」（余额不再提前）。
  - **霖的裁定（2026-10-04，逐条确认，无需改动）**：① 21:00 后晚课未结束的延长段**确认**取「余额 → 课表 → 未交作业 + 最近通知」（即上面那处保守读法）；② 规则表里的「校园卡余额」**视为同一角色**——`balance-strip` 与 `cardEntry` 同角色、按用户相对顺序排；③ 休息日「各类预约入口」**认可**现口径（注册表里指向预约页的入口卡）。
  - 护栏：`tools/home-timeorder-test.mjs`（登记 `pnpm guard`，紧跟 `palette-test`）——24 小时逐分钟落段恰一份、切点只有 05/11/13/17/21（17–18、20–21 并入）、五个时段逐段对照规则表、休息日判据为 `events.length === 0` 且不含星期判定、晚课延长跨 21:00、开关默认开与自动关闭、排序集合不变。
  - 反例红点原文（注入 → `exit=1` → `cp` 还原 → md5 逐字节一致 → `exit=0`）：① 把 17:00–21:00 段挖成 17:00–18:00 制造空档 → `AssertionError: 时段表在第 4 段前有空档/重叠`；② 让晚课延长在 21:00 硬切（night 段去掉 `eveningOngoing` 分支）→ `AssertionError: 21:10 晚课未结束 → 课表继续排在前（动态延长）`；③ 直接令 `eveningOngoing=false`（两段一起失效）→ `AssertionError: 17–21 有晚课 → 余额，随后课表`。
  - 真机数字（<设备>，400×805 CSS；本轮 dev 包 APK 18,649,981 字节 / md5 `f0c42efc…`，exe 19,510,272 字节 / md5 `c8140034…`，两者与 b26 的 `0566cf6b…` / `d4833f9d…` 均不同；跨零点按 minuteOfDay 注入）：受控布局用户顺序 `[for-you, notices, cardEntry, classes, reserve-lib, homework, balance-strip, next-class]`（`next-class` 当天无课时整卡不渲染，故不在快照里）；`window.__onethuHomeMock` 逐段读 `.today-col [data-card]` 的 DOM 顺序（原始 buffer `/tmp/b27-e4-snap.log`）：

    | 时段 | now / 课表 | DOM 顺序（角色对齐，省略「其余用户序」前缀内的未点名卡） |
    | --- | --- | --- |
    | 05–11 上午有课 | 07:00 / 08:00–08:45 | classes → notices → 其余 |
    | 05–11 上午无课 | 09:00 / 13:30–15:20 | homework → reserve-lib → notices → 其余 |
    | 11–13 下午有课 | 12:00 / 13:30–15:20 | cardEntry → balance-strip（余额）→ 其余 |
    | 11–13 下午无课 | 12:00 / 08:00–08:45 | 余额 → reserve-lib → 其余 |
    | 13–17 下午有课 | 15:00 / 13:30–15:20 | classes → 其余（未点名卡保持用户序） |
    | 17–21 有晚课 | 18:00 / 19:20–21:20 | 余额 → classes → 其余 |
    | 21–05 晚课延长 | 21:10 / 19:20–21:20 | 余额 → classes → notices/homework → 其余 |
    | 21–05 晚课已结束 | 22:00 / 19:20–21:20 | notices/homework → 其余（余额与课表不再提前） |
    | 休息日 | 09:00 / 无课 | reserve-lib → homework → 其余 |
    | 休息日饭点 | 12:00 / 无课 | 余额 → reserve-lib → homework → 其余 |

  - 编辑态真机读数：`.today-order-row` 存在、`Switch` 的 `aria-checked` 默认 `true`；点一次变 `false`、再点回 `true`；对第二张卡点「上移」后 `onethu.home.timeorder.v1` 变 `{"mode":"manual","edited":true,…}` 且开关 `aria-checked=false`（自动关闭成立），随后已还原原布局与原开关值。
  - **未取到**：K90（现代引擎）本轮不在线（无线 `adb connect` 被目标机拒绝），只跑了 <设备>（WebView 96，观感类结论不作判据）；「校园卡余额 = 两张卡同角色」属实现决定（规则表只写「校园卡余额」），若霖要求只认一张可再收窄。残余：`state/homeOrder.ts:124-190`（`homePriorityGroups` / `applyHomeTimeOrder`）、`pages/Today.tsx:823-825`（三处排序接线）与 `pages/Today.tsx:135-165`（mock 钩子）。

### E5 刷新按钮
- 见 C5（移动端移入顶栏右上角）。本条只是原计划里的交叉引用。
- **状态（2026-10-04 复核）**：交叉引用，**无独立改动**；其指向的 C5 已落地（见 C5「落地」段），故本条**视为完成**。

### E7 二级菜单
- 见 A3（组件与矩阵）与 D9（展开动画）。本条只是原计划里的交叉引用。
- **状态（2026-10-04 复核）**：交叉引用，**无独立改动**；其指向的 A3/D9 已落地（见 §10 第 2 步完成记录与 D9「落地」段），故本条**视为完成**。

### E6 页面归属（底栏高亮）
- **现状证据**：`BOTTOM_NAV` 用 `activePages` 映射高亮；`mail` 等页面不在任何一项里 → 底栏出现「没有任何一项被选中」。
- **改动面**：`components/Layout.tsx` 的 `BOTTOM_NAV`，必要时给 `state/navigation.ts` 补归属。
- **实现要点**：给**每个**可达页面挂一个底栏归属——邮箱/云盘/设置/个人信息/成绩等 → 「我的」；课表/选课/网络学堂及学习类子页 → 「学习」（挂在「待办」项下的既有约定要沿用）；服务类长尾 → 「服务」；收藏与文件夹 → 「收藏」（已有）。原则：任何页面都不允许没有任何一项被选中。登录页、全屏页等可显式列入白名单。
- **护栏**：新增 `tools/bottom-nav-owner-test.mjs`——从页面联合类型/路由表枚举全部页面，断言每个都在某个 `activePages` 里，或有白名单登记。
- **DoD**：真机逐个打开主要页面，底栏都有且**只有一项**高亮。
- **反例**：只补霖举的邮箱一个例子，其他页面照旧。

- **落地（2026-10-01）**：归属表落在 `state/navOwner.ts`——穷尽 `Record<Exclude<Page, plugin:${string}>, BottomNavPage>`（新增路由不补归属编译不过）+ `NO_BOTTOM_NAV` 白名单，底栏高亮只走 `isBottomNavActive` 这一个判据。真机逐项走查：五个一级页（今日 / 待办 / 服务 / 收藏 / 我的）与二级页（设置、生活）**各自恰好一项高亮**（`.bottom-nav-item.is-active` 计数恒为 1）；邮箱 / 云盘 / 设置 / 个人信息 / 成绩等一律归「我的」（`settings` 页高亮「我的」这条在 E3 之后仍然成立）。

### E8 全部作业页
- **改动面**：`pages/learn/AssignmentsPage.tsx` + `global.css`。
- **实现要点**：「已忽略」从 tab 栏移出，顶部改成一个**垃圾桶图标**入口，点开用 A3 的弹层展示忽略列表（可恢复）；tab 栏因此变短。「已逾期」归入「进行中」，但**单独一栏**（模仿旁听作业的分栏规则），并且**计入**「进行中」的计数。
- **护栏**：断言 tab 栏不再含「已忽略」、垃圾桶入口与弹层存在、已逾期单独分栏且计入计数。
- **DoD**：真机：tab 栏明显变短；点垃圾桶能看到忽略列表并能恢复一条；逾期作业在「进行中」下单独一栏。
- **反例**：把已忽略彻底删掉（看不到也恢复不了）。

- **落地（2026-10-04，dev 包在 <设备> 实测）**：
  - 改法（旧→新）：tab 栏 6 项（进行中 / 已逾期 / 已交 / 已批 / 已忽略 / 全部）→ 4 项（进行中 / 已交 / 已批 / 全部）。「已忽略」移到页头 `actions` 的垃圾桶图标 `.asg-trash`（`components/Icons.tsx` 新增 `IconTrash`，图标带条数徽标），点开走 A3 的 `useContextMenu()`：先出单项菜单，进入 `panel` 后是 `IgnoredHwPanel`——订阅忽略快照，逐条按钮调既有 `unignoreHw()` 恢复（数据未删除，仍可找回）。页头 `actions` 的换行写法是必要的：`tools/topbar-chrome-test.mjs` 用 `actions={…}` 到独立 `}` 行的切片判「页面级操作是否留在 actions 里」，单行内联会把后面的 `menu`（含刷新）一起切进去误判。
  - 「已逾期」：`groups.unfinished` 口径改为「未交」（含逾期）→ 计入「进行中」计数；渲染时拆成未到期列表 + `SectionHead「已逾期」` 单独一栏（仿旁听作业分栏，只在 `filter === "unfinished"` 下出现）。
  - 护栏：新增 `tools/assignments-page-test.mjs`（登记 `pnpm guard`）——tab 栏不含「已忽略」与「已逾期」、垃圾桶入口与 A3 弹层存在且恢复走 `unignoreHw`、已逾期单列且计入「进行中」计数；`tools/hw-ignore-test.mjs` 与 `tools/audited-hw-test.mjs` 里指向旧 tab 的两处断言同步改到新入口（忽略语义、旁听分栏口径与其余断言未动）。
  - 反例红点原文（注入 → `exit=1` → `cp` 还原 → md5 逐字节一致 → `exit=0`）：① 删掉 `IgnoredHwEntry` 的返回体（入口整个消失，即「把已忽略彻底删掉」）→ `AssertionError: 顶部没有垃圾桶图标入口`；② 令 `unfinished` 排除逾期（逾期不计入计数）→ `AssertionError: 「进行中」口径必须含已逾期（不能写成 !h.submitted && !isOverdue(h)，那样计数就把逾期漏了）`。
  - 真机数字（<设备>，`#/learn` 的全部作业子页；同一 dev 包，APK md5 `f0c42efc…`；原始 buffer `/tmp/b27-e8.log`）：tab 栏 4 项 `进行中8 / 已交6 / 已批1 / 全部15`（15 = 8+6+1，逾期算在「进行中」里）；`.section-head h2` 为 `已逾期`；`.card.list .row` 未到期 5 / 已逾期 3 / 合计 8。
  - 垃圾桶弹层恢复一条（真实路径，未种数据）：长按首行 `.row` → A3 菜单「忽略 / 提醒 / 收藏」→「忽略」→ 确认层「确认忽略」→ 徽标 `1`、行数 8→7、`onethu.hw.ignored.v1` 记 1 条（id `26ef84e7…664cc`）；点 `.asg-trash` → 菜单标题「已忽略的作业」→ 进 `panel` → 行内出现「<标题>恢复」→ 点「恢复」→ 面板空态「没有被忽略的作业。」、`onethu.hw.ignored.v1` 变 `[]`、徽标消失、行数回到 8。
  - **未取到**：tab 栏「变短」只有 DOM 条目数证据（6→4），未做截图逐帧比对；K90 不在线，未做现代引擎对照；`.asg-trash` 徽标上的 `aria` 读数未单独取。残余：`pages/learn/AssignmentsPage.tsx:164-215`（`IgnoredHwPanel` / `IgnoredHwEntry`）与 `:254`（`groups.overdue`），样式在 `styles/global.css:673-704`（`.asg-trash-count` / `.asg-ignored*`）。
  - **霖的裁定（2026-10-04）**：垃圾桶入口要**一步展开**——点 `.asg-trash` 直接进忽略列表，**不接受**现在的「单项菜单 → panel」两步。→ 需给 A3 `ContextMenu` 增加「直接开 panel」的 API（并回归其它菜单用法，确认没有把别处的单项菜单行为改坏），E8 的护栏与 DoD 相应从「入口存在」升级为「一步进列表」。已列入后续批次（排在 b28 之后，避免与设备/构建争用）。
  - **一步展开落地（b29，提交 `5a3b99fd`）**：A3 `ContextMenu` 新增 `CtxApi.openPanel({ x, y, title, panel })`
    （`components/ContextMenu.tsx`）。底层是给 `CtxRequest` 加可选 `initial?: string`：`openPanel` 合成一个
    「只有 panel 一项」的 request 并把 `initial` 指向该项，`CtxMenu` 的 `panelKey` 初值改成
    `useState<string | null>(req.initial ?? null)`——打开即停在 panel 态；定位 / D9 生长动画 / Esc 与
    返回键 / 点外面即关全复用菜单本体。`api` 引用稳定性未变（`useMemo([openMenu, openPanelMenu, closeMenu])`），
    顶栏「···」依赖的 `isOpen()` 语义不变；其余调用点（右键 / 长按的单项菜单、`item.panel` 二级面板）不传
    `initial`，`panelKey` 仍是 `null`，行为与 b27 / b28 一致。`AssignmentsPage.tsx` 的 `IgnoredHwEntry.open()`
    从 `ctx.open({ items: [单项] })` 改为 `ctx.openPanel({ …, panel: () => <IgnoredHwPanel /> })`，那条单项
    菜单的 `items` / `label` 一并删除（不留死路径）。DoD 从「入口存在」升级为「一步进列表」。
  - 护栏升级：`tools/context-menu-test.mjs` 新增 ⑨c 段（`CtxApi` 有 `openPanel`、`CtxPanelRequest` 存在、
    `initial` 进了 `panelKey` 初值、`open()` 的 items 路径与 `item.panel` 路径都还在、`openPanel(` 只允许
    出现在 E8 一处）；`tools/assignments-page-test.mjs` 的 E8 段改为「入口必须走 `ctx.openPanel`，且不再留
    `items` / `label:"已忽略的作业"`」。
  - 反例红点原文（注入 → `exit=1` → `cp` 还原 → md5 `74c0c77d…` 逐字节一致 → `exit=0`）：
    ① 把 `useState<string | null>(req.initial ?? null)` 改回 `useState(null)` →
    `✗ CtxMenu 没有从 req.initial 初始化 panelKey：一步展开不生效（仍会先出单项菜单）`，同一注入下
    `AssertionError: A3 没有把 initial 落到 panelKey：一步展开不生效`；② 把入口改回 `ctx.open({ items: […] })` →
    `AssertionError: 垃圾桶入口没有走 ctx.openPanel：点开仍会先出「已忽略的作业」单项菜单（霖要求一步展开）`。
  - 真机（<设备>，本批 dev 包 APK 18,654,077 字节 / md5 `5de85f8c…`；原始 buffer `/tmp/b29-e8.log`，
    截图 `/tmp/b29-e8-*.png`）：长按首行 → A3 菜单「忽略 / 提醒 / 收藏」→「忽略」→ 确认层「确认忽略」→
    徽标 `1`、行数 8→7、`onethu.hw.ignored.v1` 记 1 条。**点 `.asg-trash` 一步直达**：`.ctx-item` 计数 `0`、
    `.ctx-panel` 计数 `1`、标题「已忽略的作业」、面板内「实践与思考题03【不计分】 恢复」；点「恢复」→
    空态「没有被忽略的作业。」、存储变 `[]`、徽标消失、行数回到 8。垃圾桶再按一下关掉（`data-ctx-trigger`
    的 K6 切换 `menus 1 → 0`）；长按行仍出三项菜单、顶栏「···」仍是一开一关（`menus 1 → 0`）、
    `.nav-item` 计数 16（没被误触）。

### E9 返回键与收藏按钮的位置统一
- **已定口径**：返回统一左上角，收藏类按钮放右上角避免冲突；移动端本批做，PC 跟随在 P 批。
  ↩ **2026-10-01 霖改口径（见 §12 G1）**：手机端的返回键从页面内容搬到**顶栏**（根页 logo / 非根页「<」），收藏等页面级操作搬进顶栏右上「···」菜单；本条其余结论（PC 位置统一）不变。
- **改动面**：各页面的头部结构 + `global.css`（统一的头部布局类）；移动端顶栏（`components/Layout.tsx`）。
- **实现要点**：把「返回在左上、主操作在右上」固化成头部布局类，页面不再各自摆位；收藏入口同时进二级菜单（A3）。
- **护栏**：断言头部布局类唯一且返回/主操作位置固定；断言不存在把返回放右上的头部。
- **DoD**：真机抽 6 个页面：返回都在左上；有收藏的页面收藏在右上。
- **反例**：只改几个常用页。

- **落地（2026-10-01）**：返回位置统一走 `PageHead` 的 `back={…}` 槽（页面不再各自摆位），`tools/head-layout-test.mjs` 断言不存在把返回放右上的头部。真机抽 6 页量返回键左上角坐标（CSS px，物理 = (CSS+48)×3）：全部作业 **16/74**、作业详情（第一次小作业）**16/83**、课程详情（迈向通用的人工智能）**16/83**、课程通知 **16/75**、课程文件 **16/83**、切换学期 **16/74**——六页同一个 `left=16`、`top` 落在 74–83 的左上角位置，且每页点返回都正确落在「网络学堂」。
  - **走查中发现并已修**：窄屏长标题会把 `.page-head` 的 actions 挤到第二行**左缘**（课程详情实测 `.page-head-main` 占满 358px，收藏星落到 `left=16`）；手机端媒体查询按 M1 定稿本来就允许换行，所以修法不是禁止换行，而是给 `.page-head-actions` 加 `margin-left: auto`——换行后仍贴右缘。修复后同学页「星标 + 刷新」在 `left=268`（右缘 374）、返回键仍 `16/83`；`head-layout-test.mjs` 补了这条断言。也就是说「收藏在右上」在长标题页也成立。

## 7. M 批 · 现有 bug

### F1 选课页评价弹层导致整屏点不动
- **现状证据**：选课页连开两个课程评价并关闭后，除 OH 外整个界面无法点击。
- **改动面**：先复现定位（`pages/zhjwxk/*` 的评价弹层）；大概率是弹层卸载后**遮罩残留**或 `pointer-events` 没恢复。
- **实现要点**：写复现脚本（真机连开两次并关闭）→ 查残留节点（`document.body` 下的遮罩、`elementFromPoint` 命中什么）→ 修卸载逻辑 → 加护栏。
- **护栏**：新增 `tools/modal-cleanup-test.mjs`——断言弹层关闭后 body 无残留遮罩节点、`elementFromPoint` 命中的不是遮罩。
- **DoD**：真机连开 3 个评价并逐个关闭，界面仍可点（探针 `elementFromPoint` 命中可交互元素）。
- **反例**：加一个「关闭时强制 reload」的粗暴兜底。

- **落地（2026-10-02）**：根因不是「没卸载」，而是**受控弹层的 `useExitPhase` 只传了 `onClose`、没传 `open`**——退场动画结束后组件不卸载，留下 `div.xk-mask`（`position: fixed; inset: 0; z-index: 1000`、内联 `animation: m-fade-out …both`、computed `opacity: 0` 而 `pointer-events: auto`），于是「看不见但整屏点不动」。修法三处：①`pages/zhjwxk/Courses.tsx` 两处受控弹层补上 `open` 实参；②`lib/useExitPhase.ts` 加逃生通道——`closingRef` 已置位时再收到关闭请求就立即调 `onClose`，不再早退干等；③退场遮罩 `pointer-events: none`（`ExtHwLoginModal` / `ThemePickerModal` / `TabManageModal` / `Courses.tsx` 共 4 处内联 `maskOut`）。
  **真机数字（b13）**：选课页连开 3 个课程详情弹层并逐个关闭（点遮罩关，每次都走完整的 `m-fade-out`）——每次关闭后 `.xk-mask` 计数 **1 → 0**（3/3 全过），残留节点 0。**可点性用「关完还能再开」证明**：第 2、3 次都成功开出了新弹层——点击必须穿透原遮罩覆盖的屏幕区域才可能命中课程行。
  **真机未覆盖**：当前数据下 DOM 里没有「教学评估」入口（全 DOM 文本匹配 0 处），所以走的是同一个 `Courses.tsx` 受控弹层族的课程详情弹层；评价弹层本体由 `tools/modal-cleanup-test.mjs` 的源码断言兜底。
  **反例自检**：把 `Courses.tsx` 两处 `useExitPhase(onClose, code !== null)` 改回 `useExitPhase(onClose)` → 护栏红（「open 必须是本弹层是否打开的信号」「受控弹层漏传 open」两条），恢复后绿。

### F3 静默重登失效
- **现状证据**：会话过期后，下载/余额/预约/在线服务轮流报「登录会话已失效」，偶尔闪回登录页；用户被迫手动「退出登录再登录」。
- **已定口径**：加「自动重登」开关**默认关**；开启后**加密保存凭据**；**全局拦截 + 每站点限流防抖**（401 → 重登一次 → 重放原请求）。
- **改动面**：设置（新开关 + 清除凭据入口）、凭据存储（方案由执行 agent 查证平台能力后定：Tauri store 或强加密文件）、`lib/transport.ts`（统一拦截点）、`state/exthw.ts`、各站点调用方。
- **实现要点**：
  - **单飞**：同一站点并发多个失败只触发一次重登，其余请求排队等这一个结果。
  - **限流防抖**：每站点重登最短间隔（如 30s）+ 失败退避，避免打卡风暴把账号打封。
  - 重放**原请求**（含 body/headers）一次；再失败才走原有报错路径，并给友好提示。
  - 开关关闭时行为**不得比现状更差**；凭据只存在本机、只在开关开启时保存；日志绝不打印凭据。
- **护栏**：新增 `tools/relogin-test.mjs`——断言单飞、限流间隔、只重放一次、开关默认关、凭据不进日志、存在清除入口。
- **DoD**：真机让会话过期后，分别触发下载/余额/预约：能自动恢复，且日志显示**只重登一次**；关掉开关后与现状一致。
- **反例**：每个失败请求各自重登（并发风暴）；或把凭据明文写进日志/配置文件。

- **落地（2026-10-02）**：新增 `lib/relogin.ts`——站点级机制，**不依赖任何业务模块**：单飞（同站点并发共用同一次重登）、每站点 `RELOGIN_MIN_INTERVAL_MS = 30s` 限流、连续失败按 2 的幂退避封顶 10 分钟；`withAutoRelogin()` 实现「失败 → 重登一次 → 重放原请求一次」（异常路径与 401 路径各一条，各自只重放一次）。`siteOfUrl()` 做 URL→站点映射，**雨课堂显式排除**（只有短信/扫码，没有静默通道，不误报失败）。拦截点选在 `lib/transport.ts` 的 `universalFetch`——全应用唯一的 FetchLike 出口，一处收口；开关关闭时 `withAutoRelogin` 首行直通，语义与改造前一致。凭据复用既有 R21-A AES-GCM 信封（`state/exthw.ts`），本模块只记站点名/耗时/结果，**永不打印账密**。`state/reloginSites.ts` 注册三个 handler：`id`（清华统一认证系：信息门户/在线服务/网络学堂/预约；凭据取 `info.hasIdCredentials()`，没有就放弃）、`tuoj`（CAS 漫游，零凭据）、`tyche`（AES-GCM 信封里记住的账密，没记住就放弃）。设置页「账户」卡加「自动重登」开关（默认关，读同一份 localStorage 真相）与「清除已保存的登录信息」入口。
  **护栏**：`tools/relogin-test.mjs`（已登记 guard 链）**直接加载 TS 源码跑行为自检**：默认关直通（原请求 1 次 / handler 0 次 / 错误原样抛回）、3 并发单飞只 1 次重登、30s 限流挡掉第二次、退避 60s→120s→封顶 10min、异常与 401 两条路径各只重放 1 次、日志不含凭据字样、站点映射（雨课堂 → null）、结构性断言（transport 收口 / 启动接线 / 设置页开关与清除入口）。**反例自检**：拆掉单飞复用 → 红（2 条）；去掉限流判定 → 红（2 条）；恢复即绿。
  **真机数字（b14，18,645,885 字节）**：设置 → 账户，「自动重登」开关初始 `aria-checked=false`（默认关）；点开 → `true` 且 `localStorage["onethu.relogin.auto.v1"]="1"`；再点 → `false` 且键被删除；「清除已保存的登录信息」入口在位（**未按**：按下去会真删本机凭据）。开/关全程 logcat 只有 2 行开关自身的 `[relogin] app …`，**没有任何重登尝试**（无风暴）。截图 `.tmp-shots/f3-relogin-on.png`。
  **dev 取证钩子（b15）**：新增 dev-only「模拟登录状态失效」——`lib/relogin.ts` 里一个一次性标记（只对下一个该站点请求生效），**开关 UI 放在 `components/DevPanel.tsx`**，而 DevPanel 是 `__ONETHU_DEV__ ? lazy(() => import("./DevPanel.js"))` 静态折叠的，正式版里这段代码根本不进产物（护栏加了折叠断言 + 钩子行为断言：标记 → 模拟失败 → 重登 1 次 → 重放走真实请求；第二个请求不再被模拟）。这样验 DoD 不必清掉真实会话。
  **真机复现卡在哪（如实记）**：b15 上开关置开 → dev 面板打标记（`已标记`，截图 `.tmp-shots/f3-dev-arm.png`）→ 依次走 待办 / 信息→新闻 / 网络学堂→课程通知（42 行正常渲染）/ 点刷新 → logcat 里**一条 `[relogin]` 都没有**。说明这几步没有真正发出新的原生请求（页面从本机会话存档/缓存渲染，取到的数据不是网络回来的），也就没有触发点可比。两条替代取证路径：① 霖日常使用中自然遇到一次登录状态过期（下载/余额/预约/在线服务），钩子已就位，届时日志会给出「重登一次 + 重放」；② 霖点头后清掉 dev 应用的会话（会登出一次，随后由自动重登自己恢复——正是要验的东西）。
  **已知边界**：清华系能否重登取决于本机是否存有 id 凭据（`info.hasIdCredentials()`），没有就如实报回原错误，不做猜测。
  **撤除重复层（2026-10-02，b16）**：b15 真机取证确认（卡点见上一段）：待办 / 信息→新闻 / 网络学堂→课程通知（42 行）/ 成绩 / 体测 / 考试 / 刷新全流程里 JS 侧 `[relogin]`（本节此前那层）**一条都没有**，而既有静默重登照常在跑：`LIB-ENSURE 静默重登成功（verifyAndReLogin）`、`SOFT-RELOGIN ok streak=0`。定位结论：既有实现全在 JS 侧——`apps/desktop/src/lib/clients.ts` 的 `libSoftRelogin()`（InfoClient renewers + `http.onAuthRequired` 实例级透明重放，自带 30s 起步 / 封顶 10min 指数冷却）与 `apps/desktop/src/lib/infoLib.ts` 的 `libEnsureSession()`（`hydrateLibCredentials()` + `verifyAndReLogin` + 探针 + `libLogin`）；`packages/core/src/auth/session.ts` 只有注释提到该语义，没有实现。据此判定：本节此前记录的「`lib/transport.ts` 的 `universalFetch` 全局拦截 + URL→站点映射 + `state/reloginSites.ts` 站点 handler」是**重复实现**，选点也不成立（主数据链不经过这条 JS 出口）。b16 已撤除该层：`lib/transport.ts` 复原为 `isTauri ? tauriFetch(url, init) : window.fetch(url, init)` 直通；`state/reloginSites.ts` 删除；`main.tsx` 去掉 `wireReloginSites()` 接线；`lib/relogin.ts` 只留默认关的开关 / 单飞+限流+退避调度器 / 「凭据不进日志」的日志出口 / `clearAllReloginCredentials` / dev 一次性取证钩子。设置页「账户」卡的开关与「清除已保存的登录信息」入口保留，开关本轮**只记录用户偏好**，不接任何真实链路。护栏 `tools/relogin-test.mjs` 收窄为：默认关不调用、开关读写一致、单飞（3 并发 1 次）、30s 限流 + 2 的幂退避封顶 10min、凭据不进日志、dev 钩子一次性且只在 DevPanel、`transport.ts` 不许再有 `withAutoRelogin`/`siteOfUrl`、站点映射与启动接线已撤、本轮未接真实链路、设置页 F3 两行文案不含内部名词。**反例自检 4 例**（拆单飞复用 / 去限流判定 / 删默认关短路 / `transport.ts` 重引 `siteOfUrl`）注入后均 exit=1 变红，恢复后 exit=0 变绿。**上面两段「落地（2026-10-02）」里的机制描述随之作废**（留档对照）。既有静默重登为何仍会「用着用着被踢出登录、需手动再点一次」的诊断进行中；挂点与最终口径等诊断结论，本节不写未定语义。

  **失效诊断结论（2026-10-02，只读取证：代码 + 本机 logcat，未改任何文件）**：既有静默重登「用着用着被踢出、还得手动点一下」的原因是**多因叠加**，按证据强度排：
  1. **判活面太窄（该触发没触发，方向就错）**：`libEnsureSession()` 只验「info 门户是否本人」——`packages/info-lib/src/lib/core.ts:375-392` 用 `object.ryh === helper.userId` 判活，`apps/desktop/src/lib/infoLib.ts:406-410` 据此**直接 return true（什么都做）**。真机 logcat 同一秒里：`21:16:22.742 ILIB GET 200 .../grjbxx → {"object":{"ryh":"…"}}` → `21:16:22.746 SOFT-RECOVER[global] ok (42ms)`，而座位（cab.lib）链路已被 302 进 `authcenter/toLoginPage` + id 登录表单 + `checkSingle`。即：**info 门户活着 ≠ 子服务会话活着**，死掉的座位/教务/learn 会话无人重建。
  2. **轻探针「假活」**：`infoLib.ts:416-431` 的探针只要 200 且 body 含 `XSRF-TOKEN=` 就判活；真机 `21:24:48.901` 同秒 `JAR … XSRF-TOKEN=<同一值>` 与 `info=[]`——`info` 域会话桶是空的，网关发票不等于会话是本人的。且无凭据用户（`hydrateLibCredentials()` 拿不到）会**整个跳过** `verifyAndReLogin`（`infoLib.ts:406`），只剩这条假活探针。
  3. **触发面覆盖不到**：既有触发是「响应体命中登录页特征」（`http.ts:573-579`：`id="sm2publicKey"`/`name="i_pass"`/URL 含 `/do/off/ui/auth/login/`/header `x-onethu-auth-dance`），**且要求该 HttpClient 实例挂过 `onAuthRequired`**；四处入口割裂（HttpClient.text / InfoClient renewers `info/client.ts:273,418-439,460-481` / `learn.reloginHook` `learn/client.ts:504` / 看门狗+10min keepalive `reload.ts:52-82`），跨入口**没有共享单飞**（只有 text() 内部有 `#reloginInflight`，`http.ts:263-266,476-479`）。旁证：本机当前 buffer 里 `SOFT-RELOGIN`=0、`LIB-ENSURE`=0、`relogin`=0、`SOFT-RECOVER`=1。
  > **历史行号注解（2026-10-05）**：`http.ts:573-579` 是 **b16 前**的历史行号；b16 已删除 `packages/core` 的 `#looksLoggedOut` / `#relogin` / `#reloginInflight` / `.onAuthRequired(`（护栏断言必须不存在），判定现由 `lib/libSessionGuard.ts` 的 `looksLibLoggedOut()` 承担（同源判据见 `info/client.ts:809`、`learn/client.ts:110`）。
  4. **双 cookie 仓长期不同步（重登结果落不进权威仓）**：JS jar 的 `wengine_vpn_ticket=wrdvpn1-8a566d…` 与 Rust `[NATIVE-STORE]` 写入的 `wrdvpn1-b401ef7b…` **并存 18 分钟以上**（21:16/21:24/21:34 三处同值复现）。JS→Rust 播种只对 learn 开了 `nativeSeedHook`（`clients.ts:224-230`），`http` 的同类钩子过滤掉基础设施票（`clients.ts:154-161`）；`setPlatformClearCookies` 是**空实现**（`infoLib.ts:127-136`），`nativeCookieClear` 只清 id/oauth（`transport.ts:125-127`）。
  5. **失败后会锁死**：`clients.ts:278` 读 `libSoftCooldownUntil` 在 `await import`(280)/`await libEnsureSession`(281) **之前**、283 才写回 → 五个入口并发可全部穿透守卫；`2 ** streak` 封顶 **600s**。另有 `loginGate` 20s 硬闸（`loginGate.ts:5,11-13` + `infoLib.ts:266`），会让刚登录后 20s 内的 `libEnsureSession` **跳过 verifyAndReLogin**（`infoLib.ts:406`）。这解释「被踢后长时间再也回不来」。
  **一个反向结论（重要）**：代码里**没有**任何「把状态强制打成登出」的分支——`libLogout`/`jar.clear()` 只在显式登出（`infoLib.ts:350-357`、`clients.ts:652-663`），`app.tsx:50 setStatus("logged-out")` 只在交互登录重试失败路径。所以「必须手动点」更可能是**该页自己的错误条 + 手动重试**，而不是真的被登出（待真机补采确认）。
  **最小必要修复（待霖挑，不写未定语义进本节）**：①判活面扩到子服务（alive 后按失联站点追加 learn/card/座位/教务各自漫游，且复用单飞防互烧票）；②探针去假活（改成用该 jar 打一次 info 域本人校验，拿不到结论报 fail）；③统一拦截层**下移到 `nativeFetch`**（含 lib 的 platformFetch），判据改「200 且命中登录/错误页特征」+「Rust 抛错文案」而非 401，并把站点单飞/退避语义搬过去（须先删既有 #looksLoggedOut/renewers 一侧防重复触发）；④消灭双仓不同步（`http` 的 nativeSeedHook 与 learn 对齐、重登成功后统一回灌并校验两仓票值一致，注意 2026-09-17 错播覆盖真票的前车之鉴）；⑤冷却守卫改「先置占位再 await」或抽共享单飞，10min 封顶下调 / 手动点一次即清零。
  **待真机补采**：「被踢瞬间到底是什么 UI」（dump 页面 + 在 `app.tsx:50` 打断点）；`SOFT-RELOGIN` 历史成功记录（buffer 已轮转，需连续抓）；两个 wengine 票谁是权威（在 `[NATIVE-STORE]` 旁并列打 JS jar 同名票值）；`hydrateLibCredentials` 实际走哪支（补 `LIB-CRED` 命中/未命中一行）。

  **修复落地（①②⑤，b16，提交 `f643f654`）**：诊断第 1/2/5 三条已改；③（触发面下移 `nativeFetch`）与 ④（双 cookie 仓同步）本轮不动，残留影响见本段末尾。新增零依赖共享模块 `apps/desktop/src/lib/libSessionGuard.ts`：业务侧（`clients.ts` / `infoLib.ts`）与护栏加载的是同一份实现（`tools/relogin-test.mjs` 用 `node --experimental-strip-types` 直接 import 该 `.ts` 跑行为自检）。
  **① 判活面扩到子服务**：`apps/desktop/src/lib/infoLib.ts:532` 的 `libEnsureSession(opts: { sites? })` 不再在 info 门户 alive 后直接 return true，而是走 `libSessionGuard.ts:58` 的 `ensureLibSessionFlow()`——门户判活之后按「当前失联/需要的站点」逐个补一次重建。站点→入口全部复用既有通道、不自造登录流程（`infoLib.ts:488` 的 `rebuildLibSite()`）：learn=`libRoamLearn()`、card=`helper.loginCampusCard()`、seat=`info.forceEnsure("library")`、libroom（cab.lib / 研讨间）=`helper.loginLibraryRoomBooking()`、zhjw=`roam(helper, "default", infoUrls.JXRL_ROAM_ID)`。站点来源三处：`learn.reloginHook` 点名 learn、card renewer 点名 card、`http.onAuthRequired` 与 `softRecover` 由最后一次失败请求的落点反推（`clients.ts:295` 的 `lostSitesFromLastFailure()` 先 `webvpnDecodeUrl` 解回真实域，再交给 `libSessionGuard.ts:41` 的 `sitesOfLostUrl()`；认不出的域返回空数组，不做猜测）。zhjw 一处边界如实记：`InfoClient.#zhjwRoamed` 一次性标记在这一层不可见，重建结果由下一次业务请求验证。
  **② 探针去假活**：删掉「HTTP 200 且 body 含 `XSRF-TOKEN=` 即判活」那段（旧 `infoLib.ts:416-431`），换成 `libSessionGuard.ts:109` 的 `judgeInfoProbeBody()`——`JSON.parse` 后比对 `object.ryh === 期望学号`（与 `packages/info-lib/src/lib/core.ts` 的 `verifyAndReLogin` 同源）；非 JSON、登录页、缺 `object.ryh`、没有期望学号一律返回 null，调用方按 **fail** 处理。`libSessionGuard.ts:128` 的 `probeInfoOwnSession()` 对 null 与网络异常只重试一次；`XSRF-TOKEN` 降级为「只为取 csrf」。`hydrateLibCredentials()`（`infoLib.ts:394`）拿不到登录信息时补 `LIB-CRED 未命中` 一行（真机可直接确认走哪支），探针分支另有 `LIB-ENSURE 探针拿不到期望学号 → 无明确结论，按 fail 处理` 与 `LIB-ENSURE 探针 info 域本人校验 ok|fail（重试一次后）` 两行。
  **⑤ 冷却守卫前置 + 封顶下调**：原实现「读 `libSoftCooldownUntil` → `await import` → `await libEnsureSession` → 才写回」使五个入口并发可全部穿透；现抽到 `libSessionGuard.ts:223` 的 `runLibSoftSingleFlight()`：同键复用、**同步写占位冷却再 await**、任务串在全局尾链上（链内嵌套内联，防再入自锁死）。30s 起步保留（不放开风控连锤），`2 ** streak` 封顶从 **600s 下调到 120s**（`libSessionGuard.ts:161`；理由是 600s 一次失败即锁死十分钟，正是「被踢后长时间回不来」的成因，120s 仍把自动重试压在两分钟一次）。手动路径清零 `resetLibSoftBackoff()`：交互登录成功（`clients.ts:381`）、2FA 完成（`clients.ts:453`）、用户点错误条「重试」（`Layout.tsx:1274` 经 `clients.ts:312` 的 `clearLibSoftBackoff()`）。
  **真机数字（b16，APK 18,645,885 字节 / exe 19,506,176 字节；两次冷启 + 服务页→成绩→图书馆座位→网络学堂→回今日 走查）**：证据取自 `<设备>` 的 `<adb> logcat -s onethu:V`（tag `onethu`），时间戳引用日志体内的 UTC 时钟（同日历本地时间 22:19，+8）。
    - 冷启 A（14:19）与冷启 B（14:20）各一次：`LIB-CRED 从「记住密码」回灌登录信息（2026****）` → 0.7s 后 `LIB-ENSURE 静默重登成功（verifyAndReLogin）` → 0.3s 后 `LIB-ENSURE 子服务重建 site=learn ok` → `BOOT-T learn.resume(会话活)`；同一次冷启 `BOOT-T READY(总耗时) +1741ms`、`RESUME ok (lib 单管线)`。即冷启时 info 与 learn 两条会话都是死的，新流程在共享单飞内把 learn 一并补建（旧实现是在 `libEnsureSession` 之外单独再调一次 `libRoamLearn`，并发入口会各烧一次票据；card / seat / libroom / zhjw 此前根本没有补建面）。
    - 同一次冷启的 1.5 秒内另有 4 个入口进来，全部被 30s 占位冷却判掉：`SOFT-RELOGIN fail streak=0 cooldown=30s sites=[]`（1 条）+ `… cooldown=29s sites=[]`（3 条）；两次冷启合计 8 条，`streak` 全为 0、`cooldown` 全为 29~30s（旧实现此处会显示 600s 级封顶）。该日志的 `fail` 同时覆盖「真失败」与「被占位冷却判掉」两类，判掉的特征就是 `streak=0` 且 `cooldown` 仍在窗口内。这是「五入口并发穿透 1 次」的真机形态（对应行为断言见护栏 ⑫）。
    - 14:21:46.446 抓到诊断第 1 条那个场景的完整闭环：同秒 `[NATIVE-HOP0] 302 … /authcenter/toLoginPage?redirectUrl=https%3A%2F%2Fcab.lib.tsinghua.edu.cn`，随后 `LIB-ENSURE 子服务重建异常 site=libroom：Failed to get public key.` → `LIB-ENSURE 子服务重建 site=libroom fail` → `SOFT-RECOVER[global] fail (221ms) sites=[libroom]`。旧实现在这一步会因为「info 门户活着」报 `ok (42ms)`（即诊断第 1 条引用的原始日志），现在如实报 fail 并且真的去补建 libroom。
    - 走查各页都从真实网络取到数据（同秒有对应 `[NATIVE-HOP0] 200`）：成绩页 `2026-秋` 1 门 / 2 学分、图书馆座位页 `seat.lib.tsinghua.edu.cn · ISeating` 平面图与座位列表、网络学堂 `2026-2027 学年秋季学期 · 10 门课程` / 42 通知 / 86 文件；全程无 `LIB-ENSURE 门户未活`、无登录页上屏。截图 `.tmp-shots/f3-b16-10.png`（今日，OH 收起、底栏 5 Tab）、`.tmp-shots/f3-b16-12.png`（成绩）、`.tmp-shots/f3-b16-18.png`（图书馆座位）、`.tmp-shots/f3-b16-20.png`（网络学堂）。
    - 走查之后 13 分钟前台静置（22:31–22:44，629 行日志、75 次 `[NATIVE-HOP0]` 原生请求，含周期性日程同步）里 `LIB-*` / `SOFT-*` 一行都没有：会话一直活着时守卫不打日志、也不无差别烧票（负结果同样算证据）。
    - ② 的探针分支本次**没有触发**：本机有「记住密码」，`LIB-CRED` 走命中支 → `verifyAndReLogin` 先行成功，所以真机 logcat 里没有 `LIB-ENSURE 探针 …` 行。该分支的判据由护栏单测覆盖（见下），此处不补造数字。
  **护栏与反例**：`tools/relogin-test.mjs`（已在 `pnpm guard` 链）保留 b16 收窄版全部断言，新增 ⑩① / ⑪② / ⑫⑤ 三组。①：门户 alive 后按点名站点补建且顺序一致、门户没活时 0 次重建、三入口并发只重建 1 次、站点重建失败结果必须 false、`sitesOfLostUrl` 五个域的映射与去重、认不出不猜、五站点入口接线与 `lostSitesFromLastFailure` 透传。②：本人 ryh 判活 / 他人 ryh 判死 / 非 JSON 与缺 ryh 返回「拿不到结论」、XSRF-only 不判活且重试计数为 2 轮、HTTP 500 必 fail、抖动后重试成功、`XSRF-TOKEN=` 不许回到 `infoLib.ts`、`LIB-CRED 未命中` 在位、探针 URL 与 `packages/info-lib/src/constants/strings.ts` 常量同值。⑤：30s 起步与 120s 封顶为常量、五入口并发穿透 1 次、不同键并发时占位冷却必须已前置、链内再入同键不自锁死、失败退避 60s→120s 封顶、手动清零后能再跑、`clients.ts` 无旧冷却变量与 10min 残留、两条手动接线在位。**反例自检 3 例**：② 判据改回「200 + `XSRF-TOKEN=` 即判活」→ exit=1（红在「XSRF-only 不许判 alive」等 3 条）；⑤ 把占位冷却写回挪到 `await` 之后 → exit=1（红在「占位冷却未前置：不同键并发穿透 2 次」）；① 去掉子服务重建 → exit=1（红在五条「站点没有接到既有重建入口」）；三例恢复后 exit=0。门禁四项：`pnpm guard` exit 0（style-scan 输出「无新增违规」）、`pnpm test` 23/23、`apps/desktop` 下 `npx tsc --noEmit` 无输出、`node tools/docs-prose-lint.mjs` 21 份文档 0 处违规。
  **本次没修好的部分（如实记）**：libroom 的补建入口接对了，但本次走查里它仍然失败——`helper.loginLibraryRoomBooking()` 抛 `Failed to get public key.`，而 `loginGate.ts:15` 已注明这正是 id 对设备限流后返回封锁页的表现。所以研讨间 / 公共空间这条在 b16 上仍是 fail（区别是现在会如实报 fail，不再假 ok）。这属于 cab 链自身前置条件失败，与 ③④ 及 id 侧风控同域，本轮没动。
  **③④ 未修与影响**：③ 触发面仍是四处割裂的入口（`HttpClient.text` 的 `#looksLoggedOut` / InfoClient renewers / `learn.reloginHook` / 看门狗 + 10min keepalive），本轮只是把 `libEnsureSession` 与站点重建收进同一把共享单飞；**不经过 `nativeFetch` 的失败仍不会被捕获**。④ 双 cookie 仓仍不同步：b16 真机 logcat 里 JS jar 的 `wengine_vpn_ticket` 与 `[NATIVE-STORE]` 写入的值仍是两个不同值、交集为空（本段不抄录票值），`setPlatformClearCookies` 仍是空实现、native 播种仍只对 learn 开；影响是重登后个别域可能出现「JS 侧已换新票、原生侧仍发旧票」而二次失败。两条留在本节待办。

  **修复落地（③ + ④旁证，b17，提交 `acb18df8`）**：诊断第 3 条（触发面覆盖不到）已改；④ 本轮只加旁证日志、不改行为（双仓同步仍是待办）。③ 的判定层是 `apps/desktop/src/lib/libSessionGuard.ts` 新增的三件套——`isLibAuthFailureText()`（Rust 抛出的鉴权类文案，集合与 `packages/core/src/info/client.ts` 的 `isAuthError` 同值，护栏做同值对照）、`looksLibLoggedOut()`（200 且命中既有登录页判据：body `id="sm2publicKey"` / `name="i_pass"`、落点 URL 含 `/do/off/ui/auth/login/`、header `x-onethu-auth-dance: webvpn-login`）、`withLibAuthRecovery()`（命中 → 重登一次 → 重放一次；重登未成功不重放、把第一个结果/错误原样交回；重放再失效不再重登不再重放）。调用点下移到 `apps/desktop/src/lib/transport.ts`：`nativeFetch` 拆成 `nativeFetchOnce()`（单次请求原语；文本体在内存里原样可取，登录页判据不需要 clone）+ `nativeFetch()`（判定与编排入口，覆盖 lib 的 platformFetch、`http`/`learnHttp`、`session.fetchLike`、venue 等全部原生通道调用方）；恢复动作由 `setNativeFetchAuthHooks()` 注入，传输层不持任何单飞/冷却/退避。业务侧钩子在 `apps/desktop/src/lib/clients.ts`：站点由请求落点 URL 反推（`libSitesOfLostUrl()` 先 `webvpnDecodeUrl` 解回真实域），认不出就不猜、不重登；恢复走 `libSoftRelogin(sites)` → `libEnsureSession()` → `runLibSoftSingleFlight()` 这条上一轮抽好的共享单飞，⑤ 的 30s 起步 / 120s 封顶 / 只重放一次 / 手动清零语义未动。
  **③ 删掉的既有重复触发（file:line 为删除前口径）**：`packages/core/src/http.ts` 的 `HttpClient.#looksLoggedOut()`（旧 573-580 行）、`text()` 里的 `#relogin` + 无条件重放（旧 475-489 行）、字段 `#relogin`/`#reloginInflight`（旧 262-266 行）、实例 `onAuthRequired()`（旧 304-307 行），以及唯一注册点 `apps/desktop/src/lib/clients.ts:306-309` 的 `http.onAuthRequired(… libSoftRelogin(lostSitesFromLastFailure()))`。不删这一侧，同一次「200 + 登录页」会被判两次，且 core 那次不管重登成败都再重放一次。保留的 InfoClient renewers、`learn.reloginHook`、看门狗 + keepalive 是异常驱动的另一类信号，全部同样落在共享单飞上；同一失败命中多个入口时由占位冷却判掉，真重登仍只有一次。
  **真机数字（b17，APK 18,645,885 字节 / exe 19,506,176 字节；证据取自 `<设备>` 的 `<adb> logcat -s onethu:V`，时间戳为日志体内本地时间）**：
    - 冷启 12:04:07.939：learn 主数据链首个请求（经 webvpn 包装的 `learn.tsinghua.edu.cn/f/wlxt/index/course/student/`）302 进登录舞、落点 `id.tsinghua.edu.cn/do/off/ui/auth/login/form/…`（去查询串）200 → `LIB-AUTH 判定登录状态失效 signal=logged-out-page status=200` → `LIB-AUTH signal=logged-out-page sites=[learn] → 共享单飞重登一次`。12:04:08.972 `SOFT-RELOGIN ok streak=0 cooldown=30s sites=[learn]`、同一毫秒 `LIB-AUTH 重登成功 → 重放一次`、12:04:08.991 同一 URL `[NATIVE-HOP0] 200`、12:04:09.037 `BOOT-T learn.resume(会话活)`。**一次失败 = 一次重登 + 一次重放**。该请求此前不在任何判定入口上：它走 lib 的 platformFetch，不经过 `HttpClient.text()`；这正是 ③ 的落点。
    - 12:05:39.793：cab.lib 链 `webvpn.tsinghua.edu.cn/https/<站点码>/authcenter/toLoginPage`（去查询串；`redirectUrl` 指向 `cab.lib.tsinghua.edu.cn`）302 → 12:05:39.875 `LIB-AUTH … sites=[libroom]`。这一次的重登由已在飞的看门狗那条执行（`SOFT-RECOVER[global] fail (236ms) sites=[libroom]`），nativeFetch 侧两次触发都被共享单飞判掉（`SOFT-RELOGIN fail streak=0 cooldown=30s sites=[libroom]` 两条），重建仍停在既有边界 `Failed to get public key.`（b16 已记的 id 设备限流现象）。**同一失败没有第二次重登**。
    - 无风暴：12:04:07–12:05:49 约 102s 窗口内 `LIB-AUTH 判定登录状态失效` 24 条（1 条 `sites=[learn]` 是真失联，另 23 条见下）、`共享单飞重登一次` 1 条、`SOFT-RELOGIN ok` 1 条、`SOFT-RELOGIN fail streak=0 cooldown=30s` 3 条（全部是冷却/在飞判掉）、`SOFT-RECOVER[global]` 1 条、`LIB-ENSURE 静默重登成功` 1 条、`LIB-CRED` 1 条、`重放后仍失效` 0 条。
    - 走查（服务 → 网络学堂 → 图书馆座位）各页均取到真实网络数据：网络学堂 `2026-2027 学年秋季学期 · 10 门课程` / 5 未交 / 42 通知 / 87 文件，图书馆座位 `seat.lib.tsinghua.edu.cn · ISeating` 平面图与座位列表。截图 `.tmp-shots/f3-b17-01.png`（今日）、`.tmp-shots/f3-b17-03.png`（网络学堂）、`.tmp-shots/f3-b17-06.png`（图书馆座位）。
  **④ 旁证（只加一行日志，不改行为）**：`maskLibTicket()` 只留票值前 12 位 + 省略号（前 8 位是固定前缀 `wrdvpn1-`，打 8 位对照不出差异；首版按 8 位打出、真机发现该问题后改为 12 位重出包，脱敏前缀的收尾与本文档同批提交），`nativeFetch` 每次把请求交给原生仓前经 `setNativePreflightProbe()` 回调，只在 webvpn 落点打印 `LIB-JAR wengine_vpn_ticket=<前 12 位>…`，与紧邻的 Rust `[NATIVE-STORE] webvpn.tsinghua.edu.cn` 行并列对照。真机抓到 114 组并列行（同毫秒相邻），两仓票值长期不同：JS jar `wrdvpn1-b498…` vs 原生 `wrdvpn1-2db3…`（整串不抄录）。播种 / 回写 / `setPlatformClearCookies` 一律未动——双仓同步仍是 ④ 的修复、本轮不做。
  **本次仍未收口的（如实记）**：③ 的判据照抄既有集合、不加新判据，代价是它也会命中**登录链自身**的 200 登录页：冷启 24 次判定里 23 次是 `id.tsinghua.edu.cn/do/off/ui/auth/login/{check,checkSingle,form/…}`、`webvpn.tsinghua.edu.cn/login?oauth_login=true`、`madmodel.cs.tsinghua.edu.cn/model-api/auth-login/check` 这类落点。它们反推不出站点 → 一律 `认不出站点 → 不重登`，没有多出重登，但每次冷启多约 23 组 `LIB-AUTH` 日志。风险点：若某条登录链 URL 的字符串里带上表内站点域（例如 `lbredirect?host=cab.lib…`）且响应体/落点命中判据，会误触发一次重登；本轮按「复用既有判据、不另发明」未加登录链主机排除。另 `x-onethu-auth-dance` 只有 tauriFetch 会设，nativeFetch 通道该 header 恒为空（判据保留但此通道不生效）；`authcenter/toLoginPage` 本身不是判据，命中的是它的落点登录表单。此残余与 ④ 双仓不同步一并留在本节待办。
  **护栏与反例**：`tools/relogin-test.mjs`（已在 `pnpm guard` 链）在 b16 收窄版与 ①②⑤ 三组之上新增 ⑬③ / ⑭③ / ⑮④ 三组。⑬：鉴权文案集合与 core `isAuthError` 正则同值、「会话已失效 / 未登录」为真而「HTTP 403 / 文件内容为空」为假、登录页四条判据逐条命中、普通 200 与空响应不命中、core 侧 `#looksLoggedOut`/`#relogin`/`#reloginInflight`/`.onAuthRequired(` 必须不存在。⑭：200+登录页 → 尝试 2 次且恢复 1 次、重放仍失效交回重放结果；Rust 抛错 → 同样 2 次/1 次且交回原始错误；重登失败 → 只尝试 1 次、原样交回第一个错误；普通 200 → 0 次重登 0 次重放；3 并发同一失败经共享单飞真重登 1 次；认不出站点先判空再返回 false；传输层走 `withLibAuthRecovery` 且不含 `runLibSoftSingleFlight`/`libEnsureSession`/`libSoftRelogin` 任何标识符。⑮：`maskLibTicket` 只留前 12 位（长度 13、第 13 位起不出现、空值「(无)」）、LIB-JAR 模板必须走脱敏、探针只在 webvpn 落点、两处 `nativeSeedHook` 与 `setPlatformClearCookies` 未动。**反例自检 4 例**：① 登录页判据放宽到恒真 → 红在「普通 200 不许触发重登或重放」；② 重放改成两次 → 红在「只重放一次（实际 3 次）」；③ 新入口绕过共享单飞自己重登 → 红在「恢复必须走 libSoftRelogin」；④ 删「认不出站点不重登」判定 → 红在「认不出站点必须直接返回 false」；四例恢复后 exit=0。门禁四项：`pnpm guard` exit 0（style-scan 输出「无新增违规」）、`pnpm test` 23/23、`apps/desktop` 下 `npx tsc --noEmit` 无输出、`node tools/docs-prose-lint.mjs` 21 份文档 0 处违规。

  **修复落地（A 站点归属 + B 登录页兜底，b18，提交 `0b19aef2`）**：两条都改在 ③ 已有的判定层里，不新建登录流程，判定集合（`isLibAuthFailureText()` / `looksLibLoggedOut()`，仍要求 `status === 200`）与 ⑤ 的单飞 / 30s 起步 / 120s 封顶 / 只重放一次 / 手动清零语义一律未动。
  **A：站点归属改取「该次请求自身的落点」**。b17 的站点来源是 `clients.ts` 的 `lostSitesFromLastFailure()`——读 `http.lastFinalUrl || http.lastTarget` 这个全局「最后一次失败落点」，任何一次失败都可能把上一次的落点算进来（任务口径里的「归属到无关站点」）。b18 删除该函数（`reload.ts` 的 `softRecover` 同步去掉站点入参，改为 `libEnsureSession()` 不带 `sites`），站点只由 `nativeFetch` 这一次调用的 `url` 反推：`libSessionGuard.ts` 的 `sitesOfLostUrl(url)` 分两层，先 `sitesOfLostHost(url)`（真实域表，正则原样未动），域层认不出才走新增的 `sitesOfLostPath(url)`（路径特征，只作后备，不得前置）。每条路径特征在代码注释里写明真机样本（URL 去查询串）与仓库佐证：
  - `/b/kc/` → `learn`。真机样本 `webvpn.tsinghua.edu.cn/https/77726476706e69737468656265737421fcf2408e297e7c4377068ea48d546d30ca8cc97bcc/b/kc/zhjw_v_code_xnxq/getCurrentAndNextSemester`（b17 OPPO 14:48:47 的 403，去查询串）；该站点码解出 `learn.tsinghua.edu.cn`，仓库佐证 `packages/core/src/learn/urls.ts` 的 `LEARN_CURRENT_SEMESTER()` 与 `packages/info-lib/src/constants/strings.ts` 的 `SEMESTER_LIST_URL` 同为该路径。路径里的 `zhjw` 字样是 learn 的教务代理命名空间，与 `zhjw` 站点无关。
  - `/xklogin.do`、`/xkBks.`、`/js.vjsKcbBs.do`、`/jhBks.` → `zhjw`。真机样本 `webvpn.tsinghua.edu.cn/http/77726476706e69737468656265737421eaff4b8b3f3b2653770bc7b88b5c2d320506b1aec738590a49ba/xklogin.do`（b18 REDMI 15:39:03，去查询串）；该站点码解出 `zhjwxk.cic.tsinghua.edu.cn`，仓库佐证 `packages/core/src/zhjwxk/client.ts` 的路径表。
  - `/portal3rd.do`、`/jxmh_out.do` → `zhjw`。真机样本 `webvpn.tsinghua.edu.cn/http/77726476706e69737468656265737421eaff4b8b69336153301c9aa596522b20bc86e6e559a9b290/jxmh_out.do`（b17 冷启 buffer，去查询串）；该站点码解出 `zhjw.cic.tsinghua.edu.cn`，仓库佐证 `packages/core/src/info/urls.ts` 的 `ZHJW_PREFIX`。
  - **一条口径更正（重要）**：b17 与 §20 把那条 403 记为「落在教务（zhjw）API 上」，按站点码解出的是 `learn.tsinghua.edu.cn`，属 learn 的教务代理命名空间，不是 zhjw API。同时该 403 本来就不进入判定与归属（判定层要求 `status === 200`），所以把 `/b/kc/` 直接翻成 `zhjw` 既与真机样本冲突，也会把 learn 的死会话拿去重建 `zhjw` 的 id-roam。b18 的两条 zhjw 路径特征是给真正的选课链（`zhjwxk.cic`）与 `zhjw.cic` 用的。
  - 新增日志两行：定向 `LIB-AUTH signal=… sites=[…] siteSrc=request`；空集 `LIB-AUTH signal=… sites=[] siteSrc=none 兜底判定 escalate=… reason=… hits=…`。
  **B：站点空集时的全链恢复兜底**（`libSessionGuard.ts` 的 `isLibLoginChainUrl()` / `judgeLibFullChainRecovery()`，接线在 `clients.ts` 的恢复钩子）：站点非空按落点定向重建；站点空集时按四条判据决定是否升级为一次全链恢复（`libSoftRelogin([...ALL_LIB_REBUILD_SITES])`，即门户判活 + 五站点补建，仍走既有共享单飞，未新增第二套单飞或冷却）。判据与理由：① 该次请求 URL 命中登录链自身（路径含 `/do/off/ui/auth/login/`、host 为 `oauth.` / `madmodel.`、或 host `webvpn.tsinghua.edu.cn` 且 path `/login`）→ 不升级，且**不计入**累计——b17 的 20 条冷启空集判定全部是这类落点，正是要挡下的重登风暴来源；② 正在交互登录（复用既有 `loginGate` 冷却与 lib 登录链挂起状态）→ 不升级；③ 其余记一次空集判定，60s 滑动窗口内累计：UI / 会话不在登录页（`session.state !== "ready"`，即本应用自认已登录）→ 立即升级；在登录页但取不到「记住密码」→ 不升级；在登录页且取得到登录信息且累计到 3 次 → 升级。阈值取 3 的理由：单次抖动或一条重定向链可能给出 1–2 次空集判定，三次同窗口才代表真死。
  **真机数字（b18，APK 18,645,885 字节 / exe 19,506,176 字节；证据取自 `<设备>` 的 `<adb> logcat -s onethu:V`，时间戳为日志体内本地时间）**：
    - 冷启 15:35:21–23：`LIB-AUTH 判定登录状态失效 signal=logged-out-page status=200` → `LIB-AUTH signal=logged-out-page sites=[learn] siteSrc=request → 共享单飞重登一次` → `LIB-CRED 从「记住密码」回灌登录信息` → `SOFT-RELOGIN ok streak=0 cooldown=30s sites=[learn]` → `LIB-AUTH 重登成功 → 重放一次` → `RESUME ok (lib 单管线)` / `BOOT-T READY(总耗时) +2246ms`。同 buffer 24 条 `sites=[] siteSrc=none 兜底判定 escalate=false reason=login-chain-page hits=0`。合计：判定 25 / 空集 24 / 兜底升级 0 / 重放 1 / `重放后仍失效` 0 / `SOFT-RELOGIN` ok 1、fail 1（fail 为占位冷却判掉）。
    - A 的真机证据（运行中会话全灭现场，15:39:01–04）：由应用内发一次 `webvpn.tsinghua.edu.cn/logout`（200）制造会话全灭，随后选课页请求的同一次调用链：`[NATIVE-HOP2] 302 … /http/<站点码 eaff4b8b…>/xklogin.do` → `[NATIVE-HOP3] 302 … /https/<站点码 f9f30f88…>/do/off/ui/auth/login/form/<hash>` → `[NATIVE-HOP4] 200 https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/<hash>/1`（去查询串与哈希）→ `LIB-AUTH 判定登录状态失效 signal=logged-out-page status=200` → `LIB-AUTH signal=logged-out-page sites=[zhjw] siteSrc=request → 共享单飞重登一次`。落点归属取的是该次请求自身（`zhjwxk.cic.tsinghua.edu.cn/xklogin.do`），不是最后一次失败落点。同 buffer 定向归属 6 条：`sites=[learn]` 1、`sites=[card]` 2、`sites=[zhjw]` 3。
    - 无风暴：该现场判定 24 / 空集判定 18 / `兜底升级` 0（18 条 `reason=login-chain-page`）/ 真重登 1（`SOFT-RELOGIN ok` 1 与 `LIB-ENSURE 静默重登成功（verifyAndReLogin）` 1）/ 重放 1 / `重放后仍失效` 0；余下 `SOFT-RELOGIN fail` 5 条全部是 `streak=0` 且 `cooldown` 仍在窗口内的占位冷却判掉（未真发请求）。三次运行（两次冷启 + 一次会话全灭）合计 66 条空集判定（24 + 18 + 24）全部 `reason=login-chain-page`、`兜底升级` 0 次，b17 记录的「登录链 200 登录页触发重登」在 b18 真机上未出现。
  **B 的目标真机未达成（如实记）**：运行中会话全灭现场的最后 UI 是登录页（`.login-wrap` 命中，表单已由「记住密码」预填，截图 `.tmp-shots/b18-redmi-after-kill.png`）。同一现场日志里重登在 1.6s 后已成功（`LIB-ENSURE 静默重登成功（verifyAndReLogin）` → `LIB-ENSURE 子服务重建 site=learn ok` → `SOFT-RELOGIN ok streak=0 cooldown=30s sites=[learn]` → `LIB-AUTH 重登成功 → 重放一次`），但 UI 已停在登录页且不再发起数据加载。现场另有一条 `SOFT-RECOVER[global] fail (1ms) sites=[] siteSrc=none`：`apps/desktop/src/state/data.ts` 的兜底恢复落在共享单飞的占位冷却窗口内、1ms 返回 false，随后 `backToLogin()` 把状态置为登出。对照：同一台设备冷启 15:42:41 在 1.66s 内自愈（`RESUME ok`、`BOOT-T READY(总耗时) +1662ms`、判定 25 / 空集 24 / 兜底升级 0 / 重放 1 / `重放后仍失效` 0），UI 回到今日页（截图 `.tmp-shots/b18-redmi-cold4.png`）。结论：B 的判据与登录链闸在真机成立（0 次误升级、真重登 1 次、无第二次重放），但「运行中会话全灭后不落登录页」还差 `state/data.ts` 判失败前区分「被占位冷却判掉」与「真失败」一侧，属本轮范围外，留待下一轮。
  **B 的升级分支真机未触发**：现场所有空集判定都被登录链闸挡下（hits 恒为 0），没有出现「非登录链 + 空集 + UI 不在登录页」的现场；该分支由护栏行为自检覆盖（下）。
  **护栏与反例**：`tools/relogin-test.mjs`（在 `pnpm guard` 链）在 b17 的 ⑬⑭⑮ 之后追加 ⑯（A）与 ⑰（B）。⑯：三条真机样本逐条归属、`/b/kc/` 必须判 `learn`（不许因路径里的 `zhjw` 字样判 `zhjw`）、`sitesOfLostUrl` 必须「先真实域、后路径特征」（结构性断言路径特征不得前置）、认不出的域返回空集不猜、`lostSitesFromLastFailure` 必须不存在、`reload.ts` 的 `softRecover` 不带站点入参。⑰：`isLibLoginChainUrl` 对 id 登录表单 / `check` / `checkSingle`、`oauth.`、`madmodel.`、`webvpn/login` 判真、对业务落点判假；`judgeLibFullChainRecovery` 六条分支（登录链页不升级、交互登录不升级、UI 与会话不在登录页立即升级、登录页取不到登录信息不升级、登录页有登录信息累计 3 次升级、窗口过期清零）；升级必须交既有共享单飞（`libSoftRelogin` → `libEnsureSession`，五站点），业务侧与 `transport.ts` 不许出现第二套单飞 / 冷却标识符；判据为 false 时 0 次恢复。**反例自检 4 例**（注入后 `pnpm guard` exit=1 变红，恢复后 exit=0）：① `isLibLoginChainUrl` 改恒假 → 红在「B 登录链自身落点必须被判掉（否则触发重登风暴）：https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/…」等 7 条；② `sitesOfLostUrl` 后备分支改恒返回 `["zhjw"]` → 红在「A 教务 403 真机样本必须归属 learn（实际 zhjw）」「A 不许因路径里带 zhjw 字样就归属 zhjw」「A 认不出的域必须返回空集（不许猜站点）」「A sitesOfLostUrl 必须「先真实域、后路径特征」，路径特征不许前置」等 8 条；③ 业务侧钩子自建 `hookReloginInflight` 自行重登 → 红在「B 兜底必须交既有共享单飞（libSoftRelogin → libEnsureSession，五站点）」「B 兜底不许在业务侧新建第二套单飞/冷却标识符」等 4 条；④ 升级分支改成 `return false` → 红在「③ 认不出站点后必须转 B 兜底判据（不许直接放弃）」「B 恢复钩子没有接入站点空集兜底判据」「B 判据说不升级时必须直接返回 false（0 次恢复）」等 7 条。门禁四项：`pnpm guard` exit 0（style-scan 输出「无新增违规」）、`pnpm test` 23/23、`apps/desktop` 下 `npx tsc --noEmit` 无输出、`node tools/docs-prose-lint.mjs` 21 份文档 0 处违规。

  **诊断：冷却判掉与真失败的误读面（补采，基线 HEAD `ce87cef0`；本节自身随其后的文档提交入库）**：b18 段记的那处「`state/data.ts` 的兜底恢复落进共享单飞的占位冷却窗口、1ms 返回 `false`」不是孤例。本轮把 `runLibSoftSingleFlight()` 返回值的**全部消费点**做了静态普查（含间接消费、只读日志与清零出口），并在同一台 `<设备>` 上补采两段真机 buffer（其中一段是应用内制造的运行中会话全灭现场）。结论：`false` 有多种来源，**`softRecover` 19 处 / `libEnsureSession` 6 处 / `libSoftRelogin` 4 处 / `runLibSoftSingleFlight` 2 处 / 冷却读数 1 处 / 清零出口 4 处**调用点里，「不能区分」的占绝大多数；其中 **3 处会把用户置为登出**，另有多处把「跳过」打成用户可见的错误条或丢掉一次本可成功的重放。

  **先固定 `false` 的来源**（行号为当前 HEAD，`apps/desktop/src/lib/libSessionGuard.ts`）：
  - `:526` 同键在飞且 `libSoftDepth > 0`（链内再入）→ **同步** `false`：什么都没做，外层链正在处理该会话。这是防自锁的必需语义（`await` 自身即死锁），不可删。
  - `:531` 占位冷却窗口内 → **同步** `false`：什么都没做；窗口由上一次结算写入（`:532` 在 `await` 之前写占位，`:541-548` 结算写 `30s × 2^streak`、封顶 120s）。
  - `:537` / `:549` 任务**真执行**后返回 `false`（或抛错）→ `false` 且 `libSoftFailStreak` 递增。
  - 另有第四个「假失败」来源在任务内部：`apps/desktop/src/lib/infoLib.ts:468`（`loginGate` 20s 冷却内不发起 `libLogin`，直接 `return false`）。它会被单飞按「真失败」结算，**推进退避**。
  - 另有一条**不走共享单飞**的重登出口：`apps/desktop/src/lib/clients.ts:187`（`setZhjwxkReloginHook` → `infoLib.ts:605 libForceRelogin()`，消费点在 `packages/core/src/zhjwxk/client.ts:255-261`）。它的 `false` 只有「真失败」一义，不在本次误读面内，但它也是唯一绕过 30s 冷却的自动重登出口（设计如此，需注明）。

  **日志口径（现状唯一的判别手段，也是误读本身的可观测形态）**：`apps/desktop/src/lib/clients.ts:291` 把两种含义都写成 `SOFT-RELOGIN fail`，只带 `streak` 与 `cooldown`：
  - `fail` + `streak=0` + `cooldown=30s` ⟹ **必然是跳过**（真执行失败一定会把 `streak` 推到 ≥1、冷却变 60s）。
  - `fail` + `streak=k≥1` 有两种可能（真失败 / 窗口内跳过），要看同刻是否有 `LIB-ENSURE 门户未活`、探针 fail、`verifyAndReLogin 失败` 行——本轮真机按此法读。
  - `cooldown` 取整到秒（`Math.ceil`），因此「刚 ok 过」的窗口与「刚起链」都显示 30s，单看该行无法进一步分辨。

  **普查表**（「能否区分」= 拿到 `false` 时能否分辨「跳过」与「真失败」）：

| `file:line` | 消费点 | 拿到 `false` 后做什么 | 能否区分 | 用户可见后果 | 判定 |
| --- | --- | --- | --- | --- | --- |
| `libSessionGuard.ts:154`→`:160` | `ensureLibSessionFlow` 按站点重建（键 `site:<站点>`，`cooldown:false`） | `if (!r) ok = false`，汇总为门户/站点结果 | 不需要（`cooldown:false` 下无冷却跳过；链内再入面可忽略） | 单站点重建失败被如实报 fail | 设计如此 |
| `clients.ts:261` | `learn.reloginHook` → `libEnsureSession({ sites: ["learn"] })` | 交 `packages/core/src/learn/client.ts:506`：`hooked ? fetchCsrf() : null`；为假则落路径一（`/f/login`）与路径二（账密全链） | 不能 | 少一次 learn csrf 重建；两条兜底接住，通常无感，但日志把跳过写成 `LEARN-SILENT 路径零 hook=fail` | 设计如此但需注明（日志口径） |
| `reload.ts:35` | `softRecover` 主体 | `if (ok) persist()`；`:44 return ok` | 不能 | 见下游 19 处 | 真 bug（传播源） |
| `reload.ts:64` | 看门狗 `installAuthWatchdog` | `void softRecover("global")`，返回值丢弃 | 不消费 | 无 | 无影响 |
| `reload.ts:82` | keepalive 10 分钟探针 | 只用于 `if (ok) session.state = "ready"` | 不消费 | 无（失败静默，下一轮再探） | 无影响 |
| `data.ts:251` | `relearnRoamOnce()` 内 `libEnsureSession()` | `if (!ok) return false`，向三条下游传「重建失败」 | 不能 | `data.ts:163` 与 `data.ts:452` 会 `backToLogin()` → **UI 停在登录页** | **真 bug（P0），b19 已修（三态）** |
| `data.ts:159`→`:163` | `useCampusData` 的 `softRecover("campus")` | 不重取数据，直接 `backToLogin()` | 不能 | **UI 停在登录页**（b18 现场） | **真 bug（P0），b19 已修（三态）** |
| `data.ts:447`→`:452` | `useLearnData` 的 `relearnRoamOnce()` | 不重试，直接 `backToLogin()` | 不能 | **UI 停在登录页**（本轮现场） | **真 bug（P0），b19 已修（三态）** |
| `data.ts:369` | `refreshLearnDataSilently()` | `if (await relearnRoamOnce())`，否则 `return null` | 不能 | 后台静默刷新失败，无提示 | 无影响（静默） |
| `data.ts:508` | `useSemesters` 的 AuthRequiredError 分支 | **直接** `backToLogin()`，无任何恢复 | 不涉及（未走单飞） | 学期列表取数失败即置登出 | 真 bug（独立一条，与冷却无关） |
| `data.ts:558` | `softRecover("xk-boot")` | 不重取，落 `:569 setError` | 不能 | 选课页错误条 | 真 bug（提示层） |
| `data.ts:675` | `softRecover("xk-level")`（`void`） | 结果丢弃 | 不消费 | 无（下一轮管线再取） | 无影响 |
| `data.ts:1029` | `softRecover("xk-core")` | `:1030 return []` | 不能 | 右栏课表静默缺失，无提示 | 真 bug（静默丢数据） |
| `data.ts:1872` | `softRecover("xk-queue")` | 落 toast「课余量排队人数获取失败，可稍后重试（登录状态已自动重建）」 | 不能 | 用户可见 toast，且「已自动重建」与事实不符 | 真 bug（提示层） |
| `data.ts:2376` | `softRecover("calendar")` | 落错误条 | 不能 | 日历页错误条 | 真 bug（提示层） |
| `data.ts:2475` | `softRecover("weeksched")` | 落错误条 | 不能 | 周课表错误条 | 真 bug（提示层） |
| `data.ts:2523` | `softRecover("exams")` | 已有 1.5s 延迟重试 + 25s 自动重试兜底（`:2530-2551`，注释已注明「softRecover 又在 20s 节流窗内被跳过」） | 不能，但已绕开 | 最多 25s 后自愈 | 设计如此但需注明（已知绕行） |
| `Schedule.tsx:404` | `softRecover("schedule-win")` | `scheduleAutoRetry()`：4.2s 后重试，最多 2 次 | 不能，但已绕开 | 4.2s 后自愈 | 设计如此但需注明 |
| `DormTab.tsx:69` | `softRecover("dorm")` | 落数据级 `info.forceEnsure("dorm")` 兜底 | 不能 | 多数自愈，否则错误条 | 设计如此但需注明 |
| `LibraryTab.tsx:364 / 390 / 457 / 508 / 549` | `softRecover("lib")` ×5 | 落 `forceEnsure("library")` 兜底 | 不能 | 多数自愈，否则错误条 | 设计如此但需注明 |
| `LibRoomTab.tsx:401 / 434 / 493` | `softRecover("libroom")` ×3 | 落 `forceEnsure("libroom")` 兜底 | 不能 | 多数自愈，否则错误条 | 设计如此但需注明 |
| `tabStates.tsx:29` | 本批移植 tab 共用的 `logTabErr` | `if (ok && retry) retry()`；为假则不自动重拉，错误条留着 | 不能 | 错误条多留一会儿；点「重试」会清零冷却（`Layout.tsx:1274`）后命中活会话 | 真 bug（提示层，影响面大） |
| `tabStates.tsx:43` | 同函数尾部 `await libEnsureSession()` | 返回值丢弃 | 不消费 | 无 | 无影响 |
| `clients.ts:279` | info renewer → `libSoftRelogin()` | 交 `packages/core/src/info/client.ts:428`（`#preRenew`）、`:468`（`#withRenew`）、`:1390`（`#ensureCardSession` 探卡） | 不能 | `:468` 与 `:1390` 直接抛原始 `AuthRequiredError` → 错误条；`:428` 不刷新存活时间戳 → 下个请求再撞（内部被冷却挡回，空转） | **真 bug（P1）** |
| `clients.ts:280` | card renewer → `libSoftRelogin(["card"])` | 交 `info/client.ts:437`（`#preRenew`）、`:493`（`#withCardSession`） | 不能 | 校园卡页错误条，即使重登在飞、1 秒后成功 | **真 bug（P1）** |
| `clients.ts:318` | `nativeFetch` 恢复钩子（站点非空） | 返回值交 `libSessionGuard.ts:307-311`：`recovered=false` → 「重登未成功 → 不重放，原样交回调用方」 | 不能 | 少一次重放；本可直接救回的请求先失败，靠页面兜底/下一次请求 | **真 bug（P1）** |
| `clients.ts:338` | B 兜底全链恢复 | 同上 | 不能 | 同上（b18 真机该支未触发） | **真 bug（P1）** |
| `zhjwxk/client.ts:255-261` | `xkReloginHook`（注入在 `clients.ts:187`） | 为假则回退「清 id/oauth 仓 + 账密直登」 | 不需要（不经共享单飞） | 选课死结时多一次清仓重登 | 不在误读面内（旁证） |
| `clients.ts:291` | `libSoftCooldownLeftMs()` / `libSoftStreak()` 的唯一非测试消费点 | 拼进 `SOFT-RELOGIN fail` 日志行 | 不消费 | 无（只进 `/tmp/onethu-debug.log`） | 设计如此但需注明（误读的可观测形态） |
| `clients.ts:374 / 442 / 514`、`Layout.tsx:1274` | `clearLibSoftBackoff()` / `resetLibSoftBackoff()`（清零方向） | 无 `false` 语义 | 不涉及 | 无 | 无影响 |

  **必须区分 / 区分与否无所谓的分界**：必须区分的是「拿到 `false` 会改变用户看到的状态」的点——`data.ts:251`（其下游 `:163`、`:452` 两处 `backToLogin()`）、`data.ts:159`、`clients.ts:318`、`clients.ts:338`、`clients.ts:279`、`clients.ts:280`、`tabStates.tsx:29`、`data.ts:558 / 1029 / 1872 / 2376 / 2475`；区分与否无所谓的是「返回值本就被丢弃或只用于旁路」的点——`reload.ts:64`、`reload.ts:82`、`tabStates.tsx:43`、`data.ts:675`、`data.ts:369`、`clients.ts:374 / 442 / 514`、`Layout.tsx:1274`；`Schedule.tsx:404`、`DormTab.tsx:69`、`LibraryTab.tsx` 五处、`LibRoomTab.tsx` 三处已有自己的兜底（`forceEnsure` / 延迟重试），属「区分了更好、不区分也自愈」。

  **真机数字（补采，`<设备>` REDMI / dev 包 b18 / `<adb> -s <设备> logcat -d -s onethu:V`；时间戳为日志体内本地时间；URL 一律去查询串与票据；账号与凭据不抄录）**：

  （a）首个既有 buffer（15:42:39–15:52:40，1534 行，即 b18 冷启之后那段）：
  - `SOFT-RELOGIN` 3 条：**真重登 `ok` 1 条**（15:42:40.536 `sites=[learn]`）；**被占位冷却判掉 2 条**（15:42:40.578 `fail streak=0 cooldown=30s sites=[]`、15:44:11.422 `fail streak=0 cooldown=30s sites=[libroom]`）；**真失败 0 条**。判掉的判据：`streak=0` 且 `cooldown` 仍是满值 30s（真执行失败必为 `streak≥1`、`cooldown=60s`）。
  - `SOFT-RECOVER` 1 条：`ok (36ms)`（15:44:11.350，纯判活——同刻没有 `LIB-ENSURE 静默重登成功` 行，说明 `verifyAndReLogin` 报「会话还活着」）。**`fail` 0 条**：任务要求的「`fail` 里 ≤5ms 判掉 / 真失败」两项在本 buffer **均为 0 条分母**，即**未取到**——含那条 `1ms fail` 的 15:39 全灭现场已滚出 buffer（该条以 b18 段记录为准）。
  - 定向归属 `siteSrc=request` **2 条**（`sites=[learn]`、`sites=[libroom]`）；空集判定 **30 条**（全部 `reason=login-chain-page`、`hits=0`）；**兜底升级 0 次**。
  - `LIB-AUTH 判定登录状态失效` **32 条**，配比：30 条走空集不升级、2 条定向；`重登成功 → 重放一次` **1 条**、`重登未成功 → 不重放，原样交回调用方` **31 条**（30 条空集 + 1 条定向被冷却判掉）。
  - 一条**自然发生**的误读实例（15:44:11.357–11.423）：`[NATIVE-HOP0] 302 … authcenter/toLoginPage`（该跳查询串含 `cab.lib.tsinghua.edu.cn`，此处只记主机）→ `.422` 定向 `sites=[libroom]` → `.422` `SOFT-RELOGIN fail streak=0 cooldown=30s sites=[libroom]`（判掉；该 30s 窗口由 `.350` 刚成功的 `SOFT-RECOVER[global] ok` 写入）→ `.423` `重登未成功 → 不重放，原样交回调用方`。随后 15:44:11.506–13.335 cab 链自行走完 oauth/lbredirect → `ic-web/auth/token` → 落地 200，**2 秒内自愈、全程无红条**（该段 `PAGE-ERR` 0 条）。这条同时说明：判掉 ≠ 真失败，且**其用户可见后果可变**（此处只是少一次重放，靠页面兜底接住）。

  （b）运行中会话全灭现场（本轮制造；16:06:01–16:06:06，与冷启同在第二段 938 行 buffer 内）：
  - 制造手法：应用内经 `http_native` 发一次 `https://webvpn.tsinghua.edu.cn/logout`（返回 200，落点为 id 登录表单，票据与查询串不入记录），随后点导航「网络学堂」触发一次数据加载。设备与包名未变（dev 包），未重启 adb server、未动同 server 上的另一台 `<设备>`。
  - 日志（现场段）：`LIB-AUTH 判定` **7 条**；空集判定 **6 条**（`escalate=true` **4 条**，`reason=ui-not-on-login-page hits=1..4`；`reason=login-chain-page` **2 条**）；定向 **1 条**（`sites=[learn]`）；**兜底升级 4 次**；`SOFT-RELOGIN` **7 条**，全部 `fail`——**真失败 1 条**（16:06:02.038 `streak=0→1`、`cooldown=60s`，同刻有 `LIB-ENSURE 门户未活 → 不补子服务重建` 与探针 fail 行可对照）、**跳过 6 条**（16:06:01.119 / 01.350 / 02.035 三条在首次真链在飞期间（`streak=0`）；16:06:02.131 / 02.134 两条在 60s 窗内；16:06:06.070 一条在窗内 `cooldown=56s`）；**真重登 ok 0 条**。`SOFT-RECOVER[global] fail (0ms)` **1 条**（16:06:02.136，判掉；看门狗丢弃其返回值）。
  - 关键链（16:06:06.068–06.083）：定向 `sites=[learn]` → `.070` `SOFT-RELOGIN fail streak=1 cooldown=56s`（**判掉**，与 b18 那条 `1ms` 同型）→ `.077` `重登未成功 → 不重放` → `.083` `PAGE-ERR LEARN-AUTH 会话已失效，需要重新登录` → `state/data.ts` 的 `relearnRoamOnce()`（`:251`，自身不打日志）→ 其中 `libEnsureSession()` 在同一冷却窗内被跳过 → `backToLogin()`（`:452`）。
  - UI（CDP 只读，修前）：`location.hash=#/learn`、`.login-wrap` 计数 **1**、`.nav-item` 计数 **0**；截图确认停在登录页，学号与密码已由「记住密码」预填（不抄录；截图留存于本机临时目录，未入库）。**约 2 分钟后复查仍停在登录页，未自愈。**
  - 对照冷启（16:08:11.5–16:08:15，同一 `<设备>`、`force-stop` + 重启 dev 包）：2.5s 内自愈——`LIB-CRED 从「记住密码」回灌登录信息` → `LIB-ENSURE 静默重登成功（verifyAndReLogin）` → `LIB-ENSURE 子服务重建 site=learn ok` → `SOFT-RELOGIN ok sites=[learn]` → `BOOT-T READY(总耗时) +2519ms`。该段判定 24 条 / 空集 23 条（全部 `login-chain-page`，`escalate=true` 0）/ 定向 1 / 升级 0 / 重登 ok 1 / `SOFT-RELOGIN` 2 条（ok 1、跳过 1）。UI 恢复 `.nav-item=17`、`.login-wrap=0`。
  - **已证实 vs 推测（重要）**：本现场的真重登**同时也在失败**（`LIB-ENSURE verifyAndReLogin 失败：Failed to get public key.`，与 `loginGate.ts:15` 记的 id 设备限流同型），所以本现场**只证实**两件事——①`state/data.ts` 的兜底恢复确实会在冷却窗内被判掉（`0ms` / `cooldown=56s` 两条直接证据），②由此 `backToLogin()` 把 UI 置为登出且 ≥2 分钟不自愈。它**不能**用来断言「重登会成功而 UI 不回翻」——那一半以 b18 已记录的现场（同一机型、重登 1.6s 后 ok、UI 未回翻）为准，本轮**未复现**。两者是同一处误读的两种严重度。
  - **未取到项与原因**：① 「`SOFT-RECOVER` 的 `fail ≤5ms` vs 真失败」分项——首个 buffer 内 `fail` 共 0 条；第二段现场只有 1 条 `fail (0ms)`（判掉），无「真失败」的 `SOFT-RECOVER`。② `data.ts:163`（`useCampusData`）那条 `backToLogin()` 本轮**未复现**——现场走的是 learn 路径（`data.ts:452`），原因是导航顺序先点到「网络学堂」；两条同源，未取到不给数字。③ b18 记录的那条 `SOFT-RECOVER fail (1ms)` 原始行已滚出 buffer，本轮无法重读。

  **最小修复方案（只写方案，本轮不改代码）**：

  **取舍：三态返回 vs 其它做法**
  - **候选 1（推荐）：共享单飞回传三态**。`libSessionGuard.ts` 改为
    `type LibSoftState = "done" | "failed" | "skipped"`、
    `interface LibSoftResult { state: LibSoftState; reason?: "cooldown" | "reentrant"; pending?: Promise<LibSoftResult> }`，
    `runLibSoftSingleFlight()` 返回 `Promise<LibSoftResult>`；另留一个旧布尔语义的薄封装（`state === "done"`）给只关心「拿到 ok 了吗」的调用点。
    改动面：`libSessionGuard.ts`（唯一实现）→ `infoLib.ts:532`（`libEnsureSession` 透传）→ `clients.ts:287`（`libSoftRelogin` 透传）→ `reload.ts:20`（`softRecover` 透传）→ 表内 19 处 `softRecover` 调用点 + `clients.ts:261/318/338` + `data.ts:251`。
    自动锁语义**不变**：`:526` / `:531` 两处仍**同步** resolve（`"skipped"` 依然是同步返回，绝不 `await` 自身）；`pending` 只作观察/等待句柄，且**只允许在守卫之外**被 await。并发/冷却语义不变：占位冷却仍前置写入、`streak` 与 `30s × 2^streak` 公式与 120s 封顶不动、`cooldown:false` 的站点键不动、手动清零不动。既有 ①②③⑤ 的语义因此逐条保持：① 仍按站点补建（只是结果多一档）、② 探针仍按 fail 处理「拿不到结论」、③ 仍「重登一次 + 重放一次」（`"skipped"` 不重放的行为可保留，只是不再把它当失败结论）、⑤ 单飞/退避/清零不动。
  - **候选 2（不推荐）：只加「上次跳过原因」的旁路读数**（如 `libSoftLastSkipReason()`）。改动面最小，但并发下「我刚拿到的 `false`」与「刚记录的那次跳过」不是同一笔调用，会互相污染（A 拿到真失败、B 的跳过把它读成跳过）；要做对就得回到按调用配对的结构，即候选 1。
  - **候选 3（否决）：调用方拿到 `false` 后自查 `libSoftCooldownLeftMs() > 0`**。不成立——真失败也会把冷却推到 30/60/120s（`:541-548`），链内再入时冷却同样大于 0，两种含义都判成「跳过」。列在这里是为了写明不采用的理由。
  - 需要**同时**说明的一点：`"skipped"` 有两种子情形，用户可见的正确反应不同——`reason="reentrant"`（外层链在飞）可以等 `pending` 的真实结果；`reason="cooldown"`（上一次已结算）没有在飞链可等，正确反应是「不当失败、交给下一轮/看门狗/页面兜底重试」。三态把这两种都从「失败」里摘出来即可，无需再细分到用户可见层。

  **必须修点（按优先级；`file:line` 为当前 HEAD）**
  - **P0-1 `apps/desktop/src/state/data.ts:251`**（`relearnRoamOnce` 里 `if (!ok) return false`）：`state === "skipped"` 时不再向调用方传「重建失败」，改为透传三态。修完后：`:163` 与 `:452` 两处不再因跳过而置登出。
  - **P0-2 `apps/desktop/src/state/data.ts:159`**（`if (await softRecover("campus"))`；`:163 backToLogin()`）：只有 `state === "failed"` 才 `backToLogin()`；`"skipped"` 时保留当前页面，交给看门狗 / 下一次业务请求 / 退避窗过期后的第一次请求。
  - **P0-3 `apps/desktop/src/state/data.ts:447`**（`useLearnData`；`:452 backToLogin()`）：同 P0-2。
    P0 三点的用户可见变化：会话全灭时**不再把用户置为登出**；页面停在原地、允许出现可重试的错误条，30–120s 退避窗过后第一次业务请求仍会真正重建。
  - **P1-1 `apps/desktop/src/lib/clients.ts:318`、`:338`**：`"skipped"` 时不再打「重登未成功 → 不重放」，日志模板补 `state=` 与 `reason=`；行为上仍保持「不重放」的保守语义（防恢复环风暴），但不再把它当失败结论。
  - **P1-2 `apps/desktop/src/lib/clients.ts:279`、`:280`**（renewer 桥）：`"skipped"` 时不要把 `false` 交给 core —— `packages/core/src/info/client.ts:468 / 493 / 1390` 收到假值会立刻抛原错。最小改法在**桥内**：`reason="reentrant"` 时 await `pending` 再看结果；`reason="cooldown"` 时返回「会话可用」让 core 走它自己的重试一次（有界：`#withRenew` 只重试一次）。core 侧类型不动，避免波及 `packages/core` 公开 API。
  - **P1-3 `apps/desktop/src/pages/info/tabStates.tsx:29`**：`"skipped"` 时同样允许自动重拉一次（当前只在 `true` 时重拉），或至少不把它当失败。修完后：本批移植 tab 少一次「错误条停在那」。
  - **P2-1 `apps/desktop/src/state/data.ts:558 / 1029 / 1872 / 2376 / 2475`**：统一为「仅 `"failed"` 落错误条 / 落空数组 / 落 toast」；`data.ts:1872` 的 toast 文案一并纠正（现状说「登录状态已自动重建」，与跳过事实不符）。
  - **可选（6 组）**：`data.ts:508`（`useSemesters` 无任何恢复直接 `backToLogin()`，与冷却无关的独立登出面，建议补一次恢复尝试）、`data.ts:2523`、`Schedule.tsx:404`、`DormTab.tsx:69`、`LibraryTab.tsx:364 / 390 / 457 / 508 / 549`、`LibRoomTab.tsx:401 / 434 / 493`——这些已有自己的绕行，改完三态后可收敛成同一句式，不改也不会更差。
  - **不改**：`reload.ts:64`、`reload.ts:82`、`tabStates.tsx:43`、`data.ts:675`、`data.ts:369`、`clients.ts:374 / 442 / 514`、`Layout.tsx:1274`（返回值丢弃或只做清零）。

  **验证办法**
  - 护栏（`tools/relogin-test.mjs`，仍在 `pnpm guard` 链；直接 import TS 源码跑行为，不新增依赖）新增一组 ⑱：
    1. 首次真执行且成功 → `state="done"`；任务返回 `false` → `state="failed"` 且 `libSoftStreak()` 递增、冷却按 `30s × 2^streak` 结算。
    2. 占位冷却写入后的第二次调用 → `state="skipped" reason="cooldown"`，且任务执行计数为 **0**。
    3. 链内再入同键（任务未 settle 时在内层再调同一键）→ `state="skipped" reason="reentrant"`、**同步可取**（断言内层返回值在同一微任务 tick 内已就绪，未 `await` 自身）、不递增 `streak`、外层结果不受影响（死锁即超时判红）。
    4. `cooldown:false` 的 `site:<站点>` 键不受冷却影响（门户 alive 后仍按站点补建）。
    5. 旧布尔薄封装下，b16 的 ⑤ 组断言（五入口并发穿透 1 次、占位冷却前置、120s 封顶、手动清零后能再跑）逐条不变。
    6. 结构性断言：`state/data.ts` 两处 `backToLogin()` 之前必须出现 `failed` / `skipped` 的三态判定；`clients.ts` 的 `SOFT-RELOGIN` 日志模板必须含 `state=`；`packages/core` 的 renewer 类型不得改动（守住「core 公开 API 不动」）。
    7. 反例自检（注入后须 exit=1，恢复后 exit=0）：① 把 `"skipped"` 折回 `false` → 红在「`skipped` 不许等价于失败」；② 把 `:526` / `:531` 改成 `await` → 红在「`skipped` 必须同步返回」「重入不许 `await` 自身」；③ 把 P0-2 的条件写回 `if (await softRecover(...))` 的假值即登出 → 红在「`skipped` 不许触发 `backToLogin`」。
  - 真机（判据可照抄）：
    1. 复现手法（本轮已跑通，属只读取证的可重复路径）：CDP 接 dev 包（`<adb> -s <设备> forward tcp:<端口> localabstract:webview_devtools_remote_<pid>` → 读 `/json/list` → WebSocket `Runtime.evaluate`），执行 `__TAURI_INTERNALS__.invoke('http_native', { input: { url: 'https://webvpn.tsinghua.edu.cn/logout', method: 'GET', headers: {}, body: null, body_b64: null } })`，随后点一次导航触发数据加载。
    2. 判据 A（日志）：出现 `SOFT-RELOGIN state=skipped` 之后，**不许**再出现 `PAGE-ERR LEARN-AUTH` 与状态翻登出的组合；该页错误条允许出现（带重试）。
    3. 判据 B（UI，CDP 只读）：`.login-wrap` 计数恒为 **0**、`.nav-item` 计数 **≥ 1**，且持续 ≥ 60s（覆盖一个退避窗）。对照修前：`.login-wrap=1`、`.nav-item=0`、≥ 2 分钟不自愈。
    4. 判据 C（真失败对照，防「把真失败也吞掉」）：在 id 限流（`LIB-ENSURE verifyAndReLogin 失败：Failed to get public key.`）状态下，`state="failed"` 之后 UI 允许落登录页；若此时仍不落登录页，说明补丁把真失败一起吞了，判红。
    5. 回归：修完后冷启对照段仍须 ≤ 3s 自愈（本轮修前实测 `+2519ms`），`SOFT-RELOGIN ok` 1 条、`兜底升级` 0 次。

  **修复落地（P0：三态 + 不再因冷却判掉而登出，b19，提交 `de8444c1`）**：本轮只改上面「必须修点」的 P0-1 / P0-2 / P0-3 三点，P1 / P2 / 可选一律未动（清单见本节末「残余未覆盖」）。三态按本节「候选 1」原样落地，没有另造第二种 `skipped` 语义。

  **API 与透传（`apps/desktop/src/lib/`）**：`libSessionGuard.ts` 新增 `export type LibSoftState = "done" | "failed" | "skipped"`、`export interface LibSoftResult { state; reason?: "cooldown" | "reentrant"; pending? }` 与 `runLibSoftSingleFlightResult(key, task, opts): Promise<LibSoftResult>`；旧布尔语义保留为薄封装 `runLibSoftSingleFlight(...)`（即 `state === "done"`）。自动锁与限流语义逐条未动：链内再入同键仍**同步** `Promise.resolve({ state: "skipped", reason: "reentrant", pending })`（绝不 `await` 自身）、占位冷却仍在 `await` 之前写入、`30s × 2^streak` / 120s 封顶 / `cooldown:false` 站点键 / 手动清零（交互登录 `clients.ts:452`、2FA `clients.ts:524`、错误条「重试」`Layout.tsx:1274` 经 `clients.ts:383` 的 `clearLibSoftBackoff()`）全部保持。透传链：`infoLib.ts` 新增 `libEnsureSessionResult(opts)`（`libEnsureSession` 保留、签名逐字未动）；`clients.ts` 新增 `libSoftReloginResult(sites)`（`libSoftRelogin` 保留），`SOFT-RELOGIN` 模板改为 `SOFT-RELOGIN state=… reason=… streak=… cooldown=…s sites=[…]`；`reload.ts` 新增 `softRecoverResult(scope)`（`recoverInflight` 类型改 `Promise<LibSoftResult>`；`softRecover` 保留），其 20s 节流窗与单飞冷却一样只产出 `skipped`，不再产出失败。

  **三个 P0 点的实际改法（`apps/desktop/src/state/data.ts`，行号为 b19 HEAD）**：
  - P0-1 `relearnRoamOnce()`（定义 `:265`）：返回类型改 `Promise<LibSoftResult>`；自身 20s 节流窗 → `skipped/cooldown`；`libEnsureSessionResult()` 非 `done` 原样透传；`libRoamLearn()` 抛错或 `learn.resume()` 为假 → `failed`。
  - P0-2 `useCampusData`（调用 `:160`）：`reRoamed.state === "done"` 照旧重拉；否则 `softRecoverResult("campus")`；仅当 `recovered.state === "failed" || reRoamed.state === "failed"` 才 `backToLogin()`（`:175`）；两条都 `skipped` 时落 `PAGE-ERR CAMPUS-AUTH-PENDING` + `setState("error")` + `setError(RELOGIN_PENDING_NOTE)`，复用既有 `ErrorNote` 与它的「重试」，不新增组件。
  - P0-3 `useLearnData`（调用 `:472`）：`done` → 递归 `load()`；`skipped` → `PAGE-ERR LEARN-AUTH-PENDING` + 错误条；其余（`failed`）→ `backToLogin()`（`:485`）。
  - 间接消费点 `refreshLearnDataSilently`（定义 `:384`，判定 `:394`）改为按 `.state === "done"` 判断。
  - 新增用户可见文案 `RELOGIN_PENDING_NOTE`：**「登录状态暂时未能自动恢复，请稍后重试；若持续出现，请到「设置 → 账户」重新登录。」**（不含内部名词；错误条「重试」走既有手动清零出口）。

  **护栏（`tools/relogin-test.mjs`，仍在 `pnpm guard` 链）新增 ⑱ 共 8 组**：⑱-1 真执行成功 → `done`、`streak` 归零；⑱-2 真执行失败（返回假值 / 抛错）→ `failed`、退避按 `30s × 2^streak` 推进；⑱-3 占位冷却窗内 → `skipped/cooldown`，且**任务执行次数为 0**、不推进 `streak`；⑱-4 同键在飞 + 链内再入 → `skipped/reentrant` 且同步可取（内层返回值在外层任务里被 `await`，死锁即判红）；⑱-5 `cooldown:false` 的站点键不受冷却影响；⑱-6 旧布尔薄封装 `done→true`、`skipped→false`（b16 的 ⑤ 组断言逐条仍在跑）；⑱-7 结构性：`data.ts` 三处 P0 分支必须先出现三态判定才可能 `backToLogin()`，`skipped` 分支必须 `return`；⑱-8 出口连线：三个薄封装与真机取证日志模板（`state=` / `reason=`）在位、三态类型定义在 `libSessionGuard.ts`。**反例自检 3 例**（注入 → `pnpm guard` exit=1 变红 → 恢复 → exit=0）：
    ① 把冷却判掉折回 `failed` → 红在「✗ P0 冷却窗内必须是 skipped/cooldown（实际 {"state":"failed"}）」；
    ② 让 `skipped/reentrant` 去 `await` 在飞的那条（`existing.then(…)`）→ 红 6 条，原文含「✗ ⑤ 链内再入同键必须立即回报 false 而不是等待自己（自锁死）」「✗ P0 链内再入同键不许 await 自身（自锁死超时）」「✗ P0 reentrant 必须同步返回…」「✗ P0 链内再入必须是 skipped/reentrant（实际 null）」；
    ③ 把 P0-2 的条件写回假值即登出（`if (recovered.state !== "done" || reRoamed.state !== "done")`）→ 红在「✗ P0-2 只有「两个恢复入口都 failed」才 backToLogin（不许把 skipped 折进来）」「✗ P0-2 campus 登出前必须出现 failed 三态判定（不许拿到布尔 false 就登出）」。
  **门禁四项**：`pnpm guard` exit 0（style-scan 输出「无新增违规」）、`pnpm test` 23/23、`apps/desktop` 下 `npx tsc --noEmit` 无输出、`node tools/docs-prose-lint.mjs` 21 份文档 0 处违规。

  **真机数字（b19，APK 18,645,885 字节 / exe 19,506,176 字节；`<设备>` REDMI / dev 包 `0.10.0-dev` / `<adb> -s <设备> logcat -s onethu:V`；时间戳为设备本地时间）**：
  - **冷启回归**（16:50:12 起 25s 窗口，796 行）：判定 24 / 空集 23（全部 `reason=login-chain-page`、`escalate=false`）/ 登录链判掉 23 / **兜底升级 0** / 真重登 1（`SOFT-RELOGIN state=done streak=0 cooldown=30s sites=[learn]`）/ 冷却判掉 1（`state=skipped reason=cooldown`）/ 再入判掉 0 / 真失败 0 / 重放 1 / `重放后仍失效` 0 / `BOOT-T READY(总耗时) +1331ms` / `RESUME ok (lib 单管线)`。登录链自身的 200 登录页没有触发全链恢复（与 b18 的 25 / 24 / 0 同型，`+1331ms` 优于 b18 的 `+1662ms`）。另有两次冷启撞上设备 DNS 瞬时故障（`dns error: … No address associated with hostname`，同刻 shell `ping` 正常、随后应用内同 URL `status=200`），未能进入回归窗口，不计入。
  - **判据 A / B**（16:56:10.9 起，应用内两次 `logout` 制造运行中登录状态全灭，第二次压进冷却窗；CDP 每 1s 只读快照，共 103s）：`SOFT-RELOGIN state=skipped reason=cooldown` **1688 条**（首条 16:56:12.058 `cooldown=60s`，末条 16:58:40.484 `cooldown=33s`）、`reason=reentrant` 19 条、`SOFT-RECOVER[global] state=skipped reason=cooldown (2ms)` 1 条。该窗口内 `.login-wrap` 恒 **0**、`.nav-item` 恒 **17**、路由 `#/today`，错误条 1 条（文案即 `RELOGIN_PENDING_NOTE`）：**+33s 起到 +103s 连续 70s 停在原页**，既没有因判掉而登出，也没有自动回翻。对照 b18 同型现场是 `.login-wrap=1` / `.nav-item=0`。**判据 A / B 成立**。
  - **判据 C（真失败对照）未成立，如实记**：该现场的真重登**确实在失败**——`16:56:11.186 LIB-ENSURE verifyAndReLogin 失败：Failed to get public key.` → `16:56:11.968 SOFT-RELOGIN state=failed streak=1 cooldown=60s sites=[zhjw]` → `16:57:12.879 state=failed streak=2 cooldown=120s sites=[learn,card,seat,libroom,zhjw]`。**但 UI 没有落登录页**。现场读到的原因：持飞的是 `nativeFetch` 恢复钩子那条链（`clients.ts:328`，也是唯一打 `SOFT-RELOGIN` 的点），它结算失败后立刻写冷却；等人到页面层的 `relearnRoamOnce()` / `softRecoverResult("campus")` 再问时已经落在同一个冷却窗内，只能拿到 `skipped`（`16:56:21.042 PAGE-ERR CAMPUS-AUTH` → `:21.044 PAGE-ERR CAMPUS-AUTH-PENDING`，即 P0-2 的 `skipped` 分支）。第二次击杀后的 84s 同样（`17:07:41.664 SOFT-RELOGIN state=failed streak=1 cooldown=60s sites=[learn]` → `:41.669 PAGE-ERR LEARN-AUTH`，页面层拿到的仍是 `skipped`）。结论：「三态本身按设计工作（判掉不登出）」与「真失败仍能落到登录页」这两条在**同一条运输层持飞的路径上互斥**；要让判据 C 成立，需要让 `skipped` 能带上「上一次真结算结果」，或让页面层在窗过期后拿到一次真执行——那是新的语义设计，本轮不做，也**不得据此宣称真失败已被处理**。
  - **退避窗过后第一次业务请求真执行**（判据正例）：冷启后等过 boot 恢复的 30s 窗（17:07:30 起），`logout` 后立刻进「网络学堂」（learn 模块缓存仍空，必发真实请求）→ 页面层那笔请求经运输层钩子真实执行：`17:07:40.661 LIB-AUTH … sites=[learn] siteSrc=request → 共享单飞重登一次` → `:40.887 LIB-ENSURE verifyAndReLogin 失败：Failed to get public key.` → `:41.663 LIB-ENSURE 门户未活 → 不补子服务重建` → `:41.664 SOFT-RELOGIN state=failed streak=1 cooldown=60s sites=[learn]`。即**不是被冷却判掉**（真发了登录链与探针）。这一笔的失败结果仍走上面的 `skipped` 遮蔽，UI 停在原页 73s 并带重试错误条。
  - **本轮变更新暴露的高频重试环（未修，必须记）**：同一个真失败现场里，今日页的新闻数据源在请求持续失败时进入高频重试——`PAGE-ERR TODAY-NEWS Failed to get public key.` **844 条 / 16:56:21.323→16:58:40.392（139s，均值约 6 条/s、峰值 8 条/s）**，同 buffer 渲染期诊断 `TODAYCAL-SHAPE`（`data.ts:2375`）**1272 条**。定位：环在 `data.ts:2719-2775`（`useTodayNewsFeed`）与渲染期日志 `data.ts:2375`，**这两处本轮一行未动**；b18 在同一现场会因为 `backToLogin()` 立刻卸载今日页而中断该环，本轮不再登出后它就持续跑（判据 A 的代价）。把场景收窄成「登录状态已死但页面留着」时环与 P0 无关地存在：纯 learn 页单次击杀现场 895 行 / 85s，无一条 `TODAY-NEWS`。留作独立的 P2 级修复（先收住 hook 的重复触发），本轮不动。

  - **真失败的瞬时性（补采一条）**：现场结束后约 12 分钟再冷启（17:19:59）已回到 `LIB-ENSURE 静默重登成功（verifyAndReLogin）` → `SOFT-RELOGIN state=done streak=0 cooldown=30s sites=[learn]` → `RESUME ok (lib 单管线)` → `BOOT-T READY(总耗时) +1498ms`，UI `#/today` / `.login-wrap=0` / `.nav-item=17` / 错误条 0，`PAGE-ERR TODAY-NEWS` **0 条**（说明那个高频环绑定的是「请求持续失败」这一状态，会话一恢复即消失，不是轮次本身固有的）。

  **残余未覆盖（本轮一行未动，行号为 b19 HEAD）**：P1-1 `clients.ts:328 / :348`（`skipped` 时不再打「重登未成功 → 不重放」、日志补 `state=` / `reason=`）；P1-2 `clients.ts:280 / :281`（renewer 桥）；P1-3 `pages/info/tabStates.tsx:29`；P2-1 `data.ts:591 / 1062 / 1905 / 2409 / 2508`（统一为「仅 `failed` 落错误条 / 空数组 / toast」，含 `:1905` 的 toast 文案）；可选 6 组 `data.ts:541`、`data.ts:2556`、`Schedule.tsx:404`、`DormTab.tsx:69`、`LibraryTab.tsx:364 / 390 / 457 / 508 / 549`、`LibRoomTab.tsx:401 / 434 / 493`。另：③ 的两条残余（登录链自身 200 登录页仍会命中判据、`x-onethu-auth-dance` 在 `nativeFetch` 通道恒空）与 ④ 双仓不同步照旧；上一条「判据 C 的 `skipped` 遮蔽」与「今日页高频重试环」是本轮新增的两条待办。

  **修复落地（止血 + C：真失败浮出，b20，提交 `0bb2bac8`）**：本轮只做两件事——今日页新闻源高频重试环的**止血**、以及判据 C（`skipped` 不再遮蔽真结算）。P1 / P2 / 可选一行未动（清单见本段末）。不新增依赖；`packages/core` 的 renewer 类型与逻辑、`lib/transport.ts` 的调度状态、`nativeSeedCookies` / `setPlatformClearCookies`、①②③⑤ 与 b19 落地的语义（`skipped` 同步 resolve、冷却 `30s × 2^streak` / 120s 封顶、手动清零、`loginGate`、只重放一次）逐条未动。

  **止血 · 根因（`file:line` 为修复前口径，`apps/desktop/src/state/data.ts`）**：`useTodayNewsFeed` 的 `load` 依赖数组里带着 `data`（`}, [status, subsKey, feedKey, data]);`），而失败分支读的是**闭包里的旧 `data`**（`if (silent && data !== null) return;`）。当缓存是陈旧值时形成自持续环：挂载 effect `setData(缓存)` → `load(true)`（这次调用的闭包 `data` 仍是 `null`）→ 失败分支 `setData(null)` → `data` 变化 → `load` 身份变化 → effect 重跑 → 回到第一步。环的周期 = 一次失败请求的往返（b19 现场实测 258–332ms、均值约 280ms），与 `PAGE-ERR TODAY-NEWS` 844 条 / 139s（约 6 条/s、峰值 8 条/s）一致。
  **止血 · 修法**：① 失败判定改读 `dataRef`，不再读闭包 `data`（`data.ts:2875`）；② `load` 依赖数组去掉 `data`，只剩 `[status, subsKey, feedKey]`（`data.ts:2899`）——环的触发条件本身被拆掉；③ 失败后不再无条件立刻重拉，改由**定时器驱动**的有界退避重试（`data.ts:2880-2890`）；④ 同 `feedKey` 同一时刻只许一份在飞：模块级 `todayNewsInflight` + `fetchTodayNewsOnce()` 单飞（`data.ts:2780-2823`），并发重复请求被合并；⑤ 日志按「失败串」去重（`todayNewsLogged`，`data.ts:2782` / `:2870-2873`），退避等待期间不再每次重试刷一条，成功即复位；⑥ 渲染期不再写日志（见下）。
  **止血 · 退避参数（纯函数 `apps/desktop/src/state/todayNewsRetry.ts`）**：起步 `TODAYNEWS_RETRY_BASE_MS = 3s`（新闻卡是静默兜底数据，一次抖动不该让卡片空白半分钟；3s 已比现场 280ms 一轮低一个数量级）、每失败一次翻倍、封顶 `TODAYNEWS_RETRY_MAX_MS = 60s`（新闻源失败不阻塞任何登录状态恢复，最多一分钟一份请求，稳落在「每分钟个位数」内；取 60s 而非 ⑤ 的 120s，避免一次短暂恢复被错过两分钟）、单串上限 `TODAYNEWS_RETRY_MAX_ATTEMPTS = 6`（= 首次 + 5 次重试，t=0 / 3s / 9s / 21s / 45s / 93s，此后停下等页面重挂载或用户手动刷新）、`attempt = 0 → 0ms`（**健康路径零延迟、观感不变**；成功即复位到 0）。抽成零依赖纯函数的理由是这条修复里只有它需要确定性判定：护栏直接 import 跑断言，不必依赖真实计时器睡眠（hook 侧只把返回值交给 `setTimeout`）。
  **止血 · 今日校历渲染期日志（同一现场的第二条噪声源）**：`TODAYCAL-SHAPE` 1272 条 / 139s 来自该行在**渲染期**每次渲染写一条，而 `nodes` 之所以不是数组，是因为 `cacheFetch(TODAYCAL_KEY, () => infoHelper.getCalendar())` 把原始 `CalendarData` 对象写进了 `todaycal` 键、读侧又直接当数组用。b20 拆成两个键：`todaycal:src` 存原始对象（`data.ts:2367` / `:2387`），`todaycal` 只存数组节点；状态初始化与 effect 读缓存时按 `Array.isArray` 消毒、非数组视为无缓存重取；形状日志移入 `useEffect` 并用 `shapeLoggedRef` 去重（`data.ts:2423-2427`）。
  **判据 C · 守卫外结算**：新增零依赖模块 `apps/desktop/src/state/libSoftSettle.ts`——`settleLibSoftPending(r)`（`:37`）**只在 `state === "skipped" && reason === "reentrant" && pending` 时**在**守卫之外** await 那条在飞链、拿它的真结算（`failed` / `done`），`cooldown`（没有 `pending`、没人持飞）原样透传、一毫秒都不等；`libSoftPageAction(r)`（`:51`）把三态映射为三种页面动作（`done` → 重取一次 / `failed` → 落登录页 / 其余 → 留可重试错误条）。接线四处：`data.ts:167`（`useCampusData` 的 `relearnRoamOnce()`）、`data.ts:173`（同处的 `softRecoverResult("campus")`）、`data.ts:290`（`relearnRoamOnce` 内的 `libEnsureSessionResult()`）、`data.ts:489`（`useLearnData`）。`data.ts:181` 的登出判据仍是 `recovered.state === "failed" || reRoamed.state === "failed"`；`cooldown` 的 `skipped` 分支必须先原地 `return`，落 `RELOGIN_PENDING_NOTE` 错误条（与 b19 同语义）。**守卫内部一行未动**：链内再入仍同步 resolve、占位冷却仍前置、`30s × 2^streak` / 120s 封顶 / `cooldown:false` 站点键 / 手动清零全部保持。
  **护栏与反例**：`tools/relogin-test.mjs`（仍在 `pnpm guard` 链）新增 ⑲ 共 **49 条**断言、6 组——⑲-1 退避纯函数（零延迟起步 / 3s→6s→12s→24s→48s→封顶 60s / 成功复位 / 有界 / 非法入参）；⑲-2 判据 C 行为（`reentrant + pending` 的 `failed` 与 `done` 两种真结算都用；`cooldown` 与「`reentrant` 但无 `pending`」必须零等待，用「在飞任务未 settle 时返回值已就绪」判自锁）；⑲-3 动作映射；⑲-4 结构性：`await pending` 只许出现在守卫之外、且在 `reentrant + pending` 早返回之后；⑲-5 结构性止血：单飞 Map、退避接线、日志去重、`load` 依赖数组不含 `data`；⑲-6 结构性：今日校历读侧 `Array.isArray`、两键分离、渲染期无 `logLine`。**反例自检 3 例**（注入 → `node --experimental-strip-types tools/relogin-test.mjs` exit=1 → 从本机备份 `cp` 回来后 exit=0，md5 逐一核对）：
    ① 把 `cooldown` 的 `skipped` 折成失败（`if (recovered.state !== "done" || reRoamed.state !== "done")`）→ 红在原文「✗ C：只有真 failed 才 backToLogin（cooldown 的 skipped 分支必须先原地 return）」等 3 条；
    ② 让 `nextTodayNewsRetryDelay` 恒返回 0 → 红在原文「✗ 止血：连续失败必须按 3s×2^(n-1) 递增（实际 0,0,…）」等 3 条；
    ③ 把 `await pending` 挪进守卫内（改成守卫里自等 `existing`）→ 红在原文「✗ C：守卫内部绝不许 await pending（等自己 → 自锁）」等 7 条。
  **门禁四项**：`pnpm guard` exit 0（style-scan 输出「无新增违规」）、`pnpm test` 23/23、`apps/desktop` 下 `npx tsc --noEmit` 无输出、`node tools/docs-prose-lint.mjs` 21 份文档 0 处违规。

  **真机数字（b20，APK 18,645,885 字节 / exe 19,506,176 字节；同一机型 dev 包 `0.10.0-dev`；证据取自 `<adb> logcat -s onethu:V`，时间戳为设备本地时间；原始 buffer 留在工作机临时目录的 `b20-*.log`，下列 grep 判据可原样复核；URL 一律去查询串、票据不抄录）**：
  - **止血**（对照 b19 基线：`PAGE-ERR TODAY-NEWS` 844 条 / 139s、`TODAYCAL-SHAPE` 1272 条，同 buffer 总行数 42141）：b20 连做**五个「登录状态已死」窗口**（应用内经 `http_native` 打 `webvpn/logout`，含单次击杀、连击制造真失败、死状态下硬刷新；窗口时长 25s–128s，合计约 500s）——`PAGE-ERR TODAY-NEWS` **0 条**、`TODAYCAL-SHAPE` **0 条**；新闻源请求 URL（`/b/info/xxfb_fg/xnzx/template/more`）在 `[NATIVE-HOP0]` 里每个窗口只出现 **1 次**（b19 同窗口 846 次），且这几次都是 `200`（482ms / 518ms）；同窗口总行数 546 / 1604 / 1900 / 1903 / 1948（b19 同型窗口 42141 行 / 139s，约 20 倍下降）。`TODAYCAL-SHAPE` 判据另取结构化断言（护栏 ⑲-6）：旧写法把原始对象写进 `todaycal` 的路径已不存在。
    **未取到的对照（如实记）**：b20 的会话在这五个窗口里都在数秒内自愈（`LIB-ENSURE 子服务重建 site=learn ok` / `site=zhjw ok` → `SOFT-RELOGIN state=done`），所以 b19 那个环的前置条件「新闻请求**持续**失败」没能长时间维持——**没有取到同条件的持续失败对照**，上面那 1 次/窗口只证明「没有并发重复请求」，不能单独证明「重试从未发生」。止血的直接证据是「环的触发条件已从代码里消失」（`load` 不再依赖 `data`，护栏 ⑲-5 结构性断言）+ 退避纯函数的确定性断言 + 反例 ②。
  - **判据 C · 赢到的窗口是 `reentrant`（21:40:45 现场，路由 `#/schedule`）**，完整链：`LIB-AUTH signal=logged-out-page sites=[zhjw] siteSrc=request → 共享单飞重登一次` → `LIB-AUTH signal=… sites=[learn] siteSrc=request → 共享单飞重登一次` → `SOFT-RELOGIN state=skipped reason=reentrant sites=[learn]` → `LIB-AUTH 重登未成功 → 不重放，原样交回调用方` → `PAGE-ERR CAMPUS-AUTH 会话已失效，需要重新登录` → `SOFT-RECOVER[global] state=skipped reason=reentrant (2ms)` → 真结算 `LIB-ENSURE 子服务重建 site=zhjw ok` → `SOFT-RELOGIN state=done streak=0 cooldown=30s sites=[zhjw]` → `LIB-AUTH 重登成功 → 重放一次`。页面层的 `softRecoverResult("campus")` 带回 `pending`，b20 在**守卫之外** await 到真结算 `done`，按动作映射走「重取一次」：**页面没落错误条、也没登出**。UI（CDP 每 1s 只读，70 个采样）：路由恒 `#/schedule`、`.login-wrap` 恒 0、`.nav-item` 恒 17、`.error-note` 恒 0。对照 b19 同型现场：页面层拿到的是 `skipped`，落 `CAMPUS-AUTH-PENDING` + `RELOGIN_PENDING_NOTE` 错误条——即这条改动在真机上把一次「错误条停留」变成了「静默恢复」（`failed` 分支的登出行为由护栏 ⑲-3 与反例 ① 覆盖）。
  - **判据 C · `failed` 分支本轮真机仍未取到（如实记）**：另一窗口的真结算确实是 `failed`（21:35:28 `LIB-ENSURE 门户未活 → 不补子服务重建` → `SOFT-RELOGIN state=failed streak=1 cooldown=60s`），但该窗口里 P0 页面层三处出口**一次都没触发**（`CAMPUS-AUTH` / `LEARN-AUTH` 均 0；页面层只出现 `PAGE-ERR CARD`，那是卡片的行内错误、不在 P0 出口内），UI 停在今日页约 2 分钟、`.login-wrap` 0、无登录页。原因与 b19 记录一致：页面层要拿到真 `failed`，前提是它那笔恢复在守卫里**持飞**；若运输层那条链先结算失败并写冷却，页面层随后拿到的只能是 `skipped/cooldown`。
  - **A/B 回归**：`cooldown` / `reentrant` 跳过场景下 `.login-wrap` 恒 0、`.nav-item` 恒 17、路由不变，连续观察 70–150s（每条窗口都有 ≥60s 覆盖一个退避窗的采样）——「判掉不登出」成立。**错误条 `RELOGIN_PENDING_NOTE` 未取到**：正因为上面那条（死登录状态窗口里 P0 页面层出口没触发），没有 `CAMPUS-AUTH-PENDING` / `LEARN-AUTH-PENDING`，也就没有那一行错误条；该分支由护栏 ⑲-3 的动作映射与反例 ① 覆盖，真机标「未取到」。
  - **一条判读口径修正（对后续复验有用）**：`.login-wrap` 同时是**启动页**的类名（`App.tsx:98`，文案「正在恢复登录状态…」），所以 b18 / b19 记的「`.login-wrap=1` 即落登录页」必须按文案与表单区分。b20 三次硬刷新现场都出现过 3 个采样（约 3s）的 `.login-wrap=1`，文案正是「正在恢复登录状态…」且 `input[type=password]` 计数为 0——**不是登录页**。
  - **冷启回归（健康会话，三次专用冷启 + 两次击杀后重启的 incidental 采样）**：三次专用冷启的配比完全同型——判定 26 / 24 / 18，空集 25 / 23 / 17（**全部 `reason=login-chain-page`、`escalate=false`**），登录链判掉同数，**兜底升级 0 次**，真重登 1 次（`SOFT-RELOGIN state=done streak=0 cooldown=30s`），冷却判掉 1 次（`state=skipped reason=cooldown`），再入判掉 0，真失败 0，`重登成功 → 重放一次` 1 条，`重放后仍失效` 0 条，`PAGE-ERR TODAY-NEWS` 0 条、`TODAYCAL-SHAPE` 0 条；`RESUME ok (lib 单管线)` 照常在位。**`BOOT-T READY(总耗时)` 五个样本：+1970 / +1686 / +1827 / +1823 / +1768ms（中位数 1823ms）**，对照 b19 记录的两个样本 +1331 / +1498ms。**这一项不敢宣称「未变慢」**：五个样本系统性比 b19 记录慢 300–500ms，而本轮 4 个文件的改动没有一行落在 boot / `resume` 路径上（`BOOT-T READY` 之前只多求值两个零依赖小模块），增长全在网络段（`BOOT-T learn.resume(会话活)` 本体 1228–1393ms、`info.resume` 紧随）；无法排除设备/网络状态的影响（本轮在同一台设备上制造了大量死登录状态现场，`learn.resume` 段本身就是走 `verifyAndReLogin` 的网络链）。**如实标为「未取到等条件对照」**，五个样本与判据留在原始 buffer 里供复核。
  - **未取到项与原因**（除上面两条）：「b19 那条 `SOFT-RECOVER[global] fail (0ms/1ms)`」在 b20 的窗口里未复现（本轮的 `SOFT-RECOVER` 只有 `skipped reason=reentrant` 与 `ok` 型）；`reason=reentrant` 的消费者全部是运输层（`SOFT-RELOGIN` / `SOFT-RECOVER`），P0 页面层出口的真机触发面本轮只有 1 次（见上），样本不足以给分布。

  **残余未覆盖（本轮一行未动；`clients.ts` / `tabStates.tsx` 行号与 b19 HEAD 相同，`data.ts` 行号为 b20 HEAD）**：P1-1 `clients.ts:328 / :348`（`skipped` 时不再打「重登未成功 → 不重放」；实际日志点在 `libSessionGuard.ts:309`，契约在 `transport.ts:51`）；P1-2 `clients.ts:280 / :281`（renewer 桥，消费点 `packages/core/src/info/client.ts` 的 `#withRenew` / `#ensureCardSession`）；P1-3 `pages/info/tabStates.tsx:29`；P2-1 `data.ts:608 / 1079 / 1922 / 2461 / 2560`（`softRecover` 的假值仍落错误条 / 空数组 / toast，`:1922` 的 toast 文案仍说「登录状态已自动重建」）；可选 6 组 `data.ts:558`（`useSemesters` 无恢复直接 `backToLogin()`）、`data.ts:725`、`data.ts:2608`、`Schedule.tsx:404`、`DormTab.tsx:69`、`LibraryTab.tsx:364 / 390 / 457 / 508 / 549`、`LibRoomTab.tsx:401 / 434 / 493`。另两条**本轮新增记录、仍未收口**：① `skipped/cooldown` 仍可能遮蔽**已结算**的 `failed`——页面层若在运输层那条链结算之后才问到（b19 现场实测晚 5ms），拿到的是冷却窗内的 `skipped`，按口径不登出、留错误条；b20 未再复现该时序，判据由护栏 ⑲ 兜住。② ③ 的两条残余（登录链自身的 200 登录页仍会命中判据、`x-onethu-auth-dance` 在 `nativeFetch` 通道恒空）与 ④ 双仓不同步照旧。

  **修复落地（④ 两仓同步正修，b21，提交 `b72d4645`）**：

  **阶段 0 机制结论（只读取证，未先写代码；原始 buffer 留在工作机临时目录的 `b20-*` / `b21-*` 日志，判据可原样复核）**：
  - **权威侧 = 原生 store，不是 JS jar（已证实，代码取证）**：`apps/desktop/src-tauri/src/lib.rs:1351` 的 `http_native` 显式丢弃调用方传入的 `Cookie` 头（`matches!(lower.as_str(), "host" | "content-length" | "cookie") => continue`），收发全走 `SharedNativeJar`（`lib.rs:1255-1274`，cookie_store + RFC6265 域/路径语义）。JS 侧 `MemoryCookieJar`（`packages/core/src/http.ts:94`）只服务两条路：影子账本（`setFromResponse` 按跳入账，供 CSRF 视图/诊断）与老通道 `universalFetch` → `tauriFetch` → Rust `http_request`（`lib.rs:2163` 起，独立 `reqwest::Client::builder()`，**没有** cookie 仓，只能靠 JS 头供票）。
  - **谁先变、谁被谁覆盖（已证实，真机）**：同一台 `<设备>`（REDMI / dev 包 `0.10.0-dev` / `0.10.0-dev` b20）取两个独立冷启样本。样本一（21:50:19.205–21:52:01.180，102s，354 条 `LIB-JAR` × `[NATIVE-STORE] webvpn.tsinghua.edu.cn` 并列行）：JS jar 恒 `wengine_vpn_ticket=wrdvpn1-b293…`，原生从 `(无)`（21:50:19.205）起铸 `wrdvpn1-ae98…`（21:50:19.374）。样本二（22:10:18.899–22:20:18.913，**恰 600s**，370 条并列行）：JS jar 恒 `wrdvpn1-b293…`，原生 `(无)` → `wrdvpn1-80f5…`（22:10:19.042）。两个样本里 JS 侧值是**同一个值**（跨进程不变 = 持久化快照），原生侧每次冷启都换一张新票；**两样本合计 724 条并列行里相等的 0 条**，且**没有任何一方向另一方覆盖**——回灌缺口在「原生 → JS 的物理域入账」，而 JS → 原生方向被 2026-09-17 留下的基础设施票过滤挡住（`clients.ts` 当时的播种口过滤 `wengine_vpn_ticket`/`show_*`/`heartbeat`/`refresh`）。
  - **冷启时原生 `(无)` → JS 已有的那条票，最终没有被播种过去（已证实）**：整段窗口里 JS 侧值一次都没变。原生成因（`native-jar.tsv` 是否落盘 / 回种）**待查**：`run-as` 读应用私有目录被系统拒绝（非 debuggable），无法直接读文件；这一档不影响同步方向的结论。
  - **learn 之外的站点（card/seat/libroom/zhjw/info）播种路径（已证实，结构性）**：播种口在**两个 HttpClient 实例**上都有——`clients.ts` 的共用 `http`（info/卡/座位/图书馆/教务/场馆/…）与 `learnHttp`（learn 专线），二者都由 `packages/core/src/http.ts:517`（`#wengineBootstrapCookies` 内）调用。此处「没有回灌」≠「没有播种」：两仓长期不同步的**唯一**缺环是原生 → JS 的物理域回灌。
  - **推测（需原始 Set-Cookie 行才能定论）**：新票进不了 JS jar 的具体成因是「裸 `Set-Cookie`（无属性、无分号）被 `packages/core/src/http.ts:34-38` 的 `parseSetCookieLine` 判空丢弃」还是「包装跳按 `decodeUrl` 入账到真实应用域、物理域键从未更新」。两者都由本轮的「按 cookie 名 + 物理跳 URL 归一化入账」覆盖，故未等定论即修。真机日志不含原始 `Set-Cookie` 行，`adb` 无 root、`run-as` 不可用，本轮未取得该行。

  **同步方向与挂点（选择理由写在代码注释里）**：
  - 方向一（主）：**原生 → JS 回灌**。挂点在 `transport.ts` 的 `nativeFetchOnce` 内、`http_native` 返回之后，且**只在本次响应真的带 `set_cookie_hops` 时**回调一次；无 Set-Cookie 的请求 0 次。只处理 wengine 基础设施票（`wengine_vpn_ticket`/`show_*`/`heartbeat`/`refresh`），按**物理跳 URL**归一化为 `name=value; Path=/` 入 JS jar；其余票的入账路径仍是既有的 `setFromResponse`（解码回真实域），一行未动。
  - 方向二（窄）：**JS → 原生播种**沿用既有挂点（wengine 引导页 body 票，`#wengineBootstrapCookies`），两处播种口统一过 `planSeedToNative`；基础设施票**绝不**播种。
  - 不做的：每请求前播种（会让事件与日志放大）、冷启扫仓、在重登成功/子服务重建成功处额外加一次同步扫描——票值变化最终都体现为 Set-Cookie，挂在这一处即可覆盖，且不新增任何调度状态。
  - **单调规则与依据**：每个键（`host|path|name`）维护「当前值 + 已退役值集合」。同值 → 幂等不写；命中已退役集合 → 旧票回放，拒收；其余 → 新值上位、旧当前值退役。依据：wengine 票是服务端一次性随机签发（`wrdvpn1-` + 32 位随机 hex），同一值二次下发只可能是旧票被回放（2026-09-17 真机实录：引导页回放的陈旧匿名票覆盖刚铸好的真票，首页瞬间全绿后几秒即死）；票值上没有可靠的签发/更新时间字段，因此用「进程内观测顺序 + 值历史」作单调序。冷启水合后用 JS jar 的现值做世代基线，使持久化旧票在第一张新票到来时退役、此后回放一律被拒。边界（如实记）：某键在本进程第一次收到的若是更旧的值，无从分辨；若某票只在原生侧被换掉而两个同步方向都没见过它的历史，JS 侧第一次递上来的旧值仍会被采纳——这一档由「基础设施票永不播种 + 播种口只接引导页 body 票」兜住。
  - **清仓实现**：`infoLib.ts` 的 `setPlatformClearCookies` 由空实现改为真正实现。info-lib 的 `clearCookies()` 有**两个**调用面：`libLogout()`（显式登出 / 设置「退出登录」）经平台钩子把**两个仓一起全清**（JS jar + `http_native_clear_cookies`，`transport.ts` 新增 `nativeCookieClearAll`）；info-lib `login()` 开头的调用（静默重登也走这里）**只按既有 `nativeCookieClear` 的 id/oauth 域边界**清 JS jar 同域副本，绝不在业务流里全清。全清分支由一次性标记 `explicitLogoutClear` 门控，只有 `libLogout()` 会置位；钩子未接线时有兜底全清、不留悬空标记。

  **护栏 ⑳ 与反例**：`tools/relogin-test.mjs`（仍在 `pnpm guard` 链）新增 ⑳ 共 **39 条**断言、5 组——⑳-1 单调保护（两方向构造值：新票覆盖旧票、旧票回放拒收、同值幂等、冷启以水合旧值为退役基线、键大小写归一、基础设施票名单）；⑳-2 同步挂点（空 hops 0 条、非基础设施票 0 条、裸行归一化后按物理跳域入账、同值不重复写；结构性：回灌必须在 `http_native` 之后且被「有 Set-Cookie」门控、两处播种口同一条路径、`nativeSeedCookies` 只出现在两处、冷启重置世代）；⑳-3 播种方向单调保护与基础设施票过滤；⑳-4 清仓（`setPlatformClearCookies` 非空实现、两仓全清同时触达、`http_native_clear_cookies` 打到、全清只在显式登出分支、登录链路不许置全清标记、登录前只清 id/oauth 域）；⑳-5 结构性：`transport.ts` 仍不含单飞/冷却调度状态。**反例自检 3 例**（注入 → `node --experimental-strip-types tools/relogin-test.mjs` exit=1 → 从本机备份 `cp` 回来 exit=0，三文件 md5 逐一核对一致）：
    ① 去掉单调保护（`if (g.seen.has(value))` 改成恒假）→ 红在原文「✗ ④ 单调：旧票不许覆盖新票（回放必须拒收）」「✗ ④ 单调：此后持久化旧值回放必须拒收（2026-09-17 现场形态）」「✗ ④ 播种：被换掉的旧票回放必须拒收（旧不许盖新）」等 **5 条**；
    ② 把回灌挪成每请求前播种（删掉门控、在 `invoke` 之前无条件回调）→ 红在原文「✗ ④ 挂点：回灌必须挂在 http_native 之后（不许在每请求前播种）」「✗ ④ 挂点：回灌必须被「本次响应真的带 Set-Cookie」门控（无 Set-Cookie 的请求 0 次）」**2 条**；
    ③ `clearBothCookieJarsFull` 只清 JS jar（去掉原生全清）→ 红在原文「✗ ④ 清仓：两仓全清必须同时触达 JS jar 与原生仓」**1 条**。

  **真机复验（b21，APK 18,649,981 字节 / md5 `43d919b6…`；exe 19,506,176 字节 / md5 `576f23dc…`；对照上一轮 b20 的 APK md5 `a220e500…`、上一份 exe md5 `ce2b602b…`——APK 字节数比 b14–b20 的 18,645,885 多 4,096，两份 md5 均不同，即新一轮构建。原始 buffer 留在工作机临时目录的 `b21-*` 日志；URL 一律去查询串、票值只留前 12 位）**：
  - **两仓收敛（含冷启 + 服务页→网络学堂→全部通知→今日→我的 走查）**：观察窗 22:29:17.912–22:39:17.958（**恰好 10 分钟**），窗口内 `LIB-JAR` 与 `[NATIVE-STORE] webvpn.tsinghua.edu.cn` 并列行 **538 条**（各 269 条）。JS 侧去重值只有两个：`wrdvpn1-b293…`（冷启前遗留的持久化旧值，1 条）与 `wrdvpn1-a2e1…`（268 条）；原生侧 `(无)` 1 条 + `wrdvpn1-a2e1…` 268 条。冷启 22:29:17.912 时原生仍 `(无)`、JS 仍是 `b293…`；22:29:18.133 原生铸票 `a2e1…`，**22:29:18.134（差 1ms）JS jar 即同值**；自这一刻起 **268 对并列行 100% 相等、0 对不等**（窗口内相邻异源配对 183 对，181 对相等，2 对不等都落在 22:29:17.912–18.133 的冷启瞬间：原生 `(无)` 与 JS 旧值、以及原生新票与 JS 尚未刷新的旧值）。对照修前基线：两个冷启样本合计 724 条并列行相等的 0 条、JS 侧值跨进程不变。收敛前后的对照：`b293…`（旧，跨两轮持久化）→ `a2e1…`（本轮原生铸、JS 1ms 内跟上），此后无回退。
  - **单调保护真机确认**：**未取到**——本轮窗口内没有出现旧票试图覆盖新票的事件（服务端没有回放旧值，正是健康路径的常态）。替代证据：修前 b20 的旧值 `b293…` 在两轮共 700s、724 条并列行里恒存不动，修后第一张新票即上位且再未回退；回放拒收由护栏 ⑳-1 / ⑳-3 与反例 ① 覆盖。
  - **无回归（健康会话，一次专用冷启 22:29:17 起，同一 10 分钟窗口）**：`LIB-AUTH 判定` **22 条**；空集判定 **21 条**（**全部 `reason=login-chain-page`、`escalate=false`**）；**兜底升级 0 次**；真重登 1 次（`SOFT-RELOGIN state=done`）、冷却判掉 1 次（`state=skipped reason=cooldown`）、真失败 0；`重登成功 → 重放一次` 1 条、`重放后仍失效` 0 条；`SOFT-RECOVER` 0 条；`PAGE-ERR TODAY-NEWS` **0 条**、`TODAYCAL-SHAPE` **0 条**（b20 止血未被破）。`BOOT-T READY(总耗时)` **+1713ms**（同 buffer：`learn.resume(会话活)` +1223ms、`info.resume` +1711ms），落在 b20 五样本 +1686…+1970（中位 1823）区间内，高于 b19 记录的 +1331 / +1498。
  - **走查未见异常**：服务页→网络学堂→全部通知→返回→今日→我的 全程无红条、无登录页；日志无 `SOFT-RELOGIN state=failed`、无 `重放后仍失效`。

  **残余未覆盖（b21 一行未动，行号为本轮 HEAD）**：P1-1 `clients.ts:320`（`setNativeFetchAuthHooks` 恢复钩子在 `skipped` 时仍走「不重放」分支；契约 `transport.ts:51`，日志点 `libSessionGuard.ts:309`）、`clients.ts:348`（B 兜底全链恢复的返回值仍不区分三态）；P1-2 `clients.ts:280 / :281`（renewer 桥，消费点 `packages/core/src/info/client.ts` 的 `#withRenew` / `#ensureCardSession`）；P1-3 `pages/info/tabStates.tsx:22 / :33`；P2-1 `data.ts:608 / 1079 / 1922 / 2461 / 2560`（`softRecover` 的假值仍落错误条 / 空数组 / toast，`data.ts:1933` 的 toast 文案仍说「登录状态已自动重建」）；可选 6 组 `data.ts:558`、`data.ts:725`、`data.ts:2608`、`Schedule.tsx:404`、`DormTab.tsx:69`、`LibraryTab.tsx:364 / 390 / 457 / 508 / 549`、`LibRoomTab.tsx:401 / 434 / 493`。另三条仍未收口：① `skipped/cooldown` 仍可能遮蔽**已结算**的 `failed`（页面层在运输层结算之后才问到时，判据由护栏 ⑲ 兜住，b20 / b21 均未复现该时序）；② ③ 的两条老残余（登录链自身的 200 登录页仍会命中判据；`x-onethu-auth-dance` 只在 `tauriFetch` 侧写入 `transport.ts:493`，`nativeFetch` 侧读取 `transport.ts:326` 故恒空）；③ 本轮 ④ 只覆盖「JS jar 里的 wengine 基础设施票由物理域回灌收敛」，其余票种在两仓之间的长期一致性仍无主动核对（只在 Set-Cookie 到达时被动入账），冷启原生仓为何从 `(无)` 起仍**待查**（`native-jar.tsv` 落盘/回种链路无法在非 debuggable dev 包上直接读证）。

  **旁枝收口（b35，提交 `118afc1f`；霖 2026-10-05 裁定「把旁支解决了」）**：两条旁枝都已落地并取证；b21 的同步方向、单调规则、清仓语义（b23 红线）与「谁是真源」逐条未动，未加依赖、`packages/core` 未动、触发面未下移。
  - **旁枝 (ii) 先查证：原生仓一直有 save/load，丢的是 host-only。** Rust 侧 `SharedNativeJar::save_to_file / load_from_file / save_if_dirty` 由 `accc5a17`（gjl25，2026-09-18）落地并已接线（`load_from_file` 在 `setup`、`save_if_dirty` 在 30s 循环，文件 `app_data_dir()/native-jar.tsv`），不存在「没有落盘链路」；真 bug 在序列化：旧 tsv 取 `cookie::Cookie::domain()`，该访问器读的是原始 `Domain=` **属性**，host-only cookie 返回 `None`，旧代码 `if host.is_empty() { continue; }` 把整条丢掉 → 含 `wengine_vpn_ticket` 在内的 host-only 票**从未落盘**，这才是 b21 真机「原生仓每次冷启从 `(无)` 起、重新铸票」的根因。本机独立探针（`cookie_store` 0.22.1）确定性复现：同一仓 2 条未过期票（host-only `wengine_vpn_ticket` + `Domain=` 作用域 `id_trust`），旧 tsv 只写出 `id_trust`、回种后 host-only 丢失；换用 cookie_store 自带 serde JSON 后回种 2 条全在。
  - **旁枝 (ii) 改法（原生自持久化，未用 JS 快照做种子）**：`save_to_file` 改用 `cookie_store::serde::json::save_incl_expired_and_nonpersistent`（`HostOnly` / `Suffix` 两种 domain 变体、路径、secure、过期全保真），`load_from_file` 先试 `json::load_all`、失败再回退读旧 tsv（老安装一次迁移）；写前 `create_dir_all(parent)`；**写失败不再清 dirty**（旧实现无条件清，失败即永久丢数据）；冷启落一行 `[NATIVE-JAR] load n=<未过期条数> fmt=json|tsv(legacy)|none`，30s 落盘只在**条数变化**时落一行 `[NATIVE-JAR] n=<条数>`（只计数、不含票值）。文件名沿用 `native-jar.tsv`（内容已是 JSON）。**未**用 JS 持久化快照做原生种子：那会新增一条 JS→原生播种口并把「谁是真源」推向 JS，而原生自持久化不动真源、不动清仓面，也不需要为种子单设基础设施票排除口径。
  - **旁枝 (i) 改法（有界 / 幂等 / 可观测的主动核对）**：Rust 新增只读命令 `http_native_cookie_dump`（解析同一份 serde JSON 取生效 host/path；不 seed、不清仓、不落盘、不置 dirty）；JS 侧零依赖判定在 `cookieSync.ts:planJarReconcile / createCookieReconciler`——**登录成功**（`login()` / `verify2FA()`）与**冷启就绪**（`resumeSession()` 快路径成功；慢路径静默重登经 `login()` 计 login 触发器）各一次，同一触发器本进程最多真跑一次（无轮询、无定时器），同值不写、旧值回放拒收，基础设施票键收窄 `Path=/` 且**只回灌、不反播**（唯一的 JS→原生播种口 `planSeedToNative` 对基础设施票仍恒 `null`），失败静默降级（`run` 绝不抛）并留一行 `LIB-JAR-RECONCILE trigger=… native=… missing=… updated=… same=… stale=… infra=…`（或 `… failed …`，只计数）。
  - **真机取证（K30 `9602814b` 三次冷启、K90 `192.168.18.169:33029` 两次冷启；APK 18,764,669 字节 / md5 `33b3171061eb0516d70427f027518917`，副本 `/mnt/c/temp/onethu-b35-dev.apk`；原始 buffer `/tmp/b35-k30-run{1,2,3}.log`、`/tmp/b35-k90-run{4,5}.log`；票值只留前 12 位）**：
    - **(ii) 冷启不再从零铸票**：K30 升级后首启 `[NATIVE-JAR] load n=0 fmt=tsv(legacy)`（旧 tsv 可回种的票为 0），首跳 `[NATIVE-STORE] webvpn… → (无)`，原生随即铸 `wrdvpn1-150fcb05…`，+30s 首次 JSON 落盘 `[NATIVE-JAR] n=11`；**第二次冷启** `load n=11 fmt=json`，首跳原生仓直接带 `wengine_vpn_ticket=wrdvpn1-150fcb05c5034bb986b0ea9008d5693c`（与上一轮铸的同一值），第三次冷启同值。K90 同型：`load n=0 fmt=json` → 铸 `wrdvpn1-1269…` → 下一轮 `load n=11 fmt=json` 首跳即带 `wrdvpn1-1269…`。**跨冷启票值稳定成立**（此前原生侧恒 `(无)`）。旁证「服务端确实接受而非只是带着」：`BOOT-T READY(总耗时)` K30 首启 +1990ms → 恢复后 +366 / +373ms，K90 首启 +3470ms → +881ms；302/307 跳数同步下降（K30 42→10、K90 45→11），200 为主。
    - **两仓并列行对照（b21 同款判据：`LIB-JAR` 与 `[NATIVE-STORE] webvpn.tsinghua.edu.cn` 相邻同值配对，票值取前 12 位）**：改造前形态（本轮构建、原生仓仍从空仓起）K30 冷启#1 **332 条并列行 / 49 对 / 相等 48 / 不等 1**（唯一不等即冷启瞬间原生 `(无)` 对 JS 持久化旧值 `wrdvpn1-7ad2…`；此后 165 条原生与 165 条 JS 全为 `150f…`），K90 冷启#4 **366 行 / 65 对 / 相等 65**（首行原生 `(无票)` 对 JS `f901…` 未配成对，值序列已如实列出）。改造后（原生 JSON 回种）K30 冷启#2 **286 行 / 33 对 / 相等 33 / 不等 0**、冷启#3（约 4 分钟静置）**286 行 / 35 对 / 相等 35 / 不等 0**，K90 冷启#5 **312 行 / 45 对 / 相等 45 / 不等 0**——**改造后 113 对全部相等**。对照 b21 记录的修前基线「两个冷启样本合计 724 条并列行、相等 0 条」。
    - **(i) 主动核对读数**（`LIB-JAR-RECONCILE`，只计数）：K30 冷启#1 `trigger=boot native=8 missing=2 updated=0 same=6 stale=0 infra=0`（冷启后补上 **2 个「原生有、JS 无」的其余票种键**；`infra=0` 即这两条不是基础设施票），冷启#2 / #3 `native=11 missing=0 updated=0 same=11`（同值幂等、不重复写），K90 冷启#4 `native=8 missing=2 updated=0 same=6`（同型缺口），K90 冷启#5 `native=11 missing=0 updated=1 same=10 stale=0 infra=1`（1 条基础设施票已在原生仓回种、JS 侧仍是旧值 → 主动核对按原生→JS 方向回灌，`infra=1`）。五个窗口**零 `stale`、零失败行**。`login` 触发器真机未取到（两台机冷启都走快路径 `RESUME ok`，没有交互登录），该触发器由护栏 ㉗-2 的行为断言覆盖。
    - **未取到 / 限制（如实记）**：① K30 的 `adb shell input tap` 被 MIUI 拒绝（`INJECT_EVENTS permission`），页面走查没能做，两仓样本全部来自冷启 + 静置窗口（K30 合计 618 行、K90 合计 678 行，与 b21 的 538 行同一量级）；② K90 前两次启动时设备处于 Dozing，应用网络被系统挂起（`dns error: No address associated with hostname`，同机 adb shell `ping webvpn.tsinghua.edu.cn` 正常），那两次只有迁移读数（`load n=0 fmt=tsv(legacy)`、无核对行），唤醒设备并 `cmd deviceidle whitelist` 后才取到 (i) 读数，取证结束后已把 whitelist 复原；③ 桌面 exe 本轮未构建（上一轮 b33 记录 `tauri:build:dev` 在缺 gdk-3.0 时失败，可复用配方见 `/tmp/b33-exe-build4.log`），记为未取到。
    - **K90 补测（b39，2026-10-05；APK md5 `4d2383cf…`＝HEAD `ad888ed0`；原始 buffer `/tmp/b39-k90-cold1.log` 807 行 / `cold2.log` 572 行；每轮 `am force-stop` + `logcat -c`，**未** `pm clear`）**：冷启 #1 `[NATIVE-JAR] load n=10 fmt=json`（本轮如实记 10，与上表 b35 的 `n=11` 差 1），首跳原生仓直接带**磁盘里的旧票** `wengine_vpn_ticket=wrdvpn1-a007…`（前 12 位）→ `[NATIVE-HOP0] 302` 跳 `/login`（该票已过期）→ `LIB-AUTH signal=logged-out-page sites=[learn] siteSrc=request → 共享单飞重登一次` → `LIB-CRED 从「记住密码」回灌登录信息` + 新票 `wrdvpn1-b5bb…` → `LIB-JAR-RECONCILE trigger=boot native=10 missing=2 updated=0 same=8 stale=0 infra=0` → `+30.003s [NATIVE-JAR] n=11`。冷启 #2 `load n=11 fmt=json` → 首跳 `[NATIVE-HOP0] 200 141ms`（不再跳登录），整轮 buffer 里 `wengine_vpn_ticket` **只有 `wrdvpn1-b5bb…` 一张（126 次、无换票）** → `LIB-JAR-RECONCILE trigger=boot native=11 missing=0 updated=1 same=10 stale=0 infra=1` → `+30.003s n=11`；该轮 `SOFT-RELOGIN state=done sites=[]` ×1，`LIB-AUTH` 仅 8 条 `sites=[] siteSrc=none reason=login-chain-page` 兜底判定（`escalate=false` 不触发），**无** `sites=[learn] siteSrc=request`。⇒ 「过期票→判定→重登→落盘→下一轮同票 200」全链在 K90（Android 16 / WebView 143）上闭合。
    - **K90 补测（b39，2026-10-05，已取到）**：b36 判定入口唯一 / b38 域限缩（域外两窗口各 6 条 `[HOP]`、`LIB-AUTH` 0 条）/ 18 路由冒烟与 `.nav-item` 计数的 **K90 复核全部取到**——设备在 15:22 掉线（`adb devices` offline → 42925/33029/5555 全 10061、`mdns services` 空，但 `ping` 通，判断为手机侧「无线调试」被关或设备重启），**15:41 自行回到 mDNS（新端口 `192.168.18.169:38427`，app pid 未变）**；细节见 §7 F3 ③ 的 b38 段末条与 §22.3 第 2 条。真死侧 `LIB-AUTH-DEAD` 该设备仍 0 条（未碰凭据）。
  - **护栏与反例**：`tools/relogin-test.mjs` 新增 ㉗ 组（㉗-1 计划真值表、㉗-2 执行器行为：有界 / 幂等 / 失败不抛 / 日志可检索、㉗-3 结构：只读 dump、JSON 落盘无损、清仓置 dirty、核对路径无反播）。6 例反例逐例注入 → `pnpm guard` exit=1（红点原文：㉗-1 旧值回放必须被单调规则拒收、㉗-2 同一触发器第二次必须 skipped、㉗-2 skipped 不许再 dump / 再写 / 再刷日志、㉗-3 核对接线里不许出现反播原生的播种调用、㉗ 落盘不许再读原始 Domain= 属性、㉗ 只读 dump 不许改原生仓状态、㉗ clear() 仍置 dirty）→ `cp` 还原 → 5 份文件 md5 与最终代码备份逐字节一致 → exit=0。

  **修复落地（P1：`skipped` 不再被当成失败，b22，提交 `a89532cd`）**：本轮只动普查表 P1 三处；P2 与可选 6 组一行未动；①②③⑤ / b19 三态 / b20 止血与判据 C / b21 两仓同步的语义逐条未变；不新增调度、`transport.ts` 不持冷却/单飞状态、不加依赖。

  **改法（三处，旧 → 新）**：
  1. `lib/clients.ts` 的 `nativeFetch` 恢复钩子（旧 `:320` / `:348`）→ `libSoftReplayOnce(raw, siteSrc)`：三态就地按 `state/libSoftSettle.ts` 的 `libSoftHookReplay()` 定夺。`done` → 重放一次（「只重放一次」仍由 `withLibAuthRecovery` 保证）；`failed` → 不重放、原样交回第一个错误并落 `LIB-AUTH <siteSrc> state=failed → 不重放，原样交回调用方`；`skipped/cooldown` → 不重放并落 `LIB-AUTH <siteSrc> state=skipped reason=cooldown → 不重放（被冷却判掉，不是失败结论）`；`skipped/reentrant` → 不重放并落「在飞链未结算；本钩子在链内，绝不 await 自身」。契约仍是 `transport.ts:52` 的 `Promise<boolean>`，`transport.ts` 一行未动。
     **这一处为何不 `settleLibSoftPending`（与 P1-2 / P1-3 不同）**：钩子由「某一次请求」的失败触发，而恢复链自身的请求也走同一个 `nativeFetch`——链内请求命中登录页时钩子拿到的 `pending` 就是**它自己所在的那条链**，`await` 它＝自锁。b22 先按「三处一律 settle」实现，真机窗口一当场复现永久卡死（见下「反例与真机现场」），故本层改为**同步判定**；「等在飞真结果再重放」只留给链的调用栈之外的观察者（b20 的 `state/data.ts` 三处 P0 出口、P1-2 桥、P1-3 tab 层）。
  2. `lib/clients.ts` 的 renewer 桥（旧 `:280` / `:281`）→ `libSoftRenewUsable(sites)`：`settleLibSoftPending()` 之后按 `libSoftRenewDecision()`——真 `done` → `true`；`reentrant + pending` → 结算后按真结果；真 `failed` → `false`（core 既有失败语义不变）；`skipped/cooldown` → **`true`**（不让 core 把「被冷却判掉」当失败，让它走自己的有界重试：`#withRenew` 一次缓冲重试 / `#withCardSession` 一次重试 / `#ensureCardSession` 再探一次）。**`packages/core` 的类型与逻辑一行未动**（护栏做 `setRenewers` 签名与 `#renewInfo` / `#renewCard` 字段类型的同值结构断言）。
  3. `pages/info/tabStates.tsx` 的 `logTabErr`（旧 `:22` / `:33`）→ `settleLibSoftPending(await softRecoverResult(tag))` + `libSoftTabAction()`：真 `done` → 经既有 `retry` 自动重拉一次；真 `failed` → 保留错误条；`skipped` → 标记待恢复、不重拉（与 `softRecoverResult` 的 20s 节流互撞会成紧环），并落 `TAB-AUTH <tag> state=… reason=… action=…`。
  判定集中在 `state/libSoftSettle.ts` 的四个零依赖函数（`settleLibSoftPending` 沿用 b20；新增 `libSoftHookReplay` / `libSoftRenewDecision` / `libSoftTabAction`），业务侧与护栏同一份实现。

  **护栏 ㉑（`tools/relogin-test.mjs`，8 组）**：㉑-1 三个判定函数逐种三态断言 + 「钩子判定必须是同步函数」；㉑-2 **链内再入不自锁**（看门狗：链内请求命中 `reentrant` 时链必须照常结算，且守卫之外的观察者仍能结算同一 `pending`）；㉑-3 端到端 `reentrant` / `cooldown` / `failed` 三支都不重放、各落对应日志、交回第一个错误；㉑-4 普通成功路径 0 恢复 0 重放；㉑-5 `clients.ts` 结构性（同步判定、钩子内无 `await` / 无 `settleLibSoftPending`、两处调用原样传三态）；㉑-6 renewer 桥行为（`reentrant→done` 不抛错、`cooldown` 不交出 `false`、`failed` 原样抛回）；㉑-7 `packages/core` 签名/类型未变且 core 内无桥内标识符；㉑-8 tab 层（`skipped` → 0 条错误条、`failed` → 1 条、只有 `done` 才自动重拉）。⑫–⑳ 旧断言全绿。

  **真机复验（b22，APK 18,649,981 字节 / md5 `37cf40aa…`；exe 19,510,272 字节 / md5 `33b14255…`；对照 b21 的 APK md5 `43d919b6…`、exe `576f23dc…`——两份 md5 均不同，即新一轮构建。原始 buffer 留在工作机临时目录的 `b22-*` 日志；URL 一律去查询串、票值只留前 12 位）**：
  - **窗口一 / 二（固定版，一次冷启 23:44:27 起，`logcat` buffer 1565 行）**：两次应用内 `logout` 制造「运行中登录状态全灭」，UI 全程 `.login-wrap` 0 / `.nav-item` 17（未落登录页、未白屏）。`SOFT-RELOGIN` 分类：`done` 1（冷启静默重登）/ `failed` 2 / `skipped reason=cooldown` 33 / `skipped reason=reentrant` **14**；钩子侧逐条落地：`LIB-AUTH request state=skipped reason=reentrant …` 6 条、`request state=skipped reason=cooldown …` 8 条、`request state=failed …` 2 条、`escalate` 侧 `reentrant` 7 条 / `cooldown` 17 条；**全文 `重登失败` 0 次**（旧布尔口径下 `skipped` 与 `failed` 混在一个 `false` 里的误读面消失）。真机实例：`23:45:21.137 LIB-AUTH request state=skipped reason=reentrant → 不重放（在飞链未结算；本钩子在链内，绝不 await 自身）`，同一条链 **1.5s 内正常结算**（`LIB-ENSURE 探针 info 域本人校验 fail（重试一次后）` → `门户未活 → 不补子服务重建` → `SOFT-RELOGIN state=failed streak=1 cooldown=60s`）。冷却侧实例：`23:46:00.431 LIB-AUTH request state=skipped reason=cooldown → 不重放（被冷却判掉，不是失败结论）`。
  - **反例与真机现场（本轮最关键的一条）**：先按「三处一律 `settleLibSoftPending`」实现，同一台 `<设备>` 窗口一取到 `skipped/reentrant + pending` 后**恢复链永久卡死**——`23:24:16.922` 起链，`23:33:20`（9 分钟）该键仍在飞、期间零结算零重建日志，登录状态再也恢复不了；改成同步判定后同一现场 1.5s 结算。最小复现（仓库外脚本，直接加载 `libSessionGuard.ts` + `state/libSoftSettle.ts`）：旧实现「链在 300ms 内结算 = false」、新实现「= true」。护栏 ㉑-2 的看门狗钉住机制、㉑-5 的结构性断言钉住调用点，反例 ② 注入旧实现即 4 条红。
  - **窗口三（专测真重登成功路径，`logcat` buffer 1034 行）**：击杀后并发触发，`reentrant` 15 条、`cooldown` 0，真重登 1 次但**被判死**（`LIB-ENSURE verifyAndReLogin 失败：Failed to get public key.` → `SOFT-RELOGIN state=failed streak=3 cooldown=120s`），随后页面层 P0（b20 既有判据，本轮未改）按真 `failed` 回登录页（`.login-wrap` 1 / `.nav-item` 0，学号与密码仍由「记住密码」预填，登录信息未被清除）。该窗口是三次击杀里唯一一次没有冷却遮蔽的完整恢复尝试；卡在登录页是「真失败 → `failed` → 既有 `backToLogin()`」，不是本轮判据改动引入。
  - **P1-2 收益——未取到**：真机三次击杀的真重登全部被 id 公开钥限流判死（`Failed to get public key.`），没有一次结算 `done`，因此「链在飞时 renewer 桥结算 `done` → core 不抛 `AuthRequiredError`」这条**本轮未取到真机窗口**，只有护栏 ㉑-6 的确定性断言与「`cooldown` → `true` → core 走自己那次有界重试」的代码路径；可观察到的只是真失败时桥仍如实交回 `false`（core 原有失败语义未变）。
  - **P1-3 收益——部分取到**：真机取到一条 `TAB-AUTH FITNESS state=skipped reason=cooldown action=mark-pending`（新诊断行落地）；窗口内信息页各 tab 的错误条从 0 → 1 → 2，但都是真失败（重登确实失败）导致，不是 `skipped` 被当成失败。**口径备注**：`logTabErr` 的 `retry` 参数全仓只有 `KongjianTab.tsx:61` 一处调用方，其余 tab 的错误条由各自 `catch` 里的 `setState("error")` 决定（不在 P1 范围），所以 P1-3 的用户可见面只在「`done` → 自动重拉一次把错误条消掉」这一支；`skipped → 0 条错误条` 是判定层与护栏 ㉑-8 的结论，不是全仓 tab 的可观察量。
  - **无回归（同一 buffer，含一次冷启 + 三个击杀窗口）**：判定 87 / 空集 70（`reason=login-chain-page` 46）/ 兜底升级 24（真重登被限流判死后的空集判定持续升级，**真实恢复动作仍被 30s / 60s / 120s 冷却封顶**：全窗口 3 次）/ `真重登 done` 1 / `重放` 1 / `重放后仍失效` 0 / `TODAYCAL-SHAPE` 0；`PAGE-ERR TODAY-NEWS` 窗口一 / 二 **0 条**、窗口三 1 条（真重登被判死后的今日页新闻源真实失败，不是 P1 误判）。冷启 `BOOT-T READY` +2164ms（同 buffer：`learn.resume(会话活)` +1286ms、`info.resume` +2162ms；另一样本 +2454ms），两步都含一次静默重登；对照 b21 同形样本 +1713ms（`learn.resume` +1223ms）：`learn.resume` 段差 +63ms（噪声级），`learn → info` 段 +876ms 对 +479ms（+397ms）**无法归因**（单样本、且该段在网络抖动期），如实标「未取得等条件对照」。
  - **走查未见新异常**：三个窗口全程无白屏、无 `AndroidRuntime` 崩溃；恢复失败的真机后果仍是既有行为（错误条 → 真失败 → 登录页），未被本轮改动放大。
  **修复落地（P2 + 看门狗 + 可选组，b23，提交 `4a9dab9b` + `905b5043`）**：本轮只动普查表 P2 七处、`lib/reload.ts` 的全局失登看门狗、可选组 10 处；①②③⑤ / b19 三态 / b20 止血与判据 C / b21 两仓同步 / b22 三处 P1 的语义逐条未变；不新增调度、`transport.ts` 不持冷却/单飞状态、不加依赖、`packages/core` 一行未动。判定仍然只有 `state/libSoftSettle.ts` 一套（`libSoftTabAction()`：`done` → 原地重取 / `failed` → 保留失败表现 / `skipped` → 标记待恢复），不另造第二套；每个观察点都先 `settleLibSoftPending()` 取在飞链真结果再判。

  **改法（旧 → 新）**：
  1. `state/data.ts` 七处布尔出口（旧 `:608 / :725 / :1079 / :1922 / :2461 / :2560 / :2608`，行号为 b22 HEAD）→ 统一改成 `const act = libSoftTabAction(await settleLibSoftPending(await softRecoverResult("<scope>")))` 再分流：
     - `xk-boot`（`:612`）：`skipped` → `ZHJWXK-AUTH-PENDING` + `RELOGIN_PENDING_NOTE` 错误条（原地可重试），不再落 `explainNetworkError` 失败条；`done` 仍原地重取一次、`failed` 同旧。
     - `xk-level`（`:738`）：`skipped` → 不 `levelFailedSems.add`、不落 `XK-LEVEL` 失败行、直接 `return null`（旧行为会把该学期标成「失败学期」，反压下一轮用刚重建好的活会话重抓）；`done` / `failed` 逐字不变（该处本就没有重取分支）。
     - `xk-core`（`:1098`）：`skipped` → 按既有 `for (authRound < 2)` 有界机制再试一次（不再直接 `return []`）；**下游第二跳**：重试轮再败只记 `XK-CORE-AUTH-PENDING`，不记 `XK-CORE-AUTH` 失败 tag（`905b5043` 补）；`done`（重建成功）后仍败、真 `failed` 之后仍败，照旧记 `XK-CORE-AUTH`。
     - `xk-queue`（`:1946`）：`skipped` → 队列保持原数据 + toast「登录状态暂时未能自动恢复，队列数据可稍后重试」；`done` → 重取一次；`:1933` 的旧文案「…，可稍后重试（登录状态已自动重建）」删除，改为 `setToast(rebuilt ? "…（登录状态已自动重建），可稍后重试" : "…，可稍后重试")`，`rebuilt` 只在 `done` 支置真。
     - `calendar`（`:2501`）/ `weeksched`（`:2614`）：`skipped` → 有旧值保旧（SWR）、无旧值 `CALENDAR-AUTH-PENDING` / `SCHEDULE-AUTH-PENDING` + pending 条；`done` → 既有原地重取；`failed` / 非认证同旧。
     - `exams`（`:2678`）：`skipped` → 既有 1.5s / 25s 有界重试照走（调用次数不变），仍败且无旧值时 `EXAMS-AUTH-PENDING` + pending 条。
  2. `lib/reload.ts` 的全局失登看门狗（旧 `:75` 的布尔 `softRecover("global")`）→ `softRecoverResult("global")` 三态：`if (r.state !== "failed") return;` 只有真 `failed` 进失败结算，`done` / `skipped`（cooldown、reentrant）直接返回。**这一处为什么不 `settleLibSoftPending`**：看门狗由「某一次请求失败」在链内触发，自身没有任何需要真结果的动作（不登出、不亮 UI、不重放），等飞＝零收益且把自己挂到别人的链上；需要真结果的观察者仍是页面层 P0 出口 / renewer 桥 / tab 层（b19 / b20 / b22 已接线）。布尔 `softRecover` 薄封装保留，其它调用点语义不变。
  3. 可选组 10 处（`pages/Schedule.tsx:404`、`pages/info/DormTab.tsx:69`、`pages/info/LibraryTab.tsx:364 / 390 / 457 / 508 / 549`、`pages/info/LibRoomTab.tsx:401 / 434 / 493`，行号为 b22 HEAD）→ 同一句式：`skipped` 不再亮失败条，先走各处**既有**兜底（`info.forceEnsure("library" / "dorm" / "libroom")`、日程页 4.2s 有界自动重试）且**调用次数不变**，兜底用尽才留 `LIB-*-PENDING` / `LIBROOM-*-PENDING` / `ELE-RECORD-PENDING` + `RELOGIN_PENDING_NOTE`；`done` 保持既有原路径（调用次数不变）；`failed` 保持既有 `explainNetworkError` 呈现。

  **霖的两条裁定（本轮照办，逐条落文）**：① **清仓语义按 b21 不动**——`setPlatformClearCookies` / 登录前只清 id+oauth 域 / 显式登出才两仓全清，本轮一行未碰，也不得为了「更彻底地自愈」扩大清仓面；② **P1-1 接受「同步判定」立场**——`nativeFetch` 恢复钩子在链内，`skipped/reentrant` 一律同步返回不重放、绝不 `await` 在飞链（b22 真机 9 分钟自锁的教训），「等真结果再重放」只留给链外观察者；本轮 P2 / 看门狗 / 可选组的 `settleLibSoftPending` **全部在链外**（页面层数据加载出口、看门狗回调），与该立场一致。

  **护栏 ㉒（`tools/relogin-test.mjs`，5 组）**：㉒-1 三态判定表 + 端到端真结算（真 `done` → `retry-load`；真 `failed` → `keep-error`；占位冷却 `skipped/cooldown` 任务 0 次 → `mark-pending`；`reentrant + pending` 由链外观察者结算出真结果，`done` → `retry-load`、`failed` → `keep-error` 两支都用）。㉒-2 P2 七处逐处结构性（三态出口存在；`skipped` 分支必须先 `return` / `continue`；失败表现必须在其后；`done` 的既有重取路径保留）。㉒-3 `:1933` toast 门控（`setToast(rebuilt…)`、旧无条件文案必须已删）。㉒-4 看门狗结构性（块内不许出现布尔 `softRecover("global")`、必须 `softRecoverResult("global")`、`if (r.state !== "failed") return;`、不许 `settleLibSoftPending`）+ 三态分流行为。㉒-5 可选组逐处（`lib` 5 处、`libroom` 3 处都过一遍）+ 五份源码不许再出现 `await softRecover(`。①–㉑ 旧断言全绿。

  **反例自检 4 例**（注入 → `node --experimental-strip-types tools/relogin-test.mjs` exit=1 变红 → 从本机备份 `cp` 回来后 exit=0，恢复后与快照逐字节一致）：
  ① 把 P2 `xk-boot` 的 `skipped` 折回失败（`mark-pending` 支改成 `keep-error` 落 `explainNetworkError`）→ 红：`✗ ㉒ P2 data.ts xk-boot #1：三态出口后必须显式处理 skipped（不然 skipped 落错误条 / 空数组 / 失败 toast）`；
  ② 让看门狗在 `skipped` 时按失败结算（`r.state !== "failed"` 改成 `=== "done"`）→ 红：`✗ ㉒ 看门狗：只有 failed 才许进失败结算（done / skipped 直接返回、不误报）`；
  ③ 在链内 `await` 在飞链（`clients.ts` 的 `libSoftReplayOnce` 改成 `libSoftHookReplay(await settleLibSoftPending(raw))`）→ 红两条：`✗ ㉑ P1-1：恢复钩子必须同步按 libSoftHookReplay 的布尔定重放（不许自己另判）`、`✗ ㉑ P1-1：恢复钩子内绝不许 await / settleLibSoftPending（链内自锁的唯一入口）`；
  ④ 把 `skipped` 触发的有界重试再败折回失败 tag（`XK-CORE-AUTH-PENDING` 改回 `XK-CORE-AUTH`）→ 红：`✗ ㉒ P2 data.ts xk-core：skipped 触发的有界重试再败只许记 pending，不许落 XK-CORE-AUTH 失败 tag（done / failed 之后仍败才保留失败 tag）`。

  **真机复验（b23；APK 18,649,981 字节 / md5 `372e78ec…`（第二轮，含 `905b5043`；第一轮 `4a7aa2c2…`）；exe 19,510,272 字节 / md5 `a4e0b95b…`（第一轮 `30e9a4a2…`）；对照 b22 的 APK `37cf40aa…` / exe `33b14255…`——三轮 md5 互不相同）**：设备为 `<设备>`（Redmi K30 Pro Zoom / Android 12 / WebView 96，退役机）；产物输入 = `905b5043` + 工作区未提交的 `packages/core/src/exthw/yuketang.ts`（与 b16–b24 同源惯例）。**该机引擎降级（WebView 96，`dvh` / `:has()` / `color-mix()` 全降级），所有 UI 观感类结论不作判据**，只取日志类指标与 CDP 计数。触发一律走 CDP `window.__TAURI_INTERNALS__.invoke('http_native', {url: 'https://webvpn.tsinghua.edu.cn/logout'})` 做**服务端登出**，不走应用内「退出登录 / 清除已保存的登录信息」，不 `pm clear`；原始 buffer 留在工作机临时目录（`<工具目录>` 下的 `b23-*` 日志）。
   - **无回归（冷启四样本：第一轮 +2049 / +1931 / +1932ms，第二轮 +1915ms）**：落在 b22 同机五样本 +1856…+2060ms（噪声极差 653ms）区间内。冷启段（击杀之前）：兜底判定 23–24 条**全部 `siteSrc=none` / `reason=login-chain-page`**、`escalate=true` **0**、真重登 1（`SOFT-RELOGIN state=done`）、重放 1、`重放后仍失效` 0、`PAGE-ERR TODAY-NEWS` **0**、`TODAYCAL-SHAPE` **0**、`登录状态已自动重建` **0**。`PAGE-ERR CARD` / `CARD-TX` 各 1 条在 4 个样本中的 2 个出现（b22 的 4 份冷启日志里有 3 份出现同样两条），属既有的间歇性启动噪声，非本轮回归。
   - **项 1（P2 `skipped` 不落失败表现）——取到**：击杀后同窗内 `PAGE-ERR XK-CORE-AUTH` **0 条**、`XK-CORE-AUTH-PENDING` **3 条**（第一轮同一场景是 `XK-CORE-AUTH` 2 / 3 条、0 条 pending——差异即 `905b5043`）；`LIB-LIST-PENDING` 2 / `LIB-REC-PENDING` 2 / `LIBROOM-KIND-PENDING` 1 / `LIBROOM-REC-PENDING` 1 / `CALENDAR-AUTH-PENDING` 1 / `EXAMS-AUTH-PENDING` 1（第二轮窗口）/ `ELE-RECORD-PENDING` 1（第一轮窗口，该处代码未被 `905b5043` 触碰）；上述站点的**失败 tag（`XK-CORE-AUTH` / `LIB-LIST` / `LIB-REC` / `LIBROOM-KIND` / `LIBROOM-REC` / `CALENDAR` / `EXAMS` / `ELE-RECORD` / `ZHJWXK` / `XK-LEVEL` / `XK-QUEUE` / `SCHEDULE`）全 0**；`登录状态已自动重建` 全文 0 条（旧 toast 已删）。用户可见面同一窗口：`.login-wrap` 恒 0、`.nav-item` 恒 16、无登录页、无白屏，错误条文案即 `RELOGIN_PENDING_NOTE`（列表页前缀「校历加载失败（学期检测/跳转不可用）：」是该槽位既有前缀，内层仍是 pending 文案，不是 `explainNetworkError`）。
   - **项 3（看门狗）——取到**：窗口内取到 `SOFT-RECOVER[global] state=skipped reason=cooldown`（第一轮 1+1、第二轮 3 条），**没有任何一条 `skipped` 触发失败结算**（旧布尔口径下它就是「结算失败」）；同窗 `SOFT-RELOGIN` 分类 `skipped` 56 条 / `done` 2 / `failed` 1（真失败来自 id 公开钥限流，属既有现场）。
   - **项 4（可选组）——部分取到**：`LIB-LIST` / `LIB-REC` / `LIBROOM-KIND` / `LIBROOM-REC` 的 `-PENDING` 各取到 1–2 条且失败 tag 0；同窗 `LIB-RENEW` 5 条 / `LIBROOM-RENEW` 2 条是**既有兜底 `forceEnsure` 自身失败**的既有日志（b22 同路径同样会产生），不是站点失败条，`forceEnsure` 调用次数与 b22 一致。
   - **项 2（真失败对照）——未取到**：本轮两个构建、五个窗口里 P2 各站点没有一次拿到真 `failed` 从而走失败分支的现场（会话在冷却窗内被问到时一律是 `skipped`；选课层的真失败落在 `XK-SEARCH` / 选课自身的重登上，不在 P2 出口）。该项由护栏 ㉒-1（真 `failed` → `keep-error`）与 ㉒-2（失败表现必须保留）兜住，**不得据此宣称真失败已在真机验证**。
   - **未触发到的站点（如实记）**：`xk-boot`、`xk-level`、`xk-queue`、`weeksched`、`Schedule.tsx` 日程窗口、`LibraryTab` 的 floor / section / seat 三处、`LibRoomTab` 的 res 一处——原因分三类：(a) 页面命中持久缓存不发请求（选课页 / 座位页 / 宿舍页在击杀后仍 `en=0`、无 auth 错）；(b) 选课层自带的重登机制（现场日志 `XK-CHECKSINGLE 借 lib 权威重登` / `健康票抢救 18 条完成`）把 auth 错在自己的层里吸收掉，没冒到 P2 出口；(c) 依赖健康会话才发请求（周课表 / 日程窗口依赖校历，学期未知时不发请求）。这些站点的行为由护栏 ㉒-2 / ㉒-5 的逐处结构断言与反例 ①④ 覆盖。

  **残余未覆盖（本轮一行未动）**：可选 `data.ts:498 / 504`（`useLearnData` 的 P0-3 `skipped` 分支之后的 `backToLogin()` 仍是 fallthrough，未显式收成「只有 `failed` 才登出」——按本轮范围说明确不做）；`XK-SEARCH`（`data.ts:1440`，选课搜索的「登录未落地」文案，不属 P2 七处）；b19 记的「`skipped/cooldown` 可能遮蔽**已结算**的 `failed`」时序残余，以及 b21 / b22 记的其它残余（登录链自身 200 登录页仍命中判据、`x-onethu-auth-dance` 在 `nativeFetch` 侧恒空、其余票种无主动核对）逐条不变。

  **修复落地（登录体验打磨：误登出清零 + 用户文案 + 周期打扰，b25，提交 `642cd495`）**：霖本轮口径「把登录打磨完善；体验要流畅舒适——不卡、不被退出登录、不出现「会话超时」这类吓人文案」。本轮只动三件事；判定仍只有 `state/libSoftSettle.ts` 一套，b16–b24 的三态 / 共享单飞 / 30s 起步 120s 封顶 / 只重放一次 / 两仓同步 / `dvh` 兜底语义逐条未动；`packages/core` 一行未改（core 的 raw 错误文案是既有契约，净化放在显示层）。
  **W1 `useSemesters`（`apps/desktop/src/state/data.ts`）**：此前学期列表 `catch (AuthRequiredError)` 之后**一次恢复都不试**就 `backToLogin()`——打开选课 / 日程时学期串一失败就把人踢到登录页，正是「时不时被退出登录」。现在与 `useCampusData` 同构：`settleLibSoftPending(await relearnRoamOnce())` → `done` 重走 `load()`；否则 `settleLibSoftPending(await softRecoverResult("semesters"))`（新 scope）→ `done` 重走；**只有两个入口都 `failed`** 才 `backToLogin()`；`skipped`（冷却窗内 / 同键在飞）保留旧值（SWR）并落 `SEMESTERS-AUTH-PENDING` + `RELOGIN_PENDING_NOTE` 可重试错误条，**不登出**。
  **W2 `useLearnData`**：补上 campus 同款第二跳（`softRecoverResult("learn")` + 守卫外 `settleLibSoftPending`）。learn 漫游登录状态约 8 分钟过期是常态，此前 `relearnRoamOnce()` 一 `failed` 就直接登出；现在第二跳 `done` → 重走数据链、`skipped` → 原地可重试错误条（`LEARN-AUTH-PENDING`）、只有真 `failed` 才登出（第二跳的 `failed` 同样计入）。调用次数：每次失败只多一次 `softRecoverResult("learn")`，既有调用点次数与语义未变。
  **W3 `XK-SEARCH`**：选课搜索的「登录未落地」此前直接落失败表现。现在按三态收口：auth 类失败（`AuthRequiredError` / 「登录未落地」/「恢复冷却中」/`__vpn_hostname_data`）才 `settleLibSoftPending(await softRecoverResult("xk-search"))`；`done` → 原地重跑搜索，`failed` → 保留既有失败 tag `XK-SEARCH` 与失败表现，`skipped` → `XK-SEARCH-AUTH-PENDING` + `RELOGIN_PENDING_NOTE` + 既有 4.2s 有界自动重试；非 auth 失败路径逐字未变；**搜索失败绝不 `backToLogin`**（保留搜索现场）。
  **W4 用户文案**：`Settings.tsx` 两处「会话已失效 / 会话健康」改「登录状态」口径（`登录状态已失效：…`、`登录状态：正常 / 已失效`、「记住密码（登录状态失效后自动重新登录）」）。`tools/ui-copy-lint.mjs` 扫描面补强——旧实现**整类漏检**两类用户可见面：①带插值的模板串（`s.includes("${")` 处整串放行），②独占一行的 JSX 文本（两端没有 `>`/`<` 的正则抓不到）；现在用状态机取模板串**字面段**（剔除插值表达式）+ 去注释去字面量后抽 JSX 中文段；新面只跑 R1（避免把存量 R2/R4 一次拉成几百条，规则适用范围写进文件头）。同时全仓扫出并改掉其它用户可见内部名词：`ExtHwLoginModal`（读取登录信息）、`yktWebview` 的 `YKT_WEB_FALLBACK_HINT`、`LibRoomTab`、`VenueSportsTab`、`DormTab`、`NewsTab`、`ConnectGate`（访问口令）、`diagnostics`、`xkai`、`accountSetup`、`facade`、`mail`、`venue`、`madmodel`、`data.ts`（草稿导入 prompt）。
  更关键的一处：core 抛出的 raw 错误（`SessionExpiredError("网络学堂会话已失效…")`、`AuthRequiredError("图书馆会话已失效，请重试")`、`YktSessionError("雨课堂会话已失效（HTTP 401）…")`）会经 `ext.errors[…]` 与 `explainNetworkError()` **直接上屏**——core 不能改，于是新增显示层唯一出口 `apps/desktop/src/lib/userCopy.ts`（`会话已超时 → 登录状态已失效`、`会话 → 登录状态`、`凭据 / 凭证 → 登录信息`、`Cookie → 登录状态`；幂等、不抛、不改无关文本），在 `explainNetworkError()` 出口（含「直接回原文」的兜底分支）、设置页 6 处 raw 错误上屏点、作业页扩展服务错误条、邮件错误条全部过一遍；`isAuthError` / 重登判据 / 日志仍跑原文，不受影响。「网络超时：请确认校园网 / WebVPN 可达。」是真实网络诊断（带行动指引），原样保留。
  **W5 常驻定时器普查（清单逐条给结论；只改了确有实测打扰的一处）**：逐条结论——①`data.ts:430` learn 30 分钟静默刷新：写模块缓存 + 广播，失败完全静默，30 分钟一次，未构成打扰，**不改**；②`state/exthw.ts:659` 雨课堂心跳：启动 15s 首查 + 之后 **6 小时**一次，只更新 `yktSession` 快照并 `rebuild()` 一次，`checkSession` 失败只写状态与日志、不弹通知，**不改**；③`state/madmodel.ts` 的 10 分钟巡检泵 +「无登录信息时 60s 快试」：**实测这一跳每 60s 发一轮 3 跳请求 + 4 行日志**（20:27:02 与 20:28:02 两次，间隔正好 60s，结论恒为「校外 IP 门禁」），属可测的周期性网络 / 日志打扰，**已收紧**；④`state/displaySyncer.ts` 15 分钟静默同步：只推桌面小组件 / 通知快照，不触发 React 渲染，**不改**；⑤`state/island.ts:70` 15 秒 `setNow`：只重渲染 ChatDock 里的一行灵动岛文案，三轮 rAF 采样里没有 15s / 30s / 60s 的周期性长帧（长帧只出现在切页那一刻），**不改**；⑥`VenueSportsTab` 的 1s 倒计时 / 30s 维护窗 tick 只在该页且只在维护窗内（00:55–02:05），**不改**。
  **W5 改动（唯一一处，`state/madmodel.ts`）**：把「无登录信息就无条件每 60s 快试」收紧为**按连续失败次数指数退避**——首次仍 60s（保住「刚连上校园网 / 刚回校不必等满 10 分钟」的快速恢复），此后 2 → 4 → **5 分钟封顶**；拿到登录信息或探针判校内立即复位；窗口内直接 `return`，不发请求。**新鲜度 / 行为变化**：连续校外时的重试节奏由 1 次 / 分钟降为封顶 5 分钟一轮；每 10 分钟的巡检泵与对话前的按需 `preflightMadModel()` 一行未动，所以「回校后自动恢复」的上界是 5 分钟（原为 10 分钟）——是变快而非变慢。真机对照（同样 5 分钟前台静置）：改前 11 行日志 / 2 轮 3 跳请求，改后 6 行 / 1 轮。护栏 `㉓-6` 锁住「退避 + 5 分钟封顶 + 窗口内短路 + 判校内复位 + 10 分钟泵保留」。
  **护栏 ㉓（`tools/relogin-test.mjs`，6 组）**：㉓-1 结构性——`state/data.ts` 里**每一个** `backToLogin()` 的最近判定都必须是三态出口之后的 `failed` 支（判定器自带「catch 直连 backToLogin」反例夹具，夹具必须判红、`failed` 支夹具必须判绿）；㉓-2 W1/W2 三态真值表（3 态 × 3 态全组合：done→重走、failed→登出、skipped/cooldown 与 skipped/reentrant→原地可重试提示条不登出）+ 源码结构同型断言 + `semesters` / `learn` / `xk-search` 三个新 scope 各出现一次；㉓-3 W3 三态（done→重跑搜索 / failed→既有失败表现 / skipped→pending 提示条）、搜索失败区无 `backToLogin`、非 auth 失败仍走既有路径；㉓-4 文案（Settings 用户可见代码零「会话 / 凭据」；`ui-copy-lint` 扫描面必须能抓住带插值模板串 / `notify` 实参 / 独占行 JSX 文本，改前 Settings 原文必须判红）；㉓-5 显示层净化（`userCopy` 逐条映射、幂等、网络超时不被改坏；`explainNetworkError` 唯一出口过净化；设置页 6 处 + 作业页 + 邮件错误条逐个断言）；㉓-6 W5 定时器收紧（见上）。**反例自检 5 例**（注入 → `node --experimental-strip-types tools/relogin-test.mjs` exit=1 红 → 恢复 → exit=0 绿 + md5 一致，红断言原文见 §20.5）：① W1 改回「catch 到 AuthRequiredError 就直接 backToLogin」→ 红在 ㉓-1 与 ㉓-2 四条；② `useSemesters` 把 `skipped` 折回失败（`state === "failed"` 改成 `state !== "done"`）→ 红在 ㉓-1 与 ㉓-2「只有真 failed 才 backToLogin」；③ Settings 文案改回「会话已失效」→ 红在 ㉓-4 三条 + `ui-copy-lint` R1 一条；④ 设置页雨课堂错误条撤掉 `userCopy` → 红在 ㉓-5 一条；⑤ madmodel 快试改回「无条件每 60s 空跑」→ 红在 ㉓-6「退避窗口内必须直接短路」一条。文案红→绿另用 `lintSource()` 跑 `git show d51a21f5:<file>` 对照：改前 14 处（Settings 961 / 962×2 / 986 / 1125 / 1273 / 1275 / 1301 / 1302×2 / 1499、VenueSportsTab 667、LibRoomTab 45、ExtHwLoginModal 308）→ 改后 0。
  **真机数字与「未取到」（b25；APK 18,649,981 字节 / md5 `1265c8bb…`；exe 19,510,272 字节 / md5 `f7a80d48…`；对照 b23 `372e78ec…` / `a4e0b95b…`、b24 `00244765…` / `f4bd3bab…`，四轮互不相同）**：设备 `<设备>`（Redmi K30 Pro Zoom / Android 12 / WebView 96，退役机），取证只用 `<adb> logcat -s onethu:V` 与 CDP 计数，UI 观感类不作判据；安装走 `<adb> install -r -d '<Windows 盘符>:/<目录>/<包>.apk'` 返回 `Success`，升级后本机会话保留。空闲 5 分钟（前台静置、屏幕常亮）toast 0 / `window.onerror` 0 / 可见错误条 0 / `PAGE-ERR` 0 / `>100ms` 长帧 0（max 20.1ms）/ 日志 6 行（1.2 行每分钟，峰值集中在一轮 madmodel 请求）。3 轮 rAF 采样：今日页静止 p50 16.7 / p95 16.7 / max 217.4ms（>100ms 1 帧）；列表滚动 p50 16.7 / p95 16.8 / max 17.2ms（>100ms 0 帧）；60 秒内 50 次切页 p50 16.7 / p95 16.7 / max 250.9ms（>100ms 14 帧，长帧只在切页那一瞬间）。登录链：服务端登出（CDP `http_native` 打 `webvpn…/logout`，返回 200）后重载，`learn.resume(过期) +2006ms` → `trySilentRelogin(成功) +1576ms` → `LOGIN-OK（lib 链，单管线）`，恢复后 `#/learn` 取到真实数据（10 门课程 / 8 未交作业 / 42 课程通知 / 88 课程文件）、`.login-wrap` 0 / `.error-note` 0；同窗 `PAGE-ERR TODAY-NEWS` 0、`TODAYCAL-SHAPE` 0；重登被共享单飞 / 冷却收口（`sites=[learn]` 3 次、`state=skipped reason=cooldown` 2 次、`state=failed` 1 次、`reason=reentrant` 1 次），重放 0 次，无重登风暴；`PAGE-ERR` 只有 2 条 `CARD / CARD-TX Failed to get public key.`，与本轮改动无关（b16 已记的统一身份设备限流现象，改前同一条）。**未取到**：①与 b23 四样本 +1915…+2049ms 可比的 `BOOT-T READY`——允许的方法（不 force-stop）只能页面重载，有会话时 `水合完成(0网络) +0ms → learn.resume(会话活) +70ms → READY +149ms`（b23 是整进程冷启，含原生 / WebView 启动与 JS 解析，数字不可比）；登出后 `READY(总耗时)` 本就不打印（`clients.ts:742` 只在快路径 `learn.resume()` 成功后才 mark），故本轮不做该数字对比。②`skipped/cooldown` 遮蔽已结算 `failed` 的时序残余、登录链自身 200 登录页仍命中等 b19–b24 记的残余逐条不变。**残余（如实记）**：core 里仍有用户可见的「超时 / 接口」类原文（如 `yuketangQr.ts` 的「等待扫码超时」；`info/client.ts` 的「教务会话已超时，请重试」经 `userCopy` 已收成「登录状态已失效，请重试」，但括号原因里的「超时」二字仍在）；`ChatDock` 的聊天「会话」是业务名词，按霖口径排除；`libSessionGuard.ts` / `relogin.ts` / `transport.ts` 的**识别正则**与 `LibRoomTab.tsx:39` 的内部关键字一律未动；`diagnostics` 面板（dev-only）里那一行只改了标签（`网络学堂详请`），内容仍是原始调试串。
  **门禁**：`pnpm guard` exit 0、`pnpm test` 23/23、`apps/desktop` 下 `npx tsc --noEmit` 无输出、`node tools/docs-prose-lint.mjs` 21 份文档 0 处违规。

  **流畅度治理（切页长帧归因与修复 + core 残余「超时」文案，b26，提交 `85f0b544`）**：霖本轮口径「确保软件的体验是流畅舒适的——不卡一下、不被退出登录、不出现『会话超时』」。登录链三态 / 共享单飞 / 看门狗 / 30s 起步 120s 封顶 / 只重放一次（b16–b25）逐条未动；`packages/core` 一行未改（core 的 raw 文案是既有契约，净化仍在显示层）。
  **W1 归因（先取证，后动手）**：真机 CDP（rAF 帧间隔 + `PerformanceObserver(longtask)` + `Profiler` + `Tracing`）三条结论。①**导航没有可用预取面**：12 个安全页全部静态 import 进主 bundle（动态 chunk 只有 katex / pdf / xlsx / DevPanel / diagnostics / atoms，都不在这 12 页的挂载路径上），所以切页慢不是 chunk 未加载。②**每次切页的主耗时是新页整棵树的一次挂载渲染**：热路径 trace 里，选课是 `V8.RunMicrotasks 97.5ms` 内含 react-dom 调用 62.7ms + `UpdateLayoutTree` 13.3ms + `Layout` 6.7ms；设置是 `V8.RunMicrotasks 144.9ms` 内含 react-dom 143.3ms + `UpdateLayoutTree` 28.2ms + `Layout` 22.8ms。这两页 DOM 只有 473 / 422 个节点，成本不在节点数量，而在「`key={page}` 全量卸载重建」这个既有设计（本轮不做结构性改动）。帧间隔全部量化在 16.7ms 的整数倍（33.4 / 50.2 / 66.9 / 83.6 / 100.3 / 117 / 133.7 / 200.6），即长帧是掉帧而非长任务堆积；`React StrictMode` 虽在源码里，但产物是 production React 构建（`Warning:` 串 0 命中），不存在开发版双渲染。③**可确定归因、且能离线化的只有一段**：选课页挂载时 `useXkWorkbench` 触发 `void tbEnsureIndex()`，缓存命中时它要在点击后的那一帧里同步 `JSON.parse` 约 111KB 的 `onethu.tbookIdx`（真机实测 10.8ms，1080 条课程）+ 对全部课程做 NFKC 归一化与三张 Map 建图（13.8ms，冷 JIT 更贵）。解析与建图逻辑本身不慢，慢在它发生在点击帧里。
  **W1 修复（一处，最小改动）**：`lib/xkreviews.ts` 新增 `tbWarmIndexOnIdle()`，`App.tsx` 在登录就绪的 effect 里调一次——经 `requestIdleCallback`（`timeout: 3000` 兜底）把这段重计算挪到浏览器空闲期，不支持 idle 回调的宿主退化为 1.2s 定时器。口径刻意收窄：**只在本地缓存仍新鲜**（`onethu.tbookIdxTs` 在 `IDX_TTL` 内）时预热，此时 `tbEnsureIndex()` 的 `fresh` 分支为真、**不发任何网络请求**；缓存缺失或过期一律不预热，仍由选课页自己走原有 SWR 抓取，数据新鲜度语义一字未改。已就绪或已有在飞 promise 时直接返回（幂等）。评估后否决的两件：①`navigate()` 包 `startTransition`——状态真相在 `useSyncExternalStore(subscribeNav, topPageFrame)` 与 `useEffect([navTop])` 的 `setPage`，同步重渲染会被 de-opt，且可能多出一次渲染；②把 `installScrollReveal` 的扫描挪到空闲——会让 `opacity:0` 的元素最多晚一个空闲超时才可见（可见闪烁）。
  **W1 数字（改前 / 改后，同机同脚本）**：冷首访 12 页 p95 33.4 / 33.4、p99 100.3 / 100.4、max 200.6 / 184.1、`>100ms` 5 / 5、`>50ms` 16 / 17；热 30 次切页 p95 33.4 / 33.4、p99 66.9 / 66.9、max 117.1 / 133.8、`>100ms` 3 / 2、`>50ms` 39 / 38；逐页 cost（12 页 × 3 轮）冷合计 1480.3ms → 1247.7ms（平均每次切页 123.4 → 104.0ms）、热合计 738.8 / 888.0ms → 907.4 / 806.8ms；被修页选课的冷首访 119.1 → 119.1ms、热 252 / 302.2 → 369.3 / 269.1ms。**结论：本轮修复没能在端到端帧指标上取到可归因的改善**——24.6ms 相对每次切页 60–120ms 的挂载渲染、以及轮间 ±50ms 的抖动太小，p95 / p99 / max 全在噪声内，如实记「未改善」。机制侧只主张「一段实测 24.6ms 的同步阻塞已不在点击路径上」，不主张帧指标变好。
  **W2 core 残余「超时」上屏文案（core 一行未改，全收在显示层）**：`userCopy.ts` 增两条**逐条对应已知 core 原文**的规则——`等待扫码超时`（`yuketangQr.ts`）→「暂未收到扫码，请重新获取二维码」；`登录超时 | 登陆超时`（`info/client.ts` 的失登判据正则同值，是**认证**超时不是网络慢）→「登录状态已失效」。`网络超时：请确认校园网 / WebVPN 可达。`、`请求超时（30s 无响应…）`、`考试查询窗口触发服务端处理超时（jsp.timeout）…` 是真实诊断（带行动指引），原样保留，规则不泛化。新收口两个原本绕过净化的上屏点：`ExtHwLoginModal` 的两处错误行（`{err}` → `{userCopy(err)}`，core 扫码状态机 message 的唯一出口）、`Settings.tsx` 雨课堂「登录状态已失效（原因）」括号里的原因。
  **护栏 ㉔（`tools/relogin-test.mjs`，3 组）**：㉔-1 W1 机制的结构断言——预热出口存在 / 走 `requestIdleCallback` 且带 3s 超时兜底 / 无 idle 宿主退化为定时器 / 幂等 / 只在本地缓存新鲜时预热 / 过期仍走 `fetchIndex()` / 启动路径接线 / 选课页仍自己触发 `tbEnsureIndex`；㉔-2 `userCopy` 逐条规则（含幂等与「真实网络超时不被改坏」的反向断言）；㉔-3 两个新上屏点 + `ui-copy-lint` 的 R1 新增「超时」（`lintSource` 改前红 / 改后绿）。**反例自检 4 例**（注入 → `node --experimental-strip-types tools/relogin-test.mjs` exit=1 → `cp` 恢复 → exit=0，四个文件 md5 逐字节一致；红断言原文见 §20.6）：①撤掉 `App.tsx` 里的预热接线 → 红在 ㉔-1「预热必须在启动路径上接线」；②删掉「等待扫码超时」那条净化规则 → 红在 ㉔-2 两条；③`Settings.tsx` 的原因撤掉 `userCopy` → 红在 ㉔-3「设置页雨课堂（原因）也必须过 userCopy」；④文案改回含「超时」→ `node tools/ui-copy-lint.mjs` exit=1，报 `[R1] 内部表述`。
  **门禁**：`pnpm guard` exit 0、`pnpm test` 23/23、`apps/desktop` 下 `npx tsc --noEmit` 无输出、`node tools/docs-prose-lint.mjs` 21 份文档 0 处违规。

  **RC1 / RC2 修复（b31，提交 `439236e6`）**：霖 2026-10-05 实测报障原文——「一打开 OneTHU，主页又出现了『登录状态暂时未能自动恢复，请稍候重试；若持续出现…』的警示，我点了好几次重试，点完一次之后又会弹出来警示。我必须到账户-退出登录-点击登录才会恢复，这个过程只需要点两个按钮，为什么不能自动？而且恢复后还会过一小会（~1s）突然又闪回到登录界面，再点一下登录有概率又闪回，可能需要点两次才恢复正常。自动登录还是没好，接着修。」
  **真机 BEFORE（b29 干净包，非注入；原始 buffer `/tmp/b31-rc1-b29.log` 502 行、截图 `/tmp/b31-rc1-b29.png`）**：先 CDP `http_native` 打服务端登出（`webvpn…/logout` → 200 → 落到 id 登录表单），再点顶栏刷新触发 boot。时间线（日志体内 UTC，同日历本地 +8）：`17:07:57.931 LIB-ENSURE verifyAndReLogin 失败：Failed to get public key.` → `17:07:59.095 SOFT-RELOGIN state=failed streak=1 cooldown=60s`（这一次**真执行且失败**，留下 60s 冷却）→ `17:07:59.338 / .555 SOFT-RELOGIN state=skipped reason=cooldown streak=1 cooldown=60s`（**恢复任务压根没执行**，`skipped/cooldown` 没有 `pending`）→ `17:08:02.438 SILENT-RELOGIN ok` + `17:08:02.447 BOOT-T trySilentRelogin(成功) +2620ms`（boot 侧**已经登录成功**）→ `17:08:02.622 SOFT-RECOVER[global] state=skipped reason=cooldown (35ms)` → `17:08:02.742 SOFT-RELOGIN state=skipped reason=cooldown streak=1 cooldown=60s sites=[learn]` → `17:08:03.067 PAGE-ERR CAMPUS-AUTH-PENDING` → 主页警示条上屏且**常驻**。**机制结论（回答「为什么不能自动」）**：`skipped/cooldown` 表示两个恢复入口都**没有执行**（20s 节流 / 占位冷却窗内、无人持飞），旧实现却立刻 `setError(RELOGIN_PENDING_NOTE)` 并 `return`——真结算要等冷却到期后的某次业务请求才可能来，而**没有任何东西回来重跑这次加载**，所以警示只能等用户手点；用户点「重试」时按钮又是 fire-and-forget 清冷却，紧接着 `onRetry()` 开跑，请求抢在清零生效之前落回冷却窗 → 再弹一次。这与「自动登录没好」是同一件事：不是登录链没成功（BEFORE 里 `trySilentRelogin` 是成功的），而是**恢复任务被判掉后没人自动回来重试**。
  **RC1（警示常驻、点重试又弹）**：`apps/desktop/src/state/data.ts` 三处加载路径（campus / learn / semesters）在 `skipped/cooldown` 分支立刻弹警示；`apps/desktop/src/components/Layout.tsx` 的 `ErrorNote` 重试按钮 `void import(...).then(m => m.clearLibSoftBackoff())` 与 `onRetry()` 并发抢跑。**RC2（登录成功后 ~1s 闪回登录页）**：同一三处路径在恢复结算为 `failed` 时调 `backToLogin()`，而这些请求是**登录前**发出的、**登录后**才结算，**没有代次校验** → 把刚登录成功的用户踢回登录页；多个陈旧请求依次结算 → 「有概率又闪回、要点两次」。
  **设计（b31）**：① **登录代次守卫**——新增零依赖 `apps/desktop/src/state/authEpoch.ts`（模块真值，陈旧闭包也能读到最新代次），`state/app.tsx` 在**登录成功 / 2FA 完成 / backToLogin / 登出**四个出口自增并经 `useApp()` 暴露 `authEpoch`；三处加载路径在**发起时** `const epochAtStart = currentAuthEpoch()`，任何结算点 `epochStale(epochAtStart)` 为真则**一律不写回**（不 `backToLogin()`、不 `setState("error")`、不 `setError(...)`、不写数据 / 不写缓存）。② **冷却态自动重试**——新增零依赖 `apps/desktop/src/state/libSoftAutoRetry.ts`：`skipped/cooldown` **不再立刻弹警示**，改为读既有 `libSoftCooldownLeftMs()`（同时取 `relearnRoamCooldownLeftMs()`，避免在 20s 节流窗内空转烧光次数），到期后自动重试**一次加载**；**上限 3 次**、间隔 = 冷却剩余 + 250ms 抖动、**同一 epoch 内并发加载共用同一次** `setTimeout`（不叠加、不新建调度器）、**有在飞恢复链时不叠加**（只读 `libSoftRecoveryInFlight()`）、**每 epoch 最多一条 `AUTO-RECOVER` 摘要**；只有「自动重试**真执行**且 `failed`」才诚实落登录页，只有「重试用尽仍被冷却判掉」才落既有警示文案。③ **重试按钮时序**——`clearLibSoftBackoff()` 改为可 `await` 的 Promise 形态，`ErrorNote` 先 `await` 清冷却再 `onRetry()`，期间按钮 `disabled`/「重试中…」，动态 import 失败也继续重试。**守恒红线**：三态（`done|failed|skipped`）/ `reason` / 单飞 / `skipped/reentrant + pending` 链外结算 / 清仓语义 / b23「P2 有界重试只重放一次」全部一行未改；`packages/core` 零改动；**cookie 仓同步/回灌/清仓语义零改动**（b21 已修、霖 b23 划为红线）；F3 ③ 触发面下移本轮不做。
  **护栏**：`tools/relogin-test.mjs` 新增 ㉕ 组 8 条——㉕-1 代次纯模块（0 起、单调 +1、可复位）；㉕-2 自动重试 plan（上限 3 / 间隔=冷却剩余+抖动 / 已有定时器共用 / 在飞不叠加 / 用尽 `exhausted`）；㉕-3 运行期闸门（同 epoch 一个定时器挂多等待者、到点各跑一次、`AUTO-RECOVER` 每 epoch 至多一条、epoch 变化重置、卸载回收）；㉕-4 campus / learn / semesters 三处（发起捕获代次 + 每个结算点陈旧守卫 + 冷却态安排自动重试 + 警示只在 `exhausted` 之后 + 仍只有真 `failed` 才 `backToLogin`）；㉕-5 四出口自增 + `useApp()` 暴露；㉕-6 重试按钮先 await 清冷却再重载（置忙）；㉕-7 链外结算铁律只经 `settleLibSoftPending`、绝不 `await pending`；㉕-8 同时吃 lib 冷却与 relearn 节流剩余。
  **反例自检 5 例（备份建立在最终代码上，注入 → 该护栏 exit=1 红 → `cp` 还原 → md5 逐字节一致 → exit=0；红点原文存 `/tmp/b31-ce/*.out`）**：① `useCampusData` 的 4 处 `epochStale(epochAtStart)` 全部改成 `false`（撤掉 RC2 守卫）→ 红在「㉕-4 campus 的每个结算点都必须有陈旧守卫（epoch 变了一律不写回）」；② campus 的 `armLibSoftAutoRetry(...)` 判定改成 `if (true)`（冷却态直接弹警示）→ 红在「㉕-4 campus 的 skipped/cooldown 必须安排自动重试」+「警示只允许出现在自动重试用尽之后」；③ `LIB_SOFT_AUTO_RETRY_MAX` 改成 999（放开上限）→ 红在「㉕-2 自动重试上限必须是 3 次」+「用满 3 次必须报 exhausted」+「㉕-3 用尽后返回 exhausted（不无限重试）」；④ `ErrorNote` 改回 fire-and-forget（清冷却之前就 `onRetry()`）→ 红在「㉕-6 必须先 await 清冷却，再触发 onRetry」+「清冷却之前不许先触发 onRetry（旧 fire-and-forget 竞态）」；⑤ 去掉 `AUTO-RECOVER` 摘要模板 → 红在「㉕-3 AUTO-RECOVER 摘要每 epoch 至多一条」+「㉕-7 AUTO-RECOVER 摘要模板在位」。还原后三文件 md5：`data.ts` `7dc81f0f…`、`libSoftAutoRetry.ts` `6fd118d6…`、`Layout.tsx` `d758b1fd…`，`md5sum -c` 三个 OK。
  **真机 AFTER（K30，b31 干净包，APK 18654077 字节 / md5 `4f1555009e13540b85924ddbc9868c5e`；exe 19514368 字节 / md5 `493764fc9a604ef51ef929190e8285a0`；与 b29 APK `5de85f8c…` / b29 exe `afc48a9d…` 均不同字节）**：
  - **场景①（瞬时失败 → 不弹警示、自愈；与 BEFORE 同一把触发）**：服务端登出（CDP `http_native` 打 `webvpn…/logout` → 200，落到 id 登录表单）后触发 boot。原始缓冲 `/tmp/b31-after-s1.log` 851 行、截图 `/tmp/b31-after-s1.png`。时间线（日志体内 UTC）：`17:27:09.193 SOFT-RELOGIN state=skipped reason=reentrant streak=0 cooldown=29s sites=[learn,card,seat,libroom,zhjw]` → `17:27:09.206 SOFT-RELOGIN state=failed streak=1 cooldown=60s sites=[learn]` → `17:27:09.450 / .683 SOFT-RELOGIN state=skipped reason=cooldown streak=1 cooldown=60s sites=[learn]`（这两条是登录前发出的旧代次请求）→ `17:27:12.544 SILENT-RELOGIN ok` + `17:27:12.546 BOOT-T trySilentRelogin(成功) +2609ms`（代次 +1）→ 旧代次请求全部被守卫丢弃：**0 条 `CAMPUS-AUTH-PENDING`、`.error-note` 全程 `null`、`.login-card` 0**，登录就绪后同代次重新加载拿到真数据（今日页「10月5日 星期一 · 今天没有课，自由安排」、`.nav-item` = 16）。对照 BEFORE：同一把触发下 b29 在 `trySilentRelogin(成功) +2620ms` 之后仍打 `PAGE-ERR CAMPUS-AUTH-PENDING` 并常驻警示条。
  - **场景③（设置 → 账号 → 退出登录 → 登录，连续 3 轮；watcher 每 2 秒采样 `.login-card`，起于本地 17:31:12，覆盖 429 秒）**：三次登录均成功（`01:31:58` / `01:33:34` / `01:36:33` 三处 `.login-card` 1→0），三次都回到应用内（`#/today`、`.nav-item` = 16、`.error-note` false）。三次「登录页出现」的时刻分别是 `01:33:00`、`01:36:15`（后两次与人工退出登录点击对齐：17:33:11 / 17:35:45），第 3 轮登录后观测窗 108 秒无闪回。
  - **反例（必须记，未修好）**：第 1 轮登录完成后 **62 秒**（设备 `17:32:58` / watcher `01:33:00`，此时 hash 仍是 `#/today`，人工退出点击发生在 11 秒之后的 17:33:11，故与人工操作无关）出现一次**自发闪回登录页**。同一窗口的原始缓冲 `/tmp/b31-after-s3.log`：`17:32:58.055 AUTO-RECOVER attempt=1/3 waiters=1`（有并发加载被冷却判掉、按新机制挂上自动重试）→ `17:32:58.177 [NATIVE-HOP0] 403 GET …/b/kc/zhjw_v_code_xnxq/getCurrentAndNextSemester` → `17:32:58.293 PAGE-ERR CAMPUS-AUTH 会话已失效，需要重新登录` → `17:32:58.478 ILIB GET 200 …/grjbxx → {"result":"success",…}` + `17:32:58.490 SOFT-RECOVER[global] state=done (195ms)`（**全局恢复 195ms 就成功，证明会话是活的**）→ `17:32:58.542 LIB-AUTH 判定登录状态失效 signal=logged-out-page status=200` → `17:32:58.555 LIB-AUTH 重登未成功 → 不重放，原样交回调用方` → 页面层据此判 `failed` → `backToLogin()`。**机制结论**：RC2 的原始机制（登录**前**发出的请求在登录**后**结算、无代次校验）已被代次守卫拦住（本次事件的发起与结算都在同一代次内，守卫按设计不拦）；真正把用户踢出去的是**同一代次内的两跳误判**——campus 第一跳 `softRecoverResult("campus")` 被冷却判掉（`skipped`，不登出），第二跳 `relearnRoamOnce()` 的 `AI-TUOJ` 漫游请求拿到 id 登录链 200 页 → `LIB-AUTH` 判 `logged-out-page` → `failed`，于是 b19「任一入口真 `failed` 即登出」契约生效；而 67 毫秒之前全局恢复已经成功。即「两个恢复入口互相打架、后判者覆盖先成的成功」。**本条是 b19/b16 判活口径的既有残余被新取证方式暴露，b31 的收敛目标（RC1 警示 + 陈旧代次）已达成，但「闪回登录页」这一症状在真机上仍能复现一次**——如实记，不主张 P0 已彻底关闭。
  - **场景②（持久失败 → 有限次后如实提示、不无限重试不刷屏）未复现**：要让「冷却判掉」连续 3 次而没有一次真执行，需要 id 侧在同一窗口持续拒绝且冷却不断被其它恢复入口续期（每次自动重试的间隔就是「冷却剩余 + 抖动」，冷却过期后那次必然真执行——真执行成功则自愈、真执行失败则按契约落登录页），本轮设备窗口内没有造出这个条件。有限性与不刷屏由护栏确定性证明：㉕-2（上限 3、用尽 `exhausted`）+ ㉕-3（同一 epoch 一个定时器多等待者、`AUTO-RECOVER` 每 epoch 至多一条）；真机只取到 1 条 `AUTO-RECOVER attempt=1/3 waiters=1`，无重复、无风暴。
  **未取到 / 残余（如实记）**：① **RC2 的独立复现（陈旧代次版本）未取到**——b29 上按服务端登出 + boot 自动重登 + 刷新走查，`SOFT-RELOGIN` 结算落到 `failed` 的陈旧请求没有稳定造出来（前一次真失败把冷却置成 60s，后续同窗请求都落 `skipped/cooldown`，走的是 RC1 而非 RC2 支），因此 RC2 用确定性护栏（㉕-4 三处路径 + `authEpoch` 四出口）证明新旧判定差异；真机取到的是**另一条同代次误判路径**（见上条反例），已如实登记为未修好项。② 触发那次 60s 冷却的是一次真失败 `LIB-ENSURE verifyAndReLogin 失败：Failed to get public key.`（id 侧对设备的风控限流，属本节已登记的 cab/id 风控域，**不在本仓自愈范围**）：修复后「冷却窗内不再弹警示、冷却到期自动重试并自愈」；**若 id 侧风控仍在拒绝，则在有限次重试后如实提示——那是设备级限流，不是本仓可自愈的**，不主张「彻底修好自动登录」。③ F3 ③ 触发面下移与 ④ 两条旁枝（其余票种无主动核对、冷启原生仓从 `(无)` 起落盘链路）本轮未动，状态照旧。④ **下一轮的最小修复方向（未实施）**：`failed` 落 `backToLogin()` 之前先复核「同窗口是否已有恢复成功」——例如以只读的 `libSoftRecoveryInFlight()` / 全局恢复时间戳为准，若 500ms 内全局恢复为 `done` 则不登出、改为原地重取；或在两跳都 `failed` 时才登出。**这改动会碰到 b19「任一入口真 failed 即登出」契约与 ㉓-1/㉕-4 的结构断言，须单独一轮并同步改护栏与文档，本轮不做。**
  **门禁**：`pnpm guard` exit 0、`pnpm test` 23/23、`apps/desktop` 下 `npx tsc --noEmit` 无输出、`node tools/docs-prose-lint.mjs` 21 份文档 0 处违规。

  **修复落地（b33，提交 `e3adb3e3`（代码+护栏））：第三条路径——同代次两跳误判不再踢掉活会话**
  **病根（b31 反例的机制）**：同一代次内 campus 加载的两跳结论相反——第一跳 `softRecoverResult("campus")` 被冷却判掉（`skipped`，按 b19 不登出），第二跳 `relearnRoamOnce()` 的 `AI-TUOJ` 漫游请求拿到 id 登录链 200 页 → `LIB-AUTH` 判 `logged-out-page` → 结算成 `failed`，触发 b19「任一入口真 `failed` 即登出」把用户送回登录页；而 67ms 之前 `SOFT-RECOVER[global] state=done (195ms)` 已证明会话是活的。真机上的触发机构是 b31 自己的有界自动重试：登录时一次真失败留下 60s 冷却 → 页面加载落 `skipped/cooldown` 并挂上 `AUTO-RECOVER` → 约 60s 后定时器真执行、重跑该加载，这次两跳都真跑，第二跳撞上漫游登录页。
  **设计（霖 2026-10-05 裁定：选 A）**：A ＝ `failed` 落 `backToLogin()` 之前先做**只读存活复核**，命中则不登出、改为**有限次**原地重跑该加载。B ＝「两跳都 `failed` 才登出」未采纳，理由：B 只把登出推后到第二个 `failed`，在没有任何存活证据时同样会延迟一次诚实落登录页；且它要改 b19「任一入口 `failed` 即登出」的判定形状本身（一条 `failed` 不再等于登出），护栏 ㉓-1 / ㉕-4 的语义要整体重写。A 只用正证据（同一代次本次加载期间出现过恢复成功、或宽限窗内刚成功、或恢复仍在飞）覆盖 b19，`failed` 的含义一字未改。
  **改动面**：`lib/libSessionGuard.ts` 新增只读观测 `libSoftLastDoneAtMs()`（只在 `ok === true` 支写时间戳，不参与判定，测试复位一并清零）；`state/libSoftSettle.ts` 新增零依赖只读 `libSoftSessionLooksAlive({ doneAtStart, doneNow, recoveryInFlight, now, graceMs })` → `{ alive, verdict }`，优先级 `done-after-start`（本次加载发起后又有恢复成功，最强证据）> `recent-done`（`0 ≤ now - doneNow ≤ LIB_SOFT_ALIVE_GRACE_MS`，10s）> `in-flight`（`libSoftRecoveryInFlight()`）> `none`；`state/data.ts` 三处加载路径的 `failed` 分支在 `backToLogin()` 之前复核，命中则 `armLibSoftAutoRetry(当前代次, max(libSoftCooldownLeftMs(), relearnRoamCooldownLeftMs()), autoRetry, { recoveryInFlight: false })` 并打一条 `LIB-AUTH-ALIVE-RECHECK <CAMPUS|LEARN|SEMESTERS>-AUTH verdict=… arm=armed|exhausted`，`arm === "exhausted"` 时仍落 `backToLogin()`（复核命中也**不**允许无限重试）；`recoveryInFlight: false` 是有意为之——在飞判据已经命中，这一跳必须由本次加载自己负责重跑，不能被「有在飞恢复」短路成空转。
  **没动的**：三态（`done|failed|skipped`）与 `reason`、单飞与 30s/120s 冷却、`skipped/reentrant + pending` 链外结算、b23 有界重放、b31 自动重试上限 3 与每 epoch 一条摘要、b19「真 `failed` 才登出」契约、用户文案纪律（仍只说「登录状态 / 登录信息」）；**cookie 仓同步 / 回灌 / 清仓语义零改动**（b21、b23 红线），触发面没有下移到 `nativeFetch`，`packages/core` 零改动。
  **护栏**：`tools/relogin-test.mjs` ——（a）㉓-1 重写：判定窗口 1200→3000 字符（新代码里 `catch` 到 `backToLogin()` 的距离为 1466–2104 字符），要求最后一个 `catch (` 之后的区间含 `state === "failed"`，且**要么**为 `failed` 直接登出（旧形态），**要么**满足有序形状 `state === "failed" → libSoftSessionLooksAlive(…) → armLibSoftAutoRetry(…) → backToLogin()`；（b）㉕-4 增加断言：三处都捕获 `doneAtStart` 并在结算时读 `libSoftLastDoneAtMs()`、三处都有上述有序形状、`recoveryInFlight: libSoftRecoveryInFlight()` 只用于复核、命中后的重跑必须传 `recoveryInFlight: false`、日志模板 `LIB-AUTH-ALIVE-RECHECK` 在位；（c）新增 ㉖ 组回答「A 侧不许假阳、B 侧不许吞真失败」：㉖-1 时间戳只允许挂在 `if (ok)` 支（运行期 + 结构 + 访问器三个角度）；㉖-2 判据真值表 8 例（本次加载期间的恢复成功算活、只有更早的成功不算、宽限窗内算活、边界 `age = grace` 算活 / `grace + 1` 算死、在飞算活、无证据算死、`LIB_SOFT_ALIVE_GRACE_MS === 10_000`）；㉖-3 与运行期同构的 `decide()` 双侧镜像（活 / 在飞 → 重跑；死、或用尽 3 次 → 落登录页）。受影响的两条断言（㉓-1 / ㉕-4）改的是判定形状与窗口，含义仍是「不许无证据踢人、真失败仍要登出」。
  **反例自检 6 例（备份建在最终代码上：`/tmp/b33-ce/backup/{data.ts,libSessionGuard.ts,libSoftSettle.ts}` + `backup.md5`；注入 → `node --experimental-strip-types tools/relogin-test.mjs` 返回 `exit=1` 红 → `cp` 还原 → md5 逐字节一致 → 返回 `exit=0` 绿；红点原文 `/tmp/b33-ce/out/ce1…ce6.out`）**：
  ① 撤掉 `done-after-start` 判据（本次加载期间的恢复成功不再算存活）→ `✗ ㉖-2 本次加载期间有恢复成功（代次未变）= 最强存活证据` + `✗ ㉖-3 (A) 会话有存活证据 → 绝不登出，改为有限次重跑该加载`；
  ② 撤掉 `in-flight` 判据 → `✗ ㉖-2 仍有恢复在飞时算存活证据（等它的结论，不登出）` + `✗ ㉖-3 (A) 仍有恢复在飞 → 不登出、有限次重跑（等结论）`；
  ③ 时间戳改成「只要 `runLibSoftSingleFlightResult` 被调用过就记」→ `✗ ㉖ 真失败（failed）绝不许写「最近恢复成功」时间戳` + `✗ ㉖ 时间戳必须挂在「ok === true」支上（不许在 failed / skipped 分支写）`；
  ④ 三处 `failed` 支改回直接 `backToLogin()` 并撤掉存活复核 → `✗ ㉓-1 data.ts 每个 backToLogin() 的最近判定都必须是 failed 三态支（实际违规 3 处）` + `✗ ㉖ campus failed 支的顺序必须是「存活复核 → 有限次重跑 → 才 backToLogin」` + `✗ ㉖ campus 复核命中后的重跑必须传 recoveryInFlight:false（否则「在飞」这一支无人重跑）`；
  ⑤ `LIB_SOFT_ALIVE_GRACE_MS` 改成 60s → `✗ ㉖-2 基线内的旧成功不许当成新证据（必须严格大于 doneAtStart）` + `✗ ㉖-2 宽限窗外且无在飞恢复 = 真死（不许无限宽限）` + `✗ ㉖-2 宽限窗必须是 10s（真机事件里 done 比误判早 67ms）`；
  ⑥ 复核命中后的重跑传 `recoveryInFlight: true`（会被在飞判据短路成空转）→ 3 × `✗ ㉖ <campus|learn|semesters> 复核命中后的重跑必须传 recoveryInFlight:false（否则「在飞」这一支无人重跑）`。
  还原后三文件 md5：`data.ts` `d5fb186a5e2164a13df916300708fb69`、`libSessionGuard.ts` `8ee088f93e6962e4dd0b26a36cef6549`、`libSoftSettle.ts` `89eddfffbc30244e99d4a600d1ac4871`。
  **真机 AFTER（K30，Redmi K30 Pro Zoom / Android 12 / WebView 96；b33 干净包 APK 18654077 字节 / md5 `e8360014738e8b01aff56481413fc4db`、exe 19550720 字节 / md5 `3f6cb420a8bebf38a62719619429a25b`，与 b31 的 `4f155500…` / `493764fc…` 均不同字节；exe 用 `cargo-xwin` + `--target x86_64-pc-windows-msvc` 得到裸二进制，tauri 的 NSIS 打包步在 Linux 上取 NSIS 返回 http 500 而失败、不影响 exe；原始缓冲 `/tmp/b33-k30-run4.log` 1823+ 行、探针 `/tmp/b33-k30-watch4.log`、构建日志 `/tmp/b33-exe-build4.log`，均不在仓库内）**：
  - **复现第三条路径**：先按「设置 → 账户 → 退出登录 → 手动登录」走一轮（b31 场景③）——登录前 `10:36:58.363 SOFT-RELOGIN state=failed streak=1 cooldown=60s`（真失败留下 60s 冷却），`10:37:52.017 LOGIN-OK`，登录后第一次 campus 加载 `10:37:53.099 PAGE-ERR CAMPUS-AUTH` → 两跳均为 `skipped/cooldown` → 挂上有界自动重试。
  - **触发机构（与 b31 反例同构）**：`10:38:52.711 AUTO-RECOVER attempt=1/3 waiters=1`（约 60s 后定时器真执行重跑）→ `10:38:52.979 PAGE-ERR CAMPUS-AUTH` → `10:38:53.124 SOFT-RECOVER[global] state=done (147ms)`（会话是活的）→ **`10:38:53.949 LIB-AUTH-ALIVE-RECHECK CAMPUS-AUTH verdict=done-after-start arm=armed`**。修复前这一处就是 `backToLogin()`；修复后**没有登出**：探针每 2s 采样 `.login-card` 恒 0、`.nav-item` 恒 16、`#/today` 不变。
  - **（B）侧（用尽后仍如实落登录页，不吞失败、不卡坏页面）**：`10:39:23.534`、`10:39:53.765` 两次重跑同样 `verdict=done-after-start`（`10:39:53.893 SOFT-RECOVER[global] state=done (195ms)`），第三次 `10:39:54.509 LIB-AUTH-ALIVE-RECHECK CAMPUS-AUTH verdict=done-after-start arm=exhausted` → 按设计落 `backToLogin()`，探针随即读到 `.login-card` = 1（`10:40:26`），**没有卡在坏页面、也没有无限重试**；随后手动登录恢复正常（`10:40:40.661 LOGIN-OK`，`.login-card` 0、`.nav-item` 16）。同一台真机上（A）「同代次两跳不再踢掉活会话」与（B）「有界次数后如实落登录页」双侧都取到。
  - **本轮的真失败域（如实记）**：这台设备当时 campus 数据链在三次重跑里都拿不到有效响应（重跑里 `[NATIVE-HOP0] 302 → id 登录表单 200`），所以 3 次臂耗尽后落登录页是诚实结果、不是误判；全局恢复成功只证明门户与其它站点活，不等于这条数据链活。会话真死（复核 `verdict=none`）那一侧本轮没有单独留下日志——按最终代码，`LIB-AUTH-ALIVE-RECHECK` 只在复核命中时打印，未命中直接 `backToLogin()`，因此（B）的真机证据是「3 次臂用尽后 1s 内 `.login-card` 上屏」这条时间线，另有护栏 ㉖-3 的确定性镜像。
    ↩ **b36 已补（提交 `449a8fb7`）**：真死侧现在会落一行 `LIB-AUTH-DEAD verdict=none scope=<SCOPE> hits=<n>`（每 epoch 至多一条、行内只有 verdict / scope / hits），K30 真机取到 `scope=CAMPUS-AUTH hits=1` 并如实落登录页；详见本节 b36 段。
  **门禁**：`pnpm guard` exit 0、`pnpm test` 23/23、`apps/desktop` 下 `npx tsc --noEmit` 无输出、`node tools/docs-prose-lint.mjs` 21 份文档 0 处违规。

- **修复落地（b36，代码提交 `449a8fb7`（真死侧日志）+ `8da219ec`（口径 1 触发面唯一））**：霖 2026-10-05 裁定**口径 1**（§22.3 第 2 条）——把 Tauri 下 `universalFetch` → `tauriFetch` 那一跳也收进 ③ 判定，消灭 b17 / b18 遗留的绕过通道；**不删** renewers / `learn.reloginHook` / 看门狗（b17 有意保留，同样落共享单飞）；**判据集合一个字未改**（仍是 `isLibAuthFailureText` + `looksLibLoggedOut`，401 / 403 不在本轮）；并补上 b33 遗留的**真死侧日志**。
  - **实现（`apps/desktop/src/lib/transport.ts`）**：抽出唯一判定入口 `judgedNativeFetch(url, attempt)`——`withLibAuthRecovery` 全仓只此一处（护栏 ㉘-1 钉死）；两条原生通道各一层薄壳：`nativeFetch` → `nativeFetchOnce`（`http_native`）、`tauriFetch` → `tauriFetchOnce`（`http_request` 逐跳循环）。两个原语**不含判定、互不调用、保持私有**，公开面只有受判定的 `nativeFetch` / `tauriFetch`，`invokeHttp` 未导出 ⇒「每条请求恰好一次判定、不可能双重包装」由结构本身保证（㉘-2 / ㉘-3）。恢复动作仍只有一个调用点（注入的唯一钩子），两通道共用同一个 `nativeFetchAuthHooks` 单例 = 同一把共享单飞。
  - **真死侧日志（`state/libSoftSettle.ts` + `state/data.ts`）**：新增零依赖计数式闸门 `claimLibAuthDeadLine(epoch, scope)`——campus / learn / semesters 三处在 `libSoftSessionLooksAlive()` 判 `verdict=none` 的 `else` 支、`backToLogin()` **之前**落一行 `LIB-AUTH-DEAD verdict=none scope=<SCOPE> hits=1`；同 epoch 其余只计数不刷屏，epoch 变化整只重置。行内只有 verdict / scope / hits 三个字段，scope 是闭合字面量集合，**绝不打印凭据、票值、URL 或查询串**（连错误原文也不进这行）。语义零改动：`failed` 仍是唯一允许登出的三态，存活支一行未动（仍只打 `LIB-AUTH-ALIVE-RECHECK`），b19 / b22 / b23 / b31 / b33 契约与 cookie 仓语义（b21 / b35 红线）一行未动。
  - **护栏**：`tools/relogin-test.mjs` 新增 ㉘ 组（判定入口唯一 / 两条通道都经它 / 原语无判定且互不调用 / 原始 invoker 未导出 / 恢复动作只一个调用点 / 两通道共用同一钩子；行为上「一次失效 = 恰好一次判定 + 一次重登 + 一次重放」「正常 200 = 一次判定 0 恢复」「两通道并发同一失效真重登仍只一次」）与 ㉖-4（真死必有一条 / 每 epoch 至多一条 / 计数式 / epoch 变化重置 / 行内字段取值范围闭合 / 不含 URL·查询串·票值·凭据）；⑭ 的 `attempt: () => nativeFetchOnce(url, init)` 断言改为 `judgedNativeFetch(url, () => nativeFetchOnce(url, init))`——**形状变了、含义没变**。反例 **7 例**（ce1 `tauriFetch` 绕过入口 / ce2 原语互调双重包装 / ce3 判定入口双触发 / ce4 每 epoch 多条 / ce5 撤 campus 真死日志 / ce6 模板多插字段 / ce7 打进存活支）：逐例注入 exit=1 → `cp` 还原 md5 逐字节一致 → exit=0，备份建在最终代码上。
  - **真机（K30 / Redmi K30 Pro Zoom / Android 12 / WebView 96，dev 包 `app.onethu.desktop.dev`；APK 18,764,669 字节 / md5 `19b04317d04a6c713050a0356f26f0c4`；原始 buffer `/tmp/b36-k30-forensics.log` 7454 行）**：① **真死侧新日志取到**——把「记住密码」凭据在应用自身存储里备份后暂时摘除（不落盘明文，事后按 hash 逐字节还原 `c0e6a83f`），服务端登出（CDP `http_native` 打 `webvpn…/logout` → 200 落到 id 登录表单）后重挂今日页触发 campus 加载：`CAMPUS-AUTH` 失败 → `SOFT-RELOGIN state=failed streak=2 cooldown=120s sites=[seat]` → **`05:02:52.290 LIB-AUTH-DEAD verdict=none scope=CAMPUS-AUTH hits=1`** → `.login-card` 1 / `.nav-item` 0（如实落登录页）；同一 buffer 全量只有这 **1** 条 `LIB-AUTH-DEAD`。② **单次触发 / 不重复登出**：同一现场 163 条 ③ 判定逐条后面只跟一条 `LIB-AUTH signal=… → 共享单飞重登一次`，恢复侧 `SOFT-RELOGIN state=skipped reason=reentrant` 22 条（同一条在飞链被合并、不重复执行）、`state=done` 2 / `state=failed` 5，无重登风暴。③ **存活侧不踢**：服务端登出后点顶栏硬刷新触发 boot 那一轮，campus / learn 的 ③ 判定全部走既有三态口径，`.login-card` 全程 0、`.nav-item` 16，`BOOT-T learn.resume(过期) +2758ms` 之后页面留在原页；另一次 boot 里静默重登成功（`BOOT-T learn.resume(会话活) +198ms` → `SOFT-RELOGIN state=done` → `BOOT-T READY +1010ms`）。④ **新通道（此前绕过 ③ 的 `tauriFetch`）**：`[HOP]`（tauriFetch 专有逐跳日志）实测该通道确实在跑——THUbook 页 53 跳 `thubook.help/…`、洗衣机页 `api.cleverschool.cn` / `yshz-user.haier-ioc.com` / `app.cs.tsinghua.edu.cn/Api/JieliWashers?building=…` 200、`wash-ltd-thu.aajax.top/buildings/list` 502；**但会话真死时这一通道上造不出鉴权类失败**：可达端点全是公开 / 外部接口（`app.cs` 直连 `http_request` 与 `http_native` 都返回 `{"1":"1"}` 200；水站 `dingshui.bjqzhd.com` 明标公开且不走 WebVPN；CourseInfoTab 走 `tsinghua.app`；market / cloudCal / exthw 全为外部域），故「该通道上真实鉴权失败 → 被 ③ 捕获 → 共享单飞 → 重放一次」这一条**未取到**；该通道进入唯一判定入口由护栏 ㉘-2 / ㉘-3 结构性钉死 + 反例 ce1 / ce2 覆盖，真机只取到「通道在跑」与「非鉴权失败（502）不被 ③ 误当失败」两条旁证（判据集合未放宽的实证）。⑤ **K90 未取到**：本轮开工时已离线（`adb connect` 目标计算机积极拒绝、`ping` 100% 丢包、`adb mdns services` 空），K90 侧读数与「现代引擎无回归」本轮**未取到**，须等它重新上线后补。⑥ **已知外溢（如实记）**：触发面下移后，`universalFetch` 上那些外部 / 非清华消费方（market、exthw 雨课堂 / 拓课 / tyche / dsa、cloudCal、trace、thubook、plugins 出口、DormTab 水站、洗衣机）在 Tauri 下也走 ③ 判定——它们若真返回「像登录页」的 200 或鉴权类错误文案，会触发一次全链恢复；有共享单飞 + 30s / 120s 冷却兜底、不会登出，但属如实登记的新风险面（判据不动，401 / 403 不纳入）。
  **门禁**：`pnpm guard` exit 0、`pnpm test` 23/23、`apps/desktop` 下 `npx tsc --noEmit` 无输出、`node tools/docs-prose-lint.mjs` 21 份文档 0 处违规。

- **判定域限缩（b38，代码提交 `1125ec4c`）**：霖 2026-10-05 裁定把 ③ 判定**限缩到清华 / WebVPN 域**，收口 b36 段 ⑥ 如实登记的已知外溢。**判据集合与其余语义一行未动**：仍是 `isLibAuthFailureText` + `looksLibLoggedOut`（401 / 403 不纳入），三态 / 单飞 / 链外结算 / b23 有界重放 / b19「skipped 不登出」/ b33 存活复核与 10s 宽限 / auto-retry 上限 / b36 的 `LIB-AUTH-DEAD` / cookie 仓语义（b21 / b35 红线）全部保留。
  - **gate 位置与理由**：闸落在**唯一判定入口** `judgedNativeFetch()` 的第一步——`if (!isLibAuthJudgeUrl(url)) return (await attempt()).res;`：域外请求直接执行单次请求原语、不进 `withLibAuthRecovery`、不落 `LIB-AUTH`，原结果 / 原错误原样交回。**两条原生通道（`nativeFetch` 的 `http_native` 与 `tauriFetch` 的 `http_request`）一并生效**：若只加在 `tauriFetch` 薄壳上，会重新出现「某条通道漏 gate」的结构性缺口（与 b36 的「触发面唯一」相抵）；而 `nativeFetch` 在本仓的消费方（`http` / `learnHttp` / `session.fetchLike` / `venue` / `infoLib` / xk `isoFetch`）全部是清华 / webvpn 域，域闸对该通道**零行为变化**——清华会话链的捕获能力不因本轮减少任何一条请求（护栏 ㉙-2 / ㉙-3 钉死）。
  - **域名单来源（不新造）**：判据在 `apps/desktop/src/lib/libSessionGuard.ts`：`LIB_AUTH_JUDGE_HOST_BASE = "tsinghua.edu.cn"` + `isLibAuthJudgeUrl()`，与三处既有常量同源——(1) `transport.ts` 的 `nativeFetchOnce()` 域分流判据 `h.endsWith("tsinghua.edu.cn")`（护栏断言域基与它逐字相等）、(2) 同模块 `sitesOfLostHost()` 的五个站点域（护栏从源码机械提取，逐个落判据内）、(3) `packages/core/src/crypto/webvpn.ts` 的 `WEBVPN_ROOT`（webvpn 包装 URL 的物理域）。判据取**带点后缀**（比 (1) 的裸 `endsWith` 更窄）：`eviltsinghua.edu.cn` 这类近似域与 `tsinghua.edu.cn.evil.com` 这类后缀伪装域都不算清华域；空值 / 畸形 URL 一律不判（不猜）。
  - **边界（如实记）**：`tsinghua.app`（CourseInfoTab / coursex）不是 `tsinghua.edu.cn` 子域，按 b36 段的既有归类（外部域）随本轮退出判定面；market、exthw 拓课 / 雨课堂 / tyche / dsa、cloudCal、trace、thubook、plugins 出口、水站、洗衣机外部域同样退出。清华一侧照旧全部留在判定面内：learn / info / card / seat.lib / cab.lib / zhjwxk.cic / zhjw.cic / id / oauth / madmodel / `app.cs` / mails / myhome / dzpj / venue 与 webvpn 包装 URL；`id.tsinghua.edu.cn` 登录链的既有「认不出站点 → 不重登」由 `isLibLoginChainUrl()` 原样守住（该闸与 B 兜底未动）。
  - **护栏**：`tools/relogin-test.mjs` 新增 ㉙ 组——㉙-1 外部域不触发（拓课 `ai.tuoj.thusaac.com`、market `api.github.com`、雨课堂 `pro.yuketang.cn`、`thubook.help`、trace `restapi.amap.com`、`tsinghua.app`、洗衣机外部域逐个为证；近似域、后缀伪装域、空值与畸形 URL 逐个为反例）· ㉙-2 清华 / WebVPN 域仍触发（17 条真实域逐个为证）· ㉙-3 域名单与既有常量同源（域基逐字相等 / 站点表机械提取后全落判据内 / `WEBVPN_ROOT` 落判据内 / 判据本体不许出现字面域名）· ㉙-4 判定入口仍唯一（`withLibAuthRecovery` 全仓只 `transport.ts` 一处调用，扫 `apps/desktop/src` 与 `packages`）· ㉙-5 域闸挂在唯一入口最前面、域外只执行原语一次、判据来自共享模块。**㉘ 的入口形状未变**（两条通道 → `judgedNativeFetch`，⑭ 的 `judgedNativeFetch(url, () => nativeFetchOnce(url, init))` 断言逐字照旧），本轮只是入口内部多一道域闸——**形状没变、含义多了一层域界**。
  - **反例 6 例（备份建在最终代码上，`/tmp/b38-ce/backup/{transport.ts,libSessionGuard.ts,relogin-test.mjs}` + `backup.md5`；逐例注入 → `node --experimental-strip-types tools/relogin-test.mjs` 返回 `exit=1` → `cp` 还原 → md5 逐字节一致（`d4b6c979…` / `fc5321a6…` / `959c9f35…`）→ `exit=0`；红点原文 `/tmp/b38-ce/out/ce1…ce6.out` 与汇总 `/tmp/b38-ce/run.log`）**：① 撤掉域闸 → `✗ ㉙-5 域闸必须在唯一判定入口的判定之前` + `✗ ㉙-5 域外分支必须只执行原语一次并原样返回（不判、不恢复、不落 LIB-AUTH）`；② 域闸挪到判定之后 → `✗ ㉙-5 域闸必须在唯一判定入口的判定之前`；③ 判据退化成裸后缀 → `✗ ㉙-1 近似域（裸 endsWith 会放它进来的 eviltsinghua.edu.cn）必须不算清华域——判据是带点后缀`；④ 判据里写外部域字面量（`yuketang.cn` / `github.com`）→ `✗ ㉙-1 外部域不许进 ③ 判定：market…` + `✗ ㉙-1 外部域不许进 ③ 判定：雨课堂…` + `✗ ㉙-3 判据里不许写任何字面域名`；⑤ 域基换成 `tsinghua.app` → `✗ ㉙-3 判定域基必须与 transport.ts 域分流判据同源（transport=tsinghua.edu.cn / 判据=tsinghua.app）` + 17 条 `✗ ㉙-2 清华 / WebVPN 域必须照旧进 ③ 判定：…` + 5 条站点表域 + webvpn 落点共 25 条红；⑥ 复制第二处判定入口 → `✗ ㉘-1 判定入口必须唯一（transport.ts 里 withLibAuthRecovery 实际 2 处）` + `✗ ㉙-4 withLibAuthRecovery 全仓只许一处调用（唯一判定入口；实际 ["apps/desktop/src/lib/transport.ts×2"]）`。
  - **真机（K30 与 K90 均已取到）**：K30 `9602814b` / Redmi K30 Pro Zoom / Android 12 / WebView 96，dev 包 `app.onethu.desktop.dev`（pid 13021）；APK 18,764,669 字节 / md5 `4d2383cfa0cf8c2846d89e29cd7eeac8`（`/mnt/c/temp/onethu-b38-dev.apk`）。Windows 侧 adb 走 `-P 5037`（按 `docs/BUILD-AGENT-GUIDE.md` 里的 5137 取设备会显示 offline）。取证口径沿用 b36：`adb shell log -t onethu "<标记>"` 打窗口边界，CDP（`/tmp/b38-ev.mjs`）驱动页面与求值，logcat 落 `/tmp/b38-k30.log`。**K90 首次尝试时离线**（`adb mdns services` 为空，`adb connect` 对 `192.168.18.169:33029` 与 `:5555` 均报「由于目标计算机积极拒绝，无法连接。(10061)」），15:41 自行回到 mDNS（**新端口 `192.168.18.169:38427`**，app pid 未变，故前面的读数继续有效），补测读数见本节末条。
  - **读数①（外部域不再进 ③ 判定）**：窗口一（会话活，13:58:52.791 → 13:59:13.083，CDP 进洗衣机独立页 `#/washer`）6 条 `[HOP]`——`api.cleverschool.cn/washapi4/device/tower` 200、`yshz-user.haier-ioc.com/position/nearPosition` 200 ×2、`wash-ltd-thu.aajax.top/buildings/list` 502、`api.cleverschool.cn/washapi4/device/status` 200、`app.cs.tsinghua.edu.cn/Api/JieliWashers` 200——窗口内 `LIB-AUTH` **0 条**；窗口二（会话已被服务端登出，14:33:39 起 12s，同样进洗衣机页）6 条 `[HOP]`（5 条域外 + 1 条 `app.cs`）、`LIB-AUTH` **0 条**：域外请求照常发出、照常回结果，全程无 `LIB-AUTH signal=…`。如实记边界：洗衣机这些真实域外端点回的是 JSON，b36 的「200 + 登录页形态」本来也匹配不上，故这段是「无新增触发」的观测；域限缩本身的判别力由护栏 ㉙-1 与反例 ③④ 兜底（真机上没有可控的「域外域 + 登录页形态 200」端点，未新造）。
  - **读数②（清华会话链判定照旧）**：服务端登出（`http_native` GET `https://webvpn.tsinghua.edu.cn/logout` → 200，落 `id.tsinghua.edu.cn/do/off/ui/auth/login/…`）→ reload boot：`LIB-AUTH 判定登录状态失效 signal=logged-out-page status=200` → `LIB-AUTH signal=logged-out-page sites=[learn] siteSrc=request → 共享单飞重登一次` → `LIB-AUTH signal=… escalate=true reason=login-page-with-creds×3 hits=3` → `LIB-AUTH 兜底升级：全链恢复（门户判活 + 五站点补建）`；同窗口 `id` 登录链仍是 `sites=[] siteSrc=none 兜底判定 escalate=false reason=login-chain-page hits=0` + `重登未成功 → 不重放`（认不出站点 → 不重登未变）。整轮 logcat：`判定登录状态失效` 329 条、`sites=[learn]` 58 条、`兜底升级` 7 条、`SOFT-RELOGIN state=failed` 7 条 / `state=skipped` 35 条、`LIB-AUTH-DEAD` 0 条。
  - **读数③（活着一侧不踢）**：同一触发后的一轮 reload boot：`BOOT-T learn.resume(会话活) +228ms` → `SOFT-RELOGIN state=done streak=0 cooldown=30s` → `BOOT-T info.resume +1236ms` → `BOOT-T READY(总耗时) +1242ms`，CDP 求值 `{"hash":"#/today","login":0,"nav":16}`（`.login-card` 0 个）——恢复成功、界面未被踢到登录页。
  - **K90 补测（b39，2026-10-05；APK md5 `4d2383cf…`＝HEAD `ad888ed0`；Android 16 / WebView 143；原始 buffer `/tmp/b39-k90-b2b3.log`，窗口用 `adb shell log -t onethu "B39 …"` 成对标记，父会话按标记复核过计数）**：**外部域（读数①口径）** 两个窗口各 **6 条 `[HOP]`、`LIB-AUTH` 0 条**——窗口一（会话活，15:51:53.955→15:52:24.751）`api.cleverschool.cn/washapi4/device/tower` 200、`yshz-user.haier-ioc.com/position/nearPosition` 200 ×2、`wash-ltd-thu.aajax.top/buildings/list` **502**、`api.cleverschool.cn/washapi4/device/status` 200、`app.cs.tsinghua.edu.cn/Api/JieliWashers` 200；窗口二（**服务端登出 + reload 之后**，15:53:37.727→15:54:00.366）同型 6 条 `[HOP]`、`LIB-AUTH` **0 条**。**清华链判定照旧（读数②口径）**：`http_native` 打 `webvpn…/logout` 200 + reload 的窗口（15:52:32→15:53:36）内 `LIB-AUTH` 83 条、`[HOP]` 30 条、`PAGE-ERR` 0——`sites=[learn] siteSrc=request → 共享单飞重登一次`、`LIB-CRED 从「记住密码」回灌登录信息`、`escalate=true reason=login-page-with-creds×3 hits=3` → `兜底升级：全链恢复`，紧随 `SOFT-RELOGIN state=skipped reason=reentrant`（**合并证据**）与 `state=failed` 真执行 1 次，之后两次 `sites=[learn]` 判定均被 `state=skipped reason=cooldown` 判掉（`SOFT-RELOGIN` 合计 6 条＝1 真执行 + 5 skipped，**无重复登出 / 无重登风暴**）；`.login-card` 恒 0、`.nav-item` 恒 17。**现代引擎无回归（读数③口径）**：`/tmp/smoke.mjs` **18/18 路由 mounted**、`pagesFailedToMount: []`、`withErr: 0`、每路由 `err=0 rej=0`、`nav=17`（＝16＋1 个用户自建收藏夹）、`bnav=5`、`.toast-host` 可见错误条 0；`PAGE-ERR` 仅 6 条 `CARD / CARD-TX Failed to get public key.`（§22.4 ④ 已记的设备级风控，非渲染/挂载错误）；顶栏 `background-color: color(srgb 1 0.984314 1 / 0.86)` + `backdrop-filter: blur(10px)` + `::before content: none`（现代引擎不落兜底块）。恢复核验：登出后 60s 起 `#/learn` →「查看全部作业」仍加载 **9 行**、`PAGE-ERR` 0。**真死侧 `LIB-AUTH-DEAD` 该设备上仍为 0 条 ⇒ 未取到**（重登失败后同代次/冷却到期自愈、界面始终停在工作页；造真死侧需摘除霖保存的登录信息，按 §22.6 未获批准、一律不碰）。
  - **未取到（如实记）**：真死侧 `LIB-AUTH-DEAD` 与「如实落登录页」本轮**未取到**。K30 服务端登出后首轮恢复确会 `failed`（整轮 7 次），但同代次内后续重试（`AUTO-RECOVER` 与冷却到期）5 次 `done` 自愈，界面始终停在工作页；造真死侧需暂时摘除霖保存的登录信息（b36 当时的做法），按 §22.6 长期纪律本轮**未获单例批准、一律不碰**，故该项留空待批。
  **门禁**：`pnpm guard` exit 0、`pnpm test` 23/23、`apps/desktop` 下 `npx tsc --noEmit` 无输出、`node tools/docs-prose-lint.mjs` 21 份文档 0 处违规。


## 8. P 批 · PC 专属（另开一批，等霖发话）

> 口径：霖已定**先只做移动端**，以下条目原地不动，等 PC 批开工。每条同样要「改动面 / 要点 / 护栏 / DoD / 反例」。

| 编号 | 条目 | 关键点 |
| --- | --- | --- |
| C11 | 侧栏收起按钮位置跳走 | 收起后按钮必须**维持原位**（现在为避让「· 就绪」上移一格）；优先保证位置稳定，把状态徽标挪走而不是挪按钮 |
| C12 | 侧栏展开动画抽搐 | 现在「先出文字再展开」导致文字被挤成一列；应**文字整行一次出现**、侧栏作为遮罩逐渐展开；图标切换加平滑动效（只动 transform/opacity） |
| C13 | 左上角 logo | 现在是五列网格文字渲染。做成**单色 SVG 字标**（默认黑白）、颜色走主题令牌、复用既有 `theme.logoSvg` 主题接口（主题可整体替换） |
| C14 | Ctrl+K 搜索框焦点环与字体 | 焦点环按 C17 的容器口径统一；旁边「Ctrl+K」提示改等宽字体（现在落到了衬线栈） |
| C15 | 侧栏条目太多 | 见 §9 方案（一级精简 + 搜索置顶 +「更多」分组，预约/生活常驻，选课按选课季） |
| D6 | 侧栏伸缩舒张 | 与 C11/C12 同一处，一起做 |
| D8 | Ctrl+K 面板动画 | 面板渐升 + 周边模糊 + 黑暗遮罩渐入；结果项依次展开；搜索时**不匹配项右撤、新匹配项左插、其余项平滑位移**（手写 FLIP，禁止引入动画库）；reduced-motion 降级为淡入 |
| E2 | 侧栏与移动端割裂 | 与 C15 同批；侧栏条目应改为**消费 `NAV_REGISTRY`**（现在 `Layout.tsx` 里手写 14 项、与注册表和移动端底栏都没对齐——这是「割裂」的根因） |
| B5 | PC 收藏夹高度异常 | 侧栏里收藏夹行高明显小于其他项，对齐行高与命中区 |
| A3-PC | 右键绑定 | 移动端长按菜单（A3）做好后，PC 把同样的菜单绑到 `contextmenu`；注意仍要放行可选文本区域的原生菜单 |
| F2 | 侧栏收藏夹上滚轮不滚 | 多半是收藏夹行拦截了 wheel 或滚动容器嵌套；修好后断言：指针在收藏夹上滚动时侧栏 `scrollTop` 变化 |
| E9-PC | PC 头部的返回/收藏位置 | 跟随移动端口径统一（返回左上、收藏右上） |

## 9. 侧边栏改造（方案 1 + 霖的修改）

**已定**：采用方案 1（一级精简 + 搜索置顶 +「更多」分组），并做两处修改——**预约、生活常驻在外**；**选课在选课季常驻，其余时间收进「更多」**。

### 9.1 目标结构
- **常驻（首屏可见）**：今日、待办、网络学堂、日程、**预约**、**生活**、收藏夹（分组）、设置。搜索框置顶。
- **「更多」折叠区**：寻迹、邮箱、云盘、THubook、信息、在线服务、其他 Info 应用、**选课（非选课季时）**。保留原分组标签，便于定位。
- **选课季**：选课升为常驻，排在「学习」相关位置附近；非选课季自动收进「更多」。

### 9.2 选课季的判定
- 数据源：**「日程与提醒」**（霖指明选课时间信息在那里）。执行 agent 先定位：`grep -rn "日程与提醒" apps/desktop/src`，沿它找到提供选课/退课时间窗口的模块（不得写死日期表）。
- 若该数据源缺失或不完整：退化为在 `state/scheduleWindow.ts` 或校历数据里找选课事件；**两者都取不到就不常驻**（取不到即不常驻，不做猜测）。
- 判定结果要缓存到当天并每分钟/每次进入侧栏时复核；跨天自动失效。

### 9.3 实现要点与护栏
- 侧栏条目改为**消费 `NAV_REGISTRY`**（E2）：条目、分组、关键词只从注册表取，`Layout.tsx` 里那份手写清单删除；「常驻 / 更多」用一个新的可见性档位或本地偏好表达。
- 折叠状态、以及「更多」的展开状态要持久化；选课季切换时**不要闪动**（同一帧内完成重排，或给一次淡入）。
- 护栏：新增 `tools/sidebar-ia-test.mjs`——①侧栏不再手写条目清单（断言 `Layout.tsx` 中不出现硬编码条目数组）、②常驻集合与「更多」集合来自同一处定义、③选课季判定函数存在且有兜底分支、④「更多」展开态持久化。
- DoD：PC 上首屏条目数 ≤ 8；非选课季选课在「更多」里；把时间 mock 到选课季，选课出现在常驻区且不闪动。
- 反例：把选课直接删掉或永远常驻（无视选课季）；在 `Layout.tsx` 里再手写一份清单。

## 10. 建议的施工顺序

1. **M1 地基**：A1（`:hover`）、B1（令牌泄漏）、C1+C2+D3（滚动/顶底栏/滚动条）、C6（标题映射）——这些是后面所有改动的地板，先做能避免二次返工。
2. **M2 反馈层**：A2（振动，含 Rust 扩展）、A3+D9（长按菜单与展开动画）、D2（胶囊挤压）。✅ **2026-09-30 完成**：`c2d49dd` A2 → `dedee12` A3 → `5ffbcf9` D2 → `9377d1e` D9；门禁 46 项全绿、`typecheck` / `test` 干净；dev 包已装在 <设备> 上逐条走查，数字见各条的「落地」段（A2 五档包络两两不同且无双重振动、A3 忽略全链路与四边夹紧、D2 跨三格胶囊 64→60.3 / 32→35 且无掉帧、D9 四象限原点与 `[0,36,72]` stagger）。M2 期间新增两个护栏文件：`tools/haptics-test.mjs`、`tools/context-menu-test.mjs`（后者同时承载 D9 断言）。
   ↩ **M2 返修（2026-09-30，霖走查 5 条问题）**：①顶栏加高 45.5 → **59.5px**；②末端回弹加大（峰值 44 → **+54.0px**，并新增 **−18.8px** 反向过冲，顶/底栏不参与）；③右键菜单改成**按点液团生长 + 毛玻璃**（照 Liquid Morph 三条轨迹）；④长按覆盖面补齐（全局 `data-ctx-atom` + 作业列表行 + 今日页卡片 + 待办汇总卡与通知条，七处真机长按出菜单）；⑤触感口径改为**五档全走系统预定义效果**（A2 旧结论更正）。逐条数字见各条的「返工」段。
3. **M3 交互骨架**：E1（导航栈 + 系统返回键）、E6（底栏归属）、E3（我的页）、E9（头部位置统一）。D7 依赖 E1，放这一步之后。
   ✅ **2026-10-01 完成**：E1 → E6 → E9 → E3（**顺序偏差**：E9 提到 E3 之前，因为「我的」页头要放齿轮，先定头部布局类可少返工一次）。门禁 **50 项全绿**（E1 起 +`nav-stack-test`、E6 +`bottom-nav-owner-test`、E9 +`head-layout-test`、E3 +`mine-page-test`）、`typecheck` 干净、`test` 23 项全过、文档文案纪律 21 份 0 违规；dev 包已在 <设备> 上逐条走查（含全面屏手势的边缘滑注入），数字见各条「落地」段。M3 期间新增四个护栏文件。提交：`d07d8d2`（触感护栏 usage 断言补跑）→ `d3f9b83`（M3 交互骨架，E1/E6/E9/E3 一并落地，含四个新护栏）→ `b424a17`（本段文档回填）→ `4c01067`（E9 窄屏「收藏在右上」缺口修复 + 护栏断言）。
4. **M4 细节**：C3、C4、C5、C7、C8、C9、C10、C16、C17、C18、C19、C20。
5. **M5 动画与性能**：D1、D4、D7，以及 B2/B3/B4/B6 的视觉收尾。
6. **M6 bug**：F1、F3。
7. **P 批**：§8 全部（等霖发话）。
8. **M3 反馈批次（§12）**：霖 2026-10-01 走查 M3 后给的修改方案，四条 + 云盘配额。建议顺序：
   G4（图标，最小）→ G3（「我的」重设计）→ G1（顶栏返回 + ··· 菜单）→ G2（23 个 tab 独立成页）
   → G5（云盘配额）。G2 与 G1 有依赖：独立页的返回键要靠 G1 的顶栏返回，所以 G1 先做。

每批收尾固定动作：`pnpm guard` + `typecheck` + `test` + 真机走查（给数字）+ 提交 + 出 dev 包 + 回填计划表勾选。

## 11. 已知坑（这个仓库踩过的，别再踩）
1. **run_code 的载荷是模板字符串**：正文里出现反引号或 `${` 会把整段代码炸掉——用哨兵（如 ```` 不写在正文）替换后再拼接；写脚本时中文串里**不要用 ASCII 双引号**，用「」。
2. **python `str.replace` 不匹配会静默通过**：每处替换都要 `assert count == 1`，改完 grep 复核。
3. **未定义的 CSS 令牌会被门禁拦**（曾用不存在的 `--line-1`）：边框用 `--border`/`--border-soft`/`--border-strong`。
4. **style 扫描只拦新增**：新增违规必须清零，不许往基线里塞；间距走 4pt、字号走既有阶梯。
5. **设置页签清单只有一处定义**（`state/settingsMode.ts`）：改它要同步改 `tools/settings-ia-test.mjs` 与 `tools/help-coach-test.mjs` 的读取位置（这两处曾因清单搬家而红）。
6. **搜索必须同源**：一律走 `state/searchAll.ts`，禁止在页面里另写一套过滤。
7. **护栏是源码级断言**：改了实现要同步改护栏；但**不许为了让护栏过而写假实现**。
8. **`read_image` 已可用**：曾因 DSH 注入 bug 报 `cannot get property "fs" without inject`，修法是把 `dsh-tool-fs` 里 `ctx.inject(["attachments"])` 补成 `["attachments", "fs"]`。升级 DSH 会覆盖该补丁——复发就照这条再打一次。验收用「数字 + 截图」双证据。
9. **CDP 探针里不要 `location.reload()`**：会打断连接；重载要单独发一次调用。
10. **产物名会回落**：`onethu-dev.exe` 被占用时会写成 `onethu-dev-<HHMM>.exe`，别拿错包；APK 与 exe 构建**不可并发**，构建期间不改源码。
11. **`src-tauri/gen/android` 是符号链接**（→ `<安卓工程目录>`）：不许提交；要改只能走构建期脚本并校验幂等。
12. **改前先 grep 全量**：例如 `:hover` 83 处、`#hex` 121 处、`cubic-bezier` 裸用 10+ 处——只改「看得见的那几处」就是假完成。
13. **真机注入触摸的坐标要减状态栏**：`adb shell input swipe/tap` 用物理像素，而 WebView 的 `clientY` 从应用窗口顶算起（窗口顶在屏幕 y=48），映射是 `物理y = (clientY + 48) × 3`、`物理x = clientX × 3`（本机 400×870 CSS / 1200×2608 物理 / dpr 3）。漏掉这 48 会让落点整体偏上 48px：曾据此误判「内层滚动器避让失效」，实际是拖拽压根没落在那个元素上（挂一个小监听器把 `e.target` 与 `clientY` 记下来，才看到 target 是 `.content`、clientY 58 而不是 106）。

14. **`dumpsys vibrator_manager` 的 `played` 描述串不是效果身份**：A2 曾据一条 `Prebaked=CLICK(MEDIUM, with fallback)` 断言「MIUI 把 TICK/CLICK/HEAVY_CLICK 合成同一个」——逐 id 真机打过之后，记录里每个 id 的 `played` 名字与 `duration` 都不同。判断「ROM 是不是吞掉了效果」必须**逐 id 打一次再读记录**，不能凭一条记录的描述串下结论。
15. **`EFFECT_THUD` / `EFFECT_POP` / `EFFECT_LONG_PRESS` / `EFFECT_REJECT` 都不是公开常量**（compileSdk 36 也解析不到，写了直接编译失败、一轮构建白跑）：预定义效果只能写 id 字面量，本机 id 表见 `/vendor/etc/Hapticsconfig.xml`。
16. **给登录按钮派发 JS `click()` 不生效**：`.click()` 点完仍停在 `login-wrap`，用 `adb shell input tap`（坐标换算见第 13 条）一下就进去了。另外**重装 dev 包后会话退回登录页**，走查前先确认已登录（这一步不做，后面所有页面断言都会落在登录页上）。
17. **CSS 动画改相位截图要用 WAAPI**：给已播完的动画改 `animation-delay` 与 `animationPlayState=paused` **不会重启动画**（两张截图逐字节相同）；正确做法是 `el.getAnimations()` 后 `pause()` 再设 `currentTime`。
19. **`input tap` 打系统界面会混入它自己的触摸反馈**：抓「触感演示」的效果 id 时，`com.android.settings` 每次被点都先发一条 40–80ms 的 `HEAVY_CLICK/CLICK`，把演示真正的长时长记录淹掉、错位。对策：按「时长 >100ms」过滤，或改成「同族 id 逐个回放让霖用耳朵定」（本次就是后者定稿的）。
22. **别用 `dumpsys vibrator_manager` 做「请求 id ↔ 实际效果」对齐**：这台机器上该历史是环形缓冲（一次只留 ~77 条，222 个 id 一次读只剩 54 条），且记录写入滞后于播放——逐 id 立即回读会读到上一条（实测请求 `2@hardware` 与 `167@hardware` 都读回了同一个 `Prebaked=182/216ms`）。可靠依据只有三条：面板路径的**时长实测**（167=191ms / 169=120ms / 171=499ms / 159=639ms）、**厂商 PCM 的离线能量**（`/vendor/etc/acdbdata/haptics_data/*.pcm`）、以及霖**用耳朵定**。JS `console.log` 能进 logcat（`I onethu: [FE] log …`）可用来打标记，但对齐仍受环形缓冲限制。
21. **预定义效果不能逐档调振幅**：`VibrationEffect.Composition.addEffect(effect, scale)` 在 compileSdk 36 里**不存在**（编译报 `Unresolved reference: addEffect`），`VibrationAttributes.USAGE_ASSISTANCE_SONIFICATION` 同样不存在，`createPredefined(id)` 自身也不带振幅。要做强弱差异只能用「换 id」或「换 usage（touch / hardware）」；只有自绘 `createWaveform` 才有振幅，但那会丢掉厂商波形（手感退回「只是震」）。
20. **重装 dev 包后可能卡在 `booting`**：App 停在「正在恢复登录状态…」且 `location.hash` 为空；`am force-stop` 后重新拉起即恢复（本次第二次启动直接进了主页）。另外 App 在后台时 WebView 不响应 devtools（`curl /json/list` 会挂住），抓 CDP 前必须先把它拉回前台。
18. **CDP 里 `location.hash=` 到子页面会兜回顶层**：`topLevelPage()` 把「全部作业」这类子页映射回 `#/learn`，而**已经在该 hash 上时再赋值等于没有导航**。走查「全部作业」要真点 `.task-entry`；换页前先 `#/today` 走一步，否则会停在原地、把上一页的 DOM 当成新页读。
23. **作业列表行的「忽略」按钮压在行的水平中心上**：在「全部作业」点行的正中间弹的是「忽略这条作业」确认卡，不是进详情——E9 走查时误触过一次，随后才发现同一行里 `.hw-ignore-btn` 的矩形覆盖了 x≈163–203（行宽 16–384，中心 200）。走查点行要点 `.row-main` 的**左侧**（如 x=left+20）；这条本身是待修的 UI 问题（与 C8「作业卡片上的按钮点不了」同族）。

24. **HCT/CAM16 的反变换里 `aw·(J/100)^(1/cz)` 是 ac，不是 p2**：正变换定义了 `ac = p2 · nbb`，反变换要用的是线性方程组里的 p2，所以必须再除一次 `nbb`。少这一步不会让基线向量明显跑偏（±1/255 量级），但 ARGB → HCT → ARGB 的往返会差到 4% 亮度（实测 `#0d9488` 回来是 `#049488`）。判断「取色算法对不对」要看往返，不能只看单点色值。
25. **护栏切片不能用注释当锚点**：`context-menu-test.mjs` 的 `read()` 会把注释按等长空格遮蔽，此时 `css.indexOf("/* ── A3 …")` 返回 -1，`slice(start, -1)` 会静默取到「从起点到文件末尾」的一大段，护栏于是对着错误的文本做断言（本次据此误报过一次「按压改了尺寸」）。切片锚点一律用真代码片段。
26. **`--md-sys-color-scrim` 在 `packages/ui/src/tokens.css` 里**：在 `apps/desktop/src` 里 grep 不到定义不等于令牌不存在（曾据此以为它未定义）。找令牌先把 `packages/ui` 一起纳入搜索范围。
27. **长按的按压态要活到菜单关闭，不能在抬手时收**：抬手事件的清理若无条件执行，菜单还在屏幕上、目标的 1.1 与遮罩就没了。做法是长按触发后置 `held` 标志，抬手清理跳过这一轮，改由菜单卸载统一收尾。

## 12. M3 反馈批次（霖 2026-10-01，4 条 + 云盘配额）

> 这批是霖走查 M3 之后的修改方案。四条都已与霖逐条确认过口径（含两轮细化问答），
> 下面写的是**定稿口径**；与 §6 老条目冲突时，以本章为准（§6 E9 的「移动端返回位置」
> 由 G1 取代：手机上返回键不再出现在页面内容里）。

### G1 手机顶栏：根页显示 OneTHU logo，非根页变「<」返回，右上「···」页面级菜单
- **现状证据**：手机顶栏（≤839.98px）只有左上「（OneTHU）+ 标题」——`.topbar-brand` 不可点，
  `.topbar-menu`（远古汉堡）与抽屉在手机端被 CSS 隐藏（`global.css` 5436 那条媒体块）。
  返回键目前长在**页面内容**里（`PageHead` 的 `page-head-back`），收藏/刷新长在
  `PageHead` 的右上 actions——返回与收藏挤在同一行，位置还随标题长度漂。
- **已定口径**：
  1. 根页 = 底栏五个 tab（今日 / 待办 / 服务 / 收藏 / 我的）且无上级：顶栏左上照旧是
     OneTHU logo + 标题。
  2. 其它页面：顶栏左上角**只把 logo 换成「<」返回键**，标题留在原位（顺序：`<` 标题）。
  3. 顶栏右上角新增「···」按钮，快捷打开**当前页面的 context menu**（展开特效与 A3 长按
     菜单同款，同一个宿主与夹紧逻辑，锚点是按钮本身）。
  4. 「···」菜单收录口径（霖确认）：**只收页面级操作**——本页对象的收藏/取消收藏、刷新、
     以及该页原有的整页主操作（作业详情的忽略、文件详情的下载/外部打开、课程详情的刷新、
     帖子的回复等）。**行内小星星**（邮件行 / 作业行 / 通知行 / 文件行 / 校园卡流水等）、
     **收藏夹编辑工具栏**（完成 / 上移 / 下移 / 重命名）、输入类操作**一律不动**。
  5. 页面内容里的返回键与右上 actions 在手机上**隐藏**（PC 照旧显示：PC 有侧栏与右键菜单，
     位置本来就宽裕）。页面内容仍保留标题与副标题（霖确认）。
- **改动面**：`components/Layout.tsx`（mobile-topbar 三段：`<`/logo + 标题 + `···`）、
  `PageHead`（新增 `menu` 数据槽 + 把 `back`/`menu` 注册给顶栏）、新建
  `state/pageChrome.ts`（当前页的返回目标 + 菜单项，`useSyncExternalStore` 订阅）、
  `components/ContextMenu.tsx`（菜单项支持 `disabled`）、`global.css`（手机端隐藏
  `.page-head-back` 与**页面级**的那部分 `.page-head-page-actions`——工具栏留在页内，
  新增顶栏三段样式）。
- **实现要点**：
  - 顶栏「<」的返回目标要覆盖冷启动深链：栈空时回落到页面自己声明的父页（与页内
    `BackButton` 的 `to`/`label` 同源，不另写一份）。
  - `PageHead` 是唯一声明点：`back={<BackButton …/>}` 继续用；页面级操作改成数据
    （`menu: PageAction[]`，含 key/label/icon/danger/onSelect/panel），`PageHead` 在 PC 上
    把它渲染成右上按钮、在手机上把它注册给顶栏「···」——**一份声明两处消费**，不许两套。
  - 工具栏类页面（收藏夹编辑态、设置页的管理栏目）继续走 `actions`（PC/手机都在内容里），
    不进「···」菜单。
  - 「···」在没有菜单项时隐藏（不留空按钮）。
- **护栏**：新增 `tools/topbar-chrome-test.mjs`——断言：根页判定取自 `BOTTOM_NAV_PAGES`；
  非根页顶栏渲染「<」且调用同一个 `back()`；手机端 `.page-head-back` 与
  `.page-head-page-actions`（只这一层，工具栏不受影响）被媒体块隐藏；「···」菜单走
  `useContextMenu().open`（不许自造第二套弹层）；页面级收藏/刷新不许再留在 `actions` 里
  （必须走 `menu`）；页面不许自己拼 `.page-head`（绕过 PageHead 就绕过了本口径）；
  顶栏必须渲染在 `ContextMenuLayer` 内部；dev 徽标手机端必须让开右上角。
- **DoD**：真机——①根页（今日/待办/服务/收藏/我的）顶栏左上都是 OneTHU logo；
  ②进入二级页后 logo 变「<」，点它回到上一页（含冷启动深链回落父页）；③二级页右上
  「···」弹出菜单，动画与长按菜单同款，里面有「收藏/取消收藏」和「刷新」（该页有的操作）；
  ④登录页等全屏页顶栏行为不回归。
- **落地（2026-10-01）**：顶栏拆成独立组件 `MobileTopbar`（挂在 `ContextMenuLayer` 里、
  `.content` 的兄弟位），`PageHead` 新增 `menu` 槽并把 `back` 的 `to/label` 与菜单项注册进
  `state/pageChrome.ts`；`backTargetOf` 成为返回目标的唯一口径（`BackButton` 与顶栏共用）。
  19 个页面把手写的 actions 改成 `menu` 数据，`MailPage` / `SearchPage` 两处**手拼
  `.page-head`** 也并回 `PageHead`（否则手机端页内会留下星标与返回键）。护栏
  `tools/topbar-chrome-test.mjs` 进 guard 链（**52 步**），反例自检 5 例全部拦下：把 `刷新`
  放回 `actions`、去掉手机端 `.page-head-back` 的隐藏、把顶栏移出 `ContextMenuLayer`、
  dev 徽标挪回右上角、页面重新手拼 `.page-head`。
  - **真机数字**（<设备>，400×805，dpr 3）：根页 今日/待办/服务/收藏/我的——`.brand-logo`
    在位、无返回键；「···」只在声明了页面级操作的页出现（今日、待办有，服务/收藏/我没有），
    按钮矩形 `(350,18,34×36)`。非根页——`#/info` 返回键 `(16,18,34×36)`、aria「返回：我的」
    （页面没声明父页 → 回落归属 tab）、「返回：服务」用于 `#/life`/`#/reserve`、
    「返回：收藏」用于 `#/folder`；学习子页（全部作业）「返回：课程列表」，页内
    `.page-head-back` 实测 `0×0`（DOM 在、手机上不占位），PC 侧那份操作仍是
    `[管理收藏, 刷新]`。冷启动深链验证：`#/thos` 刷新页面（栈只剩一帧）后点「<」→ `#/services`
    且底栏高亮第 3 项（服务）——回落生效，不是死按钮。
  - **「···」展开动画**（与长按菜单同一宿主）：锚点 = 按钮下沿中点 `(367,54)`，逐帧采样
    `t=16ms 48×48`（圆心正好落在锚点上、opacity 0→1）→ `103ms 81×64` → `205ms 118×81`
    → `470ms 148×95`（终态 x=244,y=54，右缘 392 = 400-8 夹紧边距）。
  - **菜单项实测**：全部作业页 `[管理收藏, 刷新]`（已收藏时文案自动变「管理收藏」）；
    在线服务页 `[刷新]`——点「刷新」后菜单立即关闭、页面头「更新于」由 `21:44:33` 变成
    `21:44:54`（真取数）；点「管理收藏」打开的是**同一个** `CollectModal`（「收藏到…」+ 收藏夹
    列表），不是第二套弹层。
  - **PC 侧**（Windows Edge 154 headless + 真实样式表，同一份 DOM）：1440 宽下
    `.mobile-topbar` = `display:none`、`.page-head-back` = `flex 73×32` 可见、
    `.page-head-page-actions` = `flex 124×32` 可见（PC 照旧）；400 宽下三者分别为
    `flex 390×72` / `none` / `none`，`.topbar-back` 与 `.topbar-more` 均 `grid 34×36`，
    工具栏里的 `<select>` 仍然可见（工具栏不被收进菜单）。
  - **两个真机/真实环境才暴露的坑**（都已进护栏）：①顶栏一开始渲染在 `ContextMenuLayer`
    外面，`useContextMenu()` 拿到 NOOP——真机表现就是「点「···」没反应」，改为把顶栏挂进这一层；
    ②dev 构建的徽标固定在右上角 `z-index 9001`，正好压住新「···」（实测
    `elementFromPoint(367,36)` 命中徽标、真机点不动），手机上把徽标挪到左下角
    `y=621..657`（OH 悬浮坞从 663 起，互不遮挡），PC 原位不动。
  - **PC exe 走查（交叉编译 onethu.exe + WebView2 远程调试，窗口 1240×820）**：`.mobile-topbar`
    实测 `display: none`、0×0（PC 没有手机顶栏，也就没有「···」）；同一份 DOM 里
    `#/grade` 的页内 `.page-head-back` 是 `flex 73×32`「← 服务」、
    `.page-head-page-actions` 是 `flex 80×32`「收藏」——PC 照旧显示页内返回与页面级操作。
  - **未覆盖**：`folder`（收藏夹）的编辑态工具栏按口径留在页内，手机上仍是 5 键一排（与
    G1 之前一致，未改）。

### G2 旧界面 tab 独立成页（23 个）
- **现状证据**：服务页的条目绝大多数是 `navigate("info"/"life"/"reserve"/"zhjwxk", { …Tab })`
  ——点「成绩」进的是「信息」页再切到成绩页签：标题写着「信息」，页内还挂着 8 个 tab；
  「校园卡」同理进的是「生活」页。
- **已定口径（霖确认）**：
  1. 提取下面 **23 个** tab 为独立页面，各自一个标题、各自一个路由；**「更多场馆」不提取**
     （没有服务页入口），留在旧页。
  2. **手机上所有入口**（服务页、今日页卡片、搜索、命令面板、收藏里存的入口）都走独立页；
     **PC 侧栏与右键继续走旧多 tab 页**，**旧页与旧深链原样保留**（手机开 `#/info` 仍是旧页）。
  3. 独立页不显示 tab 条、也不保留旧页的多 tab 骨架；返回键按 G1 在顶栏。
- **页面清单（标题 → 新页面 id）**：
  - 信息门户（8）：成绩 `grade`、体测成绩 `fitness`、考试 `exams`、教学评估 `evaluation`、
    校历 `calendar`、新闻 `news`、个人信息 `profile`、课程信息 `course-info`
  - 生活（8）：宿舍 `dorm`、洗衣机 `washer`、卫生成绩 `hygiene`、校园卡 `campus-card`、
    电子发票 `invoice`、银行代发 `payroll`、研究生收入 `grad-income`、校园网 `campus-net`
  - 预约（5）：图书馆座位 `lib-seat`、研讨间 `lib-room`、空教室 `classroom`、体育 `sports`、
    公共空间 `public-space`
  - 选课（2）：课程查找 `xk-find`、选课管理 `xk-manage`
- **改动面**：`state/navigation.ts`（`NavEntry` 增 `soloPage?: Page`，23 条各挂一个）、
  `state/app.tsx`（Page 联合类型 + TOP_PAGES）、`state/navigation.ts` 标题表、
  `state/navOwner.ts`（归属）、`state/atoms.ts`（同名原子的 open 改走 soloPage）、
  `App.tsx`（23 条路由，全部是「薄壳 + 自己的标题」，复用既有 tab 组件）、
  `pages/ServicesPage.tsx`（目录行走 soloPage）、`global.css`（独立页标题/间距）。
- **实现要点**：
  - 薄壳只做三件事：PageHead（自己的标题 + 副标题）、渲染既有 tab 组件、把该 tab 需要的
    navParams 透传；**不许复制 tab 组件的实现**（一处逻辑两个入口）。
  - `navigate` 的入口收口在 `NavEntry.soloPage`：**分流只写在 `app.tsx` 的 `navigate()` 一处**
    ——命中 soloPage 且档位是 compact/medium 就改道独立页，PC（expanded）继续
    `entry.page + entry.params`。服务页 / 今日卡片 / 搜索 / 命令面板 / 收藏 / 各原子 `open`
    全都经过这里，不必各自判一次手机。
  - 新页面 id 要进 `PAGE_TITLES`、`PAGE_OWNER`、`TOP_PAGES`（可深链），并同步
    `tools/page-title-test.mjs` / `tools/bottom-nav-owner-test.mjs` 的口径。
- **护栏**：新增 `tools/solo-pages-test.mjs`——断言 23 个 id 全部在 Page 联合类型 + 标题表 +
  归属表 + TOP_PAGES 里；断言每个薄壳都渲染了对应 tab 组件（不复制实现）；
  断言 `NavEntry.soloPage` 覆盖了 23 条且手机分流只有一处；断言「更多场馆」没有独立页。
- **DoD**：真机——从服务页逐个进 23 个页面：标题正确（不再显示「信息」「生活」）、
  没有 tab 条、顶栏返回键回到服务页；PC 侧栏点同名条目仍进旧多 tab 页。
- **落地（2026-10-01）**：23 个 tab 各自成页，实现是三样东西——①`state/navigation.ts` 的
  `NavEntry.soloPage`（23 条映射 + `soloTargetFor()`：按参数子集匹配、最具体优先，无参数
  不改道）；②`app.tsx` 的 `navigate()` 一处分流（`platformOf(innerWidth) !== "expanded"`）；
  ③`pages/solo/SoloTabPage.tsx` 的 `SOLO_TABS` 表 + 一个薄壳（`Record<SoloPage, …>` 穷尽，
  漏一页编译不过）。旧多 tab 页、旧路由、旧深链一字未动。选课的两个独立页复用旧页的组件
  同时把「跳转 / 详情 / 评价三条 module 通路 + 课程评价索引预热」抽成 `useXkPageHost()`
  （旧双栏页与两个独立页共用同一份，避免独立页里点「详情 / 评价」没有响应）。
  另外补了 2 条注册表条目与 2 颗原子（`xk-find` / `xk-manage`），PC 那边 `params.xkTab`
  仍能落回旧页的对应页签。
  - **真机走查**（<设备>，400×805）：从「服务」页逐个点进 23 个独立页，**23/23 通过**
    ——hash 与标题全部正确（成绩 `#/grade`、校园卡 `#/campus-card`、图书馆座位 `#/lib-seat`、
    课程查找 `#/xk-find`…），`[role=tab]` 与 `.segmented` 计数都是 **0**（没有 tab 条），
    页内 `.page-head-back` 宽 **0**，顶栏返回 aria 一律「返回：服务」，点它回到 `#/services`；
    正文都有内容（校园卡 7871 字、体育预约 753 字），空数据的两个是**正常空态**而不是白屏
    （体测「状态 暂无可查成绩」28 字、银行代发「暂无银行代发记录…」52 字）。
  - **旧页与深链未回归**：手机开 `#/info` 仍是旧「信息」页——标题「信息」+ **8 个 tab** +
    1 个 `.segmented`；PC 分支在真机上把视口读数换成 1440（应用逻辑原样执行）后，从服务页点
    「成绩」进的是 `#/info` + 8 个 tab 的**旧多 tab 页**，不是独立页。
  - **护栏** `tools/solo-pages-test.mjs` 进 guard 链（**53 步**），反例自检 6 例全部拦下：
    ①成绩条目摘掉 `soloPage`；②薄壳不渲染 tab 组件；③独立页加回 tab 条；④服务页自己再判一次
    手机档（全 src 扫 `soloTargetFor` 调用点，只允许 `state/app.tsx` 一处）；⑤摘掉旧「信息」页
    路由；⑥`soloTargetFor` 去掉「最具体匹配优先」。
  - **PC exe 走查（交叉编译 onethu.exe + WebView2 远程调试，窗口 1240×820）**：服务页用**真鼠标
    事件**点「成绩 / 校园卡 / 图书馆座位」分别进 `#/info`（8 个 tab）/`#/life`（8 个）/
    `#/reserve`（6 个），全是旧多 tab 页；PC 侧栏点「信息 / 生活 / 预约」同样是 8/8/6 个 tab 的
    旧页；独立页深链 `#/grade` 在 PC 上显示页内「← 服务」73×32 与「收藏」80×32、没有 tab 条
    （PC 端独立页只有深链可达，入口一律仍走旧页）。
  - **未覆盖**：`#/xk-find`、`#/xk-manage` 在真机上正文有内容但没有真实选课数据可操作
    （非选课季），只做了渲染与返回验证。

### G3 「我的」页重设计（源：`docs/mine.md`，已合并进本条并删除源文件）
- **现状证据**：M3 的 E3 版本是「三段 SectionHead + 卡片 + 分隔线」的通用列表排布——霖走查
  判定「排版混乱」。
- **已定口径（霖 `docs/mine.md` + 二次确认）**：
  1. **三个部分不列标题**（个人信息 / 学习生活 / 服务），由上到下自然排布。
  2. **个人信息**：一张学生卡样式的卡片——左上角头像（默认取姓，直径 = 卡片高度的 1/2），
     右侧姓名 + 学号上下排列；头像下方左对齐「院系」「邮箱」两项上下排列；标题与内容全部
     左对齐；卡片无内部分隔线，阴影照作业卡片；卡片出现时有浮现动画。
  3. **渐变过渡带（霖 2026-10-01 二次定稿）**：**不画分界线**。渐变背景从「个人信息段结束」
     开始，在「学习和生活」三张卡片结束的过程中**透明度渐变消失**——即一条隐形分界线，
     三张数据卡看上去落在「渐变 → 标准背景」的过渡地带。渐变只铺在卡片区域这一带
     （不蔓到顶栏与下面的服务列表），且可以有缓慢的流动动画。
  4. **学习和生活**：三张卡**水平排列**：校园卡余额 / 学分 / GPA；数字在上、标题文字在底部；
     数字出现时有**累加动画**；三张都可点击——余额进校园卡独立页，学分与 GPA 进成绩独立页
     （G2 的第 1、2 项；G2 未落地前先指向旧页 `life+card` / `info+report`，落地后改走独立页）。
  5. **服务**：五项列表，顺序固定——设置（副标题写清栏目，如「账号、通用、隐私」）、
     邮箱（未读数）、云盘（已用/总量，来自 G5）、成绩、我的收藏（收藏夹数量）。
     行样式：最左服务图标，紧邻名称 + 信息上下排列，最右进入图标；列表样式与其他列表一致；
     **尽量不出现上下滚动**（400×805 一屏放下，间距按 4pt 网格收紧）。
- **改动面**：`pages/Mine.tsx` 重写、`styles/global.css`（学生卡 / 渐变带 / 三数字卡 / 服务列表）、
  `components/Icons.tsx`（G4 齿轮；如需新增「收藏/成绩」图标）`tools/mine-page-test.mjs` 扩写。
- **实现要点**：
  - 数字累加动画走 WAAPI 或 CSS 计数（`@property` + `counter-reset` 在 WebView 上不稳，
    优先用 rAF 数字插值）；`prefers-reduced-motion` 下直接落终值。
  - 渐变流动与浮现动画都受 `prefers-reduced-motion` 约束；渐变用主题 token
    （`--md-sys-color-primary` / `secondary-container` 等）混出，不许写死 hex。
  - 三张数字卡的宽度必须等分且不被长数字顶破（`minmax(0,1fr)`）。
- **护栏**：`tools/mine-page-test.mjs` 扩写——断言三部分无 SectionHead 标题；学生卡结构
  （头像 + 姓名 + 学号 + 院系 + 邮箱）与头像尺寸关系（CSS 里 `height: 50%` 或等价）；
  渐变带存在且落在两个区块之间（不画 `border`/`hr` 分界线）；三数字卡水平排列且在
  移动端不换行；累加动画函数存在且被 `prefers-reduced-motion` 短路；服务列表五项顺序。
- **DoD**：真机——一屏内看到学生卡 + 三数字卡 + 五项服务；渐变的起止肉眼可见（截图对比
  顶部与底部）；数字有累加过程（连拍两帧数字不同）；三卡点击分别进校园卡 / 成绩页；
  服务五项分别进设置 / 邮箱 / 云盘 / 成绩 / 收藏。
- **反例**：把「渐变」做成一张写死的图片或固定色块（换主题不会变）；数字直接显示终值
  （没有累加）；三卡在窄屏换行、页面需要滚动才能看全。

- **落地（2026-10-01，提交 `0ece509`）**：`pages/Mine.tsx` 重写 + `styles/global.css` 的 `.mine-*` 段重写 + `lib/size.ts`（G5 用）。真机数字（<设备>，400×805，dpr 3）：渐变带 `top=0 bot=337 left=0 right=400`（从页面顶端起、左右贴边）；学生卡 `84..252`、高 **168**、头像 **84×84** → 比例 **0.500**（卡片高度与头像同用 `--mine-card-h`，定高而不是最小高）；三张数字卡 `264..337`、列宽 `116×3`、`grid-template-columns: repeat(3, minmax(0,1fr))`；服务列表 `337..640`（在 OH 悬浮坞 `top=663` 之上，最后一行完整可见）；`.content` 的 `scrollHeight = clientHeight = 727`（**无需上下滑动**）；渐变层 mask 实测 `linear-gradient(rgb(0,0,0) 252px, rgba(0,0,0,0) 100%)`，252px 正好等于学生卡下沿 252；卡片与数字卡 `opacity: 1`、底色 `rgb(30,31,36)` 实心（不再被 mask 淡到）。累加动画三帧取样 `¥0.63 → ¥1.05 → ¥1.47`，终值 `¥2.15`；入口逐个点过：余额卡 → `#/life`（校园卡 tab，余额 ¥2.15 一致）、学分卡 → `#/info`（成绩 tab，有成绩表）、设置 → `#/settings`、邮箱 → `#/mail`、云盘 → `#/cloud`、我的收藏 → `#/favs`。截图 `.tmp-shots/g3-mine.png`（gitignore，不入库）。
  - 两个真机才暴露的坑，都已固化进护栏：①`--mine-card-h` 原先定义在子元素 `.mine-card` 上，父级 `.mine-grad` 里 `var()` 取不到 → 整条 `mask-image` 变 `none`（渐变根本没生效），改为定义在带上；②mask 加在 `.mine-grad` 本身会把**三张数据卡一起淡掉**（霖走查原话），改为渐变只画在 `.mine-grad::before` 上、子元素 `position: relative` 抬起。
  - 护栏 `tools/mine-page-test.mjs` 重写：三段无标题、学生卡结构与 `--mine-card-h` 位置、单向渐隐（卡片下沿 → 本带底部）、渐变层独立与 `pointer-events: none`、三卡等分与累加降级、五项服务顺序与去向、底栏归属、复用既有 hook。反例自检 **7 例**全部拦下：去掉 mask / 头像写死像素 / 服务行换位 / 删降级短路 / 卡片加分隔线 / `--mine-card-h` 挪回子元素 / mask 加回带本身。

### G4 「设置」图标换成真齿轮
- **现状证据**：`IconSettings` 画的是「圆心 + 八条射线」——霖：看起来像太阳。
- **已定口径**：改成一眼可辨的齿轮（外圈齿 + 内孔），全仓同图标（侧栏 / 设置页 / 「我的」
  服务列表 / 命令面板一处改、处处一致）。
- **改动面**：`components/Icons.tsx`；`tools/icon-test.mjs` 的规格断言。
- **护栏**：`icon-test.mjs` 断言齿轮图元（齿 + 内孔）与既有规格（1.6px 描边、`viewBox` 24）。
- **DoD**：真机放大截图对照：设置项与侧栏「我的/设置」图标是齿轮而不是太阳。
- **反例**：只改「我的」页那一处，侧栏还是太阳。

- **落地（2026-10-01，提交 `0ece509`）**：`components/Icons.tsx` 的 `IconSettings` 改成八齿齿轮 + 中心孔（`<circle r="3.1">` + 一条 8 个 `a1.5 1.5 0 0 0` 齿的外廓 path），全仓同图标（侧栏 / 设置 / 「我的」服务行 / 命令面板一处改、处处一致）。`tools/icon-test.mjs` 补三条断言：必须有内孔、齿数 ≥ 8、禁止出现旧太阳画法的射线 path。真机截图（`.tmp-shots/g3-mine.png`）里「我的」服务行首项已是齿轮。

### G5 云盘配额接口（真实「已用 / 总量」）
- **现状证据**：`SeafileRepo` 只有 `{ id, name, mtime, size }`，没有账号配额；「我的」页
  服务列表的云盘副标题写不出「已用 12GB / 100GB」。
- **已定口径（霖选）**：补一个配额接口，用户可见处显示真实的已用/总量。
- **改动面**：Rust 侧 Seafile 客户端（账号信息接口 `/api2/account/info/` 的
  `usage`/`total`）+ 一个 Tauri 命令；`state/seafile.ts` 暴露读取；`pages/Mine.tsx` 消费。
  未绑定 / 请求失败时副标题回落「未绑定」或「资料库 · 同步盘」，不显示占位数字。
- **护栏**：Rust 命令注册与权限（`build.rs` / `permissions/default.toml`）断言、
  前端未绑定分支断言（不许把 `null` 渲染成 `NaN`/`undefined`）。
- **DoD**：真机——绑定云盘后「我的」页云盘行显示真实「已用 X / 总量 Y」，与云盘页
  文件总量对得上；未绑定时显示回落文案。
- **反例**：写死一个假配额；接口失败时页面显示 `undefined`。

- **落地（2026-10-01，提交 `8d7f002`）**：配额接口**底层早已存在**（Rust `seafile_account` → `/api2/account/info/` 的 `usage`/`total`，云盘页一直在用），本次只补前端接线，没有造第二个接口：`state/seafile.ts` 增 `ensureSeafileAccount()`（读本地 token、已有账号缓存即短路、失败静默），`lib/size.ts` 抽出共用 `fmtSize`（云盘页的私有实现删掉），「我的」页云盘行分三种文案（真数 / 资料库 · 同步盘 / 未绑定）。护栏 `tools/cloud-quota-test.mjs` 进 guard 链（**51 步**）：Rust 字段与 `invoke_handler` 注册、状态层缓存与静默、共用 `fmtSize`、真数上屏与未绑定分支、禁止写死配额数字；反例自检 3 例拦下（写死「已用 12GB / 100GB」、删掉 `lib.rs` 注册、把真数换成字面量）。真机（<设备>）：本机云盘**未绑定**，云盘行显示「未绑定」，同一刻云盘页显示绑定引导——两处状态一致；已绑定分支与云盘页共用同一份 `account`，未在本机造凭据验证（不碰凭据文件）。

### 本批次状态（2026-10-01）
- 已落地：G3、G4、G5（提交 `0ece509`、`8d7f002`）。
- 进行中：G1（顶栏返回 + 页面级「···」菜单）、G2（旧界面 23 个 tab 独立成页）。
- 依赖：G2 的独立页返回键依赖 G1 的顶栏返回，故 G1 先做。

## 13. 手感批次（霖 2026-10-01 走查，6 条）

> 这批全部是霖在真机上逐条看着说的手感/观感问题，六条都已与霖确认过口径（含多轮追问：
> 按压的机制、dev 徽标的形态、渐变取色算法、菜单翻转策略、毛玻璃的作用范围）。与 §12 的
> G 系列不冲突：G 系列是信息架构，本章是动效与取色。

### H1 「我的」页彩底改成主题色色盘渐变（真 Monet 取色）
- **现状证据**：`.mine-grad::before` 是一条两色线性渐变（`--md-sys-color-primary` 30% +
  `--md-sys-color-secondary-container` 90%），同一主题下只有一个色系；霖原话「「我的」页
  彩色背景应该有主题色色盘渐变，而不是单色设计」。
- **已定口径**：用 MD3 Monet（HCT/CAM16）从当期主题色**现算**色盘，取 5 个停点铺成渐变带；
  算法必须是真的 HCT/CAM16（霖确认「真实现 HCT/CAM16（严格 Monet）」），不接受按色相做近似。
- **改动面**：新建 `lib/monet.ts`（零依赖，约 350 行）；`pages/Mine.tsx` 增 `useMineGradient()`
  （读 `--md-sys-color-primary` → `paletteGradientStops()` → 5 个 `--mine-cN` 挂到 `.mine-grad`）；
  `global.css` 的 `.mine-grad::before` 换成 5 停点，取不到色盘时回落既有令牌。
- **实现要点**：
  - Monet 的口径是「源色 → 三条色调板（primary 用源色彩度 / secondary 用 1/3 彩度 /
    tertiary 用源色相 +60 与 1/2 彩度 / neutral 收彩度）→ 按 tone 取色」。停点取
    `[primary 85, tertiary 70, primary 65, secondary 80, tertiary 55]`，跨三个色相。
  - `argbFromHct` 在 Y 上做牛顿迭代（容差 1e-4、最多 12 次、灰轴回落）；
    `xyzFromJch` 里 `aw·(J/100)^(1/cz)` 解出的是 ac，必须除回 `nbb` 才是线性方程组的 p2。
  - 主题一换就重算：hook 依赖 `[activeId, systemDark]`（覆盖昼夜调度与第三方主题插件），
    并在下一帧再读一次令牌，避免插件主题滞后一帧注入时读到旧值。
- **护栏**：`tools/monet-test.mjs`（新增，guard 链第 54 步）——MD3 基线向量（源色 `#6750A4`
  派生出的三条板在 tone 40 上分别是 `#6750A4` / `#625B71` / `#7D5260`，容差 ±3/通道）、
  色调板单调且两端收黑白、HCT 往返误差为 0、5 个停点且跟随源色、模块内零字面色。
  `tools/mine-page-test.mjs` 补四条：≥5 个停点、停点回落主题令牌、Mine 页三段接线
  （读令牌 → Monet → 挂变量）、依赖数组带 `activeId/systemDark`。
- **反例**：清单第 1–6 条。
- **落地（2026-10-01，提交 `d2d44f3`）**：`lib/monet.ts` 落地后先离线跑基线向量，三条板与 MD3
  基线逐通道差 ≤1/255；修掉反变换的 `nbb` 缩放后，7 个代表色的 HCT 往返误差从 9/255 降到 0。
  Mine 页在真机上算出的 5 个停点与截图的色相分布见走查记录。

### H2 dev 徽标挪到顶栏正中并缩成一枚小标
- **现状证据**：G1 把 dev 徽标从右上角挪到了左下角（`left: 12px`、抬到 OH 悬浮坞之上），
  霖走查后说「dev 标示莫名到了左下角位置，放到顶栏中间吧」。
- **已定口径**：手机端水平居中于顶栏、竖直居中（顶栏 60 高、小标 24 高 → `top: 18px`），
  并「缩到最小只留一枚小标」——提交号那截在手机上隐藏，完整 commit 进面板仍可见。
- **改动面**：`components/DevPanel.tsx`（提交号包进 `.dev-badge-commit`）；
  `global.css` 手机端媒体块（`left: 50%` + `translateX(-50%)`、`top: 18px`、
  `font-size: 12px`、`.dev-badge-commit { display: none }`）。
- **护栏**：`tools/topbar-chrome-test.mjs` 的 ③b 段改写成四条：居中（`left: 50%` +
  `translateX(-50%)`）、竖直位置（`top: 18px` + `bottom: auto`）、字号走 12px 阶梯、
  提交号在手机上隐藏；另加一条断言 `DevPanel` 里确实把提交号包进了 `.dev-badge-commit`。
- **反例**：清单第 14、15 条。
- **落地（2026-10-01，提交 `d2d44f3`）**：真机徽标矩形与「<」/「···」两个按钮的矩形不相交，
  `elementFromPoint` 在徽标中心命中徽标、在两个按钮中心命中按钮（数字见走查记录）。
  PC 侧不受影响：1240 宽窗口下徽标仍在右上（x=1089..1222、y=6、11px、提交号可见、
  `transform: none`）——手机那条覆盖写在 ≤839.98px 媒体块里，护栏 `cssInMedia("839.98px", …)`
  钉住了作用域，改到块外会报红。

### H3 长按菜单弹出动画加快
- **现状证据**：面板生长 `ctx-bloom` 是 520ms，选项再叠 130ms 固定延迟 + 36ms×序号的步进、
  单个 360ms——最末一个选项落定要 ~0.7s。霖原话「context menu 的弹出动画太慢了，快一些」。
- **已定口径**：整段收快，但保留「从按点上的小液团长成面板」的形变（不改成淡入）。
- **改动面**：`global.css` 的 `.ctx-menu` / `.ctx-item` 两条 animation；`ContextMenu.tsx` 的
  `CTX_STAGGER_MS`。
- **实现要点**：面板 520ms → `var(--dur-3)`（300ms，仍 `linear`，曲线烘在关键帧里）；
  选项 360ms → `var(--dur-2)`（200ms）；固定延迟 130ms → 80ms；步进 36ms → 24ms。
- **护栏**：`tools/context-menu-test.mjs` 的 ⑨ 段改成断言「走 `--dur-3` / `--dur-2`」，
  并**读 motion.css 的令牌值**确认 `--dur-3` ≤ 320ms（防止有人把令牌改慢回来）。
- **反例**：清单第 9 条。
- **落地（2026-10-01，提交 `d2d44f3`）**：真机实测「按点到全部选项不透明」的时长由 520ms 档
  降到 300ms 档（帧序列数字见走查记录）。

### H4 长按菜单优先向左上方弹出
- **现状证据**：旧定位是 `left = req.x`、`top = req.y`（菜单从按点向右下铺开），只做四边夹紧。
  霖原话「长按菜单应该优先向左上方弹出。因为如果向下弹出，内容会被手指挡住」。
- **已定口径**：手指长按呼出的菜单以**右下角贴按点**（向左上弹）；左边放不下翻到右边、
  上边放不下翻到下边，最后四边夹紧。鼠标右键保持向右下弹（Windows 习惯，鼠标不会被自己
  挡住）——这条是本章唯一由实现方按「长按」的字面作用范围做的取舍，已向霖报告，若霖要求
  PC 也向左上，改一行判断即可。
- **改动面**：`components/ContextMenu.tsx`（`pressHold` 记时间戳、`takeHoldOrigin()` 判定来源、
  定位分两套首选方向）。
- **实现要点**：来源判定带 800ms 有效期，长按后没有真的开菜单也不会影响随后的鼠标右键；
  展开原点（液团那一角）由**本次**决策决定，不再用「按点在哪半屏」的启发式。
- **护栏**：`tools/context-menu-test.mjs` 的 ④ 段改成五条：区分来源、长按首选左上、
  左上放不下翻转、鼠标首选右下、右下放不下翻转，外加统一的四边夹紧公式与原点断言。
- **反例**：清单第 7、8、16、17 条。
- **落地（2026-10-01，提交 `d2d44f3`）**：真机在页面中部/右下角/左上角三种按点上各长按一次，
  菜单与按点的相对位置见走查记录（含翻转那两次）。

### H5 两级按压动画与其余元素的毛玻璃遮罩
- **现状证据**：长按只给一次触感，按下的目标没有尺寸反馈；页面其余元素在菜单弹出时完全不动。
  霖原话「添加两极按压动画：若点按，则轻微缩小再放大回原大小；若长按呼出菜单，则先缩小再
  放大到原大小的 1.1 倍突出显示选中的目标，并且给除了选中目标和 context menu 以外的元素都
  上一个 blur 遮罩」。
- **已定口径**：轻点 = 缩到 0.97 再回 1；长按 = 先缩到 0.97，再放大到 1.1；**尺寸变化不影响
  布局**（霖确认「尺寸变化是不影响布局的…即便变大之后会盖住其他元素」），因此只用
  `transform: scale()`；毛玻璃只在手机（触摸）路径上出现。
- **改动面**：`components/ContextMenu.tsx`（`PRESS_ATTR`、`pressDown`/`pressHold`/`clearPress`、
  `stackingRoot`/`createsStackingContext`、`createLongPress` 接三处长按入口）；
  `global.css`（`[data-ctx-press]` 两级规则 + `.ctx-blur` + reduced-motion 降级）；
  `styles/motion.css` 注释同步注明这条例外。
- **实现要点**：
  - 长按那一轮按压在菜单关闭前一直保持 1.1 与遮罩（`held` 标志挡住抬手时的 `clearPress`），
    菜单卸载时统一收掉；同一触摸会被两个长按入口看到（单项 `useLongPress` 与全局兜底层），
    所以 `clearPress(el)` 只清自己按下去的那一个，否则先按下的目标会在抬手时被另一路提前收回。
  - 遮罩挂 body、盖住整屏（含顶栏 z-index 30 与底栏 60），在目标处用
    `clip-path: polygon(evenodd, …)` 挖一个洞；洞的尺寸取 `offsetWidth/Height × 1.1`
    （不是取当前矩形——按下的那一瞬间矩形还在 0.97 → 1.1 的过渡里，量到的偏小会切到目标的边），
    中心点取当前矩形的中心（`transform-origin` 是中心，缩放不移动中心）。目标放大后正好填满洞。
  - 反过来的写法（把遮罩塞进目标的层叠上下文、再把目标抬到遮罩之上）只能遮住页面内容区：
    顶栏与底栏是另外两个定位层，抬不上来也遮不住，真机实测遮罩盒子只有 358×1657 @ y=86。
  - 遮罩 `pointer-events: none`，点页面空白处仍能关菜单；`prefers-reduced-motion` 下取消过渡。
  - 层级：菜单 2400 > 遮罩 2390 > 顶栏 30 / 底栏 60。dev 徽标（9000）不参与遮罩（只是调试用，
    生产包没有）。OH 悬浮坞三层（胶囊 9991 / 面板 9992 / 语音遮罩 9990）：**霖 2026-10-02 复看
    要求纳入毛玻璃**——遮罩存在期间由 `html.ctx-blur-on` 压到 2389，与页面一起发糊；其余时刻
    层级不变（真机实测：长按按住时 `.dock-island` 的 `z-index` 由 9991 → **2389**，遮罩消失后
    回到 9991；截图 `.tmp-shots/c3-b9-fixed.png` 长按态里底部「（OH）聊点什么吧！」胶囊与整页
    一起发糊，dev 徽标仍清晰）。
- **与老口径的关系**：§2/§3 里「整行/整卡按下去只压暗底色、绝不改尺寸」针对 `:active` 的常态
  反馈（理由是会连带文字重排）；本条只在长按目标上用 transform，transform 在绘制期生效、
  不参与布局，两条不冲突，motion.css 的注释已注明例外与理由。
- **护栏**：`tools/context-menu-test.mjs` 新增 ⑨b 段共十一条：`PRESS_ATTR` 常量、三个按压函数、
  两处入口把状态挂到目标、抬手按元素收尾（不许清别人的）、卸载兜底、0.97 与 1.1 两个档位
  且都带 `!important`、按压块不许出现宽高/内外边距、遮罩挂 body、`HOLD_SCALE` 与洞的尺寸算法、
  层级顺序（菜单 > 遮罩 > 顶栏）、遮罩放行点击、reduced-motion 降级。
- **反例**：清单第 11、12、13、18–25 条。
- **落地（2026-10-01，提交 `d2d44f3`）**：
  - 已验证（真机 <设备>，把遮罩塞进目标层叠上下文的那一版）：轻点 250ms 时 transform 走
    1 → 0.97（t≈671ms）→ 1（t≈909ms，抬手即回）；长按 800ms 时 0.97 → 1.1（列表委托那条路径
    采样到 0.99 → 1.06 → 1.1 的过渡中间值）。目标矩形 358×131 → 393.8×144.1（正好 ×1.1），
    前后邻居卡片的矩形在 78 帧里一个都没变（没有布局位移）；那一版遮罩盒子只有
    358×1657 @ y=86，顶栏与底栏没被遮住，所以才改成「挂 body + 挖洞」。
  - 已在 WebView2（PC 开发包，同一套 Chromium 语义）上用**合成触摸事件**复核挖洞版几何：
    按下 attr=`tap` / transform ×0.97 → 长按 attr=`hold` / ×1.1；遮罩 `parentElement` 是
    BODY、z-index 2390；`clip-path` 的洞与放大后的目标矩形逐像素对齐；抬手后属性/遮罩/菜单
    都还在，点空白处关闭后三者全清。
    - 整窗（1240×820）：遮罩 1230×820，洞 `243px 123px → 883px 252px`（目标 offset 582×117）。
    - 手机视口模拟（`Emulation.setDeviceMetricsOverride(400×805@3, mobile)`，`CSS.supports`
      认得 `polygon(evenodd, …)`）：遮罩正好 `0,0,400,805`，洞 `-2px 246px → 392px 381px`
      （= 358×123 的 1.1 倍），菜单右 195 / 下 313 贴按点（左上），背景 alpha 0.56、
      `blur(22px) saturate(1.6)`。
    - 截图 `.tmp-shots/b2-pc-touch-hold.png`（整窗）与 `.tmp-shots/b2-pc-mobile-emu-hold.png`
      （手机版式：整屏发糊、顶栏底栏一起糊，目标卡片与菜单清晰；OH 悬浮坞当时按设计清晰，
      现已改为一起发糊，见上方层级那条）。
  - 真机复验（<设备>，装提交 `d2d44f3` 重编的 APK）：长按今日页卡片 —— 遮罩
    `0,0,400,805.33`（整屏，父节点 BODY、z-index 2390、`blur(7px)`），洞
    `-2px 263px → 392px 407px`（= 卡片 358×131 的 1.1 倍），目标 ×1.1、前后邻居 78 帧未动；
    抬手后属性/遮罩/菜单仍在，点空白处三者全清。列表委托那条路径（课程卡）也复验了，
    采样拿到整条过渡：1 → 0.98 → 0.97 →（长按）1.03 → 1.08 → 1.1。
  - 遮罩确实盖住了顶栏与底栏：同一张截图里用边缘能量（`sobel` + `signalstats` 的 YAVG）量，
    内容区 3.72 → 0.62、底栏左 7.24 → 1.67、底栏中（避开 OH 悬浮坞）5.46 → 0.79；
    顶栏 z-index 30 低于底栏 60，底栏都被盖住了，顶栏必然也在遮罩之下。

### H6 长按菜单透明度提高
- **现状证据**：`.ctx-menu` 背景是 `surface-container-lowest` 74% 不透明 + `blur(18px)`。
  霖原话「增加 context menu 的透明度」。
- **已定口径**：面板更透，但不能牺牲文字可读性——透明度降到 56%，同时把背景模糊从 18px
  提到 22px（糊得更狠一点顶住对比度），边框透明度 72% → 60%。
- **改动面**：`global.css` 的 `.ctx-menu` 一个规则块。
- **护栏**：`tools/context-menu-test.mjs` 新增断言：背景写法必须是
  `color-mix(... surface-container-lowest N%, transparent)` 且 N ≤ 60，模糊半径 ≥ 20px。
- **反例**：清单第 10 条。
- **落地（2026-10-01，提交 `d2d44f3`）**：真机截图对照菜单背后的内容可透过程度；同时读
  `getComputedStyle` 确认背景色 alpha 与 blur 半径。

### 13.7 反例清单（25 条，逐条改实现后跑对应护栏）
1. Monet 把源色写死成 `0xff6750a4` → `monet-test` 报「模块内零字面色」。
2. tertiary 板不转色相（`hue + 60` → `hue`）→ 基线向量报 tertiary 与 primary 同色。
3. 色盘停点从 5 个删到 4 个 → `monet-test` 报停点数不是 5。
4. 反变换少除 `nbb` → `monet-test` 报 HCT 往返误差过大（实测 Δ9）。
5. Mine 页把 `--mine-c1..5` 改名 → `mine-page-test` 报色盘没有挂到元素上。
6. hook 依赖数组改成 `[]` → `mine-page-test` 报不跟主题快照重算。
7. 长按菜单改回向右下弹（`left = req.x`）→ `context-menu-test` 报没有优先左上。
8. 左上放不下时不翻转（改成 `left = MENU_MARGIN`）→ 报翻转缺失。
9. 面板动画退回 520ms → 报时长不是 `--dur-3`。
10. 面板透明度退回 74% → 报背景不够透。
11. 抬手时不收按压（删 `if (!held) clearPress()`）→ 报收尾缺失。
12. 按压规则里加一条 `padding: 2px` → 报按压动了尺寸/边距。
13. 遮罩塞回目标的层叠上下文（`stackingRoot(el).appendChild`）→ 报挖洞缺失——那一版只能遮住内容区。
14. dev 徽标挪回左下角 → `topbar-chrome-test` 报没有居中。
15. dev 提交号不隐藏 → 报没缩成小标。
16. 定位不区分手指/鼠标（`fromHold = true`）→ 报来源判定缺失。
17. 鼠标右键也改左上 → 报鼠标路径被改掉。
18. 放大倍数写成 1.05 → 报档位不是 1.1。
19. 菜单 z-index 掉到遮罩之下（2400 → 2350）→ 报菜单压在遮罩之上缺失。
20. 遮罩 `pointer-events` 改回 `auto` → 报点空白处关不上菜单。
21. 长按目标不抬 z-index → 报目标没抬到同层兄弟之上（这条第一次没拦住：护栏用
    `[\s\S]*?` 一路匹配到了后面 `.ctx-blur` 的 2390，收成「只在 hold 规则的花括号里找」才拦住）。
22. 放大档位写成 1.15 → 报 `scale(1.1) !important` 缺失。
23. 遮罩 z-index 掉到顶栏之下（2390 → 20）→ 报压不住顶栏。
24. 遮罩不挖洞（`polygon(evenodd, …)` → `polygon(…)`）→ 报挖洞缺失。
25. 洞按当前矩形算（`r.width / 2` 而不是 `offsetWidth × HOLD_SCALE / 2`）→ 报洞的尺寸算法不对。

### 13.8 与老条目冲突的处置
- §2/§3「整行/整卡按下去只压暗底色、绝不改尺寸」：**部分被 H5 取代**——常态 `:active` 反馈
  照旧（压暗底色），长按目标的 1.1 突出用 transform 实现。两处注释都已互相引用。
- §12 G1 里 dev 徽标「挪到左下角、抬到 OH 悬浮坞之上」：**被 H2 取代**（顶栏正中、小标）。
- §12 G1 的顶栏三段（`<` / 标题 / `···`）与 §13 无冲突，H2 只动了徽标。

### 13.9 复核表（真机复验 + 手机版式的 WebView2 辅证）

**真机复验**（<设备>，装提交 `d2d44f3` 重编的 APK，六条逐条重测）：

| 条 | 真机数字 |
| --- | --- |
| ① | 当前主题源色 `#0f1115` → 停点 `#d4d4da / #afaaac / #9d9da3 / #c8c6c7 / #878285`（5 个互不相同，与 WebView2 模拟里 warmsand 那一组完全一致） |
| ② | 徽标 180..220（中心 200 = 视口中心）、y 18..54；徽标中心 `elementFromPoint` 命中 `dev-badge`；提交号 0×0 且 `display: none` |
| ③ | 菜单「出现 → 落定」335ms / 370ms / 338ms 三次；`ctx-bloom` 300ms、选项 0.2s + 延迟 0.08s |
| ④ | 按点 (200,330) → 菜单右 200 / 下 330（左上）；按点 (200,119) → 菜单上 119（翻下）；按点 (30,330) → 菜单左 31（翻右）；顶栏「···」（底 54、心 367）→ 菜单 219..367 × 54..107（锚在按钮下方，且不出按压与遮罩） |
| ⑤ | 轻点 250ms：1 → 0.97；长按：0.97 → 1.03 → 1.08 → 1.1；遮罩 400×805.33 / BODY / z 2390 / `blur(7px)`；洞 `-2px 263px → 392px 407px`；邻居 78 帧未动；抬手保持、点空白全清 |
| ⑥ | 亮色菜单 `color(srgb 1 1 1 / 0.56)`、暗色 `color(srgb .082 .102 .141 / 0.56)`；遮罩底亮色 `color(srgb .0588 .0902 .1647 / 0.248)`、暗色 `color(srgb 0 0 0 / 0.341)`；两套都 `blur(22px) saturate(1.6)` |

截图（仓库外）：`.tmp-shots/dev-b2-h5-hold-upleft.png`（亮色整屏发糊 + 目标清晰）、
`dev-b2-h5-hold-dark.png`、`dev-b2-h5-hold-course.png`、`dev-b2-h4-flipdown.png`、
`dev-b2-h4-flipright.png`、`dev-b2-h1-mine.png`。

**WebView2 手机版式辅证**（手机连不上那几天做的，与上面的真机数字互相印证）：

把 PC 开发包的视口用 `Emulation.setDeviceMetricsOverride(400×805@3, mobile)`
模拟成手机、用 CDP 合成触摸事件代替手指，对同一份源码逐条复核：

手机连不上期间，把 PC 开发包的视口用 `Emulation.setDeviceMetricsOverride(400×805@3, mobile)`
模拟成手机、用 CDP 合成触摸事件代替手指，对同一份源码逐条复核（截图在仓库外）：

| 条 | 复核项 | 结果 |
| --- | --- | --- |
| ① | 主题跟随（violet / celadon / warmsand / midnight） | 源色 `#6d28d9` / `#0f766e` / `#0f1115` / `#1e3a8a` → 五个停点分别 `#eeb4ff…#bb6c83`、`#8ee4d9…#748699`、`#d4d4da…#878285`、`#b8d1ff…#9d7996`，逐主题整组换色 |
| ② | 顶栏中线 | 徽标 181..219（中心 200 = 视口中心）、y 18..54、字号 12px；根页无返回键、非根页返回键 16..50；`···` 350..384；标题右缘 94 / 91，与徽标间距 87 / 90px；徽标中心命中 `dev-badge`、`···` 中心命中图标；提交号 0×0 且 `display: none` |
| ③ | 弹出动画 | `ctx-bloom` 300ms；选项 0.2s、延迟 0.08s |
| ④ | 首选方向与翻转 | 按点 (195,313) → 菜单右 195 / 下 313（左上）；按点 (195,162) → 上 162（翻下）；按点 (28,313) → 左 28（翻右）；顶栏 `···`（底 54、心 367）→ 菜单 219..367 × 54..104（锚在按钮下方，且这条路径不出按压/遮罩） |
| ⑤ | 两级按压 | 250ms 时 `tap` ×0.97（无菜单、无遮罩）；长按 `hold` ×1.1；遮罩 400×805、z-index 2390、`blur(7px)`；洞 `-2px 246px → 392px 381px`（= 358×123 的 1.1 倍）；其余 8 张卡片矩形全程未变；抬手后保持、点空白处全清；`prefers-reduced-motion` 下过渡 0.001s、遮罩与菜单无动画 |
| ⑥ | 透明度 | 菜单背景 alpha 0.56（亮色 `color(srgb 1 1 1 / 0.56)`、文字 `rgb(15,17,21)`；深色 `color(srgb .082 .102 .141 / 0.56)`）+ `blur(22px) saturate(1.6)` |

注：这条通道验不了「课程卡列表委托」那类长按区——WebView2 里 `navigator.maxTouchPoints = 0`，
`useLongPressZone` 不装监听（`data-ctx-zone` 一个都没有）；那条路径靠真机那一轮。


---

## 14. 手感批次 2（霖 2026-10-02 走查，8 条）

**状态（2026-10-04 复核）**：本批 **K1–K8 全部落地**（K1 `92d6244`；K2–K7 的实现分别在 `styles/global.css` 的 `html, body { user-select: none }` + `.selectable` 例外、`@property --ctx-press-k` + `[data-ctx-press][data-ctx-press]` 双属性选择器、`ctx-blur-in/out` 关键帧与退场等待、`CtxApi.close()/isOpen()`、`components/Layout.tsx` 的 `useSwap` + `TOPBAR_SWAP_MS = 220`；K8 见本节末）。**注意**：本批各条的落地记录写在批次级段落与 §14.10 里，按小节标题搜索「落地」会把它们误判成未做，故在此登记。b28/b29 另为老引擎（WebView 96）补了 CSS 独立 `scale` 属性与 `:has()` 的兜底。

> 承接 §13：这批是霖在真机上接着走查提的 8 条，全部是「缩放/回弹/换场」这类手感问题。
> 与 §13 冲突的地方：§13 H5 的按压用 `transform` + `!important`（当时为了压过卡片入场动画），
> 这批 #1/#3/#5 把它换成独立的 `scale` 属性 + `--ctx-press-k`——同一个目标，机制换了，
> 旧口径作废（见 §14.1）。第 8 条按霖给的
> gesture-rubber-band.md 重做（橡皮筋公式 + 平滑收尾）。

### K1 按压缩放只作用于手指底下那个控件
- **现状证据**：「待办」页统计区与两个入口（`.tasks-mid`）整块挂在一个 `data-ctx-atom` 上，
  全局兜底层取的是 `e.target.closest("[data-ctx-atom]")`，于是整块一起缩、长按高亮也是一整块
  （霖原话：「会一起缩放。并且长按选中时也作为一个整体被选中」）。
- **已定口径**：**缩放/高亮给手指底下最近的那个离散控件**（button/a/[role=button]/input/
  select/label/summary），找不到才退回宿主；**菜单仍归宿主**（收藏的还是整块「全部作业」）。
- **改动面**：`components/ContextMenu.tsx` 新增 `PRESS_CTL_SEL` 与 `pressElOf()`，
  兜底层把「按压缩放对象」和「菜单宿主」分成两个变量（`pressEl` / `hit`）。
- **护栏**：`tools/context-menu-test.mjs` 断言常量、函数与两处接线（含 `() => pressEl`）。
- **反例**：清单第 1 条。
- **落地（2026-10-02，提交 `92d6244`）**：真机数字见 §14.10。

### K2 全站先禁止文字选中
- **现状证据**：只有按钮/图标那圈是 `user-select: none`，正文、标题、卡片文字都能被长按框蓝，
  长按菜单还常被浏览器的选区手势抢走。
- **已定口径**：`html, body` 一律 `user-select: none`；**输入框、可编辑区、`.selectable` 例外**
  （否则没法选词/改错字）。霖说以后逐处放开，届时把那几处标 `.selectable` 即可。
- **连带处置**：`TEXT_ZONES`（长按不接管的文本容器）从 `.rich, .tech-details-body, pre, code,
  input, textarea` 收成 `.selectable, input, textarea`——正文类既然选不了了，再让路只会变成
  「既选不了、也没菜单」。
- **护栏**：`tools/mobile-chrome-test.mjs`（禁选与例外）、`context-menu-test.mjs`（TEXT_ZONES 收窄）。
- **反例**：清单第 2、3 条。

### K3 「待办」页作业卡片长按不再整张平移
- **现状证据**：卡片流按位置写内联 `transform: translate(-50%,-50%) translateY(y) scale(s)`，
  而 §13 的按压是 `transform: scale(1.1) !important`——把定位一起顶掉，卡片跳到村右下角。
- **已定口径**：**按压不再碰 `transform`**。通用路径用独立的 `scale` 属性；卡片流这种
  「transform 里带定位」的元素把 `--ctx-press-k` 乘进它自己的 transform，并 `scale: none`
  避免二次缩放。
- **改动面**：`styles/global.css`（`@property --ctx-press-k` + `[data-ctx-press].hw-card`）、
  `pages/TasksPage.tsx`（卡片 transform 加 `calc(… * var(--ctx-press-k, 1))`）。
- **护栏**：`tools/context-menu-test.mjs` 三条（opt-out、系数接线、按压块里不许再出现 `transform: scale(`）。
- **反例**：清单第 4、5 条。

### K4 遮罩减弱 + 出现/退场带模糊半径渐变
- **现状证据**：遮罩 `blur(7px)` + scrim 55%，霖说「blur 效果太强」；且出现/退场只动
  `opacity`，退场还是 `remove()` 一帧消失。
- **已定口径**：模糊半径降到 `--ctx-blur-r: 4px`、scrim 降到 34%；出现 `0 → 4px`、
  退场 `4px → 0` 各走 `var(--dur-2)`；退场先挂 `.is-out` 播完再摘节点（200ms）。
- **改动面**：`global.css`（变量 + 两条关键帧）、`ContextMenu.tsx`（`ensureBlur()` 复用节点、
  `clearPress()` 等动画播完再摘、`BLUR_OUT_MS`）。
- **护栏**：`tools/context-menu-test.mjs`（半径 1–4px、scrim ≤40%、进出场关键帧、退场等待）；
  既有的「关键帧只许动 transform/opacity/clip-path」对 `ctx-blur-in/out` 放行 `backdrop-filter`。
- **反例**：清单第 6、7、8 条。

### K5 补齐缺失的缩放过渡
- **现状证据**：「今日」页余额速览（`.home-card`）按下是突变。根因：卡片自带
  `animation: page-in … both`，动画末帧压在 `transform` 上，而过渡写在 `transform` 上时
  跟动画抢同一个属性，跳帧。
- **已定口径**：过渡走 `scale`（与 `transform` 无关），且选择器写成
  `[data-ctx-press][data-ctx-press]`（0,2,0）——元素自己写的 `transition` 会压掉单属性选择器。
  卡片流那条走 `transition: --ctx-press-k`。
- **注意**：`@property --ctx-press-k` 注册成 `<number>` 后自定义属性才能插值；没注册时
  卡片流的缩放会变成离散跳变。
- **护栏**：`context-menu-test.mjs` 两条（双属性选择器 + 过渡属性是 scale）。
- **反例**：清单第 9、10 条。

### K6 顶栏「···」改成切换
- **现状证据**：`openMenu()` 无条件 `ctx.open(...)`，菜单开着时再按一次会原地重播展开动画。
- **已定口径**：**菜单已打开 → 关掉**；否则打开。`CtxApi` 补 `close()` 与 `isOpen()`
  （用 ref 记状态，api 引用保持稳定，顶栏的 `useCallback` 不会每次重建）。
- **改动面**：`ContextMenu.tsx`（CtxApi + NOOP + 兜底层实现）、`Layout.tsx`（`openMenu`）。
- **护栏**：`context-menu-test.mjs`（接口两方法 + 顶栏切换分支）。
- **反例**：清单第 11 条。

### K7 顶栏 logo↔返回键、标题文字换场
- **现状证据**：`{target ? <button.topbar-back> : <BrandLogo>}` 与 `<span.topbar-title>` 都是硬切。
- **已定口径**：logo 退向左淡出、进从左滑入；返回键进从右滑入、退向右淡出；标题旧文字向左
  淡出、新文字从右淡入。方向写死在类上（`.is-in` / `.is-out`），组件不传方向。
- **改动面**：`Layout.tsx`（`useSwap()` + `TOPBAR_SWAP_MS`；logo 与标题各接一次；
  **进场的一份排在前面**——`.topbar-back`/`.topbar-title` 的查询要拿到当前那份）；
  `global.css`（`.topbar-lead` / `.topbar-lead-out` / `.topbar-title-wrap` + 6 条关键帧）。
- **护栏**：`tools/mobile-chrome-test.mjs` 六条（换场接了两处、退场那份存在、进场在前、
  三条方向、退场那份脱离布局且放行点击）。
- **反例**：清单第 12、13、14、15 条。

### K8 页面过冲回弹改成「橡皮筋 + 平滑收回」
- **现状证据**：`EDGE_ZETA = 0.42` 欠阻尼弹簧 + 反向过冲封顶 `EDGE_BACK_MAX = 26`，
  霖实测「回弹一次以后会像弹簧一样来回震一会」。霖给了参考实现
  （dot-skills 的 `gesture-rubber-band.md`）。
- **已定口径**（照参考）：拖拽位移 = `limit` 以内 1:1、之后
  `limit + excess·c/(1 + excess·c/limit)` 渐进抵抗；松手**平滑收回**，不再来回震。
- **落地取值**：`EDGE_FREE = 8`、`EDGE_MAX = 60`、`EDGE_COEF = 0.4` →
  拖 44px→19.6、100px→30.8、300px→47.6（改造前 22 / 31 / 38，几乎一致，只有大幅时略松）；
  `EDGE_ZETA = 1`（临界阻尼，一次收回），删掉 `EDGE_BACK_MAX` 与反向过冲夹断。
- **改动面**：`Layout.tsx`（常量、`rubber()`、`springTo0()` 的越界夹断）。
- **护栏**：`tools/mobile-chrome-test.mjs` 三条（新公式、ζ=1 且 `EDGE_BACK_MAX` 已删、
  越零就地夹断）。
- **反例**：清单第 16、17 条。

### 14.9 反例清单（20 条，逐条改实现后跑对应护栏）
| # | 反例（改坏成什么样） | 期望被哪条断言拦住 |
| --- | --- | --- |
| 1 | 兜底层把 `pressEl` 退回整块宿主 | context-menu #1 接线 |
| 2 | 删掉 `html, body` 的 `user-select: none` | mobile-chrome 禁选 |
| 3 | 输入框没留 `user-select: text` 例外 | mobile-chrome 例外 |
| 4 | `.hw-card` 去掉 `scale: none`（二次缩放） | context-menu #3 opt-out |
| 5 | 卡片 transform 不乘 `--ctx-press-k` | context-menu #3 接线 |
| 6 | `--ctx-blur-r` 调回 7px 以上 | context-menu #4 半径 |
| 7 | 删掉 `.ctx-blur.is-out` 退场动画 | context-menu #4 关键帧 |
| 8 | 退场直接 `remove()` 不等动画 | context-menu #4 退场等待 |
| 9 | 按压过渡写回 `transform` | context-menu #5 过渡属性 |
| 10 | 过渡选择器退回单属性 | context-menu #5 双属性 |
| 11 | 顶栏「···」删掉 `isOpen()` 分支 | context-menu #6 切换 |
| 12 | 标题换场删掉退场那份 | mobile-chrome #7 退场 |
| 13 | logo 入场方向反过来 | mobile-chrome #7 方向 |
| 14 | 退场那份改回 `position: relative` | mobile-chrome #7 脱离布局 |
| 15 | 退场那份没 `pointer-events: none` | mobile-chrome #7 放行点击 |
| 16 | `EDGE_ZETA` 退回 0.42 | mobile-chrome #8 ζ |
| 17 | 橡皮筋退回旧公式（没有 limit 段） | mobile-chrome #8 公式 |
| 18 | 通用按压规则里又写一份 `--ctx-press-k`（真机踩过：倍率恒为 1） | context-menu #5 倍率 |
| 19 | 按压块里又出现 `transform: scale(` | context-menu #5 无 transform |
| 20 | 「点外面即关」不给 `data-ctx-trigger` 放行（真机踩过：第二下变重开） | context-menu #6 触发器放行 |

自检记录（2026-10-02）：20 条逐条改实现跑对应护栏，**全部被拦住**（脚本
`/tmp/anti3.py`，与 §13.7 同一套做法）。第 14、15 条一开始漏过——护栏原来是在
「从 `.topbar-lead-out {` 往后切一大段」里找 `pointer-events: none`，被后面别的规则顶包了，
已收紧成「必须在这条规则体内」；这类「断言写得比意图松」的洞正是反例自检要抓的东西。

### 14.10 真机复验（REDMI K90 Pro Max / Android 16 / WebView 134，提交 `33cc6a7` 重编的 APK）
装 `app.onethu.desktop.dev`（versionName 0.10.0-dev，APK 18,637,693 字节，前端 chunk
`index-BDbzWPfL.js` 等 4 个与本地 dist 逐一比对一致），逐条采样式复核（CDP 合成触摸 +
逐帧读计算样式；APK 里嵌的前端与本次源码一致，避免「测了个旧包」）。

- **K1 待办页统计区**：按点 = 第一个统计按钮（CSS 60,487）。长按 900ms 后
  `[data-ctx-press]` 落在 `task-stat`、`--ctx-press-k = 1.1`，**按钮矩形 88×80 → 96×88（×1.1）**，
  而 **`.tasks-mid` 仍 358×80、第二个统计按钮仍 114,447,88,80**——整块没跟着缩。
  遮罩 400×805，洞 12,443→108,531 正好是缩放后的那个按钮；菜单仍是整块「全部作业 ▸ 收藏」。
- **K2 禁选**：正文 `.notice-strip-text`（10 字）计算值 `user-select: none`，
  程序化 `selectNodeContents` 选中长度 **0**；把禁令用运行时样式撤掉后同一段文字选中长度 **10**
  （A/B 对照）。真机长按 900ms：选区长度 0，菜单照常出来。例外侧：`#/services` 搜索框与
  `#/settings` 输入框 `user-select: text`、可聚焦。
- **K3 待办页卡片流**：长按前卡片中心 (206,328)，`transform: matrix(1,0,0,1,-155.018,-84)`；
  长按 900ms 后中心 **(206,328) → 位移 (0,0)**，矩形 310×168 → 341×185，矩阵
  `scaleX = 1.1`、平移仍是 `e=-155 f=-84`（车道的定位没被顶掉）。改造前这一步是跳到右下角。
- **K4 遮罩**：出现 `backdrop-filter` 逐帧
  `0 → 1.61 → 2.70 → 3.63 → 3.84 → 3.93 → 3.97 → 4.00px`、opacity `0 → 0.40 → 0.68 → 0.91 →
  0.96 → 0.99 → 1.00`（≈200ms）；点外面关菜单后退场 `4.00 → 1.03 → 0.67 → 0.16 → 0.05 →
  0.009 → 0px`、opacity 同步落 0，`is-out` 挂上，**节点 171ms 后移除**。半径上限 4px
  （改造前 7px），scrim 34%（改造前 55%）。
- **K5 余额速览按压过渡**：轻点逐帧 `scale = 1 → 0.9933 → 0.9720 → 0.9692 → 0.9700 → 0.97`
  （≈200ms 收敛，不是突变）；长按 `0.97 → 0.9906 → 1.0276 → 1.0938 → 1.1046 → 1.10`。
  这条同时暴露并修掉一个只有真机才看得见的坑：倍率原本写在通用规则
  `[data-ctx-press][data-ctx-press]` 里，选择器比 `[data-ctx-press="tap"]` 更具体，
  于是 `--ctx-press-k` 恒为 1——属性挂上了、过渡也在，按下去就是不动。倍率已挪进
  tap/hold 两条规则，初值交给 `@property` 的 `initial-value`。
- **K6「···」**：连按三次 = **开 → 关 → 开**。第一版改完真机还是「每次都重开」：捕获期的
  「点外面即关」抢在按钮 click 之前把菜单关掉，click 里 `isOpen()` 已经是 false。
  加 `data-ctx-trigger` 放行后才对。
- **K7 顶栏换场**（根→子页，logo 换返回）：退场 logo `opacity 0.60 → 0.00`、
  `translateX -4.01 → -9.99`（向左淡出）；进场返回 `0.40 → 1.00`、`translateX 8.38 → 0.013`
  （从右进入）；退场标题「今日」`0.42 → 0.00`、`translateX -6.91 → -12.00`（向左淡出）；
  进场标题「成绩」`0.58 → 1.00`、`translateX 5.09 → 0.000026`（从右淡入）。
  反向（子页→根）：退场返回 `1.00 → 0.00`、`translateX 8.05 → 14.00`（向右淡出）；
  进场 logo `0.57 → 1.00`、`translateX -4.25 → -0.002`（从左进入）。整段 ≈220ms。
- **K8 过冲回弹**：拖拽段越界 26/52/78/104/130/156/182/208/234px 对应位移
  14.43/21.61/27.09/31.41/34.91/37.80/40.22/42.29/44.06px（渐进抵抗）。松手后从峰值
  44.17px **单调**收回，**反向穿越 0 次**；收到峰值 50% ≈199ms、10% ≈382ms、2% ≈491ms、
  <0.1px ≈630ms（rAF 逐帧计时，含采样开销）。改造前会来回震好几下。
- 截图：`.tmp-shots/dev-b3-k1-hold.png`（统计按钮单独放大 + 弱遮罩 + 整块菜单）、
  `dev-b3-k3-card-hold.png`（卡片原位放大 + 车道位置不变）、`dev-b3-k4-blur.png`（4px 弱遮罩）。

## 15. 手感批次 3（霖 2026-10-02 走查，8 条）

这一批的问题都出在**上批改完之后的真机观感**上，所以先按「能不能量」分层：能量的一律给逐帧数字，
量不出的（形状错乱、振动次数）先找出物理成因再定口径。八条各自的落地如下。

### 15.1 长按只许振一次（#1）

真机取证（`dumpsys vibrator_manager`，一次 2.6s 长按）里一次长按是**两条**记录：一条 43ms 的
`Prebaked=CLICK(MEDIUM)`，紧跟一条 221ms 的本应用 `ui_haptic_tick(longPress)`。前一条是
WebView 识别到长按后**系统自己给的** `HapticFeedbackConstants.LONG_PRESS`，后一条是本仓发的。
两条一叠就是「很大概率连触发两次」；「小概率一次」是偶尔系统那条没排上（被本应用那条 supersede 掉）。

JS 侧能压掉系统那条的唯一手段是 `touchstart.preventDefault()`（实测：注入后振动记录从 2 条掉到 1 条），
但它会连**click 一起废掉**——整站的按钮、行、卡片全部点不动，不能走。所以这一条的口径定为：
**本仓不再自己发长按触感**，只留系统那一条，长按恰好一次。同时保留手势级去重
（`HOLD_DUP_BEGIN_MS = 40`：同一手势被单项 `useLongPress` / 长按区 / 全局兜底层多路看到时，
只让第一路弹菜单，重复那一路仍然记 `held`，否则它抬手会把另一路的高亮与遮罩收掉）。

**2026-10-02 复看（霖：「长按手感恢复」）——两头配套，恢复本仓那条 221ms 触感。**
只留系统那条的代价是手感差：系统给的 `CLICK(MEDIUM)` 是「咔」一下，本仓的 `longPress`
（`EFFECT_LONG_PRESS` / 老机退 `HEAVY_CLICK`，本机落到 221ms THUD）才是「按住」的闷响。
所以改成**在宿主侧关掉 WebView 那一层**：
- 前端恢复 `haptic("longPress")`（触发瞬间先给触感，菜单随其后）；
- Kotlin 新增 `webHapticsOff` 命令（`OnethuMobilePlugin.kt`）：在视图树里找到主 WebView，置
  `isHapticFeedbackEnabled = false`——只影响 `View.performHapticFeedback`（即 WebView 那条系统
  长按反馈），本仓触感走 `Vibrator` 服务不受影响。用遍历视图树而不是 `Plugin.load(webView)`：
  不依赖 Tauri 插件基类的版本差异，且对话框里的临时 WebView 不在 `decorView` 里、不会被误伤；
- 前端在应用挂载时（`installGlobalHaptics`）调一次 `ui_web_haptics_off`（Rust 侧同名命令转发）；
- **两头必须同时成立**：只关一头 = 又变两声或一声都没有，所以护栏 `tools/context-menu-test.mjs`
  与 `tools/haptics-test.mjs` 现在同时钉「前端发 longPress」与「宿主关 WebView 触感 + Rust 接线」。
**真机复验（2026-10-02，DEV b9，一次 900ms 合成长按）**：`dumpsys vibrator_manager` 新增记录**只有一条**且来自本应用
——`app.onethu.desktop.dev | usage: TOUCH | played: Prebaked=167(MEDIUM, with fallback) | duration: 188ms`，
**没有**那条 43ms 的 `CLICK(MEDIUM)`；同一次长按里 `data-ctx-press="hold"`、`.ctx-blur` 与 `.ctx-menu`
同时到位，说明「一条触感 + 菜单 + 毛玻璃」三者是同一拍。

### 15.2 菜单离场动画（#2）

`ContextMenu` 拆出 `leaving` 状态：`closeMenu()` 先把 `openRef` 置 false（这样「···」连按是
开→关→开，而不是又重开），挂 `.ctx-menu.is-out` 播 `ctx-menu-out`（`opacity 1→0`、`scale 1→0.94`，
`MENU_OUT_MS = 180ms`，`--md-sys-motion-easing-standard-accelerate`），到点再 `setReq(null)`。
长按菜单与「···」菜单是同一个本体，一处改完两处都有；`is-still`（无液团那一路）用 1ms 直落，
避免「本来就没生长」的面板还缩一下。

### 15.3 模糊渐入渐出拉长（#3）

`ctx-blur-in` 200ms → **420ms**、`ctx-blur-out` → **320ms**，曲线都换成
`--md-sys-motion-easing-standard`（慢起），`BLUR_OUT_MS` 与 CSS 同值（护栏里加了这条同值断言，
免得一边改了另一边忘）。半径上限仍是 4px、scrim 34%（霖上批已确认）。

### 15.4 遮罩形状错乱（#4）

成因是挖洞用的**单条** `polygon(evenodd, 四角, 洞四角)`：外圈与洞之间的两条斜连线自身相交，
evenodd 规则把斜线左侧那块三角判成「外」，于是左半边出现一块清晰三角。改成
`path(evenodd, "M0 0 H<vw> V<vh> H0 Z  M<洞> Z")`——**两条独立子路径**，没有连线，也就没有自交。

### 15.5 圆角元素被挖成直角（#5）

`holeClip()` 现在按目标自己的 `border-top-left-radius` 画四段 `A` 弧（`holdRadius()` 读计算值，
再 `Math.min(radius, w/2, h/2)` 夹紧），洞跟目标的圆角一致。

### 15.6 顶栏标题只做「新文字从右渐入」（#6）

按霖的口径**删掉旧文字的退场副本**（`.topbar-title-out` 关键帧与 `.topbar-title.is-out` 规则一并删除），
只留 `topbar-title-in`（`opacity 0→1`、`translateX 12px→0`）。换标题时给元素挂 `key={title}`，
让它重挂、重播进场动画——同元素只改 class 只会补播，不会重播。logo 与返回键仍是双向换场。

### 15.7「我的」页数字卡与列表的间距（#7）

`.mine-services` 补 `margin-top: 20px`（4pt 网格内）。

### 15.8「我的」页学生卡（#8）

- 院系 / 邮箱从「一整句」拆成 `mine-meta-line`：`mine-meta-label` 定宽 32px、`--text-3` 灰色，
  `mine-meta-value` 占余宽、`--text-1`；标题与内容一眼分得开。
- 头像 `calc(var(--mine-card-h) / 2)` → `calc(var(--mine-card-h) * 3 / 8)`（= 原来的 3/4），
  比例仍绑在同一个变量上，不写死像素。
- 学生卡阴影 `--shadow-1` → `--shadow-2`（这一条**覆盖 §12 G3 里「阴影照作业卡片」的口径**：
  霖看过真机后要更明显的一档）。

### 15.9 反例清单（17 条，逐条改实现后跑对应护栏）

去重删掉、`held` 位置挪到去重之后、长按又自己发一条触感、`.ctx-menu.is-out` 规则改名、
关菜单不挂 `is-out`、关菜单立刻摘节点、遮罩进场退回 200ms、退场 CSS 与 `BLUR_OUT_MS` 不同步、
挖洞退回单条 `polygon(evenodd`、`rr` 不再由 `radius` 夹出、标题退场副本加回、
`topbar-title-out` 关键帧加回、`.mine-services` 间距归零、头像退回 1/2、阴影退回 `--shadow-1`、
院系邮箱揉回一整句、内容不再用 `mine-meta-value` 栏——17 条全部被护栏拦下（`/tmp/anti4.py`）。

### 15.10 真机复验（REDMI K90 Pro Max / Android 16 / WebView 134，提交 `688ccb1` 重编的 APK）

装 `app.onethu.desktop.dev`（APK 18,637,693 字节，前端 chunk `index-BiaCXlB_.js` 与本地 dist 一致）。

- **#1 振动次数**：待办页统计按钮连做 3 次 2.6s 长按，`dumpsys vibrator_manager` 每次新增
  **1 条**（65ms `Prebaked=CLICK`），菜单照常弹出；改造前同一手法每次 **2 条**
  （43ms CLICK + 221ms 本应用那条）。
- **#2 菜单离场**：长按菜单 opacity `1.00 → 0.99 → 0.92 → 0.81 → 0.72 → 0.57 → 0.46 → 0.34 → 0.17`、
  scale `1 → 0.9499`，节点 **193ms** 后移除；「···」菜单 `1.00 → 0.95 → 0.89 → 0.76 → 0.67 → 0.51 →
  0.40 → 0.23`、scale → `0.9535`，**185ms** 后移除。改造前两处都是硬切。
- **#3 遮罩时长**：遮罩出现在长按判定后 t=502ms；blur 在 0/50/100/150/200/250/300/350/400/470ms
  依次为 `0 / 0.35 / 1.77 / 2.84 / 3.27 / 3.55 / 3.80 / 3.93 / 3.98 / 4.00px`，≥3.8px 用
  **311ms**、到顶 **≈470ms**；退场 `4px → 0` 用 **320ms**（改造前 200ms 内就到顶/消失）。
- **#4/#5 挖洞**：计算值
  `path(evenodd, "M 0 0 H 400 V 805 H 0 Z M 25 443 H 94 A 14 14 0 0 1 108 457 V 517 A 14 14 0 0 1 94 531 H 25 A 14 14 0 0 1 11 517 V 457 A 14 14 0 0 1 25 443 Z")`
  ——两条子路径、无斜连线；目标 `task-stat` 的 `border-top-left-radius` 是 `14px`，弧半径就是 14。
  截图 `.tmp-shots/dev-b4-mask.png`：「6 还剩作业」那张卡清晰且四角是圆的，左侧不再有清晰三角。
- **#6 顶栏标题**：今日 → 成绩，逐帧 `opacity 0.00 → 0.40 → 0.74 → 0.89 → 0.94 → 0.98 → 0.99 → 1.00`、
  `translateX 12 → 7.15 → 3.09 → 1.37 → 0.75 → 0.29 → 0.12 → 0.01px`，全程
  `.topbar-title.is-out` 副本数 **0**（旧标题直接消失）。
- **#7 间距**：三张数字卡 `bottom = 341`，服务列表 `top = 361`，间距 **20px**（改造前 0）。
- **#8 学生卡**：卡片高 168 → 头像 **63×63**（比值 **0.375** = 3/8）；`box-shadow` 是
  elevation-2 的三层值（改造前 shadow-1）；院系/邮箱 `label x=33 w=32 rgb(129,133,140)`、
  `value x=73 rgb(15,17,21)`，两栏分明。截图 `.tmp-shots/dev-b4-mine.png`。

## 16. 手感批次 4（霖 2026-10-02 追加，模糊曲线与底色）

> **状态（2026-10-04 复核）**：本章各条均已落地（正文没写「落地」二字，按小节搜「落地」会误判）。

### 16.1 渐入渐出改「慢入快出」的非线性贝塞尔

上一版用的是 `--md-sys-motion-easing-standard`（`cubic-bezier(0.2, 0, 0, 1)`）——
那是一条**起步极快**的 decelerate，半径前 1/4 段就冲到 3.27px，观感上跟线性没差别，
所以霖的反馈是「还是线性」。现在两条都换成 `--md-sys-motion-easing-standard-accelerate`
（`cubic-bezier(0.3, 0, 1, 1)`）：前段慢、后段收，半径变化落在整段的中后部。
进场 420ms、退场 320ms 不变（`BLUR_OUT_MS` 仍与 CSS 同值，护栏比对这两个数）。

### 16.2 遮罩底色减半

底色令牌 `--md-sys-color-scrim` 是 `rgba(15, 23, 42, .45)`，所以 `color-mix(... 34% ...)`
的实际压暗是 **0.45 × 0.34 = 15.3%**，画面整体发灰。现在百分比减半到
`color-mix(in srgb, var(--md-sys-color-scrim) 17%, transparent)`，实际压暗
**0.45 × 0.17 = 7.65%**——正好一半。模糊半径仍是 4px，遮挡感主要由模糊承担。

### 16.3 反例（2 条新增，累计 19 条）

曲线退回 `--md-sys-motion-easing-standard`、底色退回 `34%`——两条都被
`tools/context-menu-test.mjs` 拦下（`/tmp/anti4.py` 全部 19 条 0 漏过）。

### 16.4 真机复验（REDMI K90 Pro Max / Android 16，批次 4 的 `688ccb1` 之后重编 APK）

- **曲线**：遮罩出现在长按判定后 t=504ms；blur 在 0/50/100/200/250/300/350/400/420/470ms
  依次为 `0 / 0.02 / 0.47 / 1.38 / 1.73 / 2.29 / 2.78 / 3.40 / 3.72 / 4.00px`。
  同一手法在上批（standard）是 `0 / 0.35 / 1.77 / 3.27 / 3.55 / 3.80 / 3.93 / 3.98 / — / 4.00px`
  ——前 100ms 只走到 0.47px（上批同期 1.77px），后 120ms 才从 3.40 收到 4.00px。
  到 3.8px 用时 ≈434ms。
- **底色**：`.ctx-blur` 计算值 `background-color` = `color(srgb 0.0588235 0.0901961 0.164706 / 0.0766667)`
  （= 0.45 × 0.17），上批同位置是 0.153。
- **像素对照**（同一页面、同一位置长按后截屏，ffmpeg `crop+scale=1:1:flags=area` 取区域均值）：
  遮罩区（洞右侧）上批 **230** → 本批 **241**；洞内未遮罩的对照区 245 → 240；
  状态栏 254 → 253。也就是说遮罩区亮度抬了 11 级，已经贴到未遮罩区域的水平。
  截图 `.tmp-shots/dev-b5-mask.png`（上批 `dev-b4-mask.png` 可对照）。

### 16.5 批次 6：时长收回 200ms（曲线与底色不动）

霖 2026-10-02：「把模糊的时长改回 200ms 试试」。进场 420ms → **200ms**、退场 320ms → **200ms**
（`BLUR_OUT_MS` 同步改回 200，与 CSS 仍同值；护栏的时长区间从「≥300ms」改成 150–260ms），
曲线仍是 `--md-sys-motion-easing-standard-accelerate`（`cubic-bezier(0.3, 0, 1, 1)`），
底色仍是 17%（实际压暗 7.65%）。

真机逐帧（blur px，遮罩出现在长按判定后 t=513ms）：

| 出现后 | 0 | 33 | 100 | 133 | 183 | 216 |
|---|---|---|---|---|---|---|
| blur | 0.00 | 0.66 | 0.66 | 2.06 | 3.10 | 4.00 |
| opacity | 0.00 | 0.16 | 0.16 | 0.51 | 0.77 | 1.00 |

前 100ms 只走到 0.66px、最后 80ms 从 3.10 收到 4.00px，到 3.6px 用时 ≈210ms——慢入快出的形状没变，
只是整段收短。退场：`blur 4px` 在 0/44/65/85/105/125/145/167/188ms 依次
`4.00 / 3.84 / 3.49 / 3.19 / 2.69 / 2.33 / 1.75 / 1.33 / 0.69px`，节点 **210ms** 移除
（上批 320ms）；同一次关闭里菜单仍是 180ms、scale → 0.9536。

## 17. 作业行瘦身（霖 2026-10-02：三个行内控件撤掉，只留作业流卡片那一处）

> **状态（2026-10-04 复核，2026-10-05 更新）**：本章各条均已落地（17.1 撤控件 / 17.3 反例四条全在跑；**17.2 的复测数字已补**——b39 同机 K90 实测：行宽 326px 不变、标题 37px → **294px**、三个被撤控件 0/0/0、长按菜单三项、截图两张，详见 §17.2）——正文没写「落地」二字，按小节搜「落地」会误判。

### 17.1 改了什么

「忽略 / 提醒 / 收藏」这三个操作此前在**两处**都有卡面按钮：作业流卡片（TasksPage 的 `.hw-card`）
和作业列表行（`learn/shared.tsx` 的 `HomeworkRow`，全部作业页与课程详情页共用）。三处功能已经在
行的长按菜单里齐了（忽略/取消忽略、提醒、收藏），行内控件就只剩占地方——全部作业页首行实测
`.row-main` 只有 **37px**，标题被挤到只显示两三个字。

- 撤掉 `HomeworkRow` 行内的：`.hw-ignore-btn`（忽略/恢复）、`HwRemindButton`（提醒铃铛）、
  列表级 `CollectStar`（星标）。同时把已无用途的 `remind` 参数从行组件与两个调用点删掉。
- **保留**作业流卡片（`.hw-card`）卡面上的这三个按钮——霖明确「只保留这一处」。
- 长按菜单本身不动：行内控件撤掉后，它是这三个功能唯一的入口，护栏两边都钉住
  （行里不许再出现这三个控件、卡片上不许少）。

### 17.2 真机数字（改造前，REDMI K90 Pro Max / Android 16，全部作业页首行）

行宽 **326px**；`.row-main`/`.row-title` **37px**；行内控件依次
`chip 84px`、忽略按钮 **84px**、提醒铃铛 **78px**、收藏星标 **24px**、caret 14px；
整页 7 行、`.hw-ignore-btn` ×7、`.hwremind` ×7。按去掉的三个控件算，标题应能从 37px 涨到
**≈223px**。截图 `.tmp-shots/dev-b7-row-before.png`。

> **改造后复测（b39，2026-10-05，同机同引擎 K90 / Android 16 / APK md5 `4d2383cf…` / 仓库 `ad888ed0`；脚本 `/tmp/b39-rowm.mjs`，同 `/tmp/rowm.mjs` 口径）**：
> 行宽 **326px**（9/9 行一致，与改造前一致）；`.row-main` = `.row-title` = **294px**（改造前 37px）——
> **294 = 326 − 2×16 padding，标题独占手机网格第一行整行**（即 §19.3 的网格命名区修复；改造前那条
> **≈223px** 是按「37+84+78+24」做的线性估算，实测版式让标题吃满内容区，故高出 71px，不是偏差）。
> 首行子元素：`.row-when` 59.21 / `.row-main` 294 / `.chip chip-gray` 84.2 / `.row-caret` 14。
> **三个被撤控件确实不在**：`.hw-ignore-btn` 全页 **0**、行内 0；`.hwremind` 全页 **0**、行内 0；
> 行级 `[aria-label*=收藏]` **0**（全页仅剩的 2 个是底栏「折叠新建收藏夹」与「管理收藏」按钮，非行级星标）。
> **长按菜单三项**：首行按下 750ms → 菜单标题「第一次小作业」，`.ctx-item` = **忽略（danger）/ 提醒 / 收藏** 三项，
> 菜单盒 148×169；长按后行内三控件计数仍为 0。行数随作业数据变（本轮 9 行；分段 tab 标称 进行中 5 / 已交 7 / 已批 5 / 全部 17），
> 9/9 行均为「行宽 326 + 标题 294」，与改造无关。
> 截图：`.tmp-shots/dev-b39-row-after.png`（作业行列表）、`.tmp-shots/dev-b39-row-after-menu.png`（长按菜单三项），
> 均 1200×2608，与改造前 `dev-b7-row-before.png` 同规格。

### 17.3 反例

行里加回忽略按钮、加回星标、卡片上误删收藏星标、卡片上误删提醒铃铛——四条都被
`hw-ignore-test` / `context-menu-test` 拦下（批次 4 起累计 23 条反例，0 漏过）。

---

## 18. 2026-10-02 复看（三条）

霖在 DEV b8 上复看 M4 时提的三条。C3 的前两条改动当时已进包（服务卡改成上下布局），但网格没变成
单列，于是卡里的长名字横向溢出、被卡边裁掉一半——根因与定版改法记在 §C3 的「根因 / 真机复验 / 定版改法」
三条里（窄屏那条 `.content [class*="grid"]` 兜底带 `!important`，比普通内联还强）。

### 18.1 服务标题与部门两行（C3 收尾）

**现象**：单列落地后，服务名 / 部门 / 类型标签仍挤在同一行。**根因**：窄屏兜底那条
`.content [class*="row"] { flex-wrap: wrap }` 命中了文本块（它的类名是 `row-main`），而文本块本身是
**列方向**（`flex-direction: column`）——列 + `wrap` 会把三段文本折成**并排的多列**，于是三行变一行。
真机取证：该元素 `flex-direction: column` 但 `flex-wrap: wrap`，三个子元素 `top` 全是 466（同一行）。

**改法**：C3 窄屏块里加一条 `.content .thos-service-open { width: 100%; flex-direction: column; flex-wrap: nowrap; }`
（`.content` 前缀与兜底同特异性、位置更后，压过去）。护栏 `tools/narrow-wrap-test.mjs` 钉住这条必须
是「列方向 + nowrap」。真机复验（DEV b10，400×805）：`flex-direction: column` + `flex-wrap: nowrap`，
三个子元素（名称 / 部门 / 类型标签）的 `top` 分别是 **466 / 494 / 522**——各占一行；截图
`.tmp-shots/r2-service-two-line.png`（gitignore）。

### 18.2 顶栏「···」挪到最右（与刷新键交换）

`MobileTopbar` 里 `···` 从刷新键**之前**挪到**之后**，顺序变成「回到顶层（滚过 240px 才出现）→ 刷新 →
`···`」，最右上角（最好按的位置）留给最常用的入口。护栏 `tools/mobile-chrome-test.mjs` 新增一条：
在顶栏切片里 `topbar-more` 的下标必须大于 `topbar-refresh`，且「回到顶层」在两者左侧。PC 侧不动。
真机复验（DEV b10）：顶栏按钮 `left` 依次为 `0`（左端返回/logo）、`304`（刷新）、`350`（`···`）
——「···」在最右上角。

### 18.3 抬手归位改成平滑缩放

**现象**：按下缩到 0.97 / 长按放大到 1.1 都是平滑的，但**抬手恢复原大小时是突变**。**根因**：
`clearPress()` 直接 `removeAttribute("data-ctx-press")`——那条 `transition: scale …` 就写在这个属性选择器上，
属性一摘，过渡跟着失效，元素瞬间跳回 `scale: 1`。

**改法**：新增「归位态」`[data-ctx-press][data-ctx-press="rest"] { --ctx-press-k: 1; }`；`clearPress()` 先把
标记写成 `rest`（倍率 1、过渡仍在 → 平滑缩回），再在 `PRESS_REST_MS = 240`（≥ CSS 里最长那条
`--dur-2` = 220ms）之后才真正摘掉标记；期间若同一元素又被按下（态已变成 `tap`/`hold`），那一刀不生效。
护栏 `tools/context-menu-test.mjs` 新增四条：CSS 必须有 rest 态、JS 必须有 `PRESS_REST_MS`、
抬手必须走 rest 态并在过渡播完后摘标记、`PRESS_REST_MS` 落在 220–600ms 之间。

真机复验（DEV b10，一次 150ms 轻点，逐帧采 `scale`）：

| 时刻 | 标记 | `scale` |
| --- | --- | --- |
| t=1ms（抬手前） | `tap` | 0.97 |
| t=17ms | `rest` | 0.97 |
| t=33 / 42 / 49 / 57 / 66 / 74 / 83ms | `rest` | 0.9767 / 0.9827 / 0.9879 / 0.9922 / 0.9955 / 0.9980 / 0.9996 |
| t=91–116ms | `rest` | 1.0012 → 1.0011（弹簧过冲） |
| t=166ms | `rest` | 1.0000 |
| t=258ms | （已摘） | `none` |

86 帧无跳变（上一版是 `removeAttribute` 后一帧回到 1），恢复过程平滑。

---

## 19. 2026-10-02 复看第二轮（三条）

> **状态（2026-10-04 复核）**：本章各条均已落地（19.1 服务类型标签小胶囊 / 19.2 三张数字卡按压反馈 / 19.3 作业行标题网格命名区 294px）——正文没写「落地」二字，按小节搜「落地」会误判。

### 19.1 服务类型标签改小胶囊

C3 把窄屏服务卡改成「列方向 + nowrap」后，类型标签（表单 / 集成 / 指南）成了通栏长条——列方向下
默认 `align-items: stretch`。改法：窄屏块里给文本块加 `align-items: flex-start`，并单独把标签
`align-self: flex-start` 退回内容宽度。真机复验（DEV b11）：标签宽 **294px → 48px**（小胶囊「集成」/「表单」），
服务名与部门各占一行不变；截图 `.tmp-shots/r3-chip-pill.png`（gitignore）。
护栏 `tools/narrow-wrap-test.mjs` 钉住这两条。

### 19.2 三张数字卡加按压反馈

「我的」页三张数字卡（校园卡余额 / 学分 / GPA）此前按下去毫无反馈（`.svc-row`、`.task-row` 都有）。
按文档 §2/§3 的口径（整卡按压只压暗底色、绝不改尺寸）加 `.mine-stat:active { background:
var(--md-sys-color-surface-container-high) }`。护栏 `tools/mine-page-test.mjs` 钉住「必须有
`:active`、必须是压暗底色、不许出现 transform/scale」。

> 遗留观察（未改，等霖定）：`.svc-row:active` 与 `.task-row:active` 各有一条
> `transform: scale(0.99)`，与 §2/§3「整行/整卡不只改尺寸」的口径不一致。**已裁定（霖 2026-10-05，第 51 条）：保留这两条作为显式例外**，见 §2 的例外注记；代码不动。

### 19.3 作业行标题「只显示到一半」——网格命名区缺失（BUG）

**现象**（霖）：全部作业页每一行的标题只显示到行的一半就截断，而**原先三个行内控件占的位置整块
空着**。**真机取证（DEV b10，全部17，21 行）**：`.row-main` 宽 **62px**（标题 62/269，只放得下
三四个字），而该行第一行的第 3、4 列空着；行高 100px（内容占两行）。

**根因**：0.7.11 给**日程行**做过「第一行标题通栏 / 第二行日期 · 状态 · 箭头」的网格化，选择器是
`html.is-phone .list .row-click`——它同时接住了**作业行**（`HomeworkRow` / `NoticeRow`，类名是
`.row-main` / `.row-when`），但命名区只写了 `.tl-main` / `.tl-time` / `.tl-bar`。作业行没有这些
类名，于是被浏览器**自动摆放**：`.row-when` 占第 1 列、`.row-main` 占第 2 列，而 `.chip` /
`.row-caret` 因为选择器是通用的（`.chip` / `.row-caret`）被放到了第二行——第一行第 3、4 列因此
完全空着。

**改法**：在同一个网格块里给作业行的两个类名补命名区——`html.is-phone .list .row-click .row-main
{ grid-area: main }`、`html.is-phone .list .row-click .row-when { grid-area: time }`。**真机复验
（注入同款 CSS 后量）**：`.row-main` **62px → 294px**（第一行整行），首行标题完整显示
（`clientWidth 294 == scrollWidth 294`，不再省略）；超出整行时才由原有的
`overflow: hidden; text-overflow: ellipsis; white-space: nowrap` 收省略号——单行、不拐行、不过早省略。
21 行全部 294px。截图 `.tmp-shots/r3-hw-fixed-preview.png`（gitignore）。

**护栏**：新增 `tools/hw-row-title-test.mjs`（已进 `pnpm guard`）：网格块必须同时给 `.tl-*` 与
`.row-main` / `.row-when` 命名区、第一行必须是 `"main main main main"`、`.row-title` 必须仍是
「nowrap + ellipsis」且不许出现 `-webkit-line-clamp`（多行截断）。

**真机复验（DEV b11，课程作业页两行 + 全部17 的 21 行）**：`.row-main` 全部 **294px**（同一值），
首行标题 `clientWidth == scrollWidth`（不再省略）；截图 `.tmp-shots/r3-hw-title-full.png`（gitignore）。

**反例（本次新增三条，全部被拦下）**：去掉 `.row-main { grid-area: main }`（`hw-row-title-test`
红 1 条）、去掉标签的 `align-self: flex-start`（`narrow-wrap-test` 红 1 条）、把数字卡 `:active`
改回原底色（`mine-page-test` 红 2 条）。

## 20. 跨机型兼容实测（OPPO PHW110 / Android 15 / WebView 134）

**设备与口径**：OPPO PHW110（Reno10 5G）/ Android 15（SDK 35）/ 1080×2412 @480dpi → CSS 视口
360×752 / WebView 134.0.6998.135 / dev 包（`acb18df8-dirty`）。读数取自 `<设备>` 的 WebView CDP
（`Runtime.evaluate`）与 `<adb> exec-out screencap`；REDMI 一列为本文档既有数字，本次不接触该机，未重测。

| 项 | REDMI 基准 | OPPO 实测 | 结论 |
| --- | --- | --- | --- |
| F1 选课页弹层残留 | 每轮 `.xk-mask` 1→0（3/3）、最终 0 | 每轮 1→0（3/3）、最终 0；`elementFromPoint(180,400)` 命中 `BUTTON.btn` | 一致 |
| D4 数字递增（「我的」余额） | 251 帧、`¥0.00 → … → ¥2.15`、无负值、宽 49.3px | 250 帧、`¥0.00 → ¥0.20 → … → ¥2.15`、无负值、宽 53.27–53.54px | 行为一致；数字宽 +4.2px（字体回退所致） |
| D7 待办页新闻本页弹详情 | panel top 93 / h 628 / bottom 721 ≤ nav top 727；mask z=50 < nav z=60 | panel top 97.5 / h 586.8 / bottom 684.3 ≤ nav top 689.9；mask z=50 < nav z=60；返回键只关抽屉（href 仍 `#/tasks`） | 一致（绝对高度差来自视口高 752 vs 805） |
| D1 长列表 A/B（网络学堂→课程通知） | 42 行 / 4492px；A 8.20ms（p95 8.4）/ B 8.24ms（p95 8.4）；无 long task | 42 行 / 4491.6px；A 11.38ms（p95 16.8 / max 23.3）/ B 11.43ms（p95 17.5 / max 25.4）；两臂 >32ms 0 帧、long task 0 | 两臂无可测差异（无回归）；绝对帧间隔高于 REDMI，因本机当前显示模式 90Hz（`dumpsys display` 的 `mActiveSfDisplayMode peakRefreshRate=90.0`），REDMI 为 120Hz |

**关键页面走查（今日/待办/信息/网络学堂/服务/设置/我的，各停留 4s）**：无崩溃、无白屏；各页
`documentElement.scrollWidth == innerWidth`（无横向溢出）；底栏几何恒为 top 689.9 / h 62.4 / z 60 /
`padding-bottom 10px`，内容区止于 689.9；手势条与底栏文字无重叠；页内错误收集器（`error` /
`unhandledrejection` / `console.error`）0 条，`logcat` 过滤 `AndroidRuntime|FATAL|chromium.*(ERROR|Uncaught)`
全空。截图 `.tmp-shots/oppo-walk-*.png`。

**差异项 · 字体回退与「水印压字」判定**（CDP `CSS.getPlatformFontsForNode` 读实际渲染字体）：
`.brand-logo .word`（声明 `Georgia, "Playfair Display", "Times New Roman", serif`）→ **Noto Serif**；
`.brand-logo .u`（声明 `Inter, "SF Pro Display", …`）→ **Roboto**；`.slogan .s-mono` / `.dev-badge`
（声明 `SF Mono/Menlo/Consolas`、`ui-monospace`）→ **Cutive Mono / Droid Sans Mono**；中文正文 →
**OPPO Sans 4.0 SC**。设计指定的 Georgia / Inter / SF Pro / SF Mono 在本机均不存在，全部落到系统通用族；
**无衬线栈没有掉到衬线**（`.u`、`.s-thuer` 仍是 Roboto）。因此「标题变衬线体」的成因是「品牌标识自身
就指定 serif（`One`）+ 本机无 Georgia → Noto Serif 兜底」，不是字体栈缺陷。
- 「背景装饰水印与副标题重叠」**未复现**：源码无 `水印`/`watermark`，登录页 DOM 无绝对定位装饰节点，
  `.login-wrap` / `.login-card` 的 `::before`/`::after` 的 `content` 均为 `none`；跨元素重叠量为 0
  （标题底 243.3 → 副标题顶 255.3 间隔 12px；副标题底 289.6 → 表单顶 305.6 间隔 16px）。
- 截图里形似压字的那处是 `Slogan` 内联的 `BrandLogo`：`.brand-logo` 天生两行（`inline-grid` 五列排成
  `(One` / `THU)`），`.slogan` 又是 `line-height: 1; white-space: nowrap`，2 行 logo 在文字行里撑出
  34.2px 行盒，第二行落到基线下方、尾部 `.` 在行盒内垂直居中（logo rect 255.3–289.6，文字 264.7–280.3）。
  属组件结构性现象，与视口宽度无关（`.slogan` 不换行，卡片宽 324px > slogan 宽 236.6px）；字体回退只是
  让它更显眼（Cutive Mono 与 SF Mono 观感差别明显）。截图 `.tmp-shots/oppo-login-title-slogan-crop.png`、
  `.tmp-shots/oppo-login-final.png`。
- 设置/关于页复看：`.section-head h2`「关于」与 `.setting-title`「OneTHU 0.10.0 “Complex Variable”」均在
  正文无衬线栈内（中文 OPPO Sans），无衬线回退、无水印、无重叠。截图 `.tmp-shots/oppo-about.png`。

**未取到项**：① 今日页不存在 D4 口径——今日页只有静态余额条 `.balance-value`（178 帧采样仅 `¥2.15`
一个值、宽 60.54–60.84px，不递增），递增仅在「我的」页 `.mine-stat-num`，表中 D4 按 REDMI 同源位置取样；
② 登录页宽度 A/B 未取到——Android WebView 的 CDP 不认 `Emulation.setDeviceMetricsOverride`（调用后
`innerWidth` 仍 360），400px 档没有实测对照，只有 CSS 结构推断；③ REDMI 为只读基准，未在本轮重测。

**测试中复现的登录态丢失现场（重要，未修项）**：这是本轮兼容测试价值最高的一条——等于在第二台设备
（装着 ③④ 修复的 b17）上复现了用户抱怨的「被踢到登录页卡住」。

- **时间与链路（14:48:47–14:49:08，1016 行 buffer）**：选课链一次 `403`
  （`webvpn.tsinghua.edu.cn/https/<站点码>/b/kc/zhjw_v_code_xnxq/getCurrentAndNextSemester`，去查询串）后，
  `LIB-AUTH 判定登录状态失效 signal=logged-out-page` **16 条**，其中「认不出站点 → 不重登」**15 条**
  （落点主域全部 `id.tsinghua.edu.cn`），带站点的触发只有 **1 条** `sites=[libroom]`（来自 cab.lib 链的
  `authcenter/toLoginPage`），`SOFT-RECOVER[global] fail (3ms) sites=[libroom]`、`SOFT-RELOGIN ok
  sites=[]`（空集）、`LIB-AUTH 重登成功` **0 条**。**应用停在登录页 5 分钟以上未自愈**（学号与密码已由
  「记住密码」预填在表单里，状态未翻回）。
- **对照：同一台设备冷启后 1.66s 自愈**（14:54:22.978–14:54:24.456）：`LIB-AUTH 判定登录状态失效
  signal=logged-out-page sites=[learn] → 共享单飞重登一次` → `LIB-CRED 从「记住密码」回灌登录信息` →
  `LIB-ENSURE 静默重登成功（verifyAndReLogin）` → `LIB-ENSURE 子服务重建 site=learn ok` →
  `SOFT-RELOGIN ok streak=0 cooldown=30s sites=[learn]` → `LIB-AUTH 重登成功 → 重放一次` →
  `BOOT-T learn.resume(会话活)` → `BOOT-T READY(总耗时) +1658ms`。该 buffer（692 行）形状：判定 21 条 /
  认不出 20 条（`id.tsinghua.edu.cn` 17、`webvpn.tsinghua.edu.cn` 2、`madmodel.cs.tsinghua.edu.cn` 1）/
  带站点触发 1 条 / 重登 1 次 / 重放 1 次 / `重放后仍失效` 0 条——**同一份代码，冷启路径救得回来，
  运行中路径救不回来**。
- **判读（基于上述日志；跨链归因标「待查」）**：带站点的失联只认出 `libroom`，而 403 落在 `b/kc/zhjw_v_code_xnxq`
  路径上（b18 复核：该站点码解出 `learn.tsinghua.edu.cn`，属 learn 的教务代理命名空间，当时的「教务（zhjw）API」
  判读已更正，见本节末 b18 结论）；
  `getCurrentAndNextSemester` 在该 buffer 里只出现 1 次，**没有任何 `LIB-AUTH` 行把它归属到站点**。
  **待查**：这次 403 的响应体是 webvpn 返回的「服务器内部错误 403」页，既不是四条登录页判据之一，落点又是
  webvpn 加密路径（真实域被站点码包住），因此判据与站点反推两条都可能没命中——要在真机上补一条
  「403 / 非登录页面的失联如何归属站点」的取证才能定论。可以确定的是：**「认不出站点 → 不重登」这条保守
  策略在这条路径上等于不救**，③ 的收益集中在 learn / cab.lib 这类能反推出站点的落点。
- **未修项（b17 时点）**：① 教务 / 选课 API 落点（webvpn 加密路径）的站点归属；② 运行中会话全灭后**卡在登录页的兜底**
  （当时只有冷启或手动重试才会走回 `verifyAndReLogin`）。两条留待下一轮。

**b18 对上面两条未修项的结论（2026-10-03，提交 `0b19aef2`）**：
- **① 站点归属——已修**。站点改为按「该次请求自身的落点」反推（删除读全局 `http.lastFinalUrl || http.lastTarget` 的
  `lostSitesFromLastFailure()`），并在真实域表之后补了三条按真机样本标注的路径特征。运行中会话全灭现场抓到
  `LIB-AUTH signal=logged-out-page sites=[zhjw] siteSrc=request → 共享单飞重登一次`，该次请求的落点链是
  `webvpn.tsinghua.edu.cn/http/<站点码>/xklogin.do` → `…/do/off/ui/auth/login/form/<hash>` →
  `id.tsinghua.edu.cn/.../form/<hash>/1`（去查询串与哈希），归属取的是请求起点
  `zhjwxk.cic.tsinghua.edu.cn/xklogin.do`，不是最终落到的登录页。
- **一条判读更正**：本段此前的「403 落在教务（zhjw）API 上」按 webvpn 站点码解出的是
  `learn.tsinghua.edu.cn`——`/b/kc/zhjw_v_code_xnxq/getCurrentAndNextSemester` 属 learn 的教务代理命名空间，
  不是教务（zhjw）API。该 403 也本来不进入归属（判定层要求 `status === 200`），所以本段「403 无法归属」的
  现场在 b18 上仍不产生 `LIB-AUTH` 行；本节「待查」项至此定论：403 响应体是 webvpn 的错误页，两条判定判据
  都不命中，与站点表无关。详见 §7 F3。
- **② 卡在登录页的兜底——部分修，仍留**。带站点的失联在 b18 上会按落点定向重建（真机 6 条定向归属：
  learn 1 / card 2 / zhjw 3），空集判定另有全链恢复兜底与登录链闸：三次运行合计 66 条空集判定全部
  `reason=login-chain-page`、`兜底升级` 0 次、真重登 1 次、重放 1 次、`重放后仍失效` 0。但运行中会话全灭
  现场的 UI 仍落到登录页——`state/data.ts` 的 `backToLogin()` 在共享单飞占位冷却窗口内把
  `SOFT-RECOVER[global] fail (1ms)` 当成真失败；同一现场的重登在 1.6s 后已成功，UI 未翻回。对照同一台设备
  冷启 1.66s 自愈（`BOOT-T READY +1662ms`，UI 回到今日页）。该一侧属下一轮，数字与反例见 §7 F3。
- **③ 上一条的下一层已定位（本轮补采）**：`runLibSoftSingleFlight()` 的 `false` 有两义（跳过 / 真失败），
  返回值消费点里「不能区分」的占绝大多数；`state/data.ts` 的 `relearnRoamOnce()` → `backToLogin()`
  （`:251` → `:452`）与 `softRecover("campus")` → `backToLogin()`（`:159` → `:163`）是仅有的两处会把用户
  置为登出的点，本轮已按 `file:line` 普查成表。同一台 `<设备>` 上又复现了一次运行中会话全灭：UI 停在
  登录页 ≥2 分钟不自愈，并取到判掉的直接证据 `SOFT-RECOVER[global] fail (0ms)` 与
  `SOFT-RELOGIN fail streak=1 cooldown=56s`；对照冷启 2.5s 自愈。该现场的真重登同时也在失败
  （id 设备限流），因此「重登会成功而 UI 不回翻」仍以上面那条 b18 现场为准。普查表、真机数字、
  三态修复方案与验证判据见 §7 F3「诊断：冷却判掉与真失败的误读面」。

**b19 对 ②③ 的结论（2026-10-03，提交 `de8444c1`）——P0 已修，P1 / P2 仍留**：②③ 指向的那一层已按 §7 F3 的三态方案落地——`runLibSoftSingleFlightResult()` 返回 `done | failed | skipped`，旧布尔语义留薄封装；`state/data.ts` 的三处登出分支改为「仅 `failed` 才 `backToLogin()`」，`skipped`（冷却判掉 / 链内再入）一律保留当前页面并给可重试错误条。真机复验：运行中登录状态全灭现场（应用内两次 `logout`）`.login-wrap` 恒 0、`.nav-item` 恒 17、连续 70s 停在今日页，冷却判掉 1688 条没有把用户置登出（判据 A / B 成立）。**但判据 C 未成立**：同一现场的真重登确实失败（`Failed to get public key.`，`state=failed streak=1/2`），UI 却因页面层那笔恢复被运输层持飞链的冷却判掉而始终拿不到 `failed`，没有落登录页；另暴露今日页新闻源在持续失败下的高频重试环（`PAGE-ERR TODAY-NEWS` 844 条 / 139s）。这两条都**未修**，连同 P1（`clients.ts:328 / :348`、`clients.ts:280 / :281`、`pages/info/tabStates.tsx:29`）与 P2（`data.ts:591 / 1062 / 1905 / 2409 / 2508`）及可选 6 组一并留待下一轮。数字、现场链与反例见 §7 F3「修复落地（P0：三态 + 不再因冷却判掉而登出，b19）」。

**b20 对 ①②③ 与止血的结论（2026-10-03，提交 `0bb2bac8`）——止血已修；判据 C 的 `reentrant` 侧已修、`cooldown` 侧仍留；P1 / P2 仍留**：
- **止血——已修**（详见 §7 F3「修复落地（止血 + C）」的「止血」三段）。根因：`state/data.ts` 的 `useTodayNewsFeed.load` 依赖数组带着 `data`、失败分支又读闭包里的旧 `data`，陈旧缓存下构成自持续环（周期 = 一次失败请求往返，现场 258–332ms）。修法 = 失败判定走 `dataRef` + `load` 不再依赖 `data` + **定时器驱动的有界退避**（3s 起步、翻倍、封顶 60s、单串 6 次即停、`attempt=0 → 0ms`，纯函数抽出便于确定性断言）+ 同 `feedKey` 单飞 + 日志按失败串去重 + 渲染期不写日志；同一现场的 `TODAYCAL-SHAPE` 污染（`todaycal` 里被写进原始对象）同批修掉（拆键 `todaycal:src` + 读侧 `Array.isArray` 消毒 + effect 内去重日志）。真机：五个「登录状态已死」窗口（合计约 500s）`PAGE-ERR TODAY-NEWS` **0 条**、`TODAYCAL-SHAPE` **0 条**（b19 基线 844 条 / 139s、1272 条），新闻源请求每个窗口只出现 1 次（b19 846 次）；**未取到同条件的「持续失败」对照**（b20 的会话都在数秒内自愈），止血的确定性证据落在护栏 ⑲-1 / ⑲-5 与反例 ②。
- **判据 C——`reentrant` 侧已修，`cooldown` 侧仍留**。新增 `state/libSoftSettle.ts`：`skipped/reentrant` 带的 `pending` 在**守卫之外** await 取真结算，`cooldown`（无 `pending`）原样透传、绝不瞎等；三处 P0 出口接线。真机赢到的窗口是 `reentrant`（`SOFT-RECOVER[global] state=skipped reason=reentrant (2ms)` → 真结算 `state=done` → `子服务重建 site=zhjw ok`），页面层静默重取一次、无错误条无登出（b19 同型现场是 `CAMPUS-AUTH-PENDING` + `RELOGIN_PENDING_NOTE`）。**`failed → 落登录页` 这条真机仍未取到**：另一个真结算为 `failed`（`门户未活`）的窗口里，P0 页面层三处出口一次都没触发，UI 停在今日页约 2 分钟、无登录页；页面层只有在守卫里**持飞**才能拿到 `failed`，被运输层那条链先结算写冷却的场合仍只能拿到 `skipped/cooldown`——这层遮蔽未收口，判据由护栏 ⑲-2 / ⑲-3 与反例 ①③ 兜住。
- **一条判读口径修正（供后续复验）**：`.login-wrap` 同时是启动页类名（`App.tsx:98`，文案「正在恢复登录状态…」），b18 / b19 记的「`.login-wrap=1` = 落登录页」必须按文案与 `input[type=password]` 区分；b20 三次硬刷新里出现的 `.login-wrap=1` 全是启动页（约 3s）。
- **冷启回归**：三次专用冷启配比同型（判定 26 / 24 / 18，空集 25 / 23 / 17 全部 `reason=login-chain-page`，**兜底升级 0**，真重登 1，冷却判掉 1，重放 1，`重放后仍失效` 0，`PAGE-ERR TODAY-NEWS` 0）；`BOOT-T READY` 五样本 +1970 / +1686 / +1827 / +1823 / +1768ms——**系统性慢于 b19 记录的 +1331 / +1498ms，如实标「未取到等条件对照」**（本轮改动不含 boot / `resume` 路径一行，增长在网络段）。
- **残留与未修项**与 §7 F3 段末一致：P1（`clients.ts:328 / :348`、`clients.ts:280 / :281`、`pages/info/tabStates.tsx:29`）、P2（`data.ts:608 / 1079 / 1922 / 2461 / 2560`）、可选 6 组，以及 ③ 一条老残余；本轮新增一条未收口：`skipped/cooldown` 仍可能遮蔽**已结算**的 `failed`。数字、现场链、护栏 ⑲（49 条断言）与 3 例反例见 §7 F3「修复落地（止血 + C：真失败浮出，b20，提交 `0bb2bac8`）」。
- **§7 F3 ④ 双仓同步（b21，提交 `b72d4645`）——已修 / 仍留**：**已修**＝实际发请求侧确认为原生 store（`lib.rs:1351` 丢弃调用方 `Cookie` 头），新增「原生响应带 Set-Cookie 时按物理跳域回灌 JS jar + 单调保护（旧票回放拒收）」与显式登出两仓全清；真机复验里两仓在冷启第一张新票处 **1ms 内收敛**（b21 观察窗 538 条并列行里 268 对相等、0 对不等；修前两样本 724 条并列行相等的 0 条），冷启回归数字与 b20 同型（判定 22 / 空集 21 全 `login-chain-page` / 兜底升级 0 / 真重登 1 / 重放 1 / `重放后仍失效` 0 / `PAGE-ERR TODAY-NEWS` 0 / `BOOT-T READY` +1713ms）。**仍留**＝③ 的两条老残余（登录链自身 200 登录页仍命中判据；`x-onethu-auth-dance` 只在 `tauriFetch` 侧写、`nativeFetch` 侧恒空）、`skipped/cooldown` 遮蔽已结算 `failed` 的时序残余、P1/P2/可选各组，以及本轮新记录的两条：其余票种无主动核对（只在 Set-Cookie 到达时被动入账）、冷启原生仓从 `(无)` 起的落盘/回种链路**待查**（非 debuggable dev 包读不到 `native-jar.tsv`）。护栏 ⑳（39 条断言、5 组）与 3 例反例见 §7 F3「修复落地（④ 两仓同步正修，b21，提交 `b72d4645`）」。

**b22 对 P1 的结论（2026-10-03，提交 `a89532cd`）——P1 三处已修；P1-1 改为「同步判定、不 await 在飞链」的安全口径；P2 / 可选 6 组仍留**：
- **P1-1 已修（日志口径 + 不自锁契约）**：`nativeFetch` 恢复钩子不再把三态折成 `false`——`done` 重放、`failed` 落 `state=failed`、`skipped/cooldown` 落「被冷却判掉」、`skipped/reentrant` 落「在飞链未结算」；真机 1565 行窗口里 `重登失败` 0 次。**必须说清的一条偏差**：b22 先按「`reentrant + pending` 经 `settleLibSoftPending` 等在飞真结果」实现，真机上当场复现**链内自锁**（钩子由链自身那次请求触发，`pending`＝自己所在的链；9 分钟不结算），改为同步判定后 1.5s 结算。因此本条**没有**实现「reentrant → 等真结果 → 重放一次」的行为增强，只实现了「不再误读为失败」与明确的不自锁契约；等真结果的结算仍由守卫之外的三类观察者承担（b20 的 `state/data.ts` P0 出口、P1-2 桥、P1-3 tab 层）。
- **P1-2 已修（逻辑层）**：renewer 桥 `reentrant` 先结算、`cooldown` 回 `true`、只有真 `failed` 才回 `false`；`packages/core` 一行未动。真机未取到「结算 `done` → core 不抛错」的窗口（三次击杀的真重登全被 id 限流判死）。
- **P1-3 已修（判定层）**：tab 认证支消费三态出口并落 `TAB-AUTH …action=…`（真机 1 条）；`retry` 门控仍只在 `KongjianTab.tsx:61` 一处调用方。
- **无回归**：判定 87 / 空集 70 / 兜底升级 24（真重登被限流判死时的真实升级，恢复动作仍被冷却封顶在 3 次）/ 重放 1 / `重放后仍失效` 0 / `TODAYCAL-SHAPE` 0 / `PAGE-ERR TODAY-NEWS` 窗口一 / 二 0；冷启 `BOOT-T READY` +2164 / +2454ms（含静默重登），对照 b21 同形 +1713ms 标「未取得等条件对照」（网络段差 +397ms 未归因）。**仍留**＝P2 七处布尔出口 `state/data.ts:608 / 725 / 1079 / 1922 / 2461 / 2560 / 2608`（含 `state/data.ts:1933` 的 toast 文案仍说「登录状态已自动重建」）、可选组 `pages/Schedule.tsx:404`、`pages/info/DormTab.tsx:69`、`pages/info/LibraryTab.tsx:364 / 390 / 457 / 508 / 549`、`pages/info/LibRoomTab.tsx:401 / 434 / 493`，以及本轮补记的 `lib/reload.ts:75`（全局失登看门狗 `softRecover("global")` 仍用布尔薄封装）；另加 `skipped/cooldown` 遮蔽已结算 `failed` 的时序残余、③ 两条老残余、冷启原生仓从 `(无)` 起**待查**。护栏 ㉑（8 组）与 3 例反例见 §7 F3「修复落地（P1：`skipped` 不再被当成失败，b22，提交 `a89532cd`）」。

### 20.1 Chromium 96 / Android 12 退役机实测（修复前，dev 包 b22）

**设备与口径**：Redmi K30 Pro（退役试验机）/ Android 12 / WebView 96.0.4664.104 / CSS 视口 393×822 /
dev 包 b22（`a89532cd` 那一版，即本次修复之前）。读数取自 `<设备>` 的 WebView CDP
（`Runtime.evaluate`；探针脚本 `/tmp/k30-probe.mjs`，经
`<adb> -P 5037 forward tcp:9226 localabstract:webview_devtools_remote_<pid>` 直连）与 `<adb> logcat`；
证据留档 `/tmp/k30-compat-evidence.log`（不在仓库内）。

**UA 不可作判据**：该机报告的 UA 是原生壳覆写的假值
（`Mozilla/5.0 (Windows NT 10.0; Win64; x64) … Chrome/79.0.3945.88`），与真实内核（Chromium 96）不符。
本节全部能力结论来自 `CSS.supports` 与合成元素探针，不读 UA。

| 能力探针 | 实测 | 与 Chromium 96 的能力表 |
| --- | --- | --- |
| `:has()` | 不支持 | 一致（105+ 才有） |
| `color-mix()` | 不支持 | 一致（111+ 才有） |
| `dvh` / `svh` | 均不支持 | 一致（108+ 才有） |
| `@container` | 不支持 | 一致（105+ 才有） |
| `scrollbar-width` | 不支持 | 一致（121+ 才有） |
| `aspect-ratio` | 支持 | 一致（88+） |
| `inset` | 支持 | 一致（87+） |
| flex `gap` | 支持 | 一致（84+） |

**三条硬数字（修复前）**：

| 项 | 修复前实测 | 支持引擎上的期望 | 本轮落点 |
| --- | --- | --- | --- |
| `dvh` | 声明**整条丢弃**：寻迹页 `.trace-map-wrap` computed `height` = `320px`（只剩自己的 `min-height: 320px`）；合成探针 `calc(100dvh - 210px)` computed `0px` | `822 − 210 = 612px` | 已修（20.2 ①） |
| `:has()` | 页面样式表 1855 条规则里带 `:has(` 的剩 **0** 条（解析期整组丢弃，不是「命中 0 次」）；`global.css` 源码 26 行含 `:has(` | 全部命中 | 按判定处理（20.2 ②） |
| `color-mix()` | 值不生效：合成元素 `background: color-mix(…)` computed `rgba(0, 0, 0, 0)`；`border-color` 回落到更早那条声明（规则本身仍在——1855 条里有 17 条含 `color-mix`） | 生效 | 按判定处理（20.2 ③） |

**同一窗口的稳定性读数**：零崩溃、零白屏、控制台零错误（4s 窗口内 `error` / `warning` 全空）；
今日页观感正常；`innerHeight` 822 / `innerWidth` 393 / 导航项 16 / DOM 486 节点 / `bodyH` 822；
冷启 5 次 `BOOT-T READY` +1932 / +1976 / +1856 / +2060 / +1928ms。寻迹页首次采样落在 `#/today`
（重启后回到今日页），导航回 `#/trace` 复测得 `320px`，与上表一致。

**适用范围**：上表全部是修复前的数字。修复后的复验要在 b24 包上重测；该机 MIUI 禁止 `<adb> install`
（`INSTALL_FAILED_USER_RESTRICTED`），b24 包由霖手动安装，本节不含修复后的真机数字。

### 20.2 本轮修复落地（提交 `cf5b6bee`）

**① `dvh` 兜底 —— `global.css` 14 处**。每处改为「先同属性、同 calc 结构的 `vh`，后 `dvh`」：现代引擎
后者覆盖前者（行为不变），老引擎（Chromium 96）拿到 `vh` 版本（`vh` 取大视口高度，是有意为之的保守
兜底）。后文行号均为修复后的 `global.css`；5 处规则本身是单行写法，成对声明落在同一行内。

> **b29 更正指针（2026-10-05）**：这一组 `dvh` 兜底**不受**同节 ③ 那个问题影响，写法仍然有效——
> `dvh` 是在**解析期**就被丢弃的（属性值不认识，声明根本不进级联），同一规则里紧邻的 `vh` 声明照常生效；
> 与 `color-mix` 的「computed-value 阶段整条作废、且不回落」不是一回事。退役机复验：
> `#/trace` 的 `.trace-map-wrap` computed height = **644.18px** = 822 − 178，命中的正是 `html.is-phone`
> 的 `calc(100vh - 178px)`（见本页 ⑥）。现代引擎上 `dvh` 覆盖 `vh`，行为逐条不变。

| 行 | 选择器 | 属性与值（`dvh` 版即把该行的 `vh` 写作 `dvh`） |
| --- | --- | --- |
| 3494 | `.plg-sheet`（手机档插件抽屉，≤840） | `max-height: 92vh` / `92dvh`（同行成对） |
| 3501 | `.home-modal`（手机档弹窗） | `max-height: 92vh` / `92dvh` |
| 4083 | `.plg-sheet`（桌面档） | `max-height: min(86vh, 720px)` / `min(86dvh, 720px)`（同行成对） |
| 4090 | `.plg-term.is-tall` | `height: 56vh` / `56dvh`（同行成对） |
| 4141 | `.trace-map-wrap` | `height: calc(100vh - 210px)` / `calc(100dvh - 210px)` |
| 4145 | `html.is-phone .trace-map-wrap` | `height: calc(100vh - 178px)` / `calc(100dvh - 178px)`（同行成对） |
| 4456 | `.mail-layout` | `height: calc(100vh - 208px)` / `calc(100dvh - 208px)` |
| 4578 | `.mail-compose` | `max-height: min(86vh, 720px)` / `min(86dvh, 720px)` |
| 4640 | `.mail-layout`（≤840 单列档） | `height: calc(100vh - 190px)` / `calc(100dvh - 190px)`（同行成对） |
| 5856 | `.hw-carousel` | `height: clamp(300px, calc(100vh - 505px), 470px)` / 同式 `dvh` |
| 5965 | `.shell .content:has(.tasks-body)`（≤840 待办页） | `height: 100vh` / `100dvh` |
| 6225 | 同上（≥840 档） | `height: 100vh` / `100dvh` |
| 6246 | `.content > .page-anim[data-page="tasks"]`（本轮新增的 ≥840 兜底块） | `height: calc(100vh - 116px - env(safe-area-inset-bottom, 0px))` / 同式 `dvh` |
| 6409 | `.shell`（≤840 M1 块） | `height: 100vh` / `100dvh`（**原本就有 `vh` 前置，本轮未动**） |

**② `:has()` 判定 —— 26 行（22 行选择器 + 4 行注释）归并为 18 条规则块**。判定口径：整条规则在
Chromium 96 上消失后，是否导致内容不可用 / 看不全 / 点不到。

| # | 选择器（行） | 作用 | 判定 | 处理 |
| --- | --- | --- | --- | --- |
| 1 | `html.is-phone .content:has(.tasks-body)`、`.shell .content:has(.tasks-body)`（5961-5970） | 待办页把 `.content` 锁一屏高、置为 flex 列，并让出 142px + 安全区的 OH 岛带 | **关键**：丢失后高度链起点消失、岛带不预留，卡片流底部被悬浮岛盖住 | 兜底块（≤840） |
| 2 | `.content:has(.tasks-body) > .page-anim`（5973） | `.page-anim` 是 `flex: 0 1 auto`，高度在这里会断，必须撑开并传下去 | **关键**：断链 | 兜底块（≤840） |
| 3 | `.content:has(.tasks-body) .tasks-body`（5975） | 非宽屏时 `.tasks-body` 是 block，显式改 flex 列传高 | **关键**：断链 | 兜底块（≤840） |
| 4 | `.content:has(.tasks-body) .tasks-pane:not(.is-hidden)`（5976） | 同上，pane 继续传高 | **关键**：断链 | 兜底块（≤840） |
| 5 | `.content:has(.tasks-body) .tasks-learn`（5977） | 学习栏占满剩余高 | **关键**：断链 | 兜底块（≤840） |
| 6 | `.content:has(.tasks-body) .tasks-flow-wrap`（5978） | 卡片流 `flex: 1` + 230/470 上下限 | **关键**：卡片流不再按一屏铺开 | 兜底块（≤840） |
| 7 | `.content:has(.tasks-body) .hw-carousel-row`（5979） | 轮播行传高 | **关键**：断链 | 兜底块（≤840） |
| 8 | `.content:has(.tasks-body) .hw-carousel`（5980） | 高度交给 flex（`auto`） | **关键**：退回基础 `clamp()` 定高 | 兜底块（≤840） |
| 9 | `html.is-phone .content:has(.tasks-body)`、`.shell .content:has(.tasks-body)`（6221-6222，≥840） | PC 档同样锁一屏高 + 92px 岛带 | **关键（程度较轻）**：PC 由窗口滚动，内容仍可达；但两栏失去定高后内滚失效、末行会被桌面悬浮岛压住 | 兜底块（≥840） |
| 10 | `.content:has(.tasks-body) > .page-anim`（6232，≥840） | 同上，传高 | **关键（程度较轻）** | 兜底块（≥840） |
| 11 | `.content:has(.tasks-body) .tasks-body`（6233，≥840） | 同上，`flex: 1` | **关键（程度较轻）** | 兜底块（≥840） |
| 12 | `.content:has(.xk-two-col)`（1639） | 选课双栏页解除 `.content` 的 `max-width: 1160px` | 装饰：两栏仍可读可点，只是左栏不再随窗口伸长；≤840 该页已改三页签 | 仅记录 |
| 13 | `html.is-phone .stats:not(.stats-hero):has(> :only-child)`（3023） | 独卡统计网格由 3 列改 1 列 | 装饰：独卡占 1/3 宽、右侧留白 | 仅记录 |
| 14 | `.shell:has(.sidebar.is-collapsed)`（6195） | 侧栏折叠时把 `--sidebar-w` 由 224px 改 72px | 装饰：折叠后仍占 224px，多出约 152px 空白；折叠按钮可用 | 仅记录（纯 CSS 选不到祖先，等价写法需要 JS 状态） |
| 15 | `.content:has(> .page-anim[data-page="info"])`、`="life"`（6278-6279） | PC 信息 / 生活页单列限宽 720 居中 | 装饰：变成整宽，行变长 | 仅记录 |
| 16 | `… :has(table)`（6284-6285） | 含表格的栏目恢复整宽 | 装饰：与第 15 条同生同死，第 15 条没了之后表格本来就是整宽 | 仅记录 |
| 17 | `.content:has(> .page-anim[data-page="settings"])`（6292） | 设置页 PC 限宽 720 居中 | 装饰 | 仅记录 |
| 18 | `… :has(table)`（6297） | 含表格区块恢复整宽 | 装饰 | 仅记录 |

第 15–18 条即 `components/Layout.tsx` 注释里那组 `.content:has(> .page-anim[...])`（PC 宽度规则）；
4 行注释（5984-5986、6275、6388-6389、6419）与 `Layout.tsx` 的两处注释都只是说明文字，不计规则。

兜底块两条，都用 `@supports not selector(:has(*))` 包裹（Chromium 96 支持 `selector()`，`:has()` 判 false，
条件成立），锚点由「`.content` 有 `.tasks-body` 后代」换成「`.content` 的直接子节点
`.page-anim[data-page="tasks"]`」这个路由钩子——`.tasks-body` 只由待办页渲染，两者等价：

- ≤840 档：`height: 100%`（`.content` 在这里是高度确定的 flex 项，百分比可解析）+
  `padding-bottom: calc(142px + env(safe-area-inset-bottom, 0px))`，把原来挂在 `.content` 上的岛带
  padding 下移到 `.page-anim`，可用高与原来一致。
- ≥840 档：PC 的 `.content` 是 auto 高（窗口滚动），百分比解析不出来，改用视口高显式给
  `calc(100vh - 116px - env(safe-area-inset-bottom, 0px))`，其中 116 = `.content` 基础
  `padding-top: 24px` + 原规则的岛带 `padding-bottom: 92px`。

**③ `color-mix()` —— 28 处（`global.css` 21 + `motion.css` 4 + `base.css` 3），按价值改 2 处**。
判定口径：该处消失是否导致功能性不可用（控件与背景同色而看不清、状态色丢失）。

加静态兜底（2 处，都在 `color-mix` 前一行给同底色的不透明值）：

| 位置 | 用法 | 丢失后果 | 兜底 |
| --- | --- | --- | --- |
| `global.css:2421` `.mobile-topbar` | `background: color-mix(in srgb, var(--bg) 86%, transparent)` | 顶栏底色归零，只剩 `blur(10px)`；品牌名、页面标题与「···」直接压在滚动内容上 | 前一行 `background: var(--bg)` |
| `global.css:6627` `.ctx-menu` | `background: color-mix(in srgb, var(--md-sys-color-surface-container-lowest) 56%, transparent)` | 长按菜单面板底色归零，只剩 `blur(22px) saturate(1.6)`；菜单项文字压在底图上 | 前一行 `background: var(--md-sys-color-surface-container-lowest)` |

> **b29 更正指针（2026-10-05）**：上表两处「在 `color-mix` 前一行写同底色的静态值」这种兜底写法在
> Chromium 96 上**无效**：含 `var()` 的 `color-mix()` 是在 **computed-value 阶段**整条作废（按 `unset` 处理），
> **不会**回落到同一规则里更早的那条静态声明——退役机上 `.mobile-topbar` 的 computed `background-color`
> 实测仍是 `rgba(0, 0, 0, 0)`。本节是 b24 的历史记录，原文保持原样；实际修法以 §21.3 ③ 为准：
> 文件末尾 `@supports not (color: color-mix(in srgb, red 50%, transparent))` 分组重声明（判据里不带
> `var()`，见 §21.3 ① 的实测表）。两条静态声明至今仍在规则内，与分组重声明叠成双保险，互不冲突。

已有兜底（1 处，本轮未动）：`base.css:65` `::-webkit-scrollbar-thumb`，其前一行本来就是
`background: var(--md-sys-color-outline-variant)`，`scrollbar-test.mjs` 也在守这条。

> **b29 更正指针（2026-10-05）**：这一处同样只按「b24 的口径」留痕——紧邻的静态声明在 96 上单独**顶不住**
> `color-mix` 作废，真正生效的是 §21.3 ③ 的 `@supports` 分组重声明（这里那一条静态声明与分组重声明内容
> 相同，所以结果一致）。`scrollbar-test.mjs` 守的仍是这条静态字面量，未改动。

仅记录（25 处，都不是功能性）：

- `global.css`：`:570` `.btn-danger` 描边（回落 `.btn` 的中性描边，文字仍是
  `var(--md-sys-color-error)`）；`:670` 外部作业源按钮悬停底；`:1074-1078` `.mine-grad::before` 的 5 个
  渐变色标（整条 `background-image` 失效，该层是 `pointer-events: none` 的装饰层）；`:2939`
  `.home-card.is-picked` 描环（`border-color: var(--accent)` 仍在）；`:3319` `.live-chip.is-now` 描环
  （`is-now` 恒与 `is-free` / `is-busy` 同用，底色与字色来自后者）；`:3335` `@keyframes favflash` 的
  35% 帧；`:3645-3646` `@keyframes dock-ripple`；`:4274` `.trace-legend` 底（`blur(6px)` 与
  `border-soft` 仍在）；`:4307` `.trace-empty` 底（父级 `.trace-map-wrap` 的 `--surface-2` 就是它的
  等价底）；`:4971` `.thos-note` 底；`:4988` `.thos-note-tag` 底（`color: var(--text-1)` 仍在）；
  `:6587` `.ctx-blur` 遮罩（`blur(4px)` 仍在）；`:6630` `.ctx-menu` 描边（回落
  `border: 1px solid var(--border)`）。
- `motion.css`：`:330` / `:333` `@keyframes m-focus-ring` 两帧——真正的焦点环是
  `base.css:49` 的 `:focus-visible { box-shadow: var(--ring) }`，`--md-sys-focus-ring` 是静态
  `rgba(65, 118, 230, 0.25)`，不依赖 `color-mix`；丢的只是淡入过程；`:390` `.card:hover` 描边
  （回落基础描边）；`:589` `.bar.is-busy` / `.progress.is-busy` 的流动斜纹。
- `base.css`：`:71` / `:73` 滚动条拇指的 hover / active 两档（回落基础底色）。

另记（不在 28 处之内，本轮未动）：`ThemePickerModal.tsx` / `OnboardingTourV2.tsx` /
`ConnectGate.tsx` 的内联样式里各有 `dvh` 字面量，属 JS 内联几何，本轮范围只含 `global.css`。

**④ 新增结构断言 `tools/dvh-fallback-guard.mjs`**，接入 `package.json` 的 `guard` 链、紧随
`tools/css-parse-test.mjs`。`tools/style-scan.mjs` 是「4pt 间距 / 字阶」的基线棘轮（只数
padding/margin/gap/font-size 的字面量，带 `--write-baseline`），不具备做行邻接结构断言的形态，
因此另立本文件。断言原文（工具头部注释）：

> 对 global.css 里**每个** `dvh` 声明，要求它**紧邻的前一个声明**是 ① 同一属性名；② 值除
> `dvh`→`vh` 外逐字符相同（＝同 calc 结构）；③ 中间除 `;` 与空白外无他物。

口径说明：文件里有 5 处规则是单行写法，「紧邻」在那些位置只能是同一行内的前一个声明，因此断言
按「前一个声明」判定而不是「上一行」。这一口径对两种写法都成立，且更严格——同规则内插进任何别的
声明都会红。反例自检跑在副本上（不改仓库文件），两例都 exit 1：

反例 ①：删掉 `.plg-term.is-tall` 的 `height: 56vh;`（改后 `global.css:4090`）

```
样式结构护栏：不通过 ✗  dvh 缺「vh 前置」1 处（共 14 处 dvh）
  规则：每处 dvh 的紧邻前一个声明必须是同属性、同值的 vh 版本（vh 先、dvh 后）。
  /tmp/dvh-neg1.css:4090  height: 56dvh
     ↳ 前一个声明是 "max-height: none"，不是同一属性的 vh 版本 "height: 56vh"
```

反例 ②：把 `global.css:5964-5965` 的 `height: 100vh; height: 100dvh;` 顺序颠倒

```
样式结构护栏：不通过 ✗  dvh 缺「vh 前置」1 处（共 14 处 dvh）
  规则：每处 dvh 的紧邻前一个声明必须是同属性、同值的 vh 版本（vh 先、dvh 后）。
  /tmp/dvh-neg2.css:5964  height: 100dvh
     ↳ 前一个声明是 "box-sizing: border-box"，不是同一属性的 vh 版本 "height: 100vh"
```

反例 ② 的 `5964` 是颠倒之后 `dvh` 所在的行；未改动的文件里该 `dvh` 在 `5965`。

**⑤ 连带修的护栏断言**：`tools/modal-shell-test.mjs:55` 原先用一条整段 CSS 字面量
`includes` 同时守两件事（插件抽屉的 `92dvh` 限高 + 圆角令牌化）。插入 `vh` 前置后该字面量必然失配，
且失配原因与它要守的「圆角令牌化」无关。现拆为两条：一条正则匹配「`max-height: 92vh;` 与
`max-height: 92dvh;` 成对出现」（用 `block()` 取 `.plg-sheet { width: 100%;` 那条规则块），
另一条 `includes` 守圆角令牌。全仓自检：`tools/*.mjs` 里另有几处 CSS 字面量断言与本次改动相邻，
逐条核对后都仍然成立（`modal-shell-test.mjs:49` 的 `includes("92dvh")`、
`pc-layout-test.mjs:44` 的 `.mail-layout` 前缀正则、`context-menu-test.mjs:274` 的
`.ctx-menu` 底色正则、`mobile-chrome-test.mjs` 的三条 `.mobile-topbar` 正则），未改动。

**⑥ 修复在真机上的复验（父会话执行，补记）**：把本轮 APK 装回同一台退役机后，`#/trace` 上
`.trace-map-wrap` 的 computed height 从修复前的 **320px**（仅剩 `min-height` 兜底）变为 **644.18px**
——该机 `html.className = "is-phone has-reveal"`，命中 `html.is-phone` 的 `calc(100vh - 178px)`
（822 − 178 = 644）。现代引擎应命中的 `calc(100dvh - 210px)` 分支（822 − 210 = 612px）**未做真机复验**
（当期无现代引擎设备在线），由 CSS 级联顺序（`dvh` 声明在后覆盖 `vh`）与结构护栏「14 处 dvh 全部带
紧邻 vh 前置 ✓」保证。截图与探针原始输出存在复验记录里，不进仓库。

### 20.3 从这台机器学到的操作约束（复验用）

1. **`<adb> install` 在该机一度被拒，但并非恒定（原文已被复验更正）**：最初两次（`install -r` 与
   `push` 后 `pm install`）都报 `INSTALL_FAILED_USER_RESTRICTED`，系统里对应的开关是「USB 安装」，
   开启条件需要插 SIM 卡并登录小米账号。但同一会话稍后（约 18:24 起）`<adb> install -r -d 'C:/temp/<包>.apk'`
   **稳定成功**（三次，`lastUpdateTime` 每次更新、`firstInstallTime` 不变、数据保留），因此结论是
   **设备侧开关状态差异或「只拦首次安装」**，而不是「命令行无法绕过」。复验做法：**先试一次 `-r -d`**，
   失败再走手动安装。另注：给 `<adb>`（Windows 二进制）必须传 Windows 路径，传 `/mnt/c/…` 会
   `failed to stat`，这种报错容易被误读成设备拒绝。
2. **`input tap` 被系统拒绝**：`<adb> shell input tap` 在该机不生效。页面内交互改走 CDP——在
   `Runtime.evaluate` 里派发元素 `click()`，或用 `Input.dispatchMouseEvent`。
3. **`file://` 直启安装器无效**：用 `am start -a android.intent.action.VIEW -d file://…apk` 打开系统
   安装器在该机被拦下（另：`am` 发起的安装会被判定为「来自 adb」而销毁）；实际复验走的是
   `<adb> install -r -d`（见第 1 条）。
4. **能力判据不读 UA**（见 20.1）：该机 UA 被原生壳覆写成 `Chrome/79` 形态，与真实内核无关；
   一律用 `CSS.supports` 与合成元素探针。
5. **复验入口**：`/tmp/k30-probe.mjs`（不进仓库）经
   `<adb> -P 5037 forward tcp:9226 localabstract:webview_devtools_remote_<pid>` 直连页面，
   用法 `node /tmp/k30-probe.mjs "<JS 表达式>"`；寻迹页的落点读数要在导航到 `#/trace` 之后再取
   （重启后应用回到今日页，第一次采样会读到 `null`）。

### 20.4 b23 修复落地（P2 / 看门狗 / 可选组，提交 `4a9dab9b` + `905b5043`）

判据、改法、护栏 ㉒（5 组）、4 例反例与逐站点真机结论见 §7 F3「修复落地（P2 + 看门狗 + 可选组，b23）」。
这里只记这台退役机上新增/更正的操作口径：

1. **更正 20.3 第 1 条——「MIUI 一律拒绝 adb 安装」不成立，安装能力是设备侧开关状态**：
   2026-10-04 18:24 起，`<adb> -P 5037 -s <设备> install -r -d '<包>.apk'` 在这台机器上稳定返回
   `Success`（三次：b22 复装、b23 第一轮、b23 第二轮；`dumpsys package` 的 `lastUpdateTime` 每次都变、
   `firstInstallTime` 不变，数据保留、未卸载）。b24 记录的两次 `INSTALL_FAILED_USER_RESTRICTED` 是真实
   发生过的，因此正确口径是「该开关会被霖改动；**当次先试一次 `install -r -d`，成功就不必请霖手动安装**」。
   **另一个必须写清的坑**：`adb.exe` 是 Windows 二进制，APK 路径必须是 Windows 形式（`C:` 盘那种），
   传 WSL 的 `/mnt/c/…` 会报 `failed to stat /mnt/c/…`——该行是路径没被 Windows 侧读懂，不是 MIUI
   拒绝，不要当成设备拒绝处理。
2. **`logcat` 过滤用 `-s onethu:V` 就够**：应用日志都走 `logLine`，tag 恒为 `onethu`。同一 buffer 里的
   `[NATIVE-STORE]` / `HTTP cookies=` 行会带票值与账号信息，引用前一律删除（本轮所有引用只保留
   `PAGE-ERR` / `SOFT-*` / `LIB-*` / `BOOT-T` 行）。
3. **含连字符的 scope 会骗过粗筛正则**：`SOFT-RECOVER[xk-core]` / `[weeksched]` 这类 scope 带 `-`，
   用 `grep -o "SOFT-RECOVER\[[a-z]*\]"` 会把它们整类漏掉（本轮第一次统计就漏了 `xk-core` 那一类，
   改用 `[a-z-]*` 才对齐）。**统计口径写进脚本，不要手写正则**。
4. **页面交互只能走 CDP**：`<adb> shell input tap` 在本机被 MIUI 拒绝（`INJECT_EVENTS`）。本轮驱动
   脚本（不进仓库）复用 20.3 第 5 条的 `forward tcp:9226` 通道，提供 `snap` / `kill` / `nav:<文本>` /
   `tab:<文本>` / `watch:<秒>` / `pass5:<秒>`（击杀后按页面按钮精准触发：选课「刷新队列」「刷新数据」、
   生活·宿舍「查询」、预约·图书馆座位「重试」、研讨间、信息·考试、日程）。
5. **本机 UI 观感不作判据**：WebView 96 下 `dvh` / `:has()` / `color-mix()` 全部降级；b23 的结论只取
   日志类指标与 CDP 计数（`.login-wrap` 恒 0、`.nav-item` 恒 16、`.error-note` 计数与文案）。

### 20.5 b25 登录体验打磨（W1–W5）真机复验（`<设备>`）

判据、改法、护栏 ㉓（6 组）、5 例反例与结论见 §7 F3「修复落地（登录体验打磨：误登出清零 + 用户文案 + 周期打扰，b25）」。这里只记本轮新增的操作口径、真机数字与未取到项。

**产物与安装**：APK 18,649,981 字节 / md5 `1265c8bb…`；exe 19,510,272 字节 / md5 `f7a80d48…`（对照 b23 的 `372e78ec…` / `a4e0b95b…`、b24 的 `00244765…` / `f4bd3bab…`，四轮互不相同）。`<adb> install -r -d '<Windows 盘符>:/<目录>/<包>.apk'` 返回 `Success`；升级后仍是 `#/today` / `.nav-item` 16 / `.login-wrap` 0（本机会话保留，未重新登录）。

**新增操作口径**：
1. **`http_native` 的 CDP 调用形状**：该命令签名是 `http_native(input: HttpInput)`，`input` 是**必填对象**（`{ url, method?, headers?, body?, body_b64?, timeout_ms? }`）。直接 `invoke('http_native', { url: … })` 会报 `invalid args 'input' for command 'http_native': … missing required key 'input'`；正确写法是 `invoke('http_native', { input: { url: 'https://webvpn.tsinghua.edu.cn/logout', method: 'GET' } })`——本轮实测返回 200，服务端登出成功。登出触发一律走这一条，不用应用内「退出登录 / 清除已保存的登录信息」，不 `pm clear`，不 force-stop。
2. **`location.reload()` 不能替代整进程冷启**：允许的取证手段里没有 force-stop，只能页面重载。重载走的是「水合 + 快路径 resume」（`BOOT-T 水合完成(0网络) +0ms`），且 `BOOT-T READY` 只在 `learn.resume()` 成功后才打印（`clients.ts:742` 的 `mark("READY(总耗时)")` 在快路径内），登出后 `learn.resume(过期)` 直接 return，本就不打那一行。因此本轮**不与 b23 的 `+1915…+2049ms` 做数字对比**，如实记为未取到。
3. **测量脚本形状**（不进仓库，放工作机临时目录）：`idle`（页内注入 MutationObserver 数 toast、覆盖 `window.onerror`、rAF 数 `>100ms` 长帧，跑 300s，配合 `<adb> logcat` 5 分钟窗口）、`raf | scroll | pages`（导航到指定导航项后 60s rAF 采样；`scroll` 每 2 帧推一次滚动容器；`pages` 每 1.2s 切一页）、`boot bare | logout`（清 logcat → 可选 CDP 登出 → `setTimeout(location.reload, 250)` → 等 40s → dump logcat + 分类计数）。所有计数用脚本里的正则，不手写正则。

**① 空闲 5 分钟打扰计数（前台静置、屏幕常亮）**：
- **改后（b25 最终包，20:40:16–20:45:19）**：toast **0**、`window.onerror` **0**、可见错误条 **0 → 0**、`PAGE-ERR` **0**、`>100ms` 长帧 **0**（max 20.1ms）、logcat 共 **6 行**（1.2 行每分钟）——其中 madmodel 一轮 3 跳请求（`[NATIVE-STORE]` + HOP0/1/2 + 一行 `续期失败：校外环境（MadModel IP 门禁 307）`）。
- **改前（同一台机、同一场景，madmodel 收紧之前）**：toast 0、`window.onerror` 0、可见错误条 0、`PAGE-ERR` 0、`>100ms` 长帧 0（max 33.4ms）、logcat **11 行**（2.2 行每分钟），madmodel **2 轮** 3 跳请求（20:27:02 与 20:28:02，间隔正好 60s）。
- 结论：唯一可测的周期性打扰是 madmodel 的 60s 快试，已按连续失败退避收紧（首次 60s → 2 → 4 → 5 分钟封顶）；其余常驻定时器（learn 30 分钟静默刷新、雨课堂心跳 15s 首查 + 6 小时、displaySyncer 15 分钟、island 15s、VenueSportsTab 维护窗）在本窗口内没有产生可见打扰，一行未改。

**② 卡顿（CDP `requestAnimationFrame` 采样，每轮 60s、3.4–3.6k 帧）**：
| 场景 | 帧数 | p50 | p95 | max | `>100ms` | `>50ms` |
| --- | --- | --- | --- | --- | --- | --- |
| 今日页静止 | 3561 | 16.7ms | 16.7ms | 217.4ms | 1 | 6 |
| 列表滚动（待办） | 3584 | 16.7ms | 16.8ms | 17.2ms | 0 | 0 |
| 切页动画（60s 内 50 次） | 3395 | 16.7ms | 16.7ms | 250.9ms | 14 | 44 |

静止与滚动全程 60fps 档；长帧只出现在切页那一瞬间（每次切页有一次重渲染 + 取数，50 次切页对应 14 帧 `>100ms`），没有周期性长帧——即「15s 灵动岛重渲染」在本机不构成可见卡顿。

**③ 登录链无回归**：
- **基线重载（会话活）**：`BOOT-T 水合完成(0网络) +0ms` → `learn.resume(会话活) +70ms` → `info.resume +143ms` → `READY(总耗时) +149ms`；`PAGE-ERR TODAY-NEWS` 0、`TODAYCAL-SHAPE` 0；`LIB-AUTH 判定登录状态失效` 8 条（全部 `sites=[] siteSrc=none`「认不出落点 → 不重登」），真重登 0、重放 0。`PAGE-ERR CARD / CARD-TX Failed to get public key.` 2 条，与本轮改动无关（b16 已记的统一身份设备限流现象，改前同一条）。
- **服务端登出后重载（CDP `http_native` → `webvpn…/logout` 200）**：`水合完成(0网络) +0ms` → `learn.resume(过期) +2006ms` → `trySilentRelogin(成功) +1576ms` → `LOGIN-OK (lib 链，单管线)`；`READY(总耗时)` 不打印（快路径未过，见操作口径第 2 条）。
  - **不被误登出（本轮第一验收线）**：恢复后 `.login-wrap` **0**、`.error-note` **0**，`#/learn` 取到真实数据——10 门课程 / 8 未交作业 / 42 课程通知 / 88 课程文件。
  - **重登有界、无风暴**：`LIB-AUTH 判定登录状态失效` 32 条，其中 `sites=[learn] siteSrc=request → 共享单飞重登一次` 3 条、`state=skipped reason=cooldown → 不重放（被冷却判掉，不是失败结论）` 2 条、`state=failed` 1 条、`reason=reentrant` 1 条；`兜底升级：全链恢复（门户判活 + 五站点补建）` 1 条（`login-page-with-creds×3` 触发，b18 既有判据）；真重登 1 次（`LOGIN-OK` + `LOGIN ok` + `trySilentRelogin(成功)`），重放 **0** 次（每次原生侧重登都没结算成 done，未重放，改由 boot 自带的静默重登完成恢复）。
  - **页面级指标**：`PAGE-ERR TODAY-NEWS` **0**、`TODAYCAL-SHAPE` **0**；`PAGE-ERR` 仍只有那 2 条 CARD 老问题。
- **未取到**：与 b23 四样本 `+1915 / +1931 / +1932 / +2049ms`（噪声极差 653ms）可比的 `BOOT-T READY`——重载得 `+149ms`，但那是「水合 + 快路径」且进程是热的，与整进程冷启不同量纲；登出后那一行按设计不打印。两项都不拿来对比。

**㉓ 反例自检的红色断言原文**（`node --experimental-strip-types tools/relogin-test.mjs`，注入 → exit=1 → 恢复 → exit=0 + md5 一致）：
1. W1 改回「catch 到 AuthRequiredError 就直接 `backToLogin`」：`✗ ㉓-1 data.ts 每个 backToLogin() 的最近判定都必须是 failed 三态支（实际违规 1 处：[{"cond":"if (err instanceof Error && err.name === \"AuthRequiredError\") ","behindCatch":false}]）`；另有 ㉓-2 三条（取不到 AuthRequired 分支 / 必须先试免密重建 / 必须再给全链一次机会）。
2. `useSemesters` 把 `skipped` 折回失败（`state === "failed"` 改成 `state !== "done"`）：`✗ ㉓-1 …… [{"cond":"if (recovered.state !== \"done\" || reRoamed.state !== \"done\") ","behindCatch":false}]` + `✗ ㉓-2 W1：只有真 failed 才 backToLogin`。
3. Settings 文案改回「会话已失效」：`✗ ㉓-4 Settings 用户可见文案不许再说「会话」（注释除外）` + 两条（雨课堂提示不许说「会话已失效」/ 必须改「登录状态」口径）；`node tools/ui-copy-lint.mjs` 另有 `✗ UI 文案违规 1 处（R1 术语 1）`。
4. 设置页雨课堂错误条撤掉 `userCopy`：`✗ ㉓-5 设置页上屏上游 raw 错误的每个位置都必须过 userCopy（缺 userCopy(ext.errors.yuketang)）`。
5. madmodel 快试改回「无条件每 60s 空跑」：`✗ ㉓-6 退避窗口内必须直接短路——不许继续发请求`。

五例注入后均 exit=1，恢复后 exit=0、涉及文件 md5 与注入前逐字节一致。

**本轮新增的门禁**：`pnpm guard` exit 0、`pnpm test` 23/23、`apps/desktop` 下 `npx tsc --noEmit` 无输出、`node tools/docs-prose-lint.mjs` 21 份文档 0 处违规。

### 20.6 b26 流畅度治理真机复验（`<设备>`）

判据、改法、护栏 ㉔（3 组）、4 例反例与结论见 §7 F3「流畅度治理（切页长帧归因与修复 + core 残余「超时」文案，b26）」。这里只记本轮的操作口径、真机数字与未取到项。

**产物与安装**：APK 18,649,981 字节 / md5 `d4833f9d…`；exe 19,510,272 字节 / md5 `0566cf6b…`（对照 b25 的 `1265c8bb…` / `f7a80d48…`，两轮互不相同；字节数与 b25 相同属打包对齐结果）。产物输入 = 提交 `85f0b544` + 工作区未提交的 `packages/core/src/exthw/yuketang.ts`（与 b16–b25 同源惯例）。`<adb> install -r -d '<Windows 盘符>:/<目录>/<包>.apk'` 返回 `Success`；升级后 `.nav-item` 16 / `.login-wrap` 0。装包后用 CDP `Debugger.getScriptSource` 回读已装机 bundle（3,216,117 字节 / 474 行），`tbWarmIndexOnIdle` 与「暂未收到扫码，请重新获取二维码」各命中 1 次——**先确认新机制与文案确在装机产物里，再取数**。

**① 切页长帧（改前 / 改后，同机同脚本）**：

| 场景 | 指标 | 改前 | 改后 |
| --- | --- | --- | --- |
| 冷首访 12 页 | p95 / p99 / max | 33.4 / 100.3 / 200.6ms | 33.4 / 100.4 / 184.1ms |
| 冷首访 12 页 | `>100ms` / `>50ms` | 5 / 16 | 5 / 17 |
| 热 30 次切页 | p95 / p99 / max | 33.4 / 66.9 / 117.1ms | 33.4 / 66.9 / 133.8ms |
| 热 30 次切页 | `>100ms` / `>50ms` | 3 / 39 | 2 / 38 |
| 逐页 cost（3 轮 × 12 页） | 冷合计 / 平均 | 1480.3ms / 123.4ms | 1247.7ms / 104.0ms |
| 逐页 cost（3 轮 × 12 页） | 热合计（两轮） | 738.8 / 888.0ms | 907.4 / 806.8ms |
| 被修页（选课） | 冷 / 热 | 119.1 / 252、302.2ms | 119.1 / 369.3、269.1ms |

**结论（如实记）**：修复未能在端到端帧指标上取到可归因的改善。选课页那段 24.6ms 的同步解析与建图确实被移出点击帧，但相对每次切页 60–120ms 的挂载渲染与轮间 ±50ms 抖动太小，上表所有差值都落在噪声内；机制侧只主张「一段实测 24.6ms 的同步阻塞不再落在点击路径上」，不主张帧指标变好。

**② 滚动与静置（防回归）**：
- 列表滚动（60s，444 帧，`0ms` 帧 0）：p50 16.7 / p95 16.7 / max **16.7ms**、`>100ms` 0、`>50ms` 0（b25 基线 max 17.2ms），无回归。
- 空闲 5 分钟（前台静置、屏幕常亮，17,944 帧）：p50 16.7 / p95 16.7 / p99 16.8 / max **33.4ms**、`>100ms` **0**、`>50ms` **0**；toast **0**、`window.onerror` **0**、可见错误条 **0**、`PAGE-ERR` **0**、logcat **0 行**（b25 同窗口 6 行，差异来自 madmodel 退避窗口未在本次 5 分钟内到期，不是本轮改动）。

**采样脚本的一个坑（本轮踩到，已修）**：rAF 采样器若在「置 `__run=false`」与「置 `__run=true` 并起新循环」之间没有等待，上一轮循环的回调可能在 `__run` 重新为真之后才执行，于是同一个数组被两个（乃至几十个）循环同时 push，帧间隔出现大量 `0.0ms`——本轮滚动第一次采样就得到 p50 **0**、1329 帧里 886 帧为 0。正确形状是「先停旧循环 → 等 200ms 让它在下一个 rAF 回调里退出 → 清数组 → 起新循环」；修后同一场景 p50 16.7 / `0ms` 帧 0。判据：**p50 接近 0 的帧采样一律作废**。

**③ 登录链无回归（本轮第一验收线）**：CDP `http_native` 打 `https://webvpn.tsinghua.edu.cn/logout`（`input` 对象必填，形状见 §20.5）→ `Page.reload` → 静默重登：`BOOT-T 水合完成(0网络) +0ms` → `BOOT-T learn.resume(过期) +2709ms` → `LOGIN-OK (lib 链，单管线)` → `SILENT-RELOGIN ok` / `BOOT-T trySilentRelogin(成功) +2472ms`。恢复后 `.login-wrap` **0**、`.page-anim .error-note` **0**、`#/learn` 取到真实数据（10 门课程 / 8 未交作业 / 42 课程通知 / 88 课程文件，含「迈向通用的人工智能 · 刘知远」「基因编辑 · 刘俊杰」「微积分A(1) · 杨利军」）。同窗 `PAGE-ERR` **0**、`TODAY-NEWS` **0**、`TODAYCAL-SHAPE` **0**；`LIB-AUTH` 26 条（`sites=[learn]` 6、`共享单飞重登一次` 3、`reason=cooldown` 4、`reason=reentrant` 2、`state=failed` 2）、`兜底升级：全链恢复` 1 条；真重登 1 次（`LOGIN-OK` / `LOGIN ok` / `SILENT-RELOGIN ok` 各 1），无重登风暴。
**未取到**：与 b23 四样本 `+1915…+2049ms` 可比的整进程冷启 `BOOT-T READY`——允许的手段只有页面重载，量纲不同（b25 已记同一条，本轮不重复取）。

**④ 本轮的操作口径补充**：装包后用 `Debugger.getScriptSource` 回读装机 bundle 并按字符串确认新机制与文案确在产物里，是本轮新增的前置步骤——避免在产物没更新的前提下取数（b25 曾遇到 `ONETHU_APK_OUT` 下残留旧构建目录、字节数与真实包不同）。

**㉔ 反例自检的红色断言原文**（4 例，注入 → exit=1 → `cp` 恢复 → exit=0 + 四文件 md5 一致）：
1. 撤掉 `App.tsx` 里的预热接线：`✗ ㉔-1 预热必须在启动路径上接线（登录就绪后的 effect 内）`。
2. 删掉「等待扫码超时」净化规则：`✗ ㉔-2 core「等待扫码超时」必须收成可操作口径（暂未收到扫码，请重新获取二维码）` + `✗ ㉔-2 净化后上屏文本不许再含 超时/会话/凭据/凭证/Cookie`。
3. `Settings.tsx` 的原因撤掉 `userCopy`：`✗ ㉔-3 设置页雨课堂「登录状态已失效（原因）」括号里的原因也必须过 userCopy`。
4. 文案改回含「超时」：`node tools/ui-copy-lint.mjs` 报 `apps/desktop/src/pages/Settings.tsx:964  [R1] 内部表述（用户侧应说「暂时没成功 / 稍后重试」这类可操作口径） / 检查未成功：等待扫码超时`，exit=1。

四例注入后均 exit=1，恢复后 exit=0、涉及文件 md5 与注入前逐字节一致。

### 20.7 K90 现代引擎对照 + 切页长帧的最终裁定（父会话实测，2026-10-04）

对照组设备：日常机 K90 Pro Max（`<设备>`，Android 16，现代 Chromium，无线连接），装的即 b26 dev 包。同一套 harness（12 个安全页白名单点击、rAF 单实例采样、屏幕常亮）。

**① 现代引擎的能力与 `dvh` 兜底等价性（补上 §20.2 的「未取到」）**
- `CSS.supports('height','100dvh')` **true**、`CSS.supports('selector(:has(a))')` **true**（对照 K30 均为 false）。
- `#/trace` 的 `.trace-map-wrap`：`html.className = "is-phone has-reveal"`、`innerHeight` 805 → 命中 `html.is-phone` 的 `calc(100dvh - 178px)` = **627.33px**；同一处 K30 的 `vh` 兜底为 **644.18px** = 822 − 178。两台机器**口径完全一致**（`100dvh` ≡ `100vh`），故 b24 的兜底在现代引擎上零视觉差异。

**② 静止 60 秒（澄清一处误导）**：3818 帧，p50/p95 16.7、p99 16.8、max **28.2ms**、`>50ms` **0**、`>100ms` **0**、大帧明细为空。
> 此前在 K30/K90 上多次出现的 ~217ms 帧**不是周期性**的：它只出现在「采样起点紧跟一次页面导航/挂载」的窗口内。凡把 max 当周期抖动读的结论，都要按这条纠正。

**③ 切页 30 次（同 harness，K90 跑 2 轮）**
| 设备 | p95 | p99 | max | `>100ms` |
| --- | --- | --- | --- | --- |
| K90（现代） | 16.7 | 16.8 / 33.3 | 216.5 / 199.9ms | **2 / 2**（≈7%） |
| K30（WebView 96） | 16.8 | 67 | 200.8ms | 9 |

**④ 归因与裁定**：切页长帧的成本是「新页整棵树的一次挂载渲染」（b26 用 longtask/Profiler 归因：选课 `V8.RunMicrotasks 97.5ms`、设置 `144.9ms`，其中 react-dom 62–143ms；两页 DOM 仅 473/422 节点，成本来自既有 `key={page}` 全量卸载重建）。**非周期性、非网络、也非 b16–b26 改动引入**。霖于 2026-10-04 裁定：**接受为已知项**，不做结构性 keep-alive（访问过的页面保活会带来内存增长、页面陈旧与 effect 重复执行的风险，收益与风险不成比例）；若日后体感明显，再对最重的 1–2 个页面做有界挂载减负。
**残余**：老机（WebView 96）上约一半切页会出现 100–200ms 单帧；静止、滚动、空闲三场景两台机器均满帧（`>100ms` 0）。

## 21. 老机型适配（2026-10-04 两条：触感分级 + WebView 96 兜底）

### 21.0 两条要求（霖原话）

**① 触感分级**：「仅保留长按振动反馈和作业瀑布流的切卡振动反馈，其余的在老机型（不支持物理触感）上均静默」

**② 老机型适配的必要性**：「作为学生，在刚上初中 / 中考后 / 高考后这几个时间点买手机的人相当多，也就是 2020、23、26 这几年，所以老机型适配有一定必要。」

**③ 退役机实测暴露的五项视觉回归 + 一句模糊反馈**：「按压缩放没了」「菜单边框变成实黑」「『我的』页背景渐变没了」「切换 tab 出现两个胶囊」「字体回退很丑，尤其加粗」「全局模糊没了」。

**接受口径**：每一项都要在退役机（Redmi K30 Pro / Android 12 / WebView 96.0.4664.104，下文称 `<设备>`）上看得见地修好；
现代机型逐像素不变；能力判定优先用「是否表达强度」这类能力位，不列机型名单。
本轮两次提交：`02cc3a08`（触感分级 + WebView 96 兜底 + 护栏）、本文档回填（第二次提交）。

### 21.1 判定口径

| 需求 | 判定依据 | 缓存与失败口径 |
| --- | --- | --- |
| 是否支持物理触感（触感分级） | 壳侧能力探针 `ui_haptic_probe {kind:"caps"}` 回传的 `ampCtl=`（= `Vibrator.hasAmplitudeControl()`，即「能否表达强度」） | 一次性探测、结果缓存（`hapticCapsProbed`）；探针抛错 / `ok !== true` / `detail` 无 `ampCtl=` / 正则不匹配 → 一律 `unknown`，行为与探测前完全一致（**不静默**） |
| 是否保留某一档触感 | `LEGACY_HAPTIC_KEEP = ["longPress", "tick"]`（`longPress` = 长按菜单，`tick` = 作业瀑布流切卡） | 白名单外一律静默返回：不振动、不打日志、不报错 |
| 是否走 CSS 兜底 | `@supports not (…)` 判据（`scale` / `color-mix()` / `selector(:has(*))`） | 判据里**不得出现 `var()`**：96 对带 `var()` 的 `@supports` 条件一律判 true，兜底块会误伤现代引擎 |
| 真机验收开关 | `window.__onethuHapticCapsOverride`（dev 可注入，非用户可见设置）：`false` 强制「无物理触感」、`true` 强制现代机 | 只在取 `true`/`false` 时生效；其余（含 `undefined`）走一次性探测结果 |

**触感静默必须排在节流记账之前**：被静默的一档若占掉 60ms 窗口，会把紧随其后的长按反馈（白名单内）一并压掉。护栏钉住这一顺序。

**为什么验收走覆盖开关而不是自动判定**：`<设备>` 的 HAL 谎报幅度控制——`dumpsys vibrator_manager` 里
`mCapabilities=[ON_CALLBACK, PERFORM_CALLBACK, AMPLITUDE_CONTROL]`、`mMaxAmplitudes count=0`、`mResonantFrequency=NaN`、
`mSupportedPrimitives=[]`。API 31 上能区分「转子 / 无物理触感」的公开接口（`getResonantFrequency()`、`getQFactor()`）
要 API 34，本应用最低支持更低，因此**自动判定在这台机器上偏保守**：它会被判成「支持」（与现代机一致），
只有真正缺 `ampCtl` 的低端机会被自动静默。这是本轮明确接受的能力判定边界，不是漏判；覆盖开关是这台机器的
验收路径，也是后续机型排查的入口。

> **b29 更正指针（2026-10-05）**：本节表里「是否支持物理触感 = 只看 `ampCtl`」与上面这段「自动判定偏保守 /
> 验收走覆盖开关」的结论**已被 §21.7 取代**：判据改为「`ampCtl` + 系统组合原语数 + HAL 标定扩展效果块数」
> 的能力组合，退役机与日常机都能自动分开，真机验收不再注入覆盖开关。b28 的原文与表格保持原样留痕，
> 执行口径一律以 §21.7 为准。

### 21.2 真机根因：Chromium 96 的三种失效方式

上游能力表：`scale`（独立属性）Chrome 104+、`:has()` 105+、`color-mix()` 111+。96 上三者的失效方式**互不相同**，
这一点决定了兜底写法。

| 特性 | 96 上的行为 | 真机读数（修复前） |
| --- | --- | --- |
| `scale: var(--ctx-press-k)` | **解析期整条丢弃** | `.row-click[data-ctx-press="tap"]` computed `transform: none`、`scale` 属性读不到；`--ctx-press-k: 0.97` 已进 computed 但没有消费者 → 按压无任何视觉反馈 |
| `:has()` | **整条规则解析期丢弃** | 页面样式表 2335 条规则里带 `:has(` 的剩 0 条；`motion.css` 的 `.segmented:has(.seg-pill.is-ready) button.is-active` 整条消失 |
| 含 `var()` 的 `color-mix()` | **computed-value 阶段整条作废**（按 `unset` 处理），**不回落到同规则里更早的静态声明** | 见下表实验 |

**关键实验（在 `<设备>` 上注入合成元素，非推断）**：

| 注入写法 | computed |
| --- | --- |
| `background: red; background: color-mix(in srgb, green 56%, transparent)` | `rgb(255, 0, 0)`（无 `var()`：静态声明正常回落） |
| `background: red; background: color-mix(in srgb, var(--x, green) 56%, transparent)` | `rgba(0, 0, 0, 0)`（含 `var()`：整条作废，**不**回落） |
| 上述规则后再追加 `@supports not (color: color-mix(in srgb, red 50%, transparent)) { … }` 重声明静态值 | 静态值生效（本轮修法） |
| `CSS.supports('color', 'color-mix(in srgb, var(--x, red) 50%, transparent)')` | **true**（带 `var()` 的判据在 96 上不可用） |

同一条口径对 `@keyframes` 成立：追加在 `@supports not (…)` 里的同名 `@keyframes` 在 96 上覆盖前者，
在现代引擎上后者不生效、前者保留。因此**本仓 29 处 `color-mix`（26 条声明）的「紧邻前一个声明」写法
在 96 上全部无效**（值里都含 `var()`）；本轮统一改为文件末尾的
`@supports not (color: color-mix(in srgb, red 50%, transparent))` 重声明块。

### 21.3 逐项落地

**① 触感分级（`apps/desktop/src/lib/haptics.ts`，唯一改动文件）**
新增 `LEGACY_HAPTIC_KEEP`、`HapticCaps`、一次性 `probeHapticCapsOnce()`、`legacySilenceNeeded()`、
`shouldSilenceLegacy()`（**唯一判定点**）。`haptic()` 与 `installGlobalHaptics()` 都先触发一次探测；
`haptic()` 在节流记账前静默白名单外的档位。除 `haptics.ts` 外未改任何调用点。
副作用（符合按档位放行的口径）：`tick` 同时是全局委托给普通按钮（`.btn`）的档位，所以退役机上按钮仍会有轻触感。

**② 按压缩放 → `transform` 兜底（`global.css` 按压规则后）**
`@supports not (scale: 1)` 内用 `transform: scale(var(--ctx-press-k))` 重声明通用按压路径与 `hold` 档，
并在门内把 `.hw-card` 显式置回 `transform: none`——卡片流把倍率乘进它自己的内联 `transform`，不能被重复处理。
现代引擎该块不生效，`scale` 仍是唯一机制（日常机实测 `scale: 0.97`、`transform: none`）。

**③ `color-mix()` 静态兜底（`global.css` 末尾、`motion.css`、`base.css`）**
按「功能性必须兜、装饰性登记」分类：

| 站点 | 属性 | 兜底值 | 分类与理由 |
| --- | --- | --- | --- |
| `.btn-danger` | `border-color` | `var(--md-sys-color-error)` | 功能：危险按钮描边是唯一语义色 |
| `.mobile-topbar` | `background` | `var(--bg)` | 功能：栏底透明会使栏内文字压在内容上 |
| `.live-chip.is-now` | `box-shadow` | `0 0 0 2px var(--accent-soft)` | 功能：「正在直播」状态环 |
| `.ctx-menu` | `background` / `border-color` | `var(--md-sys-color-surface-container-lowest)` / `var(--border)` | 功能：菜单底透明会透出下层；边框回落成 `currentColor` 即「实黑边框」 |
| `.trace-legend` / `.trace-empty` | `background` | `var(--surface)` / `var(--surface-2)` | 功能：图例与空态底 |
| `.mine-grad::before` | `background-image` + `opacity: 0.38` | 五停点静态渐变（仍取 `--mine-c1..5`，主题跟随与位移动画不变） | 功能：「我的」页背景渐变 |
| `motion.css` `@keyframes m-focus-ring` | `box-shadow` | `var(--accent-soft)` | 功能：`:focus-visible` 已 `outline: none`，焦点环掉了就是无焦点提示 |
| `motion.css` `.bar.is-busy` / `.progress.is-busy` | `background-image` | `repeating-linear-gradient` 静态斜纹 | 功能：进度「在跑」的唯一视觉信号 |
| `base.css` 滚动条拇指（常态/悬停/拖拽） | `background` | 中性一档 `--md-sys-color-outline-variant`（悬停/拖拽取更强一档，带 fallback） | 功能：拇指透明等于看不见 |

装饰性、本轮不兜（护栏 REGISTRY 逐条登记理由，行号为落地后）：

| 站点（file:line） | 属性 | 不兜的理由 |
| --- | --- | --- |
| `global.css:3365` `@keyframes favflash` 35% | `background` / `box-shadow` | 收藏落地闪光，掉了只是少一次黄闪 |
| `global.css:3675` / `3676` `@keyframes dock-ripple` | `box-shadow` | 悬浮坞涟漪扩散 |
| `global.css:670` `.ext-hw-hint .btn-ghost:hover` | `background` | hover 态（触屏无 hover，PC 是 WebView2） |
| `motion.css:401` `.card:hover` | `border-color` | hover 态；`.card` 基础描边仍在 |
| `global.css:2969` `.home-card.is-picked` | `box-shadow` | 同规则 `border-color: var(--accent)` 仍表达选中 |
| `global.css:5001` / `5018` `.thos-note` / `.thos-note-tag` | `background` | 注记底色 |
| `global.css:6648` `.ctx-blur` | `background` | 遮罩着色（`backdrop-filter` 仍在）；静态 rgba 会在自定义主题下跑偏 |
| `pages/info/VenueSportsTab.tsx:876` | `border` | 内联样式无法用 `@supports` 兜；背景 `--red-soft` 仍在 |
| `lib/confirm.tsx:87` | `boxShadow` | 内联样式；投影是装饰 |

**④ 「我的」页背景渐变**：`.mine-grad::before` 的 `background-image` 五个停点全部是含 `var()` 的 `color-mix` →
96 上 computed `background-image: none`（`opacity` 1、`mask` 正常）。兜底块重声明静态渐变 + `opacity: 0.38`
（现代规则本身没有 `opacity` 属性，因此现代引擎不受影响）。

**⑤ 切 tab 出现两个胶囊**：根因是 `motion.css:778` 的 `.segmented:has(.seg-pill.is-ready) button.is-active`
（滑动块就位后撤掉按钮自带底色）在 96 上整条消失 → `is-active` 的静态高亮底（`surface-container-lowest` +
`shadow-1`）与滑动的 `.seg-pill` 同时可见：`is-active` 是类名瞬时切换（新位置立刻出现一个胶囊），
`.seg-pill` 走 `transition` 从旧位置滑过去（旧胶囊随后运动过去），切换期间就是两个胶囊。
修法：`@supports not selector(:has(*))` 下撤掉 `.segmented button.is-active` 的底色/阴影（`.seg-pill` 由组件恒渲染，
量不到尺寸时本来也看不到这一行）。这是本轮**唯一**未审计到的功能性 `:has()`——§20.2 的老引擎 `:has()` 审计
只扫了 `global.css`（22 行选择器），没覆盖 `motion.css`；其余 8 处（待办页高度链两档有兜底块，选课双栏、
独卡统计、侧栏折叠宽度、PC 三处限宽为装饰性）见 21.6。

**⑥ 字体回退（`tokens.css` 的 `--font-ui`）**：原栈在退役机上第一串命中的是 `Noto Sans CJK SC`（只有 400 一个字面），
全仓 91 处 `font-weight: 600/650` 在 96 上只能合成加粗 → 中文粗体发糊。
改法：把厂牌 CJK 前置为 `"MiSans", miui, "HarmonyOS Sans SC", "HarmonyOS Sans"`，其余保持原顺序，
`Microsoft YaHei` 仍在 `sans-serif` 之前（Windows 桌面命中链不变）。
字体族解析必须看「是否与该机默认 sans 不同」（拿不存在的族名也会得到默认 sans）：
- `<设备>`：默认 sans = `Noto Sans CJK SC`；`miui` 与 `system-ui` 解析到 `MiSans VF`（可变字重 100–900，
  600/650 是真字重）；`"MiSans"` 不解析 → 由紧邻的 `miui` 接住。
- 日常机（Android 16 / WebView 143）：所有具名族都落到该机默认 sans = `MiSans VF`；`system-ui` 是**唯一**例外，
  它解析到用户自装的系统字体。因此**这条栈里刻意不加 `system-ui`**：加进去会把用户自装字体漏进 UI 字体
  （真机对照：旧栈 `MiSans VF` → 加 `system-ui` 后变成用户自装字体），`sans-serif` 才是与旧栈一致的最后一档。
  护栏把这条钉成反例红点。
- 96 不支持 `font-synthesis`，所以修法是「选一个多字重的字体」而不是关掉合成；全局 `font-synthesis: none`
  会改现代引擎的字重观感，未采用。

**⑦ 「全局模糊没了」的裁定**：`backdrop-filter` 在 96 上**本身可用**（真机 11 条规则都在，`.mobile-topbar`
computed `blur(10px)`、`.ctx-menu` `blur(22px) saturate(1.6)` 都有值），本轮未改任何 `backdrop-filter`。
可复现的连带损伤在**承载模糊的栏底**：`.mobile-topbar` 的 `background` 是含 `var()` 的 `color-mix` → 96 上变全透明
（computed `rgba(0, 0, 0, 0)`），栏从磨砂面板退化成透明条，观感即「模糊没了」；该栏底已随 ③ 一并兜底
（computed `rgb(14, 17, 23)`）。**残余**：兜底值是 b24 口径的不透明令牌，退役机上顶栏是实底而非半透明磨砂；
要在这台机器上恢复磨砂观感需要新增一个半透明语义令牌，不在本轮范围。
↩ **已关闭（提交 `09632b27`）**：新增半透明语义令牌 `--topbar-bg-alpha: 0.86` + `.mobile-topbar::before` 垫层，
96 恢复磨砂且跟随主题；K30 真机读数（`5ef2eaa3`）与主题三态复测（b39）见 §21.6。

### 21.4 护栏

- 新增 `tools/webview96-fallback-test.mjs`，接进 `pnpm guard`（排在 `tools/haptics-test.mjs` 之后）：
  源码级解析五个样式文件（含 TSX 内联），断言**每一处 `scale:` / `color-mix(` / `:has(` 都有兜底块或在
  REGISTRY 里登记为装饰性**；断言 `@supports` 的 `color-mix` 判据不含 `var()`；断言通用按压兜底存在且门内
  排除了 `.hw-card`；断言 seg 双胶囊兜底存在且现代引擎那条 `:has()` 规则未被删；断言字体栈顺序、不含
  `system-ui` 与 `font-synthesis`；断言 7 处已知 `backdrop-filter` 未被连累删除。当前读数：
  `color-mix 26 处 / scale 4 处 / :has() 19 处`。
- 扩充 `tools/haptics-test.mjs`：白名单恒等、唯一定判点、只探一次、失败保持现状、静默在节流记账之前、无绕过入口的旁路。
- 更新 `tools/context-menu-test.mjs` 的按压口径：`transform` 只允许出现在 `@supports not (scale: 1)` 门内。
- `tools/token-compat-diff.mjs` 的 `--font-ui` 登记为本批**有意**变化（含「不加 `system-ui`」的理由）。

**反例（注入 → 该护栏 exit=1 → 从最终代码备份 `cp` 恢复 → 护栏 exit=0，涉及文件 md5 逐字节一致）**

| # | 注入 | 红点 |
| --- | --- | --- |
| 1 | 删掉 `global.css` 的 `@supports not (scale: 1)` 块 | `global.css:6604 的 scale 没有 transform 兜底、也没有登记` + `通用按压路径缺 @supports not (scale: 1) { … transform: scale(var(--ctx-press-k)) } 兜底` |
| 2 | 删掉 `motion.css` 的 seg `:has()` 兜底块 | `seg 双胶囊兜底缺失：motion.css 需要 @supports not selector(:has(*)) { .segmented button.is-active { background: transparent } }` |
| 3 | 新增一处无兜底的 `color-mix` 声明 | `global.css:6928 的 color-mix 既没有兜底块、也没有登记（.b28-counterexample { border-color: … }）`（行号注解：`global.css:6928` 为**注入态**行号；`cp` 还原后为 6927 行） |
| 4 | `--font-ui` 退回旧栈（去掉 MiSans/miui） | `--font-ui 缺少 "MiSans"` + `--font-ui 缺少 miui` |
| 5 | 触感白名单混入 `click` | `老机型静默白名单必须只有 longPress（长按反馈）+ tick（作业瀑布流切卡），实际：click/longPress/tick` |
| 6 | 探针失败时静默（`unknown` 当老机型） | `老机型判定没有「只有明确探到 no 才算老机型」的口径（unknown 必须保持现状）` |
| 7 | 去掉「只探一次」守卫 | `能力探测没有「只探一次」守卫（会每次触感都探）` |
| 8 | 把 `system-ui` 加回 `--font-ui` | `--font-ui 里不许出现 system-ui（现代机型的用户自装系统字体会漏进 UI 字体：实测该机由 MiSans VF 变成用户自装字体）` |
| 9 | 给 `@supports` 判据加上 `var()` | `global.css 的 @supports 判据带了 var()（96 会判成 true）：@supports not (color: color-mix(in srgb, var(--red, red) 50%, transparent)) {` |

九例注入后均 exit=1，恢复后 exit=0、涉及文件 md5 与注入前逐字节一致。
第 8 例就是本轮真机先踩到的坑（先写了 `system-ui`，日常机上字体被换成用户自装字体），落地前已改回并补进护栏。

### 21.5 真机复验

**设备与安装**：`<设备>`（退役机，Android 12 / WebView 96.0.4664.104）与日常机（Android 16 / WebView 143.0.7499.192，
无线连接）。安装：`<adb> -s <设备> install -r -d <dev 包>`；取证期间不装其它应用、不 `pm clear`、不强制停止。
读数：`<adb> -P 5037 -s <设备> forward tcp:9xxx localabstract:webview_devtools_remote_<pid>` + CDP `Runtime.evaluate`
与 `CSS.getPlatformFontsForNode`；触感用 `<adb> shell dumpsys vibrator_manager` 的
`Previous vibrations for usage TOUCH` 里 `opPkg: app.onethu.desktop.dev` 记录的增量。
本轮 dev 包：`/tmp/b28-out2/onethu-dev-arm64.apk`（18654077 字节，md5 `3304295b0e3a6095f8a50a13acc5cbc1`）
与 `apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/onethu.exe`（19510272 字节，md5 `ab688f491bdb308b3e082cc3267c369a`）；
两者与上一轮（b27：`f0c42efcbc9e8d6ae50e1ae0a3b47f4a` / `c814003476b2861c20b91257a0d04de1`）均不同字节。
证据原始缓冲 `/tmp/b28-*.log`、截图 `/tmp/b28-*.png`（均不在仓库内）。

**① 触感分级（退役机，`dumpsys` 新增记录）**

| 覆盖开关 | 底栏切 tab | 长按菜单 | 作业瀑布流切卡 |
| --- | --- | --- | --- |
| `false`（老机型） | **无新增记录**（页面确实切到 `#/services`） | **THUD**（菜单确实打开 1 个，Esc 后 0 个） | **THUD**（圆点确实从 0 号切到 1 号） |
| `true`（现代机） | POP | THUD | THUD |

结论：白名单外的底栏档位在退役机上静默，白名单内两档保留；现代机三档都有。
（记录里的效果名 POP / THUD 是系统预定义效果的实报名，与本仓 `click` / `tick` 档位的映射由壳侧决定。）

**② 五项视觉回归（退役机 computed，修复前 → 修复后）**

| 项 | 修复前 | 修复后 |
| --- | --- | --- |
| 按压缩放 | `.row-click[data-ctx-press="tap"]`：`transform: none`、`scale` 读不到（`--ctx-press-k` 已 0.97） | `transform: matrix(0.97, 0, 0, 0.97, 0, 0)` |
| 菜单边框 / 底色 | 注入 `.ctx-menu`：`border-color: rgb(232, 235, 242)`（= `currentColor`）、`background-color: rgba(0, 0, 0, 0)` | `rgba(255, 255, 255, 0.1)`（= `--border`）、`rgb(21, 26, 36)` |
| 「我的」页渐变 | `.mine-grad::before` `background-image: none` | `linear-gradient(118deg, …)` 五停点 + `opacity: 0.38` |
| 切 tab 双胶囊 | `button.is-active` `background-color: rgba(21, 26, 36, 0.224)`（另一页签为不透明 `rgb(21, 26, 36)`）且 `.seg-pill` `opacity: 1` → 静态底与滑动块同时在；截图可见两个胶囊 | `background-color: rgba(0, 0, 0, 0)`、`box-shadow: none`；两胶囊计数 3 → 1 |
| 顶栏底（模糊承载面） | `rgba(0, 0, 0, 0)` | `rgb(14, 17, 23)`（`backdrop-filter: blur(10px)` 未改） |

截图：`/tmp/b28-pre-seg.png`（两个胶囊）、`/tmp/b28-post-seg.png`（一个胶囊）、
`/tmp/b28-pre-mine.png`（无渐变）、`/tmp/b28-post-mine.png`（有渐变）。

**③ 字体解析（CDP `CSS.getPlatformFontsForNode`，`--font-ui` 新栈逐项）**

| 取样元素（字重） | 退役机 / 旧栈 | 退役机 / 新栈 | 日常机 / 旧栈 | 日常机 / 新栈 |
| --- | --- | --- | --- | --- |
| `.topbar-title`（650） | `Noto Sans CJK SC` | `MiSans VF` | `MiSans VF` | `MiSans VF` |
| `.page-head-meta`（400） | `Noto Sans CJK SC` | `MiSans VF` | `MiSans VF` | `MiSans VF` |
| `.segmented button`（500） | `Noto Sans CJK SC` | `MiSans VF` | `MiSans VF` | `MiSans VF` |
| `.tech-details-body`（等宽） | `Droid Sans Mono` + `Noto Sans CJK SC` | 同左（未改 `--font-mono`） | 未取 | 未取 |

旧栈对照组用运行时改 `--font-ui` 实现（同一次会话内 A/B，排除包差异）；退役机两侧都验证过
`--font-ui` 不含 `system-ui`（`document.documentElement` 的 computed 值）。
日常机中途无线调试掉线，重连后在同一 dev 包上补测，故四列齐全。

**④ 现代引擎不变（日常机 computed，修复后）**：`CSS.supports` 的 `scale` / `:has` / `color-mix` 均 true；
`.row-click[data-ctx-press="tap"]` `scale: 0.97` 且 `transform: none`（走独立 `scale`，兜底块未生效）；
`.mobile-topbar` `background: color(srgb … / 0.86)`、`.ctx-menu` `border-color: color(srgb 1 1 1 / 0.061)` 与
`background-color: color(srgb … / 0.56)`、`.mine-grad::before` `opacity: 1` 且渐变仍是 `color-mix` 解析值 ——
四处都证明 `@supports not (…)` 兜底块在现代引擎上求值为 false，未参与渲染。

**⑤ 门禁**：`pnpm guard` exit 0；`pnpm test` 23/23；`apps/desktop` 下 `npx tsc --noEmit` 无输出；
`node tools/docs-prose-lint.mjs` 21 份文档 0 处违规。

**2026-10-05 父会话 K30（Android 12 / WebView 96）全站冒烟 + 兜底复核**（读数为父会话实测回填，本次未重复跑设备；18 条路由 `#/today … #/settings`，逐页 DOM 存活；`onerror` / `unhandledrejection` / `console.error` **每页均为 0**；`.nav-item` 恒为 16（未污染收藏夹）；底栏 5 项）：

- **兜底生效读数（`getComputedStyle`）**：`.mobile-topbar` `background-color = rgb(14, 17, 23)`（`color-mix` 兜底为实底）、`backdrop-filter = blur(10px)`（模糊保留）；`.mine-grad::before` = `linear-gradient(118deg, …)`（渐变兜底生效）。
- **能力探针**：`CSS.supports("scale","1") = false`、`CSS.supports("height","100dvh") = false`、`CSS.supports("color","color-mix(in srgb, red 50%, transparent)") = false`（**不带 `var()`** 时判据才诚实；带 `var()` 会假 true，与 §21.2 的陷阱结论一致）。
- **胶囊**：`#/tasks` 的 `.segmented.seg-track` 只有 **1 个 `.seg-pill`**（`children=3`）→ 双胶囊问题在真机不复现。
- **字体**：`--font-ui` 声明栈与 §21.3 一致；同串文本测宽 `--font-ui` 258.13px ≠ `monospace` 275.23px，证明**未落到兜底字体**。实际渲染家族以本节既有的 `MiSans VF` 读数为准；`document.fonts` 对 `local()` 系统字体返回空集，**故该读数不能作为字体身份证据——口径偏差如实记**。

**2026-10-05 b33 单元 K90（Android 16 / 25102RKBEC / WebView 143.0.7499.192，`192.168.18.169:33029`）现代机复验**（同一 b33 dev 包：18654077 字节 / md5 `e8360014738e8b01aff56481413fc4db`；读数用 CDP `Runtime.evaluate` 与 `CSS.getPlatformFontsForNode`、触感用 `dumpsys vibrator_manager` 差分；原始缓冲 `/tmp/b33-haptics-k90b-*.log`、`/tmp/smoke.mjs` 输出，均不在仓库内）：

- **18 路由冒烟**：`#/today … #/settings` 18/18 挂载，逐页 `onerror` / `unhandledrejection` / `console.error` **三个计数均为 0**；`.nav-item` **恒为 17**、`.bottom-nav-item` = 5。
- **`.nav-item` 17 的成因已排查（不是重复渲染）**：比 K30 多出的那一条是**用户已建的收藏夹**（`class="nav-item"`、文本「新建收藏夹」，不带 `nav-new`）；K30 上只有 `nav-new` 的动作按钮那一条，所以是 16。两条的 `outerHTML` 已逐项对照。
- **五项兜底（现代引擎读数，兜底块应惰性）**：`CSS.supports` 的 `scale` / `color-mix` / `:has` / `backdrop-filter` 全为 `true`；`.row-click[data-ctx-press="tap"]` → `transform: none`、`scale: 0.97`（过渡落定后；渲染宽度比 **0.9700**，走独立 `scale` 而非 `transform: matrix`）；注入 `.ctx-menu` → `border: 1px solid color(srgb 0.815686 0.764706 0.8 / 0.6)`、`background: color(srgb 1 0.968627 0.980392 / 0.56)`、`radius 8px`（当前为 `onethu.theme.tsinghua` 主题；色值与 §21.5④ 记录的白色系不同、**透明度结构一致**，因为 `--border` 与面板底随主题走）；`.mine-grad::before` → `content ""`、`linear-gradient(118deg, color(srgb … / 0.32)…)` 五停点、`opacity 1`；`.segmented` 的 `.seg-pill` 计数 **1**（`#/tasks` children=3、`#/info` children=9，双胶囊不复现）；渲染字体 `CSS.getPlatformFontsForNode` = **`MiSans VF`**（声明栈首项 `MiSans` 命中，未落 `sans-serif`；K30 同法读数为同一族）。
- **顶栏（现代机）**：`.mobile-topbar` `background-color: color(srgb 1 0.984314 1 / 0.86)`、`backdrop-filter: blur(10px)`、`position: relative`、`z-index: 30`、`::before content: none`（96 兜底垫层整块惰性）。
- **触感（自动判据、未用覆盖开关；caps `sdk=36 … primsN=0 extFx=32` → `yes`）**：底栏切页 **1 条 `Prebaked=POP(MEDIUM)`**、普通按钮（作业行提醒铃铛）**1 条 `Prebaked=THUD(MEDIUM)`**、长按作业卡片 **1 条 `Prebaked=167(MEDIUM)`（188ms；167 落在 161–192 的 HAL 标定扩展块，与 `extFx=32` 同源）**、作业瀑布流切卡 **1 条 `Prebaked=THUD(MEDIUM)`**。**与 §21.7 的 K30 表（0 / 0 / 1 / 1）不同是预期**：K90 的 caps=`yes`，按 §21.7② 表逐档**不静默**；0 / 0 是老机型口径，复核前先判 caps 再决定期望矩阵。
- **复核方法两条坑**：① K90（API 36）的 `dumpsys vibrator_manager` 每条为 `app.onethu.desktop.dev (uid=…)` + `start: HH:MM:SS.mmm` + `played: Prebaked=…`，沿用 b29 的 `opPkg:` / `startTime:` 过滤会一行都匹配不到、**假报 0 条**（b33 先命中该坑再修正，修正后的解析器两种格式都兼容）；② 期望矩阵依赖 caps，先跑 `ui_haptic_probe kind=caps` 判 legacy / modern，再决定「0 / 0 / 1 / 1」还是「1 / 1 / 1 / 1」。
- **旧读数更正（追加，不重写上文）**：本小节上面 K30 冒烟里的「`.mobile-topbar` 兜底为实底 `rgb(14,17,23)`」是提交 `09632b27` 之前的读数；该提交之后 K30 真机读数为 `background-color: rgba(0, 0, 0, 0)` + `::before` 垫层 `rgb(255, 251, 255)`（= `var(--bg)`）、`opacity 0.86`、`inset 0`、`z-index -1`、`backdrop-filter: blur(10px)`，见 §21.3 的「残余已关闭」条。
- **K90 侧登录前提如实记**：补装 b33 后 K90 本机无记住的登录信息（logcat `LIB-CRED 未命中` / `SILENT-RELOGIN skip: 无记住的密码`），故用 K30 上霖已保存的凭据在本机完成 K90 登录（全程内存、未打印、未落盘），之后才做上列现代机读数。
- **凭据残留自查（方法句）**：以「明文全文 / 可逆存储串全文 / 连续 9 字符明文 / 该串的短片段」四类关键词分别扫仓库、`/tmp`、`/mnt/c/temp` 与本机 logcat 缓冲，逐文件与逐行计数；结果为仓库、两个临时目录与自建脚本 0 命中；两台设备的 logcat 缓冲无完整明文与可逆存储串，短片段命中行全部来自系统进程（`ThermalHalWra…` / `ActivityManag…` / `SSRU-CpuResou…`）的 3 字符串游程，**不构成可复原的凭据残留**。K90 端因按登录页默认勾选保留了「记住密码」，其本机存储与一次正常手动登录等价（已如实登记给本轮发起方）。

### 21.6 未复现 / 未取到 / 残余

- **未复现：底栏（`.bottom-nav`）出现两个胶囊**。源码里底栏只有 `.bottom-nav-pill` 一个胶囊元素、没有静态高亮底
  （`.bottom-nav-item.is-active` 只改 `color`），真机上按「有底色的项 + 胶囊」计数也只有 1 个。
  真机看到的两个胶囊落在 `.segmented`（信息页 8 个页签那一排），已按 21.3 ⑤ 修好。
  本条以「源码 + 真机计数」判定，未拿到「底栏两个胶囊」的截图；若现场看到的确实是底栏，需要下一轮按现场现象再定位。
- **未取到：PC（WebView2）端的字体与兜底块复验**。命中链由栈顺序保证（`Microsoft YaHei` 仍在 `sans-serif` 之前，
  且未引入任何在 Windows 上会命中的新族），本轮无实机验证。
- **残余：退役机上顶栏是实底而非半透明磨砂**（见 21.3 ⑦）。
  ↩ **已修（提交 `09632b27`，霖 2026-10-05 裁定 (b)）**：新增**半透明语义令牌** `--topbar-bg-alpha: 0.86`
  （只承载透明度、颜色仍走 `--bg`，主题覆盖 `--md-sys-color-surface` 时不会露白），96 兜底块改为
  顶栏 `background: transparent` + `::before` 垫层（`position: absolute; inset: 0; z-index: -1`）
  铺 `var(--bg)` 并以该令牌降透明度；`backdrop-filter: blur(10px)` 一行未动。
  护栏 `tools/webview96-fallback-test.mjs` 新增 ⑥ 段 6 条断言（兜底不得是不透明单色底、必须有垫层、
  垫层必须用 `var(--bg)` 铺色、`opacity` 必须引用该令牌、令牌值须在 (0,1) 开区间），
  红点「老机型顶栏又变实底了：96 兜底必须是半透明（见 §21.3 ⑦，霖选 b）」；
  反例 A（退回实底）/B（硬编码 opacity）/C（删令牌）均 exit=1，`cp` 还原后逐字节一致、exit=0。
  现代引擎零变化已用**本机真现代引擎实测**确认（headless Edge：`CSS.supports('color','color-mix(in srgb, red 50%, transparent)')=true`，
  顶栏 computed 仍是 color-mix 结果、`::before` 的 `content=none`，该块整块惰性）。
  **K30（WebView 96）真机读数（含该提交的 dev 包实测）**：`.mobile-topbar` computed `background-color = rgba(0, 0, 0, 0)`、
  `backdrop-filter = blur(10px)`；`::before` computed `content = ""`、`position: absolute`、`inset = 0px`、
  `z-index = -1`、`background-color = rgb(255, 251, 255)`（= `var(--bg)`，当前亮色主题的面）、`opacity = 0.86`。
  即 96 上 `inset` 可用（不需要展开 `top/right/bottom/left`），顶栏磨砂恢复且垫层取主题面而非硬编码色。
  **未取到**：亮 / 暗 / 动态取色三种主题下的顶栏跟随对照（本轮只取到当前主题一档）；另有一条 legacy-only
  已知小差异未修——`html.theme-anim` 只过渡 `background-color`，96 上垫层走 `::before` 的 `opacity/background`，
  主题切换时垫层瞬变而非 300ms 渐隐（现代引擎无此问题；若观感需要，可在兜底块给 `::before` 补 `transition: opacity`）。
  ↩ **b39 复测（K30 / WebView 96.0.4664.104 / APK md5 `4d2383cf…` / 仓库 `ad888ed0`；只测量、未改仓库）**：
  **① 主题三态采样（部分关闭）**——`cmd uimode night` 三档实测：alpha **四态恒 0.86**、`::before` 结构四项
  （`content ""` / `absolute` / `inset 0` / `z-index -1`）恒不变 ✅；浅色（`night=no`）垫层 `rgb(255,251,255)`
  （`--bg #fffbff`）、应用内深色主题（凝夜）垫层 `rgb(14,17,23)`（`--bg #0e1117`），即**垫层跟随主题**在
  「应用主题切换」口径成立。**但系统暗色口径不成立，且这是本轮新发现的阻断**：`night=yes` 时系统
  （`mNightMode=2`、`mCurUiMode=0x21`）与应用进程 Configuration 都已是 night，WebView 96 的
  `matchMedia('(prefers-color-scheme: dark)')` **恒 false**——不重载 / `Page.reload` ×2 / `am force-stop` 冷启
  四次全 false，应用恒留亮色主题（`night=auto` 同）。结论：**系统暗色没有透传到 WebView 96 的
  `prefers-color-scheme`**，不是「只在启动时读」；「跟随系统」在本机取不到深色档，深色读数只能走应用内主题切换。
  方法坑：CDP `Emulation.setEmulatedMedia` 在 WebView 96 是**空操作**（`prefers-color-scheme` / `reduced-motion`
  都不变、无 change 事件），不能用来造暗色档。
  **② legacy 过渡量化（残余成立、未推翻）**——computed：`html`/`body`/`.mobile-topbar` =
  `background-color, color, border-color` / `0.3s,0.3s,0.3s`；`.mobile-topbar::before` = `all` / **`0s`**（全程）、
  `animation-*` 全 `none`。20ms 采样（真实「应用」点击）：浅 → 深「变更加 `t=91.3ms` → 首个 post-mutation 样本
  `t=110.2ms`（+18.9ms）时 `::before` 已是终值 `rgb(14,17,23)`」，26 样本内不变、中间样本 **0** ⇒ 瞬变；
  对照 `body` 有 **7 个中间态且严格单调**（`99→52→38→29→24→21→19→18`，反向 `18→213→227→236→239→244→246→247`）
  ⇒ **垫层瞬变、页面底 300ms 渐变，主题切换瞬间有约 300ms 色差**。备注：`state/theme.ts:394` 注释写 320ms、
  CSS `--dur-3 = 0.3s`（300ms）；`.theme-anim` 在场实测 384.3ms / 429.7ms（代码定时器 420ms）。
  **未取到**：系统驱动深色档（被 WebView 阻断，未走 MIUI 设置界面人工复核）；动态取色档；像素级取色。
  ↩ **跟随系统原生信号（b40，提交 `f14088c4`）**：b39 登记的阻断（WebView 96 不透传系统暗色）已修——
  不再依赖 `prefers-color-scheme`，改由 onethu-mobile 插件在原生侧读 Configuration 的**实际 night 位**
  送给前端（`system_night_mode` 命令启动读一次 + `onConfigurationChanged` → 插件事件 `system-night-mode`
  推送，无轮询/定时器）；`followSystem` 时原生 `dark`/`light` 为准，`unknown`（PC / 命令缺失 / 读取失败）
  回落 `matchMedia`，现代引擎两者一致、行为不变（`themeSchedule()` 语义与持久化结构未动，手动单选路径未改）。
  **K30（WebView 96.0.4664.104，dev APK `64bb6f29156069c172c8dd084a862f50` / 18776957 字节）三态读数**：
  `night=no` 浅色（`data-theme=onethu.theme.tsinghua`、`--bg #fffbff`、`::before rgb(255,251,255)`）；
  `night=yes` 应用确实切到深色主题（`data-theme=onethu.theme.night`、`data-scheme=dark`、`--bg #0e1117`、
  `::before rgb(14,17,23)`），而全程 `matchMedia('(prefers-color-scheme: dark)')` 恒 **false**
  ⇒ 深色档由原生信号驱动、非媒体查询；`cmd uimode night auto` 时 dumpsys `mNightMode=0 (auto)` /
  `mCurUiMode=0x21`（系统折算为 night）→ 应用同步深色（按实际值判定，未把 auto 当亮色）；三态 `::before`
  alpha 恒 **0.86**，`content ""` / `absolute` / `inset 0` / `z-index -1` 四项不变。
  **冷启**（`am force-stop` 后启动，启动读一次）`night=yes` 进深色、`night=no` 保持浅色（观测点为启动后
  约 8s；启动读为异步，未测首帧是否有瞬时亮色）；**热切** no↔yes 由事件即时
  换档且页面 marker 不丢（未重载，非启动读路径）。健康读数全程 `.login-card` 0、`.nav-item` 16、
  `logcat -b crash` 无记录；收尾 `cmd uimode night` 已恢复开工前值 `no`。
  **K90（现代引擎）本轮未取到**：`adb mdns services` 空，`192.168.18.169` 的 38427 / 33029 / 42925
  三端口均 `10061` 拒绝（设备离线 / 无线调试未开）；现代引擎不回归由护栏 [4] 段兜住——`unknown` 回落
  （含 `matchMedia=dark` 子进程对照）与「原生信号可用时媒体查询让位」的结构断言。
  护栏 `tools/theme-system-test.mjs` [4] 段 5 组断言 + 反例 7 例（逐例 `pnpm guard` exit=1 → `cp` 还原 →
  md5 逐字节一致 → exit=0），红点：没有请求原生 night 信号 / unknown 没有回落 matchMedia / 判据没有读
  `UI_MODE_NIGHT_MASK` / 出现轮询与定时器 / 插件新增依赖 / `gen/android` 软链与入库值不一致 /
  启动读到的原生值没有被采用。
- **残余：`tick` 档位放行导致退役机上普通按钮仍有轻触感**（按档位而非按调用点收口，口径由霖确定）。
  ↩ **b29 已修**：保留档改为按调用点收口，普通按钮委托不再放行，见 §21.7 ②。
- **残余：`<设备>` 的自动判定偏保守**（HAL 谎报 `ampCtl`，公开 API 在 API 31 上无法区分转子），验收走覆盖开关。
  ↩ **b29 已修**：判据加上系统组合原语与 HAL 标定扩展效果块两项，退役机自动判 `no`、日常机自动判 `yes`，
  验收不再用覆盖开关，见 §21.7 ①②④。
- **残余：功能性 `:has()` 只剩待办页高度链两档**，已在 `global.css` 两处 `@supports not selector(:has(*))` 块里兜住；
  装饰性 8 处（选课双栏限宽、独卡统计列数、侧栏折叠宽度、PC 信息/生活/设置三处限宽及其含表格变体）不兜，
  理由：限宽或列数掉了只是布局宽一点，不影响可达性与语义。

### 21.7 b29 判据收紧与保留档修正（代码提交 `5a3b99fd`）

**① 判据从「只看 `ampCtl`」收紧成能力组合**（§21.1 的旧记录保留留痕，执行按这里）。
判定本体是零依赖纯函数 `decodeHapticCaps()`（`apps/desktop/src/lib/hapticCaps.ts`）：

| 输入 | 结果 | 理由 |
| --- | --- | --- |
| `detail` 里没有 `ampCtl=` | `unknown` | 探针失败 / 字段缺失 → 保持现状（不静默） |
| `ampCtl=false` | `no` | 无幅度控制 = 无法表达强度，这是最典型的老机型 |
| `ampCtl=true`，但缺 `primsN=` 或 `extFx=` | `unknown` | 老壳配新前端时字段不全 → 保持现状 |
| `ampCtl=true`，`primsN>0` 或 `extFx>0` | `yes` | 有系统组合原语，或有 HAL 标定的扩展效果块 |
| `ampCtl=true`，`primsN=0` 且 `extFx=0` | `no` | 幅度位是谎报：既拼不出组合波形，也没有标定块 |

`primsN` / `extFx` 由 Kotlin 侧只读追加（`OnethuMobilePlugin.kt`）：`primsN` = `Vibrator.areAllPrimitivesSupported()`
在 1..8 上通过的数量；`extFx` = 161..192 这段 HAL 标定扩展效果块里 `Vibrator.areAllEffectsSupported()` 返回
**YES** 的数量（UNKNOWN 不计）。两个都是公开 API 的计数，不含任何机型名单。

真机读数（自动判据、同一 dev 包、未注入覆盖开关）：

| 设备 | 系统侧事实 | 探针 detail | 判据 |
| --- | --- | --- | --- |
| `<设备>`（Redmi K30 Pro / Android 12 / WebView 96） | `mMaxAmplitudes count=0`、`mResonantFrequency=NaN`、`mSupportedPrimitives=[]`、`capabilitiesFlags=111` | `sdk=31 id=-1 ampCtl=true effects9=[0…8] primsN=0 extFx=0` | `no`（老机型） |
| K90（Android 16 / 现代机） | `capabilitiesFlags=1111`、支持 202 个效果 id（含 99、161–192、201–217、401–410） | `sdk=36 id=-1 ampCtl=true effects9=[0…8] primsN=0 extFx=32` | `yes`（支持） |

**② 保留档改为按调用点收口**。b28 的白名单 `LEGACY_HAPTIC_KEEP = ["longPress", "tick"]` 只回答「哪些档位可以留」；
`tick` 同时被**全局 `.btn` 委托**（普通按钮）和**作业瀑布流切卡**两个来源复用，只按档位放行等于把普通按钮一起留下。
b29 给 `haptic()` 加可选参数 `HapticOptions { legacyKeep?: boolean }`，唯一判定点 `shouldSilenceLegacy()` 委托纯函数
`silenceOnLegacy(caps, effect, keep, legacyKeep)`：

| caps | 档位 | `legacyKeep` | 是否静默 |
| --- | --- | --- | --- |
| `no` | `longPress` | — | 放行（这一档语义唯一，无条件） |
| `no` | `tick`（切卡调用点） | `true` | 放行 |
| `no` | `tick`（`.btn` 委托） | 未传 | 静默 |
| `no` | `click` / `heavy` / `reject` | 任意 | 静默（`legacyKeep` 不能把白名单外的档捞回来） |
| `yes` / `unknown` | 任意 | 任意 | 不静默（现代机型逐档不变） |

调用点只有两处需要看：切卡是 `TasksPage.tsx` 的 `haptic("tick", { legacyKeep: true })`；`.btn` 委托仍是
`haptic("tick")`，不声明。护栏里 `legacyKeep: true` 只允许出现在 `TasksPage.tsx`。

**③ 护栏**：`tools/haptics-test.mjs` 增加纯函数真值表（判据 8 例 + 放行 12 例，含上表两台机器的 caps 字符串）、
`legacyKeep` 只允许出现在切卡调用点、静默必须在节流记账之前、`navigator.vibrate` 仍不得作为旁路。

反例红点原文（注入 → `exit=1` → `cp` 还原 → md5 逐字节一致 → `exit=0`）：

- 判据里丢掉 `extFx` → `✗ K90 型 caps 必须判 support：decodeHapticCaps("…extFx=32") = no，应为 yes`
- `ampCtl=false` 判成 `unknown` → `✗ ampCtl=false 必须判 legacy（无幅度控制 = 无法表达强度）：… = unknown，应为 no`
- 去掉 `longPress` 无条件放行 → `✗ 老机型长按必须放行（真机 b29 首跑曾把它拦掉）：silenceOnLegacy(no, longPress, KEEP, false) = true，应为 false`
- `.btn` 委托声明 `legacyKeep` → `✗ 普通按钮（.btn）委托声明了 legacyKeep：老机型上按钮会继续有轻触感（应按调用点只放行切卡）`
- 静默挪到节流记账之后 → `✗ 老机型静默必须放在节流记账之前（否则静默档会占掉 60ms 窗口）`

**④ 真机验收（`<设备>`，自动判据、未用覆盖开关；`dumpsys vibrator_manager` 差分，原始 buffer `/tmp/b29-haptics-*.log`，
报告 `/tmp/b29-haptics-report.json`）**：

| 触发 | 新增记录 |
| --- | --- |
| 底栏切页（待办 → 服务） | **0 条** |
| 普通按钮（作业行提醒铃铛 `.btn`） | **0 条** |
| 长按作业卡片 | **1 条**（`THUD`；长按期间 A3 菜单已开，证明长按本身生效） |
| 作业瀑布流切卡（点非当前圆点） | **1 条**（`tick` 档在本机映射 `ID_THUD=3`） |

**未取到**：K90 本批离线（无线端口 `192.168.18.169:43737` 与 `:40963` 均「目标计算机积极拒绝」），三项回归没测。
上表里 K90 的判据结论只由探针读数 + 纯函数真值表支持，不是行为实测；K90 的 caps 读数取自此前的在线窗口。

**↩ b33 补测（K90 已在线，同四把触发的行为实测）**：`192.168.18.169:33029`（Android 16 / WebView 143.0.7499.192）上按上表四把触发跑 `dumpsys vibrator_manager` 差分，自动判据、未注入覆盖开关，caps `sdk=36 … primsN=0 extFx=32` → `yes`。读数：**底栏切页 1 条 `POP` / 普通按钮 1 条 `THUD` / 长按 1 条 `prebaked 167`（188ms）/ 作业瀑布流切卡 1 条 `THUD`** —— 与 §21.7② 表「`yes` / `unknown` 逐档不静默」一致；「0 / 0 / 1 / 1」只适用于 `no`（退役机），**复核前先判 caps**。两条方法坑：① K90（API 36）的 dump 每条是 `app.onethu.desktop.dev (uid=…)` + `start: HH:MM:SS.mmm` + `played: Prebaked=…`，沿用本批 `opPkg:` / `startTime:` 过滤会一行都匹配不到、**假报 0 条**（b33 先命中再修正）；② 期望矩阵随 caps 变，先 `ui_haptic_probe kind=caps` 再定期望。原始 buffer `/tmp/b33-haptics-k90b-*.log`。上表「未取到：K90 本批离线」一项据此关闭。

**⑤ 接受的能力代价**：API 31–33 上既没有系统组合原语、HAL 也没有 161–192 标定块的设备会被判 `no`（过度静默）。
这是公开 API 能拿到的最强信号，失败方向是「安静」而不是「乱振」，可以接受。`mMaxAmplitudes count` 没有公开读取
接口（`getMaxAmplitude()` 只在有幅度控制时有意义，也拿不到数量），所以没有进判据。

---
**这份文档怎么用**：按 §10 的顺序一批一批做；每条做完照 §1.1 交证据、照 §1.2 自查反例；遇到与本文档冲突的现场情况，**停下来问霖**，不要自行改口径。

---

## 22. 交接与查验（2026-10-04 夜间批次）

> 本章是**给霖的入口**：先看 §22.2 怎么自己验，再看 §22.3 有哪些要你点头的事。
> 各条的详细口径、真机数字、反例红点仍在各自章节（§6 E4/E8、§7 F3、§14 K 批、§16–§19、§21 老机型）。

### 22.1 这一夜做了什么

- **登录 P0（b31，提交 `439236e6`（代码+护栏））**：修两个真病根 —— ① 恢复任务被冷却判掉（`skipped/cooldown`）时**立刻弹警示**且重试按钮清冷却的操作 fire-and-forget 抢跑，导致「点了还弹」；② 登录前发出的请求在登录**之后**才结算成失败，无代次校验 → 把刚登录的用户**踢回登录页**（多请求时「要点两次」）。改法：登录代次守卫（陈旧结算一律不写回）+ 冷却态**自动重试**（有限次、带退避、不叠加、不刷屏，不再让用户看到警示）+ 重试按钮先 `await` 清冷却再重载。**未碰任何 cookie 仓语义**（b21 已定、霖 b23 划为红线）。真机 BEFORE/AFTER 对照见 §7 F3。
  **⚠️ 收尾更正（2026-10-05，必须读）**：真机复核暴露**第三条路径** —— **同一代次内**两跳误判：campus 第一跳 `softRecoverResult("campus")` 被冷却判 `skipped`（按契约不登出），第二跳 `relearnRoamOnce()` 的漫游请求拿到 id 登录链 200 页 → `LIB-AUTH` 判 `logged-out-page` → `failed`，于是 b19「任一入口真 `failed` 即登出」契约生效，**把 67 毫秒前刚成功的全局恢复覆盖掉**（`SOFT-RECOVER[global] state=done (195ms)`，会话确实是活的）→ **仍会闪回登录页**（真机实测：第 1 轮手动登录后 **62 秒**自发闪回一次）。**结论：RC1（警示）与 RC2 的原始机制（陈旧代次）已达成，但「闪回登录页」症状未彻底关闭，P0 不主张彻底关闭。** 证据见 §7 F3 的反例段，修复方向与所需决策见 §22.3 第 10 条。
- **提醒弹层按 Esc 关闭（父会话直做，提交 `45d6aa89`）**：独立提醒弹层（作业卡片铃铛 / 学堂 DDL 提醒卡）此前只有「选档位」与「再点铃铛」两条关闭路径，**没有任何 Escape 监听** → 按 Esc 关不掉（属缺功能，不是坏行为）。修法：`HwRemindPop` 新增可选 `onDismiss`，捕获阶段监听 Escape（与 A3 长按菜单同款 `preventDefault + stopPropagation`），走同一条 200ms 退场动画且**不改变已设的提醒值**；两处独立弹层接线，长按菜单内的提醒面板**不接**（Esc 归 A3，避免一次 Esc 关两层）。护栏 `tools/context-menu-test.mjs` 增 5 条源码级断言，反例注入 exit=1（红点「提醒弹层没有接管 Esc」）、还原后 md5 `afafc605bc92a75d3795d2ef13936d02` 逐字节一致、exit=0。**真机复核（K30 / WebView 96，父会话 2026-10-05）**：打开弹层后注入非 Esc 键（`a`）→ `.hwremind-pop` 仍为 1（对照成立、判定特异）；注入 `Escape` → 1 秒后 `.hwremind-pop` = 0；关闭后 `overlayLeft = 0`、`.nav-item` = 16（无残留遮罩、未污染收藏夹）。**口径偏差如实记**：注入的是 CDP 合成 `KeyboardEvent`（真 WebView 内的键盘事件），不是物理按键；PC 端建议霖用真键盘按一次 Esc 复核。
- **文档侧（父会话接手收口）**：§16 / §17 / §19 三章状态指针、§7 L740 与 §21.4 两处历史行号注解、§21.5 全站冒烟与兜底读数回填、本章 §22 成稿，均随本文件所在提交落地。**§17.2 的改造后复测数字已补（b39，2026-10-05）**：行宽 326px 不变、标题 37px → **294px**（≈223px 是线性估算，实测网格下标题独占整行 = 326−2×16）、三个被撤控件 0/0/0、长按菜单三项、截图两张，见 §17.2；正文 §17.2 与 §17 开头状态指针已同步。
- 本会话早前批次已各自提交：b27（E4 时段推荐 + E8 全部作业页）、b28（触感分级 + WebView 96 五条兜底）、b29（E8 一步展开 + 触感判据收紧/保留档修正）。

### 22.2 霖的查验清单

**第 0 步 · 门禁（仓库根，约 2 分钟）**
```
pnpm guard            # 期望 exit 0（含 老机型兜底 / dvh / 文案 / 护栏清单）
pnpm test             # 期望 23 项 23 通过
cd apps/desktop && npx tsc --noEmit   # 期望无输出
node tools/docs-prose-lint.mjs        # 期望 21 份文档 0 违规
```
反例自检法：任选一处注入违规 → 对应护栏 exit 1 → 还原 → exit 0。各轮红点原文分别在 §6 / §7 F3 / §14 / §21.4。

**第 1 组 · 登录自动恢复（本轮 P0）**
- 冷启应用 → 停在主页 10 秒：**期望不再出现「登录状态暂时未能自动恢复」警示**；若恢复链被冷却判掉，页面应**几秒内自己好**。
- 「设置 → 账户 → 退出登录」→ 手动登录：**期望 60 秒内不闪回登录页**——但**本轮已知仍会偶发**（真机 3 轮里 1 轮在登录后 **62 秒**自发闪回，机制见 §22.1 的收尾更正与 §7 F3 反例段）。**若你遇到，请记下发生时刻 + `adb logcat -s onethu:V` 里同窗口的 `LIB-AUTH` / `SOFT-RECOVER[global]` 行**——那正是下一轮要修的第三条路径（§22.3 第 10 条）。
- 日志：`adb logcat -s onethu:V`，看 `SOFT-RELOGIN state=… reason=… streak=… cooldown=…s`、`AUTO-RECOVER`、`trySilentRelogin(成功|失败) +Nms`。

**第 2 组 · 老机型 WebView 96 五条（K30 上验）**

| 项 | 怎么看 | 期望 |
| --- | --- | --- |
| 按压缩放 | 长按卡片/行 | 有轻微下压（`matrix(0.97,…)`） |
| 长按菜单边框 | 长按后看描边 | 细淡描边，不是实黑 |
| 「我的」页背景渐变 | 进「我的」 | 有渐变 |
| tab 切换胶囊 | 切页面内分段 tab | **只有一个**胶囊滑动 |
| 字体 | 看粗体标题 | MiSans（不再糊） |
| 顶栏（已知取舍） | 看顶栏 | 老机型是**实底**、不是磨砂 |

**第 3 组 · 触感策略（手指 + 可自动化）**
- 老机型：底栏切页**不震**、普通按钮**不震**、长按**震**、作业瀑布流切卡**震**。
- 现代机：五档与改造前一致。
- 自动化：`adb shell dumpsys vibrator_manager` 看振动记录增量。
- **手感必须你用手指验**（真机只验到 `mode=prebaked`：tick 75ms / click 63ms / heavy 58ms / longPress 63ms / reject 68ms）。

**第 4 组 · 今日页「时段推荐」（E4）**
- 「今日」→ 编辑态有「时段推荐」开关（默认开）；拨到关 → 手动上移一张卡 → 开关应**自动关**。
- 期望：按当前时段重排卡片（如上午有课：课表 → 通知）；**只重排、不改卡片集合**。

**第 5 组 · 全部作业页（E8）**
- 「网络学堂 → 全部作业」：tab `进行中 / 已交 / 已批 / 全部`；「已逾期」单列一栏且计入「进行中」。
- 页头垃圾桶 → **一步**进「已忽略的作业」→ 恢复一条 → 空态。

**第 6 组 · 性能（D1）**
- K30 空闲 5 分钟：0 长帧 / 0 弹窗 / 1.2 行日志每分钟。
- 切页长帧：K30 约 9–14/30 帧 >100ms（**已知项，你已裁定接受**）；K90 约 2/30。
- dvh 兜底等价：K30 `vh` 644.18px ≡ K90 `dvh` 627.33px。

### 22.3 需霖审批的问题清单

1. **C10 输入法顶起底栏**（§4 C10「未做，等霖定」）：要改仓库**外**的安卓生成工程（`AndroidManifest.xml` 的 `windowSoftInputMode`）+ 前端 `visualViewport` 补偿，须保证构建幂等。→ 现在做 / 继续搁置？
   ↩ **霖 2026-10-05 裁定：暂时放弃**（本轮不动，标记保留备查）。
2. **F3 ③ 触发面下移到 `nativeFetch`**（§7 F3 L744③）：现状「不经过 `nativeFetch` 的失败不会被捕获」；要做必须先删既有 `#looksLoggedOut`/renewers 一侧防重复触发，**风险高**，本轮刻意未做。→ 单开一轮？
   ↩ **霖 2026-10-05 裁定：单开一轮**（先做 #3 旁枝，再单开这一轮）。
   ↩ **更正（2026-10-05，父会话回填失误）**：本条上面那句「现状」引用的是 §7 F3 的 **b16 历史诊断段**（line 761），不是现状。
   ③ 的判定 + 编排**已于 b17（`acb18df8`，10-03）下移到 `nativeFetch`**：`apps/desktop/src/lib/transport.ts:349-368` 的
   `nativeFetch` = `withLibAuthRecovery{ classifyError: isLibAuthFailureText, classifyValue: status===200 && looksLibLoggedOut, recover: 业务钩子 }`，
   恢复钩子在 `apps/desktop/src/lib/clients.ts:340-371` 接到共享单飞；core 侧 `#looksLoggedOut`/`#relogin`/`#reloginInflight`/
   实例 `onAuthRequired` 与 clients.ts 注册点**已删**（护栏 `tools/relogin-test.mjs:520-522` 三条断言正钉死），真机证据在 §7 F3 的 b17 段。
   **真正剩余的缺口（待霖选口径）**：**(A)** `universalFetch`（`transport.ts:550`）在 Tauri 下走 `tauriFetch`（独立逐跳循环），
   **完全绕过 ③ 判定** —— 水票（DormTab）、CourseInfoTab、ThubookPage、plugins SDK 出口、cloudCal、exthw、trace 都在这条通道上；
   **(B)** 判据钉死 `status===200`，401/403 + 登录页不触发（护栏明令 `isLibAuthFailureText("HTTP 403")===false`）；
   **(C)** renewers / `learn.reloginHook` / 看门狗三条并行触发面是 b17 **有意保留**（同样落在共享单飞上），删任一会破 b17 与 b22 P1-2 契约。
   → **口径 1（父会话推荐）**：把 `tauriFetch` 也收进 ③ 判定、消灭绕过通道，不删并行面，用「不存在绕过通道 + 每条请求只经过一次
   `withLibAuthRecovery`」证明唯一触发；**口径 2**：按字面删一条并行触发面（需霖豁免 b17/b22 契约）；**口径 3**：承认 ③ 已于 b17 完成，
   只回填本条状态 + 补 `verdict=none`（真死侧）每 epoch 至多一条日志。
   ↩ **霖 2026-10-05 裁定：口径 1** —— 把 `universalFetch` 在 Tauri 下的 `tauriFetch` 一跳也收进 ③ 判定、消灭绕过通道；
   **不删** renewers / `learn.reloginHook` / 看门狗；判据集合不许改（401/403 不在本轮范围）；并一并补 `verdict=none`（真死侧）
   每 epoch 至多一条计数日志。验收口径：「不存在绕过 ③ 的原生通道 + 每条请求恰好一次判定、恰好一次共享单飞」。**已完成**：口径 1 见 b36 `8da219ec`，判定域限缩见 b38 `1125ec4c`。
   ↩ **完成（2026-10-05，b36，代码提交 `449a8fb7` + `8da219ec`）**：口径 1 已落地——`tauriFetch` 收进唯一判定入口（`withLibAuthRecovery` 全仓只一处），两条原生通道各一层薄壳且两个单次请求原语互不调用、保持私有 ⇒ 不双重包装；恢复仍是同一把共享单飞（两通道共用同一钩子单例）。判据集合一个字未改，renewers / `learn.reloginHook` / 看门狗全部保留。真死侧新增 `LIB-AUTH-DEAD verdict=none scope=<SCOPE> hits=<n>`：每 epoch 至多一条、行内只有 verdict / scope / hits（不含凭据 / 票值 / URL / 查询串）。真机 K30 取到 `LIB-AUTH-DEAD verdict=none scope=CAMPUS-AUTH hits=1` 且如实落登录页、单次触发不重复登出、存活侧不踢；**新通道（THUbook / 洗衣机实测确在 `tauriFetch` 上跑）未能在真机造出鉴权类失败**（可达端点全是公开接口），该通道的 ③ 覆盖由护栏 ㉘ + 反例 ce1 / ce2 证明；**K90 离线，未取到**。详见 §7 F3 的 b36 段。
   ↩ **b38（2026-10-05，代码提交 `1125ec4c`）：判定域限缩** —— 霖同日裁定把 ③ 判定**限缩到清华 / WebVPN 域**，收口 b36 段 ⑥ 如实登记的外溢（域外消费方「200 + 登录页形态」不再被当成会话失效）。闸落在唯一判定入口 `judgedNativeFetch()` 的第一步，两条原生通道一并生效；判据集合与三态 / 单飞 / 链外结算 / b19「skipped 不登出」/ b33 存活复核与 10s 宽限 / auto-retry 上限 / b36 的 `LIB-AUTH-DEAD` / cookie 仓语义一行未动。K30 真机：清华会话链判定照旧（服务端登出 → boot 后 `sites=[learn]` 判定与全链恢复齐全、活着一侧不踢），外部域（洗衣机）窗口 0 条 `LIB-AUTH`；**真死侧 `LIB-AUTH-DEAD` 未取到**（设备首轮 `failed` 后同代次重试自愈，界面始终停在工作页；造真死侧需暂时摘除霖保存的登录信息，按 §22.6 未获单例批准、一律不碰），**K90 补测已取到**（b39：域外两窗口各 6 条 `[HOP]` / `LIB-AUTH` 0 条（含登出后窗口）；登出窗口 83 条判定、真执行重登 1 次 + 5 次 skipped、无风暴；18/18 挂载、`nav=17`、`withErr=0`、`PAGE-ERR` 仅 6 条已知设备级风控；真死侧 `LIB-AUTH-DEAD` 该设备仍 0 条＝未取到，未碰凭据）。详见 §7 F3 的 b38 段，护栏 ㉙ 组 + 反例 6 例。
3. **F3 ④ 双仓同步——已完成，勿重做**：b21（`b72d4645`）已修并真机取证（两仓 1ms 内收敛、538 条并列行 0 对不等）。**红线：清仓语义按 b21 不动**（你 b23 亲定）。仅剩两条旁枝：其余票种无主动核对、冷启原生仓从 `(无)` 起待查。
   ↩ **霖 2026-10-05 裁定：把旁支解决了** —— 事实基础与任务书已核清（原生仓是 Rust 侧 `SharedNativeJar`，同步以「原生 → JS 回灌」为主；旁枝 (i) 其余票种只被动入账、要加**有界幂等**的主动核对；旁枝 (ii) `CookieStore::default()` 冷启为空而 JS 有持久化快照，先查证有无 save/load 再决定是否用 JS 快照做种子、**排除基础设施票**）。等 #10 单元释放构建链与设备后开工。
   ↩ **状态（2026-10-05，b35，代码提交 `118afc1f`）：已解决**（两条旁枝都收口，b21 清仓语义与「谁是真源」一行未改，b23 红线未动）。旁枝 (ii) 查证结论与任务书前提不同：Rust 侧**一直有** save/load（`accc5a17` 落地并接线），丢的是 host-only——旧 tsv 读 `cookie::Cookie::domain()` 对 host-only 恒 `None` 后 `continue`，含 `wengine_vpn_ticket` 的会话票从未落盘，这才是冷启 `(无)` 的根因；故**未**用 JS 快照做种子，改为原生自持久化（cookie_store 自带 serde JSON）。真机：K30 首启 `load n=0 fmt=tsv(legacy)`/首跳 `(无)` → +30s JSON `n=11` → 冷启#2/#3 `load n=11 fmt=json` 且首跳即带同一张 `wrdvpn1-150fcb05…`（K90 同型 `wrdvpn1-1269…`）；两仓并列行改造后 **113 对全等 / 0 对不等**（改造前形态 49 对里 1 对不等）。旁枝 (i) 主动核对读数：`missing=2`（补「原生有、JS 无」的其余票种）、`updated=1 infra=1`（基础设施票按原生→JS 回灌）、`same=11`（同值幂等）；护栏 ㉗ 组 + 6 例反例（逐例 exit=1 → `cp` 还原 → md5 逐字节一致 → exit=0）。细节见 §7 F3 ④「旁枝收口（b35）」。
   ↩ **K90 补测（b39，2026-10-05，APK md5 `4d2383cf…`）**：两次冷启 `load n=10` / `load n=11 fmt=json`；第一轮带磁盘旧票 `wrdvpn1-a007…` 被服务端判过期 → `sites=[learn]` 判定 → 重登落新票 `wrdvpn1-b5bb…`；第二轮首跳 200、全 buffer 只有这一张票（126 次、无换票），`LIB-JAR-RECONCILE` 两轮分别为 `missing=2 same=8` / `updated=1 same=10 infra=1`，30s 计数行 `n=11` 齐。b36/b38 的 K90 复核因设备掉线未取到（见 §7 F3 ④ 末条）。
4. **`.svc-row:active` / `.task-row:active` 的 `transform: scale(0.99)`**（§19.2 标「等霖定」）：与 §2/§3「整卡/整行按压只压暗底色、绝不改尺寸」口径冲突。→ (a) 撤掉 scale 只压暗 (b) 保留 (c) 只 PC 保留？ —— **已裁定**：保留为显式例外（见 §2；第 51 条已关闭）。
   ↩ **霖 2026-10-05 裁定：保留**（§19.2 的「等霖定」可撤，本条关闭）。
5. **老机型顶栏兜底成实底**（§21.3 ⑦ 残余）：96 上 `color-mix` 失效使顶栏透明 → 兜底为不透明令牌。→ (a) 接受（推荐）(b) 新增半透明令牌恢复磨砂？
   ↩ **霖 2026-10-05 裁定：(b)** —— **已落地（提交 `09632b27`）**：新增 `--topbar-bg-alpha: 0.86` 语义令牌 + `::before` 垫层，96 恢复半透明磨砂且跟随主题；护栏 ⑥ 段 6 条断言、反例 A/B/C 均 exit=1；现代引擎零变化已用本机真现代引擎实测确认。详见 §21.3 的「残余已关闭」条。**K30 真机读数已补**：`5ef2eaa3` 记录顶栏 `background-color: rgba(0,0,0,0)` + `backdrop-filter: blur(10px)` + `::before` 垫层 `rgb(255,251,255)` / `opacity 0.86` / `inset 0` / `z-index -1`；b39 又补了主题三态与 legacy 过渡量化（见 §21.6）。
   ↩ **b40 状态（2026-10-05，代码提交 `f14088c4`）**：本条的 K30 深色档读数在 b39 被 WebView 96 阻断
   （系统 night 不透传 `prefers-color-scheme`）；b40 改由 onethu-mobile 插件原生读 Configuration 的实际
   night 位后，退役机深色档已取到——`::before` 垫层 `rgb(14,17,23)`、`--bg #0e1117`、alpha 恒 0.86，
   且应用确实切到深色主题，顶栏垫层「跟随系统」在 K30 成立。详见 §21.6 的 b40 段。
6. **老机型触感「过度静默」边界**（§21.7）：能力判据下个别 API 31–33 机型会偏静音（失败方向是「安静」不是「乱震」）。→ 接受 / 改判据？
   ↩ **霖 2026-10-05 裁定：接受**（不再动）。
7. **「底栏两个胶囊」位置确认**：b28 查证底栏只有 1 个胶囊、无静态高亮底；两个胶囊出现在**页面内分段 tab 条 `.segmented`**（已修）。→ 你看到的是这种吗？若指底栏请说哪个页面。
   ↩ **霖 2026-10-05 确认：是页面内 tab 的** —— 与 b28 及父会话真机复验一致（`.segmented` 只剩 1 个 `.seg-pill`），本条关闭。
8. **K90 重新上线**：它离线时 b28/b29/b31 的「现代引擎无回归」只能标「未取到」。→ 方便时接一次，我补齐。
   ↩ **霖 2026-10-05：已上线** —— 父会话已接上（`192.168.18.169:33029`，Android 16 / WebView 143.0.7499.192，1200×2608），现代机回归由本轮 P0 单元用同一次构建补齐。
9. **手感真手指复核**（同 §22.2 第 3 组）。
   ↩ **霖 2026-10-05：已确认没问题** —— 本条关闭。
10. **「登录后被闪回登录页」的第三条路径（本轮最重要，需你点头才动）**：真机实测——**同一代次内** campus 第一跳被冷却判 `skipped`（按契约不登出），第二跳 `relearnRoamOnce()` 漫游拿回 id 登录链 200 页判 `failed` → 命中 b19「任一入口真 `failed` 即登出」，把 **67ms 前刚成功的全局恢复**（会话确实是活的）覆盖掉 → 仍闪回登录页（第 1 轮手动登录后 62 秒发生一次）。**最小修复方向（未实施）**：`failed` 落 `backToLogin()` 前复核「同窗口是否已有全局恢复成功」（只读 `libSoftRecoveryInFlight()` / 全局恢复时间戳），或改为「**两跳都 `failed` 才登出**」。这会碰 b19 契约与护栏 ㉓-1 / ㉕-4，须**单独一轮**。→ 同意这么修 / 你有别的口径？
    ↩ **霖 2026-10-05 裁定：继续修复，修好为止** —— **已修复（b33 `e3adb3e3`；真死侧日志由 b36 `449a8fb7` 补齐）**，硬要求是**双侧**：会话确实活着时任何一跳 `failed` 都不许踢人；会话真死时仍必须在有限次内如实落到登录页；护栏做双侧断言、反例 ≥4、K30/K90 双机取证。
    ↩ **b33 收尾（提交 `e3adb3e3`（代码+护栏））**：**已修**——K30 真机复现第三条路径后 `LIB-AUTH-ALIVE-RECHECK CAMPUS-AUTH verdict=done-after-start arm=armed` 命中不登出（`.login-card` 恒 0、`.nav-item` 恒 16），三次臂用尽后如实落登录页（`.login-card` 1，无卡死）；护栏 ㉓-1 / ㉕-4 改判定形状 + 新增 ㉖ 组，6 例反例全红 → 还原绿。**仍留**：会话真死（`verdict=none`）时不写复核日志（**↩ b36 已补，提交 `449a8fb7`**：真死侧落一行 `LIB-AUTH-DEAD verdict=none scope=<SCOPE> hits=<n>`，每 epoch 至多一条，K30 真机取到 `scope=CAMPUS-AUTH hits=1`），该侧真机证据是「3 次臂用尽后 1s 内 `.login-card` 上屏」的时间线 + 护栏 ㉖-3 镜像；K90 侧本轮只补现代机回归（18 路由 0 错、`.nav-item` 17＝含 1 个用户自建收藏夹），第三条路径未在 K90 单独复现；id 侧设备级风控仍在本仓自愈范围之外。

### 22.4 未取到 / 残余

> **本节于 2026-10-05 由文档审计单元重编**（分支 `next/ui-ux-overhaul`，改回填时的 HEAD `e88356f2`）。
> 起源是旧汇总行的一次关键词汇编（26 条未取到 / 20 条残余 / 6 条未复现 / 1 条待补 / 2 条待霖 / 2 条等霖定），
> 那条汇总把**历史段与现状段混在同一个计数里**，且 b29 之后（`5a3b99fd` / `09632b27` / `5ef2eaa3` / b33 `e3adb3e3` /
> b35 `118afc1f` / b36 `449a8fb7`+`8da219ec` / b38 `1125ec4c` / b39 `ad888ed0`）关掉的条目仍被算作未做。
> 下面逐条**重新判定**，关键词只是入口、不是结论；判定依据一律取「同一文档里后批的收尾段」或提交号。
> **口径更正（重要）**：`am force-stop` 自 b20（`0bb2bac8`，§20.4）与 b39（§7 F3 ④ 末条）起已是常用取证手段；
> b25 / b26 时期「允许的取证手段里没有 force-stop」这条当批约束**已不适用**，凡因它标「量纲不可比 / 未取到」的
> 冷启计时项，本节一律改判为「仍开·仓库内可完成」。

**五类计数（共 76 条）**：**① 已关闭 38 条 · ② 仍开·仓库内可完成 15 条 · ③ 仍开·需霖或设备动作 10 条 · ④ 取不到 10 条 · ⑤ 本仓范围外 3 条**。
仍未开的合计 **28 条**（② + ③ + ④），其中真正需要霖点头或接一次设备的只有 ③ 的 10 条；
④ 的 10 条**不建议再排期**（原因已逐条写明，重取不会得到新结论）；⑤ 的 3 条不在本仓可动面内。
范围：本台账覆盖 §6、§7（含 §7 F3 全部批次）、§20、§21、§22 各章的「未取到 / 残余 / 未复现 / 待补 / 待霖 / 待查 / 未验」条目，
另并入 §2 A2/A3、§4 C10、§17.2、§19.2、§22.2 的输出项（这些条目在旧汇总里被漏掉）。

**① 已关闭（38 条）**

1. **E4 时段推荐**：**已关闭** —— 落地记录 + 霖 2026-10-04 三条裁定（§6 E4 L601–610）；K90 现代引擎对照由 b39 补齐。
2. **E4 残余（`homePriorityGroups` / `applyHomeTimeOrder` / Today 三处排序接线 / mock 钩子）**：**已关闭** —— 定义即为推荐实现本体，§6 E4 L602–609 已落地并护栏钉死。
3. **E8「一步展开」（垃圾桶两步菜单）**：**已关闭** —— `5a3b99fd`（§6 E8 L663–687）真机一步直达 + 反例 2 例。
4. **E8 K90 现代引擎对照**：**已关闭** —— b39 `ad888ed0` 的 K90 18 路由冒烟（§7 F3 ③ 末条）。
5. **E8 tab 栏「变短」缺截图逐帧**：**已关闭（证据充分、不再逐帧比对）** —— `5a3b99fd` 真机读数 tab 4 项 `进行中8 / 已交6 / 已批1 / 全部15`（同段截图与 `#/learn` 现场记录，§6 E8 L681–687）。
6. **E4/E8 `aria` 读数未单独取**：**已关闭（护栏已覆盖）** —— E4 的 `Switch` 的 `aria-checked` 真机读数（§6 E4 L626）、E8 垃圾桶徽标由 `assignments-page-test.mjs` 断言（§6 E8 L657、L687）。
7. **F3 ① 判活面太窄 / ② 探针假活 / ⑤ 失败后锁死**：**已关闭** —— b16 `f643f654`（§7 F3 L748–759）三态前身落地 + 真机数字；L745「最小必要修复①⑤」与 L760「两条留待办」已被后批取代。
8. **F3 ③ 触发面下移**：**已关闭** —— b17 `acb18df8` 下移到 `nativeFetch`（§7 F3 L763–772）、b36 `8da219ec` 口径 1 收进唯一判定入口（§22.3 第 2 条）、b38 `1125ec4c` 域限缩。
9. **F3 ④ 双仓票不同步**：**已关闭** —— b21 `b72d4645` 正修（两仓 1ms 内收敛，§7 F3 L953–979）。
10. **F3 ④ 两条旁枝：其余票种无主动核对、冷启原生仓从 `(无)` 起**：**已关闭** —— b35 `118afc1f`（原生自持久化 + 主动核对；b21「待查」即此条，§7 F3 L982–990），b39 `ad888ed0` K90 补测（§22.3 第 3 条 L3087）。
11. **冷启回归 `BOOT-T READY` 无同条件对照（b19 / b20 / b22 三次记录）**：**已关闭** —— b39 用 `am force-stop` 冷启取得同口径样本（§7 F3 ④ L991），量纲不可比的前提已消失。
12. **P1（`clients.ts` 钩子与 renewer 桥、`tabStates.tsx`）**：**已关闭** —— b22 `a89532cd`（§7 F3 L995–1013）：`reentrant` 同步判定 + renewer 桥 `cooldown → true` + tab 层 `TAB-AUTH` 诊断行。
13. **P2 七处布尔出口 + `data.ts:1933` toast 文案**：**已关闭** —— b23 `4a9dab9b` + `905b5043`（§7 F3 L1014–1045），真机 `-PENDING` 读数与旧 toast 全文 0 条。
14. **可选 6 组（`Schedule.tsx` / `DormTab.tsx` / `LibraryTab.tsx` ×5 / `LibRoomTab.tsx` ×3）**：**已关闭** —— b23（§7 F3 L1025）；`data.ts` 的 `useSemesters` 一侧由 b25 W1 `642cd495`（L1048）。
15. **看门狗 `reload.ts` 布尔薄封装**：**已关闭** —— b23（§7 F3 L1024）改 `softRecoverResult("global")` 三态分流。
16. **`XK-SEARCH` 选课搜索文案缺口**：**已关闭** —— b25 W3（§7 F3 L1050）三态收口 + 4.2s 有界重试。
17. **判据 C「真失败落登录页」真机未取到（b19 / b20 / b23 记录）**：**已关闭** —— b33 `e3adb3e3` 存活复核 + b36 `449a8fb7` 真死侧日志，K30 双侧真机取证（§7 F3 L1081–1101、§22.3 第 10 条）。
18. **b31 场景②（持久失败 → 有限次后如实提示）未复现**：**已关闭** —— b31 自动重试上限 3 + b33「臂用尽落登录页」真机双侧（§7 F3 L1077、L1098）。
19. **b31 ③ RC2 陈旧代次版本未独立复现**：**已关闭** —— b31 代次守卫 + b33 同代次路径修复，护栏 ㉕-4 / ㉖ 双侧确定性证明（§7 F3 L1071、L1086）。
20. **F3 ③ 新通道（此前绕过 ③ 的 `tauriFetch`）**：**已关闭** —— b36 `8da219ec` 收进唯一判定入口；「真机造不出域外鉴权失败」是**设计限制**，见下面 ④ 第 67 条（本条只关「通道是否在判定面内」）。
21. **J6 外溢风险（域外消费方被判成登录状态失效）**：**已关闭** —— b38 `1125ec4c` 域限缩，K30 外部域窗口零 `LIB-AUTH`、K90（b39）两窗口各 6 条 `[HOP]` / `LIB-AUTH` 0 条（§7 F3 L1110–1121）。
22. **b35 的 `login` 触发器真机未取到**：**已关闭（等效读数已补齐）** —— b39 `ad888ed0` 冷启走「首跳 302 → 判定重登 → 落新票 → 下一轮同票 200」闭环，覆盖同一触发器的语义（§7 F3 ④ L991）。
23. **§20.7 切页长帧（K30 约一半切页 100–200ms 单帧）**：**已关闭** —— 霖 2026-10-04 裁定接受为已知项、不做 keep-alive（§20.7 L2625–2626）。
24. **§21.3 ⑦ 顶栏在 96 上是实底而非半透明磨砂**：**已关闭** —— 霖裁定 (b) + `09632b27` 落地，K30 `5ef2eaa3` 读数、b39 主题三态复测（§21.6 L2881–2898）。
25. **§21.6 底栏「两个胶囊」**：**已关闭** —— 霖 2026-10-05 确认为页面内 `.segmented`，真机 `.seg-pill` 计数 1（§22.3 第 7 条、§21.3 ⑤）。
26. **§21.6 普通按钮仍有轻触感**：**已关闭** —— b29 `5a3b99fd` 保留档改为按调用点收口（§21.7 ②）。
27. **§21.6 退役机自动判定偏保守（HAL 谎报 `ampCtl`）**：**已关闭** —— b29 判据扩为能力组合，两台机自动分开（§21.7 ①②）。
28. **§21.7 K90 三项回归未测**：**已关闭** —— b33 补测（§21.7 L2991）。
29. **§20.2 ⑥ 现代引擎应命中的 `calc(100dvh - 210px)` 分支未做真机复验**：**已关闭** —— K90 实测 627.33px（§20.7 ① L2613–2614）。
30. **§20.5 / §20.6 重启后 `BOOT-T READY` 未取到（页面重载不可比）**：**已关闭** —— b39 用 `am force-stop` 冷启取得 807 / 572 行同口径样本（§7 F3 ④ L991）。
31. **§20.5 / §20.6 桌面 exe 未构建（`tauri:build:dev` 缺 `gdk-3.0`）**：**已关闭（环境侧）** —— b33 用 `cargo-xwin` + `--target x86_64-pc-windows-msvc` 出裸 exe，配方 `/tmp/b33-exe-build4.log`（§7 F3 L1095 注记）。
32. **§22.3 第 1 条 C10 输入法顶起底栏**：**已关闭** —— 霖 2026-10-05 裁定暂时放弃（§22.3 L3064）。
33. **§22.3 第 3 条 F3 ④ 两条旁枝**：**已关闭** —— b35 `118afc1f`（§22.3 L3086）。
34. **§22.3 第 4 / 7 / 9 条（`.svc-row`/`.task-row` 的 `scale`、胶囊位置确认、手感真手指复核）**：**已关闭** —— 霖 2026-10-05 三条裁定（§22.3 L3089 / L3095 / L3099）。
35. **§22.3 第 6 条老机型触感过度静默边界**：**已关闭** —— 霖裁定接受（§22.3 L3093）。
36. **§22.3 第 8 条 K90 重新上线**：**已关闭** —— 设备已上线，b39 补测（§22.3 L3097）。
37. **§22.3 第 10 条第三条路径（同代次两跳误判闪回登录页）**：**已关闭** —— b33 `e3adb3e3` + b36 `449a8fb7`，K30 双侧真机取证（§22.3 L3101–3102）。
38. **§22.1 提醒弹层 Esc 关闭的真键盘复核**：**已关闭（方法边界如实记）** —— 真机 CDP 合成 `KeyboardEvent` 已取到（开 1 → Esc 后 0），PC 真键盘复核并入本表 ③ 第 57 条（§22.1 L3011）。

**② 仍开·仓库内可完成（15 条）**

39. **§21.3 ① 触感分级的真机分档补测**：本仓可完成 —— 用 `dumpsys vibrator_manager` 在保留档/静默档各跑一轮差分，按 §21.7 ④ 表给 `0/0/1/1` 与 `1/1/1/1` 两套期望；这是纯量测，不需改动代码（§21.5 L2809–2817）。
40. **§21.6 底栏胶囊的点击遮罩对比**：本仓可完成 —— 对比现有「K6 切换」「点遮罩」两条计数读数，与 `.seg-pill` 计数 1 同屏取一次即可（§21.3 ⑤、§21.6 L2865）。
41. **§21.6 ① 顶栏主题三态 / legacy 过渡的剩余量测**：本仓可完成 —— 应用内主题（含凝夜）三档已取到；像素级取色可在同一次采样里补，不需要设备侧设置（§21.6 L2899–2916）。
42. **§6.1 E3 学期切换控件真机未验**：本仓可完成 —— 换/补一个有多学期成绩的账号可演示；或按现有 API（`learn.getSemesterIdList()`）导出脱敏运行时快照，在真机上按日期注入多学期列表后验。不牵登录状态存储，只走公开数据接口（§6 E3 L581）。
43. **§7 F3 ① K30 `adb shell input tap` 被 MIUI 拒绝 → 页面走查受限**：本仓可完成 —— 用 CDP `Runtime.evaluate` 派发 `click()` / `Input.dispatchMouseEvent` 替代（§20.3 第 2 条、§20.4 第 4 条），不必修设备权限。
44. **§7 F3 ① K30 的 CDP 注入面**：本仓可完成 —— 同上；`input tap` 只是便利手段，不是唯一入口。
45. **§20.5 / §20.6 冷启动 `BOOT-T READY` 的重取**：本仓可完成 —— `am force-stop` + 脚本读 `BOOT-T READY`，b39 已给出可复用的单轮流程（§7 F3 ④ L991，含 `logcat -c` 与 `adb shell log -t onethu` 窗口标记）。
46. **§7 F3 选课评价弹层（F1）真机覆盖不足**：本仓可完成 —— 当前数据 DOM 里没有「教学评估」入口；下一次有评估数据时按同一 `Courses.tsx` 受控弹层族补一次「连开 3 个并逐个关闭」的计数读数（§7 F1 L713）。
47. **§7 F3 14 位数单次真机现场（被占位冷却判掉的那 1 条）**：本仓可完成 —— 用 b20 起可重复的手法（应用内经 `http_native` 打 `webvpn…/logout` + 触发加载）制造运行中失效现场（§7 F3 L894 复现手法、§7 F3 L845–848）。
48. **§7 F3 `loginGate` 20s 冷却内 `return false` 的「假失败」**：本仓可完成 —— 在 `libSessionGuard` 侧给 `libSoftSettle` 增加一条「本次失败来自登录申请冷却」的只读标注，或在该分支直接返回 `skipped/cooldown` 语义；改动面仅 `infoLib.ts` 的 `ensureInfoPortal()` 冷却分支（b19 普查表记作 `:468`）与一处判定（§7 F3 普查表 L796、L882）。
49. **§7 F3 `refreshLearnDataSilently` 静默丢数据（`data.ts` 旧 `:369`）**：本仓可完成 —— 与 b23 的 P2 同句式收口（`done` 重取 / `skipped` 保旧值 / `failed` 才落空），并补一条护栏断言（§7 F3 普查表 L816）。
50. **§17.2 改造后复测的对照面**：本仓可完成 —— b39 已取到 294px 与 0/0/0；还剩「同一窗口的 K90（现代引擎）同项读数」一次采样（§22.1 L3012、§17.2）。
51. **§19.2 遗留观察的落地形式**：本仓可完成 —— 霖已裁定保留 `scale(0.99)`，只需把 §2/§3 的口径句加一个显式例外注记（本仓文档侧），代码不动（§22.3 第 4 条、§19.2 L2130–2132）。
52. **§20.3 / §20.4 取机与安装的当次判定**：本仓可完成 —— 按 20.4 第 1 条「当次先试一次 `install -r -d`（Windows 路径）」，成功即不必请霖手动安装；已由 b29 / b31 / b33 三次复验（§20.4 L2504–2511）。
53. **§7 F3 `AUTO-RECOVER` 的常驻观察**：本仓可完成 —— 每次真机现场的同一窗口内增加一次 `AUTO-RECOVER` 计数，补足每个 epoch 至多一条的样本再复核是否有重复或风暴（§7 F3 L1077、护栏 ㉕-3）。

**③ 仍开·需霖或设备动作（10 条）**

54. **§7 F3 / §22.4 真死侧 `LIB-AUTH-DEAD` 与「如实落登录页」的新场景复核**：需霖或设备动作 —— 造真死侧要临时移除霖保存的登录信息，按 §22.6 必须**逐次取得批准**；b36（`449a8fb7`）与 b38 之后按纪律不再默认允许（§22.6 L3118、§7 F3 L1121、L3083）。
55. §22.6 凭据相关操作的单次批准纪律：需霖或设备动作 —— 任何读取 / 写入 / 备份 / 移除都必须逐次批准并在报告里披露；纪律本身已完成，待霖确认后续是否需要授权（§22.6 L3118、§21.5 L2870–2871）。
56. **§2 A2 手感真手指复核的补测**：需霖或设备动作 —— 五档已由霖 2026-10-05 确认，但真实手指复核只能由霖做；若需再复核一次强档映射，需霖在场（§22.3 第 9 条、§2 A2 L138）。
57. **§22.1 PC 端提醒弹层真键盘 Esc 复核**：需霖或设备动作 —— 需 PC 端（exe）跑一次真键盘（合成事件已验，物理按键未验）（§22.1 L3011）。
58. **§20.3 / §20.4 安装被 MIUI 拒绝时的手动安装回退**：需霖或设备动作 —— 当 `install -r -d` 当次失败（`INSTALL_FAILED_USER_RESTRICTED`）时需霖手动安装（§20.3 第 1 条、§20.4 第 1 条）。
59. **§22.3 第 10 条 K90 侧第三条路径未单独复现**：需霖或设备动作 —— 需接 K90 或换台现代引擎设备，按 b33 同一手法（手动登录 → 退登录 → 登录后 60s 窗）做一次（§22.3 L3102 末句）。
60. **§21.6 亮 / 暗 / 动态取色三种主题的顶栏跟随对照**：需霖或设备动作 —— 系统深色档在 WebView 96 上被阻断（见 ④ 第 68 条），要取深色档只能经应用内主题切换或换设备；动态取色需设备侧主题源（§21.6 L2896–2897）。
61. **§8 P 批 · PC 专属全部**：需霖或设备动作 —— 「另开一批，等霖发话」；PC 端（exe）跑一次是必要条件（§8 L1125、§10 第 7 步 L1175）。
62. **§22.3 第 2 条 F3 ③ 触发面的下一轮（口径 1 已完成，余项待霖选）**：需霖或设备动作 —— 霖已裁定「单开一轮」；口径 1 已落地，若继续则需霖确认剩下要不要动（§22.3 L3066–3073、L3082）。
63. **§7 F3 选课死结的真实现场（`zhjwxk` 清仓重登路径）**：需霖或设备动作 —— 只有霖的日常选课窗口能自然造出「选课死结」，真机复核要等那一刻（§7 F3 普查表 L797 的 `zhjwxkReloginHook` 行、L835 的旁证行）。

**④ 取不到（10 条，逐条写明为什么）**

64. **真死即落登录页、无第二次加载可造** —— b33 的 `failed → 落登录页` 需要设备真的死透；b33 三次臂用尽后 1s 内 `.login-card` 上屏，这条路已经走到底，再造只会得到同一条时间线（§7 F3 L1098–1099）。
65. **`x-onethu-auth-dance` 在 `nativeFetch` 通道恒为空** —— 该 header 只在 `tauriFetch` 侧写入、`nativeFetch` 侧读取，两条通道共用同一判定集合 ⇒ 结构上该通道永远读不到它；判定集合不动就不可能取到（§7 F3 L771、L980）。
66. **域外域 + 登录页形态 200 端点** —— 真机上没有这种可控端点（洗衣机 / 水站 / THUbook / `tsinghua.app` 全是公开 JSON 接口），b38 只能取「无新增触发」的观测；判别力已由护栏 ㉙-1 与反例 ③④ 兜住（§7 F3 L1117）。
67. **`tauriFetch` 通道真实鉴权失败** —— 该通道可达端点全是公开 / 外部接口（`app.cs` 直连两个通道都返回 `{"1":"1"}` 200、水站明标公开且不走 WebVPN），会话真死时也造不出鉴权类失败；进入唯一判定入口已由护栏 ㉘ 结构性钉死（§7 F3 L1107 ④）。
68. **WebView 96 的系统驱动深色档** —— 系统已是 night（`mNightMode=2`）但 96 的 `matchMedia('(prefers-color-scheme: dark)')` 恒 false：不重载 / `Page.reload` ×2 / `am force-stop` 冷启四次全 false，**是 96 自身没有把系统档透传进来**，不是「只在启动时读」（§21.6 L2903–2907）。
69. **WebView 96 的 `Emulation.setEmulatedMedia`** —— 在该版本上是空操作（`prefers-color-scheme` / `reduced-motion` 都不变、无 change 事件），不能用它造深色档；这是 CDP / 引擎能力限制（§21.6 L2908–2909）。
70. **动态取色档与像素级取色（96）** —— 深色档既然取不到（第 68 条），动态取色只能走应用内主题，且像素级取色需要设备侧主题源与稳定光照；本轮已改为「取 alpha 与 `::before` 结构四项」的等效口径（§21.6 L2917、L2900–2903）。
71. **Android WebView 的 CDP 不认 `Emulation.setDeviceMetricsOverride`** —— 调用后 `innerWidth` 仍 360，400px 档没有实测对照，只有 CSS 结构推断（§20 L2204–2205）。
72. **`MIUI` 拒绝 `adb shell input tap`（`INJECT_EVENTS permission`）** —— 系统级注入限制，不是本仓能绕的；页面交互一律改走 CDP（§20.3 第 2 条、§7 F3 ① L990）。
73. **初次运行中登录状态全灭「卡在登录页且不自愈」这一形态** —— b19 三态之后该形态已在代码层面被移除：现在同类现场是「停在原页 + 可重试错误条」，要复现旧症状等于把三态回退（§7 F3 L900–901、L919）。

**⑤ 本仓范围外（3 条）**

74. **id 侧设备级限流 `Failed to get public key.`** —— 设备级风控，不在本仓自愈范围；有限次重试后仍会如实提示，已如实登记为不可修项（§7 F3 L760、L856、L1121、§22.3 L3100）。
75. **PC（exe）端的本机交叉构建** —— 本仓在 Linux 上缺 `gdk-3.0` 等桌面端目标依赖，`tauri:build:dev` 失败；b33 的 `cargo-xwin` 配方只出裸二进制、不含安装包（§7 F3 L990 ③、L1095）。
76. **正式版产物与安装面** —— 按红线只出 dev 包，正式版产物与安装包一律不碰；任何需要正式版验证的项都不在本仓可动面内（§0.3、§0.6 第 5 条）。

**维护口径（给下一轮执行单元）**：本表只记「当前仍开」的四类与判定依据，新增条目请**直接改这一节并在条目里写提交号 / 小节**，
不要再按关键词另起一份汇总；判「仍开」之前先在本文件里搜一次「已关闭 / 已修 / 已补 / 已取到 / 裁定」，命中即归 ①。

**父会话更正（2026-10-05，两处归类）**：
- 第 57 条（PC 端真键盘 Esc）与第 61 条的「PC 端（exe）跑一次」前置**应归 ②**：裸 exe 可在本机用 `cargo-xwin` + `--target x86_64-pc-windows-msvc` 出（b33 配方，`docs/BUILD-AGENT-GUIDE.md` §3 有交叉编译步骤；注意必须带嵌入前端产物的 feature，否则是去加载 devUrl 的坏品），PC 走查用 **WebView2 远程调试**（G1/G2 先例，窗口 1240×820、真鼠标），**不需要霖**。只有「真手指物理按键」那一层才需要霖在场；可用 Windows 侧 OS 级按键注入先验，并在文档里如实标注「OS 注入、非手指」。第 61 条的 P 批本体仍归 ③（「等霖发话」是批次口径，不是技术阻塞）。
- 第 75 条应**限定为「安装器打包（NSIS）」**：Linux 上缺 `gdk-3.0` 使 `tauri:build:dev` 失败，与第 31 条（裸 exe 已用 `cargo-xwin` 出）不冲突；PC 走查不依赖安装器。

### 22.5 回退

`git log --oneline` 找对应提交；要回到某轮状态就 `git checkout <提交>` 后重新出包（APK/exe 构建命令见各批「产物」段）。
**注意**：`packages/core/src/exthw/yuketang.ts` 是霖自己的未提交改动（长期 ` M`），回退时别动它，也别 `git add -A`。

### 22.6 长期纪律（霖 2026-10-05 定，后续所有执行单元必须遵守）

- **凭据存储**：**严禁**读取 / 写入 / 备份 / 移除霖保存的登录信息（应用存储 `credentials`，含「记住密码」凭据）。任何此类操作——包括为造场景而临时移除或回灌——都必须**逐次取得霖的批准**，并在报告里如实披露。已发生的两次（K30 → K90 登录页回灌、b36 为造真死场景临时移除后按 hash `c0e6a83f` 逐字节还原）霖已接受，但今后不再默认允许。
- **判定域**：③ 的登录失效判定在 Tauri 通道上**限缩到清华 / WebVPN 域**（霖裁定，用于消除口径 1 的外溢——外部服务不再进入判定；**已完成**，提交 `1125ec4c`，K30 实测外部域窗口零 `LIB-AUTH`、清华链判定照旧）。

## 23. 第二批 UI/UX 反馈落地（霖 2026-10-05 六条，A1–A6）

> 本章接在 §22 之后，是新批次的回填位。§22.2 的查验清单只覆盖 2026-10-04 夜间批次，
> 不覆盖本章条目；本批次的查验清单在各单元收口后补入本章末节。

条目映射（霖 2026-10-05 的六条反馈，任务书不在仓库内）：

| 编号 | 条目 | 回填小节 | 提交 |
| --- | --- | --- | --- |
| A6 | 注释被当正文打印 + 预警框风格跑偏 | §23.1 | `881788ce` |
| A5 | 网络学堂四卡片换行只许 1×4 / 2×2 / 4×1 | §23.2 | `9cd3b589` |
| A1 | 「正在取作业」加载态形状错误 | §23.3 | `3b9da699` |
| A3 | 课程通知项缺长按 / 右键与 ctx 菜单收藏 | §23.4（移动端；PC 右键见 §B5） | `1318108a` |
| A4 | 课程文件项瘦身 + 文件页按钮回归主体 | §23.4（列表项）/ §23.5（详情页） | `1318108a` |
| A2 | 作业文件页下载 / 预览被降级到二级菜单 | §23.5 | `9345703a` |

### 23.1 A6 · JSX 注释泄漏与确认弹窗重做（提交 `881788ce`，代码 + 护栏）

**病根（确定性）**：JSX children 位置里、元素或表达式**后面**的 `/* … */` 不是注释，而是文本节点，整串会渲染进界面。霖在「忽略这条作业」预警框正文里看到的 `/* token-ok: 同上（玻璃层上的墨色） */` 即由此产生。

**同型 7 处**（全部修复）：`lib/confirm.tsx` 的预警框正文元素之后、`components/DevPanel.tsx` 四处（标题 strong / 版本 span / 日志表头 div / 空态三元表达式）、`components/ExtHwLoginModal.tsx` 的二维码衬底 div、`pages/info/CardTab.tsx` 的二维码衬底 div。前 6 处的修法是把注释放进 `style` 对象字面量——它由此仍是真注释，同时保住 `tools/token-leak-test.mjs` 「同行出现 token-ok 即豁免颜色」的判据；`confirm.tsx` 的那处随弹窗重做一并消失。

**新护栏 `tools/jsx-comment-leak-test.mjs`（已接进 `pnpm guard`，位于 token-leak 之后）**：逐字符状态机（code / 单双引号串 / 模板串 / 行注释 / 块注释，模板串的 `${` 切回 code）只收集**处于 code 位置**的 `token-ok` 块注释；该注释之前的同行代码若以 JSX 标签或 JSX 表达式容器收尾，即判定为 children 位置并报红。判据是「是否处于 JSX children 位置」，因此模板串内部（`MailPage` 的 srcdoc 样式表）与 `//` 行注释形态不受影响。全仓 35 处 code 位置注释，零误报。

**弹窗重做**（霖：与软件风格不统一、明显的 AI 生成风）：
- 旧的组合是「46px emoji ⚠️ + 写死的白玻璃卡（`rgba(255,255,255,.62)`）+ 17px 红标题 + 全部居中」。白玻璃在深色主题下是一块刺眼白板，emoji 是彩色字体，与设置页 / 详情页的卡片不是同一语言。
- 现改为：浮层按 §3 走「描边 + 投影」（`--md-sys-color-surface-container-lowest` + `1px solid var(--border)` + `var(--md-sys-shape-corner-large)` + `var(--md-sys-elevation-3)`），文字走 `--text-1` / `--text-2`，深色主题自动跟随。
- 图标改用图标集的线性 SVG `IconWarn`（本次新增；页面不许手写 `<svg>`，见 `tools/icon-test.mjs`），颜色 `--text-2`；**警示色只留给确认按钮**。标题 `--text-md` / 600，正文 `--text-sm`（桌面 13px / 手机 14px，与 `.dock-confirm-text` 同一口径）。正文**不用 `--text-base`**：手机密度层把它抬到 15px（§3.8），超出本条要求的 13–14px。
- `confirmOk` 非危险支（无图标、单行正文）同一套令牌与排布。
- 危险按钮保持填充红（`var(--red)` 与 `color-mix(in srgb, var(--red) 35%, transparent)` 投影）；后者是 `tools/webview96-fallback-test.mjs` 已登记的装饰性站点，形态未改。

**反例（注入建在最终代码上；还原后 `md5sum -c` 逐字节一致）**：
- ① `confirm.tsx` 正文元素行尾加回 children 注释 → 护栏 exit 1，红点原文：
  `apps/desktop/src/lib/confirm.tsx:107  <div style={body}>{cur.msg}</div>`
- ② `DevPanel.tsx` 版本行还原为行尾 children 注释 → exit 1，红点原文：
  `apps/desktop/src/components/DevPanel.tsx:159  ong style={{ color: "#8ef0b0" }}>OneTHU dev</strong>`
- ③ 三元表达式容器收尾（`}` 型）→ exit 1，红点原文：
  `apps/desktop/src/components/DevPanel.tsx:189  <div style={{ color: "#5f6673" }}>（暂无）</div> : null}`
- ④ 模板串内部写 token-ok 块注释 → exit 0（不误报）
- ⑤ 行注释形态 `// token-ok` → exit 0（不误报）
- ⑥ 把白玻璃 `rgba(255,255,255,.62)` 加回 → `token-leak-test` exit 1，红点原文：
  `apps/desktop/src/lib/confirm.tsx  rgba(255,255,255,.62)：0 → 1`

**门禁四项（2026-10-05，本单元最终代码上）**：`pnpm guard` exit 0（链长 72，含新护栏）；`pnpm test` 23 项 23 通过；`apps/desktop && npx tsc --noEmit` 无输出；`docs-prose-lint` 21 份文档 0 违规。

**真机复核（K30 / WebView 96 / 本单元 dev 包，2026-10-05）**：产物 18776957 字节、md5 `a0661fd1e982264bcad9e81fe3ec4a75`，`install -r -d` 成功且 `firstInstallTime` 保留（数据未丢）。走查路径：冷启（`am force-stop` + `monkey`）→ 底栏「待办」→ 卡片上的「忽略这条作业」→ 弹窗；CDP 读 DOM 与取色（该机拒绝 `input tap`，走 `Runtime.evaluate` 的 `click()`）。弹窗正文逐字读数（浅深两档一致；深色样本的 `innerText` 在软换行处多插了一个空格）：

```
忽略这条作业，请确认！
确定要忽略《实践与思考题03【不计分】》吗？

忽略后它不再出现在作业区与日程提醒中，可在「全部作业 → 已忽略」恢复。
取消
确认忽略
```

读数：`token-ok` 不出现、正文不含 `/*`、卡片内 SVG 计数 1、无 emoji；卡片 353×207、圆角 12px。深色档 `cardBg=rgb(21,26,36)`、`border=1px solid rgba(255,255,255,.1)`、标题 `rgb(232,235,242)`/16px、正文 `rgb(163,171,184)`/**14px**；浅色档 `cardBg=rgb(255,247,250)`、`border=1px solid rgb(208,195,204)`、标题 `rgb(30,26,29)`、正文 `rgb(77,68,76)`/**14px**；遮罩走 scrim（深 `rgba(0,0,0,.62)` / 浅 `rgba(15,23,42,.45)`）；确认按钮为填充红（深 `rgb(255,115,111)`、浅 `rgb(229,72,77)`，文字 `on-primary`），取消按钮为中性面；点「取消」后 `.confirm-mask` 与 `.confirm-card` 计数归 0（无残留）。浅色档由 `cmd uimode night no` 制造，收尾已复原为开工前记录值 `yes`。
截图：深色与浅色各一张，落在仓库忽略目录 `.tmp-shots/`（`b41-a6-dark.png` / `b41-a6-light.png`）。**本单元的截图未经人眼复核**——本会话的图片读取能力不可用，上述逐字与取色全部来自 CDP 读数。

↩ **未取到项（原记「K30 未取到」，已于设备恢复后补齐）**：`offline` 由 `reconnect device` / `usb` / `kill-server` 后 `start-server` 均未解除，最终设备自行回到 `device`，无需人工授权。**仍未取到**：K90 与 PC（exe）两档截图。渲染级断言（`renderToStaticMarkup` 比对弹窗正文逐字相等）**不可行**：Node 无法直跑 `.tsx`（`Unknown file extension ".tsx"`），且仓库禁用新增依赖，故本单元以静态护栏 + 反例 + 真机 CDP 读数替代。

**另记（发现项，不在本单元范围内）**：`tools/motion-test.mjs` 在提交 `7712a68e`（本单元之前）上同样失败（`四档时长都在 1..600ms（实际 140）`）；它**不在 `pnpm guard` 链内**，与 `tools/motion-tokens-test.mjs` 职能重叠。本单元未改动它，也未改动 `motion.css` / `tokens.css`。

### 23.2 A5 · 四卡网格只许 1×4 / 2×2 / 4×1（提交 `9cd3b589`，代码 + 护栏）

**真机复现（改前，K30 / 393×822 / WebView 96）**：网络学堂页 `.stats` 实测 `cols="109.091px 109.091px 109.091px"`（**3 列**），四张卡排成 **3+1**（`rowTops=2`），且第 4 张卡的数字被裁切（`numClip=[false,false,false,true]`）。卡序为 未交作业 / 课程通知 / 课程文件 / DDL 提醒。

**成因两条**（都属于「列数交给浏览器算」）：
1. `.stats` 基座是 `repeat(auto-fit, minmax(150px, 1fr))`——中等可用宽度下 `auto-fit` 必然算出 3 列；
2. 手机档另有一条 `html.is-phone .stats:not(.stats-hero) { repeat(3) !important }`，与 ≤980 的两列、≤839.98 的单列 `!important` 三条规则互相打架，最终 3 列胜出。

**改法**：列数改成设计决定，退出 `auto-fit`。
- 通用 `.stats` 只给**单列安全默认**（同时接住入口卡在 412px 宽度下的单列通栏诉求，原先靠 ≤839.98 的 `!important` 承担）；
- 4 卡页显式挂 `.stats-quad`，三档显式断点：**≥840px → 1×4；360–839.98px → 2×2；<360px → 4×1**。没有 3 列分支，因此「刚好只放得下 3 张」的宽度只能落 2 列；
- 删掉手机档那条 `!important` 三列覆盖，以及 ≤980 的通用两列、≤839.98 的 `!important` 单列（后两条与新的三档分叉）。同时删除的手机版 `:has(> :only-child)` 单列规则已无必要（通用默认即单列，且 WebView 96 不支持 `:has()`，该规则在 K30 上本来就不生效）；
- 阈值来源：X=840 由真机量测得出（内容宽 ≈798px、单卡 ≈190px），并与本仓既有的手机/桌面断点 839.98 对齐；Y=360 取自 393px 上 2 列时单卡 ≈169px（3 列时仅 109px 且数字裁切）。轨道一律 `minmax(0, 1fr)`，不写死 px，卡片内部排版不动；
- **3 卡页与 hero 页各自保留显式预设**：`.stats-overview`（今日/首页概览，3 张）固定三列，`.stats-hero`（校园卡）固定两列；护栏断言两者不被 `.stats-quad` 选中。改动后仍用通用 `.stats` 的只有校园卡余额卡（1 张，落单列）。

**护栏 `tools/stats-grid-test.mjs`（已接进 `pnpm guard`）**：解析 `global.css` 后在**宽度轴模拟**实际落到的列数，断言：任意宽度只落 1/2/4 列；393→2、840→4、839→2、359→1；不存在落到 3 列的宽度；无 `auto-fit` / 无 `!important` / 不依赖 `:has()`（WebView 96 不支持）；两个 4 卡调用点确实挂了 `.stats-quad`。

**反例（注入建在最终代码上；还原后 `md5sum -c` 逐字节一致）**：
- ① 4 列档退回 `auto-fit minmax(150px,1fr)` → exit 1，红点原文：
  `✗ .stats-quad 出现非法列数 null（repeat(auto-fit, minmax(150px, 1fr))）——3 列是明令禁止的排布`
- ② 补一条 `@media (max-width: 700px) { .stats-quad { repeat(3) } }` → exit 1，红点原文：
  `✗ 存在落到 3 列的宽度（3+1 复发）`（同批还有 `✗ 393px（K30 真机口径）应落 2 列，实为 3`）
- ③ 恢复手机档 `!important` 三列覆盖 → exit 1：`✗ 手机档还在给通用 .stats 强制三列（3+1 复发）`
- ④ 删掉 4×1 那一档 → exit 1：`✗ 359px 应落 4×1，实为 2`
- ⑤ `Learn.tsx` 摘掉 `.stats-quad` → exit 1：`✗ apps/desktop/src/pages/Learn.tsx 的四卡网格未挂 .stats-quad`
- ⑥ 把 4 列阈值改到 900px → exit 1：`✗ 840px 应落 1×4，实为 2`（阈值被钉死，防止无意漂移）

**真机复核（改后，K30 / 393×822）**：`.stats stats-quad` 落 **2 列**（`cols="169.636px 169.636px"`）、`perRow=[2,2]`、单卡 170px（改前 109px）、`numClip` 与 `labelClip` 全为 `false`、`docScroll=false`。四张卡标签仍为 未交作业 / 课程通知 / 课程文件 / DDL 提醒。截图 `b42-learn-393.png`（落在 `.tmp-shots/`；**未经人眼复核**，本会话图片读取能力不可用，上述读数全部来自 CDP）。

**未取到项**：840 / 360 两档边界、K90 与 PC 三档**均未取到**——真机上造不出其它宽度：`wm size` 被 MIUI 拒绝（`SecurityException: Must hold permission android.permission.WRITE_SECURE_SETTINGS`），`settings put system user_rotation` 同样被拒（`WRITE_SETTINGS`），故旋转与改逻辑分辨率两条路都不通。这两档边界由护栏在宽度轴上模拟断言（值已钉死），真机只覆盖 393px 一档。

**流程教训（本单元踩到，记下来）**：**APK 构建期间不得跑 `pnpm guard`**。构建会把入库的 `gen/android` 软链临时指向真实安卓工程，而 `root-boundary-test` 恰好断言该软链等于入库占位值，两条命令并行时它必然误报（本单元出现过一次 `✗ gen/android 软链与入库值不一致`，构建结束、软链复位后 exit 0）。

### 23.3 A1 · 作业加载态改成与真实卡同几何的骨架卡（提交 `3b9da699`，代码 + 护栏）

**病根**：加载支渲染的是裸 `<Card><Empty text="正在取作业…" /></Card>`，而真身是 `.hw-card` 轮播（卡宽 `min(92%, 430px)`、高 168px、绝对居中于 `.hw-carousel`）。裸 `Card` 只按 `.tasks-flow-wrap` 的 flex 宽度铺开，与轮播卡没有任何几何关系——这就是霖看到的「页面左半侧一个白色矩形」。

**改法**：骨架卡**复用真卡同一条 class 链**，几何完全同源：
``.hw-carousel-row > .hw-carousel > .hw-card`（外加 `.is-skeleton` 只补内容，不碰宽高）``。
- 指示点轨道放**一枚占位点**：真卡轨道宽由「点宽 + 内边距」决定（实测 13px）、与点的数量无关；少了它卡宽会差十几像素，所以这一枚属于几何对齐的一部分；
- 卡内 4 条骨架条（课程 / 标题 / 截止），一律**百分比宽**（窄屏不溢出）；
- 文案「正在获取作业…」放在 `.hw-skeleton-note`，在卡内居中。

**护栏 `tools/hw-skeleton-test.mjs`（已接进 `pnpm guard`）**：断言加载支不得再渲染裸 `Card`；骨架必须复用那条 class 链且带指示点占位；骨架条一律百分比宽；文案在卡内且居中（`justify-content` 与 `align-items` 双 center）；`.is-skeleton` 不得自行声明宽高；`.hw-card` 的宽高口径全仓只有一处定义。

**反例（注入建在最终代码上；还原后 `md5sum -c` 逐字节一致）**：
- ① 加载支退回裸 `Card` → exit 1：`✗ 加载分支仍在渲染裸 <Card>（几何与真实卡无关）`
- ② 去掉指示点占位 → exit 1：`✗ 骨架卡缺少指示点占位（真卡轨道宽度由点宽决定，缺了卡宽会差十几像素）`
- ③ 骨架条写死 px 宽 → exit 1：`✗ 骨架条用了写死宽度 240（窄屏会溢出，应用百分比）`
- ④ `.is-skeleton` 自行声明 `height` → exit 1：`✗ .hw-card.is-skeleton 自行声明了宽高 —— 几何必须完全继承 .hw-card，否则与真实卡不再同源`
- ⑤ 删掉居中说明节点 → exit 1：`✗ 骨架卡缺少居中说明节点`
- ⑥ 骨架条只剩 1 条 → exit 1：`✗ 骨架条少于 2 条（需求允许 2–3 条：课程 / 标题 / 截止），实为 1`
- 说明：⑥ 首次注入只删了页脚两条、仍剩 2 条，护栏未红——当时判定「注入不到位」，改成只留 1 条后才红，红点原文如上。

**真机复核（K30 / 393×822 / 本单元 dev 包，18776957 字节、md5 `83d145a92dc70f4accc6f5488f1c29a1`）**：骨架卡只在**内存缓存为空的首帧**出现，实测**只可见约 290ms**（`sTicks=18` / `rTicks=359`，16ms 一拍），比 250ms 的轮询还短，因此改用 CDP 的 `Page.addScriptToEvaluateOnNewDocument` 在文档创建前注入观察器、在页面内贴着首帧采样。逐项差值（骨架 vs 随后真卡）：

| 项 | 骨架 | 真卡 | 差值 |
| --- | --- | --- | --- |
| computed width | 303.847px | 303.847px | 0.00px |
| computed height | 168px | 168px | 0.00px |
| offsetTop / offsetLeft | 111 / 165 | 111 / 165 | 0 / 0 |
| 圆角 | 16px | 16px | 相同 |
| 底色 | `rgb(21, 26, 36)` | `rgb(21, 26, 36)` | 相同 |
| 描边 | 1px | 1px | 相同 |
| `.hw-carousel` / `.hw-dots` 宽 | 330.273px / 13px | 330.273px / 13px | 相同 |

无横向滚动（`overflow=false`）；文案 `正在获取作业…`；骨架条实测 120.5 / 197.2 / 82.2 / 71.2px（均为百分比解析值，随宽度自适应）。**优于 ≤2px 口径（实际 0.00px）**。截图 `b43-skeleton-393.png`（骨架在场时抓取，第 13 拍触发）与 `b43-real-393.png`（真卡），落在 `.tmp-shots/`；**截图未经人眼复核**（本会话图片读取能力不可用），上述读数全部来自 CDP。

**口径偏差如实记**：`getBoundingClientRect()` 会被页面入场动画（`m-page-in` 的 `scale(.99)`）同比缩放，第一版采样正好落在动画里，量出 3.03px / 1.68px 的假差（四个量比值都是 0.9900）。改用 `getComputedStyle().width/height` 与 `offsetTop/offsetLeft`（不受祖先 transform 影响）后差值为 0；表中 `getBoundingClientRect` 的宽高同样为 303.85 / 168（该帧动画已结束）。

**方法论收获（可复用）**：采样瞬态 UI（首帧骨架、加载态）时，「轮询 + 截图」会漏掉——290ms 的窗口短于往返延迟。正确做法是 `Page.addScriptToEvaluateOnNewDocument` 注入观察器，在页面内按 16ms 采样并保留最后一份样本（自动跳过入场动画的缩放期）。

### 23.4 A3 + A4 · 列表行长按菜单矩阵统一与文件行瘦身（提交 `1318108a`，代码 + 护栏）

**霖的原话**：A3「课程通知项无法长按/右键，而且收藏的星星没有放进 ctxmenu」；A4「课程文件项的排版奇怪，中间放了个预览，左下角还有收藏的星星……在文件项的列表里，项应该保持尽量简洁，把重要的信息显示出来，预览、收藏两个按钮放进 ctxmenu」。

**改前现状（代码核对）**：作业行（`HomeworkRow`）早就有长按菜单（忽略 / 提醒 / 收藏）；**通知行（`NoticeRow`）完全没有长按**，只挂了一颗内联星标；文件行（`FileRow`）有长按菜单但只有「下载 / 在文件夹中显示」，行内另有「预览」按钮与左下角星标。

**改法**（同一个 `shared.tsx`，一次改完，避免同文件两处并行写）：
- 新增 `useRowCollect(atom)`：行内收藏的**唯一入口**，语义与列表星标同源（都读 `useFavs`）——已收录 → 「取消收藏」，就地从它所在的各收藏夹移除；未收录 → 「收藏」，打开 `CollectModal` 选夹（与页面级「收藏」同一模型，不是一键塞默认夹）；
- `NoticeRow`：接上与作业行同一套长按矩阵，菜单项 = 收藏 / 取消收藏；行内星标按 A4 的统一口径撤掉；
- `FileRow`：行内「预览」按钮与星标撤掉；菜单项序固定为 **预览 → 下载 →（在文件夹中显示）→ 收藏**（前三项是「对这个文件的操作」，收藏是原子操作，放最后）。

**护栏 `tools/row-menu-matrix-test.mjs`（已接进 `pnpm guard`）**：三行都必须接同一套长按矩阵；两个行不得再内联星标、文件行不得再有行内按钮；文件行菜单项序固定；通知行的收藏原子 `kind` 必须是 `notice`；`useRowCollect` 只许一处定义且必须读 `foldersContaining` / `toggleAtomIn`（防两行各写一份、语义分叉）。

**反例（注入建在最终代码上；还原后 `md5sum -c` 逐字节一致）**：
- ① 通知行摘掉长按 → exit 1：`✗ NoticeRow 没接长按（矩阵缺一行）`
- ② 文件行加回行内星标 → exit 1：`✗ FileRow 仍有行内星标（A4：收藏进 ctx 菜单）`
- ③ 菜单把预览挪到下载之后 → exit 1：`✗ FileRow 菜单项序：预览应在下载之前`
- ④ 通知行收藏 `kind` 改成 `file` → exit 1：`✗ NoticeRow 收藏原子的 kind 必须是 "notice"`
- ⑤ 通知行不渲染收藏弹层 → exit 1：`✗ NoticeRow 没有渲染收藏弹层（点了收藏没有反应）`
- ⑥ 收藏改成自建 state → exit 1：`✗ useRowCollect 没查「在哪些收藏夹里」（无法给出取消收藏）`

**真机复核（K30 / 393×822 / 本单元 dev 包，18776957 字节、md5 `9f8aff48433cd8ed5378b28bda1c2840`）**：长按用 CDP `Input.dispatchTouchEvent`（touchStart → 750ms → touchEnd，长按阈值 `LONG_PRESS_MS = 500`）。
- 通知列表 42 行：长按出菜单，`labels = ["收藏"]`；行内 `.collect-star` 与行内「预览」计数均为 **0**；
- 文件列表 88 行：长按出菜单，`labels = ["预览","下载","收藏"]`（Android 不显示「在文件夹中显示」，与既有口径一致）；行内星标与「预览」计数均为 **0**；
- **三种列表行高一致**：通知 105.4px / 文件 105.4px / 作业 105.4px（对应 A4 的「行高与其它列表项一致、对齐命中区」）；
- 收藏弹层可打开（`[aria-label="收藏到收藏夹"]` = true）。

**未取到项**：**收藏 ⇄ 取消收藏的真机闭环未取到**。该机收藏仓为空（`onethu.favs.v1 = {"v":1,"order":[],"folders":{}}`），弹层走空态；点空态里的「直接建一个」（`.collect-new-btn`）后没有生出收藏夹行，脚本拿不到可点的收藏夹，闭环在真机上走不完。「与列表状态同源」由护栏的结构断言（读 `foldersContaining` / `toggleAtomIn`，不许自建 state）支撑。测试期间对收藏仓的写操作已复原（脚本末步写回原值，复核 `folders = 0`）。

**PC 右键**：`useLongPress` 只绑触摸事件（`onTouchStart/Move/End`），三行同理。PC 端的 `contextmenu` 绑定是 §B5 的「A3-PC」条目，按霖「先只做移动端、PC 另起一批」的口径**本单元不做**。

### 23.5 A2 · 文件详情页预览 / 下载回归主体（提交 `9345703a`，代码 + 护栏）

**霖的原话**：「作业文件页面，下载 / 预览都是要放到一级菜单的高频功能，为什么到了二级菜单里？」

**改前**：`FileDetailPage` 的 `PageHead` menu = `[收藏, 预览, 下载]`——两个高频动作都在页头「…」里。对照口径：作业详情页的附件行本来就是内联按钮（预览 / 下载）。

**改法**：
- 页头下方新增一级动作行 `.detail-actions`：预览（`.btn-primary`）+ 下载（`.btn`），两枚按钮等分宽度；
- `PageHead` 的 menu 只留 `[收藏]`（低频项按 A4 留在菜单里）；
- 预览入口**全页唯一**，菜单里不留副本（对应需求书反例①「菜单里留一份、主体再加一份」）；
- 「未找到该文件」早返回分支不带动作行（那里没有可操作对象）。

**护栏 `tools/detail-actions-test.mjs`（已接进 `pnpm guard`）**：页头菜单不得再出现预览 / 下载；主体必须有 `.detail-actions` 且两项齐全、至少一个主按钮、不得混进收藏；作为**按钮文案**的「预览」全页恰好一处（注释里提到该词不算入口）；`.detail-actions` 与 `.detail-actions > .btn` 的 CSS 必须存在（flex 等分、间距走令牌）。

**反例（注入建在最终代码上；还原后 `md5sum -c` 逐字节一致）**：
- ① 菜单里再留一份「下载」 → exit 1：`✗ 页头菜单里仍有「下载」——A2：下载要回到主体，不能菜单里再留一份`
- ② 把收藏搬进主体动作行 → exit 1：`✗ .detail-actions 里混进了收藏——收藏是低频项，按 A4 应留在 ctx / 「…」菜单`
- ③ 动作行删掉「预览」 → exit 1：`✗ .detail-actions 里没有「预览」`（同批 3 条）
- ④ 动作行去掉主按钮 → exit 1：`✗ .detail-actions 里没有主按钮（「页头下方主按钮组」至少有一个 .btn-primary）`
- ⑤ 删掉 `.detail-actions > .btn` 等分规则 → exit 1：`✗ global.css 缺少 .detail-actions > .btn 规则（两个按钮应等分宽度）`

**真机复核（K30 / 393×822 / 本单元 dev 包，18776957 字节、md5 `abaf32f29ce52dbf8a632bf411f437de`）**：文件列表 → 点首个文件进详情页后，
`.detail-actions` 位于**首屏内**（top 137 / bottom 175，视口高 822），两枚按钮 `labels = ["预览","下载"]`、`class = ["btn btn-primary","btn"]`、均未禁用，中心点命中测试两枚皆为真（不展开任何菜单即可看到并点到）；页头「更多操作」菜单的 ctx 项 = `["收藏"]`（无预览 / 下载副本）；打开菜单前后，body 里作为按钮文案的 预览 / 下载 都恰好各一处。

---

### 23.6 本章小结（六条反馈的收口状态）

| 编号 | 条目 | 状态 | 提交 |
| --- | --- | --- | --- |
| A6 | 注释被当正文打印 + 预警框风格跑偏 | 已收口 | `881788ce` / `758f7f0b` |
| A5 | 四卡网格只许 1×4 / 2×2 / 4×1 | 已收口（393px 真机；840/360 两档为护栏模拟） | `9cd3b589` / `ccd1d03e` |
| A1 | 「正在取作业」加载态形状错误 | 已收口（首帧差值 0.00px） | `3b9da699` / `950b8cb0` |
| A3 | 通知行长按菜单 + 收藏进菜单 | 移动端已收口；**PC 右键见 §B5「A3-PC」**（等霖发话） | `1318108a` / `a50bc9b8` |
| A4 | 文件行瘦身 + 详情页按钮回归主体 | 已收口 | `1318108a` / `a50bc9b8` / `9345703a` |
| A2 | 文件详情页预览 / 下载回归主体 | 已收口 | `9345703a` / 本节 |

本轮新增护栏 4 支，均已接进 `pnpm guard`：`jsx-comment-leak-test`（A6）、`stats-grid-test`（A5）、`hw-skeleton-test`（A1）、`row-menu-matrix-test`（A3/A4）、`detail-actions-test`（A2）——共 5 支，guard 链长由 71 增至 76。

**本轮仍未取到（逐条）**：A6 的 K90 / PC 截图；A5 的 840 / 360 两档真机宽度（MIUI 拒 `wm size` 与 `settings put`）、K90 / PC 三档；A1 的 K90 / PC 两档；A3 的收藏 ⇄ 取消收藏真机闭环（该机收藏仓为空、空态建夹入口未生出收藏夹行）。截图一律未经人眼复核（本会话图片读取能力不可用），所有读数来自 CDP 与 DOM 实测。

## 24. P 批 · PC 专属（2026-10-05 开工，§8 全表）

> §8 的 12 条 + 4 处 M 批「PC 跟随」。按「同一处代码一起改」的原则分四组：
> **组 1 侧栏结构**（E2 + C15 + C11 + C12 + D6 + B5 + F2）→ **组 2 视觉与输入**（C13 + C14 + D8）
> → **组 3 右键绑定**（A3-PC + §2）→ **组 4 M 批跟随**（C1 + C5 + §6/E9-PC）。
> 组内顺序：先 E2+C15（结构，返工风险最大），再 C11/C12/D6/B5（同一处 CSS/动画），F2 可随时插。

**前置三项（已完成）**：
1. **PC 走查链路**：本机自建 exe（`cargo-xwin` + `--features tauri/custom-protocol`，产物 19,649,536 字节；按 §3.3 校验 `/assets/` 18 处、`dist` 资源逐个命中，**无 dev 面板 = prod 模式**），启动时带 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`，**WSL 可直接连 `127.0.0.1:9222`**（WebView2 = Edge 154 / Chromium 现代引擎，后续还可用 `Emulation.setDeviceMetricsOverride` 造宽度）。窗口 1240×820（与 b33 先例一致）。
2. **选课季数据源（§9.2）**：`packages/core/src/info/types.ts` 的 `DeadlineItem` 注释写明「title = 倒计时标题（**选课 / 退课** / 推研等学期重要节点），begin/end = 起止时间」，首页「日程与提醒」与 `useTodayDeadlines` 取的正是它（`infoHelper.getCrTimetable()`）。**校历只有学期边界、没有选课 stage**（`state/data.ts` 已注明），故按 §9.2 不做第二数据源猜测、**不写死日期表**。
3. **新护栏** `tools/sidebar-ia-test.mjs`（§9.3 四条）已接进 `pnpm guard`（链长 76 → 77）。

### 24.1 P1 · 侧栏消费注册表 + 常驻 / 更多 / 选课季（提交 `8e6e2e78`，E2 + C15）

**改前现状**：侧栏条目写死在 `Layout.tsx` 的 `NAV` 数组（14 项），只有**分区**取自注册表；`state/navigation.ts` 的 `NAV_REGISTRY` 里没有今日 / 待办 / 预约页 / 生活页 / 设置 / 信息门户这六个入口。这就是「侧栏与注册表、移动端三方各说各话」的根因。

**改法**：
- 注册表补 6 个条目（今日 / 待办 / 预约 / 生活 / 设置 / 信息），统一挂新档 `visibility: "primary"`——**只服务侧栏与抽屉**，不进服务页目录（`byCategory`）也不进命令面板（`matchNavQuery`），那两处的成员与顺序与改造前**逐条一致**（避免波及 ServicesPage 与命令面板）；
- `NavEntry` 新增 `sidebar: "pin" | "more"` 两档与 `xkSeasonPin` 提升位，导出 `sidebarPinned()` / `sidebarMore()`——**常驻与「更多」来自同一处定义**；
- `Layout.tsx` 删除手写数组：`NAV` 改为注册表派生（只留「id → 图标」映射与「待办」的高亮扩展——视图层，不是 IA）；`navCategoryOf` 去掉今日 / 待办的硬编码特判（已入表，归「总览」）；
- 侧栏结构 = **常驻（扁平、不插分区小标题）→ 收藏夹分组 → 「更多」折叠区（保留原分组标签、展开态持久化、默认收起）→ 钉底设置**；
- `schedule` 的 `name` 由「课表」改为「日程」，与 `PAGE_TITLES.schedule` 对齐（`keywords` 仍含「课表」，搜索不受影响）；
- 新增 `state/xkSeason.ts`：`isXkSeason(items, now)` 纯函数 + `useXkSeason()`；每分钟复核、跨天失效；**仅桌面侧栏可见时**按需拉一次（移动端不因这条判定多发请求）；取不到数据即不常驻。`data.ts` 相应导出 `cachedDeadlines()` / `ensureDeadlines()`（`useTodayDeadlines` 改用后者，行为不变）。

**护栏 `tools/sidebar-ia-test.mjs`**：①侧栏不再手写条目清单（只查 `navContent` 之后那段——底栏 5 项是移动端另一套 IA，明示放行）；②两档同源（都按注册表 `sidebar` 字段过滤，且不许另写名单常量）；③选课季判定有前置兜底（取不到 → false）与末尾兜底、每分钟复核、不写死日期，且 `zhjwxk` 挂上了 `xkSeasonPin`；④「更多」展开态持久化 + `aria-expanded`。

**反例（注入建在最终代码上；还原后 `md5sum -c` 逐字节一致）**：
- ① 侧栏手写一条入口 → exit 1：`✗ 侧栏里仍有 1 处手写导航条目（{ page, label } 字面量）` + `✗ Layout.tsx 仍手写文案「寻迹」`
- ② 两档改按 `visibility === "core"` 过滤 → exit 1：`✗ 两档没有分别按注册表 sidebar 字段过滤（不是同一处定义）`
- ③ 另写一份常驻名单常量 → exit 1：`✗ 注册表里另有手写的常驻/更多名单常量（应只有 sidebar 字段这一处定义）`
- ④ 删掉末尾兜底 → exit 1：`✗ 判定缺少末尾兜底 return false（遍历完没有命中阶段时必须落 false）`
- ⑤ 判定里写死日期 → exit 1：`✗ 判定写死了日期（§9.2 明令不得写死日期表）`
- ⑥ 摘掉 `xkSeasonPin` → exit 1：`✗ 注册表里 zhjwxk 没有 xkSeasonPin（选课季不会升到常驻）`
- ⑦ 「更多」不写回 localStorage → exit 1：`✗ 「更多」展开态没有写回 localStorage`

**PC 走查（自建 exe，WebView2 / Edge 154，1240×820，md5 `360ed27f00e6537ede55ec8f4531312b`）**：
- 常驻 = **今日 / 待办 / 网络学堂 / 日程 / 预约 / 生活**（顺序与 §9.1 逐条一致；扁平、无分区小标题，唯一的 `nav-label` 是「收藏夹」）；
- 「更多」默认收起（`aria-expanded=false`，body 不渲染）→ 点击展开后 `labels = ["学习","日程","行政"]`、`items = 信息 / 选课 / 寻迹 / 邮箱 / 云盘 / 在线服务 / Thubook / 其他 Info 应用`（与 §9.1 的 8 项逐条一致）；
- 展开态刷新后仍展开、再收起后刷新仍收起（持久化双向）；
- 收藏夹分组与钉底「设置」位置不变；侧栏宽度 224px 不变。

**未取到项**：
- §9.3 DoD 的「把时间 mock 到选课季」**未取到**——CR 倒计时缓存是模块级内存缓存，无法从外部注入选课季数据；本轮以护栏的结构断言（`sidebarPinned(xk)` 提升逻辑 + `zhjwxk` 的 xkSeasonPin）代替，非选课季的 PC 读数（选课在「更多」里）已取到。
- **K30 抽屉未复验**：抽屉与侧栏共用 `navContent()`，本次只做了 PC 走查；移动端抽屉的同一套 IA 待下个单元出包时一并读数。
- 本轮 exe 构建一并补生成了 `src-tauri/gen/schemas`（b40 的系统夜间模式权限早已在 Rust 侧、提交里的 schema 落后于源码），随 `8e6e2e78` 一并入库。

#### ↩ 返修（霖 2026-10-05 走查 P1 的三条反馈，提交 `5b56a39c`；第 2 条另立单元）

**反馈 1 · 展开「更多」后一排按钮明显变矮、整体向上突变**（已修）。
根因：侧栏 `.nav` 是 flex 列，而 `.nav-item` 只写了 `height: 32px`、**没有 `flex: none`** —— 内容超出可用高度时 flex 收缩先把条目压扁，溢出没有走到 `.nav` 的滚动。PC 实测（1240×820）：「更多」一展开，条目高度由 **32px → 19px**（`itemH [32,19]`），而 `navScroll 758 > navClient 655` 说明溢出确实存在。修法：`.nav` 的直接子项与两个折叠体的子项一律 `flex: none`，溢出交给 `.nav` 自己滚。修后同一场景 `itemH [32]`（18 条全 32px）、`navScroll 798 > navClient 655`。
护栏：`tools/sidebar-ia-test.mjs` 增「侧栏条目必须有 flex:none」；反例（删掉该规则）→ exit 1，红点「✗ 侧栏条目缺少 flex: none（内容超高时会被压扁）」。

**反馈 3 · 日程与预约图标重复**（已修）。
根因是图标集里 `IconSchedule` 与 `IconCalendar` 的 SVG 路径**逐字节相同**（历史复制粘贴），而预约当时映射到 `IconCalendar`。修法：`IconCalendar` 改成「日历 + 当天标记」（校历语义更准），与 `IconSchedule` 的纯网格日历区分；新增 `IconReserve`「座位」（图书馆座位 / 研讨间 / 空教室 / 体育 / 公共空间都是订一个位置），预约改用它。
护栏：`tools/icon-test.mjs` 增**图标体去重**（逐个 `export const IconX = (p) => (<svg {...base(p)}>…)` 的图形做比对）；反例（把 `IconCalendar` 还原成与 `IconSchedule` 相同）→ exit 1，红点「✗ 图标 IconCalendar 与 IconSchedule 的图形完全相同（并排显示会同形）」。这条是可推广的一类：复制粘贴出来的同形图标肉眼看不出来，必须机器比。
PC 复核：`iconSchedule` 为 rect + 日历网格线、`iconReserve` 为座位三段路径，同形判定 false。

**反馈 2 · 拖拽排位（「更多」⇄ 常驻）** —— **另立单元，本轮未做**。设计已定，见 §24.2 之前的说明；要点：用 Pointer Events 做 1:1 直接操控（**不用** HTML5 拖放：无触摸支持、不可 1:1、不可样式化），拖拽过程不加任何缓动，**只有落位那一下**用既有令牌动效（`--ease-spring` / `--dur-2`，UI 动效 < 300ms）；落位结果作为**本地偏好覆盖**写入 localStorage（§9.3 允许「本地偏好表达」），默认档位仍来自注册表，因此不产生第二份清单；`prefers-reduced-motion` 下取消落位补间；键盘路径（Alt+↑/↓）与 `Esc` 取消一并做。

### 24.2 拖拽排位：「更多」⇄ 常驻（提交 `82279185`，霖反馈 2）

**需求**：能直接把条目从「更多」拖进常驻，也能从常驻拖进「更多」。

**落位结果怎么存**：作为**本地偏好覆盖**（`state/sidebarPrefs.ts`，key `onethu.sidebar.prefs.v1`），默认档位与次序仍来自注册表——§9.3 的「本地偏好表达」正是这个位置，因此护栏 ①「侧栏无手写条目清单」继续成立。合成规则：档位 = 用户覆盖 ?? 注册表默认；次序 = 用户次序优先、未排过的按注册表次序跟在后面。落位写**完整**扁平次序（只写被拖那一项的 tier 覆盖，其余项继续跟随注册表默认，注册表日后改默认档仍能生效）。

**动效决策（按 `animate-expo` 的原则搬到 Web/WebView；本项目无 RN/Reanimated 且禁加依赖）**：
- **门禁**：排位属「偶尔发生」→ 允许标准动效；**拖拽过程本身不动画**（1:1 直接操控，全程零缓动），**只有落位那一下会动**。
- **用途**：spatial consistency（东西放到哪里去了）+ 防止突兀变化。
- **工具**：Pointer Events + `setPointerCapture`（禁 HTML5 拖放：不支持触摸、不能 1:1、不可样式化）；落位补间用 CSS transition，曲线与时长走仓库既有令牌 `--ease-spring` / `--dur-2`（200ms < 300ms）。
- **属性**：只动 `transform` / `opacity`；落点指示线走 `opacity`（不碰宽高，避免每帧重排）。
- **"动画留在 UI 线程"的 Web 等价物**：逐帧只写 DOM（`style.transform` / `classList`），**拖拽期间一次 React 渲染都没有**（连「正在拖」都用类名而不是 state）。
- **中断**：拖拽中可随时反向；Esc 取消；指针滑出窗口也收尾。
- **无障碍等价路径**：Alt+↑/↓ 档内移动、到边界即跨档，走同一条 commit 通路。
- **触感**：落位发一次 `haptic("tick")`（老机型按 b29 规则静默），与视觉同帧。
- **reduced motion**：跳过落位补间（位移保留）。
- **文本缩放**：落点判定逐帧实测 `getBoundingClientRect`，不写死行高（手机密度层会改字号）。

**触屏范围（明示）**：只在 `(hover:hover) and (pointer:fine)` 下接管 `touch-action`，**触屏不参与排位**——否则纵向拖动会被拖拽接管、抽屉滚不动。触屏的等价路径（长按进入拖拽）留给后续单元。

**护栏 `tools/sidebar-ia-test.mjs` 增 11 条**：Pointer Events + 捕获指针、禁 HTML5 拖放、逐帧段必须实测 rect、**逐帧段不许出现 setState/setDraggingId**、逐帧直接写 transform、reduced-motion 分支、落位触感、Esc 取消、偏好模块必须读注册表默认档且不许写死条目 id、持久化 key、落位补间只许动 transform、落点指示线只许动 opacity。

**反例**：
- ① 逐帧段加一次 `setDraggingId` → exit 1：`✗ 逐帧部分改了 React 状态（会每帧重渲染）`
- ② 改用 HTML5 拖放（`draggable`） → exit 1：`✗ 用了 HTML5 拖放（不支持触摸、不能 1:1、不可样式化）`
- ③ 落点判定写死行高 → exit 1：`✗ 落点判定未在逐帧段实测 rect（行高不能写死：手机密度层会改字号）`

**PC 走查（自建 exe，md5 `0670b7a7b4c634413be7ab9d46298378`，Edge 154 / 1240×820，用 CDP `Input.dispatchMouseEvent` 合成真实指针拖拽）**：
- **更多 → 常驻**：把「信息」拖到常驻「生活」处 → 常驻多一项、`moreCount` 8 → 7、order 里出现 `P:info`，prefs = `{"tier":{"info":"pin"},"order":[…]}`；
- **常驻 → 更多**：把「生活」拖到「邮箱」之后 → 常驻 6 → 5、更多回到 8，prefs 增 `"life":"more"`；
- **档内重排**：更多里「寻迹」拖到「邮箱」之后 → 次序变化，tier 只记被拖项；
- 刷新页面后次序与偏好**完全保持**；测试痕迹已清除（prefs 置空后回到默认排布）。

**未取到**：触屏拖拽（本轮明确不做）、iPad/触摸板之外的指针形态、以及"手感"本身——按 `animate-expo` 的口径，手感只能在**最慢设备上判**：本项要到 K30（WebView 96）上真机走查才算数，本轮只做了 PC；K30 走查随下一个出包单元补。

#### ↩ 返修（霖 2026-10-05 对拖拽的三条反馈，提交 `6fe80f70`；①②③ 一并做完）

**反馈 1 · 预览要"先排列、再落下"**（原实现是一条蓝色横线，看不出松手后各项停在哪）。
改法：**预览就是最终状态**——不另做一套动画。
- 落点由"某行之前/之后"改为**插入序号**（指针 Y 越过多少行的中点）；掉头、跨档、档内重排、空分类区都是同一个数字。
- 拖动期间用**临时偏好**（`navPreview`）顶替真值喂给同一个 `resolveSidebar`，于是"假如现在松手"的两档立刻算出来；每次序号变化时 `captureTops() → setState → playFlip()`，下面的项就用既有 FLIP 补间到新位置（`--dur-2` / `--ease-spring`）。
- **松手只是把它落库**：PC 实测未松手时的次序与松手后**完全一致**（`PREVIEW_EQ_FINAL=true`）。
- 蓝色指示线删除；被拖行 1:1 跟手（每帧按"当前布局顶"反推，预览重排也不会跳）。
- 逐帧仍然只写被拖行的 `transform`；React 渲染只发生在"序号跨过一个中点"的几次。

**反馈 3 · 空分类的标签要在拖拽时浮现**：拖拽进行中把「更多」的**全部**分类标签都摆出来（含当前为空的），不拖时仍只显示非空分类——所以"只含一项的分类"被拖空之后，用户拖回来时看得到该往哪儿放（标签不占扁平次序，只提供位置；项属于哪个分类仍由注册表 category 决定）。

**反馈 2 · 收藏也加上**：收藏夹行接同一套拖拽，但**独立作用域**（`scope="favs"`）——只在本组内重排，不能拖进常驻/更多（两类不同的东西）。落位用 `favs.moveRoot(id, ±1)` 逐格实现成收藏仓里的真实次序，因此与收藏夹页天然一致。**拖到「已折叠收藏夹（N）」上即折叠**（霖 2026-10-05 定），落点有可见反馈（`.nav-folded-toggle.is-drop-target`）。

**触屏**：按霖的说明（手机是底栏、没有侧边栏）**不做**，并从"未取到"改为"不做"。

**修掉的一个真缺陷（本轮取证时发现）**：跨档预览会让 React 把那一行从「更多」体挪到常驻体（key 由 `m-x` 变 `d-x`），**节点被重建**，被拖行的 `is-dragging`/transform 随之丢失、此后不再跟手。改法：逐帧按 `[data-nav-id][data-nav-scope]` **重新取当前节点**，并在预览重排后用 `reassert()` 贴回类与 transform。

**护栏 `tools/sidebar-ia-test.mjs` 更新**：旧断言"落点指示线走 opacity"改为——蓝线类已彻底移除、`.nav-folded-toggle.is-drop-target` 存在、`MORE_CATS` 与 `drag.dragging` 门控（空分类只在拖拽期出现）、收藏夹行接了 `rowProps(id, "favs")` 且落位写回 `moveRoot`、**预览与落位复用同一个 `prefsAfterInsert`**（保证"预览＝最终状态"）。逐帧段不许 setState 等原断言继续保留。

**反例**：① 拖拽期不摆空分类标签 → exit 1（`✗ 「更多」没有在拖拽期摆出空分类落点（反馈 3）`）；② 收藏夹行摘掉拖拽 → exit 1（`✗ 收藏夹行没接拖拽（反馈 2）`）；③ 逐帧段加 `setDraggingId` → exit 1；④ 落点判定写死行高 → exit 1；⑤ 换 HTML5 拖放 → exit 1。还原后 md5 逐字节一致。

**PC 走查（自建 exe，Edge 154 / 1240×820，CDP 合成指针）**：把"更多"里的「信息」向常驻区拖动，
- **未松手**时次序已变为 `…P:reserve P:info P:life | M:zhjwxk…`（信息已经排进常驻）；
- 松手后次序与未松手时**逐项一致**，`prefs` 落库（`PERSISTED=true`）；测试痕迹已清除。

**已知未完成（如实，随 `6fe80f70` 一起记）**：
- 跨档预览会让 React 重建那一行的 DOM 节点（key 由 `m-x` 变 `d-x`），被拖行的 `is-dragging` 与
  `transform` 随之丢失。已加「逐帧按 id 重取节点 + 重排后 `reassert()`」的修法，但**未取到它生效的证据**：
  未松手时的快照仍是 `dragging=false`。所以"跨越档位后是否全程连续跟手"留待下轮做逐帧取证后再判定。
- 收藏夹拖拽（反馈 2）只做了代码与护栏断言，**未单独做 PC 合成拖拽取证**；「拖到已折叠组上折叠」
  同样只有代码与样式，未取证。

#### ↩ 返修二（霖实测三症状，提交 `c7fcce5d`；拖拽定稿为「零渲染 + 冻结几何」）

**霖实测**：拖上去卡死在最后两个位置来回换；拖拽特效没了；拖上面的项只能向上不能向下，向下时突然位移一截、此后鼠标每下滑一次就再突变一个固定距离。

**根因两条**（都在上一版「预览走 React 重排」上）：
1. 预览改临时偏好 → `setState` → 跨档时那一行的 key 由 `m-x` 变 `d-x`，**节点被重建**：`is-dragging` 随旧节点消失；此后 `transform` 写在已分离的旧节点上（"卡住不跟手"）；每帧公式里的 `curTy` 与新节点实际状态不一致 → 每跨一次累积一个固定位移（"突变一截"）。
2. 落点按重排后的**活几何**算，与自己的重排构成反馈环 → 序号在最后两格来回翻（"卡死来回换"）。

**定稿改法**：
- **拖拽期间一次 React 渲染都不做**：让位空隙由 hook 直接写 peer 行的 `transform`；被拖行只挂 `.is-dragging` 与自己的 `transform`，节点永不重建。
- **落点用拖拽开始时冻结的几何**（`slots` 快照）判中线 → 序号不可能抖动。
- 空分类标签改为**始终渲染 + `is-empty`**，由 `.nav.is-dragging-nav` 纯 CSS 门控浮现（反馈 3 口径不变）。
- 只有落位那一下动：落位先按**视觉位置**记 FLIP 基准 → 撤掉全部临时 transform → 落库 → `playFlip` 补间就位。

**逐帧取证（自建 exe md5 `e447023d4a4e020261dc321801c8267f`，Edge 154 / 1240×820，CDP 合成指针）**：

| 用例 | 跟手最大偏差 | 序号单调 | 拖拽期特效与零重排 | 落位 |
| --- | --- | --- | --- | --- |
| 「更多」的 info 向上 15 步 | **0px**（每步 want == got） | true | true | 停在常驻/更多边界处，落库 true |
| 常驻的 today 向下 12 步 | **0px** | true | true | 落到常驻末位（与预览一致），落库 true |

```
DRAG info dir=-1 steps=15 | 跟手最大偏差=0px | 序号单调=true | 拖拽期特效与零重排=true | 已落库=true
  轨迹: y=512(want 496/got 496) · y=470(454/454) · y=428(412/412) · y=386(370/370) · y=344(328/328)
```

⇒ 「不跟手」「特效丢失」「最后两格来回跳」「只能向上不能向下」四个现象均不再出现。

**仍未取到**：收藏夹拖拽与「拖到已折叠组上折叠」的 PC 合成取证（只有代码与护栏断言）；K30 手感（手机无侧边栏，本项不需要）。

#### ↩ 返修三（霖反馈：让位压字 / 不该动的也动，提交 `c595c01e`）

**霖反馈**：① 拖拽后分类标签文字不会动，固定栏的项直接压到「收藏夹」三个字上；② 「更多」里的项，即便没打算往其中拖拽，里面每个分类的项也向下让位，并压到下一个分类标签上。

**根因**：上一版让位**只挪同作用域的行**，分类标签 / 分隔线 / 「更多」开关 / 设置这些结构元素一个都不动 → 被让位的行必然压到下面的标签；且让位位置由"落库序号"反推，与该在哪儿让位脱钩。

**改法**：让位序列改为**侧栏里全部列表元素**（`.nav .nav-item` + `.nav .nav-label` + `.nav .nav-sep`），边界及其之后整体下移；边界改为**按指针位置找**（第一个"中线在指针之下"的元素），落库序号改为"边界之前有多少同作用域的行"，两边天然一致。

**PC 取证（自建 exe md5 `f2265ca18e5adcafcefde2efedacb5b2`，把常驻第 3 项 `learn` 向下拖 6 步 / 72px）**：
- 「收藏夹」标签顶 `312 → 345`（+33px = 正好一行），落位后回到 `312` ⇒ 标签跟着走，压字根因消除；
- 让位序列 20 个元素同步下移 33px；前两步**相邻元素两两不重叠（重叠数 0）**；落位结果 `learn` 落到 `life` 之后，与拖拽方向一致。

**已知残留（如实）**：后四步采样里**重叠数 = 1**（仍有一对相邻元素交叠 >2px），本轮未定位到具体是哪一对（候选：跨「更多」容器边界的元素对——容器自身不在让位序列里，其子元素在）；另「整条尾巴一起下移」是"腾位置"模型的设计结果，若霖希望**只在指针所在的分区内腾位置**，需要另立口径。

#### ↩ 返修四（霖反馈：原位留空白 / 今日预览乱动，提交 `3fa80fcc`）

**霖反馈**：① 挪开一项之后，其原位仍留一块空白；② 今日项在预览时也会跟着运动，放下后又回归第一位。

**根因（同一条）**：上一版让位是"边界之后整体下移"——被拖项的**原位没人去填**（留空白），**尾巴全动**（把「更多」内容一起推走），**锚点（今日）**也在其中被推走。

**改法**：
- 让位只动**起点 → 落点之间的元素**：向下拖时区间内各项上移一格（正好填掉原位），向上拖时区间内下移一格（在落点腾位置），区间之外不动；
- **锚点（今日）永不让位**，让位边界不得越过它；锚点行也不参与拖拽（pointerdown 直接返回）。

**护栏**：新增 2 条——让位必须按「起点→落点」区间做（禁止"边界之后整体下移"）、锚点必须在 hook 与 Layout 两侧都排除。`tsc` 干净、护栏绿。

**未取证（如实）**：本轮 exe 构建链因路径写错（`../tools/...`）中断，**产物没有更新**（md5 与上一轮同为 `f2265ca18e5adcafcefde2efedacb5b2`），所以"原位不再留空白"与"今日预览不动"这两条**没有新包上的逐帧证据**。

**已知残留与修法建议**：让位区间**跨「更多」容器边界**时，容器自身不在让位序列里（其子元素在）→ 会出现两个大缝与 1 对相邻元素重叠。建议下一单元把两档渲染到**同一个父容器**下（平铺 + 「更多」体用 CSS 收起），让让位成为同一父容器内的连续区间位移，从根上消掉这条容器缝。

#### ↩ 返修五（霖反馈 1/2 关闭 + 容器缝根除，提交 `e44c3666`）

**霖反馈**：① 挪开一项后其原位仍留空白；② 今日在预览里也跟着动、放下又回第一位。

**上一轮的改法**（让位只动「起点→落点」区间 + 今日作锚点不让位）让小范围拖拽正确，但**跨「更多」容器边界**时仍会"多一条大缝 + 一对元素重叠"——容器自身不在让位序列里，缝漏不出容器。

**本轮根治**：「更多」区**平铺成 `.nav` 的直接子元素**（不再套 `.nav-folded-body.nav-more-body`），收起态逐个 `.nav > .is-hidden` 隐藏；让位序列改为 **`.nav > *`**——含内部滚动的容器（「收藏夹」段）整体算一个元素，让位边界永不落进容器内部。

**逐帧取证（自建 exe md5 `121de8d510eabc4d635a88f02d798cf6`，Edge 154 / 1240×820，CDP 合成指针；度量已排除被拖行本身——拖动中它压着邻行属正常）**：

| 用例 | 每一步重叠 | 每一步大缝 | 今日 top |
| --- | --- | --- | --- |
| 常驻 `learn` 向下 6 步 | `0` | `1` | 恒 114 |
| 「更多」`info` 向上 10 步（跨档） | `0` | `1` | 恒 114 |

```
BASE todayTop=114 重叠=0 大缝=0
learn 向下 6 步  → 判定: 最大重叠=0；大缝 != 1 的步 = 无
info  向上 10 步 → 判定: 最大重叠=0；大缝 != 1 的步 = 无
ANCHOR_DRAG 试图拖今日: dragging=false（锚点不可拖）
```

⇒ 反馈 ①、② 与上一轮记的残留（容器缝 / 重叠 1 对）**全部关闭**。

**度量修正（记一笔）**：上一版的探针把**被拖行本身**也算进了重叠/缝隙统计，拖动中它必然压着邻行，于是"重叠=1"被误当成缺陷；本轮把 `.is-dragging` 所属行排除后再量。

#### ↩ 返修六（收藏夹拖拽与折叠落点取证，提交 `3a0e8757`）

把让位序列统一为 `.nav > *` 之后，**收藏夹重排失效**——收藏夹行在 `.nav-folders-scroll` 容器内部、不在直接子元素序列里，让位边界永远落在"容器"这个整体上（拖一格不生效）。

**改法**：让位序列**按作用域取**——`nav`（侧栏条目）用 `.nav > *`（容器整体算一个，边界不落进容器内部，不漏缝；「更多」区已平铺）；`favs`（收藏夹）用**组内各夹行**（互为兄弟，直接在容器内互让；容器高度不变，不需要外部让位）。

**PC 取证（自建 exe md5 `fabca0f2adce8a6af4f8449271f3b670`，Edge 154 / 1240×820，CDP 合成指针）**：

| 用例 | 结果 |
| --- | --- |
| 收藏夹重排（首个夹拖到第二个之下） | 可见次序 `[A,B,C,D] → [B,A,C,D]` **生效**；拖拽中 DOM 次序不变（零重排） |
| 拖到「已折叠收藏夹」上即折叠 | 落点高亮 `true`、该夹从可见列表消失、`foldedRoots` 含它 **生效** |
| 侧栏让位回归 | info 向上 10 步：每一步 重叠 `0` / 大缝 `1`，`todayTop` 恒 `114` **无回归** |
| 测试痕迹 | 收藏仓按原值写回（4 个夹全部回到 `foldedRoots`）**已复原** |

**口径说明**：该机收藏夹原本全部处于已折叠状态，取证前临时展开（直接写 localStorage 的 `foldedRoots=[]`），结束后原样写回。

### 24.3 P2 · 侧栏伸缩（提交 `eab86cc6`，C11 + C12 + D6；B5 判定为已关闭）

**C11 折叠钮位置跳走**：实测展开态按钮 `(18, 780)` → 折叠态 `(x23, 752)`，**上跳 28px**。根因是折叠态把 `.sidebar-foot` 折成竖排 + 改了左右内边距（10 → 8px），按钮为避让「· 就绪」而上移。改法：**折叠态不再改 foot 的排布方向与内边距**，徽标只留圆点（`font-size: 0`）——按钮两态完全同位。

**C12 展开抽搐 / D6 伸缩舒张**：
- 伸缩过渡改走令牌（`grid-template-columns var(--dur-3) var(--ease-ios)`；原来硬编码 `0.18s ease`）；
- 侧栏 `overflow: hidden`：过渡期间裁剪内容 → 「作为遮罩逐渐展开」，而不是内容被挤着重排；
- 新增 `is-animating` 相位（点击时挂上、约 220ms 后摘掉）：**过渡期间不出文字**，过半后整行一次性出现（此前整行文字会在窄栏里被挤成一列）；
- 图标切换加 `transform var(--dur-2) var(--ease-spring)`（只动 transform/opacity）；
- `prefers-reduced-motion` 下直接切、不做相位。

**B5 · PC 收藏夹高度异常 → 判定为已关闭（不改代码）**：侧栏每一类行实测均为 **32px**、内边距同为 `0 26px 0 8px`——普通项 32 / 收藏夹行（临时展开收藏夹后测）32 / 已折叠组行 `[32,32,32,32]`。该条的病因是 flex 收缩把行压矮，已由 P1 返修的 `.nav > * { flex: none }` 一并解决，故本单元不改代码、只记读数。

**PC 取证（自建 exe md5 `b4e8e4f5bfdb2c29af050d28ead99e72`，Edge 154 / 1240×820）**：

| 项 | 读数 |
| --- | --- |
| 折叠钮（展开 / 折叠） | `(18,780)` / `(18,780)` → **Δ=0px**（原 28px）；再展开仍 `(18,780)` |
| 伸缩过程宽度样本 | `[187,128,102,87,78,74,72,…]` → **7 个中间态**（确实在动） |
| 过渡期间标签 | `display: none`（不被挤成一列）→ 稳定后 `block`（整行一次出现） |
| 图标过渡属性 | `color, transform` |

**护栏新增 6 条**：折叠态不许改 foot 排布方向 / 内边距、伸缩必须走 `--dur-3`/`--ease-ios`、必须有 `is-animating` 文字相位且做 reduced-motion 分支、图标过渡必须含 transform。

#### ↩ 返修七（霖实测四条拖拽反馈，提交 `c9614965`）

**反馈 1「更多里的项拖上去之后拖不回去（自动弹回）」**：落档归属比较了**不同量纲**——`moreFrom` 是"让位序列里的位置"（含分类标签/开关，实测 12~15），而当时拿 `lastIndex`（**行数**，最大≈14）去比，于是永远判成 `pin`。改为记录序列边界位 `lastBi`、与 `moreFrom` 同量纲比较。
取证：向下拖 `bi:18 ≥ moreFrom:11` → 落库 `{"tier":{"info":"more"}}` → 行带 `data-more`（回到「更多」）；向上拖 `bi:1` → `pin`（进入常驻）——双向都正确。

**反馈 2「收藏栏无法拖拽排序」**：折叠组（「已折叠收藏夹」展开后的行）此前**没有拖拽 props**（实测 `foldedDraggable: []`），只有未展开的行可拖；且 `applyRootOrder` 假设入参是全局次序。改法：折叠行接 `scope="favs-folded"`；`applyRootOrder` 改为**子集感知**（先算全局目标次序——子集槽位不变、把新次序依次填回，再用 `moveRoot(id, ±1)` 逐格实现）。
取证：拖动折叠组第一行到第二行之下 → 折叠次序由 `[A,B,…]` 变为 `[B,A,…]`。

**反馈 3「应只浮现被拖项所属的那个分类名，而不是所有已消失的分类」**：此前**所有**空分类标签都浮现（拖「选课」时「学习」与「日程」一起冒出来）。改法：行与标签都挂 `data-nav-cat`，拖拽开始时只给**被拖项所属分类**的标签挂 `is-revealed`（CSS 门控），不再用"拖拽中"这个全局开关。
取证：拖 `info`（学习）时可见空标签 = `["学习"]`，「日程」保持隐藏。

**反馈 4「今日仍然会参与预览」**：让位本已跳过锚点（今日），但**落点没有钳制**——指针路径靠 `anchorFloor` 钳边界，键盘路径（Alt+↑/↓）此前完全没有钳制，落点仍可能落到今日之上。改法：落点统一硬钳制（不得越过锚点行数），两条路径共用。
另加**调试面**（`localStorage["onethu.debug.drag"]="1"` 时，拖拽期间把 `origin/anchorFloor/moreFrom/bi/idx` 写到 `window.__navDrag`）：让位/落点涉及"冻结几何 + 锚点 + 容器让位"三层，只看 DOM 定位不出是哪一层错。
取证：拖 `info` 到今日之上，全程 `todayTop ∈ [98,98]`（**漂移 0px**）、`bi:1`、落位后 `first=today`。

**组2 附带修正**：`.pal:focus-within` 原写成复合投影 `var(--shadow-3), var(--md-sys-focus-ring)`，被 `focus-ring-test` 判为"焦点环没用令牌"（C17 口径：环只走令牌、单独出现）→ 改为令牌单独出现；`palette-motion-test` 断言同步收紧为"单独出现"。

**护栏与反例（提交 `0453c4a7`）**：上一提交的护栏有三条太松、注入打不红，已收紧——
「更多」行的分类标记限定在 `moreGrouped.map` 块内、折叠组可拖断言 `rowProps(id, "favs-folded")`、
落档新增"同一量纲（`lastBi >= moreFrom`）"与"锚点落点钳制（`Math.max(..., anchorCount)`）"两条。
四个反例各自只红对应那一条：① 落档退回按行数比 → 红（反馈 1）；② 去掉锚点钳制 → 红（反馈 4）；
③ 「更多」行去掉分类标记 → 红（反馈 3）；④ 折叠组收藏夹行摘掉拖拽 → 红（反馈 2）。还原后 md5 逐字节一致。

### 24.5 组3 · A3-PC 右键（提交 `ca6c5b4f`）

A3 的长按菜单（2026-09-30 落地）此前只有**触摸**入口；PC 右键只被全局 `preventDefault` 拦掉、不给菜单。本单元把右键接到**同一条**链路：

- `useLongPressZone`（装在列表容器上的事件委托）：加 `contextmenu` 监听，复用**同一个命中 `selector`**与**同一个 `onLongPress` 回调**，只是坐标来自鼠标；
- 全局 atom 层：把开菜单抽成 `openAtomMenu(el, x, y, swallow)`，`touchstart` 与 `contextmenu` 共用；`find()` 仍让路给页面自带的 `data-ctx-zone`（避免两套菜单同弹）；
- 两处右键路径**都不装「吞点击」**：右键不产生 `click`，装了会把随后的第一次左键吞掉（1s 内点同一条目无反应）；输入框 / `.selectable` 仍放行原生菜单。

**护栏 `tools/ctx-pc-test.mjs`**（已接进 pnpm guard）：两入口都必须接右键、必须复用长按的命中判定与回调、不许装吞点击、必须沿用文本区让路、atom 层必须继续让路给 zone、Layout 的全站拦截与文本放行必须还在、不许引入新依赖。**六个反例**各自只红对应那一条（① zone 摘右键入口 ② 全局层摘右键入口 ③ 右键装吞点击 ④ 右键处理体去掉文本让路 ⑤ 原子层去掉 zone 优先 ⑥ 不许新依赖），还原后 md5 逐字节一致。

**PC 取证（自建 exe md5 `22607d3ba91aa8dd6f1bfbe121daae13`，Edge 154）**：`#/tasks` 右键作业项 → 菜单 `["忽略","提醒","收藏"]`；同一项用 `Input.dispatchTouchEvent` 长按 → 菜单**逐项一致** ⇒ 同一套菜单；探针确认右键在长按区内 `defaultPrevented=true`。

#### ↩ 返修八（霖实测两条拖拽回归，提交 `a9d6a99c`）

**① 放下时其他项「突变回原位再播一次动画」** —— 三条根因叠加：

| # | 根因 | 改法 |
| --- | --- | --- |
| 1 | 行的 `transition: transform` 对**拖拽中的让位位移也生效** → 预览是"动画过去"的（滞后、看着像错位），且松手时 FLIP 取到的基准是**动画中间值** | 拖拽期间挂 `.nav.is-dragging-nav` 关掉过渡；并且**先撤位移、再恢复过渡**（顺序反了会把"清除"本身播成一段动画） |
| 2 | FLIP 只记 `[data-nav-id]` → **分类标签/容器不在里面**，松手时它们瞬间弹回、而行还在播动画 | `flipTargets()` = `.nav > *` ∪ `.nav [data-nav-id]`（与让位覆盖面一致），并以**元素为键** |
| 3 | 跨档放下时那一行的 key 变了（JSX 里两档是两个 map 表达式，不是同一个 child 数组）→ React **卸载重建**节点 → 没有 FLIP 基准 → "瞬移"到位 | 两档 key 统一为 `nav-<注册表 id>`；并按 id 兜一层基准（`topsById`），重建出的新节点也能补间 |

**② 移动收藏夹时错位平移抽搐**：让位位移写死了 `行高 + 1`——`.nav` 的 `row-gap` 是 `1px` 所以对，但 `.nav-folders-scroll` 是 `normal`（= 0），于是每挪一格多走 1px、逐格累加。改法：占位高度 = 行高 + **所在容器的实测 `row-gap`**。

**PC 取证（自建 exe md5 `22607d3ba91aa8dd6f1bfbe121daae13`，逐帧 rAF 采样）**：
- **让位瞬时**：拖拽期间其它行的位移集合 = `[-32]`、最大单帧位移 `32px`（一次跳变，无渐变帧）；
- **放下不跳**：相邻项 `tasks` 全程 `top=130.5` 不动；被拖项 `info` 在放下帧拿到基准（`translateY(194px)`、视觉顶仍 `489.5`），随后**平滑补间** `489.5 → 467.4 → 445.7 → … → 307.1`（约 200ms）；
- **收藏夹位移精确**：行距实测 `32`（`row-gap: normal`），让位位移**恰为 `32`**（修前为 `33`）。

**护栏新增 4 条 + 4 个反例**（各自只红对应那一条、还原逐字节一致）：不关拖拽期过渡 / 占位高度写死 / FLIP 只记 `[data-nav-id]` / 两档行 key 与档位绑定。

#### ↩ 返修九（霖实测：侧栏点不动 / 让位无动画 / 落位复播 + 字标恢复，提交 `1b2aa415`）

**① 侧栏选项均无法点击**（最严重）。根因：`pointerdown` 里就 `setPointerCapture`——指针捕获会把随后 `click` 的 target **重定向到捕获元素**（外层 `.nav-row`），内层 `<button>` 的 `onClick` 永不触发。探针实测：`click` 的 target = `nav-row is-draggable`、`defaultPrevented=false`、hash 不变；而 `pointerdown` 的 target 正常是 `nav-item`。
改法：捕获只在**越过拖拽阈值之后**取；阈值判定与逐帧处理抽成共享的 `trackMove`，由 **window 层 `pointermove`** 兜住（指针一离开行，行上的 `pointermove` 就收不到——向上拖第一帧就会离开，此前正是靠捕获才生效）；「吞点击」自带 700ms 自行解除（真实拖拽不产生 click 时不会吞掉下一次点击）。

**② 拖拽时没有布局改变动画**。根因两条：让位到的元素是**分类标签与裸 `.nav-item`**（它们没有 transform 过渡）；且落位时往元素上写的**内联 `transition: none` 会永久残留**——只有被 FLIP 到的元素才会被还原，没被 FLIP 到的元素此后所有让位都不再有动画。
改法：拖拽期给**所有可让位元素**统一加 transform 过渡（`.nav.is-dragging-nav > *:not(.is-dragging)`）；落位用**一帧 `.is-settling` 类**瞬时撤位移，不再写任何内联 transition。

**③ 放下后仍会复播动画**。落位基准改为**冻结布局位 + 目标位移**（不再取"当前视觉位"）——预览现在带动画，视觉位可能停在中间值上，拿它当基准就会出现"放下先跳到中间值再补间"。

**④ 字标恢复原状**（霖 2026-10-06：与原来差异明显）。移除 `WordmarkOneTHU`，`.brand-logo` 恢复五列网格（`( | One | THU )` + 三种字体混排）；主题令牌着色与 `theme.logoSvg` 插件替换口径不变。组2 护栏的 C13 口径同步改回"原五列网格"。

**PC 取证（安装版 `D:\OneTHU\onethu.exe`，md5 `6e833335d5c336bca429c8b3569caf01`）**：

| 项 | 读数 |
| --- | --- |
| 点击 | `tasks → #/tasks`、`today → #/today`（修前 hash 不变） |
| 拖拽已开始 | `.nav.is-dragging-nav` + `.is-dragging`，**80/80 帧** |
| 让位动画 | 同一元素唯一值 16 个、**中间值 14 个**（`0 → 10.9 → 20 → 26.7 → … → 33`）；修前是 `0 → 33` 一步到位 |
| 放下 | 其它行跳变数 **0** |
| 字标 | `display: grid`、五列、子元素 `[p, word, span, p, u, u, u, p]`、`svg: false` |

**护栏新增 5 条 + 7 个反例**（各自只红对应那一条、还原 md5 一致）：pointerdown 不许取捕获、window 层必须有移动跟踪、可让位元素必须统一带过渡、落位必须走整帧类、hook 里不许写内联 transition、落位基准必须用冻结几何、让位过渡不许被关掉。

**测试痕迹**：本轮验证含真实落位，侧栏偏好已按测试前的值写回（`{"tier":{"info":"pin","reserve":"pin","life":"pin","learn":"pin"},"order":[…]}`），侧栏次序与点前一致。

#### ↩ 返修十（收藏夹拖拽重播 + 区块顺序调整，提交 `be8dc007`）

**① 收藏夹拖拽放下"突变 + 重播"**。实测（安装版，逐帧 + 调试面）：

```
松手前 各行视觉顶=[458, 394, 426]   ← 被拖项画在 458（中心跟手），空洞在 426
松手前 调试面={origin:0, bi:1, idx:1, seqLen:2}
放下后 FLIP={before:458.24, now:426.24, dy:32}
落位后次序=[B,A,C]（拖了 2 格却只落了 1 格）
```

根因：让位边界判据用的是**行的中线**（`it.top + height / 2 > clientY`）。被拖项是"中心跟手"画在指针处的，指针落在某行中心时，按中线数出来的空洞会比物品**高整整一格** → 松手时 FLIP 必补一格（`dy=32px`）→ 观感就是"放下先突变、再重播一次动画"，而且落点比用户看到的少一格。

改法：判据改用**行的顶**（`it.top >= clientY`）——空洞与物品视觉所在的那一格一致。复验：`bi:2, idx:2`、**`dy:0`**、落位次序正好是拖动的 2 格 ✓。

**② 区块顺序改为「固定 → 更多 → 收藏夹」**（霖 2026-10-06 建议）：`navContent` 里把收藏夹整段（标签 + 限高滚动容器 + 新建收藏夹 + 已折叠收藏夹组）移到「更多」区之后、钉底设置之前。安装版实测 DOM 顺序：`…日程/行政/更多项… → label:收藏夹 → nav-folders-scroll → 更多开关 → sep → 设置` ✓。

**③ 调试面扩展**：`onethu.debug.drag=1` 时 `playFlip` 也写出被拖项的 `before/now/dy` 与收藏夹容器 `scrollTop`——"落位突变"这类问题只能靠读数分辨。

护栏新增 1 条 + 1 个反例：边界判据必须用「行的顶」（退回中线判据即红）。

#### ⚠️ 数据事故与恢复（本条必须留痕）

**事故**：本轮验证一度直接从测试脚本写 `localStorage["onethu.favs.v1"]`（想临时展开收藏夹），过程中该键被写成了空状态
（`{"v":1,"order":[],"folders":{}}`）——**用户收藏夹一度归零**。

**恢复**：从 WebView2 的 LevelDB 预写日志里把上一版值捞了回来 —
路径 `%LOCALAPPDATA%\app.onethu.desktop\EBWebView\Default\Local Storage\leveldb\*.log`，
该值被**双重转义并以 UTF-16LE** 存储（键是 ASCII、值是 UTF-16，且起始偏移为奇数，整体解码会错位）。
按字节定位 `{\"v\":1` 的 UTF-16LE 起点 → 解码 → 反转义 → 平衡花括号截取 → `json.loads` ✓。
恢复结果：**5 个收藏夹**、原 `order`、`foldedRoots` 原值，`items` 全为空（只有默认名「新建收藏夹」，**未丢收藏内容**）。

**新增硬规矩（后续所有单元适用）**：
1. **不许**从测试脚本直接写应用的持久化 store（`onethu.favs.*` / `onethu.sidebar.*` 等）；
2. 必须改状态时：**先把该键的值写进工作区外的文件备份**，改完立刻写回并核对；
3. 优先用**界面操作**推进状态（点按钮/拖拽），而不是改存储；
4. 验证脚本收尾必须打印"偏好/存储是否与开始时一致"。

#### ↩ 返修十一（收藏夹段段内滚动 + 折叠落点，提交 `f4ee9730`）

**① 段内滚动区的来历与去处**：`.nav-folders-scroll` 当初加 `max-height: clamp(120px, 24vh, 240px) + overflow-y: auto`，目的是"收藏夹再多也不把「新建 / 已折叠收藏夹」挤出视野"。顺序改成「固定 → 更多 → 收藏夹」后该理由不再成立，它反而成了三个毛病的来源：滚轮被吃（与 `.nav` 双层 `overscroll-behavior: contain`，即 F2）、拖动像被困在框里、拖不到已折叠组。改法：改为普通容器（`flex: none`），跟随 `.nav` 一起滚。
实测：`overflowY: visible`、`maxHeight: none`、`scrollHeight == clientHeight (96)` ✓

**② 拖不到「已折叠收藏夹」里**：折叠落点此前查的是**第一处** `.nav-folded-toggle`——区块顺序调整后 DOM 里第一处变成**「更多」按钮**，所以拖到已折叠组上不被识别。改法：给「已折叠收藏夹」那一行打 `data-fold-drop`，落点只认它（展开时整块折叠组区域也算）。
实测：把展开的收藏夹拖到它上面 → `is-drop-target=true`；放下 → 折叠进组（`foldedRoots` 2 → 3 项）；随后按文件备份写回，**深比较与备份完全相等** ✓

**③ 护栏**：侧栏护栏 +2 条；滚动条护栏口径更新（不再要求该段有元素级滚动条样式，改为断言"没有"）。反例 2 个各自只红对应那一条。

**一并解掉的旧账**：F2（滚轮被吃）的根因正是这个容器的限高滚动 + 双层 `overscroll-behavior`；本单元把它整体去掉了，F2 不再需要单独处理。

#### ↩ 返修十二（折叠落点补间 + 已折叠组去拖拽，提交 `222b6085`）

**① 拖进「已折叠」松手是瞬间向上平移**。根因两条：这条路径（`commit && s.overFold`）此前只调 `clearVisuals(s)`——**既没记 FLIP 基准、也没瞬时撤位移**；而 `foldSidebar` 改的是 `favs.data.foldedRoots`，Layout 的 FLIP effect 依赖只有 `[sbPrefs, favs.data.order]`，**折叠引起的重排不会触发补间**。
改法：把"记基准"抽成 `primeFlip(s)`（落位与折叠落点共用）；折叠落点改为 `primeFlip(s); clearVisuals(s, true); onFoldDrop(id)`；FLIP 的 effect 依赖补 `favs.data.foldedRoots / favs.data.foldedDefaults`。
实测（安装版逐帧）：放下瞬间其余行从 `[362.2, 394.2]` 平滑走到落位、单一元素出现 **49 个不同中间值**（此前瞬间平移）；最终落位 `[394, 426]`、相邻间距恰为 **32** ✓。

**② 已折叠组内部不做拖拽**（霖 2026-10-06：它默认不显示，展开只为查看/取回）。改法：`foldedUser` 行去掉 `drag.rowProps(…, "favs-folded")`；落位只服务**展开列表**，并删掉 `foldedOrder`。
实测：折叠组展开后 2 个子元素、均无 `data-nav-id`（不再是拖拽行），对其拖拽不起拖 ✓。

护栏 +3 条 / 反例 +3 个。

#### ↩ 返修十三（补间覆盖"让位序列之外"的元素，提交 `ddc64f14`）

**现象复报**：拖进「已折叠」松手，**下面的内容是直接跳上去的**。

**根因**：上一次只把**让位序列**（展开的收藏夹行）纳入 FLIP 基准，所以收藏夹行本身有补间，而**它下面的内容没有**——新建收藏夹 / 已折叠收藏夹 / 分隔线 / 设置都不是行、也不在让位序列里，折叠（或插入）把它们整体上移一格时是直接跳。

**改法**：`primeFlip(s, all)` 增加 all 模式——把 `flipTargets()`（`.nav > *` ∪ `.nav [data-nav-id]`）里尚未有基准的元素按**当前视觉位置**补进基准；**落位与折叠落点两条路径都走 `all=true`**。

**实测（安装版逐帧，折叠组收起态）**：
```
放下前 下方=[491,530,569,577]（新建/已折叠/sep/设置）
放下后 下方=[485,524,537,573] → [480,519,…] → … → [458,497,537,548]
下方首项/第二项各 11 个不同中间值（此前瞬间平移）
收藏夹行同时也有补间：[362,394] → 367,399 → … → 392,424
```
写回备份后：5 夹、`foldedRoots` 原值、3 行展开 ✓

**护栏 +1 条 / 反例 +1 个**（折叠落点退回不带 all 即红）。

**教训（写进流程）**：验证"某操作有动画"时，必须量**被操作对象之外的受影响集合**（这里是"下方所有元素"），只量被拖的那几个会漏掉整类问题。

### 24.4 组4 · M 批跟随（提交 `6d07bb58`；C1 + C5 + E9-PC）

需求书 §B5 末尾列的"4 处 M 批条目 PC 跟随"里剩下的三条（§2 右键绑定已在组3 完成）。

**C5 · PC 浮层定位**（移动端口径：刷新与回到顶层收进顶栏、右下角清空）：PC 没有顶栏，对应 chrome 是**侧栏底部**——`HardRefreshButton` 增加 `variant="foot"`，两枚 26×26 入口进 `.sidebar-foot`（回到顶层未滚够 240px 时留位不显示，避免整排位移）；PC 档收掉右下角浮层（`.shell .hard-refresh-fab { display: none }`，登录页无 `.shell` 不受影响）。
实测（安装版）：浮层 `display: none` ✓；底部两枚入口 `(69,780)/(119,780)` 26×26 ✓；**折叠钮仍在 `(18,780)`** ✓（C11 不回归）；滚到 549 时"回到顶层"变 `visible`、点击后 `scrollY=0` ✓。

**C1 · PC 侧栏边距与"滚动条不改变内容宽度"验收**：侧栏读数——`.sidebar` padding `12px 10px`、`.brand` `6px 8px 12px`（左缘 18 与折叠钮对齐）、行宽 204、设置行 x=10 ✓ 全部一致（不改代码）。宽度稳定性——PC 是整页滚动，故 `html { overflow-y: scroll; scrollbar-gutter: stable }` + `.content { scrollbar-gutter: stable }`；实测这台 WebView 的文档滚动条是 **overlay**（`offsetWidth−clientWidth=0`）本来就不挤内容，`overflow-y: scroll` 是对"经典滚动条平台"的兜底。**残留 10px 差已查清**：待办页自己的 `:has(.tasks-body)` 规则把 `.content` 变成内滚动容器（多 44px 底距 + 自己的 10px 滚动条），其 `stable` 生效（长/短内容都 996）——属页面级设计差异，不是滚动条抖动。

**E9-PC · PC 头部返回/收藏位置**（口径：返回左上、收藏右上）：`PageHead` 结构已固化（返回槽在前、页面级操作在右）。实测详情页：最左 `← 返回` x=272、最右页面级操作 x=1061 ✓。

**护栏 `tools/pc-follow-test.mjs`**（已接进 pnpm guard）：PC 档必须有"锁宽 + 收浮层"的媒体块、必须有 `overflow-y: scroll`、侧栏底部必须挂 foot 变体、登录页必须保留 FAB 变体、E9-PC 的返回槽必须排在操作槽之前。反例 3 个各自只红对应那条。

**至此 §B5 的 12 条 + 4 条 M 批跟随全部走完**（C13 按霖 2026-10-06 要求恢复原状，B5 判定为已关闭，F2 由收藏夹段去滚动一并解掉）。

**护栏口径更新（提交 `a081c549`）**：`tools/mobile-chrome-test.mjs` 两处按组4 的新口径放宽/补强——① `HardRefreshButton` 的匹配从字面 `()` 改为 `(`（组件加了 `variant` 参数，不是删除）；② `.content` 的 `scrollbar-gutter: stable` 现在**允许**出现在 PC 档（C1 的 PC 验收要求），并新增一条断言要求 PC 档确实有它；`overflow-y: auto` / `overscroll-behavior: none` 仍只许在手机档。

#### ✨ 动画打磨（侧栏伸缩 + 折叠态截断，提交 03d8c5fd；按 animate skill）

**门禁判定（skill Step 1–2）**：侧栏伸缩 = 每天点几次的 chrome 级控件 → 「近乎不可察觉、快而克制」那一档；**目的 = preventing a jarring change + spatial consistency**（面板在变窄，内容要跟着走）。

**量到的真相与直觉不同**（skill 的「先量后改」）：一次切换**最长帧 7ms、超 20ms 的帧 0 个**——帧没掉。碎裂来自两处**离散跳变**：① 相位用 **220ms 猜时间**摘掉，而宽度过渡是 300ms → **文字在飞行途中弹出来**（约 2/3 处一顿）；② 300ms + --ease-ios（M3 emphasized）对高频 chrome 偏拖沓。

**改法（ingredients）**：工具 = CSS transition（面板伸缩，无需 JS 动画 / 无库）；属性 = grid-template-columns —— **skill 认可的例外**（列宽没有 transform 等价物，同 accordion 的高度），已在 CSS 注释写明；曲线/时长 = var(--dur-2)（200ms）+ var(--ease-smooth)（强 in-out = skill 的「Moving / morphing on screen」档）；相位 = transitionend（propertyName === grid-template-columns）精确收尾 + 420ms 安全超时；reduced-motion 下直接切、不做相位。

**量化对比**：layout 46 → **31**、layoutDuration 29ms → **17ms**；文字出现 = **+215ms**、宽度到位 = **+187ms**（「文字不早于宽度到位」= true）。

**折叠态底部截断**：折叠态侧栏 72px、底部盒仅 52px，按 space-between 排 4 个元素 → 刷新钮被推到 x=52 之外、被 overflow:hidden 切掉一半，状态点也被挤出可视区。改法：轨道态**两枚入口都收掉**（26 + 8 + 12 = 46 ≤ 52），只留「折叠钮 + 状态点」。实测溢出元素数 **0**、状态点回到 x=52–64、折叠钮仍 (18,780)。

**留给霖拍板的一处**：折叠成轨道后**没有刷新入口**（要刷新先展开）——这是「52px 放不下」的必然取舍；若你要轨道里也能刷新，就得放弃状态点或把轨道加宽。
#### ✨ 收起/展开改为「遮罩式揭示」（提交 a551f37f；霖 2026-10-07 逐帧分析 + animate skill）

霖录制并逐帧分析了伸缩过程，指出四个突变位点（按时间顺序）：① 点击后图标间横分隔线消失、整体突然上移；② 搜索框文字先出现且**「搜、索、功、能」占四行**，同时图标轻微左移（由居中变靠左）、底部「收起/展开」按钮右上位移、刷新按钮出现；③ 随后四行变回一行；④ 到位后分类标签、图标旁文字、「更多」突然一起突显。

**根因同一条**：收起态用 **display:none / font-size:0 / 改 padding 与 justify-content** 抽排版——`display` 不可动画，每次切换都在同一帧抽掉或塞回整段排版。

**重做口径（animate skill）**：轨道 = **展开布局 + 视觉收起 + 由 `.sidebar` 的 `overflow` 裁切**，四类差异全部改走可动画属性：

| 位点 | 原实现（同帧跳） | 新实现（可动画） |
| --- | --- | --- |
| ① 分隔线消失、整体上移 | `.nav-label` 改 height/font-size/background | `max-height: 60→1` 连续 + `::after` 画线交叉淡入 + `color` 淡出 |
| ② 搜索文字挤成四行 | 无 nowrap | `white-space: nowrap` + `overflow: hidden`（展开时被裁开 = 遮罩揭示） |
| ② 图标由居中变靠左 | 改 `justify-content`/`padding` | `svg { transform: translateX(9px) }` 视觉居中 |
| ② 刷新按钮突然出现 | `display: none` → `flex` | `width: 26→0`（展开时把徽标平滑推开） |
| ② 折叠钮位移 | foot 内元素数变化 | 实测 `(18,780) → (18,780)` 恒定 |
| ④ 标签/文字/更多 突然突显 | `display:none` + `is-animating` 相位 | 标签 `color` 交叉淡入、文字靠裁切揭示、更多 `max-height: 32→0` |

同时**删掉 `is-animating` 相位与 `transitionend` 收尾**：遮罩式揭示天然与宽度同步，不再需要猜时间（也少了一套时序状态）。

**安装版逐帧取证（md5 579e45c313b8f79c7c0bdeea44fae12b）**：收起——图标 x `18→27` 平滑（单帧 ≤1.1px）、底部入口宽 `26→0`（≤3.1px）、更多高 `32→0`（≤3.8px）、搜索文字高**恒定 17.3px**、折叠钮不动；展开——收藏夹标题高 `1→42` 连续（单帧 ≤7.1px）、设置行 top `476→577` 连续。

**护栏**：新增「收起态一律不许 `display:none` 抽排版」+ 四条可动画属性断言；删掉相位相关旧断言。残留检查：收起态 `display:none` 规则数 = **0**。
**返修（图标被压成黑点，提交 dc96b5fc）**：霖中途肉眼测试发现 ① 收起后搜索栏放大镜消失；② 收起后导航图标缩成 1–2px 小黑点。根因是上一提交把收起态改成"文字留在排版 + 裁切"后，轨道里的行**横向过约束**（图标 18 + gap 9 + nowrap 文字 ≈28 > 52），而 flex 默认允许收缩 → svg 被压扁。改法：图标 `flex: none`，文字侧 `min-width: 0`（让文字承担收缩/裁切）。安装版实测：折叠态全部导航图标 **18×18**、搜索放大镜 **14×14 可见**，与展开态一致。

同时修掉护栏两处：`palette-motion-test` 的 `block()` 改为**行首锚定**（新增的 `.sidebar .sb-kbd { … }` 会抢先命中 `.sb-kbd {`，造成 C14 假红）；`sidebar-ia-test` 新增"图标与搜索图标必须 flex:none"两条断言（反例 1 个）。
**返修（搜索图标居中，提交 275f0e2e）**：霖指出收起态搜索按钮仍居左。改法与导航图标同口径：`.sidebar.is-collapsed .sb-search svg { transform: translateX(10px) }`（轨道内宽 52 − 边框 1 − 内边距 8 − 图标 14/2 = 10），并补上相同的 transform/color 过渡（两向都有动画）。

**安装版实测（md5 cc10ede83f072bc963119b5af380bc15）**：折叠态搜索图标中心 `35.7` / 搜索框中心 `36`（偏差 −0.3px）、导航图标中心 `36` / 行中心 `36`（偏差 0px）——两者落在同一条 `x=36` 竖列上。

**关于底部状态点（霖提问）**：它是**构建身份标识**——`lib/privacy.ts` 的 `DESENSITIZE_BUILD` 决定：正常版显示**绿点 +「就绪」**，脱敏演示版（`build-demo-apk.sh` 出的独立应用）显示**琥珀点 +「脱敏演示版」**。来源是 demo 线需要一眼区分"这是脱敏演示包"；正常版继承了这个徽标，实际信息量很低。若霖认为多余，可以只在 demo 版显示、或整体去掉。
**状态徽标改为只在脱敏演示版渲染（提交 dc55f757）**：霖批准去掉正常版的「就绪」点。该徽标是**构建身份标识**（`lib/privacy.ts` 的 `DESENSITIZE_BUILD`）：正常版绿点「就绪」、脱敏演示版琥珀点「脱敏演示版」；它不反映网络/同步/登录状态，正常版留着是噪声。侧栏底部与移动端抽屉底部两处徽标都包进 `DESENSITIZE_BUILD` 条件。

**安装版实测（md5 7beac82d68c3e846125111b9d74e4dc7）**：展开态徽标数 **0**、底部 = 折叠钮 `(18,780)` + 硬刷新 `(99)` + 回到顶层 `(180)`；折叠态徽标数 0、两枚入口宽 0 / opacity 0（不可见不占位）、折叠钮仍在 `x=18`。

**排错记录**：本次改 JSX 时遇到「逐行看完全对、但 tsc 报 JSX 未闭合」——逐字节检查无异常字符，最终用脚本**整段重写**才恢复。教训：**JSX 块（尤其带多行中文注释）一律用脚本一次写成，不做局部多行替换**。
**底部重做（提交 2e5daf0b，霖 2026-10-07）**：① 去掉「回到顶层」只留刷新；② 展开态底部改**左对齐**；③ 刷新要有"融入/吐出"动画，且**收起按钮位置一概不变**。

**上一版的根因**：轨道态切换了底部的 `flex-direction`（row → column-reverse）与 `align-items`，这是同一帧的排布变化 → 收起钮瞬移、两个按钮随后整体左移；分割线/内容也随布局重排跳动。

**改法**：底部两态**排布完全一致**（`justify-content: flex-start` 一行，刷新永远在收起钮右侧）；轨道里刷新用 `opacity: 0 + transform: translateX(-8px) + pointer-events: none`「融入」收起钮（只用 opacity/transform，零布局副作用且不可点）；「回到顶层」按钮与 `.sb-foot-top` 规则整体删除。

**安装版实测（md5 106348b028daab53a4a02fab300bdf44）**：收起钮**布局位** `offsetLeft/offsetTop = [18,780] → [18,780]` 两态一致 ✓（用 `getBoundingClientRect` 看到的 ±5px 是按钮旋转 180° 的外框假象，不是位移——这条记下来，避免下次误判）；收起 opacity `1→0.37→…→0`、translateX `0→…→-8`；展开 opacity `0→0.53→…→1`、translateX `-8→…→0`；分割线 top `569→…→468` 平滑。

**护栏**：改为「轨道态不许改底部排布」+「刷新必须用 opacity+transform 融入」；清掉上一版 `column-reverse` 的过时断言。
**两条 BUG 修复（提交 e4611293，霖 2026-10-07）**：

① **轨道里取消折叠钮**：霖反馈收起后上方选项按钮与「收起」挤在同一列、过近。改法：轨道态 `opacity: 0; pointer-events: none`（不用 `display:none`——会产生同帧排版跳变）。折叠钮藏起来后必须留展开入口，于是**品牌 logo 兼作展开入口**（轨道态 `role=button` / `title=展开侧边栏` / 接 `toggleSidebar`；展开态保持原样不可点）。

② **刷子「弹不出来」**：根因是上一版只做纯淡入，且 spring 写在了**不生效的那条 transition 规则**上——`.sb-foot-btn` 在文件里有两条规则，后一条整体覆盖前一条（同时也把 hover 的 `color/background` 过渡覆盖掉了）。现已合并为一条：`color/background/opacity` 走 `--ease-out`、`transform` 走 `--ease-spring`；轨道态 `translateX(-6px) scale(0.92)`，展开时归零并过冲。

**安装版实测（md5 d43e0678a9a9c7808f523d8991380fb0）**：轨道态折叠钮 opacity 0 / pointer-events none、品牌 logo title「展开侧边栏」；收起 `opacity 1→0`、`translateX 0→-6`、`scale 1→0.92`；展开（真实鼠标点品牌 logo）`opacity 0→…→1`、`translateX -6→…→-0.47→`**`+0.05→+0.22`**`→…→0`、`scale 0.92→…→`**`1.003`**`→1`（越过终点 = 弹），收起钮同步淡入。

**教训升级**：JSX 注释**只写一行**——多行中文 JSX 注释会让 tsc 报「JSX 未闭合」类假错，逐字节检查也看不出异常（上一轮「整段重写」有效的原因正是改写成了一行注释）。
**理解纠偏 + 重做（提交 db85dcbc，霖 2026-10-07）**：霖澄清「折叠按钮」指**收藏夹每行右侧 title 为「折叠进已折叠收藏夹」的小箭头**（`.nav-fold`，内容 `«` / `»`），不是侧栏的展开/收起按钮。本轮先还原、再按正确对象重做。

**还原**：删掉 `.sidebar.is-collapsed .sidebar-collapse { opacity: 0; pointer-events: none; }`（折叠钮回到「轨道里仍原位可见可点」）；品牌 logo 撤掉 `onClick={sbCollapsed ? toggleSidebar …}` 等接线，恢复普通 `div`；护栏对应 3 条断言删除。

**重做**：`.sidebar.is-collapsed .nav-fold { display: none }` —— 轨道里图标居中后，这个绝对定位（`right:4px`）的箭头正好贴住图标，收起态直接取消它、展开侧栏时再显示；绝对定位使其隐藏**零排版影响**、无跳变。

**保留**霖已确认的刷新改动：底部只留刷新、展开态左对齐、轨道里「融入」收起钮、展开时带 spring 过冲弹出。

**安装版实测（md5 c899935bdabd7e9d32bfcc52f7ee9690）**：展开态行尾箭头 7 个 `display: flex`、折叠钮 `(18,780)` opacity 1 可点；轨道态行尾箭头 7 个 `display: none`、折叠钮仍 `(18,780)` opacity 1 可点、刷新 opacity 0。

**护栏**：新增「轨道里必须取消 `.nav-fold`」+「轨道里不许再藏侧栏折叠钮」（防这次误解回归），反例 2 个；并把之前拼接坏掉的一段断言整段重写。

**教训**：改 UI 前先把「用户说的那个控件」在 DOM 里定位到（选择器 + title/aria-label 文案）再动手——本轮把 `.sidebar-collapse` 误当成 `.nav-fold`，白做一轮。
**轨道加宽 + 刷新常驻（提交 2a047cb2，霖 2026-10-07）**：霖反复反馈「收起后刷新按钮依旧没有弹出」——前两版把「弹出」理解成"融进收起钮再滑出"，实际要的是**收起后刷新必须真的出现在轨道里、可点**。

**几何硬约束**：轨道 72px 时折叠钮右侧只剩 10px（侧栏左右内边距各 10、底部盒内边距各 8），放不下第二枚 26px；放得下需底部内容宽 `26+8+26=60` → 轨道 **96px**（60 + 底部内边距 16 + 侧栏内边距 20）。

**改法**：`--sidebar-w: 96px`（72 → 96）；底部两态布局**保持不变**（刷新始终在收起钮右侧、折叠钮永远 `(18,780)`），故无排布跳变；刷新在轨道里不再消失、只略小一档 `scale(0.94)`，展开时走 spring 弹回 = 「弹出来」；按新宽度重算图标居中位移（导航 `9→21px`、搜索 `10→22px`）。

**安装版实测（md5 5585a5178010ba2901ef84daf9a82db3）**：轨道态轨道宽 96、折叠钮 `(18,780)` 26px opacity 1 可点、刷新 `x=53..77` opacity 1 可点；导航图标中心 `48` = 行中心 `48`、搜索图标 `47.7` / 搜索框 `48`（加宽未破坏居中）；展开态 224、折叠钮 `(18,780)`、刷新 `x=52..78`。

**备选口径**：若嫌轨道 96 偏宽，可改回 72 并把刷新做成导航列表里的一行（轨道态显示为图标行、展开态为完整行），同样满足「收起后刷新在」且无需加宽。
**定案：收起态不显示刷新（提交 29652a1d，霖 2026-10-07）**：霖最终决定收起态不显示刷新按钮、只有展开态显示。上一版「轨道加宽到 96px 让刷新常驻」因此作废并全部退回。

**改法**：`--sidebar-w` 回到 `72px`；`.sidebar.is-collapsed .sb-foot-btn { opacity: 0; transform: translateX(-6px) scale(0.92); pointer-events: none }`（收起态隐藏且不可点，展开时 spring 弹回含过冲）；图标视觉居中位移按 72px 重算回去（导航 `21→9px`、搜索 `22→10px`）。底部两态布局仍一致，折叠钮位置任何状态都不变。

**安装版实测（md5 35898608f4561bbc5369136c39c3bff4）**：轨道态轨道宽 72、折叠钮 `(18,780)` opacity 1 可点、刷新 opacity 0 / `pointer-events: none`、行尾折叠箭头 `display: none`、导航图标中心 `36` = 行中心 `36`、搜索图标 `35.7` / 搜索框 `36`；展开态轨道 `72→224`、折叠钮 `(18,780)`、刷新 `x=52..78` opacity 1 可点，淡入轨迹 opacity `0→0.7→0.88→0.95→0.98→1`、translateX `-6→…→0.14→0.21→…→0`。

**护栏**：同步反转为「轨道里刷新必须隐藏」+「轨道宽度回到 72px」。
---

## 25. 本轮收口（P 批 + 侧栏系列，2026-10-07）

### 25.1 交付清单

| 组 | 内容 | 提交 | 最终口径（安装版实测） |
| --- | --- | --- | --- |
| 前置① | 侧栏消费注册表（E2）+ 常驻/更多/选课季（C15） | `8e6e2e78` | 无手写条目清单；两档同源注册表 |
| 前置② | 「更多」⇄ 常驻 拖拽排位 | `82279185` | 拖拽期间零 React 渲染；冻结几何落点 |
| P1 | 侧栏伸缩（C11 + C12 + D6，B5 判定关闭） | `eab86cc6` | 收起钮两态 `(18,780)`；文字整行出现 |
| P2 | Ctrl+K（C14 等宽 + D8 动效门禁） | 见 §24 各节 | 无逐键动画；减动效降级纯淡入 |
| 组2 | C13 字标恢复原五列网格 / C14 / D8 | 见 §24 | 字标为原五列网格（ `p/word/span/p/u/u/u/p` |
| 组3 | A3-PC 右键绑定 | `ca6c5b4f` | 与长按同一套菜单，逐项一致 |
| 组4 | C1 + C5 + E9-PC | `6d07bb58` | PC 内容宽度锁死；浮层收进侧栏底部；返回左上/操作右上 |
| 侧栏系列 | 伸缩动画打磨（逐帧四突变位点清零） | `a551f37f` | layout 46→31；文字不早于宽度到位 |
| 侧栏系列 | 轨道图标尺寸修复（flex 过约束） | `dc96b5fc` | 折叠态图标 18×18；放大镜 14×14 可见 |
| 侧栏系列 | 搜索图标居中 | `275f0e2e` | 图标中心 35.7 / 框中心 36 |
| 侧栏系列 | 状态徽标 demo-only | `dc55f757` | 正常版徽标数 0 |
| 侧栏系列 | 底部重做（去回到顶层 + 左对齐 + 融入/吐出） | `2e5daf0b` | 收起钮 `[18,780]→[18,780]` |
| 侧栏系列 | 行尾折叠箭头口径纠偏 | `db85dcbc` | 轨道里 `.nav-fold` = `display:none` |
| 侧栏系列 | **定案**：收起态不显示刷新（轨道退回 72px） | `29652a1d` | 轨道宽 72；刷新 opacity 0 / 不可点 |

### 25.2 门禁与产物

- 门禁四项：`pnpm guard` **0 红**（含 `pc-follow-test.mjs` 新护栏）、`pnpm test` **23/23**、`npx tsc --noEmit` 干净、`node tools/docs-prose-lint.mjs` **21 份文档 0 违规**。
- 安装目录产物：`onethu.exe` md5 **`35898608f4561bbc5369136c39c3bff4`**（本机 WebView2 远程调试实测通过）。
- 红线复述：未碰凭据/正式版标识；未 `git add -A`；`packages/core/src/exthw/yuketang.ts` 保持霖的未提交原样（87+/15−）；构建后 `gen/android` 仍为复位态软链。
- 反例累计：本轮新增 14 个（⑮–㉘，见各节），每个都验证「注入 → 记红点 → 还原 → 逐字节一致 → 回绿」。

### 25.3 本轮沉淀的方法论（都已写进护栏或注释）

1. **收起态一律不许用 `display:none` 抽排版**（会在同一帧整列跳）——唯一例外是绝对定位元素（`.nav-fold`）。
2. **文字留在排版里、由容器 `overflow` 裁开**＝遮罩式揭示，天然与宽度动画同步，不需要 JS 相位。
3. **`scrollbar-gutter: stable` 只对可滚动元素占位**：要真正锁宽得靠 `overflow-y: scroll`。
4. **量位置要用 `offsetLeft/offsetTop`**，`getBoundingClientRect` 会把旋转中的外框算进来（`rotate(180deg)` 的 ±5px 假象）。
5. **JSX 注释只写一行**：多行中文 JSX 注释会让 tsc 报「JSX 未闭合」类假错，逐字节也查不出异常。
6. **改 UI 前先在 DOM 里定位控件**（选择器 + `title`/`aria-label` 文案）：本轮曾把 `.sidebar-collapse` 误当 `.nav-fold`。
7. **同一元素的多条同名 CSS 规则**要合并：`.sb-foot-btn` 曾两条 `transition` 互相覆盖，导致 spring 写在了不生效的那条上。

### 25.4 仍未关闭（不在本轮范围）

- 需求书 §B2 的真机/霖动作项（真手指手感、真死侧登录场景、MIUI 手动安装回退等 10 条）。
- 需求书 §B1 的 15 条「仓库内可完成」（下一批候选，见 §26）。
- 需求书 §B2 第 61 条「§8 P 批全部」在本轮已关闭，该行口径已过期（P 批 12 条 + 4 条 M 批跟随全部落地）。

### 25.5 下一批候选（需求书 §B1，15 条）

文档 §E 第 6 步点名先清「不依赖设备状态的几条」，即：**45**（冷启动 `BOOT-T READY` 重取）、**43/44**（K30 用 CDP 派发替代 `input tap`）、**48**（`loginGate` 20s 冷却标注）、**49**（`refreshLearnDataSilently` 静默丢数据收口）、**50**（K30 同项对照）。

其余：**39/40/41**（触感分级、底栏胶囊遮罩、顶栏主题三态的量测补齐）、**42**（学期切换控件，需多学期账号或脱敏快照注入）、**46**（选课评价弹层，需教学评估数据）、**47**（14 位数单次现场）、**51**（`scale(0.99)` 的文档例外注记，纯文档）、**52/53**（取机安装判定、`AUTO-RECOVER` 常驻观察）。

其中**只有 48、49 是代码项**（各带护栏 + 反例），51 是纯文档项，其余为真机量测（K30 已链接，可当场取样）。
### 25.6 §B1 十五条复核（2026-10-07，开工前逐条查证）

复核方式：源码/护栏/文档三路交叉——条目声称「未做」的，逐个去找它在代码里的落点与文档里的读数。

| # | 条目 | 复核结论 | 依据 |
| --- | --- | --- | --- |
| 39 | 触感分级真机分档补测 | **确实未做** | 文档只有单档读数（b27/b28 定档表，行 123–139）；「保留档 / 静默档各跑一轮差分」无记录 |
| 40 | 底栏胶囊点击遮罩对比 | **确实未做** | 无与 `.seg-pill` 同屏的遮罩计数记录 |
| 41 | 顶栏主题三态剩余量测 | **部分已做** | 三档 alpha 采样已有（行 2900「部分关闭…alpha 四态恒 0.86」）；**像素级取色**未见 |
| 42 | 学期切换控件真机未验 | **确实未做（且受阻）** | 行 581 写明账号只有 2026-秋 有成绩、控件未显示 |
| 43 | K30 `input tap` 被拒 → 用 CDP 替代 | **手法已在用** | 行 894 已记录 CDP 接 dev 包的可重复路径；缺的是按条逐次记录 |
| 44 | K30 的 CDP 注入面 | **同上** | 同上（`input tap` 只是便利���段，行 990 已如实记为限制） |
| 45 | 冷启动 `BOOT-T READY` 重取 | **确实未做** | 冷启读数有（行 753–855），但本条要求的**重取**未见 |
| 46 | 选课评价弹层真机覆盖 | **确实未做（且受阻）** | 现网数据 DOM 里没有「教学评估」入口 |
| 47 | 14 位数单次真机现场 | **确实未做** | 仅条目文本（行 3199） |
| 48 | `loginGate` 冷却内「假失败」 | **口径需修正（语义已在）** | `judgeLibFullChainRecovery` 已返回结构化 `reason`，含 `interactive-login`（`libSessionGuard.ts:462`）；缺口＝**没把「冷却」与「登录链未 settle」分开** |
| 49 | `refreshLearnDataSilently` 静默丢数据 | **确实未做** | `data.ts:468` 失败只 `return null`，无 `done/skipped/failed` 句式；**护栏零覆盖**（`grep refreshLearnDataSilently tools/*.mjs` 为空） |
| 50 | 改造后复测对照面（K30 同项） | **确实未做** | 只有 K90 的 294px 与 0/0/0；K30 同项读数未取 |
| 51 | `scale(0.99)` 落地形式 | **口径需修正（注记已在但过期）** | 行 2130 已有「遗留观察（未改，等霖定）」；霖已裁定保留 → 需改写为 §2/§3 口径的**显式例外注记** |
| 52 | 取机与安装的当次判定 | **已成立** | 行 2482–2505：2026-10-04 18:24 起 `install -r -d` 在本机稳定返回 |
| 53 | `AUTO-RECOVER` 常驻观察 | **确实未做（且已知有反例）** | 行 1070–1076：第 1 轮登录完成后 62 秒的反例「必须记，未修好」 |

**结论**：15 条中 **11 条确实未做**（可照单开工）；**4 条口径需修正**——48（语义已在，只需拆分冷却语义）、51（注记已在，只需改写为口径例外）、41（三档采样已做，只差像素级取色）、52（安装手法已成立，属每轮复用流程）；43/44 属「手法已在用、缺按条记录」。

因此下一批按 §E 第 6 步点名的子集推进时，**48 与 51 的工作量比清单描述更小**，49 是唯一需要新增护栏的条目。
---

## 26. §B1 清账（2026-10-07 开工，按 §25.6 复核结论排序）

### 26.1 第 49 条 · `refreshLearnDataSilently` 三态收口（提交 `3e1c3e4e`，代码 + 护栏）

**复核**：失败即清缓存那行现在不在静默路径上（在 `load()` 路径 `data.ts:551/566`）；真问题是返回值 `LearnBundle | null` 把「没执行」与「失败」混成一个 `null`。

**改法**（镜像 `LibSoftResult` 的口径：**只有 `failed` 允许触发后果**）：新增 `LearnSilentState`/`LearnSilentSkipReason`/`LearnSilentResult` 三态类型；`done` 真拉到并写回，`skipped/reentrant`（单飞在飞）、`skipped/cooldown`（免密重登被 20s 节流判掉）、`skipped/transient`（非鉴权类错误）**一律保旧值**，只有鉴权失效且免密重建也失败才 `failed`；单飞在飞时第二个调用方按 `skipped/reentrant` 结算；判据 C（b20）要求在守卫之外 `await settleLibSoftPending(await relearnRoamOnce())` 等真结算；新增 `LEARN-SILENT state=… reason=… key=…` 标记供真机走查过滤。

**护栏**：`tools/relogin-test.mjs` 新增 ㉚ 组 9 条（三态类型、三条保旧值分支、failed 态、**silent 路径禁 `cache = null`**、skipped/failed 必须带缓存句柄、LEARN-SILENT 标记），P0-1 改为新形状；反例 4 个各自只红对应那条。

**验证**：`tsc` 干净、`guard` 0 红、`test` 23/23；安装版冒烟（等满 105 秒让 90 秒静默刷新真跑一轮）——页面零异常、62 张卡数据完好、未落登录页，侧栏 `72⇄224` 正常。
### 26.2 第 48 条 · 登录申请冷却的「假失败」（提交 `6ec68d4d`，代码 + 护栏）

**现场**：`ensureInfoPortal()` 在 `loginGate` 20s 冷却里 `return false`（`infoLib.ts:495`）——那是「**没执行**」；但 `ensureLibSessionFlow` 返回布尔、上层 `runLibSoftSingleFlightResult` 把它折成 `failed`，b18 真机的假登出即由此而来。另 `clients.ts:357` 把「冷却」与「登录链在飞」混成一个 `interactiveLogin`。

**改法**（需求书两个选项合体）：`libSessionGuard.ts` 新增**只读标注** `notePortalSkipReason`/`consumePortalSkipReason`（一次性消费，读后即清，不参与判定）；`ensureInfoPortal()` 入口先清标注、**只在冷却分支**置 `"cooldown"`；`libEnsureSessionResult()` 无条件下读一次，仅当结论 `failed` 且标注为冷却时改判 `{ state: "skipped", reason: "cooldown" }`——与既有口径一致：**skipped 不是失败，绝不触发登出**。

**护栏**：㉛ 组 6 条（标注存在且一次性消费、置位恰好一处、入口先清、failed+cooldown 必须改判并真返回 skipped/cooldown）；反例 3 个各自只红对应那条。

**验证**：`tsc` 干净、`guard` 0 红、`test` 23/23；安装版冒烟——启动 62 张卡，今日/作业/课程/我的四页走查零异常、零误判登录页。
### 26.4 本轮三条收口后的状态（2026-10-07）

| # | 条目 | 结果 | 提交 |
| --- | --- | --- | --- |
| 49 | `refreshLearnDataSilently` 三态收口 | ✅ 已关闭（三态 + ㉚ 组 9 条护栏 + 反例 4） | `3e1c3e4e` |
| 48 | 登录申请冷却的「假失败」 | ✅ 已关闭（只读标注 + 改判 skipped/cooldown + ㉛ 组 6 条护栏 + 反例 3） | `6ec68d4d` |
| 51 | `scale(0.99)` 的落地形式 | ✅ 已关闭（§2 增「按压口径的显式例外」；代码不动） | `5e8f6b1e` |

**剩余 12 条的阻断点**：§B1 其余条目（39/40/41/42/43/44/45/46/47/50/52/53）全部依赖真机取样或霖的账号/数据——
其中 42（多学期成绩）与 46（教学评估入口）属数据受阻，其余需 K30 在线（本次复核时 `adb devices` 为空，设备未连接）。
52 的安装手法已成立，属每轮复用流程；43/44 的 CDP 手法已在用，缺的是按条逐次记录（需设备在线时补）。
### 26.5 K30 现场（2026-10-07）：CDP 通道成立、第 45 条取到、其余被"设备无网"阻断

**设备**：`<设备>` / Redmi K30 Pro Zoom Edition / Android 12（SDK 31）/ WebView **96.0.4664.104** / 包 `app.onethu.desktop.dev`（`versionName=0.10.0-dev`、`versionCode=10000`、lastUpdate 2026-10-05 23:09）/ 启动 Activity `app.onethu.desktop.MainActivity`。

**第 43/44 条（CDP 通道替代 `input tap`）✅ 已成立且可复用**（WSL 直连 Windows 侧 forward）：

```
ADB=/mnt/c/temp/platform-tools/adb.exe   # WSL 看不到 USB；用 Windows 侧 adb server（-P 5037）
$ADB -P 5037 shell am start -n app.onethu.desktop.dev/app.onethu.desktop.MainActivity
PID=$($ADB -P 5037 shell cat /proc/net/unix | grep -o "webview_devtools_remote_[0-9]*" | head -1)
$ADB -P 5037 forward tcp:9226 localabstract:$PID
curl -s http://127.0.0.1:9226/json/list        # WSL 侧直接可用（实测返回 Chrome/96.0.4664.104）
```

拿到 `webSocketDebuggerUrl` 后即与 PC 走查同一套 CDP 客户端（`Runtime.evaluate` / `Input.dispatchTouchEvent`），完全不需要 `input tap`。

**第 45 条（冷启动 `BOOT-T READY` 重取）✅ 已取，但口径需修正**：源码里**只有两个 `BOOT-T` 标记**——`BOOT-T trySilentRelogin(…)`（`state/app.tsx:315`）与 `BOOT-T ${label}`（`lib/clients.ts:754`），**不存在 `BOOT-T READY`**（全 logcat `grep -c READY` = 0）。因此本条的实际内容＝重取 `BOOT-T` 序列，本次读数（`force-stop` + `logcat -c` + `am start`）：

| 标记 | 时序 | 备注 |
| --- | --- | --- |
| `BOOT-T 水合完成(0网络)` | +0ms | 水合不依赖网络 |
| `BOOT-T learn.resume(过期)` | +652ms | learn 会话已过期 |
| `BOOT-T trySilentRelogin(失败)` | +8ms | 见下：设备无网 |

**阻断点（外部）**：K30 的 Wi-Fi 开关为 1 但**没有连上任何网络**——`SSID: <unknown ssid>` / `BSSID: <none>`、`ping` 返回 `Network is unreachable`、`unknown host webvpn.tsinghua.edu.cn`；应用侧相应全是 `error sending request for url (https://webvpn.tsinghua.edu.cn/login?oauth_login=true…)`。因此页面停在登录页（CDP 读到 `hasLogin: true`、`hasShell: false`），而 39/40/41/47/50/53 六条都需要**已登录会话**（顶栏、列表行、底栏胶囊、恢复环），本次全部取不到。

**结论**：43/44 ✅ 关闭（手法成立并已记录）、45 ✅ 关闭（读数已取 + 口径修正）、52 ✅（安装手法已成立）。其余六条待设备连上校园可达网络并完成一次登录后即可一次做完；按红线**不碰任何凭据**，登录必须由霖在设备上完成。
### 26.6 K30 量测批次（2026-10-07，设备已登录）

**会话前提**：K30 连上 `Tsinghua-Secure`（`ping webvpn.tsinghua.edu.cn` = 3.3ms）后冷启一次，日志出现 `LIB-ENSURE 静默重登成功（verifyAndReLogin）`；CDP 读到 `hasShell: true` / `hasLogin: false` / 导航 15 项 / 行卡 100 个 / 顶栏与底栏齐全——**未做任何人工登录，凭据全由应用自身的「记住密码」完成**（红线：不碰凭据）。

**⚠️ 重启后必须重建 forward**：`am start` 后 `webview_devtools_remote_<pid>` 的 pid 会变，旧 forward 直接 `SocketError: other side closed`；重新 `forward tcp:9226 localabstract:$PID` 即恢复。

| # | 条目 | 读数（K30 / WebView 96 / 393×822 CSS px / DPR 2.75） | 状态 |
| --- | --- | --- | --- |
| 50 | 列表行标题对照 | `.row-title` = **269.3px**、`scrollWidth-clientWidth = 0`、`white-space: nowrap`、`text-overflow: ellipsis`（K90 旧读数 294px；差 25px 来自视口宽度差，**同为「第一行整行、不省略」**） | ✅ |
| 41 | 顶栏主题取色 | 计算值：`background-color: rgba(0,0,0,0)`、`backdrop-filter: blur(10px)`、`--topbar-bg-alpha: 0.86`、`data-theme=onethu.theme.tsinghua`；**真截图像素**（1080×2400）：顶栏 (541,40)=**(255,251,255)**、(541,99)=**(254,249,253)**——与 b39「alpha 四态恒 0.86」互证 | ✅（另两档应用内主题的像素待同一手法补） |
| 40 | 底栏胶囊点击遮罩 | 底栏点击**不产生任何 DOM 遮罩/涟漪**（`[class*=ripple],[class*=mask]` 前后均为空）；按压反馈是 CSS `.bottom-nav-item:active { transform: scale(0.94) }`；`.seg-pill`（滑动指示器）样式在 `motion.css:783`（`global.css` 里没有，之前按 `global.css` 找是找错了文件） | ✅ |
| 53 | `AUTO-RECOVER` 常驻观察 | 本窗口（冷启 + 静默重登 + 页面走查）计数 **0**——无重复、无风暴 | ✅ |
| 39 | 触感分档差分 | 两次点击（底栏项 = `tick`、搜索框）= **0 次振动**；`dumpsys vibrator_manager` 的 `Previous vibrations for usage TOUCH` 最新条目停在 13:19:20（早于本次点击）；档位是**能力驱动**的内部分支（`haptics.ts` 的 `LEGACY_HAPTIC_KEEP = ["longPress","tick"]` + `silenceOnLegacy`），没有用户开关也没有 dev hook | ⏳ 部分（`0/0/1/1` 全矩阵需另两个调用点） |
| 47 | 14 位数单次现场 | 需先在运行中制造「会话失效」现场（走 `http_native` 打 `webvpn…/logout` 再触发加载），本轮未做 | ⏳ 待做 |

**本轮沉淀的三个可复用手法**：

1. **K30 的 CDP 直连**：`adb.exe -P 5037 forward tcp:9226 localabstract:webview_devtools_remote_<pid>` → WSL 侧 `http://127.0.0.1:9226/json/list` 直接可用（45/43/44 之外，本轮 40/41/50/53 也全靠它）。
2. **触摸要带全字段**：`Input.dispatchTouchEvent` 的 `touchPoints` 必须给 `{x, y, radiusX, radiusY, force}`；只给 `x/y` 会被 CDP 拒（`Failed to deserialize params.touchPoints.x`）。另外 `js()` 已经 JSON 解析过，别再套一层 `JSON.stringify`（会把坐标读成 undefined）。
3. **纯 Python 取像素**：系统 `python3` 无 PIL，bundled python 是 Windows 路径；改用自带 `zlib` 手写的 30 行 PNG 解码器（IHDR/IDAT + 四种 filter）即可对 `adb exec-out screencap -p` 的截图逐像素取值——本轮第 41 条即用它。
### 26.7 窄屏底栏胶囊：完整包裹 + 连续曲率（提交 `09d194a2`，代码 + 护栏）

**现象**（霖 2026-10-07）：窄屏底栏的 active 胶囊只盖住「图标 + 文字」里文字的上半部分，下沿从标签中间穿过。

**K30 实测定位**（CDP 读三者矩形，WebView 96 / 393×822 / DPR 2.75）：

| 对象 | 数值 |
| --- | --- |
| 内容盒（图标顶 → 标签底） | 773.8 → 808.2（高 34.4，与钩子算出的高度一致） |
| 胶囊（改动前） | 765.8 → 800.2（高 34.4）—— 顶部比内容盒高 **8px**，下沿切进标签 **8px** |

**根因**：绝对定位子元素的包含块是**内边距盒**（padding box），`top: 0` 已经在底栏自身 padding 之外；`useBottomNavPill` 的换算写成 `box.top - base.top + padTop - navPadTop`，把底栏 `padding-top`（8px）扣了两次——这个 8px 正好等于观测到的偏移量。

**改法**：

1. 换算只减底栏 `border-top`（`navBorderTop`），不再减 `padding-top`；
2. 新增纵向对称内衬 `NAV_PILL_PAD_Y = 3`（`--nav-pill-top` 自内容盒顶再上移 3px、`--nav-pill-h = 内容盒高 + 6`）。取 3 而非 4，因为底栏项自身只有 4px 下内边距，取 4 会正好贴到单元格下沿；
3. **曲率连续**：圆角由写死的 `var(--md-sys-shape-corner-full, 999px)` 改为 `min(令牌, calc(var(--nav-pill-h) / 2))`——半径恒为实测高度的一半，两端口永远是半圆，高度随字号/行高变化也不会退化成小圆角矩形；同时保留全圆角令牌（`nav-shell-test.mjs` 存量断言就钉着这条令牌纪律）；
4. 追加 Apple 口径的 continuous corners 增强：`@supports (corner-shape: squircle)` 内给胶囊 `corner-shape: squircle`，把半圆展成超椭圆、消掉「半圆 → 直边」交界处的曲率跳变。WebView 96 不认这条（K30 实测 `CSS.supports("corner-shape","squircle")` = false），退化为标准胶囊。

**出货包设备验证**（dev APK 装到 K30，`lastUpdateTime` = 2026-10-07 13:52:14）：

| 项 | 改动前 | 出货后 |
| --- | --- | --- |
| 胶囊纵向区间 | 765.8 → 800.2 | **770.8 → 811.2** |
| 高度 / 圆角 | 34.4 / 999px | **40.4 / 20.1989px（= 高度一半）** |
| 盖住标签底 | 否（差 8px） | **是** |
| 图标上 / 标签下留白 | 8 / −8 | **3 / 3** |
| 是否出单元格 | 是 | **否** |

**护栏**：`mobile-chrome-test.mjs` 新增 3 条（top 换算不许再减 padding-top；必须有纵向对称内衬；`corner-shape` 必须有 `@supports` 守卫），`nav-shell-test.mjs` 的圆角断言升级为「令牌与实测高度取小」；反例 4 个（㊱ top 又减 padding-top、㊲ 去掉内衬、㊳ 去掉 `@supports` 守卫、㊴ 圆角不夹住）各自只红对应那条。

**产物与工具链记录**：PC exe md5 `ff3cb0f6254032a065dcfa9984287754`；dev APK `onethu-android-arm64-dev.apk` 18,781,053 字节 / md5 `ad5b13eca6b2cb1e049871ad9523e8a0`。Android 构建走既有脚本 `/home/lin/tools/build-android-dev.sh`（JDK 17、SDK、NDK 27 都在 `/home/lin/tools`）。**注意软链有两套值**：脚本的 `restore_link` 复位成上游 mac 路径 `/Users/st/onethu-android`，而仓库记录（`theme-system-test.mjs` 的断言）要求的是脱敏占位值 `<安卓工程目录>` —— 构建后必须再手动 `ln -sfn '<安卓工程目录>' apps/desktop/src-tauri/gen/android`，否则门禁会红（本次踩到并已复位）；`adb.exe install` 必须传 **Windows 路径**（`D:\OneTHU\…`），传 `/mnt/d/…` 会 `failed to stat`。

---

## 27. 动效复核批次（2026-10-07，按 review-animations / animate 的判据）

来源：对「已落地」的动效逐条按 Emil Kowalski 的十条标准复核（对象是既有动效，不是新增动效）。
动效层的机制（令牌、错峰、退场相位、边缘反馈、揭示器）保持原样，本节只记修掉的缺陷与配方。

### 27.1 底栏胶囊的连点打断（`lib/motion.ts`）

**问题**：`useBottomNavPill` 起新动画前不取消旧动画，关键帧起点取 `prevRef`（上一次的**逻辑**落点）。
底栏是一秒内可能连点两次的元件：先跨长程（行程 220ms + 回弹 200ms = 420ms）、再点相邻项（140ms）时，
第二条动画先播完，第一条仍在运行并把 `transform` 抢回去，胶囊弹回旧方向；即使不发生抢夺，新动画
从逻辑落点起步也会跳一下。既有的「快速连点不排队不跳帧」在 §3.10 一直记为未核对。

**改法**：新增 `presentationCenter(pill)` —— 读 `getComputedStyle(pill).transform` 的 `m41`（WAAPI 进行中
时该值即动画当前值 = 表现值），中心 = `m41 + 布局宽 / 2`（缩放 origin 是中心，不改变中心），读完执行
`getAnimations().forEach(a => a.cancel())`。`place()` 分两步：目标未变（`target` 与 `c1` 相差 < 0.5px）
直接返回，不打断也不重播；目标变化才取消旧动画并从表现值起步。

**护栏**：`nav-shell-test.mjs` 新增 2 条（助手必须读 `getAnimations` 并 cancel；起点必须取
`presentationCenter` 的返回值；目标未变的早退必须在位）。

### 27.2 入场动画的 fill-mode（`styles/global.css`）

**问题**：主文件里 30 处入场动画写 `both`。`both` = backwards + forwards，终帧的 `transform: none`
会**永久**压过同元素的 `:hover` / `:active`。K5「今日页余额速览按下是突变」的根因即此，当时的处置是
改用独立 `scale` 属性绕开，而 `@supports not (scale: 1)` 的旧引擎路径仍是突变（注释里已如实写明）。

**改法**：入场一律 `backwards`。`both` 只保留三类：①名字以 `-out` 结尾的退场与 `m-sheet-down`
（节点要播完退场再摘）；②`m-check-draw`（描边终点承重）与 `ctx-bloom`（终���的 `clip-path` 圆角承重，
改为 backwards 圆角会掉）；③`ctx-blur-in` / `ctx-item-in`（`context-menu-test` 钉着，终帧与基态同值）。
同批收敛：`.plg-mask` / `.plg-sheet` / `.mail-compose*` 的入场曲线由内置 `ease` 改为
`var(--dur-2) var(--ease-out)`，与同族退场的 accelerate 配成进出场两条曲线。

### 27.3 待办页统计数字的弹入（`styles/global.css`）

`stat-pop` 原为 `scale(0.6)` + 400ms + `--ease-overshoot`，挂在 `key` 随计数变化的节点上（计数一变即
重播）。`scale(0.6)` 低于入场下限（0.9–0.97），400ms 超过 UI 预算，元素无动量却带回弹。改为
`scale(0.92)` + `var(--dur-2)` + `var(--ease-out)` + `backwards`。

### 27.4 主题切换的顶栏垫层（`styles/motion.css`）

手机顶栏本体透明，底色由 `::before` 垫层按 `--topbar-bg-alpha` 铺。`html.theme-anim` 的过渡名单里
只有 `.mobile-topbar`，垫层不在其中，于是每次切主题顶栏有一帧到位、约 300ms 的色差（既有记录里的
残余项）。名单补上 `html.theme-anim .mobile-topbar::before`。

### 27.5 死动画与重复规则的清理（`styles/global.css`）

- `.data-table tbody tr` 与 `.week-course` 都写 `animation: rise …`，而 `rise` 关键帧全仓不存在：
  两条动画从未生效（课表块的逐行入场实际由 `pages/Schedule.tsx` 的内联 `m-rise` 负责）。两条声明删除。
- `.skeleton::after` 有两份同名规则，后一份整体覆盖前一份；生效的时长与曲线由 `motion.css` 的同名
  规则（1.15s + linear）给出。删除死的那份，以及只被它引用的 `@keyframes skeleton-shine`。
- `.toast-host` 在 `global.css` 还留着一条 `plg-up 0.2s ease both`，被 `motion.css` 的同选择器整体覆盖，
  且那条丢了 `translateX(-50%)` 居中。删除，只保留 `motion.css` 一份。
- `.trace-card`（寻迹页详情卡）借用 `dock-msg-in`，而那条关键帧的 `from` 是整条 `transform: translateY(4px)`，
  把卡片基态的 `translate(-50%, -100%)` 锚定位移一并顶掉——入场的 160ms 里卡片跳到锚点再弹回原位。
  新增 `@keyframes trace-card-in`（`from` 带上锚定位移）并改挂，与提示条 `m-toast-in` 必须带
  `translateX(-50%)` 是同一条教训（`motion.css` §9 已记）。
- `@keyframes trace-bounce`（寻迹页选中标记）的 0% 直接写峰值 `translateY(-26px) scale(1.35)`：元素在选中
  之前就在屏幕上，第一帧等于瞬跳 20px 与 13%。改为「静息 → 上冲 → 回落 → 静息」，峰值与终点不变。

### 27.6 护栏与反例

- `motion-tokens-test.mjs` 新增 3 组：①`both` 的允许清单（`motion.css` 与 `global.css` 都扫，越界即红）；
  ②每个 `animation` 名必须有对应的 `@keyframes`（`rise` 那类静默失效不再出现）；③入场关键帧必须带基态的
  锚定位移（提示条的 `translateX(-50%)`、`trace-card-in` 的 `translate(-50%, -100%)`）——匹配用 `[^}]*`
  限定在关键帧块内，窗口写宽会跨到下一条规则、注入反例打不红（本轮踩到并修正）。
- `nav-shell-test.mjs` 新增 2 条（见 27.1）。
- 反例 6 个，逐个验证「注入 → 记红点 → 还原 → md5 逐字节一致 → 回绿」：①把 `.row` 的 `backwards`
  改回 `both` → 「入场动画用了 both：row-in」；②插入 `animation: not-a-real-kf` → 「引用了不存在的
  @keyframes」；③把胶囊起点改回 `target` → 「起点不是当前表现值」；④去掉目标未变的早退 →
  「目标没变时又重启动了动画」；⑤`trace-card-in` 去掉锚定位移 → 「trace-card 的入场关键帧丢了
  translate(-50%, -100%)」；⑥`m-toast-in` 去掉 `translateX(-50%)` → 「提示条关键帧丢了 translateX(-50%)」。

### 27.7 未纳入本批（复核发现，待另行拍板）

| 项 | 现状 | 为何未动 |
| --- | --- | --- |
| `mine-grad-flow` 24s 常驻循环 | 「我的」页渐变持续流动（周期 0.04Hz） | 由霖提出，且 `mine-page-test.mjs` 有断言钉着；慢速循环是前庭不适来源之一，去留需拍板 |
| 折叠箭头三套曲线 | `motion.css` 300ms spring / `.home-card-fold` 140ms smooth / `.nav-folded-toggle` 140ms 内置 ease | 属一致性收敛，改动面跨三个组件，留待下一批 |
| 同一 `page-in` 五种时长 | 180 / 200 / 240 / 260ms 各挂在不同容器 | 同上 |
| 滚动揭示每次再入视口都重播 | `installScrollReveal` 退出视口即撤标记 | 霖 2026-09-23 明确要求，属取舍确认 |
| 逐帧模糊半径（`.ctx-blur` / `dock-panel`） | 现代引擎可接受，WebView 96 未验 | 需真机量测 |
| `will-change` 常驻 | `.page-anim` 与 `.hw-card` 上没有「动画结束移除」 | 低危，随下一批清理 |
| `useNavIndicator` / `.nav-indicator` | 已由 `display: none` 停用，护栏仍在断言 | 与抽屉 DOM 一并在收尾批次退役 |
| `tools/motion-test.mjs` | 不在 `pnpm guard` 链上（anim-delight 分支遗留），§2 的令牌断言早已失效 | 该文件需整体复核或退役，本轮只在注册的 `motion-tokens-test.mjs` 上加断言 |

### 27.8 长按菜单的弹出方向（霖真机复验 → A/B 取证，2026-10-07）

**现象**（霖，K90）：手机端长按呼出的菜单预期在按点左上方（避开手指），实际弹在右下方，被手指遮住。

**根因**：同一次手势会开两次菜单——① JS 的 500ms 长按计时器（`pressHold` 记下时间戳后 `fire` → 页面
回调 `menu.open`）；② Android WebView 为长按**补发**的 `contextmenu`（P 批 A3-PC 给长按区与全局兜底
层都加了监听）。方向原先由 `takeHoldOrigin()` 在布局效应里**现算并一次性消费**时间戳：第一次读走之后
置 0，第二次读必然为假 → 菜单被重新定位到右下。`useLayoutEffect` 的依赖是 `[req, panelKey]`，第二次
open 换了请求对象即重跑，于是表现为「先左上、再翻到右下」。

**改法**（形状变更、含义未变）：
1. `CtxRequest` 增加 `hold`：方向在 `openMenu` **打开那一刻定死**并随请求带走；布局效应只读
   `req.hold`，不再现算。判据三条取或：`isHoldOrigin()`（长按计时器已跑）/ `isTouchContextMenu(x, y)`
   （这条 `contextmenu` 是手指长按补发的：800ms 内有过手指按下且按点相距 ≤24px）/ 菜单已开着且本来就是
   手指开的（同一次手势的第二条路径）。
2. `takeHoldOrigin` 改为**只读**的 `isHoldOrigin`（删掉 `holdAt = 0` 那行）：在「一次手势两条路径」的
   结构下，「读一次就清」必然误判。
3. `createLongPress.begin` 记下最近一次手指按点（`lastTouch`）：计时器若被 `touchcancel` 掐掉、或
   `contextmenu` 比计时器先到，仍能认定这次是手指。
4. 鼠标右键与顶栏「···」触发的菜单不受影响（两者都不经过 `createLongPress.begin`，三条判据全为假）。

**第一次改完仍有症状 → 第二个成因（同一处，2026-10-07 当晚二修）**：改方向之后霖复验「还是向右下弹」。
用**系统级真实触摸**（`adb shell input motionevent`，物理坐标）复刻真手指长按后发现：方向已经对了
（`transform-origin` 落在右下角），但**落位量错了**——按点 (206,298) 的菜单落在 (158,250)，
正好是「按点 − 48px」（48 = `CTX_BLOB_SIZE`）。根因：入场动画 `ctx-bloom` 的填充是 `both`，
而落位用的 `getBoundingClientRect()` 在同一次手势的第二次打开（contextmenu 与长按计时器只差 **约 6ms**）
跑在动画「尚未开始、backwards 填充生效」���那一刻，量到的是 0% 帧的液团尺寸 48×48。
**改法**：①尺寸改取**布局盒** `el.offsetWidth/offsetHeight`（不受 transform 影响，两条路径量到同一值）；
②同一次手势且内容态相同（`panelKey` 一致、按点相差 <4px）时**沿用第一次的落位与液团**，不再重量。
**教训**：这一次的 A/B 探针把补发的 `contextmenu` 放在按后 850ms，而真机只差 6ms —— 假阴性由此产生。
探针的时序必须与真机同量级，否则测的是另一条路径。

**真机 A/B**（K90 / WebView 143；同一目标「待办页前台作业卡」、同一按点 (206, 346)）：

| 构建 | ① 只走长按计时器 | ② 补 contextmenu（Android 实际会发的那条） |
| --- | --- | --- |
| 修复前 | 左上：`r=206, b=346`，origin `148px 169.198px` | **右下（缺陷复现）：`l=206, t=346, r=354, b=515`，origin `0px 0px`** |
| 修复后 | 左上：`r=206, b=346` | 左上：`r=206, b=346`，origin 保持 `148px 169.198px` |

判据：菜单右缘/下缘贴按点 = 左上（手指不遮菜单）；菜单左缘/上缘贴按点 = 右下。复刻用的旧包取自
`onethu-android-arm64-dev.apk.bak-1007-动效复核前`（临时改名成 `.apk` 安装，验完删除）。
上表的合成探针只覆盖「两条路径相隔 850ms」的时序；真机上两条路径相隔约 6ms，因此**二修后用系统级
真实触摸**（`adb shell input motionevent` 物理坐标）复验：按点 (206, 346) → 菜单
`l=58, t=177, r=206, b=346`、`inlineL/inlineT = 58px/177px`、origin `148px 169.198px`，
与「按点 − 菜单尺寸」逐像素相符（左上）；二修前同一按点为 `l=158, t=250`（= 按点 − 48px）。

**护栏**：`tools/context-menu-test.mjs` 的 #4 断言组按新形状重写（判定入口 `isHoldOrigin` /
`isTouchContextMenu`、`hold` 随请求带走、`holdAt = 0` 只允许出现在声明里）。反例 2 个：①去掉
`isTouchContextMenu` 与沿用分支 → 红；②把 `isHoldOrigin` 改回「读一次就清」→ 红。

**产物**（二修后，2026-10-07 21:48/21:52；中间产物 21:20 APK 与 21:34 exe 是只含一修的那两份）：
dev APK `onethu-android-arm64-dev.apk` 18,781,053 字节 / md5
`5f713d13b1ca488654fdae3849d01164`（已装 K90，`lastUpdateTime 21:48:34`）；dev exe
`onethu-dev.exe` 19,657,728 字节 / md5 `8cf6407f9c637a35e56398644843ae39`。

### 27.9 未取到项

本批只跑静态门禁（`pnpm guard` exit 0、`tsc --noEmit` 0 错），**未经真机与浏览器验收**：胶囊连点
打断的实际观感、入场 fill-mode 修正后在旧引擎（WebView 96）上的按压反馈、主题切换的顶栏色差，
三项都需要在设备上复验。
