/**
 * 荷塘雨课堂 —— 微信 / 雨豆APP 扫码登录（只读登录，用于拿会话 Cookie）。
 *
 * 实测链路（2026-09-18，官网同款）：
 * 1. `GET /api/v3/user/login/app-web-pre-info`
 *    → `{code:0,data:{qrContent, qrImage:"", token}}`
 *    - `qrContent` 就是要编码进二维码的文本（官网用 `toDataURL(qrContent)` 出图）
 *    - `token` 是 JWT，**约 5 分钟过期**（exp-iat = 300s），过期后二维码作废需重取
 * 2. `POST /api/v3/user/login/app-web-login`，body `{"token":"<上面的 token>"}`
 *    - **长轮询**：未扫码时服务端一直挂着（不返回）；扫码确认后返回 `{code:0,data:…}`
 *      并 Set-Cookie 会话
 *    - 官网前端 30 秒节流重取二维码、过期自动刷新 —— 本模块同样自动重建
 *
 * 会话 Cookie 取回复用 `login.ts` 的 `captureCookies`（传输层自定义头
 * `x-onethu-set-cookie`，回退 `x-onethu-set-cookie-hops` 取 `l`），
 * 成功后沿用 `yuketangBuildCookie` 补齐清华固定字段。
 *
 * ⚠️ 浏览器预览读不到 Set-Cookie → 扫码登录只在桌面端（Tauri）可用（与短信登录一致）。
 * ⚠️ 二维码内容 / token **绝不写日志**。
 */
import type { FetchLike } from "../http.js";
import { captureCookies, yuketangBuildCookie } from "./login.js";

const YKT_BASE = "https://pro.yuketang.cn";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.88 Safari/537.36";

/** 单次长轮询默认超时（服务端未扫码时会挂住，到点主动放弃并重发） */
const DEFAULT_POLL_TIMEOUT_MS = 28_000;
/** token 解不出 exp 时的兜底有效期 */
const FALLBACK_TTL_MS = 300_000;

/* ── JWT exp 解析（base64url，不依赖 Buffer / atob 的可用性） ── */

