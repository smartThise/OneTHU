/**
 * zhjwxk（清华选课系统）客户端 —— demo webvpn-poc/server.js 选课 API 的逐行移植。
 *
 * 会话模型（与 OneTHU 登录一致，必须遵守）：
 *  - 会话 = CampusSession 暴露的 demo Cookie 字符串（只读 getter demoCookies）
 *  - 所有请求走 demoLogin.ts 的 webvpnRequest（手动跟 302 ≤20 跳、Cookie 合并、后值覆盖）
 *    + webvpnWrap() 包装 URL；zhjwxk 域是 http（demo 的 ZHJWXK 常量同款）
 *
 * demo → 这里 的对照：
 *  - establishZhjwxkSession (server.js L242-266) → #ensure（GET xklogin.do，maxHops 25，
 *    从响应提 p_xnxq 学期；成功判定 html 含 'xkBks' 或 '选课'）
 *  - proxyZhjwxkApi (server.js L271-281)         → #proxy（encodeUrl/webvpnWrap + webvpnRequest）
 *  - GET /api/courses (server.js L284-307)       → getSelectedCourses（m=yxSearchTab）
 *  - GET /api/queue   (server.js L310-332)       → getQueueStatus（m=dlSearch）
 *  - html.includes('accessDenied')               → 抛 AuthRequiredError（会话过期，需重新登录）
 *
 * 与 demo 的唯一结构差异：demo 在 express session 上累积 zhjwxk Cookie；CampusSession
 * 只暴露只读 getter（不能回写、不动登录状态机），所以每次调用先用 demoCookies 重新过
 * xklogin.do 入口（302 链的 CAS 由 webvpn 服务端透明完成）建立 zhjwxk 会话，结果做
 * 60 秒热缓存（基准串变化 = 重新登录过 → 自动失效）。
 *
 * 响应编码：桌面端 Tauri 传输层（reqwest charset）已把 GBK 自动转码为 UTF-8；
 * 字节路径的解码语义见 crypto/decryptResponse.ts（demo 的 decryptResponse 移植）。
 */
import { AuthRequiredError, type HttpClient } from "../http.js";
import { parseCasFormHtml } from "../auth/cas.js";
import { decodeUrl, webvpnWrap } from "../crypto/webvpn.js";
import { ID_PREFIX } from "../auth/cas.js";
import { encryptPassword } from "../crypto/sm2.js";

const ZHJWXK = "http://zhjwxk.cic.tsinghua.edu.cn";

/** 调试钩子（桌面端接 /tmp/onethu-debug.log）：zhjwxk 页面抓取现场 */
let zhjwxkDebug: ((line: string) => void) | null = null;
export function setZhjwxkDebug(fn: (line: string) => void): void {
  zhjwxkDebug = fn;
}

/** 会话：HttpClient（共享 jar）+ 原始凭据（id-bounce 表单重登用） */
export interface ZhjwxkSession {
  readonly http: HttpClient;
  readonly username: string;
  readonly password: string;
  readonly fingerprint: string;
}

/** 已选课程（demo /api/courses 的 courses 项，字段一一对应） */
export interface SelectedCourse {
  typeLabel: string;
  code: string;
  name: string;
  teacher: string;
  time: string;
  credits: number;
}

/** 候补队列项（demo /api/queue 的 candidates 项，字段一一对应） */
export interface QueueCandidate {
  typeLabel: string;
  zyStr: string;
  code: string;
  name: string;
  seq: string;
  queueTotal: number;
  myPos: number;
  time: string;
  teacher: string;
}

/**
 * 当前学期字符串（p_xnxq 形如 2026-2027-1）。
 * 选课发生在学期开始前：8 月起即视为新学年秋季学期（demo 源码写死 '2026-2027-1'
 * 的日期语境），1 月仍属上一年秋季，2-7 月为春季。仅在 xklogin 页提不到 p_xnxq
 * 时作兜底，正常路径以页面提取值为准。
 */
export function semesterFromDate(now = new Date()): string {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  if (m >= 8) return `${y}-${y + 1}-1`;
  if (m === 1) return `${y - 1}-${y}-1`;
  return `${y - 1}-${y}-2`;
}

/* ── 建立会话 + 学期解析（demo establishZhjwxkSession）────────────── */

interface ZhjwxkEntry {
  semester: string | null;
  at: number;
}

/** entry 信任窗（2026-09 选课性能专项）：entry 对象不参与实际请求（数据直打 ZHJWXK+path），
 *  真会话在 HttpClient cookie jar——此 TTL 只是「jar 会话可信」的备忘时长。
 *  60s 时代：离开页面 1 分钟回来即白付整条 xklogin SSO 链（4-5 慢往返），是选课模块
 *  「每次回来都慢」的主凶。10min 窗 + proxyZhjwxkApi 死页自愈重试：jar 真死时在当次
 *  请求内静默重登+重试，用户无感。UI 全部显式传学期，entry.semester 过期无碍。 */
const ENTRY_TTL_MS = 10 * 60_000;
const entryCache = new WeakMap<ZhjwxkSession, ZhjwxkEntry>();
const entryInflight = new WeakMap<ZhjwxkSession, Promise<ZhjwxkEntry>>();

