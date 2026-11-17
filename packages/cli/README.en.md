# OneTHU CLI

[简体中文](README.md) · [Architecture and capability boundaries](../../docs/en/onethu-cli.md)

OneTHU CLI is a standalone campus assistant for terminal and background workflows. Interactive commands handle queries, bookings, and course archives; a background daemon runs scheduled checks, downloads, and notifications; and an MCP server exposes these capabilities to external agents. It runs on macOS and Windows with **Node.js 20.19.x or 22.12+ (Node.js 22 LTS recommended)**, and its background process continues working after you close the desktop app.

Release 0.11.4 provides a standalone CLI download and shares the same runtime architecture across the macOS and Windows apps (on Android, OneTHU runs solely as a mobile client without a local Node backend).

## Build and install

```sh
# From the repository root
pnpm install --frozen-lockfile
pnpm build:cli
node packages/cli/bin/onethu.mjs --help

# If you already have the built package
npm install --global ./onethu-cli-0.11.4.tgz
```

The packaged tarball bundles the SDK, runtime dependencies, plugin worker, and license notices for offline installation; calling campus services requires network access as usual. After building from source, you can also run the platform install scripts:

```sh
# macOS
bash packages/cli/scripts/install-macos.sh
export PATH="$HOME/.local/bin:$PATH"
```

```powershell
# Windows PowerShell
powershell -NoProfile -ExecutionPolicy Bypass -File .\packages\cli\scripts\install-windows.ps1
```

On macOS, files install to `~/.local/share/onethu-cli` by default with a launcher in `~/.local/bin` (customizable via `ONETHU_CLI_HOME` and `ONETHU_CLI_BIN`). On Windows, the package installs to `%LOCALAPPDATA%\OneTHU\cli` and places the launcher in `%LOCALAPPDATA%\OneTHU\bin`, adding the `bin` directory to your user PATH—open a new terminal window to pick up the updated PATH, pass `-Prefix 'D:\Tools\OneTHU'` to choose another directory, or pass `-NoPath` to leave PATH untouched. On-device validation for Windows installation and autostart registration is scheduled for Windows hardware testing.

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

During sign-in, the terminal hides password input, then prompts you to pick a university verification method and enter its code. Your password stays in memory for the active login flow, while only session cookies and device identifiers are saved to disk. Pass `--trust-device` if you explicitly want to register a trusted browser with the university. Non-interactive scripts can pipe credentials via `--username ID --password-stdin` (avoid passing passwords in command-line arguments); if two-factor verification is triggered, the CLI ends the non-interactive attempt and asks you to sign in from an interactive terminal.

Default data directories are `~/Library/Application Support/OneTHU CLI` on macOS, `%LOCALAPPDATA%\OneTHU CLI` on Windows, and `$XDG_DATA_HOME/OneTHU CLI` (falling back to `~/.local/share/OneTHU CLI`) on other platforms. Pass `--data-dir ABS_PATH` or set `ONETHU_DATA_DIR` to work inside an isolated directory.

Each data directory is managed by a single active runtime. By default, the desktop app, OH, and the CLI share the same local profile—reusing sessions, device identity, execution policy, scheduled tasks, and run history—so signing in from any interface makes the account available across the others. Installing the optional background component from the desktop app lets approved tasks keep running after the window closes, while OH's built-in services inside the app work independently of external CLI access. Pass `--desktop` for capabilities hosted in the graphical app, or `--data-dir` for a separate profile.

Run `commands` to inspect the active capability catalog and `schema` to view argument definitions. Both `--args` and UTF-8 `--args-file` take positional **JSON arrays** (argument files are especially convenient on Windows). Queries call campus services directly with zero LLM invocations, writing structured JSON to stdout and redacted error details to stderr. Client timeouts default to 120000 ms and accept 1–600000 ms via `--timeout MS` or `ONETHU_TIMEOUT_MS`, capped by the service's 150-second per-call upper bound.

Structured JSON output is enabled by default (and can be selected explicitly with `--json`), while help and version flags print plain text. When `learn export` finishes with incomplete coverage, it writes its JSON report to stdout, logs a brief summary to stderr, and exits with code 5. For other failures, inspect `error.code` on stderr, as transport and operation exit-code categories differ between standalone and desktop hosts.

## Writes and automatic execution

