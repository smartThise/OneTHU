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
import { nativeFetch, nativeCookieClear, nativeCookieClearAll } from "./transport.js";
import { markLoginAttempt, loginCooldownLeftMs, consumeLoginFailedPublicKey } from "./loginGate.js";
import { http, info } from "./clients.js";
import { setPlatformFetch, setPlatformClearCookies, clearCookies } from "@onethu/info-lib/network";
const SAVE_FINGER_URL = "https://id.tsinghua.edu.cn/b/doubleAuth/personal/saveFinger";
import { InfoHelper, roam, verifyAndReLogin } from "@onethu/info-lib";
import { loadRemembered } from "./clients.js";
import { withPrivacy } from "./privacy.js";
import { sm2crypto, makeFingerprint, webvpnDecodeUrl, parseCellAnchor, infoUrls, type TwoFactorMethod } from "@onethu/core";
import {
  ensureLibSessionFlow,
  notePortalSkipReason,
  consumePortalSkipReason,
  normalizeLibSites,
  probeInfoOwnSession,
  runLibSoftSingleFlightResult,
  sitesOfLostUrl,
  type LibRebuildSite,
  type LibSoftResult,
} from "./libSessionGuard.js";

export type { LibRebuildSite } from "./libSessionGuard.js";

let initialized = false;

/** ④（b21）：显式登出的一次性标记——只有 `libLogout()` 会置它，平台清仓钩子据此
 *  在「两仓全清」与「登录前只清 id/oauth」之间分流。 */
let explicitLogoutClear = false;

/** 两个 cookie 仓一起全清（只允许显式登出路径调用；正常业务流一律走域清）。 */
async function clearBothCookieJarsFull(): Promise<void> {
  http.jar.clear();
  await nativeCookieClearAll().catch(() => undefined);
}

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
      // JAR 透视（真机联调期）：每次平台请求入账后，dump 三个关键桶的 cookie 名单
      // （含 wengine 票据前 8 位，用于识别主票/应用票/陈旧票互踩）
      try {
        const names = (bucket: string): string => {
          try {
            return http.jar
              .getCookies(new URL(bucket))
              .map((c) => `${c.name}=${c.value.slice(0, 26)}`)
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
      void log(`ILIB ${init.method ?? "GET"} ${res.status} ${url.slice(0, 90)} → ${text.slice(0, 120).replace(/\s+/g, " ")}`);
      return {
        status: res.status,
        headers: Array.from(res.headers.entries()),
        text,
        finalUrl: res.headers.get("x-onethu-final-url") ?? res.url ?? url,
      };
    });
    setPlatformClearCookies(() => {
      // F3 ④（b21）：真正实现（b16–b20 为空实现）。info-lib 的 `clearCookies()` 有**两个**
      // 调用面，必须分开对待，否则「登出清仓」与「登录前清旧票」会互相踩：
      //   - `libLogout()`（显式登出 / Settings「退出登录」）：先置 `explicitLogoutClear`，
      //     这里把**两个仓一起全清**（JS jar + 原生仓 `http_native_clear_cookies`）。
      //     此前只清 JS jar，原生仓的会话票跨登出存活——登出并不彻底。
      //   - info-lib `login()` 开头（静默重登也走这里）：**绝不全清**（全清会让
      //     learn/info 会话陪葬、各页集体红条几秒，且会把刚建立的 id 信任清掉）。
      //     只按既有 `nativeCookieClear` 的能力边界清 id/oauth —— 原生侧那一步由
      //     `libLogin()` 自己 await `nativeCookieClear()` 完成，这里只管 JS jar 同域副本。
      if (explicitLogoutClear) {
        explicitLogoutClear = false;
        void clearBothCookieJarsFull();
        return;
      }
      http.jar.clear("id.tsinghua.edu.cn");
      http.jar.clear("oauth.tsinghua.edu.cn");
    });
    // SM2 密码加密（OneTHU 自有实现；未注入时 lib 回退明文=上游 MIT 边界原行为）
    initialized = true;
  }
  return helper;
}