const B64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function b64urlToString(s: string): string {
  const lookup = new Map<string, number>();
  for (let i = 0; i < B64URL_ALPHABET.length; i++) lookup.set(B64URL_ALPHABET[i]!, i);
  let bits = 0;
  let val = 0;
  const bytes: number[] = [];
  for (const ch of s.replace(/=+$/, "")) {
    const v = lookup.get(ch);
    if (v === undefined) continue;
    val = (val << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((val >> bits) & 0xff);
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** 从 JWT 取 exp（毫秒）；失败返回 null */
function jwtExpMs(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(b64urlToString(payload)) as { exp?: unknown };
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

/* ── 类型 ── */

/** 二维码会话信息 */
export interface YktQrStart {
  /** 要编码进二维码的文本（官网 `toDataURL(qrContent)` 同源） */
  qrContent: string;
  /** 长轮询用的一次性 token */
  token: string;
  /** token 过期时刻（毫秒时间戳）；到点后二维码作废需重取 */
  expireAt: number;
}

/** 单次长轮询结果 */
export interface YktQrPollResult {
  /** 服务端已确认登录（`code===0`） */
  done: boolean;
  /** 成功后拼好的会话 Cookie 串（浏览器预览可能缺失） */
  cookie?: string;
  /** 服务端下发的网页换票凭据：用于以后免扫码调用 /pc/web_login。
   *  旧账号的官方 app-web-login 可能只给 cookie；此时保持 undefined，仍可正常使用。 */
  userId?: string;
  auth?: string;
  /** 失败 / 未完成原因（中文） */
  message?: string;
  /** 因调用方 AbortSignal 主动取消 */
  aborted?: boolean;
  /** 因单次长轮询超时结束（未扫码，属正常，调用方应重发） */
  timedOut?: boolean;
}

/** 编排过程中向 UI 推送的阶段 */
export type YktQrPhase =
  | { phase: "qr"; qrContent: string; expireAt: number }
  | { phase: "expired" };

/* ── ① 取二维码 ── */

export async function yuketangQrStart(fetchLike: FetchLike, opts: { signal?: AbortSignal } = {}): Promise<YktQrStart> {
  const res = await fetchLike(`${YKT_BASE}/api/v3/user/login/app-web-pre-info`, {
    method: "GET",
    headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*", Referer: `${YKT_BASE}/` },
    signal: opts.signal,
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = null;
  }
  const data = (json?.["data"] ?? null) as Record<string, unknown> | null;
  const qrContent = data?.["qrContent"];
  const token = data?.["token"];
  if (typeof qrContent !== "string" || !qrContent || typeof token !== "string" || !token) {
    const msg = typeof json?.["msg"] === "string" && json["msg"] ? json["msg"] : "响应异常";
    throw new Error(`雨课堂二维码获取失败（HTTP ${res.status}）：${msg}`);
  }
  // exp 来自服务端时钟，可能与本地有偏差；用本地 5 分钟兜底封顶，避免过度超期轮询
  const expMs = jwtExpMs(token);
  const expireAt = expMs === null ? Date.now() + FALLBACK_TTL_MS : Math.min(expMs, Date.now() + FALLBACK_TTL_MS);
  return { qrContent, token, expireAt };
}

/* ── ② 长轮询（支持 AbortSignal / 超时） ── */

export async function yuketangQrPoll(
  fetchLike: FetchLike,
  token: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<YktQrPollResult> {
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : DEFAULT_POLL_TIMEOUT_MS;
  const external = opts.signal;
  if (external?.aborted) return { done: false, aborted: true, message: "已取消" };

  const ctrl = new AbortController();
  let timedOut = false;
  let aborted = false;
  const onAbort = (): void => {
    aborted = true;
    ctrl.abort();
  };
  external?.addEventListener("abort", onAbort, { once: true });
  const timer = timeoutMs > 0 ? setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs) : null;

  try {
    // R17 23.1：传输层超时必须晚于本地轮询计时（+10s），否则 tauriFetch/Rust
    // 的 http_request 会先于 AbortSignal 抢跑，把「未扫码」误报成硬错误退出。
    // 本地计时到点 → ctrl.abort() → tauriFetch 的 signal 立即 reject → timedOut 重发。
    const init: RequestInit & { timeoutMs?: number } = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": UA,
        Accept: "application/json, text/plain, */*",
        Referer: `${YKT_BASE}/`,
      },
      body: JSON.stringify({ token }),
      signal: ctrl.signal,
      timeoutMs: timeoutMs + 10_000,
    };
    const res = await fetchLike(`${YKT_BASE}/api/v3/user/login/app-web-login`, init);
    const pairs = captureCookies(res);
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = null;
    }
    const code = json?.["code"];
    const msg = typeof json?.["msg"] === "string" && json["msg"] ? json["msg"] : undefined;
    // 官方网页登录在扫码确认后还会用 data.UserID + data.Auth 调 /pc/web_login 换网页会话；
    // 只存 cookie 会让会话过期后永远回到扫码。这里把服务端下发的换票凭据一并带出。
    const data = (json?.["data"] ?? null) as Record<string, unknown> | null;
    const rawUserId = data?.["UserID"] ?? data?.["user_id"];
    const rawAuth = data?.["Auth"] ?? data?.["auth"];
    const userId =
      typeof rawUserId === "string" || typeof rawUserId === "number" ? String(rawUserId) : undefined;
    const auth = typeof rawAuth === "string" && rawAuth.trim() ? rawAuth.trim() : undefined;
    if (pairs.size > 0 && (code === undefined || code === 0)) {
      return {
        done: true,
        cookie: yuketangBuildCookie(pairs),
        ...(userId ? { userId } : {}),
        ...(auth ? { auth } : {}),
      };
    }
    if (code === 0) {
      // 服务端已确认登录，但传输层未透出 Set-Cookie（浏览器预览的必然结果）
      return {
        done: true,
        message: "登录已确认，但未取回会话 Cookie：浏览器预览读不到 Set-Cookie，请在桌面端（Tauri）使用。",
      };
    }
    return { done: false, message: msg ?? `登录未完成（code=${String(code ?? res.status)}）` };
  } catch (e) {
    if (aborted) return { done: false, aborted: true, message: "已取消" };
    if (timedOut) return { done: false, timedOut: true, message: "等待扫码超时" };
    // R17b 24.1：长轮询的**传输层错误**（connection aborted / reset / operation timed out /
    // network error 等，即任何非 HTTP 响应类错误）一律按「未扫码超时」处理 →
    // 状态机用**同一 token** 继续轮询，直到二维码过期（~5min）或被取消。
    // 真机根因：App 退后台被 MIUI 冻结/掐断网络 → reqwest 抛 `connection aborted`，
    // 旧逻辑当硬错误退出 → 扫码作废。这里不再因一次连接中断就退出。
    // HTTP 层错误（4xx/5xx、code!=0）不会抛异常，走上面的正常返回，语义保持不变（不吞）。
    // 原始错误串保留在 message 里（仅诊断用；timedOut 路径 UI 不展示）。
    const message = e instanceof Error ? e.message : String(e);
    return { done: false, timedOut: true, message };
  } finally {
    if (timer) clearTimeout(timer);
    external?.removeEventListener("abort", onAbort);
  }
}

/* ── ②′ 官方网页登录（WebView）通道：Cookie 原文 → 凭据串 ── */

/**
 * R18 24.2：把应用内 WebView / 原生 `CookieManager` 取回的 Cookie 原文
 * （`name=value; name2=value2`，即 `document.cookie` 或 `CookieManager.getCookie()` 的格式）
 * 解析为 `name→value`，再经 {@link yuketangBuildCookie} 补齐清华固定字段，
 * 得到可直接用于拉取的 `Cookie:` 串（与扫码 / 短信登录同一出口）。
 *
 * 空原文返回空串——调用方据此判定「未取到会话」并回退「高级：手动粘贴 Cookie」。
 */
export function yuketangCookieFromHeader(raw: string): string {
  const pairs = new Map<string, string>();
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) pairs.set(name, value);
  }
  if (pairs.size === 0) return "";
  return yuketangBuildCookie(pairs);
}

