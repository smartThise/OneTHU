/**
 * MD3 涟漪（§3.5 B1）。
 *
 * 为什么是"全局单监听"而不是包一层组件：按钮在全应用有 400+ 处调用，包组件等于动 400 处 JSX
 * 与布局；这里只认类名（.btn / .icon-btn / .chip / [data-ripple]），调用点一行都不用改。
 *
 * 纪律：
 *   · 只服务触摸/笔：鼠标指针不做涟漪，桌面反馈由 hover/pressed 状态层承担（§2.8.3 × §3.5）；
 *   · 只动画 transform / opacity（§3.10），不碰 width/height/top/left；
 *   · prefers-reduced-motion 直接不生成涟漪（CSS 的 8%/12% 状态层仍在，反馈不丢）；
 *   · 涟漪装在宿主的 .md-ripple-layer 里（overflow: hidden + border-radius: inherit），
 *     不给宿主加 overflow:hidden——否则按钮里的浮层（下拉等）会被一起裁掉。
 */
import { prefersReducedMotion } from "../lib/motion.js";

const HOST = ".btn, .icon-btn, .chip, [data-ripple]";
const RIPPLE = "md-ripple";
const LAYER = "md-ripple-layer";
const MAX_LIVE = 3; // 同一宿主同时最多 3 个（连点时不至于堆 DOM）
const LIFE = 600; // 动画时长（long-2=500ms）之外的兜底清理

function layerOf(host: HTMLElement): HTMLElement {
  const found = host.querySelector<HTMLElement>(":scope > ." + LAYER);
  if (found) return found;
  const layer = document.createElement("span");
  layer.className = LAYER;
  host.appendChild(layer);
  return layer;
}

function spawn(host: HTMLElement, x: number, y: number): void {
  const layer = layerOf(host);
  if (layer.childElementCount >= MAX_LIVE) layer.firstElementChild?.remove();
  const rect = host.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 2;
  const dot = document.createElement("span");
  dot.className = RIPPLE;
  dot.style.width = size + "px";
  dot.style.height = size + "px";
  dot.style.left = x - rect.left - size / 2 + "px";
  dot.style.top = y - rect.top - size / 2 + "px";
  layer.appendChild(dot);
  const done = (): void => {
    dot.remove();
    // 涟漪散尽后把层也收掉，别给页面留空壳（.btn 有几百个）
    if (!layer.childElementCount) layer.remove();
  };
  dot.addEventListener("animationend", done, { once: true });
  window.setTimeout(done, LIFE);
}

/** 装上全局涟漪；返回卸载函数（测试与热更新用） */
export function installRipple(): () => void {
  if (typeof document === "undefined") return () => undefined;
  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return; // 只认主键 / 触摸
    if (e.pointerType === "mouse") return; // 鼠标：不做涟漪（§2.8.3，用状态层）
    if (prefersReducedMotion()) return; // 减少动效：不生成
    const host = (e.target as HTMLElement | null)?.closest?.(HOST) as HTMLElement | null;
    if (!host) return;
    if (host.hasAttribute("disabled") || host.getAttribute("aria-disabled") === "true") return;
    spawn(host, e.clientX, e.clientY);
  };
  document.addEventListener("pointerdown", onDown, { passive: true });
  return () => document.removeEventListener("pointerdown", onDown);
}
