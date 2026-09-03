/**
 * 应用内确认弹窗（Promise 化）——Tauri WKWebView 的原生 window.confirm
 * 静默返回 false（无对话框 UI），所有 confirm 门控的破坏性操作因此
 * 从未执行（暂存 ✕/清空/退选/草稿提交/场馆退订 2026-09-03 实录）。
 * 用 DOM 覆盖层替代，<ConfirmHost/> 挂在应用根部一次即可。
 */
import { useSyncExternalStore } from "react";

type Pending = { msg: string; resolve: (v: boolean) => void };
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
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "var(--bg, #fff)", borderRadius: 14, padding: "18px 18px 14px", maxWidth: 420, width: "100%", boxShadow: "0 12px 40px rgba(0,0,0,.22)" }}>
        <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{cur.msg}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button className="btn" onClick={() => answerConfirm(false)}>取消</button>
          <button className="btn" style={{ borderColor: "var(--accent, #6d7ff0)", color: "var(--accent, #6d7ff0)" }} onClick={() => answerConfirm(true)}>确定</button>
        </div>
      </div>
    </div>
  );
}
