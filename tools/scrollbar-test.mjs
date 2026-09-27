/**
 * 滚动条护栏（用户任务：「不要平台默认风」）。
 *
 * 关键机制：Chromium ≥121 只要看到 scrollbar-width / scrollbar-color 被声明（除 none），
 * 就会整体忽略 ::-webkit-scrollbar —— 所以自定义样式与这两个属性**不能共存**。
 * 历史上 motion.css 的一条 * { scrollbar-width: thin } 就是这么把 PC 端的自定义滚动条打掉的。
 *
 * 断言：
 *   1) 全库不存在 scrollbar-width（none 除外）/ scrollbar-color 声明；
 *   2) base.css 有一套令牌化 ::-webkit-scrollbar（细拇指 + 悬停/拖拽 + 去箭头 + 透明轨道）；
 *   3) 滚动条颜色只走令牌，不写死 rgba/hex（否则暗色下会瞎）；
 *   4) 元素级覆盖只允许改宽度，不许重写拇指样式（否则绕开令牌）。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (f.endsWith(".css")) out.push(p);
  }
  return out;
}

const CSS_FILES = [...walk("apps/desktop/src"), ...walk("packages/ui/src")];
const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
};

/* [1] 陷阱：标准属性一旦声明就整体压制 ::-webkit-scrollbar */
for (const f of CSS_FILES) {
  const src = withoutComments(readFileSync(f, "utf8"));
  for (const m of src.matchAll(/scrollbar-width\s*:\s*([^;}]+)/g)) {
    ok(m[1].trim() === "none", f + " 出现 scrollbar-width: " + m[1].trim() + "（只允许 none，否则 ::-webkit-scrollbar 整体失效）");
  }
  ok(!/scrollbar-color\s*:/.test(src), f + " 不应声明 scrollbar-color（同上会压制自定义滚动条）");
}

/* [2] base.css 的令牌化滚动条 */
const BASE = withoutComments(readFileSync("packages/ui/src/base.css", "utf8"));
const rule = (sel) => {
  const i = BASE.indexOf(sel + " {");
  return i < 0 ? "" : BASE.slice(i, BASE.indexOf("}", i) + 1);
};
const bar = rule("*::-webkit-scrollbar");
ok(/width:\s*\d+px/.test(bar) && /height:\s*\d+px/.test(bar), "滚动条应有明确宽高（细）");
const thumb = rule("*::-webkit-scrollbar-thumb");
ok(thumb.includes("var(--md-sys-color-outline)"), "拇指底色应用中性令牌 --md-sys-color-outline");
ok(/border:\s*\d+px solid transparent/.test(thumb) && thumb.includes("background-clip: content-box"), "拇指应用透明边 + content-box 收细（细但好抓）");
ok(/border-radius:\s*(999px|var\()/.test(thumb), "拇指应是胶囊形");
ok(rule("*::-webkit-scrollbar-thumb:hover").includes("var(--md-sys-color-on-surface-variant)"), "悬停应加深（on-surface-variant）");
ok(rule("*::-webkit-scrollbar-thumb:active").includes("var(--md-sys-color-on-surface)"), "拖拽应更深（on-surface）");
ok(rule("*::-webkit-scrollbar-track").includes("transparent"), "轨道应透明");
ok(rule("*::-webkit-scrollbar-button").includes("display: none"), "应去掉两端箭头按钮");

/* [3] 颜色只走令牌 */
for (const sel of ["*::-webkit-scrollbar-thumb", "*::-webkit-scrollbar-thumb:hover", "*::-webkit-scrollbar-thumb:active"]) {
  const b = rule(sel);
  ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(b), sel + " 不应写死颜色（应用令牌，暗色才不瞎）");
}

/* [4] 元素级覆盖只改宽度 */
const APP = withoutComments(readFileSync("apps/desktop/src/styles/global.css", "utf8"));
const ruleIn = (src, sel) => {
  const i = src.indexOf(sel + " {");
  return i < 0 ? "" : src.slice(i, src.indexOf("}", i) + 1);
};
for (const sel of [".nav::-webkit-scrollbar", ".nav-folders-scroll::-webkit-scrollbar"]) {
  const b = ruleIn(APP, sel);
  ok(!!b, "找不到 " + sel);
  ok(/width:\s*\d+px/.test(b), sel + " 应给出宽度");
  ok(!/background|border-radius/.test(b), sel + " 只该改宽度，拇指样式统一走令牌");
}
ok(!/::-webkit-scrollbar-thumb\s*\{[^}]*var\(--border\b/.test(APP), "不应再用 --border 当拇指色（太淡，暗色下看不见）");

/* [5] 令牌确实存在 */
const TOKENS = readFileSync("packages/ui/src/tokens.css", "utf8");
for (const t of ["--md-sys-color-outline:", "--md-sys-color-on-surface-variant:", "--md-sys-color-on-surface:"]) {
  ok(TOKENS.includes(t), "tokens.css 缺少 " + t);
}

if (fails.length) {
  console.error("滚动条护栏：不通过");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("滚动条护栏：无 scrollbar-width/color 压制 ✓ 令牌化细滚动条 ✓ 悬停/拖拽加深 ✓ 去箭头 + 透明轨道 ✓ 元素级只改宽度 ✓");
