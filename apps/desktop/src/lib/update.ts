/**
 * 版本更新检测：GitHub Releases。
 * - 数据源 api.github.com/repos/smartThise/OneTHU/releases/latest（经 Rust
 *   http_request 通道，无 CORS 问题；GitHub API 要求 User-Agent，已带）
 * - 启动：Shell 挂载后静默检查——有新版本且未被忽略 → toast 一次
 * - 设置页「关于」：手动检查 + 当前/最新版本展示 + 查看/忽略
 * - 忽略语义：记 tag 名；该版本不再 toast（下个版本发布后自然恢复提醒）
 */
import { universalFetch } from "./transport.js";

/** 版本代号（随主版本更新） */
export const APP_CODENAME = "Fishman";

declare const __APP_VERSION__: string;

export interface ReleaseInfo {
  tag: string;
  name: string;
  url: string;
  notes: string;
  publishedAt: string;
}

const LS_DISMISSED = "onethu.update.dismissed";
const API = "https://api.github.com/repos/smartThise/OneTHU/releases/latest";

/** "v0.9.1"/"0.9.1-beta" → [0,9,1]（取前三段数字） */
function toTuple(v: string): number[] {
  return v
    .replace(/^[vV]/, "")
    .split(/[.\-+]/)
    .slice(0, 3)
    .map((x) => parseInt(x, 10) || 0);
}

export function isNewer(latest: string, current: string): boolean {
  const a = toTuple(latest);
  const b = toTuple(current);
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/** 当前应用版本（构建期由 package.json 注入） */
export function currentVersion(): string {
  return __APP_VERSION__;
}

export async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  try {
    const res = await universalFetch(API, {
      method: "GET",
      headers: { "User-Agent": "OneTHU-UpdateCheck", "Accept": "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      tag_name?: string;
      name?: string;
      html_url?: string;
      body?: string;
      published_at?: string;
    };
    if (!j.tag_name || !j.html_url) return null;
    return {
      tag: j.tag_name,
      name: j.name ?? j.tag_name,
      url: j.html_url,
      notes: j.body ?? "",
      publishedAt: j.published_at ?? "",
    };
  } catch {
    return null;
  }
}

export function isDismissed(tag: string): boolean {
  try {
    return localStorage.getItem(LS_DISMISSED) === tag;
  } catch {
    return false;
  }
}

export function dismissTag(tag: string): void {
  try {
    localStorage.setItem(LS_DISMISSED, tag);
  } catch {
    /* 存储不可用：忽略 */
  }
}

/** 启动静默检查：有新版且未忽略 → toast 提示一次 */
export async function checkUpdateSilently(onToast: (msg: string) => void): Promise<void> {
  const rel = await fetchLatestRelease();
  if (!rel) return;
  if (!isNewer(rel.tag, currentVersion())) return;
  if (isDismissed(rel.tag)) return;
  onToast(`新版本 ${rel.name} 可用：设置 → 关于 查看详情`);
}
