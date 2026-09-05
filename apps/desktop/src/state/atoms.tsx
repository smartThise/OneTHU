/**
 * 原子注册表（万物原子化 · 唯一事实来源）。
 *
 * 三类原子：
 * - page   一级/二级页面入口（信息/生活/预约各 tab、学堂子页、课表、选课…）——
 *          点击跳原位功能页（LearnNav 子栏契约），默认入口不可拆分；
 * - widget 今日组件原子（自持取数版，HomeWidgets *Widget）——收藏夹里整卡直播，
 *          点标题跳回今日对应卡片来源页；
 * - entity 实体原子（某门课/某作业/某文件/某通知/某讨论区话题/某条新闻/
 *          某楼洗衣机/某台洗衣机/某教学楼/某教室/某场馆/某类研讨间/某图书馆）——
 *          key 里自带展示元数据（~ 分隔，enc/dec），点击深链到原位功能页的特定位置。
 *
 * 搜索（AtomPicker）：静态注册表 + 动态缓存（noteAtomCache 由各实体页写入，
 * 只搜本机已见过的数据——搜索框绝不主动轰炸校内服务）。
 */
import type { ReactNode } from "react";
import {
  IconBell, IconCalendar, IconCard, IconCheck, IconExternal, IconFile, IconFlag,
  IconInfo, IconLearn, IconPen, IconRefresh, IconSchedule, IconSearch, IconToday, IconXk,
} from "../components/Icons.js";
import {
  AgendaWidget, CardBalanceWidget, HomeworkWidget, RecentNoticesWidget, SubsNewsWidget,
  TodayClassesWidget, TodayOverviewWidget, TodayResvWidget,
} from "../components/HomeWidgets.js";
import type { LearnNav, Page } from "./app.js";
import { cacheGet } from "./cache.js";
import type { AtomRef } from "./favorites.js";

/** 图标最小接口（与 homeCards 的 HomeCardIcon 同口径） */
export type AtomIcon = (p: { width?: number; height?: number; className?: string }) => ReactNode;

/** 轻路由签名 */
export type Nav = (page: Page, params?: LearnNav) => void;

/** 解析后的原子视图（渲染/跳转全走它） */
export interface AtomView {
  atom: AtomRef;
  title: string;
  /** 第二行说明 */
  sub?: string;
  icon: AtomIcon;
  /** 点击跳转（原位功能页；widget 的标题点击也走这里） */
  open: (nav: Nav) => void;
  /** 自持组件卡体（widget 原子专用；挂收藏夹瀑布流时整卡直播） */
  widget?: () => ReactNode;
  /** 收藏夹缺省方卡（细粒度实体缺省方卡，页面/组件缺省长卡） */
  defaultSq?: boolean;
  /** 搜索分类标签（AtomPicker 右侧灰字） */
  group: string;
}

/* ══════════ key 编解码（实体原子元数据内嵌；~ 分隔） ══════════ */

export function enc(...parts: Array<string | number | undefined>): string {
  return parts.map((p) => String(p ?? "").replace(/~/g, "-")).join("~");
}

export function dec(key: string): string[] {
  return key.split("~");
}

/* ══════════ 动态缓存（实体页加载成功后 note；只读用于搜索） ══════════ */

export interface AtomDynCache {
  /** 洗衣机楼栋组（WasherTab groups 就绪后写入） */
  washerGroups?: Array<{ gname: string; id: string; name: string; hlsh?: boolean }>;
  /** 教学楼（ClassroomTab 就绪后写入） */
  classroomBuildings?: Array<{ searchName: string; name: string }>;
  /** 体育场馆 scene（VenueSportsTab 就绪后写入；uuid 为原子 key） */
  sportsScenes?: Array<{ uuid: string; name: string }>;
  /** 新闻列表（NewsTab 就绪后写入） */
  newsItems?: Array<{ xxid: string; name: string; source?: string }>;
  /** 研讨间类型（LibRoomTab 就绪后写入） */
  libroomKinds?: Array<{ kindId: number; kindName: string }>;
  /** 图书馆（LibraryTab 就绪后写入） */
  libraries?: Array<{ id: number; name: string }>;
}

const dyn: AtomDynCache = {};

/** 实体页取数成功后调用（浅合并）；绝不主动发起网络请求 */
export function noteAtomCache(patch: AtomDynCache): void {
  Object.assign(dyn, patch);
}

/* ══════════ 静态注册表：页面原子 ══════════ */

interface StaticAtom {
  kind: string;
  key: string;
  title: string;
  sub?: string;
  icon: AtomIcon;
  group: string;
  page: Page;
  params?: LearnNav;
  defaultSq?: boolean;
}

