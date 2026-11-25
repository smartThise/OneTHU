import { setCliRuntimeActive } from "../state/cliRuntime.js";
import { isPluginRuntimeOwner } from "./windowOwner.js";
import { t as i18n } from "../i18n/index.js";
/** 插件加载器：blob 动态 import + 权限门面注入 + 生命周期（安装/启用/停用/删除） */
import { buildApi } from "./facade.js";
import { isAndroidNavigator } from "../lib/androidHost.js";
import { installTheme, removePluginThemes, type ThemeDef } from "../state/theme.js";
import { isThemeEntry } from "../lib/market.js";
import { registerPluginWidget, unregisterPluginWidgets } from "./pluginWidgets.js";
import { bindRustApi, callRust, disposeRust, spawnRustPlugin, startHarnessEmbedded } from "./rust.js";
import { refreshMadModelRoute, startMadModelPump } from "../state/madmodel.js";
import { ohAuthorized } from "../state/privacyConsent.js";
import { addPlugin, addRustPlugin, getPlugin, removePlugin, snapshot, subscribe, updatePlugin } from "./registry.js";
import { registerPluginTab, unregisterPluginTabs } from "./tabs.js";
/** ctx 方法的权限门禁：manifest.permissions 未声明即抛错（安装确认向用户说明过这些权限） */
function gate(perms: Set<string>, perm: string, what: string): void {
  if (!perms.has(perm)) throw new Error(i18n("plugins.loader.7c3e3fd1ed4c", { what: String(what), perm: String(perm) }));
}
import { pluginAtomKindOf, registerPluginAtom, unregisterPluginAtoms } from "./pluginAtoms.js";
import { logLine } from "../lib/clients.js";
import { AGENT_HINT_TEXT_MAX, selectAgentHints, type AgentHintRequest, type AgentHintTrigger, type LocatedAgentHint, type PluginAgentHint, type SelectedAgentHint } from "./agentHints.js";
import type { OnethuApi, PluginCommand, PluginContext, PluginManifest, PluginRecord } from "./types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface LivePlugin {
  id: string;
  kind: "js" | "rust";
  mod: any;
  blobUrl: string;
  dispose?: () => void;
}

/** 命令注册表（管理页渲染 + 执行）；id 全局唯一：pluginId:cmdId */
interface LiveCommand extends PluginCommand {
  pluginId: string;
  run: (input: string) => Promise<unknown> | unknown;
}
export const liveCommands = new Map<string, LiveCommand>();

