# 网络学堂 / 搜索框 / 邮箱：四项界面修复

> 最后更新：2026-10-31 17:40。目标：latest `main`（0.11.4-fix-3）。

## 范围

本轮处理四条用户实测缺陷，均可在未登录预览数据下复现：

1. 非通透模式下，网络学堂顶部四个入口卡的 hover 让整张卡变透明。
2. 网络学堂主页与子页面（作业 / 通知 / 文件 / 搜索）宽窄不一致；竖版标签栏下多出横向滚动条。
3. 搜索框只有平面填充，没有背景模糊。
4. 邮箱左上角文件夹 tab 与全站 tab 栏样式不一致。

## 根因与修复

### 1. 统计卡 hover 替换了卡面填充

`apps/desktop/src/styles/motion.css` 的通用按压规则把 `.stat-card` 与透明列表行放在同一组，hover 时直接写 `background: var(--hover)`。该值只有约 4.5% 不透明度，中性皮肤下等于把卡片的实底替换成一层几乎透明的墨，页面背景直接透出；玻璃皮肤下则把 36% 的材质压到 4.5%。

修复：把 `.stat-card` 从「替换 background」的规则里移出，状态反馈改由 `::after` 状态层承担。基础层写在 OneGUI 宿主配方 `packages/gui/src/recipes/compatibility.css`（位置、圆角、指针穿透、透明度过渡），旧样式表只保留阴影反馈。卡片的填色、描边、背景模糊与圆角在 hover / 按压期间保持不变。

### 2. 网络学堂单独改写内容边界

`packages/gui/src/recipes/learn.css` 曾把 `[data-active-page="learn"]` 的 `.explorer-content` 改成 `width: 100%; max-width: none`。宽屏下主页因此顶到两侧，与子页面的 1160px 阅读边界不同；竖版标签栏下 `width: 100%` 再叠加左栏偏移，文档宽度超出视口，底部出现横向滚动条。

修复：删除页面级宽度改写，主页与子页面统一使用壳层给出的内容宽度与上限。1280/1920 下主页内容区与「全部作业」完全同宽同起点；1280 竖版标签栏下文档宽度不再超出视口。

### 3. 搜索框缺少玻璃材质

页面搜索框 `.search-box` 的外壳读取旧的 MD 面阶，玻璃皮肤下没有背景模糊，与周围玻璃面脱节。顶部搜索胶囊 `ohx-capsule` 同样被显式写成 `backdrop-filter: none`。

修复：两者都按搜索输入外壳处理，在 `packages/gui/src/recipes/material-surfaces.css` 与 `workbench.css` 中接入 OneGUI 材质角色：玻璃皮肤下外壳使用阅读面 / 浮层填充与背景模糊，内部原生 input 保持透明，控件本体仍由外壳承担对比度。中性皮肤保持实底、无模糊。`prefers-reduced-transparency` 同时回退 `--og-fill-reading` 与 `--og-reading-blur`，避免系统减弱透明时仍残留半透明。

### 4. 邮箱文件夹 tab 自建样式

邮箱页手写 `.segmented` + `.seg-pill`，选中态是浅灰底；其他页面全部使用 `SegmentedOverflow`（段轨 + 深色选中胶囊 + 溢出指示条）。

修复：`apps/desktop/src/pages/MailPage.tsx` 改用 `SegmentedOverflow`，按钮补 `role="tab"` / `aria-selected`；工具栏只保留搜索与错误行。未读徽标沿用全局 `.tab-count` 语义配色，不再写死强调色底与白字。邮箱 tab 的选中态与信息页 tab 的计算样式完全一致。

## 验证

- `node tools/motion-test.mjs`：145 条断言通过（含统计卡状态层、邮箱复用统一分段条）。
- `node tools/onegui-guard.mjs`：旧样式表 9744 行，低于 9753 行基线；令牌、调色板、组件登记通过。
- `node tools/css-parse-test.mjs`、`node tools/style-scan.mjs`、`node tools/contrast-guard.mjs`、`node tools/input-system-test.mjs`、`node tools/card-layers-test.mjs` 均通过。
- `CHROME_BIN=<chromium> node tools/learn-layout-browser-test.mjs`：六档视口 207 条断言通过；新增覆盖 hover 不透明、玻璃/中性搜索框材质、竖版标签栏无横向滚动、主页与子页面同宽。
- `CHROME_BIN=<chromium> node tools/mail-browser-test.mjs`：36 条断言通过；新增覆盖 `.seg-ov` / `.seg-track` 结构、单选标记、与信息页 tab 选中态一致。
- `node tools/glass-surfaces-test.mjs` 60/60、`node tools/glass-optics-test.mjs` 32/32。
- `pnpm --filter @onethu/desktop typecheck` 通过；`node ./scripts/prebuild.mjs && pnpm build` 通过。
- 桌面 Windows 产物按 `docs/BUILD-AGENT-GUIDE.md` 的 `cargo xwin build --release --features tauri/custom-protocol` 构建，并核对资源内嵌标记。

## 截图

以下截图来自隔离浏览器与预览数据：

- [网络学堂 hover（中性皮肤）](2026-10-31-ui-fixes/learn-hover.png)
- [搜索框玻璃材质（透彻档 + 内置壁纸）](2026-10-31-ui-fixes/search-glass.png)
- [邮箱 tab（桌面）](2026-10-31-ui-fixes/mail-tabs-1280.png) · [邮箱 tab（手机）](2026-10-31-ui-fixes/mail-tabs-390.png)

## 边界

- 浏览器验证使用隔离 Chromium 与预览数据，未接触真实账号、Cookie 或用户壁纸。
- 原生 Windows WebView2 与 Android WebView 的最终材质观感仍以真机为准；本轮不修改原生渲染路径。
- `prefers-reduced-transparency` 的回退只覆盖本轮新增的阅读面角色；其余玻璃面的既有回退策略不变。