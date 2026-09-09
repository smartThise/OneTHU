/**
 * 邮箱状态层 —— 复用云日历的「邮箱 + 授权码」（同一个清华信息门户凭据）。
 *
 * 传输：Rust 直连（mail.rs：IMAP 993 收 / SMTP 465 发，rustls 全纯 Rust，
 * Android 可交叉编译）；列表头缓存到 state 文件（mail.cache，绕 localStorage
 * 驱逐），正文只留内存（体积大、时效短）。
 *
 * 设计：模块级单例 + 订阅广播（learn/cloudCal 同款）；已读在读取时标记，
 * 失败静默（下次刷新自然带回来）。
 */
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { fileRead, fileWrite } from "../lib/clients.js";
import { getCloudCalConfig, onCloudCalChange, ensureCloudCalLoaded } from "./cloudCal.js";

export interface MailHead {
  uid: number;
  subject: string;
  from: string;
  dateMs: number;
  seen: boolean;
}

export interface MailBody {
  subject: string;
  from: string;
  to: string;
  dateMs: number;
  text: string;
  html: string | null;
}

/** 服务器实探的文件夹（LIST：\Sent → "Sent Items"） */
export const MAIL_FOLDERS: Array<{ id: string; label: string }> = [
  { id: "INBOX", label: "收件箱" },
  { id: "Sent Items", label: "已发送" },
];

const CACHE_FILE = "mail.cache";
const FETCH_LIMIT = 50;

/* -------------- 模块级单例 -------------- */

let headsByFolder: Record<string, MailHead[]> = {};
const lastRefreshAt: Record<string, number> = {};
/** 分页游标（服务器序列号口径）：文件夹总封数 + 本批最小 seq */
const totalsByFolder: Record<string, number> = {};
const minSeqsByFolder: Record<string, number> = {};
const bodies = new Map<string, MailBody>(); // `${folder}#${uid}`，读完留内存
let loadingFolder: string | null = null;
let lastError: string | null = null;
let loaded = false;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((fn) => fn());

async function persistCache(): Promise<void> {
  await fileWrite(CACHE_FILE, JSON.stringify({ headsByFolder, totalsByFolder, minSeqsByFolder }));
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await fileRead(CACHE_FILE);
    if (raw) {
      const j = JSON.parse(raw) as { headsByFolder?: Record<string, MailHead[]>; totalsByFolder?: Record<string, number>; minSeqsByFolder?: Record<string, number> };
      if (j.headsByFolder) headsByFolder = j.headsByFolder;
      if (j.totalsByFolder) Object.assign(totalsByFolder, j.totalsByFolder);
      if (j.minSeqsByFolder) Object.assign(minSeqsByFolder, j.minSeqsByFolder);
    }
  } catch {
    /* 坏文件视作空 */
  }
  emit();
}

/** 云配置就绪后取凭据（未配置返回 null） */
async function cred(): Promise<{ email: string; auth: string } | null> {
  await Promise.all([ensureLoaded(), ensureCloudCalLoaded()]);
  const cfg = getCloudCalConfig();
  return cfg ? { email: cfg.email, auth: cfg.authCode } : null;
}

/** 拉取某文件夹最新一页（头 + 已读标记 + 分页游标） */
export async function refreshMail(folder: string): Promise<MailHead[]> {
  const c = await cred();
  if (!c) throw new Error("未配置邮箱：设置 → 云同步（邮箱与授权码）");
  loadingFolder = folder;
  lastError = null;
  emit();
  try {
    const out = await invoke<{ total: number; minSeq: number; heads: MailHead[] }>("mail_list", { email: c.email, auth: c.auth, folder, limit: FETCH_LIMIT });
    headsByFolder[folder] = out.heads;
    totalsByFolder[folder] = out.total;
    minSeqsByFolder[folder] = out.minSeq;
    lastRefreshAt[folder] = Date.now();
    await persistCache();
    return out.heads;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    loadingFolder = null;
    emit();
  }
}

/** 下一页（更旧 50 封；追加去重） */
export async function loadMoreMail(folder: string): Promise<MailHead[]> {
  const c = await cred();
  if (!c) throw new Error("未配置邮箱：设置 → 云同步（邮箱与授权码）");
  const before = minSeqsByFolder[folder];
  if (!before || before <= 1) return headsByFolder[folder] ?? [];
  loadingFolder = folder;
  lastError = null;
  emit();
  try {
    const out = await invoke<{ total: number; minSeq: number; heads: MailHead[] }>("mail_list", { email: c.email, auth: c.auth, folder, limit: FETCH_LIMIT, beforeSeq: before });
    const seen = new Set((headsByFolder[folder] ?? []).map((h) => h.uid));
    headsByFolder[folder] = [...(headsByFolder[folder] ?? []), ...out.heads.filter((h) => !seen.has(h.uid))];
    totalsByFolder[folder] = out.total;
    minSeqsByFolder[folder] = out.minSeq;
    await persistCache();
    return out.heads;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    loadingFolder = null;
    emit();
  }
}

