# Architecture (0.11)

[中文](../architecture.md) · English

This overview covers the active OneTHU 0.11 architecture on `main` and `dev3`, while earlier design proposals and research notes remain archived in the [documentation catalog](documentation-catalog.md).

```text
React pages / three experience shells / OH capsule
    ├── OneGUI components, tokens, themes and motion
    ├── Explorer state, whiteboards, atoms, staging box and organizations
    ├── Permission facade → host APIs and campus clients
    └── Tauri IPC → Rust networking, credentials, files and bounded skill runtime
                         └── OneTHU Harness (Rust submodule)
```

`apps/desktop` powers the macOS, Windows, and Android apps—use the Vite browser preview for rapid UI work, and run inside the Tauri host whenever you need native networking, credentials, or local files. `packages/core` implements the campus service clients, while `packages/gui` serves as the single source of truth for visual tokens, themes, and components.

## Authentication and shared state

Campus clients share your university SSO session wherever supported, while cloud storage, GitLab, mail, calendars, and AI model services connect with their own credentials when enabled. During session renewal or two-factor verification, the sign-in pipeline preserves the active challenge context and device fingerprint so verification completes smoothly; if your university account reaches its trusted-device limit, you can free a slot in the official Tsinghua account portal.

Fetched campus data flows into a shared state layer that drives lists, calendars, and home widgets alike. Assignment deadlines appear consistently across Minimal, Practical, and Full modes, and switching modes adjusts layout density while keeping your Full-mode whiteboards and settings intact. App-generated status and error messages localize dynamically at render time, while upstream notices from university servers stay in their original text for clarity.

## Extensions and agent runtime

Plugin contracts live in `types.ts`, with `facade.ts` injecting host APIs and enforcing permission checks on every call. The [generated API surface](api-surface.md) currently spans 41 namespaces and 297 method entries.

OH pairs with the standalone `OneTHU-Harness` Rust submodule to invoke authorized host tools: Minimal and Practical modes keep global search, custom model APIs, and WeChat/Feishu channels handy, while Full mode unlocks full plugin and workspace tools. See [OH and Xiaoda](oh-and-xiaoda.md) for how Xiaoda agents, the skill plaza, and the bounded QuickJS sandbox work together.

## Staging and collaboration

A unified gesture pipeline coordinates taps, long-press pickup, freeform board layout, and drop-to-stage actions across explicitly integrated sources—see the [supported items guide](sharing-and-organizations.md). Staged items share across devices via online short codes, which we recommend for reliable everyday sharing.

Cards, contacts, organizations, and shared files synchronize after verifying account ownership, merging compatible edits automatically and prompting when concurrent changes conflict, while keeping organization role checks aligned between the UI and remote storage.

## Updates and diagnostics

Local development uses Vite hot reload, while installed production builds upgrade through verified release installers. See [privacy and troubleshooting](privacy-and-troubleshooting.md) for platform permissions and redacted diagnostics, and [screenshot provenance](screenshots.md) for how public sample captures are produced.
