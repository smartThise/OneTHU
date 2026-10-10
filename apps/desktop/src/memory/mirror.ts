/**
 * 记忆镜像 IO：所有读写经 Rust 侧 memory_io 命令（appData/onethu-memory-mirror/
 * 白名单路径树，字节不过 WebView，原子落盘）——本文件只做路径规整与账本维护。
 *
 * 账本 `_ledger.json`（镜像根）：{ 相对路径: { sha1, modified } }，云盘同步的
 * diff 依据（本地改了哪些、远端变了哪些，全靠它对比）；写入一切记忆时同步更新。
 */
import { sha1Hex } from "./format.js";

const LEDGER_PATH = "_ledger.json";

export interface MirrorEntry {
  name: string;
  isDir: boolean;
  mtime: number;
  size: number;
}

async function io(op: string, path: string, content?: string): Promise<unknown> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("memory_io", { op, path, content });
}

/** 写镜像并返回绝对路径（push 上传需要；Rust write 原子落盘后回 path） */
export async function mWrite(path: string, content: string): Promise<string> {
  const r = (await io("write", path, content)) as { path: string };
  return r.path;
}

/** 相对路径 → 本地绝对路径（走同一白名单校验；push 上传用） */
export async function mAbspath(path: string): Promise<string> {
  const r = (await io("abspath", path)) as { path: string };
  return r.path;
}

export async function mRead(path: string): Promise<string> {
  const r = (await io("read", path)) as { content: string };
  return r.content;
}

export async function mDelete(path: string): Promise<void> {
  await io("delete", path);
}

export async function mList(path = ""): Promise<MirrorEntry[]> {
  const r = (await io("list", path)) as { entries?: MirrorEntry[] } | MirrorEntry[];
  return Array.isArray(r) ? r : (r.entries ?? []);
}

/** 该路径是否存在（列父目录判定；避免多加一个 Rust 命令） */
export async function mExists(path: string): Promise<boolean> {
  const idx = path.lastIndexOf("/");
  const parent = idx >= 0 ? path.slice(0, idx) : "";
  const name = idx >= 0 ? path.slice(idx + 1) : path;
  try {
    const entries = await mList(parent);
    return entries.some((e) => e.name === name);
  } catch {
    return false;
  }
}

/** 递归列出全部 .md（排除 _ 前缀系统文件与 .trash）；镜像规模千条内，直读可承受 */
export async function listAllNotes(dir = ""): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string): Promise<void> => {
    const entries = await mList(d);
    for (const e of entries) {
      if (e.name.startsWith("_") || e.name.startsWith(".")) continue;
      const p = d ? `${d}/${e.name}` : e.name;
      if (e.isDir) await walk(p);
      else if (e.name.endsWith(".md")) out.push(p);
    }
  };
  await walk(dir);
  return out;
}

/* ── 账本 ── */

export interface LedgerEntry {
  sha1: string;
  modified: string;
}

export async function ledgerLoad(): Promise<Record<string, LedgerEntry>> {
  try {
    const raw = await mRead(LEDGER_PATH);
    return JSON.parse(raw) as Record<string, LedgerEntry>;
  } catch {
    return {};
  }
}

export async function ledgerSave(ledger: Record<string, LedgerEntry>): Promise<void> {
  await mWrite(LEDGER_PATH, JSON.stringify(ledger, null, 2));
}

/** 记录/更新一个文件的账本项（写路径统一出口调用） */
export async function ledgerPut(path: string, content: string, modified: string): Promise<void> {
  const ledger = await ledgerLoad();
  ledger[path] = { sha1: await sha1Hex(content), modified };
  await ledgerSave(ledger);
}

export async function ledgerRemove(path: string): Promise<void> {
  const ledger = await ledgerLoad();
  if (delete ledger[path]) await ledgerSave(ledger);
}