/** 插件主动提示词（registerAgentHint）；只由宿主筛选后进入上下文，不直接写系统提示。 */
export const liveAgentHints = new Map<string, LocatedAgentHint>();
const cmdListeners = new Set<() => void>();
/** 缓存快照：变更时重建（getSnapshot 稳定性） */
let cmdCache: LiveCommand[] = [];
function notifyCmds(): void {
  cmdCache = [...liveCommands.values()];
  for (const l of cmdListeners) l();
}
export function subscribeCommands(fn: () => void): () => void {
  cmdListeners.add(fn);
  return () => cmdListeners.delete(fn);
}
export function commandsSnapshot(): LiveCommand[] {
  return cmdCache;
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
export async function installPlugin(
  code: string,
  meta?: { repo?: string },
): Promise<PluginManifest> {
  const blobUrl = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  let mod: any;
  try {
    mod = await import(/* @vite-ignore */ blobUrl);
  } catch (e) {
    URL.revokeObjectURL(blobUrl);
    throw new Error(i18n("plugins.loader.45a9f71f85ee", { value: String(String(e).slice(0, 160)) }));
  }
  if (!validateManifest(mod.manifest)) {
    URL.revokeObjectURL(blobUrl);
    throw new Error(i18n("plugins.loader.343ed9a71667"));
  }
  const isTheme = isThemeEntry(mod.manifest as { category?: string; themes?: unknown } | undefined);
  if (typeof mod.default !== "function" && !(isTheme && mod.theme && typeof mod.theme === "object")) {
    URL.revokeObjectURL(blobUrl);
    throw new Error(isTheme
      ? i18n("plugins.loader.66e63df3fb0a")
      : i18n("plugins.loader.d87b3e6576de"));
  }
  const manifest = mod.manifest as PluginManifest;
  /** 本版模块声明的主题 id（主题插件才有）——覆盖安装时保留，其余旧主题回收 */
  const declaredThemeId = isTheme && mod.theme && typeof mod.theme === "object"
    ? String((mod.theme as ThemeDef).id ?? "")
    : "";
  const prev = getPlugin(manifest.id);
  // 主题插件覆盖安装：先保留主题定义，activate 会用新版重新注册（否则应用中的主题
  // 会在更新瞬间被撤下，用户看到「更新插件 = 掉主题」）
  await deactivate(manifest.id, { keepTheme: isTheme }).catch(() => undefined);
  addPlugin({
    manifest,
    code,
    enabled: true,
    settings: prev?.settings ?? defaultsOf(manifest),
    installedAt: Date.now(),
    repo: meta?.repo ?? manifest.repo,
  });
  await activate(manifest.id, mod, blobUrl);
  // 新版未再声明的旧主题（改了主题 id / 不再提供主题）随覆盖安装回收
  if (isTheme) {
    const stale = removePluginThemes(manifest.id, { keep: declaredThemeId ? [declaredThemeId] : [] });
    if (stale.length) await logLine(`[PLUGIN] 覆盖安装回收旧主题：${stale.join("、")}`);
  }
  await logLine(`[PLUGIN] 安装并激活 ${manifest.id}@${manifest.version}（${manifest.name}）`);
  // 公告热通道（manifest.announce；本体仓库根 NOTICE.md）：非阻塞后台检查
  void trackAnnouncement(manifest, meta?.repo ?? manifest.repo).catch(() => undefined);
  return manifest;
}


/** 公告热通道（公共机制，非插件工具）：仓库根 NOTICE.md 内容 digest 与本机上次记录比对。 */
const NOTICE_TTL_KEY = "onethu.plugin.notice.ttl";
async function trackAnnouncement(
  m: PluginManifest,
  repoUrl?: string,
): Promise<void> {
  try {
    const announce = (m as unknown as { announce?: boolean }).announce === true;
    if (!announce || m.kind === "rust" || !repoUrl || m.id === "onethu.harness") return;
    const now = Date.now();
    let ttl: Record<string, number> = {};
    try { ttl = JSON.parse(localStorage.getItem(NOTICE_TTL_KEY) ?? "{}") as Record<string, number>; } catch { ttl = {}; }
    if ((ttl[m.id] ?? 0) > now) return; // 10 分钟内重复激活不重复拉
    ttl[m.id] = now + 10 * 60 * 1000;
    try { localStorage.setItem(NOTICE_TTL_KEY, JSON.stringify(ttl)); } catch { /* 存不下拉也无妨 */ }
    const { fetchRepoTextFile, parseRepoInput } = await import("../lib/market.js");
    const ref = parseRepoInput(repoUrl);
    const text = await fetchRepoTextFile(ref, "NOTICE.md");
    if (text == null) return;
    // djb2-ish 摘要（短内容稳定标识；避 hash-collision 难度低，展示场景足够）
    let digest = "h";
    for (let i = 0; i < text.length; i++) digest = ((digest.charCodeAt(digest.length - 1) * 33 + text.charCodeAt(i) + 7) % 0x2710).toString() + digest.slice(-1, 2);
    digest = "d" + digest.length + "-" + [...text].reduce((a: number, ch: string) => ((a * 31 + ch.charCodeAt(0)) & 0xffffff), 7).toString(16);
    const rec = getPlugin(m.id);
    const prev = rec?.notice;
    if (prev && prev.digest === digest) {
      // 内容未变：刷新时间戳即可
      updatePlugin(m.id, { notice: { digest, at: Date.now(), text } });
      return;
    }
    updatePlugin(m.id, { notice: { digest, at: Date.now(), text } });
    await logLine(`[PLUGIN] ${m.id} 公告热通道：仓库 NOTICE.md 有新内容（v${m.version}）`);
  } catch {
    /* 公告拉取失败不影响插件使用 */
  }
}

function defaultsOf(m: PluginManifest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of m.settings ?? []) if (f.default != null) out[f.key] = f.default;
  return out;
}

