#!/usr/bin/env node
/* 待办页/手机胶囊显示回归：静态标题移除、统计卡材质、筛选下拉圆角模糊、手机胶囊文字居中。 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const tasks = readFileSync("apps/desktop/src/pages/TasksPage.tsx", "utf8");
const css = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const workbench = readFileSync("packages/gui/src/recipes/workbench.css", "utf8");

assert.equal((tasks.match(/<div className="tasks-pane-head">/g) ?? []).length, 1, "只保留详情栏的动态标题，移除学习/生活静态标题");
assert.doesNotMatch(tasks, /tasks-pane-head">\{i18n\("pages\.taskspage\.2118cbc10988"\)/);
assert.doesNotMatch(tasks, /tasks-pane-head">\{i18n\("pages\.taskspage\.15d208d1b4c9"\)/);
assert.match(css, /html:root \.task-stat,[\s\S]{0,80}html:root \.task-entry \{[\s\S]{0,120}background-color: var\(--og-fill-surface\)/, "统计卡/入口补材质底色");
assert.match(css, /html:root \.hw-filter-select \{[\s\S]{0,260}border-radius: var\(--og-radius-control\)/, "筛选下拉圆角");
assert.match(css, /html:root \.hw-filter-select \{[\s\S]{0,360}backdrop-filter:/, "筛选下拉模糊");
assert.match(workbench, /\.ohx-capsule:not\(\.is-open\):not\(\.is-hold\) \.ohx-mark-wrap \{\s*position: absolute;/, "手机胶囊图标脱离 flex 流");
assert.match(workbench, /\.ohx-capsule:not\(\.is-open\):not\(\.is-hold\) \.ohx-capsule-ph \{[\s\S]{0,160}max-width:/, "手机胶囊文字可居中");
console.log("待办页/手机胶囊显示：通过");
