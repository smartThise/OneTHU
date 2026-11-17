# OneTHU 0.11.4-fix-3 · Revolution

> 最后更新：2026-11-18 01:30

- **Upgrade sign-in fix (#60):** Fixes sign-in after upgrading with existing app data when the standalone CLI profile directory has not yet been created. Native startup now ensures the directory exists before opening its log, and storage errors return structured status codes so local sign-in and 2FA continue smoothly.
- **Update checks:** Attaches the required native session epoch to public Tsinghua Cloud update requests so update checks work even before signing in, preserving the epoch across redirects and discarding outdated responses if you switch accounts.
- **Startup & IPC tests:** Adds regression tests covering the production Rust startup path, native IPC argument validation, local sign-in, 2FA, and per-account isolation.

Windows, macOS, Android, and the standalone CLI and SDK packages all ship at version `0.11.4-fix-3` (Android versionCode `11016`).

[Issue #60](https://github.com/smartThise/OneTHU/issues/60) · [CLI guide](onethu-cli.md)
