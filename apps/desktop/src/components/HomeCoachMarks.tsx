/**
 * 首页一次性引导（§4.6）：改版后首次进新首页，最多 3 处、可跳过、看过不再打扰。
 *
 * 不做全屏遮罩式的"指哪打哪"——首页是两栏自适应布局，遮罩在窄屏和宽屏上都会盖住
 * 它正要指的东西。改成：给目标加一圈高亮、提示卡贴着目标放；**目标找不到就跳过这条**
 * （卡片可能被用户隐藏、或内容为空整卡不渲染），指错地方比不指更糟。
 */
import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const KEY = "onethu.home.coach.v1";

const TIPS: Array<{ target: string; text: string }> = [
  { target: '[data-coach="home-edit"]', text: "点「编辑」可以给卡片换位置、把不用的收起来。" },
  { target: '[data-coach="home-collapse"]', text: "标题行右侧的箭头能把卡片折叠，首页就短了。" },
  { target: '[data-card="suggest"]', text: "这里会按你的习惯推荐功能；找不到的都在「服务」页，也能直接搜。" },
];

export function HomeCoachMarks(): ReactNode {
  const [done, setDone] = useState<boolean>(() => {
    try {
      return localStorage.getItem(KEY) === "done";
    } catch {
      return true; // 读不到就当他看过了：宁可少提示，不要每次进来都弹
    }
  });
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; bottom: number; right: number } | null>(null);

  const finish = useCallback(() => {
    try {
      localStorage.setItem(KEY, "done");
    } catch {
      /* 存不下也只是下次再看一遍，不值得打断 */
    }
    setDone(true);
  }, []);

  const tip = done || idx >= TIPS.length ? null : TIPS[idx];

  useLayoutEffect(() => {
    if (!tip) return;
    const el = document.querySelector<HTMLElement>(tip.target);
    if (!el) {
      setIdx((i) => i + 1); // 这条指不到东西 → 看下一条
      return;
    }
    el.classList.add("coach-target");
    const update = (): void => {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, bottom: r.bottom, right: r.right });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      el.classList.remove("coach-target");
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [tip]);

  useEffect(() => {
    if (done) return;
    if (idx >= TIPS.length) finish();
  }, [done, idx, finish]);

  if (!tip) return null;

  /* 贴着目标放；窄屏（放不下 320 宽）就退化成底部一张卡，别挤出屏幕 */
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const wide = vw >= 420 && rect !== null;
  const style: React.CSSProperties = wide && rect
    ? {
        position: "fixed",
        top: Math.min(rect.bottom + 10, vh - 160),
        left: Math.max(12, Math.min(rect.left, vw - 336)),
        width: 320,
      }
    : {
        position: "fixed",
        left: 12,
        right: 12,
        bottom: "calc(12px + env(safe-area-inset-bottom))",
      };

  const last = idx === TIPS.length - 1;

  return createPortal(
    <div
      className="coach-card"
      style={{
        ...style,
        zIndex: 1400,
        background: "var(--md-sys-color-surface)",
        color: "var(--text-1)",
        borderRadius: "var(--r-lg)",
        boxShadow: "0 8px 28px rgba(0,0,0,.22)",
        padding: 12,
        display: "grid",
        gap: 8,
      }}
      role="status"
    >
      <div style={{ fontSize: "var(--text-sm)", lineHeight: 1.5 }}>{tip.text}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="dim" style={{ fontSize: "var(--text-xs)" }}>
          {idx + 1}/{TIPS.length}
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-ghost" onClick={finish}>
          不再提示
        </button>
        <button className="btn btn-primary" onClick={() => (last ? finish() : setIdx((i) => i + 1))}>
          {last ? "知道了" : "下一条"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
