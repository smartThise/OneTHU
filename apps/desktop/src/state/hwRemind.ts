/**
 * 作业 DDL 提醒时间（用户自定义：10 分钟 ~ 30 天任意）。
 *
 * 存储：localStorage onethu.hwremind.v1 = { [hwId]: 分钟数 }。
 * 消费方：① 作业行铃铛 UI（shared.tsx HomeworkRow）② 系统日历作业事件的
 * alarmMinutes（systemCal buildPayload）③ 灵动岛胶囊的作业文本窗口（island.ts）。
 * 变更即通知订阅方（日历防抖重推 / React 重渲染）。
 */
import { useEffect, useState } from "react";

const KEY = "onethu.hwremind.v1";
/** 常用档位（分钟）；任意自定义走 10~43200（30 天）钳制 */
export const REMIND_PRESETS = [10, 30, 60, 120, 360, 720, 1440, 2880, 4320, 10080];
export const REMIND_MIN = 10;
export const REMIND_MAX = 43200;

type Reminders = Record<string, number>;

let data: Reminders = (() => {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Reminders;
    const out: Reminders = {};
    for (const [k, v] of Object.entries(j)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.max(REMIND_MIN, Math.min(REMIND_MAX, Math.round(v)));
    }
    return out;
  } catch {
    return {};
  }
})();

const listeners = new Set<() => void>();
function emit(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* 存不进就只在内存生效 */
  }
  listeners.forEach((fn) => fn());
}

export function getHwReminders(): Reminders {
  return data;
}

export function getHwReminder(id: string): number | null {
  const v = data[id];
  return typeof v === "number" ? v : null;
}

export function setHwReminder(id: string, minutes: number | null): void {
  if (minutes == null) delete data[id];
  else data[id] = Math.max(REMIND_MIN, Math.min(REMIND_MAX, Math.round(minutes)));
  emit();
}

export function subscribeHwRemind(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** React 绑定：提醒变化重渲染 */
export function useHwReminder(id: string): number | null {
  const [v, setV] = useState(() => getHwReminder(id));
  useEffect(() => subscribeHwRemind(() => setV(getHwReminder(id))), [id]);
  return v;
}

/** "30 分钟" / "2 小时" / "3 天"（给铃铛标签与选项） */
export function fmtRemindOffset(m: number): string {
  if (m < 60) return `${m} 分钟`;
  if (m % 1440 === 0) return `${m / 1440} 天`;
  return `${Math.round(m / 60)} 小时`;
}
