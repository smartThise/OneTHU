/**
 * 首页一次性引导（§4.6）：改版后首次进新首页，最多 3 处、可跳过、看过不再打扰。
 *
 * 呈现方式（2026-09-28 霖反馈后定稿）：
 *  · **始终贴着被指的那个按钮/卡片**，像气泡一样跟在旁边——不再有"窄屏退化成底部卡片"的兜底；
 *  · 目标在屏幕外时**先平滑滚到它**再落卡片（演示一遍"它在哪"，而不是让用户自己找）；
 *  · 卡片不越界：上方放不下就翻到下面，下边缘让开底部导航栏（量它的实际位置，不写死高度）；
 *  · 找不到目标（卡片被隐藏、内容为空整卡不渲染）就跳过该条——指错地方比不指更糟。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const KEY = "onethu.home.coach.v1";

/** 锚点必须真的存在于「今日」页（护栏逐条核对 data-card / data-coach 的名字） */
const TIPS: Array<{ target: string; text: string }> = [
  { target: '[data-coach="home-edit"]', text: "点「编辑」可以给卡片换位置、把不用的收起来。" },
  { target: '[data-coach="home-collapse"]', text: "标题行右侧的箭头能把卡片折叠，首页就短了。" },
  { target: '[data-card="for-you"]', text: "这里会按你的习惯推荐功能；找不到的都在「服务」页，也能直接搜。" },
];

const GAP = 10;
const EDGE = 12;

type Rect = { top: number; left: number; right: number; bottom: number };

/** 底部导航栏的顶边（没量到就退回视口底）：卡片要让它 */
function navTop(): number {
  const el = document.querySelector(".bottom-nav, .bottom-nav-item")?.parentElement ?? document.querySelector(".bottom-nav");
  const t = el?.getBoundingClientRect().top;
  return typeof t === "number" && t > 0 ? t : window.innerHeight;
}

/** 贴着目标摆：优先下方，放不下翻上方；水平夹在视口内 */
function place(target: Rect, card: { w: number; h: number }): { top: number; left: number; width: number } {
  const vw = window.innerWidth;
  const bottomLimit = Math.min(window.innerHeight, navTop()) - EDGE;
  const below = target.bottom + GAP + card.h <= bottomLimit;
  const top = below
    ? target.bottom + GAP
    : Math.max(EDGE, Math.min(target.top - GAP - card.h, bottomLimit - card.h));
  const left = Math.max(EDGE, Math.min(target.left, vw - card.w - EDGE));
  return { top, left, width: card.w };
}

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
  const [rect, setRect] = useState<Rect | null>(null);
  const [card, setCard] = useState<{ w: number; h: number } | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const finish = useCallback(() => {
    try {
      localStorage.setItem(KEY, "done");
    } catch {
      /* 存不下也只是下次再看一遍，不值得打断 */
    }
    setDone(true);
  }, []);

  /* 首页部分卡片是异步算出来的，"还没渲染"不等于"没有"——所以要轮询几次；
     实在一条都指不到，这一次不显示，但**绝不能落 done**：那会把引导永久烧掉，
     用户下次冷启动就再也看不到了（2026-09-28 验收时抓到的真 bug）。 */
  useEffect(() => {
    if (done) return;
    let tries = 0;
    let timer = window.setTimeout(function look(): void {
      const found = TIPS.filter((x) => document.querySelector(x.target));
      if (found.length > 0) {
        setAvail(found);
        setReady(true);
        return;
      }
      if (++tries < 8) {
        timer = window.setTimeout(look, 500);
        return;
      }
      setReady(true); // 这次不打扰，下次进来重新试
    }, 300);
    return () => window.clearTimeout(timer);
  }, [done]);

  const tip = !done && ready && idx < avail.length ? avail[idx] : null;

  useLayoutEffect(() => {
    if (!tip) return;
    const el = document.querySelector<HTMLElement>(tip.target);
    if (!el) {
      setIdx((i) => i + 1); // 中途消失（卡片被隐藏）→ 看下一条
      return;
    }
    setCard(null); // 换目标要重新量卡片（文案变了，高度就变了）
    el.classList.add("coach-target");

    const read = (): void => {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, right: r.right, bottom: r.bottom });
    };

    // 目标不在可视区就先滚过去（避开底部导航），等滚动停下来再量
    const first = el.getBoundingClientRect();
    const hiddenBelow = first.bottom > navTop() - EDGE;
    const hiddenAbove = first.top < EDGE;
    const wait = hiddenBelow || hiddenAbove ? 460 : 0;
    if (wait > 0) el.scrollIntoView({ block: "center", behavior: "smooth" });

    const timer = window.setTimeout(read, wait);
    const onMove = (): void => read();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.clearTimeout(timer);
      el.classList.remove("coach-target");
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [tip]);

  /* 卡片自己多高要量过才知道：先隐身渲染一次，量完再摆上去 */
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el || !rect) return;
    const r = el.getBoundingClientRect();
    setCard((c) => (c && Math.abs(c.h - r.height) < 1 && Math.abs(c.w - r.width) < 1 ? c : { w: r.width, h: r.height }));
  }, [rect, tip]);

  useEffect(() => {
    if (done || !ready || avail.length === 0) return; // 一条都没有时不算"走完"，更不落 done
    if (idx >= avail.length) finish();
  }, [done, ready, idx, avail.length, finish]);

  if (!tip) return null;

  const width = Math.min(320, window.innerWidth - EDGE * 2);
  const pos = rect && card ? place(rect, card) : null;
  const last = idx === avail.length - 1;

  return createPortal(
    <div
      ref={cardRef}
      className="coach-card"
      style={{
        position: "fixed",
        top: pos ? pos.top : EDGE,
        left: pos ? pos.left : EDGE,
        width,
        zIndex: 1400,
        background: "var(--md-sys-color-surface)",
        color: "var(--text-1)",
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow-3)",
        padding: 12,
        display: "grid",
        gap: 8,
        visibility: pos ? "visible" : "hidden",
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
