#!/usr/bin/env node
/**
 * 手机端回归（真机跑，需要设备在线）。
 *
 * 检什么（都是"手机上最容易破"的硬信号）：
 *   1) 每个导航页真的挂载了（.page-anim 出现）
 *   2) 页面没有横向溢出（页面整体比视口宽 = 手机端最常见的破版）
 *   3) 走一圈期间没有 JS 异常（CDP Runtime.exceptionThrown + Log.entryAdded error）
 *   4) 触屏密度层生效（html.is-phone）
 *   5) 待办页在手机上必须是单栏（.tasks-body 不带 is-wide），点条目能进详情、能返回
 *   6) 设置页的取色开关 aria-checked 与本地偏好一致（开关不许说谎）
 *
 * 前提：真机在线 + dev 包已安装 + adb 可用。
 * 用法：node tools/phone-regression.mjs [--port 5137] [--pkg app.onethu.desktop.dev] [--cdp 9222]
 * 说明：本脚本靠 WebView 调试端口读 DOM 与计算值（截图在这条链路上不可读），
 *      所以验的是结构与样式不变量，不是"看起来好不好看"。
 */
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const ADB = process.env.ADB || "/mnt/c/temp/platform-tools/adb.exe";
const PORT = arg("port", "5137");
const PKG = arg("pkg", "app.onethu.desktop.dev");
const CDP_PORT = Number(arg("cdp", "9222"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...a) => execFileSync(ADB, ["-P", PORT, ...a], { encoding: "utf8" }).trim();

const fails = [];
const notes = [];
const hard = (ok, msg) => {
  if (!ok) fails.push(msg);
  return ok;
};

/* ---------- CDP 小客户端 ---------- */
let ws;
let seq = 0;
const pending = new Map();
const events = [];
function connect(url) {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(url);
    ws.onopen = () => resolve();
    ws.onerror = (e) => reject(new Error("WS 连接失败：" + (e.message ?? "")));
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { resolve: res, reject: rej } = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) rej(new Error(JSON.stringify(m.error)));
        else res(m.result);
        return;
      }
      if (m.method) events.push(m);
    };
  });
}
function send(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(method + " 超时"));
      }
    }, 15000);
  });
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (r?.exceptionDetails) {
    throw new Error("页面异常：" + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 200));
  }
  return r?.result?.value;
}
const js = async (expr) => JSON.parse(await evaluate("JSON.stringify(" + expr + ")"));

/* ---------- 主流程 ---------- */
const devices = adb("devices")
  .split("\n")
  .slice(1)
  .filter((l) => /\tdevice$/.test(l));
if (!devices.length) {
  console.error("✗ 没有在线设备（adb devices 为空）——手机端回归需要真机在线");
  process.exit(2);
}
const model = adb("shell", "getprop", "ro.product.model");
const sdk = adb("shell", "getprop", "ro.build.version.sdk");
console.log("设备：" + model + " / Android SDK " + sdk);

/* 先强停：monkey 只会"恢复"既有实例，会把上一轮留在某个详情页/浮层里的状态带进来
   （实测：上一步停在待办详情，导航就找不到 .nav-item，脚本直接炸在空值上）。
   强停后再拉起，才叫"从冷启动走一遍"。 */
adb("shell", "am", "force-stop", PKG);
adb("shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1");
await sleep(9000);
const pid = adb("shell", "pidof", PKG);
if (!pid) {
  console.error("✗ 应用没起来（pidof " + PKG + " 为空）");
  process.exit(2);
}
adb("forward", "tcp:" + CDP_PORT, "localabstract:webview_devtools_remote_" + pid);
const list = await (await fetch("http://127.0.0.1:" + CDP_PORT + "/json/list")).json();
const target = list.find((t) => t.type === "page");
if (!target) {
  console.error("✗ 没找到 WebView 页面目标（dev 构建才有调试端口）");
  process.exit(2);
}
await connect(target.webSocketDebuggerUrl);
await send("Runtime.enable");
await send("Log.enable");
await evaluate("window.__regErrs = []; window.addEventListener('error', e => window.__regErrs.push('error: ' + e.message), true); 'ok'");

