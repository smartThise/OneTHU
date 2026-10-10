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

/** 引擎启动失败事件（服务内异常文本；console.error 落 onethu-debug.log 可导出） */
export async function onEngineError(cb: (msg: string) => void): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return await listen("onethu-voice://engine-error", (ev) => {
    cb(String((ev.payload as { message?: string })?.message ?? ""));
  });
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

// ---------- 本地 TTS（同一 onethu-voice 插件；模型运行时下载，不打包） ----------

export interface TtsStatus {
  state: "none" | "downloading" | "extracting" | "ready" | "error" | "unsupported";
  progress: number;
  ready: boolean;
  /** system=Android 系统引擎（默认，零下载，pitch/voice 生效）| neural=sherpa-onnx（可选下载，音质好） */
  backend: "system" | "neural";
}

export async function ttsSupported(): Promise<boolean> {
  if (!isAndroid) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>(cmd("tts_supported"));
  } catch {
    return false;
  }
}

/** 触发后台准备（下载→校验→解包→初始化）；进度轮询 ttsStatus */
export async function ttsPrepare(backend: "system" | "neural" = "system"): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke(cmd("tts_prepare"), { backend });
}

/**
 * 朗读：speed 双后端生效；pitch/voice 仅 system 档；sid 仅 neural 档。
 * 后端由 ttsSetBackend / ttsStatus.backend 决定。
 */
export async function ttsSpeak(
  text: string,
  opts: { speed?: number; pitch?: number; voice?: string; sid?: number } = {},
): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke(cmd("tts_speak"), {
    text,
    speed: opts.speed ?? 1.0,
    pitch: opts.pitch ?? 1.0,
    voice: opts.voice ?? "",
    sid: opts.sid ?? 0,
  });
}

/** 系统引擎中文音色列表（system 档真实生效的音色选择） */
export async function ttsVoices(): Promise<string[]> {
  if (!isAndroid) return [];
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const v = await invoke<{ voices: string[] }>(cmd("tts_voices"));
    return v.voices ?? [];
  } catch {
    return [];
  }
}

/** 切换后端（system 即时可用；neural 需先 ttsPrepare("neural") 下载模型） */
export async function ttsSetBackend(backend: "system" | "neural"): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke(cmd("tts_set_backend"), { backend });
}

export async function ttsStop(): Promise<void> {
  if (!isAndroid) return;
  void import("@tauri-apps/api/core")
    .then((m) => m.invoke(cmd("tts_stop")))
    .catch(() => undefined);
}

export async function ttsStatus(): Promise<TtsStatus> {
  if (!isAndroid) return { state: "unsupported", progress: 0, ready: false, backend: "system" };
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<TtsStatus>(cmd("tts_status"));
  } catch {
    return { state: "unsupported", progress: 0, ready: false, backend: "system" };
  }
}

/** 朗读结束/被停/出错事件 */
export async function onTtsDone(cb: (reason: string) => void): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  const un = await listen<{ reason: string }>("onethu-voice://tts-done", (ev) => cb(ev.payload.reason));
  return un;
}
