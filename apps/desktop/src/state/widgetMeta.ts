import { t as i18n } from "../i18n/index.js";
/**
 * 组件目录（P1 纯核心）：白板上的「组件」在这里登记元数据。
 *
 * 方案：docs/原子收藏-可行性与实现方案.md §4.4（七项定义）与 §5.1（类型清单）。
 * 与 state/boardCore.ts 同样的拆法：本文件不依赖任何视图模块（不 import .tsx），
 * 因此能被 node 护栏直接加载并真实驱动；卡片类与页面自带组件的条目由应用侧适配器注入。
 */
import type { WidgetSpec } from "./boardCore.js";

/** 基准单位宽度上限（与 boardCore.BOARD_COLS 同口径：手机 4 格 / PC 8 列）。 */
export const BOARD_UNITS = 8;  /* 最宽 = 宽屏一整行（8 基准单位）；窄屏由运行时列数夹到 4 */

export interface WidgetSize { w: number; h: number }

export interface SizeRange { minW: number; minH: number; maxW: number; maxH: number }

/** 一个尺寸档位（基准单位：1 单位 = 手机 1 列）。 */
export interface SizeTier { w: number; h: number }

/**
 * 大小控制方式（霖 2026-10-11 口径）：
 *   · `free`  = 保留四边把手自由缩放。仅分割线 / 标题（文字）/ 入口按钮 / 列表这四类特殊组件；
 *   · `tiers` = 只能从预设档位里挑，每个档位一套**专门排版**（其余组件一律走这条）。
 */
export type SizeControl = "free" | "tiers";

/** 组件的显示样式预设：添加抽屉横向卡片 / 右键「显示样式」共用。 */
export interface WidgetStyle {
  id: string;
  label: string;
  /** 合并进 BoardItem.spec.props 的样式参数。 */
  props?: Record<string, unknown>;
}

/** 可在「编辑」抽屉里调整的属性。表单由 kind 决定，值存进 BoardItem.props。 */
export interface PropSpec {
  key: string;
  label: string;
  kind: "text" | "toggle" | "select";
  options?: Array<{ value: string; label: string }>;
  maxLength?: number;
  placeholder?: string;
}

export interface WidgetDef {
  /** 目录主键（稳定，落进 BoardItem.spec 或由 specToDefId 反查）。 */
  id: string;
  /** 默认规格（用户从「添加组件」加入白板时的初始 spec）。 */
  spec: WidgetSpec;
  /** 「添加组件」面板里的显示名。 */
  title: string;
  /** 长按菜单「详情」里的说明：写给用户看，讲清它需要什么上下文。 */
  description: string;
  defaultSize: WidgetSize;
  sizeRange: SizeRange;
  /** 有值才在长按菜单里出现「编辑」（需求原文：如果有的话）。 */
  editableProps?: PropSpec[];
  /** 可选显示样式；有值即显示「显示样式」入口和添加抽屉样式卡。 */
  styles?: readonly WidgetStyle[];
  /**
   * 大小控制方式。缺省按 sizeTiers 判定：有档位清单 = 挡位控制，没有 = 自由控制。
   * 分割线 / 文字 / 入口按钮 / 列表登记为 `"free"`；其余组件登记为 `"tiers"` 并给出 sizeTiers。
   */
  sizeControl?: SizeControl;
  /** 档位清单（有序、由小到大）。挡位控制的组件至少一项，defaultSize 必须落在清单里。 */
  sizeTiers?: readonly SizeTier[];
}

