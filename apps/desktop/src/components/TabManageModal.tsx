/**
 * 聚合页栏目管理弹窗：勾选显隐 + ↑↓ 调序 + 恢复默认。
 * zhjwxk 弹窗同款骨架（portal + mask/panel 自带表面色）。
 * 布局变更即时生效并经 onApply 回传持久化（tabLayout.saveTabLayout）。
 */
import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { TabLayout } from "../lib/tabLayout.js";

const maskStyle: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 };
const panelStyle: React.CSSProperties = { width: "100%", maxWidth: 420, maxHeight: "70vh", display: "flex", flexDirection: "column", background: "var(--bg-elev, #ffffff)", color: "var(--text, #1f2329)", borderRadius: 14, boxShadow: "0 18px 50px rgba(0,0,0,.28)" };

export function TabManageModal({
  open,
  onClose,
  title,
  tabs,
  layout,
  onApply,
  onReset,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  tabs: Array<{ id: string; label: string }>;
  layout: TabLayout;
  onApply: (layout: TabLayout) => void;
  onReset: () => void;
}) {
  /* Esc 关闭（即时生效型弹窗：直接关闭即保存，无需确认步骤） */
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  if (!open) return null;

  const rows = layout.order
    .map((id) => tabs.find((t) => t.id === id))
    .filter((t): t is { id: string; label: string } => !!t);

  const toggle = (id: string) =>
    onApply({
      order: layout.order,
      hidden: layout.hidden.includes(id) ? layout.hidden.filter((x) => x !== id) : [...layout.hidden, id],
    });

  const move = (id: string, delta: -1 | 1) => {
    const i = layout.order.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= layout.order.length) return;
    const order = [...layout.order];
    [order[i], order[j]] = [order[j]!, order[i]!];
    onApply({ ...layout, order });
  };

  return createPortal(
    <div style={maskStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--border, #eee)" }}>
          <b>{title}</b>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: "8px 16px 14px", overflowY: "auto", fontSize: 13, lineHeight: 1.7 }}>
          <div style={{ fontSize: 12, color: "var(--text-3, #9aa1ac)", margin: "6px 0" }}>
            勾选控制显示；↑↓ 调整顺序（即时生效并保存）。
          </div>
          {rows.map((t, i) => {
            const visible = !layout.hidden.includes(t.id);
            return (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, cursor: "pointer", opacity: visible ? 1 : 0.5 }}>
                  <input type="checkbox" checked={visible} onChange={() => toggle(t.id)} />
                  {t.label}
                </label>
                <button className="btn" style={{ padding: "1px 8px" }} disabled={i === 0} onClick={() => move(t.id, -1)} title="上移">↑</button>
                <button className="btn" style={{ padding: "1px 8px" }} disabled={i === rows.length - 1} onClick={() => move(t.id, 1)} title="下移">↓</button>
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <button className="btn" onClick={onReset}>恢复默认</button>
            <button className="btn btn-primary" onClick={onClose}>完成</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
