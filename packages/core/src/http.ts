/**
 * 传输层：可插拔 fetch + CookieJar + WebVPN 透明包装 + 自动重登录。
 *
 * 设计要点（详见 docs/ARCHITECTURE.md）：
 * - core 不感知运行环境：fetch 由宿主注入（浏览器 / Tauri plugin-http / RN / Node）
 * - WebVPN 打开后，请求 URL 自动编码；Cookie 按物理响应 URL 记账（与浏览器同域行为一致）
 * - 会话失效由各 Client 识别并抛出 AuthRequiredError，由凭据提供者重登录后重放
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

import { decodeUrl } from "./crypto/webvpn.js";

export interface CookieRecord {
  name: string;
  value: string;
  domain: string;
  path: string;
  expiresAt?: number;
  hostOnly: boolean;
  secure: boolean;
}

export interface CookieJar {
  getCookies(url: URL): CookieRecord[];
  setFromResponse(physicalUrl: URL, response: Response): void;
  /** 直接注入一条原始 Set-Cookie 字符串（demo Cookie 字符串灌入用） */
  setRaw(physicalUrl: URL, setCookieLine: string): void;
  serialize(): string;
  hydrate(json: string): void;
  clear(domainSuffix?: string): void;
}

function parseSetCookieLine(line: string, requestHost: string): CookieRecord | null {
  const firstSemi = line.indexOf(";");
  if (firstSemi < 0) return null;
  const eq = line.indexOf("=");
  if (eq <= 0 || eq > firstSemi) return null;
  const name = line.slice(0, eq).trim();
  const value = line.slice(eq + 1, firstSemi).trim();
  if (!name) return null;

  const rec: CookieRecord = { name, value, domain: requestHost, path: "/", hostOnly: true, secure: false };
  for (const attr of line.slice(firstSemi + 1).split(";")) {
    const raw = attr.trim();
    const eq = raw.indexOf("=");
    const k = eq >= 0 ? raw.slice(0, eq) : raw;
    const v = eq >= 0 ? raw.slice(eq + 1) : "";
    const key = k.toLowerCase();
    if (key === "domain" && v) {
      rec.domain = v.replace(/^\./, "").toLowerCase();
      rec.hostOnly = false;
    } else if (key === "path" && v) {
      rec.path = v;
    } else if (key === "expires") {
      const t = Date.parse(v);
      if (!Number.isNaN(t)) rec.expiresAt = t;
    } else if (key === "max-age") {
      const s = Number(v);
      if (!Number.isNaN(s)) rec.expiresAt = s <= 0 ? 0 : Date.now() + s * 1000;
    } else if (key === "secure") {
      rec.secure = true;
    }
  }
  return rec;
}

/** 直连公共域（learn/id/oauth/webvpn/info/card）：供传输层跳转包装判定复用。
 *  历史实证：info/card 的 wengine 代理路径不通，须直连——不能一刀切全包装。 */
// lib 单管线（P3）：info/learn 退出公网直连名单——两域全量走包装通道，
// 校内校外拓扑唯一（双环境适配的定案，docs/architecture.md §2）。
export const PUBLIC_DIRECT_HOSTS = new Set([
  "webvpn.tsinghua.edu.cn",
  "id.tsinghua.edu.cn",
  "oauth.tsinghua.edu.cn",
  // TUOJ（ai.tuoj.thusaac.com）是公网域，清华统一认证漫游与后续只读拉取一律直连，
  // 绝不能经 webvpn 包装（2026-09-18 TUOJ CAS 接入）
  "ai.tuoj.thusaac.com",
  // zhjw.cic.tsinghua.edu.cn 加白（2026-09-19）：教务二级课表 portal3rd.do 原
  // 走包装撞引导壳（教务 host 的 wengine 票从未建立——教务访问统一直连 JSONP）
  // → setInitValue 解析不到 → 二级实验课静默空。校外直连可达（课表 JSONP 同
  // 域直连一直是活的），且教务会话就建在直连桶——同桶同活法。
  "zhjw.cic.tsinghua.edu.cn",
  // MadModel（madmodel.cs.tsinghua.edu.cn）加白（2026-09-20）：校园网免费档
  // token 签发必须在校园网 IP 下直连；经 webvpn 包装会改变对端看到的来源，
  // 也让失败原因变得不可读。
  // ⚠ seat.lib.tsinghua.edu.cn 故意不在名单：webvpn 模式下座位系统全链（callback/
  //   home/book）必须同走包装通道；2026-09-07 实测加白名单反而通道分裂连累记录页。
  // card 退出直连（2026-09-06 真机实录）：oauth lbredirect 兑票落点恒为 webvpn
  // 包装 URL，会话建在包装通道；直连探测永远看不见 → 恒报「会话未能建立」。
  // 单通道（恒包装）与会话兑付同轨。
]);