/** 预制组件：不依赖任何页面上下文，开箱可用。 */
export const PRESET_WIDGETS: WidgetDef[] = [
  {
    id: "text-title",
    spec: { kind: "text", get text() { return i18n("state.widgetmeta.4e6ff6dda14d"); }, variant: "title" },
    get title() { return i18n("state.widgetmeta.8b686642f7d8"); },
    get description() { return i18n("state.widgetmeta.10ed14b80e18"); },
    defaultSize: { w: 2, h: 1 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 2 },
    sizeControl: "free",
    editableProps: [{ key: "text", get label() { return i18n("state.widgetmeta.14b69bd6eeb0"); }, kind: "text", maxLength: 16, get placeholder() { return i18n("state.widgetmeta.d9307f3eba25"); } }],
  },
  {
    id: "text-label",
    spec: { kind: "text", get text() { return i18n("state.widgetmeta.1d0fd5f9336d"); }, variant: "label" },
    get title() { return i18n("state.widgetmeta.655d4e9c7591"); },
    get description() { return i18n("state.widgetmeta.d520acd12d16"); },
    defaultSize: { w: 2, h: 1 },
    sizeRange: { minW: 1, minH: 1, maxW: BOARD_UNITS, maxH: 2 },
    sizeControl: "free",
    editableProps: [{ key: "text", get label() { return i18n("state.widgetmeta.14b69bd6eeb0"); }, kind: "text", maxLength: 32, get placeholder() { return i18n("state.widgetmeta.fcd2119102ef"); } }],
  },
  {
    id: "divider",
    spec: { kind: "divider" },
    get title() { return i18n("state.widgetmeta.c64dd5eb2135"); },
    get description() { return i18n("state.widgetmeta.1e2a390bd349"); },
    defaultSize: { w: BOARD_UNITS, h: 1 },
    sizeRange: { minW: 2, minH: 1, maxW: BOARD_UNITS, maxH: 1 },
    sizeControl: "free",
  },
];

/** 目录 = 预制 + 应用侧注入（卡片类 / 页面自带组件 / 具体跳转入口）。 */
export function widgetDefs(appDefs: readonly WidgetDef[] = []): WidgetDef[] {
  return [...PRESET_WIDGETS, ...appDefs];
}

export function widgetById(id: string, appDefs: readonly WidgetDef[] = []): WidgetDef | null {
  return widgetDefs(appDefs).find((d) => d.id === id) ?? null;
}

/** 未知 id 的判定：渲染层据此落「空态组件」而不是抛错（方案 §11 的 widget-registry 口径）。 */
export function isKnownWidget(id: string, appDefs: readonly WidgetDef[] = []): boolean {
  return widgetById(id, appDefs) !== null;
}

/** 尺寸夹取：既要落在该组件的 sizeRange 内，也不许超过基准单位上限。 */
export function clampSize(def: WidgetDef, size: WidgetSize): WidgetSize {
  const r = def.sizeRange;
  const w = Math.min(Math.max(Math.round(size.w), r.minW), Math.min(r.maxW, BOARD_UNITS));
  const h = Math.min(Math.max(Math.round(size.h), r.minH), r.maxH);
  return { w, h };
}

/**
 * 大小控制方式：显式声明优先；缺省「有档位清单 = 挡位控制」。
 *
 * 目录里查不到的 spec（def 为 null）一律按自由控制处理——它本来就会落「该组件已不可用」，
 * 不该再被档位逻辑二次改写尺寸。
 */
export function sizeControlOf(def: WidgetDef | null | undefined): SizeControl {
  if (!def) return "free";
  if (def.sizeControl) return def.sizeControl;
  return def.sizeTiers && def.sizeTiers.length ? "tiers" : "free";
}

export function isTierControlled(def: WidgetDef | null | undefined): boolean {
  return sizeControlOf(def) === "tiers";
}

/**
 * 档位清单（已归一化：去重、夹到基准单位上限、按面积由小到大）。
 * 挡位控制的组件至少返回一项（缺清单时退回 defaultSize）；自由控制返回空数组。
 */
export function sizeTiersOf(def: WidgetDef | null | undefined): SizeTier[] {
  if (!def || !isTierControlled(def)) return [];
  const raw = def.sizeTiers && def.sizeTiers.length ? def.sizeTiers : [def.defaultSize];
  const seen = new Set<string>();
  const out: SizeTier[] = [];
  for (const t of raw) {
    const w = Math.max(1, Math.min(Math.round(t.w), BOARD_UNITS));
    const h = Math.max(1, Math.round(t.h));
    const key = w + "x" + h;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ w, h });
  }
  return out.sort((a, b) => (a.w * a.h - b.w * b.h) || (a.w - b.w));
}

