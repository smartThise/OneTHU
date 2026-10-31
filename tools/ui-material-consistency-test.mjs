#!/usr/bin/env node
/* GUI material unification:
 *  - Page/card entrance must never hide or de-blur a material surface.
 *  - Dark-mode page text/buttons use semantic tokens, not per-element contrast locks.
 *  - Opaque (balanced) and transparent (rich) modes keep the same card layout.
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
  await page.waitForTimeout(1200);
  await page.evaluate(async () => {
    const mod = (path) => performance.getEntriesByType("resource").filter((e) => new URL(e.name).pathname === path).at(-1)?.name ?? new URL(path, location.href).href;
    const cache = await import(mod("/src/state/cache.ts")); cache.setPreviewMode(true);
    const data = await import(mod("/src/state/data.ts")); data.seedPreviewData();
    const theme = await import(mod("/src/state/theme.ts")); theme.activateTheme("onethu.theme.night");
  });

  const setMode = async (level) => {
    await page.evaluate(async (level) => {
      const mod = (path) => performance.getEntriesByType("resource").filter((e) => new URL(e.name).pathname === path).at(-1)?.name ?? new URL(path, location.href).href;
      const glass = await import(mod("/src/lib/glassLevel.ts")); glass.setGlassLevel(level);
    }, level);
    await page.waitForTimeout(250);
  };
  const open = async (name) => {
    await page.evaluate(async (name) => {
      const mod = (path) => performance.getEntriesByType("resource").filter((e) => new URL(e.name).pathname === path).at(-1)?.name ?? new URL(path, location.href).href;
      const explorer = await import(mod("/src/state/explorer.ts")); explorer.openTab(name);
    }, name);
  };
  const read = () => page.evaluate(() => {
    const active = [...document.querySelectorAll(".page-anim")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 400 && r.height > 100 && r.bottom > 0 && r.top < innerHeight;
    }).at(-1);
    const cards = [...(active?.querySelectorAll(".card,.og-card") ?? [])].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 40 && r.height > 20 && r.bottom > 0 && r.top < innerHeight;
    });
    const title = active?.querySelector("h1");
    const btn = [...(active?.querySelectorAll(".og-btn") ?? [])].find((el) => (el.textContent ?? "").trim());
    return {
      keep: active?.getAttribute("data-tx") === "keep",
      locked: active?.querySelectorAll('[data-tx="lock"],[data-txi="lock"]').length ?? 0,
      cards: cards.length,
      firstBlur: cards[0] ? getComputedStyle(cards[0]).backdropFilter : "none",
      titleColor: title ? getComputedStyle(title).color : null,
      buttonColor: btn ? getComputedStyle(btn).color : null,
      rects: cards.map((el) => {
        const r = el.getBoundingClientRect();
        return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`;
      }),
    };
  });

  const results = {};
  for (const level of ["balanced", "rich"]) {
    await setMode(level);
    await open("info");
    await page.waitForTimeout(40);
    const early = await read();
    await page.waitForTimeout(1000);
    const late = await read();
    assert.equal(late.keep, true, `${level}: page opts out of contrast locks`);
    assert.equal(late.locked, 0, `${level}: no contrast-engine locks inside page`);
    assert.ok(early.cards > 0, `${level}: cards rendered on first frames`);
    assert.ok(late.cards > 0, `${level}: cards rendered`);
    assert.equal(early.titleColor, late.titleColor, `${level}: title color stable across entrance`);
    assert.equal(early.buttonColor, late.buttonColor, `${level}: button color stable across entrance`);
    if (level === "rich") {
      assert.notEqual(early.firstBlur, "none", "rich: card blur is present at first paint");
      assert.equal(early.firstBlur, late.firstBlur, "rich: card blur does not appear late");
    }
    results[level] = late;
  }
  assert.equal(results.balanced.cards, results.rich.cards, "card count identical in opaque/transparent modes");
  assert.equal(results.balanced.rects.length, results.rich.rects.length, "same card count in both modes");
  for (let i = 0; i < results.balanced.rects.length; i++) {
    const a = results.balanced.rects[i].split(",").map(Number);
    const b = results.rich.rects[i].split(",").map(Number);
    for (let j = 0; j < 4; j++) assert.ok(Math.abs(a[j] - b[j]) <= 3, `card ${i} geometry stable across modes (${a} vs ${b})`);
  }
  assert.equal(results.balanced.titleColor, results.rich.titleColor, "title ink identical in both modes");
  assert.equal(results.balanced.buttonColor, results.rich.buttonColor, "button ink identical in both modes");
  console.log("ui-material-consistency-test: stable page/card material + unified ink across modes ✓");
} finally {
  await browser.close();
}
