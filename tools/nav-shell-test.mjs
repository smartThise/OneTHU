import { readFileSync } from "node:fs";

/* 护栏：导航壳（B4）。移动端底栏 = MD3 navigation bar；PC 侧栏 = MD3 navigation drawer/rail。
   底栏：5 目的地、64×32 胶囊指示器（secondary-container）、图标压在胶囊上、安全区、无描边。
   侧栏：宽度 ≤ 240px、激活项整行胶囊、分区小标题令牌化、旧竖条指示器退役、折叠钮无描边。 */
const CSS = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const MOTION = readFileSync("apps/desktop/src/styles/motion.css", "utf8");
const TOKENS = readFileSync("packages/ui/src/tokens.css", "utf8");
const LAYOUT = readFileSync("apps/desktop/src/components/Layout.tsx", "utf8");
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

/* 从 from 起找 selector 的规则体（同名规则可能有多处，媒体查询里的才是真身） */
function block(selector, from = 0) {
  const i = CSS.indexOf(selector, from);
  if (i < 0) return null;
  const j = CSS.indexOf("}", i);
  return CSS.slice(i, j);
}

/* --- 移动端 navigation bar ---
   注意：@media (max-width: 839.98px) 在文件里有多处，且 .bottom-nav { 的第一处是
   桌面端的 .bottom-nav { display: none }。因此按**内容特征**挑真身，不靠下标。 */
function pick(selector, feature) {
  let from = 0;
  for (;;) {
    const i = CSS.indexOf(selector, from);
    if (i < 0) return null;
    const j = CSS.indexOf("}", i);
    const b = CSS.slice(i, j);
    if (feature.test(b)) return b;
    from = i + 1;
  }
}
const nav = pick(".bottom-nav {", /position:\s*fixed/);
ok(nav !== null, "未找到底栏真身规则（position: fixed）");
if (nav) {
  ok(/repeat\(5, 1fr\)/.test(nav), "底栏不是 5 等分（新 IA 是 5 Tab）");
  ok(!/border-top/.test(nav), "底栏用描边分层（应走色阶/高程，B2 约定）");
  ok(/safe-area-inset-bottom/.test(nav), "底栏未吃 safe-area 内边距（刘海屏会压住）");
}
const item = pick(".bottom-nav-item {", /flex-direction:\s*column/);
ok(item !== null, "未找到底栏项真身规则（flex-direction: column）");
if (item) {
  ok(/position:\s*relative/.test(item), "底栏项不是相对定位（胶囊指示器无处安放）");
  ok(/font-weight:\s*500/.test(item), "底栏标签未按 label-medium 加中粗");
}
const ind = pick(".bottom-nav-item::before", /64px/);
ok(ind !== null, "底栏缺少 active indicator 胶囊");
if (ind) {
  ok(/width:\s*64px/.test(ind) && /height:\s*32px/.test(ind), "胶囊尺寸不是 MD3 的 64×32");
  ok(/corner-full/.test(ind), "胶囊圆角未走 --md-sys-shape-corner-full");
  ok(/secondary-container/.test(ind), "胶囊底色未走 secondary-container");
}
ok(/\.bottom-nav-item\.is-active::before\s*\{[^}]*opacity:\s*1/.test(CSS), "激活态未点亮胶囊指示器");
ok(/\.bottom-nav-item > \*\s*\{[^}]*z-index:\s*1/.test(CSS), "图标/文字未压在胶囊之上");
ok(/\{ page: "today", label: "今日"/.test(LAYOUT) && /label: "我的"/.test(LAYOUT), "底栏 5 目的地不全");
ok(/aria-current={active \? "page"/.test(LAYOUT), "底栏激活项缺 aria-current");

/* --- PC navigation drawer/rail --- */
const w = /--sidebar-w:\s*(\d+)px/.exec(TOKENS);
ok(w !== null, "tokens.css 未定义 --sidebar-w");
if (w) ok(Number(w[1]) <= 240, "侧栏宽度未收窄到 ≤ 240px（当前 " + w[1] + "px）");
const side = block(".sidebar {");
ok(side !== null, "未找到 .sidebar 规则");
if (side) {
  ok(!/border-right/.test(side), "侧栏用描边分层（应走色阶，B2 约定）");
  ok(/surface-container/.test(side), "侧栏背景未走 System 色阶令牌");
}
const navActive = block(".nav-item.is-active {");
ok(navActive !== null, "未找到 .nav-item.is-active 规则");
if (navActive) {
  ok(/secondary-container/.test(navActive), "侧栏激活项未用 secondary-container 胶囊");
  ok(/corner-full/.test(navActive), "侧栏激活胶囊圆角未走 corner-full");
}
/* 竖条是刻意设计（用户确认）：必须在，且已按胶囊调形 */
const bar = /\/\* -+ B4：3px 竖条指示器与胶囊共存[\s\S]*?\.nav-indicator \{([\s\S]*?)\}/.exec(MOTION);
ok(bar !== null, "竖条指示器规则未找到（B4 恢复块）");
if (bar) {
  ok(/left:\s*6px/.test(bar[1]), "竖条未内缩 6px（会顶到胶囊圆角切线外）");
  ok(/corner-full/.test(bar[1]), "竖条圆角未走 corner-full（与胶囊形状语言不一致）");
}
ok(!/\.nav-indicator\s*\{\s*display:\s*none/.test(MOTION), "竖条仍处于退役状态（用户要求保留）");
ok(/\.nav-item \{[^}]*border-radius:\s*var\(--md-sys-shape-corner-full/.test(CSS), "hover 底色与激活胶囊圆角不一致");
ok(/\.sidebar-foot \{[^}]*flex:\s*none/.test(CSS), "侧栏底未禁止收缩（会被压扁致折叠钮与「就绪」重合）");
ok(/\.nav-label\s*\{[^}]*on-surface-variant/.test(CSS), "分区小标题未令牌化");
ok(/\.sidebar-collapse\s*\{[^}]*border:\s*0/.test(CSS), "折叠钮仍用描边");

/* --- 顶部大标题（MD3 large top app bar）--- */
ok(/html\.is-phone \.page-head-title\s*\{[^}]*headline-medium-size/.test(CSS), "手机端页标题未走 headline-medium 大标题令牌");
ok(!/html\.is-phone \.page-head-title\s*\{[^}]*font-size:\s*20px/.test(CSS), "手机端页标题仍是 20px（未升为大标题）");

if (fails.length) {
  console.error("导航壳护栏：不通过");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("导航壳护栏：底栏 5 Tab + 64×32 胶囊 + 安全区 + 无描边 ✓ 侧栏 ≤240px + 整行胶囊 + 竖条保留并调形 + 分区标题 ✓ 圆角一致 ✓ 底栏不收缩 ✓");
