# 设计语言（OneTHU 视觉规范）

令牌层解决「有什么可用」，本手册解决「怎么用」。改版期间为活文档：M3 每批次验收对照本手册逐条过，
新增规则或放宽规则都改这里，并以 `docs/design-language.md` 的 diff 作为依据。

可执行的只有两条（其余靠走查）：`node tools/style-scan.mjs` 查 4pt 间距与字阶，
`node tools/token-guard.mjs` 查「引用了不存在的令牌」。

---

## 0. 令牌三层与写法

`packages/ui/src/tokens.css` 分三层，写入顺序即阅读顺序：

| 层 | 前缀 | 谁能用 |
|---|---|---|
| Reference | `--md-ref-palette-*`（`palette.css`，生成物） | **只有 System 层**。组件直接引用会让主题/暗色失效 |
| System | `--md-sys-color-*` / `-shape-*` / `-typescale-*` / `-elevation-*` / `-motion-*` | 新代码 |
| Compat | `--bg` / `--surface` / `--primary` / `--text-1` …（39 个旧名） | 既有代码；语义与 System 一一对应。**主题覆盖仍写在这层**（注入时自动镜像到 System，见 §0.1） |

`@css
/* ✅ 新代码用 System 角色 */   /* ❌ 组件里直接用 Reference 层 */
color: var(--md-sys-color-on-surface-variant);  color: var(--md-ref-palette-neutral-50);
background: var(--md-sys-color-surface-container-lowest);  background: #ffffff;
`@

### 0.1 主题与两层的关系（真回归的教训）

主题覆盖写的是 **Compat 层**的老名字（`--surface` / `--border` / `--primary`…，7 个内置主题都是这么写的），
而 Compat 只是 **Compat → System 的单向别名**——覆盖 Compat **不会**回流到 System。
所以组件一旦迁到 System 角色（§3.5 B1 的按钮/chip/FAB），主题就会"改了 Compat、按钮却不变色"（已实测发生过）。

现在的做法：注入主题时把每条 Compat 覆盖**镜像**到对应 System 角色（同一选择器、同一个值），
老组件读 Compat、新组件读 System，两边同时跟随主题；
镜像表 `state/theme.ts` 的 `COMPAT_TO_SYSTEM` 由 `tools/theme-system-test.mjs` 从 `tokens.css` 反解逐条核对，**漂移即红**。
新增主题照旧只写 Compat 名；新增组件照旧只读 System 角色——中间那层映射由代码负责，谁都不用记两套名字。

最后一条同样重要：**颜色不写死十六进制**。写死的色值在切主题、切暗色时不会跟着变，
在暗色下就是一块刺眼的亮斑。

### 动态取色（§3.4）

Android 12+ 打开「跟随系统取色」后，System 颜色角色由系统 Material You 调色板重算。
原生侧只回「族 × 档位」（primary / secondary / tertiary / neutral / neutralVariant，后缀 = tone×10），
映射表在 `apps/desktop/src/lib/dynamicRoles.ts`（纯函数，单测 `tools/dynamic-color-test.mjs`）。

| 跟随取色（22 个角色） | 不跟随（语义必须稳定） |
|---|---|
| 品牌：`primary` / `primary-hover` / `on-primary`、`secondary` / `secondary-container` / `secondary-container-border` | 功能色：`error` / `warning` / `success` 及其 container |
| 面与字：`surface` 五级 + `skeleton` / `skeleton-shine`、`on-surface` / `on-surface-variant` / `outline` / `on-surface-disabled`、`outline-variant` / `-soft` / `-strong`、`state-hover` / `state-pressed` | 焦点环 `--md-sys-focus-ring`（键盘可达性标识，跨主题恒定） |

- 档位按 M3 约定：亮色 `primary` = tone 40（键 `400`）、暗色 = tone 80（`800`）；
  面层级用 `mix()` 从基面按 0.035–0.18 派生——系统调色板档位稀疏（1000 → 900 是一大跳），
  直接取相邻档做卡片面会得到刺眼的分层。
- 写入位置：`<style id="onethu-dynamic-color">`，选择器 `html:root[data-dynamic="on"]`
  与其暗色变体（特异性 0,2,1 / 0,3,1，高于令牌 `:root` 与主题注入 0,2,0）；关掉开关即整体移除。
