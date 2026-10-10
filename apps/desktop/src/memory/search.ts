/**
 * 四段检索（无向量，docs/memory-cloud/01 §5）：frontmatter 过滤 → 关键词加权
 * → 时间倒序 → relation 一跳展开。面向「帮 LLM 找回自己写过什么」而非搜索引擎。
 */
import { type MemoryNote, parseNote } from "./format.js";
import { listAllNotes, mRead } from "./mirror.js";

export interface SearchHit {
  permalink: string;
  title: string;
  type: string;
  tags: string[];
  path: string;
  modified: string;
  score: number;
  snippet: string;
  /** 通过 relation 一跳命中（query 命中其被引用目标的标题） */
  via?: string;
}

interface CachedNote {
  path: string;
  note: MemoryNote;
  raw: string;
  at: number;
}

const cache = new Map<string, CachedNote>();
const CACHE_TTL = 30_000;

export function invalidateCache(path?: string): void {
  if (path) cache.delete(path);
  else cache.clear();
}

async function loadNote(path: string): Promise<CachedNote | null> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit;
  try {
    const raw = await mRead(path);
    const note = parseNote(raw);
    if (!note) return null;
    const entry = { path, note, raw, at: Date.now() };
    cache.set(path, entry);
    return entry;
  } catch {
    return null;
  }
}

export interface SearchQuery {
  query?: string;
  tags?: string[];
  type?: string;
  folder?: string;
  limit?: number;
}

function scoreOf(note: MemoryNote, terms: string[], raw: string): { score: number; snippet: string } {
  if (terms.length === 0) {
    return { score: 1, snippet: note.observations[0]?.text.slice(0, 80) ?? "" };
  }
  let score = 0;
  let snippet = "";
  const title = note.title.toLowerCase();
  const tags = note.tags.map((t) => t.toLowerCase());
  const body = raw.toLowerCase();
  for (const term of terms) {
    const t = term.toLowerCase();
    if (title.includes(t)) score += 3;
    if (tags.some((x) => x.includes(t))) score += 2;
    if (body.includes(t)) {
      score += 1;
      if (!snippet) {
        const i = body.indexOf(t);
        const lo = Math.max(0, i - 30);
        snippet = raw.slice(lo, Math.min(raw.length, i + t.length + 60)).replace(/\s+/g, " ").trim();
      }
    }
  }
  if (!snippet) snippet = note.observations[0]?.text.slice(0, 80) ?? "";
  return { score, snippet };
}

export async function searchMemory(q: SearchQuery): Promise<SearchHit[]> {
  const terms = (q.query ?? "").trim().split(/\s+/).filter(Boolean);
  const paths = await listAllNotes();
  const hits: SearchHit[] = [];
  const byPermalink = new Map<string, SearchHit>();

  for (const path of paths) {
    const c = await loadNote(path);
    if (!c) continue;
    const { note, raw } = c;
    if (q.type && note.type !== q.type) continue;
    if (q.folder && !path.startsWith(q.folder.replace(/^\/+/, ""))) continue;
    if (q.tags?.length && !q.tags.some((t) => note.tags.includes(t))) continue;
    const { score, snippet } = scoreOf(note, terms, raw);
    if (score <= 0) continue;
    const hit: SearchHit = {
      permalink: note.permalink,
      title: note.title,
      type: note.type,
      tags: note.tags,
      path,
      modified: note.modified,
      score,
      snippet,
    };
    hits.push(hit);
    byPermalink.set(note.permalink, hit);
  }

  // 第四段：relation 一跳展开（只有当 query 命中某标题时，把引用它的实体带出来）
  if (terms.length > 0) {
    const matchedTitles = new Set(hits.map((h) => h.title));
    for (const path of paths) {
      if (hits.some((h) => h.path === path)) continue;
      const c = await loadNote(path);
      if (!c) continue;
      const ref = c.note.relations.find((r) => matchedTitles.has(r.target));
      if (ref) {
        hits.push({
          permalink: c.note.permalink,
          title: c.note.title,
          type: c.note.type,
          tags: c.note.tags,
          path,
          modified: c.note.modified,
          score: 0.5,
          snippet: `${c.note.title} —${ref.rel}→ ${ref.target}`,
          via: ref.target,
        });
      }
    }
  }

  hits.sort((a, b) => b.score - a.score || (a.modified < b.modified ? 1 : -1));
  return hits.slice(0, q.limit ?? 8);
}
