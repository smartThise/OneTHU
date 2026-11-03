#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
 * 对比度护栏 —— 把 2026-10-16 那轮排查里「跨文件必须一致」的几条钉住
 *
 * 只查静态可查的三件事（运行期的对比率请跑 tools/contrast-audit.mjs）：
 *   ① 反差纱的 alpha 必须与 explorer.css 同值（引擎按壁纸明暗单轴复算这层纱，
 *      CSS 改了数字而引擎没跟 → 立刻又会算错底 → 白字压白纱复发）；
 *   ② IO 那条路必须是活的：settleAll 登记元素时必须 observe，否则元素永远进不了
 *      visible，视频漂移那一路空转（本轮实测 visible 只有 2 个）；
 *   ③ 视频壁纸必须采真实帧（drawImage(<video>)），不许退回"刷一块纯色"。
 *
 * 跑法：node tools/contrast-guard.mjs      # 通过 exit 0，否则 exit 1
 * ══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");
const ENGINE = readFileSync(`${ROOT}/apps/desktop/src/lib/textContrast.ts`, "utf8");
const CSS = readFileSync(`${ROOT}/apps/desktop/src/styles/explorer.css`, "utf8");
const WORKBENCH = readFileSync(`${ROOT}/packages/gui/src/recipes/workbench.css`, "utf8");
const WIDGET_HOST = readFileSync(`${ROOT}/apps/desktop/src/components/WidgetHost.tsx`, "utf8");

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

/* ① 纱 alpha 与 CSS 同值 */
// 注意：散列选择器里同一对选择器出现两次（一条只给 content/position，另一条给 background），
// 所以正则必须要求「rgba 就在这段 body 里」，否则会抓到前一条空壳规则。
const cssDark = Number(/\[data-wallpaper-lum="dark"\][^{]*::before\s*\{[^}]*rgba\(255,\s*255,\s*255,\s*([\d.]+)\)/.exec(CSS)?.[1]);
const cssLight = Number(/\[data-wallpaper-lum="light"\][^{]*::before\s*\{[^}]*rgba\(0,\s*0,\s*0,\s*([\d.]+)\)/.exec(CSS)?.[1]);
ok(Number.isFinite(cssDark) && cssDark > 0, "explorer.css 里找不到暗壁纸白色纱的 alpha（选择器改过？请同步引擎）");
ok(CSS.includes('html:root:not([data-scheme="dark"]) .explorer-shell[data-wallpaper-lum="dark"] .explorer-content::before'), "亮主题反差纱选择器必须排除暗色 scheme（否则暗主题也铺白纱）");
ok(CSS.includes('html:root[data-scheme="dark"] .explorer-shell[data-wallpaper-lum="light"] .explorer-content::before'), "暗主题反差纱选择器必须以 data-scheme=dark 限定");
ok(Number.isFinite(cssLight) && cssLight > 0, "explorer.css 里找不到亮壁纸黑色纱的 alpha（选择器改过？请同步引擎）");
// 数值比较（别用 includes：0.34 含 "0.3"，子串判定会漏报）
const engDark = Number(/mode === "dark" \? ([\d.]+)/.exec(ENGINE)?.[1]);
const engLight = Number(/mode === "light" \? ([\d.]+)/.exec(ENGINE)?.[1]);
ok(engDark === cssDark, `引擎里的暗壁纸纱 alpha ${engDark} 与 CSS(${cssDark}) 不一致`);
ok(engLight === cssLight, `引擎里的亮壁纸纱 alpha ${engLight} 与 CSS(${cssLight}) 不一致`);
ok(/schemeIsDark/.test(ENGINE), "反差纱引擎没有按主题 scheme 判断（暗主题 + 暗壁纸会被算成白纱）");

/* ② IO 那条路是活的 */
ok(/seen\.add\(el\);\s*\n\s*visIO\?\.observe\(el\)/.test(ENGINE), "settleAll 登记元素后没有 observe（visible 会空 → 视频漂移空转）");
ok(!/if \(!resettle && tracked\.has\(el\)\) return;/.test(ENGINE), "引擎里又出现了 tracked 早退（定格会整台失效）");
ok(/const settled = new WeakSet/.test(ENGINE), "缺少 settled 集合（定格生命周期靠它）");

/* ③ 视频采真实帧 */
ok(/\.shell-wallpaper video/.test(ENGINE), "找不到壁纸 <video> 的取样口（视频壁纸会被当纯色）");
ok(/drawCover\(ctx, v,/.test(ENGINE), "视频帧没有 drawImage 进采样画布");
ok(/VIDEO_TICK_MS/.test(ENGINE), "缺少视频重采样节拍（画面在动，静态近似必然过期）");

if (fails.length) {
  console.log("对比度护栏：不通过");
  for (const f of fails) console.log("  ✗ " + f);
  process.exit(1);
}
console.log(`对比度护栏：纱 alpha 与 CSS 同值（暗 ${cssDark} / 亮 ${cssLight}）✓ 定格链路（settled + observe）✓ 视频真实帧 ✓`);
