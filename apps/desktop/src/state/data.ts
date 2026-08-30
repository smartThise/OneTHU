/** 校园数据钩子：真实模式取自 @onethu/core；演示模式返回 demo 数据（界面明确标注）。 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { XkCourseDetail, ZhjwxkSession, BasicUserInfo, CalendarData, CalendarSemester, CardInfo, CardTransaction, CourseFile, CourseInfo, ExamEntry, Homework, NewsItem, Notification, QueueCandidate, ReportRow, ScheduleEntry, SelectedCourse, SemesterInfo, XkCourse, XkFlag, XkLevelTableRow, XkQueueInfo, XkSelectedRow, XkVolInfo } from "@onethu/core";
import {
  changeXkVolunteer,
  dropXkCourse,
  getQueueStatus,
  getSelectedCourses,
  getXkCatalog,
  getXkCourseDetail,
  getXkLevelTable,
  getXkPlan,
  getXkSelectedFull,
  getXkQueueData,
  getXkVolunteer,
  isAuthError,
  resolveZhjwxkSemester,
  semesterFromDate,
  submitXkCourse,
} from "@onethu/core";
import { http, info, learn, logLine, session } from "../lib/clients.js";
import { explainNetworkError } from "../lib/transport.js";
import { buildRows, buildSlotIndex, canAdjustZy as canAdjustZyFn, levelRowsToCatalog, levelTypesOf, mergeLevelIntoCatalog, type SlotItem, type XkRow } from "../lib/xklogic.js";
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

export function useCampusData() {
  const { status, backToLogin } = useApp();
  const [data, setData] = useState<CampusData | null>(null);
  const [state, setState] = useState<DataState>("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
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
      setData(await loadReal());
      setState("ready");
    } catch (err) {
      // 会话真死了（AuthRequiredError）：先免密重漫游一次，仍失败才送回登录页
      if (err instanceof Error && err.name === "AuthRequiredError") {
        logPageError("CAMPUS-AUTH", err);
        const reRoamed = await relearnRoamOnce();
        if (reRoamed) {
          await load();
          return;
        }
        backToLogin();
        return;
      }
      logPageError("CAMPUS", err);
      setState("error");
      setError(explainNetworkError(err));
    }
  }, [status, backToLogin]);

  useEffect(() => {
    if (status === "ready" || status === "demo") void load();
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
export function useSemesters() {
  const { status, backToLogin } = useApp();
  const [list, setList] = useState<string[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [state, setState] = useState<DataState>("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
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
    if (status === "ready" || status === "demo") void load();
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

/* staticData SWR 缓存（content.js:269-345 移植）：level/catalog/vol/plan 持久化，vol 四检点过期。
 * 学期键契约（防误读自证）：SdShape.semester 记录"这份缓存抓取时的学期"；
 * sdRead 只做形状校验，学期一致性由唯一读取方 loadCatalogWith 的 `sd.semester === sem` 判定，
 * 缓存学期 ≠ 目标学期时整包弃用（绝不拿别的学期缓存顶包）；sdWrite 永远以本次抓取的 sem 落键。 */
const SD_KEY = "onethu.xk.staticData";
const SD_VER = 6; // v6：+ level（一级课表先行管线的持久缓存）
interface SdShape { ver: number; semester: string; level: Record<string, XkLevelTableRow>; catalog: XkCourse[]; vol: Record<string, XkVolInfo>; plan: XkPlanItem[]; volTs: number }
function sdRead(): SdShape | null {
  try {
    const raw = globalThis.localStorage?.getItem(SD_KEY);
    if (!raw) return null;
    const sd = JSON.parse(raw) as SdShape;
    return sd.ver === SD_VER && Array.isArray(sd.catalog) && sd.catalog.length >= 100 ? sd : null;
  } catch { return null; }
}
function sdWrite(sd: SdShape): void {
  try { globalThis.localStorage?.setItem(SD_KEY, JSON.stringify(sd)); } catch { /* 配额 */ }
}
/** 志愿重校验四检点（8/12/16/20 点）：纯时间判定、与学期无关，
 *  只允许作用于已通过 `sd.semester === sem` 学期校验的那份缓存（不跨学期误读）。 */
