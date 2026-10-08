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

import type { LibSoftResult } from "./libSessionGuard.js";

/** scope 级原地恢复：softRelogin（WebVPN 全链透明重建，CampusSession 内单飞，
 *  并发弹回只跑一条链）。20s 节流窗口内返回 `skipped`——窗口内复用 `done` 会造出
 *  「恢复→重试→仍 auth 错→再恢复(true)→再重试」的紧循环；返回 `skipped` 让调用方
 *  落回错误条/下一层兜底（看门狗与实例重放仍在后台续命，手动重试必中活会话）。
 *
 *  三态出口（b19 P0）：`skipped`（本函数的 20s 节流、或共享单飞的占位冷却/同键在飞）
 *  **不是失败**——调用方不许据此把用户置为登出；只有 `failed`（真执行过且失败）才是。
 *  旧布尔语义保留在下面的薄封装里。 */
let lastAttempt = 0;
let recoverInflight: Promise<LibSoftResult> | null = null;
export function softRecoverResult(scope: string): Promise<LibSoftResult> {
  const now = Date.now();
  if (recoverInflight) return recoverInflight;
  if (now - lastAttempt < 20_000) return Promise.resolve({ state: "skipped", reason: "cooldown" });
  recoverInflight = (async (): Promise<LibSoftResult> => {
    try {
      const { persist, logLine, session } = await import("./clients.js");
      const t0 = Date.now();
      // lib 单管线：会话守卫（探活→死则完整重登，受信凭据免 2FA）。
      // 站点来源（b18 A）：看门狗 / scope 恢复**没有请求上下文**，不再用
      // `http.lastFinalUrl` 这类全局「最后一次失败落点」反推站点（b17 真机实录
      // SOFT-RECOVER[global] fail sites=[libroom] 就是那条过期归属），改为只做门户判活；
      // 带站点的重建由有请求落点的入口给出（nativeFetch 钩子按该次请求落点、
      // learn.reloginHook 点名 learn、card renewer 点名 card）。
      const { libEnsureSessionResult } = await import("./infoLib.js");
      const r = await libEnsureSessionResult();
      if (r.state === "done") {
        session.state = "ready";
        await persist().catch(() => undefined);   // 重建后的快照落盘，重启直接续
      }
      await logLine(
        `SOFT-RECOVER[${scope}] state=${r.state}${r.reason ? ` reason=${r.reason}` : ""} (${Date.now() - t0}ms) sites=[] siteSrc=none`,
      ).catch(() => undefined);
      lastAttempt = Date.now();
      return r;
    } catch {
      lastAttempt = Date.now();
      return { state: "failed" };
    } finally {
      recoverInflight = null;
    }
  })();
  return recoverInflight;
}

/** 旧布尔薄封装（b19 P0）：`state === "done"`，语义与三态之前一致。 */
export function softRecover(scope: string): Promise<boolean> {
  return softRecoverResult(scope).then((r) => r.state === "done");
}

/** 全局失登看门狗：core 任何模块抛 AuthRequiredError → 静默 softRelogin。
 *  （旧版在这里触发整页重载——AuthRequiredError 构造即广播，成功自愈的
 *  调用方也会被 150ms 后的 reload 腰斩；新版只重建会话，scope 级重试由
 *  各调用方的既有 fallback 完成。）应用启动时调用一次。
 *
 *  三态（b23 P2）：这里**不再用布尔薄封装 `softRecover("global")`** —— 它把
 *  `skipped`（冷却判掉 / 链内再入）与真 `failed` 折成同一个 `false`，看门狗据此
 *  会「按失败结算」（真机 grep 无法区分两种含义）。改为消费 `softRecoverResult`
 *  的原样三态：只有 `failed` 才落失败结算，`skipped` 两种子情形都直接返回、不误报。
 *
 *  为什么**不**在这里 `settleLibSoftPending`（守卫外等真结果）：看门狗没有任何
 *  「拿到真结果才做」的动作——恢复本身已由 `softRecoverResult` 在后台执行完并
 *  自带 `SOFT-RECOVER[global] state=… reason=…` 日志；`await pending` 只会把看门狗
 *  挂在别人那条在飞链上（b22 真机死锁的同一类拓扑），零收益、有风险。需要真结果
 *  的观察者仍是页面层 P0 出口 / renewer 桥 / tab 层（各自都在链外且有重放或登出动作）。 */
export function installAuthWatchdog(): void {
  void (async () => {
    try {
      const { onAuthRequired } = await import("@onethu/core");
      onAuthRequired(() => {
        void (async () => {
          const r = await softRecoverResult("global");
          if (r.state !== "failed") return;   // done / skipped（cooldown、reentrant）都不是失败
          // 失败结算：全局失登的既有收尾（本轮不新增登出、不新增 UI——真失败由页面层
          // P0 出口按 `failed` 落登录页；`persist()` 仍在 softRecoverResult 的 done 支里）。
        })();
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
        // lib 单管线：探活 + 死则内存凭据静默重登（受信凭据免 2FA）
        const { libEnsureSession } = await import("./infoLib.js");
        const { persist, session } = await import("./clients.js");
        const ok = await libEnsureSession();
        if (ok) {
          session.state = "ready";
          await persist().catch(() => undefined);
        }
      } catch { /* 静默：保活失败不影响前台 */ }
    })();
  }, 10 * 60_000);
}
