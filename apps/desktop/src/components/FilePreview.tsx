/**
 * 统一文件预览（全局唯一弹窗，module-level opener 通道，同 zhjwxk/Courses.tsx 的 _detailOpen 做法）：
 * openFilePreview({ name, url }) 任意处调用 → FilePreviewHost（App 级挂载一次）createPortal 渲染。
 * 抓取走 Rust fetch_binary（webview 直挂 learn 地址只会得到登录页），按扩展名分流渲染：
 * 图片 / PDF / 文本 / zip·jar 目录 / docx·xlsx·pptx 内部结构 / 其他（下载兜底）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { http, downloadLearnUrl, withLearnCsrf } from "../lib/clients.js";
import { explainNetworkError } from "../lib/transport.js";
import { Empty } from "./Layout.js";

/* ---------- opener 通道 ---------- */

export interface FilePreviewTarget {
  name: string;
  url: string;
}

let _open: ((t: FilePreviewTarget) => void) | null = null;

export function openFilePreview(target: FilePreviewTarget): void {
  _open?.(target);
}

/* ---------- 类型分流 ---------- */

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]);
const TEXT_EXTS = new Set([
  "txt", "md", "log", "json", "csv", "html", "htm", "xml", "yml", "yaml",
  "js", "mjs", "cjs", "ts", "tsx", "jsx", "css", "scss", "less", "py", "java",
  "c", "h", "cpp", "hpp", "cc", "sh", "bat", "ps1", "sql", "ini", "conf", "toml",
  "properties", "srt", "vtt", "tex", "r", "go", "rs", "rb", "php",
]);
const ZIP_EXTS = new Set(["zip", "jar"]);
const OFFICE_EXTS = new Set(["docx", "xlsx", "pptx"]);
/** 文本/zip 解码上限：超过则引导下载（防止 atob 大文件卡 UI） */
const DECODE_LIMIT = 20 * 1024 * 1024;

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)\s*$/i.exec(name.trim());
  return m ? (m[1] ?? "").toLowerCase() : "";
}

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function base64ByteLength(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---------- 抓取（复用 fetchImageAsDataUrl 的 fetch_binary 思路，mime 单独带回） ---------- */

interface FetchedBinary {
  mime: string;
  /** dataURL（可直接给 <img>/<embed>） */
  dataUrl: string;
  /** 纯 base64 段（按需解码字节） */
  b64: string;
}

async function fetchBinary(url: string): Promise<FetchedBinary> {
  const target = withLearnCsrf(url); // learn 下载端点缺 _csrf 会回 HTML 错误页
  const jarCookies = http.jar
    .getCookies(new URL(target))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const { invoke } = await import("@tauri-apps/api/core");
  const out = await invoke<{ mime: string; data: string }>("fetch_binary", { url: target, cookies: jarCookies });
  const mime = (out.mime || "application/octet-stream").split(";")[0]?.trim() || "application/octet-stream";
  return { mime, dataUrl: `data:${mime};base64,${out.data}`, b64: out.data };
}

/* ---------- 手写 ZIP 目录读取（EOCD 0x06054b50 → central directory 0x02014b50） ---------- */

interface ZipEntry {
  name: string;
  /** 未压缩大小 */
  size: number;
  isDir: boolean;
}

function readU16(b: Uint8Array, off: number): number {
  return (b[off] ?? 0) | ((b[off + 1] ?? 0) << 8);
}

function readU32(b: Uint8Array, off: number): number {
  return ((b[off] ?? 0) | ((b[off + 1] ?? 0) << 8) | ((b[off + 2] ?? 0) << 16) | ((b[off + 3] ?? 0) << 24)) >>> 0;
}

function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  // 从尾部找 EOCD（固定段 22 字节 + 最长 65535 注释）
  const minStart = Math.max(0, bytes.length - 22 - 65535);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= minStart; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("未找到 ZIP 目录结尾（EOCD），文件可能损坏");
  const count = readU16(bytes, eocd + 10);
  let off = readU32(bytes, eocd + 16);
  const utf8 = new TextDecoder("utf-8");
  const latin1 = new TextDecoder("latin1");
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count && off + 46 <= bytes.length; i++) {
    if (readU32(bytes, off) !== 0x02014b50) break;
    const flags = readU16(bytes, off + 8);
    const size = readU32(bytes, off + 24);
    const nameLen = readU16(bytes, off + 28);
    const extraLen = readU16(bytes, off + 30);
    const commentLen = readU16(bytes, off + 32);
    const raw = bytes.subarray(off + 46, off + 46 + nameLen);
    // flag bit 11 = UTF-8 文件名；否则 utf8 优先，出现替换符再退 latin1（cp437/gbk 不强求）
    let name: string;
    if (flags & 0x0800) {
      name = utf8.decode(raw);
    } else {
      const t = utf8.decode(raw);
      name = t.includes("\ufffd") ? latin1.decode(raw) : t;
    }
    entries.push({ name, size, isDir: name.endsWith("/") });
    off += 46 + nameLen + extraLen + commentLen;
  }
  if (!entries.length) throw new Error("ZIP 目录为空或解析失败");
  return entries;
}

