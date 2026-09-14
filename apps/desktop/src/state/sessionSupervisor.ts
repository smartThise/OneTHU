/**
 * 会话总管（Session Supervisor）—— 2026-09-14 凌晨架构级方案
 *
 * 用户症状与根因对应：
 * ① 冷启动风暴（数据网玄学红条）：全 app 模块同时抢登录 -> id/webvpn 排队互踩。
 *    -> 登录落定门 waitReady()：所有数据加载等门开，门在 status->ready 后开。
 * ② 脱线（闲置）后再打开红条：会话闲置过期。
 *    -> 前台心跳：可见时每 4 分钟轻探 webvpn，保持会话温热；探测失败标记 degraded。
 * ③ 重启/回前台要"加载一下"：回到前台时会话已死，模块各自撞墙。
 *    -> 回前台预检：visibilitychange->visible 先探活，死了先静默恢复再广播刷新。
 * ④ id 共享互踩：relearnRoam/softRelogin 并发多条链。
 *    -> 全局登录互斥 withLoginLock：上游登录全 app 单飞。
 *
 * 非 React 模块（纯 TS），app 根在 status->ready 时调 markReady()。
 */

type Health = "cold" | "ready" | "degraded";

let health: Health = "cold";
let readyResolvers: Array<() => void> = [];
let loginLock: Promise<unknown> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let preflightInflight: Promise<Health> | null = null;
let lastBeat = 0;

/** app 根在登录落定（status->ready）时调用：开门 + 起心跳 + 挂回前台预检 */
export function markReady(): void {
  if (health !== "cold") return;
  health = "ready";
  readyResolvers.forEach((r) => r());
  readyResolvers = [];
  startHeartbeat();
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void onResume();
    });
  }
}

/** 登出/会话彻底死亡：关门，模块各自回错误态（下一次 markReady 重开） */
export function markCold(): void {
  health = "cold";
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

/** 登录落定门：冷启动数据加载先等它（带超时兜底，绝不死等） */
export function waitReady(timeoutMs = 15_000): Promise<void> {
  if (health !== "cold") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      readyResolvers = readyResolvers.filter((r) => r !== wrapped);
      resolve();
    }, timeoutMs);
    const wrapped = () => {
      clearTimeout(t);
      resolve();
    };
    readyResolvers.push(wrapped);
  });
}

/** 全局登录互斥：relearnRoam / softRelogin / 任何上游登录链都必须持锁（app 级单飞） */
export function withLoginLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = loginLock;
  const run: Promise<T> = (async () => {
    if (prev) await prev.catch(() => undefined);
    return await fn();
  })();
  // 完成后自动让位（仅当没有后来者排队时）
  void run
    .catch(() => undefined)
    .then(() => {
      if (loginLock === run) loginLock = null;
    });
  loginLock = run;
  return run;
}

/** 便宜探活：webvpn 门户 200=活；302/网络错=死（蜂窝瞬断也判死，宁保守） */
async function probe(): Promise<boolean> {
  try {
    const { universalFetch } = await import("../lib/transport.js");
    const res = await universalFetch("https://webvpn.tsinghua.edu.cn/", {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    }).catch(() => null);
    if (!res) return false;
    // 门户对已登录会话回 200；过期会 302 到登录
    return res.status === 200;
  } catch {
    return false;
  }
}

function startHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    void beat();
  }, 4 * 60_000);
}

async function beat(): Promise<void> {
  // 节流：回前台预检刚跑过就不重复打
  if (Date.now() - lastBeat < 60_000) return;
  lastBeat = Date.now();
  const alive = await probe();
  if (!alive && health === "ready") {
    health = "degraded";
    broadcast("onethu:session-degraded");
  } else if (alive && health === "degraded") {
    health = "ready";
    broadcast("onethu:session-refresh");
  }
}

/** 回前台：探活 -> 死则静默恢复（持锁单飞）-> 恢复成功广播刷新 */
async function onResume(): Promise<Health> {
  if (health === "cold") return health;
  if (preflightInflight) return preflightInflight;
  preflightInflight = (async () => {
    try {
      lastBeat = Date.now();
      const alive = await probe();
      if (alive) {
        if (health === "degraded") {
          health = "ready";
          broadcast("onethu:session-refresh");
        }
        return health;
      }
      // 死了：静默恢复（全局互斥；20s 节流在 softRecover 内部）
      const { softRecover } = await import("../lib/reload.js");
      const ok = await withLoginLock(() => softRecover("resume-preflight"));
      if (ok) {
        health = "ready";
        broadcast("onethu:session-refresh");
      } else {
        health = "degraded";
        broadcast("onethu:session-degraded");
      }
      return health;
    } finally {
      preflightInflight = null;
    }
  })();
  return preflightInflight;
}

function broadcast(evt: string): void {
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(evt));
  } catch {
    /* 非 window 环境（测试）静默 */
  }
}

export function sessionHealth(): Health {
  return health;
}
