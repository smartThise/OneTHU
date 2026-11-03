import { t as i18n } from "../i18n/index.js";
import { http, logLine, session } from "../lib/clients.js";
import { webvpnWrap, webvpnDecodeUrl } from "@onethu/core";
import { nativeSessionEpoch, assertNativeSessionEpoch } from "../lib/transport.js";
import { getPlugin, updatePlugin } from "../plugins/registry.js";

/** 清华 MadModel（校园免费 DeepSeek）token 泵 + 校外隧道通道 + 模型清单实时爬取。
 *
 *  站点现状（2026-10-09 实测，参考 DSH thu-madmodel 插件结论）：
 *  - **免登录签发已关闭**（直连 /check 返回 10001 ticket 无效）——必须先有一次统一认证登录；
 *    唯一出口 = `GET /model-api/auth-login/check?ticket=<SSO ticket>` → JWT（exp-iat=6h）；
 *  - **WebVPN 已收录 madmodel 域**（旧注释"未收录"作废）：校外走隧道
 *    `https://webvpn.tsinghua.edu.cn/https/<hash>` + wengine_vpn_ticket，最稳；
 *  - 站点**无 /v1/models**：模型名单只在前端 bundle 的 `modelList` 里 → 本模块实时爬取
 *    （首页 → /assets/js/index-*.js → 括号配平解析，缓存 6h），不再钦定单模型；
 *  - SSO 取票：带本机 id 会话重放 `id.tsinghua.edu.cn/.../login/form/<appid>/0?/authLogin`，
 *    会话活着时 CAS 直接 302 发票（venue.ts 同款链路）。
 *
 *  阶梯（ensureMadModelToken）：复用未过期 token → 校内直连签发 → SSO 取票（校内/隧道）
 *  → 失败退避（1/5/15/30 分钟封顶，防撞统一认证锁定）。
 */

const SITE = "https://madmodel.cs.tsinghua.edu.cn";
const REFRESH_MS = 5 * 3600_000 + 50 * 60_000;
const REACH_TTL_MS = 10 * 60_000;
const HARNESS_ID = "onethu.harness";
/** SSO 应用号 = md5('DEEPSEEK')（站点前端现算，DSH 插件复核） */
const SSO_APP = "d736f067a6705ab942df52f958a0f23b";
const SSO_FORM = `https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/${SSO_APP}/0?/authLogin`;
/** checkSingle 指纹确认端点（info 客户端 #idCheckSingle / tuoj / zhjwxk 同款） */
const SSO_CHECK_SINGLE = "https://id.tsinghua.edu.cn/do/off/ui/auth/login/checkSingle";
/** DSH 的门户漫游取票路径：已登录 info 的用户无需再次向 ID 提交密码。 */
const INFO_COOKIE = "https://webvpn.tsinghua.edu.cn/wengine-vpn/cookie?method=get&host=info.tsinghua.edu.cn&scheme=https&path=/f/info/gxfw_fg/common/index";
const INFO_ROAM = webvpnWrap("https://info.tsinghua.edu.cn/b/yyfw/vyyfwxx/info/portal_fg/common/onlineAppRedirect");
const MADMODEL_ROAM_ID = "19D04E39D96B36C494F2E48A1A4741FD";
/** 站点上仍有但默认不挂的模型（纯推理/易乱码——DSH 插件同清单） */
const EXCLUDED_MODEL_IDS = ["DeepSeek-R1-W8A8", "DeepSeek-V4-Flash-Vision-Exp", "DeepSeek-V4-Flash-0731"];
const MODELS_KEY = "onethu.madmodel.models.v1";
const MODELS_TTL_MS = 6 * 3600_000;
/** 失败退避阶梯（分钟）：防反复撞统一认证锁账号（DSH 插件经验） */
const BACKOFF_MIN = [1, 5, 15, 30];

/** 单飞：并发的续签（巡检 / 对话前预检 / 设置页 / 强制重签）共享同一次进行中的 Promise，
 *  与 DSH 插件 TokenEngine.refresh 的 this.refreshing 同款，避免同时撞统一认证。 */
let inflight: Promise<string> | null = null;
/** 服务端校验节流：复用 token 前最多每 REACH_TTL 问一次站点 */
const VERIFY_TTL_MS = 10 * 60_000;
const TRANSIENT_RETRY_MS = 60_000;
let preflightInflight: Promise<string | null> | null = null;
let routeInflight: Promise<boolean> | null = null;
let routeRetryAt = 0;
let routeRevision = 0;
let pumpStarted = false;
type TokenVerdict = "valid" | "invalid" | "temporary";
let validation: { token: string; base: string; verdict: TokenVerdict; until: number } | null = null;

