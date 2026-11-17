# OneGUI · 从零重建统一 UI 体系（总纲）


> 归档说明：本文记录当时的重构总纲与迁移计划；0.11 当前功能与使用说明请查阅 [文档入口](../README.md)（[English overview](../en/index.md)）。


> 2026-10-14 立项。用户定案：**整套 UI 完全重写**；**全新中性基准**，玻璃降为 OneGUI 内的一档皮肤（skin）；
> 一步到位单轨推进。数据层已由 OneTHU SDK（`@onethu/core`）统一，本工程把**样式层**统一到同一种治理方式。
> **UX 保持一致**：交互、键盘、拖拽、长按、滚动、退场相位维持既有体验，本次升级专注重构视觉表达层。
> 组件目录与迁移台账见 [03-catalog.md](./03-catalog.md)，组件契约见 [10-contract.md](./10-contract.md)。

## 0. 铁律

1. **唯一来源**：全部形状、颜色、间距、字阶、动效、层级只来自 `@onethu/gui`。
   应用层代码不再自定颜色值、间距、圆角、字号或裸控件。
2. **意图优先**：组件只接收语义**意图**（`tone` / `level` / `size` / `emphasis` / `density`），告别直接传样式参数。
   页面级局部定制统一走**管线通道**（scope），杜绝就地手写样式。
3. **单一调度**：皮肤、明暗、密度、动效、强调色、平台六个轴由 `StyleDirector` 一处解析、一处落盘。
   组件与页面直接**读取**语义令牌，色彩推演全部交由管线完成。
4. **一个风格指挥**：每套皮肤都是对**同一组语义令牌**的一组取值映射，无需另起一套 CSS；切换皮肤时组件代码零改动。
5. **护栏即契约**：`tools/onegui-guard.mjs` 是唯一风格裁判（`pnpm guard:onegui`）。换血完成后，
   原先分散的 40+ 项风格护栏全部收拢进组件库与新护栏中统一接管。
6. **行为稳定**：只重写 UI 表达层；`state/`、`lib/`、`plugins/`、`im/`、`memory/`、`@onethu/core`
   的数据流保持原貌（仅清理其中的 UI 旁路代码）。

## 1. 分层

```
packages/gui/                      @onethu/gui —— 唯一 UI 库
  src/tokens/        ① 参考层 + 语义层 + 结构层（唯一色值/尺寸落地处）
  src/pipeline/      ② 风格管线：六轴解析、落盘、scope 通道、订阅（无 React 依赖：director.ts / color.ts）
  src/components/    ③ 组件：kit(基类) / layout / text / surface / button / list / chip / icons /
                        form / overlay / patterns / display / exit(浮层相位)
  src/skins/         ④ 皮肤：neutral（基准）、glass（收编旧玻璃四档）
  src/index.ts       ⑤ 公开 API（唯一 import 面）
  src/gui.css        ⑥ 单一入口样式表（应用只引这一份）
apps/desktop/src/                 只允许消费 OneGUI：零 class、零内联样式、零裸控件
tools/onegui-guard.mjs            唯一风格护栏（六条规则 + 基线棘轮）
docs/onegui/                      本目录：总纲 / 契约 / 目录与台账 / 侦察报告
```

三层令牌：`--og-ref-*`（只有语义层能用）→ `--og-{surface,content,line,accent,status,space,radius,font,size,elev,motion,z}-*`
（组件与模式唯一可用）→ `--og-c-*`（组件私有，页面只能通过 scope 覆盖）。

## 2. 六轴

| 轴 | 取值 | 落盘 |
|---|---|---|
| skin | `neutral`（默认）/ `glass` / 第三方皮肤 | `data-og-skin` |
| skinLevel | `clear` / `base` / `rich` / `deep` | `data-og-skin-level` |
| scheme | `auto` / `light` / `dark` | `data-og-scheme` |
| density | `comfortable` / `compact` / `touch` | `data-og-density` |
| motion | `full` / `reduced` | `data-og-motion` |
| platform | `desktop` / `mobile` | `data-og-platform` |
| accent | 主题对象（一个色）→ 管线算出 soft/line/strong/on/quiet/ring | 内联 `--og-accent*` |

## 3. 特殊需求接入路径（统一出口）

1. 通用变体？→ 给组件补充枚举 prop。
2. 某页特有？→ `director.defineScope("cloud.fileCard", { "surface-1": "surface-2", radius: "lg" })`，组件声明 `scope="cloud.fileCard"`。
3. 新皮肤（玻璃、插件主题）？→ 通过 `registerSkin()` 为同一组语义令牌注册新一套取值。
4. 页面层告别手写局部 CSS、内联色值与自造 class，所有定制均收敛于以上三条通道。

## 4. 迁移与删除清单（换血顺序 = 提交顺序）

1. ✅ `packages/gui` 立项：令牌 + 管线 + 全部组件族 + 画廊 + 护栏（提交 A…）。
   待收台账：660 处内联样式 / 675 处字面色 / 1143 处裸控件（见 03-catalog §3）。
2. ⏳ 壳层换血：`Layout` / `explorer/*`（顶栏、竖栏、标签条、抽屉、设置浮层）。
3. ⏳ 攻坚面：清华云盘（`cloud-*`）、网络学堂（作业/通知/富文本壳）、设置页 + 全部弹层。
4. ⏳ 全量收尾：其余页面逐个迁移，**迁一页删一页旧 CSS**。
5. ⏳ 清场：删 `apps/desktop/src/styles/*`（13k 行）、删 `packages/ui`、旧风格护栏由 `onegui-guard` 取代、
   `design-language.md` 重写为 OneGUI 手册。
6. ⏳ 验收：`pnpm guard` 全绿 + `pnpm typecheck` + 画廊矩阵截图 + 真机走查（亮/暗/皮肤/密度/手机）。

## 5. 验收与证据

- **画廊矩阵**：`?onegui-gallery=1`（可叠 `&skin=glass&level=rich&scheme=dark&density=touch`），
  headless Chrome 截图存档在 `docs/onegui/shots/`。
- **像素证据**：采集真机或桌面窗口截图前须先校验窗口归属（确认窗口 owner 为 OneTHU，避免误截其他应用窗口）。
- **护栏**：应用零旁路样式、库内零字面色值/尺寸、令牌引用全部有定义、画廊登记全覆盖。

## 6. 提交规范

`feat(onegui): …` / `refactor(onegui): <页面> 迁到 OneGUI` / `chore(onegui): 删除 <旧 CSS>`。
每一步都提交（AGENTS.md 铁律），不攒工作区。迁移期间应用允许短暂不可用，但 `typecheck` 必须能过。
