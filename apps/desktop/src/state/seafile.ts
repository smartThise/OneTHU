/**
 * 清华云盘（Seafile）状态层。
 *
 * 认证：用户在 https://cloud.tsinghua.edu.cn/profile/#get-auth-token 生成的
 * Web API Token（一次性），XOR 混淆落 seafile.cfg.json（同 caldav 邮箱授权码模式）。
 * 数据：资料库 + 目录列表为内存缓存（不落盘——云盘内容大且变化快，每次进页刷新）。
 */
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { fileRead, fileWrite, fileDelete, obfuscateSecret, deobfuscateSecret } from "../lib/clients.js";
import { showToast } from "./toast.js";

const CFG_FILE = "seafile.cfg.json";
/** 混淆密钥绑定词（token 属于云盘本身，不需要用户名绑定） */
const KEY_ID = "seafile";

export interface SeafileRepo { id: string; name: string; mtime: number; size: number }
export interface SeafileEntry { name: string; kind: "dir" | "file"; size: number; mtime: number }
export interface SeafileAccount { name: string; email: string; usage: number; total: number }

/* ── token 配置 ── */
let cfg: { token: string } | null = null;
let loaded = false;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((fn) => fn());

async function persistCfg(): Promise<void> {
  if (!cfg || !cfg.token) {
    await fileDelete(CFG_FILE);
    return;
  }
  await fileWrite(CFG_FILE, JSON.stringify({ secret: obfuscateSecret(cfg.token, KEY_ID) }));
}

export async function ensureSeafileLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await fileRead(CFG_FILE);
    if (raw) {
      const j = JSON.parse(raw) as { secret?: string };
      if (j.secret) cfg = { token: deobfuscateSecret(j.secret, KEY_ID) ?? "" };
    }
  } catch {
    /* 坏文件视作未配置 */
  }
}

/** 配置 token（先调 seafile_account 校验，通过才落盘） */
export async function setSeafileToken(token: string): Promise<SeafileAccount> {
  const account = await invoke<SeafileAccount>("seafile_account", { token });
  cfg = { token };
  await persistCfg();
  emit();
  return account;
}

export async function clearSeafileToken(): Promise<void> {
  cfg = null;
  account = null;
  repos = [];
  emit();
  await persistCfg();
}

export function getSeafileToken(): string {
  return cfg?.token ?? "";
}

/* ── 数据面（内存缓存） ── */
let account: SeafileAccount | null = null;
let repos: SeafileRepo[] = [];
let dirs = new Map<string, SeafileEntry[]>(); // key: repoId + "|" + path
let busy = false;
let lastError: string | null = null;

/** 账号信息（含配额）——进页刷新一次 */
export async function refreshSeafileAccount(): Promise<void> {
  if (!cfg) return;
  account = await invoke<SeafileAccount>("seafile_account", { token: cfg.token });
  emit();
}

export async function refreshRepos(): Promise<void> {
  if (!cfg) return;
  busy = true;
  lastError = null;
  emit();
  try {
    repos = await invoke<SeafileRepo[]>("seafile_repos", { token: cfg.token });
  } catch (e) {
    lastError = String(e);
  } finally {
    busy = false;
    emit();
  }
}

/** 目录列表（缓存优先，force 强刷） */
export async function openDir(repoId: string, path: string, force = false): Promise<SeafileEntry[]> {
  const key = `${repoId}|${path}`;
  if (!force && dirs.has(key)) return dirs.get(key)!;
  if (!cfg) return [];
  const entries = await invoke<SeafileEntry[]>("seafile_dir", { token: cfg.token, repoId, path });
  dirs.set(key, entries);
  emit();
  return entries;
}

export async function seafileDownload(repoId: string, path: string): Promise<string> {
  if (!cfg) throw new Error("云盘未配置");
  const local = await invoke<string>("seafile_download", { token: cfg.token, repoId, path });
  showToast(`已下载到 Downloads/${local.split("/").pop()}`);
  return local;
}

export async function seafileUpload(repoId: string, parentDir: string, localPath: string, replace: boolean): Promise<void> {
  if (!cfg) throw new Error("云盘未配置");
  await invoke("seafile_upload", { token: cfg.token, repoId, parentDir, localPath, replace });
  await openDir(repoId, parentDir, true);
  showToast("已上传到云盘");
}

export async function seafileShare(repoId: string, path: string, expireDays: number): Promise<string> {
  if (!cfg) throw new Error("云盘未配置");
  const r = await invoke<{ link: string }>("seafile_share", { token: cfg.token, repoId, path, expireDays, password: "" });
  return r.link;
}

export async function seafileSearch(repoId: string, query: string): Promise<SeafileEntry[]> {
  if (!cfg) throw new Error("云盘未配置");
  return invoke<SeafileEntry[]>("seafile_search", { token: cfg.token, repoId, query });
}

/* ── hooks ── */

export function useSeafile() {
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => tick((n) => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return {
    configured: !!cfg?.token,
    account,
    repos,
    busy,
    lastError,
  };
}

/** 单目录订阅（进目录拉取） */
export function useSeafileDir(repoId: string | null, path: string | null) {
  const [, tick] = useState(0);
  const [state, setState] = useState<{ loading: boolean; entries: SeafileEntry[]; error: string | null }>({
    loading: false,
    entries: [],
    error: null,
  });
  useEffect(() => {
    if (!repoId || !path) return;
    const fn = () => tick((n) => n + 1);
    listeners.add(fn);
    setState((s) => ({ ...s, loading: true, error: null }));
    openDir(repoId!, path!)
      .then((entries) => setState({ loading: false, entries, error: null }))
      .catch((e) => setState({ loading: false, entries: [], error: String(e) }));
    return () => { listeners.delete(fn); };
  }, [repoId, path]);
  return state;
}