- **降级链**：系统取色 → 「清华紫」主题 → 跟随系统亮暗。原生不可用（桌面 / Android < 12 /
  厂商 ROM 裁掉调色板）时 `enableDynamicColor()` 清场并激活清华紫，不留「半套」配色，
  且**把开关如实置为开**。开关的唯一真源是本地偏好；旧实现在这条分支写了 `pref=false` 并返回 false，
  用户看到的是「主题变了、开关还是关的、也回不去」的死结（Windows 侧实测到），
  现在由 `dynamicPlan()` 纯函数兜住：任何状态下「开启」都一定真的开启。
  快照还必须能表达**「用户当时没选主题（基础令牌）」**，且不能让降级主题占住 `activeId`：
  否则关掉开关会停在清华紫不动，用户得手动再选一次才刷新（Windows 侧反馈，`tools/dynamic-flow-test.mjs` 钉住）。
- **手机端回归**：`node tools/phone-regression.mjs`（需真机在线）遍历每个导航页，检查页面挂载、
  横向溢出、JS 异常、`is-phone` 密度层、待办页手机单栏、取色开关与本地偏好是否一致。
- 取不到的档位一律不注入该角色，保留令牌默认值。
- **档位方向必须运行时自检**，不能写死：真机（Xiaomi / Android 16 / SDK 36）实测 `system_neutral1_0 = #FFFFFF`、
  `system_neutral1_1000 = #000000`，后缀与 M3 tone **反向**；AOSP 的命名约定相反。
  映射表内部一律用 M3 tone（0=黑 … 100=白）表达语义，由 `makeLookup()` 先自检方向、再按 tone 就近取档；
  写死方向会得到反的亮暗面（亮色模式近黑纸面）。第一次实现就踩了这个坑，靠真机抓出来。
- **主题必须让位**：主题注入的 `:root[data-theme]` 块自己声明了 `--accent` / `--bg` 这些兼容变量，
  与取色并存会得到「面跟随壁纸、强调色还是主题的」半套配色（真机实测：`--md-sys-color-surface` 变了，
  `--accent` 还是主题的蓝）。所以开启取色时主题退场、关掉时把主题或昼夜调度接回来；
  取色生效期间主题注入整体跳过（昼夜调度不会偷偷把主题压回来）。
- 取色期间由取色自己驱动 `data-scheme`（主题让位后没人再设它了），并跟随系统亮暗变化。
- **真机验收**（设备在线时）：`tools/device-palette.json` 存了实测调色板样本，单测直接回放；
  实测 `surface=#191C20`（tone 10）、`primary=#9FCAFD`（tone 80，暗色模式该亮）、`accent=#BAC8DB`（跟随 secondary）。
- **未验证项**：真机读取（需 Android 12+ 实机）。原生命令目前只有 APK 构建的编译校验；
  失败时按上面的降级链走，不会破相。

---

## 1. 字阶：五档，各占一个语义位

五档与语义**一对一**，不新增第六档：

| 令牌 | 值 | 唯一语义 |
|---|---|---|
| `--md-sys-typescale-display` | 24px | 页标题（`PageHead` 的 h1） |
| `--md-sys-typescale-headline` | 20px | 卡片标题（`hw-card-title`、`task-sec-title`） |
| `--md-sys-typescale-title` | 16px | 小标题 / 弹层标题 |
| `--md-sys-typescale-body` | 14px | 正文、列表主行 |
| `--md-sys-typescale-label` | 12px | 辅助信息、时间戳、标签 |

`@css
/* ✅ */                          /* ❌ */
font-size: var(--text-xl);         font-size: 22px;      /* 规格外 */
font-size: var(--text-base);       font-size: 13px;      /* 规格外（--text-sm） */
font-size: var(--text-xs);         font-size: 0.95em;    /* 相对值，层级会漂 */
`@

**同屏最多 3 档**（页标题 + 正文 + 辅助是常见组合）。第四档出现时，先问能不能降级或删掉。

