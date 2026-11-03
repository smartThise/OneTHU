import { t as i18n } from "../i18n/index.js";
/**
 * core 客户端装配：统一会话（CampusSession）+ 凭证存储。
 * 一次 CAS 登录 → learn / info 共享会话；Tauri 桌面端走 Rust 网络层（无 CORS）。
 */
import {
  CampusSession,
  HttpClient,
  InfoClient,
  LearnClient,
  LocalStorageCredentialStore,
  makeFingerprint,
  webvpnDecodeUrl,
  webvpnWrap,
  normalizeWebvpnUrl,
  PUBLIC_DIRECT_HOSTS,
  type CredentialStore,
  type SessionData,
  type TwoFactorMethod,
} from "@onethu/core";
import { universalFetch, nativeFetch, nativeSeedCookies, nativeCookieClear, isTauri, setHopCookieProvider, setHopLogger, setHopUrlWrapper } from "./transport.js";
import { loginCooldownLeftMs } from "./loginGate.js";
import { setWebvpnLog, setZhjwxkDebug, setZhjwxkNativeClear, setZhjwxkReloginHook } from "@onethu/core";
import { redactNetworkLog } from "./networkLog.js";
import { loginFailureDiagnostic } from "./loginErrors.js";
import { probeLearnSession } from "./learnRecovery.js";
import { withPrivacy } from "./privacy.js";
import { initCliInstallation, adoptSharedSession, exportSharedSession, exportNativeSessionCookies, importNativeSessionCookies, mergeSameAccountServiceCookies, getSharedRuntimeStatus, logoutSharedSession, updateSharedPolicy, usesSharedRuntime, type SharedRuntimeStatus, type SharedSessionSnapshot } from "./sharedRuntime.js";
import { canBindDeferredLogin, isSharedRuntimeUnavailable } from "./sharedAuthPolicy.js";

export type { TwoFactorMethod };

function localStorageStore(): CredentialStore {
  try {
    const s = globalThis.localStorage;
    if (s) return new LocalStorageCredentialStore(s);
  } catch {
    /* 无 localStorage 环境 */
  }
  return {
    async loadSession() {
      return null;
    },
    async saveSession() {},
    async clearSession() {},
  };
}

export const store = localStorageStore();

/* -------------- 本机文件状态（Tauri appData/state/*.json） --------------
 * WKWebView 的 localStorage 会被系统驱逐（会话状态「时有时无」的根源），
 * 会话快照与记住的密码一律镜像到应用数据目录文件；启动时 localStorage
 * 优先、缺失则从文件回灌。 */
const SESSION_FILE = "session";
const SECRET_FILE = "credentials";
const SHARED_LOGOUT_FILE = "cli-pending-logout-v1";
const SHARED_HANDOFF_FILE = "cli-pending-handoff-v1";

/** strict 供日历/邮箱等不能把 I/O 失败当成功的事务使用；其他调用保持旧兜底。 */
export interface StateFileOptions { strict?: boolean }
export async function fileRead(name: string, options: StateFileOptions = {}): Promise<string | null> {
  if (!isTauri) return options.strict ? globalThis.localStorage.getItem(`onethu.state-file.${name}`) : null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    // state_read 对 NotFound 返回 null，其他真实 I/O 错误拒绝。
    return await invoke<string | null>("state_read", { name });
  } catch (error) {
    if (options.strict) throw error;
    return null;
  }
}

export async function fileWrite(name: string, content: string, options: StateFileOptions = {}): Promise<void> {
  if (!isTauri) { if (options.strict) globalThis.localStorage.setItem(`onethu.state-file.${name}`, content); return; }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("state_write", { name, content });
  } catch (error) {
    if (options.strict) throw error;
  }
}

export async function fileDelete(name: string, options: StateFileOptions = {}): Promise<void> {
  if (!isTauri) { if (options.strict) globalThis.localStorage.removeItem(`onethu.state-file.${name}`); return; }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("state_delete", { name });
  } catch (error) {
    if (options.strict) throw error;
  }
}

/* ----------------------- 记住密码（本机混淆存储） ----------------------- */
const SECRET_MAGIC = "onethu-secret-v1:";

function xorBytes(bytes: Uint8Array, key: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i]! ^ key[i % key.length]!;
  return out;
}

function bytesToBinaryString(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return bin;
}

/** 密码与用户名绑定的逐字节 XOR + base64（本机混淆、非明文；非加密承诺） */
export function obfuscateSecret(password: string, username: string): string {
  const bytes = new TextEncoder().encode(password);
  const key = new TextEncoder().encode(`OneTHU|${username}|remember`);
  return SECRET_MAGIC + btoa(bytesToBinaryString(xorBytes(bytes, key)));
}

export function deobfuscateSecret(stored: string, username: string): string {
  if (!stored.startsWith(SECRET_MAGIC)) return "";
  try {
    const bin = atob(stored.slice(SECRET_MAGIC.length));
    const key = new TextEncoder().encode(`OneTHU|${username}|remember`);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) ^ key[i % key.length]!;
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

/** 登录期间暂存的凭据（2FA 中转时密码不在参数里，persist 时取用） */
let pendingSecret: { username: string; password: string; remember: boolean } | null = null;

export interface RememberedCredentials {
  username: string;
  password: string;
}

/** 读取本机记住的密码（无则 null） */
export async function loadRemembered(): Promise<RememberedCredentials | null> {
  const raw = await fileRead(SECRET_FILE);
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as { username?: string; secret?: string };
    if (!j.username || !j.secret) return null;
    const password = deobfuscateSecret(j.secret, j.username);
    if (!password) return null;
    return { username: j.username, password };
  } catch {
    return null;
  }
}

/** 清除记住的密码（Settings「清除」；登录时取消勾选也会触发） */
export async function clearRemembered(): Promise<void> {
  pendingSecret = null;
  await fileDelete(SECRET_FILE);
}

// 2026-09-17 大迁移定案：info 全家（家园/宿舍/图书馆/选课/工资/发票/场馆…）
// 与 learn/lib 同一条原生管线（Rust 跳循环 + 真 cookie 引擎）。tauriFetch 跳循环
// 不认门户落地、hopCookie 供票逻辑与 rust 仓互踩——全部退役。
export const http = new HttpClient({
  fetch: (u, init) => nativeFetch(String(u), init as Parameters<typeof nativeFetch>[1]),
}).withWebVPN(false);
http.webVPNEncoder = webvpnWrap;
http.debug = (line) => void logLine(line);
// jar→rust 播种桥（wengine 引导页票种同步进原生仓；learn 同款，基础设施票过滤）
http.nativeSeedHook = (url, pair, path = "/", epoch) => {
  const name = pair.split("=")[0]!.trim();
  if (name === "wengine_vpn_ticket" || name.startsWith("show_") || name === "heartbeat" || name === "refresh") {
    return;
  }
  return nativeSeedCookies(url, [`${pair}; Path=${path}`], epoch);
};
// 重定向链逐跳日志：定位教务漫游链在哪一跳断掉（CAS 票据流/登录页）
setHopLogger((hopUrl, status, ck) => void logLine(`[HOP] ${status} ${hopUrl.slice(0, 150)} ck=${ck ?? "(无)"}`));
// 选课现场取证（zhjwxkDebug 钩子此前未接线——SM2 失败只有异常没有现场）
void (async () => {
  try {
    const core = await import("@onethu/core");
    const setZhjwxkDebug = (core as unknown as { setZhjwxkDebug?: (fn: (l: string) => void) => void }).setZhjwxkDebug;
    setZhjwxkDebug?.((line: string) => void logLine(`XK-D bg ${line}`).catch(() => undefined));
  } catch { /* noop */ }
})();

setZhjwxkDebug((line) => void logLine(line));
setZhjwxkNativeClear(nativeCookieClear);
// 死结重登借 lib 权威：id 单点登录互踢根治（选课清仓直登曾踢死新闻/日程/info）
// hook 内懒加载——顶层 await 在生产构建 target（es2020）不可用，且懒加载无时序问题
setZhjwxkReloginHook(async () => {
  const { libForceRelogin } = await import("./infoLib.js");
  return libForceRelogin();
});
setWebvpnLog((line) => void logLine(line));