const activations = new Map<string, Promise<void>>();
function activate(id: string, mod?: any, blobUrl?: string): Promise<void> {
  if (!isPluginRuntimeOwner()) return Promise.resolve();
  const pending = activations.get(id);
  if (pending) return pending;
  if (live.has(id)) return Promise.resolve();
  const task = Promise.resolve().then(() => activateOnce(id, mod, blobUrl)).finally(() => { activations.delete(id); });
  activations.set(id, task);
  return task;
}

/** 插件 hint 的入参校验：有界、纯文本、触发条件有限。 */
function normalizeAgentHint(pluginId: string, input: PluginAgentHint): LocatedAgentHint | null {
  if (!input || typeof input !== "object") return null;
  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(id)) return null;
  const text = typeof input.text === "string" ? input.text.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
  if (!text) return null;
  const triggers: AgentHintTrigger[] = [];
  for (const raw of Array.isArray(input.triggers) ? input.triggers.slice(0, 8) : []) {
    const t = raw as Partial<AgentHintTrigger> & { keywords?: unknown };
    if (!t || typeof t !== "object") continue;
    if (t.kind === "session-start") triggers.push({ kind: "session-start" });
    else if (t.kind === "keyword" && Array.isArray(t.keywords)) {
      const keywords = t.keywords.filter((k): k is string => typeof k === "string").map((k) => k.trim()).filter(Boolean).slice(0, 12);
      if (keywords.length) triggers.push({ kind: "keyword", keywords });
    } else if (t.kind === "command" && typeof t.commandId === "string" && t.commandId.trim()) {
      triggers.push({ kind: "command", commandId: t.commandId.trim().slice(0, 64) });
    }
  }
  if (!triggers.length) return null;
  return {
    pluginId,
    id,
    text: text.slice(0, AGENT_HINT_TEXT_MAX),
    triggers,
    priority: Number.isFinite(input.priority) ? Math.max(-100, Math.min(100, Number(input.priority))) : 0,
  };
}

/** 宿主只把「已启用插件」的命中提示交给 OH；禁用的插件即便残留注册也不会注入。 */
export function agentHintsFor(req: AgentHintRequest): SelectedAgentHint[] {
  const hints = [...liveAgentHints.values()].filter((h) => getPlugin(h.pluginId)?.enabled === true);
  return selectAgentHints(hints, req);
}

