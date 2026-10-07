/**
 * 暗色套完整性守卫（§3.3）。
 *
 * 防的是「暗色漏网」：System 暗色套（:root[data-scheme="dark"]）少写一个角色，
 * 暗色下该角色就漏出亮色值——典型症状是骨架屏流光在暗底上打一道白光、
 * 或者卡片面变成刺眼的白色。这类 bug 不会报错，只在切到暗色主题时肉眼可见。
 *
 * 规则：亮色 :root 里声明的每个「随明暗变化」的角色（颜色/阴影/焦点环），
 *       暗色块必须也声明；形状与字阶是明暗无关的，不在检查范围。
 */
import { readFileSync } from "node:fs";

const CSS = "packages/ui/src/tokens.css";
const src = readFileSync(CSS, "utf8");

/** 截取某个选择器的块体（从选择器行到下一个顶层 }） */
function block(selector) {
  const i = src.indexOf(selector);
  if (i < 0) throw new Error("tokens.css 里找不到选择器 " + selector);
  const from = src.indexOf("{", i);
  const to = src.indexOf("\n}", from);
  return src.slice(from, to);
}
const roles = (text) =>
  [...new Set([...text.matchAll(/(--md-sys-[a-z0-9-]+)\s*:/g)].map((m) => m[1]))];

const light = roles(block(":root {"));
const dark = new Set(roles(block(":root[data-scheme=\"dark\"]")));

/** 明暗无关的角色：形状/字阶/间距——暗色不需要重复声明 */
/* 与明暗无关：形状/字阶/间距，以及"不透明度"这类纯数值状态（--md-sys-state-opacity-*）——
   禁用态的 38% 在明暗下是同一个值，暗色块里重复声明反而会掩盖"真的漏了角色"的情况 */
const schemeAgnostic = (r) =>
  r.startsWith("--md-sys-shape-") ||
  r.startsWith("--md-sys-typescale-") ||
  r.startsWith("--md-sys-spacing-") ||
  r.startsWith("--md-sys-state-opacity-");
const mustMirror = light.filter((r) => !schemeAgnostic(r));
const missing = mustMirror.filter((r) => !dark.has(r));

console.log("暗色套守卫：亮色随明暗变化的角色 " + mustMirror.length + " 个 / 暗色块 " + dark.size + " 个");
if (missing.length) {
  console.error("  ✗ 暗色块缺少 " + missing.length + " 个角色（暗色下会漏出亮色值）：");
  for (const r of missing) console.error("    " + r);
  process.exit(1);
}
console.log("  暗色块覆盖完整 ✓");
/* 通道接线：暗色开关必须由 theme.ts 的 dark 元数据驱动（手动通道），
   且清除主题时要一起摘掉，否则会残留暗色套。 */
const themeTs = readFileSync("apps/desktop/src/state/theme.ts", "utf8");
const wiring = [
  ['root.dataset.scheme = "dark"', "应用暗色主题时挂 data-scheme"],
  ['delete root.dataset.scheme', "切换/清除主题时摘掉 data-scheme"],
  ['def.dark', "开关取自主题的 dark 元数据"],
];
const wireFails = wiring.filter(([needle]) => !themeTs.includes(needle)).map(([, why]) => why);
if (wireFails.length) {
  console.error("  ✗ theme.ts 通道没接好：" + wireFails.join("；"));
  process.exit(1);
}
console.log("  theme.ts 双通道接线完整 ✓");

