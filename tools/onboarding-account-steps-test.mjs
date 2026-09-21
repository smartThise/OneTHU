/**
 * 首启导览「账号接入步骤」护栏（R21b，用户定案 2026-09-21）。
 *
 * 需求原文：扫码登录/手机验证码/webview 雨课堂（看情况，和设置里一样的操作）/
 * 部分 OJ 账号密码/邮箱+客户端专用密码/云盘 Web API Token；每步一个引导窗、
 * 每步可跳过；新旧用户都要展现；填过的只标识、输入区仍展示。
 *
 * [1] 导览含 4 个账号步骤（5–8），STEPS=9，且每步有「跳过此步」
 * [2] 登录实现必须走设置页同一套 state（经 state/accountSetup.ts 组合），不得复制
 * [3] 导览版本号升到 v2（老用户也会看到一轮）
 * [4] 已配置标识： AcctBadge 存在且对五项都可用
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/* ---------- [1] 步骤结构与可跳过 ---------- */
const tour = read("apps/desktop/src/components/OnboardingTour.tsx");
for (const n of [5, 6, 7, 8]) {
  assert.ok(tour.includes(`step === ${n} ? (`), `导览缺少步骤 ${n} 的账号接入窗`);
}
assert.ok(/const STEPS = 10;/.test(tour), "STEPS 必须是 10（0–4 界面定制 + 5–8 账号接入 + 9 桌面小组件）");
assert.ok(tour.includes("跳过此步"), "账号步骤必须有「跳过此步」");
assert.ok(/step < STEPS - 1 \? setStep\(step \+ 1\) : finish\(\)/.test(tour),
  "最后一步跳过必须能直接完成导览");
assert.ok(/微信扫码登录/.test(tour), "雨课堂扫码登录入口");
assert.ok(tour.includes("官方网页登录（手机号验证码）"), "网页登录（含手机验证码）入口");
assert.ok(tour.includes("YKT_WEB_LOGIN_AVAILABLE"), "webview 入口必须按平台开关「看情况」展示");
assert.ok(tour.includes("客户端专用密码获取：清华大学电子邮件系统网站 → 设置 → 安全设置 → 客户端专用密码"),
  "邮箱步骤须带获取路径说明");
assert.ok(tour.includes("Web API Auth Token → 生成"), "云盘步骤须带获取路径说明");

/* ---------- [1b] 桌面小组件步骤（R21c 用户令：引导里放一块今日日程小组件） ---------- */
assert.ok(tour.includes("step === 9 ? ("), "导览缺少桌面小组件步骤（step 9）");
const widgetStep = tour.slice(tour.indexOf("step === 9 ? ("), tour.indexOf("step === 9 ? (") + 2600);
assert.ok(widgetStep.includes("桌面小组件"), "步骤标题必须是「桌面小组件」");
assert.ok(widgetStep.includes("pinWidget()"), "必须经系统请求式放置（pinWidget）");
assert.ok(/setWidgetFallback\(\{ kind: "today" \}\)/.test(widgetStep), "新放的这块要默认显示「今日日程」");
assert.ok(widgetStep.includes("ensureWidgetRuntime()"), "放置后要确保运行时就绪（否则显示「点一下选择」）");
assert.ok(widgetStep.includes("isAndroidHost"), "非 Android 不得展示一个点不动的按钮");
assert.ok(widgetStep.includes("长按桌面"), "不支持请求式放置时要给出手动路径");
// 安全性：这一步只碰小组件相关 API，不得动账号/提交/忽略等既有链路
for (const forbidden of ["submitHomework", "ignoreHw", "connectMail(", "loginTyche("]) {
  assert.ok(!widgetStep.includes(forbidden), `小组件步骤不得触碰 ${forbidden}（保证不影响其他功能）`);
}
// 每步可跳过：step 9 也落在「>=5 用跳过此步」的区间里
assert.ok(/step >= 5 \?/.test(tour), "step 9 必须有「跳过此步」");

/* ---------- [2] 组合不复制：登录实现走既有 state 模块 ---------- */
const setup = read("apps/desktop/src/state/accountSetup.ts");
for (const dep of ["./exthw.js", "./cloudCal.js", "./seafile.js"]) {
  assert.ok(setup.includes(dep), `accountSetup 必须复用既有 state 模块 ${dep}`);
}
for (const fn of ["extHwLogin.tyche", "extHwLogin.dsa", "configureCloudCal", "setSeafileToken", "saveExtHwCreds"]) {
  assert.ok(setup.includes(fn), `accountSetup 必须经 ${fn} 落库（与设置页同一路径）`);
}
assert.ok(tour.includes('from "../state/accountSetup.js"'), "导览必须经 accountSetup 组合层");
assert.ok(!tour.includes("extHwLogin."), "导览不得直接调底层登录（须走 accountSetup）");
assert.ok(!tour.includes("saveExtHwCreds(") && !tour.includes("configureCloudCal(") && !tour.includes("setSeafileToken("),
  "导览不得直接落库（须走 accountSetup）");
assert.ok(tour.includes("YktQrPanel") && tour.includes("YktWebLoginPanel"),
  "雨课堂面板必须复用设置页同款组件（ExtHwLoginModal）");

/* ---------- [3] 版本号：老用户也要看到 ---------- */
const onboarding = read("apps/desktop/src/state/onboarding.ts");
assert.ok(/const KEY = "onethu\.onboarded\.v2";/.test(onboarding),
  "导览版本必须是 v2（新增账号步骤后，老用户升一轮）");
assert.ok(!onboarding.includes("onethu.onboarded.v1"), "不得再读写 v1 旧键");

/* ---------- [4] 已配置标识 ---------- */
assert.ok(tour.includes("function AcctBadge"), "必须有已配置徽标组件");
assert.ok(tour.includes("已配置") && tour.includes("未配置"), "徽标文案：已配置 / 未配置");
for (const flag of ["acct.yuketang", "acct.tyche || acct.dsa", "acct.mail", "acct.cloud"]) {
  assert.ok(tour.includes(`<AcctBadge on={${flag}}`), `徽标未覆盖：${flag}`);
}

console.log("onboarding-account-steps-test: 全部断言通过（4 步接入 + 每步可跳 + v2 + 组合不复制 + 已配置标识）");
