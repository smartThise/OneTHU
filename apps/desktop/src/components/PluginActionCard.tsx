/**
 * 白板「插件交互卡片」：宿主只画壳，点击时跑插件自己的命令。
 *
 * 为什么不渲染插件 HTML：卡片是首页/OnePage 上的一等条目，必须可拖动、可缩放、
 * 可删除，且不能把任意脚本塞进宿主文档。壳负责状态展示与点击手势，插件命令负责
 * 真正的业务（加功德、播音效、写自己的 storage），返回一行状态文本给壳显示。
 *
 * 交互细节：
 *   - 状态文本放**左上角**（调用方可返回「功德 42」这类短句），标题在底部；
 *   - 连点不排队不防抖：每次点击立刻发一次命令；只允许较新的结果覆盖显示（乱序保护）；
 *   - 插件停用/卸载：卡片保留并显示「插件已停用」，点击不执行，避免静默消失；
 *   - 全部文本走 textContent，不存在 HTML 注入。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { t as i18n } from "../i18n/index.js";
import type { WidgetSpec } from "../state/boardCore.js";
import { readPluginActionConfig, type PluginActionConfig } from "../state/pluginAction.js";
import { getPlugin, subscribe } from "../plugins/registry.js";
import { runCommand } from "../plugins/loader.js";

/** 命令结果 → 卡片上的一行字（字符串原样；对象取 text/markdown 兜底 JSON）。 */
function actionResultText(result: unknown): string {
  if (typeof result === "string") return result.trim();
  if (result && typeof result === "object") {
    const obj = result as { text?: unknown; markdown?: unknown };
    if (typeof obj.text === "string" && obj.text.trim()) return obj.text.trim();
    if (typeof obj.markdown === "string" && obj.markdown.trim()) return obj.markdown.trim();
    try {
      return JSON.stringify(result);
    } catch {
      return "";
    }
  }
  return result == null ? "" : String(result);
}

function clipStatus(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 120 ? `${clean.slice(0, 120)}…` : clean;
}

function PluginActionCardInner({ config }: { config: PluginActionConfig }): ReactNode {
  const [enabled, setEnabled] = useState<boolean>(() => getPlugin(config.pluginId)?.enabled === true);
  const [status, setStatus] = useState<string>("");
  const [bump, setBump] = useState(0);
  const seq = useRef(0);
  const applied = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /* 插件启用状态跟随注册表变化（停用后卡片变灰、不再执行） */
  useEffect(() => subscribe(() => setEnabled(getPlugin(config.pluginId)?.enabled === true)), [config.pluginId]);

  /* 挂载/重新启用时拉一次状态（statusCmdId 可选；没有就不预取） */
  useEffect(() => {
    if (!enabled || !config.statusCmdId) return;
    let cancelled = false;
    Promise.resolve(runCommand(config.pluginId, config.statusCmdId, config.input))
      .then((out) => {
        if (!cancelled && mounted.current) setStatus(clipStatus(actionResultText(out)));
      })
      .catch(() => {
        if (!cancelled && mounted.current) setStatus(i18n("components.pluginactioncard.failed"));
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, config.pluginId, config.statusCmdId, config.input]);

  const tap = (): void => {
    if (!enabled) return;
    const my = ++seq.current;
    let out: Promise<unknown>;
    try {
      out = Promise.resolve(runCommand(config.pluginId, config.tapCmdId, config.input));
    } catch {
      setStatus(i18n("components.pluginactioncard.failed"));
      return;
    }
    const startedAt = my;
    out
      .then((result) => {
        if (!mounted.current || startedAt < applied.current) return;
        applied.current = startedAt;
        setStatus(clipStatus(actionResultText(result)));
        setBump((n) => n + 1);
      })
      .catch(() => {
        if (mounted.current) setStatus(i18n("components.pluginactioncard.failed"));
      });
  };

  const label = enabled
    ? `${config.title}${status ? ` · ${status}` : ""}`
    : `${config.title} · ${i18n("components.pluginactioncard.disabled")}`;

  return (
    <button
      type="button"
      className="plugin-action-card"
      data-plugin-action={`${config.pluginId}:${config.cardId}`}
      data-disabled={enabled ? undefined : "1"}
      aria-label={label}
      onClick={tap}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          tap();
        }
      }}
    >
      <span className="pac-status">{enabled ? status || " " : i18n("components.pluginactioncard.disabled")}</span>
      <span key={bump} className="pac-icon" aria-hidden="true">
        {config.icon || "◉"}
      </span>
      <span className="pac-title">{config.title}</span>
    </button>
  );
}

/** 自由画布条目 → 插件交互卡片（不是交互卡片返回 null，调用方继续走其它分支）。 */
export function PluginActionCard({ item }: { item: { spec: WidgetSpec; props?: Record<string, unknown> } }): ReactNode {
  const spec = item.spec;
  if (spec.kind !== "custom") return null;
  const merged = item.props ? { ...spec, props: { ...spec.props, ...item.props } } : spec;
  const config = readPluginActionConfig(merged);
  if (!config) return null;
  return <PluginActionCardInner config={config} />;
}