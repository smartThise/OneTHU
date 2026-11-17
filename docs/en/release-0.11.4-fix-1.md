# OneTHU 0.11.4-fix-1 · Revolution


[中文](../release-0.11.4-fix-1.md) · [Installers](https://github.com/smartThise/OneTHU/releases/tag/v0.11.4-fix-1) · [Tsinghua Cloud](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/)

This patch release builds on the CLI, SDK, OH, and interface features introduced in 0.11.4.

- **Windows:** Fixes resident background startup and private session permissions. Desktop university sign-in and local session recovery continue to work even when the background runtime is offline, with account ownership, explicit sign-out, and 2FA checks protecting subsequent session handoffs.
- **Home courses:** Whiteboard and compact modes now read from the same primary and secondary timetable sources, with distinct UI states for loading, retryable errors, and empty schedules.
- **Tablets:** Restores full scrolling to the bottom of settings in practical mode. Touch whiteboards now open in reading mode so you enter edit mode intentionally before moving or resizing widgets.
- **Phones:** Caps oversized desktop card heights in reading mode while keeping saved layout coordinates and free-canvas dimensions intact.

All three platform installers report version **0.11.4-fix-1**. Android ARM64 uses versionCode **11014** with the standard release signing certificate and app icon. Windows ships as an NSIS EXE, macOS ships as an Apple Silicon DMG, and standalone CLI and SDK archives are included alongside them.

Because the 0.11.4 updater compares three-part version numbers, it may display the compatibility version **0.11.5** during the upgrade prompt; once installed, the app version is **0.11.4-fix-1**, and updated clients compare the full version string so you will only be prompted once.

Application source commit: `ec2b8b341aeeeba0bcb3e0870399211f02785dc9` (including the Windows packaging workflow fix built from this tag). For test results and device validation details, see the [technical repair record](../reviews/2026-10-27-release-fix1.md).
