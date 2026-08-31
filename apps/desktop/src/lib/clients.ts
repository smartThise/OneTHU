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
  type CredentialStore,
  type SessionData,
  type TwoFactorMethod,
} from "@onethu/core";
import { universalFetch, isTauri, setHopCookieProvider, setHopLogger } from "./transport.js";
import { setWebvpnLog, setZhjwxkDebug } from "@onethu/core";

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

async function fileRead(name: string): Promise<string | null> {
  if (!isTauri) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string | null>("state_read", { name });
  } catch {
    return null;
  }
}

async function fileWrite(name: string, content: string): Promise<void> {
  if (!isTauri) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("state_write", { name, content });
  } catch {
    /* 文件存储尽力而为：失败不阻塞主流程 */
  }
}

async function fileDelete(name: string): Promise<void> {
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
function obfuscateSecret(password: string, username: string): string {
  const bytes = new TextEncoder().encode(password);
  const key = new TextEncoder().encode(`OneTHU|${username}|remember`);
  return SECRET_MAGIC + btoa(bytesToBinaryString(xorBytes(bytes, key)));
}

function deobfuscateSecret(stored: string, username: string): string {
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

export const http = new HttpClient({ fetch: universalFetch }).withWebVPN(false);
http.webVPNEncoder = webvpnWrap;
http.debug = (line) => void logLine(line);
// 重定向链逐跳日志：定位教务漫游链在哪一跳断掉（CAS 票据流/登录页）
setHopLogger((hopUrl, status) => void logLine(`[HOP] ${status} ${hopUrl.slice(0, 220)}`));
setZhjwxkDebug((line) => void logLine(line));
setWebvpnLog((line) => void logLine(line));

// 逐跳 cookie 供应：包装 URL 解码出真实域（wrapped id 跳带 id 桶会话、wrapped zhjw
// 跳带 zhjw 桶会话）；直连跳取自身域。教务漫游链的 CAS 中间跳靠它才不断链。
setHopCookieProvider((hopUrl) => {
  try {
    const origin = webvpnDecodeUrl(hopUrl) ?? hopUrl;
    const cookies = http.jar.getCookies(new URL(origin));
    if (!cookies.length) return null;
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  } catch {
    return null;
  }
});

export const learn = new LearnClient(http);
export const info = new InfoClient(http);

export const session = new CampusSession({
  http,
  learn,
  info,
  fetchLike: universalFetch,
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

async function dumpDebug(err: unknown): Promise<void> {
  if (err instanceof Error && isTauri) {
    const debug = (err as Error & { debug?: string }).debug;
    await logLine("ERR " + err.message + (debug ? "\n" + debug : ""));
  }
}

/** UI 只管喂账密；2FA 状态机在 session 上继续走。
 *  opts.remember（默认 true）：成功后把密码混淆存本机，boot 恢复失败时静默重登。 */
export async function login(
  username: string,
  password: string,
  opts: { remember?: boolean } = {},
): Promise<{ state: "ready" } | { state: "need-2fa"; methods: TwoFactorMethod[]; debugHtml: string }> {
  const fingerprint = await currentFingerprint();
  session.fingerprint = fingerprint;
  session.finger3 = await loadFinger3();

  const remember = opts.remember ?? true;
  pendingSecret = { username, password, remember };
  if (!remember) await clearRemembered().catch(() => undefined);

  const savedMode = globalThis.localStorage?.getItem(TRANSPORT_KEY) ?? "direct";
  try {
    const result = await attempt(username, password, savedMode === "webvpn");
    if (result.state === "ready") {
      await persist();
      await logLine("LOGIN-OK\n" + session.debugLog.join("\n"));
    }
    return result;
  } catch (err) {
    // 直连不可达（不在校园网/校内VPN）→ 自动改走 WebVPN 重试一次；用户无感
    if (savedMode !== "webvpn" && isNetworkError(err)) {
      http.jar.clear();
      const result = await attempt(username, password, true);
      globalThis.localStorage?.setItem(TRANSPORT_KEY, "webvpn");
      if (result.state === "ready") await persist();
      return result;
    }
    if (err instanceof Error) await dumpDebug(err);
    await logLine("LOGIN-ERR\n" + session.debugLog.join("\n"));
    throw err;
  }
}

const TRANSPORT_KEY = "onethu.transport";

function isNetworkError(err: unknown): boolean {
  return err instanceof Error && /网络错误|timeout|timed? ?out|error sending request|connect/i.test(err.message);
}

async function attempt(
  username: string,
  password: string,
  viaWebVPN: boolean,
): Promise<{ state: "ready" } | { state: "need-2fa"; methods: TwoFactorMethod[]; debugHtml: string }> {
  http.withWebVPN(viaWebVPN);
  return session.login(username, password);
}

export async function send2FA(type: string): Promise<void> {
  try {
    await session.send2FA(type);
    await logLine("SEND-OK " + type + "\n" + session.debugLog.join("\n"));
  } catch (err) {
    await dumpDebug(err);
    await logLine("SEND-ERR " + type + "\n" + session.debugLog.join("\n"));
    throw err;
  }
}

export async function sendLearn2FA(type: string): Promise<void> {
  try {
    await session.sendLearn2FA(type);
    await logLine("LEARN-SEND-OK " + type + "\n" + session.debugLog.join("\n"));
  } catch (err) {
    await dumpDebug(err);
    await logLine("LEARN-SEND-ERR " + type + "\n" + session.debugLog.join("\n"));
    throw err;
  }
}

export async function verifyLearn2FA(code: string): Promise<void> {
  try {
    await session.verifyLearn2FA(code);
    await persist();
    await logLine("LEARN2FA-OK\n" + session.debugLog.join("\n"));
  } catch (err) {
    await dumpDebug(err);
    await logLine("LEARN2FA-ERR\n" + session.debugLog.join("\n"));
    throw err;
  }
}

export async function verify2FA(_type: string, code: string, trust: boolean): Promise<TwoFactorMethod[] | null> {
  try {
    const round2 = await session.verify2FA(code, trust);
    if (!round2) await persist();
    await logLine("VERIFY-OK round2=" + (round2 ? "yes" : "no") + "\n" + session.debugLog.join("\n"));
    return round2;
  } catch (err) {
    // 即使 learn 建立失败也持久化：finger3（受信凭据）必须保住，下次登录免 2FA
    await persist().catch(() => undefined);
    await dumpDebug(err);
    await logLine("VERIFY-ERR\n" + session.debugLog.join("\n"));
    throw err;
  }
}

async function persist(): Promise<void> {
  const snapshot: SessionData = {
    username: session.username,
    fingerprint: session.fingerprint,
    cookiesJson: http.jar.serialize(),
    demoCookies: session.demoSnapshot,
    idJsid: session.idJsidSnapshot,
    infoCookies: session.infoEraSnapshot,
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

async function loadFinger3(): Promise<string> {
  const saved = await store.loadSession();
  return saved?.finger3 ?? "";
}

export async function resumeSession(): Promise<boolean> {
  let saved = await store.loadSession();
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
  if (!saved) {
    await logLine("RESUME no-saved-session");
    return false;
  }
  http.withWebVPN(globalThis.localStorage?.getItem(TRANSPORT_KEY) === "webvpn");
  http.jar.hydrate(saved.cookiesJson);
  session.username = saved.username;
  session.fingerprint = saved.fingerprint;
  session.finger3 = saved.finger3 ?? "";
  session.restoreDemo(saved.demoCookies ?? "", saved.idJsid ?? "");
  session.restoreInfoCookies(saved.infoCookies ?? "");
  // 记住的密码（仅内存）：cookie 会话过期时 renewInfo/dorm-library 直登才有凭据可用
  const remembered = await loadRemembered();
  if (remembered) session.injectCredentials(remembered.username, remembered.password);
  session.reseed();
  let okLearn = await learn.resume().catch((e) => {
    logLine("RESUME learn-error " + String(e)).catch(() => undefined);
    return false;
  });
  if (!okLearn) {
    // learn 漫游会话约 8 分钟过期是常态：用持久化的 id CAS 主会话重新发票→漫游（免密）
    await logLine("RESUME learn 直连失效 → 尝试 id 主会话重漫游").catch(() => undefined);
    okLearn = await session.relearnRoam();
    if (okLearn) {
      await persist(); // 重漫游刷新了 demo 字符串（新 learn 会话），回写供下次 resume
    }
  }
  if (!okLearn) {
    await logLine("RESUME fail (learn.csrf 不可用，重漫游也未成)" + "\n" + session.debugLog.join("\n"));
    return false;
  }
  session.state = "ready";
  await info.resume().catch(() => false);
  await logLine("RESUME ok\n" + session.debugLog.join("\n"));
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
export async function trySilentRelogin(): Promise<boolean> {
  if (!(await hasLiveSnapshot())) return false;
  const remembered = await loadRemembered();
  if (!remembered) {
    await logLine("SILENT-RELOGIN skip: 无记住的密码").catch(() => undefined);
    return false;
  }
  try {
    const result = await login(remembered.username, remembered.password, { remember: true });
    if (result.state === "ready") {
      await logLine("SILENT-RELOGIN ok").catch(() => undefined);
      return true;
    }
    await logLine("SILENT-RELOGIN need-2fa").catch(() => undefined);
    return false;
  } catch (err) {
    await logLine("SILENT-RELOGIN fail " + String(err)).catch(() => undefined);
    return false;
  }
}

export async function logout(): Promise<void> {
  // 体育系统 token 与会话解耦但跟随登出清空（防串账号）
  const { venueLogout } = await import("./venue.js");
  venueLogout();
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
    if (u.hostname !== "learn.tsinghua.edu.cn" && !u.hostname.endsWith(".learn.tsinghua.edu.cn")) return url;
    const token = learn.csrfToken;
    if (!token || u.searchParams.has("_csrf")) return url;
    u.searchParams.set("_csrf", token);
    return u.toString();
  } catch {
    return url;
  }
}

/** learn 文件下载：带会话 Cookie 直连取字节，落盘 ~/Downloads */
export async function downloadLearnFile(fileId: string, filename: string): Promise<string> {
  const { LEARN_FILE_DOWNLOAD } = await import("@onethu/core");
  return downloadLearnUrl(LEARN_FILE_DOWNLOAD(fileId), filename);
}

/** 任意 learn 资源下载（作业/通知附件端点与课件不同，由 core 解析出完整 downloadUrl）。
 *  落盘名以前端传入的 filename 为准；Rust 侧会用响应 Content-Disposition 的真名兜底。 */
export async function downloadLearnUrl(url: string, filename: string): Promise<string> {
  const target = withLearnCsrf(url);
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
  const target = withLearnCsrf(url);
  const jarCookies = http.jar
    .getCookies(new URL(target))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const { invoke } = await import("@tauri-apps/api/core");
  const out = await invoke<{ mime: string; data: string }>("fetch_binary", { url: target, cookies: jarCookies });
  return `data:${out.mime};base64,${out.data}`;
}

/** 校内 host 分流（HttpClient.request 同名单）：公网站点直连，其余（seat.lib 等
 *  校内网关域名）校外不可达，恒经 WebVPN 包装——与图书馆 api.php 请求同轨。 */
const CAMPUS_PUBLIC_HOSTS = new Set([
  "learn.tsinghua.edu.cn",
  "webvpn.tsinghua.edu.cn",
  "id.tsinghua.edu.cn",
  "oauth.tsinghua.edu.cn",
  "info.tsinghua.edu.cn",
  "card.tsinghua.edu.cn",
]);

/** 任意校内图片 URL → dataURL（fetchImageAsDataUrl 的「会话 + 包装」版）：
 *  ① 非公网 host 按 HttpClient 分流规则经 webvpnWrap 包装（座位分布图所在
 *     seat.lib 与 api.php 同域，会话建立在 wengine 服务端，直连必然匿名）；
 *  ② Cookie 取包装目标域 + 解码真实域两桶合并（HttpClient #cookieHeaderFor 同语义）；
 *  ③ 复用 Rust fetch_binary 抓字节转 dataURL。失败由调用方处理（隐藏图块）。 */
export async function fetchImageByUrl(url: string): Promise<string> {
  let target = url;
  try {
    const host = new URL(url).hostname;
    if (http.webVPNEncoder && host && !CAMPUS_PUBLIC_HOSTS.has(host)) {
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
  });
  return `data:${out.mime};base64,${out.data}`;
}

export { isTauri };
