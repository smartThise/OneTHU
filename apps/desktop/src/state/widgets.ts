import { t as i18n } from "../i18n/index.js";
/**
 * 组件目录的应用侧适配器：把今日页的卡片注册表变成白板可用的组件条目。
 *
 * 方案：docs/原子收藏-可行性与实现方案.md §4.4（七项定义）与 §7（判定表）。
 * 本文件会（经 homeCards）引入 .tsx 图标，因此只给应用用；纯核心在 state/widgetMeta.ts。
 * 昂贵档口径（霖 2026-10-09 定）：本轮先复用现有卡壳，卡片本体抽取留到后续批次。
 */
import { HOME_CARD_META, type HomeCardDef } from "../lib/homeCards.js";
import { BOARD_UNITS, PRESET_WIDGETS, type PropSpec, type SizeRange, type SizeTier, type WidgetDef } from "./widgetMeta.js";

/** 主栏卡默认 3 单位宽、侧栏卡 1 单位宽：与今日页现状的两栏比例一致。 */
function defaultWidth(def: HomeCardDef): number {
  return def.defaultCol === "rail" ? 1 : 3;
}

/**
 * 尺寸范围：宽度可调（1..4 基准单位），高度暂不开放。
 *
 * 原因：本仓库白板的网格行高由内容决定（卡片可高达数百像素），高度单位因此没有可用的基准——
 * 把高度从 1 调到 2 会让卡片跨两行、高度跳到两张卡之和。要让高度可调，先得给画布定一个
 * 基准瓦片高（卡片内部滚动或裁剪），这是待霖定的事（见文档 30.21 末段）。
 * 界面侧已按「能调哪侧才显示哪侧」隐藏南北把手，两者口径一致。
 */
function rangeFor(_def: HomeCardDef): SizeRange {
  return { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 8 };
}

/* ══════════ 尺寸档位（霖 2026-10-11 口径）══════════
 *
 * 「自由控制」只留给四类特殊组件：分割线 / 标题（文字）/ 入口按钮 / 列表。
 * 其余组件一律**挡位控制**：每个档位一套专门排版，用户不能拖出档位以外的尺寸。
 *
 * 下面这张表就是「需要逐个设计不同大小排版的组件」清单的机读形态（人读版见
 * docs/白板组件尺寸档清单.md）。tiers 为提案档位，待逐个设计排版后调整。
 */

/** 数字卡（一个主数值 + 小标签）的通用档位。 */
const STAT_TIERS: readonly SizeTier[] = [{ w: 1, h: 1 }, { w: 2, h: 1 }, { w: 2, h: 2 }];
/** 学生卡（姓名 / 学号 / 院系三行）的档位。 */
const STUDENT_TIERS: readonly SizeTier[] = [{ w: 2, h: 1 }, { w: 4, h: 1 }, { w: 4, h: 2 }];

export interface SizePlan {
  /** 档位清单（有序、由小到大）。 */
  tiers: readonly SizeTier[];
  /** 从「添加组件」加入时的推荐档位，必须落在 tiers 里。 */
  def: SizeTier;
}

/**
 * 挡位控制组件的档位提案表。键为组件目录 id 去掉 "custom:" 前缀后的卡片 id；
 * 页面自带组件（我的四张数字卡、成绩四张统计卡）也在此登记。
 */