async function ensure(
  s: ZhjwxkSession,
  semesterOverride?: string,
): Promise<{ entry: ZhjwxkEntry; semester: string }> {
  const hit = entryCache.get(s);
  if (hit && Date.now() - hit.at < ENTRY_TTL_MS) {
    return { entry: hit, semester: semesterOverride ?? hit.semester ?? semesterFromDate() };
  }

  const inflight = entryInflight.get(s);
  if (inflight) {
    const entry = await inflight;
    return { entry, semester: semesterOverride ?? entry.semester ?? semesterFromDate() };
  }

  const run = (async (): Promise<ZhjwxkEntry> => {
  // demo establishZhjwxkSession：经 HttpClient 进入选课系统（自动 webvpn 包装 + 逐跳 id 桶）
  let html = await s.http.text(ZHJWXK + "/xklogin.do");

  // xklogin 的 SSO 不是普通 302：链会 302 到 id 电子身份的动态 auth-request 表单页
  //（JS 锚点跟跳），HTTP 客户端到不了 —— 参照 thu-info-lib roam("id")：解析该表单
  //（公钥+隐藏字段），SM2 加密账密 POST /check，成功后跟锚点回 xk 落地会话。
  if (html.includes("电子身份服务系统") || html.includes("do/off/ui/auth/login")) {
    const form = parseCasFormHtml(html, true);
    const enc = encryptPassword(s.password, form.publicKey);
    // bounce 表单页是 id 直连落地 → 直连字段集（id 校验读 i_pass，cas.ts 直连同款）
    const body = new URLSearchParams({
      ...form.hiddenFields,
      i_user: s.username,
      i_pass: enc,
      sm2pass: enc,
      singleLogin: "on",
      fingerPrint: s.fingerprint,
      fingerGenPrint: "",
      fingerGenPrint3: "",
      i_captcha: "",
    });
    const checkHtml = await s.http.text("https://id.tsinghua.edu.cn/do/off/ui/auth/login/check", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      direct: true,
    });
    if (!checkHtml.includes("登录成功")) {
      zhjwxkDebug?.(`[XK-BOUNCE] direct 未成功 页首=${checkHtml.slice(0, 300).replace(/\s+/g, " ")}`);
      throw new AuthRequiredError("选课系统身份确认失败，请重新登录后重试");
    }
    const anchor = /<a[^>]+href="([^"]+)"/i.exec(checkHtml)?.[1];
    if (anchor) {
      let target = anchor.startsWith("http") ? anchor : new URL(anchor, ID_PREFIX).toString();
      // id 锚点是 https://zhjwxk...（直连或 /https/ 包装），但 zhjwxk 是 http 应用
      //（引导页 __vpn_app_protocol_data="http"）：/https/ 包装会让 wengine 代理到
      // 443 → "访问内容不存在"（票据白烧、会话建不成）。按真实协议改写后兑付。
      if (target.startsWith("https://zhjwxk.cic.tsinghua.edu.cn")) {
        target = ZHJWXK + target.slice("https://zhjwxk.cic.tsinghua.edu.cn".length);
      } else {
        const dec = decodeUrl(target);
        if (dec?.startsWith("https://zhjwxk.cic.tsinghua.edu.cn")) {
          target = webvpnWrap(dec.replace("https://zhjwxk.cic.tsinghua.edu.cn", ZHJWXK));
        }
      }
      zhjwxkDebug?.(`[XK-ANCHOR] 兑付=${target.slice(0, 130)}`);
      const landed = await s.http.text(target).catch(() => "");
      zhjwxkDebug?.(`[XK-ANCHOR] 落地 len=${landed.length} 页首=${landed.slice(0, 200).replace(/\s+/g, " ")}`);
      // 关键：兑付后不得重打 xklogin.do——那是登录入口，重打会重开 auth 流程弹回
      // id 表单（10:22 实证：兑付已落地真页面，重打又弹回去）。会话已在 jar，直接用。
      html = landed || html;
    }
  }

  const semester = /p_xnxq=([\d-]+)/.exec(html)?.[1] ?? null;
  zhjwxkDebug?.(
    `[XK-ENTRY] len=${html.length} 有p_xnxq=${semester ? 1 : 0} 页首=${html.slice(0, 400).replace(/\s+/g, " ")}`,
  );
  const entry: ZhjwxkEntry = { semester, at: Date.now() };
  entryCache.set(s, entry);
  return entry;
  })();
  entryInflight.set(s, run);
  try {
    const entry = await run;
    return { entry, semester: semesterOverride ?? entry.semester ?? semesterFromDate() };
  } finally {
    entryInflight.delete(s);
  }
}

/* ── 通用代理（demo proxyZhjwxkApi）────────────────────────────── */

/** 会话死页判据（可静默重试的子集；needCaptcha 需人工处理，不在此列） */
function isXkDeadHtml(html: string): boolean {
  return html.includes("accessDenied") || html.includes("用户登陆超时或访问内容不存在。请重试");
}

async function proxyZhjwxkApi(s: ZhjwxkSession, entry: ZhjwxkEntry, zhjwxkPath: string): Promise<string> {
  const html = await s.http.text(ZHJWXK + zhjwxkPath);
  if (!isXkDeadHtml(html)) {
    entry.at = Date.now();
    return html;
  }
  // 乐观自愈（dormPage 同构）：jar 会话真死 → 静默重走登录链并重试一次，用户无感；
  // 重试仍死则原样返回，由 assertNotDenied 抛 AuthRequiredError 走既有 autoFullReload 链
  entryCache.delete(s);
  await ensure(s);
  const retried = await s.http.text(ZHJWXK + zhjwxkPath);
  entry.at = Date.now();
  return retried;
}

/** demo：html.includes('accessDenied') → session 过期 / 需要重新登录 */
function assertNotDenied(s: ZhjwxkSession, html: string): void {
  if (html.includes("accessDenied")) {
    entryCache.delete(s); // 作废过期会话，重试时从新 demoCookies 重建
    throw new AuthRequiredError("选课系统会话已过期，请退出后重新登录");
  }
}

/**
 * 低层页面抓取：确保 zhjwxk 会话后 GET 相对路径（lib crFetch 同位）。
 * 供 info 侧 CR 一级课表兜底（thu-info-community 0317434e：夏季学期课表
 * m=kbSearch）复用本模块的 xklogin SSO 链。lib crFetch 的三个判据照搬：
 * needCaptcha / 「用户登陆超时或访问内容不存在」/ accessDenied（会话过期）。
 * 超时错误页是教务通用错误页而非登录页——抛普通 Error，由调用方决定兜底语义。
 */
export async function fetchZhjwxkPage(s: ZhjwxkSession, path: string): Promise<string> {
  const { entry } = await ensure(s);
  const html = await proxyZhjwxkApi(s, entry, path);
  if (html.includes("needCaptcha")) {
    throw new Error("选课系统需要验证码（needCaptcha）");
  }
  if (html.includes("用户登陆超时或访问内容不存在。请重试")) {
    throw new Error("选课系统会话超时（用户登陆超时或访问内容不存在）");
  }
  assertNotDenied(s, html);
  return html;
}

/* ── 解析（demo 正则逐行照抄）────────────────────────────────── */

const ROW_RE = () => /<tr[^>]*class="trr2"[^>]*>([\s\S]*?)<\/tr>/g;

