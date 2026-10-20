import { vaultCatchWorkspace } from "../../lib/vaultCatch.js";
import { Input, Row } from "@onethu/gui";
import { Btn } from "@onethu/gui";
/**
 * OneGO 抽屉（dev-explorer）：从收藏夹升级来的「工作组织工具」。
 * 两个分段：我的收藏（OnePage）| 工作区。
 * - OnePage 现阶段按普通收藏夹格式组织（含子收藏夹——在一个 OnePage 里放
 *   另一个 OnePage 的入口）；点击 = 在新标签页打开该收藏夹页（FolderPage）。
 * - 工作区段与 TabDrawer 共用 WorkspacePanel（一份逻辑，两处引用）。
 * 开合是模块级 store（palette.ts 同款写法）。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { closeLiveWorkspace, dissolveWorkspace, explorerSnapshot, focusTab, HOME_TAB_ID, openTab, openWorkspace, subscribeExplorer } from "../../state/explorer.js";
import { useExitPhase } from "../../lib/useExitPhase.js";
import { useIsPhone, useSheetSnap } from "../../state/phoneSheets.js";
import { PhoneSheetGrip, useSheetDrag } from "./PhoneSheet.js";
import { openContextMenu, type MenuItem } from "./ContextMenu.js";
import { useDrawerRowsReorder } from "./TabDrawer.js";
import { useAnchorPos } from "./TabDrawer.js";
import { useExpanded } from "../../state/usePlatformLayout.js";
import { useFavs } from "../../state/favs.js";
import { createOnePage, openOnePage, removeOnePage, renameOnePage, userOnePages } from "../../state/onePage.js";
import type { Board } from "../../state/boardCore.js";
import { resolveAtom } from "../../state/atoms.js";
import type { LearnNav, Page } from "../../state/app.js";
import { useApp } from "../../state/context.js";
import { FolderIcon } from "../Icons.js";
import { WorkspacePanel } from "./TabDrawer.js";
import { openFolderIconPicker } from "./FolderIconPicker.js";
import { showToast } from "../../state/toast.js";
import {
  activateUserTheme,
  deleteFlow,
  deleteTheme,
  runFlowNow,
  setFlowEnabled,
  subscribeUserExt,
  userExtSnapshot,
} from "../../state/userext.js";
import { confirmOk } from "../../lib/confirm.js";
import { openWorkspaceEditor } from "./WorkspaceEditor.js";
import { openFormModal } from "../../lib/formModal.js";
import { t as i18n } from "../../i18n/index.js";


/* ══════════ 抽屉开合 store（palette.ts 同款） ══════════ */

let sheetOpen = false;
const sheetListeners = new Set<() => void>();

function emitSheet(): void {
  for (const f of sheetListeners) f();
}

export function openOneGoSheet(): void {
  if (!sheetOpen) {
    sheetOpen = true;
    emitSheet();
  }
}

export function closeOneGoSheet(): void {
  if (sheetOpen) {
    sheetOpen = false;
    emitSheet();
  }
}

function subscribeSheet(f: () => void): () => void {
  sheetListeners.add(f);
  return () => {
    sheetListeners.delete(f);
  };
}

export function useOneGoSheetOpen(): boolean {
  return useSyncExternalStore(subscribeSheet, () => sheetOpen, () => false);
}

/* ══════════ 我的收藏（OnePage）分段 ══════════ */

