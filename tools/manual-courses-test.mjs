/**
 * 首页「今日课程」的手动补充课程换算（离线纯函数）。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/manual-courses-test.mjs
 *
 * 为什么这些断言值得钉：
 *  - 首页卡片自己取数，只认教务接口，手动补充的课住在事件仓里——2026-10-28 实测
 *    「课表页有虚线课、首页说今天没课」。这条换算就是两者之间的唯一接口，
 *    日期窗口、时区、周次展开错一点都会静默变成「今天没课」。
 *  - 只认 course-manual 且非全天：普通日程是待办，不该冒充课程（与提醒分流同口径）。
 *  - 同课同刻去重：手动补的课后来被教务补上时，不能出现两行。
 */
import {
  CAMPUS_TZ,
  epochToWall,
  wallToEpoch,
} from "../packages/core/src/caldav/ics.ts";
import {
  MANUAL_COURSE_SOURCE,
  addDays,
  buildCourseSeries,
  weekDate,
  weekdayOf,
} from "../packages/core/src/caldav/courseWeeks.ts";
import {
  isManualCourseRow,
  manualCourseRows,
  mergeCourseRows,
} from "../apps/desktop/src/lib/manualCourses.ts";

let pass = 0, fail = 0;
const eq = (name, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error(`✗ ${name}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const pad = (n) => String(n).padStart(2, "0");
const ms = (ymd, hm) => {
  const [y, mo, d] = ymd.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  return wallToEpoch(CAMPUS_TZ, { y, mo, d, h, mi, s: 0 });
};
const wallDate = (t) => {
  const w = epochToWall(CAMPUS_TZ, t);
  return `${w.y}-${pad(w.mo)}-${pad(w.d)}`;
};

/* 找一周的周一做学期起点（不写死「哪天是周一」，日历一变测试就假红） */
let firstDay = "2026-09-07";
while (weekdayOf(firstDay) !== 1) firstDay = addDays(firstDay, 1);
const term = { firstDay, weekCount: 20 };
const wedOf = (week) => weekDate(term, week, 3);

/** 一门按教学周重复的手动补充课程（周三 12:00–13:00） */
const series = buildCourseSeries({
  term, weekday: 3, weeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  startTime: "12:00", endTime: "13:00", from: wedOf(1),
});
ok("buildCourseSeries 生成了重复规则", !!series);

const course = {
  uid: "onethu-test-course@onethu",
  summary: "习题课",
  location: "四教 4202",
  description: "",
  categories: ["MEETING"],
  start: series.start,
  end: series.end,
  allDay: false,
  rrule: series.rrule,
  exdates: series.exdates.length ? series.exdates : undefined,
  onethuSource: MANUAL_COURSE_SOURCE,
  onethuWeeks: series.weeks,
};

/* ── 当天的课：时间、地点、日期、星期都对得上 ── */
{
  const day = wedOf(5);
  const rows = manualCourseRows([course], day);
  eq("当周那天的行数", rows.length, 1);
  eq("课名", rows[0]?.courseName, "习题课");
  eq("开始时刻", rows[0]?.startTime, "12:00");
  eq("结束时刻", rows[0]?.endTime, "13:00");
  eq("日期", rows[0]?.date, day);
  eq("星期", rows[0]?.dayOfWeek, 3);
  eq("地点", rows[0]?.location, "四教 4202");
  eq("来源标记", rows[0]?.raw?.source, MANUAL_COURSE_SOURCE);
  ok("认得出是手动补充的课", isManualCourseRow(rows[0]));
  // 窗口按校园时区取，落在当天的课不会被时区推到前一天
  eq("落在当天", wallDate(ms(day, "12:00")), day);
}

/* ── 别的日子不串台 ── */
{
  eq("周四没有这门课", manualCourseRows([course], addDays(wedOf(5), 1)).length, 0);
  eq("上周三之后的那周没选", manualCourseRows([course], wedOf(11)).length, 0);
}

/* ── 只有课程走进来：日常日程、全天事件都不算 ── */
{
  const event = {
    uid: "onethu-test-event@onethu",
    summary: "预约实验室",
    location: "医学科学楼 C251",
    start: ms(wedOf(5), "15:00"),
    end: ms(wedOf(5), "16:00"),
    allDay: false,
    onethuSource: "manual",
  };
  eq("普通日程不进今日课程", manualCourseRows([event], wedOf(5)).length, 0);
  const allDay = { ...course, allDay: true };
  eq("全天形态不算课", manualCourseRows([allDay], wedOf(5)).length, 0);
  eq("没有事件时是空数组", manualCourseRows([], wedOf(5)).length, 0);
}

/* ── 覆盖实例（改过某一场的时地点）：只留改后的那场 ── */
{
  const day = wedOf(5);
  const override = {
    uid: course.uid,
    recurrenceId: ms(day, "12:00"),
    summary: "习题课（补课）",
    location: "六教 6A301",
    start: ms(day, "15:00"),
    end: ms(day, "16:00"),
    allDay: false,
    onethuSource: MANUAL_COURSE_SOURCE,
  };
  const rows = manualCourseRows([course, override], day);
  eq("覆盖后只剩一场", rows.length, 1);
  eq("用改后的课名", rows[0]?.courseName, "习题课（补课）");
  eq("用改后的时刻", rows[0]?.startTime, "15:00");
  eq("用改后的地点", rows[0]?.location, "六教 6A301");
}

/* ── 排序与重复实例 ── */
{
  const day = wedOf(5);
  const early = { ...course, uid: "e@onethu", summary: "早课", start: ms(day, "08:00"), end: ms(day, "09:35"), rrule: undefined, exdates: undefined };
  const late = { ...course, uid: "l@onethu", summary: "晚课", start: ms(day, "19:20"), end: ms(day, "20:55"), rrule: undefined, exdates: undefined };
  const rows = manualCourseRows([late, course, early], day);
  eq("按开始时刻升序", rows.map((r) => r.startTime), ["08:00", "12:00", "19:20"]);

  const dup = { ...course, uid: "dup@onethu", start: series.start, end: series.end };
  eq("同名同刻只留一条", manualCourseRows([course, dup], wedOf(5)).length, 1);
}

/* ── 并进教务课表：同名同刻只留教务那条 ── */
{
  const day = wedOf(5);
  const official = { courseName: "微积分B", date: day, startTime: "08:00", endTime: "09:35", raw: { source: "info" } };
  const manual = manualCourseRows([course], day);
  {
    const same = { ...official, courseName: "习题课", startTime: "12:00" };
    const merged = mergeCourseRows([same], manual);
    eq("教务已有同课同刻时不加行", merged.length, 1);
    eq("保留教务那条", merged[0]?.raw?.source, "info");
  }
  {
    const merged = mergeCourseRows([official], manual);
    eq("不同课不同刻各算一行", merged.length, 2);
    eq("合并后顺序不动教务在前", merged[0]?.courseName, "微积分B");
    ok("手动那条带来源标记", isManualCourseRow(merged[1]));
  }
  eq("没有手动课时原样返回", mergeCourseRows([official], []).length, 1);
}

/* ── 坏输入不炸 ── */
eq("坏日期串返回空", manualCourseRows([course], "2026/10/28").length, 0);
eq("空日期串返回空", manualCourseRows([course], "").length, 0);

console.log(JSON.stringify({ pass, fail }));
if (fail) process.exitCode = 1;
