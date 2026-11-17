# OneTHU 独立 CLI / SDK / 常驻助理验收


日期：2026-10-25。工作目录位于 `main` 分支，在既有本地开发基础上接续推进；版本号沿用 0.11.3，本轮专注本地构建与验收，暂未推送远端或更新公开安装渠道。

后续更新：桌面端与 CLI 已统一收敛至同一个常驻后台，并在 macOS 上完成了真实学校会话接管、11 门课程双入口结果对齐、关闭 dev 窗口后后台只读任务照常运行以及重开界面恢复同一账号等实机验收；SDK 测试最终达 178/178，i18n 词条达 7639/7639。详情参见 [统一后台续验](2026-10-25-unified-resident-runtime.md) 与 [实际执行证据](../../output/unified-resident-acceptance/live-result.json)。下文保留首次独立 CLI 验收时的详细记录，早期尚未联调的桌面互通项以续验结果为准，Windows 真机与真实 IM 通道仍待后续实机联调。

## 交付物

- `packages/sdk/`：独立 Node 运行时、学校服务、定时任务、通知投递、IM 通道、插件系统与模型工具循环。
- `packages/cli/`：终端命令入口、独立 daemon、MCP 服务及 macOS/Windows 安装脚本。
- `apps/desktop/src/components/CliTasksSettings.tsx`：桌面端常驻任务管理与本机收件箱界面。
- `plugins/OneTHU-Harness` 子模块：OH 内置 `tasks_query` 与 `tasks_manage` 工具，直接复用宿主 `cli.call` 本机授权，开箱即用，省去手动配置 MCP 的步骤。
- `output/onethu-cli/onethu-cli-0.11.3.tgz` 及同名 `.sha256`：CLI 独立分发包。
- `packages/sdk/artifacts/onethu-sdk-0.11.3.tgz` 及同名 `.sha256`：SDK 独立分发包。
- 安装与使用指南：`packages/cli/README.md`、`README.en.md`；架构说明：`docs/onethu-cli.md`、`docs/en/onethu-cli.md`；SDK 接口说明：包内双语 README。

上述归档包均由当前源码在本地构建生成（产物目录忽略在 Git 之外），复现检查命令如下，精确摘要值记录在各产物同目录的 `.sha256` 文件中。

## 可复现检查

```sh
pnpm build:cli
pnpm --filter @onethu/sdk test
pnpm --filter @onethu/cli test
pnpm test:cli
pnpm --filter @onethu/sdk typecheck
pnpm --filter @onethu/desktop typecheck
pnpm --filter @onethu/cli typecheck
pnpm i18n:handoff
pnpm i18n:check
node packages/sdk/scripts/pack.mjs
node packages/sdk/scripts/test-pack.mjs
```

SDK 测试夹具采用合成学校响应，完整覆盖 InfoHelper 的 SM2 加密、2FA 二次验证、登录回调与网络学堂会话恢复。下载测试执行真实文件写入，逐项核验 SHA-256 哈希、原始字节流、跨分块登录页拦截、中途取消、目标目录边界与最终落盘回滚。独立 runtime 测试则直接加载构建后的真实 bundle，完成服务调用、定时任务触发、收件箱写入、宿主关闭重开与插件 worker 运行，并验证本地授权、MCP 权限、账号切换与策略变更保护。

CLI 测试拉起真实子进程，覆盖命令行参数解析、标准输出格式、错误码、HTTP/stdio 传输、课程归档、macOS 安装器与后台 daemon。其中 daemon 专项测试验证了随机端口鉴权、浏览器 `Origin` 拦截、非 ASCII 令牌容错、调用截止时限、MCP 越权修改配置拦截及优雅退出。随后在仓库外的空白目录对 CLI `.tgz` 执行 `npm install --offline --ignore-scripts`，顺利完成能力目录与运行状态查询，识别出 183 项已登记操作，全程零工作区依赖、零预置会话。

SDK 独立打包脚本在保留工作区源码导出的同时，单独生成自包含的发布目录与 270 份公开及依赖类型声明。在外部空项目中离线安装后，实测 `import`、实例创建、目录枚举以及全部公开子路径在 strict `NodeNext` / `skipLibCheck:false` 下的类型检查均一次通过（含宿主项目已安装 `@types/node` 的场景），使用方开箱即用，无需拉取 workspace 内部包或额外运行编译脚本。

## 最终结果

| 验证 | 结果 |
| --- | --- |
| 独立 SDK 全套测试 | 150/150 |
| CLI 子进程、MCP、归档与 daemon | 63/63 |
| 桌面服务安全边界 | 48/48 |
| 桌面任务集成 | 8/8 |
| Harness core（含 OH 任务工具） | 64/64 |
| Harness MCP 生命周期 | 44/44 |
| 原生下载 | 16/16 |
| SDK / 桌面 TypeScript、CLI 语法 | 通过 |
| 仓库外 CLI 离线安装 | 通过，183 项操作 |
| SDK 离线安装与严格公开类型检查 | 通过，183 项操作、270 份声明 |
| 中英词典与动态键 | 7636/7636，errors 0 |
| Git 与 Harness diff 格式 | 通过 |

本地构建环境为 macOS 与 Node.js 22；产物包声明的最低运行版本为 Node.js 20.18.1，与内置打包的 Cheerio 版本要求保持一致。Windows 平台的实机验证范围见下文说明。

## UI 与国际化

