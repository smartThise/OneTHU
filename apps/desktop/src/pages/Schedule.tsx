import { useEffect, useMemo, useRef, useState } from "react";
import { PageAtomStar } from "..//components/Collect.js";
import { Card, Empty, ErrorNote, PageHead } from "../components/Layout.js";
import { IconRefresh } from "../components/Icons.js";
import { useCalendar, useCampusData, useWeekSchedule } from "../state/data.js";
import { ScheduleAgenda } from "./ScheduleAgenda.js";
import { caldav } from "@onethu/core";
import {
  useCloudCal, syncCloudCal, getCloudCalConfig,
  putCloudEvent, deleteCloudEvent, putLocalEvent, deleteLocalEvent, exportSemesterToCloud,
} from "../state/cloudCal.js";
import { info } from "../lib/clients.js";
import { confirmOk } from "../lib/confirm.js";
import type { AgendaItem } from "./ScheduleAgenda.js";

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

/** 网格条目的最小形状（课表条目 + 云/本日程事件） */
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
  /** 来源（课程缺省=palette；考试/云/本固定色） */
  src?: "exam" | "cloud" | "local";
}

/** 来源固定色（与日程列表口径一致） */
const SRC_COLOR: Record<"exam" | "cloud" | "local", string> = { exam: "#e5484d", cloud: "#1fa487", local: "#8a8f98" };

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
      // 云/本事件可落在时间轴（8:00–21:45）之外：夹取进轴，保证可见不画飞
      const b = Math.max(AXIS_BEGIN, Math.min(beginMinOf(s), AXIS_END - 30));
      const e = Math.max(b + 20, Math.min(endMinOf(s), AXIS_END));
      let lane = laneEnds.findIndex((le) => le <= b);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(e);
      } else {
        laneEnds[lane] = e;
      }
      placed.push({ entry: s, day, beginMin: b, endMin: e, lane, lanes: 1, color: s.src ? SRC_COLOR[s.src] : colorOf(s.courseName) });
    }
    for (const p of placed) if (p.day === day) p.lanes = laneEnds.length;
  }
  return placed;
}

/* ---------- 事件编辑器草稿（页面级：两视图共用的底部编辑卡） ---------- */
interface Draft {
  uid?: string;
  title: string;
  date: string; // YYYY-MM-DD
  start: string; // HH:MM
  end: string; // HH:MM
  allDay: boolean;
  location: string;
  note: string;
  toCloud: boolean;
  originalCloud: boolean; // 编辑中的是云端事件
}
const emptyDraft = (date: string, canCloud: boolean): Draft => ({
  title: "", date, start: "08:00", end: "09:35", allDay: false, location: "", note: "",
  toCloud: canCloud, originalCloud: false,
});
const padN = (n: number): string => String(n).padStart(2, "0");
const ymdOf = (d: Date): string => `${d.getFullYear()}-${padN(d.getMonth() + 1)}-${padN(d.getDate())}`;