/** InfoHelper 单例（userId/password/fingerGenPrint 驻留内存，供静默重登免 2FA） */
export const helper = withPrivacy(new InfoHelper(), "helper");

/* ═══════════════ 2FA futures：lib 同步 hooks ⇄ OneTHU 两段式 UI ═══════════════ */

const METHOD_NAMES: { [k in "wechat" | "mobile" | "totp"]: string } = {
  wechat: "企业微信",
  mobile: "手机短信",
  totp: "TOTP 验证器",
};

let methodsNotify: ((methods: TwoFactorMethod[]) => void) | null = null;
let resolveMethod: ((t: "wechat" | "mobile" | "totp") => void) | null = null;
let resolveCode: ((code: string) => void) | null = null;
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
  void log("2FA need-methods: " + methods.map((m) => m.type).join(","));
  return new Promise((resolve) => {
    methodsNotify?.(methods);
    resolveMethod = (t) => {
      resolveMethod = null;
      resolve(t);
    };
  });
};

helper.twoFactorAuthHook = () =>
  new Promise<string>((resolve) => {
    resolveCode = (code) => {
      resolveCode = null;
      resolve(code);
    };
  });

helper.trustFingerprintHook = async () => pendingTrust;
helper.trustFingerprintNameHook = async () => "OneTHU";
helper.twoFactorAuthLimitHook = async () => {
  // info app 在该钩子里提醒用户清理；我们此前只写日志 → 测试者只看到「一直校验中」
  // 却不知原因（群反馈 + MCCF 实例：清掉 6~7 条旧信任记录后立刻能进）。
  void log("2FA 受信设备数达上限（登录继续，本次未信任）");
  const { showToast } = await import("../state/toast.js");
  showToast("受信设备数已达上限：本次登录不会记住本设备。可到 id.tsinghua.edu.cn 删除旧的「信任浏览器」后重试。");
};

/* ═══════════════ 登录链 ═══════════════ */

interface InflightLogin {
  p: Promise<void>;
  settled: boolean;
  username: string;
  password: string;
}
let inflight: InflightLogin | null = null;

