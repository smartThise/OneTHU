/**
 * 网络学堂静默重登护栏（R21c 用户口径：「有账号密码且记住，登过了就应该静默」；
 * 2026-09-23 依 #42 复核扩充）。
 *
 * [1] #withRelogin 必须真实现：捕获 SessionExpiredError → 重建会话 → 重试一次，
 *     且重建走 #recoverSession（并发去重：多个数据钩子一起撞上会话死只重建一次）
 * [2] 只对「会话问题」生效：启动期无会话的 AuthRequiredError 仍直接上抛（不空转重登）
 * [3] 会话没建立起来要抛「可重建」的标记（缺凭据不是「已失效」，得先重建再报错）
 * [4] 作业/通知/详情三个入口在 #withRelogin 之外——必须先自证会话（#42 的直接病灶）
 * [5] 提交作业撞 HTML（登录页/网关页）→ 抛标记走重登重试；重试仍失败才回过期提示
 * [6] 登录链半路断：app.tsx 用同凭据静默重试一次，两次失败才回登录页
 * [7] 界面文案只补一句可操作的下一步，不再给已说清「会话」的句子套前缀（#42 截图）
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const client = read("packages/core/src/learn/client.ts");

/* ---------- [1] core：#withRelogin 真实现 + 重建去重 ---------- */
assert.ok(/class SessionExpiredError extends AuthRequiredError/.test(client), "必须定义 SessionExpiredError 标记类");
assert.ok(
  /class LearnSessionMissingError extends SessionExpiredError/.test(client),
  "「登录状态没建立起来」必须抛可重建的标记（继承 SessionExpiredError）",
);
const reloginBody = client.slice(client.indexOf("async #withRelogin"), client.indexOf("#requireCsrf(): string"));
assert.ok(reloginBody.includes("#recoverSession()"), "#withRelogin 必须经 #recoverSession 重建（并发去重）");
assert.ok(reloginBody.includes("SessionExpiredError"), "#withRelogin 只对会话标记生效");
assert.ok((reloginBody.match(/await fn\(\)/g) ?? []).length === 2, "重试恰好一次（首跑 + 重建后重跑）");
const recoverBody = client.slice(client.indexOf("async #recoverSession"), client.indexOf("async #ensureCsrfReady"));
assert.ok(recoverBody.includes("silentRelogin()"), "#recoverSession 必须真调 silentRelogin");
assert.ok(recoverBody.includes("#reloginInflight"), "重建必须去重（并发重链互相烧票据）");
assert.ok(recoverBody.includes("finally"), "在飞标记必须在结束后清零，否则一次失败永久卡死");

/* ---------- [2] 启动期无会话不上抛成「空转重登」 ---------- */
const requireCsrf = client.slice(client.indexOf("#requireCsrf(): string"), client.indexOf("/** learn-lib addCSRFTokenToUrl"));
assert.ok(/throw new LearnSessionMissingError\(\)/.test(requireCsrf), "缺凭据必须抛可重建标记");
assert.ok(!/throw new AuthRequiredError\(\)/.test(requireCsrf), "不得再抛无信息的默认错误（用户看到的是「已失效」）");

/* ---------- [3] 缺凭据的文案面向用户，不带实现术语 ---------- */
const msg = /super\("([^"]+)"\)/.exec(client.slice(client.indexOf("class LearnSessionMissingError"), client.indexOf("function extractLearnCsrf")))?.[1] ?? "";
assert.ok(msg.length > 0, "缺凭据错误必须有文案");
assert.ok(!/csrf|token|Cookie/i.test(msg), `文案不得泄露实现术语：${msg}`);

/* ---------- [4] 作业/通知/详情入口必须先自证会话（#42 病灶） ---------- */
for (const sig of [
  "async getAllHomework(courseIds: string[]): Promise<Homework[]> {",
  "async getHomeworkPageDetail(courseId: string, studentHomeworkId: string): Promise<HomeworkPageDetail> {",
  "async getNotificationPageDetail(courseId: string, notificationId: string): Promise<NotificationPageDetail> {",
  "async getAllNotifications(courseIds: string[], expired = false): Promise<Notification[]> {",
]) {
  const at = client.indexOf(sig);
  assert.ok(at > 0, `找不到入口：${sig}`);
  const body = client.slice(at, client.indexOf("\n  async ", at + 10));
  const ensure = body.indexOf("await this.#ensureCsrfReady()");
  const need = body.indexOf("this.#requireCsrf()");
  assert.ok(ensure >= 0, `入口缺会话自证（会话一死连重建机会都没有）：${sig}`);
  assert.ok(ensure < need, `会话自证必须先于凭据检查：${sig}`);
}

/* ---------- [5] 提交作业的过期链路 ---------- */
const submit = client.slice(client.indexOf("async submitHomework"), client.indexOf("async getHomeworkDetail"));
assert.ok(/throw new SessionExpiredError\("网络学堂会话已失效/.test(submit), "HTML 响应必须抛标记走重登重试");
assert.ok(submit.includes("会话已过期，请重新登录后再提交"), "重试仍失败才回过期提示");
assert.ok(submit.split("会话已过期，请重新登录后再提交").length - 1 === 1,
  "过期提示只允许出现在兜底 catch 一处（HTML 判定处必须抛标记先重试）");
assert.ok(submit.indexOf("throw new SessionExpiredError") < submit.indexOf('msg: "会话已过期'),
  "抛标记必须先于兜底提示");

/* ---------- [6] 学习会话的宿主侧重建通路 ---------- */
const clientsTs = read("apps/desktop/src/lib/clients.ts");
assert.ok(/learn\.reloginHook\s*=/.test(clientsTs), "桌面端必须注入重建钩子（lib 探活 + id-漫游）");
const hookBody = clientsTs.slice(clientsTs.indexOf("learn.reloginHook"));
assert.ok(hookBody.includes("libEnsureSession"), "重建钩子必须探活主会话");
assert.ok(hookBody.includes("libRoamLearn"), "重建钩子必须漫游建立学习会话");
const silent = client.slice(client.indexOf("async silentRelogin"), client.indexOf("async #fetchCsrf"));
assert.ok(silent.includes("this.reloginHook"), "silentRelogin 必须优先用宿主钩子");
assert.ok(
  silent.indexOf("this.reloginHook") < silent.indexOf('wrap("https://learn.tsinghua.edu.cn/f/login")'),
  "宿主钩子必须排在已作废的 /f/login 前",
);

/* ---------- [7] 界面文案不重复套前缀 ---------- */
const transport = read("apps/desktop/src/lib/transport.ts");
assert.ok(!/`会话已失效：\$\{raw\}/.test(transport), "不得再套「会话已失效：」前缀（#42 截图里的重复文案）");
assert.ok(transport.includes("下拉刷新即可重试"), "会话类报错必须给出可操作的下一步");
assert.ok(transport.includes("lastErrorText"), "最近一次报错原文须留档（供用户主动复制诊断摘要）");

console.log("learn-silent-relogin-test: 全部断言通过（真重登 + 去重 + 会话自证 + 过期链路 + 文案不重复）");
