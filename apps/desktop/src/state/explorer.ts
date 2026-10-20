import { experienceMode, isSimpleLike, navigateSimple } from "./experienceMode.js";
/**
 * Explorer（工作空间革命 · dev-explorer）核心状态机：标签页 / 工作区 / 设置浮层。
 *
 * 交互模型（2026-10-12 提案 + 用户六点补充）：
 * - 首页是特殊标签页：默认进入、不可删除、不可多开（id 恒为 "home"）；
 * - 其余每个标签页 = 一个独立工作实例；**同一实例已打开时默认聚焦复用，不无限新建**；
 *   只有「复制」（顶栏按钮 / 标签右键 / 页面右键-长按）才 forceNew 出第二个实例；
 * - **每个标签页有自己独立的路由上下文**（TabHost 内 Ctx.Provider 覆盖 page/navParams/
 *   navigate）——两个网络学堂 tab 各点各的课程，绝不互相串台；
 * - navigate() 的语义升级：页内标签中 = 当前标签页内导航；在首页 = 打开目标
 *   （已存在则复用）；settings / plugins 永远不是标签页 —— 走「设置浮层」；
 * - OneGO 工作区：标签页可归属（workspaceId），抽屉按工作区分组；存工作区=快照+归属，
 *   一键恢复；工作区删除时成员归属清空；
 * - 设置浮层（settings/plugins/oh）高于任何标签页；
 * - 整个标签列表 + 活动页 + 工作区持久化（localStorage），启动恢复。
 */
import { useSyncExternalStore } from "react";
import { loadBoard } from "./board.js";
import { openOnePage } from "./onePage.js";
import { t } from "../i18n/index.js";
import type { LearnNav, Page } from "./app.js";
import { topLevelPage } from "./app.js";
import { navName, NAV_REGISTRY } from "./navigation.js";

/* ══════════ 类型 ══════════ */

/** 标签页：一个独立工作实例。home 是恒存在的特殊页。 */
export interface ExplorerTab {
  id: string;
  kind: "home" | "page";
  /** kind=page 时有效；home 恒为 "homepage"（页面 id 就叫 homepage，用户 2026-10-15 定名：
   *  旧名 today 连同那张旧卡片页一起删干净了 —— 留着只会误导人以为还有"今日页"） */
  page: Page;
  params: LearnNav | null;
  /** 打开时定下的静态标题（完整路径由 state/tabTitles.ts 数据感知解析） */
  title: string;
  /** 归属的 OneGO 工作区（null=未分组）；TabDrawer 按它分组 */
  workspaceId: string | null;
  createdAt: number;
  lastActiveAt: number;
}

/** OneGO 工作区：一组标签页的快照（可一键恢复） */
export interface ExplorerWorkspace {
  id: string;
  name: string;
  createdAt: number;
  tabs: Array<{ page: Page; params: LearnNav | null; title: string }>;
  /** 活工作区（标签栏底板）：颜色 / logo / 折叠态；成员 = 标签的 workspaceId 归属 */
  color?: string;
  icon?: string;
  collapsed?: boolean;
  live?: boolean;
}

/** 工作区底板可选颜色（克制色板，底板用浅色 alpha 叠在标签栏上） */
export const WORKSPACE_COLORS = ["#5b8def", "#22c55e", "#f59e0b", "#f25a5a", "#a855f7", "#14b8a6", "#64748b"] as const;
/** 工作区 logo 候选（图标键，由 TabStrip 映射到 Icons） */
export const WORKSPACE_ICONS = ["folder", "star", "pin", "book", "flag", "orb", "learn", "info"] as const;

/** 设置浮层入口（高于任何标签页；Entry 语义与旧 Layout 一致） */
export type OverlayEntry = "profile" | "settings" | "plugins" | "oh";

interface ExplorerState {
  /** 不含 home（home 隐式恒在，渲染时拼在最前） */
  tabs: ExplorerTab[];
  activeId: string; // "home" 或某 tab id
  workspaces: ExplorerWorkspace[];
}

/* ══════════ 常量 ══════════ */

export const HOME_TAB_ID = "home";
const STORE_KEY = "onethu.explorer.v2";
const MAX_TABS = 30;
/** 设置/插件不是标签页（用户 2026-10-12 拍板：高于任何标签页） */
const OVERLAY_PAGES: ReadonlySet<string> = new Set(["settings", "plugins"]);
/**
 * 插件 tab 强制单实例：插件容器按 pageKey 登记（tabs.ts setTabRoot），多开会抢同一
 * DOM 容器互踩状态——这是插件架构约束，不是产品选择。
 */
