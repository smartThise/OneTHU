/**
 * 临时来访人员报备（清华「行在清华」小程序 → visit.tsinghua.edu.cn/visitor/mobile 网页版）。
 *
 * 来源与配方（2026-10-15 REA，见 scripts/visit-probe.mts / visit-flow.mts / visit-catalog.mts）：
 *   ① 完整 ITS 登录（服务号 04655f71b042b9d2d8d10cd566bd9c39）→ 36 字符漫游票据；
 *   ② `POST /visitor/mbpm/identity/ssoLogin?clientId=…&code=<票据>` → 内部 JWT（HS256，≈24 小时）；
 *      **参数名是 code、且在 query 上**（不是 ticket、不在 body），这一步同时下发会话 cookie；
 *   ③ 之后每个请求都要 **`token` 头 + 登录那次会话的 cookie 一起带**：只带 token 时服务端一律回
 *      `{"msg":"token过期","code":403}`（平台鉴权过滤器的固定话术，不是真的过期）；
 *   ④ 表单是 matrix 低代码平台：`form/preLoad` 拿 ftid/publishedDate → `form/load/<did>_<日期>.json`
 *      拿表单模型（字段/必填/目录 id）→ `form-select/getSelectItemsData` 拿下拉字典
 *      → `form-collaborate/isSelectTransition` + `form-collaborate/createAndStartProcess` 提交。
 *
 * ⛔ 边界：`submitReport()` 会在**真实系统**里创建一条报备（校外人员据此可入校）。它只允许由用户
 *   在界面上显式确认后调用；OH/插件填的数据一律只进「草稿」，不许自动提交。
 */
import { DEFAULT_USER_AGENT } from "../http.js";

export const VISIT_BASE = "https://visit.tsinghua.edu.cn";
export const VISIT_API = `${VISIT_BASE}/visitor/mbpm`;
export const VISIT_MOBILE_ENTRY = `${VISIT_BASE}/visitor/mobile/login`;
/** ITS 服务号（取自网页版 ssoProps.js 的 m_sso_clientId） */
export const VISIT_ITS_SERVICE_ID = "04655f71b042b9d2d8d10cd566bd9c39";
const ITS_FORM = `https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/${VISIT_ITS_SERVICE_ID}/0?/visitor/mobile/sso`;
const ITS_CHECK = "https://id.tsinghua.edu.cn/do/off/ui/auth/login/check";
const ITS_CHECK_SINGLE = "https://id.tsinghua.edu.cn/do/off/ui/auth/login/checkSingle";

/** 「亲友来访报备」这条流程的固定坐标（移动端功能目录里带出来的） */
export const VISIT_REPORT_FLOW = {
  formDid: "appointmentsFamilyArea",
  formName: "来访报备",
  mBizId: "cb862bfa-4402-49f2-9999-18c89877b2b7",
  pdid: "centralizedDeclaraTeachOnPrivateProcess",
  adid: "432375828421",
  tenantId: "campusAppointment",
} as const;
/** 「我的报备」列表表单 */
export const VISIT_MY_LIST_FORM = { formDid: "inviteVisitList", gridId: "DataGrid001" } as const;
/** 明细表（来访人）在表单模型里的 key */
export const VISIT_VISITOR_LIST_KEY = "appointmentsFamilyArea2EditList";

export type VisitFetch = (url: string, init?: RequestInit) => Promise<Response>;

export class VisitApiError extends Error {
  code: number | null;
  constructor(message: string, code: number | null = null) {
    super(message);
    this.name = "VisitApiError";
    this.code = code;
  }
}
export class VisitAuthRequiredError extends Error {
  constructor(message = "登录状态已失效，请重新登录后再试") {
    super(message);
    this.name = "VisitAuthRequiredError";
  }
}
export class VisitLoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisitLoginError";
  }
}

