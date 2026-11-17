# exp 视觉验收（2026-10-17）


> 归档说明：本文记录当时的设计方案与阶段性验收情况；0.11 当前功能与使用指南请查阅 [文档入口](../../README.md)（[English overview](../../en/index.md)）。


实现范围与角色说明见 `../20-exp-system.md`。

## 结果

- `pnpm guard:onegui`：通过（九条样式护栏 + scope/主题往返/动作隔离 + 28 组语义色对比度）。
- `pnpm --filter @onethu/desktop typecheck`：通过。
- `pnpm --filter @onethu/desktop build`：通过，无 CSS 语法警告，仅输出既有的大体积包与混合动态导入提示。
- token-guard / css-parse-test（57 个 CSS 文件）/ contrast-guard：通过。
- `git diff --check`：通过。
- 全量 `pnpm guard` 执行到 `ui-copy-lint` 时报出 8 处待修项（基于 dev3 源码、lint 工具与 allow 清单复跑为 9 处，本轮已修掉所改动文件中的 1 处），排在其后的串行检查步骤留待文案清理后继续运行。

## 浏览器矩阵

`visual-report.json` 覆盖 11 个场景，运行异常与页面横向溢出均为 0。所有截图均通过开发预览入口渲染真实组件（未挂载校园账号登录态）。

| 文件 | 场景 |
|---|---|
| home-light / home-dark | 1440×1000 首页 |
| settings-light | 1440×1000 设置外观 |
| search-dark | 1440×1000 搜索/OH |
| drawer-light / menu-dark | 标签抽屉 / 右键菜单 |
| phone-home | 393×852 手机首页 |
| phone-settings-dark | 393×852 深色玻璃档设置 |
| phone-landscape | 852×393 手机横屏 |
| gallery-light / gallery-dark | 组件矩阵与组件化壳独立展示示例（用于预览组件组合效果，主应用保持原有导航架构） |
| phone-onboarding | 新用户导览底部表，验证 scope 保持不透明背景 |
| wallpaper-glass-light | 墨色壁纸 + deep 材质，验证时钟阅读面 |

`interaction-report.json` 记录真实浏览器交互结果，涵盖主题往返切换、动作色稳定性、明暗与材质切换、Modal/Drawer/Menu 的打开及 Escape 关闭、设备 iframe 在 393×852 与 852×393 之间的切换，以及导览 scope 的不透明背景与文字继承。

真实像素对比度审计覆盖四个场景（首页亮色、搜索暗色、设置亮色、墨色壁纸 + deep 材质）；修复首页时钟后，严重问题与低于 AA 标准项均为 0。墨色壁纸场景的完整报告保存在 `wallpaper-contrast.json`，其余场景可通过以下命令复跑：

```sh
node tools/contrast-audit.mjs 'http://127.0.0.1:5180/?explorer-preview=home' exp-home-light --light
node tools/contrast-audit.mjs 'http://127.0.0.1:5180/?explorer-preview=search' exp-search-dark --dark
node tools/contrast-audit.mjs 'http://127.0.0.1:5180/?explorer-preview=settings-tab' exp-settings-light --light
node tools/phone-audit.mjs 'http://127.0.0.1:5180/?explorer-preview=home' exp-phone-home --wait=5000
```

手机首页与深色设置页的浏览器布局体检中，横向溢出、文字截断与文字互压均为 0，仅保留一处既有的小触控目标提示（天气“刚刚”按钮）和滚动区外的离屏元素提示；移动真机体验仍以实机测试为准。

本轮聚焦前端视觉与组件交互，真实校园 API、原生语音与麦克风、Android/iOS 实机性能、第三方主题附加 CSS 及登录后内页留待真机联调阶段验证。棘轮检查通过表明本轮零新增违规，应用旧样式的剩余迁移进度详见系统说明。
