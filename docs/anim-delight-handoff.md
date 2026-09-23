# OneTHU 动效层交接文档（`local/anim-delight` 自用分支）

> 面向接手动效工作的 agent。读完这一份即可开工：背景、设计纪律、代码地图、已实现清单、
> 已知的坑、剩余任务（含文件与行号）、测试与验收方式都在这里。
>
> 分支：`local/anim-delight`（自用，不计划合入上游）。基点落后当前 `origin/dev3` 10 个提交，
> 合入或发布前需先 rebase / merge。

---

## 1. 背景与目标

原始需求（用户原话）：

> 能否再新建一个分支，这个分支也许不会合并到主分支，是我自用的。主题只有一个：动画！动画！还是动画！
> 给 OneTHU 加入大量丝滑、流畅、舒适而且有高级感的动画，在各个角落，要能明显提高使用体验，
> 做到如 Apple 一般的设计感。

落点：**桌面端（Windows/WebView2）与安卓 App 都受益**，但重心在移动端手感——手机是日常使用场景，
且安卓 WebView 对重效果（模糊、视差、大面积合成）最敏感，所以动效层从一开始就按"移动优先"设计。

### 1.1 设计原则

| 原则 | 具体含义 |
| --- | --- |
| 有回应，不喧哗 | 每个可交互元素都要有按压/切换反馈；但没有装饰性动画、没有入场大礼包 |
| 只动合成器属性 | `transform` / `opacity` 为主；颜色、阴影、边框色可过渡；布局属性不进 keyframes |
| 距离短、时长分级 | 位移基准 4/8/14px；四档时长 140/220/340/520ms；长动画会"发黏" |
| 缓动统一 | 出场 `easeOutQuint`、弹层轻弹簧（过头量约 3%）、页面用 Apple 曲线 `(0.32, 0.72, 0, 1)` |
| 尊重系统开关 | `prefers-reduced-motion: reduce` 时 CSS 全量降级 + JS 侧判断，不做"为了而动的"动画 |
| 重效果只给桌面 | 模糊、悬浮抬起、细滚动条只在 `(hover: hover) and (pointer: fine)` 生效 |
| 无 Material 涟漪 | 触摸涟漪做过一版，已按用户偏好**整体移除**（见 §7.7） |

### 1.2 硬性偏好（来自用户，写新动效时逐条对照）

- 文案简短：新增 UI 文案不超过 42 字，能删就删。
- 线性图标，不用 emoji。
- 颜色一律走主题令牌（`--accent` / `--surface` / `--border` / `--hover` / `--shadow-1,2` / `--r-pill`），
  不在组件里写死色值。
- 动效服务于操作路径：优先"点了有回应、切换有方向、列表出现不突变"，其次才是好看。

---

## 2. 分支现状

### 2.1 已提交（5 个）

| 提交 | 内容 |
| --- | --- |
| `565e03b` | `feat(anim)`: 全局动效层——令牌 + keyframes 库 + 通用微交互 + 页面转场 |
| `8d89903` | `fix(anim)`: 去掉整页快照转场（切换残影）；hover 位移只给会跳转的大卡 |
| `2db68b0` | `fix(anim)`: 不再覆盖既有动画选择器——修抽屉"播完消失/关闭重现"与提示条偏心 |

| `1ce0aaf` | `docs(anim)`: 本交接文档 |
| `46ec795` | `feat(anim)`: 分段条滑动块 + 折叠组展开 + 护栏补到 107 断言（§6.1–§6.3 收尾） |

### 2.2 工作区

**工作区已干净**（2026-09-23：`git status` 无改动、`git stash list` 为空）。下表这批改动，
连同 §6 的组件接线与护栏更新，已随 `46ec795` 一起提交：

