# OneTHU 0.11.4-fix-2 · Revolution

- 日程：修复课表底部留白，使视图随窗口自然铺满；桌面端支持滚轮上下切周，手机端支持左右滑动跟手切换，整周平滑连续过渡。
- MadModel：对齐 DSH 插件调整慢响应等待预算、有效凭据后台自动续签、进程内请求串行排队与限流退避策略；仅对确认尚未发出的请求执行重试，避免在超时状态不明或已开始流式输出时重复发送。
- OH：应用内的校园查询、日程与任务管理通过内置通道独立运行，无需依赖外部 CLI 开关，手机端也可直接访问已授权的各项服务。
- 数据同步：桌面界面与常驻 CLI 共享当前账号的日程与邮箱配置，支持平滑迁移、离线编辑合并与并发版本校验；已授权的清华云盘与雨课堂连接通过本机私有通道安全同步。
- CLI：标准桌面安装包保持轻量，将 Node 与 CLI 拆分为可选组件，可在完整模式导览与设置页按需安装、升级或卸载，同时提供 Windows 与 macOS 独立 ZIP 压缩包下载。
- 常驻服务：安装状态切换前会平稳停止定时调度并落盘当前状态，完整保留任务 ID、执行历史以及下载与通知的去重记录；卸载 CLI 后本地账号数据依然保留。

技术细节与使用说明详见 [工程报告](plans/2026-10-29-fix-2-runtime.md) 与 [CLI 文档](onethu-cli.md)。本次自动化回归均在隔离的模拟环境中运行，全程零真实场馆预约、零真实消息外发；如在 Windows 或 MatePad 设备日常登录使用中遇到问题，欢迎随时反馈。

# OneTHU 0.11.4-fix-2 · Revolution

- Schedule: fill the available viewport cleanly, switch weeks with the desktop scroll wheel or horizontal touch swipes on phones, and animate whole-week transitions smoothly.
- MadModel: align slow-response budgets with the DSH plugin, renew active tokens in the background, queue university-provider requests within the process, and back off cleanly on rate limits, retrying only requests known to have failed before output began.
- OH: run in-app campus queries, scheduling, and task management directly without requiring external CLI access, including on phones.
- Data: share account calendar events and mailbox configuration between the GUI and resident CLI with smooth migration, offline-edit merging, and revision checks, while syncing authorized cloud and Rain Classroom connections over a private local bridge.
- CLI: keep standard desktop installers lightweight by making Node and the CLI an optional component that can be installed, upgraded, or removed from Full-mode onboarding and Settings, alongside standalone Windows and macOS ZIP archives.
- Residency: pause scheduling cleanly during install-state transitions while preserving task IDs, execution history, and download/notification receipts; uninstalling the CLI keeps your account data intact.

See the [CLI guide](onethu-cli.md) for full details on supported commands and permissions. Automated verification runs safely in simulated environments with zero live bookings or outgoing messages, and real-world feedback on Windows and MatePad devices is welcome.
