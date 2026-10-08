/**
 * 应用内确认弹窗（Promise 化）——Tauri WKWebView 的原生 window.confirm
 * 静默返回 false（无对话框 UI），所有 confirm 门控的破坏性操作因此
 * 从未执行（暂存 ✕/清空/退选/草稿提交/场馆退订 2026-09-03 实录）。
 * 用 DOM 覆盖层替代，<ConfirmHost/> 挂在应用根部一次即可。
 */
import { useSyncExternalStore } from "react";
import { IconWarn } from "../components/Icons.js";

type Pending = {
  msg: string;
  resolve: (v: boolean) => void;
  danger?: boolean;
  /** 危险弹窗标题与确认按钮文案：由调用方按场景给（默认通用措辞） */
  title?: string;
  confirmText?: string;
};
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
/** 危险操作确认。标题与确认按钮文案**由调用方给**：
 *  R21c 教训——组件里曾把「即将退选 / 确认退选」写死，忽略作业复用时整屏照抄退选文案，
 *  用户当场发现。默认值只作通用兜底，具体场景（退选/忽略/删除…）一律显式传。 */
export function confirmDanger(
  msg: string,
  opts: { title?: string; confirmText?: string } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    pending?.resolve(false);
    pending = {
      msg,
      resolve,
      danger: true,
      title: opts.title ?? "此操作不可撤销，请确认",
      confirmText: opts.confirmText ?? "确认执行",
    };
    listeners.forEach((l) => l());
  });
}

/** 场景措辞预设：**措辞属于场景、不属于组件**——组件只提供通用兜底。
 *  R21c 实录：忽略作业复用了退选弹窗，整屏照抄「即将退选 / 确认退选」，用户当场发现。 */
export const CONFIRM_DROP_COURSE = { title: "即将退选，请确认！", confirmText: "确认退选" } as const;
export const CONFIRM_IGNORE_HW = { title: "忽略这条作业，请确认！", confirmText: "确认忽略" } as const;

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
  /* A6（霖 2026-10-05）：此前是「46px emoji ⚠️ + 写死的白玻璃卡 + 17px 红标题 + 全部居中」——
     emoji 是彩色字体、白玻璃在深色主题下就是一块刺眼的白板，和设置页/详情页的卡片不是一个语言。
     现在：浮层走「描边 + 投影」（§3，与卡片相反），底色/描边/投影/文字全走令牌（深色自动跟随）；
     图标用图标集里的线性 SVG（页面不许手写 svg）；警示色只留给确认按钮，标题回到 --text-1。 */
  const mask: React.CSSProperties = {
    position: "fixed", inset: 0, zIndex: 9999,
    background: "var(--md-sys-color-scrim)",
    display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
  };
  const card: React.CSSProperties = {
    width: "100%",
    background: "var(--md-sys-color-surface-container-lowest)",
    border: "1px solid var(--border)",
    borderRadius: "var(--md-sys-shape-corner-large)",
    boxShadow: "var(--md-sys-elevation-3)",
  };
  const body: React.CSSProperties = {
    /* 正文走 --text-sm（桌面 13px / 手机 14px）：与 .dock-confirm-text 同一口径，
       也正是 A6 要的 13–14px。用 --text-base 会落到手机密度层的 15px（§3.8）。 */
    fontSize: "var(--text-sm)",
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text-2)",
  };
  const ops: React.CSSProperties = { display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 };
  if (cur.danger) {
    return (
      <div className="confirm-mask" style={mask}>
        <div className="confirm-card" style={{ ...card, maxWidth: 440, padding: "16px 16px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ display: "flex", flex: "0 0 auto", color: "var(--text-2)" }}>
              <IconWarn width={18} height={18} />
            </span>
            <div style={{ fontSize: "var(--text-md)", fontWeight: 600, color: "var(--text-1)" }}>{cur.title ?? "此操作不可撤销，请确认"}</div>
          </div>
          <div style={body}>{cur.msg}</div>
          <div style={ops}>
            <button className="btn" onClick={() => answerConfirm(false)}>取消</button>
            <button className="btn" style={{ minWidth: 96, background: "var(--red)", borderColor: "var(--red)", color: "var(--on-primary)", boxShadow: "0 6px 20px color-mix(in srgb, var(--red) 35%, transparent)" }} onClick={() => answerConfirm(true)}>{cur.confirmText ?? "确认执行"}</button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="confirm-mask" style={mask}>
      <div className="confirm-card" style={{ ...card, maxWidth: 420, padding: "16px 16px 12px" }}>
        <div style={body}>{cur.msg}</div>
        <div style={ops}>
          <button className="btn" onClick={() => answerConfirm(false)}>取消</button>
          <button className="btn" style={{ borderColor: "var(--accent)", color: "var(--accent)" }} onClick={() => answerConfirm(true)}>确定</button>
        </div>
      </div>
    </div>
  );
}
