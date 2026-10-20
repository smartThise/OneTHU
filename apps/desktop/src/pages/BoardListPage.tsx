import { Btn } from "@onethu/gui";
/**
 * OnePage 列表页（P2，方案 §7.9；2026-10-13 起话语从「收藏夹」切换为 OnePage）：多块白板的入口。
 *
 * 每项长按/右键菜单：重命名 / 改图标 / 设为当前 OnePage / 上移 / 下移 / 删除（标红）；系统板不可删。
 * 点击一项 = 把它设为当前板并进入白板页。
 *
 * ⚠️ 2026-10-17 数据丢失修复：这里以前拿挂载时的 doc 快照改完整文档再 saveBoard()，
 * 会覆盖 OneGO / OH / 收藏其他入口刚新建或改名的板。现在一律走 mutateBoards（读最新 doc →
 * 改 → 存 → 广播），并订阅 onethu.boards.changed 保持列表实时。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Card, Empty, PageHead } from "../components/Layout.js";
import { useContextMenu, type CtxItem } from "../components/ContextMenu.js";
import { loadBoard, type BoardDoc } from "../state/board.js";
import { boardSummary, createBoard, deleteBoard, moveBoard, renameBoard, setActiveBoard } from "../state/boardOps.js";
import { mutateBoards } from "../state/onePage.js";
import { useApp } from "../state/context.js";
import { openFormModal } from "../lib/formModal.js";
import { openFolderIconPicker } from "../components/explorer/FolderIconPicker.js";
import { t as i18n } from "../i18n/index.js";


export function BoardListPage(): ReactNode {
  const { navigate } = useApp();
  const menu = useContextMenu();
  const [doc, setDoc] = useState<BoardDoc>(() => loadBoard());
  const [note, setNote] = useState<string | null>(null);
  /* 其他入口（OneGO/OH/收藏）改板后，这份列表不能停在旧快照上。 */
  useEffect(() => {
    const on = (): void => setDoc(loadBoard());
    window.addEventListener("onethu.boards.changed", on);
    return () => window.removeEventListener("onethu.boards.changed", on);
  }, []);
  /* 系统板（「首页」）不是一块 OnePage：首页有自己的入口（顶栏 Logo / 程序坞）。列在这里的话，
     点「首页」会被当成"把首页当白板打开"（用户实测原话：「点击首页回首页，你回的还是旧的一套」）。 */
  const rows = useMemo(() => boardSummary(doc).filter((b) => b.kind !== "system"), [doc]);

  const say = (text: string): void => {
    setNote(text);
    window.setTimeout(() => setNote(null), 1800);
  };

  const rename = async (id: string, name: string): Promise<void> => {
    const f = await openFormModal("重命名 OnePage", [{ key: "name", label: i18n("auto.pages.BoardListPage.p1"), required: true, default: name }]);
    if (!f) return;
    mutateBoards((d) => renameBoard(d, id, f.name ?? name));
    say("已重命名：" + (f.name ?? name));
  };

  const openMenu = (id: string, name: string, x: number, y: number): void => {
    const items: CtxItem[] = [
      { key: "rename", label: i18n("auto.pages.BoardListPage.p2"), onSelect: () => void rename(id, name) },
      { key: "icon", label: i18n("auto.pages.BoardListPage.p3"), onSelect: () => openFolderIconPicker(id) },
      { key: "current", label: i18n("auto.pages.BoardListPage.p4"), onSelect: () => { mutateBoards((d) => setActiveBoard(d, id)); say("当前 OnePage：" + name); } },
      { key: "up", label: i18n("auto.pages.BoardListPage.p5"), onSelect: () => mutateBoards((d) => moveBoard(d, id, "up")) },
      { key: "down", label: i18n("auto.pages.BoardListPage.p6"), onSelect: () => mutateBoards((d) => moveBoard(d, id, "down")) },
      { key: "remove", label: i18n("auto.pages.BoardListPage.p7"), danger: true, onSelect: () => {
        const reason = mutateBoards((d) => {
          const r = deleteBoard(d, id);
          if (r.reason) {
            say(r.reason === "system-board" ? "系统板不能删除" : r.reason === "last-board" ? "至少保留一块 OnePage" : "没有这块 OnePage");
            return null;
          }
          say("已删除：" + name);
          return r.doc;
        });
        void reason;
      } },
    ];
    menu.open({ x, y, title: name, items });
  };

  return (
    <>
      <PageHead title="OnePage" meta="每一块都是一张可随意摆放组件的白板" />
      {rows.length === 0 ? (
        <Card>
          <Empty text="还没有 OnePage。新建一块，把常用的组件摆上去。" />
        </Card>
      ) : (
        <div className="board-list" data-boards={String(rows.length)}>
          {rows.map((b) => (
            <button
              key={b.id}
              type="button"
              className={"board-list-row" + (b.active ? " is-active" : "")}
              data-board-id={b.id}
              onClick={() => { mutateBoards((d) => setActiveBoard(d, b.id)); navigate("board"); }}
              onContextMenu={(e) => { e.preventDefault(); openMenu(b.id, b.name, e.clientX, e.clientY); }}
            >
              <span className="board-list-name">{b.name}</span>
              <span className="board-list-meta">
                {b.kind === "system" ? "系统板" : "OnePage"} · {b.count} {i18n("auto.pages.BoardListPage.1")}{b.active ? " · 当前 OnePage" : ""}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="board-list-actions">
        <Btn variant="outline" onClick={() => {
            let created = "";
            mutateBoards((d) => {
              const r = createBoard(d, "新 OnePage " + String(rows.length + 1));
              created = r.board.id;
              return r.doc;
            });
            if (created) {
              say(i18n("auto.pages.BoardListPage.msg1"));
              mutateBoards((d) => setActiveBoard(d, created));
              navigate("board");
            }
          }}>{i18n("auto.pages.BoardListPage.2")}</Btn>
      </div>

      {note ? <div className="board-note" role="status">{note}</div> : null}
    </>
  );
}