/** 全部二级页面入口（=旧 homeCards entry 全集 + 课程信息栏 + 学堂一级） */
export const PAGE_ATOMS: StaticAtom[] = [
  { kind: "page", key: "schedule", title: "课表", sub: "本周课程安排", icon: IconSchedule, group: "页面", page: "schedule" },
  { kind: "page", key: "zhjwxk", title: "选课", sub: "选课系统 · 已选课程与候补队列（不可拆分原子）", icon: IconXk, group: "页面", page: "zhjwxk" },
  { kind: "page", key: "learn", title: "网络学堂", sub: "本学期课程总览", icon: IconLearn, group: "页面", page: "learn" },
  { kind: "page", key: "learn-assignments", title: "全部作业", sub: "网络学堂 · 作业列表", icon: IconPen, group: "页面", page: "learn-assignments" },
  { kind: "page", key: "learn-notices", title: "全部通知", sub: "网络学堂 · 课程通知", icon: IconBell, group: "页面", page: "learn-notices" },
  { kind: "page", key: "learn-files", title: "全部课程文件", sub: "网络学堂 · 课件与资料", icon: IconFile, group: "页面", page: "learn-files" },
  { kind: "page", key: "learn-search", title: "网络学堂搜索", sub: "课程 / 作业 / 通知 / 文件", icon: IconSearch, group: "页面", page: "learn-search" },
  { kind: "page", key: "learn-semester", title: "学期切换", sub: "网络学堂 · 切换数据学期", icon: IconRefresh, group: "页面", page: "learn-semester" },
  { kind: "page", key: "info-report", title: "全部成绩", sub: "信息门户 · 历年成绩", icon: IconCheck, group: "页面", page: "info", params: { infoTab: "report" } },
  { kind: "page", key: "info-fitness", title: "体测成绩", sub: "信息页 · 体质测试", icon: IconCheck, group: "页面", page: "info", params: { infoTab: "fitness" } },
  { kind: "page", key: "info-exams", title: "考试安排", sub: "信息门户 · 考试日程", icon: IconFlag, group: "页面", page: "info", params: { infoTab: "exams" } },
  { kind: "page", key: "info-evaluation", title: "教学评估", sub: "信息页 · 问卷进度", icon: IconPen, group: "页面", page: "info", params: { infoTab: "evaluation" } },
  { kind: "page", key: "info-calendar", title: "校历", sub: "信息页 · 学期安排图片", icon: IconCalendar, group: "页面", page: "info", params: { infoTab: "calendar" } },
  { kind: "page", key: "info-news", title: "订阅新闻", sub: "信息门户 · 订阅动态", icon: IconExternal, group: "页面", page: "info", params: { infoTab: "news" } },
  { kind: "page", key: "info-profile", title: "个人信息", sub: "信息门户 · 学籍信息", icon: IconInfo, group: "页面", page: "info", params: { infoTab: "profile" } },
  { kind: "page", key: "info-courseinfo", title: "课程信息", sub: "信息页 · 课程简介与大纲", icon: IconInfo, group: "页面", page: "info", params: { infoTab: "courseinfo" } },
  { kind: "page", key: "life-dorm", title: "宿舍 / 电费 / 订水", sub: "生活页 · 宿舍服务", icon: IconToday, group: "页面", page: "life", params: { lifeTab: "dorm" } },
  { kind: "page", key: "life-washer", title: "洗衣机", sub: "生活页 · 设备状态", icon: IconRefresh, group: "页面", page: "life", params: { lifeTab: "washer" } },
  { kind: "page", key: "life-hygiene", title: "卫生成绩", sub: "生活页 · 宿舍卫生检查", icon: IconFlag, group: "页面", page: "life", params: { lifeTab: "hygiene" } },
  { kind: "page", key: "life-card", title: "校园卡", sub: "生活页 · 余额与流水", icon: IconCard, group: "页面", page: "life", params: { lifeTab: "card" } },
  { kind: "page", key: "life-invoice", title: "电子发票", sub: "生活页 · 财务 · 发票列表", icon: IconFile, group: "页面", page: "life", params: { lifeTab: "invoice" } },
  { kind: "page", key: "life-payroll", title: "银行代发", sub: "生活页 · 财务 · 工资到账", icon: IconToday, group: "页面", page: "life", params: { lifeTab: "payroll" } },
  { kind: "page", key: "life-gradincome", title: "研究生收入", sub: "生活页 · 财务 · 助研津贴", icon: IconCard, group: "页面", page: "life", params: { lifeTab: "gradincome" } },
  { kind: "page", key: "life-network", title: "校园网", sub: "生活页 · 账号与流量", icon: IconExternal, group: "页面", page: "life", params: { lifeTab: "network" } },
  { kind: "page", key: "reserve-lib", title: "图书馆座位", sub: "预约 · 座位与签到", icon: IconSchedule, group: "页面", page: "reserve", params: { reserveTab: "lib" } },
  { kind: "page", key: "reserve-room", title: "研讨间", sub: "预约 · 研讨间申请", icon: IconCalendar, group: "页面", page: "reserve", params: { reserveTab: "room" } },
  { kind: "page", key: "reserve-classroom", title: "空教室", sub: "预约页 · 自习空闲查询", icon: IconSearch, group: "页面", page: "reserve", params: { reserveTab: "classroom" } },
  { kind: "page", key: "reserve-sports", title: "体育预约", sub: "预约页 · 体育场馆时段预约", icon: IconSchedule, group: "页面", page: "reserve", params: { reserveTab: "sports" } },
  { kind: "page", key: "reserve-kongjian", title: "公共空间", sub: "预约页 · 宿舍公共空间预约", icon: IconCalendar, group: "页面", page: "reserve", params: { reserveTab: "kongjian" } },
];

