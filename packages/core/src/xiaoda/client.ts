/**
 * 清小搭（www.xiaoda.tsinghua.edu.cn 校园 AI 学伴）客户端。
 *
 * 鉴权链（scripts/xiaoda-probe.mts 实测定稿，2026-10-15）——与微信零耦合：
 *  1. GET ITS 服务表单（清小搭专属 service d982b7…）→ 提取 #sm2publicKey
 *  2. POST /do/off/ui/auth/login/check（learn-lib 字段集；受信指纹免 2FA；
 *     不发 singleLogin——那是「踢掉其他会话」）→ 成功页锚点 …/login.html?ticket=<漫游票>
 *  3. GET /api/token/login?ticket=… → { code:0, data:{ token: JWT(≈30 天), … } }
 *  4. 此后全部请求带自定义头 `token: <JWT>`（不是 Authorization Bearer）
 *
 * 探针教训（留档防重蹈）：
 *  - 表单页首个 `<form>` 是语言切换表单（/f/common/public/locale/change），
 *    登录表单由 JS 提交到 check 端点——勿用 form action；
 *  - ITS 漫游不走 webvpn 隧道（隧道内无应用会话，wengine 弹回 /login）；
 *    demoLogin 尾串的 JSESSIONID 也不足以直连出票（须对目标 service 完整登录）；
 *  - 业务失败也回 HTTP 200 + code!=0；鉴权失效是 code 2001 /「token 无效」；
 *  - /v1/chat/completions 是真实 OpenAI 兼容端点（SSE 流式），model 须
 *    "agent:<id>"（须为 UAP 路由已注册的智能体；默认助手 9999 不在其中，
 *    服务端错误原文透传即可——实验页的诚实行为）。
 */
import { encryptPassword } from "../crypto/sm2.js";
import { DEFAULT_USER_AGENT } from "../http.js";

export const XIAODA_BASE = "https://www.xiaoda.tsinghua.edu.cn";
const ITS_LOGIN_SVC = "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/d982b795884e882abfa8ff3167aeb03e/0?/login.html";
const CAS_CHECK = "https://id.tsinghua.edu.cn/do/off/ui/auth/login/check";
/** id SSO 确认页取票端点（id 会话活着时的第三形态，见 info/client.ts #idCheckSingle） */
const CAS_CHECK_SINGLE = "https://id.tsinghua.edu.cn/do/off/ui/auth/login/checkSingle";

export type XiaodaFetch = (url: string, init?: RequestInit) => Promise<Response>;

export class XiaodaApiError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "XiaodaApiError";
    this.code = code;
  }
}

export class XiaodaAuthRequiredError extends Error {
  constructor(message = "清小搭登录已失效") {
    super(message);
    this.name = "XiaodaAuthRequiredError";
  }
}

export class XiaodaLoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XiaodaLoginError";
  }
}

export interface XiaodaUser {
  uniqueId: string;
  name: string;
  zjh: string;
  phone?: string;
  yhlb?: string;
  icon?: string;
}

export interface XiaodaAgentMember {
  uniqueId: string;
  name: string;
  icon?: string;
  description?: string;
  objType?: number;
  status?: number;
}

export interface XiaodaAgentGroup {
  uniqueId: string;
  name: string;
  description?: string;
  members: XiaodaAgentMember[];
}

export interface XiaodaSkillCategory {
  code: string;
  name: string;
  count: number;
  summary?: string;
}

export interface XiaodaSkillItem {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  category?: string;
  categoryName?: string;
  downloadCount?: number;
  authorName?: string;
  version?: string;
}

export interface XiaodaSkillOverview {
  skillCount: number;
  contributorCount: number;
  downloadCount: number;
}

/** 对话内的一条消息（role：1=用户、2=AI —— soda 后端口径，2026-10-15 实测） */
export interface XiaodaChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinkContent: string;
  agentId: string;
  agentName: string;
  agentIcon: string;
}

export interface XiaodaConversation {
  convId: string;
  query: string;
  createTime?: string | number;
  state?: number;
  agentId?: string;
  agentIcon?: string;
  isDeepResearch?: boolean;
}

export interface XiaodaModel {
  id: number;
  name: string;
  iconUri?: string;
  isDefault?: boolean;
}

export interface XiaodaDadouBalance {
  userUniqueId?: string;
  balance: number;
  totalEarned: number;
  totalSpent: number;
}

