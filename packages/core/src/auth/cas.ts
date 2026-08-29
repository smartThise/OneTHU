/**
 * 统一身份认证（CAS）—— 与早期 demo（webvpn-poc/server.js、thu_agent.py）验证过的链路一致：
 * 表单页抓 SM2 公钥 + 隐藏字段 → POST 登录（i_pass + sm2pass 双写）→
 * "二次认证"检测 → doubleAuth JSON 接口三步（查方式/发码/验码）→ 信任设备 → ticket。
 */
import { HttpClient } from "../http.js";
import { encryptPassword } from "../crypto/sm2.js";

import { WEBVPN_ROOT } from "../crypto/webvpn.js";

export const ID_PREFIX = "https://id.tsinghua.edu.cn";
/** demo 的登录入口：WebVPN 登录页（内嵌 CAS 表单），全程 WebVPN */
export const WEBVPN_LOGIN_PAGE = WEBVPN_ROOT + "/login";
export const CAS_LOGIN_FORM =
  ID_PREFIX + "/do/off/ui/auth/login/form/bb5df85216504820be7bba2b0ae1535b/0";
export const CAS_LOGIN_CHECK = ID_PREFIX + "/do/off/ui/auth/login/check";
export const DOUBLE_AUTH_URL = ID_PREFIX + "/b/doubleAuth/login";
export const SAVE_FINGER_URL = ID_PREFIX + "/b/doubleAuth/personal/saveFinger";

export const LEARN_ROAM = (ticket: string) =>
  `https://learn.tsinghua.edu.cn/b/j_spring_security_thauth_roaming_entry?ticket=${ticket}`;
export const LEARN_LOGOUT = "https://learn.tsinghua.edu.cn/f/j_spring_security_logout";
export const INFO_ROAM = (ticket: string) =>
  `https://info.tsinghua.edu.cn/b/yyfw/vyyfwxx/info/portal_fg/common/onlineAppRedirect?ticket=${ticket}`;

export interface CasCredential {
  username: string;
  password: string;
  fingerprint: string;
}

export interface TwoFactorMethod {
  /** 原始 type 字段（wx / sms / totp ...） */
  type: string;
  name: string;
  detail?: string;
}

export class CasError extends Error {
  /** 服务端页面片段，供诊断（demo 对齐调试） */
  detail?: string;
  constructor(message: string, detail?: string) {
    super(message);
    this.name = "CasError";
    this.detail = detail;
  }
}

/** 服务端要求二次认证 */
export class TwoFactorRequired extends Error {
  constructor() {
    super("该账号需要二次认证");
    this.name = "TwoFactorRequired";
  }
}

function extractByEnv(html: string, env: string): string {
  const m = new RegExp(`id=["']${env}["'][^>]*>([^<]*)`).exec(html);
  return m?.[1]?.trim() ?? "";
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 提取 CAS 返回的人类可读失败原因（msg_note / 关键词扫描） */
export function extractCasReason(html: string): string {
  const msgNote = extractByEnv(html, "msg_note");
  if (msgNote) return msgNote;
  const text = stripTags(html);
  for (const keyword of ["密码", "验证码", "锁定", "冻结", "二次认证", "双因素", "长时间未操作", "丢失"]) {
    const idx = text.indexOf(keyword);
    if (idx >= 0) {
      const start = Math.max(0, idx - 16);
      return text.slice(start, start + 64).trim();
    }
  }
  return text.slice(0, 100) || "登录失败（未返回跳转票据）";
}

export interface CasFormInfo {
  publicKey: string;
  /** 登录表单 action（demo 从页面解析而非写死 /check） */
  action: string;
  /** 表单隐藏字段（必须原样回传，demo 验证） */
  hiddenFields: Record<string, string>;
  /** 本次登录是否走 WebVPN（决定字段集与相对地址基座） */
  viaWebVPN: boolean;
}

/** CAS 2FA 页面里的 OTP 表单（demo 的验证路径：验证码直接 POST 回该表单） */
export interface OtpForm {
  action: string;
  fields: Record<string, string>;
  /** 2FA 页面快照（诊断用） */
  debugHtml: string;
}

/** 从 CAS/电子身份表单页解析公钥+隐藏字段+action（xk 等应用 bounce 表单复用） */
export function parseCasFormHtml(formHtml: string, viaWebVPN: boolean): CasFormInfo {
  const publicKey = extractByEnv(formHtml, "sm2publicKey");
  if (!publicKey || !/^[0-9a-fA-F]+$/.test(publicKey)) {
    throw new CasError("无法从登录页获取 SM2 公钥（页面结构可能已变更）");
  }
  const formAction =
    /<form[^>]*id="theform"[^>]*action="([^"]*)"/.exec(formHtml)?.[1] ??
    /<form[^>]*action="([^"]*)"[^>]*id="theform"/.exec(formHtml)?.[1] ?? "";
  const hiddenFields: Record<string, string> = {};
  const re = /<input[^>]*type="hidden"[^>]*name="([^"]*)"[^>]*value="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formHtml)) !== null) {
    hiddenFields[m[1]!] = m[2]!;
  }
  return { publicKey, hiddenFields, action: formAction, viaWebVPN };
}

