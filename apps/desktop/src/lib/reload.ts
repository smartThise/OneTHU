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

import { emitAuthRecovered } from "./authRecovery.js";

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
      const { persist, logLine, session } = await import("./clients.js");
      const t0 = Date.now();
      // lib 单管线：会话守卫（探活→死则内存凭据完整重登，受信凭据免 2FA）
      const { libEnsureSession } = await import("./infoLib.js");
      const ok = await libEnsureSession();
      if (ok) {
        session.state = "ready";
        await persist().catch(() => undefined);   // 重建后的快照落盘，重启直接续
        // 已经恢复的页面（error 状态）需要知道“可以重试了”，否则只能等用户手刷。
        emitAuthRecovered(scope);
        if (scope !== "global") emitAuthRecovered("global");
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

/**
 * learn 专属探活 + 按需重建。
 *
 * 这是本轮修复的核心：info 门户活着不代表 learn 会话活着；`libEnsureSession()`
 * 只探 info，10 分钟 keepalive 因此永远看不见 learn 的独立过期。`learn.ensureSession()`
 * 会真实取一次课程页，失败再走 LearnClient 的 id 漫游/宿主恢复链（内部已单飞）。
 * 成功后广播事件，让已经停在 error 的课程文件/作业/通知页自动重试。
 */
export async function ensureLearnSession(): Promise<boolean> {
  try {
    const { learn, session } = await import("./clients.js");
    // 登录/2FA/已登出阶段不插后台探针：startLogin 与 2FA 自己持有会话门；
    // 这里只维护“已经 ready 的正常使用期”的 learn 会话。
    if (session.state !== "ready") return false;
    const ok = await learn.ensureSession();
    if (ok) {
      emitAuthRecovered("learn");
      emitAuthRecovered("global");
    }
    return ok;
  } catch {
    return false;
  }
}

/** 页面显式重试用的无冷却恢复：lib 主会话 → 对应业务会话。
 *  softRecover 有 20s 全局冷却（防连锤），但页面在 AuthRequired 后需要立即补救；
 *  这里绕过冷却，但仍复用 core 的单飞/幂等链。 */
export async function recoverCampusSession(scope: "learn" | "dorm"): Promise<boolean> {
  try {
    const { libEnsureSession, libRoamLearn } = await import("./infoLib.js");
    if (!(await libEnsureSession())) return false;
    if (scope === "learn") return await ensureLearnSession();
    const { info } = await import("./clients.js");
    await info.forceEnsure("dorm");
    emitAuthRecovered("dorm");
    emitAuthRecovered("global");
    return true;
  } catch {
    return false;
  }
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
let lastLearnWakeProbe = 0;
let wakeProbeInstalled = false;
export function installKeepalive(): void {
  setInterval(() => {
    void (async () => {
      try {
        // lib 单管线：探活 + 死则内存凭据静默重登（受信凭据免 2FA）
        const { libEnsureSession } = await import("./infoLib.js");
        const { persist, session } = await import("./clients.js");
        const ok = await libEnsureSession();
        if (ok) {
          session.state = "ready";
          await persist().catch(() => undefined);
        }
      } catch { /* 静默：保活失败不影响前台 */ }
      // learn 是独立会话：info 活不代表 learn 活。只探 info 的旧 keepalive
      // 会让“课程列表/文件/作业只有它过期”长期无人发现，直到用户点开页面。
      try {
        await ensureLearnSession();
      } catch { /* 静默：learn 恢复失败不阻断其他保活 */ }
      // GitLab 域巡检（2026-10-14「经常丢登录态」治理）：`_gitlab_session` 是
      // git.tsinghua.edu.cn 的独立短命票，上一段只覆盖 webvpn/id 侧——长闲置后
      // 下一次点进 GitLab 必撞 401 并触发整条漫游换票舞。随同一节拍顺手把 git 域
      // 探一遍：死票在用户点击前静默换好（state/gitlab.ts 的单飞哨兵保证并行取数
      // 与这里共享同一条恢复链，探针不确定/换票失败都静默落回原路）。
      try {
        const { gitlabEnsureSession } = await import("../state/gitlab.js");
        await gitlabEnsureSession();
      } catch { /* 静默：巡检失败不影响前台 */ }
    })();
  }, 10 * 60_000);

  // 睡眠/切后台回来时定时器可能被节流甚至跳过；聚焦/重新可见时补一次 learn
  // 探针（1 分钟节流，避免窗口来回切导致请求风暴）。
  if (!wakeProbeInstalled && typeof window !== "undefined" && typeof document !== "undefined") {
    wakeProbeInstalled = true;
    const probeOnWake = () => {
      const now = Date.now();
      if (now - lastLearnWakeProbe < 60_000) return;
      lastLearnWakeProbe = now;
      void ensureLearnSession();
    };
    window.addEventListener("focus", probeOnWake);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") probeOnWake();
    });
  }
}
