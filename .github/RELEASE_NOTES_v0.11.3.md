# OneTHU 0.11.3 · Revolution

本次更新重点优化了登录会话恢复与设备身份识别，并支持直接在登录界面检查和获取新版更新。

- 登录页新增更新公告与手动检查入口；即使遇到学校统一认证暂时异常，也能在登录前查看、下载并安装修复版本。
- 三种模式全面支持中英双语更新提醒，可选择延后 1 小时、1 天或 7 天；当正在输入账号密码或验证码时，自动弹窗会安静等待操作完成后再提示。
- 区分处理学校网关提示页、访问限流与服务端故障，大幅减少数据刷新和会话恢复过程中重复提交密码的情况。
- 同一安装实例稳定复用设备指纹与已知账号会话，并在切换账号、退出登录和会话恢复时严格校验账号归属。
- 完整保留原有的二次验证与手动信任设备选项，登录时默认留空学校认证页的“本次统一登录”复选框。

提供 macOS ARM64、Windows x64 与 Android ARM64 安装包。Android 版沿用原正式签名与原版 Logo，versionCode 为 **11012**，可直接覆盖升级。若旧版本登录受阻，可直接在本页或[官网下载页](https://onethu.github.io/download.html)下载最新安装包。

[完整中文说明](https://onethu.github.io/docs/release-0.11.3/) · [清华云盘镜像](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/)

---

# OneTHU 0.11.3 · Revolution

This release strengthens session recovery and device identity, and brings software update checks directly to the sign-in screen.

- View release announcements and check for updates right from the sign-in screen, so you can download and install fixes even when university authentication is temporarily unavailable.
- Receive update reminders in Chinese or English across all three modes with 1-hour, 1-day, or 7-day snooze options; automatic prompts wait politely while sign-in or verification is in progress.
- Handle university gateway pages, rate limits, and service outages distinctly to avoid repeated password submissions during background refreshes and session recovery.
- Reuse the installation fingerprint and known account sessions consistently, with stricter ownership checks across account switching, sign-out, and recovery.
- Preserve two-factor verification and explicit trusted-device choices while leaving the university's single-sign-on checkbox unchecked by default.

Available for macOS ARM64, Windows x64, and Android ARM64. Android keeps its production signing certificate and canonical logo with versionCode **11012** for direct in-place upgrades. If an older build is unable to sign in, grab the latest installer here or from the [official download page](https://onethu.github.io/en/download.html).

[Full English notes](https://onethu.github.io/docs/en/release-0.11.3/) · [Tsinghua Cloud mirror](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/)
