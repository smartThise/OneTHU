/**
 * 正文图片因会话失效加载失败时的中央提示护栏。
 *
 * 背景（2026-09-25 实录）：PC 上通知正文的图片全部变成半透明碎图，用户无从推断原因。
 * 真机/PC 现场查下去是会话失效——原生 `fetch_binary` 拿回登录页时**直接抛字符串**
 * 「会话已失效，需要重新登录」，而 `RichContent` 的 `catch {` 不接错误、只把图调暗，
 * 数据页那条「会话已失效」提示链又完全不覆盖这条旁路。现在会话类失败会弹一次
 * 屏幕正中的提示「图片加载失败，请重新登录」。
 *
 * [1] isSessionExpiredError 判定（字符串错误 / Error / 其他失败不得误报）
 * [2] 接线守卫：catch 接住错误、会话类才弹、中央档位、去重窗口
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/session-img-toast-test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { isSessionExpiredError, rawErrorText } = await import("../apps/desktop/src/lib/sessionErrors.ts");

/* ---------- [1] 判定 ---------- */

// 原生 fetch_binary 抛的就是字符串
assert.equal(isSessionExpiredError("会话已失效，需要重新登录"), true, "原生字符串错误必须认出来");
assert.equal(isSessionExpiredError(new Error("会话已失效，需要重新登录")), true, "core 的 SessionExpiredError 必须认出来");
assert.equal(isSessionExpiredError("未登录"), true, "「未登录」同类");
assert.equal(isSessionExpiredError({ message: "需要重新登录" }), true, "带 message 的对象错误也要认");
// 不能误报：图片失败有一堆别的原因，只有登录态那一类才该弹「请重新登录」
assert.equal(isSessionExpiredError("too-large:9000000:8388608"), false, "文件过大不是会话问题");
assert.equal(isSessionExpiredError("图片直连响应非图片（mime=text/css bytes=120）"), false, "响应非图片不等于会话失效");
assert.equal(isSessionExpiredError("网络超时：请确认校园网 / WebVPN 可达。"), false, "网络超时不是会话问题");
assert.equal(isSessionExpiredError(""), false, "空原因不弹");
assert.equal(isSessionExpiredError(undefined), false, "undefined 不弹");
assert.equal(rawErrorText("abc"), "abc", "rawErrorText 对字符串原样返回（判定复用它的口径）");

/* ---------- [2] 接线守卫 ---------- */

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const shared = read("apps/desktop/src/pages/learn/shared.tsx");
const toast = read("apps/desktop/src/state/toast.ts");
const app = read("apps/desktop/src/App.tsx");
const css = read("apps/desktop/src/styles/global.css");

// catch 必须接住错误：`catch {` 会把原因整个丢掉（这正是当时查不出原因的直接原因）
assert.ok(/catch \(e\) \{/.test(shared), "RichContent 的 catch 必须接住错误变量");
assert.ok(!/catch \{\s*\n\s*if \(!cancelled\)/.test(shared), "不许再回到不接错误变量的裸 catch");
assert.ok(shared.includes("isSessionExpiredError(e)"), "会话类失败必须走判定函数");
assert.ok(shared.includes("图片加载失败，请重新登录"), "提示文案必须在位");
assert.ok(/showToast\("图片加载失败，请重新登录",\s*\d+,\s*\{\s*center:\s*true\s*\}\)/.test(shared), "必须是中央档位（center: true）");
assert.ok(shared.includes("SESSION_TOAST_GAP_MS") && /lastSessionToastAt/.test(shared), "必须有去重窗口（一页多张图同时失败只提醒一次）");
assert.ok(shared.includes("${reason.slice(0, 120)}"), "log_debug 行必须带上失败原因，不再只有 URL");
assert.ok(shared.includes('img.setAttribute("title"'), "碎图要能悬停看到原因");
// 判定挪到零依赖叶子模块（transport.ts 会把 @onethu/core 拖进来，测不动），
// 但老调用点仍从 transport 拿得到，别把已有 import 打断
assert.ok(read("apps/desktop/src/lib/transport.ts").includes('export { rawErrorText, isSessionExpiredError } from "./sessionErrors.js"'), "transport 必须继续转出这两个函数");

// toast 基础设施：中央档位一路传到 DOM 与样式
assert.ok(/export interface ToastState/.test(toast) && /center: boolean/.test(toast), "toast 状态必须带 center 档位");
assert.ok(/opts: \{ center\?: boolean \} = \{\}/.test(toast), "showToast 必须接受 center 选项");
assert.ok(app.includes('msg.center ? " is-center" : ""'), "ToastHost 必须把 center 映射成 is-center 类");
assert.ok(css.includes(".toast-host.is-center"), "中央样式必须在位");
assert.ok(/\.toast-host\.is-center\s*\{[^}]*transform:\s*translate\(-50%,\s*-50%\)/.test(css), "中央提示必须真正居中");

console.log("session-img-toast-test: 全部断言通过（会话判定 9 态 + 接线与样式守卫）");
