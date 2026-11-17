# 0.11.2 maintenance update


[中文](../release-0.11.2.md) · [English](release-0.11.2.md)

OneTHU 0.11.2 refines Web Learning session recovery, cross-device wallpaper backups, tablet whiteboard editing, glass materials, and desktop window behavior on macOS, Windows, and Android. You can install it directly over 0.11.1 with all local data and preferences preserved.

## Web Learning sessions

Web Learning responses now distinguish expired sessions, campus gateway prompts, permission errors, and rate limits, and concurrent requests coalesce around a single session-recovery attempt. Assignment details and submission state load together atomically—showing a retry banner while keeping your last complete snapshot visible if either request fails. Diagnostic logs continue to strip passwords, tokens, cookies, and page HTML.

## Wallpaper backup and restore

Cloud wallpaper backups now bundle custom image or video files alongside wallpaper-library metadata and built-in preset references. After updating both devices to 0.11.2, run a fresh backup from the device holding your original media and restore on the target device; OneTHU validates and saves the media into the local wallpaper folder before applying your settings.

If an older backup stored only local file paths from the source device, uploading once from the updated source device packages the media bytes for cross-device restore. Backups support up to 12 MiB per media file and 24 MiB total—reporting missing backups, cloud permission errors, and size limits with specific messages while leaving your current wallpaper untouched. Backup and restore continue using the manual controls and cloud consent in Settings.

## Tablets and glass surfaces

Tablets in landscape keep their wide multi-column layout while adopting touch Edit mode for whiteboards: everyday browsing scrolls and opens items freely, while moving or resizing widgets requires tapping **Edit** first, resetting automatically when you switch whiteboards, rotate the screen, or change modes.

Course filter bars, notification banners, assignment cards, and detail headers now share cohesive glass styling, honoring your chosen theme, glass intensity, and automatic text-contrast settings.

## Desktop windows and update reminders

Launching OneTHU again on desktop focuses the already-running main window instead of opening a second instance. Closing the main window while OH is open hides the main window in the background so OH can bring it right back; closing both exits the app cleanly (local `dev` previews still run independently). On Windows, let the installer close running OneTHU processes during setup to clear out any background windows from earlier releases.

Minimal, Practical, and Full modes now share a unified update dialog with release notes and snooze options alongside manual update checks. Android ships with `versionCode` 11011, signed with the production certificate and canonical app icon.

[Download](https://onethu.github.io/en/download.html) · [0.11.1 release notes](release-0.11.1.md) · [Technical review (Chinese)](../reviews/2026-10-22-android-session-wallpaper-tablet.md)

## Additional interaction fixes

Update reminders can be snoozed for 1 hour, 1 day, or 7 days per release across restarts, wait politely until active dialogs or onboarding steps finish, and open the shared software-update panel from **Go to update** in every mode. Campus news channels now cache Chinese and English department names separately to match your interface language, the mobile widget-confirm button tolerates slight finger drift and closes smoothly without rebuilding the catalog, and extra taglines have been trimmed from the Minimal home view.
