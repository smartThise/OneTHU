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
import {
  IconBell, IconCalendar, IconCard, IconCheck, IconExternal, IconFile, IconFlag,
  IconIn, IconInfo, IconPen, IconRefresh, IconSchedule, IconSearch, IconToday, IconXk,
} from "../components/Icons.js";

/** 首页卡片 id（注册表唯一键，localStorage 里也用它） */
export type HomeCardId =
  | "today-overview"
  | "agenda" | "homework" | "resv" | "classes" | "news" | "notices" | "cardEntry"
  | "xk" | "learn-assignments" | "learn-notices" | "learn-files"
  | "info-news" | "info-report" | "info-exams" | "info-profile"
  | "life-dorm" | "life-washer" | "life-card"
  | "reserve-lib" | "reserve-room"
  | "learn-semester" | "learn-search"
  | "life-hygiene" | "life-invoice" | "life-payroll" | "life-gradincome" | "life-network"
  | "info-fitness" | "info-evaluation" | "info-calendar"
  | "reserve-classroom" | "reserve-sports" | "reserve-kongjian";

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
  /* —— bespoke：特殊展示卡（render 由 Today.tsx 注入） —— */
  { id: "today-overview", title: "今日概览", kind: "bespoke", icon: IconIn, defaultCol: "main", defaultOrder: 0, shellFree: true, aside: "未交作业 · 截止 · 今日课程" },
  { id: "agenda", title: "日程与提醒", kind: "bespoke", icon: IconCalendar, defaultCol: "main", defaultOrder: 1, aside: "校历 · 学校重要事项" },
  { id: "homework", title: "未提交作业", kind: "bespoke", icon: IconPen, defaultCol: "main", defaultOrder: 2 },
  { id: "notices", title: "最近通知", kind: "bespoke", icon: IconBell, defaultCol: "main", defaultOrder: 3, aside: "点击查看详情" },
  { id: "cardEntry", title: "校园卡余额", kind: "bespoke", icon: IconCard, defaultCol: "rail", defaultOrder: 1, aside: "点击进入生活页" },
  { id: "resv", title: "今日预约", kind: "bespoke", icon: IconSchedule, defaultCol: "rail", defaultOrder: 2, aside: "座位 · 研讨间 · 点击管理" },
  { id: "classes", title: "今日课程", kind: "bespoke", icon: IconToday, defaultCol: "rail", defaultOrder: 3, aside: "点击打开课表" },
  { id: "news", title: "订阅新闻", kind: "bespoke", icon: IconExternal, defaultCol: "rail", defaultOrder: 4 },

  /* —— entry：一键入口卡（默认全部隐藏；除选课二级菜单外所有二级菜单都做入口，
        选课一级菜单本身也是入口，故无 learn 一级入口） —— */
  { id: "xk", title: "选课", kind: "entry", icon: IconXk, defaultCol: "main", defaultOrder: 10, defaultHidden: true, hint: "选课系统 · 已选课程与候补队列", entry: { page: "zhjwxk" } },
  { id: "learn-assignments", title: "全部作业", kind: "entry", icon: IconPen, defaultCol: "main", defaultOrder: 11, defaultHidden: true, hint: "网络学堂 · 作业列表", entry: { page: "learn-assignments" } },
  { id: "learn-notices", title: "全部通知", kind: "entry", icon: IconBell, defaultCol: "main", defaultOrder: 12, defaultHidden: true, hint: "网络学堂 · 课程通知", entry: { page: "learn-notices" } },
  { id: "learn-files", title: "全部课程文件", kind: "entry", icon: IconFile, defaultCol: "main", defaultOrder: 13, defaultHidden: true, hint: "网络学堂 · 课件与资料", entry: { page: "learn-files" } },
  { id: "info-news", title: "订阅新闻", kind: "entry", icon: IconExternal, defaultCol: "main", defaultOrder: 14, defaultHidden: true, hint: "信息门户 · 订阅动态", entry: { page: "info", params: { infoTab: "news" } } },
  { id: "info-report", title: "全部成绩", kind: "entry", icon: IconCheck, defaultCol: "main", defaultOrder: 15, defaultHidden: true, hint: "信息门户 · 历年成绩", entry: { page: "info", params: { infoTab: "report" } } },
  { id: "info-exams", title: "考试安排", kind: "entry", icon: IconFlag, defaultCol: "main", defaultOrder: 16, defaultHidden: true, hint: "信息门户 · 考试日程", entry: { page: "info", params: { infoTab: "exams" } } },
  { id: "info-profile", title: "个人信息", kind: "entry", icon: IconInfo, defaultCol: "main", defaultOrder: 17, defaultHidden: true, hint: "信息门户 · 学籍信息", entry: { page: "info", params: { infoTab: "profile" } } },
  { id: "life-dorm", title: "宿舍 / 电费 / 订水", kind: "entry", icon: IconIn, defaultCol: "main", defaultOrder: 18, defaultHidden: true, hint: "生活页 · 宿舍服务", entry: { page: "life", params: { lifeTab: "dorm" } } },
  { id: "life-washer", title: "洗衣机", kind: "entry", icon: IconRefresh, defaultCol: "main", defaultOrder: 19, defaultHidden: true, hint: "生活页 · 设备状态", entry: { page: "life", params: { lifeTab: "washer" } } },
  { id: "life-card", title: "校园卡", kind: "entry", icon: IconCard, defaultCol: "main", defaultOrder: 20, defaultHidden: true, hint: "生活页 · 余额与流水", entry: { page: "life", params: { lifeTab: "card" } } },
  { id: "reserve-lib", title: "图书馆座位", kind: "entry", icon: IconSchedule, defaultCol: "main", defaultOrder: 21, defaultHidden: true, hint: "预约 · 座位与签到", entry: { page: "reserve", params: { reserveTab: "lib" } } },
  { id: "reserve-room", title: "研讨间", kind: "entry", icon: IconCalendar, defaultCol: "main", defaultOrder: 22, defaultHidden: true, hint: "预约 · 研讨间申请", entry: { page: "reserve", params: { reserveTab: "room" } } },
  { id: "learn-semester", title: "学期切换", kind: "entry", icon: IconRefresh, defaultCol: "main", defaultOrder: 23, defaultHidden: true, hint: "网络学堂 · 切换数据学期", entry: { page: "learn-semester" } },
  { id: "learn-search", title: "网络学堂搜索", kind: "entry", icon: IconSearch, defaultCol: "main", defaultOrder: 24, defaultHidden: true, hint: "课程 / 作业 / 通知 / 文件", entry: { page: "learn-search" } },
  /* —— 新移植功能入口（默认隐藏；成绩详情聚合进「全部成绩」卡，不重复注册） —— */
  { id: "life-invoice", title: "电子发票", kind: "entry", icon: IconFile, defaultCol: "main", defaultOrder: 25, defaultHidden: true, hint: "生活页 · 财务 · 发票列表", entry: { page: "life", params: { lifeTab: "invoice" } } },
  { id: "life-payroll", title: "银行代发", kind: "entry", icon: IconIn, defaultCol: "main", defaultOrder: 26, defaultHidden: true, hint: "生活页 · 财务 · 工资到账", entry: { page: "life", params: { lifeTab: "payroll" } } },
  { id: "life-gradincome", title: "研究生收入", kind: "entry", icon: IconCard, defaultCol: "main", defaultOrder: 27, defaultHidden: true, hint: "生活页 · 财务 · 助研津贴", entry: { page: "life", params: { lifeTab: "gradincome" } } },
  { id: "life-hygiene", title: "卫生成绩", kind: "entry", icon: IconFlag, defaultCol: "main", defaultOrder: 28, defaultHidden: true, hint: "生活页 · 宿舍卫生检查", entry: { page: "life", params: { lifeTab: "hygiene" } } },
  { id: "info-fitness", title: "体测成绩", kind: "entry", icon: IconCheck, defaultCol: "main", defaultOrder: 29, defaultHidden: true, hint: "信息页 · 体质测试", entry: { page: "info", params: { infoTab: "fitness" } } },
  { id: "info-evaluation", title: "教学评估", kind: "entry", icon: IconPen, defaultCol: "main", defaultOrder: 30, defaultHidden: true, hint: "信息页 · 问卷进度", entry: { page: "info", params: { infoTab: "evaluation" } } },
  { id: "info-calendar", title: "校历", kind: "entry", icon: IconCalendar, defaultCol: "main", defaultOrder: 31, defaultHidden: true, hint: "信息页 · 学期安排图片", entry: { page: "info", params: { infoTab: "calendar" } } },
  { id: "reserve-classroom", title: "空教室", kind: "entry", icon: IconSearch, defaultCol: "main", defaultOrder: 32, defaultHidden: true, hint: "预约页 · 自习空闲查询", entry: { page: "reserve", params: { reserveTab: "classroom" } } },
  { id: "life-network", title: "校园网", kind: "entry", icon: IconExternal, defaultCol: "main", defaultOrder: 33, defaultHidden: true, hint: "生活页 · 账号与流量", entry: { page: "life", params: { lifeTab: "network" } } },
  { id: "reserve-sports", title: "体育预约", kind: "entry", icon: IconSchedule, defaultCol: "main", defaultOrder: 34, defaultHidden: true, hint: "预约页 · 体育场馆时段预约", entry: { page: "reserve", params: { reserveTab: "sports" } } },
  { id: "reserve-kongjian", title: "公共空间", kind: "entry", icon: IconCalendar, defaultCol: "main", defaultOrder: 35, defaultHidden: true, hint: "预约页 · 宿舍公共空间预约", entry: { page: "reserve", params: { reserveTab: "kongjian" } } },
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

