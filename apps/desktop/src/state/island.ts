/**
 * 灵动岛胶囊智能文本：屏幕底部胶囊的状态一句话。
 *
 * 优先级（参考用户拍板）：
 * ① 30 分钟内即将开始的日程 → 「地点·还有X分钟」
 * ② 提醒窗口内临近 DDL 的未交作业 → 「作业名·还有X分钟/小时/天」（窗口=用户设的
 *    提醒时间；未设提醒的默认 2 小时内才现身，避免常驻刷屏）
 * ③ 「聊点什么吧！」
 *
 * 数据源为模块级快照（getCampusSnapshot/getLearnSnapshot，无网络副作用），
 * 15 秒 tick + 渲染时读取；ChatDock 任何重渲染都会拿到最新快照。
 */
import { useEffect, useState } from "react";
import { parseLearnTime } from "@onethu/core";
import { getCampusSnapshot, getLearnSnapshot } from "./data.js";
import { effectiveRemind, getHwRemindState, type HwRemindState } from "./hwRemind.js";

export const ISLAND_DEFAULT_TEXT = "聊点什么吧！";

function fmtLeft(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `还有${m}分钟`;
  if (m < 2880) return `还有${Math.round(m / 60)}小时`;
  return `还有${Math.round(m / 1440)}天`;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 纯计算（可测）：campus/learn 快照 + 两级提醒状态 → 胶囊文本 */
export function computeIslandText(
  campus: { schedule?: Array<{ date?: string; startTime?: string | null; location?: string | null }> } | null,
  learn: { homework?: Array<{ id?: string; title?: string; deadline?: string; submitted?: boolean }> } | null,
  hwRemind: HwRemindState,
  now: number,
): string {
  const today = ymd(new Date(now));

  /* ① 30 分钟内的日程（未开始；已开始/无地点的不算——地点是文本核心） */
  let best: { text: string; at: number } | null = null;
  for (const e of campus?.schedule ?? []) {
    if (!e.location || !e.startTime || e.date !== today) continue;
    const start = new Date(`${today}T${e.startTime}:00`).getTime();
    if (!Number.isFinite(start) || start <= now || start > now + 30 * 60_000) continue;
    const loc = e.location.length > 10 ? `${e.location.slice(0, 10)}…` : e.location;
    if (!best || start < best.at) best = { text: `${loc}·${fmtLeft(start - now)}`, at: start };
  }
  if (best) return best.text;

  /* ② 提醒窗口内的未交作业 */
  for (const h of learn?.homework ?? []) {
    if (h.submitted) continue;
    const d = parseLearnTime(h.deadline);
    if (!d) continue;
    const dl = d.getTime();
    if (dl <= now) continue;
    const windowMs = effectiveRemind(hwRemind, h.id ?? "") * 60_000;
    if (dl - now > windowMs) continue;
    const t = h.title ?? "作业";
    const title = t.length > 12 ? `${t.slice(0, 12)}…` : t;
    if (!best || dl < best.at) best = { text: `${title}·${fmtLeft(dl - now)}`, at: dl };
  }
  return best?.text ?? ISLAND_DEFAULT_TEXT;
}

export function useIslandText(): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);

  return computeIslandText(getCampusSnapshot(), getLearnSnapshot(), getHwRemindState(), now);
}
