# 0.11.4 登录恢复与学习会话回归修复


日期：2026-10-27。用户报告 Windows 长期停留在登录页，诊断为 `Session recovery is still in progress.`，学习页面也反复失去登录态。

## 已确认的问题

1. `packages/cli/src/daemon.mjs` 原先要求除 status 外的桌面私有请求全部等待 `runtime.start()` 完成，而该启动流程串联了学校身份探测和学习初始化。后台网络缓慢时，桌面 exportSession 随之阻塞；十秒后前端结束加载遮罩，但后续 `clients.login()` 仍被尚未结束的 resumeRequest 拦截，报错文本与用户反馈一致（该 Windows 设备上具体挂起的底层网络请求待真机日志进一步印证）。
2. SDK 把学习 CSRF 初始化放在学校登录／恢复完成前。学习站故障会拖住整个恢复流程，尽管学校身份已经有效。
3. 桌面启动使用可触发宿主认证钩子的共享 LearnClient，且 nativeFetch 没有向 Rust 传入调用方 timeoutMs，也没有实现 signal。UI 的十秒计时并未终止这个学习探测。
4. 后台在相同 epoch 从 idle 变为 ready 时，桌面会重复导入后台 cookie，可能覆盖桌面更新过的服务 cookie 和 CSRF。非阻塞快照需要明确区分持久化记录与完成身份验证的快照。
5. 本机原生日志显示主登录成功，随后学习恢复失败、学习请求 403，以及旧 `course/student/index` 页面 404。info-lib 的 Learn 首页常量确实仍指向该旧地址。

## 修复

- 私有快照读取、状态、明确的登录移交、退出和执行策略控制不再等待启动网络恢复。账户 epoch、现有授权和 MCP 隔离继续生效。
- SDK 学校身份恢复单飞，并在提交状态前核对 epoch；学习初始化移到实际学习操作。新的退出或登录移交能够使旧恢复失效。
- 桌面改用不挂载密码源与宿主重登钩子的独立候选 LearnClient 做八秒可取消只读探测；探测成功后在当前 generation 内提交 CSRF，超时或迟到响应会自动丢弃。
- nativeFetch 实际传入 Rust timeout_ms，处理 AbortSignal，并在异步序列化后、IPC 之前再次检查取消。原生账户 epoch 保护保留。
- 相同 epoch 的启动完成状态不重新覆盖已就绪 GUI 的服务会话。后台尚未验证的快照只允许匹配的本地持久化账户使用自身原生仓进行探测；不同归属直接拒绝导入。
- 修正 Learn 首页地址，补充失败漫游的脱敏原因日志，并将本次挂起场景纳入 release workflow。

## 验证证据

- 真实 daemon 子进程，只有合成学校请求：将启动身份请求挂起，快照导出、退出、明确登录移交三个场景全部通过。相同测试执行修复前的 daemon 源码时三项均超时失败；无需真实账号或学校网络即可复现。
- SDK 最终 **199** 项通过，CLI **77** 项通过；私有会话移交最终 **13** 项、共享运行时 **21** 项、原生 epoch／取消 **10** 项、登录设备及互斥 **67** 项、学习准备 **7** 项、独立学习探测 **5** 项通过。
- 桌面 TypeScript、生产前端构建、i18n **7665/7665，errors 0** 通过。
- 在原缓存 dev App 内验收，没有启动另一份 App。刷新前学习页可复现 HTTP 403；加载修复后未输入密码，恢复首页与课程刷新。原生日志中课程、作业、课件与通知请求返回 200。
- 通过同一常驻 CLI 实际读取：学期 4 项、课程 11 项，某课程作业 4 项，作业详情及 1 个附件引用可用，通知 2 项及通知正文可读，详情 issues 为空。仅记录计数，不把课程名、ID 或正文写进仓库。
- 本轮没有提交作业、预约、邮件或 IM 消息。UI 验收点到过一个“忽略作业”确认层，已取消，未确认忽略。

本地证据：`output/session-recovery-20261027/`，相关运行日志为 `/tmp/onethu-session-*.log`。Windows 验证包和构建结果将在下方补记。

## Windows 原生检查补充

首轮 Actions `40359638345` 在 SDK 的实际 Windows 会话存储自检中报出 `AUTH_STORAGE_ACL_FAILED`（尚未进入学校网络探测），随即手动中止本轮运行以取回日志，既有公开发布构建保持不变；由于底层异常当时被外层通用 catch 折叠，需结合具体 ACL 调用进一步排查。