/* ══════════ 静态注册表：组件原子（今日组件自持版） ══════════ */

interface WidgetAtom {
  kind: "widget";
  key: string;
  title: string;
  sub?: string;
  icon: AtomIcon;
  group: string;
  body: () => ReactNode;
  page: Page;
  params?: LearnNav;
}

/** 点击标题跳回组件数据来源页（与今日页各卡点击行为同口径） */
export const WIDGET_ATOMS: WidgetAtom[] = [
  { kind: "widget", key: "today-overview", title: "今日概览", sub: "未交作业 · 截止 · 今日课程", icon: IconToday, group: "组件", body: () => <TodayOverviewWidget />, page: "today" },
  { kind: "widget", key: "agenda", title: "日程与提醒", sub: "校历 · 学校重要事项倒计时", icon: IconCalendar, group: "组件", body: () => <AgendaWidget />, page: "schedule" },
  { kind: "widget", key: "homework", title: "未提交作业", sub: "截止升序 · 点击查看详情", icon: IconPen, group: "组件", body: () => <HomeworkWidget />, page: "learn-assignments" },
  { kind: "widget", key: "notices", title: "最近通知", sub: "最新课程通知", icon: IconBell, group: "组件", body: () => <RecentNoticesWidget />, page: "learn" },
  { kind: "widget", key: "cardEntry", title: "校园卡余额", sub: "快捷入口", icon: IconCard, group: "组件", body: () => <CardBalanceWidget />, page: "life", params: { lifeTab: "card" } },
  { kind: "widget", key: "resv", title: "今日预约", sub: "座位 · 研讨间", icon: IconSchedule, group: "组件", body: () => <TodayResvWidget />, page: "reserve" },
  { kind: "widget", key: "classes", title: "今日课程", sub: "按开始时间排序", icon: IconToday, group: "组件", body: () => <TodayClassesWidget />, page: "schedule" },
  { kind: "widget", key: "news", title: "订阅新闻", sub: "订阅来源优先，回退最新", icon: IconExternal, group: "组件", body: () => <SubsNewsWidget />, page: "info", params: { infoTab: "news" } },
];

/* ══════════ 实体原子工厂 ══════════ */

function view(partial: Omit<AtomView, "atom"> & { atom: AtomRef }): AtomView {
  return partial;
}