| 文件 | 改动要点 |
| --- | --- |
| `apps/desktop/src/styles/motion.css` | 新增 §16：页签衔接、滚动揭示、横幅、可展开、退场相位、分段滑动块 |
| `apps/desktop/src/lib/motion.ts` | 新增 `useExitPhase` / `useTabDirection` / `installScrollReveal` / `REVEAL_SELECTOR` / `useSegPill`；移除 `installRipple` |
| `apps/desktop/src/main.tsx` | 入口由 `installRipple()` 换成 `installScrollReveal()` |
| `apps/desktop/src/pages/info/InfoPage.tsx` | `useTabDirection` + 各页签容器 `data-dir={tabDir}` |
| `apps/desktop/src/pages/info/LifePage.tsx` | 同上 |
| `apps/desktop/src/pages/info/ReservePage.tsx` | 同上 |
| `apps/desktop/src/pages/FolderPage.tsx` | 同上；并把栏目布局与 `useTabDirection` 挪到早返回**之前**（见 §6.4 注） |
| `apps/desktop/src/components/FilePreview.tsx` | `useExitPhase(cur !== null)`：预览面板改为"先播退场再卸载" |
| `apps/desktop/src/components/Layout.tsx` | `SegmentedOverflow` 渲染 `.seg-pill`；折叠组包进 `.nav-folded-body` |
| `apps/desktop/src/pages/MailPage.tsx`、`Plugins.tsx` | 两处直写 `.segmented` 也接上滑动块 |
| `tools/motion-test.mjs`、`tools/pdf-render-mode-test.mjs` | 护栏更新（见 §6.3、§6.4 注） |

> 接手第一步仍是 `git status` + `git stash list`，确认没有遗留 stash（历史上多次 stash/pop 过，
> 名称为 `anim-wip*`）。

---

## 3. 代码地图

### 3.1 两个核心文件

- `apps/desktop/src/styles/motion.css`（729 行）：所有关键帧、令牌、全局微交互。
  在 `main.tsx` 里**必须排在 `global.css` 之后**导入，否则同选择器的 `transition`/`animation`
  会被 `global.css` 覆盖（测试 §1 有断言）。
- `apps/desktop/src/lib/motion.ts`（162 行）：只在 CSS 表达不了的地方出手——方向判断、
  退场相位状态机、滚动揭示观察器、数字滚动。

### 3.2 `motion.css` 分区表

| 区 | 内容 |
| --- | --- |
| §1 | 令牌：`--dur-1..4`、`--ease-out/in-out/spring/ios`、`--rise-1..3`、`--stagger: 26ms` |
| §2 | `prefers-reduced-motion` 全量降级（动画 1ms、延迟 0、循环 1 次、过渡 1ms） |
| §3 | keyframes 库：`m-rise` `m-fade` `m-pop` `m-spring-in` `m-sheet-up/down` `m-slide-left/right` `m-toast-in/out` `m-page-in` `m-check-draw` `m-breathe` `m-stripes` `m-knob` |
| §4 | 通用微交互：按压回弹、行/卡按压只压暗、图标钮 svg 缩放、输入框聚焦、焦点环淡入、折叠箭头、开关旋钮 |
| §5 | 桌面悬浮感（`hover:hover and pointer:fine`）：入口大卡上浮 2px；数字卡/卡片只点亮边框底色 |
| §6 | 列表逐项进场：前 14 项 `nth-child` 递增延迟；长列表用内联 `--i` 覆盖 |
| §7 | 页面转场：`.page-anim`（`data-dir="back"`、`data-level="sub"`）、`.content` 首屏揭示 |
| §8 | 弹层：遮罩淡入 + 面板弹簧；桌面加 `backdrop-filter: blur(2px)` |
| §9 | 提示条：`m-toast-in/out`（关键帧里始终带 `translateX(-50%)` 保持水平居中） |
| §10 | 加载：骨架时长、`.bar.is-busy` 斜纹流动、`.dot.is-live` 呼吸 |
| §11 | 数字滚动 `.num-roll`、完成勾 `m-check-draw` |
| §12 | 工具类：`.anim-rise/fade/pop/spring/slide-right`、`.anim-delay-1..4` |
| §13 | 主题切换：`html.theme-anim` 期间颜色 340ms 过渡 |
| §14 | 桌面细滚动条 |
| §15 | 文件预览逐页淡入：`[data-pdf-page]`、`[data-pptx-page]` |
| §16 | 页签衔接（`m-tab-in`）、滚动揭示（`m-reveal-in`）、横幅、可展开（`m-expand-in`）、退场相位（`m-fade-out` / `m-spring-out`）、分段滑动块（`.seg-pill`） |