// 逐跳 cookie 供应：包装 URL 解码出真实域（wrapped id 跳带 id 桶会话、wrapped zhjw
// 跳带 zhjw 桶会话）；直连跳取自身域。教务漫游链的 CAS 中间跳靠它才不断链。
setHopCookieProvider((hopUrl) => {
  try {
    const origin = webvpnDecodeUrl(hopUrl) ?? hopUrl;
// 链内 webvpn 续轨（transport.ts）：非公网域的重定向目标续包装，防通道分裂
setHopUrlWrapper((u: string): string => {
  try {
    const h = new URL(u).hostname;
    if (h === "webvpn.tsinghua.edu.cn" || PUBLIC_DIRECT_HOSTS.has(h)) return u;
    return webvpnWrap(u);
  } catch {
    return u;
  }
});
    let cookies = http.jar.getCookies(new URL(origin));
    // OneTHU 适配（2026-09-17）：webvpn 物理域跳不外发 jar 里的 wengine 票
    // （陈旧匿名票会被服务器采信 → 弹登录 → 门户 200 旧循环不认 → 25 跳爆）。
    // 裸发 = wengine 按 IP 续会话（与 rust 原生世界同语义）。
    if (new URL(origin).hostname === "webvpn.tsinghua.edu.cn") {
      cookies = cookies.filter((c) => c.name !== "wengine_vpn_ticket" && !c.name.startsWith("show_") && c.name !== "heartbeat" && c.name !== "refresh");
    }
    if (!cookies.length) return null;
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  } catch {
    return null;
  }
});

// learn 专线（2026-09-17 挪移）：fetch 切原生通道（Rust 跳循环+原生 cookie 仓），
// 与 lib 同一个会话世界——旧 tauriFetch 跳循环不认「门户落地=已登录」，撞
// 重定向超限；jar 仍共享（csrf 视图/诊断不变，Set-Cookie 桥照常入账）。
const learnHttp = new HttpClient({ fetch: (u, init) => nativeFetch(String(u), init as Parameters<typeof nativeFetch>[1]) });
learnHttp.webVPNEncoder = webvpnWrap;
learnHttp.withWebVPN(false);
// 诊断可见性（2026-09-17 教训：专线没接 debug 钩子，整条链路在日志里隐形）
learnHttp.debug = (line) => void logLine(line);
// wengine 引导页票种同步播种进 rust 仓（jar→rust 桥：learn 专线走原生通道，
// 只进 jar 的票 rust 侧永远看不到）。但 wengine 基础设施票（wengine_vpn_ticket/
// show_*/heartbeat/refresh）绝不播种——2026-09-17 实录：铸好的真票被引导页
// 回放的陈旧匿名票覆盖，首页瞬间全绿→几秒后死。只播种目标应用域会话票。
learnHttp.nativeSeedHook = (url, pair, path = "/", epoch) => {
  const name = pair.split("=")[0]!.trim();
  if (name === "wengine_vpn_ticket" || name.startsWith("show_") || name === "heartbeat" || name === "refresh") {
    return;
  }
  return nativeSeedCookies(url, [`${pair}; Path=${path}`], epoch);
};
// 脱敏版（demo 分支）在取数出口统一过一遍：姓名 / 学号 / 成绩在离开客户端时就被替换
export const learn = withPrivacy(new LearnClient(learnHttp), "learn");
// learn 静默重登的账密供应（路径二兜底）：login() 后内存中即有（pendingSecret），
// 设备指纹信任链随 session——不需要再碰 infoLib 的凭据箱。
learn.credentialProvider = () => {
  if (!pendingSecret) return null;
  return {
    username: pendingSecret.username,
    password: pendingSecret.password,
    fingerprint: session.fingerprint,
    finger3: session.finger3,
  };
};
// learn 会话的宿主侧重建：#42 复核 —— 主会话活着、学习会话死了时，学习客户端
// 自己静默重建缺这条路（lib 探活 + id-漫游）。以前它只存在于登录后与数据层恢复环
// 里，于是「别的数据都在出，只有详情/通知/作业说会话已失效」没有任何自愈入口。
learn.reloginHook = async () => {
  try {
    const { libEnsureSession, libRoamLearn } = await import("./infoLib.js");
    if (!(await libEnsureSession())) return false;
    return await libRoamLearn().catch(() => false);
  } catch {
    return false;
  }
};
export const info = withPrivacy(new InfoClient(http), "info");

export const session = new CampusSession({
  http,
  learn,
  info,
  fetchLike: (u, init) => nativeFetch(String(u), init as Parameters<typeof nativeFetch>[1]),
});

// InfoClient 会话过期续约：lib 会话守卫（探活+静默重登）替代 demo roam-id 链
// ——登录链已统一到 thu-info-lib（单管线），demo 链退役后其漫游钩子不再可用。
session.info.setRenewers({
  info: () => libSoftRelogin(),
  card: () => libSoftRelogin(),
});

// HttpClient 实例级透明重放：响应带登录页特征（#looksLoggedOut）→ lib 会话守卫
// （探活 → 死则内存凭据完整重登，受信凭据免 2FA）→ 原请求自动重放一次。
// 指数冷却（30s 起步、封顶 10min）防风控连锤。
let libSoftFailStreak = 0;
let libSoftCooldownUntil = 0;
async function libSoftRelogin(): Promise<boolean> {
  if (Date.now() < libSoftCooldownUntil) return false;
  try {
    const { libEnsureSession } = await import("./infoLib.js");
    const ok = await libEnsureSession();
    libSoftFailStreak = ok ? 0 : libSoftFailStreak + 1;
    libSoftCooldownUntil = Date.now() + Math.min(30_000 * 2 ** libSoftFailStreak, 10 * 60_000);
    void logLine(`SOFT-RELOGIN ${ok ? "ok" : "fail"} streak=${libSoftFailStreak}`).catch(() => undefined);
    return ok;
  } catch {
    libSoftFailStreak += 1;
    libSoftCooldownUntil = Date.now() + Math.min(30_000 * 2 ** libSoftFailStreak, 10 * 60_000);
    return false;
  }
}
http.onAuthRequired(async () => {
  await libSoftRelogin();
});

/** 诊断落盘（UI 各处复用；写 /tmp/onethu-debug.log） */
export async function logLine(text: string): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("log_debug", { line: new Date().toISOString() + " | " + redactNetworkLog(text) });
  } catch {
    /* noop */
  }
}

// Keep the diagnostic hook without persisting the page body or hidden fields.
void (async () => {
  try {
    const { InfoClient } = await import("@onethu/core");
    InfoClient.onDebugDump = (label, content) => {
      // Full school pages can contain student data and hidden authentication fields.
      void logLine(`DUMP ${label}: omitted page body (${content.length} characters)`);
    };
  } catch {
    /* 钩子失败不影响主流程 */
  }
})();

async function dumpDebug(err: unknown): Promise<void> {
  const authDiagnostic = loginFailureDiagnostic(err);
  if (authDiagnostic) await logLine(authDiagnostic);
  if (err instanceof Error && isTauri) {
    const debug = (err as Error & { debug?: string }).debug;
    await logLine("ERR " + err.message + (debug ? "\n" + debug : ""));
  }
}

/** R17 23.3-4：登录成功（含 2FA 完成、设备信任建立）后自动重试一次 TUOJ 漫游。
 *  动态 import 防循环依赖（exthw 状态层 import 本模块）；失败静默（状态层已记录）。 */
function retryTuojAfterTrust(): void {
  void import("../state/exthw.js")
    .then((m) => m.retryTuojCasAfterLogin())
    .catch(() => undefined);
}

/** UI 只管喂账密；登录链 = thu-info-lib（SM2 + 2FA hooks + roam-id，
 *  docs/INFOLIB-PIPELINE-REVIEW.md P2）。单一 webvpn 管线：不再有直连/webvpn
 *  降级舞蹈——webvpn 从校内校外都可达，拓扑唯一才是双环境适配的本质。
 *  opts.remember（默认 true）：成功后把密码混淆存本机，boot 恢复失败时静默重登。 */