现状（`tools/style-scan.mjs`）：**97 处规格外**字号，集中在
`11px×26 / 13px×24 / 10px×20 / 10.5px×9 / 15px×7 / 11.5px×3`。
其中 `--text-xxs`(11px) 与 `--text-sm`(13px) 是明确的退役对象，
10px / 10.5px / 11.5px / 12.5px / 18px / 21px / 22px 属历史遗留，
在 M3 组件批次里逐块收敛到五档。

§3.8 的「移动端 base 14→15px」与本表不冲突，因为那是**令牌值的断点覆盖**而非新档位：
只改 `--md-sys-typescale-body`（与 `--text-base`）在移动端的取值，五档仍是五档。
组件里照旧写 `var(--text-base)`；**字面量 `15px` 依旧违规**（扫描按字面量判），
所以这条规则不因为基准位移而放宽。

---

## 2. 4pt 间距网格

`padding` / `margin` / `gap` 的 px 值只允许 4 的倍数。标准档位七个，对应令牌 `--gap-1..6`：

`@text
4 (--gap-1)  8 (--gap-2)  12 (--gap-3)  16 (--gap-4)  24 (--gap-5)  32 (--gap-6)
`@

`@css
/* ✅ */                                  /* ❌ */
padding: var(--gap-3) var(--gap-4);        padding: 6px 10px;
gap: 8px;                                  gap: 10px;      /* 不在网格 */
margin-bottom: 24px;                       margin-bottom: 20px;
`@

- 例外：`1px` 描边（`border`）不属于间距，不扫描；图标内部绘制坐标不扫描。
- 允许 `0`、`auto`、`%`、`calc()` 与 `var()`（走令牌即视为合规）。
- 现状：**557 处不在网格**（`global.css` 556 / `motion.css` 1），最高频是 `10px`（161 处）。

基线策略见 §8：`tools/style-scan-baseline.json` 只拦**新增**，清理一批就把基线调低。

---

## 3. 分层：色块优先、描边辅助、阴影克制

三级 surface 表达层级，**同一元素只用一种手段**：

| 层级 | 令牌 | 典型用途 |
|---|---|---|
| 页面底 | `--bg`（surface） | `.content` 背景 |
| 分区 | `--bg-soft`（surface-container-low） | 页面内的成组区域、侧栏 |
| 卡片 | `--surface`（container-lowest）/ `--surface-2`（container） | 卡片、面板、列表容器 |

`@css
/* ✅ 卡片 = 色块 + 圆角，无边框无阴影 */
.card { background: var(--surface); border-radius: var(--r-lg); }

/* ❌ 三重表达：更深的底 + 描边 + 阴影同时上，层级反而说不清 */
.card { background: var(--surface-3); border: 1px solid var(--border); box-shadow: var(--elev-2); }
`@

阴影 `--elev-1..3` **同屏最多 2 级**；浮层（弹窗、抽屉、命令面板）才用 `--elev-3`。

**§3.5 B2/B2b 已落地**：页面底 `--md-sys-color-surface-container-low`（比卡片低一级），
卡片与列表面板（`.card` / `.home-card` / `.plg-stat` / `.plg-card` / `.app-card` / `.week-course` /
`.plg-install` / `.mail-list` / `.mail-detail`）`container-lowest` 色块 + 形状令牌，**去描边、去阴影**；
卡片/列表行 hover 走 §5 状态层。护栏 `tools/card-layers-test.mjs`（含未迁移清单——输入类保留描边、
浮层保留描边+阴影、表格线是网格语义、模态内卡片随 B3）。
暗色下阴影几乎不可见，层级改由 surface 明度承担——所以只靠阴影分层在暗色里会塌掉。

### 3.1 滚动条：令牌化，不用平台默认风

滚动条是页面里出现频率最高的系统部件，用平台默认风（两端箭头、灰蓝渐变槽）会立刻泄掉整体感。
统一在 `packages/ui/src/base.css` 用 `::-webkit-scrollbar` 定制（目标环境 WebView2 / Android WebView 都是 Chromium）：

`@css
*::-webkit-scrollbar { width: 10px; height: 10px; }
*::-webkit-scrollbar-thumb {
  /* 主色相 × 20%：换主题跟着变色，又浅到不抢视线（悬停 32%、拖拽 46%） */
  background: color-mix(in srgb, var(--md-sys-color-primary) 20%, transparent);
  border: 3px solid transparent;                /* 视觉 4px、命中区 10px */
  background-clip: content-box;
  border-radius: 999px;
}
*::-webkit-scrollbar-button { display: none; }  /* 去掉两端箭头 */
`@

