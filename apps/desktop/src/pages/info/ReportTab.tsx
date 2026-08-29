/**
 * 成绩页 —— getReport（thu-info-lib basics.ts getReport 同源解析）。
 * 学期分组表格 + 学期/学年/全部加权平均分统计（P 等非数字绩点不计入统计）。
 */
import { useMemo } from "react";
import type { ReportRow } from "@onethu/core";
import { Card, Empty, ErrorNote, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { IconPen, IconRefresh } from "../../components/Icons.js";
import { useReport } from "../../state/data.js";

function weightedAverage(rows: ReportRow[]): number | null {
  let credits = 0;
  let points = 0;
  for (const r of rows) {
    if (!Number.isFinite(r.point) || !Number.isFinite(r.credit) || r.credit <= 0) continue;
    credits += r.credit;
    points += r.point * r.credit;
  }
  return credits > 0 ? points / credits : null;
}

/** 学期串 → 学年（"2024-2025秋" → "2024-2025"） */
function academicYear(semester: string): string {
  return semester.split("-").slice(0, 2).join("-");
}

function gradeClass(grade: string): string {
  if (/^A/.test(grade)) return "grade-a";
  if (/^B\+?$/.test(grade) || grade === "B") return "grade-b";
  if (/^[CD]/.test(grade) || grade === "F") return "grade-low";
  return "";
}

export function ReportTab() {
  const { data, state, error, reload } = useReport();

  const groups = useMemo(() => {
    if (!data) return [];
    const bySemester = new Map<string, ReportRow[]>();
    for (const row of data) {
      const key = row.semester || "未知学期";
      const list = bySemester.get(key);
      if (list) list.push(row);
      else bySemester.set(key, [row]);
    }
    // 学期倒序（最新在前）：semester 形如 "2024-2025秋"，字符串序即时间序
    return [...bySemester.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [data]);

  const overall = useMemo(() => (data ? weightedAverage(data) : null), [data]);
  const totalCredits = useMemo(
    () =>
      (data ?? [])
        .filter((r) => Number.isFinite(r.credit))
        .reduce((sum, r) => sum + r.credit, 0),
    [data],
  );
  const latestAvg = useMemo(() => (groups.length > 0 ? weightedAverage(groups[0]?.[1] ?? []) : null), [groups]);

  const yearStats = useMemo(() => {
    const byYear = new Map<string, ReportRow[]>();
    for (const row of data ?? []) {
      const year = academicYear(row.semester || "");
      const list = byYear.get(year);
      if (list) list.push(row);
      else byYear.set(year, [row]);
    }
    return [...byYear.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [data]);

  return (
    <>
      <div className="stats">
        <Card className="stat-card">
          <span className="stat-icon">
            <IconPen width={17} height={17} />
          </span>
          <div>
            <div className="stat-num">{state === "loading" && !data ? "–" : (data?.length ?? 0)}</div>
            <div className="stat-label">已修课程</div>
          </div>
        </Card>
        <Card className="stat-card">
          <span className="stat-icon green">
            <IconRefresh width={17} height={17} />
          </span>
          <div>
            <div className="stat-num">{totalCredits ? totalCredits.toFixed(1) : "–"}</div>
            <div className="stat-label">总学分</div>
          </div>
        </Card>
        <Card className="stat-card">
          <span className="stat-icon amber">
            <IconPen width={17} height={17} />
          </span>
          <div>
            <div className="stat-num">{overall === null ? "–" : overall.toFixed(3)}</div>
            <div className="stat-label">全部学年加权</div>
          </div>
        </Card>
        <Card className="stat-card">
          <span className="stat-icon">
            <IconRefresh width={17} height={17} />
          </span>
          <div>
            <div className="stat-num">{latestAvg === null ? "–" : latestAvg.toFixed(3)}</div>
            <div className="stat-label">最新学期（{groups[0]?.[0] ?? "–"}）</div>
          </div>
        </Card>
      </div>

      {state === "error" ? <ErrorNote text={error ?? ""} onRetry={() => void reload()} /> : null}

      {state === "loading" && !data ? (
        <SkeletonRows rows={6} />
      ) : (data?.length ?? 0) === 0 ? (
        <Card>
          <Empty text="暂无成绩记录。" />
        </Card>
      ) : (
        <>
          {groups.map(([semester, rows]) => {
            const avg = weightedAverage(rows);
            return (
              <div key={semester} style={{ marginBottom: 18 }}>
                <SectionHead
                  title={semester}
                  aside={`加权平均 ${avg === null ? "–" : avg.toFixed(3)} · ${rows.length} 门`}
                />
                <Card style={{ padding: 0, overflow: "hidden" }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>课程</th>
                        <th className="num">学分</th>
                        <th className="num">等级</th>
                        <th className="num">绩点</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={`${semester}-${i}`} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                          <td className="cell-title">{r.name}</td>
                          <td className="num">{Number.isFinite(r.credit) ? r.credit : "–"}</td>
                          <td className={`num ${gradeClass(r.grade)}`}>{r.grade || "–"}</td>
                          <td className="num">{Number.isFinite(r.point) ? r.point.toFixed(1) : "–"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </div>
            );
          })}

          <SectionHead title="学年汇总" aside="按学分加权（不计 P/EXE 等非绩点课程）" />
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>学年</th>
                  <th className="num">课程</th>
                  <th className="num">学分</th>
                  <th className="num">加权平均分</th>
                </tr>
              </thead>
              <tbody>
                {yearStats.map(([year, rows]) => {
                  const avg = weightedAverage(rows);
                  const credits = rows
                    .filter((r) => Number.isFinite(r.credit))
                    .reduce((s, r) => s + r.credit, 0);
                  return (
                    <tr key={year}>
                      <td className="cell-title">{year}</td>
                      <td className="num">{rows.length}</td>
                      <td className="num">{credits.toFixed(1)}</td>
                      <td className="num">{avg === null ? "–" : avg.toFixed(3)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  );
}
