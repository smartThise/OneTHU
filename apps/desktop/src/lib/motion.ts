import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

/**
 * 动效工具（local/anim-delight）：把"什么时候该动、什么时候不该动"的判断收在一处。
 * 三条规则：系统要求减弱动态 → 一律不动；手机上不开重效果；动画只做一次不循环。
 */

/** 系统级「减弱动态效果」（iOS/安卓/Windows 都有这个开关，必须尊重） */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 真机密度层（main.tsx 按触屏 + 窄窗打标），涟漪等触摸特效只在这里开 */
export function isPhoneShell(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("is-phone");
}

type DocWithVT = Document & {
  startViewTransition?: (cb: () => void) => { finished: Promise<void> };
};

/**
 * 用 View Transitions API 包一次 DOM 变更（支持的宿主上是真正的快照转场，
 * 不支持/减弱动态时退化为同步执行，行为完全一致）。
 * React 状态更新必须同步提交（flushSync）快照才抓得到新 DOM——这一步在这里做掉，
 * 调用方只管写普通的状态更新代码。
 */
export function withViewTransition(apply: () => void, dir: "forward" | "back" = "forward"): void {
  const doc = document as DocWithVT;
  if (typeof doc.startViewTransition !== "function" || prefersReducedMotion()) {
    apply();
    return;
  }
  document.documentElement.dataset.navDir = dir;
  let started = false;
  try {
    doc.startViewTransition(() => {
      started = true;
      flushSync(apply);
    });
  } catch {
    // 快照启动失败（宿主怪癖）不能让导航丢失：兜底再同步跑一次状态更新
    if (!started) apply();
  }
}

/**
 * 数字滚动：值变化时从旧值平滑滚到新值（统计卡用）。
 * 减弱动态时直接返回目标值——不做"为了动而动的"动画。
 */
export function useCountUp(value: number, dur = 680): number {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (!Number.isFinite(value)) return;
    if (prefersReducedMotion() || value === fromRef.current) {
      fromRef.current = value;
      setShown(value);
      return;
    }
    const from = fromRef.current;
    const delta = value - from;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      // easeOutCubic：起步快、收尾稳，比线性"贵"
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(from + delta * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(step);
      else fromRef.current = value;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      fromRef.current = value;
    };
  }, [value, dur]);
  return shown;
}

/**
 * 触摸涟漪：全局只挂一个 pointerdown 监听（不是每个按钮一个），
 * 只在真机密度层生效。节点追加到宿主元素内部，动画结束自行移除。
 */
export function installRipple(): void {
  if (typeof document === "undefined") return;
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!isPhoneShell()) return;
      const target = e.target as Element | null;
      const host = target?.closest?.(".btn, .row-click, .nav-item, .chip") as HTMLElement | null;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const size = Math.max(rect.width, rect.height) * 1.1;
      const span = document.createElement("span");
      span.className = "m-ripple";
      span.style.width = `${size}px`;
      span.style.height = `${size}px`;
      span.style.left = `${e.clientX - rect.left - size / 2}px`;
      span.style.top = `${e.clientY - rect.top - size / 2}px`;
      span.addEventListener("animationend", () => span.remove(), { once: true });
      host.appendChild(span);
    },
    { passive: true },
  );
}