class TemporaryMadModelError extends Error {
  constructor(message: string, readonly retryAfterAt = 0) { super(message); }
}

class MadModelSessionChangedError extends Error {
  constructor() { super("AUTH_SESSION_CHANGED"); }
}

type MintContext = { epoch: number; username: string; token: string };
async function assertMintContext(context: MintContext): Promise<void> {
  await assertNativeSessionEpoch(context.epoch);
  if (!madmodelActive() || session.username !== context.username
    || String(getPlugin(HARNESS_ID)?.settings?.madmodelToken ?? "") !== context.token) {
    throw new MadModelSessionChangedError();
  }
}

function retryAt(res: Response): number {
  const value = res.headers.get("retry-after") ?? "";
  const seconds = Number(value);
  const requested = value && Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(value);
  return Math.max(Date.now() + TRANSIENT_RETRY_MS, Number.isFinite(requested) ? requested : 0);
}

/** 是否处于 madmodel 免费档语义（显式 custom 或「未显式但已填 key」则免打扰） */
export function madmodelActive(): boolean {
  const s = getPlugin(HARNESS_ID)?.settings ?? {};
  const provider = String(s.provider ?? "");
  if (provider === "custom") return false;
  if (!provider && s.apiKey) return false; // 老用户迁移安全：维持自费
  return true;
}

/** 读取 JWT 的 exp（毫秒）；不是 JWT 或没有 exp 时返回 null。 */
export function jwtExpiresAt(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(parts[1]!.length / 4) * 4, "=");
    const payload = JSON.parse(atob(b64));
    const exp = Number(payload?.exp);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** 续期阈值：token 剩余不足 60 分钟即续。站点 token 寿命已变（实测 24h），
 *  以 JWT exp 为准；拿不到 exp 时才退回到「签发时间 + 5h50min」的旧判断。 */
const RENEW_BEFORE_EXP_MS = 60 * 60_000;

/** 是否该续期 token */
export function madmodelDue(): boolean {
  const s = getPlugin(HARNESS_ID)?.settings ?? {};
  const tok = String(s.madmodelToken ?? "");
  const exp = tok ? jwtExpiresAt(tok) : null;
  if (exp !== null) return Date.now() > exp - RENEW_BEFORE_EXP_MS;
  const at = Number(s.madmodelAt ?? 0);
  return !at || Date.now() - at > REFRESH_MS;
}

/** 请求可能耗时数十秒；允许沿用旧凭证前必须重新读当前有效期。 */
function currentTokenUsable(): boolean {
  const token = String(getPlugin(HARNESS_ID)?.settings?.madmodelToken ?? "");
  if (!token) return false;
  const exp = jwtExpiresAt(token);
  return exp === null ? !madmodelDue() : exp > Date.now();
}

function tokenHasRequestBudget(): boolean {
  const token=String(getPlugin(HARNESS_ID)?.settings?.madmodelToken??"");
  const expiry=jwtExpiresAt(token);
  return currentTokenUsable()&&(expiry===null||expiry-Date.now()>10*60_000);
}

/** 只认站点的 JSON 响应，HTTP 200 登录页/代理页不算连通。 */
async function isSiteResponse(res: Response): Promise<boolean> {
  if (res.status !== 200) return false;
  const body = await res.json().catch(() => null) as { success?: unknown } | null;
  return typeof body?.success === "boolean";
}

function writeSettings(patch: Record<string, string>): void {
  const prev = getPlugin(HARNESS_ID)?.settings ?? {};
  if (Object.entries(patch).every(([key, value]) => prev[key] === value)) return;
  updatePlugin(HARNESS_ID, { settings: { ...prev, ...patch } });
}

function syncRouteCookie(): void {
  const base = String(getPlugin(HARNESS_ID)?.settings?.madmodelBase ?? "");
  writeSettings({ madmodelCookie: base ? http.cookieHeaderFor(base) ?? "" : "" });
}

function markRoute(base: string): void {
  writeSettings({
    madmodelBase: base,
    madmodelCookie: base ? http.cookieHeaderFor(base) ?? "" : "",
    madmodelReachable: base ? "0" : "1",
    madmodelReachableAt: String(Date.now()),
  });
  routeRetryAt = 0;
}

/** 路由更新与凭证续签独立：网络切换后探测直连/隧道，临时失败保留最近的已知路线。
 * true 仅表示本次或缓存已有探测结果；false 不会被冒充为“校外可达”。 */
