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

if (fails.length) {
  console.error("动效令牌守卫：不合格");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("动效令牌守卫：MD3 原语齐备 + 兼容层已接线 + 退场用 accelerate + 待办页错峰出场 ✓");