### 3.3 `lib/motion.ts` 导出

| 导出 | 作用 |
| --- | --- |
| `prefersReducedMotion()` | 系统"减弱动态效果"判断，JS 侧唯一入口 |
| `useNavDirection(page, isSubPage)` | 顶层页 ↔ 二级页方向，决定页面从哪一侧进场 |
| `useTabDirection(activeId, order)` | 页签左右关系方向，配合 `.tab-anim[data-dir]` |
| `useExitPhase(active, ms = 200)` | 退场相位状态机：返回 `{ mounted, closing }` |
| `REVEAL_SELECTOR` | 滚动揭示命中的选择器集合 |
| `installScrollReveal()` | 在 `<html>` 挂 `has-reveal`，用 `IntersectionObserver` 逐个加 `.is-in` |
| `useCountUp(value, dur = 680)` | 数字滚动（`easeOutCubic`），减弱动态时直接返回目标值 |
| `useSegPill()` | 分段条滑动块测量，返回 `[rowRef, pillRef]`；首帧不滑入、量不到宽度不显形 |

方向类 hook 都在**渲染期**比较"上一项 vs 当前项"，幂等，StrictMode 双渲染下结果一致。

### 3.4 接线点一览

| 能力 | 接线位置 |
| --- | --- |
| 动效层导入顺序 | `main.tsx`：`global.css` → `motion.css` |
| 滚动揭示安装 | `main.tsx`：`installScrollReveal()` |
| 页面转场容器 | `App.tsx`：`.page-anim` + `key={page}` + `useNavDirection` |
| 提示条退场 | `App.tsx` + `state/toast.ts`（`EXIT_MS` / `beginExit`）+ `state` 里的 `.is-closing` |
| 主题平滑过渡 | `state/theme.ts`（`theme-anim`，`lastThemeId !== null` 时跳过首次） |
| 移动端顶栏浮起 | `components/Layout.tsx`（`is-scrolled`） |
| 页签方向 | `pages/info/{InfoPage,LifePage,ReservePage}.tsx`、`pages/FolderPage.tsx` |
| 数字滚动 | `components/HomeWidgets.tsx`（`useCountUp` + `.num-roll`） |
| 分段条滑动块 | `components/Layout.tsx` 的 `SegmentedOverflow`、`pages/MailPage.tsx`、`pages/Plugins.tsx`（`useSegPill` + `.seg-pill`） |
| 折叠组展开 | `components/Layout.tsx`（`.nav-folded-body`） |
| 预览面板退场 | `components/FilePreview.tsx`（`useExitPhase` + `.is-closing`） |
| 弹层统一 | `lib/confirm.tsx`、`FilePreview.tsx`、以及测试 §11 列出的 8 个内联弹层文件 |

---

## 4. 已实现动效清单

### 4.1 通用微交互（§4）

- 紧凑控件（`.btn` `.icon-btn` `.chip` `.seg-item`）按压 `scale(0.965)`，70ms 起手、弹簧回落。
- 整行/整卡（`.row-click` `.nav-item` `.entry` `.stat-card` `.tab` `.plg-tab` `.setting-row`）按压
  **只压暗底色**，不改尺寸。原因：手机上按住整行时缩放会被读成"布局变了"，行内 flex 布局还会
  连带文字重排；改成底色反馈后尺寸与排版全程不动。