export function refreshMadModelRoute(force = false): Promise<boolean> {
  if (!madmodelActive()) return Promise.resolve(false);
  syncRouteCookie(); // cookie jar 会独立轮换，不等 token 续签或 10 分钟 TTL
  if (routeInflight) return routeInflight;
  const st = getPlugin(HARNESS_ID)?.settings ?? {};
  const at = Number(st.madmodelReachableAt ?? 0);
  if (!force && Date.now() < routeRetryAt) return Promise.resolve(false);
  if (!force && at && Date.now() - at < REACH_TTL_MS) return Promise.resolve(true);
  const revision = routeRevision;
  routeInflight = (async () => {
    try {
      const direct = await http.request(`${SITE}/model-api/auth-login/check`, { redirect: "manual", direct: true });
      if (!madmodelActive() || revision !== routeRevision) return false;
      const confirmed = await isSiteResponse(direct);
      if (!madmodelActive() || revision !== routeRevision) return false;
      if (confirmed) {
        markRoute("");
        return true;
      }
      if (direct.status === 429 || direct.status >= 500) {
        routeRetryAt = retryAt(direct);
        void logLine(`[MADMODEL] 路由探测暂缓：HTTP ${direct.status}`).catch(() => undefined);
        return false;
      }
    } catch {
      // 直连不通可能刚离开校园；只在隧道也实际返回站点 JSON 后才切换。
    }
    if (!madmodelActive() || revision !== routeRevision) return false;
    const base = webvpnWrap(`${SITE}/v1`);
    try {
      const tunnel = await http.request(webvpnWrap(`${SITE}/model-api/auth-login/check`), { redirect: "manual" });
      if (!madmodelActive() || revision !== routeRevision) return false;
      const confirmed = await isSiteResponse(tunnel);
      if (!madmodelActive() || revision !== routeRevision) return false;
      if (confirmed) {
        markRoute(base);
        return true;
      }
      routeRetryAt = retryAt(tunnel);
      void logLine(`[MADMODEL] 路由尚未确认：隧道 HTTP ${tunnel.status}`).catch(() => undefined);
    } catch {
      if (!madmodelActive() || revision !== routeRevision) return false;
      routeRetryAt = Date.now() + TRANSIENT_RETRY_MS;
      void logLine("[MADMODEL] 路由探测暂时失败，保留已有路线").catch(() => undefined);
    }
    syncRouteCookie();
    return false;
  })().finally(() => { routeInflight = null; });
  return routeInflight;
}

/** 续签入口（单飞）。force 只供用户显式更新凭证，自动校验失效仍遵守退避。 */
export function ensureMadModelToken(force = false): Promise<string> {
  if (inflight) return inflight;
  inflight = acquireMadModelToken(force).catch((error) => {
    if (error instanceof MadModelSessionChangedError || String(error?.message ?? error).includes("AUTH_SESSION_CHANGED")) throw error;
    if (!force && !(Number(getPlugin(HARNESS_ID)?.settings?.madmodelNextAttemptAt ?? 0) > Date.now())) {
      bumpBackoff(error instanceof TemporaryMadModelError ? error.retryAfterAt : 0);
    }
    throw error;
  }).finally(() => { inflight = null; });
  return inflight;
}

/** 限流、5xx、网络故障、HTML 与未知响应都不能证明凭证无效。 */
async function serverAccepts(token: string, base: string): Promise<TokenVerdict> {
  if (validation?.token === token && validation.base === base && Date.now() < validation.until) return validation.verdict;
  let verdict: TokenVerdict = "temporary";
  let until = Date.now() + TRANSIENT_RETRY_MS;
  try {
    const root = (base || SITE).replace(/\/v1\/?$/, "");
    const res = await http.request(`${root}/model-api/auth-login`, {
      redirect: "manual", direct: !base, headers: { authorization: `Bearer ${token}` },
    });
    if (res.status === 401) verdict = "invalid";
    else if (res.status >= 200 && res.status < 300) {
      const body = await res.json().catch(() => null) as { success?: unknown } | null;
      if (body?.success === true) verdict = "valid";
      else if (body?.success === false) verdict = "invalid";
    }
    if (verdict === "temporary") until = retryAt(res);
    else until = Date.now() + VERIFY_TTL_MS;
    void logLine(`[MADMODEL] 凭证校验：HTTP ${res.status} ${verdict}`).catch(() => undefined);
  } catch {
    void logLine("[MADMODEL] 凭证校验暂时失败，保留当前凭证").catch(() => undefined);
  }
  const current = getPlugin(HARNESS_ID)?.settings ?? {};
  // 用户换账号/路线或显式续签时，旧请求的结果不得覆盖新的凭证状态。
  if (String(current.madmodelToken ?? "") !== token || String(current.madmodelBase ?? "") !== base || !madmodelActive()) return "temporary";
  validation = { token, base, verdict, until };
  if (verdict === "valid") writeSettings({ madmodelVerifiedAt: String(Date.now()) });
  syncRouteCookie();
  return verdict;
}

