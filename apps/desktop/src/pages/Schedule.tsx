/**
 * 日程页 —— 时间轴（周网格，课表+云/本日程，24h）与列表（月历+所选日清单）。
 * 日期模型：单一 anchor 任意日期，不受学期边界限制（1970 起）；
 * 时间轴取 anchor 所在周、列表取 anchor 所在月；筛选器自绘（无原生日期控件）。
 * 共用层：同步云日历 / 课表上云 / 存入系统日历 / 添加日程 / 事件编辑器。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { PageAtomStar } from "../components/Collect.js";
import { Card, Empty, ErrorNote, PageHead } from "../components/Layout.js";
import { IconRefresh } from "../components/Icons.js";
import { useCalendar, useCampusData } from "../state/data.js";
import { ScheduleAgenda } from "./ScheduleAgenda.js";
import type { AgendaItem } from "./ScheduleAgenda.js";
import { caldav } from "@onethu/core";
import type { ScheduleEntry } from "@onethu/core";
import {
  useCloudCal, syncCloudCal, getCloudCalConfig,
  putCloudEvent, deleteCloudEvent, putLocalEvent, deleteLocalEvent, exportSemesterToCloud, buildSemesterEvents,
} from "../state/cloudCal.js";
import { info } from "../lib/clients.js";
import { useApp } from "../state/context.js";
import { confirmOk } from "../lib/confirm.js";
import { openPath } from "@tauri-apps/plugin-opener";

const DAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
/** 上游 schedule.tsx beginTime/endTime（节次兜底定位用） */
const BEGIN_TIME = ["", "08:00", "08:50", "09:50", "10:40", "11:30", "13:30", "14:20", "15:20", "16:10", "17:05", "17:55", "19:20", "20:10", "21:00"];
const END_TIME = ["", "08:45", "09:35", "10:35", "11:25", "12:15", "14:15", "15:05", "16:05", "16:55", "17:50", "18:40", "20:05", "20:55", "21:45"];
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const BEGIN_MIN = BEGIN_TIME.map(toMin);
const END_MIN = END_TIME.map(toMin);
/** 24 小时全轴 */
const PX_PER_MIN = 0.52;
const AXIS_BEGIN = 0;
const AXIS_END = 24 * 60;
const y = (min: number) => (min - AXIS_BEGIN) * PX_PER_MIN;
/** "HH:MM" → 距 0:00 分钟（非法/缺省返回 null） */
const hmToMin = (t?: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/* ---------- 日期工具 ---------- */
const padN = (n: number): string => String(n).padStart(2, "0");
const ymdOf = (d: Date): string => `${d.getFullYear()}-${padN(d.getMonth() + 1)}-${padN(d.getDate())}`;
const parseYmd = (s: string): Date => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const mondayOf = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
const MIN_ANCHOR = new Date(1970, 0, 5);
const MAX_ANCHOR = new Date(2099, 11, 28);

/** 网格条目（课表条目 + 云/本日程事件） */
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
  /** 云/本事件可编辑定位 */
  uid?: string;
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

/** 定位分钟：kssj/jssj 真实时刻优先，节次仅兜底 */
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
      const b = Math.max(0, Math.min(beginMinOf(s), AXIS_END - 20));
      const e = Math.max(b + 20, Math.min(endMinOf(s), AXIS_END));
      let lane = laneEnds.findIndex((t) => t <= b);
      if (lane < 0) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = Math.max(laneEnds[lane] ?? 0, e);
      const lanes = lane + 1; // 简化：块渲染时用当前最大道数
      placed.push({ entry: s, day, beginMin: b, endMin: e, lane, lanes, color: s.src ? SRC_COLOR[s.src] : colorOf(s.courseName) });
    }
    // 道数回填（同日所有块共享最终 lanes，宽度一致）
    const finalLanes = Math.max(1, ...placed.filter((p) => p.day === day).map((p) => p.lane + 1));
    for (const p of placed) if (p.day === day) p.lanes = finalLanes;
  }
  return placed;
}

