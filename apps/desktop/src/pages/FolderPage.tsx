/**
 * 用户收藏夹页（万物原子化 · 跳转入口层）。
 * - 布局：自由瀑布流——原子长卡全宽、方卡成瓷砖网格块（相邻方卡聚成一块，
 *   顺序语义不变）；子收藏夹按树状分节内联展开（与其余功能页同构），最多四层；
 * - 原子点击 = 跳回原位功能页的特定位置（深链），组件原子整卡直播；
 * - 编辑模式：添加原子（搜索弹层）/ 新建子收藏夹 / 重命名 / 删除收藏夹 /
 *   每项 ↑↓ 调序、长⇄方、移除；星标可从任何页面把原子收进来后到此调整顺序。
 */
import { useState } from "react";
import { Card, Empty, PageHead } from "../components/Layout.js";
import { IconChevron, IconFolder, IconFolderPlus, IconRefresh } from "../components/Icons.js";
import { useApp } from "../state/context.js";
import { useFavs } from "../state/favs.js";
import type { AtomRef } from "../state/favorites.js";
import { canNestUnder, FAVS_MAX_DEPTH } from "../state/favorites.js";
import { resolveAtom } from "../state/atoms.js";
import { AtomPickerModal, CollectStar } from "../components/Collect.js";
import { confirmOk } from "../lib/confirm.js";

export function FolderPage() {
  const { navParams, navigate } = useApp();
  const favs = useFavs();
  const rootId = navParams?.folderId ?? null;
  const folder = rootId ? favs.data.folders[rootId] : undefined;

  const [editing, setEditing] = useState(false);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [newSubFor, setNewSubFor] = useState<string | null>(null);
  const [newSubName, setNewSubName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");

  if (!rootId || !folder) {
    return (
      <>
        <PageHead title="收藏夹" />
        <Card>
          <Empty text="该收藏夹不存在或已被删除。" />
        </Card>
      </>
    );
  }

  const createSub = () => {
    const id = favs.create(newSubName || "子收藏夹", rootId);
    setNewSubFor(null);
    setNewSubName("");
    return id;
  };

  const removeRoot = async () => {
    const ok = await confirmOk("删除收藏夹「" + folder.title + "」？\n其子收藏夹与收录的原子入口将一并删除（原功能不受影响）。");
    if (!ok) return;
    favs.remove(rootId);
    setEditing(false);
    navigate("today");
  };

  return (
    <>
      <PageHead
        title={
          renaming ? (
            <input
              className="input"
              autoFocus
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onBlur={() => {
                favs.rename(rootId, renameVal);
                setRenaming(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  favs.rename(rootId, renameVal);
                  setRenaming(false);
                }
              }}
              style={{ maxWidth: 260 }}
            />
          ) : (
            folder.title
          )
        }
        meta={"收藏夹 · " + folder.items.length + " 项"}
        actions={
          editing ? (
            <>
              <button className="btn" onClick={() => setPickerFor(rootId)}>添加原子</button>
              <button
                className="btn"
                disabled={!canNestUnder(favs.data, rootId)}
                title={canNestUnder(favs.data, rootId) ? undefined : "最多 " + FAVS_MAX_DEPTH + " 层收藏夹"}
                onClick={() => {
                  setNewSubFor(rootId);
                  setNewSubName("");
                }}
              >
                新建子收藏夹
              </button>
              <button className="btn" onClick={() => { setRenameVal(folder.title); setRenaming(true); }}>重命名</button>
              <button className="btn btn-primary" onClick={() => setEditing(false)}>完成</button>
            </>
          ) : (
            <button className="btn" onClick={() => setEditing(true)}>
              <IconRefresh width={14} height={14} />
              编辑
            </button>
          )
        }
      />

      {editing ? (
        <div className="fav-toolbar">
          <span className="fav-toolbar-hint">星标可在任何页面把原子收进来；这里调整顺序与长/方卡。删除收藏夹：</span>
          <button className="btn btn-ghost" onClick={() => void removeRoot()}>删除收藏夹</button>
        </div>
      ) : null}

      {newSubFor === rootId ? (
        <div className="fav-newsub">
          <input
            className="input"
            autoFocus
            placeholder="子收藏夹名称…"
            value={newSubName}
            onChange={(e) => setNewSubName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") createSub();
              if (e.key === "Escape") setNewSubFor(null);
            }}
          />
          <button className="btn btn-primary" onClick={createSub}>创建</button>
          <button className="btn btn-ghost" onClick={() => setNewSubFor(null)}>取消</button>
        </div>
      ) : null}

      <ItemsBlock folderId={rootId} depth={1} editing={editing} />

      {folder.items.length === 0 ? (
        <Card>
          <Empty text="空收藏夹——点右上角「编辑」→「添加原子」搜索添加；或在任意页面点星标收藏。" />
        </Card>
      ) : null}

      {pickerFor ? (
        <AtomPickerModal
          onPick={(atom: AtomRef) => favs.addAtom(pickerFor, atom)}
          onClose={() => setPickerFor(null)}
        />
      ) : null}
    </>
  );
}

