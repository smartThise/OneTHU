# 日程底栏遮挡与列表滚动验收


> 归档说明：本文记录当时的布局修复与阶段性验收情况；0.11 当前功能与使用指南请查阅 [文档入口](../../README.md)（[English overview](../../en/index.md)）。


2026-10-20，`tools/schedule-layout-browser-test.mjs` 完整跑通并自然退出 `0`：**313 项通过、60 份实际几何与命中采样、24 张截图、0 个浏览器运行错误**。本目录归档汇总 `report.json` 与三张关键对比截图；测试生成的全套原始截图保存在 `/tmp/onethu-schedule-layout-final-complete/`。

## 复现与修复效果

旧版 CSS 下，在 1280×600 视口的极简模式中，23:59 截止的作业卡片虽已渲染（纵向范围 `y=542.96–596.66`，中心坐标 `(305.73, 569.81)`），但可见日程工作区实际高度仅为 `539.97px`；尽管卡片中心仍在滚动容器的裁切范围内，`document.elementFromPoint` 实际命中的却是底部的 `ohx-slot` 栏，证实底部 OH 栏遮挡了日程底部内容。早期首轮脚本虽在课程标题计数断言处提前中止，但此前已完整采集上述几何与命中数据；最终版脚本已改为按课程标题精确匹配。

修复后，同一视口与模式下该作业卡片的纵向范围上移至 `y=489.94–536.58`，日程工作区裁切下边界定格在 `540px`，稳妥停在底部 OH 栏上方。此时作业中心点直接命中卡片自身，通过真实坐标点击即可准确展开 23:59 截止详情。在包含同日 20 条未交作业的长列表中滚动到底部后，第 20 项完整落入可见裁切区且中心命中自身，点击或触摸均可正常打开带「前往」入口的详情面板。

- `chromium-1280-simple-timeline-before.png`：修复前底部 OH 栏遮住晚间作业。
- `chromium-1280-simple-timeline-after.png`：修复后晚间作业完整露出并可点击。
- `webkit-390-practical-agenda-end.png`：修复后实用模式长列表末项可正常滚动触达。

## 覆盖范围与输入方式

测试矩阵覆盖 Chromium、WebKit × 1280×600、390×844 × 完整、极简、实用三种模式，每个组合均独立冷启动验证。测试样例包含周二 08:00–09:35 的课程与同日 23:59 的未交作业，列表视图则加载同日 20 条未交作业；同时覆盖从日程页切回首页再返回，以及「极简 → 实用 → 极简」连续模式切换。

几何测量直接读取当前可见的 `.schedule-workspace`，逐层折算祖先容器的滚动与裁切边界，并通过 `document.elementFromPoint` 核验中心点真实命中。晚间作业与列表末项均在几何校验通过后执行真实坐标点击或触摸操作，全程还原用户实际交互（零调用元素自动滚入视口、零手动改写 `scrollTop`、零合成 DOM `dispatchEvent`）。页面导航与测试数据注入均调用生产状态接口，仅将上游数据拉取方法替换为本地静态样例，离线独立运行。

Chromium 390 视口采用手机尺寸并配合 CDP 可信触摸事件完成滑动与点击。由于 Playwright 的移动版 WebKit 暂未提供滚轮与触摸滑动支持，WebKit 390 视口采用开启 `hasTouch=true` 的窄视口配合桌面后端真实滚轮与原生触摸点击，并由脚本确认生产环境的 `is-phone` 移动端响应式布局已生效；该组合用于验证 WebKit 引擎下的手机端响应式布局表现，iOS 原生 `WKWebView` 与实体手机触控体验可在真机上另行验证。

## 重跑

```sh
ONETHU_TEST_OUT=/tmp/onethu-schedule-layout-final-complete \
  node tools/schedule-layout-browser-test.mjs
```

可通过环境变量 `SCHEDULE_LAYOUT_ENGINES`、`SCHEDULE_LAYOUT_MODES`、`SCHEDULE_LAYOUT_WIDTHS` 按需缩小执行矩阵；若传入空值或未定义的选项，脚本会直接报错退出，防止空跑误报通过。

最终 `schedule.css` SHA-256：`4532a4a89b86ae4199c93cff1ed9fbd4c686917c1299c6e09f679b1ae19ee63b`。
