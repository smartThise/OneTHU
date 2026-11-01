# Hover 角形、双来源课程 tab、列表固定高度、图标基线与校园卡两栏

> 最后更新：2026-11-01 11:15。

## 1. 课程卡 hover 形状与双层叠色

**角形**：状态层 `::after` 只继承了 `border-radius`；卡面使用 squircle（`corner-shape: squircle`），伪元素没有继承 `corner-shape`，圆角处退回圆弧，看起来比卡面小一圈。给 `.learn-course-card::after`（以及 `.stat-card::after`）补 `corner-shape: inherit`。

**双层叠色**：上半部打开按钮的 hover 画在 `.og-btn::after` 上，只清按钮本体的 `background` 并未清掉这个状态层，于是整卡 hover 叠了按钮 hover。把打开按钮的 `--og-c-btn-hover` / `--og-c-btn-press` 置为 `transparent`，整卡只保留一层状态层；底部标签按钮各自的 hover 不变。

## 2. 课程详情：通知/文件双来源改子 tab + 固定列表

- 「通知」「文件」两栏：网络学堂与雨课堂都有内容时，显示子 tab（默认网络学堂，带各自计数）；只有一侧有内容时直接显示该列表，不出现空 tab。
- 两侧列表都放进 `ListWindow`（固定视口、卡内滚动）；雨课堂资料列表组件 `YktContentList` 也从自然高度 Card 改为 `ListWindow`。
- 切换主 tab 时子 tab 状态重置为网络学堂。

## 3. 列表首开不固定 / 页面滚到底

**根因**：`ListWindow` 用 `getBoundingClientRect().top` 计算可用高度。页面可能带着上一次滚动位置挂载（从课程卡进入详情），`top` 变成视口内坐标，把已经滚掉的距离算成可用高度，列表于是撑到内容全高；切一次 tab 重新挂载后才恢复。

**修复**：测量前找到实际滚动容器，把位置换算成容器内的文档偏移（`rect.top - scroller.top + scrollTop`），滚动多少都不影响高度；同时补 120/360ms 两次延迟测量与 `document.fonts.ready`，覆盖异步页头/筛选条落定。

## 4. 图标比文字高

**根因**：`Btn` 会把直接写在 children 里的图标包进 `.og-btn-label`（inline 排版）。裸 `<svg>` 没有 `.og-icon` 的 `vertical-align` 修正，默认 baseline 让图形中心比中文高约 2px。

**修复**：全站裸 `svg` 统一 `:where(svg) { vertical-align: -0.14em }`（零特异性，组件可覆盖），按钮 label 内再补一条同值规则；`icon-test` 增加两条静态断言，防止后续回退。

## 5. 校园卡左右两栏

- ≥1024px：`.card-two-col` 两列等宽；左列放余额卡、近 30 天统计、余额预警；右列放「最近消费」标题 + 流水。
- 右列流水与左列同高，列表在卡片内部滚动；`ListWindow` 新增 `fill` 模式（父级 grid 行高确定时不再按视口测量）。
- <1024px：保持原上下堆叠，列表继续走视口测量。

## 验证

- `course-source-tabs-browser-test`：18 项（子 tab、默认网络、标题只播一次、行首帧标记、等宽/滑动胶囊、逐项延迟、雨课堂/文件固定视口）。
- `card-two-col-browser-test`：7 项（等宽、同高、内部滚动、窄屏堆叠、无横向溢出）。
- `learn-layout-browser-test`：219 项（含 hover 角形、无双层、整卡覆盖）。
- `list-window-layout-test`、`assignments-layout-test`、`material-ink-stability`、`select-control`、`glass-optics` 继续通过。
- `icon-test` 静态断言、`onegui-guard`、`typecheck` 通过；旧样式表行数未超基线。

## 截图

- [整卡 hover（含底部标签行）](2026-11-01-hover-icons-course-card/course-card-hover.png)
- [课程通知双来源 tab](2026-11-01-hover-icons-course-card/course-notices-tabs.png)
- [课程文件双来源 tab](2026-11-01-hover-icons-course-card/course-files-tabs.png)
- [校园卡左右两栏](2026-11-01-hover-icons-course-card/card-two-col.png)

## 边界

- 双来源 tab 仅当两侧都有内容时出现；没有任何一侧时沿用原空态。
- 校园卡两栏阈值为 1024px；更窄窗口维持堆叠。
- 列表高度仍依赖运行时布局测量；本轮补了滚动偏移与延迟重测，但极端自定义主题/字号下的观感仍以真机为准。

## 6. 课程详情入场动画与双来源 tab 样式（2026-11-01 下午补）

