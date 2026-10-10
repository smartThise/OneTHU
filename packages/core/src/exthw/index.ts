/**
 * 外部作业源统一入口：按凭据组装已配置的源。
 *
 * 用法（desktop）：
 *   const sources = createExternalSources({ creds, fetchLike: universalFetch, http });
 *   const results = await Promise.allSettled(sources.map((s) => s.fetch()));
 *
 * 设计：core 不碰 localStorage / DOM；失败隔离由调用方负责（这里只组装）。
 * TUOJ 系（AI / 经典）优先走带 CookieJar 的 HttpClient（清华统一认证漫游建立的会话在 jar 里）；
 * 雨课堂 / Tyche / DSA 仍走裸 FetchLike。
 */
import type { FetchLike, HttpClient } from "../http.js";
import type {
  ExtContentKind,
  ExtHwCreds,
  ExtHwSourceId,
  ExternalContent,
  ExternalCourse,
  ExternalHomework,
  HomeworkSource,
  RegisteredHomeworkSource,
  TuojCreds,
  TuojSourceId,
} from "./types.js";
import { SOURCE_CATEGORIES, SOURCE_NAMES } from "./types.js";
import { createYuketangSource } from "./yuketang.js";
import { BASE as TUOJ_BASE, CLASSIC_BASE as TUOJ_CLASSIC_BASE, createTuojSource, isTuojSessionError } from "./tuoj.js";
import { createTycheSource, isTycheSessionError } from "./tyche.js";
import { createDsaSource } from "./dsa.js";

export interface CreateExternalSourcesDeps {
  creds: ExtHwCreds;
  /** 裸 fetch（desktop 传 universalFetch，Node 冒烟脚本传原生 fetch） */
  fetchLike: FetchLike;
  /** 可选：带 CookieJar 的 core HttpClient（桌面端注入）。TUOJ 走它——
   *  清华统一认证漫游（tuojRoam）把会话写进 jar，后续拉取自动携带。
   *  缺省时退回 `fetchLike` + 凭据里的显式 Cookie 串。 */
  http?: HttpClient;
}

/** R13 18.1：按 `SOURCE_CATEGORIES` 给组装出的源附上大类元数据（courseware / oj）。
 *  纯信息架构字段，不改变凭据、拉取与展示。 */
const withCategory = (s: HomeworkSource): RegisteredHomeworkSource => ({
  ...s,
  category: SOURCE_CATEGORIES[s.id],
});

/** TUOJ 系单源组装（AI 版 / 经典版共用）：优先带 CookieJar 的 HttpClient——
 *  CAS 漫游（tuojRoam）把会话写进 jar，后续拉取自动携带；缺省退回显式 Cookie 串。
 *  强制直连（TUOJ 是公网域，绝不 WebVPN 包装）。 */
function buildTuojSource(
  id: TuojSourceId,
  base: string,
  cred: TuojCreds,
  fetchLike: FetchLike,
  days: number,
  http?: HttpClient,
): RegisteredHomeworkSource {
  if (http) {
    const jarCookie = http.cookieHeaderFor(`${base}/api/course/list`);
    const cookie = (jarCookie ?? cred.cookie ?? "").trim();
    return withCategory(
      createTuojSource({ cookie, username: cred.username }, (u, i) => http.request(u, { ...i, direct: true }), days, {
        base,
        id,
        name: SOURCE_NAMES[id],
      }),
    );
  }
  return withCategory(
    createTuojSource({ cookie: cred.cookie ?? "", username: cred.username }, fetchLike, days, {
      base,
      id,
      name: SOURCE_NAMES[id],
    }),
  );
}

export function createExternalSources({ creds, fetchLike, http }: CreateExternalSourcesDeps): RegisteredHomeworkSource[] {
  const days = typeof creds.days === "number" && creds.days > 0 ? creds.days : 30;
  const sources: RegisteredHomeworkSource[] = [];
  if (creds.yuketang?.cookie?.trim()) sources.push(withCategory(createYuketangSource(creds.yuketang, fetchLike, days)));
  // TUOJ 系：显式 Cookie 串（账号密码路径）或 CAS 漫游标记（via="cas"）任一存在即组装
  const tuoj = creds.tuoj;
  if (tuoj && (tuoj.cookie?.trim() || tuoj.via === "cas")) {
    sources.push(buildTuojSource("tuoj", TUOJ_BASE, tuoj, fetchLike, days, http));
  }
  const classic = creds.tuojClassic;
  if (classic && (classic.cookie?.trim() || classic.via === "cas")) {
    sources.push(buildTuojSource("tuojClassic", TUOJ_CLASSIC_BASE, classic, fetchLike, days, http));
  }
  if (creds.tyche?.cookie?.trim()) sources.push(withCategory(createTycheSource(creds.tyche, fetchLike, days)));
  if (creds.dsa?.cookie?.trim()) sources.push(withCategory(createDsaSource(creds.dsa, fetchLike, days)));
  return sources;
}

