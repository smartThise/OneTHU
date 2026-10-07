/**
 * 开发者面板（仅 dev 构建）：右上角常驻 commit 徽标，点开是构建信息 + 前端日志 + 一键导出。
 *
 * 正式版不会加载本模块：Layout.tsx 里写成
 *   const DevPanel = __ONETHU_DEV__ ? lazy(() => import("./DevPanel.js")) : null;
 * define 折叠后是 null，那句动态 import 一并被 rollup 删除（守卫 + 构建后 grep dist 双重把关）。
 * 样式全部内联：dev 代码不往正式版的 CSS 里留任何选择器。
 */
import { useEffect, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isAndroidNavigator, isWindowsNavigator } from "../lib/androidHost.js";
import { APP_VERSION, BUILD_COMMIT, BUILD_TIME } from "../lib/buildinfo.js";
import { clearDevLog, devLogEntries, devLogText, type DevLogEntry } from "../lib/devlog.js";

const HIDE_KEY = "onethu.dev.badge.hidden";

const S: Record<string, CSSProperties> = {
  badge: {
    position: "fixed", top: 6, right: 8, zIndex: 9000,
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "2px 8px", borderRadius: 999,
    background: "rgba(22,24,29,0.88)", color: "#8ef0b0",
    border: "1px solid rgba(142,240,176,0.35)",
    font: "11px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    cursor: "pointer", userSelect: "none", backdropFilter: "blur(4px)",
  },
  panel: {
    position: "fixed", top: 30, right: 8, zIndex: 9001,
    width: "min(560px, 94vw)", maxHeight: "76vh", overflow: "auto",
    background: "#16181d", color: "#e6e8ec",
    border: "1px solid #3a3f4b", borderRadius: 10,
    boxShadow: "0 18px 48px rgba(0,0,0,0.45)",
    font: "12px/1.7 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    padding: 12,
  },
  row: { display: "flex", gap: 8, alignItems: "baseline", borderBottom: "1px solid #23262e", padding: "3px 0" },
  key: { color: "#8b93a3", flex: "0 0 76px" },
  val: { color: "#e6e8ec", wordBreak: "break-all", flex: "1 1 auto" },
  bar: { display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0 8px" },
  btn: {
    background: "#232733", color: "#e6e8ec", border: "1px solid #3a3f4b",
    borderRadius: 6, padding: "3px 10px", cursor: "pointer", font: "inherit",
  },
  log: {
    background: "#0f1115", border: "1px solid #23262e", borderRadius: 6,
    padding: 8, maxHeight: "38vh", overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all",
  },
  line: { display: "flex", gap: 6 },
  note: { color: "#ffd479", marginTop: 6, minHeight: 16 },
};

function hostName(): string {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  if (isAndroidNavigator(nav)) return "Android";
  if (isWindowsNavigator(nav)) return "Windows";
  return (nav && nav.platform) || "未知";
}

function buildTimeText(): string {
  if (!BUILD_TIME) return "未知";
  const d = new Date(BUILD_TIME);
  return isNaN(d.getTime()) ? BUILD_TIME : d.toLocaleString();
}

function levelColor(level: string): string {
  if (level === "error") return "#ff8a8a";
  if (level === "warn") return "#ffd479";
  return "#9fb3c8";
}

export default function DevPanel() {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [logs, setLogs] = useState<DevLogEntry[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(HIDE_KEY) === "1");
    } catch {
      /* 隐私模式等场景下 localStorage 不可用 */
    }
  }, []);

  // 面板打开时轮询快照：日志桥不搞订阅，避免 dev 代码侵入业务模块
  useEffect(() => {
    if (!open) return;
    const tick = (): void => setLogs(devLogEntries());
    tick();
    const id = window.setInterval(tick, 800);
    return () => window.clearInterval(id);
  }, [open]);

  const hide = (): void => {
    setOpen(false);
    setHidden(true);
    try {
      window.localStorage.setItem(HIDE_KEY, "1");
    } catch {
      /* 忽略 */
    }
  };

  const copy = async (text: string, what: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setNote(what + "已复制到剪贴板");
    } catch (err) {
      setNote("复制失败: " + String(err instanceof Error ? err.message : err));
    }
  };

  const exportLog = async (): Promise<void> => {
    setBusy(true);
    setNote("");
    try {
      const where = await invoke<string>("debug_log_export");
      setNote("已导出到 " + where);
    } catch (err) {
      setNote(String(err instanceof Error ? err.message : err).slice(0, 160));
    } finally {
      setBusy(false);
    }
  };

  const diagnostics = (): string => {
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    return [
      "OneTHU dev 构建信息",
      "版本: " + APP_VERSION,
      "commit: " + BUILD_COMMIT,
      "构建时间: " + buildTimeText(),
      "宿主: " + hostName(),
      "视口: " + window.innerWidth + "x" + window.innerHeight + " dpr=" + window.devicePixelRatio,
      "语言: " + (nav ? nav.language : "?"),
      "UA: " + (nav ? nav.userAgent : "?"),
    ].join("\n");
  };

  if (hidden) return null;

  return (
    <>
      <button style={S.badge} onClick={() => setOpen(!open)} title={"dev 构建 " + buildTimeText()}>
        dev · {BUILD_COMMIT}
      </button>
      {open ? (
        <div style={S.panel}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <strong style={{ color: "#8ef0b0" }}>OneTHU dev</strong>
            <span style={{ color: "#8b93a3" }}>v{APP_VERSION}</span>
            <span style={{ flex: "1 1 auto" }} />
            <button style={S.btn} onClick={hide}>隐藏徽标</button>
            <button style={S.btn} onClick={() => setOpen(false)}>关闭</button>
          </div>
          <div style={S.row}><span style={S.key}>commit</span><span style={S.val}>{BUILD_COMMIT}</span></div>
          <div style={S.row}><span style={S.key}>构建时间</span><span style={S.val}>{buildTimeText()}</span></div>
          <div style={S.row}><span style={S.key}>宿主</span><span style={S.val}>{hostName()}</span></div>
          <div style={S.row}>
            <span style={S.key}>视口</span>
            <span style={S.val}>{window.innerWidth}x{window.innerHeight} · dpr {window.devicePixelRatio}</span>
          </div>
          <div style={S.bar}>
            <button style={S.btn} disabled={busy} onClick={() => void exportLog()}>{busy ? "导出中…" : "导出运行日志"}</button>
            <button style={S.btn} onClick={() => void copy(devLogText(), "前端日志")}>复制前端日志</button>
            <button style={S.btn} onClick={() => void copy(diagnostics(), "诊断信息")}>复制诊断信息</button>
            <button style={S.btn} onClick={() => { clearDevLog(); setLogs([]); setNote("已清空前端日志缓冲"); }}>清空</button>
          </div>
          <div style={S.note}>{note}</div>
          <div style={{ color: "#8b93a3", margin: "6px 0 4px" }}>前端日志（{logs.length} 条，最新在下；已同步进 onethu-debug.log）</div>
          <div style={S.log}>
            {logs.length === 0 ? <div style={{ color: "#5f6673" }}>（暂无）</div> : null}
            {logs.map((e, i) => (
              <div style={S.line} key={String(e.t) + "-" + i}>
                <span style={{ color: levelColor(e.level), flex: "0 0 44px" }}>{e.level}</span>
                <span style={{ flex: "1 1 auto" }}>{e.text}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
