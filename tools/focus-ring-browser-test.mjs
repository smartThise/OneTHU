#!/usr/bin/env node
/** 指针模态不出现主题色聚焦外圈；键盘模态保留焦点环。 */
import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.env.ONETHU_TEST_URL ?? "http://127.0.0.1:5180";
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || undefined });
let n = 0;
const check = (v, label) => { assert.ok(v, label); n++; console.log("✓ " + label); };
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(15000);
await page.routeWebSocket(/127\.0\.0\.1:5180/, () => {});
await page.route("**/*", (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
await page.addInitScript(() => localStorage.setItem("onethu.onboarded.phone", "1"));
await page.goto(base + "/?explorer-preview=onboarding");
await page.locator(".explorer-shell").waitFor();
await page.waitForTimeout(800);
await page.evaluate(async () => {
  const path = (p) => performance.getEntriesByType("resource").map((e) => e.name).find((u) => new URL(u).pathname === p) ?? p;
  const cache = await import(path("/src/state/cache.ts")); cache.setPreviewMode(true);
  const data = await import(path("/src/state/data.ts")); data.seedPreviewData();
  const theme = await import(path("/src/state/theme.ts")); theme.activateTheme("onethu.theme.celadon");
  const ex = await import(path("/src/state/explorer.ts")); ex.openTab("tasks");
});
await page.waitForTimeout(900);
const pointer = await page.evaluate(() => {
  const phone = document.documentElement.dataset.input;
  const el = document.querySelector(".task-stat");
  el.focus();
  return { phone, visible: el.matches(":focus-visible"), shadow: getComputedStyle(el).boxShadow };
});
check(pointer.phone === "pointer", "初始输入模态为指针");
check(pointer.visible === true, "程序化 focus 仍命中 :focus-visible（正因如此才需要模态门）");
check(pointer.shadow === "none", "指针模态不画聚焦外圈");
const keyboard = await page.evaluate(() => {
  document.documentElement.dataset.input = "keyboard";
  const el = document.querySelector(".task-stat");
  el.focus();
  return getComputedStyle(el).boxShadow;
});
check(/13, 148, 136/.test(keyboard), "键盘模态保留主题色焦点环");
await browser.close();
console.log(`聚焦外圈模态：${n} 项通过`);
