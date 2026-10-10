/**
 * 荷塘雨课堂（pro.yuketang.cn）只读客户端。
 *
 * 实测（2026-09-18）：
 * - 课程列表 GET /v2/api/web/courses/list?identity=2 → data.list[].classroom_id / name
 * - 学习日志 GET /v2/api/web/logs/learn/{classroom_id}?page=0&offset=200&sort=0&actype=-1
 *   → data.activities[]，type 19=作业 20=试卷（14=课件 5=投票，忽略）
 * - DDL = activity.content.score_d（**毫秒时间戳**）
 * - 提交状态：作业（type 19）走 get_exercise_list；试卷（type 20）走 GET /v/exam/cover
 *   （2026-09-19 实测攻克，判定见 docs 十三节）
 * - 已批改（R16 21.1，2026-09-19 实测判别器）：作业 `problems[].user.status` 4=已批改 /
 *   3=已交未批，`user.my_score` -1 为未批占位；试卷复用 /v/exam/cover 的已出分条件。
 *   已批改作业分数（R20-B3）：同响应已含全部数据，status 4 题的 my_score 合计 +
 *   content.score 合计（卷面满分），仅整卷已批改时透出（入口显示「已批改 · 30/40」）。
 * - 详情链接（R16b，学生端深链，无头浏览器实测 2026-09-19）：作业
 *   `…/ai-workspace/lms-graph/{classroom_id}/exercise/{leaf_id}?is_chapter=1`，
 *   试卷 `…/ai-workspace/lms-graph/{classroom_id}/quiz/{leaf_id}?is_chapter=1`；
 *   仅需 leaf_id，sku_id/node_id/exercise_id 不需要；缺 leaf_id 时回退
 *   `…/v2/web/studentLog/{classroom_id}`（旧链，2026-09-18 带 cookie 实测 200）。
 *   ⚠️ R16 21.2 的 `/subject?type=5|6&…` 是教师批改入口（学生打开 302 /forbidden），已弃用。
 * - 作业详情（R20-B1，docs 28.4 实测）：get_exercise_detail 复用 get_exercise_list 端点取整卷明细，
 *   data.font 即该次作业的加密字体文件（题干 <span class="xuetangx-com-encrypted-font"> 靠它渲染）；
 *   归一化 YkExerciseDetail / YkProblem，判定口径见 getExerciseDetail。
 * - 会话失效 → errcode=401000
 * ⚠️ host 必须是 pro.yuketang.cn（www. / changjiang. 会 401）
 * ⚠️ 服务端地址硬编码，凭据不再携带 base
 *
 * R21-B（会话失效保活/续期，2026-09-20）：
 * - 侦查结论（真连 + 三份前端 bundle 全量端点挖掘，docs 三十节）：pro.yuketang.cn
 *   **没有**会话续期/刷新端点（/pc/login/* 与 /api/v3/user/login/* 全家族仅
 *   web_login / web_logout / app-web-pre-info / app-web-login / send_sms_login_code /
 *   verify_pwd_login 六个；bundle 里的 heartbeat 是课堂视频心跳，与会话无关）。
 *   sessionid 由 Django 服务端管理，客户端无从「续命」→ 保活=周期性轻量已授权请求。
 * - 失效特征归一 `YktSessionError`（isYktSessionError 判定）：HTTP 401/403、
 *   errcode=401000、v3 系 code=50000 UNAUTHENTICATED、非 JSON（跳登录壳）四种；
 *   其余错误（网络断 / 5xx / 字段异常）不误判为会话失效。
 * - `checkSession()`：会话健康检查（GET /api/v3/user/basic-info，最轻的已授权请求），
 *   网络错误返回 alive=null（未知，不谎报「已失效」）。
 * - Cookie 轮换回写：传输层若透传 Set-Cookie（x-onethu-set-cookie 通道），按白名单
 *   （sessionid/csrftoken/uv_id 等）合并进会话串并经 onCookieRefresh 钩子交 desktop
 *   持久化（AES-GCM 信封）。侦查未见 GET 轮换证据，属「服务端若轮换则不丢」的兜底。
 * - Cookie 导出/导入：`buildYktCookieExportJson` / `parseYktCookieExportJson`
 *   （多设备迁移缓解；导出文件自带敏感标注）。
 *
 * R20-C2 P2（主观题提交 + 正文插图 core 能力，2026-09-21）：
 * - `submitYktProblemSubjective()`：POST /mooc-api/v1/lms/exercise/problem_apply/
 *   （docs §28.11 表 A 主观行 + §31.6 P1b 实发成功），answer =
 *   {content, time:"0", oSubject:{attachments:{filelist}}}；成功响应**无 errcode 包裹**
 *   （直接是 data 层字段 count/my_count/my_score/submit_time/…），my_score -1 占位不透出。
 * - `uploadExerciseInlineImage()`：正文内联插图（AI 判卷可读的主通道）= OSS 表单直传 +
 *   callback（§31.5-② 逆向 + P1b 实测修正：token 在 data.token，表单含
 *   success_action_status=200，file 字段最后，file_url 由 callback 下发）。
 *   与作业附件 STS（exercise_attachment）是两条通道，勿混；解题图片禁入附件（产品约束）。
 * - CSRF 双提交（§31.6 P1b 实测）：写端点必须带 X-CSRFToken 头且与 Cookie csrftoken
 *   **同值**即过（Django 只比对 header==cookie，不要求服务端签发）。ensureCsrf()：
 *   凭据已有 csrftoken → 原值取用；没有 → 逐请求自签 16 字节随机 hex（无状态、不持久化；
 *   P1b 纪要曾写「自签并持久化」，P2 定稿改为逐请求独立自签，效果等价）。
 */
import type { FetchLike } from "../http.js";
import type { ExtContentKind, ExternalContent, ExternalCourse, ExternalHomework, HomeworkSource } from "./types.js";

const BASE = "https://pro.yuketang.cn";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.88 Safari/537.36";

interface YktCred {
  cookie: string;
  uvId?: string;
}

/* ── R21-B：会话失效归一 + 健康检查 + Cookie 轮换回写 / 导出导入 ── */

/**
 * 雨课堂会话失效（R21-B）。四种实测/约定特征统一归一：
 * ① HTTP 401/403（网关拒绝）；② errcode=401000「Session not exists」（2026-09-20 死会话实测）；
 * ③ v3 系 code=50000「UNAUTHENTICATED」（basic-info 死会话实测）；④ 非 JSON（跳登录壳 HTML）。
 * 其余错误（网络断 / 5xx / 字段异常）**不**归入——避免误导用户重登。
 */
export class YktSessionError extends Error {
  constructor(message = "雨课堂会话已失效，请重新登录（扫码 / 官方网页 / 导入 Cookie）") {
    super(message);
    this.name = "YktSessionError";
  }
}

/** 是否雨课堂会话失效错误（设置页 / 心跳 / 条幅据此提示重登） */
export function isYktSessionError(e: unknown): e is YktSessionError {
  return e instanceof YktSessionError;
}

