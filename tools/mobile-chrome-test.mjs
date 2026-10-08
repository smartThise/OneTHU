#!/usr/bin/env node
/**
 * M1 · C1 + C2 + D3 护栏：移动端滚动收敛 + 顶/底栏两端固定 + 滚动条与 overscroll。
 *
 * 为什么要有它：这几条是「结构约定」，退化了肉眼很难当场发现——最典型的退化是
 * 底栏被某次改动挪回窗口级 fixed、或有人把 overscroll 放开，于是上拉时整页拉伸、
 * 底栏跟着跑（用户最先看到的就是这个）。所以按语义钉死：
 *
 *   1. 结构：`{children}` 直接挂在 `main.content` 下（**中间不得再有包裹节点**），
 *      顶栏与底栏都在 `main.content` **外面**（同一层 flex 兄弟）；
 *      —— 中间多包一层会切断既有选择器链：待办页靠 `.content:has(.tasks-body) > .page-anim`
 *      传高度、PC 靠 `.content:has(> .page-anim[data-page=…])` 定宽，都会静默失效
 *      （曾用 `.app-scroll` 包了一层，待办页被截断、还多出 33px 滚动，真机复现过）。
 *   2. 移动端媒体块（≤839.98px）内：html/body overflow hidden + overscroll none，
 *      `.content` 自身 overflow-y auto / overscroll none / scrollbar-gutter stable；
 *   3. 安全区 padding 加在栏自身（顶栏 top、底栏 bottom）；
 *   4. 末端反馈（D3）由内容区自己做：越界拖拽按阻尼位移、松手回弹，两栏不参与
 *      （Chromium 原生拉伸只作用于根滚动器，子滚动器即使 `contain` 也没有反馈，实测过）；
 *   5. PC 不受影响：这些声明只出现在 ≤840 媒体块里，基础 `.shell` 仍是 grid 两端结构；
 *   6. 两处滚动读数（顶栏浮起、回顶按钮）认当前滚动容器，不再直接读 window.scrollY。
 *
 * 跑法：node tools/mobile-chrome-test.mjs ｜ 退出码 0（通过）/ 1（违规）
 */
import { readFileSync } from "node:fs";

const CSS = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const LAYOUT = readFileSync("apps/desktop/src/components/Layout.tsx", "utf8");

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

