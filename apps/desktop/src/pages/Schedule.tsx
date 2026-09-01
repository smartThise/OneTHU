import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Card, Empty, ErrorNote, PageHead } from "../components/Layout.js";
import { IconPlus, IconRefresh } from "../components/Icons.js";
import { useCalendar, useCampusData, useWeekSchedule } from "../state/data.js";
import { describeWeeks, loadCustomCourses, newCourseId, saveCustomCourses, LOCAL_SEMESTER, type CustomCourse } from "../lib/customCourses.js";

const DAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
/** 上游 schedule.tsx beginTime/endTime（节次兜底定位用） */
const BEGIN_TIME = ["", "08:00", "08:50", "09:50", "10:40", "11:30", "13:30", "14:20", "15:20", "16:10", "17:05", "17:55", "19:20", "20:10", "21:00"];
const END_TIME = ["", "08:45", "09:35", "10:35", "11:25", "12:15", "14:15", "15:05", "16:05", "16:55", "17:50", "18:40", "20:05", "20:55", "21:45"];
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const BEGIN_MIN = BEGIN_TIME.map(toMin);
const END_MIN = END_TIME.map(toMin);
/** 自由时间轴：距 0:00 分钟数 → px */
const PX_PER_MIN = 0.72;
const AXIS_BEGIN = 8 * 60; // 08:00
const AXIS_END = END_MIN[14] ?? 1305; // 21:45
const y = (min: number) => (min - AXIS_BEGIN) * PX_PER_MIN;
/** "HH:MM" → 距 0:00 分钟（非法/缺省返回 null） */
const hmToMin = (t?: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** 网格条目的最小形状（课表条目） */
interface GridEntry {
  courseName: string;
  location?: string;
  teacher?: string;
  dayOfWeek?: number;
  date?: string;
  startSection?: number;
  endSection?: number;
  /** 真实时刻（lib parseJSON 语义：kssj/jssj 优先于节次定位） */
  startTime?: string;
  endTime?: string;
  /** 手动补充课程（虚线描边 + 管理入口） */
  custom?: CustomCourse;
}

/** 课程块配色（按课程名稳定取色，同学期同色） */
const PALETTE = [
  "#6d7ff0", "#3d8bfd", "#1fa487", "#e07a4f", "#b463d6",
  "#2f9edb", "#c9971f", "#4caf6e", "#d45c8a", "#7a63e8",
];
function colorOf(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length] ?? PALETTE[0] ?? "#6d7ff0";
}

interface Placed {
  entry: GridEntry;
  day: number; // 0-6
  beginMin: number;
  endMin: number;
  lane: number;
  lanes: number;
  color: string;
}

/** 定位分钟：kssj/jssj 真实时刻优先（lib parseJSON 语义），节次仅兜底 */
function beginMinOf(s: GridEntry): number {
  return hmToMin(s.startTime) ?? BEGIN_MIN[s.startSection ?? 1] ?? AXIS_BEGIN;
}
function endMinOf(s: GridEntry): number {
  return hmToMin(s.endTime) ?? END_MIN[s.endSection ?? s.startSection ?? 1] ?? AXIS_BEGIN + 45;
}

