/**
 * AI 选课助手（nextthuxk ai.js 移植）：BYO OpenAI 兼容 API（OpenAI/DeepSeek 等）。
 * 配置存 localStorage；课程推荐与智能排课均要求模型输出 JSON。
 */
export interface AiConfig { base: string; model: string; token: string; pref: string }
const LS_KEY = "onethu.xk.ai";
export function loadAiConfig(): AiConfig {
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as AiConfig;
  } catch { /* 容错 */ }
  return { base: "", model: "", token: "", pref: "" };
}
export function saveAiConfig(cfg: AiConfig): void {
  try { globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(cfg)); } catch { /* 配额 */ }
}

export async function callAi(cfg: AiConfig, system: string, user: string): Promise<string> {
  if (!cfg.base || !cfg.model) throw new Error("请先在 AI 配置里填写 API Base URL 和模型名称");
  const base = cfg.base.replace(/\/+$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}) },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.3,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`AI 接口 ${res.status}: ${t.slice(0, 160)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const out = data.choices?.[0]?.message?.content ?? "";
  if (!out) throw new Error("AI 返回为空");
  return out;
}

/** 从模型输出里抠 JSON 数组（容忍 ```json 围栏与前后闲话） */
export function extractJsonArray<T>(raw: string): T[] {
  const m = /\[[\s\S]*\]/.exec(raw);
  if (!m) throw new Error("AI 输出里没有 JSON 数组");
  return JSON.parse(m[0]) as T[];
}
