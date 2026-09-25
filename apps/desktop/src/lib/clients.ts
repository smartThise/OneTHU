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
import { loginCooldownLeftMs, markLoginFailedPublicKey } from "./loginGate.js";
import { setWebvpnLog, setZhjwxkDebug, setZhjwxkNativeClear, setZhjwxkReloginHook } from "@onethu/core";
import { withPrivacy } from "./privacy.js";

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

export async function fileRead(name: string): Promise<string | null> {
  if (!isTauri) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string | null>("state_read", { name });
  } catch {
    return null;
  }
}

export async function fileWrite(name: string, content: string): Promise<void> {
  if (!isTauri) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("state_write", { name, content });
  } catch {
    /* 文件存储尽力而为：失败不阻塞主流程 */
  }
}

export async function fileDelete(name: string): Promise<void> {
  if (!isTauri) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("state_delete", { name });
  } catch {
    /* ignore */
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
http.nativeSeedHook = (url, pair) => {
  const name = pair.split("=")[0]!.trim();
  if (name === "wengine_vpn_ticket" || name.startsWith("show_") || name === "heartbeat" || name === "refresh") {
    return;
  }
  void nativeSeedCookies(url, [`${pair}; Path=/`]);
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
learnHttp.nativeSeedHook = (url, pair) => {
  const name = pair.split("=")[0]!.trim();
  if (name === "wengine_vpn_ticket" || name.startsWith("show_") || name === "heartbeat" || name === "refresh") {
    return;
  }
  void nativeSeedCookies(url, [`${pair}; Path=/`]);
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
    await invoke("log_debug", { line: new Date().toISOString() + " | " + text });
  } catch {
    /* noop */
  }
}

// R10：图书馆首页全量转储（log_debug 单行有截断，分块绕过）
void (async () => {
  try {
    const { InfoClient } = await import("@onethu/core");
    InfoClient.onDebugDump = (label, content) => {
      const CHUNK = 6000;
      const n = Math.ceil(content.length / CHUNK);
      for (let i = 0; i < n; i++) {
        void logLine(`DUMP ${label} ${i + 1}/${n}: ${content.slice(i * CHUNK, (i + 1) * CHUNK)}`);
      }
    };
  } catch {
    /* 钩子失败不影响主流程 */
  }
})();

async function dumpDebug(err: unknown): Promise<void> {
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
export async function login(
  username: string,
  password: string,
  opts: { remember?: boolean } = {},
): Promise<{ state: "ready" } | { state: "need-2fa"; methods: TwoFactorMethod[]; debugHtml: string }> {
  const { initInfoLib, libLogin, setLibFinger3, helper } = await import("./infoLib.js");
  const fingerprint = await currentFingerprint();
  // （2026-09-18 决策）轮换实验撤除：强制 2FA 的链路被 keepalive/静默重登/
  // lib 僵尸链三面夹击，稳定性失控。回归简单：fp 固定，登录一次 2FA 到位；
  // finger3 缺失时选课靠死结自愈兜底（确认失败→清账直登，实测可用）。
  const remember = opts.remember ?? true;
  pendingSecret = { username, password, remember };
  if (!remember) await clearRemembered().catch(() => undefined);

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
      }
      session.injectCredentials(username, password);
      await persist();
      await logLine("LOGIN-OK (lib 链，单管线)");
      // R17 23.3-4：设备信任已建立 → 自动重试一次此前失败的 TUOJ 漫游
      retryTuojAfterTrust();
      // lib 主会话活了 → learn 客户端经 webvpn 透明 SSO 抓 _csrf（2026-09-17
      // 实录：缺此步则 loadReal 的 learn.* 预请求即抛 AuthRequiredError →
      // CAMPUS-AUTH 无限循环；resume 内部抓不到就保持未登录，不抛错）
      let okLearn = await learn.resume().catch(() => false);
      if (!okLearn) {
        // learn 会话没随主登录活：用 lib 的 id-漫游（card/info 同款）建它
        const { libRoamLearn } = await import("./infoLib.js");
        if (await libRoamLearn()) {
          okLearn = await learn.resume().catch(() => false);
        }
      }
      await logLine(
        "LOGIN learn-resume " + (okLearn ? "ok" : "fail ") +
        (okLearn ? "" : ` lastDebug=${learn.lastDebug.slice(0, 260).replace(/\s+/g, " ")}`),
      ).catch(() => undefined);
    } else {
      session.username = username;
      session.state = "need-2fa";
      await logLine("LOGIN need-2fa methods=" + r.methods.map((m) => m.type).join(","));
    }
    return r.state === "need-2fa" ? { ...r, debugHtml: "" } : r;
  } catch (err) {
    if (err instanceof Error) await dumpDebug(err);
    await logLine("LOGIN-ERR " + String(err));
    // 封锁页特征（2026-09-17 实录）：下次 libLogin 前清原生仓换新身份
    if (String(err).includes("public key")) markLoginFailedPublicKey();
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

export async function verify2FA(type: string, code: string, trust: boolean): Promise<TwoFactorMethod[] | null> {
  const { libVerify2FA, helper, getSelfFinger3 } = await import("./infoLib.js");
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
      await logLine(`FINGER3 verify 落盘 len=${session.finger3.length}`).catch(() => undefined);
    }
    if (pendingSecret) session.injectCredentials(pendingSecret.username, pendingSecret.password);
    await persist();
    await logLine("VERIFY-OK (lib 链完成)");
    // R17 23.3-4：2FA + 信任设备完成 → 自动重试一次此前失败的 TUOJ 漫游
    retryTuojAfterTrust();
    // 同 login()：2FA 完成即主会话活，learn 透明 SSO 建 csrf
    await learn.resume().catch(() => false);
    return null;
  } catch (err) {
    // finger3 必须保住：即使验证失败也不能丢受信凭据
    await persist().catch(() => undefined);
    await dumpDebug(err);
    await logLine("VERIFY-ERR " + String(err));
    throw err;
  }
}

