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
import { t as i18n, tOr } from "../i18n/index.js";


/** 服务页分组（§2.2）：学习 / 日程 / 生活 / 预约 / 行政 */
export type NavCategory = "学习" | "日程" | "生活" | "预约" | "行政" | "插件";
/* 「插件」是**动态**类目（2026-10-15）：插件功能页由 ctx.registerTab 运行时注册/卸载，
   塞不进这个静态 registry，所以它不出现在 NAV_CATEGORIES 的静态循环里 ——
   消费者（首页「详细功能」目录）用下面的 pluginCatalogEntries(tabs) 单独追加一组。 */

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
  {id:"contacts",name:"通讯录",category:"行政",visibility:"core",page:"contacts",keywords:["好友","通讯录","组织","名片"],note:"名片 · 好友 · 组织"},
  /* —— 学习 —— */
  { id: "vault", name: "暂存箱", category: "行政", visibility: "group", page: "vault", keywords: ["暂存箱", "收纳", "收集", "暂存", "分享口令", "箱子"], note: "任何元素先收进来，再整理/分享" },
  { id: "learn", name: "网络学堂", category: "学习", visibility: "group", page: "learn", keywords: ["课程", "学堂", "文件", "讨论区"], note: "本学期课程总览" },
  { id: "learn-assignments", name: "全部作业", category: "学习", visibility: "core", page: "learn-assignments", keywords: ["作业", "DDL", "截止"], note: "汇总课程作业，按截止时间查看" },
  { id: "learn-notices", name: "全部通知", category: "学习", visibility: "group", page: "learn-notices", keywords: ["通知", "课程通知"] },
  { id: "learn-files", name: "全部课程文件", category: "学习", visibility: "group", page: "learn-files", keywords: ["课件", "资料", "文件"] },
  { id: "learn-search", name: "网络学堂搜索", category: "学习", visibility: "group", page: "learn-search", keywords: ["搜索", "课程"] },
  { id: "learn-semester", name: "学期切换", category: "学习", visibility: "buried", page: "learn-semester", keywords: ["学期"] },
  { id: "yuketang-homework", name: "雨课堂作业", category: "学习", visibility: "core", page: "learn-assignments", needBind: "yuketang", keywords: ["雨课堂", "作业", "主观题"], note: "查看雨课堂作业与提交情况" },
  { id: "oj-homework", name: "OJ 作业", category: "学习", visibility: "core", page: "learn-assignments", needBind: "tuoj", keywords: ["OJ", "TUOJ", "Tyche", "DSA"], note: "查看编程作业与截止时间" },
  { id: "info-report", name: "成绩", category: "学习", visibility: "group", page: "info", params: { infoTab: "report" }, keywords: ["成绩单", "GPA", "学年汇总"] },
  { id: "info-courseinfo", name: "课程信息", category: "学习", visibility: "group", page: "info", params: { infoTab: "courseinfo" }, keywords: ["courseX", "课程简介", "时间地点"] },
  { id: "info-exams", name: "考试安排", category: "学习", visibility: "group", page: "info", params: { infoTab: "exams" }, keywords: ["考试", "考场"], boostWindow: { from: "0101", to: "0131" }, note: "查看考试时间与考场" },
  { id: "info-evaluation", name: "教学评估", category: "学习", visibility: "buried", page: "info", params: { infoTab: "evaluation" }, keywords: ["评估", "评教", "问卷"], boostWindow: { from: "0601", to: "0630" }, note: "填写课程评价与教学问卷" },
  { id: "zhjwxk", name: "选课", category: "学习", visibility: "group", page: "zhjwxk", keywords: ["选课", "退课", "候补"], boostWindow: { from: "0901", to: "0920" }, note: "查看选课、退课与候补" },
  /* 清小搭（2026-10-15）：一级页——首页程序坞第九颗球、搜索栏可搜、OH 可打开
     （四处注册见 tools/xiaoda-entries-test.mjs）；note 是搜索结果的副标题，别再说「实验页」。 */
  { id: "xiaoda", name: "清小搭", category: "学习", visibility: "group", page: "xiaoda", keywords: ["清小搭", "小搭", "AI 学伴", "智能体", "技能广场", "xiaoda"], note: "校园 AI 学伴：聊天 · 历史 · 智能体 · 技能广场" },

  /* —— 日程 —— */
  { id: "tasks", name: "待办", category: "日程", visibility: "core", page: "tasks", keywords: ["待办", "任务", "提醒", "作业截止"], note: "全部待办与提醒" },
  { id: "life", name: "生活", category: "生活", visibility: "core", page: "life", keywords: ["生活", "校园卡", "电费", "洗衣机", "宿舍"], note: "生活服务总览" },
  { id: "schedule", name: "课表", category: "日程", visibility: "core", page: "schedule", keywords: ["课表", "日程", "上课"], note: "按时间查看课程与日程" },
  { id: "trace", name: "寻迹", category: "日程", visibility: "group", page: "trace", keywords: ["地图", "导航", "前往"] },
  { id: "info-calendar", name: "校历", category: "日程", visibility: "group", page: "info", params: { infoTab: "calendar" }, keywords: ["校历", "学期安排", "放假"] },

  /* —— 生活 —— */
  { id: "life-card", name: "校园卡", category: "生活", visibility: "core", page: "life", params: { lifeTab: "card" }, keywords: ["校园卡", "余额", "流水", "充值"], note: "查看余额与收支记录" },
  { id: "life-electricity", name: "宿舍电费", category: "生活", visibility: "core", page: "life", params: { lifeTab: "dorm", dormSection: "ele" }, keywords: ["电费", "宿舍", "充值"], note: "查询宿舍用电与电费余额" },
  { id: "life-washer", name: "洗衣机", category: "生活", visibility: "group", page: "life", params: { lifeTab: "washer" }, keywords: ["洗衣", "烘干", "设备"], note: "查询洗衣机和烘干机状态" },
  { id: "life-dorm", name: "宿舍", category: "生活", visibility: "group", page: "life", params: { lifeTab: "dorm" }, keywords: ["宿舍", "订水"] },
  { id: "life-hygiene", name: "卫生成绩", category: "生活", visibility: "group", page: "life", params: { lifeTab: "hygiene" }, keywords: ["卫生", "检查"] },
  { id: "life-network", name: "校园网", category: "生活", visibility: "group", page: "life", params: { lifeTab: "network" }, keywords: ["校园网", "流量", "上网"] },
  { id: "life-invoice", name: "电子发票", category: "生活", visibility: "group", page: "life", params: { lifeTab: "invoice" }, keywords: ["发票", "财务"] },
  { id: "life-payroll", name: "银行代发", category: "生活", visibility: "group", page: "life", params: { lifeTab: "payroll" }, keywords: ["工资", "代发", "到账"], note: "查看个人到账与发放记录" },
  { id: "life-gradincome", name: "研究生收入", category: "生活", visibility: "group", page: "life", params: { lifeTab: "gradincome" }, keywords: ["助研", "津贴", "收入"], note: "查看个人到账与发放记录" },

  /* —— 预约 —— */
  { id: "reserve-lib", name: "图书馆座位", category: "预约", visibility: "group", page: "reserve", params: { reserveTab: "lib" }, keywords: ["图书馆", "座位", "签到"] },
  { id: "reserve-room", name: "研讨间", category: "预约", visibility: "group", page: "reserve", params: { reserveTab: "room" }, keywords: ["研讨间", "申请"] },
  { id: "reserve-classroom", name: "空教室", category: "预约", visibility: "group", page: "reserve", params: { reserveTab: "classroom" }, keywords: ["自习", "空教室", "教室"] },
  { id: "reserve-sports", name: "体育预约", category: "预约", visibility: "group", page: "reserve", params: { reserveTab: "sports" }, keywords: ["体育", "场馆", "健身房", "游泳"] },
  { id: "reserve-kongjian", name: "公共空间", category: "预约", visibility: "group", page: "reserve", params: { reserveTab: "kongjian" }, keywords: ["公共空间", "活动室"] },
  /* 临时来访人员报备（2026-10-15）：官方出处 = 行在清华小程序「临时来访人员报备」→
     visit.tsinghua.edu.cn 的「亲友来访报备」。id 必须与 atoms.tsx 的 PAGE_ATOMS key 同名
     （否则搜索点了走页面原子、这里写的 params 被静默忽略，落回图书馆座位）。 */
  { id: "reserve-visit", name: "临时来访人员报备", category: "预约", visibility: "group", page: "reserve", params: { reserveTab: "visit" }, keywords: ["临时来访", "亲友来访", "访客", "报备", "入校", "参观", "预约来访"], note: "亲友来访报备 · 我的报备 · 来访人登记" },

  /* —— 行政 —— */
  { id: "mail", name: "邮箱", category: "行政", visibility: "group", page: "mail", needBind: "mail", keywords: ["邮件", "邮箱", "收件"] },
  { id: "cloud", name: "云盘", category: "行政", visibility: "group", page: "cloud", needBind: "cloud", keywords: ["云盘", "Seafile", "文件", "资料库"] },
  { id: "gitlab", name: "GitLab", category: "行政", visibility: "group", page: "gitlab", keywords: ["gitlab", "代码", "仓库", "issue", "合并请求", "流水线", "ci"] },
  { id: "thos", name: "在线服务", category: "行政", visibility: "group", page: "thos", keywords: ["THOS", "服务大厅", "报备", "入校", "亲友"], note: "查找校内办事与在线申请" },
  { id: "info-profile", name: "个人信息", category: "行政", visibility: "group", page: "info", params: { infoTab: "profile" }, keywords: ["学籍", "个人信息"] },
  { id: "info-fitness", name: "体测成绩", category: "行政", visibility: "group", page: "info", params: { infoTab: "fitness" }, keywords: ["体测", "体质"] },
  { id: "info-news", name: "新闻", category: "行政", visibility: "group", page: "info", params: { infoTab: "news" }, keywords: ["新闻", "通知", "订阅"], note: "浏览校园新闻与通知" },
  { id: "thubook", name: "THUBook", category: "行政", visibility: "group", page: "thubook", keywords: ["手册", "清华手册"] },
  { id: "otherinfo", name: "其他 Info 应用", category: "行政", visibility: "buried", page: "otherinfo", keywords: ["门户", "应用", "目录"] },

  /* —— 高级能力（标准模式不可见，功能完整保留） —— */
  { id: "plugins", name: "插件系统", category: "行政", visibility: "group", page: "plugins", keywords: ["插件", "扩展", "市场"], note: "JS / Rust / Android 内嵌三类插件，市场一键安装（2026-10-09 起一级入口）" },
  { id: "trace-dev", name: "开发者面板", category: "行政", visibility: "advanced", page: "settings", keywords: ["开发", "调试"], note: "入口在设置页高级模式开关之下" },
];

