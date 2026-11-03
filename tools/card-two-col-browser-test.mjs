/** 校园卡页：≥1024 左右两栏（左余额/统计/预警，右最近消费），窄屏上下堆叠；右侧列表与左栏同高并内部滚动。 */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.env.ONETHU_TEST_URL ?? "http://127.0.0.1:5180";
const out = process.env.ONETHU_TEST_OUT ?? "/tmp/onethu-card-two-col";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || undefined });
let count = 0;
const check = (value, label) => { assert.ok(value, label); count++; console.log("✓ " + label); };

async function setup(width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.setDefaultTimeout(15000);
  await page.routeWebSocket(/127\.0\.0\.1:5180/, () => {});
  await page.route("**/*", (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.addInitScript(() => {
    localStorage.setItem("onethu.onboarded.phone", "1");
    localStorage.setItem("onethu.onboarded.flow3", "1");
    localStorage.setItem("onethu.onboarded.flow4", "1");
    localStorage.setItem("onethu.privacy.v1", JSON.stringify({ acknowledged: true, cloud: true, oh: true }));
    localStorage.setItem("onethu.experience.v1", "full");
    localStorage.setItem("onethu.overlay.closed", "1");
  });
  await page.goto(base + "/?explorer-preview=onboarding");
  await page.locator(".explorer-shell").waitFor();
  await page.waitForTimeout(1400);
  await page.evaluate(async () => {
    const path = (p) => performance.getEntriesByType("resource").map((e) => e.name).find((u) => new URL(u).pathname === p) ?? p;
    const cache = await import(path("/src/state/cache.ts")); cache.setPreviewMode(true);
    const data = await import(path("/src/state/data.ts")); data.seedPreviewData();
    const bundle = data.createPreviewDataset().get("card:30").data;
    cache.cacheSet("card:30", {
      ...bundle,
      transactions: Array.from({ length: 60 }, (_, i) => ({
        id: `tx${i}`,
        summary: `示例消费 ${i}`,
        timestamp: new Date(Date.now() - i * 86400000),
        amount: -(i + 1),
        balance: 1000 - i,
      })),
    });
    (await import(path("/src/state/explorer.ts"))).openTab("life", { lifeTab: "card" });
  });
  await page.waitForTimeout(1600);
  return page;
}

const page = await setup(1440, 950);
const read = () => page.evaluate(() => {
  const grid = document.querySelector(".card-two-col");
  const main = document.querySelector(".card-col-main");
  const side = document.querySelector(".card-col-side");
  const win = side?.querySelector(".list-window");
  const scroll = win?.querySelector(".list-window-scroll");
  const r = (el) => el ? el.getBoundingClientRect().toJSON() : null;
  return {
    display: grid ? getComputedStyle(grid).display : null,
    grid: r(grid), main: r(main), side: r(side), win: r(win),
    client: scroll?.clientHeight ?? 0,
    scrollHeight: scroll?.scrollHeight ?? 0,
    rows: scroll?.querySelectorAll(".row").length ?? 0,
    overflowX: document.documentElement.scrollWidth > innerWidth + 1,
  };
});
const wide = await read();
check(wide.display === "grid", "≥1024 使用左右两栏");
check(wide.main && wide.side && Math.abs(wide.main.width - wide.side.width) <= 1, "左右两栏等宽（各占一半）");
check(Math.abs(wide.side.height - wide.main.height) <= 1, "右栏与左栏同高");
check(wide.win && Math.abs(wide.win.height - (wide.main.height - 34)) <= 8, "最近消费列表填满右栏剩余高度");
console.log("DEBUG", wide);
check(wide.scrollHeight > wide.client && wide.rows === 60, "流水在卡片内部滚动，不撑高页面");
check(!wide.overflowX, "两栏布局无横向溢出");
await page.screenshot({ path: `${out}/desktop.png` });
await page.close();

const narrow = await setup(900, 900);
const stacked = await narrow.evaluate(() => {
  const grid = document.querySelector(".card-two-col");
  const main = document.querySelector(".card-col-main");
  const side = document.querySelector(".card-col-side");
  const r = (el) => el?.getBoundingClientRect().toJSON();
  return { display: grid ? getComputedStyle(grid).display : null, main: r(main), side: r(side) };
});
check(stacked.display !== "grid" && stacked.side.top >= stacked.main.bottom - 1, "窄屏保持上下堆叠，不并排");
await narrow.screenshot({ path: `${out}/narrow.png` });
await narrow.close();

writeFileSync(`${out}/report.json`, JSON.stringify({ checks: count, wide, stacked }, null, 2));
console.log(`\n校园卡两栏回归：${count} 项通过（${out}）`);
await browser.close();
