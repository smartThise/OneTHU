/**
 * Rust 骨干插件运行时（桌面 sidecar + 移动内嵌双形态）：
 * - 桌面端：二进制 spawn + JSON-RPC over stdio（activate/run/dispose/interrupt）；
 * - 移动端：onethu-harness-core 直接编进 App 进程（harness_* 命令桥）——
 *   Android 无任意路径二进制执行权限，核心逻辑同一套 Rust 代码。
 * 两种形态的 onethu.call 都转发到同一套 TS 门面（权限集中门禁完全一致）。
 */
import { buildApi } from "./facade.js";
import { getPlugin } from "./registry.js";
import { logLine } from "../lib/clients.js";
import type { OnethuApi } from "./types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type RpcHandler = (ns: string, method: string, args: unknown[]) => Promise<unknown>;
/** 按 pluginId 绑定门面：多 rust 插件并存时各回各家 */
const rpcHandlers = new Map<string, RpcHandler>();
/** 内嵌形态的插件 id：onethu.call 回执走 harness_rpc_reply 而非 plugin_rpc_reply */
const embeddedIds = new Set<string>();
let rpcListenerReady = false;

async function invoke<T = unknown>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** 内嵌形态判定（loader 种入的 Android 内置插件） */
export function isEmbeddedRust(id: string): boolean {
  return embeddedIds.has(id);
}

/** 内嵌：起 App 内 agent 线程 + 门面桥，返回 activate 应答（commands 清单） */
export async function startHarnessEmbedded(id: string): Promise<unknown> {
  const rec = getPlugin(id);
  if (!rec) throw new Error(`插件不存在：${id}`);
  embeddedIds.add(id);
  try {
    await ensureRpcListener();
    const { ensurePluginEventListener } = await import("./events.js");
    await ensurePluginEventListener();
    return await invoke<unknown>("harness_start", { pluginId: id });
  } catch (e) {
    embeddedIds.delete(id); // 启动失败回收标记，避免 callRust 永远路由到不存在的内嵌实例
    throw e;
  }
}