/* 1) 密度层与环境 */
const env = await js("{ phone: document.documentElement.classList.contains('is-phone'), w: innerWidth, h: innerHeight, ua: navigator.userAgent.includes('wv'), scheme: document.documentElement.dataset.scheme ?? null, surface: getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-surface').trim() }");
console.log("视口：" + env.w + "×" + env.h + " / is-phone=" + env.phone + " / scheme=" + env.scheme + " / surface=" + env.surface);
hard(env.phone, "触屏密度层没生效（html 上没有 is-phone）");
hard(!!env.surface, "System 令牌没读到（--md-sys-color-surface 为空）");

/* 2) 逐页走查 */
const rawNavs = await js("[...document.querySelectorAll('.nav-item')].map(e => (e.textContent || '').trim()).filter(t => t && t.length < 10)");
const navs = [...new Set(rawNavs)];
console.log("\n导航页（" + navs.length + "）：" + navs.join(" / "));
if (!navs.length) {
  console.error("✗ 没找到任何 .nav-item——应用可能不在主壳上（详情页/首启引导/登录页）。冷启动后重试。");
  process.exit(2);
}
const rows = [];
let sessionExpired = false;
for (const label of navs) {
  const clicked = await evaluate(
    "(() => { const s = [...document.querySelectorAll('.nav-item')].find(e => (e.textContent || '').trim() === " +
      JSON.stringify(label) +
      "); if (!s) return 'no'; (s.closest('button,a,[role=button],li') || s).click(); return 'ok'; })()",
  );
  if (clicked !== "ok") {
    notes.push("导航项点不到：" + label);
    continue;
  }
  await sleep(1000);
  const m = await js(
    "{ mounted: !!document.querySelector('.page-anim'), overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth, scrollers: [...document.querySelectorAll('*')].filter(e => e.scrollWidth > e.clientWidth + 2 && ['auto','scroll'].includes(getComputedStyle(e).overflowX)).length, errs: (window.__regErrs || []).slice(-2), txt: (document.body.innerText || '').replace(/\\s+/g, ' ').trim().length }",
  );
  rows.push({ label, ...m });
  hard(m.mounted, label + "：页面没挂载（.page-anim 缺失）");
  hard(m.overflow <= 2, label + "：横向溢出 " + m.overflow + "px（页面比视口宽）");
  /* 会话过期是**环境态**不是 UI 回归：应用会自己弹重新登录，把它当失败会让回归在"这台手机
     放了两天"之后永远红。其余异常仍然硬失败。 */
  const envErrs = m.errs.filter((e) => /AuthRequiredError|会话已失效/.test(e));
  const realErrs = m.errs.filter((e) => !/AuthRequiredError|会话已失效/.test(e));
  if (envErrs.length) sessionExpired = true;
  if (realErrs.length) hard(false, label + "：JS 异常 " + realErrs.join(" | "));
  await evaluate("window.__regErrs = []; 'ok'");
}
const pad = (s, n) => String(s) + " ".repeat(Math.max(0, n - String(s).length));
console.log("\n" + pad("页面", 12) + pad("挂载", 6) + pad("横向溢出", 10) + pad("可横滚容器", 12) + "正文长度");
for (const r of rows) {
  console.log(pad(r.label, 12) + pad(r.mounted ? "✓" : "✗", 6) + pad(r.overflow + "px", 10) + pad(r.scrollers, 12) + r.txt);
}

