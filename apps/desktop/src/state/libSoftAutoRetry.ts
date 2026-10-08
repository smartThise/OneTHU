/**
 * 冷却态自动重试（b31 P0 / RC1）。
 *
 * 病根：`state/data.ts` 三条加载路径撞上 `AuthRequiredError` 后，若两个恢复入口都返回
 * `skipped/cooldown`（= **恢复任务压根没执行**：20s 节流窗 / 共享单飞的占位冷却窗内，
 * 且**没有 `pending`**，没人持飞），旧口径**立刻** `setError(RELOGIN_PENDING_NOTE)` 弹警示。
 * `skipped` 不是失败——真结算可能几秒后才来，但**没有任何东西回来重跑这次加载** →
 * 警示常驻，只能手点（霖：「点了好几次重试，点完一次之后又会弹出来」）。
 *
 * 本模块只做一件事：把「冷却窗内没执行」翻译成「冷却到期后自动重试一次」——
 *  - **有限次**：同一登录代次（epoch）内最多 `LIB_SOFT_AUTO_RETRY_MAX`（3）次；
 *  - **退避**：间隔 = 冷却剩余 + 少量抖动（`LIB_SOFT_AUTO_RETRY_JITTER_MS`）；
 *  - **不叠加**：同一 epoch 内并发加载**共用同一次**自动重试（一个 `setTimeout`，
 *    到期把登记在该 epoch 的所有等待者各跑一次），已有在飞恢复链时不再叠加；
 *  - **不刷屏**：每个 epoch 最多一条 `AUTO-RECOVER` 摘要（到点时打，不在 arm 时打）；
 *  - **可清理**：epoch 变化或组件卸载时清掉定时器/等待者（`release…` / `ensureEpoch`）。
 *
 * 用完（3 次仍被冷却判掉）才由调用方落 `RELOGIN_PENDING_NOTE` 警示——
 * 且「自动重试真执行且 `failed`」时按既有三态语义诚实落登录页。
 *
 * 零依赖（只 `import type`）：护栏 `tools/relogin-test.mjs` 直接 import 纯函数与
 * 运行期闸门跑确定性断言。**不新建后台调度器**：只有「一次 cooldown 对应一个 setTimeout」。
 */

/** 同一个 epoch 内自动重试的次数上限（建议值 3：一次瞬时抖动 + 一次退避 + 一次兜底）。 */
export const LIB_SOFT_AUTO_RETRY_MAX = 3;
/** 抖动：避免与恢复链的结算同刻相撞。 */
export const LIB_SOFT_AUTO_RETRY_JITTER_MS = 250;

export interface AutoRetryPlan {
  /** 是否由本次调用安排定时器。 */
  arm: boolean;
  /** 定时器延迟（仅 `arm` 时有意义）。 */
  delayMs: number;
  /** 本次安排后本 epoch 已用掉第几次。 */
  attempt: number;
  /** 次数用尽（调用方应落警示）。 */
  exhausted: boolean;
}

/**
 * 纯函数（护栏直接断言）：给定本 epoch 的已用次数 / 是否已有定时器 / 是否有在飞恢复，
 * 决定这一次 `skipped/cooldown` 是否安排自动重试。
 * 优先级：已在飞恢复（不叠加）> 已有定时器（共用）> 次数用尽 > 安排。
 */
export function planLibSoftAutoRetry(args: {
  attempts: number;
  hasTimer: boolean;
  recoveryInFlight: boolean;
  cooldownLeftMs: number;
}): AutoRetryPlan {
  const used = Math.max(0, args.attempts);
  if (args.recoveryInFlight) return { arm: false, delayMs: 0, attempt: used, exhausted: false };
  if (args.hasTimer) return { arm: false, delayMs: 0, attempt: used, exhausted: false };
  if (used >= LIB_SOFT_AUTO_RETRY_MAX) return { arm: false, delayMs: 0, attempt: used, exhausted: true };
  const delayMs = Math.max(0, Math.floor(args.cooldownLeftMs)) + LIB_SOFT_AUTO_RETRY_JITTER_MS;
  return { arm: true, delayMs, attempt: used + 1, exhausted: false };
}

