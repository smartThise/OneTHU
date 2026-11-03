# OneTHU 0.11.4-fix-3 · Revolution

- 修复保留应用数据升级后，CLI 独立目录缺失导致的登录路径错误（GitHub #60）。原生启动先创建目录，路径写入失败返回结构化错误，让界面保留本机认证与二次验证流程。
- 修复更新器清华云盘请求缺少原生 `epoch` 参数。公开更新查询无需登录，重定向保持原请求代次；账号切换后停止旧请求。
- 增加实际原生启动函数的独立 Rust 回归、严格原生 IPC 参数回归和登录降级／2FA 边界检查；已保留的数据与账号隔离继续受保护。

Windows、macOS、Android、独立 CLI 与 SDK 统一为 `0.11.4-fix-3`。Android versionCode 为 `11016`。

[问题 #60](https://github.com/smartThise/OneTHU/issues/60) · [CLI 文档](onethu-cli.md)

# OneTHU 0.11.4-fix-3 · Revolution

- Repair sign-in after upgrading with retained application data when the separate CLI profile directory is missing (#60). Native startup creates the directory before opening its log. Storage failures use structured availability codes, preserving local sign-in and 2FA.
- Supply the required native session epoch for public Tsinghua Cloud update requests. Update checks work while signed out; redirects retain the original epoch and account changes reject stale responses.
- Add regressions that execute the production Rust startup functions, enforce native IPC arguments, and protect local sign-in, 2FA and account isolation.

Windows, macOS, Android, the standalone CLI and SDK use `0.11.4-fix-3`. Android versionCode is `11016`.

[Issue #60](https://github.com/smartThise/OneTHU/issues/60) · [CLI guide](onethu-cli.md)
