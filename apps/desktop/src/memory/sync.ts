/**
 * OH 记忆云盘同步（OH-Memory 资料库）。
 *
 * 存储位置（用户定案 2026-10-09）：清华云盘专用资料库《OH-Memory》——
 * **没有就自动建**（seafile_create_repo），多端共用一棵 markdown 树。
 *
 * 同步模型（首版，贴 docs/memory-cloud/03 的简化）：
 * - pull：递归列远端 .md → 本地缺失或远端 mtime 比上次记录新 → 下载覆盖本地镜像 + 刷新账本；
 * - push：本地账本里 sha1 与「上次同步快照」不同的文件 → mkdir -p → seafile_upload(replace)；
 * - 冲突：首版信任远端较新（单用户多端场景低风险）；双向同时改的丢更新风险文档明示；
 * - 触发：App 就绪后 ensure+pull；每次记忆写操作后 debounce push（15s）。
 * 云盘未连接时全部静默降级（本地记忆照常可用，绝不阻塞对话）。
 */
import { invoke } from "@tauri-apps/api/core";
import { logLine } from "../lib/clients.js";
import { ensureSeafileLoaded, getSeafileToken } from "../state/seafile.js";
import { ledgerLoad, ledgerPut, listAllNotes } from "./mirror.js";
import { sha1Hex } from "./format.js";

const REPO_NAME = "OH-Memory";
const REPO_KEY = "onethu.memory.repo.v1";
const SNAP_KEY = "onethu.memory.snap.v1"; // path -> {sha1, remoteMtime}

async function token(): Promise<string | null> {
  try {
    await ensureSeafileLoaded();
    return getSeafileToken() || null;
  } catch {
    return null;
  }
}

/** 确保 OH-Memory 资料库存在（找到或新建），返回 repoId；云盘未连接返回 null */
export async function ensureMemoryRepo(): Promise<string | null> {
  const cached = localStorage.getItem(REPO_KEY);
  if (cached) return cached;
  const tk = await token();
  if (!tk) return null;
  const repos = await invoke<Array<{ id: string; name: string }>>("seafile_repos", { token: tk });
  const hit = repos.find((r) => r.name === REPO_NAME);
  const repo = hit ?? (await invoke<{ id: string; name: string }>("seafile_create_repo", { token: tk, name: REPO_NAME }));
  localStorage.setItem(REPO_KEY, repo.id);
  void logLine(`[MEMORY] 云盘记忆库就绪：《${repo.name}》(${repo.id.slice(0, 8)}…)`).catch(() => undefined);
  return repo.id;
}

function snap(): Record<string, { sha1: string; remoteMtime: number }> {
  try {
    return JSON.parse(localStorage.getItem(SNAP_KEY) ?? "{}") as Record<string, { sha1: string; remoteMtime: number }>;
  } catch {
    return {};
  }
}
function saveSnap(s: Record<string, { sha1: string; remoteMtime: number }>): void {
  try {
    localStorage.setItem(SNAP_KEY, JSON.stringify(s));
  } catch {
    /* 存不进不影响本次 */
  }
}

function b64ToText(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** 递归列远端全部 .md（排除 _ 前缀系统文件与 .trash） */
async function listRemote(tk: string, repoId: string): Promise<Array<{ path: string; mtime: number }>> {
  const out: Array<{ path: string; mtime: number }> = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await invoke<Array<{ name: string; kind: string; mtime: number }>>("seafile_dir", {
      token: tk,
      repoId,
      path: dir,
    });
    for (const e of entries) {
      if (e.name.startsWith("_") || e.name.startsWith(".")) continue;
      const p = dir === "/" ? `/${e.name}` : `${dir}/${e.name}`;
      if (e.kind === "dir") await walk(p);
      else if (e.name.endsWith(".md")) out.push({ path: p.slice(1), mtime: e.mtime }); // 镜像相对路径无前导 /
    }
  };
  await walk("/");
  return out;
}

/** 拉取：远端较新/本地缺失 → 覆盖本地（信任远端）→ 刷新账本 */
export async function memoryPull(): Promise<number> {
  const repoId = await ensureMemoryRepo();
  const tk = await token();
  if (!repoId || !tk) return -1;
  const { mRead, mWrite } = await import("./mirror.js");
  const st = snap();
  const remote = await listRemote(tk, repoId);
  let pulled = 0;
  for (const f of remote) {
    const seen = st[f.path];
    if (seen && seen.remoteMtime >= f.mtime) continue; // 没变
    const b64 = await invoke<string>("seafile_read_bytes", {
      token: tk,
      repoId,
      path: `/${f.path}`,
      maxBytes: 4 * 1024 * 1024,
    }).catch(() => null);
    if (b64 == null) continue;
    const text = b64ToText(b64);
    await mWrite(f.path, text);
    await ledgerPut(f.path, text, new Date(f.mtime * 1000).toISOString());
    st[f.path] = { sha1: await sha1Hex(text), remoteMtime: f.mtime };
    pulled++;
  }
  if (pulled > 0) {
    saveSnap(st);
    void logLine(`[MEMORY] pull 完成：${pulled} 条来自云盘《${REPO_NAME}》`).catch(() => undefined);
  }
  return pulled;
}

/** 推送：本地账本与快照 sha1 不同的文件 → mkdir -p → 上传（replace） */
export async function memoryPush(): Promise<number> {
  const repoId = await ensureMemoryRepo();
  const tk = await token();
  if (!repoId || !tk) return -1;
  const { mAbspath, mRead } = await import("./mirror.js");
  const st = snap();
  const paths = await listAllNotes();
  let pushed = 0;
  for (const p of paths) {
    const raw = await mRead(p).catch(() => null);
    if (raw == null) continue;
    const sha = await sha1Hex(raw);
    if (st[p]?.sha1 === sha) continue; // 没变
    const localPath = await mAbspath(p);
    const parent = p.includes("/") ? `/${p.slice(0, p.lastIndexOf("/"))}` : "/";
    // mkdir -p（逐级）
    let cur = "";
    for (const seg of parent.split("/").filter(Boolean)) {
      cur += `/${seg}`;
      await invoke("seafile_mkdir", { token: tk, repoId, path: cur }).catch(() => undefined);
    }
    await invoke("seafile_upload", {
      token: tk,
      repoId,
      parentDir: parent,
      localPath,
      replace: true,
    });
    st[p] = { sha1: sha, remoteMtime: Math.floor(Date.now() / 1000) };
    pushed++;
  }
  saveSnap(st);
  if (pushed > 0) void logLine(`[MEMORY] push 完成：${pushed} 条上云盘《${REPO_NAME}》`).catch(() => undefined);
  return pushed;
}

/* ── 写后 debounce push（多端共享的低延迟收敛） ── */
let pushTimer: number | null = null;
export function scheduleMemoryPush(delayMs = 15_000): void {
  if (pushTimer) window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    pushTimer = null;
    void memoryPush().catch(() => undefined);
  }, delayMs);
}

/** App 就绪时的启动同步：ensure → pull →（有本地新东西则顺带 push 一次） */
export async function memoryBootSync(): Promise<void> {
  try {
    await memoryPull();
    await memoryPush();
  } catch (e) {
    void logLine(`[MEMORY] 启动同步跳过：${e instanceof Error ? e.message : String(e)}`).catch(() => undefined);
  }
}