async function acquireMadModelToken(force: boolean): Promise<string> {
  {
    const context: MintContext = {
      epoch: await nativeSessionEpoch(), username: session.username,
      token: String(getPlugin(HARNESS_ID)?.settings?.madmodelToken ?? ""),
    };
    const st = getPlugin(HARNESS_ID)?.settings ?? {};
    const nextAt = Number(st.madmodelNextAttemptAt ?? 0);
    if (!force && nextAt && Date.now() < nextAt) {
      throw new Error(i18n("state.madmodel.a3642b461fee", { value: String(Math.max(1, Math.ceil((nextAt - Date.now()) / 60_000))) }));
    }

    // 层 1：校内直连签发（站点若恢复免登录时自愈；当前返回 10001 落到层 2）
    const direct = await exchangeCheck(`${SITE}/model-api/auth-login/check`, { direct: true });
    await assertMintContext(context);
    if (direct) {
      markFreeTierOk({ token: direct, base: "", cookie: "" });
      void logLine(`[MADMODEL] token 已签发（校内直连，len=${direct.length}）`).catch(() => undefined);
      void ensureModels().catch(() => undefined);
      return direct;
    }

    // 层 2：SSO 取票 → 兑换（唯一出口 = ticket，站点已关闭免登录签发）
    let sso = await fetchSsoTicket();
    await assertMintContext(context);
    // ID 的跨应用 SSO 与 info 门户会话分别建立。门户仍可发票时，不能让
    // “SSO 是登录页 → 学习会话健康 → 重试同一个 SSO”成为永远失败的循环。
    let portalTicket = sso.ticket ? null : await fetchPortalTicket(context);
    await assertMintContext(context);
    if (!sso.ticket && !portalTicket && sso.noSession) {
      // SSO 会话守卫（2026-10-10）：复用 lib 静默重登（记住密码 + 受信指纹 → 免 2FA，
      // 与 LIB-ENSURE 同一条路），成功后重试一次取票——不再干等退避。
      let relogged = false;
      try {
        const { libEnsureSession } = await import("../lib/infoLib.js");
        relogged = await libEnsureSession();
      } catch {
        /* infoLib 不可用（如启动竞态）→ 按未重登处理 */
      }
      await assertMintContext(context);
      void logLine(`[MADMODEL] 门户会话守卫：${relogged ? "会话可用，重试门户取票" : "会话未恢复"}`).catch(() => undefined);
      if (relogged) {
        portalTicket = await fetchPortalTicket(context);
        await assertMintContext(context);
        if (!portalTicket) sso = await fetchSsoTicket();
        await assertMintContext(context);
      }
    }
    const ticket = portalTicket ?? sso.ticket;
    if (ticket) {
      // 2a 校内直连兑换
      const tokDirect = await exchangeCheck(
        `${SITE}/model-api/auth-login/check?ticket=${encodeURIComponent(ticket)}`,
        { direct: true },
      );
      await assertMintContext(context);
      if (tokDirect) {
        markFreeTierOk({ token: tokDirect, base: "", cookie: "" });
        void logLine(`[MADMODEL] token 已签发（校内直连 + SSO 票，len=${tokDirect.length}）`).catch(() => undefined);
        void ensureModels().catch(() => undefined);
        return tokDirect;
      }
      // 2b 校外：WebVPN 隧道兑换（2026-10-09 已收录 madmodel 域）
      const tunnelCheck = `${webvpnWrap(`${SITE}/model-api/auth-login/check`)}?ticket=${encodeURIComponent(ticket)}`;
      const tokTunnel = await exchangeCheck(tunnelCheck, {});
      await assertMintContext(context);
      if (tokTunnel) {
        const base = webvpnWrap(`${SITE}/v1`);
        const cookie = http.cookieHeaderFor(tunnelCheck) ?? "";
        markFreeTierOk({ token: tokTunnel, base, cookie });
        void logLine(`[MADMODEL] token 已签发（校外隧道 + SSO 票，len=${tokTunnel.length}）`).catch(() => undefined);
        void ensureModels().catch(() => undefined);
        return tokTunnel;
      }
    }

    // 层 3：失败——退避 + 人话（不猜、不反复撞统一认证）
    // 强制重签失败不计入退避（与插件一致：用户显式操作不该把自动路径也卡住）
    // 不覆盖 madmodelReachable：它只表示 IP 探针结果，票据兑换失败不等于网络不可达
    // （否则会让预检误判「直连被门禁 + webvpn 未就绪」，见 2026-10-12 事故）
    throw new Error(
      i18n("state.madmodel.03964a43d8ea"),
    );
  }
}

/* ── 阶梯辅助 ── */

