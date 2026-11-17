# OneGUI 前置盘点 01：现有 UI 表面清单与分裂度实测


> 归档说明：本文保留当时的界面盘点与实测记录；0.11 当前功能与使用说明请查阅 [文档入口](../README.md)（[English overview](../en/index.md)）。


> 勘察范围覆盖 `apps/desktop/src/components/**` 与 `apps/desktop/src/pages/**`（只读分析，排除 `node_modules/`、`vendor/` 与 AppleDouble `._*`）。
> 文中各项统计均由 `grep -c`、`wc -l` 及一次性解析脚本实测得出；证据按 `file:line` 标注，CSS 引文保持**原文逐字**引用。
> 代码量基线：`components/**` 21 837 行 / 79 个文件；`pages/**` 28 441 行 / 约 90 个文件；`styles/*.css` 12 661 行。
> 令牌基线：`--r-sm/md/lg/pill` = 6/8/12/999px（`packages/ui/src/tokens.css:88-92`，`--r-lg: --md-sys-shape-corner-large` 见 `apps/desktop/src/state/theme.ts:314`）。
> 当时状态：`packages/ui` 仅包含 `tokens.css` / `base.css` / `palette.css` 三个样式文件（`packages/ui/package.json` 的 exports 仅导出两个 CSS），尚未收录 React 组件。

---

## 1. 组件清单（components/** 全覆盖 + pages/** 中的可复用件）

类型代号：`Btn`=Button，`IBtn`=IconButton，`Card`，`Row`=ListRow，`In`=Input，`Sel`=Select，`Sw`=Switch，`Sld`=Slider，`Chip`，`Tabs`，`Modal`，`Drawer`，`Toast`，`Tip`=Tooltip/Popover，`Menu`，`Prog`=Progress/Skeleton，`Emp`=EmptyState，`Av`=Avatar，`Badge`，`Tbl`=Table，`Page`=PageScaffold/Header，`Nav`，`Other`。
「共享」列：**S** = 真正跨页复用；**L** = 页内本地副本 / 单一业务专用；**S\*** = 名义共享但只有单一调用方或与同类重复。

### 1.1 `components/**`（79 文件）

| 文件 | LOC | 类型 | 共享 | 备注（机制 / 证据） |
|---|---:|---|---|---|
| `Layout.tsx` | 806 | Page, Card, Emp, Sw, Prog, Tabs, Nav | **S** | 事实上的「库」：`Card`(:717) `Empty`(:735) `Switch`(:785) `SectionHead`(:702) `SkeletonRows`(:769) `PageHead`(:492) `SegmentedOverflow`(:246)。全库仅 61 处 import 本文件 |
| `FilePreview.tsx` | 1605 | Modal, Tbl, Page, Other | L | 自带 `.fp-*` 家族；95 处内联 style、54 处色值（全库第一） |
| `explorer/TabStrip.tsx` | 1082 | Tabs, Nav | L | `.ex-tab` 家族，与 `.tabstrip`/`.seg-track`/`.plg-tab` 多套并行 |
| `explorer/TabDrawer.tsx` | 1070 | Drawer, Menu | L | `.explorer-ctxmenu` 复用（与 `ContextMenu.tsx` 重复） |
| `ContextMenu.tsx` | 917 | Menu, Modal | S | `.ctx-title`/`.ctx-icon`/`.ctx-item`；带 panel 注入 |
| `GlobalOrb.tsx` | 749 | Nav, Toast, Other | L | 悬浮球 + 语音条 |
| `AttachActionsSheet.tsx` | 754 | Modal, Btn, In, Tabs | S\* | **CSS-in-TS**：`.ohaa-*` 20 条规则内嵌在 :69-:110；96 处 className、0 处外部 CSS |
| `boardCards.tsx` | 730 | Card, Other | L | 白板卡片（`ClockCard`/`DateCard`/`WeatherCard`） |
| `HomeWidgets.tsx` | 677 | Card, Row, Page | S\* | `EntryCard`(:137) `RowClick`(:173) `AgendaRows`(:209) `HomeworkRows`(:232) `NoticeRows`(:301) 等 8 个 Row 变体 |
| `FreeBoard.tsx` | 677 | Card, Drawer | L | 自由白板画布 |
| `ImageViewer.tsx` | 501 | Modal, Btn | S | 全屏查看器，自带 `.imgview-*` |
| `Icons.tsx` | 428 | Other | **S** | 51 个图标 + `FolderIcon`；无样式负担，可直接进 OneGUI |
| `explorer/OneGoSheet.tsx` | 418 | Drawer, Btn, In | L | `.ex-sec-head` 等 |
| `BoardAddDrawer.tsx` | 416 | Drawer, Card | L | `.add-drawer` + `.add-preview-*` |
| `exthw/YktSubjectiveEditor.tsx` | 405 | In, Other | L | 富文本答题编辑器 |
| `WidgetSizes.tsx` | 395 | Card, Prog | L | 尺寸档预览网格 |
| `ExtHwLoginModal.tsx` | 382 | Modal, In, Btn, Tabs | L | 自带 `.ykt-*`；12 处色值 |
| `ImSettingsSection.tsx` | 371 | Row(settings), Sw | L | 直接手写 `.setting-row` DOM 结构 |
| `Collect.tsx` | 335 | Modal, Row, IBtn | S | `.collect-row` / `.collect-modal`；星标按钮 4 个导出变体 |
| `OnboardingTourV3.tsx` | 329 | Modal, Tip | L | 引导层 |
| `NotifySettingsSection.tsx` | 328 | Row(settings), Sel, Sw | L | 直接写 `.setting-row`，17 处内联 style |
| `ConnectGate.tsx` | 311 | Page, Emp | S\* | 以 `.setting-desc` 起手，语义实为页面壳 |
| `VoiceSettingsSection.tsx` | 309 | Row(settings), Sld | L | **全库唯二 `<input type="range">`**（:215, :251），无 `.slider` 抽象 |
| `OnboardingTourParticles.tsx` | 282 | Other | L | 装饰粒子 |
| `OhSettingsPage.tsx` | 279 | Page, Row(settings) | L | OneTHU Harness 设置页 |
| `exthw/ProblemBody.tsx` | 273 | Other | S\* | 题目正文渲染（主题读取 + 注入） |
| `ThemePickerModal.tsx` | 272 | Modal, Card, In | L | `.theme-pick-mask`/`.theme-pick-panel` 自成一套；31 处内联 style |
| `WidgetBindModal.tsx` | 270 | Modal, Row | L | 复用 `.home-modal-*`（第三个调用方） |
| `ImageFilterSheet.tsx` | 261 | Modal, Sld, Card | S\* | **CSS-in-TS**：`.ohf-*` 11 条规则内嵌 :53-:80 |
| `explorer/HomeSpheres.tsx` | 255 | Card | L | `.chrome-clock` 等 9 个 home 部件 |
| `LiveTiles.tsx` | 246 | Row(Other) | S\* | `.live-line` 三个 tile 状态件 |
| `OnboardingTourMobile.tsx` | 245 | Modal | L | 手机引导 |
| `CommandPalette.tsx` | 244 | Modal, Row, In | S | `.pal*` 家族 |
| `SoftwareUpdateSection.tsx` | 238 | Row(settings) | L | 直接写 `.setting-row` |
| `WidgetSettingsSection.tsx` | 223 | Row(settings) | L | 直接写 `.setting-row` |
| `explorer/OhCapsule.tsx` | 221 | Nav | L | `.ohx-*` |
| `SearchLandingSelfcheck.tsx` | 191 | Card, Btn | L | `.selfcheck-card` |
| `DevPanel.tsx` | 185 | Modal, Other | L | 18 处色值 |
| `HomeCoachMarks.tsx` | 184 | Tip | L | 与 `OnboardingTourV3` 目标重叠 |
| `explorer/WallpaperLibrary.tsx` | 180 | Card, Chip | L | `.wall-*` |
| `AttachTray.tsx` | 174 | Chip, IBtn, Tip | S | `.oh-attach*` |
| `BoardPenLayer.tsx` | 171 | Other(Toolbar) | L | `.board-pen-toolbar` |
| `explorer/renderPage.tsx` | 170 | Page | L | 路由页壳（`page-body plg-tab-page`） |
| `SearchSelect.tsx` | 163 | Sel, In, Row, Emp | S | `.filter-dd-panel`，与 `ContextMenu` 的浮层壳重复 |
| `explorer/WorkspaceEditor.tsx` | 158 | Modal, In | L | `.ws-create-mask` |
| `FavAtomPicker.tsx` | 142 | Modal, Row | L | 第 4 个 `.home-modal-*` 调用方 |
| `exthw/YktContentList.tsx` | 135 | Row | S\* | 直接 `className="list"` |
| `explorer/PhoneSheet.tsx` | 118 | Drawer | L | `.ex-sheet-grip` |
| `TabManageModal.tsx` | 115 | Modal, Row, IBtn | L | **零 CSS**：`.tab-manage-mask`/`.tab-manage-panel` 全靠 `style={maskStyle}` 内联对象（:82-:83） |
| `exthw/YktContentBody.tsx` | 110 | Other | S\* | 正文渲染 |
| `explorer/ContextMenu.tsx` | 109 | Menu | L | `.ex-ctxmenu`，与 `ContextMenu.tsx` 重复实现 |
| `BoardItemPicker.tsx` | 109 | Drawer, Row | L | `.add-drawer-mask` |
| `WidgetHost.tsx` | 98 | Card, Emp | S\* | `.wg-card` / `.wg-empty` |
| `HelpSection.tsx` | 96 | Row(settings) | L | 直接写 `.setting-row` |
| `exthw/YktVideoPlayer.tsx` | 88 | Other | S\* | 视频壳 |
| `NotifyBridge.tsx` | 84 | — | S | 无 DOM |
| `explorer/SettingsOverlay.tsx` | 83 | Modal, Tabs | L | `.settings-head` / `.settings-seg` |
| `RootErrorBoundary.tsx` | 83 | Emp, Btn | S | 错误页，手写 `.btn.btn-primary` |
| `ExplorerPrefsSection.tsx` | 83 | Tabs, Row(settings) | L | `.ohx-prefseg` |
| `explorer/FolderIconPicker.tsx` | 78 | Modal, IBtn | L | 7 处内联 style |
| `explorer/ExplorerPreview.tsx` | 75 | Other | L | 预览壳 |
| `explorer/WallpaperVideo.tsx` | 68 | Other | L | 视频层 |
| `Ripple.tsx` | 66 | Other | S | 涟漪（无 className） |
| `DownloadOpenButtons.tsx` | 65 | IBtn, Btn | S | `.dl-open-btn*` 两个按钮自成一套 |
| `CountUp.tsx` | 62 | Other | S | 数字滚动 |
| `Details.tsx` | 56 | Other | S | `<details className="tech-details">` + `ErrorLine` |
| `RichEditor.tsx` | 53 | In | S\* | `.rich-editor` |
| `PluginLogo.tsx` | 47 | Av | S | `.plg-logo` |
| `explorer/BottomBar.tsx` | 41 | Nav | L | `.ex-bbar` |
| `explorer/HomeTab.tsx` | 36 | Page | L | `.home-tab` |
| `PreviewData.tsx` | 33 | — | S | 无 DOM |
| `useNotifyBackend.ts` | 14 | — | S | 无 DOM |
| `HarnessMark.tsx` | 11 | Other | S | 品牌标记 |

