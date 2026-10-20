import { VaultExchangeActions } from "./VaultExchangeActions.js";
import { IssuedSharesCard } from "./IssuedSharesCard.js";
/**
 * OneTHU 暂存箱页面（Phase 1）：混合对象清单 + 口令生成/导入 + 拖放收纳。
 *
 * 视觉：沿用 OneGUI（PageHead/Card/List/Row/Btn/Segment/Input），不写私有 chrome；
 * 拖动相关类在 packages/gui/src/recipes/workbench.css，唯一交互层是 vaultDrag.ts。
 */
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Btn, Card, List, Row, Segment, Text } from "@onethu/gui";
import { ExchangeFeedback, type ExchangeState } from "../ExchangeFeedback.js";
import { QRCodeSVG } from "qrcode.react";
import { Empty, PageHead } from "../Layout.js";
import { useApp } from "../../state/context.js";
import { openFormModal } from "../../lib/formModal.js";
import { confirmOk } from "../../lib/confirm.js";
import { showToast } from "../../state/toast.js";
import {
  activeVault, addToVault, clearVault, createVault, deleteVault, renameVault, removeFromVault,
  setActiveVault, subscribeVault, VAULT_TYPE_LABEL, vaultSnapshot, type VaultItem,
} from "../../state/vault.js";
import { installVaultCloudAdapter } from "../../state/vaultCloud.js";
import { nfcShareText, nfcStatus } from "../../lib/nfc.js";
import { buildTouchCode, orgOptions } from "../../state/touch.js";
import { vaultCatchAttr } from "./vaultDrag.js";
import { openVaultItem } from "../../state/vaultRegistry.js";
import { addAtomToHome } from "../../state/onePage.js";
import { fileRefOf, stageFromFiles, stageFromPicker, type StagedFile } from "../../lib/fileChannel.js";
import { t as i18n } from "../../i18n/index.js";


function sizeText(n?: number): string {
  if (!n || n <= 0) return "文件";
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
  return Math.max(1, Math.round(n / 1024)) + " KB";
}

function itemSub(it: VaultItem): string {
  const type = VAULT_TYPE_LABEL[it.type] ?? it.type;
  const extra = it.sub ?? (it.atom ? `${it.atom.kind} · ${it.atom.key}` : it.file?.name ?? "");
  return extra ? `${type} · ${extra}` : type;
}

/** 一条清单项也可再次拖走（换成另一个箱子/以后拖去白板）。 */
function ItemRow({ it, onRemove, onOpen }: { it: VaultItem; onRemove: () => void; onOpen: () => void }): ReactNode {
  return (
    <div className="vault-item-in" data-vault-catch={vaultCatchAttr({ type: it.type, title: it.title, sub: it.sub, atom: it.atom, text: it.text, file: it.file, board: it.board, payload: it.payload, source: it.source })}>
      <Row
        flush
        title={it.title}
        sub={itemSub(it)}
        onClick={onOpen}
        trailing={
          <span className="vault-actions">
            {it.atom ? (
              <Btn variant="ghost" size="sm" onClick={() => {
                const r = addAtomToHome(`${it.atom!.kind}|${it.atom!.key}`);
                showToast(r.added ? "已放进首页" : r.reason === "duplicate" ? "首页已经有这一项了" : "放进首页失败，稍后再试");
              }}>{i18n("auto.components.vault.VaultPage.1")}</Btn>
            ) : null}
            <Btn variant="ghost" size="sm" onClick={onRemove}>{i18n("auto.components.vault.VaultPage.2")}</Btn>
          </span>
        }
      />
    </div>
  );
}

