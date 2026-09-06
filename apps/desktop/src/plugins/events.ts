/**
 * 插件事件泵：Rust 进程的 progress/log/exit 通知 → 内存环形缓冲 + 订阅。
 * R4：实时进度渲染的数据源（UI 用 useSyncExternalStore 订阅）。
 */
type PluginEvent = { at: number; method: string; text: string; step?: number; total?: number; kind?: string; payload?: unknown };

const MAX = 300;
const buf = new Map<string, PluginEvent[]>();
const listeners = new Set<() => void>();
let started = false;

function push(id: string, ev: PluginEvent): void {
  const arr = buf.get(id) ?? [];
  arr.push(ev);
  if (arr.length > MAX) arr.splice(0, arr.length - MAX);
  buf.set(id, arr);
  for (const l of listeners) l();
}

export function subscribePluginEvents(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function pluginEvents(id: string): PluginEvent[] {
  return buf.get(id) ?? [];
}

export function clearPluginEvents(id: string): void {
  buf.delete(id);
  for (const l of listeners) l();
}

/** 惰性启动全局监听（首个 rust 插件 spawn 时调用一次） */
export async function ensurePluginEventListener(): Promise<void> {
  if (started) return;
  started = true;
  const { listen } = await import("@tauri-apps/api/event");
  await listen<{ pluginId: string; method: string; params: { line?: string; text?: string; step?: number; total?: number; kind?: string; payload?: unknown } }>(
    "plugin-event",
    (ev) => {
      const { pluginId, method, params } = ev.payload;
      const text = params?.text ?? params?.line ?? "";
      push(pluginId, { at: Date.now(), method, text, step: params?.step, total: params?.total, kind: params?.kind, payload: params?.payload });
    },
  );
}