/* ══════════ 布局持久化 ══════════ */

const LAYOUT_KEY = "onethu.home.layout";
const DEFAULTS_KEY = "onethu.home.defaults";

function isHomeSlot(v: unknown): v is HomeSlot {
  return v === "main" || v === "rail" || v === "off";
}

/** 读布局表：损坏 / 非法元素一律丢弃，返回 null = 从未布局过（首次访问） */
export function loadLayout(): HomeLayoutItem[] | null {
  try {
    const raw = globalThis.localStorage?.getItem(LAYOUT_KEY);
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

/** 写布局表（每次布局变动即时持久化） */
export function saveLayout(items: HomeLayoutItem[]): void {
  try {
    globalThis.localStorage?.setItem(LAYOUT_KEY, JSON.stringify(items));
  } catch {
    /* 隐私模式 / 存储被禁：静默降级为内存态 */
  }
}

/** 读折叠偏好表（卡片重新添加 / 恢复默认时回填用） */
export function loadCollapsedDefaults(): Partial<Record<HomeCardId, boolean>> {
  try {
    const raw = globalThis.localStorage?.getItem(DEFAULTS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Partial<Record<HomeCardId, boolean>> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "boolean") out[k as HomeCardId] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** 写折叠偏好表 */
export function saveCollapsedDefaults(rec: Partial<Record<HomeCardId, boolean>>): void {
  try {
    globalThis.localStorage?.setItem(DEFAULTS_KEY, JSON.stringify(rec));
  } catch {
    /* 忽略 */
  }
}

/** 恢复默认首页布局：清两个 key（Settings「恢复默认布局」用），下次进今日页重建 */
export function clearHomeLayout(): void {
  try {
    globalThis.localStorage?.removeItem(LAYOUT_KEY);
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
