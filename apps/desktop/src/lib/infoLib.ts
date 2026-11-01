import { t as i18n, msg as i18nMsg } from "../i18n/index.js";
import { trustDeviceName } from "./deviceName.js";
/**
 * thu-info-lib 平台接线层（dev2 管线移植 2026-09-16）。
 *
 * 架构定案（docs/INFOLIB-PIPELINE-REVIEW.md）：WebVPN 即网络。lib 的登录链
 * （SM2 + 2FA hooks + roam-id）建立唯一 webvpn 会话；Cookie 经 tauriFetch 逐跳
 * 记账回灌共享 http.jar —— lib 与 OneTHU 自有客户端（learn/info/zhjwxk/venue）
 * 从此共用同一会话命名空间，双通道互踢在物理上不可能发生。
 *
 * 本文件职责：
 * - platformFetch 注入（tauriFetch：连接池 + 重定向逐跳 + 每跳 cookie 供应）
 *   并把每跳 Set-Cookie 回灌 http.jar（单一会话事实源）
 * - SM2 加密器注入（@onethu/core 的 encryptPassword，OneTHU 自有实现）
 * - 2FA futures：lib 的同步 hooks 桥接 OneTHU 的两段式 UI（选方式→发码→输码）
 * - 登录/验证/登出/会话守卫（libEnsureSession：lib verifyAndReLogin 语义）
 */
import { nativeFetch, nativeSeedCookies, nativeSessionEpoch, isTauri } from "./transport.js";
import { createAuthCookieBoundary } from "./authCookieBoundary.js";
import { markLoginAttempt, markLoginSucceeded, loginCooldownLeftMs } from "./loginGate.js";
import { networkLogUrl } from "./networkLog.js";
import { http, session } from "./clients.js";
import { setPlatformFetch, setPlatformClearCookies, uFetch } from "@onethu/info-lib/network";
const SAVE_FINGER_URL = "https://id.tsinghua.edu.cn/b/doubleAuth/personal/saveFinger";
import { InfoHelper, roam, verifyAndReLogin, getOutstandingLoginIdentity } from "@onethu/info-lib";
import { loadRemembered } from "./clients.js";
import { fileRead, fileWrite, fileDelete, obfuscateSecret, deobfuscateSecret } from "./clients.js";
import { withPrivacy } from "./privacy.js";
import { sm2crypto, makeFingerprint, webvpnDecodeUrl, parseCellAnchor, AuthRequiredError, type TwoFactorMethod } from "@onethu/core";

let initialized = false;

async function log(line: string): Promise<void> {
  const { logLine } = await import("./clients.js");
  await logLine(line).catch(() => undefined);
}

/** 合并种子 Cookie（HttpClient.#cookieHeaderFor 同语义）：包装 URL 须同时携带
 *  webvpn 物理域桶（wengine_vpn_ticket 等）与解码真实域桶（各应用会话）——
 *  缺 webvpn 桶时 wengine 视为未登录把请求踢回裸 /login（2026-09-16 真机实录：
 *  lib 登录链 portal 落地成功但 roam-id 被踢回登录页，症状「重定向次数超限」）。 */
function cookieSeed(url: string): string | undefined {
  let decoded: string | null = null;
  try {
    decoded = webvpnDecodeUrl(url);
  } catch {
    /* 非 webvpn 包装 URL */
  }
  const buckets = [url, decoded ?? "", "https://webvpn.tsinghua.edu.cn/"];
  const seen = new Set<string>();
  const pairs: string[] = [];
  for (const b of buckets) {
    if (!b) continue;
    try {
      for (const c of http.jar.getCookies(new URL(b))) {
        if (seen.has(c.name)) continue;
        seen.add(c.name);
        pairs.push(`${c.name}=${c.value}`);
      }
    } catch {
      /* 坏 URL 跳过 */
    }
  }
  return pairs.length ? pairs.join("; ") : undefined;
}

