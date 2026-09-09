/** 常驻对话面板（宿主胶水，R2/R4/R5 的 dock 面）：
 *  发现 activate 返回 dock:true 命令的已启用 rust 插件 → 显示常驻气泡；
 *  对话/会话/导出/用量全部走该插件的 JSON-RPC run 命令（结构化契约见
 *  OneTHU-Harness README 与接口指南 §九），本组件不含任何业务逻辑。
 *
 *  v3 交互（用户拍板，灵动岛）：
 *  - 底部中央胶囊（左 OH 标识 + 右智能文本），不再拖拽；
 *  - 智能文本：30 分钟内日程 → 「地点·还有X分钟」；提醒窗口内作业 → 「作业名·还有X分钟」；
 *    默认「聊点什么吧！」；文本切换键盘下坠动画，胶囊宽度随内容伸缩；
 *  - 点击向上展开 50% 高 × 86% 宽面板（不全屏），关闭缩回；
 *  - 长按 → 胶囊拉长 + 波纹 → 原生语音识别（macOS SFSpeechRecognizer 桥），
 *    实时转写显示在雾白下半屏遮罩；松手 → 滑动特效 → 新对话并填入文本；
 *  - 会话切换不清空累计用量（总量跨会话持久，仅本会话计数归零）。
 */
