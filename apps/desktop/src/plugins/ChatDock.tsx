/** 左下角常驻对话面板（宿主胶水，R2/R4/R5 的 dock 面）：
 *  发现 activate 返回 dock:true 命令的已启用 rust 插件 → 显示常驻气泡；
 *  对话/会话/导出/用量全部走该插件的 JSON-RPC run 命令（结构化契约见
 *  OneTHU-Harness README 与接口指南 §九），本组件不含任何业务逻辑。
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { callRust, notifyRust } from "./rust.js";
import { commandsSnapshot, subscribeCommands } from "./loader.js";
import { pluginEvents, subscribePluginEvents } from "./events.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const OPEN_KEY = "onethu.chatdock.open";

interface ViewMsg {
  role: "user" | "assistant";
  text: string;
}
interface UsageInfo {
  sessionCostUsd?: number;
  totalCostUsd?: number;
  budgetUsd?: number;
  budgetLeftUsd?: number;
  sessionPrompt?: number;
  sessionCompletion?: number;
  totalPrompt?: number;
  totalCompletion?: number;
  totalCalls?: number;
}
interface SessionRow {
  id: string;
  title: string;
  updatedAt: number;
  messages: number;
  costUsd: number;
}

function readOpen(): boolean {
  const raw = localStorage.getItem(OPEN_KEY);
  return raw == null ? true : raw === "1"; // 首次安装默认弹出
}
function fmtUsd(v?: number): string {
  if (v == null) return "-";
  if (v === 0) return "$0";
  return v < 0.01 ? `$${v.toFixed(5)}` : `$${v.toFixed(4)}`;
}

export function ChatDock(): ReactNode {
  const cmds = useSyncExternalStore(subscribeCommands, commandsSnapshot);
  const dockCmd = cmds.find((c) => c.dock && c.id === "chat");
  const pid = dockCmd?.pluginId ?? null;

  const [open, setOpen] = useState(readOpen);
  const [msgs, setMsgs] = useState<ViewMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState<string | null>(null);
  const [trace, setTrace] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmCard, setConfirmCard] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageInfo>({});
  const [history, setHistory] = useState<SessionRow[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const hydratedFor = useRef<string | null>(null);
  const seenEv = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const toggle = (): void => {
    setOpen((o) => {
      localStorage.setItem(OPEN_KEY, o ? "0" : "1");
      if (!o) setUnread(0);
      return !o;
    });
  };

  // 插件变更：清视图，重挂水合标记
  useEffect(() => {
    hydratedFor.current = null;
    setMsgs([]);
    setStream(null);
    setTrace([]);
    setConfirmCard(null);
    setUsage({});
    seenEv.current = 0;
    setHistory(null);
  }, [pid]);

  // 水合：打开面板且尚未载入当前会话 → 导出会话 JSON 还原视图（R5）
  useEffect(() => {
    if (!pid || !open || hydratedFor.current === pid) return;
    hydratedFor.current = pid;
    void (async () => {
      try {
        const res: any = await callRust(pid, "run", { command: "export_session", input: "" });
        if (res?.ok && res.json) {
          const s = JSON.parse(res.json);
          const view: ViewMsg[] = [];
          for (const m of s.messages ?? []) {
            if (m.role === "user" && m.content) view.push({ role: "user", text: m.content });
            else if (m.role === "assistant" && m.content) view.push({ role: "assistant", text: m.content });
          }
          setMsgs(view);
          if (s.usage) setUsage((u) => ({ ...u, sessionPrompt: s.usage.prompt, sessionCompletion: s.usage.completion, sessionCostUsd: s.cost_usd }));
        } else {
          setMsgs([]);
        }
      } catch {
        setMsgs([]);
      }
    })();
  }, [pid, open]);

  // 事件泵：流式增量 / 工具轨迹 / 用量（R4）
  const events = useSyncExternalStore(subscribePluginEvents, pid ? () => pluginEvents(pid) : () => []);
  useEffect(() => {
    if (!pid) return;
    const fresh = events.slice(seenEv.current);
    seenEv.current = events.length;
    if (fresh.length === 0) return;
    for (const e of fresh) {
      const kind = (e as any).kind;
      if (kind === "delta" && e.text) setStream((t) => (t ?? "") + e.text);
      else if (kind === "tool" && e.text) setTrace((t) => [...t.slice(-40), e.text!]);
      else if (kind === "notice" && e.text) setStatus(e.text);
      else if (kind === "usage" && (e as any).payload) setUsage((u) => ({ ...u, ...(e as any).payload }));
    }
    const sc = scrollRef.current;
    if (sc) sc.scrollTop = sc.scrollHeight;
  }, [events, pid]);

  const finalize = (r: any): void => {
    const answer = typeof r?.answer === "string" ? r.answer : r?.error != null ? `⚠ ${r.error}` : "(空响应)";
    setMsgs((v) => [...v, { role: "assistant", text: answer }]);
    setStream(null);
    setTrace([]);
    setStatus(null);
    setConfirmCard(r?.confirm?.summary ?? null);
    if (r?.totalUsage || r?.sessionUsage) {
      setUsage((u) => ({ ...u, ...(r.sessionUsage ?? {}), ...(r.totalUsage ?? {}) }));
    }
    if (!open) setUnread((n) => n + 1);
    requestAnimationFrame(() => {
      const sc = scrollRef.current;
      if (sc) sc.scrollTop = sc.scrollHeight;
    });
  };

  const send = async (raw: string): Promise<void> => {
    const text = raw.trim();
    if (!pid || busy || !text) return;
    setBusy(true);
    setMsgs((v) => [...v, { role: "user", text }]);
    setStream("");
    setTrace([]);
    setConfirmCard(null);
    setStatus("思考中…");
    try {
      const res: any = await callRust(pid, "run", { command: "chat", input: text });
      finalize(res);
    } catch (e) {
      finalize({ answer: "", error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const runCmd = async (command: string, input = ""): Promise<any> => {
    if (!pid) return null;
    try {
      return await callRust(pid, "run", { command, input });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  const newSession = async (): Promise<void> => {
    if (busy) return;
    await runCmd("new_session");
    hydratedFor.current = pid;
    setMsgs([]);
    setConfirmCard(null);
    setUsage({});
    setNotice("已新建会话");
  };

  const openHistory = async (): Promise<void> => {
    const r = await runCmd("list_sessions");
    setHistory(Array.isArray(r?.sessions) ? r.sessions : []);
  };

  const switchSession = async (id: string): Promise<void> => {
    if (busy) return;
    await runCmd("switch_session", id);
    hydratedFor.current = pid;
    setMsgs([]);
    setConfirmCard(null);
    setUsage({});
    setHistory(null);
    // 立即水合新会话
    try {
      const res: any = await callRust(pid!, "run", { command: "export_session", input: id });
      if (res?.ok && res.json) {
        const s = JSON.parse(res.json);
        const view: ViewMsg[] = [];
        for (const m of s.messages ?? []) {
          if (m.role === "user" && m.content) view.push({ role: "user", text: m.content });
          else if (m.role === "assistant" && m.content) view.push({ role: "assistant", text: m.content });
        }
        setMsgs(view);
      }
    } catch {
      /* 保持空视图 */
    }
  };

  const deleteSession = async (id: string): Promise<void> => {
    const r = await runCmd("delete_session", id);
    setHistory(Array.isArray(r?.sessions) ? r.sessions : []);
  };

  const exportSession = async (): Promise<void> => {
    const r = await runCmd("export_session", "");
    if (!r?.ok || !r.json) {
      setNotice(r?.error ?? "导出失败");
      return;
    }
    const blob = new Blob([r.json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `onethu-harness-${(r.sessionId ?? "session").slice(0, 18)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importSession = async (f: File): Promise<void> => {
    const text = await f.text();
    const r = await runCmd("import_session", text);
    if (r?.ok) {
      hydratedFor.current = pid;
      setMsgs([]);
      setNotice(`已导入：${r.title ?? "会话"}`);
      void switchSession(r.sessionId);
    } else {
      setNotice(r?.error ?? "导入失败");
    }
  };

  const stop = (): void => {
    if (pid) void notifyRust(pid, "interrupt").catch(() => undefined);
  };

  if (!pid) return null;
  const budgetPct = usage.budgetUsd ? Math.min(100, ((usage.totalCostUsd ?? 0) / usage.budgetUsd) * 100) : 0;

  return (
    <>
      {open ? (
        <div className="dock-panel" role="dialog" aria-label="OneTHU Harness 对话">
          <div className="dock-head">
            <span className="dock-title">⚡ Harness</span>
            <div className="dock-ops">
              <button className="btn dock-btn" title="新建会话" onClick={() => void newSession()}>新会话</button>
              <button className="btn dock-btn" title="历史会话" onClick={() => void openHistory()}>历史</button>
              <button className="btn dock-btn" title="导出当前会话 JSON（R5）" onClick={() => void exportSession()}>导出</button>
              <label className="btn dock-btn" title="导入会话 JSON（R5）" style={{ position: "relative", overflow: "hidden" }}>
                导入
                <input
                  type="file" accept=".json,application/json"
                  style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void importSession(f);
                    e.target.value = "";
                  }}
                />
              </label>
              <button className="btn dock-btn" aria-label="收起" onClick={toggle}>—</button>
            </div>
          </div>
          {notice ? (
            <div className="dock-notice" onClick={() => setNotice(null)}>{notice}</div>
          ) : null}
          <div className="dock-msgs" ref={scrollRef}>
            {msgs.length === 0 && stream == null ? (
              <div className="dock-empty">
                和校园助手说点什么——<br />「明天图书馆哪有空座？」「这周考试安排」「卡里还有多少钱」
              </div>
            ) : null}
            {msgs.map((m, i) => (
              <div key={i} className={"dock-msg dock-msg-" + m.role}>{m.text}</div>
            ))}
            {trace.length > 0 ? (
              <div className="dock-trace">
                {trace.map((t, i) => (
                  <div key={i} className="dock-trace-line">{t}</div>
                ))}
              </div>
            ) : null}
            {stream != null ? (
              <div className="dock-msg dock-msg-assistant dock-streaming">
                {stream || <span className="dock-thinking">{status ?? "思考中…"}</span>}
                {stream ? <span className="dock-caret" /> : null}
              </div>
            ) : null}
            {confirmCard ? (
              <div className="dock-confirm">
                <div className="dock-confirm-text">{confirmCard}</div>
                <div className="dock-confirm-ops">
                  <button className="btn btn-primary dock-btn" disabled={busy} onClick={() => void send("确认")}>确认执行</button>
                  <button className="btn dock-btn" disabled={busy} onClick={() => void send("取消")}>取消</button>
                </div>
              </div>
            ) : null}
          </div>
          <div className="dock-input-row">
            <textarea
              className="dock-input"
              rows={1}
              placeholder={busy ? "执行中，可打断…" : "问点什么，回车发送"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  const t = input;
                  setInput("");
                  void send(t);
                }
              }}
            />
            {busy ? (
              <button className="btn dock-send" aria-label="打断" onClick={stop}>■</button>
            ) : (
              <button
                className="btn btn-primary dock-send" aria-label="发送" disabled={!input.trim()}
                onClick={() => {
                  const t = input;
                  setInput("");
                  void send(t);
                }}
              >↑</button>
            )}
          </div>
          <div className="dock-foot" title="R6：token 用量与价格统计（由插件精确上报）">
            <span>本会话 {usage.sessionPrompt ?? 0}+{usage.sessionCompletion ?? 0} tok · {fmtUsd(usage.sessionCostUsd)}</span>
            <span>累计 {fmtUsd(usage.totalCostUsd)} / 预算 {fmtUsd(usage.budgetUsd)}</span>
            <div className="dock-budget"><div className="dock-budget-bar" style={{ width: `${budgetPct}%` }} /></div>
          </div>
          {history != null ? (
            <div className="dock-history" role="menu">
              <div className="dock-history-head">
                <b>历史会话</b>
                <button className="btn dock-btn" onClick={() => setHistory(null)}>关闭</button>
              </div>
              {history.length === 0 ? <div className="dock-empty">（无会话）</div> : history.map((s) => (
                <div key={s.id} className="dock-hist-row">
                  <button className="dock-hist-main" onClick={() => void switchSession(s.id)}>
                    <span className="dock-hist-title">{s.title || "未命名"}</span>
                    <span className="dock-hist-meta">{s.messages} 轮 · {fmtUsd(s.costUsd)}</span>
                  </button>
                  <button className="btn dock-btn dock-hist-del" aria-label="删除" onClick={() => void deleteSession(s.id)}>✕</button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <button className="dock-fab" aria-label="打开 Harness 对话" onClick={toggle}>
          ⚡
          {unread > 0 ? <span className="dock-badge">{unread > 9 ? "9+" : unread}</span> : null}
        </button>
      )}
    </>
  );
}
