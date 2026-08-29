import { useEffect, useMemo, useState } from "react";
import { Card, Empty, ErrorNote, PageHead } from "../components/Layout.js";
import { IconRefresh } from "../components/Icons.js";
import { useCalendar, useCampusData, useWeekSchedule } from "../state/data.js";

const DAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
/** 清华本科小节开始时间（第 N 节上课时刻） */
const SLOT_TIME: Record<number, string> = {
  1: "08:00", 2: "08:55", 3: "09:55", 4: "10:50", 5: "11:45",
  6: "13:30", 7: "14:25", 8: "15:20", 9: "16:15", 10: "17:10",
  11: "18:05", 12: "19:20", 13: "20:15", 14: "21:10",
};

interface Cell {
  name: string;
  location?: string;
  teacher?: string;
  span: number;
}
/** 网格条目的最小形状（课表条目） */
interface GridEntry {
  courseName: string;
  location?: string;
  teacher?: string;
  dayOfWeek?: number;
  date?: string;
  startSection?: number;
  endSection?: number;
}

function SlotRow({
  sec,
  grid,
}: {
  sec: number;
  grid: Map<string, Cell>;
}) {
  return (
    <>
      <div className="tt-rowlabel" style={{ gridColumn: 1, gridRow: sec + 1 }}>
        {sec}
        <br />
        <span>{SLOT_TIME[sec] ?? ""}</span>
      </div>
      {DAY_NAMES.map((_, day) => {
        const cell = grid.get(`${day}-${sec}`);
        if (!cell) {
          return <div key={day} className="tt-cell" style={{ gridColumn: day + 2, gridRow: sec + 1 }} />;
        }
        return (
          <div
            key={day}
            className="tt-cell"
            style={{ gridColumn: day + 2, gridRow: `${sec + 1} / span ${cell.span}` }}
            title={cell.name + (cell.location ? " @" + cell.location : "")}
          >
            <div className="tt-course">
              <b>{cell.name}</b>
              {cell.location ? <span>{cell.location}</span> : null}
            </div>
          </div>
        );
      })}
    </>
  );
}