function isSingletonPage(page: Page): boolean {
  return page.startsWith("plugin:");
}
/* ══════════ 模块级 store ══════════ */

const listeners = new Set<() => void>();

/** 已知的可导航一级页（深链白名单 + 存档校验共用一处；2026-10-15 抽出，原先两处各写一份） */
const KNOWN_PAGES: ReadonlySet<string> = new Set([
  "homepage", "learn", "schedule", "trace", "mail", "cloud", "thubook", "info", "life",
  "reserve", "zhjwxk", "thos", "otherinfo", "gitlab", "folder", "tasks", "services", "favs",
  "boards", "board", "vault", "contacts", "org", "xiaoda",
  /* 网络学堂子页/详情页：OH 的 navigate 描述一直宣称支持这些页面，但以前不在白名单里，
     首页标签下 navigate 会被 openTab 判"未知页"直接回首页 → OH 假报成功。 */
  "learn-course", "learn-assignments", "learn-notices", "learn-files", "learn-search", "learn-semester",
  "learn-assignment-detail", "learn-notice-detail", "learn-forum-thread", "learn-file-detail",
  "learn-ykt-detail", "learn-ykt-course",
]);

// Initialize after the whitelist: loadStore validates restored tabs against it.
let state: ExplorerState = loadStore();

/** 是否是可导航页（插件动态 tab 也算）；供插件门面与 OH 共用，别再手写第二份白名单。 */
export function isKnownPage(page: string): boolean {
  return page.startsWith("plugin:") || KNOWN_PAGES.has(page);
}

function loadStore(): ExplorerState {
  const fallback: ExplorerState = { tabs: [], activeId: HOME_TAB_ID, workspaces: [] };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<ExplorerState>;
    const tabs = Array.isArray(p.tabs)
      ? p.tabs
          .filter((t): t is ExplorerTab => !!t && typeof t.id === "string" && typeof t.page === "string" && t.kind === "page")
          /* 存档只恢复到"认得的页面"（KNOWN_PAGES）：历史改名遗留的旧 page 值一律丢弃，
             不复产一个渲染不出来的空标签。 */
          .filter((t) => KNOWN_PAGES.has(t.page)) // 存档里的未知页 id（历史改名遗留）直接丢弃，不复产一个渲染不出来的空标签
          /* 组织页是「某个组织」的页面：没有 orgId 的裸 org 标签（早期入口遗留）不恢复，
             否则会得到一个看起来莫名其妙、点不进任何组织的空组织页。 */
          .filter((t) => t.page !== "org" || Boolean((t.params as { orgId?: string } | null)?.orgId))
          .map((t) => ({
            ...t,
            workspaceId: typeof t.workspaceId === "string" ? t.workspaceId : null, // 旧版本补字段
            /* 首页标签的存档值一律归一成 homepage，避免"看着有标签、判定页面的分支认不出它"。 */
            page: t.kind === "home" ? "homepage" : t.page,
          }))
          .slice(0, MAX_TABS)
      : [];
    return {
      tabs,
      activeId: typeof p.activeId === "string" ? p.activeId : HOME_TAB_ID,
      workspaces: Array.isArray(p.workspaces) ? p.workspaces.slice(0, 50) : [],
    };
  } catch {
    return fallback;
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ tabs: state.tabs, activeId: state.activeId, workspaces: state.workspaces }));
  } catch {
    /* 隐私模式/配额：丢持久化不影响本会话 */
  }
}

function emit(): void {
  for (const f of listeners) f();
}

function setState(next: ExplorerState): void {
  state = next;
  persist();
  emit();
}

