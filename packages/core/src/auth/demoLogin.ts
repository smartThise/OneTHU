/**
 * demoLogin —— webvpn-poc/server.js 登录流程的逐行移植（钦定蓝本，不要"优化"）。
 *
 * 与 demo 完全一致的判断：
 *  - 全程 WebVPN；webvpnRequest 手动跟重定向（≤20 跳）+ Cookie 字符串自管理
 *  - 成功判定 = 最终 URL 含 "webvpn" 且不含 "login/form"（不是看 HTML！）
 *  - 2FA = 提取 otpForm(action+hidden)；提交 = POST action（为空则 POST 2FA 页面自身 URL）
 *  - 字段集 = hiddenFields + i_user + sm2pass(密文) + i_pass:"" + fingerGenPrint:""
 */
import { encryptPassword } from "../crypto/sm2.js";
import { decryptHost, webvpnWrap } from "../crypto/webvpn.js";
import type { FetchLike } from "../http.js";

export interface DemoSession {
  webvpnCookies: string;
  twoFaUrl: string;
  twoFaAction: string;
  twoFaHidden: Record<string, string>;
  /** 2FA 页面快照（诊断用，demo 的 twoFaHtml） */
  twoFaHtml: string;
  /** 诊断快照（失败原因分析用） */
  debug: string;
  loginState: "idle" | "need_2fa" | "logged_in";
  /** id CAS 主会话（登录成功后、learn 以同名 JSESSIONID 覆盖前抓取）——
   *  resume 时 learn 会话过期的重漫游主凭据（SSO：已认证 id 会话随要随发票） */
  idJsid: string;
  /** roam-id（webvpn 服务绑定二次登录）独立诊断——不并入 debug，
   *  防止被 demoEnterLearn 的 s.debug 覆盖（17:40 观测缺陷的教训） */
  idRoamDebug: string;
}

export function newDemoSession(): DemoSession {
  return {
    webvpnCookies: "",
    twoFaUrl: "",
    twoFaAction: "",
    twoFaHidden: {},
    twoFaHtml: "",
    debug: "",
    loginState: "idle",
    idJsid: "",
    idRoamDebug: "",
  };
}

interface WvResult {
  html: string;
  cookies: string;
  url: string;
}

/** server.js webvpnRequest 的逐行移植（zhjwxk 等旁路客户端复用：导出不改逻辑） */
/** 调试钩子（桌面端接 /tmp/onethu-debug.log） */
let webvpnLog: ((line: string) => void) | null = null;
export function setWebvpnLog(fn: (line: string) => void): void {
  webvpnLog = fn;
}

/** 真·wengine 引导页判定（与 http.ts wengineInterstitial 同语义） */
function isWengineInterstitial(html: string): boolean {
  return (
    html.length < 4000 &&
    html.includes("__vpn_hostname_data") &&
    html.includes("__vpn_app_hostname_data")
  );
}

/**
 * wengine cookie dance（http.ts #wengineBootstrapCookies 同语义，供 webvpnRequest 用）：
 * GET /wengine-vpn/cookie?method=get&host=<应用码|真实域名> 响应体即该域 cookie 串，
 * 全量并入会话 + refresh=0 → 调用方重放原请求（main.js vpn_update_cookie 流程）。
 */
async function wengineCookieDance(
  fetchLike: FetchLike,
  page: string,
  cookies: string,
): Promise<string> {
  const appCode = /__vpn_app_hostname_data\s*=\s*"([^"]+)"/.exec(page)?.[1] ?? "";
  const hosts = [appCode];
  try {
    const host = appCode ? decryptHost(appCode) : "";
    if (host) hosts.push(host);
  } catch {
    /* 解码失败只用应用码 */
  }
  const jar = new Map<string, string>();
  for (const pair of cookies.split(";")) {
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1));
  }
  for (const host of hosts.filter(Boolean)) {
    try {
      const u = `https://webvpn.tsinghua.edu.cn/wengine-vpn/cookie?method=get&host=${encodeURIComponent(host)}&scheme=&path=&vpn_timestamp=${Date.now()}`;
      const res = await fetchLike(u, { method: "GET", headers: { Cookie: cookies } });
      const body = await res.text();
      webvpnLog?.(`[XK-DANCE] host=${host.slice(0, 30)} body(${body.length})=${body.slice(0, 300)}`);
      if (!body.includes("<")) {
        for (const pair of body.split(";")) {
          const i = pair.indexOf("=");
          if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
        }
      }
      for (const h of splitSetCookies(res)) {
        const m = /^([^=]+)=([^;]*)/.exec(h);
        if (m) jar.set(m[1]!.trim(), m[2] ?? "");
      }
    } catch {
      /* 单 host 失败容忍 */
    }
  }
  jar.set("refresh", "0");
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