/** 直连/隧道通用：GET check（可带 ticket），成功返回 JWT 字符串 */
async function exchangeCheck(url: string, opts: { direct?: boolean }): Promise<string | null> {
  try {
    const res = await http.request(url, { redirect: "manual", ...opts });
    if (res.status === 429 || res.status >= 500) throw new TemporaryMadModelError(i18n("state.madmodel.6aa588205779", { status: String(res.status) }), retryAt(res));
    const j = (await res.json().catch(() => null)) as { success?: boolean; data?: unknown } | null;
    if (res.status === 200 && j?.success === true && typeof j.data === "string" && j.data) return j.data;
    void logLine(`[MADMODEL] check 未签发凭证：HTTP ${res.status} success=${String(j?.success)}`).catch(() => undefined);
    return null;
  } catch (e) {
    if (e instanceof TemporaryMadModelError) throw e;
    void logLine("[MADMODEL] check 网络异常").catch(() => undefined);
    return null;
  }
}

/* ── SSO 取票（三形态解剖，tuoj/zhjwxk/info 客户端同款） ──
 *  ① 302 落地已带 ticket → 直接用；
 *  ② checkSingle 指纹确认页 = id 会话**活着**，只差一次 POST 确认 → 确认后取票；
 *  ③ 真登录页（sm2publicKey / i_pass）= 会话死 → 标记 noSession，由调用方触发静默重登后重试。
 *  （旧实现把 ② 也当"无会话"直接失败——泵永不自愈的根源，2026-10-10 实锤修复） */
type TicketResult = { ticket: string | null; noSession: boolean };

