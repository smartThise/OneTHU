/**
 * 作业 → 课程 聚合（待办页「按课程检索」下拉的取数层）。
 *
 * 为什么不能直接用课程表（data.courses）筛：
 * 外部作业源（雨课堂 / TUOJ / Tyche）的 `Homework.courseId` 是**合成值** `ext:<source>`——
 *   ① 同一源的多门课会撞成同一个 id（雨课堂的「数据结构」和「大学物理」在数据里同 id）；
 *   ② 这个 id 根本不在课程表里，按课程表筛就会**整源消失**。
 * 真实课名在 `Homework.courseName`。所以这里按「真实课程」归组：
 *   网络学堂 → 按 courseId；外部源 → 按 (source, courseName)。
 *
 * 2026-09-25 用户实录：雨课堂作业不出现在课程清单里（旧写法按课程表取候选，必然漏掉整个源）。
 */
import type { Homework } from "@onethu/core";

/** 源展示名解析（注入，避免 lib 依赖 core 运行时常量——那会把整个 core 拖进产物/测试链） */
export type SourceNameOf = (id: NonNullable<Homework["source"]>) => string;

export interface HwCourseOption {
  /** 下拉的 value：与 `hwCourseKey` 同构 */
  key: string;
  /** 展示名（网络学堂取课程表，外部源取真实课名） */
  label: string;
  count: number;
  /** 来源（undefined = 网络学堂）；用于下拉的 optgroup 分组 */
  source?: Homework["source"];
}

/** 分组键：网络学堂 `learn::<courseId>`；外部源 `ext:<source>::<courseName>` */
export function hwCourseKey(h: Homework): string {
  return h.source ? `ext:${h.source}::${h.courseName ?? ""}` : `learn::${h.courseId}`;
}

/** 课程展示名 */
export function hwCourseLabel(h: Homework, courseMap: Map<string, string>, sourceName: SourceNameOf): string {
  if (h.source) return h.courseName?.trim() || sourceName(h.source) || h.source;
  return courseMap.get(h.courseId) ?? "课程";
}

/** 按真实课程聚合：网络学堂在前、外部源在后，组内按课名排序（zh 排序） */
export function hwCourseGroups(
  items: readonly Homework[],
  courseMap: Map<string, string>,
  sourceName: SourceNameOf,
): HwCourseOption[] {
  const m = new Map<string, HwCourseOption>();
  for (const h of items) {
    const key = hwCourseKey(h);
    const cur = m.get(key);
    if (cur) cur.count += 1;
    else m.set(key, { key, label: hwCourseLabel(h, courseMap, sourceName), count: 1, source: h.source });
  }
  return [...m.values()].sort((a, b) => {
    if (!a.source !== !b.source) return a.source ? 1 : -1;
    return a.label.localeCompare(b.label, "zh");
  });
}
