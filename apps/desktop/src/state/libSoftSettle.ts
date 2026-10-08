/**
 * 判据 C（b20）：`skipped` 不许遮蔽真结算 —— 页面层在**守卫之外**等外层在飞链的真结果。
 *
 * 现场机制（b19 真机）：真死会话时，持飞的是运输层 `nativeFetch` 恢复钩子那条链
 * （`lib/clients.ts` 的 `libSoftRelogin` → `libEnsureSessionResult` →
 * `runLibSoftSingleFlightResult("lib-session")`）。页面层同一时刻再问守卫时，
 * `libSoftDepth > 0`（全局有链在跑）→ 拿到 `skipped/reentrant` **且带 `pending`**
 * （= 那条在飞链的结果句柄）。b19 之前页面层把这个 `skipped` 直接当「恢复没成功」，
 * 于是真结算 `failed`（本机常撞 id 限流 `Failed to get public key.`）永远浮不出来：
 * UI 既不登出、也不自愈，只能停在带错误条的页面。
 *
 * 本模块只做一件事：把 `skipped/reentrant + pending` 换成 `await pending` 的**真结算**
 * （`failed` → 调用方走既有 `backToLogin()`；`done` → 调用方重试一次加载）。
 *
 * 严守的边界：
 * - `await` **只允许出现在守卫之外**，也就是本函数（守卫是 `lib/libSessionGuard.ts`
 *   的 `runLibSoftSingleFlightResult`；在那里 await 自己的 `pending` 就是等自己 → 自锁）；
 *   「守卫之外」是**调用栈**意义上的：b22 真机窗口一实录了反例 —— `nativeFetch` 恢复钩子
 *   由「某一次请求」的失败触发，而恢复链自身的请求也走同一个 `nativeFetch`，链内请求命中
 *   登录页时钩子拿到的 `pending` 正是**自己所在的那条链**，`await` 它就是永久自锁
 *   （23:24:16 起链、23:33:20 仍在飞，期间零结算零重建）。所以本函数只给
 *   「不在链的调用栈里」的观察者用：`state/data.ts` 三个 P0 出口、renewer 桥、tab 层；
 *   运输层钩子改用下面的 `libSoftHookReplay()`（同步判定，绝不 await）；
 * - `skipped/cooldown`（占位冷却窗内，`pending` 缺失、没人持飞）→ **原样返回、绝不 await**，
 *   维持 b19 行为：不登出，原地留可重试错误条；
 * - `pending` 缺失时绝不瞎等（不造 sleep、不轮询）；
 * - **单层**：`pending` 自身结算成 `skipped` 也直接透传，不追第二层在飞链、不递归，
 *   绝不因此触发第二轮恢复（退避窗由既有 ⑤ 冷却兜住）。
 *
 * 零依赖（只 `import type`）：既是 `state/data.ts` 的实现，也是护栏
 * `tools/relogin-test.mjs` 直接加载跑行为断言（含「cooldown 分支不 await」）的落点。
 */
import type { LibSoftResult } from "../lib/libSessionGuard.js";

/** 页面层动作（由真结算决定）：`done` 重试一次加载 / `failed` 落登录页 / 其余留错误条。 */
export type LibSoftPageAction = "retry-load" | "back-to-login" | "show-pending-note";

/**
 * `skipped/reentrant` 且带 `pending` 时：在守卫之外 `await` 它的**真结果**并返回。
 * 其余情况（`done` / `failed` / `skipped-cooldown` / 无 `pending` 的 reentrant）
 * **原样返回**——一次 `await` 都不做。
 */
export async function settleLibSoftPending(r: LibSoftResult): Promise<LibSoftResult> {
  if (r.state !== "skipped" || r.reason !== "reentrant" || !r.pending) return r;
  try {
    return await r.pending;
  } catch {
    return { state: "failed" };
  }
}

/**
 * 页面层动作映射（`state/data.ts` 三个 P0 出口共用的判据，护栏做确定性断言）：
 * 只有 `failed` 允许登出；`skipped`（含 cooldown）一律原地留可重试错误条。
 * 输入必须是 `settleLibSoftPending()` 的输出。
 */
export function libSoftPageAction(r: LibSoftResult): LibSoftPageAction {
  if (r.state === "done") return "retry-load";
  if (r.state === "failed") return "back-to-login";
  return "show-pending-note";
}

