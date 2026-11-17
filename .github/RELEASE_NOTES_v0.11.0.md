# OneTHU 0.11 · Revolution

## 手机界面与小组件补包 / Mobile UI and widgets (2026-10-21)

- Android 0.11.0 / versionCode **11005**，沿用原正式签名与原版上下结构 Logo。
- 修复系统安全区重复留白、OH 胶囊上下空间与 OneShot 间距，优化手机按钮与悬浮工具的紧凑度。
- 修复组件抽屉与选择层被底部导航遮挡、底部内容无法触达以及绑定浮层重复打开后难以关闭的问题。
- 提升白板组件标题、课程时间、作业与余额信息的可读性，同步优化 Android 桌面小组件的正文与说明字号及深浅色对比度。
- Fix duplicate safe-area spacing, refine phone controls, keep widget pickers above navigation, and improve widget text hierarchy and contrast. Native binding dialogs can now be reopened reliably.
- 本次仅更新 Android 安装包，macOS / Windows 安装包保持不变；桌面端对应修正将随下次桌面构建一并发布。
- This update replaces the Android APK only; the macOS and Windows installers remain unchanged.

## Android 图标补包 / Android launcher repair (2026-10-21)

- 修复 Android 工程重新生成后误用 Tauri 默认图标的问题，恢复原版上下结构的 OneTHU Logo，完整覆盖普通、圆形与自适应图标。
- Restore the original stacked OneTHU logo for standard, round and adaptive Android launcher icons. Release builds now sync the logo automatically and verify the compiled APK resources.
- Android: 0.11.0 / versionCode **11004**, source `828d4d447f50af17a3e98e22b637d74b290f860d`, existing release signing certificate. macOS and Windows retain source `fc626cfd187ecd9ede05b801caee48b8e75cf974`.

## 登录与语言补包 / Sign-in and language rebuild (2026-10-21)

- 修复仅通过网页标题标识二次认证时误判登录表单不可用的问题；登录页与验证码页新增语言切换，切换时保留已输入内容并即时切换错误提示语言。
- Recognize the university’s title-only two-factor authentication page, and add a language selector on the sign-in and verification screens that preserves typed input and updates error messages immediately.
- Source: `fc626cfd187ecd9ede05b801caee48b8e75cf974`. Android: 0.11.0 / versionCode **11003**, same release signing certificate.
- 修复首次登录后被学习服务恢复流程误退回登录页、以及登录成功后仍受 20 秒重试冷却阻挡的问题；学习服务暂时波动时保持已登录界面，同时保留针对失败尝试的冷却保护，并在诊断日志中自动脱敏 URL 路径里的会话参数。
- Keep the signed-in interface active during learning-service recovery, clear the retry cooldown once sign-in succeeds while preserving protection for failed attempts, and redact session parameters from diagnostic URLs.
- Verified across 117 production-browser checks, 30 authentication regressions, 28 login-state checks, 7 session-readiness regressions, 23 log-privacy checks, and 11 native-security tests using simulated university responses, with live sign-in verification on the reported Windows machine to follow.

## 2026-10-21 三端补包 / Updated installers

- 导览语言选择前新增中英双语权限须知，首行醒目提示各项服务均需手动授权，重放导览时也会完整展示。
- 云盘与 OH 权限独立开关且默认关闭；开启完整模式需先授权云盘，极简与实用模式可直接进入使用，后续也可随时从云盘页面跳回导览撤回授权。
- 手机首页与 OnePage 白板默认锁定防误触，点击“编辑”后再开放组件拖动、缩放与排版工具。
- 修复 macOS 悬浮球在后台线程修改窗口属性引发的崩溃；当旧版原生宿主无法保存授权状态时直接给出明确原因提示。

Onboarding now opens with a bilingual permissions notice highlighting manual service authorization. Cloud and OH permissions are separate and turned off by default: Full mode requires cloud authorization, while Minimal and Practical modes work right away without it. Mobile boards stay locked until Edit mode is enabled. This update also resolves a macOS AppKit background-thread crash and shows clear explanations if an outdated native host cannot persist permission changes.

