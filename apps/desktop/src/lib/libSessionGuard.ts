/**
 * lib 会话守卫的三个共用原语（F3 静默重登，①②⑤ 修复）。
 *
 * 本模块**零依赖**：既是业务侧（`clients.ts` / `infoLib.ts`）的共享实现，
 * 也是护栏 `tools/relogin-test.mjs` 直接加载跑行为自检的落点。三块职责：
 *
 * - ① 判活面：`LibRebuildSite` 站点表 / `sitesOfLostUrl()` URL→站点映射 /
 *   `ensureLibSessionFlow()`「info 门户 alive 后按失联站点补一次重建」——
 *   全是可注入的纯策略，站点→真入口的接线留在 `infoLib.ts`。
 * - ② 探针去假活：`judgeInfoProbeBody()` 用 `object.ryh === 期望学号` 判本人
 *   （与 `packages/info-lib/src/lib/core.ts:375-392` 的 `verifyAndReLogin` 同源），
 *   拿不到明确结论返回 null（调用方必须报 fail）；`probeInfoOwnSession()` 保留
 *   一次抖动重试。
 * - ③ 触发面下移到 `nativeFetch`：`isLibAuthFailureText()`（Rust 鉴权类错误文案）与
 *   `looksLibLoggedOut()`（200 但响应体是登录页/被踢页）——判据照抄既有集合；
 *   `withLibAuthRecovery()` 把「失败 → 重登一次 → 重放一次」收成唯一编排。
 *   **b38 域限缩**：`isLibAuthJudgeUrl()` 把 ③ 判定限缩到清华 / WebVPN 域
 *   （`LIB_AUTH_JUDGE_HOST_BASE`，来源见 ③-0 段），外部消费方不再触发。
 * - ④ 旁证日志：`maskLibTicket()` 只留前 12 位，供传输层并列打印 JS jar 的票据。
 * - ⑤ 冷却语义：`runLibSoftSingleFlight()` 单飞 + 「先置占位冷却再 await」的
 *   守卫前置；30s 起步（保留防风控连锤），封顶下调到 120s；`resetLibSoftBackoff()`
 *   供交互登录成功 / 用户点重试等手动路径清零。
 * - B（b18）站点空集兜底：`sitesOfLostUrl()` 的真实域表之后补一层**证据驱动**的
 *   路径特征；`isLibLoginChainUrl()` 挡掉登录链自身的 200 登录页；
 *   `judgeLibFullChainRecovery()` 只在「不是登录链 / 不在交互登录中」且
 *   「UI 自认为已登录、或登录页 + 有登录信息且连续 N 次」时升级为全链恢复。
 *   本模块不碰调度：升级后的恢复仍由调用方交 `runLibSoftSingleFlight()`。
 */

/* ═══════════════ ① 判活面：站点表 ═══════════════ */

/** 需要按站点补重建的子服务。seat=图书馆座位（seat.lib），libroom=研讨间（cab.lib）。 */
export type LibRebuildSite = "learn" | "card" | "seat" | "libroom" | "zhjw";

/** 五站点全集（B 兜底的全链恢复由此展开）。业务侧 import 的是本常量，
 *  与 `LibRebuildSite` 同源——新增站点不会漏。 */
export const ALL_LIB_REBUILD_SITES: readonly LibRebuildSite[] = [
  "learn",
  "card",
  "seat",
  "libroom",
  "zhjw",
];

const ALL_SITES: LibRebuildSite[] = [...ALL_LIB_REBUILD_SITES];

/** 去重 + 过滤未知站点（调用方可以放心把 URL 映射结果直传） */
export function normalizeLibSites(sites: readonly string[] | undefined | null): LibRebuildSite[] {
  const out: LibRebuildSite[] = [];
  for (const s of sites ?? []) {
    const site = s as LibRebuildSite;
    if (ALL_SITES.includes(site) && !out.includes(site)) out.push(site);
  }
  return out;
}

/**
 * 真实域 → 站点（**唯一权威来源**）。调用方传入的 URL 必须已用
 * `webvpnDecodeUrl()` 解回真实域（`libSitesOfLostUrl()` 已做）；解不出真实域时
 * 本表至少不会被 webvpn 物理域蒙骗（`webvpn.tsinghua.edu.cn` 不在表内 → 空）。
 */
function sitesOfLostHost(url: string): LibRebuildSite[] {
  const u = String(url ?? "");
  if (!u) return [];
  const out: LibRebuildSite[] = [];
  if (/learn\.tsinghua\.edu\.cn/i.test(u)) out.push("learn");
  if (/card\.tsinghua\.edu\.cn/i.test(u)) out.push("card");
  if (/seat\.lib\.tsinghua\.edu\.cn/i.test(u)) out.push("seat");
  if (/cab\.lib\.tsinghua\.edu\.cn/i.test(u)) out.push("libroom");
  if (/zhjwx?k?\.cic\.tsinghua\.edu\.cn/i.test(u)) out.push("zhjw");
  return out;
}