export function VaultPage(): ReactNode {
  useSyncExternalStore(subscribeVault, vaultSnapshot, vaultSnapshot);
  const { navigate } = useApp();
  const box = activeVault();
  const all = vaultSnapshot().boxes;
  const [exchange,setExchange]=useState<ExchangeState|null>(null);
  const [busy, setBusy] = useState(false);
  const [fileHot, setFileHot] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [cloudChecked, setCloudChecked] = useState(false);
  const [nfc, setNfc] = useState<{ available: boolean; enabled: boolean }>({ available: false, enabled: false });
  const [touchCode, setTouchCode] = useState("");

  useEffect(() => { void installVaultCloudAdapter().then((ok) => { setCloudReady(ok); setCloudChecked(true); }); }, []);
  useEffect(() => { void nfcStatus().then((s) => setNfc({ available: s.available, enabled: s.enabled })); }, []);

  const addStaged = useCallback((files: StagedFile[]): void => {
    let ok = 0;
    let dup = 0;
    for (const f of files) {
      const r = addToVault({ type: "file", title: f.name, sub: `${sizeText(f.size)} · ${f.mime}`, file: fileRefOf(f), source: "文件" });
      if (r.ok) ok++;
      else if (r.reason === "duplicate") dup++;
    }
    if (ok) showToast(`已收进暂存箱：${ok} 个文件`);
    else if (dup) showToast(i18n("auto.components.vault.VaultPage.msg1"));
  }, []);

  const pickFilesToVault = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      addStaged(await stageFromPicker(true));
    } catch (e) {
      showToast(`文件读取失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [addStaged]);

  const rename = useCallback(async (): Promise<void> => {
    const f = await openFormModal("重命名暂存箱", [{ key: "name", label: i18n("auto.components.vault.VaultPage.p1"), required: true, default: box.name }]);
    if (f?.name) renameVault(box.id, f.name);
  }, [box.id, box.name]);

  const makeTouch = useCallback(async (): Promise<void> => {
    if (!cloudReady) {
      showToast(i18n("auto.components.vault.VaultPage.msg2"));
      return;
    }
    const orgs = orgOptions();
    const f = await openFormModal("碰一碰 / 组合分享", [
      { key: "vault", label: i18n("auto.components.vault.VaultPage.p2"), kind: "select", options: [{ value: "yes", label: i18n("auto.components.vault.VaultPage.p3") }, { value: "no", label: i18n("auto.components.vault.VaultPage.p4") }] },
      { key: "personal", label: i18n("auto.components.vault.VaultPage.p5"), kind: "select", options: [{ value: "yes", label: i18n("auto.components.vault.VaultPage.p6") }, { value: "no", label: i18n("auto.components.vault.VaultPage.p7") }] },
      {
        key: "org", label: i18n("auto.components.vault.VaultPage.p8"), kind: "select",
        options: [{ value: "", label: i18n("auto.components.vault.VaultPage.p9") }, ...orgs.map((o) => ({ value: o.id, label: o.name }))],
      },
    ]);
    if (!f) return;
    setBusy(true);
    try {
      const r = await buildTouchCode({
        withVault: f.vault !== "no",
        withPersonal: f.personal !== "no",
        withOrgId: f.org || undefined,
      });
      setTouchCode(r.code);
      try { await navigator.clipboard.writeText(r.code); showToast(i18n("auto.components.vault.VaultPage.msg3")); }
      catch { showToast(i18n("auto.components.vault.VaultPage.msg4")); }
    } catch (e) {
      showToast(`组合分享生成失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [cloudReady]);

  const shareNfc = useCallback(async (): Promise<void> => {
    const payloadText = touchCode;
    if (!payloadText) { showToast(i18n("auto.components.vault.VaultPage.msg5")); return; }
    setBusy(true);
    try {
      await nfcShareText(payloadText);
      setExchange({phase:"ready",message:"发送已就绪，请让对方贴近手机；此处尚未收到对方确认"});
      showToast(i18n("auto.components.vault.VaultPage.msg6"));
    } catch (e) {
      showToast(`NFC 发送失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [touchCode]);

  return (
    <>
      <ExchangeFeedback state={exchange} onClose={()=>setExchange(null)}/>
      <PageHead title={i18n("auto.components.vault.VaultPage.3")} meta="任何东西都能先放这里：长按/拖动元素进来，或从搜索结果拖入" />
      {cloudChecked && !cloudReady ? (
        <Card>
          <div className="vault-actions">
            <Text slot="label">{i18n("auto.components.vault.VaultPage.4")}</Text>
            <Btn variant="solid" tone="brand" size="sm" onClick={() => navigate("cloud")}>{i18n("auto.components.vault.VaultPage.5")}</Btn>
          </div>
          <Text slot="micro" tone="faint">{i18n("auto.components.vault.VaultPage.6")}</Text>
        </Card>
      ) : null}
      <Card>
        <div className="vault-toolbar">
          <Segment
            value={box.id}
            onChange={(v) => setActiveVault(v)}
            options={all.map((b) => ({ value: b.id, label: `${b.name}（${b.items.length}）` }))}
          />
          <div className="vault-actions">
            <Btn variant="outline" size="sm" onClick={() => { const b = createVault(); showToast(`已新建「${b.name}」`); }}>{i18n("auto.components.vault.VaultPage.7")}</Btn>
            <Btn variant="ghost" size="sm" onClick={() => void rename()}>{i18n("auto.components.vault.VaultPage.8")}</Btn>
          </div>
        </div>
        <div className="vault-action-row"><Btn variant="outline" size="sm" onClick={()=>void pickFilesToVault()} disabled={busy}>{i18n("auto.components.vault.VaultPage.9")}</Btn><VaultExchangeActions key={box.id} box={box}/></div>
        <details className="vault-combination"><summary>{i18n("auto.components.vault.VaultPage.10")}</summary><Btn variant="outline" size="sm" onClick={()=>void makeTouch()} disabled={busy}>{i18n("auto.components.vault.VaultPage.11")}</Btn></details>
        <div
          className={"vault-file-drop" + (fileHot ? " is-hot" : "")}
          onDragOver={(e) => { e.preventDefault(); setFileHot(true); }}
          onDragLeave={() => setFileHot(false)}
          onDrop={(e) => {
            e.preventDefault();
            setFileHot(false);
            const files = Array.from(e.dataTransfer.files ?? []);
            if (files.length > 0) void stageFromFiles(files).then(addStaged).catch((err) => showToast(`文件读取失败：${err instanceof Error ? err.message : String(err)}`));
          }}
        >
          <Text slot="label">{i18n("auto.components.vault.VaultPage.12")}</Text>
          <Text slot="micro" tone="faint">{i18n("auto.components.vault.VaultPage.13")}</Text>
        </div>
        {touchCode ? (
          <div className="vault-share">
            <Text slot="micro" tone="faint">{i18n("auto.components.vault.VaultPage.14")}</Text>
            <code className="vault-share-code">{touchCode}</code>
            <div className="vault-qr"><QRCodeSVG value={touchCode} size={300} /></div>
            <div className="vault-actions">
              <Btn variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(touchCode).catch(() => undefined)}>{i18n("auto.components.vault.VaultPage.15")}</Btn>
              <Btn variant="ghost" size="sm" onClick={() => void shareNfc()} disabled={!nfc.available || !nfc.enabled}>{i18n("auto.components.vault.VaultPage.16")}</Btn>
              <Btn variant="ghost" size="sm" onClick={() => setTouchCode("")}>{i18n("auto.components.vault.VaultPage.17")}</Btn>
            </div>
          </div>
        ) : null}
        <Text slot="micro" tone="faint">
          {i18n("auto.components.vault.VaultPage.18")}</Text>
      </Card>

      <IssuedSharesCard />

      <Card>
        {box.items.length === 0 ? (
          <Empty text="暂存箱还是空的。打开搜索，长按任意结果拖到这里试试。" />
        ) : (
          <List divided>
            {box.items.map((it) => (
              <ItemRow
                key={it.id}
                it={it}
                onOpen={() => openVaultItem(it, { navigate: (page, params) => navigate(page as never, params as never), toast: showToast })}
                onRemove={() => removeFromVault(box.id, it.id)}
              />
            ))}
          </List>
        )}
      </Card>

      <div className="vault-footer-actions">
        <Btn variant="ghost" tone="error" onClick={() => {
          void confirmOk(`清空暂存箱「${box.name}」？未分享的内容会立即消失。`).then((ok) => { if (ok) { clearVault(box.id); showToast(i18n("auto.components.vault.VaultPage.msg7")); } });
        }} disabled={box.items.length === 0}>{i18n("auto.components.vault.VaultPage.19")}</Btn>
        <Btn variant="ghost" onClick={() => {
          void confirmOk(`删除暂存箱「${box.name}」？`).then((ok) => { if (ok) { deleteVault(box.id); showToast(i18n("auto.components.vault.VaultPage.msg8")); } });
        }} disabled={all.length <= 1}>{i18n("auto.components.vault.VaultPage.20")}</Btn>
      </div>
    </>
  );
}
