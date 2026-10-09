/**
 * 记忆操作（工具契约见 docs/memory-cloud/01 §6，与 facade/未来 harness 工具一一对应）：
 *   memory_search / read / list（只读，memory:read）
 *   memory_write / append / edit / delete / refresh（写，memory:write，写操作走 confirm 流）
 *
 * 纪律：
 *   · 黑名单先行（引擎层硬拦凭据类内容，提示词之外的最后一道闸）；
 *   · permalink 全局唯一且稳定（同 title + 本机 salt 生成；重复 title 拒绝新建，引导 append）；
 *   · 时间一律 +08:00（云端容器可能是 UTC，绝不写裸本地时间）；
 *   · delete 是软删（.trash/ 归档），首版不依赖云盘硬删端点。
 */
import {
  genPermalink, memoryBlacklist, parseNote, renderNote, safeFileName,
  type MemoryNote, type Observation, type Relation,
} from "./format.js";
import { invalidateCache, searchMemory, type SearchHit } from "./search.js";
import { ledgerLoad, ledgerPut, ledgerRemove, listAllNotes, mDelete, mRead, mWrite, mWrite as _w, mList } from "./mirror.js";

export type { SearchHit };

const FOLDER_BY_TYPE: Record<string, string> = {
  preference: "preferences",
  course: "courses",
  task: "tasks",
  fact: "knowledge",
  note: "knowledge",
  journal: "journal",
};

const SALT_KEY = "onethu.memory.salt";

