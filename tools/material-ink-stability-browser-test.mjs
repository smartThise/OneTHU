/** 材质 / 文字颜色稳定性回归（2026-10-31）。
 *
 * 守住两条用户反复遇到、且会因页面动画回归的问题：
 *   1. 入场动画期间玻璃卡片的背景模糊不能消失；
 *   2. 页面打开后文字颜色不能在用户眼前跳变（对比度引擎在中间态定格）。
 *
 * 使用隔离 Chromium、合成棋盘壁纸与预览数据；不接触真实账号、Cookie 或用户壁纸。
 * 跑法（先启动 Vite 5180）：node tools/material-ink-stability-browser-test.mjs
 */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const base = process.env.ONETHU_TEST_URL ?? "http://127.0.0.1:5180";
const out = process.env.ONETHU_TEST_OUT ?? "/tmp/onethu-material-stability";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
let count = 0;
const check = (value, label) => { assert.ok(value, label); count++; console.log("✓ " + label); };

/** 高对比棋盘壁纸：任何平滑渐变都看不出模糊是否生效，棋盘可以。 */
const checker = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#fff"/><g fill="#111">'
  + Array.from({ length: 8 }, (_, i) => `<rect x="${(i % 4) * 40}" y="${Math.floor(i / 4) * 40}" width="20" height="20"/>`).join("")
  + '</g><g fill="#e11">'
  + Array.from({ length: 8 }, (_, i) => `<rect x="${(i % 4) * 40 + 20}" y="${Math.floor(i / 4) * 40}" width="20" height="20"/>`).join("")
  + '</g><g fill="#17a">'
  + Array.from({ length: 8 }, (_, i) => `<rect x="${(i % 4) * 40}" y="${Math.floor(i / 4) * 40 + 80}" width="20" height="20"/>`).join("")
  + "</g></svg>";
const wallpaper = JSON.stringify({ v: 3, global: "data:image/svg+xml;utf8," + encodeURIComponent(checker), day: null, night: null, library: [] });

const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(15000);
await page.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
await page.route("**/*", (route) => {
  const url = new URL(route.request().url());
  return ["127.0.0.1", "localhost"].includes(url.hostname) ? route.continue() : route.abort();
});
await page.addInitScript(({ wp }) => {
  localStorage.setItem("onethu.onboarded.phone", "1");
  localStorage.setItem("onethu.onboarded.flow3", "1");
  localStorage.setItem("onethu.onboarded.flow4", "1");
  localStorage.setItem("onethu.privacy.v1", JSON.stringify({ acknowledged: true, cloud: true, oh: true }));
  localStorage.setItem("onethu.experience.v1", "full");
  localStorage.setItem("onethu.overlay.closed", "1");
  localStorage.setItem("onethu.glass.level", "clear");
  localStorage.setItem("onethu.wallpaper.v1", wp);
  window.__inkChanges = [];
  const state = new Map();
  const SELECTOR = ".stat-label, .stat-num, .page-head h1, .og-pagehead-topic h1, .learn-page-note, .row-title, .row-sub, .learn-course-title, .learn-course-details";
  setInterval(() => {
    for (const el of document.querySelectorAll(SELECTOR)) {
      const color = getComputedStyle(el).color;
      const key = (el.className || el.tagName) + "|" + (el.textContent || "").trim().slice(0, 18);
      const previous = state.get(key);
      if (previous !== color) {
        state.set(key, color);
        if (previous !== undefined) window.__inkChanges.push({ t: Math.round(performance.now()), key, from: previous, to: color, tx: el.dataset.tx ?? null });
      }
    }
  }, 16);
  window.__resetInk = () => { window.__inkChanges = []; };
}, { wp: wallpaper });

await page.goto(base + "/?explorer-preview=onboarding");
await page.locator(".explorer-shell").waitFor();
await page.waitForTimeout(1500);

