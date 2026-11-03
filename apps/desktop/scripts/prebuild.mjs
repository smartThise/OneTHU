#!/usr/bin/env node
/**
 * tauri beforeDev/BuildCommand 的跨平台前置：桌面构建独立 CLI/Node 资源，
 * 移动端跳过该资源；macOS 同时清理 Rust target 的 AppleDouble 文件。
 */
import { readdirSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Runtime packaging is independent of the platform-specific AppleDouble sweep.
// The child explicitly skips Android/iOS so desktop Node never enters an APK.
// CLI is an explicit standalone package; ordinary builds/dev do not bundle Node.
if (process.env.ONETHU_BUILD_CLI_PACKAGE === '1') execFileSync(process.execPath, [fileURLToPath(new URL('./build-cli-runtime.mjs', import.meta.url))], { stdio: 'inherit' });

if (process.platform !== "darwin") process.exit(0);
// tauri beforeCommand 的 cwd = apps/desktop（前端目录）；手动也可能在 src-tauri 跑——两处都试
const candidates = [join(process.cwd(), "src-tauri", "target"), join(process.cwd(), "target")];
const target = candidates.find((c) => { try { return statSync(c).isDirectory(); } catch { return false; } });
const sweep = (dir) => {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sweep(p);
    else if (e.name.startsWith("._")) {
      // AppleDouble 元数据垃圾直接删除（含 ._*.toml——tauri build.rs 读它报
      // invalid UTF-8 panic；0 字节截断的旧 hack 等效，删除更彻底）
      try { unlinkSync(p); } catch { /* 竞态删除忽略 */ }
    }
  }
};
if (target) sweep(target);
process.exit(0);