function volNeedsRefresh(volTs: number): boolean {
  const now = new Date();
  const h = now.getHours();
  let b: Date;
  if (h < 8) {
    b = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 20, 0, 0, 0);
  } else {
    const cp = [8, 12, 16, 20].filter((c) => c <= h);
    b = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.max(...cp), 0, 0, 0);
  }
  return volTs < b.getTime();
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

/** 目录+志愿模块缓存（v1.4.9 staticData 同思路：5 分钟 TTL，换学期即失效） */
let xkCache: { semester: string; at: number; catalog: XkCourse[]; vol: Record<string, XkVolInfo> } | null = null;
const XK_CACHE_TTL = 5 * 60_000;

/* ── 一级课表先行管线（levelTable-first）：共享缓存 / 在途去重 / levelFailed 标记 ── */
/** 内存级一级课表缓存（refresh 与目录管线共用一份，小而快，避免同页重复请求） */
let levelCache: { sem: string; at: number; table: Record<string, XkLevelTableRow> } | null = null;
const LEVEL_CACHE_TTL = 5 * 60_000;
/** fresh 重抓的防抖窗口：mount 时 refresh 与 loadCatalogWith 相邻发起，只发一次请求 */
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
  catalogState: DataState | "idle";
  queueState: DataState | "idle";
  error: string | null;
  busy: string | null;
  toast: string | null;
  refresh: () => Promise<void>;
  loadCatalog: () => Promise<void>;
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

/**
 * 选课工作台数据源（nextthuxk v1.4.9 显示规格 §9 reducer 骨架的 hook 形态）：
 * 已选/候补/余量为核心数据（每次刷新拉取）；目录+志愿走模块缓存（SWR 思路）。
 * 写操作串行（token 一次性，v1.3.12 结论），完成后自动刷新已选/候补/余量。
 */
