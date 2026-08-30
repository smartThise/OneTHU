/**
 * CR 选课系统一级课表兜底 —— thu-info-community 0317434e (#910) 移植：
 * 夏季学期（学期号以 -3 结尾）教务 bks_jxrl_all JSONP 恒为空，课程安排改从
 * CR 系统 kbSearch 页（xkBks.vxkBksXkbBs.do?m=kbSearch）取。
 *
 * 移植件（lib models/schedule/schedule.ts，逐字对照）：
 * - parseSecondaryWeek：逗号分隔的范围表达式（"8-11,13"）→ 逐周回调；
 * - parseWeekPattern：统一周次模式（全周/单周/双周/前八周/后八周/范围）；
 * - parseCRSchedule：提取 setInitValue 函数体里 strHTML/strHTML1 赋值块
 *   （课程名 <b>、教师/属性/周次/地点 按"；"分号字段），块尾锚点
 *   getElementById('a{session}_{day}') 给出节次与星期。
 *
 * OneTHU 差异：ScheduleEntry 为扁平结构（每条自带 date/节次/时间），故按
 * (块, 周) 展开为逐次条目（date = firstDay + (week-1)*7 + dayOfWeek-1），
 * 无需 lib 的 Schedule{activeTime} 归并与 scheduleTimeAdd；日期运算不依赖
 * dayjs，用本地时区 Date（与 calendar.ts parseLocalDate 同语义）。
 */
import type { ScheduleEntry } from "./types.js";

/** 范围表达式解析（lib parseSecondaryWeek 逐字）：healthy=false 表示含非法段 */
function parseSecondaryWeek(src: string, callback: (week: number) => void): boolean {
  let healthy = true;
  src.split(",").forEach((segment) => {
    if (segment.indexOf("-") === -1) {
      const week = Number(segment);
      if (Number.isNaN(week)) {
        healthy = false;
      } else {
        callback(week);
      }
    } else {
      const partials = segment.split("-");
      if (partials.length === 2) {
        const x = Number(partials[0]);
        const y = Number(partials[1]);
        if (Number.isNaN(x) || Number.isNaN(y) || x > y) {
          healthy = false;
        } else {
          for (let i = x; i <= y; i++) {
            callback(i);
          }
        }
      } else {
        healthy = false;
      }
    }
  });
  return healthy;
}

/**
 * 统一周次模式解析（lib parseWeekPattern 逐字）：支持范围表达式
 * （"8-11周"、"第3,5-7周"）与关键词（全周/单周/双周/前八周/后八周）。
 * 归一化 = 去掉「第」「周」后匹配（上游第二次修复的判据）。
 */
export function parseWeekPattern(pattern: string, weekCount: number): number[] {
  const normalized = pattern.replace(/第|周/g, "").trim();
  if (normalized.length === 0) {
    return [];
  }
  // 全周（normalized 后为 "全"）
  if (normalized === "全") {
    return Array.from({ length: weekCount }, (_, i) => i + 1);
  }
  // 单周（normalized 后为 "单"）
  if (normalized === "单") {
    return Array.from({ length: weekCount }, (_, i) => i + 1).filter((w) => w % 2 === 1);
  }
  // 双周（normalized 后为 "双"）
  if (normalized === "双") {
    return Array.from({ length: weekCount }, (_, i) => i + 1).filter((w) => w % 2 === 0);
  }
  // 前八周 / 前8周（normalized 后为 "前八" / "前8"）
  if (/^前(?:八|8)$/.test(normalized)) {
    return Array.from({ length: Math.min(8, weekCount) }, (_, i) => i + 1);
  }
  // 后八周 / 后8周（normalized 后为 "后八" / "后8"）
  if (/^后(?:八|8)$/.test(normalized)) {
    const start = Math.max(1, weekCount - 7);
    return Array.from({ length: weekCount - start + 1 }, (_, i) => start + i);
  }
  // 兜底：逗号分隔的范围表达式
  const weeks: number[] = [];
  parseSecondaryWeek(normalized, (w) => weeks.push(w));
  return [...new Set(weeks)].sort((a, b) => a - b);
}