深浅有护栏：默认态混色 **≤ 22%**（滚动条不能比内容抢眼），悬停/拖拽必须逐级加深；
色相走 `--md-sys-color-primary`，所以换主题（乃至切暗色）滚动条都会跟着变。

**别写 `scrollbar-width` / `scrollbar-color`**（`none` 除外）：Chromium ≥121 一旦看到这两个属性就
整体忽略 `::-webkit-scrollbar`，桌面端会悄悄退回平台默认风。护栏 `tools/scrollbar-test.mjs` 会拦住它。



**滚动条槽（PC 专属坑）**：`base.css` 给 `html` 预留 `scrollbar-gutter: stable` + `overflow-y: scroll`。Windows/WebView2 上 `::-webkit-scrollbar` 的 10px 是**占布局**的，切 tab 时内容高度变化会让滚动条出现/消失，**整页横移 10px**（用户报的「所有 tab 页切换时整页轻移、方向随切换」）。Android 是覆盖式滚动条，本就没有这个位移（真机实测 `clientWidth` 不随内容溢出变化）——所以这是 PC 专属缺陷，手机端验不出来。


**独立文档（iframe）里的滚动条必须各自注入**：父页面的 `::-webkit-scrollbar` **进不去子文档** —— 邮件正文预览（`sandbox="" + srcDoc`）就是这么一直显示平台默认滚动条的（用户 2026-02 报「预览滑动条还是旧版」）。注入 `srcDoc` 时按 base.css 的语言重写一份（10px 命中区 + 3px 透明边 → 视觉 4px、透明轨道、去两端箭头）；子文档也**取不到父页面的 CSS 变量**，所以要用字面色值（或 `prefers-color-scheme` 分支）。护栏：`tools/scrollbar-test.mjs` 第 6 条。
### 3.2 输入/表单：描边保留，其余全令牌化

输入类与卡片**相反**：卡片去描边，输入类**必须保留 1px 描边**（§3：描边属于输入语言）。统一的是：

| 项 | 规则 |
|---|---|
| 高度 | 38px 常规 / 40px 搜索框与手机端 / 32px 紧凑行内（筛选条等） |
| 横向 padding | 12px（落 4pt 栅格） |
| 圆角 | 形状令牌 medium |
| 底色 | surface-container；聚焦时切 container-lowest |
| 聚焦 | outline 关掉 + 描边转强调色 + 令牌聚焦环 md-sys-focus-ring |

紧凑行内控件（filter-select / hwremind-custom input / trace-opt select）尺寸跟随所在行，

### 3.3 弹层：桌面居中对话框 / 手机底部抽屉

浮层是 §3 分层的**例外**：它允许「描边 + 投影」同时在（与页面不是同一层级关系，需要"浮起来"）。统一后：

| 端 | 形态 |
|---|---|
| 桌面 | 遮罩 `--md-sys-color-scrim`；面板 `container-lowest` + 形状令牌 large + `--md-sys-elevation-3` |
| 手机 | **bottom sheet**：贴底、满宽、只圆上面两角、92dvh 限高、CSS 把手（`::before` 32×4 胶囊）、`env(safe-area-inset-bottom)`、`m-sheet-up` 上滑入场 |

抽屉内卡片（`.wb-kind` / `.wb-row`）在**白底弹层**上用灰阶 `surface-container` 分层，不再描边；
`.wb-row` 的 hover 接共享状态层。遮罩新增 System 角色 `--md-sys-color-scrim`（明暗各一档）。
护栏 `tools/modal-shell-test.mjs`。
在护栏里单独登记，不并入常规输入。护栏 tools/input-system-test.mjs。

---


