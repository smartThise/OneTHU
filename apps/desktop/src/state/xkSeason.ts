/**
 * 选课季判定（§9.2，P 批 C15/E2）：决定「选课」在侧栏是**常驻**还是收进「更多」。
 *
 * 数据源（霖指明「日程与提醒」）：CR 教务的倒计时事项——`packages/core/src/info/types.ts` 的
 * `DeadlineItem` 注释写明「title = 倒计时标题（选课 / 退课 / 推研等学期重要节点），begin/end = 起止时间」，
 * 首页「日程与提醒」卡与 `useTodayDeadlines` 取的就是它。
 * 校历（learn）只有学期边界、没有选课 stage（`state/data.ts` 已注明），所以**不做第二数据源的猜测**：
 * 两处都取不到 → 不常驻（§9.2 明文「取不到即不常驻，不做猜测」）。**不写死日期表。**
 * 判定按当天缓存、每分钟复核、跨天自动失效；`useExpanded()` 为真（桌面侧栏真正可见）时才按需拉一次，
 * 移动端不因为这条判定多发请求。
 */
import { useEffect, useMemo, useState } from "react";
import type { DeadlineItem } from "@onethu/core";
import { cachedDeadlines, ensureDeadlines } from "./data.js";
import { useExpanded } from "./usePlatformLayout.js";

/** 选课/退课阶段关键词（这类节点没有稳定枚举，只能按标题判定） */
const XK_RE = /选课|退课|补退选/;

/** "YYYY-MM-DD HH:mm" → ms；无法解析返回 null */
function ts(v?: string): number | null {
  if (!v) return null;
  const t = Date.parse(v.includes(" ") ? v.replace(" ", "T") : v);
  return Number.isNaN(t) ? null : t;
}

/**
 * 纯函数：now 是否落在某个「选课/退课」阶段窗口内。
 * · 标题不含关键词 → 跳过；· 完全没有时间窗 → 跳过（不做猜测）；
 * · 只有 begin 或只有 end 时，按已知的一端判定；· 取不到数据 → false。
 */
export function isXkSeason(items: DeadlineItem[] | null | undefined, now: Date): boolean {
  if (!items || items.length === 0) return false;
  const t = now.getTime();
  for (const it of items) {
    if (!XK_RE.test(it.title ?? "")) continue;
    const b = ts(it.begin);
    const e = ts(it.end);
    if (b === null && e === null) continue;
    if (b !== null && t < b) continue;
    if (e !== null && t > e) continue;
    return true;
  }
  return false;
}

/** 响应式判定：读缓存 + 每分钟复核；桌面侧栏可见且无缓存时按需拉一次（失败静默，保持「不常驻」）。 */
export function useXkSeason(): boolean {
  const expanded = useExpanded();
  const [items, setItems] = useState<DeadlineItem[] | null>(() => cachedDeadlines());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setItems(cachedDeadlines()); // 每分钟复核（跨天/阶段切换都靠它失效）
      setTick((n) => n + 1);
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!expanded || items !== null) return;
    let alive = true;
    ensureDeadlines()
      .then((l) => {
        if (alive) setItems(l);
      })
      .catch(() => {
        /* 取不到即不常驻（§9.2）：静默保持 false */
      });
    return () => {
      alive = false;
    };
  }, [expanded, items]);

  return useMemo(() => isXkSeason(items, new Date()), [items, tick]);
}
