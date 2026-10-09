/**
 * KWS 唤醒客户端（Android onethu-voice 插件）。
 * 其他平台 supported=false，UI 诚实降级（与 speech.ts 同约定）。
 * 持续监听在原生层；本文件只做命令封装与事件订阅（报告 §4.2 红线）。
 */
import { isAndroidNavigator } from "./androidHost.js";

const isAndroid = isAndroidNavigator(typeof navigator !== "undefined" ? navigator : undefined);
const cmd = (name: string): string => (isAndroid ? `plugin:onethu-voice|${name}` : name);

/** 平台是否支持唤醒（模型 + JNI 齐备） */
export async function wakeSupported(): Promise<boolean> {
  if (!isAndroid) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>(cmd("wake_supported"));
  } catch {
    return false;
  }
}

/** 开启监听（拉起 microphone 前台服务；权限缺失/模型缺失抛带原因 Error） */
export async function wakeStart(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke(cmd("wake_start"));
}

/** 停止监听（停服务、释放模型与麦克风） */
export async function wakeStop(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke(cmd("wake_stop"));
}

/** 状态回告（fire-and-forget）：recognizing | processing | speaking | done | error */
export function markVoiceState(mark: string): void {
  if (!isAndroid) return;
  void import("@tauri-apps/api/core")
    .then((m) => m.invoke(cmd("wake_mark_state"), { mark }))
    .catch(() => {
      /* 已尽力 */
    });
}

export interface WakeEvent {
  keyword: string;
  timestamp: number;
}
export interface VoiceStateEvent {
  from: string;
  to: string;
}

/** 唤醒命中事件（一次订阅一个回调，返回退订函数） */
export async function onWake(cb: (e: WakeEvent) => void): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  const un = await listen<WakeEvent>("onethu-voice://wake", (ev) => cb(ev.payload));
  return un;
}

/** 状态机事件（from → to；状态真源在 Kotlin） */
export async function onVoiceState(cb: (e: VoiceStateEvent) => void): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  const un = await listen<VoiceStateEvent>("onethu-voice://state", (ev) => cb(ev.payload));
  return un;
}