**两个必须踩过的坑（都已进护栏）**：
- **弹层一律 portal 到 body**。.plg-mask 曾经也是 position: fixed，但挂在页面子树里 —— 祖先的动画/变换会成为 fixed 的包含块，遮罩于是只盖住所在页面那一块（霖实测：插件设置页只把插件页遮黑）。同族其它弹层本来就 portal，漏了一个就出这种"局部变黑"。
- **退场动画必须显式写**。入场各写各的没问题，但退场缺一条 CSS，弹层就会在卸载瞬间"啪"地消失。整族统一：遮罩 m-fade-out / 面板 m-pop-out / 手机抽屉 m-sheet-down，曲线用 accelerate（离场加速）。内联样式写的弹层（如校园卡充值）没有相位，要自己补 closing + 延时关闭，且 closing 状态必须放在早返回之前（hook 顺序护栏会抓）。
**第三个坑：内联 `animation` 会压掉 class 的退场动画**。校园卡充值弹窗的 `maskStyle`/`panelStyle` 是内联样式且自带入场 `animation: … both`，而**动画在层叠顺序上优先于内联样式**——退场时无论怎么改内联 `opacity`，终态值都被动画按住，表现就是"等了 0.x 秒然后啪地消失"。修法：入场也搬到 class 上（`.rch-mask`/`.rch-panel`），退场再由 `.is-closing` 换动画。

**退场相位的两种落地（按弹层实现方式分流）**：
- 走共享 class 的弹层：closing 时挂 .is-closing，CSS 换退场动画（遮罩 m-fade-out / 面板 m-pop-out / 手机抽屉 m-sheet-down）。
- 内联几何弹层（maskStyle/panelStyle 写死 position/inset）：本项目策略禁止用 CSS 类给它们加样式（style-scan 护栏会拦，
  理由是内联属性优先、类样式不生效）。这类弹层退场也走内联：closing 时把 maskOut/panelOut 合并进 style，用退场 animation 覆盖入场那条。

共用相位逻辑在 apps/desktop/src/lib/useExitPhase.ts：幂等、卸载清定时器、受控弹层传 open 重开复位、
EXIT_MS 与 --dur-2（short-4 = 200ms）同源。关闭入口一个都不能漏——遮罩点击、关闭按钮、取消、Escape 都走 requestClose；
护栏 [12] 会检查这五个已迁移组件是否残留直接 onClose。

### 3.4 导航壳：底栏 / 侧栏 / 大标题（B4）

**移动端 navigation bar**：5 目的地；激活项有 **64×32 胶囊指示器**（`--md-sys-color-secondary-container`，`corner-full`）**压在图标之下**（图标与文字 `z-index: 1`），激活标签走 `on-surface`、图标走主题 `--accent`；**不用 `border-top`** 分层，靠色阶 + 高程（B2 约定）；贴底必吃 `env(safe-area-inset-bottom)`。**胶囊是单个滑动元素**：切换时按导航共享的那套运动（平滑切换 + 惯性回弹）水平移动，不再是每一项各自的 `::before` 就地淡入。运动数值与旧竖条**共用一组常量**（`NAV_EASE` / `NAV_APEX` / `NAV_BOUNCE_MS` …，见 `lib/motion.ts`），几何适配两处：竖直位移换水平位移；形变从「细线纵向拉伸」改成**横向拉伸 + 竖向略收窄**（`NAV_PILL_STRETCH_MAX` = 1.4 上限、`NAV_PILL_SQUASH` = 0.45 耦合，横向越长竖向越瘦，维持体积感）。位置与形变必须落在**同一条 transform** 里——曾把位置放 transform、长度放 height，两条线程各计时，主线程一忙就错位。横向蓝条方案已撤除。

**PC navigation drawer**：`--sidebar-w: 224px`（≤ 240px）；激活项是**整行胶囊**（`secondary-container` + `corner-full`），图标用主题 `--accent`；分区小标题走 `label-medium` + `on-surface-variant`；侧栏背景走 `surface-container` 色阶分层、去 `border-right`；折叠钮是**无描边 tonal** 小按钮。侧栏**不放竖条**：竖条与 drawer 的整行胶囊风格不匹配。其运动后来被底栏胶囊接手（见上），竖条本身不再出现在任何位置。`useNavIndicator` 的 WAAPI 逻辑失去消费者，暂留不删，与抽屉 DOM 一并在收尾批次清理。

**顶部大标题**：compact 下页标题 28/36（`headline-medium`，即 MD3 large top app bar）；滚动后标题收进既有 sticky 小顶栏，大标题只承担页面入口的第一眼层级。

