#!/usr/bin/env node
/**
 * 认证恢复事件总线 + learn 自动恢复接线的护栏。
 *
 * 现场：课程文件等 learn 页面在会话独立过期后停在 error，后台 keepalive
 * 把 learn 修好也不会自动重试，用户只能手点刷新。这里验证：
 *   [1] 事件只广播给当前订阅者，scope 原样传递
 *   [2] 取消订阅后不再收到
 *   [3] 单个监听器抛错不会打断其他监听器
 *   [4] keepalive/错误页确实接上了 ensureLearnSession / subscribeAuthRecovered
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emitAuthRecovered, subscribeAuthRecovered } from "../apps/desktop/src/lib/authRecovery.ts";

{
  const got = [];
  const off = subscribeAuthRecovered((scope) => got.push(scope));
  emitAuthRecovered("learn");
  emitAuthRecovered("global");
  assert.deepEqual(got, ["learn", "global"], "[1] scope 应按广播顺序原样到达");
  off();
  emitAuthRecovered("learn");
  assert.deepEqual(got, ["learn", "global"], "[2] 取消订阅后不应再收到事件");
}

{
  const got = [];
  const offBad = subscribeAuthRecovered(() => {
    throw new Error("listener boom");
  });
  const offGood = subscribeAuthRecovered((scope) => got.push(scope));
  assert.doesNotThrow(() => emitAuthRecovered("learn"), "[3] 监听器异常不应向广播方抛出");
  assert.deepEqual(got, ["learn"], "[3] 其他监听器仍应收到事件");
  offBad();
  offGood();
}

/* 接线静态护栏：防止以后只保留了总线、却忘了在 keepalive / error 页面接上。 */
const reload = readFileSync("apps/desktop/src/lib/reload.ts", "utf8");
const data = readFileSync("apps/desktop/src/state/data.ts", "utf8");
const learnClient = readFileSync("packages/core/src/learn/client.ts", "utf8");
assert.match(reload, /export async function ensureLearnSession/, "[4] reload 应导出 ensureLearnSession");
assert.match(reload, /await ensureLearnSession\(\)/, "[4] keepalive 应实际调用 learn 探活");
assert.match(reload, /addEventListener\("focus"/, "[4] 聚焦唤醒应补 learn 探针");
assert.match(reload, /emitAuthRecovered\(scope\)/, "[4] softRecover 成功应广播恢复事件");
assert.match(data, /subscribeAuthRecovered/, "[4] useLearnData 应订阅恢复事件");
assert.match(data, /if \(state !== "error"\) return;/, "[4] 自动重试只应发生在 error 状态");
assert.match(learnClient, /async ensureSession\(\): Promise<boolean>/, "[4] LearnClient 应提供 ensureSession");

console.log("auth-recovery-test: 全部断言通过（事件总线 + learn keepalive + error 自动重试接线）");