/** 校园数据钩子：真实模式取自 @onethu/core；演示模式返回 demo 数据（界面明确标注）。 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { XkCourseDetail, ZhjwxkSession, BasicUserInfo, CalendarData, CalendarSemester, CardInfo, CardTransaction, CourseFile, CourseInfo, DeadlineItem, ExamEntry, Homework, NewsItem, Notification, QueueCandidate, ReportRow, ScheduleEntry, SelectedCourse, SemesterInfo, XkCourse, XkFlag, XkLevelTableRow, XkQueueInfo, XkSelectedRow, XkVolInfo } from "@onethu/core";
import {
  changeXkVolunteer,
  dropXkCourse,
  getQueueStatus,
  getSelectedCourses,
  getXkCourseDetail,
  getXkLevelTable,
  getXkPlan,
  getXkSelectedFull,
  getXkQueueData,
  isAuthError,
  resolveZhjwxkSemester,
  searchXkCourses,
  semesterFromDate,
  submitXkCourse,
} from "@onethu/core";
import { http, info, learn, logLine, session } from "../lib/clients.js";
import { explainNetworkError } from "../lib/transport.js";
import { autoFullReload } from "../lib/reload.js";
import { buildRows, buildSlotIndex, canAdjustZy as canAdjustZyFn, levelTypesOf, parseTimeSlots, type SlotItem, type XkRow } from "../lib/xklogic.js";
import type { XkPlanItem } from "@onethu/core";
import {
  DEMO_COURSES,
  DEMO_EXAMS,
  DEMO_FILES,
  DEMO_HOMEWORK,
  DEMO_NEWS,
  DEMO_NOTIFICATIONS,
  DEMO_REPORT,
  DEMO_SCHEDULE,
  DEMO_SEMESTER,
  DEMO_SEMESTER_LIST,
  DEMO_USER,
  demoCardBundle,
} from "../demo/data.js";
import { useApp } from "./context.js";
import { cacheGet, cacheSet, cacheFetch ,
  purgeXkCaches } from "./cache.js";

/** info/zhjwxk 页内错误落盘（/tmp/onethu-debug.log），解析不匹配时可一轮定位 */
function logPageError(tag: string, err: unknown): void {
  const detail = err instanceof Error ? err.message + (err.stack ? "" : "") : String(err);
  void logLine("PAGE-ERR " + tag + " " + detail + "\nHTTP " + http.lastDebug).catch(() => undefined);
}

export interface CampusData {
  courses: CourseInfo[];
  homework: Homework[];
  notifications: Notification[];
  files: CourseFile[];
  schedule: ScheduleEntry[];
  user: BasicUserInfo | null;
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function loadReal(): Promise<CampusData> {
  const semester = await learn.getCurrentSemester();
  const courses = await learn.getCourseList(semester.id);
  const ids = courses.map((c) => c.id);
  const [homework, notifications, files, schedule, user] = await Promise.all([
    learn.getAllHomework(ids),
    learn.getAllNotifications(ids),
    Promise.all(ids.slice(0, 8).map((id) => learn.getFileList(id).catch(() => [])))
      .then((rs) => rs.flat())
      .catch(() => [] as CourseFile[]),
    (async () => {
      const start = new Date();
      start.setDate(start.getDate() - 7);
      const end = new Date();
      end.setDate(end.getDate() + 14);
      return info.getSchedule(fmtDate(start), fmtDate(end)).catch(() => [] as ScheduleEntry[]);
    })(),
    info.getUserInfo().catch(() => null),
  ]);
  return { courses, homework, notifications, files, schedule, user };
}

export type DataState = "loading" | "error" | "ready";

const CAMPUS_KEY = "campus";
const CAMPUS_TTL = 3 * 60 * 1000;

export function useCampusData() {
  const { status, backToLogin } = useApp();
  const [data, setData] = useState<CampusData | null>(() => cacheGet<CampusData>(CAMPUS_KEY)?.data ?? null);
  const [state, setState] = useState<DataState>(() => (cacheGet<CampusData>(CAMPUS_KEY) ? "ready" : "loading"));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setState("loading");
      setError(null);
    }
    if (status === "demo") {
      setData({
        courses: DEMO_COURSES,
        homework: DEMO_HOMEWORK,
        notifications: DEMO_NOTIFICATIONS,
        files: DEMO_FILES,
        schedule: DEMO_SCHEDULE,
        user: DEMO_USER,
      });
      setState("ready");
      return;
    }
    try {
      const fresh = await cacheFetch(CAMPUS_KEY, loadReal);
      setData(fresh);
      setState("ready");
    } catch (err) {
      // 会话真死了（AuthRequiredError）：先免密重漫游一次，仍失败才送回登录页
      if (err instanceof Error && err.name === "AuthRequiredError") {
        logPageError("CAMPUS-AUTH", err);
        const reRoamed = await relearnRoamOnce();
        if (reRoamed) {
          await load(silent);
          return;
        }
        backToLogin();
        return;
      }
      logPageError("CAMPUS", err);
      // 已有旧数据（缓存/上次成功）时不闪红：SWR 语义，保留旧值下轮挂载再重验证
      if (silent && data !== null) return;
      setState("error");
      setError(explainNetworkError(err));
    }
  }, [status, backToLogin, data]);

  useEffect(() => {
    if (status !== "ready" && status !== "demo") return;
    const cached = cacheGet<CampusData>(CAMPUS_KEY);
    if (!cached) void load(false);
    else if (Date.now() - cached.at > CAMPUS_TTL) void load(true);
  }, [status, load]);

  return { data, state, error, reload: load };
}

/* ============ 网络学堂专区数据（learnX 移植页面共用） ============ */

export interface LearnBundle {
  /** 数据所属学期（当前学期或用户选择的历史学期） */
  semester: SemesterInfo;
  courses: CourseInfo[];
  homework: Homework[];
  notifications: Notification[];
  files: CourseFile[];
}

/** 用户选择的学期（null = 跟随当前学期）；模块级共享，切换后清缓存 */
let selectedSemester: string | null = null;

export function getSelectedSemester(): string | null {
  return selectedSemester;
}

export function setSelectedSemester(id: string | null): void {
  if (selectedSemester === id) return;
  selectedSemester = id;
  cache = null;
}

/** 模块级缓存：learn 子页间跳转不重复拉全量数据（切学期/刷新时失效）。
 *  data 记忆最近一次成功结果——返回导航时立即可渲染，避免"课程0作业0通知0"空窗。 */
let cache: { key: string; promise: Promise<LearnBundle>; ts: number; data?: LearnBundle } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

/** 提交作业/撤回附件成功后调用：清 learn 缓存，让 reload() 真正重拉
 *  （TTL 内 reload 会直接命中缓存，状态永远不会刷新——mobile 提交后
 *  dispatch(getAssignmentsForCourse) 的对应物）。 */
export function invalidateLearnCache(): void {
  cache = null;
}

/** 会话失效后的免密重漫游去重：learn 漫游会话约 8 分钟过期是常态，
 *  同一时刻多个数据钩子（useLearnData 各子页 / useCampusData）一起撞上
 *  AuthRequiredError 时只漫游一次（此前并发各自漫游，幂等但浪费且拉长 loading 空窗）。 */
let roamInflight: Promise<boolean> | null = null;
function relearnRoamOnce(): Promise<boolean> {
  if (!roamInflight) {
    roamInflight = session
      .relearnRoam()
      .catch(() => false)
      .finally(() => {
        roamInflight = null;
      });
  }
  return roamInflight;
}

async function loadLearnBundle(semesterId: string): Promise<LearnBundle> {
  const courses = await learn.getCourseList(semesterId);
  const ids = courses.map((c) => c.id);
  const [homework, notifications, files] = await Promise.all([
    learn.getAllHomework(ids),
    learn.getAllNotifications(ids),
    Promise.all(ids.map((id) => learn.getFileList(id).catch(() => [] as CourseFile[])))
      .then((rs) => rs.flat())
      .catch(() => [] as CourseFile[]),
  ]);
  return { semester: { id: semesterId }, courses, homework, notifications, files };
}

/**
 * 网络学堂页面数据源：当前学期（或已选历史学期）的全量课程/作业/通知/文件。
 * loading / error / retry 三态；子页共享缓存，5 分钟内不重复请求。
 */
export function useLearnData() {
  const { status, backToLogin } = useApp();
  const [data, setData] = useState<LearnBundle | null>(() => cache?.data ?? null);
  const [state, setState] = useState<DataState>(cache?.data ? "ready" : "loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    if (status === "demo") {
      setData({
        semester: DEMO_SEMESTER,
        courses: DEMO_COURSES,
        homework: DEMO_HOMEWORK,
        notifications: DEMO_NOTIFICATIONS,
        files: DEMO_FILES,
      });
      setState("ready");
      return;
    }
    try {
      const key = selectedSemester ?? "current";
      if (!cache || cache.key !== key || Date.now() - cache.ts > CACHE_TTL) {
        const entry: NonNullable<typeof cache> = {
          key,
          ts: Date.now(),
          promise: (async () => {
            const semester = selectedSemester
              ? { id: selectedSemester }
              : await learn.getCurrentSemester();
            return loadLearnBundle(semester.id);
          })(),
        };
        cache = entry;
        entry.promise.then(
          (d) => {
            entry.data = d;
            // 空学期包不配长缓存：会话半死时 loadCourseBySemesterId 可能吐一次
            // 空 resultList（HTTP 200 + 可解析 JSON，不抛错），把"0 门课程"毒进
            // 缓存 5 分钟——返回列表页一直空白，只能硬刷新。标记立即过期，
            // 下次挂载 learn 必重校验（真实空学期也只是多一次轻量重拉）。
            if (d.courses.length === 0) entry.ts = 0;
          },
          () => { if (cache === entry) cache = null; }, // 失败不驻留缓存，重试才有可能
        );
      }
      const entry = cache; // 局部引用：等待期间 cache 被置空也不受影响
      setData(await entry.promise);
      setState("ready");
    } catch (err) {
      // 会话失效（AuthRequiredError）：先用持久化 id 主会话重漫游一次（learn 漫游会话
      // 约 8 分钟过期是常态，免密可重建）；仍失败才送回登录页
      if (err instanceof Error && err.name === "AuthRequiredError") {
        logPageError("LEARN-AUTH", err);
        cache = null;
        const reRoamed = await relearnRoamOnce();
        if (reRoamed) {
          await load(); // 递归一次：缓存已清，重走数据链；再失败走下一轮分支
          return;
        }
        backToLogin();
        return;
      }
      logPageError("LEARN", err);
      setState("error");
      setError(explainNetworkError(err));
    }
  }, [status, backToLogin]);

  useEffect(() => {
    if (status === "ready" || status === "demo") void load();
  }, [status, load]);

  return { data, state, error, reload: load };
}

/* ============ 学期列表（learnX SemesterSelection） ============ */

/** 学期列表 + 当前学期（用于"最新"标记），三态 */
const SEM_KEY = "semesters";
const SEM_TTL = 30 * 60 * 1000;

