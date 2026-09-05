/**
 * 用户收藏夹页（万物原子化 · 跳转入口层）。
 * - 子收藏夹 = 功能原始页同款 segmented 导航栏：直属原子落最左「默认」栏，
 *   各子收藏夹一栏；没有子收藏夹就没有导航栏；「管理栏目」与聚合页同款
 *   （TabManageModal 勾选显隐 + ↑↓ 调序 + 恢复默认，tabLayout 按夹分键持久化，
 *   新建子夹天然追加可见、删除子夹自动对账——与 InfoPage/LifePage/ReservePage
 *   完全同构）；子层内容递归同构，最深四层；
 * - 瀑布流：原子长卡全宽、方卡瓦片块（相邻方卡聚块，顺序语义不变）；子收藏夹
 *   项不进瀑布流（只做栏），原子排序与相邻原子交换（跨子夹引用不挡排序）；
 * - 原子点击 = 跳回原位功能页特定位置（深链），组件原子整卡直播；
 * - 编辑模式：添加原子（搜索弹层）/ 新建子收藏夹 / 重命名 / 删除（页头=根，
 *   栏内=子夹），与聚合页「栏目删减走管理栏目、实体删除走页内」同思路。
 */
import { useState } from "react";
import { Card, Empty, PageHead, SegmentedOverflow } from "../components/Layout.js";
import { TabManageModal } from "../components/TabManageModal.js";
import { IconChevron, IconRefresh } from "../components/Icons.js";
import { useApp } from "../state/context.js";
import { useFavs } from "../state/favs.js";
import type { AtomRef } from "../state/favorites.js";
import { canNestUnder, FAVS_MAX_DEPTH } from "../state/favorites.js";
import { resolveAtom } from "../state/atoms.js";
import { AtomPickerModal, CollectStar } from "../components/Collect.js";
import { loadTabLayout, saveTabLayout, type TabLayout } from "../lib/tabLayout.js";
import { confirmOk } from "../lib/confirm.js";

const ROOT_TAB = "__root";