登录修复基线 / Sign-in fix baseline: [`fc626cfd`](https://github.com/smartThise/OneTHU/commit/fc626cfd187ecd9ede05b801caee48b8e75cf974). Android: `versionName 0.11.0`, `versionCode 11003`, 原正式签名 / existing release certificate. 已安装早期 0.11 构建的用户可直接下载本次安装包覆盖升级。 / Users on an earlier 0.11 build can install this updated package directly over their existing installation.

从 0.10 的公测版迈向统一的校园工作台。主题、壁纸与布局均可按习惯自由调整，同时延续经典的上下结构 Logo。

## 这一版有什么

- **三种使用模式**：极简、实用、完整模式按不同使用深度组织入口与导览；自由切换模式时完整保留已有数据与完整模式配置。
- **全新 OneGUI**：统一组件体系、视觉令牌、分段导航、玻璃材质与文字对比度，集中修复手机与 Windows 端的布局、滚动及遮挡问题。
- **工作台由你安排**：白板组件支持自由移动、缩放与移除；OneShot、标签页、工作区、OneGO! 以及可移动的刷新与暂存入口分工明确。
- **长按暂存，再分享**：作业、课件、组件及已接入的内容均可长按拖入暂存箱，通过在线短口令跨设备收发（现阶段推荐优先使用短口令分享，NFC 传输仍在持续调优）。
- **好友、名片与组织**：支持个人资料同步，以及组织成员、文件、项目与公告管理；常规变更自动合并，遇到编辑冲突时提供直观的卡片对比供手动取舍。
- **日程与作业截止**：汇集课程表、作业 DDL 与自定义日程，修复极简与实用模式下的作业来源显示、列表滚动及组件内跳转留白。
- **搜索、OH 与清小搭**：三种模式均配有清晰的搜索引导；完整模式进一步提供 OneTHU Harness、插件生态、清小搭对话/历史/智能体与技能广场。应用内置轻量运行环境，可直接运行资料类与纯 JavaScript 技能，依赖复杂环境的技能则可交由桌面端 Agent 协同执行。
- **中英文体验**：全面支持中英双语界面、启动语言选择、模式专属导览，并分别录制了中英文界面截图与长按操作演示；官网、README 与现行文档同步提供中英文入口。
- **稳定性提升**：集中优化 Windows 登录窗口线程与交互、认证重试与二次验证、资料库归属校验、防重复建库、多账号隔离、同步冲突处理及 Android 返回栈导航。

## 下载与安装

| 平台 | 安装包 |
|---|---|
| macOS · Apple Silicon | `OneTHU_0.11.0_aarch64.dmg` |
| Windows · x64 | `OneTHU_0.11.0_x64-setup.exe` |
| Android · ARM64 | `OneTHU_0.11.0_arm64.apk` |

Android 版沿用 GitHub 正式版签名，已安装正式版的用户可直接覆盖升级；若此前安装了 debug 签名的测试包，请先导出所需数据再卸载重装。安装包校验值见随附的 `SHA256SUMS.txt`。macOS 与 Windows 安装包请直接从本 Release 页面下载，首次打开时按系统安全提示放行即可。

## 使用说明

OneTHU 是面向校园日常使用的非官方工具，所有公开演示均采用示例数据。涉及个人云端或智能体的服务均设有独立授权开关；跨设备分享推荐优先使用在线短口令；内置轻量技能环境适合运行资料查询与纯 JavaScript 技能，需要 Python、Node 或本地系统环境的进阶技能可配合桌面端 Agent 使用。若在多账号协作或特定品牌机型上遇到兼容性问题，欢迎随时反馈。

[官网](https://onethu.github.io/) · [开始使用](https://onethu.github.io/docs/getting-started/) · [开发者](https://onethu.github.io/developers.html) · [完整源码](https://github.com/smartThise/OneTHU)

---

## English

OneTHU 0.11 **Revolution** brings a unified OneGUI interface, customizable themes/wallpapers/layouts, three experience modes, a flexible whiteboard, staging and online share codes, contacts and organizations, course/assignment scheduling, search, OH, OneTHU Harness, plugins, and Xiaoda agents and skills.

This release includes authentication and account-isolation fixes, profile synchronization and conflict resolution, Windows interaction and layout repairs, Android back navigation, bilingual onboarding, and dedicated English interface demos. Switching modes preserves all existing data and full-mode preferences.

Downloads: **macOS Apple Silicon DMG**, **Windows x64 installer**, and **Android ARM64 APK**. Android retains the GitHub release signing identity for seamless in-place upgrades from earlier release builds; if you are migrating from a debug-signed test build, export any needed data before reinstalling. Verify downloads against `SHA256SUMS.txt`. Download desktop installers directly from this release and approve them via your operating system's first-launch prompt if prompted.

OneTHU is an unofficial campus tool, and all public demos use sample data. **For cross-device sharing, use online share codes while NFC support continues to be refined.** Built-in skills run in a lightweight JavaScript environment, while skills requiring Python, Node, or local system tools work alongside a compatible desktop Agent. Feedback on multi-account workflows and specific device models is always welcome.

[English website](https://onethu.github.io/en/) · [English guide](https://onethu.github.io/docs/en/getting-started/)

---

**桌面构建 / Desktop build**：[`fc626cfd`](https://github.com/smartThise/OneTHU/commit/fc626cfd187ecd9ede05b801caee48b8e75cf974) · Windows [Actions](https://github.com/smartThise/OneTHU/actions/runs/39600985096) · macOS 本地构建 / locally built. Android source: `828d4d447f50af17a3e98e22b637d74b290f860d`, locally built with the existing release key.


**清华云盘镜像 / Cloud mirror**：[固定下载入口](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/)，按 `Android` / `macOS` / `Windows` 系统目录直接下载 / download directly from your platform folder。三端安装包与校验文件已同步，匿名下载 SHA-256 核对一致 / all three installers and checksums are mirrored and verified.