/** demo /api/courses 的 <tr class="trr2"> 行解析（server.js L290-302） */
export function parseSelectedCourses(html: string): SelectedCourse[] {
  const courses: SelectedCourse[] = [];
  const rowRe = ROW_RE();
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const tds = [...m[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((t) =>
      t[1]!.replace(/<[^>]*>/g, "").trim(),
    );
    if (tds.length >= 4) {
      const td = (i: number): string => tds[i] ?? "";
      courses.push({
        typeLabel: td(0),
        code: td(1) || td(2),
        name: td(3),
        teacher: td(7) || td(2),
        time: td(6) || td(3),
        credits: parseFloat(td(8) || td(4)) || 0,
      });
    }
  }
  return courses;
}

/** demo /api/queue 的 <tr class="trr2"> 行解析（server.js L315-327） */
export function parseQueueCandidates(html: string): QueueCandidate[] {
  const candidates: QueueCandidate[] = [];
  const rowRe = ROW_RE();
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const tds = [...m[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((t) =>
      t[1]!.replace(/<[^>]*>/g, "").trim(),
    );
    if (tds.length >= 7) {
      const td = (i: number): string => tds[i] ?? "";
      candidates.push({
        typeLabel: td(0),
        zyStr: td(1),
        code: td(2),
        name: td(3),
        seq: td(4),
        queueTotal: parseInt(td(5)) || 0,
        myPos: parseInt(td(6)) || 0,
        time: td(7) || "",
        teacher: td(8) || "",
      });
    }
  }
  return candidates;
}

/* ── 公开 API ─────────────────────────────────────────────────── */

/** 已选课程（demo GET /api/courses：m=yxSearchTab&p_xnxq=<学期>） */
export async function getSelectedCourses(
  s: ZhjwxkSession,
  opts: { semester?: string } = {},
): Promise<SelectedCourse[]> {
  const { entry, semester } = await ensure(s, opts.semester);
  const html = await proxyZhjwxkApi(s, entry, `/xkBks.vxkBksXkbBs.do?m=yxSearchTab&p_xnxq=${semester}`);
  assertNotDenied(s, html);
  return parseSelectedCourses(html);
}

/** 选课候补队列 / 余量状态（demo GET /api/queue：m=dlSearch&p_xnxq=<学期>） */
export async function getQueueStatus(
  s: ZhjwxkSession,
  opts: { semester?: string } = {},
): Promise<QueueCandidate[]> {
  const { entry, semester } = await ensure(s, opts.semester);
  const html = await proxyZhjwxkApi(s, entry, `/xkBks.vxkBksXkbBs.do?m=dlSearch&p_xnxq=${semester}`);
  assertNotDenied(s, html);
  return parseQueueCandidates(html);
}

/** 解析当前学期（demo 的 p_xnxq 逻辑：GET xklogin.do 后从页面提取） */
export async function resolveZhjwxkSemester(s: ZhjwxkSession): Promise<string> {
  const { semester } = await ensure(s);
  return semester;
}

/* ══ v1.4.9 管线移植（docs/nextthuxk-v149-课程加载管线规格.md）══ */

/** 课型：bx 必修 / xx 限选 / rx 任选 / ty 体育（flag 语义与 tokenPriFlag 一致） */
export type XkFlag = "bx" | "xx" | "rx" | "ty";

/** 全校课程目录行（kkxxSearch trr2，列位为隐性契约，照 v1.4.9 data.js:47-91） */
export interface XkCourse {
  department: string;
  code: string;
  seq: string;
  name: string;
  credits: number;
  teacher: string;
  teacherId: string;
  capacity: number;
  remaining: number;
  gradCapacity: number;
  gradRemaining: number;
  time: string;
  note: string;
  feature: string;
  grade: string;
  tongshiGroup: string;
  /** 课程属性（必修/限选/任选/体育），目录列本身为空，由培养方案按课号回填 */
  attr: string;
  /** 一级课表最小行标记：余量/时间等元数据尚未由全量目录补全（消费方按"未知≠已满"宽容处理） */
  partial?: boolean;
}

/** 志愿统计（tbzySearchBR/Ty 内嵌数组；vol 串形如 "(2)12,8,0"） */
export interface XkVolInfo {
  capacity: number;
  applied: number;
  volRequired: string;
  volElective: string;
  volOptional: string;
  volSports: string;
}

/** 课余量/排队（xkqkSearch+kylSearch gridData ∪ selectBksDlCount） */
export interface XkQueueInfo {
  qCapacity: number;
  qRemaining: number;
  qQueue: number;
}

/** 写操作结果（HTML 关键字判定 + 轮询确认） */
export interface XkWriteResult {
  ok: boolean;
  msg: string;
  /** 最终落点：selected=已选 / queue=候补 / none */
  where: "selected" | "queue" | "none";
}

/** 志愿名额上限（config.js:15-20）：bx/xx/rx 均 1→1,2→2,3→∞；体育 1→1,2→1,3→∞ */
export const ZY_LIMITS: Record<XkFlag | "all", Array<[number, number]>> = {
  bx: [[1, 1], [2, 2], [3, Number.POSITIVE_INFINITY]],
  xx: [[1, 1], [2, 2], [3, Number.POSITIVE_INFINITY]],
  rx: [[1, 1], [2, 2], [3, Number.POSITIVE_INFINITY]],
  ty: [[1, 1], [2, 1], [3, Number.POSITIVE_INFINITY]],
  all: [[1, 1], [2, 2], [3, Number.POSITIVE_INFINITY]],
};

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** "(2)12,8,0" → { prefix: 2, counts: [12,8,0] }（probability.js:28-38 同语义） */
export function parseVolStr(v: string): { prefix: number; counts: number[] } | null {
  const m = /\((\d+)\)(\d+(?:,\d+)*)/.exec(v.trim());
  if (!m) return null;
  return { prefix: parseInt(m[1]!), counts: m[2]!.split(",").map((x) => parseInt(x) || 0) };
}

const TOKEN_RE = () => /name="token"\s+value="([^"]+)"/;

function tdsOf(rowHtml: string): string[] {
  return [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((t) =>
    t[1]!.replace(/<[^>]*>/g, "").trim(),
  );
}

/** 目录行解析（v1.4.9 parseCatalog：列位 0 院系 / 1 课号 / 2 课序 / 3 课名 / 4 学分 /
 *  5 教师+p_jsh / 6 容量 / 7 余量 / 8-9 研 / 10 时间 / 11 说明 / 12 特色 / 13 年级 / 18 通识组） */
export function parseXkCatalogPage(html: string): XkCourse[] {
  const out: XkCourse[] = [];
  const rowRe = ROW_RE();
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const tds = tdsOf(m[1] ?? "");
    if (tds.length < 11) continue;
    const td = (i: number): string => (tds[i] ?? "").replace(/\s+/g, " ").trim();
    const code = td(1);
    const name = td(3);
    if (!/^\d+$/.test(code) || !name) continue;
    const href = /href="([^"]*showJsDetail[^"]*)"/.exec(m[1] ?? "")?.[1] ?? "";
    out.push({
      department: td(0),
      code,
      seq: td(2) || "0",
      name,
      credits: parseFloat(td(4)) || 0,
      teacher: td(5),
      teacherId: /p_jsh=([^&"]+)/.exec(href)?.[1] ?? "",
      capacity: parseInt(td(6)) || 0,
      remaining: parseInt(td(7)) || 0,
      gradCapacity: parseInt(td(8)) || 0,
      gradRemaining: parseInt(td(9)) || 0,
      time: td(10),
      note: td(11),
      feature: td(12),
      grade: td(13),
      tongshiGroup: tds.length > 18 ? td(18) : "",
      attr: "",
    });
  }
  return out;
}

/** 志愿统计（普通 tbzySearchBR）：9 元内嵌数组 */
export function parseXkVolPage(html: string): Record<string, XkVolInfo> {
  const map: Record<string, XkVolInfo> = {};
  const re = /\[\s*"(\d+)"\s*,\s*"([^"]*?)"\s*,\s*"[^"]*?"\s*,\s*"[^"]*?"\s*,\s*"(\d*)"\s*,\s*"(\d*)"\s*,\s*"(.*?)"\s*,\s*"(.*?)"\s*,\s*"(.*?)"\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    map[`${m[1]}_${m[2]}`] = {
      capacity: parseInt(m[3] ?? "") || 0,
      applied: parseInt(m[4] ?? "") || 0,
      volRequired: m[5] ?? "",
      volElective: m[6] ?? "",
      volOptional: m[7] ?? "",
      volSports: "",
    };
  }
  return map;
}

/** 志愿统计（体育 tbzySearchTy）：6 元内嵌数组 */
export function parseXkVolSportsPage(html: string): Record<string, Partial<XkVolInfo>> {
  const map: Record<string, Partial<XkVolInfo>> = {};
  const re = /\[\s*"(\d+)"\s*,\s*"([^"]*?)"\s*,\s*"[^"]*?"\s*,\s*"(\d*)"\s*,\s*"(\d*)"\s*,\s*"(.*?)"\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    map[`${m[1]}_${m[2]}`] = {
      capacity: parseInt(m[3] ?? "") || 0,
      applied: parseInt(m[4] ?? "") || 0,
      volSports: m[5] ?? "",
    };
  }
  return map;
}