export function SchedulePage() {
  const campus = useCampusData();
  const calendar = useCalendar();
  const semesters = useMemo(
    () => (calendar.data ? [{ ...calendar.data }, ...calendar.data.nextSemesterList] : []),
    [calendar.data],
  );
  const [semesterIdx, setSemesterIdx] = useState(0);
  const [weekNo, setWeekNo] = useState(1);
  const semester = semesters[Math.min(semesterIdx, Math.max(semesters.length - 1, 0))] ?? null;
  // 换学期自动定位到本周（按校历 firstDay 推算，夹在 1..weekCount）
  useEffect(() => {
    if (!semester) return;
    const base = new Date(semester.firstDay.replace(/-/g, "/"));
    const diff = Math.floor((Date.now() - base.getTime()) / (7 * 86400000)) + 1;
    setWeekNo(Math.min(Math.max(1, diff), semester.weekCount));
  }, [semester?.semesterId, semester?.firstDay, semester?.weekCount]);

  const weekData = useWeekSchedule(semester, weekNo);
  /** 校历就绪 → 周视图数据；否则回落 campus 数据（原 3 周窗口） */
  const entries: GridEntry[] = useMemo(
    () => (semester ? weekData.data ?? [] : campus.data?.schedule ?? []),
    [semester, weekData.data, campus.data],
  );

  const todayIdx = useMemo(() => {
    const d = new Date().getDay();
    return d === 0 ? 6 : d - 1; // getDay(): 周日=0 → 列 6
  }, []);

  const { grid, maxEnd } = useMemo(() => {
    const byCell = new Map<string, Cell>();
    let maxEnd = 5;
    for (const s of entries) {
      const day = (s.dayOfWeek ?? 1) - 1;
      const start = s.startSection ?? 1;
      const end = Math.max(s.endSection ?? start, start);
      if (day < 0 || day > 6 || start < 1 || start > 14) continue;
      maxEnd = Math.max(maxEnd, end);
      const key = `${day}-${start}`;
      if (!byCell.has(key)) {
        byCell.set(key, {
          name: s.courseName,
          location: s.location,
          teacher: s.teacher,
          span: Math.min(end - start + 1, 14 - start + 1),
        });
      }
    }
    return { grid: byCell, maxEnd: Math.min(Math.max(maxEnd, 5), 14) };
  }, [entries]);

  const rows = useMemo(() => {
    const out: number[] = [];
    for (let i = 1; i <= maxEnd; i++) out.push(i);
    return out;
  }, [maxEnd]);

  /** 所选周的 7 个日期（校历就绪时显示在表头） */
  const dayDates = useMemo(() => {
    if (!semester) return [];
    const base = new Date(semester.firstDay.replace(/-/g, "/"));
    const monday = new Date(base.getTime() + (weekNo - 1) * 7 * 86400000);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday.getTime() + i * 86400000);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    });
  }, [semester, weekNo]);

  const loading = semester ? weekData.state === "loading" && !weekData.data : campus.state === "loading" && !campus.data;

  return (
    <>
      <PageHead
        title="课表"
        meta={
          semester
            ? `${semester.semesterName || semester.semesterId} · 第 ${weekNo} 周 / 共 ${semester.weekCount} 周`
            : "本周 · 教务系统实时"
        }
        actions={
          <button
            className="btn"
            onClick={() => {
              weekData.reload();
              if (!calendar.data) void calendar.reload();
              else void campus.reload();
            }}
            disabled={loading}
          >
            <IconRefresh width={14} height={14} />
            刷新
          </button>
        }
      />

      {calendar.state === "error" ? (
        <ErrorNote text={`校历加载失败（周导航/学期切换不可用）：${calendar.error ?? ""}`} onRetry={() => void calendar.reload()} />
      ) : null}
      {semester && weekData.state === "error" ? (
        <ErrorNote text={weekData.error ?? ""} onRetry={weekData.reload} />
      ) : null}
      {!semester && campus.state === "error" ? (
        <ErrorNote text={campus.error ?? ""} onRetry={() => void campus.reload()} />
      ) : null}

      {calendar.data ? (
        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select
            className="input"
            value={Math.min(semesterIdx, semesters.length - 1)}
            onChange={(e) => setSemesterIdx(Number(e.target.value))}
            style={{ maxWidth: 240 }}
          >
            {semesters.map((s, i) => (
              <option key={s.semesterId || i} value={i}>
                {s.semesterName || s.semesterId || `学期 ${i + 1}`}
              </option>
            ))}
          </select>
          <button className="btn" disabled={weekNo <= 1} onClick={() => setWeekNo((w) => Math.max(1, w - 1))}>
            ‹ 上一周
          </button>
          <span className="page-indicator">第 {weekNo} 周</span>
          <button
            className="btn"
            disabled={weekNo >= (semester?.weekCount ?? 1)}
            onClick={() => setWeekNo((w) => Math.min(semester?.weekCount ?? 1, w + 1))}
          >
            下一周 ›
          </button>
        </div>
      ) : null}

      {loading ? (
        <Empty text="正在从教务系统取数…" />
      ) : entries.length === 0 ? (
        <Card><Empty text="本教学周没有排课记录。" /></Card>
      ) : (
        <Card style={{ padding: 12 }}>
          <div className="tt" style={{ gridTemplateColumns: "56px repeat(7, minmax(0, 1fr))", gridAutoRows: "minmax(64px, auto)" }}>
            <div />
            {DAY_NAMES.map((name, i) => (
              <div key={name} className={"tt-head" + (i === todayIdx ? " is-today" : "")}>
                {name}
                {dayDates[i] ? <span style={{ fontWeight: 400, marginLeft: 4 }}>{dayDates[i]}</span> : null}
              </div>
            ))}
            {rows.map((sec) => (
              <SlotRow key={sec} sec={sec} grid={grid} />
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