export function useSemesters() {
  const { status, backToLogin } = useApp();
  const cachedSem = cacheGet<{ list: string[]; current: string | null }>(SEM_KEY)?.data;
  const [list, setList] = useState<string[] | null>(() => cachedSem?.list ?? null);
  const [current, setCurrent] = useState<string | null>(() => cachedSem?.current ?? null);
  const [state, setState] = useState<DataState>(() => (cachedSem ? "ready" : "loading"));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setState("loading");
      setError(null);
    }
    if (status === "demo") {
      setList(DEMO_SEMESTER_LIST);
      setCurrent(DEMO_SEMESTER.id);
      setState("ready");
      return;
    }
    try {
      const [ids, cur] = await Promise.all([
        learn.getSemesterIdList(),
        learn.getCurrentSemester().catch(() => null),
      ]);
      cacheSet(SEM_KEY, { list: ids, current: cur?.id ?? null });
      setList(ids);
      setCurrent(cur?.id ?? null);
      setState("ready");
    } catch (err) {
      if (err instanceof Error && err.name === "AuthRequiredError") {
        backToLogin();
        return;
      }
      setState("error");
      setError(explainNetworkError(err));
    }
  }, [status, backToLogin]);

  useEffect(() => {
    if (status !== "ready" && status !== "demo") return;
    const cached = cacheGet<{ list: string[]; current: string | null }>(SEM_KEY);
    if (!cached) void load(false);
    else if (Date.now() - cached.at > SEM_TTL) void load(true);
  }, [status, load]);

  return { list, current, state, error, reload: load };
}

/* ============ 选课系统（zhjwxk，demo server.js 移植） ============ */

export interface ZhjwxkData {
  /** p_xnxq 学期串（如 2026-2027-1；xklogin 页提取，失败为兜底推算值） */
  semester: string | null;
  courses: SelectedCourse[];
  queue: QueueCandidate[];
}

/** 演示模式的选课数据（与真实字段一致，界面按"演示模式"标注） */
const DEMO_ZHJWXK_COURSES: SelectedCourse[] = [
  { typeLabel: "必修", code: "20401343", name: "计算机网络原理", teacher: "崔老师", time: "周一第 3 节", credits: 3 },
  { typeLabel: "必修", code: "20740042", name: "软件工程", teacher: "张老师", time: "周三第 6 节", credits: 3 },
  { typeLabel: "任选", code: "20740113", name: "人工智能导论", teacher: "李老师", time: "周五第 4 节", credits: 2 },
];
const DEMO_ZHJWXK_QUEUE: QueueCandidate[] = [
  { typeLabel: "必修", zyStr: "", code: "20401392", name: "形式语言与自动机", seq: "1", queueTotal: 24, myPos: 7, time: "周二第 2 节", teacher: "王老师" },
];

/**
 * 选课系统数据源：已选课程（m=yxSearchTab）+ 候补队列（m=dlSearch）。
 * loading / error / retry 三态；accessDenied → AuthRequiredError → 送回登录页。
 */
export function useZhjwxkCourses() {
  const { status } = useApp();
  const [data, setData] = useState<ZhjwxkData | null>(null);
  const [state, setState] = useState<DataState>("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    if (status === "demo") {
      setData({ semester: semesterFromDate(), courses: DEMO_ZHJWXK_COURSES, queue: DEMO_ZHJWXK_QUEUE });
      setState("ready");
      return;
    }
    try {
      const semester = await resolveZhjwxkSemester(xkSession()).catch(() => null);
      const opt = semester ? { semester } : undefined;
      const courses = await getSelectedCourses(xkSession(), opt);
      const queue = await getQueueStatus(xkSession(), opt).catch(() => [] as QueueCandidate[]);
      setData({ semester, courses, queue });
      setState("ready");
    } catch (err) {
      // 会话过期（demo 的 accessDenied 判定）：重试无意义，送回登录页重走登录链
      logPageError("ZHJWXK", err);
      setState("error");
      setError(explainNetworkError(err));
    }
  }, [status]);

  useEffect(() => {
    if (status === "ready" || status === "demo") void load();
  }, [status, load]);

  return { data, state, error, reload: load };
}

/* ============ 选课工作台（nextthuxk v1.4.9 管线移植） ============ */

/* 暂存 / 草稿 / 自定义占用（nextthuxk §7.4/§5，localStorage 持久化） */
export interface XkStageItem { code: string; seq: string; name: string; teacher: string; time: string; credits: number; flag: XkFlag; zy: number; baseFlag: XkFlag }
export interface XkDraft { name: string; courses: XkStageItem[] }
export interface XkManualEvent { id: string; name: string; code: string; seq: string; time: string; manual: true; credits: number }
const LS = {
  stage: "onethu.xk.stageCart",
  drafts: "onethu.xk.savedDrafts",
  manual: "onethu.xk.manualEvents",
};
function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function lsSet(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    /* 忽略配额/隐私模式 */
  }
}


/** 选课会话单例（WeakMap 缓存键必须稳定；凭据来自 CampusSession 内部字段） */
let xkSessionSingleton: ZhjwxkSession | null = null;
function xkSession(): ZhjwxkSession {
  if (!xkSessionSingleton) {
    const c = session.xkCredentials;
    xkSessionSingleton = { http, username: c.username, password: c.password, fingerprint: c.fingerprint };
  }
  return xkSessionSingleton;
}

/** 学期串缓存（12h）：学期串只在换学期时变；命中省一次 ensure/解析往返 */
const XK_SEM_KEY = "xk:semester";
const XK_SEM_TTL = 12 * 60 * 60 * 1000;
/** 核心数据（已选/候补/队列/方案）持久缓存：按学期键，管线启动 t=0 秒渲右栏（SWR） */
const XK_CORE_KEY = "xk:core";
interface XkCoreSeed {
  selected: XkSelectedRow[];
  candidates: QueueCandidate[];
  queueMap: Record<string, XkQueueInfo>;
  phase: boolean;
  plan: XkPlanItem[];
}

/* ── 一级课表先行管线（levelTable-first）：共享缓存 / 在途去重 / levelFailed 标记 ── */
/** 内存级一级课表缓存（refresh 与目录管线共用一份，小而快，避免同页重复请求） */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

purgeXkCaches(); // 一次性：清空历轮缓存课表（种子/学期），下次拉取全走实时

let levelCache: { sem: string; at: number; table: Record<string, XkLevelTableRow> } | null = null;
const LEVEL_CACHE_TTL = 5 * 60_000;
/** fresh 重抓的防抖窗口：挂载 refresh 与 loadCatalog 相邻发起时只发一次请求 */
const LEVEL_FRESH_WINDOW = 5_000;
const levelInflight = new Map<string, Promise<Record<string, XkLevelTableRow> | null>>();
/** 一级课表失败/为空的学期（内存标记）：仅这些学期允许全量目录优先（refresh fresh 重抓可自愈解除） */
const levelFailedSems = new Set<string>();

/**
 * 一级课表获取：内存缓存 → 在途共享 → 网络。
 * fresh=true（refresh 用）跳过 levelFailed 标记与长缓存强制重抓（写操作后/换会话自愈），
 * 防抖窗口内仍复用；失败或解析为空（含网格版式页/未开放学期）返回 null 并标记 levelFailed。
 */
async function fetchLevelTable(sem: string, fresh = false): Promise<Record<string, XkLevelTableRow> | null> {
  const hit = levelCache && levelCache.sem === sem ? levelCache : null;
  if (hit && Date.now() - hit.at < (fresh ? LEVEL_FRESH_WINDOW : LEVEL_CACHE_TTL)) return hit.table;
  if (!fresh && levelFailedSems.has(sem)) return null;
  const inflight = levelInflight.get(sem);
  if (inflight) return inflight;
  const run = (async (): Promise<Record<string, XkLevelTableRow> | null> => {
    try {
      const table = await getXkLevelTable(xkSession(), { semester: sem });
      if (Object.keys(table).length === 0) {
        levelFailedSems.add(sem);
        return null;
      }
      levelFailedSems.delete(sem);
      levelCache = { sem, at: Date.now(), table };
      return table;
    } catch (err) {
      levelFailedSems.add(sem);
      logPageError("XK-LEVEL", err);
      return null;
    } finally {
      levelInflight.delete(sem);
    }
  })();
  levelInflight.set(sem, run);
  return run;
}

export interface XkWorkbench {
  semester: string | null;
  selected: XkSelectedRow[];
  candidates: QueueCandidate[];
  phase: boolean;
  queueMap: Record<string, XkQueueInfo>;
  catalog: XkCourse[];
  volMap: Record<string, XkVolInfo>;
  levelTypes: Record<string, string>;
  coreState: DataState;
  queueState: DataState | "idle";
  /** 左栏实时搜索（浏览=服务端页取 / 搜索=真页数探测+可加载全部） */
  searchState: DataState | "idle" | "loadingMore";
  /** 服务端搜索原始行池（不含已选/候补兜底行，供 UI 分页与去重判断） */
  searchRaw: XkCourse[];
  searchRows: XkRow[];
  searchPage: number;
  searchHasMore: boolean;
  searchIncomplete: boolean;
  searchTotalPages: number;
  searchRunId: number;
  searchError: string | null;
  newSearch: (meta: XkSearchMeta) => Promise<void>;
  gotoPage: (page: number) => Promise<void>;
  loadAllSearch: () => Promise<void>;
  retrySearch: () => Promise<void>;
  error: string | null;
  busy: string | null;
  toast: string | null;
  /** fresh=true（默认，手动刷新/重试）强抓一级课表自愈；挂载走 false 允许同学期缓存秒渲 */
  refresh: (fresh?: boolean) => Promise<void>;
  submit: (code: string, seq: string, zy: number, flag: XkFlag) => Promise<void>;
  drop: (code: string, seq: string, isQueue: boolean) => Promise<void>;
  changeZy: (code: string, seq: string, zy: number) => Promise<void>;
  setToast: (t: string | null) => void;
  /** 合并行（目录∪志愿∪余量∪已选∪候补，nextthuxk §9 selector join） */
  courses: XkRow[];
  canAdjustZy: (code: string, seq: string, targetZy: number) => boolean;
  stageCart: XkStageItem[];
  addToStage: (row: XkRow, flag: XkFlag, zy: number) => void;
  removeFromStage: (code: string, seq: string) => void;
  updateStageItem: (code: string, seq: string, patch: { flag?: XkFlag; zy?: number }) => void;
  importStageItem: (item: XkStageItem) => void;
  savedDrafts: XkDraft[];
  saveDraft: (name: string) => void;
  deleteDraft: (idx: number) => void;
  removeFromDraft: (idx: number, code: string, seq: string) => void;
  saveCurrentAsDraft: (name: string) => void;
  exportDraft: (idx: number) => Promise<void>;
  importDraft: () => void;
  submitDraft: (idx: number) => Promise<void>;
  manualEvents: XkManualEvent[];
  addManualEvent: (name: string, day: number, slot: number) => void;
  removeManualEvent: (id: string) => void;
  previewMode: "selected" | "stage" | "draft";
  previewDraftIdx: number;
  setPreview: (mode: "selected" | "stage" | "draft", idx?: number) => void;
  progress: string | null;
  setProgress: (s: string | null) => void;
  refreshQueue: () => Promise<void>;
  previewItems: Array<SlotItem & { time: string }>;
  previewIndex: Map<string, SlotItem[]>;
  semesterOverride: string | null;
  setSemesterOverride: (sem: string | null) => Promise<void>;
  semesterOptions: Array<{ value: string; label: string }>;
  plan: XkPlanItem[];
  loadDetail: (code: string) => Promise<XkCourseDetail | null>;
}

export interface XkSearchMeta {
  /** 课程名关键词（纯数字时归入 kch） */
  kcm: string;
  kch: string;
  teacher: string;
  department: string;
  weekday: string;
  section: string;
  grade: string;
  rxklxm: string;
  kctsm: string;
  onlyAvailable: boolean;
  gradAvail: boolean;
}

/**
 * 选课工作台数据源（nextthuxk v1.4.9 显示规格 §9 reducer 骨架的 hook 形态）：
 * 已选/候补/余量为核心数据（每次刷新拉取）；目录+志愿走模块缓存（SWR 思路）。
 * 写操作串行（token 一次性，v1.3.12 结论），完成后自动刷新已选/候补/余量。
 */
