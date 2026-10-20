import { vaultCatchSchedule } from "../lib/vaultCatch.js";
import {
  Badge,
  Banner,
  Btn,
  Checkbox,
  Chip,
  Divider,
  Field,
  Grow,
  Inline,
  Input,
  KeyValue,
  List,
  Modal,
  Popover,
  Row,
  Select,
  Spacer,
  Stack,
  Surface,
  Tag,
  Text,
} from "@onethu/gui";
/**
 * 日程页 —— 时间轴（周网格，课表+云/本日程，24h）与列表（月历+所选日清单）。
 * 日期模型：单一 anchor 任意日期，不受学期边界限制（1970 起）；
 * 时间轴取 anchor 所在周、列表取 anchor 所在月；筛选器自绘（无原生日期控件）。
 * 共用层：同步云日历 / 课表上云 / 同步到系统日历（不支持平台退 .ics）/ 添加日程 / 事件编辑器。
 * UI：OneGUI（Modal/Popover/Chip/Checkbox/Field/Text/Surface/Divider/Banner），
 * 内联样式只保留几何定位、网格线令牌与课块数据色（lib/courseColor 口径）。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { openTab, useExplorerState } from "../state/explorer.js";
import { useIsSimpleLike } from "../state/experienceMode.js";
import { openHomeworkRow } from "../lib/homeworkEntry.js";
import type { Homework } from "@onethu/core";
import { PageAtomStar } from "../components/Collect.js";
import { Card, ErrorNote, PageHead } from "../components/Layout.js";
import { IconRefresh, IconSchedule } from "../components/Icons.js";
import { useCalendar, useCampusData } from "../state/data.js";
import { ignoredHwList } from "../state/hwIgnore.js";
import { useScheduleWindow, WINDOW_PRESETS, FULL_DAY, hhmm as hhmmWin } from "../state/scheduleWindow.js";
import { cacheSet } from "../state/cache.js";
import { isAuthError, learnUrls } from "@onethu/core";
import { softRecover } from "../lib/reload.js";
import { ScheduleAgenda } from "./ScheduleAgenda.js";
import type { AgendaItem } from "./ScheduleAgenda.js";
import { caldav } from "@onethu/core";
import type { ScheduleEntry } from "@onethu/core";
import { syncSystemCalendar, systemCalSupported } from "../state/systemCal.js";
import {
  useCloudCal, syncCloudCal, getCloudCalConfig,
  putCloudEvent, deleteCloudEvent, putLocalEvent, deleteLocalEvent, buildSemesterEvents,
} from "../state/cloudCal.js";
import { info, logLine } from "../lib/clients.js";
import { toHomework, useExternalHomework } from "../state/exthw.js";
import { useApp } from "../state/context.js";
import { usePlatformLayout } from "../state/usePlatformLayout.js";
import { courseColor, SRC_COLOR } from "../lib/courseColor.js";
import { confirmOk } from "../lib/confirm.js";
import { useNotifyBackend } from "../components/useNotifyBackend.js";
import { openUrl } from "@tauri-apps/plugin-opener";
import { openLocalPath } from "../lib/localFile.js";
import { t as i18n } from "../i18n/index.js";


const DAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
/** 时间轴的列数：**恒为一周 7 列**（用户 2026-10-18：日程的时间轴完全以周为单位，
 *  不存在"单日时间轴"这种视图；手机只是列更窄，周语义不变）。 */
const WEEK_COLUMNS = 7;
/** 上游 schedule.tsx beginTime/endTime（节次兜底定位用） */
const BEGIN_TIME = ["", "08:00", "08:50", "09:50", "10:40", "11:30", "13:30", "14:20", "15:20", "16:10", "17:05", "17:55", "19:20", "20:10", "21:00"];
const END_TIME = ["", "08:45", "09:35", "10:35", "11:25", "12:15", "14:15", "15:05", "16:05", "16:55", "17:50", "18:40", "20:05", "20:55", "21:45"];
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const BEGIN_MIN = BEGIN_TIME.map(toMin);
const END_MIN = END_TIME.map(toMin);
/** 时段下拉选项：起点 00–23、终点 01–24（整点；分钟级留待后续需要再放开） */
const WIN_FROM_OPTS = Array.from({ length: 24 }, (_, h) => h * 60);
const WIN_TO_OPTS = Array.from({ length: 24 }, (_, i) => (i + 1) * 60);

/** 显示区间（分钟）：**可被用户设置覆盖**（state/scheduleWindow.ts）。
 *  比例不是常量：整周课表要**整屏铺满**，所以每渲染帧按可用高度算出 px/分钟
 *  （see fitAxis）。y() 每次调用读当前值，因此所有调用点自动跟随。 */
let AXIS_BEGIN = 0;
let AXIS_END = 24 * 60;
/** 每 1 分钟折几像素：fitAxis 按可用高度与显示区间计算，保证一屏放下一整天 */
let PX_PER_MIN = 0.52;
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
  /** 来源（课程缺省=palette；考试/云/本/作业DDL/重叠簇固定色） */
  src?: "exam" | "cloud" | "local" | "hw" | "cluster";
  /** 作业 DDL 元数据（src==="hw"） */
  homework?: Homework;
  courseId?: string;
  hwMeta?: { submitted: boolean; source?: string; externalUrl?: string; ext: boolean; courseName?: string };
  /** 重叠簇内的原始条目（src==="cluster"，详情弹层列表展开） */
  clusterItems?: GridEntry[];
  /** 云/本事件可编辑定位 */
  uid?: string;
}

/* 课程与来源配色见 lib/courseColor.ts（课表、选课预览、桌面小组件共用一份口径）。
   课块底色是数据色（一课一色，判例豁免保留）；块上文字色走 --og-content-on-accent
   （亮暗两版都落在浅色 ink-0/brand-20 区，palette 恒深底可读）。 */
const colorOf = courseColor;

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

/**
 * 同日重叠缩略：扫描线找「重叠计数 ≥3」的极大时间区间，每区间合并成一个
 * 簇块（"N 件事"），条目按其开始时刻归属所在簇（横跨多簇的长条目归 begin
 * 所在簇）。例：66 门选作实验课同一 DDL → 一个簇块；前 30 门与后 15+15
 * 各自成段 → 两个簇块。<3 重叠照常逐条渲染。
 */
