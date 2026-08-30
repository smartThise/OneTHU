import { useEffect, useMemo, useState } from "react";
import { Card, Empty, ErrorNote, PageHead } from "../components/Layout.js";
import { IconRefresh } from "../components/Icons.js";
import { useCalendar, useCampusData, useWeekSchedule } from "../state/data.js";

const DAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
/** 上游 schedule.tsx beginTime/endTime 逐字（第 N 节起止时刻） */
const BEGIN_TIME = ["", "08:00", "08:50", "09:50", "10:40", "11:30", "13:30", "14:20", "15:20", "16:10", "17:05", "17:55", "19:20", "20:10", "21:00"];
const END_TIME = ["", "08:45", "09:35", "10:35", "11:25", "12:15", "14:15", "15:05", "16:05", "16:55", "17:50", "18:40", "20:05", "20:55", "21:45"];
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const BEGIN_MIN = BEGIN_TIME.map(toMin);
const END_MIN = END_TIME.map(toMin);
/** 自由时间轴：距 0:00 分钟数 → px（上游 gridHeight 同款） */
const PX_PER_MIN = 0.72;
const AXIS_BEGIN = BEGIN_MIN[1] ?? 480;
const y = (min: number) => (min - AXIS_BEGIN) * PX_PER_MIN;

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

/** 课程块配色（按课程名稳定取色，同学期同色） */
const PALETTE = [
  "#7c5cff", "#2f8fff", "#00a884", "#e8734a", "#c257d6",
  "#3aa2e8", "#d8a12a", "#5ab86d", "#e05f8f", "#6a7de8",
];
function colorOf(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length] ?? PALETTE[0] ?? "#7c5cff";
}

interface Placed {
  entry: GridEntry;
  day: number; // 0-6
  start: number;
  end: number; // 含
  beginMin: number; // 距 0:00 分钟（上游 begin/end 语义）
  endMin: number;
  lane: number;
  lanes: number;
  color: string;
}

