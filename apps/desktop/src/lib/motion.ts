import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * 动效工具（local/anim-delight）：把"什么时候该动、什么时候不该动"的判断收在一处。
 * 三条规则：系统要求减弱动态 → 一律不动；手机上不开重效果；动画只做一次不循环。
 */

/** 系统级「减弱动态效果」（iOS/安卓/Windows 都有这个开关，必须尊重） */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
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
 * 页签切换方向：按页签在顺序表中的位置比较"上一项 vs 当前项"，决定内容从哪一侧滑入。
 * 只在渲染期比较，幂等（StrictMode 双渲染下结果一致）。
 */
export function useTabDirection(activeId: string | null, order: readonly string[]): "next" | "prev" {
  const prevRef = useRef<string | null>(activeId);
  const dirRef = useRef<"next" | "prev">("next");
  if (prevRef.current !== activeId) {
    const from = prevRef.current === null ? -1 : order.indexOf(prevRef.current);
    const to = activeId === null ? -1 : order.indexOf(activeId);
    dirRef.current = from >= 0 && to >= 0 && to < from ? "prev" : "next";
    prevRef.current = activeId;
  }
  return dirRef.current;
}

/**
 * 退场相位：active 变 false 后仍保持挂载 ms 毫秒，并返回 closing=true。
 * 纯 CSS 做不到"先播完退场再卸载"，弹层/遮罩/抽屉的关闭都需要这一层状态机。
 */
export function useExitPhase(active: boolean, ms = 200): { mounted: boolean; closing: boolean } {
  const [state, setState] = useState<"in" | "out" | "gone">(active ? "in" : "gone");
  const wasActive = useRef(active);
  useEffect(() => {
    if (active) {
      wasActive.current = true;
      setState("in");
      return;
    }
    if (!wasActive.current) return;
    wasActive.current = false;
    setState("out");
    const t = window.setTimeout(() => setState("gone"), ms);
    return () => window.clearTimeout(t);
  }, [active, ms]);
  return { mounted: state !== "gone", closing: state === "out" };
}

/**
 * 滚动揭示：列表项进入视口时侧向滑入（长列表滚动时"新出现的项"不再突变）。
 *
 * 与挂载逐项进场的关系：命中本选择器的元素在 CSS 里被置为 animation: none + opacity: 0，
 * 改由观察器在进入视口时加 .is-in 播 m-reveal-in（同批按 26ms 递延）。两者不能同时作用于
 * 同一元素——挂载动画结束回落到基态 opacity: 0 会让元素消失。关闭 JS / 减弱动态时不加
 * has-reveal，元素保持可见。
 */
export const REVEAL_SELECTOR =
  ":is(.list, .stats, .today-grid, .market-grid, .icon-grid, .setting-group) > *, .row-click, .mail-row, .news-row, .setting-row, .cloud-row";

export function installScrollReveal(): void {
  if (typeof document === "undefined" || typeof IntersectionObserver === "undefined" || typeof MutationObserver === "undefined") return;
  if (prefersReducedMotion()) return;
  document.documentElement.classList.add("has-reveal");

  const io = new IntersectionObserver(
    (entries) => {
      let i = 0;
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target as HTMLElement;
        // 同一批（首屏同时出现的一屏）按序递延，避免整屏同时亮起
        el.style.animationDelay = `${Math.min(i++, 11) * 26}ms`;
        el.classList.add("is-in");
        io.unobserve(el);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.01 },
  );

  const scan = () => {
    document.querySelectorAll<HTMLElement>(REVEAL_SELECTOR).forEach((el) => {
      if (el.classList.contains("is-in") || el.dataset.reveal === "1") return;
      el.dataset.reveal = "1";
      io.observe(el);
    });
  };
  scan();

  // 动态内容（翻页 / 筛选 / 新数据）也要纳入；100ms 防抖，避免频繁重排时反复全量查询
  let timer = 0;
  new MutationObserver(() => {
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = 0;
      scan();
    }, 100);
  }).observe(document.body, { childList: true, subtree: true });
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
 * 分段条滑动块（.seg-pill）：把"当前项"从按钮自带底色换成会滑动的块，
 * 切换页签时块从旧位置滑到新位置（`--dur-3` + `--ease-ios`）。
 *
 * 用法：`const [rowRef, pillRef] = useSegPill();`，rowRef 挂到 .segmented 容器，
 * pillRef 挂到容器内第一个 `<span className="seg-pill" />`。
 *
 * 两条纪律：
 *  - 测量放在 layout 相位（首帧 paint 之前就位），不会出现"从 0 位置滑进来"；
 *  - `.is-ready` 只在量到有效宽度后才加——测量失败时按钮保留自带底色，
 *    不会退化成"没有块也没有底色"。CSS 侧用 `:has(.seg-pill.is-ready)` 对齐这条。
 */
export function useSegPill() {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const pillRef = useRef<HTMLSpanElement | null>(null);

  const place = useCallback(() => {
    const el = rowRef.current;
    const pill = pillRef.current;
    if (!el || !pill) return;
    const active = el.querySelector<HTMLElement>("button.is-active");
    const box = active?.getBoundingClientRect();
    if (!active || !box || box.width <= 0) {
      if (pill.classList.contains("is-ready")) pill.classList.remove("is-ready");
      return;
    }
    // 块是容器的绝对定位子元素：left:0 落在 padding 边，故减掉 clientLeft、加上 scrollLeft
    const base = el.getBoundingClientRect();
    pill.style.width = `${box.width}px`;
    pill.style.transform = `translateX(${box.left - base.left - el.clientLeft + el.scrollLeft}px)`;
    if (!pill.classList.contains("is-ready")) pill.classList.add("is-ready");
  }, []);

  // 每次渲染后重测：active 切换、页签文案变化都会改变块的位置与宽度
  useLayoutEffect(() => {
    place();
  });

  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => place());
    ro.observe(el);
    // 字体后加载会改变按钮宽度（容器尺寸不变），补测一次
    void document.fonts?.ready.then(() => place()).catch(() => {});
    return () => ro.disconnect();
  }, [place]);

  return [rowRef, pillRef] as const;
}