**令牌缺位时的取舍**：System 层暂无 `on-secondary-container`，激活图标色取主题感知的 `--accent`（主题写 Compat → 注入时镜像到 System，见 §0.1）。

**护栏**：`tools/nav-shell-test.mjs`（已进 `pnpm guard`）。注意同名规则在文件里可能有多处、且多档媒体查询都叫 `max-width: 839.98px`，**一律按内容特征挑真身**，不要用下标——护栏第一版就在这上面误读过 `.bottom-nav { display: none }`。

### 3.5 列表项与行

行家族（邮箱、云盘、服务目录、待办、组件绑定、弹窗内行）是最容易各自长歪的一类：

- **圆角**：一律走 System 形状令牌（--md-sys-shape-corner-medium），**不写 border-radius: 10px 这类字面值**；
- **分隔线**：色块优先、描边辅助（§3 总则），要描边就用 --md-sys-color-outline-variant，不要用 Compat 的 --border-soft；
- **状态层**：交互行必须有反馈——hover 一档、press 再深一档，用 --md-sys-color-surface-container → 其 -high 档递进；
- **字面色值**：行类里不允许出现 #rgb / rgba()。

护栏 tools/list-row-test.mjs（已进 pnpm guard）：按行类取规则体，逐条检查圆角/描边/字面色值与状态层。新加行样式时它会直接拦下来。

### 3.6 控件：胶囊 chip 与开关

这两族的病是「各写一套」，B5 归一到一套：

- **胶囊一家**：`.chip` / `.chip-btn` / 快速入口胶囊共用 24px 高、`var(--r-pill)`、`--md-sys-color-surface-container` 底、`outline-variant` 描边；状态层复用 B1 那一层（`.chip-btn` 已并入同一组选择器），焦点环走 `--md-sys-focus-ring`，禁用 38%。
- **开关一家**：`.switch` 与 `.plg-switch` 曾经是 36×22 / 34×20 两套几何、on 态一个走强调色一个走语义绿、拇指一个 `#fff` 一个 `var(--green)`，现在统一为 36×22 + `outline` 描边 + `surface-container-high` 轨道 + `primary`/`on-primary` 的 on 态。开关的状态层是轨道外一圈光晕（`::before`，因为 `::after` 已经被拇指占用），沿用共享的 8% / 12% 令牌。
- **字面值**：全文不再有 `border-radius: 999px`（22 处转 `var(--r-pill)`）；行类/控件类里不允许出现字面色值。

护栏 `tools/controls-test.mjs` 钉住以上各条。

### 3.7 进度、骨架屏、空状态

- **进度**：`.thos-progress-bar` 与 `.cloud-quota-bar` 原是两条配方（5px/`--surface-3` 与 4px/`--border-soft`），现统一为 4px + `var(--r-pill)` + `surface-container-high` 轨道 + `--md-sys-color-primary` 填充。
- **骨架屏**：曾经有**两条互相打架的 `.skeleton` 规则**（一条只给底色，另一条又给 10px 高度 + 渐变 + `cloud-skeleton`），现在合并成一条：底色 `var(--skeleton)`，流光单独一层 `::after` 且色值走 `var(--skeleton-shine)`（暗底上一道刺眼白光就是当年漏掉这条的教训）。
- **空状态**：`.empty` 改为纵向 flex + 8px 间距 + 令牌化文案色，`Empty` 组件新增可选 `icon` / `hint` / `action` 三个槽位 —— 旧调用 `<Empty text="..." />` 一字不改仍然成立。

以上由 `tools/controls-test.mjs` 一并钉住。

### 3.8 PC 分端内容布局（指向 §2.8.2）

逐页的「移动端一套 / PC 一套」不写在本手册，写在 `docs/ui-ux-overhaul-plan.md` 的 §2.8.2（那是规范原文 + 逐行核对表）。这里只留三条通用约定：

- 双栏页**只改容器渲染，不改数据流**：`AssignmentDetailPage`、邮件阅读 pane 等作为子组件被两个壳复用；
- PC 限宽用 `.content:has(> .page-anim[data-page="xxx"])` 定位页面（CSS 选不到祖先，只能靠 `:has()`），含表格的栏目要放开全宽；
- 分端判定统一走 `state/usePlatformLayout.ts` 的 `useExpanded()`，**禁止组件各自写断点**。