export function useXkWorkbench(): XkWorkbench {
  const { status } = useApp();
  const [semester, setSemester] = useState<string | null>(null);
  const [semesterOverride, setSemesterOverrideState] = useState<string | null>(null);
  /* ── 管线代数（generation）+ 学期栏唯一真源 ──
   * semBarRef：学期栏当前选中值镜像（唯一真源）。setSemesterOverride 同步写入——select 本帧
   * 即显示新学期、绝不回跳旧值；refresh/loadCatalog/refreshQueue 一切入口都先读它，
   * 绝不基于旧学期继续。
   * genRef：切学期等打断入口 +1；所有在途 level/core/catalog/vol 请求 resolve 后先比对代数，
   * 不一致一律丢弃（旧 semRef/catSemRef 学期比对守卫的统一升级）。
   * pipelineSemRef：最近一次整序管线的学期，识别"新学期开始"再 +1；初始挂载为 null 不算
   * 打断——mount 时 refresh 与 loadCatalog 并发启动，必须共享同一代才能双双生效。 */
  const genRef = useRef(0);
  const semBarRef = useRef<string | null>(null);
  const pipelineSemRef = useRef<string | null>(null);
  /** 同代同学期整序管线在途去重（mount 时 idle 触发与 loadCatalog 竞态只跑一遍全量抓取） */
  const pipelineInflightRef = useRef<{ sem: string; gen: number; promise: Promise<void> } | null>(null);
  /** 核心数据（已选/候补/队列/方案）单写者序号：写后核心刷新永远取代在途管线的核心提交 */
  const coreSeqRef = useRef(0);
  /** 本轮管线启动时右栏是否已有缓存秒渲旧值（true 时 commitCore 失败保旧不闪红） */
  const coreSeededRef = useRef(false);
  /** 两段状态机内部标志：levelRendered = 一级课表 partial 行已提交（catalogState 仍 "loading"，
   *  左栏继续"加载中"）；fullReady = 全量目录已合并（catalogState="ready"，
   *  volNeedsRefresh 后台重校验只允许在此之后启动，且此后绝不用 partial 行降级覆盖全量行）。 */
  const [selected, setSelected] = useState<XkSelectedRow[]>([]);
  const [candidates, setCandidates] = useState<QueueCandidate[]>([]);
  const [phase, setPhase] = useState(false);
  const [queueMap, setQueueMap] = useState<Record<string, XkQueueInfo>>({});
  const [catalog, setCatalog] = useState<XkCourse[]>([]);
  const [volMap, setVolMap] = useState<Record<string, XkVolInfo>>({});
  const [levelTypes, setLevelTypes] = useState<Record<string, string>>({});
  const [coreState, setCoreState] = useState<DataState>("loading");
  const [queueState, setQueueState] = useState<DataState | "idle">("idle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  /** 学期栏唯一真源的同步写入（state + ref 同帧一致，select 不回跳） */
  const setSemBar = useCallback((sem: string | null) => {
    semBarRef.current = sem;
    setSemester(sem);
  }, []);

  /* ── 核心数据提交（右栏数据 = 已选/候补/队列/方案，一级课表兜底）──
   * 单写者（coreSeqRef）：写后核心刷新永远取代在途管线的核心提交，杜绝旧数据覆盖新数据。
   * 失登自愈（与校园卡/图书馆同款）：isAuthError → autoFullReload("xk") 静默整页重载，
   * 2 分钟节流窗口内的第二次失败才落可重试错误。 */
  /** 一级课表入参改传在途 Promise（2026-09 性能专项）：它只是「已选为空」时的兜底，
   *  99% 场景用不上——懒求值后核心 4 路请求与一级课表抓取并行，右栏刷新省一个串行往返 */
  const commitCore = useCallback(async (sem: string, ltP: Promise<Record<string, XkLevelTableRow> | null> | null, myGen: number): Promise<XkPlanItem[]> => {
    const coreSeq = ++coreSeqRef.current;
    const opt = { semester: sem };
    try {
      const [sel, cand, qd, plan] = await Promise.all([
        getXkSelectedFull(xkSession(), opt).catch((err: unknown) => { if (isAuthError(err)) throw err; return [] as XkSelectedRow[]; }),
        getQueueStatus(xkSession(), opt).catch((err: unknown) => { if (isAuthError(err)) throw err; return [] as QueueCandidate[]; }),
        getXkQueueData(xkSession(), opt).catch((err: unknown) => { if (isAuthError(err)) throw err; return { map: {}, phase: false }; }),
        getXkPlan(xkSession(), opt).catch((err: unknown) => { if (isAuthError(err)) throw err; return [] as XkPlanItem[]; }),
      ]);
      if (genRef.current !== myGen || coreSeqRef.current !== coreSeq) return plan; // 已打断/已被更新的核心刷新取代：丢弃
      // 一级课表兜底（v1.4.9）：已选查询拿不到行（选课阶段切换/页面变更）时，
      // 用刚抓的一级课表重建（含课名/教师/学分），不再二次请求——此时才等它
      let selFinal = sel;
      if (!selFinal.length) {
        // 罕见兜底（选课阶段切换/页面变更导致已选查询拿不到行）：此时才按需拉一级课表
        const lt = ltP ? await ltP : await fetchLevelTable(sem, false);
        if (genRef.current !== myGen || coreSeqRef.current !== coreSeq) return plan;
        if (lt) {
          selFinal = Object.entries(lt).map(([k, v]) => {
            const i = k.indexOf("_");
            return { code: k.slice(0, i), seq: k.slice(i + 1) || "0", name: v.name ?? "", teacher: v.teacher ?? "", time: "", credits: v.credits ?? 0, typeLabel: v.typeLabel, typeCode: v.typeCode, zy: 0 };
          });
        }
      }
      setSelected(selFinal);
      setCandidates(cand);
      setQueueMap(qd.map);
      setPhase(qd.phase);
      setPlan(plan);
      setQueueState("ready");
      setCoreState("ready");
      void backfillSelTimes(selFinal); // 已选时间列解析失败者：p_kch 逐门实时回填（后台，不阻塞）
      // 核心数据落持久缓存（下轮挂载/重启 t=0 秒渲右栏）+ 学期串持续保鲜
      cacheSet(`${XK_CORE_KEY}:${sem}`, { selected: selFinal, candidates: cand, queueMap: qd.map, phase: qd.phase, plan });
      cacheSet(XK_SEM_KEY, sem);
      return plan; // ★ 右栏就绪（渲染顺序固定：先右后左）
    } catch (err) {
      if (genRef.current !== myGen || coreSeqRef.current !== coreSeq) return [];
      if (isAuthError(err) && autoFullReload("xk")) return []; // 失登：静默整页重载（2 分钟节流）
      if (coreSeededRef.current) return []; // 秒渲旧值在屏：保旧不闪红（SWR），重试/下轮再验证
      logPageError("ZHJWXK", err);
      setCoreState("error");
      setError(explainNetworkError(err));
      throw err; // 右栏失败：整序管线到此为止，左栏保持 loading（顺序固定）
    }
  }, []);

  /** 一级课表到位：课型表 + partial 行立即提交。fullReady 之后（全量行已在）
   *  绝不用 partial 行降级覆盖（写后核心刷新路径），只更新课型表。 */
  /** 一级课表只用于课型标签（必修/限选/任选/体育）；partial 目录行已随批量淘汰一起废弃 */
  const applyLevelTypes = useCallback((lt: Record<string, XkLevelTableRow>) => {
    setLevelTypes(levelTypesOf(lt));
  }, []);

  /**
   * 整序管线（两栏由同一 generation 驱动，渲染顺序固定：先右后左）：
   *   Phase R（右）：一级课表（同学期缓存秒渲 → 网络）→ 核心数据提交 → 右栏就绪；
   *                 catalogState 才翻 "ready"，左栏在此之前只显示加载中；
   *                 失败保留 level 行走可重试 ErrorNote，不白屏。
   * 所有 await resolve 后先比对 generation，不一致一律丢弃；同代同学期在途去重。
   */
  const runPipeline = useCallback((sem: string, freshLevel: boolean): Promise<void> => {
    // 新学期开始 = 打断：代数 +1（初始挂载 pipelineSemRef=null 不算，见上）
    if (pipelineSemRef.current !== null && pipelineSemRef.current !== sem) genRef.current += 1;
    pipelineSemRef.current = sem;
    const myGen = genRef.current;
    const inflight = pipelineInflightRef.current;
    if (inflight && inflight.sem === sem && inflight.gen === myGen) return inflight.promise;
    // 管线启动：复位两段标志；右栏核心种子秒渲（左栏数据源已切换服务端实时搜索）
    // t=0 右栏：上次核心数据秒渲，commitCore 到达后静默覆盖（SWR）
    const coreSeed = cacheGet<XkCoreSeed>(`${XK_CORE_KEY}:${sem}`);
    if (coreSeed) {
      setSelected(coreSeed.data.selected);
      setCandidates(coreSeed.data.candidates);
      setQueueMap(coreSeed.data.queueMap);
      setPhase(coreSeed.data.phase);
      setPlan(coreSeed.data.plan);
      setQueueState("ready");
      setCoreState("ready");
    } else {
      setCoreState("loading");
    }
    coreSeededRef.current = Boolean(coreSeed);
    if (coreSeed) void backfillSelTimes(coreSeed.data.selected); // 种子秒渲的时间缺口同样回填
    const entry: NonNullable<typeof pipelineInflightRef.current> = {
      sem,
      gen: myGen,
      promise: (async () => {
        // ── 已选优先（2026-09）：全校一级课表巨型单页不再进挂载路径——
        //  它只值课型标签 + 「已选为空」兜底，后者已改为 commitCore 内按需拉取。
        //  关键路径 = 入口会话链 + 核心 4 路并行，已选/候补/队列/方案最快上屏。
        let plan: XkPlanItem[] = [];
        try {
          plan = await commitCore(sem, null, myGen);
        } catch { return; } // 右栏失败：错误态已在 commitCore 落定
        void plan;
      })(),
    };
    pipelineInflightRef.current = entry;
    return entry.promise.finally(() => {
      if (pipelineInflightRef.current === entry) pipelineInflightRef.current = null;
    });
  }, [commitCore]);

  /** 写操作后的轻量自愈：只重抓核心数据（右栏 4 路并行）；一级课表不进刷新路径。 */
  const refreshCore = useCallback(async () => {
    if (status === "demo") return;
    const sem = semBarRef.current; // 学期栏选中值唯一真源
    if (!sem) return;
    await commitCore(sem, null, genRef.current).catch(() => undefined); // 错误已在 commitCore 落状态
  }, [status, commitCore]);

  /**
   * 数据刷新入口（手动"刷新数据"/挂载）：学期栏当前选中值是唯一真源——入口先读 semBarRef，
   * 绝不基于旧学期继续。fresh=true（默认）强抓一级课表自愈；挂载走 fresh=false 允许同学期缓存秒渲。
   */
  const refresh = useCallback((fresh = true): Promise<void> => {
    if (status === "demo") {
      setSemBar(semesterFromDate());
      setSelected(DEMO_ZHJWXK_COURSES.map((c) => ({
        code: c.code, seq: "0", name: c.name, teacher: c.teacher, time: c.time,
        credits: c.credits, typeLabel: c.typeLabel, zy: 1,
        typeCode: c.typeLabel === "必修" ? "006" : c.typeLabel === "限选" ? "008" : c.typeLabel === "任选" ? "007" : "ty",
      })));
      setCandidates(DEMO_ZHJWXK_QUEUE);
      setPhase(true);
      setLevelTypes({});
      setCoreState("ready");
      return Promise.resolve();
    }
    const myGen = genRef.current;
    return (async () => {
      let sem = semBarRef.current;
      if (!sem) {
        // 学期串缓存（12h）命中：零网络起步；未命中才走 ensure 解析
        const semHit = cacheGet<string>(XK_SEM_KEY);
        const semFresh = semHit && Date.now() - semHit.at < XK_SEM_TTL ? semHit.data : null;
        sem = semFresh ?? (await resolveZhjwxkSemester(xkSession()).catch(() => semesterFromDate()));
        if (genRef.current !== myGen) return; // 期间已切学期：作废（semBar 已被新入口写入）
        setSemBar(sem);
      }
      await runPipeline(sem, fresh);
    })();
  }, [status, runPipeline, setSemBar]);

  const runWrite = useCallback(
    async (key: string, fn: () => Promise<{ ok: boolean; msg: string }>) => {
      setBusy(key);
      setToast(null);
      try {
        const r = await fn();
        setToast(r.msg);
      } catch (err) {
        logPageError("XK-WRITE", err);
        setToast(explainNetworkError(err));
      } finally {
        setBusy(null);
        levelCache = null; // 写操作可能改了一级课表（选上/退掉），refreshCore 内 fresh 重抓
        void refreshCore(); // 写后轻量自愈：只刷右栏（一级课表+核心），左栏目录/状态不动
      }
    },
    [refreshCore],
  );

  const submit = useCallback(
    (code: string, seq: string, zy: number, flag: XkFlag) =>
      runWrite(`submit-${code}-${seq}`, () =>
        submitXkCourse(xkSession(), { code, seq, zy, flag }),
      ),
    [runWrite],
  );
  const drop = useCallback(
    (code: string, seq: string, isQueue: boolean) =>
      runWrite(`drop-${code}-${seq}`, () => dropXkCourse(xkSession(), { code, seq, isQueue })),
    [runWrite],
  );
  const changeZy = useCallback(
    (code: string, seq: string, zy: number) =>
      runWrite(`zy-${code}-${seq}`, () => changeXkVolunteer(xkSession(), { code, seq, zy })),
    [runWrite],
  );

  useEffect(() => {
    if (status === "ready" || status === "demo") void refresh(false); // 挂载允许同学期一级课表缓存秒渲
  }, [status, refresh]);

  // ── 暂存 / 草稿 / 自定义占用 / 预览（nextthuxk §5/§7.4）──
  const [stageCart, setStageCart] = useState<XkStageItem[]>(() => lsGet(LS.stage, []));
  const [savedDrafts, setSavedDrafts] = useState<XkDraft[]>(() => lsGet(LS.drafts, []));
  const [manualEvents, setManualEvents] = useState<XkManualEvent[]>(() => lsGet(LS.manual, []));
  const [plan, setPlan] = useState<XkPlanItem[]>([]);
  const [previewMode, setPreviewMode] = useState<"selected" | "stage" | "draft">("selected");
  const [previewDraftIdx, setPreviewDraftIdx] = useState(0);
  const [progress, setProgress] = useState<string | null>(null);

  // attr 回填（data.js mergeStaticData：培养方案按课号给目录补必修/限选/任选属性）
  const attrMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of plan) if (p.attr && !m.has(p.code)) m.set(p.code, p.attr);
    return m;
  }, [plan]);
  // 只回填空缺：不覆盖一级课表合并（mergeLevelIntoCatalog）已写入的类型属性，
  // 保证"全量目录到达后不丢一级课表 attr/类型信息"，且与提交用 typeCode 口径一致
  /* ── 左栏数据源：服务端实时搜索（kkxxSearch 分页，与批量同端点同解析器）。
   *  两种模式（对齐教务网页行为，用户点哪页爬哪页）：
   *  · 浏览模式（无任何关键词/筛选）：不预取、不追加——点上一页/下一页/跳页才发那 1 个请求；
   *  · 搜索模式（有关键词或筛选）：并行爬前 3 页；≤50 门即全部加载完（照常翻页）；
   *    >50 门列前 3 页并提示「数据不完整」，用户点「加载全部」才爬余下页，完成后 toast 通知。── */
  const [searchRaw, setSearchRaw] = useState<XkCourse[]>([]);
  const [searchState, setSearchState] = useState<DataState | "idle" | "loadingMore">("idle");
  const [searchPage, setSearchPage] = useState(1);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchIncomplete, setSearchIncomplete] = useState(false);
  const [searchTotalPages, setSearchTotalPages] = useState(0); // 服务端「共 N 页」真值（0=未知）
  const [searchLoadedTo, setSearchLoadedTo] = useState(0); // 搜索模式已连续加载到第几页
  const [searchRunId, setSearchRunId] = useState(0);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchSeqRef = useRef(0);
  const searchMetaRef = useRef<XkSearchMeta | null>(null);
  const searchRows = useMemo(
    () => buildRows(searchRaw, volMap, queueMap, selected, candidates, levelTypes),
    [searchRaw, volMap, queueMap, selected, candidates, levelTypes],
  );

  const fetchXkPage = useCallback(
    async (meta: XkSearchMeta, page: number) =>
      searchXkCourses(xkSession(), {
        semester: semBarRef.current ?? undefined,
        page,
        kch: meta.kch || undefined,
        kcm: meta.kcm || undefined,
        teacher: meta.teacher || undefined,
        department: meta.department || undefined,
        weekday: meta.weekday || undefined,
        section: meta.section || undefined,
        grade: meta.grade || undefined,
        rxklxm: meta.rxklxm || undefined,
        kctsm: meta.kctsm || undefined,
        onlyAvailable: meta.onlyAvailable || undefined,
        gradAvail: meta.gradAvail || undefined,
      }),
    [status],
  );

  const isBrowsingMeta = (meta: XkSearchMeta): boolean =>
    !meta.kch && !meta.kcm && !meta.teacher && !meta.department && !meta.weekday &&
    !meta.section && !meta.grade && !meta.rxklxm && !meta.kctsm && !meta.onlyAvailable && !meta.gradAvail;

  const failSearch = useCallback((err: unknown, seq: number): void => {
    if (seq !== searchSeqRef.current) return;
    logPageError("XK-SEARCH", err);
    if (isAuthError(err) && autoFullReload("xk")) return;
    setSearchError(explainNetworkError(err));
    setSearchState("error");
  }, []);

  const newSearch = useCallback(
    async (meta: XkSearchMeta) => {
      const seq = ++searchSeqRef.current;
      searchMetaRef.current = meta;
      setSearchError(null);
      setSearchRunId((v) => v + 1);
      if (status === "demo") {
        setSearchRaw([]);
        setSearchPage(1);
        setSearchHasMore(false);
        setSearchIncomplete(false);
        setSearchState("ready");
        return;
      }
      setSearchState("loading");
      try {
        if (isBrowsingMeta(meta)) {
          // 浏览模式：像教务网页一样只取用户要的那一页（挂载 = 第 1 页）
          const r = await fetchXkPage(meta, 1);
          if (seq !== searchSeqRef.current) return;
          setSearchRaw(r.rows);
          setSearchPage(1);
          setSearchHasMore(r.hasMore);
          setSearchIncomplete(false);
          if (r.totalPages) setSearchTotalPages(r.totalPages); // 模式切换必须刷新总页数，否则残留上个搜索的值
          setSearchError(r.pageKind === "unknown" ? `教务返回异常页（首段: ${r.htmlHead}）` : null);
          setSearchState("ready");
          return;
        }
        // 搜索模式：第 1 页先行（响应自带服务端「共 N 页」真值）→ 并行探测到 min(N,5) 页
        //（用户定稿：探测并行量扩到 100 门；总数与页数直接读服务端标注，不再猜）
        const kw = (meta.kcm || "").trim();
        const base = { ...meta, kch: /^\d{4,}$/.test(kw) ? kw : "", kcm: /^\d{4,}$/.test(kw) ? "" : kw };
        const p1 = await fetchXkPage(base, 1);
        if (seq !== searchSeqRef.current) return;
        // 课程名 0 行且关键词非数字 → 教师名兜底重试一次（搜索框一框三用）
        let head = p1;
        if (p1.rows.length === 0 && kw && !/^\d{4,}$/.test(kw)) {
          const r2 = await fetchXkPage({ ...base, kcm: "", teacher: kw }, 1);
          if (seq !== searchSeqRef.current) return;
          if (r2.rows.length > 0) head = r2;
        }
        const tp = head.totalPages ?? 0;
        const probeTo = tp > 0 ? Math.min(tp, 5) : 3;
        const rest = probeTo >= 2
          ? await Promise.all(Array.from({ length: probeTo - 1 }, (_, i) => fetchXkPage(base, i + 2).catch(() => null)))
          : [];
        if (seq !== searchSeqRef.current) return;
        const seen = new Set<string>();
        const merged: XkCourse[] = [];
        for (const r of [head, ...rest]) {
          if (!r) continue;
          for (const c of r.rows) {
            const k = `${c.code}_${c.seq || "0"}`;
            if (!seen.has(k)) { seen.add(k); merged.push(c); }
          }
        }
        setSearchRaw(merged);
        setSearchPage(probeTo);
        setSearchLoadedTo(probeTo);
        setSearchTotalPages(tp);
        setSearchHasMore(false);
        setSearchIncomplete(tp > probeTo); // 真实总页数 > 已探测页数才叫不完整
        setSearchError(head.pageKind === "unknown" ? `教务返回异常页（首段: ${head.htmlHead}）` : null);
        setSearchState("ready");
      } catch (err) {
        failSearch(err, seq);
      }
    },
    [status, fetchXkPage, failSearch],
  );

  /** 搜索模式「加载当前关键词全部」：从第 4 页起爬到空页（5 并发池 + 30ms 限速），完成 toast */
  const loadAllSearch = useCallback(async () => {
    if (status === "demo" || searchState === "loading" || searchState === "loadingMore") return;
    const meta = searchMetaRef.current;
    if (!meta) return;
    const seq = ++searchSeqRef.current;
    setSearchState("loadingMore");
    const kw = (meta.kcm || "").trim();
    const base = { ...meta, kch: /^\d{4,}$/.test(kw) ? kw : "", kcm: /^\d{4,}$/.test(kw) ? "" : kw };
    const seen = new Set(searchRaw.map((c) => `${c.code}_${c.seq || "0"}`));
    const added: XkCourse[] = [];
    const PAGE_POOL = 5;
    const to = searchTotalPages || searchLoadedTo; // 无真值则无处可爬
    let empty = false;
    try {
      for (let p = searchLoadedTo + 1; p <= to && !empty; p += PAGE_POOL) {
        const wave: Array<Promise<XkCourse[] | null>> = [];
        for (let i = p; i < p + PAGE_POOL && i <= to; i++) {
          wave.push(
            (async () => {
              await sleep((i - p) * 30);
              const r = await fetchXkPage(base, i);
              return r.rows;
            })().catch(() => null),
          );
        }
        const results = await Promise.all(wave);
        if (seq !== searchSeqRef.current) return;
        for (const rows of results) {
          if (!rows || rows.length === 0) { empty = true; continue; }
          for (const c of rows) {
            const k = `${c.code}_${c.seq || "0"}`;
            if (!seen.has(k)) { seen.add(k); added.push(c); }
          }
        }
      }
      if (seq !== searchSeqRef.current) return;
      setSearchRaw((prev) => [...prev, ...added]);
      setSearchLoadedTo(to);
      setSearchIncomplete(false);
      setSearchState("ready");
      setToast(`已加载全部 ${searchRaw.length + added.length} 门`);
    } catch (err) {
      if (seq !== searchSeqRef.current) return;
      // 部分成功也算数：落已加载的行，可再点继续
      if (added.length) {
        setSearchRaw((prev) => [...prev, ...added]);
        setSearchState("ready");
        setToast(`已加载 ${added.length} 门（中途中断，可再点继续）`);
      } else {
        failSearch(err, seq);
      }
    }
  }, [status, searchState, searchRaw, searchTotalPages, searchLoadedTo, fetchXkPage, failSearch, setToast]);

  /** 浏览模式翻页：用户点哪页爬哪页（1 个请求），绝不预取 */
  const gotoPage = useCallback(
    async (page: number) => {
      const meta = searchMetaRef.current;
      if (status === "demo" || !meta || page < 1) return;
      const seq = ++searchSeqRef.current;
      setSearchState("loading");
      try {
        const r = await fetchXkPage(meta, page);
        if (seq !== searchSeqRef.current) return;
        setSearchRaw(r.rows);
        setSearchPage(page);
        setSearchHasMore(r.hasMore);
        if (r.totalPages) setSearchTotalPages(r.totalPages);
        setSearchError(r.pageKind === "unknown" ? `教务返回异常页（首段: ${r.htmlHead}）` : null);
        setSearchState("ready");
      } catch (err) {
        failSearch(err, seq);
      }
    },
    [status, fetchXkPage, failSearch],
  );

  const retrySearch = useCallback(async () => {
    if (searchMetaRef.current) await newSearch(searchMetaRef.current);
  }, [newSearch]);

  /* ── 已选课程时间实时回填（修复「全部未知时间」）：
   *  旧全量目录曾顺带提供已选课的时间列；实时化后改为按需精确回填——
   *  对时间列解析失败的已选课，逐门 p_kch 查 kkxxSearch（各 1 个小请求，并行），
   *  结果并入 join 池，课表预览/卡片时间列即恢复真实时间。── */
  const [selDetail, setSelDetail] = useState<Record<string, XkCourse>>({});
  const selDetailKeysRef = useRef<Set<string>>(new Set());
  const backfillSelTimes = useCallback(
    async (sel: XkSelectedRow[]) => {
      if (status === "demo") return;
      // 只回填「时间列缺失/解析失败」且尚未回填过的课；5 个一批 + 60ms 间隔，不砸教务
      const need = sel.filter((r) =>
        (r.time && parseTimeSlots(r.time).length === 0 || !r.time) &&
        !selDetailKeysRef.current.has(`${r.code}_${r.seq || "0"}`),
      );
      for (let i = 0; i < need.length; i += 5) {
        await Promise.all(need.slice(i, i + 5).map(async (r) => {
          const key = `${r.code}_${r.seq || "0"}`;
          selDetailKeysRef.current.add(key); // 先占位防重复
          try {
            const res = await searchXkCourses(xkSession(), { semester: semBarRef.current ?? undefined, kch: r.code });
            const hit = res.rows.find((c) => c.code === r.code && (c.seq || "0") === (r.seq || "0") && parseTimeSlots(c.time).length > 0);
            if (hit) setSelDetail((prev) => (prev[key] ? prev : { ...prev, [key]: hit }));
          } catch { /* 回填失败容忍：保持现状 */ }
        }));
        if (i + 5 < need.length) await sleep(60);
      }
    },
    [status],
  );

  const enrichedCatalog = useMemo(
    () => (attrMap.size ? catalog.map((c) => (attrMap.has(c.code) && !c.attr ? { ...c, attr: attrMap.get(c.code)! } : c)) : catalog),
    [catalog, attrMap],
  );
  const courses = useMemo(() => {
    // join 池 = 本地目录（批量已淘汰，恒空）∪ 服务端搜索已浏览页 ∪ 已选时间回填行
    const seen = new Set<string>();
    const all: XkCourse[] = [];
    for (const c of [...enrichedCatalog, ...searchRaw, ...Object.values(selDetail)]) {
      const k = `${c.code}_${c.seq || "0"}`;
      if (!seen.has(k)) { seen.add(k); all.push(c); }
    }
    return buildRows(all, volMap, queueMap, selected, candidates, levelTypes);
  }, [enrichedCatalog, searchRaw, selDetail, volMap, queueMap, selected, candidates, levelTypes]);
  const canAdjustZy = useCallback(
    (code: string, seq: string, targetZy: number) => canAdjustZyFn(courses, code, seq, targetZy),
    [courses],
  );

  const stageSet = useMemo(() => new Set(stageCart.map((s) => `${s.code}_${s.seq}`)), [stageCart]);
  const addToStage = useCallback((row: XkRow, flag: XkFlag, zy: number) => {
    setStageCart((prev) => {
      if (prev.some((s) => s.code === row.c.code && s.seq === row.c.seq)) {
        setToast("该课程已在暂存区");
        return prev;
      }
      setToast(`已暂存「${row.name}」`);
      const next = [...prev, { code: row.c.code, seq: row.c.seq, name: row.name, teacher: row.teacher, time: row.time, credits: row.credits, flag, zy, baseFlag: row.flag }];
      lsSet(LS.stage, next);
      return next;
    });
  }, []);
  const removeFromStage = useCallback((code: string, seq: string) => {
    setStageCart((prev) => {
      const next = prev.filter((s) => !(s.code === code && s.seq === seq));
      lsSet(LS.stage, next);
      return next;
    });
  }, []);
  const updateStageItem = useCallback((code: string, seq: string, patch: { flag?: XkFlag; zy?: number }) => {
    setStageCart((prev) => {
      const next = prev.map((s) => (s.code === code && s.seq === seq ? { ...s, ...patch } : s));
      lsSet(LS.stage, next);
      return next;
    });
  }, []);
  const importStageItem = useCallback((item: XkStageItem) => {
    setStageCart((prev) => {
      if (prev.some((s) => s.code === item.code && s.seq === item.seq)) return prev;
      const next = [...prev, item];
      lsSet(LS.stage, next);
      return next;
    });
  }, []);

  const persistDrafts = useCallback((next: XkDraft[]) => {
    setSavedDrafts(next);
    lsSet(LS.drafts, next);
  }, []);
  const saveDraft = useCallback((name: string) => {
    if (!stageCart.length) { setToast("暂存区没有课程"); return; }
    persistDrafts((() => {
      const base = savedDrafts.length >= 5 ? savedDrafts.slice(0, 4) : savedDrafts;
      return [...base, { name, courses: stageCart }];
    })());
    setToast(`草稿「${name}」已保存`);
  }, [stageCart, savedDrafts, persistDrafts]);
  const deleteDraft = useCallback((idx: number) => {
    persistDrafts(savedDrafts.filter((_, i) => i !== idx));
  }, [savedDrafts, persistDrafts]);
  const removeFromDraft = useCallback((idx: number, code: string, seq: string) => {
    const d = savedDrafts[idx];
    if (!d) return;
    persistDrafts(savedDrafts.map((x, i) => (i === idx ? { ...x, courses: x.courses.filter((c) => !(c.code === code && c.seq === seq)) } : x)));
  }, [savedDrafts, persistDrafts]);
  const saveCurrentAsDraft = useCallback((name: string) => {
    if (!selected.length) { setToast("没有已选课程"); return; }
    persistDrafts([...savedDrafts, {
      name,
      courses: selected.map((s) => ({
        code: s.code, seq: s.seq, name: s.name, teacher: s.teacher, time: s.time, credits: s.credits,
        flag: (s.typeCode === "006" ? "bx" : s.typeCode === "008" ? "xx" : s.typeCode === "007" ? "rx" : "ty") as XkFlag,
        zy: s.zy || 3, baseFlag: (s.typeCode === "006" ? "bx" : s.typeCode === "008" ? "xx" : s.typeCode === "007" ? "rx" : "ty") as XkFlag,
      })),
    }]);
    setToast(`已选课程已保存为「${name}」`);
  }, [selected, savedDrafts, persistDrafts]);
  const exportDraft = useCallback(async (idx: number) => {
    const d = savedDrafts[idx];
    if (!d) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify({ v: 1, name: d.name, courses: d.courses }));
      setToast(`草稿「${d.name}」已导出到剪贴板`);
    } catch {
      setToast("导出失败：剪贴板不可用");
    }
  }, [savedDrafts]);
  const importDraft = useCallback(() => {
    const raw = globalThis.prompt?.("粘贴导出的草稿 JSON");
    if (!raw) { setToast("已取消"); return; }
    try {
      const obj = JSON.parse(raw) as { name?: string; courses?: XkStageItem[] };
      const incoming = obj.courses;
      if (!Array.isArray(incoming)) throw new Error("缺少 courses");
      setStageCart((prev) => {
        const merged = [...prev];
        for (const c of incoming) if (!merged.some((s) => s.code === c.code && s.seq === c.seq)) merged.push(c);
        lsSet(LS.stage, merged);
        setToast(`已导入 ${incoming.length} 门课程到暂存区`);
        return merged;
      });
    } catch (e) {
      setToast(`导入失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);
  /** 提交草稿（§7.4 promoteDraft）：确认后先退全部已选（间隔 1s），再逐门选入（间隔 2s） */
  const submitDraft = useCallback(async (idx: number) => {
    const d = savedDrafts[idx];
    if (!d) return;
    if (!globalThis.confirm?.(`确定提交「${d.name}」？\n将先退选所有已选课程，再选入该草稿中的 ${d.courses.length} 门课程。`)) {
      setToast("已取消");
      return;
    }
    if (status === "demo") { setToast("演示模式：不执行提交"); return; }
    setBusy("promote");
    try {
      const olds = [...selected];
      for (let i = 0; i < olds.length; i++) {
        setProgress(`退选 ${i + 1}/${olds.length}：${olds[i]!.name}`);
        await dropXkCourse(xkSession(), { code: olds[i]!.code, seq: olds[i]!.seq, isQueue: false });
        if (i + 1 < olds.length) await new Promise((r) => setTimeout(r, 1000));
      }
      for (let i = 0; i < d.courses.length; i++) {
        const c = d.courses[i]!;
        setProgress(`选入 ${i + 1}/${d.courses.length}：${c.name}`);
        await submitXkCourse(xkSession(), { code: c.code, seq: c.seq, zy: c.zy || 3, flag: c.flag });
        if (i + 1 < d.courses.length) await new Promise((r) => setTimeout(r, 2000)); // 防验证码限速
      }
      setToast(`课表「${d.name}」已全部提交！`);
    } catch (err) {
      setToast(`提交出错: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setProgress(null);
      setBusy(null);
      void refreshCore(); // 写后轻量自愈：只刷右栏，左栏目录/状态不动
    }
  }, [savedDrafts, selected, refreshCore]);

  const addManualEvent = useCallback((name: string, day: number, slot: number) => {
    if (!name.trim()) { setToast("请输入活动名称"); return; }
    const ev: XkManualEvent = { id: `m${Date.now()}`, name: name.trim(), code: `manual-${Date.now()}`, seq: "0", time: `${day}-${slot}(自定义)`, manual: true, credits: 0 };
    setManualEvents((prev) => {
      const next = [...prev, ev];
      lsSet(LS.manual, next);
      return next;
    });
    setToast(`已添加「${name.trim()}」`);
  }, []);
  const removeManualEvent = useCallback((id: string) => {
    setManualEvents((prev) => {
      const ev = prev.find((e) => e.id === id);
      const next = prev.filter((e) => e.id !== id);
      lsSet(LS.manual, next);
      if (ev) setToast(`已删除「${ev.name}」`);
      return next;
    });
  }, []);

  const setPreview = useCallback((mode: "selected" | "stage" | "draft", idx = 0) => {
    setPreviewMode(mode);
    setPreviewDraftIdx(idx);
  }, []);

  const refreshQueue = useCallback(async () => {
    if (status === "demo") return;
    const myGen = genRef.current; // 期间切学期（generation 变更）则丢弃，防止串课
    setQueueState("loading");
    try {
      const sem = semBarRef.current ?? (await resolveZhjwxkSemester(xkSession()).catch(() => null));
      if (!sem) return;
      const qd = await getXkQueueData(xkSession(), { semester: sem });
      if (genRef.current !== myGen) return; // 期间已打断：丢弃过期结果
      setQueueMap(qd.map);
      setPhase(qd.phase);
      setQueueState("ready");
      setToast(`队列数据已刷新 · ${Object.keys(qd.map).length}门课余量 · ${candidates.length}门我的队列`);
    } catch (err) {
      logPageError("XK-QUEUE", err);
      if (isAuthError(err) && autoFullReload("xk")) return; // 失登：静默整页重载
      setToast("课余量排队人数获取失败，可能需退出重新登录");
      setQueueState("ready");
    }
  }, [status, candidates.length]);

  const semesterOptions = useMemo(() => {
    const cur = semester ?? semesterFromDate();
    const m = /^(\d{4})-(\d{4})-(\d)$/.exec(cur);
    const opts: Array<{ value: string; label: string }> = [{ value: cur, label: `${cur}（当前）` }];
    if (m) {
      const y0 = Number(m[1]);
      const s0 = Number(m[3]);
      const name = (s: number): string => (s === 1 ? "秋" : s === 2 ? "春" : "夏");
      // 全局学期序号 y*3+(s-1)：一学年 1秋/2春/3夏 顺序递推，跨学年自动进/退位
      const at = (delta: number): { value: string; label: string } => {
        const n = y0 * 3 + (s0 - 1) + delta;
        const y = Math.floor(n / 3);
        const s = (n % 3) + 1;
        return { value: `${y}-${y + 1}-${s}`, label: `${y}-${y + 1} ${name(s)}` };
      };
      // 当前 + 往后 2 个学期（含下学年秋/春，选课系统常提前开放）+ 往回 6 个
      for (let i = 1; i <= 2; i++) opts.push(at(i));
      for (let i = 1; i <= 6; i++) opts.push(at(-i));
    }
    return opts;
  }, [semester]);



  const setSemesterOverride = useCallback(async (sem: string | null) => {
    setSemesterOverrideState(sem);
    if (status === "demo") {
      semBarRef.current = sem;
      if (sem) setSemester(sem);
      return;
    }
    // ── 打断重启（用户指令：中间一旦被打断都要从头来）──
    // generation+1：在途 level/core/catalog/vol 结果 resolve 后比对代数一律丢弃；
    // pipelineSemRef 预登记目标学期，随后 runPipeline 不再重复 +1（两栏共享同一新代）。
    genRef.current += 1;
    pipelineSemRef.current = sem;
    // 学期栏当前选中值 = 唯一真源：同步写入（本帧 select 即显示新学期，绝不回跳旧值）
    semBarRef.current = sem;
    if (sem) setSemester(sem);
    // 左栏立刻清成空 loading 态（与上面同一批 commit 提交，旧学期数据不多渲染一帧）
    setCatalog([]);
    setVolMap({});
    setLevelTypes({});
    setPlan([]);
    setQueueMap({});
    setSelected([]);
    setCandidates([]);
    if (sem) {
      await runPipeline(sem, false);
    } else {
      // 回到系统学期：refresh 内解析 p_xnxq 并写回学期栏（带代数检查）
      await refresh(false);
    }
  }, [status, runPipeline, refresh]);

  const loadDetail = useCallback(async (code: string): Promise<XkCourseDetail | null> => {
    const row = courses.find((r) => r.c.code === code) ?? null;
    if (!row?.teacherId) return null;
    return getXkCourseDetail(xkSession(), { teacherId: row.teacherId, code: row.c.code }).catch(() => null);
  }, [courses]);

  /** 当前预览集合的槽位索引（课表网格 + 冲突筛选用） */
  const previewItems = useMemo<Array<SlotItem & { time: string }>>(() => {
    const src2: Array<SlotItem & { time: string }> =
      previewMode === "selected"
        ? [...selected.map((s) => ({ name: s.name, code: s.code, seq: s.seq, time: s.time })), ...candidates.filter((c) => !selected.some((s) => s.code === c.code)).map((c) => ({ name: c.name, code: c.code, seq: c.seq, time: c.time }))]
        : previewMode === "stage"
          ? stageCart.map((s) => ({ name: s.name, code: s.code, seq: s.seq, time: s.time }))
          : (savedDrafts[previewDraftIdx]?.courses ?? []).map((s) => ({ name: s.name, code: s.code, seq: s.seq, time: s.time }));
    const all = [...src2, ...manualEvents.map((e) => ({ name: e.name, code: e.code, seq: e.seq, time: e.time, manual: true as const }))];
    return all;
  }, [previewMode, previewDraftIdx, selected, candidates, stageCart, savedDrafts, manualEvents]);
  const previewIndex = useMemo(() => {
    const idx = new Map<string, SlotItem[]>();
    buildSlotIndex(previewItems, idx);
    return idx;
  }, [previewItems]);

  return {
    semester, selected, candidates, phase, queueMap, catalog, volMap, levelTypes,
    coreState, queueState, error, busy, toast,
    refresh, submit, drop, changeZy, setToast,
    courses, canAdjustZy, stageCart, addToStage, removeFromStage, updateStageItem, importStageItem,
    savedDrafts, saveDraft, deleteDraft, removeFromDraft, saveCurrentAsDraft, exportDraft, importDraft, submitDraft,
    manualEvents, addManualEvent, removeManualEvent,
    previewMode, previewDraftIdx, setPreview, progress, setProgress, refreshQueue, previewItems, previewIndex,
    semesterOverride, setSemesterOverride, semesterOptions, loadDetail, plan,
    searchState, searchRaw, searchRows, searchPage, searchHasMore, searchIncomplete, searchTotalPages, searchRunId, searchError,
    newSearch, gotoPage, loadAllSearch, retrySearch,
  };
}

