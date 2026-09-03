/**
 * 体育场馆系统（sports.tsinghua.edu.cn）桌面装配：
 * - VenueClient + token 生命周期（localStorage 持久化 + JWT exp 校验）
 * - 授权窗口（Rust open_sports_window）：webview 打开体育系统 → 用户完成 CAS 登录 →
 *   前端从 localStorage.headers 抓 JWT → 回传事件 → 存储并关闭窗口。
 * - onVenueAuthRequired：token 失效时各调用点走统一的「重新授权」路径。
 */
import { DOUBLE_AUTH_URL, list2FAMethods, trustDevice, VenueApiError, VenueAuthRequiredError, VenueClient, venueTokenExpiresAt, type VenueScene, type TwoFactorMethod } from "@onethu/core";
import { isTauri, universalFetch } from "./transport.js";
import { logLine } from "./clients.js";

const TOKEN_KEY = "onethu.venueToken";

function readStoredToken(): string | null {
  try {
    const t = globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
    if (!t) return null;
    const exp = venueTokenExpiresAt(t);
    if (exp !== null && exp <= Date.now()) return null; // 过期视为无 token
    return t;
  } catch {
    return null;
  }
}

export const venueClient = new VenueClient({
  fetch: universalFetch,
  log: (line) => void logLine(line),
});
venueClient.setToken(readStoredToken());

/** 体育登录被 CAS 要求二次认证（随错误携带可用验证方式） */
export class VenueTwoFactorRequired extends Error {
  methods: TwoFactorMethod[];
  constructor(methods: TwoFactorMethod[]) {
    super("该账号需要二次认证");
    this.name = "VenueTwoFactorRequired";
    this.methods = methods;
  }
}

export function venueHasToken(): boolean {
  return readStoredToken() !== null;
}

export function setVenueToken(token: string | null): void {
  try {
    if (token) globalThis.localStorage?.setItem(TOKEN_KEY, token);
    else globalThis.localStorage?.removeItem(TOKEN_KEY);
  } catch {
    /* 无 localStorage 环境忽略 */
  }
  venueClient.setToken(token);
}

export function clearVenueToken(): void {
  setVenueToken(null);
}

/**
 * 确保拿到体育 token：优先用 OneTHU 现有 CAS 统一会话静默换票（零交互）；
 * TGT 失效/缺才 false（调用方决定是否开窗口兜底）。
 */
