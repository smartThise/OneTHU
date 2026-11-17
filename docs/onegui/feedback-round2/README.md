# 第二轮反馈验收


> 归档说明：本文记录当时的设计方案与阶段性验收情况；0.11 当前功能与使用指南请查阅 [文档入口](../../README.md)（[English overview](../../en/index.md)）。


对应实施方案：`docs/plans/2026-10-18-feedback-round2.md`。于 2026-10-19 完成前端实现与浏览器验收。

## 复跑

先启动桌面开发预览，再运行：

```bash
node tools/feedback-round2-browser-test.mjs
# 如使用其他端口：
ONETHU_TEST_URL=http://127.0.0.1:5199 node tools/feedback-round2-browser-test.mjs
```

脚本在隔离的浏览器环境中加载真实组件与课程数据夹具，与日常浏览器数据互不干扰。NFC 测试仅模拟底层原生桥接调用，完整运行应用内的能力判断、内容编码、容量检查、接收解析与落库流程。

## 结果

`report.json` 共通过 67 项断言（`errors=[]`），并记录了 6 组视口与时间轴的几何测量数据：

- `schedule-desktop.png`：横向桌面视图，画布铺满右侧与底边。
- `schedule-phone.png` / `schedule-phone-small.png`：390 / 320 宽度手机视图。
- `schedule-landscape.png`：844×390 横屏视图。
- `schedule-vertical.png`：竖向标签栏模式下的完整日程。
- `personal-nfc-ready.png`：名片直接发起传送，界面清晰提示等待对方接收。
- `radar-desktop.png` / `radar-phone.png`：雷达内直接集成复制、NFC 接收与传送操作，未开启或设备无此硬件时展示清晰说明。

预览画面中的校历错误提示源于当前未登录校园服务，测试完整保留了产品真实的错误提示表现。

第一轮的 55 项回归断言同样全部通过，涵盖 Segment 拖动指示条、玻璃模糊、自动文字对比度、侧栏、首页组件与手机按钮避让；Desktop TypeScript、OneGUI 系统护栏、图标与 CSS 结构检查均已通过。

## 测试环境与补充说明

本轮在桌面浏览器环境中完成前端验证，Android 真机无线互传、云盘实网上传与跨账号接收留待真机联调测试。受限于现有原生桥接仅提供本机就绪信号、无接收方回执，NFC 处于 `ready` 状态时界面如实展示“本机发送就绪，等待对方靠近接收”。遇到超大头像名片时，无线传送副本会自动压缩头像体积以适配传输容量，本地原名片与复制口令则完整保留原图。

OneGUI 护栏中除起点提交既有的 R8 旧样式总行数基线偏差（9766 / 9753，本轮未新增旧样式代码）外，其余规则全部通过。