const TICKET_RE = /[?&]ticket=([^&#\s"']+)/;

function ticketFrom(value: string): string | null {
  const raw = TICKET_RE.exec(value.replace(/&amp;/gi, "&"))?.[1];
  if (!raw) return null;
  try {
    const ticket = decodeURIComponent(raw);
    return ticket && !/^(?:BAD_CREDENTIALS|ERROR)/i.test(ticket) && !/[\s#]/.test(ticket) ? ticket : null;
  } catch { return null; }
}

/** 只用已有门户会话取票；不调用模型，也不提交用户名/密码或登记信任设备。
 * 与 DSH ticketFromTunnel 同源：门户发出的 /authLogin 入口需要先落地一次。
 * URL 必须严格属于 MadModel，门户异常 HTML/空结果不能算续签成功。 */
async function fetchPortalTicket(context: MintContext): Promise<string | null> {
  try {
    const cookie = await http.request(INFO_COOKIE, { redirect: "follow" });
    await assertMintContext(context);
    if (cookie.status === 429 || cookie.status >= 500) {
      throw new TemporaryMadModelError(i18n("state.madmodel.795ecc37977c", { status: String(cookie.status) }), retryAt(cookie));
    }
    if (cookie.status !== 200) return null;
    const cookieText = await cookie.text();
    await assertMintContext(context);
    const rawCsrf = /(?:^|[;\s])XSRF-TOKEN=([^;\s]+)/.exec(cookieText)?.[1];
    if (!rawCsrf) return null;
    let csrf = rawCsrf;
    try { csrf = decodeURIComponent(rawCsrf); } catch { /* 保留服务端原值 */ }
    const roam = await http.request(`${INFO_ROAM}?${new URLSearchParams({ yyfwid: MADMODEL_ROAM_ID, _csrf: csrf, machine: "p" })}`, { redirect: "follow" });
    await assertMintContext(context);
    if (roam.status === 429 || roam.status >= 500) {
      throw new TemporaryMadModelError(i18n("state.madmodel.795ecc37977c", { status: String(roam.status) }), retryAt(roam));
    }
    if (roam.status !== 200) return null;
    const body = await roam.json().catch(() => null) as { object?: { roamingurl?: unknown } } | null;
    await assertMintContext(context);
    if (typeof body?.object?.roamingurl !== "string") return null;
    const rawTarget = body.object.roamingurl.replace(/&amp;/gi, "&");
    const target = new URL(webvpnDecodeUrl(rawTarget) || rawTarget);
    if (target.origin !== SITE || target.username || target.password || target.pathname !== "/authLogin") return null;
    const ticket = ticketFrom(target.href);
    if (!ticket) return null;
    // 复用已确认的直连或隧道路线；落地失败保留票据，兑换接口给出最终结果。
    const base = String(getPlugin(HARNESS_ID)?.settings?.madmodelBase ?? "");
    try {
      const landing = await http.request(base ? webvpnWrap(target.href) : target.href, { redirect: "follow", direct: !base });
      await assertMintContext(context);
      if (landing.status === 429 || landing.status >= 500) {
        throw new TemporaryMadModelError(i18n("state.madmodel.6aa588205779", { status: String(landing.status) }), retryAt(landing));
      }
    } catch (error) {
      if (error instanceof TemporaryMadModelError || String((error as Error)?.message ?? error).includes("AUTH_SESSION_CHANGED")) throw error;
    }
    void logLine("[MADMODEL] info 门户漫游已取得应用票据").catch(() => undefined);
    return ticket;
  } catch (error) {
    if (error instanceof TemporaryMadModelError || String((error as Error)?.message ?? error).includes("AUTH_SESSION_CHANGED")) throw error;
    void logLine("[MADMODEL] info 门户漫游暂未取得票据").catch(() => undefined);
    return null;
  }
}

async function fetchSsoTicket(): Promise<TicketResult> {
  try {
    const res = await http.request(SSO_FORM, { redirect: "follow" });
    if (res.status === 429 || res.status >= 500) throw new TemporaryMadModelError(i18n("state.madmodel.795ecc37977c", { status: String(res.status) }), retryAt(res));
    const finalUrl = res.headers.get("x-onethu-final-url") ?? "";
    const body = await res.text();
    const ticket = ticketFrom(finalUrl) ?? ticketFrom(body);
    if (ticket) return { ticket, noSession: false };

    if (/checkSingle/i.test(body)) {
      const ticket = await confirmCheckSingle();
      void logLine(`[MADMODEL] SSO 确认页（checkSingle，会话活着）：${ticket ? "已确认取票" : "确认后仍未取到票"}`).catch(() => undefined);
      return { ticket, noSession: false };
    }

    const loginPage = /id="sm2publicKey"|name="i_pass"/i.test(body);
    void logLine(`[MADMODEL] SSO 取票：${loginPage ? "需要重新登录" : "未识别页面，保留会话"}`).catch(() => undefined);
    return { ticket: null, noSession: loginPage };
  } catch (e) {
    if (e instanceof TemporaryMadModelError) throw e;
    void logLine("[MADMODEL] SSO 取票网络异常").catch(() => undefined);
    return { ticket: null, noSession: false };
  }
}

/** checkSingle 确认页取票：POST 指纹确认（i_rememberme + 受信指纹）→ 跟 302/锚点提 ticket。
 *  会话 cookie 驱动授权，指纹只做 remember-me 跟踪（缺了也能确认，下次会再问）。 */
async function confirmCheckSingle(): Promise<string | null> {
  try {
    const res = await http.request(SSO_CHECK_SINGLE, {
      method: "POST",
      body: new URLSearchParams({
        i_rememberme: "on",
        fingerPrint: session.fingerprint ?? "",
        fingerGenPrint: session.finger3 ?? "",
      }),
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      redirect: "follow",
    });
    const finalUrl = res.headers.get("x-onethu-final-url") ?? "";
    const html = await res.text();
    return ticketFrom(finalUrl) ?? ticketFrom(html);
  } catch (e) {
    void logLine("[MADMODEL] checkSingle 确认网络异常").catch(() => undefined);
    return null;
  }
}

/** 成功路径统一写 settings 并清退避 */
function markFreeTierOk(p: { token: string; base: string; cookie: string }): void {
  const prev = String(getPlugin(HARNESS_ID)?.settings?.madmodelToken ?? "");
  const dueSoon = (jwtExpiresAt(p.token) ?? Infinity) <= Date.now() + RENEW_BEFORE_EXP_MS;
  if (prev && prev === p.token && (jwtExpiresAt(p.token) ?? 0) <= Date.now() + RENEW_BEFORE_EXP_MS) {
    // 站点会话没变时会原样返回同一张 token——不算真正续期，留痕便于排查
    void logLine("[MADMODEL] 服务端返回了同一张 token（未真正续期）").catch(() => undefined);
  }
  writeSettings({
    madmodelToken: p.token,
    madmodelAt: String(Date.now()),
    madmodelVerifiedAt: String(Date.now()),
    madmodelReachable: p.base ? "0" : "1",
    madmodelReachableAt: String(Date.now()),
    madmodelBase: p.base,
    madmodelCookie: p.cookie,
    // 站点可能原样返回仍在提前续签窗口内的 token；不能每条消息都再次请求 SSO。
    madmodelNextAttemptAt: dueSoon ? String(Date.now() + VERIFY_TTL_MS) : "",
    madmodelFailStreak: "0",
  });
  validation = { token: p.token, base: p.base, verdict: "valid", until: Date.now() + VERIFY_TTL_MS };
}

/** 失败退避：1/5/15/30 分钟封顶（DSH 插件经验：防反复撞统一认证锁账号） */
function bumpBackoff(serverRetryAt = 0): void {
  const st = getPlugin(HARNESS_ID)?.settings ?? {};
  const streak = Number(st.madmodelFailStreak ?? 0) + 1;
  const min = BACKOFF_MIN[Math.min(streak - 1, BACKOFF_MIN.length - 1)]!;
  writeSettings({
    madmodelFailStreak: String(streak),
    madmodelNextAttemptAt: String(Math.max(Date.now() + min * 60_000, serverRetryAt)),
  });
  void logLine(`[MADMODEL] 续签失败第 ${streak} 次，退避 ${min} 分钟`).catch(() => undefined);
}

/* ── 模型清单实时爬取（站点无 /v1/models；名单在前端 bundle 的 modelList 里） ── */

interface SiteModelProfile {
  id: string;
  supportImage: boolean;
}

/** 从 bundle 文本解析 modelList（括号配平切片 + 逐项正则——压缩代码不能靠贪婪正则） */
export function parseSiteModelList(jsText: string): SiteModelProfile[] {
  const text = String(jsText || "");
  const start = text.indexOf("modelList");
  if (start < 0) return [];
  const arrayStart = text.indexOf("[", start);
  if (arrayStart < 0) return [];
  let depth = 0;
  let end = -1;
  for (let i = arrayStart; i < text.length; i++) {
    const ch = text[i];
    if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) return [];
  const slice = text.slice(arrayStart, end);
  const out: SiteModelProfile[] = [];
  const re = /\{[^{}]*label\s*:\s*"([^"]+)"[^{}]*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(slice)) !== null) {
    const chunk = m[0];
    const value = /value\s*:\s*"([^"]+)"/.exec(chunk)?.[1] || m[1]!;
    const supportImage = /supportImage\s*:\s*!0/.test(chunk);
    out.push({ id: value, supportImage });
  }
  return out;
}