/* ============ 信息门户（info 门户核心功能，thu-info-lib 移植） ============ */

export interface CardBundle {
  info: CardInfo;
  transactions: CardTransaction[];
}

/** 成绩单（getReport，thu-info-lib basics.ts 同源解析） */
const REPORT_KEY = "report";
const REPORT_TTL = 10 * 60 * 1000;

export function useReport() {
  const { status } = useApp();
  const [data, setData] = useState<ReportRow[] | null>(() => cacheGet<ReportRow[]>(REPORT_KEY)?.data ?? null);
  const [state, setState] = useState<DataState>(() => (cacheGet<ReportRow[]>(REPORT_KEY) ? "ready" : "loading"));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setState("loading");
      setError(null);
    }
    if (status === "demo") {
      setData(DEMO_REPORT);
      setState("ready");
      return;
    }
    try {
      setData(await cacheFetch(REPORT_KEY, () => info.getReport()));
      setState("ready");
    } catch (err) {
      logPageError("REPORT", err);
      if (silent && data !== null) return;
      setState("error");
      setError(explainNetworkError(err));
    }
  }, [status, data]);

  useEffect(() => {
    if (status !== "ready" && status !== "demo") return;
    const cached = cacheGet<ReportRow[]>(REPORT_KEY);
    if (!cached) void load(false);
    else if (Date.now() - cached.at > REPORT_TTL) void load(true);
  }, [status, load]);

  return { data, state, error, reload: load };
}

