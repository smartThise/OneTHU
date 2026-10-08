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
export type NavCategory = "总览" | "学习" | "日程" | "生活" | "预约" | "行政";

/** 可见性分级（§1.2）
 *  · primary 是 P 批（E2/C15）新增的一档：**主 IA 入口**（今日/待办/预约页/生活页/设置）。
 *    它只服务侧栏与抽屉，不进服务页目录（byCategory）也不进命令面板搜索（matchNavQuery）——
 *    那两处的成员与顺序与本次改造前逐条一致，避免波及 ServicesPage / 命令面板。 */
export type NavVisibility = "core" | "group" | "buried" | "advanced" | "primary";

/** 侧栏两档（§9.1）：pin = 首屏常驻；more = 收进「更多」折叠区（保留原分组标签） */
export type NavSidebar = "pin" | "more";

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
  /** G2：这个「旧多 tab 落点」在手机/平板档要去的独立页（PC 侧栏与旧深链仍走 page+params）。
   *  手机分流的唯一映射表 + 唯一判定点在 app.tsx 的 navigate()，消费方不许再各写一套。 */
  soloPage?: Page;
  /** 绑定依赖：未绑定时由 ConnectGate 内联登录后返回原任务 */
  needBind?: BindKey;
  /** 供搜索与 AI 意图匹配（消费方同时匹配 name） */
  keywords: string[];
  /** 时间敏感提升窗口（P2 消费；首版仅声明预留） */
  boostWindow?: BoostWindow;
  /** 一句话说明（目录页副标题 / 推荐区 why 兜底） */
  note?: string;
  /** 侧栏两档（§9.1）：未标注的条目不出现在侧栏（如 learn-assignments、info-report 等子页） */
  sidebar?: NavSidebar;
  /** 选课季提升位（§9.1/§9.2）：选课季判定为真时，这条从「更多」升到常驻 */
  xkSeasonPin?: boolean;
}

/* ══════════ 注册表（§1.2 全量清单；入口映射在 M1 PR 中逐条勾选核对） ══════════ */

