# OneTHU CLI, SDK and resident assistant


[简体中文](../onethu-cli.md) · [Installation and full command examples](../../packages/cli/README.en.md) · [SDK embedding API](../../packages/sdk/README.en.md)

Updated: 2026-10-29. This guide covers application services and the optional CLI runtime in 0.11.4-fix-2.

## Optional CLI in 0.11.4-fix-2

OH calls authorized application services directly on both mobile and desktop, even when external CLI access is turned off; the external CLI/MCP toggle and automatic-execution policy operate as independent settings.

Standard desktop installers ship the app and Harness out of the box, while Node and OneTHU CLI are available as an optional add-on at the end of Full-mode onboarding or under **My → OH / OneTHU Harness → OneTHU CLI**. During setup, the installer downloads from GitHub or the Tsinghua Cloud mirror and verifies the release version, target platform, archive checksum, and individual runtime files. Without the add-on, scheduled tasks run whenever the desktop app is open; with it installed, approved tasks continue running in the background after you close the window. Uninstalling the add-on syncs your calendar, session, and tasks back to the app, shuts down the background scheduler, and removes the CLI runtime files while keeping your account profile and run history intact.

For standalone terminal use, you can also download `OneTHU-CLI_VERSION_darwin_arm64.zip` or `OneTHU-CLI_VERSION_win32_x64.zip`, verify its SHA-256 checksum, extract the archive, and run `./onethu --version` on macOS or `.\onethu.cmd --version` on Windows—the bundled Node binary is verified automatically on launch. To build the archive locally from source, run `node apps/desktop/scripts/package-cli.mjs` (standard app builds skip this step for speed).

By default, the CLI connects to the running desktop app's service catalog—including app-owned contacts, organizations, and temporary boxes—and falls back seamlessly to the account's resident background host when the app is closed. Pass `--desktop` to target the GUI explicitly or `--data-dir` to run against an isolated profile directory; interactive layout and canvas features run inside the desktop app.

Local calendar events and mailbox credentials share unified account records across the GUI and SDK, keeping edits visible from either side as soon as you refresh or refocus the window. Initial setup merges distinct event IDs, concurrent writes check optimistic revisions, and reinstalling merges any changes made while the CLI component was absent; if both sides edited the exact same event concurrently, the conflict is flagged clearly without overwriting either copy.

Authorized Tsinghua Cloud and Rain Classroom sessions pass privately over the main-window bridge—never through model-visible tool outputs. If the standalone CLI already holds a different account or credential, synchronization leaves it untouched and surfaces a clear conflict notice. Standalone plugins, model-provider keys, and inbound IM listeners stay scoped to their configured host so active OH/IM reception always has a single clear owner.

## Product layers

**OneTHU CLI** is the command-line interface for developers and external agents, **OneTHU SDK** is the embeddable Node runtime, and **MCP** exposes that runtime over the Model Context Protocol. While the host machine is awake and online, the resident daemon keeps approved scheduled tasks and IM channels running continuously, sharing campus service clients, Web Learning resource handling, the task engine, and execution policy with the visual desktop app.

Inside the app, OH owns in-app services and shares its reviewed catalog with authorized terminal callers while open; once the window closes, an installed resident daemon takes over background task scheduling via private, account- and epoch-fenced session handoff.

Task handoff preserves task IDs, run history, and download/notification deduplication ledgers. If a task has an unverified recipient or a colliding ID, its original record stays safe alongside a pending-transfer notice while already-migrated background tasks remain editable. Failed session handoffs preserve the desktop snapshot for a clean retry, CLI 2FA completions sync immediately within the active epoch, and signing out or switching accounts cancels all running tasks for the previous user.

## Capability coverage

Before invoking an operation, run `onethu commands` and `onethu schema OPERATION` to inspect the active host's live catalog, since desktop and standalone hosts register the operations supported in their respective environments.

