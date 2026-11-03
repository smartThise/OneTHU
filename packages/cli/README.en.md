# OneTHU CLI

[简体中文](README.md) · [Architecture and capability boundaries](../../docs/en/onethu-cli.md)

OneTHU CLI is an independently running assistant for campus tasks. The command line handles queries, bookings and course archives; a resident process handles scheduled checks, downloads and notifications. MCP makes these services available to other agents. It requires **Node.js 20.18.1 or later** and targets macOS and Windows. The independent process can continue working after the desktop app closes.

Version 0.11.4 provides a standalone CLI download and bundles the same runtime with the macOS and Windows apps. Android does not include a resident Node backend.

## Build and install

```sh
# From the repository root
pnpm install --frozen-lockfile
pnpm build:cli
node packages/cli/bin/onethu.mjs --help

# If you already have the built package
npm install --global ./onethu-cli-0.11.4.tgz
```

The built package contains the SDK, runtime dependencies, plugin worker and license notices. The package itself can be installed offline; campus services still require network access. After building from source, you can also use the installation scripts:

```sh
# macOS
bash packages/cli/scripts/install-macos.sh
export PATH="$HOME/.local/bin:$PATH"
```

```powershell
# Windows PowerShell
powershell -NoProfile -ExecutionPolicy Bypass -File .\packages\cli\scripts\install-windows.ps1
```

On macOS, the default installation directory is `~/.local/share/onethu-cli`, with a launcher in `~/.local/bin`. Use `ONETHU_CLI_HOME` and `ONETHU_CLI_BIN` to change these paths. On Windows, the package goes in `%LOCALAPPDATA%\OneTHU\cli` and the launcher in `%LOCALAPPDATA%\OneTHU\bin`; the latter is added to your user PATH. Open a new terminal to pick up the PATH change. Use `-Prefix 'D:\Tools\OneTHU'` to change the location, or `-NoPath` to leave PATH unchanged. Windows installation and autostart registration still require testing on a Windows device.

## Sign in and call services

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

The login prompt hides your password, then lets you select a university verification method and enter its code. The password stays in process memory and is excluded from the saved session. Only an explicit `--trust-device` requests a trusted browser from the university. Scripts without an interactive terminal can use `--username ID --password-stdin`. If two-factor verification is required, the CLI cancels that attempt and asks you to sign in interactively. Keep passwords out of command-line arguments.

Default data directories are `~/Library/Application Support/OneTHU CLI` on macOS and `%LOCALAPPDATA%\OneTHU CLI` on Windows. Other platforms use `$XDG_DATA_HOME/OneTHU CLI`, falling back to `~/.local/share/OneTHU CLI`. Use `--data-dir ABS_PATH` or `ONETHU_DATA_DIR` to select an isolated directory.

One resident runtime owns each data directory. The desktop app, OH and the default CLI share its session, device identity, execution policy, tasks and history. Signing in through either interface makes the same account available to the other. The desktop can install the optional background component; approved tasks then continue after the app closes. OH in-app services work independently of external CLI access. Use `--desktop` for services requiring the graphical app, or an explicit `--data-dir` for an isolated profile.

Use `commands` for the current capability catalog and `schema` for argument definitions. Both `--args` and UTF-8 `--args-file` accept positional **JSON arrays**. Argument files are especially useful on Windows. Successful JSON goes to stdout; safe errors go to stderr. Queries do not call a model. Service calls have a 150-second upper bound; `--timeout MS` can shorten the client budget. Its default is 120000 ms, with an accepted range of 1–600000 ms; a larger value does not lift the service limit. `ONETHU_TIMEOUT_MS` sets the same client option.

`--json` explicitly selects the default structured output. Help and version output are text. An incomplete `learn export` preserves its JSON report on stdout, writes a short error on stderr and exits with code 5. For other errors, inspect `error.code` on stderr: transport and operation exit-code categories differ between independent and desktop hosts.

## Writes and automatic execution

```sh
onethu cal add --args '["Study discussion","2026-10-26","10:00","11:00",{"local":true}]' --confirm
onethu config automatic on --confirm
onethu config automatic off --confirm
onethu config enabled off --confirm
```

By default, writes require `--confirm` from the local CLI. Once automatic execution is enabled, CLI, MCP and allowed model tools can perform operations within their permissions. MCP, IM and plugins cannot enable this local switch themselves. A `confirm:true` property in their arguments does not grant local-source privileges.

