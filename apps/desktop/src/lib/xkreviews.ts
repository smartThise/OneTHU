/**
 * 社区评价（nextthuxk reviews.js 移植）：thubook.help 数据源。
 * 索引 SWR（24h TTL）+ 三级匹配（名师全精确/同名桶教师 token 相交/命名漂移兜底）
 * + 点评正文实时拉取（10min 内存缓存）。
 */
const TB_DATA = "https://thubook.help/data/";
const TB_PAGE = "https://thubook.help/thucourse/";
const IDX_TTL = 24 * 3600_000;
const DETAIL_TTL = 10 * 60_000;

export interface TbEntry {
  kcm: string; jsm: string; kkdw: string;
  sqid: string; tid: number | null;
  count: number; avg: number;
  nt: string[];
}
interface IdxState {
  ready: boolean; entries: TbEntry[];
  bySqid: Map<string, TbEntry>; byNameT: Map<string, TbEntry[]>; byName: Map<string, TbEntry[]>;
  loadingPromise: Promise<boolean> | null;
}
const S: IdxState = { ready: false, entries: [], bySqid: new Map(), byNameT: new Map(), byName: new Map(), loadingPromise: null };
const detailCache = new Map<string, { ts: number; data: TbReviews }>();
const matchCache = new Map<string, TbEntry | null>();

const normName = (s: string | undefined): string =>
  String(s ?? "").normalize("NFKC").replace(/[\s\u00a0\u3000]+/g, "").toLowerCase();
const normTeacherTokens = (s: string | undefined): string[] =>
  String(s ?? "").normalize("NFKC").split(/[,，、;；/\s]+/).map((x) => x.trim()).filter(Boolean);
const tKey = (tokens: string[]): string => tokens.slice().sort().join("\u0002");

function buildMaps(raw: { courses: Record<string, RawEntry> }): void {
  matchCache.clear();
  S.bySqid.clear(); S.byNameT.clear(); S.byName.clear(); S.entries = [];
  for (const sqid of Object.keys(raw.courses ?? {})) {
    const e = raw.courses[sqid]!;
    const entry: TbEntry = {
      kcm: e.kcm ?? "", jsm: e.jsm ?? "", kkdw: (e.kkdw ?? "").trim(),
      sqid: String(e.sqid), tid: e.tid ?? null, count: e.count || 0, avg: e.avg || 0,
      nt: normTeacherTokens(e.jsm),
    };
    S.entries.push(entry);
    S.bySqid.set(entry.sqid, entry);
    const nk = normName(entry.kcm) || "";
    push(S.byNameT, `${nk}\u0001${tKey(entry.nt)}`, entry);
    push(S.byName, nk, entry);
  }
  S.ready = true;
}
function push(m: Map<string, TbEntry[]>, k: string, e: TbEntry): void {
  const arr = m.get(k) ?? [];
  arr.push(e);
  m.set(k, arr);
}
interface RawEntry { kcm?: string; jsm?: string; kkdw?: string; sqid?: string | number; tid?: number | null; count?: number; avg?: number }