/** 同日重叠分道（区间图着色）：按开始分钟排序，贪心放入第一个可用道次 */
function layout(entries: GridEntry[]): Placed[] {
  const byDay: GridEntry[][] = Array.from({ length: 7 }, () => []);
  for (const s of entries) {
    const day = (s.dayOfWeek ?? 1) - 1;
    if (day < 0 || day > 6) continue;
    byDay[day]?.push(s);
  }
  const placed: Placed[] = [];
  for (let day = 0; day < 7; day++) {
    const list = [...(byDay[day] ?? [])].sort((a, b) => beginMinOf(a) - beginMinOf(b));
    const laneEnds: number[] = [];
    for (const s of list) {
      const b = beginMinOf(s);
      const e = Math.max(endMinOf(s), b);
      let lane = laneEnds.findIndex((le) => le <= b);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(e);
      } else {
        laneEnds[lane] = e;
      }
      placed.push({ entry: s, day, beginMin: b, endMin: e, lane, lanes: 1, color: colorOf(s.courseName) });
    }
    for (const p of placed) if (p.day === day) p.lanes = laneEnds.length;
  }
  return placed;
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

  /** 手动补充课程（本地持久化，按学期分桶；校历缺失时进 _local 兜底桶） */
  const customKey = semester?.semesterId ?? LOCAL_SEMESTER;
  const [customList, setCustomList] = useState<CustomCourse[]>([]);
  const [customOpen, setCustomOpen] = useState(false);
  /** 点自定义课程块 → 打开弹窗并进入该条编辑态 */
  const [editId, setEditId] = useState<string | null>(null);
  const openEdit = (id: string) => {
    setEditId(id);
    setCustomOpen(true);
  };
  useEffect(() => {
    setCustomList(loadCustomCourses(customKey));
  }, [customKey]);
  const persistCustom = (list: CustomCourse[]) => {
    setCustomList(list);
    saveCustomCourses(customKey, list);
  };

  /** 本周号（按校历 firstDay 推算，夹在 1..weekCount） */
  const currentWeek = useMemo(() => {
    if (!semester) return 1;
    const base = new Date(semester.firstDay.replace(/-/g, "/"));
    const diff = Math.floor((Date.now() - base.getTime()) / (7 * 86400000)) + 1;
    return Math.min(Math.max(1, diff), semester.weekCount);
  }, [semester?.semesterId, semester?.firstDay, semester?.weekCount]);

  // 换学期自动定位当前周
  useEffect(() => {
    setWeekNo(currentWeek);
  }, [currentWeek]);

  const weekData = useWeekSchedule(semester, weekNo);
  /** 校历就绪 → 周视图数据（按周日期窗兜底过滤）；否则回落 campus 数据 */
  const entries: GridEntry[] = useMemo(() => {
    const raw = semester ? weekData.data ?? [] : campus.data?.schedule ?? [];
    if (!semester) return raw;
    const base = new Date(semester.firstDay.replace(/-/g, "/"));
    const ws = new Date(base.getTime() + (weekNo - 1) * 7 * 86400000);
    const we = new Date(ws.getTime() + 6 * 86400000);
    const dayFloor = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const lo = dayFloor(ws);
    const hi = dayFloor(we);
    return raw.filter((e) => {
      if (!e.date) return true; // 无日期条目（个别自定义）不过滤
      const t = dayFloor(new Date(e.date.replace(/-/g, "/")));
      return t >= lo && t <= hi;
    });
  }, [semester, weekData.data, campus.data, weekNo]);

  /** 手动补充课程并入本视图：有校历时按生效周过滤；无校历（campus 兜底）全量展示 */
  const customEntries: GridEntry[] = useMemo(
    () =>
      customList
        .filter((c) => (semester ? c.weeks.includes(weekNo) : true))
        .map((c) => ({
          courseName: c.courseName,
          location: c.location,
          teacher: c.teacher,
          dayOfWeek: c.dayOfWeek,
          startSection: c.startSection,
          endSection: c.endSection,
          custom: c,
        })),
    [customList, semester, weekNo],
  );
  const allEntries = useMemo(() => [...entries, ...customEntries], [entries, customEntries]);

  const todayIdx = useMemo(() => {
    const d = new Date().getDay();
    return d === 0 ? 6 : d - 1;
  }, []);

  /** 是否正在看当前周（回本周按钮显隐 + 红线显隐） */
  const isCurrentWeek = semester ? weekNo === currentWeek : true;

  const placed = useMemo(() => layout(allEntries), [allEntries]);

  /** 所选周的 7 个日期 */
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
  const canvasH = y(AXIS_END) + 12;

  /** 半小时刻度序列 */
  const halfHours = useMemo(() => {
    const out: number[] = [];
    for (let m = AXIS_BEGIN; m <= AXIS_END; m += 30) out.push(m);
    return out;
  }, []);

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
          <>
            {semester && !isCurrentWeek ? (
              <button className="btn" onClick={() => setWeekNo(currentWeek)}>
                回到今天
              </button>
            ) : null}
            <button className="btn" onClick={() => setCustomOpen(true)} title="手动补充课程（本地保存，不上传教务系统）">
              <IconPlus width={14} height={14} />
              添加课程
            </button>
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
          </>
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
            ‹
          </button>
          <span className="page-indicator">第 {weekNo} 周</span>
          <button
            className="btn"
            disabled={weekNo >= (semester?.weekCount ?? 1)}
            onClick={() => setWeekNo((w) => Math.min(semester?.weekCount ?? 1, w + 1))}
          >
            ›
          </button>
        </div>
      ) : null}

      {loading ? (
        <Empty text="正在从教务系统取数…" />
      ) : allEntries.length === 0 ? (
        <Card><Empty text={semester ? `第 ${weekNo} 周没有排课记录（假期周）。` : "没有排课记录。"} /></Card>
      ) : (
        <Card style={{ padding: 14, overflowX: "auto" }}>
          <div style={{ minWidth: 0 }}>
            {/* 表头：星期 + 日期（今天高亮） */}
            <div style={{ display: "flex", marginBottom: 10, alignItems: "flex-end" }}>
              <div style={{ width: 34, flexShrink: 0 }} />
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
              {/* 时间刻度列：每半小时 HH:MM */}
              {/* 时间槽：只标整点（半小时间距 21.6px 标两行必挤），横线在槽右侧的画布里 */}
              <div style={{ width: 34, flexShrink: 0, position: "relative", height: canvasH }}>
                {halfHours
                  .filter((m) => m % 60 === 0)
                  .map((m) => (
                    <div
                      key={m}
                      style={{
                        position: "absolute",
                        top: Math.max(0, y(m) - 6),
                        right: 6,
                        fontSize: 9,
                        color: "var(--text-3, #aaa)",
                        fontVariantNumeric: "tabular-nums",
                        lineHeight: 1,
                      }}
                    >
                      {hhmm(m)}
                    </div>
                  ))}
              </div>

              {/* 画布 */}
              <div style={{ flex: 1, position: "relative", height: canvasH }}>
                {/* 列背景（今天微底色） */}
                {DAY_NAMES.map((_, day) => (
                  <div
                    key={`col-${day}`}
                    style={{
                      position: "absolute",
                      left: `${(day * 100) / 7}%`,
                      width: `${100 / 7}%`,
                      top: 0,
                      height: canvasH,
                      borderLeft: day === 0 ? "none" : "1px solid var(--border, #ececec)",
                      background: day === todayIdx ? "rgba(109,127,240,0.055)" : undefined,
                    }}
                  />
                ))}
                {/* 半小时横线（整点略深） */}
                {halfHours.map((m) => (
                  <div
                    key={`gl-${m}`}
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: y(m),
                      borderTop: m % 60 === 0 ? "1px solid var(--border, #e8e8e8)" : "1px solid var(--border, #f2f2f2)",
                    }}
                  />
                ))}
                {/* 当前时刻红线（当前周） */}
                {isCurrentWeek && dayDates.length > 0 ? (
                  (() => {
                    const now = new Date();
                    const nm = now.getHours() * 60 + now.getMinutes();
                    if (nm < AXIS_BEGIN || nm > AXIS_END) return null;
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
                  const laneW = 100 / p.lanes;
                  const leftPct = ((p.day * 100) + p.lane * laneW) / 7;
                  const widthPct = laneW / 7;
                  const top = y(p.beginMin) + 2;
                  const height = Math.max((p.endMin - p.beginMin) * PX_PER_MIN - 5, 24);
                  const compact = height < 44;
                  return (
                    <div
                      key={`b-${i}`}
                      title={`${p.entry.courseName}${p.entry.teacher ? " · " + p.entry.teacher : ""}${
                        p.entry.location ? " @" + p.entry.location : ""
                      }（${hhmm(p.beginMin)}–${hhmm(p.endMin)}）${p.entry.custom ? " · 手动添加" : ""}`}
                      onClick={p.entry.custom ? () => setEditId(p.entry.custom!.id) : undefined}
                      style={{
                        position: "absolute",
                        left: `calc(${leftPct}% + 3px)`,
                        width: `calc(${widthPct}% - 6px)`,
                        top,
                        height,
                        background: p.color,
                        border: p.entry.custom ? "1.5px dashed rgba(255,255,255,.8)" : undefined,
                        borderRadius: 5,
                        padding: compact ? "2px 4px" : "3px 5px",
                        color: "#fff",
                        overflow: "hidden",
                        boxSizing: "border-box",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
                        zIndex: 6,
                      }}
                    >
                      <div style={{ fontSize: compact ? 8.5 : 9.5, fontWeight: 700, lineHeight: 1.3 }}>
                        {p.entry.courseName}
                      </div>
                      {!compact && p.entry.location ? (
                        <div
                          style={{
                            fontSize: 8.5,
                            opacity: 0.92,
                            lineHeight: 1.35,
                            marginTop: 2,
                            overflow: "hidden",
                            display: "-webkit-box",
                            WebkitLineClamp: height > 72 ? 3 : 2,
                            WebkitBoxOrient: "vertical",
                          }}
                        >
                          {p.entry.location}
                        </div>
                      ) : null}
                      {!compact && height > 88 && p.entry.teacher ? (
                        <div style={{ fontSize: 8.5, opacity: 0.85, marginTop: 1 }}>{p.entry.teacher}</div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Card>
      )}

      <CustomCourseModal
        open={customOpen}
        onClose={() => {
          setCustomOpen(false);
          setEditId(null);
        }}
        list={customList}
        onSave={persistCustom}
        newId={newCourseId}
        weekCount={semester?.weekCount ?? 18}
        hasSemester={!!semester}
        editId={editId}
        setEditId={setEditId}
      />
    </>
  );
}

/* ══════════ 手动补充课程弹窗（自带表面色，zhjwxk 弹窗同款骨架）══════════
 *  参考 thu-info-app scheduleAdd：名称/地点/教师 + 星期 + 周次多选（全/单/双快捷）+ 起止节次。 */
const ccMask: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 };
const ccPanel: React.CSSProperties = { width: "100%", maxWidth: 560, maxHeight: "82vh", display: "flex", flexDirection: "column", background: "var(--bg-elev, #ffffff)", color: "var(--text, #1f2329)", borderRadius: 14, boxShadow: "0 18px 50px rgba(0,0,0,.28)" };
const ccLabel: React.CSSProperties = { display: "block", fontSize: 12, color: "var(--text-3, #9aa1ac)", margin: "10px 0 4px" };
const ccChip = (on: boolean): React.CSSProperties => ({
  minWidth: 30, padding: "3px 7px", borderRadius: 6, fontSize: 12, cursor: "pointer",
  border: `1px solid ${on ? "transparent" : "var(--border, #e3e3e3)"}`,
  background: on ? "var(--accent, #6d7ff0)" : "transparent",
  color: on ? "#fff" : "inherit", textAlign: "center", userSelect: "none",
});

function CustomCourseModal({
  open, onClose, list, onSave, newId, weekCount, hasSemester, editId, setEditId,
}: {
  open: boolean;
  onClose: () => void;
  list: CustomCourse[];
  onSave: (list: CustomCourse[]) => void;
  newId: () => string;
  weekCount: number;
  hasSemester: boolean;
  editId: string | null;
  setEditId: (id: string | null) => void;
}) {
  const editing = editId ? list.find((c) => c.id === editId) ?? null : null;
  const [name, setName] = useState("");
  const [teacher, setTeacher] = useState("");
  const [location, setLocation] = useState("");
  const [day, setDay] = useState(1);
  const [weeks, setWeeks] = useState<number[]>([]);
  const [pBegin, setPBegin] = useState(1);
  const [pEnd, setPEnd] = useState(2);
  const [err, setErr] = useState<string | null>(null);

  /* 打开/切换编辑对象时（重）装表单 */
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.courseName);
      setTeacher(editing.teacher ?? "");
      setLocation(editing.location ?? "");
      setDay(editing.dayOfWeek);
      setWeeks(editing.weeks);
      setPBegin(editing.startSection);
      setPEnd(editing.endSection);
    } else {
      setName(""); setTeacher(""); setLocation(""); setDay(1); setWeeks([]); setPBegin(1); setPEnd(2);
    }
    setErr(null);
  }, [open, editId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Esc 关闭 */
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  if (!open) return null;

  const toggleWeek = (w: number) =>
    setWeeks((ws) => (ws.includes(w) ? ws.filter((x) => x !== w) : [...ws, w].sort((a, b) => a - b)));
  const allWeeks = Array.from({ length: weekCount }, (_, i) => i + 1);
  const setParity = (odd: boolean) =>
    setWeeks(allWeeks.filter((w) => (odd ? w % 2 === 1 : w % 2 === 0)));

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) { setErr("课程名称不能为空。"); return; }
    if (pEnd < pBegin) { setErr("结束节次不能早于开始节次。"); return; }
    if (hasSemester && weeks.length === 0) { setErr("请至少选择一个教学周。"); return; }
    const course: CustomCourse = {
      id: editing?.id ?? newId(),
      courseName: trimmed,
      teacher: teacher.trim() || undefined,
      location: location.trim() || undefined,
      dayOfWeek: day,
      weeks: hasSemester ? weeks : allWeeks,
      startSection: pBegin,
      endSection: pEnd,
      semesterId: "",
    };
    onSave(editing ? list.map((c) => (c.id === editing.id ? course : c)) : [...list, course]);
    onClose();
  };

  return createPortal(
    <div style={ccMask} onClick={onClose}>
      <div style={ccPanel} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--border, #eee)" }}>
          <b>{editing ? "编辑课程" : "添加课程"}</b>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: "4px 16px 16px", overflowY: "auto", fontSize: 13, lineHeight: 1.6 }}>
          {/* 已有列表 */}
          {list.length > 0 ? (
            <div style={{ margin: "10px 0 4px" }}>
              <div style={ccLabel}>已添加（{list.length}）</div>
              {list.map((c) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid var(--border, #f0f0f0)" }}>
                  <button className="btn" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => setEditId(editId === c.id ? null : c.id)}>
                    {editId === c.id ? "收起" : "编辑"}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b>{c.courseName}</b>
                    <span style={{ color: "var(--text-3, #9aa1ac)", fontSize: 12 }}>
                      {c.location ? ` @${c.location}` : ""} · {DAY_NAMES[c.dayOfWeek - 1]} 第{c.startSection}-{c.endSection}节 · {describeWeeks(c.weeks)}
                    </span>
                  </div>
                  <button
                    className="btn"
                    style={{ color: "#e5484d", padding: "2px 8px", fontSize: 12 }}
                    onClick={() => { if (confirm(`删除「${c.courseName}」？`)) onSave(list.filter((x) => x.id !== c.id)); }}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {/* 表单 */}
          <label style={ccLabel}>课程名称 *</label>
          <input className="input" style={{ width: "100%" }} value={name} onChange={(e) => setName(e.target.value)} placeholder="如：高等数学（旁听）/ 体锻 / 自习安排" />

          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={ccLabel}>教师（可选）</label>
              <input className="input" style={{ width: "100%" }} value={teacher} onChange={(e) => setTeacher(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={ccLabel}>地点（可选）</label>
              <input className="input" style={{ width: "100%" }} value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
          </div>

          <label style={ccLabel}>星期</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {DAY_NAMES.map((n, i) => (
              <div key={n} style={{ ...ccChip(day === i + 1), flex: 1, minWidth: 52 }} onClick={() => setDay(i + 1)}>{n}</div>
            ))}
          </div>

          <label style={ccLabel}>节次</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select className="input" value={pBegin} onChange={(e) => setPBegin(Number(e.target.value))}>
              {allSections().map((s) => <option key={s} value={s}>第 {s} 节 {BEGIN_TIME[s]}</option>)}
            </select>
            <span>至</span>
            <select className="input" value={pEnd} onChange={(e) => setPEnd(Number(e.target.value))}>
              {allSections().map((s) => <option key={s} value={s}>第 {s} 节 {END_TIME[s]}</option>)}
            </select>
          </div>

          {hasSemester ? (
            <>
              <label style={ccLabel}>教学周（点击切换）</label>
              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                <button className="btn" style={{ fontSize: 12, padding: "2px 8px" }} onClick={() => setWeeks(allWeeks)}>全部</button>
                <button className="btn" style={{ fontSize: 12, padding: "2px 8px" }} onClick={() => setParity(true)}>单周</button>
                <button className="btn" style={{ fontSize: 12, padding: "2px 8px" }} onClick={() => setParity(false)}>双周</button>
                <button className="btn" style={{ fontSize: 12, padding: "2px 8px" }} onClick={() => setWeeks([])}>清空</button>
              </div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {allWeeks.map((w) => (
                  <div key={w} style={ccChip(weeks.includes(w))} onClick={() => toggleWeek(w)}>{w}</div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ ...ccLabel, marginBottom: 0 }}>校历不可用：课程将固定显示在每周课表（仅本地）。</div>
          )}

          {err ? <div style={{ color: "#e5484d", fontSize: 12, marginTop: 8 }}>{err}</div> : null}

          <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
            {editing ? <button className="btn" onClick={() => setEditId(null)}>取消编辑</button> : null}
            <button className="btn btn-primary" onClick={submit}>{editing ? "保存修改" : "添加"}</button>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-3, #9aa1ac)", marginTop: 8 }}>
            自定义课程仅保存在本机（不写入教务系统），课表中以虚线描边标识。
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 1-14 节序列（BEGIN_TIME/END_TIME 首位为占位空串） */
function allSections(): number[] {
  return BEGIN_TIME.slice(1).map((_, i) => i + 1);
}