type ClientLoginResult = { state: "ready" } | { state: "need-2fa"; methods: TwoFactorMethod[]; debugHtml: string };
let clientLoginRequest: { username: string; p: Promise<ClientLoginResult> } | null = null;
let sharedSessionEpoch: number | null = null;
let sharedSessionState: string | null = null;
let loginSharedEpoch: number | null = null;
let loginSharedAccount: string | null = null;
let sharedLoggedOut = false;
let sharedHandoffRequest: Promise<SharedSessionSnapshot | null> | null = null;
let sharedHandoffRetryAfter = 0;
let pendingSharedHandoffMemory: PendingSharedHandoff | null = null;
function sharedSessionStateKey(shared: SharedRuntimeStatus): string {
  return JSON.stringify([shared.username, shared.session.state, shared.session.twoFactor?.pending === true]);
}
function rememberSharedSession(shared: SharedRuntimeStatus): void {
  sharedSessionEpoch = shared.epoch;
  sharedSessionState = sharedSessionStateKey(shared);
}

export function login(username: string, password: string, opts: { remember?: boolean } = {}): Promise<ClientLoginResult> {
  if (resumeRequest) {
    return Promise.reject(Object.assign(new Error("Session recovery is still in progress."), { code: "AUTH_IN_PROGRESS" }));
  }
  if (clientLoginRequest) {
    if (clientLoginRequest.username === username) return clientLoginRequest.p;
    return Promise.reject(Object.assign(new Error("Another login is in progress."), { code: "AUTH_IN_PROGRESS" }));
  }
  const p = performLogin(username, password, opts);
  clientLoginRequest = { username, p };
  const clear = () => { if (clientLoginRequest?.p === p) clientLoginRequest = null; };
  void p.then(clear, clear);
  return p;
}

async function performLogin(
  username: string,
  password: string,
  opts: { remember?: boolean } = {},
): Promise<{ state: "ready" } | { state: "need-2fa"; methods: TwoFactorMethod[]; debugHtml: string }> {
  await initCliInstallation();
  // Capture before credential submission. A CLI logout/account switch during
  // the school login must win over the result of this older attempt.
  if (usesSharedRuntime()) {
    try {
      await finishPendingSharedLogout();
      const shared = await getSharedRuntimeStatus();
      if (shared.session.twoFactor?.pending || shared.session.state === "need-2fa") throw Object.assign(new Error("A CLI login is still in progress."), { code: "AUTH_IN_PROGRESS" });
      loginSharedEpoch = shared.epoch;
      loginSharedAccount = shared.username;
    } catch (error) {
      if (!isSharedRuntimeUnavailable(error)) throw error;
      loginSharedEpoch = null;loginSharedAccount = null;
      void logLine("CLI unavailable; explicit school login continues with native session").catch(() => undefined);
    }
  }
  void logLine("AUTH-PHASE import-login");
  const { libLogin, setLibFinger3, helper, assertLoginAccount } = await import("./infoLib.js");
  assertLoginAccount(username, password);
  void logLine("AUTH-PHASE fingerprint-start");
  const fingerprint = await currentFingerprint();
  session.fingerprint = fingerprint;
  void logLine("AUTH-PHASE fingerprint-ready");
  // （2026-09-18 决策）轮换实验撤除：强制 2FA 的链路被 keepalive/静默重登/
  // lib 僵尸链三面夹击，稳定性失控。回归简单：fp 固定，登录一次 2FA 到位；
  // finger3 缺失时选课靠死结自愈兜底（确认失败→清账直登，实测可用）。
  const remember = opts.remember ?? true;
  if (!remember) await clearRemembered().catch(() => undefined);
  assertLoginAccount(username, password);
  pendingSecret = { username, password, remember };
  setLibFinger3(session.finger3);
  helper.fingerprint = fingerprint;
  try {
    const r = await libLogin(username, password, fingerprint);
    if (r.state === "ready") {
      session.username = username;
      session.state = "ready";
      // SAVE_FINGER 受信凭据同步（2FA 链内签发的才有效；直登后补签=身份异常）
      {
        const { helper, getSelfFinger3 } = await import("./infoLib.js");
        const fresh = getSelfFinger3() ||
          (helper as unknown as { fingerGenPrint?: string }).fingerGenPrint || "";
        session.finger3 = fresh || session.finger3 || "";
        setLibFinger3(session.finger3);
      }
      session.injectCredentials(username, password);
      await persist();
      await logLine("LOGIN-OK (lib 链，单管线)");
      // R17 23.3-4：设备信任已建立 → 自动重试一次此前失败的 TUOJ 漫游
      retryTuojAfterTrust();
      // lib 主会话活了 → learn 客户端经 webvpn 透明 SSO 抓 _csrf（2026-09-17
      // 实录：缺此步则 loadReal 的 learn.* 预请求即抛 AuthRequiredError →
      // CAMPUS-AUTH 无限循环；resume 内部抓不到就保持未登录，不抛错）
      await resumeLearnAfterLogin();
      await adoptSuccessfulDesktopLogin();
    } else {
      session.username = username;
      session.state = "need-2fa";
      await logLine("LOGIN need-2fa methods=" + r.methods.map((m) => m.type).join(","));
    }
    return r.state === "need-2fa" ? { ...r, debugHtml: "" } : r;
  } catch (err) {
    if (err instanceof Error) await dumpDebug(err);
    await logLine("LOGIN-ERR " + String(err));
    throw err;
  }
}

export async function send2FA(type: string): Promise<void> {
  const { libSend2FA } = await import("./infoLib.js");
  try {
    await libSend2FA(type);
    await logLine("SEND-OK " + type);
  } catch (err) {
    await dumpDebug(err);
    await logLine("SEND-ERR " + type + " " + String(err));
    throw err;
  }
}

/** learn 二轮 2FA（直连 learn 时代的产物）：lib 单管线里 learn 经 wengine SSO
 *  透明建立，不存在第二轮——保留签名兼容 UI，永不触发（round2 恒 null）。 */
export async function sendLearn2FA(type: string): Promise<void> {
  return send2FA(type);
}

export async function verifyLearn2FA(_code: string): Promise<void> {
  /* no-op：见 sendLearn2FA 注释 */
}

/** Both trusted sign-in and fresh 2FA must establish the same scoped session.
 * A school-service failure is local to that service, not a failed main login. */
async function resumeLearnAfterLogin(): Promise<void> {
  const generation = resumeGeneration;
  learn.applyCsrf("");
  const read = async () => {
    const result = await probeLearnSession({ fetch: (url, init) => nativeFetch(url, init as Parameters<typeof nativeFetch>[1]),
      seed: learnHttp.nativeSeedHook,
      check: () => { if (generation !== resumeGeneration) throw new Error("AUTH_SESSION_CHANGED"); },
    });
    if (generation !== resumeGeneration) return false;
    learn.lastDebug = result.page;learn.lastCsrfDebug = result.diagnostic;
    if (result.ready && result.csrf) learn.applyCsrf(result.csrf);
    return result.ready;
  };
  let ready = await read().catch(() => false);
  if (!ready) {
    const { libRoamLearn } = await import("./infoLib.js");
    if (generation === resumeGeneration && await libRoamLearn()) ready = await read().catch(() => false);
  }
  await logLine(`LOGIN learn-resume ${ready ? "ok" : "unavailable"}`).catch(() => undefined);
}

export async function verify2FA(type: string, code: string, trust: boolean): Promise<TwoFactorMethod[] | null> {
  const { libVerify2FA, helper, getSelfFinger3, setLibFinger3 } = await import("./infoLib.js");
  try {
    await libVerify2FA(type, code, trust);
    session.state = "ready";
    // SAVE_FINGER 的受信凭据（trust=true 时服务端新发）必须立刻落盘：
    // hook 自签路径写 selfFinger3（lib 内置路径丢 object）；lib 的 helper.
    // fingerGenPrint 作后备。此前两处都空 → f3=0 → 死结（2026-09-18 实录）
    {
      const fresh = getSelfFinger3() ||
        (helper as unknown as { fingerGenPrint?: string }).fingerGenPrint || "";
      session.finger3 = fresh || session.finger3 || "";
      setLibFinger3(session.finger3);
      await logLine(`FINGER3 verify 落盘 len=${session.finger3.length}`).catch(() => undefined);
    }
    if (pendingSecret) session.injectCredentials(pendingSecret.username, pendingSecret.password);
    await persist();
    await logLine("VERIFY-OK (lib 链完成)");
    // R17 23.3-4：2FA + 信任设备完成 → 自动重试一次此前失败的 TUOJ 漫游
    retryTuojAfterTrust();
    // 同 login()：2FA 完成即主会话活，learn 透明 SSO 建 csrf
    await resumeLearnAfterLogin();
    await adoptSuccessfulDesktopLogin();
    return null;
  } catch (err) {
    // finger3 必须保住：即使验证失败也不能丢受信凭据
    await persist().catch(() => undefined);
    await dumpDebug(err);
    await logLine("VERIFY-ERR " + String(err));
    throw err;
  }
}

