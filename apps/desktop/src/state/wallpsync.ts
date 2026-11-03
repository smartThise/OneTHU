import { t as i18n } from "../i18n/index.js";
/**
 * 壁纸云盘同步（清华云盘「OneTHU/壁纸」，2026-10-13）。
 *
 * 落点定案（与 memory/sync.ts 的《OH-Memory》同款模式）：专用资料库《OneTHU》没有就
 * 自动建（seafile_create_repo，建完按名复查），库内固定目录 /壁纸，档案固定
 * onethu-wallpaper-v3.json（恢复兼容旧文件）——用户视角即云盘里的「OneTHU/壁纸」。repo id 按
 * onethu.wallpaper.repo.v1 缓存，失效后按名自愈。
 *
 * 档案 v3 内嵌去重后的图片/视频字节，不包含设备路径；恢复先验证档案，再保存到
 * 当前设备壁纸目录，全部完成后替换文档。上传直接传内存文本，不生成临时文件，
 * 下载走 seafile_read_bytes（内存 base64，不落盘不弹下载目录）。
 * 云盘未连接直接给可操作文案；其余失败不静默吞——toast 说明并请用户重试。
 * 声音开关是本机偏好，不随档案同步。
 */
import { invoke } from "@tauri-apps/api/core";
import { ensureOwnedCloudRepo, findOwnedCloudRepo } from "../lib/ownedCloudRepo.js";
import { shrinkWallpaperForCloud } from "../lib/cloudWallpaperImage.js";
import { ensureSeafileLoaded, getSeafileToken, getSeafileCredentialVersion, type SeafileEntry } from "./seafile.js";
import { replaceWallpaperDoc, wallpaperSnapshot } from "./wallpaper.js";
import { exportWallpaperArchive, importWallpaperArchive, WALLPAPER_ARCHIVE_MAX_BYTES } from "./wallpArchive.js";

const REPO_NAME = "OneTHU";
const DIR = "/壁纸";
const FILE = "onethu-wallpaper-v3.json";
const LEGACY_FILE = "onethu-wallpaper.json";
const REPO_KEY = "onethu.wallpaper.repo.v1";

export interface WallpSyncResult {
  ok: boolean;
  msg: string;
}

async function cloudToken(): Promise<string | null> {
  try {
    await ensureSeafileLoaded();
  } catch {
    /* 配置读不到 = 未连接 */
  }
  return getSeafileToken() || null;
}

/** 找到（或建出）《OneTHU》资料库；建库响应形态不一，建后无论如何按名复查 */
async function resolveRepo(tk: string, create: boolean): Promise<string | null> {
  let cached: string | undefined;
  try { cached = localStorage.getItem(REPO_KEY) ?? undefined; } catch { /* Optional cache. */ }
  const repo = await (create ? ensureOwnedCloudRepo(tk, REPO_NAME, cached) : findOwnedCloudRepo(tk, REPO_NAME, cached));
  if (tk !== getSeafileToken()) throw new Error(i18n("state.seafile.accountChanged"));
  if (!repo) return null;
  try { localStorage.setItem(REPO_KEY, repo.id); } catch { /* Optional cache. */ }
  return repo.id;
}

function accountGuard(token: string): () => void {
  const version = getSeafileCredentialVersion();
  return () => {
    if (token !== getSeafileToken() || version !== getSeafileCredentialVersion()) {
      throw new Error(i18n("state.seafile.accountChanged"));
    }
  };
}

function errorMessage(error: unknown, fallback: "state.wallpsync.uploadFailed" | "state.wallpsync.restoreFailed"): string {
  if (error instanceof SyntaxError) return i18n("state.wallpsync.invalidArchive");
  const raw = shortErr(error);
  if (/wallpaper-legacy-local-archive/.test(raw)) return i18n("state.wallpsync.legacyLocalArchive");
  if (/wallpaper-archive-too-large|文件过大|壁纸文件超过|wallpaper_archive_too_large/.test(raw)) return i18n("state.wallpsync.ab4ead4cd60b");
  if (/wallpaper-invalid-archive/.test(raw)) return i18n("state.wallpsync.invalidArchive");
  if (/HTTP\s*403\b|permission.*(?:denied|access)|forbidden/i.test(raw)) return i18n("state.wallpsync.permissionDenied");
  return fallback === "state.wallpsync.uploadFailed"
    ? i18n("state.wallpsync.uploadFailed", { error: raw })
    : i18n("state.wallpsync.restoreFailed", { error: raw });
}