interface PageEnvelope<T> {
  page?: { totalCount?: number; totalPage?: number; currentPage?: number };
  dataList?: T[];
}

/** cookie 串归并（同名覆盖；链内新发优先） */
function mergeCookies(base: string, chain: Map<string, string>): string {
  const pairs = new Map<string, string>();
  for (const part of base.split("; ")) {
    const i = part.indexOf("=");
    if (i > 0) pairs.set(part.slice(0, i), part.slice(i + 1));
  }
  for (const [k, v] of chain) pairs.set(k, v);
  return [...pairs].map(([k, v]) => `${k}=${v}`).join("; ");
}

/** 从响应体/终址里抠 ITS 漫游票（多形态兜底：严格锚点 → 任意锚点 → 全文扫 → 终址 query） */
function extractTicket(html: string, url: string): string {
  const fromUrl = (u: string): string => {
    try {
      return new URL(u).searchParams.get("ticket") ?? "";
    } catch {
      return "";
    }
  };
  const strict = /<a[^>]+href="([^"]*ticket=[^"]*)"/i.exec(html)?.[1];
  if (strict) {
    const t = fromUrl(strict) || decodeURIComponent((strict.split("ticket=").slice(-1)[0] ?? "").split("&")[0] ?? "");
    if (t) return t;
  }
  const anyAnchor = /<a[^>]+href="([^"]+)"/i.exec(html)?.[1];
  if (anyAnchor) {
    const t = fromUrl(anyAnchor);
    if (t) return t;
  }
  const scan = /[?&;]ticket=([A-Za-z0-9._~%+\-]{8,})/.exec(html)?.[1];
  if (scan) return decodeURIComponent(scan);
  return fromUrl(url);
}

