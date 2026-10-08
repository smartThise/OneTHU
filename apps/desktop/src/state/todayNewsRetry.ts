/**
 * 今日页新闻源的**有界退避**（b20 止血）。
 *
 * 为什么单独成模块：b19 现场（真死会话）`PAGE-ERR TODAY-NEWS` 844 条 / 139s
 * （≈6 次/s、峰值 8 次/s），根因是失败后**无条件立刻重拉**。退避参数是这条修复里
 * 唯一需要「确定性断言」的部分，抽成零依赖纯函数后，护栏
 * `tools/relogin-test.mjs` 可以直接 import 跑断言，不必依赖真实计时器睡眠
 * （hook 侧只把返回值交给 `setTimeout`，逻辑本身可离线判定）。
 *
 * 参数选择（取值理由都对着现场数字）：
 * - 起步 `TODAYNEWS_RETRY_BASE_MS = 3s`：新闻卡是**静默兜底**数据，会话瞬断
 *   （切网 / 网关抖一下）在数秒内恢复的概率高，3s 让一次抖动不至于让卡片空白
 *   半分钟；同时 3s 已经比原现场 280ms 一轮低一个数量级。
 * - 翻倍（3s → 6s → 12s → 24s → 48s）+ 封顶 `TODAYNEWS_RETRY_MAX_MS = 60s`：
 *   封顶取 60s 而不是 ⑤ 静默重登的 120s——新闻源失败**不阻塞**任何登录状态恢复，
 *   只是少一张卡；封顶 60s 即「最多一分钟一份请求」，稳稳落在「每分钟个位数」内，
 *   且不会像 120s 那样让一次短暂恢复被错过两分钟。
 * - 单串上限 `TODAYNEWS_RETRY_MAX_ATTEMPTS = 6`：真正「有界」——一轮连续失败最多
 *   触发 5 次自动重试（t=0 首次 + 3s / 9s / 21s / 45s / 93s），此后停下等页面
 *   重挂载或用户手动刷新，绝不无限重试。首分钟内共 5 次请求（含首次）。
 * - `attempt = 0` → 0ms：**首次加载零延迟**，会话健康路径的观感一字不变；
 *   成功即复位到 0，下一次失败重新从 3s 起步。
 *
 * 「同 feedKey 同一时刻只许一份在飞」的单飞不在本模块（它有 Promise 状态），
 * 落在 `state/data.ts` 的 `fetchTodayNewsOnce()`。
 */

/** 连续失败起步延迟：3s（见文件头理由）。 */
export const TODAYNEWS_RETRY_BASE_MS = 3_000;
/** 退避封顶：60s（见文件头理由）。 */
export const TODAYNEWS_RETRY_MAX_MS = 60_000;
/** 单串连续失败的自动重试上限：6（= 首次 + 5 次重试，见文件头理由）。 */
export const TODAYNEWS_RETRY_MAX_ATTEMPTS = 6;

/**
 * 已经连续失败 `attempt` 次后，**下一次自动重试**前要等的毫秒数。
 * - `attempt <= 0`（还没失败过 / 刚成功复位）→ `0`：首次立即执行；
 * - `attempt = 1` → 起步值，之后每失败一次翻倍，封顶 `TODAYNEWS_RETRY_MAX_MS`。
 */
export function nextTodayNewsRetryDelay(attempt: number): number {
  const n = Number.isFinite(attempt) ? Math.floor(attempt) : 0;
  if (n <= 0) return 0;
  return Math.min(TODAYNEWS_RETRY_BASE_MS * 2 ** (n - 1), TODAYNEWS_RETRY_MAX_MS);
}

/**
 * 还允许排下一次自动重试吗（`attempt` = 已连续失败次数）。
 * 有界：`attempt >= TODAYNEWS_RETRY_MAX_ATTEMPTS` 起不再排（等重挂载 / 手动刷新）。
 */
export function shouldRetryTodayNews(attempt: number): boolean {
  const n = Number.isFinite(attempt) ? Math.floor(attempt) : 0;
  return n > 0 && n < TODAYNEWS_RETRY_MAX_ATTEMPTS;
}