/** 拉起一个 rust 插件进程并完成 activate 握手（返回 activate 应答：约定含 commands 清单） */
export async function spawnRustPlugin(id: string, binPath: string, args: string[] = []): Promise<unknown> {
  const rec = getPlugin(id);
  if (!rec) throw new Error(`插件不存在：${id}`);
  embeddedIds.delete(id);
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
  const handleRpc = async (payload: { pluginId: string; id: number; method: string; params: any }) => {
    const { pluginId, id, method, params } = payload;
    const t0 = Date.now();
    void import("../lib/clients.js").then((m) =>
      m.logLine(`[BRIDGE] #${id} ${params?.method ?? "?"} 门面收到`),
    );
    const handler = rpcHandlers.get(pluginId);
    if (!handler) {
      // R9：绝不能静默丢弃——sidecar 会等回执直到超时（此前 💾 写盘… 卡死即此类丢包）
      // 内嵌（Android）必须走 harness_rpc_reply——写死 sidecar 命令 = 回执永远
      // 不到桥线程，内嵌挂等 BRIDGE_TIMEOUT（600s）→ 登录/恢复会话全链冻结（实录）
      // 双命令兜底：embeddedIds 登记时序与首个 boot 调用存在竞态（0.8.0 安卓全操作
      // 延迟 ~10s 实录）——先试内嵌回执，失败自动走 sidecar 回执，杜绝回执丢失
      await invoke("harness_rpc_reply", { pluginId, id, ok: false, result: "门面未绑定（页面重载后未恢复）" }).catch(
        () => invoke("plugin_rpc_reply", { pluginId, id, ok: false, result: "门面未绑定（页面重载后未恢复）" }).catch(
          (e) => console.error("[plugin-rpc] 双路回执均失败", pluginId, id, e)));
      return;
    }
    let ok = true;
    let result: unknown = null;
    try {
      result = await handler(
        String(params?.ns ?? ""),
        String(params?.method ?? ""),
        Array.isArray(params?.args) ? params.args : [],
      );
    } catch (e) {
      ok = false;
      result = e instanceof Error ? e.message : String(e);
    }
    // 回执分轨：内嵌 → harness_rpc_reply（App 内桥）；sidecar → plugin_rpc_reply（stdin 泵）
    const replyCmd = embeddedIds.has(pluginId) ? "harness_rpc_reply" : "plugin_rpc_reply";
    // R10：void 返回（如取消预约成功）= undefined，Tauri 序列化会丢掉 result 键，
    // Rust 侧「missing required key result」拒收 → 内核永远等不到回执。
    // 统一 coerce：undefined/null → null，保证键恒在。
    const replyResult = ok ? (result ?? null) : String(result);
    await invoke(replyCmd, { pluginId, id, ok, result: replyResult })
      .then(() => {
        void import("../lib/clients.js").then((m) =>
          m.logLine(`[BRIDGE] #${id} 回执已交宿主 ok=${ok} ${Date.now() - t0}ms`),
        );
      })
      .catch((e) => {
        // R9/R10：回执失败必须留痕——静吞 = sidecar 挂等；console 只进 devtools 看不见
        void import("../lib/clients.js").then((m) =>
          m.logLine(`[BRIDGE] #${id} 回执写回失败!! ${String(e).slice(0, 120)}`),
        );
        console.error("[plugin-rpc] 回执写回失败", replyCmd, pluginId, id, e);
      });
  };
  await listen("plugin-rpc", (ev) => void handleRpc(ev.payload));
  // 内嵌长轮询泵：一次取走整批待处理调用，并发执行，消灭每调用事件往返
  for (const pid of embeddedIds) {
    void (async () => {
      for (;;) {
        try {
          const batch = await invoke<{ any: any }[] | any[]>("harness_bridge_take", { pluginId: pid } as any);
          for (const p of batch as any[]) void handleRpc(p);
        } catch {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    })();
  }
  rpcListenerReady = true;
}

/** 门面执行器：rust 插件的 onethu.call 按命名空间分发（同一套权限门禁） */
export function bindRustApi(id: string, perms: Set<string>): OnethuApi {
  const api = buildApi(id, perms);
  rpcHandlers.set(id, async (ns, method, args) => {
    const target = (api as any)[ns];
    if (!target || typeof target[method] !== "function") {
      throw new Error(`未知接口：onethu.${ns}.${method}`);
    }
    return target[method](...args);
  });
  return api;
}

/** 停用/卸载时解绑门面 */
export function unbindRustApi(id: string): void {
  rpcHandlers.delete(id);
}

export async function callRust(id: string, method: string, params: unknown, timeoutMs = 600_000): Promise<unknown> {
  if (embeddedIds.has(id)) {
    return invoke("harness_call", { pluginId: id, method, params, timeoutMs });
  }
  return invoke("plugin_call", { pluginId: id, method, params, timeoutMs });
}

export async function notifyRust(id: string, method: string, params: unknown = {}): Promise<void> {
  if (embeddedIds.has(id)) {
    await invoke("harness_notify", { pluginId: id, method, params });
    return;
  }
  await invoke("plugin_notify", { pluginId: id, method, params });
}

export async function killRust(id: string): Promise<void> {
  if (embeddedIds.has(id)) {
    await invoke("harness_stop", { pluginId: id }).catch(() => undefined);
    return;
  }
  await invoke("plugin_kill", { pluginId: id }).catch(() => undefined);
}

/** dispose（优雅）→ stop/kill（兜底） */
export async function disposeRust(id: string): Promise<void> {
  await callRust(id, "dispose", {}, 3_000).catch(() => undefined);
  await killRust(id);
  unbindRustApi(id);
  await logLine(`[PLUGIN] rust ${id} 已停止`);
}
