import { t as i18n } from "../i18n/index.js";
/**
 * 首页卡片注册表 + 布局持久化（Today 页全量卡片化的唯一事实来源）。
 *
 * 卡片两类：
 * - bespoke：现有特殊展示组件（日程与提醒 / 未提交作业 / 今日预约 / 今日课程 /
 *   订阅新闻 / 最近通知 / 校园卡余额）。render 由 Today.tsx 注入（数据 hook 仍
 *   集中在 TodayPage 单次取数，卡体是纯展示闭包）；返回 null = 整卡隐藏（原行为）。
 * - entry：点击即入的入口大卡。entry 记录导航目标，info/life/reserve 按子栏参数
 *   契约（LearnNav.infoTab/lifeTab/reserveTab）直达对应分栏。
 *
 * 布局持久化（localStorage，读写全部 try/catch 静默降级）：
 * - onethu.home.layout = Array<{ id, col, collapsed }>：col ∈ main|rail|off，
 *   off = 已被用户隐藏的入口卡（保留记录供「添加卡片」列出，也避免
 *   「不在表中就追加」把用户刻意移除的卡又自动加回来）；数组顺序即列内顺序。
 * - onethu.home.defaults = Record<id, boolean>：各卡折叠偏好，折叠/展开即时写入，
 *   卡片被重新添加或恢复默认时按它回填。
 *
 * 对账规则（resolveLayout）：
 * - layout 表里已不在注册表的 id 丢弃（卡片下线）、重复 id 去重；
 * - 注册表里从未入库的卡（应用升级新增）按 defaultCol/defaultOrder 追加到所在列
 *   末尾；入口卡 defaultHidden=true → 以 off 入库 = 默认隐藏、可手动添加。
 */
import type { ReactNode } from "react";
import type { LearnNav, Page } from "../state/app.js";
import { applyHomeTimeOrder, type HomeTimeInput } from "../state/homeOrder.js";
import {
  IconBell, IconCalendar, IconCard, IconCheck, IconExternal, IconFile, IconFlag,
  IconIn, IconInfo, IconPen, IconRefresh, IconSchedule, IconSearch, IconStar, IconSun, IconToday, IconXk,
} from "../components/Icons.js";

/** 首页卡片 id（注册表唯一键，localStorage 里也用它） */
export type HomeCardId =
  | "services"
  | "clock" | "date" | "weather"
  | "balance-strip"
  | "today-overview"
  | "agenda" | "homework" | "resv" | "classes" | "news" | "notices" | "cardEntry" | "next-class"
  | "xk" | "learn-assignments" | "learn-notices" | "learn-files"
  | "info-news" | "info-report" | "info-exams" | "info-profile"
  | "life-dorm" | "life-washer" | "life-card"
  | "reserve-lib" | "reserve-room"
  | "learn-semester" | "learn-search"
  | "life-hygiene" | "life-invoice" | "life-payroll" | "life-gradincome" | "life-network"
  | "info-fitness" | "info-evaluation" | "info-calendar"
  | "reserve-classroom" | "reserve-sports" | "reserve-kongjian"
  | "for-you";

/** 渲染栏位：main=主栏（宽） rail=侧栏（窄） */
export type HomeCol = "main" | "rail";

/** 持久化栏位：额外有 off = 已被用户隐藏（仅存在于 layout 表里，不渲染） */
export type HomeSlot = HomeCol | "off";

/** 图标最小接口（components/Icons.tsx 的内联线性图标均满足） */
export type HomeCardIcon = (p: { width?: number; height?: number; className?: string }) => ReactNode;

export interface HomeCardDef {
  id: HomeCardId;
  title: string;
  /** bespoke=现有特殊展示组件；entry=点击即入的入口大卡 */
  kind: "bespoke" | "entry";
  icon: HomeCardIcon;
  defaultCol: HomeCol;
  defaultOrder: number;
  /** entry 卡导航目标（info/life/reserve 携带初始子栏参数，契约见 LearnNav） */
  entry?: { page: Page; params?: LearnNav };
  /** entry 大卡第二行说明 */
  hint?: string;
  /** shell 标题行说明（bespoke 卡；动态说明由 Today.tsx 注入时覆盖） */
  aside?: string;
  /** 新卡首次入库即隐藏（所有入口卡 = true） */
  defaultHidden?: boolean;
  /** bespoke 卡体（Today.tsx 注入；返回 null = 整卡隐藏） */
  render?: () => ReactNode;
  /** 卡体即整卡：无标题行/折叠钮（今日概览条），编辑模式才出现工具行 */
  shellFree?: boolean;
}

