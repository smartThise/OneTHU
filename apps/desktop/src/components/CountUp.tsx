import { useEffect, useRef, useState } from "react";

/**
 * D4 数字递增（霖 2026-10-02）。
 *
 * 用 rAF 从 0 插值到目标值（三次缓出），**不用 CSS 计数**：CSS 方案（`@property` + counter）
 * 在 WebView 上不稳，而且 DOM 里始终是终值——读屏与复制会拿到和眼前不一样的数字（D4 的反例）。
 * 这里显示的就是当前值，屏幕阅读器读到的与看到的始终一致。
 *
 * 三条口径：
 *   ① 默认 600ms（`COUNTUP_MS`），调用方可覆盖；
 *   ② **每次进入页面只播一次**——本挂载周期内用 ref 记住，数据刷新/重渲染不再重播；
 *      离开页面再进来是新的一次挂载，照常播；
 *   ③ `prefers-reduced-motion: reduce` 时直接给终值（不动画）。
 *
 * 数字容器请带 `font-variant-numeric: tabular-nums`（见 `.mine-stat-num`），否则等宽变化会让
 * 数字左右抖。目标为 `null`（数据还没到）时返回占位符「—」。
 */
export const COUNTUP_MS = 600;

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useCountUp(target: number | null, fmt: (v: number) => string, ms = COUNTUP_MS): string {
  const fmtRef = useRef(fmt);
  fmtRef.current = fmt;
  /* 本挂载周期是否已经播过（②）。放在 ref 里而不是 state：它不该触发重渲染 */
  const played = useRef(false);
  const [text, setText] = useState(() => (target == null ? "—" : fmtRef.current(0)));

  useEffect(() => {
    if (target == null) {
      setText("—");
      return;
    }
    if (prefersReducedMotion() || played.current) {
      played.current = true;
      setText(fmtRef.current(target));
      return;
    }
    played.current = true;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      /* rAF 回调时间戳可能早于 t0（同一帧内取 now），p 会成负 → 首帧闪一个负值；两侧都夹紧 */
      const p = Math.min(1, Math.max(0, (t - t0) / ms));
      const eased = 1 - Math.pow(1 - p, 3);
      if (p < 1) {
        setText(fmtRef.current(target * eased));
        raf = requestAnimationFrame(tick);
      } else {
        /* 收尾一定写终值：浮点插值的最后一帧未必正好等于 target */
        setText(fmtRef.current(target));
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);

  return text;
}
