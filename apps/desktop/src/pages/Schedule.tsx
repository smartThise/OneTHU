import { getLocale as getUiLocale } from "../i18n/index.js";
import { localizedList as i18nList } from "../i18n/index.js";
import { t as i18n, rich as i18nRich, useLocale as useUiLocale } from "../i18n/index.js";
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
 * 三种模式共用：作业 DDL / 云日历 / 系统日历与 .ics / 日程编辑器。
 * UI：OneGUI（Modal/Popover/Chip/Checkbox/Field/Text/Surface/Divider/Banner），
 * 内联样式只保留几何定位、网格线令牌与课块数据色（lib/courseColor 口径）。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { openTab } from "../state/explorer.js";
import { useIsSimpleLike } from "../state/experienceMode.js";
import { openHomeworkRow } from "../lib/homeworkEntry.js";
import type { Homework } from "@onethu/core";
import { PageAtomStar } from "../components/Collect.js";
import { Card, ErrorNote, PageHead } from "../components/Layout.js";
import { IconRefresh, IconSchedule } from "../components/Icons.js";
import { useCalendar, getCampusSnapshot, useLearnData, invalidateLearnCache, logPageError } from "../state/data.js";
import { useIgnoredHw } from "../state/hwIgnore.js";
import { useScheduleWindow, WINDOW_PRESETS, FULL_DAY, hhmm as hhmmWin } from "../state/scheduleWindow.js";
import { cacheGet, cacheSet } from "../state/cache.js";
import { isAuthError } from "@onethu/core";
import { softRecover } from "../lib/reload.js";
import { ScheduleAgenda } from "./ScheduleAgenda.js";
import type { AgendaItem } from "./ScheduleAgenda.js";
import { caldav } from "@onethu/core";
import type { ScheduleEntry } from "@onethu/core";
import { syncSystemCalendar, systemCalSupported, exportSystemCalendarIcs } from "../state/systemCal.js";
import {
  useCloudCal, syncCloudCal, getCloudCalConfig, ensureCloudCalLoaded,
  saveCalendarEvent, deleteCloudEvent, deleteLocalEvent,
} from "../state/cloudCal.js";
import { info } from "../lib/clients.js";
import { toHomework, useExternalHomework } from "../state/exthw.js";
import { useApp } from "../state/context.js";
import { usePlatformLayout } from "../state/usePlatformLayout.js";
import { courseColor, SRC_COLOR } from "../lib/courseColor.js";
import { useNotifyBackend } from "../components/useNotifyBackend.js";
import { openLocalPath } from "../lib/localFile.js";
import { scheduleHomework, type ScheduleHomework } from "../lib/scheduleHomework.js";
import { calendarDraftRange } from "../lib/calendarDraft.js";
import { confirmDanger } from "../lib/confirm.js";
import { appendSecondarySchedule } from "../lib/scheduleSecondary.js";

const DAY_NAMES = i18nList(["pages.schedule.c430f4c12eaa","pages.schedule.d1378a68e620","pages.schedule.2961168962be","pages.schedule.e9d3b01a5a00","pages.schedule.572388f3b096","pages.schedule.f9aa11dbb15c","pages.schedule.ee239f394329"]);
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
  /** 手动补充的课程（X-ONETHU-SRC=course-manual）：虚线描边 + 「手动」角标，一眼区别于教务数据 */
  manual?: boolean;
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
        courseName: i18n("pages.schedule.135b82866399", { length: String(members.length) }),
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
  source?: caldav.IcsEvent;
  sourceEmail?: string | null;
  title: string;
  date: string; // YYYY-MM-DD
  endDate: string; // inclusive for all-day, actual end date for timed events
  start: string; // HH:MM
  end: string; // HH:MM
  allDay: boolean;
  location: string;
  note: string;
  toCloud: boolean;
  originalCloud: boolean; // 编辑中的是云端事件
  /** 「在桌面小组件显示」：写进事件的私有标记（X-ONETHU-WIDGET），勾了才进桌面「今天」卡片 */
  widget: boolean;
  /** 日程 = 单次；课程 = 手动补充课程（按教学周重复，X-ONETHU-SRC=course-manual） */
  kind: "event" | "course";
  /** 课程模式：星期（1=周一 … 7=周日） */
  weekday: number;
  /** 课程模式：起止节次（1 起；时刻由节次表换算） */
  startSection: number;
  endSection: number;
  /** 课程模式：选中的教学周（1 起；空 = 一周都没选，保存时会被拦下） */
  weeks: number[];
}

const emptyDraft = (date: string, canCloud: boolean): Draft => ({
  title: "", date, endDate: date, start: "08:00", end: "09:35", allDay: false, location: "", note: "",
  toCloud: canCloud, originalCloud: false,
  // 默认不勾：自定义日程一直不上小组件，勾了才上（保持既有行为，避免存量日程突然挤进卡片）
  widget: false,
  // 课程模式默认按所选日期落在的星期几 + 第 3-4 节（与课表最常见的连堂一致）；周集合进课程模式时再铺满
  kind: "event", weekday: ((parseYmd(date).getDay() + 6) % 7) + 1, startSection: 3, endSection: 4, weeks: [],
});

/** 节次下拉选项（1..13 节；表尾那一项是 21:45 结束的第 14 节） */
const SECTION_OPTS = Array.from({ length: BEGIN_TIME.length - 1 }, (_, i) => i + 1);
/** 由时刻反推最近的一节（编辑别处建的事件、或补过课的事件缺 X-ONETHU-PERIOD 时用） */
function sectionOfTime(hm?: string): number {
  const m = hmToMin(hm);
  if (m == null) return 1;
  let best = 1;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const i of SECTION_OPTS) {
    const d = Math.abs((BEGIN_MIN[i] ?? 0) - m);
    if (d < bestDiff) { bestDiff = d; best = i; }
  }
  return best;
}

/** 草稿 → ICS 事件。课程模式把「星期 + 节次 + 周集合」换算成重复事件（core 的 courseWeeks）；
 *  一周都没选等参数不足返回 null，由调用方提示——不静默存一条坏事件。 */
function buildDraftEvent(
  draft: Draft,
  uid: string,
  semester: { firstDay: string; weekCount: number } | null,
): caldav.IcsEvent | null {
  const base = {
    ...draft.source,
    uid,
    summary: draft.title.trim(),
    location: draft.location.trim() || undefined,
    description: draft.note.trim() || undefined,
    // 桌面小组件「今天」卡片：勾了才带上这个私有标记（缺省不写 = 不上卡片）
    onethuWidget: draft.widget || undefined,
  };
  if (draft.kind === "event") {
    const { start, end } = calendarDraftRange(draft);
    // 从课程改回单次日程：重复相关的私有属性一律清掉，别把「哪几周上课」残留到新事件上
    return {
      ...base, start, end, allDay: draft.allDay, onethuSource: "manual",
      rrule: undefined, exdates: undefined, onethuWeeks: undefined, onethuPeriod: undefined,
    };
  }
  const startTime = BEGIN_TIME[draft.startSection] ?? "08:00";
  const endTime = END_TIME[draft.endSection] ?? END_TIME[draft.startSection] ?? "09:35";
  const series = caldav.buildCourseSeries({
    term: semester,
    weekday: draft.weekday,
    weeks: draft.weeks,
    startTime,
    endTime,
    from: draft.date,
  });
  if (!series) return null;
  return {
    ...base,
    start: series.start,
    end: series.end,
    allDay: false,
    rrule: series.rrule,
    exdates: series.exdates.length ? series.exdates : undefined,
    onethuSource: caldav.MANUAL_COURSE_SOURCE,
    onethuWeeks: series.weeks.length ? series.weeks : undefined,
    onethuPeriod: { start: draft.startSection, end: draft.endSection },
  };
}

