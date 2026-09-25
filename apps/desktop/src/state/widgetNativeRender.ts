/**
 * 小组件「原生重画」语义的唯一参考实现（纯函数，可直测）。
 *
 * R21（2026-09-21「上课了还显示还有 9 小时」）之前的快照是一句算死的旧话：
 * App 不在前台就不推新快照，原生 30 分钟轮询重画的还是同一句。现在快照带机器时间
 * 字段（WidgetRow.at/until/rel/loc + counts/titleAt），原生每次重画按**当前时钟**重算：
 *
 *   · class 行：没上课 → 「地点 · 还有 X」；正在上课 → 「正在上课 · 地点」加粗；
 *               下课了 → 整行剔除；跨天后的旧课行 → 剔除（防隔天残留）。
 *   · ddl 行：  还有 X；过点即剔除。
 *   · 行数：    按**卡片真实高度**铺满（尺寸由用户在桌面上拖动决定），一行一个事件；
 *               快照给足候选行（WIDGET_MAX_ROWS），放不下的不显示。
 *   · 脚注：    前半段数**卡片上真的显示出来的行**，后半段「还有 N 项」数仍有效但没显示的
 *               条目（可见行数 − 已显示行数 + 快照都没装下的 counts.more）；
 *               两者之和恒等于仍有效的条目总数。全没了时：快照当天且有课 →
 *               「今天的课已上完」，否则「今天没有课与截止」。
 *   · 标题：    按当前日期重写「今天 M月d日」。
 *
 * Kotlin 侧（OnethuWidget.kt 的 fitRows/renderList/footerOf 段）按同一语义实现，
 * 本文件是语义的**锚**：改任何一侧先改这里并跑 tools/widget-native-render-test.mjs，
 * 再同步 Kotlin，谁都不许单方面漂移。行高的测量只在 Kotlin 侧（要量真实文本），
 * 这里以 maxRows 的形式把「能放几行」作为输入接住。
 *
 * 30 分钟兜底自续 tick + 状态翻转点的精准闹钟（WidgetTicker）保证重画真的会发生。
 */
import type { WidgetRow } from "./widgetSnapshot.js";

/** 某一时刻的重画结果：一行或被剔除 */
export interface NativeRowOut {
  visible: boolean;
  text: string;
  sub: string;
  color?: string;
  strong: boolean;
  size?: "sm" | "md" | "lg";
}

export interface NativeCounts {
  classes: number;
  ddls: number;
  more: number;
  hadClass: boolean;
}

export interface NativeRenderInput {
  rows: WidgetRow[];
  counts?: NativeCounts;
  /** 快照归属日（epoch ms）；缺省＝不可知，隔天残留守卫退化为按 at 判 */
  titleAt?: number;
  now: number;
  /** 卡片上能放几行（原生按真实高度算出来的值）；缺省＝不限，把带上的行都算作已显示 */
  maxRows?: number;
}

