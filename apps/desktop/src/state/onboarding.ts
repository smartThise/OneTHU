/**
 * 首启导览（2026-09-20 群反馈定案）：功能多是卖点，但**同时呈现**对非技术同学是负担。
 * 导览不删功能，只做两件事：① 按场景把用不到的首页卡片收起来（复用既有 homeCards 布局）；
 * ② 教会"收藏夹"这一次性动作（原子收藏是立身之本，但没人主动用）。
 *
 * 只写既有存储（onethu.home.layout.* / onethu.home.defaults），不新增机制、不动数据模型。
 */
import {
  HOME_CARD_META,
  loadCollapsedDefaults,
  loadLayout,
  resolveLayout,
  saveCollapsedDefaults,
  saveLayout,
  type HomeCardId,
  type HomeLayoutItem,
  type HomeOrientation,
} from "../lib/homeCards.js";

export { SCENARIOS, cardsForScenarios, cardsOfScenario, type Scenario } from "../lib/onboardingCards.js";
import { cardsForScenarios, planTodayCards, SCENARIOS } from "../lib/onboardingCards.js";

// v2（2026-09-21）：导览新增账号接入步骤（雨课堂 / OJ / 邮箱 / 云盘）。
// v3（2026-09-21）：导览再新增「桌面小组件」步骤——沿用同一口径：导览有新增内容时
// 新旧用户都要看一轮，所以继续换版本号；已配置的项只标识、不重复索要。
const KEY = "onethu.onboarded.v3";

export function hasOnboarded(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) === "1";
  } catch {
    return true; // 存不下时别反复弹
  }
}

export function markOnboarded(): void {
  try {
    globalThis.localStorage?.setItem(KEY, "1");
  } catch {
    /* ignore */
  }
}

/** 设置页「重新导览」：清标志即可下次自动弹（导览本身幂等、可重复走） */
export function resetOnboarding(): void {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}


export function applyScenarios(scenarioIds: string[], orientation: HomeOrientation): void {
  const keep = new Set<HomeCardId>(cardsForScenarios(scenarioIds));

  const meta = HOME_CARD_META;
  const saved = loadLayout(orientation) ?? [];
  const byId = new Map(saved.map((it) => [it.id, it] as const));
  const items: HomeLayoutItem[] = meta.map((def) => {
    const prev = byId.get(def.id);
    const col: HomeLayoutItem["col"] = keep.has(def.id)
      ? (def.defaultCol === "main" ? "main" : "rail")
      : "off";
    return { id: def.id, col, collapsed: prev?.collapsed ?? !keep.has(def.id) };
  });
  saveLayout(items, orientation);

  // 被收起的卡片默认折叠，回到首页时不会又把一屏塞满
  const collapsed = { ...loadCollapsedDefaults() };
  for (const def of meta) if (!keep.has(def.id)) collapsed[def.id] = true;
  saveCollapsedDefaults(collapsed);
  broadcastHomeChanged();
}


/**
 * 今日页「留哪些卡」：导览里逐张决定（默认全留 = 现在的全面版首页）。
 * 与 applyScenarios 的区别：那个按场景**整体重排**，这个只在用户勾掉的卡上写 off，
 * 其它卡保持现有栏位与顺序——用户改完不会觉得首页被"重刷"了一遍。
 */
/** 布局落盘后的广播：首页（以及任何读卡片的界面）据此立刻重读，不必等重进页面 */
function broadcastHomeChanged(): void {
  try {
    window.dispatchEvent(new Event("onethu.home.changed"));
  } catch {
    /* 无 window（测试环境）忽略 */
  }
}

export function applyTodayCards(keep: HomeCardId[], orientation: HomeOrientation): void {
  const safeKeep: HomeCardId[] = keep.length > 0 ? keep : ["today-overview"];
  // 两个朝向都写：用户的选择与横竖屏无关；只写一个朝向会让另一个朝向留着旧的"全关"布局
  // （事故原型：导览在 landscape 下改，窗口一变形又看到空白）
  for (const o of ["portrait", "landscape"] as HomeOrientation[]) {
    const saved = resolveLayout(HOME_CARD_META, loadLayout(o));
    const { items, empty } = planTodayCards(safeKeep, saved, HOME_CARD_META);
    // 兜底：真算出来一张可见的都没有 → 给一份注册表默认布局，绝不交出空白首页
    saveLayout(empty ? resolveLayout(HOME_CARD_META, null) : items, o);
  }

  // 被收起的卡默认折叠，留下的卡展开（刚选完就该看得见内容）
  const keepSet = new Set(safeKeep);
  const collapsed = { ...loadCollapsedDefaults() };
  for (const def of HOME_CARD_META) collapsed[def.id] = !keepSet.has(def.id);
  saveCollapsedDefaults(collapsed);

  // 留痕：这类"以为选了、其实还关着 / 一张没留"的情况必须能从日志看出来
  broadcastHomeChanged();
  void import("../lib/clients.js")
    .then((m) =>
      m.logLine(
        `[ONBOARD] 今日页卡片落盘：留 ${safeKeep.length} 张（${safeKeep.join(",")}）${
          keep.length === 0 ? " ← 用户未留任何卡，已兜底保留今日概览" : ""
        } · 两个朝向同步`,
      ),
    )
    .catch(() => undefined);
}

