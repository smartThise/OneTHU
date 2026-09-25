/**
 * 小组件运行时：数据变化 → 按「每一块」重算内容 → 推给原生重画。
 *
 * 与通知是两条独立链路：小组件没有总开关（放不放由用户决定），也不受静默时段影响；
 * 但它同样需要「跨天/滚动时间」的定时重算——内容里的「还有 3 小时」是算出来的文本，
 * 不重推就会停在旧值上（原生侧没有课表语义，算不了）。
 *
 * 因此这里的策略是**每次都推**（而不是像通知那样只推差异）：一次 SharedPreferences
 * 写入 + 一次 RemoteViews 重画，成本可忽略，换来的是小组件上永远没有过期文案。
 *
 * 内容是**按实例**算的：桌面上可以同时放日程与 DDL、某个原子的详情、某个收藏夹的图标组、
 * 某个功能页的 1×1 快捷方式。实例清单只能问原生（AppWidgetManager 才知道桌面上有哪几块）。
 */
import { getHwRemindState } from "./hwRemind.js";
import type { PlanHomework, PlanScheduleEntry } from "./notifyPlan.js";
import type { NotifyInvoke } from "./notifyScheduler.js";
import {
  buildDetailSnapshot, buildGridSnapshot, buildShortcutSnapshot, buildWidgetSnapshot,
  serializeWidgetPush, WIDGET_MAX_ROWS,
  type WidgetInstanceContent, type WidgetSnapshot,
} from "./widgetSnapshot.js";
import { collectWidgetSlots } from "../plugins/pluginWidgets.js";
import { atomIconPng } from "./widgetIcon.js";
import {
  bindingOf, loadWidgetInstances, pruneWidgetInstances, type WidgetBinding,
} from "./widgetInstances.js";
import type { ResolvedInstance } from "./widgetSource.js";
import { createSyncer } from "./displaySyncer.js";

/** 桌面上的一块小组件（原生 AppWidgetManager 报回） */
export interface WidgetInstanceInfo {
  id: number;
  /** provider 类名（诊断用） */
  provider?: string;
  /** 占位宽高（dp） */
  w: number;
  h: number;
  /** 是否已有内容（未绑定/刚放上去时为 false） */
  bound?: boolean;
}

export interface WidgetRuntimeDeps {
  invoke: NotifyInvoke;
  /** 本平台是否有小组件承载（当前只有 Android） */
  backendAvailable: boolean;
  collect: (now: number) => { schedule: PlanScheduleEntry[]; homework: PlanHomework[] };
  subscribe: (fn: () => void) => () => void;
  onError?: (m: string) => void;
  /** 读桌面上有哪些小组件（读失败返回 null：此时不推实例内容，也绝不允许原生修剪） */
  listInstances?: () => Promise<WidgetInstanceInfo[] | null>;
  /** 解析某块小组件绑定的内容（收藏夹 / 原子详情 / 快捷方式）；返回 null 表示配置已失效 */
  resolveBinding?: (binding: WidgetBinding, hint: { maxIcons: number }) => ResolvedInstance | null;
  /** 原子图标栅格化（缺省用 widgetIcon 的实现；测试里可注入固定值） */
  iconPng?: (ref: { kind: string; key: string }, size: number) => Promise<string | null>;
  /** 抓取「桌面上正显示的那些原子」需要的实时数据（教室占用 / 洗衣机状态）。
   *  必须在算内容之前 await：小组件进程没有网络，实时值只能在这条链上补。 */
  warm?: (refs: Array<{ kind: string; key: string }>) => Promise<void>;
  debounceMs?: number;
  tickMs?: number;
}

export interface WidgetRuntime {
  /** 立即重算并推送一次，返回是否推成功 */
  syncNow: () => Promise<boolean>;
  /** 最近一次推的「日程与 DDL」快照（设置页预览 / 调试） */
  snapshot: () => WidgetSnapshot | null;
  /** 最近一次推的每块内容（调试用） */
  contents: () => Record<string, WidgetInstanceContent>;
  stop: () => void;
}

/** 图标组容量：与原生 gridCapacity 同口径（每格约 56dp，2 行 × 4 列封顶） */
export function gridCapacity(w: number, h: number): number {
  if (w <= 0 && h <= 0) return 4;
  const cols = w <= 0 ? 3 : Math.min(4, Math.max(2, Math.floor((w + 28) / 56)));
  const rows = h <= 0 ? 1 : Math.min(2, Math.max(1, Math.floor((h + 20) / 56)));
  return cols * rows;
}

