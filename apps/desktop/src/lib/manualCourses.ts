/**
 * 手动补充的课程 → 「今日课程」用的课行。
 *
 * 为什么需要这一层：首页卡片（v0.11.4 起自持取数）只走教务窗口接口 + 二级课表，
 * 而手动补充的课程住在事件仓（CalDAV / 本地 ICS）里——于是课表页有那条虚线课、
 * 首页却当它不存在（2026-10-28 实测：当天的习题课只在课表页出现）。这里把
 * 「事件仓 → 课行」的换算收敛成一个纯函数，展开规则与课表页、上课提醒完全同源
 * （core 的 expandEventSet + 教学周 RRULE），浏览器与 Node 测试共用同一份实现。
 *
 * 只取 course-manual 且非全天的场次：普通日程是待办不是课，不该进「今日课程」
 * （与提醒分流同一条口径，见 state/notifyEventSplit.ts）。
 */
import {
  CAMPUS_TZ,
  epochToWall,
  expandEventSet,
  wallToEpoch,
  type IcsEvent,
} from "@onethu/core/src/caldav/ics.js";
import { MANUAL_COURSE_SOURCE, isManualCourse, weekdayOf } from "@onethu/core/src/caldav/courseWeeks.js";
import type { ScheduleEntry } from "@onethu/core";

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** "YYYY-MM-DD" → 当天的校园时区起止毫秒（课表页、提醒都按校园时区落点） */
function dayBounds(day: string): { lo: number; hi: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const lo = wallToEpoch(CAMPUS_TZ, { y, mo, d, h: 0, mi: 0, s: 0 });
  const hi = wallToEpoch(CAMPUS_TZ, { y, mo, d, h: 23, mi: 59, s: 59 });
  return { lo, hi };
}

/**
 * 某一天的手动补充课程行（按开始时间升序）。
 *
 * 只展开当天窗口：这些课按教学周重复，整学期一次展开没有意义，首屏也会慢。
 * 场次超出当天（跨零点，正常课不会有）按当天边界裁剪，宁可显示 23:59 也不越日。
 */
export function manualCourseRows(events: readonly IcsEvent[], day: string): ScheduleEntry[] {
  if (!events.length) return [];
  const bounds = dayBounds(day);
  if (!bounds) return [];
  const weekday = weekdayOf(day);
  const rows: ScheduleEntry[] = [];
  const seen = new Set<string>();
  for (const occ of expandEventSet([...events], bounds.lo, bounds.hi)) {
    if (occ.allDay === true || !isManualCourse(occ)) continue;
    const s = epochToWall(CAMPUS_TZ, Math.max(occ.start, bounds.lo));
    const e = epochToWall(CAMPUS_TZ, Math.min(occ.end, bounds.hi + 1000));
    const startTime = `${pad2(s.h)}:${pad2(s.mi)}`;
    // 同一门课在事件仓里可能有覆盖实例（RECURRENCE-ID）：同名同刻只留一条
    const key = `${occ.summary}|${startTime}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      courseName: occ.summary,
      date: day,
      ...(weekday === null ? {} : { dayOfWeek: weekday }),
      startTime,
      endTime: `${pad2(e.h)}:${pad2(e.mi)}`,
      ...(occ.location ? { location: occ.location } : {}),
      raw: { source: MANUAL_COURSE_SOURCE },
    });
  }
  return rows.sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
}

/**
 * 课行合并：手动补充的课并进教务课表。
 *
 * 同名同刻只留教务那条——用户早先手动补的课后来被教务补上了，不该出现两行。
 * 顺序交给调用方（首页按开始时间排、白板另算），这里只做去重与拼接。
 */
export function mergeCourseRows(
  rows: readonly ScheduleEntry[],
  extra: readonly ScheduleEntry[],
): ScheduleEntry[] {
  if (!extra.length) return [...rows];
  const seen = new Set(rows.map((r) => `${r.courseName}|${r.date ?? ""}|${r.startTime ?? ""}`));
  const out = [...rows];
  for (const e of extra) {
    const key = `${e.courseName}|${e.date ?? ""}|${e.startTime ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** 是不是手动补充的课（视图侧画「手动」角标、与教务数据区分） */
export function isManualCourseRow(row: ScheduleEntry): boolean {
  return row.raw?.source === MANUAL_COURSE_SOURCE;
}
