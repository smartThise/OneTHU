#!/usr/bin/env node
/**
 * 寻迹：高德 Web 服务 Key 混淆生成器。
 * 用法：node tools/trace-key.mjs <32位hex的key>
 * 输出：lib.rs 里 TRACE_KEY_OBF 数组的字面量（XOR 0x5A + hex 分段）。
 * 注意：本脚本不落任何密钥文件；key 只以参数经过内存。
 */
const key = process.argv[2];
if (!key || !/^[0-9a-f]{32}$/.test(key)) {
  console.error("用法：node tools/trace-key.mjs <key>（高德 Web 服务 key 为 32 位十六进制）");
  process.exit(1);
}
const PAD = 0x5a;
const chunks = [...key].map((c) => (c.charCodeAt(0) ^ PAD).toString(16).padStart(2, "0"));
// 输出可直接粘贴的 Rust 数组（8 列排版）
const rows = [];
for (let i = 0; i < chunks.length; i += 8) {
  rows.push("        " + chunks.slice(i, i + 8).map((c) => `"${c}",`).join(" "));
}
console.log("    const TRACE_KEY_OBF: [&str; 32] = [\n" + rows.join("\n") + "\n    ];");
console.error(`\n已生成（${chunks.length} 段）。粘贴到 apps/desktop/src-tauri/src/lib.rs 的 trace_key() 后 cargo build。`);