护栏 `tools/pc-layout-test.mjs` 把 §2.8.2 的每一行都钉了一条断言——改布局时改断言，别只改文档。

### 3.9 移动端密度层（§3.8 的落点）

手机不是「窄一点的桌面」，它有一套**独立刻度**，写在 `html.is-phone` 里（`global.css`）：

- **正文基准 15px**（桌面窄窗 12.5px），行高 1.6；
- **间距刻度** `--gap-1…6` = 4 / 8 / 12 / 16 / 20 / 24 —— 比桌面窄窗档各抬 2~4px，且全部落在 4pt 网格上；
- **间距与控件尺寸统一走这套刻度**，层内不再出现字面 13px/14px 字号；
- **装饰性分隔线删掉**：卡片头、浮层头脚、弹窗头这些容器本身已有底色分层，再画一条线是重复；行列表、时间轴、设置行的分隔线是**功能性**的，保留。

护栏 `tools/density-test.mjs` 把刻度、行高、字号令牌化，以及「功能性线在、装饰性线已删」都钉住了。

## 4. 用色：中性打底，彩色点睛

- **正文区保持中性 surface**；彩色 surface（tonal container）只用于两处：「今日」卡片、功能分组头。
- **强调色每屏 ≤ 1 处**。蓝色 `--accent` 表达「可点、可去」，红/琥珀/绿只表达状态（错/警/成），不做装饰。
- 功能色不与强调色混用在同一元素的同一属性上（例如「未读」既用蓝底又用红字）。

`@css
/* ✅ 今日卡片用 primary-container，其余卡片中性 */   /* ❌ 每张卡片一个颜色 */
.today-hero { background: var(--accent-soft); }        .card--hw { background: #eef4ff; }
`@

---

## 5. 状态层：hover / pressed / focused / disabled

指针设备用 **state layer 叠色**，不做涟漪；触摸与笔另有涟漪做空间反馈（§2.8.3 × §3.5 B1）：
状态层是**共用的一层** —— 凡可点组件（按钮 / chip / FAB / 待办计数卡 / 今日快速入口）都挂同一个 `::after`（`inset: 0` + `border-radius: inherit`），
变体只改自身底色，不各写一套 hover；焦点环统一 `--md-sys-focus-ring`；涟漪在 `components/Ripple.tsx`（`installRipple()` 全局单监听）。
以上由 `tools/button-variants-test.mjs` 钉住（状态层/焦点环/禁用/涟漪各一条）。

| 状态 | 令牌 | 叠色强度 |
|---|---|---|
| hover | `--hover` | 8% |
| pressed | `--active` | 12% |
| focused | `--ring`（焦点环）+ `--hover` | 8% |
| disabled | 内容 `opacity: 0.38` | — |

`@css
/* ✅ 只叠一层半透明色，色值本体不动 */        /* ❌ hover 改的是色值本体 */
.row:hover { background: var(--hover); }        .row:hover { background: #eceff3; }
`@

后者的后果：主题或暗色切换后，这个写死的 hover 底色不跟着变。焦点环同理——一律用 `--ring`，
不自己写 `box-shadow: 0 0 0 3px rgba(...)`；键盘可达性要求**焦点可见**，所以移除焦点环必须同时给出替代高亮。

---

## 6. 图标：保留自绘体系

`apps/desktop/src/components/Icons.tsx` 是统一的内联线性图标集，本项只做一致性约束，不引入图标库：

- 默认档：18×18，`viewBox="0 0 24 24"`，`strokeWidth 1.6`，`stroke="currentColor"`，`aria-hidden`。
- 尺寸只有 16 / 18 / 20 / 24 四档；**16px 档用 1.4 描边**（小尺寸下 1.6 会显糊），已在 Icons.tsx 内体现。
- 颜色随文字（`currentColor`），不单独给图标上色；状态由所在容器承担。
- 语义重复的图标不新增：先查 Icons.tsx 是否已有同义项。

`@tsx
/* ✅ */                                  /* ❌ */
<IconRefresh />                            <svg strokeWidth="2.2" fill="#333">…</svg>
<IconRefresh size={16} />                  <i className="fa fa-refresh" />
`@

---

## 7. 插画：素材待外部提供，规则先定

