/**
 * 登录代次（auth epoch，b31 P0 / RC2）。
 *
 * 病根：页面层数据加载在**登录前**发出、**登录后**才结算。旧口径下这类陈旧结算
 * 会照常写回——`state/data.ts` 的 CAMPUS / LEARN / SEMESTERS 三条路径在恢复判
 * `failed` 时会 `backToLogin()`，于是刚登录成功的用户被一条早该丢弃的响应踢回
 * 登录页（霖实录：「恢复后过一小会（~1s）突然又闪回登录界面，可能要点两次」）。
 *
 * 口径：每次「登录成功 / 2FA 完成 / 交互重登 / 登出」把代次 +1；页面层加载在
 * **发起时**捕获代次，任何结算点若代次已变则**一律不写回**——不 `backToLogin()`、
 * 不 `setState("error")`、不 `setError(...)`、不写数据。这样 RC2 从机制上不可能
 * 再发生，与恢复链三态 / 单飞 / 冷却语义完全正交（本模块不碰它们）。
 *
 * 零依赖：唯一写入口是 `state/app.tsx` 的四个出口；读点是 `state/data.ts` 三条
 * 加载路径与护栏（`tools/relogin-test.mjs` 直接 import 跑确定性断言）。
 */
let authEpochSeq = 0;

/** 当前登录代次（发起加载时捕获、结算时比对）。 */
export function currentAuthEpoch(): number {
  return authEpochSeq;
}

/** 只在 `state/app.tsx` 的四个出口调用：登录成功 / 2FA 完成 / 交互重登 / 登出。 */
export function bumpAuthEpoch(): number {
  authEpochSeq += 1;
  return authEpochSeq;
}

/** 护栏用：复位（业务代码不得调用）。 */
export function resetAuthEpochForTest(): void {
  authEpochSeq = 0;
}
