/**
 * 宽屏右栏详情槽位（缓存语义）+ 滚轮归一化 —— 纯函数，Node 可直测。
 *
 * 为什么要有槽位：宽屏下滚轮/拖拽换卡会让右栏详情跟着换，若每次换卡都重建组件，
 * 说明/作答/附件全要重拉一遍，滚起来一顿一顿。做法是每个访问过的作业保留一个
 * **挂载槽位**（组件不卸载 = 天然缓存），换回旧卡立即出内容。
 * TTL：再次激活时距上次激活超过 5 分钟就换 nonce 强制重建（=重拉一次），
 * 满足「5 分钟一刷新足够」。提交/撤回在详情组件内部完成并自行失效，不受 TTL 约束。
 */

export interface DetailSlot<H> {
  h: H;
  /** 上次激活时间（ms） */
  at: number;
  /** 变化即强制重建该槽位（TTL 到期时 +1） */
  nonce: number;
}

export const DETAIL_SLOTS_MAX = 8;
export const DETAIL_TTL_MS = 5 * 60 * 1000;

export function activateSlot<H extends { id: string }>(
  list: DetailSlot<H>[],
  h: H,
  now: number,
  max: number = DETAIL_SLOTS_MAX,
  ttl: number = DETAIL_TTL_MS,
): DetailSlot<H>[] {
  if (!list.some((s) => s.h.id === h.id)) return [...list, { h, at: now, nonce: 0 }].slice(-max);
  return list.map((s) =>
    s.h.id === h.id ? { h, at: now, nonce: now - s.at > ttl ? s.nonce + 1 : s.nonce } : s,
  );
}

/** 滚轮 delta 归一化：deltaMode 0=像素、1=行、2=页 */
export function normalizeWheelDelta(deltaY: number, deltaMode: number, step: number): number {
  if (deltaMode === 1) return deltaY * 16;
  if (deltaMode === 2) return deltaY * step;
  return deltaY;
}

/** 累积到阈值才翻一项（触控板细碎 delta 不连翻）；未过阈值返回 dir=0 并保留余量 */
export function takeWheelStep(acc: number, dy: number, threshold = 24): { acc: number; dir: -1 | 0 | 1 } {
  const next = acc + dy;
  if (Math.abs(next) < threshold) return { acc: next, dir: 0 };
  return { acc: 0, dir: next > 0 ? 1 : -1 };
}
