#!/usr/bin/env node
/* Assignment list layout: fixed inner viewport + one material/text style across filter tabs.
 *
 * Regression guarded here:
 *  - 140 rows made the assignment card taller than a GPU texture; the old global
 *    ">40 rows" rule removed its blur/radius, so tabs with different row counts
 *    looked different and dark-mode text contrast drifted.
 *  - The list now scrolls inside a fixed-height card and opts out of that downgrade.
 */
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
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    const mod = (path) => performance.getEntriesByType("resource").filter((e) => new URL(e.name).pathname === path).at(-1)?.name ?? new URL(path, location.href).href;
    const cache = await import(mod("/src/state/cache.ts"));
    cache.setPreviewMode(true);
    const data = await import(mod("/src/state/data.ts"));
    data.seedPreviewData();
    const bundle = data.getLearnSnapshot();
    bundle.homework = Array.from({ length: 140 }, (_, i) => ({
      id: `fixture-hw-${i}`,
      courseId: "c1",
      title: `第 ${i + 1} 份作业`,
      content: "",
      publishTime: "2026-10-01",
      deadline: i < 90 ? "2099-12-31 23:59" : i < 110 ? "2020-01-01 23:59" : "2099-12-31 23:59",
      submitted: i >= 90 && i < 110,
      graded: i >= 110,
      url: "",
    }));
    const theme = await import(mod("/src/state/theme.ts"));
    theme.activateTheme("onethu.theme.night");
    const glass = await import(mod("/src/lib/glassLevel.ts"));
    glass.setGlassLevel("rich");
    const explorer = await import(mod("/src/state/explorer.ts"));
    explorer.openTab("learn-assignments");
    await new Promise((r) => setTimeout(r, 1200));
  });

  await page.locator(".learn-assignment-list").waitFor({ state: "visible", timeout: 10_000 });
  const pane = page.locator('[data-tab-page="learn-assignments"]:visible');
  const tabs = (await pane.count()) ? pane.locator('[role="tab"]') : page.locator('[role="tab"]');
  // 0 unfinished, 2 submitted, 3 graded, 5 all — populated in the fixture.
  const indices = [0, 2, 3, 5];
  const styles = [];
  for (const index of indices) {
    await tabs.nth(index).click();
    await page.waitForTimeout(300);
    const measured = await page.evaluate(() => {
      const card = document.querySelector(".learn-assignment-list");
      const scroll = document.querySelector(".learn-assignment-scroll");
      const row = scroll?.querySelector(".row");
      if (!card || !scroll || !row) throw new Error("assignment card + inner scroller + row missing");
      const cs = getComputedStyle(card);
      return {
        cardHeight: card.getBoundingClientRect().height,
        scrollHeight: scroll.scrollHeight,
        clientHeight: scroll.clientHeight,
        radius: cs.borderRadius,
        blur: cs.backdropFilter,
        rowColor: getComputedStyle(row).color,
        docOverflow: document.documentElement.scrollHeight - innerHeight,
      };
    });
    assert.ok(measured.cardHeight > 300 && measured.cardHeight < 950, `fixed card height (${measured.cardHeight})`);
    assert.ok(measured.scrollHeight > measured.clientHeight, "long list scrolls inside the card");
    assert.ok(measured.blur !== "none", "glass blur remains on every populated tab");
    assert.ok(measured.radius !== "0px", "card radius remains on every populated tab");
    assert.ok(measured.docOverflow <= 1, `no page-level overflow (${measured.docOverflow})`);
    styles.push({ index, ...measured });
  }
  assert.equal(new Set(styles.map((s) => s.rowColor)).size, 1, "dark-mode row text color is identical across tabs");
  assert.equal(new Set(styles.map((s) => s.blur)).size, 1, "blur is identical across tabs");
  // Vertical tab strip has a different chrome height; the card must still fill the page.
  await page.evaluate(() => document.documentElement.classList.add("tabs-vertical"));
  await page.waitForTimeout(500);
  const vertical = await page.evaluate(() => {
    const card = document.querySelector(".learn-assignment-list");
    return {
      cardHeight: card?.getBoundingClientRect().height ?? 0,
      docOverflow: document.documentElement.scrollHeight - innerHeight,
    };
  });
  assert.ok(vertical.cardHeight > 300, `vertical card height (${vertical.cardHeight})`);
  assert.ok(vertical.docOverflow <= 1, `vertical layout has no page overflow (${vertical.docOverflow})`);
  console.log("assignments-layout-test: fixed viewport + uniform blur/text across tabs ✓");
} finally {
  await browser.close();
}