export type AutoRetryArmResult = "armed" | "shared" | "in-flight" | "exhausted";

interface EpochGate {
  epoch: number;
  attempts: number;
  timer: ReturnType<typeof setTimeout> | null;
  waiters: Set<() => void>;
  logged: boolean;
}

function freshGate(epoch: number): EpochGate {
  return { epoch, attempts: 0, timer: null, waiters: new Set(), logged: false };
}
let gate: EpochGate = freshGate(-1);

/** epoch 变化即整只换掉闸门（旧定时器清掉、旧等待者作废）——这就是「epoch 变化时清掉」。 */
function ensureEpoch(epoch: number): EpochGate {
  if (gate.epoch !== epoch) {
    if (gate.timer) clearTimeout(gate.timer);
    gate = freshGate(epoch);
  }
  return gate;
}

/** 摘要日志出口（由 `state/data.ts` 注入 `logLine`；护栏注入计数桩）。 */
let summaryLogger: ((line: string) => void) | null = null;
export function setLibSoftAutoRetryLogger(fn: ((line: string) => void) | null): void {
  summaryLogger = fn;
}

/**
 * 登记一次自动重试（页面层在 `skipped/cooldown` 分支调用）。
 * `retry` 会在冷却到期（+抖动）时被调用一次；同一 epoch 内多个调用共用同一个定时器。
 */
export function armLibSoftAutoRetry(
  epoch: number,
  cooldownLeftMs: number,
  retry: () => void,
  opts: { recoveryInFlight?: boolean } = {},
): AutoRetryArmResult {
  const g = ensureEpoch(epoch);
  const plan = planLibSoftAutoRetry({
    attempts: g.attempts,
    hasTimer: g.timer !== null,
    recoveryInFlight: Boolean(opts.recoveryInFlight),
    cooldownLeftMs,
  });
  if (plan.exhausted) return "exhausted";
  if (!plan.arm) {
    // 已有同一 epoch 的定时器 → 并发加载**共用**它（把等待者挂上，不新建定时器、不叠加）。
    if (g.timer) {
      g.waiters.add(retry);
      return "shared";
    }
    return "in-flight";
  }
  g.attempts = plan.attempt;
  g.waiters.add(retry);
  const waiters = g.waiters;
  const myEpoch = epoch;
  g.timer = setTimeout(() => {
    if (gate.epoch !== myEpoch) return; // epoch 变了：丢弃（新闸门已接管）
    gate.timer = null;
    const run = [...waiters];
    waiters.clear();
    if (!gate.logged) {
      gate.logged = true;
      summaryLogger?.(
        `AUTO-RECOVER attempt=${gate.attempts}/${LIB_SOFT_AUTO_RETRY_MAX} waiters=${run.length}`,
      );
    }
    for (const fn of run) {
      try {
        fn();
      } catch {
        /* 单个等待者失败不影响其它 */
      }
    }
  }, plan.delayMs);
  return "armed";
}

/** 组件卸载时注销自己的等待者；若本 epoch 已无等待者则把定时器与次数一并回收。 */
export function releaseLibSoftAutoRetry(epoch: number, retry: () => void): void {
  if (gate.epoch !== epoch) return;
  if (!gate.waiters.delete(retry)) return;
  if (gate.waiters.size === 0 && gate.timer) {
    clearTimeout(gate.timer);
    gate.timer = null;
    gate.attempts = Math.max(0, gate.attempts - 1);
  }
}

/** 护栏用：读数 / 复位（业务代码不得调用）。 */
export function libSoftAutoRetryState(): { epoch: number; attempts: number; hasTimer: boolean; waiters: number; logged: boolean } {
  return { epoch: gate.epoch, attempts: gate.attempts, hasTimer: gate.timer !== null, waiters: gate.waiters.size, logged: gate.logged };
}
export function resetLibSoftAutoRetryForTest(): void {
  if (gate.timer) clearTimeout(gate.timer);
  gate = freshGate(-1);
  summaryLogger = null;
}
