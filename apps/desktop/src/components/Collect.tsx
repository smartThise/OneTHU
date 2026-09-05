/**
 * 收藏星标 + 收藏弹层 + 原子搜索添加弹层（万物原子化 UI 件）。
 * - CollectStar：行尾/卡头星标按钮，点亮态 = 已收进任意用户收藏夹；
 *   点击弹「收藏到…」多选弹层（可当场新建收藏夹），再点即取消。
 * - AtomPickerModal：收藏夹页「添加」按钮的搜索栏——搜功能页面/今日组件/
 *   本机已见过的实体原子（课程/作业/文件/通知/新闻/楼栋/场馆…），
 *   搜索只查静态注册表 + 本机缓存，绝不主动请求校内服务。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Empty } from "./Layout.js";
import { IconFolderPlus, IconSearch, IconStar } from "./Icons.js";
import { useFavs } from "../state/favs.js";
import { pageAtomRef, resolveAtom, searchAtoms, type AtomHit } from "../state/atoms.js";
import type { AtomRef } from "../state/favorites.js";

/** 星标按钮：已收录点亮；点击开弹层 */
export function CollectStar({ atom, title }: { atom: AtomRef; title?: string }) {
  const favs = useFavs();
  const [open, setOpen] = useState(false);
  const on = favs.foldersContaining(atom).length > 0;
  return (
    <>
      <button
        type="button"
        className={"collect-star" + (on ? " is-on" : "")}
        aria-label={(on ? "已收藏，点击管理" : "收藏") + (title ? "：" + title : "")}
        title={on ? "已收藏 · 点击管理" : "收藏"}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen(true);
        }}
      >
        <IconStar width={14} height={14} />
      </button>
      {open ? <CollectModal atom={atom} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** 「收藏到…」弹层：多选收藏夹 + 当场新建 */
/** 页头页面原子星标：聚合页随当前 tab 换目标（key 未注册时不渲染） */
export function PageAtomStar({ atomKey, title }: { atomKey: string; title: string }) {
  const ref = pageAtomRef(atomKey);
  if (!ref) return null;
  return <CollectStar atom={ref} title={title} />;
}

export function CollectModal({ atom, onClose }: { atom: AtomRef; onClose: () => void }) {
  const favs = useFavs();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const view = resolveAtom(atom);
  const roots = favs.data.order;
  /* 全树行：根收藏夹 + 各层子收藏夹（收藏时可直达任意层；深度由建夹侧 FAVS_MAX_DEPTH 限制） */
  const parentOf = new Map<string, string | null>();
  /* 子收藏夹 id 只在 folders 平铺表（挂在父夹 items 里），不在 order——遍历必须走 folders */
  for (const id of Object.keys(favs.data.folders)) {
    const f = favs.data.folders[id]!;
    if (!parentOf.has(id)) parentOf.set(id, null);
    for (const it of f.items) if (it.t === "f") parentOf.set(it.id, id);
  }
  const childrenOf = (pid: string | null): string[] =>
    pid === null
      ? favs.data.order.filter((id) => (parentOf.get(id) ?? null) === null)
      : Object.keys(favs.data.folders)
          .filter((id) => parentOf.get(id) === pid)
          .sort((a, b) => (favs.data.folders[a]!.createdAt || 0) - (favs.data.folders[b]!.createdAt || 0));
  const treeRows: ReactNode[] = [];
  const walk = (pid: string | null, depth: number): void => {
    for (const id of childrenOf(pid)) {
      const f = favs.data.folders[id];
      if (!f) continue;
      const checked = f.items.some((it) => it.t === "a" && it.atom.kind === atom.kind && it.atom.key === atom.key);
      treeRows.push(
        <label key={id} className="collect-row" style={depth > 0 ? { paddingLeft: 14 + depth * 18 } : undefined}>
          <input
            type="checkbox"
            checked={checked}
            onChange={() => favs.toggleAtomIn(id, atom)}
          />
          <span className="collect-row-icon"><IconFolderPlus width={15} height={15} style={{ opacity: 0.5 }} /></span>
          <span className="collect-row-text">
            <span className="collect-row-title">{f.title}</span>
            <span className="collect-row-sub">{f.items.length} 项</span>
          </span>
        </label>,
      );
      walk(id, depth + 1);
    }
  };
  walk(null, 0);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const createAndAdd = () => {
    const id = favs.create(name, null);
    if (id) {
      favs.toggleAtomIn(id, atom);
      setName("");
      setCreating(false);
    }
  };

  return createPortal(
    <div className="home-modal-mask" onClick={onClose}>
      <div className="home-modal collect-modal" role="dialog" aria-modal="true" aria-label="收藏到收藏夹" onClick={(e) => e.stopPropagation()}>
        <div className="home-modal-head">
          <h3>收藏到…</h3>
          <button className="btn btn-ghost" onClick={onClose}>关闭</button>
        </div>
        <div className="home-modal-body">
          <div className="home-modal-hint">
            「{view?.title ?? "原子"}」可同时收进多个收藏夹；收藏夹只是跳转入口，原功能始终锚定在默认页面。
          </div>
          {roots.length === 0 && !creating ? (
            <Empty text="还没有收藏夹——在左侧栏「新建收藏夹」，或点下方直接建一个。" />
          ) : (
            treeRows
          )}
          {creating ? (
            <div className="collect-new">
              <input
                className="input"
                autoFocus
                placeholder="收藏夹名称…"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createAndAdd();
                  if (e.key === "Escape") setCreating(false);
                }}
              />
              <button className="btn btn-primary" disabled={!name.trim()} onClick={createAndAdd}>建并收藏</button>
              <button className="btn btn-ghost" onClick={() => setCreating(false)}>取消</button>
            </div>
          ) : (
            <button className="btn collect-new-btn" onClick={() => setCreating(true)}>
              <IconFolderPlus width={14} height={14} />
              新建收藏夹
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 原子搜索添加弹层（收藏夹页「添加」） */
export function AtomPickerModal({ onPick, onClose }: { onPick: (atom: AtomRef) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<AtomRef | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo<AtomHit[]>(() => searchAtoms(q), [q]);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="home-modal-mask" onClick={onClose}>
      <div className="home-modal collect-modal" role="dialog" aria-modal="true" aria-label="搜索并添加原子" onClick={(e) => e.stopPropagation()}>
        <div className="home-modal-head">
          <h3>添加到收藏夹</h3>
          <button className="btn btn-ghost" onClick={onClose}>关闭</button>
        </div>
        <div className="home-modal-body">
          <div className="collect-search">
            <IconSearch width={15} height={15} />
            <input
              ref={inputRef}
              className="input"
              placeholder="搜索任意原子：页面 / 组件 / 课程 / 作业 / 新闻 / 楼栋 / 场馆…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {q.trim() === "" ? (
            <div className="home-modal-hint">
              支持搜索：全部功能页面与今日组件；本机已见过的实体（课程、作业、文件、通知、新闻、洗衣机楼栋、教学楼、体育场馆、研讨间类型、图书馆）——先打开过对应页面，具体实体才会进入搜索。
            </div>
          ) : results.length === 0 ? (
            <Empty text="没有匹配的原子——试试更短的关键词，或先去对应页面打开一次。" />
          ) : (
            results.map((h) => {
              const Icon = h.icon;
              return (
                <button
                  key={h.kind + "|" + h.key}
                  className={"home-modal-row collect-hit" + (picked && picked.kind === h.kind && picked.key === h.key ? " is-picked" : "")}
                  onClick={() => {
                    setPicked({ kind: h.kind, key: h.key });
                    onPick({ kind: h.kind, key: h.key });
                  }}
                >
                  <span className="home-entry-icon"><Icon width={17} height={17} /></span>
                  <div className="home-modal-text">
                    <div className="home-entry-name">{h.title}</div>
                    {h.sub ? <div className="home-entry-hint">{h.sub}</div> : null}
                  </div>
                  <span className="collect-hit-group">{h.group}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