### 1.2 `pages/**` 里的可复用件（其余页面文件是页内屏幕，见 §5）

| 文件:行 | LOC | 类型 | 共享 | 备注 |
|---|---:|---|---|---|
| `pages/learn/shared.tsx` | 595 | Row, Btn, Tip, Other | S\* | `HomeworkRow`(:388) `NoticeRow`(:487) `FileRow`(:536) `InfoRow`(:588) `BackButton`(:260) `HwRemindPop`(:295) `RichContent`(:154) — **学堂的行组件只在本目录复用** |
| `pages/info/reportParts.tsx` | 171 | Card, Row | L | 报告卡件 |
| `pages/info/tabStates.tsx` | 109 | Prog, Emp | S\* | Tab 加载与空态（独立于 `Layout.Empty` 实现） |
| `pages/ScheduleAgenda.tsx` | 236 | Row, Card | L | **0 处 className，20 处内联 style** — 纯内联渲染的整页 |
| `pages/info/newsSearch.tsx` | 177 | Row | L | **0 处 className，1 处内联 style** |
| `components/exthw/*` | 1011 | Row, In, Other | L | 雨课堂专用件 |
| `pages/info/CardTab.tsx` | 532 | Card, In | L | `.icon-cell` 网格（与 `.app-card` 重复） |
| `pages/zhjwxk/Courses.tsx` | 1607 | Card, Sel, Chip | L | 选课页：217 处内联 style（**全库第一**）、19 个 `<select>`（全库第一） |

---

## 2. 分裂对照表：10 个最重复的视觉族（CSS 原文引用）

### 2.1 卡片 / 容器（最严重）

| # | 选择器 | file:line | 逐字声明 |
|---|---|---|---|
| 1 | `.card`（学堂用） | `styles/global.css:160` + 覆写 `:8355` | `.card { background: var(--md-sys-color-surface-container-lowest); border-radius: var(--md-sys-shape-corner-large); }` |
| 2 | `.home-card` | `styles/global.css:1610` | `.home-card { background: var(--md-sys-color-surface-container-lowest); border: 1px solid transparent; border-radius: var(--md-sys-shape-corner-large); min-width: 0; max-width: 100%; overflow: hidden; animation: page-in 240ms cubic-bezier(0.2, 0.7, 0.3, 1) both; }` |
| 3 | `.cloud-list` / `.cloud-repo`（云盘用） | `styles/global.css:4971` / `:4938` | `.cloud-list { border: 1px solid var(--border-soft); border-radius: 12px; overflow: hidden; margin-bottom: 16px; }` ／ `.cloud-repo { display: flex; gap: 10px; align-items: center; padding: 12px; border: 1px solid var(--border-soft); border-radius: 12px; background: var(--bg-soft); cursor: pointer; transition: border-color 0.15s; }` |
| 4 | `.market-card` | `styles/global.css:6104` | `.market-card { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--r-lg); background: var(--md-sys-color-surface-container-lowest); box-shadow: var(--shadow-1); transition: border-color .15s ease, box-shadow .15s ease; }` |
| 5 | `.gitlab-card` | `styles/global.css:5202` | `.gitlab-card { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border: 1px solid var(--border-soft); border-radius: 12px; background: var(--surface); cursor: pointer; }` |
| 6 | `.plg-card` | `styles/global.css:3144` | `.plg-card { display: flex; gap: var(--gap-3); padding: var(--gap-3) var(--gap-4); background: var(--md-sys-color-surface-container-lowest); border: 1px solid transparent; border-left-width: 3px; border-radius: var(--md-sys-shape-corner-large); … }` |
| 7 | `.balance-strip` / `.notice-strip` | `styles/global.css:6939` / `:6899` | `.balance-strip { display: flex; align-items: stretch; gap: 10px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 14px; background: var(--md-sys-color-surface-container-lowest); }` ／ `.notice-strip { display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 10px 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--md-sys-color-surface-container-lowest); }` |
| 8 | `.wg-card` / `.hw-card` | `styles/global.css:7555` / `:6706` | `.wg-card { border-radius: var(--md-sys-shape-corner-medium, 12px); background: var(--surface-2); overflow: hidden; }` ／ `.hw-card { … padding: 12px 14px 12px; border: 1px solid var(--border); border-radius: 16px; … box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08), 0 10px 28px rgba(0, 0, 0, 0.10); … }` |