async function fetchIndex(): Promise<{ courses: Record<string, RawEntry> }> {
  const res = await fetch(`${TB_DATA}with_comment_index.json`, { credentials: "omit" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { courses: Record<string, RawEntry> };
}

/** SWR：先读 localStorage 缓存建图，过期后台静默刷 */
export function tbEnsureIndex(): Promise<boolean> {
  if (S.loadingPromise) return S.loadingPromise;
  S.loadingPromise = (async () => {
    let cached: { v: number; courses: Record<string, RawEntry> } | null = null;
    let ts = 0;
    try {
      const raw = globalThis.localStorage?.getItem("onethu.tbookIdx");
      if (raw) {
        cached = JSON.parse(raw) as { v: number; courses: Record<string, RawEntry> };
        ts = Number(globalThis.localStorage?.getItem("onethu.tbookIdxTs") ?? 0);
      }
    } catch { /* storage 异常不阻断 */ }
    if (cached && cached.v === 2 && cached.courses) {
      try { buildMaps(cached); } catch { /* 缓存坏则重抓 */ }
    }
    const fresh = cached && Date.now() - ts < IDX_TTL;
    if (!fresh) {
      try {
        const idx = await fetchIndex();
        buildMaps(idx);
        try {
          globalThis.localStorage?.setItem("onethu.tbookIdx", JSON.stringify({ v: 2, courses: idx.courses }));
          globalThis.localStorage?.setItem("onethu.tbookIdxTs", String(Date.now()));
        } catch { /* 配额 */ }
      } catch { /* 网络失败 fail-soft：无评价功能但不阻断 */ }
    }
    return S.ready;
  })();
  return S.loadingPromise;
}

/**
 * 空闲预热索引（b26 切页长帧归因）。
 *
 * 为什么需要：选课页挂载时 `useXkPageHost` 会 `void tbEnsureIndex()`，而缓存命中时这条
 * 调用要在**点击后的那一帧里**同步做两件重活——`JSON.parse` 约 111KB 的 `onethu.tbookIdx`
 * （真机实测 10.8ms）与对全部 1080 条课程做 NFKC 归一化 + 三张 Map 建图（13.8ms），
 * 冷 JIT 下更贵；这正是真机「切到选课卡一下」中可确定归因的一段（见 §7 F3）。
 *
 * 预热把这段重计算挪到**浏览器空闲期**（登录就绪后 `requestIdleCallback`，带 3s 超时兜底；
 * 不支持 idle 回调时退化为 1.2s 定时器），点击路径只剩查表。
 *
 * 口径（刻意收窄，避免变成新的网络打扰）：
 *  - 只在本地缓存**仍然新鲜**（`onethu.tbookIdxTs` 在 `IDX_TTL` 内）时预热——此时
 *    `tbEnsureIndex()` 的 `fresh` 分支为真、**不发任何网络请求**；
 *  - 缓存缺失/过期一律不预热：仍由选课页自己走它原有的 SWR 抓取，数据新鲜度语义一字不改；
 *  - 已就绪 / 已有在飞 promise 时直接返回，幂等。
 */
export function tbWarmIndexOnIdle(): void {
  if (S.loadingPromise || S.ready) return;
  try {
    if (!globalThis.localStorage?.getItem("onethu.tbookIdx")) return;
    const ts = Number(globalThis.localStorage?.getItem("onethu.tbookIdxTs") ?? 0);
    if (!ts || Date.now() - ts >= IDX_TTL) return;
  } catch {
    return; // storage 异常不在此处兜底：交给页面自己的 tbEnsureIndex
  }
  const run = (): void => {
    void tbEnsureIndex().catch(() => undefined);
  };
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof ric === "function") ric(run, { timeout: 3000 });
  else setTimeout(run, 1200);
}

/** 三级匹配（reviews.js tbMatch 同语义） */
export function tbMatch(name: string, teacher: string): TbEntry | null {
  const ck = `${name}\u0001${teacher}`;
  if (matchCache.has(ck)) return matchCache.get(ck) ?? null;
  const r = tbMatchRaw(name, teacher);
  matchCache.set(ck, r);
  return r;
}
function tbMatchRaw(name: string, teacher: string): TbEntry | null {
  if (!S.ready) return null;
  const nk = normName(name);
  const ct = normTeacherTokens(teacher);
  const ctk = tKey(ct);
  const t1 = S.byNameT.get(`${nk}\u0001${ctk}`);
  if (t1 && t1.length === 1) return t1[0]!;
  const bucket = S.byName.get(nk);
  if (bucket) {
    if (bucket.length === 1) {
      const e = bucket[0]!;
      const disjoint = ct.length > 0 && e.nt.length > 0 && !ct.some((t) => e.nt.includes(t));
      if (!disjoint) return e;
    } else {
      let best: TbEntry | null = null, bestScore = -1;
      for (const e of bucket) {
        const inter = ct.filter((t) => e.nt.includes(t)).length;
        let score: number;
        if (ct.length && e.nt.length) score = inter > 0 ? 10 + inter : -1;
        else score = 5;
        if (score < 0) continue;
        score += Math.min(e.count, 10) * 0.01;
        if (score > bestScore) { bestScore = score; best = e; }
      }
      if (best) return best;
    }
  }
  const nkStripped = nk.replace(/\((?:英|中文)\)|（(?:英|中文）)|荣誉|\(\d+\)$/, "");
  if (nkStripped && nkStripped !== nk) {
    const b2 = S.byName.get(nkStripped);
    if (b2 && b2.length === 1) {
      const e0 = b2[0]!;
      const okTeacher = !ct.length || !e0.nt.length || ct.some((t) => e0.nt.includes(t));
      if (okTeacher) return e0;
    }
  }
  return null;
}

export interface TbReviews {
  count: number;
  results: Array<{ rating?: number; comment?: string; score?: string | number; created_at?: string }>;
}
/** 点评正文（10min 内存缓存，next 分页 ≤5 跳） */
export async function tbFetchReviews(sqid: string): Promise<TbReviews> {
  const hit = detailCache.get(sqid);
  if (hit && Date.now() - hit.ts < DETAIL_TTL) return hit.data;
  const res = await fetch(`${TB_DATA}courses/${sqid}.json`, { credentials: "omit" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const doc = (await res.json()) as { count?: number; results?: TbReviews["results"]; next?: string };
  let results = Array.from(doc.results ?? []);
  let next = doc.next, hops = 0;
  while (next && hops < 5) {
    const p = await fetch(next, { credentials: "omit" });
    if (!p.ok) break;
    const pd = (await p.json()) as { results?: TbReviews["results"]; next?: string };
    results = results.concat(Array.from(pd.results ?? []));
    next = pd.next; hops++;
  }
  results.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  const data: TbReviews = { count: doc.count ?? results.length, results };
  detailCache.set(sqid, { ts: Date.now(), data });
  return data;
}

export const tbStars = (avg: number): string => {
  const full = Math.round(Number(avg) || 0);
  return Array.from({ length: 5 }, (_, i) => (i < full ? "★" : "☆")).join("");
};
export const tbCourseUrl = (e: TbEntry | null): string =>
  e ? `${TB_PAGE}course.html?sqid=${encodeURIComponent(e.sqid)}&tid=${encodeURIComponent(e.tid == null ? "" : String(e.tid))}&name=${encodeURIComponent(e.kcm)}&teacher=${encodeURIComponent(e.jsm)}&dept=${encodeURIComponent(e.kkdw)}` : `${TB_PAGE}search.html`;
const _unusedTbCourseUrl = (e: TbEntry): string =>
  `${TB_PAGE}course.html?sqid=${encodeURIComponent(e.sqid)}&tid=${encodeURIComponent(e.tid == null ? "" : String(e.tid))}&name=${encodeURIComponent(e.kcm)}&teacher=${encodeURIComponent(e.jsm)}&dept=${encodeURIComponent(e.kkdw)}`;
// thubook 金标准格式（2026-08 实测）：thucourse/new-review?courseId=..&courseName=纯课名(URL编码)
export const tbWriteUrl = (e: TbEntry | null): string =>
  e ? `${TB_PAGE}new-review?courseId=${encodeURIComponent(e.sqid)}&courseName=${encodeURIComponent(e.kcm || "")}` : `${TB_PAGE}new-review`;