export class MemoryCookieJar implements CookieJar {
  #map = new Map<string, CookieRecord>();

  getCookies(url: URL): CookieRecord[] {
    const host = url.hostname.toLowerCase();
    const now = Date.now();
    const out: CookieRecord[] = [];
    for (const rec of this.#map.values()) {
      if (rec.expiresAt !== undefined && rec.expiresAt <= now) {
        this.#map.delete(this.#key(rec));
        continue;
      }
      if (rec.secure && url.protocol !== "https:") continue;
      if (!this.#domainMatch(host, rec)) continue;
      if (!this.#pathMatch(url.pathname, rec.path)) continue;
      out.push(rec);
    }
    return out;
  }

  #domainMatch(host: string, rec: CookieRecord): boolean {
    if (rec.domain === host) return true;
    return !rec.hostOnly && host.endsWith(`.${rec.domain}`);
  }

  #pathMatch(requestPath: string, cookiePath: string): boolean {
    if (requestPath === cookiePath) return true;
    if (requestPath.startsWith(cookiePath)) {
      return cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/";
    }
    return false;
  }

  setRaw(physicalUrl: URL, setCookieLine: string): void {
    const rec = parseSetCookieLine(setCookieLine, physicalUrl.hostname.toLowerCase());
    if (rec) this.#map.set(this.#key(rec), rec);
  }

  setFromResponse(physicalUrl: URL, response: Response): void {
    // ① 逐跳精确通道（transport.ts 的 x-onethu-set-cookie-hops）：每条 Set-Cookie
    //    按其所在跳的 URL host 入账——跨域重定向链（info→zhjw 漫游、锚点兑付）
    //    的会话 cookie 必须各归各域，否则互相覆盖（19:47 info 被 zhjw 连带炸掉）。
    const hopsHeader = response.headers.get("x-onethu-set-cookie-hops");
    if (hopsHeader) {
      try {
        const hops = JSON.parse(hopsHeader) as Array<{ u: string; l: string }>;
        let used = false;
        for (const h of hops) {
          try {
            // 包装跳的 Set-Cookie 解码回真实应用域入账：wengine 各应用 cookie 同名
            // （zhjw/zhjwxk 都是 JSESSIONID），全记 webvpn 物理域会互踩（选课被教务
            // 会话顶掉的实锤）——按真实域分桶后 #cookieHeaderFor 的解码合并精确分发。
            const origin = decodeUrl(h.u);
            const host = new URL(origin ?? h.u).hostname.toLowerCase();
            const rec = parseSetCookieLine(h.l, host);
            if (rec) {
              this.#map.set(this.#key(rec), rec);
              used = true;
            }
          } catch {
            /* 跳过坏跳 */
          }
        }
        if (used) return;
      } catch {
        /* JSON 损坏则走下方兜底 */
      }
    }
    // ② 兜底：无逐跳通道时按物理响应 URL 记账（浏览器同域行为）
    // Tauri 传输层把原始 Set-Cookie 数组以 JSON 放进自定义头（头值禁止换行，WebKit 兼容）
    const explicit = response.headers.get("x-onethu-set-cookie");
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    let lines: string[];
    if (explicit) {
      try {
        lines = JSON.parse(explicit) as string[];
      } catch {
        lines = explicit.split("\n");
      }
    } else {
      lines = typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : (response.headers.get("set-cookie")?.split(/(?=Set-Cookie:)/gi) ?? []);
    }
    for (const line of lines) {
      const rec = parseSetCookieLine(line, physicalUrl.hostname.toLowerCase());
      if (rec) this.#map.set(this.#key(rec), rec);
    }
  }

