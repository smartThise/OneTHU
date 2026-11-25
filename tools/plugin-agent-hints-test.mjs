#!/usr/bin/env node
/** 插件主动提示（agentHint v2）触发筛选护栏。 */
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const H = await import("../apps/desktop/src/plugins/agentHints.ts");

const base = [
  { pluginId: "p1", id: "s", text: "session", triggers: [{ kind: "session-start" }], priority: 1 },
  { pluginId: "p1", id: "k", text: "pdf", triggers: [{ kind: "keyword", keywords: ["PDF", "课件"] }], priority: 5 },
  { pluginId: "p2", id: "c", text: "cmd", triggers: [{ kind: "command", commandId: "read_pdf" }], priority: 9 },
  { pluginId: "p2", id: "n", text: "never", triggers: [{ kind: "keyword", keywords: ["nope"] }], priority: 100 },
];

const s = H.selectAgentHints(base, { mode: "session-start" });
ok(s.length === 1 && s[0].hintId === "s", "session-start 只命中会话提示");

const k = H.selectAgentHints(base, { mode: "turn", query: "帮我读这周的 PDF 课件" });
ok(k.length === 1 && k[0].hintId === "k" && k[0].trigger === "keyword", "关键词大小写/中文命中");

const c = H.selectAgentHints(base, { mode: "command", commandId: "read_pdf" });
ok(c.length === 1 && c[0].hintId === "c", "命令触发");

const many = Array.from({ length: 10 }, (_, i) => ({
  pluginId: "p", id: "h" + i, text: "x", triggers: [{ kind: "session-start" }], priority: i,
}));
const top = H.selectAgentHints(many, { mode: "session-start" });
ok(top.length === 3, "最多 3 条");
ok(top[0].priority === 9 && top[2].priority === 7, "priority 降序截断");

const long = H.selectAgentHints([{ pluginId: "p", id: "l", text: "x".repeat(1000), triggers: [{ kind: "session-start" }] }], { mode: "session-start" });
ok(long[0].text.length === H.AGENT_HINT_TEXT_MAX, "文本截断到 600");

if (fails.length) {
  console.error("plugin-agent-hints-test: " + fails.length + " 项失败");
  for (const f of fails) console.error(" ✗ " + f);
  process.exit(1);
}
console.log("plugin-agent-hints-test: 全部通过");
