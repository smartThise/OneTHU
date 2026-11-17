# OneTHU 0.11.1 · Revolution

二级选课课表与手机交互修复，macOS、Windows 与 Android 三端同步发布。

2026-10-22 安装包修订：组件预览现采用独立的数据作用域，修复了内置示例课程、作业与课件混入实际搜索结果的问题。三端安装包均已重新构建。由于修订包沿用 0.11.1 版本号，已安装早期 0.11.1 构建的用户请手动重新下载并覆盖安装，本地数据会完整保留。

- 二级课表同时兼容学校中英文周次格式（含 `week 4`），修复切换语言后遗漏课程的问题。
- 校历加载完成后自动补齐二级选课课程，周时间轴与月历列表统一展示二级课表及课程详情。
- 课表刷新异常时提供重试提示，已加载的其他课程继续正常展示。
- 系统日历同步采用经过完整性校验的新版全学期缓存。
- Android 沿用正式签名与原版 Logo，versionCode 为 11009。

- 手机端左上角新增纵向功能浮层按钮（可替代 OneShot）：极简模式包含五项核心入口，完整与实用模式覆盖全部一级入口，并在导览中提供布局选择。白板编辑新增撤销与恢复默认布局，同时保留编辑前的缩放比例。
- 暂存箱支持吸附屏幕边缘半收起、点按展开与拖回自由放置；Android 端 OH 收起按钮更加醒目易点。
- 修复组织管理页面被设置浮层遮挡、检查更新时按钮文字变空的问题；更新检查现支持超时回退、手动取消与重试。

升级后可在日程设置中点击“刷新”重新拉取完整课表。

下载：按系统选择下方安装包；也可前往清华云盘直接进入 [macOS](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/?p=%2FmacOS%2F)、[Windows](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/?p=%2FWindows%2F)、[Android](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/?p=%2FAndroid%2F) 文件夹下载。`SHA256SUMS.txt` 提供三端安装包校验码。

---

Secondary timetable and phone interaction fixes for macOS, Windows, and Android.

Installer revision (October 22): widget previews now run in isolated data scopes, fixing an issue where sample courses, assignments, and files appeared in live search results. All three installers have been rebuilt. Because this revision keeps the 0.11.1 version number, users already on the initial 0.11.1 build should download and install this updated package manually over their existing installation; all local data is preserved.

- Support both Chinese and English week formats (including `week 4`) in secondary timetables, restoring courses that disappeared after switching languages.
- Load secondary courses automatically once the academic calendar is ready, and display them with full details in both the weekly timeline and monthly agenda.
- Show a clear retry option when a refresh fails while keeping previously loaded courses visible.
- Use a newly validated full-semester cache for system-calendar sync.
- Keep the production signing certificate and canonical logo on Android (versionCode 11009).

- Add a top-left phone button that opens a vertical feature menu as an alternative to OneShot, offering five core entries in Minimal mode and all primary features in Full and Practical modes, with a layout choice during onboarding. Whiteboard editing also gains Undo and Restore defaults while preserving your zoom level.
- Allow the staging vault to dock and half-hide along screen edges, and give Android OH a clearer Collapse button.
- Dismiss overlapping settings panels cleanly when opening organization management, and improve software update checks with clear progress states, timeout handling, Cancel, and Retry.

After upgrading, click Refresh in Schedule settings to reload your courses. Choose the installer for your platform below, or download from the linked Tsinghua Cloud folders. SHA-256 checksums are provided in `SHA256SUMS.txt`.