/** 注入平台传输（幂等） */
export function initInfoLib(): InfoHelper {
  if (!initialized) {
    setPlatformFetch(async (url, init) => {
      // 上游对齐（2026-09-17 定案）：nativeFetch = Rust 共享 reqwest client
      // （原生分域 cookie 仓 + 原生跟随重定向）——等价 RN 的 okhttp。lib 的
      // 全部请求（登录链/数据）都走它；TS 侧不再 seed/逐跳/舞步干预。
      const res = await nativeFetch(url, {
        method: init.method ?? "GET",
        body: init.body,
        headers: init.headers as Record<string, string> | undefined,
        timeoutMs: init.timeoutMs,
      });
      rememberGitlabSession(url, res);
      // Diagnostic cookie names only; never include even prefixes of session values.
      try {
        const names = (bucket: string): string => {
          try {
            return http.jar
              .getCookies(new URL(bucket))
              .map((c) => c.name)
              .join(",");
          } catch {
            return "?";
          }
        };
        void log(
          `JAR webvpn=[${names("https://webvpn.tsinghua.edu.cn/")}] info=[${names("https://info2021.tsinghua.edu.cn/")}] learn=[${names("https://learn.tsinghua.edu.cn/")}]`,
        );
      } catch {
        /* 透视失败不影响主链 */
      }
      // 每跳 Set-Cookie 回灌共享 jar（x-onethu-set-cookie-hops 由 tauriFetch 逐跳
      // 记录；jar.setFromResponse 消费同名头并按真实域分桶）——lib 会话进 jar，
      // OneTHU 客户端即刻可见；反之旧会话 cookie 也随 hopCookieProvider 供应给 lib。
      try {
        const finalUrl = res.headers.get("x-onethu-final-url") ?? res.url ?? url;
        http.jar.setFromResponse(new URL(finalUrl), res);
      } catch {
        /* 忽略畸形 URL */
      }
      // 桥（2026-09-17）：逐跳 Set-Cookie 已由 setFromResponse①按真实域入账
      // （含包装域解码），同名键直接覆盖陈旧票——Rust 原生仓为权威源。
      // lib uFetch 契约：image/pdf/octet-stream 以 base64 文本回传
      const ctype = res.headers.get("content-type") ?? "";
      let text: string;
      if (/image\/|pdf|octet-stream/.test(ctype)) {
        const buf = await res.arrayBuffer();
        let bin = "";
        const u8 = new Uint8Array(buf);
        for (let i = 0; i < u8.length; i += 0x8000) {
          bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
        }
        text = btoa(bin);
      } else {
        text = await res.text();
      }
      const finalUrl = res.headers.get("x-onethu-final-url") ?? res.url ?? url;
      void log(`ILIB ${init.method ?? "GET"} status=${res.status} url=${networkLogUrl(url)} final=${networkLogUrl(finalUrl)} chars=${text.length}`);
      return {
        status: res.status,
        headers: Array.from(res.headers.entries()),
        text,
        finalUrl,
      };
    });
    setPlatformClearCookies(() => {
      // 上游对齐（2026-09-17，thu-info-lib 原源实读）：RN 的 clearCookies() 只清
      // lib 内部的 JS cookie 表——而 RN 模式下那张表根本不参与收发（Cookie 头只在
      // Node 模式才手动设置），okhttp 原生 cookie 仓从不被清。id/oauth/webvpn 会话
      // 因此跨登录存活，oauth 回调走活会话路径每次发新鲜 code。
      // 此前 jar.clear() 全清后，回调落入「按 sig 查缓存授权」路径返回同一个已消费
      // code（真机实锤：code=21d148… 跨轮恒定，兑付 302 只回修饰 cookie 不发会话票）
      // → 永远匿名。故此处对齐上游：不清任何桶。
      void 0;
    });
    // SM2 密码加密（OneTHU 自有实现；未注入时 lib 回退明文=上游 MIT 边界原行为）
    initialized = true;
  }
  return helper;
}

/** InfoHelper 单例（userId/password/fingerGenPrint 驻留内存，供静默重登免 2FA） */
export const helper = withPrivacy(new InfoHelper(), "helper");

const cookieBoundary = createAuthCookieBoundary({
  async readOwner() {
    const { store } = await import("./clients.js");
    const saved = await store.loadSession();
    const raw = await fileRead("session", { strict: true });
    let backup: { username?: string } | null = null;
    try { if (raw) backup = JSON.parse(raw); } catch { return null; }
    const local = typeof saved?.username === "string" ? saved.username : "";
    const file = typeof backup?.username === "string" ? backup.username : "";
    // Conflicting durable snapshots cannot establish which account owns the jar.
    if (saved && backup && local !== file) return null;
    return local || file || null;
  },
  async clearCookies() {
    http.jar.clear();
    gitlabSessionValue = "";
    gitlabSessionRestored = true;
    // Native clearing also rejects old in-flight responses. Wait for that fence
    // before deleting the separate GitLab seed, including any queued old write.
    const cleared = await Promise.allSettled([
      (async () => {
        if (!isTauri) return;
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("http_native_clear_cookies");
      })(),
    ]);
    http.jar.clear();
    gitlabSessionValue = "";
    const deleted = await Promise.allSettled([
      persistGitlabSession(() => fileDelete(GITLAB_SESSION_FILE, { strict: true })),
    ]);
    // Also clear on failure: no stale TS mirror should survive a failed boundary.
    http.jar.clear();
    const failure = [...cleared, ...deleted].find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  },
  clearAccountTrust() {
    selfFinger3 = "";
    pendingTrust = false;
    setLibFinger3("");
    // Keep the installation fingerprint, remove only account-bound credentials.
    session.finger3 = "";
  },
  async recordOwner(username) {
    const { store } = await import("./clients.js");
    // This records cookie ownership, not an authenticated session: an empty jar
    // cannot resume login. It also removes the previous account's saved snapshot
    // before any request for the new account can create cookies.
    const snapshot = {
      username: username ?? "", fingerprint: session.fingerprint,
      finger3: "", cookiesJson: "{}", savedAt: Date.now(),
    };
    const stored = await Promise.allSettled([
      store.saveSession(snapshot),
      fileWrite("session", JSON.stringify(snapshot), { strict: true }),
    ]);
    if (stored.every((result) => result.status === "rejected")) {
      throw (stored[0] as PromiseRejectedResult).reason;
    }
  },
});

