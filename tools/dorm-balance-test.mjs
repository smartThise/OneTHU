#!/usr/bin/env node
/* 宿舍电费余额回归：页面必须重新请求 ELE_REMAINDER，而不是长期显示“接口不可用”。 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const page = readFileSync("apps/desktop/src/pages/info/DormTab.tsx", "utf8");
const updater = readFileSync("packages/core/src/info/client.ts", "utf8");
assert.match(page, /getEleRemainder\(\)/, "DormTab 调用余额接口");
assert.match(page, /ELEC_BALANCE_KEY/, "余额有独立缓存键");
assert.match(page, /loadBalance/, "余额有加载/恢复流程");
assert.doesNotMatch(page, /c70f03b85ab5/, "不再固定显示“无法获取余额接口”");
assert.match(page, /90f23f891fd1/, "余额卡显示剩余电量");
assert.match(updater, /getEleRemainder\(\)/, "core 保留余额解析入口");
console.log("宿舍电费余额接线：通过");