/** 解析原子：注册表未知的 kind/key 返回 null（渲染处直接丢弃） */
export function resolveAtom(ref: AtomRef): AtomView | null {
  const { kind, key } = ref;
  if (kind === "page") {
    const s = PAGE_ATOMS.find((a) => a.key === key);
    if (!s) return null;
    return view({
      atom: ref, title: s.title, sub: s.sub, icon: s.icon, group: s.group,
      open: (nav) => nav(s.page, s.params ? { ...s.params } : undefined),
    });
  }
  if (kind === "widget") {
    const w = WIDGET_ATOMS.find((a) => a.key === key);
    if (!w) return null;
    return view({
      atom: ref, title: w.title, sub: w.sub, icon: w.icon, group: w.group,
      widget: w.body,
      open: (nav) => nav(w.page, w.params ? { ...w.params } : undefined),
    });
  }
  if (kind === "course") {
    const [id, name, teacher] = dec(key);
    if (!id || !name) return null;
    return view({
      atom: ref, title: name, sub: teacher ? "课程 · " + teacher : "课程", icon: IconLearn, group: "网络学堂",
      open: (nav) => nav("learn-course", { courseId: id }),
    });
  }
  if (kind === "assignment" || kind === "notice" || kind === "file") {
    const [courseId, itemId, title, courseName] = dec(key);
    if (!courseId || !itemId) return null;
    const conf = {
      assignment: { t: "作业", icon: IconPen, page: "learn-assignment-detail" as Page },
      notice: { t: "通知", icon: IconBell, page: "learn-notice-detail" as Page },
      file: { t: "文件", icon: IconFile, page: "learn-file-detail" as Page },
    }[kind];
    return view({
      atom: ref, title: title || conf.t, sub: (courseName ? courseName + " · " : "") + conf.t, icon: conf.icon, group: "网络学堂",
      open: (nav) => nav(conf.page, { courseId, itemId }),
    });
  }
  if (kind === "forum") {
    const [courseId, threadId, bqid, title, courseName] = dec(key);
    if (!courseId || !threadId) return null;
    return view({
      atom: ref, title: title || "讨论区话题", sub: (courseName ? courseName + " · " : "") + "讨论区", icon: IconLearn, group: "网络学堂",
      open: (nav) => nav("learn-forum-thread", { courseId, itemId: threadId, bqid: bqid || undefined }),
    });
  }
  if (kind === "news") {
    const [xxid, title, source] = dec(key);
    if (!xxid) return null;
    return view({
      atom: ref, title: title || "新闻", sub: source || "校内通知", icon: IconExternal, group: "新闻",
      open: (nav) => nav("info", { infoNewsId: xxid }),
    });
  }
  if (kind === "washer-b") {
    const [id, name, hlsh, gname] = dec(key);
    if (!id) return null;
    return view({
      atom: ref, title: name || "洗衣机楼栋", sub: (gname ? gname + " · " : "") + (hlsh === "1" ? "海乐生活点位" : "全部洗衣机"), icon: IconRefresh, group: "洗衣机",
      open: (nav) => nav("life", { lifeTab: "washer", washerBuildingId: id, washerBuildingName: name, washerBuildingHlsh: hlsh === "1" }),
    });
  }
  if (kind === "washer-m") {
    const [bId, bName, hlsh, dev] = dec(key);
    if (!bId || !dev) return null;
    return view({
      atom: ref, title: dev, sub: (bName || "") + (hlsh === "1" ? " · 海乐" : "") + " · 洗衣机", icon: IconRefresh, group: "洗衣机", defaultSq: true,
      open: (nav) => nav("life", { lifeTab: "washer", washerBuildingId: bId, washerBuildingName: bName, washerBuildingHlsh: hlsh === "1", washerMachine: dev }),
    });
  }
  if (kind === "classroom-b") {
    const [searchName, name] = dec(key);
    if (!searchName) return null;
    return view({
      atom: ref, title: name || searchName, sub: "教学楼 · 本周空闲状态", icon: IconSearch, group: "空教室",
      open: (nav) => nav("reserve", { reserveTab: "classroom", classroomBuilding: searchName, classroomBuildingName: name }),
    });
  }
  if (kind === "classroom-r") {
    const [searchName, bName, room] = dec(key);
    if (!searchName || !room) return null;
    return view({
      atom: ref, title: room, sub: (bName || "") + " · 教室", icon: IconSearch, group: "空教室", defaultSq: true,
      open: (nav) => nav("reserve", { reserveTab: "classroom", classroomBuilding: searchName, classroomBuildingName: bName, classroomRoom: room }),
    });
  }
  if (kind === "sports-v") {
    const [uuid, name] = dec(key);
    if (!uuid) return null;
    return view({
      atom: ref, title: name || "体育场馆", sub: "体育系统 · 场次预约", icon: IconSchedule, group: "体育",
      open: (nav) => nav("reserve", { reserveTab: "sports", sportsScene: uuid }),
    });
  }
  if (kind === "libroom-k") {
    const [id, name] = dec(key);
    if (!id) return null;
    return view({
      atom: ref, title: name || "研讨间", sub: "研讨间 · 时段申请", icon: IconCalendar, group: "研讨间",
      open: (nav) => nav("reserve", { reserveTab: "room", libroomKind: Number(id) || undefined }),
    });
  }
  if (kind === "library") {
    const [id, name] = dec(key);
    if (!id) return null;
    return view({
      atom: ref, title: name || "图书馆", sub: "图书馆 · 座位与签到", icon: IconSchedule, group: "图书馆",
      open: (nav) => nav("reserve", { reserveTab: "lib", libraryId: Number(id) || undefined }),
    });
  }
  return null;
}