export function FolderPage() {
  const { navParams, navigate } = useApp();
  const favs = useFavs();
  const rootId = navParams?.folderId ?? null;
  const folder = rootId ? favs.data.folders[rootId] : undefined;

  const [editing, setEditing] = useState(false);
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

  const removeRoot = async () => {
    const ok = await confirmOk("删除收藏夹「" + folder.title + "」？\n其子收藏夹与收录的原子入口将一并删除（原功能不受影响）。");
    if (!ok) return;
    favs.remove(rootId);
    setEditing(false);
    navigate("today");
  };

  const atomCount = folder.items.filter((it) => it.t === "a").length;
  const subCount = folder.items.filter((it) => it.t === "f" && !!favs.data.folders[it.id]).length;

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
        meta={"收藏夹 · " + atomCount + " 原子" + (subCount > 0 ? " · " + subCount + " 子收藏夹" : "")}
        actions={
          editing ? (
            <>
              <button className="btn" onClick={() => { setRenameVal(folder.title); setRenaming(true); }}>重命名</button>
              <button className="btn btn-danger" onClick={() => void removeRoot()}>删除收藏夹</button>
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
      <FolderView folderId={rootId} editing={editing} isRoot />
    </>
  );
}

/* ══════════ 单层收藏夹视图：导航栏（有子夹时）+ 直属瀑布流，递归 ══════════ */

export function FolderView({ folderId, editing, isRoot = false }: { folderId: string; editing: boolean; isRoot?: boolean }) {
  const favs = useFavs();
  const f = favs.data.folders[folderId];

  const [tab, setTab] = useState<string>(ROOT_TAB);
  /** 已激活过的栏保持挂载（功能页 visited 同款）：切回即显，widget 不重挂载 */
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set([ROOT_TAB]));
  /** 栏目布局（显隐 + 顺序）：按夹分键持久化；每渲染现读现对账（新建子夹补尾可见、
   *  删除子夹自动丢弃、被隐藏的子夹恢复可见），apply 只写盘并触发重渲染 */
  const [, bumpLayout] = useState(0);
  const [manageOpen, setManageOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newSub, setNewSub] = useState(false);
  const [newSubName, setNewSubName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");

  if (!f) return null;

  const subIds = f.items.filter((it) => it.t === "f" && !!favs.data.folders[it.id]).map((it) => (it as { id: string }).id);
  const tabIds = [ROOT_TAB, ...subIds];
  const { order, hidden } = loadTabLayout("fav." + folderId, tabIds);
  const visibleIds = order.filter((id) => !hidden.includes(id));
  /** 当前栏被隐藏/删除 → 回落第一个可见栏（功能页同款） */
  const effTab = visibleIds.includes(tab) ? tab : visibleIds[0];
  const labelOf = (id: string) => (id === ROOT_TAB ? "默认" : favs.data.folders[id]?.title ?? "收藏夹");
  const activate = (id: string) => {
    setTab(id);
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  };
  const applyLayout = (l: TabLayout) => {
    saveTabLayout("fav." + folderId, l);
    bumpLayout((v) => v + 1);
  };
  const directAtoms = f.items.filter((it) => it.t === "a").length;

  const createSub = () => {
    favs.create(newSubName || "子收藏夹", folderId);
    setNewSub(false);
    setNewSubName("");
  };
  const removeSelf = async () => {
    const ok = await confirmOk("删除子收藏夹「" + f.title + "」？\n其子层与收录的原子入口将一并删除（原功能不受影响）。");
    if (ok) favs.remove(folderId);
  };

  return (
    <>
      {visibleIds.length === 0 ? (
        <Card>
          <Empty text="所有栏目已隐藏，点「管理栏目」恢复。" />
        </Card>
      ) : (
        <>
          {subIds.length > 0 ? (
            /* 功能页同款导航栏：默认在最左 + 各子收藏夹；右侧管理栏目 */
            <div className="fav-nav" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
              <SegmentedOverflow ariaLabel="收藏夹栏目" style={{ flex: "1 1 auto", minWidth: 0 }}>
                {visibleIds.map((id) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={effTab === id}
                    className={effTab === id ? "is-active" : ""}
                    onClick={() => activate(id)}
                  >
                    {labelOf(id)}
                  </button>
                ))}
              </SegmentedOverflow>
              <button className="btn btn-ghost" style={{ flex: "0 0 auto" }} onClick={() => setManageOpen(true)}>
                管理栏目
              </button>
            </div>
          ) : null}

          {editing ? (
            <div className="fav-toolbar">
              <button className="btn" onClick={() => setPickerOpen(true)}>添加原子</button>
              <button
                className="btn"
                disabled={!canNestUnder(favs.data, folderId)}
                title={canNestUnder(favs.data, folderId) ? undefined : "最多 " + FAVS_MAX_DEPTH + " 层收藏夹"}
                onClick={() => {
                  setNewSub(true);
                  setNewSubName("");
                }}
              >
                新建子收藏夹
              </button>
              {!isRoot && !renaming ? (
                <button className="btn" onClick={() => { setRenameVal(f.title); setRenaming(true); }}>重命名</button>
              ) : null}
              {!isRoot ? (
                <button className="btn btn-danger" onClick={() => void removeSelf()}>删除子收藏夹</button>
              ) : null}
              {renaming ? (
                <input
                  className="input"
                  autoFocus
                  value={renameVal}
                  onChange={(e) => setRenameVal(e.target.value)}
                  onBlur={() => {
                    favs.rename(folderId, renameVal);
                    setRenaming(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      favs.rename(folderId, renameVal);
                      setRenaming(false);
                    }
                  }}
                  style={{ maxWidth: 220 }}
                />
              ) : null}
              <span className="fav-toolbar-hint">
                {isRoot ? "根收藏夹的重命名/删除在页头；原子排序点各项 ↑↓。" : "栏目显隐与排序点右上「管理栏目」。"}
              </span>
            </div>
          ) : null}

          {newSub ? (
            <div className="fav-newsub">
              <input
                className="input"
                autoFocus
                placeholder="子收藏夹名称…"
                value={newSubName}
                onChange={(e) => setNewSubName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createSub();
                  if (e.key === "Escape") setNewSub(false);
                }}
              />
              <button className="btn btn-primary" disabled={!canNestUnder(favs.data, folderId)} onClick={createSub}>创建</button>
              <button className="btn btn-ghost" onClick={() => setNewSub(false)}>取消</button>
            </div>
          ) : null}

          {visibleIds.map((id) => (
            <div key={id} hidden={effTab !== id}>
              {visited.has(id) || id === effTab ? (
                id === ROOT_TAB ? (
                  <>
                    <ItemsBlock folderId={folderId} editing={editing} />
                    {directAtoms === 0 ? (
                      <Card>
                        <Empty text="此栏暂无原子——「编辑」→「添加原子」搜索添加，或在任意页面点星标收藏。" />
                      </Card>
                    ) : null}
                  </>
                ) : (
                  <FolderView folderId={id} editing={editing} />
                )
              ) : null}
            </div>
          ))}
        </>
      )}

      {manageOpen ? (
        <TabManageModal
          open
          onClose={() => setManageOpen(false)}
          title={"管理「" + f.title + "」栏目"}
          tabs={tabIds.map((id) => ({ id, label: labelOf(id) }))}
          layout={{ order, hidden }}
          onApply={applyLayout}
          onReset={() => applyLayout({ order: tabIds, hidden: [] })}
        />
      ) : null}
      {pickerOpen ? (
        <AtomPickerModal onPick={(atom: AtomRef) => favs.addAtom(folderId, atom)} onClose={() => setPickerOpen(false)} />
      ) : null}
    </>
  );
}