/* ═══════════════ b33：failed 落 backToLogin 之前的「存活复核」 ═══════════════
 *
 * 病根（b31 收尾·第三条路径，真机 `/tmp/b31-after-s3.log`）：**同一代次内**两跳误判。
 * campus / learn / semesters 三条加载路径各有两跳恢复（`relearnRoamOnce()` +
 * `softRecoverResult(scope)`），其中一跳被冷却判 `skipped`（按 b19 契约不登出），
 * 另一跳的漫游请求拿到 id 登录链 200 页 → `LIB-AUTH logged-out-page` → `failed`，
 * 于是 b19「任一入口真 `failed` 即登出」生效。可真机上 67ms 之前
 * `SOFT-RECOVER[global] state=done (195ms)` **刚刚成功**——会话是活的，是那条
 * 并发请求旧了；`failed` 覆盖了 `done`，用户被踢回登录页（登录后 62 秒自发一次）。
 *
 * 口径（b33）：`failed` 落 `backToLogin()` **之前**先复核「同代次内是否已有恢复成功 /
 * 是否仍有恢复在飞」（只读 `libSessionGuard` 的既有观测口）。命中**不登出**，
 * 改为**有限次**重跑该加载（复用 `libSoftAutoRetry` 的次数上限 3，绝不无限循环）；
 * 复核不命中（= 会话真的死了：没有任何成功证据、也没有恢复在飞）时**如实登出**，
 * 自动重试用尽同样如实登出——(A)(B) 两侧都由本函数给出确定性判据。
 *
 * 三条证据（优先级从强到弱，`none` = 真死）：
 * - `done-after-start`：**本次加载期间**有恢复真成功（代次未变 ⇒ 必然同代次）——最强证据；
 * - `recent-done`：最近 `LIB_SOFT_ALIVE_GRACE_MS`（10s）内有过恢复成功——覆盖
 *   「加载复用了恢复前创建的在飞 promise」这一形态（`cacheFetch` 同键单飞）；
 * - `in-flight`：仍有恢复链在飞（其结算结果即将到来）——窗口内不登出，等它的结论。
 *
 * 边界：本函数**只读**，不 await 任何 pending、不触发任何恢复；`failed` 依旧是唯一
 * 允许登出的三态（b19 契约不废弃，只是给 `failed` 加了一道「同期成功证据」闸门）。 */

/** 「最近有过恢复成功」的宽限窗（真机事件里 `done` 比误判早 67ms；10s 留给慢链）。 */
export const LIB_SOFT_ALIVE_GRACE_MS = 10_000;

export type LibSoftAliveVerdict = "done-after-start" | "recent-done" | "in-flight" | "none";

export interface LibSoftAliveProbe {
  /** 本次加载**发起时**读到的「最近一次恢复成功」时刻（0 = 还没有）。 */
  doneAtStart: number;
  /** 判定时读到的「最近一次恢复成功」时刻。 */
  doneNow: number;
  /** 判定时是否有 lib 会话恢复链在飞。 */
  recoveryInFlight: boolean;
  /** 判定时刻（ms），护栏注入固定值做确定性断言。 */
  now: number;
  /** 覆盖宽限窗（护栏用；默认 `LIB_SOFT_ALIVE_GRACE_MS`）。 */
  graceMs?: number;
}

export function libSoftSessionLooksAlive(p: LibSoftAliveProbe): { alive: boolean; verdict: LibSoftAliveVerdict } {
  if (p.doneNow > 0 && p.doneNow > p.doneAtStart) return { alive: true, verdict: "done-after-start" };
  const grace = p.graceMs ?? LIB_SOFT_ALIVE_GRACE_MS;
  const age = p.now - p.doneNow;
  if (p.doneNow > 0 && age >= 0 && age <= grace) return { alive: true, verdict: "recent-done" };
  if (p.recoveryInFlight) return { alive: true, verdict: "in-flight" };
  return { alive: false, verdict: "none" };
}

