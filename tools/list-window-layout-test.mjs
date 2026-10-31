#!/usr/bin/env node
/* Learn list pages use ListWindow: content scrolls inside a card whose height fills the
 * available viewport; rows keep semantic ink and pages do not add a second scrollbar. */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.ONETHU_TEST_URL || "http://127.0.0.1:5180";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_BIN || undefined,
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  await page.routeWebSocket(/127\.0\.0\.1:5180/, () => {});
  await page.route("**/*", (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.addInitScript(() => {
    localStorage.setItem("onethu.onboarded.phone", "1");
    localStorage.setItem("onethu.experience.v1", "full");
    localStorage.setItem("onethu.overlay.closed", "1");
    localStorage.setItem("onethu.privacy.v1", JSON.stringify({ acknowledged: true, cloud: true, oh: false }));
  });
  await page.goto(base + "/?explorer-preview=home");
  await page.locator(".explorer-shell").waitFor();
  await page.waitForTimeout(1200);
  await page.evaluate(async () => {
    const mod = (path) => performance.getEntriesByType("resource").filter((e) => new URL(e.name).pathname === path).at(-1)?.name ?? new URL(path, location.href).href;
    const cache = await import(mod("/src/state/cache.ts")); cache.setPreviewMode(true);
    const data = await import(mod("/src/state/data.ts")); data.seedPreviewData();
    const theme = await import(mod("/src/state/theme.ts")); theme.activateTheme("onethu.theme.night");
    const glass = await import(mod("/src/lib/glassLevel.ts")); glass.setGlassLevel("balanced");
  });
  const open = async (name, params) => {
    await page.evaluate(async ({ name, params }) => {
      const mod = (path) => performance.getEntriesByType("resource").filter((e) => new URL(e.name).pathname === path).at(-1)?.name ?? new URL(path, location.href).href;
      const explorer = await import(mod("/src/state/explorer.ts")); explorer.openTab(name, params);
    }, { name, params });
    await page.waitForTimeout(1200);
  };
  const read = () => page.evaluate(() => {
    const active = [...document.querySelectorAll(".page-anim")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 400 && r.height > 100 && r.bottom > 0 && r.top < innerHeight;
    }).at(-1);
    const win = active?.querySelector(".list-window");
    const scroll = win?.querySelector(".list-window-scroll");
    const row = scroll?.querySelector(".row, .tl-title");
    return {
      hasWindow: Boolean(win),
      height: win?.getBoundingClientRect().height ?? 0,
      scrollHeight: scroll?.scrollHeight ?? 0,
      clientHeight: scroll?.clientHeight ?? 0,
      rowColor: row ? getComputedStyle(row).color : null,
      winBottom: win?.getBoundingClientRect().bottom ?? 0,
      bottomBarTop: document.querySelector(".oneshot")?.getBoundingClientRect().top ?? innerHeight,
      headerAnimation: (() => {
        const h = active?.querySelector(".page-head-host");
        return h ? getComputedStyle(h).animationName : null;
      })(),
    };
  });
  for (const [name, params] of [["learn-notices"], ["learn-course", { courseId: "c1" }], ["tasks"]]) {
    await open(name, params);
    const r = await read();
    assert.equal(r.hasWindow, true, `${name}: ListWindow present`);
    assert.ok(r.height > 300, `${name}: fills available viewport (${r.height})`);
    assert.ok(r.scrollHeight >= r.clientHeight, `${name}: rows live in scroll viewport`);
    assert.notEqual(r.rowColor, "rgb(0, 0, 0)", `${name}: rows are not black in dark mode`);
    assert.ok(r.winBottom <= r.bottomBarTop + 1, `${name}: list ends above quick-action bar (${r.winBottom} > ${r.bottomBarTop})`);
    if (name !== "tasks") assert.equal(r.headerAnimation, "m-page-head-in", `${name}: secondary page header entrance restored`);
  }
  console.log("list-window-layout-test: notices/course/tasks lists fixed + dark ink + secondary animation ✓");
} finally {
  await browser.close();
}
