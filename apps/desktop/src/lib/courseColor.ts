/**
 * 课程配色（按课程名稳定取色，同学期同色）。
 *
 * 抽成共享模块的原因：课表页、选课预览与**桌面小组件**都要用同一份口径——
 * 用户在课表里认的是「紫色那门课」，小组件里换了颜色就等于换了一门课。
 * 曾经课表与选课各写一份同样的 palette，这次统一到这里。
 */

/** 课程色（与课表网格同一组；深色底上也能看清） */
export const COURSE_PALETTE = [
  "#6d7ff0", "#3d8bfd", "#1fa487", "#e07a4f", "#b463d6",  /* token-ok: 课程/来源身份色：跨主题、跨端（课表 + 桌面小组件）必须同色，不做主题化 */
  "#2f9edb", "#c9971f", "#4caf6e", "#d45c8a", "#7a63e8",  /* token-ok: 课程/来源身份色：跨主题、跨端（课表 + 桌面小组件）必须同色，不做主题化 */
] as const;

/** 非课程来源的固定色（考试 / 云 / 本机 / 作业 DDL / 重叠簇） */
export const SRC_COLOR = {
  exam: "#e5484d",  /* token-ok: 课程/来源身份色：跨主题、跨端（课表 + 桌面小组件）必须同色，不做主题化 */
  cloud: "#1fa487",  /* token-ok: 课程/来源身份色：跨主题、跨端（课表 + 桌面小组件）必须同色，不做主题化 */
  local: "#8a8f98",  /* token-ok: 课程/来源身份色：跨主题、跨端（课表 + 桌面小组件）必须同色，不做主题化 */
  hw: "#e8873a",  /* token-ok: 课程/来源身份色：跨主题、跨端（课表 + 桌面小组件）必须同色，不做主题化 */
  cluster: "#7048c8",  /* token-ok: 课程/来源身份色：跨主题、跨端（课表 + 桌面小组件）必须同色，不做主题化 */
} as const;

/** 按课程名取色：同一个名字永远同一个颜色 */
export function courseColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return COURSE_PALETTE[h % COURSE_PALETTE.length] ?? COURSE_PALETTE[0];
}

/** 紧迫度色：越接近截止越红（小组件用；宁少勿滥，只有三档） */
export function urgencyColor(msLeft: number): string {
  if (msLeft <= 6 * 3600_000) return "#e5484d";     // 6 小时内  /* token-ok: 课程/来源身份色：跨主题、跨端（课表 + 桌面小组件）必须同色，不做主题化 */
  if (msLeft <= 24 * 3600_000) return "#e8873a";    // 1 天内  /* token-ok: 课程/来源身份色：跨主题、跨端（课表 + 桌面小组件）必须同色，不做主题化 */
  return "#8a8f98";                                  // 还早：灰，不抢眼  /* token-ok: 课程/来源身份色：跨主题、跨端（课表 + 桌面小组件）必须同色，不做主题化 */
}