/** 取某个 @media (max-width: 839.98px) 块的正文（含嵌套花括号配平） */
function mobileBlocks(css) {
  const out = [];
  const re = /@media\s*\(max-width:\s*839\.98px\)\s*\{/g;
  let m;
  while ((m = re.exec(css))) {
    let i = m.index + m[0].length, depth = 1, start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    out.push(css.slice(start, i - 1));
  }
  return out;
}
const inMobile = (needle) => mobileBlocks(CSS).some((b) => b.includes(needle));
/** 某偏移是否落在移动端媒体块内 */
function insideMobile(idx) {
  const re = /@media\s*\(max-width:\s*839\.98px\)\s*\{/g;
  let m;
  while ((m = re.exec(CSS))) {
    let i = m.index + m[0].length, depth = 1;
    while (i < CSS.length && depth > 0) {
      if (CSS[i] === "{") depth++;
      else if (CSS[i] === "}") depth--;
      i++;
    }
    if (idx > m.index && idx < i) return true;
  }
  return false;
}
/** 顶层（非任何媒体块内）是否出现某声明 —— 用来确认 PC 没被改动 */
function topLevelHas(css, needle) {
  let s = css, stop = false;
  while (!stop) {
    const m = /@media[^{]*\{/.exec(s);
    if (!m) break;
    let i = m.index + m[0].length, depth = 1, start = i;
    while (i < s.length && depth > 0) {
      if (s[i] === "{") depth++;
      else if (s[i] === "}") depth--;
      i++;
    }
    const before = s.slice(0, m.index);
    if (before.includes(needle)) return true;
    s = before + s.slice(i);
    if (!/@media/.test(s)) stop = true;
  }
  return s.includes(needle);
}

/* 1) 结构：{children} 直接挂在 main.content 下，两栏在 main.content 之外 */
ok(/<main className="content" ref=\{contentRef\}>\s*\{children\}\s*<\/main>/.test(LAYOUT),
  "Layout：{children} 未直接挂在 main.content 下（中间多一层会切断 .page-anim 选择器链）");
const mainOpen = LAYOUT.indexOf('<main className="content"');
const mainClose = LAYOUT.indexOf("</main>", mainOpen);
const mainBody = mainOpen > -1 && mainClose > mainOpen ? LAYOUT.slice(mainOpen, mainClose) : "";
ok(headerIdxCheck(), "顶栏必须在 main.content 之外（滚动时两栏不参与）");
function headerIdxCheck() {
  const h = LAYOUT.indexOf('className={"mobile-topbar"');
  return h > -1 && h < mainOpen;
}
ok(!mainBody.includes("mobile-topbar") && !mainBody.includes("<BottomNav"),
  "两栏不得被放进 main.content");
const navIdx = LAYOUT.indexOf("<BottomNav");
ok(navIdx === -1 || navIdx > mainClose, "底栏应在 main.content 之后（在它外面）");
ok(!/className="app-scroll"/.test(LAYOUT), "Layout 又出现了 .app-scroll 包裹层（会切断选择器链）");
ok(!/\.app-scroll\s*\{/.test(CSS), "global.css 又出现了 .app-scroll 规则（滚动容器应就是 .content）");

/* 1b) 既有选择器链仍在（它们依赖 .page-anim 是 .content 的直接子节点） */
ok(/\.content:has\(\.tasks-body\)\s*>\s*\.page-anim/.test(CSS),
  "待办页高度链 .content:has(.tasks-body) > .page-anim 不见了（会被截断）");
ok(/\.content:has\(>\s*\.page-anim\[data-page="info"\]\)/.test(CSS),
  "PC 的 .content:has(> .page-anim[data-page=…]) 宽度规则不见了");

/* 2) 移动端媒体块内的滚动约定 */
ok(inMobile("overflow: hidden"), "移动端媒体块缺 html/body overflow: hidden");
ok(inMobile("overscroll-behavior: none"), "移动端媒体块缺 overscroll-behavior: none（D3）");
ok(/\.content\s*\{[^}]*overflow-y:\s*auto/.test(CSS), ".content 缺 overflow-y: auto（它才是滚动容器）");
ok(/\.content\s*\{[^}]*scrollbar-gutter:\s*stable/.test(CSS), ".content 缺 scrollbar-gutter: stable（C2/D5）");
ok(/\.content\s*\{[^}]*overscroll-behavior:\s*none/.test(CSS), ".content 缺 overscroll-behavior: none（D3）");

/* 3) 安全区 padding 落在栏自身 */
ok(/\.mobile-topbar\s*\{[^}]*padding[^;}]*var\(--safe-top/.test(CSS), "顶栏顶部安全区未走 --safe-top（直接写 env() 会与原生壳重复计算）");
const MAIN = readFileSync("apps/desktop/src/main.tsx", "utf8");
ok(/--safe-top/.test(MAIN) && /screen/.test(MAIN) && /innerHeight/.test(MAIN), "main.tsx 缺 --safe-top 的运行时判定");
ok(/syncSafeTop\(\)/.test(MAIN) && /addEventListener\("resize", syncSafeTop\)/.test(MAIN), "--safe-top 未在启动与 resize 时同步");
ok(/\.bottom-nav\s*\{[^}]*padding[^;}]*env\(safe-area-inset-bottom/.test(CSS), "底栏未在自身加 safe-area-inset-bottom padding");

/* 3b) C4：底栏激活胶囊的 top/高度必须来自量测，不许写死小像素值 */
const MOTION = readFileSync("apps/desktop/src/lib/motion.ts", "utf8");
const pillStart = CSS.indexOf(".bottom-nav-pill {");
const pillBlock = CSS.slice(pillStart, CSS.indexOf("}", pillStart) + 1);
ok(pillStart >= 0 && /top:\s*var\(--nav-pill-top/.test(pillBlock), "底栏胶囊 top 不是 --nav-pill-top（写死值会让文字从胶囊下沿露出来）");
ok(/height:\s*var\(--nav-pill-h/.test(pillBlock), "底栏胶囊高度不是 --nav-pill-h（写死 32px 装不下一行标签）");
/* 霖 2026-10-07 走查：胶囊只盖住文字上半部分。根因是 top 换算把底栏自身的 padding-top
   扣了两次（绝对定位的包含块是内边距盒，`top: 0` 已在 padding 之外）——只许减 border-top；
   并且纵向要有对称内衬，胶囊才算完全包裹图标 + 标签。 */
const pillTopExpr = (MOTION.match(/--nav-pill-top"[^;]*;/) || [""])[0];
ok(pillTopExpr.length > 0 && !/navPadTop/.test(pillTopExpr) && /navBorderTop/.test(pillTopExpr), "胶囊 top 换算又去减底栏 padding-top 了（会重复扣掉，胶囊上移）");
ok(/NAV_PILL_PAD_Y/.test(MOTION) && /NAV_PILL_PAD_Y \* 2/.test(MOTION), "胶囊没有纵向对称内衬（图标/标签会贴边或露出）");
ok(/@supports \(corner-shape: squircle\)/.test(CSS), "corner-shape 增强没有 @supports 守卫（WebView 96 会解析整条丢弃）");
ok(/--nav-pill-top/.test(MOTION) && /--nav-pill-h/.test(MOTION),
  "useBottomNavPill 没有把实测的内容盒高度写进 --nav-pill-h / --nav-pill-top");
ok(/box\.height - padTop - padBottom/.test(MOTION) && /parseFloat\(cs\.paddingTop\)/.test(MOTION),
  "胶囊高度没按当前项的内容盒（item 高度减自身上下 padding）量");
ok(/NAV_PILL_MIN_W/.test(MOTION), "缺胶囊宽度下限常量 NAV_PILL_MIN_W");
ok(!/height:\s*32px/.test(pillBlock), "底栏胶囊又写回 height: 32px");

/* 3c) C5：移动端硬刷新入口在顶栏右侧，右下角不再有浮层 */
const topbarSlice = LAYOUT.slice(LAYOUT.indexOf('className={"mobile-topbar"'), LAYOUT.indexOf("</header>"));
ok(topbarSlice.includes('className="topbar-refresh"') && /aria-label="硬刷新"/.test(topbarSlice),
  "移动端顶栏里没有硬刷新入口（C5）");
ok(/topbar-refresh[\s\S]{0,400}window\.location\.reload\(\)/.test(LAYOUT) || /window\.location\.reload\(\)[\s\S]{0,400}topbar-refresh/.test(LAYOUT),
  "顶栏刷新入口没有真的触发整页重载");
/* 霖 2026-10-02 复看：「···」要在最右侧（与刷新键交换）——最右上角留给最常用的入口 */
{
  const moreIdx = topbarSlice.indexOf('className="topbar-more"');
  const refreshIdx = topbarSlice.indexOf('className="topbar-refresh"');
  ok(moreIdx >= 0 && refreshIdx >= 0 && moreIdx > refreshIdx, "「···」不在刷新键右侧（最右上角应是更多操作）");
  const topIdx = topbarSlice.indexOf('className="topbar-top"');
  ok(topIdx === -1 || (topIdx < refreshIdx && refreshIdx < moreIdx), "「回到顶层」/刷新/「···」三者的左右顺序不对");
}
ok(/export function HardRefreshButton\(/.test(LAYOUT), "HardRefreshButton 组件被删了（PC 端还要用，属于功能减法）");
ok(/\.hard-refresh-fab \{ display: none; \}/.test(CSS), "手机档没有把右下角刷新浮层藏掉（右下角仍不干净）");

/* 4) 末端反馈（D3）：内容区自己做，两栏不参与 */
ok(/function attachEdgeFeedback\(el: HTMLElement\)/.test(LAYOUT), "Layout 缺 attachEdgeFeedback（末端反馈会彻底消失）");
ok(/const EDGE_FREE = \d+/.test(LAYOUT) && /const EDGE_MAX = \d+/.test(LAYOUT) && /const EDGE_COEF = 0?\.\d+/.test(LAYOUT) && /const EDGE_OMEGA = \d+/.test(LAYOUT),
  "末端反馈缺橡皮筋常量（直接跟手带 / 渐进上限 / 系数）或弹簧角频率");
/* 霖 2026-10-02 #8：改用 gesture-rubber-band.md 的公式（limit 之前 1:1、之后渐进抵抗） */
ok(/const rubber = \(x: number\): number/.test(LAYOUT)
  && /const damped = EDGE_FREE \+ \(excess \* EDGE_COEF\) \/ \(1 \+ \(excess \* EDGE_COEF\) \/ EDGE_MAX\)/.test(LAYOUT),
  "末端反馈不是橡皮筋（没有渐近抵抗，位移会撞到硬墙）");
ok(/const springTo0 = \(v0: number\)/.test(LAYOUT) && /-EDGE_OMEGA \* EDGE_OMEGA \* over - 2 \* EDGE_ZETA \* EDGE_OMEGA \* vel/.test(LAYOUT),
  "末端反馈缺速度驱动的弹簧收尾（回弹变成固定时长缓动，与速度无关）");
/* 霖 2026-10-02 #8：临界阻尼（ζ=1）——一次平滑收回；旧的 ζ=0.42 + 反向过冲封顶会来回震 */
ok(/const EDGE_ZETA = 1;/.test(LAYOUT) && !/EDGE_BACK_MAX/.test(LAYOUT) && /if \(over \* dir < 0\) \{\s*\n\s*over = 0;/.test(LAYOUT),
  "末端反馈不是临界阻尼：ζ 不是 1、或还留着反向过冲封顶（霖实测会像弹簧一样来回震）");
ok(/springTo0\(dragV \* 1000\)/.test(LAYOUT) && /dragV = dragV \* 0\.6 \+ /.test(LAYOUT),
  "松手回弹没带初速度（手指速度未进物理量）");
ok(/springTo0\(-peak \* 1000\)/.test(LAYOUT), "惯性撞到末端没用弹簧初速度，或方向符号错了（顶部会把内容往上推，看不见反馈）");
ok(/el\.style\.transform = over === 0 \? "" : `translateY\(\$\{rubber\(over\)\.toFixed\(2\)\}px\)`/.test(LAYOUT), "末端反馈未作用在内容区元素自身");
ok(/const opts = \{ passive: true, capture: true \}/.test(LAYOUT)
  && /window\.addEventListener\("touchstart", onStart, opts\)/.test(LAYOUT)
  && /window\.addEventListener\("touchmove", onMove, opts\)/.test(LAYOUT), "末端反馈监听必须 passive 且挂 window 捕获阶段（元素层会丢收尾事件）");
ok(/window\.addEventListener\("touchend", onEnd, opts\)/.test(LAYOUT)
  && /window\.addEventListener\("pointerup", onEnd, opts\)/.test(LAYOUT)
  && /setTimeout\(release, \d+\)/.test(LAYOUT), "末端反馈缺收尾事件/保险丝（真机出现过 transform 永久停在 44px）");
ok(/el\.contains\(e\.target\)/.test(LAYOUT), "末端反馈未限定在内容区内（会接管两栏上的触摸）");
ok(!/pointercancel", onEnd/.test(LAYOUT), "末端反馈把 pointercancel 当收尾：浏览器接管滚动时它就会触发，回弹刚起来就被清零（实测只剩 2px）");
ok(/prefers-reduced-motion: reduce/.test(LAYOUT), "末端反馈未尊重 prefers-reduced-motion");
ok(/ownsEdge/.test(LAYOUT), "末端反馈未避让内层滚动器（内层在滚时整页不该跟着动）");
ok(/const ta = cs\.touchAction \|\| "auto"/.test(LAYOUT) && /pan-\(y\|up\|down\)/.test(LAYOUT),
  "末端反馈未避让「自己接管手势」的子组件（touch-action）：待办页卡片流是 overflow:hidden + JS 驱动，滑卡片会整页过冲");
ok(/const AXIS_MIN = \d+/.test(LAYOUT) && /axis = Math\.abs\(dx\) > Math\.abs\(dy\) \? "x" : "y"/.test(LAYOUT),
  "末端反馈没有轴向锁定（横向滑动时整页会跟着抖/过冲）");
/* 4b) 惯性回弹：手指抬起后靠惯性滑到末端也要有反馈 */
ok(/const FLING_MIN = 0?\.\d+/.test(LAYOUT), "缺惯性回弹速度下限 FLING_MIN");
ok(/if \(!edge && !springRaf && room > 1\)/.test(LAYOUT), "惯性回弹未避开拖拽中与回弹中两个状态");
ok(/el\.addEventListener\("scroll", onScroll, \{ passive: true \}\)/.test(LAYOUT)
  && /el\.removeEventListener\("scroll", onScroll\)/.test(LAYOUT), "惯性回弹未挂/未摘 scroll 监听");
ok(/Math\.abs\(over\) > 0\.1 \|\| Math\.abs\(vel\) > 20/.test(LAYOUT), "弹簧没有收敛判据（会一直跑 rAF）");
ok(/now - peakAt > 300/.test(LAYOUT) && /Math\.abs\(v\) > Math\.abs\(peak\)/.test(LAYOUT), "惯性回弹只看末帧瞬时速度（末帧已在减速，会时灵时不灵）");
ok(/const EDGE_SNAP = 2/.test(LAYOUT) && /room - EDGE_SNAP/.test(LAYOUT), "末端判定没留 scrollHeight 取整余量（末帧永远差 1px 判不到）");
/* 4c) 顶栏毛玻璃：内容必须从顶栏底下滚过，栏高由 --topbar-h 实测 */
ok(/backdrop-filter: blur\(/.test(CSS), "顶栏毛玻璃被删了（backdrop-filter）");
ok(/\.mobile-topbar\s*\{[^}]*margin[^;}]*var\(--topbar-h/.test(CSS), "顶栏未用负 margin（= 栏高）把滚动容器上沿提到自己底下，毛玻璃会没东西可糊");
ok(/\.content\s*\{[^}]*padding[^;}]*var\(--topbar-h/.test(CSS), "内容区上内边距未让开栏高（首行会被顶栏盖住）");
ok(/\.mobile-topbar\s*\{[^}]*z-index:\s*3\d/.test(CSS), "顶栏 z-index 未压过滚动容器（上沿那截滚动条会露出来）");
ok(/ResizeObserver/.test(LAYOUT) && /setProperty\("--topbar-h"/.test(LAYOUT), "缺 --topbar-h 的实测写回（栏高会退回写死的兜底值）");
/* 7) 顶栏换场（霖 2026-10-02 #7）：logo↔返回键、标题变化都要交叉进出场 */
ok(/const TOPBAR_SWAP_MS = \d+;/.test(LAYOUT) && /function useSwap<T>\(value: T\)/.test(LAYOUT),
  "顶栏缺换场（旧的一份要多留一拍才能和新的一份交叉播放）");
ok(/const leadSwap = useSwap<"logo" \| "back">\(lead\)/.test(LAYOUT) && /const titleSwap = useSwap\(title\)/.test(LAYOUT),
  "顶栏没把 logo/返回键与标题接到换场上");
/* 第四批 #6：标题只做新文字从右渐入，旧文字直接消失——所以退场那份只该留在 logo/返回键上 */
ok(/className="topbar-lead-out is-out"/.test(LAYOUT) && !/className="topbar-title is-out"/.test(LAYOUT),
  "顶栏换场：logo/返回键缺退场那份，或标题又留下了退场副本（霖第四批 #6 要旧标题直接消失）");
ok(/className=\{"topbar-title" \+ \(titleSwap\.swapping \? " is-in" : ""\)\} key=\{title\}/.test(LAYOUT),
  "标题换场没挂 key={title}：同元素改 class 只会补播，换标题要重挂才重播进场动画");
{
  /* 进场的一份必须排在前：`.topbar-back` / `.topbar-title` 的查询要拿到当前那一份 */
  const iIn = LAYOUT.indexOf('className={"topbar-back" + (leadSwap.swapping ? " is-in" : "")}');
  const iOut = LAYOUT.indexOf('className="topbar-lead-out is-out"');
  ok(iIn > 0 && iOut > iIn, "顶栏换场把退场的那一份排在了前面（查询 .topbar-back 会拿到退场副本）");
}
ok(/@keyframes topbar-logo-out \{[\s\S]*?translateX\(-10px\)/.test(CSS) && /@keyframes topbar-logo-in \{[\s\S]*?translateX\(-10px\)/.test(CSS),
  "logo 换场方向不对（霖要的是退向左、进从左）");
ok(/@keyframes topbar-back-out \{[\s\S]*?translateX\(14px\)/.test(CSS) && /@keyframes topbar-back-in \{[\s\S]*?translateX\(14px\)/.test(CSS),
  "返回键换场方向不对（霖要的是退向右、进从右）");
ok(/@keyframes topbar-title-in \{[\s\S]*?translateX\(12px\)/.test(CSS) && !/@keyframes topbar-title-out/.test(CSS),
  "标题换场方向不对（霖第四批 #6 只留「新文字从右渐入」，topbar-title-out 该删掉了）");
ok(/\.topbar-lead-out \{ position: absolute/.test(CSS) && /\.topbar-lead-out \{[^}]*pointer-events: none;/.test(CSS),
  "退场的那一份没有脱离布局/没放行点击（换场时会挤动标题、还可能挡住返回键）");
/* 2) 全站禁止选中（霖 2026-10-02 #2） */
ok(/html,\s*\nbody \{\s*\n\s*-webkit-user-select: none;\s*\n\s*user-select: none;/.test(CSS),
  "全站没有禁止文字选中（长按还会把正文框蓝）");
ok(/input,\s*\ntextarea,\s*\nselect,\s*\n\[contenteditable="true"\],\s*\n\.selectable \{\s*\n\s*-webkit-user-select: text;/.test(CSS),
  "禁选没有给输入框留例外（输入框里没法选词/改错字）");
const selStart = LAYOUT.indexOf("function attachEdgeFeedback");
const fbBody = LAYOUT.slice(selStart, LAYOUT.indexOf("\n}\n", selStart));
ok(!/mobile-topbar|bottom-nav/.test(fbBody), "末端反馈碰了两栏（只有内容区能动）");

/* 5) PC 不受影响 */
ok(topLevelHas(CSS, ".shell {") && /\.shell\s*\{\s*display:\s*grid/.test(CSS), "PC 基础 .shell 不再是 grid 两端结构");
/* 霖 2026-10-06（组4 · C1 的 PC 验收）：`.content` 的 scrollbar-gutter 现在**也**进 PC 档——
   PC 是整页滚动，靠 overflow-y:scroll + stable 锁住内容宽度；其余两条仍只许在手机档。 */
for (const decl of ["overflow-y: auto", "overscroll-behavior: none"]) {
  const re = new RegExp("\\.content\\s*\\{[^}]*" + decl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
  let m;
  while ((m = re.exec(CSS))) ok(insideMobile(m.index), `.content 的「${decl}」出现在非移动端媒体块（PC 会被改到）`);
}

ok(/@media \(min-width: 841px\)[\s\S]{0,600}\.content \{ scrollbar-gutter: stable/.test(CSS), "PC 档缺 .content 的 scrollbar-gutter: stable（组4 C1 的 PC 验收）");

/* 6) 滚动读数认容器 */
ok(LAYOUT.includes("readScrollTop"), "Layout 未使用 readScrollTop（滚动读数应认 .content）");
ok(!/setTopbarScrolled\(window\.scrollY/.test(LAYOUT), "顶栏浮起仍在直接读 window.scrollY");
ok(!/setShowTop\(window\.scrollY/.test(LAYOUT), "回顶按钮仍在直接读 window.scrollY");
ok(/useEffect\(\(\)\s*=>\s*\{[^}]*contentEl\(\)\?\.scrollTo\s*\(\{\s*top:\s*0/.test(LAYOUT), "换页未把滚动容器归零（切页会停在上一页的偏移）");

if (fails.length) {
  console.error("移动端外壳护栏（C1/C2/D3）：");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("移动端外壳护栏：内容区滚动 + 两栏两端固定 + 末端回弹 + 滚动条槽稳定 ✓");
console.log("  结构：{children} 直挂 .content、两栏在外 ✓｜.page-anim 选择器链完好 ✓｜安全区 padding 在栏自身 ✓｜PC 仍是整页滚动 ✓");