后续将私有 DACL 构造改为明确的 .NET 构造函数和文件／目录 ACL API，保留当前用户唯一允许规则、受保护继承和所有者设置。PowerShell 调用有 15 秒期限，只传回固定阶段码，避免输出带私人路径的 stderr。Windows smoke test 会在合成目录上实际验证 DACL、持久化、原子替换、剔除额外 Everyone 显式授权，且先于整套 SDK 测试执行。参考 [Directory.SetAccessControl](https://learn.microsoft.com/en-us/dotnet/api/system.io.directory.setaccesscontrol?view=netframework-4.8.1) 和 [File.SetAccessControl](https://learn.microsoft.com/en-us/dotnet/api/system.io.file.setaccesscontrol?view=netframework-4.8.1) 的按修改区段持久化语义，并在真实 Windows Actions 环境中执行验证。

第二轮 `40362445373` 已成功创建私有会话仓，随后测试侧的 `Get-Acl` 报出 `Microsoft.PowerShell.Security` 模块自动加载失败，揭示旧生产代码的 `Set-Acl` 在受限 Windows 子进程环境下存在同类兼容隐患（该平台差异需通过真实 Windows 环境验证，macOS 的 chmod 测试仅覆盖类 Unix 权限）。测试验证器随即同步改为直接查询原生 .NET ACL，彻底脱离对 PowerShell 安全模块与 JSON 转换命令的依赖。

首轮完整 SDK 测试还发现 Windows 插件子进程尚未关闭就清理目录的 `EBUSY`。宿主的停用、卸载、设置重启、失败启动和关闭现在等待实际 process/stdio close，保留立即撤销权限及 500ms 强制终止，并以三秒退出期限避免再次无限等待。修正一个测试里重开宿主先于旧清理 hook 关闭的顺序。新增测试验证停用、卸载与关闭返回时 worker 已真正关闭；本机 SDK **199/199** 通过。

桌面恢复末尾另有两个无关服务等待：Info 的预热和 CLI 通知／任务迁移。前者使用带恢复钩子的客户端，后者可能被常驻启动排队拖住。现在 Info 在实际操作时建立；任务同步继续按其账户／epoch 护栏后台执行并报告错误，不再占用前台登录互斥锁。新增实际生产函数测试，把两项服务永久挂起，验证前台仍能就绪；私有会话移交现为 **12/12**，登录状态 **67/67** 通过。

原 dev 最终运行时为 `8ae909dbb6aa…`。首次刷新期间完成了常驻程序热升级，含升级在内的端到端恢复总耗时约 23.1 秒（其中学习探测与提交阶段为 163ms）；相同版本再次整页刷新，日志记录的端到端恢复降至 **107ms**，全程无需输入密码或验证码。学习页刷新后显示 **12 门课程**（合并了雨课堂课程），CLI 查询纯 Learn 接口返回 11 门。当前 daemon 状态为 ready，warnings 为空。

实页还发现，CLI 接管已设置 helper.userId，但不携带密码；原恢复逻辑仅在 userId 为空时回填本机记住的凭据，旧式 roamingWrapper 会因此在首页待办／日历直接抛 `Please login.`。现在在恢复的账号与本机保存的账号相同、generation 仍有效时回填内存凭据，然后才发布 ready。其他账号的保存密码不回填、不进入 CLI。新增实际生产函数测试，私有移交检查为 **13/13**。

最终原 dev 整页重载复核：恢复 **99ms**，没有重新提交密码／验证码，最新一轮 `PAGE-ERR TODAY-*` 为 **0**。最终前端生产构建成功，TypeScript 通过。

## Windows 最终构建与产物

- 源码：`db22eb5a3dcbebba5809c51cf46a0dd4e9b95ba9`，已同步 GitHub 与清华 GitLab 的 main / dev3。
- [Actions 40368403050](https://github.com/smartThise/OneTHU/actions/runs/40368403050) **success**。Windows 实际 DACL、挂起启动恢复、私有移交 13 项、SDK 199 项，以及其余认证／账户／桌面检查全部通过，安装包上传成功。
- [Windows 产物 12672671446](https://github.com/smartThise/OneTHU/actions/runs/40368403050/artifacts/12672671446)。ZIP 长度 **72,515,575** 字节；与 GitHub digest 相同的 SHA-256 为 `3b3aec913d2a301b722525794971e0aae33be93d06684992378342e7947caa77`。
- `OneTHU_0.11.4_x64-setup.exe`：**54,401,676** 字节，SHA-256 `563aa9e743973f74ebbf3ead751a4cb34d756616b6fbfe991723c4db3a5ecf8d`。
- 解包确认应用为 x64、PE 版本 0.11.4.0；NSIS 引导器本身为 x86，内含应用为 x64。安装后的应用与该次原始 exe 比对，只存在预期的 Tauri NSIS bundle 标记变化。
- Harness 为 Windows x64，内置 CLI 0.11.4 / Node v22.23.4 x64。运行时 buildId `5e7cf9ea5bae6cde9769733942ff9d7c23394876c3ae84f71dadca173839575e`；36 个清单文件与 Node 解压后二进制哈希一致，开发者面板资源未包含。
- 本地最终包：`output/session-recovery-20261027/final/installers/OneTHU_0.11.4_x64-setup.exe`；检查记录位于同一 final 目录。中间提交的重复安装包／解包目录已清理，保留校验记录。

以上检查覆盖了 Windows 操作系统上的会话协议、文件 ACL 权限执行、安装包构建与解包内容核验；Windows 桌面端 GUI 的真实学校账号登录待开发者安装本轮构建包后实机复核。

## 交付边界

本轮修复已先行合入 main / dev3 和本地原 dev 环境，既有 v0.11.4 标签与公开安装包保持原状；本次生成的 Windows Actions 产物供开发者实机验证 GUI 登录流程使用，待确认无误后再推进正式渠道更新。
