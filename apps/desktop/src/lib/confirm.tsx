import { createPortal } from "react-dom";
import { Input } from "@onethu/gui";
import { Btn } from "@onethu/gui";
/**
 * 应用内确认弹窗（Promise 化）——Tauri WKWebView 的原生 window.confirm
 * 静默返回 false（无对话框 UI），所有 confirm 门控的破坏性操作因此
 * 从未执行（暂存 ✕/清空/退选/草稿提交/场馆退订 2026-09-03 实录）。
 * 用 DOM 覆盖层替代，<ConfirmHost/> 挂在应用根部一次即可。
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { t as i18n } from "../i18n/index.js";


type Pending = {
  msg: string;
  resolve: (v: boolean) => void;
  danger?: boolean;
  /** 弹窗标题与按钮文案：由调用方按场景给（非危险档用 confirmChoice，可选标题） */
  title?: string;
  confirmText?: string;
  /** 次按钮（否定项）文案：默认「取消」；二选一场景把它说成用户实际得到的结果（如「忽略」） */
  cancelText?: string;
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

/**
 * 非危险档的二选一（同款玻璃卡，无 ⚠️、主按钮用主题色）：两个选项都是**正常动作**、
 * 只是用户要挑一个时用（如「正文图片加载失败」→ 重新登录 / 忽略）。
 * 与 `confirmOk` 的区别：两边都要说清点下去会发生什么，所以两个文案都必填——
 * 「取消 / 确定」在二选一里等于没说。
 */
export function confirmChoice(
  msg: string,
  opts: { title?: string; confirmText: string; cancelText: string },
): Promise<boolean> {
  return new Promise((resolve) => {
    pending?.resolve(false);
    pending = {
      msg,
      resolve,
      title: opts.title,
      confirmText: opts.confirmText,
      cancelText: opts.cancelText,
    };
    listeners.forEach((l) => l());
  });
}

/** 场景措辞预设：**措辞属于场景、不属于组件**——组件只提供通用兜底。
 *  R21c 实录：忽略作业复用了退选弹窗，整屏照抄「即将退选 / 确认退选」，用户当场发现。 */
export const CONFIRM_DROP_COURSE = { title: "即将退选，请确认！", confirmText: "确认退选" } as const;
export const CONFIRM_IGNORE_HW = { title: "忽略这条作业，请确认！", confirmText: "确认忽略" } as const;
/** 正文图片因登录状态失效没加载出来：**非危险档**二选一——主按钮去重新登录，次按钮就地
 *  关掉（2026-10-12 用户令：改用带按钮的弹窗，别再弹会自己消失的中央提示；且不该用
 *  「不可撤销」那套红色警告档——两个选项都是正常动作）。 */
export const CONFIRM_IMG_RELOGIN = { title: "正文图片加载失败", confirmText: "重新登录", cancelText: "忽略" } as const;

export function answerConfirm(v: boolean): void {
  pending?.resolve(v);
  pending = null;
  listeners.forEach((l) => l());
}

/* ---------- 文本输入弹层（云盘新建资料库/文件夹等命名场景） ----------
 * 与 confirmOk 同款 DOM 覆盖层（WKWebView 的 window.prompt 同样不可用）。 */

type PromptPending = {
  title: string;
  placeholder: string;
  initial: string;
  resolve: (v: string | null) => void;
};
let promptPending: PromptPending | null = null;
const promptListeners = new Set<() => void>();

/** 应用内输入弹窗：确认返回文本（trim 后非空），取消返回 null。 */
export function promptText(
  title: string,
  opts: { placeholder?: string; initial?: string } = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    promptPending?.resolve(null); // 新请求顶掉旧请求（旧者按取消结算）
    promptPending = {
      title,
      placeholder: opts.placeholder ?? "",
      initial: opts.initial ?? "",
      resolve,
    };
    promptListeners.forEach((l) => l());
  });
}

export function answerPrompt(v: string | null): void {
  promptPending?.resolve(v);
  promptPending = null;
  promptListeners.forEach((l) => l());
}

function PromptHost(): React.ReactNode {
  const cur = useSyncExternalStore(
    (l) => {
      promptListeners.add(l);
      return () => promptListeners.delete(l);
    },
    () => promptPending,
  );
  const [val, setVal] = useState("");
  useEffect(() => {
    setVal(cur?.initial ?? "");
  }, [cur]);
  if (!cur) return null;
  const submit = (): void => {
    const t = val.trim();
    if (t) answerPrompt(t);
  };
  return (
    <div className="confirm-mask" style={{ position: "fixed", inset: 0, zIndex: "var(--og-z-confirm)", background: "var(--og-scrim)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div className="confirm-card" style={{ background: "var(--og-surface-overlay)", color: "var(--og-content-1)", borderRadius: "var(--og-radius-lg)", padding: "18px 18px 14px", maxWidth: 380, width: "100%" }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>{cur.title}</div>
        <Input autoFocus placeholder={cur.placeholder} value={val} onChange={(value) => setVal(value)} onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") answerPrompt(null);
          }} />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <Btn variant="outline" onClick={() => answerPrompt(null)}>{i18n("auto.lib.confirm.1")}</Btn>
          <Btn variant="outline" disabled={!val.trim()} onClick={submit}>{i18n("auto.lib.confirm.2")}</Btn>
        </div>
      </div>
    </div>
  );
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function ConfirmHost(): React.ReactNode {
  return createPortal(<>
      <ConfirmBody />
      <PromptHost />
    </>, document.body);
}

function ConfirmBody(): React.ReactNode {
  const cur = useSyncExternalStore(subscribe, () => pending);
  if (!cur) return null;
  const glass: React.CSSProperties = {
    background: "var(--og-accent-soft)",
    backdropFilter: "blur(28px) saturate(180%)",
    WebkitBackdropFilter: "blur(28px) saturate(180%)",
    boxShadow: "var(--og-elev-3)",
  };
  if (cur.danger) {
    return (
      <div className="confirm-mask" style={{ position: "fixed", inset: 0, zIndex: "var(--og-z-confirm)", background: "var(--og-scrim)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div className="confirm-card" style={{ ...glass, borderRadius: 20, padding: "26px 26px 20px", maxWidth: 440, width: "100%", textAlign: "center" }}>
          <div style={{ fontSize: 46, lineHeight: 1, marginBottom: 14 }}>⚠️</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: "var(--og-error)", marginBottom: 8 }}>{cur.title ?? "此操作不可撤销，请确认"}</div>
          <div style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--og-content-2)" }}>{cur.msg}</div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 18 }}>
            <Btn variant="outline" onClick={() => answerConfirm(false)}>{i18n("auto.lib.confirm.1")}</Btn>
            <Btn variant="outline" onClick={() => answerConfirm(true)}>{cur.confirmText ?? "确认执行"}</Btn>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="confirm-mask" style={{ position: "fixed", inset: 0, zIndex: "var(--og-z-confirm)", background: "var(--og-scrim)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div className="confirm-card" style={{ ...glass, borderRadius: "var(--og-radius-lg)", padding: "18px 18px 14px", maxWidth: 420, width: "100%" }}>
        {cur.title ? <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{cur.title}</div> : null}
        <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{cur.msg}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <Btn variant="outline" onClick={() => answerConfirm(false)}>{cur.cancelText ?? "取消"}</Btn>
          <Btn variant="outline" onClick={() => answerConfirm(true)}>{cur.confirmText ?? "确定"}</Btn>
        </div>
      </div>
    </div>
  );
}
