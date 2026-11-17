# OneTHU CLI

[English](README.en.md) · [架构与能力边界](../../docs/onethu-cli.md)

OneTHU CLI 是可独立运行的校园事务助手：命令行覆盖查询、预约与资料整理，后台常驻进程负责定时检查、附件下载与消息提醒，同时支持通过 MCP 供外部智能体接入调用。运行环境要求 Node.js 20.19.x 或 22.12+（推荐 Node.js 22 LTS），面向 macOS 与 Windows 平台；关闭桌面客户端后，后台常驻进程仍可独立运行。

0.11.4 提供独立 CLI 下载包，macOS 与 Windows 端共用同一套运行时架构（Android 端仅作为移动客户端运行，无本地 Node 常驻后台）。

## 构建与安装

```sh
# 仓库根目录
pnpm install --frozen-lockfile
pnpm build:cli
node packages/cli/bin/onethu.mjs --help

# 已取得构建好的包时
npm install --global ./onethu-cli-0.11.4.tgz
```

安装包已内置 SDK、运行依赖、插件 worker 与第三方许可声明，支持离线完成安装；调用各项校园服务时正常联网即可。从源码构建完成后，也可以直接执行平台安装脚本：

```sh
# macOS
bash packages/cli/scripts/install-macos.sh
export PATH="$HOME/.local/bin:$PATH"
```

```powershell
# Windows PowerShell
powershell -NoProfile -ExecutionPolicy Bypass -File .\packages\cli\scripts\install-windows.ps1
```

macOS 默认安装至 `~/.local/share/onethu-cli`，启动器位于 `~/.local/bin`（可通过 `ONETHU_CLI_HOME` 与 `ONETHU_CLI_BIN` 自定义路径）。Windows 默认安装至 `%LOCALAPPDATA%\OneTHU\cli`，启动器位于 `%LOCALAPPDATA%\OneTHU\bin` 并自动写入当前用户 PATH；也可传入 `-Prefix 'D:\Tools\OneTHU'` 更改安装目录，或传入 `-NoPath` 跳过环境变量修改。Windows 安装脚本与自启动注册将在 Windows 真机上完成最终验收。

## 登录与调用

```sh
onethu auth login
onethu auth status
onethu commands
onethu commands learn
onethu schema learn.courses
onethu learn courses
onethu learn homework --args '["COURSE_ID"]'
onethu library records
onethu auth logout --confirm
```

终端登录时会隐藏密码输入，随后引导选择学校提供的验证方式并填写验证码。密码仅在登录期间驻留于当前进程内存，持久化会话只保存 Cookie 与设备标识；显式传入 `--trust-device` 时才会向学校申请信任浏览器。无交互终端的脚本可使用 `--username ID --password-stdin` 传入凭据（请勿在命令行参数中明文写入密码）；若遇到二次验证，CLI 会结束本轮非交互流程并提示改用交互式终端登录。

默认数据目录在 macOS 上为 `~/Library/Application Support/OneTHU CLI`，在 Windows 上为 `%LOCALAPPDATA%\OneTHU CLI`，其他平台依次读取 `$XDG_DATA_HOME/OneTHU CLI` 与 `~/.local/share/OneTHU CLI`。如需隔离运行环境，可通过 `--data-dir ABS_PATH` 或 `ONETHU_DATA_DIR` 指定独立目录。

每个数据目录由单个活动运行时持有。桌面端、OH 与默认 CLI 连接同一个本机后台，共享登录态、设备指纹、执行策略、定时任务与执行历史，在任意入口登录后即可跨入口直接使用。自 0.11.4-fix-2 起，后台组件改为按需安装项，可在完整版引导流程或设置页中一键安装与卸载；应用内 OH 直接调用本地服务，外部 CLI 开关则单独管理外部命令行接入。安装后台组件后，即便关闭应用窗口，已批准的常驻任务也会继续运行。需要调用依赖桌面图形界面的能力时可传入 `--desktop`，需要隔离账号目录时则显式传入 `--data-dir`。

当前支持的操作列表可通过 `commands` 查询，参数定义可通过 `schema` 查看。`--args` 与 UTF-8 编码的 `--args-file` 均接收位置参数组成的 **JSON 数组**（在 Windows 终端下推荐使用参数文件以避免引号转义问题）。常规查询直接请求校园接口，零模型调用开销；成功时将 JSON 写入 stdout，脱敏后的错误信息写入 stderr。单次服务调用硬上限为 150 秒，可通过 `--timeout MS` 缩短客户端等待预算。

