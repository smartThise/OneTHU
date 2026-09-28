/**
 * 首页一次性引导（§4.6）：改版后首次进新首页，最多 3 处、可跳过、看过不再打扰。
 *
 * 不做全屏遮罩式的"指哪打哪"——首页是两栏自适应布局，遮罩在窄屏和宽屏上都会盖住
 * 它正要指的东西。改成：给目标加一圈高亮、提示卡贴着目标放。
 *
 * 一次改版教训（2026-09-28，霖实测只出现两条）：第三条的卡片 id 写错了（写成了 suggest，
 * 实际那张卡是 for-you）——找不到目标就静默跳过，于是看起来像"走两条就没了"。
 * 两处修正：锚点改对；**"共几条"按真正能指的条数算**，数不到的条目不进分母，
 * 不再出现"明明说三条、实际只走两条"的错觉。锚点写错现在由 tools/help-coach-test.mjs 拦下。
 */
import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const KEY = "onethu.home.coach.v1";

/** 锚点必须真的存在于「今日」页（护栏逐条核对 data-card / data-coach 的名字） */
const TIPS: Array<{ target: string; text: string }> = [
  { target: '[data-coach="home-edit"]', text: "点「编辑」可以给卡片换位置、把不用的收起来。" },
  { target: '[data-coach="home-collapse"]', text: "标题行右侧的箭头能把卡片折叠，首页就短了。" },
  { target: '[data-card="for-you"]', text: "这里会按你的习惯推荐功能；找不到的都在「服务」页，也能直接搜。" },
];

export function HomeCoachMarks(): ReactNode {
  const [done, setDone] = useState<boolean>(() => {
    try {
      return localStorage.getItem(KEY) === "done";
    } catch {
      return true; // 读不到就当他看过了：宁可少提示，不要每次进来都弹
    }
  });
  const [ready, setReady] = useState(false);
  const [avail, setAvail] = useState<typeof TIPS>([]);
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

  /* 先等一小会儿再数：首页部分卡片是异步算出来的，"还没渲染"不等于"没有" */
  useEffect(() => {
    if (done) return;
    const t = window.setTimeout(() => {
      const found = TIPS.filter((x) => document.querySelector(x.target));
      setAvail(found);
      setReady(true);
      if (found.length === 0) finish(); // 一条都指不到就别打扰
    }, 400);
    return () => window.clearTimeout(t);
  }, [done, finish]);

  const tip = !done && ready && idx < avail.length ? avail[idx] : null;

  useLayoutEffect(() => {
    if (!tip) return;
    const el = document.querySelector<HTMLElement>(tip.target);
    if (!el) {
      setIdx((i) => i + 1); // 中途消失（卡片被隐藏）→ 看下一条
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
    if (done || !ready) return;
    if (idx >= avail.length) finish();
  }, [done, ready, idx, avail.length, finish]);

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

  const last = idx === avail.length - 1;

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
          第 {idx + 1} 条，共 {avail.length} 条
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
