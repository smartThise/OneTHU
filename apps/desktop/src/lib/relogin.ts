/**
 * F3 静默重登——**收窄后的最小层**（本轮只做「撤掉重复实现」，语义待诊断结论）。
 *
 * 口径修正（2026-10-02，b16）：b15 真机取证推翻了本模块原先「在 `lib/transport.ts` 的
 * `universalFetch` 上做全局拦截 + URL→站点映射」的选点——那条 JS 链路在真机的待办/新闻/
 * 课程通知/成绩/体测/考试/刷新全流程里**一次都没被触发**，而 logcat 里 core 侧的
 * `LIB-ENSURE 静默重登成功（verifyAndReLogin）` / `SOFT-RELOGIN ok streak=0` 照常在跑。
 * 既有静默重登全在 JS 侧（`lib/clients.ts:libSoftRelogin()` 与
 * `lib/infoLib.ts:libEnsureSession()`），本模块原来那套是**重复实现**，已按霖的口径撤除。
 *
 * 本模块现在只有五件东西，且**不接任何真实链路**（开关只记录用户偏好）：
 * 1. 开关读写（`AUTO_RELOGIN_KEY`，默认关：键不存在即关）；
 * 2. 调度器 `runRelogin()`：每来源单飞 + 最短 30s 间隔 + 连续失败按 2 的幂退避、封顶 10 分钟；
 * 3. 「凭据不进日志」的日志出口；
 * 4. `clearAllReloginCredentials()`（复用既有 AES-GCM 信封的清除入口）；
 * 5. dev 一次性取证钩子（唯一调用点在 `components/DevPanel.tsx`，DevPanel 是
 *    `__ONETHU_DEV__` 静态折叠的，正式版无调用方）。
 *
 * 已删除（不要回退到错口径）：`siteOfUrl` / `withAutoRelogin` / `registerRelogin` /
 * `registerCredentialClearer` / `hasReloginHandler` / `reloginSites`，以及
 * `state/reloginSites.ts` 与 `main.tsx` 的启动接线。护栏 `tools/relogin-test.mjs`
 * 对此加了防回退断言。
 *
 * 本模块不静态依赖任何业务模块（清除入口用动态 import），所以护栏能用
 * `node --experimental-strip-types` 直接 import 它跑行为自检。
 */

/** 每来源两次重登尝试的最短间隔（防抖） */
export const RELOGIN_MIN_INTERVAL_MS = 30_000;
/** 连续失败的退避封顶 */
export const RELOGIN_BACKOFF_MAX_MS = 10 * 60_000;
/** 「自动重登」开关的持久化键（默认关：键不存在即关） */
export const AUTO_RELOGIN_KEY = "onethu.relogin.auto.v1";

interface SiteState {
  /** 单飞：进行中的那次重登 */
  inflight: Promise<boolean> | null;
  /** 上次尝试开始时间（限流用） */
  lastAttempt: number;
  /** 连续失败次数（退避用） */
  failures: number;
}

const states = new Map<string, SiteState>();
/** 日志出口（默认进 console；测试与 dev 面板可替换） */
let logSink: (line: string) => void = (line) => console.info(line);

function stateOf(site: string): SiteState {
  let s = states.get(site);
  if (!s) {
    s = { inflight: null, lastAttempt: 0, failures: 0 };
    states.set(site, s);
  }
  return s;
}

/**
 * 日志脱敏：只用于**动态文本**（第三方错误信息等）。本模块自己的结构化消息是写死的
 * 常量、不含任何凭据；而别人抛上来的错误可能把账密/票据写进 message，进日志前必须过这一道。
 * 规则：邮箱、敏感词赋值、裸敏感词、长随机串一律隐去，只留 160 字。
 */
