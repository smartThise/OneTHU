/** 插件注册表：localStorage 持久化 + 极简订阅（useSyncExternalStore 友好） */
import type { PluginRecord } from "./types.js";

const LS_KEY = "onethu.plugins.v1";

let records: PluginRecord[] = load();
const listeners = new Set<() => void>();

function load(): PluginRecord[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as PluginRecord[]) : [];
  } catch {
    return [];
  }
}
function persist(): void {
  localStorage.setItem(LS_KEY, JSON.stringify(records));
}
function emit(): void {
  for (const l of listeners) l();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function snapshot(): PluginRecord[] {
  return records;
}

export function getPlugin(id: string): PluginRecord | undefined {
  return records.find((r) => r.manifest.id === id);
}
/** 安装 rust 插件：manifest 来自二进制同目录 manifest.json，路径原样登记 */
export function addRustPlugin(manifest: PluginRecord["manifest"], binPath: string): PluginRecord {
  const rec: PluginRecord = {
    manifest,
    code: "",
    binPath,
    enabled: true,
    settings: Object.fromEntries((manifest.settings ?? []).filter((f) => f.default != null).map((f) => [f.key, String(f.default)])),
    installedAt: Date.now(),
  };
  addPlugin(rec);
  return rec;
}

export function addPlugin(rec: PluginRecord): void {
  records = [...records.filter((r) => r.manifest.id !== rec.manifest.id), rec];
  persist();
  emit();
}
export function removePlugin(id: string): void {
  records = records.filter((r) => r.manifest.id !== id);
  // 卸载即清存储
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith(`onethu.plugin.${id}.`)) localStorage.removeItem(k);
  }
  persist();
  emit();
}
export function updatePlugin(id: string, patch: Partial<Omit<PluginRecord, "manifest">>): void {
  records = records.map((r) => (r.manifest.id === id ? { ...r, ...patch } : r));
  persist();
  emit();
}

/** 插件私有存储命名空间 */
export function pluginStorageKey(id: string, key: string): string {
  return `onethu.plugin.${id}.${key}`;
}