- 图标钮内的 svg 跟着缩到 `scale(0.9)`，手感更"实体"。
- 输入框聚焦：边框/底色/阴影过渡，不做发光。
- `:focus-visible` 焦点环淡入（`m-focus-ring`），不是突然出现。
- 折叠箭头 `.row-caret` 旋转走弹簧；`.row-click.is-open` / `.nav-folded-toggle.is-open` 触发。
- 开关旋钮切换时 `m-knob` 弹一下（只 scale，不动布局）。

### 4.2 桌面悬浮（§5）

- 只给"点进去会跳转"的入口大卡 `.entry:hover` 上浮 2px + `--shadow-2`。
- 数字卡 `.stat-card:hover`、通用卡 `.card:hover` 只改底色/边框色。原因：数字卡的信息主体是数字，
  位移会让人误以为整块在漂；列表行在鼠标横扫时位移显得抖。

### 4.3 列表逐项进场（§6）

- `.list` `.stagger` `.stats` `.today-grid` `.market-grid` `.icon-grid` 的直接子元素播 `m-rise`，
  前 14 项按 `--stagger` 递增延迟。
- 更长的列表由 JS 给内联 `--i`，选择器 `.list > [style*="--i"]` 优先且不再叠加 `nth-child` 延迟。

### 4.4 页面与页签转场（§7、§16）

- 顶层页签：`.page-anim` + `key={page}` 重新挂载，播 `m-page-in`；`data-dir="back"` 换成从左侧来。
- 二级页：`.page-anim[data-level="sub"]` 用 `m-slide-right`（横向滑入 + 一点纵深）。
- 应用启动：`.content` 播 520ms 首屏揭示（覆盖 `global.css` 的 `page-in`）。
- 页签内容：容器**保持挂载**（页签状态不丢），只切 `tab-anim` 类名重放进场；
  `data-dir={tabDir}` 由 `useTabDirection` 决定方向（`prev` 时从左侧来）。

### 4.5 弹层与提示条（§8、§9、§16）

- 遮罩淡入 + 面板弹簧进场；桌面遮罩加 2px 模糊，安卓不加（模糊开销大）。
- 手机端（`max-width: 860px`）面板改用 `--ease-ios`，更接近 iOS sheet 手感。
- 提示条：入场 `m-toast-in`（下掉 14px + 淡入 + 轻微缩放），退场 `m-toast-out`；
  **两个关键帧都必须带 `translateX(-50%)`**，否则动画期间会先偏右再弹回。
- 退场相位：`useExitPhase` 让弹层/面板先播完退场再卸载（`.is-closing` → `m-fade-out` / `m-spring-out`）。

### 4.6 加载、进度、数字（§10、§11）

- 骨架时长 1.15s；`.bar.is-busy` / `.progress.is-busy` 斜纹流动（`m-stripes` 620ms）；
  `.dot.is-live` 呼吸 2.2s。
- 数字滚动 `.num-roll`：`useCountUp` 走 `easeOutCubic`，`tabular-nums` 防跳动；
  只滚数值型，`–` / `¥12.34` 这类字符串原样显示。
- 完成勾 `m-check-draw` 描边"画"出来。

### 4.7 滚动揭示（§16 + `installScrollReveal`）

- `<html>` 挂 `has-reveal` 后，命中 `REVEAL_SELECTOR` 的元素被置为 `opacity: 0; animation: none`，
  进入视口时由观察器加 `.is-in` 播 `m-reveal-in`（从左侧滑入 14px）。
- 同批进入视口的元素按 26ms 递延（上限 11 个），避免整屏同时亮起。
- 动态内容（翻页、筛选、新数据）由 `MutationObserver` 纳入，100ms 防抖。
- 关闭 JS 或减弱动态时不挂 `has-reveal`，元素保持可见。
- **不能与挂载逐项进场叠加**：两条动画作用于同一元素时，挂载动画结束回落到基态 `opacity: 0`
  会让元素消失。这是本层最容易踩的坑。

### 4.8 抽屉导航（§8 尾部）

- 抽屉本体与遮罩**沿用 `global.css` 的 `drawer-in/out`**，动效层只给抽屉内的 `.nav-item`
  加逐项进场（它们的基态可见，覆盖安全）。