/** 课余量 gridData 行（xkqkSearch / kylSearch 共用） */
export function parseXkQueueGrid(html: string): Record<string, XkQueueInfo> {
  const map: Record<string, XkQueueInfo> = {};
  const re = /\[\s*"(\d+)"\s*,\s*"([^"]*?)"\s*,\s*"[^"]*?"\s*,\s*"(\d*)"\s*,\s*"(\d*)"\s*,\s*"[^"]*?"\s*,\s*"[^"]*?"\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    map[`${m[1]}_${m[2]}`] = {
      qCapacity: parseInt(m[3] ?? "") || 0,
      qRemaining: parseInt(m[4] ?? "") || 0,
      qQueue: 0,
    };
  }
  return map;
}

/** 已选页内嵌 zyMap：["code,seq","zy","typeCode","是否"] → 志愿/课型 */
export function parseXkZyMap(html: string): Record<string, { zy: number; typeCode: string }> {
  const map: Record<string, { zy: number; typeCode: string }> = {};
  const re = /\[\s*"(\d+),(\d+)"\s*,\s*"([^"]*?)"\s*,\s*"([^"]*?)"\s*,\s*"[^"]*?"\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    map[`${m[1]}_${m[2]}`] = { zy: parseInt(m[3] ?? "") || 0, typeCode: m[4] ?? "" };
  }
  return map;
}

/** 一级课表 → code_seq → typeCode（v1.4.9 兜底 / 课型推断） */
export function parseXkLevelTypes(html: string): Record<string, string> {
  const map: Record<string, string> = {};
  const rowRe = ROW_RE();
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const cells = tdsOf(m[1] ?? "");
    for (let i = 0; i < cells.length - 1; i++) {
      if (/^\d{8}$/.test(cells[i] ?? "")) {
        const seq = cells[i + 1] || "0";
        let attr = cells[i + 2] || "";
        if (!/^(必修|限选|任选)$/.test(attr)) attr = "";
        map[`${cells[i]}_${seq}`] = attr === "必修" ? "006" : attr === "限选" ? "008" : attr === "任选" ? "007" : "ty";
        break;
      }
    }
  }
  return map;
}

/* ── POST 代理 + 分页管线 ─────────────────────────────────────── */

/** POST 表单（写操作 / kylSearch 翻页；cookie 语义与 GET 代理一致） */
async function postZhjwxkApi(
  s: ZhjwxkSession,
  entry: ZhjwxkEntry,
  path: string,
  form: Record<string, string>,
): Promise<string> {
  const html = await s.http.text(ZHJWXK + path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  entry.at = Date.now();
  return html;
}

const PAGE_THROTTLE_MS = 30;
const PAGE_POOL = 5;

/**
 * v1.4.9 pagedFetch 的忠实简化：波次并发 5、任意两请求发起间隔 ≥30ms、
 * 空波即停（主扫描任一页空/错即停的同语义收敛）、去重键由调用方给。
 * pageFrom=0 起；`withBase` 先发一次无 page 参数的入口页（server.ts 同款，dedupe 兜底）。
 */
async function pagedFetch<T>(
  s: ZhjwxkSession,
  entry: ZhjwxkEntry,
  opts: {
    buildPath: (page: number) => string;
    parse: (html: string) => Record<string, T>;
    maxPages: number;
    withBase?: boolean;
    method?: "GET" | "POST";
    form?: (page: number) => Record<string, string>;
  },
): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  const put = (batch: Record<string, T>): number => {
    for (const [k, v] of Object.entries(batch)) if (!out.has(k)) out.set(k, v);
    return Object.keys(batch).length;
  };
  const one = async (page: number): Promise<number> => {
    const html =
      opts.method === "POST"
        ? await postZhjwxkApi(s, entry, "/xkBks.vxkBksJxjhBs.do", opts.form!(page))
        : await proxyZhjwxkApi(s, entry, opts.buildPath(page));
    assertNotDenied(s, html);
    const n = put(opts.parse(html));
    if (n === 0) {
      zhjwxkDebug?.(
        `[XK-PAGE] page=${page} 解析 0 行 body(${html.length})=${html.slice(0, 1600).replace(/\s+/g, " ")}`,
      );
    }
    return n;
  };
  if (opts.withBase !== false) await one(-1);
  let emptyWaves = 0;
  for (let p = 0; p <= opts.maxPages; p += PAGE_POOL) {
    const wave: Array<Promise<number>> = [];
    for (let i = p; i < p + PAGE_POOL && i <= opts.maxPages; i++) {
      wave.push(
        (async () => {
          await sleep((i - p) * PAGE_THROTTLE_MS);
          return one(i);
        })(),
      );
    }
    const got = await Promise.all(wave.map((w) => w.catch(() => 0)));
    if (got.reduce((a, b) => a + b, 0) === 0) {
      // 0/1 基分页边界可能出现单空波（如 page=0 空而 page=1 起有效）：连续两空波才收
      if (++emptyWaves >= 2) break;
    } else {
      emptyWaves = 0;
    }
  }
  return out;
}

/** 全校课程目录（kkxxSearch 纯 GET，maxPages 320 ≈ v1.4.9 同款上限） */
export async function getXkCatalog(
  s: ZhjwxkSession,
  opts: { semester?: string } = {},
): Promise<XkCourse[]> {
  const { entry, semester } = await ensure(s, opts.semester);
  const map = await pagedFetch(s, entry, {
    buildPath: (p) =>
      p < 0
        ? `/xkBks.vxkBksJxjhBs.do?m=kkxxSearch&p_xnxq=${semester}&_t=${Date.now()}`
        : `/xkBks.vxkBksJxjhBs.do?m=kkxxSearch&p_xnxq=${semester}&page=${p}&_t=${Date.now()}`,
    parse: (html: string): Record<string, XkCourse> =>
      Object.fromEntries(parseXkCatalogPage(html).map((c) => [`${c.code}_${c.seq}`, c])),
    maxPages: 320,
  });
  return [...map.values()];
}

