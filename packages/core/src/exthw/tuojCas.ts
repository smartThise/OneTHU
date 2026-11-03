/**
 * TUOJ 走**清华统一身份认证（CAS 漫游）**——用户无需输入任何 TUOJ 凭据。
 *
 * 实测链路（2026-09-18）：
 * 1. `GET https://ai.tuoj.thusaac.com/api/user/oauth/info`（无需登录）返回
 *    `{ tsinghua: { enable: true, url: "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/<appid>/0?/api/user/tsinghua/roaming/AI-TUOJ" } }`
 *    —— 该 url 就是 CAS 漫游表单地址（app id = 929e496594c7a63203fb03e457a43c6b，
 *    漫游回调 = `https://ai.tuoj.thusaac.com/api/user/tsinghua/roaming/AI-TUOJ`）。
 * 2. 带**已有的 id.tsinghua.edu.cn 会话**（HttpClient 的 CookieJar 里就有，与 learn/info
 *    漫游同一套机制）GET 该表单地址：会话有效时 CAS 直接发票并 302 到 TUOJ 漫游回调，
 *    HttpClient 逐跳跟随重定向、把每一跳的 Set-Cookie 记入 jar → TUOJ 会话 cookie 落罐。
 *    无有效会话时 CAS 返回登录表单页（`id="sm2publicKey"`）→ 抛可读错误，由上层回退账号密码。
 * 3. 校验：`GET /api/course/list` 成功即视为登录完成。
 *
 * ⚠️ 本模块只做**只读**漫游（不提交任何 TUOJ 业务数据）；凭据（清华账密）不经过本模块。
 * R15 20.1：经典 TUOJ（oj.cs.tsinghua.edu.cn）同套代码，仅 oauth/info 返回的漫游回调不同
 * （经典版 `.../api/user/tsinghua/login`）；漫游 url 本就取自服务端响应，故只需传 `deps.base`。
 */
import type { HttpClient } from "../http.js";
import { BASE as TUOJ_BASE } from "./tuoj.js";

/** 统一认证漫游失败（UI 据此提示「需先登录清华统一认证」并回退账号密码） */
export class TuojCasError extends Error {
  /** 服务端页面片段，供诊断 */
  detail?: string;
  /** 失败阶段（R11 16.2）：`cas` = 统一认证未通过；`courses` = 已过统一认证但
   *  课程列表校验失败（可能已登录但未注册/未选课）。自动登录据此区分「无账号」。 */
  stage?: "cas" | "courses";
  /** 课程列表校验失败时的 HTTP 状态（stage === "courses" 时有值） */
  httpStatus?: number;
  constructor(
    message: string,
    detail?: string,
    opts?: { stage?: "cas" | "courses"; httpStatus?: number },
  ) {
    super(message);
    this.name = "TuojCasError";
    this.detail = detail;
    this.stage = opts?.stage;
    this.httpStatus = opts?.httpStatus;
  }
}

/** 是否为「统一认证已通过、但 TUOJ 未返回课程」——课程列表 401/403（R11 16.2：
 *  可能未注册 / 未选课，不算错误）。自动登录据此走「无账号」提示而非失败。 */
export function isTuojNoCoursesError(e: unknown): boolean {
  return (
    e instanceof TuojCasError &&
    e.stage === "courses" &&
    (e.httpStatus === 401 || e.httpStatus === 403)
  );
}

export interface TuojRoamResult {
  /** 漫游后 jar 里的 TUOJ 会话 Cookie 串（供持久化 / 备选路径复用） */
  cookie: string;
  /** 漫游后可见的课程数（校验用） */
  courseCount: number;
}

export interface TuojRoamDeps {
  /** R15 20.2：TUOJ 系 base（缺省 AI 版）；CAS url 仍取服务端 `oauth/info` 响应，
   *  故经典版无需额外分支。 */
  base?: string;
  /** 「确保直连 id 会话」前置（方案 A）：无直连统一认证会话时按账密直登 id
   *  （桌面端注入 `InfoClient.ensureDirectIdLogin`，凭据来自 CampusSession，零用户输入）。
   *  返回 true = id 直连会话已建立，tuojRoam 会重走漫游表单。缺省时只走方案 B 文案。 */
  ensureIdSession?: (casFormUrl: string) => Promise<boolean>;
  /** 内存中是否有可用于自动直登 id 的清华凭据（R10：区分「无凭据」与「直登失败」文案）。
   *  缺省视为有（不改变旧调用方的文案分支）。 */
  hasIdCredentials?: () => boolean;
  /** checkSingle 指纹确认页取票 + 兑付（R10：会话活着时的第三形态）。
   *  桌面端注入 `InfoClient.confirmIdCheckSingle`；缺省时不走该修复。 */
  confirmIdCheckSingle?: (formUrl: string) => Promise<boolean>;
}

