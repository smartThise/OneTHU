/** 课程详情：通知/文件的网络学堂 / 雨课堂双来源改为子 tab，列表固定视口；默认通知列表首开即固定。
 *
 * 用户 2026-11-01 现场：
 *  - 「课程文件」「课程通知」两来源上下堆叠，希望像作业状态一样 tab 切换；
 *  - 从课程卡进入详情时默认通知 tab 会整页滚到底、列表直接铺开，切一次 tab 才恢复；
 *  - 图标中心比旁边文字高（已在 OneGUI Btn label 内统一修正，本测试不重复）。
 */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.env.ONETHU_TEST_URL ?? "http://127.0.0.1:5180";
const out = process.env.ONETHU_TEST_OUT ?? "/tmp/onethu-course-tabs";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || undefined });
let count = 0;
const check = (value, label) => { assert.ok(value, label); count++; console.log("✓ " + label); };

const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
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
const courseName = await page.evaluate(async () => {
  const path = (p) => performance.getEntriesByType("resource").map((e) => e.name).find((u) => new URL(u).pathname === p) ?? p;
  const cache = await import(path("/src/state/cache.ts")); cache.setPreviewMode(true);
  const data = await import(path("/src/state/data.ts")); data.seedPreviewData();
  const bundle = data.getLearnSnapshot();
  const course = bundle.courses[0];
  bundle.notifications = Array.from({ length: 60 }, (_, i) => ({ id: `n${i}`, courseId: course.id, title: `网络通知 ${i}`, publishTime: `2026-10-${String((i % 28) + 1).padStart(2, "0")} 10:00`, publisher: "老师" }));
  bundle.files = Array.from({ length: 40 }, (_, i) => ({ id: `f${i}`, courseId: course.id, title: `网络文件 ${i}`, uploadTime: `2026-10-${String((i % 28) + 1).padStart(2, "0")} 09:00`, size: 1024 }));
  const ext = await import(path("/src/state/exthw.ts")); const snapshot = ext.getExtHwSnapshot();
  snapshot.state = "ready";
  snapshot.courses = [{ id: "ykt1", source: "yuketang", name: "课堂", title: course.name }];
  snapshot.contents = [
    ...Array.from({ length: 20 }, (_, i) => ({ id: `yf${i}`, source: "yuketang", courseId: "ykt1", kind: "file", kindText: "资料", title: `雨课堂资料 ${i}`, deadline: null, leafId: "l1" })),
    ...Array.from({ length: 15 }, (_, i) => ({ id: `yn${i}`, source: "yuketang", courseId: "ykt1", kind: "announcement", kindText: "公告", title: `雨课堂公告 ${i}`, deadline: null })),
  ];
  window.__headAnims = 0;
  document.addEventListener("animationstart", (e) => {
    if (e.target instanceof HTMLElement && e.target.classList.contains("page-head-host")) window.__headAnims++;
  }, true);
  // 记录行第一次出现在 DOM 后的第一帧是否已经带有 reveal 标记（标记晚到 = 先静止再跳回左侧）
  window.__revealFirstFrame = [];
  const seenRows = new WeakSet();
  const track = () => {
    for (const row of document.querySelectorAll(".list-window-scroll .row")) {
      if (seenRows.has(row)) continue;
      seenRows.add(row);
      const el = row;
      requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        if (rect.bottom > 0 && rect.top < innerHeight) window.__revealFirstFrame.push({ marked: Boolean(el.dataset.revealIn), top: Math.round(rect.top), text: el.textContent.slice(0, 8) });
      });
    }
    requestAnimationFrame(track);
  };
  requestAnimationFrame(track);
  (await import(path("/src/state/explorer.ts"))).openTab("learn-course", { courseId: course.id });
  return course.name;
});
await page.waitForTimeout(1600);

const readList = () => page.evaluate(() => {
  const active = [...document.querySelectorAll(".page-anim")].find((el) => el.getBoundingClientRect().width > 400 && getComputedStyle(el).display !== "none");
  const win = active?.querySelector(".list-window");
  const scroll = win?.querySelector(".list-window-scroll");
  return {
    win: Boolean(win),
    height: win?.getBoundingClientRect().height ?? 0,
    client: scroll?.clientHeight ?? 0,
    scrollHeight: scroll?.scrollHeight ?? 0,
    rows: scroll?.querySelectorAll(".row").length ?? 0,
    bottom: win?.getBoundingClientRect().bottom ?? 0,
    barTop: document.querySelector(".oneshot")?.getBoundingClientRect().top ?? innerHeight,
  };
});
const sourceTabs = () => page.getByRole("tab", { name: /雨课堂/ });
const networkTabs = () => page.getByRole("tab", { name: /网络学堂/ });

// ── 通知：两侧都有 → 子 tab，默认网络学堂 ─────────────────────────
check(await sourceTabs().count() >= 1, `通知页出现雨课堂子 tab（课程 ${courseName}）`);
const notice = await readList();
check(notice.win && notice.height > 300 && notice.height < 900, "默认通知列表首开即为固定视口，不再铺满全页");
check(notice.scrollHeight > notice.client && notice.rows === 60, "通知行在固定视口内滚动");
check(notice.bottom <= notice.barTop + 1, "通知列表止于底部快捷栏上方");
const delays = await page.evaluate(() => [...document.querySelectorAll(".page-anim .list-window-scroll .row")].slice(0, 6).map((row) => row.style.animationDelay));
check(new Set(delays).size > 1, `列表项入场有逐项时间差（${delays.join(" / ")}）`);
await networkTabs().last().isVisible();
check(await networkTabs().last().getAttribute("aria-selected") === "true", "默认选中网络学堂");