export const SIZE_PLANS: Record<string, SizePlan> = {
  /* —— 卡片类（今日页注册表）—— */
  /* —— 环境/时钟三件套（2026-10-13）—— */
  clock: { tiers: [{ w: 2, h: 1 }, { w: 2, h: 2 }], def: { w: 2, h: 1 } },
  date: { tiers: [{ w: 2, h: 1 }, { w: 4, h: 1 }], def: { w: 2, h: 1 } },
  weather: { tiers: [{ w: 2, h: 2 }, { w: 4, h: 2 }], def: { w: 2, h: 2 } },
  "balance-strip": { tiers: [{ w: 4, h: 1 }, { w: 4, h: 2 }], def: { w: 4, h: 1 } },
  "today-overview": { tiers: [{ w: 4, h: 1 }, { w: 4, h: 2 }, { w: 4, h: 4 }], def: { w: 4, h: 1 } },
  agenda: { tiers: [{ w: 4, h: 2 }, { w: 4, h: 4 }], def: { w: 4, h: 2 } },
  "next-class": { tiers: [{ w: 1, h: 1 }, { w: 2, h: 1 }, { w: 4, h: 2 }], def: { w: 1, h: 1 } },
  cardEntry: { tiers: [{ w: 1, h: 1 }, { w: 2, h: 1 }, { w: 2, h: 2 }], def: { w: 1, h: 1 } },
  resv: { tiers: [{ w: 1, h: 1 }, { w: 2, h: 1 }, { w: 4, h: 2 }], def: { w: 1, h: 1 } },
  news: { tiers: [{ w: 1, h: 1 }, { w: 2, h: 1 }, { w: 4, h: 2 }], def: { w: 1, h: 1 } },
  /* —— 我的页数字卡 —— */
  "mine-balance": { tiers: STAT_TIERS, def: { w: 1, h: 1 } },
  "mine-credit": { tiers: STAT_TIERS, def: { w: 1, h: 1 } },
  "mine-gpa": { tiers: STAT_TIERS, def: { w: 1, h: 1 } },
  "mine-student": { tiers: STUDENT_TIERS, def: { w: 2, h: 1 } },
  /* —— 成绩元素级拆分里的四张统计卡（成绩明细是列表，保留自由控制）—— */
  "report-done": { tiers: STAT_TIERS, def: { w: 2, h: 2 } },
  "report-credit": { tiers: STAT_TIERS, def: { w: 2, h: 2 } },
  "report-overall": { tiers: STAT_TIERS, def: { w: 2, h: 2 } },
  "report-latest": { tiers: STAT_TIERS, def: { w: 2, h: 2 } },
};

/**
 * 逐卡的用户可见描述（长按菜单「详情」的正文）。
 * 要求：用户读得懂、并讲清它需要什么上下文（多数卡片需要登录）。
 */
export const CARD_DESCRIPTIONS: Record<string, string> = {
  get services() { return i18n("state.widgets.799a3fa553e0"); },
  get clock() { return i18n("state.widgets.b60bd0a94034"); },
  get date() { return i18n("state.widgets.ba55d27d82e9"); },
  get weather() { return i18n("state.widgets.dfaad9edebfd"); },
  get "balance-strip"() { return i18n("state.widgets.7b86b57f1bf0"); },
  get classes() { return i18n("state.widgets.63a2a45459e0"); },
  get homework() { return i18n("state.widgets.51a2c0bb3a22"); },
  get notices() { return i18n("state.widgets.195c8d859268"); },
  get "for-you"() { return i18n("state.widgets.431e74af3e83"); },
  get "today-overview"() { return i18n("state.widgets.68e67c770aa0"); },
  get agenda() { return i18n("state.widgets.41c2e035b533"); },
  get "next-class"() { return i18n("state.widgets.06c6908f0d42"); },
  get resv() { return i18n("state.widgets.fb4ffac2dc8d"); },
  get news() { return i18n("state.widgets.df6cbf44585a"); },
  get xk() { return i18n("state.widgets.deb8f7305005"); },
  get "learn-assignments"() { return i18n("state.widgets.b4eed2ab1ac0"); },
  get "learn-notices"() { return i18n("state.widgets.75fa9b38cbc8"); },
  get "learn-files"() { return i18n("state.widgets.98fe75c58d81"); },
  get "info-news"() { return i18n("state.widgets.cda323fd4e1d"); },
  get "info-report"() { return i18n("state.widgets.140cdcdca63e"); },
  get "info-exams"() { return i18n("state.widgets.9f991d8a3aa4"); },
  get "info-profile"() { return i18n("state.widgets.10e3c04ab010"); },
  get "life-dorm"() { return i18n("state.widgets.ab697bbe49a7"); },
  get "life-washer"() { return i18n("state.widgets.2e8b64b7ce35"); },
  get "life-card"() { return i18n("state.widgets.fce8c2b36f6a"); },
  get "reserve-lib"() { return i18n("state.widgets.21b46cb34439"); },
  get "reserve-room"() { return i18n("state.widgets.59417e9eee2e"); },
  get "learn-semester"() { return i18n("state.widgets.7849a6a1d9ef"); },
  get "learn-search"() { return i18n("state.widgets.e4912d152656"); },
  get "life-invoice"() { return i18n("state.widgets.a19df8a6637d"); },
  get "life-payroll"() { return i18n("state.widgets.165423b667f9"); },
  get "life-gradincome"() { return i18n("state.widgets.1511812d56b3"); },
  get "life-hygiene"() { return i18n("state.widgets.fd611796f383"); },
  get "info-fitness"() { return i18n("state.widgets.c647b6cc106f"); },
  get "info-evaluation"() { return i18n("state.widgets.8451b8a1bdb5"); },
  get "info-calendar"() { return i18n("state.widgets.35e92c5567bd"); },
  get "reserve-classroom"() { return i18n("state.widgets.f48d92cf0b84"); },
  get "life-network"() { return i18n("state.widgets.fae0c4931d49"); },
  get "reserve-sports"() { return i18n("state.widgets.5abb4e801a8b"); },
  get "reserve-kongjian"() { return i18n("state.widgets.1ec119c30bef"); },
};