/**
 * 路径特征兜底（b18 A）：**只在真实域认不出站点时启用**，绝不覆盖真实域证据。
 * 每条都对着真机样本（URL 去查询串）+ 仓库取样，不许凭想象扩充：
 *
 * - `/b/kc/` → `learn`：learn 承载的教务 / 学期代理命名空间。
 *   真机样本（OPPO，`10-03 14:49:01.047`，403）：
 *   `webvpn.tsinghua.edu.cn/https/<站点码>/b/kc/zhjw_v_code_xnxq/getCurrentAndNextSemester`，
 *   其中 `<站点码>` = `77726476706e69737468656265737421fcf2408e297e7c4377068ea48d546d30ca8cc97bcc`，
 *   用 `webvpnDecodeUrl` 解出真实域 `learn.tsinghua.edu.cn`。
 *   仓库同形：`packages/core/src/learn/urls.ts` 的 `LEARN_CURRENT_SEMESTER()`（LEARN_PREFIX +
 *   `/b/kc/zhjw_v_code_xnxq/getCurrentAndNextSemester`）、`packages/info-lib/src/constants/strings.ts`
 *   的 `SEMESTER_LIST_URL`（同一站点码，解出同为 learn）。
 *   **注意口径**：这条路径的字面里带 `zhjw`，但真机与仓库两处证据都表明它跑在 learn 域上
 *   （教务数据由网络学堂代发）——归属按真实域/真实通道，不按字面；给它 zhjw 会把
 *   learn 的会话重建引到 id-教务漫游上，救错会话。
 * - `/xkBks.` `/js.vjsKcbBs.do` `/jhBks.` `/xklogin.do` → `zhjw`：选课系统（zhjwxk.cic）API。
 *   真机样本（OPPO，`10-03 14:48:47.252`，200）：
 *   `webvpn.tsinghua.edu.cn/http/<站点码>/js.vjsKcbBs.do`，站点码
 *   `77726476706e69737468656265737421eaff4b8b3f3b2653770bc7b88b5c2d320506b1aec738590a49ba`
 *   解出 `zhjwxk.cic.tsinghua.edu.cn`。
 *   仓库同形：`packages/core/src/zhjwxk/client.ts`（`/xkBks.vxkBksXkbBs.do`、
 *   `/xkBks.vxkBksJxjhBs.do`、`/jhBks.vjhBksPyfakcbBs.do`、`/xklogin.do`）。
 * - `/portal3rd.do` `/jxmh_out.do` → `zhjw`：zhjw.cic 教务 API。
 *   真机样本（REDMI 冷启 `b17-cold.log`）：`webvpn.tsinghua.edu.cn/http/<站点码>/portal3rd.do`
 *   与 `.../jxmh_out.do`，站点码
 *   `77726476706e69737468656265737421eaff4b8b69336153301c9aa596522b20bc86e6e559a9b290`
 *   解出 `zhjw.cic.tsinghua.edu.cn`；仓库同形：`packages/core/src/info/urls.ts` 的 `ZHJW_PREFIX`。
 *
 * 认不出仍返回空数组——**不猜**。
 */
