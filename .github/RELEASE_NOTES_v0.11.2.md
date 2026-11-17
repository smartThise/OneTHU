# OneTHU 0.11.2 · Revolution

面向 macOS、Windows 与 Android 的稳定性与交互体验更新。0.11.1 用户可直接覆盖升级，现有本地数据与个性化设置均完整保留。

## 本次更新

- **网络学堂连接恢复更稳健。** 根据服务端实际响应准确区分会话过期、网关异常与访问限流，并发请求共享同一次会话恢复流程；作业详情加载失败时支持一键重试，同时保留最近一次完整加载的内容。
- **壁纸支持跨设备备份与恢复。** 备份现直接打包图片或视频原文件，恢复时自动保存到当前设备，并对未找到备份、权限不足或文件超限提供清晰提示。将两台设备均升级至本版本后，即可从原设备重新上传并在另一台设备恢复壁纸。
- **横屏平板支持显式编辑锁定。** 宽屏布局下日常浏览可顺畅滚动与打开内容，点击“编辑”后再开启组件的移动与缩放，减少日常误触。
- **玻璃视觉材质更统一。** 课程筛选框、通知条、作业卡片与详情页标题统一采用玻璃材质，原有的主题配色、玻璃强度与自动文字对比度设置同步生效。
- **桌面窗口协作更自然。** 再次启动正式版应用会自动唤回已打开的主窗口；当 OH 悬浮窗在桌面显示时，关闭主窗口会将其转入后台并可随时通过 OH 重新唤出，主窗口与 OH 均关闭后应用正常退出。

三种模式新增统一的软件更新弹窗，可直接前往更新页面，或选择在 1 小时、1 天、7 天后再次提醒。延后提醒记录在重启应用后依然有效，遇到更高版本发布时也会及时重新提醒；同时全面支持中英文界面，并保留原有的手动检查更新入口。

- 新闻发布单位名称随界面语言即时切换，中英文缓存独立保存，切换语言后直接展示对应语种名称。
- 手机白板「确认添加」按钮优化触控容差与收起动画，手指轻微滑动也能顺畅确认。
- 极简首页精简重复标语，清爽聚焦于今日待办与今日课程。

本版本同时包含 0.11.1 的二级课表、手机端布局与预览数据隔离等全部修复。

## 升级说明

- 若早期的壁纸备份仅记录了原设备的本地路径，请在仍存有原壁纸的设备上升级至本版后重新上传一次。单个媒体文件上限为 12 MiB，整份备份上限为 24 MiB；超出体积限制时会给出提示并保留当前壁纸。上传与恢复继续沿用现有的手动操作入口与云盘授权。
- Windows 覆盖安装时，请允许安装程序关闭正在运行的旧版 OneTHU 进程，以便一并清理旧版本遗留的 OH 窗口。
- Android 版沿用正式签名与原版 Logo，versionCode 为 **11011**，支持从早期的正式版直接覆盖升级。

下载：按系统选择下方安装包，或前往清华云盘的 [macOS](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/?p=%2FmacOS%2F)、[Windows](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/?p=%2FWindows%2F)、[Android](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/?p=%2FAndroid%2F) 文件夹下载。`SHA256SUMS.txt` 提供三端安装包的 SHA-256 校验码。

---

# OneTHU 0.11.2 · Revolution

Stability and interaction improvements for macOS, Windows, and Android. Users on 0.11.1 can upgrade directly in place while keeping all existing data and settings.

## Changes

- **More reliable Web Learning recovery.** Expired sessions, gateway errors, and rate limits are handled according to actual server responses, with concurrent requests sharing a single session recovery attempt. Failed assignment details offer a quick retry while preserving the last complete data.
- **Portable wallpaper backups.** Backups now bundle your image or video files directly and save them locally when restored on another device, with clear prompts for missing backups, permission issues, or file size limits. After updating both devices, upload once from the source device to restore on the other.
- **Explicit edit lock on landscape tablets.** Landscape wide layouts let you scroll and open items freely during everyday browsing, while moving or resizing widgets stays tucked behind Edit mode to prevent accidental drags.
- **Consistent glass surfaces.** Course filters, notification strips, assignment cards, and detail headers now share a cohesive glass finish that respects your theme, glass intensity, and automatic text-contrast settings.
- **Natural desktop window management.** Launching the app again brings the existing main window to the front. Closing the main window while OH is open hides it in the background so OH can reopen it anytime; closing both exits the app cleanly.

All three modes now feature a unified update prompt that lets you jump straight to Software Update or snooze reminders for 1 hour, 1 day, or 7 days. Snooze timers persist across restarts while still alerting you when an even newer version ships. Both Chinese and English interfaces are supported alongside manual update checks.

- News department names now match the active interface language, backed by separate Chinese and English caches so labels stay accurate after switching languages.
- The widget confirmation button on phones tolerates slight finger movement on tap and closes with a smoother transition.
- Minimal home removes repeated slogans to keep the focus on today's tasks and classes.

This release also includes all secondary timetable, phone layout, and preview data isolation fixes from 0.11.1.

## Upgrade notes

- If an earlier wallpaper backup stored only local file paths from the original device, update the device that still has the media and upload once more. Backups support up to 12 MiB per media file and 24 MiB in total; if a file exceeds the limit, OneTHU lets you know and keeps your current wallpaper untouched. Uploading and restoring continue to use the existing manual controls and cloud authorization.
- On Windows, allow the installer to close running OneTHU processes during setup so lingering OH windows from older builds are cleaned up properly.
- Android keeps its production signing certificate and canonical logo with versionCode **11011**, supporting direct in-place upgrades from earlier release builds.

Choose the installer for your platform below or download from the Tsinghua Cloud folders linked above. `SHA256SUMS.txt` contains SHA-256 checksums for all three installers.
