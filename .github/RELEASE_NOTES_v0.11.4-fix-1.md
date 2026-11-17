# OneTHU 0.11.4-fix-1 “Revolution”

本次维护版本完整保留 0.11.4 的 CLI、SDK、OH 与界面改进，并集中修复以下问题：

- 修复 Windows 常驻后台启动与会话存储权限问题；当后台进程暂时未能就绪时，桌面端仍可正常完成校园网登录并恢复本机已有会话。
- 加快对后台进程异常退出的检测响应，并记录脱敏后的启动诊断信息以便排查。
- 首页“今日课程”与日程课表统一使用相同的一级、二级课程数据源；读取失败时提供重试按钮，当日确认无课时清晰显示空课状态。
- 修复平板端实用模式下设置页无法滚动的问题；触屏设备上的白板布局继续通过显式“编辑”开关进入调整状态。
- 手机阅读布局下自动约束从桌面端同步而来的超高卡片尺寸，同时完整保留已保存的白板摆位与自由画布尺寸。

下方附件提供 macOS Apple Silicon、Windows x64、Android ARM64 安装包以及独立 CLI / SDK 压缩包。Android 版沿用原正式签名，可直接覆盖升级。

为兼容初版 0.11.4 客户端的三段式数字版本号比对规则，本次更新清单采用兼容编号 **0.11.5** 推送更新提醒，安装后的实际版本号为 **0.11.4-fix-1**；升级后的客户端会直接比对完整版本号。

## English

This maintenance update retains all CLI, SDK, OH tools, and interface improvements from 0.11.4 while addressing the following issues:

- Fix Windows resident service startup and private session storage permissions. Desktop university sign-in and local session recovery continue to work smoothly even if the background runtime is unavailable.
- Detect early background-process exits promptly and record sanitized startup diagnostics.
- Unify primary and secondary timetable sources across the home screen and schedule view, showing a retry button on failed requests and a clean empty-day state when no classes are scheduled.
- Restore scrolling in tablet Practical-mode settings while keeping explicit touch-edit controls on whiteboards.
- Cap oversized desktop card heights in phone reading mode while preserving saved widget positions and free-canvas dimensions.

Installers for macOS Apple Silicon, Windows x64, and Android ARM64 are attached below alongside standalone CLI and SDK archives. Android keeps the existing release signing certificate for in-place updates.

Because the initial 0.11.4 updater compares three-part numeric versions, the update manifest uses compatibility version **0.11.5** so existing installations receive the update prompt; the installed version is **0.11.4-fix-1**, and updated clients compare full version strings directly.
