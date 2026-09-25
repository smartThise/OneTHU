/**
 * 桌面小组件快照（纯计算，可测）：把「这块小组件要显示的东西」压成原生能画的数据。
 *
 * 内容**按实例**（appWidgetId）各算一份：桌面上可以同时放「日程与 DDL」「一个原子占满的
 * 详情」「收藏夹图标组」「1×1 快捷方式」，互不影响。推送载荷形如
 * `{ instances: { "<appWidgetId>": {…} }, slots: { "1": {…} }, prune }`。
 *
 * 小组件进程里没有 WebView、没有会话，凭据又是 WebCrypto 加密存在 localStorage 的，
 * 原生拿不到明文——所以**凡是需要网络或解析的判断都必须在 App 前台算完**，原生只负责
 * 把这份快照摆进 RemoteViews。快照结构是与 Kotlin 侧的契约（见 OnethuWidget.kt 顶部
 * 注释），改动需两端同步。
 */
import { parseLearnTime } from "@onethu/core/src/learn/time.js";
import { courseColor, urgencyColor } from "../lib/courseColor.js";
import { encodeWidgetTarget } from "./widgetTarget.js";
import { effectiveRemind, type HwRemindState } from "./hwRemind.js";
import { scheduleStart, type PlanHomework, type PlanScheduleEntry } from "./notifyPlan.js";

/** 与 Kotlin 侧约定的快照结构 */
export interface WidgetRow {
  /** 主行文字（一眼要看到的：时间 + 事） */
  text: string;
  /** 次行文字（地点、倒计时、状态补充）；原生在矮尺寸下会自动省略 */
  sub?: string;
  /** 左侧色条与文字颜色（课程色 / 紧迫度色 / 状态色）；缺省无色条 */
  color?: string;
  /** 主行加粗（正在上课、6 小时内的 DDL、实时状态这类必须抢眼的行） */
  strong?: boolean;
  /** 字号档：lg 给「最该看到的那一行」，sm 给次要信息 */
  size?: "sm" | "md" | "lg";
  /* —— R21 小组件新鲜度（2026-09-21「上课了还显示还有 9 小时」）——
   * 上面 sub 里的倒计时是推送时刻算死的：App 不在前台就不推新快照，原生 30 分钟
   * 轮询重画的还是同一句旧话。下面三个机器字段让**原生渲染时按当前时钟重算**
   * （倒计时文案 / 正在上课 / 过期行剔除），快照本身无需重推。
   * 缺省（0/undefined）＝非时间性行（插件行、实时状态行），原生保持快照原文。 */
  /** 事件开始时刻（epoch ms）：课程上课 / DDL 截止 */
  at?: number;
  /** 事件结束时刻（epoch ms）：课程下课；DDL 无此字段（过点即失效） */
  until?: number;
  /** 行的类型（原生据此重算次行与过期判定） */
  rel?: "class" | "ddl";
  /** 上课地点（class 行专用；原生「正在上课」重排次行用） */
  loc?: string;
}

/** 插件小组件的槽位内容（snapshot 里的形态，槽位号为 map 键） */
export interface WidgetSlotContent {
  title: string;
  rows: WidgetRow[];
  footer: string;
  target: string;
}

/** 槽位输入（结构上对应 plugins/pluginWidgets.ts 的 ResolvedWidgetSlot） */
export interface WidgetSlotInput extends WidgetSlotContent {
  slot: string;
}

export interface WidgetSnapshot {
  title: string;
  updatedAt: number;
  /** 快照归属的那一天（epoch ms）。原生隔天重画时据此换标题、并把前一天的课行清掉 */
  titleAt: number;
  /** 点击小组件要落的页面（App 启动后经 widget_take_target 取走） */
  target: string;
  rows: WidgetRow[];
  footer: string;
  /** 列表形态标记：原生据此选布局（缺省即 list，兼容插件槽位内容） */
  kind?: "list";
  /** 行数的静态账（原生重画时重算可见数，消失的行不再计入） */
  counts?: { classes: number; ddls: number; more: number; hadClass: boolean };
}

/** 图标组形态：若干原子图标并列（收藏夹 = 内嵌的文件夹）。
 *  落点一律是已编码字符串（`encodeWidgetTarget` 的产物），构造器不再拆开重组。 */
export interface WidgetGridSnapshot {
  kind: "grid";
  updatedAt: number;
  title: string;
  /** 点击标题落的页面（通常是那个收藏夹） */
  target: string;
  /** 每个格子：标签 + 图标（data URL PNG）+ 自己的落点 */
  items: Array<{ label: string; icon?: string; target: string }>;
}

/** 快捷方式形态：一个图标 + 一行名称（1×1 起；拖大后图标居中显示） */
export interface WidgetShortcutSnapshot {
  kind: "shortcut";
  updatedAt: number;
  label: string;
  sub?: string;
  icon?: string;
  target: string;
}

export type WidgetInstanceContent = WidgetSnapshot | WidgetGridSnapshot | WidgetShortcutSnapshot;