/* ══════════ 纯函数助手（消费方共用，禁止各写一份过滤逻辑） ══════════ */

/** 注册表索引（id 唯一性在开发期保证；重复时后者胜，消费方无需关心） */
const BY_ID = new Map(NAV_REGISTRY.map((e) => [e.id, e] as const));

export function navEntry(id: string): NavEntry | undefined {
  return BY_ID.get(id);
}

/**
 * 注册表显示名 / 副标题：优先 i18n（`navreg.<id>.name` / `.note`），缺译文回落表里的中文原值。
 *
 * 为什么不在表里直接写 `i18n(...)`：NAV_REGISTRY 是模块级常量，加载时求值会把语言冻住；
 * 这里保留原值、在渲染期解析，切换语言即可刷新。表同时被搜索/身份逻辑使用，结构不动最安全。
 */
export function navName(e: NavEntry): string {
  return tOr(`navreg.${e.id}.name`, e.name);
}

export function navNote(e: NavEntry): string | undefined {
  return e.note ? tOr(`navreg.${e.id}.note`, e.note) : undefined;
}

/** 目录分组名（byCategory 以中文名作分组标识，显示时才翻译）。 */
const CATEGORY_KEY: Record<string, string> = {
  学习: "cat.study",
  日程: "cat.schedule",
  生活: "cat.life",
  预约: "cat.reserve",
  行政: "cat.admin",
  插件: "cat.plugins",
};

export function navCategoryLabel(cat: string): string {
  return CATEGORY_KEY[cat] ? i18n(CATEGORY_KEY[cat]!) : cat;
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

/**
 * 插件功能页 → 目录条目（2026-10-15 用户点名「插件创建的页面也要出现在首页一级程序坞」的
 * 目录侧配套）：插件页只在服务页的「插件功能页」分组与首页程序坞可见，详细功能目录里查不到。
 * 这里做**纯转换**（tab 列表由调用方订阅 subscribePluginTabs 后传入，本函数不订阅、不持有状态），
 * 类别统一记 "插件"，排序沿用注册顺序。
 */
export function pluginCatalogEntries(tabs: readonly { pageKey: string; title: string }[]): NavEntry[] {
  return tabs.map((t) => ({
    id: t.pageKey,
    name: t.title,
    category: "插件",
    visibility: "group",
    page: t.pageKey as Page,
    keywords: ["插件", "功能页", t.title],
    note: i18n("auto.state.navigation.p1"),
  }));
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
    if (navName(e).toLowerCase().includes(query)) return true;
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