/* ═══════════════ b36：真死侧（verdict=none）的可复核日志（b33 遗留） ═══════════════
 *
 * b33 遗留：`LIB-AUTH-ALIVE-RECHECK` 只在**复核命中**（会话其实活着）时打印；复核
 * 不命中（`verdict=none` = 真死）时直接 `backToLogin()`，真死侧在日志里没有任何
 * 可复核痕迹——真机只能靠「`.login-card` 上屏」的时间线间接证明，护栏也只有 ㉖-3
 * 的确定性镜像。本段补一行真死日志，让 (A) 活着一侧与 (B) 真死一侧都能 grep。
 *
 * 口径（与 b31 的 `AUTO-RECOVER` 摘要同一形状）：
 * - **每 epoch 至多一条**：计数式闸门按登录代次整只换掉；同一代次内三条加载路径
 *   先后判死时只留第一行，其余只计数、不刷屏；
 * - 行内**只有** verdict / scope / hits 三个字段：scope 是闭合字面量集合，
 *   **绝不打印凭据、票值、URL 或查询串**（连错误原文也不进这行）；
 * - 只读、不触发任何恢复、不改任何登出判定：`failed` 依旧是唯一允许登出的三态
 *   （b19 契约与 b33 的存活复核 / 10s 宽限一行未动）。
 */

/** 真死日志的 scope 只允许这三个字面量（闭合集合——日志行里不许出现动态拼入的内容）。 */
export type LibAuthDeadScope = "CAMPUS-AUTH" | "LEARN-AUTH" | "SEMESTERS-AUTH";

interface LibAuthDeadGate {
  epoch: number;
  /** 本 epoch 记到的真死判定次数（含未落行的那些）。 */
  hits: number;
  /** 本 epoch 是否已落过那一行。 */
  logged: boolean;
}

function freshLibAuthDeadGate(epoch: number): LibAuthDeadGate {
  return { epoch, hits: 0, logged: false };
}
let libAuthDeadGate: LibAuthDeadGate = freshLibAuthDeadGate(-1);

/** 纯函数（护栏直接断言）：这一次真死判定是否落行 + 落行时的计数。 */
export function planLibAuthDeadLog(args: { hits: number; logged: boolean }): { log: boolean; hits: number } {
  const hits = Math.max(0, Math.floor(args.hits)) + 1;
  return { log: !args.logged, hits };
}

/**
 * 真死（`verdict=none`）的唯一日志出口：返回要落的整行；`null` = 本 epoch 已落过
 * （本次只计数）。调用方用既有 `logLine` 输出——本模块零依赖，不持日志出口。
 */
export function claimLibAuthDeadLine(epoch: number, scope: LibAuthDeadScope): string | null {
  if (libAuthDeadGate.epoch !== epoch) libAuthDeadGate = freshLibAuthDeadGate(epoch);
  const plan = planLibAuthDeadLog({ hits: libAuthDeadGate.hits, logged: libAuthDeadGate.logged });
  libAuthDeadGate.hits = plan.hits;
  if (!plan.log) return null;
  libAuthDeadGate.logged = true;
  return `LIB-AUTH-DEAD verdict=none scope=${scope} hits=${plan.hits}`;
}

/** 护栏用：读数 / 复位（业务代码不得调用）。 */
export function libAuthDeadLogState(): { epoch: number; hits: number; logged: boolean } {
  return { epoch: libAuthDeadGate.epoch, hits: libAuthDeadGate.hits, logged: libAuthDeadGate.logged };
}
export function resetLibAuthDeadLogForTest(): void {
  libAuthDeadGate = freshLibAuthDeadGate(-1);
}

/* ═══════════════ P1（b22）：三处旧布尔出口的三态判定 ═══════════════
 *
 * 三处消费点（`lib/clients.ts` 的 nativeFetch 恢复钩子 / renewer 桥、
 * `pages/info/tabStates.tsx` 的 `logTabErr`）此前拿到的都是把三态折出来的布尔
 * `false`——`skipped`（被冷却判掉 / 链内再入）与真 `failed` 混在一起。下面的纯函数
 * 把**既有三态**映射到各消费点**各自既有的动作**上，没有新语义；护栏直接 import
 * 它们做确定性断言。
 *
 * 两档口径的区别只在**要不要等在飞链**：
 * - `libSoftHookReplay()`：运输层钩子专用——**同步**，绝不 `await pending`
 *   （它可能就在链内，见上）；
 * - `libSoftRenewDecision()` / `libSoftTabAction()`：守卫之外的观察者用——
 *   一律先经 `settleLibSoftPending()` 取真结果，再判定。
 */