/** 读一封（正文内存缓存；顺带标已读，失败静默） */
export async function readMail(folder: string, uid: number): Promise<MailBody> {
  const key = `${folder}#${uid}`;
  const cached = bodies.get(key);
  if (cached) return cached;
  const c = await cred();
  if (!c) throw new Error("未配置邮箱：设置 → 云同步（邮箱与授权码）");
  const body = await invoke<MailBody>("mail_read", { email: c.email, auth: c.auth, folder, uid });
  if (bodies.size > 24) bodies.clear(); // 简单防涨：超 24 封清空重来
  bodies.set(key, body);
  void invoke("mail_mark_seen", { email: c.email, auth: c.auth, folder, uid })
    .then(() => {
      const h = headsByFolder[folder]?.find((x) => x.uid === uid);
      if (h && !h.seen) {
        h.seen = true;
        emit();
        void persistCache();
      }
    })
    .catch(() => {
      /* 下次列表自然带回来 */
    });
  return body;
}

/** 文件夹总封数（OH 门面 mail.list 返回给 harness 用；无游标时回退列表长度） */
export function mailFolderTotal(folder: string): number {
  return totalsByFolder[folder] ?? (headsByFolder[folder] ?? []).length;
}

/** 单封邮件头（原子解析用；缓存冷时 null） */
export function getMailHead(folder: string, uid: number): MailHead | null {
  return headsByFolder[folder]?.find((h) => h.uid === uid) ?? null;
}

/** 全箱搜索（IMAP 服务端 SUBJECT OR FROM；Enter 触发，非本地过滤） */
export async function mailSearch(folder: string, query: string): Promise<MailHead[]> {
  const c = await cred();
  if (!c) throw new Error("未配置邮箱：设置 → 云同步（邮箱与授权码）");
  return invoke<MailHead[]>("mail_search", { email: c.email, auth: c.auth, folder, query, limit: 30 });
}

/** 发信（to/cc 支持逗号、分号、空白混排多址） */
export async function sendMail(to: string, cc: string, subject: string, body: string): Promise<void> {
  const c = await cred();
  if (!c) throw new Error("未配置邮箱：设置 → 云同步（邮箱与授权码）");
  const tos = to.split(/[,;\s]+/).filter(Boolean);
  const ccs = cc.split(/[,;\s]+/).filter(Boolean);
  if (tos.length === 0) throw new Error("收件人不能为空");
  await invoke("mail_send", { args: { email: c.email, auth: c.auth, to: tos, cc: ccs, subject, body } });
}

/* -------------- Hooks -------------- */

export interface MailState {
  configured: boolean;
  email: string | null;
  heads: MailHead[];
  unread: number;
  /** 文件夹总封数（服务器口径；列表底部分页条显示用） */
  total: number;
  /** 还有更旧的可翻页 */
  canMore: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
}

export function useMail(folder: string): MailState {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = (): void => bump((n) => n + 1);
    listeners.add(fn);
    onCloudCalChange(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  const refresh = useCallback(async (): Promise<void> => {
    await refreshMail(folder).catch(() => {});
  }, [folder]);
  const loadMore = useCallback(async (): Promise<void> => {
    await loadMoreMail(folder).catch(() => {});
  }, [folder]);
  // 挂载 + 切文件夹：配置就绪且（无缓存或超过 3 分钟）时自动拉
  useEffect(() => {
    let alive = true;
    void (async () => {
      const c = await cred();
      if (!alive || !c) return;
      const cached = headsByFolder[folder];
      // 旧缓存无分页游标（total 缺失）也视作不新鲜：补一次拉取拿到游标
      const fresh = cached && (lastRefreshAt[folder] ?? 0) > Date.now() - 180_000 && totalsByFolder[folder] !== undefined;
      if (!cached || !fresh) await refreshMail(folder).catch(() => {});
    })();
    return () => {
      alive = false;
    };
  }, [folder]);
  const cfg = getCloudCalConfig();
  const heads = headsByFolder[folder] ?? [];
  const total = totalsByFolder[folder] ?? heads.length;
  const minSeq = minSeqsByFolder[folder];
  return {
    configured: cfg !== null,
    email: cfg?.email ?? null,
    heads,
    unread: heads.filter((h) => !h.seen).length,
    total,
    canMore: minSeq !== undefined && minSeq > 1 && heads.length < total,
    loading: loadingFolder === folder,
    error: lastError,
    refresh,
    loadMore,
  };
}


/** 全部文件夹的未读数（folder chips 用，避免 map 里调 hook） */
export function useMailCounts(): Record<string, number> {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = (): void => bump((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  const out: Record<string, number> = {};
  for (const f of MAIL_FOLDERS) out[f.id] = (headsByFolder[f.id] ?? []).filter((h) => !h.seen).length;
  return out;
}

export function useMailBody(folder: string, uid: number | null): { body: MailBody | null; loading: boolean; error: string | null } {
  const [body, setBody] = useState<MailBody | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (uid === null) {
      setBody(null);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    readMail(folder, uid)
      .then((b) => {
        if (alive) setBody(b);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [folder, uid]);
  return { body, loading, error };
}