async function activateOnce(id: string, mod?: any, blobUrl?: string): Promise<void> {
  if (!isPluginRuntimeOwner()) return;
  if (id === "onethu.harness" && !ohAuthorized()) return;
  const rec = getPlugin(id);
  if (!rec) throw new Error(i18n("plugins.loader.e8ce81d059b5", { id: String(id) }));
  let m = mod;
  let url = blobUrl;
  if (!m) {
    url = URL.createObjectURL(new Blob([rec.code], { type: "text/javascript" }));
    m = await import(/* @vite-ignore */ url);
  }
  const perms = new Set<string>(rec.manifest.permissions);
  if (rec.manifest.kind === "rust") {
    bindRustApi(id, perms);
    // 双形态：embedded=App 内嵌核心（Android 内置）；否则 sidecar 二进制（桌面）
    let hand: unknown;
    if (rec.embedded) {
      hand = await startHarnessEmbedded(id);
    } else {
      if (!rec.binPath) throw new Error(i18n("plugins.loader.85a66adff00c"));
      hand = await spawnRustPlugin(id, rec.binPath);
    }
    live.set(id, { id, kind: "rust", mod: null, blobUrl: "" });
    if (id === "onethu.harness") setCliRuntimeActive(true);
    // 约定：activate 应答 { commands: [{id,title,inputLabel?,inputPlaceholder?}] }
    const cmds = (hand as any)?.commands;
    if (Array.isArray(cmds)) {
      for (const c of cmds) {
        if (c?.id && c?.title) {
          liveCommands.set(`${id}:${c.id}`, {
            id: c.id, title: String(c.title), inputLabel: c.inputLabel, inputPlaceholder: c.inputPlaceholder,
            dock: Boolean(c.dock),
            pluginId: id,
            run: async (input: string) => {
              // 所有 chat 入口的预检统一由 callRust 负责。
              const out = await callRust(id, "run", { command: c.id, input });
              // IP 门禁属于路由问题，不能据此废弃仍有效的登录凭证。
              const errMsg = String((out as { error?: string })?.error ?? "");
              if (id === "onethu.harness" && errMsg.includes("307")) {
                void refreshMadModelRoute(true).catch(() => undefined);
              }
              return out;
            },
          });
        }
      }
      notifyCmds();
    }
    return;
  }
  const api: OnethuApi = buildApi(id, perms);
  const ctx: PluginContext = {
    onethu: api,
    registerCommand: (cmd, run) => {
      if (!cmd?.id || typeof run !== "function") return;
      /* agentHint 是插件自己提供的模型侧能力说明；只保留有界纯文本，
         避免插件把超长/控制字符塞进每一次 list_plugin_cmds 结果。 */
      const agentHint = typeof cmd.agentHint === "string"
        ? cmd.agentHint.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 800)
        : undefined;
      liveCommands.set(`${id}:${cmd.id}`, { ...cmd, agentHint: agentHint || undefined, pluginId: id, run });
      notifyCmds();
    },
    registerAgentHint: (hint) => {
      const h = normalizeAgentHint(id, hint);
      if (h) liveAgentHints.set(`${id}:${h.id}`, h);
    },
    /** 注册侧栏功能页（UI 自由化）：pageKey = plugin:<id>:<tabId>，内容经 ui.onTabReady 渲染 */
    registerTab: (tab) => {
      if (!tab?.id || typeof tab.title !== "string") return;
      gate(perms, "ui", "registerTab");
      registerPluginTab({ pageKey: `plugin:${id}:${tab.id}`, pluginId: id, title: String(tab.title), iconSvg: typeof tab.iconSvg === "string" ? tab.iconSvg : undefined });
    },
    /** 注入插件样式（天马行空 CSS）：全局作用，文档规约用 [data-plg="<id>"] 作用域；需 css 权限 */
    registerCss: (css) => {
      gate(perms, "css", "registerCss");
      if (typeof css !== "string" || !css.trim()) return;
      const el = document.createElement("style");
      el.dataset.plgCss = id;
      el.textContent = css;
      document.head.appendChild(el);
    },
    /** 注册原子种类（万物原子化）：使插件结果可收进收藏夹；key 约定 "<tabId>~<原子key>" */
    registerAtom: (def) => {
      if (typeof def?.resolve !== "function") return;
      gate(perms, "ui", "registerAtom");
      registerPluginAtom({
        kind: pluginAtomKindOf(id),
        pluginId: id,
        group: String(def.group ?? "插件"),
        iconSvg: typeof def.iconSvg === "string" ? def.iconSvg : undefined,
        resolve: def.resolve,
      });
    },
    /** 声明桌面小组件（Android）：只声明显示什么；宿主解析原子后交给原生渲染。需 widget 权限 */
    registerWidget: (def) => {
      if (!def?.id || typeof def.title !== "string" || !Array.isArray(def.rows)) return;
      gate(perms, "widget", "registerWidget");
      registerPluginWidget({
        id: String(def.id),
        pluginId: id,
        pluginName: String(rec.manifest.name ?? id),
        title: String(def.title),
        rows: def.rows.filter((r) => r && typeof r === "object"),
        target: typeof def.target === "string" ? def.target : undefined,
      });
    },
    log: (line: string) => void logLine(`[PLUGIN:${id}] ${line}`),
  };
  // 主题插件：注册主题定义（无 default 时不再调用激活函数）
  /* 主题定义来源（同一判定的两个入口，2026-10-12 统一）：
     ① 模块导出 `theme`（显式 category:"theme" 的老写法）
     ② 清单里的 `themes` 数组（推荐写法：主题插件不写 category 也能被认出来） */
  const themeDefs: ThemeDef[] = [];
  if (m.theme && typeof m.theme === "object") themeDefs.push(m.theme as ThemeDef);
  const declaredThemes = (rec.manifest as { themes?: unknown }).themes;
  if (Array.isArray(declaredThemes)) {
    for (const t of declaredThemes) if (t && typeof t === "object") themeDefs.push(t as ThemeDef);
  }
  if (isThemeEntry(rec.manifest as { category?: string; themes?: unknown })) {
    for (const d of themeDefs) {
      installTheme(d, "plugin", id);
      logLine(`[PLUGIN] 主题已注册 ${d.id}（来自插件 ${id}）`);
    }
  }
  if (isThemeEntry(rec.manifest as { category?: string; themes?: unknown }) && typeof m.default !== "function") {
    live.set(id, { id, kind: "js", mod: m, blobUrl: url ?? "", dispose: undefined });
    return;
  }
  const maybeDispose = await m.default(ctx);
  live.set(id, { id, kind: "js", mod: m, blobUrl: url ?? "", dispose: typeof maybeDispose?.dispose === "function" ? maybeDispose.dispose : undefined });
}