function b64ToText(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** 上传整份壁纸文档到云盘「OneTHU/壁纸/onethu-wallpaper-v3.json」（replace 覆写） */
export async function syncWallpaperToCloud(): Promise<WallpSyncResult> {
  const tk = await cloudToken();
  if (!tk) return { ok: false, msg: i18n("state.wallpsync.connectBeforeUpload") };
  const assertCurrent = accountGuard(tk);
  try {
    const archive = await exportWallpaperArchive(wallpaperSnapshot(), async path => {
      assertCurrent();
      return invoke<string>("wallpaper_read", { path });
    }, { shrink: shrinkWallpaperForCloud });
    assertCurrent();
    const json = JSON.stringify(archive);
    if (new TextEncoder().encode(json).length > WALLPAPER_ARCHIVE_MAX_BYTES) throw new Error("wallpaper-archive-too-large");
    const repoId = await resolveRepo(tk, true);
    assertCurrent();
    await invoke("seafile_mkdir", { token: tk, repoId, path: DIR }).catch(() => undefined);
    assertCurrent();
    await invoke("seafile_upload_wallpaper", { token: tk, repoId, content: json });
    assertCurrent();
    return { ok: true, msg: i18n("state.wallpsync.uploaded") };
  } catch (e) {
    return { ok: false, msg: errorMessage(e, "state.wallpsync.uploadFailed") };
  }
}

/** 从云盘下载档案并整档应用（覆盖本地的壁纸与库） */
export async function restoreWallpaperFromCloud(): Promise<WallpSyncResult> {
  const tk = await cloudToken();
  if (!tk) return { ok: false, msg: i18n("state.wallpsync.connectBeforeRestore") };
  const assertCurrent = accountGuard(tk);
  const before = wallpaperSnapshot();
  const created: string[] = [];
  try {
    const repoId = await resolveRepo(tk, false);
    assertCurrent();
    if (!repoId) return { ok: false, msg: i18n("state.wallpsync.noArchive") };
    // The school can answer a missing file with 403. Establish existence by
    // listing its parent, while keeping a real permission error distinguishable.
    const root = await invoke<SeafileEntry[]>("seafile_dir", { token: tk, repoId, path: "/" });
    assertCurrent();
    if (!root.some(row => row.kind === "dir" && row.name === DIR.slice(1))) return { ok: false, msg: i18n("state.wallpsync.noArchive") };
    const entries = await invoke<SeafileEntry[]>("seafile_dir", { token: tk, repoId, path: DIR });
    assertCurrent();
    const file = entries.find(row => row.kind === "file" && row.name === FILE)
      ?? entries.find(row => row.kind === "file" && row.name === LEGACY_FILE);
    if (!file) return { ok: false, msg: i18n("state.wallpsync.noArchive") };
    if (file.size > WALLPAPER_ARCHIVE_MAX_BYTES) throw new Error("wallpaper-archive-too-large");
    const b64 = await invoke<string>("seafile_read_bytes", {
      token: tk,
      repoId,
      path: `${DIR}/${file.name}`,
      maxBytes: WALLPAPER_ARCHIVE_MAX_BYTES,
    });
    assertCurrent();
    const parsed: unknown = JSON.parse(b64ToText(b64));
    const restored = await importWallpaperArchive(parsed, async (dataBase64, ext) => {
      assertCurrent();
      const path = await invoke<string>("wallpaper_save", { name: `restore-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`, dataBase64 });
      created.push(path);
      assertCurrent();
      return path;
    });
    assertCurrent();
    if (wallpaperSnapshot() !== before) throw new Error(i18n("state.wallpsync.changedLocally"));
    if (!replaceWallpaperDoc(restored)) throw new Error("wallpaper-invalid-archive");
    return { ok: true, msg: i18n("state.wallpsync.restored") };
  } catch (e) {
    await Promise.allSettled(created.map(path => invoke("wallpaper_delete", { path })));
    const raw = shortErr(e);
    if (/404|不存在|not found/i.test(raw)) {
      return { ok: false, msg: i18n("state.wallpsync.noArchive") };
    }
    return { ok: false, msg: errorMessage(e, "state.wallpsync.restoreFailed") };
  }
}

function shortErr(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  return s.replace(/\s+/g, " ").slice(0, 60) || i18n("state.wallpsync.unknownCause");
}