// 开课单位（院系）代码表：提取自选课系统 kkxxSearch 页 p_kkdwnm 下拉（存档 HTML，GBK 解码）
export const XK_DEPARTMENTS: Array<[string, string]> = [
  ["000", "建筑学院"],
  ["001", "城规系"],
  ["002", "建筑系"],
  ["003", "土木系"],
  ["004", "水利系"],
  ["005", "环境学院"],
  ["012", "机械系"],
  ["013", "精仪系"],
  ["014", "能动系"],
  ["015", "车辆学院"],
  ["016", "工业工程系"],
  ["022", "电机系"],
  ["023", "电子系"],
  ["024", "计算机系"],
  ["025", "自动化系"],
  ["026", "集成电路学院"],
  ["031", "航院"],
  ["032", "工物系"],
  ["034", "化工系"],
  ["035", "材料学院"],
  ["042", "数学系"],
  ["043", "物理系"],
  ["044", "化学系"],
  ["045", "生命学院"],
  ["046", "地学系"],
  ["047", "交叉信息院"],
  ["048", "高研院"],
  ["051", "经管学院"],
  ["059", "公管学院"],
  ["060", "金融学院"],
  ["063", "中文系"],
  ["064", "外文系"],
  ["066", "法学院"],
  ["067", "新闻学院"],
  ["068", "马克思主义学院"],
  ["069", "人文学院"],
  ["070", "社科学院"],
  ["072", "体育部"],
  ["075", "图书馆"],
  ["078", "艺教中心"],
  ["080", "美术学院"],
  ["088", "统计系"],
  ["091", "建管系"],
  ["092", "天文系"],
  ["093", "安全学院"],
  ["094", "人工智能学院"],
  ["095", "心理系"],
  ["096", "卫健学院"],
  ["097", "苏世民书院"],
  ["099", "建筑技术"],
  ["101", "核研院"],
  ["103", "教育学院"],
  ["151", "训练中心"],
  ["155", "电工电子中心"],
  ["207", "学生部"],
  ["209", "武装部"],
  ["254", "教务处"],
  ["255", "研究生院"],
  ["305", "校医院"],
  ["402", "药学院"],
  ["405", "临床医学院"],
  ["410", "软件学院"],
  ["412", "网络研究院"],
  ["413", "地区研究院"],
  ["415", "航发院"],
  ["420", "语言中心"],
  ["470", "新雅书院"],
  ["471", "致理书院"],
  ["472", "日新书院"],
  ["473", "未央书院"],
  ["475", "行健书院"],
  ["476", "求真书院"],
  ["477", "为先书院"],
  ["478", "秀钟书院"],
  ["479", "笃实书院"],
  ["482", "紫荆书院"],
  ["483", "自强书院"],
  ["484", "水木书院"],
  ["492", "数学教学中心"],
  ["500", "医学院"],
  ["501", "基础医学院"],
  ["502", "生医工程学院"],
  ["503", "医疗管理学院"],
  ["599", "国际研究生院"],
  ["601", "清华大学全球创新学院"],
];

// 课程特色代码表：同页 p_kctsm 下拉
export const XK_FEATURES: Array<[string, string]> = [
  ["05", "专题研讨课"],
  ["01", "全外文授课"],
  ["13", "公共英语"],
  ["02", "外文授课比例≥50%(双语课)"],
  ["03", "外文教材，中文为主进行授课(双语课)"],
  ["11", "实践课"],
  ["10", "实验课"],
  ["09", "挑战性学习课程"],
  ["06", "文化素质核心课"],
  ["07", "文化素质课"],
  ["04", "新生研讨课"],
  ["17", "新生研讨课(大类)"],
  ["12", "混合式教学"],
  ["08", "精品课"],
  ["16", "英语专业"],
  ["15", "认证外文课"],
  ["20", "语言类课程"],
  ["14", "通识英语"],
  ["19", "通识荣誉课"],
  ["18", "通识选修课"],
];

/**
 * 服务端课程搜索（套壳模式，2026-09 性能专项）：kkxxSearch 端点原生就是服务端搜索表单
 * （存档 HTML 选课开课信息查询.html frm：p_kch 课号 / p_kcm 课名 / p_zjjsxm 教师 /
 * p_kkdwnm 院系 / p_skxq 星期 / p_skjc 节次 / p_ssnj 年级 / p_bkskyl_ig=0 本科余量>0），
 * page 分页每页 20 行，trr2 行结构与批量抓取完全一致——parseXkCatalogPage 原样复用。
 * GET 查询串与表单 POST 同名等价；中文参数以 UTF-8 发送（页面为 GBK，若服务端不收则
 * 0 行返回，UI 据此提示改用课号/院系筛选）。
 * 替代挂载即抓 320 页目录 + 220 页志愿的批量管线：搜索/翻页 1 往返即时出结果。
 */
export async function searchXkCourses(
  s: ZhjwxkSession,
  opts: {
    semester?: string;
    page?: number;
    kch?: string;
    kcm?: string;
    teacher?: string;
    department?: string;
    weekday?: string;
    section?: string;
    grade?: string;
    /** 课程分类（p_kcflm：001 本科生 / 002 研究生 / 003 专科） */
    kcflm?: string;
    /** 任选课类目/通识课组（p_rxklxm：TS1 人文 TS2 社科 TS3 艺术 TS4 科学） */
    rxklxm?: string;
    /** 课程特色（p_kctsm，代码表 XK_FEATURES） */
    kctsm?: string;
    onlyAvailable?: boolean;
    /** 研究生课余量 > 0（p_yjskyl_ig=0） */
    gradAvail?: boolean;
  } = {},
): Promise<{ rows: XkCourse[]; page: number; hasMore: boolean }> {
  const { entry, semester } = await ensure(s, opts.semester);
  const q = new URLSearchParams();
  q.set("m", "kkxxSearch");
  q.set("p_xnxq", semester);
  const page = Math.max(1, opts.page ?? 1);
  if (page > 1) q.set("page", String(page));
  if (opts.kch?.trim()) q.set("p_kch", opts.kch.trim());
  if (opts.kcm?.trim()) q.set("p_kcm", opts.kcm.trim());
  if (opts.teacher?.trim()) q.set("p_zjjsxm", opts.teacher.trim());
  if (opts.department) q.set("p_kkdwnm", opts.department);
  if (opts.weekday) q.set("p_skxq", opts.weekday);
  if (opts.section) q.set("p_skjc", opts.section);
  if (opts.grade) q.set("p_ssnj", opts.grade);
  if (opts.kcflm) q.set("p_kcflm", opts.kcflm);
  if (opts.rxklxm) q.set("p_rxklxm", opts.rxklxm);
  if (opts.kctsm) q.set("p_kctsm", opts.kctsm);
  if (opts.onlyAvailable) q.set("p_bkskyl_ig", "0");
  if (opts.gradAvail) q.set("p_yjskyl_ig", "0");
  const html = await proxyZhjwxkApi(s, entry, `/xkBks.vxkBksJxjhBs.do?${q.toString()}&_t=${Date.now()}`);
  assertNotDenied(s, html);
  const rows = parseXkCatalogPage(html);
  return { rows, page, hasMore: rows.length >= 20 };
}

/** 志愿统计（tbzySearchBR ≤200 页 + tbzySearchTy ≤20 页，失败容忍） */
export async function getXkVolunteer(
  s: ZhjwxkSession,
  opts: { semester?: string } = {},
): Promise<Record<string, XkVolInfo>> {
  const { entry, semester } = await ensure(s, opts.semester);
  const br = await pagedFetch(s, entry, {
    buildPath: (p) =>
      p < 0
        ? `/xkBks.xkBksZytjb.do?m=tbzySearchBR&p_xnxq=${semester}`
        : `/xkBks.xkBksZytjb.do?m=tbzySearchBR&p_xnxq=${semester}&page=${p}`,
    parse: parseXkVolPage,
    maxPages: 200,
  });
  const merged: Record<string, XkVolInfo> = Object.fromEntries(br);
  try {
    const ty = await pagedFetch(s, entry, {
      buildPath: (p) =>
        p < 0
          ? `/xkBks.xkBksZytjb.do?m=tbzySearchTy&p_xnxq=${semester}`
          : `/xkBks.xkBksZytjb.do?m=tbzySearchTy&p_xnxq=${semester}&page=${p}`,
      parse: parseXkVolSportsPage,
      maxPages: 20,
    });
    for (const [k, v] of ty) {
      merged[k] = { capacity: 0, applied: 0, volRequired: "", volElective: "", volOptional: "", ...merged[k], ...v } as XkVolInfo;
    }
  } catch {
    /* 体育统计失败容忍（v1.4.9 同款） */
  }
  return merged;
}

