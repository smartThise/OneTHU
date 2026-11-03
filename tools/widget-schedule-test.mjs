/**
 * 桌面小组件课表兜底（widgetSchedule）：网络学堂掉线时小组件仍要有课。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/widget-schedule-test.mjs
 *
 * 为什么这些断言值得钉：
 *  - 线上症状是「日程页有课、首页卡片有课、小组件 0 行」，根因不是课表接口，
 *    而是小组件读的 campus 快照被 learn 的整包加载拖死（loadReal 第一句就要学期）。
 *    所以这里不测网络，只钉「campus 没课表 → 退回独立快照」这条决策 + 节流。
 *  - 小组件每分钟都在要数据，窗口课表一天只变两次：没有节流就会把教务接口打爆，
 *    所以「10 分钟内只抓一次」也必须有断言。
 *  - 刷新失败绝不能把已有快照弄丢（小组件是只读展示，宁可显示旧课，也不能显示空白）。
 */
import assert from "node:assert/strict";
import { cacheInvalidate } from "../apps/desktop/src/state/cache.ts";
import {
  WIDGET_SCHEDULE_KEY,
  __resetWidgetScheduleThrottle,
  ensureWidgetSchedule,
  getWidgetScheduleSnapshot,
  pickScheduleRows,
  refreshWidgetSchedule,
  subscribeWidgetSchedule,
  widgetScheduleWindow,
} from "../apps/desktop/src/state/widgetSchedule.ts";

let pass = 0;
let fail = 0;
const ok = (msg) => { pass += 1; console.log("✓ " + msg); };
const eq = (msg, actual, expected) => {
  try {
    assert.deepEqual(actual, expected);
    ok(msg);
  } catch {
    fail += 1;
    console.log("✗ " + msg + "\n    期望: " + JSON.stringify(expected) + "\n    实际: " + JSON.stringify(actual));
  }
};

/** 最小 localStorage 替身：只为了断言「落盘」这一步真的发生了 */
const store = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
  },
});

const NOW = Date.parse("2026-10-27T10:00:00+08:00");
const HOUR = 3_600_000;

const row = (date, name, start, end, location = "六教 6A201") => ({
  courseName: name, location, category: "必修", date,
  dayOfWeek: 2, startTime: start, endTime: end, raw: { name },
});

const reset = () => { cacheInvalidate(WIDGET_SCHEDULE_KEY); __resetWidgetScheduleThrottle(); store.clear(); };

// ── 1. 窗口：昨天 → 14 天后（跨零点、跨两周都有余量）
{
  const { from, to } = widgetScheduleWindow(NOW);
  eq("窗口起点 = 昨天", from, "2026-10-26");
  eq("窗口终点 = 14 天后", to, "2026-11-10");
  ok("窗口两端都是 YYYY-MM-DD");
}

// ── 2. 刷新写入快照，同步读得回来
{
  reset();
  const calls = [];
  const rows = [row("2026-10-27", "微积分A", "08:00", "09:35")];
  const out = await refreshWidgetSchedule(NOW, async (from, to) => { calls.push([from, to]); return rows; });
  eq("取数窗口与快照窗口一致", calls[0], ["2026-10-26", "2026-11-10"]);
  eq("刷新返回新行", out.map((r) => r.courseName), ["微积分A"]);
  eq("同步读拿到同一批行", getWidgetScheduleSnapshot().map((r) => r.courseName), ["微积分A"]);
  const saved = globalThis.localStorage.getItem(`onethu.cache.${WIDGET_SCHEDULE_KEY}.v1`);
  ok("快照落进 localStorage（冷启动也还在）");
  ok("落盘内容带得上课程名", saved !== null && saved.includes("微积分A"));
  ok("落盘内容带得上节次时间", saved !== null && saved.includes("08:00") && saved.includes("09:35"));
}

// ── 3. campus 有课表时优先用 campus（它是整包刷新，更新鲜）
{
  const campusRows = [row("2026-10-27", "大学物理", "10:00", "11:35")];
  const fallback = [row("2026-10-27", "微积分A", "08:00", "09:35")];
  eq("campus 有课 → 用 campus", pickScheduleRows(campusRows, fallback).map((r) => r.courseName), ["大学物理"]);
  eq("campus 空数组 → 用独立快照", pickScheduleRows([], fallback).map((r) => r.courseName), ["微积分A"]);
  eq("campus 为 null → 用独立快照", pickScheduleRows(null, fallback).map((r) => r.courseName), ["微积分A"]);
  eq("campus undefined → 用独立快照", pickScheduleRows(undefined, fallback).map((r) => r.courseName), ["微积分A"]);
}

// ── 4. 失败保留旧快照（小组件宁可显示旧课，也不能空白）
{
  reset();
  await refreshWidgetSchedule(NOW, async () => [row("2026-10-27", "线性代数", "14:00", "15:35")]);
  const out = await refreshWidgetSchedule(NOW + HOUR, async () => { throw new Error("教务 502"); });
  eq("刷新失败仍返回上一份快照", out.map((r) => r.courseName), ["线性代数"]);
  eq("快照没有被失败清空", getWidgetScheduleSnapshot().map((r) => r.courseName), ["线性代数"]);
}

// ── 5. 节流：10 分钟内只抓一次，过期后才会再抓
{
  reset();
  let count = 0;
  const fetcher = async () => { count += 1; return [row("2026-10-27", "英语听说", "16:00", "17:35")]; };
  await ensureWidgetSchedule(NOW, fetcher);
  eq("首次 ensure 会抓一次", count, 1);
  await ensureWidgetSchedule(NOW + 60_000, fetcher);
  eq("一分钟后不再抓", count, 1);
  await ensureWidgetSchedule(NOW + 9 * 60_000, fetcher);
  eq("九分钟后仍不抓", count, 1);
  await ensureWidgetSchedule(NOW + 11 * 60_000, fetcher);
  eq("十一分钟后重新抓一次", count, 2);
  eq("节流后快照仍是同一门课", getWidgetScheduleSnapshot().map((r) => r.courseName), ["英语听说"]);
}

// ── 6. 失败后不把节流窗口重置成「永不重试」
{
  reset();
  let count = 0;
  const boom = async () => { count += 1; throw new Error("网络学堂掉线"); };
  await ensureWidgetSchedule(NOW, boom);
  await ensureWidgetSchedule(NOW + 11 * 60_000, boom);
  eq("失败后下一次窗口仍会重试", count, 2);
  eq("两次失败都没有产出快照", getWidgetScheduleSnapshot(), []);
}

// ── 7. 刷新完要喊一声：小组件运行时靠订阅重算，否则新数据要等下一次外部事件才上屏
{
  reset();
  let fired = 0;
  const unsub = subscribeWidgetSchedule(() => { fired += 1; });
  await refreshWidgetSchedule(NOW, async () => [row("2026-10-27", "数据结构", "08:00", "09:35")]);
  eq("成功刷新通知了一次订阅者", fired, 1);
  await refreshWidgetSchedule(NOW + HOUR, async () => { throw new Error("教务 502"); });
  eq("失败刷新不通知（没有新数据可推）", fired, 1);
  unsub();
  await refreshWidgetSchedule(NOW + 2 * HOUR, async () => [row("2026-10-27", "数据结构", "08:00", "09:35")]);
  eq("退订后不再收到通知", fired, 1);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