/** 拉站点首页 → 找 bundle → 解析模型名单（失败返回 null，沿用静态档） */
async function crawlSiteModels(): Promise<SiteModelProfile[] | null> {
  try {
    const page = await http.request(`${SITE}/`, { direct: true });
    const html = await page.text();
    const ref = /["']([^"']*assets\/js\/[^"']+\.js)["']/.exec(html)?.[1];
    if (!ref) return null;
    const url = ref.startsWith("http") ? ref : `${SITE}${ref.startsWith("/") ? "" : "/"}${ref}`;
    const bundle = await http.request(url, { direct: true });
    const profiles = parseSiteModelList(await bundle.text()).filter(
      (p) => !EXCLUDED_MODEL_IDS.includes(p.id),
    );
    return profiles.length ? profiles : null;
  } catch (e) {
    void logLine(`[MADMODEL] 模型名单爬取失败（沿用静态档）：${e instanceof Error ? e.message : e}`).catch(() => undefined);
    return null;
  }
}

/** 确保模型清单新鲜（6h TTL）：写 settings madmodelModels；默认模型不在名单时自动纠偏 */
export async function ensureModels(force = false): Promise<string[]> {
  let cached: { at: number; ids: string[] } | null = null;
  try {
    cached = JSON.parse(localStorage.getItem(MODELS_KEY) ?? "null") as { at: number; ids: string[] } | null;
  } catch {
    cached = null;
  }
  if (!force && cached?.ids?.length && Date.now() - cached.at < MODELS_TTL_MS) {
    mirrorModelsToSettings(cached.ids);
    return cached.ids;
  }
  const crawled = await crawlSiteModels();
  const ids = crawled?.map((p) => p.id).filter(Boolean) ?? cached?.ids ?? [];
  if (ids.length) {
    const entry = { at: Date.now(), ids };
    try {
      localStorage.setItem(MODELS_KEY, JSON.stringify(entry));
    } catch {
      /* 存不进去不影响本次 */
    }
    mirrorModelsToSettings(ids);
    void logLine(`[MADMODEL] 模型名单已同步：${ids.join(" / ")}`).catch(() => undefined);
  }
  return ids;
}

/** 名单写进 OH settings（供设置页 optionsFrom 渲染）；默认模型漂移时纠正 */
function mirrorModelsToSettings(ids: string[]): void {
  const st = getPlugin(HARNESS_ID)?.settings ?? {};
  const cur = String(st.madmodelModel ?? "");
  const patch: Record<string, string> = { madmodelModels: JSON.stringify(ids) };
  if (!cur || !ids.includes(cur)) patch.madmodelModel = ids[0]!;
  writeSettings(patch);
}

/** 设置页、启动巡检与对话共用一次预检，避免同时校验/探测/续签。 */
export function preflightMadModel(): Promise<string | null> {
  if (!madmodelActive()) return Promise.resolve(null);
  if (preflightInflight) return preflightInflight;
  preflightInflight = runPreflight().finally(() => { preflightInflight = null; });
  return preflightInflight;
}

