/**
 * 认证恢复事件总线（纯内存，无 DOM / 无网络依赖）。
 *
 * 统一认证不是一份会话：learn、info、card、library…各自会独立过期。后台保活或
 * 某个数据请求把某一层恢复后，已经进入 error 状态的页面并不知道，只能等用户
 * 手动刷新。这里用一个极小的 scope 事件把“恢复已经发生”广播出去，由数据 hook
 * 在 error 状态做一次有节流的自动重试。
 *
 * 只传 scope 名称，不携带 cookie/账号/页面内容。
 */
export type AuthRecoveredListener = (scope: string) => void;

const listeners = new Set<AuthRecoveredListener>();

/** 订阅恢复事件；返回取消订阅函数。 */
export function subscribeAuthRecovered(listener: AuthRecoveredListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 广播一次恢复；监听器异常不得影响恢复链本身。 */
export function emitAuthRecovered(scope: string): void {
  if (!scope) return;
  for (const listener of listeners) {
    try {
      listener(scope);
    } catch {
      /* 页面级 hook 的异常不能反向打断认证恢复 */
    }
  }
}