export async function webvpnRequest(
  fetchLike: FetchLike,
  method: "GET" | "POST",
  url: string,
  opts: { cookies?: string; data?: Record<string, string> | null; maxHops?: number } = {},
): Promise<WvResult> {
  const { cookies = "", data = null, maxHops = 20 } = opts;
  let currentUrl = url;
  let currentCookies = cookies;
  let danced = false;

  for (let i = 0; i < maxHops; i++) {
    const headers: Record<string, string> = {
      Cookie: currentCookies,
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    };
    let body: string | undefined;
    if (method === "POST") {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(data ?? {}).toString();
    }

    const resp = await fetchLike(currentUrl, {
      method,
      headers,
      body,
      redirect: "manual",
    });

    // 更新 cookies（demo 语义 + 同名去重：Map 后值覆盖，浏览器同款）。
    // demo 的 replace 正则在多阶段流程（登录→2FA→回调分多次调用）下会留下重复项，
    // 旧值排前会被服务端优先读取（v5.0 实测：wengine 旧 ticket 导致 learn 入口被当未登录）。
    for (const h of splitSetCookies(resp)) {
      const m = /^([^=]+)=([^;]*)/.exec(h);
      if (m) {
        const jar = new Map<string, string>();
        for (const pair of currentCookies.split(";")) {
          const t = pair.trim();
          const i = t.indexOf("=");
          if (i > 0) jar.set(t.slice(0, i), t.slice(i + 1));
        }
        jar.set(m[1]!, m[2]!);
        currentCookies = [...jar].map(([k, v]) => k + "=" + v).join("; ");
      }
    }

    if (resp.status >= 300 && resp.status < 400) {
      let location = resp.headers.get("location") ?? undefined;
      if (!location) return { html: "", cookies: currentCookies, url: currentUrl };
      if (location.startsWith("/")) location = new URL(currentUrl).origin + location;
      currentUrl = location;
      continue;
    }

    const html = await resp.text();
    if (!danced && isWengineInterstitial(html)) {
      // zhjwxk 等应用域 wengine 侧会话未建立：领 cookie 后重放一次（每次调用至多一次）
      danced = true;
      currentCookies = await wengineCookieDance(fetchLike, html, currentCookies);
      continue;
    }
    return { html, cookies: currentCookies, url: currentUrl };
  }
  throw new Error("重定向超限");
}

