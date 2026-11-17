# OneTHU 0.11.4 · Revolution


[中文](../release-0.11.4.md) · [Downloads](https://github.com/smartThise/OneTHU/releases/tag/v0.11.4)

This release connects the CLI, background tasks, and OH to a wider set of in-app services, alongside improvements to sign-in, cloud drive stability, attachments, and interface polish.

- **OneTHU CLI and SDK:** Install standalone or run on the Node runtime bundled with macOS and Windows. The CLI shares sign-in sessions, scheduled tasks, and run history with the desktop app, allowing authorized background tasks to keep running after you close the window. You can query and archive course materials, schedule periodic checks, send notifications, and connect external tools over MCP.
- **OH tools:** Discover and invoke app services for OneTHU contacts, organization members and files, projects and announcements, Xiaoda skills and agents, and staging-box items and shares, while role assignments stay managed on the organization admin page.
- **Rain Classroom:** Query courses and coursework through both OH and the CLI with dedicated session management, pagination, partial-result reporting, and clear handling of open-ended assignments with no deadline.
- **Reliability:** Separates IM channel settings from chat context and tightens request cancellation, task ownership, desktop-to-CLI session handoff, cloud drive reconnection, and multi-account isolation.
- **Learning and interface:** Restores accurate filenames and extensions on course notice attachments, and refines glass surfaces, wallpaper archives, tab management, and OH interactions.

On desktop, the resident Node backend powers background CLI tasks, whereas Android runs the embedded OH runtime directly inside the app. Contacts, organizations, whiteboards, and staging boxes run through the live app session, while the standalone CLI provides its own built-in command set and exports full-environment skills for external desktop agents.

Automated runs follow your local authorization preferences, with permission and account checks applied to writes, shares, and outgoing messages. When a model provider encounters an error, OH surfaces it distinctly while preserving the results of completed tool calls.

All three platforms ship as **0.11.4**, and Android ARM64 uses versionCode **11013** with the standard production signing certificate and app icon.

[CLI guide](onethu-cli.md) · [OH services and permissions](oh-app-services.md)
