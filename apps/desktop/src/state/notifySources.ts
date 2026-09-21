/**
 * 通知/小组件的生产接线：真实订阅 + 真实取数 + 单例运行时。
 *
 * 运行时做成单例的原因：设置页要能「立即应用」「预览即将提醒」，而启动时按下的那条链
 * 必须和它是同一份——两条调度链并行会互相撤销对方的排程（同一批 id 反复排/撤）。
 *
 * 后端类型由原生回答（`notify_backend`），不猜 UA：tauri.conf.json 为适配 Android
 * 的 wengine 指纹固定了 Windows 版 Chrome UA，UA 判定在本项目里不可靠。
 */
import { invoke } from "@tauri-apps/api/core";
import { subscribeCampusData, subscribeLearnData } from "./data.js";
import { runWithoutSemesterSwitch } from "./data.js";
import { onCloudCalChange } from "./cloudCal.js";
import { subscribeExtHw } from "./exthw.js";
import { subscribeHwRemind } from "./hwRemind.js";
import { subscribePluginWidgets } from "../plugins/pluginWidgets.js";
import { loadFavs } from "./favorites.js";
import { resolveAtom } from "./atoms.js";
import { muteToasts } from "./toast.js";
import { resolveWidgetSource } from "./widgetSource.js";
import { subscribeWidgetInstances } from "./widgetInstances.js";
import { atomDetail } from "./widgetDetail.js";
import { liveDetail, warmLiveData } from "./widgetLive.js";
import { fetchWidgetInstances } from "./widgetBridge.js";
import { collectNotifyInputs } from "./notifyInputs.js";
import { cacheGet } from "./cache.js";
import { createNotifyRuntime, type NotifyRuntime } from "./notifyRuntime.js";
import { createWidgetRuntime, type WidgetRuntime } from "./widgetRuntime.js";
import type { NotifyInvoke } from "./notifyScheduler.js";

export type NotifyRuntimeHandle = NotifyRuntime;
export type WidgetRuntimeHandle = WidgetRuntime;

/** 数据源任一变化都重算（防抖在运行时里，订阅这里只做转发）。
 *  含插件小组件注册表：插件重新声明小组件时，桌面上的槽位内容要立刻跟上。 */
export function subscribeNotifySources(fn: () => void): () => void {
  const unsubs = [
    subscribeLearnData(fn),
    subscribeExtHw(fn),
    subscribeHwRemind(fn),
    subscribeCampusData(fn),
    subscribePluginWidgets(fn),
    onCloudCalChange(fn),
    subscribeWidgetInstances(fn),     // 改「某一块小组件显示什么」要立刻重推
  ];
  return () => {
    for (const u of unsubs) u();
  };
}

const invokeBridge: NotifyInvoke = (cmd, args) => invoke(cmd, args ?? {});

let backendKind = "unknown";
const backendListeners = new Set<() => void>();

/** 后端探测完成后通知一次：设置页据此决定「桌面小组件」区块显示开关还是说明 */
export function subscribeNotifyBackend(fn: () => void): () => void {
  backendListeners.add(fn);
  return () => {
    backendListeners.delete(fn);
  };
}
let notifyRuntime: NotifyRuntime | null = null;
let widgetRuntime: WidgetRuntime | null = null;

/** 探测本机通知后端（android / macos / windows / none）；结果缓存 */
export async function detectNotifyBackend(): Promise<string> {
  if (backendKind !== "unknown") return backendKind;
  try {
    backendKind = await invoke<string>("notify_backend");
  } catch {
    backendKind = "none";
  }
  for (const fn of [...backendListeners]) fn();
  return backendKind;
}

export function currentNotifyBackend(): string {
  return backendKind;
}