/** 是否 TUOJ 系源（tuoj / tuojClassic）——会话失效自动重漫游只对这两者生效 */
function isTuojFamily(id: ExtHwSourceId): id is TuojSourceId {
  return id === "tuoj" || id === "tuojClassic";
}

/* ── R12 17.1：三源并发拉取 + TUOJ 会话失效自动重漫游一次 ──
 * 桌面端此前在 state 层自行 allSettled；把编排下沉到 core 后，重试路径可用
 * 纯 mock 离线验收（tools/exthw-status-test.mjs）。core 仍不碰 localStorage：
 * 凭据经 `getCreds()` 每次现读（重漫游会改写它），重漫游动作经 `rerouteTuoj` 注入。 */

export interface RefreshExternalHomeworkDeps {
  /** 每次组装源时读取当前凭据（重漫游成功后凭据已更新，重试必须重新读取） */
  getCreds: () => ExtHwCreds;
  /** 裸 fetch（desktop 传 universalFetch，Node 测试传 mock） */
  fetchLike: FetchLike;
  /** 可选：带 CookieJar 的 core HttpClient（桌面端注入） */
  http?: HttpClient;
  /** TUOJ 系（tuoj / tuojClassic）已配置但会话失效（401/403）时的强制重漫游钩子，
   *  参数为具体源 id。返回 true = 漫游成功且凭据/会话已更新，随后自动重试该源**一次**；
   *  返回 false（含频控拦截）/ 抛出 = 放弃重试，保留原 401 错误。
   *  缺省（未注入）时不做任何重漫游，行为同旧版。
   *  R19 27.1：本钩子的调用已被进程级频控（同源 ≥10min / 每源 ≤3 次）与同源
   *  in-flight 去重包裹——并发 401 只会让钩子对同一源执行一次。 */
  rerouteTuoj?: (source: TuojSourceId) => Promise<boolean>;
  /** R21-A：Tyche 会话失效（status=login / 401 / 跳登录页）时的静默自动重登钩子
   *  （desktop 注入：已记住密码 → 用存档账密重登一次并覆盖保存凭据）。
   *  返回 true = 重登成功且凭据已更新，随后自动重拉该源**一次**；false / 抛出 = 放弃，
   *  保留原错误。与 TUOJ 重漫游共用同一套进程级频控（同源 ≥10min / 每进程 ≤3 次，
   *  tyche 独立计数）与 in-flight 去重。缺省时不做任何自动重登，行为同旧版。 */
  reloginTyche?: () => Promise<boolean>;
}

/* ── R19 27.1 / R21-A：会话失效自动重登的进程级频控与并发去重 ──
 * 旧频控（desktop 的 24h TUOJ_AUTO_THROTTLE_MS）对「已配置但 cookie 失效」这条最常见
 * 路径过于苛刻：一次失败（退后台 / 网络抖动）就把 24h 内的自动恢复全烧掉。会话失效触发的
 * 自动重登改用放宽策略：同一源两次自动重试间隔 ≥ 10 分钟、每进程每源最多 3 次；
 * TUOJ 两源 + Tyche 各自独立计数。状态存本模块（= 进程级），跨多次 refresh 累计。 */

/** 同一源两次自动重登的最小间隔（R19 27.1 定 TUOJ 值；R21-A Tyche 对齐同值） */
export const SESSION_RETRY_MIN_INTERVAL_MS = 10 * 60 * 1000;
/** 每进程每源自动重登次数上限（含失败尝试，否则永久失败的源会每 10 分钟烧一次永不封顶） */
export const SESSION_RETRY_MAX_PER_PROCESS = 3;
/** 兼容别名（R19 27.1 导出名；TUOJ 系语义） */
export const TUOJ_SESSION_RETRY_MIN_INTERVAL_MS = SESSION_RETRY_MIN_INTERVAL_MS;
export const TUOJ_SESSION_RETRY_MAX_PER_PROCESS = SESSION_RETRY_MAX_PER_PROCESS;
/** R21-A：Tyche 同策略别名（与 TUOJ 同值，独立计数） */
export const TYCHE_SESSION_RETRY_MIN_INTERVAL_MS = SESSION_RETRY_MIN_INTERVAL_MS;
export const TYCHE_SESSION_RETRY_MAX_PER_PROCESS = SESSION_RETRY_MAX_PER_PROCESS;