/** 推送载荷：实例内容 + 插件槽位内容 + 是否允许原生修剪已移除实例的内容 */
export interface WidgetPushPayload {
  instances: Record<string, WidgetInstanceContent>;
  slots: Record<string, WidgetSlotContent>;
  /** 只有在成功读到「桌面上有哪些实例」时才允许修剪——
   *  取实例列表失败时若还修剪，会把所有小组件内容误删。 */
  prune: boolean;
}

/** 快照里最多带几行。
 *
 *  卡片上真正显示几行由**原生按真实高度**决定（用户可以在桌面上任意拖动尺寸），所以快照
 *  必须先把候选行给足，否则卡片拉大后没东西可填——用户实录「能显示的行数远少于实际空间」。
 *  20 行 ≈ 520dp 内容，覆盖手机桌面上能拖出的尺寸；仍放不下的条目由脚注的「还有 N 项」交代。 */
export const WIDGET_MAX_ROWS = 20;

export interface WidgetSnapshotInput {
  schedule?: PlanScheduleEntry[] | null;
  homework?: PlanHomework[] | null;
  remind: HwRemindState;
  now: number;
  /** 最多带几行候选（缺省 WIDGET_MAX_ROWS）。原生再按实际高度截断，故这里只需给足。 */
  maxRows?: number;
  /** 插件声明的小组件条目：插到课程/DDL 之后（宿主小组件里的插件行） */
  extraRows?: WidgetRow[];
}