export const NAV_REGISTRY: NavEntry[] = [
  /* —— 主 IA（P 批 E2/C15）：此前这五个入口手写在 Layout.tsx 的 NAV 数组里、不在注册表，
     这正是「侧栏与注册表/移动端割裂」的根因。visibility=primary 只服务侧栏与抽屉。 —— */
  { id: "today", name: "今日", category: "总览", visibility: "primary", page: "today", keywords: ["首页", "今日", "概览"], sidebar: "pin" },
  { id: "tasks", name: "待办", category: "总览", visibility: "primary", page: "tasks", keywords: ["待办", "作业", "截止"], sidebar: "pin" },
  { id: "settings", name: "设置", category: "行政", visibility: "primary", page: "settings", keywords: ["设置", "偏好", "主题", "账户"], sidebar: "pin" },
  /* —— 学习 —— */
  { id: "learn", name: "网络学堂", category: "学习", visibility: "group", page: "learn", keywords: ["课程", "学堂", "文件", "讨论区"], note: "本学期课程总览" , sidebar: "pin" },
  { id: "learn-assignments", name: "全部作业", category: "学习", visibility: "core", page: "learn-assignments", keywords: ["作业", "DDL", "截止"], note: "网络学堂与外部作业源合并视图（待办 tab 直达页）" },
  { id: "learn-notices", name: "全部通知", category: "学习", visibility: "group", page: "learn-notices", keywords: ["通知", "课程通知"] },
  { id: "learn-files", name: "全部课程文件", category: "学习", visibility: "group", page: "learn-files", keywords: ["课件", "资料", "文件"] },
  { id: "learn-search", name: "网络学堂搜索", category: "学习", visibility: "group", page: "learn-search", keywords: ["搜索", "课程"] },
  { id: "learn-semester", name: "学期切换", category: "学习", visibility: "buried", page: "learn-semester", keywords: ["学期"] },
  { id: "yuketang-homework", name: "雨课堂作业", category: "学习", visibility: "core", page: "learn-assignments", needBind: "yuketang", keywords: ["雨课堂", "作业", "主观题"], note: "作业区内未绑定时由 ConnectGate 内联引导（§4.3）" },
  { id: "oj-homework", name: "OJ 作业", category: "学习", visibility: "core", page: "learn-assignments", needBind: "tuoj", keywords: ["OJ", "TUOJ", "Tyche", "DSA"], note: "TUOJ 系 / Tyche / DSA 外部作业源；按源分别绑定" },
  /* 信息门户聚合页（旧 NAV 手写的「信息」；注册表此前只有 info-* 子页，没有 page=info 的条目）。
     visibility=primary：只服务侧栏，不进服务页目录（目录成员与改造前逐条一致）。 */
  { id: "info", name: "信息", category: "学习", visibility: "primary", page: "info", keywords: ["信息", "门户", "成绩", "考试", "课程信息"], sidebar: "more" },
  { id: "info-report", name: "成绩", category: "学习", visibility: "group", page: "info", params: { infoTab: "report" }, soloPage: "grade", keywords: ["成绩单", "GPA", "学年汇总"] },
  { id: "info-courseinfo", name: "课程信息", category: "学习", visibility: "group", page: "info", params: { infoTab: "courseinfo" }, soloPage: "course-info", keywords: ["courseX", "课程简介", "时间地点"] },
  { id: "info-exams", name: "考试安排", category: "学习", visibility: "group", page: "info", params: { infoTab: "exams" }, soloPage: "exams", keywords: ["考试", "考场"], boostWindow: { from: "0101", to: "0131" }, note: "考试周可提升（P2 消费 boostWindow）" },
  { id: "info-evaluation", name: "教学评估", category: "学习", visibility: "buried", page: "info", params: { infoTab: "evaluation" }, soloPage: "evaluation", keywords: ["评估", "评教", "问卷"], boostWindow: { from: "0601", to: "0630" }, note: "评估季同理" },
  { id: "zhjwxk", name: "选课", category: "学习", visibility: "group", page: "zhjwxk", keywords: ["选课", "退课", "候补"], boostWindow: { from: "0901", to: "0920" }, note: "选课季临时提升 group→今日推荐" , sidebar: "more", xkSeasonPin: true },
  /* G2：旧选课页移动端双页签各自独立成页（PC 仍进旧双栏页） */
  { id: "xk-find", name: "课程查找", category: "学习", visibility: "group", page: "zhjwxk", params: { xkTab: "find" }, soloPage: "xk-find", keywords: ["选课", "课程", "查找", "检索", "筛选"], note: "选课季可提升（P2 同 zhjwxk）" },
  { id: "xk-manage", name: "选课管理", category: "学习", visibility: "group", page: "zhjwxk", params: { xkTab: "manage" }, soloPage: "xk-manage", keywords: ["选课", "已选", "候补", "队列", "志愿"], note: "选课季可提升（P2 同 zhjwxk）" },

  /* —— 日程 —— */
  { id: "schedule", name: "日程", category: "日程", visibility: "core", page: "schedule", keywords: ["课表", "日程", "上课"], note: "今日页「下一节课」卡数据来源" , sidebar: "pin" },
  { id: "trace", name: "寻迹", category: "日程", visibility: "group", page: "trace", keywords: ["地图", "导航", "前往"] , sidebar: "more" },
  { id: "info-calendar", name: "校历", category: "日程", visibility: "group", page: "info", params: { infoTab: "calendar" }, soloPage: "calendar", keywords: ["校历", "学期安排", "放假"] },

  /* —— 生活 —— */
  { id: "reserve", name: "预约", category: "预约", visibility: "primary", page: "reserve", keywords: ["预约", "座位", "研讨间", "体育"], sidebar: "pin" },
  { id: "life", name: "生活", category: "生活", visibility: "primary", page: "life", keywords: ["生活", "校园卡", "电费", "洗衣机"], sidebar: "pin" },
  { id: "life-card", name: "校园卡", category: "生活", visibility: "core", page: "life", params: { lifeTab: "card" }, soloPage: "campus-card", keywords: ["校园卡", "余额", "流水", "充值"], note: "今日余额速览条来源之一" },
  { id: "life-electricity", name: "宿舍电费", category: "生活", visibility: "core", page: "life", params: { lifeTab: "dorm", dormSection: "ele" }, soloPage: "dorm", keywords: ["电费", "宿舍", "充值"], note: "今日余额速览条来源之一" },
  { id: "life-washer", name: "洗衣机", category: "生活", visibility: "group", page: "life", params: { lifeTab: "washer" }, soloPage: "washer", keywords: ["洗衣", "烘干", "设备"], note: "宿舍楼填写后可上今日卡（P2）" },
  { id: "life-dorm", name: "宿舍", category: "生活", visibility: "group", page: "life", params: { lifeTab: "dorm" }, soloPage: "dorm", keywords: ["宿舍", "订水"] },
  { id: "life-hygiene", name: "卫生成绩", category: "生活", visibility: "group", page: "life", params: { lifeTab: "hygiene" }, soloPage: "hygiene", keywords: ["卫生", "检查"] },
  { id: "life-network", name: "校园网", category: "生活", visibility: "group", page: "life", params: { lifeTab: "network" }, soloPage: "campus-net", keywords: ["校园网", "流量", "上网"] },
  { id: "life-invoice", name: "电子发票", category: "生活", visibility: "group", page: "life", params: { lifeTab: "invoice" }, soloPage: "invoice", keywords: ["发票", "财务"] },
  { id: "life-payroll", name: "银行代发", category: "生活", visibility: "group", page: "life", params: { lifeTab: "payroll" }, soloPage: "payroll", keywords: ["工资", "代发", "到账"], note: "适用人群在描述中注明，不做入口屏蔽" },
  { id: "life-gradincome", name: "研究生收入", category: "生活", visibility: "group", page: "life", params: { lifeTab: "gradincome" }, soloPage: "grad-income", keywords: ["助研", "津贴", "收入"], note: "适用人群在描述中注明，不做入口屏蔽" },

  /* —— 预约 —— */
  { id: "reserve-lib", name: "图书馆座位", category: "预约", visibility: "group", page: "reserve", params: { reserveTab: "lib" }, soloPage: "lib-seat", keywords: ["图书馆", "座位", "签到"] },
  { id: "reserve-room", name: "研讨间", category: "预约", visibility: "group", page: "reserve", params: { reserveTab: "room" }, soloPage: "lib-room", keywords: ["研讨间", "申请"] },
  { id: "reserve-classroom", name: "空教室", category: "预约", visibility: "group", page: "reserve", params: { reserveTab: "classroom" }, soloPage: "classroom", keywords: ["自习", "空教室", "教室"] },
  { id: "reserve-sports", name: "体育预约", category: "预约", visibility: "group", page: "reserve", params: { reserveTab: "sports" }, soloPage: "sports", keywords: ["体育", "场馆", "健身房", "游泳"] },
  { id: "reserve-kongjian", name: "公共空间", category: "预约", visibility: "group", page: "reserve", params: { reserveTab: "kongjian" }, soloPage: "public-space", keywords: ["公共空间", "活动室"] },

  /* —— 行政 —— */
  { id: "mail", name: "邮箱", category: "行政", visibility: "group", page: "mail", needBind: "mail", keywords: ["邮件", "邮箱", "收件"] , sidebar: "more" },
  { id: "cloud", name: "云盘", category: "行政", visibility: "group", page: "cloud", needBind: "cloud", keywords: ["云盘", "Seafile", "文件", "资料库"] , sidebar: "more" },
  { id: "thos", name: "在线服务", category: "行政", visibility: "group", page: "thos", keywords: ["THOS", "服务大厅", "报备", "入校", "亲友"], note: "亲友入校报备前置顶（P2 时间敏感项）" , sidebar: "more" },
  { id: "info-profile", name: "个人信息", category: "行政", visibility: "group", page: "info", params: { infoTab: "profile" }, soloPage: "profile", keywords: ["学籍", "个人信息"] },
  { id: "info-fitness", name: "体测", category: "行政", visibility: "group", page: "info", params: { infoTab: "fitness" }, soloPage: "fitness", keywords: ["体测", "体质"] },
  { id: "info-news", name: "新闻", category: "行政", visibility: "group", page: "info", params: { infoTab: "news" }, soloPage: "news", keywords: ["新闻", "通知", "订阅"], note: "今日取前 3 条" },
  { id: "thubook", name: "Thubook", category: "行政", visibility: "group", page: "thubook", keywords: ["手册", "清华手册"] , sidebar: "more" },
  { id: "otherinfo", name: "其他 Info 应用", category: "行政", visibility: "buried", page: "otherinfo", keywords: ["门户", "应用", "目录"] , sidebar: "more" },

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
  /* primary 是侧栏专档：不进服务页目录（目录成员与改造前逐条一致） */
  return NAV_REGISTRY.filter((e) => e.category === cat && e.visibility !== "advanced" && e.visibility !== "primary");
}