```sh
onethu cal add --args '["Study discussion","2026-10-26","10:00","11:00",{"local":true}]' --confirm
onethu config automatic on --confirm
onethu config automatic off --confirm
onethu config enabled off --confirm
```

Write operations require `--confirm` from the local CLI by default. Once automatic execution is enabled, the CLI, MCP clients, and permitted model tools can run operations within their granted permissions. Enabling this local switch and supplying local confirmation privileges are reserved for the local CLI and desktop UI; calls arriving from MCP, IM, or plugins always follow the active local policy regardless of any `confirm:true` field in their arguments.

The OneTHU CLI settings in desktop OH manage this same local execution policy (authorization stays strictly on the current device outside cloud sync). Turning automatic execution off cancels unsubmitted write calls, while scheduled tasks continue to follow the specific scope approved when each task was created. Because a timed-out write request may already have succeeded upstream, OneTHU leaves timed-out writes unretried—check the current state before submitting the action again.

Running `config enabled off` pauses both the execution entry point and resident tasks; `config enabled on --confirm` resumes them. Policy changes appear immediately in both the desktop app and the CLI. Closing the app window leaves approved tasks running, while signing out or revoking execution authorization stops them.

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

Each check compares course files, announcements, assignments, and deadlines, staying quiet whenever nothing has changed. The initial run establishes a baseline and reports the items currently present. Add `"outputDir":"/absolute/existing/directory"` to download registered attachments into an existing folder (for example `"D:\\Study\\Course Archive"` on Windows). Selected courses, the output directory, and notification destinations together define the task's continuing authorization scope, so editing a task prompts for renewed approval.

Three schedule formats are supported:

```json
{"kind":"interval","everyMinutes":30}
{"kind":"daily","time":"20:00","timezone":"Asia/Shanghai"}
{"kind":"once","runAt":"2026-10-26T12:00:00Z"}
```

You can also schedule other read-only operations with `{"kind":"operation","operation":"info.schedule","args":[],"channels":["inbox"]}` (scheduled templates are scoped to read-only operations, keeping bookings and email sends interactive). All checks run deterministic local diff logic with zero model usage.

`tasks.update` accepts `["TASK_ID", completeTaskDefinition]` and `tasks.remove` accepts `["TASK_ID"]`, with both requiring local approval. Removing a task keeps any already downloaded files on disk, while pausing cancels an in-progress run and its active downloads. Each profile supports up to 50 tasks, retaining the latest 30 run records per task and attempting up to 100 downloads per run. Restarting the daemon triggers a single catch-up check for any missed schedule window. Read steps retry within bounded limits, while outbound notifications with uncertain delivery outcomes keep an audit record for inspection.

```sh
onethu daemon stop
# Register startup when the current user signs in to the operating system
onethu daemon install --confirm
onethu daemon uninstall --confirm
```

Standard desktop installers ship without Node or the CLI; installing the optional platform ZIP brings a bundled Node runtime and migrates existing session, calendar, and task records on first connection (running from source or npm uses your installed Node.js). Login autostart registers a user LaunchAgent on macOS or a per-user Scheduled Task on Windows, running checks whenever the machine is awake and online. Use `onethu daemon serve` for foreground troubleshooting, `stop` to end the active daemon process, and `uninstall` to remove the login autostart entry.

On macOS, running `daemon install --confirm` again updates the existing autostart entry for the current profile to point to the bundled Node runtime. Active tasks continue uninterrupted, and `reloadRequired` in the output indicates when the updated launch path will apply at the next macOS login.

## Notifications and IM

The local `inbox` channel is ready out of the box, while Feishu, WeChat, and HTTPS webhook destinations can be added via configuration. Store credential argument files in private directories and delete temporary copies once configured.

Argument file for one-way Feishu notifications:

```json
["feishu",{"appId":"APP_ID","appSecret":"APP_SECRET","chatId":"CHAT_ID"}]
```

```sh
onethu notifications configure --args-file ./private-feishu.json --confirm
onethu tasks channels
```

Reference the binding ID returned by `tasks.channels` inside your task's `channels` array. Changing the recipient replaces the binding ID, so update the task afterward to approve the new destination. External binding IDs also lock in the Feishu app or webhook URL, while rotating credentials in place preserves the existing binding. Outbound WeChat notifications use an existing iLink `botToken`, `userId`, and `contextToken`; if that message context expires, ask the bound recipient to send a fresh message through the configured inbound gateway or refresh the context explicitly.

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