/** 毫秒时间戳 → "YYYY-MM-DD HH:MM"（本地时区） */
function fmtLocal(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Cookie 补齐：uv_id/university_id/platform_id/xtbz/django_language 缺失时按清华默认补 */
function authCookie(c: YktCred): string {
  const cookie = (c.cookie ?? "").trim();
  const has = (name: string) => new RegExp(`(?:^|;\\s*)${name}=`).test(cookie);
  const uv = (c.uvId ?? "").trim() || "2598";
  const extras: string[] = [];
  if (!has("uv_id")) extras.push(`uv_id=${uv}`);
  if (!has("university_id")) extras.push(`university_id=${uv}`);
  if (!has("platform_id")) extras.push("platform_id=3");
  if (!has("xtbz")) extras.push("xtbz=ykt");
  if (!has("django_language")) extras.push("django_language=zh-cn");
  return extras.length ? `${cookie}; ${extras.join("; ")}` : cookie;
}

/** 16 字节 CSPRNG → 32 位 hex（R20-C2 P2 CSRF 自签用；极老运行时无 webcrypto 时回退
 *  Math.random，仅为不崩——Django 只做同值比对，对熵源无要求）。 */
function randomHexToken(): string {
  const bytes = new Uint8Array(16);
  const g = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (g && typeof g.getRandomValues === "function") {
    g.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/**
 * R20-C2 P2：CSRF 双提交（docs §31.6 P1b 实测）。Django DRF 只校验
 * 「X-CSRFToken 头 == Cookie csrftoken 同值」，不要求服务端签发（自签随机 token
 * 实测直接通过）。凭据 Cookie 已带 csrftoken → 原样取值；没有 → 生成随机 hex 追加进
 * **本次请求**的 Cookie 头。两种情况都返回 token 供 X-CSRFToken 头使用。
 * ⚠️ 无状态、不持久化：每次写请求独立自签（Django 逐请求比对 header==cookie），
 * 不污染凭据、不写回 cred。
 */
function ensureCsrf(cookie: string): { cookie: string; token: string } {
  const c = (cookie ?? "").trim();
  const m = /(?:^|;\s*)csrftoken=([^;]*)/.exec(c);
  const existing = m?.[1]?.trim();
  if (existing) return { cookie: c, token: existing };
  const token = randomHexToken();
  return { cookie: c ? `${c}; csrftoken=${token}` : `csrftoken=${token}`, token };
}

async function getJson(
  fetchLike: FetchLike,
  url: string,
  cookie: string,
  extraHeaders: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const res = await fetchLike(url, {
    method: "GET",
    headers: { Cookie: cookie, "User-Agent": UA, Accept: "application/json, text/plain, */*", ...extraHeaders },
  });
  if (res.status === 401 || res.status === 403) {
    // R21-B：401/403 = 网关拒绝 → 会话失效（原样文案，改归一类型）
    throw new YktSessionError(`雨课堂会话已失效（HTTP ${res.status}），请在设置页重新登录`);
  }
  const body = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    // R21-B：非 JSON = 登录壳 HTML（v2 接口死会话的另一表现）→ 会话失效
    throw new YktSessionError("雨课堂返回非 JSON（会话可能已失效被跳到登录页），请重新登录");
  }
  const obj = (json ?? {}) as Record<string, unknown>;
  // R21-B：v3 系（如 /api/v3/user/basic-info）死会话实测返回 200 + code=50000 UNAUTHENTICATED
  if (obj["code"] === 50000) {
    throw new YktSessionError("雨课堂会话已失效（UNAUTHENTICATED），请在设置页重新登录");
  }
  return obj;
}

/** Cookie 轮换回写白名单：只合并会话相关字段，杜绝把服务端下的杂项（统计/广告位）带进凭据 */
const COOKIE_MERGE_ALLOW = new Set([
  "sessionid",
  "csrftoken",
  "uv_id",
  "university_id",
  "platform_id",
  "platform_type",
  "xtbz",
  "django_language",
]);

/**
 * 读取传输层透传的 Set-Cookie 通道（与 login.captureCookies 同口径：数组头 + 逐跳头）。
 * ⚠️ 故意不复用 login.captureCookies：yuketang.ts 必须保持「零相对导入」——离线 Node
 * 单测（tools/exthw-status-test.mjs）靠原生 type-stripping 静态导入本模块，`.js`→`.ts`
 * 重写钩子注册在静态图解析之后。两处实现需同步维护。
 */
function yktCaptureSetCookies(res: Response): Map<string, string> {
  const raws: string[] = [];
  for (const key of ["x-onethu-set-cookie", "x-onethu-set-cookie-hops"]) {
    const raw = res.headers.get(key);
    if (!raw) continue;
    try {
      const arr = JSON.parse(raw) as unknown;
      if (!Array.isArray(arr)) continue;
      for (const x of arr) {
        if (typeof x === "string") raws.push(x);
        else if (x !== null && typeof x === "object" && typeof (x as { l?: unknown }).l === "string") {
          raws.push((x as { l: string }).l);
        }
      }
    } catch {
      /* 容忍非法 JSON */
    }
  }
  const pairs = new Map<string, string>();
  for (const line of raws) {
    const first = line.split(";")[0] ?? "";
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const k = first.slice(0, eq).trim();
    const v = first.slice(eq + 1).trim();
    if (k) pairs.set(k, v);
  }
  return pairs;
}

/**
 * 把传输层捕获到的 Set-Cookie 键值对合并进现有 Cookie 串（R21-B，纯函数）。
 * 只认白名单字段；同名后者覆盖；原有顺序保持，新字段追加在尾部。
 */
export function mergeYktCookiePairs(cookie: string, pairs: Map<string, string>): string {
  const order: string[] = [];
  const vals = new Map<string, string>();
  for (const part of (cookie ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (!k) continue;
    if (!vals.has(k)) order.push(k);
    vals.set(k, v);
  }
  let changed = false;
  for (const [k, v] of pairs) {
    if (!COOKIE_MERGE_ALLOW.has(k) || !v) continue;
    if (vals.get(k) !== v) {
      if (!vals.has(k)) order.push(k);
      vals.set(k, v);
      changed = true;
    }
  }
  if (!changed) return cookie;
  return order.map((k) => `${k}=${vals.get(k)}`).join("; ");
}

/** R21-B：会话健康检查结果。alive=null 表示「未知」（网络断等，不谎报失效） */
export interface YktSessionHealth {
  alive: boolean | null;
  /** alive=false 时的判定依据（http401 / http403 / errcode=401000 / unauthenticated / non-json）；
   *  alive=null 时为 "network" */
  reason?: string;
  /** 会话归属人姓名（basic-info 的宽松字段探测；取不到不设，仅展示用） */
  userName?: string;
  /** 检查完成时间（ms） */
  checkedAt: number;
}

/** 提交状态查询的并发上限（11 门课 × 若干作业；避免打爆服务端） */
const STATUS_CONCURRENCY = 4;

/** 待查提交状态的作业条目（已通过时间窗过滤） */
interface YktItem {
  hw: ExternalHomework;
  classroomId: string;
  leafTypeId: string;
  /** type 20（试卷）标记：走 /v/exam/cover 而非 get_exercise_list */
  isExam: boolean;
  /** type 20 试卷封面接口所需的 sku_id（activity.content.sku_id，可能缺失） */
  skuId?: string;
}

/** 单条提交状态查询结果（作业与试卷共用）。
 *  score/totalScore：试卷已出分时给（R9）；作业仅整卷已批改时给（R20-B3，已批题有效分合计）。
 *  未出分 / 未批改一律不设（避免 0 分误导）。 */
interface YktStatusResult {
  submitted: boolean;
  submittedCount?: number;
  totalCount?: number;
  score?: number;
  totalScore?: number;
  /** 是否已批改（R16 21.1）；无法判定时不设（调用方按 false 处理） */
  graded?: boolean;
}

/** 分数求和去浮点尾差（0.1+0.2 型；分数量级实测最多两位小数，round 到百分位安全） */
function roundScore(n: number): number {
  return Math.round(n * 100) / 100;
}

/** `user.my_score` 是否为「未批改」占位（-1 / -1.00 / "-1.00" 等，R16 21.1 实测） */
function isUnscoredPlaceholder(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v) && v === -1;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return false;
    const n = Number(t);
    return Number.isFinite(n) && n === -1;
  }
  return false;
}

/* ───────────────── R20-B1：作业详情归一化的宽松取值（缺字段不崩） ───────────────── */

/** 字符串字段：非字符串（含缺失）一律 "" */
function toStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** 数字字段：数字 / 数字串（如 "30.00"）→ number；其余（含空串 / NaN / null）→ undefined */
function toNum(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** 数字字段带默认值（缺失 → dft，保守口径由调用方定） */
function toNumOr(v: unknown, dft: number): number {
  return toNum(v) ?? dft;
}

/** 并发映射（有界并发，失败在回调内自行捕获） */
async function mapLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: n }, async () => {
    while (i < items.length) {
      const idx = i++;
      const item = items[idx];
      if (item === undefined) continue;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * 查单个作业的提交状态：
 * GET /mooc-api/v1/lms/exercise/get_exercise_list/{leaf_type_id}/?classroom_id=…&term=latest&uv_id=…
 * ⚠️ 必须带请求头 `XTBZ: ykt`，否则报「XTBZ IS REQUIRED」。
 * 判定（R23 起）：有题目明细时全部题都有作答 → 已提交（部分作答 = 进行中，报
 * submittedCount/totalCount 供「已完成 x/y」）；缺明细时 `answer_count > 0` 保守算已提交。
 * 已批改（R16 21.1，保守）：已提交且不存在「已作答但未批改」的题；
 * 「已作答」（R24 多信号）= 逐题 status 3/4 / submit_time 非空 / my_count>0 /
 * `my_answer.content` 非空 / 附件非空 / 拍图作答有直链（见 hasSubmissionEvidence），
 * 整卷 `answer_count>0` 仅作批改态兜底；
 * 「未批改」= `user.status === 3` 或 `user.my_score` 为 -1 占位（含 "-1.00"）。
 * 分数（R20-B3，霖需求：已批改作业像考试一样在入口显示分数）：与详情同一响应里就有
 * 全部数据，零额外请求 —— score = 已批改题（status 4 且非 -1 占位，真实 0 分照算）的
 * my_score 合计，totalScore = 题面 content.score 合计；**仅整卷已批改（graded）时透出**
 * （对齐试卷「已出分才给分」口径，未批改不显示）；无一题有有效分 → 不设 score（缺数据
 * 不谎报 0）；卷面满分合计为 0（content.score 全缺失）→ 只给 score 不给 totalScore。
 * 仅用于作业（type 19）；试卷（type 20）改用 fetchYktExamStatus。
 */
async function fetchYktStatus(
  fetchLike: FetchLike,
  base: string,
  cookie: string,
  uv: string,
  classroomId: string,
  leafTypeId: string,
): Promise<YktStatusResult> {
  const url =
    `${base}/mooc-api/v1/lms/exercise/get_exercise_list/${encodeURIComponent(leafTypeId)}/` +
    `?classroom_id=${encodeURIComponent(classroomId)}&term=latest&uv_id=${encodeURIComponent(uv)}`;
  const body = await getJson(fetchLike, url, cookie, { XTBZ: "ykt" });
  const data = (body["data"] ?? {}) as Record<string, unknown>;
  const problems = Array.isArray(data["problems"])
    ? (data["problems"] as Array<Record<string, unknown>>)
    : [];
  if (problems.length === 0 && !("answer_count" in data)) {
    // 空壳响应（如 No permissions 落到 data:{}）→ 视为不可判定
    throw new Error("雨课堂作业状态响应为空");
  }
  const ac = data["answer_count"];
  const answerCount = typeof ac === "number" && Number.isFinite(ac) ? ac : 0;
  let answered = 0;
  let answeredUngraded = false;
  // R20-B3：分数合计 —— score = 已批改题有效分求和；totalScore = 题面分值求和
  let scoreSum = 0;
  let scoreSeen = false;
  let totalScoreSum = 0;
  for (const p of problems) {
    const user = (p["user"] ?? {}) as Record<string, unknown>;
    const my = (user["my_answer"] ?? {}) as Record<string, unknown>;
    const content = my["content"];
    const hasContent = typeof content === "string" && content.trim().length > 0;
    // R24 fix：已作答按多信号判（无正文但有批改态 / 提交时间 / 拍图作答的题也要算作答，
    // 否则「5/5 已批改但服务端不回传正文」会被整卷误判成未提交）
    // ⚠️ 计数只能用**逐题**信号：整卷 answer_count>0 只作批改态兜底（见 answeredThis），
    // 拿它计数会把「部分作答」也算成全答（R23 口径回归）。
    const hasEvidence = hasSubmissionEvidence(user);
    if (hasEvidence) answered++;
    const answeredThis = hasEvidence || answerCount > 0;
    if (answeredThis && (user["status"] === 3 || isUnscoredPlaceholder(user["my_score"]))) {
      answeredUngraded = true;
    }
    // 题面分值（content.score；缺失/非数字不计入卷面满分）
    const pcScore = toNum((p["content"] as Record<string, unknown> | undefined)?.["score"]);
    if (pcScore !== undefined) totalScoreSum += pcScore;
    // 已批改题的有效分：status 4 且非 -1 占位（真实 0 分照算）
    if (user["status"] === 4) {
      const ms = toNum(user["my_score"]);
      if (ms !== undefined && !isUnscoredPlaceholder(user["my_score"])) {
        scoreSum += ms;
        scoreSeen = true;
      }
    }
  }
  // R23（霖需求 2026-09-21）：部分作答 ≠ 已提交——作业只交了一道题仍属「进行中」，
  // 入口按 未交 分组并显示「已完成 x/y」。判定：有题目明细时按「有内容题数 ≥ 题目数」；
  // 缺明细（problems 为空）无法逐题核对 → 退回旧行为（answer_count>0 保守算已提交）。
  // ⚠️ 口径依赖 my_answer.content（与 R20-C2 详情页逐题作答同源；霖实测几乎全是主观题）。
  const submitted = problems.length > 0 ? answered >= problems.length : answerCount > 0;
  const submittedCount = answered > 0 ? answered : answerCount;
  // 无题目明细（problems 为空）时无法判定批改状态 → 保守 false
  const graded = submitted && problems.length > 0 && !answeredUngraded;
  return {
    submitted,
    submittedCount: submittedCount > 0 ? submittedCount : undefined,
    totalCount: problems.length > 0 ? problems.length : undefined,
    graded,
    // R20-B3：仅整卷已批改透分（未批改不显示，入口 UI 口径与考试一致）
    ...(graded && scoreSeen ? { score: roundScore(scoreSum) } : {}),
    ...(graded && scoreSeen && totalScoreSum > 0 ? { totalScore: roundScore(totalScoreSum) } : {}),
  };
}

/**
 * 查单个「试卷」（type 20）的提交状态：
 * GET /v/exam/cover?exam_id={leaf_type_id}&classroom_id=…&sku_id=…
 * ⚠️ 必须带请求头 `XTBZ: ykt`（与习题路径一致）。
 * 判定（docs 13.2）：`result` 非空且 `result.unfinished_count < problem_count` → 已提交；
 * `result` 缺失/null 或字段不可解析 → 保守未提交。
 * 进度：submittedCount = problem_count - unfinished_count，totalCount = problem_count。
 * 请求失败（HTTP 非 2xx / 非 JSON）会 throw，由调用方跳过并保持未提交。
 */
async function fetchYktExamStatus(
  fetchLike: FetchLike,
  base: string,
  cookie: string,
  classroomId: string,
  leafTypeId: string,
  skuId: string,
): Promise<YktStatusResult> {
  const skuQs = skuId ? `&sku_id=${encodeURIComponent(skuId)}` : "";
  const url =
    `${base}/v/exam/cover?exam_id=${encodeURIComponent(leafTypeId)}` +
    `&classroom_id=${encodeURIComponent(classroomId)}${skuQs}`;
  const body = await getJson(fetchLike, url, cookie, { XTBZ: "ykt" });
  const data = (body["data"] ?? {}) as Record<string, unknown>;
  const pcRaw = data["problem_count"];
  const problemCount = typeof pcRaw === "number" && Number.isFinite(pcRaw) ? pcRaw : undefined;
  const totalCount = problemCount !== undefined && problemCount > 0 ? problemCount : undefined;
  const tsRaw = data["total_score"];
  const totalScore = typeof tsRaw === "number" && Number.isFinite(tsRaw) ? tsRaw : undefined;
  const result = data["result"];
  if (result === null || result === undefined || typeof result !== "object") {
    // result 缺失/null（未作答或未出分）→ 保守未提交
    return { submitted: false, totalCount, graded: false };
  }
  const r = result as Record<string, unknown>;
  const unfinishedRaw = r["unfinished_count"];
  const unfinished = typeof unfinishedRaw === "number" && Number.isFinite(unfinishedRaw) ? unfinishedRaw : undefined;
  if (problemCount === undefined || unfinished === undefined) {
    return { submitted: false, totalCount, graded: false };
  }
  const done = Math.max(0, problemCount - unfinished);
  // R24 fix（bug2）：试卷必须**全部**题目完成才算已交——旧口径 `unfinished < problem_count`
  // 只要动过一题就报「已交」（霖实测：11 题做了 10 题被显示成已提交）。
  const submitted = unfinished === 0;
  const out: YktStatusResult = {
    submitted,
    submittedCount: done > 0 ? done : undefined,
    totalCount,
    // R16 21.1：试卷「已批改」= 已提交且已出分（下方复用 R9 score 条件置 true）
    graded: false,
  };
  // 分数仅「已提交 且 已出分 且 score/total_score 均为数字」时给（避免 0 分误导）
  const scoreRaw = r["score"];
  const scoreFinish = r["score_finish"];
  if (
    submitted &&
    scoreFinish !== false &&
    typeof scoreRaw === "number" &&
    Number.isFinite(scoreRaw) &&
    totalScore !== undefined
  ) {
    out.score = scoreRaw;
    out.totalScore = totalScore;
    // R16 21.1：试卷「已批改」复用 R9 已出分条件（有分数即已出分）
    out.graded = true;
  }
  return out;
}

/* ───────────────── R20-B1：作业详情（get_exercise_list 整卷明细，只读） ───────────────── */

/** 单题「我的作答」三态：docs 28.4 实测 user.status 4=已批改 / 3=已交未批；
 *  无 user、或无显式 status 且无作答痕迹（R24 多信号：status / submit_time / my_count /
 *  正文 / 附件 / 拍图作答，见 hasSubmissionEvidence）→ 未答（保守） */
export type YkMyStatus = "unanswered" | "submitted" | "graded";

/** 老师批注（源字段名是单数 comment[]） */
export interface YkComment {
  content: string;
  /** 批注人姓名 */
  name?: string;
  /** 子批注序号 */
  index?: number;
}

/** 我的作答附件（R20-B2）：user.my_answer.attachment[] 里能确认的字段只有
 *  name / url（实测快照形如 {id:7, name:"fig.png"}；id 等其余字段 B2 不透出）。
 *  B2 只读展示文件名；下载 / 上传属 R20-C。 */
export interface YkAttachment {
  name?: string;
  url?: string;
}

/** 归一化后的单题。题面缺字段不崩（0 / "" / [] 兜底）；「我的作答」仅在有值时设 */
export interface YkProblem {
  /** problems[].problem_id（String 化，供 React key / 逐题提交） */
  problemId: string;
  /** 题号（原样透传；缺失按数组序 1 起） */
  index: number;
  /** content.ProblemType（1 单选 2 多选 3 判断 4 填空 5 主观 6 试卷 9 外链 OJ；缺失 0） */
  type: number;
  typeText: string;
  /** 题面分值（content.score；缺失 0） */
  score: number;
  /** 题干 HTML（含 xuetangx-com-encrypted-font 加密 span，需配 fontUrl 渲染） */
  bodyHtml: string;
  /** content.Options（形状随题型各异，B2/C1 再定） */
  options?: unknown[];
  /** content.AllowResults（["text","pic","file"]，主观题可提交形式；缺失 []） */
  allowResults: string[];
  /** 本题重交上限（content.max_retry / problems[].max_retry；缺失 0=不可重交，保守） */
  maxRetry: number;
  /** R20-C1：本题剩余可提交次数（web 端 `left_times` 同口径，R20-C1 侦查）——
   *  `user.count - user.my_count`，仅 `count>0`（有明确次数上限）时给；`count<=0`/缺失
   *  = 不限次（web 端置 999），此时**不设**（undefined = 不限/未知，调用方不得当作 0）。
   *  仅用于「未超 max_retry」资格判定；真实拦截仍以官方作答页为准。 */
  remainingRetries?: number;
  /** R20-C2：user.count 原值（官方 `left_times = count − my_count` 的被减数；缺失不设，
   *  0 / 负值也原样透出——「不限次」判定口径见 remainingRetries） */
  totalCount?: number;
  /** R20-C2：user.my_count 原值（已用重交次数；缺失按 0 参与计算但**字段仅在存在时设置**，
   *  与 remainingRetries 同款写法） */
  usedCount?: number;
  /** R20-C2 / R24：user.submit_time → "YYYY-MM-DD HH:MM"（数字毫秒与
   *  "YYYY-MM-DD HH:MM" 字符串双形态；见 toSubmitTimeText）。官方提交器（docs §28.11）
   *  单题「已提交」判定 = `!!user.submit_time`，不看 submission_status；缺失 / 0 不设 */
  submitTime?: string;
  /** R20-C2：user.submission_status 原样透传（存在且可解析为数字才设；官方提交器**不**用它
   *  判定已提交，仅透出供 UI 参考） */
  submissionStatus?: number;
  myStatus: YkMyStatus;
  /** 仅「已批改」且为有效数字（非 -1 占位）时给——避免未出分显示 0 */
  myScore?: number;
  /** 我的作答正文（R24）：`user.my_answer.content` 文字正文 + `user.my_answer.pics[]`
   *  拍图作答图片（内联 <img>，不带 Referer）拼接；两者都空 → 不设（UI 展示
   *  「已提交（服务端未返回作答正文）」占位）。拍图作答此前整块无正文，是本次修复点。 */
  myAnswerHtml?: string;
  /** user.my_answer.attachment 归一化（非空数组时才设；B2 只读展示，下载属 R20-C） */
  myAnswerAttachments?: YkAttachment[];
  /** 题型 9（外链 OJ）的作答外链（content.data.answer_problem_url，docs 28.4；
   *  仅 type 9 且取到 http(s) 串时设。红线：此类题不在雨课堂站内提交） */
  externalUrl?: string;
  /** 老师总评（user.remark，非空时才设） */
  remark?: string;
  /** 老师批注（user.comment[]，滤掉空 content；全空不设） */
  comments?: YkComment[];
}

/** 归一化后的作业详情 */
export interface YkExerciseDetail {
  name: string;
  description: string;
  /** 整卷重交上限（data.max_retry；缺失 0） */
  maxRetry: number;
  /** 是否允许补交（data.is_allowed_late_submission，仅显式 true；红线：仅允许时开放提交） */
  lateAllowed: boolean;
  /** 补交口径（⚠️ 双口径容错，不下结论）：`data.late_submission` 逆向发现是**对象**
   *  （含 `deduct_score` 补交扣分，docs §28.11），而 §28.1/28.4 曾记录它是毫秒时间戳——
   *  两种口径冲突，待 P1b 真机复核定稿。当前实现：数字（>0）→ `lateDeadline`（毫秒 →
   *  "YYYY-MM-DD HH:MM" 本地时区）；对象且含可解析 `deduct_score` → `lateDeductScore`，
   *  此时 lateDeadline 不设；两者都不是 → 都不设。 */
  lateDeadline?: string;
  /** R20-C2：补交扣分（late_submission 为对象形态且 deduct_score 可解析时给；数字形态
   *  或缺失不设。单位待 P1b 真机复核：官方文案「补交扣分：{deduct_score}」） */
  lateDeductScore?: number;
  /** 已作答题数（data.answer_count；缺失 0） */
  answerCount: number;
  /** data.font：该次作业的加密字体文件 URL（docs 28.4 实测，下载后 @font-face 应用） */
  fontUrl?: string;
  problems: YkProblem[];
}

/** 雨课堂源：在 HomeworkSource 之上附作业详情拉取（R20-B1；B2 详情页用） */
export interface YuketangSource extends HomeworkSource {
  /** 拉单份作业详情（只读）。uvId 缺省回落凭据里的 uvId，再回落清华默认 "2598"。
   *  响应结构异常（errcode≠0 / 缺 data）抛带上下文的错误；单字段缺失不崩。 */
  getExerciseDetail(leafTypeId: string, classroomId: string, uvId?: string): Promise<YkExerciseDetail>;
  /** 拉单条**叶子内容**详情（课件 / 视频 / 图文 / 讨论…，只读）。
   *  用途：站内预览前先确认 leaf_type（决定站内路由段）与是否已有可直渲的直链。 */
  getLeafDetail(classroomId: string, leafId: string): Promise<YkLeafDetail>;
  /** 拉**公告**详情（只读）：站内内嵌渲染公告正文用。
   *  `ids` 支持候选列表（源侧 id 字段名不固定）——按序逐个试端点，命中即止。 */
  getNoticeDetail(classroomId: string, ids: string | string[]): Promise<YkNoticeDetail>;
  /** R21-B：会话健康检查（GET /api/v3/user/basic-info，最轻的已授权请求）。
   *  保活心跳与设置页「检查会话」都走它；网络错误返回 alive=null（不谎报失效）。 */
  checkSession(): Promise<YktSessionHealth>;
  /** R20-C2 P2：主观题逐题提交（POST problem_apply，§28.11 表 A + §31.6 P1b 实测）。
   *  CSRF 双提交自动处理（凭据无 csrftoken 时逐请求自签，见 ensureCsrf）。
   *  错误归一：CSRF 拦截 403 → Error（非会话错误）；401/403 / errcode=401000 / 非 JSON
   *  → YktSessionError；其余 errcode≠0 → Error。非空校验由 UI 层负责。 */
  submitYktProblemSubjective(opts: YktSubmitSubjectiveOptions): Promise<YktSubmitResult>;
  /** R20-C2 P2：正文内联插图上传（AI 判卷可读的主通道；附件通道仅兜底）。
   *  OSS 表单直传 + callback（§31.5-② 逆向 + P1b 实测修正），返回 callback 的
   *  data.file_url。classroomId 当前预留不发送（端点不带，见 YktInlineImageUploadOptions）。 */
  uploadExerciseInlineImage(opts: YktInlineImageUploadOptions): Promise<{ fileUrl: string }>;
}

/** R21-B：createYuketangSource 可选钩子（既有调用方零改动） */
export interface YuketangSourceHooks {
  /** 会话 Cookie 因服务端轮换（Set-Cookie 白名单字段变化）而更新时回调（新 Cookie 串）。
   *  侦查未见 GET 轮换证据——此钩子是「服务端若轮换则凭据不丢」的兜底；desktop 把
   *  新 Cookie 用 AES-GCM 信封存回凭据。回调内不得打印 Cookie。 */
  onCookieRefresh?: (cookie: string) => void;
}

/**
 * 提交时间归一（R24）：官方实测 `user.submit_time` 有**两种形态** —— 数字毫秒时间戳，
 * 以及字符串 "YYYY-MM-DD HH:MM"（旧文档只记了前者，导致字符串形态恒解析失败、详情页
 * 从不显示提交时间）。这里统一成 "YYYY-MM-DD HH:MM"；空串 / 0 / 无法识别 → 不设。
 */
function toSubmitTimeText(raw: unknown): string | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? fmtLocal(raw) : undefined;
  if (typeof raw !== "string") return undefined;
  const s = raw.trim();
  if (!s || s === "0") return undefined;
  // 纯数字串：按毫秒时间戳处理（长度不足 10 位的一律视为脏数据）
  if (/^\d{10,}$/.test(s)) {
    const ms = Number(s);
    return Number.isFinite(ms) && ms > 0 ? fmtLocal(ms) : undefined;
  }
  // 日期串：取前 16 位（"2026-09-17 15:15" / "2026-09-17T15:15:00Z" 同口径）
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : undefined;
}

/**
 * 我的作答图片（R24 fix ②）：拍图作答时 `my_answer.content` 是空串，图片在
 * `my_answer.pics[]`——每项 `fileUrl` 是 CDN 直链（`url` 常为 `blob:` 临时引用，
 * 换了进程就失效，绝不入 HTML）。只取 http(s) 直链，供详情页把「我的作答正文」
 * 渲染出来（此前这类作答整题无正文，页面只能说「服务端未返回作答正文」）。
 */
function toMyAnswerImageUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const p of raw) {
    if (p === null || typeof p !== "object") continue;
    const m = p as Record<string, unknown>;
    const candidates = [m["fileUrl"], m["url"]];
    for (const c of candidates) {
      if (typeof c === "string" && /^https?:\/\//i.test(c.trim())) {
        out.push(c.trim());
        break;
      }
    }
  }
  return out;
}