export function SchedulePage() {
  const campus = useCampusData();
  const calendar = useCalendar();
  const cal = useCloudCal();

  // 每次打开日程页自动云同步一次（页面级挂载；失败静默——列表页有手动入口与状态）
  useEffect(() => {
    if (getCloudCalConfig()) void syncCloudCal().catch(() => undefined);
  }, []);
  const semesters = useMemo(
    () => (calendar.data ? [{ ...calendar.data }, ...calendar.data.nextSemesterList] : []),
    [calendar.data],
  );
  const [semesterIdx, setSemesterIdx] = useState(0);
  const [weekNo, setWeekNo] = useState(1);
  /** 视图模式：时间轴（周网格，课表+云事件）/ 列表（月历+所选日清单） */
  const [mode, setMode] = useState<"timetable" | "agenda">("timetable");
  // 页面级共享状态：列表视图的月锚点/所选日 + 编辑器 + 反馈
  const [monthAnchor, setMonthAnchor] = useState<Date>(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selected, setSelected] = useState<string>(ymdOf(new Date()));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [exporting, setExporting] = useState<{ phase: string; done: number; total: number } | null>(null);
  const semester = semesters[Math.min(semesterIdx, Math.max(semesters.length - 1, 0))] ?? null;

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
  const hmOfMs = (ms: number): string => {
    const w = caldav.epochToWall("Asia/Shanghai", ms);
    return `${padN(w.h)}:${padN(w.mi)}`;
  };
  /** 展示周的一周日期窗（校历周 or 本周） */
  const weekWindow = useMemo(() => {
    if (semester) {
      const base = new Date(semester.firstDay.replace(/-/g, "/"));
      const monday = new Date(base.getTime() + (weekNo - 1) * 7 * 86400000);
      return [monday, new Date(monday.getTime() + 6 * 86400000)] as const;
    }
    const n = new Date();
    const monday = new Date(n.getFullYear(), n.getMonth(), n.getDate() - ((n.getDay() + 6) % 7));
    return [monday, new Date(monday.getTime() + 6 * 86400000)] as const;
  }, [semester?.firstDay, weekNo]);
  /**
   * 时间轴数据 = 课表（周窗过滤，考试标红）+ 云/本日程事件（展开进对应日列，
   * 按绝对时刻定位分道）。全天事件不入网格，走上方芯片行。
   */
  const { entries, allDayChips } = useMemo<{ entries: GridEntry[]; allDayChips: Array<{ label: string; src: "cloud" | "local" }> }>(() => {
    const raw = (semester ? weekData.data ?? [] : campus.data?.schedule ?? []) as Array<GridEntry & { category?: string }>;
    const dayFloor = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const [monday, sunday] = weekWindow;
    const lo = dayFloor(monday);
    const hi = dayFloor(sunday) + 86_399_999;
    const inWeek: GridEntry[] = raw
      .map((e) => ({ ...e, src: e.category?.includes("考试") ? ("exam" as const) : e.src }))
      .filter((e) => {
        if (!e.date) return true; // 无日期条目（个别自定义）不过滤
        const t = dayFloor(new Date(e.date.replace(/-/g, "/")));
        return t >= lo && t <= hi;
      });
    const chips: Array<{ label: string; src: "cloud" | "local" }> = [];
    const WD_INDEX = (ms: number): number => {
      const w = caldav.epochToWall("Asia/Shanghai", ms);
      return (new Date(Date.UTC(w.y, w.mo - 1, w.d)).getUTCDay() + 6) % 7;
    };
    for (const [evts, src] of [[cal.cloudEvents, "cloud"], [cal.localEvents, "local"]] as const) {
      for (const o of caldav.expandEventSet(evts, lo, hi)) {
        if (o.allDay) {
          chips.push({ label: o.summary, src });
          continue;
        }
        inWeek.push({
          courseName: o.summary,
          location: o.location,
          date: ymdOf(new Date(o.start)),
          dayOfWeek: WD_INDEX(o.start) + 1,
          startTime: hmOfMs(o.start),
          endTime: hmOfMs(o.end),
          src,
        });
      }
    }
    return { entries: inWeek, allDayChips: chips };
  }, [semester, weekData.data, campus.data, weekWindow, cal.cloudEvents, cal.localEvents]);

  const todayIdx = useMemo(() => {
    const d = new Date().getDay();
    return d === 0 ? 6 : d - 1;
  }, []);

  /** 是否正在看当前周（回本周按钮显隐 + 红线显隐） */
  const isCurrentWeek = semester ? weekNo === currentWeek : true;

  const placed = useMemo(() => layout(entries), [entries]);

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

  /* ---------- 两视图共用：同步 / 课表上云 / 事件编辑 ---------- */
  const canCloud = cal.configured;
  const semesterInfo = calendar.data ? { firstDay: calendar.data.firstDay, weekCount: calendar.data.weekCount } : null;

  // 学期切换（列表模式）：月历跳到该学期首月
  const lastSemId = useRef<string | null>(null);
  useEffect(() => {
    const id = semester?.semesterId ?? null;
    if (lastSemId.current !== null && lastSemId.current !== id && mode === "agenda" && semester) {
      const base = new Date(semester.firstDay.replace(/-/g, "/"));
      setMonthAnchor(new Date(base.getFullYear(), base.getMonth(), 1));
    }
    lastSemId.current = id;
  }, [semester?.semesterId, mode, semester]);

  const lastSyncText = cal.lastSyncAt ? `上次同步 ${new Date(cal.lastSyncAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : "未同步过";

  const onSync = async (): Promise<void> => {
    setMsg(null);
    try {
      const r = await syncCloudCal();
      setMsg(`已同步：云端共 ${r.total} 个日程（新增 ${r.added}、更新 ${r.updated}、移除 ${r.removed}）。`);
    } catch (err) {
      setMsg(`同步失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const onExport = async (): Promise<void> => {
    if (!semesterInfo || exporting) return;
    const yes = await confirmOk(
      `把本学期课表与考试写入云日历？\n\n· 写入 ${semesterInfo.weekCount} 周的全部课程（按日期逐场展开）\n· 之前由 OneTHU 写入的课表会被清理后重写（幂等）\n· 写入后系统日历 / 其他设备（添加同一邮箱账号）即可见\n· 手动添加的日程不受影响`,
    );
    if (!yes) return;
    setExporting({ phase: "准备", done: 0, total: 0 });
    setMsg(null);
    try {
      const r = await exportSemesterToCloud(
        semesterInfo,
        (st, en) => info.getSchedule(st, en),
        (done, total, phase) => setExporting({ phase, done, total }),
      );
      setMsg(`课表上云完成：写入 ${r.written} 场（清理旧 ${r.removed} 场${r.skipped ? `，跳过 ${r.skipped} 场` : ""}）。`);
    } catch (err) {
      setMsg(`课表上云失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(null);
    }
  };

  const openEditFromItem = (it: AgendaItem): void => {
    if (!it.uid) return;
    const src = it.kind === "cloud" ? cal.cloudEvents.find((e) => e.uid === it.uid) : cal.localEvents.find((e) => e.uid === it.uid);
    if (!src) return;
    const w = caldav.epochToWall("Asia/Shanghai", src.start);
    const we = caldav.epochToWall("Asia/Shanghai", src.end);
    setDraft({
      uid: src.uid, title: src.summary, date: ymdOf(new Date(src.start)),
      start: `${padN(w.h)}:${padN(w.mi)}`, end: `${padN(we.h)}:${padN(we.mi)}`,
      allDay: !!src.allDay, location: src.location ?? "", note: src.description ?? "",
      toCloud: it.kind === "cloud", originalCloud: it.kind === "cloud",
    });
  };

  const onSaveDraft = async (): Promise<void> => {
    if (!draft || !draft.title.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const d = new Date(Number(draft.date.slice(0, 4)), Number(draft.date.slice(5, 7)) - 1, Number(draft.date.slice(8, 10)));
      const [sh, sm] = draft.start.split(":").map(Number);
      const [eh, em] = draft.end.split(":").map(Number);
      const allDay = draft.allDay;
      const start = allDay ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() : new Date(d.getFullYear(), d.getMonth(), d.getDate(), sh ?? 0, sm ?? 0).getTime();
      let end = allDay ? start + 86_400_000 : new Date(d.getFullYear(), d.getMonth(), d.getDate(), eh ?? 23, em ?? 59).getTime();
      if (!allDay && end <= start) end = start + 45 * 60_000;
      const uid = draft.uid ?? `onethu-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@onethu`;
      const ev: caldav.IcsEvent = {
        uid, summary: draft.title.trim(), start, end, allDay,
        location: draft.location.trim() || undefined,
        description: draft.note.trim() || undefined,
        onethuSource: "manual",
      };
      // 跨集合移动（云↔本地）：先删原侧再写新侧
      if (draft.uid && draft.originalCloud && !draft.toCloud) await deleteCloudEvent(draft.uid);
      if (draft.uid && !draft.originalCloud && draft.toCloud) await deleteLocalEvent(draft.uid);
      if (draft.toCloud) await putCloudEvent(ev);
      else await putLocalEvent(ev);
      setDraft(null);
      setMsg("已保存。");
    } catch (err) {
      setMsg(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const onDeleteDraft = async (): Promise<void> => {
    if (!draft?.uid || busy) return;
    setBusy(true);
    try {
      if (draft.originalCloud) await deleteCloudEvent(draft.uid);
      else await deleteLocalEvent(draft.uid);
      setDraft(null);
      setMsg("已删除。");
    } catch (err) {
      setMsg(`删除失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead
        title="日程"
        meta={
          semester
            ? `${semester.semesterName || semester.semesterId} · 第 ${weekNo} 周 / 共 ${semester.weekCount} 周`
            : "本周 · 教务系统实时"
        }
        actions={
          <>
            <PageAtomStar atomKey="schedule" title="日程" />
            {semester && !isCurrentWeek ? (
              <button className="btn" onClick={() => setWeekNo(currentWeek)}>
                回到今天
              </button>
            ) : null}
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

      {/* 视图切换 + 同步：两视图共用 */}
      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        {([["timetable", "时间轴"], ["agenda", "列表"]] as const).map(([m, label]) => (
          <button
            key={m}
            className={mode === m ? "btn btn-primary" : "btn"}
            style={mode === m ? undefined : { opacity: 0.75 }}
            onClick={() => setMode(m)}
          >
            {label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => void onSync()} disabled={!canCloud || cal.syncing}>
          <IconRefresh width={14} height={14} />
          {cal.syncing ? "同步中…" : "同步云日历"}
        </button>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, fontSize: 12, color: "var(--text-2)", flexWrap: "wrap", alignItems: "center" }}>
        <span>{canCloud ? `${cal.email} · ${lastSyncText}` : "云同步未配置（设置页开启）"}</span>
        <span style={{ flex: 1 }} />
        {canCloud && semesterInfo ? (
          <button className="btn" onClick={() => void onExport()} disabled={!!exporting}>
            {exporting ? `${exporting.phase} ${exporting.done}/${exporting.total}` : "课表上云"}
          </button>
        ) : null}
        <button className="btn btn-primary" onClick={() => setDraft(emptyDraft(selected, canCloud))}>
          ＋ 添加日程
        </button>
      </div>
      {msg ? (
        <div style={{ fontSize: 12.5, color: "var(--text-2)", marginBottom: 8, whiteSpace: "pre-wrap" }}>{msg}</div>
      ) : null}

      {/* 学期切换：两视图共用（周导航仅时间轴） */}

      {mode === "agenda" ? (
        <ScheduleAgenda
          courses={campus.data?.schedule ?? []}
          monthAnchor={monthAnchor}
          onMonthAnchor={setMonthAnchor}
          selected={selected}
          onSelect={setSelected}
          onEdit={openEditFromItem}
        />
      ) : (
      <>
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

      {allDayChips.length > 0 ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {allDayChips.slice(0, 8).map((c, i) => (
            <span key={i} style={{ fontSize: 11.5, padding: "2px 8px", borderRadius: 6, background: c.src === "cloud" ? "rgba(31,164,135,0.12)" : "rgba(138,143,152,0.14)", color: SRC_COLOR[c.src] }}>
              全天 · {c.label}
            </span>
          ))}
        </div>
      ) : null}
      {loading ? (
        <Empty text="正在从教务系统取数…" />
      ) : entries.length === 0 ? (
        <Card><Empty text={semester ? `第 ${weekNo} 周没有排课记录（假期周）。` : "没有排课与日程记录。"} /></Card>
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
                      }（${hhmm(p.beginMin)}–${hhmm(p.endMin)}）`}
                      style={{
                        position: "absolute",
                        left: `calc(${leftPct}% + 3px)`,
                        width: `calc(${widthPct}% - 6px)`,
                        top,
                        height,
                        background: p.color,
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
      </>
      )}

      {/* 事件编辑器（页面级：两视图共用） */}
      {draft ? (
        <Card style={{ padding: 14, marginTop: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>{draft.uid ? "编辑日程" : "新建日程"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label style={{ gridColumn: "1 / -1", fontSize: 12, color: "var(--text-2)" }}>
              标题
              <input className="input" style={{ marginTop: 4, width: "100%" }} value={draft.title} placeholder="要做什么…" onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
            <label style={{ fontSize: 12, color: "var(--text-2)" }}>
              日期
              <input className="input" type="date" style={{ marginTop: 4, width: "100%" }} value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
            </label>
            <label style={{ fontSize: 12, color: "var(--text-2)", display: "flex", alignItems: "flex-end", gap: 6, paddingBottom: 6 }}>
              <input type="checkbox" checked={draft.allDay} onChange={(e) => setDraft({ ...draft, allDay: e.target.checked })} />
              全天
            </label>
            {!draft.allDay ? (
              <>
                <label style={{ fontSize: 12, color: "var(--text-2)" }}>
                  开始
                  <input className="input" type="time" style={{ marginTop: 4, width: "100%" }} value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
                </label>
                <label style={{ fontSize: 12, color: "var(--text-2)" }}>
                  结束
                  <input className="input" type="time" style={{ marginTop: 4, width: "100%" }} value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
                </label>
              </>
            ) : null}
            <label style={{ gridColumn: "1 / -1", fontSize: 12, color: "var(--text-2)" }}>
              地点
              <input className="input" style={{ marginTop: 4, width: "100%" }} value={draft.location} placeholder="可选" onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
            </label>
            <label style={{ gridColumn: "1 / -1", fontSize: 12, color: "var(--text-2)" }}>
              备注
              <input className="input" style={{ marginTop: 4, width: "100%" }} value={draft.note} placeholder="可选" onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
            </label>
          </div>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--text-2)", margin: "10px 0 2px" }}>
            <input type="checkbox" checked={draft.toCloud} disabled={!canCloud} onChange={(e) => setDraft({ ...draft, toCloud: e.target.checked })} />
            同步到云日历{canCloud ? "（其他设备 / 系统日历可见）" : "（未配置——设置页开启云同步）"}
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="btn btn-primary" disabled={!draft.title.trim() || busy} onClick={() => void onSaveDraft()}>
              {busy ? "保存中…" : "保存"}
            </button>
            <button className="btn" onClick={() => setDraft(null)}>取消</button>
            <span style={{ flex: 1 }} />
            {draft.uid ? (
              <button className="btn" style={{ color: "#e5484d" }} disabled={busy} onClick={() => void onDeleteDraft()}>
                删除
              </button>
            ) : null}
          </div>
        </Card>
      ) : null}
    </>
  );
}
