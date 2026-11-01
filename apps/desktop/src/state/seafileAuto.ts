import { t as i18n } from "../i18n/index.js";
import { trustDeviceName } from "../lib/deviceName.js";
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
import { http, session } from "../lib/clients.js";
import { logLine } from "../lib/clients.js";
import { ensureSeafileLoaded, getSeafileToken, getSeafileCredentialVersion, setSeafileToken, type SeafileAccount } from "./seafile.js";
import type { TwoFactorMethod } from "@onethu/core";

import { nativeSessionEpoch, assertNativeSessionEpoch } from "../lib/transport.js";
import { initPrivacyConsent, requireCloudConsent } from "./privacyConsent.js";
const PROFILE_URL = "https://cloud.tsinghua.edu.cn/profile/";

/** checkSingle 指纹确认页（id 会话活着，与 core/exthw/tuojCas.ts isCheckSinglePage 同判据） */
const CHECKSINGLE_RE = /checkSingle/;
/** 真·CAS 登录表单（id 会话不在；与 core isCasLoginPage 同判据，只认正文，不认 URL） */
const CAS_LOGIN_RE = /id="sm2publicKey"|name="sm2publicKey"|name="i_pass"/;
/** 统一认证要求二次认证（id 端 2FA） */
const TWO_FACTOR_RE = /二次认证|双因素|二次验证|双因子|twoFactorAuthView|FIND_APPROACHES/;

const twoFactorMessage = () =>
  i18n("state.seafileauto.twoFactorRequired");

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
  requireCloudConsent();
  return autoConnectViaHttp(false, opts.allowRelogin !== false);
}

/** 静默直连链（2026-10-10 定案，唯一主链）：直连 GET profile → 落 id checkSingle
 *  壳页则 InfoClient.confirmIdCheckSingle（带设备指纹）确认续用 → cloud 直连会话落
 *  native jar → 重爬即登录态 → GET /api/v2.1/auth-token-by-session/（云盘 settings
 *  bundle 实锤的「显示口令」端点，纯只读）→ 40hex 口令 → setSeafileToken 落盘。
 *  缺少直连会话时复用已登录账号的内存凭据，兑付本次服务回调后再读取口令。
 *  全程零窗口零输入；已保存口令优先验证。ConnectGate / 导览 / IM 指令共用。 */
let silentPending: Promise<AutoConnectResult> | null = null;
export async function silentConnectSeafile(): Promise<AutoConnectResult> {
  await initPrivacyConsent();
  requireCloudConsent();
  // Hydrate the durable token before deciding that a new SSO flow is needed.
  await ensureSeafileLoaded();
  if (silentPending) return silentPending;
  const pending = runSilentConnect();
  silentPending = pending;
  void pending.finally(() => { if (silentPending === pending) silentPending = null; }).catch(() => undefined);
  return pending;
}

