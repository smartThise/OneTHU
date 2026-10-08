/**
 * 课表展示时段（用户可选）。
 *
 * 需求（2026-09-20 群反馈 + 用户定案）：24 小时全轴会把 17:00–19:00 这类空档也铺出来，
 * 「进入课表整体下移、不美观」；但直接砍到 8–22 又会丢 6:30 升旗、晚间自定义日程这类
 * 真实早/晚事件。所以不做全局裁剪，改成**用户自己选显示区间**，默认仍是全天（保持现状）。
 *
 * 存储：localStorage，单位「分钟」，`from < to`；跨端共享同一份偏好（桌面/安卓同 key）。
 */
import { useSyncExternalStore } from "react";

export interface ScheduleWindow {
  /** 起始（分钟，0 ~ 1439） */
  from: number;
  /** 结束（分钟，1 ~ 1440） */
  to: number;
}

const KEY = "onethu.schedule.window.v1";
/** 全天（仍是预设与「恢复全天」的目标，但不再是默认） */
export const FULL_DAY: ScheduleWindow = { from: 0, to: 1440 };
/** C9（霖 2026-10-01 走查）：默认窗口改成 06:00–24:00——打开日程即「尽收眼底」，
 *  不用再手动滚到当天时段；18 小时 × 自适应小时高正好铺满一屏。 */
export const DEFAULT_WINDOW: ScheduleWindow = { from: 6 * 60, to: 1440 };

export const WINDOW_PRESETS: ReadonlyArray<{ label: string; win: ScheduleWindow }> = [
  { label: "全天", win: FULL_DAY },
  { label: "06:00 – 24:00", win: { from: 6 * 60, to: 1440 } },
  { label: "08:00 – 22:00", win: { from: 8 * 60, to: 22 * 60 } },
  { label: "08:00 – 20:00", win: { from: 8 * 60, to: 20 * 60 } },
];

function clampWin(w: ScheduleWindow): ScheduleWindow {
  let from = Math.max(0, Math.min(1439, Math.round(w.from)));
  let to = Math.max(1, Math.min(1440, Math.round(w.to)));
  if (to - from < 120) to = Math.min(1440, from + 120); // 至少留 2 小时，防手滑收成一条缝
  return { from, to };
}

function load(): ScheduleWindow {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return DEFAULT_WINDOW;
    const j = JSON.parse(raw) as Partial<ScheduleWindow>;
    if (typeof j.from !== "number" || typeof j.to !== "number") return DEFAULT_WINDOW;
    return clampWin({ from: j.from, to: j.to });
  } catch {
    return DEFAULT_WINDOW;
  }
}

let current: ScheduleWindow = load();
const subs = new Set<() => void>();

export function readScheduleWindow(): ScheduleWindow {
  return current;
}

export function setScheduleWindow(w: ScheduleWindow): void {
  const next = clampWin(w);
  if (next.from === current.from && next.to === current.to) return;
  current = next;
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 存不下不影响本次会话 */
  }
  for (const fn of subs) fn();
}

/** 组件订阅（useSyncExternalStore：读到的永远是同一份快照，不会触发多余重渲） */
export function useScheduleWindow(): [ScheduleWindow, (w: ScheduleWindow) => void] {
  const win = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => current,
    () => current,
  );
  return [win, setScheduleWindow];
}

/** 分钟 → "HH:MM"（1440 显示 24:00） */
export function hhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
