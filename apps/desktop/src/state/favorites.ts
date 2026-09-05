/**
 * 用户收藏夹存储（万物原子化 · 纯逻辑层，无 React）。
 *
 * 定位（用户定案）：
 * - 默认一级入口（今日/网络学堂/课表/信息/生活/预约/选课/设置）钉死在侧栏，
 *   不能删不能藏，只可折叠进「已折叠收藏夹（N）」组；
 * - 一切功能原子锚定在原位功能页，用户收藏夹只是原子的跳转入口层；
 * - 用户收藏夹 = 自由瀑布流（原子长/方卡）+ 树状子收藏夹，最多四层；
 * - 同一原子可同时收进多个收藏夹（children 存 AtomRef 引用，非实体）。
 *
 * 持久化：localStorage onethu.favs.v1，读写全 try/catch 静默降级；
 * 结构损坏一律丢弃重建为空库（收藏夹是入口层，丢了不伤功能本体）。
 */

/** 原子引用：kind=原子种类，key=种类内稳定标识（见 state/atoms.tsx 注册表） */
export interface AtomRef {
  kind: string;
  key: string;
}

/** 收藏夹子项：atom=原子；f=子收藏夹引用 */
export type FavItem = { t: "a"; atom: AtomRef; /** 三态：true=强制方卡 / false=强制长卡 / undefined=用原子默认 */ sq?: boolean } | { t: "f"; id: string };

/** 收藏夹节点（根与子共用；根在 order 里，全部存在 folders 平铺表）。
 *  子收藏夹展示 = 功能页同款 segmented 导航栏（显隐/顺序走 tabLayout 按夹分键），
 *  不再存页内折叠态。 */
export interface FavFolder {
  id: string;
  title: string;
  /** 自定义图标（Icons.FOLDER_ICONS 键名；缺省 = 默认文件夹图标） */
  icon?: string;
  items: FavItem[];
  createdAt: number;
}

/** 存储文档 */
export interface FavsData {
  v: 1;
  /** 根收藏夹顺序（侧栏「我的收藏夹」区） */
  order: string[];
  /** 平铺表：根收藏夹 + 各层子收藏夹 */
  folders: Record<string, FavFolder>;
  /** 侧栏折叠的用户根收藏夹 id */
  foldedRoots: string[];
  /** 侧栏折叠的默认一级入口（state/app.tsx Page id；今日/设置不可折叠） */
  foldedDefaults: string[];
}

export const FAVS_KEY = "onethu.favs.v1";

/** 收藏夹最大层数（根=第 1 层，最深第 4 层） */
export const FAVS_MAX_DEPTH = 3;

export function emptyFavs(): FavsData {
  return { v: 1, order: [], folders: {}, foldedRoots: [], foldedDefaults: [] };
}

export function newFavId(): string {
  return "f_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function isAtomRef(v: unknown): v is AtomRef {
  return typeof v === "object" && v !== null && typeof (v as AtomRef).kind === "string" && typeof (v as AtomRef).key === "string";
}

function parseFolder(raw: unknown): FavFolder | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.title !== "string" || !Array.isArray(r.items)) return null;
  const items: FavItem[] = [];
  for (const it of r.items) {
    if (typeof it !== "object" || it === null) continue;
    const o = it as Record<string, unknown>;
    if (o.t === "a" && isAtomRef(o.atom)) {
      items.push({ t: "a", atom: { kind: o.atom.kind, key: o.atom.key }, sq: typeof o.sq === "boolean" ? o.sq : undefined });
    } else if (o.t === "f" && typeof o.id === "string") {
      items.push({ t: "f", id: o.id });
    }
  }
  return {
    id: r.id,
    title: r.title.slice(0, 40),
    icon: typeof r.icon === "string" && r.icon ? r.icon : undefined,
    items,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
  };
}