/** 作答图片 → 内联 <img>（与题干图片同口径：不带 Referer，CDN 白名单要求） */
function ykAnswerImagesHtml(urls: string[]): string {
  return urls
    .map((u) => `<img src="${u.replace(/"/g, "%22")}" alt="我的作答图片" referrerpolicy="no-referrer">`)
    .join("");
}

/**
 * 「是否已作答」多信号判据（R24 fix ①，2026-09-23 霖收同学反馈）：
 * 旧口径只认 `my_answer.content` 非空，而服务端存在「已批改但不回传正文」的响应形态
 * （status=4 + 评语 + 有效分 + `my_answer` 空壳），于是整卷被误判成未提交、详情页也
 * 无作答可看。改为任一信号命中即算已作答：
 *   ① `status` 3（已交未批）/ 4（已批改）；
 *   ② `submit_time` 非空（数字毫秒 / 日期串双形态）；
 *   ③ `my_count > 0`（提交次数）；
 *   ④ `my_answer.content` 非空（文字正文）；
 *   ⑤ `my_answer.attachment[]` 非空（附件）；
 *   ⑥ `my_answer.pics[]` 有 http(s) 直链（拍图作答）。
 */
function hasSubmissionEvidence(user: Record<string, unknown> | undefined): boolean {
  if (!user) return false;
  const status = toNum(user["status"]);
  if (status === 3 || status === 4) return true;
  if (toSubmitTimeText(user["submit_time"]) !== undefined) return true;
  const used = toNum(user["my_count"]);
  if (used !== undefined && used > 0) return true;
  const myRaw = user["my_answer"];
  if (myRaw === null || typeof myRaw !== "object") return false;
  const my = myRaw as Record<string, unknown>;
  if (typeof my["content"] === "string" && my["content"].trim()) return true;
  if (Array.isArray(my["attachment"]) && my["attachment"].length > 0) return true;
  return toMyAnswerImageUrls(my["pics"]).length > 0;
}

/** 单题三态（保守）：显式 status 优先（4=已批 / 3=已交未批）；否则看作答痕迹，
 *  整卷 answer_count=0 且无作答痕迹（R24 多信号，见 hasSubmissionEvidence）→ 未答
 *  （与 fetchYktStatus 的「已提交」口径一致） */
function toMyStatus(user: Record<string, unknown> | undefined, answerCount: number): YkMyStatus {
  if (!user || Object.keys(user).length === 0) return "unanswered";
  const status = toNum(user["status"]);
  if (status === 4) return "graded";
  if (status === 3) return "submitted";
  return hasSubmissionEvidence(user) || answerCount > 0 ? "submitted" : "unanswered";
}

