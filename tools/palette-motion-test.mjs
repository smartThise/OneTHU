#!/usr/bin/env node
/**
 * 组 2 护栏（P 批 C13 / C14 / D8）：品牌字标、命令面板焦点环与提示字体、面板动效取舍。
 *
 * 为什么要有它：
 *  · C13 的字标此前是"五列网格 + 三种字体混排"的文字 hack，改回文字渲染只要一段 JSX，
 *    而它的形状/字距恰恰是这次要固定的东西；
 *  · C14 的等宽提示此前靠 <kbd> 的 UA 默认值（任何 font-family 重置都会把它打回衬线栈）；
 *  · D8 最容易滑坡成"给命令面板加入场动画 + 逐键 FLIP"——而 animate 门禁明确写着
 *    **keyboard shortcut / command palette toggle 是 100+/天，永不加动画**（Raycast 就不做）。
 *    这里把取舍钉死：只留 140ms 遮罩淡入 + 面板微升，结果项不许有逐键动画，减动效降级为纯淡入。
 */
import { readFileSync } from "node:fs";

const CSS = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const ICONS = readFileSync("apps/desktop/src/components/Icons.tsx", "utf8");
const LAYOUT = readFileSync("apps/desktop/src/components/Layout.tsx", "utf8");
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
/* 行首锚定：避免被「.sidebar .sb-kbd { ... }」这类同后缀的复合选择器抢先命中 */
const block = (sel) => {
  /* 行首锚定：避免被「.sidebar .sb-kbd { ... }」这类同后缀的复合选择器抢先命中 */
  const name = sel.replace(/ \{.*$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("(?:^|\\n)" + name + "\\s*\\{");
  const m = re.exec(CSS);
  if (!m) return "";
  const from = CSS.indexOf("{", m.index);
  const to = CSS.indexOf("}", from);
  return from < 0 || to < 0 ? "" : CSS.slice(m.index, to + 1);
};

/* ── C13 品牌字标：2026-10-06 按霖要求恢复为原「五列网格」写法 ── */
ok(/display:\s*inline-grid/.test(block(".brand-logo {")), "字标不是原来的五列网格（霖 2026-10-06 要求恢复）");
ok(/\.brand-logo \.word/.test(CSS) && /\.brand-logo \.u \{/.test(CSS) && /\.brand-logo \.p \{/.test(CSS), "五列网格的 .p/.word/.u 样式缺失（恢复不完整）");
ok(!/WordmarkOneTHU/.test(ICONS) && !/WordmarkOneTHU/.test(LAYOUT), "SVG 字标 WordmarkOneTHU 还在（霖要求恢复原状）");
ok(/color: var\(--text-1\)/.test(block(".brand-logo {")), ".brand-logo 没有把颜色交给主题令牌（--text-1）");
ok(/logoSvg/.test(LAYOUT), "主题插件整体替换字标的口径（theme.logoSvg）丢了");

/* ── C14 命令面板：等宽提示 + 容器级焦点环 ── */
for (const sel of [".pal-kbd {", ".sb-kbd {"]) {
  ok(/font-family:\s*var\(--font-mono\)/.test(block(sel)), sel + " 的快捷键提示没有显式走等宽栈（靠 UA 默认会在字体重置后落到衬线）");
}
ok(/outline:\s*none/.test(block(".pal-input {")), ".pal-input 应去掉输入框自身轮廓（环落在容器上）");
ok(/box-shadow:\s*var\(--md-sys-focus-ring\)/.test(block(".pal:focus-within")), "面板没有容器级焦点环，或环里混了别的投影（C14/C17 口径：环只走令牌、单独出现）");

/* ── D8 面板动效：按 animate 门禁取最短一档 ── */
const mask = block(".pal-mask {");
const pal = block(".pal {");
ok(/animation:\s*m-fade var\(--dur-1\) var\(--ease-out\)/.test(mask), "遮罩淡入没有走令牌（m-fade / --dur-1 / --ease-out）");
ok(/animation:\s*m-rise var\(--dur-1\) var\(--ease-out\)/.test(pal), "面板微升没有走令牌（m-rise / --dur-1 / --ease-out）");
ok(/backdrop-filter:\s*blur/.test(mask), "遮罩缺少（静态）周边模糊");
ok(!/scale\(0\)/.test(mask + pal), "面板动效里出现 scale(0)（禁止：不能从「无」里出现）");
ok(!/\.pal-row[^{]*\{[^}]*animation:/.test(CSS), "结果项有逐键动画——命令面板是键盘高频入口，animate 门禁要求不做（Raycast 也不做）");
ok(/animate 门禁|100\+\/天/.test(CSS), "CSS 里没有写明「按 animate 门禁取最短一档」的理由（下一轮会误判为漏做 D8）");
/* 减动效：降级为纯淡入（保留 opacity、去掉位移） */
const rm = CSS.slice(CSS.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
ok(/\.pal-mask[\s\S]{0,80}\.pal \{[\s\S]{0,120}animation-name:\s*m-fade/.test(rm), "减动效下没有把面板降级为纯淡入（D8 要求）");

if (fails.length) {
  console.error("组 2 护栏（C13 已按霖要求恢复原状 / C14 / D8）：不通过");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("组 2 护栏：字标为原五列网格（令牌着色 + 插件可替换）✓ 等宽提示 ✓ 容器级焦点环 ✓ 面板动效按 animate 门禁取最短一档（无逐键动画、减动效纯淡入）✓");
