# OneGUI 视觉与交互架构


中文 · [English](../en/architecture/onegui.md) · [系统总览](../architecture.md)

## 代码与契约

OneGUI 位于 `packages/gui`，集中提供设计令牌、基础样式、通用 React 组件与动态风格管线。应用启动时先由 `gui.css` 按层次导入核心样式表，宿主接着加载 `onethu.css` 中的兼容别名与应用配方。目前 `packages/ui` 仍保留着部分早期令牌入口以兼容存量页面，新组件开发与存量页面迁移均统一对齐 OneGUI 语义体系。

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

`StyleDirector` 负责统一解析 `skin`、`scheme`、`density`、`motion`、`platform` 与 `theme` 六个视觉维度，并用 `skinLevel` 表达材质档位。解析后的偏好落到文档根节点属性和对应的 CSS 变量上，React 组件通过订阅 hooks 获取当前轴快照。平台特征由宿主在初始化时注入，各组件按统一的语义令牌消费结果。

| 维度 | 作用 |
| --- | --- |
| theme / accent | 主题角色、字体、曲率与强调色族 |
| scheme | 明亮、深色或跟随系统 |
| skin / skinLevel | 中性、玻璃及相应材料档位 |
| density | compact / comfortable / touch 的尺寸语义 |
| motion | full / reduced |
| platform | 桌面与移动交互适配 |

系统默认外观预设为“石墨”，而主题预设、背景壁纸、强调色与表面材质均可自由搭配组合。切换主题时，管线会先整体卸载上一套主题角色再注入新角色，防止新旧内容色与选中态变量混杂残留。

局部区域需要定制视觉层次时，可通过 `defineScope` 注册受控的语义覆盖（作用域仅接受白名单内的令牌族与枚举值）。动态几何尺寸通过布局容器与组件参数表达，整个应用的色彩和材质计算全部收敛在统一管线内。

源码：[director.ts](../../packages/gui/src/pipeline/director.ts)、[react.tsx](../../packages/gui/src/pipeline/react.tsx)、[oneguiBridge.ts](../../apps/desktop/src/lib/oneguiBridge.ts)。

## 动作、选中与文字对比

主操作按钮使用的 `--og-action / --og-action-on` 与全局主题强调色相互独立；选择、悬停、按压、禁用与键盘焦点环各自消费统一的语义角色，确保按钮内的文字、图标、loading 指示器与可点击热区在深浅色主题下都清晰可辨。

色彩管线内置了取色、多层叠色与对比度计算能力，应用启动时还会挂载基于真实背景栈的文字对比度自适应处理。当壁纸、遮罩纱层、卡片表面与毛玻璃叠加在一起时，管线会综合评估最终合成底色，在主题切换、图片背景变化与动态材质启用时实时保障正文与业务语义色的可读性。

源码：[color.ts](../../packages/gui/src/pipeline/color.ts)、[应用入口](../../apps/desktop/src/main.tsx)。

## 玻璃与折射

材质角色统一调控面板的不透明度、模糊半径、高光边缘与表面层次。导航壳层、悬浮胶囊和临时浮层适度透出底层背景以保留空间上下文；而表单输入框和需要持续阅读的设置列表则采用稳重的实色表面。开启降低透明度或禁用折射效果后，所有界面元素会自动回退为稳定表面，完整保留功能与文字可读性。

宿主在调用 `installOneGUI` 时显式注册允许启用折射的结构选择器；折射引擎根据元素可见性、渲染面积、设备性能与 WebView 能力动态控制开销预算，超出预算时自动回退为标准模糊材质。底层的 DOM 与图像采样刷新严格跟随组件生命周期启停，而视图遮挡关系与点击事件层级则交由标准布局与 z-index 体系管理。

源码：[refraction.ts](../../packages/gui/src/pipeline/refraction.ts)、[glass.css](../../packages/gui/src/skins/glass.css)。