function msgNoteOf(html: string): string {
  const m = /id=["']msg_note["'][^>]*>([^<]*)/.exec(html);
  return m?.[1]?.trim() ?? "";
}

function stripTags(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function splitSetCookies(res: Response): string[] {
  const explicit = res.headers.get("x-onethu-set-cookie");
  if (explicit) {
    try {
      return JSON.parse(explicit) as string[];
    } catch {
      /* fallthrough */
    }
  }
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  return typeof h.getSetCookie === "function" ? h.getSetCookie() : [];
}

export type DemoLoginResult = "need_2fa" | "logged_in" | { error: string };

/** server.js POST /api/login 的逐行移植 */
export async function demoLogin(
  fetchLike: FetchLike,
  username: string,
  password: string,
  s: DemoSession,
  fingerprint = "",
  finger3 = "",
): Promise<DemoLoginResult> {
  const WEBVPN = "https://webvpn.tsinghua.edu.cn";

  // Step 1: 登录 WebVPN
  const loginPage = await webvpnRequest(fetchLike, "GET", WEBVPN + "/login", {
    cookies: s.webvpnCookies,
  });
  s.webvpnCookies = loginPage.cookies;
  const loginPageHtml = loginPage.html;
  const loginPageUrl = loginPage.url || WEBVPN + "/login";

  // 找 CAS 登录表单（webvpn 会 302 到清华 ID 登录页）
  if (!loginPageHtml.includes("i_user") && !loginPageHtml.includes("theform")) {
    if (loginPageHtml.includes("portal") || loginPageUrl.includes("portal")) {
      s.loginState = "logged_in";
      return "logged_in";
    }
    return { error: "无法获取登录表单" };
  }

  // 提取表单字段
  const formMatch = loginPageHtml.match(/<form[^>]*id="theform"[^>]*action="([^"]*)"/);
  const formAction = formMatch ? formMatch[1]! : "";
  // 只认纯 hex 长串：页面的 JS 代码里也含 "sm2publicKey" 字样，
  // demo 的宽松正则会先撞上 JS 行抓到垃圾（曾致 sm-crypto 崩溃）
  const sm2Match =
    loginPageHtml.match(/id="sm2publicKey"[^>]*>\s*([0-9a-fA-F]{100,})\s*</) ??
    loginPageHtml.match(/sm2publicKey[^>]*>\s*([0-9a-fA-F]{100,})\s*</);
  const sm2PublicKey = sm2Match ? sm2Match[1]!.trim() : "";

  // 只取 theform 内部的具名字段（页面还有语言切换等其他表单，target/locale 混入会导致 CAS 拒绝）
  const formBlock = /<form[^>]*id="theform"[^>]*>([\s\S]*?)<\/form>/.exec(loginPageHtml)?.[1] ?? loginPageHtml;
  const hiddenFields: Record<string, string> = {};
  const hiddenRe = /<input[^>]*type="hidden"[^>]*name="([^"]*)"[^>]*value="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = hiddenRe.exec(formBlock)) !== null) hiddenFields[m[1]!] = m[2]!;

  // SM2 加密密码
  const encryptedPass = encryptPassword(password, sm2PublicKey);

  // 提交登录
  const submitUrl = formAction.startsWith("http")
    ? formAction
    : new URL(formAction, loginPageUrl).toString();

  // 提交体与浏览器 doLogin() 提交 theform 完全等价：
  // 页面 JS: sm2Util.doEncryptStr(pass, publicKey) → 填进隐藏字段 name="i_pass"
  const submit = await webvpnRequest(fetchLike, "POST", submitUrl, {
    cookies: s.webvpnCookies,
    data: {
      ...hiddenFields,
      i_user: username,
      i_pass: encryptedPass,
      // 浏览器 JS 会在提交前把设备指纹填进 #fingerPrint；learn-lib 同样发送自产指纹。
      // 二次认证的"信任设备"按此字段比对——发空值会导致信任永远不生效。
      fingerPrint: fingerprint || hiddenFields.fingerPrint || "",
      // bundle: getFinger3FromLocal() 填 #fingerGenPrint —— 受信凭据，命中免 2FA
      fingerGenPrint: finger3 || hiddenFields.fingerGenPrint || "",
      fingerGenPrint3: hiddenFields.fingerGenPrint3 ?? "",
      deviceName: hiddenFields.deviceName ?? "",
      i_captcha: hiddenFields.i_captcha ?? "",
    },
  });

  s.webvpnCookies = submit.cookies;
  const submitHtml = submit.html;
  const submitUrl2 = submit.url || "";

  // 成功判定必须最先（demo 原序）：受信设备会跳过 2FA 直接落地，
  // 而落地页可能含"企业微信"等字样，宽泛关键词会误判成 2FA
  if (submitUrl2.includes("webvpn") && !submitUrl2.includes("login/form")) {
    s.loginState = "logged_in";
    return "logged_in";
  }
  if (/登录成功|正在重定向/.test(submitHtml)) {
    // 直接 id 落地成功页（含锚点），同样不是 2FA
    s.loginState = "logged_in";
    return "logged_in";
  }

  // 检查是否需要 2FA（仅在非成功页上）
  if (
    submitHtml.includes("二次认证") || // 新版 CAS 的 2FA 页标题（React SPA），demo 时代无此词
    submitHtml.includes("双因素") ||
    submitHtml.includes("二次验证") ||
    submitHtml.includes("双因子") ||
    /doubleauth/i.test(submitHtml) || // doubleAuth.bundle.js 是新版 2FA 的强标记
    submitHtml.includes("otp") ||
    submitHtml.includes("短信") ||
    submitHtml.includes("企业微信")
  ) {
    s.loginState = "need_2fa";
    s.twoFaUrl = submitUrl2;
    s.twoFaHtml = submitHtml;
    const otpFormMatch =
      submitHtml.match(/<form[^>]*action="([^"]*)"[^>]*id="otpForm"/) ??
      submitHtml.match(/<form[^>]*action="([^"]*)"[^>]*name="otp/);
    s.twoFaAction = otpFormMatch ? otpFormMatch[1]! : "";
    const otpHidden: Record<string, string> = {};
    const otpRe = /<input[^>]*type="hidden"[^>]*name="([^"]*)"[^>]*value="([^"]*)"/g;
    while ((m = otpRe.exec(submitHtml)) !== null) otpHidden[m[1]!] = m[2]!;
    s.twoFaHidden = otpHidden;
    return "need_2fa";
  }

  const reason = msgNoteOf(submitHtml) || stripTags(submitHtml).slice(0, 160) || "登录失败";
  s.debug = "FINAL-URL: " + submitUrl2 + "\nMSG: " + reason + "\nHTML: " + submitHtml.slice(0, 1800);
  return { error: reason };
}

/** server.js POST /api/login/2fa 的逐行移植 */
export async function demoLogin2fa(
  fetchLike: FetchLike,
  code: string,
  s: DemoSession,
): Promise<"logged_in" | { error: string }> {
  const otpUrl = s.twoFaAction.startsWith("http")
    ? s.twoFaAction
    : new URL(s.twoFaAction || "", s.twoFaUrl).toString();

  const result = await webvpnRequest(fetchLike, "POST", otpUrl, {
    cookies: s.webvpnCookies,
    data: { ...s.twoFaHidden, otp: code.trim() },
  });

  const finalUrl = result.url || "";
  s.webvpnCookies = result.cookies;

  if (finalUrl.includes("webvpn") && !finalUrl.includes("login/form")) {
    s.loginState = "logged_in";
    return "logged_in";
  }

  return { error: "验证码错误或已过期" };
}


/* ══════════════════════════════════════════════════════════════════
 * 新版 CAS（React doubleAuth）扩展 —— 仍是 demo 的会话模型：
 * 一个 webvpnCookies 字符串贯穿全部请求（webvpnRequest 自管理），
 * 没有域名匹配、没有 jar、没有"直连/包装"分叉。
 * ══════════════════════════════════════════════════════════════════ */