/** 本地时区 YYYY-MM-DD 解析（calendar.ts parseLocalDate 同语义，避免跨模块导出） */
function parseYmd(s: string): Date {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s.trim());
  if (!m) return new Date(Number.NaN);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

const fmtYmd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** session → [beginTime, endTime] 映射（lib 逐字：a1～a6，a0 占位） */
const SESSION_TIMES: Array<[string, string]> = [
  ["", ""],
  ["08:00", "09:35"], // a1: 第1节
  ["09:50", "12:15"], // a2: 第2节
  ["13:30", "15:05"], // a3: 第3节
  ["15:20", "16:55"], // a4: 第4节
  ["17:05", "18:40"], // a5: 第5节
  ["19:20", "21:45"], // a6: 第6节
];

/**
 * 解析 CR kbSearch 页面（lib parseCRSchedule 逐字；块间正则含上游第三次修复的
 * `\s+` 宽松换行）。strHTML1 分号字段序：[教师, 课程属性, 周次模式, 上课地点]。
 * 单条解析失败不影响其他课程（lib 同款 try/catch）。
 */
export function parseCRSchedule(html: string, firstDay: string, weekCount: number): ScheduleEntry[] {
  const funcStart = html.indexOf("function setInitValue");
  if (funcStart === -1) {
    return [];
  }
  const funcEnd = html.indexOf("initTopLocal", funcStart);
  if (funcEnd === -1) {
    return [];
  }
  const body = html.substring(funcStart, funcEnd);
  const base = parseYmd(firstDay);
  if (Number.isNaN(base.getTime())) {
    return [];
  }

  const out: ScheduleEntry[] = [];
  // 块锚点：strHTML/strHTML1 重置 → getElementById('a{session}_{day}')（\s+ 宽松换行）
  const blockRegex =
    /strHTML\s*=\s*"";\s+var strHTML1\s*=\s*"";([\s\S]*?)getElementById\('a(\d+)_(\d+)'\)/g;
  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(body)) !== null) {
    try {
      const blockContent = match[1] ?? "";
      const session = Number.parseInt(match[2] ?? "", 10);
      const dayOfWeek = Number.parseInt(match[3] ?? "", 10);

      // 课程名：块内首个 <b>
      const nameMatch = /<b>(.+?)<\/b>/.exec(blockContent);
      if (!nameMatch || !nameMatch[1]) {
        continue;
      }
      const name = nameMatch[1];

      // strHTML1 各行的分号分隔字段
      const fields: string[] = [];
      const fieldRegex = /strHTML1\s*\+=\s*["']；(.+?)["']/g;
      let fieldMatch: RegExpExecArray | null;
      while ((fieldMatch = fieldRegex.exec(blockContent)) !== null) {
        fields.push(fieldMatch[1] ?? "");
      }
      if (fields.length < 3) {
        continue; // 至少需要：教师、课程属性、周次模式
      }

      const teacher = fields[0] ?? "";
      const category = fields[1] ?? ""; // 必修/限选/任选
      const weekPattern = fields[2] ?? ""; // 8-11周 / 全周 / 单周...
      const location = fields.length >= 4 ? (fields[3] ?? "") : "";

      const weeks = parseWeekPattern(weekPattern, weekCount);
      if (weeks.length === 0) {
        continue;
      }
      // session 有效性检查
      if (session < 1 || session > 6) {
        continue;
      }
      const [begin, end] = SESSION_TIMES[session] ?? ["", ""];

      // 每个周次生成一条（date = firstDay + (week-1)*7 + dayOfWeek-1）
      for (const week of weeks) {
        const date = new Date(base.getTime());
        date.setDate(date.getDate() + (week - 1) * 7 + dayOfWeek - 1);
        out.push({
          courseName: name,
          teacher: teacher || undefined,
          date: fmtYmd(date),
          dayOfWeek,
          startSection: session,
          endSection: session,
          location: location || undefined,
          weekText: weekPattern,
          category: category || undefined,
          startTime: begin || undefined,
          endTime: end || undefined,
          raw: { week, name, teacher, category, weekPattern, location },
        });
      }
    } catch {
      // 单条解析失败不影响其他课程（lib 同款）
    }
  }
  return out;
}