/** user.comment[] → YkComment[]（滤空 content / 非对象项；结果为空 → undefined） */
function toComments(raw: unknown): YkComment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: YkComment[] = [];
  for (const c of raw) {
    if (c === null || typeof c !== "object") continue;
    const m = c as Record<string, unknown>;
    const content = m["content"];
    if (typeof content !== "string" || !content.trim()) continue;
    out.push({
      content,
      ...(typeof m["name"] === "string" && m["name"] ? { name: m["name"] } : {}),
      ...(typeof m["index"] === "number" && Number.isFinite(m["index"]) ? { index: m["index"] } : {}),
    });
  }
  return out.length ? out : undefined;
}

/** user.my_answer.attachment[] → YkAttachment[]（R20-B2）。
 *  实测项形如 {id:7, name:"fig.png"}，也有 avatar/attachment 位给空串的脏数据；
 *  保守只取对象项里的 name / url 字符串字段，无 name 且无 url 的项丢弃；
 *  结果为空 → undefined（UI 按无附件渲染）。 */
function toMyAttachments(raw: unknown): YkAttachment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: YkAttachment[] = [];
  for (const a of raw) {
    if (a === null || typeof a !== "object") continue;
    const m = a as Record<string, unknown>;
    const name = typeof m["name"] === "string" && m["name"].trim() ? m["name"].trim() : undefined;
    const url = typeof m["url"] === "string" && m["url"].trim() ? m["url"].trim() : undefined;
    if (name || url) out.push({ ...(name ? { name } : {}), ...(url ? { url } : {}) });
  }
  return out.length ? out : undefined;
}

/** 题型 9（外链 OJ）→ 作答外链：content.data.answer_problem_url（docs 28.4 pc.js 逆向）。
 *  data 形状实测为对象（也可能缺省/非对象），保守取 answer_problem_url 字符串字段；
 *  仅接受 http(s)（与 R20-A isHttpUrl 同口径），其余一律不设。 */
function toProblemExternalUrl(content: Record<string, unknown>): string | undefined {
  const data = content["data"];
  if (data === null || typeof data !== "object") return undefined;
  const u = (data as Record<string, unknown>)["answer_problem_url"];
  return typeof u === "string" && /^https?:\/\//i.test(u.trim()) ? u.trim() : undefined;
}

/** problems[] 单项 → YkProblem。review_detail / content_score / appeal_info 等字段
 *  实测存在但归一化暂不透出（如需再加）；R20-C2 已透出 user.{count, my_count,
 *  submit_time, submission_status}（官方命名映射，见 YkProblem 注释）；缺字段不崩。 */
function toYkProblem(p: Record<string, unknown>, pos: number, answerCount: number): YkProblem {
  const content = (p["content"] ?? {}) as Record<string, unknown>;
  const userRaw = p["user"];
  const user = userRaw !== null && typeof userRaw === "object" ? (userRaw as Record<string, unknown>) : undefined;
  const myStatus = toMyStatus(user, answerCount);
  const problem: YkProblem = {
    problemId: p["problem_id"] === undefined || p["problem_id"] === null ? "" : String(p["problem_id"]),
    index: toNumOr(p["index"], pos + 1),
    // 28.4 实测字段为 ProblemType（28.1 旧记录写作 Type，做兼容回退）
    type: toNumOr(content["ProblemType"] ?? content["Type"], 0),
    typeText: toStr(content["TypeText"]),
    score: toNumOr(content["score"], 0),
    bodyHtml: toStr(content["Body"]),
    allowResults: Array.isArray(content["AllowResults"])
      ? (content["AllowResults"] as unknown[]).filter((x): x is string => typeof x === "string")
      : [],
    maxRetry: toNumOr(content["max_retry"] ?? p["max_retry"], 0),
    myStatus,
  };
  const options = content["Options"];
  if (Array.isArray(options)) problem.options = options as unknown[];
  // R20-C1：剩余重交次数（web `left_times` 同口径）——count>0 才给（count<=0 = 不限次，
  // web 端置 999；这里不设，避免把「不限」误判成 0 次）。my_count 缺失按 0（尚未提交）。
  // R20-C2：totalCount / usedCount 把 left_times 的两个操作数原值透传（缺失不设）。
  const retryCount = user ? toNum(user["count"]) : undefined;
  const usedRaw = user ? toNum(user["my_count"]) : undefined;
  if (retryCount !== undefined) problem.totalCount = retryCount;
  if (usedRaw !== undefined) problem.usedCount = usedRaw;
  if (retryCount !== undefined && retryCount > 0) {
    problem.remainingRetries = retryCount - (usedRaw ?? 0);
  }
  // 得分仅「已批改」且为有效数字（非 -1 占位，R16 21.1）时给
  const myScoreRaw = user ? user["my_score"] : undefined;
  const myScore = toNum(myScoreRaw);
  if (myStatus === "graded" && myScore !== undefined && !isUnscoredPlaceholder(myScoreRaw)) {
    problem.myScore = myScore;
  }
  const myAnswer = ((user ?? {})["my_answer"] ?? {}) as Record<string, unknown>;
  // R24 fix ②：「我的作答正文」= 文字正文 + 拍图作答图片（content 为空时只出图片，
  // 此前这类作答一律没有正文可显示，页面只能说「服务端未返回作答正文」）
  const answerText = typeof myAnswer["content"] === "string" ? myAnswer["content"].trim() : "";
  const answerHtml = answerText + ykAnswerImagesHtml(toMyAnswerImageUrls(myAnswer["pics"]));
  if (answerHtml) problem.myAnswerHtml = answerHtml;
  // R20-B2：作答附件归一化（只读展示；下载/上传属 R20-C）
  const atts = toMyAttachments(myAnswer["attachment"]);
  if (atts) problem.myAnswerAttachments = atts;
  // 题型 9（外链 OJ）：透出作答外链（红线：不在雨课堂站内提交）
  if (problem.type === 9) {
    const extUrl = toProblemExternalUrl(content);
    if (extUrl) problem.externalUrl = extUrl;
  }
  if (user) {
    if (typeof user["remark"] === "string" && user["remark"].trim()) problem.remark = user["remark"];
    const comments = toComments(user["comment"]);
    if (comments) problem.comments = comments;
    // R20-C2 / R24：单题提交时间（官方「已提交」判定 = !!submit_time，docs §28.11）。
    // 数字毫秒与 "YYYY-MM-DD HH:MM" 字符串**双形态**统一归一；缺失 / 0 / 无法识别不设。
    const submitText = toSubmitTimeText(user["submit_time"]);
    if (submitText) problem.submitTime = submitText;
    // R20-C2：submission_status 原样透传（官方提交器不用它判定已提交，仅参考）
    const subStatus = toNum(user["submission_status"]);
    if (subStatus !== undefined) problem.submissionStatus = subStatus;
  }
  return problem;
}

/**
 * 拉单份作业详情并归一化（R20-B1，只读）：
 * GET /mooc-api/v1/lms/exercise/get_exercise_list/{leaf_type_id}/?classroom_id=…&term=latest&uv_id=…
 * ⚠️ 必须带请求头 `XTBZ: ykt`（同 fetchYktStatus）。
 * 字段映射（docs 28.4 实测）：exercise 级 name / description / max_retry /
 * is_allowed_late_submission / answer_count / font；R20-B2 增补 late_submission → lateDeadline；
 * R20-C2 改双口径容错（数字毫秒 → lateDeadline / 对象含 deduct_score → lateDeductScore，
 * ⚠️ 28.11 与 28.1 口径冲突待 P1b 真机定稿）；
 * problems[].content{ ProblemType, TypeText,
 * Body, Options, AllowResults, score, max_retry }、problems[].user{ my_answer{content, attachment},
 * remark, comment[], my_score, status, count, my_count, submit_time, submission_status }（后四者
 * R20-C2 透出为 totalCount/usedCount/submitTime/submissionStatus）；题型 9 透出
 * content.data.answer_problem_url。
 * 异常保守口径：errcode≠0 / 缺 data → throw 带上下文；单字段缺失 → 默认值不崩。
 */
async function fetchExerciseDetail(
  fetchLike: FetchLike,
  base: string,
  cookie: string,
  uv: string,
  classroomId: string,
  leafTypeId: string,
): Promise<YkExerciseDetail> {
  const leaf = String(leafTypeId ?? "").trim();
  if (!leaf) throw new Error("雨课堂作业详情失败：leafTypeId 为空");
  const url =
    `${base}/mooc-api/v1/lms/exercise/get_exercise_list/${encodeURIComponent(leaf)}/` +
    `?classroom_id=${encodeURIComponent(String(classroomId))}&term=latest&uv_id=${encodeURIComponent(uv)}`;
  const body = await getJson(fetchLike, url, cookie, { XTBZ: "ykt" });
  const errcode = body["errcode"];
  if (typeof errcode === "number" && errcode !== 0) {
    const msg = typeof body["errmsg"] === "string" ? ` ${body["errmsg"]}` : "";
    // R21-B：401000 = 死会话（实测特征）→ 归一为会话错误；其余 errcode 保持通用报错
    if (errcode === 401000) throw new YktSessionError(`雨课堂会话已失效（errcode=401000${msg}），请在设置页重新登录`);
    throw new Error(`雨课堂作业详情失败：errcode=${errcode}${msg}`);
  }
  const dataRaw = body["data"];
  if (dataRaw === null || typeof dataRaw !== "object") {
    throw new Error("雨课堂作业详情响应异常：缺 data（会话可能已失效）");
  }
  const data = dataRaw as Record<string, unknown>;
  const answerCount = toNumOr(data["answer_count"], 0);
  const problemsRaw = Array.isArray(data["problems"]) ? (data["problems"] as Array<Record<string, unknown>>) : [];
  const font = data["font"];
  // R20-C2：补交口径**双容错**（不下结论，待 P1b 真机复核——docs §28.11 逆向纪要称
  // late_submission 是对象（含 deduct_score 补交扣分），而 §28.1/28.4 旧记录称毫秒时间戳，
  // 两种口径冲突）：
  //  - 数字（毫秒时间戳）→ lateDeadline（R20-B2 行为不变；对象时 toNum 天然取不到 → 不设）；
  //  - 对象且 deduct_score 可解析 → lateDeductScore（该口径下 lateDeadline 不设）；
  //  - 都不是 → 两者都不设。
  const lateRaw = data["late_submission"];
  const lateMs = toNum(lateRaw);
  const lateDeduct =
    lateRaw !== null && typeof lateRaw === "object"
      ? toNum((lateRaw as Record<string, unknown>)["deduct_score"])
      : undefined;
  return {
    name: toStr(data["name"]),
    description: toStr(data["description"]),
    maxRetry: toNumOr(data["max_retry"], 0),
    lateAllowed: data["is_allowed_late_submission"] === true,
    ...(lateMs !== undefined && lateMs > 0 ? { lateDeadline: fmtLocal(lateMs) } : {}),
    ...(lateDeduct !== undefined ? { lateDeductScore: lateDeduct } : {}),
    answerCount,
    ...(typeof font === "string" && font.trim() ? { fontUrl: font } : {}),
    problems: problemsRaw.map((p, i) => toYkProblem(p, i, answerCount)),
  };
}

/* ───────────────── R20-C2 P2：主观题提交 + 正文插图上传（写端点，§31.5/§31.6） ───────────────── */

/** R20-C2 P2：附件兜底通道的 filelist 条目（oSubject.attachments.filelist[]，§28.11 表 A
 *  + §31.5.2 字段清单）。
 *  ⚠️ 产品约束（§31.6）：**解题图片禁入附件**——各科老师强调 AI 判卷读不到附件内容，
 *  图片一律走 uploadExerciseInlineImage 正文插图通道；附件仅文档类兜底 + UI 提示文案。 */
export interface YktSubmitAttachment {
  fileID?: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  fileUrl: string;
}

/** R20-C2 P2：主观题提交入参 */
export interface YktSubmitSubjectiveOptions {
  classroomId: string | number;
  problemId: number | string;
  /** 编辑器产出的正文 HTML（已含内联 `<img src=file_url>`，若有） */
  contentHtml: string;
  /** 附件兜底通道的 filelist 条目（可选；解题图片禁入附件，见 YktSubmitAttachment 注） */
  attachments?: YktSubmitAttachment[];
  /** 提交耗时串，默认 "0"（官方 web 端恒定默认值，§31.5.2：bundle 内从未改写） */
  time?: string;
}

/** R20-C2 P2：主观题提交结果（problem_apply 成功响应归一；P1b 实测无 errcode 包裹） */
export interface YktSubmitResult {
  /** user.count：总可交次数口径（left_times = count − my_count 的被减数） */
  count?: number;
  /** user.my_count：已用次数（本次提交后已递增） */
  myCount?: number;
  /** submit_time（毫秒）→ "YYYY-MM-DD HH:MM" 本地时区；缺失 / 非数字 / <=0 不设 */
  submitTime?: string;
  /** my_score；-1 / "-1.00" 占位（未批改）不透出（对齐 YkProblem.myScore 口径，R16 21.1） */
  myScore?: number;
  isShowAnswer?: boolean;
  exerciseIsShowAnswer?: boolean;
  isShowExplain?: boolean;
  /** my_answer 归一（源字段 attachment → attachments 原样数组；空 / 缺失不设） */
  myAnswer?: { content?: string; attachments?: unknown[] };
}