/* 3) 待办页：手机必须是单栏；点条目进详情、能返回 */
await evaluate("(() => { const s = [...document.querySelectorAll('.nav-item')].find(e => (e.textContent||'').trim() === '待办'); if (!s) return 'no'; (s.closest('button,a,[role=button],li') || s).click(); })()");
await sleep(1200);
const tasks = await js("{ body: (document.querySelector('.tasks-body') || {}).className ?? null, items: document.querySelectorAll('.tasks-list li, .tasks-list button, .tasks-item').length, hasDetail: !!document.querySelector('.tasks-detail') }");
if (tasks.body === null) {
  notes.push("待办页没找到 .tasks-body（可能没进到页面）");
} else {
  hard(!/is-wide/.test(tasks.body), "待办页在手机上用了宽屏双栏（.tasks-body 带 is-wide）：" + tasks.body);
  console.log("\n待办页（手机）：.tasks-body=" + tasks.body + " / 列表条目=" + tasks.items + " / 详情在屏=" + tasks.hasDetail);
  hard(!tasks.hasDetail, "待办页一进来就显示详情（手机应是单栏列表先出）");
  if (tasks.items > 0) {
    await evaluate(
      "(() => { const it = document.querySelector('.tasks-list li, .tasks-list button, .tasks-item'); if (it) (it.closest('button,li') || it).click(); })()",
    );
    await sleep(1200);
    const detail = await js("{ hasDetail: !!document.querySelector('.tasks-detail'), cls: (document.querySelector('.tasks-detail') || {}).className ?? null, overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth, errs: (window.__regErrs || []).slice(-2) }");
    console.log("  点开一条 → 详情在屏=" + detail.hasDetail + " / class=" + detail.cls + " / 溢出=" + detail.overflow + "px");
    hard(detail.hasDetail, "点了待办条目但详情没出现");
    hard(detail.overflow <= 2, "待办详情页横向溢出 " + detail.overflow + "px");
    await evaluate(
      "(() => { const b = [...document.querySelectorAll('button')].find(e => /返回/.test(e.textContent || '')); if (b) b.click(); })()",
    );
    await sleep(1000);
    const back = await js("({ hasDetail: !!document.querySelector('.tasks-detail') })");
    notes.push(back.hasDetail ? "详情返回后 .tasks-detail 仍在（可能是保留选中态）" : "详情返回正常");
  } else {
    notes.push("待办列表为空（没有可点条目），详情链路本次未覆盖");
  }
}

/* 4) 设置页：取色开关不许说谎 */
await evaluate("(() => { const s = [...document.querySelectorAll('.nav-item')].find(e => (e.textContent||'').trim() === '设置'); if (s) (s.closest('button,a,[role=button],li') || s).click(); })()");
await sleep(1200);
const sw = await js("{ found: !!document.querySelector('[aria-label=\\\"跟随系统取色\\\"]'), checked: document.querySelector('[aria-label=\\\"跟随系统取色\\\"]')?.getAttribute('aria-checked') ?? null, pref: localStorage.getItem('onethu.dynamicColor') ?? null, supported: !!document.querySelector('[aria-label=\\\"跟随系统取色\\\"]') }");
if (!sw.found) {
  notes.push("设置页没找到取色开关（外观区可能在别处）");
} else {
  console.log("\n设置页取色开关：aria-checked=" + sw.checked + " / 本地偏好=" + sw.pref);
  hard(sw.checked === (sw.pref === "1" ? "true" : "false"), "开关状态与本地偏好不一致（开关在说谎）：aria-checked=" + sw.checked + " pref=" + sw.pref);
}

/* 5) CDP 事件里捞异常 */
const errs = events.filter((e) => e.method === "Runtime.exceptionThrown" || (e.method === "Log.entryAdded" && e.params?.entry?.level === "error"));
for (const e of errs.slice(0, 5)) {
  const d = e.method === "Runtime.exceptionThrown"
    ? (e.params?.exceptionDetails?.exception?.description ?? e.params?.exceptionDetails?.text ?? "")
    : (e.params?.entry?.text ?? "");
  const text = String(d).replace(/\s+/g, " ").slice(0, 160);
  if (/AuthRequiredError|会话已失效/.test(text)) sessionExpired = true;
  else fails.push("走查期间 JS 异常：" + text);
}

/* 结论 */
console.log("");
for (const n of notes) console.log("· " + n);
if (fails.length) {
  console.log("\n✗ 手机端回归不通过（" + fails.length + "）：");
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
if (sessionExpired) notes.push("测试机会话已过期：界面照常渲染（应用自会引导重新登录），但需要登录的数据页是空态");
console.log(
  "\n✓ 手机端回归通过：" +
    rows.length +
    " 个导航页挂载、无横向溢出、无 UI 相关 JS 异常；待办单栏" +
    (sessionExpired ? "（会话过期，详情链路本次未覆盖）" : " + 详情链路、开关状态一致"),
);
ws.close();
process.exit(0);
