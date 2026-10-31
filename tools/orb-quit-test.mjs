#!/usr/bin/env node
/* The floating orb is a separate WebView; closing it must terminate the app process,
 * not leave OneTHU resident without a window. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const orb = readFileSync("apps/desktop/src/components/GlobalOrb.tsx", "utf8");
const lib = readFileSync("apps/desktop/src-tauri/src/lib.rs", "utf8");
const zh = readFileSync("apps/desktop/src/i18n/locales/zh-CN.ts", "utf8");
const en = readFileSync("apps/desktop/src/i18n/locales/en-US.ts", "utf8");
assert.match(orb, /invoke\("app_exit"\)/, "orb calls app_exit");
assert.match(orb, /components\.globalorb\.7f2c4a91d0e6/, "orb has a quit label");
assert.match(lib, /fn app_exit\(app: tauri::AppHandle\)/, "native app_exit exists");
assert.match(lib, /app\.exit\(0\)/, "app_exit terminates the process");
assert.match(lib, /app_exit,\s*\n\s*http_native_clear_cookies/, "app_exit is registered");
assert.match(zh, /"components\.globalorb\.7f2c4a91d0e6": "退出 OneTHU"/, "zh quit label");
assert.match(en, /"components\.globalorb\.7f2c4a91d0e6": "Quit OneTHU"/, "en quit label");
console.log("orb-quit-test: floating orb quit button wired to process exit ✓");
