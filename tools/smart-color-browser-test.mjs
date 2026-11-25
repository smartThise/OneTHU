#!/usr/bin/env node
/** 智能取色：OneTHU 壁纸源端到端（浏览器预览）。 */
import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.env.ONETHU_TEST_URL ?? "http://127.0.0.1:5180";
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || undefined });
let n = 0;
const check = (v, label) => { assert.ok(v, label); n++; console.log("✓ " + label); };
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(20000);
await page.routeWebSocket(/127\.0\.0\.1:5180/, () => {});
await page.route("**/*", (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
await page.addInitScript(() => {
  localStorage.setItem("onethu.onboarded.phone", "1");
  localStorage.setItem("onethu.privacy.v1", JSON.stringify({ acknowledged: true, cloud: true, oh: true }));
});
await page.goto(base + "/?explorer-preview=onboarding");
await page.locator(".explorer-shell").waitFor();
await page.waitForTimeout(900);
const initial = await page.evaluate(async () => {
  const path = (p) => performance.getEntriesByType("resource").map((e) => e.name).find((u) => new URL(u).pathname === p) ?? p;
  const dyn = await import(path("/src/lib/dynamicColor.ts"));
  return { enabled: dyn.isDynamicEnabled(), source: dyn.dynamicSource() };
});
check(initial.enabled === false, "智能取色默认关闭");
check(initial.source === "system", "默认来源是系统");
const result = await page.evaluate(async () => {
  const path = (p) => performance.getEntriesByType("resource").map((e) => e.name).find((u) => new URL(u).pathname === p) ?? p;
  const wall = await import(path("/src/state/wallpaper.ts"));
  wall.setGlobalWallpaper("builtin:aurora");
  const dyn = await import(path("/src/lib/dynamicColor.ts"));
  dyn.setDynamicSource("wallpaper");
  await dyn.enableDynamicColor("wallpaper");
  await new Promise((r) => setTimeout(r, 500));
  const root = getComputedStyle(document.documentElement);
  const btn = document.querySelector(".oneshot-button");
  return {
    outline: root.getPropertyValue("--md-sys-color-outline").trim(),
    line2: root.getPropertyValue("--og-line-2").trim(),
    dynamic: document.documentElement.dataset.dynamic,
    source: localStorage.getItem("onethu.dynamicColor.source"),
    enabled: localStorage.getItem("onethu.dynamicColor"),
    accent: root.getPropertyValue("--og-accent").trim(),
    btnBg: btn ? getComputedStyle(btn).backgroundColor : "",
  };
});
check(result.dynamic === "on", "壁纸源打开 data-dynamic");
check(result.source === "wallpaper", "来源持久化为 wallpaper");
check(result.enabled === "1", "智能取色偏好持久化");
check(/^rgb/.test(result.accent), "从壁纸生成强调色：" + result.accent);
check(result.btnBg === result.accent.replace(/\s+/g, " "), "按钮跟随壁纸强调色");
const neutral = (hex) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return Math.max(r, g, b) - Math.min(r, g, b) <= 2;
};
check(neutral(result.outline), "动态 outline 保持中性灰：" + result.outline);
check(neutral(result.line2), "结构描边 line-2 保持中性灰：" + result.line2);
const changed = await page.evaluate(async () => {
  const path = (p) => performance.getEntriesByType("resource").map((e) => e.name).find((u) => new URL(u).pathname === p) ?? p;
  const wall = await import(path("/src/state/wallpaper.ts"));
  const before = getComputedStyle(document.documentElement).getPropertyValue("--og-accent").trim();
  wall.setGlobalWallpaper("builtin:matcha");
  await new Promise((r) => setTimeout(r, 800));
  return { before, after: getComputedStyle(document.documentElement).getPropertyValue("--og-accent").trim() };
});
check(changed.after !== changed.before, "换壁纸后自动重算强调色：" + changed.before + " → " + changed.after);
await browser.close();
console.log(`智能取色壁纸源：${n} 项通过`);
