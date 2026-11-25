/**
 * 插件主动提示词（agentHint v2）的纯筛选层。
 *
 * 插件不直接改系统提示词，只声明「什么时机适用」；宿主按会话开始 / 关键词 /
 * 命令三种触发筛选，并按 priority 截断。这样提示词是可审计的数据，不是
 * 插件对系统提示的任意写入。
 */
export type AgentHintTrigger =
  | { kind: "session-start" }
  | { kind: "keyword"; keywords: string[] }
  | { kind: "command"; commandId: string };

export interface PluginAgentHint {
  /** 插件内唯一 */
  id: string;
  /** ≤600 字，纯文本 */
  text: string;
  triggers: AgentHintTrigger[];
  /** 越大越优先 */
  priority?: number;
}

export interface LocatedAgentHint extends PluginAgentHint {
  pluginId: string;
}

export type AgentHintMode = "session-start" | "turn" | "command";

export interface AgentHintRequest {
  mode: AgentHintMode;
  /** turn 模式：用户这一轮输入 */
  query?: string;
  /** command 模式：即将执行的命令 id */
  commandId?: string;
}

export interface SelectedAgentHint {
  pluginId: string;
  hintId: string;
  text: string;
  priority: number;
  trigger: "session-start" | "keyword" | "command";
}

export const AGENT_HINT_MAX = 3;
export const AGENT_HINT_TEXT_MAX = 600;

/** 把一条插件 hint 与当前时机匹配；不匹配返回 null。 */
function matchOne(h: LocatedAgentHint, req: AgentHintRequest): SelectedAgentHint | null {
  const query = String(req.query ?? "").toLowerCase();
  const commandId = String(req.commandId ?? "");
  let trigger: SelectedAgentHint["trigger"] | null = null;
  for (const t of h.triggers) {
    if (!t || typeof t !== "object") continue;
    if (req.mode === "session-start" && t.kind === "session-start") { trigger = "session-start"; break; }
    if (req.mode === "turn" && t.kind === "keyword") {
      const hit = t.keywords.some((k) => k.trim() && query.includes(k.trim().toLowerCase()));
      if (hit) { trigger = "keyword"; break; }
    }
    if (req.mode === "command" && t.kind === "command" && t.commandId === commandId) { trigger = "command"; break; }
  }
  if (!trigger) return null;
  return {
    pluginId: h.pluginId,
    hintId: h.id,
    text: h.text.slice(0, AGENT_HINT_TEXT_MAX),
    priority: Number.isFinite(h.priority) ? Number(h.priority) : 0,
    trigger,
  };
}

/** 当前时机命中的提示：priority 降序、同 priority 保持注册顺序；最多 3 条。 */
export function selectAgentHints(hints: readonly LocatedAgentHint[], req: AgentHintRequest): SelectedAgentHint[] {
  const out: SelectedAgentHint[] = [];
  for (const h of hints) {
    const hit = matchOne(h, req);
    if (hit) out.push(hit);
  }
  return out
    .sort((a, b) => b.priority - a.priority)
    .slice(0, AGENT_HINT_MAX);
}