/** 会话失效触发过自动重登、但该源最终仍失败时的错误前缀（作业页 / 设置页文案，
 *  让用户知道系统已自动尝试过重新登录，而非首次失败） */
const SESSION_RELOGIN_FAILED_PREFIX = "已尝试自动重新登录，仍失败：";

/** 支持会话失效自动重登的源：TUOJ 两源（重漫游）+ tyche（账密重登，R21-A） */
type SessionRetrySourceId = TuojSourceId | "tyche";

function isSessionRetrySource(id: ExtHwSourceId): id is SessionRetrySourceId {
  return isTuojFamily(id) || id === "tyche";
}

const sessionRetryState: Record<SessionRetrySourceId, { count: number; lastAt: number }> = {
  tuoj: { count: 0, lastAt: 0 },
  tuojClassic: { count: 0, lastAt: 0 },
  tyche: { count: 0, lastAt: 0 },
};
/** 同一源并发会话失效共享一次自动重登（in-flight Promise 去重；R19 27.1 / R21-A） */
const sessionInflight: Partial<Record<SessionRetrySourceId, Promise<boolean>>> = {};

function sessionRetryAllowed(source: SessionRetrySourceId, now = Date.now()): boolean {
  const st = sessionRetryState[source];
  return st.count < SESSION_RETRY_MAX_PER_PROCESS && now - st.lastAt >= SESSION_RETRY_MIN_INTERVAL_MS;
}

/** 清空 TUOJ 系进程级重漫游频控 / 去重状态（仅离线测试用；应用内无需调用） */
export function resetTuojSessionRetryState(): void {
  sessionRetryState.tuoj = { count: 0, lastAt: 0 };
  sessionRetryState.tuojClassic = { count: 0, lastAt: 0 };
  delete sessionInflight.tuoj;
  delete sessionInflight.tuojClassic;
}

/** 清空 Tyche 进程级自动重登频控 / 去重状态（仅离线测试用；应用内无需调用） */
export function resetTycheSessionRetryState(): void {
  sessionRetryState.tyche = { count: 0, lastAt: 0 };
  delete sessionInflight.tyche;
}

export interface RefreshExternalHomeworkResult {
  items: ExternalHomework[];
  /** 各源透出的课程列表（当前只有雨课堂提供；OJ 平台无课程概念，恒为空）。
   *  与 items 同一轮拉取、共用同一次 courses/list 请求；失败静默（课程列表缺失
   *  不影响作业，也不写进 errors）。 */
  courses: ExternalCourse[];
  /** 各源透出的**全部课程内容**（作业/试卷之外的课件、投票…也在内；当前只有雨课堂
   *  提供，OJ 平台无此概念恒为空）。与 items 同一轮拉取、共用同一次学习日志请求；
   *  失败静默（内容目录缺失不影响作业，也不写进 errors）。 */
  contents: ExternalContent[];
  errors: Partial<Record<ExtHwSourceId, string>>;
  /** 是否因 TUOJ 系会话失效触发过强制重漫游（诊断/测试用；任一系列源命中即 true） */
  reroutedTuoj: boolean;
  /** 实际触发过重漫游的 TUOJ 系源（R15 20.2；诊断用） */
  reroutedSources: TuojSourceId[];
  /** R21-A：是否因 Tyche 会话失效触发过静默自动重登并重拉成功（诊断/测试用） */
  reloginTyche: boolean;
}

/** 各源并发拉取（allSettled，单源失败隔离）；TUOJ 系 401/403 → 强制重漫游一次并重试该源，
 *  Tyche 会话失效（status=login / 401 / 跳登录页）→ 静默自动重登一次并重拉该源（R21-A）。
 *  ⚠️ 防循环：单次调用每个源至多触发一次自动重登，重试仍失败不再进入第二轮。永不抛出。
 *  R19 27.1 / R21-A：重登动作套进程级频控（同源 ≥10min、每源每进程 ≤3 次，各源独立计数）
 *  + 同源 in-flight 去重（并发失效只发起一次，后来者共享其结果）；发起过重登而该源最终
 *  仍失败的，错误文案加「已尝试自动重新登录，仍失败：」前缀。 */
