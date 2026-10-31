/**
 * 下载偏好（设备本地）——当前用于「应用内更新」多线程分段下载的线程数。
 *
 * 这里只做**纯读取/归一化**，不碰原生、不弹 UI：
 * - 更新下载（`lib/updater.ts` → `updater_download`）读这里；
 * - 设置 → 下载页（`pages/Settings.tsx` 的 DownloadSettings）写这里；
 * - 后续附件/云盘下载可以直接复用 `readDownloadThreads()`，避免再写一份 localStorage 键。
 *
 * 默认 8：GitHub / 清华云盘实测都支持 Range，8 线程在校园网里收益明显又不至于被限流；
 * 用户在弱网或限制并发连接的网络里可以往低调（1 = 单流），也可以调到 16。
 */

export const DOWNLOAD_THREADS_KEY = "onethu.download.threads";
export const DEFAULT_DOWNLOAD_THREADS = 8;
/** 设置页允许的档位；原生侧同样把 1..=16 夹紧，越界不会出错。 */
export const DOWNLOAD_THREAD_OPTIONS = [1, 2, 4, 6, 8, 12, 16] as const;
export const MIN_DOWNLOAD_THREADS = 1;
export const MAX_DOWNLOAD_THREADS = 16;

/** 任意输入 → 合法线程数（非法值回落默认 8，不抛错）。 */
export function normalizeDownloadThreads(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_DOWNLOAD_THREADS;
  return Math.min(MAX_DOWNLOAD_THREADS, Math.max(MIN_DOWNLOAD_THREADS, Math.round(parsed)));
}

/** 读当前偏好；localStorage 不可用（隐私模式 / 非浏览器环境）时回落默认值。 */
export function readDownloadThreads(): number {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(DOWNLOAD_THREADS_KEY);
    return normalizeDownloadThreads(raw);
  } catch {
    return DEFAULT_DOWNLOAD_THREADS;
  }
}

/** 写偏好并返回归一化后的值（UI 以返回值为准，避免存进去的和显示的不一致）。 */
export function writeDownloadThreads(value: unknown): number {
  const threads = normalizeDownloadThreads(value);
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(DOWNLOAD_THREADS_KEY, String(threads));
  } catch {
    /* 存储不可用：本次会话继续用内存里的值。 */
  }
  return threads;
}

/** 设置页 Select 的选项（数字保持机器可读，文案由页面本地化）。 */
export function downloadThreadChoices(): number[] {
  return [...DOWNLOAD_THREAD_OPTIONS];
}
