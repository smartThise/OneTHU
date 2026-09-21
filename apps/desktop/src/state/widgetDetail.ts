/**
 * 「一个原子占满一块小组件」时，除了原子自己的说明还能写什么。
 *
 * 这是小组件「拉长能看到细节」的来源：原生没有业务语义，算不了「这门课下次什么时候上」。
 * 本模块只做**纯计算**（课表、作业都在内存里）；需要联网的下沉原子（教室占用、洗衣机状态）
 * 在 state/widgetLive.ts：那边负责抓取 + 解读，本模块拿不到就少写一行，绝不猜。
 *
 * 纯函数 + 注入依赖，故可直测。
 */
import type { AtomRef } from "./favorites.js";
import type { PlanHomework, PlanScheduleEntry } from "./notifyPlan.js";

export interface DetailRow {
  text: string;
  sub?: string;
  /** 左侧色条与文字颜色（消费红 / 收入绿这类方向色） */
  color?: string;
  /** 主文加粗（余额这类必须抢眼的一行） */
  strong?: boolean;
  /** 字号档：lg 给「最该看到的那一行」 */
  size?: "sm" | "md" | "lg";
}

export interface WidgetDetailDeps {
  schedule: PlanScheduleEntry[];
  homework: PlanHomework[];
  now: number;
  /** 校园卡（由调用方从 SWR 缓存读入；本模块保持纯函数，不自己碰缓存/网络）。
   *  null/undefined = 应用侧还没拉到过 → 如实说「打开应用刷新」，不猜数字。
   *  transactions 是最近流水（新→旧），拉长小组件时原生会按高度多显示几笔。 */
  card?: {
    amount: number;
    at?: number;
    cardId?: string;
    status?: string;
    transactions?: Array<{ name: string; amount: number; at: number }>;
  } | null;
  /** 最多补几行（原生按占位决定；这里给个上界免得白算） */
  maxRows?: number;
}

/** 收入判定：与校园卡页同口径（服务端金额恒为正，按名称分类） */
const INCOME_RE = /充值|圈存|补助/;

/** "MM-DD HH:mm"（流水行用；年份在同一条流水列表里没有信息量） */
function mdhm(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function hm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function dayLabel(ms: number, now: number): string {
  const a = new Date(ms);
  const b = new Date(now);
  const sameDay = a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const tomorrow = new Date(now + 86_400_000);
  const isTomorrow = a.getFullYear() === tomorrow.getFullYear() && a.getMonth() === tomorrow.getMonth() && a.getDate() === tomorrow.getDate();
  const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][a.getDay()];
  if (sameDay) return "今天";
  if (isTomorrow) return "明天";
  return `${a.getMonth() + 1}/${a.getDate()} ${week}`;
}

/** 「还有 40 分钟」/「还有 3 小时」/「还有 2 天」 */
function left(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `还有 ${m} 分钟`;
  if (m < 2880) return `还有 ${Math.round(m / 60)} 小时`;
  return `还有 ${Math.round(m / 1440)} 天`;
}

function clip(s: unknown, n: number): string {
  const t = String(s ?? "").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** 课程原子的 key：id~name~teacher~sem */
function courseNameOf(key: string): string {
  return key.split("~")[1] ?? "";
}

/**
 * 补详情行。返回 null 表示「这个原子没有额外可算的」——调用方只用原子自己的说明，
 * 而不是硬凑一行废话。
 */
export function atomDetail(
  ref: AtomRef,
  meta: { title: string; sub?: string },
  deps: WidgetDetailDeps,
): { rows: DetailRow[]; footer?: string } | null {
  const max = Math.max(1, deps.maxRows ?? 4);

  /* 校园卡余额（「校园卡余额」原子 = widget/cardEntry）：余额来自应用侧缓存 ——
   * 小组件进程没有网络，只有应用算快照时把数字递进来。2026-09-21 用户实录：
   * 这个原子的桌面组件此前只显示标题，不显示余额。 */
  if (ref.kind === "widget" && ref.key === "cardEntry") {
    const c = deps.card;
    if (!c || !Number.isFinite(c.amount)) return { rows: [], footer: "打开应用刷新余额" };
    // 首行 = 余额：大号加粗，一眼要看到（此前只有一行小字，用户实录「太平铺」）
    const meta = [c.cardId ? `卡号 ${c.cardId}` : "校园卡", c.status ? c.status : null, c.at ? `更新 ${hm(c.at)}` : null]
      .filter(Boolean)
      .join(" · ");
    const rows: DetailRow[] = [{ text: `¥${c.amount.toFixed(2)}`, sub: meta, strong: true, size: "lg" }];
    // 之后 = 最近流水（按可用行数显示：3×2 放一两笔，拉长能看更多；原生 listFit 按高度裁）
    const tx = (c.transactions ?? []).slice(0, Math.max(0, max - 1));
    for (const t of tx) {
      const income = INCOME_RE.test(t.name);
      rows.push({
        text: clip(t.name || "交易", 14),
        sub: `${mdhm(t.at)} · ${income ? "+" : "−"}¥${Math.abs(t.amount).toFixed(2)}`,
        color: income ? "#2e9e5b" : "#e5484d",
      });
    }
    return {
      rows,
      footer: tx.length > 0 ? `最近 ${tx.length} 笔` : "点一下进校园卡",
    };
  }

  /* 课程：这门课接下来什么时候上、在哪 */
  if (ref.kind === "course") {
    const name = courseNameOf(ref.key);
    const upcoming = deps.schedule
      .filter((e) => String(e.courseName ?? "") === name && (e.date ?? "") >= ymdOf(deps.now))
      .sort((a, b) => `${a.date ?? ""}${a.startTime ?? ""}`.localeCompare(`${b.date ?? ""}${b.startTime ?? ""}`));
    if (upcoming.length === 0) return { rows: [], footer: "近期没有安排" };
    const rows: DetailRow[] = [];
    for (const e of upcoming.slice(0, Math.min(3, max))) {
      const at = new Date(`${e.date}T${String(e.startTime ?? "00:00").replace("：", ":")}:00`).getTime();
      rows.push({
        text: `${dayLabel(at, deps.now)} ${String(e.startTime ?? "")} ${clip(e.location ?? "待定", 12)}`,
        sub: Number.isFinite(at) && at > deps.now ? left(at - deps.now) : undefined,
      });
    }
    return { rows, footer: `${upcoming.length} 次待上` };
  }

  /* 作业：截止与提交状态 */
  if (ref.kind === "assignment") {
    const itemId = ref.key.split("~")[1] ?? "";
    const hw = deps.homework.find((h) => String(h.id ?? "") === itemId);
    if (!hw) return { rows: [], footer: "已提交或已过期" };
    const d = new Date(String(hw.deadline ?? "").replace(" ", "T"));
    const at = Number.isFinite(d.getTime()) ? d.getTime() : 0;
    return {
      rows: at > 0 ? [{ text: `截止 ${dayLabel(at, deps.now)} ${hm(at)}`, sub: at > deps.now ? left(at - deps.now) : undefined }] : [],
      footer: hw.submitted ? "已提交" : "未提交",
    };
  }

  return null;   // 其余原子：原子自己的说明已经够了，不硬凑
}

function ymdOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