/** 第一步：取登录表单页（webvpn=WebVPN 登录页内嵌 CAS 表单，demo 同款；直连=ID CAS 表单页） */
export async function fetchCasForm(http: HttpClient, viaWebVPN: boolean): Promise<CasFormInfo> {
  return parseCasFormHtml(await http.text(viaWebVPN ? WEBVPN_LOGIN_PAGE : CAS_LOGIN_FORM), viaWebVPN);
}

export type CasSubmitResult = { kind: "done" } | { kind: "need2fa"; otpForm: OtpForm };

/** 第二步：提交账密（WebVPN=demo 字段集 / 直连=双写）；成功后消费回调建立会话 */
export async function submitCasLogin(
  http: HttpClient,
  cred: CasCredential,
  form: CasFormInfo,
): Promise<CasSubmitResult> {
  const enc = encryptPassword(cred.password, form.publicKey);
  // 字段集按链路区分（均经实测）：WebVPN 层读 sm2pass（demo 实证）；直连层读 i_pass
  const base: Record<string, string> = form.viaWebVPN
    ? { i_user: cred.username, sm2pass: enc, i_pass: "", fingerGenPrint: "" }
    : {
        i_user: cred.username,
        i_pass: enc,
        sm2pass: enc,
        singleLogin: "on",
        fingerPrint: cred.fingerprint,
        fingerGenPrint: "",
        fingerGenPrint3: "",
        i_captcha: "",
      };
  const body = new URLSearchParams({ ...form.hiddenFields, ...base });

  const baseUrl = form.viaWebVPN ? WEBVPN_ROOT : ID_PREFIX;
  const submitUrl = form.action
    ? form.action.startsWith("http")
      ? form.action
      : new URL(form.action, baseUrl).toString()
    : CAS_LOGIN_CHECK;

  const checkHtml = await http.text(submitUrl, { method: "POST", body });
  if (/二次认证|双因素|二次验证|双因子|otp|短信|企业微信/.test(checkHtml)) {
    const otpAction =
      /<form[^>]*action="([^"]*)"[^>]*id="otpForm"/.exec(checkHtml)?.[1] ??
      /<form[^>]*action="([^"]*)"[^>]*name="otp/.exec(checkHtml)?.[1] ?? "";
    const otpFields: Record<string, string> = {};
    const re = /<input[^>]*type="hidden"[^>]*name="([^"]*)"[^>]*value="([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(checkHtml)) !== null) {
      otpFields[m[1]!] = m[2]!;
    }
    return {
      kind: "need2fa",
      otpForm: { action: otpAction, fields: otpFields, debugHtml: checkHtml.slice(0, 2500) },
    };
  }
  if (!checkHtml.includes("登录成功")) {
    throw new CasError(extractCasReason(checkHtml), checkHtml.slice(0, 1500));
  }
  // 成功页锚点 = 回调链接（WebVPN 模式下消费它以建立 wengine 会话）
  const callback = /<a[^>]+href="([^"]+)"/i.exec(checkHtml)?.[1];
  if (callback) {
    await http
      .request(callback.startsWith("http") ? callback : new URL(callback, baseUrl).toString(), {
        redirect: "follow",
      })
      .catch(() => undefined);
  }
  return { kind: "done" };
}