// Runs inside the library's single flight: manual login AND internal recovery share
// the same gate. Joining a pending chain or submitting a 2FA code never clears cookies.
helper.beforeLoginAttemptHook = async () => {
  markLoginAttempt();
  // Internal library recovery can bypass clients.login; it must use the same device identity.
  const { currentFingerprint } = await import("./clients.js");
  helper.fingerprint = await currentFingerprint();
  pendingMethods = null;
  pendingMethodsAttempt = null;
  activeMethod = null;
  resolveMethod = resolveCode = null;
  rejectMethod = rejectCode = null;
  const boundary = await cookieBoundary.prepare(helper.userId);
  void log(`AUTH-PHASE cookies-${boundary}`);
};
helper.afterLoginSuccessHook = () => {
  markLoginSucceeded();
  void log("AUTH-PHASE session-established");
};

/* ═══════════ GitLab 会话票：跨进程保活 ═══════════
 * `_gitlab_session` 是 GitLab 的会话票（无 Expires），而本机 cookie 仓是进程内内存
 * （Rust 侧 CookieStore）——应用一重启就没了。于是每次启动/每次改代码重启，GitLab 页
 * 都要重走一遍统一认证换票；而那条链在统一认证侧的老授权卡住时会一直把回调打回登录页，
 * 于是表现成「每次更新都 401」。这里把会话票按本站既有的混淆方式落盘，下次开机种回
 * 原生仓，能直接续用就不再触发换票。
 */
const GITLAB_ORIGIN = "https://git.tsinghua.edu.cn/";
const GITLAB_SESSION_FILE = "gitlab.session";
const GITLAB_SESSION_KEY = "gitlab";
let gitlabSessionValue = "";
let gitlabSessionRestored = false;
let gitlabSessionPersistence: Promise<unknown> = Promise.resolve();

/** Keep old response writes ahead of account-boundary deletion. */
function persistGitlabSession(operation: () => Promise<unknown>): Promise<unknown> {
  const pending = gitlabSessionPersistence.then(operation, operation);
  gitlabSessionPersistence = pending.catch(() => undefined);
  return pending;
}

function gitlabSessionFromRes(url: string, res: Response): string {
  try {
    const fin = new URL(res.headers.get("x-onethu-final-url") ?? res.url ?? url);
    if (fin.hostname !== "git.tsinghua.edu.cn") return "";
    // 登录页对匿名访客也发一枚 `_gitlab_session`（承载 CSRF）：漫游舞半途而废时
    // 它会顶掉真票并被写盘，下轮开机 seed 回来照样是未登录 → 又见 401。只记我们
    // 确知来自已登录侧的兑付响应（2026-10-14 丢登录态治理）。
    if (fin.pathname.startsWith("/users/sign_in")) return "";
  } catch {
    return "";
  }
  for (const line of res.headers.getSetCookie()) {
    const pair = line.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq <= 0 || pair.slice(0, eq).trim() !== "_gitlab_session") continue;
    return pair.slice(eq + 1).trim();
  }
  return "";
}

/** 每次响应顺手记一下会话票（值变了才写盘） */
function rememberGitlabSession(url: string, res: Response): void {
  const value = gitlabSessionFromRes(url, res);
  if (!value || value === gitlabSessionValue) return;
  gitlabSessionValue = value;
  void persistGitlabSession(() => fileWrite(GITLAB_SESSION_FILE, JSON.stringify({ secret: obfuscateSecret(value, GITLAB_SESSION_KEY) }))).catch(
    () => undefined,
  );
}

/** 开机第一次用到 GitLab 前种回上次的会话票（种失败/没有就照常走换票） */
export async function restoreGitlabSession(): Promise<void> {
  if (gitlabSessionRestored) return;
  gitlabSessionRestored = true;
  const epoch = await nativeSessionEpoch();
  const raw = await fileRead(GITLAB_SESSION_FILE).catch(() => null);
  if (!raw) return;
  try {
    const value = deobfuscateSecret((JSON.parse(raw) as { secret?: string }).secret ?? "", GITLAB_SESSION_KEY);
    if (!value) return;
    gitlabSessionValue = value;
    await nativeSeedCookies(GITLAB_ORIGIN, [`_gitlab_session=${value}; Path=/`], epoch);
  } catch {
    /* 坏文件视作没存过 */
  }
}