Start the background daemon with `onethu daemon start` before turning on continuous IM reception. A one-off CLI process closes any IM gateway it started upon exit, whereas an independently running daemon stays online.

Inbound handling accepts private text messages from the bound sender only (ignoring group chats, unknown senders, and media attachments). `/status` and `/tasks` return status summaries; `/pause TASK_ID`, `/resume TASK_ID`, and `/check TASK_ID` manage tasks when local automatic execution is enabled; and free-form messages are routed to your configured model.

Two-way WeChat takes `credentials:{botToken,baseUrl?,contextToken?}` and `binding:{account,senderId}`, reusing existing binding credentials (QR-code pairing lives in the desktop app). `im.stop` pauses inbound reception in the active process, restarting the daemon restores channels configured for the current account, and `im.remove --args '["feishu"]' --confirm` permanently deletes a binding.

Desktop task notifications hand off their outbound credentials and recipient bindings over the local private bridge (WeChat requires an active message context from that recipient). Active desktop inbound gateways remain with their existing host process so handoff avoids duplicate pollers.

A successful send indicates that the messaging platform accepted the payload; deliveries with uncertain network outcomes are logged without automatic resend. Inbound IM events are persisted to disk before execution so reconnects and restarts run each received command at most once.

## Natural-language assistant

`agent.configure` connects to OpenAI-compatible APIs as well as local loopback HTTP models. Example configuration file:

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

Omitting `allowedOperations` exposes read-only tools to the model; creating or updating tasks requires both exposing the corresponding write tools and enabling local automatic execution. Prompts and any course data referenced in the reply are sent to your chosen model endpoint, and API keys are stored in plaintext inside local files restricted by OS user permissions. Remote endpoints require HTTPS (loopback HTTP is supported for local models), and HTTP redirects are rejected.

Each run defaults to a ceiling of 6 model turns, 12 tool calls, and 120 seconds. Conversation memory is isolated by university account and chat identity, keeping the latest 20 user/assistant text messages plus compact tool status summaries while omitting raw tool bodies. MadModel sign-in is provided in desktop OH (and via injected provider callbacks in the SDK), while the standalone CLI connects directly to OpenAI-compatible and local HTTP endpoints.

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

Course exports write JSON/Markdown summaries alongside original attachments under stable per-course folder names, leaving any personal notes in those folders untouched. Assignment pages are fetched read-only and include both instructor attachments and your own submitted files. In the report, `complete` reflects whether the current export run finished all queued items, while `enumerationComplete` reflects upstream list coverage—if full historical homework enumeration remains uncertain upstream, the CLI saves everything it retrieved and exits with code 5. Individual attachment errors are logged per item, and cancelling cleans up partial downloads (downloads restart per file without byte-range resume).

Running `learn export` without `--confirm` performs a read-only dry run: it fetches course and resource lists and prints the JSON export plan while leaving the filesystem untouched. The semester defaults to the university's current semester; pass `--semester ID` or `--course ID` (discoverable via `onethu learn courses`) to narrow the scope. Passing `--dry-run` always forces read-only planning even if `--confirm` is present.

Downloads are grouped into batches of up to 500 resource references per course, each sharing a single request deadline. Standalone mode confirms via `--confirm`, while desktop mode prompts inside OneTHU for each batch. If a batch times out or stops early, the report records `timedOut`, `downloadBatches[].remaining`, and `remainingResourceRefs`, pausing subsequent batches for that course rather than retrying automatically. Re-running a confirmed export later verifies existing local files before skipping them.

Each course folder combines the official course title with a short stable digest of the semester and course IDs. Inside `.onethu-export/<run-id>/`, the exporter writes `content.json` (source HTML and metadata), `content.md` (clean readable Markdown), and `manifest.json` (references, paths, SHA-256 digests, file sizes, and any failures), plus top-level `onethu-export-<run-id>.json` and `.md` summaries. Source HTML is stored inertly as data, and Markdown conversion strips active scripts and remote image loads.

Skipping an already downloaded file requires matching resource references, metadata, byte size, and SHA-256 hash; missing, modified, or corrupted local files are freshly downloaded under a new filename while preserving existing files. Because manifest checks validate local integrity against recorded metadata, export to a fresh output directory if you need to re-fetch an upstream file that was silently replaced under identical metadata.

