/**
 * 云盘自动连接（爬 profile 页的 Web API Token，自动填充，无需手动粘贴）。
 *
 * **复用统一 jar 的正门**（docs/外部作业源-需求与实现方案.md：TUOJ 统一认证同款）：
 *   GET cloud.tsinghua.edu.cn/profile/（带 jar，follow）→ oauth thu-oauth → id CAS
 *   ① 落 checkSingle 指纹确认页（id 会话活着）→ InfoClient.confirmIdCheckSingle 确认取票+兑付
 *   ② 落真登录表单（sm2publicKey，id 会话不在）→ InfoClient.ensureDirectIdLogin 账密直登 id
 *      （凭据来自 CampusSession 内存，零用户输入），再重走一次 profile
 *   ③ 落 profile → 抠 40 位 hex Token → setSeafileToken 校验落盘
 * 只走 OneTHU 这一份统一 jar：不另开 WebView、不手写 checkSingle POST、不走 WebVPN 包装副本。
 * 二次认证（id 端 2FA）由底层抛 AuthRequiredError → 转可操作文案，请用户在 OneTHU 重新登录
 * 并勾选「信任此设备」，之后长期免验证。
 *
 * 形态 A（老模板）：token 渲染在 <input>/<span>（40 位 hex）
 * 形态 B（SPA）：var app = {pageOptions: {..., apiToken: "hex40"}}
 */
import { http } from "../lib/clients.js";
import { logLine } from "../lib/clients.js";
import { setSeafileToken, type SeafileAccount } from "./seafile.js";
import type { TwoFactorMethod } from "@onethu/core";

const PROFILE_URL = "https://cloud.tsinghua.edu.cn/profile/";

/** checkSingle 指纹确认页（id 会话活着，与 core/exthw/tuojCas.ts isCheckSinglePage 同判据） */
const CHECKSINGLE_RE = /checkSingle/;
/** 真·CAS 登录表单（id 会话不在；与 core isCasLoginPage 同判据，只认正文，不认 URL） */
const CAS_LOGIN_RE = /id="sm2publicKey"|name="sm2publicKey"|name="i_pass"/;
/** 统一认证要求二次认证（id 端 2FA） */
const TWO_FACTOR_RE = /二次认证|双因素|二次验证|双因子|twoFactorAuthView|FIND_APPROACHES/;

const TWO_FACTOR_MSG =
  "清华统一认证要求二次认证：请在 OneTHU 里重新登录清华账号并勾选「信任此设备」，之后云盘会自动连接。";