/* ══════════ items 渲染（长卡 / 方卡瓦片块 / 子收藏夹分节，递归） ══════════ */

function ItemsBlock({ folderId, depth, editing }: { folderId: string; depth: number; editing: boolean }) {
  const favs = useFavs();
  const f = favs.data.folders[folderId];
  if (!f) return null;
  const items = f.items;

  /** 连续的方卡原子聚成一个瓦片块（保持顺序语义） */
  type Block = { t: "tiles"; from: number; items: number[] } | { t: "one"; index: number };
  const blocks: Block[] = [];
  let cur: Block | null = null;
  items.forEach((it, i) => {
    const isSqTile = it.t === "a" && (it.sq ?? resolveAtom(it.atom)?.defaultSq ?? false) && !resolveAtom(it.atom)?.widget;
    if (isSqTile) {
      if (cur && cur.t === "tiles") cur.items.push(i);
      else {
        cur = { t: "tiles", from: i, items: [i] };
        blocks.push(cur);
      }
      return;
    }
    cur = null;
    blocks.push({ t: "one", index: i });
  });

  return (
    <>
      {blocks.map((b) =>
        b.t === "one" ? (
          <OneItem key={"i" + b.index} folderId={folderId} index={b.index} depth={depth} editing={editing} />
        ) : (
          <div key={"t" + b.from} className="fav-tiles">
            {b.items.map((i) => (
              <TileItem key={"ti" + i} folderId={folderId} index={i} editing={editing} />
            ))}
          </div>
        ),
      )}
    </>
  );
}