export function useXkWorkbench(): XkWorkbench {
  const { status } = useApp();
  const [semester, setSemester] = useState<string | null>(null);
  const [semesterOverride, setSemesterOverrideState] = useState<string | null>(null);
  const semRef = useRef<string | null>(null);
  const catSemRef = useRef<string | null>(null);
  /** 学期覆盖的镜像 ref：refresh 不依赖 state（deps 只有 status），手动刷新不读陈旧闭包 */
  const overrideRef = useRef<string | null>(null);
  const [selected, setSelected] = useState<XkSelectedRow[]>([]);
  const [candidates, setCandidates] = useState<QueueCandidate[]>([]);
  const [phase, setPhase] = useState(false);
  const [queueMap, setQueueMap] = useState<Record<string, XkQueueInfo>>({});
  const [catalog, setCatalog] = useState<XkCourse[]>([]);
  const [volMap, setVolMap] = useState<Record<string, XkVolInfo>>({});
  const [levelTypes, setLevelTypes] = useState<Record<string, string>>({});
  const [coreState, setCoreState] = useState<DataState>("loading");
  const [catalogState, setCatalogState] = useState<DataState | "idle">("idle");
  const [queueState, setQueueState] = useState<DataState | "idle">("idle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async (semArg?: string) => {
    if (status === "demo") {
      setSemester(semesterFromDate());
      setSelected(DEMO_ZHJWXK_COURSES.map((c) => ({
        code: c.code, seq: "0", name: c.name, teacher: c.teacher, time: c.time,
        credits: c.credits, typeLabel: c.typeLabel, zy: 1,
        typeCode: c.typeLabel === "必修" ? "006" : c.typeLabel === "限选" ? "008" : c.typeLabel === "任选" ? "007" : "ty",
      })));
      setCandidates(DEMO_ZHJWXK_QUEUE);
      setPhase(true);
      setLevelTypes({});
      setCoreState("ready");
      return;
    }
    setCoreState("loading");
    setError(null);
    try {
      const sem = semArg ?? overrideRef.current ?? (await resolveZhjwxkSemester(xkSession()).catch(() => semesterFromDate()));
      semRef.current = sem;
      setSemester(sem);
      const opt = { semester: sem };
      // 一级课表永远第一个抓（小而快）：课型表 / 已选兜底 / 目录最小行共用这一份；
      // 失败/为空 → 内存标记 levelFailed（refresh 每次重抓，自愈解除）
      const lt = await fetchLevelTable(sem, true);
      if (semRef.current !== sem) return; // 期间已切学期：丢弃过期结果，防止串课
      if (lt) setLevelTypes(levelTypesOf(lt));
      const [sel, cand, qd, plan] = await Promise.all([
        getXkSelectedFull(xkSession(), opt).catch(async () => [] as XkSelectedRow[]),
        getQueueStatus(xkSession(), opt).catch(() => [] as QueueCandidate[]),
        getXkQueueData(xkSession(), opt).catch(() => ({ map: {}, phase: false })),
        getXkPlan(xkSession(), opt).catch(() => [] as XkPlanItem[]),
      ]);
      if (semRef.current !== sem) return; // 期间已切学期：丢弃过期结果，防止串课
      setPlan(plan);
      // 一级课表兜底（v1.4.9）：已选查询拿不到行（选课阶段切换/页面变更）时，
      // 用刚抓的一级课表重建（含课名/教师/学分），不再二次请求
      let selFinal = sel;
      if (!selFinal.length && lt) {
        selFinal = Object.entries(lt).map(([k, v]) => {
          const i = k.indexOf("_");
          return { code: k.slice(0, i), seq: k.slice(i + 1) || "0", name: v.name ?? "", teacher: v.teacher ?? "", time: "", credits: v.credits ?? 0, typeLabel: v.typeLabel, typeCode: v.typeCode, zy: 0 };
        });
      }
      setSelected(selFinal);
      setCandidates(cand);
      setQueueMap(qd.map);
      setPhase(qd.phase);
      setQueueState("ready");
      setCoreState("ready");
    } catch (err) {
      logPageError("ZHJWXK", err);
      setCoreState("error");
      setError(explainNetworkError(err));
    }
  }, [status]);

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
        levelCache = null; // 写操作可能改了一级课表（选上/退掉），refresh 内 fresh 重抓
        void refresh();
      }
    },
    [refresh],
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
    if (status === "ready" || status === "demo") void refresh();
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
  const enrichedCatalog = useMemo(
    () => (attrMap.size ? catalog.map((c) => (attrMap.has(c.code) && !c.attr ? { ...c, attr: attrMap.get(c.code)! } : c)) : catalog),
    [catalog, attrMap],
  );
  const courses = useMemo(
    () => buildRows(enrichedCatalog, volMap, queueMap, selected, candidates, levelTypes),
    [enrichedCatalog, volMap, queueMap, selected, candidates, levelTypes],
  );
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
      void refresh();
    }
  }, [savedDrafts, selected, refresh]);

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
    setQueueState("loading");
    try {
      const sem = semester ?? (await resolveZhjwxkSemester(xkSession()).catch(() => null));
      if (!sem) return;
      const qd = await getXkQueueData(xkSession(), { semester: sem });
      setQueueMap(qd.map);
      setPhase(qd.phase);
      setQueueState("ready");
      setToast(`队列数据已刷新 · ${Object.keys(qd.map).length}门课余量 · ${candidates.length}门我的队列`);
    } catch (err) {
      logPageError("XK-QUEUE", err);
      setToast("课余量排队人数获取失败，可能需退出重新登录");
      setQueueState("ready");
    }
  }, [status, semester, candidates.length]);

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

  /**
   * 目录管线（levelTable-first，v1.4.9 重构）：
   * Phase 1 一级课表永远第一优先（内存缓存 → 持久缓存(同学期) → 网络抓取），
   *         就绪后立刻用最小行（代码+序号+课程名+类型/属性）渲染课程列表；
   * Phase 2 持久缓存命中（仅同学期）：全量目录/志愿/方案 立即合并渲染，
   *         vol/plan/catalog 的后台重校验必须等一级课表就绪后才允许启动（四检点过期才启动）；
   * Phase 3 无缓存：后台抓全量目录+志愿（几千门课，严格在一级课表完成之后），
   *         到达后按 sk(code,seq) 合并替换（不丢一级课表 attr/类型信息），落持久缓存。
   * 一级课表失败/为空的学期（levelFailed 内存标记）才退回"全量目录优先"。
   */
  const loadCatalogWith = useCallback(async (sem: string) => {
    if (status === "demo") {
      setCatalogState("ready");
      return;
    }
    setCatalogState("loading");
    catSemRef.current = sem;
    // Phase 1 ── 一级课表（第一优先）
    const sd0 = sdRead();
    const sd = sd0 && sd0.semester === sem ? sd0 : null; // 缓存学期≠目标学期一律不采用
    let level: Record<string, XkLevelTableRow> | null = null;
    const lhit = levelCache && levelCache.sem === sem ? levelCache : null;
    if (lhit) level = lhit.table;
    else if (sd?.level && Object.keys(sd.level).length > 0) level = sd.level;
    else level = await fetchLevelTable(sem);
    if (catSemRef.current !== sem) return; // 期间已切走：丢弃
    const ltTable = level ?? {};
    if (level) {
      setLevelTypes(levelTypesOf(level));
      setCatalog(levelRowsToCatalog(level)); // 最小行立即渲染（余量/时间等由全量目录补全）
      setCatalogState("ready");
    }
    // 内存全量缓存（5min TTL，同学期）：一级课表就绪后直接合并渲染
    if (xkCache && xkCache.semester === sem && xkCache.catalog.length > 0 && Date.now() - xkCache.at < XK_CACHE_TTL) {
      setCatalog(xkCache.catalog);
      setVolMap(xkCache.vol);
      setCatalogState("ready");
      return;
    }
    // Phase 2 ── 持久缓存命中（同学期）：立即渲染 + 受检点控制的后台重校验
    if (sd) {
      const merged = mergeLevelIntoCatalog(sd.catalog, ltTable);
      xkCache = { semester: sem, at: Date.now(), catalog: merged, vol: sd.vol };
      setCatalog(merged);
      setVolMap(sd.vol);
      setPlan(sd.plan ?? []);
      setCatalogState("ready");
      // 志愿四检点过期 → 后台静默重校验（一级课表已就绪，绝不阻塞已渲染的界面）
      if (volNeedsRefresh(sd.volTs)) {
        void (async () => {
          try {
            const [cat2, vol2] = await Promise.all([
              getXkCatalog(xkSession(), { semester: sem }),
              getXkVolunteer(xkSession(), { semester: sem }).catch(() => ({}) as Record<string, XkVolInfo>),
            ]);
            if (catSemRef.current !== sem) return;
            const merged2 = mergeLevelIntoCatalog(cat2, ltTable);
            xkCache = { semester: sem, at: Date.now(), catalog: merged2, vol: vol2 };
            setCatalog(merged2);
            setVolMap(vol2);
            let plan2: XkPlanItem[] = sd.plan ?? [];
            try { plan2 = await getXkPlan(xkSession(), { semester: sem }); } catch { /* 保旧 */ }
            if (catSemRef.current !== sem) return;
            setPlan(plan2);
            sdWrite({ ver: SD_VER, semester: sem, level: ltTable, catalog: cat2, vol: vol2, plan: plan2, volTs: Date.now() });
          } catch { /* 静默 */ }
        })();
      }
      return;
    }
    // Phase 3 ── 无缓存：后台抓全量目录+志愿，到达后合并替换
    try {
      const [cat, vol] = await Promise.all([
        getXkCatalog(xkSession(), { semester: sem }),
        getXkVolunteer(xkSession(), { semester: sem }).catch(() => ({}) as Record<string, XkVolInfo>),
      ]);
      if (catSemRef.current !== sem) return; // 已切走：丢弃
      const merged = mergeLevelIntoCatalog(cat, ltTable);
      if (cat.length > 0) xkCache = { semester: sem, at: Date.now(), catalog: merged, vol };
      setCatalog(merged);
      setVolMap(vol);
      setCatalogState("ready");
      let plan: XkPlanItem[] = [];
      try { plan = await getXkPlan(xkSession(), { semester: sem }); } catch { plan = []; }
      if (catSemRef.current !== sem) return;
      setPlan(plan);
      sdWrite({ ver: SD_VER, semester: sem, level: ltTable, catalog: cat, vol, plan, volTs: Date.now() });
    } catch (err) {
      logPageError("XK-CATALOG", err);
      if (level) {
        // 一级课表最小行已渲染：保留列表不砸成错误页，仅提示全量目录失败
        setCatalogState("ready");
        setToast(`全量目录/志愿加载失败（当前显示一级课表行）：${explainNetworkError(err)}`);
      } else {
        setCatalogState("error");
        setError(explainNetworkError(err));
      }
    }
  }, [status, setToast]);

  /** 目录加载（默认学期 = override ?? 系统学期 p_xnxq）：统一走 loadCatalogWith
   *  （一级课表先行 → 缓存/全量目录合并），“缓存学期≠目标学期绝不顶包”在彼处判定 */
  const loadCatalog = useCallback(async () => {
    if (status === "demo") {
      setCatalogState("ready");
      return;
    }
    const sem = semesterOverride ?? semester ?? (await resolveZhjwxkSemester(xkSession()).catch(() => semesterFromDate()));
    if (!sem) return;
    await loadCatalogWith(sem);
  }, [status, semester, semesterOverride, loadCatalogWith]);

  const setSemesterOverride = useCallback(async (sem: string | null) => {
    setSemesterOverrideState(sem);
    overrideRef.current = sem;
    semRef.current = sem;       // 立即失效在途旧学期结果
    catSemRef.current = sem;
    xkCache = null;             // 换学期目录缓存失效
    // 切学期瞬间清空当前目录视图（目录/志愿/已选都是学期数据），
    // 等新学期一级课表（loadCatalogWith Phase 1）先行渲染最小行
    setCatalog([]);
    setVolMap({});
    setLevelTypes({});
    setSelected([]);
    setCandidates([]);
    if (sem) {
      await Promise.all([refresh(sem), loadCatalogWith(sem)]);
    } else {
      // 回到系统学期：refresh 后仍按同一条"一级课表先行"管线重载目录。
      // 学期取系统 p_xnxq（不走 loadCatalog 的 state 闭包——可能停留在旧学期）
      await refresh();
      const cur = await resolveZhjwxkSemester(xkSession()).catch(() => semesterFromDate());
      if (semRef.current !== cur) return; // 期间又切走了
      await loadCatalogWith(cur);
    }
  }, [refresh, loadCatalogWith]);

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
    coreState, catalogState, queueState, error, busy, toast,
    refresh, loadCatalog, submit, drop, changeZy, setToast,
    courses, canAdjustZy, stageCart, addToStage, removeFromStage, updateStageItem, importStageItem,
    savedDrafts, saveDraft, deleteDraft, removeFromDraft, saveCurrentAsDraft, exportDraft, importDraft, submitDraft,
    manualEvents, addManualEvent, removeManualEvent,
    previewMode, previewDraftIdx, setPreview, progress, setProgress, refreshQueue, previewItems, previewIndex,
    semesterOverride, setSemesterOverride, semesterOptions, loadDetail, plan,
  };
}

