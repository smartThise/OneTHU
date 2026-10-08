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

/* 3b. B2 收敛（霖 2026-10-02）：裸 cubic-bezier 只许待在令牌文件里
     —— CSS 只认 styles/motion.css，JS 只认 lib/motion.ts（WAAPI 要字符串，没法用 var()）。 */
{
  const { readdirSync } = await import("node:fs");
  const files = [
    ...readdirSync("apps/desktop/src/styles").filter((f) => f.endsWith(".css")).map((f) => "apps/desktop/src/styles/" + f),
  ];
  for (const dir of ["apps/desktop/src/lib", "apps/desktop/src/components", "apps/desktop/src/pages", "apps/desktop/src/state", "apps/desktop/src/plugins"]) {
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
      const p = d + "/" + e.name;
      if (e.isDirectory()) return walk(p);
      return /\.(ts|tsx|css)$/.test(e.name) ? [p] : [];
    });
    files.push(...walk(dir));
  }
  const TOKEN_FILES = ["apps/desktop/src/styles/motion.css", "apps/desktop/src/lib/motion.ts"];
  const bad = files
    .filter((f) => !TOKEN_FILES.includes(f))
    .filter((f) => /cubic-bezier\s*\(/.test(readFileSync(f, "utf8")));
  if (bad.length) fails.push("裸 cubic-bezier 又散回业务文件（应登记成令牌）：" + bad.join(" / "));
  /* 新令牌必须真的存在且被用到，否则「收敛」只是把曲线删掉 */
  for (const t of ["--ease-smooth:", "--ease-overshoot-soft:", "--ease-overshoot:", "--ease-overshoot-strong:", "--ease-drop:"]) {
    if (!src.includes(t)) fails.push("缺少 B2 过冲/常规曲线令牌 " + t);
  }
  const tokenUsed = (name) => globalSrc.includes("var(" + name + ")");
  for (const t of ["--ease-smooth", "--ease-overshoot-soft", "--ease-overshoot", "--ease-overshoot-strong", "--ease-drop"]) {
    if (!tokenUsed(t)) fails.push("令牌没人用（等于没收敛）：" + t);
  }
  /* 过冲曲线不许被「顺手」换成标准曲线——那是手感退化（B2 反例） */
  if (/--ease-overshoot(-strong|-soft)?:\s*cubic-bezier\(0\.2, 0, 0, 1\)/.test(src)) {
    fails.push("过冲令牌被换成了标准曲线（B2 反例：手感退化）");
  }
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

/* 7. 入场 fill-mode（2026-10-07 从 review-animations 的发现补上）：
     入场动画用 both 会把 transform 钉在终帧，压掉同元素的 hover/active——K5「今日页余额速览按下
     是突变」就是这个根因，当时用独立 scale 属性绕过（旧引擎上仍是突变）。允许保留 both 的只有：
       ① 名字以 -out 结尾的退场（节点要播完退场再摘）、m-sheet-down；
       ② 必须保留终帧的两条：m-check-draw（描边终点）、ctx-bloom（clip-path 圆角是终帧承重的）；
       ③ ctx-blur-in / ctx-item-in：由 context-menu-test 钉住，且终帧与基态同值。 */
{
  const allow = new Set(["m-sheet-down", "m-check-draw", "ctx-bloom", "ctx-blur-in", "ctx-item-in"]);
  const collect = (t) =>
    [...t.matchAll(/animation:\s*([^;]+);/g)]
      .map((m) => m[1])
      .filter((d) => /\bboth\b/.test(d))
      .map((d) => d.trim().split(/\s+/)[0]);
  for (const [file, bad] of [
    [MOTION, collect(src).filter((n) => !/-out$/.test(n) && !allow.has(n))],
    [GLOBAL, collect(globalSrc).filter((n) => !/-out$/.test(n) && !allow.has(n))],
  ]) {
    if (bad.length) fails.push(file + " 的入场动画用了 both（会锁死 transform）：" + [...new Set(bad)].join(","));
  }
}

/* 8. animation 名必须有对应的 @keyframes：
     曾经 .data-table tbody tr 与 .week-course 都写着 `animation: rise …`，而 rise 关键帧全仓不存在
     ——动画静默失效、几轮评审都没发现（截图里动效等于不存在）。这里把这条堵死。 */
{
  const kf = new Set([
    ...[...src.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]),
    ...[...globalSrc.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]),
  ]);
  const keywords = new Set(["none", "inherit", "initial", "unset", "revert"]);
  const refs = [...(src + globalSrc).matchAll(/animation:\s*([\w-]+)/g)].map((m) => m[1]);
  const missing = [...new Set(refs)].filter((n) => !keywords.has(n) && !kf.has(n));
  if (missing.length) fails.push("animation 引用了不存在的 @keyframes：" + missing.join(","));
}

/* 9. 入场关��帧必须带上基态的锚定位移：
      关键帧里的 transform 是**整条替换**，漏掉锚定位移会让元素在动画期间先跳到锚点再弹回。
      提示条（translateX(-50%) 居中）是有记录的旧坑，trace-card（translate(-50%,-100%) 锚在标注上方）
      是 2026-10-07 复核时抓到的同类问题（它借用了 dock-msg-in，那条 from 是整条 translateY(4px)）。 */
/* ⚠️ 匹配必须**限定在关键帧自己的块内**（用 [^}]* 卡住 from/to 的括号）：
   早先写成 \{[\s\S]{0,220}?translateX(-50%) 时，窗口会跨出关键帧、命中紧随其后那条规则里的
   同名位移，注入反例打不红（真发生过）。 */
if (!/@keyframes m-toast-in \{[\s\S]{0,40}?from \{[^}]*translateX\(-50%\)/.test(src) ||
    !/@keyframes m-toast-out \{[\s\S]{0,40}?to \{[^}]*translateX\(-50%\)/.test(src)) {
  fails.push("提示条关键帧丢了 translateX(-50%)（动画期间会先偏右再弹回）");
}
if (!/@keyframes trace-card-in \{ from \{[^}]*translate\(-50%, -100%\)/.test(globalSrc)) {
  fails.push("trace-card 的入场关键帧丢了 translate(-50%, -100%) 锚定位移（动画期间会跳到锚点再弹回）");
}

if (fails.length) {
  console.error("动效令牌守卫：不合格");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("动效令牌守卫：MD3 原语齐备 + 兼容层已接线 + 退场用 accelerate + 待办页错峰出场 ✓");
