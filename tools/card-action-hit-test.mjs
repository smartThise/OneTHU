#!/usr/bin/env node
/**
 * C8 作业卡片动作钮命中护栏（霖 2026-10-01 走查）。
 * 真机现象：点卡面「忽略/提醒/收藏」没反应，反而把作业详情打开了——卡片当时用
 * `onClickCapture`（捕获阶段先跑），子元素的 stopPropagation 来不及拦。护栏钉三件事：
 *   ① 卡片点击在**冒泡**阶段（不许再回到 capture）——否则动作钮必然被抢；
 *   ② 动作钮自己 stopPropagation，且触屏命中盒 ≥ 40×40；
 *   ③ 卡片空白仍然能打开详情（不许把整张卡变哑）。
 */
import { readFileSync } from "node:fs";

const TASKS = readFileSync("apps/desktop/src/pages/TasksPage.tsx", "utf8");
const CSS = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

/* ① 冒泡阶段 */
ok(!/onClickCapture=\{/.test(TASKS), "作业卡片又用回 onClickCapture（捕获阶段会先打开详情，动作钮被抢）");
ok(/onClick=\{\(e\) => \{\s*\n\s*if \(movedRef\.current \|\| !front\) \{/.test(TASKS),
  "作业卡片点击不是冒泡阶段那条（含拖拽/非前台拦截）");

/* ② 动作钮：stopPropagation + 命中盒 ≥ 40 */
const actions = /<div className=\{"hw-card-actions"[\s\S]*?<\/div>/.exec(TASKS);
ok(!!actions, "找不到 .hw-card-actions 那一块");
if (actions) {
  ok(/onClick=\{\(e\) => e\.stopPropagation\(\)\}/.test(actions[0]), "动作排没有整块 stopPropagation");
  ok(/onClick=\{\(e\) => \{\s*e\.stopPropagation\(\);/.test(actions[0]), "「忽略」钮自己没有 stopPropagation");
}
ok(/<HwRemindButton h=\{h\} \/>/.test(TASKS), "卡片上少了提醒钮");
ok(/<CollectStar[\s\S]{0,200}title="收藏作业"/.test(TASKS), "卡片上少了收藏星标");
const act = /\.hw-card-act \{[\s\S]*?\n\}/.exec(CSS);
ok(!!act, "找不到 .hw-card-act 规则");
if (act) {
  const w = /width: (\d+)px/.exec(act[0]);
  const h = /height: (\d+)px/.exec(act[0]);
  ok(!!w && Number(w[1]) >= 40, "「忽略」钮宽度小于 40px（触屏命中下限）");
  ok(!!h && Number(h[1]) >= 40, "「忽略」钮高度小于 40px（触屏命中下限）");
}
const boxes = /\.hw-card-actions \.hwremind-bell,\s*\n\.hw-card-actions \.collect-star \{ min-width: 40px; min-height: 40px; \}/.exec(CSS);
ok(!!boxes, "提醒/收藏钮没有 40×40 的命中盒（图标小可以，命中盒不行）");

/* ③ 卡片空白仍能开详情 */
ok(/openHomeworkRow\(h, \{ navigate, from: "tasks"/.test(TASKS), "卡片空白不再打开作业详情（把整张卡变哑了）");

console.log(
  fails.length
    ? "卡片动作钮命中护栏不通过：\n" + fails.map((f) => "  ✗ " + f).join("\n")
    : "卡片动作钮命中护栏：冒泡阶段点击 + 三钮 40×40 命中盒 + 卡片空白仍开详情 ✓",
);
process.exit(fails.length ? 1 : 0);
