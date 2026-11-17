# OneTHU · dev-explorer：从校园服务导航到个人校园工作空间


> 归档说明：本文记录当时的设计方案与阶段性验收情况；0.11 当前功能与使用指南请查阅 [文档首页](../README.md)（[English overview](../en/index.md)）。

> 2026-10-12 立项。前置阶段记录见 `docs/ball/PLAN.md`（Ball 分支，task-1 至 task-22 已于 `cf8dd13` 与 `bdae9c1` 收口）。
> 本分支重构整体交互架构：底栏收敛为三入口（标签页 | OH | OneGO），配合顶栏标签条，全面移除传统侧边栏，**实现桌面端与移动端统一交互**。

## 0. 设计定稿要点（核心约束加粗）

1. **左上角常驻首页按钮（点击回到首页），右上角常驻设置按钮**——点击展开「个人设置 / 插件 / OneTHU Harness」三合一浮层，**独立于标签页体系之外，层级高于所有标签页**。
2. **OnePage 先沿用收藏夹结构组织**，支持嵌套子收藏夹（OnePage 之间平级，可在一个 OnePage 内放入另一个 OnePage 的入口），直接接入现有 `favs` 体系，以 `FolderPage` 作为 OnePage 视图（已验证嵌套可用，零额外改动）。
3. **OH 胶囊条整合搜索与 OH 对话**：支持短按打开与长按语音输入；「点击默认打开」与「长按语音发送到」均可配置默认目标（搜索或 OH），弹出小窗后也可随时切换；**搜索保留最近 10 条跳转记录**；延续原有可拖动气泡小窗形态，搜索无结果时可在小窗内一键丝滑切换到 OH 对话。
4. **悬浮球展开面板同步配备**：默认目标设置、模式切换、普通搜索与搜索跳转记录。
5. **桌面端移除侧边栏**，与手机端采用同一套导航交互。
6. 标签页对应 0.10 版一级子页面（如信息、网络学堂）的独立实例；**支持深链直达具体栏目（如「信息-新闻」），同时保持标签页主题稳定，可在栏内自由切换子项（如切到「信息-成绩」）**。
7. OnePage 完整形态分阶段演进，现阶段**直接平移现有页面组织方式**（首页保留 `TodayPage` 卡片体系并叠加新导航层）。

## 1. 架构实现

### 状态机
- `state/explorer.ts`：作为标签页、工作区与设置浮层的统一数据源（模块级 store，持久化至 `localStorage` 的 `onethu.explorer.v2`）。
  - 首页标签页（`id="home"`）作为常驻单例保留；`openTab` 负责入口级导航（支持同一页面多开，`dedupe` 参数供工作区恢复使用）；`navigateInTab` 负责标签页内跳转并保留上下文；`explorerNavigate` **承接全库 `navigate()` 调用**：遇到 `settings/plugins` 打开设置浮层，当前位于首页时新开标签页，其余情况在当前标签页内跳转。
  - 工作区保存为标签页快照数组（提供 `saveWorkspace/openWorkspace/deleteWorkspace/renameWorkspace`）。
  - 设置浮层接管原 Entry 状态机（`openSettings("settings"|"plugins"|"oh")`），并由 `Layout.tsx` 轻量转发导出 `goEntry/useEntry/entrySnapshot/subscribeEntry`，保持既有调用点无需改动。
  - URL hash 由 explorer 统一维护：内部写入自动对账消解，外部深链触发时新开标签页。
  - 通过动态引入调用 `recordUse` 记录「最近使用」，延续原有统计行为并避免模块循环依赖。
- `state/explorerPrefs.ts`：管理胶囊默认动作（`capsuleTap/voiceTarget`）及跨入口共享的最近 10 条搜索跳转记录。
- `plugins/ohControl.ts`：提供 OH 命令总线（`requestOhPanel/requestOhVoice/onOhCommand`），胶囊条、悬浮球与首页搜索条统一发送命令，由 `ChatDock` 订阅响应。