- 侧栏当前项：左侧强调条 `.nav-item::before` 高度 0 → 16px"长出来"，图标 `scale(1.06)`。

### 4.9 文件预览（§15、§16）

- PDF / PPTX 每页淡入（`[data-pdf-page]`、`[data-pptx-page]`）。
- 预览面板进场用遮罩+弹簧，退场走 `useExitPhase`。

---

## 5. 已知的坑与回归护栏

这些坑都已在 `motion.css` 注释里写明理由，`tools/motion-test.mjs` 也有对应断言。

1. **`animation-fill-mode` 用 `backwards`，不用 `both`。**
   入场动画用 `both` 会把 `transform` 锁在终值，压过 `:hover` / `:active`——按压回弹与悬浮抬起
   会整体失效。只有"必须保留终帧"的退场动画（`m-toast-out`、`m-check-draw`、`m-sheet-down`、
   `m-fade-out`、`m-spring-out`）才用 `both`。
2. **整页快照转场已移除。** 实测（2026-09-22）：整页 tab 切换走 View Transitions 时，旧页快照会在
   新页下层以半透明残留（两张整页截图叠加），观感是"旧页面在下面闪一下"。快照转场适合
   "列表卡 → 详情页"这类有共享元素的场景，不适合整页替换。测试 §8 有"禁止回归"断言。
3. **不覆盖既有动画选择器。** `global.css` 里有 28 个选择器定义了 `animation`，其基态可能是"藏身态"
   （典型：`.drawer` 的 `translateX(-100%)` 靠 `forwards` 钉住可见位置）。覆盖即闪没/重现。
   测试 §12 会扫描两文件并比对，允许清单当前只有 `.content` 与 `.toast-host`，且每条必须写理由。
4. **提示条关键帧必须带 `translateX(-50%)`。**
5. **按压反馈分两类**：紧凑控件缩放，整行/整卡只压暗（理由见 §4.1）。
6. **hover 位移只给会跳转的大卡**（理由见 §4.2）。
7. **触摸涟漪已整体移除。** 早期版本在 `lib/motion.ts` 有 `installRipple`、在 CSS 有 `.is-phone .btn`
   相关规则，按用户偏好（无 Material 涟漪）全部删除。`main.tsx` 现在装的是 `installScrollReveal()`。
   遗留注释与 3 条涟漪断言已于 `46ec795` 清理（见 §6.3），并加了"无涟漪回归"断言。
8. **无限循环动画白名单**：只有 `shimmer`（骨架）、`m-breathe`、`m-stripes`，不允许页面一直在动。
9. **单条动画时长上限 700ms**，测试 §3 会扫 `animation: ... Nms`。
10. **`keyframes` 里不出现布局属性**（`width/height/top/left/right/bottom/margin/padding/font-size/line-height`），
    测试 §3 有断言。
11. **`transition: all` 是性能反模式**，测试 §3 禁止。

---

## 6. 剩余任务

> **2026-09-23 进度**：§6.1–§6.3 与 §6.4 的第 1/2/4 条已完成（提交 `46ec795`）。
> 还没做的只剩：**真机 / 桌面验收**、**merge `origin/dev3`（仍落后 10 个提交）**、**安卓 APK 重出**。
> 小节标题标了 ✅/⬜，正文保留原始分析供追溯。

### 6.1 分段条滑动块（`.seg-pill`）✅ 已完成

- CSS 已在 `motion.css` §16 末尾（约 697-729 行）写好：`.segmented` 需要 `position: relative`，
  `.seg-pill` 绝对定位、`transform/width/opacity` 过渡，`.seg-pill.is-ready` 才显形；
  `.segmented:has(.seg-pill) button.is-active` 会把按钮自带底色撤掉。