**小结**：共出现 7 种圆角（`--md-sys-shape-corner-large`=12px / `12px` 字面量 / `--md-sys-shape-corner-medium`=8px / `--r-lg` / 14px / 16px）、4 种描边写法（`--border` / `--border-soft` / `transparent` / 无描边）以及 2 种材质（`.card` 在 `:8355` 覆写为 glass 渐变 + `backdrop-filter`；`.cloud-repo`、`.cloud-list`、`.gitlab-card` 保持**实心** `--bg-soft`/`--surface`，其中 `.cloud-list` 未设置 `background`）。

### 2.2 云盘 vs 学堂：卡片对比（点名）

| 维度 | 清华云盘 `pages/CloudPage.tsx` | 网络学堂 `pages/learn/*` |
|---|---|---|
| 容器类 | `className="cloud-list"`（:466, :515, :529, :541） | `<Card className="list">`（`AssignmentsPage.tsx:276/286`、`CourseDetailPage.tsx:225/237/276/301/332`、`FilesPage.tsx:65`、`NoticesPage.tsx:99`） |
| 容器 CSS | `.cloud-list { border: 1px solid var(--border-soft); border-radius: 12px; overflow: hidden; margin-bottom: 16px; }`（`global.css:4971`） | `.list { display: flex; flex-direction: column; min-width: 0; max-width: 100%; }`（`global.css:179`）+ `.card`（`:160`，被 `:8355` 改成 glass） |
| 行类 | `className="cloud-row"`（`CloudPage.tsx:472`） | `className="row row-click"`（`shared.tsx:506, :543`） |
| 行 CSS | `.cloud-row { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-bottom: 1px solid var(--md-sys-color-outline-variant); cursor: pointer; }`（`:4977`） | `.row { display: flex; align-items: center; gap: 14px; padding: 11px 16px; border-top: 1px solid var(--md-sys-color-outline-variant); transition: background 100ms ease; animation: row-in 260ms ease both; … }`（`:181`） |
| 分隔线方向 | `border-bottom`（下） | `border-top`（上） |
| hover | `.cloud-row:hover { background: var(--bg-soft); }`（`:4988`） | `.row:hover { background: var(--hover); }`（`:204`）；`.row.row-click:hover` 另加 `background: var(--glass-tint); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22); border-radius: var(--r-md, 10px);`（`:8343`） |
| 间距 / 内边距 | gap 10 / padding 9×12 | gap 14 / padding 11×16 |
| 卡片面材质 | 无 background（只有描边）→ 透出页面底 | glass：`background: linear-gradient(180deg, var(--glass-tint-top), var(--glass-tint-bottom)), var(--glass-card-fill-2); backdrop-filter: var(--glass-panel-blur); border-color: var(--glass-border); box-shadow: var(--glass-shadow), inset 0 1px 0 var(--glass-rim-top), inset 0 0 0 1px var(--glass-rim-hairline);`（`:8355`） |
| 圆角 | `12px` 字面量 | `--md-sys-shape-corner-large`（=12px，但走 token，换主题会变） |

> 同属文件与通知列表，两处各自维护一套独立样式：切换主题时学堂圆角随令牌联动，云盘圆角保持固定字面量。

### 2.3 列表行

| # | 选择器 | file:line | 逐字声明（关键部分） |
|---|---|---|---|
| 1 | `.row` | `styles/global.css:181` | `gap: 14px; padding: 11px 16px; border-top: 1px solid var(--md-sys-color-outline-variant);` |
| 2 | `.mail-row` | `styles/global.css:4671` | `.mail-row { position: relative; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 0; border-bottom: 1px solid var(--md-sys-color-outline-variant); background: transparent; cursor: pointer; text-align: left; min-width: 0; transition: background 120ms ease; }` |
| 3 | `.svc-row` / `.task-row`（**逐字节相同**） | `styles/global.css:6536` / `:6642` | `.svc-row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px; border: 0; border-radius: var(--md-sys-shape-corner-medium); background: none; color: var(--text-1); font: inherit; text-align: left; cursor: pointer; -webkit-tap-highlight-color: transparent; }` |
| 4 | `.ex-row` | `styles/explorer-ui.css:301` | `.ex-row { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 9px; transition: background var(--dur-1, 0.12s) var(--ease-out, ease); }` |
| 5 | `.pal-row` | `styles/global.css:7162` | `.pal-row { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 8px 10px; border: 0; border-radius: var(--r-md); background: transparent; color: inherit; cursor: pointer; }` |
| 6 | `.wb-row` | `styles/global.css:1935` | `.wb-row { position: relative; display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: var(--md-sys-shape-corner-medium); background: var(--md-sys-color-surface-container); text-align: left; cursor: pointer; }` |
| 7 | `.setting-row` | `styles/global.css:924` | `.setting-row { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 13px 16px; border-top: 1px solid var(--md-sys-color-outline-variant); }` |

**结论**：gap 取值 {6, 8, 10, 12, 14, 20}，padding 取值 {10, 6×8, 8×10, 9×12, 10×12, 10×14, 11×16, 13×16}，圆角 {9px, `--r-md`=8px, `corner-medium`=8px, 无}。

### 2.4 按钮 / 图标按钮

| # | 选择器 | file:line | 逐字声明 |
|---|---|---|---|
| 1 | `.btn` | `styles/global.css:438` | `.btn { … height: 32px; padding: 0 14px; … border: 1px solid var(--md-sys-color-outline-variant); border-radius: var(--r-pill); background: var(--md-sys-color-surface-container-lowest); color: var(--md-sys-color-on-surface); font-size: var(--text-base); … }`（`:8239` 又被覆写成 glass chip：`background: linear-gradient(180deg, var(--glass-tint-top), var(--glass-tint-bottom)); backdrop-filter: var(--glass-chip-blur); border-color: var(--glass-border); …`） |
| 2 | `.icon-btn` | `styles/global.css:1680` | `.icon-btn { position: relative; display: inline-grid; place-items: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: var(--r-md); background: var(--surface); border: 1px solid var(--border); color: var(--text-1); cursor: pointer; flex: none; font: inherit; … }`（`:8273` 再覆写为 `--ctl-*` 一套） |
| 3 | `.icon-cell` | `styles/global.css:2937` | `.icon-cell { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; padding: 0; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--surface-2); color: var(--text-2); cursor: pointer; }` |
| 4 | `.chip` / `.chip-btn` | `styles/global.css:245` / `:4599` | `.chip { position: relative; display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; border-radius: var(--r-pill); font-size: var(--text-xs); line-height: 18px; font-weight: 500; … }` |
| 5 | `.today-quick-chip` | `styles/global.css:6589` | `.today-quick-chip { display: inline-flex; align-items: center; gap: 5px; height: 36px; padding: 0 16px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: var(--r-pill); background: var(--md-sys-color-surface-container-lowest); … }` |
| 6 | `.topbar-more` / `.dock-btn` / `.ex-btn-sm` / `.ohx-prefseg-btn` | `global.css:8052` / `:3795` / `explorer-ui.css:365` / `explorer-oh.css:241` | `.topbar-more { height: 34px; width: 34px; border-radius: 10px; border: 0; background: var(--surface-3); color: var(--text-1); display: grid; place-items: center; cursor: pointer; flex: none; … }` ／ `.dock-btn { height: 26px; padding: 0 8px; font-size: var(--text-xs); border-radius: var(--r-sm); white-space: nowrap; }` |

**结论**：`.btn` 有 **5 层**叠加（`:438` 基 → `:502/:512/:520` 变体 → `:8239` glass 覆写 → `:8256` primary 覆写 → `:8327` 暗色覆写）。TSX 里 `btn-ghost` 182 次、`btn-primary` 101 次、裸 `btn` 329 次、`icon-btn` 31 次、`btn mini` 17 次，但仍有 6 套独立按钮类。

