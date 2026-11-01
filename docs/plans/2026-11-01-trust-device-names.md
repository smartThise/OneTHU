# 2FA device names implementation plan

**Goal:** Register future trusted-device entries as `OneTHU（设备名）` across desktop, Android and standalone CLI, preserving existing fingerprints and trust tokens.

**Architecture:** Core owns bounded Unicode-safe formatting; native shell and Node runtime supply OS display names. Info-lib's existing trust hook and explicit service trust calls reuse the formatted name. Display-name reads make no school requests and never migrate or register devices by themselves.

**Tech Stack:** TypeScript, existing Tauri Rust commands, existing Android Kotlin mobile bridge, Node OS/process APIs.

## Tasks

1. Add `packages/core/src/auth/deviceName.ts` and export the formatter; test controls/bidi removal, length, repeated formatting and Unicode.
2. Add the native display-name command in `apps/desktop/src-tauri/src/device_name.rs`, register it in `lib.rs`, and add the Android getter to `OnethuMobilePlugin.kt`. No Bluetooth/serial/Android-ID permission or hardware identifier reads.
3. Add `apps/desktop/src/lib/deviceName.ts`, wire both info-lib trust hooks and explicit sports/cloud trust calls. Native-command fallback uses platform plus existing fingerprint suffix, without generating an identity for naming.
4. Add the Node name provider and inject it through `createAuthFlow`; use the same macOS ComputerName / Windows hostname policy. Keep core standalone trust functions injectable and normalize their names.
5. Run focused auth/name tests, desktop and SDK type checks, native compile checks where available. Do not submit OTPs, register or rename a real school device just to test naming. Do not publish installers or restart the working gateway.

## Platform status

Windows system PAC, current-user TCP/SID attribution and Tencent Authenticode verification exist; this run has no Windows physical-device acceptance. Android system VPN/proxy bridge is absent. Android requires its own native transport/lifecycle and certificate-trust validation; only one VPN can be active per profile. Do not label desktop source support as Android readiness.


## Completed source and checks

All five implementation tasks are complete in source. Covered primary login, standalone CLI, sports/cloud trust paths and the legacy injectable core trust helper. The Android getter uses only the public configured name/model and adds no permissions.

SDK 313/313 tests; core/SDK/desktop TypeScript checks; macOS `cargo check --lib --offline`; Android mobile-plugin `compileDebugKotlin --offline` passed. Tests cover display-name normalization and length, preserved fingerprint/request body, lazy hook resolution, Windows/Mac name policy and OS-read failures. No real OTP, saveFinger, device rename or registration was performed.

No installer was built or published, no installed GUI/backend was replaced, and the working gateway remained active. Full OS-name metadata needs the next native app/CLI build. Windows gateway physical-device acceptance and the Android gateway transport remain separate unfinished work.