/** 布局解析所需的最小元数据（HOME_CARD_META 满足） */
export type HomeCardPlan = Pick<HomeCardDef, "id" | "defaultCol" | "defaultOrder" | "defaultHidden">;

/** layout 表元素（onethu.home.layout 的数组元素） */
export interface HomeLayoutItem {
  id: HomeCardId;
  col: HomeSlot;
  collapsed: boolean;
}

/* ══════════ 注册表 ══════════ */

/**
 * 全部卡片元数据。bespoke 卡默认两栏布局 = 用户现状：
 * main=[日程与提醒, 未提交作业, 最近通知]，rail=[校园卡余额, 今日预约, 今日课程, 订阅新闻]；
 * 入口卡（entry）默认全部隐藏，用户可在「添加卡片」弹层自行加回。
 */
export const HOME_CARD_META: HomeCardDef[] = [
  /* —— bespoke：特殊展示卡（render 由 Today.tsx 注入） ——
     默认可见集 = 新 IA（docs/ui-ux-overhaul-plan.md §2.2）：
     问候语是页面级标题（不占卡位），卡面从余额速览条开始：
     余额速览 → 今日课程 → 未提交作业 → 最近通知 → 猜你喜欢（≤5 卡，§0.4）；
     其余（今日概览/日程与提醒/校园卡余额/今日预约/订阅新闻/最近使用）默认隐藏，
     「添加卡片」可找回；老用户已存布局不受影响（resolveLayout 只追加新卡）。 */
  /* C18（霖 2026-10-01 走查）：余额速览降优先级——默认排到「猜你喜欢」之后（后移，不删除；
     已自定义过顺序的用户仍按自己存的顺序走）。 */
  /* —— 环境/时钟三件套（2026-10-13，霖：首页要有时间、日期、天气）——默认可见，
     老布局按「注册表新卡追加」规则自动补进侧栏末尾；卡体复用白板的自足实现（boardCards.tsx）。 */
  { id: "services", get title() { return i18n("lib.homecards.a45eee2e0119"); }, kind: "bespoke", icon: IconStar, defaultCol: "main", defaultOrder: -2, defaultHidden: true },
  { id: "clock", get title() { return i18n("lib.homecards.0f58fd2a2e0f"); }, kind: "bespoke", icon: IconSchedule, defaultCol: "rail", defaultOrder: 3.4 },
  { id: "date", get title() { return i18n("lib.homecards.70d0c1b33626"); }, kind: "bespoke", icon: IconCalendar, defaultCol: "rail", defaultOrder: 3.5 },
  { id: "weather", get title() { return i18n("lib.homecards.4d947325473f"); }, kind: "bespoke", icon: IconSun, defaultCol: "rail", defaultOrder: 3.6 },
  { id: "balance-strip", get title() { return i18n("lib.homecards.a9e8177b10ff"); }, kind: "bespoke", icon: IconCard, defaultCol: "main", defaultOrder: 5.5, shellFree: true, get aside() { return i18n("lib.homecards.0d691812ca83"); } },
  { id: "classes", get title() { return i18n("lib.homecards.119099ab1bad"); }, kind: "bespoke", icon: IconToday, defaultCol: "main", defaultOrder: 1, get aside() { return i18n("lib.homecards.5bdb39b4e305"); } },
  { id: "homework", get title() { return i18n("lib.homecards.23530d9f428a"); }, kind: "bespoke", icon: IconPen, defaultCol: "main", defaultOrder: 2 },
  { id: "notices", get title() { return i18n("lib.homecards.33005938adb3"); }, kind: "bespoke", icon: IconBell, defaultCol: "main", defaultOrder: 3, get aside() { return i18n("lib.homecards.ebfa3e62fea6"); } },
  { id: "for-you", get title() { return i18n("lib.homecards.85a913c6a681"); }, kind: "bespoke", icon: IconStar, defaultCol: "main", defaultOrder: 4, get aside() { return i18n("lib.homecards.aefd9d91e6da"); } },
  /* —— 默认收起的展示卡（「添加卡片」可找回） —— */
  { id: "today-overview", get title() { return i18n("lib.homecards.211d36ccbe1e"); }, kind: "bespoke", icon: IconIn, defaultCol: "main", defaultOrder: 5, defaultHidden: true, shellFree: true, get aside() { return i18n("lib.homecards.14259c8a65a8"); } },
  { id: "agenda", get title() { return i18n("lib.homecards.c730a0bada79"); }, kind: "bespoke", icon: IconCalendar, defaultCol: "main", defaultOrder: 6, defaultHidden: true, get aside() { return i18n("lib.homecards.fcb73401e714"); } },
  // 下一节课（§2.8.2 PC 右栏常驻面板）：唯一默认可见的 rail 卡——它是「现在最该知道的一件事」，
  // 其余 rail 卡仍按需添加。今天已无课时整卡不渲染（不留死卡）。
  { id: "next-class", get title() { return i18n("lib.homecards.d3a28cd3b434"); }, kind: "bespoke", icon: IconToday, defaultCol: "rail", defaultOrder: 6.5, get aside() { return i18n("lib.homecards.5a91ca6f1bdb"); } },
  { id: "cardEntry", get title() { return i18n("lib.homecards.c0c6bb8b8618"); }, kind: "bespoke", icon: IconCard, defaultCol: "rail", defaultOrder: 7, defaultHidden: true, get aside() { return i18n("lib.homecards.d4549b05b429"); } },
  { id: "resv", get title() { return i18n("lib.homecards.9e6a260920fb"); }, kind: "bespoke", icon: IconSchedule, defaultCol: "rail", defaultOrder: 8, defaultHidden: true, get aside() { return i18n("lib.homecards.3d39419f4b36"); } },
  { id: "news", get title() { return i18n("lib.homecards.2e6eca802ef8"); }, kind: "bespoke", icon: IconExternal, defaultCol: "rail", defaultOrder: 9, defaultHidden: true },

  /* —— entry：一键入口卡（默认全部隐藏；除选课二级菜单外所有二级菜单都做入口，
        选课一级菜单本身也是入口，故无 learn 一级入口） —— */
  { id: "xk", get title() { return i18n("lib.homecards.fd17d86dd268"); }, kind: "entry", icon: IconXk, defaultCol: "main", defaultOrder: 10, defaultHidden: true, get hint() { return i18n("lib.homecards.d9087a096dc2"); }, entry: { page: "zhjwxk" } },
  { id: "learn-assignments", get title() { return i18n("lib.homecards.a1cabc0664cf"); }, kind: "entry", icon: IconPen, defaultCol: "main", defaultOrder: 11, defaultHidden: true, get hint() { return i18n("lib.homecards.b3ed0c353c77"); }, entry: { page: "learn-assignments" } },
  { id: "learn-notices", get title() { return i18n("lib.homecards.bdac834d0ba2"); }, kind: "entry", icon: IconBell, defaultCol: "main", defaultOrder: 12, defaultHidden: true, get hint() { return i18n("lib.homecards.14e681cbe318"); }, entry: { page: "learn-notices" } },
  { id: "learn-files", get title() { return i18n("lib.homecards.fa8fe752727c"); }, kind: "entry", icon: IconFile, defaultCol: "main", defaultOrder: 13, defaultHidden: true, get hint() { return i18n("lib.homecards.0e68f2517080"); }, entry: { page: "learn-files" } },
  { id: "info-news", get title() { return i18n("lib.homecards.10d6105303f8"); }, kind: "entry", icon: IconExternal, defaultCol: "main", defaultOrder: 14, defaultHidden: true, get hint() { return i18n("lib.homecards.7ca0b3673bc7"); }, entry: { page: "info", params: { infoTab: "news" } } },
  { id: "info-report", get title() { return i18n("lib.homecards.ede028d7ec64"); }, kind: "entry", icon: IconCheck, defaultCol: "main", defaultOrder: 15, defaultHidden: true, get hint() { return i18n("lib.homecards.95ce4af97b93"); }, entry: { page: "info", params: { infoTab: "report" } } },
  { id: "info-exams", get title() { return i18n("lib.homecards.88df420f8207"); }, kind: "entry", icon: IconFlag, defaultCol: "main", defaultOrder: 16, defaultHidden: true, get hint() { return i18n("lib.homecards.5531576bd063"); }, entry: { page: "info", params: { infoTab: "exams" } } },
  { id: "info-profile", get title() { return i18n("lib.homecards.640803d89773"); }, kind: "entry", icon: IconInfo, defaultCol: "main", defaultOrder: 17, defaultHidden: true, get hint() { return i18n("lib.homecards.961b6374e9a5"); }, entry: { page: "info", params: { infoTab: "profile" } } },
  { id: "life-dorm", get title() { return i18n("lib.homecards.4f375a90d354"); }, kind: "entry", icon: IconIn, defaultCol: "main", defaultOrder: 18, defaultHidden: true, get hint() { return i18n("lib.homecards.1c1ece1ebe90"); }, entry: { page: "life", params: { lifeTab: "elec" } } },
  { id: "life-washer", get title() { return i18n("lib.homecards.6acfa1db6a62"); }, kind: "entry", icon: IconRefresh, defaultCol: "main", defaultOrder: 19, defaultHidden: true, get hint() { return i18n("lib.homecards.390251ce8a9d"); }, entry: { page: "life", params: { lifeTab: "washer" } } },
  { id: "life-card", get title() { return i18n("lib.homecards.caf1f095b108"); }, kind: "entry", icon: IconCard, defaultCol: "main", defaultOrder: 20, defaultHidden: true, get hint() { return i18n("lib.homecards.fe7dbfcadf51"); }, entry: { page: "life", params: { lifeTab: "card" } } },
  { id: "reserve-lib", get title() { return i18n("lib.homecards.31c17158ebdb"); }, kind: "entry", icon: IconSchedule, defaultCol: "main", defaultOrder: 21, defaultHidden: true, get hint() { return i18n("lib.homecards.3b7240a9d253"); }, entry: { page: "reserve", params: { reserveTab: "lib" } } },
  { id: "reserve-room", get title() { return i18n("lib.homecards.e4d40b4d6759"); }, kind: "entry", icon: IconCalendar, defaultCol: "main", defaultOrder: 22, defaultHidden: true, get hint() { return i18n("lib.homecards.411769324590"); }, entry: { page: "reserve", params: { reserveTab: "room" } } },
  { id: "learn-semester", get title() { return i18n("lib.homecards.231ff6cd9b63"); }, kind: "entry", icon: IconRefresh, defaultCol: "main", defaultOrder: 23, defaultHidden: true, get hint() { return i18n("lib.homecards.13a9d4b0c392"); }, entry: { page: "learn-semester" } },
  { id: "learn-search", get title() { return i18n("lib.homecards.62fd8d15cf0a"); }, kind: "entry", icon: IconSearch, defaultCol: "main", defaultOrder: 24, defaultHidden: true, get hint() { return i18n("lib.homecards.1599af41d9c3"); }, entry: { page: "learn-search" } },
  /* —— 新移植功能入口（默认隐藏；成绩详情聚合进「全部成绩」卡，不重复注册） —— */
  { id: "life-invoice", get title() { return i18n("lib.homecards.92341cf02c56"); }, kind: "entry", icon: IconFile, defaultCol: "main", defaultOrder: 25, defaultHidden: true, get hint() { return i18n("lib.homecards.e703d13e3468"); }, entry: { page: "life", params: { lifeTab: "invoice" } } },
  { id: "life-payroll", get title() { return i18n("lib.homecards.24be2018df29"); }, kind: "entry", icon: IconIn, defaultCol: "main", defaultOrder: 26, defaultHidden: true, get hint() { return i18n("lib.homecards.838814f1139e"); }, entry: { page: "life", params: { lifeTab: "payroll" } } },
  { id: "life-gradincome", get title() { return i18n("lib.homecards.336dbe5fd82f"); }, kind: "entry", icon: IconCard, defaultCol: "main", defaultOrder: 27, defaultHidden: true, get hint() { return i18n("lib.homecards.53090df93da8"); }, entry: { page: "life", params: { lifeTab: "gradincome" } } },
  { id: "life-hygiene", get title() { return i18n("lib.homecards.41d497d6e07e"); }, kind: "entry", icon: IconFlag, defaultCol: "main", defaultOrder: 28, defaultHidden: true, get hint() { return i18n("lib.homecards.cf05dea41f42"); }, entry: { page: "life", params: { lifeTab: "hygiene" } } },
  { id: "info-fitness", get title() { return i18n("lib.homecards.316da6d69b7d"); }, kind: "entry", icon: IconCheck, defaultCol: "main", defaultOrder: 29, defaultHidden: true, get hint() { return i18n("lib.homecards.cce40ddbb7b9"); }, entry: { page: "info", params: { infoTab: "fitness" } } },
  { id: "info-evaluation", get title() { return i18n("lib.homecards.14384c9d60cc"); }, kind: "entry", icon: IconPen, defaultCol: "main", defaultOrder: 30, defaultHidden: true, get hint() { return i18n("lib.homecards.02cb99cb0282"); }, entry: { page: "info", params: { infoTab: "evaluation" } } },
  { id: "info-calendar", get title() { return i18n("lib.homecards.4792ab1440aa"); }, kind: "entry", icon: IconCalendar, defaultCol: "main", defaultOrder: 31, defaultHidden: true, get hint() { return i18n("lib.homecards.fc7c1ff5f380"); }, entry: { page: "info", params: { infoTab: "calendar" } } },
  { id: "reserve-classroom", get title() { return i18n("lib.homecards.ecc11c8afea8"); }, kind: "entry", icon: IconSearch, defaultCol: "main", defaultOrder: 32, defaultHidden: true, get hint() { return i18n("lib.homecards.00a42a995295"); }, entry: { page: "reserve", params: { reserveTab: "classroom" } } },
  { id: "life-network", get title() { return i18n("lib.homecards.dd94488f5269"); }, kind: "entry", icon: IconExternal, defaultCol: "main", defaultOrder: 33, defaultHidden: true, get hint() { return i18n("lib.homecards.8e46dccaa4fb"); }, entry: { page: "life", params: { lifeTab: "network" } } },
  { id: "reserve-sports", get title() { return i18n("lib.homecards.07a0fa11958e"); }, kind: "entry", icon: IconSchedule, defaultCol: "main", defaultOrder: 34, defaultHidden: true, get hint() { return i18n("lib.homecards.ee6388006cb5"); }, entry: { page: "reserve", params: { reserveTab: "sports" } } },
  { id: "reserve-kongjian", get title() { return i18n("lib.homecards.e81059e1a712"); }, kind: "entry", icon: IconCalendar, defaultCol: "main", defaultOrder: 35, defaultHidden: true, get hint() { return i18n("lib.homecards.3e668eb1a6ae"); }, entry: { page: "reserve", params: { reserveTab: "kongjian" } } },
];

