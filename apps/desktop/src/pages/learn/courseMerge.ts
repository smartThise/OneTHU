/**
 * 跨源课程同名匹配（R28）：把雨课堂课程与网络学堂课程按**课程名**合并成一张卡片。
 *
 * 为什么单独成文件：这是纯判定逻辑（零依赖、可 Node 直测），页面只消费结果；
 * 匹配规则与「哪些雨课堂课程被并入、哪些仍单列」的口径集中在这里，避免散在 JSX 里。
 *
 * 名称口径：
 *  · 网络学堂侧用课程名（如「线性代数」）；
 *  · 雨课堂侧优先用 `title`（= `course.name`，课程本名，如「线性代数」），缺省回落 `name`
 *    （= 课堂全名，如「2026秋-线性代数-8」）——所以雨课堂有本名才可能匹配上。
 * 归一化：去空白（含全角空格）、全角括号→半角、英文字母小写；其余一律**精确匹配**，
 * 不做模糊/前缀猜测（宁可少合并，也不要把两门不同的课并成一张卡）。
 */

/** 课程名归一（跨源匹配用；仅做「写法差异」层面的收敛，不做语义近似） */
export function normalizeCourseName(s: string): string {
  return (s ?? "")
    .replace(/[\s\u3000]+/g, "")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/[－—–]/g, "-")
    .toLowerCase();
}

export interface MergeCourseRef {
  id: string;
  name: string;
  /** 雨课堂课程本名（网络学堂课程无此字段；匹配时优先用它） */
  title?: string;
}

export interface CourseMergeResult<Y extends MergeCourseRef> {
  /** 网络学堂课程 id → 与之同名的雨课堂课程 */
  byLearnId: Map<string, Y>;
  /** 已被并入网络学堂卡片的雨课堂课程 id（这些不再单列） */
  mergedYktIds: Set<string>;
  /** 找不到同名网络学堂课程的雨课堂课程（仍单列在「雨课堂课程」一节） */
  unmatchedYkt: Y[];
}

/**
 * 按课程名把雨课堂课程并到网络学堂课程上。
 * 同名多个时：网络学堂取先出现者，雨课堂也取先出现者（其余留在单列区，不静默丢弃）。
 */
export function mergeCoursesByName<L extends MergeCourseRef, Y extends MergeCourseRef>(
  learnCourses: ReadonlyArray<L>,
  yktCourses: ReadonlyArray<Y>,
  yktNameOf: (c: Y) => string = (c) => c.title ?? c.name,
): CourseMergeResult<Y> {
  const byName = new Map<string, Y>();
  for (const y of yktCourses) {
    const key = normalizeCourseName(yktNameOf(y));
    if (key && !byName.has(key)) byName.set(key, y);
  }
  const byLearnId = new Map<string, Y>();
  const mergedYktIds = new Set<string>();
  for (const l of learnCourses) {
    if (byLearnId.has(l.id)) continue;
    const hit = byName.get(normalizeCourseName(l.name));
    if (!hit || mergedYktIds.has(hit.id)) continue;
    byLearnId.set(l.id, hit);
    mergedYktIds.add(hit.id);
  }
  const unmatchedYkt = yktCourses.filter((y) => !mergedYktIds.has(y.id));
  return { byLearnId, mergedYktIds, unmatchedYkt };
}

/** 网络学堂课程页里承接雨课堂内容的三个栏位（分组/讨论区不承接） */
export type CourseTabKey = "notices" | "assignments" | "files";

/**
 * 雨课堂内容大类 → 网络学堂课程页栏位（R29 课程页合并口径）：
 *  · 作业 / 试卷 → **作业**栏（都是带 DDL 的提交项，与「全部作业」页口径一致）；
 *  · 公告 → **通知**栏；
 *  · 其余（资料 / 课件 / 视频 / 投票 / 其他）→ **文件**栏。
 *  单一出处：页面与测试都调它，避免两处口径漂移。
 */
export function yktKindToCourseTab(kind: string): CourseTabKey {
  if (kind === "homework" || kind === "exam") return "assignments";
  if (kind === "announcement") return "notices";
  return "files";
}