/** R20-C2 P2：正文内联插图上传入参。
 *  ⚠️ classroomId 目前预留：P1b 实测的 get_aliyun_oss_token?upload_type=ue 不带
 *  classroom_id（§31.5-② 同），透传无效；保留入参是为了 UI 侧调用面稳定。 */
export interface YktInlineImageUploadOptions {
  classroomId: string | number;
  fileName: string;
  mime: string;
  bytes: Uint8Array;
}

/**
 * 主观题逐题提交（R20-C2 P2，docs §31.6 P1b 实发成功）：
 * POST /mooc-api/v1/lms/exercise/problem_apply/
 * body = {classroom_id:Number, problem_id:Number,
 *         answer:{content, time, oSubject:{attachments:{filelist}}}}（§28.11 表 A 主观行）。
 * 头：Cookie（ensureCsrf 补 csrftoken）+ XTBZ: ykt + Content-Type: application/json +
 * X-CSRFToken + Referer: pro.yuketang.cn（官方 SPA = getCookie("csrftoken") 双提交）。
 * 成功响应无 errcode 包裹 → 归一 YktSubmitResult。错误路径：
 * ① 401/403 且 body 含 CSRF → CSRF 拦截 Error（**不是**会话失效，重试/检查双提交实现）；
 * ② 401/403 其他 → YktSessionError；③ 200 + errcode≠0 → 按 errcode/errmsg（401000 → 会话错误）；
 * ④ 非 JSON → YktSessionError。
 * 非空校验（正文/附件任一非空）由 UI 层负责（§31.2 P3 三态校验），core 保持薄。
 */
async function submitYktProblemSubjectiveImpl(
  fetchLike: FetchLike,
  base: string,
  cookie: string,
  opts: YktSubmitSubjectiveOptions,
): Promise<YktSubmitResult> {
  const cid = Number(opts.classroomId);
  const pid = Number(opts.problemId);
  // ⚠️ Number("") === 0：空串/空白串入参必须显式拦截，不能只看 isFinite
  if (!Number.isFinite(cid) || (typeof opts.classroomId === "string" && !opts.classroomId.trim())) {
    throw new Error("雨课堂主观题提交失败：classroomId 需为数字");
  }
  if (!Number.isFinite(pid) || (typeof opts.problemId === "string" && !String(opts.problemId).trim())) {
    throw new Error("雨课堂主观题提交失败：problemId 需为数字");
  }
  const csrf = ensureCsrf(cookie);
  const res = await fetchLike(`${base}/mooc-api/v1/lms/exercise/problem_apply/`, {
    method: "POST",
    headers: {
      Cookie: csrf.cookie,
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      XTBZ: "ykt",
      "Content-Type": "application/json",
      "X-CSRFToken": csrf.token,
      Referer: `${BASE}/`,
    },
    body: JSON.stringify({
      classroom_id: cid,
      problem_id: pid,
      answer: {
        content: typeof opts.contentHtml === "string" ? opts.contentHtml : "",
        time: opts.time ?? "0",
        oSubject: { attachments: { filelist: Array.isArray(opts.attachments) ? opts.attachments : [] } },
      },
    }),
  });
  if (res.status === 401 || res.status === 403) {
    let text = "";
    try {
      text = await res.text();
    } catch {
      /* body 读不到按无 CSRF 文本处理 */
    }
    // §31.6：Django DRF 403「CSRF Failed: CSRF cookie not set」——双提交问题，非会话失效
    if (/CSRF/i.test(text)) {
      throw new Error(
        `提交被 CSRF 拦截（HTTP ${res.status}：X-CSRFToken 头与 Cookie csrftoken 必须同值，请重试；持续出现请反馈）`,
      );
    }
    throw new YktSessionError(`雨课堂会话已失效（HTTP ${res.status}），请在设置页重新登录`);
  }
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new YktSessionError("雨课堂返回非 JSON（会话可能已失效被跳到登录页），请重新登录");
  }
  const obj = (json ?? {}) as Record<string, unknown>;
  const errcode = toNum(obj["errcode"]);
  if (errcode !== undefined && errcode !== 0) {
    const msg = typeof obj["errmsg"] === "string" ? ` ${obj["errmsg"]}` : "";
    // R21-B：401000 = 死会话（实测特征）→ 归一为会话错误；其余 errcode 保持通用报错
    if (errcode === 401000) throw new YktSessionError(`雨课堂会话已失效（errcode=401000${msg}），请在设置页重新登录`);
    throw new Error(`雨课堂主观题提交失败：errcode=${errcode}${msg}`);
  }
  if (obj["code"] === 50000) {
    throw new YktSessionError("雨课堂会话已失效（UNAUTHENTICATED），请在设置页重新登录");
  }
  return normalizeSubmitResult(obj);
}

/** problem_apply 成功响应（data 层字段，P1b 实测）→ YktSubmitResult；缺字段不崩。 */
function normalizeSubmitResult(obj: Record<string, unknown>): YktSubmitResult {
  const out: YktSubmitResult = {};
  const count = toNum(obj["count"]);
  if (count !== undefined) out.count = count;
  const myCount = toNum(obj["my_count"]);
  if (myCount !== undefined) out.myCount = myCount;
  const submitMs = toNum(obj["submit_time"]);
  if (submitMs !== undefined && submitMs > 0) out.submitTime = fmtLocal(submitMs);
  const myScoreRaw = obj["my_score"];
  if (!isUnscoredPlaceholder(myScoreRaw)) {
    const myScore = toNum(myScoreRaw);
    if (myScore !== undefined) out.myScore = myScore;
  }
  const isShow = obj["is_show_answer"];
  if (typeof isShow === "boolean") out.isShowAnswer = isShow;
  const exShow = obj["exercise_is_show_answer"];
  if (typeof exShow === "boolean") out.exerciseIsShowAnswer = exShow;
  const explain = obj["is_show_explain"];
  if (typeof explain === "boolean") out.isShowExplain = explain;
  const myRaw = obj["my_answer"];
  if (myRaw !== null && typeof myRaw === "object") {
    const ma = myRaw as Record<string, unknown>;
    const content = typeof ma["content"] === "string" && ma["content"].length > 0 ? ma["content"] : undefined;
    const atts = Array.isArray(ma["attachment"]) && ma["attachment"].length > 0 ? (ma["attachment"] as unknown[]) : undefined;
    if (content !== undefined || atts !== undefined) {
      out.myAnswer = {
        ...(content !== undefined ? { content } : {}),
        ...(atts !== undefined ? { attachments: atts } : {}),
      };
    }
  }
  return out;
}

/**
 * 正文内联插图上传（R20-C2 P2：AI 判卷可读的主通道，§31.5-② 逆向 + P1b 真机实测修正）。
 * 两步：
 * ① GET /c27/online_courseware/service/get_aliyun_oss_token/?upload_type=ue（Cookie+XTBZ）
 *    → 实测 {msg, data:{token:{accessid, bucket, callback(整段 base64 原样透传),
 *    dir(末尾带 /), expire, host, policy, signature}}}；
 * ② 手拼 multipart/form-data（实测成功字段序：OSSAccessKeyId / policy / Signature / key /
 *    callback / success_action_status=200 / file——**file 字段必须最后**；key =
 *    {dir}{Date.now()}-{文件名}，§31.5-② bundle 注释 r.dir+Date.now()-文件名，dir 自带尾斜杠）
 *    POST 到 token.host（实测 https://{bucket}.oss-cn-beijing.aliyuncs.com），头带
 *    Origin + Referer: pro.yuketang.cn（官方 patch 从页面发自带，独立传输层需显式补；
 *    ⚠️ 不带 ykt Cookie——跨域凭据不外泄，OSS 也不需要）。
 * 响应体即 OSS callback 回执：实测 {msg, data:{filename, file_url, error_message, size},
 * success:true} → fileUrl = data.file_url（实测 thu-oplat.xuetangx.com 域，非 OSS host 域）。
 * 校验 success / error_message / errcode 三道（后者兼容 §31.5 记录的 errcode 形状）。
 * ⚠️ core 零 Node/Tauri 专属 API：multipart 用 TextEncoder 手拼 Uint8Array（BodyInit 标准形态），
 * 二进制传输能力由应用侧 fetchLike 提供；callback 字段是服务端下发的 base64 串，原样透传不解包。
 */
async function uploadExerciseInlineImageImpl(
  fetchLike: FetchLike,
  base: string,
  cookie: string,
  opts: YktInlineImageUploadOptions,
): Promise<{ fileUrl: string }> {
  const fileName = (opts.fileName ?? "").trim();
  if (!fileName) throw new Error("雨课堂插图上传失败：fileName 为空");
  const mime = (opts.mime ?? "").trim() || "application/octet-stream";
  const bytes = opts.bytes;
  if (!bytes || bytes.length === 0) throw new Error("雨课堂插图上传失败：文件内容为空");
  // ① OSS 表单直传 token（getJson 复用会话失效归一：401/403 / 非 JSON / code 50000）
  const tokenBody = await getJson(
    fetchLike,
    `${base}/c27/online_courseware/service/get_aliyun_oss_token/?upload_type=ue`,
    cookie,
    { XTBZ: "ykt" },
  );
  const terr = toNum(tokenBody["errcode"]);
  if (terr !== undefined && terr !== 0) {
    const msg = typeof tokenBody["errmsg"] === "string" ? ` ${tokenBody["errmsg"]}` : "";
    if (terr === 401000) throw new YktSessionError(`雨课堂会话已失效（errcode=401000${msg}），请在设置页重新登录`);
    throw new Error(`雨课堂插图上传失败：OSS token 获取失败 errcode=${terr}${msg}`);
  }
  // token 位置防御：P1b 实测在 data.token；兼容 data 直接展开 / 顶层字段的形状（逐层浅合并，
  // data.token 优先级最高）
  const dataRaw = tokenBody["data"];
  let token: Record<string, unknown> = { ...tokenBody };
  if (dataRaw !== null && typeof dataRaw === "object") {
    token = { ...token, ...(dataRaw as Record<string, unknown>) };
    const tInner = (dataRaw as Record<string, unknown>)["token"];
    if (tInner !== null && typeof tInner === "object") {
      token = { ...token, ...(tInner as Record<string, unknown>) };
    }
  }
  const host = toStr(token["host"]).trim();
  const accessId = toStr(token["accessid"]).trim();
  const policy = toStr(token["policy"]).trim();
  const signature = toStr(token["signature"]).trim();
  const dir = toStr(token["dir"]).trim();
  const callback = toStr(token["callback"]).trim();
  if (!host || !accessId || !policy || !signature) {
    throw new Error("雨课堂插图上传失败：OSS token 响应缺 host/accessid/policy/signature");
  }
  // ② multipart 手拼：字段段全 UTF-8 编码（policy/callback 为 base64 ASCII；key 含原始文件名），
  //    文件字节段保持原样不编码；文件字段必须最后（OSS 按表单序处理，官方 patch 同序）。
  const key = `${dir}${Date.now()}-${fileName}`;
  const boundary = `----OneTHUYktUE${randomHexToken()}`;
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const pushField = (name: string, value: string) => {
    chunks.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  };
  pushField("OSSAccessKeyId", accessId);
  pushField("policy", policy);
  pushField("Signature", signature);
  pushField("key", key);
  if (callback) pushField("callback", callback);
  pushField("success_action_status", "200");
  chunks.push(
    enc.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
        `Content-Type: ${mime}\r\n\r\n`,
    ),
  );
  chunks.push(bytes);
  chunks.push(enc.encode(`\r\n--${boundary}--\r\n`));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const body = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    body.set(c, off);
    off += c.length;
  }
  const res = await fetchLike(host, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      Origin: BASE,
      Referer: `${BASE}/`,
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
    },
    body,
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // OSS 侧错误多为 XML（SignatureDoesNotMatch 等），不是登录壳——不归一会话错误
    throw new Error(`雨课堂插图上传失败：OSS 响应非 JSON（HTTP ${res.status}）`);
  }
  const obj = (json ?? {}) as Record<string, unknown>;
  // callback 回执校验：P1b 实测 {msg, data:{filename, file_url, error_message, size}, success:true}；
  // success=false / errcode≠0 / error_message 非空三道都拦（errcode 兼容 §31.5 旧记录形状，
  // 其 errmsg 一并透出；error_message 是实测形状的字段）
  const dataObj = (obj["data"] ?? {}) as Record<string, unknown>;
  const errMessage = (toStr(dataObj["error_message"]) || toStr(obj["errmsg"])).trim();
  const cbErrcode = toNum(obj["errcode"]);
  if (obj["success"] === false) {
    throw new Error(`雨课堂插图上传失败：OSS callback success=false${errMessage ? `：${errMessage}` : ""}`);
  }
  if (cbErrcode !== undefined && cbErrcode !== 0) {
    throw new Error(`雨课堂插图上传失败：OSS callback errcode=${cbErrcode}${errMessage ? ` ${errMessage}` : ""}`);
  }
  if (errMessage) throw new Error(`雨课堂插图上传失败：OSS callback 报错：${errMessage}`);
  const fileUrl = toStr(dataObj["file_url"]).trim();
  if (!fileUrl) throw new Error("雨课堂插图上传失败：OSS callback 响应缺 data.file_url");
  return { fileUrl };
}

