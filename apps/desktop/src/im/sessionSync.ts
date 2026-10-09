/**
 * 共享主对话（云盘只镜像 1 号主对话 = sessions[0]，永久默认会话）。
 *
 * 设计（用户定案 2026-10-09，根治"删除后复活"）：其他会话**从不上云**——被删就是
 * 真删了；只有主对话跨设备共享。push 用 updated_at 变化检测（切到别的会话闲聊不会
 * 触发无谓上传）；pull 用 core 的 restore_main（原位替换 sessions[0]，id 稳定）。
 */
import { invoke } from "@tauri-apps/api/core";
import { logLine } from "../lib/clients.js";
import { ensureSeafileLoaded, getSeafileToken } from "../state/seafile.js";
import { ensureMemoryRepo } from "../memory/sync.js";
import { ohRun } from "./oh.js";

const SESSION_PATH = "_sessions/main.json";
const SYNCED_AT_KEY = "onethu.memory.session.syncedAt.v1";

async function token(): Promise<string | null> {
  try {
    await ensureSeafileLoaded();
    return getSeafileToken() || null;
  } catch {
    return null;
  }
}

function b64ToText(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** 主对话是否较上次同步有更新（切到别的会话闲聊不会误触上传） */
export async function pushMainSession(force = false): Promise<boolean> {
  const repoId = await ensureMemoryRepo();
  const tk = await token();
  if (!repoId || !tk) return false;
  const list = (await ohRun("list_sessions")) as { sessions?: Array<{ id: string }> } | null;
  const mainId = list?.sessions?.[0]?.id;
  if (!mainId) return false;
  const ex = (await ohRun("export_session", mainId)) as { ok?: boolean; json?: string } | null;
  if (!ex?.ok || !ex.json) return false;
  const updated = (JSON.parse(ex.json) as { updated_at?: number }).updated_at ?? 0;
  if (!updated) return false;
  const last = Number(localStorage.getItem(SYNCED_AT_KEY) ?? 0);
  if (!force && updated <= last) return false;
  const localPath = await invoke<string>("im_write_text_file", { fileName: "main.json", content: ex.json });
  await invoke("seafile_mkdir", { token: tk, repoId, path: "/_sessions" }).catch(() => undefined);
  await invoke("seafile_upload", { token: tk, repoId, parentDir: "/_sessions", localPath, replace: true });
  localStorage.setItem(SYNCED_AT_KEY, String(updated));
  return true;
}

/** 云端主对话较新 → restore_main 原位恢复（id 稳定，active 切回主对话） */
export async function pullMainSession(): Promise<boolean> {
  const repoId = await ensureMemoryRepo();
  const tk = await token();
  if (!repoId || !tk) return false;
  const b64 = await invoke<string>("seafile_read_bytes", {
    token: tk,
    repoId,
    path: `/${SESSION_PATH}`,
    maxBytes: 8 * 1024 * 1024,
  }).catch(() => null);
  if (b64 == null) return false;
  const json = b64ToText(b64);
  const parsed = JSON.parse(json) as { updated_at?: number; messages?: unknown[] };
  const remote = parsed.updated_at ?? 0;
  if (!remote || !Array.isArray(parsed.messages)) return false;
  const last = Number(localStorage.getItem(SYNCED_AT_KEY) ?? 0);
  if (remote <= last) return false;
  const r = (await ohRun("restore_main", json)) as { ok?: boolean; error?: string } | null;
  if (r?.ok) {
    localStorage.setItem(SYNCED_AT_KEY, String(remote));
    void logLine("[SESSION] 主对话已从云盘恢复（原位更新）").catch(() => undefined);
    return true;
  }
  void logLine(`[SESSION] 云盘主对话未恢复：${r?.error ?? "未知"}`).catch(() => undefined);
  return false;
}

/** 兼容旧名（oh.ts 挂钩用） */
export const pushActiveSession = pushMainSession;

let pushTimer: number | null = null;
/** chat 完成后 debounce push（20s；主对话没变化时是空操作） */
export function scheduleSessionPush(delayMs = 20_000): void {
  if (pushTimer) window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    pushTimer = null;
    void pushMainSession().catch(() => undefined);
  }, delayMs);
}

/** App 就绪：pull（云端较新则原位恢复主对话）→ push（本地主对话有新内容则上传） */
export async function sessionBootSync(): Promise<void> {
  try {
    await pullMainSession();
    await pushMainSession();
  } catch (e) {
    void logLine(`[SESSION] 启动同步跳过：${e instanceof Error ? e.message : String(e)}`).catch(() => undefined);
  }
}
