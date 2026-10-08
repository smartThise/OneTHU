/**
 * 侧栏用户偏好（§9.3 的「本地偏好表达」）：**拖拽排位的落点**记在这里。
 *
 * 默认档位与顺序仍来自 state/navigation.ts 的注册表（\`sidebar\` 字段与注册表次序）——
 * 偏好只做**覆盖**，所以不会产生第二份条目清单（护栏 sidebar-ia-test ① 继续成立）。
 * 落位时写入**完整**扁平次序：只有完整次序才能保证「拖过一项之后，其余项的相对次序不变」。
 */
import type { NavEntry } from "./navigation.js";

export type SidebarTier = "pin" | "more";

export interface SidebarPrefs {
  /** id → 档位覆盖（用户拖过才有） */
  tier: Record<string, SidebarTier>;
  /** 扁平次序：侧栏出现过的全部 id；用户排过一次就是完整的 */
  order: string[];
}

const KEY = "onethu.sidebar.prefs.v1";

export function loadSidebarPrefs(): SidebarPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { tier: {}, order: [] };
    const p = JSON.parse(raw) as Partial<SidebarPrefs>;
    return {
      tier: p.tier && typeof p.tier === "object" ? (p.tier as Record<string, SidebarTier>) : {},
      order: Array.isArray(p.order) ? p.order.filter((x): x is string => typeof x === "string") : [],
    };
  } catch {
    return { tier: {}, order: [] }; // 隐私模式 / 坏值：回到注册表默认
  }
}

export function saveSidebarPrefs(p: SidebarPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* 隐私模式：本次会话内仍然生效 */
  }
}

/** 注册表给出的默认档位（选课季提升算在内）；未参与侧栏的条目返回 null */
export function defaultTierOf(e: NavEntry, xkSeason: boolean): SidebarTier | null {
  if (e.sidebar !== "pin" && e.sidebar !== "more") return null;
  if (xkSeason && e.xkSeasonPin === true) return "pin";
  return e.sidebar;
}

/**
 * 合成侧栏两档：档位 = 用户覆盖 ?? 注册表默认；次序 = 用户次序优先，未排过的按注册表次序跟在后面。
 * 两档共用一条扁平次序，所以「常驻最后一项拖进更多」与「更多第一项拖到常驻末位」是同一套语义。
 */
export function resolveSidebar(
  entries: NavEntry[],
  prefs: SidebarPrefs,
  xkSeason: boolean,
): { pinned: NavEntry[]; more: NavEntry[] } {
  const rank = new Map(prefs.order.map((id, i) => [id, i] as const));
  const keep = entries.filter((e) => defaultTierOf(e, xkSeason) !== null);
  const sorted = [...keep].sort((a, b) => {
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    if (ra === undefined && rb === undefined) return 0; // 都没排过：保持注册表次序（sort 稳定）
    if (ra === undefined) return 1; // 排过的在前，未排过的按原次序跟在后面
    if (rb === undefined) return -1;
    return ra - rb;
  });
  const pinned: NavEntry[] = [];
  const more: NavEntry[] = [];
  for (const e of sorted) (prefs.tier[e.id] ?? defaultTierOf(e, xkSeason)) === "pin" ? pinned.push(e) : more.push(e);
  return { pinned, more };
}

/**
 * 按**插入序号**算出一份新偏好（预览与落位共用同一个函数：预览就是"假如现在松手"的最终状态）。
 * index 是"在被拖行以外的行里"的位置，所以直接从 rest 上插入即可。
 */
export function prefsAfterInsert(
  flat: string[],
  id: string,
  index: number,
  prev: SidebarPrefs,
  tierOfDragged: SidebarTier,
): SidebarPrefs {
  const rest = flat.filter((x) => x !== id);
  const at = Math.max(0, Math.min(rest.length, index));
  const order = [...rest.slice(0, at), id, ...rest.slice(at)];
  return { tier: { ...prev.tier, [id]: tierOfDragged }, order };
}

/**
 * 落位后算出新的偏好。
 * · `order` 写成**完整**扁平次序：只有完整次序才能保证「拖过一项之后，其余项相对次序不变」；
 * · `tier` 只记**被拖那一项**的新档位——其余项的档位继续跟随注册表默认，
 *   这样以后注册表改默认档，没被用户动过的项还能跟着变。
 */
export function prefsAfterDrop(
  flat: string[],
  id: string,
  targetId: string,
  where: "before" | "after",
  prev: SidebarPrefs,
  tierOfDragged: SidebarTier,
): SidebarPrefs {
  const rest = flat.filter((x) => x !== id);
  const at = rest.indexOf(targetId);
  const insertAt = at < 0 ? rest.length : where === "before" ? at : at + 1;
  const order = [...rest.slice(0, insertAt), id, ...rest.slice(insertAt)];
  return { tier: { ...prev.tier, [id]: tierOfDragged }, order };
}