### 2.5 输入框

| # | 选择器 | file:line | 逐字声明 |
|---|---|---|---|
| 1 | `.field select, .input`（一个规则组） | `styles/global.css:1276`（`.input` 在 `:1277`） | `.field select, .input { height: 38px; padding: 0 12px; border: 1px solid var(--border); border-radius: var(--md-sys-shape-corner-medium); background: var(--md-sys-color-surface-container); font-size: var(--text-base); color: var(--text-1); }` |
| 2 | `.cloud-search`（云盘搜索） | `styles/global.css:5025` | `.cloud-search { display: flex; align-items: center; gap: 8px; height: 36px; max-width: 420px; margin-bottom: 10px; padding: 0 10px; border: 1px solid var(--border); border-radius: 18px; background: var(--surface-2); color: var(--text-3); transition: border-color 0.15s, background 0.15s; }` — **圆角 18px 胶囊**，与 `.input` 的 8px 完全不同 |
| 3 | `.cloud-search input` | `styles/global.css:5032` | `.cloud-search input { flex: 1; min-width: 0; height: 100%; border: 0; outline: none; background: transparent; font-size: var(--text-sm); color: var(--text-1); }` |
| 4 | `.gitlab-search input` | `styles/global.css:5182` | `.gitlab-search input { flex: 1; min-width: 0; height: 100%; border: 0; outline: none; background: transparent; font-size: var(--text-sm); color: var(--text-1); }`（与 #3 逐字相同） |
| 5 | `.hwremind-custom input` | `styles/global.css:4625` | `.hwremind-custom input { flex: 1; min-width: 0; height: 30px; … }` |

**结论**：18 个文件直接用原生 `<select>`（`<select>` 共 29 处），只有 `lib/formModal.tsx:69` 给 `<select>` 挂了 `className="input"`，其余无样式。内联 `style={{}}` 里出现 **376 处** `fontSize: <数字>`、**108 处** `borderRadius: <数字>`，输入类控件大量靠内联兜底。

### 2.6 Tabs / 分段控件（**9 套并存**）

| # | 选择器 | file:line | 逐字声明 |
|---|---|---|---|
| 1 | `.tabstrip` | `styles/global.css:731` | `.tabstrip { display: flex; flex-wrap: wrap; gap: 2px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }` |
| 2 | `.segmented` | `styles/global.css:696` | `.segmented { display: inline-flex; gap: 2px; padding: 2px; background: var(--surface-3); border-radius: var(--r-pill); margin-bottom: 14px; }` |
| 3 | `.seg-track` | `styles/global.css:2419` | `.seg-track { display: flex; flex-wrap: nowrap; width: 100%; min-width: 0; gap: 3px; padding: 2px; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; cursor: grab; }` |
| 4 | `.plg-tab` | `styles/global.css:3246` | `.plg-tab { border: 0; background: transparent; padding: 5px 12px; border-radius: 6px; font-size: var(--text-sm); color: var(--text-2); font-weight: 500; cursor: pointer; transition: background 0.12s ease, color 0.12s ease; min-height: 28px; }` |
| 5 | `.gitlab-tabs` | `styles/global.css:5341` | `.gitlab-tabs { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; }`（**无背景、无下划线、无圆角**） |
| 6 | `.thos-tabs` | `styles/global.css:5779` | `.thos-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }` |
| 7 | `.settings-seg-item` | `styles/explorer.css:142` | `.settings-seg-item { position: relative; display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 11px; border-radius: var(--r-pill, 999px); border: 1px solid var(--md-sys-color-outline-variant, var(--border)); background: transparent; font-size: var(--text-xs, 12px); color: var(--text-2); white-space: nowrap; … }` |
| 8 | `.ohx-prefseg` | `styles/explorer-oh.css:231` | `.ohx-prefseg { display: inline-flex; align-items: center; gap: 2px; padding: 2px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); flex: none; }` |
| 9 | `.ex-tab` | `styles/explorer-ui.css:28` | `.ex-tab { display: inline-flex; align-items: center; max-width: 176px; min-width: 96px; height: 28px; border-radius: 8px; color: var(--text-2); flex: 0 0 auto; … }` |

**结论**：9 套 tabs，指示器实现互不相通（`.seg-pill` / `.seg-indi` / `.ex-tabstrip-indi` / `border-bottom` / 纯背景），圆角覆盖 6 / 8 / 999px，高度 28 / 32 / 36 混用。

### 2.7 设置行 / 设置分组

| # | 选择器 | file:line | 逐字声明 |
|---|---|---|---|
| 1 | `.setting-row` | `styles/global.css:924` | `.setting-row { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 13px 16px; border-top: 1px solid var(--md-sys-color-outline-variant); }` |
| 2 | `.setting-title` / `.setting-desc` | `styles/global.css:964` / `:965` | `.setting-title { font-size: var(--text-base); line-height: 22px; font-weight: 500; }` ／ `.setting-desc { font-size: var(--text-sm); line-height: 20px; color: var(--text-3); margin-top: 2px; max-width: 540px; }` |
| 3 | `.setting-group` | `styles/global.css:8355` | 与 `.card` / `.home-card` 同组：`background: linear-gradient(180deg, var(--glass-tint-top), var(--glass-tint-bottom)), var(--glass-card-fill-2); backdrop-filter: var(--glass-panel-blur); …` |
| 4 | `.wg-entry` | `styles/global.css:7541` | `.wg-entry { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 12px; border: 0; border-radius: var(--md-sys-shape-corner-medium, 12px); background: var(--surface-2); color: var(--text-1); font-size: 14px; text-align: left; }` |
| 5 | `.home-modal-row` | `styles/global.css:1854` | `.home-modal-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--md-sys-color-outline-variant); min-width: 0; }` |
| 6 | `.cloud-row`（同样在当设置行用） | `styles/global.css:4977` | 见 §2.2 |

**结论**：8 个 Section 组件（`ImSettingsSection` / `NotifySettingsSection` / `VoiceSettingsSection` / `SoftwareUpdateSection` / `WidgetSettingsSection` / `HelpSection` / `OverlaySettingsSection` / `ExplorerPrefsSection`）**各自手写 `.setting-row` DOM**；唯一抽象 `Layout.Switch` 只被 import 3 次，`.switch` 类名在 TSX 里裸用 5 处，另有 4 处 `role="switch"` 手写。

### 2.8 模态 / 抽屉 / 动作表（**14 套壳**）

