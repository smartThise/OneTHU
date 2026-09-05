/**
 * 手动补充课程（自定义课表条目）：本地 localStorage 持久化，按学期分桶。
 * 读写全部 try/catch 静默降级（homeCards 同款策略——存储被驱逐/禁用时功能
 * 退化为会话内可用，不阻塞课表渲染）。
 */

export interface CustomCourse {
  /** 本地唯一键（crypto.randomUUID 不可用时退化为时间戳+随机数） */
  id: string;
  courseName: string;
  teacher?: string;
  location?: string;
  /** 星期 1-7 */
  dayOfWeek: number;
  /** 生效教学周（1 起） */
  weeks: number[];
  /** 起止节次 1-14 */
  startSection: number;
  endSection: number;
  /** 归属学期（semesterId；校历不可用时用 LOCAL_KEY 兜底桶） */
  semesterId: string;
}

const STORE_KEY = "onethu.custom-courses.v1";
/** 校历缺失（campus 兜底视图/演示模式）时的归属桶 */
export const LOCAL_SEMESTER = "_local";

type Buckets = Record<string, CustomCourse[]>;

function readAll(): Buckets {
  try {
    const raw = globalThis.localStorage?.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Buckets) : {};
  } catch {
    return {};
  }
}

function writeAll(buckets: Buckets): void {
  try {
    globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify(buckets));
  } catch {
    /* 存储满/被禁用：静默，内存态仍生效 */
  }
}

export function loadCustomCourses(semesterId: string): CustomCourse[] {
  return readAll()[semesterId] ?? [];
}

export function saveCustomCourses(semesterId: string, list: CustomCourse[]): void {
  const all = readAll();
  if (list.length === 0) delete all[semesterId];
  else all[semesterId] = list;
  writeAll(all);
}

export function newCourseId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `c-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e8).toString(36)}`;
}

/** 「1-3,5,8-16」式周次文案（列表展示用） */
export function describeWeeks(weeks: number[]): string {
  if (weeks.length === 0) return "无";
  const sorted = [...weeks].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0]!;
  let prev = sorted[0]!;
  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i];
    if (cur !== prev + 1) {
      parts.push(start === prev ? `${start}` : `${start}-${prev}`);
      if (cur !== undefined) start = cur;
    }
    if (cur !== undefined) prev = cur;
  }
  return parts.join(",") + " 周";
}
