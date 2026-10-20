import { VaultExchangeActions } from "./VaultExchangeActions.js";
/**
 * 暂存箱「下弹抽屉」：这是暂存箱的**完全展开**形态。
 *
 * 之前「打开展示柜」跳去独立的 vault 标签页，业务上像换了个 App；现在统一成
 * 贴在底部的抽屉：看清单、开条目、移除、在标签页里打开（深链/搜索仍然可以到整页）。
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Btn, IconBtn, List, Row, Text } from "@onethu/gui";
import { IconIn, IconX } from "../Icons.js";
import { useApp } from "../../state/context.js";
import { showToast } from "../../state/toast.js";
import { useVaultReceive } from "../../lib/useVaultReceive.js";
import {
  activeVault, removeFromVault, subscribeVault, vaultSnapshot, VAULT_TYPE_LABEL, type VaultItem,
} from "../../state/vault.js";
import { openVaultItem } from "../../state/vaultRegistry.js";
import { t as i18n } from "../../i18n/index.js";


let sheetOpen = false;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((f) => f());
export function openVaultSheet(): void {
  if (sheetOpen) return;
  sheetOpen = true;
  emit();
}
export function closeVaultSheet(): void {
  if (!sheetOpen) return;
  sheetOpen = false;
  emit();
}
export function subscribeVaultSheet(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
export function vaultSheetSnapshot(): boolean {
  return sheetOpen;
}

function itemSub(it: VaultItem): string {
  const type = VAULT_TYPE_LABEL[it.type] ?? it.type;
  const extra = it.sub ?? (it.atom ? `${it.atom.kind} · ${it.atom.key}` : it.file?.name ?? "");
  return extra ? `${type} · ${extra}` : type;
}

export function VaultSheetHost(): ReactNode {
  const open = useSyncExternalStore(subscribeVaultSheet, vaultSheetSnapshot, vaultSheetSnapshot);
  const doc = useSyncExternalStore(subscribeVault, vaultSnapshot, vaultSnapshot);
  const { navigate } = useApp();
  const [closing, setClosing] = useState(false);
  const receive = useVaultReceive();
  const box = doc.boxes.find((b) => b.id === doc.activeId) ?? doc.boxes[0]!;

  const close = (): void => {
    setClosing(true);
    window.setTimeout(() => { setClosing(false); closeVaultSheet(); }, 160);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!open) return null;

  const openItem = (it: VaultItem): void => {
    close();
    openVaultItem(it, {
      navigate: (page, params) => navigate(page as never, params as never),
      toast: showToast,
    });
  };

  return createPortal(
    <div className={"vault-sheet-mask" + (closing ? " is-closing" : "")} onClick={close}>
      <section
        className={"vault-sheet" + (closing ? " is-closing" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={`暂存箱：${box.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="vault-sheet-head">
          <span className="vault-sheet-mark" aria-hidden="true"><IconIn width={18} height={18} /></span>
          <span className="vault-sheet-title">
            <b>{box.name}</b>
            <small>{box.items.length ? `${box.items.length} 项` : "空的"}</small>
          </span>
          <span className="vault-sheet-tools">
            <Btn size="sm" variant="ghost" onClick={() => { closeVaultSheet(); navigate("vault"); }}>{i18n("auto.components.vault.VaultSheet.1")}</Btn>
            <IconBtn size="sm" label={i18n("auto.components.vault.VaultSheet.2")} icon={<IconX width={16} height={16} />} onClick={close} />
          </span>
        </header>
        <div className="vault-sheet-body">
          {box.items.length ? (
            <List>
              {box.items.map((it) => (
                <Row
                  key={it.id}
                  flush
                  title={it.title}
                  sub={itemSub(it)}
                  onClick={() => openItem(it)}
                  trailing={
                    <Btn
                      size="sm"
                      variant="ghost"
                      onClick={(e) => { e.stopPropagation(); removeFromVault(box.id, it.id); }}
                    >{i18n("auto.components.vault.VaultSheet.3")}</Btn>
                  }
                />
              ))}
            </List>
          ) : (
            <div className="vault-sheet-empty">
              <IconIn width={26} height={26} />
              <Text slot="label">{i18n("auto.components.vault.VaultSheet.4")}</Text>
              <Text slot="micro" tone="faint">{i18n("auto.components.vault.VaultSheet.5")}</Text>
            </div>
          )}
        </div>
        <footer className="vault-sheet-foot">
          {/* 抽屉也是完整形态：不用绕去整页就能粘贴口令 / 扫码收内容。 */}
          <VaultExchangeActions box={box}/>
          <Text slot="micro" tone="faint">{i18n("auto.components.vault.VaultSheet.6")}</Text>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
