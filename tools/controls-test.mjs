#!/usr/bin/env node
/**
 * B5 控件护栏：chip 与开关。
 * 这两族的病是"各写一套"——胶囊 24px/27px 两种高度、999px 与 --r-pill 混用、
 * 开关有 36×22 与 34×20 两套几何、on 态一个走强调色一个走语义绿。
 * 这里逐个钉住：一套几何、一套令牌、状态层与焦点环不许漏。
 */
import { readFileSync } from "node:fs";

const CSS = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

function block(sel) {
  const i = CSS.indexOf(sel + " {");
  if (i < 0) return null;
  return CSS.slice(i + sel.length + 3, CSS.indexOf("}", i));
}

/* 胶囊：字面圆角/Compat 描边清除，与 .chip 同高，并共用状态层 */
const cb = block(".chip-btn");
ok(cb !== null, ".chip-btn 规则缺失");
if (cb) {
  ok(!/999px/.test(cb), ".chip-btn 仍写死 999px（应 var(--r-pill)）");
  ok(!/var\(--border\)|var\(--surface-2\)/.test(cb), ".chip-btn 仍用 Compat 底色/描边");
  ok(/height: 24px/.test(cb), ".chip-btn 高度应与 .chip 齐平（24px）");
}
ok(/\.chip-btn::after/.test(CSS), ".chip-btn 未接入共用状态层");
ok(/\.chip-btn:focus-visible/.test(CSS), ".chip-btn 缺焦点环");
ok(!CSS.includes("border-radius: 999px"), "全文仍有字面 999px 胶囊（应 var(--r-pill)）");

/* 开关：两套实现归一（同几何、同令牌、同 on 态） */
const sw = block(".switch");
const ps = block(".plg-switch");
ok(sw !== null && ps !== null, "开关规则缺失");
if (sw && ps) {
  ok(/width: 36px/.test(sw) && /width: 36px/.test(ps), "两个开关宽度不一致");
  ok(/height: 22px/.test(sw) && /height: 22px/.test(ps), "两个开关高度不一致");
  for (const [name, b] of [[".switch", sw], [".plg-switch", ps]]) {
    ok(!b.includes("var(--surface-3)") && !b.includes("var(--border-strong)"), name + " 仍用 Compat 底色/描边");
    ok(b.includes("--md-sys-color-surface-container-high"), name + " 轨道底色应走 System 令牌");
  }
  ok(!/var\(--green\)/.test(CSS.slice(CSS.indexOf(".plg-switch.is-on"), CSS.indexOf(".plg-switch.is-on") + 200)), ".plg-switch 的 on 态仍是语义绿（应与 .switch 同走 primary）");
  ok(/\.plg-switch\.is-on[^}]*--md-sys-color-primary/.test(CSS), ".plg-switch 的 on 态应走 primary");
  ok(/\.switch\.on[^}]*--md-sys-color-primary/.test(CSS), ".switch 的 on 态应走 primary");
}
ok(/\.switch:hover::before/.test(CSS) || /\.switch:hover/.test(CSS), ".switch 缺 hover 状态层");
ok(/\.switch:focus-visible/.test(CSS), ".switch 缺焦点环");
ok(/\.plg-switch:focus-visible/.test(CSS), ".plg-switch 缺焦点环");

/* 进度：两条配方归一 */
for (const sel of [".thos-progress-bar", ".cloud-quota-bar"]) {
  const b = block(sel);
  ok(b !== null, sel + " 规则缺失");
  if (b) {
    ok(b.includes("var(--r-pill)"), sel + " 端点应为胶囊令牌");
    ok(b.includes("--md-sys-color-surface-container-high"), sel + " 轨道应走 System 令牌");
    ok(!/var\(--surface-3\)|var\(--border-soft\)/.test(b), sel + " 仍用 Compat 轨道色");
  }
}
for (const sel of [".thos-progress-bar > span", ".cloud-quota-bar > div"]) {
  const b = block(sel);
  ok(b !== null && b.includes("var(--md-sys-color-primary)") && b.includes("var(--r-pill)"), sel + " 填充应走 primary + 胶囊令牌");
}

/* 骨架屏：只许一条规则，流光只许走 --skeleton-shine */
ok((CSS.match(/^\.skeleton \{/gm) || []).length === 1, "骨架屏规则应合并为一条");
ok(/\.skeleton::after[^}]*var\(--skeleton-shine\)/.test(CSS), "骨架屏流光应走 --skeleton-shine 令牌");
ok(!CSS.includes("cloud-skeleton"), "退役的 cloud-skeleton 关键帧仍在");

/* 空状态：令牌化 + 4pt 网格 */
const em = block(".empty");
ok(em !== null, ".empty 规则缺失");
if (em) {
  ok(em.includes("--md-sys-color-on-surface-variant"), ".empty 文案色应走 System 令牌");
  ok(/padding: 32px 16px/.test(em), ".empty 内边距应在 4pt 网格上");
}

console.log(
  fails.length
    ? "控件护栏不通过：\n" + fails.map((f) => "  ✗ " + f).join("\n")
    : "控件护栏：胶囊一套几何 + 状态层/焦点环 ✓ 开关两实现归一 + System 令牌 ✓ 进度两条配方归一 ✓ 骨架屏单条 + 流光令牌 ✓ 空状态令牌化 ✓ 无字面 999px ✓",
);
process.exit(fails.length ? 1 : 0);