await page.evaluate(async () => {
  const path = (p) => performance.getEntriesByType("resource").map((e) => e.name).find((u) => new URL(u).pathname === p) ?? p;
  const src = { cache: path("/src/state/cache.ts"), data: path("/src/state/data.ts"), exthw: path("/src/state/exthw.ts"), explorer: path("/src/state/explorer.ts"), theme: path("/src/state/theme.ts") };
  window.__src = src;
  const cache = await import(src.cache); cache.setPreviewMode(true);
  const data = await import(src.data); data.seedPreviewData();
  const bundle = data.getLearnSnapshot();
  bundle.courses = [{ id: "fixture-0", name: "高等数学A(1)", englishName: "Course", courseNumber: "1", courseIndex: 1, teacherName: "示例教师", timeAndLocation: [], url: "" }];
  bundle.homework = []; bundle.notifications = []; bundle.files = [];
  const ext = await import(src.exthw); const snapshot = ext.getExtHwSnapshot(); snapshot.state = "ready"; snapshot.items = []; snapshot.contents = []; snapshot.courses = [];
});

// ── 1. 页面打开：文字颜色从首帧起稳定 ──────────────────────────────
await page.evaluate(() => window.__resetInk());
await page.evaluate(async () => { (await import(window.__src.explorer)).openTab("learn"); });
await page.locator(".learn-page .stats .stat-card").first().waitFor();
await page.waitForTimeout(1300);
const learnChanges = await page.evaluate(() => window.__inkChanges.slice());
check(learnChanges.length === 0, `页面首开无文字颜色跳变（记录 ${learnChanges.length} 次）`);

// ── 2. 材质卡片不被逐项 opacity 动画扫过 ────────────────────────────
const chain = await page.evaluate(() => {
  const card = document.querySelector(".learn-page .stats .stat-card");
  const panel = document.querySelector('.explorer-panel[data-page="learn"]') ?? document.querySelector(".explorer-panel");
  const out = { statsAnimation: getComputedStyle(document.querySelector(".stats")).animationName, pageAnimation: getComputedStyle(document.querySelector(".page-anim")).animationName, ancestors: [] };
  for (let node = card; node && node !== document.documentElement; node = node.parentElement) {
    const cs = getComputedStyle(node);
    out.ancestors.push({ cls: String(node.className).slice(0, 48), opacity: cs.opacity, filter: cs.filter, animation: cs.animationName });
  }
  void panel;
  return out;
});
check(chain.statsAnimation === "none", "统计卡容器没有逐项动画");
check(chain.pageAnimation === "none", "页面容器没有入场动画（不建立 backdrop root）");
check(chain.ancestors.every((a) => Number(a.opacity) === 1 && a.filter === "none"), "材质卡片祖先链全部 opacity=1 / filter=none");