/** 抠出页面里的隐藏字段（checkSingle 等确认页要原样回传，浏览器就是这么提交的） */
function parseHiddenFields(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const tagRe = /<input[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    const tag = m[0];
    if (!/type=["']hidden["']/i.test(tag)) continue;
    const name = /name=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!name) continue;
    out[name] = /value=["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
  }
  return out;
}

/** 出错时给一小段正文，便于定位服务端到底回了什么 */
function snippet(html: string, n = 160): string {
  return html.replace(/\s+/g, " ").slice(0, n);
}

function safeJson(text: string): Record<string, unknown> {
  try {
    const j = JSON.parse(text);
    return typeof j === "object" && j !== null ? (j as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** JWT exp（毫秒）；解不出回 null（视为「不预判过期」） */
export function xiaodaTokenExpiresAt(token: string): number | null {
  try {
    const payload = token.split(".")[1] ?? "";
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "="));
    const j = safeJson(bin);
    const exp = j.exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

interface ReqOpts {
  cookies?: string;
  data?: Record<string, string>;
  headers?: Record<string, string>;
}

export class XiaodaClient {
  private fetchLike: XiaodaFetch;
  private log: (line: string) => void;
  token = "";
  user: XiaodaUser | null = null;

  constructor(opts: { fetch: XiaodaFetch; log?: (line: string) => void }) {
    this.fetchLike = opts.fetch;
    this.log = opts.log ?? (() => undefined);
  }

  setToken(token: string): void {
    this.token = token;
  }

  getToken(): string {
    return this.token;
  }

  hasToken(): boolean {
    return this.token !== "";
  }

  tokenExpiresAt(): number | null {
    return this.token ? xiaodaTokenExpiresAt(this.token) : null;
  }

  /** 手动跟跳的单次请求（字符串 cookie 模型；Set-Cookie 同名覆盖）——探针同款 */
  private async req(
    method: "GET" | "POST",
    url: string,
    opts: ReqOpts = {},
  ): Promise<{ url: string; html: string; cookies: string; status: number }> {
    let cookies = opts.cookies ?? "";
    let currentUrl = url;
    let m = method;
    let body: string | undefined = opts.data ? new URLSearchParams(opts.data).toString() : undefined;
    const chain = new Map<string, string>();
    for (let hop = 0; hop < 14; hop++) {
      const headers: Record<string, string> = {
        "User-Agent": DEFAULT_USER_AGENT,
        ...(opts.headers ?? {}),
      };
      const pairs = new Map<string, string>();
      for (const pair of cookies.split("; ")) {
        const i = pair.indexOf("=");
        if (i > 0) pairs.set(pair.slice(0, i), pair.slice(i + 1));
      }
      for (const [k, v] of chain) pairs.set(k, v);
      if (pairs.size > 0) headers.Cookie = [...pairs].map(([k, v]) => `${k}=${v}`).join("; ");
      if (body !== undefined && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
      }
      const res = await this.fetchLike(currentUrl, { method: m, body, headers, redirect: "manual" });
      // nativeFetch 自己跟跳（忽略 init.redirect），真实终址在 x-onethu-final-url 上——
      // ITS 302 出票时票就在终址 query 里，不读它就会「票在眼前却看不见」
      const finalUrl = res.headers.get("x-onethu-final-url") ?? currentUrl;
      // Set-Cookie 双通道：标准 getSetCookie + nativeFetch 显式回传的 x-onethu-set-cookie（JSON 数组）
      const setCookieLines: string[] = [...(res.headers.getSetCookie?.() ?? [])];
      const jsonSetCookies = res.headers.get("x-onethu-set-cookie");
      if (jsonSetCookies) {
        try {
          const arr: unknown = JSON.parse(jsonSetCookies);
          if (Array.isArray(arr)) {
            for (const c of arr) if (typeof c === "string") setCookieLines.push(c);
          }
        } catch {
          /* 容忍非法 JSON */
        }
      }
      for (const sc of setCookieLines) {
        const mm = /^ *([^=;]+)=([^;]*)/.exec(sc);
        if (mm?.[1]) chain.set(mm[1].trim(), mm[2] ?? "");
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (loc && loc !== "null") {
          currentUrl = new URL(loc, currentUrl).toString();
          if (res.status === 303 || ((res.status === 301 || res.status === 302) && m === "POST")) {
            m = "GET";
            body = undefined;
          }
          continue;
        }
      }
      return { url: finalUrl, html: await res.text(), cookies: mergeCookies(cookies, chain), status: res.status };
    }
    throw new XiaodaApiError(0, "重定向超限（清小搭登录链）");
  }

  /**
   * 直连登录 / 会话漫游出票 → 换内部 JWT（两种形态都要吃下）：
   *  - **已认证的 id 会话**（OneTHU 平时的状态）：「随要随发票」——请求 service 表单会直接
   *    出票（302 链或成功页锚点），**没有 SM2 公钥、也不该再 POST 密码**；
   *  - **未认证**：表单带 #sm2publicKey → POST check（受信指纹免 2FA）→ 锚点出票。
   * 2026-10-15 应用内实测教训：旧实现只认第二条，于是在应用里（第一条）拿不到公钥就抛错，
   * 而票其实已经给了——本次修掉；顺带用 x-onethu-final-url 读 nativeFetch 的跟跳终址。
   */
  async authorizeTicket(username?: string, password?: string, fingerprint = "", finger3 = "",entryMode:0|1|'default'=0): Promise<{ticket:string;html:string;url:string;status:number}> {
    if(entryMode!==0&&entryMode!==1&&entryMode!=='default')throw new XiaodaLoginError('Invalid identity entry mode');
    const form = await this.req("GET", entryMode===0?ITS_LOGIN_SVC:entryMode==='default'?ITS_LOGIN_SVC.replace('/0?','?'):ITS_LOGIN_SVC.replace('/0?','/1?'));
    const authFlag = /"authenticated"\s*:\s*(true|false)/.exec(form.html)?.[1] ?? "?";
    let ticket = extractTicket(form.html, form.url);
    let last: { html: string; url: string; status: number } = form;
    this.log(
      `xiaoda login form status=${form.status} len=${form.html.length} ticket=${ticket ? "yes" : "no"} auth=${authFlag}`,
    );
    // ①b id SSO 确认页（<title>Title</title> + action=.../checkSingle + 无 sm2publicKey）：
    //     id 会话活着时不再要密码，只 POST 指纹确认继续（与 info/client.ts #idCheckSingle 同款）。
    //     2026-10-15 实测：应用内（会话活着）走的就是这一形态。
    if (!ticket && /checkSingle/.test(form.html)) {
      const formAction = /<form[^>]+action=["']([^"']+)["']/i.exec(form.html)?.[1] ?? "";
      const csUrl = formAction ? new URL(formAction, "https://id.tsinghua.edu.cn/").toString() : CAS_CHECK_SINGLE;
      if (csUrl !== CAS_CHECK_SINGLE) throw new XiaodaLoginError("学校确认页地址异常");
      const hidden = parseHiddenFields(form.html);
      for (const name of Object.keys(hidden)) if (/singleLogin|deviceName/i.test(name)) delete hidden[name];
      const cs = await this.req("POST", csUrl, {
        cookies: form.cookies,
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        data: {
          ...hidden,
          i_rememberme: "on",
          fingerPrint: fingerprint,
          fingerGenPrint: finger3,
          fingerGenPrint3: finger3,
        },
      });
      last = cs;
      ticket = extractTicket(cs.html, cs.url);
      this.log(
        `xiaoda login confirm status=${cs.status} ticket=${ticket ? "yes" : "no"}`,
      );
    }
    if (!ticket) {
      const key = /id="sm2publicKey"[^>]*>\s*([0-9a-fA-F]{100,})\s*</.exec(form.html)?.[1] ?? "";
      this.log(`xiaoda login ① SM2 公钥=${key ? "yes" : "no"}`);
      if (!key) throw new XiaodaLoginError(`登录页既无漫游票也无 SM2 公钥：${snippet(form.html)}`);
      if (!password) {
        throw new XiaodaLoginError("需要账号密码完成登录，但本机未记住密码（设置里勾选「记住密码」后重试）");
      }
      const check = await this.req("POST", CAS_CHECK, {
        cookies: form.cookies,
        data: {
          i_user: username ?? "",
          i_pass: encryptPassword(password, key),
          fingerPrint: fingerprint,
          fingerGenPrint: finger3,
          fingerGenPrint3: finger3,
          i_captcha: "",
        },
      });
      last = check;
      ticket = extractTicket(check.html, check.url);
      this.log(`xiaoda login credentials status=${check.status} ticket=${ticket ? "yes" : "no"}`);
      if (!ticket && /二次认证|doubleauth|双因素/i.test(check.html) && !/登录成功|正在重定向/.test(check.html)) {
        throw new XiaodaLoginError("触发了二次认证（受信指纹未生效）；请先在 OneTHU 主登录过一次 2FA 并信任本设备");
      }
    }
    if (!ticket) throw new XiaodaLoginError(`登录未出票：${snippet(last.html)}`);
    return {ticket,html:last.html,url:last.url,status:last.status};
  }

  async login(username?: string, password?: string, fingerprint = "", finger3 = ""): Promise<XiaodaUser> {
    const {ticket}=await this.authorizeTicket(username,password,fingerprint,finger3);
    const ex = await this.req("GET", `${XIAODA_BASE}/api/token/login?ticket=${encodeURIComponent(ticket)}`);
    const j = safeJson(ex.html);
    const data = (j.data ?? {}) as Record<string, unknown>;
    const tok = typeof data.token === "string" ? data.token : "";
    if (j.code !== 0 || !tok) {
      throw new XiaodaLoginError(
        `token 兑换失败（HTTP ${ex.status}）：${typeof j.message === "string" ? j.message : snippet(ex.html)}`,
      );
    }
    this.token = tok;
    this.user = {
      uniqueId: typeof data.uniqueId === "string" ? data.uniqueId : "",
      name: typeof data.name === "string" ? data.name : "",
      zjh: typeof data.zjh === "string" ? data.zjh : "",
    };
    this.log("xiaoda login successful");
    return this.user;
  }

  /** 业务 GET（token 头；code 2001/token 无效 → XiaodaAuthRequiredError） */
  private async apiGet<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    if (!this.token) throw new XiaodaAuthRequiredError("未登录（无 token）");
    const qs = params
      ? "?" +
        new URLSearchParams(
          Object.entries(params)
            .filter(([, v]) => v !== undefined && v !== "")
            .map(([k, v]) => [k, String(v)] as [string, string]),
        ).toString()
      : "";
    const res = await this.fetchLike(`${XIAODA_BASE}${path}${qs}`, { headers: { token: this.token } });
    const text = await res.text();
    const j = safeJson(text);
    if (!res.ok && j.code === undefined) throw new XiaodaApiError(res.status, text.slice(0, 160));
    if (j.code === 0) return (j.data ?? (null as unknown)) as T;
    const msg = typeof j.message === "string" ? j.message : text.slice(0, 160);
    if (j.code === 2001 || /token 无效|token 为空/.test(msg)) throw new XiaodaAuthRequiredError(msg);
    throw new XiaodaApiError(typeof j.code === "number" ? j.code : res.status, msg);
  }

  async getUserInfo(): Promise<XiaodaUser> {
    const u = await this.apiGet<XiaodaUser>("/api/token/getUserInfo");
    this.user = u;
    return u;
  }

  async dadouBalance(): Promise<XiaodaDadouBalance> {
    return this.apiGet<XiaodaDadouBalance>("/api/dadou/balance");
  }

  async builtinGroups(): Promise<XiaodaAgentGroup[]> {
    return this.apiGet<XiaodaAgentGroup[]>("/api/group/builtin/list");
  }

  async skillCategories(): Promise<XiaodaSkillCategory[]> {
    return this.apiGet<XiaodaSkillCategory[]>("/api/skill/plaza/categories");
  }

  async skillOverview(): Promise<XiaodaSkillOverview> {
    return this.apiGet<XiaodaSkillOverview>("/api/skill/plaza/overview");
  }

  async skillList(currentPage = 1, pageSize = 10): Promise<PageEnvelope<XiaodaSkillItem>> {
    return this.apiGet<PageEnvelope<XiaodaSkillItem>>("/api/skill/plaza/list", { currentPage, pageSize });
  }

  async skillSearch(keyword: string, page = 1, pageSize = 10): Promise<PageEnvelope<XiaodaSkillItem>> {
    return this.apiGet<PageEnvelope<XiaodaSkillItem>>("/api/skill/plaza/search", { keyword, page, pageSize });
  }

  async skillDetail(id: string): Promise<XiaodaSkillItem> {
    return this.apiGet<XiaodaSkillItem>(`/api/skill/plaza/detail/${encodeURIComponent(id)}`);
  }

  async conversationPage(pageNum = 1, pageSize = 10): Promise<PageEnvelope<XiaodaConversation>> {
    return this.apiGet<PageEnvelope<XiaodaConversation>>("/api/conversation/page", { pageNum, pageSize });
  }

  /**
   * 读某对话的历史消息（GET /api/chats/list?convId=…，按时间顺序返回）。
   * 实测要点：**必须带 convId**，否则服务端回 "The system is busy"（那是缺参的伪装错误）。
   * 用于「接着历史对话继续聊」：载入消息 → 沿用同一 convId 再 POST /api/chats/ 即可。
   */
  async conversationMessages(convId: string): Promise<XiaodaChatMessage[]> {
    const list = await this.apiGet<unknown[]>("/api/chats/list", { convId });
    const out: XiaodaChatMessage[] = [];
    for (const raw of Array.isArray(list) ? list : []) {
      const m = raw as Record<string, unknown>;
      const av = (m.agentVO ?? {}) as Record<string, unknown>;
      const str = (v: unknown): string => (typeof v === "string" ? v : "");
      out.push({
        id: String(m.id ?? ""),
        role: m.role === 1 ? "user" : "assistant",
        content: str(m.content),
        thinkContent: str(m.thinkContent),
        agentId: str(av.agentId),
        agentName: str(av.name),
        agentIcon: str(av.icon),
      });
    }
    /* 服务端按 id **递减**返回（新的在前，2026-10-15 实测：同一轮的 AI 回答排在我的提问之前），
       界面要的是时间正序，故按 id 升序重排——否则会显示成「它的回答在我的话上方」。 */
    out.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
    return out.filter((m) => m.content.trim() !== "" || m.thinkContent.trim() !== "");
  }

  async customModels(): Promise<XiaodaModel[]> {
    return this.apiGet<XiaodaModel[]>("/api/opencoze/customModel/list");
  }

  /** 建会话（GET，data 即 convId）——原生对话的前置步骤 */
  async createConversation(): Promise<string> {
    const d = await this.apiGet<unknown>("/api/conversation/create");
    return typeof d === "string" ? d : "";
  }

  /**
   * **原生（soda）对话流** —— 清小搭「正常聊天」的真实协议（2026-10-15 抓包定稿）：
   *   POST /api/chats/（**带尾斜杠**）+ text/event-stream
   *   body = {generateType, convId, agentId, query, fileList, customModelId?}
   *   头 = token / Content-Type / env:prod / lang:zh
   * 每帧 data 是 JSON 信封 {code, message, data:{content, state, thinkState, convId?, title?, agentVO}}，
   * content 为增量文本（逐 token，需累加）。
   * 为什么不用 /v1/chat/completions：那是「智能体广场/UAP 接入」路由，只认广场已注册智能体，
   * 9999 与内置组成员都会回「agent not registered in UAP route」——两码事。
   */
  async chatNative(opts: {
    agentId: string;
    query: string;
    convId: string;
    customModelId?: number;
    generateType?: "normal" | "follow";
    signal?: AbortSignal;
    onDelta: (text: string) => void;
    onMeta?: (meta: { convId?: string; title?: string; state?: number }) => void;
  }): Promise<{ content: string; convId: string }> {
    if (!this.token) throw new XiaodaAuthRequiredError("未登录（无 token）");
    const body: Record<string, unknown> = {
      generateType: opts.generateType ?? "normal",
      convId: opts.convId,
      agentId: opts.agentId,
      query: opts.query,
      fileList: [],
    };
    if (opts.customModelId !== undefined) body.customModelId = opts.customModelId;
    const res = await this.fetchLike(`${XIAODA_BASE}/api/chats/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        env: "prod",
        lang: "zh",
        "User-Agent": DEFAULT_USER_AGENT,
        token: this.token,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new XiaodaApiError(res.status, t.slice(0, 160) || `对话请求失败（HTTP ${res.status}）`);
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("event-stream")) {
      const t = await res.text().catch(() => "");
      throw new XiaodaApiError(0, `对话返回了非流式响应：${t.slice(0, 160)}`);
    }
    const reader = res.body?.getReader();
    if (!reader) throw new XiaodaApiError(0, "对话流不可读");
    const decoder = new TextDecoder();
    let buf = "";
    let full = "";
    let convId = opts.convId;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        const j = safeJson(payload);
        const code = typeof j.code === "number" ? j.code : 0;
        const msg = typeof j.message === "string" ? j.message : "";
        if (code !== 0 && code !== 200) throw new XiaodaApiError(code, msg || "对话失败");
        const data = (j.data ?? {}) as Record<string, unknown>;
        const piece = typeof data.content === "string" ? data.content : "";
        if (piece) {
          full += piece;
          opts.onDelta(piece);
        }
        const cid = typeof data.convId === "string" ? data.convId : undefined;
        if (cid) convId = cid;
        opts.onMeta?.({
          convId: cid,
          title: typeof data.title === "string" ? data.title : undefined,
          state: typeof data.state === "number" ? data.state : undefined,
        });
      }
    }
    return { content: full, convId };
  }

  /** 停止生成（best-effort：参数形状以会话 id 为准，失败忽略——UI 侧另有本地停止） */
  async stopChat(convId: string): Promise<void> {
    try {
      await this.apiGet<unknown>("/api/chats/stop", { convId });
    } catch {
      /* 忽略：本地停止已生效 */
    }
  }

  /** OpenAI 兼容对话（SSE 流式）；服务端错误原文透传（XiaodaApiError） */
  async chatStream(opts: {
    model: string;
    messages: { role: string; content: string }[];
    signal?: AbortSignal;
    onDelta: (text: string) => void;
  }): Promise<string> {
    const res = await this.fetchLike(`${XIAODA_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": DEFAULT_USER_AGENT,
        ...(this.token ? { token: this.token } : {}),
      },
      body: JSON.stringify({ model: opts.model, messages: opts.messages, stream: true }),
      signal: opts.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const j = safeJson(body);
      const err = (j.error ?? {}) as Record<string, unknown>;
      throw new XiaodaApiError(
        res.status,
        typeof err.message === "string" ? err.message : body.slice(0, 160),
      );
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("event-stream") || !res.body) {
      const body = await res.text();
      const j = safeJson(body);
      const err = (j.error ?? {}) as Record<string, unknown>;
      if (typeof err.message === "string") throw new XiaodaApiError(0, err.message);
      const choices = (j.choices ?? []) as { message?: { content?: string }; text?: string }[];
      const content = choices[0]?.message?.content ?? choices[0]?.text ?? "";
      if (content) opts.onDelta(content);
      return content;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let full = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]" || payload === "") continue;
        const j = safeJson(payload);
        const err = (j.error ?? {}) as Record<string, unknown>;
        if (typeof err.message === "string") throw new XiaodaApiError(0, err.message);
        const choices = (j.choices ?? []) as { delta?: { content?: string }; text?: string }[];
        const delta = choices[0]?.delta?.content ?? choices[0]?.text ?? "";
        if (delta) {
          full += delta;
          opts.onDelta(delta);
        }
      }
    }
    return full;
  }
}
