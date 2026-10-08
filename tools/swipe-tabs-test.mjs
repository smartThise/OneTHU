#!/usr/bin/env node
/**
 * C7 横滑切 tab 护栏（霖 2026-10-01 走查）。
 * 手势本体只许有一份（lib/useSwipeTabs.ts）：多份就地实现就会各自跑偏——待办页原来把切换挂在
 * `.tasks-body` 的 pointerdown/pointerup 上，列表一滚浏览器就发 pointercancel，手指落在列表里
 * 横滑什么都不会发生。护栏钉四件事：
 *   ① 手势只有一个实现，且目标页复用它（不许再写第二套就地监听）；
 *   ② 含主轴判定（横 > 纵）与位移阈值；
 *   ③ 不挡纵向滚动：监听全 passive、没有 preventDefault，容器 `touch-action: pan-y`；
 *   ④ 起手落在分段控件（`.seg-track`）上不算——它自己要用横滑拖胶囊。
 */
import { readFileSync } from "node:fs";

const HOOK = readFileSync("apps/desktop/src/lib/useSwipeTabs.ts", "utf8");
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

/* ① 唯一实现 + 目标页复用 */
ok(/export function useSwipeTabs</.test(HOOK), "lib/useSwipeTabs.ts 里没有 useSwipeTabs");
const CONSUMERS = [
  "apps/desktop/src/pages/TasksPage.tsx",
  "apps/desktop/src/pages/Settings.tsx",
  "apps/desktop/src/pages/info/InfoPage.tsx",
  "apps/desktop/src/pages/info/LifePage.tsx",
  "apps/desktop/src/pages/FolderPage.tsx",
];
const src = CONSUMERS.map((f) => [f, readFileSync(f, "utf8")]);
for (const [f, s] of src) {
  ok(/useSwipeTabs</.test(s), f + " 没接 useSwipeTabs（含 tab 的页面要复用同一份手势）");
  ok(/className="swipe-tabs"/.test(s) || /ref=\{swipeRef\}/.test(s), f + " 接了 hook 但没把 ref 挂到容器上");
}
/* 不许再有第二套就地横滑实现（按位移判定的 pointerdown 版） */
const OLD = /onPointerDown=\{onHDown\}|const onHDown/;
for (const [f, s] of src) ok(!OLD.test(s), f + " 还留着就地写的 pointer 版横滑（会与共享 hook 抢手势）");

/* ② 主轴判定 + 阈值 */
ok(/export const SWIPE_MIN_DX = \d+/.test(HOOK), "缺横滑阈值常量 SWIPE_MIN_DX");
ok(/export const SWIPE_AXIS_RATIO = \d+/.test(HOOK), "缺主轴比例常量 SWIPE_AXIS_RATIO");
ok(/Math\.abs\(dx\) > Math\.abs\(dy\) \? "x" : "y"/.test(HOOK), "没先定主轴（横 > 纵才算滑 tab）");
ok(/Math\.abs\(dx\) < SWIPE_MIN_DX/.test(HOOK) && /SWIPE_AXIS_RATIO \* Math\.abs\(dy\)/.test(HOOK),
  "抬手判定缺「位移够大」或「明显大于纵向位移」");
ok(/st\.axis !== "x"/.test(HOOK), "纵向手势没有中途放弃（会把上下滚动误判成切 tab）");

/* ③ 不挡纵向滚动 */
ok(!/\.preventDefault\(\)/.test(HOOK), "hook 里出现 preventDefault() 调用（会掐断纵向滚动）");
const passive = [...HOOK.matchAll(/addEventListener\("touch(start|move|end|cancel)", \w+, \{ passive: true \}\)/g)];
ok(passive.length === 4, "touch 监听不是四条全 passive（当前 " + passive.length + " 条）");
ok(/touchAction = "pan-y"/.test(HOOK) || /touch-action:\s*pan-y/.test(HOOK), "容器没声明 touch-action: pan-y");

/* ④ 分段控件上的起手不算 */
ok(/SWIPE_IGNORE = "\.seg-track, \[data-swipe-ignore\]"/.test(HOOK), "没排除 .seg-track / [data-swipe-ignore] 上的起手");
ok(/closest\(SWIPE_IGNORE\)/.test(HOOK), "排除规则没有真的用在起手判定里");

/* 顺序取「页面上真正渲染的那份」：TasksPage 的学习/生活、FolderPage 的 visibleIds */
const TASKS = readFileSync("apps/desktop/src/pages/TasksPage.tsx", "utf8");
ok(/order: \["learn", "life"\]/.test(TASKS), "待办页的横滑顺序不是它 render 的 学习/生活");
ok(/disabled: wide/.test(TASKS), "待办页宽屏双栏同显时没有关掉横滑");

console.log(
  fails.length
    ? "横滑切 tab 护栏不通过：\n" + fails.map((f) => "  ✗ " + f).join("\n")
    : "横滑切 tab 护栏：唯一 hook + 5 处复用 + 主轴/阈值/被动监听/分段控件排除 ✓",
);
process.exit(fails.length ? 1 : 0);