const ID_PREFIX = "https://id.tsinghua.edu.cn";
const DOUBLE_AUTH_URL = ID_PREFIX + "/b/doubleAuth/login";
const SAVE_FINGER_URL = ID_PREFIX + "/b/doubleAuth/personal/saveFinger";
const LEARN_COURSE_LIST = "https://learn.tsinghua.edu.cn/f/wlxt/index/course/student/";
/** learn 的服务端 302 CAS 入口（zhjwxk xklogin.do 的等价物） */
const LEARN_F_LOGIN = "https://learn.tsinghua.edu.cn/f/login";
/** thu-info-lib 3.16.1 roam("id", …) 的 info 门户 service 绑定 CAS 表单
 *  （10000ea… = info 门户的 service id；成功页锚点 = info 的
 *  thauth_roaming_entry?ticket=…，经 oauth lb-auth 兑付） */
const WEBVPN_ID_SERVICE_FORM =
  "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/10000ea055dd8d81d09d5a1ba55d39ad";
/** demo（thu-info-lib）login() 的第一步入口：**oauth_login=true** 的 service 即
 *  thu-oauth——成功页锚点跟跳后 oauth 域 SSO 入串。缺了它，一切经 wengine 的
 *  校园应用 CAS 入口（info 漫游/learn f-login/校园卡）都会被弹 20843963 登录页
 *  （18:36/18:45 两轮日志实锤：WRAP-ROAM 与 F-LOGIN 终点同为此页）。 */
const WEBVPN_OAUTH_LOGIN_URL = "https://webvpn.tsinghua.edu.cn/login?oauth_login=true";
const ID_CHECK_URL = "https://id.tsinghua.edu.cn/do/off/ui/auth/login/check";

/** getWebVPNUrl 的逐行等价（thu-info-lib core.ts）：非 oauth 的清华 URL 一律转成
 *  oauth lb-auth lbredirect（oauth 自身原样返回）。 */
function toLbAuthRedirect(urlIn: string): string {
  if (urlIn.includes("oauth.tsinghua.edu.cn")) return urlIn;
  const u = new URL(urlIn);
  if (!u.hostname.endsWith(".tsinghua.edu.cn")) return urlIn;
  const scheme = u.protocol.replace(":", "");
  const port = u.port || (scheme === "https" ? "443" : "80");
  const uri = u.pathname + (u.search || "") + (u.hash || "");
  return `https://oauth.tsinghua.edu.cn/lb-auth/lbredirect?scheme=${scheme}&host=${u.hostname}&port=${port}&uri=${uri}`;
}

/** 一次"取表单→直连 POST→跟锚点"的 CAS 登录（demoRoamId 内部复用）。
 *  service 由 formUrl 页面决定；返回是否拿到成功页锚点。 */
async function casServiceLogin(
  fetchLike: FetchLike,
  s: DemoSession,
  formUrl: string,
  username: string,
  password: string,
  fingerprint: string,
  finger3: string,
  trace: string[],
  tag: string,
): Promise<string> {
  const form = await webvpnRequest(fetchLike, "GET", formUrl, { cookies: s.webvpnCookies });
  s.webvpnCookies = form.cookies;
  const key = /id="sm2publicKey"[^>]*>\s*([0-9a-fA-F]{100,})\s*</.exec(form.html)?.[1] ?? "";
  trace.push(tag + "-FORM key=" + (key ? "yes" : "no") + " 终=" + form.url.slice(0, 90));
  if (!key) {
    // id 会话仍有效：表单 GET 被服务端自动发票落地（终点=service 回调），无需再 POST
    if (!form.url.includes("login/form") && !/电子身份服务系统/.test(form.html)) {
      trace.push(tag + "-AUTO 已认证直落，票据已兑付");
      return "auto:" + form.url;
    }
    return "";
  }
  const check = await webvpnRequest(fetchLike, "POST", ID_CHECK_URL, {
    cookies: s.webvpnCookies,
    data: {
      i_user: username,
      i_pass: encryptPassword(password, key),
      fingerPrint: fingerprint,
      fingerGenPrint: finger3,
      fingerGenPrint3: "",
      i_captcha: "",
    },
  });
  s.webvpnCookies = check.cookies;
  // 成功页先行（同 demoLogin：落地页可能含 doubleAuth 字样，勿用宽泛关键词抢先判定）
  const anchor = /<a[^>]+href="([^"]+)"/i.exec(check.html)?.[1] ?? "";
  const successLike = /登录成功|正在重定向/.test(check.html);
  const need2fa = !successLike && !anchor && /二次认证|doubleauth|双因素/i.test(check.html);
  trace.push(tag + "-CHECK 成功=" + (successLike ? "yes" : "no") +
    " anchor=" + (anchor ? anchor.slice(0, 70) : "(none)") + " 2fa=" + (need2fa ? "yes" : "no"));
  if (!successLike || need2fa) {
    if (!successLike) trace.push(tag + "-body=" + check.html.slice(0, 130).replace(/\s+/g, " "));
    return "";
  }
  return anchor;
}

export interface DemoApproach {
  id: string;
  label: string;
  hint?: string;
}

async function doubleAuthPost(
  fetchLike: FetchLike,
  s: DemoSession,
  params: Record<string, string>,
  url = DOUBLE_AUTH_URL,
): Promise<{ json: Record<string, unknown> | undefined; text: string }> {
  const r = await webvpnRequest(fetchLike, "POST", url, {
    cookies: s.webvpnCookies,
    data: params,
  });
  s.webvpnCookies = r.cookies;
  try {
    return { json: JSON.parse(r.html) as Record<string, unknown>, text: r.html };
  } catch {
    return { json: undefined, text: r.html };
  }
}

