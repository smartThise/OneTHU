/**
 * ConnectGate 护栏（§4.3）：业务入口放业务场景——未绑定在原地绑，绑完回到原任务。
 *
 * 守四件事，任何一件坏掉都会退回「把人送去设置页、办完自己走回来」的老体验：
 *  ① 词表与注册表 state/navigation.ts 的 needBind 对齐（yuketang / tuoj / mail / cloud）；
 *  ② 弹层是手机贴底抽屉（B3b 口径：抓手 + 安全区），不是一套居中对话框打天下；
 *  ③ 绑定流程复用现成的（雨课堂面板、TUOJ 零输入漫游、accountSetup 的邮箱/云盘组合动作），不另造真源；
 *  ④ 成功后回调 onDone 回原任务，且邮箱页 / 云盘页 / 作业区真的接上了。
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const gate = readFileSync("apps/desktop/src/components/ConnectGate.tsx", "utf8");
const assign = readFileSync("apps/desktop/src/pages/learn/AssignmentsPage.tsx", "utf8");
const mail = readFileSync("apps/desktop/src/pages/MailPage.tsx", "utf8");
const cloud = readFileSync("apps/desktop/src/pages/CloudPage.tsx", "utf8");
const nav = readFileSync("apps/desktop/src/state/navigation.ts", "utf8");
const css = readFileSync("apps/desktop/src/styles/global.css", "utf8");

// ① 词表与注册表 needBind 完全一致（多一个少一个都不行）
const needs = [...new Set([...nav.matchAll(/needBind: "([a-z]+)"/g)].map((m) => m[1]))].sort();
const declared = (gate.match(/export type BindNeed = ([^;]+);/)?.[1] ?? "")
  .split("|")
  .map((s) => s.trim().replace(/"/g, ""))
  .filter(Boolean)
  .sort();
assert.deepEqual(declared, needs, "BindNeed 必须与注册表 needBind 逐项一致：注册表 " + needs.join("/") + "，组件 " + declared.join("/"));

// ② 手机贴底抽屉 + PC 居中；抓手走 CSS 伪元素（B3b 口径）
assert.ok(/alignItems: expanded \? "center" : "flex-end"/.test(gate), "手机要贴底、PC 要居中");
assert.ok(/env\(safe-area-inset-bottom\)/.test(gate), "贴底抽屉要给安全区让位");
assert.ok(
  /\.connect-gate-panel::before \{[\s\S]*?width: 32px;[\s\S]*?height: 4px;/.test(css),
  "手机端抓手缺失（与主题选择面板同口径：32×4 胶囊）",
);

// ③ 复用现成流程与真源，不另造
assert.ok(/YktQrPanel/.test(gate) && /YktWebLoginPanel/.test(gate), "雨课堂要复用现有扫码/网页面板");
assert.ok(/saveYuketang/.test(gate), "雨课堂 cookie 要走现有落地函数");
assert.ok(
  /export async function saveYuketang/.test(readFileSync("apps/desktop/src/components/ExtHwLoginModal.tsx", "utf8")),
  "saveYuketang 要导出，供 ConnectGate 复用",
);
assert.ok(/extHwLogin\.tuojCas/.test(gate), "TUOJ 要复用零输入漫游登录");
assert.ok(
  /connectMail/.test(gate) && /connectCloudDisk/.test(gate) && /accountSetup\.js/.test(gate),
  "邮箱与云盘要走 accountSetup 的组合动作（与设置页/导览同一套真源，语义不分叉）",
);
assert.ok(!/setSeafileToken|configureCloudCal/.test(gate), "不该绕过 accountSetup 直接调底层落库");

// ④ 成功后就地回原任务；三个接入点都真的接上了
assert.ok(/onDone\?\.\(\)/.test(gate), "成功后必须回调 onDone（回到原任务）");
assert.ok(/refreshExtHw\(\)/.test(gate), "绑定后要刷新外部作业源，别让人手动刷新");
assert.ok(/<ConnectGate need="yuketang"/.test(assign), "作业区要用 ConnectGate 承接雨课堂登录");
assert.ok(/<ConnectGate need="tuoj"/.test(assign), "TUOJ 失败条幅要能在原地重新登录");
assert.ok(!/ExtHwLoginModal/.test(assign), "作业区不该再直接挂 ExtHwLoginModal");
assert.ok(/<ConnectGate need="mail"/.test(mail) && /绑定邮箱/.test(mail), "邮箱页未配置时要在原地绑（onDone 后继续用邮箱）");
assert.ok(/<ConnectGate need="cloud"/.test(cloud) && /连接云盘/.test(cloud), "云盘页要复用同一个口令弹层，而不是各写一份输入框");

console.log(
  "ConnectGate 护栏：词表 ↔ needBind " + needs.join("/") + " ✓ / 手机贴底抽屉 + 抓手 ✓ / " +
  "复用现成绑定流程与 accountSetup ✓ / onDone 回原任务 ✓ / 作业区 + 邮箱页 + 云盘页已接 ✓",
);