async function deactivate(id: string, opts?: { keepTheme?: boolean }): Promise<void> {
  if (!isPluginRuntimeOwner()) return;
  await activations.get(id)?.catch(() => undefined);
  const p = live.get(id);
  if (!p) return;
  if (p.kind === "rust") {
    if (id === "onethu.harness") setCliRuntimeActive(false);
    await disposeRust(id).catch(() => undefined);
    for (const k of [...liveCommands.keys()]) if (k.startsWith(`${id}:`)) liveCommands.delete(k);
    for (const k of [...liveAgentHints.keys()]) if (k.startsWith(`${id}:`)) liveAgentHints.delete(k);
    notifyCmds();
    live.delete(id);
    return;
  }
  try {
    p.dispose?.();
    p.mod?.dispose?.();
  } catch (e) {
    await logLine(`[PLUGIN] ${id} dispose 异常：${String(e).slice(0, 120)}`);
  }
  for (const k of [...liveCommands.keys()]) if (k.startsWith(`${id}:`)) liveCommands.delete(k);
  for (const k of [...liveAgentHints.keys()]) if (k.startsWith(`${id}:`)) liveAgentHints.delete(k);
  for (const l of cmdListeners) l();
  unregisterPluginTabs(id);
  unregisterPluginAtoms(id);
  unregisterPluginWidgets(id);
  for (const el of document.querySelectorAll<HTMLStyleElement>(`style[data-plg-css="${id}"]`)) el.remove();
  if (p.blobUrl) URL.revokeObjectURL(p.blobUrl);
  /** 本版声明的主题 id：模块卸载前取出，供主题回收匹配（历史记录无 owner 时用） */
  const declaredThemeId = p.mod?.theme && typeof p.mod.theme === "object"
    ? String((p.mod.theme as ThemeDef).id ?? "")
    : "";
  live.delete(id);
  // 插件自排的系统通知一并收回：否则卸载后它排的通知还会照常弹出
  {
    const { cancelPluginNotifications } = await import("../state/pluginNotify.js");
    const n = await cancelPluginNotifications(id).catch(() => 0);
    if (n > 0) await logLine(`[PLUGIN] 随插件 ${id} 收回通知 ${n} 条`);
  }
  // 主题插件停用/卸载：其主题一并撤架。停用时看似"顺手删了主题"，但启用会重新注册，
  // 语义上「停用 = 不再提供该外观」；覆盖安装路径已用 keepTheme 排除。
  if (!opts?.keepTheme) {
    const gone = removePluginThemes(id, { ids: declaredThemeId ? [declaredThemeId] : [] });
    if (gone.length) await logLine(`[PLUGIN] 随插件 ${id} 回收主题：${gone.join("、")}`);
  }
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
  const rec = getPlugin(id);
  // 内核守卫：OH 是 App 的一部分（sidecar / 内嵌），任何路径不可卸载
  if (id === "onethu.harness" || rec?.builtin || rec?.embedded) {
    throw new Error(i18n("plugins.loader.125e05bb74f0"));
  }
  await deactivate(id).catch(() => undefined);
  removePlugin(id);
  // 插件目录一并清理（内置插件在 UI 层不可删，不会走到这里）
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("plugin_dir_remove", { id }).catch(() => undefined);
  }
}
export async function runCommand(pluginId: string, cmdId: string, input: string): Promise<unknown> {
  const rec = getPlugin(pluginId);
  if (rec?.manifest.kind === "rust") {
    const out = await callRust(pluginId, "run", { command: cmdId, input });
    return out;
  }
  const c = liveCommands.get(`${pluginId}:${cmdId}`);
  if (!c) throw new Error(i18n("plugins.loader.26133491e82f", { pluginId: String(pluginId), cmdId: String(cmdId) }));
  return c.run(input);
}
export function isLive(id: string): boolean {
  return live.has(id);
}