/** 首页布局被清空时的自救：恢复注册表默认（今日页空白的那个状态一键回来） */
export function restoreDefaultTodayCards(orientation: HomeOrientation): void {
  for (const o of ["portrait", "landscape"] as HomeOrientation[]) {
    saveLayout(resolveLayout(HOME_CARD_META, null), o);
  }
  saveCollapsedDefaults({});
  broadcastHomeChanged();
}

/** 导览里可勾选的今日卡片：只列**默认可见**的展示卡（入口卡仍在「添加卡片」里） */
export function todayChoosableCards(): Array<{ id: HomeCardId; title: string; hint?: string }> {
  return HOME_CARD_META.filter((d) => d.kind === "bespoke" && !d.defaultHidden).map((d) => ({
    id: d.id,
    title: d.title,
    hint: d.aside,
  }));
}

/** 预算好的使用场景预设（导览首屏二选一：自行选择 / 按场景预设）。
 *  选预设后仍可返回上一步改选，或改完再进"自行选择"逐项微调。 */
export interface Preset {
  id: string;
  label: string;
  hint: string;
  /** 保留在侧栏（展开）的页面；未列出的一律折叠 */
  pages: string[];
  /** 二级页签保留项：key → 保留的 tab id（未列出的隐藏） */
  tabs: Record<string, string[]>;
  /** 首页保留的场景（走 applyScenarios） */
  cards: string[];
}

const ALL_PAGES = [
  "today", "learn", "schedule", "trace", "mail", "cloud", "thubook",
  "info", "life", "reserve", "thos", "otherinfo",
];
const ALL_TABS = {
  info: ["report", "fitness", "exams", "evaluation", "calendar", "news", "profile", "courseinfo"],
  life: ["dorm", "washer", "hygiene", "card", "invoice", "payroll", "gradincome", "network"],
};

export const PRESETS: Preset[] = [
  {
    id: "complete",
    label: "完整",
    hint: "所有功能都在侧栏，适合想一次看全的人",
    pages: ALL_PAGES,
    tabs: ALL_TABS,
    cards: ["learn", "life", "schedule", "extend"],
  },
  {
    id: "minimal",
    label: "极简",
    hint: "只留今日、网络学堂、信息、生活、在线服务",
    pages: ["today", "learn", "info", "life", "thos"],
    tabs: { info: ["report", "exams", "profile"], life: ["card", "dorm", "washer"] },
    cards: ["learn"],
  },
  {
    id: "reserve",
    label: "预约狂人",
    hint: "日程、预约、场馆与宿舍设备为主",
    pages: ["today", "schedule", "reserve", "life", "thos"],
    tabs: { info: ["calendar"], life: ["dorm", "washer", "hygiene", "card"] },
    cards: ["schedule", "life"],
  },
  {
    id: "info",
    label: "信息大师",
    hint: "成绩、考试、学籍、新闻与网络学堂全在",
    pages: ["today", "learn", "info", "schedule", "thos", "otherinfo"],
    tabs: { info: ALL_TABS.info, life: ["card", "network"] },
    cards: ["learn", "schedule", "extend"],
  },
];

/** 应用预设：页面折叠 + 页签显隐 + 首页卡片，与手动路径写同一批存储 */
export function applyPreset(
  preset: Preset,
  foldPage: (page: string) => boolean,
  openPage: (page: string) => boolean,
): void {
  for (const p of ALL_PAGES) {
    if (preset.pages.includes(p)) openPage(p);
    else foldPage(p);
  }
  void applyScenarios(preset.cards, "portrait");
}

/** 预设与手动路径共用的页签 id 全集（供导览展示与对账） */
export const TAB_IDS_BY_KEY: Record<string, string[]> = ALL_TABS;