/** bespoke 卡注入片：render 必给；aside 可覆盖元数据里的静态说明（动态计数等） */
export interface HomeBespokePart {
  render: () => ReactNode;
  aside?: string;
}

/** 组装最终注册表：静态元数据 + Today.tsx 的 bespoke 渲染闭包 */
export function buildHomeRegistry(bespoke: Partial<Record<HomeCardId, HomeBespokePart>>): HomeCardDef[] {
  return HOME_CARD_META.map((meta) => {
    const part = bespoke[meta.id];
    return part ? { ...meta, render: part.render, aside: part.aside ?? meta.aside } : meta;
  });
}

/* ══════════ 时段推荐（E4）══════════ */

/**
 * 今日页「时段推荐」的排序入口：按规则表把**已落位**卡片重排（优先项提前，
 * 其余保持用户相对顺序跟在后面）。
 *
 * 「优先」是排序不是过滤——这里只返回重排后的数组，集合一个不少；隐藏（off）的卡
 * 根本不在入参里，也不会被这里放出来。规则表与判据在 `state/homeOrder.ts`
 * （那一层是纯模块，护栏能直接加载它跑行为断言）；`input = null`（开关关或已手动编辑）
 * 时原样返回用户顺序。
 */
export function sortPlacedByTimeOrder<T extends { id: HomeCardId }>(
  items: readonly T[],
  input: HomeTimeInput | null,
): T[] {
  return applyHomeTimeOrder(items, input);
}

