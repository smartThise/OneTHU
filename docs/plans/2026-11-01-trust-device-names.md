# 2FA device names implementation plan


**Goal:** Register newly trusted 2FA devices under the human-readable format `OneTHU（设备名）` across desktop, Android, and standalone CLI, while keeping existing device fingerprints and saved trust tokens intact.

**Architecture:** `@onethu/core` owns length-bounded, Unicode-safe display-name formatting, while the desktop native shell, Android bridge, and Node runtime supply the underlying OS host or device name. Both `info-lib`'s trust hook and explicit service trust calls reuse the shared formatter. Reading a display name is purely local—it issues zero school network requests and leaves existing registered devices untouched until the user next completes a real trust flow.

**Tech Stack:** TypeScript, existing Tauri Rust commands, existing Android Kotlin mobile bridge, and Node OS/process APIs.

## Tasks

1. Add `packages/core/src/auth/deviceName.ts` and export the formatter; cover control/bidi character stripping, length bounds, idempotent re-formatting, and Unicode scripts in unit tests.
2. Add the native display-name command in `apps/desktop/src-tauri/src/device_name.rs`, register it in `lib.rs`, and expose the Android getter in `OnethuMobilePlugin.kt` using only public user-configured device name and model fields—requiring zero Bluetooth, serial, Android ID, or hardware-identifier permissions.
3. Add `apps/desktop/src/lib/deviceName.ts` and wire it into both `info-lib` trust hooks and explicit sports/cloud trust calls, falling back to the platform label plus the existing fingerprint suffix if the native lookup fails so naming never mints a new identity.
4. Add the Node display-name provider and inject it through `createAuthFlow`, applying the same macOS `ComputerName` and Windows hostname conventions while keeping standalone core trust helpers injectable and normalized.
5. Run targeted auth and device-name tests, desktop and SDK TypeScript checks, and offline native compilation checks. Keep verification strictly offline without submitting OTPs, renaming or registering live school devices, publishing installers, or restarting the active local gateway.

## Platform status

Windows system PAC management, current-user TCP/SID connection attribution, and Tencent Authenticode signature checks are implemented in source, with live Windows host testing queued separately. On Android, campus gateway support will require dedicated native VPN/proxy transport, background service lifecycle management, and certificate-trust integration within Android's single-active-VPN-per-profile constraint, tracked as its own mobile milestone alongside the desktop implementation.

## Completed source and checks

All five tasks are implemented in source, covering primary school login, standalone CLI login, sports and cloud drive trust flows, and the injectable core trust helper. The Android bridge reads only the public device name and model with no added manifest permissions.

SDK tests (313/313), core/SDK/desktop TypeScript checks, macOS `cargo check --lib --offline`, and Android `compileDebugKotlin --offline` all passed. Unit tests verify display-name normalization, length truncation, preserved fingerprint and request payloads, lazy hook resolution, macOS/Windows naming rules, and graceful fallback when OS queries fail—all without sending live OTPs, invoking `saveFinger`, or altering registered school devices.

The currently installed app, background runtime, and active local gateway were left untouched, and no installers were built or published; the OS-supplied device name takes effect automatically on the next native desktop, Android, or CLI build, while live Windows host gateway verification and Android native gateway transport continue on their respective tracks.
