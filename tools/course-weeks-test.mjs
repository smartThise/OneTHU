/**
 * 手动补充课程：周集合 ⇄ 具体日期 ⇄ ICS 重复规则（离线纯函数 + 一次展开闭环）。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/course-weeks-test.mjs
 *
 * 为什么这些断言值得钉：
 *  - 编辑态只存「哪些周上课」（周集合），真正让日程只落在那些周的是 RRULE + EXDATE 组合；
 *    这里逐条盯住 DTSTART / UNTIL / EXDATE 的落点，免得某一周的课悄悄跑到别的周去。
 *  - 用 UNTIL 而不是 COUNT 是有原因的：ics.ts 的 expandEvent 在 EXDATE 过滤之前就自增
 *    count，带 EXDATE 的规则用 COUNT 会提前耗尽、少放几场。这里用「展开场次数 == 选中周数」
 *    直接把这个坑钉死。
 *  - EXDATE / RECURRENCE-ID 的序列化此前是缺的（只解析不写出），事件一写回云端就丢排除；
 *    往返断言防止它再退化。
 */
import {
  CAMPUS_TZ,
  epochToWall,
  expandEventSet,
  formatWeekList,
  normalizeWeeks,
  parseIcs,
  parsePeriod,
  parseWeekList,
  serializeCalendar,
  wallToEpoch,
} from "../packages/core/src/caldav/ics.ts";
import {
  MANUAL_COURSE_SOURCE,
  addDays,
  buildCourseSeries,
  courseDates,
  isManualCourse,
  nextWeekday,
  weekDate,
  weekdayOf,
} from "../packages/core/src/caldav/courseWeeks.ts";
import {
  courseOccurrenceToScheduleEntry,
  isCourseOccurrence,
} from "../apps/desktop/src/state/notifyEventSplit.ts";

