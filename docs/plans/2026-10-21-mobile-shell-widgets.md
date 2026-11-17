# Mobile shell and widget refinement implementation plan


**Goal:** Refine mobile safe-area handoff, compact touch controls, and make widget picker sheets comfortable across screen sizes, then update the Android 0.11 release channels once verified.

**Architecture:** Native Android continues to pad system bar and IME insets, while CSS applies the shared OneGUI safe-area tokens whenever native padding is inactive. A unified mobile dock geometry aligns the OH capsule and OneShot button across all three app modes. Widget picker sheets sit above persistent navigation and keep headers and action bars pinned outside their scrollable body.

**Tech Stack:** React, OneGUI CSS tokens and recipes, Tauri Android/Kotlin, Chromium touch fixtures, signed Gradle release build.

## 1. Reproduce and refine shell
- Inspect `apps/desktop/src/App.tsx`, `packages/gui/src/tokens/structure.css`, `packages/gui/src/recipes/workbench.css`, and host layout styles.
- Measure baseline mobile geometry before editing, covering both browser-managed safe areas and native-owned insets.
- Compact mobile control heights and padding while preserving accessible 44px touch targets; keep desktop density and the mobile board edit lock intact.

## 2. Repair widget selection and presentation
- Remove obsolete dock-island clearance from `BoardAddDrawer.tsx` and clamp sheet drag height to the available dynamic viewport.
- Assign shared home modal masks proper OneGUI overlay priority, raise nested pickers above parent sheets, and give each sheet a fixed header with independent body scrolling.
- Polish component preview cards and Android widget configuration views using existing localized strings.

## 3. Verify and publish
- Add targeted browser regression tests across full, practical, and minimal modes in 360px/390px portrait and short landscape viewports, covering safe areas, touch scrolling, bottom-row reachability, confirmation actions, and compact control sizing.
- Run the insets guard, CSS/token checks, desktop typecheck, and widget/board regression suites, inspecting captured screenshots; record the exact test environment scope when running without an attached physical Android phone.
- Commit and push the source changes, build a signed Android `versionCode 11005` APK with compiled icon verification, and update the APK, checksums, and manifests in both GitHub Release and the cloud mirror folder while keeping macOS and Windows installers untouched.
- Refresh website download metadata, verify public mirror digests end-to-end, and archive the release report.

## Implementation and verification (2026-10-21)

- Native Android insets continue to own system-bar and keyboard padding; shared OneGUI safe-area tokens drop to zero only after receiving an `{ok:true}` bridge acknowledgement, keeping browser safe areas active in standalone web contexts.
- Phone dock height is set to 60px plus effective safe area, pairing a 44px OH capsule with a 36px OneShot visual button (expanded to a 44px hit target) and an 8px dock gap. Secondary, default, and large phone controls measure 36/40/44px, with floating controls at 44px.
- The widget drawer sizes against the dynamic viewport (72% height in portrait and nearly full height in short landscape) with legacy dock clearance removed, keeping the picker list and confirm bar clear of persistent navigation.
- Shared binding and collection modals run at modal elevation with independent scrolling. System back dismisses the topmost picker, binding close animations reset cleanly on reopen, and tapping a child scrim leaves the parent sheet open.
- Widget titles, assignment names, course times, and card balances follow a clear primary/secondary typographic hierarchy. Native Android widget rows use 15sp primary text, 12sp secondary metadata, and 20sp key figures, matching Kotlin measurement logic and XML layouts; source accent colors stay in side indicators while text maintains high contrast across light and dark themes.
- Browser integration tests cover all three modes across 360px/390px portrait and 844px landscape viewports, testing browser/native safe-area handoff, touch scrolling, reaching and confirming the final picker item, nested Android widget binding, and repeated close/reopen cycles. Mobile board edit-lock behavior remains solid.
- Automated verification in this environment covers Chromium touch simulation, Kotlin compilation and JVM unit tests, and signed APK binary inspection; live launcher rendering and touch feel on hardware remain to be checked on a physical Android device.
- Release target: Android `0.11.0` (`versionCode 11005`), signed with the existing production certificate and verified with the canonical stacked OneTHU logo, leaving macOS and Windows release artifacts untouched.

### Validation evidence

- `tools/mobile-shell-widgets-browser-test.mjs`: 73 interaction and layout assertions passed in Chromium, using injected safe-area insets to verify CSS and native inset handoff.
- `tools/board-mobile-edit-browser-test.mjs`: mobile lock state, explicit edit toggle, touch scrolling, drag, resize, and Home/OnePage isolation passed; desktop boards remain directly editable.
- `tools/widget-native-kotlin-test.mjs`: production Kotlin renderer compiled cleanly against Android API 36 with 14 JVM assertions passing; live home-screen launcher screenshots await a physical phone.
- Desktop TypeScript and i18n checks passed across all 7,552/7,552 bilingual catalog entries and 62 native fallback templates.
- CSS parser, design token, safe-area inset, modal/platform, density, control-sizing, and native-widget guards all passed.
- Running the full `pnpm guard` umbrella surfaces pre-existing `ui-copy-lint` warnings in untouched legacy Visit and library error copy, while every guard covering the modified shell, CSS, tokens, and widgets passes cleanly.

### Published Android replacement

- Source commit: `4957bc9cb20187fee7f6e4743e41c8031cfe01e8` (`main`, production build).
- Android artifact: `0.11.0` / `versionCode` **11005**, ARM64, 31,814,517 bytes, signed with the existing release certificate.
- SHA256: `e4cba247b3d89474f650f9ff8957ab644bfa2e458a2996a20344d026648b2887`.
- Canonical stacked Logo: all 15 compiled PNG resources verified pixel-for-pixel, with standard, round, and adaptive manifest bindings confirmed.
- Updated the `v0.11.0` APK, `SHA256SUMS`, and `latest.json` on GitHub Release alongside the `/Android` APK and root manifests/checksums in the cloud mirror; macOS and Windows installer bytes and digests remain unchanged.
- Public mirror verification downloaded all three platform installers anonymously from their cloud folders, confirmed exact digest parity with GitHub Release, and verified both `latest.json` manifests plus runtime GitHub-to-cloud fallback.
- Updated website download metadata and bilingual checksums in `OneTHU/onethu.github.io` commit `47f388ec9f3521cc5df29d13a9838e0798bb5921` (Pages run `39625717180`).
- Compact 36px buttons preserve full 44px touch targets via transparent hit-area extensions, confirmed through coordinate hit testing.