/* ══════════ 侧栏两档（§9.1，P 批 E2/C15）══════════
 * 「常驻」与「更多」**来自同一处定义**（同一份注册表 + 同一个判定函数），
 * 侧栏不再持有任何手写条目清单。选课（zhjwxk）在选课季升入常驻。 */
export function sidebarPinned(xkSeason = false): NavEntry[] {
  return NAV_REGISTRY.filter((e) => e.sidebar === "pin" || (xkSeason && e.xkSeasonPin === true));
}
export function sidebarMore(xkSeason = false): NavEntry[] {
  return NAV_REGISTRY.filter((e) => e.sidebar === "more" && !(xkSeason && e.xkSeasonPin === true));
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
    if (e.visibility === "primary") return false; // 主 IA 入口不进命令面板（成员与改造前一致）
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

/* ── C6：顶栏标题的唯一映射表 ──
   从前顶栏标题是 Layout 里的一串三元表达式 + 「先命中导航项名」的查找，缺项就退回
   默认字样——`settings` 正因此显示成「OneTHU」。现在改成本表：
   - `Record<Exclude<Page, `plugin:${string}`>, string>` 让 TypeScript 做穷尽检查，
     新增路由不补标题就编译不过，「漏一项」这类退化不可能再溜进来；
   - 插件 tab（`plugin:<id>:<tab>`）的名字来自插件注册表，不进静态表；
   - 表只此一处，Layout 与页面组件都从 `pageTitle()` 取值。 */
export const PAGE_TITLES: Record<Exclude<Page, `plugin:${string}`>, string> = {
  today: "今日",
  tasks: "待办",
  learn: "网络学堂",
  schedule: "日程",
  trace: "寻迹",
  mail: "邮箱",
  cloud: "云盘",
  thubook: "THUbook",
  info: "信息",
  life: "生活",
  reserve: "预约",
  zhjwxk: "选课",
  thos: "在线服务",
  otherinfo: "其他 Info 应用",
  settings: "设置",
  mine: "我的",
  plugins: "插件",
  services: "服务",
  favs: "收藏",
  folder: "收藏夹",
  "learn-course": "课程详情",
  "learn-assignments": "全部作业",
  "learn-notices": "全部通知",
  "learn-files": "全部课程文件",
  "learn-search": "网络学堂搜索",
  "learn-semester": "学期切换",
  "learn-assignment-detail": "作业详情",
  "learn-notice-detail": "通知详情",
  "learn-forum-thread": "讨论区",
  "learn-file-detail": "文件详情",
  "learn-ykt-detail": "雨课堂作业",
  /* G2 独立页：标题就是 tab 自己的名字（不再是「信息」「生活」这类聚合页名） */
  grade: "成绩",
  fitness: "体测成绩",
  exams: "考试",
  evaluation: "教学评估",
  calendar: "校历",
  news: "新闻",
  profile: "个人信息",
  "course-info": "课程信息",
  dorm: "宿舍",
  washer: "洗衣机",
  hygiene: "卫生成绩",
  "campus-card": "校园卡",
  invoice: "电子发票",
  payroll: "银行代发",
  "grad-income": "研究生收入",
  "campus-net": "校园网",
  "lib-seat": "图书馆座位",
  "lib-room": "研讨间",
  classroom: "空教室",
  sports: "体育预约",
  "public-space": "公共空间",
  "xk-find": "课程查找",
  "xk-manage": "选课管理",
};

/**
 * G2：旧多 tab 落点 → 独立页（手机/平板档）。返回 null 表示这条落点没有独立页
 * （例如预约页的「更多场馆」、选课聚合页本身），保持旧页不动。
 *
 * 匹配口径：注册表里 `page` 相同、`params` 是该次导航参数的**子集**即算命中；
 * 多条命中时取「最具体」的那条（参数键最多）——`life-electricity`（lifeTab=dorm +
 * dormSection=ele）优先于 `life-dorm`（只有 lifeTab），两者独立页相同，但更具体的
 * 条目将来若指向别的独立页也不会被泛匹配抢走。
 */
export function soloTargetFor(page: Page, params?: LearnNav | null): Page | null {
  if (!params) return null;
  let best: { soloPage: Page; keys: number } | null = null;
  for (const e of NAV_REGISTRY) {
    if (!e.soloPage || !e.params || e.page !== page) continue;
    const entries = Object.keys(e.params) as Array<keyof LearnNav>;
    if (!entries.length) continue;
    const hit = entries.every((k) => e.params![k] === params[k]);
    if (!hit) continue;
    if (!best || entries.length > best.keys) best = { soloPage: e.soloPage, keys: entries.length };
  }
  return best?.soloPage ?? null;
}

/** 顶栏/页内标题的唯一取值口（C6）。插件动态 tab 由插件注册表给名，这里只兜底。 */
export function pageTitle(page: Page): string {
  if (page.startsWith("plugin:")) return "插件";
  return PAGE_TITLES[page as Exclude<Page, `plugin:${string}`>];
}
