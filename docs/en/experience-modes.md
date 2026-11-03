# Experience modes

[中文](../experience-modes.md) · English

Switching modes changes visibility without deleting full-mode settings or data. Return to full mode to restore its configured whiteboards, tabs, OneGO and related content.

| Capability | Minimal | Practical | Full |
|---|---|---|---|
| Unified search and OH capsule | Yes | Yes | Yes |
| Today’s tasks and upcoming classes | Yes | Yes | Configurable whiteboard widgets |
| Five OneShot shortcuts | Yes | Yes | Yes |
| Campus services | Focused shortcuts | More-services entry | Full workspace |
| Tabs, OneGO and free whiteboards | Hidden | Hidden | Available |
| Staging, organizations and advanced sharing | Hidden | Hidden | Available |
| OH with your own API, WeChat/Feishu links | Retained | Retained | Retained |
| Full plugin management and Xiaoda skills | Hidden | Hidden | Available according to permissions |
| Settings | Compact single page | Personal settings plus Harness, same structure as full mode | Personal settings, profile card, plugins, Harness |

Assignment deadlines must remain visible in compact-mode schedules. Advanced incoming sharing is isolated from modes that hide those features. Mode changes are not data deletion or a remote permission grant. Full-mode guide lessons cover whiteboards, staging, codes, NFC, organizations and Xiaoda, after the shared search/OH introduction.

## Settings

The personal settings tabs and sections are defined once in `apps/desktop/src/pages/Settings.tsx`, and the same controls serve every mode. Practical mode uses the same structure as full mode: the seven tabs account, notifications, features, appearance, downloads, help and about, plus a Harness section, with the same three-column layout and the same phone tab selector.

Sections that belong to full mode stay out of practical mode: home layout, OneShot shortcuts, favorites, tab management, the default tab bar style, geek mode, and the first help entry about whiteboards, staging and organizations. These differences are component parameters; there is no second copy of the controls. Minimal mode keeps the compact single page.

The Harness section is one page shared by both modes, including the permission and command summary, the model form, MCP and logs. Compact modes have no plugin page, so the model entry switches the on-page tier instead of opening one.