/** CAS「登录成功 / 自动跳转」中间页里的回调锚点（demoLogin.casServiceLogin 同款写法） */
export function extractTicketAnchor(html: string): string | null {
  return /<a[^>]+href="([^"]+)"/i.exec(html)?.[1] ?? null;
}

/** 是否 CAS 登录表单页（= 当前没有有效统一认证会话） */
export function isCasLoginPage(html: string): boolean {
  return /id="sm2publicKey"/.test(html) || /name="i_pass"/.test(html);
}

/** 是否 CAS **checkSingle 指纹确认页**（R10）：id 会话活着、不再要密码，只 POST 指纹
 *  确认继续。URL 仍停在 `/do/off/ui/auth/login/form/<uuid>`，此前被误判成「仍是登录页」
 *  → 白登入（15.1）。 */
export function isCheckSinglePage(html: string): boolean {
  return /checkSingle/.test(html);
}

/** CAS 中间页（密码登录页 / checkSingle 确认页）；URL 停在 form 路径也算。
 *  三形态：`name="sm2publicKey"` | `name="i_pass"` | `checkSingle`（15.1-4）。 */
function isCasInterstitial(html: string, finalUrl: string): boolean {
  return (
    isCasLoginPage(html) ||
    /name="sm2publicKey"/.test(html) ||
    isCheckSinglePage(html) ||
    /\/do\/off\/ui\/auth\/login\/form\//.test(finalUrl)
  );
}

/** CAS 漫游失败文案（R10 15.1-2）：按「无凭据 / 直登失败 / 直连成功但校验失败」分支，
 *  杜绝旧版 ensureTried 一刀切「直连会话建立后仍未通过」的误导。
 *  R17 23.3：直登触发二次认证（2FA）时优先给出可操作文案，不再只说「详情见诊断日志」。 */
export function tuojCasFailMessage(opts: {
  ensureTried: boolean;
  ensureOk: boolean;
  hasCreds: boolean;
  /** 底层账密直登 id 触发二次认证（2FA）——需用户重新登录并信任设备 */
  twoFactor?: boolean;
}): string {
  if (opts.twoFactor) {
    return "TUOJ：需要二次认证：请在 OneTHU 里重新登录清华账号并勾选「信任此设备」后重试（建立设备信任后会自动重试一次 TUOJ 统一认证）。";
  }
  const tail = "请在 OneTHU 重新登录清华账号（重新输入密码）后重试，或改用「TUOJ 账号密码登录」。";
  if (opts.ensureOk) {
    return `TUOJ：需先登录清华统一认证（直连会话已建立但 CAS 校验未通过，详情见诊断日志）。${tail}`;
  }
  if (!opts.ensureTried) {
    return `TUOJ：需先登录清华统一认证（未检测到有效的统一认证会话）。${tail}`;
  }
  if (!opts.hasCreds) {
    return `TUOJ：需先登录清华统一认证（OneTHU 内存中没有清华密码——重启恢复/未记住密码，无法自动建立直连会话）。${tail}`;
  }
  return `TUOJ：需先登录清华统一认证（自动登录清华统一认证未成功，详情见诊断日志）。${tail}`;
}

/** R17 23.3：底层错误是否为「触发二次认证」（id 端 2FA / 双因素）。 */
export function isTwoFactorError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /二次认证|双因素|二次验证|双因子/.test(msg);
}

/** jar 里某域当前的 Cookie 串（无则空串） */
function jarCookieString(http: HttpClient, url: string): string {
  try {
    return http.jar
      .getCookies(new URL(url))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  } catch {
    return "";
  }
}

/** id 直连桶 cookie **名单**（只取 name，绝不外泄 value；诊断 12.1-1 用） */
function idCookieNames(http: HttpClient): string {
  try {
    const names = http.jar
      .getCookies(new URL("https://id.tsinghua.edu.cn/"))
      .map((c) => c.name)
      .filter(Boolean);
    return names.length ? names.join(",") : "(none)";
  } catch {
    return "(jar-error)";
  }
}

/** 失败路径诊断（复用 HttpClient debug 通道 → 桌面端 /tmp/onethu-debug.log）。
 *  只打 cookie 名单与页面特征，绝不含 cookie 值 / 账密。 */
