# @onethu/gui —— OneGUI

**One GUI to rule them all.** OneTHU 的**唯一** UI 来源：令牌、风格管线、组件、页面模式、护栏。

校园客户端位于 `@onethu/core`，独立服务运行时位于 `@onethu/sdk`；宿主通过账号、传输与服务适配接入。详见[系统架构](../../docs/architecture.md)与[OneGUI 架构](../../docs/architecture/onegui.md)。
这个包做同一件事，只是对象换成**外观**：任何界面都从同一条风格管线取样式。

```
令牌（唯一色值落地处）
   └─ 风格管线 StyleDirector（六轴：皮肤/明暗/密度/动效/强调色/平台）
        └─ 组件（只声明意图：tone / level / size / emphasis）
             └─ 页面模式（PageScaffold / SettingsList / DataList / NavShell …）
                  └─ 应用代码：零样式
```

## 铁律

1. 应用代码里**不允许**出现颜色、间距、圆角、字号、阴影、动效时长、自造 class、inline style 样式。
2. 组件只接受**意图**，不接受样式。任何"这次特殊"要么变成组件枚举变体，要么在管线里注册 scope。
3. 皮肤不是另一套 CSS，而是**同一组语义令牌的另一种取值**；换皮肤组件零改动。
4. 组件内只允许引用 `--og-*` 语义令牌；`--og-ref-*` 只有 `tokens/semantic.css` 能用。

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

参考色值只有 `src/tokens/reference.css` 一处。语义角色、结构刻度、材质公式、组件和宿主配方逐层消费，任何层不得再定义字面颜色。`pnpm guard:onegui` 包含调色板单源、scope、主题往返与语义对比度验证。

主操作读取 `--og-action / --og-action-on`，与主题强调色 `--og-accent-*` 分离。默认外观跟随明暗反转黑白动作；主题只改变强调标识。玻璃的四档仅改变材质透明度，输入与设置保持实面。

OneTHU 宿主在 `gui.css` 后导入 `@onethu/gui/onethu.css`。该文件拥有兼容别名与壳层配方，应用只保留布局和行为。`og-device-*` 是该配方公开的开发取景框槽位，不允许应用另写同名样式。

详细角色、验收和迁移余量见 `docs/onegui/20-exp-system.md`。
