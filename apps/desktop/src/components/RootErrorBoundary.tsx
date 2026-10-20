import { Btn } from "@onethu/gui";
/**
 * 根级渲染错误边界（R24）。
 *
 * 教训：预览白屏事故（Hook 顺序违规）让**整棵应用树卸载**，用户只看到纯白窗口，
 * 而 `main.tsx` 里只有 window.error/unhandledrejection 日志钩子——能记录但**不能恢复**，
 * 面板内也没有任何可见提示。根级边界把这类崩溃变成"一张可读的卡片 + 重试/重载"，
 * 任何组件抛错都不再等于整窗白屏。
 *
 * 注意：边界只能兜渲染期错误（React 能捕获的那类）；事件回调/异步错误仍走 main.tsx 的
 * 全局日志钩子。Hook 顺序违规也属于渲染期错误，会被这里兜住（组件内边界兜不住自己）。
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { logLine } from "../lib/clients.js";
import { t as i18n } from "../i18n/index.js";


interface Props {
  children: ReactNode;
}
interface State {
  err: string | null;
  stack: string;
}

export class RootErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { err: null, stack: "" };
  }

  static getDerivedStateFromError(e: unknown): Pick<State, "err" | "stack"> {
    return {
      err: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? (e.stack ?? "") : "",
    };
  }

  componentDidCatch(e: unknown, info: ErrorInfo): void {
    // 落盘（与 RENDER-ERR 同一日志通道）：客户端排查时不用猜
    void logLine(
      `ROOT-BOUNDARY ${String(e).slice(0, 300)} componentStack=${(info.componentStack ?? "").slice(0, 600)}`,
    ).catch(() => undefined);
  }

  render(): ReactNode {
    if (this.state.err === null) return this.props.children;
    return (
      <div style={{ padding: 24, fontFamily: "inherit", color: "var(--text-1, #1b1f24)" }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{i18n("auto.components.RootErrorBoundary.1")}</div>
        <div style={{ fontSize: 13, color: "var(--text-3, #9aa1ac)", lineHeight: 1.8, marginBottom: 12 }}>
          {i18n("auto.components.RootErrorBoundary.2")}</div>
        <div
          style={{
            fontSize: 11.5,
            color: "var(--text-3, #9aa1ac)",
            background: "rgba(127,127,127,.08)",
            borderRadius: 8,
            padding: "8px 10px",
            marginBottom: 14,
            wordBreak: "break-all",
            maxHeight: 160,
            overflow: "auto",
          }}
        >
          {this.state.err.slice(0, 300)}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn variant="solid" tone="brand" onClick={() => this.setState({ err: null, stack: "" })}>{i18n("auto.components.RootErrorBoundary.3")}</Btn>
          <Btn variant="outline" onClick={() => window.location.reload()}>{i18n("auto.components.RootErrorBoundary.4")}</Btn>
          <Btn variant="ghost" onClick={() => void navigator.clipboard?.writeText(`${this.state.err}\n${this.state.stack}`).catch(() => undefined)}>{i18n("auto.components.RootErrorBoundary.5")}</Btn>
        </div>
      </div>
    );
  }
}