export interface VisitUser {
  userId: string;
  userName: string;
  userNo: string;
  orgName: string;
  roles: string[];
}
export interface VisitSessionState {
  token: string;
  /** 登录那次会话的 cookie（与 token 必须成对使用） */
  cookie: string;
  user: VisitUser | null;
}
export interface VisitOption {
  label: string;
  value: string;
}
export interface VisitFormField {
  key: string;
  type: string;
  label: string;
  required: boolean;
  readonly: boolean;
  /** 目录型下拉的字典 id（catalogType=code 的字段才有） */
  catalogId?: string;
}
export interface VisitFormModel {
  formDid: string;
  formName: string;
  ftid: string;
  publishedDate: number;
  fields: VisitFormField[];
  /** 来访人明细表（EditList）的列 */
  visitorFields: VisitFormField[];
  /** 「本人确认」那一整句承诺（服务端下发原文，界面上原样展示） */
  confirmLabel: string;
  /** 服务端预填的初值（preLoad 的 formData 里按变量分组的非空项；键是 mfield / sfield 编号） */
  prefilled: Record<string, string>;
}
export interface VisitMenuItem {
  title: string;
  path: string;
  isCatalog: boolean;
  url?: string;
  children: VisitMenuItem[];
}
export interface VisitReportRow {
  mBizId: string;
  /** 来访日期（服务端按天存，形如 2026-09-28 00:00:00） */
  visitDate: string;
  /** 业务状态码（mBizStatus；文案字典未公开，原样保留由界面呈现） */
  status: string;
  createdAt: string;
  quota: string;
  raw: Record<string, unknown>;
}
export interface VisitVisitorInput {
  name?: string;
  /** 身份证号（明细表必填） */
  idCard: string;
  /** 手机号（明细表必填，11 位） */
  mobile: string;
  plate?: string;
  /** 入校校门 code（见 catalogOptions("sfield6")） */
  gate?: string;
  org?: string;
}
/** 报备草稿：用**语义名**（提交前由 buildReportForm 映射到服务端的 mfield / sfield 编号） */
export interface VisitReportDraft {
  /** 来访日期 yyyy-MM-dd */
  visitDate: string;
  /** 来访类别 code（1 因公 / 2 因私） */
  category?: string;
  /** 来访区域 code */
  area?: string;
  /** 来访事由 code（1 公务来访 / 2 会议活动 / 3 服务保障 / 4 其它 / 5 亲友来访） */
  reason?: string;
  /** 来访事由说明（自由文本） */
  reasonText?: string;
  inviterName?: string;
  inviterIdCard?: string;
  inviterMobile?: string;
  /** 限定人数 */
  quota?: number;
  /** 口令（可选） */
  passcode?: string;
  visitors: VisitVisitorInput[];
  /** 本人确认（提交前必须为 true） */
  confirmed: boolean;
}

interface Envelope<T> {
  code?: number;
  message?: string;
  data?: T;
  total?: number;
  rows?: unknown[];
}

function safeJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
function mergeCookies(base: string, add: string): string {
  const pairs = new Map<string, string>();
  for (const part of `${base}; ${add}`.split("; ")) {
    const i = part.indexOf("=");
    if (i > 0) pairs.set(part.slice(0, i), part.slice(i + 1));
  }
  return [...pairs].map(([k, v]) => `${k}=${v}`).join("; ");
}
/** token 过期时刻（毫秒）；解不出返回 null（按「未知」处理，不当作已过期） */
export function visitTokenExpiresAt(token: string): number | null {
  const payload = token.split(".")[1] ?? "";
  if (!payload) return null;
  try {
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "="));
    const j = safeJson<{ exp?: number }>(bin);
    return typeof j?.exp === "number" ? j.exp * 1000 : null;
  } catch {
    return null;
  }
}
function extractTicket(html: string, finalUrl: string): string {
  const fromUrl = (u: string): string => {
    try {
      return new URL(u).searchParams.get("ticket") ?? "";
    } catch {
      return "";
    }
  };
  const anchor = /<a[^>]+href="([^"]+)"/i.exec(html)?.[1] ?? "";
  if (anchor) {
    const t = fromUrl(anchor.startsWith("http") ? anchor : new URL(anchor, finalUrl).toString());
    if (t) return t;
  }
  return fromUrl(finalUrl);
}
/** matrix 下拉字典请求体（与前端 u()/c() 同构） */
export function selectSourcePayload(componentId: string, catalogId: string): string {
  return JSON.stringify({
    isEditListItem: false,
    editListId: null,
    componentId,
    catalogType: "code",
    catalogId,
    relationType: null,
    relationId: null,
    relationProperty: null,
    digit: 0,
    levelDigit: 0,
    rulePlaceHolder: null,
  });
}