- 组件侧**尚未渲染** `.seg-pill`（全仓 `grep -r "seg-pill"` 命中 0 个 tsx）。
- 参考实现位置：`components/Layout.tsx` 的 `SegmentedOverflow`（约 86 行起）已经做过"溢出滚动 +
  位置指示条"的测量逻辑（`update()` 里用 `scrollWidth/clientWidth/scrollLeft` 算滑块宽度与偏移），
  滑动块可以复用同一套测量与 `ResizeObserver`/滚动监听接线。
- 需要覆盖的 `.segmented` 使用点：`components/Layout.tsx:148`（`segmented seg-track`）、
  `pages/MailPage.tsx:241`、`pages/Plugins.tsx:84`，以及 `SegmentedOverflow` 的所有调用方
  （`pages/Settings.tsx`、`pages/learn/{NoticesPage,CourseDetailPage,AssignmentsPage}.tsx`、
  `pages/info/{InfoPage,LifePage,NewsTab,ReservePage}.tsx`、`pages/FolderPage.tsx`、
  `pages/zhjwxk/Courses.tsx`）。
- 实现要点：切换页签时块从旧位置滑到新位置（`--dur-3` + `--ease-ios`）；首帧不要从 0 位置滑入，
  用 `.is-ready` 控制首帧不显形；测量失败（宽度为 0）时保持按钮自带底色，避免"没有块也没有底色"。
- ✅ 落点：`lib/motion.ts` 的 `useSegPill()` 返回 `[rowRef, pillRef]`——`rowRef` 挂 `.segmented`、
  `pillRef` 挂 `<span className="seg-pill" />`；测量在 layout 相位完成（首帧就在位，不会从 0 滑入），
  只有量到有效宽度才加 `.is-ready`，CSS 相应改成 `:has(.seg-pill.is-ready)` 才撤按钮底色。
  三处 `.segmented` 全部接上：`SegmentedOverflow`、`MailPage.tsx:241`、`Plugins.tsx:84`。

### 6.2 折叠组展开动画（`.nav-folded-body`）✅ 已完成

- CSS 已在 `motion.css`（约 669-674 行）定义 `.nav-folded-body`（`display: flex; flex-direction: column;
  gap: 1px;` + `m-expand-in`）。
- `components/Layout.tsx` 约 363-395 行的折叠组，展开时渲染的是**裸 Fragment**：

  ```tsx
  {foldedOpen ? (
    <>
      {foldedDefaults.map(...)}
      {foldedUser.map(...)}
    </>
  ) : null}
  ```

  需要把这批 `navRow(...)` 包进 `<div className="nav-folded-body">…</div>`，展开时才有滑入效果。
  收起仍是即时（纯 CSS 无法延迟卸载）；若需要收起动画，走 `useExitPhase` 那一套。
- ✅ 落点：`Layout.tsx` 折叠组已包进 `<div className="nav-folded-body">`，展开滑入生效；收起仍即时。

### 6.3 测试更新（`tools/motion-test.mjs`）✅ 已完成

已完成（`46ec795`）：3 条失效断言按下表改掉、新增断言补齐，现在 `node tools/motion-test.mjs`
**107 条全绿**。下表是当时的失效清单与处理方式（保留供追溯）：

| 失效断言 | 所在区 | 处理 |
| --- | --- | --- |
| 涟漪在入口安装、实现收在 `lib/motion.ts` | §1 | 改成断言 `installScrollReveal()` 在入口安装、实现收在 `lib/motion.ts` |
| `both` 只留给"必须保留终帧"的退出动画（4 处） | §4 | 白名单加上 `m-fade-out` / `m-spring-out`（`.is-closing` 两条规则新增了 `both`） |
| 涟漪只在 `is-phone` 密度层生效（桌面不挂） | §6 | 删除；替换为"按压纪律"断言（紧凑控件缩放、整行只压暗底色、`keyframes` 里没有整行 `scale`） |

已补的新断言（落在 §13–§17）：

- 滚动揭示：`installScrollReveal` 里有 `prefersReducedMotion()` 早退、`has-reveal` 挂在 `<html>`、
  CSS 里 `html.has-reveal … { opacity: 0; animation: none }` 与 `.is-in` 两条规则同时存在
  （防"两条动画叠加导致元素消失"回归）、`motion.ts` 里递延上限为 11。