/**
 * 卡片是否保留自由控制：入口按钮（kind === "entry"）与列表型组件（LIST_WIDGET_IDS）。
 * 其余卡片走挡位控制。
 */
function isFreeSizeCard(def: HomeCardDef): boolean {
  return def.id === "services" || def.kind === "entry" || LIST_WIDGET_IDS.includes("custom:" + String(def.id));
}

/** 便笺（白板随手写字；可收起）。放应用侧而非 PRESET：widgetMeta 的 preset 列表
 *  必须保持「无 custom 条目」，否则 defForSpec 的按-kind 兜底会把未知 custom 全部
 *  误解析成它（widget-render 护栏钉的就是这条）。 */
export const NOTE_WIDGET: WidgetDef = {
  id: "custom:note",
  spec: { kind: "custom", id: "note" },
  get title() { return i18n("state.widgets.6374c187518d"); },
  get description() { return i18n("state.widgets.6a1ae000b69e"); },
  defaultSize: { w: 2, h: 2 },
  sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 4 },
  sizeControl: "free",
  editableProps: [
    { key: "text", get label() { return i18n("state.widgets.7a688306423b"); }, kind: "text", maxLength: 200, get placeholder() { return i18n("state.widgets.cd92acd73a04"); } },
    { key: "tone", get label() { return i18n("state.widgets.6d6f19d5fa51"); }, kind: "select", options: [{ value: "yellow", get label() { return i18n("state.widgets.c732e4d7e380"); } }, { value: "pink", get label() { return i18n("state.widgets.d00069a5d3b5"); } }, { value: "blue", get label() { return i18n("state.widgets.52f354ecfccb"); } }, { value: "green", get label() { return i18n("state.widgets.84b34ffba5aa"); } }] },
  ],
};

/** 卡片的组件目录条目：spec 用 custom + 卡片 id（与今日页白板文档同构）。 */
/** 无级画布下，卡片不再按尺寸档位换排版；改为用户可选的显示风格。 */
function displayProp(options: Array<[string, string]>): PropSpec {
  return {
    key: "display",
    get label() { return i18n("state.widgetstyle.3d2ba1c5d50f"); },
    kind: "select",
    options: options.map(([value, label]) => ({ value, label })),
  };
}

function editablePropsFor(id: string): PropSpec[] | undefined {
  if (id === "clock") return [displayProp([["magazine", i18n("state.widgetstyle.25122e5ed17d")], ["minimal", i18n("state.widgetstyle.a2df8b92e83a")]])];
  if (id === "classes" || id === "next-class") {
    return [displayProp([["focus", i18n("state.widgetstyle.babb44caf563")], ["list", i18n("state.widgetstyle.b82fb59d35f2")]])];
  }
  return undefined;
}