function emitCasDiag(http: HttpClient, phase: string, body: string, finalUrl: string): string {
  const feats =
    [
      isCasLoginPage(body) ? "cas-login-page" : "",
      /sm2publicKey/.test(body) ? "sm2publicKey" : "",
      /name="i_pass"/.test(body) ? "i_pass" : "",
      isCheckSinglePage(body) ? "checkSingle" : "",
    ]
      .filter(Boolean)
      .join("+") || "none";
  const line =
    `[TUOJ-CAS] ${phase} final=${finalUrl.slice(0, 160)} ` +
    `idCookies=${idCookieNames(http)} lastCookieNames=${http.lastCookieNames || "(none)"} ` +
    `feats=${feats} body=${body.slice(0, 160).replace(/\s+/g, " ")}`;
  http.debug?.(line);
  return line;
}

/** TUOJ 是公网域，一律直连（绝不 WebVPN 包装）；用 HttpClient.request 以复用 CookieJar */
const JSON_HEADERS = { Accept: "application/json, text/plain, */*" } as const;

/**
 * 走清华统一认证漫游登录 TUOJ（零用户凭据）。
 * 成功返回 jar 里的 TUOJ 会话串；失败抛 `TuojCasError`（消息可直接展示给用户）。
 */
export async function tuojRoam(http: HttpClient, deps: TuojRoamDeps = {}): Promise<TuojRoamResult> {
  const base = deps.base ?? TUOJ_BASE;
  http.debug?.(`[TUOJ-CAS] start base=${base}`);
  // ① 问 TUOJ 要 CAS 漫游入口
  const infoRes = await http.request(`${base}/api/user/oauth/info`, {
    direct: true,
    headers: { ...JSON_HEADERS },
  });
  const infoBody = await infoRes.text();
  let info: { tsinghua?: { enable?: boolean; url?: string } } | null = null;
  try {
    info = JSON.parse(infoBody) as { tsinghua?: { enable?: boolean; url?: string } };
  } catch {
    info = null;
  }
  const tsinghua = info?.tsinghua;
  if (!tsinghua || tsinghua.enable !== true || !tsinghua.url) {
    throw new TuojCasError(
      "TUOJ：清华统一认证入口不可用（TUOJ 可能已关闭该登录方式）",
      infoBody.slice(0, 300),
      { stage: "cas" },
    );
  }

  // ② 带 id 会话 GET 漫游表单（路由交给 HttpClient：直连模式下 id 本就直连；
  //    WebVPN 模式下与 learn/info 漫游同轨——不强制 direct，避免通道分裂）
  const formRes = await http.request(tsinghua.url);
  let body = await formRes.text();
  let finalUrl = http.lastFinalUrl || formRes.url || tsinghua.url;
  http.debug?.(
    `[TUOJ-CAS] form status=${formRes.status} final=${finalUrl.slice(0, 160)} ` +
    `feats=${[isCasLoginPage(body) ? "cas-login" : "", isCheckSinglePage(body) ? "checkSingle" : "", /ticket=/.test(body) ? "ticket" : ""].filter(Boolean).join("+") || "none"} len=${body.length}`,
  );
  let casDiag = "";
  let ensureTried = false;
  let ensureOk = false;
  let ensureTwoFactor = false;
  let confirmTried = false;
  let confirmOk = false;

  // 内存凭据有无（文案分支用）；缺省视为有，不改变旧调用方行为
  const hasCreds = deps.hasIdCredentials ? deps.hasIdCredentials() : true;

  if (isCasInterstitial(body, finalUrl)) {
    // 诊断（12.1-1）：id 桶 cookie 名单 / lastFinalUrl / CAS 页面特征
    casDiag = emitCasDiag(http, "no-direct-id-session", body, finalUrl);

    // R10 15.1-1：进入分支先测三形态——checkSingle 确认页（id 会话活着）直接确认取票 +
    // 兑付，绝不因 URL 仍停在 form 路径就判「仍是登录页」而白登入。
    if (isCheckSinglePage(body) && deps.confirmIdCheckSingle) {
      confirmTried = true;
      try {
        confirmOk = await deps.confirmIdCheckSingle(tsinghua.url);
        emitCasDiag(http, `confirm-checkSingle=${confirmOk ? "ok" : "fail"}`, body, finalUrl);
      } catch (e) {
        confirmOk = false;
        casDiag += ` | confirm-error=${e instanceof Error ? e.message : String(e)}`;
        http.debug?.(`[TUOJ-CAS] confirm-checkSingle threw: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 方案 A：仍无会话（密码页 / 确认失败）→ 账密直登 id 后重走漫游表单
    if (!confirmOk && deps.ensureIdSession) {
      ensureTried = true;
      try {
        ensureOk = await deps.ensureIdSession(tsinghua.url);
        emitCasDiag(http, `ensure-direct-id=${ensureOk ? "ok" : "fail"}`, body, finalUrl);
      } catch (e) {
        // 2FA 等底层可操作错误：记录后统一转方案 B 文案（不得静默失败）
        ensureOk = false;
        ensureTwoFactor = isTwoFactorError(e);
        casDiag += ` | ensure-error=${e instanceof Error ? e.message : String(e)}`;
        http.debug?.(`[TUOJ-CAS] ensure-direct-id threw: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (!confirmOk && ensureOk) {
      const retryRes = await http.request(tsinghua.url);
      body = await retryRes.text();
      finalUrl = http.lastFinalUrl || retryRes.url || tsinghua.url;
      emitCasDiag(http, "after-ensure-direct-id", body, finalUrl);
      // R10 15.1-1：ensure 重试后同样可能落到 checkSingle 确认页 → 再确认一次
      if (isCheckSinglePage(body) && deps.confirmIdCheckSingle) {
        confirmTried = true;
        try {
          confirmOk = await deps.confirmIdCheckSingle(tsinghua.url);
          emitCasDiag(http, `confirm-checkSingle-after-ensure=${confirmOk ? "ok" : "fail"}`, body, finalUrl);
        } catch (e) {
          confirmOk = false;
          casDiag += ` | confirm-error=${e instanceof Error ? e.message : String(e)}`;
          http.debug?.(`[TUOJ-CAS] confirm-checkSingle(after ensure) threw: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    // 账密直登若已兑付服务票据（desktop 注入 consumeServiceTicket:true），TUOJ 会话
    // 已在 jar 里；此时再取 CAS 表单会返回登录页，不能据此判失败，应以课程列表验收。
    if (!confirmOk && !ensureOk && isCasInterstitial(body, finalUrl)) {
      // 方案 B（兜底）：可操作文案——按 ensureOk / 有无凭据 / 2FA 分支（R10 15.1-2，R17 23.3）
      throw new TuojCasError(
        tuojCasFailMessage({
          ensureTried,
          ensureOk: ensureOk || confirmTried,
          hasCreds,
          twoFactor: ensureTwoFactor,
        }),
        (casDiag + " | " + finalUrl + " | " + body.slice(0, 300)).slice(0, 800),
        { stage: "cas" },
      );
    }
  }

  // ③ CAS 返回「登录成功」中间页（带票据锚点）时手动跟一跳——demoLogin 同款兜底；
  //    会话有效时 CAS 通常已 302 直落回调（此步不触发）。
  const anchor = extractTicketAnchor(body);
  if (anchor && /ticket=/.test(anchor)) {
    const next = anchor.startsWith("http")
      ? anchor
      : new URL(anchor, "https://id.tsinghua.edu.cn/").toString();
    const landRes = await http.request(next, { direct: true });
    body = await landRes.text();
    finalUrl = http.lastFinalUrl || landRes.url || next;
  }

  // ④ 校验：能拉到课程列表即视为登录完成（会话 cookie 已落 jar）
  const listRes = await http.request(`${base}/api/course/list`, {
    direct: true,
    headers: { ...JSON_HEADERS },
  });
  const listBody = await listRes.text();
  let list: { courses?: unknown[] } | null = null;
  try {
    list = JSON.parse(listBody) as { courses?: unknown[] };
  } catch {
    list = null;
  }
  if (!list || !Array.isArray(list.courses)) {
    let cookieNames = "";
    try {
      cookieNames = http.jar.getCookies(new URL(`${base}/api/course/list`)).map((c) => c.name).join(",");
    } catch { /* 诊断尽力而为 */ }
    http.debug?.(`[TUOJ-CAS] courses status=${listRes.status} final=${finalUrl.slice(0, 160)} tuojCookies=${cookieNames || "(none)"} body=${listBody.slice(0, 160).replace(/\s+/g, " ")}`);
    throw new TuojCasError(
      listRes.status === 401 || listRes.status === 403
        ? `TUOJ：统一认证漫游后仍未取得会话（HTTP ${listRes.status}）`
        : "TUOJ：统一认证漫游返回异常（课程列表非 JSON）",
      (finalUrl + " | " + listBody.slice(0, 300)).slice(0, 600),
      { stage: "courses", httpStatus: listRes.status },
    );
  }

  return { cookie: jarCookieString(http, base), courseCount: list.courses.length };
}
