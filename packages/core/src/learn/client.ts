/**
 * 网络学堂客户端（本科生视角）。
 * 登录 = CAS ticket 漫游 → 课程列表页抓 _csrf；接口失效自动重登录（retryAfterLogin）。
 */
import { AuthRequiredError, HttpClient } from "../http.js";
import { encryptPassword } from "../crypto/sm2.js";
import * as urls from "./urls.js";
import type {
  CalendarData,
  CalendarSemester,
  CourseFile,
  CourseInfo,
  Homework,
  HomeworkPageDetail,
  LearnAttachment,
  LearnBbsBoard,
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

import { decodeHtmlEntities } from "../info/htmltext.js";
import { parseLearnTime } from "./time.js";

/** 文本字段实体解码：全量命名/数值实体（mdash/ndash/引号/希腊字母…），
 *  并对残留实体再收一轮（站点偶发双重转义 &amp;mdash; → &mdash; → —）。
 *  仅供标题/姓名/文件名等纯文本路径；HTML 路径一律仍走 decodeHtml（保持既有转义还原语义）。 */
function decodeText(s: unknown): string {
  const raw = String(s ?? "");
  if (!raw) return "";
  const once = decodeHtmlEntities(raw);
  return /&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/.test(once) ? decodeHtmlEntities(once) : once;
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

/* 时间解析已剥到 ./time.ts（纯函数、无 HTTP/SM2 依赖）：此处仅为对外导出保持原路径 */
export { parseLearnTime };


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

/** 网络学堂本地登录壳（2026-09-02 诊断实录：<title>网络学堂</title> + re_log 重新登录按钮，
 *  与 info 门户登录页特征不同源——viewTlById 会话过期时服务器回这个） */
function looksLikeLearnLoginShell(html: string): boolean {
  return html.includes(">网络学堂<") && /re_log|重新登录/.test(html);
}

/** 成员串 → 姓名数组：qzmp 逗号分隔（页面渲染时 replace(/,/g," ")），表格里为空格分隔 */
function splitMemberNames(s: string): string[] {
  return decodeText(s)
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
        decodeText(t[1]!.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(),
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
  const lines = decodeText(
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
  const name = decodeText(d.qzmc ?? d.fzmc ?? d.name).trim();
  if (!name && names.length === 0) return undefined;
  const creator = decodeText(d.czr ?? d.czz).trim();
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
    const cand = (vm?.[1] && vm[1] !== "" ? vm[1] : decodeText(m[2] ?? "")).trim();
    if (/^\d{4}-\d{4}-\d$/.test(cand)) opts.add(cand);
  }
  return [...opts];
}


/* ───── 讨论区解析（服务端渲染 HTML + 分页 JSON） ───── */

/** 站点响应可能是「JSON 字符串再包一层」（bqListByWlkcid 前端要 eval 才能用）——宽容解到对象。
 *  覆盖三种形态：裸 JSON 文本、JSON 字面量外再包引号（"\[...\"}" ）、连包多层。 */
function parseMaybeJsonString<T>(raw: string): T {
  let cur: unknown = raw;
  for (let i = 0; i < 4 && typeof cur === "string"; i++) {
    let t = cur.trim();
    if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
      try {
        cur = JSON.parse(t);
        continue;
      } catch {
        /* 引号剥不掉就当裸文本走下面 */
      }
    }
    if (!t.startsWith("[") && !t.startsWith("{")) break;
    cur = JSON.parse(t);
  }
  return cur as T;
}

/** DataTables 1.9 服务端行 → 话题摘要 */
function parseBbsThreadRow(raw: unknown): LearnBbsThreadSummary {
  const o = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => {
    const n = parseInt(String(v ?? "0"), 10);
    return Number.isFinite(n) ? n : 0;
  };
  const yes = (v: unknown): boolean => String(v ?? "").trim() === "是";
  return {
    id: String(o.tltid ?? o.id ?? ""),
    title: decodeText(String(o.bt ?? "")).trim(),
    author: String(o.fbrxm ?? o.fbr ?? "").trim(),
    time: String(o.fbsj ?? "").slice(0, 16),
    replies: num(o.hfcs ?? o.hfcsnum ?? o.hfcsl),
    essence: yes(o.sfjh),
    pinned: yes(o.sfzd),
    bqid: o.bqid ? String(o.bqid) : undefined,
  };
}

/** 楼层块（楼主/回复共用 .list.lists 布局：.left 作者 + .right 正文） */
function parseBbsMainBlock(html: string): { author: string; time: string; html: string } {
  const lz = html.indexOf("louzhuu");
  if (lz < 0) return { author: "", time: "", html: "" };
  let end = html.indexOf("editFirstAnswerFormId", lz);
  if (end < 0) end = Math.min(html.length, lz + 40000);
  const block = html.slice(lz, end);
  const author = decodeText(/class="name"[^>]*>([^<]{1,60})</.exec(block)?.[1] ?? "").trim();
  const time = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.exec(block)?.[0] ?? "";
  const rs = block.search(/class="\s*right"/);
  let body = "";
  if (rs >= 0) {
    const seg = block.slice(block.indexOf(">", rs) + 1);
    const stop = seg.search(
      /<form\b|<div class="list lists|<div class='list lists|<p class="times|question-answer|answerFirstLink|firstHfItems|switchEditor|切换至/,
    );
    body = seg.slice(0, stop > 0 ? stop : seg.length).replace(/(<\/div>\s*)+$/, "").trim();
  }
  return { author, time, html: body };
}

/** viewTlById HTML 里服务端渲染的首屏回复（firstHfItems 下 item_<hhid> 块，≤8 条）。
 *  2026-09 离线演练于真实样本：4 回复 × (作者/楼层/时间/正文/楼中楼) 全对。
 *  结构：<div id="item_NNN" class="list lists clearfix"> .left name + .right（p_nr 正文、
 *  lc 楼层+时间、huifu id=NNN、hfItems_NNN 楼中楼 item_MMM）。 */
function parseBbsReplyBlocks(html: string): LearnBbsPost[] {
  const start = html.indexOf('id="firstHfItems"');
  if (start < 0) return [];
  const region = html.slice(start);
  const marks = [...region.matchAll(/<div id="item_(\d+)" class="list lists clearfix">/g)];
  const out: LearnBbsPost[] = [];
  for (let i = 0; i < marks.length; i++) {
    const hhid = marks[i]![1]!;
    const blk = region.slice(marks[i]!.index!, i + 1 < marks.length ? marks[i + 1]!.index! : region.length);
    const author = decodeText(/class="name"[^>]*>([^<]{1,60})</.exec(blk)?.[1] ?? "").trim();
    const lc = /<span name="lc">(\d+)<\/span>楼：([\d-]+ [\d:]+)/.exec(blk);
    const time = lc?.[2] ?? "";
    // p_nr 常嵌多段 <p>（富文本/图片帖），非贪婪到首个 </p> 会截断正文与图——
    // 取到本块楼层行 <p class="times" 为止，再剥掉末尾至多 2 个收口标签（p_nr 自身 + item_cont）
    const ps = blk.indexOf('<p name="p_nr">');
    const pe = blk.search(/<p class="times/);
    let nr = "";
    if (ps >= 0) {
      nr = blk.slice(ps + '<p name="p_nr">'.length, pe > ps ? pe : undefined);
      for (let i = 0; i < 2 && /<\/(p|div)>\s*$/.test(nr); i++) {
        nr = nr.replace(/<\/(p|div)>\s*$/i, "");
      }
    }
    const atts: LearnBbsPostAttachment[] = [];
    for (const a of blk.matchAll(/downloadFileByTlForStu\?wlkcid=[^"&]+&wjid=(\d+)[^"]*"[^>]*>([^<]{1,120})</g)) {
      atts.push({ wjid: a[1]!, wjmc: decodeText(a[2]!).trim() });
    }
    const children: LearnBbsPost[] = [];
    const subRe =
      /<span style="color: #139ff7">([^<]+)：?<\/span>\s*<span name="p_nr">([\s\S]*?)<\/span>/g;
    for (const sub of blk.matchAll(subRe)) {
      children.push({
        hhid: "",
        author: decodeText(sub[1]!).replace(/：$/, "").trim(),
        time: "",
        html: decodeHtml(sub[2]!).trim(),
        attachments: [],
        children: [],
      });
    }
    out.push({
      hhid: marks[i]![1]!,
      author,
      time,
      html: decodeHtml(nr).trim(),
      attachments: atts,
      children,
    });
  }
  return out;
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
    // 站点 nr_str 是实体转义 HTML（站点 JS escapeStringHTML 解码后上屏）——同款解码，
    // 否则第 2 页起的 JSON 回复直出转义标签，图片/格式全废
    html: decodeHtml(String(o.nr_str ?? "")).trim(),
    attachments: atts,
    children: Array.isArray(o.hhbDtoList) ? o.hhbDtoList.map(parseBbsPostJson) : [],
  };
}

/** 会话失效（请求回了登录页 HTML）——#withRelogin 捕获后静默重登一次再重试。
 *  继承 AuthRequiredError：既有 catch 兼容不变。 */
class SessionExpiredError extends AuthRequiredError {}

/** 登录状态压根没建立起来（例如取不到网页表单里的登录凭据）——与「服务器回了
 *  登录页」区分：前者可能只是一次建链没成，值得先重建再报错，文案也不该说
 *  「已失效」把用户吓去改密码。继承 SessionExpiredError，让 #withRelogin 的
 *  静默重建兜住（2026-09-23 复核 #42：作业/通知/详情三个入口的这条抛错在
 *  #withRelogin 之外，会话一死连重试机会都没有，而课程列表还在（缓存），
 *  用户看到的就是「只有详情/通知/作业说会话已失效」）。 */
class LearnSessionMissingError extends SessionExpiredError {
  constructor() {
    super("网络学堂的登录状态没有建立起来");
  }
}

/** 登录凭据提取：站点不同版本把它放在隐藏域、链接参数或脚本变量里，
 *  只认一种写法就会让整个学习模块判「未登录」——多策略都要认。 */
function extractLearnCsrf(html: string): { token: string; via: string } | null {
  const pats: Array<[RegExp, string]> = [
    [/_csrf=([^&"'\s<]+)/, "link"],
    [/name=["']_csrf["'][^>]*value=["']([^"']+)["']/i, "form"],
    [/value=["']([^"']+)["'][^>]*name=["']_csrf["']/i, "form"],
    [/["']?_csrf["']?\s*[:=]\s*["']([^"'\s]+)["']/i, "script"],
    [/["']csrfToken["']\s*:\s*["']([^"']+)["']/i, "script"],
  ];
  for (const [re, via] of pats) {
    const t = re.exec(html)?.[1];
    if (t) return { token: decodeHtml(t), via };
  }
  return null;
}

/** 回页种类（只进诊断，不进界面）：分清「登录状态死了」与「页面换了形状」——
 *  两者的处置完全不同，以前都报同一句话，排查只能靠猜。 */
function classifyLearnPage(html: string): string {
  if (looksLikeLearnLoginShell(html)) return "learn-login-shell";
  if (/id="sm2publicKey"|name="i_pass"/i.test(html)) return "id-login-form";
  if (/j_spring_security_check/i.test(html)) return "learn-login-form";
  if (/__vpn_|wengine/i.test(html)) return "webvpn-guide";
  if (/<title>\s*(?:Apache Tomcat|Error report)/i.test(html)) return "server-error-page";
  if (/\/do\/off\/ui\/auth\/login\//i.test(html)) return "id-login-link";
  return html.trim().length === 0 ? "empty" : "unknown";
}

/** 真·登录页特征：learn 登录页标题 / id 登录表单 / oauth 跳转。
 *  注意区分**服务器错误页**（Tomcat 400/500）——那是请求本身被拒（字段缺失、请求体
 *  没送到），重登毫无用处；R21c 真机实录：FormData 被序列化成 "[object FormData]" 导致
 *  tjzy 回 400，旧代码一律当「会话已过期」，把真因掩盖了整整一轮排查。 */
const LEARN_LOGIN_PAGE_RE =
  /sm2publicKey|name="i_pass"|登录页\s*-\s*清华大学网络学堂|电子身份服务系统|\/do\/off\/ui\/auth\/login\//i;

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
    if (!csrf) throw new LearnSessionMissingError();
    this.#csrf = csrf;
  }

  /** 手动恢复已保存会话（CookieJar hydrate 后调用）。
   *  OneTHU 适配（2026-09-17）：直取失败 → 经 /f/login（learn 的服务端 302
   *  CAS 入口，demo 路径一同源）静默重登——id 会话活则整条 SSO 由重定向链
   *  自动走完（原生通道跟随），无需账密重 POST。 */
  async resume(): Promise<boolean> {
    const csrf = await this.#fetchCsrf();
    if (csrf) {
      this.#csrf = csrf;
      return true;
    }
    return this.silentRelogin();
  }

  /** 账密供应（clients.ts 注入，本模块不持密码） */
  credentialProvider: (() => {
    username: string;
    password: string;
    fingerprint: string;
    finger3?: string;
  } | null) | null = null;

  /** 经 CAS 入口静默重建 learn 会话：路径一免密（id 会话活→重定向链自动 SSO），
   *  路径二账密全链（demo demoEnterLearn 同源；finger3 受信免 2FA）。
   *  失败返回 false 不抛错。 */
  async silentRelogin(): Promise<boolean> {
    const wrap = (u: string): string =>
      this.#http.webVPNEncoder ? this.#http.webVPNEncoder(u) : u;
    // 路径零：宿主注入的 id-漫游（lib 探活主会话后漫游建学习会话）。
    // 2026-09-17 定案：本管线里学习会话就是靠它建的，/f/login 已不作数——但
    // 保留在后作兜底，成本只有一次请求。
    if (this.reloginHook) {
      try {
        const hooked = await this.reloginHook();
        const csrf0 = hooked ? await this.#fetchCsrf() : null;
        this.#http.debug?.(`LEARN-SILENT 路径零 hook=${hooked ? "ok" : "fail"} 凭据=${csrf0 ? "ok" : "无"}`);
        if (csrf0) {
          this.#csrf = csrf0;
          return true;
        }
      } catch (e) {
        this.#http.debug?.(`LEARN-SILENT 路径零异常 ${String(e).slice(0, 120)}`);
      }
    }
    // 路径一：/f/login 是 learn 的服务端 302 CAS 入口
    try {
      await this.#http.text(wrap("https://learn.tsinghua.edu.cn/f/login"));
      const csrf1 = await this.#fetchCsrf();
      this.#http.debug?.(`LEARN-SILENT 路径一 csrf=${csrf1 ? "ok" : "无"} final=${this.#http.lastFinalUrl.slice(0, 110)}`);
      if (csrf1) {
        this.#csrf = csrf1;
        return true;
      }
    } catch (e) {
      this.#http.debug?.(`LEARN-SILENT 路径一异常 ${String(e).slice(0, 120)}`);
    }
    // 路径二：账密全链
    const cred = this.credentialProvider?.();
    if (!cred) return false;
    try {
      const CAS_FORM =
        "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/bb5df85216504820be7bba2b0ae1535b/0";
      const CAS_CHECK = "https://id.tsinghua.edu.cn/do/off/ui/auth/login/check";
      const formHtml = await this.#http.text(wrap(CAS_FORM));
      const key = /id="sm2publicKey"[^>]*>\s*([0-9a-fA-F]{100,})\s*</.exec(formHtml)?.[1] ?? "";
      if (!key) return false;
      const checkHtml = await this.#http
        .request(wrap(CAS_CHECK), {
          method: "POST",
          body: new URLSearchParams({
            i_user: cred.username,
            i_pass: encryptPassword(cred.password, key),
            fingerPrint: cred.fingerprint,
            fingerGenPrint: cred.finger3 ?? "",
            i_captcha: "",
          }),
        })
        .then((r) => r.text());
      this.#http.debug?.(
        `LEARN-SILENT 路径二 check=${checkHtml.includes("登录成功") ? "成功" : checkHtml.slice(0, 80).replace(/\s+/g, " ")}`,
      );
      // 成功页锚点：必须是 learn 漫游入口（带 ticket 的 roaming_entry）——
      // 抓第一个 <a> 会拿到 oauth 回调死链（2026-09-17 逐跳实录：callback?
      // ticket 200 死胡同，不铸会话）。没有漫游锚点=认证没成，直接放弃路径二。
      const anchorMatch =
        /href=['"]([^'"]*(?:roaming_entry|j_spring)[^'"]*ticket[^'"]*)['"]/i.exec(checkHtml) ??
        /href=['"](https?:\/\/learn\.tsinghua\.edu\.cn[^'"]+)['"]/i.exec(checkHtml);
      const anchor = anchorMatch?.[1] ?? "";
      this.#http.debug?.(
        `LEARN-SILENT 路径二锚点 ${anchor ? anchor.slice(0, 120) : "未找到（放弃）"}`,
      );
      if (!anchor) return false;
      await this.#http.text(anchor.startsWith("http") ? wrap(anchor) : wrap("https://learn.tsinghua.edu.cn" + anchor));
      const csrf = await this.#fetchCsrf();
      this.#csrf = csrf;
      return csrf !== null;
    } catch {
      return false;
    }
  }

  /** 诊断现场：最后一次课程页内容（登录凭据提取失败时用于定位） */
  lastDebug = "";

  /** 诊断现场：最近一次取登录凭据的结果（只记种类与长度，不记凭据值本身） */
  lastCsrfDebug = "";

  /** 宿主侧会话重建钩子（桌面端注入：lib 探活 + id-漫游建学习会话）。
   *  本模块不依赖桌面端实现，但在这条管线下学习会话正是靠它建起来的。 */
  reloginHook: (() => Promise<boolean>) | null = null;

  /** 诊断现场：最近一次 getCourseGroups 的解析情况（返回空数组时用于定位） */
  lastGroupsDebug = "";

  /** 诊断现场：讨论列表解析为空时的页面 HTML 头部（空串 = 有数据） */
  lastBbsListDebug = "";

  /** 诊断现场：话题阅读/回复为空时的原始证据（空串 = 正常） */
  lastBbsThreadDebug = "";

  async #fetchCsrf(): Promise<string | null> {
    try {
      // 抓登录凭据的请求本身不能要求已有凭据（原 #withCsrf 写法 =
      // 「无凭据即抛」死锁，学习会话从未真正建立——2026-09-17 实录）
      const html = await this.#http.text(urls.LEARN_COURSE_LIST_PAGE());
      this.lastDebug = html.slice(0, 1200);
      const hit = extractLearnCsrf(html);
      this.lastCsrfDebug = hit
        ? `ok via=${hit.via} len=${html.length}`
        : `miss kind=${classifyLearnPage(html)} len=${html.length} final=${this.#http.lastFinalUrl.slice(0, 90)}`;
      return hit?.token ?? null;
    } catch (e) {
      this.lastDebug = "FETCH-ERROR " + String(e);
      this.lastCsrfDebug = "FETCH-ERROR " + String(e).replace(/\s+/g, " ").slice(0, 150);
      return null;
    }
  }

  /** 会话重建去重：同一时刻多个数据钩子一起撞上会话死，只重建一次
   *  （并发重链互相烧票据，2026-09-17 实录）。 */
  #reloginInflight: Promise<boolean> | null = null;

  async #recoverSession(): Promise<boolean> {
    if (this.#reloginInflight) return this.#reloginInflight;
    this.#reloginInflight = this.silentRelogin()
      .catch(() => false)
      .finally(() => {
        this.#reloginInflight = null;
      });
    return this.#reloginInflight;
  }

  /** 会话自证的并发去重：入口们是并行调用的（作业/通知/文件列表），
   *  同时进来只跑一条链。 */
  #csrfInflight: Promise<string | null> | null = null;

  /** 会话自证：没有登录状态就先取一次凭据，取不到再重建，最后才谈报错。
   *  作业/通知/详情这几个入口的凭据检查落在 #withRelogin 之外，会话一死
   *  它们连一次重试机会都没有——用户看到的是「详情/通知/作业都说过期，
   *  别的数据还在出」（2026-09-23 复核 #42）。
   *  先取一次再重建：刚启动时凭据本来就还没取过，直接走重建链会白跑一趟
   *  主会话探活与漫游。 */
  async #ensureCsrfReady(): Promise<void> {
    if (this.#csrf) return;
    if (!this.#csrfInflight) {
      this.#csrfInflight = this.#establishSession().finally(() => {
        this.#csrfInflight = null;
      });
    }
    const token = await this.#csrfInflight;
    if (!token) this.#requireCsrf();
    this.#csrf = token;
  }

  /** 建立登录状态：先按现状取凭据（一次请求），取不到再走重建链。 */
  async #establishSession(): Promise<string | null> {
    const direct = await this.#fetchCsrf();
    if (direct) return direct;
    if (await this.#recoverSession()) return this.#csrf;
    return null;
  }

  /** 会话失效 → 重建一次再重试（R21c 用户口径：有记住的账密就该静默恢复，
   *  不该把用户踹回登录页）。只对会话类标记生效——启动期凭据就拿不到时抛的
   *  是 LearnSessionMissingError（同为 SessionExpiredError），入口侧先经
   *  #ensureCsrfReady 自证，不会无凭据空转重建。
   *  只重试一次：重建成功仍失效说明会话层真坏了，交还上层提示。 */
  async #withRelogin<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof SessionExpiredError)) throw e;
      this.#http.debug?.("LEARN-RELOGIN 会话失效，静默重登后重试一次");
      if (!(await this.#recoverSession())) {
        this.#http.debug?.("LEARN-RELOGIN 静默重登失败，交还上层");
        throw e;
      }
      return await fn();
    }
  }

  #requireCsrf(): string {
    if (!this.#csrf) {
      this.#http.debug?.(`LEARN-CSRF 未建立 ${this.lastCsrfDebug}`);
      throw new LearnSessionMissingError();
    }
    return this.#csrf;
  }

  /** learn-lib addCSRFTokenToUrl：learn 接口一律要求 _csrf 查询参数，缺失时返回 HTML 错误页 */
  #withCsrf(url: string): string {
    const u = new URL(url);
    u.searchParams.set("_csrf", this.#requireCsrf());
    return u.toString();
  }

  /** 讨论区 /b/bbs ajax 端点：站点 jQuery 发的请求带 X-Requested-With + Referer，
   *  服务器过滤器对无此头的请求可能回 HTML 壳（2.har 请求头实录） */
  async #bbsPost(url: string, body: URLSearchParams | FormData): Promise<string> {
    return this.#http.request(this.#withCsrf(url), {
      method: "POST",
      body,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Referer":
          urls.LEARN_PREFIX +
          "/f/wlxt/bbs/bbs_tltb/student/beforePageTlList?wlkcid=" +
          (new URL(url).searchParams.get("wlkcid") ?? body.get("wlkcid") ?? ""),
      },
    }).then((r) => r.text());
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
          name: decodeText(c.kcm) || decodeText(c.zywkcm),
          englishName: decodeText(c.ywkcm),
          courseNumber: str(c.kch),
          courseIndex: Number(c.kxh ?? 0),
          teacherName: decodeText(c.jsm),
          timeAndLocation: [],
          url: urls.LEARN_COURSE_PAGE(id),
        };
      });
    });
  }

  /** 全部课程的作业（未交 + 已交未批 + 已批） */
  async getAllHomework(courseIds: string[]): Promise<Homework[]> {
    await this.#ensureCsrfReady();
    this.#requireCsrf();
    const groups = await Promise.all(
      courseIds.map((courseId) =>
        Promise.all(
          (["new", "submitted", "graded"] as const).map((kind) =>
            this.#fetchHomeworkKind(courseId, kind).catch((e) => {
              this.#http.debug?.(`LEARN-HW 单项失败 course=${courseId} kind=${kind} ${String(e).slice(0, 90)}`);
              return [] as Homework[];
            }),
          ),
        ),
      ),
    );
    return groups.flat(2);
  }

  async #fetchHomeworkKind(courseId: string, kind: "new" | "submitted" | "graded"): Promise<Homework[]> {
    return this.#withRelogin(async () => {
      this.#http.debug?.(`LEARN-HW 入口 course=${courseId} kind=${kind} csrf=${this.#csrf ? "有" : "无"}`);
      const json = await this.#http.json<LearnJson>(this.#withCsrf(urls.LEARN_HOMEWORK_LIST[kind]), {
        method: "POST",
        body: this.#aoData({ wlkcid: courseId }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          // learn Tomcat 对裸 POST 回 400（真机实录）——jQuery 网页请求特征补齐
          "X-Requested-With": "XMLHttpRequest",
          Referer: "https://learn.tsinghua.edu.cn/f/wlxt/index/course/student/index",
        },
      });
      // OneTHU 诊断：200 里可能是 error/分页包裹/HTML——首段落日志一轮定案
      this.#http.debug?.(
        `LEARN-API 作业 kind=${kind} course=${courseId} → ${JSON.stringify(json).slice(0, 180)}`,
      );
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
          title: decodeText(d.bt),
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
          gradeContent: decodeText(d.pynr).trim() || undefined,
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
    try {
      return await this.#withRelogin(async () => {
      const fd = new FormData();
      fd.append("xszyid", studentHomeworkId);
      fd.append("zynr", opts.content ?? "");
      if (opts.file) fd.append("fileupload", opts.file, opts.file.name);
      else fd.append("fileupload", "undefined");
      fd.append("isDeleted", opts.remove ? "1" : "0");
      const url = this.#withCsrf(urls.LEARN_PREFIX + "/b/wlxt/kczy/zy/student/tjzy");
      const res = await this.#http.postForm(url, fd);
      // 返回 HTML = 会话失效被重定向到登录页/网关页（learnApi 同款判定），不能当成功吞掉。
      // R21c：抛标记交 #withRelogin 静默重登后重试一次，重试仍失败才回过期提示。
      if (/<(!DOCTYPE|html)/i.test(res.slice(0, 200))) {
        this.lastDebug = "TJZY-HTML " + res.slice(0, 400).replace(/\s+/g, " ");
        // 只有真登录页才值得静默重登；服务器错误页如实报错（别再指向会话）
        if (LEARN_LOGIN_PAGE_RE.test(res)) {
          throw new SessionExpiredError("网络学堂会话已失效（提交后没等到确认）");
        }
        const status = /HTTP Status (\d{3})/.exec(res)?.[1] ?? "";
        return {
          ok: false,
          msg: status
            ? `提交失败：服务器拒绝请求（HTTP ${status}），详情见运行日志`
            : "提交失败：服务器返回错误页，详情见运行日志",
        };
      }
      try {
        const data = JSON.parse(res) as { result?: string; msg?: string };
        // result === "error" 明确失败（thu-lib 只认 "success"；learnApi 宽容：非 error 即成功）
        if (data.result === "error") {
          this.lastDebug = "TJZY-ERR " + res.slice(0, 400);
          return { ok: false, msg: data.msg ?? "提交失败" };
        }
        return { ok: true };
      } catch {
        this.lastDebug = "TJZY-NONJSON " + res.slice(0, 400).replace(/\s+/g, " ");
        return { ok: false, msg: "返回非 JSON（可能未登录或接口变更）" };
      }
      });
    } catch (e) {
      if (e instanceof SessionExpiredError) {
        return { ok: false, msg: "会话已过期，请重新登录后再提交" };
      }
      throw e;
    }
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
      return { description: decodeText(msg) };
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
      const href = decodeText(a[1]!).trim();
      if (!href || href === "#" || /^javascript:/i.test(href)) continue;
      // 答疑/论坛/笔记等纯导航路由（mobile filterJunkLinks：/bbs|kcdy|biji|taolun|dayi|答疑）
      if (/\/(?:bbs|kcdy|biji|taolun|dayi)\b|答疑/i.test(href)) continue;
      const q = href.indexOf("?");
      const params = new URLSearchParams(q >= 0 ? href.slice(q + 1) : "");
      const id = params.get("fileId") ?? params.get("wjid") ?? "";
      const dl = params.get("downloadUrl");
      // 无文件下载参数 = 不是附件（页面导航/锚点），绝不冒充附件名
      if (!id && !dl) continue;
      const name = decodeText(a[2]!.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
      // 页面经 webvpn 取回时 href 可能已是 `/https/<hex>/…` 包装形态：交给 learnAbsoluteUrl
      // 判断（再拼一次 LEARN_PREFIX 就是双重包装 → 404，真机踩过）
      const downloadUrl = urls.learnAbsoluteUrl(dl ?? href);
      const size = decodeText(/<span[^>]*class="[^"]*color[^"]*"[^>]*>([^<]*)<\/span>/i.exec(block)?.[1] ?? "").trim();
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
  /** 最近一次作业详情双页解析的现场（诊断用：长度/锚点/提取结果尺寸） */
  lastPageDetailDebug = "";

  async getHomeworkPageDetail(courseId: string, studentHomeworkId: string): Promise<HomeworkPageDetail> {
    await this.#ensureCsrfReady();
    this.#requireCsrf();
    // 双页解析（thu-app learnApi 同款）：提交表单（zynr/fileupload）在 tijiao 页，
    // viewCj 是成绩详情页——未交作业的 viewCj 上没有表单，只抓 viewCj 会把提交卡
    // 判死（「看不到哪里能提交」的根因）。两页并行取，任一失败按空串参与解析。
    // as const 元组：noUncheckedIndexedAccess 下非元组数组解构元素是 string|undefined
    const [tijiao, viewcj] = await Promise.all(
      [
        this.#http.text(urls.LEARN_HOMEWORK_SUBMIT_PAGE(courseId, studentHomeworkId)).then((t) => t ?? "").catch(() => ""),
        this.#http.text(urls.LEARN_HOMEWORK_PAGE(courseId, studentHomeworkId)).then((t) => t ?? "").catch(() => ""),
      ] as const,
    );
    const hasForm = (h: string): boolean =>
      /\btjzy\b/i.test(h) ||
      /<input\b[^>]*name=["']fileupload["']/i.test(h) ||
      /<textarea\b[^>]*name=["']zynr["']/i.test(h);
    const out: HomeworkPageDetail = { hasSubmitForm: hasForm(tijiao) || hasForm(viewcj) };
    // 附件四槽（文档序 = 四类附件顺序）：tijiao 先占位，viewCj 只补空槽
    // （learnApi assignFujianSlots 同款：viewCj 传 onlyEmpty，已占槽跳过但槽位照常前进）
    const keys = ["attachment", "answerAttachment", "submittedAttachment", "gradeAttachment"] as const;
    const fill = (html: string, onlyEmpty: boolean): void => {
      if (!html) return;
      const starts = [...html.matchAll(/<div[^>]*class=["']list[^"']*["'][^>]*>/gi)].map((m) => ({
        idx: m.index ?? 0,
        fujian: /fujian/i.test(m[0]),
      }));
      let kindIdx = 0;
      for (let i = 0; i < starts.length && kindIdx < keys.length; i++) {
        if (!starts[i]!.fujian) continue;
        const k = keys[kindIdx];
        kindIdx++;
        if (!k || (onlyEmpty && out[k])) continue;
        const a = this.#parseAttachmentAnchor(this.#fujianBlockContent(html, starts[i]!.idx));
        if (a && k) out[k] = a;
      }
    };
    fill(tijiao, false);
    fill(viewcj, true);
    // 我的提交内容（上次 zynr）：2026-09-06 真实页面（程序设计训练存档）实证——正文在
    // boxbox 第 2 块「本人提交的作业」的「上交作业内容」标签后：
    // <div class=" fl left" ...>上交作业内容</div><div class=" right"><span ...>HTML</span></div>，
    // 随后即 <!--作业附件-->。老 boxbox[2]+rightParts[3] 捞的是第 1 块（作业要求），恒空。
    const cidx = viewcj.indexOf("上交作业内容");
    if (cidx >= 0) {
      const open = /<div[^>]*class="[^"]*\bright\b[^"]*"[^>]*>/i.exec(viewcj.slice(cidx));
      if (open) {
        const start = cidx + open.index + open[0].length;
        const rest = viewcj.slice(start);
        const stop = /<!--作业附件-->|<div[^>]*class="[^"]*fujian/i.exec(rest);
        let inner = stop ? rest.slice(0, stop.index) : rest;
        inner = inner.replace(/(?:\s*<\/div>)+\s*$/, "").trim();
        // style/script 经 innerHTML 注入既不显示也不执行，但会让「有内容」误判——直接剥掉；
        // 站点会在正文外面包脚手架注释（实证：<!-- <span style="line-height: 24px;"> -->），
        // 剥「完整」注释——千万别只删 "-->"（删了闭合符整段正文变成未闭合注释被浏览器全吞，
        // 2026-09-06「我的提交正文不可见」真凶，此前 preview/prefill 里的 .replace("-->","") 即此雷）
        inner = inner.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "");
        inner = inner.replace(/<!--[\s\S]*?-->/g, "").trim();
        if (inner) out.submittedContent = decodeHtml(inner);
      }
    }
    if (!out.submittedContent) {
      const ta = /<textarea[^>]*name=["']zynr["'][^>]*>([\s\S]*?)<\/textarea>/i.exec(tijiao);
      const draft = ta?.[1]?.trim();
      if (draft) out.submittedContent = decodeHtml(draft);
    }
    this.lastPageDetailDebug =
      `viewCj=${viewcj.length} tijiao=${tijiao.length} 上交作业内容@${cidx} form=${out.hasSubmitForm} 提取=${out.submittedContent?.length ?? -1} 原文=${JSON.stringify((out.submittedContent ?? "").slice(0, 180))}`;
    return out;
  }

  /** 通知详情页（beforeViewXs HTML）附件解析 —— thu-learn-lib parseNotificationDetail 等价。
   *  学生版附件锚点带 class="ml-10"（href 含 wjid）；fjmc 只有文件名，下载地址在页面里。 */
  async getNotificationPageDetail(courseId: string, notificationId: string): Promise<NotificationPageDetail> {
    await this.#ensureCsrfReady();
    this.#requireCsrf();
    const html = await this.#http.text(urls.LEARN_NOTIFICATION_DETAIL(courseId, notificationId));
    const anchors = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
    const pick =
      anchors.find((m) => /ml-10/i.test(m[0]) || /[?&]wjid=/.test(m[1]!)) ??
      anchors.find((m) => /wjid/i.test(m[0]));
    if (!pick) return {};
    const href = decodeText(pick[1]!);
    const q = href.indexOf("?");
    const params = new URLSearchParams(q >= 0 ? href.slice(q + 1) : "");
    const id = params.get("wjid") ?? params.get("fileId") ?? "";
    const dl = params.get("downloadUrl");
    // 同附件锚点：通知页也是经 webvpn 取回的，href 可能已带 `/https/<hex>/` 前缀
    const downloadUrl = urls.learnAbsoluteUrl(dl ?? href);
    const name = decodeText(pick[2]!.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    const size = decodeText(
      /id="attachment"[^>]*>[\s\S]*?<span[^>]*class="[^"]*color[^"]*"[^>]*>([^<]*)<\/span>/i.exec(html)?.[1] ?? "",
    ).trim();
    if (!id && !name) return {};
    return { attachment: { id, name, downloadUrl, size: size || undefined } };
  }

  /** 通知（全部课程或指定课程）；expired=已过期 */
  async getAllNotifications(courseIds: string[], expired = false): Promise<Notification[]> {
    await this.#ensureCsrfReady();
    this.#requireCsrf();
    const groups = await Promise.all(
      courseIds.map((courseId) =>
        this.#withRelogin(async () => {
          const json = await this.#http.json<LearnJson>(this.#withCsrf(urls.LEARN_NOTIFICATION_LIST(expired)), {
            method: "POST",
            body: this.#aoData({ wlkcid: courseId, iDisplayStart: 0, iDisplayLength: 50 }),
            headers: {
              "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
              "X-Requested-With": "XMLHttpRequest",
              Referer: "https://learn.tsinghua.edu.cn/f/wlxt/index/course/student/index",
            },
          });
          this.#http.debug?.(`LEARN-API 通知 → ${JSON.stringify(json).slice(0, 180)}`);
          return asArray(json.object ?? json.resultList).map((raw) => {
            const d = raw as Record<string, unknown>;
            const cid = str(d.wlkcid) || courseId;
            const nid = str(d.ggid ?? d.id);
            return {
              id: nid,
              courseId: cid,
              title: decodeText(d.bt ?? d.ggbt),
              content: decodeBase64Utf8(str(d.ggnr)),
              publisher: decodeText(d.fbrxm),
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
          title: decodeText(d.bt ?? d.kjbt),
          uploadTime: normalizeTime(d.scsj, d.fxsj ?? d.scj),
          downloadUrl: urls.LEARN_FILE_DOWNLOAD(fid),
          fileType: rawType || undefined,
          size: str(d.fileSize).trim() || undefined,
          description: decodeText(d.ms).trim() || undefined,
          important: str(d.sfqd) === "1",
        };
      });
    });
  }

  /** 课程「我的分组」（beforePageWdfzList HTML 宽容解析 → pageFzList JSON 兜底）。
   *  两路都提不出结构时返回 []，现场写入 lastGroupsDebug；
   *  分组页被重定向到登录页时抛 AuthRequiredError（与相邻 HTML 方法风格一致）。 */
  /* ───── 讨论区（bbs_tltb） ───── */

  /** 板块列表（bqListByWlkcid，POST wlkcid；响应是 JSON 字符串，前端站点自己都要 eval 一层） */
  async getBbsBoards(wlkcid: string): Promise<LearnBbsBoard[]> {
    return this.#withRelogin(async () => {
      this.#requireCsrf();
      const res = await this.#bbsPost(urls.LEARN_BBS_BOARD_LIST(wlkcid), new URLSearchParams({ wlkcid }));
      const arr = parseMaybeJsonString<unknown>(res);
      const rawList = Array.isArray(arr)
        ? arr
        : Array.isArray((arr as Record<string, unknown>)?.object)
          ? ((arr as Record<string, unknown>).object as unknown[])
          : Array.isArray((arr as Record<string, unknown>)?.resultList)
            ? ((arr as Record<string, unknown>).resultList as unknown[])
            : [];
      if (rawList.length === 0) this.lastBbsListDebug = `BOARD RESP:\n` + res.slice(0, 1000);
      return rawList.map((raw: unknown) => {
        const o = (raw ?? {}) as Record<string, unknown>;
        return {
          bqid: String(o.bqid ?? o.id ?? ""),
          name: decodeText(String(o.bqmc ?? o.bqtitle ?? o.title ?? o.mc ?? "板块").trim()) || "板块",
        };
      }).filter((b) => b.bqid);
    });
  }

  /** 话题分页（ybtl/jhtl/cytlPageList）。真实协议（2.har 实抓）：body 只有一个参数
   *  aoData = URL-encoded JSON 数组（DataTables 1.9 内部状态）；响应 aaData 在 object.aaData，
   *  行主键 tltid。默认板 INITTL…，页长 30 同站点。 */
  async getBbsThreads(
    wlkcid: string,
    opts: { bqid: string; kind: "yb" | "jh" | "cy"; start: number; length?: number },
  ): Promise<{ total: number; threads: LearnBbsThreadSummary[] }> {
    return this.#withRelogin(async () => {
      this.#requireCsrf();
      const length = opts.length ?? 30;
      const aoData = [
        { name: "sEcho", value: 1 },
        { name: "iColumns", value: 7 },
        { name: "sColumns", value: ",,,,,," },
        { name: "iDisplayStart", value: opts.start },
        { name: "iDisplayLength", value: String(length) },
        { name: "mDataProp_0", value: "function" },
        { name: "bSortable_0", value: false },
        { name: "mDataProp_1", value: "bt" },
        { name: "bSortable_1", value: true },
        { name: "mDataProp_2", value: "fbrxm" },
        { name: "bSortable_2", value: true },
        { name: "mDataProp_3", value: "fbsj" },
        { name: "bSortable_3", value: true },
        { name: "mDataProp_4", value: "hfcs" },
        { name: "bSortable_4", value: true },
        { name: "mDataProp_5", value: "zhhfsj" },
        { name: "bSortable_5", value: true },
        { name: "mDataProp_6", value: "function" },
        { name: "bSortable_6", value: true },
        { name: "iSortingCols", value: 0 },
        { name: "wlkcid", value: wlkcid },
        { name: "bqid", value: opts.bqid },
      ];
      const body = new URLSearchParams({ aoData: JSON.stringify(aoData) });
      const res = await this.#bbsPost(urls.LEARN_BBS_THREAD_PAGE(opts.kind), body);
      const obj = parseMaybeJsonString<{ object?: { aaData?: unknown[]; iTotalDisplayRecords?: unknown; iTotalRecords?: unknown } }>(res);
      const inner = (obj?.object ?? {}) as Record<string, unknown>;
      const rows = Array.isArray(inner.aaData) ? inner.aaData : [];
      const threads = rows.map(parseBbsThreadRow);
      const total = parseInt(String(inner.iTotalDisplayRecords ?? inner.iTotalRecords ?? threads.length), 10);
      this.lastBbsListDebug = threads.length === 0 ? `THREAD-PAGE RESP(${opts.kind},bqid=${opts.bqid},start=${opts.start}):\n` + res.slice(0, 1200) : "";
      return { total: Number.isFinite(total) ? total : threads.length, threads };
    });
  }

  /** 话题头（viewTlById HTML：标题 #tlbt、楼主块 louzhuu、分页 loadpage2 总数、tabbh/tabid/bqid）。
   *  请求照浏览器链接点击原样：无 _csrf、Referer=列表页、Accept text/html（2026-09-02 实测定案）。 */
  async getBbsThread(wlkcid: string, threadId: string, bqid?: string): Promise<LearnBbsThreadDetail> {
    return this.#withRelogin(async () => {
      this.#requireCsrf();
      const view = (u: string) =>
        this.#http
          .request(u, {
            headers: {
              "Referer": urls.LEARN_BBS_LIST_REFERER(wlkcid),
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
          })
          .then((r) => r.text());
      let html = await view(urls.LEARN_BBS_THREAD_VIEW(wlkcid, threadId, bqid));
      if (looksLikeLearnLoginShell(html)) {
        // 会话壳页：先热一次课程列表页（顺带刷新 _csrf）再重试——浏览器里 Cookie 链路是热的，
        // 直 GET 话题页会撞登录壳（2026-09-02 诊断实录）
        await this.#http.text(this.#withCsrf(urls.LEARN_COURSE_LIST_PAGE())).catch(() => undefined);
        html = await view(urls.LEARN_BBS_THREAD_VIEW(wlkcid, threadId, bqid));
      }
      const main = parseBbsMainBlock(html);
      // 诊断：楼主块空 = 页面结构/会话异常，留标题区+楼主区+长度指纹
      this.lastBbsThreadDebug =
        main.html || main.author
          ? ""
          : `THREAD-VIEW len=${html.length} loginShell=${looksLikeLearnLoginShell(html)} louzhuu=${html.includes("louzhuu")} tlbt=${html.includes("tlbt")}\n` +
            html.slice(0, 900);
      const span = (re: RegExp): string => re.exec(html)?.[1] ?? "";
      return {
        posts: parseBbsReplyBlocks(html),
        id: threadId,
        title: decodeText(
          span(/id="tlbt"[\s\S]{0,220}?<span[^>]*title="([^"]*)"/) ||
            span(/id="tlbt"[\s\S]{0,300}?<span[^>]*>([^<]{2,200})<\/span>/),
        ).trim(),
        author: main.author,
        time: main.time,
        html: main.html,
        replyCount: (() => {
          const n = parseInt(span(/loadpage2\([^,]+,\s*(\d+)\s*,/), 10);
          // 回复 ≤8 时页面无分页器，loadpage2 不存在 → 用首屏渲染数兜底
          const fallback = main ? parseBbsReplyBlocks(html).length : 0;
          // OneTHU 诊断（2026-09-17 回复翻页失灵）：全部 loadpage 形态 + 分页器标记
          {
            const chunks: string[] = [];
            let at = html.indexOf("loadpage");
            while (at >= 0 && chunks.length < 6) {
              chunks.push(JSON.stringify(html.slice(at, at + 90)));
              at = html.indexOf("loadpage", at + 1);
            }
            const pagerAt = html.search(/下一页|上一页|pagination|pager|pagebox|countindex/);
            const pagerChunk = pagerAt >= 0 ? JSON.stringify(html.slice(Math.max(0, pagerAt - 80), pagerAt + 260)) : "无标记";
            const itemMarks = (html.match(/item_[0-9a-f]{8,}/g) ?? []).length;
            // loadpage(num) 主分页函数体（真实 ajax 姿势在此）——全量输出
            const fnAt = html.search(/function loadpage\(/);
            const fnBody = fnAt >= 0 ? html.slice(fnAt, fnAt + 900).replace(/\s+/g, " ") : "无";
            this.#http.debug?.(
              `BBS-REPLY n=${n} fallback=${fallback} item数=${itemMarks} pager=${pagerChunk.slice(0, 80)}`,
            );
            this.#http.debug?.(`BBS-LOADPAGE ${fnBody}`);
          }
          return Number.isFinite(n) && n > 0 ? n : fallback;
        })(),
        tabbh: span(/tabbh=(\d+)/),
        tabid: span(/[?&]tabid=([0-9a-f]{16,40})/),
        bqid: span(/[?&]bqid=([0-9a-f]{16,40})/),
      };
    });
  }

  /** 回复分页（2026-09-17 HAR 定案）：站点「下一页」= 重新 GET viewTlById 帖子页
   *  带 pageNum（0 起），服务端渲染那一页的 15 条回复——不走 JSON ajax
   *  （pageViewTlById 对主楼层恒回 total:0，只服务楼中楼）。UI 端按 hhid 去重
   *  追加，空页/全重复即收口。 */
  async getBbsThreadPosts(wlkcid: string, threadId: string, pageNum: number, bqid?: string): Promise<LearnBbsPost[]> {
    return this.#withRelogin(async () => {
      this.#requireCsrf();
      const viewUrl =
        urls.LEARN_BBS_THREAD_VIEW(wlkcid, threadId, bqid) +
        `&sfqb=1&pageNum=${pageNum}`; // HAR 实录：站点翻页 = viewTlById?...&sfqb=1&pageNum=N
      const html = await this.#http
        .request(viewUrl, {
          headers: {
            Referer: urls.LEARN_BBS_LIST_REFERER(wlkcid),
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        })
        .then((r) => r.text());
      if (looksLikeLearnLoginShell(html)) {
        this.lastBbsThreadDebug = `POSTS-PAGE(page=${pageNum}) 登录壳 len=${html.length}`;
        // 回登录页 = 会话真的死了（可静默重建），不是解析失败
        throw new SessionExpiredError("网络学堂会话已失效（讨论区回复页面返回了登录页）");
      }
      const posts = parseBbsReplyBlocks(html);
      this.lastBbsThreadDebug =
        posts.length === 0 ? `POSTS-PAGE(page=${pageNum}) 空回复 len=${html.length}` : "";
      return posts;
    });
  }

  /** 发表回复（saveEdit）。站点表单：wlkcid/tltid/nr [+fhhid/_fhhid] + fileupload（1G 限）。
   *  站点经 ajaxfileupload 走 multipart（无附件时 file 字段占位）——作业提交 tjzy 同范式。
   *  nr = 富文本 HTML（CKEditor 同源）。 */
  async postBbsReply(
    wlkcid: string,
    threadId: string,
    nr: string,
    fhhid?: string,
    file?: File | null,
  ): Promise<void> {
    return this.#withRelogin(async () => {
      this.#requireCsrf();
      const fd = new FormData();
      fd.append("wlkcid", wlkcid);
      fd.append("tltid", threadId);
      if (fhhid) {
        fd.append("fhhid", fhhid);
        fd.append("_fhhid", fhhid);
      }
      fd.append("nr", nr);
      if (file) fd.append("fileupload", file, file.name);
      else fd.append("fileupload", "undefined");
      const res = await this.#bbsPost(urls.LEARN_BBS_SAVE_REPLY(wlkcid), fd);
      let ok = false;
      try {
        const j = JSON.parse(res) as { result?: unknown; msg?: unknown };
        ok = /success/i.test(String(j.result ?? "")) || res.trim().length === 0;
      } catch {
        ok = /success/i.test(res) || res.trim().length === 0;
      }
      if (!ok) {
        const msg = decodeText(res.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
        throw new Error(msg.slice(0, 140) || "回复失败（站点未返回成功标记）");
      }
    });
  }

  /** 发表新话题（saveTl）。schema 按 beforeEditTl 站点表单惯例：
   *  wlkcid/bqid/tabbh + bt(标题) + wtnr(正文 HTML) + fileupload。首版未经真机采样，
   *  失败时错误信息直出服务器回包，现场校准。 */
  async postBbsThread(
    wlkcid: string,
    opts: { bqid: string; title: string; html: string; file?: File | null },
  ): Promise<void> {
    return this.#withRelogin(async () => {
      this.#requireCsrf();
      const fd = new FormData();
      fd.append("wlkcid", wlkcid);
      fd.append("bqid", opts.bqid);
      fd.append("tabbh", "2");
      fd.append("bt", opts.title);
      fd.append("wtnr", opts.html);
      if (opts.file) fd.append("fileupload", opts.file, opts.file.name);
      else fd.append("fileupload", "undefined");
      const res = await this.#bbsPost(urls.LEARN_BBS_SAVE_THREAD(wlkcid), fd);
      let ok = false;
      try {
        const j = JSON.parse(res) as { result?: unknown; msg?: unknown };
        ok = /success/i.test(String(j.result ?? "")) || res.trim().length === 0;
      } catch {
        ok = /success/i.test(res) || res.trim().length === 0;
      }
      if (!ok) {
        const msg = decodeText(res.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
        throw new Error(msg.slice(0, 140) || "发表失败（站点未返回成功标记）");
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
        throw new SessionExpiredError("网络学堂会话已失效（分组页面返回了登录页）");
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
