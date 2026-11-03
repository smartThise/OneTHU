# OneTHU 0.11.4-fix-3 · Revolution

> 最后更新：2026-10-29 13:33

- Repair sign-in after upgrading with retained application data when the separate CLI profile directory is missing (#60). Native startup creates the directory before opening its log. Storage failures use structured availability codes, preserving local sign-in and 2FA.
- Supply the required native session epoch for public Tsinghua Cloud update requests. Update checks work while signed out; redirects retain the original epoch and account changes reject stale responses.
- Add regressions that execute the production Rust startup functions, enforce native IPC arguments, and protect local sign-in, 2FA and account isolation.

Windows, macOS, Android, the standalone CLI and SDK use `0.11.4-fix-3`. Android versionCode is `11016`.

[Issue #60](https://github.com/smartThise/OneTHU/issues/60) · [CLI guide](onethu-cli.md)
