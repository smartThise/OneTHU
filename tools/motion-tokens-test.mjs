/**
 * 动效令牌守卫（§3.6）。
 *
 * 动效的问题全是「看不见的」：曲线写错、退场借用进场曲线、兼容层没接上新原语——
 * 不报错、不崩、截图也看不出来（静态图里动效等于不存在），只能靠人肉感受。
 * 所以把可判定的部分钉死：
 *   1. MD3 原语齐备（3 条曲线族 + 5 个时长档）；
 *   2. 兼容层 --dur-* / --ease-* 必须指向原语，不准留硬编码值（否则「全应用统一曲线」是假的）；
 *   3. 退场（.is-closing / sheet 下滑 / toast 淡出）不得使用进场曲线；
 *   4. prefers-reduced-motion 全量降级还在；
 *   5. 「待办页元素错峰出场」确实落地（容器带 stagger 类）。
 */
import { readFileSync } from "node:fs";

const MOTION = "apps/desktop/src/styles/motion.css";
const GLOBAL = "apps/desktop/src/styles/global.css";
const TASKS = "apps/desktop/src/pages/TasksPage.tsx";
/* 扫规则前先剥注释：注释里出现 .is-closing 字样会把正则带到下一条规则上去（真发生过） */
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ");
const src = stripComments(readFileSync(MOTION, "utf8"));
const globalSrc = stripComments(readFileSync(GLOBAL, "utf8"));
const fails = [];

/* 1. MD3 原语 */
const PRIMITIVES = [
  "--md-sys-motion-easing-emphasized:",
  "--md-sys-motion-easing-emphasized-decelerate:",
  "--md-sys-motion-easing-emphasized-accelerate:",
  "--md-sys-motion-easing-standard:",
  "--md-sys-motion-easing-standard-decelerate:",
  "--md-sys-motion-easing-standard-accelerate:",
  "--md-sys-motion-duration-short-2:",
  "--md-sys-motion-duration-short-4:",
  "--md-sys-motion-duration-medium-2:",
  "--md-sys-motion-duration-medium-4:",
  "--md-sys-motion-duration-long-2:",
];
for (const p of PRIMITIVES) if (!src.includes(p)) fails.push("缺少 MD3 动效原语 " + p);

/* 2. 兼容层必须指向原语（--dur-1 例外：按压反馈保留原值） */
for (const name of ["--dur-2", "--dur-3", "--dur-4", "--ease-out", "--ease-in-out", "--ease-ios"]) {
  const m = src.match(new RegExp(name.replace(/[-]/g, "\\-") + "\\s*:\\s*([^;]+);"));
  if (!m) { fails.push("兼容层缺少 " + name); continue; }
  if (!m[1].includes("var(--md-sys-motion-")) fails.push(name + " 没有接到 MD3 原语：" + m[1].trim());
}

/* 3. 退场必须用 accelerate（不能用进场曲线，也不能写死贝塞尔） */
const exitRules = [
  ...[...src.matchAll(/[^\n]*is-closing[^{]*\{([^}]*)\}/g)].map((m) => [MOTION, m[0].trim(), m[1]]),
  ...[...globalSrc.matchAll(/[^\n]*is-closing[^{]*\{([^}]*)\}/g)].map((m) => [GLOBAL, m[0].trim(), m[1]]),
];
let exitChecked = 0;
for (const [file, sel, body] of exitRules) {
  if (!body.includes("animation")) continue; // 只查有动画的退场规则
  exitChecked++;
  if (/cubic-bezier|\d+ms|\d+\.\d+s/.test(body)) fails.push("退场写死了曲线/时长（应用令牌）：" + sel);
  else if (!body.includes("-accelerate")) fails.push("退场没用 accelerate 曲线：" + sel);
}

/* 4. 无障碍降级 */
if (!src.includes("@media (prefers-reduced-motion: reduce)")) fails.push("prefers-reduced-motion 全量降级不见了");

/* 5. 待办页错峰出场落地 */
if (!/className="tasks-learn stagger"/.test(readFileSync(TASKS, "utf8"))) {
  fails.push("待办页元素错峰出场没落地（tasks-learn 缺 stagger 类）");
}

/* 6. 待办页右侧详情：形态切换（展开/收起）与生活↔详情的过渡必须真的接线。
       这两处用户明确报过「没有动画」——它们都是「条件渲染 + 硬切换」，
       没有任何 CSS 能自动生效，全靠组件里显式接线，所以必须钉住。 */
const tasksSrc = readFileSync(TASKS, "utf8");
if (!tasksSrc.includes("ref={detailRef}") || !tasksSrc.includes("el.animate(")) {
  fails.push("展开/收起 没有 FLIP 接线（position: static→fixed 不可过渡，必须有 detailRef + el.animate）");
}
if (!tasksSrc.includes("prefersReducedMotion()")) {
  fails.push("展开/收起 的 FLIP 没有减弱动态效果判断（CSS 的 1ms !important 管不到 WAAPI）");
}
/* 三个入口都要走 toggleFull：分栏头的「展开」、全屏头的「收起」、Esc。
   漏一个就是"这个入口没动画"——用户报过一次，所以逐条点名。 */
if (!tasksSrc.includes("toggleFull(!pcFull)")) fails.push("分栏头的展开/收起按钮没走 toggleFull（点它不会有动画）");
if ((tasksSrc.match(/toggleFull\(false\)/g) ?? []).length < 2) {
  fails.push("收起入口（全屏头的收起按钮 / Esc）没走 toggleFull——至少有一处不会有动画");
}
if (!/tasks-detail tab-anim/.test(tasksSrc)) fails.push("生活 → 作业详情 没有进场动画（tasks-detail 缺 tab-anim）");
if (!/tasks-life tab-anim" data-dir="prev"/.test(tasksSrc)) fails.push("作业详情 → 生活 没有回退动画（tasks-life 缺 tab-anim + data-dir=prev）");

if (fails.length) {
  console.error("动效令牌守卫：不合格");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("动效令牌守卫：MD3 原语齐备 + 兼容层已接线 + 退场用 accelerate + 待办页错峰出场 ✓");