/** 课余量+排队（xkqkSearch 判 phase → kylSearch POST 翻页 → selectBksDlCount 批 100/熔断 3） */
export async function getXkQueueData(
  s: ZhjwxkSession,
  opts: { semester?: string } = {},
): Promise<{ map: Record<string, XkQueueInfo>; phase: boolean }> {
  const { entry, semester } = await ensure(s, opts.semester);
  const first = await proxyZhjwxkApi(s, entry, `/xkBks.vxkBksXkbBs.do?m=xkqkSearch&p_xnxq=${semester}`);
  assertNotDenied(s, first);
  if (!first.includes("gridData")) return { map: {}, phase: false };
  const map: Record<string, XkQueueInfo> = parseXkQueueGrid(first);
  const token = TOKEN_RE().exec(first)?.[1] ?? "";
  if (token) {
    for (let p = 0; p <= 200; p++) {
      const html = await postZhjwxkApi(s, entry, "/xkBks.vxkBksJxjhBs.do", {
        m: "kylSearch",
        page: String(p),
        token,
        "p_sort.p1": "",
        "p_sort.p2": "",
        "p_sort.asc1": "",
        "p_sort.asc2": "",
        p_xnxq: semester,
        pathContent: "",
      });
      if (!html.includes("gridData")) break;
      const batch = parseXkQueueGrid(html);
      if (!Object.keys(batch).length) break;
      for (const [k, v] of Object.entries(batch)) if (!map[k]) map[k] = v;
    }
  }
  const parts = Object.keys(map).map((k) => `${semester}_${k.replace("_", "_")}`);
  let fails = 0;
  for (let i = 0; i < parts.length; i += 100) {
    try {
      const qHtml = await proxyZhjwxkApi(
        s,
        entry,
        `/xkBks.vxkBksXkbBs.do?m=selectBksDlCount&kc_message=${encodeURIComponent(parts.slice(i, i + 100).join(";"))}`,
      );
      const arr = JSON.parse(qHtml) as Array<{ kch: string; kxh: string; dlrs: string }>;
      if (Array.isArray(arr)) {
        for (const o of arr) {
          const k = `${o.kch}_${o.kxh}`;
          if (map[k]) map[k] = { ...map[k]!, qQueue: parseInt(o.dlrs) || 0 };
        }
        fails = 0;
      }
    } catch {
      if (++fails >= 3) break; // v1.3.13 熔断：连败 3 批停手
    }
  }
  return { map, phase: Object.keys(map).length > 0 };
}

/** 一级课表课型表（兜底/课型推断） */
export async function getXkLevelTypes(
  s: ZhjwxkSession,
  opts: { semester?: string } = {},
): Promise<Record<string, string>> {
  const { entry, semester } = await ensure(s, opts.semester);
  const html = await proxyZhjwxkApi(
    s,
    entry,
    `/xkBks.vxkBksXkbBs.do?p_xnxq=${semester}&pathContent=${encodeURIComponent("一级课表")}`,
  );
  assertNotDenied(s, html);
  return parseXkLevelTypes(html);
}

/* ── 写操作（v1.4.9 fetchFormSubmit/submitCourse/dropCourse/changeVolunteer）──── */

const SUBMIT_M: Record<XkFlag, { search: string; save: string; id: string; zy: string }> = {
  bx: { search: "bxSearch", save: "saveBxKc", id: "p_bxk_id", zy: "p_bxk_xkzy" },
  xx: { search: "xxSearch", save: "saveXxKc", id: "p_xxk_id", zy: "p_xxk_xkzy" },
  rx: { search: "rxSearch", save: "saveRxKc", id: "p_rx_id", zy: "p_rx_xkzy" },
  ty: { search: "tySearch", save: "saveTyKc", id: "p_rxTy_id", zy: "p_rxTy_xkzy" },
};

/** 已选列表页是否含某 code+seq（pollUntil 判定） */
function hasSelected(html: string, code: string, seq: string): boolean {
  const rowRe = ROW_RE();
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    if ((m[1] ?? "").includes(code)) return true;
    void seq;
  }
  return false;
}

/** 选课：GET 搜索页取一次性 token → POST save*Kc → 满员二次 POST saveBksKcDl（响应新 token）→ 轮询确认 */
export async function submitXkCourse(
  s: ZhjwxkSession,
  opts: { semester?: string; code: string; seq: string; zy: number; flag: XkFlag },
): Promise<XkWriteResult> {
  const { entry, semester } = await ensure(s, opts.semester);
  const M = SUBMIT_M[opts.flag];
  const extra = opts.flag === "rx" ? "&is_zyrxk=1" : "";
  const searchHtml = await proxyZhjwxkApi(
    s,
    entry,
    `/xkBks.vxkBksXkbBs.do?m=${M.search}&p_xnxq=${semester}&tokenPriFlag=${opts.flag}${extra}`,
  );
  assertNotDenied(s, searchHtml);
  const token = TOKEN_RE().exec(searchHtml)?.[1];
  if (!token) return { ok: false, msg: "无法获取 token（会话或页面结构异常）", where: "none" };
  const fields: Record<string, string> = {
    m: M.save,
    p_xnxq: semester,
    tokenPriFlag: opts.flag,
    page: "",
    token,
    [M.id]: `${semester};${opts.code};${opts.seq};`,
    [M.zy]: String(opts.zy),
  };
  if (opts.flag === "rx") {
    fields.is_zyrxk = "1";
    fields.p_rxklxm = "";
  }
  if (opts.flag === "ty") fields.rxTyType = "";

  const respond = (html: string): XkWriteResult | null => {
    if (html.includes("accessDenied")) return { ok: false, msg: "操作被拒绝（会话失效）", where: "none" };
    if (html.includes("加入队列成功")) return { ok: true, msg: "已加入候补队列", where: "queue" };
    if (html.includes("选课成功")) return { ok: true, msg: "选课成功", where: "selected" };
    return null;
  };

  let resp = await postZhjwxkApi(s, entry, "/xkBks.vxkBksXkbBs.do", fields);
  let result = respond(resp);
  if (!result && resp.includes("是否排队") && resp.includes("saveBksKcDl")) {
    await sleep(1500); // v1.4.9：满员确认前置 1.5s
    const newToken = TOKEN_RE().exec(resp)?.[1];
    const queueFields: Record<string, string> = { ...fields, m: "saveBksKcDl" };
    if (newToken) queueFields.token = newToken; // 一次性 token：必须换用响应页新值
    resp = await postZhjwxkApi(s, entry, "/xkBks.vxkBksXkbBs.do", queueFields);
    result = respond(resp);
  }
  if (result?.ok) return result;

  // 轮询确认（700ms × 3 查已选；再查候补）
  for (let i = 0; i < 3; i++) {
    await sleep(700);
    const yx = await proxyZhjwxkApi(s, entry, `/xkBks.vxkBksXkbBs.do?m=yxSearchTab&p_xnxq=${semester}&tokenPriFlag=yx&_t=${Date.now()}`);
    if (hasSelected(yx, opts.code, opts.seq)) return { ok: true, msg: "选课成功（已确认）", where: "selected" };
  }
  const dl = await proxyZhjwxkApi(s, entry, `/xkBks.vxkBksXkbBs.do?m=dlSearch&p_xnxq=${semester}`);
  if (dl.includes(opts.code)) return { ok: true, msg: "已加入候补队列（已确认）", where: "queue" };
  return result ?? { ok: false, msg: "选课未生效，请确认课程类型与志愿", where: "none" };
}

