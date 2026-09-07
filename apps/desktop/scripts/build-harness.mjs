#!/usr/bin/env node
/**
 * 构建 OneTHU-Harness sidecar 并放入桌面应用资源目录（打包进 App）。
 * 用法：pnpm --filter @onethu/desktop build:harness
 * 产物：src-tauri/resources/plugins/onethu.harness/onethu-harness[.exe]
 */
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..", "..");
const harnessDir = join(repo, "plugins", "OneTHU-Harness");
const target = process.env.CARGO_TARGET_DIR || join(harnessDir, "target");
const exeName = process.platform === "win32" ? "onethu-harness.exe" : "onethu-harness";
const built = join(target, "release", exeName);
const resDir = join(repo, "apps", "desktop", "src-tauri", "resources", "plugins", "onethu.harness");

console.log("[1/2] cargo build --release（OneTHU-Harness）…");
execSync("cargo build --release", { cwd: harnessDir, stdio: "inherit", env: { ...process.env, CARGO_TARGET_DIR: target } });
if (!existsSync(built)) {
  console.error(`构建产物缺失：${built}`);
  process.exit(1);
}
mkdirSync(resDir, { recursive: true });
copyFileSync(built, join(resDir, exeName));
const logo = join(harnessDir, "logo.svg");
if (existsSync(logo)) copyFileSync(logo, join(resDir, "logo.svg"));
const mb = (statSync(join(resDir, exeName)).size / 1048576).toFixed(1);
console.log(`[2/2] 已就位 resources/plugins/onethu.harness/${exeName}（${mb} MB）`);