/** 同日重叠分道（区间图着色）：按开始节排序，贪心放入第一个可用道次 */
function layout(entries: GridEntry[]): { placed: Placed[]; maxEnd: number } {
  const byDay: GridEntry[][] = Array.from({ length: 7 }, () => []);
  let maxEnd = 5;
  for (const s of entries) {
    const day = (s.dayOfWeek ?? 1) - 1;
    const start = s.startSection ?? 1;
    const end = Math.max(s.endSection ?? start, start);
    if (day < 0 || day > 6 || start < 1 || start > 14) continue;
    maxEnd = Math.max(maxEnd, end);
    byDay[day]?.push(s);
  }
  const placed: Placed[] = [];
  for (let day = 0; day < 7; day++) {
    const list = [...(byDay[day] ?? [])].sort(
      (a, b) => (a.startSection ?? 1) - (b.startSection ?? 1),
    );
    const laneEnds: number[] = []; // 每道次的当前占用截止节
    for (const s of list) {
      const start = s.startSection ?? 1;
      const end = Math.max(s.endSection ?? start, start);
      let lane = laneEnds.findIndex((e) => e < start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(end);
      } else {
        laneEnds[lane] = end;
      }
      placed.push({
        entry: s,
        day,
        start,
        end,
        beginMin: BEGIN_MIN[start] ?? 480,
        endMin: END_MIN[end] ?? 1200,
        lane,
        lanes: 1,
        color: colorOf(s.courseName),
      });
    }
    for (const p of placed) if (p.day === day) p.lanes = laneEnds.length;
  }
  return { placed, maxEnd: Math.min(Math.max(maxEnd, 5), 14) };
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

  const { placed, maxEnd } = useMemo(() => layout(entries), [entries]);

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
  // 全天轴：无论有几节课，画布恒为 08:00–21:45 满高（自由轴的意义）
  const axisEnd = END_MIN[14] ?? 1305;
  const canvasH = y(axisEnd) + 10;

  return (
    <>
      <PageHead
        title="课表 v3·自由时间轴"
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
        <Card style={{ padding: 12, overflowX: "auto" }}>
          <div style={{ minWidth: 720 }}>
            {/* 表头：星期 + 日期（今天高亮） */}
            <div style={{ display: "flex", marginBottom: 6 }}>
              <div style={{ width: 52, flexShrink: 0 }} />
              {DAY_NAMES.map((name, i) => (
                <div
                  key={name}
                  className={"tt-head" + (i === todayIdx ? " is-today" : "")}
                  style={{ flex: 1, textAlign: "center" }}
                >
                  {name}
                  {dayDates[i] ? <span style={{ fontWeight: 400, marginLeft: 4 }}>{dayDates[i]}</span> : null}
                </div>
              ))}
            </div>

            <div style={{ display: "flex" }}>
              {/* 时间刻度列：小节号+开始时刻，绝对高度对齐画布 */}
              <div style={{ width: 52, flexShrink: 0, position: "relative", height: canvasH }}>
                {BEGIN_TIME.map((t, sec) =>
                  sec === 0 ? null : (
                    <div
                      key={sec}
                      style={{
                        position: "absolute",
                        top: y(BEGIN_MIN[sec] ?? 480),
                        fontSize: 11,
                        lineHeight: 1.3,
                        color: "var(--text-2, #666)",
                        display: "flex",
                        flexDirection: "column",
                        transform: "translateY(-4px)",
                      }}
                    >
                      <b>{sec}</b>
                      <span>{t}</span>
                    </div>
                  ),
                )}
              </div>

              {/* 画布：7 天列，课程块绝对定位（上游 ScheduleBlock 同款模型） */}
              <div style={{ flex: 1, position: "relative", height: canvasH }}>
                {/* 列背景与网格线 */}
                {DAY_NAMES.map((_, day) => (
                  <div
                    key={day}
                    style={{
                      position: "absolute",
                      left: `${(day * 100) / 7}%`,
                      width: `${100 / 7}%`,
                      top: 0,
                      height: canvasH,
                      borderLeft: day === 0 ? "none" : "1px dashed var(--border, #e5e5e5)",
                      background: day === todayIdx ? "rgba(124,92,255,0.05)" : undefined,
                      borderRadius: 6,
                    }}
                  />
                ))}
                {/* 小节横线 */}
                {BEGIN_TIME.map((t, sec) =>
                  sec === 0 || sec > maxEnd ? null : (
                    <div
                      key={`l-${sec}`}
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top: y(BEGIN_MIN[sec] ?? 480),
                        borderTop: "1px solid var(--border, #eee)",
                        opacity: 0.6,
                      }}
                    />
                  ),
                )}
                {/* 当前时刻红线（所视周含今天时） */}
                {dayDates[todayIdx] ? (
                  (() => {
                    const now = new Date();
                    const nm = now.getHours() * 60 + now.getMinutes();
                    if (nm < AXIS_BEGIN || nm > axisEnd) return null;
                    return (
                      <div
                        style={{
                          position: "absolute",
                          left: `${(todayIdx * 100) / 7}%`,
                          width: `${100 / 7}%`,
                          top: y(nm),
                          borderTop: "2px solid #e5484d",
                          zIndex: 5,
                        }}
                      >
                        <div
                          style={{
                            position: "absolute",
                            left: -3,
                            top: -4,
                            width: 6,
                            height: 6,
                            borderRadius: 3,
                            background: "#e5484d",
                          }}
                        />
                      </div>
                    );
                  })()
                ) : null}
                {/* 课程块 */}
                {placed.map((p, i) => {
                  const laneW = 100 / p.lanes; // 一天内每道次占比（%）
                  const leftPct = ((p.day * 100) + p.lane * laneW) / 7; // 画布百分比
                  const widthPct = laneW / 7; // 已是画布百分比，勿再乘 100
                  const top = y(p.beginMin) + 2;
                  const height = Math.max((p.endMin - p.beginMin) * PX_PER_MIN - 4, 22);
                  return (
                    <div
                      key={`b-${i}`}
                      title={`${p.entry.courseName}${p.entry.teacher ? " · " + p.entry.teacher : ""}${
                        p.entry.location ? " @" + p.entry.location : ""
                      }（第${p.start}-${p.end}节）`}
                      style={{
                        position: "absolute",
                        left: `calc(${leftPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                        top,
                        height,
                        background: p.color,
                        borderRadius: 6,
                        padding: "5px 7px",
                        color: "#fff",
                        overflow: "hidden",
                        boxSizing: "border-box",
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.35 }}>{p.entry.courseName}</div>
                      {p.entry.location ? (
                        <div style={{ fontSize: 11, opacity: 0.9, lineHeight: 1.35, marginTop: 2, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: height > 64 ? 3 : 2, WebkitBoxOrient: "vertical" }}>
                          {p.entry.location}
                        </div>
                      ) : null}
                      {height > 92 && p.entry.teacher ? (
                        <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>{p.entry.teacher}</div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
