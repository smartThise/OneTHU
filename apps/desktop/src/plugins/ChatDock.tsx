/** 常驻对话面板（宿主胶水，R2/R4/R5 的 dock 面）：
 *  发现 activate 返回 dock:true 命令的已启用 rust 插件 → 显示常驻气泡；
 *  对话/会话/导出/用量全部走该插件的 JSON-RPC run 命令（结构化契约见
 *  OneTHU-Harness README 与接口指南 §九），本组件不含任何业务逻辑。
 *
 *  v2 交互（用户拍板）：
 *  - FAB 默认左下角（同 v1 位置），可拖拽，松手自动吸附最近水平边缘（右侧让出硬刷新钮的角落）；
 *  - 点击后面板从 FAB 原位动画化开（transform-origin 对准 FAB 角），桌面/横排/竖屏手机同形态；
 *  - 会话切换不清空累计用量（总量跨会话持久，仅本会话计数归零）。
 */
import {
  memo, useCallback, useEffect, useRef, useState, useSyncExternalStore,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import Markdown from "react-markdown";
import { navGo } from "./bridges.js";
import remarkGfm from "remark-gfm";
import { callRust, notifyRust } from "./rust.js";
import { commandsSnapshot, subscribeCommands } from "./loader.js";
import { EMPTY_EVENTS, pluginEvents, subscribePluginEvents } from "./events.js";
import { HarnessMark } from "../components/HarnessMark.js";
import { openExternal } from "../pages/info/openExternal.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const OPEN_KEY = "onethu.chatdock.open";
const POS_KEY = "onethu.chatdock.pos";
const FAB = 46; // FAB 边长（与 CSS .dock-fab 保持一致）
const EDGE = 14; // 吸附/防越界边距

interface ViewMsg {
  role: "user" | "assistant";
  text: string;
  /** 链元数据（R7）：本条回答的思考链与工具调用链，折叠可展开回看 */
  meta?: { think?: string; trace?: string[] };
}

/** 可折叠链块：思考过程 / 工具调用（流式期展开，落定折叠，随时展开回看） */
function ChainBlock({ label, lines, defaultOpen = false }: { label: string; lines: string[]; defaultOpen?: boolean }): ReactNode {
  const [open, setOpen] = useState(defaultOpen);
  if (lines.length === 0) return null;
  const total = lines.reduce((n, l) => n + l.length, 0);
  return (
    <div className="dock-think">
      <button className="dock-think-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="dock-think-label">{label}</span>
        <span className="dock-think-meta">{open ? "点击收起" : `${lines.length} 条 · ${total} 字`}</span>
        <i className={"plg-caret" + (open ? " is-open" : "")} />
      </button>
      {open ? (
        <div className="dock-think-body">
          {lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
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

/* ───────── FAB 位置：持久化 + 越界钳制 + 边缘吸附 ───────── */

interface FabPos { x: number; y: number }
interface Vp { vw: number; vh: number }
const vpNow = (): Vp => ({ vw: window.innerWidth, vh: window.innerHeight });

function clampPos(p: FabPos, vp: Vp): FabPos {
  return {
    x: Math.max(EDGE, Math.min(p.x, vp.vw - FAB - EDGE)),
    y: Math.max(EDGE, Math.min(p.y, vp.vh - FAB - EDGE)),
  };
}

/** 吸附最近水平边缘；右下角让出硬刷新钮（页面卡死时的唯一恢复出口，不可遮挡） */
function snapPos(p: FabPos, vp: Vp): FabPos {
  const base = clampPos(p, vp);
  let y = base.y;
  if (p.x + FAB / 2 < vp.vw / 2) {
    return { x: EDGE, y };
  }
  const refreshZoneTop = vp.vh - 18 - 44 - 4; // 硬刷新钮（右下 18px 边距 44px）上缘
  if (y > refreshZoneTop - FAB - 6) y = Math.max(EDGE, refreshZoneTop - FAB - 6);
  return { x: vp.vw - FAB - EDGE, y };
}

function readPos(): FabPos {
  const vp = vpNow();
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as FabPos;
      if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) return clampPos(p, vp);
    }
  } catch { /* 坏存档：落回默认位 */ }
  return { x: 18, y: Math.round(vp.vh - FAB - 18) }; // 默认：左下角（同 v1）
}

/* ───────── 消息区（memo：拖拽期间 FAB 每帧改位不重排 markdown） ───────── */

interface MsgListProps {
  msgs: ViewMsg[];
  stream: string | null;
  status: string | null;
  think: string;
  thinkOpen: boolean;
  trace: string[];
  confirmCard: string | null;
  busy: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onSend: (t: string) => void;
  onPick: (t: string) => void;
  onToggleThink: () => void;
  onMsgsClick: (e: MouseEvent) => void;
}

const SUGGESTIONS = ["明天图书馆哪有空座？", "这周考试安排", "卡里还有多少钱", "明天下午有什么日程"];

const DockMsgList = memo(function DockMsgList(p: MsgListProps): ReactNode {
  return (
    <div className="dock-msgs" ref={p.scrollRef} onClick={p.onMsgsClick}>
      {p.msgs.length === 0 && p.stream == null ? (
        <div className="dock-empty">
          <span className="dock-empty-mark"><HarnessMark size={34} /></span>
          <span className="dock-empty-hello">和校园助手说点什么</span>
          <div className="dock-empty-chips">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="dock-chip" onClick={() => p.onPick(s)}>{s}</button>
            ))}
          </div>
        </div>
      ) : null}
      {p.msgs.map((m, i) =>
        m.role === "assistant" ? (
          <div key={i} className="dock-msg-assistant">
            {m.meta?.think ? <ChainBlock label="思考过程" lines={[m.meta.think]} /> : null}
            {m.meta?.trace?.length ? <ChainBlock label="工具调用" lines={m.meta.trace} /> : null}
            <div className="dock-msg dock-md">
              <Markdown remarkPlugins={[remarkGfm]}>{m.text}</Markdown>
            </div>
          </div>
        ) : (
          <div key={i} className="dock-msg dock-msg-user">{m.text}</div>
        ),
      )}
      {p.trace.length > 0 ? <ChainBlock label="工具调用" lines={p.trace} defaultOpen /> : null}
      {p.think ? (
        <div className="dock-think">
          <button className="dock-think-head" onClick={p.onToggleThink} aria-expanded={p.thinkOpen}>
            <span className="dock-think-label">思考过程</span>
            <span className="dock-think-meta">{p.thinkOpen ? "点击收起" : `${p.think.length} 字 · 已折叠`}</span>
            <i className={"plg-caret" + (p.thinkOpen ? " is-open" : "")} />
          </button>
          {p.thinkOpen ? <div className="dock-think-body">{p.think}</div> : null}
        </div>
      ) : null}
      {p.stream != null ? (
        <div className="dock-msg dock-msg-assistant dock-streaming">
          {p.stream ? (
            <div className="dock-md">
              <Markdown remarkPlugins={[remarkGfm]}>{p.stream}</Markdown>
            </div>
          ) : (
            <span className="dock-thinking">{p.status ?? "思考中…"}</span>
          )}
          {p.stream ? <span className="dock-caret" /> : null}
        </div>
      ) : null}
      {p.confirmCard ? (
        <div className="dock-confirm">
          <div className="dock-confirm-text">{p.confirmCard}</div>
          <div className="dock-confirm-ops">
            <button className="btn btn-primary dock-btn" disabled={p.busy} onClick={() => p.onSend("确认")}>确认执行</button>
            <button className="btn dock-btn" disabled={p.busy} onClick={() => p.onSend("取消")}>取消</button>
          </div>
        </div>
      ) : null}
    </div>
  );
});