The desktop OH settings control the same OneTHU CLI execution policy as the background runtime. Turning automatic execution off invalidates relevant calls that have not yet been submitted; persistent tasks also follow the continuing scope approved when they were created. Cloud sync does not propagate authorization. A remote action may already have taken effect when a timeout occurs, so query its state before trying again. An unknown write result never triggers automatic replay.

`config enabled off` pauses the execution entry point and resident tasks; `config enabled on --confirm` restores it. Policy changes are visible in the desktop and CLI. Closing the window preserves approved tasks, while signing out or revoking execution authorization stops them.

## Scheduled checks, downloads and reminders

```sh
onethu daemon start
onethu daemon status
onethu tasks channels
```

Create `watch.json` with a real course ID:

```json
[{
  "name":"Course materials and deadline reminders",
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

Checks compare course files, announcements, assignments and deadlines, remaining quiet when nothing changes. The first check establishes a baseline and reports the items it finds. Add `"outputDir":"/absolute/existing/directory"` to the template to download registered attachments. Create that directory first; on Windows, an example is `"D:\\Study\\Course Archive"`. Courses, the output directory and notification destinations form the continuing authorization scope. Updating a task requires renewed approval.

Three schedule types are supported:

```json
{"kind":"interval","everyMinutes":30}
{"kind":"daily","time":"20:00","timezone":"Asia/Shanghai"}
{"kind":"once","runAt":"2026-10-26T12:00:00Z"}
```

Other read-only services can use `{"kind":"operation","operation":"info.schedule","args":[],"channels":["inbox"]}`. This template does not accept general scheduled writes such as bookings or email sends. Checks use deterministic logic and incur no model usage.

`tasks.update` takes `["TASK_ID", completeTaskDefinition]`; `tasks.remove` takes `["TASK_ID"]`. Both require approval. Removing a task preserves downloaded files. Pausing cancels the current task and its downloads. Each independent data directory supports up to 50 tasks, with 30 execution records per task and at most 100 download attempts per run. Restarting performs one catch-up check for a missed period. Read steps have bounded retries; unknown outbound results retain records for inspection.

```sh
onethu daemon stop
# Register startup when the current user signs in to the operating system
onethu daemon install --confirm
onethu daemon uninstall --confirm
```

Desktop app packages omit Node/CLI. The optional platform ZIP includes Node; first connection transfers existing session, calendar and task records. Source/npm entry points need an installed Node.js runtime. macOS uses a user LaunchAgent; Windows uses a scheduled task for the current user. Checks cannot run while the computer is asleep, shut down or offline. Use `onethu daemon serve` for foreground troubleshooting. `stop` stops the current process; `uninstall` separately removes its autostart registration.

On macOS, running `daemon install --confirm` again can update this CLI/profile's existing autostart entry and select the bundled Node. Running tasks continue; the new launch path applies at the next operating-system login, as indicated by `reloadRequired` in the result.

## Notifications and IM

The local `inbox` is available by default. Feishu, WeChat and HTTPS webhook destinations require configuration. Keep credential argument files in private locations and remove temporary copies appropriately after configuration.

Argument file for one-way Feishu notifications:

```json
["feishu",{"appId":"APP_ID","appSecret":"APP_SECRET","chatId":"CHAT_ID"}]
```

```sh
onethu notifications configure --args-file ./private-feishu.json --confirm
onethu tasks channels
```

Put the binding ID returned by `tasks.channels` in the task's `channels` list. Replacing the recipient invalidates the old ID; update the task to approve the new destination. External binding IDs also bind the Feishu application or webhook URL. Rotating credentials preserves the binding. Outbound WeChat requires an existing iLink `botToken`, `userId` and `contextToken`; when its context expires, the bound person needs to send a new message through the configured inbound gateway, or the context must be explicitly refreshed.

Configuration file for two-way Feishu messaging:

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

Run `onethu daemon start` before enabling continuous reception. A temporary CLI command closes the IM gateway it owns when it exits; a separately started daemon keeps running.

Only private text messages from the bound person are processed. `/status` and `/tasks` query state. `/pause TASK_ID`, `/resume TASK_ID` and `/check TASK_ID` manage tasks; these mutations require local automatic-execution authorization. Natural language goes to the configured model. Group chats, unknown senders and media messages are currently excluded.

Two-way WeChat uses `credentials:{botToken,baseUrl?,contextToken?}` and `binding:{account,senderId}`. The independent CLI uses existing binding credentials and currently has no QR-code login. `im.stop` pauses reception in the current process; restarting the daemon restores channels configured for its current account. `im.remove --args '["feishu"]' --confirm` permanently removes the binding.

Desktop task notifications transfer their outbound credentials and recipient binding through the private bridge. WeChat requires a valid message context from that recipient. Existing desktop inbound reception retains its current owner, so migration does not create a second inbound poller.

A successful send means the platform accepted the message, without proving that the recipient read it. Unknown deliveries are not automatically repeated. IM events are recorded durably before processing, so reconnecting or restarting does not re-execute an already received command.

## Natural-language assistant

`agent.configure` supports OpenAI-compatible APIs and local HTTP models. Example configuration file:

```json
[{
  "baseUrl":"https://your-provider.example/v1",
  "apiKey":"YOUR_KEY",
  "model":"YOUR_MODEL",
  "language":"en-US",
  "allowedOperations":["learn.courses","learn.homework","tasks.channels","tasks.list","tasks.create","tasks.update","tasks.pause","tasks.resume","tasks.history"]
}]
```

```sh
onethu agent configure --args-file ./private-model.json --confirm
onethu config automatic on --confirm
onethu agent run --args '["Check assignments for this course every 30 minutes and remind me 24 hours before each deadline. First list my courses and confirm which one I mean."]'
```

When `allowedOperations` is omitted, the model receives only read tools. Creating tasks requires both exposure of the relevant write tools and local automatic-execution authorization. User text and course data used in the answer are sent to the selected provider. API keys are stored in private local files protected by filesystem permissions, without additional encryption. Remote model endpoints require HTTPS; HTTP is allowed for loopback models. Redirects are refused.

Defaults are at most 6 model turns, 12 tool calls and 120 seconds. Sessions are isolated by university account and conversation identity. Memory retains the last 20 user/assistant text messages with brief tool statuses, excluding raw tool bodies. Independent CLI login to MadModel is not built in; the SDK accepts an injected provider, while desktop OH retains its existing path.

## Course archives and plugins

```sh
# Read-only planning
onethu learn export --output '/Users/me/Documents/Course Archive'
# Bodies, attachments and SHA-256 records
onethu learn export --course COURSE_ID --output '/Users/me/Documents/Course Archive' --confirm