/** 校园卡余额 + 最近消费（getCardInfo / getCardTransactions 并行 + SWR 缓存） */
const CARD_TTL = 60 * 1000;

/** localStorage 回灌的 bundle 里 Date 已被 JSON 化成 ISO 字符串——读出处就地复活。
 *  （2026-09-02 白屏事故根因：字符串直进 fmtTime 调 .getMonth() 崩掉整棵 React 树。
 *  new Date(Date 实例) 克隆安全，故对内存/持久化两条路径统一无害。） */
function reviveCardBundle(b: CardBundle): CardBundle {
  return {
    info: {
      ...b.info,
      lastTransactionTimestamp: b.info.lastTransactionTimestamp
        ? new Date(b.info.lastTransactionTimestamp)
        : undefined,
    },
    transactions: (b.transactions ?? []).map((t) => ({ ...t, timestamp: new Date(t.timestamp) })),
  };
}

export function useCard(days = 30) {
  const { status } = useApp();
  const cardKey = `card:${days}`;
  const [data, setData] = useState<CardBundle | null>(() => {
    const entry = cacheGet<CardBundle>(cardKey);
    return entry ? reviveCardBundle(entry.data) : null;
  });
  const [state, setState] = useState<DataState>(() => (cacheGet<CardBundle>(cardKey) ? "ready" : "loading"));
  const [error, setError] = useState<string | null>(null);
  /* 登录态丢失静默自愈：成功清零，同一次失败最多自动恢复 1 次（reload 清零重计） */
  const recover = useRef(0);

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setState("loading");
      setError(null);
    }
    if (status === "demo") {
      setData(demoCardBundle());
      setState("ready");
      return;
    }
    try {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - days);
      // 余额与流水并行（此前串行等两跳，页首余额被流水拖慢）
      const [cardInfo, transactions] = await Promise.all([
        info.getCardInfo(),
        info.getCardTransactions(fmtDate(start), fmtDate(end)).catch((err: unknown) => {
          // 余额正常但流水失败时必须有日志可查（此前静默吞掉导致无法诊断）
          logPageError("CARD-TX", err);
          return [] as CardTransaction[];
        }),
      ]);
      cacheSet(cardKey, { info: cardInfo, transactions });
      setData({ info: cardInfo, transactions });
      recover.current = 0;
      setState("ready");
    } catch (err) {
      logPageError("CARD", err);
      // 登录态丢失（AuthRequiredError/未登录特征）：静默重建卡会话（forceEnsure）
      // 后自动重载一次，不闪红；仍失败才页内亮 ErrorNote（不踢回登录页）
      if (isAuthError(err) && autoFullReload("card")) return;
      // 整页重载被 2 分钟节流 → 落回数据级恢复兜底
      if (isAuthError(err) && recover.current < 1) {
        recover.current += 1;
        await info.forceEnsure("card").catch((renewErr: unknown) => {
          logPageError("CARD-RENEW", renewErr);
        });
        return load();
      }
      if (silent && data !== null) return;
      setState("error");
      setError(explainNetworkError(err));
    }
  }, [status, days, data, cardKey]);

  useEffect(() => {
    if (status !== "ready" && status !== "demo") return;
    const cached = cacheGet<CardBundle>(cardKey);
    if (!cached) void load(false);
    else if (Date.now() - cached.at > CARD_TTL) void load(true);
  }, [status, load, cardKey]);

  // reload 供重试按钮/切回本栏自动重试使用：清零自愈计数，用户动作可再获一次自动恢复
  const reload = useCallback(() => {
    recover.current = 0;
    return load();
  }, [load]);

  return { data, state, error, reload };
}

