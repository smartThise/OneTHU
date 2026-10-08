#!/usr/bin/env node
/**
 * A3-PC 护栏（P 批 组3）：PC 右键接进**同一套**长按菜单。
 *
 * 为什么要有它：右键这条路太容易分叉成第二套实现——另写一份菜单项、另判一次命中、
 * 顺手在右键里也装「吞点击」。前两条会让移动端与 PC 的菜单口径漂移；第三条是实打实的
 * 手感 bug：右键**不产生 click**，装了吞点击就会把随后的第一次左键吃掉（1s 内点同一条目无反应）。
 */
import { readFileSync } from "node:fs";

const CTX = readFileSync("apps/desktop/src/components/ContextMenu.tsx", "utf8");
const LAYOUT = readFileSync("apps/desktop/src/components/Layout.tsx", "utf8");
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
/** 取一段 onCtx 处理体（从 const onCtx 到下一个个 `};` 行） */
const ctxBodies = [...CTX.matchAll(/const onCtx = \(e: MouseEvent\): void => \{[\s\S]*?\n    \};/g)].map((m) => m[0]);

/* ① 两个入口都要接上右键 */
ok(/zone\.addEventListener\("contextmenu", onCtx\)/.test(CTX), "列表长按区没有接 PC 右键");
ok(/document\.addEventListener\("contextmenu", onCtx\)/.test(CTX), "全局 atom 层没有接 PC 右键");
ok(ctxBodies.length >= 2, "两处右键处理体少于 2（当前 " + ctxBodies.length + "）");
for (const b of ctxBodies) {
  ok(/closest<HTMLElement>\(selector\)|find\(e\.target\)/.test(b), "右键没有复用长按的命中判定（会与长按分叉）");
  ok(/inTextZone\(e\.target\)/.test(b), "右键没有沿用文本区让路（输入框/可选段落应保留原生菜单）");
  ok(!/armSwallow/.test(b), "右键路径里装了「吞点击」——右键不产生 click，会误吞随后的左键");
  ok(/cb\.current\(|openAtomMenu\(/.test(b), "右键没有走与长按同一个回调/开菜单函数");
}
/* ② 共用一份开菜单函数（口径不分叉） */
ok(/const openAtomMenu = /.test(CTX), "原子菜单没有抽成共用函数（长按与右键会各写一份菜单项）");
ok(/openAtomMenu\(el, x, y, true\)/.test(CTX) && /openAtomMenu\(el, e\.clientX, e\.clientY, false\)/.test(CTX), "长按与右键没有共用 openAtomMenu");
/* ③ 页面自带长按区优先（避免两套菜单同弹） */
ok(/el\.closest\("\[" \+ ZONE_ATTR \+ "\]"\).*return null/.test(CTX), "全局 atom 层不再让路给页面自带长按区（会两套菜单同弹）");
/* ④ 全站仍禁浏览器右键，唯一放行口是文本选区 */
ok(/document\.addEventListener\("contextmenu", onCtx\)/.test(LAYOUT) && /hasTextSelection\(\)/.test(LAYOUT), "Layout 的全站右键拦截/文本放行丢了");
/* ⑤ 不许为右键引入新依赖 */
const imports = [...CTX.matchAll(/from "([^"]+)"/g)].map((m) => m[1]).filter((x) => !x.startsWith(".") && !x.startsWith("react"));
ok(imports.length === 0, "ContextMenu 引入了新依赖：" + imports.join(", "));

if (fails.length) {
  console.error("A3-PC 护栏：不通过");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("A3-PC 护栏：右键两入口复用长按命中/回调 ✓ 不装吞点击 ✓ 未抽分叉菜单 ✓ 文本区让路 ✓ 页面长按区优先 ✓ 无新依赖 ✓");
