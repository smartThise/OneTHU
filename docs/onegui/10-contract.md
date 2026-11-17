# OneGUI · 组件契约


> 归档说明：本文记录当时的 OneGUI 组件契约与护栏准则；0.11 当前功能与使用说明请查阅 [文档入口](../README.md)（[English overview](../en/index.md)）。


> 面向新增组件与页面迁移的开发约定，同时作为自动化护栏的校验依据：`tools/onegui-guard.mjs` 按本文规则执行检查，`docs/onegui/03-catalog.md` 按本文标准维护目录。

# 1. 组件怎么写（库内）

1. 每个组件对应一个源码文件（`src/components/<name>.tsx`）及可选的配套样式文件（`src/styles/<name>.css`）。
2. 组件类名统一通过基类构建器生成：
   ```tsx
   import { one, cx, scopeProps, type OneBase } from "./kit.js";
   const cls = one("btn").variant(variant).size(size).tone(tone).state("loading", loading).toString();
   ```
   组件内部避免手写 `className="xxx yyy"` 字符串拼装或内联样式。
3. 组件 CSS 仅引用 `tokens/semantic.css` 与 `tokens/structure.css` 中定义的 `--og-*` 语义与结构令牌：
   - `--og-ref-*` 参考色仅供 `tokens/semantic.css` 内部映射使用；
   - 样式表中避免直接书写 `#fff`、`rgba(...)` 等字面色值或 `12px` 等字面像素值（`0`、`1px` 细描边、百分比，以及 `styles/base.css` 中带注释说明的滚动条与选中态等浏览器伪元素细节除外）。
4. 组件私有令牌以 `--og-c-<component>-*` 命名（例如 `--og-c-card-pad`），默认值指向结构层令牌：`--og-c-card-pad: var(--og-card-pad);`。页面可通过 `scope` 将 `--og-c-*` 映射到其他语义令牌，保持令牌链完整而不直接写入字面值。
5. 交互态统一复用共享状态层：`.og-interactive::after { background: var(--og-hover) }`，按下态切换为 `--og-press`，选中态使用 `--og-selected`，各组件无需单独维护 hover 色值。
6. 焦点环统一使用 `var(--og-ring)`；禁用态透明度统一使用 `--og-disabled-opacity`。
7. 动效时长与缓动统一取自 `--og-dur-*` / `--og-ease-*`；动画属性限定在 `transform`、`opacity`、`background-color` 与 `border-color`。
8. 组件统一接收 `scope?: string` 并挂载至最外层节点（`{...scopeProps(scope)}`）。
9. **对外屏蔽 `style` 属性**：组件接口省略 `style` 透传。涉及拖拽位置、进度条宽度、白板坐标等动态几何量时，改为提供语义化的受控属性（如 `value`/`offset`），在组件内部通过 CSS 变量或 `transform` 渲染，并附上 `data-og-dynamic` 标记。

# 2. 类名约定（库内）

- 基类：`og-<component>`（`og-btn`、`og-card`、`og-row`）
- 变体：`og-<component>--<variant>`（`og-btn--solid`、`og-card--flat`）
- 尺寸：`og-<component>--sm|lg`（默认档 `md` 直接使用基类）
- 色调：`og-<component>--t-brand|error|…`（默认档 `default` 直接使用基类）
- 状态：`is-<state>`（`is-loading`、`is-selected`、`is-open`、`is-disabled`）
- 子元素：`og-<component>-<part>`（`og-row-title`、`og-card-head`）
- `og-` 前缀类名归 `packages/gui` 内部专有；应用侧直接调用导出的 React 组件，护栏会拦截业务代码手写的 `og-` 前缀类名。

# 3. 页面怎么迁（应用侧）

| 现在 | 换成 |
|---|---|
| `<div className="card">…` | `<Card>…</Card>` |
| `<div className="row row-click">…` | `<Row title={…} sub={…} onClick={…} />` |
| `<button className="btn btn-primary">` | `<Btn variant="solid" tone="brand">` |
| `<input className="field">` | `<Input />` / `<SearchField />` |
| `<span className="chip chip-blue">` | `<Chip tone="info">` |
| 一页里的 `<div className="section-head">` | `<Section title=… />` |
| `style={{ color: … }}` | 移除内联色值，交由组件语义属性与样式管线决定 |
| 页面私有 CSS 文件 | 移除私有样式表；局部定制改用 `defineScope()` + `scope="…"` |

迁移基本准则：
1. **保持交互体验一致**：事件处理、键盘操作、快捷键、长按、拖拽、双击、`aria` 无障碍属性及滚动行为均维持原有表现，迁移只替换视觉表达层。
2. 单页迁移完成后同步清理该页在 `global.css` 与 `explorer*.css` 中的旧样式块，保持代码库单轨演进。
3. 除 `<a>` 链接与内容渲染白名单外，页面与业务组件内的原生 `<button>`、`<input>`、`<select>`、`<textarea>` 统一替换为对应的 OneGUI 控件。

# 4. 护栏（tools/onegui-guard.mjs）

| 规则 | 判定 |
|---|---|
| G1 应用零样式文件 | `apps/desktop/src/**/*.css` 必须不存在（内容渲染白名单除外） |
| G2 应用零字面样式 | TSX 里不允许 `style={{` 带 `color/background/border/font/padding/margin/box-shadow` |
| G3 应用零裸控件 | 页面/组件里不允许裸 `<button|input|select|textarea` |
| G4 库内零旁路 | `packages/gui/src/**` 里不允许字面色值/px（白名单：`tokens/*.css`、`styles/base.css` 注释豁免、`skins/*.css`） |
| G5 令牌引用存在 | CSS 里引用的 `--og-*` 必须有定义 |
| G6 组件目录 | `src/index.ts` 导出的组件必须各有一次画廊登记（gallery 矩阵覆盖） |

## exp 单源补充（2026-10-17）

- OneGUI 全部样式层（包括 semantic / structure / skins / recipes）的颜色字面值统一收敛至 `tokens/reference.css`，由规则 R9 自动检查。
- 主要操作使用 `action` 角色，用户主题色作用于 `accent` 角色，两条通道职责独立、互不覆盖。
- 当 `scope` 将同名角色映射到自身时，直接跳过声明生成并继承根级值，避免形成 CSS 变量自引用。
- `recipes/onethu.css` 作为组件库提供的宿主适配层，向应用开放公开槽位类（例如设备取景框）；外观样式统一在库内维护，应用侧直接挂载类名即可。
- G1 / G2 / G3 的全量清零仍是迁移终态目标；过渡期内 R2 / R3 / R4 / R7 / R8 采用棘轮基线管理，防止违规项新增并随迭代逐步向下收紧存量。

### Workbench 产品构图（2026-10-17 第二轮）

`recipes/onethu.css` 作为宿主唯一入口，按顺序引入存量兼容映射（`compatibility.css`）与 Workbench 产品构图。`compatibility.css` 服务于尚未迁移的存量代码，新页面直接采用 OneGUI 组件与公共语义角色；产品布局尺寸统一归入 `tokens/structure.css`，基础参考色继续集中在 `tokens/reference.css`。

交互型 Chip 底层使用原生按钮渲染；包含移除操作时，主体按钮与移除按钮同级并列，避免按钮嵌套。首页的服务管理、功能目录和透明度选择统一复用组件库 Modal。首页页头与服务区处于常规文档流，自由画布自身的坐标、缩放与本地存储继续作为画布卡片的唯一数据源。
