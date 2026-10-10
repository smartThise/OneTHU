import { http, logLine, session } from "../lib/clients.js";
import { webvpnWrap } from "@onethu/core";
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
/** 站点上仍有但默认不挂的模型（纯推理/易乱码——DSH 插件同清单） */
const EXCLUDED_MODEL_IDS = ["DeepSeek-R1-W8A8", "DeepSeek-V4-Flash-Vision-Exp", "DeepSeek-V4-Flash-0731"];
const MODELS_KEY = "onethu.madmodel.models.v1";
const MODELS_TTL_MS = 6 * 3600_000;
/** 失败退避阶梯（分钟）：防反复撞统一认证锁账号（DSH 插件经验） */
const BACKOFF_MIN = [1, 5, 15, 30];

let pumping = false;

/** 是否处于 madmodel 免费档语义（显式 custom 或「未显式但已填 key」则免打扰） */
function madmodelActive(): boolean {
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

/** 校内可达性探针：直连 GET /check（绕 webvpn 包装、不跟随重定向）。
 *  200=校内可达；30x=IP 门禁（校外）；异常=网络不通，同样按校外处理。 */
async function probeReachable(): Promise<boolean> {
  try {
    const res = await http.request(`${SITE}/model-api/auth-login/check`, { redirect: "manual", direct: true });
    const ok = res.status === 200;
    void logLine(`[MADMODEL] 可达性探针：HTTP ${res.status} → ${ok ? "校内" : "校外（IP 门禁）"}`).catch(() => undefined);
    return ok;
  } catch (e) {
    void logLine(`[MADMODEL] 可达性探针异常（按校外处理）：${e instanceof Error ? e.message : e}`).catch(() => undefined);
    return false;
  }
}

function writeSettings(patch: Record<string, string>): void {
  const prev = getPlugin(HARNESS_ID)?.settings ?? {};
  updatePlugin(HARNESS_ID, { settings: { ...prev, ...patch } });
}

/** 校内直连签发一枚新 token。失败（校外/网络不通）→ reachable=0 交给 config 回退。 */
export async function ensureMadModelToken(force = false): Promise<string> {
  if (pumping && !force) throw new Error("续期进行中");
  pumping = true;
  try {
    const st = getPlugin(HARNESS_ID)?.settings ?? {};
    const nextAt = Number(st.madmodelNextAttemptAt ?? 0);
    if (!force && nextAt && Date.now() < nextAt) {
      throw new Error(`续签退避中（约 ${Math.max(1, Math.ceil((nextAt - Date.now()) / 60_000))} 分钟后重试）`);
    }

    // 层 1：校内直连签发（站点若恢复免登录时自愈；当前返回 10001 落到层 2）
    const direct = await exchangeCheck(`${SITE}/model-api/auth-login/check`, { direct: true });
    if (direct) {
      markFreeTierOk({ token: direct, base: "", cookie: "" });
      void logLine(`[MADMODEL] token 已签发（校内直连，len=${direct.length}）`).catch(() => undefined);
      void ensureModels().catch(() => undefined);
      return direct;
    }

    // 层 2：SSO 取票 → 兑换（唯一出口 = ticket，站点已关闭免登录签发）
    let sso = await fetchSsoTicket();
    if (sso.noSession) {
      // SSO 会话守卫（2026-10-10）：复用 lib 静默重登（记住密码 + 受信指纹 → 免 2FA，
      // 与 LIB-ENSURE 同一条路），成功后重试一次取票——不再干等退避。
      let relogged = false;
      try {
        const { libEnsureSession } = await import("../lib/infoLib.js");
        relogged = await libEnsureSession();
      } catch {
        /* infoLib 不可用（如启动竞态）→ 按未重登处理 */
      }
      void logLine(`[MADMODEL] SSO 会话守卫：${relogged ? "静默重登成功，重试取票" : "静默重登未成"}`).catch(() => undefined);
      if (relogged) sso = await fetchSsoTicket();
    }
    const ticket = sso.ticket;
    if (ticket) {
      // 2a 校内直连兑换
      const tokDirect = await exchangeCheck(
        `${SITE}/model-api/auth-login/check?ticket=${encodeURIComponent(ticket)}`,
        { direct: true },
      );
      if (tokDirect) {
        markFreeTierOk({ token: tokDirect, base: "", cookie: "" });
        void logLine(`[MADMODEL] token 已签发（校内直连 + SSO 票，len=${tokDirect.length}）`).catch(() => undefined);
        void ensureModels().catch(() => undefined);
        return tokDirect;
      }
      // 2b 校外：WebVPN 隧道兑换（2026-10-09 已收录 madmodel 域）
      const tunnelCheck = `${webvpnWrap(`${SITE}/model-api/auth-login/check`)}?ticket=${encodeURIComponent(ticket)}`;
      const tokTunnel = await exchangeCheck(tunnelCheck, {});
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
    bumpBackoff();
    writeSettings({ madmodelReachable: "0", madmodelReachableAt: String(Date.now()) });
    throw new Error(
      "未能续签免费档 token：需要一次有效的清华统一认证会话（SSO 票取不到或兑换被拒）。" +
      "请在 OneTHU 里重新登录清华账号后重试，或改用自费 API。",
    );
  } finally {
    pumping = false;
  }
}

/* ── 阶梯辅助 ── */

/** 直连/隧道通用：GET check（可带 ticket），成功返回 JWT 字符串 */
async function exchangeCheck(url: string, opts: { direct?: boolean }): Promise<string | null> {
  try {
    const res = await http.request(url, { redirect: "manual", ...opts });
    const j = (await res.json().catch(() => null)) as { success?: boolean; data?: unknown } | null;
    if (res.status === 200 && j?.success === true && typeof j.data === "string" && j.data) return j.data;
    if (j && typeof j.data === "string" && j.data) void logLine(`[MADMODEL] check 业务失败：${j.data}`).catch(() => undefined);
    return null;
  } catch (e) {
    void logLine(`[MADMODEL] check 异常：${e instanceof Error ? e.message : e}`).catch(() => undefined);
    return null;
  }
}

/* ── SSO 取票（三形态解剖，tuoj/zhjwxk/info 客户端同款） ──
 *  ① 302 落地已带 ticket → 直接用；
 *  ② checkSingle 指纹确认页 = id 会话**活着**，只差一次 POST 确认 → 确认后取票；
 *  ③ 真登录页（sm2publicKey / i_pass）= 会话死 → 标记 noSession，由调用方触发静默重登后重试。
 *  （旧实现把 ② 也当"无会话"直接失败——泵永不自愈的根源，2026-10-10 实锤修复） */
type TicketResult = { ticket: string | null; noSession: boolean };

const TICKET_RE = /[?&]ticket=([^&\s"']+)/;

async function fetchSsoTicket(): Promise<TicketResult> {
  try {
    const res = await http.request(SSO_FORM, { redirect: "follow" });
    const finalUrl = res.headers.get("x-onethu-final-url") ?? "";
    const body = await res.text();
    const m = TICKET_RE.exec(finalUrl) ?? TICKET_RE.exec(body);
    if (m?.[1]) return { ticket: decodeURIComponent(m[1]), noSession: false };

    if (/checkSingle/i.test(body)) {
      const ticket = await confirmCheckSingle();
      void logLine(`[MADMODEL] SSO 确认页（checkSingle，会话活着）：${ticket ? "已确认取票" : "确认后仍未取到票"}`).catch(() => undefined);
      return { ticket, noSession: false };
    }

    const loginPage = /id="sm2publicKey"|name="i_pass"/i.test(body);
    void logLine(`[MADMODEL] SSO 取票：${loginPage ? "id 会话已死（真登录页）" : `未识别页面（finalUrl=${finalUrl.slice(0, 80)}）`}`).catch(() => undefined);
    return { ticket: null, noSession: true };
  } catch (e) {
    void logLine(`[MADMODEL] SSO 取票异常：${e instanceof Error ? e.message : e}`).catch(() => undefined);
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
    const m = TICKET_RE.exec(finalUrl) ?? TICKET_RE.exec(html) ?? /<a[^>]+href="([^"]*ticket=[^"]*)"/i.exec(html);
    return m?.[1] ? decodeURIComponent(m[1]) : null;
  } catch (e) {
    void logLine(`[MADMODEL] checkSingle 确认异常：${e instanceof Error ? e.message : e}`).catch(() => undefined);
    return null;
  }
}

/** 成功路径统一写 settings 并清退避 */
function markFreeTierOk(p: { token: string; base: string; cookie: string }): void {
  writeSettings({
    madmodelToken: p.token,
    madmodelAt: String(Date.now()),
    madmodelReachable: p.base ? "0" : "1",
    madmodelReachableAt: String(Date.now()),
    madmodelBase: p.base,
    madmodelCookie: p.cookie,
    madmodelNextAttemptAt: "",
    madmodelFailStreak: "0",
  });
}

/** 失败退避：1/5/15/30 分钟封顶（DSH 插件经验：防反复撞统一认证锁账号） */
function bumpBackoff(): void {
  const st = getPlugin(HARNESS_ID)?.settings ?? {};
  const streak = Number(st.madmodelFailStreak ?? 0) + 1;
  const min = BACKOFF_MIN[Math.min(streak - 1, BACKOFF_MIN.length - 1)]!;
  writeSettings({
    madmodelFailStreak: String(streak),
    madmodelNextAttemptAt: String(Date.now() + min * 60_000),
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

/** 对话前兜底：免费档语义下保证「可达性状态新鲜 + token 到期即续」。
 *  - token 到期：完整重签（顺带刷新可达性）；
 *  - token 新鲜但可达性判定超 10 分钟：轻探针刷新（网络切换 10 分钟内自动纠正）。 */
export async function preflightMadModel(): Promise<string | null> {
  if (!madmodelActive()) return null;
  void ensureModels().catch(() => undefined); // 名单保鲜（6h TTL，失败静默沿用）
  if (madmodelDue()) {
    try {
      await ensureMadModelToken();
      return null;
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      void logLine(`[MADMODEL] 续期失败：${why}`).catch(() => undefined);
      return freeTierHint(why);
    }
  }
  const s = getPlugin(HARNESS_ID)?.settings ?? {};
  const tok = String(s.madmodelToken ?? "");
  const at = Number(s.madmodelReachableAt ?? 0);
  if (!at || Date.now() - at > REACH_TTL_MS) {
    const ok = await probeReachable();
    writeSettings({ madmodelReachable: ok ? "1" : "0", madmodelReachableAt: String(Date.now()) });
  }
  // token 为空但「未到期」只可能是设置被外部写坏（如手改设置页覆盖）——此时明确报出来
  if (!tok) return freeTierHint("设置里没有 madmodelToken");
  return null;
}

/** 免费档不可用时的用户可读说明：把真实原因说清楚，而不是让人以为「没填 API Key」。 */
function freeTierHint(why: string): string {
  return [
    "清华免费档（MadModel）暂不可用：" + why + "。",
    "· 校园网内会自动签发 token（本应用每 10 分钟自动续期），可稍候重试；",
    "· 校外 / 走了代理或 VPN 时 IP 门禁会拦（MadModel 仅限校内 IP）——请连校园网或学校 VPN（EasyConnect），",
    "  或在 设置 → 插件 → OneTHU Harness 填入自费 API Key 并把模型源切到「自费 API」。",
  ].join("\n");
}

/** 外部强制重签（run 遇 307 漏判兜底）：刷新 token/可达性，下一条对话即恢复正确通道 */
export async function forceRemint(): Promise<void> {
  await ensureMadModelToken(true).catch((e) =>
    void logLine(`[MADMODEL] 强制重签：${e instanceof Error ? e.message : String(e)}`).catch(() => undefined),
  );
}

/** 续期泵：启动即试一枚 + 每 10 分钟巡检（到期才真拉；顺带保持可达性新鲜） */
export function startMadModelPump(): void {
  const tick = (): void => {
    void preflightMadModel().catch((e) =>
      void logLine(`[MADMODEL] 泵巡检：${e instanceof Error ? e.message : String(e)}`).catch(() => undefined),
    );
  };
  void tick();
  setInterval(tick, 10 * 60_000).unref?.();
  // 免费档没签出来时 60s 快速重试（校园网刚连上/刚回校的场景，不必等满 10 分钟）
  setInterval(() => {
    if (!madmodelActive()) return;
    if (String(getPlugin(HARNESS_ID)?.settings?.madmodelToken ?? "")) return;
    void preflightMadModel().catch(() => undefined);
  }, 60_000).unref?.();
}