Output paths enforce Windows-safe filename rules while preserving Unicode titles, and reject symlinks or directory junctions in both target folders and reused files (on macOS, choose a real path such as `Documents` rather than `/tmp` or `/var`, which traverse system symlinks). Check per-course `issues`, resource statuses, and `remainingResourceRefs` to confirm archive completeness. Because exports include your own assignment submissions, review folder contents before sharing an archive with others.

Plugins install from local directories or ZIP archives, undergo static inspection, and start disabled. Both JS workers and Rust JSON-RPC plugins are supported, running in child processes for lifecycle isolation with your local OS user permissions—install and enable only local packages you have reviewed. GUI- and WASM-specific plugin APIs return an explicit compatibility error in the CLI, and plugin installation and configuration remain restricted to local CLI confirmation.

## MCP and desktop mode

```json
{"mcpServers":{"onethu":{"command":"node","args":["/absolute/path/to/cli/bin/onethu.mjs","mcp"]}}}
```

Standalone MCP exposes `onethu_commands` and `onethu_call` (taking arguments such as `{"operation":"learn.courses","args":[]}`), reserving stdout strictly for MCP protocol frames. Sign in and run `onethu daemon start` beforehand so external agents can share that background runtime; exiting the MCP client leaves an independently started daemon running, whereas an ephemeral runtime started by MCP itself closes when the MCP process exits.

On Windows, configure the full absolute path to `onethu.mjs` (for example `C:\\Projects\\OneTHU\\packages\\cli\\bin\\onethu.mjs`) in your MCP JSON so graphical agent hosts can launch it reliably regardless of user PATH inheritance.

```sh
onethu --desktop status
onethu --desktop learn courses
onethu --desktop mcp
```

Using `--desktop` (or setting `--endpoint http://127.0.0.1:8787` / `ONETHU_ENDPOINT`) connects to a running OneTHU desktop app with Harness, OneTHU CLI, and agent-service authorization turned on. Desktop mode talks over a fixed loopback port, while the standalone daemon uses a per-profile random port and private token, with each host maintaining its own settings.

Desktop mode connects exclusively over HTTP loopback (`127.0.0.1`, `localhost` pinned to `127.0.0.1`, or `[::1]`), bypassing HTTP proxies and refusing redirects. Running `status` in desktop mode reports the local service state and active session directly without polling upstream university endpoints. If you encounter HTTP 403, verify that the desktop service switch and OH authorization are enabled; if the connection is refused, confirm that the target host is running.

## Validation and remaining boundaries

```sh
pnpm test:sdk
pnpm --filter @onethu/cli test
pnpm test:cli
```

Offline test suites cover login and 2FA flows, stable device fingerprints, real CLI subprocesses, task persistence and cancellation, IM HTTP/WebSocket protocols, and model tool loops and permissions—all verified locally against synthetic fixtures with zero live bookings, emails, or IM messages sent. Daemon and installer workflows have been verified in an isolated macOS environment, while live standalone university sign-in, Windows ACLs and autostart registration, and live IM/model end-to-end runs are tracked for device acceptance testing.

Mail, CalDAV, cloud storage, and external assignment sources each use independent settings inside the CLI profile, and `memory.*` reads Markdown files directly from that profile's account folder. Whiteboard canvas editing and tab navigation belong to the desktop GUI, while campus-visit form submission and live sports court bookings use the university's interactive web flows. Scheduled tasks record session-expiry and check errors in task history (quiet hours and deduplicated session-expiry alerts are not yet built in).

See the [project license](LICENSE) for full terms and additional conditions; third-party dependency notices ship in `dist/sdk/THIRD_PARTY_NOTICES.txt`.


## Optional platform package (0.11.4-fix-2)

Desktop app installers ship without bundled Node or CLI binaries; you can install or remove the optional CLI component anytime from full-mode onboarding or OH settings. The platform ZIP bundles a verified Node runtime—extract it and run `./onethu` on macOS or `.\onethu.cmd` on Windows (running from source or npm uses a system Node installation). Built-in OH features inside the desktop app work out of the box whether or not the external CLI is installed. By default, the terminal client connects first to a running desktop app catalog and otherwise falls back to the resident account host. Calendar events and mailbox settings share account storage, and uninstalling the optional component preserves profile data while handing scheduled jobs back to the desktop app.