/* ═══════════════ 2FA futures：lib 同步 hooks ⇄ OneTHU 两段式 UI ═══════════════ */

const METHOD_NAMES: { [k in "wechat" | "mobile" | "totp"]: string } = {
  get wechat() { return i18n("lib.infolib.f3943a7b3681"); },
  get mobile() { return i18n("lib.infolib.f87602bd9134"); },
  get totp() { return i18n("lib.infolib.22a686a1c34c"); },
};

let methodsNotify: ((methods: TwoFactorMethod[]) => void) | null = null;
let resolveMethod: ((t: "wechat" | "mobile" | "totp") => void) | null = null;
let resolveCode: ((code: string) => void) | null = null;
let rejectMethod: ((reason: Error) => void) | null = null;
let rejectCode: ((reason: Error) => void) | null = null;
let codeReadyNotify: (() => void) | null = null;
let pendingMethods: TwoFactorMethod[] | null = null;
let pendingMethodsAttempt: number | null = null;
let activeMethod: string | null = null;
let pendingTrust = false;
/** hook 自签拿到的 finger3（lib 内置路径会丢 object——这里接住） */
let selfFinger3 = "";
export function getSelfFinger3(): string {
  return selfFinger3;
}

helper.twoFactorMethodHook = (hasWeChatBool, phone, hasTotp) => {
  const methods: TwoFactorMethod[] = [];
  if (hasWeChatBool) methods.push({ type: "wechat", name: METHOD_NAMES.wechat });
  if (phone) methods.push({ type: "mobile", name: METHOD_NAMES.mobile, detail: phone });
  if (hasTotp) methods.push({ type: "totp", name: METHOD_NAMES.totp });
  pendingMethods = methods;
  pendingMethodsAttempt = getOutstandingLoginIdentity()?.attemptId ?? null;
  void log("2FA need-methods: " + methods.map((m) => m.type).join(","));
  return new Promise((resolve, reject) => {
    rejectMethod = reject;
    methodsNotify?.(methods);
    resolveMethod = (t) => {
      resolveMethod = null;
      rejectMethod = null;
      activeMethod = t;
      resolve(t);
    };
  });
};

helper.twoFactorAuthHook = () =>
  new Promise<string>((resolve, reject) => {
    rejectCode = reject;
    resolveCode = (code) => {
      resolveCode = null;
      rejectCode = null;
      resolve(code);
    };
    codeReadyNotify?.();
    codeReadyNotify = null;
  });

helper.trustFingerprintHook = async () => pendingTrust;
helper.trustFingerprintNameHook = () => trustDeviceName(helper.fingerprint);
helper.twoFactorAuthLimitHook = async () => {
  // info app 在该钩子里提醒用户清理；我们此前只写日志 → 测试者只看到「一直校验中」
  // 却不知原因（群反馈 + MCCF 实例：清掉 6~7 条旧信任记录后立刻能进）。
  void log("2FA 受信设备数达上限（登录继续，本次未信任）");
  const { showToast } = await import("../state/toast.js");
  showToast(i18nMsg("lib.infolib.fd1c426ab1aa"), 8000, { center: true });
};

/* ═══════════════ 登录链 ═══════════════ */

interface InflightLogin {
  p: Promise<void>;
  codeReady: Promise<void>;
  settled: boolean;
  username: string;
  password: string;
}
let inflight: InflightLogin | null = null;

/** Check before changing credentials, callbacks or remembered account state. */
export function assertLoginAccount(username: string, password: string): void {
  const owner = getOutstandingLoginIdentity();
  if (owner && (owner.userId !== username || helper.password !== password)) {
    throw Object.assign(new Error("Another login is in progress."), { code: "AUTH_IN_PROGRESS" });
  }
}

/** 启动 lib 登录链（不等待完成）。methodsPromise 在进入 2FA 时 resolve。 */
function startLoginRaw(username: string, password: string): {
  p: Promise<void>;
  methodsPromise: Promise<TwoFactorMethod[]>;
} {
  assertLoginAccount(username, password);
  const joining = getOutstandingLoginIdentity();
  if (!joining) {
    pendingMethods = null;
    resolveMethod = resolveCode = null;
    rejectMethod = rejectCode = null;
  }
  // 新版 lib 已移除 fingerGenPrint 字段；受信凭据由 session.finger3 自管
  let methodsResolve!: (m: TwoFactorMethod[]) => void;
  const methodsPromise = new Promise<TwoFactorMethod[]>((res) => (methodsResolve = res));
  methodsNotify = (m) => {
    methodsNotify = null;
    methodsResolve(m);
  };
  const adoptingMethods = joining && pendingMethodsAttempt === joining.attemptId;
  if (adoptingMethods && pendingMethods) methodsNotify(pendingMethods);
  const codeReady = new Promise<void>((resolve) => {
    if (adoptingMethods && resolveCode) resolve();
    else codeReadyNotify = resolve;
  });
  const p = helper.login({ userId: username, password });
  const entry: InflightLogin = { p, codeReady, settled: false, username, password };
  inflight = entry;
  void p.then(() => { entry.settled = true; }, () => { entry.settled = true; });
  return { p, methodsPromise };
}

