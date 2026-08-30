/**
 * 校历 —— thu-info-lib basics.ts parseCalendarData / getCalendar /
 * getSchoolCalendarYear / getCalendarImageUrl 的纯层（逐字移植；I/O 在 client.ts）。
 *
 * parseCalendarData 逐字对照：kssj/jssj 为学期起止（dayjs 本地时区语义），
 * 教学周第一天对齐到周一（周日→+1 天、周六→+2 天、周二~周五→回退到本周周一），
 * weekCount = dayjs(jssj).diff(firstDay, "week") + 1（纯 7 天块向下取整）。
 */
import type { SchoolCalendarData, SchoolSemester } from "./types.js";

/** "YYYY-MM-DD[…]" → 本地零点 Date（dayjs 日期串解析语义；非法返回 Invalid Date） */
function parseLocalDate(s: string): Date {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s.trim());
  if (m === null) return new Date(Number.NaN);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

const pad2 = (n: number): string => String(n).padStart(2, "0");
const fmtDate = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** lib parseCalendarData 逐字（含 __parseCalendarDataForTest 金标准用例语义） */
export function parseCalendarData(sem: {
  kssj: string;
  jssj: string;
  id: string;
  xnxqmc: string;
}): SchoolSemester {
  const start = parseLocalDate(sem.kssj);
  const end = parseLocalDate(sem.jssj);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error(`校历学期日期无法解析（kssj=${sem.kssj} jssj=${sem.jssj}）`);
  }
  const weekday = start.getDay(); // 0(日) - 6(六)
  const delta = weekday === 0 ? 1 : weekday === 6 ? 2 : 1 - weekday;
  const firstDay = new Date(start.getFullYear(), start.getMonth(), start.getDate() + delta);
  const weekCount = Math.floor((end.getTime() - firstDay.getTime()) / (7 * 86_400_000)) + 1;
  return {
    firstDay: fmtDate(firstDay),
    semesterId: String(sem.id ?? ""),
    semesterName: String(sem.xnxqmc ?? ""),
    weekCount,
  };
}

/** 学期接口响应 → 校历数据（lib getCalendar 的 JSON 解析分支；失败抛普通 Error） */
export function parseSemesterList(text: string): SchoolCalendarData {
  const j = JSON.parse(text) as {
    message?: unknown;
    result?: { kssj?: unknown; jssj?: unknown; id?: unknown; xnxqmc?: unknown };
    resultList?: Array<{ kssj?: unknown; jssj?: unknown; id?: unknown; xnxqmc?: unknown }>;
  };
  if (j.message !== "success") {
    throw new Error(`校历学期接口返回异常（message=${String(j.message ?? "")}）`);
  }
  const cur = j.result;
  if (!cur || typeof cur.kssj !== "string" || typeof cur.jssj !== "string") {
    throw new Error("校历学期接口缺少当前学期数据");
  }
  const current = parseCalendarData({
    kssj: cur.kssj,
    jssj: cur.jssj,
    id: String(cur.id ?? ""),
    xnxqmc: String(cur.xnxqmc ?? ""),
  });
  const nextSemesterList = (j.resultList ?? [])
    .filter((o) => typeof o?.kssj === "string" && typeof o?.jssj === "string")
    .map((o) =>
      parseCalendarData({
        kssj: o.kssj as string,
        jssj: o.jssj as string,
        id: String(o.id ?? ""),
        xnxqmc: String(o.xnxqmc ?? ""),
      }),
    );
  return { ...current, nextSemesterList };
}

/** 校历年接口响应 → number（lib getSchoolCalendarYear：JSON.year） */
export function parseSchoolCalendarYear(text: string): number {
  const j = JSON.parse(text) as { year?: unknown };
  const year = Number(j.year);
  if (!Number.isFinite(year) || year <= 0) {
    throw new Error(`校历年接口返回异常（resp=${text.slice(0, 80).replace(/\s+/g, " ")}）`);
  }
  return year;
}

/** 校历图片地址（lib getCalendarImageUrl：`${CALENDAR_IMAGE_URL}/${lang}/${year}-${1|2}.jpg`） */
export function calendarImageUrl(
  year: number,
  semester: "spring" | "autumn",
  lang: "zh" | "en",
): string {
  return `https://app.cs.tsinghua.edu.cn/xiaoli/${lang}/${year}-${semester === "spring" ? 2 : 1}.jpg`;
}
