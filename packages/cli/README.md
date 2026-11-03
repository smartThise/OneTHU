# OneTHU CLI

[English](README.en.md) · [架构与能力边界](../../docs/onethu-cli.md)

OneTHU CLI 是可独立运行的校园事务助手。命令行负责查询、预约和资料整理，常驻进程负责定时检查、下载与通知，MCP 供其他智能体调用。要求 Node.js 20.18.1 或更新版本，目标平台为 macOS 和 Windows。关闭桌面后，独立进程可以继续工作。

0.11.4 提供独立 CLI 下载；macOS、Windows 桌面安装包内置相同运行时。Android 不包含 Node 常驻后台。

## 构建与安装

```sh
# 仓库根目录
pnpm install --frozen-lockfile
pnpm build:cli
node packages/cli/bin/onethu.mjs --help

# 已取得构建好的包时
npm install --global ./onethu-cli-0.11.4.tgz
```

包内包含 SDK、运行依赖、插件 worker 和许可声明，可离线安装包本身；校园服务仍需联网。源码构建完成后也可运行安装脚本：

```sh
# macOS
bash packages/cli/scripts/install-macos.sh
export PATH="$HOME/.local/bin:$PATH"
```

```powershell
# Windows PowerShell
powershell -NoProfile -ExecutionPolicy Bypass -File .\packages\cli\scripts\install-windows.ps1
```

macOS 默认安装到 `~/.local/share/onethu-cli`，启动器位于 `~/.local/bin`；`ONETHU_CLI_HOME`、`ONETHU_CLI_BIN` 可更改位置。Windows 默认安装到 `%LOCALAPPDATA%\OneTHU\cli`，启动器位于 `%LOCALAPPDATA%\OneTHU\bin`，后者加入用户 PATH；可传 `-Prefix 'D:\Tools\OneTHU'` 或 `-NoPath`。Windows 安装与常驻注册仍待真机验收。

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

登录终端隐藏密码，随后选择学校提供的验证方式并输入验证码。密码留在进程内，不写入持久会话。只有显式 `--trust-device` 才请求学校信任浏览器。无终端脚本可用 `--username ID --password-stdin`；遇到二次验证会清理本轮流程并提示交互式登录。密码不要放入命令行参数。

默认数据目录为 macOS 的 `~/Library/Application Support/OneTHU CLI`、Windows 的 `%LOCALAPPDATA%\OneTHU CLI`；其他平台使用 `$XDG_DATA_HOME/OneTHU CLI`，默认 `~/.local/share/OneTHU CLI`。可以通过 `--data-dir ABS_PATH` 或 `ONETHU_DATA_DIR` 选择隔离目录。

每个目录由一个运行时持有。桌面、OH 与默认 CLI 连接同一个本机后台，共享登录、设备指纹、执行策略、任务和历史；在任一入口登录后，另一入口即可使用。0.11.4-fix-2 起后台为可选安装项，完整版导览与设置可安装/卸载。OH 在应用内直接使用服务，外部 CLI 开关独立控制外部访问。安装后关闭窗口，已批准任务仍可继续执行。`--desktop` 用于需要桌面界面的服务；显式 `--data-dir` 才创建隔离环境。

实际能力以 `commands` 为准，参数以 `schema` 为准。`--args` 和 UTF-8 `--args-file` 都是位置参数 **JSON 数组**，Windows 建议使用参数文件。成功 JSON 写 stdout，安全错误写 stderr；查询不调用模型。服务调用上限 150 秒，`--timeout MS` 可以缩短客户端预算。

## 写操作与自动执行

```sh
onethu cal add --args '["讨论课","2026-10-26","10:00","11:00",{"local":true}]' --confirm
onethu config automatic on --confirm
onethu config automatic off --confirm
onethu config enabled off --confirm
```

默认写操作需本地 CLI 的 `--confirm`。自动执行开启后，CLI、MCP 和已允许的模型工具可在其权限范围内直接执行。MCP、IM 和插件无法自行开启本机开关；参数中伪造 `confirm:true` 也不能升级来源权限。

