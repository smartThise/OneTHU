/**
 * 成绩的统计块与明细行（霖 2026-10-11，元素级拆分 B5）。
 *
 * **一处实现、两处调用**：信息页的 ReportTab 与白板的独立组件都用这里的实现，
 * 因此"白板上的成绩统计卡"与"信息页顶部那四块"永远同源、不会分叉。
 */
import { useMemo, type ReactNode } from "react";
import type { ReportRow } from "@onethu/core";
import { Card } from "../../components/Layout.js";
import { IconPen, IconRefresh } from "../../components/Icons.js";
import { useReport } from "../../state/data.js";
import { weightedAverage } from "../../lib/grades.js";
import { t as i18n } from "../../i18n/index.js";


/** 学期串 → 学年（"2024-2025秋" → "2024-2025"） */
export function academicYear(semester: string): string {
  const m = /^(\d{4})-(\d{4})/.exec(semester);
  return m ? m[1] + "-" + m[2] : semester || "未知学年";
}

export interface ReportStats {
  rows: ReportRow[] | null;
  loading: boolean;
  /** 学期分组（最新在前） */
  groups: Array<[string, ReportRow[]]>;
  overall: number | null;
  totalCredits: number;
  latestAvg: number | null;
}

export function useReportStats(): ReportStats {
  const { data, state } = useReport();
  const groups = useMemo(() => {
    if (!data) return [];
    const bySemester = new Map<string, ReportRow[]>();
    for (const row of data) {
      const key = row.semester || "未知学期";
      const list = bySemester.get(key);
      if (list) list.push(row);
      else bySemester.set(key, [row]);
    }
    return [...bySemester.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [data]);
  const overall = useMemo(() => (data ? weightedAverage(data) : null), [data]);
  const totalCredits = useMemo(
    () => (data ?? []).filter((r) => Number.isFinite(r.credit)).reduce((sum, r) => sum + r.credit, 0),
    [data],
  );
  const latestAvg = useMemo(() => (groups.length > 0 ? weightedAverage(groups[0]?.[1] ?? []) : null), [groups]);
  return { rows: data ?? null, loading: state === "loading" && !data, groups, overall, totalCredits, latestAvg };
}

/**
 * 统计卡的统一骨架（霖 2026-10-12）：白板上每一档呈现到**哪一层信息**由 CSS 按 `data-size` 决定
 * —— 1×1 只留主数值、2×1 补名称、2×2 再补一行上下文（`sub`）。信息页没有 `data-size` 祖先，
 * `sub` 默认不显示，既有观感一字不变。
 *
 * 这样一块统计卡只有**一处实现**：白板、信息页、抽屉预览共用，排版随档位由同一条 CSS 规则给出。
 */
export function StatTile({
  icon,
  tone,
  num,
  label,
  cap,
  sub,
}: {
  icon: ReactNode;
  tone?: "red" | "amber" | "green";
  num: ReactNode;
  label: string;
  /** 2×2 档在数值下方居中的口径行（如「实际均绩 / 4.0」）。 */
  cap?: string | null;
  /** 2×2 档最下面一行进度（如「已修 12/40」）。 */
  sub?: string | null;
}): ReactNode {
  return (
    <Card className="stat-card stat-tiered">
      <span className={"stat-icon" + (tone ? " " + tone : "")}>{icon}</span>
      <span className="stat-label">{label}</span>
      <span className="stat-num">{num}</span>
      {cap ? <span className="stat-cap">{cap}</span> : null}
      {sub ? <span className="stat-sub">{sub}</span> : null}
    </Card>
  );
}

/** 已修课程（门数）。2×2 补一行学分小计。 */
export function ReportStatDone(): ReactNode {
  const s = useReportStats();
  const n = s.rows?.length ?? 0;
  return (
    <StatTile
      icon={<IconPen width={17} height={17} />}
      num={s.loading ? "–" : n}
      label={i18n("auto.pages.info.reportParts.1")}
      cap={s.loading || !n ? null : "共 " + s.totalCredits.toFixed(1) + " 学分"}
    />
  );
}

/** 总学分。2×2 补一行最近学期的学分。 */
export function ReportStatCredit(): ReactNode {
  const s = useReportStats();
  const latestSem = s.groups[0]?.[0] ?? null;
  const latestCredit = s.groups[0]?.[1]?.reduce((sum, r) => sum + (Number.isFinite(r.credit) ? r.credit : 0), 0) ?? 0;
  return (
    <StatTile
      tone="green"
      icon={<IconRefresh width={17} height={17} />}
      num={s.totalCredits ? s.totalCredits.toFixed(1) : "–"}
      label={i18n("auto.pages.info.reportParts.2")}
      cap={latestSem ? latestSem + " " + latestCredit.toFixed(1) : null}
    />
  );
}

/** 全部学年加权。2×2 补一行参与统计的学期数。 */
export function ReportStatOverall(): ReactNode {
  const s = useReportStats();
  return (
    <StatTile
      tone="amber"
      icon={<IconPen width={17} height={17} />}
      num={s.overall === null ? "–" : s.overall.toFixed(3)}
      label={i18n("auto.pages.info.reportParts.3")}
      cap={s.groups.length ? "共 " + s.groups.length + " 个学期" : null}
    />
  );
}

/** 最新学期加权。2×2 补一行学期名（2×1 的名称已含学期，这里只在 2×2 出现，避免重复）。 */
export function ReportStatLatest(): ReactNode {
  const s = useReportStats();
  const sem = s.groups[0]?.[0] ?? null;
  return (
    <StatTile
      icon={<IconRefresh width={17} height={17} />}
      num={s.latestAvg === null ? "–" : s.latestAvg.toFixed(3)}
      label={i18n("auto.pages.info.reportParts.4")}
      cap={sem ? sem + " · " + (s.groups[0]?.[1]?.length ?? 0) + " 门" : null}
    />
  );
}

/** 成绩明细：按学期分组，只取前 limit 行（卡片里不做内部滚动）。 */
export function ReportScoreRows({ limit = 8 }: { limit?: number }): ReactNode {
  const s = useReportStats();
  const rows: ReactNode[] = [];
  let used = 0;
  for (const [semester, list] of s.groups) {
    if (used >= limit) break;
    rows.push(
      <div className="wg-card-subhead" key={semester}>
        <span>{semester}</span>
        <span className="wg-card-subhead-side">{i18n("auto.pages.info.reportParts.5")}{list.length ? (weightedAverage(list)?.toFixed(3) ?? "–") : "–"} · {list.length} {i18n("auto.pages.info.reportParts.6")}</span>
      </div>,
    );
    for (const r of list) {
      if (used >= limit) break;
      used += 1;
      rows.push(
        <div className="wg-card-line" key={semester + "-" + r.name + "-" + String(used)}>
          <span className="wg-card-line-name">{r.name || "—"}</span>
          <span className="wg-card-line-side">{r.grade || "–"}</span>
        </div>,
      );
    }
  }
  if (!rows.length) return <div className="wg-card-empty">{s.loading ? "读取中…" : "暂无成绩"}</div>;
  return <div className="wg-card-rows">{rows}</div>;
}