| # | 选择器 | file:line | 逐字声明 |
|---|---|---|---|
| 1 | `.home-modal` | `styles/global.css:1817` | `.home-modal { width: 100%; max-width: 520px; max-height: 76vh; display: flex; flex-direction: column; background: var(--md-sys-color-surface-container-lowest); border: 1px solid var(--border); border-radius: var(--md-sys-shape-corner-large); box-shadow: var(--md-sys-elevation-3); animation: page-in 180ms cubic-bezier(0.2, 0.7, 0.3, 1) both; }` |
| 2 | `.plg-sheet` | `styles/global.css:4293` | `.plg-sheet { width: min(560px, calc(100% - 24px)); max-height: min(86dvh, 720px); background: var(--md-sys-color-surface-container-lowest); border: 1px solid var(--border); border-radius: var(--r-lg); box-shadow: var(--shadow-3); display: flex; flex-direction: column; overflow: hidden; … }` |
| 3 | `.board-sheet` / `.board-drawer` | `styles/global.css:7690` / `:7628` | `.board-sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 75; … max-height: 72vh; padding: 16px; border-radius: var(--md-sys-shape-corner-large, 16px) var(--md-sys-shape-corner-large, 16px) 0 0; background: var(--surface-3); box-shadow: 0 -8px 24px var(--md-sys-color-scrim); }` ／ `.board-drawer { … z-index: 70; … padding: 16px; border-radius: var(--md-sys-shape-corner-large, 16px) … 0 0; background: var(--surface-3); box-shadow: 0 -8px 24px var(--md-sys-color-scrim); }`（**几乎逐字相同，仅 z-index 70 vs 75**） |
| 4 | `.add-drawer` | `styles/global.css:7735` | `.add-drawer { position: fixed; left: 0; right: 0; bottom: var(--bottom-nav-h, 0px); height: 50vh; z-index: 55; display: flex; flex-direction: column; padding: 4px 16px calc(16px + var(--dock-clearance, 0px)); border-radius: 16px 16px 0 0; background: var(--md-sys-color-surface-container-lowest); box-shadow: 0 -8px 24px var(--md-sys-color-scrim); … }` |
| 5 | `.ex-sheet` | `styles/explorer-ui.css:200` | `.ex-sheet { position: fixed; right: 20px; bottom: calc(var(--explorer-bar-h, 48px) + 16px); z-index: 1300; display: flex; flex-direction: column; width: min(470px, 46vw); max-height: min(74vh, 680px); border: 1px solid var(--border); border-radius: 14px; background: var(--md-sys-color-surface-container-lowest, var(--surface, #fff)); … box-shadow: var(--md-sys-elevation-2, 0 18px 50px rgba(0, 0, 0, 0.24)); … }` |
| 6 | `.ohaa-panel`（附件动作表，**CSS 内嵌在 TSX**） | `apps/desktop/src/components/AttachActionsSheet.tsx:69` | `.ohaa-panel { width: 100%; max-width: 560px; max-height: 92vh; overflow: auto; background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary, #1c1f24); border-radius: var(--dsw-radius-xl, 20px) var(--dsw-radius-xl, 20px) 0 …` — **直接引用了 DSH 体系的 `--dsw-*` 令牌（OneTHU 主体系使用 `--md-sys-*`）** |
| 7 | `.ohf-panel`（图片滤镜表） | `apps/desktop/src/components/ImageFilterSheet.tsx:53` | 同上结构，`border-radius: var(--dsw-radius-xl, 20px) …` |
| 8 | `.tab-manage-panel`（**无 CSS**） | `apps/desktop/src/components/TabManageModal.tsx:83` | `<div className="tab-manage-panel" style={closing ? { ...panelStylePc, ...panelOut } : panelStylePc} …>` — 尺寸 / 圆角 / 背景全在内联对象里 |

遮罩层写法同样分散：`.ex-sheet-mask { background: rgba(0, 0, 0, 0.18); }`（`explorer-ui.css:192`）、`.plg-form-overlay { background: rgba(0, 0, 0, .35); backdrop-filter: var(--glass-scrim-blur); }`（`global.css:6195`），而 `lib/confirm.tsx:146/195/209` 三处则手写内联 `background: "rgba(0,0,0,.35)"` 与 `"rgba(0,0,0,.4)"`。
**z-index 层级分散**：CSS 文件内共有 **46 个**不同取值（0…10001），TSX 内联另有 **25 个**（9000 / 9001 / 9998 / 9999 / 2000 / 2110 …）。

### 2.9 空状态

| # | 选择器 | file:line | 逐字声明 |
|---|---|---|---|
| 1 | `.empty` | `styles/global.css:1028` | `.empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 32px 16px; text-align: center; color: var(--md-sys-color-on-surface-variant); font-size: var(--text-sm); }` |
| 2 | `.plg-empty` | `styles/global.css:3260` | `.plg-empty { display: grid; justify-items: center; gap: 8px; padding: 52px 16px; border: 1.5px dashed var(--border-strong); border-radius: var(--r-lg); text-align: center; }` |
| 3 | `.mail-empty` | `styles/global.css:4721` | `.mail-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 40px 16px; color: var(--text-3); font-size: var(--text-sm); }` |
| 4 | `.wg-empty` | `styles/global.css:7572` | `.wg-empty { display: flex; flex-direction: column; gap: 4px; padding: 12px; border: 1px dashed var(--border); border-radius: var(--md-sys-shape-corner-medium, 12px); }` |
| 5 | `.pal-empty` | `styles/global.css:7197` | `.pal-empty { padding: 16px 12px; font-size: 13px; color: var(--text-3); }` |
| 6 | `.trace-empty` | `styles/global.css:4504` | `.trace-empty { position: absolute; inset: 0; z-index: 450; display: flex; align-items: center; justify-content: center; color: var(--text-3); font-size: var(--text-sm); background: color-mix(in srgb, var(--surface-2) 60%, transparent); pointer-events: none; }` |

**结论**：15 个空态类（另有 `.dock-empty` `:3856`、`.ex-empty-hint` `explorer-ui.css:382`、`.search-dd-empty`、`.week-empty`、`.ykt-ans-empty`、`.ohx-history-empty` `explorer-oh.css:152`、`.plg-term-empty`、`.washer-dd-empty`、`.hw-carousel-empty`）。padding 覆盖 12 / 16 / 32 / 40 / 52px，颜色令牌 `on-surface-variant` 与 `outline` 混用，虚线边框 3 套（`1.5px dashed strong` / `1px dashed` / 无）。`<Empty>` 组件已用 **84 次**，但仍有裸类名直接使用：`.wg-empty` 9、`.plg-empty` 6、`.ykt-ans-empty` 6、`.mail-empty` 5、`.dock-empty` 3。

### 2.10 章节标题 / 分区头

| # | 选择器 | file:line | 逐字声明 |
|---|---|---|---|
| 1 | `.section-head` | `styles/global.css:167` | `.section-head { display: flex; align-items: center; justify-content: space-between; margin: 24px 2px 10px; }` |
| 2 | `.detail-sec-head` | `styles/global.css:1192` | `.detail-sec-head { padding: 8px 16px 6px; font-size: var(--text-xs); line-height: 18px; font-weight: 600; color: var(--text-3); letter-spacing: 0.02em; }` |
| 3 | `.ex-sec-head` | `styles/explorer-ui.css:250` | `.ex-sec-head { display: flex; align-items: baseline; gap: 8px; margin: 12px 0 4px; }` |
| 4 | `.wg-card-subhead` | `styles/global.css:7884` | `.wg-card-subhead { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 8px 12px 4px; font-size: 12px; font-weight: 600; color: var(--text-1); }` |
| 5 | `.nav-label` | `styles/global.css:51` | `.nav-label { padding: 14px 8px 6px; font-size: var(--md-sys-typescale-label-medium-size, var(--text-xxs)); font-weight: 500; color: var(--md-sys-color-on-surface-variant, var(--text-3)); letter-spacing: 0.04em; }` |
| 6 | `.page-head` | `styles/global.css:138` | `.page-head { display: flex; align-items: center; justify-content: space-between; gap: var(--gap-4); margin-bottom: 12px; }` |

**结论**：6 套标题（`baseline` 与 `center` 对齐混用），字号覆盖 10.5 / 12 / 13 / 14 / 16px，颜色 `--text-1` 与 `--text-3` 各半。

---

## 3. 样式机制普查

### (a) CSS 文件与类名

| 文件 | LOC | 规则块 | 不同类名 |
|---|---:|---:|---:|
| `styles/global.css` | 8 616 | 1 832 | 1 142 |
| `styles/explorer-home.css` | 1 003 | 181 | 105 |
| `styles/explorer-ui.css` | 941 | 199 | 101 |
| `styles/motion.css` | 912 | 126 | 80 |
| `styles/explorer.css` | 593 | 99 | 66 |
| `styles/explorer-oh.css` | 484 | 76 | 46 |
| `styles/glass-levels.css` | 112 | 6 | 0（只有 `:root` / `html` 令牌） |
| **合计** | **12 661** | **2 519** | **1 403 个不同 CSS 类** |