// ── 课程「全部内容」目录（作业/试卷之外的课件、投票…） ──
//
// 学习日志（logs/learn）一次返回该课堂**所有类型**的内容，作业只是其中
// type=19/20 两类。作业聚合（fetch）与内容目录（fetchContents）共用这一份
// 原始列表 —— 「看全部内容」不会额外打接口。
interface YktActivityEntry {
  /** courses/list 的 classroom_id（所属课程；作业 id 与回退链接用它拼） */
  courseId: string;
  /** activity 自带的 classroom_id（缺省回落 courseId）——深链与旁听判定用它 */
  classroomId: string;
  courseName: string;
  audited: boolean;
  act: Record<string, unknown>;
}

// 学习日志 activities[].type → 内容大类。
// 已确认：19=作业、20=试卷、14=课件、5=投票（docs §4.1 实测）；
// 2=视频/微课、9=公告、16=课程资料（本机真实数据核对：2 为「图书馆系列课程…微课」、
// 9 为「习题课安排 / 渐渐熟悉雨课堂系统」、16 为「教学内容电子版 / 教学基本要求」）。
// 其余值不臆测，归入 other 并保留原始 type（UI 显示「其他（类型 N）」，
// 诊断日志记录类型分布，后续据此补充映射）。
const YKT_CONTENT_KINDS: Record<number, { kind: ExtContentKind; text: string }> = {
  19: { kind: "homework", text: "作业" },
  20: { kind: "exam", text: "试卷" },
  14: { kind: "courseware", text: "课件" },
  16: { kind: "material", text: "资料" },
  2: { kind: "video", text: "视频" },
  9: { kind: "announcement", text: "公告" },
  5: { kind: "poll", text: "投票" },
};

function yktKindOf(type: number): { kind: ExtContentKind; text: string } {
  return YKT_CONTENT_KINDS[type] ?? { kind: "other", text: `其他（类型 ${type}）` };
}

// 非空字符串化（null/undefined → ""，其余 String(...).trim()）
function yktStr(v: unknown): string {
  return v === undefined || v === null ? "" : String(v).trim();
}

// 时刻字段归一：不同内容类型把时间放在不同字段（作业/试卷是 content.score_d，
// 其他类型可能是 start_d / end_d / time / create_time…），逐个候选试，
// 第一个能解析出「YYYY-MM-DD HH:MM」的胜出（数字毫秒与日期串双形态）。
function yktAnyTimeText(candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    const t = toSubmitTimeText(c);
    if (t) return t;
  }
  return undefined;
}

// 内容在平台网页端的地址：
// 作业(19)/试卷(20) + leaf_id 齐备 → 学生端深链（docs R16b 实测，仅需 leaf_id）；
// 缺 leaf_id 或其他类型（课件/投票…） → 课程日志页（该课内容的官方入口）。
function yktContentUrl(base: string, classroomId: string, courseId: string, type: number, leafId: string): string {
  if ((type === 19 || type === 20) && leafId) {
    const route = type === 20 ? "quiz" : "exercise";
    return (
      `${base}/ai-workspace/lms-graph/${encodeURIComponent(classroomId)}` +
      `/${route}/${encodeURIComponent(leafId)}?is_chapter=1`
    );
  }
  return `${base}/v2/web/studentLog/${encodeURIComponent(courseId)}`;
}

// 叶子类型（leaf_type）→ 学生端站内路由段（从雨课堂公开前端路由表逆向，
// 2026-10-09：0=视频 1=音频 2=直播 3=图文/课件 4=讨论 5=考试；6=作业另走既有深链）。
const YKT_LEAF_ROUTES: Record<number, string> = {
  0: "video",
  1: "audio",
  2: "live",
  3: "graph",
  4: "forum",
  5: "exam",
};

/** 叶子内容的站内直达地址（SPA 基址 /v2/web）：/v2/web/lms/{cid}/{segment}/{leafId}。
 *  leaf_type 未知时不臆造路由，返回课程日志页（该课全部内容的官方入口）。 */
function yktLeafRouteUrl(base: string, classroomId: string, courseId: string, leafType: number | undefined, leafId: string): string {
  const seg = leafType === undefined ? undefined : YKT_LEAF_ROUTES[leafType];
  if (!seg || !leafId) return `${base}/v2/web/studentLog/${encodeURIComponent(courseId)}`;
  return `${base}/v2/web/lms/${encodeURIComponent(classroomId)}/${seg}/${encodeURIComponent(leafId)}`;
}

/** 叶子内容的**站内直达地址**（宿主做应用内预览时用；leaf_type 缺失则回落课程日志页） */
export function yktStudentLeafUrl(classroomId: string, leafId: string, leafType?: number, courseId?: string): string {
  return yktLeafRouteUrl(BASE, classroomId, courseId ?? classroomId, leafType, leafId);
}

/** 递归收集响应里的 http(s) 串（叶子详情的媒体/文件地址字段名不固定，按扩展名归类更稳） */
function collectHttpUrls(node: unknown, out: string[], depth = 0): void {
  if (depth > 6 || out.length > 60) return;
  if (typeof node === "string") {
    if (/^https?:\/\//i.test(node)) out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) collectHttpUrls(v, out, depth + 1);
    return;
  }
  if (node !== null && typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) collectHttpUrls(v, out, depth + 1);
  }
}

/**
 * 递归收集「像公告标识」的 id 候选（源侧字段名不固定）。
 *
 * 背景：公告（学习日志 type 9）在 content 里带的 id 字段名没有公开结论（notice_id /
 * topic_id / link_id / article_id…），猜错就会取不到正文。这里按**键名可能性**打分排序，
 * 把候选全部交给详情取数逐个试，命中即止；同时排除课程/班级自身的 id（避免无谓请求）。
 */
function collectNoticeIdCandidates(content: Record<string, unknown>, exclude: string[]): string[] {
  const scored: Array<{ id: string; score: number }> = [];
  const push = (key: string, raw: unknown): void => {
    const id =
      typeof raw === "number" && Number.isFinite(raw)
        ? String(raw)
        : typeof raw === "string" && /^\d{1,12}$/.test(raw.trim())
          ? raw.trim()
          : "";
    if (!id || exclude.includes(id)) return;
    const k = key.toLowerCase();
    // 键名越像「公告/话题」越优先；裸 id 次之
    const score = /notice|announce|bulletin/.test(k)
      ? 0
      : /topic|article|link/.test(k)
        ? 1
        : /leaf|courseware/.test(k)
          ? 3
          : k === "id"
            ? 2
            : 4;
    scored.push({ id, score });
  };
  const walk = (node: unknown, depth = 0): void => {
    if (depth > 4 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const v of node) walk(v, depth + 1);
      return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (/(^|_)(id)$/i.test(k) || /_id$/i.test(k) || k === "id" || k === "ID") push(k, v);
      if (v !== null && typeof v === "object") walk(v, depth + 1);
    }
  };
  walk(content);
  return [...new Set(scored.sort((a, b) => a.score - b.score).map((s) => s.id))].slice(0, 4);
}

/** 从任意响应节点里抠出「像正文」的字符串：优先常见正文字段，其次带标签的长文本 */
function extractBodyHtml(node: unknown, depth = 0): string | undefined {
  if (depth > 4 || node === null || typeof node !== "object") return undefined;
  const obj = node as Record<string, unknown>;
  for (const key of ["content", "body", "text", "detail", "description", "html", "htmlContent", "richText"]) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (v !== null && typeof v === "object") {
      const nested = extractBodyHtml(v, depth + 1);
      if (nested) return nested;
    }
  }
  // 兜底：任意「长且像文章」的字符串（>60 字，或含 HTML 标签）
  let best: string | undefined;
  for (const v of Object.values(obj)) {
    if (typeof v === "string") {
      const s = v.trim();
      if (!s) continue;
      const looksArticle = /<\/?[a-z][\s\S]*>/i.test(s) || s.length > 60;
      if (looksArticle && (best === undefined || s.length > best.length)) best = s;
    } else if (v !== null && typeof v === "object") {
      const nested = extractBodyHtml(v, depth + 1);
      if (nested && (best === undefined || nested.length > best.length)) best = nested;
    }
  }
  return best;
}

