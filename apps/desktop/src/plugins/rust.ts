/**
 * Rust 骨干插件运行时（桌面端）：
 * 二进制 spawn + JSON-RPC（activate/run/dispose/interrupt）+ plugin-rpc 事件分发到
 * 同一套 TS 门面（权限集中门禁与 js 插件完全一致）。
 * 移动端不可用（无任意路径二进制）——UI 层禁装。
 */
import { buildApi } from "./facade.js";
import { getPlugin } from "./registry.js";
import { logLine } from "../lib/clients.js";
import type { OnethuApi } from "./types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type RpcHandler = (ns: string, method: string, args: unknown[]) => Promise<unknown>;
let rpcHandler: RpcHandler | null = null;
let rpcListenerReady = false;

async function invoke<T = unknown>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** 拉起一个 rust 插件进程并完成 activate 握手（返回 activate 应答：约定含 commands 清单） */
export async function spawnRustPlugin(id: string, binPath: string, args: string[] = []): Promise<unknown> {
  const rec = getPlugin(id);
  if (!rec) throw new Error(`插件不存在：${id}`);
  await ensureRpcListener();
  const { ensurePluginEventListener } = await import("./events.js");
  await ensurePluginEventListener();
  await invoke("plugin_spawn", { pluginId: id, binPath, args });
  // activate 握手：注入设置值 + 已授权限清单（门面侧仍强制复查）
  return invoke<unknown>("plugin_call", {
    pluginId: id,
    method: "activate",
    params: { settings: rec.settings ?? {}, permissions: rec.manifest.permissions },
    timeoutMs: 30_000,
  });
}

async function ensureRpcListener(): Promise<void> {
  if (rpcListenerReady) return;
  const { listen } = await import("@tauri-apps/api/event");
  await listen<{ pluginId: string; id: number; method: string; params: any }>("plugin-rpc", async (ev) => {
    const { pluginId, id, method, params } = ev.payload;
    if (!rpcHandler) return;
    let ok = true;
    let result: unknown = null;
    try {
      result = await rpcHandler(
        String(params?.ns ?? ""),
        String(params?.method ?? ""),
        Array.isArray(params?.args) ? params.args : [],
      );
    } catch (e) {
      ok = false;
      result = e instanceof Error ? e.message : String(e);
    }
    await invoke("plugin_rpc_reply", { pluginId, id, ok, result: ok ? result : String(result) }).catch(() => undefined);
  });
  rpcListenerReady = true;
}

/** 门面执行器：rust 插件的 onethu.call 按命名空间分发（同一套权限门禁） */
export function bindRustApi(id: string, perms: Set<string>): OnethuApi {
  const api = buildApi(id, perms);
  rpcHandler = async (ns, method, args) => {
    const target = (api as any)[ns];
    if (!target || typeof target[method] !== "function") {
      throw new Error(`未知接口：onethu.${ns}.${method}`);
    }
    return target[method](...args);
  };
  return api;
}

export async function callRust(id: string, method: string, params: unknown, timeoutMs = 600_000): Promise<unknown> {
  return invoke("plugin_call", { pluginId: id, method, params, timeoutMs });
}

export async function notifyRust(id: string, method: string, params: unknown = {}): Promise<void> {
  await invoke("plugin_notify", { pluginId: id, method, params });
}

export async function killRust(id: string): Promise<void> {
  await invoke("plugin_kill", { pluginId: id }).catch(() => undefined);
}

/** dispose（优雅）→ kill（兜底） */
export async function disposeRust(id: string): Promise<void> {
  await invoke("plugin_call", { pluginId: id, method: "dispose", params: {}, timeoutMs: 3_000 }).catch(() => undefined);
  await killRust(id);
  await logLine(`[PLUGIN] rust ${id} 已停止`);
}
