/**
 * 作业 DDL 提醒时间（两级模型，用户拍板 2026-09-09）：
 * ① 全局默认节点：所有作业共用（网络学堂首页「DDL 提醒」卡设置）；
 * ② 单作业覆盖：作业行/详情铃铛想改再改（10 分钟 ~ 30 天任意）。
 *
 * 存储：localStorage onethu.hwremind.v2 = { default: 分钟, items: { [hwId]: 分钟 } }。
 * 旧 v1（纯 { [hwId]: 分钟 }）自动迁移为 items，default 补 120。
 *
 * 消费方：① 网络学堂首页全局卡 + 作业行铃铛 UI（Learn/shared）
 * ② 系统日历作业事件的 alarmMinutes（systemCal buildHwEvents：items[id] ?? default）
 * ③ 灵动岛胶囊的作业文本窗口（island.ts）。
 * 变更即通知订阅方（日历防抖重推 / React 重渲染）。
 */
import { useEffect, useState } from "react";

const KEY = "onethu.hwremind.v2";
const KEY_V1 = "onethu.hwremind.v1";
/** 常用档位（分钟）；任意自定义走 10~43200（30 天）钳制 */
export const REMIND_PRESETS = [10, 30, 60, 120, 360, 720, 1440, 2880, 4320, 10080];
export const REMIND_MIN = 10;
export const REMIND_MAX = 43200;
export const HW_REMIND_DEFAULT = 120;

/** 两级提醒状态：全局默认 + 单作业覆盖 */
export interface HwRemindState {
  default: number;
  items: Record<string, number>;
}

function clamp(m: number): number {
  return Math.max(REMIND_MIN, Math.min(REMIND_MAX, Math.round(m)));
}

function load(): HwRemindState {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? "null") as HwRemindState | null;
    if (j && typeof j === "object" && typeof j.default === "number") {
      const items: Record<string, number> = {};
      for (const [k, v] of Object.entries(j.items ?? {})) {
        if (typeof v === "number" && Number.isFinite(v)) items[k] = clamp(v);
      }
      return { default: clamp(j.default), items };
    }
    // v1 迁移：旧格式 { [hwId]: 分钟 } → items，default 补默认
    const old = JSON.parse(localStorage.getItem(KEY_V1) ?? "null") as Record<string, number> | null;
    if (old && typeof old === "object") {
      const items: Record<string, number> = {};
      for (const [k, v] of Object.entries(old)) {
        if (typeof v === "number" && Number.isFinite(v)) items[k] = clamp(v);
      }
      return { default: HW_REMIND_DEFAULT, items };
    }
  } catch {
    /* 坏存储 → 全默认 */
  }
  return { default: HW_REMIND_DEFAULT, items: {} };
}

let data: HwRemindState = load();

const listeners = new Set<() => void>();
function emit(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* 存不进就只在内存生效 */
  }
  listeners.forEach((fn) => fn());
}

/** 完整状态（日历同步 / 灵动岛计算用） */
export function getHwRemindState(): HwRemindState {
  return data;
}

/** 全局默认提醒（分钟） */
export function getHwDefault(): number {
  return data.default;
}

export function setHwDefault(minutes: number): void {
  data = { ...data, default: clamp(minutes) };
  emit();
}

/** 仅单作业覆盖表（不含默认；铃铛显示用） */
export function getHwReminders(): Record<string, number> {
  return data.items;
}

export function getHwReminder(id: string): number | null {
  const v = data.items[id];
  return typeof v === "number" ? v : null;
}

export function setHwReminder(id: string, minutes: number | null): void {
  const items = { ...data.items };
  if (minutes == null) delete items[id];
  else items[id] = clamp(minutes);
  data = { ...data, items };
  emit();
}

export function subscribeHwRemind(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** React 绑定：全局默认变化重渲染 */
export function useHwDefault(): number {
  const [v, setV] = useState(() => getHwDefault());
  useEffect(() => subscribeHwRemind(() => setV(getHwDefault())), []);
  return v;
}

/** React 绑定：单作业覆盖（null = 跟随全局默认） */
export function useHwReminder(id: string): number | null {
  const [v, setV] = useState(() => getHwReminder(id));
  useEffect(() => subscribeHwRemind(() => setV(getHwReminder(id))), [id]);
  return v;
}

/** 生效提醒（纯函数可测）：覆盖 ?? 全局默认 */
export function effectiveRemind(s: HwRemindState, id: string): number {
  return s.items[id] ?? s.default;
}

/** "30 分钟" / "2 小时" / "3 天"（给铃铛标签与选项） */
export function fmtRemindOffset(m: number): string {
  if (m < 60) return `${m} 分钟`;
  if (m % 1440 === 0) return `${m / 1440} 天`;
  return `${Math.round(m / 60)} 小时`;
}
