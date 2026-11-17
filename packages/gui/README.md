# @onethu/gui —— OneGUI

**One GUI to rule them all.** OneTHU 的**唯一** UI 来源：令牌、风格管线、组件、页面模式与质量护栏。

正如 `@onethu/core` 收拢校园客户端、`@onethu/sdk` 收拢独立服务运行时（详见[系统架构](../../docs/architecture.md)），`@onethu/gui` 在**视觉外观**层承担同样的统一职责：任何宿主界面都从同一条风格管线获取样式。

```
令牌（唯一色值落地处）
   └─ 风格管线 StyleDirector（六轴：皮肤/明暗/密度/动效/强调色/平台）
        └─ 组件（只声明意图：tone / level / size / emphasis）
             └─ 页面模式（PageScaffold / SettingsList / DataList / NavShell …）
                  └─ 应用代码：零样式
```

## 铁律

1. 应用代码专注结构与交互逻辑，所有颜色、间距、圆角、字号、阴影与动效时长均由 `@onethu/gui` 统一供给，业务侧保持零自造 class、零硬编码视觉值与零 inline style。
2. 组件只接收**语义意图**（如 `tone`、`level`、`size`、`emphasis`）。遇到特殊视觉需求时，通过新增组件枚举变体或在风格管线中注册专用 scope 来承载。
3. 每套皮肤都是**同一组语义令牌上的不同取值映射**，切换皮肤时组件代码零改动。
4. 组件内部统一引用 `--og-*` 语义令牌；底层 `--og-ref-*` 参考色值仅供 `tokens/semantic.css` 消费。

## 用法

```tsx
import "@onethu/gui/gui.css";                       // 一次性引入（在应用入口）
import { OneGUIProvider, Btn, Card, Row, SettingsList } from "@onethu/gui";

<OneGUIProvider theme={{ accent: "#90399c" }} scheme="auto" skin="neutral">
  <Card level={1} interactive>
    <Row title="校园卡余额" meta="¥ 42.00" onClick={…} />
  </Card>
</OneGUIProvider>
```

## 目录

| 路径 | 内容 |
|---|---|
| `src/tokens/` | 参考层 + 语义层 + 结构层（间距/圆角/字阶/尺寸/阴影/动效/层级） |
| `src/pipeline/` | `director.ts`（六轴解析与落盘）、`color.ts`（取色/混色/对比度）、`react.tsx`（Provider/Hooks/Scope） |
| `src/skins/` | `neutral`（默认基准）、`glass`（玻璃皮肤，收编旧玻璃体系） |
| `src/components/` | 原子与复合组件 |
| `src/patterns/` | 页面模式 |
| `gallery/` | 组件画廊（组件 × 皮肤 × 明暗 × 密度的验收矩阵） |

设计总纲见 `docs/onegui/00-plan.md`，组件目录见 `docs/onegui/03-catalog.md`。

## exp 视觉体系（2026-10-17）

全包字面色值统一收敛在 `src/tokens/reference.css` 一处，由语义角色、结构刻度、材质公式、组件与宿主配方逐层消费。运行 `pnpm guard:onegui` 会自动校验调色板单源约束、scope 边界、主题往返一致性与语义对比度。

主操作按钮读取 `--og-action / --og-action-on`，与主题强调色 `--og-accent-*` 解耦：默认外观下主操作随明暗模式在黑白之间翻转，主题色专用于强调标识；玻璃皮肤的四档强度仅调节背景材质透明度，输入与设置区域始终保持实色底面以保证可读性。

OneTHU 宿主在引入 `gui.css` 后继续加载 `@onethu/gui/onethu.css`，由该文件统一承载兼容别名与壳层配方，应用层仅保留布局与交互行为。其中 `og-device-*` 为该配方公开的开发取景框槽位，直接复用即可。

详细角色定义、验收标准与迁移进展见 `docs/onegui/20-exp-system.md`。