## 写操作与自动执行

```sh
onethu cal add --args '["讨论课","2026-10-26","10:00","11:00",{"local":true}]' --confirm
onethu config automatic on --confirm
onethu config automatic off --confirm
onethu config enabled off --confirm
```

写操作默认要求通过本机 CLI 传入 `--confirm` 确认。开启自动执行后，CLI、MCP 客户端与已放行的模型工具可在各自权限范围内直接执行操作。自动执行开关与本地确认特权仅限本机 CLI 或桌面界面操作；来自 MCP、IM 与插件的请求即便在参数中携带 `confirm:true`，也始终遵循本机当前策略。

桌面端 OH 的 OneTHU CLI 设置与后台共用同一套本机执行策略（授权仅保存在当前设备本地，与云端同步隔离）。关闭自动执行会取消尚未提交的写入调用，常驻任务则继续遵循创建时获批的授权范围。若写请求发生网络超时，上游服务可能已经处理完成，系统会保留现场供先查询最新状态，避免盲目自动重放造成重复提交。

执行 `config enabled off` 会一并暂停后台执行入口与常驻任务，执行 `config enabled on --confirm` 即可恢复。桌面端与 CLI 对策略的变更实时同步可见；关闭桌面窗口后已批准的任务会继续运行，退出登录或撤销执行授权则会将其停止。

## 常驻检查、下载与提醒

```sh
onethu daemon start
onethu daemon status
onethu tasks channels
```

创建 `watch.json` 并填入真实课程 ID：

```json
[{
  "name":"课程资料与截止提醒",
  "schedule":{"kind":"interval","everyMinutes":30},
  "template":{
    "kind":"school-watch",
    "courseIds":["COURSE_ID"],
    "channels":["inbox"],
    "remindBeforeHours":[24,1]
  }
}]
```

```sh
onethu tasks create --args-file ./watch.json --confirm
onethu tasks list
onethu tasks run --args '["TASK_ID"]' --confirm
onethu tasks history --args '["TASK_ID"]'
onethu notifications inbox
onethu tasks pause --args '["TASK_ID"]' --confirm
onethu tasks resume --args '["TASK_ID"]' --confirm
```

每次检查会自动比对课件、公告、作业附件与截止时间，无新增或变动时保持静默；首次运行会建立基线并汇总已有条目。在模板中加入 `"outputDir":"/absolute/existing/directory"` 即可将已登记附件自动下载至指定目录（请提前创建好目标文件夹，Windows 路径示例为 `"D:\\学习\\课程资料"`）。所选课程、输出目录与通知渠道共同构成该任务的持续授权范围，后续修改任务定义时需重新确认批准。

支持以下三种调度方式：

```json
{"kind":"interval","everyMinutes":30}
{"kind":"daily","time":"20:00","timezone":"Asia/Shanghai"}
{"kind":"once","runAt":"2026-10-26T12:00:00Z"}
```

其他只读服务可通过 `{"kind":"operation","operation":"info.schedule","args":[],"channels":["inbox"]}` 模板配置定时拉取（定时模板专用于只读查询，场馆预约、发信等写操作仍通过即时交互完成）。所有定时检查均基于本地确定性比对逻辑运行，无任何大模型调用费用。

`tasks.update` 接收 `["TASK_ID",完整任务定义]`，`tasks.remove` 接收 `["TASK_ID"]`，两者均需本机确认。删除任务会保留磁盘上已下载的文件，暂停任务则会中止正在进行的检查与下载。单个数据目录最多支持 50 项任务，每项保留最近 30 次执行记录，单轮最多下载 100 个文件；进程重启后会自动补查一次错过的调度周期。只读请求具备有界重试机制，发送状态未明的外发通知则会保留记录以便核查。

```sh
onethu daemon stop
# 为当前用户注册登录系统时启动
onethu daemon install --confirm
onethu daemon uninstall --confirm
```

桌面标准安装包默认精简了 Node 与 CLI 体积，可在设置页按需安装内置 Node 的独立平台 ZIP 包：解压后直接运行 `./onethu`（macOS）或 `.\onethu.cmd`（Windows），启动器会自动校验并加载自带的 Node 运行时（从源码或 npm 运行则使用系统已安装的 Node.js）。首次接入时会自动承接现有会话、日程/邮箱配置与定时任务，卸载时也会完整保留账号与历史数据。系统登录自启动在 macOS 上通过 LaunchAgent 注册，在 Windows 上通过当前用户计划任务注册，电脑处于唤醒且联网状态时按计划执行检查。排障时可执行 `onethu daemon serve` 在前台运行；`stop` 用于停止当前守护进程，`uninstall` 则单独移除开机自启动项。

