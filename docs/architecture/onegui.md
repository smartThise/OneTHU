# OneGUI 视觉与交互架构

中文 · [English](../en/architecture/onegui.md) · [系统总览](../architecture.md)

## 代码与契约

OneGUI 位于 `packages/gui`，同时提供令牌、样式、React 组件与风格管线。`gui.css` 按层次导入基础样式，宿主接着加载 `onethu.css` 的兼容别名和应用配方。`packages/ui` 仍提供部分旧令牌入口；现有页面的迁移应以 OneGUI 语义为目标，兼容层实际存在。

```text
reference.css：参考色板
structure.css：间距、曲率、尺寸、字阶、层级、动效
semantic.css：表面、内容、线条、动作和语义角色
       ↓
StyleDirector：解析轴、主题与受控 scope
       ↓
skins + components + patterns
       ↓
onethu recipes + 应用布局/行为
```

源码：[样式入口](../../packages/gui/src/gui.css)、[导出组件](../../packages/gui/src/index.ts)、[宿主配方](../../packages/gui/src/recipes/onethu.css)。

## 风格管线

`StyleDirector` 统一解析 skin、scheme、density、motion、platform、theme，并用 skinLevel 表达材质档位。偏好落到根节点属性和对应 CSS 变量，React hooks 通过订阅获取轴快照。平台判定由宿主注入，组件按相同语义消费结果。

| 维度 | 作用 |
| --- | --- |
| theme / accent | 主题角色、字体、曲率与强调色族 |
| scheme | 明亮、深色或跟随系统 |
| skin / skinLevel | 中性、玻璃及相应材料档位 |
| density | compact / comfortable / touch 的尺寸语义 |
| motion | full / reduced |
| platform | 桌面与移动交互适配 |

石墨是默认预设名称。主题、壁纸、强调色和材质分别配置，默认名称不限制可选外观。切换主题需要整体移除旧角色并注入新角色，防止残留的内容色和选中态组合。

`defineScope` 注册受控的语义覆盖；作用域只接受允许的令牌族与枚举。动态几何通过布局/组件参数表达，页面不再自行定义第二套颜色和材料公式。

源码：[director.ts](../../packages/gui/src/pipeline/director.ts)、[react.tsx](../../packages/gui/src/pipeline/react.tsx)、[oneguiBridge.ts](../../apps/desktop/src/lib/oneguiBridge.ts)。

## 动作、选中与文字对比

主操作 `--og-action / --og-action-on` 与主题强调色分开；选择、悬停、按压、禁用与焦点环消费统一角色。按钮内容包括文字、图标、loading 和可点击区域，深浅主题均应保持可辨认。

颜色管线提供取色、叠色和对比计算；应用还安装基于背景栈的文字对比处理。壁纸、纱层、表面和玻璃叠加后共同影响文字。对比调整需要覆盖主题切换、图片背景与动态材质，同时保留业务语义色的可读性。

源码：[color.ts](../../packages/gui/src/pipeline/color.ts)、[应用入口](../../apps/desktop/src/main.tsx)。

## 玻璃与折射

材质角色控制透明度、模糊、边缘和表面层次。壳层、胶囊和浮层优先保留背景上下文；表单输入和需要持续阅读的设置内容保留稳定表面。降低透明度或禁用折射后，功能与文字仍可用。

宿主向 `installOneGUI` 注册允许折射的结构选择器；折射实现根据可见性、面积、设备与 WebView 能力控制预算，必要时退回模糊材质。其 DOM/图像采样与刷新受生命周期约束，玻璃本身不能承担遮挡和点击层级管理。

源码：[refraction.ts](../../packages/gui/src/pipeline/refraction.ts)、[glass.css](../../packages/gui/src/skins/glass.css)。

## 页面壳、浮层与滚动

页面内容边界统一提供 padding、可用高度和滚动区。标签路由、白板组件入口、搜索结果与工具打开同一页面时，使用相同内容壳。浮层、选择抽屉、OH、暂存按钮和固定快捷入口分别登记层级及安全区。

滚动容器明确自己的高度与 overflow。固定 OneShot 和系统底栏的空间归壳层处理，列表/抽屉内部可滚动到最后一项。Segment 超出宽度时保留可操作的横向指示；选中态同时通过内容与表面表达。

平台、触屏能力和视口宽度分别判断。平板横屏可使用宽布局，同时保留触屏编辑规则；宽度变化不自动授权白板拖动。源码：[platform.ts](../../apps/desktop/src/state/platform.ts)、[FreeBoard.tsx](../../apps/desktop/src/components/FreeBoard.tsx)。

## 拖动与编辑

手势分为按下、超过阈值、长按提起、移动、候选目标和最终提交。一次手势只能提交一次；取消或目标接收后撤销来源几何提交。暂存浮钮的位置拖动与内容投放使用各自的状态，点击反馈保持即时。

手机白板只有编辑模式才改变位置或大小，浏览模式保留阅读和页面滚动。临时 transform 与持久化文档分离，减少移动过程的存储写入；撤销恢复业务文档，默认模板恢复由明确操作触发。

源码：[白板模型](../../apps/desktop/src/state/boardCore.ts)、[编辑状态](../../apps/desktop/src/state/boardEdit.ts)、[浮钮拖动](../../apps/desktop/src/components/useFloatingButtonDrag.ts)、[暂存投放](../../apps/desktop/src/components/vault/vaultDrag.ts)。

## 国际化、导览与动态效果

应用词典在展示时根据 locale 解析；错误对象保留可本地化标识或外部 reason。学校课程正文、人名和服务消息按来源处理，应用自产说明使用词典。OneGUI 的 locale 适配负责公共控件语义，业务界面继续使用应用词典。

导览组合模式相关说明、布局选择和经过模拟数据采集的真实应用图像。中英文素材分别对应界面语言，公开素材不含真实账号数据。视频和帧调度在暂停、离屏、后台及 reduced motion 下停止或降级。

## 验证与扩展

`guard:onegui`、令牌/对比度/样式与尺寸守卫校验结构契约；浏览器验收核对点击、焦点、滚动、横竖屏、缩放和动态效果。源码检查与真实 WebView 行为分别记录。

新增组件先确定语义角色、变体、状态和交互，再进入组件层或宿主配方；业务服务与校园标识保持在应用层。迁移规范与历史决策见 [OneGUI 设计语言](../design-language.md)、[历史组件契约](../onegui/10-contract.md) 和 [令牌入口](../tokens-map.md)。
