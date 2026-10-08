/**
 * E4 今日页「时段推荐」——规则表引擎 + 开关/用户顺序持久化。
 *
 * 规则表是霖定的（docs/ui-ux-polish-detailed.md §6 E4），**一个字不许改**：
 *
 * 工作日（当天课表有课 = 有课即工作日）：
 *   05:00–11:00  上午有课 → 今日课表 → 最近通知；
 *                上午无课 → 未交作业 → 图书馆预约入口 → 最近通知
 *   11:00–13:00  校园卡余额；随后若下午无课 → 图书馆预约入口
 *   13:00–17:00  下午有课 → 今日课表；无课 → 未交作业 → 图书馆预约入口 → 最近通知
 *   17:00–21:00  校园卡余额；有晚课 → 课表；无晚课 → 未交作业 + 最近通知
 *                （17–18、20–21 并入本段，霖已定）
 *   21:00–05:00  未交作业 + 最近通知；**但「课表优先」动态延长**——当天晚课还没结束
 *                （now < 当天最后一节晚课的结束时间）时课表继续排在前面，直到晚课结束
 *                才让位（霖定：看当天晚课到几点）
 * 休息日（当天课表无课）：未交作业 + 各类预约入口；饭点（11–13、17–20）校园卡余额最前
 *
 * 「优先」是**排序**不是过滤：只重排已落位卡片，集合一个不少（反例 = 隐藏卡片）。
 *
 * 本模块是**纯模块**（不 import 任何 .tsx/.css，只 type-only 引 HomeCardId）：
 * 护栏 `tools/home-timeorder-test.mjs` 用 `--import ./tools/ts-resolve-register.mjs`
 * 直接加载它跑行为断言（时段覆盖 / 休息日 / 晚课延长 / 开关 / 集合不变）。
 */
import type { HomeCardId } from "../lib/homeCards.js";

/* ══════════ 规则表：优先项角色 ══════════ */

/** 规则表里被点名「优先」的卡片角色（同角色多张卡按用户相对顺序） */
export type HomeOrderRole = "class" | "balance" | "homework" | "notices" | "library" | "reserve";

/** 今日课表一节（已折算成当日分钟数，0–1440） */
export interface HomeClassSpan {
  startMin: number;
  endMin: number;
}

export interface HomeTimeInput {
  /** 排序用的「现在」（真机 mock 与单测都从这里注入；页面每分钟重算一次） */
  now: Date;
  /** 当天课表；空数组 = 休息日（口径就是「当天课表无课」） */
  events: readonly HomeClassSpan[];
}

export type HomeSegmentKey = "morning" | "noon" | "afternoon" | "evening" | "night";

export const DAY_MINUTES = 1440;

/**
 * 时段表：连续覆盖 24 小时、无空档。`night` 用 1260–1740 表示（跨零点 +1440，
 * 即 21:00–次日 05:00）。17–18（1020–1080）与 20–21（1200–1260）必须并入相邻段——
 * 表里**不许**在 1080 / 1200 出现切点（护栏第一条就钉这个）。
 */
export const HOME_SEGMENTS: ReadonlyArray<{ key: HomeSegmentKey; from: number; to: number }> = [
  { key: "morning", from: 5 * 60, to: 11 * 60 }, // 05:00–11:00
  { key: "noon", from: 11 * 60, to: 13 * 60 }, // 11:00–13:00
  { key: "afternoon", from: 13 * 60, to: 17 * 60 }, // 13:00–17:00
  { key: "evening", from: 17 * 60, to: 21 * 60 }, // 17:00–21:00（17–18、20–21 并入）
  { key: "night", from: 21 * 60, to: 29 * 60 }, // 21:00–次日 05:00（+1440 表示跨零点）
];

/** 一天中的第几分钟（0–1439） */
export function minuteOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** now 落在时段表的哪一段（05:00 之前算 night 的尾巴）；表连续覆盖，必有且只有一段 */
export function homeSegmentAt(now: Date): HomeSegmentKey {
  const t = minuteOfDay(now);
  if (t < HOME_SEGMENTS[0]!.from) return "night";
  for (const s of HOME_SEGMENTS) {
    if (t >= s.from && t < Math.min(s.to, DAY_MINUTES)) return s.key;
  }
  return "night";
}

