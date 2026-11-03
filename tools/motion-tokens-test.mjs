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
for (const name of ["--dur-2", "--dur-3", "--dur-4", "--ease-out", "--ease-in-out"]) {
  const m = src.match(new RegExp(name.replace(/[-]/g, "\\-") + "\\s*:\\s*([^;]+);"));
  if (!m) { fails.push("兼容层缺少 " + name); continue; }
  if (!m[1].includes("var(--md-sys-motion-")) fails.push(name + " 没有接到 MD3 原语：" + m[1].trim());
}
/* ease-ios 直接引用 OneGUI 的唯一来源；不需要再绕一层 MD3 别名。 */
{
  const m = src.match(/--ease-ios:\s*([^;]+);/);
  if (!m || !m[1].includes("var(--og-ease-")) fails.push("--ease-ios 没有接到 OneGUI 缓动令牌");
}
/* MD3 原语本身也必须指向 OneGUI，不能留下第二套数值。 */
for (const name of ["--md-sys-motion-easing-emphasized-decelerate", "--md-sys-motion-easing-emphasized-accelerate", "--md-sys-motion-duration-short-4"]) {
  const m = src.match(new RegExp(name + ":\\s*([^;]+);"));
  if (!m || !m[1].includes("var(--og-")) fails.push(name + " 没有指向 OneGUI 令牌：" + (m ? m[1].trim() : "missing"));
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

/* 6. 待办页右侧详情：2026-10-25 起不再做「展开成全屏浮层」，改为新标签页跳详情。
       守卫改为钉住新行为 + 保留生活↔详情的既有进场/回退动画，防止回退成旧交互或丢掉动画。 */
const tasksSrc = readFileSync(TASKS, "utf8");
if (/detailRef|toggleFull|pcFull|tasks-detail-fullbar/.test(tasksSrc)) {
  fails.push("待办页仍残留「展开/收起」全屏浮层接线（应改为新标签页跳转）");
}
if (!tasksSrc.includes("openDetailInNewTab") || !tasksSrc.includes('openTab("learn-assignment-detail"')) {
  fails.push("待办右栏「打开详情」没有接 openTab（新标签页跳转）");
}
if (!tasksSrc.includes('openTab("learn-ykt-detail"')) {
  fails.push("待办右栏未覆盖雨课堂原生详情的新标签页跳转");
}
if (!/tasks-detail tab-anim/.test(tasksSrc)) fails.push("生活 → 作业详情 没有进场动画（tasks-detail 缺 tab-anim）");
if (!/tasks-life tab-anim" data-dir="prev"/.test(tasksSrc)) fails.push("作业详情 → 生活 没有回退动画（tasks-life 缺 tab-anim + data-dir=prev）");

/* 7. 2026-10-25 动画专题：顶部标签 FLIP / OH 胶囊占位平移 / 页内 tab 滑块。
       三处都是「条件渲染/布局重排」导致瞬移的位置，必须真的有运行时接线。 */
const tabStripSrc = readFileSync("apps/desktop/src/components/explorer/TabStrip.tsx", "utf8");
if (!tabStripSrc.includes("flipRects") || !tabStripSrc.includes("el.animate(")) {
  fails.push("顶部标签新增/删除没有 FLIP 接线（其他标签会瞬移）");
}
if (!tabStripSrc.includes("transformsDirty") || !tabStripSrc.includes("layoutSeq")) {
  fails.push("顶部标签拖拽落位没有在临时 transform 清理后重建 FLIP 基线（交换过的标签关闭时会跳位）");
}
if (!tabStripSrc.includes("prefersReducedMotion()")) {
  fails.push("顶部标签 FLIP 没有减弱动态效果判断（CSS 1ms 降级管不到 WAAPI）");
}
const capsuleSrc = readFileSync("apps/desktop/src/components/explorer/OhCapsule.tsx", "utf8");
if (!capsuleSrc.includes("lastRects") || !capsuleSrc.includes("ph.animate(")) {
  fails.push("OH 胶囊占位文字没有 FLIP 接线（聚焦/失焦仍会瞬间平移）");
}
if (!capsuleSrc.includes("getAnimations()") || !capsuleSrc.includes('translate(${dx}px, -50%)')) {
  fails.push("OH 胶囊 FLIP 未清残留动画/仍带纵向位移（文字会先跳到搜索栏上方）");
}
if (!capsuleSrc.includes("prefersReducedMotion()")) {
  fails.push("OH 胶囊占位 FLIP 没有减弱动态效果判断");
}
const workbenchSrc = readFileSync("packages/gui/src/recipes/workbench.css", "utf8");
if (/html:root .seg-track .seg-pill \{ visibility: hidden/.test(workbenchSrc)) {
  fails.push("页内 tab 的滑块被隐藏（切换没有平移特效）");
}
if (!workbenchSrc.includes("html:root .seg-track .seg-pill { visibility: visible")) {
  fails.push("页内 tab 滑块未恢复显示（切换没有平移特效）");
}

/* 8. 2026-10-25 右键菜单展开 / 课程页头材质 / OH 头部单行布局。 */
const explorerUiCss = readFileSync("apps/desktop/src/styles/explorer-ui.css", "utf8");
if (!explorerUiCss.includes("ex-ctxmenu-bloom") || !/\.ex-ctxmenu,[\s\S]{0,120}?animation: ex-ctxmenu-bloom/.test(explorerUiCss)) {
  fails.push("右键就地菜单没有展开动画（ex-ctxmenu-bloom 未接线）");
}
if (!explorerUiCss.includes("ex-ctxmenu-out") || !/\.ex-ctxmenu\.is-out[\s\S]{0,120}?animation: ex-ctxmenu-out/.test(explorerUiCss)) {
  fails.push("右键就地菜单没有出场动画（ex-ctxmenu-out 未接线）");
}
const learnCss = readFileSync("packages/gui/src/recipes/learn.css", "utf8");
if (!/page-head-host > \.og-pagehead[\s\S]{0,500}?background: var\(--og-fill-surface\)/.test(learnCss)) {
  fails.push("课程页头仍用 overlay 材质（暗玻璃下会比卡片深）");
}
const chatDockSrc = readFileSync("apps/desktop/src/plugins/ChatDock.tsx", "utf8");
if (!chatDockSrc.includes("dock-head-close")) {
  fails.push("OH 头部关闭键没有独立到第一行右侧");
}
if (!workbenchSrc.includes("grid-template-columns: auto minmax(0, 1fr) auto")) {
  fails.push("OH 头部不是单行三列布局（模式页签左 / 操作中 / 关闭右）");
}
const tabLayoutSrc = readFileSync("apps/desktop/src/state/tabLayout.ts", "utf8");
if (!tabLayoutSrc.includes("explorer.tabLayout.current") || !tabLayoutSrc.includes("persistCurrent")) {
  fails.push("竖版标签页习惯没有落盘（重启会丢）");
}

if (fails.length) {
  console.error("动效令牌守卫：不合格");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("动效令牌守卫：MD3 原语齐备 + 兼容层已接线 + 退场用 accelerate + 待办页错峰出场 + 标签/胶囊/页内滑块 FLIP 接线 ✓");