export async function refreshExternalHomework(
  deps: RefreshExternalHomeworkDeps,
): Promise<RefreshExternalHomeworkResult> {
  const sources = createExternalSources({
    creds: deps.getCreds(),
    fetchLike: deps.fetchLike,
    http: deps.http,
  });
  const results = await Promise.allSettled(sources.map((s) => s.fetch()));

  const reroutedSources: TuojSourceId[] = [];
  let reloginTycheOk = false;
  /** 本轮发起（或共享）过自动重登的源——最终仍失败时用于加文案前缀 */
  const rerouteAttempted = new Set<ExtHwSourceId>();

  /** 按源解析重登钩子：TUOJ 系走 rerouteTuoj，tyche 走 reloginTyche（R21-A）；未注入 = null */
  const hookFor = (sid: SessionRetrySourceId): (() => Promise<boolean>) | null => {
    if (sid === "tyche") return deps.reloginTyche ? () => deps.reloginTyche!() : null;
    return deps.rerouteTuoj ? () => deps.rerouteTuoj!(sid) : null;
  };
  /** 该源被拒的原因是否「会话失效」（TUOJ=TuojSessionError；tyche=TycheSessionError） */
  const isSessionErrorFor = (sid: SessionRetrySourceId, reason: unknown): boolean =>
    sid === "tyche" ? isTycheSessionError(reason) : isTuojSessionError(reason);

  if (deps.rerouteTuoj || deps.reloginTyche) {
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      if (!src || !isSessionRetrySource(src.id)) continue;
      const sid: SessionRetrySourceId = src.id;
      const hook = hookFor(sid);
      if (!hook) continue;
      const r = results[i];
      if (r?.status !== "rejected" || !isSessionErrorFor(sid, r.reason)) continue;
      // R19 27.1 / R21-A：同源已有 in-flight 重登 → 直接共享其结果（不再计数、不受频控拦截）
      let inflight = sessionInflight[sid];
      if (!inflight) {
        // 新发起一次重登前先过进程级频控（间隔 / 次数；TUOJ 两源与 tyche 各自独立）
        if (!sessionRetryAllowed(sid)) continue;
        const st = sessionRetryState[sid];
        st.count += 1;
        st.lastAt = Date.now();
        inflight = (async (): Promise<boolean> => {
          try {
            return await hook();
          } finally {
            delete sessionInflight[sid];
          }
        })();
        sessionInflight[sid] = inflight;
      }
      rerouteAttempted.add(sid);
      let ok = false;
      try {
        ok = await inflight;
      } catch {
        ok = false; // 重登失败分支绝不抛出：保留原会话错误与设置页引导
      }
      if (!ok) continue;
      if (sid === "tyche") reloginTycheOk = true;
      else reroutedSources.push(sid);
      const retry = createExternalSources({
        creds: deps.getCreds(),
        fetchLike: deps.fetchLike,
        http: deps.http,
      }).find((s) => s.id === sid);
      if (retry) {
        // 重登后该源换了凭据/会话：把 sources[i] 一并换成本次重试的实例
        // （后续课程列表取数也走新会话，而不是旧实例里已过期的 Cookie）
        sources[i] = retry;
        try {
          results[i] = { status: "fulfilled", value: await retry.fetch() };
        } catch (e) {
          results[i] = { status: "rejected", reason: e };
        }
      }
    }
  }

  const items: ExternalHomework[] = [];
  const errors: Partial<Record<ExtHwSourceId, string>> = {};
  results.forEach((r, i) => {
    const src = sources[i];
    if (!src) return;
    if (r.status === "fulfilled") items.push(...r.value);
    else {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      errors[src.id] = rerouteAttempted.has(src.id) ? `${SESSION_RELOGIN_FAILED_PREFIX}${reason}` : reason;
    }
  });
  items.sort((a, b) => a.deadline.localeCompare(b.deadline));

  // 课程列表：源实现可选（目前只有雨课堂）——与 jobs 并行取，失败静默隔离
  const courses: ExternalCourse[] = [];
  if (sources.some((s) => s.fetchCourses)) {
    const courseResults = await Promise.allSettled(
      sources.map((s) => (s.fetchCourses ? s.fetchCourses() : Promise.resolve<ExternalCourse[]>([]))),
    );
    // 课程列表失败不打扰用户：作业与 errors 提示照旧，仅该源没有课程卡片
    for (const r of courseResults) if (r.status === "fulfilled") courses.push(...r.value);
  }
  // 全部课程内容目录：同上（源侧与作业共用学习日志请求，因此不额外打接口）
  const contents: ExternalContent[] = [];
  if (sources.some((s) => s.fetchContents)) {
    const contentResults = await Promise.allSettled(
      sources.map((s) => (s.fetchContents ? s.fetchContents() : Promise.resolve<ExternalContent[]>([]))),
    );
    for (const r of contentResults) if (r.status === "fulfilled") contents.push(...r.value);
  }
  return {
    items,
    courses,
    contents,
    errors,
    reroutedTuoj: reroutedSources.length > 0,
    reroutedSources,
    reloginTyche: reloginTycheOk,
  };
}