/* ══════════ 布局持久化 ══════════ */

const LAYOUT_KEY = "onethu.home.layout"; // 旧版单布局（迁移源，只读）
const DEFAULTS_KEY = "onethu.home.defaults";

/** 布局朝向：竖屏 / 横屏各存一套（平板可旋转，两套互不干扰） */
export type HomeOrientation = "portrait" | "landscape";

const layoutKey = (o: HomeOrientation): string => `onethu.home.layout.${o}`;

function isHomeSlot(v: unknown): v is HomeSlot {
  return v === "main" || v === "rail" || v === "off";
}

/** 解析布局 JSON：损坏 / 非法元素一律丢弃，返回 null = 无有效数据 */
function parseLayout(raw: string | null): HomeLayoutItem[] | null {
  try {
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const out: HomeLayoutItem[] = [];
    for (const it of parsed) {
      if (typeof it !== "object" || it === null) continue;
      const rec = it as Record<string, unknown>;
      if (typeof rec.id !== "string" || !isHomeSlot(rec.col)) continue;
      out.push({ id: rec.id as HomeCardId, col: rec.col, collapsed: rec.collapsed === true });
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * 读指定朝向的布局表。该朝向从未存过时，从旧版单布局（onethu.home.layout）
 * 迁移一份作为初始值并落盘——此后两套布局各自独立演化。
 */
export function loadLayout(o: HomeOrientation): HomeLayoutItem[] | null {
  try {
    const own = parseLayout(globalThis.localStorage?.getItem(layoutKey(o)));
    if (own) return own;
    const legacy = parseLayout(globalThis.localStorage?.getItem(LAYOUT_KEY));
    if (legacy) {
      saveLayout(legacy, o);
      return legacy;
    }
    return null;
  } catch {
    return null;
  }
}

/** 写指定朝向的布局表（全部 try/catch 静默降级） */
export function saveLayout(items: HomeLayoutItem[], o: HomeOrientation): void {
  try {
    globalThis.localStorage?.setItem(layoutKey(o), JSON.stringify(items));
  } catch {
    /* 忽略 */
  }
}

/** 折叠偏好：跨布局共享（id→是否折叠） */
export function loadCollapsedDefaults(): Partial<Record<HomeCardId, boolean>> {
  try {
    const raw = globalThis.localStorage?.getItem(DEFAULTS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Partial<Record<HomeCardId, boolean>> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "boolean") out[k as HomeCardId] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveCollapsedDefaults(d: Partial<Record<HomeCardId, boolean>>): void {
  try {
    globalThis.localStorage?.setItem(DEFAULTS_KEY, JSON.stringify(d));
  } catch {
    /* 忽略 */
  }
}

/** 恢复默认首页布局：清全部布局钥匙 + 折叠偏好（Settings「恢复默认布局」用），下次进今日页重建 */
export function clearHomeLayout(): void {
  try {
    globalThis.localStorage?.removeItem(LAYOUT_KEY);
    globalThis.localStorage?.removeItem(layoutKey("portrait"));
    globalThis.localStorage?.removeItem(layoutKey("landscape"));
    globalThis.localStorage?.removeItem(DEFAULTS_KEY);
  } catch {
    /* 忽略 */
  }
}

/**
 * 持久化布局 ↔ 注册表对账：
 * - 表中已不在注册表的 id 丢弃（卡片下线），重复 id 去重；
 * - 注册表里从未入库的卡按 defaultCol/defaultOrder 追加到所在列末尾
 *   （defaultHidden 的入口卡以 off 入库 = 默认隐藏，可经「添加卡片」加回）。
 * 只依赖静态元数据：首帧（useState 初始化器）即可确定布局，无需等 render 闭包。
 */
export function resolveLayout(meta: readonly HomeCardPlan[], saved: HomeLayoutItem[] | null): HomeLayoutItem[] {
  const known = new Set(meta.map((d) => d.id));
  const out: HomeLayoutItem[] = [];
  const seen = new Set<string>();
  if (saved) {
    for (const it of saved) {
      if (!known.has(it.id) || seen.has(it.id)) continue;
      seen.add(it.id);
      out.push({ id: it.id, col: it.col, collapsed: it.collapsed });
    }
  }
  for (const d of meta) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    const col: HomeSlot = d.defaultHidden ? "off" : d.defaultCol;
    const item: HomeLayoutItem = { id: d.id, col, collapsed: false };
    if (col === "off") {
      out.push(item);
      continue;
    }
    // 追加到所在列最后一个已入库卡片之后（该列尚无卡片则落到数组最前；
    // 渲染只看列内相对顺序，跨列的数组位置不影响展示）
    // 插入点按 defaultOrder 对齐：新默认卡（如今日概览 order 0）插到该列中
    // 第一张 order 更大的卡之前——老用户存过的布局也能让新卡回到顶部位置
    const orderOf = new Set(meta.filter((x) => x.defaultOrder <= d.defaultOrder).map((x) => x.id));
    const colIdx: number[] = [];
    out.forEach((it, k) => {
      if (it.col === col) colIdx.push(k);
    });
    const last = colIdx[colIdx.length - 1];
    let insertAt = last !== undefined ? last + 1 : 0;
    for (const k of colIdx) {
      const cur = out[k]!;
      if (!orderOf.has(cur.id)) {
        insertAt = k;
        break;
      }
    }
    out.splice(insertAt, 0, item);
  }
  return out;
}