function sitesOfLostPath(url: string): LibRebuildSite[] {
  const u = String(url ?? "");
  if (!u) return [];
  const out: LibRebuildSite[] = [];
  const push = (s: LibRebuildSite): void => {
    if (!out.includes(s)) out.push(s);
  };
  // learn 的教务/学期代理命名空间（真机样本见上）
  if (/\/b\/kc\//i.test(u)) push("learn");
  // 选课系统（zhjwxk.cic）API（真机样本见上）
  if (/\/(xkBks\.|js\.vjsKcbBs\.do|jhBks\.|xklogin\.do)/i.test(u)) push("zhjw");
  // zhjw.cic 教务 API（真机样本见上）
  if (/\/(portal3rd\.do|jxmh_out\.do)/i.test(u)) push("zhjw");
  return out;
}

/**
 * 「当前失联/需要的站点」由失败请求的 URL 反推（调用方传入真实域 URL，
 * webvpn 包装 URL 请先用 `webvpnDecodeUrl()` 解回目标域）。
 * 先真实域、后路径特征（b18 A）；两条都认不出返回空数组——**不猜**。
 */
export function sitesOfLostUrl(url: string | null | undefined): LibRebuildSite[] {
  const u = String(url ?? "");
  if (!u) return [];
  const byHost = sitesOfLostHost(u);
  if (byHost.length) return byHost;
  return sitesOfLostPath(u);
}

/**
 * ① 判活面扩到子服务：info 门户 alive 之后，按「当前失联/需要的站点」补一次对应重建。
 * 站点重建走共享单飞（`cooldown:false`——外层 `libEnsureSession` 已持冷却窗口），
 * 绝不并发互烧票。返回 false = 门户没活、或某个被点名的站点没重建成功。
 */
/** 第 48 条（霖 2026-10-07）：只读标注——上一次门户判活返回的 `false` 是不是
 *  「登录申请冷却内**没执行**」。冷却里的 false 是**假失败**：调用方（libEnsureSessionResult）
 *  据此把它落成 `skipped/cooldown`，绝不能当 `failed` 处理——b18 真机正是这样把用户判成登出的。
 *  只读语义：读一次即清（`consume`），不参与任何判定。 */
let lastPortalSkipReason: "cooldown" | null = null;
export function notePortalSkipReason(r: "cooldown" | null): void { lastPortalSkipReason = r; }
export function consumePortalSkipReason(): "cooldown" | null {
  const r = lastPortalSkipReason;
  lastPortalSkipReason = null;
  return r;
}

export async function ensureLibSessionFlow(args: {
  sites: readonly LibRebuildSite[];
  ensurePortal: () => Promise<boolean>;
  rebuildSite: (site: LibRebuildSite) => Promise<boolean>;
  log?: (line: string) => void;
}): Promise<boolean> {
  const alive = await args.ensurePortal();
  if (!alive) {
    args.log?.("LIB-ENSURE 门户未活 → 不补子服务重建");
    return false;
  }
  const sites = normalizeLibSites(args.sites);
  if (!sites.length) {
    // 没点名站点：保持旧语义（门户活着即视为会话可用），不无差别烧票
    return true;
  }
  let ok = true;
  for (const site of sites) {
    const r = await runLibSoftSingleFlight(
      `site:${site}`,
      () => args.rebuildSite(site),
      { cooldown: false },
    );
    args.log?.(`LIB-ENSURE 子服务重建 site=${site} ${r ? "ok" : "fail"}`);
    if (!r) ok = false;
  }
  return ok;
}

/* ═══════════════ ② 探针去假活：info 域本人校验 ═══════════════ */

/** 与 `packages/info-lib/src/constants/strings.ts` 的 `GET_COOKIE_URL` 同值
 *  （护栏加了同值断言防漂移；这里不复用 import 是为了本模块零依赖）。 */
export const INFO_PROBE_COOKIE_URL =
  "https://webvpn.tsinghua.edu.cn/wengine-vpn/cookie?method=get&host=info.tsinghua.edu.cn&scheme=https&path=/f/info/gxfw_fg/common/index";
/** 与 `packages/info-lib/src/constants/strings.ts` 的 `USER_DATA_URL` 同值。 */
export const INFO_PROBE_USER_DATA_URL =
  "https://webvpn.tsinghua.edu.cn/https/77726476706e69737468656265737421f9f9479369247b59700f81b9991b2631506205de/b/info/gxfw_fg/common/grjbxx";

/** 从 wengine cookie 端点响应体里取 XSRF-TOKEN（网关发票，**不能**当会话活的证据）。 */
export function parseXsrfToken(cookieBody: string): string | null {
  const q = /XSRF-TOKEN=(.+?);/.exec(cookieBody + ";");
  return q?.[1] ?? null;
}

/**
 * ② 判据：拿 info 域 `grjbxx` 的 JSON 与期望学号比对（`verifyAndReLogin` 同源）。
 * 返回 true=本人活会话；false=明确不是本人；**null=拿不到明确结论**（非 JSON /
 * 登录页 / object.ryh 缺失 / 没有期望学号）——调用方必须按 fail 处理，
 * 绝不允许「200 + XSRF-TOKEN=」这种假活判据回来。
 */
export function judgeInfoProbeBody(body: string, expectedUserId: string): boolean | null {
  if (!expectedUserId) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const ryh = (parsed as { object?: { ryh?: unknown } } | null)?.object?.ryh;
  if (typeof ryh !== "string" || ryh.length === 0) return null;
  return ryh === expectedUserId;
}

export type ProbeFetchText = (url: string) => Promise<{ status: number; body: string }>;

/**
 * ② 探针：用该 jar 打一次 info 域本人校验；网络抖动/无结论时重试一次。
 * 返回 false = 会话不是本人的活会话（调用方落 fail 分支）。
 */
export async function probeInfoOwnSession(
  fetchText: ProbeFetchText,
  expectedUserId: string,
  opts: { attempts?: number; retryDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
  const attempts = Math.max(1, opts.attempts ?? 2);
  const sleep = opts.sleep ?? ((ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)));
  for (let i = 0; i < attempts; i += 1) {
    let judged: boolean | null = null;
    try {
      const cookie = await fetchText(INFO_PROBE_COOKIE_URL);
      const xsrf = parseXsrfToken(cookie.body);
      if (cookie.status === 200 && xsrf) {
        const data = await fetchText(`${INFO_PROBE_USER_DATA_URL}?_csrf=${encodeURIComponent(xsrf)}`);
        judged = judgeInfoProbeBody(data.body, expectedUserId);
      }
    } catch {
      judged = null; // 网络抖动 → 重试
    }
    if (judged === true) return true;
    if (judged === false) return false; // 明确不是本人：重试无意义
    if (i < attempts - 1) await sleep(opts.retryDelayMs ?? 600);
  }
  return false; // 拿不到明确结论 → fail（不许假活）
}

/* ═══════════════ ③ 触发面下移到 nativeFetch ═══════════════ */

/* ── ③-0 判定域限缩（b38，霖 2026-10-05 裁定）──
 *
 * 裁定原文：把 ③ 这条判定**限缩到清华 / WebVPN 域**。
 * 病根（b36 已知外溢 ⑥）：触发面下移到两条原生通道后，`universalFetch` 上那些
 * 外部 / 非清华消费方（拓课 `ai.tuoj.thusaac.com`、雨课堂 `pro.yuketang.cn`、
 * market `api.github.com`、cloudCal、trace `restapi.amap.com`、`thubook.help`、
 * `tsinghua.app`、plugins 出口、水站、洗衣机外部域）在 Tauri 下也会过 ③——
 * 它们若真返回「像登录页」的 200 或鉴权类文案，会触发一次全链恢复（有共享单飞与
 * 30s / 120s 冷却兜底、不登出，但属误触发面）。
 *
 * **域名单来源（不新造域名列表）**：三条既有判据同属一个域基 `tsinghua.edu.cn`——
 *   1. `transport.ts` 的 `nativeFetchOnce()` 域分流：`h.endsWith("tsinghua.edu.cn")`；
 *   2. 本模块 `sitesOfLostHost()` 的五个站点域（learn / card / seat.lib / cab.lib /
 *      zhjwxk.cic，全是它的子域）；
 *   3. `packages/core/src/crypto/webvpn.ts` 的 `WEBVPN_ROOT`（webvpn.tsinghua.edu.cn）。
 * 护栏 ㉙-3 用同源对照钉死（域基与 (1) 逐字相等、站点表与 WEBVPN_ROOT 全部落判据内）。
 * 判据形态取**带点后缀**（比 (1) 的裸 `endsWith` 更窄）：`eviltsinghua.edu.cn` 这类
 * 近似域一律不算清华域。
 */
export const LIB_AUTH_JUDGE_HOST_BASE = "tsinghua.edu.cn";

/** 该请求 URL 是否在 ③ 判定域内：清华 `*.tsinghua.edu.cn` 与 webvpn 包装 URL
 *  （物理域 webvpn.tsinghua.edu.cn）都算。空值 / 畸形 URL 一律 false——**不猜**：
 *  外部或未知请求不该为「解析失败」买单。 */
export function isLibAuthJudgeUrl(url: string | null | undefined): boolean {
  const raw = String(url ?? "");
  if (!raw) return false;
  let host = "";
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === LIB_AUTH_JUDGE_HOST_BASE || host.endsWith(`.${LIB_AUTH_JUDGE_HOST_BASE}`);
}

/** ③ 两类信号：Rust 侧抛出的鉴权类错误 / HTTP 200 但响应体是登录页或被踢页。 */
export type LibAuthFailureSignal = "rust-auth-error" | "logged-out-page";

export interface LibAuthFailure {
  signal: LibAuthFailureSignal;
  /** 判定依据的短描述（只进日志；不含票据、凭据、完整 URL） */
  detail: string;
}

/** Rust 侧鉴权类错误文案集合：照抄 `packages/core/src/info/client.ts` 的 `isAuthError`
 *  既有集合（护栏做同值对照防漂移），**不新增文案**。 */
export const LIB_AUTH_ERROR_TEXT =
  /AuthRequiredError|未登录|请先登录|请重新登录|重新登录|登录超时|登陆超时|登录已失效|登录态|会话已失效|会话失效|会话超时|会话过期|身份过期|认证失效|not[ -]?logged[ -]?in|unauthorized/i;

/** 抛出的任意形态错误（Rust 侧 `Err("会话已失效，需要重新登录")` 不是 Error 实例）
 *  归一成一句话后按既有文案集合判定。 */
export function isLibAuthFailureText(raw: unknown): boolean {
  const text = typeof raw === "string" ? raw : String(raw ?? "");
  return LIB_AUTH_ERROR_TEXT.test(text);
}

/** 200 + 登录页/被踢页判据：照抄 `packages/core/src/http.ts:573-579` 的 `#looksLoggedOut`
 *  既有集合（body 正则 `id="sm2publicKey"` / `name="i_pass"`、落点 URL 含
 *  `/do/off/ui/auth/login/`、header `x-onethu-auth-dance: webvpn-login`）——
 *  **复用既有判据，不另发明**（例如不把 `authcenter/toLoginPage` 之类新落点加进来）。 */
export function looksLibLoggedOut(args: {
  body?: string | null;
  url?: string | null;
  authDance?: string | null;
}): boolean {
  if (/\/do\/off\/ui\/auth\/login\//.test(String(args.url ?? ""))) return true;
  if (args.authDance === "webvpn-login") return true;
  const body = args.body ?? "";
  return /id="sm2publicKey"/.test(body) || /name="i_pass"/.test(body);
}

/** 一次尝试的结果：value = 拿到了响应（可能是登录页，交由上层按原语义处理）；
 *  error = 抛错（原生错误原样保留）。failure 非空 = 这次结果被判为登录失效。 */
export type LibAuthOutcome<T> =
  | { kind: "value"; value: T; failure: LibAuthFailure | null }
  | { kind: "error"; error: unknown; failure: LibAuthFailure | null };

/** 跑一次尝试并分类（不重登、不重放）。 */
export async function runLibAuthAttempt<T>(
  attempt: () => Promise<T>,
  classifyError: (err: unknown) => LibAuthFailure | null,
  classifyValue: (value: T) => LibAuthFailure | null,
): Promise<LibAuthOutcome<T>> {
  try {
    const value = await attempt();
    return { kind: "value", value, failure: classifyValue(value) };
  } catch (error) {
    return { kind: "error", error, failure: classifyError(error) };
  }
}

/**
 * ③ 会话恢复编排：命中登录失效 → **重登一次** → **重放一次**。
 * - 重登失败：不重放，原样交回调用方（第一个结果，含原始错误）；
 * - 重放再次命中：不再重登、不再重放，交回重放结果；
 * - 恢复动作由调用方注入（业务侧接共享单飞），本模块不持任何调度器——
 *   绝不出现第二套限流/退避/单飞。
 */
export async function withLibAuthRecovery<T>(args: {
  attempt: () => Promise<T>;
  classifyError: (err: unknown) => LibAuthFailure | null;
  classifyValue: (value: T) => LibAuthFailure | null;
  recover: (failure: LibAuthFailure) => Promise<boolean>;
  log?: (line: string) => void;
}): Promise<LibAuthOutcome<T>> {
  const first = await runLibAuthAttempt(args.attempt, args.classifyError, args.classifyValue);
  if (!first.failure) return first;
  args.log?.(`LIB-AUTH 判定登录状态失效 signal=${first.failure.signal} ${first.failure.detail}`);
  const recovered = await args.recover(first.failure).catch(() => false);
  if (!recovered) {
    args.log?.("LIB-AUTH 重登未成功 → 不重放，原样交回调用方");
    return first;
  }
  args.log?.("LIB-AUTH 重登成功 → 重放一次");
  const replay = await runLibAuthAttempt(args.attempt, args.classifyError, args.classifyValue);
  if (replay.failure) {
    args.log?.(`LIB-AUTH 重放后仍失效 signal=${replay.failure.signal} → 不再重登、不再重放`);
  }
  return replay;
}

/* ═══════════════ B 站点空集兜底（b18）：登录链闸 + 升级判据 ═══════════════ */

/**
 * 该 URL 是不是**登录链自身**的请求（B 兜底的第一道闸，命中一律不触发恢复）。
 *
 * 依据（b17 真机量，REDMI 冷启 692 行 buffer）：21 条 `LIB-AUTH 判定` 里 **20 条是登录链
 * 自身的 200 登录页**，落点主机分布 `id.tsinghua.edu.cn` 17 / `webvpn.tsinghua.edu.cn` 2 /
 * `madmodel.cs.tsinghua.edu.cn` 1；OPPO 现场同形（15 条「认不出站点」全部落在
 * `id.tsinghua.edu.cn/do/off/ui/auth/login/{form,check,checkSingle}`）。把登录舞步里的
 * 200 登录页当成失联去触发全链恢复，就是重登风暴的入口，必须挡在计数之前。
 *
 * **判据取「该次请求自身的 URL」，不是重定向落点**：业务请求被 302 进 id 登录表单
 * （b17 实录：learn 主数据链首个请求 302 到 `id.tsinghua.edu.cn/do/off/ui/auth/login/form/…`）
 * 是**真失联**，那条路径的请求 URL 是 learn 包装 URL、不含登录路径，照常走站点归属；
 * 只有「请求本身就是去走登录舞」（id 表单 / oauth / webvpn 裸 /login / madmodel 登录）才挡。
 */
export function isLibLoginChainUrl(url: string | null | undefined): boolean {
  const raw = String(url ?? "");
  if (!raw) return false;
  // ① id 登录舞步：直连与 webvpn 包装后的路径里都保留 `/do/off/ui/auth/login/`
  //    （zhjwxk 的 id-bounce 会主动请求 `…/do/off/ui/auth/login/form/<hash>/0`，同属登录链）
  if (/\/do\/off\/ui\/auth\/login\//i.test(raw)) return true;
  let host = "";
  let path = "";
  try {
    const u = new URL(raw);
    host = u.hostname.toLowerCase();
    path = u.pathname;
  } catch {
    /* 畸形 URL 落到下面的字符串兜底 */
  }
  if (host === "oauth.tsinghua.edu.cn" || host === "madmodel.cs.tsinghua.edu.cn") return true;
  if (host === "webvpn.tsinghua.edu.cn" && /^\/login(\/|$)/i.test(path)) return true;
  return /^https?:\/\/(oauth\.tsinghua\.edu\.cn|madmodel\.cs\.tsinghua\.edu\.cn)/i.test(raw);
}

/** B 兜底阈值：同一 `LIB_EMPTY_SITE_WINDOW_MS` 窗内累计 3 次「站点认不出」才在
 *  「UI 已在登录页但有登录信息」这一支升级。取 3 的理由：一次网络抖动 / 一次重定向链
 *  可能造成 1~2 条空集判定，3 条（且已过登录链闸与交互登录闸）才够成「业务通道整体
 *  认不出」的证据；b17 真机一次冷启的空集判定 20 条全部来自登录链自身，已被闸掉，
 *  不会靠数量误触。 */
export const LIB_EMPTY_SITE_ESCALATE_N = 3;
/** 计数窗：60s。与 ⑤ 的 30s 起步冷却同量级——冷却期内本来也只会跑一次真恢复。 */
export const LIB_EMPTY_SITE_WINDOW_MS = 60_000;

let libEmptySiteHits: number[] = [];

export function libEmptySiteHitCount(now: number = Date.now()): number {
  return libEmptySiteHits.filter((t) => now - t < LIB_EMPTY_SITE_WINDOW_MS).length;
}

function recordLibEmptySiteHit(now: number): number {
  libEmptySiteHits = libEmptySiteHits.filter((t) => now - t < LIB_EMPTY_SITE_WINDOW_MS);
  libEmptySiteHits.push(now);
  return libEmptySiteHits.length;
}

/** 护栏用：只清空集计数窗（不动单飞/冷却）。 */
export function resetLibEmptySiteWindowForTest(): void {
  libEmptySiteHits = [];
}

export interface LibFullChainEscalation {
  escalate: boolean;
  /** 判定理由（只进日志，供真机对账） */
  reason: string;
  /** 本窗内累计的空集判定次数（含本次） */
  hits: number;
}

/**
 * B 兜底判据：站点反推为空时，要不要升级成一次**全链恢复**（门户判活 + 五站点补建）。
 *
 * 判据与理由（按闸门顺序）：
 * 1. `loginChainPage` → 不触发。依据见 `isLibLoginChainUrl()`：登录链自身的 200 登录页
 *    占 b17 冷启判定的 20/21，触发它就是重登风暴。
 * 2. `interactiveLogin` → 不触发（复用 `loginGate` 的 20s 冷却 + `libLoginPending()`）：
 *    用户正在输密码 / 2FA，登录链自己会走完，插一次全链恢复只会杀掉在飞的登录。
 * 3. `onLoginPage === false` → **立刻触发**：这是最强信号——应用自认为已登录
 *    （会话标记 ready）却收到登录失效判定，说明「运行中会话全灭」，不能干等。
 * 4. `onLoginPage === true && hasCreds === true` → 窗内累计到
 *    `LIB_EMPTY_SITE_ESCALATE_N` 次才触发（一次静默重登）；避免冷启瞬间登录链还在跑时抢跑。
 * 5. 其余（登录页 + 没有登录信息）→ 不触发：没有可用的登录信息，重登也回不来，
 *    该由登录页自己等用户操作。
 *
 * 本函数只做判定与计数：**任何**恢复动作都必须由调用方交共享单飞
 * （`runLibSoftSingleFlight`）执行，冷却语义（30s 起步 / 120s 封顶 / 手动清零）不变。
 */
export function judgeLibFullChainRecovery(args: {
  /** 应用当前是否停在登录页（`session.state !== "ready"`） */
  onLoginPage: boolean;
  /** 交互登录 / 2FA 是否进行中（loginGate 冷却或 lib 登录链未 settle） */
  interactiveLogin: boolean;
  /** 本机是否存有可用的已保存登录信息（「记住密码」） */
  hasCreds: boolean;
  /** 本次失败是否就是登录链自身的 200 登录页 */
  loginChainPage: boolean;
  now?: number;
}): LibFullChainEscalation {
  const now = args.now ?? Date.now();
  // 被闸掉的判定不计入窗（否则登录链自身的一串判定会把窗口填满、让下一次真异常秒升级）
  if (args.loginChainPage) {
    return { escalate: false, reason: "login-chain-page", hits: libEmptySiteHitCount(now) };
  }
  if (args.interactiveLogin) {
    return { escalate: false, reason: "interactive-login", hits: libEmptySiteHitCount(now) };
  }
  const hits = recordLibEmptySiteHit(now);
  if (!args.onLoginPage) return { escalate: true, reason: "ui-not-on-login-page", hits };
  if (!args.hasCreds) return { escalate: false, reason: "no-creds-on-login-page", hits };
  if (hits >= LIB_EMPTY_SITE_ESCALATE_N) {
    return { escalate: true, reason: `login-page-with-creds×${hits}`, hits };
  }
  return { escalate: false, reason: `login-page-with-creds×${hits}<${LIB_EMPTY_SITE_ESCALATE_N}`, hits };
}

/* ═══════════════ ④ 旁证日志脱敏 ═══════════════ */

/** 票据脱敏：只留前 12 位 + 省略号（绝不整串）。取 12 而非 8 的理由：
 *  wengine_vpn_ticket 形如 `wrdvpn1-<32 位 hex>`，前 8 位恒为固定前缀 `wrdvpn1-`，
 *  打 8 位等于没打；12 位才带上 4 位随机段，两仓票值可直接对照。空值给「(无)」。 */
export function maskLibTicket(value: string | null | undefined): string {
  const v = typeof value === "string" ? value : "";
  if (!v) return "(无)";
  return `${v.slice(0, 12)}…`;
}

/* ═══════════════ ⑤ 共享单飞 + 退避 ═══════════════ */

/** 静默重登最短间隔：30s 起步（保留——别把风控连锤放开）。 */
export const LIB_SOFT_MIN_INTERVAL_MS = 30_000;
/** 退避封顶：600s → 120s。理由：600s 会让一次失败把用户锁死十分钟
 *  （诊断里「被踢后长时间再也回不来」）；120s 仍能把自动重试压到
 *  「最多两分钟一次」，风控压力与 30s 起步同量级，手动路径又能立刻清零。 */
export const LIB_SOFT_BACKOFF_MAX_MS = 120_000;

let libSoftFailStreak = 0;
let libSoftCooldownUntil = 0;
/** b33（b31 收尾·第三条路径）：最近一次共享单飞恢复**真执行且成功**（`done`）的时刻。
 *  只读观测口，页面层在 `failed` 落 `backToLogin()` **之前**复核「本次加载期间 / 最近是否
 *  已有恢复成功」时用它做证据（见 `state/libSoftSettle.ts` 的 `libSoftSessionLooksAlive`）。
 *  只写不读、不参与任何判定，既有三态 / 单飞 / 冷却语义一行未改。 */
let libSoftLastDoneAt = 0;
/** 全局串行尾链：同一时刻只跑一条 lib 会话链（含按站点重建），防互烧票 */
let libSoftTail: Promise<unknown> = Promise.resolve();
/** >0 = 当前正在尾链内执行；链内嵌套调用直接内联执行（避免自锁死） */
let libSoftDepth = 0;
const libSoftInflight = new Map<string, Promise<LibSoftResult>>();

/* ── 三态（b19 P0）：把「真失败」与「根本没执行」分开 ──
 * 旧布尔返回把两种含义混成一个 `false`，`state/data.ts` 三处据此把用户置为登出
 * （b18 真机：运行中会话全灭时恢复落在占位冷却窗内、0ms 返回 false → 登录页且不自愈）。
 * - `done`    任务**真执行**且成功；
 * - `failed`  任务**真执行**但失败/抛错 —— **只有这一态可以触发登出**；
 * - `skipped` 任务**没有执行**：同键在飞（`reentrant`，防自锁的必需语义）或占位冷却
 *   窗内（`cooldown`）。`skipped` 仍**同步** resolve（绝不 `await` 自身），不推进 streak。 */
export type LibSoftState = "done" | "failed" | "skipped";
export type LibSoftSkipReason = "cooldown" | "reentrant";
export interface LibSoftResult {
  state: LibSoftState;
  /** 仅 `state === "skipped"` 时有值 */
  reason?: LibSoftSkipReason;
  /** 仅 `reason === "reentrant"` 时给出：外层在飞链的结果句柄（观察用）。
   *  **只允许在守卫之外 `await`**——在链内 await 它就是等自己（死锁）。 */
  pending?: Promise<LibSoftResult>;
}

export function libSoftCooldownLeftMs(now: number = Date.now()): number {
  return Math.max(0, libSoftCooldownUntil - now);
}

export function libSoftStreak(): number {
  return libSoftFailStreak;
}

/** b31（RC1）：只读观察——当前是否有 lib 会话恢复链在跑（全局尾链内执行 or 单飞表非空）。
 *  页面层冷却态自动重试用它做「有在飞恢复时不再叠加」的判定；不改变任何既有语义。 */
export function libSoftRecoveryInFlight(): boolean {
  return libSoftDepth > 0 || libSoftInflight.size > 0;
}

/** b33：只读——最近一次恢复**真成功**的时刻（`0` = 本进程内还没有过）。
 *  仅作页面层「failed 前复核会话是否其实是活的」的证据，不改变任何恢复语义。 */
export function libSoftLastDoneAtMs(): number {
  return libSoftLastDoneAt;
}

/** 手动路径（交互登录成功 / 用户点重试）清零 streak 与冷却（B 的空集计数窗一并清）。 */
export function resetLibSoftBackoff(): void {
  libSoftFailStreak = 0;
  libSoftCooldownUntil = 0;
  libEmptySiteHits = [];
}

/** 护栏用：只让当前冷却过期、保留 streak（验封顶值），不用于业务。 */
export function expireLibSoftCooldownForTest(): void {
  libSoftCooldownUntil = 0;
}

/** 护栏用：连冷却与单飞表一起复位 */
export function resetLibSoftStateForTest(): void {
  resetLibSoftBackoff();
  libSoftInflight.clear();
  libSoftTail = Promise.resolve();
  libSoftDepth = 0;
  libSoftLastDoneAt = 0;
}

function libSoftExclusive<T>(run: () => Promise<T>): Promise<T> {
  // 链内嵌套（如 ensureLibSessionFlow 里的按站点重建）直接执行：外层已独占
  if (libSoftDepth > 0) return run();
  const wrapped = (): Promise<T> => {
    libSoftDepth += 1;
    return run().finally(() => {
      libSoftDepth -= 1;
    });
  };
  const next = libSoftTail.then(wrapped, wrapped);
  libSoftTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * ⑤ 共享单飞 + 守卫前置（三态出口，b19 P0）：
 * - 同 key 在飞 → 复用同一 promise（并发只重建一次）；
 * - `cooldown:true`（默认）时**同步**读冷却、**同步**写占位冷却，之后才 await
 *   —— 五个入口并发不可能全部穿透守卫；
 * - 任务实际执行串在全局尾链上（链内嵌套内联），绝不并发互烧票；
 * - 结算时按 2 的幂退避（30s 起步、封顶 `LIB_SOFT_BACKOFF_MAX_MS`）。
 *
 * 两种「没执行」都返回**同步 resolve** 的 `skipped`（`Promise.resolve(...)`，
 * 绝不 `await` 自身）；只有真跑过的任务才可能得到 `done` / `failed`。
 */
export function runLibSoftSingleFlightResult(
  key: string,
  task: () => Promise<boolean>,
  opts: { cooldown?: boolean } = {},
): Promise<LibSoftResult> {
  const existing = libSoftInflight.get(key);
  if (existing) {
    // 链内再入同一键 = 等待自己 → 死锁。外层链已在处理该会话，同步回报 skipped，
    // 由外层结果决定；绝不 await 自身（`pending` 只给守卫之外的观察者）。
    if (libSoftDepth > 0) {
      return Promise.resolve({ state: "skipped", reason: "reentrant", pending: existing });
    }
    return existing;
  }
  const useCooldown = opts.cooldown !== false;
  if (useCooldown) {
    if (libSoftCooldownLeftMs() > 0) {
      return Promise.resolve({ state: "skipped", reason: "cooldown" }); // 守卫前置于任何 await
    }
    libSoftCooldownUntil = Date.now() + LIB_SOFT_MIN_INTERVAL_MS; // 先置占位再 await
  }
  const p = libSoftExclusive<LibSoftResult>(async () => {
    let ok = false;
    try {
      ok = await task();
    } catch {
      ok = false;
    }
    if (useCooldown) {
      libSoftFailStreak = ok ? 0 : libSoftFailStreak + 1;
      const backoff = Math.min(
        LIB_SOFT_MIN_INTERVAL_MS * 2 ** libSoftFailStreak,
        LIB_SOFT_BACKOFF_MAX_MS,
      );
      libSoftCooldownUntil = Date.now() + backoff;
    }
    if (ok) libSoftLastDoneAt = Date.now(); // b33：只读观测——恢复真成功（不参与判定）
    return { state: ok ? "done" : "failed" } as LibSoftResult;
  });
  libSoftInflight.set(key, p);
  void p.finally(() => {
    if (libSoftInflight.get(key) === p) libSoftInflight.delete(key);
  });
  return p;
}

/**
 * 旧布尔薄封装（b19 P0）：`state === "done"`。
 * 只关心「恢复拿到了吗」的既有调用点继续用它，语义与三态之前逐字一致
 * （`skipped` 与 `failed` 都折成 `false`）；需要区分两者的调用点用
 * `runLibSoftSingleFlightResult`。
 */
export function runLibSoftSingleFlight(
  key: string,
  task: () => Promise<boolean>,
  opts: { cooldown?: boolean } = {},
): Promise<boolean> {
  return runLibSoftSingleFlightResult(key, task, opts).then((r) => r.state === "done");
}
