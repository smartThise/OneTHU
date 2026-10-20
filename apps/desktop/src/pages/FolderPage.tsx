import { IconBtn } from "@onethu/gui";
import { Input } from "@onethu/gui";
import { Btn } from "@onethu/gui";
/**
 * 用户收藏夹页（万物收藏项化 · 跳转入口层）。
 * - 子收藏夹 = 功能原始页同款 segmented 导航栏：直属收藏项落最左「默认」栏，
 *   各子收藏夹一栏；没有子收藏夹就没有导航栏；「管理栏目」与聚合页同款
 *   （TabManageModal 勾选显隐 + ↑↓ 调序 + 恢复默认，tabLayout 按夹分键持久化，
 *   新建子夹天然追加可见、删除子夹自动对账——与 InfoPage/LifePage/ReservePage
 *   完全同构）；子层内容递归同构，最深四层；
 * - 瀑布流：收藏项长卡全宽、方卡瓦片块（相邻方卡聚块，顺序语义不变）；子收藏夹
 *   项不进瀑布流（只做栏），收藏项排序与相邻收藏项交换（跨子夹引用不挡排序）；
 * - 收藏项点击 = 跳回原位功能页特定位置（深链），组件收藏项整卡直播；
 * - 编辑模式：添加收藏项（搜索弹层）/ 新建子收藏夹 / 重命名 / 删除（页头=根，
 *   栏内=子夹），与聚合页「栏目删减走管理栏目、实体删除走页内」同思路。
 */
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNotifyBackend } from "../components/useNotifyBackend.js";
import { bindingOf, loadWidgetInstances } from "../state/widgetInstances.js";
import { requestWidgetBind } from "../state/widgetBindUi.js";
import { Card, Empty, PageHead, SegmentedOverflow } from "../components/Layout.js";
import { TabManageModal } from "../components/TabManageModal.js";
import { FolderIcon, FOLDER_ICONS, IconChevron, IconPen } from "../components/Icons.js";
import { useApp } from "../state/context.js";
import { useFavs } from "../state/favs.js";
import type { AtomRef } from "../state/favorites.js";
import { canNestUnder, FAVS_MAX_DEPTH } from "../state/favorites.js";
import { resolveAtom } from "../state/atoms.js";
import { AtomPickerModal, CollectStar } from "../components/Collect.js";
import { loadTabLayout, saveTabLayout, type TabLayout } from "../lib/tabLayout.js";
import { confirmOk } from "../lib/confirm.js";
import { useTabDirection } from "../lib/motion.js";
import { t as i18n } from "../i18n/index.js";


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
        <PageHead title={i18n("auto.pages.FolderPage.1")} />
        <Card>
          <Empty text="该收藏夹不存在或已被删除。" />
        </Card>
      </>
    );
  }

  const orderIdx = favs.data.order.indexOf(rootId);

  const removeRoot = async () => {
    const ok = await confirmOk("删除收藏夹「" + folder.title + "」？\n其子收藏夹与收录的收藏项入口将一并删除（原功能不受影响）。");
    if (!ok) return;
    favs.remove(rootId);
    setEditing(false);
    navigate("homepage");
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
        meta={"收藏夹 · " + atomCount + " 收藏项" + (subCount > 0 ? " · " + subCount + " 子收藏夹" : "")}
        actions={
          editing ? (
            <>
              <Btn variant="outline" onClick={() => { setRenameVal(folder.title); setRenaming(true); }}>{i18n("auto.pages.FolderPage.2")}</Btn>
              <Btn variant="outline" disabled={orderIdx <= 0} titleAttr={i18n("auto.pages.FolderPage.3")} onClick={() => favs.moveRoot(rootId, -1)}>{i18n("auto.pages.FolderPage.4")}</Btn>
              <Btn variant="outline" disabled={orderIdx >= favs.data.order.length - 1} titleAttr={i18n("auto.pages.FolderPage.5")} onClick={() => favs.moveRoot(rootId, 1)}>{i18n("auto.pages.FolderPage.6")}</Btn>
              <Btn variant="solid" tone="error" onClick={() => void removeRoot()}>{i18n("auto.pages.FolderPage.7")}</Btn>
              <Btn variant="solid" tone="brand" onClick={() => setEditing(false)}>{i18n("auto.pages.FolderPage.8")}</Btn>
            </>
          ) : (
            <Btn variant="outline" onClick={() => setEditing(true)}><IconPen width={14} height={14} />{i18n("auto.pages.FolderPage.9")}</Btn>
          )
        }
      />
      <FolderView folderId={rootId} editing={editing} isRoot />
    </>
  );
}

