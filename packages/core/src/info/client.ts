/**
 * 信息门户 / 教务客户端。
 * 登录链路与 thu-info-lib 一致：CAS（可经 WebVPN 代理）→ ticket 漫游 info → 建立教务会话。
 * 校外使用：HttpClient.withWebVPN(true)（core 动态编码 URL，无需硬编码 hex 前缀）。
 *
 * 数据解析逐行对照 thu-info-lib（thu-app/packages/thu-info-lib/src/lib/）：
 * - getReport           ← basics.ts getReport（[cellspacing=1] 表，本科 td 索引 3/5/7/9/11）
 * - getNews             ← news.ts getNewsList（object.dataList 字段映射）
 * - searchNews          ← news.ts searchNewsList（POST getMobilePageList，ES 服务端检索）
 * - getNewsSourceList   ← news.ts getNewsSourceList（querySubscribeInformationUnitList）
 * - getNewsSubscriptionList/getNewsListBySubscription/addNewsSubscription/
 *   removeNewsSubscription ← news.ts 同名四方法（querySubscribeConditionNameList/XXFB
 *   权威条件列表；querySubscribeInfomationPageList{currentPage,dyid} 单一分页动态；
 *   addSubscribeCondition{dygz,mkid:"XXFB"}；deleteSubscribeCondition/{id}/XXFB——
 *   POST 均为 x-www-form-urlencoded，bt/url 做 HTML 实体 decode）
 * - getCardInfo         ← card.ts cardGetInfo（AES-ECB 响应解密 + 字段映射）
 * - getCardTransactions ← card.ts cardGetTransactions
 * - getExams            ← 课表 JSONP 分类 fl="考试"（与 parseJSON 同源数据；lib 无独立接口）
 * - getEleRemainder / getElePayRecord ← dorm.ts（家园网，dorm.ts roam("id") 0a993de7…/1：
 *   SSO 发票快路径，无票则 sm2 账密直登 id → 锚点票据经 oauth lbredirect 兑付）
 * - getLibraryList/FloorList/SectionList/SeatList ← library.ts（api.php 统一 {data:{list}}）
 * - bookLibrarySeat / getLibBookRecords / cancelLibBooking ← library.ts（roam("id")
 *   ef84f6d6…/0?/api/id_tsinghua_callback 同款两段建立会话；access_token =
 *   LIBRARY_HOME 页内首个 "access_token" 后第一个引号串，无 token 重走 roam 再取）
 * - getLibRoomInfoList/ResourceList/Records、bookLibRoom、cancelLibRoomBooking、
 *   fuzzySearchLibRoomMember、updateLibRoomEmail ← library.ts cabLogin/ic-web 链
 *   （cab.lib.tsinghua.edu.cn 研讨间，独立于座位系统的 cab 会话：auth/address →
 *   重定向链落 id CAS 表单取 payload → roam("id") 同款两段兑付 → userInfo 校验 pid/accNo；
 *   ic-web 统一 {code,data,message} 信封，code!==0 即失败）
 * - 座位分布图 URL ← libraryMap.tsx/librarySeat.tsx LIBRARY_IMAGE_BASE 拼法（urls.ts
 *   LIBRARY_AREA_IMAGE：area/<id>/floor.jpg 与 area/<id>/seat-free.jpg）
 */
import aesjs from "aes-js";
import { AuthRequiredError, HttpClient } from "../http.js";
import { ID_PREFIX, parseCasFormHtml } from "../auth/cas.js";
import { encryptPassword } from "../crypto/sm2.js";
import { webvpnWrap } from "../crypto/webvpn.js";
import * as urls from "./urls.js";
import * as evaluation from "./evaluation.js";
import * as classroom from "./classroom.js";
import * as fitness from "./fitness.js";
import * as finance from "./finance.js";
import * as hygiene from "./hygiene.js";
import * as neth from "./neth.js";
import * as schoolCalendar from "./calendar.js";
import { parseCRSchedule } from "./crSchedule.js";
import { fetchZhjwxkPage, type ZhjwxkSession } from "../zhjwxk/client.js";
import type {
  AssessmentForm,
  BasicUserInfo,
  BankPaymentByMonth,
  CardInfo,
  CardTransaction,
  Classroom,
  ClassroomStateResult,
  DeadlineItem,
  ElePayRecord,
  EleRemainder,
  ExamEntry,
  GraduateIncome,
  InvoicePage,
  LibBookRecord,
  LibFuzzySearchResult,
  LibRoomBookRecord,
  LibRoomInfo,
  LibRoomRes,
  Library,
  LibraryFloor,
  LibrarySeat,
  LibrarySeatAvailability,
  LibrarySection,
  NetworkAccountInfo,
  NetworkBalance,
  NetworkDevice,
  NewsDetail,
  NewsItem,
  NewsSource,
  ReportRow,
  SchoolCalendarData,
  ScheduleEntry,
  SportsResource,
  SportsResourcesInfo,
  SportsReservationRecord,
} from "./types.js";
import * as sports from "./sports.js";
import * as kj from "./kongjian.js";
import type { ValidReceiptTitle } from "./sports.js";

function stripJsonp(text: string): string {
  const s = text.indexOf("(");
  const e = text.lastIndexOf(")");
  return s >= 0 && e > s ? text.slice(s + 1, e) : text;
}

/** 服务端订阅条件（getNewsSubscriptionList：querySubscribeConditionNameList/XXFB →
 *  object.{id,fbdwmcList,lmmcList,pxz,titile,bt}；source/channel 取列表首项，可能均空）。
 *  本地结构化类型，不扩 core 导出面（index.ts 只转出 InfoClient 类）。 */
export interface NewsSubscription {
  id: string;
  /** 发布单位名（fbdwmcList[0]） */
  source?: string;
  /** 栏目名（lmmcList[0]） */
  channel?: string;
  /** 订阅关键词（bt） */
  keyword?: string;
  /** 条件标题（服务端字段 titile） */
  title: string;
  /** 排序（pxz） */
  order?: number;
}

function tagStrip(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, "\n");
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ldquo: "\u201c",
  rdquo: "\u201d",
};

/** he.decode 的最小子集（新闻标题等只需常见实体） */
function decodeEntities(s: string): string {
  return s.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (all, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const n = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : all;
    }
    if (body.startsWith("#")) {
      const n = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[body.toLowerCase()] ?? all;
  });
}

/** 单元格文本：去标签 + 实体解码 + 空白归一（cheerio .text() 的等价物） */
function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

/** zhjw 时间字段归一（"8：00" → "8:00"） */
function normTime(v: unknown): string | undefined {
  const s = String(v ?? "").replace(/：/g, ":").trim();
  return s || undefined;
}

/** jxmh_out.do 日期参数为 YYYYMMDD（无横线）；容忍调用方传 "2025-02-24" 等 */
function compactDate(d: string): string {
  return d.replace(/[^0-9]/g, "");
}

/**
 * ic-web 时间字段 → Date（library.ts `new Date(info.startTime)` 同语义加固）：
 * cab.lib resvInfo/resvRule 的时间在抓包里出现过两种形态——"2026-07-01 08:00:00"
 * 字符串与 epoch 毫秒/秒数字（后端不同版本不一致）。lib 直接透传 new Date(原值)
 * 对数字形态天然可用；此前 core 曾 String() 归一导致纯数字串 new Date 解析为
 * Invalid Date，上层 convertUsageToSegments 兜底后整条占用条退化为全绿（占用
 * 红段消失，即「占用条一会有一会没有」的直接根源之一）。此处统一：数字或纯
 * 数字串按 epoch（秒<1e12 / 毫秒）解析，其余按字符串原样解析。
 */
function wireDate(v: unknown): Date {
  if (typeof v === "number" && Number.isFinite(v)) {
    return new Date(v < 1e12 ? v * 1000 : v);
  }
  const s = String(v ?? "").trim();
  if (/^\d{10,13}$/.test(s)) {
    const n = Number(s);
    return new Date(n < 1e12 ? n * 1000 : n);
  }
  return new Date(s);
}