桌面 OH 的 OneTHU CLI 设置与后台共用执行开关。关闭自动执行撤销尚未提交的相关调用，任务另外受创建时批准的持续范围约束。云同步不传播授权。超时后的远端操作可能已生效，应先查询结果；写入不会因为结果未知而自动重放。

`config enabled off` 暂停整个后台执行入口和常驻任务；`config enabled on --confirm` 恢复入口。桌面与 CLI 的策略变化会互相可见。已批准任务在关闭窗口后继续运行，退出账号或撤销执行授权则停止。

## 常驻检查、下载与提醒

```sh
onethu daemon start
onethu daemon status
onethu tasks channels
```

创建 `watch.json`，填入真实课程 ID：

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

检查会对比课件、公告、作业资源与截止时间；没有变化时保持安静。首次检查建立基线并报告发现的项目。模板增加 `"outputDir":"/absolute/existing/directory"` 后下载已登记附件，请先创建目录；Windows 示例为 `"D:\\学习\\课程资料"`。课程、目录和通知对象共同构成持续授权，修改任务需重新批准。

支持三种调度：

```json
{"kind":"interval","everyMinutes":30}
{"kind":"daily","time":"20:00","timezone":"Asia/Shanghai"}
{"kind":"once","runAt":"2026-10-26T12:00:00Z"}
```

其他只读服务可用 `{"kind":"operation","operation":"info.schedule","args":[],"channels":["inbox"]}`。定时预约、发信等通用写入不接受此模板。检查使用确定性逻辑，无需模型费用。

`tasks.update` 参数为 `["TASK_ID",完整任务定义]`，`tasks.remove` 为 `["TASK_ID"]`，均需批准。删除保留已下载文件，暂停会取消当前任务和下载。最多 50 项任务，每项保留 30 次执行；一轮最多下载 100 项。重启补查一次错过的周期。只读步骤有限重试；结果未知的外发保留记录供检查。

```sh
onethu daemon stop
# 为当前用户注册登录系统时启动
onethu daemon install --confirm
onethu daemon uninstall --confirm
```

桌面默认包移出 Node/CLI，设置可安装包含 Node 的独立平台 ZIP。终端用户解压 ZIP 后使用 `./onethu` 或 `.\onethu.cmd`，启动器核验并加载自带 Node。源码/npm 入口需要已有 Node.js。首次接入移交现有会话、日程/邮箱和任务，卸载保留账号与数据。macOS 使用 LaunchAgent，Windows 使用当前用户计划任务。睡眠、关机或离线期间不能检查。前台排障用 `onethu daemon serve`；`stop` 停止当前进程，自启动项由 `uninstall` 单独移除。

macOS 再次运行 `daemon install --confirm` 可更新本 CLI/profile 的旧自启动项，优先使用桌面附带的 Node。更新会保留正在执行的任务，新启动路径在下次系统登录时生效；命令结果会显示 `reloadRequired`。

## 通知和 IM

本机收件箱 `inbox` 默认可用，飞书、微信与 HTTPS webhook 需要配置。凭据参数文件应保存在私有路径，配置后妥善移除临时副本。

飞书单向通知的参数文件：

```json
["feishu",{"appId":"APP_ID","appSecret":"APP_SECRET","chatId":"CHAT_ID"}]
```

```sh
onethu notifications configure --args-file ./private-feishu.json --confirm
onethu tasks channels
```

将 `tasks.channels` 返回的绑定 ID 填入任务 `channels`。更换接收者后旧 ID 失效，需要更新任务批准新对象。微信出站需已有 iLink 的 `botToken`、`userId`、`contextToken`；上下文失效时需要绑定人发来新消息。

双向飞书配置文件：

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

持续接收前先运行 `onethu daemon start`。短期 CLI 命令退出时会关闭自己持有的 IM 网关；已独立启动的 daemon 会继续运行。

只处理已绑定人的私聊文本。`/status`、`/tasks` 查询；`/pause TASK_ID`、`/resume TASK_ID`、`/check TASK_ID` 管理任务，后者需要本机自动执行授权。自然语言交给已配置模型。群聊、陌生人、媒体消息暂不接入。

