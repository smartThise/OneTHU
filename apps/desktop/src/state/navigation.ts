/**
 * 功能注册表（UI/UX 改造方案 §2.6 的技术枢纽，唯一事实来源）。
 *
 * 设计约束（docs/ui-ux-overhaul-plan.md §0.2 红线）：
 * - 页面 ID 沿用现有值，不改路由实现：id 一律取 PAGE_ATOMS 的既有 key，
 *   跳转目标用既有的 (Page, LearnNav) 组合——消费方拿到即可直接 nav()；
 * - 只读数据 + 纯函数：本模块不碰 localStorage、不发请求、无副作用；
 * - 收藏机制一字不改：这里声明的是「系统视角的可见性分级」，与用户收藏
 *   （favorites.ts）完全正交——推荐/目录把用户带到功能门口，收不收藏仍由
 *   用户自己按星号。
 *
 * 消费方（同一份数据，禁止各自再写功能清单）：
 * - 底部 5 Tab / PC 侧栏（Layout.tsx，M1）
 * - 「服务」分组目录页与搜索（M1）
 * - 常用推荐区兜底顺序（Today.tsx + lib/suggest.ts，M5）
 * - ConnectGate 绑定引导（needBind 字段，M4）
 * - AI 意图匹配 / 时间敏感动态提升（keywords / boostWindow，P2）
 *
 * 分级定义（§1.2，M0 定稿）：
 * - core     底部导航直达 / 「今日」卡片
 * - group    「服务」页分组内（PC 侧栏分组小标题直达）
 * - buried   仅「全部功能」目录 + 搜索可达
 * - advanced 高级模式（标准模式不可见；功能完整保留）
 */
import type { LearnNav, Page } from "./app.js";

/** 服务页分组（§2.2）：学习 / 日程 / 生活 / 预约 / 行政 */
export type NavCategory = "学习" | "日程" | "生活" | "预约" | "行政";

/** 可见性分级（§1.2） */
export type NavVisibility = "core" | "group" | "buried" | "advanced";

/**
 * 绑定依赖键（ConnectGate 消费，§4.3）：值与 state/accountSetup.ts、
 * state/exthw.ts 的既有账号键对齐，不新增账号体系。
 */
export type BindKey =
  | "yuketang" // 雨课堂（扫码 / webview 登录）
  | "tuoj" // TUOJ（统一认证）
  | "tuojClassic" // TUOJ 经典版
  | "tyche" // Tyche OJ
  | "dsa" // DSA OJ
  | "mail" // 邮箱（授权码）
  | "cloud" // 清华云盘（Seafile token）
  | "cloudcal"; // 云日历

/** 时间敏感提升窗口（§2.4，P2）：MMDD 闭区间；from > to 视为跨年 */
export interface BoostWindow {
  from: string; // "0915"
  to: string; // "0925"
}

/** 注册表条目（§2.6 metadata 结构） */
export interface NavEntry {
  /** 沿用现有页面原子 ID（PAGE_ATOMS key），不改路由实现 */
  id: string;
  name: string;
  category: NavCategory;
  visibility: NavVisibility;
  /** 跳转目标：既有 (Page, LearnNav)，消费方直接 nav(entry.page, entry.params) */
  page: Page;
  params?: LearnNav;
  /** 绑定依赖：未绑定时由 ConnectGate 内联登录后返回原任务 */
  needBind?: BindKey;
  /** 供搜索与 AI 意图匹配（消费方同时匹配 name） */
  keywords: string[];
  /** 时间敏感提升窗口（P2 消费；首版仅声明预留） */
  boostWindow?: BoostWindow;
  /** 一句话说明（目录页副标题 / 推荐区 why 兜底） */
  note?: string;
}

/* ══════════ 注册表（§1.2 全量清单；入口映射在 M1 PR 中逐条勾选核对） ══════════ */