const YKT_VIDEO_RE = /\.(?:m3u8|mp4|flv|mov|m4v)(?:[?#]|$)/i;
/** 文档类直链（走应用内文件预览：PDF / Office / 压缩包 / 纯文本） */
const YKT_FILE_RE = /\.(?:pdf|ppt|pptx|doc|docx|xls|xlsx|zip|rar|7z|txt|md|csv)(?:[?#]|$)/i;
/** 图片直链（图文/课件按图片序列内嵌翻页渲染） */
const YKT_IMAGE_RE = /\.(?:png|jpe?g|gif|webp|bmp|svg)(?:[?#]|$)/i;

/** 叶子详情（站内预览用）：leaf_type + 可能的直链（文件/媒体）+ 文章正文 */
export interface YkLeafDetail {
  /** 源侧 leaf_type（0=视频 1=音频 2=直播 3=图文/课件 4=讨论 5=考试 6=作业） */
  leafType?: number;
  /** 标题（响应里有则用；缺省由调用方用列表标题兜底） */
  title?: string;
  /** 可直接渲染的文件直链（pdf/ppt/doc/图片…；按扩展名识别，取第一个） */
  fileUrl?: string;
  /** 媒体直链（m3u8/mp4/flv…；取第一个） */
  mediaUrl?: string;
  /** 图片序列直链（图文 / 课件按图逐页渲染；按出现顺序去重） */
  images?: string[];
  /** 文章型正文（data.content.body 一类字段，仅字符串且含标签时才给） */
  bodyHtml?: string;
  /** 诊断：响应顶层与 content 子对象的字段名（**不含值**，接口改版时据此定位） */
  shape: string[];
}

/** 公告详情（站内内嵌渲染用；字段名不固定，按候选字段 + 长文本兜底抽取） */
export interface YkNoticeDetail {
  title?: string;
  /** 正文 HTML（含标签的历史公告；纯文本公告按段落包成 <p> 后给） */
  bodyHtml?: string;
  /** 正文里的图片直链 */
  images?: string[];
  /** 诊断：响应字段名（不含值） */
  shape: string[];
}

export function createYuketangSource(cred: YktCred, fetchLike: FetchLike, days: number, hooks?: YuketangSourceHooks): YuketangSource {
  const base = BASE;
  // R21-B：会话串可变——服务端轮换（Set-Cookie 白名单字段）时原地更新，后续请求即用新值
  let curCookie = authCookie(cred);
  const uv = (cred.uvId ?? "").trim() || "2598";
  /** 传输层包装：每次已授权请求后捕获 Set-Cookie（OneTHU 传输层自定义头通道），
   *  白名单字段有变化 → 更新 curCookie 并回调 onCookieRefresh（desktop 负责加密存回）。
   *  浏览器原生 fetch 读不到这些头 → 捕获结果恒空 = 零行为变化。 */
  const yktFetch: FetchLike = async (url, init) => {
    const res = await fetchLike(url, init);
    try {
      const pairs = yktCaptureSetCookies(res);
      if (pairs.size > 0) {
        const merged = mergeYktCookiePairs(curCookie, pairs);
        if (merged !== curCookie) {
          curCookie = merged;
          hooks?.onCookieRefresh?.(merged);
        }
      }
    } catch {
      /* 头解析失败不影响主流程 */
    }
    return res;
  };
  /** 课程列表（courses/list）的唯一取数口：作业拉取与课程列表共用一份，
   *  同一次刷新里只打一次接口；失败不缓存（下次调用重新请求）。
   *  会话失效仍归一为 YktSessionError，供编排层的自动重登判定使用。 */
  let coursesPromise: Promise<Array<Record<string, unknown>>> | null = null;
  const loadCourses = (): Promise<Array<Record<string, unknown>>> => {
    if (!coursesPromise) {
      coursesPromise = (async () => {
        const coursesBody = await getJson(yktFetch, `${base}/v2/api/web/courses/list?identity=2`, curCookie);
        const errcode = coursesBody["errcode"];
        if (typeof errcode === "number" && errcode !== 0) {
          const msg = typeof coursesBody["errmsg"] === "string" ? ` ${coursesBody["errmsg"]}` : "";
          // R21-B：401000 = 死会话（2026-09-20 实测特征）→ 归一；其余 errcode 保持通用报错
          if (errcode === 401000) throw new YktSessionError(`雨课堂会话已失效（errcode=401000${msg}），请在设置页重新登录`);
          throw new Error(`雨课堂课程列表失败：errcode=${errcode}${msg}`);
        }
        const data = (coursesBody["data"] ?? {}) as Record<string, unknown>;
        return Array.isArray(data["list"]) ? (data["list"] as Array<Record<string, unknown>>) : [];
      })().catch((e: unknown) => {
        coursesPromise = null;
        throw e;
      });
    }
    return coursesPromise;
  };
  // 学习日志（**全部内容类型**的唯一取数口）：按课程逐课拉，缓存整轮。
  // 作业（fetch）只取其中 type 19/20，内容目录（fetchContents）取全部 —— 两者共用，
  // 同一次刷新每门课只打一次 logs/learn。单门课失败只跳过该课（与旧行为一致）。
  let activitiesPromise: Promise<YktActivityEntry[]> | null = null;
  const loadActivities = (): Promise<YktActivityEntry[]> => {
    if (!activitiesPromise) {
      activitiesPromise = (async () => {
        const list = await loadCourses();
        // classroom_id → role（R9）：role 5=正式选课、6=旁听；其余未知值不标（保守）
        const roleByClassroom = new Map<string, unknown>();
        for (const c of list) {
          const cid = c["classroom_id"];
          if (cid === undefined || cid === null) continue;
          roleByClassroom.set(String(cid), c["role"]);
        }
        const out: YktActivityEntry[] = [];
        for (const c of list) {
          const cid = c["classroom_id"];
          if (cid === undefined || cid === null) continue;
          const courseId = String(cid);
          const course = (c["course"] ?? {}) as Record<string, unknown>;
          const courseName = String(c["name"] ?? course["name"] ?? "雨课堂课程");
          try {
            const logs = await getJson(
              yktFetch,
              `${base}/v2/api/web/logs/learn/${cid}?page=0&offset=200&sort=0&actype=-1`,
              curCookie,
            );
            const lerr = logs["errcode"];
            if (typeof lerr === "number" && lerr !== 0) throw new Error(`errcode=${lerr}`);
            const ldata = (logs["data"] ?? {}) as Record<string, unknown>;
            const acts = Array.isArray(ldata["activities"])
              ? (ldata["activities"] as Array<Record<string, unknown>>)
              : [];
            for (const a of acts) {
              const classroomId = String(a["classroom_id"] ?? cid);
              out.push({
                courseId,
                classroomId,
                courseName,
                audited: roleByClassroom.get(classroomId) === 6,
                act: a,
              });
            }
          } catch {
            /* 单门课失败跳过，继续下一门 */
          }
        }
        return out;
      })().catch((e: unknown) => {
        activitiesPromise = null;
        throw e;
      });
    }
    return activitiesPromise;
  };
  return {
    id: "yuketang",
    name: "雨课堂",
    /** R21-B：会话健康检查 + 保活心跳载体。GET /api/v3/user/basic-info 是全部已授权
     *  端点里最轻的（无 XTBZ 要求、无列表遍历）。alive=null 仅网络断等未知态。 */
    async checkSession(): Promise<YktSessionHealth> {
      const checkedAt = Date.now();
      try {
        const body = await getJson(yktFetch, `${base}/api/v3/user/basic-info`, curCookie);
        // 死会话特征（code=50000）已在 getJson 归一为 YktSessionError，能走到这即 code=0
        const data = (body["data"] ?? {}) as Record<string, unknown>;
        const nameRaw = data["name"] ?? data["username"] ?? data["nickname"];
        const userName = typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : undefined;
        return { alive: true, ...(userName ? { userName } : {}), checkedAt };
      } catch (e) {
        if (!isYktSessionError(e)) return { alive: null, reason: "network", checkedAt };
        const m = e.message;
        const reason = /HTTP 401/.test(m)
          ? "http401"
          : /HTTP 403/.test(m)
            ? "http403"
            : /UNAUTHENTICATED/.test(m)
              ? "unauthenticated"
              : /非 JSON/.test(m)
                ? "non-json"
                : "errcode=401000";
        return { alive: false, reason, checkedAt };
      }
    },
    async fetch(): Promise<ExternalHomework[]> {
      const entries = await loadActivities();
      const limit = Date.now() + (days > 0 ? days : 30) * 86400000;
      const items: YktItem[] = [];
      for (const e of entries) {
        const a = e.act;
        const type = a["type"];
        if (type !== 19 && type !== 20) continue; // 作业聚合只吃作业/试卷；其余走 fetchContents
        const content = (a["content"] ?? {}) as Record<string, unknown>;
        const ms = content["score_d"];
        if (typeof ms !== "number" || !Number.isFinite(ms)) continue;
        if (ms > limit) continue; // 只保留未来 N 天（已过期仍保留）
        const id = a["id"] ?? a["courseware_id"] ?? ms;
        const leafTypeStr = yktStr(content["leaf_type_id"]);
        const leafStr = yktStr(content["leaf_id"]);
        const skuStr = yktStr(content["sku_id"]);
        items.push({
          classroomId: e.classroomId,
          leafTypeId: leafTypeStr,
          isExam: type === 20,
          skuId: skuStr || undefined,
          hw: {
            id: `yuketang-${e.courseId}-${id}`,
            source: "yuketang",
            courseName: e.courseName,
            title: String(a["title"] ?? "作业"),
                deadline: fmtLocal(ms),
                kind: type === 20 ? "exam" : "homework",
                url: yktContentUrl(base, e.classroomId, e.courseId, type, leafStr),
                submitted: false,
                audited: e.audited || undefined,
                // R20-B2：原生详情页拉取参数（leaf_type_id 缺失时不设 → UI 回退网页打开）
                ...(leafTypeStr ? { leafTypeId: leafTypeStr } : {}),
                classroomId: e.classroomId,
          },
        });
      }

      // 并发（上限 4）查提交状态；单条失败只跳过（保守 false），不影响整体
      await mapLimited(items, STATUS_CONCURRENCY, async (it) => {
        if (!it.leafTypeId) return;
        try {
          const st = it.isExam
            ? await fetchYktExamStatus(yktFetch, base, curCookie, it.classroomId, it.leafTypeId, it.skuId ?? "")
            : await fetchYktStatus(yktFetch, base, curCookie, uv, it.classroomId, it.leafTypeId);
          it.hw.submitted = st.submitted;
          if (st.submittedCount !== undefined) it.hw.submittedCount = st.submittedCount;
          if (st.totalCount !== undefined) it.hw.totalCount = st.totalCount;
          if (st.score !== undefined) it.hw.score = st.score;
          if (st.totalScore !== undefined) it.hw.totalScore = st.totalScore;
          if (st.graded !== undefined) it.hw.graded = st.graded;
        } catch {
          /* 状态查询失败：保守保持未提交 */
        }
      });

      return items.map((it) => it.hw);
    },
    /** 课程列表（只读）：把「已选 / 旁听」的雨课堂课堂作为课程实体透出，
     *  供宿主把它们和网络学堂课程并列展示。与 fetch() 共用同一份 courses/list
     *  请求（同一次刷新只打一次），因此不会增加接口压力。 */
    async fetchCourses(): Promise<ExternalCourse[]> {
      const list = await loadCourses();
      const out: ExternalCourse[] = [];
      for (const c of list) {
        const cid = c["classroom_id"];
        if (cid === undefined || cid === null) continue;
        const id = String(cid);
        const course = (c["course"] ?? {}) as Record<string, unknown>;
        const name = String(c["name"] ?? course["name"] ?? "雨课堂课程");
        // 官方课程卡片是「大标题 = course.name（课程本名）+ 小标题 = 教师 + classroom name」：
        // 这里把这两个字段都透出，宿主即可仿照官方卡片排版（缺字段时回落）
        const courseName = typeof course["name"] === "string" && course["name"].trim() ? course["name"].trim() : undefined;
        const teacherObj = c["teacher"];
        const teacherRaw =
          teacherObj !== null && typeof teacherObj === "object"
            ? (teacherObj as Record<string, unknown>)["name"]
            : teacherObj;
        const teacher = typeof teacherRaw === "string" && teacherRaw.trim() ? teacherRaw.trim() : undefined;
        // role 5=正式选课、6=旁听；其余未知值不标（与 fetch 的 audited 判定同源）
        const audited = c["role"] === 6 || String(c["role"]) === "6";
        out.push({
          id,
          source: "yuketang",
          name,
          ...(courseName ? { title: courseName } : {}),
          ...(teacher ? { teacher } : {}),
          ...(audited ? { audited: true } : {}),
          url: `${base}/v2/web/studentLog/${encodeURIComponent(id)}`,
        });
      }
      return out;
    },
    // 课程「全部内容」目录（只读，不含提交状态）：该课发布的一切 —— 作业、试卷、
    // 课件、投票，以及接口将来新增的类型（未知类型归 other，rawType 原样保留，
    // 宿主显示「其他（类型 N）」而不是丢掉）。与 fetch()/fetchCourses() 共用
    // 同一份 logs/learn 与 courses/list 请求，因此不额外增加接口压力。
    async fetchContents(): Promise<ExternalContent[]> {
      const entries = await loadActivities();
      const out: ExternalContent[] = [];
      for (const e of entries) {
        const a = e.act;
        const type = toNum(a["type"]) ?? 0;
        const meta = yktKindOf(type);
        const content = (a["content"] ?? {}) as Record<string, unknown>;
        const leafStr = yktStr(content["leaf_id"]);
        const leafTypeStr = yktStr(content["leaf_type_id"]);
        const skuStr = yktStr(content["sku_id"]);
        // 公告类内容（type 9）的 id 字段名未固定：公开产物里公告详情路由是
        // /v2/web/noticeView/{classroomId}/{noticeId}；源侧 id 可能是 notice_id / topic_id /
        // link_id / article_id… —— 递归收集**候选列表**交给详情取数逐个试（猜一个容易失手）。
        // ⚠️ 只对公告（type 9）收集候选 id：作业/试卷的 content 里也有 leaf_id/sku_id 等
        //    「*_id」字段，误收会把作业深链污染成公告链接（回归测试 [6] 钉住这点）。
        // 实测（2026-10-10 真机日志）：公告活动**没有 content 对象**，字段是
        // act.{type,id,courseware_id,title,create_time,attachments,hasRead} —— 身份在
        // courseware_id（首个候选）与 id（次选）；content 存在时再叠加递归候选兜底。
        const noticeCandidates =
          type === 9
            ? [
                ...new Set([
                  yktStr(a["courseware_id"]),
                  yktStr(a["id"]),
                  ...collectNoticeIdCandidates(content, [e.courseId, e.classroomId]),
                  // 附件里若带 id（公告正文以附件形态出现时），一并作为候选
                  ...(Array.isArray(a["attachments"])
                    ? (a["attachments"] as unknown[]).flatMap((x) =>
                        x && typeof x === "object"
                          ? collectNoticeIdCandidates(x as Record<string, unknown>, [e.courseId, e.classroomId])
                          : [],
                      )
                    : []),
                ]),
              ]
                .filter((s) => s !== "" && s !== e.courseId && s !== e.classroomId)
                .slice(0, 3)
            : [];
        const noticeStr = noticeCandidates[0] ?? "";
        // 正文若已内联在日志里（含标签的长文本）就直接用，省掉一次详情请求。
        // ⚠️ 实测公告活动**没有 content**，正文（若有）只可能在活动对象本身（含 attachments）
        const inlineBody = type === 9 ? (extractBodyHtml(a) ?? extractBodyHtml(content)) : undefined;
        const inlineBodyHtml =
          inlineBody && inlineBody.length > 20 && /<\/?[a-z][\s\S]*>/i.test(inlineBody) ? inlineBody : undefined;
        // 诊断：公告活动带哪些字段（只记字段名）——id 字段名未知时据此适配
        const noticeShape =
          type === 9
            ? [
                ...Object.keys(a).map((k) => `act.${k}`),
                ...Object.keys(content).map((k) => `content.${k}`),
                // 附件形态（公告正文有可能是附件）：只记条数与字段名
                Array.isArray(a["attachments"])
                  ? `attachments[](${a["attachments"].length}) ${(a["attachments"] as unknown[])
                      .slice(0, 2)
                      .map((x) => (x && typeof x === "object" ? `{${Object.keys(x as Record<string, unknown>).join("|")}}` : typeof x))
                      .join(" ")}`
                  : `attachments:${typeof a["attachments"]}`,
              ].slice(0, 30)
            : undefined;
        const rawId = a["id"] ?? a["courseware_id"] ?? `${type}-${leafStr}-${leafTypeStr}`;
        // 时间：作业/试卷是 score_d（DDL）；其他类型字段名不一，逐个候选试
        const timeText = yktAnyTimeText([
          content["score_d"],
          content["start_d"],
          content["end_d"],
          content["time"],
          a["time"],
          a["create_time"],
          content["create_time"],
        ]);
        out.push({
          id: `yuketang-${e.courseId}-${type}-${rawId}`,
          source: "yuketang",
          courseId: e.courseId,
          courseName: e.courseName,
          rawType: type,
          kind: meta.kind,
          kindText: meta.text,
          // 标题兜底链：activity.title → content.title/name → 类型名（绝不空白行）
          title: yktStr(a["title"]) || yktStr(content["title"]) || yktStr(content["name"]) || meta.text,
          ...(timeText ? { deadline: timeText } : {}),
          url: noticeStr
            ? `${base}/v2/web/noticeView/${encodeURIComponent(e.courseId)}/${encodeURIComponent(noticeStr)}`
            : yktContentUrl(base, e.classroomId, e.courseId, type, leafStr),
          ...(leafTypeStr ? { leafTypeId: leafTypeStr } : {}),
          ...(leafStr ? { leafId: leafStr } : {}),
          ...(noticeStr ? { noticeId: noticeStr } : {}),
          ...(noticeCandidates.length > 0 ? { noticeIdCandidates: noticeCandidates } : {}),
          ...(inlineBodyHtml ? { inlineBodyHtml } : {}),
          ...(noticeShape ? { noticeShape } : {}),
          ...(skuStr ? { skuId: skuStr } : {}),
          ...(e.audited ? { audited: true } : {}),
        });
      }
      return out;
    },
    // 公告详情（站内内嵌渲染）。
    //
    // 端点：`GET /v/discussion/v2/topic/{courseware_id}/?classroom_id={cid}`
    // —— 2026-10-10 用 CDP 抓到官方公告页（noticeView）点开后发出的**原始请求**，
    //    id 用的是活动里的 `courseware_id`（不是 `id`），与写接口 `pub_news/{courseware_id}` 同源。
    //
    // ⚠️ 必须带官方那套头，否则服务端返回 200 + `success=false「无权限」`（我最初就栽在这）：
    //    X-CSRFToken（与 Cookie 同值）、uv-id、classroom-id、university-id、Xt-Agent: web、
    //    xtbz: ykt，并且 Referer 指到该公告的 noticeView 页。
    //
    // 响应结构（双层 data）：`{msg, code, data:{status, message, data:{topic:{...}}}}`
    //    · 标题：`topic.topic_name`
    //    · 正文：`topic.content.text`（UEditor HTML，如 `<div class="custom_ueditor_cn_body">…`）
    // 仍保留候选 id 逐个试 + 宽松正文抽取（extractBodyHtml），接口改版时不至于全丢。
    async getNoticeDetail(classroomId: string, ids: string | string[]): Promise<YkNoticeDetail> {
      const list = (Array.isArray(ids) ? ids : [ids])
        .map((s) => String(s).trim())
        .filter(Boolean)
        .slice(0, 3);
      const shape: string[] = [];
      const uvHeader = (cred.uvId ?? "").trim() || "2598";
      const uniHeader = /(?:^|;\s*)university_id=([^;]*)/.exec(curCookie)?.[1]?.trim() || "2598";
      for (let i = 0; i < list.length; i++) {
        const id = list[i] as string;
        const csrf = ensureCsrf(curCookie);
        try {
          const res = await yktFetch(`${base}/v/discussion/v2/topic/${encodeURIComponent(id)}/?classroom_id=${encodeURIComponent(classroomId)}`, {
            method: "GET",
            headers: {
              Cookie: csrf.cookie,
              "User-Agent": UA,
              Accept: "application/json, text/plain, */*",
              "X-CSRFToken": csrf.token,
              "uv-id": uvHeader,
              "classroom-id": classroomId,
              "university-id": uniHeader,
              "Xt-Agent": "web",
              xtbz: "ykt",
              Referer: `${BASE}/v2/web/noticeView/${classroomId}/${id}?identity=0&type=9`,
            },
          });
          const text = await res.text();
          let body: Record<string, unknown>;
          try {
            body = JSON.parse(text) as Record<string, unknown>;
          } catch {
            shape.push(`topic#${i + 1}:http${res.status} 非JSON`);
            continue;
          }
          const outer = (body["data"] ?? {}) as Record<string, unknown>;
          // 双层 data：外层的 data.data 才是业务体（topic 在这里）
          const inner = (outer["data"] ?? outer) as Record<string, unknown>;
          const ok = body["success"] !== false && (body["code"] === undefined || body["code"] === 0);
          shape.push(
            `topic#${i + 1}:${ok ? "ok" : `fail(${String(body["error_code"] ?? body["code"] ?? body["msg"] ?? "?")})`}[${Object.keys(inner).slice(0, 12).join(",")}]`,
          );
          if (!ok) continue;
          const node = (inner["topic"] ?? inner["announcement"] ?? inner) as Record<string, unknown>;
          const rawBody = extractBodyHtml(node) ?? extractBodyHtml(inner);
          const urls: string[] = [];
          collectHttpUrls(node, urls);
          const images = [...new Set(urls.filter((u) => YKT_IMAGE_RE.test(u)))];
          const titleRaw = node["topic_name"] ?? node["title"] ?? node["name"];
          const title = typeof titleRaw === "string" && titleRaw.trim() ? titleRaw.trim() : undefined;
          if (rawBody || images.length > 0) {
            const bodyHtml = rawBody
              ? /<\/?[a-z][\s\S]*>/i.test(rawBody)
                ? rawBody
                : rawBody
                    .split(/\n+/)
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .map((line) => `<p>${line}</p>`)
                    .join("")
              : undefined;
            return {
              ...(title ? { title } : {}),
              ...(bodyHtml ? { bodyHtml } : {}),
              ...(images.length > 0 ? { images } : {}),
              shape,
            };
          }
        } catch (e) {
          shape.push(`pub_new_pro#${i + 1}:err(${(e instanceof Error ? e.message : String(e)).slice(0, 40)})`);
        }
      }
      return { shape };
    },
    async getExerciseDetail(leafTypeId: string, classroomId: string, uvId?: string): Promise<YkExerciseDetail> {
      // uvId 参数优先，回落凭据 uvId，再回落清华默认（与 fetch 链路同款兜底）
      const uvFinal = (uvId ?? "").trim() || uv;
      return fetchExerciseDetail(yktFetch, base, curCookie, uvFinal, classroomId, leafTypeId);
    },
    // 单条叶子内容详情（站内预览用）：GET /mooc-api/v1/lms/learn/leaf_info/{cid}/{leafId}/
    // ⚠️ 实测（2026-10-10，真连）：端点**要求 classroom_id 查询参数**——只给路径段会返回
    // `success=false / error_code=40000 / msg=CLASSROOM ID IS REQUIRED`，且 HTTP 仍是 200。
    // 补上 `term=latest&uv_id=…&classroom_id=…` 后 success=true。字段名不固定，因此按
    // 「字段名做诊断 + 按扩展名识别直链」的宽松口径解析，不硬编码某一种形态。
    async getLeafDetail(classroomId: string, leafId: string): Promise<YkLeafDetail> {
      const url =
        `${base}/mooc-api/v1/lms/learn/leaf_info/${encodeURIComponent(classroomId)}` +
        `/${encodeURIComponent(leafId)}/?term=latest&uv_id=${encodeURIComponent(uv)}` +
        `&classroom_id=${encodeURIComponent(classroomId)}`;
      const body = await getJson(yktFetch, url, curCookie, { XTBZ: "ykt" });
      const data = (body["data"] ?? {}) as Record<string, unknown>;
      const content = (data["content"] ?? {}) as Record<string, unknown>;
      const shape = [
        ...new Set([
          // 响应外层（success / data / errcode…）：data 为空时靠这些判断是不是信封问题
          ...Object.keys(body).map((k) => `body.${k}`),
          ...Object.keys(data),
          ...Object.keys(content).map((k) => `content.${k}`),
        ]),
      ].slice(0, 40);
      const urls: string[] = [];
      collectHttpUrls(data, urls);
      const mediaUrl = urls.find((u) => YKT_VIDEO_RE.test(u));
      const fileUrl = urls.find((u) => YKT_FILE_RE.test(u));
      const images = [...new Set(urls.filter((u) => YKT_IMAGE_RE.test(u)))];
      const leafType = toNum(data["leaf_type"] ?? content["leaf_type"]);
      const titleRaw = data["title"] ?? content["title"] ?? data["name"];
      const title = typeof titleRaw === "string" && titleRaw.trim() ? titleRaw.trim() : undefined;
      // 文章型正文：优先 content.body / body_html 一类字段（含标签才算正文）
      const bodyCandidates = [content["body"], content["body_html"], content["content"], data["body"]];
      const bodyHtml = bodyCandidates.find(
        (v): v is string => typeof v === "string" && /<\/?[a-z][\s\S]*>/i.test(v),
      );
      return {
        ...(leafType === undefined ? {} : { leafType }),
        ...(title ? { title } : {}),
        ...(fileUrl ? { fileUrl } : {}),
        ...(mediaUrl ? { mediaUrl } : {}),
        ...(images.length > 0 ? { images } : {}),
        ...(bodyHtml ? { bodyHtml } : {}),
        shape,
      };
    },
    async submitYktProblemSubjective(opts: YktSubmitSubjectiveOptions): Promise<YktSubmitResult> {
      // curCookie 是可变会话串（Set-Cookie 轮换回写），每次取当前值；CSRF 双提交在 impl 内做
      return submitYktProblemSubjectiveImpl(yktFetch, base, curCookie, opts);
    },
    async uploadExerciseInlineImage(opts: YktInlineImageUploadOptions): Promise<{ fileUrl: string }> {
      // Cookie 只用于 ① token GET；② OSS POST 不带 Cookie（跨域凭据不外泄，OSS 也不需要）
      return uploadExerciseInlineImageImpl(yktFetch, base, curCookie, opts);
    },
  };
}

/* ── R21-B：Cookie 导出 / 导入（多设备迁移缓解） ──
 * 侦查结论：会话无法在服务端续期 → 每台设备都要各自登录一次。缓解：在一台设备登录后
 * 把 Cookie 导出成文件，其余设备导入即用（免挨个扫码/重登）。
 * ⚠️ 导出文件 = 完整登录凭据：文件内自带 sensitive/warn 标注；UI 提醒勿放同步盘/群聊，
 * 用完即删。全程不打印 Cookie 内容，不进日志。 */

/** 导出文件 kind（导入时强校验，防拿错文件） */
export const YKT_COOKIE_EXPORT_KIND = "onethu.yuketang.session";

/** 导出文件结构（v1）。cookie 为完整可用会话串；uvId/phone 可选回填。 */
export interface YktCookieExport {
  kind: typeof YKT_COOKIE_EXPORT_KIND;
  version: 1;
  /** 恒 true：标记本文件含登录凭据 */
  sensitive: true;
  /** 人读警示（写入文件，脱离 UI 也在） */
  warn: string;
  /** ISO 时间 */
  exportedAt: string;
  cookie: string;
  uvId?: string;
  phone?: string;
}

/** 构建导出 JSON 文本。cookie 必须含 sessionid=（否则拒绝导出，防止导出无用文件）。 */
export function buildYktCookieExportJson(cred: { cookie: string; uvId?: string; phone?: string }, now = new Date()): string {
  const cookie = (cred.cookie ?? "").trim();
  if (!/(?:^|;\s*)sessionid=[^\s;]+/.test(cookie)) {
    throw new Error("雨课堂 Cookie 缺少 sessionid，不像有效会话——请先登录再导出");
  }
  const out: YktCookieExport = {
    kind: YKT_COOKIE_EXPORT_KIND,
    version: 1,
    sensitive: true,
    warn: "本文件含雨课堂完整登录会话，等同账号凭据：仅供本人多设备迁移使用，勿放同步盘/群聊/仓库，导入后请删除。",
    exportedAt: now.toISOString(),
    cookie,
    ...(cred.uvId?.trim() ? { uvId: cred.uvId.trim() } : {}),
    ...(cred.phone?.trim() ? { phone: cred.phone.trim() } : {}),
  };
  return JSON.stringify(out, null, 2);
}

/** 解析并校验导出文件文本 → 可直接存进凭据的会话。任何不符都抛带原因的错误。 */
export function parseYktCookieExportJson(text: string): { cookie: string; uvId?: string; phone?: string } {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error("导入失败：不是合法 JSON 文件");
  }
  const o = (j ?? {}) as Record<string, unknown>;
  if (o["kind"] !== YKT_COOKIE_EXPORT_KIND) {
    throw new Error("导入失败：文件类型不符（这不是 OneTHU 导出的雨课堂会话文件）");
  }
  if (o["version"] !== 1) {
    throw new Error("导入失败：文件版本不识别");
  }
  const cookie = typeof o["cookie"] === "string" ? o["cookie"].trim() : "";
  if (!/(?:^|;\s*)sessionid=[^\s;]+/.test(cookie)) {
    throw new Error("导入失败：文件里没有有效的 sessionid（会话串不完整）");
  }
  const uvId = typeof o["uvId"] === "string" && o["uvId"].trim() ? o["uvId"].trim() : undefined;
  const phone = typeof o["phone"] === "string" && o["phone"].trim() ? o["phone"].trim() : undefined;
  return { cookie, ...(uvId ? { uvId } : {}), ...(phone ? { phone } : {}) };
}