  #key(rec: CookieRecord): string {
    return `${rec.domain}|${rec.path}|${rec.name}`;
  }

  serialize(): string {
    return JSON.stringify([...this.#map.values()]);
  }

  hydrate(json: string): void {
    try {
      const arr = JSON.parse(json) as CookieRecord[];
      this.#map = new Map(arr.map((rec) => [this.#key(rec), rec]));
    } catch {
      /* 容忍损坏的持久化数据，视为空罐 */
    }
  }

  clear(domainSuffix?: string): void {
    if (!domainSuffix) {
      this.#map.clear();
      return;
    }
    const suffix = domainSuffix.toLowerCase();
    for (const [key, rec] of this.#map) {
      if (rec.domain === suffix || rec.domain.endsWith(`.${suffix}`)) this.#map.delete(key);
    }
  }
}

/** 全局失登监听（硬刷新兜底模块的钩子）：任何模块抛 AuthRequiredError 都会广播。
 *  桌面端启动时安装一次 → 触发整页重载（2 分钟节流），给所有已稳定功能兜底。 */
type AuthListener = () => void;
const authListeners = new Set<AuthListener>();
/** 静默抑制期：后台自愈链（如场馆静默登录）自行处理失登时，避免误触全局重载 */
let authBroadcastSuspended = false;
export function suspendAuthBroadcast<T>(fn: () => Promise<T>): Promise<T> {
  authBroadcastSuspended = true;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      authBroadcastSuspended = false;
    });
}
export function onAuthRequired(cb: AuthListener): () => void {
  authListeners.add(cb);
  return () => authListeners.delete(cb);
}

export class AuthRequiredError extends Error {
  constructor(message = "会话已失效，需要重新登录") {
    super(message);
    this.name = "AuthRequiredError";
    if (authBroadcastSuspended) return; // 后台链自处理，不广播全局重载
    for (const cb of authListeners) {
      try {
        cb();
      } catch {
        /* 监听器异常不影响错误传播 */
      }
    }
  }
}

export interface HttpClientOptions {
  fetch?: FetchLike;
  jar?: CookieJar;
  userAgent?: string;
  webVPN?: boolean;
}

export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.88 Safari/537.36";

export class HttpClient {
  readonly jar: CookieJar;
  #fetch: FetchLike;
  #ua: string;
  #webVPN = false;
  // F3 ③（b17）：本类此前有一套「#looksLoggedOut 判登录页 → #relogin → 重放一次」的
  // 触发+重放（唯一注册点在 desktop 的 `http.onAuthRequired`）。触发面下移到
  // `nativeFetch` 后，同一失败会被判两次（本类一次 + 传输层一次），且本类拿到的
  // body 已由 nativeFetch 重放过——故整套删除，判据与重放语义收在
  // `apps/desktop/src/lib/libSessionGuard.ts`（共享单飞）。AuthRequiredError 与
  // 全局 onAuthRequired 广播不受影响。

  /** 诊断现场：最后一次 text() 响应（URL + 状态 + 正文前 800 字）。
   *  info/learn 解析失败时由 UI 落盘到 /tmp/onethu-debug.log 定位。 */
  lastDebug = "";

  /** 最后一次请求的实际 wire 目标（包装后）。tauriFetch 不回传 response.url，
   *  lastDebug 必须显式区分"逻辑 URL"与"实际 wire URL"，否则排查会被误导。 */
  lastTarget = "";
  /** 最近一次请求的最终落点 URL（重定向链终点；业务层判「被踢到错误页/登录页」用） */
  lastFinalUrl = "";

  /** 最后一次请求实际携带的 cookie 名单（诊断会话丢失用） */
  lastCookieNames = "";

  constructor(options: HttpClientOptions = {}) {
    this.#fetch = options.fetch ?? ((u, init) => fetch(u, init));
    this.jar = options.jar ?? new MemoryCookieJar();
    this.#ua = options.userAgent ?? DEFAULT_USER_AGENT;
    this.#webVPN = options.webVPN ?? false;
  }

  /** 由上层注入的 WebVPN URL 编码器，避免 core 内部循环依赖 */
  webVPNEncoder: ((url: string) => string) | null = null;

  get viaWebVPN(): boolean {
    return this.#webVPN;
  }

  get webVPNOn(): boolean {
    return this.#webVPN;
  }