export function createWidgetRuntime(deps: WidgetRuntimeDeps): WidgetRuntime {
  let last: WidgetSnapshot | null = null;
  let lastContents: Record<string, WidgetInstanceContent> = {};
  const icon = deps.iconPng ?? atomIconPng;

  /** 某一块的内容：绑定解析失败一律回落「日程与 DDL」，不在桌面上留空白卡片 */
  async function contentFor(binding: WidgetBinding, resolved: ResolvedInstance | null, today: WidgetSnapshot, now: number): Promise<WidgetInstanceContent> {
    if (binding.kind === "today" || !resolved) return today;
    if (resolved.kind === "detail") {
      return buildDetailSnapshot({
        title: resolved.title, rows: resolved.rows, footer: resolved.footer,
        target: resolved.target, now,
        // 候选行给足：原生 fitRows(h) 按真实高度铺满——矮的只显示一两行，拉长的全铺上
        // （校园卡流水这类「越长越有用」的内容靠这个生效）
        maxRows: WIDGET_MAX_ROWS,
      });
    }
    if (resolved.kind === "grid") {
      const items = [];
      for (const it of resolved.items) {
        items.push({ label: it.label, icon: (await icon(it.ref, 72)) ?? undefined, target: it.target });
      }
      return buildGridSnapshot({ title: resolved.title, items, target: resolved.target, now });
    }
    return buildShortcutSnapshot({
      label: resolved.label, sub: resolved.sub, icon: (await icon(resolved.ref, 96)) ?? undefined,
      target: resolved.target, now,
    });
  }

  async function apply(
    inputs: { schedule: PlanScheduleEntry[]; homework: PlanHomework[] },
    now: number,
  ): Promise<boolean> {
    if (!deps.backendAvailable) return false;
    const today = buildWidgetSnapshot({
      schedule: inputs.schedule,
      homework: inputs.homework,
      remind: getHwRemindState(),
      now,
    });

    // 桌面上有哪些块：读不到时（原生忙/命令不可用）不推实例内容，只推插件槽位
    const insts = (await deps.listInstances?.()) ?? null;
    const contents: Record<string, WidgetInstanceContent> = {};
    if (insts) {
      const map = loadWidgetInstances();
      // 两趟：先把每块绑定的原子解析出来，抓齐实时数据（教室占用 / 洗衣机状态）再算内容——
      // 「本节空闲」「还剩 23 分钟」这类值只有应用抓得到，小组件进程里没有网络。
      const resolvedById = new Map<number, ReturnType<NonNullable<WidgetRuntimeDeps["resolveBinding"]>>>();
      const need: Array<{ kind: string; key: string }> = [];
      for (const inst of insts) {
        const binding = bindingOf(inst.id, map);
        const resolved = binding.kind === "today" ? null : deps.resolveBinding?.(binding, { maxIcons: gridCapacity(inst.w, inst.h) }) ?? null;
        resolvedById.set(inst.id, resolved);
        if (!resolved) continue;
        if (resolved.kind === "grid") for (const it of resolved.items) need.push(it.ref);
        else if (resolved.kind === "shortcut") need.push(resolved.ref);
        else need.push(binding.kind === "detail" ? binding.atom : { kind: "", key: "" });
      }
      if (deps.warm && need.length) {
        try {
          await deps.warm(need);
        } catch {
          /* 抓不到就少写几行实时状态，绝不因此中断推送 */
        }
      }
      for (const inst of insts) {
        contents[String(inst.id)] = await contentFor(bindingOf(inst.id, map), resolvedById.get(inst.id) ?? null, today, now);
      }
      // 绑定表跟着实际存在的实例走：桌面上没了就清掉，避免越积越多
      pruneWidgetInstances(insts.map((i) => i.id));
    }

    // 插件小组件槽位：注册表是纯数据，直接读（插件的原子解析在 collectWidgetSlots 里完成）
    const slots: Record<string, { title: string; rows: Array<{ text: string; sub?: string }>; footer: string; target: string }> = {};
    for (const s of collectWidgetSlots()) {
      if (!s?.slot) continue;
      slots[String(s.slot)] = {
        title: String(s.title ?? "插件小组件"),
        rows: (s.rows ?? []).map((r) => ({ text: String(r.text ?? ""), sub: r.sub ? String(r.sub) : undefined })),
        footer: String(s.footer ?? ""),
        target: String(s.target ?? ""),
      };
    }

    try {
      const raw = (await deps.invoke("widget_push", {
        snapshot: serializeWidgetPush({ instances: contents, slots, prune: insts !== null }),
      })) as Record<string, unknown> | null;
      const ok = raw?.ok === true;
      if (ok) {
        last = today;
        lastContents = contents;
      }
      return ok;
    } catch (e) {
      // 推送失败不抛给调用方（设置页按钮 / 定时任务都不该因此炸），但必须上报且不记快照
      deps.onError?.(String(e).slice(0, 160));
      return false;
    }
  }

  let lastOk = false;
  const syncer = createSyncer({
    collect: deps.collect,
    subscribe: deps.subscribe,
    run: async (inputs, now) => {
      lastOk = await apply(inputs, now);
    },
    debounceMs: deps.debounceMs,
    tickMs: deps.tickMs,
    onError: deps.onError,
  });

  return {
    syncNow: async () => {
      await syncer.syncNow();
      return lastOk;
    },
    snapshot: () => last,
    contents: () => lastContents,
    stop: () => syncer.stop(),
  };
}