// ── 3. 二级页头：只做 transform 动画，玻璃模糊全程存在 ─────────────
await page.addStyleTag({ content: "*{animation-duration:3s !important}" });
await page.evaluate(async () => { (await import(window.__src.explorer)).openTab("learn-assignments"); });
await page.waitForTimeout(450);
const head = await page.evaluate(() => {
  const panel = [...document.querySelectorAll('.explorer-panel[data-tab-page="learn-assignments"]')].find((p) => getComputedStyle(p).display !== "none");
  const pageHead = panel?.querySelector(".og-pagehead");
  const host = pageHead?.closest(".page-head-host");
  return {
    hostAnimation: host ? getComputedStyle(host).animationName : null,
    hostOpacity: host ? getComputedStyle(host).opacity : null,
    blur: pageHead ? getComputedStyle(pageHead).backdropFilter : null,
  };
});
check(head.hostAnimation === "m-page-head-in" && head.hostOpacity === "1", "二级页头入场为纯位移动画、opacity 不变");
check(/blur\(/.test(head.blur ?? ""), "二级页头动画期间保留背景模糊");

// ── 4. 弹层：遮罩只动背景，面板模糊与不透明度全程有效 ───────────────
await page.evaluate(async () => { (await import("/src/lib/confirm.tsx")).confirmOk("示例确认"); });
await page.locator(".og-panel").waitFor();
const samples = [];
for (let i = 0; i < 30; i++) {
  samples.push(await page.evaluate(() => {
    const panel = document.querySelector(".og-panel");
    const scrim = document.querySelector(".og-scrim");
    const pc = panel ? getComputedStyle(panel) : null;
    const sc = scrim ? getComputedStyle(scrim) : null;
    return { panelOpacity: pc?.opacity, panelBlur: pc?.backdropFilter, scrimOpacity: sc?.opacity, scrimBg: sc?.backgroundColor };
  }));
  await page.waitForTimeout(35);
}
check(samples.every((s) => Number(s.panelOpacity) === 1), "弹层打开全程面板 opacity=1（模糊不被打断）");
check(samples.every((s) => Number(s.scrimOpacity) === 1), "弹层遮罩不改变 opacity（只动背景色）");
check(samples.every((s) => /blur\(/.test(s.panelBlur ?? "")), "弹层打开全程面板 backdrop-filter 有效");
check(new Set(samples.map((s) => s.scrimBg)).size > 1, "遮罩背景色确实在过渡（不是瞬间出现）");
await page.screenshot({ path: `${out}/modal-mid.png` });
await page.evaluate(() => { const btn = [...document.querySelectorAll(".og-panel button")].find((b) => b.textContent?.includes("取消")); btn?.click(); });
await page.waitForTimeout(300);

// ── 4b. 顶部搜索/OH 面板：整块磨砂，不被折射管线释放成裸半透明面 ──
await page.locator(".ohx-capsule").click();
await page.locator(".dock-panel").waitFor();
await page.waitForTimeout(900);
const dock = await page.evaluate(() => {
  const panel = document.querySelector(".dock-panel");
  if (!panel) return null;
  const cs = getComputedStyle(panel);
  const chain = [];
  for (let node = panel; node && node !== document.documentElement; node = node.parentElement) {
    const s = getComputedStyle(node);
    chain.push({ opacity: Number(s.opacity), filter: s.filter });
  }
  return {
    bg: cs.backgroundColor,
    blur: cs.backdropFilter,
    opacity: Number(cs.opacity),
    chain,
  };
});
check(dock && /blur\(|url\(["']?#og-lens-/.test(dock.blur ?? ""), "搜索/OH 面板保持背景模糊（大面板释放折射后恢复静态 blur）");
check(dock && !dock.bg.endsWith("/ 1)") && dock.bg !== "rgba(0, 0, 0, 0)", "搜索/OH 面板是半透明材质");
check(dock && dock.opacity === 1 && dock.chain.every((a) => a.opacity === 1 && a.filter === "none"), "搜索/OH 面板及祖先无透明度合成组");
await page.screenshot({ path: `${out}/search-panel.png` });
await page.locator(".ohx-capsule").click();
await page.waitForTimeout(300);

// ── 5. 主题切换：过渡结束后不再有第二轮跳色 ────────────────────────
await page.evaluate(async () => { (await import(window.__src.theme)).activateTheme("onethu.theme.night"); });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__resetInk());
await page.evaluate(async () => { (await import(window.__src.explorer)).openTab("info"); });
await page.waitForTimeout(1200);
const lateChanges = await page.evaluate(() => window.__inkChanges.slice());
check(lateChanges.length === 0, `深色主题下打开页面无二次跳色（记录 ${lateChanges.length} 次）`);
await page.screenshot({ path: `${out}/dark-info.png` });

// ── 6. 玻璃档切换：重取落定后不再反复换墨 ──────────────────────────
await page.evaluate(async () => {
  const path = (p) => performance.getEntriesByType("resource").map((e) => e.name).find((u) => new URL(u).pathname === p) ?? p;
  (await import(path("/src/lib/glassLevel.ts"))).setGlassLevel("balanced");
});
await page.waitForTimeout(1000);
await page.evaluate(() => window.__resetInk());
await page.waitForTimeout(800);
const levelChanges = await page.evaluate(() => window.__inkChanges.slice());
check(levelChanges.length === 0, `玻璃档切换落定后无反复换墨（记录 ${levelChanges.length} 次）`);

writeFileSync(`${out}/report.json`, JSON.stringify({ checks: count, learnChanges, head, samples, lateChanges, levelChanges, fixture: "isolated Chromium + synthetic checker wallpaper + preview data" }, null, 2));
console.log(`\n材质 / 字色稳定性浏览器回归：${count} 项通过（${out}）`);
await browser.close();
