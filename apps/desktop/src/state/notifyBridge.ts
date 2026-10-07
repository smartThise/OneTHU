/**
 * 通知的原生桥（通用层）：把 Tauri 命令收在一处，供设置页与插件 facade 共用。
 *
 * 分层的理由：`pluginNotify.ts` 是**插件语义**（id 前缀、归属、回收），本文件只做
 * 「调哪个命令、参数长什么样」。两者分开后，设置页不必为了查一次权限状态而引入
 * 插件 id 约定，插件侧也不必知道设置页存在。
 */
import { invoke } from "@tauri-apps/api/core";

export interface NativeNotifyStatus {
  ok: boolean;
  /** 平台后端：android / macos / windows / none */
  backend: string;
  granted: boolean;
  exact: boolean;
  reason?: string;
}

/** 查询后端类型（前端据此决定是否启动调度链） */
export async function fetchNotifyBackend(): Promise<string> {
  try {
    return await invoke<string>("notify_backend");
  } catch {
    return "none";
  }
}

/** 查权限/后端状态；`request=true` 时才发起授权请求（用户主动行为） */
export async function fetchNotifyStatus(request = false): Promise<NativeNotifyStatus> {
  const backend = await fetchNotifyBackend();
  if (backend === "none") {
    return { ok: false, backend, granted: false, exact: false, reason: "not-supported" };
  }
  try {
    const raw = (await invoke<Record<string, unknown>>("notify_permission", { request })) as {
      ok?: boolean; granted?: boolean; exact?: boolean; reason?: string;
    };
    return {
      ok: raw?.ok === true,
      backend,
      granted: raw?.granted === true,
      exact: raw?.exact !== false,
      reason: typeof raw?.reason === "string" ? raw.reason : undefined,
    };
  } catch (e) {
    return { ok: false, backend, granted: false, exact: false, reason: String(e).slice(0, 120) };
  }
}

/** 打开系统通知设置：`what` = channels（渠道，可带 channel）/ exact-alarm / app */
export async function openNotifySettings(what: "channels" | "exact-alarm" | "app", channel?: string): Promise<boolean> {
  try {
    const raw = (await invoke<Record<string, unknown>>("notify_open_settings", {
      what,
      channel: channel ?? "",
    })) as { ok?: boolean };
    return raw?.ok === true;
  } catch {
    return false;
  }
}

/** 排一批通知（载荷字段与原生契约一致：id/at/title/body/channel/target） */
export async function scheduleNotifications(
  items: Array<{ id: string; at: number; title: string; body: string; channel?: string; target?: string }>,
): Promise<{ ok: boolean; scheduled: number; reason?: string }> {
  try {
    const raw = (await invoke<Record<string, unknown>>("notify_schedule", {
      items: JSON.stringify(items.map((x) => ({ channel: "briefing", target: "", ...x }))),
    })) as { scheduled?: number; reason?: string };
    const scheduled = Number(raw?.scheduled ?? 0);
    return { ok: scheduled === items.length && items.length > 0, scheduled, reason: typeof raw?.reason === "string" ? raw.reason : undefined };
  } catch (e) {
    return { ok: false, scheduled: 0, reason: String(e).slice(0, 120) };
  }
}

/** 系统侧待投递的通知 id（含插件通知） */
export async function fetchPendingIds(): Promise<string[]> {
  try {
    const raw = (await invoke<{ ids?: string[] }>("notify_pending")) ?? {};
    return Array.isArray(raw.ids) ? raw.ids : [];
  } catch {
    return [];
  }
}

export async function cancelNotifications(ids: string[]): Promise<void> {
  if (!ids.length) return;
  try {
    await invoke("notify_cancel", { ids: JSON.stringify(ids) });
  } catch {
    /* 撤销失败无害：下一轮对齐会再撤一次 */
  }
}

/**
 * 立即投递一条通知（事件驱动，如校园卡余额预警）。
 *
 * 与 `scheduleNotifications` 的分工：排程是「将来某刻发」，这里要的是「现在发」，
 * 因此不走 AlarmManager / AddToSchedule，投递结果如实回报（未授权、后端未接等）。
 * 同一 id 重发即覆盖系统里的那一条，不会堆一屏。
 */
export async function postNotificationNow(item: {
  id: string;
  title: string;
  body: string;
  channel?: string;
  target?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  try {
    const raw = (await invoke<Record<string, unknown>>("notify_post", {
      id: item.id,
      title: item.title,
      body: item.body,
      channel: item.channel ?? "",
      target: item.target ?? "",
    })) as { ok?: boolean; reason?: string };
    return { ok: raw?.ok === true, reason: typeof raw?.reason === "string" ? raw.reason : undefined };
  } catch (e) {
    return { ok: false, reason: String(e).slice(0, 120) };
  }
}

/**
 * 撤回**已展示**的通知（撤销与投递是两条通道）。
 *
 * 不复用 `cancelNotifications` 的原因：那条撤的是「待投递的排程」，Android 侧只做
 * 闹钟撤销与库清理；而已弹出的通知要按同一个 id 从通知栏撤掉——两者混用会让「按计划
 * 对齐」的那轮同步把刚弹出的课程提醒一并抹掉。
 */
export async function dismissNotifications(ids: string[]): Promise<void> {
  if (!ids.length) return;
  try {
    await invoke("notify_dismiss", { ids: JSON.stringify(ids) });
  } catch {
    /* 撤回失败无害：下次观察到余额恢复时会再撤一次 */
  }
}

/** 立即发一条测试通知 */
export async function sendTestNotification(): Promise<boolean> {
  try {
    const raw = (await invoke<Record<string, unknown>>("notify_test")) as { ok?: boolean };
    return raw?.ok === true;
  } catch {
    return false;
  }
}
