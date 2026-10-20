import { VaultExchangeActions } from "./VaultExchangeActions.js";
/**
 * 常驻「暂存箱」入口 + 半圆雷达。
 *
 * - 桌面：收藏栏正下方居中；手机：顶栏「首页」按钮旁（默认就是最黑的箱子）。
 * - 点一下箱子展开雷达：半圆刻度盘 + 扫描光束，箱内条目沿弧环绕缓慢摆动；
 *   拖到箱子上松手 = 收进来，拖到底部/顶部的 OH 胶囊 = 发给小OH。
 * - 长按任意带 `data-vault-catch` 的内容自动展开雷达并成为投递目标（vaultDrag.ts 驱动）。
 */
import { useEffect, useLayoutEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { vaultShareCode } from "../../lib/contentExchange.js";
import { useNfcExchange } from "../../lib/useNfcExchange.js";
import { useVaultReceive } from "../../lib/useVaultReceive.js";
import { Btn, Text } from "@onethu/gui";
import { IconIn } from "../Icons.js";
import { useApp } from "../../state/context.js";
import { useIsPhone } from "../../state/phoneSheets.js";
import { activeVault, addToVault, subscribeVault, vaultSnapshot, type VaultItem } from "../../state/vault.js";
import { openVaultItem } from "../../state/vaultRegistry.js";
import { openVaultSheet } from "./VaultSheet.js";
import { stageFromFiles } from "../../lib/fileChannel.js";
import { showToast } from "../../state/toast.js";
import { installVaultDragSources, subscribeVaultDrag, vaultDragSnapshot } from "./vaultDrag.js";
import { t as i18n } from "../../i18n/index.js";


/** 雷达上最多铺几枚条目；再多就用「+N」收口。 */
const RADAR_SLOTS = 5;

/** 把条目均匀铺在半圆弧上（正下方 = 0°，范围 ±70°），返回单位向量。 */
function arcSlots(n: number): Array<{ x: number; y: number }> {
  const span = n <= 1 ? 0 : 116;
  return Array.from({ length: n }, (_, i) => {
    const deg = n <= 1 ? 0 : -span / 2 + (span * i) / (n - 1);
    const rad = (deg * Math.PI) / 180;
    return { x: Math.sin(rad), y: Math.cos(rad) };
  });
}

export function VaultDropTarget(): ReactNode {
  const isPhone = useIsPhone();
  const [fileDrag, setFileDrag] = useState(false);
  useEffect(() => installVaultDragSources(), []);
  useEffect(() => {
    /* 选中文字 → ⌘/Ctrl+Shift+S 收进暂存箱（文字没有可拖 DOM，给一个快捷入口）。 */
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.key.toLowerCase() !== "s") return;
      const text = window.getSelection?.()?.toString().trim() ?? "";
      if (!text) return;
      e.preventDefault();
      const r = addToVault({ type: "text", title: text.slice(0, 40), sub: text.length > 40 ? `${text.length} 字` : undefined, text: text.slice(0, 4000), source: "选中文字" });
      showToast(r.ok ? "选中文字已收进暂存箱" : "暂存箱里已经有这段文字了");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (e: DragEvent): void => { if (hasFiles(e)) { e.preventDefault(); setFileDrag(true); } };
    const onOver = (e: DragEvent): void => { if (hasFiles(e)) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; } };
    const onLeave = (e: DragEvent): void => { if (!e.relatedTarget) setFileDrag(false); };
    const onDrop = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setFileDrag(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      void stageFromFiles(files).then((staged) => {
        let ok = 0;
        for (const f of staged) {
          const r = addToVault({ type: "file", title: f.name, sub: `${f.size} B · ${f.mime}`, file: { name: f.name, size: f.size, mime: f.mime, hash: f.sha256, cloudPath: null, stagedPath: f.localPath }, source: "文件拖入" });
          if (r.ok) ok++;
        }
        showToast(ok ? `已收进暂存箱：${ok} 个文件` : "这些文件已在暂存箱里（按内容指纹去重）");
      }).catch((err) => showToast(`文件读取失败：${err instanceof Error ? err.message : String(err)}`));
    };
    document.addEventListener("dragenter", onEnter);
    document.addEventListener("dragover", onOver);
    document.addEventListener("dragleave", onLeave);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragenter", onEnter);
      document.removeEventListener("dragover", onOver);
      document.removeEventListener("dragleave", onLeave);
      document.removeEventListener("drop", onDrop);
    };
  }, []);
  const box = activeVault();
  if (fileDrag) {
    return createPortal(
      <div className="vault-file-overlay">
        <div className="vault-file-overlay-box">
          <IconIn width={28} height={28} />
          <span>{i18n("auto.components.vault.VaultDropTarget.1")}{box.name}」</span>
          <span className="vault-file-overlay-sub">{i18n("auto.components.vault.VaultDropTarget.2")}</span>
        </div>
      </div>,
      document.body,
    );
  }
  return !isPhone ? createPortal(<div className="vault-desktop-anchor"><VaultButton /></div>, document.body) : null;
}

