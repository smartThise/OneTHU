# Prototype and data model


[中文](../../architecture/prototype-and-data.md) · [System overview](../architecture.md)

## Product objects and modes

OneTHU surfaces the same core campus entities—courses, assignments, notifications, and files—across lists, unified search, calendars, whiteboards, and agent tools. Views consume normalized models that preserve upstream source IDs, and navigation passes enough entity context to reopen the exact item in its destination view.

Minimal mode centers on a fixed home view, five primary shortcuts, search, and OH; Practical mode adds broader everyday campus services with streamlined settings; and Full mode unlocks freeform whiteboards, tabs, OneGO, organizations, and extensions. Switching modes adjusts the active UI and available features while keeping your underlying accounts, whiteboards, and workspace data intact. Incoming shares, collaboration actions, and agent tools also check the active mode, privacy consent, and signed-in account before running.

Cloud-sync consent and agent consent are stored as independent settings, and revoking either immediately cancels any in-flight requests that depend on it. Sources: [experienceMode](../../../apps/desktop/src/state/experienceMode.ts), [privacyConsent](../../../apps/desktop/src/state/privacyConsent.ts).

## Page instances and workspaces

Each `ExplorerTab` tracks its tab ID, page route, route parameters, title, parent workspace, and recent access timestamps. Home uses a single persistent tab identity, while feature routes keep independent tab state: ordinary navigation reuses a matching tab when appropriate, whereas duplicating a tab opens a separate instance so two course pages can stay on different sub-views side by side.

`ExplorerWorkspace` captures a saved tab set along with optional live tab-group sync, accent color, and icon. Settings, plugin panels, and OH management open as overlays above the active tab deck. OneGO stores bookmarked pages and workspaces, while OneShot manages the primary quick-launch bar through its own persisted model.

Jumping from a whiteboard widget to an assignment or trace view enters the same shared content shell as sidebar or search navigation: the widget supplies the target entity parameters, and the shell handles gutters, scrolling, and safe-area padding. Source: [explorer.ts](../../../apps/desktop/src/state/explorer.ts).

## Atoms and deep links

Atom references give bookmarks, search results, drag-and-drop items, and shared cards a unified lookup mechanism across pages, widgets, campus entities, and tabs. Given a reference, `AtomView` resolves its title, icon, source badge, open action, and optional live preview.

An atom reference stores stable business identifiers and display hints while service clients fetch live content on demand. Learn course IDs, Rain Classroom classroom IDs, notification IDs, and file `resourceRef` tokens each keep their own namespace; legacy entity keys use delimiter encoding, and tab references sort and encode route parameters for deterministic keys.

Global search blends registered app features, locally cached items, and targeted campus-service queries, while the quick atom picker queries registered entries and already-loaded caches for instant responsiveness. Sources: [atoms.tsx](../../../apps/desktop/src/state/atoms.tsx), [favorites.ts](../../../apps/desktop/src/state/favorites.ts).

## Board documents and geometry

`BoardDoc` tracks schema version, the dictionary of boards, the active board ID, and display order. Each `Board` represents a system or user whiteboard with dedicated portrait and landscape layouts, and each `BoardItem` pairs a business `WidgetSpec` with grid coordinates, an optional freeform pixel rectangle, and manual-resize, collapse, or pin flags.

```text
WidgetSpec: business content
BoardItem: identity, geometry, state
Board: page and orientation
BoardDoc: persisted workbench document
```

On the canvas, the freeform layer renders pixel rectangles while keeping grid coordinates synchronized for plugin/OH APIs and layout migration. Centralized reference-canvas and column rules adapt the same persisted geometry cleanly across window sizes.

Dragging or resizing updates transient preview coordinates during the pointer gesture and commits once on release. On touch screens, layout edits require Edit mode so normal swipes scroll and open content smoothly. Undo steps through board history, Reset restores a default template, and auto-fit sizing stays distinct from manual user dimensions.

Sources: [boardCore](../../../apps/desktop/src/state/boardCore.ts), [boardEdit](../../../apps/desktop/src/state/boardEdit.ts), [boardHistory](../../../apps/desktop/src/state/boardHistory.ts), [FreeBoard](../../../apps/desktop/src/components/FreeBoard.tsx).

## Staging, sharing and import

Temporary staging boxes hold text snippets, atom references, and files. Dropping an item into staging completes the gesture once and leaves the source widget at its original board coordinates; floating-ball positioning, tap thresholds, and drop highlights stay in transient UI state separate from the box's persisted items.

When sharing online, OneTHU uploads supported box items to an authorized cloud folder and generates a short retrieval code. Opening a code validates the reference format, remote access permissions, and upstream item availability at each step, then imports the items into a newly created box without overwriting existing local boxes. Shared text, files, and skill packages are always loaded purely as content data.

Experimental NFC tap-to-share is available on supported mobile hardware with an inline readiness prompt, while short codes provide universal cross-device sharing. See [sharing](../sharing-and-organizations.md), [application services](../oh-app-services.md), [vault.ts](../../../apps/desktop/src/state/vault.ts), [vaultShare.ts](../../../apps/desktop/src/state/vaultShare.ts), [vaultDrag.ts](../../../apps/desktop/src/components/vault/vaultDrag.ts).

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

Runtime directories rely on Unix private file permissions, Windows current-user ACLs, and exclusive profile locks. Because several SDK and model configuration files store credentials directly inside that protected local directory, disk permissions and backup exclusions should treat the profile folder as sensitive.

## Synchronization and reconciliation

When the resident daemon is installed, `sharedCalendar.ts` and private `desktop.data*` RPCs read and write authoritative calendar and settings documents using content-version and account-owner checks. Mobile devices and desktops without the daemon persist directly in app storage, with install and uninstall flows migrating records cleanly between hosts.

Non-overlapping edits merge automatically, while conflicting account identities or organization bindings prompt for an explicit user choice. Accessing shared organization resources checks that remote GitLab membership, repository ownership, and the active OneTHU account all match; saved file references point to remote locations, and live server permissions govern actual reads.

Local organization indexes, remote GitLab membership, projects, announcements, and linked cloud files each follow their own lifecycle: creating an organization initializes its local index first, and multi-member sharing activates once remote repository access is configured and verified across accounts. See [organization behavior](../sharing-and-organizations.md).

## Failure behavior

During transient network timeouts, views can continue displaying previously fetched data alongside its age and source indicator, whereas authentication expiry or permission revocation immediately clears stale success states. Switching accounts cancels in-flight requests and blocks late writes from the prior session. When an upload, outgoing message, or booking ends in an uncertain network state, check the remote service before retrying—local cancellation stops further client retries while the server resolves any request already received.
