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
// [dev 逐行探针] 模块求值完成（若蜂窝下此行不出现=模块加载期悬挂）
void logLine("PROBE js-modules-evaluated").catch(() => undefined);
window.addEventListener("unhandledrejection", (e) => {
  hookRenderError("rejection", `${String((e.reason as Error)?.message ?? e.reason).slice(0, 300)} stack=${(e.reason as Error)?.stack?.slice(0, 900) ?? ""}`);
});
// 开发者构建（ONETHU_DEV=1）：把 console.* 也灌进 Rust 日志链，真机导出的日志才有现场。
// 正式版 __ONETHU_DEV__ 折叠为 false → 整块（含动态 import）被静态删除。
if (__ONETHU_DEV__) {
  void import("./lib/devlog.js").then((m) => m.installDevLogBridge());
}
// 真机密度标记：触屏 + 窄窗 → html.is-phone（CSS 密度层挂此类，不依赖媒体查询细节）
function markPhone(): void {
  const touch = (navigator.maxTouchPoints ?? 0) > 0 || window.matchMedia("(pointer: coarse)").matches;
  document.documentElement.classList.toggle("is-phone", touch && window.innerWidth <= 860);
}
markPhone();
window.addEventListener("resize", markPhone);

import { createRoot } from "react-dom/client";
import { activateInstalledPlugins, seedBuiltinHarness } from "./plugins/loader.js";
import "@onethu/ui/tokens.css";
import { installAuthWatchdog, installKeepalive } from "./lib/reload.js";

installAuthWatchdog();
installKeepalive();   // 10 分钟会话保活探针：死会话在用户点击前就透明重建
// 系统日历自动跟随：订阅云/本日程与课表变更（未开启时零开销）
import { initSystemCalAutoSync } from "./state/systemCal.js";
initSystemCalAutoSync();
import "@onethu/ui/base.css";
import "./styles/global.css";
import { App } from "./App.js";
import { ConfirmHost } from "./lib/confirm.js";
import { FormModalHost } from "./lib/formModal.js";
import { RootErrorBoundary } from "./components/RootErrorBoundary.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* R24：根级错误边界——任何渲染期崩溃都变成可读卡片，不再整窗白屏 */}
    <RootErrorBoundary>
      <App />
      <ConfirmHost />
      <FormModalHost />
    </RootErrorBoundary>
  </StrictMode>,
);
// 恢复已装插件（异步，失败只落日志）
void (async () => {
  await seedBuiltinHarness();
  await activateInstalledPlugins();
})().catch(() => undefined);

declare const __APP_VERSION__: string;
