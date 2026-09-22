import { useEffect, useRef, useState } from "react";

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

/**
 * 页面转场**不用** View Transitions API。
 *
 * 实测（霖 2026-09-22）：整页 tab 切换走快照交叉淡入时，旧页快照会在新页**下层**
 * 以半透明残留（两张整页截图叠加），观感是"旧页面在下面闪一下"——每次切换都闪。
 * 快照转场适合"列表卡 → 详情页"这类有共享元素的场景，不适合整页替换。
 * 因此转场统一走 .page-anim 的 CSS 进场（新页淡入上浮，旧页直接卸载，无叠加）。
 */

/**
 * 导航方向（CSS 转场用）：进二级页=前进，从二级页回顶层=后退。
 * 只在渲染期比较"上一页 vs 当前页"，比较是幂等的（StrictMode 双渲染下结果一致）。
 */
export function useNavDirection(page: string, isSubPage: (p: string) => boolean): "forward" | "back" {
  const prevRef = useRef(page);
  const dirRef = useRef<"forward" | "back">("forward");
  if (prevRef.current !== page) {
    dirRef.current = !isSubPage(page) && isSubPage(prevRef.current) ? "back" : "forward";
    prevRef.current = page;
  }
  return dirRef.current;
}

/**
 * 数字滚动：值变化时从旧值平滑滚到新值（统计卡用）。
 * 减弱动态时直接返回目标值——不做"为了而动的"动画。
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
