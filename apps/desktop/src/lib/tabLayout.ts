/**
 * 聚合页栏目布局（显隐 + 顺序）：localStorage 持久化，按页分键。
 * 读写 try/catch 静默降级（homeCards / customCourses 同款策略）。
 * 合并规则：存储只记增量（order 存已知 id 的排列，缺失的按默认序追加；
 * hidden 过滤未知 id）——新增栏目天然可见且排在末尾，升级不丢用户配置。
 */

export interface TabLayout {
  /** 栏目排列（已知 id 的某个排列，可能缺项） */
  order: string[];
  /** 隐藏的栏目 id */
  hidden: string[];
}

export function loadTabLayout(key: string, allIds: string[]): TabLayout {
  let stored: Partial<TabLayout> | null = null;
  try {
    const raw = globalThis.localStorage?.getItem(`onethu.tab-layout.${key}.v1`);
    stored = raw ? (JSON.parse(raw) as Partial<TabLayout>) : null;
  } catch {
    stored = null;
  }
  const known = new Set(allIds);
  const order = (Array.isArray(stored?.order) ? stored.order : [])
    .filter((id) => known.delete(id)); // 去重 + 只留已知
  order.push(...allIds.filter((id) => known.has(id))); // 新栏目 / 缺项按默认序补尾
  const hidden = (Array.isArray(stored?.hidden) ? stored.hidden : []).filter((id) => allIds.includes(id));
  return { order, hidden };
}

export function saveTabLayout(key: string, layout: TabLayout): void {
  try {
    globalThis.localStorage?.setItem(`onethu.tab-layout.${key}.v1`, JSON.stringify(layout));
  } catch {
    /* 存储不可用：会话内仍生效 */
  }
}