§3.7 的插画分两组，**都还没落地**（代码库目前没有任何插画资源）。素材由用户搜集，落盘后按本节规则接入。

### 7.1 清单

**问候插画 5 张**（`apps/desktop/src/assets/greeting/`）——数量与时段必须跟代码里的问候档位一致
（`pages/Today.tsx` 的 `greetWord`：0–5 夜深 / 5–11 早 / 11–13 午 / 13–18 下午 / 18–24 晚）：

| 文件 | 时段 | 题材方向 |
|------|------|----------|
| `greeting-night.svg` | 0–5 | 台灯、月亮、一杯热的 |
| `greeting-morning.svg` | 5–11 | 骑车/步行去教学楼、日出、书包 |
| `greeting-noon.svg` | 11–13 | 食堂餐盘、饭盒 |
| `greeting-afternoon.svg` | 13–18 | 图书馆、摊开的书、咖啡 |
| `greeting-evening.svg` | 18–24 | 晚霞、操场跑道、宿舍窗灯 |

**空状态插画 8 张**（`apps/desktop/src/assets/empty/`）：`empty-tasks` / `empty-mail` / `empty-favs` / `empty-cloud` /
`empty-search` / `empty-grades` / `empty-offline` / `empty-library`。

### 7.2 素材硬要求（不符合就得返工）

1. **格式**：SVG。不要 `text`（字体不保证、无法国际化）、不要外链、不要 base64 位图、不要 `filter`/模糊/阴影/渐变网格；**尽量不用 `style` 块与 `id`/`defs`**——内联进 React 后 id 会互相冲撞；
2. **着色**：单色线稿最佳——描边/填充用 `currentColor`（或纯 `#000`），**不出现固定色值**。这样接入时按令牌（`--accent` / `--accent-soft` / `--amber`）染色，一套图自动适配亮色、暗色与动态取色。若必须多色，请给亮/暗两版，或标明每块用哪种语义色；
3. **画布与线宽**：统一 `viewBox="0 0 96 96"`，描边 1.6–2，`stroke-linecap="round"` `stroke-linejoin="round"`（与图标同源）；**不低于 1.2**，缩到 72–96px 会糊；
4. **留白**：主体占画布约 80%，四边留白一致，否则一排插画看起来大小不一；
5. **体积**：单文件 < 10KB；**命名**用上表的 kebab-case 英文名，并附「文件名 → 用途」对照；
6. **许可**：能随 App 分发即可（CC0 / 公共领域 / 自绘最稳），来源与许可写一行，接入时记进 CREDITS。

### 7.3 接入方式

单色线稿内联成 React 组件按令牌染色，多色位图按 URL 引入并给亮/暗两套；「今日」问候与 `Empty` 组件
（`icon` / `hint` / `action` 槽位已就绪）分别接两组素材。素材到位时同步新增 `tools/illustration-test.mjs`
（数量齐、`viewBox` 96、圆头描边、无固定色值）并进 `pnpm guard`——**在那之前不加这条护栏**，免得常年空转。

---

## 8. 走查机制与基线

**每批次（PR）验收**：对照 §1–§7 逐条过一遍，新增违规由扫描拦下：

`@bash
node tools/style-scan.mjs        # 4pt 间距 + 字阶，只拦新增（基线 tools/style-scan-baseline.json）
node tools/token-guard.mjs       # 引用了不存在的令牌 / CSS 注释嵌套
node tools/theme-vars-test.mjs   # 主题声明的变量名必须真实存在
`@

**基线**：历史违规 `557 处间距 + 97 处字号`已记入基线，**只拦新增**。
按「文件 + 违规值 → 数量」记，不记行号：行号会随任何一次编辑漂移，逐行基线次日即失效。
代价是同文件内「加一处、删一处」能互相抵消——批次验收时人眼补这一位。

**发布前**：一次「细节走查日」，固定清单——焦点态（键盘 Tab 走一圈）、空态、边界宽度
（375 / 768 / 1440）、暗色与跟随系统、系统「减弱动态效果」、超长标题与超长列表。

**清理进度**（每次调低基线后更新）：

| 批次 | 间距不在网格 | 规格外字号 |
|---|---|---|
| §3.9 建档（当前） | 557 | 97 |