/* ---------- 渲染态 ---------- */

type ReadyView =
  | { kind: "image"; dataUrl: string; mime: string; size: number }
  | { kind: "pdf"; dataUrl: string; size: number }
  | { kind: "text"; text: string; mojibake: boolean; size: number }
  | { kind: "zip"; entries: ZipEntry[]; office: boolean; size: number }
  | { kind: "other"; mime: string; size: number };

type Phase =
  | { s: "loading" }
  | { s: "error"; msg: string }
  | { s: "ready"; view: ReadyView };

/** 按扩展名（辅以 mime 兜底）把抓到的二进制路由成可渲染视图 */
function routeByExt(name: string, bin: FetchedBinary): ReadyView {
  const ext = extOf(name);
  const size = base64ByteLength(bin.b64);
  const isImage = IMAGE_EXTS.has(ext) || (!ext && bin.mime.startsWith("image/"));
  const isPdf = ext === "pdf" || (!ext && bin.mime === "application/pdf");
  const isZip = ZIP_EXTS.has(ext) || OFFICE_EXTS.has(ext);
  const isText = TEXT_EXTS.has(ext) || (!ext && (bin.mime.startsWith("text/") || bin.mime === "application/json"));

  if (isImage) return { kind: "image", dataUrl: bin.dataUrl, mime: bin.mime, size };
  if (isPdf) return { kind: "pdf", dataUrl: bin.dataUrl, size };

  if (isText || isZip) {
    if (size > DECODE_LIMIT) {
      // 超限不进内存解码，走下载兜底
      return { kind: "other", mime: bin.mime, size };
    }
    const bytes = base64ToBytes(bin.b64);
    if (isZip) {
      return { kind: "zip", entries: readZipEntries(bytes), office: OFFICE_EXTS.has(ext), size };
    }
    const text = new TextDecoder("utf-8").decode(bytes);
    const mojibake = text.includes("\ufffd");
    return { kind: "text", text, mojibake, size };
  }

  return { kind: "other", mime: bin.mime, size };
}

/* ---------- 宿主 + 弹窗（表面样式同 zhjwxk/Courses.tsx 的 maskStyle/panelStyle） ---------- */