/* ══════════ 单层收藏夹视图：导航栏（有子夹时）+ 直属瀑布流，递归 ══════════ */

/* ══════════ 桌面小组件：把收藏内容一键放上桌面（仅 Android） ══════════ */

/** 桌面上是否已有某块小组件正在显示这个收藏夹 */
function isWidgetFolder(folderId: string): boolean {
  const map = loadWidgetInstances();
  return Object.values(map.byId).some((b) => b.kind === "folder" && b.folderId === folderId);
}

/** 桌面上是否已有某块小组件正在显示这个收藏项（详情或快捷方式都算） */
function isWidgetAtom(atom: AtomRef): boolean {
  const map = loadWidgetInstances();
  return Object.values(map.byId).some(
    (b) => (b.kind === "detail" || b.kind === "shortcut") && b.atom.kind === atom.kind && b.atom.key === atom.key,
  );
}

/** 夹级入口：编辑态工具栏上的「上桌面 / 已在桌面」 */
function FolderWidgetButton({ folderId }: { folderId: string }): ReactNode {
  const backend = useNotifyBackend();
  const [, bump] = useState(0);
  if (backend !== "android") return null;      // 桌面端不做小组件：不显示假入口
  const on = isWidgetFolder(folderId);
  return (
    <Btn variant="outline" titleAttr={on ? "这块收藏夹已经在桌面某块小组件上" : "把本收藏夹放上桌面小组件（图标组）"} onClick={() => {
        requestWidgetBind({ to: "pick", binding: { kind: "folder", folderId } });
        bump((n) => n + 1);
      }}>{on ? "已在桌面" : "上桌面"}</Btn>
  );
}