/** demo 验证路径：把验证码 POST 回 2FA 页面的 otpForm */
export async function submitOtpCode(
  http: HttpClient,
  otpForm: OtpForm,
  code: string,
  viaWebVPN: boolean,
): Promise<void> {
  if (!otpForm.action) throw new CasError("2FA 页面缺少 OTP 表单（页面结构可能已变更）");
  const baseUrl = viaWebVPN ? WEBVPN_ROOT : ID_PREFIX;
  const url = otpForm.action.startsWith("http") ? otpForm.action : new URL(otpForm.action, baseUrl).toString();
  const body = new URLSearchParams({ ...otpForm.fields, otp: code.trim() });
  const html = await http.text(url, { method: "POST", body });
  if (!html.includes("登录成功")) {
    throw new CasError(extractCasReason(html), html.slice(0, 1500));
  }
  const callback = /<a[^>]+href="([^"]+)"/i.exec(html)?.[1];
  if (callback) {
    await http
      .request(callback.startsWith("http") ? callback : new URL(callback, baseUrl).toString(), {
        redirect: "follow",
      })
      .catch(() => undefined);
  }
}

/** 2FA：列出可用验证方式（企业微信 / 短信 / TOTP） */
export async function list2FAMethods(http: HttpClient): Promise<TwoFactorMethod[]> {
  const body = new URLSearchParams({ action: "FIND_APPROACHES" });
  const text = await http.text(DOUBLE_AUTH_URL, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    direct: true, // doubleAuth 与登录 POST 同域（id 直连），绝不能经 WebVPN 包装（会丢 id 会话）
  });
  let json: { result?: string; msg?: string; object?: unknown };
  try {
    json = JSON.parse(text);
  } catch {
    throw new CasError("二次认证接口返回异常");
  }
  if (json.result !== "success") throw new CasError(json.msg ?? "获取二次认证方式失败");
  // type 值以 info-app（上架实现）为准：wechat / mobile / totp（不是 demo 里的 wx/sms）
  const NAMES: Record<string, string> = { wechat: "企业微信", mobile: "手机短信", totp: "TOTP 验证器" };

  // FIND_APPROACHES 的 object 是单个信息对象（demo auth.js 验证）：
  // { hasWeChatBool: bool, phone: "...", hasTotp: bool, ... }
  const obj = json.object as Record<string, unknown> | unknown[] | null;
  const methods: TwoFactorMethod[] = [];

  if (Array.isArray(obj)) {
    for (const raw of obj) {
      const d = raw as Record<string, unknown>;
      const type = String(d.name ?? d.type ?? "");
      if (type) {
        methods.push({
          type,
          name: NAMES[type] ?? String(d.description ?? type),
          detail: d.phone ? `发送至 ${d.phone}` : undefined,
        });
      }
    }
    return methods;
  }

  if (obj && typeof obj === "object") {
    if (obj.hasWeChatBool) methods.push({ type: "wechat", name: NAMES.wechat! });
    if (obj.phone) methods.push({ type: "mobile", name: NAMES.mobile!, detail: `发送至 ${obj.phone}` });
    if (obj.hasTotp) methods.push({ type: "totp", name: NAMES.totp! });
  }
  return methods;
}

/** 2FA：发送验证码 */
export async function send2FACode(http: HttpClient, type: string): Promise<void> {
  const body = new URLSearchParams({ action: "SEND_CODE", type });
  const text = await http.text(DOUBLE_AUTH_URL, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    direct: true, // doubleAuth 与登录 POST 同域（id 直连），绝不能经 WebVPN 包装（会丢 id 会话）
  });
  try {
    const json = JSON.parse(text) as { result?: string; msg?: string };
    if (json.result !== "success") throw new CasError(json.msg ?? "发送验证码失败");
  } catch (e) {
    if (e instanceof CasError) throw e;
    throw new CasError("发送验证码接口返回异常");
  }
}

