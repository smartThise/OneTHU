import { useEffect, useState } from "react";
/** 全局轻提示（原子操作反馈用）：单条覆盖式，2.8s 自动消失 */
let current: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(m: string | null) => void>();
function emit(): void {
  listeners.forEach((fn) => fn(current));
}
export function showToast(text: string): void {
  current = text;
  if (timer) clearTimeout(timer);
  emit();
  timer = setTimeout(() => {
    current = null;
    emit();
  }, 2800);
}
export function hideToast(): void {
  current = null;
  if (timer) clearTimeout(timer);
  emit();
}
export function useToastHost(): string | null {
  const [msg, setMsg] = useState<string | null>(current);
  useEffect(() => {
    listeners.add(setMsg);
    return () => {
      listeners.delete(setMsg);
    };
  }, []);
  return msg;
}
