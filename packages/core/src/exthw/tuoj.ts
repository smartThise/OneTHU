/**
 * TUOJ 系（AI 版 / 经典版）只读客户端。
 *
 * 实测（2026-09-18）：
 * - 课程 GET /api/course/list → courses[].{_id, title}
 * - 本课作业 GET /api/course/{cid}/rank → courseRank.contests[].{_id, title}
 * - 作业详情 GET /api/course/{cid}/contest/{tid}/context → { context: { metadata, schedule, status } }
 * ⚠️ metadata / schedule / status **嵌在 context 下**（不是顶层）
 * - DDL = context.schedule.effectiveEndAt || context.schedule.endAt（**毫秒**）
 * - 会话失效 → HTTP 401/403
 *
 * R15 20.1：经典 TUOJ（oj.cs.tsinghua.edu.cn）与 AI 版**同一套代码**，接口行为一致，
 * 故本客户端按 `base` / `id` / `name` 参数化复用（CAS 漫游入口见 tuojCas.ts）。
 * ⚠️ 服务端地址在各自源的组装处指定，凭据不再携带 base。
 *
 * 会话来源（二选一，均由调用方注入）：
 * - 显式 Cookie 串（账号密码登录 / 手动粘贴）→ 直接塞 `Cookie:` 头；
 * - 带 CookieJar 的 HttpClient（`createExternalSources` 传 `http`）→ 走 jar，
 *   清华统一认证漫游（tuojCas.ts）建立的会话自动随请求携带。
 */
import type { FetchLike } from "../http.js";
import type { ExtHwSourceId, ExternalHomework, HomeworkSource } from "./types.js";

export const BASE = "https://ai.tuoj.thusaac.com";
/** 经典 TUOJ（R15 20.1；与 AI 版同代码，仅 base / CAS 回调不同） */
export const CLASSIC_BASE = "https://oj.cs.tsinghua.edu.cn";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.88 Safari/537.36";

/** TUOJ 会话失效（HTTP 401/403）。R12 17.1：调用方据此触发**一次**强制重漫游后重试。
 *  类型化（而非只比字符串）让自动重漫游判定与文案解耦。 */
export class TuojSessionError extends Error {
  readonly httpStatus: number;
  /** detail：非 401/403 的失效形态（200+非 JSON / 302 登录页 HTML）给专用文案 */
  constructor(status: number, detail?: string) {
    super(detail ?? `TUOJ 会话已失效（HTTP ${status}），请在设置页更新 Cookie`);
    this.name = "TuojSessionError";
    this.httpStatus = status;
  }
}

/** 是否为 TUOJ 会话失效错误（R12 17.1 自动重漫游的唯一触发条件） */
export function isTuojSessionError(e: unknown): e is TuojSessionError {
  return e instanceof TuojSessionError;
}

interface TuojCred {
  /** 显式会话 Cookie 串；CAS 漫游模式传空串（会话由 HttpClient 的 jar 提供） */
  cookie: string;
  /** 登录用户名（学号）；仅当 `POST /api/user/lookup` 不可用时作为匹配回退 */
  username?: string;
}

/** R15 20.2：TUOJ 系客户端参数（经典版复用同一实现） */
export interface TuojSourceConfig {
  /** 服务端 base；缺省 AI 版 `BASE` */
  base?: string;
  /** 源 id；缺省 `"tuoj"`（经典版传 `"tuojClassic"`） */
  id?: ExtHwSourceId;
  /** 展示名；缺省 `"TUOJ"`（组装层传 `SOURCE_NAMES[id]`，此处保持仅 type-only 依赖，
   *  以便 tools/*.mjs 直引本文件） */
  name?: string;
}

/** 毫秒时间戳 → "YYYY-MM-DD HH:MM"（本地时区） */
function fmtLocal(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function getJson(fetchLike: FetchLike, url: string, cookie: string): Promise<Record<string, unknown>> {
  return requestJson(fetchLike, url, cookie, "GET");
}

/** POST 空体请求（`/api/user/lookup` 取当前用户；TUOJ 侧不用 GET 该接口） */
async function postJson(fetchLike: FetchLike, url: string, cookie: string): Promise<Record<string, unknown>> {
  return requestJson(fetchLike, url, cookie, "POST");
}

async function requestJson(
  fetchLike: FetchLike,
  url: string,
  cookie: string,
  method: "GET" | "POST",
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "application/json, text/plain, */*",
  };
  // cookie 为空（CAS 漫游模式：会话在 HttpClient 的 jar 里）时不设 Cookie 头，
  // 否则会覆盖掉 HttpClient 自动带上的 jar 会话。
  if (cookie) headers["Cookie"] = cookie;
  if (method === "POST") headers["Content-Type"] = "application/json";
  const res = await fetchLike(url, { method, headers, body: method === "POST" ? "" : undefined });
  if (res.status === 401 || res.status === 403) {
    throw new TuojSessionError(res.status);
  }
  const body = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    // R23（霖实测：过一夜会话失效但不再抛 401/403）：会话老化时 TUOJ 常返回
    // 200 + 登录页 HTML / 非 JSON——此前抛普通 Error，自动重漫游判定不命中，
    // 用户只能手动退出重登。归一为 TuojSessionError 让 reroute 通道接手。
    throw new TuojSessionError(200, "TUOJ 返回非 JSON（会话可能已失效），请重新登录");
  }
  return (json ?? {}) as Record<string, unknown>;
}