/** 「发给小OH」提示：跟着 OH 胶囊走，胶囊在下半屏就冒在上方，否则冒在下方。 */
function TransferHint({ target }: { target?: "vault" | "oh" }): ReactNode {
  const [spot, setSpot] = useState<{ left: number; top: number; below: boolean } | null>(null);
  useLayoutEffect(() => {
    const measure = (): void => {
      const el = document.querySelector<HTMLElement>("[data-oh-drop]");
      if (!el) { setSpot(null); return; }
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) { setSpot(null); return; }
      const low = r.top + r.height / 2 > window.innerHeight / 2;
      setSpot({ left: r.left + r.width / 2, top: low ? r.top - 10 : r.bottom + 10, below: !low });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  if (!spot) return null;
  return createPortal(
    <div
      className={"transfer-oh-hint" + (spot.below ? " is-below" : "") + (target === "oh" ? " is-active" : "")}
      style={{ left: spot.left, top: spot.top }}
      role="status"
    >
      {target === "oh" ? "松手发给小OH" : "发给小OH"}
    </div>,
    document.body,
  );
}

export function VaultButton(): ReactNode {
  const drag = useSyncExternalStore(subscribeVaultDrag, vaultDragSnapshot, vaultDragSnapshot);
  const doc = useSyncExternalStore(subscribeVault, vaultSnapshot, vaultSnapshot);
  const box = doc.boxes.find((b) => b.id === doc.activeId) ?? doc.boxes[0]!;
  const items = box.items;
  const { navigate } = useApp();
  const phone = useIsPhone();
  const [pinned, setPinned] = useState(false);
  const open = pinned || drag.active;
  const visible = items.slice(0, RADAR_SLOTS);
  const extra = items.length - visible.length;
  const slots = arcSlots(visible.length + (extra > 0 ? 1 : 0));

  const openVaultPage = (): void => { setPinned(false); openVaultSheet(); };
  const openItem = (it: VaultItem): void => {
    setPinned(false);
    openVaultItem(it, {
      navigate: (page, params) => navigate(page as never, params as never),
      toast: showToast,
    });
  };

  useEffect(() => {
    if (!pinned) return;
    /* 雷达里的「分享口令 / 接收」弹窗是 portal 到 body 的，点它、按 Esc 关它都不该把雷达一起收掉——
       否则弹窗会在 pointerdown 那一下随雷达卸载，里面的按钮点了没反应。 */
    const inOverlay = (el: Element | null): boolean => !!el?.closest(".og-scrim, [role='dialog'], .plg-form-modal");
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      if (document.querySelector(".og-scrim, [role='dialog']")) return;
      setPinned(false);
    };
    const onDown = (e: PointerEvent): void => {
      const el = e.target as Element | null;
      if (inOverlay(el)) return;
      if (!el?.closest(".vault-anchor, .vault-radar")) setPinned(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [pinned]);

  const panel = open ? (
    <div
      className={"vault-radar" + (drag.active ? " is-transfer" : "") + (drag.target === "vault" ? " is-hover" : "") + (phone ? " is-floating" : "")}
      role="region"
      aria-label={`暂存箱雷达：${box.name}，共 ${items.length} 项`}
    >
      <div className="vault-radar-disc">
        <span className="vault-radar-plane" aria-hidden="true">
          <span className="vault-radar-band" />
          <span className="vault-radar-sweep" />
          <span className="vault-radar-ticks" />
        </span>
        <div className="vault-radar-field">
          {visible.map((it, i) => (
            <span key={it.id} className="vault-chip-slot" style={{ "--vx": slots[i]!.x, "--vy": slots[i]!.y } as CSSProperties}>
              <Btn className="vault-chip" size="sm" titleAttr={it.title} aria-label={`打开暂存项：${it.title}`} onClick={() => openItem(it)}>
                {it.title}
              </Btn>
            </span>
          ))}
          {extra > 0 ? (
            <span className="vault-chip-slot" style={{ "--vx": slots[slots.length - 1]!.x, "--vy": slots[slots.length - 1]!.y } as CSSProperties}>
              <Btn className="vault-chip" size="sm" aria-label={`还有 ${extra} 项，打开暂存箱`} onClick={openVaultPage}>
                +{extra}
              </Btn>
            </span>
          ) : null}
        </div>
        <div className="vault-radar-center">
          <b>{drag.active ? (drag.target === "vault" ? "松手放入" : "拖到箱子上") : items.length ? `${items.length} 项` : "箱子是空的"}</b>
          <small>{drag.active ? "箱子收起来 · OH 直接处理" : items.length ? box.name : "长按任意内容，拖进来"}</small>
        </div>
        {drag.active ? <span className="vault-drop-pad" data-vault-drop aria-hidden="true" /> : null}
      </div>
      {!drag.active ? <div className="vault-radar-exchange">
        <VaultExchangeActions box={box}/>
      </div> : null}
      <div className="vault-radar-foot">
        <span className="vault-radar-meta"><span className="vault-radar-hint-line">{items.length ? "点条目直接打开" : "长按任意内容，拖进来"}</span></span>
        <Btn size="sm" variant="ghost" onClick={openVaultPage}>{i18n("auto.components.vault.VaultDropTarget.3")}</Btn>
      </div>
    </div>
  ) : null;

  return (
    <>
      <div className={"vault-anchor" + (drag.active ? " is-transfer" : "") + (drag.target === "vault" ? " is-hover" : "")}>
        <Btn
          className="vault-box-button"
          variant="solid"
          data-vault-drop
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`暂存箱，${items.length} 项`}
          titleAttr={i18n("auto.components.vault.VaultDropTarget.4")}
          onClick={() => setPinned((v) => !v)}
        >
          <IconIn width={20} height={20} />
          <span>{items.length || ""}</span>
        </Btn>
        {phone ? null : panel}
      </div>
      {phone && panel ? createPortal(panel, document.body) : null}
      
      {drag.active ? <TransferHint target={drag.target} /> : null}
    </>
  );
}