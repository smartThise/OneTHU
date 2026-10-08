import { useEffect, useRef, type RefObject } from "react";

/**
 * C7 横向滑动切 tab（霖 2026-10-01 走查）。
 *
 * 为什么重做：待办页原来把切换挂在 `.tasks-body` 的 pointerdown/pointerup 上，但列表一旦
 * 开始滚动，浏览器就会发 `pointercancel`（实测 end=0/cancel=0），于是手指落在列表里横滑
 * 什么也不会发生——只有标题区（不滚的地方）滑得动。改成 touch 事件 + 主轴判定：
 *
 *   · 容器声明 `touch-action: pan-y`（横滑留给切 tab，纵向滚动仍归浏览器）；
 *   · 监听全 passive、**不** preventDefault —— 列表照常滚、照常有惯性；
 *   · 位移超过 8px 先定主轴：横向优先才算「滑 tab」，纵向优先这一次就再不管（防误切）；
 *   · 抬手时横向位移要 ≥ SWIPE_MIN_DX，且 ≥ SWIPE_AXIS_RATIO 倍纵向位移才切；
 *   · 从分段控件（`.seg-track`，它自己要用横滑拖胶囊）或任何 `[data-swipe-ignore]`
 *     上起手的滑动一律不算。
 *
 * 顺序取「页面上真正渲染的那份数组」（用户自定义排序后的结果），所以相邻 tab 与眼睛看到的一致。
 */
export const SWIPE_MIN_DX = 40;
export const SWIPE_AXIS_RATIO = 2;
/** 起手点落在这些容器里就不参与（横滑是它们自己的手势） */
const SWIPE_IGNORE = ".seg-track, [data-swipe-ignore]";
/** 定主轴的死区（px）：小于它时还算不出方向 */
const SWIPE_AXIS_DEADZONE = 8;

export interface SwipeTabsOpts {
  /** 可见 tab 顺序（与页面 render 的同一份数组，越界不循环） */
  order: readonly string[];
  /** 当前 tab */
  current: string;
  /** 相邻切换：只回传真正相邻的那一项 */
  onChange: (next: string) => void;
  /** 关掉（如宽屏双栏同显，横滑无意义） */
  disabled?: boolean;
}

export function useSwipeTabs<T extends HTMLElement>(opts: SwipeTabsOpts): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const cb = useRef(opts);
  cb.current = opts;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.touchAction = "pan-y";
    let s: { x: number; y: number; axis: "x" | "y" | null } | null = null;
    const onStart = (e: TouchEvent): void => {
      const o = cb.current;
      const t = e.touches[0];
      const target = e.target instanceof Element ? e.target : null;
      if (o.disabled || e.touches.length !== 1 || !t || target?.closest(SWIPE_IGNORE)) {
        s = null;
        return;
      }
      s = { x: t.clientX, y: t.clientY, axis: null };
    };
    const onMove = (e: TouchEvent): void => {
      if (!s || s.axis) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) < SWIPE_AXIS_DEADZONE && Math.abs(dy) < SWIPE_AXIS_DEADZONE) return;
      s.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    };
    const onEnd = (e: TouchEvent): void => {
      const st = s;
      s = null;
      if (!st || st.axis !== "x") return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - st.x;
      const dy = t.clientY - st.y;
      if (Math.abs(dx) < SWIPE_MIN_DX || Math.abs(dx) < SWIPE_AXIS_RATIO * Math.abs(dy)) return;
      const o = cb.current;
      const i = o.order.indexOf(o.current);
      if (i < 0) return;
      const next = o.order[i + (dx < 0 ? 1 : -1)];
      if (next === undefined || next === o.current) return;
      /* 嵌套的手势区（收藏夹页每层 FolderView 都挂一次）只让**最内层**生效：
         touch 事件会冒泡，不拦住的话一次横滑会同时切内外两层的栏目。 */
      e.stopPropagation();
      o.onChange(next);
    };
    const onCancel = (): void => {
      s = null;
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onCancel);
    };
  }, []);

  return ref;
}