/* ══════════ 搜索（AtomPicker 数据源；只搜静态表 + 本机缓存） ══════════ */

export interface AtomHit extends AtomRef {
  title: string;
  sub?: string;
  group: string;
  icon: AtomIcon;
}

function hit(v: { atom: AtomRef; title: string; sub?: string; icon: AtomIcon; group: string }): AtomHit {
  return { ...v.atom, title: v.title, sub: v.sub, icon: v.icon, group: v.group };
}

/** 按关键词搜原子（标题/说明子串匹配，大小写不敏感；最多 limit 条） */
export function searchAtoms(query: string, limit = 24): AtomHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: AtomHit[] = [];
  const seen = new Set<string>();
  const push = (h: AtomHit | null) => {
    if (!h) return;
    const k = h.kind + "|" + h.key;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(h);
  };
  const match = (...fields: Array<string | undefined>) => fields.some((f) => (f ?? "").toLowerCase().includes(q));

  for (const s of PAGE_ATOMS) if (match(s.title, s.sub)) push(hit({ atom: { kind: s.kind, key: s.key }, title: s.title, sub: s.sub, icon: s.icon, group: s.group }));
  for (const w of WIDGET_ATOMS) if (match(w.title, w.sub)) push(hit({ atom: { kind: w.kind, key: w.key }, title: w.title, sub: w.sub, icon: w.icon, group: w.group }));

  // —— 动态：本机缓存里已见过的实体（campus 缓存 + noteAtomCache）——
  const campus = cacheGet<{ courses: Array<{ id: string; name: string; teacherName?: string }>; homework: Array<{ courseId: string; id: string; title: string; submitted: boolean }>; notifications: Array<{ courseId: string; id: string; title: string }>; files: Array<{ courseId: string; id: string; title: string }> }>("campus")?.data;
  if (campus) {
    for (const c of campus.courses ?? []) if (match(c.name, c.teacherName)) push(hit({ atom: { kind: "course", key: enc(c.id, c.name, c.teacherName) }, title: c.name, sub: "课程" + (c.teacherName ? " · " + c.teacherName : ""), icon: IconLearn, group: "网络学堂" }));
    for (const h of campus.homework ?? []) if (!h.submitted && match(h.title)) push(hit({ atom: { kind: "assignment", key: enc(h.courseId, h.id, h.title) }, title: h.title, sub: "作业", icon: IconPen, group: "网络学堂" }));
    for (const n of campus.notifications ?? []) if (match(n.title)) push(hit({ atom: { kind: "notice", key: enc(n.courseId, n.id, n.title) }, title: n.title, sub: "课程通知", icon: IconBell, group: "网络学堂" }));
    for (const f of campus.files ?? []) if (match(f.title)) push(hit({ atom: { kind: "file", key: enc(f.courseId, f.id, f.title) }, title: f.title, sub: "课程文件", icon: IconFile, group: "网络学堂" }));
  }
  for (const b of dyn.washerGroups ?? []) if (match(b.name, b.gname)) push(hit({ atom: { kind: "washer-b", key: enc(b.id, b.name, b.hlsh ? "1" : "0", b.gname) }, title: b.name, sub: b.gname, icon: IconRefresh, group: "洗衣机" }));
  for (const b of dyn.classroomBuildings ?? []) if (match(b.name)) push(hit({ atom: { kind: "classroom-b", key: enc(b.searchName, b.name) }, title: b.name, sub: "教学楼", icon: IconSearch, group: "空教室" }));
  for (const s of dyn.sportsScenes ?? []) if (match(s.name)) push(hit({ atom: { kind: "sports-v", key: enc(s.uuid, s.name) }, title: s.name, sub: "体育场馆", icon: IconSchedule, group: "体育" }));
  for (const n of dyn.newsItems ?? []) if (match(n.name, n.source)) push(hit({ atom: { kind: "news", key: enc(n.xxid, n.name, n.source) }, title: n.name, sub: n.source || "校内通知", icon: IconExternal, group: "新闻" }));
  for (const k of dyn.libroomKinds ?? []) if (match(k.kindName)) push(hit({ atom: { kind: "libroom-k", key: enc(k.kindId, k.kindName) }, title: k.kindName, sub: "研讨间", icon: IconCalendar, group: "研讨间" }));
  for (const l of dyn.libraries ?? []) if (match(l.name)) push(hit({ atom: { kind: "library", key: enc(l.id, l.name) }, title: l.name, sub: "图书馆", icon: IconSchedule, group: "图书馆" }));

  return out.slice(0, limit);
}
