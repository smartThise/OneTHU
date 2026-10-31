/** OneGUI Select：自绘下拉的桌面浮层 / 手机底部面板 / 键盘 / 暗色材质回归。
 *
 * 根因：原生 <select> 的弹层由系统绘制，深色与玻璃皮肤无法跟随 OneGUI（用户实拍
 * 设置页线程数下拉是白底黑字）。本测试要求应用内不再出现原生 select，并验证
 * 自绘 listbox 在桌面与手机两种落点、明暗两种主题下的材质与交互。
 */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const base = process.env.ONETHU_TEST_URL ?? "http://127.0.0.1:5180";
const out = process.env.ONETHU_TEST_OUT ?? "/tmp/onethu-select-control";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || undefined });
let count = 0;
const check = (value, label) => { assert.ok(value, label); count++; console.log("✓ " + label); };

/** 应用与组件库不允许再出现原生 <select>（弹层无法跟随 OneGUI 材质）。 */
function findNativeSelects(dir) {
  const hits = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { hits.push(...findNativeSelects(full)); continue; }
    if (!/\.(tsx|ts)$/.test(entry.name)) continue;
    const text = readFileSync(full, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    if (/<select\b/.test(text)) hits.push(full);
  }
  return hits;
}
const nativeSelects = [...findNativeSelects("apps/desktop/src"), ...findNativeSelects("packages/gui/src")];
check(nativeSelects.length === 0, `没有原生 <select>（遗留：${nativeSelects.join(", ") || "无"}）`);


async function setup(width, height, opts = {}) {
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 600 });
  page.setDefaultTimeout(15000);
  await page.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(url.hostname) ? route.continue() : route.abort();
  });
  await page.addInitScript(({ dark }) => {
    localStorage.setItem("onethu.onboarded.phone", "1");
    localStorage.setItem("onethu.onboarded.flow3", "1");
    localStorage.setItem("onethu.onboarded.flow4", "1");
    localStorage.setItem("onethu.privacy.v1", JSON.stringify({ acknowledged: true, cloud: true, oh: true }));
    localStorage.setItem("onethu.experience.v1", "full");
    localStorage.setItem("onethu.overlay.closed", "1");
    localStorage.setItem("onethu.glass.level", "clear");
    if (dark) localStorage.setItem("onethu.theme.active", "onethu.theme.night");
  }, opts);
  await page.goto(base + "/?explorer-preview=onboarding");
  await page.locator(".explorer-shell").waitFor();
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    const path = (p) => performance.getEntriesByType("resource").map((e) => e.name).find((u) => new URL(u).pathname === p) ?? p;
    (await import(path("/src/state/explorer.ts"))).openTab("trace");
  });
  await page.waitForTimeout(700);
  return page;
}

// ── 1. 桌面：锚定浮层 + 键盘选择 + 明暗材质 ─────────────────────────
const desktop = await setup(1280, 900);
const trigger = desktop.locator(".trace-opt .og-select-trigger").first();
const before = (await trigger.innerText()).trim();
await trigger.click();
await desktop.locator(".og-select-pop").waitFor();
await desktop.waitForTimeout(320);
const pop = await desktop.evaluate(() => {
  const el = document.querySelector(".og-select-pop");
  const cs = el ? getComputedStyle(el) : null;
  return {
    role: el?.getAttribute("role"),
    options: el?.querySelectorAll('[role="option"]').length ?? 0,
    bg: cs?.backgroundColor,
    blur: cs?.backdropFilter,
    rect: el?.getBoundingClientRect().toJSON(),
  };
});
check(pop.role === "listbox" && pop.options === 3, "桌面下拉是自绘 listbox 且选项完整");
check(pop.bg !== "rgba(0, 0, 0, 0)" && !pop.bg.endsWith("/ 1)"), "桌面下拉是半透明浮层材质");
check(/blur\(|url\(["']?#og-lens-/.test(pop.blur ?? ""), "桌面下拉带背景模糊/透镜材质");
check(pop.rect.width >= 120 && pop.rect.left >= 0 && pop.rect.right <= 1280, "桌面下拉锚定在视口内");
await desktop.keyboard.press("ArrowDown");
await desktop.keyboard.press("Enter");
await desktop.waitForTimeout(600);
const after = (await trigger.innerText()).trim();
check(after !== before, "键盘上下 + 回车可以改变选中值");
check(await desktop.locator(".og-select-pop").count() === 0, "选中后弹层关闭");

// 暗色：同一个弹层不能回到系统白底黑字
await desktop.evaluate(async () => {
  const path = (p) => performance.getEntriesByType("resource").map((e) => e.name).find((u) => new URL(u).pathname === p) ?? p;
  (await import(path("/src/state/theme.ts"))).activateTheme("onethu.theme.night");
});
await desktop.waitForTimeout(1200);
await trigger.click();
await desktop.locator(".og-select-pop").waitFor();
const darkPop = await desktop.evaluate(() => {
  const el = document.querySelector(".og-select-pop");
  const cs = el ? getComputedStyle(el) : null;
  return { scheme: document.documentElement.dataset.scheme, bg: cs?.backgroundColor, color: cs?.color };
});
check(darkPop.scheme === "dark" && darkPop.bg !== "rgb(255, 255, 255)" && darkPop.color !== "rgb(0, 0, 0)", "暗色模式下弹层跟随 OneGUI 材质，不是系统白底黑字");
await desktop.screenshot({ path: `${out}/desktop-dark-open.png` });
await desktop.keyboard.press("Escape");
await desktop.waitForTimeout(150);
check(await desktop.locator(".og-select-pop").count() === 0, "Esc 关闭弹层");
await desktop.screenshot({ path: `${out}/desktop-dark.png` });
await desktop.close();

// ── 2. 手机：底部选择面板 ─────────────────────────────────────────
const phone = await setup(390, 844);
const phoneTrigger = phone.locator(".trace-opt .og-select-trigger").first();
const phoneBefore = (await phoneTrigger.innerText()).trim();
await phoneTrigger.click();
await phone.locator(".og-select-sheet").waitFor();
check(await phone.locator(".og-select-backdrop").count() === 1, "手机下拉有遮罩");
const sheet = await phone.evaluate(() => {
  const el = document.querySelector(".og-select-sheet");
  return { role: el?.getAttribute("role"), options: el?.querySelectorAll('[role="option"]').length ?? 0, rect: el?.getBoundingClientRect().toJSON() };
});
check(sheet.role === "listbox" && sheet.options === 3, "手机底部面板可选项完整");
check(sheet.rect.bottom >= 839 && sheet.rect.width >= 300, "手机面板贴底且铺满可用宽度");
await phone.screenshot({ path: `${out}/phone-open.png` });
await phone.locator(".og-select-sheet [role=option]").nth(1).click();
await phone.waitForTimeout(250);
check((await phoneTrigger.innerText()).trim() !== phoneBefore, "手机点选后值更新");
check(await phone.locator(".og-select-sheet").count() === 0, "手机选中后面板关闭");
await phone.screenshot({ path: `${out}/phone.png` });
await phone.close();

writeFileSync(`${out}/report.json`, JSON.stringify({ checks: count, pop, darkPop, sheet }, null, 2));
console.log(`\nOneGUI Select 浏览器回归：${count} 项通过（${out}）`);
await browser.close();
