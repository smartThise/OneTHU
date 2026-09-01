/**
 * 网络学堂客户端（本科生视角）。
 * 登录 = CAS ticket 漫游 → 课程列表页抓 _csrf；接口失效自动重登录（retryAfterLogin）。
 */
import { AuthRequiredError, HttpClient } from "../http.js";
import * as urls from "./urls.js";
import type {
  CalendarData,
  CalendarSemester,
  CourseFile,
  CourseInfo,
  Homework,
  HomeworkPageDetail,
  LearnAttachment,
  LearnBbsTab,
  LearnBbsThreadSummary,
  LearnBbsPost,
  LearnBbsPostAttachment,
  LearnBbsThreadDetail,
  LearnGroup,
  Notification,
  NotificationPageDetail,
  SemesterInfo,
} from "./types.js";

interface LearnJson {
  result?: string;
  message?: string;
  resultList?: unknown[];
  object?: { aaData?: unknown[] } | unknown[];
  [k: string]: unknown;
}

function decodeHtml(s: unknown): string {
  const raw = String(s ?? "");
  if (!raw) return "";
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function decodeBase64Utf8(b64: string): string {
  try {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") {
    const o = v as { aaData?: unknown; resultsList?: unknown };
    // learn 各列表端点三种形态：裸数组 / object.aaData（DataTables）/ object.resultsList（通知/讨论）
    if (Array.isArray(o.aaData)) return o.aaData;
    if (Array.isArray(o.resultsList)) return o.resultsList;
  }
  return [];
}

const str = (v: unknown) => String(v ?? "");

/* ---------- 时间解析（对照 thu-app mobile：dayjs 直吃 learn 字符串，
 *  但 learn JSON 的时间字段形态不一，统一在此归一化，杜绝 NaN/Invalid Date） ----------
 *  实测形态：常规 "2025-10-01 12:30(:ss)"、日期-only "2025-09-01"、ISO 串、
 *  毫秒时间戳（数字或数字串）、.NET 前后缀 "/Date(1698150000000+0800)/"，
 *  以及非字符串时的 *Str 兜底字段（learn-lib: fbsj→fbsjStr；learnApi: jzsj→jzsjStr）。 */

/** learn 时间字段 → Date（本地时区语义，解析失败返回 null）。
 *  core 归一化与 UI（fmtDateTime/timeLeft）共用同一套解析。 */
export function parseLearnTime(raw: unknown): Date | null {
  if (raw === null || raw === undefined) return null;
  // 数字 / 10~14 位纯数字串 = 秒（10 位）或毫秒（13 位）时间戳
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return new Date(raw < 1e12 ? raw * 1000 : raw);
  }
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{10,14}$/.test(s)) {
    const n = Number(s);
    return new Date(n < 1e12 ? n * 1000 : n);
  }
  // .NET JSON 日期前后缀：/Date(1698150000000+0800)/
  const dotnet = /\/Date\((-?\d+)/.exec(s);
  if (dotnet?.[1]) return new Date(Number(dotnet[1]));
  // "YYYY-M-D H:m(:ss)" / "YYYY-M-D"：learn 服务器给的是本地时区语义，
  // 不能交给 Date.parse（"2025-10-01" 会被当 UTC）→ 手工拆解
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m?.[1] && m[2] && m[3]) {
    const [, y, mo, d, h = "0", mi = "0", se = "0"] = m;
    return new Date(+y, +mo - 1, +d, +h, +mi, +se);
  }
  // 其余（ISO 带 Z/偏移等）交给 Date.parse
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

/** learn 时间字段 → "YYYY-MM-DD HH:mm"（源为日期-only 时保留日期-only；未解析成功返回 ""，
 *  UI 侧不再出现 Invalid Date） */
function normalizeTime(raw: unknown, fallback?: unknown): string {
  const src =
    raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "") ? fallback : raw;
  const d = src === undefined || src === null ? null : parseLearnTime(src);
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateOnly =
    typeof src === "string" && /^\d{4}-\d{1,2}-\d{1,2}$/.test(src.trim())
      ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      : null;
  return dateOnly ?? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------- 我的分组（v_wlkc_qzcyb）解析 ----------
 * 金标准样例：分组页 beforePageWdfzList 为 DataTables（bServerSide）壳子，行由
 * /b/wlxt/qz/v_wlkc_qzcyb/student/pageFzList AJAX 注入（qzmc=组名 / qzmp=逗号分隔
 * 成员 / czr=创建人 / czsj=创建时间）；静态 HTML 里通常只有空 tbody。
 * 因此解析顺序：HTML 表格行 → 卡片/原始行兜底 → pageFzList JSON（页面自身数据源）。 */

/** 登录页特征（HttpClient #looksLoggedOut 同源标记）：命中说明会话失效 */
function looksLikeLoginHtml(html: string): boolean {
  return /j_spring_security_check|id="sm2publicKey"|name="i_pass"|\/do\/off\/ui\/auth\/login\//i.test(html);
}

