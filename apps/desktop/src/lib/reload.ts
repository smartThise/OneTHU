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
  const now = Date.now();
  if (recoverInflight) return recoverInflight;
  if (now - lastAttempt < 20_000) return Promise.resolve(false);
  recoverInflight = (async () => {
    try {
      const { session, persist, logLine } = await import("./clients.js");
      const t0 = Date.now();
      const ok = await session.softRelogin();
      if (ok) await persist().catch(() => undefined);   // 重建后的快照落盘，重启直接续
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

/** 会话保活：10 分钟轻探针（wrapped info 落地页），死 → softRelogin。
 *  过期前续、死亡即刻重建——用户下一次点击永远踩在活会话上（THU Info
 *  「永不掉线」的另一半；光靠死了再救仍会有一时半会的长加载）。 */
export function installKeepalive(): void {
  setInterval(() => {
    void (async () => {
      try {
        const { session } = await import("../lib/clients.js");
        await session.keepalive();
      } catch { /* 静默：保活失败不影响前台 */ }
    })();
  }, 10 * 60_000);
}
