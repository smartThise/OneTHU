#!/usr/bin/env node
/* Course-files long list: scrolling must not leave rows invisible or queue
 * unbounded reveal animations.
 *
 * Root cause guarded here: the scroll-reveal observer assigned
 * `animationDelay = slot * 30ms` with no cap. A fast scroll / jump can hand one
 * IntersectionObserver batch dozens of rows; later rows stayed at opacity:0 for
 * seconds (`backwards` fill) while dozens of animations queued -> text vanished,
 * compositing flashed white and scrolling stuttered. motion.ts now caps the
 * stagger at 12 and marks the rest `data-reveal-in="instant"`.
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const motion = readFileSync("apps/desktop/src/lib/motion.ts", "utf8");
const motionCss = readFileSync("apps/desktop/src/styles/motion.css", "utf8");
const failures = [];
if (!motion.includes("STAGGER_MAX")) failures.push("motion.ts: missing STAGGER_MAX cap");
if (!motion.includes('data-reveal-in="instant"') && !motion.includes('el.dataset.revealIn = "instant"')) failures.push("motion.ts: far rows are not marked instant");
if (!motionCss.includes('[data-reveal-in="instant"]')) failures.push("motion.css: missing instant reveal rule");
if (!motionCss.includes("animation: none")) failures.push("motion.css: instant rows still animate");

const base = process.env.ONETHU_TEST_URL || "http://127.0.0.1:5180";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_BIN || undefined,
});
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
await page.waitForTimeout(1700);
await page.evaluate(async () => {
  const mod = (path) => performance.getEntriesByType("resource")
    .filter((entry) => new URL(entry.name).pathname === path).at(-1)?.name ?? new URL(path, location.href).href;
  const cache = await import(mod("/src/state/cache.ts"));
  cache.setPreviewMode(true);
  const data = await import(mod("/src/state/data.ts"));
  data.seedPreviewData();
  const bundle = data.getLearnSnapshot();
  bundle.courses = [{ id: "fixture-course", name: "测试课程", englishName: "Fixture", courseNumber: "1", courseIndex: 1, teacherName: "教师", timeAndLocation: [], url: "" }];
  bundle.files = Array.from({ length: 320 }, (_, i) => ({
    id: `fixture-file-${i}`,
    courseId: "fixture-course",
    title: `第 ${i + 1} 份课程文件`,
    uploadTime: `2026-10-${String((i % 28) + 1).padStart(2, "0")} 08:00`,
    fileType: "pdf",
  }));
  const theme = await import(mod("/src/state/theme.ts"));
  theme.activateTheme("onethu.theme.night");
  const glass = await import(mod("/src/lib/glassLevel.ts"));
  glass.setGlassLevel("rich");
  const explorer = await import(mod("/src/state/explorer.ts"));
  explorer.openTab("learn-files");
  await new Promise((resolve) => setTimeout(resolve, 1500));
});
// Jump to the bottom: this is the path that used to hand one IO batch many rows.
await page.evaluate(() => document.querySelectorAll(".learn-file-scroll .row")[319]?.scrollIntoView({ block: "center" }));
await page.waitForTimeout(1200);
const result = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".learn-file-scroll .row")].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight && r.height > 0;
  });
  const reports = rows.map((el) => {
    const cs = getComputedStyle(el);
    return {
      text: (el.textContent || "").slice(0, 16),
      opacity: Number(cs.opacity),
      animation: cs.animationName,
      delay: cs.animationDelay,
      reveal: el.dataset.revealIn,
    };
  });
  const longCard = document.querySelector(".learn-file-list");
  const cardStyle = longCard ? getComputedStyle(longCard) : null;
  return {
    total: document.querySelectorAll(".learn-file-scroll .row").length,
    visible: reports.length,
    hidden: reports.filter((r) => r.opacity < 0.99).slice(0, 6),
    longDelay: reports.filter((r) => parseFloat(r.delay) > 0.5).length,
    running: rows.filter((el) => el.getAnimations().some((a) => a.playState === "running")).length,
    docOverflow: document.documentElement.scrollHeight - innerHeight,
    previewInk: (() => {
      const b = document.querySelector(".learn-file-scroll .btn-ghost");
      const c = getComputedStyle(b);
      return { color: c.color, inline: b.style.color, bg: c.backgroundColor, tx: b.dataset.tx };
    })(),
    longCard: cardStyle ? {
      filter: cardStyle.backdropFilter,
      overflow: cardStyle.overflow,
      radius: cardStyle.borderRadius,
      shadow: cardStyle.boxShadow,
      height: Math.round((longCard?.getBoundingClientRect().height ?? 0)),
    } : null,
  };
});
// Probe the observer batch directly: 100 visible rows in one .list. The old
// unbounded stagger gave row 99 a 2.97s delay and kept it opacity:0; the capped
// version must reveal every probe row within ~0.6s and never queue > 12.
await page.setViewportSize({ width: 1440, height: 5000 });
await page.evaluate(() => {
  window.scrollTo(0, 0);
  const list = document.createElement("div");
  list.className = "list";
  list.id = "reveal-probe";
  list.style.cssText = "position:fixed;left:0;top:0;z-index:99999;width:600px;background:var(--surface)";
  for (let i = 0; i < 100; i++) {
    const row = document.createElement("div");
    row.className = "row row-click";
    row.textContent = `probe-row-${i}`;
    row.style.height = "36px";
    list.appendChild(row);
  }
  document.body.appendChild(list);
});
await page.waitForTimeout(1100);
const probe = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("#reveal-probe > .row")];
  return {
    count: rows.length,
    maxDelay: Math.max(...rows.map((el) => parseFloat(getComputedStyle(el).animationDelay) || 0)),
    hidden: rows.filter((el) => Number(getComputedStyle(el).opacity) < 0.99).length,
    running: rows.filter((el) => el.getAnimations().some((a) => a.playState === "running")).length,
    instant: rows.filter((el) => el.dataset.revealIn === "instant").length,
  };
});
if (probe.count !== 100) failures.push(`reveal probe: expected 100 rows, got ${probe.count}`);
if (probe.maxDelay > 0.5) failures.push(`reveal probe: max delay ${probe.maxDelay}s (unbounded stagger returned)`);
if (probe.hidden > 0) failures.push(`reveal probe: ${probe.hidden} rows still invisible`);
if (probe.running > 12) failures.push(`reveal probe: ${probe.running} animations running at once`);
if (probe.instant < 80) failures.push(`reveal probe: only ${probe.instant} instant rows`);

await browser.close();
if (result.total < 300) failures.push(`expected 320 rows, got ${result.total}`);
if (result.visible < 8) failures.push(`expected visible rows after scroll, got ${result.visible}`);
if (result.hidden.length) failures.push(`${result.hidden.length} scrolled rows still invisible: ${JSON.stringify(result.hidden)}`);
if (result.longDelay > 0) failures.push(`${result.longDelay} rows have reveal delay > 500ms`);
if (result.running > 12) failures.push(`${result.running} reveal animations running at once`);
if (!result.longCard) failures.push("long list card not found");
else {
  if (result.longCard.filter === "none") failures.push("fixed list window lost its glass blur");
  if (result.longCard.overflow !== "visible") failures.push(`long list card still clips the scroller: ${result.longCard.overflow}`);
  if (result.longCard.radius === "0px") failures.push("fixed list window lost its rounded glass frame");
  if (result.longCard.height > 900) failures.push(`fixed list window is not bounded: ${result.longCard.height}px`);
const ink = (result.longCard && result.previewInk?.color?.match(/\d+/g)?.map(Number)) ?? [];
if (!ink.length || (ink[0] + ink[1] + ink[2]) / 3 < 80) failures.push(`dark preview button ink is still dark: ${result.previewInk?.color}`);
if (result.previewInk?.bg === "rgba(0, 0, 0, 0)") failures.push("dark preview button has no readable surface");
if (result.docOverflow > 0) failures.push(`course files page still scrolls outside the fixed window: ${result.docOverflow}px`);
}
if (failures.length) {
  console.error("learn long-list render: FAIL");
  for (const failure of failures) console.error("  ✗ " + failure);
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log(`learn long-list render: 320 rows, bottom scroll shows ${result.visible} rows, no hidden rows, no >500ms delays, ≤12 concurrent animations ✓`);