async function runSilentConnect(): Promise<AutoConnectResult> {
  const credentialVersion = getSeafileCredentialVersion();
  const epoch = await nativeSessionEpoch();
  const owner = session.username;
  const assertCurrent = async () => {
    await assertNativeSessionEpoch(epoch);
    requireCloudConsent();
    if (credentialVersion !== getSeafileCredentialVersion() || session.username !== owner) {
      throw new Error(i18n("state.seafile.accountChanged"));
    }
  };
  const log = (m: string) => void logLine(`[CLOUD-DIRECT] ${m}`).catch(() => undefined);
  try {
    if (getSeafileToken()) {
      const { refreshSeafileAccount } = await import("./seafile.js");
      try {
        await refreshSeafileAccount();
        await assertCurrent();
        return { ok: true };
      } catch (error) {
        // A network failure keeps the saved credential intact. Only a confirmed
        // rejected token needs another read-only SSO discovery.
        if (!/\b(?:401|403)\b/.test(String(error))) throw error;
      }
    }
    const { invoke } = await import("@tauri-apps/api/core");
    const { info } = await import("../lib/clients.js");
    let confirmed = false, renewed = false;
    for (let step = 0; step < 4; step++) {
      await assertCurrent();
      const r = await invoke<{ finalUrl: string; body: string; needConfirm: boolean; plainToken: string }>("cloud_webvpn_profile", { epoch });
      await assertCurrent();
      if (r.needConfirm && !confirmed) {
        confirmed = true;
        log("确认已有统一认证会话");
        const ok = await info.confirmIdCheckSingle(r.finalUrl);
        await assertCurrent();
        if (!ok) return { ok: false, error: i18n("state.seafileauto.d236f74b57c1") };
        continue;
      }
      // The daemon may restore a valid WebVPN session without a direct ID
      // session. Reuse this signed-in account's in-memory credentials and device
      // trust once. This path never changes school account or opens a window.
      if (CAS_LOGIN_RE.test(r.body) && !renewed && owner && session.state === "ready" && info.hasIdCredentials()) {
        renewed = true;
        log("学校会话已就绪 → 续接云盘直连认证");
        const ok = await info.ensureDirectIdLogin(r.finalUrl, { consumeServiceTicket: true });
        await assertCurrent();
        if (!ok) return { ok: false, error: i18n("state.seafileauto.789c9d831ceb") };
        continue;
      }
      if (TWO_FACTOR_RE.test(r.body)) return { ok: false, error: twoFactorMessage() };
      const token = (r.plainToken && /^[0-9a-f]{40}$/i.test(r.plainToken) ? r.plainToken : "") || extractToken(r.body) || "";
      if (!token) {
        log(`页面无口令（len=${r.body.length}）`);
        return { ok: false, error: CAS_LOGIN_RE.test(r.body) ? i18n("state.seafileauto.ab0d7338c8dd") : i18n("state.seafileauto.64be8fcebc0a") };
      }
      await assertCurrent();
      const account = await setSeafileToken(token, credentialVersion);
      log("云盘已静默连接");
      return { ok: true, account };
    }
    return { ok: false, error: i18n("state.seafileauto.64be8fcebc0a") };
  } catch (e) {
    log("静默连接未完成");
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: /二次认证|双因素|二次验证|双因子/.test(message) ? twoFactorMessage() : message };
  }
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
    const fingerprint = await currentFingerprint();
    void trustDevice(http, fingerprint, await trustDeviceName(fingerprint)).catch(() => undefined);
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
async function autoConnectViaHttp(retried = false, allowRelogin = true, credentialVersion = getSeafileCredentialVersion()): Promise<AutoConnectResult> {
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
        return { ok: false, error: i18n("state.seafileauto.ab0d7338c8dd") };
      }
      if (retried) {
        return { ok: false, error: i18n("state.seafileauto.6064f0dbf06e") };
      }
      if (!info.hasIdCredentials()) {
        return { ok: false, error: i18n("state.seafileauto.b096dd8cc73e") };
      }
      let direct = false;
      try {
        direct = await info.ensureDirectIdLogin(finalUrl);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/二次认证|双因素|二次验证|双因子/.test(msg)) {
          log("直登 id 触发二次认证 → 请用户重新登录并信任设备");
          return { ok: false, error: twoFactorMessage() };
        }
        throw e;
      }
      log(`直登 id=${direct ? "ok" : "fail"} diag=${info.lastDebug.slice(0, 160)}`);
      if (!direct) return { ok: false, error: i18n("state.seafileauto.789c9d831ceb") };
      return autoConnectViaHttp(true, allowRelogin, credentialVersion);
    }

    // ③ 二次认证页（id 端 2FA，checkSingle 回包里 JS 跳转的目标）
    if (TWO_FACTOR_RE.test(body)) {
      log(`统一认证要求二次认证（len=${body.length}）`);
      return { ok: false, error: twoFactorMessage() };
    }

    // ④ OAuth 授权确认页（云盘 thu-oauth 授权码流，首次需用户同意一次）
    if (/oauth\.tsinghua\.edu\.cn/.test(finalUrl) || /同意|授权|allow|approve/i.test(body.slice(0, 3000))) {
      return {
        ok: false,
        error: i18n("state.seafileauto.c82a95d8733d"),
      };
    }

    // ⑤ profile 页取 token
    const token = extractToken(body);
    if (!token) {
      log(`profile 页未找到 token（finalUrl=${finalUrl.slice(0, 80)} len=${body.length}）`);
      // Unknown page layouts may carry credentials outside the known 40-hex token.
      // Keep only route/length metadata; never dump profile HTML or inline scripts.
      return { ok: false, error: i18n("state.seafileauto.0b66b052d51d") };
    }
    const account = await setSeafileToken(token, credentialVersion);
    log(`云盘已自动连接：${account.name}（${account.email}）`);
    return { ok: true, account };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
