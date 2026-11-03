/**
 * 手动补充课程：周集合 ⇄ 具体日期 ⇄ ICS 重复规则（纯函数，无 IO）。
 *
 * 需求背景（2026-10-13）：教务课表会漏课，用户要能自己补一门——本质是「学期内每周重复的
 * 日程，且只上其中若干周」。编辑态的事实源是**周集合**（教学周多选 chips），落到 ICS 时
 * 展开成一条可重复的事件：
 *
 *   DTSTART = 首个选中周的星期 X 的节次起始时刻
 *   RRULE   = FREQ=WEEKLY;BYDAY=<X>;UNTIL=<最后一个选中场的开始时刻>
 *   EXDATE  = 首末选中周之间**未选**的周（同一时刻）
 *
 * 为什么用 UNTIL 而不是 COUNT：ics.ts 的 expandEvent 在 EXDATE 过滤**之前**就自增 count，
 * 带 EXDATE 的规则用 COUNT 会少放几场。UNTIL 取最后一个选中场的开始时刻最简单且无歧义
 * （下一周的 dayStart 必然大于它，展开自然收尾）。
 *
 * 为什么任意周集合都走 EXDATE、不用 INTERVAL=2 表达单双周：单周/双周是子集的特例，
 * 统一一条路径少一类分支；EXDATE 条数 = 未选周数（一学期最多十几条），折行已有实现。
 *
 * 校历不可用（无 firstDay/weekCount）时降级为「每周、共 16 周」（COUNT=16）——无限重复会
 * 一路排到几年后，而调用方会在 UI 上提示这一降级。
 */
import { CAMPUS_TZ, epochToWall, normalizeWeeks, wallToEpoch, type IcsRrule } from "./ics.js";

/** X-ONETHU-SRC 取值：手动补充的课程（避开自动生成的 course / exam / homework 清理扫描） */
export const MANUAL_COURSE_SOURCE = "course-manual";

/** 节次默认重复周数（校历不可用时的兜底，一学期常规周数） */
export const FALLBACK_WEEKS = 16;

/** 学期定位信息（与 apps 侧 CalendarSemester 的子集同形） */
export interface CourseTerm {
  /** "YYYY-MM-DD"，学期第一周的周一 */
  firstDay: string;
  /** 学期总周数 */
  weekCount: number;
}

export interface CourseSeriesInput {
  /** null = 校历不可用 → 走 fallback */
  term: CourseTerm | null;
  /** 1=周一 … 7=周日 */
  weekday: number;
  /** 教学周（1 起）；校历可用时空数组视为无效（调用方给「至少选一周」提示） */
  weeks: readonly number[];
  /** "HH:MM" */
  startTime: string;
  endTime: string;
  /** fallback 的锚点：从这一天（含）起找第一个匹配的星期几；缺省=校园时区的今天 */
  from?: string;
  /** fallback 的重复周数，缺省 16 */
  fallbackWeeks?: number;
}

export interface CourseSeries {
  /** 首场开始时刻（epoch ms） */
  start: number;
  /** 首场结束时刻（epoch ms） */
  end: number;
  rrule: IcsRrule;
  /** 需要显式排除的场次开始时刻 */
  exdates: number[];
  /** 实际生效的周集合；fallback 分支为空数组 */
  weeks: number[];
  /** true = 校历不可用，按 fallbackWeeks 周重复 */
  fallback: boolean;
}

const DAY_MS = 86_400_000;
/** 周一=1 … 周日=7 */
const BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] as const;

const pad = (n: number): string => String(n).padStart(2, "0");

function parseYmd(raw: string): { y: number; mo: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return { y, mo, d };
}

