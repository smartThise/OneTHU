import { t as i18n } from "../i18n/index.js";
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
  {id:"contacts",get name() { return i18n("state.navigation.06657c279571"); },category:"行政",visibility:"core",page:"contacts",keywords:["好友","通讯录","组织","名片"],get note() { return i18n("state.navigation.37d169b450b9"); }},
  /* —— 学习 —— */
  { id: "vault", get name() { return i18n("state.navigation.804002a9c49a"); }, category: "行政", visibility: "group", page: "vault", keywords: ["暂存箱", "收纳", "收集", "暂存", "分享口令", "箱子"], get note() { return i18n("state.navigation.ff2ae006e964"); } },
  { id: "learn", get name() { return i18n("state.navigation.aa39cac2b409"); }, category: "学习", visibility: "group", page: "learn", keywords: ["课程", "学堂", "文件", "讨论区"], get note() { return i18n("state.navigation.bb7b63b39fd4"); } },
  { id: "learn-assignments", get name() { return i18n("state.navigation.a1cabc0664cf"); }, category: "学习", visibility: "core", page: "learn-assignments", keywords: ["作业", "DDL", "截止"], get note() { return i18n("state.navigation.ff3eca1db845"); } },
  { id: "learn-notices", get name() { return i18n("state.navigation.bdac834d0ba2"); }, category: "学习", visibility: "group", page: "learn-notices", keywords: ["通知", "课程通知"] },
  { id: "learn-files", get name() { return i18n("state.navigation.fa8fe752727c"); }, category: "学习", visibility: "group", page: "learn-files", keywords: ["课件", "资料", "文件"] },
  { id: "learn-search", get name() { return i18n("state.navigation.62fd8d15cf0a"); }, category: "学习", visibility: "group", page: "learn-search", keywords: ["搜索", "课程"] },
  { id: "learn-semester", get name() { return i18n("state.navigation.231ff6cd9b63"); }, category: "学习", visibility: "buried", page: "learn-semester", keywords: ["学期"] },
  { id: "yuketang-homework", get name() { return i18n("state.navigation.f0cd4338679e"); }, category: "学习", visibility: "core", page: "learn-assignments", needBind: "yuketang", keywords: ["雨课堂", "作业", "主观题"], get note() { return i18n("state.navigation.69102d38703b"); } },
  { id: "oj-homework", get name() { return i18n("state.navigation.34adfacd98bb"); }, category: "学习", visibility: "core", page: "learn-assignments", needBind: "tuoj", keywords: ["OJ", "TUOJ", "Tyche", "DSA"], get note() { return i18n("state.navigation.462b362a41da"); } },
  { id: "info-report", get name() { return i18n("state.navigation.fdcd1bd074c9"); }, category: "学习", visibility: "group", page: "info", params: { infoTab: "report" }, keywords: ["成绩单", "GPA", "学年汇总"] },
  { id: "info-courseinfo", get name() { return i18n("state.navigation.4da04dfef534"); }, category: "学习", visibility: "group", page: "info", params: { infoTab: "courseinfo" }, keywords: ["courseX", "课程简介", "时间地点"] },
  { id: "info-exams", get name() { return i18n("state.navigation.88df420f8207"); }, category: "学习", visibility: "group", page: "info", params: { infoTab: "exams" }, keywords: ["考试", "考场"], boostWindow: { from: "0101", to: "0131" }, get note() { return i18n("state.navigation.10532ed2578b"); } },
  { id: "info-evaluation", get name() { return i18n("state.navigation.14384c9d60cc"); }, category: "学习", visibility: "buried", page: "info", params: { infoTab: "evaluation" }, keywords: ["评估", "评教", "问卷"], boostWindow: { from: "0601", to: "0630" }, get note() { return i18n("state.navigation.21e7aec68918"); } },
  { id: "zhjwxk", get name() { return i18n("state.navigation.fd17d86dd268"); }, category: "学习", visibility: "group", page: "zhjwxk", keywords: ["选课", "退课", "候补"], boostWindow: { from: "0901", to: "0920" }, get note() { return i18n("state.navigation.9b1dc46aaa51"); } },
  /* 清小搭（2026-10-15）：一级页——首页程序坞第九颗球、搜索栏可搜、OH 可打开
     （四处注册见 tools/xiaoda-entries-test.mjs）；note 是搜索结果的副标题，别再说「实验页」。 */
  { id: "xiaoda", get name() { return i18n("state.navigation.b1abb3dc2271"); }, category: "学习", visibility: "group", page: "xiaoda", keywords: ["清小搭", "小搭", "AI 学伴", "智能体", "技能广场", "xiaoda"], get note() { return i18n("state.navigation.f0fc61f517f5"); } },

  /* —— 日程 —— */
  { id: "tasks", get name() { return i18n("state.navigation.52fdbbaeda4c"); }, category: "日程", visibility: "core", page: "tasks", keywords: ["待办", "任务", "提醒", "作业截止"], get note() { return i18n("state.navigation.fe07d17e6d4b"); } },
  { id: "life", get name() { return i18n("state.navigation.15d208d1b4c9"); }, category: "生活", visibility: "core", page: "life", keywords: ["生活", "校园卡", "电费", "洗衣机", "宿舍"], get note() { return i18n("state.navigation.241e209e86bb"); } },
  { id: "schedule", get name() { return i18n("state.navigation.2e3250329028"); }, category: "日程", visibility: "core", page: "schedule", keywords: ["课表", "日程", "上课"], get note() { return i18n("state.navigation.a1e8f8681634"); } },
  { id: "trace", get name() { return i18n("state.navigation.60458dfb4c14"); }, category: "日程", visibility: "group", page: "trace", keywords: ["地图", "导航", "前往"] },
  { id: "info-calendar", get name() { return i18n("state.navigation.4792ab1440aa"); }, category: "日程", visibility: "group", page: "info", params: { infoTab: "calendar" }, keywords: ["校历", "学期安排", "放假"] },

  /* —— 生活 —— */
  { id: "life-card", get name() { return i18n("state.navigation.caf1f095b108"); }, category: "生活", visibility: "core", page: "life", params: { lifeTab: "card" }, keywords: ["校园卡", "余额", "流水", "充值"], get note() { return i18n("state.navigation.082bbf74eb0f"); } },
  { id: "life-electricity", get name() { return i18n("state.navigation.38c1262f3fc9"); }, category: "生活", visibility: "core", page: "life", params: { lifeTab: "elec" }, keywords: ["电费", "宿舍", "充值"], get note() { return i18n("state.navigation.a24d34354353"); } },
  { id: "life-washer", get name() { return i18n("state.navigation.6acfa1db6a62"); }, category: "生活", visibility: "group", page: "life", params: { lifeTab: "washer" }, keywords: ["洗衣", "烘干", "设备"], get note() { return i18n("state.navigation.52f247fc75da"); } },
  { id: "life-dorm", get name() { return i18n("state.navigation.3a74de9a9014"); }, category: "生活", visibility: "group", page: "life", params: { lifeTab: "elec" }, keywords: ["宿舍", "订水"] },
  { id: "life-water", get name() { return i18n("state.navigation.bb8c939d0fcd"); }, category: "生活", visibility: "group", page: "life", params: { lifeTab: "water" }, keywords: ["宿舍", "订水", "水站"] },
  { id: "life-hygiene", get name() { return i18n("state.navigation.41d497d6e07e"); }, category: "生活", visibility: "group", page: "life", params: { lifeTab: "hygiene" }, keywords: ["卫生", "检查"] },
  { id: "life-network", get name() { return i18n("state.navigation.dd94488f5269"); }, category: "生活", visibility: "group", page: "life", params: { lifeTab: "network" }, keywords: ["校园网", "流量", "上网"] },
  { id: "life-invoice", get name() { return i18n("state.navigation.92341cf02c56"); }, category: "生活", visibility: "group", page: "life", params: { lifeTab: "invoice" }, keywords: ["发票", "财务"] },
  { id: "life-payroll", get name() { return i18n("state.navigation.24be2018df29"); }, category: "生活", visibility: "group", page: "life", params: { lifeTab: "payroll" }, keywords: ["工资", "代发", "到账"], get note() { return i18n("state.navigation.2c9595063af1"); } },
  { id: "life-gradincome", get name() { return i18n("state.navigation.336dbe5fd82f"); }, category: "生活", visibility: "group", page: "life", params: { lifeTab: "gradincome" }, keywords: ["助研", "津贴", "收入"], get note() { return i18n("state.navigation.2c9595063af1"); } },

  /* —— 预约 —— */
  { id: "reserve-lib", get name() { return i18n("state.navigation.31c17158ebdb"); }, category: "预约", visibility: "group", page: "reserve", params: { reserveTab: "lib" }, keywords: ["图书馆", "座位", "签到"] },
  { id: "reserve-room", get name() { return i18n("state.navigation.e4d40b4d6759"); }, category: "预约", visibility: "group", page: "reserve", params: { reserveTab: "room" }, keywords: ["研讨间", "申请"] },
  { id: "reserve-classroom", get name() { return i18n("state.navigation.ecc11c8afea8"); }, category: "预约", visibility: "group", page: "reserve", params: { reserveTab: "classroom" }, keywords: ["自习", "空教室", "教室"] },
  { id: "reserve-sports", get name() { return i18n("state.navigation.07a0fa11958e"); }, category: "预约", visibility: "group", page: "reserve", params: { reserveTab: "sports" }, keywords: ["体育", "场馆", "健身房", "游泳"] },
  { id: "reserve-kongjian", get name() { return i18n("state.navigation.e81059e1a712"); }, category: "预约", visibility: "group", page: "reserve", params: { reserveTab: "kongjian" }, keywords: ["公共空间", "活动室"] },
  /* 临时来访人员报备（2026-10-15）：官方出处 = 行在清华小程序「临时来访人员报备」→
     visit.tsinghua.edu.cn 的「亲友来访报备」。id 必须与 atoms.tsx 的 PAGE_ATOMS key 同名
     （否则搜索点了走页面原子、这里写的 params 被静默忽略，落回图书馆座位）。 */
  { id: "reserve-visit", get name() { return i18n("state.navigation.99f047c591bb"); }, category: "预约", visibility: "group", page: "reserve", params: { reserveTab: "visit" }, keywords: ["临时来访", "亲友来访", "访客", "报备", "入校", "参观", "预约来访"], get note() { return i18n("state.navigation.a1c24c7d5716"); } },

  /* —— 行政 —— */
  { id: "mail", get name() { return i18n("state.navigation.73075237fd0f"); }, category: "行政", visibility: "group", page: "mail", needBind: "mail", keywords: ["邮件", "邮箱", "收件"] },
  { id: "cloud", get name() { return i18n("state.navigation.f75562426e77"); }, category: "行政", visibility: "group", page: "cloud", needBind: "cloud", keywords: ["云盘", "Seafile", "文件", "资料库"] },
  { id: "gitlab", name: "GitLab", category: "行政", visibility: "group", page: "gitlab", keywords: ["gitlab", "代码", "仓库", "issue", "合并请求", "流水线", "ci"] },
  { id: "thos", get name() { return i18n("state.navigation.1760b98532ec"); }, category: "行政", visibility: "group", page: "thos", keywords: ["THOS", "服务大厅", "报备", "入校", "亲友"], get note() { return i18n("state.navigation.ecc33b3339e6"); } },
  { id: "info-profile", get name() { return i18n("state.navigation.640803d89773"); }, category: "行政", visibility: "group", page: "info", params: { infoTab: "profile" }, keywords: ["学籍", "个人信息"] },
  { id: "info-fitness", get name() { return i18n("state.navigation.316da6d69b7d"); }, category: "行政", visibility: "group", page: "info", params: { infoTab: "fitness" }, keywords: ["体测", "体质"] },
  { id: "info-news", get name() { return i18n("state.navigation.d39567b2b9f1"); }, category: "行政", visibility: "group", page: "info", params: { infoTab: "news" }, keywords: ["新闻", "通知", "订阅"], get note() { return i18n("state.navigation.39bd4d7ba57c"); } },
  { id: "thubook", name: "THUBook", category: "行政", visibility: "group", page: "thubook", keywords: ["手册", "清华手册"] },
  { id: "otherinfo", get name() { return i18n("state.navigation.4ebe692f5dbb"); }, category: "行政", visibility: "buried", page: "otherinfo", keywords: ["门户", "应用", "目录"] },

  /* —— 高级能力（标准模式不可见，功能完整保留） —— */
  { id: "plugins", get name() { return i18n("state.navigation.4aa7af5b95ec"); }, category: "行政", visibility: "group", page: "plugins", keywords: ["插件", "扩展", "市场"], get note() { return i18n("state.navigation.1bba779cd16c"); } },
  { id: "trace-dev", get name() { return i18n("state.navigation.934dc85b3ca3"); }, category: "行政", visibility: "advanced", page: "settings", keywords: ["开发", "调试"], get note() { return i18n("state.navigation.337f19124f1e"); } },
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
    note: i18n("state.navigation.90b4e4c67fc9"),
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