function currentSessionSnapshot(): SessionData {
  return { username: session.username, fingerprint: session.fingerprint, cookiesJson: http.jar.serialize(), finger3: session.finger3, savedAt: Date.now() };
}
interface PendingSharedHandoff {
  version: 1;
  snapshot: SessionData;
  expectedAccount: string | null;
  expectedEpoch: number | null;
  reason: "bootstrap" | "login";
  nativeComplete: boolean;
}
async function markSharedHandoffPending(value: boolean): Promise<void> {
  (await import("../state/cliRuntime.js")).setCliHandoffPending(value);
}
async function readPendingSharedHandoff(): Promise<PendingSharedHandoff | null> {
  if (pendingSharedHandoffMemory) return pendingSharedHandoffMemory;
  const raw = await fileRead(SHARED_HANDOFF_FILE, { strict: true });
  if (!raw) return null;
  const value = JSON.parse(raw) as PendingSharedHandoff;
  if (value?.version !== 1 || !(Number.isSafeInteger(value.expectedEpoch) || (value.expectedEpoch === null && value.reason === "login"))
    || !(value.expectedAccount === null || typeof value.expectedAccount === "string")
    || !["bootstrap", "login"].includes(value.reason) || typeof value.nativeComplete !== "boolean"
    || !value.snapshot?.username || !value.snapshot.fingerprint || typeof value.snapshot.cookiesJson !== "string") {
    throw new Error("CLI_PENDING_HANDOFF_INVALID");
  }
  return pendingSharedHandoffMemory = value;
}
async function saveSessionSnapshot(snapshot: SessionData): Promise<void> {
  await fileWrite(SESSION_FILE, JSON.stringify(snapshot), { strict: true });
  await store.saveSession(snapshot);
}
async function stageSharedHandoff(snapshot: SessionData, expected: { username: string | null; epoch: number | null }, reason: PendingSharedHandoff["reason"]): Promise<void> {
  const generation = resumeGeneration;
  const intent: PendingSharedHandoff = { version: 1, snapshot, expectedAccount: expected.username, expectedEpoch: expected.epoch, reason, nativeComplete: false };
  // Persist the successful school login before any bridge call can fail. A
  // subsequent status poll must not mistake a still-empty daemon for logout.
  pendingSharedHandoffMemory = intent;
  await fileWrite(SHARED_HANDOFF_FILE, JSON.stringify(intent), { strict: true });
  await markSharedHandoffPending(true);
  const native = await exportNativeSessionCookies();
  if (generation !== resumeGeneration) throw new Error("CLI_SHARED_SESSION_CHANGED");
  intent.snapshot = { ...snapshot, cookiesJson: JSON.stringify(native.cookies), savedAt: Date.now() };
  intent.nativeComplete = true;
  await fileWrite(SHARED_HANDOFF_FILE, JSON.stringify(intent), { strict: true });
  await saveSessionSnapshot(intent.snapshot);
  sharedHandoffRetryAfter = 0;
}
async function performSharedSessionHandoff(): Promise<SharedSessionSnapshot | null> {
  const generation = resumeGeneration;
  let intent = await readPendingSharedHandoff();
  if (!intent) return null;
  await markSharedHandoffPending(true);
  const shared = await getSharedRuntimeStatus();
  if (generation !== resumeGeneration) throw new Error("CLI_SHARED_SESSION_CHANGED");
  if (intent.expectedEpoch === null) {
    if (!canBindDeferredLogin(shared, intent.snapshot.username)) throw new Error("CLI_SHARED_SESSION_CHANGED");
    intent = { ...intent, expectedAccount: shared.username, expectedEpoch: shared.epoch };
    pendingSharedHandoffMemory = intent;
    await fileWrite(SHARED_HANDOFF_FILE, JSON.stringify(intent), { strict: true });
    if (generation !== resumeGeneration) throw new Error("CLI_SHARED_SESSION_CHANGED");
  }
  if (shared.epoch !== intent.expectedEpoch || shared.username !== intent.expectedAccount) {
    // A new CLI login or logout owns the newer epoch. Its verified export will
    // restore the GUI; never replay this old cookie candidate against it.
    await fileDelete(SHARED_HANDOFF_FILE, { strict: true });
    pendingSharedHandoffMemory = null;
    await markSharedHandoffPending(false);
    return null;
  }
  if (await fileRead(SHARED_LOGOUT_FILE, { strict: true })) throw new Error("CLI_SHARED_SESSION_CHANGED");
  if (!intent.nativeComplete) {
    const local = await loadConsistentSessionSnapshot();
    if (!local || local.username !== intent.snapshot.username || local.fingerprint !== intent.snapshot.fingerprint) throw new Error("AUTH_SESSION_CONFLICT");
    const native = await exportNativeSessionCookies();
    if (generation !== resumeGeneration) throw new Error("CLI_SHARED_SESSION_CHANGED");
    intent = { ...intent, nativeComplete: true, snapshot: { ...intent.snapshot, cookiesJson: JSON.stringify(native.cookies), savedAt: Date.now() } };
    pendingSharedHandoffMemory = intent;
    await fileWrite(SHARED_HANDOFF_FILE, JSON.stringify(intent), { strict: true });
    await saveSessionSnapshot(intent.snapshot);
  }
  if (intent.expectedEpoch === null) throw new Error("CLI_PENDING_HANDOFF_INVALID");
  const adopted = await adoptSharedSession(intent.snapshot, intent.expectedEpoch, intent.reason);
  if (generation !== resumeGeneration) throw new Error("CLI_SHARED_SESSION_CHANGED");
  rememberSharedSession(adopted);
  sharedLoggedOut = false; loginSharedEpoch = null;
  if (adopted.snapshot) fingerprintRequest = Promise.resolve(adopted.snapshot.fingerprint);
  await fileDelete(SHARED_HANDOFF_FILE, { strict: true });
  pendingSharedHandoffMemory = null;
  await markSharedHandoffPending(false);
  sharedHandoffRetryAfter = 0;
  return adopted;
}
/** Transfer the current account jar before removing its optional resident host. */
export async function detachInstalledCli(): Promise<void> {
  if(!usesSharedRuntime()||session.state!=="ready")return;
  const owner=session.username;
  const shared=await exportSharedSession();
  if(shared.username!==owner||!shared.snapshot)throw new Error("CLI_SHARED_SESSION_CHANGED");
  const native=await exportNativeSessionCookies();
  const cookies=mergeSameAccountServiceCookies(JSON.parse(shared.snapshot.cookiesJson),native.cookies,owner,owner);
  if(session.username!==owner)throw new Error("CLI_SHARED_SESSION_CHANGED");
  await importNativeSessionCookies(cookies,native.revision);
  const snapshot={...shared.snapshot,cookiesJson:JSON.stringify(cookies),savedAt:Date.now()};
  http.jar.hydrate(snapshot.cookiesJson);learnHttp.jar.hydrate(snapshot.cookiesJson);
  await saveSessionSnapshot(snapshot);
}
/** Explicit package installation binds to the existing native school account. */
export async function connectInstalledCli(): Promise<void> {
  if (!usesSharedRuntime() || session.state !== "ready" || !session.username) return;
  const shared = await getSharedRuntimeStatus();
  if (shared.username && shared.username !== session.username) throw new Error("CLI_SHARED_SESSION_CHANGED");
  await stageSharedHandoff(currentSessionSnapshot(), {username:shared.username,epoch:shared.epoch}, shared.bootstrapAllowed ? "bootstrap" : "login");
  await retrySharedSessionHandoff();
  const policy = await import("../state/userext.js");
  const consent = await import("../state/privacyConsent.js");
  await updateSharedPolicy(policy.mcpServerEnabled() && consent.ohAuthorized(), policy.cliAutoExecuteEnabled());
  await prepareSharedTasksAfterLogin();
}
export function retrySharedSessionHandoff(): Promise<SharedSessionSnapshot | null> {
  if (sharedHandoffRequest) return sharedHandoffRequest;
  const pending = performSharedSessionHandoff();
  sharedHandoffRequest = pending;
  const clear = () => { if (sharedHandoffRequest === pending) sharedHandoffRequest = null; };
  void pending.then(clear, () => { sharedHandoffRetryAfter = Date.now() + 30_000; clear(); });
  return pending;
}
async function adoptSuccessfulDesktopLogin(): Promise<void> {
  if (!usesSharedRuntime()) return;
  try {
    await stageSharedHandoff(currentSessionSnapshot(), { username: loginSharedAccount, epoch: loginSharedEpoch }, "login");
    if (loginSharedEpoch === null) {
      await logLine("CLI unavailable; verified school session saved for deferred handoff").catch(() => undefined);
      return;
    }
    const adopted = await retrySharedSessionHandoff();
    if (!adopted) {
      session.state = "idle";
      session.username = "";
      throw new Error("CLI_SHARED_SESSION_CHANGED");
    }
    await prepareSharedTasksAfterLogin();
  } catch (error) {
    if (/CLI_SHARED_SESSION_CHANGED/.test(String(error))) throw error;
    // The university login already succeeded. Background availability is a
    // separate state; keep this session usable and retain the retry intent.
    await markSharedHandoffPending(true);
    await logLine("CLI handoff pending; school session retained").catch(() => undefined);
  }
}
async function prepareSharedTasksAfterLogin(): Promise<void> {
  if (!usesSharedRuntime()) return;
  try { await (await import("../state/cliTasks.js")).prepareDesktopTaskRuntime(); }
  catch (error) { (await import("../state/cliRuntime.js")).reportCliRuntimeError(error); }
}