  withWebVPN(on: boolean): this {
    this.#webVPN = on;
    return this;
  }

  /** 请求一次，自动带 cookie；物理响应的 Set-Cookie 记入 jar。
   *  init.direct=true 时绕过 WebVPN 包装（CAS/doubleAuth 必须与登录同一域直连）。 */
  async request(url: string, init: (RequestInit & { direct?: boolean }) = {}, attempt = 0): Promise<Response> {
    const { direct, ...rest } = init;
    // 传输分流规则（v6.1 定案）：
    // - learn.tsinghua.edu.cn：公网站点且会话 cookie 与 id CAS 同名（JSESSIONID），
    //   代理链互相干扰——实证直连有效，一律绕过包装。
    // - id/oauth/webvpn：登录链公共域，直连。
    // - 其余（info/zhjw.cic/zhjwxk.cic 等校内网关域名）：校外不可达，必须经 webvpn 包装。
    //   包装不再依赖 #webVPN 开关（开关只影响直连模式下公共域的判定）。
    const PUBLIC_HOSTS = PUBLIC_DIRECT_HOSTS;
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      /* 非 http URL 交由后续逻辑 */
    }
    const target = this.resolveUrl(url, { mode: direct === true ? "direct" : "auto" });
    const cookie = this.#cookieHeaderFor(target);
    this.lastTarget = target;
    this.lastCookieNames = cookie
      ? cookie.split(";").map((x) => x.trim().split("=")[0]).filter(Boolean).join(",")
      : "(none)";
    const headers = new Headers(init.headers);
    if (cookie && !headers.has("Cookie")) headers.set("Cookie", cookie);
    if (!headers.has("User-Agent")) headers.set("User-Agent", this.#ua);

    const response = await this.#fetch(target, { ...rest, headers });
    try {
      // transport 手工构造的 Response 没有 url 属性（重定向链终点经
      // x-onethu-final-url 头回传——真机实录：ErrorPage 兑付被 302 后
      // lastFinalUrl 仍指旧目标，电费判坏失效）
      const physical = new URL(
        response.headers.get("x-onethu-final-url") || response.url || target,
      );
      this.lastFinalUrl = physical.toString();
      this.jar.setFromResponse(physical, response);
    } catch {
      /* 忽略畸形 URL */
    }
    return response;
  }