/** 档位显示名，例如 "2×2"。 */
export function tierLabel(t: SizeTier): string {
  return t.w + "×" + t.h;
}

/** 档位键，例如 "2x2"（DOM 的 data-size 与护栏都用它）。 */
export function sizeKey(s: SizeTier): string {
  return s.w + "x" + s.h;
}

/**
 * 尺寸 → 档位：先取宽度最接近的档位，再在其中取高度最接近的，并列时取面积更大的那个。
 *
 * 先比宽再比高，是因为白板的列宽是本仓库唯一「硬」的基准（行高由档位自己定），
 * 宽度差一格会直接影响它能不能和邻居并排。
 */
export function snapToTier(def: WidgetDef | null | undefined, size: WidgetSize): WidgetSize {
  const tiers = sizeTiersOf(def);
  if (!tiers.length) return def ? clampSize(def, size) : { w: Math.max(1, Math.round(size.w)), h: Math.max(1, Math.round(size.h)) };
  const dw = Math.min(...tiers.map((t) => Math.abs(t.w - size.w)));
  const byW = tiers.filter((t) => Math.abs(t.w - size.w) === dw);
  const dh = Math.min(...byW.map((t) => Math.abs(t.h - size.h)));
  const byH = byW.filter((t) => Math.abs(t.h - size.h) === dh);
  /* 并列时取面积更大的档位（内容更容易放得下）；byH 非空但 TS 不知道，故用显式初值。 */
  let best = tiers[0] as SizeTier;
  for (const t of byH) {
    if (t.w * t.h > best.w * best.h) best = t;
  }
  return { w: best.w, h: best.h };
}

/** 尺寸落在档位清单里的下标（不在清单里时先吸附再取）。 */
export function tierIndexOf(def: WidgetDef | null | undefined, size: WidgetSize): number {
  const tiers = sizeTiersOf(def);
  if (!tiers.length) return 0;
  const hit = snapToTier(def, size);
  const i = tiers.findIndex((t) => t.w === hit.w && t.h === hit.h);
  return i < 0 ? 0 : i;
}

/**
 * 统一的「尺寸归一」：挡位控制 → 吸附到档位；自由控制 → 按 sizeRange 夹取。
 * 落库、渲染占格、拖拽虚影都走它，避免同一次改动在不同环节得到不同尺寸。
 */
export function normalizeSize(def: WidgetDef | null | undefined, size: WidgetSize): WidgetSize {
  if (isTierControlled(def)) return snapToTier(def, size);
  if (def) return clampSize(def, size);
  return { w: Math.max(1, Math.round(size.w)), h: Math.max(1, Math.round(size.h)) };
}

/** 是否允许在长按菜单里出现「编辑」。 */
export function isEditable(def: WidgetDef | null): boolean {
  return !!def && (def.editableProps?.length ?? 0) > 0;
}

/** spec → 目录主键：预制组件按 id 反查；卡片/自定义/跳转类按 kind 加标识拼键。 */
export function specToDefId(spec: WidgetSpec): string {
  switch (spec.kind) {
    case "text":
      return spec.variant === "title" ? "text-title" : "text-label";
    case "divider":
      return "divider";
    case "card":
      return "card:" + spec.card;
    case "custom":
      return "custom:" + spec.id;
    case "nav":
      return "nav:" + spec.page;
    case "atom-link":
      return "atom:" + spec.ref;
  }
}

/** 反查：目录里是否登记了承载该 spec 的组件（应用侧需把 card/custom/nav 条目注入进来）。 */
export function defForSpec(spec: WidgetSpec, appDefs: readonly WidgetDef[] = []): WidgetDef | null {
  const id = specToDefId(spec);
  const direct = widgetById(id, appDefs);
  if (direct) return direct;
  /* 卡片/自定义类允许应用侧用「前缀 + 标识」登记；再退一步按 kind 找同类条目。 */
  return widgetDefs(appDefs).find((d) => d.spec.kind === spec.kind) ?? null;
}