export async function persist(): Promise<void> {
  // R10：新会话落盘前清 InfoClient 静态缓存——libToken 是 10 分钟静态缓存且跨
  // 重登录存活，旧 token 配新会话会让订座恒报「没有登录或登录已超时」
  info.resetStaticSessionCaches();
  const snapshot = currentSessionSnapshot();
  await store.saveSession(snapshot);
  // 镜像到 appData 文件：localStorage 被 WKWebView 驱逐时 boot 仍可恢复
  await fileWrite(SESSION_FILE, JSON.stringify(snapshot));
  // 记住密码：登录成功链路（含 2FA 完成）统一在此落盘
  if (pendingSecret?.remember && pendingSecret.password) {
    await fileWrite(
      SECRET_FILE,
      JSON.stringify({
        v: 1,
        username: pendingSecret.username,
        secret: obfuscateSecret(pendingSecret.password, pendingSecret.username),
        savedAt: Date.now(),
      }),
    ).catch(() => undefined);
  }
}

// Keep the resolved identity as well as the in-flight read: denied/full storage
// must not make a second login or a parallel service invent another device.
let fingerprintRequest: Promise<string> | null = null;
export function currentFingerprint(): Promise<string> {
  if (fingerprintRequest) return fingerprintRequest;
  fingerprintRequest = (async () => {
    await initCliInstallation();
    if (usesSharedRuntime()) {
      try {
        const shared = await exportSharedSession();
        if (shared.snapshot?.fingerprint) {
          session.fingerprint = shared.snapshot.fingerprint;
          if (shared.snapshot.username === session.username) session.finger3 = shared.snapshot.finger3 ?? "";
          return shared.snapshot.fingerprint;
        }
      } catch (error) { if (!isSharedRuntimeUnavailable(error)) throw error; }
    }
    let saved = await store.loadSession().catch(() => null);
    const raw = await fileRead(SESSION_FILE).catch(() => null);
    let mirrored: SessionData | null = null;
    try {
      const candidate = raw ? JSON.parse(raw) as SessionData : null;
      if (candidate && typeof candidate.fingerprint === "string" && candidate.fingerprint) mirrored = candidate;
    } catch { /* A malformed mirror can be repaired from the local record. */ }
    if (!saved || typeof saved.fingerprint !== "string" || !saved.fingerprint) {
      // Authentication can start before resumeSession. Recover the same device
      // directly from the native mirror when WebView storage was evicted.
      saved = mirrored;
    }
    const snapshot: SessionData = saved ?? {
      username: "",
      fingerprint: makeFingerprint(),
      cookiesJson: "{}",
      savedAt: Date.now(),
    };
    session.fingerprint = snapshot.fingerprint;
    if (typeof snapshot.finger3 === "string") session.finger3 = snapshot.finger3;
    // First-use identity survives a failed login, a refresh and either storage
    // being unavailable. No credential submission is needed to persist it.
    await Promise.allSettled([
      store.saveSession(snapshot),
      // Preserve an existing mirror: its owner may differ after an interrupted
      // account switch. The cookie ownership gate must see that disagreement.
      mirrored ? Promise.resolve() : fileWrite(SESSION_FILE, JSON.stringify(snapshot)),
    ]);
    return snapshot.fingerprint;
  })();
  return fingerprintRequest;
}

/** facade 等外部模块的安全入口（动态 import 防环） */
export async function loadFinger3Safe(): Promise<string> {
  return loadFinger3().catch(() => "");
}

async function loadFinger3(): Promise<string> {
  const saved = await store.loadSession();
  return saved?.finger3 ?? "";
}

let resumeRequest: Promise<boolean> | null = null;
let resumeSnapshotUsername: string | null = null;
let resumeGeneration = 0;

export function resumeSession(): Promise<boolean> {
  if (resumeRequest) return resumeRequest;
  const pending = performResumeSession();
  resumeRequest = pending;
  const clear = () => { if (resumeRequest === pending) resumeRequest = null; };
  void pending.then(clear, clear);
  return pending;
}

export type BootResumeOutcome =
  | { kind: "ready"; username: string }
  | { kind: "unauthenticated" }
  | { kind: "unavailable"; username: string | null; error: unknown };

/** A slow/unavailable school service preserves local access without submitting
 * credentials. The UI also observes the eventual result of a timed-out probe. */