export interface NativeRenderOut {
  rows: NativeRowOut[];
  footer: string;
  title: string;
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function hm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 「还有 40 分钟」/「还有 3 小时」/「还有 2 天」（与快照构建侧同口径） */
export function leftText(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `还有 ${m} 分钟`;
  if (m < 2880) return `还有 ${Math.round(m / 60)} 小时`;
  return `还有 ${Math.round(m / 1440)} 天`;
}

/** DDL 次行的日期段：同一天「今天」，其余「M/d」 */
function ddlDayLabel(at: number, now: number): string {
  return dayKey(at) === dayKey(now) ? "今天" : `${new Date(at).getMonth() + 1}/${new Date(at).getDate()}`;
}

/**
 * 单行重算：可见性与文案。语义（Kotlin 侧逐条对齐）：
 *  - at ≤ 0：非时间性行，原样可见；
 *  - class：until>0 时 ongoing = at ≤ now < until（加粗，次行「正在上课 · 地点」）；
 *    下课（until ≤ now）剔除；未开始（at > now）→ 次行「地点 · 还有 X」；
 *    **跨天守卫**：at 所在日 ≠ 快照归属日（或当前日，归属日未知时）→ 剔除；
 *  - ddl：at > now 可见（次行「今天/M/d HH:MM · 还有 X」）；at ≤ now 剔除。
 */
export function nativeRow(r: WidgetRow, now: number, titleAt?: number): NativeRowOut {
  const at = typeof r.at === "number" && r.at > 0 ? r.at : 0;
  const until = typeof r.until === "number" && r.until > 0 ? r.until : 0;
  const out: NativeRowOut = {
    visible: true,
    text: String(r.text ?? ""),
    sub: String(r.sub ?? ""),
    color: r.color,
    strong: r.strong === true,
    size: r.size,
  };
  if (at <= 0) return out;   // 非时间性行：插件行 / 实时状态行，永远原样

  if (r.rel === "class") {
    // 隔天残留守卫：已开始的课若不是今天的（快照跨了午夜还没重推），整行剔除
    if (at <= now && dayKey(at) !== dayKey(now)) return { ...out, visible: false };
    if (until > 0 && until <= now) return { ...out, visible: false };   // 已下课
    if (until > 0 && at <= now && now < until) {
      // 正在上课：次行重排 + 抢眼
      return { ...out, visible: true, strong: true, sub: ["正在上课", r.loc ?? ""].filter(Boolean).join(" · ") };
    }
    if (until === 0 && at <= now) return { ...out, visible: false };    // 无结束时间的课，过点当结束
    return { ...out, visible: true, strong: false, sub: [r.loc ?? "", leftText(at - now)].filter(Boolean).join(" · ") };
  }

  // ddl（以及未来可能的其他过点失效型）
  if (at <= now) return { ...out, visible: false };
  const sub = `${ddlDayLabel(at, now)} ${hm(at)} · ${leftText(at - now)}`;
  return { ...out, visible: true, strong: at - now <= 6 * 3600_000, sub };
}

/**
 * 重画入口：行、脚注、标题（Kotlin 的 fitRows/renderList/footerOf 的语义基准）。
 *
 * 行数由卡片真实高度决定，故 `maxRows` 由原生算好传进来（缺省＝不限）；脚注按「显示了几行」
 * 与「还有几项」分别数，两者之和为仍有效的条目总数。
 */
export function nativeRender(input: NativeRenderInput): NativeRenderOut {
  const now = input.now;
  const c = input.counts;
  const all = (input.rows ?? []).map((row) => ({ row, out: nativeRow(row, now, input.titleAt) }));
  const visible = all.filter((x) => x.out.visible);
  const cap = typeof input.maxRows === "number" ? Math.max(1, input.maxRows) : visible.length;
  const shown = visible.slice(0, cap);

  let shownClasses = 0;
  let shownDdls = 0;
  for (const x of shown) {
    if (x.row.rel === "class") shownClasses++;
    else if (x.row.rel === "ddl") shownDdls++;
  }
  let visibleRel = 0;
  for (const x of visible) if (x.row.rel === "class" || x.row.rel === "ddl") visibleRel++;

  const parts: string[] = [];
  if (shownClasses) parts.push(`${shownClasses} 节课`);
  if (shownDdls) parts.push(`${shownDdls} 个截止`);
  let footer: string;
  if (parts.length === 0) {
    footer = c?.hadClass && (!input.titleAt || dayKey(input.titleAt) === dayKey(now))
      ? "今天的课已上完"
      : "今天没有课与截止";
  } else {
    // 还有 N 项 = 仍有效但没显示在卡片上的（可见行 − 已显示行） + 快照都没装下的
    const hidden = visibleRel - (shownClasses + shownDdls) + (c?.more ?? 0);
    footer = `${parts.join(" · ")}${hidden > 0 ? ` · 还有 ${hidden} 项` : ""}`;
  }
  const title = `今天 ${new Date(now).getMonth() + 1}月${new Date(now).getDate()}日`;
  return { rows: shown.map((x) => x.out), footer, title };
}
