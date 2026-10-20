/**
 * 磁贴吸附（自由画布 px 世界坐标，纯函数）。
 *
 * 口径：
 *   · 只认**边线共线**——左对左 / 右对右（对齐），以及右对左 / 左对右（贴合）都算同一条直线；
 *   · 阈值按世界像素给，UI 传 `SNAP_DIST / 缩放倍率`，所以手感与画布缩放无关；
 *   · 移动改 x/y；缩放只改**正在拖的那条边**，对侧边保持不动（与四角把手的手感一致）。
 *
 * 返回里带 guides（吸附后真正共线的那几条边），UI 据此画对齐参考线。
 * 不落库、不改入参——落库仍是 boardCore 的 movePx / resizePx。
 */
import type { BoardRect } from "./boardCore.js";

/** 默认吸附半径（世界 px）。 */
export const SNAP_DIST = 8;

/** 判定「共线」的容差（世界 px）：落库取整后边线是整数，这里只吸收浮点误差。 */
const EPS = 0.5;

export interface SnapGuide {
  axis: "x" | "y";
  /** 共线所在的坐标（x 轴向导线的世界 x；y 轴向导线的世界 y）。 */
  pos: number;
  /** 参考线在另一轴上的起点 / 终点（把两个磁贴都盖住）。 */
  from: number;
  to: number;
}

export interface SnapResult {
  rect: BoardRect;
  guides: SnapGuide[];
}

export type SnapHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

function edgesX(r: BoardRect): [number, number] {
  return [r.x, r.x + r.w];
}

function edgesY(r: BoardRect): [number, number] {
  return [r.y, r.y + r.h];
}

/** 在候选边线里挑「位移最小且不超阈值」的那条。 */
function nearest(edges: readonly number[], targets: readonly number[], limit: number): { delta: number; pos: number } | null {
  let best: { delta: number; pos: number } | null = null;
  for (const edge of edges) {
    for (const target of targets) {
      const delta = target - edge;
      if (Math.abs(delta) > limit) continue;
      if (!best || Math.abs(delta) < Math.abs(best.delta) - 1e-9) best = { delta, pos: target };
    }
  }
  return best;
}

/** 找出与 rect 的两条边**已经**共线的其它条目，产出覆盖双方的参考线（同一条线只留一条）。 */
function guideLines(rect: BoardRect, others: readonly BoardRect[], axis: "x" | "y"): SnapGuide[] {
  const own = axis === "x" ? edgesX(rect) : edgesY(rect);
  const out: SnapGuide[] = [];
  const seen = new Set<string>();
  for (const other of others) {
    const theirs = axis === "x" ? edgesX(other) : edgesY(other);
    for (const mine of own) {
      for (const line of theirs) {
        if (Math.abs(mine - line) > EPS) continue;
        const from = axis === "x" ? Math.min(rect.y, other.y) : Math.min(rect.x, other.x);
        const to = axis === "x"
          ? Math.max(rect.y + rect.h, other.y + other.h)
          : Math.max(rect.x + rect.w, other.x + other.w);
        const key = axis + ":" + line.toFixed(2) + ":" + from.toFixed(2) + ":" + to.toFixed(2);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ axis, pos: line, from, to });
      }
    }
  }
  return out;
}

function collect(others: readonly BoardRect[]): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const o of others) {
    xs.push(o.x, o.x + o.w);
    ys.push(o.y, o.y + o.h);
  }
  return { xs, ys };
}

/**
 * 移动吸附：左右边吸左右边、上下边吸上下边（含「贴着放」的跨边情形）。
 * x 与 y 各自独立取最近的一条，互不牵连。
 */
export function snapMove(rect: BoardRect, others: readonly BoardRect[], limit: number = SNAP_DIST): SnapResult {
  const { xs, ys } = collect(others);
  const dx = nearest(edgesX(rect), xs, limit);
  const dy = nearest(edgesY(rect), ys, limit);
  /* 吸附不能把磁贴推出画布（x/y < 0 会被 withRect 夹回去，那样"吸上了"和"落库后"
     就是两个位置）。宁可这一轴不吸，也不做一次会被撤销的对齐。 */
  const x = dx && rect.x + dx.delta >= 0 ? rect.x + dx.delta : rect.x;
  const y = dy && rect.y + dy.delta >= 0 ? rect.y + dy.delta : rect.y;
  const next: BoardRect = {
    x,
    y,
    w: rect.w,
    h: rect.h,
  };
  return { rect: next, guides: [...guideLines(next, others, "x"), ...guideLines(next, others, "y")] };
}

/**
 * 缩放吸附：只吸**正在拖的边**。
 *   东 → 右边；西 → 左边（右边不动）；南 → 下边；北 → 上边（下边不动）。
 * 角把手同时带两条边，各自独立判断。
 */
export function snapResize(
  rect: BoardRect,
  others: readonly BoardRect[],
  handle: SnapHandle,
  opts: { limit?: number; minW?: number; minH?: number } = {},
): SnapResult {
  const limit = opts.limit ?? SNAP_DIST;
  const minW = opts.minW ?? 0;
  const minH = opts.minH ?? 0;
  const { xs, ys } = collect(others);

  let { x, y, w, h } = rect;
  if (handle.includes("e")) {
    const hit = nearest([rect.x + rect.w], xs, limit);
    if (hit) w = Math.max(minW, hit.pos - x);
  }
  if (handle.includes("w")) {
    const right = rect.x + rect.w;
    const hit = nearest([rect.x], xs, limit);
    if (hit) {
      x = Math.max(0, hit.pos);
      w = Math.max(minW, right - x);
    }
  }
  if (handle.includes("s")) {
    const hit = nearest([rect.y + rect.h], ys, limit);
    if (hit) h = Math.max(minH, hit.pos - y);
  }
  if (handle.includes("n")) {
    const bottom = rect.y + rect.h;
    const hit = nearest([rect.y], ys, limit);
    if (hit) {
      y = Math.max(0, hit.pos);
      h = Math.max(minH, bottom - y);
    }
  }
  const next: BoardRect = { x, y, w, h };
  return { rect: next, guides: [...guideLines(next, others, "x"), ...guideLines(next, others, "y")] };
}
