import { useEffect, useState } from "react";
/**
 * 全局轻提示（原子操作反馈用）：单条覆盖式，2.8s 自动消失。
 * local/anim-delight：加了「退出相位」——消息不是瞬间消失，而是先播 200ms 淡出动画
 * （closing=true），播完再真正清空，这样退场也有动效，而不是"啪"地不见。
 */
const EXIT_MS = 200;
let current: string | null = null;
let closing = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let exitTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(s: ToastState) => void>();
export type ToastState = { msg: string | null; closing: boolean };
function emit(): void {
  const snapshot: ToastState = { msg: current, closing };
  listeners.forEach((fn) => fn(snapshot));
}
function clearTimers(): void {
  if (timer) clearTimeout(timer);
  if (exitTimer) clearTimeout(exitTimer);
  timer = null;
  exitTimer = null;
}
/** 进入退出相位：先播淡出，再清空（若已在退出相位则不重复） */
function beginExit(): void {
  if (!current || closing) return;
  closing = true;
  emit();
  if (exitTimer) clearTimeout(exitTimer);
  exitTimer = setTimeout(() => {
    current = null;
    closing = false;
    exitTimer = null;
    emit();
  }, EXIT_MS);
}
/**
 * 静音区间：后台任务（推小组件快照等）会在「非用户操作」上下文中复用交互函数，
 * 那些函数可能弹提示；进静音区后提示被丢弃，避免用户莫名看到一句反馈。
 */
let muted = false;
export function muteToasts<T>(fn: () => T): T {
  const prev = muted;
  muted = true;
  try {
    return fn();
  } finally {
    muted = prev;
  }
}
export function showToast(text: string, ms = 2800): void {
  if (muted) return;
  clearTimers();
  current = text;
  closing = false;
  emit();
  timer = setTimeout(beginExit, ms);
}
export function hideToast(): void {
  clearTimers();
  beginExit();
}
export function useToastHost(): ToastState {
  const [state, setState] = useState<ToastState>({ msg: current, closing });
  useEffect(() => {
    listeners.add(setState);
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return state;
}