function FavsSection({ onDone }: { onDone: () => void }): ReactNode {
  const { navigate } = useApp();
  const [name, setName] = useState("");
  const [tick, setTick] = useState(0);
  /* OnePage = 白板（2026-10-13 定案）：列出 BoardDoc.boards；点击 = 设为当前板并打开白板页 */
  useEffect(() => {
    const on = (): void => setTick((t) => t + 1);
    window.addEventListener("onethu.boards.changed", on);
    return () => window.removeEventListener("onethu.boards.changed", on);
  }, []);
  /* 只列**用户的** OnePage（2026-10-15 用户实测）：系统板（「首页」）不是一块可打开的 OnePage，
     把它列进来，点「首页」等于"把首页当白板打开"，看到的是旧板面而不是首页。首页另有入口：
     顶栏 Logo、程序坞、以及本表下方的「功能目录在首页」。 */
  const boards = userOnePages();
  void tick;

  const create = (): void => {
    const t = name.trim();
    if (!t) return;
    const id = createOnePage(t);
    setName("");
    if (id) {
      openOnePage(id);
      openTab("board", null, { title: t });
      onDone();
    }
  };

  const openBoard = (b: Board): void => {
    openOnePage(b.id);
    openTab("board", null, { title: b.name });
    onDone();
  };

  const remove = (b: Board): void => {
    void confirmOk(`确定删除 OnePage「${b.name}」？\n这块白板和其中的内容都会永久消失！`).then((ok) => {
      if (ok) removeOnePage(b.id);
    });
  };

  const rename = async (b: Board): Promise<void> => {
    const f = await openFormModal("重命名 OnePage", [
      { key: "name", label: i18n("auto.components.explorer.OneGoSheet.p1"), required: true, default: b.name },
    ]);
    if (!f) return;
    renameOnePage(b.id, f.name ?? b.name);
  };

  const rowMenu = (b: Board, x: number, y: number): void => {
    openContextMenu(x, y, [
      { label: i18n("auto.components.explorer.OneGoSheet.p2"), onSelect: () => void rename(b) },
      { label: i18n("auto.components.explorer.OneGoSheet.p3"), onSelect: () => openFolderIconPicker(b.id) },
      { label: i18n("auto.components.explorer.OneGoSheet.p4"), onSelect: () => { openOnePage(b.id); showToast(`当前 OnePage：${b.name}`); } },
      { label: i18n("auto.components.explorer.OneGoSheet.p5"), danger: true, sepBefore: true, onSelect: () => remove(b) },
    ]);
  };

  return (
    <section aria-label={i18n("auto.components.explorer.OneGoSheet.1")}>
      <div className="ex-sec-head">
        <b>{i18n("auto.components.explorer.OneGoSheet.1")}</b>
      </div>
      {/* 「首页」入口（2026-10-15 用户点名「点击首页回首页」）：系统板不是 OnePage，不能列成一块板，
          但"回首页"这件事必须在这个列表里点得到 —— 它聚焦首页标签（与顶栏 Logo 同一条路）。
          用 GUI 的 Row（可点）而不是自写的裸按钮元素：仓库的裸控件棘轮只许降不许涨（R4）。 */}
      <Row
        title={i18n("auto.components.explorer.OneGoSheet.2")}
        sub={i18n("auto.components.explorer.OneGoSheet.3")}
        onClick={() => {
          focusTab(HOME_TAB_ID);
          onDone();
        }}
      />
      <div className="ex-newrow">
        <Input placeholder={i18n("auto.components.explorer.OneGoSheet.4")} value={name} onChange={(value) => setName(value)} onKeyDown={(e) => {
            if (e.key === "Enter") create();
          }} />
        <Btn variant="outline" onClick={create} disabled={!name.trim()}>{i18n("auto.components.explorer.OneGoSheet.5")}</Btn>
      </div>
      {boards.length === 0 ? (
        <div className="ex-empty-hint">{i18n("auto.components.explorer.OneGoSheet.6")}</div>
      ) : (
        <div className="ex-row-list">
          {boards.map((b) => (
            <div key={b.id} className="ex-row-wrap">
              <button
                className="ex-row ex-row-clickable"
                onClick={() => openBoard(b)}
                onContextMenu={(e) => { e.preventDefault(); rowMenu(b, e.clientX, e.clientY); }}
              >
                <span className="ex-row-icon"><FolderIcon name={b.icon ?? "fist"} /></span>
                <span className="ex-row-main">
                  <span className="ex-row-title">{b.name}</span>
                  <span className="ex-row-sub">{b.kind === "system" ? "系统板" : "OnePage"}</span>
                </span>
              </button>
              {b.kind === "system" ? null : (
                <Btn variant="ghost" onClick={(e) => rowMenu(b, e.clientX, e.clientY)}>⋯</Btn>
              )}
            </div>
          ))}
        </div>
      )}
      <Row
        title={i18n("auto.components.explorer.OneGoSheet.7")}
        sub={i18n("auto.components.explorer.OneGoSheet.8")}
        onClick={() => { navigate("boards"); onDone(); }}
      />
      <Row
        title={i18n("auto.components.explorer.OneGoSheet.9")}
        sub={i18n("auto.components.explorer.OneGoSheet.10")}
        onClick={() => { navigate("vault"); onDone(); }}
      />
      <div className="ex-hint-line">{i18n("auto.components.explorer.OneGoSheet.11")}</div>
    </section>
  );
}

