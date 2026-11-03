/**
 * 壁纸画质护栏（2026-10-28 用户定案）：
 *   本地不重编码（原文件字节直接落盘）；压缩只在云端备份那一路做，且按「第二档」——
 *   最长边自适应、质量 0.9、带透明走 WebP。
 *
 * 为什么值得一条护栏：压缩口径散在「导入」「云端导出」「额度」三处，任一处被顺手改回
 * 1600/0.82 都会让用户在高分屏上看到糊掉的壁纸，而功能测试照旧全绿。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = (p) => ts.transpileModule(fs.readFileSync(p, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const wallpaperSrc = fs.readFileSync("apps/desktop/src/state/wallpaper.ts", "utf8");
const cloudSrc = fs.readFileSync("apps/desktop/src/lib/cloudWallpaperImage.ts", "utf8");
const archiveSrc = fs.readFileSync("apps/desktop/src/state/wallpArchive.ts", "utf8");
const syncSrc = fs.readFileSync("apps/desktop/src/state/wallpsync.ts", "utf8");
const zh = fs.readFileSync("apps/desktop/src/i18n/locales/zh-CN.ts", "utf8");
const en = fs.readFileSync("apps/desktop/src/i18n/locales/en-US.ts", "utf8");

/* ── ① 本地导入：原图字节直接落盘 ── */
assert.match(wallpaperSrc, /const ORIGINAL_IMAGE_EXT: Record<string, string> = \{[\s\S]*?"image\/jpeg": "jpg"[\s\S]*?"image\/png": "png"[\s\S]*?"image\/webp": "webp"[\s\S]*?"image\/gif": "gif"/, "原样落盘的格式白名单缺失");
assert.match(wallpaperSrc, /export const IMAGE_MAX_BYTES = 32 \* 1024 \* 1024/, "图片本地存档上限应为 32MB");
const importBody = wallpaperSrc.slice(wallpaperSrc.indexOf("export async function importWallpaperFile"), wallpaperSrc.indexOf("/* ── 动态壁纸声音"));
assert.match(importBody, /const path = await invoke<string>\("wallpaper_save", \{ name: `wp-\$\{Date\.now\(\)\}\.\$\{originalExt\}`, dataBase64: b64 \}\)/, "本地路径必须存原始字节（保留原扩展名）");
assert.match(importBody, /createImageBitmap\(file\)/, "落盘前要先验证能解码，坏图不该进库");
const originalBranch = importBody.slice(importBody.indexOf("if (originalExt)"), importBody.indexOf("return new Promise"));
assert.ok(!/canvas|toBlob|toDataURL/.test(originalBranch), "原图分支里不应再出现 canvas/toBlob/toDataURL");
assert.match(importBody, /const MAX = 1600;/, "非白名单格式仍要保留 canvas 兜底（AVIF/BMP/SVG 这类只能转一次）");
assert.match(importBody, /"image\/jpeg", 0\.82/, "兜底路径仍是 1600px / JPEG 0.82");

/* ── ② 云端重编码：第二档口径 ── */
assert.match(cloudSrc, /const QUALITY_PHOTO = 0\.9;/, "照片口径应为 JPEG 0.9");
assert.match(cloudSrc, /const QUALITY_ALPHA = 0\.92;/, "带透明的图应为 WebP 0.92");
assert.match(cloudSrc, /const EDGE_FLOOR = 2560;/, "最小边上限 2560");
assert.match(cloudSrc, /const EDGE_CEIL = 3840;/, "最大边上限 3840");
assert.match(cloudSrc, /Math\.round\(physical \* 2\)/, "上限要按窗口物理宽自适应");
assert.match(cloudSrc, /const outMime = alpha \? "image\/webp" : "image\/jpeg";/, "带 alpha 必须换 WebP（JPEG 会把透明压成黑）");
assert.match(cloudSrc, /typeof document === "undefined" \|\| typeof createImageBitmap !== "function"/, "无 DOM 环境要直接放弃压缩（存档模块本身不能依赖 canvas）");

/* ── ③ 额度与接线 ── */
assert.match(archiveSrc, /export const WALLPAPER_MEDIA_MAX_BYTES = 16 \* 1024 \* 1024;/, "单张备份额度应为 16 MiB");
assert.match(archiveSrc, /export const WALLPAPER_ARCHIVE_MAX_BYTES = 64 \* 1024 \* 1024;/, "整包备份额度应为 64 MiB");
assert.match(archiveSrc, /shrink\?: \(b64: string, mime: string\) => Promise<\{ b64: string; mime: string \} \| null>;/, "存档导出要支持注入压缩器");
assert.match(archiveSrc, /if \(options\.shrink && mime\.startsWith\("image\/"\)\)/, "只对图片调用压缩（视频原样走）");
assert.match(archiveSrc, /if \(shrunk && MIME_EXT\[shrunk\.mime\]\)/, "压缩结果的 mime 必须在可还原的白名单里");
assert.match(syncSrc, /\{ shrink: shrinkWallpaperForCloud \}/, "云同步必须把压缩器接进导出");
assert.match(zh, /"state\.wallpsync\.ab4ead4cd60b": "壁纸备份最多 64 MiB，每张图片或视频最多 16 MiB/, "中文额度提示没跟着改成 64/16 MiB");
assert.match(en, /"state\.wallpsync\.ab4ead4cd60b": ".*64 MiB.*16 MiB/, "英文额度提示没跟着改");
assert.match(zh, /"state\.wallpaper\.533a664403cd": "这张图超过 32MB/, "缺少本地图片过大提示（中文）");
assert.match(en, /"state\.wallpaper\.533a664403cd": ".*32MB/, "缺少本地图片过大提示（英文）");

/* ── ④ 行为：压缩只改备份资产，不改 ref 结构；缩小失败沿用原字节 ── */
const archive = {};
vm.runInNewContext(compile("apps/desktop/src/state/wallpArchive.ts"), {
  exports: archive,
  require: (id) => { throw new Error("unexpected require: " + id); },
  TextEncoder, TextDecoder, Uint8Array, btoa, atob, console,
});
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jAN8AAAAASUVORK5CYII=";
const webp = "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/vuUAAA=";
const row = (ref) => ({ id: "one", name: "Wallpaper", at: 1, ref });

const shrunk = await archive.exportWallpaperArchive({ v: 3, global: "local:/w/photo.png", day: null, night: null, library: [row("local:/w/photo.png")] }, async () => png, { shrink: async () => ({ b64: webp, mime: "image/webp" }) });
assert.equal(shrunk.assets["asset:0"], `data:image/webp;base64,${webp}`, "压缩结果没有替换进备份资产");
assert.equal(shrunk.library[0].ref, "asset:0", "压缩不应改变 ref 结构（去重与还原都靠它）");

const kept = await archive.exportWallpaperArchive({ v: 3, global: "local:/w/photo.png", day: null, night: null, library: [] }, async () => png, { shrink: async () => null });
assert.equal(kept.assets["asset:0"], `data:image/png;base64,${png}`, "压缩器返回 null 时应沿用原始字节");

let videoCalls = 0;
const video = await archive.exportWallpaperArchive({ v: 3, global: "local:/w/clip.mp4", day: null, night: null, library: [] }, async () => "AAAA", { shrink: async () => { videoCalls++; return null; } });
assert.equal(videoCalls, 0, "视频不该进压缩器");
assert.equal(video.assets["asset:0"], "data:video/mp4;base64,AAAA", "视频资产应原样保留");

const badMime = await archive.exportWallpaperArchive({ v: 3, global: "local:/w/photo.png", day: null, night: null, library: [] }, async () => png, { shrink: async () => ({ b64: webp, mime: "image/avif" }) });
assert.equal(badMime.assets["asset:0"], `data:image/png;base64,${png}`, "压缩器返回未知 mime 时应放弃压缩，不能让档案变成无法还原");

const writes = [];
const restored = await archive.importWallpaperArchive(shrunk, async (b64, ext) => { writes.push(ext); return "/restored/" + writes.length + "." + ext; });
assert.deepEqual(writes, ["webp"], "还原时应按 webp 落盘（扩展名决定 MIME）");
assert.equal(restored.global, "local:/restored/1.webp", "还原后的 ref 应指向本机文件");

console.log("壁纸画质：本地原图直存 ✓ / 云端 JPEG 0.9 或 WebP 0.92、上限自适应 ✓ / 16+64 MiB 额度与提示一致 ✓ / 压缩只作用于备份资产 ✓");