/* ============ 信息门户（info 门户核心功能，thu-info-lib 移植） ============ */

export interface CardBundle {
  info: CardInfo;
  transactions: CardTransaction[];
}

/** 成绩单（getReport，thu-info-lib basics.ts 同源解析） */
export function useReport() {
  const { status } = useApp();
  const [data, setData] = useState<ReportRow[] | null>(null);
  const [state, setState] = useState<DataState>("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    if (status === "demo") {
      setData(DEMO_REPORT);
      setState("ready");
      return;
    }
    try {
      setData(await info.getReport());
      setState("ready");
    } catch (err) {
      logPageError("REPORT", err);
      setState("error");
      setError(explainNetworkError(err));
    }
  }, [status]);

  useEffect(() => {
    if (status === "ready" || status === "demo") void load();
  }, [status, load]);

  return { data, state, error, reload: load };
}

/** 校园卡余额 + 最近消费（getCardInfo / getCardTransactions） */
/** 整页重载式自愈（等同手动右键刷新）；2 分钟节流防死循环。 */
function autoFullReload(scope: string): boolean {
  try {
    const key = `onethu.autoreload.${scope}`;
    const last = Number(sessionStorage.getItem(key) ?? "0");
    if (Date.now() - last < 120_000) return false;
    sessionStorage.setItem(key, String(Date.now()));
  } catch { /* 不可用则保守放行 */ }
  setTimeout(() => location.reload(), 150);
  return true;
}

