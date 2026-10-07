/**
 * 命令面板的开关状态（§2.8.4）：键盘（⌘/Ctrl+K）与侧栏按钮都要能开它，而面板组件挂在布局顶层
 * ——用模块级订阅源，与设置分层、首启灰度同一套写法，避免往布局里层层传 props。
 */
import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const f of listeners) f();
}

export function openPalette(): void {
  if (!open) {
    open = true;
    emit();
  }
}

export function closePalette(): void {
  if (open) {
    open = false;
    emit();
  }
}

export function togglePalette(): void {
  if (open) closePalette();
  else openPalette();
}

export function isPaletteOpen(): boolean {
  return open;
}

export function subscribePalette(f: () => void): () => void {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

export function usePaletteOpen(): boolean {
  return useSyncExternalStore(subscribePalette, isPaletteOpen, () => false);
}