- 页签方向：四个页面都接了 `useTabDirection`，且页签容器有 `data-dir={tabDir}`；
  `m-tab-in` / `m-tab-in-back` 两个关键帧都存在。
- 退场相位：`useExitPhase` 在 `FilePreview.tsx` 被调用；`.confirm-mask.is-closing` 与
  `.confirm-card.is-closing` 都有 `animation`；`useExitPhase` 默认 200ms 且清理定时器。
- 可展开：`.nav-folded-body` 与 `.collect-row` 都接了 `m-expand-in`；折叠组标记里出现 `nav-folded-body`。
- 分段块：`.seg-pill` 规则齐全（`is-ready`、`:has(.seg-pill)` 撤按钮底色），且组件侧渲染了 `.seg-pill`。
- 横幅：`.browser-hint` 接了 `m-rise`。
- 无涟漪回归：全仓不再出现 `installRipple` / `is-phone .btn` 涟漪规则。
- 按压纪律：`keyframes` 里没有针对整行的 `scale`；整行/整卡的 `:active` 只改 `background`。

跑法：`node tools/motion-test.mjs`（零依赖，`ok(cond, label)` 计数；失败即 `assert` 抛出）。

### 6.4 收尾

1. ✅ 删除 `lib/motion.ts` 末尾的涟漪遗留注释。
2. ✅ `pnpm exec tsc --noEmit` 0 错误。
3. ⬜ **真机 + 桌面各过一遍验收清单**（§7.2 / §7.3）——只能人工，exe 已就位。
4. ✅ 提交工作区改动（`46ec795`）；⬜ 发布前仍需 `git merge origin/dev3`（或 rebase）——落后 10 个提交。
5. 出包：✅ 桌面 exe 已重编并部署到 `D:\OneTHU\onethu.exe`（2026-09-23，带
   `--features tauri/custom-protocol`，prod 校验 `assets/index-` 命中 5；旧产物备份为
   `onethu.exe.bak-0923-anim-segp`）；⬜ 安卓 APK 本次未重出。

> 顺带修掉两个 `46ec795` 之前的遗留问题：
> - `pages/FolderPage.tsx` 在 `if (!f) return null` 之后调用 `useTabDirection()`——Hook 顺序违规：
>   删除收藏夹时本次渲染比上次多一个 Hook，React 抛错且错误边界兜不住，**整窗白屏**。已把栏目布局
>   与方向计算挪到早返回之前；`tools/hook-order-test.mjs` 现在全绿。
> - `tools/pdf-render-mode-test.mjs` 里"必须保留 `if (!cur) return null`"的断言，已放宽为接受
>   `useExitPhase` 的 `if (!shown || (cur === null && !mounted)) return null;` 形态
>   （"早返回之后不得有 Hook"的核心断言不变）。
> - 既有失败、与动效无关、本次未动：`tools/notify-runtime-test.mjs` 有 1 条 DDL 断言失败。

---

## 7. 测试与验收

### 7.1 自动化

| 命令 | 作用 |
| --- | --- |
| `node tools/motion-test.mjs` | 动效护栏（17 个区，107 断言） |
| `pnpm exec tsc --noEmit` | 类型检查（在 `apps/desktop` 下执行） |
| `pnpm run lint:docs` | 文档措辞检查（只覆盖 `docs/`，本文件也在范围内） |
| `pnpm run lint:ui-copy` | UI 文案检查（新增文案后跑） |

### 7.2 真机验收清单（安卓）

逐项确认，重点看"有没有突兀"与"有没有残留"：