export function cardWidgetDefs(): WidgetDef[] {
  return HOME_CARD_META.map((def) => {
    const id = String(def.id);
    const w = defaultWidth(def);
    const free = isFreeSizeCard(def);
    const plan: SizePlan = SIZE_PLANS[id] ?? { tiers: [{ w, h: 1 }], def: { w, h: 1 } };
    return {
      id: "custom:" + id,
      spec: { kind: "custom", id },
      title: def.title,
      description: CARD_DESCRIPTIONS[id] ?? "",
      defaultSize: id === "services" ? { w: 4, h: 3 } : id === "homework" ? { w: 4, h: 4 } : free ? { w, h: 2 } : { ...plan.def },
      sizeRange: rangeFor(def),
      sizeControl: free ? "free" : "tiers",
      sizeTiers: free ? undefined : plan.tiers,
      ...(editablePropsFor(id) ? { editableProps: editablePropsFor(id) } : {}),
    } satisfies WidgetDef;
  });
}

/**
 * 页面自己发布的组件（不是今日页卡片）：目前是「我的」页的三张数字卡。
 * 它们在白板上靠 state/liveCards.ts 的卡体渲染，因此必须在此登记，否则会被判为「未知组件」。
 */
export const PAGE_WIDGETS: readonly WidgetDef[] = [
  {
    id: "custom:mine-student",
    spec: { kind: "custom", id: "mine-student" },
    get title() { return i18n("state.widgets.233208eec42c"); },
    get description() { return i18n("state.widgets.8f9e81e009d6"); },
    defaultSize: { w: 3, h: 2 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 3 },
  },
  {
    id: "custom:mine-balance",
    spec: { kind: "custom", id: "mine-balance" },
    get title() { return i18n("state.widgets.c0c6bb8b8618"); },
    get description() { return i18n("state.widgets.013cd6f09996"); },
    defaultSize: { w: 1, h: 1 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 2 },
  },
  {
    id: "custom:mine-credit",
    spec: { kind: "custom", id: "mine-credit" },
    get title() { return i18n("state.widgets.f9d072c4804c"); },
    get description() { return i18n("state.widgets.d88ab50f7ac1"); },
    defaultSize: { w: 1, h: 1 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 2 },
  },
  {
    id: "custom:mine-gpa",
    spec: { kind: "custom", id: "mine-gpa" },
    title: "GPA",
    get description() { return i18n("state.widgets.49ed1ca61e24"); },
    defaultSize: { w: 1, h: 1 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 2 },
  },
  {
    id: "custom:info-report",
    spec: { kind: "custom", id: "info-report" },
    get title() { return i18n("state.widgets.f4802624f209"); },
    get description() { return i18n("state.widgets.1a596ff1775d"); },
    defaultSize: { w: 3, h: 4 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 8 },
  },
  {
    id: "custom:info-fitness",
    spec: { kind: "custom", id: "info-fitness" },
    get title() { return i18n("state.widgets.b7ab08dc01be"); },
    get description() { return i18n("state.widgets.8c5b33dd6c65"); },
    defaultSize: { w: 3, h: 4 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 8 },
  },
  {
    id: "custom:info-exams",
    spec: { kind: "custom", id: "info-exams" },
    get title() { return i18n("state.widgets.cbc4fafd7657"); },
    get description() { return i18n("state.widgets.d86fcc64b8e6"); },
    defaultSize: { w: 3, h: 4 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 8 },
  },
  {
    id: "custom:info-evaluation",
    spec: { kind: "custom", id: "info-evaluation" },
    get title() { return i18n("state.widgets.2e9ea1d91fc5"); },
    get description() { return i18n("state.widgets.6b465ece116c"); },
    defaultSize: { w: 3, h: 4 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 8 },
  },
  {
    id: "custom:info-calendar",
    spec: { kind: "custom", id: "info-calendar" },
    get title() { return i18n("state.widgets.c230feb89e2b"); },
    get description() { return i18n("state.widgets.a3f514198472"); },
    defaultSize: { w: 3, h: 4 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 8 },
  },
  {
    id: "custom:info-news",
    spec: { kind: "custom", id: "info-news" },
    get title() { return i18n("state.widgets.30c227649197"); },
    get description() { return i18n("state.widgets.c3bc1241bb01"); },
    defaultSize: { w: 3, h: 4 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 8 },
  },
  {
    id: "custom:info-profile",
    spec: { kind: "custom", id: "info-profile" },
    get title() { return i18n("state.widgets.5c4655ab2eb5"); },
    get description() { return i18n("state.widgets.10ceb5029293"); },
    defaultSize: { w: 3, h: 4 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 8 },
  },
  {
    id: "custom:info-courseinfo",
    spec: { kind: "custom", id: "info-courseinfo" },
    get title() { return i18n("state.widgets.926e04269dbb"); },
    get description() { return i18n("state.widgets.eb21e822e78e"); },
    defaultSize: { w: 3, h: 4 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 8 },
  },
];