| Area | Independent runtime integration | Boundaries |
| --- | --- | --- |
| Authentication | Stable device fingerprint, saved/restored sessions, SM2 login, interactive 2FA, logout | Passwords stay in memory during login; extra university verification prompts interactively |
| Web Learning | Semesters, courses, files, assignment/announcement bodies and attachments, discussions, course archives | Preserves partial results and flags incomplete status if upstream homework pagination stalls |
| Campus information | Timetables, grades, exams, news, academic calendar, empty classrooms, course selection/evaluation, card/network/dorm queries | Uses existing university endpoints and pagination |
| Libraries, discussion rooms and spaces | Resources, booking records, approved bookings and cancellations | Complete initial discussion-room email binding on the official portal before CLI booking |
| Sports venues | Venues, time slots, records, cancellations and official booking links | Final court booking uses the official interactive portal |
| Mail and calendars | Shared IMAP/SMTP/CalDAV configuration, read-only mail queries, approved sending/calendar changes, local calendar | Uses a mail-client authorization code and CalDAV ETags; moving events between local and cloud calendars uses separate steps |
| Cloud storage | Explicit configuration, connection state, libraries/directories, search and sharing | Uses dedicated CLI credentials; currently covers browsing, search, and share links |
| GitLab | Projects, files, issues, comments, merge requests, pipelines and approved writes | Uncertain write outcomes pause for remote status checks before retrying |
| Other services | External assignment snapshots/refresh, service-catalog search, visit-report forms/local drafts, account-local Markdown memory reads | Final visit-report submission uses the official page; OH cloud memory connects separately |
| Plugins | Static inspection and installation of local directories/ZIPs, JS/Rust execution, commands, permissions and removal | Runs trusted local code with user permissions; GUI and WASM features run in the desktop or mobile app |
| Resident assistant | Scheduled checks, incremental downloads, deadline reminders, task management, inbound/outbound IM and model tool loops | Runs while the host stays awake and online; WeChat QR and MadModel sign-in currently go through the desktop app |

Interactive whiteboard layout, drag-and-drop, and tab management run in the graphical app and are marked GUI-only in the SDK catalog.

## Independent host lifecycle

`createOneThu({dataDir})` locks the private directory exclusively, loads local settings, and registers available operations without making any network calls at startup. Calling `auth.login` authenticates and persists session cookies plus the device fingerprint, while `restore` verifies an existing session read-only. One-shot CLI commands shut down cleanly once finished, whereas `daemon serve` stays resident to run scheduled tasks and IM listeners.

Subsequent CLI calls pointed at the same directory read private `daemon-access.json` and talk to the daemon's randomized loopback port. The server enforces constant-time token comparison and rejects browser `Origin` headers, malformed JSON, invalid tokens, and oversized payloads. Raw credentials stay scrubbed from `status` responses, public service projections, and model catalogs. `stdio` MCP routes through the same dispatcher under its dedicated caller identity, with privileges set strictly by the local adapter.

For login autostart, macOS registers a user LaunchAgent and Windows registers a current-user scheduled task. Tasks pause naturally while the computer sleeps, powers off, or loses connectivity; upon waking, overdue schedules run a single catch-up check rather than firing a burst of missed intervals.

## Scheduling, authorization and idempotency

Each task stores its schedule, target courses or operation, download directory, notification channels, owner account, and revision counter. Creating, editing, or resuming a task records standing user approval, and at run time the scheduler mints an internal in-memory grant tied to that exact scope. Right before downloading a file or sending a message, runtime guards recheck the active account, task revision, target folder, resource handle, channel binding, and cancellation signal.

Schedules support fixed intervals, timezone-aware daily local times, and one-off ISO timestamps. `school-watch` diffs course resource digests and assignment deadlines to summarize updates, while `operation` runs approved read-only queries or scoped file downloads—keeping fresh results distinct from prior snapshots so failed checks leave earlier valid data intact, with bounded retries for transient read hiccups. Interactive actions like venue bookings and outgoing emails stay outside scheduled templates.

Pausing, editing, or deleting a task immediately signals cancellation to any in-flight run across both Node and native desktop downloaders. Because requests already sent over the network complete on the remote server, run history records interrupted states and marks in-flight deliveries or downloads for review. File downloads stream to temporary files, verify integrity, and move into place atomically—rejecting symlinks, paths outside the approved folder, and collisions with existing files, and cleaning up only temporary files from the failed attempt.

Execution history and external message delivery use separate ledgers, writing a durable idempotency entry before every send. After a process restart, any `pending` delivery entry transitions to `unknown` so you can inspect it without risking duplicate alerts, and platform `accepted` receipts record server handoff. Channel IDs stay pinned to a verified recipient across key rotations; changing the recipient itself prompts for fresh task-scope approval.

Each profile directory supports up to 50 tasks, retaining the 30 most recent runs per task and up to 100 downloads per run alongside bounded deduplication ledgers. Campus `school-watch` checks run deterministically with zero model token usage, invoking a configured language model only when interpreting natural-language chat or invoking agent tools.

## IM and model boundaries

WeChat connects over the existing iLink protocol, while Feishu uses WebSocket event streams and explicit send receipts. Each channel binds to a single university account, verified sender, and private 1:1 chat, logging incoming message IDs durably before dispatch so reconnects, duplicate server pushes, or daemon restarts process each message at most once.