/** 退课：isQueue → dlDelete；否则 deleteYxk；轮询消失 ×3（500ms） */
export async function dropXkCourse(
  s: ZhjwxkSession,
  opts: { semester?: string; code: string; seq: string; isQueue: boolean },
): Promise<XkWriteResult> {
  const { entry, semester } = await ensure(s, opts.semester);
  const tokenPage = opts.isQueue
    ? await proxyZhjwxkApi(s, entry, `/xkBks.vxkBksXkbBs.do?m=dlSearchTab&p_xnxq=${semester}`)
    : await proxyZhjwxkApi(s, entry, `/xkBks.vxkBksXkbBs.do?m=yxSearchTab&p_xnxq=${semester}&tokenPriFlag=yx`);
  assertNotDenied(s, tokenPage);
  const token = TOKEN_RE().exec(tokenPage)?.[1];
  if (!token) return { ok: false, msg: "无法获取 token", where: "none" };
  const form: Record<string, string> = opts.isQueue
    ? { m: "dlDelete", p_xnxq: semester, page: "", token, p_del_id: `${semester};${opts.code};${opts.seq};` }
    : {
        m: "deleteYxk",
        p_xnxq: semester,
        page: "",
        token,
        tokenPriFlag: "yx",
        tk: "",
        jhzy_kch: "",
        jhzy_kxh: "",
        jhzy_zy: "",
        p_del_id: `${semester};${opts.code};${opts.seq};`,
      };
  const resp = await postZhjwxkApi(s, entry, "/xkBks.vxkBksXkbBs.do", form);
  if (resp.includes("accessDenied")) return { ok: false, msg: "操作被拒绝（会话失效）", where: "none" };
  for (let i = 0; i < 3; i++) {
    await sleep(500);
    const check = await proxyZhjwxkApi(
      s,
      entry,
      `/xkBks.vxkBksXkbBs.do?m=${opts.isQueue ? "dlSearch" : "yxSearchTab"}&p_xnxq=${semester}${opts.isQueue ? "" : "&tokenPriFlag=yx"}&_t=${Date.now()}`,
    );
    if (!check.includes(opts.code)) return { ok: true, msg: opts.isQueue ? "已退出候补队列" : "退选成功", where: "none" };
  }
  return { ok: true, msg: opts.isQueue ? "已提交退队（未即时确认）" : "已提交退选（未即时确认）", where: "none" };
}

/** 调整志愿（changeZY；提交后固定等 1s，无轮询——v1.4.9 同款） */
export async function changeXkVolunteer(
  s: ZhjwxkSession,
  opts: { semester?: string; code: string; seq: string; zy: number },
): Promise<XkWriteResult> {
  const { entry, semester } = await ensure(s, opts.semester);
  const tokenPage = await proxyZhjwxkApi(s, entry, `/xkBks.vxkBksXkbBs.do?m=yxSearchTab&p_xnxq=${semester}&tokenPriFlag=yx`);
  assertNotDenied(s, tokenPage);
  const token = TOKEN_RE().exec(tokenPage)?.[1];
  if (!token) return { ok: false, msg: "无法获取 token", where: "none" };
  const resp = await postZhjwxkApi(s, entry, "/xkBks.vxkBksXkbBs.do", {
    m: "changeZY",
    p_xnxq: semester,
    tokenPriFlag: "yx",
    page: "",
    token,
    tk: "",
    jhzy_kch: opts.code,
    jhzy_kxh: opts.seq,
    jhzy_zy: String(opts.zy),
  });
  if (resp.includes("accessDenied")) return { ok: false, msg: "操作被拒绝（会话失效）", where: "none" };
  await sleep(1000);
  return { ok: true, msg: `志愿已调整为第 ${opts.zy} 志愿`, where: "selected" };
}

/* ── 已选完整行（v1.4.9 fetchSelectedCourses：p_del_id + zyMap，退课/调志愿需要 seq）── */

export interface XkSelectedRow {
  code: string;
  seq: string;
  name: string;
  teacher: string;
  time: string;
  credits: number;
  typeLabel: string;
  zy: number;
  typeCode: string;
}

export function parseXkSelectedFull(html: string): XkSelectedRow[] {
  const zyMap: Record<string, { zy: number; typeCode: string; typeLabel: string }> = {};
  const zyRe = /\[\s*"(\d+),(\d+)"\s*,\s*"(\d+)"\s*,\s*"(\d+)"\s*,\s*"([^"]*)"\s*,\s*"[^"]*"\s*\]/g;
  let zm: RegExpExecArray | null;
  while ((zm = zyRe.exec(html)) !== null) {
    zyMap[`${zm[1]}_${zm[2]}`] = {
      zy: parseInt(zm[3] ?? "") || 0,
      typeCode: zm[4] ?? "",
      typeLabel: zm[5] === "是" ? "体育" : ({ "006": "必修", "008": "限选", "007": "任选" }[zm[4] ?? ""] ?? ""),
    };
  }
  const out: XkSelectedRow[] = [];
  const rowRe = ROW_RE();
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const row = m[1] ?? "";
    const val = /name="p_del_id"[^>]*value="([^"]*)"/.exec(row)?.[1] ?? "";
    const parts = val.split(";");
    const code = parts[1] ?? "";
    const seq = parts[2] ?? "";
    if (!code) continue;
    const tds = tdsOf(row);
    const cell = (i: number): string => (tds[i] ?? "").replace(/\s+/g, " ").trim();
    const info = zyMap[`${code}_${seq}`] ?? { zy: 0, typeCode: "", typeLabel: "" };
    const zyFromCell = /第([一二三])志愿/.exec(cell(2));
    const isSports = !cell(1) && zyFromCell;
    out.push({
      code,
      seq,
      name: cell(3) || cell(1),
      teacher: cell(7) || cell(2),
      time: cell(6) || cell(3),
      credits: parseFloat(cell(8) || cell(4)) || 0,
      typeLabel: isSports ? "体育" : cell(1) || info.typeLabel,
      zy: info.zy || (zyFromCell ? ({ 一: 1, 二: 2, 三: 3 }[zyFromCell[1] as "一" | "二" | "三"] ?? 0) : 0),
      typeCode: isSports ? "ty" : info.typeCode,
    });
  }
  return out;
}