/** 单项：原子长卡（widget=整卡直播）或子收藏夹分节 */
function OneItem({ folderId, index, depth, editing }: { folderId: string; index: number; depth: number; editing: boolean }) {
  const favs = useFavs();
  const { navigate } = useApp();
  const f = favs.data.folders[folderId];
  const it = f?.items[index];
  if (!f || !it) return null;

  const tools = (
    <div className="home-card-tools">
      <button type="button" className="icon-btn" title="上移" aria-label="上移" disabled={index === 0} onClick={() => favs.move(folderId, index, -1)}>
        <IconChevron width={13} height={13} style={{ transform: "rotate(-90deg)" }} />
      </button>
      <button type="button" className="icon-btn" title="下移" aria-label="下移" disabled={index === f.items.length - 1} onClick={() => favs.move(folderId, index, 1)}>
        <IconChevron width={13} height={13} style={{ transform: "rotate(90deg)" }} />
      </button>
      <button type="button" className="icon-btn" title="从此收藏夹移除" aria-label="移除" onClick={() => favs.removeAt(folderId, index)}>
        ✕
      </button>
    </div>
  );

  if (it.t === "f") {
    const sub = favs.data.folders[it.id];
    if (!sub) return null;
    const folded = f.foldedIds.includes(it.id);
    return (
      <section className="fav-sub" style={depth >= FAVS_MAX_DEPTH ? { borderStyle: "dashed" } : undefined}>
        <div className="fav-sub-head">
          <button
            type="button"
            className="fav-sub-toggle"
            aria-expanded={!folded}
            onClick={() => favs.foldSub(folderId, it.id)}
            title={folded ? "展开" : "折叠"}
          >
            <IconFolder width={16} height={16} />
            <b>{sub.title}</b>
            <span className="fav-sub-count">{sub.items.length} 项</span>
            <IconChevron width={14} height={14} className={"row-caret" + (folded ? "" : " is-open")} />
          </button>
          {editing ? (
            <div className="home-card-tools">
              <button type="button" className="icon-btn" title="上移" disabled={index === 0} onClick={() => favs.move(folderId, index, -1)}>
                <IconChevron width={13} height={13} style={{ transform: "rotate(-90deg)" }} />
              </button>
              <button type="button" className="icon-btn" title="下移" disabled={index === f.items.length - 1} onClick={() => favs.move(folderId, index, 1)}>
                <IconChevron width={13} height={13} style={{ transform: "rotate(90deg)" }} />
              </button>
              <button type="button" className="icon-btn" title="删除该子收藏夹" onClick={() => void (async () => {
                const ok = await confirmOk("删除子收藏夹「" + sub.title + "」？\n其子层与收录的原子入口将一并删除（原功能不受影响）。");
                if (ok) favs.remove(it.id);
              })()}>
                ✕
              </button>
            </div>
          ) : null}
        </div>
        {!folded ? (
          <div className="fav-sub-body">
            <ItemsBlock folderId={it.id} depth={depth + 1} editing={editing} />
            {sub.items.length === 0 ? <Empty text="空收藏夹。" /> : null}
          </div>
        ) : null}
      </section>
    );
  }

  const view = resolveAtom(it.atom);
  if (!view) return null; // 注册表已下线的原子：直接不渲染

  if (view.widget) {
    const body = view.widget();
    return (
      <section className="home-card fav-widget">
        <div className="home-card-head">
          <button type="button" className="home-card-title" onClick={() => view.open(navigate)} title="打开来源页">
            <h2>{view.title}</h2>
            {view.sub ? <span className="home-card-aside">{view.sub}</span> : null}
          </button>
          {editing ? tools : null}
          <CollectStar atom={it.atom} title={view.title} />
        </div>
        <div className="home-card-body">{body ?? <Empty text="暂无数据（数据为空时今日同款组件会整卡隐藏）。" />}</div>
      </section>
    );
  }

  const Icon = view.icon;
  return (
    <section className="home-card">
      <div className="home-card-head">
        <button
          type="button"
          className="home-entry-btn"
          onClick={() => view.open(navigate)}
          aria-label={view.title}
          title={"打开「" + view.title + "」"}
        >
          <span className="home-entry-icon"><Icon width={20} height={20} /></span>
          <span className="home-entry-text">
            <span className="home-entry-name">{view.title}</span>
            {view.sub ? <span className="home-entry-hint">{view.sub}</span> : null}
          </span>
          <IconChevron width={14} height={14} className="row-caret" />
        </button>
        {editing ? (
          <>
            <div className="home-card-tools">
              <button type="button" className="icon-btn" title="上移" disabled={index === 0} onClick={() => favs.move(folderId, index, -1)}>
                <IconChevron width={13} height={13} style={{ transform: "rotate(-90deg)" }} />
              </button>
              <button type="button" className="icon-btn" title="下移" disabled={index === f.items.length - 1} onClick={() => favs.move(folderId, index, 1)}>
                <IconChevron width={13} height={13} style={{ transform: "rotate(90deg)" }} />
              </button>
              <button type="button" className="icon-btn" title="改为方卡" aria-label="改为方卡" onClick={() => favs.setVariant(folderId, index, true)}>
                方
              </button>
              <button type="button" className="icon-btn" title="从此收藏夹移除" aria-label="移除" onClick={() => favs.removeAt(folderId, index)}>
                ✕
              </button>
            </div>
            <CollectStar atom={it.atom} title={view.title} />
          </>
        ) : null}
      </div>
    </section>
  );
}

/** 方卡瓦片（细粒度实体缺省；编辑态可改回长卡/移除） */
function TileItem({ folderId, index, editing }: { folderId: string; index: number; editing: boolean }) {
  const favs = useFavs();
  const { navigate } = useApp();
  const f = favs.data.folders[folderId];
  const it = f?.items[index];
  if (!f || !it || it.t !== "a") return null;
  const view = resolveAtom(it.atom);
  if (!view) return null;
  const Icon = view.icon;
  return (
    <Card className="fav-tile">
      <button
        className="fav-tile-btn"
        onClick={() => view.open(navigate)}
        aria-label={view.title}
        title={"打开「" + view.title + "」"}
      >
        <span className="fav-tile-icon"><Icon width={17} height={17} /></span>
        <span className="fav-tile-name">{view.title}</span>
        {view.sub ? <span className="fav-tile-sub">{view.sub}</span> : null}
      </button>
      {editing ? (
        <div className="fav-tile-tools">
          <button type="button" className="icon-btn" title="改为长卡" aria-label="改为长卡" onClick={() => favs.setVariant(folderId, index, undefined)}>
            长
          </button>
          <button type="button" className="icon-btn" title="从此收藏夹移除" aria-label="移除" onClick={() => favs.removeAt(folderId, index)}>
            ✕
          </button>
        </div>
      ) : (
        <span className="fav-tile-star"><CollectStar atom={it.atom} title={view.title} /></span>
      )}
    </Card>
  );
}