/** 懒启动单例（首次会先探测后端）；后端为 none 时也会返回运行时，只是所有动作会跳过 */
export async function ensureNotifyRuntime(): Promise<NotifyRuntime> {
  if (notifyRuntime) return notifyRuntime;
  const kind = await detectNotifyBackend();
  notifyRuntime = createNotifyRuntime({
    invoke: invokeBridge,
    backendAvailable: kind !== "none",
    onError: (m) => console.warn("[notify]", m),
    collect: collectNotifyInputs,
    subscribe: subscribeNotifySources,
  });
  return notifyRuntime;
}

/** 生产实现：把某一块小组件绑定的内容解析成原生可画的数据（收藏夹 / 原子详情 / 快捷方式） */
function resolveBindingProd(binding: Parameters<typeof resolveWidgetSource>[0], hint: { maxIcons: number }) {
  const favs = loadFavs();
  return resolveWidgetSource(binding, {
    folders: favs.folders as never,
    maxIcons: hint.maxIcons,
    // 详情补充行：用应用已有数据（课表、作业、实时缓存）把「一个原子占满」填满
    detail: (ref) => {
      // 实时优先：教室占用 / 洗衣机状态（warmLiveData 刚抓过，这里同步读缓存）
      const live = liveDetail(ref as never);
      if (live) return { rows: live.rows, footer: live.footer };
      const v = resolveAtom(ref as never);
      if (!v) return null;
      const inputs = collectNotifyInputs(Date.now());
      const d = atomDetail(ref, { title: v.title, sub: v.sub }, {
        schedule: inputs.schedule,
        homework: inputs.homework,
        now: Date.now(),
        // 校园卡余额：读应用侧 SWR 缓存（小组件进程没有网络；余额由 useCard 拉到后缓存）
        cardBalance: (() => {
          const c = cacheGet<{ info?: { balance?: number } }>("card:30");
          const amount = c?.data?.info?.balance;
          return typeof amount === "number" ? { amount, at: c?.at } : null;
        })(),
      });
      return d ? { rows: d.rows, footer: d.footer } : null;
    },
    resolveAtom: (ref) => {
      const v = resolveAtom(ref as never);
      if (!v) return null;
      // 原子自身的落点由 atoms 的 open 闭包持有；这里用「捕获式 nav」取出来，
      // 而不是在注册表里再维护一份 page/params（两份必然漂移）。
      // 注意 open 可能弹提示（如插件页未启用），故进静音区。
      let hit: { page: string; params?: Record<string, unknown> } | null = null;
      // 静音：这类 open 闭包里既有 toast 也有切学期等副作用，后台算快照时都不该真的发生
      muteToasts(() => {
        try {
          runWithoutSemesterSwitch(() => {
            v.open(((page: string, params?: Record<string, unknown>) => {
              hit = { page: String(page), params };
            }) as never);
          });
        } catch {
          /* 个别原子 open 依赖运行时态：取不到就回落收藏夹落点 */
        }
      });
      return { title: v.title, sub: v.sub, target: hit ?? undefined };
    },
  });
}

export async function ensureWidgetRuntime(): Promise<WidgetRuntime> {
  if (widgetRuntime) return widgetRuntime;
  const kind = await detectNotifyBackend();
  widgetRuntime = createWidgetRuntime({
    invoke: invokeBridge,
    backendAvailable: kind === "android",   // 小组件只有 Android 有承载（桌面端明确不做）
    onError: (m) => console.warn("[widget]", m),
    collect: collectNotifyInputs,
    subscribe: subscribeNotifySources,
    listInstances: fetchWidgetInstances,
    resolveBinding: resolveBindingProd,
    // 下沉原子的实时数据：算快照前顺手抓一遍（带超时，失败就算了）
    warm: (refs) => warmLiveData(refs as never),
  });
  return widgetRuntime;
}

/** 登出/卸载时收摊 */
export function releaseNotifyRuntimes(): void {
  notifyRuntime?.stop();
  widgetRuntime?.stop();
  notifyRuntime = null;
  widgetRuntime = null;
}