/** 已选完整行（含 seq/zy/typeCode——退选、调志愿、名额校验都用它） */
export async function getXkSelectedFull(
  s: ZhjwxkSession,
  opts: { semester?: string } = {},
): Promise<XkSelectedRow[]> {
  const { entry, semester } = await ensure(s, opts.semester);
  const html = await proxyZhjwxkApi(
    s,
    entry,
    `/xkBks.vxkBksXkbBs.do?m=yxSearchTab&p_xnxq=${semester}&tokenPriFlag=yx&_t=${Date.now()}`,
  );
  assertNotDenied(s, html);
  return parseXkSelectedFull(html);
}

/* ── 课程简介（v1.4.9 fetchCourseDetail：js.vjsKcbBs.do?m=showToXs）── */

export interface XkCourseDetail {
  fields: Record<string, string>;
}

/** 课程简介：p_id = encodeURIComponent(teacherId + ';' + code)；GBK 表格标签值对 */
export async function getXkCourseDetail(
  s: ZhjwxkSession,
  opts: { teacherId: string; code: string },
): Promise<XkCourseDetail | null> {
  await ensure(s);
  const url = `/js.vjsKcbBs.do?m=showToXs&p_id=${encodeURIComponent(`${opts.teacherId};${opts.code}`)}`;
  const html = await s.http.text(ZHJWXK + url);
  if (!html.includes("table")) return null;
  const fields: Record<string, string> = {};
  const skip = new Set(["课程名", "课程号"]);
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const tds = [...m[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((t) =>
      t[1]!.replace(/<[^>]*>/g, "").replace(/：/g, "").trim(),
    );
    if (tds.length < 2) continue;
    const put = (l: string | undefined, v: string | undefined): void => {
      if (l && v && l.length < 20 && !/^\d+$/.test(l) && !skip.has(l)) fields[l] = v;
    };
    put(tds[0], tds[1]);
    if (tds.length >= 4) put(tds[2], tds[3]);
  }
  return Object.keys(fields).length ? { fields } : null;
}


/* ── 培养方案（v1.4.9 fetchTrainingPlan：jhBks.vjhBksPyfakcbBs.do）── */

export interface XkPlanItem {
  semester: string;
  code: string;
  name: string;
  attr: string;
  credits: number;
  group: string;
}

const stripTags = (s: string): string => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/** parsePlan 移植：table#kcTable 行 → {semester, code, name, attr, credits, group} */
export async function getXkPlan(s: ZhjwxkSession, opts: { semester: string }): Promise<XkPlanItem[]> {
  await ensure(s, opts.semester);
  const page = await s.http.text(`${ZHJWXK}/jhBks.vjhBksPyfakcbBs.do?m=showBksZxZdxjxjhXmxqkclist&p_xnxq=${encodeURIComponent(opts.semester)}`);
  // 照抄 querySelectorAll('table#kcTable tr')：只在 kcTable 内找行
  const seg = /<table[^>]*id="kcTable"[^>]*>([\s\S]*?)<\/table>/i.exec(page)?.[1] ?? page;
  const html = seg;
  const out: XkPlanItem[] = [];
  let sem = "", season = "";
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const cells = [...m[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((t) => stripTags(t[1]!));
    if (!cells.length) continue;
    for (const t of cells) {
      const sm = /(\d{4}-\d{4}学年)/.exec(t);
      if (sm) sem = sm[1]!;
      const sn = /^(秋|春|夏)$/.exec(t.trim());
      if (sn) season = sn[1]!;
    }
    const code = cells.find((c) => /^\d{8}$/.test(c));
    if (!code) continue;
    const name = cells.find((c) => c.length > 1 && !/^\d+$/.test(c) && !["必修", "限选", "任选", "秋", "春", "夏"].includes(c) && !c.includes("学年"));
    const attr = cells.find((c) => ["必修", "限选", "任选"].includes(c));
    const credit = cells.find((c) => /^\d{1,2}(\.\d)?$/.test(c) && c !== code);
    const group = cells.find((c) => c.length > 2 && !["必修", "限选", "任选"].includes(c) && !/^\d/.test(c) && !c.includes("学年") && c !== name);
    if (name) out.push({ semester: `${sem} ${season}`.trim(), code: code!, name: name!.replace(/\s+/g, ""), attr: attr ?? "", credits: parseFloat(credit ?? "") || 0, group: group ?? "" });
  }
  return out;
}

/* ── 一级课表兜底（v1.4.9 fetchLevelTable / fallbackSelectedFromLevelTable）── */

export interface XkLevelTableRow {
  typeCode: string;
  typeLabel: string;
  attr: string;
  /** 列表版式行邻位尽力提取的课名（8 位课号前一格；版式异常时为空） */
  name?: string;
  /** 邻位尽力提取的教师（课号后第 3 格；版式异常时为空） */
  teacher?: string;
  /** 邻位尽力提取的学分（课号后第 5 格；解析不出为 0） */
  credits?: number;
}

/**
 * 一级课表：code_seq → {typeCode,typeLabel,attr}；attr 非 必修/限选/任选 视为体育。
 * 列表版式行（实测列位）：[学号, 姓名, 课名, 课号, 课序, 属性, 教师, …, 学分, …]——
 * 以 8 位课号为锚点，在邻位尽力提取课名/教师/学分，供"一级课表先行"管线在
 * 全量目录到达前渲染最小行（代码+序号+课名+类型/属性）；版式异常时留空兜底。
 */
export async function getXkLevelTable(s: ZhjwxkSession, opts: { semester: string }): Promise<Record<string, XkLevelTableRow>> {
  await ensure(s, opts.semester);
  const html = await s.http.text(`${ZHJWXK}/xkBks.vxkBksXkbBs.do?p_xnxq=${encodeURIComponent(opts.semester)}&pathContent=${encodeURIComponent("一级课表")}`);
  const map: Record<string, XkLevelTableRow> = {};
  const rowRe = /<tr[^>]*class="trr2"[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const cells = [...m[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((t) => stripTags(t[1]!));
    let code = "", seq = "", attr = "", name = "", teacher = "", credits = 0;
    for (let i = 0; i < cells.length; i++) {
      if (/^\d{8}$/.test(cells[i]!) && !code) {
        code = cells[i]!;
        seq = cells[i + 1] || "0";
        attr = cells[i + 2] || "";
        if (!/^(必修|限选|任选)$/.test(attr)) attr = "";
        // 邻位提取（对空值/串位宽容：不合法即留空，最小行渲染对空 teacher/time 宽容）
        const prev = i > 0 ? cells[i - 1] ?? "" : "";
        if (prev && prev.length <= 30 && !/^\d+$/.test(prev) && !/^(必修|限选|任选|体育|是|否)$/.test(prev)) name = prev;
        const t = cells[i + 3] ?? "";
        if (t && t.length <= 20 && !/^\d+$/.test(t) && !/^(必修|限选|任选|体育)$/.test(t)) teacher = t;
        credits = parseFloat(cells[i + 5] ?? "") || 0;
      }
    }
    if (!code) continue;
    const isSports = !attr;
    const typeLabel = isSports ? "体育" : attr;
    const typeCode = isSports ? "ty" : attr === "必修" ? "006" : attr === "限选" ? "008" : "007";
    map[`${code}_${seq || "0"}`] = { typeCode, typeLabel, attr, name, teacher, credits };
  }
  return map;
}
