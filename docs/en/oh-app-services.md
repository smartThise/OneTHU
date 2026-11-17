# OH application services


OH discovers built-in application capabilities through `app_services` and calls them through `app_call`, working alongside existing dedicated tools for campus services, whiteboards, OneFlow, plugins, themes, and navigation. Installed plugins and enabled skills each surface in their own dedicated catalogs.

On every turn, the host injects the live directory of reviewed operations. Internal OH calls run directly inside the app even when the external CLI listener is turned off, subject to agent-service consent, permission checks, and the signed-in account, while background scheduled tasks use their own local CLI authorization.

| Area | Read operations | Actions |
| --- | --- | --- |
| OneTHU contacts | `contacts.list`, `contacts.get` | Card exchange and friend-channel authorization use the Contacts page |
| Organizations | `organizations.list`, `organizations.get`: members, projects, announcements and linked resource IDs | `create`, `update`, `saveProject`, `removeProject`, `saveAnnouncement`, `removeAnnouncement` |
| Qingxiaoda | `xiaoda.status`, `agents`, `models`, `balance`, `conversations`, `conversation`, `skills`, `skill`, `installed` | `importSkill`, `enableSkill`, `removeSkill`, `ask` |
| Temporary boxes | `vault.list`, `items`, `item`, `readText` | `create`, `rename`, `addText`, `addAtom`, `addFile`, `removeItem`, `share`, `importCode` |
| Whiteboards, OnePage, OneGO, tabs and workspaces | Existing dedicated tools | Existing editing and approval flows |
| Plugins, themes and OneFlow | Existing `ext_plugin_*`, `ext_theme_*` and `ext_flow_*` tools | Existing installation and write approvals |
| Resident tasks | `tasks_query` | `tasks_manage` with local background-service authorization |

For instance, you can ask OH to list your OneTHU friends, check an organization's active projects, search the Qingxiaoda skill plaza, or jot a note into a temporary box.

## Discovery and invocation

```json
{"tool":"app_services","arguments":{"query":"contacts"}}
{"tool":"app_call","arguments":{"operation":"contacts.list","args":[]}}
```

Passing an empty `query` returns the top-level service groups and the index of dedicated tools; querying a specific group or operation name returns its full parameter schema. `app_call` takes positional `args` arrays, and any write action requires clear user intent plus `confirm:true`, verified by interactive approval in the app or a pre-approved automatic-execution policy on the device.

Because contacts, organizations, and temporary boxes live in the application's state, querying them requires the desktop or mobile app to be open. When running standalone, the CLI reports its own active catalog via `commands` while those app-owned indexes remain inside the GUI.

## Data and boundaries

- Contacts cover cards saved inside OneTHU—returning personal friends by default, with organization member cards available when requested explicitly—separate from WeChat, QQ, or OS address books.
- Contact and organization responses omit sharing tokens, channel secrets, invite payloads, card images, and local staging paths; short share codes are returned only when you run an explicit share action.
- Every read checks profile ownership, and shared organization views revalidate live GitLab membership so revoked access clears cached private details immediately.
- Creating an organization sets up a local index first; project and announcement edits enforce permission and optimistic-revision checks, while member roles, remote collaboration, and cloud-resource linking are managed on the Organization page.
- Plaza search and locally installed skills use separate queries, display external runtime requirements clearly, and keep QuickJS execution bounds in place; importing a skill saves it locally in a disabled state until you explicitly enable and run it.
- `xiaoda.ask` opens a new conversation with a live campus agent after looking up its agent ID and confirming write approval.
- Reading text from a temporary box returns `totalChars`, `nextOffset`, and `complete` for paginated reading; UTF-8 files read up to 8 MiB, while binary files return metadata previews.
- Importing a share code creates a fresh box without overwriting existing ones, and sharing reuses valid short codes while rechecking authorization during upload. Cross-device share readers support up to 4096 characters per inline text item—save longer notes as files before sharing, while local reads access the full text directly.
- These extended application services require Full mode, and switching accounts or modes cancels any in-flight calls immediately.

Tool outputs, announcements, contact notes, saved text, and skill descriptions are always handled strictly as data, keeping user authorization and runtime permissions governed solely by host settings.
