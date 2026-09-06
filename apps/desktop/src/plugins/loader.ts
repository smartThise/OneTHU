/** 插件加载器：blob 动态 import + 权限门面注入 + 生命周期（安装/启用/停用/删除） */
import { buildApi } from "./facade.js";
import { addPlugin, getPlugin, removePlugin, snapshot, subscribe, updatePlugin } from "./registry.js";
import { logLine } from "../lib/clients.js";
import type { OnethuApi, PluginCommand, PluginContext, PluginManifest, PluginRecord } from "./types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface LivePlugin {
  id: string;
  mod: any;
  blobUrl: string;
  dispose?: () => void;
}

/** 命令注册表（管理页渲染 + 执行）；id 全局唯一：pluginId:cmdId */
interface LiveCommand extends PluginCommand {
  pluginId: string;
  run: (input: string) => Promise<unknown> | unknown;
}
const liveCommands = new Map<string, LiveCommand>();
const cmdListeners = new Set<() => void>();
export function subscribeCommands(fn: () => void): () => void {
  cmdListeners.add(fn);
  return () => cmdListeners.delete(fn);
}
export function commandsSnapshot(): LiveCommand[] {
  return [...liveCommands.values()];
}

const live = new Map<string, LivePlugin>();

/** 校验模块形状：须导出 manifest{...} 与 default(ctx) */
function validateManifest(m: unknown): m is PluginManifest {
  if (!m || typeof m !== "object") return false;
  const v = m as Partial<PluginManifest>;
  return typeof v.id === "string" && v.id.length > 0
    && /^[a-z0-9][a-z0-9.-]*$/i.test(v.id)
    && typeof v.name === "string" && v.name.length > 0
    && typeof v.version === "string"
    && Array.isArray(v.permissions);
}

/** 安装（或更新）插件：校验 → 落库 → 立即激活 */
export async function installPlugin(code: string): Promise<PluginManifest> {
  const blobUrl = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  let mod: any;
  try {
    mod = await import(/* @vite-ignore */ blobUrl);
  } catch (e) {
    URL.revokeObjectURL(blobUrl);
    throw new Error(`插件模块加载失败：${String(e).slice(0, 160)}`);
  }
  if (!validateManifest(mod.manifest)) {
    URL.revokeObjectURL(blobUrl);
    throw new Error("插件清单非法：须导出 manifest { id, name, version, permissions[] }");
  }
  if (typeof mod.default !== "function") {
    URL.revokeObjectURL(blobUrl);
    throw new Error("插件须导出 default(ctx) 激活函数");
  }
  const manifest = mod.manifest as PluginManifest;
  const prev = getPlugin(manifest.id);
  await deactivate(manifest.id).catch(() => undefined);
  addPlugin({
    manifest,
    code,
    enabled: true,
    settings: prev?.settings ?? defaultsOf(manifest),
    installedAt: Date.now(),
  });
  await activate(manifest.id, mod, blobUrl);
  await logLine(`[PLUGIN] 安装并激活 ${manifest.id}@${manifest.version}（${manifest.name}）`);
  return manifest;
}

function defaultsOf(m: PluginManifest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of m.settings ?? []) if (f.default != null) out[f.key] = f.default;
  return out;
}

async function activate(id: string, mod?: any, blobUrl?: string): Promise<void> {
  const rec = getPlugin(id);
  if (!rec) throw new Error(`插件不存在：${id}`);
  let m = mod;
  let url = blobUrl;
  if (!m) {
    url = URL.createObjectURL(new Blob([rec.code], { type: "text/javascript" }));
    m = await import(/* @vite-ignore */ url);
  }
  const perms = new Set<string>(rec.manifest.permissions);
  const api: OnethuApi = buildApi(id, perms);
  const ctx: PluginContext = {
    onethu: api,
    registerCommand: (cmd, run) => {
      if (!cmd?.id || typeof run !== "function") return;
      liveCommands.set(`${id}:${cmd.id}`, { ...cmd, pluginId: id, run });
      for (const l of cmdListeners) l();
    },
    log: (line: string) => void logLine(`[PLUGIN:${id}] ${line}`),
  };
  const maybeDispose = await m.default(ctx);
  live.set(id, { id, mod: m, blobUrl: url ?? "", dispose: typeof maybeDispose?.dispose === "function" ? maybeDispose.dispose : undefined });
}

async function deactivate(id: string): Promise<void> {
  const p = live.get(id);
  if (!p) return;
  try {
    p.dispose?.();
    p.mod?.dispose?.();
  } catch (e) {
    await logLine(`[PLUGIN] ${id} dispose 异常：${String(e).slice(0, 120)}`);
  }
  for (const k of [...liveCommands.keys()]) if (k.startsWith(`${id}:`)) liveCommands.delete(k);
  for (const l of cmdListeners) l();
  if (p.blobUrl) URL.revokeObjectURL(p.blobUrl);
  live.delete(id);
}

/* ═══ 管理动作（UI 调用） ═══ */
export async function enablePlugin(id: string): Promise<void> {
  updatePlugin(id, { enabled: true });
  try {
    await activate(id);
  } catch (e) {
    updatePlugin(id, { enabled: false });
    throw e;
  }
}
export async function disablePlugin(id: string): Promise<void> {
  updatePlugin(id, { enabled: false });
  await deactivate(id).catch(() => undefined);
}
export async function uninstallPlugin(id: string): Promise<void> {
  await deactivate(id).catch(() => undefined);
  removePlugin(id);
}
export async function runCommand(pluginId: string, cmdId: string, input: string): Promise<unknown> {
  const c = liveCommands.get(`${pluginId}:${cmdId}`);
  if (!c) throw new Error(`命令未注册或插件未启用：${pluginId}:${cmdId}`);
  return c.run(input);
}
export function isLive(id: string): boolean {
  return live.has(id);
}

/** 应用启动时恢复：激活全部 enabled 插件（失败逐个记日志，不阻塞启动） */
export async function activateInstalledPlugins(): Promise<void> {
  for (const rec of snapshot()) {
    if (!rec.enabled) continue;
    try {
      await activate(rec.manifest.id);
      await logLine(`[PLUGIN] 恢复激活 ${rec.manifest.id}`);
    } catch (e) {
      await logLine(`[PLUGIN] 恢复失败 ${rec.manifest.id}：${String(e).slice(0, 140)}`);
    }
  }
}

/* registry 订阅转发（UI 单一来源） */
export { subscribe, snapshot as installedPlugins };
