/**
 * 开发者面板（仅 dev 构建）：右上角常驻 commit 徽标，点开是构建信息 + 前端日志 + 一键导出。
 *
 * 正式版不会加载本模块：Layout.tsx 里写成
 *   const DevPanel = __ONETHU_DEV__ ? lazy(() => import("./DevPanel.js")) : null;
 * define 折叠后是 null，那句动态 import 一并被 rollup 删除（守卫 + 构建后 grep dist 双重把关）。
 * 样式全部内联：dev 代码不往正式版的 CSS 里留任何选择器。
 */
import { useEffect, useState, type CSSProperties } from "react";
import { Btn } from "@onethu/gui";
import { invoke } from "@tauri-apps/api/core";
import { isAndroidNavigator, isWindowsNavigator } from "../lib/androidHost.js";
import { APP_VERSION, BUILD_COMMIT, BUILD_TIME } from "../lib/buildinfo.js";
import { clearDevLog, devLogEntries, devLogText, type DevLogEntry } from "../lib/devlog.js";
import { t as i18n } from "../i18n/index.js";


const HIDE_KEY = "onethu.dev.badge.hidden";

const S: Record<string, CSSProperties> = {
  badge: {
    position: "fixed", top: 6, right: 8, zIndex: 9000,
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "2px 8px", borderRadius: 999,
    background: "var(--og-fill-overlay)", color: "var(--og-success)",
    border: "1px solid var(--og-line-2)",
    font: "11px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    cursor: "pointer", userSelect: "none", backdropFilter: "blur(4px)",
  },
  panel: {
    position: "fixed", top: 30, right: 8, zIndex: 9001,
    width: "min(560px, 94vw)", maxHeight: "76vh", overflow: "auto",
    background: "var(--og-menu-fill)", color: "var(--og-content-1)",
    border: "1px solid var(--og-line-2)", borderRadius: 10,
    boxShadow: "var(--og-elev-menu)",
    font: "12px/1.7 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    padding: 12,
  },
  row: { display: "flex", gap: 8, alignItems: "baseline", borderBottom: "1px solid var(--og-line-1)", padding: "3px 0" },
  key: { color: "var(--og-content-3)", flex: "0 0 76px" },
  val: { color: "var(--og-content-1)", wordBreak: "break-all", flex: "1 1 auto" },
  bar: { display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0 8px" },
  btn: {
    background: "var(--og-surface-3)", color: "var(--og-content-1)", border: "1px solid var(--og-line-2)",
    borderRadius: 6, padding: "3px 10px", cursor: "pointer", font: "inherit",
  },
  log: {
    background: "var(--og-surface-3)", border: "1px solid var(--og-line-1)", borderRadius: 6,
    padding: 8, maxHeight: "38vh", overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all",
  },
  line: { display: "flex", gap: 6 },
  note: { color: "var(--og-warning)", marginTop: 6, minHeight: 16 },
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
  if (level === "error") return "var(--og-error)";
  if (level === "warn") return "var(--og-warning)";
  return "var(--og-content-2)";
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
      <Btn className="og-dev-badge" size="sm" variant="outline" onClick={() => setOpen(!open)} titleAttr={"dev 构建 " + buildTimeText()}>
        dev · {BUILD_COMMIT}
      </Btn>
      {open ? (
        <div style={S.panel}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <strong style={{ color: "var(--og-success)" }}>OneTHU dev</strong>
            <span style={{ color: "var(--og-content-3)" }}>v{APP_VERSION}</span>
            <span style={{ flex: "1 1 auto" }} />
            <Btn variant="outline" size="sm" onClick={hide}>{i18n("auto.components.DevPanel.1")}</Btn>
            <Btn variant="outline" size="sm" onClick={() => setOpen(false)}>{i18n("auto.components.DevPanel.2")}</Btn>
            {/* 竖屏取景框：整页换成一块真手机视口（同源 iframe，登录态照旧）。
                窗口拖窄 ≠ 手机——比例/DPR/安全区都不对，这个入口才是看真机版式的地方。 */}
            <Btn variant="outline" size="sm" onClick={() => { window.location.href = window.location.pathname + "?phone-frame=1"; }}>{i18n("auto.components.DevPanel.3")}</Btn>
          </div>
          <div style={S.row}><span style={S.key}>commit</span><span style={S.val}>{BUILD_COMMIT}</span></div>
          <div style={S.row}><span style={S.key}>{i18n("auto.components.DevPanel.4")}</span><span style={S.val}>{buildTimeText()}</span></div>
          <div style={S.row}><span style={S.key}>{i18n("auto.components.DevPanel.5")}</span><span style={S.val}>{hostName()}</span></div>
          <div style={S.row}>
            <span style={S.key}>{i18n("auto.components.DevPanel.6")}</span>
            <span style={S.val}>{window.innerWidth}x{window.innerHeight} · dpr {window.devicePixelRatio}</span>
          </div>
          <div style={S.bar}>
            <Btn variant="outline" size="sm" disabled={busy} onClick={() => void exportLog()}>{busy ? "导出中…" : "导出运行日志"}</Btn>
            <Btn variant="outline" size="sm" onClick={() => void copy(devLogText(), "前端日志")}>{i18n("auto.components.DevPanel.7")}</Btn>
            <Btn variant="outline" size="sm" onClick={() => void copy(diagnostics(), "诊断信息")}>{i18n("auto.components.DevPanel.8")}</Btn>
            <Btn variant="outline" size="sm" onClick={() => { clearDevLog(); setLogs([]); setNote("已清空前端日志缓冲"); }}>{i18n("auto.components.DevPanel.9")}</Btn>
          </div>
          <div style={S.note}>{note}</div>
          <div style={{ color: "var(--og-content-3)", margin: "6px 0 4px" }}>{i18n("auto.components.DevPanel.10")}{logs.length} {i18n("auto.components.DevPanel.11")}</div>
          <div style={S.log}>
            {logs.length === 0 ? <div style={{ color: "var(--og-content-disabled)" }}>{i18n("auto.components.DevPanel.12")}</div> : null}
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