/** profile HTML → 40 位访问口令（形态 A 模板/B SPA 都兼容）；WebView 回退通道共用 */
export function extractToken(html: string): string | null {
  // 形态 B：pageOptions.apiToken（SPA）
  const m =
    /apiToken["']?\s*[:=]\s*["']([0-9a-f]{40})["']/i.exec(html) ??
    /["']?api_token["']?\s*[:=]\s*["']([0-9a-f]{40})["']/i.exec(html);
  if (m?.[1]) return m[1];
  // 形态 A：input/span 里裸 40hex，且上下文含 token 字样（防误匹配其他 hash）
  const ctx = /(?:value|id|class)\s*=\s*["'][^"']*token[^"']*["'][^>]*value\s*=\s*["']([0-9a-f]{40})["']/i.exec(html);
  if (ctx?.[1]) return ctx[1];
  const span = />([0-9a-f]{40})</.exec(
    (html.match(/<[^>]*(?:token|auth)[^>]*>[^<]*[0-9a-f]{0,40}[^<]*<\/[^>]*>/i)?.[0] ?? ""),
  )?.[1];
  if (span) return span;
  return null;
}

export interface AutoConnectResult {
  ok: boolean;
  account?: SeafileAccount;
  error?: string;
  /** 需要二次认证：交由 UI 弹 2FA 面板（当前仅 relogin 旧通道保留，见 cloud2FASubmit） */
  need2FA?: boolean;
  /** 2FA 场景：oauth=云盘 OAuth 授权要 2FA；relogin=统一认证会话过期需重登要 2FA */
  faMode?: "oauth" | "relogin";
  /** relogin 场景下由登录链给出的可用方式（oauth 场景用 cloud2FAMethods 取） */
  methods?: TwoFactorMethod[];
}

/** SSO 漫游 → 抓 profile → 提取 token → 校验落盘（幂等：已连接直接返回）
 *  allowRelogin=false（启动静默路径）：会话不在时只报错，绝不触发直登/弹 2FA。 */
export async function autoConnectSeafile(
  opts: { allowRelogin?: boolean } = {},
): Promise<AutoConnectResult> {
  return autoConnectViaHttp(false, opts.allowRelogin !== false);
}

/** 二次认证：列可用方式（企业微信 / 短信 / TOTP）——oauth 场景用 */
export async function cloud2FAMethods(): Promise<TwoFactorMethod[]> {
  const { list2FAMethods } = await import("@onethu/core");
  return list2FAMethods(http);
}

/** 二次认证：发码；两种场景各走各自那条链（都是同一份 jar 会话） */
export async function cloud2FASend(type: string, mode: "oauth" | "relogin" = "oauth"): Promise<void> {
  if (mode === "relogin") {
    const { send2FA } = await import("../lib/clients.js");
    await send2FA(type);
    return;
  }
  const { send2FACode } = await import("@onethu/core");
  await send2FACode(http, type);
}

/**
 * 二次认证：提交验证码 → 信任本机 → 重跑自动连接。全程同一份 jar 会话。
 * - oauth：id 会话活着，但云盘 OAuth 授权要一次 2FA 升级
 * - relogin：旧通道（lib 登录链）完成 2FA
 * 过后 trustDevice 把本机记为受信设备，此后长期免验证。
 */
export async function cloud2FASubmit(
  type: string,
  code: string,
  mode: "oauth" | "relogin" = "oauth",
): Promise<AutoConnectResult> {
  if (mode === "relogin") {
    const { verify2FA } = await import("../lib/clients.js");
    await verify2FA(type, code, true); // trust=true：服务端新发的受信指纹立刻落盘
    void logLine("[SEAFILE-AUTO] 重登 2FA 通过 → 重跑云盘自动连接").catch(() => undefined);
  } else {
    const { verify2FACode, trustDevice } = await import("@onethu/core");
    await verify2FACode(http, type, code);
    const { currentFingerprint } = await import("../lib/clients.js");
    void trustDevice(http, await currentFingerprint(), "OneTHU").catch(() => undefined);
    void logLine("[SEAFILE-AUTO] 二次认证通过 → 已信任本机，重跑云盘自动连接").catch(() => undefined);
  }
  return autoConnectSeafile();
}

/** 诊断：某域 jar 里 cookie 的名字与属性（不含值），定位「票据收下了但会话没保存」 */
function cookieDiag(url: string): string {
  try {
    const recs = http.jar.getCookies(new URL(url));
    if (recs.length === 0) return "(none)";
    return recs
      .map((c) => `${c.name}[d=${c.domain} p=${c.path} host=${c.hostOnly ? 1 : 0} sec=${c.secure ? 1 : 0}]`)
      .join(",");
  } catch (e) {
    return `(err ${e instanceof Error ? e.message : String(e)})`;
  }
}

/** 一次 profile 拉取（jar + follow），返回终点 URL 与正文 */
async function fetchProfile(): Promise<{ finalUrl: string; body: string }> {
  const res = await http.request(PROFILE_URL, { redirect: "follow" });
  const finalUrl = res.headers.get("x-onethu-final-url") ?? PROFILE_URL;
  return { finalUrl, body: await res.text() };
}

/** 复用统一 jar 正门的云盘自动连接；retried=true 表示已做过一次直登，不再循环 */
async function autoConnectViaHttp(retried = false, allowRelogin = true): Promise<AutoConnectResult> {
  const log = (m: string) => void logLine(`[SEAFILE-AUTO] ${m}`).catch(() => undefined);
  try {
    const { info } = await import("../lib/clients.js");
    log(`开始：GET profile（带 jar，follow）${retried ? "（直登后重试）" : ""}`);
    let { finalUrl, body } = await fetchProfile();
    log(`拿到页面 finalUrl=${finalUrl.slice(0, 120)} len=${body.length}`);

    // ① checkSingle 指纹确认页：id 会话活着，只需确认取票 + 兑付（TUOJ 同款正门）
    if (CHECKSINGLE_RE.test(body)) {
      log(`确认前 cloud cookie：${cookieDiag("https://cloud.tsinghua.edu.cn/")}`);
      const ok = await info.confirmIdCheckSingle(finalUrl);
      log(`checkSingle 确认取票=${ok ? "ok" : "fail"} diag=${info.lastDebug.slice(0, 160)}`);
      log(`确认后 cloud cookie：${cookieDiag("https://cloud.tsinghua.edu.cn/")}`);
      log(`确认后 id cookie：${cookieDiag("https://id.tsinghua.edu.cn/")}`);
      if (ok) ({ finalUrl, body } = await fetchProfile());
    }

    // ② 真登录表单：id 会话不在 → 账密直登 id 后重走一次（零用户输入，仅已登录过时有凭据）
    if (CAS_LOGIN_RE.test(body)) {
      if (!allowRelogin) {
        return { ok: false, error: "统一认证会话已过期：请在设置里重新登录清华账号后再连云盘" };
      }
      if (retried) {
        return { ok: false, error: "统一认证直登后仍未通过：请在设置里重新登录清华账号" };
      }
      if (!info.hasIdCredentials()) {
        return { ok: false, error: "统一认证会话已过期（内存中没有清华密码）：请在设置里重新登录清华账号" };
      }
      let direct = false;
      try {
        direct = await info.ensureDirectIdLogin(finalUrl);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/二次认证|双因素|二次验证|双因子/.test(msg)) {
          log("直登 id 触发二次认证 → 请用户重新登录并信任设备");
          return { ok: false, error: TWO_FACTOR_MSG };
        }
        throw e;
      }
      log(`直登 id=${direct ? "ok" : "fail"} diag=${info.lastDebug.slice(0, 160)}`);
      if (!direct) return { ok: false, error: "统一认证直登失败：请在设置里重新登录清华账号" };
      return autoConnectViaHttp(true, allowRelogin);
    }

    // ③ 二次认证页（id 端 2FA，checkSingle 回包里 JS 跳转的目标）
    if (TWO_FACTOR_RE.test(body)) {
      log(`统一认证要求二次认证（len=${body.length}）`);
      return { ok: false, error: TWO_FACTOR_MSG };
    }

    // ④ OAuth 授权确认页（云盘 thu-oauth 授权码流，首次需用户同意一次）
    if (/oauth\.tsinghua\.edu\.cn/.test(finalUrl) || /同意|授权|allow|approve/i.test(body.slice(0, 3000))) {
      return {
        ok: false,
        error: "需要首次授权：云盘登录走清华 OAuth，请先在浏览器/App 里打开一次 cloud.tsinghua.edu.cn 并点「同意授权」（之后即静默）",
      };
    }

    // ⑤ profile 页取 token
    const token = extractToken(body);
    if (!token) {
      log(`profile 页未找到 token（finalUrl=${finalUrl.slice(0, 80)} len=${body.length}）`);
      // 诊断（只读，不含 token 值）：掩码 token 区域的按钮/表单/脚本接口，供定位「生成」动作
      const i = body.search(/Auth Token|get-auth-token/i);
      if (i >= 0) log(`token 区域片段：${body.slice(Math.max(0, i - 200), i + 900).replace(/\s+/g, " ")}`);
      const ajax = [...body.matchAll(/["'](\/[^"'\s]*(?:ajax|api2?|token)[^"'\s]*)["']/gi)].map((m) => m[1]);
      log(`页面接口候选：${[...new Set(ajax)].slice(0, 20).join(" ")}`);
      // eye 按钮的处理逻辑：脚本里涉及 eye / token 的片段（40 位 hex 打码，不落真值）
      for (const m of body.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
        const code = m[1] ?? "";
        const k = code.search(/eye-icon|apiToken|api_token|get-auth-token|web-api/i);
        if (k < 0) continue;
        const snip = code.slice(Math.max(0, k - 150), k + 500).replace(/[0-9a-f]{40}/gi, "<hex40>").replace(/\s+/g, " ");
        log(`脚本片段：${snip}`);
      }
      return { ok: false, error: "profile 页未找到 token（页面形态未知，请在云盘页手动粘贴一次）" };
    }
    const account = await setSeafileToken(token);
    log(`云盘已自动连接：${account.name}（${account.email}）`);
    return { ok: true, account };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