export async function persist(): Promise<void> {
  // R10：新会话落盘前清 InfoClient 静态缓存——libToken 是 10 分钟静态缓存且跨
  // 重登录存活，旧 token 配新会话会让订座恒报「没有登录或登录已超时」
  info.resetStaticSessionCaches();
  const snapshot: SessionData = {
    username: session.username,
    fingerprint: session.fingerprint,
    cookiesJson: http.jar.serialize(),
    finger3: session.finger3,
    savedAt: Date.now(),
  };
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

export async function currentFingerprint(): Promise<string> {
  const saved = await store.loadSession();
  if (saved?.fingerprint) return saved.fingerprint;
  // 首次生成即落盘（demo 的 redux-persist 初值语义）：否则登录中途崩溃会
  // 重新随机，设备信任（fingerPrint 比对）永远建立不起来
  const fp = makeFingerprint();
  await store
    .saveSession({
      username: "",
      fingerprint: fp,
      cookiesJson: "{}",
      savedAt: Date.now(),
    })
    .catch(() => undefined);
  return fp;
}

/** facade 等外部模块的安全入口（动态 import 防环） */
export async function loadFinger3Safe(): Promise<string> {
  return loadFinger3().catch(() => "");
}

async function loadFinger3(): Promise<string> {
  const saved = await store.loadSession();
  return saved?.finger3 ?? "";
}

export async function resumeSession(): Promise<boolean> {
  void logLine("PROBE resume-entry").catch(() => undefined);
  let saved = await store.loadSession();
  void logLine("PROBE store-loaded").catch(() => undefined);
  if (!saved) {
    // localStorage 缺失（WKWebView 驱逐/清空）：从 appData 文件回灌并写回本地
    const raw = await fileRead(SESSION_FILE);
    if (raw) {
      try {
        saved = JSON.parse(raw) as SessionData;
        await store.saveSession(saved).catch(() => undefined);
        await logLine("RESUME session 从本机文件回灌（localStorage 缺失）").catch(() => undefined);
      } catch {
        saved = null;
      }
    }
  }
  if (!saved || !saved.cookiesJson || saved.cookiesJson === "{}") {
    await logLine("RESUME no-saved-session");
    return false;
  }
  http.jar.hydrate(saved.cookiesJson);
  session.username = saved.username;
  session.fingerprint = saved.fingerprint;
  session.finger3 = saved.finger3 ?? "";
  {
    const { setLibFinger3, helper } = await import("./infoLib.js");
    setLibFinger3(session.finger3);
    helper.fingerprint = saved.fingerprint;
  }
  // 记住的密码（仅内存）：dorm/library 的 id 直登与静默重登都要用
  const remembered = await loadRemembered();
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
  const okLearn = await learn.resume().catch((e) => {
    logLine("RESUME learn-error " + String(e)).catch(() => undefined);
    return false;
  });
  mark(okLearn ? "learn.resume(会话活)" : "learn.resume(过期)");
  if (!okLearn) {
    await logLine("RESUME fail (learn 探活失败——boot 将走静默重登)");
    return false;
  }
  session.state = "ready";
  await info.resume().catch(() => false);
  mark("info.resume");
  // lib 凭据注入（2026-09-17）：快路径（learn 会话活）不跑 libLogin，
  // helper.userId 恒空 → card/日历/新闻等 lib 数据调用秒抛 Please login.
  // 有记住的密码就补上（roamingWrapper 需要账密才能按需漫游）。
  if (remembered) {
    const { helper } = await import("./infoLib.js");
    if (!helper.userId) {
      helper.userId = remembered.username;
      helper.password = remembered.password;
      helper.fingerprint = saved.fingerprint;
      helper.fingerGenPrint = saved.finger3 ?? "";
      await logLine("RESUME lib-凭据注入(快路径)").catch(() => undefined);
    }
  }
  await logLine("RESUME ok (lib 单管线)");
  mark("READY(总耗时)");
  return true;
}

/** 是否存在「曾登录」的会话快照（显式 logout 会清空，防止 boot 静默重登顶替登出） */
async function hasLiveSnapshot(): Promise<boolean> {
  const saved = await store.loadSession().catch(() => null);
  if (saved && ((saved.cookiesJson && saved.cookiesJson !== "{}") || saved.demoCookies)) return true;
  const raw = await fileRead(SESSION_FILE);
  if (raw) {
    try {
      const j = JSON.parse(raw) as SessionData;
      if ((j.cookiesJson && j.cookiesJson !== "{}") || j.demoCookies) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
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
  // 体育系统 token 与会话解耦但跟随登出清空（防串账号）
  const { venueLogout } = await import("./venue.js");
  venueLogout();
  // R10：图书馆静态 token 同步清空（防串账号/防旧 token 撞新会话）
  info.resetStaticSessionCaches();
  // lib 链登出（webvpn LOGOUT + 共享 jar 清空）
  const { libLogout } = await import("./infoLib.js");
  await libLogout().catch(() => undefined);
  // demo（thu-app-desktop auth slice）语义：登出只清凭据，fingerprint 与 finger3
  // 属设备信任、跨登出保留——否则下次登录指纹重随机 → 信任失效 → 每次被迫 2FA
  // （17:40 存档丢失 → 指纹重随机的教训）。
  const saved = await store.loadSession().catch(() => null);
  await store.clearSession();
  // 会话快照（本地 + 文件）一并清空：无「曾登录」快照，boot 的静默重登才不会
  // 把显式登出顶掉。记住的密码保留（登录页预填用），仅 Settings 可清除。
  await fileDelete(SESSION_FILE);
  pendingSecret = null;
  session.reset();
  if (saved?.fingerprint) {
    await store
      .saveSession({
        username: "",
        fingerprint: saved.fingerprint,
        finger3: saved.finger3 ?? "",
        cookiesJson: "{}",
        demoCookies: "",
        idJsid: "",
        savedAt: Date.now(),
      })
      .catch(() => undefined);
  }
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
  const target = withLearnCsrf(normalizeWebvpnUrl(url));
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
  // 归一：历史缓存/其它路径可能给出双重包装的 webvpn 地址（真机 404 事故），这里兜住
  const target = withLearnCsrf(normalizeWebvpnUrl(url));
  const jarCookies = http.jar
    .getCookies(new URL(target))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("download_file", { url: target, cookies: jarCookies, filename });
}

/** 正文图片 → dataURL：webview 的 <img> 不携带应用会话 Cookie，
 *  直挂 learn 地址只会得到登录页；须由应用侧带 Cookie 抓取后内联。 */
export async function fetchImageAsDataUrl(url: string): Promise<string> {
  const target = withLearnCsrf(normalizeWebvpnUrl(url));
  const jarCookies = http.jar
    .getCookies(new URL(target))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const { invoke } = await import("@tauri-apps/api/core");
  // Referer 显式传入（webvpn 包装 URL 不含 learn 字样，Rust 侧域名判断会漏带）
  const out = await invoke<{ mime: string; data: string }>("fetch_binary", {
    url: target,
    cookies: jarCookies,
    referer: "https://learn.tsinghua.edu.cn/f/wlxt/index.jsp",
  });
  // mime 守卫（2026-09-13 用户实锤「通知/作业图片渲染不出来但讨论区好」）：
  // 会话墙/404 返回 HTML，字节照样抓回来——不校验就把登录页当图片塞 <img>，
  // 静默碎图且 catch 永不触发。非 image/* 或字节过小一律按失败抛出走回退链。
  if (!out || !/^image\//i.test(out.mime ?? "") || (out.data?.length ?? 0) < 80) {
    throw new Error(`图片直连响应非图片（mime=${out?.mime} bytes=${out.data?.length ?? 0}）`);
  }
  return `data:${out.mime};base64,${out.data}`;
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

/** 任意校内图片 URL → dataURL（fetchImageAsDataUrl 的「会话 + 包装」版）：
 *  ① 非公网 host 按 HttpClient 分流规则经 webvpnWrap 包装（座位分布图所在
 *     seat.lib 与 api.php 同域，会话建立在 wengine 服务端，直连必然匿名）；
 *  ② Cookie 取包装目标域 + 解码真实域两桶合并（HttpClient #cookieHeaderFor 同语义）；
 *  ③ 复用 Rust fetch_binary 抓字节转 dataURL。失败由调用方处理（隐藏图块）。 */
export async function fetchImageByUrl(url: string, forceWrap = false): Promise<string> {
  let target = url;
  try {
    const host = new URL(url).hostname;
    if (http.webVPNEncoder && host && (forceWrap || !CAMPUS_PUBLIC_HOSTS.has(host))) {
      target = http.webVPNEncoder(url);
    }
  } catch {
    /* 非 http URL 原样尝试 */
  }
  const seen = new Set<string>();
  const pairs: string[] = [];
  const buckets = new Set<string>([target, webvpnDecodeUrl(target) ?? "", url]);
  for (const bucket of buckets) {
    if (!bucket) continue;
    let cookies: Array<{ name: string; value: string }> = [];
    try {
      cookies = http.jar.getCookies(new URL(bucket));
    } catch {
      continue;
    }
    for (const c of cookies) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      pairs.push(`${c.name}=${c.value}`);
    }
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const out = await invoke<{ mime: string; data: string }>("fetch_binary", {
    url: target,
    cookies: pairs.join("; "),
    referer: "https://learn.tsinghua.edu.cn/f/wlxt/index.jsp",
  });
  if (!out || !/^image\//i.test(out.mime ?? "") || (out.data?.length ?? 0) < 80) {
    throw new Error(`图片包装响应非图片（mime=${out?.mime} bytes=${out.data?.length ?? 0}）`);
  }
  return `data:${out.mime};base64,${out.data}`;
}

export { isTauri };