/* ---------- 学期检测 ---------- */
interface SemInfo { semesterId: string; semesterName?: string; firstDay: string; weekCount: number }
/** anchor 落在哪个学期的第几周（返回 null = 学期外/假期） */
function detectSemester(d: Date, list: SemInfo[]): { sem: SemInfo; weekNo: number } | null {
  for (const s of list) {
    const start = parseYmd(s.firstDay);
    if (Number.isNaN(start.getTime())) continue;
    const end = start.getTime() + s.weekCount * 7 * 86_400_000;
    if (d.getTime() >= start.getTime() && d.getTime() < end) {
      return { sem: s, weekNo: Math.floor((d.getTime() - start.getTime()) / (7 * 86_400_000)) + 1 };
    }
  }
  return null;
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

export function SchedulePage() {
  const campus = useCampusData();
  const calendar = useCalendar();
  const cal = useCloudCal();
  const { status } = useApp();

  // 每次打开日程页自动云同步一次（失败静默——工具栏有手动入口与状态）
  useEffect(() => {
    if (getCloudCalConfig()) void syncCloudCal().catch(() => undefined);
  }, []);

  /** 视图模式：时间轴（周网格 24h）/ 列表（月历+所选日清单） */
  const [mode, setMode] = useState<"timetable" | "agenda">("timetable");
  /** 日期锚点：任意日期，导航无边界（1970–2099） */
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [selected, setSelected] = useState<string>(ymdOf(new Date()));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [detail, setDetail] = useState<GridEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [exporting, setExporting] = useState<{ phase: string; done: number; total: number } | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const semesters: SemInfo[] = useMemo(
    () => (calendar.data ? [{ ...calendar.data }, ...calendar.data.nextSemesterList] : []),
    [calendar.data],
  );
  /** anchor 自动检测：哪一年哪个学期第几周 */
  const detected = useMemo(() => detectSemester(anchor, semesters), [anchor, semesters]);
  /** 课表上云的目标学期：检测到的优先，否则当前学期 */
  const exportSemester = detected?.sem ?? calendar.data ?? null;

  /* ---------- 视图窗口 ---------- */
  const weekStart = useMemo(() => mondayOf(anchor), [anchor]);
  const viewWindow = useMemo((): [Date, Date] => {
    if (mode === "timetable") return [weekStart, new Date(weekStart.getTime() + 6 * 86_400_000)];
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    return [first, new Date(first.getFullYear(), first.getMonth() + 1, 0)];
  }, [mode, anchor, weekStart]);

  /* ---------- 时间轴数据：日期窗取数（不再依赖学期内） ---------- */
  const [windowRows, setWindowRows] = useState<ScheduleEntry[] | null>(null);
  const [winLoading, setWinLoading] = useState(false);
  const [winError, setWinError] = useState<string | null>(null);
  const windowKey = `${ymdOf(viewWindow[0])}_${ymdOf(viewWindow[1])}`;
  useEffect(() => {
    if (mode !== "timetable" || status === "demo") return; // 列表自取月窗；demo 退 campus 数据
    let alive = true;
    setWinLoading(true);
    setWinError(null);
    info
      .getSchedule(ymdOf(viewWindow[0]), ymdOf(viewWindow[1]))
      .then((rows) => {
        if (alive) setWindowRows(rows);
      })
      .catch((err) => {
        if (alive) {
          setWindowRows([]);
          setWinError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (alive) setWinLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [mode, windowKey, reloadTick, status]);

  const hmOfMs = (ms: number): string => {
    const w = caldav.epochToWall("Asia/Shanghai", ms);
    return `${padN(w.h)}:${padN(w.mi)}`;
  };
  /** 时间轴条目 = 日期窗课程（考试标红）+ 云/本日程展开（全天走芯片行） */
  const { entries, allDayChips } = useMemo<{ entries: GridEntry[]; allDayChips: Array<{ label: string; src: "cloud" | "local"; uid?: string }> }>(() => {
    const [loD, hiD] = viewWindow;
    const lo = new Date(loD.getFullYear(), loD.getMonth(), loD.getDate()).getTime();
    const hi = new Date(hiD.getFullYear(), hiD.getMonth(), hiD.getDate()).getTime() + 86_399_999;
    const raw = (windowRows ?? campus.data?.schedule ?? []) as Array<GridEntry & { category?: string }>;
    const inWeek: GridEntry[] = raw
      .map((e) => ({ ...e, src: e.category?.includes("考试") ? ("exam" as const) : e.src }))
      .filter((e) => {
        if (!e.date) return true;
        const t = parseYmd(e.date).getTime();
        return t >= lo && t <= hi;
      });
    const chips: Array<{ label: string; src: "cloud" | "local"; uid?: string }> = [];
    const WD_INDEX = (ms: number): number => {
      const w = caldav.epochToWall("Asia/Shanghai", ms);
      return (new Date(Date.UTC(w.y, w.mo - 1, w.d)).getUTCDay() + 6) % 7;
    };
    for (const [evts, src] of [[cal.cloudEvents, "cloud"], [cal.localEvents, "local"]] as const) {
      for (const o of caldav.expandEventSet(evts, lo, hi)) {
        if (o.allDay) {
          chips.push({ label: o.summary, src, uid: o.uid });
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
          uid: o.uid,
        });
      }
    }
    return { entries: inWeek, allDayChips: chips };
  }, [viewWindow, windowRows, campus.data, cal.cloudEvents, cal.localEvents]);

  const placed = useMemo(() => layout(entries), [entries]);

  /** 所选周 7 个日期（时间轴表头） */
  const dayDates = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart.getTime() + i * 86_400_000);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    });
  }, [weekStart]);
  const todayStr = ymdOf(new Date());
  const inCurrentWeek = useMemo(() => {
    const w = mondayOf(new Date());
    return ymdOf(w) === ymdOf(weekStart);
  }, [weekStart]);
  const todayIdx = useMemo(() => (new Date().getDay() + 6) % 7, []);
  const canvasH = y(AXIS_END) + 12;

  /** 半小时刻度序列（24h） */
  const halfHours = useMemo(() => {
    const out: number[] = [];
    for (let m = AXIS_BEGIN; m <= AXIS_END; m += 30) out.push(m);
    return out;
  }, []);

  /** 24h 轴自动定位：当前时刻（当前周）或 6:30 */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || mode !== "timetable") return;
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const target = inCurrentWeek ? Math.max(nowMin - 45, 0) : 6 * 60 + 30;
    el.scrollTop = Math.max(0, y(target) - 8);
  }, [mode, weekStart, inCurrentWeek]);

  /* ---------- 筛选器：自绘（无原生日期控件） ---------- */
  const clampAnchor = (d: Date): Date => (d < MIN_ANCHOR ? MIN_ANCHOR : d > MAX_ANCHOR ? MAX_ANCHOR : d);
  /** 日历快跳面板（两视图共用） */
  const [calOpen, setCalOpen] = useState(false);
  const [calView, setCalView] = useState<Date>(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  useEffect(() => {
    if (calOpen) setCalView(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  }, [calOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const calShift = (deltaMonths: number): void => {
    setCalView((v) => {
      const n = new Date(v.getFullYear(), v.getMonth() + deltaMonths, 1);
      return n < new Date(1970, 0, 1) ? new Date(1970, 0, 1) : n > new Date(2099, 11, 1) ? new Date(2099, 11, 1) : n;
    });
  };
  const pickDay = (d: Date): void => {
    setAnchor(clampAnchor(d));
    setSelected(ymdOf(d));
    setCalOpen(false);
  };
  /** 窗口步进：时间轴 ±周，列表 ±月 */
  const stepAnchor = (dir: 1 | -1): Date =>
    clampAnchor(mode === "timetable" ? new Date(anchor.getTime() + dir * 7 * 86_400_000) : new Date(anchor.getFullYear(), anchor.getMonth() + dir, 15));
  const [jumpSemIdx, setJumpSemIdx] = useState(0);
  const [jumpWeek, setJumpWeek] = useState(1);
  const jumpSem = semesters[Math.min(jumpSemIdx, Math.max(semesters.length - 1, 0))] ?? null;
  // 检测变化时同步跳转选择器默认值
  useEffect(() => {
    if (detected) {
      const i = semesters.findIndex((s) => s.semesterId === detected.sem.semesterId);
      if (i >= 0) {
        setJumpSemIdx(i);
        setJumpWeek(detected.weekNo);
      }
    }
  }, [detected?.sem.semesterId, detected?.weekNo, semesters]);
  const goSemWeek = (): void => {
    if (!jumpSem) return;
    const base = parseYmd(jumpSem.firstDay);
    setAnchor(clampAnchor(new Date(base.getTime() + ((jumpWeek - 1) * 7 + 2) * 86_400_000))); // 周三，稳落周内
  };

  /* ---------- 两视图共用：同步 / 课表上云 / 系统日历 / 事件编辑 ---------- */
  const canCloud = cal.configured;
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
    if (!exportSemester || exporting) return;
    const yes = await confirmOk(
      `把本学期课表与考试写入云日历？\n\n· 学期：${exportSemester.semesterName || exportSemester.semesterId}（${exportSemester.weekCount} 周，按日期逐场展开）\n· 之前由 OneTHU 写入的课表会被清理后重写\n· 写入后系统日历 / 其他设备（添加同一邮箱账号）即可见\n· 手动添加的日程不受影响`,
    );
    if (!yes) return;
    setExporting({ phase: "准备", done: 0, total: 0 });
    setMsg(null);
    try {
      const r = await exportSemesterToCloud(
        exportSemester,
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

  /** 一键存入系统日历：学期课表 + 云/本日程 → .ics 快照 → 系统导入 */
  const onSystemCal = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const events: caldav.IcsEvent[] = [...cal.cloudEvents, ...cal.localEvents];
      if (exportSemester) {
        const r = await buildSemesterEvents(exportSemester, (st, en) => info.getSchedule(st, en));
        events.push(...r.events);
      }
      if (events.length === 0) {
        setMsg("没有可导出的日程。");
        return;
      }
      const { invoke } = await import("@tauri-apps/api/core");
      const path = await invoke<string | null>("save_text_file", {
        filename: "OneTHU-日程.ics",
        contents: caldav.serializeCalendar(events),
      });
      if (!path) return; // 用户取消
      await openPath(path);
      setMsg(`已导出 ${events.length} 条日程，系统日历导入窗口应已打开（选择要写入的日历）。`);
    } catch (err) {
      setMsg(`导出失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };
  /** 系统日历长期自动同步指引（CalDAV 账户一次添加，双向实时） */
  const showAutoSyncGuide = async (): Promise<void> => {
    await confirmOk(
      "让系统日历自动同步（推荐，一次设置）\n\n在系统的日历 App 里添加清华邮箱账户：\n· macOS：日历 → 设置 → 账户 → 添加 CalDAV 账户 → 高级\n· iPhone/iPad：设置 → 日历 → 账户 → 添加账户 → 其他 → CalDAV 账户\n· 服务器地址：https://mails.tsinghua.edu.cn/coremail/dav/users/你的邮箱/\n· 用户名：完整邮箱；密码：客户端专用密码（与云同步设置里的一致）\n\n添加后系统日历与本应用读写的同一个云端日历自动保持一致，无需再导出。",
    );
  };

  const openEditByUid = (uid: string, kind: "cloud" | "local"): void => {
    const src = kind === "cloud" ? cal.cloudEvents.find((e) => e.uid === uid) : cal.localEvents.find((e) => e.uid === uid);
    if (!src) return;
    const w = caldav.epochToWall("Asia/Shanghai", src.start);
    const we = caldav.epochToWall("Asia/Shanghai", src.end);
    setDraft({
      uid: src.uid, title: src.summary, date: ymdOf(new Date(src.start)),
      start: `${padN(w.h)}:${padN(w.mi)}`, end: `${padN(we.h)}:${padN(we.mi)}`,
      allDay: !!src.allDay, location: src.location ?? "", note: src.description ?? "",
      toCloud: kind === "cloud", originalCloud: kind === "cloud",
    });
  };
  /** 列表行点击（云/本可编辑；课程/考试无 uid 不可编辑） */
  const onAgendaEdit = (it: AgendaItem): void => {
    if (it.uid && (it.kind === "cloud" || it.kind === "local")) openEditByUid(it.uid, it.kind);
  };
  /** 时间轴块点击：云/本 → 编辑器；课程/考试 → 只读详情 */
  const onBlockClick = (e: GridEntry): void => {
    if ((e.src === "cloud" || e.src === "local") && e.uid) openEditByUid(e.uid, e.src);
    else setDetail(e);
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

  /** 新建默认日期：列表=所选日；时间轴=今天（在周内）否则周一 */
  const defaultDraftDate = mode === "agenda" ? selected : inCurrentWeek ? todayStr : ymdOf(weekStart);

  const label =
    mode === "timetable"
      ? `${weekStart.getMonth() + 1}月${weekStart.getDate()}日 – ${new Date(weekStart.getTime() + 6 * 86_400_000).getDate()}日`
      : `${anchor.getFullYear()} 年 ${anchor.getMonth() + 1} 月`;

  return (
    <>
      <PageHead
        title="日程"
        meta={
          mode === "timetable"
            ? `${label}${detected ? ` · ${detected.sem.semesterName || detected.sem.semesterId} 第 ${detected.weekNo} 周` : " · 假期（学期外）"}`
            : `${label}${detected ? ` · ${detected.sem.semesterName || detected.sem.semesterId} 第 ${detected.weekNo} 周` : ""}`
        }
        actions={
          <>
            <PageAtomStar atomKey="schedule" title="日程" />
            {(mode === "timetable" && !inCurrentWeek) || (mode === "agenda" && ymdOf(new Date()).slice(0, 7) !== ymdOf(anchor).slice(0, 7)) ? (
              <button className="btn" onClick={() => { setAnchor(new Date()); setSelected(todayStr); }}>
                回到今天
              </button>
            ) : null}
            <button
              className="btn"
              onClick={() => {
                setReloadTick((t) => t + 1);
                if (!calendar.data) void calendar.reload();
                else void campus.reload();
              }}
              disabled={winLoading}
            >
              <IconRefresh width={14} height={14} />
              刷新
            </button>
          </>
        }
      />

      {/* 视图切换 + 同步：两视图共用 */}
      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        {([["timetable", "时间轴"], ["agenda", "列表"]] as const).map(([m, lbl]) => (
          <button
            key={m}
            className={mode === m ? "btn btn-primary" : "btn"}
            style={mode === m ? undefined : { opacity: 0.75 }}
            onClick={() => setMode(m)}
          >
            {lbl}
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
        {canCloud && exportSemester ? (
          <button className="btn" onClick={() => void onExport()} disabled={!!exporting}>
            {exporting ? `${exporting.phase} ${exporting.done}/${exporting.total}` : "课表上云"}
          </button>
        ) : null}
        <button className="btn" onClick={() => void onSystemCal()} disabled={busy}>
          存入系统日历
        </button>
        <button className="btn" style={{ padding: "2px 8px" }} title="如何让系统日历自动同步" onClick={() => void showAutoSyncGuide()}>
          ？
        </button>
        <button className="btn btn-primary" onClick={() => setDraft(emptyDraft(defaultDraftDate, canCloud))}>
          ＋ 添加日程
        </button>
      </div>
      {msg ? (
        <div style={{ fontSize: 12.5, color: "var(--text-2)", marginBottom: 8, whiteSpace: "pre-wrap" }}>{msg}</div>
      ) : null}

      {/* 共用工具栏：窗口导航 + 日历快跳 + 学期周跳转（两视图同一套） */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: calOpen ? 8 : 10 }}>
        <button className="btn" onClick={() => setCalOpen((v) => !v)} title="打开日历，快速跳到任意年月">
          📅 {label}
        </button>
        <button className="btn" onClick={() => setAnchor(stepAnchor(-1))} title={mode === "timetable" ? "上一周" : "上个月"}>
          ‹
        </button>
        <button className="btn" onClick={() => setAnchor(stepAnchor(1))} title={mode === "timetable" ? "下一周" : "下个月"}>
          ›
        </button>
        <button className="btn" onClick={() => { setAnchor(new Date()); setSelected(todayStr); }}>
          今天
        </button>
        {semesters.length > 0 ? (
          <>
            <span style={{ flex: 1 }} />
            <select
              className="input"
              value={Math.min(jumpSemIdx, semesters.length - 1)}
              onChange={(e) => {
                const i = Number(e.target.value);
                setJumpSemIdx(i);
                setJumpWeek((w) => Math.min(w, semesters[i]?.weekCount ?? w));
              }}
              style={{ maxWidth: 200 }}
            >
              {semesters.map((sm, i) => (
                <option key={sm.semesterId || i} value={i}>
                  {sm.semesterName || sm.semesterId || `学期 ${i + 1}`}
                </option>
              ))}
            </select>
            <select className="input" value={jumpWeek} onChange={(e) => setJumpWeek(Number(e.target.value))} style={{ width: 80 }}>
              {Array.from({ length: jumpSem?.weekCount ?? 20 }, (_, i) => i + 1).map((w) => (
                <option key={w} value={w}>
                  第 {w} 周
                </option>
              ))}
            </select>
            <button className="btn" onClick={goSemWeek}>
              前往
            </button>
          </>
        ) : null}
      </div>

      {/* 日历快跳面板（任意年月，两视图共用；选日即跳对应周/月） */}
      {calOpen ? (
        <Card style={{ padding: 12, marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
            <button className="btn" title="上一年" onClick={() => calShift(-12)}>«</button>
            <button className="btn" title="上一月" onClick={() => calShift(-1)}>‹</button>
            <span style={{ fontWeight: 600, fontSize: 13.5, minWidth: 120, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
              {calView.getFullYear()} 年 {calView.getMonth() + 1} 月
            </span>
            <button className="btn" title="下一月" onClick={() => calShift(1)}>›</button>
            <button className="btn" title="下一年" onClick={() => calShift(12)}>»</button>
            <span style={{ flex: 1 }} />
            <button className="btn" onClick={() => setCalView(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>本月</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, textAlign: "center" }}>
            {DAY_NAMES.map((n) => (
              <div key={n} style={{ fontSize: 11, color: "var(--text-3, #999)", padding: "2px 0" }}>{n[1] ?? n}</div>
            ))}
            {(() => {
              const first = new Date(calView.getFullYear(), calView.getMonth(), 1);
              const lead = (first.getDay() + 6) % 7;
              const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
              const cells: Array<Date | null> = [];
              for (let i = 0; i < lead; i++) cells.push(null);
              for (let d = 1; d <= days; d++) cells.push(new Date(first.getFullYear(), first.getMonth(), d));
              return cells.map((d, i) =>
                d ? (
                  <button
                    key={d.toISOString()}
                    onClick={() => pickDay(d)}
                    style={{
                      border: "none", borderRadius: 7, padding: "5px 0", cursor: "pointer", fontSize: 12.5,
                      background: ymdOf(d) === todayStr ? "rgba(109,127,240,0.14)" : "transparent",
                      fontWeight: ymdOf(d) === todayStr ? 700 : 400,
                      color: ymdOf(d) === todayStr ? "var(--accent, #6d7ff0)" : "inherit",
                    }}
                  >
                    {d.getDate()}
                  </button>
                ) : (
                  <div key={`pad-${i}`} />
                ),
              );
            })()}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-3, #999)", marginTop: 8, textAlign: "center" }}>
            {mode === "timetable" ? "选择日期将跳到该日期所在的教学周" : "选择日期将跳到该日期所在月份"}
          </div>
        </Card>
      ) : null}

      {winError && mode === "timetable" ? (
        <ErrorNote text={`本周课程取数失败（日程仍显示）：${winError}`} onRetry={() => setReloadTick((t) => t + 1)} />
      ) : null}
      {calendar.state === "error" ? (
        <ErrorNote text={`校历加载失败（学期检测/跳转不可用）：${calendar.error ?? ""}`} onRetry={() => void calendar.reload()} />
      ) : null}

      {mode === "agenda" ? (
        <ScheduleAgenda
          courses={campus.data?.schedule ?? []}
          monthAnchor={new Date(anchor.getFullYear(), anchor.getMonth(), 1)}
          onMonthAnchor={(d) => setAnchor(d)}
          selected={selected}
          onSelect={setSelected}
          onEdit={onAgendaEdit}
        />
      ) : (
        <>
          {allDayChips.length > 0 ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {allDayChips.slice(0, 8).map((c, i) => (
                <button
                  key={i}
                  onClick={() => c.uid && onBlockClick({ courseName: c.label, src: c.src, uid: c.uid })}
                  style={{ fontSize: 11.5, padding: "2px 8px", borderRadius: 6, border: "none", cursor: c.uid ? "pointer" : "default", background: c.src === "cloud" ? "rgba(31,164,135,0.12)" : "rgba(138,143,152,0.14)", color: SRC_COLOR[c.src] }}
                >
                  全天 · {c.label}
                </button>
              ))}
            </div>
          ) : null}
          {winLoading && entries.length === 0 ? (
            <Empty text="正在从教务系统取数…" />
          ) : entries.length === 0 ? (
            <Card><Empty text="这一周没有排课与日程记录。" /></Card>
          ) : (
            <div ref={scrollRef} style={{ maxHeight: 640, overflowY: "auto" }}>
              <Card style={{ padding: 14, overflowX: "auto" }}>
                <div style={{ minWidth: 0 }}>
                  {/* 表头：星期 + 日期（今天高亮） */}
                  <div style={{ display: "flex", marginBottom: 10, alignItems: "flex-end" }}>
                    <div style={{ width: 34, flexShrink: 0 }} />
                    {DAY_NAMES.map((name, i) => (
                      <div
                        key={name}
                        className={"tt-head" + (inCurrentWeek && i === todayIdx ? " is-today" : "")}
                        style={{ flex: 1, textAlign: "center" }}
                      >
                        {name}
                        <span style={{ fontWeight: 400, marginLeft: 4 }}>{dayDates[i]}</span>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "flex" }}>
                    {/* 时间刻度列：24h 整点 */}
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
                            {m === AXIS_END ? "24:00" : hhmm(m)}
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
                            background: inCurrentWeek && day === todayIdx ? "rgba(109,127,240,0.055)" : undefined,
                          }}
                        />
                      ))}
                      {/* 半小时横线（整点略深；夜间更淡） */}
                      {halfHours.map((m) => (
                        <div
                          key={`gl-${m}`}
                          style={{
                            position: "absolute",
                            left: 0,
                            right: 0,
                            top: y(m),
                            borderTop:
                              m % 60 === 0
                                ? "1px solid var(--border, #e8e8e8)"
                                : m < 6 * 60 || m >= 23 * 60
                                  ? "1px solid var(--border, #f5f5f5)"
                                  : "1px solid var(--border, #f2f2f2)",
                          }}
                        />
                      ))}
                      {/* 当前时刻红线（当前周） */}
                      {inCurrentWeek
                        ? (() => {
                            const nm = new Date().getHours() * 60 + new Date().getMinutes();
                            if (nm > AXIS_END) return null;
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
                        : null}
                      {/* 事件块（可点击） */}
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
                            }（${hhmm(p.beginMin)}–${hhmm(p.endMin)}）${p.entry.src === "cloud" || p.entry.src === "local" ? " · 点击编辑" : " · 点击查看"}`}
                            onClick={() => onBlockClick(p.entry)}
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
                              cursor: "pointer",
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
            </div>
          )}
        </>
      )}

      {/* 只读详情（课程/考试：来自教务，不可在此修改） */}
      {detail ? (
        <Card style={{ padding: 14, marginTop: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>
            {detail.src === "exam" ? "考试详情" : "课程详情"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "64px 1fr", rowGap: 6, fontSize: 13, color: "var(--text-1, #222)" }}>
            <span style={{ color: "var(--text-3, #999)" }}>名称</span>
            <span style={{ fontWeight: 600 }}>{detail.courseName}</span>
            <span style={{ color: "var(--text-3, #999)" }}>时间</span>
            <span>
              {detail.date} {detail.startTime && detail.endTime ? `${detail.startTime}–${detail.endTime}` : detail.startSection ? `第 ${detail.startSection}–${detail.endSection ?? detail.startSection} 节` : ""}
            </span>
            {detail.location ? (
              <>
                <span style={{ color: "var(--text-3, #999)" }}>地点</span>
                <span>{detail.location}</span>
              </>
            ) : null}
            {detail.teacher ? (
              <>
                <span style={{ color: "var(--text-3, #999)" }}>教师</span>
                <span>{detail.teacher}</span>
              </>
            ) : null}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-3, #999)", margin: "10px 0 4px" }}>
            课程与考试来自教务系统数据，不能在此修改。
          </div>
          <button className="btn" onClick={() => setDetail(null)}>关闭</button>
        </Card>
      ) : null}

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