在 macOS 上重新运行 `daemon install --confirm` 可更新当前 CLI/profile 已有的自启动配置，并优先切换至桌面端附带的 Node 运行时；正在执行的任务会平滑保持运行，新的启动路径将在下次登录系统时生效（命令返回结果中会以 `reloadRequired` 标记提示）。

## 通知和 IM

本机收件箱 `inbox` 开箱即用，飞书、微信与 HTTPS webhook 渠道可在配置凭据后启用。包含密钥的参数文件请妥善存放在本机私有目录，完成配置后及时清理临时副本。

飞书单向通知参数文件示例：

```json
["feishu",{"appId":"APP_ID","appSecret":"APP_SECRET","chatId":"CHAT_ID"}]
```

```sh
onethu notifications configure --args-file ./private-feishu.json --confirm
onethu tasks channels
```

将 `tasks.channels` 返回的绑定 ID 填入任务的 `channels` 列表即可生效。更换接收对象后原绑定 ID 随即失效，需同步更新任务以重新批准新目标。微信出站通知依赖已有的 iLink `botToken`、`userId` 与 `contextToken`；当会话上下文过期时，由绑定人在微信端发送一条新消息即可刷新。

双向飞书交互配置文件示例：

```json
["feishu",{
  "credentials":{"appId":"APP_ID","appSecret":"APP_SECRET"},
  "binding":{"account":"UNIVERSITY_ACCOUNT","senderId":"OPEN_ID","chatId":"CHAT_ID"}
}]
```

```sh
onethu im configure --args-file ./private-im.json --confirm
onethu im start --confirm
onethu im status
```

启用持续消息接收前请先执行 `onethu daemon start`。单次运行的临时 CLI 命令在退出时会一并关闭由它拉起的 IM 网关，而已独立启动的 daemon 则会持续保持在线。

IM 通道仅响应已绑定发送人的私聊文本消息（自动忽略群聊、陌生人消息与多媒体附件）：发送 `/status`、`/tasks` 可查询状态；发送 `/pause TASK_ID`、`/resume TASK_ID`、`/check TASK_ID` 可管理任务（需开启本机自动执行授权）；发送日常自然语言则会交由已配置的大模型处理。

微信双向接入使用 `credentials:{botToken,baseUrl?,contextToken?}` 与 `binding:{account,senderId}`，直接复用已有绑定凭据（扫码登录入口位于桌面端应用内）；桌面端已绑定的通道会自动同步任务通知凭据与接收人，微信渠道在收到该接收人发来的有效消息上下文后即可回复。执行 `im.stop` 可暂停当前进程的消息接收，重启 daemon 后会自动恢复当前账号已配置的通道；执行 `im.remove --args '["feishu"]' --confirm` 则永久移除对应绑定。

发送成功代表平台已接收该条消息；若遇到网络异常导致送达状态未知，系统会记录留档供排查，避免自动重复发送。所有入站 IM 事件均先落盘记录再进入执行流程，断线重连或进程重启后每条指令只会执行一次。

## 自然语言助手

`agent.configure` 支持接入 OpenAI 兼容 API 与本机 HTTP 模型服务。配置文件示例：

```json
[{
  "baseUrl":"https://your-provider.example/v1",
  "apiKey":"YOUR_KEY",
  "model":"YOUR_MODEL",
  "language":"zh-CN",
  "allowedOperations":["learn.courses","learn.homework","tasks.channels","tasks.list","tasks.create","tasks.update","tasks.pause","tasks.resume","tasks.history"]
}]
```

```sh
onethu agent configure --args-file ./private-model.json --confirm
onethu config automatic on --confirm
onethu agent run --args '["每30分钟检查这门课的作业，提前24小时提醒。先查看课程列表，和我确定是哪门课。"]'
```

省略 `allowedOperations` 时，模型仅可使用只读查询工具；若希望助手协助创建或调整定时任务，需同时开放相应写工具并开启本机自动执行。用户提问及回答所需的课程数据会发送至所选模型服务端，API Key 则以明文保存在受系统文件权限保护的本机私有目录中。