/** 应用启动时恢复：激活全部 enabled 插件（失败逐个记日志，不阻塞启动） */
export async function activateInstalledPlugins(): Promise<void> {
  if (!isPluginRuntimeOwner()) return;
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

let consentRuntimeTail = Promise.resolve();
export function refreshHarnessConsent(): Promise<void> {
  if (!isPluginRuntimeOwner()) return Promise.resolve();
  return consentRuntimeTail = consentRuntimeTail.catch(() => undefined).then(async () => {
    await deactivate("onethu.harness").catch(() => undefined);
    if (ohAuthorized() && getPlugin("onethu.harness")?.enabled) await activate("onethu.harness");
  });
}

/* registry 订阅转发（UI 单一来源） */
export { subscribe, snapshot as installedPlugins };


/* ═══ Android 内置：Harness 核心编进 App（src-tauri harness_embed），开机种入 ═══ */
const EMBEDDED_HARNESS_MANIFEST: PluginManifest = {
  id: "onethu.harness",
  kind: "rust",
  name: "OneTHU Harness",
  version: "0.1.5",
  author: "smartThise",
  get description() { return i18n("plugins.loader.5567681c1fcb"); },
  permissions: [
    "user:read", "info:read", "card:read", "dorm:read",
    "contacts:read", "org:read", "org:write", "xiaoda:read", "xiaoda:manage", "xiaoda:chat", "vault:read", "vault:write",
    "library:read", "library:book", "network:read",
    "learn:read", "learn:write", "exthw:read", "venue:read", "venue:book", "xk:read", "kongjian:book",
    "cal:read", "cal:write", "mail:read", "mail:write", "cloud:read", "cloud:write",
    "gitlab:read", "gitlab:write",
    "nav", "ui", "storage", "net:external", "llm", "plugins:call"],
  // 文案口径 = plugins/OneTHU-Harness/manifest.json 的桌面版清单（2026-10-13 设置审计）：
  // 标签 ≤42 字、R1 禁词清零（token→通行证/花费上限，上下文→对话历史）、thinking/stream 升 select。
  // 标签改动会触发 seedBuiltinHarness 的清单自愈（一次性重注册，用户 settings 保留），属预期。
  settings: [
    { key: "provider", get label() { return i18n("plugins.loader.6ad329874813"); }, type: "select", default: "", options: [
      { value: "madmodel", get label() { return i18n("plugins.loader.b761f4b378ca"); } },
      { value: "custom", get label() { return i18n("plugins.loader.501704641ca5"); } },
      { value: "", get label() { return i18n("plugins.loader.52ff11b158fd"); } },
    ] },
    { key: "apiKey", get label() { return i18n("plugins.loader.9da85b4807f2"); }, type: "password", placeholder: "sk-…" },
    { key: "baseUrl", get label() { return i18n("plugins.loader.155e1866a76a"); }, type: "text", default: "https://api.deepseek.com/v1" },
    { key: "madmodelModel", get label() { return i18n("plugins.loader.6d64fd9fb7c5"); }, type: "select", optionsFrom: "madmodelModels", options: [
      { value: "", get label() { return i18n("plugins.loader.e9cbdd258b61"); } },
    ] },
    { key: "model", get label() { return i18n("plugins.loader.86ebd904019e"); }, type: "text", default: "deepseek-chat" },
    { key: "thinking", get label() { return i18n("plugins.loader.7de097ef7288"); }, type: "select", options: [
      { value: "off", get label() { return i18n("plugins.loader.2a4b2f825848"); } },
      { value: "on", get label() { return i18n("plugins.loader.5a56669687e7"); } },
    ], default: "off" },
    // 多模态开关（2026-10-11）：**必须与 plugins/OneTHU-Harness/manifest.json 里的同名字段
    // 逐字段同序**——seedBuiltinHarness 的清单自愈走 JSON.stringify 字符串比对，
    // 两处不一致会让「内置 OH 已刷新」每次开机都触发一遍。
    { key: "multimodal", get label() { return i18n("plugins.loader.0c113f1913ec"); }, type: "select", options: [
      { value: "off", get label() { return i18n("plugins.loader.57ebfbd072d4"); } },
      { value: "on", get label() { return i18n("plugins.loader.82022b3e8d52"); } },
    ], default: "off" },
    { key: "maxContext", get label() { return i18n("plugins.loader.845ea122cff3"); }, type: "text", default: "24000" },
    { key: "stream", get label() { return i18n("plugins.loader.c7689034a299"); }, type: "select", options: [
      { value: "on", get label() { return i18n("plugins.loader.334583bcaa6f"); } },
      { value: "off", get label() { return i18n("plugins.loader.f5c252ff822a"); } },
    ], default: "on" },
    { key: "priceIn", get label() { return i18n("plugins.loader.e7a25c627c2f"); }, type: "text", default: "0.27" },
    { key: "priceOut", get label() { return i18n("plugins.loader.360864e1b0cd"); }, type: "text", default: "1.10" },
    { key: "budget", get label() { return i18n("plugins.loader.eb582a7f804c"); }, type: "text", default: "2" },
    { key: "maxSteps", get label() { return i18n("plugins.loader.c3b7ba70078b"); }, type: "text", default: "16" },
    { key: "madmodelToken", get label() { return i18n("plugins.loader.3eed177246c5"); }, type: "text", default: "", auto: true },
    { key: "madmodelAt", get label() { return i18n("plugins.loader.656626d64486"); }, type: "text", default: "", auto: true },
  ],
};

// MadModel 免费档续期泵：模块加载即启动（启动即试一枚 + 10 分钟巡检）
if (isPluginRuntimeOwner()) startMadModelPump();

/* Android 判定（2026-09-19 重写）：主 WebView UA 被 tauri.conf.json 硬编码成
 * Windows Chrome 79（wengine 指纹，Android 同样被覆盖）——UA 判定恒 false，
 * 内嵌种入/自愈分支在真机上从未执行。改用 Rust 编译期命令 os_is_android，
 * invoke 不可用时才退回 UA 兜底。结果缓存（平台一次定，无需反复问）。 */
let androidFlag: boolean | null = null;
async function isAndroid(): Promise<boolean> {
  if (androidFlag != null) return androidFlag;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    androidFlag = await invoke<boolean>("os_is_android");
  } catch {
    androidFlag = isAndroidNavigator(typeof navigator !== "undefined" ? navigator : undefined);
  }
  return androidFlag;
}

