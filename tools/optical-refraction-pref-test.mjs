#!/usr/bin/env node
/* 光学折射开关 + 嵌套玻璃面静态护栏。
 *
 * 折射与毛玻璃必须分离：关闭折射只释放 OneGUI lens，普通 backdrop blur 保留；
 * balanced（无玻璃）档不可用；嵌套 .og-surface 不重复开 backdrop。
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8");
const pref = read("apps/desktop/src/lib/opticalRefraction.ts");
const main = read("apps/desktop/src/main.tsx");
const settings = read("apps/desktop/src/pages/Settings.tsx");
const pipeline = read("packages/gui/src/pipeline/refraction.ts");
const card = read("packages/gui/src/styles/card.css");
const material = read("packages/gui/src/recipes/material-surfaces.css");
const globalCss = read("apps/desktop/src/styles/global.css");
const html = read("apps/desktop/index.html");

assert.match(pref, /onethu\.glass\.refraction/, "折射开关有独立持久化键");
assert.match(pref, /v !== "0"/, "默认开启，保持既有视觉");
assert.match(pref, /dataset\.ogOptics = on \? "on" : "off"/, "开关落到 data-og-optics");
assert.ok(main.indexOf("initOpticalRefraction();") < main.indexOf("installOneGUI({"), "启动时在安装管线前写入开关");
assert.match(pipeline, /root\.dataset\.ogOptics !== "off"/, "管线读取开关");
assert.match(pipeline, /"data-og-optics"/, "开关变化会触发 lens 重算");
assert.match(settings, /row-set-glass-refraction/);
assert.match(settings, /disabled=\{glass === "balanced"\}/, "无玻璃档禁用折射开关");
assert.match(settings, /setOpticalRefraction/, "设置页接线开关");
assert.match(card, /\.og-surface \.og-surface:not\(\.og-surface--overlay\)[\s\S]{0,100}--og-c-surface-blur: none/, "嵌套面取消重复 backdrop");
assert.match(card, /\.og-surface--l1[^{]*\{[^}]*--og-c-surface-blur: none/, "l1 面取消 backdrop");
assert.match(material, /\.og-surface :is\([\s\S]{0,200}backdrop-filter: none/, "卡内控件取消重复 backdrop");
assert.doesNotMatch(globalCss, /--glass-refract\s*:/, "毛玻璃令牌不再包含折射");
assert.doesNotMatch(html, /dsh-liquid-refract/, "旧静态折射滤镜已退役");
console.log("光学折射开关 + 嵌套玻璃面护栏：通过");
