/**
 * 外部作业源状态层（雨课堂 / TUOJ 系 / Tyche / DSA OJ）。
 *
 * 存储：`onethu.exthw.v1` 只存**密文**（AES-GCM）。密钥由「随机 salt（`onethu.exthw.salt.v1`
 * 存 localStorage）+ 固定串」经 PBKDF2(SHA-256, 12 万次) 派生。
 * ⚠️ 诚实声明：这**只是本地混淆，不是真正的安全** —— 密钥与密文同在本机同一份
 * localStorage 里，能读 localStorage 的人同样能解出明文。它只防止「凭据以肉眼可读的
 * 形式躺在存储里被顺手看到 / 被同步导出」。真要保密，请用系统级凭据库（未实现）。
 *
 * 登录：设置页调用 `extHwLogin.*`（内部走 core 的登录客户端 + universalFetch），
 * 成功后把 Cookie 存进本模块，用户无需手动爬 Cookie。
 *
 * 拉取：各源并发，Promise.allSettled —— 单源失败只记该源错误，其余照常；
 * 数据走内存缓存 + 订阅（useSyncExternalStore），不落盘。
 * 未配置任何凭据时：不请求、items 为空 —— 与改动前行为完全一致（零回归）。
 *
 * R21-A：Tyche 支持「记住密码」（creds.tyche.username+password，随信封整体 AES-GCM
 * 加密，明文不落盘/不进日志）。会话失效（status=login / 401 / 跳登录页）→ core 编排层
 * 触发一次静默自动重登（频控：同源 ≥10min、每进程 ≤3 次、并发 in-flight 去重）并自动
 * 重拉；用户显式退出（EXTHW_TYCHE_LOGOUT_KEY）后绝不自动重登，手动登录解除。
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  isTuojNoCoursesError,
  refreshExternalHomework,
  runYuketangQrLogin,
  SOURCE_NAMES,
  TUOJ_CLASSIC_BASE,
  createYuketangSource,
  dsaLogin,
  tuojLogin,
  tuojRoam,
  tycheLogin,
  yuketangSendSmsCode,
  yuketangVerifyLogin,
} from "@onethu/core";
import { maskValue } from "../lib/privacy.js";
import type {
  ExtHwCreds,
  ExtHwSourceId,
  ExternalHomework,
  Homework,
  TuojSourceId,
  YkExerciseDetail,
  YktQrPhase,
  YktQrPollResult,
  YktSubmitAttachment,
  YktSubmitResult,
  YuketangSource,
} from "@onethu/core";
import { universalFetch } from "../lib/transport.js";
import { http, info, logLine, persist } from "../lib/clients.js";

export const EXTHW_KEY = "onethu.exthw.v1";
export const EXTHW_SALT_KEY = "onethu.exthw.salt.v1";
/** 引导横幅「知道了」的忽略标记（沿用 onethu.* 前缀） */
export const EXTHW_GUIDE_KEY = "onethu.exthw.guide.dismissed";
/** TUOJ 统一认证自动登录「上次尝试」存档键（失败/无账号后 24h 内不重复自动尝试）。
 *  R15 20.2：按源分键（tuoj 沿用旧键，经典版新键）。 */
export const EXTHW_TUOJ_AUTO_KEYS: Record<TuojSourceId, string> = {
  tuoj: "onethu.exthw.tuojAuto.v1",
  tuojClassic: "onethu.exthw.tuojClassicAuto.v1",
};
/** 用户显式退出 TUOJ 系的抑制标记（R12 17.2；R15 按源分键） */
export const EXTHW_TUOJ_LOGOUT_KEYS: Record<TuojSourceId, string> = {
  tuoj: "onethu.exthw.tuojLogout.v1",
  tuojClassic: "onethu.exthw.tuojClassicLogout.v1",
};
/** R21-A：用户显式退出 Tyche 的抑制标记——退出后**绝不**自动重登（手动登录可解除） */
export const EXTHW_TYCHE_LOGOUT_KEY = "onethu.exthw.tycheLogout.v1";
/** 兼容旧名（外部仅测试/诊断可能引用 AI 版键） */
export const EXTHW_TUOJ_AUTO_KEY = EXTHW_TUOJ_AUTO_KEYS.tuoj;
export const EXTHW_TUOJ_LOGOUT_KEY = EXTHW_TUOJ_LOGOUT_KEYS.tuoj;
/** 自动尝试频控窗口：24h（R11 16.2） */
export const TUOJ_AUTO_THROTTLE_MS = 24 * 60 * 60 * 1000;
/** 派生密钥的固定串（与随机 salt 一起喂 PBKDF2；公开写在源码里也无妨——salt 才是个体差异） */
const KDF_PASS = "onethu-exthw-local-obfuscation-v1";
const PBKDF2_ITER = 120_000;

/* ── 加解密（WebCrypto AES-GCM + PBKDF2） ── */

const subtle: SubtleCrypto | undefined =
  typeof crypto !== "undefined" ? (crypto.subtle as SubtleCrypto | undefined) : undefined;