export async function resumeSessionForBoot(timeoutMs = 10_000): Promise<{
  outcome: BootResumeOutcome;
  settlement: Promise<BootResumeOutcome> | null;
}> {
  const pending: Promise<BootResumeOutcome> = resumeSession().then((ok): BootResumeOutcome =>
    ok ? { kind: "ready", username: resumeSnapshotUsername! } : { kind: "unauthenticated" },
  ).catch((error) => {
    void logLine("RESUME unavailable; automatic password login skipped").catch(() => undefined);
    return { kind: "unavailable", username: resumeSnapshotUsername, error };
  });
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<BootResumeOutcome>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      void logLine("RESUME probe-timeout; awaiting existing probe without password login").catch(() => undefined);
      resolve({ kind: "unavailable", username: resumeSnapshotUsername,
        error: Object.assign(new Error("Session recovery is still in progress."), { code: "AUTH_IN_PROGRESS" }) });
    }, timeoutMs);
  });
  try {
    return { outcome: await Promise.race([pending, deadline]), settlement: timedOut ? pending : null };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Read both ownership records before any cookie hydration. A half-written
 * account switch must never attach account B's native jar to account A's UI. */
async function loadConsistentSessionSnapshot(): Promise<SessionData | null> {
  const [localRead, fileReadResult] = await Promise.allSettled([
    store.loadSession(), fileRead(SESSION_FILE, { strict: true }),
  ]);
  const conflict = () => Object.assign(new Error("Saved session ownership could not be verified. Please sign in again."), { code: "AUTH_SESSION_CONFLICT" });
  if (localRead.status === "rejected" || fileReadResult.status === "rejected") throw conflict();
  let mirror: unknown = null;
  try { if (fileReadResult.value) mirror = JSON.parse(fileReadResult.value); } catch { throw conflict(); }
  const valid = (value: unknown): value is SessionData => !!value && typeof value === "object"
    && typeof (value as SessionData).username === "string"
    && typeof (value as SessionData).fingerprint === "string"
    && !!(value as SessionData).fingerprint
    && typeof (value as SessionData).cookiesJson === "string";
  const local = localRead.value;
  if ((local !== null && !valid(local)) || (mirror !== null && !valid(mirror))) throw conflict();
  if (local && mirror && local.username !== mirror.username) throw conflict();
  return local ?? mirror as SessionData | null;
}

async function performResumeSession(): Promise<boolean> {
  await initCliInstallation();
  const generation = resumeGeneration;
  resumeSnapshotUsername = null;
  void logLine("PROBE resume-entry").catch(() => undefined);
  let saved: SessionData | null;
  try {
    if (usesSharedRuntime()) {
      await finishPendingSharedLogout();
      const pendingHandoff = await readPendingSharedHandoff();
      if (pendingHandoff) {
        resumeSnapshotUsername = pendingHandoff.snapshot.username;
        await retrySharedSessionHandoff();
      }
      let shared = await exportSharedSession();
      sharedLoggedOut = shared.tombstone === true;
      if (shared.session.twoFactor?.pending || shared.session.state === "need-2fa") {
        // The CLI owns this pending verification. Keep the old durable GUI
        // snapshot until the new login completes, and suppress silent password
        // submission that would interrupt its 2FA flow.
        sharedLoggedOut = true;
        rememberSharedSession(shared);
        session.state = "idle"; session.username = ""; pendingSecret = null;
        return false;
      }
      if (!shared.snapshot && shared.bootstrapAllowed === true) {
        const local = await loadConsistentSessionSnapshot();
        if (local?.fingerprint) { session.fingerprint = local.fingerprint; fingerprintRequest = Promise.resolve(local.fingerprint); }
        if (local?.username && local.cookiesJson && local.cookiesJson !== "{}") {
          resumeSnapshotUsername = local.username;
          await stageSharedHandoff(local, shared, "bootstrap");
          shared = await retrySharedSessionHandoff() ?? await exportSharedSession();
          if (shared.policy.configured === false) {
            const [{ mcpServerEnabled, cliAutoExecuteEnabled }, { ohAuthorized }] = await Promise.all([
              import("../state/userext.js"), import("../state/privacyConsent.js"),
            ]);
            await updateSharedPolicy(mcpServerEnabled() && ohAuthorized(), cliAutoExecuteEnabled());
          }
        }
      }
      if (generation !== resumeGeneration) return false;
      saved = shared.snapshot;
      if (saved && shared.session.state !== "ready") {
        // A nonblocking export is a durable snapshot, not a completed identity
        // proof. Keep the existing native jar only for a matching local owner;
        // never replace it with the daemon's still-unverified older cookies.
        const local = await loadConsistentSessionSnapshot();
        if (generation !== resumeGeneration) return false;
        if (!local?.username || local.username !== shared.username) {
          resumeSnapshotUsername = null;
          throw new Error("CLI_SHARED_RESTORE_PENDING");
        }
        saved = local;
      } else {
        const native = await exportNativeSessionCookies();
        if (generation !== resumeGeneration) return false;
        const localOwner = (await loadConsistentSessionSnapshot().catch(() => null))?.username ?? null;
        const cookies = mergeSameAccountServiceCookies(saved ? JSON.parse(saved.cookiesJson) : [], native.cookies,
          localOwner, shared.session.state === "ready" ? saved?.username ?? null : null);
        if (generation !== resumeGeneration) return false;
        await importNativeSessionCookies(cookies, native.revision);
        if (generation !== resumeGeneration) return false;
        // Atomic native import must succeed before changing JS ownership or the
        // durable GUI mirror. An import/disk failure leaves the old account whole.
        session.reset(); session.username = ""; pendingSecret = null;
        const { libAcceptSharedSession } = await import("./infoLib.js");
        await libAcceptSharedSession(saved?.username ?? null);
        if (saved) {
          fingerprintRequest = Promise.resolve(saved.fingerprint);
          await saveSessionSnapshot(saved);
        } else {
          await saveSessionSnapshot({ username: "", fingerprint: session.fingerprint, finger3: "", cookiesJson: "[]", savedAt: Date.now() });
        }
      }
      rememberSharedSession(shared);
    } else saved = await loadConsistentSessionSnapshot();
  } catch (error) {
    if (generation !== resumeGeneration) return false;
    if (usesSharedRuntime()) {
      // Bridge/proof failure is separate from school authentication. Preserve
      // the existing ready session and its native jar until adoption succeeds.
      if (!isSharedRuntimeUnavailable(error)) throw error;
      saved = await loadConsistentSessionSnapshot();
      void logLine("CLI unavailable; probing owned native school session").catch(() => undefined);
    } else {
      const { libDiscardLocalSession } = await import("./infoLib.js");
      if (generation !== resumeGeneration) return false;
      await libDiscardLocalSession();
      session.reset();session.username = "";session.finger3 = "";pendingSecret = null;
      throw error;
    }
  }
  void logLine("PROBE store-loaded").catch(() => undefined);
  if (generation !== resumeGeneration) return false;
  if (saved) await store.saveSession(saved).catch(() => undefined);
  if (generation !== resumeGeneration) return false;
  // Identity survives a failed first login and logout (both can have an empty jar).
  if (saved?.fingerprint) session.fingerprint = saved.fingerprint;
  if (saved?.finger3) session.finger3 = saved.finger3;
  if (!saved || !saved.username || !saved.cookiesJson || saved.cookiesJson === "{}") {
    await logLine("RESUME no-saved-session");
    return false;
  }
  http.jar.hydrate(saved.cookiesJson);
  learnHttp.jar.hydrate(saved.cookiesJson);
  resumeSnapshotUsername = saved.username;
  session.username = saved.username;
  session.fingerprint = saved.fingerprint;
  session.finger3 = saved.finger3 ?? "";
  {
    const { setLibFinger3, helper } = await import("./infoLib.js");
    if (generation !== resumeGeneration) return false;
    setLibFinger3(session.finger3);
    helper.fingerprint = saved.fingerprint;
    helper.userId = saved.username;
  }
  // 记住的密码（仅内存）：dorm/library 的 id 直登与静默重登都要用
  const candidate = await loadRemembered();
  const remembered = candidate?.username === saved.username ? candidate : null;
  if (generation !== resumeGeneration) return false;
  if (remembered) {
    session.injectCredentials(remembered.username, remembered.password);
    // learn 静默重登（路径二）的账密源：首轮 resume 即可用，不必等静默重登
    pendingSecret = { username: remembered.username, password: remembered.password, remember: true };
  }
  // [启动计时] 阶段毫秒分解——数据驱动定位蜗牛环节
  const T = Date.now();
  const mark = (label: string): void => {
    void logLine(`BOOT-T ${label} +${Date.now() - T}ms`).catch(() => undefined);
  };
  mark("水合完成(0网络)");
  // lib 单管线：webvpn 会话在 jar 里，learn/info 都经包装域 wengine SSO 透明建立——
  // resume 只需探活：learn 拿得到 _csrf = webvpn 会话活 + learn 可达。
  // Gateway pages, HTTP 403/429/5xx and transport failures propagate as service
  // errors. Only a confirmed missing authentication returns false.
  const probe = await probeLearnSession({ fetch: (url, init) => nativeFetch(url, init as Parameters<typeof nativeFetch>[1]),
    seed: learnHttp.nativeSeedHook,
    check: () => { if (generation !== resumeGeneration) throw new Error("AUTH_SESSION_CHANGED"); },
  });
  if (generation !== resumeGeneration) return false;
  const okLearn = probe.ready;
  learn.lastDebug = probe.page;
  learn.lastCsrfDebug = probe.diagnostic;
  if (okLearn && probe.csrf) learn.applyCsrf(probe.csrf);
  mark(okLearn ? "learn.resume(会话活)" : "learn.resume(过期)");
  if (!okLearn) {
    await logLine("RESUME fail (learn 探活失败——boot 将走静默重登)");
    return false;
  }
  if (generation !== resumeGeneration) return false;
  // Info has its own lazy service establishment. A best-effort warm-up here
  // used to keep the sign-in mutex held even after Learn proved the session.
  // Resume submits no login. Legacy roaming services still need matching local
  // remembered credentials in memory before the GUI starts loading their data.
  if (remembered) {
    const { helper } = await import("./infoLib.js");
    if (generation !== resumeGeneration) return false;
    // CLI adoption already supplies userId but deliberately carries no password.
    // Restore only this verified owner's remembered credentials in GUI memory.
    if (!helper.userId || helper.userId === remembered.username) {
      helper.userId = remembered.username;
      helper.password = remembered.password;
      helper.fingerprint = saved.fingerprint;
      helper.fingerGenPrint = saved.finger3 ?? "";
      await logLine("RESUME lib-凭据注入(快路径)").catch(() => undefined);
    }
  }
  if (generation !== resumeGeneration) return false;
  session.state = "ready";
  mark("会话就绪");
  await logLine("RESUME ok (lib 单管线)");
  mark("READY(总耗时)");
  // Task-channel synchronization has an independent account/epoch guard and
  // its own error reporting; it must not hold the foreground login mutex.
  void prepareSharedTasksAfterLogin().catch(() => undefined);
  return true;
}

/** 是否存在「曾登录」的会话快照（显式 logout 会清空，防止 boot 静默重登顶替登出） */
async function hasLiveSnapshot(): Promise<boolean> {
  if (usesSharedRuntime() && sharedLoggedOut) return false;
  const saved = await loadConsistentSessionSnapshot().catch(() => null);
  return Boolean(saved?.username && ((saved.cookiesJson && saved.cookiesJson !== "{}") || saved.demoCookies));
}

/** boot 恢复失败时的静默重登（记住密码）：成功 true；无存档/需 2FA/失败 false。
 *  显式登出后无会话快照 → 不触发，保证「退出登录」不被自动顶掉。 */
export async function trySilentRelogin(): Promise<
  { ok: true } | { ok: false; twoFactor?: { username: string; password: string; methods: TwoFactorMethod[] } }
> {
  if (!(await hasLiveSnapshot())) return { ok: false };
  // 【互斥】用户正在 2FA 界面（lib 登录链未 settled）时静默重登必须停手：
  // login() 会 clearOutstandingLogin 杀掉用户的 2FA 会话 → 验证码永远失效 →
  // 无限重发循环（2026-09-18 14:28-14:30 每 30s 一轮实录）
  try {
    const { libLoginPending } = await import("./infoLib.js");
    if (libLoginPending()) {
      await logLine("SILENT-RELOGIN skip: 用户 2FA 进行中").catch(() => undefined);
      return { ok: false };
    }
  } catch { /* import 失败按原流程 */ }
  const remembered = await loadRemembered();
  if (!remembered) {
    await logLine("SILENT-RELOGIN skip: 无记住的密码").catch(() => undefined);
    return { ok: false };
  }
  const saved = await loadConsistentSessionSnapshot().catch(() => null);
  if (!saved?.username || remembered.username !== saved.username) return { ok: false };
  try {
    const result = await login(remembered.username, remembered.password, { remember: true });
    if (result.state === "ready") {
      await logLine("SILENT-RELOGIN ok").catch(() => undefined);
           return { ok: true };
    }
    await logLine("SILENT-RELOGIN need-2fa").catch(() => undefined);
    return {
      ok: false,
      twoFactor: {
        username: remembered.username,
        password: remembered.password,
        methods: result.methods,
      },
    };
  } catch (err) {
    await logLine("SILENT-RELOGIN fail " + String(err)).catch(() => undefined);
    return { ok: false };
  }
}

export async function logout(): Promise<void> {
  // A probe that was still running after the boot deadline cannot revive logout.
  resumeGeneration++;
  resumeSnapshotUsername = null;
  let sharedError: unknown;
  if (usesSharedRuntime()) {
    sharedLoggedOut = true;
    pendingSharedHandoffMemory = null;
    try {
      await fileDelete(SHARED_HANDOFF_FILE, { strict: true });
      await markSharedHandoffPending(false);
      if (session.username && sharedSessionEpoch !== null) await fileWrite(SHARED_LOGOUT_FILE,
        JSON.stringify({ expectedAccount: session.username, expectedEpoch: sharedSessionEpoch }), { strict: true });
      const status = await getSharedRuntimeStatus();
      // A newer account in the CLI must not be signed out by this stale UI.
      if (status.username && status.username !== session.username) throw new Error("CLI_SHARED_SESSION_CHANGED");
      if (status.username) await fileWrite(SHARED_LOGOUT_FILE,
        JSON.stringify({ expectedAccount: status.username, expectedEpoch: status.epoch }), { strict: true });
      await logoutSharedSession(status.username, status.epoch);
      await fileDelete(SHARED_LOGOUT_FILE, { strict: true });
      rememberSharedSession(await getSharedRuntimeStatus());
    } catch (error) { sharedError = error; }
  }
  // 体育系统 token 与会话解耦但跟随登出清空（防串账号）
  const { venueLogout } = await import("./venue.js");
  venueLogout();
  // 云盘 token 跟随登出清空：共享设备换账号后不能继续读写上一个账号的云盘（强制云盘口径）。
  try {
    const { clearSeafileToken } = await import("../state/seafile.js");
    await clearSeafileToken();
  } catch {
    /* 云盘未初始化/已清空 */
  }
  // R10：图书馆静态 token 同步清空（防串账号/防旧 token 撞新会话）
  info.resetStaticSessionCaches();
  // lib 链登出（webvpn LOGOUT + 共享 jar 清空）
  const { libLogout, libDiscardLocalSession } = await import("./infoLib.js");
  try {
    // cookieBoundary writes an explicit signed-out record in both stores.
    // Keep that tombstone: deleting one copy could expose an older surviving copy.
    if (usesSharedRuntime()) await libDiscardLocalSession();
    else await libLogout();
  } finally {
    pendingSecret = null;
    session.reset();
    session.username = "";
    session.finger3 = "";
  }
  if (sharedError) {
    (await import("../state/cliRuntime.js")).reportCliRuntimeError(sharedError);
    throw sharedError;
  }
}

/** A disconnected sign-out is retried only against its original identity. A
 * subsequent CLI login has a newer epoch and supersedes this old intention. */
async function finishPendingSharedLogout(): Promise<void> {
  const raw = await fileRead(SHARED_LOGOUT_FILE, { strict: true });
  if (!raw) return;
  const pending = JSON.parse(raw) as { expectedAccount: string; expectedEpoch: number };
  if (typeof pending.expectedAccount !== "string" || !Number.isSafeInteger(pending.expectedEpoch)) throw new Error("CLI_PENDING_LOGOUT_INVALID");
  const status = await getSharedRuntimeStatus();
  if (status.username === pending.expectedAccount && status.epoch === pending.expectedEpoch) {
    await logoutSharedSession(pending.expectedAccount, pending.expectedEpoch);
  }
  await fileDelete(SHARED_LOGOUT_FILE, { strict: true });
}

/** Observe account changes made through the CLI without password re-submission.
 * Polling reads status; account, epoch or authentication-stage changes trigger
 * one fenced hydrate. CLI 2FA can finish without rotating its prepared epoch. */
export async function refreshSharedSession(onChanging?: () => void): Promise<BootResumeOutcome | null> {
  if (!usesSharedRuntime() || clientLoginRequest || resumeRequest || session.state === "need-2fa") return null;
  await finishPendingSharedLogout();
  let requiresHydration = false;
  const pendingHandoff = await readPendingSharedHandoff();
  if (pendingHandoff) {
    await markSharedHandoffPending(true);
    if (Date.now() < sharedHandoffRetryAfter) return null;
    try {
      const adopted = await retrySharedSessionHandoff();
      if (adopted && session.state === "ready" && session.username === adopted.username) {
        await prepareSharedTasksAfterLogin();
        return null;
      }
      requiresHydration = adopted !== null;
    } catch {
      // No connecting screen or empty-daemon cleanup while the successful
      // school login is waiting for its background proof. Retry is bounded.
      return null;
    }
  }
  const shared = await getSharedRuntimeStatus();
  if (!requiresHydration && sharedSessionEpoch !== null && sharedSessionEpoch === shared.epoch && sharedSessionState === sharedSessionStateKey(shared)) return null;
  if (!requiresHydration && session.state === "ready" && sharedSessionEpoch === shared.epoch && session.username === shared.username && shared.session.state === "ready") {
    // An idle -> ready startup probe at the same epoch does not represent a
    // login/account change. Keep the GUI's newer service cookies and CSRF.
    rememberSharedSession(shared);
    return null;
  }
  onChanging?.();
  resumeGeneration++;
  pendingSecret = null;
  return resumeSession().then(ok => ok ? { kind: "ready", username: session.username } as const : { kind: "unauthenticated" } as const)
    .catch(error => ({ kind: "unavailable", username: resumeSnapshotUsername, error } as const));
}

/** learn 下载/二进制 URL 附加 _csrf —— mobile fs.downloadFile 的 addCSRF 同款：
 *  learn /b/ 下载端点缺 _csrf 时可能返回 HTML 错误页而非文件流；
 *  learn-lib 的 myFetchWithToken 对所有 learn 请求统一加 token。 */
export function withLearnCsrf(url: string): string {
  try {
    const u = new URL(url);
    // lib 单管线：learn URL 是 webvpn 包装形态，解码出真实域再判断
    const decoded = webvpnDecodeUrl(url);
    const realHost = decoded ? new URL(decoded).hostname : u.hostname;
    if (realHost !== "learn.tsinghua.edu.cn" && !realHost.endsWith(".learn.tsinghua.edu.cn")) return url;
    const token = learn.csrfToken;
    if (!token || u.searchParams.has("_csrf")) return url;
    u.searchParams.set("_csrf", token);
    return u.toString();
  } catch {
    return url;
  }
}

/** learn 文件下载：带会话 Cookie 直连取字节，落盘到设置中的下载目录 */
export async function downloadLearnFile(fileId: string, filename: string): Promise<string> {
  const { LEARN_FILE_DOWNLOAD } = await import("@onethu/core");
  return downloadLearnUrl(LEARN_FILE_DOWNLOAD(fileId), filename);
}

/**
 * 另存为：这一次落哪儿由用户当场决定（桌面系统保存对话框 / Android 保存到…）。
 * 返回落盘位置；用户取消返回 null（取消不是错误，调用方别弹报错）。
 */
export async function saveLearnUrlAs(url: string, filename: string): Promise<string | null> {
  // 取数形态与图片/预览一致：直连 learn 域没有会话，必须换成 webvpn 包装形态；
  // Rust 侧 save_file_as 再补上原生仓 cookie + 主 webview UA（见 fetch_attachment）。
  const target = sessionUrl(url);
  const jarCookies = http.jar
    .getCookies(new URL(target))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("save_file_as", { url: target, cookies: jarCookies, filename });
}

/** 任意 learn 资源下载（作业/通知附件端点与课件不同，由 core 解析出完整 downloadUrl）。
 *  落盘名以前端传入的 filename 为准；Rust 侧会用响应 Content-Disposition 的真名兜底。 */
export async function downloadLearnUrl(url: string, filename: string): Promise<string> {
  // 同上：先归一 + 换成 webvpn 包装形态（历史缓存/其它路径可能给出双重包装的地址，
  // sessionUrl 内部已含 normalizeWebvpnUrl 兜底），否则直连 learn 域只会拿到登录页。
  const target = sessionUrl(url);
  const jarCookies = http.jar
    .getCookies(new URL(target))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("download_file", { url: target, cookies: jarCookies, filename });
}

/** 校园二进制取数统一走**数据链同一个会话世界**：webvpn 包装域 + 原生通道（nativeFetch）。
 *
 *  2026-10-12 真机实录（通知正文图片全碎，同一 URL 只差取数形态）：
 *   ① 正文里的图片 src 是**直连** learn 域的 URL，而本应用的 learn 会话只活在 webvpn
 *      **包装域**里——直连实测回 69 字节 `location.href="/"` 跳转页（无会话），
 *      同一 URL 换成包装形态即 200 `image/jpeg` 40–71 KB；
 *   ② 旧路 `fetch_binary` 自带 Mac UA + 只吃 JS 侧 cookie，而 wengine 会话票按 UA 指纹
 *      校验（见 src-tauri/src/lib.rs 原生通道那句注释），包装域请求会被判「票无效」
 *      → 同样回登录页。故图片与附件预览都不再走 fetch_binary，改用与 http_native/
 *      数据链同一只 client（原生 cookie 仓 + 主 webview UA）。
 *  失败由调用方处理（碎图/提示）。 */
const IMG_MAX_BYTES = 12 * 1024 * 1024;

/** 校园 URL → 会话可达形态：先归一双重包装，再按 host 分流决定是否包装，最后补 learn 的
 *  `_csrf`。图片（clients 内）与附件预览（components/FilePreview.tsx）共用这一份规则。 */
export function sessionUrl(url: string, forceWrap = false): string {
  let target = normalizeWebvpnUrl(url);
  try {
    const host = new URL(target).hostname;
    if (http.webVPNEncoder && host && (forceWrap || !CAMPUS_PUBLIC_HOSTS.has(host))) {
      target = http.webVPNEncoder(target);
    }
  } catch {
    /* 非 http URL 原样尝试 */
  }
  return withLearnCsrf(target);
}

/** 字节 → base64（分块防参数栈溢出；几十 MB 的预览文件也走这里）。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** 「登录墙」判定：短响应 + 跳转/登录页特征（判据与 Rust fetch_binary 同源）。
 *  认出来才能让上层走「请重新登录」提示，而不是退化成一个莫名的解析失败。 */
export function isLoginWallBody(mime: string, buf: Uint8Array): boolean {
  if (/^image\//i.test(mime)) return false;
  const head = new TextDecoder().decode(buf.subarray(0, 512)).trimStart();
  return /location\.href/i.test(head) || /^<(!doctype|html)/i.test(head);
}

async function fetchImageDataUrl(url: string, forceWrap: boolean): Promise<string> {
  const resp = await nativeFetch(sessionUrl(url, forceWrap), { method: "GET" });
  const mime = (resp.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  const buf = new Uint8Array(await resp.arrayBuffer());
  if (buf.length > IMG_MAX_BYTES) throw new Error(i18n("lib.clients.dc300032c143", { length: String(buf.length) }));
  if (isLoginWallBody(mime, buf)) throw new Error(i18n("lib.clients.193d04db6243"));
  // mime 守卫（2026-09-13 用户实锤「通知/作业图片渲染不出来但讨论区好」）：会话墙/404
  // 返回 HTML，字节照样抓回来——不校验就把登录页当图片塞 <img>，静默碎图且 catch 永不触发。
  if (!/^image\//i.test(mime) || buf.length < 80) {
    throw new Error(i18n("lib.clients.cbad5bdfa19f", { mime: String(mime), length: String(buf.length) }));
  }
  return `data:${mime};base64,${bytesToBase64(buf)}`;
}

/** 正文图片 → dataURL：webview 的 <img> 不携带应用会话 Cookie，直挂 learn 地址只会得到
 *  登录页；须由应用侧带会话抓取后内联（取数形态见 fetchImageDataUrl 注释）。 */
export async function fetchImageAsDataUrl(url: string): Promise<string> {
  return fetchImageDataUrl(url, false);
}

/** 校内 host 分流（HttpClient.request 同名单）：公网站点直连，其余（seat.lib 等
 *  校内网关域名）校外不可达，恒经 WebVPN 包装——与图书馆 api.php 请求同轨。 */
const CAMPUS_PUBLIC_HOSTS = new Set([
  // lib 单管线（P3）：info/learn 全量走包装域，不再公网直连
  // card.tsinghua.edu.cn 移出（2026-09-17）：9-06 已定案 card 会话建在包装
  // 通道（oauth lbredirect 兑票落点恒为包装 URL），直连探测永远看不见会话
  // → 校外圈存直连超时报「请确认校园网/WebVPN 可达」。与 core 的
  // PUBLIC_DIRECT_HOSTS 同步（9-06 已退出直连），webvpnWrap 可编任意域。
  "webvpn.tsinghua.edu.cn",
  "id.tsinghua.edu.cn",
  "oauth.tsinghua.edu.cn",
]);

/** 任意校内图片 URL → dataURL（forceWrap=true 时无视 host 分流强制包装——学网图片在
 *  校园网外的真终点）。取数形态与 fetchImageAsDataUrl 完全一致（包装域 + 原生通道）。 */
export async function fetchImageByUrl(url: string, forceWrap = false): Promise<string> {
  return fetchImageDataUrl(url, forceWrap);
}

export { isTauri };
