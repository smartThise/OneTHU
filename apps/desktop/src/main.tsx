import { StrictMode } from "react";
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
declare const __APP_VERSION__: string;