/** finger3 注入口（clients.ts 持久层回填；受信凭据 → 静默重登免 2FA） */
let sessionFinger3: string | null = null;
export function setLibFinger3(finger3: string): void {
  sessionFinger3 = finger3;
  // 受信凭据信任链：roam 等处免二次认证
  helper.fingerGenPrint = finger3;
}

export type LibLoginResult =
  | { state: "ready" }
  | { state: "need-2fa"; methods: TwoFactorMethod[] };

let loginBridge: { username: string; password: string; p: Promise<LibLoginResult> } | null = null;

/** Explicitly leaving 2FA abandons its hooks; an unrelated later attempt cannot resume them. */
export async function libAbandonLogin(): Promise<void> {
  const { clearOutstandingLogin } = await import("@onethu/info-lib");
  clearOutstandingLogin();
  const reason = new Error("Login cancelled.");
  rejectMethod?.(reason);
  rejectCode?.(reason);
  rejectMethod = rejectCode = null;
  resolveMethod = resolveCode = null;
  methodsNotify = null;
  codeReadyNotify = null;
  pendingMethods = null;
  pendingMethodsAttempt = null;
  activeMethod = null;
  loginBridge = null;
}

/** 登录：ready 或 need-2fa（lib 链挂起等待 futures；verify2FA 续完） */
/** 直登（无 2FA）路径的受信凭据补签：lib 只在 2FA 链里做 SAVE_FINGER，
 *  直登 ready 永远不签发 → session.finger3 恒空 → checkSingle 确认传空 →
 *  id 死结（2026-09-18 f3=0 实录）。登录成功后主动补一次 SAVE_FINGER。 */
export async function libEnsureTrustFingerprint(fingerprint: string): Promise<string> {
  try {
    // 编码必须 form-urlencoded（对齐 info-lib core.ts:134 的 uFetch 调用——
    // JSON 编码 id 不认，result 恒非 success，2026-09-18 实录补签失败）
    const res = await nativeFetch(SAVE_FINGER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ fingerprint, deviceName: await trustDeviceName(fingerprint), radioVal: "是" }).toString(),
    });
    const j = JSON.parse(await res.text()) as { result?: string; msg?: string; object?: unknown };
    void log(`SAVE_FINGER resp=${j?.result ?? "?"} ${String(j?.msg ?? "").slice(0, 60)}`);
    return j?.result === "success" && typeof j.object === "string" && j.object !== "[object Object]" ? j.object : "";
  } catch {
    return "";
  }
}

export async function libLogin(
  username: string,
  password: string,
  fingerprint: string,
): Promise<LibLoginResult> {
  assertLoginAccount(username, password);
  if (loginBridge && !inflight?.settled) {
    if (loginBridge.username === username && loginBridge.password === password) return loginBridge.p;
    throw Object.assign(new Error("Another login is in progress."), { code: "AUTH_IN_PROGRESS" });
  }
  const p = performLibLogin(username, password, fingerprint);
  loginBridge = { username, password, p };
  // Failed attempts can retry after the shared cooldown. Keep the 2FA bridge available.
  void p.catch(() => { if (loginBridge?.p === p) loginBridge = null; });
  return p;
}

async function performLibLogin(username: string, password: string, fingerprint: string): Promise<LibLoginResult> {
  helper.fingerprint = fingerprint || makeFingerprint();
  // 2FA 信任设备钩子：lib 在 2FA 链内调它决定是否 SAVE_FINGER（内置路径
  // 响应 object=finger3 被 lib 丢弃——后续从持久化快照或再度 2FA 恢复）
  (helper as unknown as { trustFingerprintHook?: () => Promise<boolean> }).trustFingerprintHook =
    async () => pendingTrust;
  (helper as unknown as { trustFingerprintNameHook?: () => Promise<string> }).trustFingerprintNameHook =
    () => trustDeviceName(helper.fingerprint);
  void log("AUTH-PHASE handshake-start");
  const { p, methodsPromise } = startLoginRaw(username, password);
  const settled = await Promise.race([
    p.then(
      () => "ready" as const,
      (e) => {
        throw e;
      },
    ),
    methodsPromise.then(() => "2fa" as const),
  ]);
  if (settled === "ready") return { state: "ready" };
  // 等 method hook 真正登记完成（methodsNotify 先于 resolveMethod）
  const methods = await methodsPromise;
  return { state: "need-2fa", methods };
}

