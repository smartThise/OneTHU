# Developer center

[中文](../developers.md) · English

Release and general development use `main` / `dev3`; this technical expansion is checked against the `web` prototype branch. Read the [architecture](architecture.md), [plugin guide](plugin-development.md), [generated API surface](api-surface.md) and [OH / Xiaoda guide](oh-and-xiaoda.md). The [contributor directory](contributors.md) is reproducibly derived from Git history.

## Run locally

Use Node.js 20.x (at least 20.19) or 22.12+ and pnpm. Native development also requires Rust stable and the platform-specific Tauri 2 prerequisites. Android additionally requires a JDK, Android SDK and NDK.

```bash
git clone --recurse-submodules https://github.com/smartThise/OneTHU.git
cd OneTHU
git switch dev3
# Gateway prototype and this architecture baseline: git switch web
git submodule update --init --recursive
pnpm install
pnpm dev
```

`pnpm dev` starts the Vite frontend only. A fixture-based browser preview does not validate native networking, files, credentials or skill IPC.

```bash
# Native Tauri development; cross-platform entry for Windows
pnpm --filter @onethu/desktop tauri:raw
# Frontend development build / native desktop development package
pnpm --filter @onethu/desktop build:dev
pnpm --filter @onethu/desktop tauri:build:dev
# Android development APK; the script requires Bash
pnpm --filter @onethu/desktop android:dev
```

Install the [official Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). The [detailed build reference](../dev-build.md) describes development variants, signing and paths. See [Android release investigation](../android-release-traps.md) for platform pitfalls; these detailed historical references are maintained in Chinese. Never commit signing keys, tokens or passwords.

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

Detailed flows: [prototype](architecture/prototype-and-data.md), [runtime](architecture/sdk-and-api.md), [CLI/agents](architecture/cli-and-agents.md), [Gateway](architecture/gateway.md), [OneGUI](architecture/onegui.md), and [API selection](api-reference.md).

Application plugins, OH tools, external MCP servers and Xiaoda skills have different execution models. QuickJS supports pure synchronous JavaScript only, with a 2-second limit, 32 MiB memory, 256 KiB stack, and 64 KiB code and I/O bounds. It has no network, files, processes, modules or async execution. Export heavier skills to a folder or ZIP and configure an external desktop agent. Desktop Rust sidecars do not automatically work on Android.

## Validate and contribute

```bash
pnpm typecheck
pnpm i18n:check
pnpm test:onboarding
node tools/docs-api-surface.mjs
python3 tools/contributors-report.py
pnpm lint:docs
```

Run checks relevant to the change. Run `pnpm i18n:handoff` after extracting new messages; translators should modify only the assigned handoff files. Check UI changes in a browser at portrait and landscape sizes, including scrolling, clicks, keyboard access and reduced motion. A successful build is not physical-device acceptance.

Use the [fixture capture workflow](screenshots.md) for public images. Keep passwords, private campus responses, tokens and QR codes out of screenshots, logs and fixtures. The [public developer page](https://onethu.github.io/en/developers.html) links the build, plugin, Harness, API, OneGUI and contributor resources. Read the [license](../../LICENSE), including its non-commercial and no-attack restrictions.
