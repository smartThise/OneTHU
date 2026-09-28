/**
 * ConnectGate 护栏（§4.3）：业务入口放业务场景——未绑定在原地绑，绑完回到原任务。
 *
 * 这里守的是三件事，任何一件坏掉都会退回「把人送去设置页、办完自己走回来」的老体验：
 *  ① 弹层是手机贴底抽屉（B3b 口径：抓手 + 安全区），不是居中对话框；
 *  ② 绑定流程复用现成的（雨课堂两个面板 / TUOJ 零输入漫游 / 云盘口令），不另造一套；
 *  ③ 成功后必须回调 onDone 让调用方接着办原来那件事，并且作业区真的接上了。
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const gate = readFileSync("apps/desktop/src/components/ConnectGate.tsx", "utf8");
const assign = readFileSync("apps/desktop/src/pages/learn/AssignmentsPage.tsx", "utf8");
const css = readFileSync("apps/desktop/src/styles/global.css", "utf8");

// ① 词表与注册表 needBind 对齐
for (const need of ["yuketang", "tuoj", "mail", "cloud", "calendar"]) {
  assert.ok(gate.includes(`"${need}"`), "BindNeed 少了 " + need);
}
assert.ok(/export type BindNeed =/.test(gate), "要导出 BindNeed 类型");

// ② 手机贴底抽屉 + PC 居中；抓手走 CSS 伪元素（B3b 口径）
assert.ok(
  /alignItems: expanded \? "center" : "flex-end"/.test(gate),
  "手机要贴底、PC 要居中（不是一套居中对话框打天下）",
);
assert.ok(/env\(safe-area-inset-bottom\)/.test(gate), "贴底抽屉要给安全区让位");
assert.ok(
  /\.connect-gate-panel::before \{[\s\S]*?width: 32px;[\s\S]*?height: 4px;/.test(css),
  "手机端抓手缺失（与主题选择面板同口径：32×4 胶囊）",
);

// ③ 复用现成绑定流程，不另造
assert.ok(/YktQrPanel/.test(gate) && /YktWebLoginPanel/.test(gate), "雨课堂要复用现有扫码/网页面板");
assert.ok(/saveYuketang/.test(gate), "雨课堂 cookie 要走现有落地函数（保存 + 刷新 + 心跳）");
assert.ok(
  /export async function saveYuketang/.test(readFileSync("apps/desktop/src/components/ExtHwLoginModal.tsx", "utf8")),
  "saveYuketang 要导出，供 ConnectGate 复用",
);
assert.ok(/extHwLogin\.tuojCas/.test(gate), "TUOJ 要复用零输入漫游登录");
assert.ok(/setSeafileToken/.test(gate), "云盘要复用现有口令落地");

// ④ 成功后就地回到原任务；去设置那条路要走页签请求，不能停在设置第一栏
assert.ok(/onDone\?\.\(\)/.test(gate), "成功后必须回调 onDone（回到原任务）");
assert.ok(/refreshExtHw\(\)/.test(gate), "绑定后要刷新外部作业源，别让人手动刷新");
assert.ok(/requestSettingsTab\("数据与同步"\)/.test(gate), "「去设置填写」要直达所在栏目");

// ⑤ 作业区真的接上了
assert.ok(/<ConnectGate need="yuketang"/.test(assign), "作业区要用 ConnectGate 承接雨课堂登录");
assert.ok(/<ConnectGate need="tuoj"/.test(assign), "TUOJ 失败条幅要能在原地重新登录");
assert.ok(
  !/ExtHwLoginModal/.test(assign),
  "作业区不该再直接挂 ExtHwLoginModal（已由 ConnectGate 统一承接）",
);

console.log("ConnectGate 护栏：词表 5 项 ↔ needBind ✓ / 手机贴底抽屉 + 抓手 ✓ / 复用现成绑定流程 ✓ / onDone 回原任务 ✓ / 作业区已接 ✓");