/** 纯日期加减（走 UTC 算术，绕开本地时区偏移） */
export function addDays(ymd: string, days: number): string | null {
  const p = parseYmd(ymd);
  if (!p) return null;
  const d = new Date(Date.UTC(p.y, p.mo - 1, p.d) + days * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 星期几：周一=1 … 周日=7；坏日期 null */
export function weekdayOf(ymd: string): number | null {
  const p = parseYmd(ymd);
  if (!p) return null;
  return ((new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay() + 6) % 7) + 1;
}

/** 第 week 周的星期 weekday 的日期（weekday 1..7）；参数越界或 firstDay 坏值 null */
export function weekDate(term: CourseTerm, week: number, weekday: number): string | null {
  if (!Number.isInteger(week) || week < 1) return null;
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return null;
  return addDays(term.firstDay, (week - 1) * 7 + (weekday - 1));
}

/** 从 from（含当天）起第一个匹配 weekday 的日期 */
export function nextWeekday(from: string, weekday: number): string | null {
  const wd = weekdayOf(from);
  if (wd === null || !Number.isInteger(weekday) || weekday < 1 || weekday > 7) return null;
  return addDays(from, (weekday - wd + 7) % 7);
}

/** 选中周集合 → 逐个日期（超出学期周数的丢弃，结果按周升序） */
export function courseDates(term: CourseTerm, weekday: number, weeks: readonly number[]): string[] {
  const out: string[] = [];
  for (const w of normalizeWeeks(weeks, term.weekCount)) {
    const d = weekDate(term, w, weekday);
    if (d) out.push(d);
  }
  return out;
}

/** 校园时区的今天 */
export function todayYmd(nowMs = Date.now()): string {
  const w = epochToWall(CAMPUS_TZ, nowMs);
  return `${w.y}-${pad(w.mo)}-${pad(w.d)}`;
}

function parseHM(raw: string): { h: number; mi: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return { h, mi };
}

function msAt(ymd: string, hm: { h: number; mi: number }): number | null {
  const p = parseYmd(ymd);
  if (!p) return null;
  return wallToEpoch(CAMPUS_TZ, { y: p.y, mo: p.mo, d: p.d, h: hm.h, mi: hm.mi, s: 0 });
}

/** 该事件是不是「手动补充的课程」 */
export function isManualCourse(ev: { onethuSource?: string }): boolean {
  return ev.onethuSource === MANUAL_COURSE_SOURCE;
}

/**
 * 由表单字段生成一条课程事件的重复部分。
 * 返回 null = 参数不足以成场（缺星期/时刻、校历可用但一周都没选、日期越界）——
 * 调用方据此给提示，不要静默存一条坏事件。
 */
export function buildCourseSeries(input: CourseSeriesInput): CourseSeries | null {
  const weekday = Math.round(input.weekday);
  if (!(weekday >= 1 && weekday <= 7)) return null;
  const startHM = parseHM(input.startTime);
  const endHM = parseHM(input.endTime);
  if (!startHM || !endHM) return null;
  const byDay = [BYDAY[weekday - 1]!];
  const fallbackWeeks = Math.max(1, Math.round(input.fallbackWeeks ?? FALLBACK_WEEKS));

  // 校历不可用：从锚点起第一个匹配的星期几，每周重复 fallbackWeeks 周
  if (!input.term) {
    const first = nextWeekday(input.from ?? todayYmd(), weekday);
    if (!first) return null;
    const start = msAt(first, startHM);
    if (start === null) return null;
    const endMs = msAt(first, endHM);
    return {
      start,
      end: Math.max(endMs ?? 0, start + 45 * 60_000),
      rrule: { freq: "WEEKLY", interval: 1, byDay, count: fallbackWeeks },
      exdates: [],
      weeks: [],
      fallback: true,
    };
  }

  const weeks = normalizeWeeks(input.weeks, input.term.weekCount);
  if (weeks.length === 0) return null;
  const dates = courseDates(input.term, weekday, weeks);
  if (dates.length !== weeks.length) return null; // firstDay 坏值 / 周数越界
  const starts = dates.map((d) => msAt(d, startHM));
  if (starts.some((ms) => ms === null)) return null;
  const first = starts[0]!;
  const firstEnd = msAt(dates[0]!, endHM);

  const selected = new Set(weeks);
  const exdates: number[] = [];
  for (let w = weeks[0]!; w <= weeks[weeks.length - 1]!; w++) {
    if (selected.has(w)) continue;
    const d = weekDate(input.term, w, weekday);
    const ms = d ? msAt(d, startHM) : null;
    if (ms !== null) exdates.push(ms);
  }

  return {
    start: first,
    end: Math.max(firstEnd ?? 0, first + 45 * 60_000),
    // UNTIL 取最后一个选中场的开始时刻（COUNT 会因 EXDATE 提前耗尽，见文件头）
    rrule: { freq: "WEEKLY", interval: 1, byDay, until: starts[starts.length - 1]! },
    exdates,
    weeks,
    fallback: false,
  };
}