交叉核对：TSX 中字面 `className="..."` 共使用 **1 078** 个不同类名；其中 **80 个类名未出现在独立 CSS 文件中**（`ohaa-*` 20 个与 `ohf-*` 10 个来自 CSS-in-TS，其余如 `.btn-sm`、`.card-warn`、`.hw-ignore-btn`、`.page`、`.dim` 等缺少对应样式定义），另有 405 个 CSS 类名未见字面引用（来自动态拼接或历史残留）。

**CSS-in-TS 共 6 个文件**：`components/AttachActionsSheet.tsx`（20 条规则）、`components/ImageFilterSheet.tsx`（11 条）、`pages/ThubookPage.tsx`（3 条）、`lib/clients.ts`（2 条）、`pages/info/LibraryTab.tsx`（1 条）、`pages/learn/Forum.tsx`。

**`!important` 计数**：`global.css` 36、`explorer-ui.css` 24、`explorer.css` 13、`motion.css` 6、`explorer-home.css` 3、`explorer-oh.css` 1（共 83）。
**`--glass-*` 令牌 22 个**，靠 `global.css:8151`（`:root`）+ `:8205`（`:root[data-scheme="dark"]`）双份维护。
**裸圆角字面量**：`global.css` 里出现 **17 种**不同 `border-radius: <n>px`（2 / 3 / 4 / 5 / 6 / 7 / 8 / 9 / 10 / 12 / 14 / 16 / 17 / 18 / 24 / 999），而令牌只有 5 档（6 / 8 / 12 / 16 / 999）。`var(--r-md)` 46 次、`var(--r-pill)` 59 次、`var(--r-sm)` 25 次、`var(--r-lg)` 11 次。

### (b) 内联 `style={{...}}`

- **1 481 处**，分布在 **111 个 TSX 文件**。
- 其中 `fontSize: <纯数字>` **376 处**、`borderRadius: <纯数字>` **108 处**（绕开令牌）。

Top 20 文件：

| # | 文件 | 处数 | # | 文件 | 处数 |
|---:|---|---:|---:|---|---:|
| 1 | `pages/zhjwxk/Courses.tsx` | 217 | 11 | `pages/info/CardTab.tsx` | 32 |
| 2 | `pages/Settings.tsx` | 98 | 12 | `components/ThemePickerModal.tsx` | 31 |
| 3 | `components/FilePreview.tsx` | 95 | 13 | `pages/Plugins.tsx` | 29 |
| 4 | `pages/Schedule.tsx` | 94 | 14 | `pages/info/NetworkTab.tsx` | 28 |
| 5 | `pages/info/LibraryTab.tsx` | 44 | 15 | `components/boardCards.tsx` | 24 |
| 6 | `pages/info/LibRoomTab.tsx` | 41 | 16 | `pages/learn/AssignmentDetailPage.tsx` | 23 |
| 7 | `pages/CloudPage.tsx` | 41 | 17 | `pages/info/SportsTab.tsx` | 22 |
| 8 | `components/GlobalOrb.tsx` | 38 | 18 | `pages/ScheduleAgenda.tsx` | 20 |
| 9 | `pages/learn/Forum.tsx` | 34 | 19 | `lib/confirm.tsx` | 20 |
| 10 | `VenueSportsTab.tsx` / `NewsTab.tsx` / `KongjianTab.tsx` | 各 32 | 20 | `components/ConnectGate.tsx` | 19 |

另有 7 处 TSX 直接 `style={{ "--x": … }}` 注入 CSS 变量，7 处 `setProperty("--…")`。

### (c) TSX 中的原始色值字面量

- **462 处**（十六进制 **322** 处 + `rgb()`/`rgba()` **140** 处），分布在 **44 个 TSX 文件**。
- 去重后：**90 个不同十六进制串（归一化 88 个不同颜色）** + **81 个不同 `rgba()` 值** = **约 169 个不同色值**未走令牌。

Top 文件：

| # | 文件 | 处数 | # | 文件 | 处数 |
|---:|---|---:|---:|---|---:|
| 1 | `components/FilePreview.tsx` | 54 | 6 | `pages/ThubookPage.tsx` | 17 |
| 2 | `pages/zhjwxk/Courses.tsx` | 48 | 7 | `components/ExtHwLoginModal.tsx` | 12 |
| 3 | `pages/Schedule.tsx` | 42 | 8 | `lib/confirm.tsx` | 11 |
| 4 | `components/GlobalOrb.tsx` | 20 | 9 | `NetworkTab.tsx` / `ScheduleAgenda.tsx` / `ThemePickerModal.tsx` / `OnboardingTourParticles.tsx` | 各 9 |
| 5 | `components/AttachActionsSheet.tsx` | 19 | 10 | `components/ImageFilterSheet.tsx` | 8 |

高频字面量（重复说明这些值本应是令牌）：`#fff` 31、`#9aa1ac` 29、`#999` 25、`#e5484d` 15、`#1f2329` 14、`#6d7ff0` 10、`#eee` 9、`#ff9f1a` 9、`#ffffff` 9、`#f0f0f0` 8、`#c04848` 7、`#d33` 7、`#ccc` 7；`rgba(0,0,0,.45)` 8(+4 空白变体)、`rgba(0,0,0,.28)` 7、`rgba(0,0,0,.18)` 5、`rgba(0,0,0,.25)` 5。

**令牌重复定义**：`packages/ui/src/tokens.css:126-132` 中 `--surface` / `--surface-2` / `--surface-3` 各声明了两次（`:126-128` 指向 `--glass-card-fill*`，`:130-132` 随即改回 `--md-sys-color-surface-container-*`），后一组声明覆盖了前一组，使 `:126-128` 未能生效。

---

## 4. 硬编码视觉重复清单（按「渲染什么」分组）

同组内的类渲染同一种东西但各自独立实现。★ = 组内存在**逐字节相同的规则体**。