/** 解析并校验收藏夹 JSON：结构损坏返回 null（导入与冷启动共用） */
export function parseFavs(raw: string | null | undefined): FavsData | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const r = parsed as Record<string, unknown>;
    if (r.v !== 1) return null;
    if (!Array.isArray(r.order) || !r.order.every((x) => typeof x === "string")) return null;
    if (typeof r.folders !== "object" || r.folders === null) return null;
    const folders: Record<string, FavFolder> = {};
    for (const [id, f] of Object.entries(r.folders as Record<string, unknown>)) {
      const node = parseFolder(f);
      if (!node || node.id !== id || folders[id]) continue;
      folders[id] = node;
    }
    // order 只留实际存在的根；不可达的孤儿文件夹回收
    const order = r.order.filter((id) => !!folders[id]);
    const reach = new Set<string>();
    const walk = (id: string) => {
      if (reach.has(id)) return;
      reach.add(id);
      for (const it of folders[id]!.items) if (it.t === "f") walk(it.id);
    };
    for (const id of order) walk(id);
    for (const id of Object.keys(folders)) if (!reach.has(id)) delete folders[id];
    const foldedRoots = Array.isArray(r.foldedRoots) ? r.foldedRoots.filter((x): x is string => typeof x === "string" && !!folders[x]) : [];
    const foldedDefaults = Array.isArray(r.foldedDefaults) ? r.foldedDefaults.filter((x): x is string => typeof x === "string") : [];
    return { v: 1, order, folders, foldedRoots, foldedDefaults };
  } catch {
    return null;
  }
}

export function loadFavs(): FavsData {
  try {
    return parseFavs(globalThis.localStorage?.getItem(FAVS_KEY)) ?? emptyFavs();
  } catch {
    return emptyFavs();
  }
}

export function saveFavs(d: FavsData): void {
  try {
    globalThis.localStorage?.setItem(FAVS_KEY, JSON.stringify(d));
  } catch {
    /* 配额/隐私模式静默降级 */
  }
}

/* ══════════ 树操作（全部纯函数：传入返回新对象，不改入参） ══════════ */

/** 某收藏夹所在层深（根=1；不存在=0） */
export function favDepth(d: FavsData, id: string): number {
  const depthOf = new Map<string, number>();
  const walk = (fid: string, dep: number) => {
    if ((depthOf.get(fid) ?? 99) <= dep) return;
    depthOf.set(fid, dep);
    const f = d.folders[fid];
    if (!f || dep >= FAVS_MAX_DEPTH) return;
    for (const it of f.items) if (it.t === "f") walk(it.id, dep + 1);
  };
  for (const rid of d.order) walk(rid, 1);
  return depthOf.get(id) ?? 0;
}

/** 是否还能在某收藏夹下再建一层（父层深 < MAX；根层恒可建） */
export function canNestUnder(d: FavsData, parentId: string | null): boolean {
  if (parentId === null) return true;
  return favDepth(d, parentId) < FAVS_MAX_DEPTH;
}

/** 同一收藏夹内原子去重键 */
export function atomKeyOf(a: AtomRef): string {
  return a.kind + "|" + a.key;
}

export function createFolder(d: FavsData, title: string, parentId: string | null): FavsData {
  if (!canNestUnder(d, parentId)) return d;
  const id = newFavId();
  const node: FavFolder = { id, title: title.trim().slice(0, 40) || "新建收藏夹", items: [], createdAt: Date.now() };
  const folders = { ...d.folders, [id]: node };
  if (parentId === null) return { ...d, folders, order: [...d.order, id] };
  const parent = folders[parentId];
  if (!parent) return d;
  folders[parentId] = { ...parent, items: [...parent.items, { t: "f", id }] };
  return { ...d, folders };
}

export function renameFolder(d: FavsData, id: string, title: string): FavsData {
  const f = d.folders[id];
  if (!f) return d;
  return { ...d, folders: { ...d.folders, [id]: { ...f, title: title.trim().slice(0, 40) || f.title } } };
}

/** 删除用户收藏夹：连带整棵子树；根同时移出 order 与 foldedRoots */
export function deleteFolder(d: FavsData, id: string): FavsData {
  const f = d.folders[id];
  if (!f) return d;
  const dead = new Set<string>();
  const walk = (fid: string) => {
    if (dead.has(fid)) return;
    dead.add(fid);
    const node = d.folders[fid];
    if (node) for (const it of node.items) if (it.t === "f") walk(it.id);
  };
  walk(id);
  const folders: Record<string, FavFolder> = {};
  for (const [fid, node] of Object.entries(d.folders)) if (!dead.has(fid)) folders[fid] = node;
  for (const node of Object.values(folders)) {
    if (node.items.some((it) => it.t === "f" && dead.has(it.id))) {
      folders[node.id] = { ...node, items: node.items.filter((it) => !(it.t === "f" && dead.has(it.id))) };
    }
  }
  return { ...d, folders, order: d.order.filter((x) => x !== id), foldedRoots: d.foldedRoots.filter((x) => x !== id) };
}