// 标题入场只播一次；切主 tab 不再重播
check(await page.evaluate(() => window.__headAnims) === 1, "进入课程页标题入场只播一次");
await page.getByRole("tab", { name: /^文件/ }).first().click();
await page.waitForTimeout(400);
await page.getByRole("tab", { name: /^通知/ }).first().click();
await page.waitForTimeout(400);
check(await page.evaluate(() => window.__headAnims) === 1, "切换主 tab 不再重播标题入场");

// 行在出现的第一帧就已经带 reveal 标记，不会先静止再跳回左侧
const revealEarly = await page.evaluate(() => window.__revealFirstFrame); check(revealEarly.length > 0 && revealEarly.filter((r) => r.top < 700).every((r) => r.marked), `首屏行第一帧即进入 reveal 动画（${revealEarly.length} 行）`);

// 双来源 tab 与主 tab 同一套胶囊样式
const tabStyles = await page.evaluate(() => {
  const pick = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { height: cs.height, radius: cs.borderRadius, bg: cs.backgroundColor, color: cs.color, fontSize: cs.fontSize, weight: cs.fontWeight };
  };
  const rows = [...document.querySelectorAll(".page-anim .og-tabs--segmented")];
  const subRow = rows.at(-1);
  const mainRow = rows[0];
  const sub = subRow?.querySelector("button.is-active");
  const main = mainRow?.querySelector("button.is-active");
  return {
    sub: pick(sub), main: pick(main),
    subWidth: subRow?.getBoundingClientRect().width ?? 0,
    mainWidth: mainRow?.getBoundingClientRect().width ?? 0,
    pill: Boolean(subRow?.querySelector(".og-tabs-indicator")),
    subPillTransform: subRow?.querySelector(".og-tabs-indicator") ? getComputedStyle(subRow.querySelector(".og-tabs-indicator")).left : null,
    shellRadius: subRow ? getComputedStyle(subRow).borderRadius : null,
    innerRadius: sub ? getComputedStyle(sub).borderRadius : null,
    marginBottom: subRow ? getComputedStyle(subRow).marginBlockEnd : null,
    indicatorX: subRow?.querySelector(".og-tabs-indicator")?.getBoundingClientRect().x ?? null,
    activeX: sub?.getBoundingClientRect().x ?? null,
  };
});
check(tabStyles.sub && tabStyles.main && JSON.stringify(tabStyles.sub) === JSON.stringify(tabStyles.main), "通知/文件子 tab 与主 tab 样式完全一致");
check(Math.abs(tabStyles.subWidth - tabStyles.mainWidth) <= 1, `子 tab 与主 tab 等宽（${tabStyles.subWidth} / ${tabStyles.mainWidth}）`);
check(tabStyles.pill, "子 tab 有滑动胶囊状态层");
check(parseFloat(tabStyles.shellRadius) - parseFloat(tabStyles.innerRadius) === 3,
  `分段轨与外胶囊同心（外 ${tabStyles.shellRadius} / 内 ${tabStyles.innerRadius}）`);
check(parseFloat(tabStyles.marginBottom) >= 8,
  `分段轨与下方内容有间距（${tabStyles.marginBottom}）`);
check(Math.abs(tabStyles.indicatorX - tabStyles.activeX) < 0.5,
  `胶囊指示器与激活项左缘对齐（${tabStyles.indicatorX} / ${tabStyles.activeX}）`);
const pillBefore = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".page-anim .og-tabs--segmented")];
  const pill = rows.at(-1)?.querySelector(".og-tabs-indicator");
  return pill ? getComputedStyle(pill).left + "|" + getComputedStyle(pill).width : null;
});
await sourceTabs().last().click();
await page.waitForTimeout(160);
const pillAfter = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".page-anim .og-tabs--segmented")];
  const pill = rows.at(-1)?.querySelector(".og-tabs-indicator");
  return pill ? getComputedStyle(pill).left + "|" + getComputedStyle(pill).width : null;
});
check(pillBefore && pillAfter && pillBefore !== pillAfter, "子 tab 滑动胶囊有位置过渡动画");
await page.waitForTimeout(340);
const yktNotice = await readList();
check(yktNotice.rows === 15 && yktNotice.win, "切到雨课堂后只显示雨课堂通知，仍是固定视口");
await page.screenshot({ path: `${out}/notices-ykt.png` });

// ── 文件：同样是子 tab + 固定列表 ───────────────────────────────
await page.getByRole("tab", { name: /^文件/ }).first().click();
await page.waitForTimeout(600);
check(await sourceTabs().count() >= 1, "文件页出现雨课堂子 tab");
const fileLearn = await readList();
check(fileLearn.rows === 40 && fileLearn.win, "文件默认网络学堂，固定视口内滚动");
await sourceTabs().last().click();
await page.waitForTimeout(600);
const fileYkt = await readList();
check(fileYkt.rows === 20 && fileYkt.win, "切到雨课堂后资料列表也是固定视口");
check(fileYkt.bottom <= fileYkt.barTop + 1, "雨课堂资料列表止于底部快捷栏上方");
await page.screenshot({ path: `${out}/files-ykt.png` });

writeFileSync(`${out}/report.json`, JSON.stringify({ checks: count, notice, yktNotice, fileLearn, fileYkt }, null, 2));
console.log(`\n课程详情双来源 tab 回归：${count} 项通过（${out}）`);
await browser.close();