export interface VisitClientOptions {
  fetch: VisitFetch;
  log?: (line: string) => void;
}

export class VisitClient {
  private fetchLike: VisitFetch;
  private log: (line: string) => void;
  private token = "";
  private cookie = "";
  private user: VisitUser | null = null;

  constructor(opts: VisitClientOptions) {
    this.fetchLike = opts.fetch;
    this.log = opts.log ?? (() => undefined);
  }

  hasToken(): boolean {
    return this.token.length > 0;
  }
  tokenExpiresAt(): number | null {
    return this.token ? visitTokenExpiresAt(this.token) : null;
  }
  getUser(): VisitUser | null {
    return this.user;
  }
  /** 供宿主持久化（token 与 cookie 必须成对保存） */
  session(): VisitSessionState {
    return { token: this.token, cookie: this.cookie, user: this.user };
  }
  setSession(s: VisitSessionState | null): void {
    this.token = s?.token ?? "";
    this.cookie = s?.cookie ?? "";
    this.user = s?.user ?? null;
  }

  /** 底层请求：自动带 token 头 + 会话 cookie，吸收 Set-Cookie 与业务码 */
  private async req<T>(
    path: string,
    opts: {
      method?: "GET" | "POST";
      query?: Record<string, string>;
      form?: URLSearchParams | FormData;
      headers?: Record<string, string>;
      noAuth?: boolean;
    } = {},
  ): Promise<T> {
    const url = new URL(`${VISIT_API}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
    const headers: Record<string, string> = {
      "User-Agent": DEFAULT_USER_AGENT,
      "x-requested-with": "XMLHttpRequest",
      mlangge: "zh-CN",
      // 平台要求：当前应用号（缺它时 form/load 直接回 code=500 "fail"，实测 2026-10-15）
      matrixcurrentappid: VISIT_REPORT_FLOW.tenantId,
      ...(opts.headers ?? {}),
    };
    if (!opts.noAuth && this.token) headers.token = this.token;
    if (this.cookie) headers.Cookie = this.cookie;
    let body: BodyInit | undefined;
    if (opts.form instanceof FormData) body = opts.form;
    else if (opts.form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = opts.form.toString();
    }
    const res = await this.fetchLike(url.toString(), { method: opts.method ?? "GET", headers, body });
    const setCookies = res.headers.getSetCookie?.() ?? [];
    if (setCookies.length) {
      this.cookie = mergeCookies(this.cookie, setCookies.map((c) => c.split(";")[0] ?? "").join("; "));
    }
    const env = safeJson<Envelope<T>>(await res.text());
    if (!env) {
      if (res.status === 401 || res.status === 403) throw new VisitAuthRequiredError();
      throw new VisitApiError(`临时来访报备系统返回了无法识别的内容（HTTP ${res.status}）`, res.status);
    }
    const code = typeof env.code === "number" ? env.code : 200;
    if (code === 401 || code === 403) throw new VisitAuthRequiredError(env.message ?? "登录状态已失效，请重新登录后再试");
    if (code !== 200) throw new VisitApiError(env.message ?? `请求未成功（编号 ${code}）`, code);
    return (env.data ?? (env as unknown as T)) as T;
  }

  /* ───────────────────────── 登录 ───────────────────────── */

  /** 用 ITS 漫游票据换内部 token（宿主从浏览器回跳里取到 ticket 时也可单独调用） */
  async ssoLogin(ticket: string): Promise<VisitUser | null> {
    const data = await this.req<{ token?: string; user?: VisitUser }>("/identity/ssoLogin", {
      method: "POST",
      noAuth: true,
      query: { clientId: VISIT_ITS_SERVICE_ID, code: ticket },
    });
    const token = String(data?.token ?? "");
    if (!token) throw new VisitLoginError("临时来访报备系统没有下发登录令牌");
    this.token = token;
    this.user = data?.user ?? null;
    this.log(`[VISIT] 已登录：${this.user?.userName ?? "（未返回姓名）"}`);
    return this.user;
  }

  /**
   * 完整 ITS 登录（受信指纹生效时零二次认证），再换 token。
   * 会话仍活着时 ITS 给的是「确认页」（无 SM2 公钥）——那条路不吃密码。
   */
  async authorizeTicket(username?: string, password?: string, fingerprint?: string, finger3?: string): Promise<{ticket:string;html:string;url:string;status:number}> {
    let cookies = "";
    const hop = async (method: "GET" | "POST", url: string, body?: string) => {
      let cur = url;
      let m = method;
      let b = body;
      for (let i = 0; i < 14; i++) {
        const headers: Record<string, string> = { "User-Agent": DEFAULT_USER_AGENT };
        if (cookies) headers.Cookie = cookies;
        if (b !== undefined) headers["Content-Type"] = "application/x-www-form-urlencoded";
        const res = await this.fetchLike(cur, { method: m, body: b, headers, redirect: "manual" });
        for (const sc of res.headers.getSetCookie?.() ?? []) {
          const mm = /^([^=]+)=([^;]*)/.exec(sc);
          if (mm?.[1]) cookies = mergeCookies(cookies, `${mm[1].trim()}=${mm[2] ?? ""}`);
        }
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get("location");
          if (loc && loc !== "null") {
            cur = new URL(loc, cur).toString();
            if (res.status === 303 || ((res.status === 301 || res.status === 302) && m === "POST")) {
              m = "GET";
              b = undefined;
            }
            continue;
          }
        }
        const finalUrl=res.headers.get('x-onethu-final-url')??cur;
        const final=new URL(finalUrl);
        if(!['https://id.tsinghua.edu.cn','https://visit.tsinghua.edu.cn'].includes(final.origin)||final.username||final.password)throw new VisitLoginError('学校登录跳转地址异常');
        return { url: final.href, text: await res.text(), status: res.status };
      }
      throw new VisitLoginError("统一身份认证跳转次数过多，请稍后重试");
    };

    const form = await hop("GET", ITS_FORM);
    const initialTicket=extractTicket(form.text,form.url);
    if(initialTicket)return {ticket:initialTicket,html:form.text,url:form.url,status:form.status};
    const key = /id="sm2publicKey"[^>]*>\s*([0-9a-fA-F]{100,})\s*</.exec(form.text)?.[1] ?? "";
    let check: { url: string; text: string; status:number };
    if (key) {
      if (!username || !password) {
        throw new VisitLoginError("本机没有记住账号密码：请先在设置里记住密码，或打开官方页面手动登录一次");
      }
      const { encryptPassword } = await import("../crypto/sm2.js");
      check = await hop(
        "POST",
        ITS_CHECK,
        new URLSearchParams({
          i_user: username,
          i_pass: encryptPassword(password, key),
          fingerPrint: fingerprint ?? "",
          fingerGenPrint: finger3 ?? "",
          fingerGenPrint3: finger3 ?? "",
          i_captcha: "",
        }).toString(),
      );
    } else if (/checkSingle/i.test(form.text)) {
      const hidden = new URLSearchParams();
      for (const m of form.text.matchAll(/<input[^>]+type="hidden"[^>]*>/gi)) {
        const name = /name="([^"]+)"/i.exec(m[0])?.[1];
        const value = /value="([^"]*)"/i.exec(m[0])?.[1] ?? "";
        if (name && !/singleLogin|deviceName/i.test(name)) hidden.set(name, value);
      }
      hidden.set("i_rememberme", "on");
      hidden.set("fingerPrint", fingerprint ?? "");
      hidden.set("fingerGenPrint", finger3 ?? "");
      hidden.set("fingerGenPrint3", finger3 ?? "");
      check = await hop("POST", ITS_CHECK_SINGLE, hidden.toString());
    } else {
      throw new VisitLoginError(`统一身份认证页面形态不认识（HTTP ${form.status}），请稍后重试`);
    }
    const ticket = extractTicket(check.text, check.url);
    if (!ticket) {
      if (/二次认证|doubleauth/i.test(check.text)) {
        throw new VisitLoginError("统一身份认证要求二次验证：请先到官方页面完成一次验证");
      }
      throw new VisitLoginError("统一身份认证没有返回漫游票据，请稍后重试");
    }
    return {ticket,html:check.text,url:check.url,status:check.status};
  }

  async login(username?: string, password?: string, fingerprint?: string, finger3?: string): Promise<VisitUser | null> {
    return this.ssoLogin((await this.authorizeTicket(username,password,fingerprint,finger3)).ticket);
  }

  /* ───────────────────────── 读取 ───────────────────────── */

  /** 移动端功能目录（登录后官方前端拉的那一份） */
  async menus(): Promise<VisitMenuItem[]> {
    const data = await this.req<unknown[]>("/function/getAllMobileMenus", { method: "POST" });
    const conv = (nodes: unknown[]): VisitMenuItem[] =>
      nodes.map((n) => {
        const o = (n ?? {}) as Record<string, unknown>;
        const meta = (o.meta ?? {}) as Record<string, unknown>;
        return {
          title: String(meta.title ?? o.name ?? ""),
          path: String(o.path ?? ""),
          isCatalog: o.isCatalog === true,
          ...(meta.url ? { url: String(meta.url) } : {}),
          children: conv(Array.isArray(o.children) ? o.children : []),
        };
      });
    return conv(Array.isArray(data) ? data : []);
  }

  /** 表单模型：preLoad（拿 ftid/发布日期）→ load/<did>_<日期>.json → 归一化字段 */
  async formModel(formDid: string, pre: { mBizId?: string; pdid?: string; adid?: string } = {}): Promise<VisitFormModel> {
    const bizId = pre.mBizId ?? VISIT_REPORT_FLOW.mBizId;
    const pre1 = await this.req<string>("/form/preLoad", {
      query: {
        mBizId: pre.mBizId ?? "",
        mFlowBizId: "",
        pdid: pre.pdid ?? "",
        adid: pre.adid ?? "",
        "paramData[mBizId]": bizId,
        "paramData[tenantId]": VISIT_REPORT_FLOW.tenantId,
        matrix_form_did: formDid,
        matrix_form_tid: "",
      },
    });
    const meta = typeof pre1 === "string"
      ? safeJson<{ ftid: string; publishedDate: number; frontParam: string; formData?: Record<string, Record<string, unknown>> }>(pre1)
      : null;
    if (!meta?.ftid || !meta.publishedDate) throw new VisitApiError("表单预载没有返回模型标识");
    const raw = await this.req<string>(`/form/load/${formDid}_${meta.publishedDate}.json`, {
      query: { a: "" },
      // frontParam 头必须是 JSON（官方前端是 JSON.stringify({ftid})）；传裸 ftid 服务端回 500 "fail"
      headers: { frontParam: JSON.stringify({ ftid: meta.ftid }) },
    });
    const obj = typeof raw === "string" ? safeJson<Record<string, unknown>>(raw) : null;
    if (!obj) throw new VisitApiError("表单模型解析失败");
    const norm = normalizeFormModel(obj);
    return {
      formDid: String(obj.formDid ?? formDid),
      formName: String(obj.formName ?? ""),
      ftid: String(obj.ftid ?? meta.ftid),
      publishedDate: meta.publishedDate,
      fields: norm.fields,
      visitorFields: norm.visitorFields,
      confirmLabel: norm.confirmLabel,
      prefilled: flattenPrefilled(meta.formData),
    };
  }

  /** 目录下拉字典（catalogType=code 的下拉都走这个） */
  async catalogOptions(componentId: string, catalogId: string): Promise<VisitOption[]> {
    const raw = await this.req<string>("/form-select/getSelectItemsData", {
      query: { sourceSelect: selectSourcePayload(componentId, catalogId) },
    });
    const obj = typeof raw === "string" ? safeJson<Record<string, VisitOption[]>>(raw) : null;
    const list = obj?.[componentId];
    return Array.isArray(list) ? list : [];
  }

  /** 我的报备（列表模型 → ftid → loadData 分页） */
  async myReports(page = 0, pageSize = 20): Promise<{ total: number; rows: VisitReportRow[] }> {
    const model = await this.formModel(VISIT_MY_LIST_FORM.formDid);
    const form = new FormData();
    form.append("pageNumber", String(page));
    form.append("pageSize", String(pageSize));
    form.append(`${VISIT_MY_LIST_FORM.gridId}_mfilter`, "");
    form.append("matrix_load_grid", "true");
    form.append("matrix_query_list_id", VISIT_MY_LIST_FORM.gridId);
    form.append("matrix_form_did", VISIT_MY_LIST_FORM.formDid);
    form.append("updateUuid", "");
    form.append("viewUuid", "");
    const data = await this.req<{ total?: number; rows?: Array<Record<string, unknown>> }>("/form/loadData", {
      method: "POST",
      query: { mHtml5Flag: "true", matrix_form_tid: model.ftid },
      form,
    });
    const rows = (data?.rows ?? []).map((r) => ({
      mBizId: String(r.mBizId ?? ""),
      visitDate: String(r.mfield2 ?? ""),
      status: String(r.mBizStatus ?? ""),
      createdAt: String(r.createDate ?? ""),
      quota: String(r.mfield12 ?? ""),
      raw: r,
    }));
    return { total: Number(data?.total ?? rows.length), rows };
  }

  /* ───────────────────────── 提交（写操作，必须用户显式确认） ───────────────────────── */

  /** 草稿 → 服务端 FormData（与官方 getRequestParams 同构；WHY 独立函数：草稿填充与提交共用一套映射） */
  buildReportForm(draft: VisitReportDraft, model: VisitFormModel, opts: { processTitle?: string; remark?: string } = {}): FormData {
    if (!draft.confirmed) throw new VisitApiError("请先勾选「本人确认」再提交");
    if (!draft.visitors.length) throw new VisitApiError("请至少填写一位来访人后再提交");
    for (const v of draft.visitors) {
      if (!v.idCard.trim()) throw new VisitApiError("来访人身份证号不能为空，请补齐后再提交");
      if (!/^\d{11}$/.test(v.mobile.trim())) throw new VisitApiError("来访人手机号需要 11 位，请补齐后再提交");
    }
    const form = new FormData();
    const put = (k: string, v: string | number | undefined): void => {
      if (v !== undefined && v !== null && String(v).length) form.append(k, String(v));
    };
    put("mfield1", draft.category);
    put("mfield2", draft.visitDate);
    put("mfield13", draft.area);
    put("mfield16", draft.reason);
    put("mfield3", draft.reasonText);
    put("mfield5", draft.inviterName);
    put("mfield7", draft.inviterIdCard);
    put("mfield8", draft.inviterMobile);
    put("mfield12", draft.quota);
    put("mfield9", draft.passcode);
    form.append("mfield17", draft.confirmed ? "true" : "false");
    draft.visitors.forEach((v, i) => {
      const n = i + 1;
      put(`${VISIT_VISITOR_LIST_KEY}[${n}].sfield1`, v.name);
      put(`${VISIT_VISITOR_LIST_KEY}[${n}].sfield2`, v.idCard);
      put(`${VISIT_VISITOR_LIST_KEY}[${n}].sfield3`, v.mobile);
      put(`${VISIT_VISITOR_LIST_KEY}[${n}].sfield4`, v.plate);
      put(`${VISIT_VISITOR_LIST_KEY}[${n}].sfield6`, v.gate);
      put(`${VISIT_VISITOR_LIST_KEY}[${n}].sfield7`, v.org);
    });
    form.append("mBizId", VISIT_REPORT_FLOW.mBizId);
    form.append("plateId", VISIT_REPORT_FLOW.mBizId);
    form.append("mFlowBizId", "");
    form.append("pdid", VISIT_REPORT_FLOW.pdid);
    form.append("ptid", "");
    form.append("formId", model.formDid);
    form.append("processTitle", opts.processTitle ?? `亲友来访报备 ${draft.visitDate}`);
    form.append("postscript", opts.remark ?? "");
    form.append("matrix_form_tid", model.ftid);
    return form;
  }

  /** 提交报备（真写）。调用前必须已由用户在界面上确认；OH 填的草稿不得自动走到这里 */
  async submitReport(
    draft: VisitReportDraft,
    model: VisitFormModel,
    opts: { processTitle?: string; remark?: string } = {},
  ): Promise<{ ok: true; message: string }> {
    const probe = new URLSearchParams();
    probe.set("mBizId", VISIT_REPORT_FLOW.mBizId);
    probe.set("matrix_form_did", model.formDid);
    probe.set("matrix_form_tid", model.ftid);
    const trans = await this.req<string>("/form-collaborate/isSelectTransition", { method: "POST", form: probe });
    const t = typeof trans === "string" ? safeJson<{ flag?: string }>(trans) : null;
    if (t?.flag === "true") {
      throw new VisitApiError("这条报备需要先选流转分支：请打开官方页面完成这一步");
    }
    const form = this.buildReportForm(draft, model, opts);
    await this.req<unknown>("/form-collaborate/createAndStartProcess", { method: "POST", form });
    this.log(`[VISIT] 已提交亲友来访报备（${draft.visitDate}，${draft.visitors.length} 位来访人）`);
    return { ok: true, message: "发送成功" };
  }
}

/** preLoad 的 formData（按变量分组）→ 扁平 {字段key: 值}，只取非空标量 */
export function flattenPrefilled(formData: Record<string, Record<string, unknown>> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const group of Object.values(formData ?? {})) {
    for (const [k, v] of Object.entries(group ?? {})) {
      if (v === null || v === undefined || typeof v === "object") continue;
      if (String(v).length) out[k] = String(v);
    }
  }
  return out;
}

/** matrix 表单模型 → 归一化字段（视图层不直接碰原始 JSON） */
export function normalizeFormModel(raw: Record<string, unknown>): {
  fields: VisitFormField[];
  visitorFields: VisitFormField[];
  confirmLabel: string;
} {
  const fields: VisitFormField[] = [];
  const visitorFields: VisitFormField[] = [];
  let confirmLabel = "";
  const walk = (nodes: unknown, inList: boolean): void => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const o = node as Record<string, unknown>;
      const type = String(o.type ?? "");
      const key = String(o.key ?? "");
      if (type === "EditList") {
        // 实测（2026-10-15）：明细表的列放在 columns 下（部分版本放 list），两条都要走
        walk(o.columns, true);
        walk(o.list, true);
        continue;
      }
      if (key && type && !["button", "label", "Grid", "ContainerPanel", "splitline", "innerhtml", "MergeHeaders"].includes(type)) {
        if (type === "checkbox" && String(o.styleClass ?? "") === "term-checkbox") {
          confirmLabel = String(o.labelValue ?? "");
        } else {
          const f: VisitFormField = {
            key,
            type,
            label: String(o.title ?? o.name ?? key),
            required: o.required === true,
            readonly: o.readonly === true,
            ...(o.catalogId ? { catalogId: String(o.catalogId) } : {}),
          };
          (inList ? visitorFields : fields).push(f);
        }
      }
      walk(o.components, inList);
      walk(o.columns, inList);
      walk(o.list, inList);
    }
  };
  walk(raw.list, false);
  return { fields, visitorFields, confirmLabel };
}
