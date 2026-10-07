/**
 * 动效护栏（local/anim-delight 自用分支）：「丝滑」不能靠随手加动画，得守住几条硬纪律。
 *
 * 守什么：
 *  1) 只动 transform/opacity（合成器线程）——keyframes 里出现 width/height/top/left 直接判失败；
 *  2) 时长/缓动走令牌，不散落魔法数字；总时长有上限（>700ms 的交互动画就是"卡"）；
 *  3) 入场动画必须 animation-fill-mode: backwards——用 both 会把 transform 锁在终值，
 *     压过 :hover/:active（按压回弹、悬浮抬起会整体失效），这是最容易踩的坑；
 *  4) 必须尊重 prefers-reduced-motion（CSS 全量降级 + JS 侧判断）；
 *  5) 重效果（模糊）只在桌面；按压纪律（紧凑控件缩放、整行只压暗底色，绝不改尺寸）；
 *  6) 无限循环动画必须白名单（骨架流光/呼吸点/进度斜纹），别让页面一直在动。
 *
 * 跑法：node tools/motion-test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let pass = 0;
const ok = (cond, label) => {
  assert.ok(cond, label);
  pass++;
  console.log(`  ✓ ${label}`);
};

const src = (p) => readFileSync(new URL(`../apps/desktop/src/${p}`, import.meta.url), "utf8");
const css = src("styles/motion.css");
const globalCss = src("styles/global.css");
const main = src("main.tsx");
const motion = src("lib/motion.ts");
const app = src("App.tsx");
const appState = src("state/app.tsx");
const toast = src("state/toast.ts");
const theme = src("state/theme.ts");
const layout = src("components/Layout.tsx");
const widgets = src("components/HomeWidgets.tsx");
const confirm = src("lib/confirm.tsx");
const preview = src("components/FilePreview.tsx");

console.log("[1] 动效层接线：必须在 global.css 之后导入（否则同选择器被覆盖）");
{
  const iGlobal = main.indexOf('import "./styles/global.css"');
  const iMotion = main.indexOf('import "./styles/motion.css"');
  ok(iGlobal >= 0 && iMotion > iGlobal, "motion.css 在 global.css 之后导入");
  ok(/installScrollReveal\(\)/.test(main) && /export function installScrollReveal/.test(motion), "滚动揭示在入口安装、实现收在 lib/motion.ts");
}

console.log("[2] 令牌：时长/缓动/位移都有名字，不在组件里散落魔法数字");
{
  for (const t of ["--dur-1", "--dur-2", "--dur-3", "--dur-4", "--ease-out", "--ease-in-out", "--ease-spring", "--ease-ios", "--stagger"]) {
    ok(css.includes(`${t}:`), `令牌 ${t} 已定义`);
  }
  const durs = [...css.matchAll(/--dur-\d:\s*(\d+)ms/g)].map((m) => Number(m[1]));
  ok(durs.length === 4 && durs.every((d) => d > 0 && d <= 600), `四档时长都在 1..600ms（实际 ${durs.join("/")}）`);
  ok(durs[0] < durs[1] && durs[1] < durs[2] && durs[2] < durs[3], "时长分级递增（微反馈 < 常规 < 容器 < 大场景）");
  const eases = [...css.matchAll(/--ease-[a-z-]+:\s*cubic-bezier\(([^)]+)\)/g)].map((m) => m[1]);
  ok(eases.length >= 4, `至少 4 条命名缓动曲线（实际 ${eases.length}）`);
  ok(eases.every((e) => e.split(",").length === 4), "缓动都是标准四参 cubic-bezier");
}

console.log("[3] 纪律：keyframes 只动合成器属性（不碰布局属性）");
{
  const bodies = [...css.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  ok(bodies.length >= 14, `keyframes 库成规模（${bodies.length} 组）`);
  const layoutProps = ["width", "height", "top", "left", "right", "bottom", "margin", "padding", "font-size", "line-height"];
  const bad = [];
  for (const b of bodies) {
    for (const p of layoutProps) {
      if (new RegExp(`(^|[;{\\s])${p}\\s*:`, "m").test(b)) bad.push(p);
    }
  }
  ok(bad.length === 0, `keyframes 里没有布局属性（违规：${bad.join(",") || "无"}）`);
  ok(!/transition:\s*all/.test(css), "没有 transition: all（性能反模式）");
  // 单条动画时长上限：超过 700ms 的交互动画会明显"发黏"
  const durs = [...css.matchAll(/animation:\s*[\w-]+[^;]*?(\d+)ms/g)].map((m) => Number(m[1]));
  ok(durs.every((d) => d <= 700), `CSS 里没有超过 700ms 的动画（最大 ${Math.max(...durs)}ms）`);
}

console.log("[4] 最容易踩的坑：入场动画必须 backwards（both 会锁死 transform，压过 hover/active）");
{
  ok(/animation-fill-mode|backwards;/.test(css), "入场动画用 backwards 归还样式");
  const bothLines = css.split("\n").filter((l) => /both;/.test(l));
  ok(bothLines.every((l) => /m-toast-out|m-check-draw|m-sheet-down|m-fade-out|m-spring-out/.test(l)), `both 只留给"必须保留终帧"的退出动画（${bothLines.length} 处）`);
  const backwards = (css.match(/backwards;/g) ?? []).length;
  ok(backwards >= 15, `入场动画全部 backwards（${backwards} 处）`);
}

console.log("[5] 无障碍：尊重系统「减弱动态效果」");
{
  ok(/@media \(prefers-reduced-motion: reduce\)/.test(css), "CSS 有减弱动态降级块");
  const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"), css.indexOf("@media (prefers-reduced-motion: reduce)") + 600);
  ok(/animation-duration:\s*1ms !important/.test(block), "降级动画时长");
  ok(/transition-duration:\s*1ms !important/.test(block), "降级过渡时长");
  ok(/animation-iteration-count:\s*1 !important/.test(block), "降级循环次数（呼吸/流光停）");
  ok(/export function prefersReducedMotion/.test(motion), "JS 侧同样有判断（不能只靠 CSS）");
  ok(/prefersReducedMotion\(\)/.test(motion.slice(motion.indexOf("export function useCountUp"))), "数字滚动前检查减弱动态");
  // 页面转场是纯 CSS，降级由上面的 CSS 块覆盖；确认没有绕过降级块的 JS 帧动画旁路
  ok(!/requestAnimationFrame/.test(css), "CSS 里没有绕过降级块的手写帧动画");
}

console.log("[6] 分级开关与按压纪律：重效果只在桌面，整行按压不改尺寸");
{
  ok(/@media \(hover: hover\) and \(pointer: fine\)/.test(css), "悬浮抬起/模糊只在桌面指针设备");
  const blur = css.slice(css.indexOf("backdrop-filter"), css.indexOf("backdrop-filter") + 200);
  ok(/@media \(hover: hover\)/.test(css.slice(Math.max(0, css.indexOf("backdrop-filter") - 260), css.indexOf("backdrop-filter"))), "模糊被桌面媒体查询包住");
  ok(blur.length > 0, "模糊确实存在（桌面纵深）");
  // 按压纪律（涟漪已整体移除，见 §17 回归断言）
  ok(/\.btn:active,[\s\S]{0,160}?scale\(0\.965\)/.test(css), "紧凑控件按压回弹（缩放）");
  ok(/\.row-click:active,[\s\S]{0,220}?background: var\(--hover\)/.test(css), "整行/整卡按压只压暗底色");
  ok(!/\.row-click:active,[\s\S]{0,220}?transform/.test(css), "整行/整卡按压不改尺寸（block 里不出现 transform）");
}

console.log("[7] 无限动画白名单：不许页面一直在动");
{
  const infinite = [...css.matchAll(/animation:\s*([\w-]+)[^;]*infinite/g)].map((m) => m[1]);
  const allow = new Set(["shimmer", "m-breathe", "m-stripes"]);
  ok(infinite.every((n) => allow.has(n)), `无限动画只有骨架/呼吸/斜纹（实际：${[...new Set(infinite)].join(",")}）`);
}

console.log("[8] 页面转场：只走 CSS 进场（快照转场已因整页残影移除，禁止回归）");
{
  ok(/\.page-anim\s*\{/.test(css), "转场容器 .page-anim 存在");
  ok(/data-dir="back"/.test(css) && /data-level="sub"/.test(css), "方向与层级两档曲线");
  ok(/page-anim/.test(app) && /key=\{page\}/.test(app), "key=page 让容器重新挂载并播一次进场");
  // 回归护栏（霖实测 2026-09-22）：整页快照交叉淡入会让旧页在新页下层残留 → 每次切换都闪
  ok(!/startViewTransition/.test(app + appState + motion), "导航不再调用 View Transitions（整页快照会残影）");
  ok(!/view-transition/.test(css), "CSS 里没有 ::view-transition 快照规则");
  ok(!/withViewTransition|flushSync/.test(appState + motion), "没有遗留的快照转场接线");
  ok(/useNavDirection/.test(app) && /useNavDirection/.test(motion), "方向由上一页比较得出（幂等，StrictMode 安全）");
}

console.log("[9] hover 策略：只让「点进去会跳转」的大卡位移");
{
  const hoverBlock = css.slice(css.indexOf("@media (hover: hover)"), css.indexOf("/* ---------- 6."));
  ok(/\.entry:hover\s*\{[\s\S]{0,120}?translate3d\(0, -2px, 0\)/.test(hoverBlock), "入口大卡 hover 上浮");
  ok(!/\.stat-card:hover\s*\{[\s\S]{0,160}?transform/.test(hoverBlock), "数字卡片 hover 不位移（只点亮边框/底色）");
  ok(/\.stat-card:hover\s*\{[\s\S]{0,120}?background: var\(--hover\)/.test(hoverBlock), "数字卡片 hover 改为底色反馈");
  ok(!/\.row-click:hover\s*\{[\s\S]{0,120}?transform/.test(hoverBlock), "列表行 hover 不做横向位移（鼠标横扫会抖）");
}

console.log("[10] 各个角落的接线：微交互、页签、弹层、提示、数字、主题");
{
  ok(/\.btn:active,[\s\S]{0,200}?scale\(0\.965\)/.test(css), "按钮/行/芯片统一按压回弹");
  ok(/\.row-caret\s*\{[\s\S]{0,120}?transition: transform/.test(css), "折叠箭头旋转过渡");
  ok(/\.nav-indicator\s*\{/.test(css), "侧栏当前项强调条由 .nav-indicator 统一绘制（可拉伸平移）");
  ok(/\.tab-anim\s*\{/.test(css), "页签内容切换进场");
  const tabs = ["pages/info/InfoPage.tsx", "pages/info/LifePage.tsx", "pages/info/ReservePage.tsx", "pages/FolderPage.tsx"];
  const tabHits = tabs.map((f) => (src(f).match(/tab-anim/g) ?? []).length);
  ok(tabHits.every((n) => n > 0), `四个多页签页面都接了 tab-anim（${tabHits.join("/")}）`);
  ok(/tab-anim" : undefined/.test(src("pages/info/InfoPage.tsx")), "页签容器保持挂载（只切类名，不丢页签状态）");
  ok(/confirm-mask/.test(confirm) && /confirm-card/.test(confirm), "确认框接了遮罩淡入 + 卡片弹簧");
  ok(/confirm-mask/.test(preview) && /confirm-card/.test(preview), "文件预览面板同款进场");
  ok(/is-closing/.test(app) && /\.toast-host\.is-closing/.test(css), "提示条有退出相位（不是瞬间消失）");
  ok(/EXIT_MS/.test(toast) && /beginExit/.test(toast), "退出相位由状态机驱动（先播动画再卸载）");
  ok(/useCountUp/.test(widgets) && /num-roll/.test(widgets), "统计数字滚动");
  ok(/typeof num === "number"/.test(widgets), "只滚数值型（–/¥12.34 这类字符串原样显示）");
  ok(/theme-anim/.test(theme) && /html\.theme-anim/.test(css), "换主题时颜色平滑过渡");
  ok(/lastThemeId !== null/.test(theme), "启动首次应用不挂过渡（避免开场整页渐变）");
  ok(/is-scrolled/.test(layout) && /\.mobile-topbar\.is-scrolled/.test(css), "移动端顶栏滚动浮起");
  ok(/\.drawer \.nav-item/.test(css), "抽屉导航逐项进场");
  ok(/\[data-pdf-page\]/.test(css) && /\[data-pptx-page\]/.test(css), "预览逐页淡入");
}

console.log("[11] 弹层风格统一：遮罩淡入 + 面板弹簧（内联样式的那些也要接上）");
{
  const files = [
    "components/ExtHwLoginModal.tsx", "components/TabManageModal.tsx", "pages/info/CardTab.tsx",
    "pages/zhjwxk/Courses.tsx", "pages/Schedule.tsx", "pages/info/NewsTab.tsx",
    "components/OnboardingTour.tsx", "pages/learn/Forum.tsx",
  ];
  for (const f of files) {
    const t = src(f);
    ok(/m-fade var\(--dur-2\)/.test(t) && /m-spring-in var\(--dur-3\)/.test(t), `${f.split("/").pop()} 遮罩+面板都接了动效`);
  }
}

console.log("[12] 不许覆盖既有动画选择器（基态可能靠 forwards 钉住，覆盖会闪没/重现）");
{
  // 扫描两文件里"定义了 animation 的选择器"（嵌套感知：@media/@supports 只当容器）
  const animatedSelectors = (text) => {
    const out = new Map();
    let sel = "";
    let inRule = false;
    let inKeyframes = false;
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("/*")) continue;
      if (line.startsWith("@media") || line.startsWith("@supports")) continue;
      if (line.startsWith("@keyframes") || line.startsWith("@-webkit-keyframes")) {
        inKeyframes = true;
        continue;
      }
      if (line.startsWith("}")) {
        if (inKeyframes) inKeyframes = false;
        else inRule = false;
        continue;
      }
      if (inKeyframes) continue;
      if (line.includes("{")) {
        sel = line.split("{")[0].trim();
        inRule = true;
        continue;
      }
      if (inRule && line.startsWith("animation:")) {
        for (const one of sel.split(",")) out.set(one.trim(), line.slice(10).trim().replace(/;$/, ""));
      }
    }
    return out;
  };
  const gAnim = animatedSelectors(globalCss);
  const mAnim = animatedSelectors(css);
  ok(gAnim.size >= 25, `global.css 里被动画的选择器扫描到 ${gAnim.size} 个`);
  // 允许清单：必须写明理由。默认禁止覆盖——既有动画的基态可能是"藏身态"
  // （如 .drawer 的 translateX(-100%)），靠 forwards 钉住可见位置，覆盖即闪没。
  const ALLOW = new Map([
    [".content", "基态可见（无 transform/opacity），换曲线安全"],
    [".toast-host", "基态可见；新动画自带 translateX(-50%) 居中（global 的 plg-up 反而丢了居中）"],
  ]);
  const clash = [...mAnim.keys()].filter((s) => gAnim.has(s) && !ALLOW.has(s));
  ok(clash.length === 0, `motion.css 未越权覆盖既有动画（越权：${clash.join(" | ") || "无"}）`);
  ok([...ALLOW.values()].every((why) => why && why.length > 6), "允许清单每条都写了理由");
  ok(!/^\.drawer\s*\{/m.test(css) && !/^\.drawer-mask\s*\{/m.test(css), "抽屉与遮罩沿用 global.css 的 drawer-in/out（基态 translateX(-100%) 靠 forwards 钉住）");
  ok(/^\.drawer \.nav-item\s*\{/m.test(css), "只给抽屉内导航项加逐项进场（基态可见，覆盖安全）");
  ok(/translateX\(-50%\)/.test(css.slice(css.indexOf("@keyframes m-toast-in"), css.indexOf("@keyframes m-toast-out"))), "提示条入场保留 -50% 居中");
  ok(/translateX\(-50%\)/.test(css.slice(css.indexOf("@keyframes m-toast-out"), css.indexOf("@keyframes m-toast-out") + 200)), "提示条退场保留 -50% 居中");
}

console.log("[13] 滚动揭示：进入视口才滑入，且不与挂载逐项进场叠加");
{
  const reveal = motion.slice(motion.indexOf("export function installScrollReveal"));
  ok(/if \(prefersReducedMotion\(\)\) return;/.test(reveal), "减弱动态时早退，不挂 has-reveal（元素保持可见）");
  ok(/documentElement\.classList\.add\("has-reveal"\)/.test(motion), "has-reveal 挂在 <html> 上");
  ok(/html\.has-reveal[\s\S]{0,400}?opacity: 0;\s*animation: none;/.test(css), "命中元素先置藏身态 + animation: none（压掉挂载进场）");
  ok(/\[data-reveal-in\][\s\S]{0,220}?animation: m-reveal-in/.test(css), "data-reveal-in 才播 m-reveal-in（两条规则必须同时存在）");
  ok(/\[data-reveal-in\][\s\S]{0,200}?opacity: 1/.test(css), "已揭示态显式 opacity: 1（否则动画播完回落藏身态集体隐身）");
  ok(/delete el\.dataset\.revealIn/.test(motion), "揭示标记用 data 属性（React 重写 className 抹不掉）");
  ok(/slot \* \(grid \? 9 : 30\)/.test(motion), "递延不封顶（网格按行 9ms / 列表逐项 30ms）");
  ok(/seen\.set\(top, seen\.size\)/.test(motion) && /batch\.sort\(\(a, b\) => a\.offsetTop - b\.offsetTop/.test(motion), "网格按行分组：同行同时、自上而下展开（不斜扫）");
  ok(!/io\.unobserve/.test(motion), "不注销观察（离开视口撤 .is-in，再进视野重播）");
  ok(/new MutationObserver/.test(motion) && /\}, 100\);/.test(motion), "动态内容由 MutationObserver 纳入（100ms 防抖）");
}

console.log("[14] 页签方向：内容按页签的左右关系滑入，不是一律同一侧");
{
  const tabs = ["pages/info/InfoPage.tsx", "pages/info/LifePage.tsx", "pages/info/ReservePage.tsx", "pages/FolderPage.tsx"];
  const texts = tabs.map((f) => src(f));
  ok(texts.every((t) => /useTabDirection/.test(t)), `四个多页签页面都接了 useTabDirection（${tabs.map((f) => f.split("/").pop()).join(" / ")}）`);
  ok(texts.every((t) => /data-dir=\{tabDir\}/.test(t)), "页签容器都挂了 data-dir={tabDir}");
  ok(/@keyframes m-tab-in\s*\{/.test(css) && /@keyframes m-tab-in-back\s*\{/.test(css), "两个方向的关键帧都存在");
  ok(/\.tab-anim\[data-dir="prev"\]/.test(css), "prev 方向走 m-tab-in-back");
}

console.log("[15] 退场相位：先播完退场再卸载（纯 CSS 做不到）");
{
  ok(/useExitPhase\(/.test(preview), "文件预览面板接了 useExitPhase");
  ok(/\.confirm-mask\.is-closing\s*\{[\s\S]{0,80}?animation: m-fade-out/.test(css), "遮罩退场相位");
  ok(/\.confirm-card\.is-closing\s*\{[\s\S]{0,80}?animation: m-spring-out/.test(css), "面板退场相位");
  ok(/export function useExitPhase\(active: boolean, ms = 200\)/.test(motion), "useExitPhase 默认 200ms");
  ok(/mounted: state !== "gone"/.test(motion) && /closing: state === "out"/.test(motion), "返回 { mounted, closing } 两态");
  ok(/window\.clearTimeout\(t\)/.test(motion), "退场定时器在重入/卸载时清理");
}

console.log("[16] 可展开：展开时内容滑入（折叠组不再是裸 Fragment）");
{
  ok(/\.nav-folded-body\s*\{[\s\S]{0,160}?animation: m-expand-in/.test(css), ".nav-folded-body 展开滑入");
  ok(/\.collect-row\s*\{[\s\S]{0,90}?animation: m-expand-in/.test(css), ".collect-row 展开滑入");
  ok(/@keyframes m-expand-in/.test(css), "m-expand-in 关键帧存在");
  ok(/className="nav-folded-body"/.test(layout), "折叠组渲染进 .nav-folded-body");
}

console.log("[17] 分段条滑动块 / 横幅 / 无涟漪回归");
{
  ok(/\.seg-pill\s*\{[\s\S]{0,420}?transform var\(--dur-3\)[\s\S]{0,90}?width var\(--dur-3\)/.test(css), ".seg-pill 的位移/宽度走 --dur-3 过渡");
  ok(/\.seg-pill\.is-ready\s*\{[\s\S]{0,60}?opacity: 1/.test(css), "is-ready 才显形（首帧不滑入）");
  ok(/\.segmented:has\(\.seg-pill\.is-ready\) button\.is-active\s*\{[\s\S]{0,90}?background: transparent/.test(css), "块就位后才撤按钮自带底色（量不到时保留底色）");
  ok(/export function useSegPill/.test(motion), "测量逻辑收在 lib/motion.ts");
  const sites = [layout, src("pages/MailPage.tsx"), src("pages/Plugins.tsx")];
  ok(sites.every((t) => /className="seg-pill"/.test(t)), "三处 .segmented 都渲染了滑动块（SegmentedOverflow / 邮箱 / 插件）");
  ok(/\.browser-hint\s*\{[\s\S]{0,90}?animation: m-rise/.test(css), "引导横幅出现不突变");
  ok(!/installRipple/.test(main + motion + css + layout), "涟漪已整体移除（无 installRipple 残留）");
  ok(!/\.is-phone \.btn/.test(css), "没有 is-phone 涟漪规则");
}
console.log("[18] 预览退场接线 / 下载提示 / 滚动揭示可重播");
{
  ok(/"confirm-mask" \+ \(closing \? " is-closing" : ""\)/.test(preview), "预览遮罩关闭时挂 .is-closing（此前漏接，关掉没有动画）");
  ok(/"confirm-card" \+ \(closing \? " is-closing" : ""\)/.test(preview), "预览面板关闭时挂 .is-closing");
  ok(/fp-dl-hint/.test(preview) && /\.fp-dl-hint/.test(css), "下载提示（蓝色那条）有入场/退场动效");
  ok(!/dlMsg=\{dlMsg\}/.test(preview), "灰色下载提示已移除（只留蓝色那条，不再同信息渲染两遍）");
  ok(!/io\.unobserve/.test(motion), "滚动揭示不注销元素：往回滚再进视野会重播");
  ok(/delete el\.dataset\.revealIn/.test(motion), "离开视口撤标记（回藏身态，方向无关）");
}
console.log("[19] 侧栏指示条 / 邮箱推入 / 二级弹层退场 / 方阵网格");
{
  ok(/export function useNavIndicator/.test(motion), "侧栏指示条测量收在 lib/motion.ts");
  ok(/className="nav-indicator"/.test(layout), "侧栏与抽屉都渲染了 .nav-indicator（NavBody）");
  ok(/\.nav-indicator\s*\{[\s\S]{0,700}?transition: opacity var\(--dur-2\) var\(--ease-out\);/.test(css), "指示条只保留 opacity 过渡（运动由 WAAPI 一段式驱动）");
  ok(/\.nav-indicator\s*\{[\s\S]{0,320}?z-index: 1/.test(css), "指示条在当前项灰底之上（此前被盖住）");
  ok(/Math\.max\(bottom - top, 2\) \* 3/.test(motion), "拉伸上限 3 个行高（相距远不拉成长条）");
  ok(/Math\.min\(220, Math\.max\(140,/.test(motion), "时长按距离算（140–220ms），近处快远处稳");
  ok(/8 \* u \* u \* u \* u/.test(motion), "指示条端点走四次缓入缓出（非线性明显，不再像匀速）");
  ok(/Math\.max\(bottom - top, 2\) \* 0\.2 \* bounce/.test(motion) && /const BOUNCE = bounce > 0 \? 200 : 0/.test(motion), "到位后有刹车回弹（满额 1/5 项高、200ms；相邻项连回弹窗都不挂）");
  ok(/const rows = Math\.abs\(c1 - c0\) \/ Math\.max\(bottom - top, 1\)/.test(motion) && /\(rows - 1\.15\) \/ \(5 - 1\.15\)/.test(motion) && /const bounce = ramp \* ramp/.test(motion), "回弹强度按路程递增（1.15 行内为 0、二次渐入、5 行满额）");
  ok(/new DOMMatrixReadOnly\(tf\)\.m42/.test(motion) && /box\.top - riseY/.test(motion), "量测扣掉导航项自身的入场动画位移（否则抽屉一开条偏下，滑一下才回正）");
  ok(/addEventListener\("animationend", onSettle\)/.test(motion) && /addEventListener\("transitionend", onSettle\)/.test(motion), "动画/过渡结束后兜底重新对位");
  ok(/const apex = c1 \+ over/.test(motion) && /translateY\(\$\{c1 - BAR \/ 2\}px\) scaleY\(1\)/.test(motion) && /const SOFT = "cubic-bezier\(0\.45, 0, 0\.55, 1\)"/.test(motion), "行程终点=惯性顶点，收尾一帧回到精确位置（穿过目标位不停顿、峰值两侧 ease-in-out）");
  ok(!/0\.22, 1, 0\.36, 1/.test(motion), "旧的 easeOutQuint 回程已移除（起步过快，峰值处速度突跳）");
  ok(!/bar\.animate\(sizes/.test(motion) && /bar\.animate\(frames, \{ duration: total \}\)/.test(motion), "位置与长度同属一条动画（拆成两条会各走各的：主线程卡住时条按自身长度探出去）");
  ok(/translateY\(\$\{\(ta \+ tb\) \/ 2 - BAR \/ 2\}px\) scaleY\(/.test(motion) && !/bar\.style\.height/.test(motion), "位置与长度都用 transform 表达（合成器一条曲线，没有主线程的 height）");
  ok(/@keyframes m-grid-in/.test(css) && /m-grid-in var\(--dur-2\) var\(--ease-out\) backwards/.test(css), "网格入场用小幅 m-grid-in（6px 上浮 + 0.99 缩放）");
  ok(/\.nav-item\.is-active::before\s*\{\s*\n\s*display: none;/.test(css), "每项自己的 ::before 强调条退位（避免双条）");
  ok(/\.mail-layout:not\(\.detail-open\) \.mail-detail/.test(css) && /\.mail-layout\.detail-open \.mail-list/.test(css), "邮箱窄屏：列表/详情 transform 推入推出（不再 display 硬切）");
  ok(/export function useExitHold/.test(motion), "useExitHold 收在 lib/motion.ts（弹层退场相位 + 内容保持）");
  ok(/\.plg-mask\.is-closing/.test(css) && /\.plg-sheet\.is-closing/.test(css), "插件 Sheet 遮罩/面板有退场动画");
  ok(/sheetHold/.test(src("pages/Plugins.tsx")), "插件页 Sheet 接了退场相位");
  ok(/\.mail-compose-mask\.is-closing/.test(css) && /composeHold/.test(src("pages/MailPage.tsx")), "写信弹层有退场动画");
  ok(/html\.has-reveal :is\(\.app-grid, \.thos-grid\) > \* \{/.test(css) && /html\.has-reveal :is\(\.app-grid, \.thos-grid\) > \*\[data-reveal-in\]/.test(css), "方阵网格纳入滚动揭示（可见才入场，视口外不再错过动画）");

  console.log("\n[20] 日程：弹层退场 + 课表块入场");
  const sched = src("pages/Schedule.tsx");
  ok(/const detailHold = useExitHold\(detail, 220\)/.test(sched) && /const draftHold = useExitHold\(draft, 220\)/.test(sched), "日程详情/编辑弹层各接退场相位");
  ok(/m-fade-out var\(--dur-2\) var\(--ease-out\) both/.test(sched), "日程遮罩退场淡出");
  ok(/m-spring-out var\(--dur-2\) var\(--ease-out\) both/.test(sched), "日程面板退场收回");
  ok(/detailHold\.held/.test(sched) && /draftHold\.held/.test(sched), "退场期间沿用最后一次内容（不闪空壳）");
  ok(/m-rise var\(--dur-2\) var\(--ease-out\) backwards/.test(sched) && /blockRows\.get/.test(sched), "课表块按行（时间带）上浮入场：同排同时、时间自上而下");
  ok(/visiblePlaced\.map\(\(p, i\) =>/.test(sched) && /new Set\(visiblePlaced\.map/.test(sched), "行号由起始时刻去重排序得出（不是数组序号，避免按列扫）");
  ok(/ymdOf\(weekStart\)/.test(sched) && /key=\{/.test(sched), "块 key 带周戳：切周整批重播入场");
}
console.log(`\n动效护栏：${pass} 断言全部通过（只动 transform/opacity + 令牌化 + 减弱动态降级 + 不锁死 hover + 不越权覆盖）`);