const maskStyle: CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1000,
  display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
};
const panelStyle: CSSProperties = {
  width: "100%", maxWidth: 920, maxHeight: "88vh", display: "flex", flexDirection: "column",
  background: "var(--bg-elev, #ffffff)", color: "var(--text, #1f2329)",
  borderRadius: 14, boxShadow: "0 18px 50px rgba(0,0,0,.28)", overflow: "hidden",
};
const headStyle: CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
  borderBottom: "1px solid var(--border, #eee)", flexShrink: 0,
};
const bodyStyle: CSSProperties = { flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" };

interface OpenState {
  name: string;
  url: string;
  /** 每次 open/重试自增，保证同一文件重复打开也会重新抓取 */
  seq: number;
}

export function FilePreviewHost() {
  const [cur, setCur] = useState<OpenState | null>(null);
  const [phase, setPhase] = useState<Phase>({ s: "loading" });
  const [dlBusy, setDlBusy] = useState(false);
  const [dlMsg, setDlMsg] = useState("");
  const seqRef = useRef(0);

  useEffect(() => {
    _open = (t) => {
      seqRef.current += 1;
      setDlMsg("");
      setCur({ name: t.name, url: t.url, seq: seqRef.current });
    };
    return () => {
      _open = null;
    };
  }, []);

  const close = useCallback(() => setCur(null), []);

  // Esc 关闭（ReviewsModal 同款）
  useEffect(() => {
    if (!cur) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cur, close]);

  // 打开即抓取：按扩展名分流
  useEffect(() => {
    if (!cur) return;
    let alive = true;
    setPhase({ s: "loading" });
    void (async () => {
      try {
        const bin = await fetchBinary(cur.url);
        if (!alive) return;
        setPhase({ s: "ready", view: routeByExt(cur.name, bin) });
      } catch (err) {
        if (!alive) return;
        setPhase({ s: "error", msg: explainNetworkError(err) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [cur]);

  const doDownload = useCallback(async () => {
    if (!cur || dlBusy) return;
    setDlBusy(true);
    setDlMsg("");
    try {
      const path = await downloadLearnUrl(cur.url, cur.name || "download");
      setDlMsg(`已下载到：${path}`);
    } catch (err) {
      setDlMsg("下载失败：" + explainNetworkError(err));
    } finally {
      setDlBusy(false);
    }
  }, [cur, dlBusy]);

  if (!cur) return null;

  const retry = () => {
    if (!cur) return;
    seqRef.current += 1;
    setDlMsg("");
    setCur({ ...cur, seq: seqRef.current });
  };

  const view = phase.s === "ready" ? phase.view : null;
  const metaBits: string[] = [];
  if (view) {
    if (view.size) metaBits.push(fmtBytes(view.size));
    if (view.kind === "image" || view.kind === "other") metaBits.push(view.mime);
  }

  return createPortal(
    <div style={maskStyle} onClick={close}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headStyle}>
          <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }} title={cur.name}>
            {cur.name || "文件预览"}
          </b>
          {metaBits.length ? (
            <span style={{ fontSize: 11, color: "var(--text-3, #9aa1ac)", flexShrink: 0 }}>{metaBits.join(" · ")}</span>
          ) : null}
          <span style={{ flex: 1 }} />
          <button className="btn" disabled={dlBusy} onClick={() => void doDownload()}>
            {dlBusy ? "下载中…" : "下载"}
          </button>
          <button className="btn" onClick={close}>✕</button>
        </div>

        <div style={bodyStyle}>
          {phase.s === "loading" ? <Empty text="正在加载文件…" /> : null}

          {phase.s === "error" ? (
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
              <Empty text={`预览加载失败：${phase.msg}`} />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" onClick={retry}>重试</button>
                <button className="btn" disabled={dlBusy} onClick={() => void doDownload()}>
                  {dlBusy ? "下载中…" : "下载查看"}
                </button>
              </div>
            </div>
          ) : null}

          {view?.kind === "image" ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 12, background: "rgba(127,127,127,.05)", minHeight: 220 }}>
              <img
                src={view.dataUrl}
                alt={cur.name}
                style={{ maxWidth: "100%", maxHeight: "66vh", objectFit: "contain", borderRadius: 8 }}
              />
            </div>
          ) : null}

          {view?.kind === "pdf" ? (
            <embed src={view.dataUrl} type="application/pdf" style={{ width: "100%", height: "70vh", border: "none" }} />
          ) : null}

          {view?.kind === "text" ? (
            <div style={{ padding: 12 }}>
              {view.mojibake ? (
                <div style={{ fontSize: 12, color: "var(--amber, #ff9f1a)", marginBottom: 8 }}>
                  文件可能不是 UTF-8 编码（如 GBK），部分字符可能显示为乱码。
                </div>
              ) : null}
              <pre
                style={{
                  margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 12.5,
                  lineHeight: 1.6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                {view.text}
              </pre>
            </div>
          ) : null}

          {view?.kind === "zip" ? (
            <div style={{ padding: 12 }}>
              {view.office ? (
                <div style={{ fontSize: 12.5, color: "var(--accent)", background: "var(--accent-soft, rgba(0,120,212,.08))", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
                  Office 预览开发中，可下载查看。以下为文档内部结构：
                </div>
              ) : null}
              <div style={{ fontSize: 11, color: "var(--text-3, #9aa1ac)", marginBottom: 6 }}>
                共 {view.entries.length} 项（仅列出目录，未解压内容）
              </div>
              {view.entries.slice(0, 300).map((e, i) => (
                <div
                  key={`${i}-${e.name}`}
                  style={{
                    display: "flex", gap: 10, alignItems: "baseline", padding: "4px 2px",
                    borderBottom: "1px solid var(--border, #f0f0f0)", fontSize: 12.5,
                  }}
                >
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={e.name}>
                    {e.isDir ? "📁 " : "📄 "}
                    {e.name}
                  </span>
                  <span style={{ color: "var(--text-3, #9aa1ac)", flexShrink: 0 }}>
                    {e.isDir ? "目录" : e.size ? fmtBytes(e.size) : "0 B"}
                  </span>
                </div>
              ))}
              {view.entries.length > 300 ? (
                <div style={{ paddingTop: 8, fontSize: 12, color: "var(--text-3, #9aa1ac)" }}>
                  …还有 {view.entries.length - 300} 项未显示
                </div>
              ) : null}
            </div>
          ) : null}

          {view?.kind === "other" ? (
            <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12, alignItems: "center", justifyContent: "center", flex: 1 }}>
              <Empty text="该格式暂不支持在线预览" />
              <div style={{ fontSize: 12, color: "var(--text-3, #9aa1ac)" }}>
                {view.mime}
                {view.size ? ` · ${fmtBytes(view.size)}` : ""}
              </div>
              <button className="btn" disabled={dlBusy} onClick={() => void doDownload()}>
                {dlBusy ? "下载中…" : "下载查看"}
              </button>
            </div>
          ) : null}
        </div>

        {dlMsg ? (
          <div style={{ flexShrink: 0, padding: "6px 14px", fontSize: 12, borderTop: "1px solid var(--border, #eee)", color: "var(--accent)", wordBreak: "break-all" }}>
            {dlMsg}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
