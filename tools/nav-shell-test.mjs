import { readFileSync } from "node:fs";

/* 护栏：导航壳（B4）。移动端底栏 = MD3 navigation bar；PC 侧栏 = MD3 navigation drawer/rail。
   底栏：5 目的地、单个滑动胶囊（secondary-container，复用蓝条那套共享的导航运动）、
   图标压在胶囊上、安全区、无描边、无横向蓝条。
   侧栏：宽度 ≤ 240px、激活项整行胶囊、分区小标题令牌化、旧竖条指示器退役、折叠钮无描边。 */
const CSS = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const MOTION = readFileSync("apps/desktop/src/styles/motion.css", "utf8");
const TOKENS = readFileSync("packages/ui/src/tokens.css", "utf8");
const LAYOUT = readFileSync("apps/desktop/src/components/Layout.tsx", "utf8");
const MOTION_TS = readFileSync("apps/desktop/src/lib/motion.ts", "utf8");
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
const ind = pick(".bottom-nav-pill", /64px/);
ok(ind !== null, "底栏缺少 active indicator 胶囊");
if (ind) {
  /* C4（霖 2026-10-01 走查）：胶囊高度改成按当前项的内容盒实测（32px 装不下一行标签，
     文字会从下沿露出来），宽度也跟标签走、下限 64px。这里只钉「宽度下限来自常量、
     高度不写死」——具体数值由 useBottomNavPill 现算。 */
  ok(/width:\s*64px/.test(ind), "胶囊宽度下限不是 64px（NAV_PILL_MIN_W）");
  ok(/height:\s*var\(--nav-pill-h/.test(ind) && /top:\s*var\(--nav-pill-top/.test(ind),
    "胶囊高度/top 又写死了（应走 --nav-pill-h / --nav-pill-top，由内容盒实测写入）");
  ok(!/height:\s*32px/.test(ind), "胶囊又写回 height: 32px");
  /* 霖 2026-10-07：半径必须**同时**保留全圆角令牌、又按实测高度夹住（min(令牌, h/2)）——
     只写令牌时高度不足会被按比例压缩成方角，只写 h/2 又绕开了令牌纪律。 */
  const radiusDecl = (ind.match(/border-radius:[^;]*;/) || [""])[0];
  ok(/corner-full/.test(radiusDecl) && /nav-pill-h/.test(radiusDecl) && /\/\s*2\)/.test(radiusDecl), "胶囊圆角不是「令牌与实测高度取小」（曲率会随高度退化）");
  ok(/secondary-container/.test(ind), "胶囊底色未走 secondary-container");
}
ok(/\.bottom-nav-pill\.is-ready\s*\{[^}]*opacity:\s*1/.test(CSS), "胶囊未在就位后点亮");
/* 胶囊是单个滑动元素：运动复用蓝条那套共享常量，只换轴、不拉伸；横向蓝条方案已撤 */
ok(!/bottom-nav-indicator/.test(CSS) && !/bottom-nav-indicator/.test(LAYOUT), "横向蓝条未撤除");
ok(/bottom-nav-pill/.test(LAYOUT) && /useBottomNavPill\(\)/.test(LAYOUT), "底栏未接 useBottomNavPill（会退回就地淡入）");
const hook = /export function useBottomNavPill[\s\S]*$/.exec(MOTION_TS);
ok(hook !== null, "motion.ts 未导出 useBottomNavPill");
if (hook) {
  ok(/NAV_EASE/.test(hook[0]) && /NAV_APEX/.test(hook[0]) && /NAV_BOUNCE_MS/.test(hook[0]), "胶囊运动未复用共享常量（会与蓝条那套分叉）");
  ok(/NAV_ROWS_KNEE/.test(hook[0]) && /NAV_DUR_SLOPE/.test(hook[0]), "胶囊运动缺少惯性/时长共享常量");
  ok(/scaleX/.test(hook[0]) && /scaleY/.test(hook[0]), "胶囊未做横向拉伸 + 竖向收窄（缺运动感）");
  ok(/NAV_PILL_STRETCH_MAX/.test(hook[0]) && /NAV_PILL_SQUASH/.test(hook[0]), "胶囊形变未走专用常量");
  ok(/1 - \(sx - 1\) \* NAV_PILL_SQUASH/.test(hook[0]), "竖向收窄未与横向拉伸按比例耦合");
  ok(/translateX\([\s\S]{0,120}scaleX\([\s\S]{0,60}scaleY\(/.test(hook[0]), "位置与形变不在同一条 transform 里（会各走一条线程而错位）");
  ok(/translateX/.test(hook[0]), "胶囊运动不是水平位移");
  /* D2：挤压相位 + 只动 transform + reduced-motion 降级 */
  ok(
    /NAV_PILL_SQUASH_APEX/.test(hook[0]) && /NAV_PILL_SQUASH_WIDE/.test(hook[0]) && /Math\.sin\(Math\.PI \* sq\)/.test(hook[0]),
    "D2：胶囊没有挤压相位（减速接近目标时应横向收短、竖向变厚再弹回）",
  );
  ok(/1 - NAV_PILL_SQUASH_APEX \* bump/.test(hook[0]) && /1 \+ NAV_PILL_SQUASH_APEX \* NAV_PILL_SQUASH_WIDE \* bump/.test(hook[0]), "D2：挤压没有按「横向收多少、竖向就厚多少」耦合");
  ok(!/frames\.push\(\{[^}]*\b(width|height|left|top|margin|padding)\s*:/.test(hook[0]), "D2：形变动画动了布局属性（只许 transform，否则触发布局与重排）");
  ok(/prefersReducedMotion\(\)/.test(hook[0]), "D2：胶囊形变没有 reduced-motion 降级");
  /* 连点打断（review-animations「可中断性」）：底栏是一秒内可能连点两次的元件。
     WAAPI 不会自动取消旧动画——旧的若更长，会在新的播完后继续把 transform 抢回去；
     起点也必须取当前表现值，否则会从上次的逻辑落点跳一下。 */
  ok(
    /function presentationCenter[\s\S]{0,900}?getAnimations\([\s\S]{0,400}?\.cancel\(\)/.test(MOTION_TS),
    "连点打断：起新动画前没有取消旧动画（旧动画会在新的播完后夺回 transform）",
  );
  ok(
    /presentationCenter\(pill\)/.test(hook[0]) && /const prev = present \?\? target;/.test(hook[0]),
    "连点打断：起点不是当前表现值（会从上次逻辑落点跳一下）",
  );
  ok(
    /const sameTarget = target !== null && Math\.abs\(target - c1\) < 0\.5;/.test(hook[0]) && /if \(sameTarget\) return;/.test(hook[0]),
    "目标没变时又重启动了动画（无关重渲染会让胶囊一顿一顿）",
  );
}
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
/* 竖条不再出现在任何位置（其运动由底栏胶囊接手） */
ok(/\.nav-indicator\s*\{\s*display:\s*none/.test(MOTION), "侧栏竖条未关闭（与 drawer 整行胶囊风格不匹配）");
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
console.log("导航壳护栏：底栏 5 Tab + 胶囊按内容盒实测（宽度下限 64） + 安全区 + 无描边 ✓ 侧栏 ≤240px + 整行胶囊 + 侧栏竖条关闭 + 分区标题 ✓ 底栏滑动胶囊 ✓ 无横向蓝条 ✓ 圆角一致 ✓ 底栏不收缩 ✓");
