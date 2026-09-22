/**
 * 动效护栏（local/anim-delight 自用分支）：「丝滑」不能靠随手加动画，得守住几条硬纪律。
 *
 * 守什么：
 *  1) 只动 transform/opacity（合成器线程）——keyframes 里出现 width/height/top/left 直接判失败；
 *  2) 时长/缓动走令牌，不散落魔法数字；总时长有上限（>700ms 的交互动画就是"卡"）；
 *  3) 入场动画必须 animation-fill-mode: backwards——用 both 会把 transform 锁在终值，
 *     压过 :hover/:active（按压回弹、悬浮抬起会整体失效），这是最容易踩的坑；
 *  4) 必须尊重 prefers-reduced-motion（CSS 全量降级 + JS 侧判断）；
 *  5) 重效果（模糊）只在桌面；涟漪只在 is-phone；
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
  ok(/installRipple\(\)/.test(main) && /export function installRipple/.test(motion), "涟漪在入口安装、实现收在 lib/motion.ts");
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
  ok(bothLines.every((l) => /m-toast-out|m-check-draw|m-sheet-down/.test(l)), `both 只留给"必须保留终帧"的退出动画（${bothLines.length} 处）`);
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
  ok(/prefersReducedMotion\(\)/.test(motion.slice(motion.indexOf("export function withViewTransition"))) , "转场前检查减弱动态");
  ok(/prefersReducedMotion\(\)/.test(motion.slice(motion.indexOf("export function useCountUp"))), "数字滚动前检查减弱动态");
}

console.log("[6] 分级开关：重效果只在桌面，涟漪只在真机");
{
  ok(/@media \(hover: hover\) and \(pointer: fine\)/.test(css), "悬浮抬起/模糊只在桌面指针设备");
  const blur = css.slice(css.indexOf("backdrop-filter"), css.indexOf("backdrop-filter") + 200);
  ok(/@media \(hover: hover\)/.test(css.slice(Math.max(0, css.indexOf("backdrop-filter") - 260), css.indexOf("backdrop-filter"))), "模糊被桌面媒体查询包住");
  ok(blur.length > 0, "模糊确实存在（桌面纵深）");
  ok(/\.is-phone \.btn/.test(css) && /if \(!isPhoneShell\(\)\) return;/.test(motion), "涟漪只在 is-phone 密度层生效（桌面不挂）");
}

console.log("[7] 无限动画白名单：不许页面一直在动");
{
  const infinite = [...css.matchAll(/animation:\s*([\w-]+)[^;]*infinite/g)].map((m) => m[1]);
  const allow = new Set(["shimmer", "m-breathe", "m-stripes"]);
  ok(infinite.every((n) => allow.has(n)), `无限动画只有骨架/呼吸/斜纹（实际：${[...new Set(infinite)].join(",")}）`);
}

console.log("[8] 页面转场：View Transitions 为主 + CSS 兜底，两条路都在");
{
  ok(/\.page-root\s*\{\s*view-transition-name: page;/.test(css), "转场容器单独命名（从根快照里抠出来单独动）");
  ok(/::view-transition-old\(page\)/.test(css) && /::view-transition-new\(page\)/.test(css), "新旧快照各自动画");
  ok(/::view-transition-group\(page\)\s*\{\s*animation: none;/.test(css), "容器几何不插值（两页高度不同也不拉伸）");
  ok(/data-nav-dir="forward"/.test(css) && /data-nav-dir="back"/.test(css), "方向感：前进/后退不同曲线");
  ok(/page-anim/.test(css) && /"page-root page-anim"/.test(app), "不支持 View Transitions 的宿主退回 CSS 转场");
  ok(/VT_OK/.test(app) && /startViewTransition/.test(app), "宿主能力探测（避免快照抓到动画起始帧＝透明）");
  ok(/withViewTransition\(\(\) => \{[\s\S]{0,900}?setPage\(p\)/.test(appState), "navigate 走转场");
  ok(/hashchange[\s\S]{0,900}?withViewTransition/.test(appState), "浏览器后退/前进也走转场");
  ok(/flushSync\(apply\)/.test(motion), "React 状态同步提交（否则快照抓不到新 DOM）");
}

console.log("[9] 各个角落的接线：微交互、页签、弹层、提示、数字、主题");
{
  ok(/\.btn:active,[\s\S]{0,200}?scale\(0\.965\)/.test(css), "按钮/行/芯片统一按压回弹");
  ok(/\.row-caret\s*\{[\s\S]{0,120}?transition: transform/.test(css), "折叠箭头旋转过渡");
  ok(/\.nav-item\.is-active::before/.test(css), "侧栏当前项强调条「长出来」");
  ok(/\.tab-anim\s*\{/.test(css), "页签内容切换进场");
  const tabs = ["pages/info/InfoPage.tsx", "pages/info/LifePage.tsx", "pages/info/ReservePage.tsx", "pages/FolderPage.tsx"];
  const tabHits = tabs.map((f) => (src(f).match(/tab-anim/g) ?? []).length);
  ok(tabHits.every((n) => n > 0), `四个多页签页面都接了 tab-anim（${tabHits.join("/")}）`);
  ok(/tab-anim" : undefined/.test(src("pages/info/InfoPage.tsx")), "页签容器保持挂载（只切类名，不丢页签状态）");
  ok(/confirm-mask/.test(confirm) && /confirm-card/.test(confirm), "确认框接了遮罩淡入 + 卡片弹簧");
  ok(/confirm-mask/.test(preview) && /confirm-card/.test(preview), "文件预览面板同款进场");
  ok(/is-closing/.test(app) && /\.toast\.is-closing/.test(css), "提示条有退出相位（不是瞬间消失）");
  ok(/EXIT_MS/.test(toast) && /beginExit/.test(toast), "退出相位由状态机驱动（先播动画再卸载）");
  ok(/useCountUp/.test(widgets) && /num-roll/.test(widgets), "统计数字滚动");
  ok(/typeof num === "number"/.test(widgets), "只滚数值型（–/¥12.34 这类字符串原样显示）");
  ok(/theme-anim/.test(theme) && /html\.theme-anim/.test(css), "换主题时颜色平滑过渡");
  ok(/lastThemeId !== null/.test(theme), "启动首次应用不挂过渡（避免开场整页渐变）");
  ok(/is-scrolled/.test(layout) && /\.mobile-topbar\.is-scrolled/.test(css), "移动端顶栏滚动浮起");
  ok(/\.drawer \.nav-item/.test(css), "抽屉导航逐项进场");
  ok(/\[data-pdf-page\]/.test(css) && /\[data-pptx-page\]/.test(css), "预览逐页淡入");
}

console.log("[10] 弹层风格统一：遮罩淡入 + 面板弹簧（内联样式的那些也要接上）");
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

console.log(`\n动效护栏：${pass} 断言全部通过（只动 transform/opacity + 令牌化 + 减弱动态降级 + 不锁死 hover）`);
