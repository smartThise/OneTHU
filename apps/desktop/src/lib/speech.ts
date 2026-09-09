/**
 * 原生语音识别客户端（灵动岛长按）。
 * macOS：SFSpeechRecognizer 桥（speech.m，需 .app bundle + 麦克风/语音识别描述串）。
 * 其他平台/纯浏览器：speechAvailable() = false，长按给出提示而非静默失败。
 */
let cachedSupported: boolean | null = null;

/**
 * 命令名路由：Android 走 onethu-speech 插件（Kotlin SpeechRecognizer），
 * 其余平台走 app 主 crate 命令（macOS speech.m / SFSpeechRecognizer 桥）。
 * WebView UA 含 "Android" 即按 Android 处理（桌面 WKWebView 不含）。
 */
const isAndroid = typeof navigator !== "undefined" && navigator.userAgent.includes("Android");
const cmd = (name: string): string => (isAndroid ? `plugin:onethu-speech|${name}` : name);

export async function speechAvailable(): Promise<boolean> {
  if (cachedSupported !== null) return cachedSupported;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    cachedSupported = await invoke<boolean>(cmd("speech_supported"));
  } catch {
    cachedSupported = false;
  }
  return cachedSupported;
}

/** 开始一次识别（Android 弹麦克风权限；macOS 首次弹系统授权窗；失败抛带原因的 Error） */
export async function speechStart(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke(cmd("speech_start"));
}

/** 当前转写（部分结果，识别中持续更新） */
export async function speechPoll(): Promise<string> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>(cmd("speech_poll"));
  } catch {
    return "";
  }
}

/** 停止（此后 poll 仍能拿到一次最终文本，直到下次 start） */
export function speechStop(): void {
  void import("@tauri-apps/api/core")
    .then((m) => m.invoke(cmd("speech_stop")))
    .catch(() => {
      /* 已尽力 */
    });
}