/** 一节课按**开始时间**归到上午 / 下午 / 晚课（规则表的「上午有课 / 下午有课 / 有晚课」判据） */
export type ClassPeriod = "morning" | "afternoon" | "evening";

export function classPeriodOf(startMin: number): ClassPeriod {
  if (startMin < 12 * 60) return "morning";
  if (startMin < 17 * 60) return "afternoon";
  return "evening";
}

/** 卡片 → 规则表角色。「图书馆预约入口」单列；其余 reservation 入口归「各类预约入口」 */
const CARD_ROLE: Partial<Record<HomeCardId, HomeOrderRole>> = {
  classes: "class", // 今日课表（今日课程卡）
  "balance-strip": "balance", // 余额速览条
  cardEntry: "balance", // 「校园卡余额」卡（两种卡面都在时同角色，按用户相对顺序）
  homework: "homework", // 未提交作业
  notices: "notices", // 最近通知
  "reserve-lib": "library", // 图书馆预约入口
};

/** 休息日规则里的「各类预约入口」：注册表中全部指向预约页的入口卡 */
export const RESERVE_CARD_IDS: readonly HomeCardId[] = [
  "reserve-lib",
  "reserve-room",
  "reserve-classroom",
  "reserve-sports",
  "reserve-kongjian",
];

export function homeCardRole(id: HomeCardId): HomeOrderRole | null {
  const fixed = CARD_ROLE[id];
  if (fixed) return fixed;
  return RESERVE_CARD_IDS.includes(id) ? "reserve" : null;
}

/** 当天最后一节晚课的结束时间；没有晚课 → null */
export function lastEveningEnd(events: readonly HomeClassSpan[]): number | null {
  let end: number | null = null;
  for (const e of events) {
    if (classPeriodOf(e.startMin) !== "evening") continue;
    if (end === null || e.endMin > end) end = e.endMin;
  }
  return end;
}

/**
 * 规则表 → 优先序**分组**（同组内按用户相对顺序；组与组之间有先后）。
 * 返回空数组 = 本时段没有点名任何优先项（仅休息日理论上不会发生）。
 */
export function homePriorityGroups(input: HomeTimeInput): HomeOrderRole[][] {
  const nowMin = minuteOfDay(input.now);
  const events = input.events ?? [];
  const has = (p: ClassPeriod): boolean => events.some((e) => classPeriodOf(e.startMin) === p);

  /* 休息日：当天课表无课（覆盖「上四休三」这类自定义课表——判定只看课表） */
  if (events.length === 0) {
    const meal = (nowMin >= 11 * 60 && nowMin < 13 * 60) || (nowMin >= 17 * 60 && nowMin < 20 * 60);
    const base: HomeOrderRole[][] = [["homework", "library", "reserve"]];
    return meal ? [["balance"], ...base] : base;
  }

  const seg = homeSegmentAt(input.now);
  const eveningEnd = lastEveningEnd(events);
  /* 晚课延长跨过 21:00 切点：过了零点（nowMin < 300）按 +1440 与当天晚课结束时间比较，
     否则 00:30 会被误判成「晚课还没结束」。 */
  const t = nowMin < 5 * 60 ? nowMin + DAY_MINUTES : nowMin;
  const eveningOngoing = eveningEnd !== null && eveningEnd > t;

  switch (seg) {
    case "morning":
      return has("morning") ? [["class"], ["notices"]] : [["homework"], ["library"], ["notices"]];
    case "noon":
      return has("afternoon") ? [["balance"]] : [["balance"], ["library"]];
    case "afternoon":
      return has("afternoon") ? [["class"]] : [["homework"], ["library"], ["notices"]];
    case "evening":
      /* 17:00–21:00：余额 → 晚课未结束就课表，否则未交作业 + 最近通知 */
      return eveningOngoing ? [["balance"], ["class"]] : [["balance"], ["homework", "notices"]];
    case "night":
      /* 21:00–05:00：课表优先动态延长（含余额），晚课结束后才让位给未交作业 + 最近通知 */
      return eveningOngoing
        ? [["balance"], ["class"], ["homework", "notices"]]
        : [["homework", "notices"]];
  }
}

