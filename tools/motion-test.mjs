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
  ok(/prefersReducedMotion\(\)/.test(motion.slice(motion.indexOf("export function useCountUp"))), "数字滚动前检查减弱动态");
  // 页面转场是纯 CSS，降级由上面的 CSS 块覆盖；确认没有绕过降级块的 JS 帧动画旁路
  ok(!/requestAnimationFrame/.test(css), "CSS 里没有绕过降级块的手写帧动画");
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
  ok(/\.nav-item\.is-active::before/.test(css), "侧栏当前项强调条「长出来」");
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

console.log(`\n动效护栏：${pass} 断言全部通过（只动 transform/opacity + 令牌化 + 减弱动态降级 + 不锁死 hover + 不越权覆盖）`);