function b64encode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 取（或首建）本机 salt */
function getOrCreateSalt(): Uint8Array {
  try {
    const cur = localStorage.getItem(EXTHW_SALT_KEY);
    if (cur) {
      const bytes = b64decode(cur);
      if (bytes.length >= 8) return bytes;
    }
  } catch {
    /* 忽略，重建 */
  }
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  try {
    localStorage.setItem(EXTHW_SALT_KEY, b64encode(salt));
  } catch {
    /* 存储不可用：salt 仅在本次会话内有效 */
  }
  return salt;
}

async function deriveKey(salt: Uint8Array): Promise<CryptoKey> {
  if (!subtle) throw new Error("当前环境不支持 WebCrypto");
  const base = await subtle.importKey("raw", new TextEncoder().encode(KDF_PASS), "PBKDF2", false, [
    "deriveKey",
  ]);
  return subtle.deriveKey(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: PBKDF2_ITER, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** 密文信封（存进 localStorage 的唯一形态） */
interface Envelope {
  v: 1;
  /** base64(iv)，12 字节 */
  iv: string;
  /** base64(ciphertext) */
  ct: string;
}

async function encryptCreds(c: ExtHwCreds): Promise<Envelope> {
  const key = await deriveKey(getOrCreateSalt());
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const data = new TextEncoder().encode(JSON.stringify(c));
  const ct = await subtle!.encrypt({ name: "AES-GCM", iv: iv as unknown as BufferSource }, key, data);
  return { v: 1, iv: b64encode(iv), ct: b64encode(new Uint8Array(ct)) };
}

async function decryptCreds(env: Envelope): Promise<ExtHwCreds> {
  const key = await deriveKey(getOrCreateSalt());
  const pt = await subtle!.decrypt(
    { name: "AES-GCM", iv: b64decode(env.iv) as unknown as BufferSource },
    key,
    b64decode(env.ct) as unknown as BufferSource,
  );
  const j = JSON.parse(new TextDecoder().decode(pt)) as ExtHwCreds;
  return j && typeof j === "object" ? j : {};
}

/* ── 凭据读写（localStorage，读写全 try/catch 静默降级） ── */

let creds: ExtHwCreds = {};
let loaded = false;
let loadPromise: Promise<void> | null = null;

/** 同步读内存缓存（首次解密完成前返回 {}；UI 应先 await ensureExtHwCredsLoaded） */
export function getExtHwCreds(): ExtHwCreds {
  return creds;
}

/** 首次调用时解密一次并缓存；幂等。返回当前凭据。 */
export function ensureExtHwCredsLoaded(): Promise<ExtHwCreds> {
  if (loaded) return Promise.resolve(creds);
  if (loadPromise) return loadPromise.then(() => creds);
  loadPromise = (async (): Promise<void> => {
    let next: ExtHwCreds = {};
    try {
      const raw = localStorage.getItem(EXTHW_KEY);
      if (raw) {
        const j = JSON.parse(raw) as unknown;
        if (j && typeof j === "object" && (j as Envelope).v === 1 && typeof (j as Envelope).ct === "string") {
          next = await decryptCreds(j as Envelope);
        } else if (subtle) {
          // 旧版明文（上一轮实现）：直接读入，下次保存时自动转成密文
          next = j as ExtHwCreds;
        } else {
          next = j as ExtHwCreds;
        }
      }
    } catch {
      next = {};
    }
    creds = next && typeof next === "object" ? next : {};
    loaded = true;
    loadTuojAuto();
    loadTycheReloginFlag();
    rebuild();
  })();
  return loadPromise.then(() => creds);
}

/** 加密写入；同时刷新内存缓存并通知订阅者。 */
export async function saveExtHwCreds(c: ExtHwCreds): Promise<void> {
  creds = c ?? {};
  loaded = true;
  try {
    const env = await encryptCreds(creds);
    localStorage.setItem(EXTHW_KEY, JSON.stringify(env));
  } catch {
    /* 加密/存储不可用（隐私模式/配额/无 WebCrypto）时静默：内存态仍生效 */
  }
  rebuild();
}

/** 清空凭据（内存 + 存储） */
export async function clearExtHwCreds(): Promise<void> {
  await saveExtHwCreds({});
  try {
    localStorage.removeItem(EXTHW_KEY);
  } catch {
    /* 忽略 */
  }
}

/** 是否配置了任一源（决定 UI 是否显示外部作业）；CAS 漫游模式 cookie 可为空 */
export function hasAnyExtHwCreds(c: ExtHwCreds = creds): boolean {
  return Boolean(
    c.yuketang?.cookie?.trim() ||
      c.tuoj?.cookie?.trim() ||
      c.tuoj?.via === "cas" ||
      c.tuojClassic?.cookie?.trim() ||
      c.tuojClassic?.via === "cas" ||
      c.tyche?.cookie?.trim() ||
      c.dsa?.cookie?.trim(),
  );
}

/** 是否 TUOJ 系源（tuoj / tuojClassic）——自动漫游与凭据清理按源区分 */
export function isTuojFamilyId(id: ExtHwSourceId): id is TuojSourceId {
  return id === "tuoj" || id === "tuojClassic";
}

/** 是否已「知道了」外部作业源引导横幅 */
export function isExtHwGuideDismissed(): boolean {
  try {
    return localStorage.getItem(EXTHW_GUIDE_KEY) === "1";
  } catch {
    return false;
  }
}

/** 持久忽略引导横幅 */
export function dismissExtHwGuide(): void {
  try {
    localStorage.setItem(EXTHW_GUIDE_KEY, "1");
  } catch {
    /* 存储不可用：忽略 */
  }
}

/** 引导横幅「去设置」：跨页请求设置页把 extHw 区滚动到视野（一次性标记，R11 16.3） */
let extHwScrollRequested = false;
export function requestExtHwScroll(): void {
  extHwScrollRequested = true;
}
export function consumeExtHwScrollRequest(): boolean {
  const v = extHwScrollRequested;
  extHwScrollRequested = false;
  return v;
}

/* ── 登录（走 core 登录客户端 + Tauri 传输层） ── */

export const extHwLogin = {
  yuketangSendSms: (mobile: string): Promise<void> => yuketangSendSmsCode(mobile, universalFetch),
  yuketangVerify: (mobile: string, code: string) => yuketangVerifyLogin(mobile, code, universalFetch),
  /** 雨课堂 微信/雨豆APP 扫码登录：状态机跑在 core，这里注入 Tauri 传输层。
   *  返回 Promise 在成功/取消/报错时结算；onPhase 用于 UI 刷新二维码与过期提示。 */
  yuketangQr: (opts: {
    signal?: AbortSignal;
    onPhase?: (p: YktQrPhase) => void;
    pollTimeoutMs?: number;
  }): Promise<YktQrPollResult> =>
    runYuketangQrLogin({
      fetchLike: universalFetch,
      signal: opts.signal,
      onPhase: opts.onPhase,
      pollTimeoutMs: opts.pollTimeoutMs,
    }),
  /** TUOJ 系清华统一认证漫游（零凭据）：无直连 id 会话时先按内存账密直登 id
   *  （InfoClient.ensureDirectIdLogin，凭据来自 CampusSession，零用户输入），再走
   *  漫游表单；会话活着但 CAS 返回 checkSingle 指纹确认页时经 confirmIdCheckSingle
   *  确认取票（R10 15.1-1，修「白登入」误判）。会话落在共享 HttpClient 的 jar 里，
   *  随后 persist() 快照进本机会话存档。
   *  R15 20.2：`source` 区分 AI 版 / 经典版（经典版传 `TUOJ_CLASSIC_BASE`，CAS url 仍取
   *  服务端响应）。 */
  tuojCas: async (source: TuojSourceId = "tuoj"): Promise<{ cookie: string }> => {
    const r = await tuojRoam(http, {
      base: source === "tuojClassic" ? TUOJ_CLASSIC_BASE : undefined,
      ensureIdSession: (u) => info.ensureDirectIdLogin(u),
      hasIdCredentials: () => info.hasIdCredentials(),
      confirmIdCheckSingle: (u) => info.confirmIdCheckSingle(u),
    });
    await persist().catch(() => undefined);
    return { cookie: r.cookie };
  },
  tuoj: (username: string, password: string) => tuojLogin(username, password, universalFetch),
  tuojClassic: (username: string, password: string) =>
    tuojLogin(username, password, universalFetch, TUOJ_CLASSIC_BASE),
  dsa: (email: string, password: string) => dsaLogin(email, password, universalFetch),
  tyche: (username: string, password: string) => tycheLogin(username, password, universalFetch),
};

/* ── TUOJ 系统一认证自动登录（R11 16.2；R15 20.2 按源泛化）──
 * extHw 刷新时若某 TUOJ 源未配置，静默尝试一次 CAS 漫游；任何失败都不抛出、不打扰用户。
 * 成功 → 写入该源凭据（同手动登录）；CAS 通过但课程列表 401/403 → no-courses（可能未注册/
 * 未选课，不算错误）；其余 → failed（仅设置页展示，引导手动）。失败/无账号后 24h 频控。 */

export type TuojAutoKind = "idle" | "running" | "ok" | "no-courses" | "failed";

export interface TuojAutoStatus {
  kind: TuojAutoKind;
  /** 最近一次自动尝试完成时间（ms）；kind==="running"/"idle" 时无 */
  at?: number;
  /** 失败原因（仅 kind==="failed"；设置页展示，绝不弹窗） */
  message?: string;
}

/** 每个 TUOJ 系源各一份自动登录状态（AI 版 / 经典版互不影响） */
export type TuojAutoMap = Record<TuojSourceId, TuojAutoStatus>;

const idleTuojAuto = (): TuojAutoMap => ({ tuoj: { kind: "idle" }, tuojClassic: { kind: "idle" } });

let tuojAuto: TuojAutoMap = idleTuojAuto();
/** 用户显式退出某 TUOJ 源后置位：抑制该源「未配置即自动漫游」（R12 17.2）。手动登录会解除。 */
let tuojAutoSuppressed: Record<TuojSourceId, boolean> = { tuoj: false, tuojClassic: false };

/** 从 localStorage 回灌自动登录结果（含频控时间戳）；失败静默降级为 idle */
function loadTuojAuto(): void {
  for (const source of ["tuoj", "tuojClassic"] as const) {
    try {
      tuojAutoSuppressed[source] = localStorage.getItem(EXTHW_TUOJ_LOGOUT_KEYS[source]) === "1";
    } catch {
      tuojAutoSuppressed[source] = false;
    }
    try {
      const raw = localStorage.getItem(EXTHW_TUOJ_AUTO_KEYS[source]);
      if (!raw) continue;
      const j = JSON.parse(raw) as { outcome?: string; at?: number; message?: string };
      if (
        j &&
        typeof j.at === "number" &&
        (j.outcome === "ok" || j.outcome === "no-courses" || j.outcome === "failed")
      ) {
        tuojAuto[source] = { kind: j.outcome, at: j.at, message: j.message };
      }
    } catch {
      /* 存储不可用 / 损坏：保持 idle */
    }
  }
}

/** 更新某源自动登录状态；终态落盘（running/idle 不覆盖已有频控记录）并通知订阅者 */
function setTuojAuto(source: TuojSourceId, next: TuojAutoStatus): void {
  tuojAuto[source] = next;
  if (next.kind === "ok" || next.kind === "no-courses" || next.kind === "failed") {
    try {
      localStorage.setItem(
        EXTHW_TUOJ_AUTO_KEYS[source],
        JSON.stringify({ outcome: next.kind, at: next.at, message: next.message }),
      );
    } catch {
      /* 存储不可用：内存态仍生效 */
    }
  }
  rebuild();
}

/** 手动登录成功 / 清空后复位某源自动登录状态（避免旧的「无账号/失败」提示误导）。
 *  R12 17.2：同时解除「显式退出」抑制——用户重新登录后自动漫游恢复正常。 */
export function clearTuojAutoStatus(source: TuojSourceId): void {
  tuojAuto[source] = { kind: "idle" };
  tuojAutoSuppressed[source] = false;
  try {
    localStorage.removeItem(EXTHW_TUOJ_AUTO_KEYS[source]);
    localStorage.removeItem(EXTHW_TUOJ_LOGOUT_KEYS[source]);
  } catch {
    /* 忽略 */
  }
  rebuild();
}

/** 用户显式退出某 TUOJ 源（R12 17.2）：复位自动登录状态并抑制后续自动漫游，
 *  否则「未配置 → 下次刷新自动漫游」会把刚退出的登录立刻补回来。 */
export function markTuojLoggedOut(source: TuojSourceId): void {
  clearTuojAutoStatus(source);
  tuojAutoSuppressed[source] = true;
  try {
    localStorage.setItem(EXTHW_TUOJ_LOGOUT_KEYS[source], "1");
  } catch {
    /* 存储不可用：内存态仍生效 */
  }
  rebuild();
}

/** 某 TUOJ 系源是否已配置（显式 Cookie 或 CAS 漫游标记任一即算） */
export function isTuojConfigured(source: TuojSourceId, c: ExtHwCreds = creds): boolean {
  const cr = c[source];
  return Boolean(cr?.cookie?.trim() || cr?.via === "cas");
}

/** 失败/无账号后 24h 内不再自动尝试（成功无需频控——已配置后根本不会走自动） */
function tuojAutoThrottled(source: TuojSourceId, now = Date.now()): boolean {
  const st = tuojAuto[source];
  if (st.kind !== "failed" && st.kind !== "no-courses") return false;
  return typeof st.at === "number" && now - st.at < TUOJ_AUTO_THROTTLE_MS;
}

/** 写入某 TUOJ 源的 CAS 凭据（cookie 可为空——会话在共享 jar 里） */
async function saveTuojCasCreds(source: TuojSourceId, cookie: string): Promise<void> {
  const cur = getExtHwCreds();
  const next: ExtHwCreds = source === "tuoj" ? { ...cur, tuoj: { cookie, via: "cas" } } : { ...cur, tuojClassic: { cookie, via: "cas" } };
  await saveExtHwCreds(next);
}

/** 静默自动尝试某 TUOJ 源的一次统一认证漫游；永不抛出。
 *  R12 17.1：`force=true` 绕过 `isTuojConfigured` 前置（「已配置但 cookie 失效」时使用）；
 *  频控保持（failed/no-courses 24h 内不重复，kind=ok 不受限）。
 *  R19 27.1：`relaxThrottle=true`（会话失效 401/403 触发的自动重试专用）——
 *  - 跳过 24h 频控（改由 core 的进程级频控接管：同源两次 ≥10min、每源每进程 ≤3 次），
 *    避免一次失败（退后台 / 网络抖动）把 24h 内的自动恢复全烧掉；
 *  - 尊重「显式退出」抑制：用户主动退出的源绝不自动补登录（手动「统一认证登录」可恢复）。
 *  返回 true = 漫游成功且该源凭据已覆盖保存。 */
async function maybeAutoTuojCas(
  source: TuojSourceId,
  opts: { force?: boolean; relaxThrottle?: boolean } = {},
): Promise<boolean> {
  if (!opts.force && (isTuojConfigured(source) || tuojAutoSuppressed[source])) return false;
  // R19 27.1：会话失效触发的自动重试同样不吃「显式退出」抑制（force 不再绕过它）
  if (opts.relaxThrottle && tuojAutoSuppressed[source]) return false;
  if (!opts.relaxThrottle && tuojAutoThrottled(source)) return false;
  setTuojAuto(source, { kind: "running" });
  try {
    const r = await extHwLogin.tuojCas(source);
    await saveTuojCasCreds(source, r.cookie);
    setTuojAuto(source, { kind: "ok", at: Date.now() });
    return true;
  } catch (e) {
    // 失败分支绝不弹错：只记录状态，设置页据此展示手动入口
    if (isTuojNoCoursesError(e)) {
      setTuojAuto(source, { kind: "no-courses", at: Date.now() });
    } else {
      setTuojAuto(source, {
        kind: "failed",
        at: Date.now(),
        message: e instanceof Error ? e.message : String(e),
      });
    }
    return false;
  }
}

/** R17 23.3-4：设备信任建立（重新登录 / 2FA 完成并勾选信任）后，自动重试一次
 *  此前失败的 TUOJ 漫游（复用 R12 force 语义）。仅重试处于 failed 的源——
 *  正常已配置 / 无账号（no-courses）/ 未尝试的源不打扰。永不抛出。 */
export async function retryTuojCasAfterLogin(): Promise<void> {
  // 确保 auto 状态已从 localStorage 回灌（loadTuojAuto 在首次解密时调用）
  await ensureExtHwCredsLoaded().catch(() => undefined);
  for (const source of ["tuoj", "tuojClassic"] as const) {
    if (tuojAuto[source].kind !== "failed") continue;
    // force 只绕「已配置」前置，24h 频控仍在 → 先复位失败状态（清频控）再强制重试一次
    clearTuojAutoStatus(source);
    await maybeAutoTuojCas(source, { force: true });
  }
}

/* ── R21-A：Tyche 会话失效静默自动重登（记住密码前提）──
 * 模式对齐 R19 27.1 的 TUOJ 自动重漫游：会话失效（status=login / 401 / 跳登录页，
 * core 归一为 TycheSessionError）→ 编排层（core refreshExternalHomework 的 reloginTyche
 * 钩子）触发本模块的一次静默重登 → 成功后 core 自动重拉该源一次。
 * 频控 / 去重在 core：同源两次 ≥10min、每进程 ≤3 次（tyche 独立计数）、并发失效共享
 * in-flight。这里只负责三件事：
 *  ① 尊重「显式退出」抑制（EXTHW_TYCHE_LOGOUT_KEY）——用户主动退出的绝不自动补登录；
 *  ② 只在「已记住密码」（creds.tyche.username+password 都在，勾选「记住密码」才有）时重登；
 *  ③ 全程静默 + log_debug 诊断（**绝不**打印任何凭据：密码不落日志，用户名也不打）。
 * 手动登录成功（Settings）会清除抑制标记并按勾选保存/清除记住的密码。 */

/** 显式退出抑制标记（内存态；localStorage 持久，见 loadTycheReloginFlag） */
let tycheReloginSuppressed = false;

/** 从 localStorage 回灌显式退出抑制标记（首次解密凭据时调用；失败静默降级为未抑制） */
function loadTycheReloginFlag(): void {
  try {
    tycheReloginSuppressed = localStorage.getItem(EXTHW_TYCHE_LOGOUT_KEY) === "1";
  } catch {
    tycheReloginSuppressed = false;
  }
}

/** 用户显式退出 Tyche：置抑制标记（R21-A），后续会话失效不再自动重登 */
export function markTycheLoggedOut(): void {
  tycheReloginSuppressed = true;
  try {
    localStorage.setItem(EXTHW_TYCHE_LOGOUT_KEY, "1");
  } catch {
    /* 存储不可用：内存态仍生效 */
  }
}

/** 手动登录 Tyche 成功后解除抑制标记（下次会话失效恢复自动重登资格） */
export function clearTycheLogoutSuppress(): void {
  tycheReloginSuppressed = false;
  try {
    localStorage.removeItem(EXTHW_TYCHE_LOGOUT_KEY);
  } catch {
    /* 忽略 */
  }
}

/** Tyche 是否处于「显式退出」抑制（设置页提示用；诊断） */
export function isTycheReloginSuppressed(): boolean {
  return tycheReloginSuppressed;
}

/** 是否已记住 Tyche 密码（勾选「记住密码」后 username+password 齐备；设置页提示用） */
export function isTychePasswordRemembered(c: ExtHwCreds = getExtHwCreds()): boolean {
  return Boolean(c.tyche?.username?.trim() && c.tyche?.password);
}

/**
 * Tyche 会话失效的静默自动重登（core 编排层钩子；永不抛出）。
 * 前置不满足（显式退出 / 未记住密码）→ 直接 false，core 保留原错误（不带前缀）。
 * 成功 → 新 Cookie 连同记住的账密一并覆盖保存（凭据信封整体 AES-GCM，明文不落盘）。
 * 频控 / in-flight 去重由 core 负责，这里不做二次频控（避免双重计数）。
 */
async function maybeAutoTycheRelogin(): Promise<boolean> {
  if (tycheReloginSuppressed) {
    void logLine("R21-A Tyche 会话失效：用户曾显式退出登录，跳过自动重登");
    return false;
  }
  const cred = getExtHwCreds().tyche;
  const user = cred?.username?.trim() ?? "";
  const pwd = cred?.password ?? "";
  if (!user || !pwd) {
    void logLine("R21-A Tyche 会话失效：未记住密码，跳过自动重登（可在设置页勾选「记住密码」）");
    return false;
  }
  void logLine("R21-A Tyche 会话失效：使用记住的账密静默自动重登…");
  try {
    const r = await extHwLogin.tyche(user, pwd);
    await saveExtHwCreds({ ...getExtHwCreds(), tyche: { cookie: r.cookie, username: user, password: pwd } });
    void logLine("R21-A Tyche 自动重登成功，凭据已更新并触发重拉");
    return true;
  } catch (e) {
    // 失败静默：仅诊断日志 + core 侧把「已尝试自动重新登录，仍失败：<原因>」写进 errors
    const msg = e instanceof Error ? e.message : String(e);
    void logLine(`R21-A Tyche 自动重登失败：${msg.slice(0, 200)}`);
    return false;
  }
}

/** 清除单个源的凭据（其余源保留，R12 17.2）；TUOJ 系同时复位/抑制该源自动登录状态。
 *  R21-A：退出 Tyche 同时清掉记住的密码（整个 tyche 凭据被移除）并抑制自动重登——
 *  用户显式退出后绝不静默补登录。 */
export async function removeExtHwCreds(source: ExtHwSourceId): Promise<void> {
  const cur = getExtHwCreds();
  const next: ExtHwCreds = { days: cur.days };
  if (source !== "yuketang") next.yuketang = cur.yuketang;
  if (source !== "tuoj") next.tuoj = cur.tuoj;
  if (source !== "tuojClassic") next.tuojClassic = cur.tuojClassic;
  if (source !== "tyche") next.tyche = cur.tyche;
  if (source !== "dsa") next.dsa = cur.dsa;
  await saveExtHwCreds(next);
  if (isTuojFamilyId(source)) markTuojLoggedOut(source);
  if (source === "tyche") markTycheLoggedOut();
}

/* ── R21-B：雨课堂会话保活心跳 + 健康检查 + Cookie 轮换回写 ──
 * 侦查结论（docs 三十节，2026-09-20 真连 + 前端 bundle 全量端点挖掘）：雨课堂**没有**
 * 会话续期/刷新端点，sessionid 由服务端 Django 管理，客户端无法「续命」→ 保活只能靠
 * 周期性轻量已授权请求试探/触发服务端会话续期（是否滑动能推迟过期属实验验证项）。
 * 这里实现三件事：
 * ① 6h 一次心跳：GET /api/v3/user/basic-info（最轻的已授权请求）+ 结果记入快照；
 * ② 服务端若在响应里轮换 Cookie（Set-Cookie 白名单字段）→ 合并后用 AES-GCM 信封
 *   存回凭据（侦查未见轮换证据，属兜底）；
 * ③ 健康检查结果（含失效原因）供设置页「检查会话」与失效引导（一键重登/导入）展示。
 * 全程静默 + log_debug；**绝不**打印 Cookie 内容。 */

/** 心跳周期：6h（霖反馈会话约 24h 失效——6h 足够密；实验结论待 docs 三十节回填） */
export const YKT_HEARTBEAT_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** 雨课堂会话健康状态（进快照；checkedAt=null = 从未检查过） */
export interface YktSessionState {
  /** true=有效；false=已失效；null=未知（未检查 / 网络断，不谎报） */
  alive: boolean | null;
  /** 失效原因（alive=false：http401 / http403 / errcode=401000 / unauthenticated / non-json；
   *  alive=null：network） */
  reason?: string;
  /** 会话归属人姓名（basic-info 能取到时；仅展示用） */
  userName?: string;
  /** 检查完成时间（ms） */
  checkedAt: number | null;
}

let yktSession: YktSessionState = { alive: null, checkedAt: null };
let yktHbTimer: ReturnType<typeof setInterval> | null = null;
let yktHbKickoff: ReturnType<typeof setTimeout> | null = null;
let yktHbBusy = false;

/** 服务端轮换 Cookie 的存回（onCookieRefresh 钩子）：并入现有凭据后 AES-GCM 信封整体落盘 */
async function saveYktCookieRefresh(cookie: string): Promise<void> {
  const cur = getExtHwCreds();
  const prev = cur.yuketang;
  await saveExtHwCreds({ ...cur, yuketang: { cookie, ...(prev?.uvId ? { uvId: prev.uvId } : {}), ...(prev?.phone ? { phone: prev.phone } : {}) } });
  void logLine("R21-B 雨课堂会话：服务端轮换 Cookie，已合并存回凭据（AES-GCM）");
}

/**
 * 立即做一次会话健康检查（心跳单次动作；设置页「检查会话」同款）。
 * 未配置雨课堂 → 返回 null（不动快照）。永不抛出；结果写入快照 yktSession。
 */
export async function runYktSessionCheck(): Promise<YktSessionState | null> {
  await ensureExtHwCredsLoaded().catch(() => undefined);
  const cred = getExtHwCreds().yuketang;
  if (!cred?.cookie?.trim()) return null;
  if (yktHbBusy) return null;
  yktHbBusy = true;
  try {
    const src = createYuketangSource(cred, universalFetch, getExtHwCreds().days ?? 30, {
      onCookieRefresh: (c) => {
        void saveYktCookieRefresh(c);
      },
    });
    const h = await src.checkSession();
    yktSession = { alive: h.alive, reason: h.reason, userName: h.userName, checkedAt: h.checkedAt };
    if (h.alive === true) {
      void logLine(`R21-B 雨课堂心跳：会话有效${h.userName ? `（${h.userName}）` : ""}`);
    } else if (h.alive === false) {
      void logLine(`R21-B 雨课堂心跳：会话已失效（${h.reason}），请重新登录或导入 Cookie`);
    } else {
      void logLine("R21-B 雨课堂心跳：网络异常，会话状态未知（不判失效）");
    }
    rebuild();
    return yktSession;
  } catch (e) {
    // checkSession 本身不抛（内部已归一），防御性兜底
    yktSession = { alive: null, reason: "network", checkedAt: Date.now() };
    void logLine(`R21-B 雨课堂心跳异常：${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
    rebuild();
    return yktSession;
  } finally {
    yktHbBusy = false;
  }
}

/** 启动保活心跳（幂等）：启动 15s 后先查一次（避开启动刷新高峰），此后每 6h 一次。 */
export function startYktHeartbeat(): void {
  if (yktHbTimer) return;
  if (!yktHbKickoff) {
    yktHbKickoff = setTimeout(() => {
      yktHbKickoff = null;
      void runYktSessionCheck();
    }, 15_000);
  }
  yktHbTimer = setInterval(() => {
    void runYktSessionCheck();
  }, YKT_HEARTBEAT_INTERVAL_MS);
}

/* ── 内存缓存 + 订阅 ── */

export type ExtHwState = "idle" | "loading" | "ready";

export interface ExtHwSnapshot {
  items: ExternalHomework[];
  errors: Partial<Record<ExtHwSourceId, string>>;
  state: ExtHwState;
  /** 上次刷新完成时间（ms） */
  lastAt: number;
  /** 是否配置了任一源（未配置时调用方应完全走原逻辑） */
  configured: boolean;
  /** TUOJ 系统一认证自动登录状态（R11 16.2；R15 按源分：tuoj / tuojClassic；
   *  仅自动路径维护，手动登录会复位对应源） */
  tuojAuto: TuojAutoMap;
  /** R21-B：雨课堂会话健康状态（心跳 / 手动「检查会话」维护；checkedAt=null = 未检查） */
  yktSession: YktSessionState;
}

let items: ExternalHomework[] = [];
let errors: Partial<Record<ExtHwSourceId, string>> = {};
let state: ExtHwState = "idle";
let lastAt = 0;
const listeners = new Set<() => void>();

/** useSyncExternalStore 要求 getSnapshot 引用稳定 —— 变更时才重建 */
let snapshot: ExtHwSnapshot = { items, errors, state, lastAt, configured: false, tuojAuto, yktSession };
function rebuild(): void {
  snapshot = { items, errors, state, lastAt, configured: hasAnyExtHwCreds(), tuojAuto, yktSession };
  listeners.forEach((fn) => fn());
}

export function subscribeExtHw(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getExtHwSnapshot(): ExtHwSnapshot {
  return snapshot;
}

let inflight: Promise<void> | null = null;

/** R23（霖需求）：每次打开 OneTHU 都对已配置的 TUOJ CAS 源主动续期一次——
 *  本会话首次 refreshExtHw 时 force+relaxThrottle 漫游（不等被动 401/非 JSON 才补救），
 *  尊重「显式退出」抑制；未配置的源仍走下方非 force 的首次自动登录。 */
let tuojStartupRenewed = false;

/** 各源并发拉取（allSettled）；未配置凭据则清空并直接就绪。
 *  R12 17.1 / R15 20.2：TUOJ 系任一源已配置但会话失效（401/403）→ 强制重漫游该源一次 → 自动重试。 */
export function refreshExtHw(): Promise<void> {
  if (inflight) return inflight;
  const run = (async (): Promise<void> => {
    await ensureExtHwCredsLoaded();
    // R11 16.2：TUOJ 系未配置时静默自动漫游一次（永不抛出；失败仅记状态 + 24h 频控）
    await maybeAutoTuojCas("tuoj");
    await maybeAutoTuojCas("tuojClassic");
    // R23：已配置源的本会话首次启动续期（CAS 漫游零用户输入；偶尔需 2FA 时漫游失败
    // 仅记 tuojAuto 状态，设置页展示手动入口——绝不打断正常取数）
    if (!tuojStartupRenewed) {
      tuojStartupRenewed = true;
      for (const s of ["tuoj", "tuojClassic"] as const) {
        if (isTuojConfigured(s)) await maybeAutoTuojCas(s, { force: true, relaxThrottle: true });
      }
    }
    if (!hasAnyExtHwCreds()) {
      items = [];
      errors = {};
      state = "ready";
      lastAt = Date.now();
      rebuild();
      return;
    }
    state = "loading";
    rebuild();
    // R12 17.1：401/403 → 对该源 force 重漫游 → 成功则重拉一次；失败保留原 401 错误。
    // R19 27.1：重漫游放宽 24h 频控（relaxThrottle，改吃 core 进程级频控 + in-flight 去重），
    // 尊重「显式退出」抑制；漫游与重试全程静默，失败仅落 errors / tuojAuto 状态供设置页展示。
    // R21-A：Tyche 会话失效（status=login / 401 / 跳登录页）→ 记住密码时静默自动重登一次
    // 并重拉；频控 / in-flight 去重 / 失败文案前缀都在 core，显式退出抑制在本模块。
    const next = maskValue(await refreshExternalHomework({
      getCreds: () => getExtHwCreds(),
      fetchLike: universalFetch,
      http,
      rerouteTuoj: (source) => maybeAutoTuojCas(source, { force: true, relaxThrottle: true }),
      reloginTyche: () => maybeAutoTycheRelogin(),
    }), "exthw");
    items = next.items;
    errors = next.errors;
    state = "ready";
    lastAt = Date.now();
    rebuild();
  })();
  inflight = run.finally(() => {
    inflight = null;
  });
  return inflight;
}

/** 归一化为网络学堂 Homework（id 前缀 ext:；提交状态取真实值，参与未交/已交分组） */
export function toHomework(e: ExternalHomework): Homework {
  return {
    id: "ext:" + e.id,
    courseId: "ext:" + e.source,
    title: e.title,
    content: "",
    publishTime: "",
    deadline: e.deadline,
    submitted: e.submitted,
    graded: e.graded ?? false,
    url: e.url ?? "",
    source: e.source,
    externalUrl: e.url,
    courseName: e.courseName,
    externalProgress:
      e.submittedCount !== undefined && e.totalCount !== undefined
        ? `${e.submittedCount}/${e.totalCount}`
        : undefined,
    kind: e.kind,
    audited: e.audited,
    score: e.score,
    totalScore: e.totalScore,
    // R20-B2：雨课堂原生详情页拉取参数（仅 yuketang 有；其余源恒 undefined）
    externalLeafTypeId: e.leafTypeId,
    externalClassroomId: e.classroomId,
  };
}

/** 源展示名（徽标用） */
export function extHwSourceName(id: ExtHwSourceId): string {
  return SOURCE_NAMES[id] ?? id;
}

/* ── R20-B2：雨课堂作业详情（原生详情页用；只读） ── */

/**
 * 当前雨课堂会话 Cookie（R20-B3 题干渲染用：字体下载 / 图片代理的 fetch_binary 注入）。
 * 未登录 → 空串（调用方照常渲染，资源侧自然降级）。仅作内存传递，**不落日志**。
 */
export function getYktCookie(): string {
  return getExtHwCreds().yuketang?.cookie?.trim() ?? "";
}

/**
 * 拉单份雨课堂作业详情（getExerciseDetail 的 state 层薄包装）：
 * 凭据 / 传输层在此注入（core 不碰存储），uvId 回落凭据值（createYuketangSource 内再回落 "2598"）。
 * 未配置雨课堂凭据 → 抛错（页面展示错误态 + 保留原文案），绝不静默。
 * 失败原样上抛（含 errcode / 会话失效上下文），由页面展示并 log_debug。
 */
export async function fetchYktExerciseDetail(leafTypeId: string, classroomId: string): Promise<YkExerciseDetail> {
  const creds = getExtHwCreds();
  const cred = creds.yuketang;
  if (!cred || !cred.cookie.trim()) {
    throw new Error("雨课堂未登录：请先在 设置 → 外部作业源 登录雨课堂");
  }
  const src = createYuketangSource(cred, universalFetch, creds.days ?? 30);
  return src.getExerciseDetail(leafTypeId, classroomId);
}

/** 构建带凭据/传输层的雨课堂 source（提交 / 插图上传共用）。未登录抛错。 */
function requireYktSource(): YuketangSource {
  const creds = getExtHwCreds();
  const cred = creds.yuketang;
  if (!cred || !cred.cookie.trim()) {
    throw new Error("雨课堂未登录：请先在 设置 → 外部作业源 登录雨课堂");
  }
  return createYuketangSource(cred, universalFetch, creds.days ?? 30);
}

/**
 * R20-C2 P3：主观题提交（state 层薄包装）。
 * ⛔ 学术红线（docs §32）：本函数仅供作答编辑器在**用户显式点击提交并确认**后调用；
 * 不得注册进插件宿主工具清单，不得被任何自动化路径（定时器/事件代理/AI 工具循环）触发。
 */
export async function submitYktSubjective(opts: {
  classroomId: string;
  problemId: number | string;
  contentHtml: string;
  attachments?: YktSubmitAttachment[];
}): Promise<YktSubmitResult> {
  const src = requireYktSource();
  return src.submitYktProblemSubjective({
    classroomId: opts.classroomId,
    problemId: opts.problemId,
    contentHtml: opts.contentHtml,
    ...(opts.attachments ? { attachments: opts.attachments } : {}),
  });
}

/** R20-C2 P3：正文内联插图上传（用户拖拽/粘贴/拍照/选图的图片，走官方插图通道）。 */
export async function uploadYktInlineImage(opts: {
  classroomId: string;
  fileName: string;
  mime: string;
  bytes: Uint8Array;
}): Promise<{ fileUrl: string }> {
  const src = requireYktSource();
  return src.uploadExerciseInlineImage(opts);
}

/* ── React hook ── */

export interface UseExternalHomework extends ExtHwSnapshot {
  reload: () => void;
}

export function useExternalHomework(): UseExternalHomework {
  const snap = useSyncExternalStore(subscribeExtHw, getExtHwSnapshot);
  const reload = useCallback(() => {
    void refreshExtHw();
  }, []);
  // 应用启动即拉一次（有凭据时）；state 模块级保持，只有首次 idle 才触发
  useEffect(() => {
    if (getExtHwSnapshot().state === "idle") void refreshExtHw();
    // R21-B：启动保活心跳（幂等；15s 后首查，此后每 6h 一次）
    startYktHeartbeat();
  }, []);
  return { ...snap, reload };
}
