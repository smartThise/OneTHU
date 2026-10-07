#!/usr/bin/env node
/**
 * 开发者构建入口（跨平台）：置 ONETHU_DEV=1 后构建前端；加 --tauri 时继续完整 tauri 打包。
 *
 * 包一层的原因：ONETHU_DEV=1 pnpm build 这种前缀写法在 Windows 的 cmd/PowerShell 下不成立，
 * 而 dev 开关必须能进 vite.config.ts 的 process.env。
 *
 * 用法：
 *   pnpm --filter @onethu/desktop build:dev          # 只出前端 dist（开发者面板已内置）
 *   pnpm --filter @onethu/desktop tauri:build:dev    # 连 tauri 打包一起做
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP = join(dirname(fileURLToPath(import.meta.url)), "..");
const WITH_TAURI = process.argv.includes("--tauri");
const ENV = { ...process.env, ONETHU_DEV: "1" };
const MARKER = "onethu.dev.badge.hidden";

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd: DESKTOP,
    env: ENV,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("pnpm", ["exec", "vite", "build"]);
if (WITH_TAURI) run("pnpm", ["exec", "tauri", "build"]);

// 开关没生效就等于编了个正式版：这里直接拦下，避免正式版被当成 dev 包发出去
const assets = join(DESKTOP, "dist", "assets");
const hit = existsSync(assets) && readdirSync(assets).some((f) => {
  if (!f.endsWith(".js")) return false;
  return readFileSync(join(assets, f), "utf8").includes(MARKER);
});
if (!hit) {
  console.error("✗ dev 面板没进产物：ONETHU_DEV 未生效（检查 vite.config.ts 的 define）");
  process.exit(1);
}
console.log("✓ dev 构建完成：产物含开发者面板，右上角显示 dev · <commit> 徽标");
