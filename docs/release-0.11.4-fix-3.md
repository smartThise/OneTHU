# OneTHU 0.11.4-fix-3 · Revolution

> 最后更新：2026-11-18 01:30

- 修复保留本机应用数据覆盖升级后，因 CLI 独立目录尚未创建而引发的登录路径报错（GitHub #60）。原生层启动时现会先行创建所需目录，即使本地路径写入受限也会返回结构化提示，让客户端顺畅保留本机认证与二次验证流程。
- 补齐更新器访问清华云盘镜像所需的原生 `epoch` 参数。公开更新查询无需登录即可直接拉取，重定向过程保持原请求代次；切换账号后自动停止旧请求。
- 新增原生启动流程的独立 Rust 回归测试、严格原生 IPC 参数回归与登录降级／2FA 边界校验，确保存量应用数据与多账号隔离稳固可靠。

Windows、macOS、Android、独立 CLI 与 SDK 版本号统一为 `0.11.4-fix-3`，Android 版 versionCode 为 `11016`。

[问题 #60](https://github.com/smartThise/OneTHU/issues/60) · [CLI 文档](onethu-cli.md)
