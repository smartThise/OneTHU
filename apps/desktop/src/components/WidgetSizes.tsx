/**
 * 尺寸档位选择（霖 2026-10-11 定稿；同日二次改版为**循环卡片流**）。
 *
 * 用途有两处，**共用同一份实现**：
 *   ① 「添加组件」抽屉的展开态：点/滑到哪一档就加哪一档；
 *   ② 长按菜单「改变大小」：复用同一个抽屉与同一份列表，自动选中当前档位，底部按钮变成「修改大小」。
 *
 * **观感对齐待办页的作业卡片流（霖 2026-10-11 现场）**：前台只有一张放大的卡片，
 * 左右各一张缩小的相邻卡片，列表**循环**（最后一档的下一张回到第一档），底部一列点状指示栏。
 * 位移模型与动效同 `TasksPage` 的滚筒：`pos` 是浮点档位，逐帧补间（easeInOut 吸附 / easeOut 甩动），
 * 拖拽 1:1 跟手，松手按速度投射再吸附；每张卡的缩放与透明度只由「离前台的距离」决定。
 * 与滚筒的差别只有一轴：滚筒是纵向、这里是横向。
 *
 * **为什么不按滚动位置判定选中（同日第一版）**：列表滚到底时最后一档无法居中，点它会被判成倒数第二档；
 * 现在前台卡就是选中卡，判定与视觉同源。
 *
 * 预览口径：按**方形基准单位**（1 单位 = 88px，与 boardCore.TILE_H 同口径）还原组件在该档位下的
 * 占格比例，再整体缩放到卡片里显示。渲染器拿到第二个参数（档位尺寸）即可切换排版。
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { tierLabel, sizeKey, type SizeTier, type WidgetDef, type WidgetSize } from "../state/widgetMeta.js";
import type { WidgetRenderer } from "./WidgetHost.js";
import { t as i18n } from "../i18n/index.js";


/** 一个基准单位在真实白板上的像素高（与 boardCore.TILE_H 一致）。 */
const UNIT = 88;
/** 预览里一个基准单位对应的像素（卡片里的视觉单位）。 */
const BOX_UNIT = 28;
/** 前台两侧各显示几张：一张（前后各一张）。 */
const NEIGHBOURS = 1;
/** 缩放/透明度的衰减：离前台每远一格衰减多少，以及下限（与滚筒同一口径）。 */
const MIN_SCALE = 0.8;
const SCALE_PER_STEP = 0.1;
const MIN_OPACITY = 0.35;
const OPACITY_PER_STEP = 0.32;

/** 档位预览盒的像素尺寸。 */
export function tierBoxSize(t: SizeTier): { w: number; h: number } {
  return { w: t.w * BOX_UNIT, h: t.h * BOX_UNIT };
}

/**
 * 没有真实卡体时的示例骨架：**按组件类型**给对应的样子，而不是放一个假数字。
 *
 * 之前统一塞了个 `128`，结果"大量组件显示 128"（霖 2026-10-11）——示例数据必须像那个组件本身。
 */
export function SampleSkeleton({ def }: { def: WidgetDef }): ReactNode {
  const kind = def.spec.kind;
  if (kind === "divider") {
    return (
      <div className="add-preview-sample is-divider">
        <span className="add-preview-sample-divider" />
      </div>
    );
  }
  if (kind === "text") {
    return (
      <div className="add-preview-sample">
        <span className={def.spec.variant === "title" ? "add-preview-sample-h1" : "add-preview-sample-label"}>
          {def.spec.text || def.title}
        </span>
      </div>
    );
  }
  if (kind === "nav" || kind === "atom-link") {
    return (
      <div className="add-preview-sample">
        <span className="add-preview-sample-entry">
          <span className="add-preview-sample-entry-name">{def.title}</span>
          <span className="add-preview-sample-chevron">›</span>
        </span>
      </div>
    );
  }
  /* 卡片类但没有卡体：给"标题 + 两行条目"的样子 */
  return (
    <div className="add-preview-sample">
      <span className="add-preview-sample-title">{def.title}</span>
      <span className="add-preview-sample-row" />
      <span className="add-preview-sample-row is-short" />
    </div>
  );
}