/* ══════════ OneFlow（工作区+自动化+技能结合体）══════════ */

function FlowSection({ onDone }: { onDone: () => void }): ReactNode {
  const [, setTick] = useState(0);
  useEffect(() => {
    const off = subscribeUserExt(() => setTick((t) => t + 1));
    return off;
  }, []);
  const flows = userExtSnapshot().flows;
  const themes = userExtSnapshot().themes;
  const activeTheme = userExtSnapshot().activeThemeId;
  const run = (id: string, name: string): void => {
    showToast(`正在运行「${name}」…`);
    void runFlowNow(id).then((r) => {
      if (r.ok) showToast(`「${name}」运行完成`);
      else showToast(`「${name}」失败：${r.error ?? "未知错误"}`);
      setTick((t) => t + 1);
    });
  };
  return (
    <section aria-label="OneFlow">
      <div className="ex-sec-head">
        <b>OneFlow</b>
      </div>
      {flows.length === 0 ? (
        <div className="ex-empty-hint">{i18n("auto.components.explorer.OneGoSheet.12")}</div>
      ) : (
        <div className="ex-row-list">
          {flows.map((f) => (
            <div key={f.id} className="ex-row-wrap">
              <button className="ex-row ex-row-clickable" onClick={() => run(f.id, f.name)}>
                <span className="ex-row-icon"><FolderIcon name="fist" /></span>
                <span className="ex-row-main">
                  <span className="ex-row-title">{f.name}</span>
                  <span className="ex-row-sub">
                    {f.enabled === false ? "已停用 · " : ""}
                    {f.trigger.kind === "manual" ? "手动" : f.trigger.kind === "cron" ? "每 " + f.trigger.everyMinutes + " 分钟" : "事件"} ·{" "}
                    {f.lastRun ? (f.lastOk ? "上次正常" : "上次失败，点这一行重试" + (f.lastError ? "：" + f.lastError : "")) : "未运行过"}
                  </span>
                </span>
              </button>
              <Btn variant="ghost" onClick={() => { setFlowEnabled(f.id, f.enabled === false); }}>{f.enabled === false ? "启用" : "停用"}</Btn>
              <Btn variant="ghost" onClick={() => {
                void confirmOk(`删除 OneFlow「${f.name}」？步骤与运行记录会一起删除。`).then((ok) => {
                  if (ok) { deleteFlow(f.id); showToast(`已删除「${f.name}」`); }
                });
              }}>{i18n("auto.components.explorer.OneGoSheet.13")}</Btn>
            </div>
          ))}
        </div>
      )}
      {themes.length > 0 ? (
        <>
          <div className="ex-sec-head" style={{ marginTop: 10 }}>
            <b>{i18n("auto.components.explorer.OneGoSheet.14")}</b>
          </div>
          <div className="ex-row-list">
            {themes.map((t) => (
              <div key={t.id} className="ex-row-wrap">
                <button
                  className="ex-row ex-row-clickable"
                  onClick={() => activateUserTheme(activeTheme === t.id ? null : t.id)}
                >
                  <span className="ex-row-icon"><FolderIcon name="star" /></span>
                  <span className="ex-row-main">
                    <span className="ex-row-title">{t.name}</span>
                    <span className="ex-row-sub">{activeTheme === t.id ? "生效中（再点恢复默认）" : "点击应用"}</span>
                  </span>
                </button>
                <Btn variant="ghost" onClick={() => deleteTheme(t.id)}>{i18n("auto.components.explorer.OneGoSheet.13")}</Btn>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

/* ══════════ ⑦ 小窗内搜索：OnePage 按 title、工作区按 name（大小写不敏感） ══════════ */

function OneGoSearchResults({ q, onDone }: { q: string; onDone: () => void }): ReactNode {
  const { navigate } = useApp();
  const hits = userOnePages().filter((b) => b.name.toLowerCase().includes(q));
  const wsSnap = useSyncExternalStore(subscribeExplorer, explorerSnapshot, explorerSnapshot);
  const wsHits = wsSnap.workspaces.filter((w) => w.name.toLowerCase().includes(q));
  if (hits.length === 0 && wsHits.length === 0) return <div className="ex-empty-hint">{i18n("auto.components.explorer.OneGoSheet.15")}</div>;
  return (
    <>
      {hits.length > 0 ? (
        <section aria-label={i18n("auto.components.explorer.OneGoSheet.16")}>
          <div className="ex-group-head">
            <span className="ex-group-name">OnePage</span>
            <span className="ex-group-count">{hits.length}</span>
          </div>
          <div className="ex-row-list">
            {hits.map((b) => (
              <div key={b.id} className="ex-row-wrap">
                <button
                  className="ex-row ex-row-clickable"
                  onClick={() => {
                    openOnePage(b.id);
                    openTab("board", null, { title: b.name });
                    onDone();
                  }}
                >
                  <span className="ex-row-icon"><FolderIcon name={b.icon ?? "fist"} /></span>
                  <span className="ex-row-main">
                    <span className="ex-row-title">{b.name}</span>
                    <span className="ex-row-sub">{b.kind === "system" ? "系统板（今日）" : "白板"}</span>
                  </span>
                </button>
                </div>
            ))}
          </div>
        </section>
      ) : null}
      {wsHits.length > 0 ? (
        <section aria-label={i18n("auto.components.explorer.OneGoSheet.17")}>
          <div className="ex-group-head">
            <span className="ex-group-name">{i18n("auto.components.explorer.OneGoSheet.18")}</span>
            <span className="ex-group-count">{wsHits.length}</span>
          </div>
          <div className="ex-row-list">
            {wsHits.map((w) => (
              <div className="ex-row" key={w.id} data-vault-catch={vaultCatchWorkspace({ id: w.id, name: w.name, count: w.tabs.length })}>
                <div className="ex-row-main">
                  <span className="ex-row-title">{w.name}</span>
                  <span className="ex-row-sub">{w.tabs.length} {i18n("auto.components.explorer.OneGoSheet.19")}</span>
                </div>
                <div className="ex-row-actions">
                  <Btn variant="ghost" onClick={() => { openWorkspace(w.id); onDone(); }}>{i18n("auto.components.explorer.OneGoSheet.20")}</Btn>
                  <Btn variant="ghost" onClick={() => openWorkspaceEditor(w.id)}>{i18n("auto.components.explorer.OneGoSheet.21")}</Btn>
                  {w.live ? (
                    <Btn variant="ghost" titleAttr={i18n("auto.components.explorer.OneGoSheet.22")} onClick={() => dissolveWorkspace(w.id)}>{i18n("auto.components.explorer.OneGoSheet.23")}</Btn>
                  ) : null}
                  <Btn variant="ghost" titleAttr={i18n("auto.components.explorer.OneGoSheet.24")} onClick={() =>
                      void confirmOk(`彻底删除工作区「${w.name}」及其中的标签页？`).then((ok) => {
                        if (ok) closeLiveWorkspace(w.id);
                      })
                    }>{i18n("auto.components.explorer.OneGoSheet.25")}</Btn>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

/* ══════════ 抽屉本体 ══════════ */

type SheetTab = "favs" | "ws";

function OneGoSheetInner(): ReactNode {
  const open = useOneGoSheetOpen();
  /* 手机端（A4 同手柄）：seeking 抽屉（0.6vh ⟷ 0.94vh 两档） */
  const phoneUi = useIsPhone();
  const snapState = useSheetSnap("onego");
  const sheetRef = useRef<HTMLElement | null>(null);
  const sheet = useSheetDrag(sheetRef, { id: "onego" });
  const [closing, requestClose] = useExitPhase(closeOneGoSheet, open);
  const expanded = useExpanded();
  const anchor = useAnchorPos("ex-bbar-onego-btn", open, expanded);

  /** 工作区行菜单（与 TabDrawer 同一份语义：打开 / 编辑 / 解散 / 彻底删除；B 的右键口径） */
  const openWsMenuAt = useCallback((x: number, y: number, wsId: string): void => {
    const ws = explorerSnapshot().workspaces.find((w) => w.id === wsId);
    if (!ws) return;
    const count = explorerSnapshot().tabs.filter((t) => t.workspaceId === wsId).length;
    const items: MenuItem[] = [
      { label: i18n("auto.components.explorer.OneGoSheet.p6"), onSelect: () => openWorkspace(wsId) },
      { label: i18n("auto.components.explorer.OneGoSheet.p7"), onSelect: () => openWorkspaceEditor(wsId) },
      { label: i18n("auto.components.explorer.OneGoSheet.p8"), onSelect: () => dissolveWorkspace(wsId), danger: true, sepBefore: true },
      {
        label: i18n("auto.components.explorer.OneGoSheet.p9"),
        onSelect: () =>
          void confirmOk(`彻底删除工作区「${ws.name}」及其中的 ${count} 个标签页？`).then((ok) => {
            if (ok) closeLiveWorkspace(wsId);
          }),
        danger: true,
        sepBefore: true,
      },
    ];
    openContextMenu(x, y, items);
  }, []);

  /** 工作区块与行的长按/右键（触屏行列出工作区行；拖拽在该抽屉不启） */
  const sheetCtl = useDrawerRowsReorder({
    onTabMenu: () => undefined,
    onWsMenu: openWsMenuAt,
    onGroupDrop: () => undefined,
  });
  const [seg, setSeg] = useState<SheetTab>("favs");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent): void => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, requestClose]);

  if (!open) return null;
  return createPortal(
    <>
      <div className={"ex-sheet-mask" + (closing ? " is-closing" : "")} onClick={requestClose} />
      <aside
        ref={phoneUi ? sheetRef : undefined}
        className={"ex-sheet ex-onego" + (expanded ? " ex-pop" : "") + (closing ? " is-closing" : "") + (phoneUi ? (sheet.dragging ? " is-mob-drag" : snapState === "full" ? " is-mob-full" : " is-mob-half") : "")}
        role="dialog"
        aria-label="OneGO!"
        style={phoneUi
          ? { height: sheet.dragH != null ? `${sheet.dragH}px` : undefined }
          : expanded ? { top: anchor?.top, left: anchor?.left, bottom: "auto", right: "auto", visibility: anchor ? undefined : "hidden" } : undefined}
        onPointerDown={sheetCtl.onPointerDown}
        onContextMenu={sheetCtl.onContextMenu}
        onClickCapture={sheetCtl.onClickCapture}
      >
        {phoneUi ? <PhoneSheetGrip label={i18n("auto.components.explorer.OneGoSheet.26")} gripProps={sheet.gripProps} /> : null}
        <header className="ex-sheet-head">
          <b>OneGO!</b>
          <span className="ex-sec-head-note">{i18n("auto.components.explorer.OneGoSheet.27")}</span>
          <Btn variant="ghost" onClick={requestClose}>{i18n("auto.components.explorer.OneGoSheet.28")}</Btn>
        </header>
        <div className="ex-seg-row">
          <div className="segmented ex-seg" role="tablist" aria-label={i18n("auto.components.explorer.OneGoSheet.29")}>
            <button className={seg === "favs" ? "is-active" : ""} role="tab" aria-selected={seg === "favs"} onClick={() => setSeg("favs")}>{i18n("auto.components.explorer.OneGoSheet.30")}</button>
            <button className={seg === "ws" ? "is-active" : ""} role="tab" aria-selected={seg === "ws"} onClick={() => setSeg("ws")}>{i18n("auto.components.explorer.OneGoSheet.18")}</button>
          </div>
        </div>
        <div className="ex-sheet-body">
          <div className="ex-sheet-search">
            <Input placeholder={i18n("auto.components.explorer.OneGoSheet.31")} value={query} onChange={(value) => setQuery(value)} />
          </div>
          {q ? (
            <OneGoSearchResults q={q} onDone={requestClose} />
          ) : seg === "favs" ? (
            <>
              <FavsSection onDone={closeOneGoSheet} />
              <FlowSection onDone={requestClose} />
            </>
          ) : (
            <WorkspacePanel />
          )}
        </div>
        <footer className="ex-sheet-foot">
          <Btn variant="ghost" onClick={() => { focusTab(HOME_TAB_ID); requestClose(); }}>{i18n("auto.components.explorer.OneGoSheet.32")}</Btn>
        </footer>
      </aside>
    </>,
    document.body,
  );
}

export function OneGoSheet(): ReactNode {
  return <OneGoSheetInner />;
}