onethu plugins inspect --args '["/absolute/plugin-directory"]'
onethu plugins install --args '["/absolute/plugin-directory"]' --confirm
onethu plugins enable --args '["PLUGIN_ID"]' --confirm
onethu plugins commands --args '["PLUGIN_ID"]'
```

Exports save JSON/Markdown and original attachments in course directories with stable identifiers, preserving existing notes. Assignment details use read-only pages and include teacher attachments and your submitted attachments. `complete` describes the current request; `enumerationComplete` describes the source enumeration scope. The full homework enumeration boundary remains uncertain, so the command can preserve all content it obtained while returning exit code 5. Attachment failures are recorded individually. Cancellation cleans up unfinished files; byte-range resume is currently unavailable.

The default export is read-only planning: it reads course/resource lists and prints a JSON plan without creating files, directories or downloads. The semester defaults to the server's current semester. `--semester ID` selects another one, and `--course ID` selects a course within it. Obtain IDs with `onethu learn courses`. `--dry-run` takes precedence over `--confirm`.

Each course is split into download batches of at most 500 references. Independent mode uses the local `--confirm`; desktop mode also asks for approval inside OneTHU for each batch. Failed or timed-out write batches are not automatically retried. A batch shares one request deadline. Its report records `timedOut`, `downloadBatches[].remaining` and `remainingResourceRefs`; later batches stop when a batch is incomplete. A later, separately confirmed export verifies successful local files before skipping them.

Each course directory retains the official course name and a short stable digest of the semester/course IDs. `.onethu-export/<run-id>/` contains `content.json` with source HTML and metadata, `content.md` with readable text, and `manifest.json` with references, paths, SHA-256, sizes and failures. The root also gets a uniquely named `onethu-export-<run-id>.json` and `.md` summary. Original HTML is kept as data, without executing it or loading remote images in the Markdown conversion.

Reuse requires matching resource references, metadata, actual file size and SHA-256. Missing, modified or corrupt files are downloaded under a fresh name, preserving existing content. This verifies local integrity: if the school replaces a file under the same ID without changing returned metadata, a saved manifest cannot detect that remote change. Choose a new output directory when you need to retrieve it again.

Paths follow Windows filename rules while retaining Unicode names. Symlinks and directory junctions are refused in the output path and reused files. On macOS, `/tmp` and `/var` commonly resolve through system symlinks; use a real directory such as Documents. Inspect per-course `issues`, resource statuses and remaining references before treating a partial archive as complete. Archives can include your own submitted work, so select what you intend to share before distributing the directory.

Plugins accept local directories or ZIP files, undergo static inspection, and start disabled. JS workers and Rust JSON-RPC plugins are supported. Enabling a plugin executes trusted local code; child processes isolate lifecycle, without providing an operating-system sandbox. GUI/WASM-specific capabilities explicitly report incompatibility. Installation and configuration require a local source, so a model cannot install plugins itself. Only install and enable local packages you have reviewed.

## MCP and desktop mode

```json
{"mcpServers":{"onethu":{"command":"node","args":["/absolute/path/to/cli/bin/onethu.mjs","mcp"]}}}
```

Independent MCP exposes `onethu_commands` and `onethu_call`; call arguments look like `{"operation":"learn.courses","args":[]}`. Sign in and start the daemon first so other agents can share that runtime. Exiting MCP leaves a separately started daemon running. When a temporary MCP process owns its own runtime, that runtime closes with the process. stdout is reserved for protocol messages.

On Windows, use the actual absolute entry-point path, for example `C:\\Projects\\OneTHU\\packages\\cli\\bin\\onethu.mjs` inside JSON. An absolute path avoids PATH propagation issues in graphical agent applications.

```sh
onethu --desktop status
onethu --desktop learn courses
onethu --desktop mcp
```

An updated desktop build needs Harness, OneTHU CLI and agent-service authorization enabled. Desktop mode uses a fixed loopback port; the independent daemon uses a private token and a random port. Each host keeps its own configuration. `--endpoint http://127.0.0.1:8787` or `ONETHU_ENDPOINT` also explicitly selects desktop mode.

