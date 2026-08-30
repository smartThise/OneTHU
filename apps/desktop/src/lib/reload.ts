/**
 * 整页重载式自愈（用户语义：等同手动右键刷新，从头载入）。
 * sessionStorage 节流：同一 scope 2 分钟内只自动重载一次，防止坏会话死循环；
 * 节流窗口内的第二次失败返回 false，由调用方亮可重试错误。
 * 使用方：校园卡（useCard）、图书馆（LibraryTab）、选课工作台失登自愈（zhjwxk）。
 */
export function autoFullReload(scope: string): boolean {
  try {
    const key = `onethu.autoreload.${scope}`;
    const last = Number(sessionStorage.getItem(key) ?? "0");
    if (Date.now() - last < 120_000) return false;
    sessionStorage.setItem(key, String(Date.now()));
  } catch { /* sessionStorage 不可用就保守放行一次 */ }
  setTimeout(() => location.reload(), 150);
  return true;
}