### 渲染层
- `components/explorer/TabHost.tsx`：已激活过的标签页常驻挂载并通过 `display` 切换保活（keep-alive）；普通标签页**在首次聚焦时才挂载**，避免启动恢复时并发拉取造成请求风暴，挂载后在会话期内保留；页内导航按 `key=page` 重新挂载以保留过渡动画。
- `components/explorer/renderPage.tsx`：从 `App.tsx` 抽离原有的页面路由分发逻辑（含 `PluginTabHost`）。
- `components/explorer/SettingsOverlay.tsx`：实现设置浮层（移动端全屏展示，桌面端从右侧滑入），内嵌 `SettingsPage/PluginsPage`。
- `components/explorer/HomeTab.tsx`（`explorer-home` 交付）：集成搜索条（唤起搜索与 OH 二合一小窗）、继续上次浏览恢复条、功能目录卡（覆盖 `NAV_REGISTRY` 全部五组入口）以及原有的 `TodayPage`。
- `components/explorer/{TabStrip,TabDrawer,OneGoSheet,BottomBar}.tsx`（`explorer-ui` 交付）：分别实现顶栏标签条、标签管理抽屉、OneGO 抽屉（含 OnePage 收藏夹与工作区两栏）及底栏三入口。
- `components/{Layout,App}.tsx`：完成外壳重构，下线旧侧边栏、抽屉与五格底栏，切换为 `TopBar`（Logo + `TabStrip` + 搜索 + 齿轮）+ `TabHost` + `BottomBar` + `CommandPalette` + `SettingsOverlay`。

### OH 交互链路（`explorer-oh` 交付）
- `OhCapsule` 置于底栏中央（短按按偏好打开搜索或 OH，长按启动语音）；`ChatDock` 新增搜索模式（整合 `searchAll`、最近跳转记录及零结果一键转 OH）；`GlobalOrb` 同步接入相同能力，并在设置页提供 `ExplorerPrefsSection` 配置项。

## 2. 导航行为速查

| 操作 | 行为 |
|---|---|
| 原侧栏入口（已移除） | — |
| 首页目录 / 快捷卡片 / OneGO / 搜索命中 | 调用 `openTab` 新开标签页（`today` 聚焦首页；`settings/plugins` 打开浮层） |
| 页内链接（如列表进入详情） | 在当前标签页内跳转，保持标签页主题稳定 |
| 底栏「标签页」 | 打开 `TabDrawer`，管理、排序、关闭标签页或切换工作区 |
| 底栏「OneGO」 | 打开 `OneGoSheet`，访问 OnePage（收藏夹）与工作区 |
| 底栏「OH」/ 悬浮球 | 打开二合一小窗（可在搜索与 OH 间切换，默认视图由偏好设置决定） |
| 顶栏 Logo / 齿轮 | 回到首页 / 打开设置浮层 |

## 3. 第一阶段设计取舍（v1）
- 工作区恢复按 `page` 加 `folderId/courseId` 识别同类实例（深链参数采用近似匹配恢复）。
- 同一页面多开多个标签页时，各实例各自独立拉取数据。
- 后台标签页第一阶段先依靠首次聚焦懒挂载控制资源开销，后台副作用冻结机制留待后续迭代。
- 设置浮层关闭动画复用 `TabManageModal` 方案；标签条先提供上下移动排序，拖拽排序后续补充。

## 4. 验收清单
- [ ] TypeScript 类型检查零报错，`pnpm -C apps/desktop build` 构建通过
- [ ] 自动化护栏全绿：`settings-search-coverage` / `search-landing` / `oh-routes-sync` / `plugin-action-style`
- [ ] 手工走查：登录进入首页；从目录连续打开三个作业标签页并确认互不干扰；在标签页内进入详情后切走再切回，确认浏览上下文保留；保存工作区、关闭标签页后一键恢复；搜索「音色」直达设置浮层对应项；搜索无结果时一键转入 OH；重启应用后确认标签页状态自动恢复
