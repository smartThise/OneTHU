/** 光学边缘折射开关（与毛玻璃材质分离）。
 *
 * 玻璃模式（clear/deep/rich）下才有意义；balanced 是无玻璃中性面，开关禁用。
 * 默认关闭（高成本可选）；关闭时只释放 OneGUI 的折射 lens，
 * backdrop 的普通 blur/saturate 毛玻璃保留。
 */
const KEY = "onethu.glass.refraction";

function normalize(v: string | null): boolean {
  return v === "1"; // 默认关闭；光学折射是可选的高成本效果
}

export function getOpticalRefraction(): boolean {
  try {
    return normalize(localStorage.getItem(KEY));
  } catch {
    return false;
  }
}

export function setOpticalRefraction(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* 存不进就本次有效 */
  }
  applyOpticalRefraction(on);
  for (const fn of listeners) fn();
}

export function applyOpticalRefraction(on: boolean): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.ogOptics = on ? "on" : "off";
}

/** 启动钩子：在 installOneGUI 前落属性，pipeline 首帧就能读到。 */
export function initOpticalRefraction(): void {
  applyOpticalRefraction(getOpticalRefraction());
}

const listeners = new Set<() => void>();
export function subscribeOpticalRefraction(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