/** doubleAuth FIND_APPROACHES（字符串模型） */
export async function demoListMethods(fetchLike: FetchLike, s: DemoSession): Promise<DemoApproach[]> {
  const { json, text } = await doubleAuthPost(fetchLike, s, { action: "FIND_APPROACHES" });
  if (!json || json.result !== "success") {
    throw new Error(String(json?.msg ?? "获取验证方式失败") + (json ? "" : " " + text.slice(0, 120)));
  }
  const o = (json.object ?? {}) as { hasWeChatBool?: boolean; phone?: string; hasTotp?: boolean };
  const out: DemoApproach[] = [];
  if (o.hasWeChatBool) out.push({ id: "wechat", label: "企业微信" });
  if (o.phone)
    out.push({
      id: "mobile",
      label: "手机短信",
      hint: String(o.phone).replace(/(\d{3})\d+(\d{4})/, "$1****$2"),
    });
  if (o.hasTotp) out.push({ id: "totp", label: "动态口令 (TOTP)" });
  return out;
}

/** doubleAuth SEND_CODE（字符串模型） */
export async function demoSendCode(fetchLike: FetchLike, s: DemoSession, type: string): Promise<void> {
  const { json, text } = await doubleAuthPost(fetchLike, s, { action: "SEND_CODE", type });
  if (!json || json.result !== "success") {
    throw new Error(String(json?.msg ?? "发送验证码失败") + (json ? "" : " " + text.slice(0, 120)));
  }
}

/** doubleAuth VERITY(_TOTP)_CODE + redirectUrl 落地 + 回调消费（字符串模型，全部 webvpnRequest） */
export async function demoVerify2fa(
  fetchLike: FetchLike,
  s: DemoSession,
  type: string,
  code: string,
): Promise<void> {
  const action = type === "totp" ? "VERITY_TOTP_CODE" : "VERITY_CODE";
  const { json, text } = await doubleAuthPost(fetchLike, s, { action, vericode: code.trim() });
  if (!json || json.result !== "success") {
    throw new Error(String(json?.msg ?? "验证码校验失败") + (json ? "" : " " + text.slice(0, 120)));
  }
  const redirectUrl = (json.object as { redirectUrl?: string } | undefined)?.redirectUrl;
  const trace: string[] = ["VERITY ok"];
  if (redirectUrl) {
    // 落地页（登录成功）→ 回调锚点（oauth→webvpn，wengine 会话进字符串）
    const page = await webvpnRequest(fetchLike, "GET", redirectUrl.startsWith("http") ? redirectUrl : ID_PREFIX + redirectUrl, {
      cookies: s.webvpnCookies,
    });
    s.webvpnCookies = page.cookies;
    trace.push("LAND " + page.url.slice(0, 110) + " 成功=" + page.html.includes("登录成功"));
    const anchor = /<a[^>]+href="([^"]+)"/i.exec(page.html)?.[1];
    if (anchor) {
      const done = await webvpnRequest(fetchLike, "GET", anchor.startsWith("http") ? anchor : new URL(anchor, page.url).toString(), {
        cookies: s.webvpnCookies,
      });
      s.webvpnCookies = done.cookies;
      trace.push("ANCHOR " + done.url.slice(0, 110));
    }
  }
  s.loginState = "logged_in";
  s.debug = trace.join("\n");
}

/** 信任设备（SAVE_FINGER，bundle 同款参数含 singleLogin；返回 finger3 供下次登录免 2FA） */
export async function demoTrustDevice(
  fetchLike: FetchLike,
  s: DemoSession,
  fingerprint: string,
): Promise<string> {
  const { json, text } = await doubleAuthPost(
    fetchLike,
    s,
    { fingerprint, deviceName: "OneTHU", radioVal: "是", singleLogin: "" },
    SAVE_FINGER_URL,
  ).catch(() => ({ json: undefined, text: "request-failed" }) as const);
  s.debug = "SAVE_FINGER " + (json ? String(json.result) + " " + String(json.msg ?? "") : text.slice(0, 120));
  // bundle: saveFinger3Local(t.object) —— 响应 object 即 finger3
  const finger3 = json?.result === "success" ? String(json.object ?? "") : "";
  return finger3 && finger3 !== "[object Object]" ? finger3 : "";
}

/** thu-info-lib 3.16.1 login() + roam("id", "10000ea055dd8d81d09d5a1ba55d39ad")
 *  的等价实现（真 demo：thu-app/packages/thu-info-lib）——两段式：
 *  ① thu-oauth SSO：GET webvpn/login?oauth_login=true（service=thu-oauth）→
 *     直连 POST check → 成功页锚点（thu-oauth callback）跟跳 → oauth 会话入串。
 *     缺它则一切经 wengine 的校园应用 CAS 入口被弹 thu-oauth 登录页（日志实锤）。
 *  ② info service 登录（10000ea…）→ 成功页锚点（info thauth_roaming_entry?ticket）
 *     → getWebVPNUrl 转 oauth lb-auth 兑付 → wengine 服务端建立 info 会话，
 *     此后包装的 info/zhjw/card 请求透明 SSO。
 *  失败不阻断登录链（learn 直连路径独立），仅记独立诊断 idRoamDebug。 */