export { SOURCE_NAMES, SOURCE_CATEGORIES, SOURCE_CATEGORY_NAMES } from "./types.js";
export type { ExtContentKind, ExtHwCategory, ExtHwCreds, ExtHwSourceId, TuojSourceId, TuojCreds, ExternalContent, ExternalCourse, ExternalHomework, HomeworkSource, RegisteredHomeworkSource } from "./types.js";
export {
  yuketangSendSmsCode,
  yuketangVerifyLogin,
  tuojLogin,
  dsaLogin,
  tycheLogin,
  captureCookies,
  yuketangBuildCookie,
} from "./login.js";
export type { ExtHwLoginResult } from "./login.js";
export { yuketangQrStart, yuketangQrPoll, runYuketangQrLogin, yuketangCookieFromHeader } from "./yuketangQr.js";
export type { YktQrStart, YktQrPollResult, YktQrPhase, RunYuketangQrLoginDeps } from "./yuketangQr.js";
/* R20-B1：雨课堂作业详情（归一化类型；实例经 createYuketangSource(...).getExerciseDetail 取）。
 * R20-B2 增补 YkAttachment（我的作答附件，只读展示）；createYuketangSource 透出到包入口
 * （desktop state 层 fetchYktExerciseDetail 需要自行注入凭据 / universalFetch）。 */
export type { YkExerciseDetail, YkProblem, YkComment, YkAttachment, YkMyStatus, YuketangSource } from "./yuketang.js";
export type { YkLeafDetail, YkNoticeDetail } from "./yuketang.js";
/* R20-C2 P2：主观题提交 + 正文插图上传类型（submitYktProblemSubjective / uploadExerciseInlineImage）。
 * ⛔ 学术红线（docs §32）：提交 API 仅限作答编辑器在用户显式确认后调用，禁止进插件工具清单。 */
export type {
  YktSubmitResult,
  YktSubmitAttachment,
  YktSubmitSubjectiveOptions,
  YktInlineImageUploadOptions,
} from "./yuketang.js";
/* R21-B：雨课堂会话失效归一 / 健康检查结果 / Cookie 轮换与导出导入（多设备迁移缓解） */
export { createYuketangSource, yktStudentLeafUrl, YktSessionError, isYktSessionError, mergeYktCookiePairs, buildYktCookieExportJson, parseYktCookieExportJson, YKT_COOKIE_EXPORT_KIND } from "./yuketang.js";
export type { YktSessionHealth, YuketangSourceHooks, YktCookieExport } from "./yuketang.js";
export { tuojRoam, TuojCasError, extractTicketAnchor, isCasLoginPage, isTuojNoCoursesError } from "./tuojCas.js";
export type { TuojRoamResult, TuojRoamDeps } from "./tuojCas.js";
export { TuojSessionError, isTuojSessionError, CLASSIC_BASE as TUOJ_CLASSIC_BASE } from "./tuoj.js";
export type { TuojSourceConfig } from "./tuoj.js";
/* R21-A：Tyche 会话失效错误（status=login / 401 / 跳登录页），供编排层与离线测试判定 */
export { TycheSessionError, isTycheSessionError } from "./tyche.js";
export { DsaSessionError, isDsaSessionError, dsaCheckLogin, parseDsaDate, BASE as DSA_BASE } from "./dsa.js";