function ymd(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function hm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function clip(s: string, n: number): string {
  const t = String(s ?? "").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** 「还有 40 分钟」/「还有 3 小时」/「还有 2 天」 */
function left(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `还有 ${m} 分钟`;
  if (m < 2880) return `还有 ${Math.round(m / 60)} 小时`;
  return `还有 ${Math.round(m / 1440)} 天`;
}

/**
 * 生成快照。
 *
 * 排序取「今天最先发生的事」：课程按上课时间，DDL 按截止时间，两者合排后取前 N 行——
 * 用户瞄一眼小组件要看到的是「接下来干什么」，而不是分类清单。
 */
export function buildWidgetSnapshot(input: WidgetSnapshotInput): WidgetSnapshot {
  const now = input.now;
  const today = ymd(now);
  const maxRows = Math.max(1, input.maxRows ?? WIDGET_MAX_ROWS);

  interface Entry {
    at: number;
    row: WidgetRow;
    kind: "class" | "ddl";
  }
  const entries: Entry[] = [];

  /* 今天的课：**只留还没上完的**。
   *
   * 早先这里把「今天已结束的课」也一起排序，于是一行的小组件显示的是今天第一节课——
   * 中午看到的还是早上 8 点那节，用户真正要看的是「正在上的」和「下一节」。
   * 已结束的课不占位，但会记一笔，全部上完时脚注如实说「今天的课已上完」。 */
  let hadClass = false;
  for (const e of input.schedule ?? []) {
    const start = scheduleStart(e);
    if (start == null || String(e.date ?? "") !== today) continue;
    hadClass = true;
    const endText = String(e.endTime ?? "").trim().replace("：", ":");
    const endMs = endText.length >= 4
      ? new Date(`${today}T${endText.length === 4 ? `0${endText}` : endText}:00`).getTime()
      : Number.NaN;
    const isOngoing = Number.isFinite(endMs) && endMs > now && start <= now;
    if (Number.isFinite(endMs) && endMs <= now) continue;   // 已上完：不占位
    const loc = clip(e.location ?? "", 12);
    const leftMs = start - now;
    entries.push({
      at: start,
      kind: "class",
      // 课程用课表里的同一个颜色：用户在课表里认的就是「紫色那门课」
      row: {
        text: `${hm(start)} ${clip(e.courseName ?? "课程", 14)}`,
        sub: isOngoing ? `正在上课${loc ? " · " + loc : ""}` : [loc, leftMs > 60_000 ? left(leftMs) : ""].filter(Boolean).join(" · ") || undefined,
        color: courseColor(String(e.courseName ?? "")),
        strong: isOngoing,
        // 机器字段：原生渲染时按当前时钟重算倒计时/正在上课/过期剔除（R21）
        at: start,
        until: Number.isFinite(endMs) ? endMs : undefined,
        rel: "class",
        loc: loc || undefined,
      },
    });
  }

  /* 未交作业的 DDL：只取今天到未来 7 天内的（更远的放进来只会挤掉眼前的事） */
  const horizon = now + 7 * 86_400_000;
  for (const h of input.homework ?? []) {
    if (h.submitted) continue;
    const d = parseLearnTime(h.deadline);
    if (!d) continue;
    const dl = d.getTime();
    if (dl <= now || dl > horizon) continue;
    const lead = effectiveRemind(input.remind, String(h.id ?? ""));
    const leftDdl = dl - now;
    entries.push({
      at: dl,
      kind: "ddl",
      row: {
        text: `DDL ${clip(h.title ?? "作业", 14)}`,
        sub: `${ymd(dl) === today ? "今天" : `${new Date(dl).getMonth() + 1}/${new Date(dl).getDate()}`} ${hm(dl)} · ${left(leftDdl)}`,
        color: urgencyColor(leftDdl),
        strong: leftDdl <= 6 * 3600_000,   // 6 小时内：加粗，别让它淹在列表里
        // 机器字段：原生重算「还有 X」，过点即失效剔除（R21）
        at: dl,
        rel: "ddl",
      },
    });
  }

  entries.sort((a, b) => a.at - b.at);

  const rows = entries.slice(0, maxRows).map((e, i) => (i === 0 ? { ...e.row, size: "lg" as const } : e.row));
  for (const extra of input.extraRows ?? []) {
    if (rows.length >= maxRows) break;
    rows.push(extra);
  }

  /* 脚注口径：前半段只数**快照真的带上的行**，「还有 N 项」数没带上的条目。
   * 卡片上实际显示几行由原生按高度决定，届时它按同一口径重算（见 widgetNativeRender.ts
   * 的 nativeRender）：显示几行 + 还有几项，两者之和恒等于仍有效的条目总数。 */
  const shownClasses = rows.filter((r) => r.rel === "class").length;
  const shownDdls = rows.filter((r) => r.rel === "ddl").length;
  const classCount = entries.filter((e) => e.kind === "class").length;
  const ddlCount = entries.filter((e) => e.kind === "ddl").length;
  const more = Math.max(0, entries.length - (shownClasses + shownDdls));
  const parts: string[] = [];
  if (shownClasses) parts.push(`${shownClasses} 节课`);
  if (shownDdls) parts.push(`${shownDdls} 个截止`);
  const footer = parts.length === 0
    ? (hadClass ? "今天的课已上完" : "今天没有课与截止")
    : `${parts.join(" · ")}${more > 0 ? ` · 还有 ${more} 项` : ""}`;

  return {
    title: `今天 ${new Date(now).getMonth() + 1}月${new Date(now).getDate()}日`,
    updatedAt: now,
    titleAt: now,
    target: "today",
    rows,
    footer,
    counts: { classes: classCount, ddls: ddlCount, more, hadClass },
  };
}

/** 序列化为推送用的 JSON（原生只认字符串载荷） */
/** 空列表内容（绑定不可用时的兜底：不推空卡，直接回落日程与 DDL） */
export function buildGridSnapshot(input: {
  title: string;
  items: Array<{ label: string; icon?: string; target: string }>;
  target: string;
  params?: Record<string, unknown>;
  now: number;
}): WidgetGridSnapshot {
  return {
    kind: "grid",
    updatedAt: input.now,
    title: String(input.title || "收藏"),
    target: encodeWidgetTarget(input.target || "folder", input.params ?? null),
    items: input.items.slice(0, 8).map((it) => ({ label: String(it.label ?? ""), icon: it.icon, target: it.target })),
  };
}

export function buildShortcutSnapshot(input: {
  label: string;
  sub?: string;
  icon?: string;
  target: string;
  params?: Record<string, unknown>;
  now: number;
}): WidgetShortcutSnapshot {
  return {
    kind: "shortcut",
    updatedAt: input.now,
    label: String(input.label ?? ""),
    sub: input.sub ? String(input.sub) : undefined,
    icon: input.icon,
    target: encodeWidgetTarget(input.target || "today", input.params ?? null),
  };
}

/** 详情形态：就是列表形态（标题 + 若干行 + 脚注），拉得越高行数越多 */
export function buildDetailSnapshot(input: {
  title: string;
  rows: WidgetRow[];
  footer?: string;
  target: string;
  params?: Record<string, unknown>;
  now: number;
  maxRows?: number;
}): WidgetSnapshot {
  return {
    kind: "list",
    title: String(input.title || "详情"),
    updatedAt: input.now,
    titleAt: input.now,
    target: encodeWidgetTarget(input.target || "today", input.params ?? null),
    rows: input.rows.slice(0, Math.max(1, input.maxRows ?? WIDGET_MAX_ROWS)).map((r) => ({
      text: String(r.text ?? ""),
      sub: r.sub ? String(r.sub) : undefined,
      color: r.color,
      strong: r.strong === true ? true : undefined,
      size: r.size,
    })),
    footer: String(input.footer ?? ""),
  };
}

/** 推送载荷序列化：实例 + 槽位 + prune 标记 */
export function serializeWidgetPush(p: WidgetPushPayload): string {
  const instances: Record<string, unknown> = {};
  for (const [id, content] of Object.entries(p.instances ?? {})) {
    if (!content) continue;
    instances[String(id)] = content;
  }
  return JSON.stringify({ instances, slots: p.slots ?? {}, prune: p.prune === true });
}

export function serializeWidgetSnapshot(s: WidgetSnapshot): string {
  return JSON.stringify(s);
}
