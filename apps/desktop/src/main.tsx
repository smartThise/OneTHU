import { StrictMode } from "react";
import { logLine } from "./lib/clients.js";
// 渲染层崩溃捕获：白屏=未被记录的 JS 异常（webview 控制台/系统日志都拿不到），
// 全局 error/unhandledrejection 直接落盘 /tmp/onethu-debug.log。
function hookRenderError(kind: string, detail: string): void {
  void logLine(`RENDER-ERR ${kind} ${detail}`).catch(() => undefined);
}
window.addEventListener("error", (e) => {
  if (e.message || e.error) hookRenderError("window", `${e.message} @${e.filename}:${e.lineno} stack=${e.error?.stack?.slice(0, 900) ?? ""}`);
});
window.addEventListener("unhandledrejection", (e) => {
  hookRenderError("rejection", `${String((e.reason as Error)?.message ?? e.reason).slice(0, 300)} stack=${(e.reason as Error)?.stack?.slice(0, 900) ?? ""}`);
});
// 真机密度标记：触屏 + 窄窗 → html.is-phone（CSS 密度层挂此类，不依赖媒体查询细节）
function markPhone(): void {
  const touch = (navigator.maxTouchPoints ?? 0) > 0 || window.matchMedia("(pointer: coarse)").matches;
  document.documentElement.classList.toggle("is-phone", touch && window.innerWidth <= 860);
}
markPhone();
window.addEventListener("resize", markPhone);

import { createRoot } from "react-dom/client";
import "@onethu/ui/tokens.css";
import { installAuthWatchdog } from "./lib/reload.js";

installAuthWatchdog();
import "@onethu/ui/base.css";
import "./styles/global.css";
import { App } from "./App.js";
import { ConfirmHost } from "./lib/confirm.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <ConfirmHost />
  </StrictMode>,
);
declare const __APP_VERSION__: string;