| 组 | 成员（`g:` = `styles/global.css`，`e:` = `styles/explorer.css`，`eui:` = `explorer-ui.css`，`eh:` = `explorer-home.css`，`eo:` = `explorer-oh.css`） | 重复要素 |
|---|---|---|
| **卡片 / 面板** ★ | `.card`(g:160,:8355) `.home-card`(g:1610) `.plg-card`(g:3144) `.market-card`(g:6104) `.gitlab-card`(g:5202) `.cloud-repo`(g:4938) `.cloud-onboard`(g:4871) `.wg-card`(g:7555) `.hw-card`(g:6706) `.stat-card`(g:320) `.notice-strip`(g:6899) `.balance-strip`(g:6939) `.selfcheck-card`(g:7171) `.svc-card`(g:6535) `.task-card`(g:6641) `.mail-list` `.mail-detail` `.fp-info` `.mine-student-*` | 圆角 ×7、描边写法 ×4、材质 ×2、阴影 ×5 |
| **列表行** ★ | `.row`(g:181) `.cloud-row`(g:4977) `.mail-row`(g:4671) `.svc-row`(g:6536) `.task-row`(g:6642) `.ex-row`(eui:301) `.pal-row`(g:7162) `.wb-row`(g:1935) `.picker-row`(g:7894) `.home-catalog-row`(eh:145) `.ctx-item`(g:7952) `.wg-entry`(g:7541) `.mcp-item`(g:6213) `.setting-row`(g:924) `.home-modal-row`(g:1854) `.tl-item`(g:387) | gap / padding / 分隔线方向 / 圆角全不统一 |
| **按钮（state layer）** ★ | `global.css:449-478` 一次性列出 9 个共享 `::after` 的类：`.btn` `.icon-btn` `.chip` `.today-quick-chip` `.task-stat` `.app-card` `.mail-row` `.wb-row` `.chip-btn` | 9 个类各自实现同一套 state layer（作者已知重复） |
| **收缩按钮** | `.icon-btn`(g:1680) `.icon-cell`(g:2937) `.topbar-more`(g:8052) `.dock-btn`(g:3795) `.ex-btn-sm`(eui:365) `.ohx-prefseg-btn`(eo:241) `.hard-refresh-fab` | 26 / 34 / 40px 三种尺寸，圆角 8 / 10 / 12 |
| **输入** ★ | `.field select, .input`(g:1276) `.cloud-search`(g:5025) `.gitlab-search`(g:5165) `.hwremind-custom input`(g:4625) `.ex-sheet-search`(eui:519) `.search-dd-search` | 高度 30 / 36 / 38，圆角 8 / 18 |
| **Tabs / 分段** ★ | `.tabstrip`(g:731) `.segmented`(g:696) `.seg-track`(g:2419) `.plg-tab`(g:3246) `.gitlab-tabs`(g:5341) `.thos-tabs`(g:5779) `.settings-seg-item`(e:142) `.ohx-prefseg`(eo:231) `.ex-tab`(eui:28) `.xk-mobile-tabs`(g:2663) `.plg-install-tabs`(g:3245) | 见 §2.6，9 套 |
| **空状态** | `.empty`(g:1028) `.plg-empty`(g:3260) `.mail-empty`(g:4721) `.wg-empty`(g:7572) `.pal-empty`(g:7197) `.trace-empty`(g:4504) `.dock-empty`(g:3856) `.ex-empty-hint`(eui:382) `.search-dd-empty`(g:1530) `.week-empty`(g:1445) `.ykt-ans-empty`(g:6057) `.ohx-history-empty`(eo:152) `.plg-term-empty`(g:3233) `.washer-dd-empty`(g:1531) `.hw-carousel-empty`(g:6772) | 15 套 |
| **章节标题** | `.section-head`(g:167) `.detail-sec-head`(g:1192) `.ex-sec-head`(eui:250) `.plg-tab-head`(g:6227) `.wg-card-subhead`(g:7884) `.nav-label`(g:51) `.page-head`(g:138) `.home-card-head`(g:1624) `.hw-card-head`(g:6729) `.card-warn-head`(g:7342) `.setting-title`(g:964) `.market-card-head`(g:6111) `.picker-head`(g:7890) | baseline / center 混用 |
| **模态 / 抽屉 / 遮罩** ★ | `.home-modal`(g:1817) `.plg-sheet`(g:4293) `.plg-form-modal`(g:6200) `.board-sheet`(g:7690) `.board-drawer`(g:7628) `.add-drawer`(g:7735) `.ex-sheet`(eui:200) `.ykt-formula-dialog`(g:6351) `.pal`(g:7163) `.ctx-menu`(g:7952) `.ex-ctxmenu`(eui:596) `.ohaa-panel`(AttachActionsSheet.tsx:69) `.ohf-panel`(ImageFilterSheet.tsx:53) `.tab-manage-panel`(内联) `.theme-pick-panel` `.collect-modal`(g:2908) | 14 套壳、3 套遮罩、z-index 46 + 25 个取值 |
| **上下文菜单** | `.ctx-menu`(g:7952) `.explorer-ctxmenu`(eui:600) — 且 `components/ContextMenu.tsx`（917 行）与 `components/explorer/ContextMenu.tsx`（109 行）是**两份独立实现** | 2 个组件 + 2 个类 |
| **开关** ★ | `.switch`(g:876) `.plg-switch`(g:3184) — 除属性书写顺序外**完全一致**；另有 4 处手写 `role="switch"` | 2 套 |
| **Toast** | `.toast-host`(g:4818，底部居中药丸 ≠ `#1f2329` 深色) `.plugin-toast-host`(g:3321，`background: #1f2329; color: #fff;`) `.collectable-note`(g:7381) `.board-note`(g:7428，与前者逐字同体) `.dock-voice-toast` | 5 套提示条 |
| **进度 / 骨架** | `.cloud-quota-bar`(g:4920，4px) `.thos-progress` / `.thos-progress-bar`(g:5890) `.plg-ev-progress`(g:3238) `.skeleton`(g:842) | 4 套 |
| **表格** | `.data-table`(g:1328) + 8 个文件直接裸用 `<table>`（`FilePreview` `ReportTab` `CourseInfoTab` `NetworkTab` `FitnessTab` `SportsTab` `PayrollTab` `ClassroomTab`） | 1 个类，几乎无样式 |
| **导航** | `.nav-item`(g:73) `.bottom-nav-item` `.ex-tab`(eui:28) `.ex-bbar` `.ohx-slot` `.dock-*` | 5 套导航条（侧栏 / 底栏 / 标签栏 / 胶囊 / dock） |

**逐字节相同规则体**：解析出 **67 组**。最大一组 5 处同 body（`display: flex; flex-direction: column; gap: 4px;`）；玻璃菜单层 4 处重复（`global.css:8211` 已列 16 个类，`explorer.css:233`、`explorer-ui.css:765`、`explorer-home.css:835` 又各写一遍）；`.svc-row` ≡ `.task-row`；`.svc-card` ≡ `.task-card`（均 `padding: 4px;`）；`.switch` ≡ `.plg-switch`。

---

## 5. 迁移面估算（按体积降序）

「视觉节点」= `className=` 出现次数（每处 ≈ 一个需被组件替代的 JSX 节点）；「内联」= `style={{}}` 处数；「交互」= `<button>` + `<input|select|textarea>` 次数。