/** 原子加入/移出收藏夹（已在则移出；返回后是否在收藏夹内） */
export function toggleAtom(d: FavsData, folderId: string, atom: AtomRef): { data: FavsData; added: boolean } {
  const f = d.folders[folderId];
  if (!f) return { data: d, added: false };
  const k = atomKeyOf(atom);
  const has = f.items.some((it) => it.t === "a" && atomKeyOf(it.atom) === k);
  const items = has ? f.items.filter((it) => !(it.t === "a" && atomKeyOf(it.atom) === k)) : [...f.items, { t: "a" as const, atom: { ...atom } }];
  return { data: { ...d, folders: { ...d.folders, [folderId]: { ...f, items } } }, added: !has };
}

/** 原子是否已收在某收藏夹 */
export function hasAtom(d: FavsData, folderId: string, atom: AtomRef): boolean {
  const f = d.folders[folderId];
  if (!f) return false;
  const k = atomKeyOf(atom);
  return f.items.some((it) => it.t === "a" && atomKeyOf(it.atom) === k);
}

/** 列出收录了某原子的全部收藏夹 id */
export function foldersOfAtom(d: FavsData, atom: AtomRef): string[] {
  const k = atomKeyOf(atom);
  const out: string[] = [];
  for (const f of Object.values(d.folders)) if (f.items.some((it) => it.t === "a" && atomKeyOf(it.atom) === k)) out.push(f.id);
  return out;
}

/** 收藏夹内两项交换位置（i/j 越界或相等原样返回；子收藏夹项不参与瀑布流排序，
 *  其栏序由 tabLayout 管理——排序调用方先解析出相邻原子下标再交换） */
export function swapItems(d: FavsData, folderId: string, i: number, j: number): FavsData {
  const f = d.folders[folderId];
  if (!f || i < 0 || j < 0 || i >= f.items.length || j >= f.items.length || i === j) return d;
  const items = [...f.items];
  const a = items[i]!;
  const b = items[j]!;
  items[i] = b;
  items[j] = a;
  return { ...d, folders: { ...d.folders, [folderId]: { ...f, items } } };
}

/** 移除 items 内某项（按索引） */
export function removeItemAt(d: FavsData, folderId: string, index: number): FavsData {
  const f = d.folders[folderId];
  if (!f || index < 0 || index >= f.items.length) return d;
  const items = f.items.filter((_, i) => i !== index);
  return { ...d, folders: { ...d.folders, [folderId]: { ...f, items } } };
}

/** 设置原子的长/方变体（三态：true=方 / false=长 / undefined=原子默认——
 *  缺省方卡的原子（教室等）转长卡必须显式 false，undefined 会弹回缺省） */
export function setAtomVariant(d: FavsData, folderId: string, index: number, sq: boolean | undefined): FavsData {
  const f = d.folders[folderId];
  if (!f || index < 0 || index >= f.items.length) return d;
  const it = f.items[index]!;
  if (it.t !== "a") return d;
  const items = [...f.items];
  items[index] = { ...it, sq };
  return { ...d, folders: { ...d.folders, [folderId]: { ...f, items } } };
}

/** 设置收藏夹图标（icon=undefined 恢复默认；根/子夹通用） */
export function setFolderIcon(d: FavsData, id: string, icon: string | undefined): FavsData {
  const f = d.folders[id];
  if (!f) return d;
  return { ...d, folders: { ...d.folders, [id]: { ...f, icon } } };
}

/** 左侧栏根收藏夹排序：相邻交换（仅根层 order，子夹栏序走 tabLayout） */
export function moveRoot(d: FavsData, id: string, dir: -1 | 1): FavsData {
  const i = d.order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= d.order.length) return d;
  const order = [...d.order];
  const t = order[i]!;
  order[i] = order[j]!;
  order[j] = t;
  return { ...d, order };
}

/** 侧栏折叠切换：isDefault=true 折叠默认入口（Page id），否则折叠用户根收藏夹 */
export function toggleSidebarFold(d: FavsData, id: string, isDefault: boolean): FavsData {
  if (isDefault) {
    const foldedDefaults = d.foldedDefaults.includes(id) ? d.foldedDefaults.filter((x) => x !== id) : [...d.foldedDefaults, id];
    return { ...d, foldedDefaults };
  }
  const foldedRoots = d.foldedRoots.includes(id) ? d.foldedRoots.filter((x) => x !== id) : [...d.foldedRoots, id];
  return { ...d, foldedRoots };
}

/** 恢复默认：清空用户收藏夹与折叠记录（设置「恢复默认收藏夹」） */
export function resetFavs(): FavsData {
  return emptyFavs();
}
