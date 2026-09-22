/**
 * 通知计划的数据输入：把三处快照拍平成 notifyPlan 认识的最小形状。
 *
 * 单独成文件（而不是塞在 notifyRuntime 里）有两个理由：
 *   ① 运行时只该管「什么时候算」，取数属于数据层；
 *   ② 本文件拉的是 data/exthw（一路到 .tsx），Node 无法直跑；剥开之后 notifyRuntime
 *      就能在测试里注入假数据源，时机逻辑可断言。
 */
import { expandEventSet } from "@onethu/core/src/caldav/ics.js";
import { getCampusSnapshot, getLearnSnapshot } from "./data.js";
import { getCloudEvents, getLocalEvents } from "./cloudCal.js";
import { getExtHwSnapshot, toHomework } from "./exthw.js";
import { ignoredHwList } from "./hwIgnore.js";
import type { PlanEventEntry, PlanHomework, PlanScheduleEntry } from "./notifyPlan.js";

export function collectNotifyInputs(now = Date.now()): {
  schedule: PlanScheduleEntry[];
  events: PlanEventEntry[];
  homework: PlanHomework[];
} {
  const campus = getCampusSnapshot();
  const learn = getLearnSnapshot();
  const ext = getExtHwSnapshot();

  const schedule: PlanScheduleEntry[] = (campus?.schedule ?? []).map((e) => ({
    date: e.date,
    startTime: e.startTime ?? null,
    endTime: e.endTime ?? null,
    courseName: e.courseName,
    location: e.location ?? null,
    category: e.category ?? null,
  }));

  // R21c：被忽略的作业不进提醒计划（用户口径：忽略后不再提醒、不再进日程）
  const ignored = ignoredHwList();
  const ignoredIds = new Set(ignored.map((e) => e.id));
  // R23：旁听作业不进提醒计划（不评分、非正式课程；仅在「全部作业 → 旁听作业」可见）
  const homework: PlanHomework[] = [
    // 网络学堂：deadline 已是 "YYYY-MM-DD HH:MM"
    ...(learn?.homework ?? []).filter((h) => !h.audited).map((h) => ({
      id: h.id,
      title: h.title,
      deadline: h.deadline,
      submitted: h.submitted,
      courseName: (learn?.courses ?? []).find((c) => c.id === h.courseId)?.name ?? undefined,
    })),
    // 外部作业源（雨课堂 / TUOJ / Tyche / DSA OJ）：经 toHomework 统一形状后取同一批字段
    ...(ext?.items ?? [])
      .map((e) => toHomework(e))
      .filter((h) => !h.audited)
      .map((h) => ({ id: h.id, title: h.title, deadline: h.deadline, submitted: h.submitted, courseName: h.courseName })),
  ].filter((h) => !ignoredIds.has(h.id));

  return { schedule, events: collectCalendarEvents(now), homework };
}

/** 未来 8 天内的自定义日程（本地 + 云同步日历），按 rrule 展开成具体场次。
 *  事件自带的 alarmMinutes 优先于设置里的默认提前量——那是用户对这一场次的显式选择。 */
function collectCalendarEvents(now: number): PlanEventEntry[] {
  const horizon = now + 8 * 86_400_000;
  const sources = [...getLocalEvents(), ...getCloudEvents()];
  if (sources.length === 0) return [];
  const byUid = new Map(sources.map((e) => [e.uid, e]));
  const out: PlanEventEntry[] = [];
  for (const occ of expandEventSet(sources, now, horizon)) {
    const src = byUid.get(occ.uid);
    out.push({
      // 只给 uid：实例起点由 notifyPlan 的 id 组成（event:<uid>:<start>:<lead>）承担，
      // 同一场次重复展开得到的 id 因此稳定
      uid: occ.uid,
      summary: occ.summary,
      location: occ.location ?? null,
      start: occ.start,
      allDay: occ.allDay === true,
      alarmMinutes: typeof src?.alarmMinutes === "number" ? src.alarmMinutes : null,
    });
  }
  return out;
}
