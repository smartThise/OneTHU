# OneTHU 0.11.4-fix-3 · Revolution

- 修复保留应用数据覆盖升级后，因缺少 CLI 独立配置目录而引发的登录路径报错（GitHub #60）。原生端启动时会先行创建所需目录；即使遇到路径写入受限也会返回结构化状态码，确保界面正常完成本机认证与二次验证。
- 修复更新检查请求清华云盘时缺少原生 `epoch` 参数的问题。公开更新查询在未登录状态下即可正常使用，遇到重定向时自动保持原请求代次，并在切换账号后及时丢弃旧请求响应。
- 补充覆盖原生启动流程的独立 Rust 回归测试、原生 IPC 参数校验以及本机登录回退与二次验证测试，持续保障本地留存数据与多账号隔离安全。

Windows、macOS、Android 客户端以及独立 CLI、SDK 版本号统一更新为 `0.11.4-fix-3`，Android 版 versionCode 为 `11016`。

[问题 #60](https://github.com/smartThise/OneTHU/issues/60) · [CLI 文档](onethu-cli.md)

# OneTHU 0.11.4-fix-3 · Revolution

- Fix sign-in errors after an in-place upgrade when the separate CLI profile directory has not yet been created (#60). Native startup now initializes the directory before opening its log and returns structured availability codes on storage errors, keeping local sign-in and 2FA working smoothly.
- Include the required native session epoch on public Tsinghua Cloud update requests so update checks work while signed out, preserve their original epoch across redirects, and discard stale responses after an account switch.
- Add Rust regressions covering production startup functions, strict native IPC argument checks, and fallback paths for local sign-in, 2FA, and account isolation.

Windows, macOS, Android, the standalone CLI, and the SDK are all updated to `0.11.4-fix-3`, with Android versionCode `11016`.

[Issue #60](https://github.com/smartThise/OneTHU/issues/60) · [CLI guide](onethu-cli.md)