/* ============ 今日预约（首页聚合卡：图书馆座位 + 研讨间，按「今天」过滤） ============ */

export interface TodayReservation {
  key: string;
  /** seat=图书馆座位（记录只有开始时间），room=研讨间（有起止时段） */
  kind: "seat" | "room";
  /** 场馆：座位=pos 冒号前段；研讨间=kindName */
  venue: string;
  /** 位置：座位号 / 房间名 */
  place: string;
  start: Date;
  /** 座位预约记录无结束时间 */
  end: Date | null;
  /** 附加说明（座位状态 / 研讨间成员数） */
  note?: string;
}

/** "YYYY-MM-DD HH:mm"（getLibBookRecords.time）→ 本地 Date；不匹配返回 null */
function parseYmdHm(raw: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(raw.trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
}

/**
 * 今日预约数据源（首页「今日预约」卡）：图书馆座位（getLibBookRecords）
 * + 研讨间（getLibRoomRecords，core 返回未来 6 天）按今天过滤后按开始时间排序。
 * 两路 allSettled 互相独立：任一失败落日志并按「无预约」处理，不阻塞另一路；
 * 今天没有预约即空列表（卡片整卡不渲染，不占位）。
 */
const TODAYRESV_KEY = "todayresv";
const TODAYRESV_TTL = 2 * 60 * 1000;

export function useTodayReservations() {
  const { status } = useApp();
  const [list, setList] = useState<TodayReservation[] | null>(() => cacheGet<TodayReservation[]>(TODAYRESV_KEY)?.data ?? null);
  const [state, setState] = useState<DataState>(() => (cacheGet<TodayReservation[]>(TODAYRESV_KEY) ? "ready" : "loading"));

  const load = useCallback(async (silent = false) => {
    if (!silent) setState("loading");
    if (status === "demo") {
      const base = new Date();
      const at = (h: number, m: number) =>
        new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m);
      setList([
        { key: "demo-seat", kind: "seat", venue: "逸夫馆 三层", place: "037 号", start: at(14, 0), end: null, note: "正常" },
        { key: "demo-room", kind: "room", venue: "研讨间", place: "三教 1302", start: at(18, 0), end: at(20, 0), note: "成员 3 人" },
      ]);
      setState("ready");
      return;
    }
    const [seatRes, roomRes] = await Promise.allSettled([
      info.getLibBookRecords(),
      info.getLibRoomRecords(session.username),
    ]);
    const seats: TodayReservation[] = [];
    if (seatRes.status === "fulfilled") {
      const today = fmtDate(new Date());
      for (const r of seatRes.value) {
        const start = parseYmdHm(r.time);
        if (!start || fmtDate(start) !== today) continue; // 只聚合今天的
        if (/取消|违约|作废/.test(r.status)) continue;
        const idx = r.pos.indexOf(":");
        seats.push({
          key: `seat-${r.id}-${r.time}`,
          kind: "seat",
          venue: (idx >= 0 ? r.pos.slice(0, idx) : r.pos || "图书馆").replace(/-/g, " ").trim(),
          place: idx >= 0 ? r.pos.slice(idx + 1).trim() : "",
          start,
          end: null,
          note: r.status || undefined,
        });
      }
    } else {
      logPageError("TODAY-RESV-SEAT", seatRes.reason);
    }
    const rooms: TodayReservation[] = [];
    if (roomRes.status === "fulfilled") {
      const today = fmtDate(new Date());
      for (const r of roomRes.value) {
        if (r.date !== today) continue;
        if (Number.isNaN(r.begin.getTime())) continue; // 服务端字段缺失 → Invalid Date
        rooms.push({
          key: `room-${r.uuid || r.rsvId}`,
          kind: "room",
          venue: r.kindName || "研讨间",
          place: r.devName,
          start: r.begin,
          end: r.end,
          note: r.members.length > 0 ? `成员 ${r.members.length} 人` : undefined,
        });
      }
    } else {
      logPageError("TODAY-RESV-ROOM", roomRes.reason);
    }
    const merged = [...seats, ...rooms].sort((a, b) => a.start.getTime() - b.start.getTime());
    cacheSet(TODAYRESV_KEY, merged);
    setList(merged);
    setState("ready");
  }, [status]);

  useEffect(() => {
    if (status !== "ready" && status !== "demo") return;
    const cached = cacheGet<TodayReservation[]>(TODAYRESV_KEY);
    if (!cached) void load(false);
    else if (Date.now() - cached.at > TODAYRESV_TTL) void load(true);
  }, [status, load]);

  return { list, state, reload: load };
}