export async function ensureVenueToken(): Promise<boolean> {
  if (venueHasToken()) return true;
  const pickUni = (src: string): string | null => /[?&]uniToken=([^&\s"'<>]+)/.exec(src)?.[1] ?? null;
  // ① 传输层同源链：直连取 CAS 登录链（jar 里 id 桶 TGT 活着时直接出票）。
  //    必须 direct：sports/id 均为公网域名，无需 WebVPN 包装；且包装层失登
  //    检测会抛 core AuthRequiredError → 全局看门狗整页 reload——场馆静默
  //    登录失败绝不该炸整个应用（pnpm 预览硬刷新事故的根源）。
  try {
    const { http } = await import("./clients.js");
    const casAddr = await venueClient.casAddress("https://www.sports.tsinghua.edu.cn/venue/index.html");
    const res = await http.request(casAddr, { redirect: "follow", direct: true });
    const finalUrl = res.headers.get("x-onethu-final-url") ?? "";
    const body = await res.text();
    const uni = pickUni(finalUrl) ?? pickUni(body);
    if (uni) {
      setVenueToken(await venueClient.exchangeUniToken(decodeURIComponent(uni)));
      await logLine("[VENUE-SSO] 会话链换票成功（传输层同源）");
      return true;
    }
    await logLine(`[VENUE-SSO] 会话链无票据 final=${finalUrl.slice(0, 160)}`);
  } catch (err) {
    await logLine("[VENUE-SSO] 会话链异常 " + String(err));
  }
  // ② 直连链兜底（直连模式 TGT 活着时走这里）
  try {
    const t = await venueClient.ssoLogin();
    setVenueToken(t);
    await logLine("[VENUE-SSO] 直连链换票成功");
    return true;
  } catch (err) {
    await logLine("[VENUE-SSO] 直连链失败 " + String(err));
    return false;
  }
}

/**
 * 统一凭证程序化 CAS 登录（TGT 失效时的无感补救，确定性路径）：
 * 场馆链尾落在 id CAS 登录表单 → 用记住的统一凭证按主登录同款字段直连提交
 * （SM2 双写 + 隐藏字段原样）→ 成功页首个锚点 = 本 service 的票据回调 →
 * 直连跟链到终 URL 取 uniToken → /cas/token 换 JWT。
 * 全程不依赖 TGT 进桶与二次换票链（并发登录互踢也不受影响）；
 * 需要 2FA / 图形验证码时抛错，调用方退回授权窗口。
 */
async function casFormRelogin(): Promise<void> {
  const core = await import("@onethu/core");
  const { http, session, loadRemembered, currentFingerprint } = await import("./clients.js");
  const remembered = await loadRemembered();
  const username = session.username;
  if (!username || !remembered?.password) {
    throw new VenueAuthRequiredError("本机无记住的统一身份凭证");
  }
  const ID = "https://id.tsinghua.edu.cn";
  const pickUni = (src: string): string | null => /[?&]uniToken=([^&\s"'<>]+)/.exec(src)?.[1] ?? null;
  const casAddr = await venueClient.casAddress("https://www.sports.tsinghua.edu.cn/venue/index.html");
  // 跟链取表单（HTTP 30x 由 transport 跟；meta/JS 跳转页手动跟，最多 3 跳）
  let hopUrl = casAddr;
  let formHtml = "";
  let finalUrl = "";
  for (let i = 0; i < 6; i++) {
    const res = await http.request(hopUrl, { redirect: "follow", direct: true });
    finalUrl = res.headers.get("x-onethu-final-url") ?? res.url ?? hopUrl;
    formHtml = await res.text();
    const uniNow = pickUni(finalUrl) ?? pickUni(formHtml);
    if (uniNow) {
      setVenueToken(await venueClient.exchangeUniToken(decodeURIComponent(uniNow)));
      await logLine("[VENUE-SSO] 链上直接兑付 uniToken 成功（TGT 存活）");
      return;
    }
    // 单点登录冲突确认页（checkSingle）：原样回传隐藏字段确认"继续登录"
    if (/login\/checkSingle|id="logined"/.test(formHtml)) {
      const act =
        /<form[^>]*action="([^"]*)"[^>]*id="logined"/.exec(formHtml)?.[1] ??
        /<form[^>]*id="logined"[^>]*action="([^"]*)"/.exec(formHtml)?.[1] ??
        "/do/off/ui/auth/login/checkSingle";
      const fields: Record<string, string> = {};
      const reH = /<input[^>]*type="hidden"[^>]*name="([^"]*)"[^>]*value="([^"]*)"/g;
      let mh: RegExpExecArray | null;
      while ((mh = reH.exec(formHtml)) !== null) fields[mh[1]!] = mh[2]!;
      await logLine("[VENUE-SSO] 单点冲突确认页 → checkSingle 继续");
      const post = await http.request(new URL(act, ID).toString(), {
        method: "POST",
        body: new URLSearchParams(fields),
        redirect: "follow",
        direct: true,
      });
      finalUrl = post.headers.get("x-onethu-final-url") ?? "";
      formHtml = await post.text();
      if (/二次认证|双因素|二次验证/.test(formHtml)) {
        throw new VenueTwoFactorRequired(await list2FAMethods(http));
      }
      const uni2 = pickUni(finalUrl) ?? pickUni(formHtml);
      if (uni2) {
        setVenueToken(await venueClient.exchangeUniToken(decodeURIComponent(uni2)));
        await logLine("[VENUE-SSO] checkSingle 后直接兑付成功");
        return;
      }
      if (formHtml.includes("登录成功")) {
        const a2 = /<a[^>]+href="([^"]+)"/i.exec(formHtml)?.[1];
        if (a2) {
          const a2u = a2.startsWith("http") ? a2 : new URL(a2, ID).toString();
          const cb = await http.request(a2u, { redirect: "follow", direct: true });
          const f2 = cb.headers.get("x-onethu-final-url") ?? "";
          const uni3 = pickUni(f2) ?? pickUni(await cb.text());
          if (uni3) {
            setVenueToken(await venueClient.exchangeUniToken(decodeURIComponent(uni3)));
            await logLine("[VENUE-SSO] checkSingle 锚点兑付成功");
            return;
          }
        }
      }
      continue; // POST 结果通常是登录表单 → 回循环顶
    }
    const js =
      /http-equiv=["']?refresh["']?[^>]*url=([^"'>]+)/i.exec(formHtml)?.[1] ??
      /(?:location\.href(?:\s*=\s*[^"']*)?|window\.location(?:\.href)?)\s*=\s*["']([^"']+)["']/i.exec(formHtml)?.[1];
    if (js && !/sm2publicKey/.test(formHtml)) {
      hopUrl = js.startsWith("http") ? js : new URL(js, hopUrl).toString();
      continue;
    }
    break;
  }
  if (!/sm2publicKey/.test(formHtml)) {
    await logLine(`[VENUE-SSO] 链尾非表单 final=${finalUrl.slice(0, 200)} body=${formHtml.slice(0, 160).replace(/\s+/g, " ")}`);
    throw new VenueAuthRequiredError("CAS 链尾不是登录表单");
  }
  const form = core.parseCasFormHtml(formHtml, false);
  const enc = core.sm2crypto.encryptPassword(remembered.password, form.publicKey);
  const body = new URLSearchParams({
    ...form.hiddenFields,
    i_user: username,
    i_pass: enc,
    sm2pass: enc,
    // 不踢浏览器既有 CAS 会话（踢人登录会触发 CAS 强制二次认证）；
    // 并行会话共存 → 浏览器侧不受影响，本端也免 2FA
    singleLogin: "off",
    fingerPrint: await currentFingerprint(),
    fingerGenPrint: "",
    fingerGenPrint3: "",
    i_captcha: "",
  });
  const submitUrl = form.action
    ? form.action.startsWith("http")
      ? form.action
      : new URL(form.action, ID).toString()
    : core.CAS_LOGIN_CHECK;
  const check = await http.request(submitUrl, { method: "POST", body, redirect: "follow", direct: true });
  const checkHtml = await check.text();
  if (/二次认证|双因素|二次验证|双因子|otp|短信|企业微信/.test(checkHtml)) {
    throw new VenueTwoFactorRequired(await list2FAMethods(http));
  }
  if (!checkHtml.includes("登录成功")) {
    throw new VenueApiError(core.extractCasReason(checkHtml), "CAS");
  }
  // 成功页首个锚点 = 本 service 的票据回调；直连跟链，终 URL/正文取 uniToken —— 确定性兑付
  const anchor = /<a[^>]+href="([^"]+)"/i.exec(checkHtml)?.[1];
  let uni: string | null = null;
  if (anchor) {
    const anchorUrl = anchor.startsWith("http") ? anchor : new URL(anchor, ID).toString();
    const cb = await http.request(anchorUrl, { redirect: "follow", direct: true });
    const finalUrl = cb.headers.get("x-onethu-final-url") ?? cb.url ?? "";
    uni = pickUni(finalUrl) ?? pickUni(await cb.text());
  }
  if (!uni) {
    // 兜底：登录已成功（TGT 已进桶），重走换票链
    setVenueToken(await venueClient.ssoLogin());
    return;
  }
  setVenueToken(await venueClient.exchangeUniToken(decodeURIComponent(uni)));
  await logLine("[VENUE-SSO] 统一凭证 CAS 表单登录 + 票据兑付成功");
}

