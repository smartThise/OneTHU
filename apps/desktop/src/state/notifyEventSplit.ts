/**
 * 自定义日程实例 → 两条通道的拆分（纯函数，Node 可测）。
 *
 * 为什么单独成文件：分流规则是「手动补充的课程走课行、其余走日程」这条口径的唯一落点，
 * 而 notifyInputs 本身要拉 data / exthw（一路到 .tsx），Node 跑不动。把规则挪到这里，
 * 就能拿真实事件实例离线断言分流结果，避免它被后续重构悄悄改掉。
 *
 * 口径（2026-10-13 定案）：
 *   · 手动补充的课程（X-ONETHU-SRC=course-manual）并进**课程通道**——提醒用上课提前量、
 *     桌面小组件按课行渲染，且只在当天出现（与教务课程同档），不占 7 天窗的日程位。
 *   · 其余自定义日程仍走日程通道（原有行为）。
 */
import { CAMPUS_TZ, epochToWall, type IcsOccurrence } from "@onethu/core/src/caldav/ics.js";
import { MANUAL_COURSE_SOURCE } from "@onethu/core/src/caldav/courseWeeks.js";
import type { PlanScheduleEntry } from "./notifyPlan.js";

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** 是不是「该按课行处理」的实例：手动补充的课程、且是定时形态
 *  （课一定有节次时刻；全天形态不可能是课，保持走日程通道） */
export function isCourseOccurrence(occ: IcsOccurrence): boolean {
  return occ.onethuSource === MANUAL_COURSE_SOURCE && occ.allDay !== true;
}

/** 课程实例 → 课程通道条目（与教务课程同形：日期 + 起止时刻 + 课名 + 地点） */
export function courseOccurrenceToScheduleEntry(occ: IcsOccurrence): PlanScheduleEntry {
  const s = epochToWall(CAMPUS_TZ, occ.start);
  const e = epochToWall(CAMPUS_TZ, occ.end);
  return {
    date: `${s.y}-${pad2(s.mo)}-${pad2(s.d)}`,
    startTime: `${pad2(s.h)}:${pad2(s.mi)}`,
    endTime: `${pad2(e.h)}:${pad2(e.mi)}`,
    courseName: occ.summary,
    location: occ.location ?? null,
    category: null,
  };
}