function clusterize(entries: GridEntry[]): GridEntry[] {
  const out2: GridEntry[] = [];
  const byDay: GridEntry[][] = Array.from({ length: 7 }, () => []);
  for (const e of entries) {
    const day = (e.dayOfWeek ?? 1) - 1;
    if (day < 0 || day > 6) { out2.push(e); continue; }
    byDay[day]?.push(e);
  }
  for (let day = 0; day < 7; day++) {
    const list = byDay[day] ?? [];
    if (list.length < 3) { out2.push(...list); continue; }
    // 扫描线事件：begin=+1，end=-1（同分钟先收尾，首尾相接不算重叠）。
    // 无效时刻（NaN/undefined，如跨天/异常事件）的条目不参与扫描直接透传——
    // 曾因单个 NaN 事件抢占 count≥3 的 t0 导致整簇 members 过滤全灭。
    const valid = list.filter((e) => Number.isFinite(beginMinOf(e)) && Number.isFinite(endMinOf(e)));
    const invalid = list.filter((e) => !(Number.isFinite(beginMinOf(e)) && Number.isFinite(endMinOf(e))));
    out2.push(...invalid);
    const scanList = valid;
    if (scanList.length < 3) { out2.push(...scanList); continue; }
    type Ev = { min: number; d: number };
    const evs: Ev[] = [];
    for (const e of scanList) {
      evs.push({ min: beginMinOf(e), d: 1 });
      evs.push({ min: endMinOf(e), d: -1 });
    }
    evs.sort((a, b) => a.min - b.min || a.d - b.d);
    const clusters: Array<{ t0: number; t1: number }> = [];
    let count = 0, t0 = 0;
    for (const ev of evs) {
      const prev = count;
      count += ev.d;
      if (prev < 3 && count >= 3) t0 = ev.min;
      else if (prev >= 3 && count < 3) clusters.push({ t0, t1: ev.min });
    }
    if (clusters.length === 0) { out2.push(...scanList); continue; }
    const taken = new Set<GridEntry>();
    for (const c of clusters) {
      const members = scanList.filter((e) => !taken.has(e) && beginMinOf(e) >= c.t0 && beginMinOf(e) < c.t1);
      if (members.length < 3) continue; // 归属后不足 3（被长条目稀释）→ 不缩略
      for (const m of members) taken.add(m);
      const names = [...new Set(members.map((m) => m.location || m.courseName))].slice(0, 3).join("、");
      out2.push({
        courseName: `${members.length} 件事`,
        location: names,
        dayOfWeek: day + 1,
        date: members[0]?.date,
        startTime: hhmmFromMin(c.t0),
        endTime: hhmmFromMin(c.t1),
        src: "cluster",
        clusterItems: members,
      });
    }
    for (const e of scanList) if (!taken.has(e)) out2.push(e);
  }
  return out2;
}

/** 分钟数 → "HH:MM"（clusterize 簇块边界用） */
function hhmmFromMin(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * 同日重叠分道（重叠簇 + 区间图着色）：
 * 1) 按开始分钟排序后切成「重叠簇」——新块开始 ≥ 簇内最大结束（首尾相接不算重叠）则另起新簇；
 * 2) 簇内贪心放入第一个可用道次（区间图着色）；
 * 3) 道数只在簇内共享：无冲突的块独占一簇 → 独占整行宽度。
 */
function layout(entries: GridEntry[]): Placed[] {
  const byDay: GridEntry[][] = Array.from({ length: 7 }, () => []);
  for (const s of entries) {
    const day = (s.dayOfWeek ?? 1) - 1;
    if (day < 0 || day > 6) continue;
    byDay[day]?.push(s);
  }
  const placed: Placed[] = [];
  for (let day = 0; day < 7; day++) {
    const list = [...(byDay[day] ?? [])].sort(
      (a, b) => beginMinOf(a) - beginMinOf(b) || endMinOf(b) - endMinOf(a), // 同开始：长的在前，窄块不遮宽块
    );
    let laneEnds: number[] = []; // 当前簇各道的结束分钟
    let clusterMaxEnd = AXIS_BEGIN; // 当前簇内最大结束（判簇边界）
    let clusterPlaced: Placed[] = []; // 当前簇内已放置的块（簇关闭时统一回填道数）
    const closeCluster = (): void => {
      const lanes = Math.max(1, laneEnds.length);
      for (const p of clusterPlaced) p.lanes = lanes;
      clusterPlaced = [];
      laneEnds = []; // 道次表随簇清零，上一簇的道数不污染下一簇的宽度
    };
    for (const s of list) {
      const b = Math.max(0, Math.min(beginMinOf(s), AXIS_END - 20));
      const e = Math.max(b + 20, Math.min(endMinOf(s), AXIS_END));
      // 新簇判定：与簇内任何已放块都无重叠（开始 ≥ 簇内最大结束；首尾相接=不重叠）
      if (clusterPlaced.length > 0 && b >= clusterMaxEnd) closeCluster();
      let lane = laneEnds.findIndex((t) => t <= b);
      if (lane < 0) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = Math.max(laneEnds[lane] ?? 0, e);
      clusterMaxEnd = clusterPlaced.length === 0 ? e : Math.max(clusterMaxEnd, e);
      const p: Placed = { entry: s, day, beginMin: b, endMin: e, lane, lanes: 1, color: s.src ? SRC_COLOR[s.src] : colorOf(s.courseName) };
      placed.push(p);
      clusterPlaced.push(p);
    }
    closeCluster();
    laneEnds = [];
    clusterMaxEnd = AXIS_BEGIN;
  }
  return placed;
}

/**
 * 「整屏铺满」的坐标轴：把显示时段**收紧到真正有内容的区间**（前后各留 30 分钟、
 * 至少 6 小时），再按可用高度定比例 —— 于是整周课表一屏放完：不滚动、不出现上下
 * 空带，也不用把 00:00–07:00 这种没课的时段铺出来（用户点名「你没见过课表软件吗」）。
 * 用户若自己选了更窄的时段，那个时段就是硬边界；只在极矮视口（<240px）才允许滚动。
 */
function fitAxis(
  entries: GridEntry[],
  win: { from: number; to: number },
  availH: number,
): { from: number; to: number; pmm: number } {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const e of entries) {
    const b = beginMinOf(e);
    const t = endMinOf(e);
    if (Number.isFinite(b)) lo = Math.min(lo, b);
    if (Number.isFinite(t)) hi = Math.max(hi, t);
  }
  const hasData = Number.isFinite(lo) && Number.isFinite(hi) && hi > lo;
  const PAD = 30;
  const MIN_SPAN = 6 * 60;
  // 有内容 → 收紧到内容；空周 → 固定看 08:00–22:00（空课表该有的样子）
  let from = hasData ? Math.max(win.from, Math.floor((lo - PAD) / 60) * 60) : Math.max(win.from, 8 * 60);
  let to = hasData ? Math.min(win.to, Math.ceil((hi + PAD) / 60) * 60) : Math.min(win.to, 22 * 60);
  if (to - from < MIN_SPAN) {
    from = Math.max(win.from, Math.min(from, Math.round((from + to) / 2 - MIN_SPAN / 2)));
    to = Math.min(win.to, from + MIN_SPAN);
    from = Math.max(win.from, to - MIN_SPAN);
  }
  // 首帧量不到高度（availH=0）时才用兜底值；量到就严格铺满，不滚动
  const h = availH > 0 ? availH : 240;
  return { from, to, pmm: h / (to - from) };
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
  /** 「在桌面小组件显示」：写进事件的私有标记（X-ONETHU-WIDGET），勾了才进桌面「今天」卡片 */
  widget: boolean;
}

const emptyDraft = (date: string, canCloud: boolean): Draft => ({
  title: "", date, start: "08:00", end: "09:35", allDay: false, location: "", note: "",
  toCloud: canCloud, originalCloud: false,
  // 默认不勾：自定义日程一直不上小组件，勾了才上（保持既有行为，避免存量日程突然挤进卡片）
  widget: false,
});