/* ============ 首页「最近日程」（校历节点：开学/学期结束，取自 learn 校历） ============ */

/** 校历节点（首页「最近日程」行） */
export interface TodayCalendarNode {
  key: string;
  /** 节点名（如 "2025-2026 秋季学期 开学"） */
  name: string;
  /** 节点日期（本地零点） */
  date: Date;
  /** 日历天数差（0=今天，与 Today 页 calDaysUntil 同口径） */
  daysUntil: number;
}

/** "YYYY-MM-DD"（CalendarSemester.firstDay）→ 本地零点 Date；不匹配返回 null */
function parseYmdDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** 校历展开为节点（升序）：当前学期 = 开学 + 学期结束（按 firstDay+weekCount 推算，
 *  core 的 weekCount 即由 jssj 推得，误差 ≤ 数日）；未来学期只取开学节点。
 *  OneTHU core 校历只有学期边界（无选课/退课 stage），能给的节点即 开学/结束。 */
function calendarNodes(cal: CalendarData): TodayCalendarNode[] {
  const nodes: TodayCalendarNode[] = [];
  const push = (sem: CalendarSemester, withEnd: boolean) => {
    const start = parseYmdDate(sem.firstDay);
    if (!start) return;
    const nm = sem.semesterName || sem.semesterId;
    nodes.push({ key: `${sem.semesterId}-start`, name: `${nm} 开学`, date: start, daysUntil: 0 });
    if (withEnd) {
      const end = new Date(start.getTime() + Math.max(1, sem.weekCount || 1) * 7 * 86400000 - 86400000);
      nodes.push({ key: `${sem.semesterId}-end`, name: `${nm} 结束`, date: end, daysUntil: 0 });
    }
  };
  push(cal, true);
  for (const sem of cal.nextSemesterList ?? []) push(sem, false);
  const n = new Date();
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  return nodes
    .map((x) => ({
      ...x,
      daysUntil: Math.round((new Date(x.date.getFullYear(), x.date.getMonth(), x.date.getDate()).getTime() - today) / 86400000),
    }))
    .filter((x) => x.daysUntil >= 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * 首页「最近日程」数据源：learn.getCalendarData 展开为未来校历节点（升序，
 * UI 取前 N 条）。失败静默（state="error" 且 nodes=null）：首页该卡整卡隐藏，
 * 不弹错误条。demo 模式合成一份相对今天的演示校历（真实接口 demo 不可用）。
 */
const TODAYCAL_KEY = "todaycal";
const TODAYCAL_TTL = 30 * 60 * 1000;

export function useTodayCalendar() {
  const { status } = useApp();
  const [nodes, setNodes] = useState<TodayCalendarNode[] | null>(() => cacheGet<TodayCalendarNode[]>(TODAYCAL_KEY)?.data ?? null);
  const [state, setState] = useState<DataState>(() => (cacheGet<TodayCalendarNode[]>(TODAYCAL_KEY) ? "ready" : "loading"));

  const load = useCallback(async (silent = false) => {
    if (!silent) setState("loading");
    if (status === "demo") {
      // 演示校历：设当前为某 16 周学期的第 10 周（开学 = 9 周前的周一），节点相对今天生成
      const now = new Date();
      const wd = now.getDay() === 0 ? 7 : now.getDay();
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (wd - 1));
      const firstDay = new Date(monday.getTime() - 9 * 7 * 86400000);
      const y = now.getFullYear();
      const sem = (start: Date, id: string, name: string): CalendarSemester => ({
        firstDay: fmtDate(start),
        semesterId: id,
        semesterName: name,
        weekCount: 16,
      });
      setNodes(
        calendarNodes({
          ...sem(firstDay, `${y}-${y + 1}-1`, `${y}-${y + 1} 秋季学期`),
          nextSemesterList: [
            sem(new Date(firstDay.getTime() + 20 * 7 * 86400000), `${y}-${y + 1}-2`, `${y}-${y + 1} 春季学期`),
            sem(new Date(firstDay.getTime() + 36 * 7 * 86400000), `${y}-${y + 1}-3`, `${y}-${y + 1} 夏季学期`),
          ],
        }),
      );
      setState("ready");
      return;
    }
    try {
      const nodes2 = calendarNodes(await cacheFetch(TODAYCAL_KEY, () => learn.getCalendarData()));
      setNodes(nodes2);
      setState("ready");
    } catch (err) {
      logPageError("TODAY-CALENDAR", err);
      if (silent && nodes !== null) return;
      setNodes(null);
      setState("error"); // 静默：Today 页据此整卡隐藏
    }
  }, [status, nodes]);

  useEffect(() => {
    if (status !== "ready" && status !== "demo") return;
    const cached = cacheGet<TodayCalendarNode[]>(TODAYCAL_KEY);
    if (!cached) void load(false);
    else if (Date.now() - cached.at > TODAYCAL_TTL) void load(true);
  }, [status, load]);

  return { nodes, state, reload: load };
}

/** 考试安排（zhjw 课表 JSONP 分类「考试」） */
/** 校历（当前 + 未来学期；learn 直连 getCurrentAndNextSemester） */
const CAL_KEY = "calendar";
const CAL_TTL = 30 * 60 * 1000;

export function useCalendar() {
  const { status } = useApp();
  const [data, setData] = useState<CalendarData | null>(() => cacheGet<CalendarData>(CAL_KEY)?.data ?? null);
  const [state, setState] = useState<DataState>(() => (cacheGet<CalendarData>(CAL_KEY) ? "ready" : "loading"));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setState("loading");
      setError(null);
    }
    if (status === "demo") {
      setState("error");
      setError("演示模式暂无校历数据。");
      return;
    }
    try {
      setData(await cacheFetch(CAL_KEY, () => learn.getCalendarData()));
      setState("ready");
    } catch (err) {
      logPageError("CALENDAR", err);
      if (silent && data !== null) return;
      setState("error");
      setError(explainNetworkError(err));
    }
  }, [status, data]);

  useEffect(() => {
    if (status !== "ready") return;
    const cached = cacheGet<CalendarData>(CAL_KEY);
    if (!cached) void load(false);
    else if (Date.now() - cached.at > CAL_TTL) void load(true);
  }, [status, load]);

  return { data, state, error, reload: load };
}

/** 某教学周课表（week 从 1 起，按所选学期 firstDay 平移 7 天窗口；info.getSchedule zhjw JSONP） */
const WEEKSCHED_TTL = 10 * 60 * 1000;