单次运行默认上限为 6 轮模型对话、12 次工具调用与 120 秒总时长。会话记忆按学校账号与聊天对象隔离，仅保留最近 20 条用户/助手文本与简短的工具状态摘要，省略原始工具返回体。MadModel 登录由桌面端 OH 原生提供（SDK 亦支持注入自定义 provider），独立 CLI 则直接连接 OpenAI 兼容接口与本地 HTTP 模型。

## 资料归档与插件

```sh
# 只读规划
onethu learn export --output '/Users/me/Documents/课程资料'
# 正文、附件与 SHA-256 记录
onethu learn export --course COURSE_ID --output '/Users/me/Documents/课程资料' --confirm

onethu plugins inspect --args '["/absolute/plugin-directory"]'
onethu plugins install --args '["/absolute/plugin-directory"]' --confirm
onethu plugins enable --args '["PLUGIN_ID"]' --confirm
onethu plugins commands --args '["PLUGIN_ID"]'
```

课程归档会将正文整理为 JSON/Markdown 并下载原始附件，课程文件夹采用稳定标识命名，目录内已有的个人笔记会原样保留。作业详情通过只读页面采集，同时涵盖教师发布的附件与本人已提交的作业附件。返回报告中 `complete` 表示当次归档请求是否全部执行完毕，`enumerationComplete` 表示上游列表枚举是否完整；若部分历史作业枚举范围仍待上游确认，命令会在完整保留已抓取内容的同时返回退出码 5。下载失败的附件会逐项记录在清单中，中途取消时会自动清理未写完的临时文件（当前按整文件重下，暂未提供断点续传）。

插件支持从本地目录或 ZIP 压缩包安装，完成静态检查后默认处于禁用状态。CLI 支持 JS worker 与 Rust JSON-RPC 两类插件，通过子进程隔离管理插件生命周期；启用后插件将以当前系统用户权限运行受信本地代码，请仅安装并启用经过审阅的本地插件。面向桌面界面的 GUI/WASM 专属插件在 CLI 下会明确提示环境受限；插件的安装与配置均须由本机直接确认，对大模型工具保持关闭。

## MCP 与桌面模式

```json
{"mcpServers":{"onethu":{"command":"node","args":["/absolute/path/to/cli/bin/onethu.mjs","mcp"]}}}
```

独立 MCP 服务提供 `onethu_commands` 与 `onethu_call` 两个工具（调用参数形如 `{"operation":"learn.courses","args":[]}`）。提前完成登录并运行 `onethu daemon start` 后，外部智能体即可共享同一个后台运行时；MCP 客户端退出后，独立启动的 daemon 会继续常驻运行，而由临时 MCP 进程自行拉起的运行时则会随该进程一并退出。

```sh
onethu --desktop status
onethu --desktop learn courses
onethu --desktop mcp
```

连接新版桌面端时，请先在应用内开启 Harness、OneTHU CLI 与智能体服务授权。桌面模式通过固定本机回环端口通信，独立 daemon 则使用随机端口与私有令牌，两端各自维护独立配置；传入 `--endpoint http://127.0.0.1:8787` 或设置 `ONETHU_ENDPOINT` 同样会显式切换至桌面模式。

## 验收与边界

```sh
pnpm test:sdk
pnpm --filter @onethu/cli test
pnpm test:cli
```

自动化测试通过本地夹具覆盖了登录与二次验证、稳定设备指纹、真实 CLI 子进程、任务持久化与取消、IM 的 HTTP/WebSocket 协议，以及模型工具循环与权限校验（全程在本地模拟环境中运行，零真实预约、发信或外发消息）。macOS 端已在隔离环境中完成 daemon 与安装脚本验证；真实校园账号独立登录、Windows ACL 文件权限与开机自启动，以及真实 IM 与模型端到端联调将在后续真机验收中完成。

邮箱、CalDAV、云盘与外部作业源在独立数据目录内各自单独配置，`memory.*` 直接读取当前独立账号目录下的 Markdown 笔记，与桌面端资料相互独立。白板画布操作与标签页跳转由桌面 GUI 承载，进出校报备提交与体育场馆下单则沿用学校官方交互流程。定时任务在会话过期或检查失败时会写入任务历史记录（免打扰时段与会话失效通知合并将在后续补充）。

使用前请参阅 [项目许可](LICENSE) 中的完整授权与附加条款；第三方依赖许可说明随 `dist/sdk/THIRD_PARTY_NOTICES.txt` 一并分发。