export async function demoRoamId(
  fetchLike: FetchLike,
  s: DemoSession,
  username: string,
  password: string,
  fingerprint: string,
  finger3 = "",
): Promise<void> {
  const trace: string[] = [];
  try {
    // ① thu-oauth SSO（demo login() 第一段）
    const anchor1 = await casServiceLogin(
      fetchLike, s, WEBVPN_OAUTH_LOGIN_URL, username, password, fingerprint, finger3, trace, "OAUTH",
    );
    if (anchor1 && !anchor1.startsWith("auto:")) {
      const t1 = anchor1.startsWith("http") ? anchor1 : new URL(anchor1, "https://id.tsinghua.edu.cn/").toString();
      const done1 = await webvpnRequest(fetchLike, "GET", t1, { cookies: s.webvpnCookies });
      s.webvpnCookies = done1.cookies;
      trace.push("OAUTH-LAND 终=" + done1.url.slice(0, 95));
    }
    // ② info service 登录 + 票据兑付（demo roam("id") 段）
    const anchor2 = await casServiceLogin(
      fetchLike, s, WEBVPN_ID_SERVICE_FORM, username, password, fingerprint, finger3, trace, "INFO",
    );
    if (anchor2 && !anchor2.startsWith("auto:")) {
      const t2 = anchor2.startsWith("http") ? anchor2 : new URL(anchor2, "https://id.tsinghua.edu.cn/").toString();
      // info 与 learn 同款：票据**直连**兑付（会话落在客户端，HttpClient 对 info
      // 域一律直连）。wengine 代理路径实证 403（19:00），废弃；真校外才需 lb-auth。
      try {
        const done2 = await webvpnRequest(fetchLike, "GET", t2, { cookies: s.webvpnCookies });
        s.webvpnCookies = done2.cookies;
        const bounced = /电子身份服务系统|do\/off\/ui\/auth\/login/.test(done2.url);
        trace.push("DIRECT终=" + done2.url.slice(0, 100) +
          (bounced ? "（仍弹CAS body=" + done2.html.slice(0, 110).replace(/\s+/g, " ") + "）" : "（info 会话已建立）"));
      } catch (directErr) {
        const lb = toLbAuthRedirect(t2);
        trace.push("直连失败(" + String(directErr).slice(0, 40) + ") → LB " + lb.slice(0, 100));
        const done2 = await webvpnRequest(fetchLike, "GET", lb, { cookies: s.webvpnCookies });
        s.webvpnCookies = done2.cookies;
        trace.push("LB终=" + done2.url.slice(0, 100));
      }
    }
  } catch (e) {
    trace.push("fail " + String(e));
  }
  s.idRoamDebug = "ROAM-ID " + trace.join(" | ");
}

/** demo card.ts cardLogin 的等价：roam(helper, "card", "eea30cbe…/0?/userindex")——
 *  卡片 service CAS 表单登录 → 锚点**直连**兑付（demo 对 card 策略不做 lb-auth
 *  转换，锚点原样跟跳），card 会话落在客户端。失败仅记 idRoamDebug。 */
export async function demoRoamCard(
  fetchLike: FetchLike,
  s: DemoSession,
  username: string,
  password: string,
  fingerprint: string,
  finger3 = "",
): Promise<void> {
  const trace: string[] = [];
  try {
    const anchor = await casServiceLogin(
      fetchLike, s,
      "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/eea30cbedcaf97c69d28b2d92f22a259/0?/userindex",
      username, password, fingerprint, finger3, trace, "CARD",
    );
    if (anchor && !anchor.startsWith("auto:")) {
      const t = anchor.startsWith("http") ? anchor : new URL(anchor, "https://id.tsinghua.edu.cn/").toString();
      const done = await webvpnRequest(fetchLike, "GET", t, { cookies: s.webvpnCookies });
      s.webvpnCookies = done.cookies;
      const bounced = /电子身份服务系统|do\/off\/ui\/auth\/login/.test(done.url);
      trace.push("CARD终=" + done.url.slice(0, 100) + (bounced ? "（弹CAS）" : "（card 会话已建立）"));
    }
  } catch (e) {
    trace.push("fail " + String(e));
  }
  s.idRoamDebug = "ROAM-CARD " + trace.join(" | ");
}

/** learn 会话建立 —— thu-learn-lib getRoamingTicket+login 的逐行移植（字符串会话）：
 *  1. GET learn 专属 service 表单（bb5df852…）
 *  2. POST 完整登录（learn-lib 字段集；受信设备 fingerPrint 免 2FA）
 *  3. 响应锚点提取 ticket → GET learn 漫游入口 → learn 会话进字符串
 *  4. 课程页提取 _csrf
 *  密码只存在于本次调用栈，不落盘。 */