  /**
   * 传输分流判定（request 与 SDK resolve 的单一真源）：
   * - learn.tsinghua.edu.cn：公网站点且会话 cookie 与 id CAS 同名（JSESSIONID），
   *   代理链互相干扰——实证直连有效，一律绕过包装。
   * - id/oauth/webvpn：登录链公共域，直连。
   * - 其余校内网关域名：校外不可达，经 webvpn 包装（webVPNEncoder 存在时）。
   * mode："auto"=按实例模式现行规则；"direct"=强制直连；"webvpn"=强制包装
   * （直连白名单域不受强制影响，避免双重包装）。 */
  resolveUrl(url: string, opts: { mode?: "auto" | "webvpn" | "direct" } = {}): string {
    const mode = opts.mode ?? "auto";
    const PUBLIC_HOSTS = PUBLIC_DIRECT_HOSTS;
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      return url;
    }
    if (!host) return url;
    let goDirect: boolean;
    if (mode === "direct") {
      goDirect = true;
    } else if (mode === "webvpn") {
      goDirect = false;
    } else {
      // 2026-09-13 回滚记录：id/oauth 直连化破坏了 webvpn 包装的会话隔离（手机
      // webvpn 桶与桌面直连桶的单会话互踢）。「非校园网适配」的精髓就是这层隔离。
      goDirect = this.#webVPN ? host === "learn.tsinghua.edu.cn" : PUBLIC_HOSTS.has(host);
    }
    return this.webVPNEncoder && !goDirect && !PUBLIC_HOSTS.has(host)
      ? this.webVPNEncoder(url)
      : url;
  }

  #cookieHeaderFor(targetUrl: string): string | null {
    try {
      let cookies = this.jar.getCookies(new URL(targetUrl));
      // 包装 URL：合并真实域的会话 cookie（wrapped id 跳需要 id 桶 JSESSIONID，
      // 否则漫游链的 CAS 中间跳看不到 SSO 会话——demo 扁平 jar 天然带上的那份）
      const origin = decodeUrl(targetUrl);
      if (origin) {
        const appCookies = this.jar.getCookies(new URL(origin));
        if (appCookies.length) {
          const names = new Set(appCookies.map((c) => c.name));
          cookies = [...appCookies, ...cookies.filter((c) => !names.has(c.name))];
        }
      }
      // OneTHU 适配（2026-09-17）：webvpn 物理域的 wengine 票不外发——陈旧
      // 匿名票（wrdvpn1-）会被服务器优先采信，把已登录 IP 的请求弹回登录页，
      // 旧跳循环不认门户落地 → 重定向 25 超限（宿舍/选课/工资页全军覆没）。
      // 裸发让 wengine 按 IP 续会话（与 lib/rust 世界同语义）；新发票照常入账。
      const targetHost = new URL(targetUrl).hostname;
      if (targetHost === "webvpn.tsinghua.edu.cn") {
        cookies = cookies.filter((c) => c.name !== "wengine_vpn_ticket" && !c.name.startsWith("show_") && c.name !== "heartbeat" && c.name !== "refresh");
      }
      if (!cookies.length) return null;
      return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    } catch {
      return null;
    }
  }

  /** 导出对某 URL 当前应带的 Cookie 头（供内嵌反代等外部管道复用会话） */
  cookieHeaderFor(targetUrl: string): string | null {
    return this.#cookieHeaderFor(targetUrl);
  }

  /** 真·wengine 引导页（interstitial）：vars 齐全 + 页面极短 + 无任何业务/登录文案。
   *  注意 wengine 会把 __vpn_* JS 注入所有被代理页面，长页面带 vars ≠ 引导页。 */
  wengineInterstitial(page: string): boolean {
    return (
      page.length < 4000 &&
      page.includes("__vpn_hostname_data") &&
      page.includes("__vpn_app_hostname_data") &&
      !/电子身份服务系统|用户登陆超时|casLogin|登录成功|j_acegi/i.test(page)
    );
  }

  /** 宿主可注入的调试通道（桌面端写 /tmp/onethu-debug.log） */
  debug?: (line: string) => void;
  /** 引导页票种同时播种到原生仓（jar→rust 桥；fetch 走原生通道的实例必接） */
  nativeSeedHook?: (url: string, cookiePair: string) => void;
  /** wengine 注入页（含 __vpn_*）时把较完整 body 送调试通道——定位引导页 vs 被代理登录页 */
  #emitDebug(body: string): void {
    if (!this.debug) return;
    if (body.includes("__vpn_hostname_data")) {
      this.debug(
        "[HTTP-WENGINE] cookies=" + this.lastCookieNames + " body(" + body.length + ")=" +
          body.slice(0, 10000).replace(/\s+/g, " ") +
          " ...TAIL... " + body.slice(-1500).replace(/\s+/g, " "),
      );
    }
  }

  /** GET 并解析为文本；wengine 引导页补救 + 登录页特征检测 + 自动重登录重放 */

  async text(url: string, init: (RequestInit & { direct?: boolean }) = {}): Promise<string> {
    let response = await this.request(url, init);
    // myhome 等老站是 GBK；按 Content-Type charset 解码，别拿 UTF-8 硬解（否则中文
    // 全成 U+FFFD，回传按钮值变乱码被服务器 400、门户正则/登录探测全部失灵）
    let body = await response.text();
    const wireNote = this.lastTarget && this.lastTarget !== url
      ? "[wire " + this.lastTarget.slice(0, 100) + "] " : "";
    this.lastDebug = wireNote + "cookies=" + this.lastCookieNames + " " +
      (response.url || url).slice(0, 160) + " status=" + response.status + " body=" +
      body.slice(0, 800).replace(/\s+/g, " ");
    this.#emitDebug(body);
    // wengine 引导页：包装请求返回 __vpn_hostname_data 页 = wengine 要求客户端
    // 先经 /wengine-vpn/cookie?method=get 领取目标域 cookie 串再重放原请求
    // （浏览器里由 wengine main.js 完成；demo GET_COOKIE_URL / 网络层同机制）。
    // 真·引导页（interstitial）才做 dance；被代理页面注入的 __vpn_* JS 不算
    if (this.wengineInterstitial(body)) {
      const merged = await this.#wengineBootstrapCookies(url, this.lastTarget ?? "", body);
      if (merged > 0) {
        response = await this.request(url, init);
        body = await response.text();
        const wireNoteB = this.lastTarget && this.lastTarget !== url
          ? "[wire " + this.lastTarget.slice(0, 100) + "] " : "";
        this.lastDebug = wireNoteB + "cookies=" + this.lastCookieNames + " " +
          (response.url || url).slice(0, 160) + " status=" + response.status + " body=" +
          body.slice(0, 800).replace(/\s+/g, " ");
        this.#emitDebug(body);
      }
    }
    return body;
  }

  /**
   * wengine 引导页补救：GET /wengine-vpn/cookie?method=get&host=<host>&scheme=…&path=…&vpn_timestamp=…
   * → 响应体即目标域 cookie 串（wengine main.js "vpn_update_cookie" 同款；
   *   demo tauriHttp 对 wengine-vpn/cookie 响应做同款 body→jar 并入）。
   * host 参数依次尝试：引导页 __vpn_app_hostname_data（wengine 应用码，main.js 的
   * app_hostname 即取自该值）→ 真实域名（demo GET_COOKIE_URL 对 info 用真实域名的形态）。
   * 两种来源的 cookie 全部并入（webvpn 域 + 目标应用域），再补 refresh=0。
   * 返回并入的 cookie 条数（0 = 未取得有效 cookie 串）。
   */
  async #wengineBootstrapCookies(logicalUrl: string, wireTarget: string, body: string): Promise<number> {
    let u: URL;
    try {
      u = new URL(logicalUrl);
    } catch {
      return 0;
    }
    const appCode = /__vpn_app_hostname_data["']?\s*[:=]\s*"([^"]+)"/.exec(body)?.[1];
    const appScheme = /__vpn_app_protocol_data["']?\s*[:=]\s*"([^"]+)"/.exec(body)?.[1];
    const realScheme = u.protocol.replace(":", "");
    const scheme = appScheme || realScheme;
    const hosts = [...new Set([appCode, u.hostname].filter((h): h is string => Boolean(h)))];
    const targets = ["https://webvpn.tsinghua.edu.cn/", `${u.protocol}//${u.hostname}/`];
    let merged = 0;
    for (const host of hosts) {
      const qp = new URLSearchParams({
        method: "get",
        host,
        scheme,
        path: u.pathname + u.search,
        vpn_timestamp: String(Date.now()),
      });
      const cookieUrl = `https://webvpn.tsinghua.edu.cn/wengine-vpn/cookie?${qp.toString()}`;
      const res = await this.request(cookieUrl, {
        headers: wireTarget ? { Referer: wireTarget.slice(0, 200) } : {},
      }).catch(() => null);
      const text = res ? await res.text().catch(() => "") : "";
      if (!text || /[<>]/.test(text)) continue;
      for (const pair of text.split(/;|\n/)) {
        const t = pair.trim();
        if (/^[A-Za-z0-9_.%-]+=/.test(t)) {
          for (const d of targets) {
            try {
              this.jar.setRaw(new URL(d), `${t}; Path=/`);
              this.nativeSeedHook?.(d, t);
              merged++;
            } catch {
              /* 容忍个别坏值 */
            }
          }
        }
      }
    }
    try {
      this.jar.setRaw(new URL("https://webvpn.tsinghua.edu.cn/"), "refresh=0; Path=/");
    } catch {
      /* ignore */
    }
    return merged;
  }

  async json<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
    const body = await this.text(url, init);
    try {
      return JSON.parse(body) as T;
    } catch {
      // 学习接口会话失效时常返回 HTML 登录页
      throw new AuthRequiredError();
    }
  }

  async postForm(url: string, body: FormData | URLSearchParams): Promise<string> {
    return this.text(url, { method: "POST", body });
  }

  /** 学习系统 DataTables 风格 aoData 表单 */
  async postAoData(url: string, params: Record<string, unknown>): Promise<string> {
    const body = new URLSearchParams({
      aoData: JSON.stringify(Object.entries(params).map(([name, value]) => ({ name, value }))),
    });
    return this.text(url, { method: "POST", body });
  }
}
