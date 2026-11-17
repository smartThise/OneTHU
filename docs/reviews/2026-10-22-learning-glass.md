# 学习 / 作业玻璃材质一致性修复


日期：2026-10-22。目标版本：0.11.1 渠道替换。

## 用户表现与根因

横屏平板的待办与学习区域此前出现了三种割裂的材质表现：课程原生 `select` 与未读通知条显示为不透明实色，作业轮播卡片薄如透明胶片，右侧分栏的作业标题则直接裸露在复杂壁纸上；而外围壳层与部分详情卡片的磨砂玻璃效果依然正常。

排查定位到四处具体原因：

1. `global.css` 中的 `.hw-filter-select` 沿用了旧版 MD 实色变量；`.notice-strip.has-unread` 的选择器优先级高于通用玻璃材质规则，保留了实色 `--accent-soft`。
2. `.hw-carousel` 父容器上的 `mask-image` 创建了独立的 backdrop root，导致内部子卡片即便计算样式带有 `blur(22px)`，也无法采样到容器外部的壁纸；非中心卡片整组设置的 `opacity` 同样会阻断背景模糊合成。
3. `Layout.PageHead` 本身是透明排版容器，迁移至 OneGUI 后外层多了一级无类名 wrapper，导致旧的 `.page-head` 选择器未能命中新的 `.og-pagehead`。
4. “透彻”档玻璃在深色模式下的常规 surface 填充率仅为 6%，阅读型卡片叠在纹理复杂的壁纸上时对局部采样波动更为敏感；旧样式 `.hw-card-ddl-sub { opacity: .75 }` 又进一步压低了自动对比引擎选出的文字明度。

## 修复范围与实现

样式改动统一收敛在 `packages/gui/src/recipes/learn.css`，直接复用 OneGUI 现有材质令牌：课程筛选框、未读通知条、学习分栏标题以及独立与内嵌作业页头统一接入 `--og-fill-overlay`、`--og-overlay-blur`、`--og-line-2` 与 `--og-material-shadow`；`Layout.PageHead` 的外层 wrapper 补充 `page-head-host` 类名作为稳定的宿主挂载点。

作业卡片作为高频阅读表面，同步切换为 overlay 填充角色（透彻档填充率为 60%，其余档位继续随材质配置动态响应）。卡片正文与小号截止说明文字统一采用 `--og-content-1`，移除小字上叠加的额外透明度衰减；大号截止倒计时保留语义状态色，同时继续支持自动对比引擎根据壁纸明暗动态覆盖字色。

在玻璃模式下，作业轮播移除了父容器的 `mask-image`：逐张卡片的位移与缩放沿用原有几何算法，整卡透明度下移至卡片内部的内容子层；`HomeworkCarousel.tsx` 根据现有的 `geo.h`、步距、位移和缩放比例直接推算每张卡片相对于舞台上下边缘的位置，让卡片通过自身的 `mask-image` 在 `--og-space-8` 距离内柔和渐隐。这样既消除了父级遮罩对背景采样的隔断，让中心卡片获得完整通透的壁纸磨砂，又保留了两侧卡片滑出舞台时的自然消隐过渡。

整个方案保持轻量，无需引入全局 backdrop 扫描、逐帧 DOM 测量或全屏滤镜，轮播列表依旧只挂载当前可见窗口内的卡片。原生 `option` 弹出菜单保留高可读性的实色前景与背景配对，常规表单控件与白板内嵌卡片维持原有材质策略；“无玻璃”档位继续使用父级边缘渐隐，开启系统“降低透明度”辅助功能时也会自动切换为无模糊的实色回退样式。

## 实际验证

`tools/learning-glass-browser-test.mjs` 在独立 Chromium 上下文中运行真实的 React / OneGUI 页面，配合虚构课程与作业数据，以及程序生成的亮暗双色渐变细格纹测试壁纸；外部 HTTP 与 WebSocket 请求全程阻断，不接触真实账户与个人壁纸。测试视口覆盖 1617 × 1073 横屏平板与 390 × 844 竖屏手机。

34 项浏览器自动化检查全部通过，涵盖四组亮暗材质与布局组合、真实壁纸模糊采样、无父级 mask/filter/opacity 合成隔离、玻璃强度档位切换、降低透明度回退、无玻璃档位回退、真实 CDP 触摸翻卡、课程筛选、手机详情页跳转及零运行时异常。固定日期夹具在模拟触摸滑动时会随每个指针事件递增时间戳，使翻卡惯性速度计算还原真实手势节奏。

实测截图与数据归档于 `/tmp/onethu-learning-glass/`：

- `tablet-light.png`、`tablet-dark.png`：横屏平板双栏布局与舞台边缘渐隐效果。
- `phone-light.png`、`phone-dark.png`、`phone-detail-dark.png`：手机端阅读列表与作业详情页。
- `card-blur.png`、`card-old-mask.png`、`card-own-mask.png`：同一中心卡片在修复后、还原旧版父级 mask 与启用自身 mask 三种状态下的直观对照。
- `report.json`：浏览器断言结果及各文字节点的计算颜色、不透明度、坐标与对比引擎探测数据。
- `pixel-proof.json`：实际屏幕背景像素与合成前景字色的有效对比度，以及磨砂模糊像素统计对照。

`tools/learning-glass-pixels-test.py` 直接读取截图，取每处文字标签正上方三个采样点的背景像素中位数，结合计算样式的前景字色与 alpha 合成有效对比度（正文字号要求达到 4.5:1，21px / 800 字重的大号截止数字与图标按钮要求达到 3:1），同时对比卡片无文字区域的高频像素标准差，从真实渲染像素层面验证壁纸磨砂已生效。

最终 20 项有效像素对比度检查与 2 项磨砂模糊对照全部通过：中心卡片课程名、作业标题与小号截止说明的实测对比度达 **7.46–8.65:1**；大号截止数字最低为 **4.23:1**，图标按钮最低为 **4.16:1**。同一块无文字采样区域的灰度标准差从旧版父级 mask 下的 **4.663** 降至修复后的 **0.659**，相邻像素高频梯度从 **0.4274** 降至 **0.0467**，卡片自身 mask 与无遮罩中心卡的模糊度完全一致。

CSS 语法结构、OneGUI 单源规范、对比度引擎护栏、桌面端 TypeScript 类型检查与 `git diff --check` 全部通过。

复验命令：

```sh
node --import /Volumes/OneTHUBuild/artifacts/mobile-round3-register.mjs tools/learning-glass-browser-test.mjs
python3 tools/learning-glass-pixels-test.py
node tools/css-parse-test.mjs
node tools/onegui-guard.mjs
node tools/contrast-guard.mjs
pnpm --filter @onethu/desktop typecheck
git diff --check
```

运行浏览器脚本需具备 Playwright 与 Chromium（上方 `--import` 指向本机工作区的模块解析脚本），像素分析脚本需安装 Pillow；应用生产代码未引入任何新增运行依赖。

## 后续实机观察项

本轮验收基于桌面 Chromium 的宽屏触摸模拟与程序合成的亮暗格纹壁纸完成；不同 Android 硬件的 GPU / WebView 合成表现、长时间播放动态视频壁纸时的帧率表现，以及更多自定义摄影壁纸下的阅读观感，可在装机升级后持续结合日常使用跟进。全局自动对比引擎对动态视频壁纸的低频采样与定格策略保持不变；测试使用的虚构课程数据完全通过隔离浏览器的网络路由夹具提供，应用源码保持干净。