export const NAV_REGISTRY: NavEntry[] = [
  /* —— 学习 —— */
  { id: "learn", name: "网络学堂", category: "学习", visibility: "group", page: "learn", keywords: ["课程", "学堂", "文件", "讨论区"], note: "本学期课程总览" },
  { id: "learn-assignments", name: "全部作业", category: "学习", visibility: "core", page: "learn-assignments", keywords: ["作业", "DDL", "截止"], note: "网络学堂与外部作业源合并视图（待办 tab 直达页）" },
  { id: "learn-notices", name: "全部通知", category: "学习", visibility: "group", page: "learn-notices", keywords: ["通知", "课程通知"] },
  { id: "learn-files", name: "全部课程文件", category: "学习", visibility: "group", page: "learn-files", keywords: ["课件", "资料", "文件"] },
  { id: "learn-search", name: "网络学堂搜索", category: "学习", visibility: "group", page: "learn-search", keywords: ["搜索", "课程"] },
  { id: "learn-semester", name: "学期切换", category: "学习", visibility: "buried", page: "learn-semester", keywords: ["学期"] },
  { id: "yuketang-homework", name: "雨课堂作业", category: "学习", visibility: "core", page: "learn-assignments", needBind: "yuketang", keywords: ["雨课堂", "作业", "主观题"], note: "作业区内未绑定时由 ConnectGate 内联引导（§4.3）" },
  { id: "oj-homework", name: "OJ 作业", category: "学习", visibility: "core", page: "learn-assignments", needBind: "tuoj", keywords: ["OJ", "TUOJ", "Tyche", "DSA"], note: "TUOJ 系 / Tyche / DSA 外部作业源；按源分别绑定" },
  { id: "info-report", name: "成绩", category: "学习", visibility: "group", page: "info", params: { infoTab: "report" }, keywords: ["成绩单", "GPA", "学年汇总"] },
  { id: "info-courseinfo", name: "课程信息", category: "学习", visibility: "group", page: "info", params: { infoTab: "courseinfo" }, keywords: ["courseX", "课程简介", "时间地点"] },
  { id: "info-exams", name: "考试安排", category: "学习", visibility: "group", page: "info", params: { infoTab: "exams" }, keywords: ["考试", "考场"], boostWindow: { from: "0101", to: "0131" }, note: "考试周可提升（P2 消费 boostWindow）" },
  { id: "info-evaluation", name: "教学评估", category: "学习", visibility: "buried", page: "info", params: { infoTab: "evaluation" }, keywords: ["评估", "评教", "问卷"], boostWindow: { from: "0601", to: "0630" }, note: "评估季同理" },
  { id: "zhjwxk", name: "选课", category: "学习", visibility: "group", page: "zhjwxk", keywords: ["选课", "退课", "候补"], boostWindow: { from: "0901", to: "0920" }, note: "选课季临时提升 group→今日推荐" },

  /* —— 日程 —— */
  { id: "schedule", name: "课表", category: "日程", visibility: "core", page: "schedule", keywords: ["课表", "日程", "上课"], note: "今日页「下一节课」卡数据来源" },
  { id: "trace", name: "寻迹", category: "日程", visibility: "group", page: "trace", keywords: ["地图", "导航", "前往"] },
  { id: "info-calendar", name: "校历", category: "日程", visibility: "group", page: "info", params: { infoTab: "calendar" }, keywords: ["校历", "学期安排", "放假"] },

  /* —— 生活 —— */
  { id: "life-card", name: "校园卡", category: "生活", visibility: "core", page: "life", params: { lifeTab: "card" }, keywords: ["校园卡", "余额", "流水", "充值"], note: "今日余额速览条来源之一" },
  { id: "life-electricity", name: "宿舍电费", category: "生活", visibility: "core", page: "life", params: { lifeTab: "dorm", dormSection: "ele" }, keywords: ["电费", "宿舍", "充值"], note: "今日余额速览条来源之一" },
  { id: "life-washer", name: "洗衣机", category: "生活", visibility: "group", page: "life", params: { lifeTab: "washer" }, keywords: ["洗衣", "烘干", "设备"], note: "宿舍楼填写后可上今日卡（P2）" },
  { id: "life-dorm", name: "宿舍", category: "生活", visibility: "group", page: "life", params: { lifeTab: "dorm" }, keywords: ["宿舍", "订水"] },
  { id: "life-hygiene", name: "卫生成绩", category: "生活", visibility: "group", page: "life", params: { lifeTab: "hygiene" }, keywords: ["卫生", "检查"] },
  { id: "life-network", name: "校园网", category: "生活", visibility: "group", page: "life", params: { lifeTab: "network" }, keywords: ["校园网", "流量", "上网"] },
  { id: "life-invoice", name: "电子发票", category: "生活", visibility: "group", page: "life", params: { lifeTab: "invoice" }, keywords: ["发票", "财务"] },
  { id: "life-payroll", name: "银行代发", category: "生活", visibility: "group", page: "life", params: { lifeTab: "payroll" }, keywords: ["工资", "代发", "到账"], note: "适用人群在描述中注明，不做入口屏蔽" },
  { id: "life-gradincome", name: "研究生收入", category: "生活", visibility: "group", page: "life", params: { lifeTab: "gradincome" }, keywords: ["助研", "津贴", "收入"], note: "适用人群在描述中注明，不做入口屏蔽" },

  /* —— 预约 —— */
  { id: "reserve-lib", name: "图书馆座位", category: "预约", visibility: "group", page: "reserve", params: { reserveTab: "lib" }, keywords: ["图书馆", "座位", "签到"] },
  { id: "reserve-room", name: "研讨间", category: "预约", visibility: "group", page: "reserve", params: { reserveTab: "room" }, keywords: ["研讨间", "申请"] },
  { id: "reserve-classroom", name: "空教室", category: "预约", visibility: "group", page: "reserve", params: { reserveTab: "classroom" }, keywords: ["自习", "空教室", "教室"] },
  { id: "reserve-sports", name: "体育预约", category: "预约", visibility: "group", page: "reserve", params: { reserveTab: "sports" }, keywords: ["体育", "场馆", "健身房", "游泳"] },
  { id: "reserve-kongjian", name: "公共空间", category: "预约", visibility: "group", page: "reserve", params: { reserveTab: "kongjian" }, keywords: ["公共空间", "活动室"] },

  /* —— 行政 —— */
  { id: "mail", name: "邮箱", category: "行政", visibility: "group", page: "mail", needBind: "mail", keywords: ["邮件", "邮箱", "收件"] },
  { id: "cloud", name: "云盘", category: "行政", visibility: "group", page: "cloud", needBind: "cloud", keywords: ["云盘", "Seafile", "文件", "资料库"] },
  { id: "thos", name: "在线服务", category: "行政", visibility: "group", page: "thos", keywords: ["THOS", "服务大厅", "报备", "入校", "亲友"], note: "亲友入校报备前置顶（P2 时间敏感项）" },
  { id: "info-profile", name: "个人信息", category: "行政", visibility: "group", page: "info", params: { infoTab: "profile" }, keywords: ["学籍", "个人信息"] },
  { id: "info-fitness", name: "体测", category: "行政", visibility: "group", page: "info", params: { infoTab: "fitness" }, keywords: ["体测", "体质"] },
  { id: "info-news", name: "新闻", category: "行政", visibility: "group", page: "info", params: { infoTab: "news" }, keywords: ["新闻", "通知", "订阅"], note: "今日取前 3 条" },
  { id: "thubook", name: "Thubook", category: "行政", visibility: "group", page: "thubook", keywords: ["手册", "清华手册"] },
  { id: "otherinfo", name: "其他 Info 应用", category: "行政", visibility: "buried", page: "otherinfo", keywords: ["门户", "应用", "目录"] },

  /* —— 高级能力（标准模式不可见，功能完整保留） —— */
  { id: "plugins", name: "插件系统", category: "行政", visibility: "advanced", page: "plugins", keywords: ["插件", "扩展", "市场"] },
  { id: "trace-dev", name: "开发者面板", category: "行政", visibility: "advanced", page: "settings", keywords: ["开发", "调试"], note: "入口在设置页高级模式开关之下" },
];