export function useWeekSchedule(semester: CalendarSemester | null, week: number) {
  const { status } = useApp();
  const wsKey = semester ? `weeksched:${semester.semesterId}:${week}` : null;
  const [data, setData] = useState<ScheduleEntry[] | null>(
    () => (wsKey ? cacheGet<ScheduleEntry[]>(wsKey)?.data ?? null : null),
  );
  const [state, setState] = useState<DataState | "idle">(() =>
    wsKey && cacheGet<ScheduleEntry[]>(wsKey) ? "ready" : "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (status === "demo") {
      setData(DEMO_SCHEDULE);
      setState("ready");
      return;
    }
    if (status !== "ready" || !semester || !wsKey) return;
    let cancelled = false;
    const cached = cacheGet<ScheduleEntry[]>(wsKey);
    if (cached) {
      // 旧值先亮（切周回来 0ms 上屏）；新鲜则跳过网络
      setData(cached.data);
      setState("ready");
      if (Date.now() - cached.at < WEEKSCHED_TTL) return;
    } else {
      setState("loading");
    }
    setError(null);
    const base = new Date(semester.firstDay.replace(/-/g, "/"));
    const start = new Date(base.getTime() + (week - 1) * 7 * 86400000);
    const end = new Date(start.getTime() + 6 * 86400000);
    info
      .getSchedule(fmtDate(start), fmtDate(end))
      .then((entries) => {
        if (!cancelled) {
          cacheSet(wsKey, entries);
          setData(entries);
          setState("ready");
        }
      })
      .catch((err: unknown) => {
        logPageError("SCHEDULE", err);
        if (!cancelled) {
          // 已有旧值（缓存）时不闪红：SWR 语义，保留旧课表
          if (cacheGet<ScheduleEntry[]>(wsKey)) return;
          setError(explainNetworkError(err));
          setState("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [status, semester, week, nonce, wsKey]);

  return { data, state, error, reload: () => setNonce((n) => n + 1) };
}

const EXAMS_KEY = "exams";
const EXAMS_TTL = 10 * 60 * 1000;

export function useExams() {  const { status } = useApp();
  const [data, setData] = useState<ExamEntry[] | null>(() => cacheGet<ExamEntry[]>(EXAMS_KEY)?.data ?? null);
  const [state, setState] = useState<DataState>(() => (cacheGet<ExamEntry[]>(EXAMS_KEY) ? "ready" : "loading"));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setState("loading");
      setError(null);
    }
    if (status === "demo") {
      setData(DEMO_EXAMS);
      setState("ready");
      return;
    }
    try {
      setData(await cacheFetch(EXAMS_KEY, () => info.getExams()));
      setState("ready");
    } catch (err) {
      logPageError("EXAMS", err);
      if (silent && data !== null) return;
      setState("error");
      setError(explainNetworkError(err));
    }
  }, [status, data]);

  useEffect(() => {
    if (status !== "ready" && status !== "demo") return;
    const cached = cacheGet<ExamEntry[]>(EXAMS_KEY);
    if (!cached) void load(false);
    else if (Date.now() - cached.at > EXAMS_TTL) void load(true);
  }, [status, load]);

  return { data, state, error, reload: load };
}

/** 校内新闻（getNewsList；page 变化自动重取） */
const NEWS_TTL = 5 * 60 * 1000;

export function useNews(page: number, length = 20) {
  const { status } = useApp();
  const newsKey = `news:${page}:${length}`;
  const [data, setData] = useState<NewsItem[] | null>(() => cacheGet<NewsItem[]>(newsKey)?.data ?? null);
  const [state, setState] = useState<DataState>(() => (cacheGet<NewsItem[]>(newsKey) ? "ready" : "loading"));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setState("loading");
      setError(null);
    }
    if (status === "demo") {
      setData(page === 1 ? DEMO_NEWS : []);
      setState("ready");
      return;
    }
    try {
      setData(await cacheFetch(newsKey, () => info.getNews(page, length)));
      setState("ready");
    } catch (err) {
      logPageError("NEWS p" + page, err);
      if (silent && data !== null) return;
      setState("error");
      setError(explainNetworkError(err));
    }
  }, [status, page, length, data, newsKey]);

  useEffect(() => {
    if (status !== "ready" && status !== "demo") return;
    const cached = cacheGet<NewsItem[]>(newsKey);
    if (!cached) void load(false);
    else if (Date.now() - cached.at > NEWS_TTL) void load(true);
  }, [status, load, newsKey]);

  return { data, state, error, reload: load };
}

/* ============ 首页「倒计时提醒」（学校重要事项：选课/退课/推研等，失败静默隐藏） ============ */

/**
 * 首页倒计时数据源（thu-info-app 首页「倒计时提醒」同源：core getDeadlines =
 * info 门户 deadline 接口 /b/info/gxfw/common/deadline/list，djsbt/djskssj/djsjzsj/djsurl）。
 * 返回原始全量列表——时间窗过滤（开始前 14 天 ~ 截止，thu-info home activeEvents
 * 同口径）在 Today 卡片内做。失败静默（state="error"，整卡隐藏）；demo 给相对日期演示事项。
 */
const DEADLINES_KEY = "deadlines";
const DEADLINES_TTL = 10 * 60 * 1000;

export function useTodayDeadlines() {
  const { status } = useApp();
  const [list, setList] = useState<DeadlineItem[] | null>(() => cacheGet<DeadlineItem[]>(DEADLINES_KEY)?.data ?? null);
  const [state, setState] = useState<DataState>(() => (cacheGet<DeadlineItem[]>(DEADLINES_KEY) ? "ready" : "loading"));

  const load = useCallback(async (silent = false) => {
    if (!silent) setState("loading");
    if (status === "demo") {
      const off = (days: number, hh: number): string => {
        const d = new Date();
        d.setDate(d.getDate() + days);
        d.setHours(hh, 0, 0, 0);
        const p = (x: number) => String(x).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
      };
      setList([
        { title: "选课补退选阶段", begin: off(-1, 8), end: off(5, 17) },
        { title: "推研报名与确认", begin: off(3, 9), end: off(10, 17) },
        { title: "英语水平考试报名", begin: off(8, 9), end: off(15, 17) },
      ]);
      setState("ready");
      return;
    }
    try {
      const items = await cacheFetch(DEADLINES_KEY, () => info.getDeadlines());
      setList(items);
      setState("ready");
    } catch (err) {
      logPageError("TODAY-DEADLINES", err);
      if (silent && list !== null) return;
      setList(null);
      setState("error"); // 静默：Today 页据此整卡隐藏
    }
  }, [status, list]);

  useEffect(() => {
    if (status !== "ready" && status !== "demo") return;
    const cached = cacheGet<DeadlineItem[]>(DEADLINES_KEY);
    if (!cached) void load(false);
    else if (Date.now() - cached.at > DEADLINES_TTL) void load(true);
  }, [status, load]);

  return { list, state, reload: load };
}

/* ============ 首页「订阅新闻」（订阅来源优先，回退最新；失败静默隐藏） ============ */

/** 新闻时间倒序比较（NewsTab 订阅动态聚合同语义；解析失败视为最旧） */
function newsTimeOf(s: string | undefined): number {
  if (!s) return 0;
  const t = Date.parse(s.includes(" ") ? s.replace(" ", "T") : s);
  return Number.isNaN(t) ? 0 : t;
}

export interface TodayNewsFeed {
  list: NewsItem[];
  /** from: "subs" = 已订阅来源逐源取数聚合；"latest" = 回退最新新闻 */
  from: "subs" | "latest";
  /** 本次加载时读到的订阅来源数（卡片 aside 展示用） */
  subCount: number;
}

/**
 * 首页新闻卡数据源（与 NewsTab「订阅动态」同一服务端链路）：
 * - 有订阅（localStorage onethu.news.subs，由 Today 页读好传入）：在服务端订阅条件
 *   （core getNewsSubscriptionList，权威）里按来源名映射条件 id，逐条件调
 *   getNewsListBySubscription(1, dyid)（门户订阅取数，allSettled 容错，每来源前 5 条），
 *   合并 xxid 去重、时间倒序取前 5；订阅链失败/来源无内容 → 回退最新。
 * - 无订阅：getNews 第 1 页前 5 条（门户顺序 = 置顶 + 最新）。
 * - 失败静默（state="error"，Today 页据此整卡隐藏）；demo 用 DEMO_NEWS 过滤/兜底。
 */
const TODAYNEWS_TTL = 5 * 60 * 1000;

export function useTodayNewsFeed(subs: string[]) {
  const { status } = useApp();
  const [data, setData] = useState<TodayNewsFeed | null>(null);
  const [state, setState] = useState<DataState>("loading");

  /** 订阅集合的稳定键：内容不变不重拉（NewsTab feedKey 同款） */
  const subsKey = subs.join("\u0001");
  const feedKey = `todaynews:${subsKey}`;

  const load = useCallback(async (silent = false) => {
    if (!silent) setState("loading");
    const subList = subsKey ? subsKey.split("\u0001") : [];
    const latest = async (): Promise<TodayNewsFeed> => {
      if (status === "demo") {
        return { list: DEMO_NEWS.slice(0, 5), from: "latest", subCount: subList.length };
      }
      const items = await info.getNews(1, 20);
      return { list: items.slice(0, 5), from: "latest", subCount: subList.length };
    };
    if (status === "demo") {
      const subSet = new Set(subList);
      const feed = subList.length > 0
        ? DEMO_NEWS.filter((n) => n.source && subSet.has(n.source)).sort((a, b) => newsTimeOf(b.date) - newsTimeOf(a.date))
        : [];
      setData(
        feed.length > 0
          ? { list: feed.slice(0, 5), from: "subs", subCount: subList.length }
          : await latest(),
      );
      setState("ready");
      return;
    }
    try {
      if (subList.length > 0) {
        // 服务端订阅条件（权威）→ 来源名映射条件 id（本地无对应服务端条件的来源跳过）
        const conds: Array<{ id: string; source?: string }> = await info
          .getNewsSubscriptionList()
          .catch(() => []);
        const ids = subList
          .map((s) => conds.find((c) => c.source === s)?.id ?? "")
          .filter(Boolean);
        const results = await Promise.allSettled(ids.map((id) => info.getNewsListBySubscription(1, id)));
        const pooled: NewsItem[] = [];
        for (const r of results) if (r.status === "fulfilled") pooled.push(...r.value.slice(0, 5));
        const seen = new Set<string>();
        const items = pooled
          .sort((a, b) => newsTimeOf(b.date) - newsTimeOf(a.date))
          .filter((n) => (n.xxid ? !seen.has(n.xxid) && seen.add(n.xxid) : true))
          .slice(0, 5);
        if (items.length > 0) {
          const feed = { list: items, from: "subs" as const, subCount: subList.length };
          cacheSet(feedKey, feed);
          setData(feed);
          setState("ready");
          return;
        }
        // 订阅链失败/来源无内容 → 回退最新新闻（卡片注明）
      }
      const feed = await latest();
      cacheSet(feedKey, feed);
      setData(feed);
      setState("ready");
    } catch (err) {
      logPageError("TODAY-NEWS", err);
      if (silent && data !== null) return;
      setData(null);
      setState("error"); // 静默：Today 页据此整卡隐藏
    }
  }, [status, subsKey, feedKey, data]);

  useEffect(() => {
    if (status !== "ready" && status !== "demo") return;
    const cached = cacheGet<TodayNewsFeed>(feedKey);
    if (!cached) void load(false);
    else if (Date.now() - cached.at > TODAYNEWS_TTL) {
      setData(cached.data);
      setState("ready");
      void load(true);
    } else {
      setData(cached.data);
      setState("ready");
    }
  }, [status, load, feedKey]);

  return { data, state, reload: load };
}

/** 个人信息（grjbxx HTML 解析） */
const PROFILE_KEY = "profile";
const PROFILE_TTL = 30 * 60 * 1000;

export function useProfile() {
  const { status } = useApp();
  const [data, setData] = useState<BasicUserInfo | null>(() => cacheGet<BasicUserInfo>(PROFILE_KEY)?.data ?? null);
  const [state, setState] = useState<DataState>(() => (cacheGet<BasicUserInfo>(PROFILE_KEY) ? "ready" : "loading"));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setState("loading");
      setError(null);
    }
    if (status === "demo") {
      setData(DEMO_USER);
      setState("ready");
      return;
    }
    try {
      const base = await info.getUserInfo();
      // grjbxx JSON 无专业/院系/性别——从教务学籍表（成绩单页首）补齐
      const missing = !base.gender || !base.department || !base.major;
      let merged = base;
      if (missing) {
        const xjxx = await info.getZhjwXjxx().catch(() => null);
        merged = {
          ...base,
          gender: base.gender ?? xjxx?.gender,
          department: base.department ?? xjxx?.department,
          major: base.major ?? xjxx?.major,
        };
      }
      cacheSet(PROFILE_KEY, merged);
      setData(merged);
      setState("ready");
    } catch (err) {
      logPageError("PROFILE", err);
      if (silent && data !== null) return;
      setState("error");
      setError(explainNetworkError(err));
    }
  }, [status, data]);

  useEffect(() => {
    if (status !== "ready" && status !== "demo") return;
    const cached = cacheGet<BasicUserInfo>(PROFILE_KEY);
    if (!cached) void load(false);
    else if (Date.now() - cached.at > PROFILE_TTL) void load(true);
  }, [status, load]);

  return { data, state, error, reload: load };
}
