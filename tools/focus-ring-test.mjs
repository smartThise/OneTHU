#!/usr/bin/env node
/**
 * C17 焦点环护栏（霖 2026-10-01 走查）。
 * 现象：服务页搜索框占了整整一条，焦点环却只包住真正能输入的那一窄条——既没含左侧放大镜、
 * 也没含整条外框（浏览器给裸 <input> 画的环就是这样）。口径：环画在**控件外框**上，
 * 由容器 `:focus-within` 出环、圆角随容器、令牌环统一、outline 一律 none。
 * 护栏同时钉住 C16：待办页不许再直接渲染裸 <select>，要用共享的 SearchSelect。
 */
import { readFileSync } from "node:fs";

const CSS = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const TASKS = readFileSync("apps/desktop/src/pages/TasksPage.tsx", "utf8");
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

/* ① 容器级焦点环：三个「图标 + 输入框」容器都要 :focus-within，且用令牌环 */
for (const sel of [".svc-search", ".search-box", ".thos-search"]) {
  const re = new RegExp(sel.replace(".", "\\.") + ":focus-within[^{]*\\{[^}]*box-shadow: var\\(--md-sys-focus-ring\\)");
  ok(re.test(CSS), sel + " 没有容器级 :focus-within 焦点环（环只会包住裸 input）");
}
/* ② 内部 input 必须把浏览器默认环关掉（否则双层环） */
ok(/\.svc-search input \{[^}]*outline: none/.test(CSS), ".svc-search input 没关掉默认 outline（会出现内外两层环）");
ok(/\.search-box input:focus \{ outline: none; \}/.test(CSS), ".search-box input 没关掉默认 outline");
/* ③ 环只走令牌，不许就地写颜色/宽度 */
const ringBlocks = [...CSS.matchAll(/[^{}]*:focus-within[^{]*\{[^}]*\}/g)].map((m) => m[0]);
ok(ringBlocks.length >= 3, "容器级焦点环少于 3 处（当前 " + ringBlocks.length + "）");
for (const b of ringBlocks) {
  ok(!/outline:\s*\d/.test(b), "焦点环里出现硬写 outline 宽度（应走 --md-sys-focus-ring）");
  ok(/box-shadow: var\(--md-sys-focus-ring\)/.test(b), "焦点环没用 --md-sys-focus-ring 令牌");
}

/* ④ C16：待办页不许裸 <select>，且确实用了共享 SearchSelect */
const TASKS_CODE = TASKS.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
ok(!/<select/.test(TASKS_CODE), "待办页又出现裸 <select>（应走共享 SearchSelect）");
ok(/import \{ SearchSelect \} from "\.\.\/components\/SearchSelect\.js";/.test(TASKS), "待办页没有引用共享 SearchSelect");
ok(/<SearchSelect[\s\S]{0,600}options=\{\[/.test(TASKS), "SearchSelect 没接到课程筛选项上");
ok(/group: "网络学堂"/.test(TASKS) && /group: extHwSourceName\(src\)/.test(TASKS), "课程筛选的分组标题丢了");
ok(/\.hw-filter \.filter-dd \{ flex: 1;/.test(CSS), "SearchSelect 在筛选行里没有撑满（.hw-filter .filter-dd）");

console.log(
  fails.length
    ? "焦点环护栏不通过：\n" + fails.map((f) => "  ✗ " + f).join("\n")
    : "焦点环护栏：3 个搜索容器走 :focus-within 令牌环、内部 input 关默认环 ✓ 待办页无裸 select、复用 SearchSelect ✓",
);
process.exit(fails.length ? 1 : 0);