export function SchedulePage() {
  const uiLocale = useUiLocale();

  // 展示时段（用户可选；默认全天）。放在最前：下面所有 y()/刻度都依赖它
  const [win, setWin] = useScheduleWindow();
  // Reuse any campus snapshot as fallback; do not start a second full-campus
  // crawl alongside the shared Learn request just to render this page.
  const campus = { data: getCampusSnapshot() };
  const calendar = useCalendar();
  const learn = useLearnData();
  const ignored = useIgnoredHw();
  const extHw = useExternalHomework();
  const cal = useCloudCal();
  const { status, navigate } = useApp();
  /** 三种模式共享日程与同步；简洁壳使用自己的导航出口。 */
  const simple = useIsSimpleLike();
  /** 本机有没有桌面小组件（只有 Android 有承载）：决定「在桌面小组件显示」是否出现在编辑器 */
  const widgetHere = useNotifyBackend() === "android";

  // 每次打开日程页自动云同步一次（失败静默——工具栏有手动入口与状态）
  useEffect(() => {
    void ensureCloudCalLoaded().then(() => {
      if (getCloudCalConfig()) return syncCloudCal();
    }).catch(() => undefined);
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
    [uiLocale, calendar.data],
  );
  /** anchor 自动检测：哪一年哪个学期第几周 */
  const detected = useMemo(() => detectSemester(anchor, semesters), [uiLocale, anchor, semesters]);


  /* ---------- 视图窗口 ---------- */
  const weekStart = useMemo(() => mondayOf(anchor), [uiLocale, anchor]);
  const viewWindow = useMemo((): [Date, Date] => {
    if (mode === "timetable") return [weekStart, new Date(weekStart.getTime() + 6 * 86_400_000)];
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    return [first, new Date(first.getFullYear(), first.getMonth() + 1, 0)];
  }, [uiLocale, mode, anchor, weekStart]);

  /* ---------- 时间轴数据：日期窗取数（不再依赖学期内） ---------- */
  const windowKey = `${ymdOf(viewWindow[0])}_${ymdOf(viewWindow[1])}`;
  /** 窗口课表。首屏先吃持久缓存（schedwin 是落过盘的）——以前从 null 起，
   *  每次进页都要等网络回来才出教务课，表现为「进去先空一下，只剩自定义日程/补课/DDL」
   *  （2026-10-26 手机实测）。缓存只在本窗口有值时采用，切周没有缓存就沿用旧行等网络。 */
  const [windowRows, setWindowRows] = useState<ScheduleEntry[] | null>(
    () => cacheGet<ScheduleEntry[]>(`schedwin:${windowKey}`)?.data ?? null,
  );
  const [winLoading, setWinLoading] = useState(false);
  const [winError, setWinError] = useState<string | null>(null);
  /** 弹层退场相位由 OneGUI Modal/Popover 的 Shell 附带（进退场+遮罩+Esc+滚动锁全部库承担），
   *  旧的页级 useExitHold 退场挂在两处弹窗上已随 Modal 化一并移除。 */
  /** 周窗失败自动重试计数（每窗口最多 2 次、间隔 4.2s）：选课死结借 lib 重登
   *  后教务/漫游会话重建需几秒，softRecover 的一次原地重取不够——静默自愈,
   *  红条不再吓人（2026-09-19 快速往返实录） */
  const winRetryRef = useRef<{ key: string; count: number }>({ key: "", count: 0 });
  /** 切周/切月：先把该窗口的持久缓存放上去（有缓存才能瞬间出课），再让下面的网络请求覆盖。 */
  useEffect(() => {
    const cached = cacheGet<ScheduleEntry[]>(`schedwin:${windowKey}`)?.data;
    if (cached) setWindowRows(cached);
  }, [windowKey]);
  useEffect(() => {
    if (mode !== "timetable") return; // 列表自取月窗
    let alive = true;
    setWinLoading(true);
    setWinError(null);
    const grab = (): Promise<void> =>
      info
        .getSchedule(ymdOf(viewWindow[0]), ymdOf(viewWindow[1]))
        .then(async (primary) => {
          if (!alive) return;
          // 二级课表（实验课）并入：core InfoClient 的 JSONP 只含一级——
          // 之前并错在无人调用的 useWeekSchedule（TICK=0 实锤），现在加在
          // 时间轴和列表共享窗口合并；校历就绪后按教学周展开。
          let rows = primary;
          try {
            const fd = calendar.data?.firstDay ?? "";
            if (fd) {
              rows = await appendSecondarySchedule(primary, fd, ymdOf(viewWindow[0]), ymdOf(viewWindow[1]));
            }
          } catch (err) {
            logPageError("SECONDARY-WEEK", err);
            if (alive) setWinError(i18n("schedule.secondary.refreshFailed"));
          }
          if (!alive) return;
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
  // 校历首次加载和学期起点更新后，补齐按教学周展开的二级课程。
  }, [mode, windowKey, reloadTick, status, calendar.data?.firstDay]);

  // Learn is the live source also used by the homework page. Campus is only a cold-cache fallback.
  const deadlines = useMemo(() => {
    const bundle = learn.data ?? campus.data;
    const courseNames = new Map(bundle?.courses.map((c) => [c.id, c.name]) ?? []);
    return scheduleHomework([...(bundle?.homework ?? []), ...extHw.items.map(toHomework)]
      .map((h) => ({ ...h, courseName: h.courseName || courseNames.get(h.courseId) })), ignored);
  }, [uiLocale, learn.data, campus.data, extHw.items, ignored]);
  const homeworkEntry = (item: ScheduleHomework): GridEntry => ({
    courseName: item.homework.title, location: item.homework.courseName,
    date: item.date, dayOfWeek: item.dayOfWeek, startTime: item.startTime, endTime: item.endTime,
    src: "hw", homework: item.homework,
    hwMeta: { submitted: !!item.homework.submitted, source: item.homework.source,
      courseName: item.homework.courseName, ext: !!item.homework.source },
  });

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
        for (let start = Math.max(o.start, lo); start < Math.min(o.end, hi + 1);) {
          const date = new Date(start);
          const nextDay = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
          const end = Math.min(o.end, nextDay, hi + 1);
          inWeek.push({
            courseName: o.summary, location: o.location, date: ymdOf(date),
            dayOfWeek: WD_INDEX(start) + 1, startTime: hmOfMs(start),
            endTime: end === nextDay ? "24:00" : hmOfMs(end), src, uid: o.uid,
            // 手动补充的课程：与教务课同格，但画虚线 + 角标（数据来自事件仓，可点开编辑）
            manual: caldav.isManualCourse(o) || undefined,
          });
          start = end;
        }
      }
    }
    for (const item of deadlines) {
      if (item.deadline < lo || item.deadline > hi) continue;
      inWeek.push(homeworkEntry(item));
    }
    // 重叠缩略：≥3 件重叠合并成"N 件事"簇块（扫描线极大区间）
    const clustered = clusterize(inWeek);
    return { entries: clustered, allDayChips: chips };
  }, [uiLocale, viewWindow, windowRows, campus.data, cal.cloudEvents, cal.localEvents, deadlines]);

  /* ── 铺满：可用高度 → 坐标轴（先定轴，layout/裁剪/渲染都跟着走） ── */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const headRef = useRef<HTMLDivElement | null>(null);
  /** 事件画布可用高度（= 时间表可视高 − 吸顶表头高），0 = 尚未量到（首帧） */
  const [availH, setAvailH] = useState(0);
  /** 课块里「标题能吃几行」要用的三个实测值（都从真实元素量，绝不在 TS 里写死档位值）：
   *   lh   —— 标题行高（手机 13.75px / 桌面 16.9px）；
   *   padV —— 块的内边距上下之和；
   *   subH —— 一条副行（地点/教师）实际占高；手机档 `.schedule-block-sub` 是 display:none，
   *           所以这里量出来是 0，标题就能吃满整块（此前按行高硬扣一条，白丢一行）。 */
  const [blockMetrics, setBlockMetrics] = useState({ lh: 16, padV: 8, subH: 14 });
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
      // 块还没画出来时保留上一轮的值（首帧用默认量级），画出来后自己纠正
      const blockEl = host.querySelector<HTMLElement>(".schedule-block");
      const titleEl = blockEl?.querySelector<HTMLElement>(".schedule-block-title");
      const subEl = blockEl?.querySelector<HTMLElement>(".schedule-block-sub");
      if (!titleEl) return;
      const lh = Number.parseFloat(getComputedStyle(titleEl).lineHeight);
      const bcs = getComputedStyle(blockEl as HTMLElement);
      const padV = (Number.parseFloat(bcs.paddingTop) || 0) + (Number.parseFloat(bcs.paddingBottom) || 0);
      // 副行被 CSS 藏起来时 rect 高度为 0 → subH=0，不给标题扣空间
      const subRect = subEl?.getBoundingClientRect().height ?? 0;
      const subH = subRect > 0 ? subRect + (Number.parseFloat(getComputedStyle(subEl as HTMLElement).marginTop) || 0) : 0;
      if (!Number.isFinite(lh) || lh <= 0) return;
      setBlockMetrics((prev) =>
        Math.abs(prev.lh - lh) >= 0.5 || Math.abs(prev.padV - padV) >= 0.5 || Math.abs(prev.subH - subH) >= 0.5
          ? { lh, padV, subH }
          : prev,
      );
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
  }, [mode, allDayChips.length, panelOpen, entries.length]);

  /** 收紧后的显示区间 + 每分钟像素：整周课表一屏放完（见 fitAxis） */
  const axis = useMemo(() => fitAxis(entries, win, availH), [uiLocale, entries, win, availH]);
  AXIS_BEGIN = axis.from;
  AXIS_END = axis.to;
  PX_PER_MIN = axis.pmm;
  /** 画布高度：正好填满可用高度（不滚动、不留白） */
  const canvasH = Math.max(1, Math.floor((axis.to - axis.from) * axis.pmm));

  const placed = useMemo(() => layout(entries), [uiLocale, entries, axis.from, axis.to]); // eslint-disable-line react-hooks/exhaustive-deps

  /* 落在展示时段内的块 + 它们的「行号」。placed 是按天（列）再按时间排的，直接用数组序号
     会变成竖直按列扫；入场应该按行（同一时间带跨天同时出现）、时间从早到晚自上而下。
     行号 = 该块起始时刻在所有不同起始时刻里的序号。 */
  const visiblePlaced = useMemo(
    () => placed.filter((p) => p.endMin > AXIS_BEGIN && p.beginMin < AXIS_END),
    [uiLocale, placed, axis.from, axis.to], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const blockRows = useMemo(() => {
    const keys = Array.from(new Set(visiblePlaced.map((p) => Math.max(p.beginMin, AXIS_BEGIN)))).sort((a, b) => a - b);
    const m = new Map<number, number>();
    keys.forEach((k, i) => m.set(k, i));
    return m;
  }, [uiLocale, visiblePlaced]);

  /** 所选周 7 个日期（时间轴表头） */
  const dayDates = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart.getTime() + i * 86_400_000);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    });
  }, [uiLocale, weekStart]);
  const todayStr = ymdOf(new Date());
  const inCurrentWeek = useMemo(() => {
    const w = mondayOf(new Date());
    return ymdOf(w) === ymdOf(weekStart);
  }, [uiLocale, weekStart]);
  const todayIdx = useMemo(() => (new Date().getDay() + 6) % 7, [uiLocale]);

  /** 半小时刻度序列（跟随收紧后的轴；起点对齐到 30 分钟刻度） */
  const halfHours = useMemo(() => {
    const out: number[] = [];
    const start = Math.ceil(axis.from / 30) * 30;
    for (let m = start; m <= axis.to; m += 30) out.push(m);
    return out;
  }, [uiLocale, axis.from, axis.to]);

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
  /** 补充课程用哪个学期定位周次：跟着跳转选择器（它默认跟随当前周所在学期），
   *  假期里浏览时也能选到最近那个学期——detected 在学期外是 null，用它会让周次整片消失。 */
  const termSem = jumpSem ? { firstDay: jumpSem.firstDay, weekCount: jumpSem.weekCount } : null;
  const allTermWeeks = useMemo(
    () => (jumpSem ? Array.from({ length: jumpSem.weekCount }, (_, i) => i + 1) : []),
    [jumpSem?.firstDay, jumpSem?.weekCount],
  );

  /* ---------- 两视图共用：同步 / 课表上云 / 系统日历 / 事件编辑 ---------- */
  const canCloud = cal.configured;

  const lastSyncText = cal.lastSyncAt ? i18n("pages.schedule.51fdbeb883e5", { value: String(new Date(cal.lastSyncAt).toLocaleTimeString(getUiLocale(), { hour: "2-digit", minute: "2-digit" })) }) : i18n("pages.schedule.e6618e00221b");

  const onSync = async (): Promise<void> => {
    setMsg(null);
    try {
      const r = await syncCloudCal();
      setMsg(i18n("pages.schedule.f0ba269cd55d", { total: String(r.total), added: String(r.added), updated: String(r.updated), removed: String(r.removed) }));
    } catch (err) {
      setMsg(i18n("pages.schedule.4d103a2b0e94", { value: String(err instanceof Error ? err.message : String(err)) }));
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
          setMsg(i18n("pages.schedule.09405e6ef9e6", { added: String(r.added), removed: String(r.removed) }));
        } catch (err) {
          setMsg(i18n("pages.schedule.77609a0fe15d", { value: String(err instanceof Error ? err.message : String(err)) }));
        }
        return;
      }
      const contents = await exportSystemCalendarIcs();
      const { invoke } = await import("@tauri-apps/api/core");
      const path = await invoke<string | null>("save_text_file", {
        filename: "OneTHU-日程.ics",
        contents,
      });
      if (!path) return; // 用户取消
      await openLocalPath(path);
      setMsg(i18n("pages.schedule.1258adb63f05"));
    } catch (err) {
      setMsg(i18n("pages.schedule.177a41a28139", { value: String(err instanceof Error ? err.message : String(err)) }));
    } finally {
      setBusy(false);
    }
  };

  const openEditByUid = (uid: string, kind: "cloud" | "local"): void => {
    const events = kind === "cloud" ? cal.cloudEvents : cal.localEvents;
    const src = events.find((e) => e.uid === uid && e.recurrenceId === undefined) ?? events.find((e) => e.uid === uid);
    if (!src) return;
    setMsg(null);
    setDetail(null); // 详情/编辑互斥
    const w = caldav.epochToWall("Asia/Shanghai", src.start);
    const we = caldav.epochToWall("Asia/Shanghai", src.end);
    const lastDay = caldav.epochToWall("Asia/Shanghai", src.allDay ? src.end - 1 : src.end);
    const course = caldav.isManualCourse(src);
    setDraft({
      source: { ...src },
      sourceEmail: kind === "cloud" ? cal.email : undefined,
      uid: src.uid, title: src.summary, date: `${w.y}-${padN(w.mo)}-${padN(w.d)}`,
      endDate: `${lastDay.y}-${padN(lastDay.mo)}-${padN(lastDay.d)}`,
      start: `${padN(w.h)}:${padN(w.mi)}`, end: `${padN(we.h)}:${padN(we.mi)}`,
      allDay: !!src.allDay, location: src.location ?? "", note: src.description ?? "",
      toCloud: kind === "cloud", originalCloud: kind === "cloud",
      // 原样带回：非 Android 上这个勾选框不显示，保存时也不会把标记抹掉
      widget: src.onethuWidget === true,
      // 手动补充的课程：星期取首场所在日，节次优先读私有属性（缺了按时刻反推），
      // 周集合读 X-ONETHU-WEEKS（外部编辑过、或降级模式建的事件可能没有）
      kind: course ? "course" : "event",
      weekday: ((new Date(Date.UTC(w.y, w.mo - 1, w.d)).getUTCDay() + 6) % 7) + 1,
      startSection: src.onethuPeriod?.start ?? sectionOfTime(`${padN(w.h)}:${padN(w.mi)}`),
      endSection: src.onethuPeriod?.end ?? src.onethuPeriod?.start ?? sectionOfTime(`${padN(we.h)}:${padN(we.mi)}`),
      weeks: course ? (src.onethuWeeks?.length ? [...src.onethuWeeks] : allTermWeeks) : [],
    });
  };
  /** 列表行：云/本可编辑，课程/考试/作业打开详情。 */
  const onAgendaEdit = (it: AgendaItem): void => {
    if (it.uid && (it.kind === "cloud" || it.kind === "local")) openEditByUid(it.uid, it.kind);
    else if (it.homework) setDetail(homeworkEntry(it.homework));
    else if (it.course) setDetail({ ...it.course, src: it.kind === "exam" ? "exam" : undefined });
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
      if (draft.originalCloud && draft.sourceEmail !== cal.email) throw new Error(i18n("pages.schedule.7e335ee498e8"));
      const uid = draft.uid ?? `onethu-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@onethu`;
      const ev = buildDraftEvent(draft, uid, termSem);
      if (!ev) {
        setMsg(i18n("pages.schedule.3250789593f5"));
        return;
      }
      await saveCalendarEvent(ev, { cloud: draft.toCloud, originalCloud: draft.uid ? draft.originalCloud : undefined });
      setDraft(null);
      if (draft.kind === "course") {
        const wk = ev.onethuWeeks?.length ?? 0;
        const day = DAY_NAMES[draft.weekday - 1] ?? "";
        setMsg(wk
          ? i18n("pages.schedule.5b689918b0f4", { day, weeks: String(wk) })
          : i18n("pages.schedule.49482ea2933f", { day }));
      } else setMsg(i18n("pages.schedule.193f229df3d9"));
    } catch (err) {
      setMsg(i18n("pages.schedule.a3299407580e", { value: String(err instanceof Error ? err.message : String(err)) }));
    } finally {
      setBusy(false);
    }
  };

  const onDeleteDraft = async (): Promise<void> => {
    if (!draft?.uid || busy) return;
    // 补充课程一删就是整学期全部场次（不像单次日程只删一场），先拦一下
    if (draft.kind === "course") {
      const ok = await confirmDanger(i18n("pages.schedule.24f1980e8772", { title: draft.title }), {
        title: i18n("pages.schedule.e8a71378fbee"),
        confirmText: i18n("pages.schedule.23bb69304bc2"),
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      if (draft.originalCloud && draft.sourceEmail !== cal.email) throw new Error(i18n("pages.schedule.b179143d79a6"));
      if (draft.originalCloud) await deleteCloudEvent(draft.uid, draft.source?.etag);
      else await deleteLocalEvent(draft.uid);
      setDraft(null);
      setMsg(i18n("pages.schedule.7ab942d11ed6"));
    } catch (err) {
      setMsg(i18n("pages.schedule.5e9e9ab95a7b", { value: String(err instanceof Error ? err.message : String(err)) }));
    } finally {
      setBusy(false);
    }
  };

  /** 新建默认日期：列表=所选日；时间轴=今天（在周内）否则周一 */
  const defaultDraftDate = mode === "agenda" ? selected : inCurrentWeek ? todayStr : ymdOf(weekStart);

  const label =
    mode === "timetable"
      ? i18n("pages.schedule.28ee8c1f603e", { value: String(weekStart.getMonth() + 1), value2: String(weekStart.getDate()), value3: String(new Date(weekStart.getTime() + 6 * 86_400_000).getDate()) })
      : i18n("pages.schedule.0f02af2d5985", { value: String(anchor.getFullYear()), value2: String(anchor.getMonth() + 1) });

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
      if (simple) navigate(page, params ?? undefined);
      else openTab(page, params, { title, forceNew: true });
    };
    setDetail(null); // 动作一律先关弹层，避免两个浮层叠着
    if (trace) {
      newTab("trace", { traceTarget: { title: d.courseName, location: d.location ?? "", date: d.date, startTime: d.startTime, endTime: d.endTime } }, i18n("pages.schedule.15f929ce6cd4", { courseName: String(d.courseName) }));
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
    const course = (learn.data ?? campus.data)?.courses.find((c) => c.id === d.courseId || c.name === d.courseName);
    if (course) {
      newTab("learn-course", { courseId: course.id }, course.name);
      return;
    }
    // 找不到对应课程（校外课/二级课表等）：仍开一个课程页新标签，不让按钮点了没反应
    setMsg(i18n("pages.schedule.b2e93997a40b", { courseName: String(d.courseName) }));
    newTab("learn", null, i18n("pages.schedule.60db1afb4022"));
  };
  return (
    <section className="schedule-workspace">
      {/* 用户口径：日程页不要大标题、也不要顶部按钮条 —— 页头只留页级 chrome 同步（0 高度） */}
      <PageHead title={null} />

      {/* 事件区：铺满中间全部内容区。所有控件都悬浮在它上面（右下/手机上右上的小圆钮） */}
      <div className="schedule-stage">
        {/* 通知浮层：取数失败/同步结果不占高度，不挤事件区 */}
        {msg || (winError && mode === "timetable") || calendar.state === "error" || learn.state === "error" ? (
          <div className="schedule-floats">
            {msg ? <Banner tone="info">{msg}</Banner> : null}
            {winError && mode === "timetable" ? (
              <ErrorNote text={i18n("pages.schedule.5e9a401745fa", { winError: String(winError) })} onRetry={() => setReloadTick((t) => t + 1)} />
            ) : null}
            {calendar.state === "error" ? (
              <ErrorNote text={i18n("pages.schedule.e017292c528c", { value: String(calendar.error ?? "") })} onRetry={() => void calendar.reload()} />
            ) : null}
            {learn.state === "error" ? (
              <ErrorNote text={i18n("pages.schedule.c728528fbd8f", { value: String(learn.error ?? "") })} onRetry={() => void learn.reload()} />
            ) : null}
          </div>
        ) : null}

        {mode === "agenda" ? (
          <div className="schedule-scroll">
            <ScheduleAgenda
              courses={campus.data?.schedule ?? []}
              homework={deadlines}
              refreshKey={reloadTick}
              firstDay={calendar.data?.firstDay}
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
                  >{i18nRich("pages.schedule.be7a93a8502e", { label: c.label })}</Chip>
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
                      <Text tone="faint">{winLoading ? i18n("pages.schedule.48cbf2cb0bd7") : i18n("pages.schedule.310a9aa08211")}</Text>
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
                  const showLocation = !compact && !!p.entry.location;
                  const showTeacher = !compact && height > 88 && !!p.entry.teacher;
                  // 标题能吃几行：块高扣掉**实测**内边距与**真实占位**的副行（手机档副行
                  // display:none → subH=0，标题吃满整块），剩下的都留给标题。
                  // +0.25 只是吃掉亚像素：块高是小数，floor 直接切会把「正好放得下」的一行判掉
                  // （桌面 74px 的块因此从 3 行掉到 2 行）。
                  const innerH = height - blockMetrics.padV - ((showLocation ? blockMetrics.subH : 0) + (showTeacher ? blockMetrics.subH : 0));
                  const titleLines = Math.max(
                    1,
                    Math.min(40, Math.floor((innerH + 0.25) / Math.max(blockMetrics.lh, 1))),
                  );
                  // 入场错峰：按「行」（时间带）递延——同一时刻跨天的块同时出现，从早到晚自上而下
                  const delay = Math.min(blockRows.get(Math.max(p.beginMin, AXIS_BEGIN)) ?? 0, 16) * 13;
                  return (
                    <div
                      key={`b-${ymdOf(weekStart)}-${i}`}
                      data-tx="keep"
                      data-vault-catch={vaultCatchSchedule({ title: p.entry.courseName, kind: p.entry.src === "hw" ? i18n("pages.schedule.9b702fb32d62") : i18n("pages.schedule.60db1afb4022"), date: ymdOf(weekStart), location: p.entry.location, note: `${hhmm(p.beginMin)}–${hhmm(p.endMin)}` })}
                      className={
                        "schedule-block"
                        + (compact ? " is-compact" : "")
                        + (p.entry.src === "hw" && p.entry.hwMeta?.submitted ? " is-done" : "")
                        + (p.entry.manual ? " is-manual" : "")
                      }
                      title={
                        p.entry.src === "cluster"
                          ? i18n("pages.schedule.62502d2d618b", { courseName: String(p.entry.courseName), value: String(hhmm(p.beginMin)), value2: String(hhmm(p.endMin)), value3: String(p.entry.clusterItems?.map((m) => `${m.courseName}${m.location ? "@" + m.location : ""}`).join("；")) })
                          : p.entry.src === "hw"
                            ? i18n("pages.schedule.368cc0699764", { courseName: String(p.entry.courseName), value: String(p.entry.location ?? ""), value2: String(hhmm(p.beginMin)), value3: String(hhmm(p.endMin)), value4: String(p.entry.hwMeta?.submitted ? i18n("pages.schedule.bc37a6110a07") : i18n("pages.schedule.8032af4a590f")), value5: String(p.entry.hwMeta?.ext ? p.entry.hwMeta.source ?? i18n("pages.schedule.72d71f2db0b4") : i18n("pages.schedule.aa39cac2b409")) })
                            : `${p.entry.courseName}${p.entry.teacher ? " · " + p.entry.teacher : ""}${
                                p.entry.location ? " @" + p.entry.location : ""
                              }（${hhmm(p.beginMin)}–${hhmm(p.endMin)}）${p.entry.src === "cloud" || p.entry.src === "local" ? i18n("pages.schedule.8fa104ed3b07") : i18n("pages.schedule.6861d0375b15")}${p.entry.manual ? i18n("pages.schedule.3efd4faf6df0") : ""}`
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
                        // 标题行数按块高给（见 titleLines），长日程不再被固定 3 行截断
                        "--og-c-schedule-clamp": String(titleLines),
                      } as React.CSSProperties}
                    >
                      {p.entry.manual ? <div className="schedule-block-manual">{i18n("pages.schedule.962f41ef825b")}</div> : null}
                      <div className="schedule-block-title">
                        {p.entry.src === "hw" ? `⏰ ${p.entry.courseName}` : p.entry.courseName}
                      </div>
                      {showLocation ? (
                        <div className="schedule-block-sub">
                          <Text slot="micro" clamp={height > 72 ? 3 : 2}>{p.entry.location}</Text>
                        </div>
                      ) : null}
                      {showTeacher ? (
                        <div className="schedule-block-sub">
                          <Text slot="micro" nowrap>{p.entry.teacher}</Text>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
            {/* 表格下方的呼吸区：只给滚动余量，让最末几行能滚到右下浮件之上再点。
                在 .schedule-body 之外，不参与 availH → 表体尺寸不变。 */}
            <div className="schedule-canvas-tail" aria-hidden="true" />
            </div>
          </>
        )}

        {/* 唯一常驻控件：一颗悬浮小圆钮，点开 = 全部设置（周切换/视图/筛选/同步/新建/收藏） */}
        <div className="schedule-dock" ref={dockRef}>
          <Btn
            variant="solid"
            tone="brand"
            size="sm"
            aria-label={i18n("pages.schedule.dd5376aed47e")}
            aria-expanded={panelOpen}
            titleAttr={i18n("pages.schedule.4de047cb8209")}
            onClick={() => setPanelOpen((v) => !v)}
            icon={<IconSchedule width={16} height={16} />}
          />
          <Popover
            open={panelOpen}
            onClose={() => setPanelOpen(false)}
            anchor={dockRef.current}
            side={tier === "expanded" ? "top" : "bottom"}
            align="center"
            label={i18n("pages.schedule.dd5376aed47e")}
          >
            <div className="schedule-panel">
              {/* 周导航：时间轴恒以周为单位 */}
              <div className="schedule-panel-block">
                <Text slot="micro" tone="faint">{i18n("pages.schedule.f041b6d0cdd4")}</Text>
                <div className="schedule-panel-row">
                  <Btn variant="outline" size="sm" titleAttr={mode === "timetable" ? i18n("pages.schedule.c0b859346782") : i18n("pages.schedule.f9e727223456")} aria-label={mode === "timetable" ? i18n("pages.schedule.c0b859346782") : i18n("pages.schedule.f9e727223456")} onClick={() => setAnchor(stepAnchor(-1))}>‹</Btn>
                  <Btn
                    className="schedule-panel-grow schedule-panel-label"
                    variant="outline"
                    size="sm"
                    aria-expanded={calOpen}
                    titleAttr={i18n("pages.schedule.a80ca7344396")}
                    onClick={() => setCalOpen((v) => !v)}
                  >{label}</Btn>
                  <Btn variant="outline" size="sm" titleAttr={mode === "timetable" ? i18n("pages.schedule.31da7d33b80d") : i18n("pages.schedule.3e0b634699d4")} aria-label={mode === "timetable" ? i18n("pages.schedule.31da7d33b80d") : i18n("pages.schedule.3e0b634699d4")} onClick={() => setAnchor(stepAnchor(1))}>›</Btn>
                  <Btn variant="outline" size="sm" onClick={() => { setAnchor(new Date()); setSelected(todayStr); }}>{i18n("pages.schedule.b4c6c3eb0bce")}</Btn>
                </div>
                <div className="schedule-panel-row">
                  <Text slot="label" tone="faint">
                    {detected ? i18n("pages.schedule.dba0129db99f", { value: String(detected.sem.semesterName || detected.sem.semesterId), weekNo: String(detected.weekNo) }) : i18n("pages.schedule.3c3687e79a53")}
                  </Text>
                </div>
                {calOpen ? (
                  <div className="schedule-cal">
                    <div className="schedule-cal-head">
                      <Btn variant="ghost" size="sm" titleAttr={i18n("pages.schedule.43cecd06c54d")} onClick={() => calShift(-12)}>«</Btn>
                      <Btn variant="ghost" size="sm" titleAttr={i18n("pages.schedule.58dcda214bad")} onClick={() => calShift(-1)}>‹</Btn>
                      <div className="schedule-cal-title"><Text weight="semibold">{i18nRich("pages.schedule.0f02af2d5985", { value: calView.getFullYear(), value2: calView.getMonth() + 1 })}</Text></div>
                      <Btn variant="ghost" size="sm" titleAttr={i18n("pages.schedule.c0eb0fdf8c4e")} onClick={() => calShift(1)}>›</Btn>
                      <Btn variant="ghost" size="sm" titleAttr={i18n("pages.schedule.30fd49298c03")} onClick={() => calShift(12)}>»</Btn>
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
                      {mode === "timetable" ? i18n("pages.schedule.88a5267852f9") : i18n("pages.schedule.c533aa41c064")}
                    </Text>
                  </div>
                ) : null}
              </div>

              {/* 视图：时间轴（周网格）/ 列表（月历 + 所选日清单） */}
              <div className="schedule-panel-block">
                <Text slot="micro" tone="faint">{i18n("pages.schedule.1c5c06713870")}</Text>
                <div className="schedule-panel-row">
                  {([["timetable", i18n("pages.schedule.46005f62ee0e")], ["agenda", i18n("pages.schedule.aedd6814ff8c")]] as const).map(([m, lbl]) => (
                    <Chip key={m} size="sm" selected={mode === m} onClick={() => pickMode(m)}>{lbl}</Chip>
                  ))}
                </div>
              </div>

              {/* 筛选：显示时段（只影响画布，不改数据；默认全天） */}
              <div className="schedule-panel-block">
                <Text slot="micro" tone="faint">{i18nRich("pages.schedule.2589da741b80", { value: hhmmWin(win.from), value2: hhmmWin(win.to) })}</Text>
                <div className="schedule-panel-row">
                  <Select size="sm" aria-label={i18n("pages.schedule.0eaedd12dc70")} value={win.from} onChange={(v) => setWin({ ...win, from: Number(v) })}>
                    {WIN_FROM_OPTS.map((m) => (<option key={m} value={m}>{hhmmWin(m)}</option>))}
                  </Select>
                  <Select size="sm" aria-label={i18n("pages.schedule.f50276449943")} value={win.to} onChange={(v) => setWin({ ...win, to: Number(v) })}>
                    {WIN_TO_OPTS.map((m) => (<option key={m} value={m}>{hhmmWin(m)}</option>))}
                  </Select>
                </div>
                <div className="schedule-panel-row">
                  {WINDOW_PRESETS.map((p) => (
                    <Chip key={p.label} size="sm" selected={win.from === p.win.from && win.to === p.win.to} onClick={() => setWin(p.win)}>
                      {p.label}
                    </Chip>
                  ))}
                  <Btn size="sm" variant="outline" onClick={() => setWin(FULL_DAY)}>{i18n("pages.schedule.702b1048fceb")}</Btn>
                </div>
              </div>

              {/* 学期 / 周跳转 */}
              {semesters.length > 0 ? (
                <div className="schedule-panel-block">
                  <Text slot="micro" tone="faint">{i18n("pages.schedule.1536c81c69be")}</Text>
                  <div className="schedule-panel-row">
                    <Select size="sm" aria-label={i18n("pages.schedule.79a4ef019e9c")} value={Math.min(jumpSemIdx, semesters.length - 1)} onChange={(v) => {
                      const i = Number(v);
                      setJumpSemIdx(i);
                      setJumpWeek((w) => Math.min(w, semesters[i]?.weekCount ?? w));
                    }}>
                      {semesters.map((sm, i) => (
                        <option key={sm.semesterId || i} value={i}>{sm.semesterName || sm.semesterId || i18n("pages.schedule.c8d7c83a9995", { value: String(i + 1) })}</option>
                      ))}
                    </Select>
                    <Select size="sm" aria-label={i18n("pages.schedule.fa2110dcaa1b")} value={jumpWeek} onChange={(v) => setJumpWeek(Number(v))}>
                      {Array.from({ length: jumpSem?.weekCount ?? 20 }, (_, i) => i + 1).map((w) => (
                        <option key={w} value={w}>{i18nRich("pages.schedule.ce708f891fc3", { w: w })}</option>
                      ))}
                    </Select>
                    <Btn size="sm" variant="outline" onClick={goSemWeek}>{i18n("pages.schedule.fa96079c3b2f")}</Btn>
                  </div>
                </div>
              ) : null}

              {/* 同步在三种模式共用；切换模式不改变保存目标与同步配置。 */}
              <div className="schedule-panel-block">
                <Text slot="micro" tone="faint">{canCloud ? `${cal.email} · ${lastSyncText}` : i18n("pages.schedule.4f9f7bd42e5d")}</Text>
                {cal.error ? <Text slot="micro" tone="error">{cal.error}</Text> : null}
                {learn.error ? <Text slot="micro" tone="error">{i18nRich("pages.schedule.6d338c4a9155", { error: learn.error })}</Text> : null}
                {Object.keys(extHw.errors).length ? <Text slot="micro" tone="error">{i18n("pages.schedule.aa5750053364")}</Text> : null}
                <div className="schedule-panel-row">
                  <Btn size="sm" variant="outline" onClick={() => void onSync()} disabled={!canCloud || cal.syncing} icon={<IconRefresh width={14} height={14} />}>
                    {cal.syncing ? i18n("pages.schedule.4e2238b74ec7") : i18n("pages.schedule.07c9a15ad13f")}
                  </Btn>
                  <Btn size="sm" variant="outline" onClick={() => void onSystemCal()} disabled={busy}>
                    {sysNative === false ? i18n("pages.schedule.exportIcs") : i18n("pages.schedule.ad6d92fd400c")}
                  </Btn>
                  <Btn size="sm" variant="outline" disabled={winLoading} icon={<IconRefresh width={14} height={14} />} onClick={() => {
                    setReloadTick((t) => t + 1);
                    if (!calendar.data) void calendar.reload();
                    invalidateLearnCache();
                    void learn.reload();
                    extHw.reload();
                  }}>{i18n("pages.schedule.aee887434131")}</Btn>
                </div>
              </div>

              {/* 新建 + 收藏本页 */}
              <div className="schedule-panel-row">
                <Btn variant="solid" tone="brand" size="sm" onClick={() => { setMsg(null); setDraft(emptyDraft(defaultDraftDate, canCloud)); setPanelOpen(false); }}>{i18n("pages.schedule.5e6a5170f6ac")}</Btn>
                <Btn
                  variant="outline"
                  size="sm"
                  titleAttr={i18n("pages.schedule.bf5f1fb73ab8")}
                  onClick={() => { setMsg(null); setDraft({ ...emptyDraft(defaultDraftDate, canCloud), kind: "course", weeks: allTermWeeks }); setPanelOpen(false); }}
                >{i18n("pages.schedule.69dc0db37f4c")}</Btn>
                <Spacer />
                <PageAtomStar atomKey="schedule" title={i18n("pages.schedule.a14f23af7016")} />
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
            : d.src === "exam" ? i18n("pages.schedule.302f7d04d98f") : i18n("pages.schedule.22519a88484f");
        /** 时间行：真实时刻优先，退到节次 */
        const ddl = d.homework ? deadlines.find((item) => item.homework.id === d.homework?.id) : undefined;
        const timeText = ddl ? i18n("pages.schedule.823ed2175ed0", { date: String(ddl.date), time: String(ddl.time) }) : d.date && (d.startTime || d.endTime)
          ? `${d.date}${d.startTime && d.endTime ? ` ${d.startTime}–${d.endTime}` : ""}`
          : d.startSection ? i18n("pages.schedule.3a4fe1c0f0d6", { startSection: String(d.startSection), value: String(d.endSection ?? d.startSection) }) : "";
        const srcText = d.hwMeta?.ext ? (d.hwMeta.source ?? i18n("pages.schedule.72d71f2db0b4")) : i18n("pages.schedule.aa39cac2b409");
        /** 作业所属课程：网络学堂作业的 courseName 由 courseId 映射补全（hwMeta.courseName） */
        const hwCourse = isHw ? (d.hwMeta?.courseName || d.homework?.courseName || d.location || "") : "";
        return (
          <Modal open onClose={() => setDetail(null)} title={title} size="md" closeButton={false}
            foot={
              <Inline gap={2} justify="end">
                {d.clusterItems ? null : isHw ? (
                  d.homework ? <Btn variant="solid" tone="brand" onClick={() => gotoDetail(d)}>{i18n("pages.schedule.fa96079c3b2f")}</Btn> : null
                ) : (
                  <>
                    <Btn variant="solid" tone="brand" onClick={() => gotoDetail(d)}>{i18n("pages.schedule.fa96079c3b2f")}</Btn>
                    {simple ? null : <Btn variant="outline" disabled={!d.location} titleAttr={d.location ? i18n("pages.schedule.741addee8c05", { location: String(d.location) }) : i18n("pages.schedule.32eb57893bcb")} onClick={() => gotoDetail(d, true)}>{i18n("pages.schedule.60458dfb4c14")}</Btn>}
                  </>
                )}
                <Btn variant="outline" onClick={() => setDetail(null)}>{i18n("pages.schedule.3fd47edce45b")}</Btn>
              </Inline>
            }
          >
            {d.clusterItems ? (
              // 重叠簇详情：列出该时段全部事项
              <Stack gap={2}>
                <Text slot="label" tone="faint">{i18nRich("pages.schedule.7431d8a58c9b", { location: d.location })}</Text>
                <List divided gap={1}>
                  {d.clusterItems.map((m, i) => (
                    <Row
                      key={i}
                      size="sm"
                      titleAttr={i18n("pages.schedule.ebfa3e62fea6")}
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
                          <Tag tone={m.hwMeta?.submitted ? "success" : "error"}>{m.hwMeta?.submitted ? i18n("pages.schedule.bc37a6110a07") : i18n("pages.schedule.8032af4a590f")}</Tag>
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
                  { k: i18n("pages.schedule.d44e9b3d3b31"), v: <Text slot="body" weight="semibold">{d.courseName}</Text> },
                  ...(isHw
                    ? [
                        ...(hwCourse ? [{ k: i18n("pages.schedule.60db1afb4022"), v: <Text slot="body">{hwCourse}</Text> }] : []),
                        ...(ddl ? [{ k: i18n("pages.schedule.fb37c61898d5"), v: <Text slot="body">{i18n("pages.schedule.823ed2175ed0", { date: String(ddl.date), time: String(ddl.time) })}</Text> }] : []),
                        { k: i18n("pages.schedule.a488e93d69cc"), v: <Text slot="body">{srcText}</Text> },
                        {
                          k: i18n("pages.schedule.6320b4a8722a"),
                          v: (
                            <Tag tone={d.hwMeta?.submitted ? "success" : "error"}>
                              {d.hwMeta?.submitted ? i18n("pages.schedule.bc37a6110a07") : i18n("pages.schedule.8032af4a590f")}
                            </Tag>
                          ),
                        },
                      ]
                    : [
                        ...(timeText ? [{ k: i18n("pages.schedule.8b6ff498515b"), v: <Text slot="body">{timeText}</Text> }] : []),
                        ...(d.location ? [{ k: i18n("pages.schedule.253ac66fb8e1"), v: <Text slot="body">{d.location}</Text> }] : []),
                        ...(d.teacher ? [{ k: i18n("pages.schedule.a6654120cbec"), v: <Text slot="body">{d.teacher}</Text> }] : []),
                        { k: i18n("pages.schedule.a488e93d69cc"), v: <Text slot="body">{i18nRich("pages.schedule.c1c41b33594e", { value: d.src === "exam" ? i18n("pages.schedule.af3a93e86aa6") : i18n("pages.schedule.1e1dc2f018da") })}</Text> },
                      ]),
                ]} />
                {/* 备注：作业给课程名提示，课程给"能否编辑"的说明 */}
                <Text slot="label" tone="faint">
                  {isHw
                    ? i18n("pages.schedule.70af7a03daec", { value: String(simple ? "" : i18n("pages.schedule.efa33939d466")) })
                    : i18n("pages.schedule.4f8a1b346d71")}
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
            title={
              sd.kind === "course"
                ? (sd.uid ? i18n("pages.schedule.3b956ae57c11") : i18n("pages.schedule.1ebab46534d7"))
                : sd.uid ? i18n("pages.schedule.a3064785f1db") : i18n("pages.schedule.5090d53a1cce")
            }
            size="md"
            closeButton={false}
            foot={
              <Inline gap={2}>
                <Btn variant="solid" tone="brand" disabled={!sd.title.trim() || busy} onClick={() => void onSaveDraft()}>{busy ? i18n("pages.schedule.ff509c9ba052") : i18n("pages.schedule.a3030bf8f16d")}</Btn>
                <Btn variant="outline" disabled={busy} onClick={() => setDraft(null)}>{i18n("pages.schedule.2cd0f3be8738")}</Btn>
                <Spacer />
                {sd.uid ? (
                  <Btn variant="outline" disabled={busy} onClick={() => void onDeleteDraft()}>{i18n("pages.schedule.2f9daa828907")}</Btn>
                ) : null}
              </Inline>
            }
          >
            <Stack gap={2}>
              {msg ? <Banner tone="info">{msg}</Banner> : null}
              {sd.source?.rrule ? <Text slot="label" tone="quiet">{i18n("pages.schedule.3df7a207af75")}</Text> : null}
              {/* 类型切换：日程 = 单次；课程 = 手动补充课程（按教学周重复，与课表同一套渲染与提醒） */}
              <Inline gap={2} wrap>
                <Btn
                  size="sm"
                  variant={sd.kind === "event" ? "solid" : "outline"}
                  tone={sd.kind === "event" ? "brand" : undefined}
                  onClick={() => setDraft({ ...sd, kind: "event" })}
                >{i18n("pages.schedule.a14f23af7016")}</Btn>
                <Btn
                  size="sm"
                  variant={sd.kind === "course" ? "solid" : "outline"}
                  tone={sd.kind === "course" ? "brand" : undefined}
                  onClick={() => setDraft({ ...sd, kind: "course", weeks: sd.weeks.length === 0 ? allTermWeeks : sd.weeks })}
                >{i18n("pages.schedule.60db1afb4022")}</Btn>
                <Text slot="label" tone="faint">
                  {sd.kind === "course" ? i18n("pages.schedule.5ed5d4ca9267") : i18n("pages.schedule.3de42d7c68d4")}
                </Text>
              </Inline>
              <Field label={sd.kind === "course" ? i18n("pages.schedule.bd2d74b297d1") : i18n("pages.schedule.c3405f8c7d9d")}>
                <Input
                  value={sd.title}
                  placeholder={sd.kind === "course" ? i18n("pages.schedule.8f7458eac2d1") : i18n("pages.schedule.bd2f0b059d14")}
                  onChange={(value) => setDraft({ ...sd, title: value })}
                />
              </Field>
              {sd.kind === "course" ? (
                <>
                  <Field label={i18n("pages.schedule.c398134d7d1f")}>
                    <Inline gap={1} wrap>
                      {DAY_NAMES.map((nm, i) => (
                        <Chip key={i} size="sm" selected={sd.weekday === i + 1} onClick={() => setDraft({ ...sd, weekday: i + 1 })}>{nm}</Chip>
                      ))}
                    </Inline>
                  </Field>
                  <Inline gap={2} wrap>
                    <Grow>
                      <Field label={i18n("pages.schedule.c1f97f31c023")}>
                        <Select
                          value={sd.startSection}
                          options={SECTION_OPTS.map((i) => ({ value: String(i), label: i18n("pages.schedule.a964fe70e5e6", { section: String(i), time: BEGIN_TIME[i] ?? "" }) }))}
                          onChange={(value) => {
                            const s = Number(value);
                            setDraft({ ...sd, startSection: s, endSection: Math.max(s, sd.endSection) });
                          }}
                        />
                      </Field>
                    </Grow>
                    <Grow>
                      <Field label={i18n("pages.schedule.20ced3c8340f")}>
                        <Select
                          value={sd.endSection}
                          options={SECTION_OPTS.map((i) => ({ value: String(i), label: i18n("pages.schedule.a964fe70e5e6", { section: String(i), time: END_TIME[i] ?? "" }) }))}
                          onChange={(value) => {
                            const s = Number(value);
                            setDraft({ ...sd, endSection: s, startSection: Math.min(s, sd.startSection) });
                          }}
                        />
                      </Field>
                    </Grow>
                  </Inline>
                  <Text slot="label" tone="quiet">
                    {i18n("pages.schedule.be1d861b1fbd", {
                      from: String(sd.startSection),
                      to: String(sd.endSection),
                      start: BEGIN_TIME[sd.startSection] ?? "",
                      end: END_TIME[sd.endSection] ?? "",
                      day: DAY_NAMES[sd.weekday - 1] ?? "",
                    })}
                    {sd.weeks.length > 0 && termSem
                      ? ` · ${i18n("pages.schedule.779484a49347", { date: caldav.weekDate(termSem, sd.weeks[0]!, sd.weekday) ?? "" })}`
                      : ""}
                  </Text>
                  <Field label={
                    i18n("pages.schedule.3cab37ff0f67")
                    + (allTermWeeks.length ? i18n("pages.schedule.700c075b7ac3", { max: String(allTermWeeks.length), count: String(sd.weeks.length) }) : "")
                  }>
                    {allTermWeeks.length ? (
                      <>
                        <Inline gap={1} wrap>
                          {allTermWeeks.map((w) => {
                            const on = sd.weeks.includes(w);
                            return (
                              <Chip
                                key={w}
                                size="sm"
                                selected={on}
                                onClick={() => setDraft({
                                  ...sd,
                                  weeks: on ? sd.weeks.filter((x) => x !== w) : [...sd.weeks, w].sort((a, b) => a - b),
                                })}
                              >{String(w)}</Chip>
                            );
                          })}
                        </Inline>
                        <Inline gap={2} wrap>
                          <Btn size="sm" variant="outline" onClick={() => setDraft({ ...sd, weeks: allTermWeeks })}>{i18n("pages.schedule.5c55a67935af")}</Btn>
                          <Btn size="sm" variant="outline" onClick={() => setDraft({ ...sd, weeks: allTermWeeks.filter((w) => w % 2 === 1) })}>{i18n("pages.schedule.5fabbd38239b")}</Btn>
                          <Btn size="sm" variant="outline" onClick={() => setDraft({ ...sd, weeks: allTermWeeks.filter((w) => w % 2 === 0) })}>{i18n("pages.schedule.53aeb191865a")}</Btn>
                          <Btn size="sm" variant="outline" onClick={() => setDraft({ ...sd, weeks: [] })}>{i18n("pages.schedule.1ef3de06b32e")}</Btn>
                          <Text slot="label" tone="faint">{i18n("pages.schedule.e0cbef4fe9db")}</Text>
                        </Inline>
                      </>
                    ) : (
                      <Text slot="label" tone="quiet">{i18n("pages.schedule.dd641ee0defa")}</Text>
                    )}
                  </Field>
                </>
              ) : (
                <>
                  <Inline gap={2} wrap vAlign="end">
                    <Grow>
                      <Field label={i18n("pages.schedule.760506491eef")}>
                        <Input type="date" value={sd.date} onChange={(value) => setDraft({ ...sd, date: value, endDate: sd.endDate < value ? value : sd.endDate })} aria-label={i18n("pages.schedule.760506491eef")} />
                      </Field>
                    </Grow>
                    <Grow>
                      <Field label={sd.allDay ? i18n("pages.schedule.ce40d3d5810a") : i18n("pages.schedule.895cd52fbbb6")}>
                        <Input type="date" value={sd.endDate} min={sd.date} onChange={(value) => setDraft({ ...sd, endDate: value })} aria-label={i18n("pages.schedule.895cd52fbbb6")} />
                      </Field>
                    </Grow>
                    <Checkbox checked={sd.allDay} onChange={(v2) => setDraft({ ...sd, allDay: v2 })} label={i18n("pages.schedule.0b97c851e4a7")} />
                  </Inline>
                  {!sd.allDay ? (
                    <Inline gap={2} wrap>
                      <Grow>
                        <Field label={i18n("pages.schedule.d2bb025a2e51")}>
                          <Input type="time" value={sd.start} onChange={(value) => setDraft({ ...sd, start: value })} aria-label={i18n("pages.schedule.6a9906c79f26")} />
                        </Field>
                      </Grow>
                      <Grow>
                        <Field label={i18n("pages.schedule.c7b24e7997e9")}>
                          <Input type="time" value={sd.end} onChange={(value) => setDraft({ ...sd, end: value })} aria-label={i18n("pages.schedule.f50276449943")} />
                        </Field>
                      </Grow>
                    </Inline>
                  ) : null}
                </>
              )}
              <Field label={i18n("pages.schedule.253ac66fb8e1")}>
                <Input value={sd.location} placeholder={i18n("pages.schedule.537352400c49")} onChange={(value) => setDraft({ ...sd, location: value })} />
              </Field>
              <Field label={i18n("pages.schedule.daede9881787")}>
                <Input value={sd.note} placeholder={i18n("pages.schedule.537352400c49")} onChange={(value) => setDraft({ ...sd, note: value })} />
              </Field>
              <Checkbox
                  checked={sd.toCloud}
                  disabled={!canCloud}
                  onChange={(v2) => setDraft({ ...sd, toCloud: v2 })}
                  label={i18n("pages.schedule.93cfacc290a0", { value: String(canCloud ? i18n("pages.schedule.df071eb5a79b") : i18n("pages.schedule.e046ece55b12")) })}
                />
              {/* 只给自定义日程：补充课程走课程通道，卡片按课行无条件显示（当天有课就有），
                  这个标记读了也没用——课程模式下不显示这个勾了不生效的开关 */}
              {widgetHere && sd.kind !== "course" ? (
                <Checkbox checked={sd.widget} onChange={(v2) => setDraft({ ...sd, widget: v2 })} label={i18n("pages.schedule.b0e3601510d8")} />
              ) : null}
            </Stack>
          </Modal>
        );
      })()}
    </section>
  );
}