- [ ] 冷启动：`.content` 首屏揭示一次，不重复播放。
- [ ] 顶层页签来回切：新页淡入上浮，旧页直接卸载，**没有**旧页残影。
- [ ] 二级页进出：进入从右侧滑入，返回从左侧滑入，方向与操作一致。
- [ ] 列表页滚动：新出现的项从左侧滑入，首屏不是整屏同时亮起；元素不会在动画结束后消失。
- [ ] 页签内容切换：容器不重挂载（页签状态保留），内容按方向滑入。
- [ ] 弹层/确认框：遮罩淡入、面板弹簧；关闭时先播退场再消失（不是瞬间没了）。
- [ ] 提示条：入场与退场全程水平居中，不出现"先偏右再弹回"。
- [ ] 文件预览：PDF/PPTX 每页淡入；关闭面板走退场相位。
- [ ] 抽屉：打开/关闭沿用 `global.css` 动画，**不会**播完消失或关闭时重现；导航项逐项进场。
- [ ] 按住整行/整卡：只有底色变化，尺寸与文字排版全程不动。
- [ ] 系统开"减弱动态效果"后：所有动画近似瞬时，呼吸/流光停止，页面无位移。

### 7.3 桌面验收

- [ ] 入口大卡 hover 上浮 2px；数字卡与列表行 hover 只变色不位移。
- [ ] 遮罩有 2px 模糊（安卓无）。
- [ ] 细滚动条生效。
- [ ] 换主题时颜色平滑过渡，且启动首次应用不挂过渡。

### 7.4 真机排障工具（机器本地，不入库）

安卓侧无法在本地复现时，可用这两个自写脚本驱动真机：

- `/home/lin/tools/adbclient.py`：WSL 内没有 adb、Windows interop 关闭时，用 adb host 协议
  直连 Windows 侧 adb server（前置：Windows 上执行 `adb.exe -a start-server`）。
  支持 `devices` / `shell` / `push` / `pull` / `install` / `forward` / `logcat-dump`。
- `/home/lin/tools/cdp.py`：经 `adb forward 9222 localabstract:webview_devtools_remote_<pid>` 后，
  用 CDP 在 WebView 里执行 JS——读 `document.fonts`、统计 canvas 绘制调用、注入动效探针等。
  动效验收里"元素有没有在动画结束后消失"这类问题，用它可以不依赖肉眼截图确认。

---

## 8. 构建与部署（机器本地）

> 凭据（签名 keystore 与口令）保存在仓库外的机器本地文件中，**不写进本文件、也不入库**。

- 安卓 APK：脚本在机器本地（`/tmp/build-apk.sh`），流程为
  `pnpm exec tauri android build --apk --target aarch64`，需要先把 `apps/desktop/src-tauri/gen/android`
  软链到机器本地的 Android 工程目录，构建后 `git checkout --` 还原该路径。
  产物用 build-tools 的 `zipalign` + `apksigner` 签名，keystore 路径与口令见机器本地凭据文件。
- Windows exe：`cargo xwin build --release --target x86_64-pc-windows-msvc --features tauri/custom-protocol`，
  构建前 `touch src/lib.rs src/main.rs` 以强制重新内嵌 `dist/`。
- 两次构建**不可并发**（共用 `dist/`）。
- 部署前先备份目标产物（历史备份命名 `*.bak-<日期>-<用途>`）。

---

## 9. 快速上手（接手后的前 30 分钟）

1. `git checkout local/anim-delight && git status`，确认工作区改动就是 §2.2 那 8 个文件。
2. 读 `motion.css` 头部注释的五条纪律 + §16；读 `lib/motion.ts` 全文（162 行）。
3. `node tools/motion-test.mjs`（预期在 §1 抛出涟漪断言失败）→ 按 §6.3 修断言。
4. `pnpm run dev`（即 `pnpm --filter @onethu/desktop dev`）在浏览器里过一遍 §7.2 的清单，先建立手感基准。
5. 从 §6.1（分段条滑动块）或 §6.2（折叠组展开）挑一项动手；两处 CSS 都已就绪，只差组件接线。
6. 每改一处动效，回到 §5 的坑列表对照一遍，再跑 `node tools/motion-test.mjs` + `tsc --noEmit`。