/**
 * 列表型组件：编辑态下**不实时渲染内容**，改显示占位与文字标注。
 *
 * 原因（霖 2026-10-11 口径）：这类组件的内容与高度随数据变化，编辑时满屏列表既看不清布局、
 * 又容易让人误以为在编辑列表内容。退出编辑模式后照常显示真实内容。
 */
export const LIST_WIDGET_IDS: readonly string[] = [
  "custom:homework",
  "custom:notices",
  "custom:classes",
  "custom:for-you",
  "custom:learn-assignments",
  "custom:learn-notices",
  "custom:learn-files",
  "custom:info-report",
  "custom:info-fitness",
  "custom:info-exams",
  "custom:info-evaluation",
  "custom:info-calendar",
  "custom:info-news",
  "custom:info-profile",
  "custom:info-courseinfo",
];

/**
 * 元素级拆分的成绩组件（霖 2026-10-11 定口径 B：复合卡片拆到元素级）。
 *
 * 「全部成绩」原本是一张复合卡（4 块统计 + 明细列表）。按元素拆开后：
 * 四张统计卡各占 2×2，明细列表占 4×4——用户可以只放"总学分"或只放"明细"。
 */
export const REPORT_ELEMENT_WIDGETS: readonly WidgetDef[] = [
  {
    id: "custom:report-done",
    spec: { kind: "custom", id: "report-done" },
    get title() { return i18n("state.widgets.dc6c9f070ee1"); },
    get description() { return i18n("state.widgets.83778481a234"); },
    defaultSize: { w: 2, h: 2 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 3 },
  },
  {
    id: "custom:report-credit",
    spec: { kind: "custom", id: "report-credit" },
    get title() { return i18n("state.widgets.e842a5dff916"); },
    get description() { return i18n("state.widgets.9ea94a354dce"); },
    defaultSize: { w: 2, h: 2 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 3 },
  },
  {
    id: "custom:report-overall",
    spec: { kind: "custom", id: "report-overall" },
    get title() { return i18n("state.widgets.499dfff8b69c"); },
    get description() { return i18n("state.widgets.1c13af474208"); },
    defaultSize: { w: 2, h: 2 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 3 },
  },
  {
    id: "custom:report-latest",
    spec: { kind: "custom", id: "report-latest" },
    get title() { return i18n("state.widgets.671b407e8328"); },
    get description() { return i18n("state.widgets.f42d1c6829c9"); },
    defaultSize: { w: 2, h: 2 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 3 },
  },
  {
    id: "custom:report-list",
    spec: { kind: "custom", id: "report-list" },
    get title() { return i18n("state.widgets.60bc8ac2e20b"); },
    get description() { return i18n("state.widgets.4b3ef1e5eefa"); },
    defaultSize: { w: 4, h: 4 },
    sizeRange: { minW: 2, minH: 2, maxW: BOARD_UNITS, maxH: 8 },
  },
];

