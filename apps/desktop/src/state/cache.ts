/**
 * 轻量 SWR 式数据缓存（thu-info-app redux-persist / learnX 全量持久化的桌面端等价物，
 * 2026-09 性能专项）：
 * - 模块级 Map（内存）+ 可选 localStorage 持久化（小体积关键数据，冷启动即时可用）
 * - cacheGet 挂载即取旧值 → 页面立即渲染上次数据，不闪骨架屏
 * - cacheFetch 单飞去重：同 key 并发共享同一个 Promise
 * - 条目带时间戳，hook 据此决定「新鲜跳过 / 过期静默重验证」（SWR 语义）
 * 安全边界：只缓存非敏感展示数据（余额/课表/新闻等），凭据类数据一律不进缓存。
 */

export interface CacheEntry<T> {
  data: T;
  /** 写入时间戳（Date.now()） */
  at: number;
}

const mem = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

/** 单条持久化上限：超过则只留内存（防 localStorage 配额爆掉） */
const PERSIST_LIMIT = 200 * 1024;

function lsKey(key: string): string {
  return `onethu.cache.${key}.v1`;
}

/** 读缓存：内存优先，未命中回落 localStorage（并回填内存） */
export function cacheGet<T>(key: string): CacheEntry<T> | null {
  const hit = mem.get(key) as CacheEntry<T> | undefined;
  if (hit) return hit;
  try {
    const raw = globalThis.localStorage?.getItem(lsKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (!parsed || typeof parsed.at !== "number" || parsed.data === undefined) return null;
    mem.set(key, parsed as CacheEntry<unknown>);
    return parsed;
  } catch {
    return null;
  }
}

/** 写缓存：内存必写；键在持久化名单则尝试落盘（超限/异常静默降级为仅内存） */
export function cacheSet<T>(key: string, data: T, persist?: boolean): void {
  const entry: CacheEntry<T> = { data, at: Date.now() };
  mem.set(key, entry as CacheEntry<unknown>);
  const doPersist = persist ?? isPersistedKey(key);
  if (!doPersist) return;
  try {
    const raw = JSON.stringify(entry);
    if (raw.length <= PERSIST_LIMIT) {
      globalThis.localStorage?.setItem(lsKey(key), raw);
    }
  } catch {
    /* 配额满/隐私模式：内存缓存仍有效 */
  }
}

export function cacheInvalidate(key: string): void {
  mem.delete(key);
  try {
    globalThis.localStorage?.removeItem(lsKey(key));
  } catch {
    /* 忽略 */
  }
}

/** 单飞：同 key 并发请求共享同一个 Promise；成功写缓存，失败不驻留 */
export function cacheFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = fetcher()
    .then((data) => {
      cacheSet(key, data);
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p as Promise<unknown>);
  return p;
}

/** 一次性清空选课缓存课表（v3：2026-09-02 二次清空——旧种子时间列缺失）。
 *  只清派生缓存（core 种子/学期解析），绝不动草稿/暂存等用户数据。 */
export function purgeXkCaches(): void {
  try {
    const ls = globalThis.localStorage;
    if (!ls || ls.getItem("onethu.xk.purged.v3")) return;
    for (const key of [...mem.keys()]) {
      if (key.startsWith("xk:core:") || key === "xk:semester") mem.delete(key);
    }
    const stale: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && (k.includes("xk:core:") || k.includes("xk:semester"))) stale.push(k);
    }
    for (const k of stale) ls.removeItem(k);
    ls.setItem("onethu.xk.purged.v3", "1");
  } catch {
    /* 忽略配额/隐私模式 */
  }
}

/** 持久化名单：这些 key 的缓存落 localStorage（冷启动即时渲染） */
const PERSISTED = new Set(["card", "profile", "calendar", "semesters", "exams", "report", "dorm", "xk"]);

function isPersistedKey(key: string): boolean {
  const head = key.split(/[\u0001:]/)[0];
  return PERSISTED.has(head ?? key);
}