Slash commands like `/status` and `/tasks` call SDK services directly, while natural-language messages run a bounded model loop capped by turns, tool calls, payload bytes, and wall time. Read-only tools are enabled by default; local users can opt into specific write tools and automatic execution, while credential setup, shell commands, and plugin installation stay strictly manual. Returned web pages and documents are handled purely as untrusted data under fixed host permissions.

API keys, IM tokens, and session cookies live in private local files guarded by OS permissions and ACLs. During model chats, user messages and relevant tool outputs are sent to your chosen provider, while per-account, per-chat short-term memory stores bounded summaries separately from OH cloud memory. When desktop task notifications hand off to the daemon, outbound credentials transfer over the private bridge after verifying account and recipient match, keeping inbound IM reception owned by a single host.

## References and implementation choices

The scheduler design draws inspiration from Hermes' [scheduled-task internals](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/cron-internals.md) and [scheduler](https://github.com/NousResearch/hermes-agent/blob/main/cron/scheduler.py), as well as OpenClaw's [cron service](https://github.com/openclaw/openclaw/blob/main/src/cron/service.ts) and [resident automation documentation](https://github.com/openclaw/openclaw/blob/main/docs/gateway/heartbeat.md)—specifically persistent task records, split execution and delivery ledgers, single catch-up runs after downtime, pinned private-chat bindings, and lifecycle cancellation.

All OneTHU scheduling, campus protocol handling, and IM codecs are implemented natively on top of OneTHU's existing packages. Routine campus checks use deterministic templates tuned for gentle polling intervals, while language models focus on planning and conversation through the shared service router used by both OH and external agents.

## Validation record

Automated SDK tests verify authentication, 2FA challenges, session restoration, local file downloads, account isolation, and cancellation against synthetic campus fixtures. CLI integration tests spawn real subprocesses in isolated directories to verify installation, daemon startup and shutdown, loopback auth, MCP framing, and task persistence across restarts, paired with local HTTP/WebSocket mocks for IM and scripted model responses—keeping real campus bookings, emails, IM accounts, and trusted-device slots completely untouched.

On the desktop UI, task creation, editing, pausing, run history, and the local inbox were verified in both Chinese and English across wide and compact viewports using OneGUI components against isolated fixture data (recorded in `output/cli-task-ui-fixture/QA.md`). Earlier live course-query and download checks through the desktop companion CLI exercised the GUI-backed runtime path.

On-device sign-off items tracked separately include live standalone university login, Windows installer ACLs and scheduled-task autostart, live Feishu and WeChat bots, and live external model APIs. Quiet-hour schedules and deduplicated session-expiry alerts are planned for future iterations (errors currently appear in task run history), and release version bumping and package publishing remain manual release steps.

## Rain Classroom queries

Use `yuketang` for Rain Classroom and `learn` for Web Learning. Inside OH, these map to the built-in read-only `query_yuketang` tool, while standalone agents and MCP clients call the same seven read operations from the service catalog.

Sign in to Rain Classroom via the QR code under **Settings → Account** in the desktop app. When agent consent and OneTHU CLI are enabled, the app passes that session privately to the resident daemon so queries keep working after you close the window. Because Rain Classroom manages its own session independently of university SSO, `status.configured` reports whether credentials are present while `courses` verifies live connectivity, returning a clear sign-in error if the session has expired.

```sh
onethu yuketang status
onethu yuketang courses
onethu yuketang contents --args '["classroom-id"]'
onethu yuketang homework --args '["classroom-id",90]'
onethu yuketang homeworkDetail --args '["classroom-id","leaf-type-id"]'
onethu yuketang leafDetail --args '["classroom-id","leaf-id"]'
onethu yuketang noticeDetail --args '["classroom-id",["notice-id"]]'
```

Pass classroom IDs from `courses` and item IDs from `contents`—each stays in its own namespace distinct from Web Learning course IDs. `contents` walks available pages across slides, videos, homework, exams, and notices, and passing a specific classroom ID avoids fetching activity logs from other classes. `homework` returns deadlines and submission status across past assignments plus upcoming items within the lookahead window set by the second argument (`1–3660` days, defaulting to the configured horizon, typically `30`); pass `["",90]` to scan all classrooms at once.

Responses include `complete` and `issues` fields: if one classroom errors out, available data from the others is returned with `complete: false`, stalled upstream pages report `YUKETANG_PAGINATION_STALLED`, and expired or switched sessions reject stale data cleanly. All `yuketang` commands are strictly read-only.

For standalone CLI setups, you can also import a session locally via `exthw.configure` (using a private `--args-file` so cookies stay out of shell history), and legacy `exthw.*` aliases remain supported. If the CLI already holds a different Rain Classroom session, desktop sync leaves it intact and flags the conflict so you can choose which session to keep via `exthw.configure`. Session cookies remain strictly internal and never appear in model outputs or logs.