function salt(): string {
  let s = localStorage.getItem(SALT_KEY);
  if (!s) {
    const r = new Uint8Array(8);
    crypto.getRandomValues(r);
    s = Array.from(r, (b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(SALT_KEY, s);
  }
  return s;
}

function nowIso(): string {
  // 北京时间墙上时间（+08:00），与机器时区无关
  const t = new Date(Date.now() + 8 * 3600_000);
  return t.toISOString().slice(0, 19) + "+08:00";
}

async function findByPermalink(permalink: string): Promise<{ path: string; note: MemoryNote; raw: string } | null> {
  for (const path of await listAllNotes()) {
    try {
      const raw = await mRead(path);
      const note = parseNote(raw);
      if (note && note.permalink === permalink) return { path, note, raw };
    } catch {
      /* 跳过坏文件 */
    }
  }
  return null;
}

/** 引擎层黑名单检查（content 为组装后的全部文本） */
function guard(...parts: string[]): void {
  for (const p of parts) {
    const bad = memoryBlacklist(p);
    if (bad) throw new Error(`记忆写入被拦截：${bad}——凭据类内容不允许进入长期记忆`);
  }
}

/* ── 只读 ── */

export async function memorySearch(q: { query?: string; tags?: string[]; type?: string; folder?: string; limit?: number }): Promise<SearchHit[]> {
  return searchMemory(q);
}

export async function memoryRead(permalink: string): Promise<string> {
  const hit = await findByPermalink(permalink);
  if (!hit) throw new Error(`未找到记忆：${permalink}`);
  const LIMIT = 8 * 1024;
  return hit.raw.length > LIMIT ? hit.raw.slice(0, LIMIT) + "\n\n…（超 8KB 截断）" : hit.raw;
}

export interface MemoryListItem {
  permalink: string;
  title: string;
  type: string;
  folder: string;
  tags: string[];
  modified: string;
}

export async function memoryList(opts: { folder?: string; tag?: string } = {}): Promise<MemoryListItem[]> {
  const out: MemoryListItem[] = [];
  for (const path of await listAllNotes()) {
    if (opts.folder && !path.startsWith(opts.folder.replace(/^\/+/, ""))) continue;
    try {
      const note = parseNote(await mRead(path));
      if (!note) continue;
      if (opts.tag && !note.tags.includes(opts.tag)) continue;
      const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      out.push({ permalink: note.permalink, title: note.title, type: note.type, folder, tags: note.tags, modified: note.modified });
    } catch {
      /* 跳过 */
    }
  }
  out.sort((a, b) => (a.modified < b.modified ? 1 : -1));
  return out;
}

/* ── 写（confirm 流由上层工具包装负责） ── */

export interface MemoryWriteInput {
  title: string;
  observations: Array<{ category: string; text: string; context?: string }>;
  relations?: Array<{ rel: string; target: string; context?: string }>;
  tags?: string[];
  type?: string;
  /** 显式目录（默认按 type 映射） */
  folder?: string;
  origin?: string;
}

export async function memoryWrite(input: MemoryWriteInput): Promise<{ permalink: string; path: string }> {
  const type = input.type ?? "note";
  guard(input.title, ...input.observations.map((o) => o.text), ...(input.relations ?? []).map((r) => r.target));

  // 同名实体已存在 → 拒绝新建（引导 append，防重复实体）
  const existing = (await memoryList()).find((x) => x.title === input.title);
  if (existing) throw new Error(`已存在同名记忆「${input.title}」（${existing.permalink}）——用 memory_append 追加观察`);

  const permalink = await genPermalink(input.title, salt());
  const folder = (input.folder ?? FOLDER_BY_TYPE[type] ?? "knowledge").replace(/^\/+|\/+$/g, "");
  const path = `${folder}/${safeFileName(input.title)}`;
  const now = nowIso();
  const note: MemoryNote = {
    title: input.title,
    type,
    permalink,
    tags: input.tags ?? [],
    created: now,
    modified: now,
    origin: input.origin ?? "oh",
    extra: {},
    observations: input.observations.map((o): Observation => ({ category: o.category, text: o.text, tags: [], context: o.context })),
    relations: (input.relations ?? []).map((r): Relation => ({ rel: r.rel, target: r.target, context: r.context })),
    body: "",
  };
  const raw = renderNote(note);
  await mWrite(path, raw);
  await ledgerPut(path, raw, now);
  invalidateCache();
  return { permalink, path };
}

export async function memoryAppend(permalink: string, category: string, text: string, context?: string): Promise<void> {
  guard(text);
  const hit = await findByPermalink(permalink);
  if (!hit) throw new Error(`未找到记忆：${permalink}`);
  hit.note.observations.push({ category, text, tags: [], context });
  hit.note.modified = nowIso();
  const raw = renderNote(hit.note);
  await mWrite(hit.path, raw);
  await ledgerPut(hit.path, raw, hit.note.modified);
  invalidateCache();
}

export async function memoryEdit(permalink: string, find: string, replace: string): Promise<void> {
  guard(replace);
  const hit = await findByPermalink(permalink);
  if (!hit) throw new Error(`未找到记忆：${permalink}`);
  if (!hit.raw.includes(find)) throw new Error(`未找到待替换文本（${find.slice(0, 30)}…）——请先 memory_read 核对原文`);
  const raw = hit.raw.split(find).join(replace);
  await mWrite(hit.path, raw);
  await ledgerPut(hit.path, raw, nowIso());
  invalidateCache();
}

export async function memoryDelete(permalink: string, reason?: string): Promise<{ trashedTo: string }> {
  const hit = await findByPermalink(permalink);
  if (!hit) throw new Error(`未找到记忆：${permalink}`);
  const trashPath = `.trash/${hit.path}`;
  const banner = `<!-- 归档 ${nowIso()}${reason ? `：${reason}` : ""} -->\n`;
  await mWrite(trashPath, banner + hit.raw);
  await mDelete(hit.path);
  await ledgerRemove(hit.path);
  invalidateCache();
  return { trashedTo: trashPath };
}

/** 全量重扫重建账本（排障用：after 云盘拉取/手改镜像后对齐 diff 基线） */
export async function memoryRefresh(): Promise<{ count: number }> {
  const paths = await listAllNotes();
  const ledger: Record<string, { sha1: string; modified: string }> = {};
  const { sha1Hex } = await import("./format.js");
  for (const p of paths) {
    try {
      const raw = await mRead(p);
      const note = parseNote(raw);
      ledger[p] = { sha1: await sha1Hex(raw), modified: note?.modified ?? "" };
    } catch {
      /* 跳过坏文件 */
    }
  }
  await _w("_ledger.json", JSON.stringify(ledger, null, 2));
  invalidateCache();
  return { count: paths.length };
}

/** 镜像是否已建库（根目录存在且有内容） */
export async function memoryReady(): Promise<boolean> {
  try {
    const entries = await mList("");
    return entries.length > 0;
  } catch {
    return false;
  }
}

export { ledgerLoad };