// 模块加载即种（先于 activateInstalledPlugins 的恢复激活）；管理页删除后下次开机自动回来。
// 桌面端同样内置：sidecar 二进制随 App 资源打包，开机复制进插件目录
// appData/plugins/onethu.harness/ 并注册（builtin，用户不可删——它就是 App 的一部分）。
// R10 架构：桌面所有插件（导入 + 内置）统一住在 appData/plugins/<id>/。
/* Android 内嵌种入/自愈移入 seedBuiltinHarness（isAndroid 现为异步编译期判定，
 * 模块顶层同步分支无法用；boot 序列 main.tsx 在激活前 await 它，时序不变） */

/** 桌面内置 OH：sidecar 从打包资源落进插件目录，注册/迁移注册表指向。
 *  在 activateInstalledPlugins 之前调用一次；无打包资源（开发未构建）则静默跳过。 */
export async function seedBuiltinHarness(): Promise<void> {
  if (!isPluginRuntimeOwner()) return;
  if (await isAndroid()) {
    // 内嵌核心（编进 App 进程）：种入/自愈内置 manifest。APK 更新=内置清单可能变
    // （新设置字段/权限），老注册表不清则设置 sheet 永远看不到新字段。
    const prev = getPlugin("onethu.harness");
    if (!prev) {
      addRustPlugin(EMBEDDED_HARNESS_MANIFEST, "", { embedded: true, builtin: true });
      await logLine("[PLUGIN] 内嵌 OH 已种入").catch(() => undefined);
    } else if (JSON.stringify(prev.manifest) !== JSON.stringify(EMBEDDED_HARNESS_MANIFEST)) {
      // 用户 settings 全程保留（历史实锤：removePlugin 会连 settings 一起清）
      const prevSettings = { ...prev.settings };
      removePlugin("onethu.harness");
      addRustPlugin(EMBEDDED_HARNESS_MANIFEST, "", { embedded: true, builtin: true });
      if (Object.keys(prevSettings).length > 0) {
        updatePlugin("onethu.harness", { settings: prevSettings });
      }
      await logLine(`[PLUGIN] 内嵌 OH 清单已随 APK 刷新（settings 保留 ${Object.keys(prevSettings).length} 项）`).catch(() => undefined);
    }
    return;
  }
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const binPath = await invoke<string | null>("builtin_sidecar_install");
    if (!binPath) {
      await logLine("[PLUGIN] 内置 OH sidecar 资源缺失（先跑 build:harness），跳过种入");
      return;
    }
    const rec = getPlugin("onethu.harness");
    if (!rec) {
      addRustPlugin(EMBEDDED_HARNESS_MANIFEST, binPath, { builtin: true });
      await logLine(`[PLUGIN] 内置 OH 已注册：${binPath}`);
    } else {
      // 旧记录自愈：历史版本注册 OH 时未打 builtin 标，导致管理页出现删除键
      if (!rec.builtin) updatePlugin("onethu.harness", { builtin: true });
      // 权限快照自愈：装机清单缺新权限（如 learn:read/xk:read）时以内置清单为准并入，
      // 免「重装才能用新功能」（R10 实录：扩展权限后 dock 报未获授权）
      const perms = new Set(rec.manifest.permissions ?? []);
      let changed = false;
      for (const p of EMBEDDED_HARNESS_MANIFEST.permissions ?? []) {
        if (!perms.has(p)) { perms.add(p); changed = true; }
      }
      // settings 清单自愈同款（2026-09-19）：内置清单新增字段（如 MadModel 的
      // provider 下拉）时老注册表还是旧 manifest——设置 sheet 永远看不到新字段
      const settingsChanged =
        JSON.stringify(rec.manifest.settings ?? []) !== JSON.stringify(EMBEDDED_HARNESS_MANIFEST.settings ?? []);
      if (changed || settingsChanged || rec.binPath !== binPath) {
        // ⚠️ 重注册必须保住用户填的 settings（API Key/模型/预算…）——
        // removePlugin 会连 settings 一起清，历史实锤：每次扩展权限清单
        // （mail:read→cloud:read 两轮）用户都得重新粘贴 deepseek key
        const prevSettings = { ...rec.settings };
        removePlugin("onethu.harness");
        addRustPlugin(
          { ...EMBEDDED_HARNESS_MANIFEST, permissions: [...perms] },
          binPath,
        );
        if (Object.keys(prevSettings).length > 0) {
          updatePlugin("onethu.harness", { settings: prevSettings });
        }
        await logLine(`[PLUGIN] 内置 OH 已刷新（权限${settingsChanged ? "/设置清单" : ""}/路径迁移，settings 保留）：${binPath}`);
      }
    }
  } catch (e) {
    await logLine(`[PLUGIN] 内置 OH 种入失败：${String(e).slice(0, 140)}`);
  }
}