export async function demoEnterLearn(
  fetchLike: FetchLike,
  s: DemoSession,
  username: string,
  password: string,
  fingerprint: string,
  finger3 = "",
): Promise<string | "need-2fa"> {
  const CAS_FORM = "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/bb5df85216504820be7bba2b0ae1535b/0";
  const CAS_CHECK = "https://id.tsinghua.edu.cn/do/off/ui/auth/login/check";
  const trace: string[] = [];

  // 快照 id CAS 主会话：此刻字符串里的 JSESSIONID 仍是 id 的（进入 learn 后会被同名覆盖）。
  // 首次捕获为准（后续调用字符串里已是 learn 会话）。
  s.idJsid ||= /JSESSIONID=([^;\s]+)/.exec(s.webvpnCookies)?.[1] ?? "";

  // ── 路径一（demo 模型，单次 2FA）：wrapped /f/login 是 learn 的服务端 302 CAS 入口
  //    （zhjwxk xklogin.do 的等价物；首页 / 只是静态登录页）
  try {
    const entry = await webvpnRequest(fetchLike, "GET", webvpnWrap(LEARN_F_LOGIN), {
      cookies: s.webvpnCookies,
    });
    s.webvpnCookies = entry.cookies;
    trace.push("F-LOGIN终=" + entry.url.slice(0, 110) + " body=" + entry.html.slice(0, 120).replace(/\s+/g, " "));
    const course = await webvpnRequest(fetchLike, "GET", LEARN_COURSE_LIST, {
      cookies: s.webvpnCookies,
    });
    s.webvpnCookies = course.cookies;
    const csrf1 = /_csrf=([^&"'\s<]+)/.exec(course.html)?.[1] ?? null;
    trace.push("COURSE csrf=" + (csrf1 ? "yes" : "no") + " title=" +
      (/<title>([^<]*)/.exec(course.html)?.[1] ?? "?") + " timeout=" + course.html.includes("登录超时") +
      " csrfCount=" + (course.html.match(/_csrf/g) ?? []).length);
    if (csrf1) {
      s.debug = "[f-login] " + trace.join(" | ");
      return csrf1;
    }
  } catch (e) {
    trace.push("f-login失败 " + String(e));
  }

  // 1. 表单页（拿公钥；learn-lib：先清 JSESSIONID 保证拿的是新表单——字符串模型全量覆盖，天然满足）
  const form = await webvpnRequest(fetchLike, "GET", CAS_FORM, { cookies: s.webvpnCookies });
  s.webvpnCookies = form.cookies;
  const key = /id="sm2publicKey"[^>]*>\s*([0-9a-fA-F]{100,})\s*</.exec(form.html)?.[1] ?? "";
  trace.push("FORM " + form.url.slice(0, 100) + " key=" + (key ? "yes" : "no") +
    " auth=" + (/"authenticated"\s*:\s*(true|false)/.exec(form.html)?.[1] ?? "?"));
  if (!key) {
    s.debug = trace.join(" | ");
    throw new Error("无法获取 learn 登录表单");
  }

  // 2. 完整登录 POST（learn-lib 字段集：i_pass=密文、fingerPrint、空验证码）
  const cookieNames = () =>
    s.webvpnCookies.split(";").map((x) => x.trim().split("=")[0]).filter(Boolean).join(",");
  const jsid = () => /JSESSIONID=([^;\s]+)/.exec(s.webvpnCookies)?.[1]?.slice(0, 8) ?? "(none)";
  const enc = encryptPassword(password, key);
  trace.push("POST前cookies=" + cookieNames() + " jsid=" + jsid());
  const check = await webvpnRequest(fetchLike, "POST", CAS_CHECK, {
    cookies: s.webvpnCookies,
    data: {
      i_user: username,
      i_pass: enc,
      // singleLogin=on 是"踢掉其他会话"，疑似强制二次验证；浏览器默认不勾选 → 不发
      fingerPrint: fingerprint,
      fingerGenPrint: finger3,
      fingerGenPrint3: "",
      i_captcha: "",
    },
  });
  s.webvpnCookies = check.cookies;
  trace.push("CHECK终=" + check.url.slice(0, 100) + " POST后jsid=" + jsid() + " cookies=" + cookieNames());

  // 3. 锚点 ticket → 漫游入口（learn-lib：redirectUrl.split('=').slice(-1)）
  //    成功页判定必须先于 2FA 关键词（受信设备直接发票，成功页可能含宽泛词）
  const anchor = /<a[^>]+href="([^"]+)"/i.exec(check.html)?.[1] ?? "";
  const ticket = anchor ? anchor.split("=").slice(-1)[0]! : "";
  trace.push("anchor=" + (anchor ? anchor.slice(0, 80) : "(none)") + " ticket=" + (ticket ? "yes" : "no"));

  if (!anchor && /二次认证|doubleauth|双因素/i.test(check.html) && !/登录成功|正在重定向/.test(check.html)) {
    s.debug = trace.join(" | ") + " | learn 触发二次认证页（第二轮）";
    return "need-2fa";
  }
  if (anchor && ticket) {
    const roamUrl = anchor.startsWith("http") ? anchor : "https://learn.tsinghua.edu.cn/b/j_spring_security_thauth_roaming_entry?ticket=" + ticket;
    const roam = await webvpnRequest(fetchLike, "GET", roamUrl, { cookies: s.webvpnCookies });
    s.webvpnCookies = roam.cookies;
    trace.push("ROAM终=" + roam.url.slice(0, 100) + " cookies=" +
      s.webvpnCookies.split(";").map((x) => x.trim().split("=")[0]).filter(Boolean).join(","));

    // learn 会话在直连下有效（ROAM 直连落地实证）；代理链会丢/混 JSESSIONID，learn 一律直连
    const course = await webvpnRequest(fetchLike, "GET", LEARN_COURSE_LIST, { cookies: s.webvpnCookies });
    s.webvpnCookies = course.cookies;
    const csrf = /_csrf=([^&"'\s<]+)/.exec(course.html)?.[1] ?? null;
    trace.push("COURSE csrf=" + (csrf ? "yes" : "no") + " body=" + course.html.slice(0, 140).replace(/\s+/g, " "));
    if (csrf) {
      s.debug = "[learn-lib] " + trace.join(" | ");
      return csrf;
    }
  } else {
    trace.push("CHECK body=" + check.html.slice(0, 240).replace(/\s+/g, " "));
  }

  s.debug = trace.join("\n");
  throw new Error("网络学堂会话建立失败");
}

/** learn 第二轮 2FA 完成后的收尾：验证链会经漫游入口落地 learn 会话 → 课程页取 csrf */
export async function demoFinishLearn(fetchLike: FetchLike, s: DemoSession): Promise<string> {
  const course = await webvpnRequest(fetchLike, "GET", LEARN_COURSE_LIST, { cookies: s.webvpnCookies });
  s.webvpnCookies = course.cookies;
  const csrf = /_csrf=([^&"'\s<]+)/.exec(course.html)?.[1] ?? null;
  s.debug = "FINISH course=" + course.url.slice(0, 100) + " csrf=" + (csrf ? "yes" : "no") +
    " body=" + course.html.slice(0, 200).replace(/\s+/g, " ");
  if (!csrf) throw new Error("网络学堂会话建立失败（第二轮验证后）");
  return csrf;
}

/** resume 后 learn 会话过期的重新漫游（字符串模型，不需密码）：
 *  demo"只登录一次"的本质 = 已认证 id CAS 会话随要随发票。learn 的 8 分钟会话过期后，
 *  把持久化的 id 主会话写回字符串，GET learn 专属 CAS 表单 → 服务端 302 直发 ticket
 *  → 漫游入口落地 learn 会话 → 课程页取 csrf。id/webvpn 会话仍有效时全程免密。 */
export async function demoReenterLearn(
  fetchLike: FetchLike,
  s: DemoSession,
  idJsid: string,
): Promise<string> {
  const CAS_FORM = "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/bb5df85216504820be7bba2b0ae1535b/0";
  const trace: string[] = ["RE-ROAM jsid=" + (idJsid ? idJsid.slice(0, 8) + "…" : "(none)")];

  // 1. 写回 id 主会话（此时字符串里的 JSESSIONID 是已过期的 learn 会话）
  if (idJsid) {
    s.webvpnCookies = /JSESSIONID=/.test(s.webvpnCookies)
      ? s.webvpnCookies.replace(/JSESSIONID=[^;]*/, "JSESSIONID=" + idJsid)
      : s.webvpnCookies + "; JSESSIONID=" + idJsid;
  }

  // 2. CAS 表单：id 会话已认证 → 服务端 302 一路发票到 learn（webvpnRequest 手动跟跳）
  const form = await webvpnRequest(fetchLike, "GET", CAS_FORM, { cookies: s.webvpnCookies });
  s.webvpnCookies = form.cookies;
  trace.push("CAS终=" + form.url.slice(0, 110) +
    " auth=" + (/"authenticated"\s*:\s*(true|false)/.exec(form.html)?.[1] ?? "?"));

  // 3. 兜底：CAS 未 302 而是返回成功页（含锚点链接）→ 手动点锚点
  if (!form.url.includes("learn.tsinghua.edu.cn")) {
    const anchor = /<a[^>]+href="([^"]*ticket=[^"]*)"/i.exec(form.html)?.[1];
    if (anchor) {
      const roam = await webvpnRequest(fetchLike, "GET",
        anchor.startsWith("http") ? anchor : new URL(anchor, form.url).toString(),
        { cookies: s.webvpnCookies });
      s.webvpnCookies = roam.cookies;
      trace.push("ANCHOR终=" + roam.url.slice(0, 110));
    } else {
      trace.push("no-anchor body=" + form.html.slice(0, 160).replace(/\s+/g, " "));
    }
  }

  // 4. 课程页（直连）取 csrf
  const course = await webvpnRequest(fetchLike, "GET", LEARN_COURSE_LIST, { cookies: s.webvpnCookies });
  s.webvpnCookies = course.cookies;
  const csrf = /_csrf=([^&"'\s<]+)/.exec(course.html)?.[1] ?? null;
  trace.push("COURSE csrf=" + (csrf ? "yes" : "no") + " timeout=" + course.html.includes("登录超时") +
    " title=" + (/<title>([^<]*)/.exec(course.html)?.[1] ?? "?"));
  s.debug = trace.join(" | ");
  if (!csrf) throw new Error("重新漫游失败（id CAS 会话可能已过期，需重新登录）");
  return csrf;
}

