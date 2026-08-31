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
export function onAuthRequired(cb: AuthListener): () => void {
  authListeners.add(cb);
  return () => authListeners.delete(cb);
}

export class AuthRequiredError extends Error {
  constructor(message = "会话已失效，需要重新登录") {
    super(message);
    this.name = "AuthRequiredError";
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
  #relogin: (() => Promise<void>) | null = null;

  /** 诊断现场：最后一次 text() 响应（URL + 状态 + 正文前 800 字）。
   *  info/learn 解析失败时由 UI 落盘到 /tmp/onethu-debug.log 定位。 */
  lastDebug = "";

  /** 最后一次请求的实际 wire 目标（包装后）。tauriFetch 不回传 response.url，
   *  lastDebug 必须显式区分"逻辑 URL"与"实际 wire URL"，否则排查会被误导。 */
  lastTarget = "";

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

  onAuthRequired(fn: () => Promise<void>): this {
    this.#relogin = fn;
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
    const PUBLIC_HOSTS = new Set([
      "learn.tsinghua.edu.cn",
      "webvpn.tsinghua.edu.cn",
      "id.tsinghua.edu.cn",
      "oauth.tsinghua.edu.cn",
      // info/card 与 learn 同款直连（wengine 代理路径实证不通；直连 + 客户端会话可用）
      "info.tsinghua.edu.cn",
      "card.tsinghua.edu.cn",
    ]);
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      /* 非 http URL 交由后续逻辑 */
    }
    let goDirect = direct === true;
    if (!goDirect && host) {
      goDirect = this.#webVPN ? host === "learn.tsinghua.edu.cn" : PUBLIC_HOSTS.has(host);
    }
    const target = this.webVPNEncoder && !goDirect && host && !PUBLIC_HOSTS.has(host)
      ? this.webVPNEncoder(url)
      : url;
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
      const physical = new URL(response.url || target);
      this.jar.setFromResponse(physical, response);
    } catch {
      /* 忽略畸形 URL */
    }
    return response;
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
      if (!cookies.length) return null;
      return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    } catch {
      return null;
    }
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
    if (this.#looksLoggedOut(body, response) && this.#relogin) {
      await this.#relogin();
      response = await this.request(url, init);
      body = await response.text();
      if (this.#looksLoggedOut(body, response)) {
        // 重登录一次后仍是登录页（电子身份/超时）→ 会话真死：
        // 抛 AuthRequired 触发桌面端看门狗整页重载，绝不把登录页当业务数据继续解析
        throw new AuthRequiredError("重登录后仍在登录页（电子身份服务系统），会话需要重建");
      }
      const wireNote2 = this.lastTarget && this.lastTarget !== url
        ? "[wire " + this.lastTarget.slice(0, 100) + "] " : "";
      this.lastDebug = wireNote2 +
        (response.url || url).slice(0, 160) + " status=" + response.status + " body=" +
        body.slice(0, 800).replace(/\s+/g, " ");
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

  #looksLoggedOut(body: string, response: Response): boolean {
    if (this.#relogin === null) return false;
    if (/\/do\/off\/ui\/auth\/login\//.test(response.url || "")) return true;
    // CAS 电子身份页（清华大学用户电子身份服务系统）：无 sm2publicKey/i_pass 特征，
    // 曾漏检 → 登录页被当业务数据解析。特征与 client/demoLogin 同串。
    if (/电子身份服务系统|清华大学用户电子身份|casLogin|j_acegi/i.test(body)) return true;
    return /id="sm2publicKey"/.test(body) || /name="i_pass"/.test(body);
  }
}
