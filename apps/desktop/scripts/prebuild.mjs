#!/usr/bin/env node
/**
 * tauri beforeDev/BuildCommand 的跨平台前置（替代 POSIX-only 的 find/truncate 管道）：
 * 仅 macOS 需要——清理 Rust target 里的 AppleDouble 垃圾（._*.toml 让 cargo 序列化报错）；
 * Windows/Linux 直接 no-op 返回 0，保证三端 CI 腿都能跑。
 */
import { readdirSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";

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