/* ══════════ 瀑布流（直属原子；子收藏夹项不进流，只做导航栏） ══════════ */

function ItemsBlock({ folderId, editing }: { folderId: string; editing: boolean }) {
  const favs = useFavs();
  const f = favs.data.folders[folderId];
  if (!f) return null;
  const items = f.items;

  /** 与最近的相邻原子交换（子收藏夹项是导航栏，不挡原子排序） */
  const moveAtom = (index: number, dir: -1 | 1) => {
    let j = index + dir;
    while (j >= 0 && j < items.length && items[j]!.t !== "a") j += dir;
    if (j < 0 || j >= items.length) return;
    favs.swap(folderId, index, j);
  };

  /** 连续的方卡原子聚成一个瓦片块（跳过子夹引用，保持顺序语义） */
  type Block = { t: "tiles"; from: number; items: number[] } | { t: "one"; index: number };
  const blocks: Block[] = [];
  let cur: Block | null = null;
  items.forEach((it, i) => {
    if (it.t !== "a") return;
    /* 方/长判定：显式 sq 优先；缺省按 defaultSq/tileLive。今日 widget 件无方卡形态
       恒为长卡；教室这类「方=当前节、长=今日总览」双形态原子两种都允许 */
    const v0 = resolveAtom(it.atom);
    const canTile = !v0?.widget || !!v0?.tileLive;
    const isSqTile = canTile && (it.sq === true || (it.sq == null && !!(v0?.defaultSq || v0?.tileLive)));
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
          <OneItem key={"i" + b.index} folderId={folderId} index={b.index} editing={editing} moveAtom={moveAtom} />
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

/** 原子长卡（widget=整卡直播） */
function OneItem({
  folderId, index, editing, moveAtom,
}: {
  folderId: string;
  index: number;
  editing: boolean;
  moveAtom: (index: number, dir: -1 | 1) => void;
}) {
  const favs = useFavs();
  const { navigate } = useApp();
  const f = favs.data.folders[folderId];
  const it = f?.items[index];
  if (!f || !it || it.t !== "a") return null;
  const view = resolveAtom(it.atom);
  if (!view) return null; // 注册表已下线的原子：直接不渲染

  const tools = (
    <div className="home-card-tools">
      <button type="button" className="icon-btn" title="上移" aria-label="上移" onClick={() => moveAtom(index, -1)}>
        <IconChevron width={13} height={13} style={{ transform: "rotate(-90deg)" }} />
      </button>
      <button type="button" className="icon-btn" title="下移" aria-label="下移" onClick={() => moveAtom(index, 1)}>
        <IconChevron width={13} height={13} style={{ transform: "rotate(90deg)" }} />
      </button>
      {/* 长卡上的「方」：今日 widget 件没有方卡形态，双形态原子（教室）才有 */}
      {!view.widget || view.tileLive ? (
        <button type="button" className="icon-btn" title="改为方卡" aria-label="改为方卡" onClick={() => favs.setVariant(folderId, index, true)}>
          方
        </button>
      ) : null}
      <button type="button" className="icon-btn" title="从此收藏夹移除" aria-label="移除" onClick={() => favs.removeAt(folderId, index)}>
        ✕
      </button>
    </div>
  );

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
              <button type="button" className="icon-btn" title="上移" aria-label="上移" onClick={() => moveAtom(index, -1)}>
                <IconChevron width={13} height={13} style={{ transform: "rotate(-90deg)" }} />
              </button>
              <button type="button" className="icon-btn" title="下移" aria-label="下移" onClick={() => moveAtom(index, 1)}>
                <IconChevron width={13} height={13} style={{ transform: "rotate(90deg)" }} />
              </button>
              {!view.widget || view.tileLive ? (
                <button type="button" className="icon-btn" title="改为方卡" aria-label="改为方卡" onClick={() => favs.setVariant(folderId, index, true)}>
                  方
                </button>
              ) : null}
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
        {view.tileLive ? <span className="fav-tile-live">{view.tileLive()}</span> : null}
        {view.sub ? <span className="fav-tile-sub">{view.sub}</span> : null}
      </button>
      {editing ? (
        <div className="fav-tile-tools">
          {view.widget ? (
            <button type="button" className="icon-btn" title="改为长卡" aria-label="改为长卡" onClick={() => favs.setVariant(folderId, index, false)}>
              长
            </button>
          ) : null}
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
