# OneTHU 0.11.4 · Revolution

- 新增独立 OneTHU CLI、SDK 与桌面内置常驻后台，共享登录态与定时任务；经授权的后台任务可在关闭主界面后继续检查通知并归档课程资料。
- OH 全面接入雨课堂、OneTHU 好友、组织项目与公告、清小搭技能与智能体，以及暂存箱收纳和在线短口令分享。
- 修复 IM 配置与上下文存储冲突、请求生命周期状态同步、桌面端与 CLI 会话移交及清华云盘自动重连问题。
- 修复网络学堂通知附件的文件名与扩展名识别，并合入玻璃材质、壁纸、标签页与 OH 的一系列交互细节优化。

提供 macOS ARM64 · Windows x64 · Android ARM64 安装包，并随附独立 CLI 与 SDK 压缩包。Android 版沿用正式签名与原版 Logo，versionCode 为 **11013**。Node 常驻后台面向桌面端运行；访问应用本地数据的接口在桌面 App 开启期间即可调用，详细功能支持与授权设置请参阅下方指南。

[中文说明](https://onethu.github.io/docs/release-0.11.4/) · [CLI 指南](https://onethu.github.io/docs/onethu-cli/) · [清华云盘下载](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/)

---

# OneTHU 0.11.4 · Revolution

- Introduces the standalone OneTHU CLI and SDK alongside a resident desktop backend that shares sign-in sessions and scheduled tasks, allowing authorized checks and course-resource archiving to continue after the main window closes.
- Expands OH with Rain Classroom, OneTHU contacts, organization projects and announcements, Xiaoda skills and agents, staging-box collection, and short-code sharing.
- Resolves IM configuration and context storage conflicts, request lifecycle tracking, desktop/CLI session handoff, and automatic cloud reconnection.
- Fixes learning-notice attachment filenames and extensions, and brings polish across glass surfaces, wallpapers, tabs, and OH interactions.

Available for macOS ARM64 · Windows x64 · Android ARM64, alongside standalone CLI and SDK archives. Android keeps its production signing certificate and canonical logo with versionCode **11013**. The resident Node backend runs on desktop platforms, and app-local data endpoints are available while the desktop app is open. See the guides below for supported commands and authorization settings.

[English notes](https://onethu.github.io/docs/en/release-0.11.4/) · [CLI guide](https://onethu.github.io/docs/en/onethu-cli/) · [Tsinghua Cloud downloads](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/)