export function useCard(days = 30) {
  const { status } = useApp();
  const [data, setData] = useState<CardBundle | null>(null);
  const [state, setState] = useState<DataState>("loading");
  const [error, setError] = useState<string | null>(null);
  /* 登录态丢失静默自愈：成功清零，同一次失败最多自动恢复 1 次（reload 清零重计） */
  const recover = useRef(0);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    if (status === "demo") {
      setData(demoCardBundle());
      setState("ready");
      return;
    }
    try {
      const cardInfo = await info.getCardInfo();
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - days);
      const transactions = await info
        .getCardTransactions(fmtDate(start), fmtDate(end))
        .catch((err: unknown) => {
          // 余额正常但流水失败时必须有日志可查（此前静默吞掉导致无法诊断）
          logPageError("CARD-TX", err);
          return [] as CardTransaction[];
        });
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
      setState("error");
      setError(explainNetworkError(err));
    }
  }, [status, days]);

  useEffect(() => {
    if (status === "ready" || status === "demo") void load();
  }, [status, load]);

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
export function useTodayReservations() {
  const { status } = useApp();
  const [list, setList] = useState<TodayReservation[] | null>(null);
  const [state, setState] = useState<DataState>("loading");

  const load = useCallback(async () => {
    setState("loading");
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
    setList([...seats, ...rooms].sort((a, b) => a.start.getTime() - b.start.getTime()));
    setState("ready");
  }, [status]);

  useEffect(() => {
    if (status === "ready" || status === "demo") void load();
  }, [status, load]);

  return { list, state, reload: load };
}