/** 静默全套（无窗口）：换票链 → 失败则统一凭证 CAS 表单重登 → 再换票。
 *  并发守卫：CAS singleLogin 下两次并发登录互踢（StrictMode 双挂载实测），共享一次执行。 */
let silentInFlight: Promise<boolean> | null = null;
export function venueSilentLogin(): Promise<boolean> {
  if (silentInFlight) return silentInFlight;
  silentInFlight = (async () => {
    if (venueHasToken()) return true;
    if (await ensureVenueToken()) return true;
    try {
      await casFormRelogin();
    } catch (err) {
      if (err instanceof VenueTwoFactorRequired) throw err; // UI 弹 2FA 面板
      await logLine("[VENUE-SSO] CAS 表单重登不可用 " + String(err));
      return false;
    }
    return ensureVenueToken();
  })().finally(() => {
    silentInFlight = null;
  });
  return silentInFlight;
}

/**
 * 体育登录二次认证：校验验证码 → 成功页锚点兑付 uniToken → 换 JWT → 信任设备。
 * （doubleAuth 接口是 CAS 会话级的，服务的就是当前挂起的体育 relay。）
 */
export async function venueSubmit2FA(type: string, code: string): Promise<boolean> {
  const { http, currentFingerprint } = await import("./clients.js");
  const { extractCasReason } = await import("@onethu/core");
  const ID = "https://id.tsinghua.edu.cn";
  const body = new URLSearchParams({
    action: type === "totp" ? "VERITY_TOTP_CODE" : "VERITY_CODE",
    vericode: code.trim(),
  });
  const text = await http.text(DOUBLE_AUTH_URL, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    direct: true,
  });
  let json: { result?: string; msg?: string; object?: { redirectUrl?: string } };
  try {
    json = JSON.parse(text);
  } catch {
    throw new VenueApiError("二次认证接口返回异常", "2FA");
  }
  if (json.result !== "success") throw new VenueApiError(json.msg ?? "验证码错误或已过期", "2FA");
  const redirectUrl = json.object?.redirectUrl;
  if (!redirectUrl) throw new VenueApiError("二次认证未返回跳转地址", "2FA");
  const html = await http.text(redirectUrl.startsWith("http") ? redirectUrl : ID + redirectUrl, { direct: true });
  if (!html.includes("登录成功")) throw new VenueApiError(extractCasReason(html), "2FA");
  const anchor = /<a[^>]+href="([^"]+)"/i.exec(html)?.[1];
  const pickUni = (src: string): string | null => /[?&]uniToken=([^&\s"'<>]+)/.exec(src)?.[1] ?? null;
  let token: string | null = null;
  if (anchor) {
    const anchorUrl = anchor.startsWith("http") ? anchor : new URL(anchor, ID).toString();
    const cb = await http.request(anchorUrl, { redirect: "follow", direct: true });
    const finalUrl = cb.headers.get("x-onethu-final-url") ?? "";
    const uni = pickUni(finalUrl) ?? pickUni(await cb.text());
    if (uni) token = await venueClient.exchangeUniToken(decodeURIComponent(uni));
  }
  if (!token) token = await venueClient.ssoLogin(); // TGT 已刷新，重走换票链兜底
  setVenueToken(token);
  void trustDevice(http, await currentFingerprint()).catch(() => undefined); // 信任设备，下次免 2FA
  await logLine("[VENUE-SSO] 二次认证完成，体育 token 到手");
  return true;
}

/** 体育登录 2FA 发码（非 totp 方式） */
export async function venueSend2FACode(type: string): Promise<void> {
  const { http } = await import("./clients.js");
  const { send2FACode } = await import("@onethu/core");
  await send2FACode(http, type);
}

/** 一键登录（按钮）：静默全套 → 仍失败才开授权窗口兜底 */
export async function venueLogin(): Promise<boolean> {
  if (await venueSilentLogin()) return true;
  return openVenueAuth();
}

/**
 * 内嵌官方预约页（主窗口 tab 内 iframe 用，不弹任何独立窗口）。
 * 官方 SPA 开机只读 localStorage["token"]（getParams→storage.getItem，
 * ?token= URL 参数启动逻辑并不解析）；而自定义协议源的 localStorage 写入
 * 不可靠（实测二次加载即丢）——故 token 经 venue_sso_set 推给 Rust，由
 * venueview 反代对每个 HTML 文档注入预置脚本，页面无论怎么自跳转都有
 * 登录态。#/reserveList?uuid= 直达所选场馆。预约动作仍由用户在官方页面
 * 上手动完成；OneTHU 不调用任何预约接口（预约须知第 12 条）。
 * 非 Tauri / 无 token → null（调用方回落系统浏览器）。
 */
export async function venueBookingEmbedUrl(sceneUuid: string): Promise<string | null> {
  void sceneUuid;
  // 内嵌链路熔断：登录循环反复撞 CAS 单点冲突，把账号会话顶坏（用户实测）。
  // 原因链已查明（后端要 换票链会话 Cookie，不只 JWT），Cookie 补丁已写好，
  // 但未经真机验证前不再放出——按钮一律回落系统浏览器深链。
  return null;
}

/** 授权是否进行中（防重复开窗） */
let authInFlight = false;

/**
 * 打开体育系统授权窗口；token 到手（Rust 侧 emit "sports-token"）后 resolve true。
 * 用户直接关窗 → resolve false（不视为错误）。
 */
export function openVenueAuth(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!isTauri) {
      void logLine("[VENUE-AUTH] 非 Tauri 环境无法打开授权窗口");
      resolve(false);
      return;
    }
    if (authInFlight) {
      resolve(false);
      return;
    }
    authInFlight = true;
    let settled = false;
    // 授权窗口最长 10 分钟（Rust 侧同步超时），超时未拿到 token 视为取消
    const timeout = setTimeout(() => finish(false), 10 * 60 * 1000 + 8000);
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      authInFlight = false;
      unlisten?.catch(() => undefined);
      resolve(ok);
    };
    let unlisten: Promise<() => void> | null = null;
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = listen<string>("sports-token", (ev) => {
          const token = typeof ev.payload === "string" ? ev.payload : "";
          if (token.length > 20) {
            setVenueToken(token);
            void logLine("[VENUE-AUTH] token 到手（长度 " + token.length + "）");
          }
          finish(token.length > 20);
        });
        await invoke("open_sports_window");
      } catch (err) {
        void logLine("[VENUE-AUTH] 打开授权窗口失败 " + String(err));
        finish(false);
      }
    })();
  });
}

/* ------------------------- 场馆目录会话级缓存 ------------------------- */
let sceneCache: VenueScene[] | null = null;

/** 场馆目录（会话级缓存；空数据不缓存以便重试） */
export async function venueScenes(): Promise<VenueScene[]> {
  if (sceneCache && sceneCache.length) return sceneCache;
  const list = await venueClient.sceneList();
  if (list.length) sceneCache = list;
  return list;
}

/** 登出时清 token（与 info 会话解耦但跟随登出，避免串账号） */
export function venueLogout(): void {
  sceneCache = null;
  clearVenueToken();
}