/** Resolve the method, then wait until SEND_CODE succeeds or fails. */
export async function libSend2FA(type: string): Promise<void> {
  if (resolveMethod) {
    resolveMethod(type as "wechat" | "mobile" | "totp");
    if (inflight) await Promise.race([inflight.p, inflight.codeReady]);
    return;
  }
  if (inflight && !inflight.settled) {
    if (activeMethod !== type) {
      throw Object.assign(new Error("Changing verification method requires a new sign-in."), { code: "AUTH_2FA_METHOD" });
    }
    // Resend in the same verification session; do not replay the account/password chain.
    await Promise.race([inflight.p, inflight.codeReady]);
    const response = JSON.parse(await uFetch("https://id.tsinghua.edu.cn/b/doubleAuth/login", { action: "SEND_CODE", type }));
    if (response.result !== "success") throw new Error(String(response.msg || "Unable to send verification code."));
    return;
  }
  const username = inflight?.username ?? "";
  const password = inflight?.password ?? "";
  if (!username || !password) {
    throw Object.assign(new Error("Verification must be restarted."), { code: "AUTH_2FA_RESTART" });
  }
  // Explicitly asking for a new code can restart the chain, through the shared gate.
  const { p, methodsPromise } = startLoginRaw(username, password);
  await Promise.race([p, methodsPromise.then(() => {
    resolveMethod?.(type as "wechat" | "mobile" | "totp");
  })]);
  if (inflight) await Promise.race([p, inflight.codeReady]);
}

/** Never silently restart a dead chain and discard the code the user just entered. */
export async function libVerify2FA(type: string, code: string, trust: boolean): Promise<void> {
  if (!inflight || inflight.settled) {
    throw Object.assign(new Error("Verification must be restarted."), { code: "AUTH_2FA_RESTART" });
  }
  const entry = inflight;
  if (activeMethod && activeMethod !== type) {
    throw Object.assign(new Error("Changing verification method requires a new sign-in."), { code: "AUTH_2FA_METHOD" });
  }
  pendingTrust = trust;
  resolveMethod?.(type as "wechat" | "mobile" | "totp");
  // TOTP also needs the method/SEND_CODE round trip before its code hook is installed.
  const needsCode = await Promise.race([entry.p.then(() => false), entry.codeReady.then(() => true)]);
  if (!needsCode) return;
  resolveCode?.(code);
  await entry.p;
}

/** 登出（lib 链 + 共享 jar） */
export async function libAcceptSharedSession(username: string | null): Promise<void> {
  await libAbandonLogin();
  helper.userId = username ?? "";
  helper.password = "";
  gitlabSessionValue = "";
  gitlabSessionRestored = true;
  await persistGitlabSession(() => fileDelete(GITLAB_SESSION_FILE, { strict: true }));
  await cookieBoundary.acceptVerifiedOwner(username);
}

export async function libDiscardLocalSession(): Promise<void> {
  await libAbandonLogin();
  helper.userId = "";
  helper.password = "";
  await cookieBoundary.logout();
}

export async function libLogout(): Promise<void> {
  await libAbandonLogin();
  try {
    await helper.logout();
  } catch {
    /* 网络层失败不阻断本地登出 */
  } finally {
    helper.userId = "";
    helper.password = "";
    await cookieBoundary.logout();
  }
}

/** 会话守卫（lib verifyAndReLogin 语义，供 InfoClient renewers / auth-dance 重连）：
 *  探测门户会话；死且内存有凭据 → 完整重登（受信凭据在 → 免 2FA）。 */
/** learn 会话漫游（2026-09-17）：复用 lib 的 roam("id")——card/info 同款
 *  （表单→check→锚点→包装跟随），payload=learn 的 id 表单。此前手搓的
 * /f/login 与账密路径二全部作废。 */