import {
  memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore,
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
import { useIslandText } from "../state/island.js";
import { speechAvailable, speechPoll, speechStart, speechStop } from "../lib/speech.js";
import { openExternal } from "../pages/info/openExternal.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const OPEN_KEY = "onethu.chatdock.open";
/** 灵动岛：长按判定时长（毫秒）——超过即进入语音，未超过视为点击 */
const VOICE_HOLD_MS = 450;
/** 松手后等待识别器吐最终结果的宽限 */
const VOICE_FINAL_GRACE_MS = 320;

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

/** 开场三行（左对齐、逐字下落）：展开成 [行][字+延迟] 一次性算好 */
const HERO_LINES = ["你好！", "我是小OH，", "有什么能帮你的吗？"];
const HERO_CHARS: Array<Array<{ ch: string; delay: number }>> = (() => {
  let n = 0;
  return HERO_LINES.map((line) => [...line].map((ch) => ({ ch, delay: 0.06 + n++ * 0.07 })));
})();

const SUGGESTIONS = ["明天图书馆哪有空座？", "这周考试安排", "卡里还有多少钱", "明天下午有什么日程"];

const DockMsgList = memo(function DockMsgList(p: MsgListProps): ReactNode {
  return (
    <div className="dock-msgs" ref={p.scrollRef} onClick={p.onMsgsClick}>
      {p.msgs.length === 0 && p.stream == null ? (
        <div className="dock-empty">
          {/* 新会话开场：左对齐、逐字下落的三行大字（每次新建对话重挂载即重演） */}
          <div className="dock-hero" aria-label="你好！我是小OH，有什么能帮你的吗？">
            {HERO_CHARS.map((line, i) => (
              <div className="dock-hero-line" key={i}>
                {line.map((c, j) => (
                  <span className="dock-hero-ch" style={{ animationDelay: `${c.delay}s` }} key={j}>{c.ch}</span>
                ))}
              </div>
            ))}
          </div>
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
  /* 灵动岛：语音会话状态机 off→arming（等授权窗）→listening（轮询转写）→sending（等最终结果） */
  const [voice, setVoice] = useState<"off" | "arming" | "listening" | "sending">("off");
  const [voiceText, setVoiceText] = useState("");
  const [voiceFail, setVoiceFail] = useState<string | null>(null); // 失败原因：留在遮罩上 2.6s 再散
  const [slidIn, setSlidIn] = useState(false); // 语音开面板用滑动进场（区别于点击 morph）
  const islandText = useIslandText();
  const islandTextRef = useRef<HTMLSpanElement>(null);
  const [islandW, setIslandW] = useState(0); // 胶囊宽度随内容（测量布局宽，动画交给 CSS transition）
  const pressTimer = useRef<number | null>(null); // 长按计时（null=未按/已触发语音）
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
  const closeTimer = useRef<number | null>(null);
  /* 导入会话：真按钮 + 隐藏 input（label 方案在触屏密度层下渲染高度与 button 不一致） */
  const fileRef = useRef<HTMLInputElement>(null);

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

  /* ───────── 灵动岛：点击展开 / 长按语音 ───────── */

  // 胶囊宽度 = 布局测量（字符下坠动画只是视觉位移，不影响布局宽；过渡交给 CSS）
  useLayoutEffect(() => {
    if (islandTextRef.current) setIslandW(islandTextRef.current.getBoundingClientRect().width);
  }, [islandText]);

  // 语音轮询：listening 期间每 180ms 拉一次部分转写
  useEffect(() => {
    if (voice !== "listening") return;
    const t = window.setInterval(() => {
      void speechPoll().then(setVoiceText);
    }, 180);
    return () => window.clearInterval(t);
  }, [voice]);

  /** 语音失败：遮罩上亮 2.6s（notice 在面板内，关着面板时看不见） */
  const showVoiceFail = (msg: string): void => {
    setVoice("off");
    setVoiceText("");
    setVoiceFail(msg);
    window.setTimeout(() => setVoiceFail(null), 2600);
  };

  const enterVoice = async (): Promise<void> => {
    if (!(await speechAvailable())) {
      showVoiceFail("此设备暂不支持原生语音识别（macOS 需 pnpm tauri:app 方式运行并授权）");
      return;
    }
    setVoice("arming");
    setVoiceText("");
    try {
      await speechStart(); // 首次会同步等待系统授权窗（麦克风+语音识别）
      setVoice("listening");
    } catch (e) {
      showVoiceFail(`语音启动失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** 松手：收最终文本 → 滑动特效开面板 → 新对话 + 填入（不自动发送，先看一眼再回车） */
  const finishVoice = async (): Promise<void> => {
    if (voice !== "arming" && voice !== "listening") return;
    setVoice("sending");
    speechStop();
    await new Promise((r) => setTimeout(r, VOICE_FINAL_GRACE_MS)); // 识别器收尾出最终结果
    const final = (await speechPoll()).trim();
    setVoice("off");
    setVoiceText("");
    if (!final) return; // 什么都没听到：安静收场
    setSlidIn(true);
    localStorage.setItem(OPEN_KEY, "1");
    setClosing(false);
    setOpen(true);
    setUnread(0);
    await newSession();
    setInput(final); // 填入输入框；用户确认后回车发送
    window.setTimeout(() => setSlidIn(false), 700);
  };

  const onIslandPointerDown = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    setVoiceFail(null);
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      void enterVoice();
    }, VOICE_HOLD_MS);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 捕获失败仍可长按 */
    }
  };
  const onIslandPointerUp = (): void => {
    if (pressTimer.current != null) {
      // 未到长按阈值 = 点击：开/收面板
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
      toggle();
      return;
    }
    void finishVoice();
  };
  const onIslandPointerCancel = (): void => {
    if (pressTimer.current != null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
      return;
    }
    void finishVoice();
  };
  const onIslandKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  };

  if (!pid) return null;
  const budgetPct = usage.budgetUsd ? Math.min(100, ((usage.totalCostUsd ?? 0) / usage.budgetUsd) * 100) : 0;

  return (
    <>
      {/* 语音遮罩（雾白半透明下半屏）：长按期间实时转写 */}
      {voice !== "off" || voiceFail ? (
        <div className={"dock-voice-mask" + (voice === "sending" || voiceFail ? " is-out" : "")} aria-live="polite">
          {voiceFail ? (
            <>
              <div className="dock-voice-live">{voiceFail}</div>
              <div className="dock-voice-hint">稍后自动关闭</div>
            </>
          ) : (
            <>
              <div className="dock-voice-live">{voice === "arming" ? "正在启动语音…" : voiceText || "请说话…"}</div>
              <div className="dock-voice-hint">{voice === "arming" ? "首次需在系统授权窗点允许" : "松手发送 · 说话内容将填入新对话"}</div>
            </>
          )}
        </div>
      ) : null}

      {/* 灵动岛胶囊：底部中央 */}
      <button
        className={"dock-island" + (voice !== "off" ? " is-voice" : "") + (open ? " is-open" : "")}
        style={islandW ? ({ "--island-w": `${Math.round(islandW) + 58}px` } as CSSProperties) : undefined}
        aria-label="OneTHU 对话（点击展开，长按语音输入）"
        onPointerDown={onIslandPointerDown}
        onPointerUp={onIslandPointerUp}
        onPointerCancel={onIslandPointerCancel}
        onKeyDown={onIslandKeyDown}
      >
        <span className="dock-island-logo"><HarnessMark size={15} /></span>
        <span className="dock-island-text" ref={islandTextRef} key={islandText}>
          {[...islandText].map((ch, i) => (
            <i key={i} style={{ animationDelay: `${i * 26}ms` }}>{ch === " " ? "\u00A0" : ch}</i>
          ))}
        </span>
        {unread > 0 && !open ? <span className="dock-badge">{unread > 9 ? "9+" : unread}</span> : null}
        {voice !== "off" ? (
          <>
            <span className="dock-island-ripple" />
            <span className="dock-island-ripple r2" />
          </>
        ) : null}
      </button>

      {open || closing ? (
        <div
          className={"dock-panel" + (closing ? " is-closing" : "") + (slidIn ? " is-slide" : "")}
          role="dialog"
          aria-label="OneTHU Harness 对话"
        >
          <div className="dock-head">
            <span className="dock-title" title="小OH"><HarnessMark size={15} /></span>
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
              <button className="btn dock-btn dock-ico" title="导入会话 JSON" aria-label="导入会话" onClick={() => fileRef.current?.click()}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 15V3" /><path d="m8 7 4-4 4 4" /><path d="M4 19h16" /></svg>
              </button>
              <input
                ref={fileRef}
                type="file" accept=".json,application/json"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importSession(f);
                  e.target.value = "";
                }}
              />
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
