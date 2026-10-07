/**
 * 桌面小组件的「每一块显示什么」——绑定**按实例**存，不再是一份全局配置。
 *
 * 为什么改：全局一份配置意味着桌面上所有 OneTHU 小组件长得一样，用户没法一排放
 * 「日程与 DDL + 某门课详情 + 常用收藏夹图标组 + 校园卡 1×1 快捷方式」。内容是每块
 * 小组件自己的属性，所以键必须是 appWidgetId（原生侧按同一把键存快照）。
 *
 * 四类内容（对应小组件的四种用法）：
 *   today    日程与 DDL（缺省，最常用的一块）
 *   detail   单个原子占满：显示它的详情，拉得越高行数越多
 *   folder   收藏夹图标组：若干原子图标并列，等于把收藏夹嵌到桌面
 *   shortcut 单个原子的图标快捷方式（1×1 起，像桌面快捷方式）
 *
 * appWidgetId 由系统分配、只在本次安装内稳定，因此这份表只在本机有效——与快照一样，
 * 不属于需要跨设备同步的用户数据（收藏夹与原子本身才是）。
 */
import type { AtomRef } from "./favorites.js";

export type WidgetBinding =
  | { kind: "today" }
  | { kind: "detail"; atom: AtomRef }
  | { kind: "folder"; folderId: string }
  | { kind: "shortcut"; atom: AtomRef };

export interface WidgetInstanceMap {
  /** 未绑定实例的缺省内容（设置页里的「新小组件默认显示」） */
  fallback: WidgetBinding;
  /** appWidgetId → 内容 */
  byId: Record<string, WidgetBinding>;
}

const KEY = "onethu.widget.instances.v1";

export const WIDGET_INSTANCE_DEFAULTS: WidgetInstanceMap = { fallback: { kind: "today" }, byId: {} };

function parseBinding(v: unknown): WidgetBinding | null {
  if (!v || typeof v !== "object") return null;
  const b = v as { kind?: unknown; atom?: { kind?: unknown; key?: unknown }; folderId?: unknown };
  if (b.kind === "today") return { kind: "today" };
  if (b.kind === "folder" && typeof b.folderId === "string" && b.folderId) return { kind: "folder", folderId: b.folderId };
  if ((b.kind === "detail" || b.kind === "shortcut") && b.atom && typeof b.atom.kind === "string" && typeof b.atom.key === "string") {
    return { kind: b.kind, atom: { kind: b.atom.kind, key: b.atom.key } };
  }
  return null;
}

/**
 * 从上一版的**全局**配置迁移（onethu.widget.v1：source 为 today / folder / atom）。
 * 那次改版把「一份全局配置」换成「按实例绑定」，老用户桌面上那块的内容不该因此变样，
 * 于是把全局来源接成缺省内容（新放上去的块用它兜底，原来那块也仍然显示同一份东西）。
 */
function migrateLegacy(): WidgetBinding | null {
  try {
    const raw = JSON.parse(localStorage.getItem("onethu.widget.v1") ?? "null") as
      | { source?: { kind?: string; folderId?: string; atom?: { kind?: string; key?: string } } }
      | null;
    const src = raw?.source;
    if (!src) return null;
    if (src.kind === "folder" && typeof src.folderId === "string" && src.folderId) return { kind: "folder", folderId: src.folderId };
    if (src.kind === "atom" && src.atom && typeof src.atom.kind === "string" && typeof src.atom.key === "string") {
      return { kind: "detail", atom: { kind: src.atom.kind, key: src.atom.key } };
    }
    return null;
  } catch {
    return null;
  }
}

export function loadWidgetInstances(): WidgetInstanceMap {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === null) {
      const legacy = migrateLegacy();
      if (legacy) {
        const next: WidgetInstanceMap = { fallback: legacy, byId: {} };
        // 直接落盘而不是走 save()：loadWidgetInstances 会在渲染期被调用，这里不该触发订阅
        try {
          localStorage.setItem(KEY, JSON.stringify(next));
        } catch {
          /* 配额/隐私模式：本次仍按迁移结果工作 */
        }
        return next;
      }
    }
    const raw = JSON.parse(stored ?? "null") as { fallback?: unknown; byId?: unknown } | null;
    if (!raw || typeof raw !== "object") return { ...WIDGET_INSTANCE_DEFAULTS, byId: {} };
    const fallback = parseBinding(raw.fallback) ?? { kind: "today" };
    const byId: Record<string, WidgetBinding> = {};
    if (raw.byId && typeof raw.byId === "object") {
      for (const [id, v] of Object.entries(raw.byId as Record<string, unknown>)) {
        const b = parseBinding(v);
        if (b) byId[id] = b;      // 坏条目跳过：一块小组件回落缺省内容，不该拖累其他块
      }
    }
    return { fallback, byId };
  } catch {
    return { ...WIDGET_INSTANCE_DEFAULTS, byId: {} };
  }
}

function save(next: WidgetInstanceMap): WidgetInstanceMap {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 配额/隐私模式：内存态照常工作 */
  }
  emit();
  return next;
}

/** 绑定某一块的内容（id 为原生报回的 appWidgetId 字符串） */
export function bindWidgetInstance(id: string | number, binding: WidgetBinding): WidgetInstanceMap {
  const d = loadWidgetInstances();
  return save({ ...d, byId: { ...d.byId, [String(id)]: binding } });
}

/** 解绑（回到缺省内容） */
export function unbindWidgetInstance(id: string | number): WidgetInstanceMap {
  const d = loadWidgetInstances();
  const byId = { ...d.byId };
  delete byId[String(id)];
  return save({ ...d, byId });
}

export function setWidgetFallback(binding: WidgetBinding): WidgetInstanceMap {
  return save({ ...loadWidgetInstances(), fallback: binding });
}

/** 取某一块的内容：没绑定过用缺省 */
export function bindingOf(id: string | number, d: WidgetInstanceMap = loadWidgetInstances()): WidgetBinding {
  return d.byId[String(id)] ?? d.fallback;
}

/** 桌面上已不存在的实例：清掉绑定（原生修剪快照，这里修剪配置，两边口径一致） */
export function pruneWidgetInstances(liveIds: Array<string | number>): WidgetInstanceMap {
  const d = loadWidgetInstances();
  const live = new Set(liveIds.map((x) => String(x)));
  const byId: Record<string, WidgetBinding> = {};
  let dropped = false;
  for (const [id, b] of Object.entries(d.byId)) {
    if (live.has(id)) byId[id] = b;
    else dropped = true;
  }
  return dropped ? save({ ...d, byId }) : d;
}

/** 绑定的人类可读摘要（设置页列表用） */
export function describeBinding(b: WidgetBinding, names: { folder?: string; atom?: string } = {}): string {
  if (b.kind === "today") return "日程与 DDL";
  if (b.kind === "folder") return `收藏夹「${names.folder ?? b.folderId}」图标组`;
  if (b.kind === "detail") return `收藏项详情：${names.atom ?? b.atom.key}`;
  return `快捷方式：${names.atom ?? b.atom.key}`;
}

/* 变更订阅：绑定一变就要重推快照，桌面才跟得上 */
const listeners = new Set<() => void>();

export function subscribeWidgetInstances(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(): void {
  for (const fn of [...listeners]) fn();
}