export async function libRoamLearn(): Promise<boolean> {
  try {
    await roam(helper, "id", "bb5df85216504820be7bba2b0ae1535b/0");
    return true;
  } catch (e) {
    await log(`LEARN-ROAM failed ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/**
 * 把「记住密码」的凭据与持久化的受信指纹灌进 lib 的 helper。
 *
 * info app 的静默重登靠的是 `helper.userId / helper.password`（**持久化字段**），
 * 所以它任何时刻都能重登；我们此前只依赖内存里的 `inflight`——进程一重启
 * （安卓被系统杀掉是常态）就没法自愈，用户看到的就是「被踢出登录」。
 *
 * 指纹同理：`helper.fingerGenPrint` 为空时 id 会要求 2FA，静默重登必失败
 * （2026-09-18 已实锤过一次；libForceRelogin 里修了，libEnsureSession 没同步修）。
 *
 * 供漫游类数据层（GitLab）单独调用：它们的换票链要的就是这两样。
 */
export async function libHydrateCredentials(): Promise<boolean> {
  const h = helper as unknown as { userId: string; password: string; fingerGenPrint?: string };
  if (!h.userId || !h.password) {
    const remembered = await loadRemembered().catch(() => null);
    if (remembered?.username && remembered.password
        && (!session.username || session.username === remembered.username)) {
      h.userId = remembered.username;
      h.password = remembered.password;
      void log(`LIB-CRED 从「记住密码」回灌凭据（${remembered.username.slice(0, 4)}****）`);
    }
  }
  const f3 = sessionFinger3 || h.fingerGenPrint || "";
  if (f3) h.fingerGenPrint = f3;
  return Boolean(h.userId && h.password);
}

export async function libEnsureSession(): Promise<boolean> {
  // ① 对齐 info app：凭据 + 受信指纹先就位（否则重启后无从重登）
  const hasCreds = await libHydrateCredentials();
  // ② 权威探活 + 按需重登（info app 的 verifyAndReLogin 同源实现）：
  //    取用户信息比对 ryh；只有明确过期才使用 helper 上的凭据重登。
  //    比原来「webvpn 端点里有 XSRF-TOKEN 就算活」强：后者只证明网关发了票，
  //    不证明 info 域会话是本人的活会话，会「假活」→ 后续 401 → 用户被踢。
  if (hasCreds && loginCooldownLeftMs() <= 0) {
    const relogged = await verifyAndReLogin(helper); // 返回 false = 会话还活着
    if (relogged) void log("LIB-ENSURE 静默重登成功（verifyAndReLogin）");
    return true;
  }
  // 探针走原生通道（Rust 仓=权威会话，重定向透明跟完）+ 现行 info 域。
  const probe = await nativeFetch(
    "https://webvpn.tsinghua.edu.cn/wengine-vpn/cookie?method=get&host=info.tsinghua.edu.cn&scheme=https&path=/f/info/gxfw_fg/common/index",
    { method: "GET" },
  );
  if (probe.status !== 200) {
    if (probe.status === 401) return false;
    throw Object.assign(new Error(`University session probe failed (HTTP ${probe.status}).`), { status: probe.status });
  }
  const body = await probe.text();
  if (/XSRF-TOKEN=/.test(body)) {
    try {
      http.jar.setFromResponse(new URL("https://webvpn.tsinghua.edu.cn/"), probe);
    } catch {
      /* ignore */
    }
    return true;
  }
  // This read-only fallback has no verified credentials (or is cooling down).
  // It cannot promote an old in-flight attempt into a new password submission.
  return false;
}

/** 二级课表（实验课）自实现：直连拉 portal3rd + 正则解析（本地验证过）。
 *  lib 的 roaming+substring 链路曾静默空（DIAG 有页面、PARSE 无结果），
 *  黑盒绕开一次到位。按 [from,to] 日期区间返回扁平条目。 */
export const getSecondaryEntries = async (
  http: { text: (url: string) => Promise<string> },
  firstDay: string, from: string, to: string,
): Promise<Array<{ name: string; location: string; date: string; dayOfWeek: number; startTime: string; endTime: string }>> => {
  const fd = new Date((firstDay ?? "").replace(/-/g, "/"));
  if (!Number.isFinite(fd.getTime())) throw new Error(i18n("schedule.secondary.invalidSemester"));
  // core HttpClient 直连（zhjw.cic 已在 PUBLIC_DIRECT_HOSTS 白名单，与课表
  // JSONP 同会话桶）。lib 的 uFetch 未从 index 导出（mod.uFetch undefined），
  // 之前每次都在守卫处静默抛错——全程「静默空」的最终根源（2026-09-19 实锤）。
  const html = await http.text("http://zhjw.cic.tsinghua.edu.cn/portal3rd.do?m=bks_ejkbSearch");
  const lo = html.search(/function\s+setInitValue\s*\(/);
  void log(`SECONDARY-FETCH len=${html.length} setInit=${lo}`).catch(() => undefined);
  if (lo < 0) {
    if (/jsp\.timeout|登录超时|用户登陆超时|do\/off\/ui\/auth\/login|name=["']i_pass|wengine-vpn\/js/i.test(html)) {
      throw new AuthRequiredError();
    }
    throw new Error(i18n("schedule.secondary.unavailable"));
  }
  const hi = html.indexOf("}", lo);
  if (hi < 0) throw new Error(i18n("schedule.secondary.unavailable"));
  const script = html.substring(lo, hi);
  const beginList = ["08:00", "09:50", "13:30", "15:20", "17:05", "19:20"];
  const endList = ["09:35", "12:15", "15:05", "16:55", "18:40", "21:45"];
  const reg = /"<span onmouseover=\\"return overlib\('(.+?)'\);\\" onmouseout='return nd\(\);'>(.+?)<\/span>";[ \n\t\r]+?document\.getElementById\('(.+?)'\)\.innerHTML \+= strHTML\+"<br>";/g;
  const expand = (pat: string): number[] => {
    const out: number[] = [];
    for (const part of pat.split(",")) {
      const [a, b] = part.replace(/[~～–—]/g, "-").split("-");
      const s = parseInt(a ?? "", 10), e = b ? parseInt(b, 10) : s;
      for (let w = s; w <= e; w++) out.push(w);
    }
    return out.filter((w) => w > 0);
  };
  const out: Array<{ name: string; location: string; date: string; dayOfWeek: number; startTime: string; endTime: string }> = [];
  const matches = [...script.matchAll(reg)];
  if (matches.length === 0 && /overlib\s*\(|innerHTML\s*\+=/.test(script)) {
    throw new Error(i18n("schedule.secondary.unavailable"));
  }
  for (const m of matches) {
    const detail = (m[1] ?? "").replace(/\s/g, "");
    const title = m[2] ?? "";
    // 格子 id = a{session}_{day}（口径见 core parseCellAnchor / info app parseScript）。
    // 此前这里把 day/session 读反 → 二级课表（实验室课为主）整体错位并与主课表重复。
    const anchor = parseCellAnchor(m[3] ?? "");
    if (!anchor) {
      void log(`SECONDARY-ANCHOR-SKIP 无法解析格子 id=${m[3] ?? ""} 课程=${title}`).catch(() => undefined);
      continue;
    }
    const { session, day } = anchor;
    const begin = beginList[session - 1] || "08:00";
    const endT = endList[session - 1] || "09:35";
    const loc = /[(（]([^，,]+)[，,]/.exec(detail)?.[1] ?? "待定";
    // 门户语言随账号会话保留；中文 UI 也可能收到学校的 “week 4”。
    const weeks = /单周|oddweeks?|weeks?odd/i.test(detail) ? [1,3,5,7,9,11,13,15]
      : /双周|evenweeks?|weeks?even/i.test(detail) ? [2,4,6,8,10,12,14,16]
      : /全周|allweeks?|everyweek/i.test(detail) ? Array.from({length: 16}, (_, i) => i + 1)
      : /前[八8]周|first8weeks?/i.test(detail) ? [1,2,3,4,5,6,7,8]
      : /后[八8]周|last8weeks?/i.test(detail) ? [9,10,11,12,13,14,15,16]
      : (() => {
          const wm = /第([\d\-~～–—,，]+)周|weeks?([\d\-~～–—,，]+)/i.exec(detail);
          return wm ? expand((wm[1] ?? wm[2] ?? "").replace(/，/g, ",")) : [];
        })();
    // 有课程却无法识别周次时交给页面提示重试，避免把缺课结果写成完整缓存。
    if (weeks.length === 0) throw new Error(i18n("schedule.secondary.unavailable"));
    for (const w of weeks) {
      const date = new Date(fd.getTime() + ((w - 1) * 7 + day - 1) * 86400000);
      const ds = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      if (ds < from || ds > to) continue;
      out.push({ name: title, location: loc, date: ds, dayOfWeek: day, startTime: begin, endTime: endT });
    }
  }
  const names = [...new Set(out.map((o) => o.name))];
  void log(`SECONDARY-PARSE ${out.length} 条 ${names.length} 门: ${names.join(" / ").slice(0, 400)}`).catch(() => undefined);
  return out;
};

/** 强制完整重登（选课死结借用）：不走探活短路——id 会话权威单一来源，
 *  选课判死时由这里重建，选课不再自清仓互踢（2026-09-18 架构定案） */
export async function libForceRelogin(): Promise<boolean> {
  const username = inflight?.username ?? "";
  const password = inflight?.password ?? "";
  if (!username || !password) return false;
  // 受信凭据喂给 lib：helper.fingerGenPrint 是内存变量，boot 恢复/进程重启后
  // 为空 → libLogin 传空指纹 → id 要 2FA → 强制重登必撞墙（02:23 实录
  // "lib 重登失败 → 回退自清仓"）。sessionFinger3（持久层）优先喂入。
  await libHydrateCredentials(); // 凭据 + 受信指纹统一从持久层回灌
  const r = await libLogin(username, password, helper.fingerprint).catch(() => null);
  return r?.state === "ready";
}

/** 登录链是否挂起（用户正在 2FA 界面）——静默重登互斥判据 */
export function libLoginPending(): boolean {
  return getOutstandingLoginIdentity() !== null || (!!inflight && !inflight.settled);
}

/** 内存凭据访问（静默重登用） */
export function libCredentials(): { username: string; password: string } | null {
  if (!inflight?.username || !inflight?.password) return null;
  return { username: inflight.username, password: inflight.password };
}

// 模块加载即完成平台注入（幂等）：首次动态 import 本模块的任何路径
// （login/resume/探针）都自动就绪——显式调用遗漏曾致真机白屏级故障
// （2026-09-16 实录：initInfoLib 导入未调用 → platformFetch 未注入）。
initInfoLib();
