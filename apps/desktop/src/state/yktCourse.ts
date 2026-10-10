/**
 * 雨课堂课程页的「当前课程」记忆（R25）。
 *
 * 为什么需要：雨课堂作业原生详情页的返回键是 `BackButton to={from}`，**不带参数**
 * （shared.tsx 的既定语义：返回一级页一律不带参数）。从课程页点开作业再返回时，
 * navParams 已换成详情页的参数 → 课程页会读不到 courseId 而渲染成空白。
 * 这里用模块级记忆（与 selectedSemester 同款做法）兜住这个返回路径：
 * 课程卡进页时记住最近打开的课程，课程页读 navParams 优先、缺省回落本记忆。
 *
 * 只存 id + 展示名（无任何凭据 / 内容），随进程存活，不落盘。
 */

export interface YktCourseRef {
  id: string;
  name: string;
}

let current: YktCourseRef | null = null;

/** 记住最近打开的雨课堂课程（网络学堂页课程卡进入前调用） */
export function setYktCourse(ref: YktCourseRef): void {
  current = { id: ref.id, name: ref.name };
}

/** 取最近打开的雨课堂课程（课程页在 navParams 缺省时回落它） */
export function getYktCourse(): YktCourseRef | null {
  return current;
}