## 页面壳、浮层与滚动

统一的页面内容边界提供一致的 padding、视口可用高度与主滚动区。无论从侧边标签路由、白板组件入口、全局搜索结果还是智能体工具打开同一业务页面，都会挂载在相同的内容壳内。模态浮层、选择抽屉、OH 面板、暂存按钮与固定快捷入口均按统一规范登记层级及设备安全区。

每个滚动容器都明确声明自身的高度约束与 `overflow` 策略：底部固定 OneShot 栏与系统底栏所需的避让空间由外层壳统一预留，确保列表和抽屉内部能顺畅滚动到最后一项。分段条（Segment）超出容器宽度时会提供可操作的横向滚动指示，并同时通过文字字重与滑块表面强化当前选中态。

运行平台类型、触屏硬件能力与视口宽度作为三个独立维度分别检测。例如平板横屏时既可展开宽屏多栏布局，又继续沿用触屏端的编辑交互规则——白板组件的位置拖动依然受触屏编辑开关保护，不会仅因视口变宽而误触移动。源码：[platform.ts](../../apps/desktop/src/state/platform.ts)、[FreeBoard.tsx](../../apps/desktop/src/components/FreeBoard.tsx)。

## 拖动与编辑

拖拽手势按“按下 → 越过位移阈值 / 长按提起 → 跟手移动 → 命中候选目标 → 松手提交”的状态机流转。单次手势最多只产生一次有效提交；若中途取消，或拖拽内容已被目标容器成功接收，原组件自身的几何位移便会自动撤回。暂存浮钮的位置拖动与内容投放采用两套独立状态管理，轻点展开面板保持即时响应。

在手机端，白板仅在显式开启编辑模式后才允许改变卡片位置或大小，日常浏览模式下完整保留阅读与页面滚动体验。跟手移动期间仅更新临时的视觉 `transform`，松手落定后才一次性写入持久化文档，大幅减少高频存储写入；撤销操作面向用户的历史编辑步骤，恢复出厂默认排版则通过独立的重置操作触发。

源码：[白板模型](../../apps/desktop/src/state/boardCore.ts)、[编辑状态](../../apps/desktop/src/state/boardEdit.ts)、[浮钮拖动](../../apps/desktop/src/components/useFloatingButtonDrag.ts)、[暂存投放](../../apps/desktop/src/components/vault/vaultDrag.ts)。

## 国际化、导览与动态效果

界面文案在展示时根据当前 locale 从应用词典动态解析；内部错误对象保留可本地化的错误标识或上游原始 reason，以便展示层准确呈现。学校课程正文、师生人名与校方服务消息保持原始语言展示，客户端自产引导与说明文字则走多语言词典；其中 OneGUI 内置的 locale 适配负责通用公共控件语义，业务页面文案继续由应用词典统一维护。

上手导览将体验模式说明、布局偏好选择与基于脱敏模拟数据采集的真实应用画面融为一体，中英文配图随当前界面语言自动切换，公开素材中均使用干净的模拟演示数据。导览内的视频与帧动画调度在手动暂停、滚出视口、切入系统后台或开启 `reduced motion` 时会自动停止或静态降级。

## 验证与扩展

自动化守卫（`guard:onegui` 及令牌、对比度、样式与尺寸检查脚本）负责在源码层校验结构契约；真实浏览器与多端 WebView 验收则逐项核对点击热区、焦点流转、触底滚动、横竖屏切换、页面缩放与动态效果，静态代码检查与真机渲染表现互为补充。

新增通用组件时，先明确语义角色、尺寸变体、交互状态与无障碍行为，再沉淀进组件层或宿主配方；具体的校园业务服务与校内标识继续留在上层应用代码中。详细迁移规范与历史设计决策见 [OneGUI 设计语言](../design-language.md)、[历史组件契约](../onegui/10-contract.md) 和 [令牌入口](../tokens-map.md)。