async function runPreflight(): Promise<string | null> {
  void ensureModels().catch(() => undefined);
  const cached=getPlugin(HARNESS_ID)?.settings??{};
  const cachedToken=String(cached.madmodelToken??""),cachedBase=String(cached.madmodelBase??"");
  const knownInvalid=validation?.token===cachedToken&&validation.base===cachedBase&&validation.verdict==="invalid";
  if(madmodelActive()&&tokenHasRequestBudget()&&!knownInvalid&&Date.now()-Number(cached.madmodelVerifiedAt??0)<VERIFY_TTL_MS){
    syncRouteCookie();
    void refreshMadModelRoute().catch(()=>undefined);
    if(madmodelDue())void ensureMadModelToken().catch(()=>undefined);
    return null;
  }
  const revision = routeRevision;
  await refreshMadModelRoute();
  if (revision !== routeRevision) await refreshMadModelRoute();
  if (!madmodelActive()) return null;
  const st = getPlugin(HARNESS_ID)?.settings ?? {};
  const tok = String(st.madmodelToken ?? "");
  const usable = currentTokenUsable();
  let verdict: TokenVerdict = "invalid";
  if (usable) {
    verdict = await serverAccepts(tok, String(st.madmodelBase ?? ""));
    if (String(getPlugin(HARNESS_ID)?.settings?.madmodelToken ?? "") !== tok || !madmodelActive()) return null;
    // 临时故障不是续签信号；保留旧凭证/成功时间，由本次聊天报告真实网络状态。
    if (verdict === "temporary") return currentTokenUsable() ? null : freeTierHint(i18n("state.madmodel.cc4b425932b8"));
    if (verdict === "valid" && tokenHasRequestBudget()) {
      // Like DSH, refresh ahead of expiry without blocking a usable chat key.
      if (madmodelDue()) void ensureMadModelToken().catch(() => undefined);
      return null;
    }
  }
  const nextAt = Number(getPlugin(HARNESS_ID)?.settings?.madmodelNextAttemptAt ?? 0);
  const canReuseCurrent=()=>verdict==="valid"&&String(getPlugin(HARNESS_ID)?.settings?.madmodelToken??"")===tok&&currentTokenUsable();
  if (Date.now() < nextAt) return canReuseCurrent()?null:freeTierHint(i18n("state.madmodel.302ca473236a"));
  try {
    await ensureMadModelToken();
    return currentTokenUsable() ? null : freeTierHint(i18n("state.madmodel.0e0df04b7d65"));
  } catch (e) {
    // 临近过期的提前续签失败，不应使尚有效的凭证立即停止工作。
    if(canReuseCurrent())return null;
    const why = e instanceof Error ? e.message : i18n("state.madmodel.c04cfb0974f5");
    void logLine(`[MADMODEL] 续期未完成：${e instanceof TemporaryMadModelError ? "临时服务故障" : "未取得新凭证"}`).catch(() => undefined);
    return freeTierHint(why);
  }
}

/** 免费档不可用时的用户可读说明：把真实原因说清楚，而不是让人以为「没填 API Key」。 */
function freeTierHint(why: string): string {
  return i18n("state.madmodel.93c04445723a", { reason: why });
}

/** 用户显式更新登录凭证；IP 门禁改走 refreshMadModelRoute，不触发续签。 */
export async function forceRemint(): Promise<void> {
  await ensureMadModelToken(true).catch((e) =>
    void logLine(`[MADMODEL] 强制重签：${e instanceof Error ? e.message : String(e)}`).catch(() => undefined),
  );
}

/** 续期泵：启动即试一枚 + 每 10 分钟巡检（到期才真拉；顺带保持可达性新鲜） */
export function startMadModelPump(): void {
  if (pumpStarted) return;
  pumpStarted = true;
  const networkChanged = (): void => {
    routeRevision++;
    routeRetryAt = 0;
    validation = null;
    writeSettings({ madmodelReachableAt: "" });
    void preflightMadModel().catch(() => undefined);
  };
  window.addEventListener("online", networkChanged);
  const connection = (navigator as Navigator & { connection?: EventTarget }).connection;
  connection?.addEventListener("change", networkChanged);
  const tick = (): void => {
    void preflightMadModel().catch((e) =>
      void logLine(`[MADMODEL] 泵巡检：${e instanceof Error ? e.message : String(e)}`).catch(() => undefined),
    );
  };
  void tick();
  (setInterval(tick, 10 * 60_000) as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();
  // 免费档没签出来时 60s 快速重试（校园网刚连上/刚回校的场景，不必等满 10 分钟）
  (setInterval(() => {
    if (!madmodelActive()) return;
    if (String(getPlugin(HARNESS_ID)?.settings?.madmodelToken ?? "")) return;
    void preflightMadModel().catch(() => undefined);
  }, 60_000) as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();
}
