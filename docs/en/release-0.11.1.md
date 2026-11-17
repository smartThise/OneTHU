# OneTHU 0.11.1 · Revolution maintenance update


[中文](../release-0.11.1.md) · [English](release-0.11.1.md)

OneTHU 0.11.1 restores secondary-registration courses and calendar synchronization across macOS, Windows, and Android.

- Secondary timetables now parse both Chinese and English week labels, including the campus portal's `week 4` format.
- The weekly timeline merges secondary courses automatically as soon as the academic calendar loads.
- The monthly agenda displays secondary courses alongside their dates, session times, and room details.
- If refreshing the secondary timetable fails, a clear retry prompt appears while keeping primary courses visible.
- System-calendar sync validates a full-semester cache across both course sources and preserves your existing calendar entries if a refresh fails.
- Android ships as version 0.11.1 (`versionCode` 11009) with the standard production signing certificate and stacked app icon.

After updating, tap Refresh in Schedule settings to pull your complete course list. In-app update checks, GitHub Releases, and the Tsinghua Cloud mirror all serve this build.

## Phone controls and layout

- Mobile navigation lets you choose between the bottom OneShot bar and a top-left menu button that opens a vertical feature drawer—showing five core shortcuts in Minimal mode and all primary features in Practical and Full modes. Each mode remembers its own preference, and Practical and Full modes let you pick during onboarding.
- Entering whiteboard Edit mode preserves your current zoom level and layout, pairing clearer toolbars with Undo and a confirmed **Restore defaults** action.
- Drag the floating temporary box toward a screen edge to dock and tuck it halfway offscreen; tap once to expand it, or drag inward to place it freely. Dragging items toward a docked box automatically pops it open.
- Android OH features a clearer **Collapse** button.
- Organization management and editing sheets now layer cleanly above the Settings overlay.
- Software-update checks keep a steady loading label and spinner across mirror fallbacks, with **Cancel** and **Retry** available in all three experience modes.

## Revised installers · October 22

Whiteboard widget previews now run inside isolated, read-only data scopes so sample courses, assignments, and files stay strictly inside the preview while global search and background sync continue using your real account data. All three platform installers have been refreshed with this fix.

If you installed an earlier 0.11.1 build, download the October 22 installer and install it directly over your current app to keep all local settings and data—in-app update checks compare version numbers only, and Android's `versionCode` is now 11009.
