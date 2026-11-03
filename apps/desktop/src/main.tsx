/* ⚠️ 必须第一条：认领父窗口的 Tauri 桥（竖屏取景框是同源 iframe，Tauri 只注入主 frame）。
   放在最前，后面所有模块 import 时的 `"__TAURI_INTERNALS__" in window` 判定才是对的。 */
import "./lib/tauriBridge.js";
import { isPluginRuntimeOwner } from "./plugins/windowOwner.js";
import { initPrivacyConsent, ohAuthorized, subscribePrivacy } from "./state/privacyConsent.js";
const privacyReady = initPrivacyConsent();
import { StrictMode } from "react";
import { logLine } from "./lib/clients.js";
import { isPhoneViewport, platformOf } from "./state/platform.js";
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
// 真机密度标记：触屏 + 短边窄 → html.is-phone（CSS 密度层挂此类，不依赖媒体查询细节）。
// 判定在 state/platform.ts 的 isPhoneViewport()（唯一来源，横竖都算手机；dev 可 ?phone=1 强制预览）。
function markPhone(): void {
  document.documentElement.classList.toggle("is-phone", isPhoneViewport());
}
markPhone();
window.addEventListener("resize", markPhone);
// 列表/网格入场 stagger（手机密度层才挂）
installScrollReveal();
// 全字符对比度：文本在背景栈（壁纸+纱+玻璃层）实测亮度上自动选黑/白字
installTextContrast();
// 按钮涟漪（§3.5 B1）：全局单监听，认类名不认调用点；触摸/笔出涟漪，鼠标只走状态层（§2.8.3）
installRipple();
/* 悬浮球默认开：原生端不会自己 show，启动时按偏好真正显示一次（用户「本次关闭」则跳过） */
import { syncOverlayPreference } from "./lib/overlay.js";
if (isPluginRuntimeOwner()) void syncOverlayPreference();

import { createRoot } from "react-dom/client";
import { lazy, Suspense } from "react";
import { activateInstalledPlugins, seedBuiltinHarness, refreshHarnessConsent } from "./plugins/loader.js";
import "@onethu/ui/tokens.css";
import { installAuthWatchdog, installKeepalive } from "./lib/reload.js";
import { initOpticalRefraction } from "./lib/opticalRefraction.js";

// 风格管线（六轴）挂载：皮肤/明暗/密度/动效/强调色/平台一处解析、一处落盘。
// 平台判定复用 state/platform.ts 的唯一断点（禁止组件各自 matchMedia）。
// 密度随平台走：桌面 compact（与旧版刻度对齐——2026-10-14「卡片/按钮太大」）、手机 touch。
initOpticalRefraction();
installOneGUI({
  platform: () => (isPhoneViewport() ? "mobile" : platformOf(window.innerWidth) === "expanded" ? "desktop" : "mobile"),
  densityByPlatform: { desktop: "compact", mobile: "touch" },
  /* 折射只给"看得见边缘"的少数面（分组顺序=优先级）：壳层 chrome 与浮层优先，
     卡片次之；管线内部还有可见数/面积/设备预算与旧 WebView 门禁，超限自动退回模糊材质。
     这里给的是结构选择器，不是外观；材质与颜色仍由皮肤令牌决定。 */
  refractionSelector: [
    ".ohx-capsule", ".ex-bbar", ".dock-panel",
    ".free-item", ".home-card", ".hw-card",
    /* 页面级：玻璃卡/页头也应有边缘折射；大面积滚动容器由 pipeline 的面积预算淘汰。 */
    ".learn-course-card", ".og-pagehead", ".og-surface",
    ".og-panel", ".og-float", ".ex-sheet", ".settings-panel", ".theme-pick-panel",
    ".board-viewport-tools", ".workbench-board-head", ".notice-strip", ".onego-bookmarks",
  ].join(", "),
});
// 旧通道（主题明暗 / 玻璃档位）→ OneGUI 轴；用户现有选择立刻在 OneGUI 上生效
installOneGUIBridge();
if (isPluginRuntimeOwner()) {
  installAuthWatchdog();
  installKeepalive();   // 主窗口统一维持会话；悬浮窗口不另起登录链。
}
// 系统日历自动跟随：订阅云/本日程与课表变更（未开启时零开销）
import { initSystemCalAutoSync } from "./state/systemCal.js";
if (isPluginRuntimeOwner()) initSystemCalAutoSync();
// 玻璃程度档位：读档落到 <html data-glass>（默认档不落属性）
import { initGlassLevel } from "./lib/glassLevel.js";
initGlassLevel();
import "@onethu/ui/base.css";
import "./styles/global.css";
import "./styles/glass-levels.css";
import "./styles/preblur.css";
// 动效层（local/anim-delight）：令牌 + keyframes + 全局微交互。必须在 global.css 之后，
// 否则同选择器的 transition/animation 会被 global.css 覆盖。
import "./styles/motion.css";
// OneGUI（唯一 UI 体系）：正式样式表 + 风格管线。放在旧样式之后 —— 组件与令牌优先。
// 旧样式表在换血期间仍在，逐页迁移完成后整批删除（见 docs/onegui/00-plan.md §5）。
import "@onethu/gui/gui.css";
import { installOneGUI } from "@onethu/gui";
// OneTHU 宿主配方归库：兼容别名与壳层外观只有这一处来源。
// 设置适配器继续将现有明暗/材质/主题通道接到 OneGUI 六轴。
import "@onethu/gui/onethu.css";
import { installOneGUIBridge } from "./lib/oneguiBridge.js";
import { installScrollReveal } from "./lib/motion.js";
import { installTextContrast } from "./lib/textContrast.js";
import { installRipple } from "./components/Ripple.js";
import { initDynamicColor, watchDynamicColor } from "./lib/dynamicColor.js";
import { App } from "./App.js";
import { ConfirmHost } from "./lib/confirm.js";
import { FormModalHost } from "./lib/formModal.js";
import { RootErrorBoundary } from "./components/RootErrorBoundary.js";
import { TextPeekHost } from "./components/TextPeek.js";
import { ImageViewerHost } from "./components/ImageViewer.js";
import { I18nProvider } from "./i18n/I18nProvider.js";

