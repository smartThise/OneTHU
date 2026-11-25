/**
 * 插件交互卡片（白板组件）的纯数据层。
 *
 * 为什么需要这一层：白板的 `custom` 组件原本只有「用户生成 HTML」（静态、不能交互）。
 * 插件想要一个「点一下有反应」的组件（电子木鱼、打卡计数、小游戏入口），静态 HTML
 * 做不到；这里用 `custom:plugin-action:<pluginId>:<cardId>` 这个保留 id 命名空间，
 * 把「插件 id / 卡片 id / 点击命令 / 状态命令」放进 spec.props，由宿主渲染成一张
 * 可点击卡片，点击时调用插件自己的命令（插件代码在 webview 里，能播音效、改自己的存储）。
 *
 * 边界：
 *   - 纯数据函数，不碰 React / localStorage / 插件加载器（便于 node 护栏直接测）；
 *   - 只允许「本插件自己的命令」（门禁在 facade），卡片不携带任意 HTML/JS；
 *   - 同 pluginId+cardId 重复创建 = 就地更新（不重复长卡）；
 *   - 卡片内容全部按文本渲染（标题/状态/图标都是纯文本），不存在注入面。
 */
import type { BoardItem, WidgetSpec } from "./boardCore.js";

/** 保留的 custom id 前缀；`plugin-action:<pluginId>:<cardId>`。 */
export const PLUGIN_ACTION_PREFIX = "plugin-action:";
/** 默认落位（格）：3×3 够放一个大图标 + 顶部状态 + 底部标题。 */
export const PLUGIN_ACTION_DEFAULT_W = 3;
export const PLUGIN_ACTION_DEFAULT_H = 3;
const PLUGIN_ACTION_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const PLUGIN_ACTION_TITLE_MAX = 60;
const PLUGIN_ACTION_ICON_MAX = 8;
const PLUGIN_ACTION_INPUT_MAX = 200;

export interface PluginActionConfig {
  pluginId: string;
  cardId: string;
  title: string;
  /** 单行文本图标（emoji/一个字），空串回退到宿主默认图标。 */
  icon: string;
  tapCmdId: string;
  /** 空串 = 挂载时不预取状态，点一下才知道。 */
  statusCmdId: string;
  /** 传给命令的固定文本参数（可为空）。 */
  input: string;
}

/** 插件门面入参（未校验）。 */
export interface PluginActionInput {
  cardId?: unknown;
  title?: unknown;
  tapCmdId?: unknown;
  statusCmdId?: unknown;
  icon?: unknown;
  input?: unknown;
  boardId?: unknown;
  x?: unknown;
  y?: unknown;
  w?: unknown;
  h?: unknown;
}

/** 卡片的稳定 id（也写进 spec.id）。 */
export function pluginActionItemId(pluginId: string, cardId: string): string {
  return `${PLUGIN_ACTION_PREFIX}${pluginId}:${cardId}`;
}

/** 反解 spec.id；不是交互卡片返回 null。 */
export function parsePluginActionItemId(id: unknown): { pluginId: string; cardId: string } | null {
  if (typeof id !== "string" || !id.startsWith(PLUGIN_ACTION_PREFIX)) return null;
  const rest = id.slice(PLUGIN_ACTION_PREFIX.length);
  const at = rest.lastIndexOf(":");
  if (at <= 0) return null;
  const pluginId = rest.slice(0, at);
  const cardId = rest.slice(at + 1);
  if (!PLUGIN_ACTION_ID_RE.test(pluginId) || !PLUGIN_ACTION_ID_RE.test(cardId)) return null;
  return { pluginId, cardId };
}

function readText(value: unknown, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > max ? text.slice(0, max) : text;
}

/**
 * 校验并归一化插件门面入参。校验失败抛 Error（门面会把它翻成命令错误）。
 * `pluginId` 由调用方上下文给出，不接受入参伪造。
 */