/* ══════════ 纯函数助手（消费方共用，禁止各写一份过滤逻辑） ══════════ */

/** 注册表索引（id 唯一性在开发期保证；重复时后者胜，消费方无需关心） */
const BY_ID = new Map(NAV_REGISTRY.map((e) => [e.id, e] as const));

export function navEntry(id: string): NavEntry | undefined {
  return BY_ID.get(id);
}

/** 按可见性过滤（核心消费：底栏 / 服务页 / 目录 / 高级模式） */
export function byVisibility(v: NavVisibility): NavEntry[] {
  return NAV_REGISTRY.filter((e) => e.visibility === v);
}

/** 服务页分组目录：category 顺序稳定（学习→日程→生活→预约→行政） */
export const NAV_CATEGORIES: readonly NavCategory[] = ["学习", "日程", "生活", "预约", "行政"];

export function byCategory(cat: NavCategory): NavEntry[] {
  return NAV_REGISTRY.filter((e) => e.category === cat && e.visibility !== "advanced");
}

/** 常用推荐空状态兜底顺序（§2.5：按 core 顺序展示默认推荐） */
export function coreDefaults(): NavEntry[] {
  return byVisibility("core");
}

/** 搜索匹配：name 全文 + keywords 包含；q 为空返回空数组（调用方决定空态） */
export function matchNavQuery(q: string): NavEntry[] {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  return NAV_REGISTRY.filter((e) => {
    if (e.visibility === "advanced") return false; // 高级能力不进标准搜索（§4.4）
    if (e.name.toLowerCase().includes(query)) return true;
    return e.keywords.some((k) => k.toLowerCase().includes(query));
  });
}

/** 时间敏感提升判定（§2.4，P2）：MMDD 闭区间；from > to 按跨年理解 */
export function isBoosted(e: NavEntry, now = new Date()): boolean {
  if (!e.boostWindow) return false;
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const t = mm + dd;
  const { from, to } = e.boostWindow;
  return from <= to ? from <= t && t <= to : t >= from || t <= to;
}
