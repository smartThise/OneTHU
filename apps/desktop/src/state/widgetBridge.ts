/**
 * 小组件的原生桥：查询「桌面上到底放了几个、快照什么时候更新的」。
 *
 * 这个信息只有原生知道（provider 实例数由 AppWidgetManager 掌握），而它正是
 * 「用户说桌面上没看到」时第一个要查的东西，所以单独成桥供自检使用。
 */
import { invoke } from "@tauri-apps/api/core";
import type { WidgetInstanceInfo } from "./widgetRuntime.js";

export interface NativeWidgetStatus {
  ok: boolean;
  /** 宿主小组件在桌面上放了几个 */
  hostPlaced: number;
  /** 槽位号 → 该槽位小组件放了几个 */
  slotsPlaced: Record<string, number>;
  hasSnapshot: boolean;
  /** 快照生成时刻（毫秒）；0 = 还没有快照 */
  snapshotAt: number;
  /** 槽位号 → 该槽位当前标题（插件声明的内容） */
  slotTitles: Record<string, string>;
  /** 系统侧已登记的 provider（宿主 / 槽位N）——空数组说明清单合并没生效 */
  providersRegistered: string[];
  /** 机型标记：coloros 系（OPPO/OnePlus/realme）；放置路径已与机型无关，标记只用于文案 */
  rom?: string;
  colorOs?: boolean;
  /** 判定依据（brand/prop 命中详情）——真机核对「到底检没检到」用 */
  romSignals?: string;
  reason?: string;
}

/**
 * 桌面上每一块小组件的清单（id / provider / 占位宽高 / 是否已有内容）。
 *
 * 内容按实例绑定，所以「桌面上有哪几块」这件事必须先问原生——AppWidgetManager 才知道。
 * 读失败返回 null：调用方据此**不推实例内容、也不允许原生修剪**（否则会把内容误删）。
 */
export async function fetchWidgetInstances(): Promise<WidgetInstanceInfo[] | null> {
  try {
    const raw = (await invoke<{ ok?: boolean; instances?: WidgetInstanceInfo[] }>("widget_instances")) as {
      ok?: boolean;
      instances?: WidgetInstanceInfo[];
    };
    if (raw?.ok !== true || !Array.isArray(raw.instances)) return null;
    return raw.instances.map((i) => ({
      id: Number(i.id),
      provider: String(i.provider ?? ""),
      w: Number(i.w ?? 0),
      h: Number(i.h ?? 0),
      bound: i.bound === true,
    }));
  } catch {
    return null;      // 桌面端 not-android：诊断与设置页据此跳过
  }
}

/** 一键把小组件放到桌面（系统 requestPinAppWidget）。返回 supported=false 表示该启动器
 *  不支持请求式放置（此时 UI 引导手动长按桌面添加）。R21c：ColorOS 上用户「绑定完桌面上
 *  没有」——选择器与配置流程的行为各家不一，能请求式放置就绕开选择器。 */
export async function pinWidget(): Promise<{ supported: boolean; requested: boolean; reason?: string }> {
  try {
    const raw = (await invoke<Record<string, unknown>>("widget_pin")) as {
      ok?: boolean;
      supported?: boolean;
      requested?: boolean;
      reason?: string;
    };
    if (raw?.ok !== true) return { supported: false, requested: false, reason: raw?.reason ?? "pin-failed" };
    return { supported: raw.supported === true, requested: raw.requested === true, reason: raw.reason };
  } catch (e) {
    return { supported: false, requested: false, reason: String(e).slice(0, 80) };
  }
}

export async function fetchWidgetStatus(): Promise<NativeWidgetStatus | null> {
  try {
    const raw = (await invoke<Record<string, unknown>>("widget_status")) as Partial<NativeWidgetStatus> & { ok?: boolean };
    if (raw?.ok !== true) return null;
    return {
      ok: true,
      hostPlaced: Number(raw.hostPlaced ?? 0),
      slotsPlaced: (raw.slotsPlaced as Record<string, number>) ?? {},
      hasSnapshot: raw.hasSnapshot === true,
      snapshotAt: Number(raw.snapshotAt ?? 0),
      slotTitles: (raw.slotTitles as Record<string, string>) ?? {},
      providersRegistered: Array.isArray(raw.providersRegistered) ? (raw.providersRegistered as string[]) : [],
      rom: typeof raw.rom === "string" ? raw.rom : undefined,
      colorOs: raw.colorOs === true,
      romSignals: typeof raw.romSignals === "string" ? raw.romSignals : undefined,
    };
  } catch {
    return null;      // 桌面端 not-android：诊断里跳过这一步
  }
}
