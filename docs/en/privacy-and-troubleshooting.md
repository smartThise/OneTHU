# Privacy and troubleshooting


[中文](../privacy-and-troubleshooting.md) · English

OneTHU brings campus services, cloud sync, and AI tools into one workspace while keeping each service's data path distinct: UI preferences stay local on your device, university sessions talk directly to Tsinghua servers, cloud libraries sync with Tsinghua Cloud or GitLab when enabled, and AI providers receive only the prompts and attachments you include in a turn.

Public screenshots are captured entirely from fictional fixture data. When opening an issue or sharing feedback, always review and redact exported diagnostics first—keeping passwords, session cookies, tokens, QR codes, full SSO redirect URLs, and personal academic records private.

## Login problems

When troubleshooting sign-in issues, note the exact OneTHU version and OS. Public-key lookup can fail if the campus server returns an HTML prompt instead of a key, a verification challenge expires, upstream services are under maintenance, or your account has reached its trusted-device limit—so check the specific error stage alongside any proxy settings. Stay within the same 2FA challenge flow while entering a code, and if your trusted-device list is full, manage registered devices on the official Tsinghua account portal.

On Windows, check whether a hang is an unresponsive UI or a slow network request by testing whether buttons, text fields, refresh controls, and 2FA inputs still react to clicks and typing; include VPN or TUN proxy settings as helpful context while keeping credentials out of logs.

Recent sign-in updates properly detect Tsinghua's title-only 2FA prompt. Note that `unexpected-page / credential-entry` logs indicate which page shape appeared at that step independently of whether credentials were submitted. On Windows, press `Win + R`, open `%APPDATA%\app.onethu.desktop\logs`, and copy the relevant `AUTH-PHASE`, `AUTH-FAIL`, `ILIB`, and `NATIVE-HOP` lines from `onethu-debug.log` (omitting any passwords, codes, cookies, or HTML bodies). `Chrome/79` in log headers reflects OneTHU's configured compatibility User-Agent string while WebView2 runs the system's current browser runtime.

## Cloud ownership and conflicts

Whenever a cloud library's owner cannot be verified against the active account, OneTHU pauses automatic creation, deletion, and sync so you can confirm the signed-in account and avoid creating duplicate empty libraries. Delete prompts always name the exact target resource, compatible edits merge automatically, and conflicting records ask you to choose which version to keep.

To verify organization permissions and cross-device collaboration end-to-end, test with two real accounts against live remote repositories following the multi-account verification guide.

## Updates and recovery

In-page refresh reloads data for the current service, while the floating refresh button resets broader view state; if your session has expired, follow the sign-in prompt to re-authenticate cleanly. Production updates ship as full, signed installers—Vite hot reload applies only to local frontend development.

Helpful bug reports include the app version, OS, active experience mode, reproduction steps, expected vs. actual behavior, and redacted log excerpts. Upstream campus outages, model-provider limits, OS notification settings, and mobile background-battery rules can also affect live behavior independently.
