import { Btn } from "@onethu/gui";
/**
 * OnePage 图标选择弹窗。入口：OneGO / OnePage 列表行的「改图标…」。
 * 默认图标是拳头 logo（fist）；选中即写入 Board.icon（TabStrip/OneGO/列表都读它）。
 */
import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FOLDER_ICONS } from "../Icons.js";
import { loadBoard } from "../../state/board.js";
import { mutateBoards, renameOnePage } from "../../state/onePage.js";
import { renameBoard } from "../../state/boardOps.js";
import { t as i18n } from "../../i18n/index.js";


let pickingId: string | null = null;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((f) => f());
const subscribe = (f: () => void): (() => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};
const snapshot = (): string | null => pickingId;

export function openFolderIconPicker(id: string): void {
  pickingId = id;
  emit();
}

export function closeFolderIconPicker(): void {
  if (pickingId === null) return;
  pickingId = null;
  emit();
}

export function FolderIconPickerHost(): ReactNode {
  const id = useSyncExternalStore(subscribe, snapshot, snapshot);
  const board = id ? loadBoard().boards.find((b) => b.id === id) : undefined;
  if (!id || !board) return null;
  const current = board.icon ?? "fist";
  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,.25)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) closeFolderIconPicker();
      }}
    >
      <div
        role="dialog"
        aria-label={i18n("auto.components.explorer.FolderIconPicker.1")}
        style={{ background: "var(--dsw-alias-bg-base, #fff)", color: "var(--dsw-alias-label-primary, inherit)", borderRadius: 14, padding: 18, width: 320, boxShadow: "0 12px 40px rgba(0,0,0,.25)" }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4 }}>「{board.name}{i18n("auto.components.explorer.FolderIconPicker.2")}</div>
        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 12 }}>{i18n("auto.components.explorer.FolderIconPicker.3")}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
          {Object.keys(FOLDER_ICONS).map((k) => {
            const G = FOLDER_ICONS[k];
            if (!G) return null;
            return (
              <button
                key={k}
                type="button"
                aria-label={"图标 " + k}
                aria-pressed={current === k}
                onClick={() => {
                  mutateBoards((doc) => renameBoard(doc, id, board.name, k));
                  closeFolderIconPicker();
                }}
                style={{ height: 40, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 10, border: current === k ? "2px solid var(--dsw-alias-label-primary, #000)" : "1px solid transparent", background: "transparent", cursor: "pointer" }}
              >
                <G width={18} height={18} />
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <Btn variant="outline" onClick={closeFolderIconPicker}>{i18n("auto.components.explorer.FolderIconPicker.4")}</Btn>
        </div>
      </div>
    </div>,
    document.body,
  );
}