/**
 * "具体项"模板组件（霖 2026-10-11 定）：这类条目**个数不可数**（课程文件、通知、作业…每一学期都不一样），
 * 因此每一类做成**一个模板组件**，具体显示哪一条由**编辑界面里的列表 + 搜索框**选择，
 * 选择结果写进条目的 `spec.props`（渲染器据此取数）。
 *
 * 与 `REPORT_ELEMENT_WIDGETS` 的区别：那些是"固定的统计块"，这些是"同类中的某一条"。
 */
export const ATOM_TEMPLATE_WIDGETS: readonly WidgetDef[] = [
  {
    id: "custom:learn-file",
    spec: { kind: "custom", id: "learn-file" },
    get title() { return i18n("state.widgets.cb232f86e59b"); },
    get description() { return i18n("state.widgets.13f9d7f0c849"); },
    defaultSize: { w: 4, h: 1 },
    sizeRange: { minW: 2, minH: 1, maxW: BOARD_UNITS, maxH: 3 },
  },
];

/** 模板组件的 id 集合（编辑界面据此提供「选择条目」入口）。 */
export const ATOM_TEMPLATE_IDS: readonly string[] = ATOM_TEMPLATE_WIDGETS.map((d) => d.spec.kind === "custom" ? "custom:" + d.spec.id : d.id);

export function isListWidget(id: string): boolean {
  return LIST_WIDGET_IDS.includes(id);
}

/**
 * 页面自带组件的大小控制登记：SIZE_PLANS 里有 = 挡位控制（并采用提案档位与推荐档位），
 * 没有 = 自由控制（列表条目这类内容自适应的组件）。已经登记过的原样返回。
 */
function withSizeControl(def: WidgetDef): WidgetDef {
  if (def.sizeControl) return def;
  const key = def.id.startsWith("custom:") ? def.id.slice("custom:".length) : def.id;
  const plan = SIZE_PLANS[key];
  if (plan) return { ...def, defaultSize: { ...plan.def }, sizeControl: "tiers", sizeTiers: plan.tiers };
  return { ...def, sizeControl: "free" };
}

/** 保留自由控制的组件目录 id 全集（分割线 / 文字 / 入口按钮 / 列表 + 行级条目）。 */
export function freeSizeWidgetIds(): readonly string[] {
  const ids = new Set<string>(["divider", "text-title", "text-label", "custom:learn-file"]);
  for (const id of LIST_WIDGET_IDS) ids.add(id);
  for (const def of HOME_CARD_META) if (def.kind === "entry") ids.add("custom:" + String(def.id));
  return [...ids];
}

/** 应用侧全部条目（预制 + 卡片 + 页面自带组件）。 */
export function appWidgetDefs(): WidgetDef[] {
  return [
    ...cardWidgetDefs(),
    NOTE_WIDGET,
    ...PAGE_WIDGETS.map(withSizeControl),
    ...REPORT_ELEMENT_WIDGETS.map(withSizeControl),
    ...ATOM_TEMPLATE_WIDGETS.map(withSizeControl),
  ];
}

/**
 * 目录总表（预制 + 应用侧），**按 id 去重**（保留第一条）。
 *
 * 信息页栏目既作为入口卡（HOME_CARD_META）登记，又作为页面自带组件（PAGE_WIDGETS）登记，
 * 两者 id 相同、spec 相同，是同一个白板组件；不去重会让「添加组件」出现两张同名卡片。
 */
export function allWidgetDefs(): WidgetDef[] {
  const out: WidgetDef[] = [];
  const seen = new Set<string>();
  for (const d of [...PRESET_WIDGETS, ...appWidgetDefs()]) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    out.push(d);
  }
  return out;
}

/** 挡位控制的组件目录 id 全集（需要逐个设计不同大小排版的组件）。 */
export function tierWidgetIds(defs: readonly WidgetDef[] = allWidgetDefs()): readonly string[] {
  const free = new Set(freeSizeWidgetIds());
  return defs.filter((d) => !free.has(d.id) && d.sizeControl !== "free").map((d) => d.id);
}
