/**
 * 单一会话平面（2026-09-14 架构重构第 2 步）
 *
 * 病根：5+ 个模块各自 ensure/roam/login，各自认为自己该救会话——
 * 而 WebVPN 是**单会话**，完整登录会踢掉还活着的会话（session.ts 血泪注释）。
 * 于是并行恢复链互相踢、风暴自我延续：模块 A 建链踢掉模块 B 的会话，
 * B 失败再建链踢回去……冷启动/回前台/数据网抖动时必现，校园网低延迟掩盖。
 *
 * 平面职责（唯一会话入口）：
 *  1. 全局串行：任一时刻只有一条恢复链在跑，从根上消灭互踢；
 *  2. 阶梯：轻探 → 免密漫游(relearnRoam) → 完整重登(softRelogin，自带熔断退避)；
 *  3. TTL 感知：4 分钟内验证过直接放行，不做重复劳动；
 *  4. 单飞去重：同刻多模块请求复用同一 Promise；
 *  5. 每任务带超时上限（上次全局锁无超时=全 app 卡死的教训），队列永远前进；
 *  6. 不设门、不阻塞 UI：失败只返回 false，各模块既有有界重试照旧。
 */
import { logPageError } from "./data.js";

export type PlaneTag = "learn" | "preflight" | "heartbeat" | "wake" | "warmup" | "resume";

/** 验证新鲜度：4 分钟内探活成功过就直接放行（learn 漫游 ~8min 过期，留安全余量） */
const VERIFY_TTL = 4 * 60_000;
const VERIFY_TIMEOUT = 6_000;
const ROAM_TIMEOUT = 12_000;
const RELOGIN_TIMEOUT = 25_000;

let queue: Promise<unknown> = Promise.resolve();
let lastVerifyOk = 0;

/** 串行队列：每个任务带超时上限，异常/超时都不阻断后续（队列永续前进） */
function enqueue<T>(fn: () => Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  const run = queue.then(
    () =>
      Promise.race([
        fn().catch(() => fallback),
        new Promise<T>((r) => setTimeout(() => r(fallback), timeoutMs)),
      ]) as Promise<T>,
  );
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** 轻探：一次 learn 学期查询即可验证 webvpn 票据 + learn 会话两层 */
async function verify(): Promise<boolean> {
  const { learn } = await import("../lib/clients.js");
  try {
    await learn.getCurrentSemester();
    lastVerifyOk = Date.now();
    return true;
  } catch {
    return false;
  }
}

export type PlaneResult = "fresh" | "repaired" | "ok" | "fail";

let inflightResult: Promise<PlaneResult> | null = null;

/** 会话就绪保证（唯一入口）。
 *  返回值语义（2026-09-14 重载循环事故定案）：
 *   - fresh  = TTL 命中，本次没做任何事（**调用方不得据此触发刷新**）
 *   - repaired = 会话本已失效，本级阶梯把它救回来了（**该广播刷新**）
 *   - ok     = 实探通过（会话一直活着）
 *   - fail   = 阶梯失败 */
export function ensureSession(tag: PlaneTag): Promise<PlaneResult> {
  if (Date.now() - lastVerifyOk < VERIFY_TTL) return Promise.resolve("fresh");
  if (inflightResult) return inflightResult; // 单飞：同刻多模块复用同一条链
  inflightResult = (async (): Promise<PlaneResult> => {
    try {
      // 阶梯第 1 级：轻探（多数情况会话活着，一次探活结束）
      if (await enqueue(verify, VERIFY_TIMEOUT, false)) return "ok";
      // 阶梯第 2 级：免密漫游（id 主会话换 learn 票，不碰 WebVPN 单会话）
      const { relearnRoamOnce } = await import("./data.js");
      if (await enqueue(() => relearnRoamOnce(), ROAM_TIMEOUT, false)) return "repaired";
      // 阶梯第 3 级：完整重登（自带单飞 + 熔断退避，绝不会高频锤风控）
      const { softRecover } = await import("../lib/reload.js");
      const ok = await enqueue(() => softRecover(`plane-${tag}`), RELOGIN_TIMEOUT, false);
      if (ok && (await enqueue(verify, VERIFY_TIMEOUT, false))) return "repaired";
      logPageError("PLANE", new Error(`会话恢复失败(${tag})：三级阶梯均未成功`));
      return "fail";
    } catch (err) {
      logPageError("PLANE", err);
      return "fail";
    } finally {
      inflightResult = null;
    }
  })();
  return inflightResult;
}

/** 广播限流：10s 内至多一次（防「失败→广播→重拉→再失败」自激） */
let lastBroadcast = 0;
let broadcastCount = 0;

/** 心跳/回前台/唤醒/页面自愈统一入口：只在「真的救回了会话」时广播刷新。
 *  2026-09-14 事故：旧版只要成功就广播，配合 TTL 命中秒回 = 页面无限重拉循环。 */
export async function keepAlive(tag: PlaneTag): Promise<void> {
  const r = await ensureSession(tag);
  if (r === "repaired") broadcast();
  else if (r === "fail") broadcast(); // 失败也放行一次：让等着的页面拿到结果而不是干等
}

/** 会话修复完成广播（限流 10s；诊断可查次数） */
export function broadcast(): void {
  const now = Date.now();
  if (now - lastBroadcast < 10_000) return;
  lastBroadcast = now;
  broadcastCount += 1;
  window.dispatchEvent(new Event("onethu:session-refresh"));
}

/** 诊断：平面状态 */
export function planeStats(): { lastVerifyOk: number; inflight: boolean; ttlMs: number; broadcastCount: number } {
  return { lastVerifyOk, inflight: inflightResult !== null, ttlMs: VERIFY_TTL, broadcastCount };
}

/** 启动预热（app ready 后调用，不阻塞任何 UI）：把会话在建链风暴之前建立好 */
export function warmUp(): void {
  void ensureSession("warmup").catch(() => undefined);
}

