/**
 * 白板画笔层（SVG 覆盖在画布上）。
 *
 * penOn=false：只渲染已有笔迹（pointer-events 全关，不碰组件交互）。
 * penOn=true：层接管指针，按下起笔、移动跟手、松手定稿；取消/滚动仍交给外层
 * （touch-action 只在落笔后置 none，静止按住不拦截页面滚动）。
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  PEN_COLORS,
  addStroke,
  penKeyOf,
  penSnapshot,
  strokesOf,
  subscribePen,
  type PenStroke,
} from "../state/boardPen.js";
import { t as i18n } from "../i18n/index.js";


/** 画笔画布固定高度（与卡片位置/数量完全无关；卡片再往下拖也不会改变它） */
export const BOARD_CANVAS_H = 2400;

export function BoardPenLayer({
  boardId,
  orientation,
  penOn,
  color,
}: {
  boardId: string;
  orientation: string;
  penOn: boolean;
  color: string;
}): ReactNode {
  const snap = useSyncExternalStore(subscribePen, penSnapshot, penSnapshot);
  const key = penKeyOf(boardId, orientation);
  const strokes = strokesOf(key);
  const hostRef = useRef<SVGSVGElement | null>(null);
  const [live, setLive] = useState<number[] | null>(null); // 正在画的那笔
  const liveRef = useRef<number[] | null>(null);
  liveRef.current = live;
  /** 画布宽度：只在挂载与窗口尺寸变化时取样，**不跟内容走**。
      曾经写 100%，卡片拖出右边界会把 .freeboard 撑宽（1120 → 1565），
      画笔层跟着变宽 → 归一化坐标被横向拉伸，画好的线整条错位（2026-10-19 用户实测）。 */
  const [canvasW, setCanvasW] = useState<number | null>(null);
  useEffect(() => {
    const sync = (): void => {
      const board = hostRef.current?.parentElement;
      if (board) setCanvasW(board.clientWidth);
    };
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  useEffect(() => {
    if (!penOn) return;
    const el = hostRef.current;
    if (!el) return;
    let drawing = false;
    const toPoints = (e: PointerEvent): { x: number; y: number } | null => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      return {
        x: Math.min(1000, Math.max(0, ((e.clientX - r.left) / r.width) * 1000)),
        y: Math.min(1000, Math.max(0, ((e.clientY - r.top) / r.height) * 1000)),
      };
    };
    const down = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      const p = toPoints(e);
      if (!p) return;
      e.preventDefault();
      drawing = true;
      el.setPointerCapture(e.pointerId);
      setLive([p.x, p.y]);
    };
    const move = (e: PointerEvent): void => {
      if (!drawing) return;
      const p = toPoints(e);
      if (!p) return;
      const cur = liveRef.current ?? [];
      // 抽稀：与上一斗间距 <0.4% 的点丢弃（跟手且省体积）
      const n = cur.length;
      if (n >= 2) {
        const px = cur[n - 2];
        const py = cur[n - 1];
        if (px !== undefined && py !== undefined) {
          const dx = p.x - px;
          const dy = p.y - py;
          if (dx * dx + dy * dy < 16) return;
        }
      }
      setLive([...cur, p.x, p.y]);
    };
    const up = (): void => {
      if (!drawing) return;
      drawing = false;
      const pts = liveRef.current;
      setLive(null);
      if (pts && pts.length >= 4) {
        addStroke(key, { id: "s" + Date.now().toString(36), color, w: 2.5, pts });
      }
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, [penOn, key, color]);

  const all: PenStroke[] = live ? [...strokes, { id: "__live", color, w: 2.5, pts: live }] : strokes;
  return (
    <svg
      ref={hostRef}
      className={"board-pen" + (penOn ? " is-on" : "")}
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      /* 画布尺寸**固定**，与内容无关（用户点名）：
         曾经用「最下面那张卡的底边」推算高度，结果拖一下卡片画布就变长/变短，
         笔迹的归一化坐标被一起拉伸重映射 —— 画布不是内容的一部分，它是一块固定的地。
         宽度同理：只跟窗口走，卡片拖出边界撑宽 .freeboard 时画布不能跟着变宽。 */
      style={{ width: canvasW ? canvasW + "px" : "100%", height: BOARD_CANVAS_H + "px" }}
      aria-hidden="true"
    >
      {all.map((s) => (
        <polyline
          key={s.id}
          points={s.pts.reduce<string[]>((acc, v, i) => {
            if (i % 2 === 0) acc.push(String(v));
            else acc[acc.length - 1] += "," + v;
            return acc;
          }, []).join(" ")}
          fill="none"
          stroke={s.color}
          strokeWidth={s.w}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ))}
    </svg>
  );
}

/** 画笔小浮条：颜色三选 + 撤销 + 清空（penOn 时挂在画布右上） */
export function BoardPenToolbar({
  color,
  onColor,
  onUndo,
  onClear,
  canUndo,
}: {
  color: string;
  onColor: (c: string) => void;
  onUndo: () => void;
  onClear: () => void;
  canUndo: boolean;
}): ReactNode {
  return (
    <div className="board-pen-toolbar" role="toolbar" aria-label={i18n("auto.components.BoardPenLayer.1")}>
      {PEN_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={"board-pen-swatch" + (c === color ? " is-on" : "")}
          style={{ background: c }}
          aria-pressed={c === color}
          aria-label={"画笔颜色 " + c}
          onClick={() => onColor(c)}
        />
      ))}
      <button type="button" className="board-pen-act" onClick={onUndo} disabled={!canUndo}>
        {i18n("auto.components.BoardPenLayer.2")}</button>
      <button type="button" className="board-pen-act" onClick={onClear}>
        {i18n("auto.components.BoardPenLayer.3")}</button>
    </div>
  );
}
