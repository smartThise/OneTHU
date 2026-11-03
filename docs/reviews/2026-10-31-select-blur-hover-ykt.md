# 下拉、搜索面板模糊、公式白底与课程卡 hover

> 最后更新：2026-10-31 23:45。

## 1. 原生下拉统一为自绘

**根因**：`OneGUI Select` 内部仍是 `<select>`，弹层由浏览器/系统绘制；深色主题与玻璃皮肤无法接管它，截图中的线程数下拉因此是白底黑字。应用里另有 3 个文件直接写 `<select>`。

**改动**：

- `packages/gui/src/components/form.tsx` 的 `Select` 重写为 `button[role=combobox]` + portal `role=listbox`：桌面贴控件展开的浮层（空间不足翻到上方），手机（≤839.98px）底部选择面板 + 遮罩；键盘支持上下/Home/End/Enter/Space/Esc/首字跳选；点外关闭；兼容原有 `options` 与 `<option>` / `<optgroup>` 子节点。
- 迁移剩余原生下拉：`learn/FilesPage`、`TasksPage`、`Trace`；应用与组件库内不再有原生 `<select>`。
- 材质全部走浮层令牌（`--og-fill-overlay` / `--og-overlay-blur` / `--og-elev-menu`），暗色与玻璃皮肤自动跟随。

回归：`tools/select-control-browser-test.mjs`（14 项）。

## 2. 搜索/OH 面板模糊丢失

**根因**：OneGUI 折射管线有面积预算（240000px²）。搜索/OH 面板约 724×558px，超预算后调用 `release()`；旧 `release()` 直接删掉内联 `backdrop-filter`，面板只剩半透明底色、没有模糊。

**改动**：`packages/gui/src/pipeline/refraction.ts` 的 `Lens` 记录元素原本的内联 `backdrop-filter`；因面积、预算或能力降级释放时还原静态材质，而不是删除。大面板退回普通毛玻璃，小面板仍享受透镜折射。

回归：`tools/material-ink-stability-browser-test.mjs` 新增面板 blur/半透明/祖先合成组检查，现 15 项通过。

## 3. 雨课堂公式白底

**根因**：`ProblemBody` 只在玻璃档（`theme.flush === true`）剥官方正文的行内背景；非通透/深色主题保留 `background:#fff`、表格 `bgcolor`，公式块仍是白板。

**改动**：所有皮肤与明暗模式统一传 `stripBackgrounds: stripInlineBackgrounds`；剥掉行内 `background` / `background-color` / `background-image` 与 `bgcolor`/`background` 呈现属性。画布底色仍按 `theme.flush` 决定（玻璃透明、非玻璃用页面材质）。

回归：`ykt-body-test` 188 项、`ykt-latex-browser-test` 24 项（对照路径复现白底，生产路径无白底；新增非玻璃深色用例）。

## 4. 课程卡 hover 只覆盖上半部

**根因**：hover 底色来自 `.learn-course-open` 按钮（只包标题/教师/时间），底部来源标签与计数按钮在按钮外。

**改动**：`.learn-course-card` 加整卡 `::after` 状态层（`inset:0`、`border-radius:inherit`、`background:var(--og-hover)`），内容抬到状态层之上；打开按钮自己的 hover 底色清零，底部标签/按钮保留各自 hover 与点击。桌面指针设备生效。

回归：`learn-layout-browser-test` 新增整卡 hover 断言，现 215 项通过。

## 验证

- `select-control-browser-test` 14、`material-ink-stability-browser-test` 15、`learn-layout-browser-test` 215。
- `glass-optics-test` 32/32；`ykt-latex-browser-test` 24/24；`ykt-body-test` 188/188。
- `motion-test` 150、`material-motion-guard` 39、`onegui-guard`、`css-parse`、`style-scan`、`typecheck` 通过；旧样式表 9728 行。

## 截图

- [暗色自绘下拉](2026-10-31-select-blur-hover-ykt/select-dark.png)
- [手机底部选择面板](2026-10-31-select-blur-hover-ykt/select-phone.png)
- [搜索/OH 面板磨砂](2026-10-31-select-blur-hover-ykt/search-panel-blur.png)
- [课程卡整卡 hover](2026-10-31-select-blur-hover-ykt/course-card-hover.png)

## 边界

- 桌面设置页线程数下拉在浏览器验收中不可见（下载区只在 Tauri 外壳渲染）；它复用同一个 `Select`，静态扫描保证无原生弹层。
- 公式白底覆盖官方 HTML 的行内背景；官方正文若以图片形式自带白底，不属于本次范围。
- 搜索/OH 面板模糊只在桌面同窗内验证；独立透明悬浮窗无法采样主窗口背景。