/** 启动 lib 登录链（不等待完成）。methodsPromise 在进入 2FA 时 resolve。 */
function startLoginRaw(username: string, password: string): {
  p: Promise<void>;
  methodsPromise: Promise<TwoFactorMethod[]>;
} {
  // 新版 lib 已移除 fingerGenPrint 字段；受信凭据由 session.finger3 自管
  let methodsResolve!: (m: TwoFactorMethod[]) => void;
  const methodsPromise = new Promise<TwoFactorMethod[]>((res) => (methodsResolve = res));
  methodsNotify = (m) => {
    methodsNotify = null;
    methodsResolve(m);
  };
  const p = helper.login({ userId: username, password });
  const entry: InflightLogin = { p, settled: false, username, password };
  inflight = entry;
  void p.finally(() => {
    entry.settled = true;
  });
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
      body: new URLSearchParams({ fingerprint, deviceName: "OneTHU", radioVal: "是" }).toString(),
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
  markLoginAttempt();
  // 永远从干净仓开始（2026-09-17 定案）：仓里残留的匿名票（wrdvpn1-）+
  // IP 续会 = login?oauth 被拦成门户页，永远铸不出真票；清仓后服务端总是
  // 走完整 OAuth 舞（表单带 sig → check → 302 webvpn/login?code= → 铸票），
  // live16 逐跳实录验证。代价：每次 libLogin 全套重登（~2s），可接受。
  await nativeCookieClear().catch(() => undefined);
  helper.fingerprint = fingerprint || makeFingerprint();
  // 2FA 信任设备钩子：lib 在 2FA 链内调它决定是否 SAVE_FINGER（内置路径
  // 响应 object=finger3 被 lib 丢弃——后续从持久化快照或再度 2FA 恢复）
  (helper as unknown as { trustFingerprintHook?: () => Promise<boolean> }).trustFingerprintHook =
    async () => pendingTrust;
  (helper as unknown as { trustFingerprintNameHook?: () => Promise<string> }).trustFingerprintNameHook =
    async () => "OneTHU";
  // 被封锁检测：上一轮登录以「public key」失败 = 落地封锁页（2026-09-17 实录：
  // id 按会话 cookie 封设备，同 IP 无 cookie 客户端正常）→ 清原生仓换新身份
  if (consumeLoginFailedPublicKey()) {
    await nativeCookieClear().catch(() => undefined);
  }
  // 弃掉 2FA 挂起的僵尸链（lib 的 outstandingLoginPromise 单例——见 core.ts 注释）
  const { clearOutstandingLogin } = await import("@onethu/info-lib");
  clearOutstandingLogin();
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

/** 用户选定验证方式（lib 收到后自行 SEND_CODE）
 *  重发场景：lib 的两段 hooks 均为一次性——重复点击时静默忽略（UI 的验证码
 *  仍有效；过期则 verify 报错后自动重启链重走 2FA）。 */
export async function libSend2FA(type: string): Promise<void> {
  const r = resolveMethod;
  if (r) {
    r(type as "wechat" | "mobile" | "totp");
    return;
  }
  // resolver 为空 = 用户手里的 UI 挂在已死的旧链上（keepalive 的 libEnsure
  // Session 在僵尸 settle 后抢起新链）——照 libVerify2FA 的自愈：重启链并
  // 自动应答方式选择，用户这次点击直接生效（码正常发出）
  void log("2FA 方式选定但链已死 → 自动重启链并应答: " + type);
  const username = inflight?.username ?? "";
  const password = inflight?.password ?? "";
  if (!username || !password) {
    void log("2FA 重启失败：无内存凭据");
    return;
  }
  const { p, methodsPromise } = startLoginRaw(username, password);
  void methodsPromise.then(() => {
    resolveMethod?.(type as "wechat" | "mobile" | "totp");
  });
  void p.catch(() => undefined);
}

''/** 提交验证码（+是否信任设备）。lib 链在此续完：VERITY → SAVE_FINGER → 落地 → roam-id。
 *  验证码错误时 lib 单发链已死：自动用内存凭据重启链并自动应答方式选择，
 *  用户下一次提交直接可用（UI 无需返回重选）。 */
export async function libVerify2FA(type: string, code: string, trust: boolean): Promise<void> {
  if (!inflight || inflight.settled) {
    const username = inflight?.username ?? "";
    const password = inflight?.password ?? "";
    const { p, methodsPromise } = startLoginRaw(username, password);
    void methodsPromise.then(() => {
      resolveMethod?.(type as "wechat" | "mobile" | "totp");
    });
  }
  if (!inflight) throw new Error("二次认证流程已失效，请重新登录一次");
  resolveMethod?.(type as "wechat" | "mobile" | "totp");
  pendingTrust = trust;
  resolveCode?.(code);
  await inflight.p;
  // 成功：SAVE_FINGER 的受信凭据已写入 helper.fingerGenPrint（本次 trust=true 时）
}

/** 登出（lib 链 + 共享 jar + 原生仓）：两个 cookie 仓一起清（b21 ④）。
 *  经 info-lib 的 `clearCookies()` 走平台清仓钩子，保证「显式登出」这一条路径
 *  是两个仓唯一的全清入口。 */
export async function libLogout(): Promise<void> {
  try {
    await helper.logout();
  } catch {
    /* 网络层失败不阻断本地登出 */
  }
  explicitLogoutClear = true;
  clearCookies();
  // 钩子未接线时的兜底（initInfoLib 未跑）：直接全清两仓，不留悬空标记。
  if (explicitLogoutClear) {
    explicitLogoutClear = false;
    await clearBothCookieJarsFull();
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
    void e;
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
 */
async function hydrateLibCredentials(): Promise<{ hasCreds: boolean; expectedUserId: string }> {
  const h = helper as unknown as { userId: string; password: string; fingerGenPrint?: string };
  let rememberedName = "";
  if (!h.userId || !h.password) {
    const remembered = await loadRemembered().catch(() => null);
    rememberedName = remembered?.username ?? "";
    if (remembered?.username && remembered.password) {
      h.userId = remembered.username;
      h.password = remembered.password;
      void log(`LIB-CRED 从「记住密码」回灌登录信息（${remembered.username.slice(0, 4)}****）`);
    }
  }
  const f3 = sessionFinger3 || h.fingerGenPrint || "";
  if (f3) h.fingerGenPrint = f3;
  const hasCreds = Boolean(h.userId && h.password);
  if (!hasCreds) {
    // 真机取证要看清走哪支：无账密时 verifyAndReLogin 分支整个被跳过，只剩探针
    void log(
      `LIB-CRED 未命中（${h.userId ? "有身份无密码" : "无记住的登录信息"}）→ verifyAndReLogin 跳过，走 info 域本人校验探针`,
    );
  }
  return { hasCreds, expectedUserId: h.userId || rememberedName };
}

/** ② info 域本人校验探针的取数口：原生通道 + Set-Cookie 结算入 JS jar（诊断透视用）。 */
async function probeFetchText(url: string): Promise<{ status: number; body: string }> {
  const res = await nativeFetch(url, { method: "GET" });
  const body = await res.text();
  try {
    http.jar.setFromResponse(new URL(url), res);
  } catch {
    /* 忽略畸形 URL */
  }
  return { status: res.status, body };
}

/**
 * ② 判活（去假活）：与 `packages/info-lib/src/lib/core.ts` 的 `verifyAndReLogin` 同源——
 * 取 info 域用户信息比对 `object.ryh === 期望学号`。拿不到明确结论一律 fail；
 * 保留一次抖动重试（`probeInfoOwnSession`）。**不再**用「200 + body 含 XSRF-TOKEN=」
 * 判活：那只是网关发了票，不证明 info 域会话是本人的活会话。
 */
async function probeInfoAlive(expectedUserId: string): Promise<boolean> {
  if (!expectedUserId) {
    void log("LIB-ENSURE 探针拿不到期望学号 → 无明确结论，按 fail 处理");
    return false;
  }
  const alive = await probeInfoOwnSession(probeFetchText, expectedUserId);
  void log(`LIB-ENSURE 探针 info 域本人校验 ${alive ? "ok" : "fail"}（重试一次后）`);
  return alive;
}

/** info 门户判活/重登：凭据就位 → verifyAndReLogin；否则/失败 → 探针；再死 → 内存凭据完整重登。 */
async function ensureInfoPortal(): Promise<boolean> {
  notePortalSkipReason(null); // 第 48 条：每次判活先清标注，只在冷却分支置位
  // ① 对齐 info app：登录信息 + 受信指纹先就位（否则重启后无从重登）
  const { hasCreds, expectedUserId } = await hydrateLibCredentials();
  // ② 权威探活 + 按需重登（info app 的 verifyAndReLogin 同源实现）：
  //    取用户信息比对 ryh——活着且是本人 → 无需重登；否则用 helper 上的登录信息重登。
  if (hasCreds && loginCooldownLeftMs() <= 0) {
    try {
      const relogged = await verifyAndReLogin(helper); // 返回 false = 会话还活着
      if (relogged) void log("LIB-ENSURE 静默重登成功（verifyAndReLogin）");
      return true;
    } catch (e) {
      // 需要 2FA / 网络异常 → 落到下面的本人校验探针，仍活着就别误判成死
      void log(`LIB-ENSURE verifyAndReLogin 失败：${e instanceof Error ? e.message : e}`);
    }
  } else if (hasCreds) {
    void log(`LIB-ENSURE loginGate 冷却中（剩 ${Math.ceil(loginCooldownLeftMs() / 1000)}s）→ 跳过 verifyAndReLogin，走探针`);
  }
  if (await probeInfoAlive(expectedUserId)) return true;
  if (!inflight || inflight.settled) {
    if (!inflight?.username || !inflight?.password) return false;
    // 冷却期内不再自动重登（防恢复环风暴把设备拉黑）。
    // 第 48 条：这里的 false 是「**没执行**」而不是「执行后失败」——用只读标注把语义交给上层，
    // 让 libEnsureSessionResult 落成 skipped/cooldown（否则会被当 failed，触发假登出）。
    if (loginCooldownLeftMs() > 0) {
      notePortalSkipReason("cooldown");
      return false;
    }
    const r = await libLogin(inflight.username, inflight.password, helper.fingerprint).catch(() => null);
    if (r?.state === "ready") return true;
    return false; // need-2fa：静默重登撞墙，等人工
  }
  await inflight.p.catch(() => undefined);
  return true;
}

/**
 * ① 判活面扩到子服务：按站点复用**既有**重建入口（不自造登录流程）——
 * - learn  → `libRoamLearn()`（roam "id"，本文件）
 * - card   → `helper.loginCampusCard()`（info-lib `index.ts` → `cardLogin` → roam "card"）
 * - seat   → `info.forceEnsure("library")`（core `InfoClient` 既有公开重建口，seat.lib）
 * - libroom→ `helper.loginLibraryRoomBooking()`（info-lib `index.ts` → `cabLogin` → roam "cab"）
 * - zhjw   → `roam(helper, "default", infoUrls.JXRL_ROAM_ID)`（info-lib 导出 roam +
 *            core 导出常量，与 `InfoClient.#ensureZhjw` 同源；InfoClient 的
 *            `#zhjwRoamed` 一次性标记不在本层可见，重建后由下一次业务请求验证）
 * 全部经共享单飞（`ensureLibSessionFlow`）执行，绝不并发互烧票。
 */
async function rebuildLibSite(site: LibRebuildSite): Promise<boolean> {
  try {
    switch (site) {
      case "learn":
        return await libRoamLearn();
      case "card":
        await helper.loginCampusCard();
        return true;
      case "seat":
        await info.forceEnsure("library");
        return true;
      case "libroom":
        await helper.loginLibraryRoomBooking();
        return true;
      case "zhjw":
        await roam(helper, "default", infoUrls.JXRL_ROAM_ID);
        return true;
    }
  } catch (e) {
    void log(`LIB-ENSURE 子服务重建异常 site=${site}：${e instanceof Error ? e.message : e}`);
    return false;
  }
  return false;
}

/** ① 从「当前失联」的请求 URL 反推要补建的站点（webvpn 包装 URL 先解码回真实域）。 */
export function libSitesOfLostUrl(url: string | null | undefined): LibRebuildSite[] {
  const raw = String(url ?? "");
  if (!raw) return [];
  let decoded = raw;
  try {
    decoded = webvpnDecodeUrl(raw) ?? raw;
  } catch {
    /* 非包装 URL 原样匹配 */
  }
  return sitesOfLostUrl(decoded);
}

/**
 * 会话守卫（lib verifyAndReLogin 语义，供 InfoClient renewers / auth-dance 重连 /
 * learn.reloginHook / softRecover / keepalive 共用）：
 * 走**共享单飞**（⑤），info 门户 alive 后按「当前失联/需要的站点」补一次重建（①）。
 * `opts.sites` 为空 = 只判活门户（旧语义），不无差别烧票。
 *
 * 三态出口（b19 P0）：`done` / `failed` / `skipped` 逐字透传共享单飞结果。
 * **`skipped` ≠ 失败**——它是「冷却窗内 / 同键在飞，任务没执行」，调用方不许据此登出；
 * 只有 `failed`（真执行过且失败）才是失败。三态出不了门的地方用下面的旧布尔薄封装。
 */
export async function libEnsureSessionResult(
  opts: { sites?: LibRebuildSite[] } = {},
): Promise<LibSoftResult> {
  const sites = normalizeLibSites(opts.sites);
  const r = await runLibSoftSingleFlightResult("lib-session", () =>
    ensureLibSessionFlow({
      sites,
      ensurePortal: ensureInfoPortal,
      rebuildSite: rebuildLibSite,
      log: (line) => void log(line),
    }),
  );
  // 第 48 条：无条件下读一次标注（不泄漏到下一次调用）；仅当结论是 failed 且标注为冷却时改判。
  const skip = consumePortalSkipReason();
  if (r.state === "failed" && skip === "cooldown") {
    return { state: "skipped", reason: "cooldown" };
  }
  return r;
}

/** 旧布尔薄封装（b19 P0）：`state === "done"`，语义与三态之前一致。 */
export async function libEnsureSession(opts: { sites?: LibRebuildSite[] } = {}): Promise<boolean> {
  return (await libEnsureSessionResult(opts)).state === "done";
}

/** 二级课表（实验课）自实现：直连拉 portal3rd + 正则解析（本地验证过）。
 *  lib 的 roaming+substring 链路曾静默空（DIAG 有页面、PARSE 无结果），
 *  黑盒绕开一次到位。按 [from,to] 日期区间返回扁平条目。 */
export const getSecondaryEntries = async (
  http: { text: (url: string) => Promise<string> },
  firstDay: string, from: string, to: string,
): Promise<Array<{ name: string; location: string; date: string; dayOfWeek: number; startTime: string; endTime: string }>> => {
  // core HttpClient 直连（zhjw.cic 已在 PUBLIC_DIRECT_HOSTS 白名单，与课表
  // JSONP 同会话桶）。lib 的 uFetch 未从 index 导出（mod.uFetch undefined），
  // 之前每次都在守卫处静默抛错——全程「静默空」的最终根源（2026-09-19 实锤）。
  const html = await http.text("http://zhjw.cic.tsinghua.edu.cn/portal3rd.do?m=bks_ejkbSearch");
  const lo = html.indexOf("function setInitValue");
  void log(`SECONDARY-FETCH len=${html.length} setInit=${lo}`).catch(() => undefined);
  if (lo < 0) return [];
  const script = html.substring(lo, html.indexOf("}", lo));
  const beginList = ["08:00", "09:50", "13:30", "15:20", "17:05", "19:20"];
  const endList = ["09:35", "12:15", "15:05", "16:55", "18:40", "21:45"];
  const reg = /"<span onmouseover=\\"return overlib\('(.+?)'\);\\" onmouseout='return nd\(\);'>(.+?)<\/span>";[ \n\t\r]+?document\.getElementById\('(.+?)'\)\.innerHTML \+= strHTML\+"<br>";/g;
  const fd = new Date((firstDay ?? "").replace(/-/g, "/"));
  const expand = (pat: string): number[] => {
    const out: number[] = [];
    for (const part of pat.split(",")) {
      const [a, b] = part.split("-");
      const s = parseInt(a ?? "", 10), e = b ? parseInt(b, 10) : s;
      for (let w = s; w <= e; w++) out.push(w);
    }
    return out.filter((w) => w > 0);
  };
  const out: Array<{ name: string; location: string; date: string; dayOfWeek: number; startTime: string; endTime: string }> = [];
  for (const m of script.matchAll(reg)) {
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
    const weeks = /单周/.test(detail) ? [1,3,5,7,9,11,13,15]
      : /双周/.test(detail) ? [2,4,6,8,10,12,14,16]
      : /全周/.test(detail) ? Array.from({length: 16}, (_, i) => i + 1)
      : (() => { const wm = /第([\d\-~,]+)周/.exec(detail); return wm ? expand(wm[1] ?? "") : []; })();
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
  await hydrateLibCredentials(); // 凭据 + 受信指纹统一从持久层回灌
  const r = await libLogin(username, password, helper.fingerprint).catch(() => null);
  return r?.state === "ready";
}

/** 登录链是否挂起（用户正在 2FA 界面）——静默重登互斥判据 */
export function libLoginPending(): boolean {
  return !!inflight && !inflight.settled;
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