/* 竖屏取景框（dev）：`?phone-frame=1` 时整页就是一块真手机视口（同源 iframe，登录态照旧）。
   这条分支走在应用引导之前——取景框自己不需要会话/插件/取色，那些副作用留给 iframe 里的文档。 */
const PHONE_FRAME = import.meta.env.DEV && new URLSearchParams(window.location.search).has("phone-frame");
const PhoneFrame = import.meta.env.DEV ? lazy(() => import("./components/PhoneFrame.js")) : null;

/* 取景框的键盘入口（dev）：**不依赖 __ONETHU_DEV__**。
   那个 dev 徽标要构建时 `ONETHU_DEV=1` 才有（vite.config 的 DEV_BUILD），日常 dev server 不带它，
   于是"根本没有 dev 按钮"。Cmd/Ctrl+Shift+P 直接切换：进 = 加 ?phone-frame=1 重载，再按一次退出。
   （Cmd+K 是命令面板、Cmd+±/0 是画布缩放，都不冲突。） */
if (import.meta.env.DEV) {
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "p") {
      e.preventDefault();
      const has = new URLSearchParams(window.location.search).has("phone-frame");
      window.location.href = window.location.pathname + (has ? "" : "?phone-frame=1");
    }
  });
}

if (PHONE_FRAME && PhoneFrame) {
  createRoot(document.getElementById("root")!).render(
    <Suspense fallback={null}>
      <PhoneFrame />
    </Suspense>,
  );
} else {
void privacyReady.then(() => {
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* R24：根级错误边界——任何渲染期崩溃都变成可读卡片，不再整窗白屏 */}
    <RootErrorBoundary>
      <I18nProvider>
      <App />
      <ConfirmHost />
      <FormModalHost />
      {/* 手机端双击看全文：被省略号截断的文本双击后弹浮层（可选中） */}
      <TextPeekHost />
      {/* 手机端长按看图：全屏查看 + 双指缩放 + 保存到相册，单击任意处退出 */}
      <ImageViewerHost />
      </I18nProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
});
}
// 动态取色（§3.4）：上次开着就重开；取色不可用会自动降级到「清华紫」主题。
// 放在 CSS 导入之后：注入的 <style> 需要插在令牌样式之后（且自身特异性更高，顺序无关紧要）。
initDynamicColor();
watchDynamicColor();

// 恢复已装插件（异步，失败只落日志）
void (async () => {
  if (!isPluginRuntimeOwner()) return;
  await privacyReady;
  const { initYuketangRuntimeSync } = await import("./state/yuketangRuntime.js");
  initYuketangRuntimeSync();
  await seedBuiltinHarness();
  await activateInstalledPlugins();
  let ohAllowed = ohAuthorized();
  subscribePrivacy(() => {
    const next = ohAuthorized();
    if (next === ohAllowed) return;
    ohAllowed = next;
    void refreshHarnessConsent().catch(() => undefined);
  });
  await refreshHarnessConsent();
})().catch(() => undefined);

declare const __APP_VERSION__: string;

/* glass probe 1791917225 */

/* glass force-reload 1791917328 */

/* glass r2 1791917664 */

/* glass r3 1791917757 */

/* glass r4 1791918078 */

/* glass r5 1791918118 */

/* gold glass r-g 1791943734 */

/* retune probe 1791944030 */

/* pin probe 1791944124 */

/* tc probe 1791944629 */