| 文件 | LOC | 视觉节点 | 内联 | 交互 | 迁移重点 |
|---|---:|---:|---:|---:|---|
| `pages/Settings.tsx` | 2 116 | 202 | 98 | 86 | settings-row / switch / select 三件套；98 处内联 |
| `pages/zhjwxk/Courses.tsx` | 1 607 | 104 | **217** | 75 | 最脏：几乎无类名可依，全靠内联；19 个原生 select |
| `pages/GitLabPage.tsx` | 1 578 | 196 | 11 | 55 | `.gitlab-*` 62 个私类；tabs / search / card 全私有 |
| `pages/Plugins.tsx` | 1 553 | 208 | 29 | 54 | `.plg-*` 105 个类（全库最大前缀族） |
| `pages/Schedule.tsx` | 1 386 | 35 | 94 | 39 | 类少内联多，整页需重写 |
| `components/explorer/TabStrip.tsx` | 1 082 | 21 | 14 | 10 | 与 TabHost / TabDrawer 一起替换 tabs 体系 |
| `components/explorer/TabDrawer.tsx` | 1 070 | 61 | 2 | 24 | Drawer + 第二套 ContextMenu |
| `pages/Today.tsx` | 1 012 | 86 | 6 | 28 | `Card` / `.list` 已半共享，收口成本低 |
| `pages/info/LibRoomTab.tsx` | 1 000 | 36 | 41 | 14 | 列表 + 日期分组的本地实现 |
| `pages/info/NewsTab.tsx` | 991 | 36 | 32 | 20 | `.news-row` 另起一套 |
| `pages/BoardPage.tsx` | 987 | 32 | 2 | 10 | 白板壳 + 多个 sheet |
| `pages/info/VenueSportsTab.tsx` | 954 | 26 | 32 | 15 | |
| `pages/info/LibraryTab.tsx` | 937 | 24 | 44 | 8 | 含 CSS-in-TS 1 条 |
| `pages/TasksPage.tsx` | 736 | 68 | 2 | 17 | `.task-*` 24 个类 |
| `pages/CloudPage.tsx` | 702 | 78 | 41 | 23 | `.cloud-*` 22 个类；与学堂对比样板 |
| `pages/FolderPage.tsx` | 605 | 68 | 9 | 36 | |
| `pages/learn/Forum.tsx` | 601 | 35 | 34 | 19 | 含 CSS-in-TS |
| `pages/learn/shared.tsx` | 595 | 46 | 3 | 8 | 8 个可复用 Row，应升格进 OneGUI |
| `pages/Trace.tsx` | 545 | 27 | 4 | 8 | |
| `pages/learn/AssignmentDetailPage.tsx` | 537 | 45 | 23 | 13 | |
| `pages/learn/YktAssignmentDetailPage.tsx` | 535 | 49 | 1 | 5 | |
| `pages/info/CardTab.tsx` | 532 | 59 | 32 | 16 | `.icon-cell` 网格 |
| `pages/info/ThosPage.tsx` | 493 | 31 | 5 | 6 | `.thos-*` 12 类 + 独立 tabs |
| `pages/learn/SearchPage.tsx` | 477 | 37 | 8 | 3 | |
| `pages/info/SportsTab.tsx` | 471 | 26 | 22 | 10 | 裸 `<table>` |
| `components/explorer/OneGoSheet.tsx` | 418 | 71 | 1 | 18 | Drawer 壳 |
| `pages/info/KongjianTab.tsx` | 392 | 16 | 32 | 10 | |
| `pages/learn/CourseDetailPage.tsx` | 373 | 17 | 7 | 3 | `Card.list` 5 处 |
| `pages/info/NetworkTab.tsx` | 372 | 15 | 28 | 10 | 裸 `<table>` + 9 处色值 |
| `pages/Learn.tsx` | 347 | 56 | 6 | 10 | `.stat-card` + `Card.list` |
| `pages/MailPage.tsx` | 340 | 59 | 6 | 16 | `.mail-*` 35 类（第 4 大前缀族） |
| `pages/learn/YktCoursePage.tsx` | 336 | 18 | 3 | 4 | |
| `pages/learn/NoticeDetailPage.tsx` | 303 | 23 | 1 | 5 | |
| `pages/learn/AssignmentsPage.tsx` | 297 | 16 | 5 | 9 | |
| `pages/info/WasherTab.tsx` | 296 | 16 | 2 | 3 | `.washer-*` 11 类 |
| `components/explorer/TabHost.tsx` | 292 | 6 | 4 | 1 | |
| `pages/ThubookPage.tsx` | 282 | 4 | 13 | 3 | 含 CSS-in-TS 3 条 |
| `pages/info/ClassroomTab.tsx` | 269 | 11 | 7 | 3 | 裸 `<table>` |
| `pages/info/DormTab.tsx` | 265 | 22 | 8 | 8 | |
| `pages/Login.tsx` | 263 | 38 | 8 | 13 | `.login-card` 独立一套 |
| `components/explorer/HomeSpheres.tsx` | 255 | 40 | 2 | 10 | |
| `pages/ScheduleAgenda.tsx` | 236 | **0** | 20 | 2 | 完全无类名，纯内联 |
| `pages/info/CourseInfoTab.tsx` | 229 | 7 | 18 | 2 | 裸 `<table>` |
| `components/explorer/OhCapsule.tsx` | 221 | 7 | 0 | 2 | |
| `pages/info/ReportTab.tsx` | 189 | 33 | 4 | 0 | 裸 `<table>` |
| `components/explorer/WallpaperLibrary.tsx` | 180 | 18 | 2 | 10 | |
| `pages/info/newsSearch.tsx` | 177 | 0 | 1 | 0 | 零类名 |
| `pages/info/reportParts.tsx` | 171 | 13 | 0 | 0 | |
| `components/explorer/renderPage.tsx` | 170 | 6 | 0 | 0 | |
| `pages/info/InfoPage.tsx` | 169 | 11 | 1 | 3 | |
| `pages/ServicesPage.tsx` | 161 | 28 | 0 | 6 | `.svc-*` 12 类 |
| `components/explorer/WorkspaceEditor.tsx` | 158 | 7 | 14 | 8 | |
| `pages/info/LifePage.tsx` | 142 | 10 | 1 | 2 | |
| `components/explorer/PhoneSheet.tsx` | 118 | 2 | 0 | 0 | |
| `pages/info/CalendarTab.tsx` | 116 | 7 | 8 | 7 | |
| `pages/learn/NoticesPage.tsx` / `FileDetailPage.tsx` | 115 / 113 | 5 / 5 | 1 / 1 | 3 / 3 | |
| `pages/info/GradIncomeTab.tsx` | 113 | 13 | 3 | 0 | |
| `pages/info/ReservePage.tsx` | 112 | 7 | 1 | 1 | |
| `pages/learn/SemesterSelectionPage.tsx` | 111 | 13 | 0 | 1 | |
| `pages/info/tabStates.tsx` | 109 | 0 | 0 | 0 | 空 / 载态，应并入 `Empty` |
| `components/explorer/ContextMenu.tsx` | 109 | 3 | 1 | 1 | 与 `ContextMenu.tsx` 合并 |
| `pages/info/InvoiceTab.tsx` | 102 | 9 | 3 | 2 | |
| `pages/info/ExamsTab.tsx` | 102 | 8 | 2 | 0 | |
| `pages/OtherInfoPage.tsx` | 98 | 9 | 7 | 3 | |
| `pages/info/HygieneTab.tsx` | 90 | 3 | 4 | 3 | |
| `pages/BoardListPage.tsx` | 86 | 7 | 0 | 2 | |
| `components/explorer/SettingsOverlay.tsx` | 83 | 7 | 0 | 2 | |
| `pages/info/PayrollTab.tsx` | 81 | 4 | 3 | 0 | 裸 `<table>` |
| `pages/info/EvaluationTab.tsx` | 78 | 9 | 2 | 0 | |
| `pages/info/FitnessTab.tsx` | 75 | 4 | 2 | 0 | 裸 `<table>` |
| `pages/learn/FilesPage.tsx` | 73 | 3 | 2 | 2 | |
| 其余 ≤ 75 行文件 | — | — | — | — | 一次性小额 |

**汇总**：需要经 OneGUI 重表达的视觉节点约 **2 559** 个（§5 表内 `className=` 合计），另有 **1 481** 处内联样式与 **462** 处裸色值需要先回收到令牌。

**三大迁移热点**（按综合成本）：
1. `pages/Settings.tsx` — 202 节点 / 98 内联 / 86 交互，同时也是 8 个 Section 组件手写 `.setting-row` 的源头。
2. `pages/Plugins.tsx` + `pages/GitLabPage.tsx` — 208 + 196 节点，共包含 `102` 个 `.plg-*` / `.gitlab-*` 私有类，构成全库规模最大的两套页内私有样式族。
3. `pages/zhjwxk/Courses.tsx` + `pages/Schedule.tsx` — 分别含 217 处与 94 处内联样式，现有类名覆盖极少，迁移前需先提炼组件抽象。

---

## 附：可直接复用的既有资产（避免重造）

- `components/Layout.tsx` 已沉淀出 7 个基础抽象（`Card` `Empty` `Switch` `SectionHead` `SkeletonRows` `PageHead` `SegmentedOverflow`），被 61 个文件 import；调用频次分别为 `Empty` 84 次、`Card` 55 次、`SkeletonRows` 37 次、`PageHead` 31 次、`ErrorNote` 30 次、`SectionHead` 25 次、`SegmentedOverflow` 12 次。OneGUI 可直接在此基础上演进扩充。
- `packages/ui` 已建立清晰的令牌分层（System → Compat 两级映射，`tokens.css:88-92`），当时仅提供 CSS 文件并由桌面端直接引入（`apps/desktop/src/main.tsx:39,50`），尚未包含 React 组件导出。
- `components/Icons.tsx` 已收录完整的 51 个图标（含 `FOLDER_ICONS` 表），可直接迁入组件库。
- 玻璃材质收口在 `global.css:8151-8290` 与 `:8400+` 的少量覆写块中；先将 §2.1 中仍用实心底色的 6 个卡片类统一接入后，调整材质即可只改动这两处。
