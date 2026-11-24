import { t as i18n } from "../i18n/index.js";
/**
 * 导览偏好状态（v3，2026-10-13 桌面导览改版）。
 *
 * 播放端：components/OnboardingTourV3.tsx（七步玻璃卡，桌面端现状基线）。
 * 本文件管两块既有职责：
 *  ① 首启流程与完成标记（flow 字段 "v3" / flow3，见文末「首启流程键」块）；
 *  ② 导览期间/之后对首页卡片的取舍（写既有存储 onethu.home.layout.*，不新增机制）。
 *
 * 旧体系（v1 逐项问界面 + v2 三问灰度）的流程文件已删除；
 * 卡片/场景判定保留原样（lib/onboardingCards.ts 有护栏钉住）。
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
  "homepage", "learn", "schedule", "trace", "mail", "cloud", "thubook",
  "info", "life", "reserve", "thos", "otherinfo",
];
const ALL_TABS = {
  info: ["report", "fitness", "exams", "evaluation", "calendar", "news", "profile", "courseinfo"],
  life: ["elec", "water", "washer", "hygiene", "card", "invoice", "payroll", "gradincome", "network"],
};

export const PRESETS: Preset[] = [
  {
    id: "complete",
    get label() { return i18n("state.onboarding.088b27d0ed00"); },
    get hint() { return i18n("state.onboarding.8c45a98b34de"); },
    pages: ALL_PAGES,
    tabs: ALL_TABS,
    cards: ["learn", "life", "schedule", "extend"],
  },
  {
    id: "minimal",
    get label() { return i18n("state.onboarding.2e67474d8dad"); },
    get hint() { return i18n("state.onboarding.1052251daaf7"); },
    pages: ["homepage", "learn", "info", "life", "thos"],
    tabs: { info: ["report", "exams", "profile"], life: ["card", "elec", "water", "washer"] },
    cards: ["learn"],
  },
  {
    id: "reserve",
    get label() { return i18n("state.onboarding.257c80cc4f44"); },
    get hint() { return i18n("state.onboarding.42803ef36875"); },
    pages: ["homepage", "schedule", "reserve", "life", "thos"],
    tabs: { info: ["calendar"], life: ["elec", "water", "washer", "hygiene", "card"] },
    cards: ["schedule", "life"],
  },
  {
    id: "info",
    get label() { return i18n("state.onboarding.00b2d49ca0de"); },
    get hint() { return i18n("state.onboarding.524a5d266a8f"); },
    pages: ["homepage", "learn", "info", "schedule", "thos", "otherinfo"],
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


/* ══════════ 首启流程键（v3 起，2026-10-13 桌面导览改版）══════════
 * 播放统一走 components/OnboardingTourV3.tsx；v1（逐项问界面 + 账号接入）与
 * v2（三问灰度）的流程文件已随本次改版删除。沿用两个既有偏好键：
 *  - 流程字段 onethu.onboarding.flow：新存档默认写 "v3"；老存档里残留的 v1/v2 值
 *    沿同一字段保留（不清除、不迁移），由于其流程已退役，实际一律按 v3 播放；
 *  - 完成标记 onethu.onboarded.flow3：接 v2 flow2 的家族命名——
 *    看完最后一步 / 勾「不再显示」都落这里（设置页「导览」按钮负责清掉重来）。
 */
const FLOW_KEY = "onethu.onboarding.flow";
const DORM_KEY = "onethu.dorm.building";
const KEY_V3 = "onethu.onboarded.flow3";

/** 首启流程（v3 起只有一种播放）。默认值 "v3"；老存档的 v1/v2 值被收编、不作数。 */
export type OnboardingFlow = "v3";
export const ONBOARDING_FLOW_DEFAULT: OnboardingFlow = "v3";

/** 当前流程：恒为 v3。读取 flow 字段只为把 "v3" 写回 standards（老值不清除，见块注释） */
export function getOnboardingFlow(): OnboardingFlow {
  try {
    const raw = globalThis.localStorage?.getItem(FLOW_KEY);
    if (raw !== "v3") {
      /* 老存档（v1/v2/done 等）原样保留，只读取不覆写；语义一律按 v3 */
      return ONBOARDING_FLOW_DEFAULT;
    }
  } catch {
    /* 读不到就按默认走 v3，别因存储问题改变首启表现 */
  }
  return ONBOARDING_FLOW_DEFAULT;
}

/** 是否已经看过/跳过过一轮 v3（看完最后一步、勾「不再显示」都算） */
export function hasOnboardedV3(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY_V3) === "1";
  } catch {
    return true; // 存不下时别反复弹
  }
}

/** v3 落盘 */
export function markOnboardedV3(): void {
  try {
    globalThis.localStorage?.setItem(KEY_V3, "1");
  } catch {
    /* ignore */
  }
}

function resetOnboardingV3(): void {
  try {
    globalThis.localStorage?.removeItem(KEY_V3);
    /* 手机导览简版的自持偏好一并清：设置里「导览」重走对两端都生效 */
    globalThis.localStorage?.removeItem("onethu.onboarded.phone");
  } catch {
    /* ignore */
  }
}

/** 设置页「导览」按钮：清 v3 完成标记，下次启动（或刷新）重新走一遍 */
export function resetActiveOnboarding(): void {
  resetOnboardingV3();
  try { localStorage.removeItem("onethu.onboarded.flow4"); } catch {}
}

/** 宿舍楼/园区（§4.2 问题 3）：P0 只问不消费，P2 供今日卡与洗衣机、电费的上下文用 */
export function getDormBuilding(): string {
  try {
    return globalThis.localStorage?.getItem(DORM_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setDormBuilding(name: string): void {
  try {
    const v = name.trim();
    if (v === "") globalThis.localStorage?.removeItem(DORM_KEY);
    else globalThis.localStorage?.setItem(DORM_KEY, v);
  } catch {
    /* ignore */
  }
}