export function normalizePluginActionConfig(pluginId: string, raw: PluginActionInput | null | undefined): PluginActionConfig {
  if (!PLUGIN_ACTION_ID_RE.test(String(pluginId ?? ""))) throw new Error("插件 id 非法");
  const input = (raw ?? {}) as Record<string, unknown>;
  const cardId = readText(input.cardId, 64);
  if (!PLUGIN_ACTION_ID_RE.test(cardId)) throw new Error("cardId 必须是 1–64 位字母/数字/._-");
  const title = readText(input.title, PLUGIN_ACTION_TITLE_MAX);
  if (!title) throw new Error("title 不能为空");
  const tapCmdId = readText(input.tapCmdId, 64);
  if (!tapCmdId) throw new Error("tapCmdId 不能为空");
  const statusCmdId = readText(input.statusCmdId, 64);
  const icon = readText(input.icon, PLUGIN_ACTION_ICON_MAX);
  const cmd = readText(input.input, PLUGIN_ACTION_INPUT_MAX);
  return { pluginId, cardId, title, icon, tapCmdId, statusCmdId, input: cmd };
}

/** config → 白板 spec（custom 保留命名空间 + props）。 */
export function pluginActionSpec(config: PluginActionConfig): WidgetSpec {
  return {
    kind: "custom",
    id: pluginActionItemId(config.pluginId, config.cardId),
    props: {
      title: config.title,
      icon: config.icon,
      tapCmdId: config.tapCmdId,
      statusCmdId: config.statusCmdId,
      input: config.input,
    },
  };
}

/** 从白板条目还原 config；不是合法交互卡片返回 null（坏数据不炸渲染）。 */
export function readPluginActionConfig(spec: unknown): PluginActionConfig | null {
  if (!spec || typeof spec !== "object") return null;
  const s = spec as { kind?: unknown; id?: unknown; props?: unknown };
  if (s.kind !== "custom") return null;
  const parsed = parsePluginActionItemId(s.id);
  if (!parsed) return null;
  const props = (s.props ?? {}) as Record<string, unknown>;
  return {
    pluginId: parsed.pluginId,
    cardId: parsed.cardId,
    title: readText(props.title, PLUGIN_ACTION_TITLE_MAX) || "插件卡片",
    icon: readText(props.icon, PLUGIN_ACTION_ICON_MAX),
    tapCmdId: readText(props.tapCmdId, 64),
    statusCmdId: readText(props.statusCmdId, 64),
    input: readText(props.input, PLUGIN_ACTION_INPUT_MAX),
  };
}

/** 条目里是否已经是同一张卡（pluginId+cardId）。 */
export function isPluginActionItem(item: BoardItem, config: PluginActionConfig): boolean {
  return item.spec.kind === "custom" && item.spec.id === pluginActionItemId(config.pluginId, config.cardId);
}

export interface PluginActionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 入参里的落位（缺省 0,0 / 3×3）；非法数字回默认，避免写坏板文档。 */
export function pluginActionRect(raw: PluginActionInput | null | undefined): PluginActionRect {
  const r = (raw ?? {}) as Record<string, unknown>;
  const num = (value: unknown, fallback: number, min: number, max: number): number => {
    const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
    return Math.min(max, Math.max(min, n));
  };
  return {
    x: num(r.x, 0, 0, 999),
    y: num(r.y, 0, 0, 999),
    w: num(r.w, PLUGIN_ACTION_DEFAULT_W, 1, 12),
    h: num(r.h, PLUGIN_ACTION_DEFAULT_H, 1, 12),
  };
}

/**
 * 在条目数组里放/更新一张交互卡片（纯函数）。
 * @returns 新数组 + 是否复用（true = 更新了已有卡，不新增）。
 */
export function withPluginActionItem(
  items: readonly BoardItem[],
  config: PluginActionConfig,
  rect: PluginActionRect,
  newItemId: string,
): { items: BoardItem[]; reused: boolean } {
  const spec = pluginActionSpec(config);
  const at = items.findIndex((it) => isPluginActionItem(it, config));
  if (at >= 0) {
    const prev = items[at] as BoardItem;
    const next = items.slice();
    next[at] = {
      ...prev,
      spec,
      cell: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
    };
    return { items: next, reused: true };
  }
  return {
    items: [...items, { id: newItemId, spec, cell: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } }],
    reused: false,
  };
}

/** 从条目数组里移除某张交互卡片；返回新数组与是否移除。 */
export function withoutPluginActionItem(
  items: readonly BoardItem[],
  pluginId: string,
  cardId: string,
): { items: BoardItem[]; removed: boolean } {
  const id = pluginActionItemId(pluginId, cardId);
  const next = items.filter((it) => !(it.spec.kind === "custom" && it.spec.id === id));
  return { items: next, removed: next.length !== items.length };
}