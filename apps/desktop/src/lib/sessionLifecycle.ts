/**
 * 运行时会话意图（不是 UI 状态）。
 *
 * 显式登出后，10 分钟保活/静默重登不能拿「记住密码」把账号自动登回来——
 * 登出墓碑（authCookieBoundary）只保护启动/交接路径，运行中的保活看不到它。
 * 这个模块是唯一的进程内权威位：logout() 置 signedOut，成功登录置 signedIn；
 * 所有后台恢复入口先判它。
 */
let signedOut = false;

export function markSignedOut(): void {
  signedOut = true;
}

export function markSignedIn(): void {
  signedOut = false;
}

export function isSignedOut(): boolean {
  return signedOut;
}