**标题重复入场**：`ListWindow` 测量时为避开页头入场 transform，临时把 `header.style.animation` 设为 `none` 再恢复；恢复 `animation` 会让 CSS 动画从头重播。每次测量（首挂载 + rAF + 120/360ms + ResizeObserver）都会重播，正好 3 次；切 tab 重测又 1~n 次。页头 transform 不影响列表宿主的布局位置，已删除这段写入/恢复，标题只在进入页面时播一次。

**列表项抽搐**：滚动揭示由 `MutationObserver` 以 100ms 防抖扫描，新行先以静止状态绘制出来，100ms 后才打 `data-reveal-in` 并从左侧 -14px 开始播 `m-reveal-in`，观感就是“先出现、再消失、再从左边进来”。现在 MutationObserver 用 microtask 合并、在 paint 前同步标记首屏可见行；IO 只负责后续滚入视口的行。

**双来源 tab 样式**：子 tab 不再用 OneGUI 默认下划线/胶囊，复用主 tab 的 `.segmented` 胶囊槽（`Tabs` 只提供 tablist/键盘语义 + `className="segmented course-source-tabs"`）；主动项深色胶囊、计数样式与主 tab 完全一致。

回归：`course-source-tabs-browser-test` 增至 18 项（标题只播一次/切 tab 不重播、首帧 reveal 标记、等宽/滑动胶囊、逐项延迟）；`motion-test` 152 项。

## 7. 二级 tab 统一、列表逐项时间差、标题横移（2026-11-01 傍晚补）

**二级 tab**：上一版用 OneGUI `Tabs`，虽然视觉接近但仍不是同一套结构，没有 `seg-pill` 滑动块，宽度也不是整行。现在把课程页一级 tab、作业状态筛选、通知/文件双来源 tab 全部收进同一个 `CourseTabRow`（内部就是 `SegmentedOverflow` + `.segmented` + `seg-pill`），所以三者同宽（1080/1080）、同形、同一个滑动胶囊过渡，裸 `<button>` 也只保留这一处。

**列表逐项时间差**：reveal 的初始延迟原来用全局计数器，先扫描过别的页面后，后挂载列表的每一项都拿到 12×30ms，看起来整列同时平移。改为按同一父级内的索引算延迟（网格按行分组：同行同时、行间 9ms；列表逐项 30ms），首屏行 0/30/60… 依次进入。

**页标题方向**：`m-page-head-in` 从 `translate3d(0,-5px,0)` 改为 `translate3d(-14px,0,0)`，左→右入场；主页面与二级页统一。

**网络学堂入场动画恢复**：上一版滚动揭示只覆盖 `.row-click` 等行，课程卡 `.learn-course-card` 没有入场。现在把课程卡纳入揭示选择器（网格按行 9ms），Learn 课程卡恢复 `m-reveal-in`；列表/卡片都在第一帧就进入入场首帧，不再先静止再跳回。

回归：`course-source-tabs-browser-test` 18 项（含等宽、`seg-pill` 过渡、逐项延迟）；`learn-layout-browser-test` 225 项（含课程卡入场）；`motion-test` 152 项（含标题左→右关键帧）。

## 8. Learn 二级页尾部滚动余量（2026-11-01 晚补）

**根因**：固定列表已经按底栏高度算好自身高度（底边停在快捷栏上沿），但 `.explorer-panel` 还带一份 `--og-shortcut-clearance` 底栏 padding（100px）。面板总高 = 列表底边 + padding，页面因此多出约 22px 可滚动余量，右侧出现纵向滚动条；列表本身没有滚出视口。

**修复**：页内存在 `.list-window-host` 时，把面板底栏 padding 置 0（列表已经让过底栏）；没有固定列表的空态页面仍保留原 padding。桌面/手机分别覆盖，避免与 OneGUI 工作台配方打架。

回归：`list-window-layout-test` 新增 `documentElement.scrollHeight <= innerHeight` 断言；notice/course/tasks 三类固定列表页均无页面级滚动余量。

## 9. 洗衣机设备名称（2026-11-01 晚补）

设备编号 → 名称映射（用户提供）：

| 前缀 | 名称 |
|---|---|
| `he` | 波轮洗衣机 |
| `hr` | 滚筒洗衣机 |
| `wm` | 洗鞋机 |
| `dr` | 烘干机 |
| `hs` / 纯数字 | 含义未解，保持原编号 |

实现：`WasherTab.tsx` 的 `washerDisplayName` 只改**显示标题**；收藏/深链/AtomRef 的 `deviceKey` 仍是原始 `name`，保证已有收藏不失效。映射到类型名称后不再重复显示泛化的 `type`；`hs`/数字继续显示编号及原副标题。

回归：`washer-name-test` 浏览器动态导入函数，覆盖大小写、带分隔符、`hs`/纯数字/空值。