真实的 OneGUI 任务管理组件挂载在隔离的 Vite 夹具环境中，仅将底层状态与学校查询替换为模拟数据。在中英文 1440×1000 桌面视口、英文 430×932 与中文 390×844 手机视口下，逐一实测课程选择、新建任务、编辑保存、暂停恢复、执行历史与本机收件箱点击交互；窄窗布局紧凑无横向溢出，底部确认按钮也可顺畅滚动触达。

验收报告与五张实测截图保存在 `output/cli-task-ui-fixture/QA.md` 同级目录，测试全程在独立夹具中完成，保持生产代码无演示路由且未读取本机真实账号。

中英文词典规模均为 7636/7636，`i18n:check` 零错误，Android 62 项模板保持一致；原有的动态任务状态文案已收敛为静态翻译键分支，并重新生成翻译批次。

## 安全与稳定性修补

- 本机运行配置、账号凭据与自动执行开关仅对本地可信入口开放，与 MCP、IM 及插件工具完全隔离。
- 并发写锁严格由实际获锁的调用方释放；异步等待用户批准返回后，再次核对当前账号与策略是否仍然有效。
- 文件下载落盘、IM 消息发送与插件反向调用宿主时，全程保留初始取消信号与最终提交前的账号代次核验。
- 固定绑定 IM 发件人、所属账号与私聊对象；任务通知通道与具体接收者 ID 绑定，密钥轮换与接收者变更分别独立校验。
- 存储层初始化异常具备清晰的错误处理；宿主关闭时会等待初始化、排队队列与在途 I/O 全部排空，防止进程退出后出现迟到写入。
- 即便遇到存储异常，关闭流程也会确保停用宿主并释放会话锁；自动执行配置唯有成功写入磁盘后才会真正生效。
- 本地下载与对外发送均采用写前记账机制；进程重启后若上一次操作结果未明，则保留审计记录供人工核查，避免重复对外执行。
- 同一个任务管理器内的校园定时巡检按顺序串行触发，防止休眠唤醒瞬间并发打出数十个学校请求；任务暂停或宿主关闭时会立即阻止后续巡检启动。

## 实机边界

独立宿主的学校真机登录、Windows WebView／安装器／文件 ACL／开机自启，以及真实微信、飞书通道与外部模型仍有待实机联调；早先桌面伴随式 CLI 的课程下载实测与本次独立宿主验收各自独立归档。本轮测试全程在本地隔离环境中完成，未提交真实学校预约、发送邮件或 IM 消息、产生模型计费调用或登记新的信任设备。

macOS 登录自启动已在下方本机加载验收中完成真实注册与拉起测试；Windows 自启动留待真机验证。终端独立微信扫码、独立 MadModel 登录、免打扰时段与会话失效去重提醒排入后续规划。目前任务运行失败可在执行历史中直接查看原因，已获授权的常驻任务也可随时通过 CLI 查询与管理。

## 本机更新、加载与常驻验收

2026-10-25，在本地重新执行 `pnpm build:cli`，并通过 `packages/cli/scripts/install-macos.sh` 安装至 `~/.local/share/onethu-cli`（命令行启动器位于 `~/.local/bin/onethu`）。随后运行 `onethu daemon install --confirm`，成功注册当前用户的 LaunchAgent `edu.tsinghua.onethu.cli.1252d4534d22`；`launchctl print` 显示 `state = running`，`onethu daemon status` 返回 `running: true`、版本 `0.11.3`。启动器与 CLI 运行文件均安装在本机内置磁盘上，常驻后台无需依赖源码仓库所在的外置硬盘即可独立运行。

安装完成后，独立 CLI 初始状态为 `authenticated: false`，等待用户在终端运行 `onethu auth login` 登录；验收期间保持桌面凭据独立、自动执行关闭且未新建学校巡检任务。用户登录并创建、批准任务后，后台调度器便会按计划执行巡检；设备休眠、关机或断网期间自动暂停联网任务。

桌面端通过 `pnpm --filter @onethu/desktop tauri:dev` 完成重新编译、签名与 dev wrapper 重启。新版 debug Harness 已原子替换至桌面资源目录，并在应用启动时自动同步到 AppData；构建产物、资源目录副本与已安装副本的 SHA-256 前缀均为 `19cfb6e59cccf058`，内置 `tasks_manage` 工具，并作为新版 dev 应用的子进程正常运行。此时执行 `--desktop status` 返回 `connected: true`、会话 `ready` 与 140 项可用操作，`--desktop tasks list` 返回空数组。

在这一阶段，桌面 OH 与独立 daemon 各自维护独立的账号会话与任务列表：桌面端任务随桌面进程运行，独立 CLI 创建的任务由后台 daemon 承载。执行 `tauri:dev` 会重新编译桌面主程序；若修改了 Harness 源码，需先重新构建并更新 sidecar 资源文件再重启应用，仅刷新前端页面仍会沿用已启动的旧 sidecar 进程。

本机注册登录自启动后，后续在仓库根目录更新独立 CLI 的标准步骤如下：

```sh
pnpm build:cli
onethu daemon uninstall --confirm
bash packages/cli/scripts/install-macos.sh
onethu daemon install --confirm
onethu daemon status
```

整套更新流程完整保留既有的 CLI 数据目录。日常可通过 `onethu daemon stop` 暂停当前后台进程、`onethu daemon start` 手动重新拉起，如需移除开机自启则运行 `onethu daemon uninstall --confirm`。
