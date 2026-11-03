/**
 * 桌面小组件 / 上课提醒的课表来源：**不经过 learn 的整包加载**。
 *
 * 为什么单独一份：`loadReal()` 第一句是 `learn.getCurrentSemester()`，网络学堂的会话
 * 一掉，整个 campus 快照（作业、通知、文件、课表一起）就根本落不了库；而小组件读的是
 * `getCampusSnapshot().schedule`，于是「网络学堂掉线、教务正常」时日程页能拉到课、
 * 首页卡片（v0.11.4 起走 useTodayCourseData 自己取数）也有课，**唯独小组件是空的**
 * （2026-10-26 平板实测：PAGE-ERR CAMPUS-AUTH → 小组件 0 行）。
 *
 * 这里用教务窗口接口单独取一次课表，落 localStorage（冷启动也还在），作为
 * `collectNotifyInputs()` 在 campus 快照没有课表时的兜底。它只读课表，不碰作业/通知，
 * 也不改变 campus 快照的失败语义（学习服务挂了，作业区照旧报错）。
 */
import type { CalendarData, ScheduleEntry } from "@onethu/core";
import { cacheGet, cacheSet } from "./cache.js";

/** 单一键：小组件只关心「最近这段窗口」，不需要按天分裂 */
export const WIDGET_SCHEDULE_KEY = "widgetsched:v1";

/** 刷新节流：窗口课表一天只变两次（换天、临时补课），小组件却每分钟都在要数据 */
const MIN_INTERVAL_MS = 10 * 60 * 1000;

/** 窗口：昨天 → 14 天后。留一天余量，跨零点前后的课也不会漏。 */
const LOOKBACK_MS = 1 * 86_400_000;
const LOOKAHEAD_MS = 14 * 86_400_000;

export interface WidgetSchedulePayload {
  from: string;
  to: string;
  rows: ScheduleEntry[];
  at: number;
}

export type ScheduleWindowFetcher = (from: string, to: string) => Promise<ScheduleEntry[]>;

/** 订阅「窗口课表刷新完了」：小组件运行时据此立刻重算，而不是等下一次外部事件 */
const listeners = new Set<() => void>();

export function subscribeWidgetSchedule(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function ymd(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function widgetScheduleWindow(now = Date.now()): { from: string; to: string } {
  return { from: ymd(now - LOOKBACK_MS), to: ymd(now + LOOKAHEAD_MS) };
}

/** 同步读：campus 快照没有课表时用它兜底（冷启动也拿得到上次的窗口） */
export function getWidgetScheduleSnapshot(): ScheduleEntry[] {
  return cacheGet<WidgetSchedulePayload>(WIDGET_SCHEDULE_KEY)?.data.rows ?? [];
}

/** campus 快照有课表就优先用它（它是整套数据一起刷新的，更新鲜），否则用独立快照 */
export function pickScheduleRows(
  campusRows: ScheduleEntry[] | null | undefined,
  fallback: ScheduleEntry[],
): ScheduleEntry[] {
  return campusRows?.length ? campusRows : fallback;
}

/** 生产取数：教务窗口接口 +（有校历时）并入二级课表；二级失败只丢二级。 */
async function fetchScheduleWindow(from: string, to: string): Promise<ScheduleEntry[]> {
  const { info } = await import("../lib/clients.js");
  const { appendSecondarySchedule } = await import("../lib/scheduleSecondary.js");
  const primary = await info.getSchedule(from, to);
  const firstDay = cacheGet<CalendarData>("calendar")?.data?.firstDay;
  if (!firstDay) return primary;
  return appendSecondarySchedule(primary, firstDay, from, to).catch(() => primary);
}

/** 强制刷新一次；失败保留上一份快照（小组件是只读展示，不值得因为它弹错误）。 */
export async function refreshWidgetSchedule(
  now = Date.now(),
  fetcher: ScheduleWindowFetcher = fetchScheduleWindow,
): Promise<ScheduleEntry[]> {
  const { from, to } = widgetScheduleWindow(now);
  try {
    const rows = await fetcher(from, to);
    cacheSet<WidgetSchedulePayload>(WIDGET_SCHEDULE_KEY, { from, to, rows, at: now }, true);
    // 刷新完要主动喊一声：小组件运行时靠订阅重算，否则这份新数据要等下一次外部事件才上屏。
    for (const fn of [...listeners]) {
      try { fn(); } catch { /* 订阅方自己的错不该影响刷新结果 */ }
    }
    return rows;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    void import("../lib/clients.js")
      .then(({ logLine }) => logLine(`WIDGET-SCHED 课表刷新失败 ${detail}`).catch(() => undefined))
      .catch(() => undefined);
    return getWidgetScheduleSnapshot();
  }
}

let lastAttemptAt = 0;
let running: Promise<ScheduleEntry[]> | null = null;

/** 节流刷新：同步热路径（collectNotifyInputs）里发起的「顺手补一次」。 */
export function ensureWidgetSchedule(
  now = Date.now(),
  fetcher: ScheduleWindowFetcher = fetchScheduleWindow,
): Promise<ScheduleEntry[]> {
  if (running) return running;
  const hit = cacheGet<WidgetSchedulePayload>(WIDGET_SCHEDULE_KEY);
  if (hit && now - hit.data.at < MIN_INTERVAL_MS && now - lastAttemptAt < MIN_INTERVAL_MS) {
    return Promise.resolve(hit.data.rows);
  }
  lastAttemptAt = now;
  running = refreshWidgetSchedule(now, fetcher).finally(() => {
    running = null;
  });
  return running;
}

/** 测试用：清掉节流状态（内存快照请用 cacheInvalidate 清）。 */
export function __resetWidgetScheduleThrottle(): void {
  lastAttemptAt = 0;
  running = null;
}