/**
 * 按规则表重排一组已落位卡片：**只改顺序，不改集合**；未点名的卡片保持用户相对顺序，
 * 排在所有优先项之后（「其余项按原有顺序接着排」）。input 为 null = 推荐关闭 → 原样返回。
 */
export function applyHomeTimeOrder<T extends { id: HomeCardId }>(
  items: readonly T[],
  input: HomeTimeInput | null,
): T[] {
  if (!input) return items.slice();
  const groups = homePriorityGroups(input);
  const rank = new Map<HomeOrderRole, number>();
  groups.forEach((g, i) => {
    for (const r of g) if (!rank.has(r)) rank.set(r, i);
  });
  const rankOf = (id: HomeCardId): number => {
    const role = homeCardRole(id);
    if (!role) return Number.MAX_SAFE_INTEGER;
    const r = rank.get(role);
    return r === undefined ? Number.MAX_SAFE_INTEGER : r;
  };
  return items
    .map((it, i) => ({ it, i, k: rankOf(it.id) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((x) => x.it);
}

/* ══════════ 开关 / 用户顺序持久化 ══════════ */

export const HOME_ORDER_KEY = "onethu.home.timeorder.v1";

/** auto = 「时段推荐」开着；manual = 关（用户手动排过，或自己关掉） */
export type HomeOrderMode = "auto" | "manual";

export interface HomeOrderState {
  mode: HomeOrderMode;
  /** 用户是否手动编辑过（动排序或显隐任一项）——自动关闭后置位，用于「不再打扰」 */
  edited: boolean;
  /** 用户自己排的顺序快照（卡片 id 顺序；推荐改的是展示序，不动这份） */
  order: HomeCardId[];
}

export const DEFAULT_HOME_ORDER: HomeOrderState = { mode: "auto", edited: false, order: [] };

/** 解析持久化 JSON：坏数据 / 非法字段一律退回默认（默认开） */
export function parseHomeOrder(raw: string | null): HomeOrderState {
  try {
    if (!raw) return { ...DEFAULT_HOME_ORDER };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_HOME_ORDER };
    const rec = parsed as Record<string, unknown>;
    const mode: HomeOrderMode = rec.mode === "manual" ? "manual" : "auto";
    const order = Array.isArray(rec.order) ? rec.order.filter((x): x is HomeCardId => typeof x === "string") : [];
    return { mode, edited: rec.edited === true, order };
  } catch {
    return { ...DEFAULT_HOME_ORDER };
  }
}

export function loadHomeOrder(): HomeOrderState {
  try {
    return parseHomeOrder(globalThis.localStorage?.getItem(HOME_ORDER_KEY) ?? null);
  } catch {
    return { ...DEFAULT_HOME_ORDER };
  }
}

export function saveHomeOrder(s: HomeOrderState): void {
  try {
    globalThis.localStorage?.setItem(HOME_ORDER_KEY, JSON.stringify(s));
  } catch {
    /* 存不下不影响本次会话内生效 */
  }
}

/** 当前是否按「时段推荐」排序：开关开着且没被手动编辑过 */
export function isTimeOrderActive(s: HomeOrderState): boolean {
  return s.mode === "auto" && !s.edited;
}

/**
 * 用户动过排序或显隐任一项 → 自动关闭（markHomeManualEdit），不再打扰。
 * 幂等：已经手动排过的用户再编辑一次不会改变结果。
 */
export function markHomeManualEdit(s: HomeOrderState): HomeOrderState {
  return { ...s, mode: "manual", edited: true };
}

/**
 * 用户拨开关。重新打开 = 明确要求按时段排（把 edited 归零，开关不会是死键；
 * 用户顺序仍留在 order/布局里，关掉即恢复）。关闭 = 一直用用户顺序。
 */
export function setHomeTimeOrder(s: HomeOrderState, on: boolean): HomeOrderState {
  return { ...s, mode: on ? "auto" : "manual", edited: on ? false : s.edited };
}

/** 记录用户顺序快照（布局数组顺序；推荐改展示序，不动这一份） */
export function setHomeUserOrder(s: HomeOrderState, order: readonly HomeCardId[]): HomeOrderState {
  return { ...s, order: order.slice() };
}
