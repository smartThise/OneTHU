/**
 * 用户收藏夹 Context：全局唯一实例 + 即时持久化 + storage 事件跨窗口同步。
 * 所有收藏夹读写都走这里（组件不得直接碰 localStorage）。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  loadFavs, saveFavs, createFolder, deleteFolder, renameFolder, toggleAtom, swapItems,
  removeItemAt, setAtomVariant, toggleSidebarFold, foldersOfAtom, hasAtom, atomKeyOf,
  type AtomRef, type FavItem, type FavsData,
} from "./favorites.js";

export interface FavsApi {
  data: FavsData;
  /** 新建收藏夹（parentId=null 建根；返回新收藏夹 id，层数超限返回 null） */
  create: (title: string, parentId: string | null) => string | null;
  remove: (id: string) => void;
  rename: (id: string, title: string) => void;
  /** 星标切换：返回切换后是否已收录（供星标点亮态乐观展示） */
  toggleAtomIn: (folderId: string, atom: AtomRef) => boolean;
  /** 追加原子（已存在则不动；AtomPicker 添加用） */
  addAtom: (folderId: string, atom: AtomRef) => void;
  /** 收录某原子的全部收藏夹 id */
  foldersContaining: (atom: AtomRef) => string[];
  hasAtomIn: (folderId: string, atom: AtomRef) => boolean;
  /** 交换收藏夹内两项（瀑布流排序；子收藏夹项栏序走 tabLayout 不走这里） */
  swap: (folderId: string, i: number, j: number) => void;
  removeAt: (folderId: string, index: number) => void;
  setVariant: (folderId: string, index: number, sq: boolean | undefined) => void;
  foldSidebar: (id: string, isDefault: boolean) => void;
  /** 整体替换存储（设置导入/恢复默认） */
  replaceAll: (d: FavsData) => void;
  itemsOf: (id: string) => FavItem[];
}

const Ctx = createContext<FavsApi | null>(null);

export function FavsProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<FavsData>(() => loadFavs());

  // 任何变更即时落盘
  useEffect(() => {
    saveFavs(data);
  }, [data]);

  // 其他窗口改了收藏夹（开发时多开）→ 跟随
  useEffect(() => {
    const on = (e: StorageEvent) => {
      if (e.key === "onethu.favs.v1") setData(loadFavs());
    };
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, []);

  const create = useCallback((title: string, parentId: string | null) => {
    let newId: string | null = null;
    setData((prev) => {
      // 层数超限时直接拒绝（createFolder 内部同样有闸，这里补一个可观测返回）
      const next = createFolder(prev, title, parentId);
      if (next === prev) return prev;
      const known = new Set(Object.keys(prev.folders));
      newId = next.order.find((id) => !known.has(id)) ?? null;
      return next;
    });
    return newId;
  }, []);

  const remove = useCallback((id: string) => {
    setData((prev) => deleteFolder(prev, id));
  }, []);

  const rename = useCallback((id: string, title: string) => {
    setData((prev) => renameFolder(prev, id, title));
  }, []);

  const toggleAtomIn = useCallback((folderId: string, atom: AtomRef) => {
    let added = false;
    setData((prev) => {
      const r = toggleAtom(prev, folderId, atom);
      added = r.added;
      return r.data;
    });
    return added;
  }, []);

  const foldersContaining = useCallback((atom: AtomRef) => foldersOfAtom(data, atom), [data]);

  const hasAtomIn = useCallback((folderId: string, atom: AtomRef) => hasAtom(data, folderId, atom), [data]);

  const addAtom = useCallback((folderId: string, atom: AtomRef) => {
    setData((prev) => {
      const f = prev.folders[folderId];
      if (!f) return prev;
      const k = atomKeyOf(atom);
      if (f.items.some((it) => it.t === "a" && atomKeyOf(it.atom) === k)) return prev;
      return { ...prev, folders: { ...prev.folders, [folderId]: { ...f, items: [...f.items, { t: "a" as const, atom: { ...atom } }] } } };
    });
  }, []);

  const swap = useCallback((folderId: string, i: number, j: number) => {
    setData((prev) => swapItems(prev, folderId, i, j));
  }, []);

  const removeAt = useCallback((folderId: string, index: number) => {
    setData((prev) => removeItemAt(prev, folderId, index));
  }, []);

  const setVariant = useCallback((folderId: string, index: number, sq: boolean | undefined) => {
    setData((prev) => setAtomVariant(prev, folderId, index, sq));
  }, []);

  const foldSidebar = useCallback((id: string, isDefault: boolean) => {
    setData((prev) => toggleSidebarFold(prev, id, isDefault));
  }, []);

  const replaceAll = useCallback((d: FavsData) => {
    setData(d);
  }, []);

  const itemsOf = useCallback((id: string) => data.folders[id]?.items ?? [], [data]);

  const value = useMemo<FavsApi>(
    () => ({ data, create, remove, rename, toggleAtomIn, addAtom, foldersContaining, hasAtomIn, swap, removeAt, setVariant, foldSidebar, replaceAll, itemsOf }),
    [data, create, remove, rename, toggleAtomIn, addAtom, foldersContaining, hasAtomIn, swap, removeAt, setVariant, foldSidebar, replaceAll, itemsOf],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFavs(): FavsApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFavs must be used within FavsProvider");
  return v;
}
