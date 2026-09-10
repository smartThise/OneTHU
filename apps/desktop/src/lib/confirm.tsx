/**
 * 应用内确认弹窗（Promise 化）——Tauri WKWebView 的原生 window.confirm
 * 静默返回 false（无对话框 UI），所有 confirm 门控的破坏性操作因此
 * 从未执行（暂存 ✕/清空/退选/草稿提交/场馆退订 2026-09-03 实录）。
 * 用 DOM 覆盖层替代，<ConfirmHost/> 挂在应用根部一次即可。
 */
import { useSyncExternalStore } from "react";

type Pending = { msg: string; resolve: (v: boolean) => void; danger?: boolean };
let pending: Pending | null = null;
const listeners = new Set<() => void>();

export function confirmOk(msg: string): Promise<boolean> {
  return new Promise((resolve) => {
    // 新请求顶掉旧请求（旧者按取消结算，防悬挂）
    pending?.resolve(false);
    pending = { msg, resolve };
    listeners.forEach((l) => l());
  });
}

/**
 * 危险操作确认（退课等不可逆操作）：大号玻璃弹窗 + ⚠️ + 红色确认钮。
 * 用户令：有人没意识到退选是真实退课——每退一门课都要醒目警告。
 */
export function confirmDanger(msg: string): Promise<boolean> {
  return new Promise((resolve) => {
    pending?.resolve(false);
    pending = { msg, resolve, danger: true };
    listeners.forEach((l) => l());
  });
}

export function answerConfirm(v: boolean): void {
  pending?.resolve(v);
  pending = null;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function ConfirmHost(): React.ReactNode {
  const cur = useSyncExternalStore(subscribe, () => pending);
  if (!cur) return null;
  const glass: React.CSSProperties = {
    background: "rgba(255,255,255,.62)",
    backdropFilter: "blur(28px) saturate(180%)",
    WebkitBackdropFilter: "blur(28px) saturate(180%)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,.9), inset 0 0 0 1px rgba(28,39,64,.08), 0 24px 80px rgba(28,39,64,.28)",
  };
  if (cur.danger) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ ...glass, borderRadius: 20, padding: "26px 26px 20px", maxWidth: 440, width: "100%", textAlign: "center" }}>
          <div style={{ fontSize: 46, lineHeight: 1, marginBottom: 14 }}>⚠️</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#d33330", marginBottom: 8 }}>即将退选，请确认！</div>
          <div style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "rgba(28,39,64,.75)" }}>{cur.msg}</div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 18 }}>
            <button className="btn" style={{ minWidth: 118, height: 38, fontSize: 14 }} onClick={() => answerConfirm(false)}>取消</button>
            <button className="btn" style={{ minWidth: 118, height: 38, fontSize: 14, background: "#e5484d", borderColor: "#e5484d", color: "#fff", boxShadow: "0 6px 20px rgba(229,72,77,.35)" }} onClick={() => answerConfirm(true)}>确认退选</button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ ...glass, borderRadius: 14, padding: "18px 18px 14px", maxWidth: 420, width: "100%" }}>
        <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{cur.msg}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button className="btn" onClick={() => answerConfirm(false)}>取消</button>
          <button className="btn" style={{ borderColor: "var(--accent, #6d7ff0)", color: "var(--accent, #6d7ff0)" }} onClick={() => answerConfirm(true)}>确定</button>
        </div>
      </div>
    </div>
  );
}
