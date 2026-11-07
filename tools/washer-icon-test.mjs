#!/usr/bin/env node
/* 洗衣机设备卡：类型图标 + 左图标右文字布局。 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const tab = readFileSync("apps/desktop/src/pages/info/WasherTab.tsx", "utf8");
const css = readFileSync("apps/desktop/src/styles/global.css", "utf8");
assert.match(tab, /type WasherKind = "top" \| "front" \| "shoe" \| "dryer"/, "四种设备类型");
assert.match(tab, /function washerKind/, "设备类型识别");
assert.match(tab, /function WasherTypeIcon/, "类型图标组件");
assert.match(tab, /washer-type-icon/, "卡片使用图标容器");
assert.match(tab, /<WasherTypeIcon kind=\{washerKind\(w\)\}/, "图标按设备类型渲染");
assert.match(css, /\.washer-type-icon\s*\{[\s\S]{0,300}display: grid/, "图标左、文字右的 flex/grid 布局");
assert.match(css, /\.washer-type-icon svg/, "图标尺寸规则");
console.log("洗衣机类型图标：通过");
