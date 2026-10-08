/**
 * 成绩统计（info 成绩页与「我的」页共用，禁止各写一份口径）。
 *
 * 口径与 info/ReportTab 一致：P / F 这类非数字绩点、以及非正学分不计入加权平均。
 */
import type { ReportRow } from "@onethu/core";

/** 学分加权平均绩点：无有效学分返回 null（调用方显示 —） */
export function weightedAverage(rows: ReportRow[]): number | null {
  let credits = 0;
  let points = 0;
  for (const r of rows) {
    if (!Number.isFinite(r.point) || !Number.isFinite(r.credit) || r.credit <= 0) continue;
    credits += r.credit;
    points += r.point * r.credit;
  }
  return credits > 0 ? points / credits : null;
}

/** 有效学分合计（与加权平均同一过滤口径，保证「学分/绩点」两栏互相对得上） */
export function creditsOf(rows: ReportRow[]): number {
  return rows.reduce((sum, r) => (Number.isFinite(r.credit) && r.credit > 0 ? sum + r.credit : sum), 0);
}

/** 按学期分组并按学期倒序（semester 形如 "2024-2025秋"，字符串序即时间序） */
export function groupBySemester(rows: ReportRow[]): Array<[string, ReportRow[]]> {
  const bySemester = new Map<string, ReportRow[]>();
  for (const row of rows) {
    const key = row.semester || "未知学期";
    const list = bySemester.get(key);
    if (list) list.push(row);
    else bySemester.set(key, [row]);
  }
  return [...bySemester.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}