export function SchedulePage() {
  // 展示时段（用户可选；默认全天）。放在最前：下面所有 y()/刻度都依赖它
  const [win, setWin] = useScheduleWindow();
  const campus = useCampusData();
  const calendar = useCalendar();
  const extHw = useExternalHomework();
  const cal = useCloudCal();
  const { status } = useApp();
  /** 极简/实用壳：云同步与寻迹是完整模式能力，简洁壳不出现入口（连提示文案一起藏）。 */
  const simple = useIsSimpleLike();
  /** 本机有没有桌面小组件（只有 Android 有承载）：决定「在桌面小组件显示」是否出现在编辑器 */
  const widgetHere = useNotifyBackend() === "android";

  // 每次打开日程页自动云同步一次（失败静默——工具栏有手动入口与状态）
  useEffect(() => {
    if (getCloudCalConfig()) void syncCloudCal().catch(() => undefined);
  }, []);

  /** 设置浮层开关：本页唯一常驻控件是事件区上那颗悬浮圆钮，点开就是这份设置面板 */
  const [panelOpen, setPanelOpen] = useState(false);
  const dockRef = useRef<HTMLDivElement | null>(null);
  /** 视图模式：时间轴（周网格 24h）/ 列表（月历+所选日清单）。
   *  时间轴在任何端都是"一周"（7 列），手机不降级成单日页。 */
  const tier = usePlatformLayout();
  const [mode, setMode] = useState<"timetable" | "agenda">("timetable");
  const modeTouched = useRef(false);
  const pickMode = (m: "timetable" | "agenda"): void => {
    modeTouched.current = true;
    setMode(m);
  };
  /* 「铺满屏幕」的高度链（见 packages/gui/src/recipes/schedule.css）：本页是当前标签页时
     给 <html> 挂 is-schedule-page，把应用壳收成"视口减壳"的定高 flex 列，事件区吃掉
     全部剩余高度。不用嵌套 :has()（规范禁止），也不写死像素偏移（换顶栏高度会错位）。
     注意：非当前标签页的面板仍挂载在 DOM 里，所以必须按"当前页"而不是"曾打开过"来挂。 */
  /** 日期锚点：任意日期，导航无边界（1970–2099） */
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [selected, setSelected] = useState<string>(ymdOf(new Date()));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [detail, setDetail] = useState<GridEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [reloadTick, setReloadTick] = useState(0);
  /** 本机是否支持原生写系统日历（决定工具栏按钮文案；null=探测中） */
  const [sysNative, setSysNative] = useState<boolean | null>(null);
  useEffect(() => {
    void systemCalSupported().then(setSysNative);
  }, []);

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
  /** 弹层退场相位由 OneGUI Modal/Popover 的 Shell 附带（进退场+遮罩+Esc+滚动锁全部库承担），
   *  旧的页级 useExitHold 退场挂在两处弹窗上已随 Modal 化一并移除。 */
  /** 周窗失败自动重试计数（每窗口最多 2 次、间隔 4.2s）：选课死结借 lib 重登
   *  后教务/漫游会话重建需几秒，softRecover 的一次原地重取不够——静默自愈,
   *  红条不再吓人（2026-09-19 快速往返实录） */
  const winRetryRef = useRef<{ key: string; count: number }>({ key: "", count: 0 });
  const windowKey = `${ymdOf(viewWindow[0])}_${ymdOf(viewWindow[1])}`;
  useEffect(() => {
    if (mode !== "timetable") return; // 列表自取月窗
    let alive = true;
    setWinLoading(true);
    setWinError(null);
    const grab = (): Promise<void> =>
      info
        .getSchedule(ymdOf(viewWindow[0]), ymdOf(viewWindow[1]))
        .then(async (rows) => {
          // 二级课表（实验课）并入：core InfoClient 的 JSONP 只含一级——
          // 之前并错在无人调用的 useWeekSchedule（TICK=0 实锤），现在加在
          // 真正的窗口取数链路。失败静默不连累一级。
          try {
            const fd = calendar.data?.firstDay ?? "";
            if (fd) {
              const { getSecondaryEntries } = await import("../lib/infoLib.js");
              const { http } = await import("../lib/clients.js");
              const sec = await getSecondaryEntries(http, fd, ymdOf(viewWindow[0]), ymdOf(viewWindow[1]));
              for (const c of sec) {
                if (rows.some((r) => r.courseName === c.name && r.date === c.date && r.startTime === c.startTime)) continue;
                rows.push({
                  courseName: c.name,
                  location: c.location,
                  date: c.date,
                  dayOfWeek: c.dayOfWeek,
                  startTime: c.startTime,
                  endTime: c.endTime,
                  category: "二级课表",
                  raw: { source: "secondary" },
                });
              }
            }
          } catch { /* 二级失败静默：一级照常 */ }
          // 落持久缓存：系统日历 SWR 兜底的数据源（用户实锤「看得到课表但
          // 同步报会话失效」——页内 state 对兜底不可见）；重启后也活着
          cacheSet(`schedwin:${windowKey}`, rows, true);
          if (alive) setWindowRows(rows);
        });
    grab()
      .catch(async (err) => {
        if (!alive) return;
        // 失登（稳定性专项）：softRecover 透明重建 → 原地重取一次；仍败才亮条
        const scheduleAutoRetry = (): boolean => {
          const st = winRetryRef.current;
          if (st.key !== windowKey) { st.key = windowKey; st.count = 0; }
          if (st.count >= 2) return false;
          st.count += 1;
          setTimeout(() => { if (alive) setReloadTick((t) => t + 1); }, 4200);
          return true;
        };
        if (isAuthError(err) && (await softRecover("schedule-win"))) {
          await grab().catch((e2) => {
            if (alive && !scheduleAutoRetry()) setWinError(e2 instanceof Error ? e2.message : String(e2));
          });
          return;
        }
        if (alive) {
          if (scheduleAutoRetry()) return;
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
    // 作业 DDL 入格：learn + 外源（雨课堂/TUOJ/Tyche/DSA OJ）统一 Homework，
    // deadline 前 2h → deadline 画成一个 DDL 块（橙色；已提交降透明由渲染层处理）
    // R21c：已忽略的作业不进日程格（用户口径：忽略后不在日程显示）
    const ignoredIds = new Set(ignoredHwList().map((e) => e.id));
    const hwAll = [...(campus.data?.homework ?? []), ...extHw.items.map(toHomework)].filter(
      // R23：已忽略 + 旁听都不进日程格（旁听不评分、非正式课程）
      (h) => !ignoredIds.has(h.id) && !h.audited,
    );
    for (const h of hwAll) {
      if (!h.deadline) continue;
      const d = new Date(String(h.deadline).replace(/-/g, "/"));
      if (isNaN(d.getTime())) continue;
      const t = d.getTime();
      if (t < lo || t > hi) continue;
      const b = new Date(t - 2 * 3_600_000);
      const hmOf = (x: Date): string => `${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`;
      const wd = (new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).getUTCDay() + 6) % 7;
      const hwCourse = h.courseName || campus.data?.courses?.find((c) => c.name && c.id === h.courseId)?.name || undefined;
      inWeek.push({
        courseName: h.title,
        location: hwCourse,
        date: ymdOf(d),
        dayOfWeek: wd + 1,
        startTime: hmOf(b),
        endTime: hmOf(d),
        src: "hw",
        homework: h,
        hwMeta: {
          submitted: !!h.submitted,
          source: h.source,
          courseName: hwCourse,
          ext: !!h.source,
          // 外源用自带链接；learn 作业拼官方作业详情页（浏览器已登录即可看）
          externalUrl: h.externalUrl || h.url || (h.baseId ? learnUrls.LEARN_HOMEWORK_PAGE(h.courseId, h.baseId) : undefined),
        },
      });
    }
    // 重叠缩略：≥3 件重叠合并成"N 件事"簇块（扫描线极大区间）
    const clustered = clusterize(inWeek);
    void logLine(`HW-CLUSTER in=${inWeek.length} hw=${inWeek.filter((e) => e.src === "hw").length} out=${clustered.length} clusters=${clustered.filter((e) => e.src === "cluster").map((e) => `${e.courseName}@${e.startTime}-${e.endTime}`).join("|")}`).catch(() => undefined);
    return { entries: clustered, allDayChips: chips };
  }, [viewWindow, windowRows, campus.data, cal.cloudEvents, cal.localEvents, extHw.items]);

  /* ── 铺满：可用高度 → 坐标轴（先定轴，layout/裁剪/渲染都跟着走） ── */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const headRef = useRef<HTMLDivElement | null>(null);
  /** 事件画布可用高度（= 时间表可视高 − 吸顶表头高），0 = 尚未量到（首帧） */
  const [availH, setAvailH] = useState(0);
  useLayoutEffect(() => {
    if (mode !== "timetable") return undefined;
    const host = scrollRef.current;
    if (!host) return undefined;
    const measure = (): void => {
      const headH = headRef.current?.offsetHeight ?? 0;
      // 底部浮件带（OneShot 胶囊 / 底栏）＝滚动区自身的下内边距（计算值就是 px，能直接读）
      const reserve = Number.parseFloat(getComputedStyle(host).paddingBottom) || 0;
      const next = Math.max(host.clientHeight - headH - reserve - 1, 0);
      setAvailH((prev) => (Math.abs(prev - next) >= 2 ? next : prev));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    if (headRef.current) ro.observe(headRef.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [mode, allDayChips.length, panelOpen]);

  /** 收紧后的显示区间 + 每分钟像素：整周课表一屏放完（见 fitAxis） */
  const axis = useMemo(() => fitAxis(entries, win, availH), [entries, win, availH]);
  AXIS_BEGIN = axis.from;
  AXIS_END = axis.to;
  PX_PER_MIN = axis.pmm;
  /** 画布高度：正好填满可用高度（不滚动、不留白） */
  const canvasH = Math.max(1, Math.floor((axis.to - axis.from) * axis.pmm));

  const placed = useMemo(() => layout(entries), [entries, axis.from, axis.to]); // eslint-disable-line react-hooks/exhaustive-deps

  /* 落在展示时段内的块 + 它们的「行号」。placed 是按天（列）再按时间排的，直接用数组序号
     会变成竖直按列扫；入场应该按行（同一时间带跨天同时出现）、时间从早到晚自上而下。
     行号 = 该块起始时刻在所有不同起始时刻里的序号。 */
  const visiblePlaced = useMemo(
    () => placed.filter((p) => p.endMin > AXIS_BEGIN && p.beginMin < AXIS_END),
    [placed, axis.from, axis.to], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const blockRows = useMemo(() => {
    const keys = Array.from(new Set(visiblePlaced.map((p) => Math.max(p.beginMin, AXIS_BEGIN)))).sort((a, b) => a - b);
    const m = new Map<number, number>();
    keys.forEach((k, i) => m.set(k, i));
    return m;
  }, [visiblePlaced]);

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

  /** 半小时刻度序列（跟随收紧后的轴；起点对齐到 30 分钟刻度） */
  const halfHours = useMemo(() => {
    const out: number[] = [];
    const start = Math.ceil(axis.from / 30) * 30;
    for (let m = start; m <= axis.to; m += 30) out.push(m);
    return out;
  }, [axis.from, axis.to]);

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

  /** 手动推一次系统日历：原生直写（Android/macOS；自动跟随在设置页开启），否则 .ics 快照导入 */
  const onSystemCal = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      if (await systemCalSupported()) {
        try {
          const r = await syncSystemCalendar();
          setMsg(`已写入系统日历「OneTHU 日程」：${r.added} 条（清理旧 ${r.removed} 条）；此后日程变化会自动同步。`);
        } catch (err) {
          setMsg(`存入系统日历失败：${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      }
      const events: caldav.IcsEvent[] = [...cal.cloudEvents, ...cal.localEvents];
      if (exportSemester) {
        const r = await buildSemesterEvents(exportSemester, (st, en) => info.getSchedule(st, en));
        events.push(...r.events);
      }
      if (events.length === 0) {
        setMsg(i18n("auto.pages.Schedule.msg1"));
        return;
      }
      const { invoke } = await import("@tauri-apps/api/core");
      const path = await invoke<string | null>("save_text_file", {
        filename: "OneTHU-日程.ics",
        contents: caldav.serializeCalendar(events),
      });
      if (!path) return; // 用户取消
      await openLocalPath(path);
      setMsg(`已导出 ${events.length} 条日程，系统日历导入窗口应已打开（选择要写入的日历）。iPhone 上想自动同步：设置 → 云同步 → 在 iPhone 上查看。`);
    } catch (err) {
      setMsg(`导出失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const openEditByUid = (uid: string, kind: "cloud" | "local"): void => {
    const src = kind === "cloud" ? cal.cloudEvents.find((e) => e.uid === uid) : cal.localEvents.find((e) => e.uid === uid);
    if (!src) return;
    setDetail(null); // 详情/编辑互斥
    const w = caldav.epochToWall("Asia/Shanghai", src.start);
    const we = caldav.epochToWall("Asia/Shanghai", src.end);
    setDraft({
      uid: src.uid, title: src.summary, date: ymdOf(new Date(src.start)),
      start: `${padN(w.h)}:${padN(w.mi)}`, end: `${padN(we.h)}:${padN(we.mi)}`,
      allDay: !!src.allDay, location: src.location ?? "", note: src.description ?? "",
      toCloud: kind === "cloud", originalCloud: kind === "cloud",
      // 原样带回：非 Android 上这个勾选框不显示，保存时也不会把标记抹掉
      widget: src.onethuWidget === true,
    });
  };
  /** 列表行点击（云/本可编辑；课程/考试无 uid 不可编辑） */
  const onAgendaEdit = (it: AgendaItem): void => {
    if (it.uid && (it.kind === "cloud" || it.kind === "local")) openEditByUid(it.uid, it.kind);
  };
  /** 时间轴块点击：云/本 → 编辑器；课程/考试 → 只读详情 */
  const onBlockClick = (e: GridEntry): void => {
    if ((e.src === "cloud" || e.src === "local") && e.uid) openEditByUid(e.uid, e.src);
    else {
      setDraft(null); // 详情/编辑互斥
      setDetail(e);
    }
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
        // 桌面小组件「今天」卡片：勾了才带上这个私有标记（缺省不写 = 不上卡片）
        onethuWidget: draft.widget || undefined,
      };
      // 跨集合移动（云↔本地）：先删原侧再写新侧
      if (draft.uid && draft.originalCloud && !draft.toCloud) await deleteCloudEvent(draft.uid);
      if (draft.uid && !draft.originalCloud && draft.toCloud) await deleteLocalEvent(draft.uid);
      if (draft.toCloud) await putCloudEvent(ev);
      else await putLocalEvent(ev);
      setDraft(null);
      setMsg(i18n("auto.pages.Schedule.msg2"));
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
      setMsg(i18n("auto.pages.Schedule.msg3"));
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

  /** 详情弹层的「前往 / 寻迹」（用户 2026-10-18 口径，两条都是**新标签页**）：
   *   · 作业 → openHomeworkRow 统一分流（雨课堂原生详情 / 网络学堂作业详情 / 外部作业源），
   *     navigate 一律带 forceNew: true —— 打开的是"这条作业"的新标签页，
   *     点完之后弹层关掉、日程标签原地不动；
   *   · 课程 → 网络学堂该课程（learn-course）新标签；
   *   · 寻迹 → trace 新标签，带 traceTarget（该课/该地点的寻路）。
   *  作业不再提供"查看原网页"出口：站内有作业详情页的一律进站内。 */
  const gotoDetail = (d: GridEntry, trace = false): void => {
    /** 统一出口：标题来自条目本身，forceNew 恒真（绝不顶掉当前日程标签） */
    const newTab = (page: Parameters<typeof openTab>[0], params?: Parameters<typeof openTab>[1], title?: string): void => {
      openTab(page, params, { title, forceNew: true });
    };
    setDetail(null); // 动作一律先关弹层，避免两个浮层叠着
    if (trace) {
      newTab("trace", { traceTarget: { title: d.courseName, location: d.location ?? "", date: d.date, startTime: d.startTime, endTime: d.endTime } }, `寻迹 · ${d.courseName}`);
      return;
    }
    if (d.homework) {
      openHomeworkRow(d.homework, {
        navigate: (page, params) => newTab(page, params, d.courseName),
        from: "schedule",
        courseName: d.location,
      });
      return;
    }
    const course = campus.data?.courses.find((c) => c.id === d.courseId || c.name === d.courseName);
    if (course) {
      newTab("learn-course", { courseId: course.id }, course.name);
      return;
    }
    // 找不到对应课程（校外课/二级课表等）：仍开一个课程页新标签，不让按钮点了没反应
    setMsg(`未找到「${d.courseName}」对应的网络学堂课程，已打开课程页，可在其中查找。`);
    newTab("learn", null, "课程");
  };
  return (
    <section className="schedule-workspace">
      {/* 用户口径：日程页不要大标题、也不要顶部按钮条 —— 页头只留页级 chrome 同步（0 高度） */}
      <PageHead title={null} />

      {/* 事件区：铺满中间全部内容区。所有控件都悬浮在它上面（右下/手机上右上的小圆钮） */}
      <div className="schedule-stage">
        {/* 通知浮层：取数失败/同步结果不占高度，不挤事件区 */}
        {msg || (winError && mode === "timetable") || calendar.state === "error" ? (
          <div className="schedule-floats">
            {msg ? <Banner tone="info">{msg}</Banner> : null}
            {winError && mode === "timetable" ? (
              <ErrorNote text={`本周课程取数失败（日程仍显示）：${winError}`} onRetry={() => setReloadTick((t) => t + 1)} />
            ) : null}
            {calendar.state === "error" ? (
              <ErrorNote text={`校历加载失败（学期检测/跳转不可用）：${calendar.error ?? ""}`} onRetry={() => void calendar.reload()} />
            ) : null}
          </div>
        ) : null}

        {mode === "agenda" ? (
          <div className="schedule-scroll">
            <ScheduleAgenda
              courses={campus.data?.schedule ?? []}
              monthAnchor={new Date(anchor.getFullYear(), anchor.getMonth(), 1)}
              onMonthAnchor={(d) => setAnchor(d)}
              selected={selected}
              onSelect={setSelected}
              onEdit={onAgendaEdit}
            />
          </div>
        ) : (
          <>
            {/* 全天日程芯片（不进事件轴；有时才出现，占一行） */}
            {allDayChips.length > 0 ? (
              <div className="schedule-chip-row">
                {allDayChips.slice(0, 8).map((c, i) => (
                  <Chip
                    key={i}
                    size="sm"
                    tone={c.src === "cloud" ? "success" : "neutral"}
                    onClick={c.uid ? () => onBlockClick({ courseName: c.label, src: c.src, uid: c.uid }) : undefined}
                  >
                    {i18n("auto.pages.Schedule.1")}{c.label}
                  </Chip>
                ))}
              </div>
            ) : null}

            <div className="schedule-timeline" ref={scrollRef}>
            {/* 表头：**一周 7 列**（吸顶）；今天整列高亮 */}
            <div className="schedule-day-head" ref={headRef}>
              <div className="schedule-head-gutter" />
              <div className="schedule-day-strip">
                {DAY_NAMES.map((name, i) => (
                  <div key={name} className={"schedule-day-cell" + (inCurrentWeek && i === todayIdx ? " is-today" : "")}>
                    {name}
                    <small>{dayDates[i]}</small>
                  </div>
                ))}
              </div>
            </div>

            <div className="schedule-body">
              {/* 时间刻度列（跟随显示时段） */}
              <div className="schedule-gutter" style={{ height: canvasH }}>
                {/* 极矮视口（手机横屏）一行只有十几像素：刻度隔一小时标一次，避免叠字 */}
                {halfHours.filter((m) => m % (60 * (axis.pmm * 60 < 26 ? 2 : 1)) === 0).map((m) => (
                  <div key={m} className="schedule-gutter-label" style={{ top: Math.max(0, Math.min(y(m) - 6, canvasH - 16)) }}>
                    {hhmm(m)}
                  </div>
                ))}
              </div>

              {/* 画布 */}
              <div className="schedule-canvas" style={{ height: canvasH }}>
                {/* 空周提示（网格照常渲染，提示浮于其上不挡交互） */}
                {entries.length === 0 ? (
                  <div className="schedule-empty">
                    <Surface overlay radius="sm" pad="sm">
                      <Text tone="faint">{winLoading ? "正在从教务系统取数…" : "本周暂无排课与日程"}</Text>
                    </Surface>
                  </div>
                ) : null}
                {/* 列背景（今天微底色） */}
                {DAY_NAMES.map((_, day) => (
                  <div
                    key={`col-${day}`}
                    className={"schedule-col" + (inCurrentWeek && day === todayIdx ? " is-today" : "")}
                    style={{ left: `${(day * 100) / WEEK_COLUMNS}%`, width: `${100 / WEEK_COLUMNS}%` }}
                  />
                ))}
                {/* 半小时横线：整点略深 */}
                {halfHours.map((m) => (
                  <div key={`gl-${m}`} className={"schedule-grid-line" + (m % 60 === 0 ? " is-hour" : "")} style={{ top: y(m) }} />
                ))}
                {/* 当前时刻红线（当前周）：线走 --og-error 状态令牌；圆点 = Badge dot */}
                {inCurrentWeek
                  ? (() => {
                      const nm = new Date().getHours() * 60 + new Date().getMinutes();
                      if (nm > AXIS_END) return null;
                      return (
                        <div
                          className="schedule-now"
                          style={{ left: `${(todayIdx * 100) / WEEK_COLUMNS}%`, width: `${100 / WEEK_COLUMNS}%`, top: y(nm) }}
                        >
                          <div className="schedule-now-dot"><Badge dot standalone tone="error" /></div>
                        </div>
                      );
                    })()
                  : null}
                {/* 事件块（可点击） */}
                {visiblePlaced.map((p, i) => {
                  const laneW = 100 / p.lanes;
                  const leftPct = ((p.day * 100) + p.lane * laneW) / WEEK_COLUMNS;
                  const widthPct = laneW / WEEK_COLUMNS;
                  // 跨区间的事件按边界裁切（区间外不画，避免负 top 溢出画布）
                  const drawBegin = Math.max(p.beginMin, AXIS_BEGIN);
                  const drawEnd = Math.min(p.endMin, AXIS_END);
                  const top = y(drawBegin) + 1;
                  const height = Math.max((drawEnd - drawBegin) * PX_PER_MIN - 3, 16);
                  const compact = height < 34;
                  // 入场错峰：按「行」（时间带）递延——同一时刻跨天的块同时出现，从早到晚自上而下
                  const delay = Math.min(blockRows.get(Math.max(p.beginMin, AXIS_BEGIN)) ?? 0, 16) * 13;
                  return (
                    <div
                      key={`b-${ymdOf(weekStart)}-${i}`}
                      data-tx="keep"
                      data-vault-catch={vaultCatchSchedule({ title: p.entry.courseName, kind: p.entry.src === "hw" ? "作业截止" : "课程", date: ymdOf(weekStart), location: p.entry.location, note: `${hhmm(p.beginMin)}–${hhmm(p.endMin)}` })}
                      className={
                        "schedule-block"
                        + (compact ? " is-compact" : "")
                        + (p.entry.src === "hw" && p.entry.hwMeta?.submitted ? " is-done" : "")
                      }
                      title={
                        p.entry.src === "cluster"
                          ? `${p.entry.courseName}（${hhmm(p.beginMin)}–${hhmm(p.endMin)}）：${p.entry.clusterItems?.map((m) => `${m.courseName}${m.location ? "@" + m.location : ""}`).join("；")} · 点击展开`
                          : p.entry.src === "hw"
                            ? `${p.entry.courseName}（${p.entry.location ?? ""}）DDL ${hhmm(p.beginMin)}–${hhmm(p.endMin)} · ${p.entry.hwMeta?.submitted ? "已提交" : "未提交"} · ${p.entry.hwMeta?.ext ? p.entry.hwMeta.source ?? "外部" : "网络学堂"} · 点击查看`
                            : `${p.entry.courseName}${p.entry.teacher ? " · " + p.entry.teacher : ""}${
                                p.entry.location ? " @" + p.entry.location : ""
                              }（${hhmm(p.beginMin)}–${hhmm(p.endMin)}）${p.entry.src === "cloud" || p.entry.src === "local" ? " · 点击编辑" : " · 点击查看"}`
                      }
                      onClick={() => onBlockClick(p.entry)}
                      style={{
                        left: `calc(${leftPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                        top,
                        height,
                        // 数据色（一课一色）经 CSS 变量交给 schedule.css，TSX 不再写字面色
                        "--og-c-schedule-block": p.color,
                        "--og-c-schedule-delay": `${delay}ms`,
                      } as React.CSSProperties}
                    >
                      <div className="schedule-block-title">
                        {p.entry.src === "hw" ? `⏰ ${p.entry.courseName}` : p.entry.courseName}
                      </div>
                      {!compact && p.entry.location ? (
                        <div className="schedule-block-sub">
                          <Text slot="micro" clamp={height > 72 ? 3 : 2}>{p.entry.location}</Text>
                        </div>
                      ) : null}
                      {!compact && height > 88 && p.entry.teacher ? (
                        <div className="schedule-block-sub">
                          <Text slot="micro" nowrap>{p.entry.teacher}</Text>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
            </div>
          </>
        )}

        {/* 唯一常驻控件：一颗悬浮小圆钮，点开 = 全部设置（周切换/视图/筛选/同步/新建/收藏） */}
        <div className="schedule-dock" ref={dockRef}>
          <Btn
            variant="solid"
            tone="brand"
            size="sm"
            aria-label={i18n("auto.pages.Schedule.2")}
            aria-expanded={panelOpen}
            titleAttr={i18n("auto.pages.Schedule.3")}
            onClick={() => setPanelOpen((v) => !v)}
            icon={<IconSchedule width={16} height={16} />}
          />
          <Popover
            open={panelOpen}
            onClose={() => setPanelOpen(false)}
            anchor={dockRef.current}
            side={tier === "expanded" ? "top" : "bottom"}
            align="center"
            label={i18n("auto.pages.Schedule.2")}
          >
            <div className="schedule-panel">
              {/* 周导航：时间轴恒以周为单位 */}
              <div className="schedule-panel-block">
                <Text slot="micro" tone="faint">{i18n("auto.pages.Schedule.4")}</Text>
                <div className="schedule-panel-row">
                  <Btn variant="outline" size="sm" titleAttr={mode === "timetable" ? "上一周" : "上个月"} aria-label={mode === "timetable" ? "上一周" : "上个月"} onClick={() => setAnchor(stepAnchor(-1))}>‹</Btn>
                  <Btn
                    className="schedule-panel-grow schedule-panel-label"
                    variant="outline"
                    size="sm"
                    aria-expanded={calOpen}
                    titleAttr={i18n("auto.pages.Schedule.5")}
                    onClick={() => setCalOpen((v) => !v)}
                  >{label}</Btn>
                  <Btn variant="outline" size="sm" titleAttr={mode === "timetable" ? "下一周" : "下个月"} aria-label={mode === "timetable" ? "下一周" : "下个月"} onClick={() => setAnchor(stepAnchor(1))}>›</Btn>
                  <Btn variant="outline" size="sm" onClick={() => { setAnchor(new Date()); setSelected(todayStr); }}>{i18n("auto.pages.Schedule.6")}</Btn>
                </div>
                <div className="schedule-panel-row">
                  <Text slot="label" tone="faint">
                    {detected ? `${detected.sem.semesterName || detected.sem.semesterId} · 第 ${detected.weekNo} 周` : "假期（学期外）"}
                  </Text>
                </div>
                {calOpen ? (
                  <div className="schedule-cal">
                    <div className="schedule-cal-head">
                      <Btn variant="ghost" size="sm" titleAttr={i18n("auto.pages.Schedule.7")} onClick={() => calShift(-12)}>«</Btn>
                      <Btn variant="ghost" size="sm" titleAttr={i18n("auto.pages.Schedule.8")} onClick={() => calShift(-1)}>‹</Btn>
                      <div className="schedule-cal-title"><Text weight="semibold">{calView.getFullYear()} {i18n("auto.pages.Schedule.9")}{calView.getMonth() + 1} {i18n("auto.pages.Schedule.10")}</Text></div>
                      <Btn variant="ghost" size="sm" titleAttr={i18n("auto.pages.Schedule.11")} onClick={() => calShift(1)}>›</Btn>
                      <Btn variant="ghost" size="sm" titleAttr={i18n("auto.pages.Schedule.12")} onClick={() => calShift(12)}>»</Btn>
                    </div>
                    <div className="schedule-cal-grid">
                      {DAY_NAMES.map((n) => (
                        <div key={n}><Text slot="micro" tone="faint">{n[1] ?? n}</Text></div>
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
                            <Btn key={d.toISOString()} size="sm" variant={ymdOf(d) === todayStr ? "tonal" : "ghost"} onClick={() => pickDay(d)}>
                              {d.getDate()}
                            </Btn>
                          ) : (
                            <div key={`pad-${i}`} />
                          ),
                        );
                      })()}
                    </div>
                    <Text slot="micro" tone="faint">
                      {mode === "timetable" ? "选日期跳到该日期所在的教学周" : "选日期跳到该日期所在月份"}
                    </Text>
                  </div>
                ) : null}
              </div>

              {/* 视图：时间轴（周网格）/ 列表（月历 + 所选日清单） */}
              <div className="schedule-panel-block">
                <Text slot="micro" tone="faint">{i18n("auto.pages.Schedule.13")}</Text>
                <div className="schedule-panel-row">
                  {([["timetable", "时间轴（周）"], ["agenda", "列表"]] as const).map(([m, lbl]) => (
                    <Chip key={m} size="sm" selected={mode === m} onClick={() => pickMode(m)}>{lbl}</Chip>
                  ))}
                </div>
              </div>

              {/* 筛选：显示时段（只影响画布，不改数据；默认全天） */}
              <div className="schedule-panel-block">
                <Text slot="micro" tone="faint">{i18n("auto.pages.Schedule.14")}{hhmmWin(win.from)}–{hhmmWin(win.to)}</Text>
                <div className="schedule-panel-row">
                  <Select size="sm" aria-label={i18n("auto.pages.Schedule.15")} value={win.from} onChange={(v) => setWin({ ...win, from: Number(v) })}>
                    {WIN_FROM_OPTS.map((m) => (<option key={m} value={m}>{hhmmWin(m)}</option>))}
                  </Select>
                  <Select size="sm" aria-label={i18n("auto.pages.Schedule.16")} value={win.to} onChange={(v) => setWin({ ...win, to: Number(v) })}>
                    {WIN_TO_OPTS.map((m) => (<option key={m} value={m}>{hhmmWin(m)}</option>))}
                  </Select>
                </div>
                <div className="schedule-panel-row">
                  {WINDOW_PRESETS.map((p) => (
                    <Chip key={p.label} size="sm" selected={win.from === p.win.from && win.to === p.win.to} onClick={() => setWin(p.win)}>
                      {p.label}
                    </Chip>
                  ))}
                  <Btn size="sm" variant="outline" onClick={() => setWin(FULL_DAY)}>{i18n("auto.pages.Schedule.17")}</Btn>
                </div>
              </div>

              {/* 学期 / 周跳转 */}
              {semesters.length > 0 ? (
                <div className="schedule-panel-block">
                  <Text slot="micro" tone="faint">{i18n("auto.pages.Schedule.18")}</Text>
                  <div className="schedule-panel-row">
                    <Select size="sm" aria-label={i18n("auto.pages.Schedule.19")} value={Math.min(jumpSemIdx, semesters.length - 1)} onChange={(v) => {
                      const i = Number(v);
                      setJumpSemIdx(i);
                      setJumpWeek((w) => Math.min(w, semesters[i]?.weekCount ?? w));
                    }}>
                      {semesters.map((sm, i) => (
                        <option key={sm.semesterId || i} value={i}>{sm.semesterName || sm.semesterId || `学期 ${i + 1}`}</option>
                      ))}
                    </Select>
                    <Select size="sm" aria-label={i18n("auto.pages.Schedule.20")} value={jumpWeek} onChange={(v) => setJumpWeek(Number(v))}>
                      {Array.from({ length: jumpSem?.weekCount ?? 20 }, (_, i) => i + 1).map((w) => (
                        <option key={w} value={w}>{i18n("auto.pages.Schedule.21")}{w} {i18n("auto.pages.Schedule.22")}</option>
                      ))}
                    </Select>
                    <Btn size="sm" variant="outline" onClick={goSemWeek}>{i18n("auto.pages.Schedule.23")}</Btn>
                  </div>
                </div>
              ) : null}

              {/* 同步 / 系统日历 / 刷新（云同步与系统日历是完整模式能力；简洁壳只留刷新） */}
              <div className="schedule-panel-block">
                {simple ? null : <Text slot="micro" tone="faint">{canCloud ? `${cal.email} · ${lastSyncText}` : "云同步未配置（设置页开启）"}</Text>}
                <div className="schedule-panel-row">
                  {simple ? null : <Btn size="sm" variant="outline" onClick={() => void onSync()} disabled={!canCloud || cal.syncing} icon={<IconRefresh width={14} height={14} />}>
                    {cal.syncing ? "同步中…" : "同步云日历"}
                  </Btn>}
                  {simple ? null : <Btn size="sm" variant="outline" onClick={() => void onSystemCal()} disabled={busy}>
                    {sysNative === false ? "导出 .ics" : "同步到系统日历"}
                  </Btn>}
                  <Btn size="sm" variant="outline" disabled={winLoading} icon={<IconRefresh width={14} height={14} />} onClick={() => {
                    setReloadTick((t) => t + 1);
                    if (!calendar.data) void calendar.reload();
                    else void campus.reload();
                  }}>{i18n("auto.pages.Schedule.24")}</Btn>
                </div>
              </div>

              {/* 新建 + 收藏本页 */}
              <div className="schedule-panel-row">
                <Btn variant="solid" tone="brand" size="sm" onClick={() => { setDraft(emptyDraft(defaultDraftDate, simple ? false : canCloud)); setPanelOpen(false); }}>{i18n("auto.pages.Schedule.25")}</Btn>
                <Spacer />
                <PageAtomStar atomKey="schedule" title={i18n("auto.pages.Schedule.26")} />
              </div>
            </div>
          </Popover>
        </div>
      </div>

      {/* 只读详情弹窗（课程/考试/作业：来自教务与作业系统，只能看不能改）。
          信息层次：标题 → 时间/地点/教师/来源/状态 → 备注 → 动作。
          动作口径（用户 2026-10-18）：
            · 作业 → 「前往」＝打开**新的该作业标签页**（不再给"查看原网页"）；
            · 课程 → 「前往」＝网络学堂该课程新标签；「寻迹」＝寻迹这门课 新标签。
             两条都走 forceNew，绝不顶掉当前日程标签。
          退场相位/遮罩/Esc/滚动锁由 OneGUI Modal 的 Shell 承担。 */}
      {(() => {
        const d = detail;
        if (!d) return null;
        const isHw = d.src === "hw";
        const title = d.clusterItems
          ? `${d.courseName}（${d.startTime ?? ""}–${d.endTime ?? ""}）`
          : d.src === "hw"
            ? `⏰ ${d.courseName}`
            : d.src === "exam" ? "考试详情" : "课程详情";
        /** 时间行：真实时刻优先，退到节次 */
        const timeText = d.date && (d.startTime || d.endTime)
          ? `${d.date}${d.startTime && d.endTime ? ` ${d.startTime}–${d.endTime}` : ""}`
          : d.startSection ? `第 ${d.startSection}–${d.endSection ?? d.startSection} 节` : "";
        const srcText = d.hwMeta?.ext ? (d.hwMeta.source ?? "外部") : "网络学堂";
        /** 作业所属课程：网络学堂作业的 courseName 由 courseId 映射补全（hwMeta.courseName） */
        const hwCourse = isHw ? (d.hwMeta?.courseName || d.homework?.courseName || d.location || "") : "";
        return (
          <Modal open onClose={() => setDetail(null)} title={title} size="md" closeButton={false}
            foot={
              <Inline gap={2} justify="end">
                {d.clusterItems ? null : isHw ? (
                  d.homework ? <Btn variant="solid" tone="brand" onClick={() => gotoDetail(d)}>{i18n("auto.pages.Schedule.23")}</Btn> : null
                ) : (
                  <>
                    <Btn variant="solid" tone="brand" onClick={() => gotoDetail(d)}>{i18n("auto.pages.Schedule.23")}</Btn>
                    {simple ? null : <Btn variant="outline" disabled={!d.location} titleAttr={d.location ? `寻迹 ${d.location}` : "没有地点，无法寻迹"} onClick={() => gotoDetail(d, true)}>{i18n("auto.pages.Schedule.27")}</Btn>}
                  </>
                )}
                <Btn variant="outline" onClick={() => setDetail(null)}>{i18n("auto.pages.Schedule.28")}</Btn>
              </Inline>
            }
          >
            {d.clusterItems ? (
              // 重叠簇详情：列出该时段全部事项
              <Stack gap={2}>
                <Text slot="label" tone="faint">{d.location} {i18n("auto.pages.Schedule.29")}</Text>
                <List divided gap={1}>
                  {d.clusterItems.map((m, i) => (
                    <Row
                      key={i}
                      size="sm"
                      titleAttr={i18n("auto.pages.Schedule.30")}
                      onClick={() => setDetail({ ...m })}
                      caret
                      title={m.src === "hw" ? `⏰ ${m.courseName}` : m.courseName}
                      meta={
                        <Text slot="label" tone="faint">
                          {m.src === "hw"
                            ? `${m.startTime}–${m.endTime}${m.hwMeta?.ext ? " · " + (m.hwMeta.source ?? "") : ""}`
                            : `${m.startTime ?? ""}–${m.endTime ?? ""}${m.location ? " @" + m.location : ""}`}
                        </Text>
                      }
                      trailing={
                        m.src === "hw" ? (
                          <Tag tone={m.hwMeta?.submitted ? "success" : "error"}>{m.hwMeta?.submitted ? "已提交" : "未提交"}</Tag>
                        ) : m.location ? (
                          <Text slot="label" tone="faint" nowrap>{m.location}</Text>
                        ) : undefined
                      }
                    />
                  ))}
                </List>
              </Stack>
            ) : (
              <Stack gap={2}>
                <KeyValue rows={[
                  { k: "名称", v: <Text slot="body" weight="semibold">{d.courseName}</Text> },
                  ...(isHw
                    ? [
                        ...(hwCourse ? [{ k: "课程", v: <Text slot="body">{hwCourse}</Text> }] : []),
                        ...(d.date ? [{ k: "截止", v: <Text slot="body">{`${d.date} ${d.endTime ?? ""}`.trim()}</Text> }] : []),
                        { k: "来源", v: <Text slot="body">{srcText}</Text> },
                        {
                          k: "状态",
                          v: (
                            <Tag tone={d.hwMeta?.submitted ? "success" : "error"}>
                              {d.hwMeta?.submitted ? "已提交" : "未提交"}
                            </Tag>
                          ),
                        },
                      ]
                    : [
                        ...(timeText ? [{ k: "时间", v: <Text slot="body">{timeText}</Text> }] : []),
                        ...(d.location ? [{ k: "地点", v: <Text slot="body">{d.location}</Text> }] : []),
                        ...(d.teacher ? [{ k: "教师", v: <Text slot="body">{d.teacher}</Text> }] : []),
                        { k: "来源", v: <Text slot="body">{i18n("auto.pages.Schedule.31")}{d.src === "exam" ? " · 考试" : " · 课程表"}</Text> },
                      ]),
                ]} />
                {/* 备注：作业给课程名提示，课程给"能否编辑"的说明 */}
                <Text slot="label" tone="faint">
                  {isHw
                    ? "作业来自网络学堂 / 外部作业源；「前往」会在新标签页打开这条作业。"
                    : "课程与考试来自教务系统数据，不能在此修改；自建日程点击即可编辑。"}
                </Text>
              </Stack>
            )}
          </Modal>
        );
      })()}

      {/* 事件编辑器弹窗（页面级：两视图共用）。busy 时遮罩/Esc/关闭全部闭锁（保存中不误关） */}
      {(() => {
        const sd = draft;
        if (!sd) return null;
        return (
          <Modal
            open
            onClose={() => { if (!busy) setDraft(null); }}
            maskClose={!busy}
            title={sd.uid ? "编辑日程" : "新建日程"}
            size="md"
            closeButton={false}
            foot={
              <Inline gap={2}>
                <Btn variant="solid" tone="brand" disabled={!sd.title.trim() || busy} onClick={() => void onSaveDraft()}>{busy ? "保存中…" : "保存"}</Btn>
                <Btn variant="outline" onClick={() => setDraft(null)}>{i18n("auto.pages.Schedule.32")}</Btn>
                <Spacer />
                {sd.uid ? (
                  <Btn variant="outline" disabled={busy} onClick={() => void onDeleteDraft()}>{i18n("auto.pages.Schedule.33")}</Btn>
                ) : null}
              </Inline>
            }
          >
            <Stack gap={2}>
              <Field label={i18n("auto.pages.Schedule.34")}>
                <Input value={sd.title} placeholder={i18n("auto.pages.Schedule.35")} onChange={(value) => setDraft({ ...sd, title: value })} />
              </Field>
              <Inline gap={2} wrap vAlign="end">
                <Grow>
                  {/* 原生 date/time 控件原样保留（OneGUI Input 的 type 枚举不含 date/time；
                      语义/取值格式 YYYY-MM-DD / HH:MM 零改动，外观走浏览器原生件） */}
                  <Field label={i18n("auto.pages.Schedule.36")}>
                    <input type="date" style={{ width: "100%" }} value={sd.date} onChange={(e) => setDraft({ ...sd, date: e.target.value })} aria-label={i18n("auto.pages.Schedule.36")} />
                  </Field>
                </Grow>
                <Checkbox checked={sd.allDay} onChange={(v2) => setDraft({ ...sd, allDay: v2 })} label={i18n("auto.pages.Schedule.37")} />
              </Inline>
              {!sd.allDay ? (
                <Inline gap={2} wrap>
                  <Grow>
                    <Field label={i18n("auto.pages.Schedule.38")}>
                      <input type="time" style={{ width: "100%" }} value={sd.start} onChange={(e) => setDraft({ ...sd, start: e.target.value })} aria-label={i18n("auto.pages.Schedule.39")} />
                    </Field>
                  </Grow>
                  <Grow>
                    <Field label={i18n("auto.pages.Schedule.40")}>
                      <input type="time" style={{ width: "100%" }} value={sd.end} onChange={(e) => setDraft({ ...sd, end: e.target.value })} aria-label={i18n("auto.pages.Schedule.16")} />
                    </Field>
                  </Grow>
                </Inline>
              ) : null}
              <Field label={i18n("auto.pages.Schedule.41")}>
                <Input value={sd.location} placeholder={i18n("auto.pages.Schedule.42")} onChange={(value) => setDraft({ ...sd, location: value })} />
              </Field>
              <Field label={i18n("auto.pages.Schedule.43")}>
                <Input value={sd.note} placeholder={i18n("auto.pages.Schedule.42")} onChange={(value) => setDraft({ ...sd, note: value })} />
              </Field>
              {simple ? null : (
                <Checkbox
                  checked={sd.toCloud}
                  disabled={!canCloud}
                  onChange={(v2) => setDraft({ ...sd, toCloud: v2 })}
                  label={`同步到云日历${canCloud ? "（其他设备 / 系统日历可见）" : "（未配置——设置页开启云同步）"}`}
                />
              )}
              {widgetHere ? (
                <Checkbox checked={sd.widget} onChange={(v2) => setDraft({ ...sd, widget: v2 })} label={i18n("auto.pages.Schedule.44")} />
              ) : null}
            </Stack>
          </Modal>
        );
      })()}
    </section>
  );
}