/** Base64 → 字节（aes-js v3 未带 b64 工具，自实现与 crypto-js Base64.parse 等价） */
function base64ToBytes(s: string): Uint8Array {
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let bits = 0;
  let acc = 0;
  const out: number[] = [];
  for (const ch of s.replace(/\s/g, "")) {
    if (ch === "=") break;
    const v = B64.indexOf(ch);
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/** 校园会话最近一次确认存活的时间戳（模块级：跨 InfoClient 实例重建共享）。
 *  实测 wengine/info/card 会话约 8 分钟过期——距上次确认超过 7 分钟的请求
 *  先静默重漫游一次再发（renewInfo/renewCard），避免「切走再回来报未登录」。 */
let lastCampusOkAt = 0;
const SESSION_REFRESH_MS = 7 * 60 * 1000;

/**
 * 上游服务不可用/瘫痪，或响应结构无法解析（区别于会话失效的 AuthRequiredError）：
 * 「无成绩/成绩未出/服务下线」类状态绝不能映射成需要重新登录。
 * 校园网（usereg）上游已瘫痪，其解析失败统一抛本错误。
 */
export class ServiceUnavailableError extends Error {
  constructor(message = "服务暂不可用") {
    super(message);
    this.name = "ServiceUnavailableError";
  }
}

/**
 * 登录态/会话失效判定（公开辅助，UI 静默自愈用）：AuthRequiredError 本体，
 * 或错误文案带未登录特征。失效文案均出自 core 各探针/解析层（含 e.name 兜底，
 * instanceof 跨模块实例失效时按名字识别）。误判代价仅多一次自愈尝试，漏判会闪红——特征从宽。
 */
export function isAuthError(e: unknown): boolean {
  if (e instanceof AuthRequiredError) return true;
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  // 注意：ServiceUnavailableError 绝不能算会话失效（铁律 b：服务瘫痪 ≠ 需要重新登录）
  return /AuthRequiredError|未登录|请先登录|请重新登录|重新登录|登录超时|登陆超时|登录已失效|登录态|会话已失效|会话失效|会话超时|会话过期|身份过期|认证失效|not[ -]?logged[ -]?in|unauthorized/i.test(
    msg,
  );
}

/** 新闻列表/搜索条目的详情链接归一：绝对地址原样，相对路径补 info 前缀 */
function newsUrl(raw: string): string | undefined {
  if (!raw) return undefined;
  return /^https?:/i.test(raw)
    ? raw
    : `${urls.INFO_PREFIX}${raw.startsWith("/") ? "" : "/"}${raw}`;
}

/** 家园网乐观会话新鲜窗：窗口内的业务响应成功即视为会话存活，ensure 零网络 */
const DORM_OK_TTL = 5 * 60 * 1000;

export class InfoClient {
  #http: HttpClient;
  #zhjwRoamed = false;
  /** 校园卡当前登录用户（card.ts accountBaseInfo.user） */
  #cardUser = "";
  /** 会话过期续期回调（CampusSession 注入：重跑 roam-id / card 登录） */
  #renewInfo: (() => Promise<boolean>) | null = null;
  #renewCard: (() => Promise<boolean>) | null = null;
  /** 续期去重：同域并发请求只触发一次漫游（roam 链并发跑会在字符串会话上互踩） */
  #infoRenewInflight: Promise<boolean> | null = null;
  #cardRenewInflight: Promise<boolean> | null = null;
  /** 客户端级诊断现场（lastDebug 类字段）：lib 解析/会话失败时写入响应快照，
   *  供 UI 与错误信息共同定位（http.lastDebug 只反映最后一次 wire 请求）。 */
  lastDebug = "";
  /** id-CAS 服务登录凭据提供者（CampusSession 注入）：dorm/library 按
   *  lib roam("id") 账密直登 id 用；无凭据（resume 路径）时回退 SSO 发票路径。 */
  #idCredentials: (() => { username: string; password: string; fingerprint: string } | null) | null =
    null;

  setIdCredentials(
    provider: () => { username: string; password: string; fingerprint: string } | null,
  ): void {
    this.#idCredentials = provider;
  }

  constructor(http: HttpClient) {
    this.#http = http;
  }

  setRenewers(hooks: { info?: () => Promise<boolean>; card?: () => Promise<boolean> }): void {
    this.#renewInfo = hooks.info ?? null;
    this.#renewCard = hooks.card ?? null;
  }

  /** forceEnsure 并发去重：同 scope 只跑一次重建（漫游链并发跑会在会话上互踩） */
  #ensureInflight = new Map<string, Promise<void>>();

  /** 会话建立单飞（并发去重）：多个加载同时走到 ensure 时共用一次漫游，
   *  根治"id 登录表单被抓 N 次/全套 CAS 链路并发重跑"的变慢。 */
  #ensureInflight2 = new Map<string, Promise<void>>();
  /** access_token 模块级缓存：页面重挂载（实例重建）后仍有效 */
  static libToken = "";
  static libTokenTs = 0;
  static libTokenInflight: Promise<string> | null = null;
  /** 研讨间（cab.lib）认证 TTL 缓存（#libraryAccessToken 同款模式）：10 分钟内
   *  重复访问图书馆页直接复用已建会话，跳过 #libRoomAlive 探针与整条 cab 漫游链
   *  （ic-web/auth/address → authcenter → lbredirect×2 的三次完整重跑即此根因）。
   *  会话真失效时 #cabFetch 抛 AuthRequiredError 前会清缓存，#withLibRoom 重试重建。 */
  static libRoomAuthUser = "";
  static libRoomAuthTs = 0;
  static libRoomInflight: Promise<void> | null = null;
  /** 热点读去重（并发共享 + 短 TTL 结果缓存） */
  #hotInflight = new Map<string, Promise<unknown>>();
  #hotCache = new Map<string, { ts: number; value: unknown }>();
  #hot<T>(key: string, ttlMs: number, run: () => Promise<T>): Promise<T> {
    const c = this.#hotCache.get(key);
    if (c && Date.now() - c.ts < ttlMs) return Promise.resolve(c.value as T);
    const inflight = this.#hotInflight.get(key);
    if (inflight) return inflight as Promise<T>;
    const p = run()
      .then((v) => {
        this.#hotCache.set(key, { ts: Date.now(), value: v });
        return v;
      })
      .finally(() => this.#hotInflight.delete(key));
    this.#hotInflight.set(key, p);
    return p;
  }
  #single(scope: string, run: () => Promise<void>): Promise<void> {
    const existing = this.#ensureInflight2.get(scope);
    if (existing) return existing;
    const p = run().finally(() => this.#ensureInflight2.delete(scope));
    this.#ensureInflight2.set(scope, p);
    return p;
  }

  /**
   * 会话强制重建（登录态丢失后的静默自愈入口）：清目标服务的漫游/缓存标记后重走
   * 对应 ensure（webvpn 兑付链），随后由调用方重载组件即可拿到数据。
   * 实证背景：内部服务会话过期而漫游标记仍为 true 时 #ensureXxx 短路返回，
   * renewInfo/renewCard 钩子只重建 info 门户/卡登录会话，够不着目标服务自身会话。
   * card 无漫游标记（探针制）：重走 #ensureCardSession（探测 → CARD_HOME SSO 引导
   * → renewCard）即强制语义；libroom 重置 accNo 缓存后重走 #ensureLibRoom。
   */
  async forceEnsure(scope: "library" | "dorm" | "card" | "libroom", userId?: string): Promise<void> {
    const key = scope === "libroom" ? `${scope}:${userId ?? ""}` : scope;
    const inflight = this.#ensureInflight.get(key);
    if (inflight) return inflight;
    const run = this.#forceEnsureRun(scope, userId).finally(() => {
      this.#ensureInflight.delete(key);
    });
    this.#ensureInflight.set(key, run);
    return run;
  }

  async #forceEnsureRun(
    scope: "library" | "dorm" | "card" | "libroom",
    userId?: string,
  ): Promise<void> {
    if (scope === "library") {
      await this.#ensureLibrary(true);
    } else if (scope === "dorm") {
      await this.#ensureDorm(true);
    } else if (scope === "card") {
      this.#cardUser = "";
      await this.#ensureCardSession();
    } else {
      if (!userId) throw new Error("研讨间会话重建需要学号");
      this.#libRoomAccNo = null;
      InfoClient.libRoomAuthUser = "";
      InfoClient.libRoomAuthTs = 0;
      await this.#ensureLibRoom(userId);
    }
  }

  /** 会话年龄检查：距上次确认存活超过 7 分钟先静默重漫游一次（8 分钟过期前拦截）。
   *  续期失败不阻塞——让真实请求去暴露问题，#withRenew 的失败重试仍有兜底；
   *  同域并发请求经 inflight 去重，只触发一次漫游。 */
  async #preRenew(kind: "info" | "card"): Promise<void> {
    if (Date.now() - lastCampusOkAt <= SESSION_REFRESH_MS) return;
    if (kind === "info") {
      if (!this.#renewInfo) return;
      const renew = this.#renewInfo;
      this.#infoRenewInflight ??= renew()
        .catch(() => false)
        .finally(() => {
          this.#infoRenewInflight = null;
        });
      if (await this.#infoRenewInflight) lastCampusOkAt = Date.now();
    } else {
      if (!this.#renewCard) return;
      const renew = this.#renewCard;
      this.#cardRenewInflight ??= renew()
        .catch(() => false)
        .finally(() => {
          this.#cardRenewInflight = null;
        });
      if (await this.#cardRenewInflight) lastCampusOkAt = Date.now();
    }
  }

  /** 会话失效时自动续期并重试一次（登录会话内密码在内存，重启后自然回退到登录页）。
   *  重试仅对 AuthRequiredError（明确的未登录特征，请求未达业务层）触发；
   *  请求入口先做会话年龄检查，成功后刷新存活时间戳。 */
  async #withRenew<T>(op: () => Promise<T>): Promise<T> {
    await this.#preRenew("info");
    try {
      const out = await op();
      lastCampusOkAt = Date.now();
      return out;
    } catch (e) {
      if (!(e instanceof AuthRequiredError) || !this.#renewInfo) throw e;
      if (!(await this.#renewInfo().catch(() => false))) throw e;
      const out = await op();
      lastCampusOkAt = Date.now();
      return out;
    }
  }

  /** 校园卡请求包装：入口年龄检查（renewCard）+ 未登录失败重漫游重试一次。
   *  card 相关调用均为幂等查询（POST 查询体，无写操作），重试安全。 */
  async #withCardSession<T>(op: () => Promise<T>): Promise<T> {
    await this.#preRenew("card");
    try {
      const out = await op();
      lastCampusOkAt = Date.now();
      return out;
    } catch (e) {
      if (!(e instanceof AuthRequiredError) || !this.#renewCard) throw e;
      if (!(await this.#renewCard().catch(() => false))) throw e;
      const out = await op();
      lastCampusOkAt = Date.now();
      return out;
    }
  }

  /** 用统一会话下发的 CAS ticket 漫游信息门户。 */
  async roam(ticket: string): Promise<void> {
    await this.#http.request(
      `${urls.INFO_PREFIX}/b/yyfw/vyyfwxx/info/portal_fg/common/onlineAppRedirect?ticket=${ticket}`,
      { redirect: "follow" },
    );
    const info = await this.getUserInfo().catch(() => null);
    if (!info) throw new AuthRequiredError("漫游后未能获取信息门户会话");
  }

  async resume(): Promise<boolean> {
    return (await this.getUserInfo().catch(() => null)) !== null;
  }

  /** wengine-vpn/cookie dance（thu-info-lib getCsrfToken + tauriHttp 特判的合成）：
   *  每次都打端点（per-host wengine ticket 需要常刷）；
   *  响应体即 info 域完整 cookie 串，全量并入 jar 的 webvpn 桶与 info 桶
   *  （info 已改直连，直连请求读 info 桶）。 */
  async #wengineCookieDance(): Promise<void> {
    const res = await this.#http.request(urls.GET_COOKIE_URL()).catch(() => null);
    if (!res) return;
    const bodyText = await res.text().catch(() => "");
    const targets = ["https://webvpn.tsinghua.edu.cn/", "https://info.tsinghua.edu.cn/"];
    for (const pair of bodyText.split(/;|\n/)) {
      const t = pair.trim();
      if (/^[A-Za-z0-9_.-]+=/.test(t)) {
        for (const d of targets) {
          try {
            this.#http.jar.setRaw(new URL(d), t + "; Path=/");
          } catch {
            /* 容忍个别坏值 */
          }
        }
      }
    }
  }

  /** 个人信息（demo basics.getUserInfo 金标准：yyfw 漫游 + 正则；grjbxx 仅兜底） */
  async getUserInfo(): Promise<BasicUserInfo> {
    return this.#withRenew(() => this.#getUserInfoInner());
  }

  /** 从 yyfw 漫游页抓邮箱前缀（Coremail roammails.jsp；宽松匹配引号/空格变体） */
  async #huntEmail(): Promise<string | null> {
    const { page } = await this.#roamInfoService(urls.YYFW_USERINFO_ROAM_ID);
    return this.#emailFromPage(page);
  }

  #emailFromPage(page: string): string | null {
    return (
      /'addr'\s*:\s*['"]([^'"]*?)@mails\.tsinghua\.edu\.cn['"]/.exec(page)?.[1] ??
      /"addr"\s*:\s*"([^"]*?)@mails\.tsinghua\.edu\.cn"/.exec(page)?.[1] ??
      /([\w.-]+)@mails\.tsinghua\.edu\.cn/.exec(page)?.[1] ??
      null
    );
  }

  async #getUserInfoInner(): Promise<BasicUserInfo> {
    // 首选：grjbxx?_csrf —— 06:32Z 实证返回 JSON
    // {"result":"success","object":{"ryh":学号,"xm":姓名,…}}（此前 403 只是缺 _csrf）
    const parseJson = (body: string): BasicUserInfo | null => {
      try {
        const j = JSON.parse(body) as { result?: string; object?: Record<string, unknown> };
        const o = j.object;
        if (!o || (j.result && j.result !== "success")) return null;
        const s = (k: string): string => String(o[k] ?? "").trim();
        const name = s("xm") || s("name");
        const studentId = s("ryh") || s("xh");
        if (!name || !studentId) return null;
        const rawGender = s("xb") || s("xbm");
        return {
          name,
          studentId,
          gender: rawGender === "1" ? "男" : rawGender === "2" ? "女" : rawGender || undefined,
          department: s("dwmc") || s("yxmc") || s("bm") || s("dwh") || undefined,
          major: s("zy") || s("zymc") || undefined,
        };
      } catch {
        return null;
      }
    };
    const parseHtml = (html: string): BasicUserInfo | null => {
      const text = tagStrip(html);
      const pick = (label: string): string | undefined => {
        const m = new RegExp(`${label}[\\s:：]*([^\\n]+)`).exec(text);
        return m?.[1]?.trim();
      };
      const studentId = pick("学号");
      const name = pick("姓名");
      if (!studentId || !name) return null;
      return {
        name,
        studentId,
        gender: pick("性别"),
        department: pick(/院系|院级/.source),
        major: pick("专业"),
      };
    };
    const tryBody = (body: string): BasicUserInfo | null => parseJson(body) ?? parseHtml(body);

    let diag = "";
    let grjbxxBody = "";
    try {
      const xsrf = await this.#csrfToken();
      grjbxxBody = await this.#http.text(`${urls.INFO_USER_DATA()}?_csrf=${encodeURIComponent(xsrf)}`);
      const info = tryBody(grjbxxBody);
      if (info) return info;
      diag = `grjbxx 无姓名/学号: ${grjbxxBody.slice(0, 100).replace(/\s+/g, " ")}`;
    } catch (err) {
      if (!(err instanceof AuthRequiredError)) throw err;
      diag = err.message;
    }
    // 兜底 1：yyfw 漫游（demo basics.getUserInfo；Coremail roammails.jsp 页正则）
    try {
      const { page, target, finalUrl } = await this.#roamInfoService(urls.YYFW_USERINFO_ROAM_ID);
      const name =
        /'name'\s*:\s*['"]([^'"]+)['"]/.exec(page)?.[1] ?? /"name"\s*:\s*"([^"]+)"/.exec(page)?.[1];
      const emailName = await this.#emailFromPage(page);
      if (name) {
        return {
          name,
          studentId: emailName ?? "",
          email: emailName ? `${emailName}@mails.tsinghua.edu.cn` : undefined,
        };
      }
      diag = `漫游页无 name/addr: target=${target.slice(0, 90)} 终=${finalUrl.slice(0, 90)} ` +
        `len=${page.length} 页首=${page.slice(0, 100).replace(/\s+/g, " ")}`;
    } catch (err) {
      if (!(err instanceof AuthRequiredError)) throw err;
      diag = err.message;
    }
    // 兜底 2：dance 刷新票据后再试一次 grjbxx
    await this.#wengineCookieDance();
    const again = await this.#http
      .text(`${urls.INFO_USER_DATA()}?_csrf=${encodeURIComponent(await this.#csrfToken())}`)
      .catch(() => "");
    const info2 = tryBody(again);
    if (info2) return info2;
    throw new AuthRequiredError(`未能获取个人信息（${diag}）`);
  }

  /** info 域 XSRF-TOKEN（无则 dance 刷新后重读；见 #csrfToken） */

  /**
   * info 门户业务漫游（thu-info-lib roam "default" 策略的通用化）：
   * 1. GET GET_COOKIE_URL()（webvpn 公共域自动直连）→ info 域 XSRF-TOKEN cookie 入 jar。
   * 2. GET ROAMING_URL()?yyfwid=<yyfwid>&_csrf=<encodeURIComponent(xsrf)>&machine=p
   *    → JSON { object: { roamingurl } }。
   * 3. GET roamingurl（&amp; 还原为 &，redirect follow）→ 目标业务会话建立。
   * 返回 { target: 漫游目标 URL, finalUrl: 跟跳终点, page: 正文 }（调用方自行校验）。
   * 教务（JXRL_ROAM_ID）只在客户端生命周期内漫游一次；个人信息/其他业务每次现取。
   */
  async #roamInfoService(yyfwid: string): Promise<{ page: string; target: string; finalUrl: string }> {
    // demo roam("default") 语义：getCsrfToken 先刷 per-host 票据，再取 XSRF-TOKEN
    await this.#wengineCookieDance();
    const xsrf = await this.#csrfToken();

    const roamText = await this.#http.text(
      `${urls.ROAMING_URL()}?yyfwid=${yyfwid}&_csrf=${encodeURIComponent(xsrf)}&machine=p`,
    );
    let roamingurl: string | undefined;
    try {
      roamingurl = (JSON.parse(roamText) as { object?: { roamingurl?: string } }).object?.roamingurl;
    } catch {
      roamingurl = undefined;
    }
    if (!roamingurl) {
      throw new AuthRequiredError(`漫游 ${yyfwid.slice(0, 8)}… 未返回 roamingurl（resp=${roamText.slice(0, 80)}）`);
    }

    // &amp; 还原为 &（thu-info-lib parseUrl 同款处理）；相对路径按 info 域补全
    const clean = roamingurl.replace(/&amp;/g, "&");
    const target = /^https?:/i.test(clean)
      ? clean
      : `${urls.INFO_PREFIX}${clean.startsWith("/") ? "" : "/"}${clean}`;
    // 落地必须走 text()：引导页 dance（method=get 领 cookie 并重放）只有 text() 会执行
    const page = await this.#http.text(target, { redirect: "follow" });
    return { page, target, finalUrl: this.#http.lastTarget || target };
  }

  async #ensureZhjw(): Promise<void> {
    if (this.#zhjwRoamed) return;
    const { page, target } = await this.#roamInfoService(urls.JXRL_ROAM_ID);
    // 真·引导页 = 会话未在 wengine 侧建立，绝不标记（注入了 __vpn_* 的被代理页面不算）
    if (this.#http.wengineInterstitial(page)) {
      throw new AuthRequiredError(
        `教务漫游落在引导页（target=${target.slice(0, 90)}；现场=${String(this.#http.lastDebug ?? "").slice(0, 160)}）`,
      );
    }
    // 漫游后必须核实会话真的建立（超时页/登录页=未建立），否则不标记、下次重试
    if (/jsp\.timeout|登录超时|电子身份服务系统|do\/off\/ui\/auth\/login/i.test(page)) {
      throw new AuthRequiredError("教务漫游未建立会话（跟随 roamingurl 后仍在超时/登录页）");
    }
    this.#zhjwRoamed = true;
  }

  /** 课表（先漫游教务，再取 JSONP；字段对照 thu-info-lib parseJSON：nq/nr/dd/fl/kssj/jssj） */
  async getSchedule(startDate: string, endDate: string): Promise<ScheduleEntry[]> {
    return this.#withRenew(async () => {
      await this.#ensureZhjw();
      const text = await this.#http.text(
        urls.ZHJW_SCHEDULE_JSONP(compactDate(startDate), compactDate(endDate)),
      );
      let list: unknown;
      try {
        list = JSON.parse(stripJsonp(text));
      } catch {
        throw new AuthRequiredError();
      }
      if (!Array.isArray(list)) return [];
      const entries = list.map((raw) => {
        const d = raw as Record<string, unknown>;
        const jc = String(d.JC ?? d.jc ?? "");
        const [startSection, endSection] = jc.split("-").map((n) => Number(n));
        const date = String(d.nq ?? d.NQ ?? d.PXRQ ?? "");
        let dayOfWeek = Number(d.XQ ?? d.xq ?? 0) || undefined;
        if (!dayOfWeek && date) {
          const t = new Date(date.replace(/-/g, "/")).getDay();
          dayOfWeek = t === 0 ? 7 : t;
        }
        return {
          courseName: String(d.nr ?? d.NR ?? d.KCM ?? d.kcm ?? ""),
          teacher: String(d.JSXM ?? d.jsxm ?? "") || undefined,
          date: date || undefined,
          dayOfWeek,
          startSection: startSection || undefined,
          endSection: endSection || startSection || undefined,
          location: String(d.dd ?? d.DD ?? d.JSMC ?? d.jsmc ?? "") || undefined,
          weekText: String(d.ZC ?? d.zc ?? "") || undefined,
          category: String(d.fl ?? d.FL ?? "") || undefined,
          startTime: normTime(d.kssj ?? d.KSSJ),
          endTime: normTime(d.jssj ?? d.JSSJ),
          raw: d,
        };
      });
      if (entries.length > 0) return entries;
      // 夏季学期兜底（thu-info-community 0317434e #910）：学期号以 -3 结尾时
      // bks_jxrl_all JSONP 恒为空，课程安排在 CR 选课系统一级课表（m=kbSearch）。
      // OneTHU getSchedule 以日期区间为参、无学期 id —— 按区间末端月份推导：
      // 6-8 月属 (y-1)-y-3 夏季学期；仅此窗口且 JSONP 为空才尝试 CR（查不到就是查不到）。
      return this.#crScheduleFallback(startDate, endDate);
    });
  }

  /** zhjwxk 会话（CR 一级课表兜底用）：HttpClient 共享 jar + 内存凭据；
   *  按用户名缓存实例（zhjwxk ensure 的 60s 热缓存按对象身份建 WeakMap 键） */
  #crSession: ZhjwxkSession | null = null;
  #crSessionUser = "";

  /** CR 一级课表兜底（lib getCRSchedule + parseCRSchedule 移植）：学期
   *  firstDay/weekCount 取校历中匹配的 -3 学期；CR 会话走 zhjwxk 模块同款
   *  xklogin SSO 链（fetchZhjwxkPage）。任何失败静默返回 []（兜底语义，
   *  绝不为空课表报错）。 */
  async #crScheduleFallback(startDate: string, endDate: string): Promise<ScheduleEntry[]> {
    try {
      const y = Number.parseInt(endDate.slice(0, 4), 10);
      const m = Number.parseInt(endDate.slice(5, 7), 10);
      if (!Number.isFinite(y) || !(m >= 6 && m <= 8)) return [];
      const semesterId = `${y - 1}-${y}-3`;
      const cal = await this.getSchoolCalendar();
      const sem = [cal, ...cal.nextSemesterList].find((s) => s.semesterId === semesterId);
      if (!sem) return [];
      const creds = this.#idCredentials?.();
      if (!creds?.username || !creds?.password) return [];
      if (!this.#crSession || this.#crSessionUser !== creds.username) {
        this.#crSession = {
          http: this.#http,
          username: creds.username,
          password: creds.password,
          fingerprint: creds.fingerprint,
        };
        this.#crSessionUser = creds.username;
      }
      // lib getCRSchedule 同款 URL（encodeURI 语义下 pathContent 为裸中文，fetch 等价归一）
      const html = await fetchZhjwxkPage(
        this.#crSession,
        `/xkBks.vxkBksXkbBs.do?m=kbSearch&p_xnxq=${semesterId}&pathContent=一级课表`,
      );
      return parseCRSchedule(html, sem.firstDay, sem.weekCount);
    } catch {
      return []; // 兜底语义：CR 不可用/未配置凭据时保持空课表，不报错
    }
  }

  /**
   * 成绩单（本科中文成绩）。
   * thu-info-lib getReport：`[cellspacing=1] tr` 逐行取 td 文本，索引
   * name=3 / credit=5 / grade=7 / point=9 / semester=11（研究生为 9/11/13 偏移）。
   */
  async getReport(): Promise<ReportRow[]> {
    return this.#withRenew(async () => {
      // demo getReport：先漫游成绩查询业务（B7EF0ADF… 本科），再取成绩页
      const roam = await this.#roamInfoService(urls.BKS_REPORT_ROAM_ID);
      if (this.#http.wengineInterstitial(roam.page)) {
        throw new AuthRequiredError(
          `成绩漫游落在引导页（target=${roam.target.slice(0, 90)}；现场=${String(this.#http.lastDebug ?? "").slice(0, 160)}）`,
        );
      }
      const html = await this.#http.text(urls.ZHJW_REPORT());
    if (/#sm2publicKey/i.test(html) || /name="i_pass"/.test(html)) throw new AuthRequiredError();
    // wengine 注入页含嵌套 table，按单表正则截取会在第一个 </table> 切坏结构
    // （08:13 实证：链条全通、页面就是成绩单，但解析为空）。改为全页扫行：
    // 成绩表每行 ≥12 个 td——与 demo cheerio "[cellspacing=1] tr" 同语义且嵌套安全。
    const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    const out: ReportRow[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const tds = [...(row[1] ?? "").matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cellText(m[1] ?? ""));
      // 两种行形态（08:13 实证）：
      // ① 学习记录表成绩行 = 6 列：课号/课名/学分/成绩/绩点/学期
      // ② demo 详细表 = ≥12 列（name 3 / credit 5 / grade 7 / point 9 / semester 11）
      // 页首学籍信息行（tds[3]=学号、tds[7]=入学时间）必须排除：学分列非数字。
      let name = "";
      let credit = NaN;
      let grade = "";
      let point = NaN;
      let semester = "";
      if (tds.length >= 6 && /^\d{5,10}$/.test(tds[0] ?? "") && /\d{4}[-–][春夏秋冬]/.test(tds[5] ?? "")) {
        name = tds[1] ?? "";
        credit = Number(tds[2]);
        grade = tds[3] ?? "";
        point = Number(tds[4]);
        semester = tds[5] ?? "";
      } else if (tds.length >= 12) {
        name = tds[3] ?? "";
        credit = Number(tds[5]);
        grade = tds[7] ?? "";
        point = Number(tds[9]);
        semester = tds[11] ?? "";
      }
      if (!name || !grade || !Number.isFinite(credit) || credit <= 0) continue;
      const key = `${name}|${semester}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, credit, grade, point, semester, raw: tds });
    }
    if (out.length === 0) {
      // thu-info-lib systemMessage：教务会话超时原文
      if (html.includes("用户登陆超时") || html.includes("time out")) {
        throw new AuthRequiredError("教务会话已超时，请重试");
      }
      // 空结果必须留现场（此前静默返回 []，无法区分引导页/结构变化）
      throw new Error(
        `成绩单解析为空（body首段: ${html.slice(0, 600).replace(/\s+/g, " ")} | 现场: ${String(this.#http.lastDebug ?? "").slice(0, 400)}）`,
      );
    }
      return out;
    });
  }

  /**
   * 教务学籍信息（本科成绩单页首嵌的学籍表：专业/院系/性别——grjbxx JSON 无这些字段，
   * 用户实证专业只有这里能给）。与 getReport 同页，label→value 逐行扫描。
   */
  async getZhjwXjxx(): Promise<Partial<BasicUserInfo>> {
    return this.#withRenew(async () => {
      await this.#ensureZhjw();
      const html = await this.#http.text(urls.ZHJW_REPORT());
      if (this.#http.wengineInterstitial(html)) throw new AuthRequiredError();
      const LABELS: Array<[RegExp, "major" | "department" | "gender"]> = [
        [/^专业/, "major"],
        [/^院系|^院级|^系$/, "department"],
        [/^性别/, "gender"],
      ];
      const out: Partial<BasicUserInfo> = {};
      for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const tds = [...(row[1] ?? "").matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cellText(m[1] ?? ""));
        for (let i = 0; i < tds.length - 1; i++) {
          const label = (tds[i] ?? "").replace(/[:：\s\u3000]/g, "");
          for (const [re, key] of LABELS) {
            const value = (tds[i + 1] ?? "").replace(/[:：]/g, "").trim();
            if (re.test(label) && value && value !== label && !out[key]) out[key] = value;
          }
        }
      }
      return out;
    });
  }

  /**
   * 首页「倒计时提醒」重要事项（thu-info-lib getCrTimetable 同源同链）：
   * GET INFO_DEADLINE（/b/info/gxfw_fg/common/deadline/list）?_csrf=… →
   * {object:[{djsbt: 标题, djskssj: 开始(epoch), djsjzsj: 截止(epoch), djsurl: 通知链接}]}。
   * epoch 毫秒/秒兼容（<1e12 视为秒）；begin/end 格式化为 "YYYY-MM-DD HH:mm"。
   * 旧版误按顶层数组 bt/gxsj 解析——保留为兜底分支（真实端点走 object 分支）。
   */
  async getDeadlines(): Promise<DeadlineItem[]> {
    return this.#withRenew(async () => {
      const csrf = await this.#csrfToken();
      const text = await this.#http.text(`${urls.INFO_DEADLINE()}?_csrf=${encodeURIComponent(csrf)}`);
      const epochToDate = (v: unknown): string | undefined => {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) return undefined;
        const ms = n < 1e12 ? n * 1000 : n;
        const d = new Date(ms);
        if (Number.isNaN(d.getTime())) return undefined;
        const p = (x: number) => String(x).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
      };
      const fromDjs = (d: Record<string, unknown>): DeadlineItem => ({
        title: String(d.djsbt ?? "").trim(),
        begin: epochToDate(d.djskssj),
        end: epochToDate(d.djsjzsj),
        url: String(d.djsurl ?? "").trim() || undefined,
        raw: d,
      });
      try {
        const json = JSON.parse(text) as unknown;
        // 真实端点：{object: [...]}（thu-info-lib uFetch→JSON.parse 同款）
        if (json && typeof json === "object" && Array.isArray((json as { object?: unknown }).object)) {
          return ((json as { object: Record<string, unknown>[] }).object ?? [])
            .map(fromDjs)
            .filter((d) => d.title);
        }
        // 兜底：顶层数组（兼容旧解析猜测的字段名）
        if (Array.isArray(json)) {
          return json
            .map((raw) => {
              const d = raw as Record<string, unknown>;
              const item = fromDjs(d);
              return item.title
                ? item
                : {
                    title: String(d.bt ?? d.title ?? ""),
                    begin: epochToDate(d.djskssj) ?? (String(d.gxsj ?? d.date ?? "") || undefined),
                    end: epochToDate(d.djsjzsj),
                    url: String(d.djsurl ?? "").trim() || undefined,
                    date: String(d.gxsj ?? d.date ?? "") || undefined,
                    raw: d,
                  };
            })
            .filter((d) => d.title);
        }
      } catch {
        /* HTML 时回退空（调用方整卡隐藏/空态） */
      }
      return [];
    });
  }

  /** 门户 XSRF-TOKEN（thu-info-lib getCsrfToken 读 cookie；jar 已有则免请求） */
  async #csrfToken(): Promise<string> {
    const read = (): string | undefined =>
      this.#http.jar
        .getCookies(new URL(`${urls.INFO_PREFIX}/`))
        .find((c) => c.name === "XSRF-TOKEN")?.value;
    let token = read();
    if (!token) {
      await this.#wengineCookieDance();
      token = read();
    }
    if (!token) throw new AuthRequiredError();
    return token;
  }

  /**
   * 校内新闻列表。
   * thu-info-lib getNewsList：`${NEWS_LIST_URL}&lmid=all&currentPage=${page}&length=${length}&_csrf=…`
   * → object.dataList：{ bt, url, xxid, time, dwmc_show, yxzd, lmid }。
   */
  async getNews(page = 1, length = 20): Promise<NewsItem[]> {
    return this.#withRenew(() => this.#getNewsInner(page, length));
  }

  /** 新闻详情（thu-info-lib news.ts handleNewApiNews：NEWS_DETAIL?xxid=…&_csrf= → object.xxDto） */
  async getNewsDetail(xxid: string): Promise<NewsDetail> {
    return this.#withRenew(async () => {
      const csrf = await this.#csrfToken();
      const text = await this.#http.text(
        `${urls.NEWS_DETAIL()}?xxid=${encodeURIComponent(xxid)}&preview=&_csrf=${encodeURIComponent(csrf)}`,
      );
      let dto: { bt?: string; nr?: string; fjs_template?: { wjid?: string; wjmc?: string }[] } | undefined;
      try {
        dto = (JSON.parse(text) as { object?: { xxDto?: typeof dto } }).object?.xxDto;
      } catch {
        dto = undefined;
      }
      if (!dto) {
        throw new Error(`新闻详情接口未返回正文（resp首段: ${text.slice(0, 80).replace(/\s+/g, " ")}）`);
      }
      const decodeEntities = (s: string): string =>
        s
          .replace(/&nbsp;/g, " ")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;|&apos;/g, "'")
          .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
          .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
          .replace(/&amp;/g, "&");
      // 接口可能双重转义（&lt;p&gt; 被再存成 &amp;lt;p&amp;gt;）：循环解码至稳定
      const decodeDeep = (s: string): string => {
        let cur = s;
        for (let i = 0; i < 3; i++) {
          const next = decodeEntities(cur);
          if (next === cur) break;
          cur = next;
        }
        return cur;
      };
      const title = decodeDeep(String(dto.bt ?? ""));
      const raw = decodeDeep(String(dto.nr ?? ""))
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "");
      // 相对路径补全为 info 绝对地址（站内渲染的图片内联需要绝对 URL）
      const html = raw.replace(
        /(src|href)="(\/[^"]+)"/g,
        (_m: string, attr: string, path: string) => `${attr}="${urls.INFO_PREFIX}${path}"`,
      );
      // 附件（thu-info-lib news.ts handleNewApiNews 同源：fjs_template 单项 {wjid,wjmc}
      // → FILE_DOWNLOAD_URL + wjid + ?_csrf=…，此处取其 info 直连版 /b/info/wj/download/{wjid}）。
      // 解析宽容：无 fjs_template 或单项缺 wjmc/wjid 时逐条丢弃，恒返回空数组不报错。
      const attachments = (dto.fjs_template ?? [])
        .map((f) => {
          const name = String(f.wjmc ?? "").trim();
          const wjid = String(f.wjid ?? "").trim();
          if (!name || !wjid) return null;
          return {
            name,
            url: `${urls.INFO_PREFIX}/b/info/wj/download/${encodeURIComponent(wjid)}?_csrf=${encodeURIComponent(csrf)}`,
          };
        })
        .filter((a): a is { name: string; url: string } => a !== null);
      const plain = raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      return { title, html, plain, attachments };
    });
  }

  /**
   * 新闻服务端搜索（thu-info-lib news.ts searchNewsList：POST
   * getMobilePageList?_csrf=…，表单 esParamClass=<ES 参数 JSON>）。
   * params 同时打标题 bt / 标签 tag / 分类 xxfl 三字段，orderMap 按时间倒序，
   * matchExact "是"/"否"；响应 object.resultsList 字段与列表接口一致
   * （yxzd 恒 null；ES 命中标记可能把 <em> 等标签混进标题——解析时剥掉）。
   */
  async searchNews(keyword: string, page = 1, exactMatch = false): Promise<NewsItem[]> {
    const key = keyword.trim();
    if (!key) return [];
    return this.#withRenew(async () => {
      const csrf = await this.#csrfToken();
      const esParam = {
        params: { bt: key, tag: key, xxfl: key },
        filterParams: {},
        orderMap: { sort: "time" },
        matchExact: exactMatch ? "是" : "否",
        currentPage: page,
      };
      const text = await this.#http.postForm(
        `${urls.NEWS_SEARCH()}?_csrf=${encodeURIComponent(csrf)}`,
        new URLSearchParams({ esParamClass: JSON.stringify(esParam) }),
      );
      let json: { object?: { resultsList?: Record<string, unknown>[] } };
      try {
        json = JSON.parse(text) as typeof json;
      } catch {
        throw new AuthRequiredError();
      }
      return (json.object?.resultsList ?? []).map((el) => ({
        name: decodeEntities(String(el.bt ?? "")).replace(/<[^>]+>/g, ""),
        xxid: String(el.xxid ?? ""),
        url: newsUrl(String(el.url ?? "")),
        date: String(el.time ?? "") || undefined,
        source: String(el.dwmc_show ?? "") || undefined,
        topped: false,
        channel: String(el.lmid ?? "") || undefined,
      }));
    });
  }

  /**
   * 新闻来源（发布单位）列表（thu-info-lib news.ts getNewsSourceList：
   * GET querySubscribeInformationUnitList?lmid=&_csrf=… → object.{id,text}[]）。
   * UI 订阅管理据此列出可订阅单位，其 id 供 addNewsSubscription 的 fbdwnm 使用；
   * 订阅条件以服务端 getNewsSubscriptionList 为权威，localStorage 仅 UI 偏好缓存。
   */
  async getNewsSourceList(): Promise<NewsSource[]> {
    return this.#withRenew(async () => {
      const csrf = await this.#csrfToken();
      const text = await this.#http.text(
        `${urls.NEWS_SOURCE_LIST()}?lmid=&_csrf=${encodeURIComponent(csrf)}`,
      );
      let json: { object?: { id?: unknown; text?: unknown }[] };
      try {
        json = JSON.parse(text) as typeof json;
      } catch {
        throw new AuthRequiredError();
      }
      return (json.object ?? [])
        .map((el) => ({ sourceId: String(el.id ?? ""), sourceName: String(el.text ?? "") }))
        .filter((s) => s.sourceId || s.sourceName);
    });
  }

  /**
   * 服务端订阅条件（权威列表；thu-info-lib news.ts getNewsSubscriptionList 逐字移植）：
   * GET querySubscribeConditionNameList/XXFB?_csrf= →
   * object.{id, fbdwmcList, lmmcList, pxz, titile, bt}[]。fbdwmcList/lmmcList 取首项为
   * 来源/栏目名，bt 为订阅关键词，titile 为条件标题（服务端字段名即此拼写），pxz 为排序。
   */
  async getNewsSubscriptionList(): Promise<NewsSubscription[]> {
    return this.#withRenew(async () => {
      const csrf = await this.#csrfToken();
      const text = await this.#http.text(
        `${urls.NEWS_SUBSCRIPTION_LIST()}?_csrf=${encodeURIComponent(csrf)}`,
      );
      let arr: Record<string, unknown>[];
      try {
        arr = (JSON.parse(text) as { object?: Record<string, unknown>[] }).object ?? [];
      } catch {
        throw new AuthRequiredError();
      }
      if (!Array.isArray(arr)) throw new AuthRequiredError();
      return arr.map((i) => ({
        id: String(i.id ?? ""),
        source: Array.isArray(i.fbdwmcList) && i.fbdwmcList.length > 0 ? String(i.fbdwmcList[0]) : undefined,
        channel: Array.isArray(i.lmmcList) && i.lmmcList.length > 0 ? String(i.lmmcList[0]) : undefined,
        keyword: String(i.bt ?? "") || undefined,
        title: String(i.titile ?? ""),
        order: Number(i.pxz ?? 0) || undefined,
      }));
    });
  }

  /**
   * 订阅动态单一分页列表（thu-info-lib news.ts getNewsListBySubscription 逐字移植；
   * thu-info-app news.tsx "catSubscribed" tab 的取数端点）：
   * POST querySubscribeInfomationPageList?_csrf=，body 为 x-www-form-urlencoded
   * {currentPage, dyid}（qs.stringify 同款：subscriptionId 省略时整个 dyid 键不出现
   * = 服务端按该账号全部订阅条件合并返回；传入时按单条条件过滤）。
   * 响应 object.resultList 字段与列表接口一致，bt/url 需 HTML 实体 decode（he.decode 同义）。
   */
  async getNewsListBySubscription(page = 1, subscriptionId?: string): Promise<NewsItem[]> {
    return this.#withRenew(async () => {
      const csrf = await this.#csrfToken();
      // URLSearchParams → fetch 自动 application/x-www-form-urlencoded（CONTENT_TYPE_FORM 同义）
      const form = new URLSearchParams({ currentPage: String(page) });
      if (subscriptionId) form.set("dyid", subscriptionId);
      const text = await this.#http.postForm(
        `${urls.NEWS_LIST_BY_SUBSCRIPTION()}?_csrf=${encodeURIComponent(csrf)}`,
        form,
      );
      let json: { object?: { resultList?: Record<string, unknown>[] } };
      try {
        json = JSON.parse(text) as typeof json;
      } catch {
        throw new AuthRequiredError();
      }
      return (json.object?.resultList ?? []).map((el) => ({
        name: decodeEntities(String(el.bt ?? "")),
        xxid: String(el.xxid ?? ""),
        url: newsUrl(decodeEntities(String(el.url ?? ""))),
        date: String(el.time ?? "") || undefined,
        source: String(el.dwmc_show ?? "") || undefined,
        topped: false,
        channel: String(el.lmid ?? "") || undefined,
      }));
    });
  }

  /**
   * 添加服务端订阅条件（thu-info-lib news.ts addNewsSubscription 逐字移植）：
   * POST addSubscribeCondition?_csrf=，form-encoded
   * {dygz: JSON.stringify({lmid?, fbdwnm?, bt}), mkid: "XXFB"}（JSON.stringify 自动丢
   * undefined 键，与 lib 一致），响应 {result:"success"} 才算成功。
   */
  async addNewsSubscription(opts: { channelId?: string; sourceId?: string; keyword?: string }): Promise<boolean> {
    if (!opts.channelId && !opts.sourceId) return false;
    return this.#withRenew(async () => {
      const csrf = await this.#csrfToken();
      const text = await this.#http.postForm(
        `${urls.NEWS_ADD_SUBSCRIPTION()}?_csrf=${encodeURIComponent(csrf)}`,
        new URLSearchParams({
          dygz: JSON.stringify({
            lmid: opts.channelId || undefined,
            fbdwnm: opts.sourceId || undefined,
            bt: opts.keyword ?? "",
          }),
          mkid: "XXFB",
        }),
      );
      try {
        return (JSON.parse(text) as { result?: string }).result === "success";
      } catch {
        throw new AuthRequiredError();
      }
    });
  }

  /**
   * 删除服务端订阅条件（thu-info-lib news.ts removeNewsSubscription 逐字移植）：
   * GET deleteSubscribeCondition/{id}/XXFB?_csrf= → {result:"success"}。
   */
  async removeNewsSubscription(subscriptionId: string): Promise<boolean> {
    return this.#withRenew(async () => {
      const csrf = await this.#csrfToken();
      const text = await this.#http.text(
        `${urls.NEWS_REMOVE_SUBSCRIPTION(subscriptionId)}?_csrf=${encodeURIComponent(csrf)}`,
      );
      try {
        return (JSON.parse(text) as { result?: string }).result === "success";
      } catch {
        throw new AuthRequiredError();
      }
    });
  }

  async #getNewsInner(page = 1, length = 20): Promise<NewsItem[]> {
    const csrf = await this.#csrfToken();
    const text = await this.#http.text(
      `${urls.INFO_NEWS_LIST()}&lmid=all&currentPage=${page}&length=${length}&_csrf=${csrf}`,
    );
    let json: { object?: { dataList?: Record<string, unknown>[] } };
    try {
      json = JSON.parse(text) as typeof json;
    } catch {
      throw new AuthRequiredError();
    }
    return (json.object?.dataList ?? []).map((el) => {
      return {
        name: decodeEntities(String(el.bt ?? "")),
        xxid: String(el.xxid ?? ""),
        url: newsUrl(String(el.url ?? "")),
        date: String(el.time ?? "") || undefined,
        source: String(el.dwmc_show ?? "") || undefined,
        topped: String(el.yxzd ?? "").includes("1-"),
        channel: String(el.lmid ?? "") || undefined,
      };
    });
  }

  /**
   * 考试安排：zhjw 课表 JSONP 中分类 fl="考试" 的条目。
   * （thu-info-lib 无独立考试接口；RN 端同样以课表分类呈现考试。）
   */
  async getExams(): Promise<ExamEntry[]> {
    return this.#withRenew(async () => {
      const now = new Date();
      const startYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
      const start = `${startYear}0901`;
      const end = `${startYear + 1}0731`;
      await this.#ensureZhjw();
      const text = await this.#http.text(
        urls.ZHJW_SCHEDULE_JSONP(compactDate(start), compactDate(end)),
      );
      let list: unknown;
      try {
        list = JSON.parse(stripJsonp(text));
      } catch {
        throw new AuthRequiredError();
      }
      if (!Array.isArray(list)) return [];
      const out: ExamEntry[] = [];
      for (const item of list as Record<string, unknown>[]) {
        if (String(item.fl ?? item.FL ?? "") !== "考试") continue;
        const date = String(item.nq ?? item.NQ ?? "");
        if (!date) continue;
        out.push({
          courseName: String(item.nr ?? item.NR ?? ""),
          date,
          startTime: normTime(item.kssj ?? item.KSSJ),
          endTime: normTime(item.jssj ?? item.JSSJ),
          location: String(item.dd ?? item.DD ?? "") || undefined,
          category: "考试",
          raw: item,
        });
      }
      return out.sort((a, b) =>
        `${a.date}${a.startTime ?? ""}`.localeCompare(`${b.date}${b.startTime ?? ""}`),
      );
    });
  }

  /* ------------------------- 校园卡（card.ts 移植） ------------------------- */

  /**
   * card.ts fetchWithParse：POST JSON；`{success:true}` 直取 resultData，
   * 否则 data = 16 字符密钥 + Base64(AES-128-ECB 密文)，解密后 `{success, resultData|message}`。
   */
  async #cardFetch<T = Record<string, unknown>>(
    url: string,
    payload: Record<string, unknown> = {},
  ): Promise<T> {
    const res = await this.#http.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let json: { success?: boolean; data?: string; resultData?: T; message?: string };
    try {
      json = JSON.parse(text) as typeof json;
    } catch {
      throw new AuthRequiredError("校园卡服务响应异常");
    }
    if (json.success) return (json.resultData ?? {}) as T;
    if (typeof json.data === "string" && json.data.length > 16) {
      let inner: { success?: boolean; resultData?: T; message?: string };
      try {
        inner = JSON.parse(this.#aesEcbDecrypt(json.data)) as typeof inner;
      } catch {
        throw new Error("校园卡响应解密失败");
      }
      if (inner.success !== true) throw new Error(inner.message ?? "校园卡服务返回错误");
      return (inner.resultData ?? {}) as T;
    }
    throw new Error(json.message ?? "校园卡服务返回错误");
  }

  #aesEcbDecrypt(data: string): string {
    const key = aesjs.utils.utf8.toBytes(data.slice(0, 16));
    const cipher = base64ToBytes(data.slice(16));
    const decrypted = new aesjs.ModeOfOperation.ecb(key).decrypt(cipher);
    return aesjs.utils.utf8.fromBytes(aesjs.padding.pkcs7.strip(decrypted));
  }

  /**
   * card.ts assureLoginValid/cardLogin 的会话版。
   * thu-info-lib 的 cardLogin 是带密码的独立 CAS 重登录；OneTHU 会话层不落密码，
   * 这里先探测现有会话（getUserInfoFromToken），失效则经 WebVPN 代理链访问一次
   * card 首页引导 SSO 后重试，仍失败则如实抛错（UI 提供重试）。
   */
  async #ensureCardSession(): Promise<string> {
    const probe = async (): Promise<string | null> => {
      try {
        const info = await this.#cardFetch<{ loginuser?: string }>(urls.CARD_USER_BY_TOKEN());
        return info.loginuser ?? null;
      } catch {
        return null;
      }
    };
    let user = await probe();
    if (!user) {
      try {
        await this.#http.request(urls.CARD_HOME(), { redirect: "follow" });
      } catch {
        /* 引导失败由下方统一报错 */
      }
      user = await probe();
    }
    if (!user && this.#renewCard) {
      // demo cardLogin 等价：card service CAS 登录 → 锚点直连兑付
      if (await this.#renewCard().catch(() => false)) {
        user = await probe();
      }
    }
    if (!user) {
      throw new AuthRequiredError("校园卡会话未能建立：请先在 WebVPN 门户打开一次校园卡，再回到此处重试");
    }
    this.#cardUser = user;
    lastCampusOkAt = Date.now();
    return user;
  }

  /** 余额与卡状态（card.ts cardGetInfo 字段映射，金额分 → 元） */
  async getCardInfo(): Promise<CardInfo> {
    return this.#withCardSession(async () => {
      const user = await this.#ensureCardSession();
      const raw = await this.#cardFetch<{
        idserial?: string;
        username?: string;
        departname?: string;
        baseAccount?: { balance?: number };
        cardInfos?: Array<{
          cardid?: string;
          accstatus?: string;
          lasttxdate?: string;
          maxconstolamt?: number;
          maxconsamt?: number;
        }>;
      }>(urls.CARD_INFO_BY_USER(), { idserial: user });
      const card = raw.cardInfos?.[0] ?? {};
      const lastTx = card.lasttxdate ? new Date(card.lasttxdate) : undefined;
      return {
        userId: raw.idserial ?? user,
        userName: raw.username ?? "",
        departmentName: raw.departname || undefined,
        balance: (raw.baseAccount?.balance ?? 0) / 100,
        cardId: card.cardid ?? "",
        cardStatus: card.accstatus || undefined,
        lastTransactionTimestamp: lastTx && !Number.isNaN(lastTx.getTime()) ? lastTx : undefined,
        maxDailyTransactionAmount:
          card.maxconstolamt !== undefined ? card.maxconstolamt / 100 : undefined,
        maxOneTimeTransactionAmount: card.maxconsamt !== undefined ? card.maxconsamt / 100 : undefined,
      };
    });
  }

  /** 消费/流水记录（card.ts cardGetTransactions 字段映射；日期 YYYY-MM-DD） */
  async getCardTransactions(start: string, end: string): Promise<CardTransaction[]> {
    return this.#withCardSession(async () => {
      const user = await this.#ensureCardSession();
      const raw = await this.#cardFetch<{
        rows?: Array<{
          id?: string;
          summary?: string;
          txdate?: string;
          balance?: number;
          txamt?: number;
          meraddr?: string;
          mername?: string;
          txname?: string;
        }>;
      }>(urls.CARD_TRANSACTIONS(), {
        idserial: user,
        starttime: start,
        endtime: end,
        // demo CardTransactionType.Any = -1（空串会被服务端拒：「tradetype参数为空」）
        tradetype: -1,
        pageSize: 10000,
        pageNumber: 0,
      });
      return (raw.rows ?? []).map((r) => ({
        id: String(r.id ?? ""),
        summary: String(r.summary ?? ""),
        timestamp: new Date(r.txdate ?? ""),
        balance: (r.balance ?? 0) / 100,
        amount: (r.txamt ?? 0) / 100,
        address: r.meraddr || undefined,
        name: r.mername || undefined,
        txName: r.txname || undefined,
      }));
    });
  }

  /**
   * 扫码充值下单（card.ts cardRechargeFromWechatAlipay 会话版，参数逐条同 lib）——
   * 只创建订单并返回官方收款链接，支付动作完全发生在支付宝/微信侧，本应用不经手资金。
   * 支付宝返回 qr.alipay.com/…（桌面渲染二维码供手机扫；移动端可拼
   * alipayqr://platformapi/startapp?saId=10000007&qrcode=<enc> 直跳支付宝 App）；
   * 微信返回微信收银台链接（thu-info-app 2025-09 从 UI 移除微信入口但链路仍在，
   * 桌面扫码方案不受影响）。
   * 安全约定：下单不自动重试；响应（学号/收款链接）不写入任何调试日志。
   */
  async cardRechargeQrcode(amountYuan: number, channel: "alipay" | "wechat"): Promise<string> {
    return this.#withCardSession(async () => {
      const user = await this.#ensureCardSession();
      const payload =
        channel === "alipay"
          ? {
              idserial: user,
              transamt: amountYuan,
              paytype: 3,
              txcode: "2493",
              productdesc: "综合服务支付宝扫码充值",
              method: "trade.pay.qrcode",
              tradetype: "alipay.qrcode",
            }
          : {
              idserial: user,
              transamt: amountYuan,
              txamt: amountYuan,
              openid: "",
              orgid: 2,
              paytype: 2,
              txcode: "1824",
              productdesc: "综合服务微信扫码充值",
              method: "trade.pay.qrcode",
              tradetype: "weixin.qrcode",
            };
      const res = await this.#cardFetch<{ success?: boolean; message?: string; response?: string }>(
        urls.CARD_RECHARGE_QRCODE(),
        payload,
      );
      if (res.success !== true) throw new Error(res.message ?? "充值下单失败");
      let webUrl = "";
      try {
        webUrl = String(
          (JSON.parse(res.response ?? "{}") as { bizContent?: { webUrl?: string } }).bizContent?.webUrl ?? "",
        );
      } catch {
        /* 保持空串走下方统一报错 */
      }
      if (!webUrl) throw new Error("服务端未返回收款链接");
      return webUrl;
    });
  }

  /** 银行卡圈存（card.ts cardRechargeFromBank 会话版；txamt 单位为分）。
   *  returncode=ERROR 时 lib 提示：请用其他支付方式，或 6:00~20:40 再试。 */
  async cardRechargeFromBank(amountYuan: number): Promise<void> {
    await this.#withCardSession(async () => {
      const user = await this.#ensureCardSession();
      const res = await this.#cardFetch<{ returncode?: string }>(urls.CARD_RECHARGE_BANK(), {
        idserial: user,
        txamt: Math.round(amountYuan * 100),
      });
      if (res.returncode === "ERROR") {
        throw new Error("圈存失败：请确认已在卡系统绑定银行卡，并于 6:00~20:40 重试，或改用扫码充值");
      }
    });
  }

  /* --------------------- 宿舍 / 家园网（dorm.ts 移植） --------------------- */

  #dormRoamed = false;
  /** 最近一次业务响应验证通过的时刻（家园网乐观会话新鲜度依据） */
  #dormLastOkAt = 0;

  /**
   * 家园网/座位系统请求模式：恒走 WebVPN 包装（与 thu-info-lib 完全一致——lib 的
   * ELE_REMAINDER_URL / LIBRARY_HOME_URL 等常量本就是包装形态）。
   * 根因 2026-08-29 实证：票据经 oauth lbredirect → 307 → webvpn URL 兑付，会话建立
   * 在 wengine 服务端（不在客户端 jar）；此前直连模式 (#campusInit direct) 拿客户端
   * 空 jar 打 myhome/seat，必然是未登录页。包装请求携带 webvpn 门户会话（demoLogin
   * 两种传输模式都建立），wengine 服务端自动带上内部应用会话。
   */
  #campusInit(): { direct?: boolean } {
    return {};
  }

  /** 家园网会话探针：电费页出现 net_Default_LoginCtrl1_txtUserName = 会话未建立（dorm.ts 同判据） */
  async #dormAlive(): Promise<boolean> {
    const html = await this.#http.text(urls.ELE_REMAINDER(), this.#campusInit()).catch(() => "");
    return html.length > 0 && !/net_Default_LoginCtrl1_txtUserName/i.test(html);
  }

  /** 家园网页面级乐观会话（thu-info-lib roamingWrapper 同构，2026-09 性能专项）：
   *  - 会话新鲜（5min 内有成功业务响应）→ 直接发业务请求，0 探针往返
   *  - 否则仍先试业务请求：落在登录页才 ensureDorm（漫游+验证）+ 重试一次
   *  - 成功响应刷新 #dormLastOkAt，后续调用享受新鲜快路径
   *  对比旧探针版（#dormAlive 先行）：每次 ensure 前省一整个整页往返——
   *  myhome 80 端口 + WebVPN 包装三重慢，探针往返正是电费/公共空间慢的主因。 */
  async #dormPage(
    fetcher: () => Promise<string>,
    isLogin: (page: string) => boolean,
    what: string,
  ): Promise<string> {
    const attempt = async (): Promise<string> => {
      const page = await fetcher().catch(() => "");
      return page && !isLogin(page) ? page : "";
    };
    if (!(this.#dormRoamed && Date.now() - this.#dormLastOkAt < DORM_OK_TTL)) {
      const page = await attempt();
      if (page) {
        this.#dormLastOkAt = Date.now();
        return page;
      }
      await this.#ensureDorm();
    }
    const page = await attempt();
    if (!page) {
      throw new AuthRequiredError(`${what}：家园网会话未能建立`);
    }
    this.#dormLastOkAt = Date.now();
    return page;
  }

  /** 任意校内 URL → oauth lbredirect（dorm.ts roam policy "id" 里 getWebVPNUrl 的同款包装；
   *  oauth 公网可达，负责跨域把 CAS 票据兑付到目标服务）。
   *  ⚠ uri 段绝不能 encodeURIComponent：oauth lb-auth 不做参数解码、把 uri 原样拼进
   *  307 Location 的 webvpn URL。2026-08-29 curl 实证——
   *  - uri=//?ticket=X（原样）→ Location: webvpn/http/<hex>//?ticket=X（wengine 正常路由，
   *    服务端兑付票据建立 myhome/seat 会话）；
   *  - uri=%2F%2F%3Fticket%3DX（编码）→ Location: webvpn/http/<hex>%2F%2F%3Fticket%3DX
   *    （坏址）→ wengine-vpn/failed，票据被烧、会话永不建立——这正是「票据已消费但
   *    myhome/图书馆仍未登录」的根因。 */
  #oauthLbRedirect(target: string): string {
    const u = new URL(target);
    const scheme = u.protocol.replace(":", "");
    const port = u.port || (scheme === "https" ? "443" : "80");
    const uri = u.pathname + u.search + u.hash;
    return `https://oauth.tsinghua.edu.cn/lb-auth/lbredirect?scheme=${scheme}&host=${u.hostname}&port=${port}&uri=${uri}`;
  }

  /**
   * 建立家园网会话（dorm.ts roam("id", "0a993de7…/1") 同款两段，不自创登录）：
   * ① SSO 快路径——已认证 id 会话 GET CAS 服务表单 → 302/成功页锚点取票；
   * ② 无票（CAS 未下发 SSO 票据，如用户未先开 WebVPN 门户）→ lib 正门：账密直登 id。
   * 票据均经 oauth lbredirect 兑付到 myhome（lib getWebVPNUrl 同款包装）→ 探针核实。
   */
  async #ensureDorm(force = false): Promise<void> {
    return this.#single("dorm", async () => {    if (force) { this.#dormRoamed = false; this.#dormLastOkAt = 0; } // 强制重建（forceEnsure 自愈入口）
    // 新鲜快路径：5min 内有成功业务响应 → 会话必然活着，连探针往返都省（0 网络）
    if (this.#dormRoamed && Date.now() - this.#dormLastOkAt < DORM_OK_TTL) return;
    if (this.#dormRoamed && (await this.#dormAlive())) {
      this.#dormLastOkAt = Date.now();
      return;
    }
    // 兑付偶发失败（302 循环/票据竞态）：重试两轮再判死（乐观路径已兜掉大半，轮间 800ms 退避）
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    let why = "";
    for (let i = 0; i < 2; i++) {
      if (i > 0) await sleep(800);
      const ticketed = await this.#roamIdService(urls.DORM_CAS_FORM());
      if (await this.#dormAlive()) {
        this.#dormRoamed = true;
        this.#dormLastOkAt = Date.now();
        return;
      }
      why = ticketed
        ? "票据兑付后仍未登录"
        : this.#idCredentials?.()
          ? "id 账密登录未取得兑付票据"
          : "CAS 未下发票据且无内存密码（重启恢复后请重新登录一次）";
    }
    throw new AuthRequiredError(
      `宿舍服务会话未能建立（${why}；现场: ${String(this.lastDebug || this.#http.lastDebug).slice(0, 160)}）`,
    );
      });
  }

  /**
   * 电费余额（dorm.ts getEleRemainder）：
   * Netweb_Home_electricity_Detail 页内 lblele（剩余度数）+ lbltime（抄表时间）。
   */
  async getEleRemainder(): Promise<EleRemainder> {
    return this.#withRenew(async () => {
      const html = await this.#dormPage(
        () => this.#http.text(urls.ELE_REMAINDER(), this.#campusInit()),
        (p) => /net_Default_LoginCtrl1_txtUserName/i.test(p),
        "电费余额",
      );
      const remainderText =
        /Netweb_Home_electricity_DetailCtrl1_lblele[^>]*>([^<]*)</.exec(html)?.[1]?.trim() ?? "";
      if (remainderText === "") {
        throw new Error(
          `电费余额解析为空（body首段: ${html.slice(0, 200).replace(/\s+/g, " ")} | 现场: ${String(this.#http.lastDebug ?? "").slice(0, 160)}）`,
        );
      }
      const remainder = Number(remainderText);
      const updateTime =
        /Netweb_Home_electricity_DetailCtrl1_lbltime[^>]*>([^<]*)</.exec(html)?.[1]?.trim() ?? "";
      return { remainder, updateTime };
    });
  }

  /**
   * 电费缴费记录（dorm.ts getElePayRecord）：netweb_ele_pay_record 页 .myTable 表，
   * 首末行（表头/合计）丢弃，每行 6 列 = name/id/time/channel/value/status。
   * 严格过滤：状态 ∈ {已成功,已失败,处理中} + 金额可解析 + 行内含日期，垃圾行全丢；
   * 全被过滤时把垃圾行样本（前 80 字）写 lastDebug。
   */
  async getElePayRecord(): Promise<ElePayRecord[]> {
    return this.#withRenew(async () => {
      const html = await this.#dormPage(
        () => this.#http.text(urls.ELE_PAY_RECORD(), this.#campusInit()),
        (p) => /net_Default_LoginCtrl1_txtUserName/i.test(p),
        "电费缴费记录",
      );
      const table = /<table[^>]*class="[^"]*myTable[^"]*"[^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[1]
        ?? /myTable/i.test(html)
          ? html
          : "";
      if (!table) {
        throw new Error(
          `电费缴费记录页无 .myTable（body首段: ${html.slice(0, 200).replace(/\s+/g, " ")} | 现场: ${String(this.#http.lastDebug ?? "").slice(0, 160)}）`,
        );
      }
      const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) => r[1] ?? "");
      const body = rows.slice(1, rows.length - 1); // dorm.ts：slice(1, length-1)
      // 严格过滤（用户截图实证：「欢迎您郭嘉乐」/「快速通道」/ vpn_eval / 表头行 /
      // 「我要【充值电费】」按钮行全被解析成记录行）——只保留三条硬指标全过的行：
      // 状态列 ∈ {已成功,已失败,处理中} 且 金额列可解析为数字 且 行内含日期。
      const VALID_STATUS = new Set(["已成功", "已失败", "处理中"]);
      const out: ElePayRecord[] = [];
      let junkSample = "";
      for (const row of body) {
        const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => cellText(c[1] ?? ""));
        const status = (cells[5] ?? "").trim();
        const amountOk = /^[-+]?\d+(\.\d+)?$/.test((cells[4] ?? "").trim());
        const hasDate = /\d{4}[-/年]\d{1,2}[-/月]\d{1,2}|\d{1,2}:\d{2}/.test(cells.join(" "));
        if (!VALID_STATUS.has(status) || !amountOk || !hasDate) {
          junkSample ||= cells.join("|").replace(/\s+/g, " ").slice(0, 80);
          continue;
        }
        out.push({
          name: cells[0] ?? "",
          id: cells[1] ?? "",
          time: cells[2] ?? "",
          channel: cells[3] ?? "",
          value: cells[4] ?? "",
          status,
          raw: cells,
        });
      }
      if (out.length === 0) {
        // 空结果必须留现场：垃圾行样本（前 80 字）供定位页面结构变化
        this.lastDebug =
          `ele-pay-record ${body.length} 行全部被过滤（样本: ${junkSample || "(无行)"} | 现场: ${String(this.#http.lastDebug ?? "").slice(0, 120)}）`;
      }
      return out;
    });
  }

  /* --------------------- 图书馆座位（library.ts 移植） --------------------- */

  #libRoamed = false;

  /** api.php 系列统一解析（library.ts fetchJson = JSON.parse(s).data.list）；
   *  返回 HTML（登录页/门户页）→ 会话失效。返回原始解析结果，取 list 交给调用方。 */
  async #libJson(url: string): Promise<unknown> {
    const text = await this.#http.text(url, this.#campusInit());
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      if (/<html[\s>]|登录|login/i.test(text.slice(0, 400))) {
        this.#libRoamed = false;
        throw new AuthRequiredError("图书馆会话已失效，请重试");
      }
      this.lastDebug = `lib ${url.slice(0, 120)} → ${text.slice(0, 200).replace(/\s+/g, " ")}`;
      throw new Error(`图书馆接口返回异常（resp=${text.slice(0, 100).replace(/\s+/g, " ")}）`);
    }
    return json;
  }

  /** 宽容取 api.php 载荷（library.ts fetchJson 金标准 = data.list；实测存在
   *  {data:{list}} / {data:[…]} / {list:[…]} 变体）——依次 data.list → data → list。
   *  ⚠ areas 端点 data.list 为对象（含 childArea），必须原样返回，不能只认数组——
   *  否则会落到整个 {status,msg,data} 信封，楼层/区域解析全体退化（上轮回归根因）。
   *  {status:0,data:{list:null}}（curl 实证 spaces_old 坏参/无参形态）= 合法空态 → []。 */
  async #libListJson(url: string): Promise<unknown> {
    const json = await this.#libJson(url);
    const j = json as { data?: unknown; list?: unknown } | null;
    const data = j?.data as { list?: unknown } | null | undefined;
    if (data != null && !Array.isArray(data) && "list" in data && data.list == null) return [];
    if (data?.list != null) return data.list;
    if (data != null) return data;
    if (j?.list != null) return j.list;
    if (j == null || j.data == null) return [];
    return json;
  }

  /** api.php「无数据」形态判定（座位列表用原始 json）：载荷 null / {list:null} /
   *  {data:null} / {data:{list:null}} → true（空态而非报错）。 */
  #libNullList(json: unknown): boolean {
    if (json == null) return true;
    if (typeof json !== "object") return false;
    const j = json as { data?: unknown; list?: unknown };
    if ("list" in j && j.list == null) return true;
    if (j.data == null) return true;
    if (typeof j.data === "object" && "list" in j.data && (j.data as { list?: unknown }).list == null) {
      return true;
    }
    return false;
  }

  /** 座位系统会话探针：馆列表接口能出 JSON = 可用 */
  async #libAlive(): Promise<boolean> {
    const body = await this.#http.text(urls.LIBRARY_LIST(), this.#campusInit()).catch(() => "");
    return /^\s*\{/.test(body) && /"list"/.test(body);
  }

  /**
   * 建立座位系统会话（library.ts roam("id", "ef84f6d6…/0?/api/id_tsinghua_callback")
   * 同款两段）：① SSO 快路径——已认证 id 会话 GET CAS 服务表单 → 302/成功页锚点取票；
   * ② 无票（用户未先开 WebVPN 门户等）→ lib 正门账密直登 id。票据经 oauth lbredirect
   * 兑付 → 探针核实。注意 ef84f6d6… 在 lib 中是 id CAS 表单 hash，不是 yyfw 业务 id。
   */
  async #ensureLibrary(force = false): Promise<void> {
    return this.#single("library", async () => {
    if (force) {
      this.#libRoamed = false; // 强制重建（forceEnsure 自愈入口）：清标记重走
      InfoClient.libToken = ""; // token 一并失效，避免拿旧会话的 token 撞新会话
      InfoClient.libTokenTs = 0;
    }
    if (this.#libRoamed) return;
    await this.#roamIdService(urls.LIBRARY_CAS_FORM());
    if (!(await this.#libAlive())) {
      throw new AuthRequiredError(
        `图书馆座位系统会话未能建立（现场: ${String(this.lastDebug || this.#http.lastDebug).slice(0, 160)}）`,
      );
    }
    this.#libRoamed = true;
    });
  }

  /** id-CAS 服务会话建立（lib roam("id", payload) 的两段移植）：
   *  ① SSO 发票快路径（#roamIdTicket）；② 无票 → 账密直登 id（#idLoginTicket，lib 正门）。
   *  返回是否取得并兑付了票据。 */
  async #roamIdService(formUrl: string): Promise<boolean> {
    if (await this.#roamIdTicket(formUrl)) return true;
    return this.#idLoginTicket(formUrl);
  }

  /** ① SSO 发票快路径：已认证 id 会话 GET 服务表单 → 302 Location / 成功页锚点取票。
   *  注意只有含 ticket= 的 Location 才是票据兑付地址（其余 Location 消费了也白搭）。 */
  async #roamIdTicket(formUrl: string): Promise<boolean> {
    const res = await this.#http.request(formUrl, { redirect: "manual", direct: true });
    let ticketUrl = res.headers.get("location") ?? undefined;
    if (ticketUrl && !/ticket=/.test(ticketUrl)) ticketUrl = undefined;
    if (!ticketUrl) {
      const html = await res.text().catch(() => "");
      // 成功页形态 = 「登录成功。正在重定向到」+ <a href="…ticket=…">（dorm.ts 同判据）
      ticketUrl = /<a[^>]+href="([^"]*ticket=[^"]*)"/i.exec(html)?.[1];
      if (!ticketUrl && !/<form|sm2publicKey/i.test(html)) {
        this.lastDebug = `sso ${formUrl.slice(0, 120)} status=${res.status} → ${html.slice(0, 200).replace(/\s+/g, " ")}`;
      }
    }
    if (!ticketUrl) return false;
    return this.#consumeIdTicketUrl(ticketUrl, formUrl);
  }

  /**
   * ② lib roam("id") 正门：GET 服务表单页抓 sm2publicKey → SM2 加密账密 POST
   *  id /do/off/ui/auth/login/check。两套字段集先后尝试（curl 实证 check 对
   *  正常表单请求恒返 HTML，空体只来自被跟跳的 302 链）：
   *  a) zhjwxk xklogin→check 实测直连字段集（i_user/i_pass/sm2pass/singleLogin/…）；
   *  b) lib roam("id") 最小字段集（i_user/i_pass/fingerPrint/fingerGenPrint/i_captcha，
   *     不带页面 hidden 字段）。
   *  check 用 redirect:"manual"：302 Location 直接就是兑付地址，自动跟跳会冲进
   *  校内直连不可达的空洞返回空体——这正是「check 响应为空」的根因。
   */
  async #idLoginTicket(formUrl: string): Promise<boolean> {
    const creds = this.#idCredentials?.();
    if (!creds?.username || !creds?.password) {
      this.lastDebug = `id-login skip（无内存凭据） ${formUrl.slice(0, 120)}`;
      return false;
    }
    let diag = "";
    for (const variant of ["zhjwxk", "lib"] as const) {
      const out = await this.#idLoginAttempt(formUrl, creds, variant);
      if (out.ok) {
        this.lastDebug = (diag + out.diag).replace(/\s+/g, " ").slice(0, 400);
        return true;
      }
      diag += out.diag + " | ";
      if (out.fatal) break;
    }
    this.lastDebug = diag.replace(/\s+/g, " ").slice(0, 400);
    return false;
  }

  /** 单次账密登录尝试；2FA 抛 AuthRequiredError，其余失败返回诊断现场。 */
  async #idLoginAttempt(
    formUrl: string,
    creds: { username: string; password: string; fingerprint: string },
    variant: "zhjwxk" | "lib",
  ): Promise<{ ok: boolean; fatal: boolean; diag: string }> {
    const formHtml = await this.#http.text(formUrl, { direct: true });
    // 已认证会话下该 URL 可能直接返回成功页 —— 锚点兜底
    const preAnchor = /<a[^>]+href="([^"]*ticket=[^"]*)"/i.exec(formHtml)?.[1];
    if (preAnchor) return this.#consumeIdTicketUrl(preAnchor, formUrl).then((ok) => ({ ok, fatal: false, diag: "form-anchor" }));
    let form: ReturnType<typeof parseCasFormHtml>;
    try {
      form = parseCasFormHtml(formHtml, false);
    } catch {
      // 公钥提取失败：把页内 sm2publicKey 原文前 32 字符（可能为空/非 hex）带进现场
      const rawPk = /id=["']sm2publicKey["'][^>]*>([^<]*)/.exec(formHtml)?.[1]?.trim() ?? "";
      return {
        ok: false,
        fatal: false,
        diag: `id-login form(${variant}) ${formUrl.slice(0, 90)} pk缺失 raw=${rawPk.slice(0, 32) || "(空)"} → ${formHtml.slice(0, 120).replace(/\s+/g, " ")}`,
      };
    }
    const enc = encryptPassword(creds.password, form.publicKey);
    const base: Record<string, string> = {
      i_user: creds.username,
      i_pass: enc,
      fingerPrint: creds.fingerprint,
      fingerGenPrint: "",
      i_captcha: "",
    };
    const body = new URLSearchParams(
      variant === "zhjwxk"
        ? { ...form.hiddenFields, ...base, sm2pass: enc, singleLogin: "on", fingerGenPrint3: "" }
        : base,
    );
    const checkUrl = form.action
      ? form.action.startsWith("http")
        ? form.action
        : new URL(form.action, ID_PREFIX).toString()
      : ID_PREFIX + "/do/off/ui/auth/login/check";
    const res = await this.#http.request(checkUrl, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      direct: true, // 与登录表单同域直连（id 会话绝不能经 WebVPN 包装）
      redirect: "manual",
    });
    const checkHtml = await res.text().catch(() => "");
    const status = res.status;
    const location = res.headers.get("location") ?? "";
    // 现场（脱敏）：请求头只留 cookie 名单与字段名/密文长度；响应头留 status/ct/loc
    const reqNote = `cookie=${this.#http.lastCookieNames || "(none)"} fields=${[...body.keys()].join("+")} i_pass.len=${enc.length} pk=${form.publicKey.slice(0, 32)}`;
    const respNote = `status=${status} ct=${res.headers.get("content-type") ?? ""} loc=${location.slice(0, 80)} resp=${checkHtml.slice(0, 120).replace(/\s+/g, " ") || "(空)"}`;
    if (status >= 300 && status < 400 && location) {
      // check 直接 302：Location 即服务兑付地址（含 ticket）——手动兑付，绝不自动跟跳
      const ok = await this.#consumeIdTicketUrl(location, checkUrl);
      return { ok, fatal: false, diag: `id-login 302-consume(${variant}) ok=${ok} ${respNote}` };
    }
    if (/二次认证|双因素|二次验证|双因子/.test(checkHtml)) {
      this.lastDebug = `id-login 2fa ${checkUrl.slice(0, 90)}`;
      throw new AuthRequiredError(
        "id 服务登录触发二次认证，请先在应用内重新登录一次（建立设备信任）后重试",
      );
    }
    if (checkHtml.includes("登录成功")) {
      const anchor = /<a[^>]+href="([^"]+)"/i.exec(checkHtml)?.[1];
      if (anchor) {
        const ok = await this.#consumeIdTicketUrl(anchor, checkUrl);
        return { ok, fatal: false, diag: `id-login success(${variant}) consume=${ok}` };
      }
    }
    return {
      ok: false,
      fatal: false,
      diag: `id-login check(${variant}) ${checkUrl.slice(0, 80)} req{${reqNote}} resp{${respNote}}`,
    };
  }

  /** 兑付 id 锚点票据：webvpn/oauth URL 原样走；其余按 lib getWebVPNUrl 包成
   *  oauth lbredirect（公网可达，跨域把 CAS 票据兑付到目标服务——307 → webvpn URL，
   *  wengine 服务端完成内部兑付）。终点若落在 wengine-vpn/failed 说明兑付链断裂。 */
  async #consumeIdTicketUrl(ticketUrl: string, baseUrl: string): Promise<boolean> {
    let target = ticketUrl.startsWith("http") ? ticketUrl : new URL(ticketUrl, baseUrl).toString();
    const consume = /webvpn\.tsinghua\.edu\.cn|oauth\.tsinghua\.edu\.cn/.test(target)
      ? target
      : this.#oauthLbRedirect(target);
    try {
      const res = await this.#http.request(consume, { redirect: "follow" });
      // 诊断：兑付链终点（tauriFetch 经 x-onethu-final-url 回传；wengine-vpn/failed
      // = wengine 无法路由目标，票据白烧——不视为兑付成功）
      const finalUrl = res.headers.get("x-onethu-final-url") ?? "";
      this.lastDebug = `consume status=${res.status} final=${finalUrl.slice(0, 140)}`;
      return !/wengine-vpn\/failed/.test(finalUrl);
    } catch (e) {
      this.lastDebug = `consume error ${String(e).slice(0, 120)} ${consume.slice(0, 140)}`;
      return false;
    }
  }

  #lastTokenPage = "";

  /** 馆列表（library.ts getLibraryList：areas/1/tree → data.list 数组） */
  async getLibraryList(): Promise<Library[]> {
    return this.#withRenew(async () => {
      await this.#ensureLibrary();
      const list = await this.#libListJson(urls.LIBRARY_LIST());
      if (!Array.isArray(list)) throw new Error("图书馆列表解析失败（data.list 非数组）");
      return list.map((node) => {
        const n = node as Record<string, unknown>;
        const name = String(n.name ?? "");
        return {
          id: Number(n.id),
          zhName: name,
          // library.ts getLibraryList：zhNameTrace = node.nameMerge（非 name）
          zhNameTrace: String(n.nameMerge ?? name),
          enName: String(n.enname ?? "") || undefined,
          enNameTrace: String(n.ennameMerge ?? "") || undefined,
          valid: Number(n.isValid) === 1,
        };
      });
    });
  }

  /** 区域列表（library.ts getLibrarySectionList：areas/<id>/date/<d> → data.list.childArea） */
  async getLibrarySectionList(
    floor: { id: number; zhNameTrace: string },
    dateChoice: 0 | 1,
  ): Promise<LibrarySection[]> {
    return this.#withRenew(async () => {
      await this.#ensureLibrary();
      const list = await this.#libListJson(this.#libAreasByDateUrl(floor.id, dateChoice));
      // list:null / [] = 该日期无开放区域（合法空态）；data.list 区域端点为对象（childArea）
      if (list == null || (Array.isArray(list) && list.length === 0)) return [];
      // data.list 区域端点为对象、树端点为数组 —— 两种形态都容忍
      const root = Array.isArray(list) ? list[0] : list;
      const children = (root as Record<string, unknown> | undefined)?.childArea;
      if (!Array.isArray(children)) throw new Error("图书馆区域解析失败（childArea 缺失）");
      return children
        .map((node) => {
          const n = node as Record<string, unknown>;
          const name = String(n.name ?? "");
          const total = Number(n.TotalCount) || 0;
          const unavailable = Number(n.UnavailableSpace) || 0;
          return {
            id: Number(n.id),
            zhName: name,
            zhNameTrace: `${floor.zhNameTrace} - ${name}`,
            valid: Number(n.isValid) === 1,
            total,
            available: total - unavailable,
          };
        })
        .sort((a, b) => a.id - b.id);
    });
  }

  #libAreasByDateUrl(id: number, dateChoice: 0 | 1): string {
    const d = new Date();
    d.setDate(d.getDate() + dateChoice);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return urls.LIBRARY_AREAS(id, date);
  }

  /** 楼层列表（library.ts getLibraryFloorList：areas/<libId> 楼层 + 逐层区域求和 available/total） */
  async getLibraryFloorList(library: Library, dateChoice: 0 | 1): Promise<LibraryFloor[]> {
    return this.#withRenew(async () => {
      await this.#ensureLibrary();
      const list = await this.#libListJson(urls.LIBRARY_AREAS(library.id));
      // list:null / [] = 无楼层（合法空态）；areas 端点 data.list 为对象（childArea）
      if (list == null || (Array.isArray(list) && list.length === 0)) return [];
      const root = Array.isArray(list) ? list[0] : list;
      const children = (root as Record<string, unknown> | undefined)?.childArea;
      if (!Array.isArray(children)) throw new Error("图书馆楼层解析失败（childArea 缺失）");
      const floors: LibraryFloor[] = children.map((node) => {
        const n = node as Record<string, unknown>;
        const name = String(n.name ?? "");
        return {
          id: Number(n.id),
          zhName: name,
          zhNameTrace: `${library.zhName} - ${name}`,
          valid: Number(n.isValid) === 1,
          parentId: library.id,
          available: 0,
          total: 0,
        };
      });
      for (const floor of floors) {
        if (!floor.valid) continue;
        const sections = await this.getLibrarySectionList(floor, dateChoice).catch(() => []);
        for (const s of sections) {
          if (s.valid) {
            floor.available += s.available;
            floor.total += s.total;
          }
        }
      }
      return floors.sort((a, b) => a.id - b.id);
    });
  }

  /** 区域开放时段（library.ts getLibraryDay：areadays/<id> 找 today/tomorrow 行） */
  async #libDay(
    sectionId: number,
    choice: 0 | 1,
  ): Promise<{ day: string; startTime: string; endTime: string; segmentId: number; today: boolean }> {
    const list = await this.#libListJson(urls.LIBRARY_DAYS(sectionId));
    if (!Array.isArray(list)) throw new Error("图书馆时段解析失败（data.list 非数组）");
    const d = new Date();
    d.setDate(d.getDate() + choice);
    const want = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const hit = list.find((it) => (it as Record<string, unknown>).day === want) as
      | Record<string, unknown>
      | undefined;
    if (!hit) throw new Error(`图书馆该区域近两日无开放时段（want=${want}）`);
    // startTime/endTime 实测为 {date:"2026-08-30 08:00:00",…} 对象（lib transformDate
    // 解构 {date} 同源），兼容裸字符串；统一取 HH:mm（substring(11,16)）。
    // ⚠ String(对象)="[object Object]" 拼进 spaces_old 查询 → data.list:null，
    // 座位列表整体空态（「无数据」根因，curl 实证复现）。
    const hhmm = (v: unknown): string => {
      const raw = v != null && typeof v === "object" && "date" in v
        ? String((v as { date?: unknown }).date ?? "")
        : String(v ?? "");
      return raw.length >= 16 ? raw.substring(11, 16) : raw;
    };
    return {
      day: String(hit.day ?? want),
      startTime: hhmm(hit.startTime),
      endTime: hhmm(hit.endTime),
      segmentId: Number(hit.id),
      today: choice === 0,
    };
  }

  /** 座位列表（library.ts getLibrarySeatList：spaces_old?area=…&segment=…&day=…&startTime=…&endTime=…） */
  async getLibrarySeatList(
    section: { id: number; zhNameTrace: string },
    dateChoice: 0 | 1,
  ): Promise<LibrarySeat[]> {
    return this.#withRenew(async () => {
      await this.#ensureLibrary();
      const day = await this.#libDay(section.id, dateChoice);
      // 今天取「当前时间与开馆时间较晚者」（library.ts currentTime 同语义）
      const now = new Date();
      const nowHm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const startTime = day.today ? (day.startTime > nowHm ? day.startTime : nowHm) : day.startTime;
      const query = new URLSearchParams({
        area: String(section.id),
        segment: String(day.segmentId),
        day: day.day,
        startTime,
        endTime: day.endTime,
      });
      const seatsUrl = `${urls.LIBRARY_SEATS()}?${query.toString()}`;
      const json = await this.#libJson(seatsUrl);
      // 宽容解析（library.ts fetchJson 金标准 = data.list 数组；实测存在
      // {data:{list}} / {data:[…]} / {list:[…]} / {data:{spaces}} 变体）：
      // 依次 data.list → data → list → data.spaces，取第一个数组
      const j = json as { data?: { list?: unknown; spaces?: unknown }; list?: unknown } | null;
      const list = [j?.data?.list, j?.data, j?.list, j?.data?.spaces].find((c): c is unknown[] =>
        Array.isArray(c),
      );
      if (!list) {
        const snippet = (JSON.stringify(json) ?? String(json)).slice(0, 200);
        this.lastDebug = `seats ${seatsUrl.slice(0, 120)} → ${snippet}`;
        // {status:0,data:{list:null}}（curl 实证的「无数据」形态）→ list:null 显示空态
        if (this.#libNullList(json)) return [];
        throw new Error(`座位列表解析失败（data.list 非数组；resp=${snippet.replace(/\s+/g, " ")}）`);
      }
      // 插座状态（app.cs 后端；失败容忍 —— library.ts 同款 catch(() => [])）
      const sockets = await this.#http
        .text(`${urls.APP_SOCKET_STATUS()}?sectionid=${section.id}`, { direct: true })
        .then((t) => JSON.parse(t) as Array<{ seatId?: number; status?: string }>)
        .catch(() => [] as Array<{ seatId?: number; status?: string }>);
      return list
        .map((node) => {
          const n = node as Record<string, unknown>;
          const name = String(n.name ?? "");
          const id = Number(n.id);
          // 座位级 daybook（spaces_old 即「获取空间预约信息」端点；curl 实测
          // status: 1=空闲 2=已预约 4=维护，status_name 为中文名）：
          // status===1 → usable；否则按 status_name 语义归一化 booked/maintain/unknown。
          const seatStatus = Number(n.status);
          const statusName = String(n.status_name ?? "").trim();
          const availability: LibrarySeatAvailability =
            seatStatus === 1
              ? "usable"
              : seatStatus === 2 || /预约|使用中|占用|暂离/.test(statusName)
                ? "booked"
                : seatStatus === 4 || /维护|维修|停用/.test(statusName)
                  ? "maintain"
                  : "unknown";
          // 插座状态（app.cs 后端；失败容忍 —— library.ts 同款 catch(() => [])）
          const socket = sockets.find((s) => Number(s.seatId) === id)?.status;
          // 有电源：type 名含「电源/插座/插头」（area_type 实测为数字，若上游返回
          // 类型名则命中），或 app.cs 插座表含该座（在表即有插座）。
          const typeText = String(n.type ?? n.area_type ?? "");
          const hasPower = /电源|插座|插头/.test(typeText) || socket !== undefined;
          return {
            id,
            zhName: name,
            zhNameTrace: `${section.zhNameTrace} - ${name}`,
            valid: seatStatus === 1,
            type: typeText || undefined,
            status: socket,
            availability,
            statusName: statusName || undefined,
            hasPower,
          };
        })
        // library.ts weightedValidityAndId：(valid?0:1000)+id
        .sort((a, b) => (a.valid ? 0 : 1000) + a.id - ((b.valid ? 0 : 1000) + b.id));
    });
  }

  /**
   * 首页内嵌 access_token（library.ts getAccessToken 逐行对照）：
   * uFetch(LIBRARY_HOME_URL) 页内首个 "access_token" 后第一个引号串；lib 的
   * getAccessToken 每次调用前都先 roam("id") 重建 id→座位系统会话 —— 首页无
   * token 时 core 同样重走 #roamIdService 再取一次。失败带抓取页 URL 前 120 字符。
   */
  async #libraryAccessToken(): Promise<string> {
    // 10 分钟模块级缓存 + 单飞：access_token 每次都整页抓 LIBRARY_HOME 是预约区加载慢的根因之一
    if (InfoClient.libToken && Date.now() - InfoClient.libTokenTs < 600_000) return InfoClient.libToken;
    if (InfoClient.libTokenInflight) return InfoClient.libTokenInflight;
    const home = urls.LIBRARY_HOME();
    const grab = async (): Promise<string> => {
      const page = await this.#http.text(home, this.#campusInit());
      const leftmost = page.indexOf("access_token");
      if (leftmost < 0) return "";
      const left = page.indexOf('"', leftmost) + 1;
      const right = page.indexOf('"', left);
      const token = left > 0 && right > left ? page.slice(left, right).trim() : "";
      // 仅在成功提取到非空 token 时记录抓取页（leftmost 命中≠提取成功，避免误导）
      if (token) this.#lastTokenPage = home;
      return token;
    };
    const run2 = async (): Promise<string> => {
    let token = await grab();
    if (!token) {
      // lib roam("id") 语义：会话未落地就重建（ef84f6d6…/0?/api/id_tsinghua_callback）。
      // 不做根页 fallback：GET / 会 302 并下发新 PHPSESSID，污染 jar 里的座位系统会话，
      // 导致其后的 api.php（馆/楼层/区域）整体降级为匿名态（下拉全空的根因之一）。
      this.#libRoamed = false;
      await this.#roamIdService(urls.LIBRARY_CAS_FORM());
      if (await this.#libAlive()) this.#libRoamed = true;
      token = await grab();
    }
    if (!token) {
      const pageUrl = (this.#lastTokenPage || home).slice(0, 120);
      this.lastDebug = `lib-home ${pageUrl} → ${String(this.#http.lastDebug).slice(0, 200)}`;
      throw new AuthRequiredError(
        `图书馆 access_token 获取失败（首页无 token，会话可能已失效；抓取页 URL: ${pageUrl}）。建议：退出 OneTHU 重新登录一次后重试`,
      );
    }
    InfoClient.libToken = token;
    InfoClient.libTokenTs = Date.now();
    return token;
    };
    InfoClient.libTokenInflight = run2().finally(() => { InfoClient.libTokenInflight = null; });
    return InfoClient.libTokenInflight;
  }

  /** 预约座位（library.ts bookLibrarySeat：POST spaces/<id>/book，form 字段逐项一致） */
  async bookLibrarySeat(
    seat: { id: number; type?: string },
    sectionId: number,
    dateChoice: 0 | 1,
    userId: string,
  ): Promise<{ status?: number; msg?: string }> {
    return this.#withRenew(async () => {
      await this.#ensureLibrary();
      const { segmentId } = await this.#libDay(sectionId, dateChoice);
      const token = await this.#libraryAccessToken();
      const text = await this.#http.text(urls.LIBRARY_BOOK_SEAT(seat.id), {
        ...this.#campusInit(),
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          access_token: token,
          userid: userId,
          segment: String(segmentId),
          type: String(seat.type ?? ""),
          operateChannel: "2",
        }).toString(),
      });
      let data: { status?: number; msg?: string; message?: string };
      try {
        data = JSON.parse(text) as typeof data;
      } catch {
        throw new Error(`预约座位响应异常（resp=${text.slice(0, 100).replace(/\s+/g, " ")}）`);
      }
      if (!data.status) throw new Error(data.msg ?? data.message ?? "预约座位失败");
      return data;
    });
  }

  /** 我的预约记录（library.ts getBookingRecords：user/index/book 表，
   *  td 索引 1/2/3/5 = id/pos/time/status，行内 menuDel('…') 提取 delId；
   *  实体解码后匹配，兼容 &#39;/双引号 onclick 变体） */
  async getLibBookRecords(): Promise<LibBookRecord[]> {
    return this.#hot("libBookRecords", 15_000, () =>
    this.#withRenew(async () => {
      await this.#ensureLibrary();
      await this.#libraryAccessToken();
      const html = await this.#http.text(urls.LIBRARY_BOOK_RECORD(), this.#campusInit());
      const tbody = /<tbody[^>]*>([\s\S]*?)<\/tbody>/i.exec(html)?.[1];
      if (!tbody) {
        if (!html.includes("tbody")) {
          // 登录页形态（ XHTML/表单）= 会话失效 → 走失登自愈（整页重载兜底），别当解析错误
          if (/<form|登录|login|password|用户名/i.test(html)) throw new AuthRequiredError();
          throw new Error(
            `预约记录页解析失败（body首段: ${html.slice(0, 200).replace(/\s+/g, " ")} | 现场: ${String(this.#http.lastDebug ?? "").slice(0, 160)}）`,
          );
        }
        return [];
      }
      const out: LibBookRecord[] = [];
      for (const row of tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const rowHtml = row[1] ?? "";
        const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => cellText(c[1] ?? ""));
        if (cells.length < 6) continue;
        // lib 经 cheerio attribs 读 onclick（实体已解码）；此处对原文先解码再匹配，
        // 兼容 onclick="menuDel(&#39;…&#39;)" 与双引号变体 —— 否则 delId 落空、
        // 「我的预约」整列缺取消按钮。
        const del = /menuDel\(\s*(['"])([^'"]+)\1/.exec(decodeEntities(rowHtml))?.[2];
        out.push({
          id: cells[1] ?? "",
          pos: cells[2] ?? "",
          time: cells[3] ?? "",
          status: cells[5] ?? "",
          delId: del,
        });
      }
      return out;
    }));
  }

  /** 取消预约（library.ts cancelBooking：POST profile/books/<id>，_method=delete） */
  async cancelLibBooking(recordId: string, userId: string): Promise<void> {
    return this.#withRenew(async () => {
      await this.#ensureLibrary();
      const token = await this.#libraryAccessToken();
      const text = await this.#http.text(`${urls.LIBRARY_CANCEL_BOOKING()}${encodeURIComponent(recordId)}`, {
        ...this.#campusInit(),
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          _method: "delete",
          id: recordId,
          userid: userId,
          access_token: token,
          operateChannel: "2",
        }).toString(),
      });
      let data: { status?: number; msg?: string; message?: string };
      try {
        data = JSON.parse(text) as typeof data;
      } catch {
        throw new Error(`取消预约响应异常（resp=${text.slice(0, 100).replace(/\s+/g, " ")}）`);
      }
      if (!data.status) throw new Error(data.msg ?? data.message ?? "取消预约失败");
    });
  }

  /* --------------- 研讨间预约（library.ts cab/ic-web 链移植） --------------- */

  /** 研讨间当前账号号（library.ts accountBaseInfo.accNo；提交预约 resvMember 用） */
  #libRoomAccNo: number | null = null;
  /** 规范学号（cab userInfo.pid）：登录名≠学号（用户名登录）时由服务端权威回填，
   *  后续 ensure 的 TTL 键与邮箱自动绑定都以它为准 */
  #libRoomPid: string | null = null;

  /** 当前账号号（library.ts helper.getLibraryRoomAccNo 同名语义；UI 组 resvMember 用） */
  getLibRoomAccNo(): number | null {
    return this.#libRoomAccNo;
  }

  /**
   * ic-web 统一请求（library.ts cabFetch 逐行对照）：GET 或 POST JSON →
   * {code,data,message}；code!==0 抛 message（含登录特征 → AuthRequiredError 走
   * 重建会话重试）；响应非 JSON（落地登录页）= 会话失效。GET 走 text()：
   * wengine 引导页 dance（method=get 领 cookie 并重放）只有 text() 会执行。
   */
  async #cabFetch<T = unknown>(url: string, jsonStruct?: unknown): Promise<T> {
    const text = jsonStruct === undefined
      ? await this.#http.text(url, this.#campusInit())
      : await this.#http.text(url, {
          ...this.#campusInit(),
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(jsonStruct),
        });
    let json: { code?: number; data?: T; message?: string };
    try {
      json = JSON.parse(text) as typeof json;
    } catch {
      this.#libRoomAccNo = null;
      InfoClient.libRoomAuthUser = "";
      InfoClient.libRoomAuthTs = 0;
      throw new AuthRequiredError(
        `研讨间会话已失效（resp=${text.slice(0, 100).replace(/\s+/g, " ")}）`,
      );
    }
    if (json.code !== 0) {
      const msg = json.message ?? `code=${String(json.code)}`;
      if (/登录|login|auth|身份|expire/i.test(msg)) {
        this.#libRoomAccNo = null;
        InfoClient.libRoomAuthUser = "";
        InfoClient.libRoomAuthTs = 0;
        throw new AuthRequiredError(`研讨间会话已失效：${msg}`);
      }
      throw new Error(msg);
    }
    return json.data as T;
  }

  /** 探测 ic-web 会话并校验用户（library.ts assureLoginValid 的 pid 比对同语义）。
   *  失败带原因回传——新生「绑完邮箱仍失败」需要区分：没 pid / pid 不匹配 /
   *  缺 accNo / 会话本身没建立，四者修法完全不同，不能折叠成一句话。 */
  async #libRoomAlive(userId: string): Promise<{ ok: boolean; why: string }> {
    try {
      const info = await this.#cabFetch<{ pid?: string; accNo?: number }>(urls.LIBROOM_USER_INFO());
      const pid = String(info.pid ?? "");
      if (pid === "") return { ok: false, why: "userInfo 无 pid（原站账号可能未完成激活/绑定）" };
      if (pid !== userId) {
        // cab 会话本就是当前账号的 SSO 会话；pid 是服务端权威学号。登录名（用户名）
        // ≠ 学号只说明「登录名形态不同」，不是错账号——采纳 pid 为规范学号继续，
        // 不再判死（用户名登录时研讨间恒接不进的根因）。
        this.#libRoomPid = pid;
      }
      const accNo = Number(info.accNo);
      if (!Number.isFinite(accNo)) return { ok: false, why: "userInfo 无 accNo（原站账号资料不全）" };
      this.#libRoomAccNo = accNo;
      return { ok: true, why: "" };
    } catch (e) {
      return { ok: false, why: String(e).slice(0, 140) };
    }
  }

  /**
   * 建立研讨间 cab 会话（library.ts cabLogin 逐段移植，与座位系统会话相互独立）：
   * ① GET ic-web/auth/address（data = cab SSO 地址，真实域 cab.lib…）；
   * ② lib 的 authAddress.replace("https://cab.lib.tsinghua.edu.cn", webvpn根) 在此为
   *    webvpnWrap 动态编码同形 URL（cab.lib 非公网 host，直连不可达恒走包装）；
   *    跟随重定向链落至 id CAS 登录表单，payload = /login/form/ 后缀（lib 同正则）；
   * ③ #roamIdService(formUrl)——与座位系统同款 id 两段（SSO 发票快路径 / SM2 账密
   *    直登），票据兑付即建立 cab 会话（service 为 WebVPN 包装的 cab 回调）；
   * ④ ic-web/auth/userInfo 核实 pid === userId 并缓存 accNo。
   */
  async #ensureLibRoom(userId: string): Promise<void> {
    // 规范学号：用户名登录时 #libRoomPid 已由上轮探针回填（登录名≠学号），TTL 键以它为准
    const canonical = (): string => this.#libRoomPid ?? userId;
    // 10 分钟 TTL + 跨实例单飞（#libraryAccessToken 同款；单用户应用，缓存含 userId）。
    // 命中时连 #libRoomAlive 探针都省掉——每次进图书馆页都重跑整条 cab 漫游链即慢的根因。
    if (InfoClient.libRoomAuthUser === canonical() && Date.now() - InfoClient.libRoomAuthTs < 600_000) {
      return;
    }
    if (InfoClient.libRoomInflight) return InfoClient.libRoomInflight;
    const run = async (): Promise<void> => {
    if (InfoClient.libRoomAuthUser === canonical() && Date.now() - InfoClient.libRoomAuthTs < 600_000) return;
    if ((await this.#libRoomAlive(userId)).ok) {
      InfoClient.libRoomAuthUser = canonical();
      InfoClient.libRoomAuthTs = Date.now();
      return;
    }
    this.#libRoomAccNo = null;
    const addr = await this.#cabFetch<string>(urls.LIBROOM_AUTH_ADDRESS());
    if (typeof addr !== "string" || addr === "") {
      throw new AuthRequiredError("研讨间登录失败：auth/address 未返回 SSO 地址");
    }
    const res = await this.#http.request(webvpnWrap(addr), { redirect: "follow" });
    const loginUrl = res.headers.get("x-onethu-final-url") || res.url || "";
    const payload = /\/login\/form\/(.+)$/.exec(loginUrl)?.[1];
    if (!payload) {
      // id SSO 会话有效时该链可能直通兑付（终点已是 cab 页而非 id 表单）——重探一次
      if ((await this.#libRoomAlive(userId)).ok) {
        InfoClient.libRoomAuthUser = userId;
        InfoClient.libRoomAuthTs = Date.now();
        return;
      }
      throw new AuthRequiredError(
        `研讨间登录失败：SSO 重定向链未落到 id 登录表单（终=${loginUrl.slice(0, 120)}；现场=${String(this.#http.lastDebug ?? "").slice(0, 160)}）`,
      );
    }
    const formUrl = `${ID_PREFIX}/do/off/ui/auth/login/form/${payload}`;
    if (!(await this.#roamIdService(formUrl))) {
      throw new AuthRequiredError(
        `研讨间会话未能建立（id 发票/账密两路均未兑付；现场=${String(this.lastDebug || this.#http.lastDebug).slice(0, 160)}）。若为首次使用，请先到研讨间管理系统绑定邮箱后重试`,
      );
    }
    let alive = await this.#libRoomAlive(userId);
    if (!alive.ok && /无 pid|无 accNo/.test(alive.why)) {
      // 无感激活（用户语义：研讨间应与图书馆一样零操作）：新生原站账号未
      // 初始化时，应用内自动绑官方邮箱（学号@mails.tsinghua.edu.cn，与原站
      // 手动流程同接口 ic-web/account/update），随后复检——成功则全程无引导。
      // 仅规范学号为纯数字（即真实学号）时才自动绑；用户名登录拼不出学号邮箱。
      const mailId = this.#libRoomPid ?? userId;
      if (/^\d+$/.test(mailId)) {
        try {
          await this.#cabFetch(urls.LIBROOM_UPDATE_EMAIL(), {
            email: `${mailId}@mails.tsinghua.edu.cn`,
          });
          alive = await this.#libRoomAlive(userId);
        } catch {
          /* 绑定失败则落回原引导文案 */
        }
      }
    }
    if (!alive.ok) {
      // 兜底引导：自动激活未覆盖的失败仍指去原站
      throw new AuthRequiredError(
        `研讨间会话未能建立（登录后 userInfo 校验未通过：${alive.why}）。若为首次使用，请先到研讨间管理系统绑定邮箱后重试；已绑定仍见此条，请连原因一起反馈`,
      );
    }
    InfoClient.libRoomAuthUser = canonical();
    InfoClient.libRoomAuthTs = Date.now();
    };
    InfoClient.libRoomInflight = run().finally(() => { InfoClient.libRoomInflight = null; });
    return InfoClient.libRoomInflight;
  }

  /** 研讨间请求包装：先 #ensureLibRoom；AuthRequiredError 时重建会话重试一次
   *  （查询幂等；预约写操作的 resvMember 在 accNo 确认后才组装，重放安全）。 */
  async #withLibRoom<T>(userId: string, op: () => Promise<T>): Promise<T> {
    await this.#ensureLibRoom(userId);
    try {
      return await op();
    } catch (e) {
      if (!(e instanceof AuthRequiredError)) throw e;
      this.#libRoomAccNo = null;
      await this.#ensureLibRoom(userId);
      return await op();
    }
  }

  /** 房型/房间列表（library.ts getLibraryRoomBookingInfoList 字段映射） */
  async getLibRoomInfoList(userId: string): Promise<LibRoomInfo[]> {
    return this.#withLibRoom(userId, async () => {
      const data = await this.#cabFetch<Array<Record<string, unknown>>>(urls.LIBROOM_ROOM_INFO());
      return (data ?? []).map((item) => ({
        kindId: Number(item.kindId),
        kindName: String(item.kindName ?? ""),
        rooms: ((item.roomInfos ?? []) as Array<Record<string, unknown>>).map((room) => ({
          devId: Number(room.devId),
          devName: String(room.devName ?? ""),
          minReserveTime: Number(room.minResvTime ?? 0),
        })),
      }));
    });
  }

  /** 可约资源（library.ts getLibraryRoomBookingResourceList；date=yyyyMMdd） */
  async getLibRoomResourceList(userId: string, date: string, kindId: number): Promise<LibRoomRes[]> {
    return this.#withLibRoom(userId, async () => {
      const data = await this.#cabFetch<Array<Record<string, unknown>>>(
        `${urls.LIBROOM_RESOURCE_LIST()}&resvDates=${date}&kindIds=${kindId}`,
      );
      return (data ?? []).map((item) => {
        const rule = (item.resvRule ?? {}) as Record<string, unknown>;
        return {
          devId: Number(item.devId),
          devName: String(item.devName ?? ""),
          kindId: Number(item.kindId),
          kindName: String(item.kindName ?? ""),
          labId: Number(item.labId),
          labName: String(item.labName ?? ""),
          roomId: Number(item.roomId),
          roomName: String(item.roomName ?? ""),
          limit: Number(rule.limit ?? 0),
          maxMinute: Number(rule.maxResvTime ?? 0),
          minMinute: Number(rule.minResvTime ?? 0),
          cancelMinute: Number(rule.cancelTime ?? 0),
          maxUser: Number(item.maxUser ?? 0),
          minUser: Number(item.minUser ?? 0),
          openStart: item.openStart == null ? null : String(item.openStart),
          openEnd: item.openEnd == null ? null : String(item.openEnd),
          usage: ((item.resvInfo ?? []) as Array<Record<string, unknown>>)
            // wireDate：epoch 数字/数字串与日期串两态都解析（lib new Date(info.startTime) 同语义）；
            // 单条解析失败仅丢弃该条占用，不整单退化（保住其余占用段的显示）。
            .filter((u) => {
              const start = wireDate(u.startTime);
              const end = wireDate(u.endTime);
              return !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime());
            })
            .map((u) => ({
              id: Number(u.resvId),
              start: wireDate(u.startTime),
              end: wireDate(u.endTime),
              title: String(u.title ?? ""),
              owner: String(u.trueName ?? ""),
              ownerId: String(u.logonName ?? ""),
            })),
        } satisfies LibRoomRes;
      });
    });
  }

  /** 成员模糊搜索（library.ts fuzzySearchLibraryId；id 为 accNo，非学号） */
  async fuzzySearchLibRoomMember(userId: string, keyword: string): Promise<LibFuzzySearchResult[]> {
    return this.#withLibRoom(userId, async () => {
      const data = await this.#cabFetch<Array<Record<string, unknown>>>(
        urls.LIBROOM_FUZZY_SEARCH() + encodeURIComponent(keyword),
      );
      return (data ?? []).map((r) => ({
        id: Number(r.accNo),
        label: String(r.logonName ?? ""),
        department: String(r.deptName ?? ""),
      }));
    });
  }

  /** 提交预约（library.ts bookLibraryRoom；start/end = "YYYY-MM-DD HH:mm"，
   *  JSON 字段逐项一致——sysKind/resvKind/resvProperty 等为 lib 源码字面值） */
  async bookLibRoom(
    userId: string,
    roomRes: LibRoomRes,
    start: string,
    end: string,
    memberList: number[],
  ): Promise<void> {
    return this.#withLibRoom(userId, async () => {
      await this.#cabFetch(urls.LIBROOM_ACTION(), {
        sysKind: 1,
        appAccNo: this.#libRoomAccNo ?? -1,
        memberKind: 1,
        resvBeginTime: start,
        resvEndTime: end,
        testName: "",
        resvKind: 2,
        resvProperty: 0,
        appUrl: "",
        resvMember: memberList,
        resvDev: [roomRes.devId],
        memo: "",
        captcha: "",
        addServices: [],
      });
    });
  }

  /** 我的预约（library.ts getLibraryRoomBookingRecord；begin=今天 end=+6 天） */
  async getLibRoomRecords(userId: string): Promise<LibRoomBookRecord[]> {
    return this.#withLibRoom(userId, async () => {
      const begin = new Date();
      const end = new Date(begin.getTime() + 6 * 86_400_000);
      const fmt = (d: Date): string =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const data = await this.#cabFetch<Array<Record<string, unknown>>>(
        `${urls.LIBROOM_RECORD()}&beginDate=${fmt(begin)}&endDate=${fmt(end)}`,
      );
      return (data ?? []).map((item) => {
        const devInfo = ((item.resvDevInfoList ?? []) as Array<Record<string, unknown>>)[0];
        return {
          uuid: String(item.uuid ?? ""),
          rsvId: Number(item.resvId),
          owner: String(item.resvName ?? ""),
          ownerId: String(item.logonName ?? ""),
          date: String(item.resvDate ?? ""),
          begin: wireDate(item.resvBeginTime),
          end: wireDate(item.resvEndTime),
          devName: String(devInfo?.devName ?? ""),
          kindName: String(devInfo?.kindName ?? ""),
          members: ((item.resvMemberInfoList ?? []) as Array<Record<string, unknown>>).map((m) => ({
            name: String(m.trueName ?? ""),
            userId: String(m.logonName ?? ""),
          })),
        } satisfies LibRoomBookRecord;
      });
    });
  }

  /** 取消预约（library.ts cancelLibraryRoomBooking；POST {uuid}） */
  async cancelLibRoomBooking(userId: string, uuid: string): Promise<void> {
    return this.#withLibRoom(userId, async () => {
      await this.#cabFetch(urls.LIBROOM_CANCEL(), { uuid });
    });
  }

  /** 首次预约前绑定邮箱（library.ts updateLibraryRoomEmail；提交报「填写邮箱地址」时用） */
  async updateLibRoomEmail(userId: string, email: string): Promise<void> {
    return this.#withLibRoom(userId, async () => {
      await this.#cabFetch(urls.LIBROOM_UPDATE_EMAIL(), { email });
    });
  }

  /* ===================================================================== */
  /* thu-info-lib 剩余可运行功能的数据层移植（方法级清单见 info/PORTED.md）：   */
  /* 校园财务三件（发票/银行代发/研究生收入）/ 宿舍卫生 / 体测 / 教学评估 /      */
  /* 教室资源 / 校历（数据+图片）/ 校园网 thos-usereg。                        */
  /* 解析逐字对照 lib；传输层适配 OneTHU HttpClient：业务 yyfw 漫游复用        */
  /* #roamInfoService，校内域名由 HttpClient 动态 WebVPN 包装，learn/app.cs 直连。 */
  /* 错误分类铁律：会话失效 → AuthRequiredError（登录/超时页特征）；             */
  /* 无数据 → 空结果；服务瘫痪/解析失败 → ServiceUnavailableError。             */
  /* ===================================================================== */

  /** 文本响应的登录页特征检测（业务页通用判据，命中即会话失效）。
   *  铁律：只有登录页/门户页才算失登 —— 「time out用户登陆超时或访问内容不存在」
   *  是教务通用错误页（内容不存在/无权限同文案），不是登录页，绝不能映射为
   *  AuthRequiredError（否则本科生查研究生专项目会被误报「登录已过期」）。 */
  #assertNotLoginGate(text: string, what: string): void {
    if (text.includes("<title>清华大学WebVPN</title>")) {
      throw new AuthRequiredError(`${what}：落在 WebVPN 门户页（会话失效）`);
    }
    if (/<title>[^<]*(用户登录|系统登录|电子身份)[^<]*<\/title>/i.test(text)) {
      throw new AuthRequiredError(`${what}：落在登录页（会话失效）`);
    }
  }

  /** 业务服务会话兜底（lib roamingWrapper 同构）：首试（无漫游页）→ 失败则漫游
   *  对应 yyfw 业务（roam 自身失败同样重试一次，lib 同款）→ 带漫游落地页重试。
   *  op 首试收到 undefined；lib 用「s===undefined 即 throw」强制先漫游的方法
   *  （如银行代发，年份选项必须取自漫游落地页）沿用同款判据。 */
  /** 银行代发专用：漫游落地走裸 request()（不经 text() 的引导页检测+重放——
   *  wengine 把 __vpn_* 注入所有被代理页面，短查询页会被误判成 interstitial
   *  重放到 worker 壳页，反而丢掉年份下拉）。 */
  async #serviceRoamedRaw<T>(yyfwid: string, op: (roamPage?: string) => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch {
      let page: string;
      try {
        page = await this.#roamInfoServiceRaw(yyfwid);
      } catch {
        page = await this.#roamInfoServiceRaw(yyfwid);
      }
      return await op(page);
    }
  }

  async #roamInfoServiceRaw(yyfwid: string): Promise<string> {
    await this.#wengineCookieDance();
    const xsrf = await this.#csrfToken();
    const roamText = await this.#http.text(
      `${urls.ROAMING_URL()}?yyfwid=${yyfwid}&_csrf=${encodeURIComponent(xsrf)}&machine=p`,
    );
    const roamingurl = (JSON.parse(roamText) as { object?: { roamingurl?: string } }).object?.roamingurl;
    if (!roamingurl) {
      throw new AuthRequiredError(`漫游 ${yyfwid.slice(0, 8)}… 未返回 roamingurl（resp=${roamText.slice(0, 80)}）`);
    }
    const clean = roamingurl.replace(/&amp;/g, "&");
    const target = /^https?:/i.test(clean)
      ? clean
      : `${urls.INFO_PREFIX}${clean.startsWith("/") ? "" : "/"}${clean}`;
    const res = await this.#http.request(target, { redirect: "follow" });
    const page = await res.text();
    this.#http.debug?.(
      `[BANK] rawLanding final=${String(this.#http.lastTarget || target).slice(0, 110)} len=${page.length} head=${page.replace(/\s+/g, " ").slice(0, 1200)}`,
    );
    return page;
  }

  async #serviceRoamed<T>(yyfwid: string, op: (roamPage?: string) => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch {
      let page: string;
      try {
        ({ page } = await this.#roamInfoService(yyfwid));
      } catch {
        ({ page } = await this.#roamInfoService(yyfwid));
      }
      return await op(page);
    }
  }

  /* ---------------------- 体育场馆预约（sports.ts 移植） ---------------------- */

  /** 表单 POST → JSON（lib uFetch(url, {...}).then(JSON.parse)；非 JSON → 登录门/结构分类） */
  async #sportsJsonPost<T>(url: string, body: URLSearchParams): Promise<T> {
    const text = await this.#http.postForm(url, body);
    try {
      return JSON.parse(text) as T;
    } catch {
      this.#assertNotLoginGate(text, "体育预约");
      throw new ServiceUnavailableError(
        `体育预约响应非 JSON（${text.slice(0, 80).replace(/\s+/g, " ")}）`,
      );
    }
  }

  /** 限额页（lib getSportsResourceLimit）：limitBookCount/limitBookInit */
  async #sportsResourceLimit(
    gymId: string,
    itemId: string,
    date: string,
  ): Promise<{ count: number; init: number }> {
    const html = await this.#http.text(
      `${urls.SPORTS_BASE_URL()}&gymnasium_id=${gymId}&item_id=${itemId}&time_date=${date}`,
    );
    const limit = sports.parseSportsResourceLimit(html);
    if (limit) return limit;
    this.#assertNotLoginGate(html, "体育场馆资源限额");
    throw new ServiceUnavailableError("体育场馆资源限额解析失败（上游结构可能已变）");
  }

  /** 手机号查询（lib getSportsPhoneNumber：明文 "do_not" = 未配置） */
  async #sportsPhoneNumber(): Promise<string | undefined> {
    const msg = await this.#http.text(urls.SPORTS_QUERY_PHONE_URL());
    // 该端点正常返回明文；落到 HTML = 会话异常（登录门 → 失登分类，其余结构报错）
    if (/^<[a-z!?]/i.test(msg)) {
      this.#assertNotLoginGate(msg, "体育预约手机号");
      throw new ServiceUnavailableError("体育预约手机号查询返回异常页面");
    }
    return msg === "do_not" ? undefined : msg;
  }

  /** 资源页（lib getSportsResourceData 四步解析）；空数组 = 无资源（查不到就是查不到） */
  async #sportsResourceData(gymId: string, itemId: string, date: string): Promise<SportsResource[]> {
    const html = await this.#http.text(
      `${urls.SPORTS_DETAIL_URL()}&gymnasium_id=${gymId}&item_id=${itemId}&time_date=${date}`,
    );
    const data = sports.parseSportsResourceData(html);
    if (data.length === 0) this.#assertNotLoginGate(html, "体育场馆资源");
    return data;
  }

  /** 场馆资源/时段（lib getSportsResources 逐字段：限额 + 手机号 + 资源三路并发） */
  async getSportsResources(
    gymId: string,
    itemId: string,
    date: string,
  ): Promise<SportsResourcesInfo> {
    return this.#withRenew(() =>
      this.#serviceRoamed(urls.SPORTS_ROAM_ID, async () => {
        const [limit, phone, data] = await Promise.all([
          this.#sportsResourceLimit(gymId, itemId, date),
          this.#sportsPhoneNumber(),
          this.#sportsResourceData(gymId, itemId, date),
        ]);
        return { count: limit.count, init: limit.init, phone, data };
      }),
    );
  }

  /** 预约验证码（lib getSportsCaptchaUrlMethod 返回 URL；OneTHU 改 core 拉 PNG 转
   *  base64 data URL —— 图必须携 webvpn 会话经 core 取，webview 直挂 URL 只会得到
   *  登录页。usereg getNetworkVerificationImage 同款）。 */
  async getSportsCaptchaUrlMethod(): Promise<string> {
    return this.#withRenew(() =>
      this.#serviceRoamed(urls.SPORTS_ROAM_ID, async () => {
        const url = `${urls.SPORTS_CAPTCHA_BASE_URL()}?${Math.floor(Math.random() * 100)}=`;
        const res = await this.#http.request(url, { redirect: "follow" });
        const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0] ?? "image/jpeg";
        const buf = new Uint8Array(await res.arrayBuffer());
        const head = new TextDecoder().decode(buf.slice(0, 512));
        if (/text\/html/i.test(mime) || /^\s*<(!doctype|html)/i.test(head)) {
          this.#assertNotLoginGate(head, "体育预约验证码");
          throw new ServiceUnavailableError(`体育预约验证码拉取失败（HTTP ${res.status}）`);
        }
        let bin = "";
        for (let i = 0; i < buf.length; i += 0x8000) {
          bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        }
        return `data:${mime};base64,${btoa(bin)}`;
      }),
    );
  }

  /** 支付链（lib makeSportsReservation 后半 + paySportsReservation + generalGetPayCode）：
   *  ① GBK 表单页取 form action + inputs（桌面传输层已转 UTF-8；请求中文按 UTF-8
   *  上送，lib 为 GBK —— 收据抬头仅线上申领发票用）② POST action → id/token
   *  ③ check ④ #payForm + channelId=0101 → webPay ⑤ biz_content → qrCode 支付码 */
  async #sportsPayFlow(formUrl: string, fields: Record<string, string>): Promise<string> {
    const formHtml = await this.#http.postForm(formUrl, new URLSearchParams(fields));
    const action = sports.firstFormAction(formHtml);
    const inputs = sports.formInputs(formHtml);
    if (action === null) {
      this.#assertNotLoginGate(formHtml, "体育预约支付");
      throw new ServiceUnavailableError("体育预约支付表单解析失败（无 form action）");
    }
    const paymentApiHtml = await this.#http.postForm(action, new URLSearchParams(inputs));
    const searchResult = /var id = '(.*)?';\s*?var token = '(.*)?';/.exec(paymentApiHtml);
    const id = searchResult?.[1];
    const token = searchResult?.[2];
    if (searchResult === null || id === undefined || token === undefined) {
      this.#assertNotLoginGate(paymentApiHtml, "体育预约支付");
      throw new ServiceUnavailableError("体育预约支付页缺 id/token（上游结构可能已变）");
    }
    const checkResult = await this.#sportsJsonPost<{ code?: string; message?: string }>(
      urls.SPORTS_PAYMENT_CHECK_URL(),
      new URLSearchParams({ id, token }),
    );
    if (checkResult.code !== "0") {
      throw new Error(`Payment check failed: ${checkResult.message ?? String(checkResult.code ?? "")}`);
    }
    const payForm = sports.formInputs(paymentApiHtml, "payForm");
    payForm.channelId = "0101";
    const webPayHtml = await this.#http.postForm(
      urls.SPORTS_PAYMENT_ACTION_URL(),
      new URLSearchParams(payForm),
    );
    const entry = sports.parsePayEntry(webPayHtml);
    if (entry === null) {
      this.#assertNotLoginGate(webPayHtml, "体育预约支付码");
      throw new ServiceUnavailableError("体育预约支付码页解析失败（缺 form/biz_content）");
    }
    const qrHtml = await this.#http.postForm(
      entry.action,
      new URLSearchParams({ biz_content: entry.bizContent }),
    );
    const code = sports.parsePayQrCode(qrHtml);
    if (code === null) {
      this.#assertNotLoginGate(qrHtml, "体育预约支付码");
      throw new ServiceUnavailableError("体育预约支付码缺失（无 qrCode input）");
    }
    return code;
  }

  /**
   * 预约（lib makeSportsReservation 逐字段）。漫游重试只包**下单段**（失败=未成单，
   * 可安全重跑；lib 不给此函数包 roamingWrapper 正是防支付段失败后重复下单）——
   * 支付段失败直接抛出，绝不重跑下单。
   */
  async makeSportsReservation(
    totalCost: number,
    phone: string,
    receiptTitle: ValidReceiptTitle | undefined,
    gymId: string,
    itemId: string,
    date: string,
    captcha: string,
    resHashId: string,
    skipPayment: boolean,
  ): Promise<string | undefined> {
    return this.#withRenew(async () => {
      await this.#serviceRoamed(urls.SPORTS_ROAM_ID, async () => {
        const orderResult = await this.#sportsJsonPost<{ msg?: string }>(
          urls.SPORTS_MAKE_ORDER_URL(),
          new URLSearchParams({
            "bookData.totalCost": String(totalCost),
            "bookData.book_person_zjh": "",
            "bookData.book_person_name": "",
            "bookData.book_person_phone": phone,
            "bookData.book_mode": "from-phone",
            gymnasium_idForCache: gymId,
            item_idForCache: itemId,
            time_dateForCache: date,
            userTypeNumForCache: "1",
            putongRes: "putongRes",
            code: captcha,
            selectedPayWay: "1",
            allFieldTime: `${resHashId}#${date}`,
          }),
        );
        if (orderResult.msg !== "预定成功") {
          throw new Error(orderResult.msg ?? "预约失败（响应无 msg）");
        }
      });
      if (totalCost === 0) return undefined;
      if (skipPayment) return undefined;
      return this.#sportsPayFlow(urls.SPORTS_MAKE_PAYMENT_URL(), {
        is_jsd: receiptTitle === undefined ? "0" : "1",
        xm: receiptTitle ?? "清华大学",
        gymnasium_idForCache: gymId,
        item_idForCache: itemId,
        time_dateForCache: date,
        userTypeNumForCache: "1",
        allFieldTime: `${resHashId}#${date}`,
      });
    });
  }

  /** 我的预约记录（lib getSportsReservationRecords：未支付表逐行 + 已支付隐藏行拼接） */
  async getSportsReservationRecords(): Promise<SportsReservationRecord[]> {
    return this.#withRenew(() =>
      this.#serviceRoamed(urls.SPORTS_ROAM_ID, async () => {
        const unpaidHtml = await this.#http.text(urls.SPORTS_UNPAID_URL());
        const unpaid = sports.parseSportsUnpaidRecords(unpaidHtml);
        if (unpaid === null) {
          this.#assertNotLoginGate(unpaidHtml, "体育预约记录");
          throw new ServiceUnavailableError("体育预约记录页无表格（上游结构可能已变）");
        }
        const paidHtml = await this.#http.text(urls.SPORTS_PAID_URL());
        return unpaid.concat(sports.parseSportsPaidRecords(paidHtml));
      }),
    );
  }

  /** 稍后支付（lib paySportsReservation；payId 来自记录的 payId 字段） */
  async paySportsReservation(
    payId: string,
    receiptTitle: ValidReceiptTitle | undefined,
  ): Promise<string> {
    return this.#withRenew(() =>
      this.#serviceRoamed(urls.SPORTS_ROAM_ID, () =>
        this.#sportsPayFlow(urls.SPORTS_MAKE_PAYMENT_LATER_URL(), {
          book_ids: payId,
          xm: receiptTitle ?? "清华大学",
        }),
      ),
    );
  }

  /** 退订（lib unsubscribeSportsReservation：POST bookId） */
  async unsubscribeSportsReservation(bookId: string): Promise<void> {
    return this.#withRenew(() =>
      this.#serviceRoamed(urls.SPORTS_ROAM_ID, async () => {
        await this.#http.postForm(
          urls.SPORTS_UNSUBSCRIBE_URL(),
          new URLSearchParams({ bookId }),
        );
      }),
    );
  }

  /** 手机号更新（lib updateSportsPhoneNumber：正则校验 + URL 拼接 cell_phone + gzzh=学号）。
   *  含「找回密码」= 登录页特征 → 失登分类（lib LibError 同判据）。 */
  async updateSportsPhoneNumber(phone: string): Promise<void> {
    if (!/^(1[3-9][0-9]|15[036789]|18[89])\d{8}$/.test(phone)) {
      throw new Error("请正确填写手机号码!");
    }
    return this.#withRenew(() =>
      this.#serviceRoamed(urls.SPORTS_ROAM_ID, async () => {
        const gzzh = this.#idCredentials?.()?.username ?? "";
        const html = await this.#http.postForm(
          `${urls.SPORTS_UPDATE_PHONE_URL()}${phone}&gzzh=${gzzh}`,
          new URLSearchParams(),
        );
        if (html.includes("找回密码")) {
          throw new AuthRequiredError("体育预约手机号更新需重新登录（找回密码页特征）");
        }
      }),
    );
  }

  /* ------------------------------ 教学评估 ------------------------------ */

  /** 评估课程列表（basics.ts getAssessmentList；jxgl /jxpg/f/jxpg/wj/xs/pgkcList）。
   *  返回 [课程名, 是否已评, 评估表单 URL]；非评估期/空列表 → []（UI 显示「暂无」） */
  async getAssessmentList(): Promise<Array<[string, boolean, string]>> {
    return this.#withRenew(() =>
      this.#serviceRoamed(urls.ASSESSMENT_ROAM_ID, async () => {
        const html = await this.#http.text(urls.ASSESSMENT_LIST());
        this.#assertNotLoginGate(html, "教学评估");
        if (html.includes(evaluation.ASSESSMENT_NOT_IN_PERIOD)) return [];
        return evaluation.parseAssessmentList(html, urls.JXGL_PREFIX);
      }),
    );
  }

  /** 评估表单（basics.ts getAssessmentForm；GET 列表项给出的表单 URL） */
  async getAssessmentForm(url: string): Promise<AssessmentForm> {
    const target = /^https?:/i.test(url)
      ? url
      : `${urls.JXGL_PREFIX}${url.startsWith("/") ? "" : "/"}${url}`;
    return this.#withRenew(() =>
      this.#serviceRoamed(urls.ASSESSMENT_ROAM_ID, async () => {
        const html = await this.#http.text(target);
        this.#assertNotLoginGate(html, "教学评估表单");
        return evaluation.parseAssessmentForm(html);
      }),
    );
  }

  /** 提交评估表单（basics.ts postAssessmentForm；POST /jxpg/b/jxpg/pgjg/xs/zancunjs）。
   *  写操作仅在会话失效（AuthRequiredError）时漫游重试一次，避免重复提交；
   *  result!=="success" 抛服务端 msg。 */
  async postAssessmentForm(form: AssessmentForm): Promise<void> {
    return this.#withRenew(async () => {
      const submit = async (): Promise<void> => {
        const text = await this.#http.postForm(
          urls.ASSESSMENT_SUBMIT(),
          evaluation.serializeAssessmentForm(form),
        );
        this.#assertNotLoginGate(text, "教学评估提交");
        const err = evaluation.assessmentSubmitError(text);
        if (err !== null) throw new Error(err);
      };
      try {
        await submit();
      } catch (e) {
        if (!(e instanceof AuthRequiredError)) throw e;
        await this.#roamInfoService(urls.ASSESSMENT_ROAM_ID);
        await submit();
      }
    });
  }

  /* ------------------------------ 体测成绩 ------------------------------ */

  /** 体测成绩（basics.ts getPhysicalExamResult；GET zhjw /tyjx.tyjx_tc_xscjb.do?m=jsonCj
   *  → JSON → 固定 26 行字段映射）。
   *  会话路径：叠加 #ensureZhjw（与课表同款、产线已验证的 zhjw 会话建立）与
   *  lib 的 tyjx 业务漫游（serviceRoamed 兜底），两路都通。
   *  success==="false" → [["状态","暂无可查成绩"]]（lib 原样，UI 显示暂无）；
   *  响应非 JSON：维护页特征 → ServiceUnavailableError；登录/门户 → AuthRequiredError；
   *  其余 HTML（会话/传输异常态，无法证实上游瘫痪）→ 普通 Error 诚实报获取失败。 */
  async getPhysicalExamResult(): Promise<Array<[string, string]>> {
    return this.#withRenew(() =>
      this.#serviceRoamed(urls.PHYSICAL_EXAM_ROAM_ID, async () => {
        await this.#ensureZhjw();
        const text = await this.#http.text(urls.PHYSICAL_EXAM());
        // 实测响应可能为 JSONP 括号包裹 + 单引号非严格 JSON `({'success':'false'})`：
        // parsePhysicalExamJson 剥括号并归一引号（裸 JSON 原样通过）
        let json: Record<string, unknown>;
        try {
          json = fitness.parsePhysicalExamJson(text);
        } catch {
          this.#assertNotLoginGate(text, "体测成绩");
          if (/维护|升级|停机|系统公告/.test(text)) {
            throw new ServiceUnavailableError("体测服务维护中（上游公告维护页）");
          }
          throw new Error(
            `体测成绩响应异常（resp=${text.slice(0, 80).replace(/\s+/g, " ")}）`,
          );
        }
        return fitness.parsePhysicalExamResult(json) ?? [["状态", "暂无可查成绩"]];
      }),
    );
  }

  /* ------------------------------ 教室资源 ------------------------------ */

  /** 教学楼列表（basics.ts getClassroomList；zhjw portal3rd jasJy_Xs_Js_index）。
   *  空列表 → ServiceUnavailableError（lib LibError 语义：查询页结构失效） */
  async getClassroomList(): Promise<Classroom[]> {
    return this.#withRenew(() =>
      this.#serviceRoamed(urls.CLASSROOM_ROAM_ID, async () => {
        const html = await this.#http.text(urls.CLASSROOM_LIST());
        this.#assertNotLoginGate(html, "教室资源");
        const list = classroom.parseClassroomList(html);
        if (list.length === 0) {
          throw new ServiceUnavailableError("教室资源列表为空（上游页面结构变化或服务不可用）");
        }
        return list;
      }),
    );
  }

  /** 教室占用状态（basics.ts getClassroomState；zhjw pk.classroomctrl qyClassroomState；
   *  classroom 参数 GB2312 百分号编码，与 lib arbitraryEncode(s,"gb2312") 一致）。
   *  无数据区（scrollContent 缺失）→ ServiceUnavailableError；结构异常同理。 */
  async getClassroomState(building: string, week: number): Promise<ClassroomStateResult> {
    return this.#withRenew(() =>
      this.#serviceRoamed(urls.CLASSROOM_ROAM_ID, async () => {
        const target = urls.CLASSROOM_STATE(classroom.arbitraryEncodeGb2312(building), week);
        const html = await this.#http.text(target);
        this.#assertNotLoginGate(html, "教室状态");
        // lib：states 为空且页面无 scrollContent → systemMessage/WebVPNTitle/未知异常
        if (!html.includes("scrollContent")) {
          throw new ServiceUnavailableError("教室状态页无数据区（scrollContent 缺失，上游服务异常）");
        }
        this.#http.debug?.(
          `[CLS] state resp len=${html.length} body=${html.replace(/\s+/g, " ").slice(0, 20000)}`,
        );
        try {
          return classroom.parseClassroomState(html, week);
        } catch (e) {
          throw new ServiceUnavailableError(e instanceof Error ? e.message : String(e));
        }
      }),
    );
  }

  /* ------------------------------ 电子发票 ------------------------------ */

  /** 电子发票 dzpj 会话建立（lib roam("default", 625B81A7…) 的 dzpj 特判分支）：
   *  漫游页内 ("ticket").value = '…' 取票 → POST /roam/roamAuth.do {ticket} 兑付。
   *  页内无票（dzpj 会话已在）则直接放行。 */
  async #roamInvoice(): Promise<void> {
    const { page } = await this.#roamInfoService(urls.INVOICE_ROAM_ID);
    const ticket = /\("ticket"\)\.value\s*=\s*'(.+?)';/.exec(page)?.[1];
    if (ticket) {
      await this.#http.postForm(urls.INVOICE_LOGIN(), new URLSearchParams({ ticket }));
    }
  }

  /** 电子发票列表（basics.ts getInvoiceList；dzpj POST getList.do
   *  {page, limit:20, columnName:"inv_date", sort:"desc"}）→ {data,count}。
   *  响应非 JSON：登录/超时特征 → AuthRequiredError，否则 ServiceUnavailableError。 */
  async getInvoiceList(page: number): Promise<InvoicePage> {
    return this.#withRenew(async () => {
      const fetchOnce = async (): Promise<InvoicePage> => {
        const text = await this.#http.postForm(
          urls.INVOICE_LIST(),
          new URLSearchParams({
            page: String(page),
            limit: "20",
            columnName: "inv_date",
            sort: "desc",
          }),
        );
        this.#assertNotLoginGate(text, "电子发票");
        try {
          return finance.parseInvoiceList(JSON.parse(text));
        } catch (e) {
          if (e instanceof AuthRequiredError) throw e;
          throw new ServiceUnavailableError(
            `电子发票列表解析失败（resp=${text.slice(0, 80).replace(/\s+/g, " ")}）`,
          );
        }
      };
      try {
        return await fetchOnce();
      } catch {
        await this.#roamInvoice();
        return await fetchOnce();
      }
    });
  }

  /** 电子发票 PDF（basics.ts getInvoicePDF；dzpj showInvPdf.do?uuid=…）→ base64
   *  （lib uFetch base64 路径等价，无 data: 前缀）。HTML 响应按会话/服务归类报错。 */
  async getInvoicePDF(uuid: string): Promise<string> {
    return this.#withRenew(async () => {
      const fetchOnce = async (): Promise<string> => {
        const res = await this.#http.request(urls.INVOICE_CONTENT(uuid), { redirect: "follow" });
        const ct = res.headers.get("content-type") ?? "";
        const bytes = new Uint8Array(await res.arrayBuffer());
        const head = new TextDecoder().decode(bytes.slice(0, 512));
        if (/text\/html/i.test(ct) || /^\s*<(!doctype|html)/i.test(head)) {
          this.#assertNotLoginGate(head, "电子发票 PDF");
          throw new ServiceUnavailableError(
            `电子发票 PDF 响应异常（HTTP ${res.status} ct=${ct}）`,
          );
        }
        if (!res.ok) {
          throw new ServiceUnavailableError(`电子发票 PDF 拉取失败（HTTP ${res.status}）`);
        }
        return finance.base64FromBytes(bytes);
      };
      try {
        return await fetchOnce();
      } catch {
        await this.#roamInvoice();
        return await fetchOnce();
      }
    });
  }

  /* ------------------------------ 银行代发 ------------------------------ */

  /** 银行代发记录（basics.ts getBankPayment；yhdf search.do）。
   *  foundation=基金会（经建会，独立 yyfw 业务 id C1ADD6B6…）；loadPartial=仅最近
   *  3 个年份（UI 默认 true）。实测漫游链路 roam.jsp?ticket → login.do → 第二次
   *  roam.jsp 后才落查询页，故取年份下拉的顺序：漫游落地页 → 页内跳转一跳
   *  （meta refresh / JS location；302 已由 fetch redirect:follow 等价处理）→
   *  直接 GET search.do 兜底；仅真登录/门户页报 AuthRequired，否则无下拉 → []
   *  （lib options.length===0 语义）。POST：单次 body=`year=<Y>` 同名重复键
   *  （lib 序列化语义），解析照 lib parseAndFilterBankPayment；POST 前写调试日志。 */
  async getBankPayment(foundation = false, loadPartial = false): Promise<BankPaymentByMonth[]> {
    const roamId = foundation ? urls.BANK_FOUNDATION_ROAM_ID : urls.BANK_ROAM_ID;
    const searchUrl = foundation
      ? urls.FOUNDATION_BANK_PAYMENT_SEARCH()
      : urls.BANK_PAYMENT_SEARCH();
    return this.#withRenew(() =>
      this.#serviceRoamedRaw(roamId, async (roamPage) => {
        if (roamPage === undefined) {
          throw new Error("银行代发需要先漫游（lib s===undefined 同款强制漫游判据）");
        }
        const hasOptions = (html: string): boolean => /<option\b[^>]*\bvalue=/.test(html);
        this.#http.debug?.(
          `[BANK] roamPage len=${roamPage.length} hasOptions=${hasOptions(roamPage)} full=${roamPage.replace(/\s+/g, " ").slice(0, 1600)}`,
        );
        let queryPage = roamPage;
        // lib 语义：落地页（漫游链最终 200 响应，通常为 login.do 页）本身就带年份下拉；
        // 仅当无 option 且跳转目标不是 roam.jsp 自环时才跟一跳（跟到 wengine 壳页反而丢内容）。
        if (!hasOptions(queryPage)) {
          const jump = finance.extractPageJump(queryPage);
          if (jump && !/roam\.jsp/i.test(jump)) {
            const base = this.#http.lastTarget || searchUrl;
            queryPage = await this.#http.text(new URL(jump, base).toString());
          }
        }
        if (!hasOptions(queryPage)) {
          queryPage = await this.#http.text(searchUrl);
        }
        this.#assertNotLoginGate(queryPage, "银行代发");
        const options = finance.parseBankYearOptions(queryPage);
        // 壳页兜底（webvpn worker 模式拿不到真页面）：直接构造最近 3 个年份 POST——
        // UI 默认 loadPartial 也只查最近 3 年，行为等价；search.do 接受任意 year 集合。
        const fallbackYears = (() => {
          const y = new Date().getFullYear();
          return [String(y), String(y - 1), String(y - 2)];
        })();
        const years = options.length
          ? (loadPartial ? options.slice(0, Math.min(3, options.length)) : options)
          : fallbackYears;
        const form = new URLSearchParams();
        for (const y of years) form.append("year", y);
        this.#http.debug?.(
          `[BANK] POST search.do years=${years.length} [${years.join(",")}] opts=${options.length} loadPartial=${loadPartial}`,
        );
        const result = await this.#http.postForm(searchUrl, form);
        this.#http.debug?.(
          `[BANK] POST resp len=${result.length} cookies=${this.#http.lastCookieNames} body=${result.replace(/\s+/g, " ").slice(0, 7000)}`,
        );
        return finance.parseBankPayment(result);
      }),
    );
  }

  /* ----------------------------- 研究生收入 ----------------------------- */

  /** 研究生收入（basics.ts getGraduateIncome；zzjl.graduate pageList POST，
   *  begin/end 为 YYYYMMDD）→ 收入记录数组；null=无权限/无数据（本科生常态，
   *  服务端返回错误页/登录页而非 JSON —— UI 显示「研究生专项目」，绝不报失登）。
   *  真·会话失效由漫游路径（serviceRoamed/withRenew）抛 AuthRequiredError，
   *  本方法对 POST 响应不做失登判定；JSON 结构破损才 ServiceUnavailableError。 */
  async getGraduateIncome(begin: string, end: string): Promise<GraduateIncome[] | null> {
    return this.#withRenew(() =>
      this.#serviceRoamed(urls.GRADUATE_INCOME_ROAM_ID, async () => {
        const text = await this.#http.postForm(
          urls.GRADUATE_INCOME(),
          new URLSearchParams({
            ffkssj: begin,
            ffjssj: end,
            _search: "false",
            nd: String(Date.now()),
            rows: "1000",
            page: "1",
            sidx: "id",
            sord: "asc",
          }),
        );
        const trimmed = text.trim();
        if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
          return null; // HTML 错误页/权限页/登录页 → 无权限或无数据（lib 同样直接炸，此处按产品语义归 null）
        }
        try {
          return finance.parseGraduateIncome(text);
        } catch (e) {
          throw new ServiceUnavailableError(e instanceof Error ? e.message : String(e));
        }
      }),
    );
  }

  /* ------------------------------ 宿舍卫生 ------------------------------ */

  /** 宿舍卫生成绩（dorm.ts getDormScore；id roam 0a993de7…/0 → m.myhome
   *  weixin/weixin_health_linechart.aspx?id=0 → 图表图片字节 base64）。
   *  无卫生检查数据（页内无图表元素）→ null（UI 显示「暂无」）；
   *  仅 m.myhome 真登录页（net_Default_LoginCtrl1 登录控件）→ AuthRequiredError；
   *  教务通用错误页/无权限页不算失登——查不到就是查不到，返回 null。 */
  async getDormScore(): Promise<string | null> {
    return this.#withRenew(async () => {
      const fetchOnce = async (): Promise<string | null> => {
        const page = await this.#http.text(urls.HYGIENE_SCORE(), this.#campusInit());
        if (hygiene.hasHygieneLogin(page)) {
          throw new AuthRequiredError("宿舍卫生：m.myhome 会话未建立（落在登录页）");
        }
        const src = hygiene.parseHygieneChartSrc(page);
        if (src === null) return null; // 暂无卫生检查数据
        const imgUrl = /^https?:/i.test(src)
          ? src
          : /^\/(http|https)\//i.test(src)
            ? `https://webvpn.tsinghua.edu.cn${src}` // lib WEB_VPN_ROOT_URL + src
            : new URL(src, urls.HYGIENE_SCORE()).toString();
        const res = await this.#http.request(imgUrl, this.#campusInit());
        if (!res.ok) {
          throw new ServiceUnavailableError(`宿舍卫生图表拉取失败（HTTP ${res.status}）`);
        }
        return finance.base64FromBytes(new Uint8Array(await res.arrayBuffer()));
      };
      try {
        return await fetchOnce();
      } catch {
        // lib roamingWrapper 同构：失败 → roam id 兑付 m.myhome → 重试一次
        await this.#roamIdService(urls.HYGIENE_CAS_FORM());
        return await fetchOnce();
      }
    });
  }

  /* -------------------------------- 校历 -------------------------------- */

  /** 校历数据（basics.ts getCalendar；learn yyfw 漫游 3E401364… → 首页 _csrf →
   *  getCurrentAndNextSemester）。HttpClient 对 learn 域恒直连（网络学堂同会话桶）。
   *  接口异常 → ServiceUnavailableError。 */
  async getSchoolCalendar(): Promise<SchoolCalendarData> {
    return this.#withRenew(() =>
      this.#serviceRoamed(urls.LEARN_CALENDAR_ROAM_ID, async () => {
        const home = await this.#http.text(urls.LEARN_HOME());
        const csrf = /_csrf=([\w-]+)/.exec(home)?.[1];
        if (!csrf) {
          throw new AuthRequiredError("校历：网络学堂会话未建立（首页无 _csrf）");
        }
        const text = await this.#http.text(`${urls.SEMESTER_LIST()}${csrf}`);
        try {
          return schoolCalendar.parseSemesterList(text);
        } catch (e) {
          if (e instanceof AuthRequiredError) throw e;
          throw new ServiceUnavailableError(e instanceof Error ? e.message : String(e));
        }
      }),
    );
  }

  /** 最新校历年（basics.ts getSchoolCalendarYear；app.cs 公网直连 → {year}，
   *  2024 即 2024-2025 学年可用）。失败 → ServiceUnavailableError。 */
  async getCalendarYear(): Promise<number> {
    const text = await this.#http.text(urls.SCHOOL_CALENDAR_YEAR(), { direct: true });
    try {
      return schoolCalendar.parseSchoolCalendarYear(text);
    } catch (e) {
      throw new ServiceUnavailableError(e instanceof Error ? e.message : String(e));
    }
  }

  /** 校历图片地址（basics.ts getCalendarImageUrl；app.cs 公网直连：
   *  https://app.cs.tsinghua.edu.cn/xiaoli/{lang}/{year}-{1|2}.jpg。纯拼接不发请求） */
  getCalendarImageUrl(year: number, semester: "spring" | "autumn", lang: "zh" | "en"): string {
    return schoolCalendar.calendarImageUrl(year, semester, lang);
  }

  /* -------------------------- 校园网 thos/usereg -------------------------- */
  /* 上游服务当前已瘫痪（info app 同坏）：照抄移植；解析失败统一抛
   * ServiceUnavailableError；登录页特征（loginform-verifycode / WebVPN 门户页）
   * 仍按会话失效抛 AuthRequiredError。 */

  /** usereg 会话探针（lib ensureNetworkLoggedIn：GET /login 判定） */
  async #ensureNeth(): Promise<void> {
    const page = await this.#http.text(urls.NETH_LOGIN());
    if (neth.nethLandsWebvpnPortal(page)) {
      throw new AuthRequiredError("校园网：落在 WebVPN 门户页（会话失效）");
    }
    if (neth.nethNeedsVerifyCode(page)) {
      throw new AuthRequiredError(
        "校园网：usereg 需要验证码登录（getNetworkVerificationImageUrl + loginUsereg）",
      );
    }
  }

  /** 刷新并返回验证码地址（lib getNetworkVerificationImageUrl；先 GET ?refresh=1，
   *  再返回 ?_=时间戳 的验证码 URL；调用方需携 usereg 会话 cookie 拉图） */
  async getNetworkVerificationImageUrl(): Promise<string> {
    try {
      await this.#http.text(`${urls.NETH_CAPTCHA()}?refresh=1`);
    } catch (e) {
      if (e instanceof AuthRequiredError) throw e;
      throw new ServiceUnavailableError(
        `校园网验证码刷新失败（${e instanceof Error ? e.message : String(e)}）`,
      );
    }
    return `${urls.NETH_CAPTCHA()}?_=${Date.now()}`;
  }

  /** 拉取验证码图并转 base64 data URL（图必须携 usereg 会话 cookie 经 core 取，
   *  webview 直挂 URL 无会话只会得到登录页）。返回 data:image/...;base64,... */
  async getNetworkVerificationImage(): Promise<string> {
    await this.getNetworkVerificationImageUrl();
    const res = await this.#http.request(urls.NETH_CAPTCHA(), { redirect: "follow" });
    const mime = res.headers.get("content-type") ?? "image/jpeg";
    const buf = new Uint8Array(await res.arrayBuffer());
    this.#http.debug?.(
      `[NETH] captcha mime=${mime} bytes=${buf.length} head=${[...buf.subarray(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join(" ")}`,
    );
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) {
      bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    }
    return `data:${mime.split(";")[0]};base64,${btoa(bin)}`;
  }

  /** 上网账号登录（lib loginUsereg；验证码 + RSA 加密密码两段 POST：
   *  ① POST /site/validate-user（X-CSRF-Token + XHR 头）② POST /login 表单）。
   *  密码取内存凭据（CampusSession.setIdCredentials）；RSA 为 neth.ts 自实现
   *  PKCS#1 v1.5（等价 lib jsencrypt）。 */
  async loginUsereg(code: string): Promise<void> {
    const loginHtml = await this.#http.text(urls.NETH_LOGIN());
    if (neth.nethLandsWebvpnPortal(loginHtml)) {
      throw new AuthRequiredError("校园网登录：落在 WebVPN 门户页（会话失效）");
    }
    const csrfToken = neth.parseNethCsrfMeta(loginHtml);
    if (!csrfToken) {
      throw new ServiceUnavailableError("校园网登录页无 csrf-token（上游页面结构变化或服务瘫痪）");
    }
    const pub = neth.parseNethPublicKey(loginHtml);
    if (!pub) {
      throw new ServiceUnavailableError("校园网登录页无 RSA 公钥（上游页面结构变化或服务瘫痪）");
    }
    const creds = this.#idCredentials?.();
    if (!creds?.password) {
      throw new Error("校园网登录需要密码（内存中无凭据，请重新登录后再试）");
    }
    const password = neth.rsaEncryptPkcs1v15(pub, creds.password);
    const user = await this.getUserInfo().catch(() => null);
    // usereg 用户名=邮箱前缀（学号登录 INFO 时邮箱在个人信息/Coremail 里，
    // 前缀即 usereg 账号；学号本身 usereg 不收——用户实测 2025013332 被拒）
    let emailName = user?.email?.split("@")[0] ?? "";
    let nameSource = "userinfo.email";
    if (!emailName) {
      emailName = (await this.#huntEmail().catch(() => null))?.split("@")[0] ?? "";
      nameSource = "coremail.hunt";
    }
    if (!emailName) {
      emailName = user?.studentId ?? creds.username;
      nameSource = "fallback.id";
    }
    this.#http.debug?.(
      `[NETH] login user=${emailName} src=${nameSource} pubLen=${pub.length} pubHead=${pub.slice(0, 40)} pubTail=${pub.slice(-40)} encLen=${password.length} codeLen=${code.length}`,
    );
    // 段一：账密+验证码校验（lib fetch validate-user 原样字段集）
    const validateText = await this.#http
      .request(urls.NETH_VALIDATE_USER(), {
        method: "POST",
        headers: {
          "X-CSRF-Token": csrfToken,
          "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        body: new URLSearchParams({
          "LoginForm[username]": emailName,
          "LoginForm[password]": password,
          "LoginForm[verifyCode]": code,
        }),
      })
      .then((r) => r.text());
    this.#http.debug?.(
      `[NETH] validate resp=${validateText.slice(0, 200).replace(/\s+/g, " ")}`,
    );
    let result: { success?: unknown; message?: unknown };
    try {
      result = JSON.parse(validateText) as typeof result;
    } catch {
      throw new ServiceUnavailableError(
        `校园网认证接口响应异常（resp=${validateText.slice(0, 80).replace(/\s+/g, " ")}）`,
      );
    }
    if (result.success !== true) {
      throw new Error(
        typeof result.message === "string" && result.message ? result.message : "校园网登录失败",
      );
    }
    // 段二：登录表单提交（lib 同款 _csrf-8800 + LoginForm 字段集）
    const csrf8800 = neth.parseNethCsrf8800(loginHtml);
    if (!csrf8800) {
      throw new ServiceUnavailableError("校园网登录页无 _csrf-8800（上游页面结构变化或服务瘫痪）");
    }
    await this.#http.postForm(
      urls.NETH_LOGIN(),
      new URLSearchParams({
        "_csrf-8800": csrf8800,
        "LoginForm[username]": emailName,
        "LoginForm[password]": password,
        "LoginForm[smsCode]": "",
        "LoginForm[verifyCode]": code,
      }),
    );
  }

  /** 在线设备列表（lib getOnlineDevices；GET /home → #w1-container 表 tr[data-key]）。
   *  无设备 → []；页面 w1/w3 区块均缺失 → ServiceUnavailableError（上游瘫痪） */
  async getOnlineDevices(): Promise<NetworkDevice[]> {
    await this.#ensureNeth();
    const home = await this.#http.text(urls.NETH_HOME());
    if (!neth.nethHomeLooksAlive(home)) {
      throw new ServiceUnavailableError(
        `校园网主页解析失败（resp=${home.slice(0, 80).replace(/\s+/g, " ")}）`,
      );
    }
    return neth.parseOnlineDevices(home);
  }

  /** 上网余额/流量（lib getNetworkBalance；GET /home → #w3-container 首行五列）。
   *  区块缺失 → ServiceUnavailableError（上游瘫痪）。 */
  async getNetworkBalance(): Promise<NetworkBalance> {
    await this.#ensureNeth();
    const home = await this.#http.text(urls.NETH_HOME());
    try {
      return neth.parseNetworkBalance(home);
    } catch (e) {
      throw new ServiceUnavailableError(e instanceof Error ? e.message : String(e));
    }
  }

  /** 终端连接数当前值（GET /user/online-num） */
  async getNetworkDeviceCount(): Promise<number> {
    await this.#ensureNeth();
    const page = await this.#http.text(urls.NETH_ONLINE_NUM());
    this.#assertNotLoginGate(page, "终端连接数");
    return neth.parseOnlineNum(page);
  }

  /** 修改终端连接数（POST /user/online-num；表单=_csrf-8800+OnlineNumForm[max_online_num]，
   *  user_name 为 disabled 不入提交体——示例页实证） */
  async setNetworkDeviceCount(n: number): Promise<void> {
    await this.#ensureNeth();
    const page = await this.#http.text(urls.NETH_ONLINE_NUM());
    const csrf = neth.parseOnlineNumCsrf(page);
    if (!csrf) throw new ServiceUnavailableError("终端连接数页无 _csrf-8800（结构变化）");
    const resp = await this.#http
      .request(urls.NETH_ONLINE_NUM(), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ "_csrf-8800": csrf, "OnlineNumForm[max_online_num]": String(n) }),
      })
      .then((r) => r.text());
    if (neth.nethNeedsVerifyCode(resp) || /class=["']help-block-error["'][^>]*>\s*[^<\s]/.test(resp)) {
      throw new Error("终端连接数修改被拒（可能超出允许范围或会话失效）");
    }
  }

  /** 修改 Tsinghua-Secure 密码（POST /user/change-password；_csrf-8800+新密码×2）。
   *  规则：8~19 位，字母+数字+特殊字符(!@#$%^*().~)至少两种，不得与用户名相同 */
  async changeNetworkPassword(newPassword: string): Promise<void> {
    await this.#ensureNeth();
    const page = await this.#http.text(urls.NETH_CHGPWD());
    const csrf = neth.parseChgpwdCsrf(page);
    if (!csrf) throw new ServiceUnavailableError("改密码页无 _csrf-8800（结构变化）");
    const resp = await this.#http
      .request(urls.NETH_CHGPWD(), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          "_csrf-8800": csrf,
          "PasswordResetForm[newPassword]": newPassword,
          "PasswordResetForm[newPassword2]": newPassword,
        }),
      })
      .then((r) => r.text());
    if (neth.nethNeedsVerifyCode(resp) || /class=["']help-block-error["'][^>]*>\s*[^<\s]/.test(resp)) {
      throw new Error("密码修改被拒（检查格式：8~19位，字母+数字+特殊字符两种，勿与用户名相同）");
    }
  }

  /** 上网账号资料（lib getNetworkAccountInfo；GET /home + /users + /user/online-num
   *  三页拼合：#w0 表 td 0/1/2/3/5/6/7 + 状态链接 + 可认证设备数） */
  async getNetworkAccountInfo(): Promise<NetworkAccountInfo> {
    await this.#ensureNeth();
    const home = await this.#http.text(urls.NETH_HOME());
    const users = await this.#http.text(urls.NETH_USER_INFO());
    const onlineNum = await this.#http.text(urls.NETH_ALLOWED_DEVICES());
    return {
      ...neth.parseNethAccountInfo(users),
      status: neth.parseNethStatus(home),
      allowedDevices: neth.parseNethAllowedDevices(onlineNum),
    };
  }

  /** 设备下线（lib logoutNetwork；POST /home/delete?id=…&user_mac=… + _csrf-8800；
   *  响应含 w5-success-0 即成功，否则抛 #w5-danger-0 文案） */
  async logoutNetwork(device: NetworkDevice): Promise<void> {
    await this.#ensureNeth();
    const home = await this.#http.text(urls.NETH_HOME());
    const csrf = neth.parseNethCsrf8800(home);
    if (!csrf) {
      throw new ServiceUnavailableError("校园网主页无 _csrf-8800（上游页面结构变化或服务瘫痪）");
    }
    const resp = await this.#http.postForm(
      urls.NETH_HOME_DELETE(device.key, device.mac),
      new URLSearchParams({ "_csrf-8800": csrf }),
    );
    if (!resp.includes("w5-success-0")) {
      const r = neth.parseNethActionResult(resp, "w5");
      throw new Error(r?.message || "校园网设备下线失败");
    }
  }

  /* ==================== 学生宿舍公共空间（共享家园网 kongjian） ==================== */

  /** 公共空间整页：自动过 agreement 协议；spaceId 给定则走 WebForms 回传链取房间/日期/场次 */
  async kongjianPage(opts: { spaceId?: string; roomId?: string; date?: string } = {}): Promise<kj.KongjianPage> {
    // 与电费/卫生同款 withRenew：冷启动 CAS 票据未就绪时抛 AuthRequiredError →
    // 全量重登录后重试一次。此前裸调用，冷启首开公共空间近乎必红（先开电费
    // 会顺带焐热会话才显得"玄学"）。
    return this.#withRenew(async () => {
    let page = await this.#dormPage(
      () => this.#http.text(kj.KJ_YUYUE()),
      // ⚠ hasKongjianLogin 语义是「会话存活」而非「落在登录页」——此处必须取反（a25c5ab 极性反转事故）
      (p) => !kj.hasKongjianLogin(p),
      "公共空间预约页",
    );
    // 兜底 A：偶发落到「空间管理系统」门户页（无 RadioButtonList1）——从门户里找回
    // kj_yuyue.aspx 直链跟进，找回失败再原地址 ?xieyi=1 重试一次
    if (!page.includes("RadioButtonList1") && /空间管理系统|kj_index/.test(page)) {
      const link = /href="([^"]*kj_yuyue\.aspx[^"]*)"/.exec(page)?.[1];
      if (link) {
        const abs = link.startsWith("http") ? link : `${kj.KJ_PREFIX}/${link.replace(/^\.\//, "")}`;
        page = await this.#http.text(abs);
      }
      if (!page.includes("RadioButtonList1")) {
        page = await this.#http.text(`${kj.KJ_YUYUE()}?xieyi=1`);
      }
    }
    if (page.includes("RadioButtonList1") && !page.includes("agreement.aspx")) {
      // 已在预约页
    } else if (/agreement\.aspx/i.test(page) || /kj_yuyue\.aspx\?xieyi=1/.test(page) === false) {
      const agree = kj.parseWebForms(page);
      const btn = /<input[^>]*type="submit"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/.exec(page)
        ?? /<input[^>]*name="([^"]+)"[^>]*type="submit"[^>]*value="([^"]*)"/.exec(page);
      if (btn && !btn[1]!.includes("btnOK")) {
        const body = new URLSearchParams();
        for (const [k, v] of Object.entries(agree.fields)) body.set(k, v);
        // ASP.NET 只按 name 识别回传按钮；value 若含中文（"同意"）必须按 GBK 百分号编码，
        // 而 JS 无法原生编码 GBK —— 置空值绕开整个编码问题（实测服务器只认 name）
        body.set(btn[1]!, "");
        const action = agree.action ?? kj.KJ_AGREEMENT();
        const target = action.startsWith("http") ? action : `${kj.KJ_PREFIX}/${action.replace(/^\.\//, "")}`;
        await this.#http.request(target, {
          method: "POST",
          body,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          redirect: "follow",
        });
        page = await this.#http.text(`${kj.KJ_YUYUE()}?xieyi=1`);
      }
    }
    let parsed = kj.parseKongjianPage(page);
    if (!opts.spaceId) return parsed;
    const action = parsed.formAction?.startsWith("http")
      ? parsed.formAction
      : `${kj.KJ_PREFIX}/${(parsed.formAction ?? "kj_yuyue.aspx").replace(/^\.\//, "")}${parsed.formAction?.includes("?") ? "" : "?xieyi=1"}`;
    // ① 选空间
    const post1 = kj.buildPostBack(parsed, "kj_yuyueCtrl1$RadioButtonList1", {
      "kj_yuyueCtrl1$RadioButtonList1": opts.spaceId,
    });
    let page2 = await (
      await this.#http.request(action, {
        method: "POST",
        body: post1,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      })
    ).text();
    parsed = kj.parseKongjianPage(page2);
    // ② 选房间（给定或默认第一个）
    const roomId = opts.roomId ?? parsed.rooms[0]?.id;
    if (roomId && parsed.rooms.some((r) => r.id === roomId)) {
      const post2 = kj.buildPostBack(parsed, "kj_yuyueCtrl1$RadioButtonList2", {
        "kj_yuyueCtrl1$RadioButtonList2": roomId,
      });
      let page3 = await (
        await this.#http.request(action, {
          method: "POST",
          body: post2,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        })
      ).text();
      parsed = kj.parseKongjianPage(page3);
    }
    // ③ 选日期（给定或默认第一天；回传目标带 $索引）
    const date = opts.date ?? parsed.dates[0];
    if (date) {
      const idx = parsed.dates.indexOf(date);
      const target = `kj_yuyueCtrl1$RadioButtonList3$${Math.max(idx, 0)}`;
      const post3 = kj.buildPostBack(parsed, target, {
        "kj_yuyueCtrl1$RadioButtonList3": date,
      });
      const page4 = await (
        await this.#http.request(action, {
          method: "POST",
          body: post3,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        })
      ).text();
      parsed = kj.parseKongjianPage(page4);
    }
    return parsed;
    });
  }

  /** 公共空间：提交确认页（姓名/学号/电话/用途；bookUrl 为场次行里原样链接） */
  async kongjianBook(
    bookUrl: string,
    info: { name: string; sid: string; tel: string; other: string },
  ): Promise<string> {
    return this.#withRenew(async () => {
    const page = await this.#dormPage(
      () => this.#http.text(bookUrl),
      (p) => !kj.hasKongjianLogin(p),
      "公共空间预约确认页",
    );
    const form = kj.parseWebForms(page);
    const pre = kj.parseKongjianConfirmValues(page); // 服务端预填值
    const fields: Record<string, string> = { ...form.fields };
    const setIf = (suffix: string, v: string) => {
      if (!v) return;
      for (const k of Object.keys(fields)) if (k.endsWith(suffix)) fields[k] = v;
    };
    setIf("$txtname", info.name || pre.name);
    setIf("$txtid", info.sid || pre.sid);
    setIf("$txttel", info.tel || pre.tel);
    setIf("$txtother", info.other);
    const body = new URLSearchParams(fields);
    for (const k of Object.keys(form.fields)) {
      if (k.endsWith("$rbtnOK")) body.set(k, "rbtnOK");
    }
    // 确定预约按钮（btnOK）
    const okBtn = /<input[^>]*type="submit"[^>]*name="([^"]*btnOK[^"]*)"[^>]*value="([^"]*)"/.exec(page)
      ?? /<input[^>]*name="([^"]*btnOK[^"]*)"[^>]*type="submit"[^>]*value="([^"]*)"/.exec(page);
    if (okBtn) body.set(okBtn[1]!, okBtn[2]!);
    const action = form.action ?? bookUrl;
    const target = action.startsWith("http") ? action : `${kj.KJ_PREFIX}/${action.replace(/^\.\//, "")}`;
    const resp = await this.#http.request(target, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      redirect: "follow",
    });
    const done = await resp.text();
    if (/预约成功|已成功预约/.test(done)) return "预约成功";
    const err = /alert\(['"]([^'"]{2,80})['"]\)/.exec(done)?.[1];
    if (err) throw new Error(err);
    if (/kj_yuyue_my\.aspx/.test(done) || resp.url.includes("kj_yuyue")) return "已提交（请到「我的预约」核对）";
    throw new Error("公共空间预约提交失败（页面无成功标识）");
    });
  }

  /** 公共空间：我的预约列表 */
  async kongjianMy(): Promise<kj.KongjianRecord[]> {
    return this.#withRenew(async () => {
    const page = await this.#dormPage(
      () => this.#http.text(kj.KJ_MY()),
      (p) => !kj.hasKongjianLogin(p),
      "公共空间我的预约",
    );
    return kj.parseKongjianMy(page);
    });
  }

  /** 公共空间：取消预约（我的预约页 __doPostBack 目标） */
  async kongjianCancel(cancelTarget: string): Promise<void> {
    return this.#withRenew(async () => {
    const page = await this.#dormPage(
      () => this.#http.text(kj.KJ_MY()),
      (p) => !kj.hasKongjianLogin(p),
      "公共空间取消预约",
    );
    const wf = kj.parseWebForms(page);
    const body = new URLSearchParams();
    body.set("__EVENTTARGET", cancelTarget);
    body.set("__EVENTARGUMENT", "");
    for (const [k, v] of Object.entries(wf.fields)) {
      if (k === "__EVENTTARGET" || k === "__EVENTARGUMENT") continue;
      body.set(k, v);
    }
    await this.#http.request(kj.KJ_MY(), {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    });
  }

  /** 导入/认证设备（lib loginNetwork；POST /certification
   *  CertificationForm[ip]/[password]（明文，lib 原样）/[type]（out=校外,in=校内）。
   *  成功返回服务端提示文案；w0-error-0 文案或 Unknown error 抛普通 Error。 */
  async loginNetwork(ip: string, internet: boolean): Promise<string> {
    await this.#ensureNeth();
    const page = await this.#http.text(urls.NETH_IMPORT_DEVICE());
    const csrf = neth.parseNethCsrf8800(page);
    if (!csrf) {
      throw new ServiceUnavailableError("校园网认证页无 _csrf-8800（上游页面结构变化或服务瘫痪）");
    }
    const creds = this.#idCredentials?.();
    if (!creds?.password) {
      throw new Error("校园网认证需要密码（内存中无凭据，请重新登录后再试）");
    }
    const resp = await this.#http.postForm(
      urls.NETH_IMPORT_DEVICE(),
      new URLSearchParams({
        "_csrf-8800": csrf,
        "CertificationForm[ip]": ip,
        "CertificationForm[password]": creds.password,
        "CertificationForm[type]": internet ? "out" : "in",
      }),
    );
    const r = neth.parseNethActionResult(resp, "w0");
    if (r === null) throw new Error("Unknown error.");
    if (!r.ok) throw new Error(r.message || "校园网设备认证失败");
    return r.message;
  }
}
