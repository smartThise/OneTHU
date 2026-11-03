# 材质与文字颜色稳定性：结构性修复

> 最后更新：2026-10-31 20:30。

## 问题回回归的根因

「文字颜色突变」与「入场动画没有模糊」看似两条缺陷，实际是同一条合成规则的两个结果：

1. 玻璃材质由 `backdrop-filter` 实现。CSS 规定祖先链上出现 `opacity < 1`、`filter` 或非正常混合模式时，该祖先会成为 backdrop root，子元素的 `backdrop-filter` 只能采样这个局部组，无法采样壁纸；表现就是动画期间模糊消失，动画结束后才突然出现。
2. 对比度引擎按「背景合成亮度」决定改写黑字或白字。祖先 opacity 在入场动画中处于中间态，引擎采样到的背景不是最终背景，会把字色定格成反色；而 `settled` 生命周期只会写一次，错误墨色会一直留到下次环境变化。
3. 环境变化（主题 / 玻璃档 / 壁纸）会清锁并重取。旧实现分两轮（80ms + 260ms）执行，第一轮可能在 OneGUI 调色板尚未落定时锁一种墨，第二轮再清锁换另一种，用户看到的就是连续两次跳色。
4. 旧页面、逐项进场、遮罩、面板、上下文菜单、OH 面板各自写 opacity 入场动画；每加一处，就给材质和字色增加一个中间态。只修单个页面必然反复。

## 结构性规则

本轮把规则收敛成三条，并在 OneGUI 与宿主两侧同时落地：

### 1. 材质面只允许 transform 入场

- 页面容器（`.page-anim` / `.content` / `.tab-anim`）不再做入场动画。
- 二级页的换页反馈只作用于页头块，使用纯位移 `m-page-head-in`。
- `m-rise` / `m-grid-in` / `m-spring-in` / `m-slide-*` / `m-tab-in` / `m-reveal-in` / `m-expand-in`、OneGUI 的 `og-pop-in/out`、联系人卡入场、旧页 `page-in/row-in`、上下文菜单、OH 面板、首页菜单等，全部去掉 `opacity`。
- 统计卡、网格、stagger 容器不再做逐项进场；滚动揭示只作用于不带材质的列表行，且不再用 `opacity: 0` 藏身。

### 2. 遮罩只动画背景色

- OneGUI `.og-scrim` 使用 `og-scrim-in/out`，只改 `background-color`，不产生 backdrop root；弹层面板全程保持 `opacity: 1` 与 `backdrop-filter`。
- 旧弹层遮罩（`.plg-form-overlay` / `.confirm-mask` / `.ex-sheet-mask` / `.rch-mask`）取消 opacity 动画，面板弹簧保留。

### 3. 对比度引擎只在稳定合成态取样

- 新增祖先链检查 `hasTransientAncestor`：存在 `opacity < 1` / `filter` / 混合模式时跳过并延后重试。
- 主题切换期间（`html.theme-anim`）不取色、不重锁。
- 新增节点在 MutationObserver 回调内同步扫描，锁定结果直接进入首帧；不再延迟 350ms 才改色。
- 环境重取合并为一次；墨色变化在环境重取时走 180ms 颜色过渡；首次定格不走过渡。
- 宿主配方为 `.explorer-content` / 卡片 / 列表 / 行 / 页头提供语义墨色继承，未显式着色的文本不再落到浏览器默认黑或旧 MD 深墨。

## 主要文件

| 层 | 文件 |
|---|---|
| 动效纪律 | `apps/desktop/src/styles/motion.css` |
| 旧页/旧弹层/OH/上下文菜单 | `apps/desktop/src/styles/global.css`、`explorer-ui.css`、`explorer-oh.css`、`explorer-home.css` |
| OneGUI 浮层与遮罩 | `packages/gui/src/styles/base.css`、`overlay.css`、`recipes/contacts.css` |
| 选墨引擎 | `apps/desktop/src/lib/textContrast.ts` |
| 宿主墨色继承 | `packages/gui/src/recipes/compatibility.css` |
| 滚动揭示范围 | `apps/desktop/src/lib/motion.ts` |
| 静态护栏 | `tools/material-motion-guard.mjs`（已接入 `pnpm guard`） |
| 浏览器回归 | `tools/material-ink-stability-browser-test.mjs` |

## 验证

- `node tools/material-motion-guard.mjs`：39 项通过。检查入场 keyframes 不含 opacity、遮罩只动背景、玻璃卡片不参与逐项进场、引擎同步定格与合并重取。
- `node tools/motion-test.mjs`：149 条断言通过（更新为「入场只动 transform」纪律）。
- `node tools/material-ink-stability-browser-test.mjs`：12 项通过。覆盖：
  - 浅色玻璃 + 棋盘壁纸首页：首次打开文字颜色 **0 次跳变**；
  - 材质卡片祖先链全部 `opacity=1 / filter=none`；
  - 二级页头纯位移动画期间玻璃模糊仍在；
  - 弹层打开全程面板 `opacity=1`、`backdrop-filter` 有效，遮罩只过渡背景色；
  - 切到深色主题后打开页面 **0 次二次跳色**；
  - 玻璃档切换落定后 **0 次反复换墨**。
- `tools/learn-layout-browser-test.mjs` 207 项、`tools/mail-browser-test.mjs` 36 项通过。
- `glass-surfaces-test` 60/60、`glass-optics-test` 32/32、`onegui-guard`、`css-parse`、`style-scan`、`contrast-guard`、`typecheck` 通过。
- 旧样式表行数 9728，低于 9753 基线（本轮净减少）。

## 截图

同一张玻璃卡在两个对照动画下的表现：transform 入场保留模糊，opacity 入场丢失模糊。

- [opacity 入场：模糊消失](2026-10-31-material-motion-ink/blur-opacity-loss.png)
- [transform 入场：模糊保留](2026-10-31-material-motion-ink/blur-transform-kept.png)
- [弹层打开中：面板模糊与遮罩背景过渡](2026-10-31-material-motion-ink/modal-mid.png)
- [二级页头入场中：玻璃模糊保留](2026-10-31-material-motion-ink/pagehead-mid.png)
- [深色主题 + 玻璃：信息页](2026-10-31-material-motion-ink/dark-info.png)

## 边界

- 浏览器验收使用隔离 Chromium、预览数据与合成壁纸；未接触真实账号、Cookie 或用户壁纸。
- 原生 Windows WebView2 / Android WebView 的最终合成效果仍需真机确认；本轮未修改原生渲染路径。
- `prefers-reduced-motion` 仍由既有 CSS 降级块覆盖；`prefers-reduced-transparency` 的阅读面回退沿用上一轮修复。
- 仓库内 `learning-glass-browser-test.mjs` 的一条 `.hw-card` 材质断言在当前 main 上失败（该页面材质在本轮前已变化，与本轮改动无交集），未纳入本轮通过范围。