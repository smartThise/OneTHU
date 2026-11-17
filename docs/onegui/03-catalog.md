# OneGUI · 组件目录与迁移台账


> 归档说明：本文记录当时的组件目录与阶段性迁移台账；0.11 当前功能与使用说明请查阅 [文档入口](../README.md)（[English overview](../en/index.md)）。


> 本文根据 `packages/gui/src/index.ts` 导出清单与 `tools/onegui-baseline.json` 台账生成（2026-10-14）。
> 组件设计准则见 [10-contract.md](./10-contract.md)，整体规划见 [00-plan.md](./00-plan.md)。
> 画廊预览：`http://127.0.0.1:5180/?onegui-gallery=1`（可追加 `&skin=glass&level=rich&scheme=dark&density=touch`）。

## 1. 六轴（唯一调度源头）

| 轴 | 取值 | 落盘 | 谁改 |
|---|---|---|---|
| skin | `neutral`（基准）/ `glass` / 注册的第三方皮肤 | `data-og-skin` | 设置页 → `director.set` |
| skinLevel | `clear` / `base` / `rich` / `deep` | `data-og-skin-level` | 设置页（仅玻璃皮肤） |
| scheme | `auto` / `light` / `dark` | `data-og-scheme` | 设置页 / 系统 |
| density | `comfortable` / `compact` / `touch` | `data-og-density` | 平台判定 + 设置 |
| motion | `full` / `reduced` | `data-og-motion` | 设置 / 系统 prefers-reduced-motion |
| platform | `desktop` / `mobile` | `data-og-platform` | `state/platform.ts` 唯一断点 |
| accent | 主题色对象 / `null` | 内联 `--og-accent*` 一族 | 主题系统（含动态取色） |

局部定制统一通过 `director.defineScope(name, { "surface-1": "surface-2", radius: "lg" })` 配合 `<Card scope=Badge>` 实现；
可选值域受 `SCOPE_TOKENS` 白名单约束，仅支持映射到既有语义令牌或预设枚举档位。

## 2. 组件目录（66 个，全部在画廊登记）

- `Accordion`
- `AccordionItem`
- `ActionSheet`
- `Avatar`
- `FocalImage` — 受控图片取景（焦点/缩放），供名片封面等复用
- `Badge`
- `Banner`
- `Breadcrumb`
- `Btn`
- `BtnGroup`
- `Card`
- `Checkbox`
- `Chip`
- `CodeBlock`
- `ContextMenu`
- `DataList`
- `DataRow`
- `Divider`
- `Drawer`
- `EmptyState`
- `Fab`
- `Field`
- `Grid`
- `Grow`
- `Inline`
- `Input`
- `List`
- `LoadingBlock`
- `Menu`
- `Modal`
- `NumberField`
- `Page`
- `PageHead`
- `Pagination`
- `Popover`
- `Progress`
- `Radio`
- `RadioGroup`
- `RangeSlider`
- `Ring`
- `Row`
- `SearchField`
- `Section`
- `SectionCard`
- `Segment`
- `Select`
- `SettingsList`
- `SettingsRow`
- `Sheet`
- `Skeleton`
- `Slider`
- `Spacer`
- `Spinner`
- `Stack`
- `StatTile`
- `Surface`
- `Switch`
- `Table`
- `Tabs`
- `Tag`
- `Text`
- `TextArea`
- `Tile`
- `Timeline`
- `Toolbar`
- `Tooltip`
- `VerticalTabs`

图标：`packages/gui/src/components/icons.tsx` —— 51 枚自绘线性图标整体平移（`ICONS` 注册表 + `FolderIcon`）。

## 3. 迁移台账（护栏棘轮基线，单向下调）

| 项 | 现状 | 目标 |
|---|---:|---:|
| 应用侧带外观属性的 `style={{…}}` | 660 | 0 |
| 应用侧 TSX 字面色值（#rgb/rgba） | 675 | 0 |
| 应用侧裸 `<button\|input\|select\|textarea>` | 1143 | 0 |
| `apps/desktop/src/styles/*.css` | 12,661 行 / 1,403 类 | 删除 |
| 页面里手写的旧类名（card / empty / skeleton / error-note / section-head） | 170 / 62 / 7 / 5 / 3 处 | 0 |
| `packages/ui`（旧令牌包） | tokens + base | 由 OneGUI 取代后删除 |

校验命令：`pnpm guard:onegui`（每完成一批迁移后运行 `node tools/onegui-guard.mjs --write-baseline` 收紧基线）。

## 4. 迁移顺序（每页 = 一次提交）

1. ✅ 组件库底座：按「令牌 → 管线 → 布局 → 文本 → 面/卡 → 按钮 → 行/列表 → 表单 → 浮层 → 页面模式 → 展示件 → 图标 → 画廊 → 护栏」顺序完成搭建。
2. 🔄 壳层过渡：`AppShell` 等外框组件已入库（桌面竖栏与手机底部条已完成截图验收）；
   `Layout.tsx` 中的八个旧原语（Card/Empty/SectionHead/ErrorNote/SkeletonRows/Switch/PageHead）已切换为 OneGUI 适配层，
   一次性接管全仓 60/40/28/30/8/31 个调用点。
   `markSettingsRows()` 与 `focusSettingsTarget()` 同步支持新旧两族类名（.setting-row/.section-head 与 .og-settings-row/.og-section），
   保持设置搜索与直达体验平滑衔接。**待完成项**：将 `Layout.tsx` 外框本体（竖栏/顶栏/标签条/抽屉/设置浮层/命令面板）切换为 `AppShell`。
3. ⏳ 重点页面攻坚：依次推进清华云盘（cloud-*）、网络学堂（作业/通知/富文本壳）、设置页与全部弹层。
4. ⏳ 其余页面迁移：遍历 `pages/` 全量页面，完成一页即移除对应旧 CSS。
5. ⏳ 收尾清理：删除 `apps/desktop/src/styles/*` 与 `packages/ui`，由 `onegui-guard` 接替旧版样式护栏，并将 `design-language.md` 重写为 OneGUI 手册。
6. ⏳ 整体验收：`pnpm guard` 全部通过、typecheck 无误，并完成画廊矩阵截图与真机走查（覆盖亮/暗/皮肤/密度/手机）。

## 5. 验收证据

| 图 | 说明 |
|---|---|
| ![neutral-light](./shots/gallery-neutral-light.png) | 基准皮肤 · 亮色 · 舒适密度 |
| ![glass-dark](./shots/gallery-glass-dark.png) | 玻璃皮肤（rich 档）· 暗色 · 触屏密度 |