/**
 * 预览与白板**同源**：card / custom 类套一层 `.wg-card`（与 `WidgetHost` 同一结构），其余原样。
 *
 * 不套这一层时，没有自带卡面的组件（如数字卡的 `.mine-stat-standalone`）在预览里就是"一堆幽灵文字"
 * （霖 2026-10-11 现场）；套上之后预览的卡面、圆角、撑满规则都与白板一致。
 */
export function WidgetPreviewBody({
  def,
  renderer,
  tier,
}: {
  def: WidgetDef;
  renderer?: WidgetRenderer;
  tier: SizeTier;
}): ReactNode {
  const out = renderer ? renderer(undefined, tier) : <SampleSkeleton def={def} />;
  return def.spec.kind === "card" || def.spec.kind === "custom" ? <div className="wg-card">{out}</div> : out;
}

/**
 * 单张档位预览：外层盒子按档位比例（w×h 个基准单位）定尺寸，内层按真实占格渲染后整体缩放。
 * 这保证「预览的长宽比 = 加到白板上的长宽比」，看到哪一档就是哪一档。
 */
export function WidgetSizeBox({
  def,
  tier,
  renderer,
}: {
  def: WidgetDef;
  tier: SizeTier;
  renderer?: WidgetRenderer;
}): ReactNode {
  const box = tierBoxSize(tier);
  const scale = BOX_UNIT / UNIT;
  return (
    <span className="widget-size-box" data-size={sizeKey(tier)} style={{ width: box.w, height: box.h }}>
      <span
        className="widget-size-inner"
        style={{ width: tier.w * UNIT, height: tier.h * UNIT, transform: "scale(" + String(scale) + ")" }}
      >
        <WidgetPreviewBody def={def} renderer={renderer} tier={tier} />
      </span>
    </span>
  );
}

/**
 * 循环卡片流：前台一张放大卡、左右各一张缩小卡、底部点状指示栏。
 *
 * `index` 由父组件持有（它才是「已选档位」的事实源）；本组件的 `pos` 只是动画用的浮点位置。
 * 拖动、点侧卡、点指示点都会回报 `onSelect`；父组件改 `index`（例如打开抽屉时的预选）则动画过去。
 */