let pass = 0, fail = 0;
const eq = (name, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error(`✗ ${name}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const pad = (n) => String(n).padStart(2, "0");
/** "YYYY-MM-DD" + "HH:MM" → epoch（校园时区） */
const ms = (ymd, hm) => {
  const [y, mo, d] = ymd.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  return wallToEpoch(CAMPUS_TZ, { y, mo, d, h, mi, s: 0 });
};
/** epoch → "YYYY-MM-DD HH:MM"（校园时区，断言用） */
const wall = (t) => {
  const w = epochToWall(CAMPUS_TZ, t);
  return `${w.y}-${pad(w.mo)}-${pad(w.d)} ${pad(w.h)}:${pad(w.mi)}`;
};

/* 学期：2026 秋，第一周周一 2026-09-14，共 16 周（用 weekdayOf 自证这个前提） */
const TERM = { firstDay: "2026-09-14", weekCount: 16 };
const TERM_LO = ms("2026-09-01", "00:00");
const TERM_HI = ms("2027-02-01", "00:00");

/* ① 周号清单：规范化 / 解析 / 序列化 */
{
  eq("规范化：去重升序并剔除越界", normalizeWeeks([3, 1, 1, 0, -2, 200]), [1, 3]);
  eq("规范化：周数上限按学期生效", normalizeWeeks([1, 9, 17], 16), [1, 9]);
  eq("解析：区间与逗号", parseWeekList("1,3,5-9"), [1, 3, 5, 6, 7, 8, 9]);
  eq("解析：全角逗号 / 空格 / 分号都能当分隔", parseWeekList("1-3，5 7;9"), [1, 2, 3, 5, 7, 9]);
  eq("解析：倒序区间与垃圾片段丢弃而不报错", parseWeekList("abc,4-2,,x"), []);
  eq("解析：乱序输入被排序", parseWeekList("9,4"), [4, 9]);
  eq("序列化：连续段压成区间", formatWeekList([1, 2, 3, 5, 6, 9]), "1-3,5-6,9");
  eq("序列化：孤立周号不加横线", formatWeekList([4]), "4");
  eq("序列化：空集合为空串", formatWeekList([]), "");
  eq("往返自洽（含断档）", parseWeekList(formatWeekList([1, 2, 3, 5, 6, 7, 8, 10, 11, 16])), [1, 2, 3, 5, 6, 7, 8, 10, 11, 16]);
}

/* ② 节次区间 */
{
  eq("节次：区间", parsePeriod("3-4"), { start: 3, end: 4 });
  eq("节次：单节", parsePeriod("3"), { start: 3, end: 3 });
  eq("节次：波浪号与空格", parsePeriod("3 ~ 4"), { start: 3, end: 4 });
  eq("节次：倒序拒绝", parsePeriod("4-2"), null);
  eq("节次：坏值拒绝", [parsePeriod(""), parsePeriod("a-b"), parsePeriod("0-2")], [null, null, null]);
}

/* ③ 周 → 日期换算 */
{
  eq("前提：2026-09-14 是周一", weekdayOf("2026-09-14"), 1);
  eq("第 1 周周一即 firstDay", weekDate(TERM, 1, 1), "2026-09-14");
  eq("第 2 周周三", weekDate(TERM, 2, 3), "2026-09-23");
  eq("第 16 周周日（跨年）", weekDate(TERM, 16, 7), "2027-01-03");
  eq("越界周被丢弃", courseDates(TERM, 1, [1, 20]), ["2026-09-14"]);
  eq("锚点：从周二找下一个周三", nextWeekday("2026-10-13", 3), "2026-10-14");
  eq("锚点：当天命中即取当天", nextWeekday("2026-10-14", 3), "2026-10-14");
  eq("跨月加天数", addDays("2026-12-28", 6), "2027-01-03");
}

/* ④ 规则生成：DTSTART / UNTIL / EXDATE 的落点 */
const series = buildCourseSeries({ term: TERM, weekday: 3, weeks: [1, 3, 5], startTime: "09:50", endTime: "11:25" });
{
  ok("生成成功且非降级", series && series.fallback === false);
  eq("DTSTART 落在第 1 周周三 09:50", wall(series.start), "2026-09-16 09:50");
  eq("DTEND 落在同一天 11:25", wall(series.end), "2026-09-16 11:25");
  eq("BYDAY 与所选星期一致", series.rrule.byDay, ["WE"]);
  eq("UNTIL 落在最后一个选中场（第 5 周周三）", wall(series.rrule.until), "2026-10-14 09:50");
  eq("UNTIL 不是 COUNT（COUNT 会被 EXDATE 提前耗尽）", series.rrule.count, undefined);
  eq("未选的第 2、4 周进 EXDATE", series.exdates.map(wall), ["2026-09-23 09:50", "2026-10-07 09:50"]);
  eq("生效周集合原样回填", series.weeks, [1, 3, 5]);
}

/* ⑤ 展开闭环：场次数 == 选中周数，且末场之后不再有场次 */
const event = {
  uid: "manual-course-1@onethu",
  summary: "化学工程与高分子科学导论",
  location: "六教 6A315",
  start: series.start,
  end: series.end,
  rrule: series.rrule,
  exdates: series.exdates,
  onethuSource: MANUAL_COURSE_SOURCE,
  onethuWeeks: series.weeks,
  onethuPeriod: { start: 3, end: 4 },
};
{
  const occ = expandEventSet([event], TERM_LO, TERM_HI);
  eq("隔周课展开 3 场", occ.length, 3);
  eq("落在第 1/3/5 周周三", occ.map((o) => wall(o.start)), ["2026-09-16 09:50", "2026-09-30 09:50", "2026-10-14 09:50"]);
  // 展开器必须把来源标记透传到实例上：notifyInputs 靠它把这门课分流进「课行」通道
  eq("展开出的场次带 onethuSource（分流课行 / 提醒靠它）", occ.every((o) => o.onethuSource === MANUAL_COURSE_SOURCE), true);

  /* ⑤b 分流：课程实例 → 课程通道（课行 / 上课提醒），其余仍旧走日程通道 */
  eq("课程实例被判为课行通道", occ.map(isCourseOccurrence), [true, true, true]);
  eq("转成课程条目（日期 + 起止时刻 + 课名 + 地点）", courseOccurrenceToScheduleEntry(occ[0]), {
    date: "2026-09-16", startTime: "09:50", endTime: "11:25",
    courseName: "化学工程与高分子科学导论", location: "六教 6A315", category: null,
  });
  eq("普通日程不算课程", isCourseOccurrence({ ...occ[0], onethuSource: "manual" }), false);
  eq("全天形态不算课程（课一定有节次时刻）", isCourseOccurrence({ ...occ[0], allDay: true }), false);

  const single = buildCourseSeries({ term: TERM, weekday: 5, weeks: [7], startTime: "13:30", endTime: "14:15" });
  const singleOcc = expandEventSet([{ ...event, uid: "s@o", start: single.start, end: single.end, rrule: single.rrule, exdates: single.exdates }], TERM_LO, TERM_HI);
  eq("只选一周 → 整学期就 1 场", singleOcc.length, 1);

  const gapWeeks = [...Array(8)].map((_, i) => i + 1).concat([...Array(7)].map((_, i) => i + 10));
  const gap = buildCourseSeries({ term: TERM, weekday: 1, weeks: gapWeeks, startTime: "08:00", endTime: "08:45" });
  const gapOcc = expandEventSet([{ ...event, uid: "g@o", start: gap.start, end: gap.end, rrule: gap.rrule, exdates: gap.exdates }], TERM_LO, TERM_HI);
  eq("1-8 + 10-16 断档 → 15 场", gapOcc.length, 15);
  eq("断档的第 9 周（2026-11-09）没有场次", gapOcc.some((o) => wall(o.start).startsWith("2026-11-09")), false);
  eq("断档前的第 8 周（2026-11-02）有场次", gapOcc.some((o) => wall(o.start).startsWith("2026-11-02")), true);
  eq("断档后的第 10 周（2026-11-16）有场次", gapOcc.some((o) => wall(o.start).startsWith("2026-11-16")), true);
  eq("断档的 EXDATE 只有第 9 周一条", gap.exdates.length, 1);
}

/* ⑥ 校历不可用：每周、共 16 周（不停在无限重复上） */
{
  const fb = buildCourseSeries({ term: null, weekday: 3, weeks: [], startTime: "09:50", endTime: "11:25", from: "2026-10-13" });
  ok("降级标记", fb.fallback === true);
  eq("降级：COUNT=16", fb.rrule.count, 16);
  eq("降级：不写 UNTIL、不写 EXDATE", [fb.rrule.until ?? null, fb.exdates.length], [null, 0]);
  eq("降级：锚点取 from 之后第一个周三", wall(fb.start), "2026-10-14 09:50");
  eq("降级：不落周集合", fb.weeks, []);
  const occ = expandEventSet([{ ...event, uid: "fb@o", start: fb.start, end: fb.end, rrule: fb.rrule, exdates: fb.exdates }], ms("2026-10-13", "00:00"), ms("2028-01-01", "00:00"));
  eq("降级：整段展开 16 场", occ.length, 16);
  eq("降级：逐周 +7（末场 2027-01-27）", wall(occ[15].start), "2027-01-27 09:50");
  eq("降级：可自定义周数", buildCourseSeries({ term: null, weekday: 1, weeks: [], startTime: "08:00", endTime: "08:45", from: "2026-10-13", fallbackWeeks: 4 }).rrule.count, 4);
}

/* ⑦ 参数不足一律 null（宁可让调用方提示，也不静默存一条坏事件） */
{
  const base = { term: TERM, weekday: 3, weeks: [1], startTime: "09:50", endTime: "11:25" };
  eq("缺星期 → null", buildCourseSeries({ ...base, weekday: 0 }), null);
  eq("缺时刻 → null", buildCourseSeries({ ...base, startTime: "25:00" }), null);
  eq("校历可用但一周都没选 → null", buildCourseSeries({ ...base, weeks: [] }), null);
  eq("周数全越界 → null", buildCourseSeries({ ...base, weeks: [20, 21] }), null);
  eq("结束早于开始 → 兜底 45 分钟", wall(buildCourseSeries({ ...base, startTime: "09:50", endTime: "09:10" }).end), "2026-09-16 10:35");
}

/* ⑧ ICS 往返：X- 属性与 EXDATE / RECURRENCE-ID 都必须写得出、读得回 */
{
  const ics = serializeCalendar([event], Date.UTC(2026, 9, 12, 0, 0, 0));
  ok("写出 X-ONETHU-SRC:course-manual", ics.includes("X-ONETHU-SRC:course-manual"));
  ok("写出 X-ONETHU-WEEKS:1,3,5", ics.includes("X-ONETHU-WEEKS:1,3,5"));
  ok("写出 X-ONETHU-PERIOD:3-4", ics.includes("X-ONETHU-PERIOD:3-4"));
  ok("写出 EXDATE（此前缺失）", /^EXDATE;TZID=Asia\/Shanghai:/m.test(ics));
  const back = parseIcs(ics)[0];
  eq("读回周集合", back.onethuWeeks, [1, 3, 5]);
  eq("读回节次", back.onethuPeriod, { start: 3, end: 4 });
  eq("读回来源标记", back.onethuSource, MANUAL_COURSE_SOURCE);
  ok("识别为手动补充课程", isManualCourse(back));
  eq("读回 EXDATE 条数", back.exdates.length, 2);
  eq("读回 UNTIL 与生成时一致", back.rrule.until, series.rrule.until);
  eq("往返后再展开仍是这 3 场", expandEventSet([back], TERM_LO, TERM_HI).map((o) => wall(o.start)), ["2026-09-16 09:50", "2026-09-30 09:50", "2026-10-14 09:50"]);

  // 覆盖实例：RECURRENCE-ID 不写回的话，回读会变成一条独立事件（原场次 + 新场次双份）
  const override = { ...event, uid: "ov@o", recurrenceId: series.start, start: series.start + 86_400_000, end: series.end + 86_400_000 };
  const ovIcs = serializeCalendar([override]);
  ok("写出 RECURRENCE-ID（此前缺失）", /^RECURRENCE-ID;TZID=Asia\/Shanghai:/m.test(ovIcs));
  eq("覆盖实例读回仍是覆盖实例", parseIcs(ovIcs)[0].recurrenceId, series.start);

  // 未用该机制的事件：一个字节都不多写（存量日程零影响）
  const plain = serializeCalendar([{ uid: "p@o", summary: "普通日程", start: series.start, end: series.end }]);
  eq("缺省不写 X-ONETHU-WEEKS / PERIOD / EXDATE", [plain.includes("X-ONETHU-WEEKS"), plain.includes("X-ONETHU-PERIOD"), plain.includes("EXDATE")], [false, false, false]);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