/** 收藏项级入口：长卡工具条上的「桌」 */
function AtomWidgetButton({ atom }: { atom: AtomRef }): ReactNode {
  const backend = useNotifyBackend();
  const [, bump] = useState(0);
  if (backend !== "android") return null;
  const on = isWidgetAtom(atom);
  return (
    <button
      type="button"
      className="icon-btn"
      title={on ? "这个收藏项已经在桌面某块小组件上" : "把这个收藏项显示到桌面小组件（详情）"}
      aria-label={i18n("auto.pages.FolderPage.10")}
      onClick={() => {
        requestWidgetBind({ to: "pick", binding: { kind: "detail", atom: { kind: atom.kind, key: atom.key } } });
        bump((n) => n + 1);
      }}
    >
      {i18n("auto.pages.FolderPage.11")}</button>
  );
}

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
  const [iconOpen, setIconOpen] = useState(false);

  /* 栏目布局与页签方向必须在早返回**之前**算完：Hook 不能出现在 `if (!f) return null` 之后，
     否则收藏夹被删除时本次渲染比上次多一个 Hook → React 抛错且错误边界兜不住 → 整窗白屏
     （tools/hook-order-test.mjs 静态钉死这条）。f 缺失时按空栏目算，返回值马上被丢弃。 */
  const subIds = f ? f.items.filter((it) => it.t === "f" && !!favs.data.folders[it.id]).map((it) => (it as { id: string }).id) : [];
  const tabIds = [ROOT_TAB, ...subIds];
  const { order, hidden } = loadTabLayout("fav." + folderId, tabIds);
  const visibleIds = order.filter((id) => !hidden.includes(id));
  /** 当前栏被隐藏/删除 → 回落第一个可见栏（功能页同款） */
  const effTab = visibleIds.includes(tab) ? tab : visibleIds[0];
  // 页签切换方向（决定内容从哪一侧滑入）
  const tabDir = useTabDirection(effTab ?? null, visibleIds);

  if (!f) return null;
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
    const ok = await confirmOk("删除子收藏夹「" + f.title + "」？\n其子层与收录的收藏项入口将一并删除（原功能不受影响）。");
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
              <Btn variant="ghost" onClick={() => setManageOpen(true)}>{i18n("auto.pages.FolderPage.12")}</Btn>
            </div>
          ) : null}

          {editing ? (
            <div className="fav-toolbar">
              <Btn variant="outline" onClick={() => setPickerOpen(true)}>{i18n("auto.pages.FolderPage.13")}</Btn>
              <Btn variant="outline" titleAttr={i18n("auto.pages.FolderPage.14")} onClick={() => setIconOpen(true)}>{i18n("auto.pages.FolderPage.15")}</Btn>
              <Btn variant="outline" disabled={!canNestUnder(favs.data, folderId)} titleAttr={canNestUnder(favs.data, folderId) ? undefined : "最多 " + FAVS_MAX_DEPTH + " 层收藏夹"} onClick={() => {
                  setNewSub(true);
                  setNewSubName("");
                }}>{i18n("auto.pages.FolderPage.16")}</Btn>
              <FolderWidgetButton folderId={folderId} />
              {!isRoot && !renaming ? (
                <Btn variant="outline" onClick={() => { setRenameVal(f.title); setRenaming(true); }}>{i18n("auto.pages.FolderPage.2")}</Btn>
              ) : null}
              {!isRoot ? (
                <Btn variant="solid" tone="error" onClick={() => void removeSelf()}>{i18n("auto.pages.FolderPage.17")}</Btn>
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
                {isRoot ? "根收藏夹的重命名/删除在页头；收藏项排序点各项 ↑↓。" : "栏目显隐与排序点右上「管理栏目」。"}
              </span>
            </div>
          ) : null}

          {newSub ? (
            <div className="fav-newsub">
              <Input autoFocus placeholder={i18n("auto.pages.FolderPage.18")} value={newSubName} onChange={(value) => setNewSubName(value)} onKeyDown={(e) => {
                  if (e.key === "Enter") createSub();
                  if (e.key === "Escape") setNewSub(false);
                }} />
              <Btn variant="solid" tone="brand" disabled={!canNestUnder(favs.data, folderId)} onClick={createSub}>{i18n("auto.pages.FolderPage.19")}</Btn>
              <Btn variant="ghost" onClick={() => setNewSub(false)}>{i18n("auto.pages.FolderPage.20")}</Btn>
            </div>
          ) : null}

          {visibleIds.map((id) => (
            <div key={id} hidden={effTab !== id} className={effTab === id ? "tab-anim" : undefined} data-dir={tabDir}>
              {visited.has(id) || id === effTab ? (
                id === ROOT_TAB ? (
                  <>
                    <ItemsBlock folderId={folderId} editing={editing} />
                    {directAtoms === 0 ? (
                      <Card>
                        <Empty text="此栏暂无收藏项——「编辑」→「添加收藏项」搜索添加，或在任意页面点星标收藏。" />
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
      {iconOpen ? (
        <IconPickerModal
          current={f.icon}
          onPick={(name) => {
            favs.setIcon(folderId, name);
            setIconOpen(false);
          }}
          onClose={() => setIconOpen(false)}
        />
      ) : null}
    </>
  );
}

/* ══════════ 瀑布流（直属收藏项；子收藏夹项不进流，只做导航栏） ══════════ */

function ItemsBlock({ folderId, editing }: { folderId: string; editing: boolean }) {
  const favs = useFavs();
  const f = favs.data.folders[folderId];
  if (!f) return null;
  const items = f.items;

  /** 与最近的相邻收藏项交换（子收藏夹项是导航栏，不挡收藏项排序） */
  const moveAtom = (index: number, dir: -1 | 1) => {
    let j = index + dir;
    while (j >= 0 && j < items.length && items[j]!.t !== "a") j += dir;
    if (j < 0 || j >= items.length) return;
    favs.swap(folderId, index, j);
  };

  /** 连续的方卡收藏项聚成一个瓦片块（跳过子夹引用，保持顺序语义） */
  type Block = { t: "tiles"; from: number; items: number[] } | { t: "one"; index: number };
  const blocks: Block[] = [];
  let cur: Block | null = null;
  items.forEach((it, i) => {
    if (it.t !== "a") return;
    /* 方/长判定：显式 sq 优先；缺省按 defaultSq/tileLive。今日 widget 件无方卡形态
       恒为长卡；教室这类「方=当前节、长=今日总览」双形态收藏项两种都允许 */
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

/** 收藏项长卡（widget=整卡直播） */
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
  if (!view) return null; // 注册表已下线的收藏项：直接不渲染

  const tools = (
    <div className="home-card-tools">
      <IconBtn label={i18n("auto.pages.FolderPage.4")} icon={<IconChevron width={13} height={13} style={{ transform: "rotate(-90deg)" }} />} onClick={() => moveAtom(index, -1)} />
      <IconBtn label={i18n("auto.pages.FolderPage.6")} icon={<IconChevron width={13} height={13} style={{ transform: "rotate(90deg)" }} />} onClick={() => moveAtom(index, 1)} />
      {/* 长卡上的「方」：今日 widget 件没有方卡形态，双形态收藏项（教室）才有 */}
      {!view.widget || view.tileLive ? (
        <button type="button" className="icon-btn" title={i18n("auto.pages.FolderPage.21")} aria-label={i18n("auto.pages.FolderPage.21")} onClick={() => favs.setVariant(folderId, index, true)}>
          {i18n("auto.pages.FolderPage.22")}</button>
      ) : null}
      <AtomWidgetButton atom={it.atom} />
      <button type="button" className="icon-btn" title={i18n("auto.pages.FolderPage.23")} aria-label={i18n("auto.pages.FolderPage.24")} onClick={() => favs.removeAt(folderId, index)}>
        ✕
      </button>
    </div>
  );

  if (view.widget) {
    const body = view.widget();
    return (
      <section className="home-card fav-widget">
        <div className="home-card-head">
          <button type="button" className="home-card-title" onClick={() => view.open(navigate)} title={i18n("auto.pages.FolderPage.25")}>
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
              <IconBtn label={i18n("auto.pages.FolderPage.4")} icon={<IconChevron width={13} height={13} style={{ transform: "rotate(-90deg)" }} />} onClick={() => moveAtom(index, -1)} />
              <IconBtn label={i18n("auto.pages.FolderPage.6")} icon={<IconChevron width={13} height={13} style={{ transform: "rotate(90deg)" }} />} onClick={() => moveAtom(index, 1)} />
              {!view.widget || view.tileLive ? (
                <button type="button" className="icon-btn" title={i18n("auto.pages.FolderPage.21")} aria-label={i18n("auto.pages.FolderPage.21")} onClick={() => favs.setVariant(folderId, index, true)}>
                  {i18n("auto.pages.FolderPage.22")}</button>
              ) : null}
              <button type="button" className="icon-btn" title={i18n("auto.pages.FolderPage.23")} aria-label={i18n("auto.pages.FolderPage.24")} onClick={() => favs.removeAt(folderId, index)}>
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
            <button type="button" className="icon-btn" title={i18n("auto.pages.FolderPage.26")} aria-label={i18n("auto.pages.FolderPage.26")} onClick={() => favs.setVariant(folderId, index, false)}>
              {i18n("auto.pages.FolderPage.27")}</button>
          ) : null}
          <button type="button" className="icon-btn" title={i18n("auto.pages.FolderPage.23")} aria-label={i18n("auto.pages.FolderPage.24")} onClick={() => favs.removeAt(folderId, index)}>
            ✕
          </button>
        </div>
      ) : (
        <span className="fav-tile-star"><CollectStar atom={it.atom} title={view.title} /></span>
      )}
    </Card>
  );
}


/** 收藏夹图标选择弹层（图标库 = Icons.FOLDER_ICONS；「默认」恢复 IconFolder） */
function IconPickerModal({ current, onPick, onClose }: { current?: string; onPick: (name?: string) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="home-modal-mask" onClick={onClose}>
      <div className="home-modal" role="dialog" aria-modal="true" aria-label={i18n("auto.pages.FolderPage.28")} onClick={(e) => e.stopPropagation()}>
        <div className="home-modal-head">
          <h3>{i18n("auto.pages.FolderPage.29")}</h3>
          <Btn variant="ghost" onClick={onClose}>{i18n("auto.pages.FolderPage.30")}</Btn>
        </div>
        <div className="home-modal-body">
          <div className="home-modal-hint">{i18n("auto.pages.FolderPage.31")}</div>
          <div className="icon-grid">
            <button type="button" className={"icon-cell" + (!current ? " is-active" : "")} title={i18n("auto.pages.FolderPage.32")} onClick={() => onPick(undefined)}>
              <FolderIcon name={undefined} width={18} height={18} />
            </button>
            {Object.entries(FOLDER_ICONS)
              .filter(([k]) => k !== "folder")
              .map(([k, C]) => (
                <button key={k} type="button" className={"icon-cell" + (current === k ? " is-active" : "")} title={k} onClick={() => onPick(k)}>
                  <C width={18} height={18} />
                </button>
              ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