Desktop endpoints accept only HTTP loopback origins using `127.0.0.1`, `localhost` or `[::1]`; `localhost` is pinned to `127.0.0.1`. The client does not use HTTP proxies or follow redirects. Desktop `status` describes the local service and its session, rather than probing every university endpoint. For HTTP 403, check the desktop service switch and OH authorization. For a connection failure, check that the intended host is running.

## Validation and remaining boundaries

```sh
pnpm test:sdk
pnpm --filter @onethu/cli test
pnpm test:cli
```

Fixtures cover login/2FA, stable device fingerprints, real CLI subprocesses, task persistence, cancellation, IM HTTP/WebSocket protocols, model tool loops and permissions. The daemon and installer have been checked in an isolated environment on macOS. Independent login to real university accounts, Windows ACL/autostart behavior, and live IM/model integrations still require acceptance testing. This work sent no real bookings, emails or IM messages.

Mail, CalDAV, cloud storage and external assignments use independent configuration. `memory.*` only reads Markdown from the independent account directory; desktop data is not copied implicitly. Canvas operations and tab navigation remain GUI features. Final campus-visit form submission and actual sports bookings retain official interactive flows. Scheduled tasks currently have no quiet hours or dedicated deduplicated session-expiry notifications; failures appear in task history.

The [project license](LICENSE) contains additional terms. Dependency notices ship in `dist/sdk/THIRD_PARTY_NOTICES.txt`.


## Optional platform package (0.11.4-fix-2)

Desktop app installers omit Node and CLI resources. Install or uninstall the optional component from full-mode onboarding or OH settings. The platform ZIP includes a verified Node runtime: extract it and run `./onethu` on macOS or `.\onethu.cmd` on Windows. Source/npm entry points still need Node. OH in the app works without CLI installation or external CLI access. The default terminal client prefers the running app catalog, then the resident account host. Calendar events and mailbox configuration share account records; uninstall preserves profile data and transfers jobs back to the app.
