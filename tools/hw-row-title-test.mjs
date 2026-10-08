#!/usr/bin/env node
/**
 * 作业行标题护栏（霖 2026-10-02 复看 #3）。
 *
 * 背景：0.7.11 给**日程行**做过「第一行标题通栏 / 第二行日期·状态·箭头」的网格化改造，选择器是
 * `html.is-phone .list .row-click`——它把**作业行**（HomeworkRow / NoticeRow，类名 `.row-main`
 * / `.row-when`）也一起接住了，但命名区只写了 `.tl-main` / `.tl-time`。作业行没有这些类名，
 * 于是被浏览器**自动摆放**：标题落到第 2 列（真机实测 61px，只剩三四个字），而第一行第 3/4 列
 * （原先三个行内控件占的位置）整块空着——霖看到的就是「标题只显示到一半，被按钮占过的位置没被
 * 利用」。真机复验：补上 `.row-main { grid-area: main }` / `.row-when { grid-area: time }` 后，
 * 标题宽度 62px → 294px（第一行整行），超出才省略。
 *
 * 这份护栏钉三件事：
 *   ① 网格块必须同时给 `.tl-*` 与 `.row-main` / `.row-when` 命名（少一个就回到自动摆放）；
 *   ② `.row-title` 必须仍是「单行 + 省略号」（nowrap + ellipsis），不许改成多行截断；
 *   ③ 网格块必须限定在 `html.is-phone .list .row-click` 内（别扩散到别的列表）。
 */
import { readFileSync } from "node:fs";

const CSS = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

/* ① 网格块：四个命名区都要有 */
const gridAt = CSS.indexOf("grid-template-areas:");
ok(gridAt >= 0, "找不到 0.7.11 的日程/作业行网格块（grid-template-areas）");
if (gridAt >= 0) {
  const start = CSS.lastIndexOf("@media", gridAt);
  const block = CSS.slice(start, CSS.indexOf("\n}\n", gridAt));
  ok(/html\.is-phone \.list \.row-click \{/.test(block), "网格块的选择器不是 html.is-phone .list .row-click（会扩散到别的列表）");
  for (const [cls, area] of [
    [".tl-main", "main"],
    [".tl-time", "time"],
    [".tl-bar", "sep"],
    [".row-caret", "caret"],
  ]) {
    ok(
      new RegExp(`\\.row-click ${cls.replace(/\./g, "\\.")} \\{ grid-area: ${area};`).test(block),
      `网格块里 ${cls} 没有命名到 ${area}`,
    );
  }
  /* 作业行的两个类名：缺了就会被自动摆放（标题挤到第 2 列） */
  ok(
    /\.row-click \.row-main \{ grid-area: main; \}/.test(block),
    "作业行的 .row-main 没有 grid-area: main——标题会被自动摆到第 2 列（实测只剩 61px）",
  );
  ok(
    /\.row-click \.row-when \{ grid-area: time;/.test(block),
    "作业行的 .row-when 没有 grid-area: time——日期块会和标题抢第 1 列",
  );
  /* 第一行必须四列都归 main，否则标题用不满整行 */
  ok(
    /"main main main main"/.test(block),
    "第二行模板改了：main 必须独占第一行四列（标题通栏），否则标题又会只占一列",
  );
  ok(/"time sep chip caret"/.test(block), "网格模板第二行不是 time/sep/chip/caret");
  ok(/\.row-click \.chip \{ grid-area: chip;/.test(block), "状态胶囊没有命名到 chip");
}

/* ② 标题：单行 + 省略号（不许多行截断、不许换行） */
const titleAt = CSS.indexOf(".row-title {");
ok(titleAt >= 0, "找不到 .row-title 规则");
if (titleAt >= 0) {
  const title = CSS.slice(titleAt, CSS.indexOf("}", titleAt) + 1);
  ok(/white-space: nowrap/.test(title), ".row-title 不是单行（nowrap）——霖要求不许拐到第二行");
  ok(/text-overflow: ellipsis/.test(title) && /overflow: hidden/.test(title), ".row-title 没有省略号（装不下时应省略号收尾）");
  ok(!/-webkit-line-clamp/.test(title), ".row-title 改成了多行截断（霖要求单行省略号）");
}

console.log(
  fails.length
    ? "作业行标题护栏不通过：\n" + fails.map((f) => "  ✗ " + f).join("\n")
    : "作业行标题护栏：网格命名区给到 .row-main/.row-when（标题通栏 294px）+ 标题单行省略号 ✓",
);
process.exit(fails.length ? 1 : 0);
