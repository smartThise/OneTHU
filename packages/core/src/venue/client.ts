/**
 * 体育场馆系统（unifound-venue）API 客户端 —— 独立于 info/learn 会话：
 * - 鉴权：token 请求头（CAS SSO 换发的 JWT，5h），无 cookie 依赖；桌面端经
 *   open_sports_window 授权窗口取得后注入（setToken）。
 * - 签名：venueSignQuery 每请求生成（见 sign.ts，抓包逐字验证）。
 * - 端点/参数/字段对齐 2026-08-31 抓包（网络服务示例/sports_venue_crawl/）。
 *
 * 错误约定（与 info 侧铁律同源）：
 * - HTTP/网络错误：原样上抛（调用方归 ServiceUnavailable）
 * - errorCode 1130002（登录过期）→ 清 token + VenueAuthRequiredError（绝不自动刷新循环）
 * - 业务错误 → VenueApiError（message 透传服务端原文，code 保留）
 * - 空数据不是错误：data 为 null/[] 原样返回
 */
import type { FetchLike } from "../http.js";
import { venueSignQuery } from "./sign.js";
import type { VenueBuilding, VenueDevKind, VenueRecord, VenueSameLevel, VenueScene, VenueSession, VenueSite, VenueUser } from "./types.js";

export class VenueAuthRequiredError extends Error {
  constructor(message = "体育系统登录已过期，请重新授权") {
    super(message);
    this.name = "VenueAuthRequiredError";
  }
}

export class VenueApiError extends Error {
  code: number | string;
  constructor(message: string, code: number | string) {
    super(message);
    this.name = "VenueApiError";
    this.code = code;
  }
}

export const VENUE_BASE = "https://www.sports.tsinghua.edu.cn/venue/site";

