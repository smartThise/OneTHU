/**
 * 「这块小组件显示什么」的解析：把用户绑定的内容变成原生能画的数据。
 *
 * 纯函数 + 依赖注入：收藏夹、原子元数据、以及「详情补充行」都从参数进来，因此可以脱离
 * 应用状态直测——这类「用户挑了个东西，我们把它变成几行字/几个图标」的逻辑最容易在边角
 * 上出错（删掉的原子、空收藏夹、子收藏夹条目、失效的插件原子）。
 *
 * 图标不在这里做：把 React 图标栅格化成 PNG 需要 DOM 与 canvas（见 state/widgetIcon.ts），
 * 本模块只负责产出「要显示哪些原子」，由运行时补图标。
 */
import type { AtomRef } from "./favorites.js";
import type { WidgetBinding } from "./widgetInstances.js";
import { encodeWidgetTarget } from "./widgetTarget.js";

/** 与 widgetSnapshot 的行同形（此处重复声明以避免循环依赖） */
export interface SourceRow {
  text: string;
  sub?: string;
  /** 见 widgetDetail 的 DetailRow：方向色 / 加粗 / 字号档，详情快照会原样透传 */
  color?: string;
  strong?: boolean;
  size?: "sm" | "md" | "lg";
}

/**
 * 解析结果：四类内容里除「今天」之外的三种（今天由 widgetSnapshot 直接算）。
 *
 * `target` 一律是**已编码**的落点字符串（`life?lifeTab=washer&washerBuildingId=…`）：
 * 曾经这里只带 page、把 params 留在旁边，结果图标组那条路上 params 被漏掉，用户点洗衣机
 * 落到生活首页、点课程落到空白课。落点必须在源头就是完整字符串，后面每一层只负责搬运。
 */
export type ResolvedInstance =
  | { kind: "detail"; title: string; rows: SourceRow[]; footer: string; target: string }
  | { kind: "grid"; title: string; target: string; items: Array<{ label: string; ref: AtomRef; target: string }> }
  | { kind: "shortcut"; label: string; sub: string; target: string; ref: AtomRef };

export interface WidgetSourceDeps {
  /** 收藏夹表：id → { title, items } */
  folders: Record<string, { title: string; items: Array<{ t: "a"; atom: AtomRef } | { t: "f"; id: string }> }>;
  /** 原子元数据解析（宿主原子注册表 / 插件原子注册表）；target 为原子自身落点 */
  resolveAtom: (ref: AtomRef) => {
    title: string;
    sub?: string;
    target?: { page: string; params?: Record<string, unknown> };
  } | null;
  /** 详情补充行：用应用里已有的数据把「一个原子占满」填满（课程下次上课、作业 DDL、实时状态…）。
   *  这是小组件「拉长能看到细节」的来源——原生没有业务语义，算不了这些。 */
  detail?: (ref: AtomRef) => { rows: SourceRow[]; footer?: string } | null;
  /** 图标组最多几个（原生按占位算，默认 8 = 2 行 × 4 列） */
  maxIcons?: number;
}

function clip(s: string, n: number): string {
  const t = String(s ?? "").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** 收藏夹内的原子（子收藏夹自身不进图标组：图标组是「原子并列」，嵌夹会没有图标可画） */
function atomsOfFolder(folderId: string, deps: WidgetSourceDeps, max: number): Array<{ label: string; ref: AtomRef; target: string }> {
  const folder = deps.folders[folderId];
  if (!folder) return [];
  const out: Array<{ label: string; ref: AtomRef; target: string }> = [];
  for (const item of folder.items) {
    if (item.t !== "a") continue;                 // 子收藏夹：跳过（图标组里没有可画的图标）
    const meta = deps.resolveAtom(item.atom);
    if (!meta) continue;                          // 原子已失效：跳过（与收藏夹页的降级一致）
    out.push({
      label: clip(meta.title, 6),
      ref: item.atom,
      target: encodeWidgetTarget(meta.target?.page ?? "", meta.target?.params ?? null),
    });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * 解析绑定；返回 null 表示「配置不可用」（收藏夹被删、原子失效）——
 * 调用方据此回落到日程与 DDL，而不是在桌面上留一张空白卡片。
 */
export function resolveWidgetSource(binding: WidgetBinding, deps: WidgetSourceDeps): ResolvedInstance | null {
  const max = Math.max(1, deps.maxIcons ?? 8);

  if (binding.kind === "folder") {
    const folder = deps.folders[binding.folderId];
    if (!folder) return null;
    const items = atomsOfFolder(binding.folderId, deps, max);
    if (items.length === 0) return null;          // 空夹（或全是失效原子）：回落今日视图而不是空面板
    return { kind: "grid", title: clip(folder.title, 12), target: encodeWidgetTarget("folder", { folderId: binding.folderId }), items };
  }

  if (binding.kind === "detail") {
    const meta = deps.resolveAtom(binding.atom);
    if (!meta) return null;
    const extra = deps.detail?.(binding.atom) ?? null;
    const rows: SourceRow[] = [{ text: clip(meta.title, 20), sub: meta.sub ? clip(meta.sub, 22) : undefined }];
    for (const r of extra?.rows ?? []) rows.push(r);
    return {
      kind: "detail",
      title: clip(meta.title, 18),
      rows,
      footer: extra?.footer ?? "",
      target: encodeWidgetTarget(meta.target?.page ?? "", meta.target?.params ?? null),
    };
  }

  if (binding.kind === "shortcut") {
    const meta = deps.resolveAtom(binding.atom);
    if (!meta) return null;
    return {
      kind: "shortcut",
      label: clip(meta.title, 8),
      sub: clip(meta.sub ?? "", 16),
      target: encodeWidgetTarget(meta.target?.page ?? "", meta.target?.params ?? null),
      ref: binding.atom,
    };
  }

  return null;   // today：由 widgetSnapshot 直接算，不经过本模块
}
