/**
 * 灵动岛胶囊布局护栏（R21c，小米 HyperOS 实录）。
 *
 * 现象：胶囊里靠近「日程显示条」的长文字**溢出胶囊**，而不是把胶囊撑长——其他设备正常。
 * 根因：胶囊宽度是 JS 测出来的定宽（`--island-w` = getBoundingClientRect().width + 58），
 * 而文字 span 在 flex 容器里默认可收缩（flex-shrink:1）且 `white-space: pre` 不换行：
 * 字体度量一变宽（HyperOS/MiSans 等），测得宽度跟不上实际渲染宽度 → 文字直接溢出。
 *
 * 契约：胶囊宽度必须由内容决定（CSS），文字永不收缩；超长时省略号收尾。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const css = read("apps/desktop/src/styles/global.css");
const dock = read("apps/desktop/src/plugins/ChatDock.tsx");

/** 剔除注释行后再判定（注释里提到旧变量名不算违规——护栏踩过这个坑） */
const stripComments = (src) => src.split("\n").filter((l) => !/^\s*(\/\*|\*)/.test(l)).join("\n");
const island = stripComments(css.slice(css.indexOf(".dock-island {"), css.indexOf(".dock-island:hover")));
assert.ok(island.length > 100, ".dock-island 规则定位失败");
assert.ok(/width: auto;/.test(island), "胶囊宽度必须由内容决定（width: auto）");
assert.ok(!/--island-w/.test(island), "胶囊不得再用 JS 测得的定宽（--island-w）");
assert.ok(/max-width: calc\(100vw - 28px\);/.test(island), "仍须有视口上限（防超出屏幕）");

const text = stripComments(css.slice(css.indexOf(".dock-island-text {"), css.indexOf(".dock-island-text i {")));
assert.ok(/flex: none;/.test(text), "文字不得收缩（flex: none——收缩正是溢出根因）");
assert.ok(/white-space: pre;/.test(text), "文字保持单行（不换行）");
assert.ok(/text-overflow: ellipsis;/.test(text) && /overflow: hidden;/.test(text),
  "极端长文本必须省略号收尾，而不是溢出胶囊");
assert.ok(/max-width: min\(72vw, 460px\);/.test(text), "文字要有自己的宽度上限");

assert.ok(!/--island-w/.test(dock), "组件不得再注入 --island-w");
assert.ok(!/getBoundingClientRect\(\)\.width/.test(dock), "组件不得再用 getBoundingClientRect 测宽（字体度量敏感）");

console.log("island-layout-test: 全部断言通过（内容自适应 + 文字不收缩 + 超长省略 + 不再 JS 测宽）");