微信双向配置为 `credentials:{botToken,baseUrl?,contextToken?}` 和 `binding:{account,senderId}`；独立配置使用已有绑定凭据；桌面已绑定通道会同步任务通知凭据与接收者，微信需先收到该接收者的有效消息上下文。目前独立 CLI 未提供二维码登录。`im.stop` 暂停本进程接收，daemon 重启恢复已配置账号的通道；`im.remove --args '["feishu"]' --confirm` 永久移除绑定。

成功发送表示平台接受，不等于对方已读。结果未知的外发不会自动重复。IM 事件先持久记录再处理，重连与重启不重复执行已经接收的指令。

## 自然语言助手

`agent.configure` 支持 OpenAI 兼容 API，以及本机 HTTP 模型。配置文件示例：

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

省略 `allowedOperations` 时模型只有只读工具。允许写工具和本机自动执行共同决定能否创建任务。用户文本与所用课程数据会发送到选定模型；API Key 保存于本机私有文件，采用文件权限保护，未额外加密。

默认最多 6 轮模型、12 次工具、120 秒。会话按学校账号和聊天对象隔离，仅保留最近 20 条用户/助手文本及简短工具状态，不保存原始工具正文。独立 CLI 尚未内置 MadModel 登录；SDK 可注入 provider，桌面 OH 保留原路径。

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

归档保存 JSON/Markdown 与原始附件，课程目录带稳定标识，已有笔记保留。作业详情通过只读页获取，包含教师及本人提交附件。`complete` 描述当前请求，`enumerationComplete` 描述来源枚举范围；作业全量边界尚不确定，可能在保留已取得内容的同时返回退出码 5。附件失败逐项记录；取消清理半成品，暂无断点续传。

插件可安装本地目录或 ZIP，静态检查后默认禁用。支持 JS worker、Rust JSON-RPC，启用会执行受信本地代码。子进程用于隔离生命周期，不构成操作系统沙箱。GUI/WASM 专属插件会明确报告不兼容。安装/配置是本地操作，模型无法自行安装。

## MCP 与桌面模式

```json
{"mcpServers":{"onethu":{"command":"node","args":["/absolute/path/to/cli/bin/onethu.mjs","mcp"]}}}
```

独立 MCP 提供 `onethu_commands`、`onethu_call`；调用参数如 `{"operation":"learn.courses","args":[]}`。先登录、启动 daemon，其他智能体即可共享该运行时。MCP 退出不会关闭独立启动的 daemon；临时 MCP 自己持有的运行时随退出关闭。

```sh
onethu --desktop status
onethu --desktop learn courses
onethu --desktop mcp
```

新版桌面需打开 Harness、OneTHU CLI 和智能体授权。桌面采用固定回环端口，独立 daemon 使用私有令牌和随机端口，各自持有配置。`--endpoint http://127.0.0.1:8787` / `ONETHU_ENDPOINT` 同样明确选择桌面模式。

## 验收与边界

```sh
pnpm test:sdk
pnpm --filter @onethu/cli test
pnpm test:cli
```

夹具覆盖登录/2FA、稳定设备指纹、真实 CLI 子进程、任务持久化、取消、IM 的 HTTP/WebSocket 协议、模型工具循环与权限。macOS 已隔离验证 daemon 和安装器；独立学校真实登录、Windows ACL/自启动、真实 IM/模型联调尚待验收。本轮未提交真实预约、邮件或 IM 消息。

邮箱、CalDAV、云盘、外部作业按独立配置接入。`memory.*` 只读取独立账号目录中的 Markdown；桌面资料不隐式复制。画布、标签跳转保留 GUI，报备提交和体育场馆实际预约保留官方交互。定时任务暂未提供免打扰时段与专门的会话失效通知去重，失效记录在任务历史。

[项目许可](LICENSE) 包含附加条款；依赖许可随 `dist/sdk/THIRD_PARTY_NOTICES.txt` 分发。