/** 当前登录用户（`POST /api/user/lookup`，无 body）→ {_id, username}；失败返回 null（不抛） */
async function lookupMe(
  fetchLike: FetchLike,
  base: string,
  cookie: string,
): Promise<{ id: unknown; username: string | undefined } | null> {
  try {
    const body = await postJson(fetchLike, `${base}/api/user/lookup`, cookie);
    const user = (body["user"] ?? {}) as Record<string, unknown>;
    if (user["_id"] === undefined && typeof user["username"] !== "string") return null;
    return { id: user["_id"], username: typeof user["username"] === "string" ? user["username"] : undefined };
  } catch {
    return null;
  }
}

/** 查单个作业（contest）是否已提交：ranklist 里找到自己且 details 非空 → 已提交 */
async function fetchTuojStatus(
  fetchLike: FetchLike,
  base: string,
  cookie: string,
  cid: unknown,
  tid: unknown,
  me: { id: unknown; username: string | undefined } | null,
  fallbackUsername: string | undefined,
): Promise<{ submitted: boolean; submittedCount?: number; totalCount?: number }> {
  const rl = await getJson(fetchLike, `${base}/api/course/${cid}/contest/${tid}/ranklist`, cookie);
  const ranklist = (rl["ranklist"] ?? {}) as Record<string, unknown>;
  const players = Array.isArray(ranklist["players"])
    ? (ranklist["players"] as Array<Record<string, unknown>>)
    : [];
  const wantedUser = me?.username ?? fallbackUsername;
  const player = players.find((p) => {
    if (me && me.id !== undefined && me.id !== null && p["_id"] === me.id) return true;
    return Boolean(wantedUser && p["username"] === wantedUser);
  });
  if (!player) return { submitted: false };
  const details = (player["details"] ?? {}) as Record<string, unknown>;
  const keys = Object.keys(details);
  return { submitted: keys.length > 0, submittedCount: keys.length > 0 ? keys.length : undefined };
}

export function createTuojSource(
  cred: TuojCred,
  fetchLike: FetchLike,
  days: number,
  config: TuojSourceConfig = {},
): HomeworkSource {
  const base = config.base ?? BASE;
  const id = config.id ?? "tuoj";
  const name = config.name ?? "TUOJ";
  const cookie = (cred.cookie ?? "").trim();
  const fallbackUsername = (cred.username ?? "").trim() || undefined;
  return {
    id,
    name,
    async fetch(): Promise<ExternalHomework[]> {
      const courseBody = await getJson(fetchLike, `${base}/api/course/list`, cookie);
      const courses = Array.isArray(courseBody["courses"])
        ? (courseBody["courses"] as Array<Record<string, unknown>>)
        : [];
      // 当前用户（用于在 ranklist 里定位自己）；失败不阻断，回退到凭据里的用户名
      const me = await lookupMe(fetchLike, base, cookie);
      const limit = Date.now() + (days > 0 ? days : 30) * 86400000;
      const out: ExternalHomework[] = [];
      for (const c of courses) {
        const cid = c["_id"];
        if (cid === undefined || cid === null) continue;
        const courseName = String(c["title"] ?? "TUOJ 课程");
        // 逐课程隔离：单门课失败只跳过
        try {
          const rank = await getJson(fetchLike, `${base}/api/course/${cid}/rank`, cookie);
          const courseRank = (rank["courseRank"] ?? {}) as Record<string, unknown>;
          const contests = Array.isArray(courseRank["contests"])
            ? (courseRank["contests"] as Array<Record<string, unknown>>)
            : [];
          for (const ct of contests) {
            const tid = ct["_id"];
            if (tid === undefined || tid === null) continue;
            try {
              const ctxBody = await getJson(
                fetchLike,
                `${base}/api/course/${cid}/contest/${tid}/context`,
                cookie,
              );
              // context 既可能顶层（实测），也可能在 data 下——两处都兜底
              const dataWrap = (ctxBody["data"] ?? {}) as Record<string, unknown>;
              const context = (ctxBody["context"] ?? dataWrap["context"] ?? {}) as Record<string, unknown>;
              const metadata = (context["metadata"] ?? {}) as Record<string, unknown>;
              const schedule = (context["schedule"] ?? {}) as Record<string, unknown>;
              const msRaw = schedule["effectiveEndAt"] ?? schedule["endAt"];
              if (typeof msRaw !== "number" || !Number.isFinite(msRaw)) continue;
              if (msRaw > limit) continue;
              // 提交状态（仅对时间窗内的 contest 查，省请求）；失败只跳过（保守 false）
              let status: { submitted: boolean; submittedCount?: number; totalCount?: number } = {
                submitted: false,
              };
              try {
                status = await fetchTuojStatus(fetchLike, base, cookie, cid, tid, me, fallbackUsername);
              } catch {
                /* 状态查询失败：保守保持未提交 */
              }
              const hw: ExternalHomework = {
                id: `${id}-${cid}-${tid}`,
                source: id,
                courseName,
                title: String(metadata["title"] ?? ct["title"] ?? "作业"),
                deadline: fmtLocal(msRaw),
                kind: "homework",
                url: `${base}/course/${cid}/contest/${tid}/home`,
                submitted: status.submitted,
              };
              if (status.submittedCount !== undefined) hw.submittedCount = status.submittedCount;
              if (status.totalCount !== undefined) hw.totalCount = status.totalCount;
              out.push(hw);
            } catch {
              /* 单个 contest 失败跳过 */
            }
          }
        } catch {
          /* 单门课失败跳过 */
        }
      }
      return out;
    },
  };
}
