/**
 * 共享主对话（云盘同步 active 会话）。
 *
 * 用户定案（2026-10-09）：所有入口（ChatDock / 微信 / 飞书）本就共用同一个 OH active
 * 会话；本模块把它落云盘——《OH-Memory》/_sessions/main.json（_ 前缀避开记忆检索），
 * 任何设备启动时拉取即可接着聊。
 *
 * 同步模型：chat 完成后 debounce push（export_session → 写临时文件 → seafile_upload）；
 * 启动时 pull（远端 updated_at 新于上次同步记录 → import_session 设为 active）。
 * 冲突：updated_at last-write-wins（多设备并发写会以后写覆盖，首版取舍，如实文档化）。
 */
import { invoke } from "@tauri-apps/api/core";
import { logLine } from "../lib/clients.js";
import { ensureSeafileLoaded, getSeafileToken } from "../state/seafile.js";
import { ensureMemoryRepo } from "../memory/sync.js";
import { ohRun } from "./oh.js";

const SESSION_PATH = "_sessions/main.json";
const LAST_PULL_KEY = "onethu.memory.session.lastpull.v1"; // 云端 main.json 的 updated_at

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

/** push：export active → 临时文件 → 上传 OH-Memory/_sessions/main.json */
export async function pushActiveSession(): Promise<boolean> {
  const repoId = await ensureMemoryRepo();
  const tk = await token();
  if (!repoId || !tk) return false;
  const ex = (await ohRun("export_session", "")) as { ok?: boolean; json?: string } | null;
  if (!ex?.ok || !ex.json) return false;
  const updated = (JSON.parse(ex.json) as { updated_at?: number }).updated_at ?? 0;
  if (!updated) return false;
  const localPath = await invoke<string>("im_write_text_file", {
    fileName: "main.json",
    content: ex.json,
  });
  await invoke("seafile_mkdir", { token: tk, repoId, path: "/_sessions" }).catch(() => undefined);
  await invoke("seafile_upload", {
    token: tk,
    repoId,
    parentDir: "/_sessions",
    localPath,
    replace: true,
  });
  localStorage.setItem(LAST_PULL_KEY, String(updated)); // push 后视为已同步该版本
  return true;
}

/** pull：远端较新 → import 为 active（import 会生成新 id 并设 active） */
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
  if (b64 == null) return false; // 云端还没有主对话（首次）
  const json = b64ToText(b64);
  const remote = (JSON.parse(json) as { updated_at?: number; messages?: unknown[] }).updated_at ?? 0;
  if (!remote || !Array.isArray((JSON.parse(json) as { messages?: unknown[] }).messages)) return false;
  const last = Number(localStorage.getItem(LAST_PULL_KEY) ?? 0);
  if (remote <= last) return false; // 没有更新
  const r = (await ohRun("import_session", json)) as { ok?: boolean; sessionId?: string } | null;
  if (r?.ok) {
    localStorage.setItem(LAST_PULL_KEY, String(remote));
    void logLine(`[SESSION] 主对话已从云盘恢复（${r.sessionId?.slice(0, 10)}…）`).catch(() => undefined);
    return true;
  }
  return false;
}

let pushTimer: number | null = null;
/** chat 完成后 debounce push（20s；多次对话合并一次上传） */
export function scheduleSessionPush(delayMs = 20_000): void {
  if (pushTimer) window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    pushTimer = null;
    void pushActiveSession().catch(() => undefined);
  }, delayMs);
}

/** App 就绪时的启动同步：pull（远端较新则恢复）→ push（本地有新内容则推） */
export async function sessionBootSync(): Promise<void> {
  try {
    await pullMainSession();
    await pushActiveSession();
  } catch (e) {
    void logLine(`[SESSION] 启动同步跳过：${e instanceof Error ? e.message : String(e)}`).catch(() => undefined);
  }
}
