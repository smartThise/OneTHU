/**
 * 失登自愈（THU Info 语义，2026-09-11 稳定性专项定案）：
 *
 * 旧模型：任何一层会话死亡 → location.reload() 整页重载——用户看见白屏/闪屏
 * + 全部面板串行重拉（「强制刷新 + 长加载」的来源），且 AuthRequiredError 是在
 * 构造时广播的，调用方哪怕自己能自愈，150ms 后页面也照样被刷掉。
 *
 * 新模型：凭据已在内存（记住密码）→ 任何一层死（webvpn / id / learn / info /
 * card / zhjwxk）→ softRelogin 透明全链重建（demoLogin + roam-id + 重灌 jar）
 * → 各 scope 在原地重试自己的加载。location.reload 不再是自愈手段——它只剩
 * 「无凭据可用」时的最后落点（此时用户本来就要重新登录）。
 */

/** scope 级原地恢复：softRelogin（WebVPN 全链透明重建，CampusSession 内单飞，
 *  并发弹回只跑一条链）。20s 节流窗口内返回 false——窗口内复用 true 会造出
 *  「恢复→重试→仍 auth 错→再恢复(true)→再重试」的紧循环；返回 false 让调用方
 *  落回错误条/下一层兜底（看门狗与实例重放仍在后台续命，手动重试必中活会话）。 */
let lastAttempt = 0;
let recoverInflight: Promise<boolean> | null = null;
export function softRecover(scope: string): Promise<boolean> {
  // Selection owns a bounded service SSO attempt. Its local failures must not
  // restart WebVPN or invalidate the resident host's unrelated sessions.
  if (scope.startsWith('xk')) return Promise.resolve(false);
  const now = Date.now();
  if (recoverInflight) return recoverInflight;
  if (now - lastAttempt < 20_000) return Promise.resolve(false);
  recoverInflight = (async () => {
    try {
      const { persist, logLine, session, publishUniversitySession } = await import("./clients.js");
      const t0 = Date.now();
      // lib 单管线：会话守卫（探活→死则内存凭据完整重登，受信凭据免 2FA）
      const { libEnsureSession } = await import("./infoLib.js");
      const ok = await libEnsureSession();
      if (ok) {
        session.state = "ready";
        await persist().catch(() => undefined);   // 重建后的快照落盘，重启直接续
        await publishUniversitySession();
      }
      await logLine(`SOFT-RECOVER[${scope}] ${ok ? "ok" : "fail"} (${Date.now() - t0}ms)`).catch(() => undefined);
      lastAttempt = Date.now();
      return ok;
    } catch {
      lastAttempt = Date.now();
      return false;
    } finally {
      recoverInflight = null;
    }
  })();
  return recoverInflight;
}

/** 全局失登看门狗：core 任何模块抛 AuthRequiredError → 静默 softRelogin。
 *  （旧版在这里触发整页重载——AuthRequiredError 构造即广播，成功自愈的
 *  调用方也会被 150ms 后的 reload 腰斩；新版只重建会话，scope 级重试由
 *  各调用方的既有 fallback 完成。）应用启动时调用一次。 */
export function installAuthWatchdog(): void {
  void (async () => {
    try {
      const { onAuthRequired } = await import("@onethu/core");
      onAuthRequired(() => {
        void softRecover("global");
      });
    } catch {
      /* core 不可用时静默（仅存在于非打包预览环境） */
    }
  })();
}

interface KeepaliveAccount {
  username: string;
  fingerprint: string;
  state: string;
}

interface KeepalivePorts {
  account: () => KeepaliveAccount;
  loginPending: () => boolean;
  ensure: () => Promise<boolean>;
  persist: () => Promise<void>;
  publish: () => Promise<void>;
  now?: () => number;
}

/** One in-flight check serves timer and foreground events. Account changes
 * retire its result before it can persist or publish another owner's cookies. */
export function createSessionKeepalive(ports: KeepalivePorts): () => Promise<boolean> {
  let inFlight: Promise<boolean> | null = null;
  let lastAttempt: number | null = null;
  const now = ports.now ?? Date.now;
  return () => {
    if (inFlight) return inFlight;
    const before = { ...ports.account() };
    if (before.state !== "ready" || !before.username || ports.loginPending()) return Promise.resolve(false);
    const time = now();
    if (lastAttempt !== null && time >= lastAttempt && time - lastAttempt < 15_000) return Promise.resolve(false);
    lastAttempt = time;
    const stillCurrent = () => {
      const current = ports.account();
      return current.state === "ready" && current.username === before.username
        && current.fingerprint === before.fingerprint && !ports.loginPending();
    };
    const pending = (async () => {
      if (!await ports.ensure() || !stillCurrent()) return false;
      await ports.persist();
      if (!stillCurrent()) return false;
      await ports.publish();
      return stillCurrent();
    })();
    inFlight = pending;
    const settled = () => { if (inFlight === pending) inFlight = null; };
    void pending.then(settled, settled);
    return pending;
  };
}

let keepaliveInstalled = false;

/** Recheck an active account every ten minutes and when the app returns to the
 * foreground, including mobile WebViews whose background timers were paused. */
export function installKeepalive(): void {
  if (keepaliveInstalled) return;
  keepaliveInstalled = true;
  void Promise.all([import("./clients.js"), import("./infoLib.js")]).then(([clients, infoLib]) => {
    const check = createSessionKeepalive({
      account: () => clients.session,
      loginPending: infoLib.libLoginPending,
      ensure: async () => {
        if (!await infoLib.libEnsureSession()) return false;
        return clients.learn.resume();
      },
      persist: clients.persist,
      publish: clients.publishUniversitySession,
    });
    let running: Promise<void> | null = null;
    const tick = () => {
      if (document.visibilityState === "hidden" || running) return;
      running = (async () => {
        try {
          if (!await check()) return;
          await clients.logLine("KEEPALIVE verified and published").catch(() => undefined);
          const { gitlabEnsureSession } = await import("../state/gitlab.js");
          await gitlabEnsureSession();
        } catch (error) {
          const value = (error as { code?: unknown })?.code;
          const code = typeof value === "string" && /^[A-Z][A-Z0-9_]{1,80}$/.test(value) ? value : "RECOVERY_UNAVAILABLE";
          await clients.logLine("KEEPALIVE " + code).catch(() => undefined);
        }
      })().finally(() => { running = null; });
    };
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    window.addEventListener("pageshow", tick);
    window.addEventListener("online", tick);
    setInterval(tick, 10 * 60_000);
    tick();
  }).catch(() => { keepaliveInstalled = false; });
}
