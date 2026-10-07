/**
 * 通知状态 → 用户该看到什么（纯函数，可测）。
 *
 * 为什么单独抽出来：这段文案是**唯一的降级沟通渠道**。Android 14 起精确闹钟默认被拒，
 * 用户「明明开了提醒却晚了十分钟」时，全部依赖这里把原因讲清楚、并把去处理的入口摆在
 * 眼前；写成散在 JSX 里的三元表达式就没法测，也就没法保证每种组合都讲到点上。
 */
export type NotifyBackendKind = "android" | "macos" | "windows" | "none" | (string & {});

export interface NotifyStatusInput {
  backend: NotifyBackendKind;
  granted: boolean;
  exact: boolean;
}

export interface NotifyHintAction {
  /** 要打开的系统设置页 */
  kind: "channels" | "exact-alarm" | "app";
  label: string;
}

export interface NotifyHint {
  level: "ok" | "warn" | "error";
  text: string;
  action?: NotifyHintAction;
}

const BACKEND_LABEL: Record<string, string> = {
  android: "Android 通知渠道 + 定时闹钟",
  macos: "macOS 通知中心",
  windows: "Windows 通知",
};

export function notifyHint(s: NotifyStatusInput): NotifyHint {
  const label = BACKEND_LABEL[s.backend] ?? s.backend;

  if (!s.backend || s.backend === "none") {
    return { level: "error", text: "本平台暂未接入系统通知，提醒不会发出（应用内仍可看到待办）。" };
  }
  if (!s.granted) {
    return {
      level: "error",
      text: "通知未授权，提醒发不出来。请到系统设置里为本应用打开通知权限。",
      action: { kind: "app", label: "去系统设置授权" },
    };
  }
  if (s.backend === "android" && !s.exact) {
    return {
      level: "warn",
      text: "通知已可用；「精确提醒」还没允许，系统可能略有延迟（不影响送达）。可在系统设置的「闹钟与提醒」里允许精确提醒。",
      action: { kind: "exact-alarm", label: "允许精确提醒" },
    };
  }
  return {
    level: "ok",
    text: `通知已就绪（${label}）。`,
    action: { kind: "channels", label: s.backend === "android" ? "通知渠道设置" : "系统通知设置" },
  };
}
