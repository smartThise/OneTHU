/**
 * 输入模态：区分指针点击与键盘导航。
 *
 * WebView2/Chromium 对“程序化 focus”和鼠标点击后的焦点也可能命中 `:focus-visible`，
 * 于是 OH 胶囊、作业卡、设置弹窗会自动多出一圈主题色外描边。这里用最近的输入方式
 * 给 <html> 打 data-input；motion.css 只在键盘模态下播放全局焦点环。
 */
let installed = false;

export function installInputModality(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  const root = document.documentElement;
  root.dataset.input = "pointer";
  const pointer = (): void => { root.dataset.input = "pointer"; };
  const keyboard = (e: KeyboardEvent): void => {
    if (e.key === "Tab" || e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End" || e.key === "Enter" || e.key === " ") {
      root.dataset.input = "keyboard";
    }
  };
  window.addEventListener("pointerdown", pointer, { capture: true, passive: true });
  window.addEventListener("mousedown", pointer, { capture: true, passive: true });
  window.addEventListener("keydown", keyboard, { capture: true });
}
