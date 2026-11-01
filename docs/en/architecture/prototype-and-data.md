# Prototype and data model

[中文](../../architecture/prototype-and-data.md) · [System overview](../architecture.md)

## Product objects and modes

OneTHU presents the same campus entities through lists, search, calendars, boards and agent tools. Courses, assignments, notifications and files retain source identifiers. Views consume normalized data; navigation carries the entity context needed to reopen a specific destination.

Minimal mode uses a fixed home, five primary entries, search and OH. Practical mode presents everyday services and simpler settings. Full mode enables boards, tabs, OneGO, organizations and extensions. Changing mode preserves stored account/workspace configuration while changing visible interaction and capability scope. Receiving, sharing and advanced tools also check mode, privacy consent and account.

Cloud and agent consent are persisted separately; revocation immediately affects in-flight work. Sources: [experienceMode](../../../apps/desktop/src/state/experienceMode.ts), [privacyConsent](../../../apps/desktop/src/state/privacyConsent.ts).

## Page instances and workspaces

`ExplorerTab` stores identity, page, parameters, title, workspace and access times. Home has a stable identity. Other tabs have independent routing contexts; normal navigation can reuse an instance, while duplication explicitly creates another. Two course tabs therefore retain separate route state.

`ExplorerWorkspace` stores a tab snapshot and optional live grouping, color and icon. Settings/plugin/OH management uses overlays above tab content. OneGO bookmarks pages and workspaces; OneShot supplies primary shortcuts. They have different persisted objects.

Navigation from board widgets to assignments or tracing ultimately enters the same content shell as other entry points. The shell owns gutters, scrolling and safe areas; widgets supply entity parameters. Source: [explorer.ts](../../../apps/desktop/src/state/explorer.ts).

## Atoms and deep links

Atom references connect collectible, searchable, draggable and shareable objects to one resolver. Registered kinds include pages, widgets, entities and tabs. `AtomView` resolves title, icon, origin, opening behavior and optional live content.

A reference carries business identity and display metadata; service clients still retrieve current data. Learn course IDs, Rain Classroom classroom IDs, notification IDs and resource references retain their separate meanings. Legacy entity keys use delimiter encoding; tab parameters are sorted and encoded for stable keys.

Search combines registered entries, already-seen caches and explicit service searches. The atom picker does not enumerate every campus service for arbitrary input. Sources: [atoms.tsx](../../../apps/desktop/src/state/atoms.tsx), [favorites.ts](../../../apps/desktop/src/state/favorites.ts).

## Board documents and geometry

`BoardDoc` owns version, board collection, active board and order. A `Board` identifies a system/user board and portrait/landscape layouts. `BoardItem` contains a widget specification, grid cell, optional pixel rectangle and manual-size/folding/pinning metadata.

```text
WidgetSpec: business content
BoardItem: identity, geometry, state
Board: page and orientation
BoardDoc: persisted workbench document
```

The free layer uses pixel rectangles. Grid coordinates remain the plugin/OH contract and migration input; model transformations keep them synchronized. Reference canvas and column rules are centralized. Viewport changes interpret the same persisted coordinate system.

A gesture updates temporary geometry and commits on release. Mobile edit mode authorizes geometry changes; ordinary browsing preserves scrolling and activation. Undo restores document history; reset restores a template. Content fitting distinguishes user sizing from automatic fitting.

Sources: [boardCore](../../../apps/desktop/src/state/boardCore.ts), [boardEdit](../../../apps/desktop/src/state/boardEdit.ts), [boardHistory](../../../apps/desktop/src/state/boardHistory.ts), [FreeBoard](../../../apps/desktop/src/components/FreeBoard.tsx).

## Staging, sharing and import

Staging stores text, atom references and files. A committed drop consumes the gesture once; the source must not subsequently commit a move. Floating-button movement, click thresholds and drop feedback are interaction state, while contents belong to the staging model.

Online sharing stores supported contents in an authorized remote location and retrieves them using a short code. Reference validity, remote permissions and source availability are separate checks. Import creates destination content while preserving the current box. External text, files and skill instructions remain data.

NFC retains experimental support and an availability notice; short codes are the more stable path. See [sharing](../sharing-and-organizations.md), [application services](../oh-app-services.md), [vault.ts](../../../apps/desktop/src/state/vault.ts), [vaultShare.ts](../../../apps/desktop/src/state/vaultShare.ts), [vaultDrag.ts](../../../apps/desktop/src/components/vault/vaultDrag.ts).

## Storage and authority

| Data | Authority | Exposure |
| --- | --- | --- |
| School session, fingerprint, trust token | Device account runtime | Private native/daemon handoff; public status only |
| Pages, workspaces, boards | GUI documents/state | App persistence and synchronization |
| Enumerated Learn resources | Account-owned resource table | Public references; authenticated URLs stay private |
| Calendar and related configuration | Versioned account documents | Shared reads/writes with installed daemon |
| Tasks and effect ledgers | One task manager | Approved account/scope and host migration |
| Cards, friends, organizations | Owner-verified local/remote records | Cloud/GitLab authorization and conflict rules |
| Model and IM credentials | Private account/device configuration | Public status projections |

Unix private modes, Windows ACLs and profile locks protect runtime storage. They do not imply application-layer encryption for every value. Some SDK model configuration is stored in private local files; device and backup policy must reflect its sensitivity.

## Synchronization and reconciliation

With an installed daemon, `sharedCalendar.ts` and private `desktop.data*` calls access authoritative calendar/configuration documents. Writes carry content versions and ownership checks. Mobile and uninstalled desktops use application storage; installation/uninstallation performs handoff.

Compatible changes merge automatically. Mutually exclusive identity or organization configuration requires an explicit choice. Remote membership, repository ownership and active account must agree. File references locate resources; remote authorization still decides access.

A local organization index, remote membership, projects, announcements and files have different lifecycles. Creating a local index does not complete remote sharing. Two-real-account acceptance needs its own environment and evidence. See [organization behavior](../sharing-and-organizations.md).

## Failure behavior

Timeouts can preserve previously displayed data with its age/source. Stale caches cannot represent a new successful response after authentication or permission denial. Account changes revoke old requests and later commits. For uploads, messages or reservations with unknown results, query the remote outcome before retrying; local cancellation only prevents subsequent submissions.