/** 20260901 → "2026-09-01"（sessionVo beginDate/endDate 数字日期） */
export function fmtVenueDate(d: number | string): string {
  const s = String(d);
  if (s.length !== 8) return s;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** JWT exp（秒）→ 毫秒；解析失败 null */
export function venueTokenExpiresAt(jwt: string): number | null {
  const parts = jwt.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const pad = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
    const payload = JSON.parse(json) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export interface VenueCurrentPageParams {
  sceneUuid: string;
  reserveDate: string; // YYYY-MM-DD
  classTypeUuid?: string; // 楼栋 uuid（chooseBuildings 取；空串会筛空全场）
  devKindUuid?: string; // 设备/场地类型 uuid（devKinds 取，如"全场/羽毛球/半场"）
  classTypeEnum?: "BUILDING" | "ROOM"; // 楼/房形态（SPA：有房间默认 ROOM）
  sceneUseType?: string; // 清华校内人员固定 "SPORT_PERSON"
  siteType?: string; // 场景 relatedType（默认 DEV）
}

export interface VenueAddReserveArgs {
  sceneUuid: string;
  siteUuid: string;
  siteType: string;
  sceneUseType?: string;
  session: VenueSession; // 选中场次（sessionVo 元素）
  reserveDate: string; // 场次日期 YYYY-MM-DD
  resvMember: string[]; // 用户 id 列表（含本人）
  needForm?: boolean; // formRuleVo 存在时由 UI 拦截，这里兜底
}

export class VenueClient {
  #token: string | null = null;
  #fetch: FetchLike;
  #log?: (line: string) => void;

  constructor(opts: { fetch: FetchLike; log?: (line: string) => void }) {
    this.#fetch = opts.fetch;
    this.#log = opts.log;
  }

  setToken(token: string | null): void {
    this.#token = token && token.length > 20 ? token : null;
  }

  get hasToken(): boolean {
    return this.#token !== null;
  }

  async #request<T = unknown>(
    method: "GET" | "POST",
    path: string,
    opts: { query?: string; json?: unknown } = {},
  ): Promise<T> {
    const qs = venueSignQuery() + (opts.query ? `&${opts.query}` : "");
    const url = `${VENUE_BASE}${path}?${qs}`;
    // axios 拦截器同款版本头：缺了它 /api/site/** 直接 Tomcat 404、current/page 静默空列表
    const headers: Record<string, string> = { "Language-Set": "CN", "x-api-version": "2.0.0" };
    if (this.#token) headers.token = this.#token;
    let body: string | undefined;
    if (opts.json !== undefined) {
      body = JSON.stringify(opts.json);
      headers["Content-Type"] = "application/json";
    }
    this.#log?.(`[VENUE] ${method} ${path}${opts.query ? ` ${opts.query.slice(0, 80)}` : ""}`);
    const res = await this.#fetch(url, { method, headers, body });
    const text = await res.text();
    if (!res.ok) this.#log?.(`[VENUE-ERR] ${res.status} ${method} ${path} ${text.slice(0, 200).replace(/\s+/g, " ")}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new VenueApiError(`体育系统返回异常（HTTP ${res.status}）`, res.status);
    }
    if (parsed && typeof parsed === "object" && "code" in (parsed as Record<string, unknown>)) {
      const env = parsed as { code: number; message?: string; success?: boolean; data?: unknown; errorCode?: number };
      if (env.code === 0 || env.success === true) return env.data as T;
      if (env.errorCode === 1130002 || /登录过期/.test(env.message ?? "")) {
        this.#token = null;
        throw new VenueAuthRequiredError();
      }
      throw new VenueApiError(env.message ?? `体育系统错误（${env.errorCode ?? env.code}）`, env.errorCode ?? env.code);
    }
    throw new VenueApiError(`体育系统返回异常（HTTP ${res.status}）`, res.status);
  }

  /**
   * 统一凭证静默换票（复用 OneTHU 已登录的 CAS 会话，零交互）：
   * ① GET /cas/address?redirectUrl=…（返回 CAS 跳转地址）
   * ② GET 该地址 → 重定向链携带 jar 里的 id.tsinghua CAS 会话（TGT）→
   *    最终落点带 ?uniToken=…（tauriFetch 逐跳跟链 + x-onethu-final-url）
   * ③ POST /cas/token {platForm:"CAS", client:"PC", token: uniToken} → JWT
   * 失败（TGT 缺失/失效）→ VenueAuthRequiredError，调用方退回授权窗口兜底。
   */
  async ssoLogin(redirectUrl = "https://www.sports.tsinghua.edu.cn/venue/index.html"): Promise<string> {
    const casUrl = await this.casAddress(redirectUrl);
    this.#log?.(`[VENUE-SSO] casUrl=${casUrl.slice(0, 160)}`);
    const res = await this.#fetch(casUrl, { method: "GET", headers: { "User-Agent": "Mozilla/5.0 OneTHU" } });
    const finalUrl = res.headers.get("x-onethu-final-url") ?? res.url ?? "";
    const body = await res.text();
    const pick = (src: string): string | null =>
      /[?&]uniToken=([^&\s"'<>]+)/.exec(src)?.[1] ?? null;
    const uni = pick(finalUrl) ?? pick(body);
    if (!uni) {
      this.#log?.(`[VENUE-SSO] 链尾无 uniToken final=${finalUrl.slice(0, 200)}`);
      throw new VenueAuthRequiredError("统一身份认证未返回票据（CAS 会话可能已失效）");
    }
    return this.exchangeUniToken(decodeURIComponent(uni));
  }

  /** uniToken → 体育系统 JWT（POST /cas/token，SPA 同参 platForm:"CAS"） */
  async exchangeUniToken(uniToken: string): Promise<string> {
    const data = await this.#request<{ token?: string }>("POST", "/cas/token", {
      json: { platForm: "CAS", client: "PC", token: uniToken },
    });
    if (!data?.token) {
      throw new VenueAuthRequiredError("体育系统未签发登录凭证");
    }
    this.#token = data.token;
    return data.token;
  }

  /** CAS 跳转地址（统一认证入口；redirectUrl=回跳页） */
  async casAddress(redirectUrl: string): Promise<string> {
    const data = await this.#request<string>("GET", "/cas/address", {
      query: `redirectUrl=${encodeURIComponent(redirectUrl)}&queryParam=${encodeURIComponent(redirectUrl)}`,
    });
    if (!data || typeof data !== "string") {
      throw new VenueAuthRequiredError("体育系统未返回统一认证地址");
    }
    return data;
  }

  /** 场馆目录（33 个；公开接口，有 token 更稳） */
  async sceneList(): Promise<VenueScene[]> {
    const data = await this.#request<VenueScene[]>("GET", "/api/site/scene/list");
    return Array.isArray(data) ? data : [];
  }

  /** 场馆详情 */
  async sceneDetail(uuid: string): Promise<VenueScene | null> {
    return this.#request<VenueScene | null>("GET", "/api/site/scene/detail", { query: `uuid=${uuid}` });
  }

  /** 场地+场次（预约页核心；sessionVo 内嵌时段/余量/价格；无场次时 data 可能为 null） */
  async currentPage(p: VenueCurrentPageParams): Promise<VenueSite[]> {
    const data = await this.#request<VenueSite[] | null>("POST", "/api/reserve/current/page", {
      json: {
        sceneUuid: p.sceneUuid,
        resvKind: "CURRENT_RESERVE",
        devKindUuid: p.devKindUuid ?? "",
        siteType: p.siteType ?? "DEV",
        searchValue: "",
        siteKindId: "",
        classTypeEnum: p.classTypeEnum ?? "BUILDING",
        classTypeUuid: p.classTypeUuid ?? "",
        reserveDate: p.reserveDate,
        sceneUseType: p.sceneUseType ?? "SPORT_PERSON",
        pageSize: 999,
        pageNum: 1,
      },
    });
    this.#log?.(
      `[VENUE-PAGE] scene=${p.sceneUuid.slice(0, 8)} date=${p.reserveDate} bld=${(p.classTypeUuid ?? "").slice(0, 8)} st=${p.siteType ?? "DEV"} -> ${JSON.stringify(data)?.slice(0, 260)}`,
    );
    return Array.isArray(data) ? data : [];
  }

  /** 楼栋列表（SPA 同参：current/page 的 classTypeUuid 必须是楼栋 uuid，空串会筛空全场） */
  async chooseBuildings(sceneUuid: string): Promise<VenueBuilding[]> {
    const data = await this.#request<VenueBuilding[] | null>("GET", "/api/site/chooseByType", {
      query: `sceneUuid=${encodeURIComponent(sceneUuid)}&siteType=BUILDING`,
    });
    return Array.isArray(data) ? data : [];
  }

  /** 设备/场地类型（SPA 同参：current/page 的 devKindUuid 必须来自这里） */
  async devKinds(sceneUuid: string): Promise<VenueDevKind[]> {
    const data = await this.#request<VenueDevKind[] | null>("GET", "/api/site/devKind/list", {
      query: `uuid=${encodeURIComponent(sceneUuid)}`,
    });
    return Array.isArray(data) ? data : [];
  }

  /** 同类型兄弟场景（含真实 sceneUseType 位掩码——current/page 的 sceneUseType 必须按它过滤） */
  async sameLevel(sceneUuid: string): Promise<VenueSameLevel | null> {
    return this.#request<VenueSameLevel | null>("GET", "/api/site/scene/sameLevel", {
      query: `uuid=${encodeURIComponent(sceneUuid)}`,
    });
  }

  /** 楼内房间（ROOM 形态：羽毛球场等；二段查询——先 BUILDING 取 siteUuid，再 ROOM） */
  async chooseRooms(siteUuid: string, sceneUuid: string): Promise<VenueBuilding[]> {
    const data = await this.#request<VenueBuilding[] | null>("GET", "/api/site/chooseByType", {
      query: `siteUuid=${encodeURIComponent(siteUuid)}&sceneUuid=${encodeURIComponent(sceneUuid)}&siteType=ROOM`,
    });
    return Array.isArray(data) ? data : [];
  }

  /** 场馆系统登录用户（resvMember 用 id） */
  async getLoginUser(): Promise<VenueUser | null> {
    return this.#request<VenueUser | null>("GET", "/system/login/getLoginUser");
  }

  /** 我的预约记录（POST 分页；空数据 → []） */
  async myRecords(pageNum = 1, pageSize = 10): Promise<VenueRecord[]> {
    const data = await this.#request<VenueRecord[] | null>("POST", "/api/reserve/reserveRecord", {
      json: {
        pageSize,
        pageNum,
        resvCheckStatus: "",
        resvStatus: "",
        resvExtendStatus: "",
        containsActivity: false,
      },
    });
    return Array.isArray(data) ? data : [];
  }

  /** 退订/取消预约 */
  async cancelReserve(resvUuid: string): Promise<void> {
    await this.#request("POST", "/api/reserve/cancelReserve", { json: { resvUuid } });
  }

  /** 提交预约（支付流不接：不带 payType/purchaseUuid；付费场次由 UI 提示网页端支付） */
  async addReserve(args: VenueAddReserveArgs): Promise<unknown> {
    if (args.needForm) {
      throw new VenueApiError("该场次需填写申请表单，请在网页端提交", 401000316);
    }
    const s = args.session;
    const start = `${args.reserveDate} ${s.beginTime}:00`;
    const end = `${fmtVenueDate(s.endDate)} ${s.endTime}:00`;
    return this.#request("POST", "/api/reserve/addReserve", {
      json: {
        sceneUuid: args.sceneUuid,
        sceneUseType: s.sceneUseType ?? args.sceneUseType ?? "SPORT_PERSON",
        siteUuid: args.siteUuid,
        siteType: args.siteType,
        reserveTime: [{ sessionDetailUuid: s.uuid, reserveTime: { startTime: start, endTime: end } }],
        siteSessionReserve: [],
        resvMember: args.resvMember,
        resvKind: "CURRENT_RESERVE",
      },
    });
  }
}