export function subscribeExplorer(f: () => void): () => void {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

export function explorerSnapshot(): ExplorerState {
  return state;
}

/* ══════════ 查询 ══════════ */

/** 首页标签页（模块级单例：getSnapshot 必须返回稳定引用，否则 useSyncExternalStore 死循环） */
const HOME_TAB: ExplorerTab = { id: HOME_TAB_ID, kind: "home", page: "homepage", params: null, title: "首页", workspaceId: null, createdAt: 0, lastActiveAt: 0 };

/** 全部标签页（home 恒在最前；home 是稳定单例，数组本身仅供渲染期使用） */
export function allTabs(): ExplorerTab[] {
  return [HOME_TAB, ...state.tabs];
}

export function getTab(id: string): ExplorerTab | null {
  if (id === HOME_TAB_ID) return HOME_TAB;
  return state.tabs.find((t) => t.id === id) ?? null;
}

export function activeTab(): ExplorerTab {
  return getTab(state.activeId) ?? HOME_TAB; // 恒有 home（单例），不会为空
}

export function activeTabId(): string {
  return getTab(state.activeId) ? state.activeId : HOME_TAB_ID;
}

/* ══════════ 实例身份（复用/复制的判定核心） ══════════ */

/**
 * 实例身份 = **完整路径**（用户定案：必须与当前路径一模一样才复用）：
 * page + 排序后的全部参数（含栏目/视图参数）。「信息·新闻」「信息·成绩」是两个 tab；
 * 「网络学堂某门课」「寻迹」各是一个实例——同路径已打开才复用。
 */
export function instanceKeyOf(page: Page, params: LearnNav | null): string {
  const parts: string[] = [];
  const p = params as Record<string, unknown> | null;
  if (p) {
    for (const k of Object.keys(p).sort()) {
      const v = p[k];
      if (v !== undefined && v !== null && v !== "") parts.push(`${k}=${String(v)}`);
    }
  }
  return page + (parts.length ? `?${parts.join("&")}` : "");
}

/**
 * 找已打开的同实例标签页（不含 home；singleton 页按 page 精确匹配）。
 * 工作区里的标签（workspaceId 非空）永不被复用——既不被工作区外的入口复用，
 * 也不跨工作区复用，避免把别人的底板里的标签拎出来「聚焦」。
 */
export function findInstanceTab(page: Page, params: LearnNav | null): ExplorerTab | null {
  const free = state.tabs.filter((t) => t.workspaceId == null);
  if (isSingletonPage(page)) return free.find((t) => t.page === page) ?? null;
  const key = instanceKeyOf(page, params);
  return free.find((t) => instanceKeyOf(t.page, t.params) === key) ?? null;
}

/* ══════════ 标题（静态兜底；完整路径在 state/tabTitles.ts 数据感知解析） ══════════ */

/**
 * 页级静态名：**值是 i18n 键**，统一在 titleOf 里翻译。
 * 不能在模块级求值（那会把第一次的语言永久冻住，切语言后标签条不刷新）。
 */
const PAGE_TITLES: Partial<Record<Page, string>> = {
  board: "page.board",
  boards: "page.boards",
  "learn-course": "page.learnCourse",
  "learn-assignments": "page.learnAssignments",
  "learn-notices": "page.learnNotices",
  "learn-files": "page.learnFiles",
  "learn-search": "page.learnSearch",
  "learn-semester": "page.learnSemester",
  "learn-assignment-detail": "page.learnAssignmentDetail",
  "learn-notice-detail": "page.learnNoticeDetail",
  "learn-forum-thread": "page.learnForumThread",
  "learn-file-detail": "page.learnFileDetail",
  "learn-ykt-detail": "page.learnYktDetail",
  folder: "page.folder",
  tasks: "page.tasks",
  services: "page.services",
  favs: "page.favs",
  xiaoda: "page.xiaoda",
  org: "page.org",
};

/** 聚合页栏目的中文短名（tab 可深链到具体栏目：信息-新闻，但主题仍是信息） */
/* 一级页标题 + 子栏目名：与各页面原始栏目 TABS 一致（信息页/生活页/预约页）。
 * 不得自行缩写（此前「体测成绩→体测」「校历→日历」「图书馆座位→图书馆」等缩略已撤回）。 */
const PAGE_HEADER: Partial<Record<Page, string>> = { info: "page.info", life: "page.life", reserve: "page.reserve" };
const TAB_SUFFIX: Record<string, Record<string, string>> = {
  info: { report: "sub.info.report", fitness: "sub.info.fitness", exams: "sub.info.exams", evaluation: "sub.info.evaluation", calendar: "sub.info.calendar", news: "sub.info.news", profile: "sub.info.profile", courseinfo: "sub.info.courseinfo" },
  life: { dorm: "sub.life.dorm", washer: "sub.life.washer", hygiene: "sub.life.hygiene", card: "sub.life.card", invoice: "sub.life.invoice", payroll: "sub.life.payroll", gradincome: "sub.life.gradincome", network: "sub.life.network" },
  reserve: { lib: "sub.reserve.lib", libroom: "sub.reserve.libroom", classroom: "sub.reserve.classroom", sports: "sub.reserve.sports", kongjian: "sub.reserve.kongjian" },
};

/** 一级页 → 文案键（与 Layout.NAV 的 labelKey 同语义；标题条与程序坞用同一套名字）。 */
const NAV_PAGE_KEY: Record<string, string> = {
  tasks: "nav.tasks", learn: "nav.learn", schedule: "nav.schedule", trace: "nav.trace",
  contacts: "nav.contacts", mail: "nav.mail", cloud: "nav.cloud", gitlab: "nav.gitlab",
  thubook: "nav.thubook", xiaoda: "nav.xiaoda", info: "nav.info", life: "nav.life",
  reserve: "nav.reserve", zhjwxk: "nav.zhjwxk", thos: "nav.thos", otherinfo: "nav.otherinfo",
};

export function titleOf(page: Page, params?: LearnNav | null, fallback?: string): string {
  if (fallback) return fallback;
  if (page === "homepage") return t("page.home");
  const headerKey = PAGE_HEADER[page];
  if (headerKey) {
    const suffixes = TAB_SUFFIX[page] ?? {};
    const sub = page === "info" ? params?.infoTab : page === "life" ? params?.lifeTab : params?.reserveTab;
    const suffixKey = sub ? suffixes[sub] : undefined;
    return suffixKey ? `${t(headerKey)} · ${t(suffixKey)}` : t(headerKey);
  }
  const navKey = NAV_PAGE_KEY[page];
  if (navKey) return t(navKey);
  const staticKey = PAGE_TITLES[page];
  if (staticKey) return t(staticKey);
  const reg = NAV_REGISTRY.find((e) => e.page === page);
  return reg ? navName(reg) : t("page.unknown");
}

/* ══════════ hash（由本模块统一写；外部深链 = 开新标签页） ══════════ */

/** 本模块自己写入的 hash：hashchange 事件对账后消费，防旧事件误开标签页 */
const ownHashes = new Set<string>();

function writeHashFor(tab: ExplorerTab): void {
  const h =
    tab.kind === "home"
      ? "#/homepage"
      : tab.page === "folder" && tab.params?.folderId
        ? `#/folder/${tab.params.folderId}`
        : tab.page === "board"
          ? `#/board${activeBoardIdOf() ? "/" + activeBoardIdOf() : ""}` /* 板 id 进 hash：白板可分享/可冷启动恢复 */
          : `#/${topLevelPage(tab.page)}`;
  if (location.hash === h) return;
  ownHashes.add(h);
  if (ownHashes.size > 8) {
    const first = ownHashes.values().next().value;
    if (first) ownHashes.delete(first);
  }
  location.hash = h;
}

/** 当前生效板的 id（写 hash 用；读不到就空串 → 退化成 #/board） */
function activeBoardIdOf(): string {
  try {
    const doc = loadBoard();
    return doc.boards.find((b) => b.id === doc.activeBoardId)?.id ?? "";
  } catch {
    return "";
  }
}

/**
 * `#/board/<板 id>` 深链（2026-10-15 补，对齐 #/folder/<id> 的既有先例）：
 * 把那块板设为当前板再开白板页——这样白板标签可分享、冷启动能恢复。
 * 认出来了返回 true（调用方不要再按"一级页名单"走一遍）。
 */
function openBoardFromHash(hash: string): boolean {
  const m = /^#\/board\/(board\.[A-Za-z0-9_.]+)$/.exec(hash);
  if (!m) return false;
  const id = m[1] ?? "";
  if (!id) return false;
  let title = "白板";
  try {
    title = loadBoard().boards.find((b) => b.id === id)?.name ?? title;
  } catch {
    /* 读不到就用兜底标题 */
  }
  openOnePage(id);
  openTab("board", null, { title });
  return true;
}

/** AppProvider 挂载时注册一次：处理浏览器前进/后退与外部深链 */
export function initExplorerHashBridge(): () => void {
  const onHash = (ev: HashChangeEvent): void => {
    const target = (() => {
      try {
        return new URL(ev.newURL).hash;
      } catch {
        return location.hash;
      }
    })();
    if (ownHashes.has(target)) {
      ownHashes.delete(target);
      return;
    }
    // 外部深链（书签/插件/恢复的 hash）：开成独立标签页（复用已开实例）
    const m = /^#\/folder\/(f_[A-Za-z0-9_]+)$/.exec(target);
    if (m) {
      openTab("folder", { folderId: m[1] });
      return;
    }
    if (openBoardFromHash(target)) return;
    const h = target.replace(/^#\/?/, "");
    const known = KNOWN_PAGES.has(h);
    if (h && known) openTab(h as Page);
  };
  addEventListener("hashchange", onHash);
  return () => removeEventListener("hashchange", onHash);
}

/** 启动深链：hash 里带着非首页目标时补开一个标签页（只该在 AppProvider 挂载时调一次） */
export function openTabFromBootHash(): void {
  const m = /^#\/folder\/(f_[A-Za-z0-9_]+)$/.exec(location.hash);
  if (m) {
    openTab("folder", { folderId: m[1] });
    return;
  }
  if (openBoardFromHash(location.hash)) return;
  const h = location.hash.replace(/^#\/?/, "");
  if (!h || h === "homepage") return;
  const known = KNOWN_PAGES.has(h);
  if (known) openTab(h as Page);
}

/* ══════════ 标签页操作 ══════════ */

let seq = 0;
function newTabId(): string {
  seq += 1;
  return `t_${Date.now().toString(36)}_${seq.toString(36)}`;
}

/** 本机使用统计（今日页「最近使用」的数据源；动态 import 回避 app↔atoms 模块环） */
function recordUse(page: Page, params: LearnNav | null): void {
  void import("./atoms.js")
    .then((m) => m.recordPageAtomUse(page, params))
    .catch(() => undefined);
}

export interface OpenTabOptions {
  title?: string;
  /** **强制新建实例**（复制按钮 / 右键-长按「在新标签页打开」用）；默认复用已开实例 */
  forceNew?: boolean;
  /** 新标签页归属的工作区 */
  workspaceId?: string | null;
  /** 是否聚焦新标签页（工作区批量恢复时传 false，最后统一聚焦） */
  activate?: boolean;
}

/**
 * 打开标签页（入口级导航：首页目录/快捷入口/OneGO/搜索/悬浮球都用它）。
 * - page="homepage" → 聚焦首页（首页不可多开）；
 * - settings/plugins → 设置浮层（不是标签页）；
 * - **默认复用**：同实例已打开 → 聚焦它（用户拍板：不要无限新建一模一样的标签页）；
 *   只有 forceNew（「复制」）才出第二个实例。
 */
export function openTab(page: Page, params?: LearnNav | null, opts?: OpenTabOptions): string {
  if (isSimpleLike(experienceMode())) {
    if (OVERLAY_PAGES.has(page)) openSettings("settings");
    else navigateSimple(isKnownPage(page) ? page : "homepage", params);
    return "simple";
  }
  /* 未知页面 id 一律回首页（2026-10-15）：历史存档/旧入口里可能还残留改名前的老 id，
     与其开出一个 renderPage 渲染不出来的空标签，不如明确回首页。 */
  if (!isKnownPage(page)) {
    focusTab(HOME_TAB_ID);
    return HOME_TAB_ID;
  }
  if (page === "homepage" && !opts?.forceNew) {
    focusTab(HOME_TAB_ID);
    return HOME_TAB_ID;
  }
  if (OVERLAY_PAGES.has(page)) {
    openSettings(page === "settings" ? "settings" : "plugins");
    return "";
  }
  if (opts?.forceNew !== true) {
    const hit = findInstanceTab(page, params ?? null);
    if (hit) {
      focusTab(hit.id);
      return hit.id;
    }
  }
  const tab: ExplorerTab = {
    id: newTabId(),
    kind: "page",
    page,
    params: params ?? null,
    title: titleOf(page, params, opts?.title),
    workspaceId: opts?.workspaceId ?? null,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
  const tabs = [...state.tabs, tab].slice(-MAX_TABS);
  setState({ ...state, tabs, activeId: opts?.activate === false ? state.activeId : tab.id });
  writeHashFor(tab);
  recordUse(page, tab.params);
  return tab.id;
}

/** 复制当前标签页（顶栏「复制」按钮 / 标签右键 / 页面右键-长按共用）：
 *  一级二级三级页都能复制成独立实例，新实例聚焦。 */
export function duplicateTab(id: string): string {
  const tab = getTab(id);
  if (!tab || tab.kind === "home") return "";
  return openTab(tab.page, tab.params, { title: tab.title, forceNew: true });
}

export function focusTab(id: string): boolean {
  if (isSimpleLike(experienceMode())) {
    const target = getTab(id); if (!target) return false;
    navigateSimple(target.page, target.params); return true;
  }
  const tab = getTab(id);
  if (!tab) return false;
  if (state.activeId === id) {
    writeHashFor(tab); // hash 可能被外部改过，对齐
    return true;
  }
  const tabs = state.tabs.map((t) => (t.id === id ? { ...t, lastActiveAt: Date.now() } : t));
  setState({ ...state, tabs, activeId: id });
  writeHashFor(tab);
  return true;
}

export function closeTab(id: string): boolean {
  if (id === HOME_TAB_ID) return false; // 首页不可关
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return false;
  const tabs = state.tabs.filter((t) => t.id !== id);
  let activeId = state.activeId;
  if (activeId === id) {
    // 关掉活动页 → 优先右侧，否则左侧，否则首页
    activeId = tabs[idx]?.id ?? tabs[idx - 1]?.id ?? HOME_TAB_ID;
  }
  setState({ ...state, tabs, activeId });
  const at = getTab(activeId);
  if (at) writeHashFor(at);
  return true;
}

/** 关闭其他（首页除外） */
export function closeOtherTabs(keepId: string): void {
  const keep = getTab(keepId);
  if (!keep) return;
  const tabs = state.tabs.filter((t) => t.id === keepId);
  setState({ ...state, tabs, activeId: keepId });
  writeHashFor(keep);
}

/** 标签页内导航（更新 page/params，标签身份不变——工作上下文保留）。
 *  只作用于该标签页自己的路由上下文（TabHost 的 Ctx 覆盖），互不串台。 */
export function navigateInTab(id: string, page: Page, params?: LearnNav | null, title?: string): void {
  if (isSimpleLike(experienceMode())) return; // dormant full-mode pages must not rewrite their routes
  if (page === "homepage") {
    /* 「回首页」= 聚焦首页标签：homepage 不是可多开的普通页——跳 HOME，不是把本标签
       改写成旧 TodayPage（用户实测重登后被历史还原成一个「古老旧今日页」）。 */
    focusTab(HOME_TAB_ID);
    return;
  }
  const tab = getTab(id);
  if (!tab || tab.kind === "home") return;
  const tabs = state.tabs.map((t) => (t.id === id ? { ...t, page, params: params ?? null, title: titleOf(page, params, title), lastActiveAt: Date.now() } : t));
  const next = tabs.find((t) => t.id === id) ?? tab;
  setState({ ...state, tabs });
  if (state.activeId === id) writeHashFor(next);
}

/** 标签页重排序（TabDrawer ↑↓） */
export function moveTab(id: string, dir: -1 | 1): void {
  const i = state.tabs.findIndex((t) => t.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.tabs.length) return;
  const tabs = [...state.tabs];
  [tabs[i], tabs[j]] = [tabs[j]!, tabs[i]!];
  setState({ ...state, tabs });
}

/** 拖动改顺序：把标签移到目标下标；首页（若存在于 0 位）钉死，任何拖动都不越过它 */
export function reorderTab(id: string, toIndex: number): void {
  const from = state.tabs.findIndex((t) => t.id === id);
  if (from < 0) return;
  const min = state.tabs[0]?.kind === "home" ? 1 : 0;
  const to = Math.max(min, Math.min(state.tabs.length - 1, toIndex));
  if (to === from) return;
  if (state.tabs[from]?.kind === "home") return;
  const tabs = [...state.tabs];
  const [moved] = tabs.splice(from, 1);
  tabs.splice(to, 0, moved!);
  setState({ ...state, tabs });
}

/** 移动标签页进出工作区（TabDrawer 行内「移入/移出工作区」） */
export function setTabWorkspace(id: string, workspaceId: string | null): void {
  const tabs = state.tabs.map((t) => (t.id === id ? { ...t, workspaceId } : t));
  setState({ ...state, tabs });
}

/* ══════════ 应用级 navigate（app.tsx 的 navigate 实现转发到这里） ══════════ */

/**
 * navigate(page, params) 的新语义（Shell 全局层使用；TabHost 面板内走 Ctx 覆盖的
 * tab 局部 navigate，见 TabHost.tsx）：
 * - settings/plugins → 设置浮层（不是标签页）；
 * - 当前活动标签是首页（或无活动页标签）→ 打开目标（已存在则复用）；
 * - 其余 → 当前标签页内导航（工作上下文保留）。
 */
export function explorerNavigate(page: Page, params?: LearnNav | null): void {
  if (OVERLAY_PAGES.has(page)) {
    openSettings(page === "settings" ? "settings" : "plugins");
    return;
  }
  const t = activeTab();
  if (t.kind === "home") {
    openTab(page, params);
    return;
  }
  navigateInTab(t.id, page, params);
  recordUse(page, params ?? null);
}

/* ══════════ OneGO 工作区 ══════════ */

/** 存为工作区：建快照 + **把所选标签页的归属改成该工作区**（抽屉立即分组） */
export function saveWorkspace(name: string, tabIds?: string[]): string {
  const ids = tabIds ? new Set(tabIds) : null;
  const source = state.tabs.filter((t) => (ids ? ids.has(t.id) : t.kind === "page"));
  if (source.length === 0) return "";
  const ws: ExplorerWorkspace = {
    id: `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim() || "工作区",
    createdAt: Date.now(),
    tabs: source.map((t) => ({ page: t.page, params: t.params, title: t.title })),
  };
  const wsIds = new Set(source.map((t) => t.id));
  const tabs = state.tabs.map((t) => (wsIds.has(t.id) ? { ...t, workspaceId: ws.id } : t));
  setState({ ...state, tabs, workspaces: [ws, ...state.workspaces].slice(0, 50) });
  return ws.id;
}

/** 现场建活工作区（标签栏拖拽停留后松手）：成员标签归属到新工作区，底板颜色/名字/logo 由用户现选 */
export function createLiveWorkspace(opts: { name: string; color: string; icon: string }, tabIds: string[]): string {
  const ws: ExplorerWorkspace = {
    id: `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: opts.name.trim() || "工作区",
    createdAt: Date.now(),
    tabs: [],
    color: opts.color,
    icon: opts.icon,
    collapsed: false,
    live: true,
  };
  const ids = new Set(tabIds);
  const tabs = state.tabs.map((t) => (ids.has(t.id) && t.kind === "page" ? { ...t, workspaceId: ws.id } : t));
  setState({ ...state, tabs, workspaces: [ws, ...state.workspaces].slice(0, 50) });
  return ws.id;
}

/** 把标签并入已有工作区（拖入底板）；workspaceId=null 即拖出工作区（不影响 OneGO 中的工作区定义） */
export function setTabsWorkspace(tabIds: string[], workspaceId: string | null): void {
  const ids = new Set(tabIds);
  const tabs = state.tabs.map((t) => (ids.has(t.id) && t.kind === "page" ? { ...t, workspaceId } : t));
  setState({ ...state, tabs });
}

/** 把一组标签（可能是整个工作区）整体挪到 state.tabs 的 index 位置（index 为去掉这组标签后的下标）；组内相对顺序不变 */
export function moveTabsBlock(ids: string[], index: number): void {
  const set = new Set(ids);
  const block = state.tabs.filter((t) => set.has(t.id));
  const rest = state.tabs.filter((t) => !set.has(t.id));
  const at = Math.max(0, Math.min(rest.length, index));
  setState({ ...state, tabs: [...rest.slice(0, at), ...block, ...rest.slice(at)] });
}

/** 工作区底板：改名 / 颜色 / logo / 折叠 */
export function patchLiveWorkspace(id: string, patch: Partial<Pick<ExplorerWorkspace, "name" | "color" | "icon" | "collapsed">>): void {
  const workspaces = state.workspaces.map((w) => (w.id === id ? { ...w, ...patch } : w));
  setState({ ...state, workspaces });
}

/** 关闭工作区：关掉其成员标签并移除工作区定义（底板上的大关闭按钮） */
export function closeLiveWorkspace(id: string): void {
  const members = state.tabs.filter((t) => t.workspaceId === id).map((t) => t.id);
  for (const tid of members) closeTab(tid);
  setState({ ...state, workspaces: state.workspaces.filter((w) => w.id !== id) });
}

/** 一键恢复：同实例聚焦（并把归属补上）、缺的补开（带归属），最后聚焦工作区最后一项 */
export function openWorkspace(id: string): void {
  const ws = state.workspaces.find((w) => w.id === id);
  if (!ws) return;
  let last = "";
  for (const entry of ws.tabs) {
    const existing = findInstanceTab(entry.page, entry.params);
    if (existing) {
      // 已打开的同实例：归入该工作区（归属随工作区走），聚焦
      if (existing.workspaceId !== ws.id) setTabWorkspace(existing.id, ws.id);
      last = existing.id;
      continue;
    }
    last = openTab(entry.page, entry.params, { title: entry.title, workspaceId: ws.id, activate: false }) || last;
  }
  if (last) focusTab(last);
}

export function deleteWorkspace(id: string): void {
  // 成员归属清空（标签页不删，只退组）
  const tabs = state.tabs.map((t) => (t.workspaceId === id ? { ...t, workspaceId: null } : t));
  setState({ ...state, tabs, workspaces: state.workspaces.filter((w) => w.id !== id) });
}

/** 解散：成员标签保留并退组；工作区本身留在 OneGO（转为「已保存」，成员快照下来，可一键恢复）。
 *  对已保存（非活）工作区无成员时不做任何改动，免得把快照冲掉。 */
export function dissolveWorkspace(id: string): void {
  const members = state.tabs.filter((t) => t.workspaceId === id && t.kind === "page");
  if (members.length === 0) return;
  const snap = members.map((t) => ({ page: t.page, params: t.params, title: t.title }));
  const tabs = state.tabs.map((t) => (t.workspaceId === id ? { ...t, workspaceId: null } : t));
  const workspaces = state.workspaces.map((w) => (w.id === id ? { ...w, live: false, collapsed: false, tabs: snap } : w));
  setState({ ...state, tabs, workspaces });
}

/** 已解散/已保存工作区：从快照里移除第 index 个标签（不影响实时标签） */
export function removeSavedWorkspaceTab(id: string, index: number): void {
  setState({ ...state, workspaces: state.workspaces.map((w) => (w.id === id ? { ...w, tabs: w.tabs.filter((_, i) => i !== index) } : w)) });
}

/** 已解散/已保存工作区：向快照加入一个标签（同实例去重） */
export function addSavedWorkspaceTab(id: string, entry: { page: Page; params: LearnNav | null; title: string }): void {
  setState({
    ...state,
    workspaces: state.workspaces.map((w) => {
      if (w.id !== id) return w;
      const key = JSON.stringify([entry.page, entry.params]);
      if (w.tabs.some((e) => JSON.stringify([e.page, e.params]) === key)) return w;
      return { ...w, tabs: [...w.tabs, entry] };
    }),
  });
}

export function renameWorkspace(id: string, name: string): void {
  const n = name.trim();
  if (!n) return;
  setState({ ...state, workspaces: state.workspaces.map((w) => (w.id === id ? { ...w, name: n } : w)) });
}

/* ══════════ 设置浮层（高于任何标签页） ══════════ */

let overlayEntry: OverlayEntry | null = null;
const overlayListeners = new Set<() => void>();

function emitOverlay(): void {
  for (const f of overlayListeners) f();
}

/** 打开设置浮层：entry = 个人设置 / 插件 / OneTHU Harness（三段同一浮层内切换） */
export function openSettings(entry: OverlayEntry = "settings"): void {
  overlayEntry = entry;
  emitOverlay();
}

export function closeSettings(): void {
  if (overlayEntry !== null) {
    overlayEntry = null;
    emitOverlay();
  }
}

export function overlaySnapshot(): OverlayEntry | null {
  return overlayEntry;
}

export function subscribeOverlay(f: () => void): () => void {
  overlayListeners.add(f);
  return () => {
    overlayListeners.delete(f);
  };
}

/* ══════════ React 钩子（组件侧订阅入口） ══════════ */

/** 订阅整个 explorer 状态（tabs+activeId+workspaces；TabHost/TabStrip/抽屉共用一份订阅） */
export function useExplorerState(): ExplorerState {
  return useSyncExternalStore(subscribeExplorer, explorerSnapshot, explorerSnapshot);
}

/** 设置浮层入口态（null=关闭）；Entry 兼容别名见 components/Layout.tsx 的 useEntry */
export function useOverlayEntry(): OverlayEntry | null {
  return useSyncExternalStore(subscribeOverlay, overlaySnapshot, () => null);
}