export function WidgetSizeList({
  def,
  tiers,
  index,
  renderer,
  onSelect,
}: {
  def: WidgetDef;
  tiers: readonly SizeTier[];
  index: number;
  renderer?: WidgetRenderer;
  onSelect: (index: number) => void;
}): ReactNode {
  const n = Math.max(1, tiers.length);
  const wrap = (k: number): number => ((k % n) + n) % n;
  const [pos, setPos] = useState(index);
  const posRef = useRef(index);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const touch = useRef<{ x0: number; pos0: number; samples: Array<{ t: number; x: number }> } | null>(null);
  const movedRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [step, setStep] = useState(240);

  /** 正在播放位移动画：此期间的「父组件改档位」不许再定一次目标（会把刚做的前进动作倒着演回去）。 */
  const animRef = useRef(false);
  /** 最新一次的档位（动画收尾时自纠用；闭包里的 index 可能过期）。 */
  const indexRef = useRef(index);
  indexRef.current = index;

  const setPosBoth = (p: number): void => {
    posRef.current = p;
    setPos(p);
  };

  /** 逐帧补间：吸附、点侧卡、点指示点都走这里（与滚筒同一套缓动）。 */
  const animatePos = (target: number, dur: number, mode: "inout" | "out" = "inout"): void => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    const from = posRef.current;
    const dist = target - from;
    if (Math.abs(dist) < 0.001) {
      setPosBoth(target);
      rafRef.current = null;
      animRef.current = false;
      return;
    }
    animRef.current = true;
    const t0 = performance.now();
    const ease =
      mode === "out"
        ? (t: number): number => 1 - Math.pow(1 - t, 3)
        : (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const tick = (now: number): void => {
      const t = Math.min(1, (now - t0) / dur);
      setPosBoth(from + dist * ease(t));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      rafRef.current = null;
      animRef.current = false;
      /* 收尾自纠：动画期间父组件若把档位改成了别的（外部预选），这里补一次；
         一致时什么都不做 —— 关键是**不在动画途中改目标**。 */
      if (wrap(Math.round(posRef.current)) !== indexRef.current) gotoIdx(indexRef.current);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  /** 走到某一档：走**最短的那一圈**（循环列表的关键）。 */
  const gotoIdx = (k: number, dur = 320): void => {
    const cur = wrap(Math.round(posRef.current));
    let d = (k - cur) % n;
    if (d > n / 2) d -= n;
    if (d < -n / 2) d += n;
    animatePos(Math.round(posRef.current) + d, dur);
  };

  /* 步距：卡片宽（容器 72%，上限 320）+ 12 间隙。容器尺寸变化时重算。 */
  useLayoutEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const measure = (): void => setStep(Math.round(Math.min(el.clientWidth * 0.72, 320) + 12));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* 换组件（def 变了）：直接落到该组件的推荐档位，不做动画。 */
  const prevDef = useRef(def.id);
  useEffect(() => {
    if (prevDef.current === def.id) return;
    prevDef.current = def.id;
    animatePos(index, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.id]);

  /* 父组件改档位（打开抽屉时的预选）：动画过去。拖动中与**动画中**都不抢。
     动画中抢会出事：n=2 时拖动刚把 pos 从 1 推到 2（前进到另一档），
     此时父组件把 index 改成 0，而 round(pos) 还在 1 —— 旧实现会立刻按"最短路径"回退到 0，
     把刚做的前进动作倒着演回去（霖 2026-10-11 现场：两项列表里左划之后又向左回到第二项）。 */
  useEffect(() => {
    if (touch.current || animRef.current) return;
    if (wrap(Math.round(posRef.current)) === index) return;
    gotoIdx(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, n]);

  useEffect(() => () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); }, []);

  /** 松手：惯性投射 + 吸附。
   *
   * 速度取**最近 120ms 窗口**的平均，而不是最后两帧：手指收势时会回弹一下，
   * 最后两帧的方向常常与整段手势相反，中等力度的一挥就会被判成反向
   * （霖 2026-10-11 现场：中等力度左滑、停在两项之间，却突然向左退了一位）。
   * 另加一道方向约束：投射方向与**整段手势净位移**相反时丢掉投射，只按净位移吸附。 */
  const finishDrag = (endX: number): void => {
    const t = touch.current;
    touch.current = null;
    setDragging(false);
    if (!t) return;
    const now = performance.now();
    const s = t.samples;
    let first = s[0] ?? { t: now, x: endX };
    for (const p of s) {
      if (now - p.t <= 120) { first = p; break; }
    }
    const dt = Math.max(1, now - first.t);
    const vRaw = (endX - first.x) / dt;                       // px/ms，正 = 手指向右
    const v = Math.max(-3, Math.min(3, vRaw));                // 限幅，防一甩十几张
    const net = posRef.current - t.pos0;                      // 整段手势的净位移（档位），>0 = 前进
    let fling = -(v * 150) / step;                            // 档位投射（正 = 前进）
    if (fling !== 0 && net !== 0 && Math.sign(fling) !== Math.sign(net)) fling = 0;
    const target = Math.round(posRef.current + fling);
    const dist = Math.abs(target - posRef.current);
    animatePos(target, Math.min(760, 300 + dist * 70), Math.abs(v) > 0.45 ? "out" : "inout");
    const k = wrap(target);
    if (k !== index) onSelect(k);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    movedRef.current = false;
    touch.current = { x0: e.clientX, pos0: posRef.current, samples: [{ t: performance.now(), x: e.clientX }] };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const t = touch.current;
    if (!t) return;
    const dx = e.clientX - t.x0;
    if (Math.abs(dx) > 6) {
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 有 window 级兜底 */ }
    }
    if (Math.abs(dx) > 8) movedRef.current = true;
    const now = performance.now();
    t.samples.push({ t: now, x: e.clientX });
    while (t.samples.length > 2 && now - t.samples[0]!.t > 120) t.samples.shift();
    setPosBoth(t.pos0 - dx / step);
  };

  /* 渲染窗口按**绝对档位位置** p 取键，而不是按「离前台第几格」。
     按偏移取键时，pos 跨过半格会让每个节点的 p（以及随 p 变的档位与位移）跳一格——
     表现就是"拖到一半整条卡片流反向闪一下"（霖 2026-10-11 现场：从右向左划出现反向）。
     按 p 取键后，同一个 p 的节点在拖动中一直存在，位移 p−pos 连续，只有窗口两端进出节点。 */
  const base = Math.round(pos);
  const R = Math.min(NEIGHBOURS, Math.max(0, n - 1));
  const cards: ReactNode[] = [];
  for (let d = -R; d <= R; d += 1) {
    const p = base + d;
    const k = wrap(p);
    const tier = tiers[k];
    if (!tier) continue;
    const rel = p - pos;
    const ad = Math.abs(rel);
    const front = ad < 0.5;
    const scale = Math.max(MIN_SCALE, 1 - ad * SCALE_PER_STEP);
    const opacity = Math.max(MIN_OPACITY, 1 - ad * OPACITY_PER_STEP);
    cards.push(
      <button
        key={p}
        type="button"
        role="radio"
        aria-checked={front}
        aria-label={tierLabel(tier)}
        className={"widget-size-item" + (front ? " is-active is-front" : "")}
        data-size-option={sizeKey(tier)}
        data-size-index={k}
        data-size-slot={d}
        style={{
          transform: "translate(-50%, -50%) translateX(" + String(rel * step) + "px) scale(" + String(scale) + ")",
          opacity,
          zIndex: 100 - Math.round(ad * 10),
        }}
        onClick={() => {
          if (dragging || movedRef.current) return;
          if (front) return;
          gotoIdx(k);
          onSelect(k);
        }}
      >
        <span className="widget-size-frame">
          <WidgetSizeBox def={def} tier={tier} renderer={renderer} />
        </span>
        <span className="widget-size-meta">
          <span className="widget-size-caption">{tierLabel(tier)}</span>
          <span className="widget-size-check" aria-hidden="true">✓</span>
        </span>
      </button>,
    );
  }
  const cur = tiers[wrap(index)] ?? tiers[0];

  return (
    <div className="widget-size-picker">
      <div className="widget-size-head">
        <span className="widget-size-head-title">{i18n("auto.components.WidgetSizes.1")}</span>
        <span className="widget-size-head-cur" data-size-current={cur ? sizeKey(cur) : ""}>
          {i18n("auto.components.WidgetSizes.2")}{" "}{cur ? tierLabel(cur) : "—"}
        </span>
      </div>
      <div
        className={"widget-size-carousel" + (dragging ? " is-dragging" : "")}
        ref={shellRef}
        role="radiogroup"
        aria-label={i18n("auto.components.WidgetSizes.1")}
        data-size-list="1"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finishDrag(e.clientX)}
        onPointerCancel={(e) => finishDrag(e.clientX)}
      >
        {cards}
      </div>
      <div className="widget-size-dots" data-size-dots="1">
        {tiers.map((t, k) => (
          <button
            key={sizeKey(t)}
            type="button"
            className={"widget-size-dot" + (k === index ? " is-cur" : "")}
            aria-label={"选择 " + tierLabel(t)}
            data-size-dot={k}
            onClick={() => {
              gotoIdx(k);
              onSelect(k);
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** 当前选中档位的尺寸（列表下标越界时回落到第一档）。 */
export function tierAt(tiers: readonly SizeTier[], index: number): WidgetSize {
  const t = tiers[Math.max(0, Math.min(index, tiers.length - 1))];
  return t ? { w: t.w, h: t.h } : { w: 1, h: 1 };
}
