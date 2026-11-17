# Developer center


[中文](../developers.md) · English

Day-to-day feature work and releases target `main` and `dev3`, while the expanded architecture docs align with the `web` prototype branch. Start with the [architecture](architecture.md), [plugin guide](plugin-development.md), [generated API surface](api-surface.md) and [OH / Xiaoda guide](oh-and-xiaoda.md). The [contributor directory](contributors.md) is generated reproducibly from Git history.

## Run locally

Install Node.js 20.x (`>= 20.19`) or 22.12+ and `pnpm`. Building the native app requires Rust stable and the platform-specific Tauri 2 toolchain; Android builds also require a JDK, the Android SDK, and the NDK.

```bash
git clone --recurse-submodules https://github.com/smartThise/OneTHU.git
cd OneTHU
git switch dev3
# Gateway prototype and this architecture baseline: git switch web
git submodule update --init --recursive
pnpm install
pnpm dev
```

`pnpm dev` runs the Vite frontend in the browser for quick UI work against local fixtures. To test native networking, filesystem access, credential storage, or skill IPC, launch a native Tauri or Android development build:

```bash
# Native Tauri development; cross-platform entry for Windows
pnpm --filter @onethu/desktop tauri:raw
# Frontend development build / native desktop development package
pnpm --filter @onethu/desktop build:dev
pnpm --filter @onethu/desktop tauri:build:dev
# Android development APK; the script requires Bash
pnpm --filter @onethu/desktop android:dev
```

Set up the [official Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) first. For build flavors, signing setup, and output paths, see the [detailed build reference](../dev-build.md) and [Android release investigation](../android-release-traps.md) (both maintained in Chinese). Keep signing keys, tokens, and passwords strictly out of version control.

## Source and extension entry points

| Location | Responsibility |
|---|---|
| `apps/desktop` | React application, Tauri host, desktop and Android entry points |
| `packages/core` | Campus service clients and shared business models |
| `packages/info-lib` | University login, roaming and 2FA hooks |
| `packages/sdk` | Independent Node runtime, operations, policy and tasks |
| `packages/cli` | Commands, MCP, daemon and export |
| `packages/gateway` | Campus proxy, system integration and scoped WeChat ticket bridge |
| `packages/gui` | OneGUI components, semantic tokens, themes, materials and motion |
| `apps/desktop/src/plugins/types.ts` | Plugin API type source |
| `apps/desktop/src/plugins/facade.ts` | Host API and permission facade |
| `plugins/OneTHU-Harness` | Rust agent submodule |
| `tools` | Build, extraction, tests and fixture capture |

Deep dives by subsystem: [prototype](architecture/prototype-and-data.md), [runtime](architecture/sdk-and-api.md), [CLI/agents](architecture/cli-and-agents.md), [Gateway](architecture/gateway.md), [OneGUI](architecture/onegui.md), and [API selection](api-reference.md).

App plugins, OH tools, external MCP servers, and Xiaoda skills each run in their own execution environment. The built-in QuickJS engine runs pure synchronous JavaScript—capped at 2 seconds, 32 MiB of memory, a 256 KiB stack, and 64 KiB of code and I/O—for self-contained computation. Skills that need networking, filesystem access, async modules, Python, or Node can be exported to a folder or ZIP archive and wired into an external desktop agent. Native desktop plugins run as Rust sidecar processes on macOS and Windows, while Android uses embedded native modules.

## Validate and contribute

```bash
pnpm typecheck
pnpm i18n:check
pnpm test:onboarding
node tools/docs-api-surface.mjs
python3 tools/contributors-report.py
pnpm lint:docs
```

Run the checks that cover your changes. After extracting new UI strings, run `pnpm i18n:handoff`, and keep translation edits scoped to the generated handoff files. Preview UI updates in both portrait and landscape viewports—verifying scroll bounds, click targets, keyboard navigation, and reduced-motion behavior—and test native changes on real desktop or mobile hardware alongside local builds.

Follow the [fixture capture workflow](screenshots.md) when recording public screenshots, keeping passwords, personal campus data, tokens, and QR codes out of images, logs, and fixtures. Visit the [public developer page](https://onethu.github.io/en/developers.html) for links to build guides, plugins, Harness, API docs, OneGUI, and contributor credits, and review the [license](../../LICENSE) for non-commercial and acceptable-use terms.