/** P1-1（`lib/clients.ts` 的 nativeFetch 恢复钩子）：只有真 `done` 允许重放一次。
 *
 *  **入参必须是 `libSoftReloginResult()` 的原样三态，绝不先 `settleLibSoftPending()`。**
 *  本钩子由「某一次请求」的失败触发，而恢复链自身的请求也走同一个 `nativeFetch`：链内
 *  请求命中登录页时钩子会拿到 `skipped/reentrant + pending`，而 `pending` 就是**它自己
 *  所在的那条链**——`await pending` ＝ 等自己，整条链永久卡死（b22 真机实录，见模块头）。
 *  所以本层只做同步判定：
 *  - `done` → 重放一次（「只重放一次」仍由 `withLibAuthRecovery` 保证，这里不新增重放）；
 *  - `failed` → 不重放，原样交回第一个错误；
 *  - `skipped/cooldown` → 不重放，日志写明「被冷却判掉」，**不是失败结论**；
 *  - `skipped/reentrant` → 不重放，日志写明「在飞链未结算（本钩子在链内，绝不 await 自身）」。
 *  `line` 是该落哪条诊断日志（调用方拼前缀），把 `failed` 与 `skipped` 分开——旧布尔口径
 *  下两种含义混在同一个 `false` 里，真机 grep 无法区分「重登失败」与「被冷却判掉」。
 *  契约仍是 `transport.ts:52` 的 `NativeFetchAuthHooks.recover → Promise<boolean>`。
 *  「等在飞真结果再重放」只由守卫之外的观察者承担：`state/data.ts` 三个 P0 出口（b20）、
 *  renewer 桥（P1-2）、tab 层（P1-3）。 */
export function libSoftHookReplay(raw: LibSoftResult): { replay: boolean; line: string } {
  if (raw.state === "done") return { replay: true, line: "" };
  if (raw.state === "failed") return { replay: false, line: "state=failed → 不重放，原样交回调用方" };
  if ((raw.reason ?? "cooldown") === "cooldown") {
    return { replay: false, line: "state=skipped reason=cooldown → 不重放（被冷却判掉，不是失败结论）" };
  }
  return {
    replay: false,
    line: "state=skipped reason=reentrant → 不重放（在飞链未结算；本钩子在链内，绝不 await 自身）",
  };
}

/** P1-2（renewer 桥）：交给 core 的布尔只能表示「真失败」。
 *  `packages/core/src/info/client.ts` 的 `#withRenew` / `#withCardSession` /
 *  `#ensureCardSession` 收到 `false` 会立刻抛原 `AuthRequiredError` 或
 *  「校园卡会话未能建立」——`skipped`（被冷却判掉 / 在飞未结算）绝不能是那个 `false`，
 *  否则一次本可救回的续期变成用户可见错误条。返回 `true` 让 core 走它自己的有界重试。 */
export function libSoftRenewDecision(r: LibSoftResult): boolean {
  return r.state !== "failed";
}

/** P1-3（本批移植 tab 的 `logTabErr`）：`done` → 用既有 retry 自动重拉一次；
 *  `failed` → 保留错误条（真失败）；`skipped` → 标记待恢复、不重拉——与
 *  `softRecoverResult` 的 20s 节流窗互撞会成紧环（同 b20 止血的教训）。
 *
 *  b23 P2：同一份判定也被 `state/data.ts` 的七处布尔出口与可选组页面
 *  （`pages/Schedule.tsx`、`pages/info/DormTab.tsx|LibraryTab.tsx|LibRoomTab.tsx`）
 *  复用为「页面层数据加载出口」的三态动作——`done` 原地重取 / `failed` 落既有失败
 *  表现 / `skipped` 不落失败表现（按各处既有兜底重试或原地留 pending）。
 *  名字保留不改（b22 已定的出口），语义就是这里这三档。 */
export type LibSoftTabAction = "retry-load" | "keep-error" | "mark-pending";
export function libSoftTabAction(r: LibSoftResult): LibSoftTabAction {
  if (r.state === "done") return "retry-load";
  if (r.state === "failed") return "keep-error";
  return "mark-pending";
}