/** 考试安排（zhjw 课表 JSONP 分类「考试」） */
/** 校历（当前 + 未来学期；learn 直连 getCurrentAndNextSemester） */
export function useCalendar() {
  const { status } = useApp();
  const [data, setData] = useState<CalendarData | null>(null);
  const [state, setState] = useState<DataState>("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    if (status === "demo") {
      setState("error");
      setError("演示模式暂无校历数据。");
      return;
    }
    try {
      setData(await learn.getCalendarData());
      setState("ready");
    } catch (err) {
      logPageError("CALENDAR", err);
      setState("error");
      setError(explainNetworkError(err));
    }
  }, [status]);

  useEffect(() => {
    if (status === "ready") void load();
  }, [status, load]);

  return { data, state, error, reload: load };
}

/** 某教学周课表（week 从 1 起，按所选学期 firstDay 平移 7 天窗口；info.getSchedule zhjw JSONP） */
export function useWeekSchedule(semester: CalendarSemester | null, week: number) {
  const { status } = useApp();
  const [data, setData] = useState<ScheduleEntry[] | null>(null);
  const [state, setState] = useState<DataState | "idle">("idle");
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (status === "demo") {
      setData(DEMO_SCHEDULE);
      setState("ready");
      return;
    }
    if (status !== "ready" || !semester) return;
    let cancelled = false;
    setState("loading");
    setError(null);
    const base = new Date(semester.firstDay.replace(/-/g, "/"));
    const start = new Date(base.getTime() + (week - 1) * 7 * 86400000);
    const end = new Date(start.getTime() + 6 * 86400000);
    info
      .getSchedule(fmtDate(start), fmtDate(end))
      .then((entries) => {
        if (!cancelled) {
          setData(entries);
          setState("ready");
        }
      })
      .catch((err: unknown) => {
        logPageError("SCHEDULE", err);
        if (!cancelled) {
          setError(explainNetworkError(err));
          setState("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [status, semester, week, nonce]);

  return { data, state, error, reload: () => setNonce((n) => n + 1) };
}

export function useExams() {  const { status } = useApp();
  const [data, setData] = useState<ExamEntry[] | null>(null);
  const [state, setState] = useState<DataState>("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    if (status === "demo") {
      setData(DEMO_EXAMS);
      setState("ready");
      return;
    }
    try {
      setData(await info.getExams());
      setState("ready");
    } catch (err) {
      logPageError("EXAMS", err);
      setState("error");
      setError(explainNetworkError(err));
    }
  }, [status]);

  useEffect(() => {
    if (status === "ready" || status === "demo") void load();
  }, [status, load]);

  return { data, state, error, reload: load };
}

/** 校内新闻（getNewsList；page 变化自动重取） */
export function useNews(page: number, length = 20) {
  const { status } = useApp();
  const [data, setData] = useState<NewsItem[] | null>(null);
  const [state, setState] = useState<DataState>("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    if (status === "demo") {
      setData(page === 1 ? DEMO_NEWS : []);
      setState("ready");
      return;
    }
    try {
      setData(await info.getNews(page, length));
      setState("ready");
    } catch (err) {
      logPageError("NEWS p" + page, err);
      setState("error");
      setError(explainNetworkError(err));
    }
  }, [status, page, length]);

  useEffect(() => {
    if (status === "ready" || status === "demo") void load();
  }, [status, load]);

  return { data, state, error, reload: load };
}

/** 个人信息（grjbxx HTML 解析） */
export function useProfile() {
  const { status } = useApp();
  const [data, setData] = useState<BasicUserInfo | null>(null);
  const [state, setState] = useState<DataState>("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    if (status === "demo") {
      setData(DEMO_USER);
      setState("ready");
      return;
    }
    try {
      const base = await info.getUserInfo();
      // grjbxx JSON 无专业/院系/性别——从教务学籍表（成绩单页首）补齐
      const missing = !base.gender || !base.department || !base.major;
      if (missing) {
        const xjxx = await info.getZhjwXjxx().catch(() => null);
        setData({
          ...base,
          gender: base.gender ?? xjxx?.gender,
          department: base.department ?? xjxx?.department,
          major: base.major ?? xjxx?.major,
        });
      } else {
        setData(base);
      }
      setState("ready");
    } catch (err) {
      logPageError("PROFILE", err);
      setState("error");
      setError(explainNetworkError(err));
    }
  }, [status]);

  useEffect(() => {
    if (status === "ready" || status === "demo") void load();
  }, [status, load]);

  return { data, state, error, reload: load };
}