/** 2FA：校验验证码；成功后跟随 redirectUrl 拿登录页，提取 ticket */
export async function verify2FACode(
  http: HttpClient,
  type: string,
  code: string,
): Promise<{ redirectUrl: string | null; anchorConsumed: boolean; anchorUrl: string | null }> {
  const action = type === "totp" ? "VERITY_TOTP_CODE" : "VERITY_CODE";
  const body = new URLSearchParams({ action, vericode: code.trim() });
  const text = await http.text(DOUBLE_AUTH_URL, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    direct: true, // doubleAuth 与登录 POST 同域（id 直连），绝不能经 WebVPN 包装（会丢 id 会话）
  });
  let json: { result?: string; msg?: string; object?: { redirectUrl?: string } };
  try {
    json = JSON.parse(text);
  } catch {
    throw new CasError("验证码校验接口返回异常", text.slice(0, 800));
  }
  if (json.result !== "success") throw new CasError(json.msg ?? "验证码错误或已过期");

  // info-app 关键步骤：VERITY 成功 ≠ 登录完成，必须 GET redirectUrl 让 CAS 落地登录态
  const redirectUrl = json.object?.redirectUrl ?? null;
  let anchorConsumed = false;
  let anchorUrl: string | null = null;
  if (redirectUrl) {
    const html = await http.text(redirectUrl.startsWith("http") ? redirectUrl : ID_PREFIX + redirectUrl, {
      direct: true,
    });
    if (!html.includes("登录成功")) {
      throw new CasError(extractCasReason(html), html.slice(0, 1500));
    }
    // 消费成功页回调锚点（WebVPN 模式下落地 wengine 会话）
    const callback = /<a[^>]+href="([^"]+)"/i.exec(html)?.[1];
    if (callback) {
      anchorConsumed = true;
      anchorUrl = callback.startsWith("http") ? callback : new URL(callback, ID_PREFIX).toString();
      // 回调（oauth 网关）落地 webvpn 会话：demo webvpnRequest 语义——全跳手动跟、
      // 每跳合并 Set-Cookie 进 jar（按物理域），直到链终点。逐跳记录现场。
      const hops: string[] = [];
      let hopUrl = anchorUrl;
      for (let hop = 0; hop < 20; hop++) {
        const res = await http
          .request(hopUrl, { redirect: "manual", direct: true })
          .catch(() => undefined);
        if (!res) {
          hops.push(hop + ":request-failed");
          break;
        }
        const loc = res.headers.get("location");
        hops.push(hop + ":" + res.status + "@" + new URL(hopUrl).host + (loc ? "->" + new URL(loc, hopUrl).host : ""));
        if (loc && (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308)) {
          const next = loc.startsWith("http") ? loc : new URL(loc, hopUrl).toString();
          hopUrl = next;
          if (hop + 1 >= 20) break;
          continue;
        }
        break;
      }
      const g = globalThis as unknown as { __oneTHUdbg?: string[] };
      if (!g.__oneTHUdbg) g.__oneTHUdbg = [];
      g.__oneTHUdbg.push("CALLBACK-HOPS " + hops.join(" | "));
    }
  }
  return { redirectUrl, anchorConsumed, anchorUrl };
}

/** 2FA：信任当前设备（指纹已随会话保存） */
export async function trustDevice(http: HttpClient, fingerprint: string, deviceName = "OneTHU"): Promise<void> {
  try {
    const body = new URLSearchParams({
      fingerprint,
      deviceName,
      radioVal: "是",
    });
    await http.text(SAVE_FINGER_URL, { method: "POST", body, direct: true });
  } catch {
    /* 信任设备失败不阻塞登录 */
  }
}