/** 成员串 → 姓名数组：qzmp 逗号分隔（页面渲染时 replace(/,/g," ")），表格里为空格分隔 */
function splitMemberNames(s: string): string[] {
  return decodeHtml(s)
    .split(/[,，、;；\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function toMembers(names: string[], creator: string): LearnGroup["members"] {
  return names.map((n) => ({ name: n, role: creator && n === creator ? "创建人" : undefined }));
}

/** 宽容解析 HTML 表格行：td0=组名 td1=成员 td2=创建人 td3=创建时间 */
function parseGroupTables(html: string): LearnGroup[] {
  const out: LearnGroup[] = [];
  for (const tb of html.matchAll(/<tbody[^>]*>([\s\S]*?)<\/tbody>/gi)) {
    for (const tr of tb[1]!.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...tr[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((t) =>
        decodeHtml(t[1]!.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(),
      );
      const [name = "", membersRaw = "", creator = "", time = ""] = cells;
      if (!name && !membersRaw) continue;
      const names = splitMemberNames(membersRaw);
      if (!name && names.length === 0) continue;
      out.push({
        id: name || `group-${out.length}`,
        name: name || "未命名分组",
        members: toMembers(names, creator),
        creator: creator || undefined,
        createTime: normalizeTime(time) || undefined,
      });
    }
  }
  return out;
}

/** 表格也提不出结构时的最后兜底：取分组区块（searchcon 前最后一个 .detail）去掉标签，
 *  把剩余原始文本行塞进 members[].name（卡片式改版至少能看到内容），全噪声则返回空 */
const GROUP_LINE_NOISE =
  /^(我所在组|组成员|创建人|创建时间|我的分组|正在获取数据.*|暂无数据|没有您要搜索的内容|共\s*\d+\s*条.*|显示\s*\d+.*|第\s*\d+.*|首页|上页|下页|末页)$/;

function parseGroupRawLines(html: string): LearnGroup[] {
  // 取 searchcon（课内搜索面板）之前最后一个 .detail 区块 = 分组表格所在块；
  // 样例页上部还有隐藏的同 class 结构，取第一个会混入导航/模板噪声
  const stop = html.indexOf('id="searchcon"');
  let start = 0;
  if (stop > 0) {
    for (const m of html.matchAll(/class=["'][^"']*\bdetail\b[^"']*["']/gi)) {
      if (m.index >= stop) break;
      start = m.index;
    }
  } else {
    start = /class=["'][^"']*\bdetail\b[^"']*["']/i.exec(html)?.index ?? 0;
  }
  const region = html.slice(start, stop > 0 ? stop : Math.min(html.length, start + 30000));
  const lines = decodeHtml(
    region
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, "\n"),
  )
    .split(/\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    // {} <> 为漏网模板/标签碎片；长度 ≥2 过滤零散符号
    .filter((s) => s.length >= 2 && !/[{}<>]/.test(s) && !GROUP_LINE_NOISE.test(s));
  if (lines.length === 0) return [];
  return [
    {
      id: "raw",
      name: "分组信息（页面结构未识别，原始行）",
      members: lines.map((n) => ({ name: n })),
    },
  ];
}

/** pageFzList JSON 行 → LearnGroup（demo learnApi fetchGroupList 同源字段） */
function parseGroupJsonRow(raw: unknown, idx: number): LearnGroup | undefined {
  const d = raw as Record<string, unknown>;
  const rawMembers = d.qzmp ?? d.members;
  const memberStr = Array.isArray(rawMembers) ? rawMembers.map(str).join(",") : str(rawMembers);
  const names = splitMemberNames(memberStr);
  const name = decodeHtml(d.qzmc ?? d.fzmc ?? d.name).trim();
  if (!name && names.length === 0) return undefined;
  const creator = decodeHtml(d.czr ?? d.czz).trim();
  return {
    id: str(d.qzid ?? d.fzid ?? d.id) || name || `group-${idx}`,
    name: name || "未命名分组",
    members: toMembers(names, creator),
    creator: creator || undefined,
    createTime: normalizeTime(d.czsj) || undefined,
  };
}

/** queryxnxq 响应宽容解析（thu-learn-lib 4.0 getSemesterIdList 等价 + 兜底）：
 *  ① 金标准形态 = 裸 JSON 字符串数组（元素可能混 null，learn-lib: filter(s => s != null)）；
 *  ② JSONP 壳（callback([...]);）—— 剥壳后仍按数组解析；
 *  ③ HTML 学期下拉 —— 端点改吐页面时取 <option value="2024-2025-1">（去重、保序）。
 *  三路全空返回 []（由调用方决定是否走旧端点兜底）。 */
export function parseSemesterIdList(text: string): string[] {
  const raw = text.trim();
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = /^[^(]*\(([\s\S]*)\)\s*;?$/.exec(raw);
    if (m?.[1]) {
      try {
        parsed = JSON.parse(m[1]);
      } catch {
        /* 非 JSON，落 option 兜底 */
      }
    }
  }
  if (Array.isArray(parsed)) {
    // learn-lib 同款：filter 非 null 后取字符串（数字等异形元素 coerce 成串再滤空）
    const ids = parsed
      .filter((s) => s !== null && s !== undefined)
      .map((s) => String(s).trim())
      .filter((s) => /^\d{4}-\d{4}-\d$/.test(s));
    if (ids.length > 0) return [...new Set(ids)];
  }
  // ③ 学期下拉 option 值：value 属性优先，纯文本节点兜底
  const opts = new Set<string>();
  for (const m of raw.matchAll(/<option\b([^>]*)>([^<]*)/gi)) {
    const vm = /value=["']?([^"'>\s]*)["']?/i.exec(m[1] ?? "");
    const cand = (vm?.[1] && vm[1] !== "" ? vm[1] : decodeHtml(m[2] ?? "")).trim();
    if (/^\d{4}-\d{4}-\d$/.test(cand)) opts.add(cand);
  }
  return [...opts];
}


/* ───── 讨论区解析（服务端渲染 HTML + 分页 JSON） ───── */

/** 板块 tab：beforePageTlList 锚点（wlkcid=..&tabbh=2&tabid=xx">label</a>） */
function parseBbsTabs(html: string): LearnBbsTab[] {
  const out = new Map<string, LearnBbsTab>();
  const re =
    /beforePageTlList\?wlkcid=[^"']*?tabbh=(\d+)&tabid=([0-9a-f]{16,40})[^>]*>([\s\S]{0,160}?)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    const label = decodeHtml(m[3]!.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!label || label.length > 24) continue;
    out.set(m[2]!, { tabbh: m[1]!, tabid: m[2]!, label });
  }
  return [...out.values()];
}


/** 空列表诊断：抽取页面里的 wlxt 接口 URL 与内联脚本（DataTables ajax 初始化就藏在这里） */
function debugBbsShell(html: string): string {
  const urls = [...new Set(html.match(/\/[bf]\/wlxt[\w/.-]*(?:\?[^"'\s<>)]*)?/g) ?? [])];
  const inline = (html.match(/<script[\s\S]*?<\/script>/gi) ?? [])
    .filter((x) => !/src=/.test(x))
    .map((x) => x.replace(/<\/?script[^>]*>/gi, "").trim())
    .filter((x) => x.length > 40 && /ajax|DataTable|url|tltb|table/i.test(x));
  return [
    "URLS(" + urls.length + "):",
    ...urls.map((u) => "  " + u),
    "",
    "INLINE-SCRIPTS(前3段，每段1500字):",
    ...inline.slice(0, 3).map((x, i) => `--- #${i} ---\n` + x.slice(0, 1500)),
  ].join("\n").slice(0, 6000);
}

/** 话题行：viewTlById 锚点定位 + 行窗口抓标题/时间/回复数（列表页无采样，宽容提取）。
 *  href 里的 & 可能写成 &amp;（服务端渲染常见坑），统一归一后再匹配。 */
function parseBbsThreadRows(htmlRaw: string): LearnBbsThreadSummary[] {
  const html = htmlRaw.replace(/&amp;/g, "&");
  const out: LearnBbsThreadSummary[] = [];
  const seen = new Set<string>();
  // 主形态：完整锚点（href 里直接给出 id）
  const re =
    /viewTlById\?[^"']*?[?&]id=([0-9a-f]{16,50})[^"]*"[^>]*>([\s\S]{0,220}?)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    const id = m[1]!;
    if (seen.has(id)) continue;
    seen.add(id);
    const window = html.slice(Math.max(0, m.index! - 500), m.index! + 900);
    let title = decodeHtml(m[2]!.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    const attrTitle = /title="([^"]{2,160})"/.exec(window)?.[1];
    if (attrTitle && (!title || title.length < 4)) title = decodeHtml(attrTitle).trim();
    if (!title) continue;
    const time = /\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?/.exec(window)?.[0] ?? "";
    const authorM = /class="[^"]*(?:fbr|author|name)[^"]*"[^>]*>([^<]{1,40})</.exec(window);
    const cntM = /(?:回复|讨论)[^\d]{0,12}(\d{1,4})/.exec(window) ?? /(\d{1,4})\s*<\/[^>]+>\s*(?:<[^>]+>\s*){0,2}$/.exec(window);
    out.push({
      id,
      title,
      author: authorM ? decodeHtml(authorM[1]!).trim() : "",
      time,
      replies: cntM ? parseInt(cntM[1]!, 10) || 0 : 0,
    });
  }
  if (out.length > 0) return out;
  // 备用形态：JS 串里的 viewTlById?id=..&wlkcid=..（onclick/location.href 拼接）
  const re2 = /viewTlById\?[^'"\s]*?[?&]id=([0-9a-f]{16,50})/gi;
  for (const m of html.matchAll(re2)) {
    const id = m[1]!;
    if (seen.has(id)) continue;
    seen.add(id);
    const window = html.slice(Math.max(0, m.index! - 400), m.index! + 700);
    const title = decodeHtml(
      (/title="([^"]{2,160})"/.exec(window)?.[1] ?? "").replace(/<[^>]+>/g, " "),
    ).replace(/\s+/g, " ").trim();
    if (!title) continue;
    out.push({ id, title, author: "", time: /\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?/.exec(window)?.[0] ?? "", replies: 0 });
  }
  return out;
}

/** 楼层块（楼主/回复共用 .list.lists 布局：.left 作者 + .right 正文） */
function parseBbsMainBlock(html: string): { author: string; time: string; html: string } {
  const lz = html.indexOf("louzhuu");
  if (lz < 0) return { author: "", time: "", html: "" };
  let end = html.indexOf("editFirstAnswerFormId", lz);
  if (end < 0) end = Math.min(html.length, lz + 40000);
  const block = html.slice(lz, end);
  const author = decodeHtml(/class="name"[^>]*>([^<]{1,60})</.exec(block)?.[1] ?? "").trim();
  const time = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.exec(block)?.[0] ?? "";
  const rs = block.search(/class="\s*right"/);
  let body = "";
  if (rs >= 0) {
    const seg = block.slice(block.indexOf(">", rs) + 1);
    const stop = seg.search(/<form\b|<div class="list lists|<div class='list lists/);
    body = seg.slice(0, stop > 0 ? stop : seg.length).replace(/(<\/div>\s*)+$/, "").trim();
  }
  return { author, time, html: body };
}

/** pageViewTlById JSON 行 → LearnBbsPost（字段：hhid/hfr/hfrxm/hfsj/nr_str/wjid/wjmc/hhbDtoList） */
function parseBbsPostJson(raw: unknown): LearnBbsPost {
  const o = (raw ?? {}) as Record<string, unknown>;
  const atts: LearnBbsPostAttachment[] = [];
  if (o.wjid) atts.push({ wjid: String(o.wjid), wjmc: String(o.wjmc ?? "附件") });
  for (const w of Array.isArray(o.wjList) ? o.wjList : []) {
    const wj = (w ?? {}) as Record<string, unknown>;
    if (wj.wjid) atts.push({ wjid: String(wj.wjid), wjmc: String(wj.wjmc ?? "附件") });
  }
  return {
    hhid: String(o.hhid ?? ""),
    author: String(o.hfrxm ?? o.hfr ?? "").trim(),
    time: String(o.hfsj ?? "").slice(0, 16),
    html: String(o.nr_str ?? ""),
    attachments: atts,
    children: Array.isArray(o.hhbDtoList) ? o.hhbDtoList.map(parseBbsPostJson) : [],
  };
}

export class LearnClient {
  #http: HttpClient;
  #csrf: string | null = null;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** 会话建立流程（demo 字符串模型）外部完成时，直接注入 _csrf */
  applyCsrf(token: string): void {
    this.#csrf = token;
  }

  /** 当前 _csrf（未登录为 null）。下载/预览走 Rust 旁路不过 HttpClient，
   *  由桌面端把 token 拼进 URL —— mobile fs.downloadFile 的 addCSRF 同款。 */
  get csrfToken(): string | null {
    return this.#csrf;
  }

  /** 用统一会话下发的 CAS ticket 漫游网络学堂，并提取 _csrf。 */
  async roam(ticket: string): Promise<void> {
    await this.#http.request(
      "https://learn.tsinghua.edu.cn/b/j_spring_security_thauth_roaming_entry?ticket=" + ticket,
      { redirect: "follow" },
    );
    const csrf = await this.#fetchCsrf();
    if (!csrf) throw new AuthRequiredError("漫游后未能获取网络学堂会话");
    this.#csrf = csrf;
  }

  /** 手动恢复已保存会话（CookieJar hydrate 后调用） */
  async resume(): Promise<boolean> {
    const csrf = await this.#fetchCsrf();
    this.#csrf = csrf;
    return csrf !== null;
  }

  /** 诊断现场：最后一次课程页内容（csrf 提取失败时用于定位） */
  lastDebug = "";

  /** 诊断现场：最近一次 getCourseGroups 的解析情况（返回空数组时用于定位） */
  lastGroupsDebug = "";

  /** 诊断现场：讨论列表解析为空时的页面 HTML 头部（空串 = 有数据） */
  lastBbsListDebug = "";

  async #fetchCsrf(): Promise<string | null> {
    try {
      const html = await this.#http.text(this.#withCsrf(urls.LEARN_COURSE_LIST_PAGE()));
      this.lastDebug = html.slice(0, 1200);
      const m = /_csrf=([^&"\x27\s<]+)/.exec(html);
      return m?.[1] ?? null;
    } catch (e) {
      this.lastDebug = "FETCH-ERROR " + String(e);
      return null;
    }
  }

  /** 会话失效直接上抛，由 CampusSession/UI 决定是否重登录（密码不落盘，core 不自动重试） */
  async #withRelogin<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  #requireCsrf(): string {
    if (!this.#csrf) throw new AuthRequiredError();
    return this.#csrf;
  }

  /** learn-lib addCSRFTokenToUrl：learn 接口一律要求 _csrf 查询参数，缺失时返回 HTML 错误页 */
  #withCsrf(url: string): string {
    const u = new URL(url);
    u.searchParams.set("_csrf", this.#requireCsrf());
    return u.toString();
  }

  async getCurrentSemester(): Promise<SemesterInfo> {
    return this.#withRelogin(async () => {
      this.#requireCsrf();
      const json = await this.#http.json<LearnJson>(this.#withCsrf(urls.LEARN_CURRENT_SEMESTER()));
      // mobile 同源字段：result.id（新）/result.xnxq（旧实现），起止 kssj/jssj
      const result = json.result as { id?: string; xnxq?: string; kssj?: string; jssj?: string } | string | undefined;
      const id = typeof result === "object" && result ? (result.id ?? result.xnxq) : result;
      if (!id) throw new AuthRequiredError();
      return {
        id: String(id),
        startDate: typeof result === "object" && result ? (result.kssj ?? "") : "",
        endDate: typeof result === "object" && result ? (result.jssj ?? "") : "",
      };
    });
  }

  /** 校历（demo getCalendar：getCurrentAndNextSemester 的 result/resultList，kssj 对齐周一） */
  async getCalendarData(): Promise<CalendarData> {
    return this.#withRelogin(async () => {
      this.#requireCsrf();
      type CalSem = { id?: string; xnxqmc?: string; kssj?: string; jssj?: string };
      const json = await this.#http.json<{
        message?: string;
        result?: CalSem;
        resultList?: CalSem[];
      }>(this.#withCsrf(urls.LEARN_CURRENT_SEMESTER()));
      if (json.message && json.message !== "success") throw new AuthRequiredError();
      if (!json.result || !json.result.kssj || !json.result.id) throw new AuthRequiredError();
      const fmt = (x: Date): string =>
        `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
      const parse = (o: CalSem): CalendarSemester => {
        // kssj 对齐到所在教学周的周一（周二~五→本周一；周六日→下周一；demo 同款）；
        // kssj/jssj 统一走 parseLearnTime（日期串/时间戳/Date() 前后缀都可吃）
        const startDate = parseLearnTime(o.kssj);
        if (!startDate) throw new AuthRequiredError();
        const start = startDate;
        const wd = start.getDay();
        const delta = wd === 0 ? 1 : wd === 6 ? 2 : 1 - wd;
        const firstDay = fmt(new Date(start.getTime() + delta * 86400000));
        const end = parseLearnTime(o.jssj ?? o.kssj) ?? start;
        const weekCount = Math.max(
          1,
          Math.floor((end.getTime() - start.getTime() + delta * 86400000) / (7 * 86400000)) + 1,
        );
        return {
          firstDay,
          semesterId: String(o.id ?? ""),
          semesterName: String(o.xnxqmc ?? ""),
          weekCount,
        };
      };
      return {
        ...parse(json.result),
        nextSemesterList: (json.resultList ?? []).map(parse),
      };
    });
  }

  async getSemesterIdList(): Promise<string[]> {
    // thu-learn-lib 4.0 getSemesterIdList 金标准：全部学期来自
    // GET /b/wlxt/kc/v_wlkc_xs_xktjb_coassb/queryxnxq（learn 网页端学期下拉的数据源，
    // 响应为裸 JSON 字符串数组、可能混 null）——覆盖从入学以来每一个学期。
    // 旧实现只取 getCurrentAndNextSemester 的 result+resultList（当前+下学期，列表过窄）；
    // commit ab57ef1 "queryxnxq 从未成功"的结论不实——金标准同端点长期工作，
    // 当时失败应为未带 _csrf 或会话未建立。解析宽容见 parseSemesterIdList；
    // queryxnxq 三路全空时退回旧端点，至少保住当前+下学期（不再出现空白列表）。
    return this.#withRelogin(async () => {
      this.#requireCsrf();
      const text = await this.#http.text(this.#withCsrf(urls.LEARN_SEMESTER_LIST()));
      if (!looksLikeLoginHtml(text)) {
        const ids = parseSemesterIdList(text);
        if (ids.length > 0) return ids.sort().reverse();
      }
      const data = await this.#http.json<{
        message?: string;
        result?: { id?: string } | null;
        resultList?: Array<{ id?: string }>;
      }>(this.#withCsrf(urls.LEARN_CURRENT_SEMESTER()));
      const fallback: string[] = [];
      if (data.result?.id) fallback.push(data.result.id);
      if (Array.isArray(data.resultList)) {
        for (const sem of data.resultList) {
          if (sem.id && !fallback.includes(sem.id)) fallback.push(sem.id);
        }
      }
      return fallback.sort().reverse();
    });
  }

  async getCourseList(semesterId: string): Promise<CourseInfo[]> {
    return this.#withRelogin(async () => {
      this.#requireCsrf();
      const json = await this.#http.json<LearnJson>(this.#withCsrf(urls.LEARN_COURSE_LIST(semesterId)));
      const rows = Array.isArray(json.resultList) ? json.resultList : [];
      return rows.map((raw) => {
        const c = raw as Record<string, unknown>;
        const id = str(c.wlkcid);
        return {
          id,
          name: decodeHtml(c.kcm) || decodeHtml(c.zywkcm),
          englishName: decodeHtml(c.ywkcm),
          courseNumber: str(c.kch),
          courseIndex: Number(c.kxh ?? 0),
          teacherName: decodeHtml(c.jsm),
          timeAndLocation: [],
          url: urls.LEARN_COURSE_PAGE(id),
        };
      });
    });
  }

  /** 全部课程的作业（未交 + 已交未批 + 已批） */
  async getAllHomework(courseIds: string[]): Promise<Homework[]> {
    this.#requireCsrf();
    const groups = await Promise.all(
      courseIds.map((courseId) =>
        Promise.all(
          (["new", "submitted", "graded"] as const).map((kind) =>
            this.#fetchHomeworkKind(courseId, kind).catch(() => []),
          ),
        ),
      ),
    );
    return groups.flat(2);
  }

  async #fetchHomeworkKind(courseId: string, kind: "new" | "submitted" | "graded"): Promise<Homework[]> {
    return this.#withRelogin(async () => {
      const json = await this.#http.json<LearnJson>(this.#withCsrf(urls.LEARN_HOMEWORK_LIST[kind]), {
        method: "POST",
        body: this.#aoData({ wlkcid: courseId }),
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      });
      return asArray(json.object ?? json.resultList).map((raw) => {
        const d = raw as Record<string, unknown>;
        const baseId = str(d.zyid);
        const studentId = str(d.xszyid) || baseId;
        // 状态三分类由列表端点决定（learn-lib LEARN_HOMEWORK_LIST_SOURCE 同源）：
        // new=未交 submitted=false/graded=false；Yjwg=已交未批 true/false；Ypg=已批 true/true。
        // 补交标记 sfbj = "是"/"否"（learn-lib YES==='是'，臆造的 "1"/"Y" 均匹配不上）。
        return {
          id: studentId,
          baseId,
          courseId: str(d.wlkcid) || courseId,
          title: decodeHtml(d.bt),
          content: decodeBase64Utf8(str(d.nr)),
          publishTime: normalizeTime(d.fbsj, d.fbsjStr),
          deadline: normalizeTime(d.jzsj, d.jzsjStr),
          lateDeadline: d.bjjzsj ? normalizeTime(d.bjjzsj, d.bjjzsjStr) : undefined,
          lateSubmission: str(d.sfbj) === "是",
          completionType: d.zywcfs === undefined || d.zywcfs === null ? undefined : Number(d.zywcfs),
          // 学生端列表接口没有「提交方式」字段（此前臆造的 submissionType 已删）；
          // 是否可提交以作业详情页真实表单控件为准 → getHomeworkPageDetail().hasSubmitForm
          submitted: kind !== "new",
          graded: kind === "graded",
          // scsj/cj/pysj 未批/未交时为 null（learn-lib 同款 null→undefined）
          submitTime: d.scsj === undefined || d.scsj === null || str(d.scsj) === "" ? undefined : normalizeTime(d.scsj, d.scsjStr),
          grade: d.cj === undefined || d.cj === null || str(d.cj) === "" ? undefined : (d.cj as string | number),
          graderName: str(d.jsm).trim() || undefined,
          gradeContent: decodeHtml(d.pynr).trim() || undefined,
          gradeTime: d.pysj === undefined || d.pysj === null || str(d.pysj) === "" ? undefined : normalizeTime(d.pysj, d.pysjStr),
          url: urls.LEARN_HOMEWORK_PAGE(str(d.wlkcid) || courseId, studentId),
        };
      });
    });
  }

  /** 单个作业的说明详情（thu-learn-lib getHomeworkDetail：POST id=zyid，msg 即说明） */
  /** 提交作业（thu-learn-lib LEARN_HOMEWORK_SUBMIT_FORM_DATA 同款）：
   *  POST /b/wlxt/kczy/zy/student/tjzy，multipart FormData 字段序 xszyid/zynr/
   *  fileupload/isDeleted；无附件时 fileupload 也要占位（字面 "undefined"，
   *  网页端空文件输入的原样 —— thu-learn-lib 与 thu-app learnApi 均如此）。
   *  remove = isDeleted=1：撤回「已上传附件」（mobile removeAttachment 语义，
   *  不是撤回整个提交）；正文 zynr 一并原样上送。 */
  async submitHomework(
    studentHomeworkId: string,
    opts: { content?: string; file?: File | null; remove?: boolean },
  ): Promise<{ ok: boolean; msg?: string }> {
    return this.#withRelogin(async () => {
      const fd = new FormData();
      fd.append("xszyid", studentHomeworkId);
      fd.append("zynr", opts.content ?? "");
      if (opts.file) fd.append("fileupload", opts.file, opts.file.name);
      else fd.append("fileupload", "undefined");
      fd.append("isDeleted", opts.remove ? "1" : "0");
      const url = this.#withCsrf(urls.LEARN_PREFIX + "/b/wlxt/kczy/zy/student/tjzy");
      const res = await this.#http.postForm(url, fd);
      // 返回 HTML = 会话失效被重定向到登录页（learnApi 同款判定），不能当成功吞掉
      if (/<(!DOCTYPE|html)/i.test(res.slice(0, 200))) {
        return { ok: false, msg: "会话已过期，请重新登录后再提交" };
      }
      try {
        const data = JSON.parse(res) as { result?: string; msg?: string };
        // result === "error" 明确失败（thu-lib 只认 "success"；learnApi 宽容：非 error 即成功）
        if (data.result === "error") return { ok: false, msg: data.msg ?? "提交失败" };
        return { ok: true };
      } catch {
        return { ok: false, msg: "返回非 JSON（可能未登录或接口变更）" };
      }
    });
  }

  async getHomeworkDetail(baseId: string): Promise<{ description: string }> {
    return this.#withRelogin(async () => {
      this.#requireCsrf();
      const body = new URLSearchParams({ id: baseId });
      const json = await this.#http.json<LearnJson>(this.#withCsrf(urls.LEARN_HOMEWORK_DETAIL()), {
        method: "POST",
        body,
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      });
      const msg = typeof json.message === "string" ? json.message : str(json.msg);
      return { description: decodeHtml(msg) };
    });
  }

  /** 附件区里挑「真正的文件锚点」（thu-learn-lib parseHomeworkFile 语义收紧版）：
   *  逐个检查区块内的 <a href>，只认「有可下载地址」的文件锚点——href 必须带
   *  fileId / downloadUrl / wjid 之一（learn-lib 附件锚点的下载参数；downloadUrl 参数优先，
   *  为 URL 编码的服务器路径）；无文件下载 href 的纯导航锚点（如「去答疑」）、
   *  指向答疑/讨论/笔记路由的锚点（mobile filterJunkLinks 同源路由）一律不要。
   *  解析出的每个附件因此必有可下载 URL；文件名取锚点文本（可空，UI 以「附件 {id}」兜底）。 */
  #parseAttachmentAnchor(block: string): LearnAttachment | undefined {
    for (const a of block.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const href = decodeHtml(a[1]!).trim();
      if (!href || href === "#" || /^javascript:/i.test(href)) continue;
      // 答疑/论坛/笔记等纯导航路由（mobile filterJunkLinks：/bbs|kcdy|biji|taolun|dayi|答疑）
      if (/\/(?:bbs|kcdy|biji|taolun|dayi)\b|答疑/i.test(href)) continue;
      const q = href.indexOf("?");
      const params = new URLSearchParams(q >= 0 ? href.slice(q + 1) : "");
      const id = params.get("fileId") ?? params.get("wjid") ?? "";
      const dl = params.get("downloadUrl");
      // 无文件下载参数 = 不是附件（页面导航/锚点），绝不冒充附件名
      if (!id && !dl) continue;
      const name = decodeHtml(a[2]!.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
      const path = dl ?? href;
      const downloadUrl = path.startsWith("http")
        ? path
        : urls.LEARN_PREFIX + (path.startsWith("/") ? path : "/" + path);
      const size = decodeHtml(/<span[^>]*class="[^"]*color[^"]*"[^>]*>([^<]*)<\/span>/i.exec(block)?.[1] ?? "").trim();
      return { id, name, downloadUrl, size: size || undefined };
    }
    return undefined;
  }

  /** fujian div 自身内容的配平提取：从开标签起做 <div>/</div> 计数，取到其闭合标签，
   *  即 learn-lib `result('div.list.fujian.clearfix')` 的严格范围（附件区域）。
   *  旧实现把区块尾一刀切到下个 list 区块/30000 字符，fujian 块后面的导航链接
   *  （如「去答疑」）会溢进搜索范围被当成附件——这里从根上堵死。
   *  HTML 未正常闭合时退化为开标签后限长 8000 的窗口（有界兜底）。 */
  #fujianBlockContent(html: string, openIdx: number): string {
    const re = /<\/?div\b[^>]*>/gi;
    re.lastIndex = openIdx;
    let depth = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      if (/^<\/div/i.test(m[0])) {
        depth--;
        if (depth === 0) return html.slice(openIdx, m.index);
      } else {
        depth++;
      }
    }
    return html.slice(openIdx, Math.min(html.length, openIdx + 8000));
  }

  /** 作业详情页（viewCj HTML）附件解析 —— thu-learn-lib parseHomeworkAtUrl 等价。
   *  附件只存在于 HTML 页（div.list.fujian.clearfix 四块：附件/答案/我的提交/批改），
   *  列表 JSON 与 detail JSON 均不含——这正是此前"作业文件消失"的原因。
   *  附件解析严格限定在 fujian div 自身（#fujianBlockContent 配平范围），并要求
   *  锚点带可下载参数（#parseAttachmentAnchor）——「去答疑」等导航链接不再混入。
   *  submittedContent 取 boxbox[1] 的 right 块（learn-lib: boxbox>right[2]、
   *  learnApi: boxboxParts[2].rightParts[3] 同源），供提交面板预填上次提交内容。
   *
   *  hasSubmitForm 判定细则（学生端列表接口没有提交方式字段，绝不臆测，
   *  以详情页 HTML 的真实控件为准）：页面出现以下任一「提交表单结构特征」即
   *  hasSubmitForm=true——
   *    ① 提交端点 tjzy（/b/wlxt/kczy/zy/student/tjzy）被页面引用（<form action> 或提交 JS）；
   *    ② 上传控件 <input name="fileupload">；
   *    ③ 正文输入控件 <textarea name="zynr">。
   *  「仅需在 OJ 提交，无需提交」这类作业的详情页无任何上述控件 → false，
   *  UI 不渲染提交框。已提交作业的页面表单会变化（再次提交/撤回附件等），
   *  本字段随 viewCj 重新解析而刷新，UI 始终按重取后的页面事实渲染。 */
  async getHomeworkPageDetail(courseId: string, studentHomeworkId: string): Promise<HomeworkPageDetail> {
    this.#requireCsrf();
    const html = await this.#http.text(urls.LEARN_HOMEWORK_PAGE(courseId, studentHomeworkId));
    const out: HomeworkPageDetail = {
      hasSubmitForm:
        /\btjzy\b/i.test(html) ||
        /<input\b[^>]*name=["']fileupload["']/i.test(html) ||
        /<textarea\b[^>]*name=["']zynr["']/i.test(html),
    };
    // 以 class="list …" 区块起点定位 fujian 块（文档序 = 四类附件顺序）
    const starts = [...html.matchAll(/<div[^>]*class=["']list[^"']*["'][^>]*>/gi)].map((m) => ({
      idx: m.index ?? 0,
      fujian: /fujian/i.test(m[0]),
    }));
    const keys = ["attachment", "answerAttachment", "submittedAttachment", "gradeAttachment"] as const;
    let kindIdx = 0;
    for (let i = 0; i < starts.length && kindIdx < keys.length; i++) {
      if (!starts[i]!.fujian) continue;
      const a = this.#parseAttachmentAnchor(this.#fujianBlockContent(html, starts[i]!.idx));
      const k = keys[kindIdx];
      if (a && k) out[k] = a;
      kindIdx++;
    }
    // 我的提交内容（上次 zynr）：boxbox 第 2 块 → 第 4 个 right 块到其闭合标签
    const boxboxParts = html.split(/<div[^>]*class=["'][^"']*boxbox[^"']*["'][^>]*>/i);
    if (boxboxParts.length > 2) {
      const rightParts = boxboxParts[2]!.split(/<div[^>]*class=["'][^"']*right[^"']*["'][^>]*>/i);
      if (rightParts.length > 3) {
        const raw = (rightParts[3] ?? "").replace(/<\/div>[\s\S]*/i, "").trim();
        if (raw) out.submittedContent = decodeHtml(raw);
      }
    }
    return out;
  }

  /** 通知详情页（beforeViewXs HTML）附件解析 —— thu-learn-lib parseNotificationDetail 等价。
   *  学生版附件锚点带 class="ml-10"（href 含 wjid）；fjmc 只有文件名，下载地址在页面里。 */
  async getNotificationPageDetail(courseId: string, notificationId: string): Promise<NotificationPageDetail> {
    this.#requireCsrf();
    const html = await this.#http.text(urls.LEARN_NOTIFICATION_DETAIL(courseId, notificationId));
    const anchors = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
    const pick =
      anchors.find((m) => /ml-10/i.test(m[0]) || /[?&]wjid=/.test(m[1]!)) ??
      anchors.find((m) => /wjid/i.test(m[0]));
    if (!pick) return {};
    const href = decodeHtml(pick[1]!);
    const q = href.indexOf("?");
    const params = new URLSearchParams(q >= 0 ? href.slice(q + 1) : "");
    const id = params.get("wjid") ?? params.get("fileId") ?? "";
    const dl = params.get("downloadUrl");
    const path = dl ?? href;
    const downloadUrl = path.startsWith("http")
      ? path
      : urls.LEARN_PREFIX + (path.startsWith("/") ? path : "/" + path);
    const name = decodeHtml(pick[2]!.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    const size = decodeHtml(
      /id="attachment"[^>]*>[\s\S]*?<span[^>]*class="[^"]*color[^"]*"[^>]*>([^<]*)<\/span>/i.exec(html)?.[1] ?? "",
    ).trim();
    if (!id && !name) return {};
    return { attachment: { id, name, downloadUrl, size: size || undefined } };
  }

  /** 通知（全部课程或指定课程）；expired=已过期 */
  async getAllNotifications(courseIds: string[], expired = false): Promise<Notification[]> {
    this.#requireCsrf();
    const groups = await Promise.all(
      courseIds.map((courseId) =>
        this.#withRelogin(async () => {
          const json = await this.#http.json<LearnJson>(this.#withCsrf(urls.LEARN_NOTIFICATION_LIST(expired)), {
            method: "POST",
            body: this.#aoData({ wlkcid: courseId, iDisplayStart: 0, iDisplayLength: 50 }),
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          });
          return asArray(json.object ?? json.resultList).map((raw) => {
            const d = raw as Record<string, unknown>;
            const cid = str(d.wlkcid) || courseId;
            const nid = str(d.ggid ?? d.id);
            return {
              id: nid,
              courseId: cid,
              title: decodeHtml(d.bt ?? d.ggbt),
              content: decodeBase64Utf8(str(d.ggnr)),
              publisher: decodeHtml(d.fbrxm),
              publishTime: normalizeTime(d.fbsj, d.fbsjStr),
              expireTime: d.jzsj ? normalizeTime(d.jzsj, d.jzsjStr) : undefined,
              important: str(d.sfqd) === "1" || Number(d.sfqd) === 1,
              // sfyd = "是"/"否"（learn-lib hasRead: n.sfyd === YES）
              hasRead: str(d.sfyd) === "是",
              attachmentName: str(d.fjmc).trim() || undefined,
              url: urls.LEARN_NOTIFICATION_DETAIL(cid, nid),
            };
          });
        }).catch(() => [] as Notification[]),
      ),
    );
    return groups.flat();
  }

  async getFileList(courseId: string): Promise<CourseFile[]> {
    return this.#withRelogin(async () => {
      this.#requireCsrf();
      const json = await this.#http.json<LearnJson>(this.#withCsrf(urls.LEARN_FILE_LIST(courseId)));
      // 学生端点返回 object 为行数组（thu-learn-lib getFileList 同源）；
      // 解析 resultList 会导致文件列表恒为空（"文件消失"根因）。
      const rows = Array.isArray(json.object)
        ? json.object
        : Array.isArray(json.resultList)
          ? json.resultList
          : [];
      return rows.map((raw) => {
        const d = raw as Record<string, unknown>;
        const fid = str(d.wjid);
        const rawType = str(d.wjlx).trim().replace(/^\./, "");
        return {
          id: fid,
          courseId,
          title: decodeHtml(d.bt ?? d.kjbt),
          uploadTime: normalizeTime(d.scsj, d.fxsj ?? d.scj),
          downloadUrl: urls.LEARN_FILE_DOWNLOAD(fid),
          fileType: rawType || undefined,
          size: str(d.fileSize).trim() || undefined,
          description: decodeHtml(d.ms).trim() || undefined,
          important: str(d.sfqd) === "1",
        };
      });
    });
  }

  /** 课程「我的分组」（beforePageWdfzList HTML 宽容解析 → pageFzList JSON 兜底）。
   *  两路都提不出结构时返回 []，现场写入 lastGroupsDebug；
   *  分组页被重定向到登录页时抛 AuthRequiredError（与相邻 HTML 方法风格一致）。 */
  /* ───── 讨论区（bbs_tltb） ───── */

  /** 话题列表（beforePageTlList HTML，宽容解析） */
  async getBbsThreads(
    wlkcid: string,
    tabId?: string,
  ): Promise<{ tabs: LearnBbsTab[]; threads: LearnBbsThreadSummary[] }> {
    return this.#withRelogin(async () => {
      this.#requireCsrf();
      const html = await this.#http.text(this.#withCsrf(urls.LEARN_BBS_THREAD_LIST(wlkcid, tabId)));
      const threads = parseBbsThreadRows(html);
      // 诊断现场：空列表时抽取 ajax 线索（列表页确认为 DataTables 壳——2026-09 用户实测）
      this.lastBbsListDebug = threads.length === 0 ? debugBbsShell(html) : "";
      return { tabs: parseBbsTabs(html), threads };
    });
  }

  /** 话题头（楼主块 + 分页上下文） */
  async getBbsThread(wlkcid: string, threadId: string): Promise<LearnBbsThreadDetail> {
    return this.#withRelogin(async () => {
      this.#requireCsrf();
      const html = await this.#http.text(this.#withCsrf(urls.LEARN_BBS_THREAD_VIEW(wlkcid, threadId)));
      const main = parseBbsMainBlock(html);
      const span = (re: RegExp): string => re.exec(html)?.[1] ?? "";
      return {
        id: threadId,
        title: decodeHtml(
          span(/id="tlbt"[\s\S]{0,220}?<span[^>]*title="([^"]*)"/) ||
            span(/id="tlbt"[\s\S]{0,300}?<span[^>]*>([^<]{2,200})<\/span>/),
        ).trim(),
        author: main.author,
        time: main.time,
        html: main.html,
        replyCount: parseInt(span(/loadpage2\([^,]+,\s*(\d+)\s*,/), 10) || 0,
        tabbh: span(/tabbh=(\d+)/),
        tabid: span(/[?&]tabid=([0-9a-f]{16,40})/),
        bqid: span(/[?&]bqid=([0-9a-f]{16,40})/),
      };
    });
  }

  /** 回复分页（pageViewTlById JSON；每页 8 条，hhbDtoList 为楼中楼） */
  async getBbsThreadPosts(wlkcid: string, threadId: string, pageNum: number): Promise<LearnBbsPost[]> {
    return this.#withRelogin(async () => {
      this.#requireCsrf();
      const json = await this.#http.json<{ result?: string; object?: { list?: unknown[] } }>(
        this.#withCsrf(urls.LEARN_BBS_POSTS_PAGE(wlkcid, threadId, pageNum)),
      );
      const list = json?.object?.list;
      return Array.isArray(list) ? list.map(parseBbsPostJson) : [];
    });
  }

  /** 发表回复（saveEdit 表单 POST；fhhid = 楼中楼父楼层，缺省 = 回楼主）。成功无回包语义，失败抛错 */
  async postBbsReply(wlkcid: string, threadId: string, nr: string, fhhid?: string): Promise<void> {
    return this.#withRelogin(async () => {
      this.#requireCsrf();
      const body = new URLSearchParams({ wlkcid, tltid: threadId, nr });
      if (fhhid) {
        body.set("fhhid", fhhid);
        body.set("_fhhid", fhhid);
      }
      const res = await this.#http.postForm(this.#withCsrf(urls.LEARN_BBS_SAVE_REPLY(wlkcid)), body);
      let ok = false;
      try {
        const j = JSON.parse(res) as { result?: unknown; msg?: unknown };
        ok = /success/i.test(String(j.result ?? "")) || res.trim().length === 0;
      } catch {
        ok = /success/i.test(res) || res.trim().length === 0;
      }
      if (!ok) {
        const msg = decodeHtml(res.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
        throw new Error(msg.slice(0, 140) || "回复失败（站点未返回成功标记）");
      }
    });
  }

  async getCourseGroups(wlkcid: string): Promise<LearnGroup[]> {
    return this.#withRelogin(async () => {
      this.#requireCsrf();
      const debug: string[] = [];
      // ① 任务规定的页面请求：GET /f/wlxt/qz/v_wlkc_qzcyb/student/beforePageWdfzList?wlkcid=
      //    （/f/ 静态页同 getHomeworkPageDetail/getNotificationPageDetail，直接 text 不带 _csrf）
      const pageUrl =
        urls.LEARN_PREFIX + "/f/wlxt/qz/v_wlkc_qzcyb/student/beforePageWdfzList?wlkcid=" + encodeURIComponent(wlkcid);
      const html = await this.#http.text(pageUrl);
      if (looksLikeLoginHtml(html)) {
        this.lastGroupsDebug = "GROUPS login-page len=" + html.length + " " + html.slice(0, 300).replace(/\s+/g, " ");
        throw new AuthRequiredError("网络学堂会话已失效（分组页返回登录页）");
      }
      const table = parseGroupTables(html);
      if (table.length > 0) {
        this.lastGroupsDebug = "GROUPS ok source=html-table rows=" + table.length;
        return table;
      }
      const rawLines = parseGroupRawLines(html);
      if (rawLines.length > 0) {
        this.lastGroupsDebug = "GROUPS ok source=html-rawlines rows=" + rawLines.length;
        return rawLines;
      }
      const tbody = /<tbody[^>]*>([\s\S]{0,400})/i.exec(html)?.[1] ?? "";
      debug.push("html len=" + html.length + " tbody=" + tbody.replace(/\s+/g, " ").slice(0, 200));
      // ② 兜底：分组页 DataTables 的数据源（页面自身 fnServerData 同款 POST aoData）。
      //    静态 HTML 只有空 tbody，行数据必须从这里拿。
      try {
        const json = await this.#http.json<LearnJson>(
          this.#withCsrf(urls.LEARN_PREFIX + "/b/wlxt/qz/v_wlkc_qzcyb/student/pageFzList"),
          {
            method: "POST",
            body: this.#aoData({ wlkcid, iDisplayStart: 0, iDisplayLength: 100 }),
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          },
        );
        const rows = asArray(json.object);
        const groups = rows.map(parseGroupJsonRow).filter((g): g is LearnGroup => g !== undefined);
        if (groups.length > 0) {
          this.lastGroupsDebug = "GROUPS ok source=json rows=" + groups.length;
          return groups;
        }
        debug.push("json rows=" + rows.length + " result=" + str(json.result));
      } catch (e) {
        // 页面 HTML 正常而 JSON 端点异常（404/改版）≠ 会话失效：不外抛，留现场
        debug.push("json-ERR " + String(e).slice(0, 200));
      }
      this.lastGroupsDebug = "GROUPS empty " + debug.join(" | ").slice(0, 1200);
      return [];
    });
  }

  #aoData(params: Record<string, unknown>): URLSearchParams {
    return new URLSearchParams({
      aoData: JSON.stringify(Object.entries(params).map(([name, value]) => ({ name, value }))),
    });
  }
}
