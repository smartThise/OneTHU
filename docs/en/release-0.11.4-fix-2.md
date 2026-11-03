# OneTHU 0.11.4-fix-2 · Revolution

> 最后更新：2026-10-29 12:28

- Schedule: fill the available viewport; use the desktop wheel to change weeks and horizontal touch swipes on phones, with continuous whole-week transitions.
- MadModel: DSH-aligned response budgets, background renewal of usable tokens, a process-wide school-provider lane and rate-limit backoff. Ambiguous timeouts and responses that have begun producing output are not replayed.
- OH: in-app services and task management work independently of external CLI access, including on phones.
- Data: GUI and resident CLI share account calendar events and mailbox configuration, with migration, offline-edit merging and revision checks. Authorized cloud and Rain Classroom connections use a private bridge.
- CLI: desktop installers omit Node/CLI. Full-mode onboarding and settings offer explicit installation, upgrade and uninstall. Windows/macOS ZIPs are distributed separately.
- Residency: scheduler handoff preserves task identity, history and download/notification receipts. Uninstall keeps account data.

See the [CLI guide](onethu-cli.md) for the service boundaries. Physical Windows/MatePad account acceptance remains pending; synthetic tests do not make bookings or send real messages.
