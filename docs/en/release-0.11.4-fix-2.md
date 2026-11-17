# OneTHU 0.11.4-fix-2 · Revolution

> 最后更新：2026-11-18 01:30

- **Schedule:** Expands to fill the available viewport, supporting mouse-wheel week switching on desktop and smooth, full-week horizontal swipes on phones.
- **MadModel:** Aligns response token budgets with DSH, renews active tokens in the background, coordinates school-provider requests through a single process-wide queue with rate-limit backoff, and retries only clean pre-stream failures so partial responses or uncertain timeouts never duplicate output.
- **OH:** Runs in-app services and task management directly inside the app—including on phones—with no external CLI required.
- **Data sync:** Shares calendar events and mailbox settings between the GUI and resident CLI with automatic migration, offline-edit merging, and revision checks. Authorized cloud drive and Rain Classroom sessions connect over a local private bridge.
- **CLI:** Keeps desktop installers lightweight by distributing the Windows and macOS CLI archives separately; full-mode onboarding and settings provide one-click install, upgrade, and uninstall controls.
- **Background tasks:** Preserves task IDs, run history, and download or notification receipts across scheduler handoffs, while CLI uninstallation leaves your account data untouched.

See the [CLI guide](onethu-cli.md) for details on supported commands and runtime modes. Automated test suites run safely against mock endpoints without placing live bookings or sending messages, with on-device Windows and MatePad sign-in checks queued next.