/* ── ③ 编排（状态机）：取码 → 长轮询 → 超时重发 → 过期重建 → 成功/取消 ── */

export interface RunYuketangQrLoginDeps {
  fetchLike: FetchLike;
  /** 取消信号（组件卸载 / 点取消 → abort） */
  signal?: AbortSignal;
  /** 单次长轮询超时（默认 28s） */
  pollTimeoutMs?: number;
  /** 时钟注入（测试用；默认 Date.now） */
  now?: () => number;
  /** 阶段回调：二维码就绪 / 已过期（即将重建） */
  onPhase?: (p: YktQrPhase) => void;
}

/**
 * 扫码登录状态机：循环「取二维码 → 在有效期内长轮询（超时自动重发）→ 过期重建」，
 * 直到成功（返回 cookie）、被取消（aborted）或服务端明确报错。
 */
export async function runYuketangQrLogin(deps: RunYuketangQrLoginDeps): Promise<YktQrPollResult> {
  const now = deps.now ?? Date.now;
  const pollTimeoutMs = deps.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const signal = deps.signal;

  for (;;) {
    if (signal?.aborted) return { done: false, aborted: true, message: "已取消" };
    let info: YktQrStart;
    try {
      info = await yuketangQrStart(deps.fetchLike, { signal });
    } catch (e) {
      if (signal?.aborted) return { done: false, aborted: true, message: "已取消" };
      return { done: false, message: e instanceof Error ? e.message : String(e) };
    }
    if (signal?.aborted) return { done: false, aborted: true, message: "已取消" };
    deps.onPhase?.({ phase: "qr", qrContent: info.qrContent, expireAt: info.expireAt });

    // 在二维码有效期内持续长轮询；单次超时 / 传输层连接被掐（R17b 24.1）后
    // 自动重发（**同一 token**，二维码不变），直到过期重建。
    while (now() < info.expireAt) {
      const r = await yuketangQrPoll(deps.fetchLike, info.token, { signal, timeoutMs: pollTimeoutMs });
      if (r.aborted) return r;
      if (r.done) return r;
      if (!r.timedOut) return r; // 服务端明确返回未完成 / 错误
    }
    if (signal?.aborted) return { done: false, aborted: true, message: "已取消" };
    deps.onPhase?.({ phase: "expired" }); // 二维码过期 → 外层重建
  }
}