export function ChatDock(): ReactNode {
  const cmds = useSyncExternalStore(subscribeCommands, commandsSnapshot);
  const dockCmd = cmds.find((c) => c.dock && c.id === "chat");
  const pid = dockCmd?.pluginId ?? null;

  const [open, setOpen] = useState(readOpen);
  const [closing, setClosing] = useState(false); // 关闭动画期：面板仍挂载
  const [pos, setPos] = useState<FabPos>(readPos);
  const [dragging, setDragging] = useState(false);
  const [snapping, setSnapping] = useState(false); // 吸附过渡开关
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
  /* 思维链（R4 think 事件聚合）：流式期间展开，首个回答 delta 到达自动折叠，可手动展开回看 */
  const [think, setThink] = useState("");
  const [thinkOpen, setThinkOpen] = useState(true);
  const hydratedFor = useRef<string | null>(null);
  const seenEv = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  /* 运行代次：打断/强停/换插件后作废迟到回包；busyRef 是 busy 的即时镜像（异步闭包防陈旧） */
  const runSeq = useRef(0);
  const busyRef = useRef(false);
  const deadman = useRef<number | null>(null);
  /* 链镜像：finalize 时随回答落库为 meta；delta 节流缓冲（markdown 逐帧重解析会卡 UI） */
  const thinkRef = useRef("");
  const traceRef = useRef<string[]>([]);
  const deltaBuf = useRef("");
  const deltaTimer = useRef<number | null>(null);
  /* 自愈看门狗：流式文本镜像 + 最后事件时刻 + 本代次是否已落定（防回复链路丢失后永久 busy） */
  const streamRef = useRef("");
  const lastEvAt = useRef(Date.now());
  const finalizedFor = useRef(0);
  /* 拖拽会话（pointer 捕获）：moved=false 时 pointerup 视为点击 */
  const drag = useRef({ id: -1, sx: 0, sy: 0, ox: 0, oy: 0, moved: false });
  const closeTimer = useRef<number | null>(null);

  const flushDelta = (): void => {
    deltaTimer.current = null;
    const t = deltaBuf.current;
    if (!t) return;
    deltaBuf.current = "";
    streamRef.current += t;
    setStream((v) => (v ?? "") + t);
  };

  const toggle = useCallback((): void => {
    if (open) {
      localStorage.setItem(OPEN_KEY, "0");
      setClosing(true); // 先演退场动画，再卸载
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = window.setTimeout(() => {
        closeTimer.current = null;
        setClosing(false);
        setOpen(false);
      }, 200); // ≥退场动画 190ms
    } else {
      localStorage.setItem(OPEN_KEY, "1");
      setClosing(false);
      setOpen(true);
      setUnread(0);
    }
  }, [open]);

  /** 只清本会话计数，累计用量（跨会话持久）保留并刷新 */
  const keepTotals = (): void => {
    setUsage((u) => ({
      budgetUsd: u.budgetUsd, budgetLeftUsd: u.budgetLeftUsd,
      totalCostUsd: u.totalCostUsd, totalPrompt: u.totalPrompt,
      totalCompletion: u.totalCompletion, totalCalls: u.totalCalls,
    }));
  };

  // 视口变化：位置重新钳制（拖到屏外/转屏后回屏内）
  useEffect(() => {
    const onResize = (): void => {
      setPos((p) => clampPos(p, vpNow()));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // 插件变更：清视图，重挂水合标记；作废旧插件迟到回包与死人开关
  useEffect(() => {
    hydratedFor.current = null;
    setMsgs([]);
    setStream(null);
    setThink("");
    setThinkOpen(true);
    setTrace([]);
    thinkRef.current = "";
    traceRef.current = [];
    if (deltaTimer.current) {
      clearTimeout(deltaTimer.current);
      deltaTimer.current = null;
    }
    deltaBuf.current = "";
    setConfirmCard(null);
    setUsage({});
    seenEv.current = 0;
    setHistory(null);
    runSeq.current++;
    if (deadman.current) {
      clearTimeout(deadman.current);
      deadman.current = null;
    }
    busyRef.current = false;
    setBusy(false);
    return () => {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
    };
  }, [pid]);

  // 水合：打开面板且尚未载入当前会话 → 导出会话 JSON 还原视图（R5）+ 拉累计用量
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
      try {
        const t: any = await callRust(pid, "run", { command: "usage_report" });
        if (t?.ok && t.totals) {
          setUsage((u) => ({
            ...u,
            totalPrompt: t.totals.prompt, totalCompletion: t.totals.completion,
            totalCalls: t.totals.calls, totalCostUsd: t.totals.costUsd,
          }));
        }
      } catch { /* 保留现值 */ }
    })();
  }, [pid, open]);

  // 事件泵：流式增量 / 工具轨迹 / 用量（R4）
  const events = useSyncExternalStore(subscribePluginEvents, pid ? () => pluginEvents(pid) : () => EMPTY_EVENTS);
  useEffect(() => {
    if (!pid) return;
    const fresh = events.slice(seenEv.current);
    seenEv.current = events.length;
    if (fresh.length === 0) return;
    lastEvAt.current = Date.now();
    for (const e of fresh) {
      if (e.method === "exit") {
        hardStop("插件已停止");
        return;
      }
      const kind = (e as any).kind;
      // R10：已落定的对话不得再吃迟到事件——Tauri 事件通道与 invoke 回执无顺序保证，
      // 迟到 delta 会复活流式气泡（幽灵光标一直闪）
      if (finalizedFor.current === runSeq.current && runSeq.current > 0 && (kind === "delta" || kind === "think" || kind === "tool")) {
        continue;
      }
      if (kind === "delta" && e.text) {
        setThinkOpen(false); // 回答开始 → 思考过程自动折叠
        deltaBuf.current += e.text;
        if (!deltaTimer.current) deltaTimer.current = window.setTimeout(flushDelta, 120);
      } else if (kind === "think" && e.text) {
        thinkRef.current += e.text;
        setThink((t) => t + e.text);
      } else if (kind === "tool" && e.text) {
        traceRef.current = [...traceRef.current.slice(-60), e.text!];
        setTrace((t) => [...t.slice(-40), e.text!]);
      }
      else if (kind === "notice" && e.text) setStatus(e.text);
      else if (kind === "usage" && (e as any).payload) setUsage((u) => ({ ...u, ...(e as any).payload }));
    }
    const sc = scrollRef.current;
    if (sc) sc.scrollTop = sc.scrollHeight;
  }, [events, pid]);

  const finalize = (r: any): void => {
    if (finalizedFor.current === runSeq.current && runSeq.current > 0) return; // 已落定（看门狗兜底后真回复迟到）
    finalizedFor.current = runSeq.current;
    // 冲掉在途 delta 缓冲：否则落定后迟到的定时器会把残余增量拼回 stream，冒出幽灵流式气泡
    if (deltaTimer.current) {
      clearTimeout(deltaTimer.current);
      deltaTimer.current = null;
    }
    deltaBuf.current = "";
    const answer = typeof r?.answer === "string" ? r.answer : r?.error != null ? `⚠ ${r.error}` : "(空响应)";
    setMsgs((v) => [...v, { role: "assistant", text: answer, meta: { think: thinkRef.current, trace: traceRef.current } }]);
    setStream(null);
    setThinkOpen(false); // 回答落定 → 链折叠（随 meta 挂在本条回答上，可展开回看）
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

  /** 强制收尾：清 busy + 作废迟到回包（打断超时/插件死亡/换插件时的 UI 兜底） */
  const hardStop = (note: string): void => {
    if (deadman.current) {
      clearTimeout(deadman.current);
      deadman.current = null;
    }
    if (!busyRef.current) return;
    runSeq.current++;
    busyRef.current = false;
    setBusy(false);
    setMsgs((v) => [...v, { role: "assistant", text: `■ ${note}` }]);
    setStream(null);
    setTrace([]);
    setStatus(null);
    setConfirmCard(null);
  };

  const send = useCallback(async (raw: string): Promise<void> => {
    const text = raw.trim();
    if (!pid || busyRef.current || !text) return;
    const seq = ++runSeq.current;
    finalizedFor.current = 0;
    streamRef.current = "";
    lastEvAt.current = Date.now();
    busyRef.current = true;
    setBusy(true);
    setMsgs((v) => [...v, { role: "user", text }]);
    setStream("");
    setThink("");
    setThinkOpen(true);
    setTrace([]);
    thinkRef.current = "";
    traceRef.current = [];
    setConfirmCard(null);
    setStatus("思考中…");
    // 自愈看门狗（R9）：流式文本已非空且 8s 无任何新事件 → 视为已完成，
    // 用已流出的内容落定并解锁——无论 run 应答卡在链路哪一环，UI 都不再永久 busy
    const watchdog = window.setInterval(() => {
      if (seq !== runSeq.current || !busyRef.current) {
        window.clearInterval(watchdog);
        return;
      }
      const idle = Date.now() - lastEvAt.current;
      if (streamRef.current && idle > 8_000) {
        window.clearInterval(watchdog);
        console.warn("[dock] 应答链路超时，看门狗按已流出内容落定");
        if (seq === runSeq.current) finalize({ answer: streamRef.current });
        busyRef.current = false;
        setBusy(false);
      }
    }, 1000);
    try {
      const res: any = await callRust(pid, "run", { command: "chat", input: text });
      window.clearInterval(watchdog);
      if (seq !== runSeq.current) return; // 已被打断/强停：迟到回包作废
      finalize(res);
    } catch (e) {
      window.clearInterval(watchdog);
      if (seq !== runSeq.current) return;
      finalize({ answer: "", error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (seq === runSeq.current) {
        busyRef.current = false;
        setBusy(false);
      }
      if (deadman.current) {
        clearTimeout(deadman.current);
        deadman.current = null;
      }
    }
  }, [pid, open]);

  const runCmd = async (command: string, input = ""): Promise<any> => {
    if (!pid) return null;
    try {
      return await callRust(pid, "run", { command, input });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  /** 累计用量刷新（usage_report：跨会话总量，切换/新建后立即可见） */
  const refreshTotals = async (): Promise<void> => {
    if (!pid) return;
    try {
      const r: any = await callRust(pid, "run", { command: "usage_report" });
      if (r?.ok && r.totals) {
        setUsage((u) => ({
          ...u,
          totalPrompt: r.totals.prompt, totalCompletion: r.totals.completion,
          totalCalls: r.totals.calls, totalCostUsd: r.totals.costUsd,
        }));
      }
    } catch { /* 保留现值 */ }
  };

  const newSession = async (): Promise<void> => {
    if (busyRef.current) {
      // 打断中也能开新会话：强制解锁，迟到回包作废
      hardStop("已打断，开新会话");
      await new Promise((r) => setTimeout(r, 60));
    }
    await runCmd("new_session");
    hydratedFor.current = pid;
    setMsgs([]);
    setConfirmCard(null);
    keepTotals();
    void refreshTotals();
    setNotice("已新建会话");
  };

  const openHistory = async (): Promise<void> => {
    const r = await runCmd("list_sessions");
    setHistory(Array.isArray(r?.sessions) ? r.sessions : []);
  };

  const switchSession = async (id: string): Promise<void> => {
    if (busyRef.current) {
      hardStop("已打断，切换会话");
      await new Promise((r) => setTimeout(r, 60));
    }
    await runCmd("switch_session", id);
    hydratedFor.current = pid;
    setMsgs([]);
    setConfirmCard(null);
    keepTotals();
    setHistory(null);
    void refreshTotals();
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
        if (s.usage) setUsage((u) => ({ ...u, sessionPrompt: s.usage.prompt, sessionCompletion: s.usage.completion, sessionCostUsd: s.cost_usd }));
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
    // R10：WKWebView 无下载管理器，a[download] 点击静默无效——宿主代写 ~/Downloads
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const path = await invoke<string | null>("save_text_file", {
        filename: `onethu-harness-${(r.sessionId ?? "session").slice(0, 18)}.json`,
        contents: r.json,
      });
      setNotice(path ? `已导出：${path}` : "已取消导出");
    } catch (e) {
      setNotice(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    }
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
    if (!pid) return;
    void notifyRust(pid, "interrupt").catch(() => undefined);
    setStatus("正在打断…");
    // 死人开关：插件 12s 内没自行收尾就强制解锁——打断永不卡死 UI
    if (!deadman.current && busyRef.current) {
      deadman.current = window.setTimeout(() => {
        deadman.current = null;
        hardStop("已打断（插件未及时响应，已强制解锁）");
      }, 12_000);
    }
  };

  /** 消息区链接一律外跳系统浏览器（webview 内导航会带走整个应用） */
  const onMsgsClick = (e: MouseEvent): void => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href) return;
    e.preventDefault();
    // onethu-news://<xxid> = 站内新闻直达（小OH 新闻链接专用），不开浏览器
    const m = /^onethu-news:\/\/(.+)$/.exec(href);
    if (m?.[1]) {
      navGo("info", { infoNewsId: decodeURIComponent(m[1]) });
      return;
    }
    void openExternal(href);
  };

  /* ───────── FAB 拖拽（pointer 捕获）：<6px 视为点击 ───────── */
  const onFabPointerDown = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 捕获失败仍可拖 */ }
  };
  const onFabPointerMove = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    const d = drag.current;
    if (d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 6) return; // 位移阈值内不判拖拽
    d.moved = true;
    if (!dragging) {
      setDragging(true);
      setSnapping(false);
    }
    setPos(clampPos({ x: d.ox + dx, y: d.oy + dy }, vpNow()));
  };
  const onFabPointerUp = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    const d = drag.current;
    if (d.id !== e.pointerId) return;
    d.id = -1;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* 已释放 */ }
    if (!d.moved) {
      toggle(); // 点击：原地化开 / 收起
      return;
    }
    setDragging(false);
    setSnapping(true); // 吸附动画（CSS 过渡）
    const snapped = snapPos(pos, vpNow());
    setPos(snapped);
    try { localStorage.setItem(POS_KEY, JSON.stringify(snapped)); } catch { /* 存不进就算了 */ }
  };
  const onFabPointerCancel = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    const d = drag.current;
    if (d.id !== e.pointerId) return;
    d.id = -1;
    setDragging(false);
    setSnapping(true);
    setPos((p) => snapPos(p, vpNow()));
  };
  const onFabKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  };

  if (!pid) return null;
  const budgetPct = usage.budgetUsd ? Math.min(100, ((usage.totalCostUsd ?? 0) / usage.budgetUsd) * 100) : 0;

  /* 面板锚在 FAB 上方（原地化开的锚点），随 FAB 靠左/靠右对齐 */
  const panelStyle: CSSProperties = (() => {
    const { vw, vh } = vpNow();
    const pw = Math.min(384, vw - 24);
    const ph = Math.min(560, Math.round(vh * 0.78));
    const side = pos.x + FAB / 2 < vw / 2 ? "left" : "right";
    let top = pos.y - ph - 14; // 面板底缘悬在 FAB 上方
    top = Math.max(12, Math.min(top, vh - ph - 12));
    const left = side === "left"
      ? Math.max(12, Math.min(pos.x - 6, vw - pw - 12))
      : Math.max(12, Math.min(pos.x + FAB - pw + 6, vw - pw - 12));
    return { left, top, transformOrigin: side === "left" ? "22px 100%" : "calc(100% - 22px) 100%" };
  })();

  return (
    <>
      <button
        className={"dock-fab" + (snapping ? " is-snapping" : "") + (dragging ? " is-drag" : "") + (open ? " is-open" : "")}
        style={{ left: pos.x, top: pos.y }}
        aria-label="打开 Harness 对话（可拖拽）"
        onPointerDown={onFabPointerDown}
        onPointerMove={onFabPointerMove}
        onPointerUp={onFabPointerUp}
        onPointerCancel={onFabPointerCancel}
        onKeyDown={onFabKeyDown}
      >
        <HarnessMark size={16} />
        {unread > 0 && !open ? <span className="dock-badge">{unread > 9 ? "9+" : unread}</span> : null}
      </button>

      {open || closing ? (
        <div
          className={"dock-panel" + (closing ? " is-closing" : "")}
          style={panelStyle}
          role="dialog"
          aria-label="OneTHU Harness 对话"
        >
          <div className="dock-head">
            <span className="dock-title"><HarnessMark size={13} /> 小OH</span>
            <div className="dock-ops">
              <button className="btn dock-btn dock-ico" title="新会话" aria-label="新会话" onClick={() => void newSession()}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
              </button>
              <button className="btn dock-btn dock-ico" title="历史会话" aria-label="历史会话" onClick={() => void openHistory()}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>
              </button>
              <button className="btn dock-btn dock-ico" title="导出当前会话 JSON" aria-label="导出会话" onClick={() => void exportSession()}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3v12" /><path d="m8 11 4 4 4-4" /><path d="M4 19h16" /></svg>
              </button>
              <label className="btn dock-btn dock-ico" title="导入会话 JSON" aria-label="导入会话" style={{ position: "relative", overflow: "hidden" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 15V3" /><path d="m8 7 4-4 4 4" /><path d="M4 19h16" /></svg>
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
              <button className="btn dock-btn dock-ico" title="收起" aria-label="收起" onClick={toggle}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="m6 6 12 12M18 6 6 18" /></svg>
              </button>
            </div>
          </div>
          {notice ? (
            <div className="dock-notice" onClick={() => setNotice(null)}>{notice}</div>
          ) : null}
          <DockMsgList
            msgs={msgs}
            stream={stream}
            status={status}
            think={think}
            thinkOpen={thinkOpen}
            trace={trace}
            confirmCard={confirmCard}
            busy={busy}
            scrollRef={scrollRef}
            onSend={(t) => void send(t)}
            onPick={(t) => setInput(t)}
            onToggleThink={() => setThinkOpen((o) => !o)}
            onMsgsClick={onMsgsClick}
          />
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
          <div className="dock-foot" title="R6：token 用量与价格统计（由插件精确上报；累计跨会话保留）">
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
      ) : null}
    </>
  );
}