function safeDetail(text: string): string {
  const SECRET =
    "password|passwd|pwd|secret|cookie|cookies|token|username|session|sessionid|jsessionid|ticket|csrf|xsrf";
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<已隐去>")
    .replace(new RegExp(`\\b(${SECRET})\\b\\s*[=:]\\s*\\S+`, "gi"), "<已隐去>")
    .replace(new RegExp(`\\b(${SECRET})\\b`, "gi"), "<已隐去>")
    .replace(/(密码|口令|账号|用户名|凭据)\s*[=:：]?\s*\S+/g, "<已隐去>")
    .replace(/\b[A-Za-z0-9+/=_-]{24,}\b/g, "<已隐去>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/** 只记来源与结果——**永不**记录账号/密码/Cookie/票据 */
export function reloginLog(site: string, msg: string): void {
  logSink(`[relogin] ${site} ${msg}`);
}

export function setReloginLogSink(fn: (line: string) => void): void {
  logSink = fn;
}

/** 开关：默认关（键不存在 = 关）。本轮它**只记录用户偏好**，不改变任何既有链路行为。 */
export function isAutoReloginOn(): boolean {
  try {
    return localStorage.getItem(AUTO_RELOGIN_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAutoRelogin(on: boolean): void {
  try {
    if (on) localStorage.setItem(AUTO_RELOGIN_KEY, "1");
    else localStorage.removeItem(AUTO_RELOGIN_KEY);
  } catch {
    /* 隐私模式下写不了 → 视为关，不抛 */
  }
  reloginLog("app", on ? "自动重登已开启" : "自动重登已关闭");
}

/* ── dev 一次性取证钩子 ──
 * 只保留「一次性标记 + UI」，**本轮不挂到任何真实链路**：挂点等诊断结论出来再定
 * （b15 的教训是挂在 `universalFetch` 上根本收不到请求）。正式版没有任何调用方
 * ——唯一调用点在 `components/DevPanel.tsx`，而 DevPanel 是 `__ONETHU_DEV__` 静态折叠的。 */
let devSelfHealFailureArmed = false;

export function armDevSelfHealFailure(): void {
  devSelfHealFailureArmed = true;
}

export function isDevSelfHealFailureArmed(): boolean {
  return devSelfHealFailureArmed;
}

/** 消费一次：true = 把这一次「登录状态自动恢复」当成失败（标记随即清空，只影响一次） */
export function consumeDevSelfHealFailureOnce(): boolean {
  if (!devSelfHealFailureArmed) return false;
  devSelfHealFailureArmed = false;
  return true;
}

/** 该来源此刻的退避间隔：基础间隔 × 2^失败次数，封顶 */
export function reloginCooldownMs(site: string): number {
  const { failures } = stateOf(site);
  if (failures <= 0) return RELOGIN_MIN_INTERVAL_MS;
  return Math.min(RELOGIN_MIN_INTERVAL_MS * 2 ** failures, RELOGIN_BACKOFF_MAX_MS);
}

/**
 * 调度器：触发一次（或复用进行中的）重登。
 * - 开关关 → false（不做事、不写日志）
 * - 单飞：同来源并发只跑一个 attempt，其余 await 同一个 Promise
 * - 限流/退避：距上次尝试不足冷却时间 → false（并记一条日志）
 * 本轮**没有调用方**（原调用方 `transport.ts` / `reloginSites.ts` 已撤）。
 */
export async function runRelogin(
  site: string,
  attempt: () => Promise<boolean>,
  now: number = Date.now(),
): Promise<boolean> {
  if (!isAutoReloginOn()) return false;
  const st = stateOf(site);
  if (st.inflight) {
    reloginLog(site, "已有一次重登在飞，复用（单飞）");
    return st.inflight;
  }
  const cooldown = reloginCooldownMs(site);
  if (st.lastAttempt && now - st.lastAttempt < cooldown) {
    reloginLog(
      site,
      `冷却中（距上次 ${Math.round((now - st.lastAttempt) / 1000)}s < ${Math.round(cooldown / 1000)}s），跳过`,
    );
    return false;
  }
  st.lastAttempt = now;
  st.inflight = (async () => {
    const t0 = Date.now();
    try {
      const ok = await attempt();
      if (ok) {
        st.failures = 0;
        reloginLog(site, `重登成功（${Date.now() - t0}ms）`);
      } else {
        st.failures += 1;
        reloginLog(site, `重登失败（${Date.now() - t0}ms），退避 ${Math.round(reloginCooldownMs(site) / 1000)}s`);
      }
      return ok;
    } catch (e) {
      st.failures += 1;
      reloginLog(
        site,
        `重登抛错（${Date.now() - t0}ms）：${safeDetail(e instanceof Error ? e.message : String(e))}`,
      );
      return false;
    } finally {
      st.inflight = null;
    }
  })();
  return st.inflight;
}

/** 清除本机保存的登录信息（设置页入口）。日志只记来源数量。 */
export async function clearAllReloginCredentials(): Promise<number> {
  let n = 0;
  try {
    const { clearExtHwCreds } = await import("../state/exthw.js");
    await clearExtHwCreds();
    n += 1;
  } catch (e) {
    reloginLog("exthw", `清除登录信息失败：${safeDetail(e instanceof Error ? e.message : String(e))}`);
  }
  for (const st of states.values()) {
    st.failures = 0;
    st.lastAttempt = 0;
  }
  reloginLog("app", `已清除 ${n} 处本机保存的登录信息`);
  return n;
}

/** 仅测试用：清空模块状态（护栏的行为自检） */
export function resetReloginStateForTest(): void {
  states.clear();
  devSelfHealFailureArmed = false;
}
