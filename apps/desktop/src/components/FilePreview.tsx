/**
 * 统一文件预览（全局唯一弹窗，module-level opener 通道，同 zhjwxk/Courses.tsx 的 _detailOpen 做法）：
 * openFilePreview({ name, url }) 任意处调用 → FilePreviewHost（App 级挂载一次）createPortal 渲染。
 * 抓取走 Rust fetch_binary（webview 直挂 learn 地址只会得到登录页），按扩展名分流渲染：
 * 图片 / PDF / 文本 / zip·jar 层级目录树（可逐层进入+文本条目内联预览）/
 * Office 真预览（docx→mammoth HTML、xlsx→SheetJS 表格、pptx→解包 slideN.xml 抽大纲）/
 * 其他（下载兜底）。
 * Office 全部本地解析（mammoth/SheetJS 动态 import + zipTree 解包），不外传文件内容；
 * 任一环节失败（依赖加载失败/格式异常/算法不支持）都回退"内部文件树 + 下载"兜底，绝不白屏。
 */
import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { http, downloadLearnUrl, saveLearnUrlAs, withLearnCsrf } from "../lib/clients.js";
import { isAndroidHost } from "../lib/yktWebview.js";
import { isAndroidNavigator, isWindowsNavigator } from "../lib/androidHost.js";
import { normalizeWebvpnUrl } from "@onethu/core";
import { explainNetworkError, rawErrorText } from "../lib/transport.js";
import { Empty } from "./Layout.js";
import { DownloadOpenButtons } from "./DownloadOpenButtons.js";
import { openLocalPath } from "../lib/localFile.js";
import {
  buildZipTree,
  extractEntryBytes,
  extractPptxSlides,
  readZipEntries,
  resolveZipNode,
} from "../lib/zipTree.js";
import type { PptxSlide, ZipEntry, ZipNode } from "../lib/zipTree.js";

/* ⚠️ 安卓宿主判定绝不能用裸 UA 正则（R21 修正）：主窗口 UA 被 tauri.conf.json 伪装成
 * Windows Chrome/79（webvpn 票绑定），裸 UA 正则在真机恒 false —— 正是
 * 9-13 的 pdf.js 内嵌预览在真机从未执行、PDF 预览一直空白（用户实录 09-21）的根因。
 * 必须走 androidHost 的多信号判定（UA + userAgentData + platform）。 */
const IS_ANDROID_HOST = isAndroidNavigator(typeof navigator !== "undefined" ? navigator : undefined);
/** Windows 宿主（WebView2）：内置 PDF 查看器不可靠 + Chromium 系限制 data: URL 的 PDF 加载
 *  → 默认用 pdf.js 自绘（2026-09-21 用户实录「windows pdf 预览好像不行」）。判定只看
 *  userAgentData.platform / platform —— UA 里的 "Windows" 在安卓上是伪装的，不能当依据。 */
const IS_WINDOWS_HOST = isWindowsNavigator(typeof navigator !== "undefined" ? navigator : undefined);
/** 本内核是否自带 PDF 渲染器（Chromium 96+ 标准信号；旧内核无此属性 → undefined） */
const PDF_VIEWER_ENABLED =
  typeof navigator !== "undefined" && "pdfViewerEnabled" in navigator
    ? (navigator as Navigator & { pdfViewerEnabled?: boolean }).pdfViewerEnabled === true
    : undefined;

/* ---------- pdf.js 内嵌 PDF 预览（安卓 WebView 无原生 PDF 能力） ---------- */

/** base64 dataURL → 字节（pdfjs.getDocument 需 Uint8Array） */
function dataUrlBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** pdf.js 文档的最小结构面（避免整包类型耦合） */
interface PdfPageLike {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number }; transform?: number[] }): { promise: Promise<void> };
}
interface PdfDocLike {
  numPages: number;
  getPage(n: number): Promise<PdfPageLike>;
}

/** pdf.js 现代版构建对内核要求很高（如 Promise.withResolvers 需要 Chromium 119+），
 *  老内核 WebView 会直接抛错——失败自动换 legacy 构建（自带面向旧环境的转译与垫片），
 *  两轮都失败才把错误交回 UI。留痕用 console（安卓上可被 logcat 抓到），便于下次排障。 */
async function loadPdfDoc(dataUrl: string): Promise<PdfDocLike> {
  const variants = [
    { mod: () => import("pdfjs-dist"), worker: () => import("pdfjs-dist/build/pdf.worker.min.mjs?url"), tag: "modern" },
    {
      mod: () => import("pdfjs-dist/legacy/build/pdf.mjs"),
      worker: () => import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
      tag: "legacy",
    },
  ] as const;
  let lastErr: unknown = null;
  for (const v of variants) {
    try {
      const pdfjs = await v.mod();
      pdfjs.GlobalWorkerOptions.workerSrc = (await v.worker()).default;
      const d = await pdfjs.getDocument({ data: dataUrlBytes(dataUrl) }).promise;
      if (v.tag === "legacy") console.info("[FILE-PREVIEW] legacy 兜底解析成功");
      return d as unknown as PdfDocLike;
    } catch (e) {
      lastErr = e;
      console.error(`[FILE-PREVIEW] pdf.js(${v.tag}) 解析失败`, e);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "未知错误"));
}

/**
 * 预览内容错误边界（2026-09-21 用户实录：「Windows 点任何预览直接白屏」）。
 *
 * 预览是一堆渲染分支（pdf.js / 图片 / 文本 / zip / office 摘要），任何一支在某个内核上
 * 抛错都会让整棵 React 树卸载 → 整个应用白屏，用户只看到「什么都没了」。边界把错误收在
 * 预览面板内部：显示原因 + 重试，应用其余部分不受影响。
 */
/** Windows 预览失败时的兜底提示（R24：不再默认拒绝渲染，改为出错时说明 + 下载出口） */
const WIN_PREVIEW_NOTE = "预览仍出错时，请用上方「下载」查看。";
class PreviewErrorBoundary extends Component<
  { children: ReactNode; onRetry?: () => void; note?: string },
  { err: string | null }
> {
  constructor(props: { children: ReactNode; onRetry?: () => void; note?: string }) {
    super(props);
    this.state = { err: null };
  }

  static getDerivedStateFromError(e: unknown): { err: string } {
    return { err: e instanceof Error ? e.message : String(e) };
  }

  componentDidCatch(e: unknown): void {
    void import("../lib/clients.js")
      .then((m) => m.logLine(`PREVIEW-CRASH ${String(e).slice(0, 300)}`))
      .catch(() => undefined);
  }

  render(): ReactNode {
    if (this.state.err === null) return this.props.children;
    return (
      <div style={{ padding: 16, fontSize: 13, lineHeight: 1.7 }}>
        <div style={{ color: "var(--red)", marginBottom: 8 }}>预览渲染出错，已停在这一条上（应用其余功能不受影响）。</div>
        {this.props.note ? (
          <div style={{ color: "var(--text-3)", marginBottom: 8 }}>{this.props.note}</div>
        ) : null}
        <div style={{ color: "var(--text-3)", marginBottom: 12, wordBreak: "break-all" }}>{this.state.err.slice(0, 300)}</div>
        <button
          className="btn"
          onClick={() => {
            this.setState({ err: null });
            this.props.onRetry?.();
          }}
        >
          重试
        </button>
      </div>
    );
  }
}

function PdfCanvasView({ dataUrl, onOpenExternally, pdfBusy, dlMsg }: { dataUrl: string; onOpenExternally: () => Promise<void>; pdfBusy: boolean; dlMsg: string }): React.ReactNode {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [doc, setDoc] = useState<PdfDocLike | null>(null);
  const [pageNo, setPageNo] = useState(1);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setErr(null);
    setPageNo(1);
    (async () => {
      try {
        const d = await loadPdfDoc(dataUrl);
        if (!cancelled) setDoc(d);
      } catch (e) {
        if (cancelled) return;
        // 老内核缺现代 API（如 Promise.withResolvers）时给一句能看懂的归因，不堆原始报错
        const oldKernel = typeof (Promise as { withResolvers?: unknown }).withResolvers !== "function";
        setErr(
          oldKernel
            ? "本机网页内核较低，无法内嵌解析，请用「系统应用打开」。"
            : `PDF 解析失败：${e instanceof Error ? e.message : String(e)}`.slice(0, 160),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataUrl]);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await doc.getPage(pageNo);
        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        if (!canvas || !wrap || cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const availW = Math.max(220, (wrap.clientWidth || 360) - 16);
        const scale = availW / base.width;
        const vp = page.getViewport({ scale });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(vp.width * dpr);
        canvas.height = Math.round(vp.height * dpr);
        canvas.style.width = `${Math.round(vp.width)}px`;
        canvas.style.height = `${Math.round(vp.height)}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        await page.render({
          canvasContext: ctx,
          viewport: vp,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        }).promise;
      } catch (e) {
        if (!cancelled) setErr(`页面渲染失败：${e instanceof Error ? e.message : String(e)}`.slice(0, 160));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, pageNo]);

  if (err) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 24 }}>
        <div style={{ fontSize: 12.5, color: "var(--red, #e5484d)", textAlign: "center" }}>{err}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          <button className="btn" disabled={pdfBusy} onClick={() => void onOpenExternally()}>用系统应用打开</button>
          <button className="btn btn-ghost" disabled={pdfBusy} onClick={() => void onOpenExternally()}>系统应用打开</button>
        </div>
      </div>
    );
  }
  if (!doc) {
    return <div style={{ padding: 28, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}>PDF 解析中…</div>;
  }
  return (
    <div ref={wrapRef} style={{ flex: 1, overflow: "auto", padding: "8px 8px 0", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <canvas ref={canvasRef} style={{ borderRadius: 6, boxShadow: "var(--shadow-1)", background: "#fff", maxWidth: "100%" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0 10px", position: "sticky", bottom: 0, width: "100%", justifyContent: "center", flexWrap: "wrap" }}>
        <button className="btn" disabled={pageNo <= 1} onClick={() => setPageNo((n) => Math.max(1, n - 1))}>‹</button>
        <span style={{ fontSize: 12, color: "var(--text-2)", minWidth: 64, textAlign: "center" }}>{pageNo} / {doc.numPages}</span>
        <button className="btn" disabled={pageNo >= doc.numPages} onClick={() => setPageNo((n) => Math.min(doc.numPages, n + 1))}>›</button>
        <button className="btn btn-ghost" disabled={pdfBusy} title="下载临时文件后调起系统 PDF 应用" onClick={() => void onOpenExternally()}>
          {pdfBusy ? "调起中…" : "系统应用"}
        </button>
        <button className="btn btn-ghost" title="用本机 PDF 应用打开（要打印/目录时用）" disabled={pdfBusy} onClick={() => void onOpenExternally()}>系统应用打开</button>
      </div>
      {dlMsg ? <div style={{ fontSize: 11.5, color: "var(--text-3)", wordBreak: "break-all", padding: "0 8px 8px" }}>{dlMsg}</div> : null}
    </div>
  );
}

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
/** 预览抓取上限：再大就不走 IPC（base64 回传会把 WebView 拖死），直接引导下载。
 *  上限按宿主分档：桌面 48MB；**安卓 WebView 收紧到 10MB**——二进制要以 base64
 *  经 IPC 回传，20MB 的 PDF 就是 ~27MB 字符串，安卓侧会卡死/白屏（用户实录
 *  2026-09-20「手机端 PDF 预览坏了，其他都行」）。宁可早拒并给出「下载/另存为/
 *  系统应用」的明确出路，也不要把 WebView 拖死。 */
const PREVIEW_MAX_BYTES = 48 * 1024 * 1024;
const PREVIEW_MAX_BYTES_ANDROID = 10 * 1024 * 1024;

/** 当前宿主的预览上限（安卓收紧，见上） */
function previewCap(): number {
  return isAndroidHost ? PREVIEW_MAX_BYTES_ANDROID : PREVIEW_MAX_BYTES;
}
/** zip 内文本条目内联预览的大小上限 */
const ZIP_TEXT_LIMIT = 200 * 1024;
/** xlsx 单表最多渲染的行/列数（超出提示截断） */
const XLSX_ROW_LIMIT = 200;
const XLSX_COL_LIMIT = 60;
/** 目录树单层最多渲染的行数 */
const ZIP_ROW_CAP = 400;

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

/** 任意错误的中文可读描述（网络错误走 explainNetworkError，其余取 message） */
function errMsg(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Rust 侧大小闸门：too-large:<实际>:<上限> → 说清楚多大、该怎么办
  const big = /too-large:(\d+):(\d+)/.exec(raw);
  if (big) {
    return `文件较大（${fmtBytes(Number(big[1]))}），应用内预览上限 ${fmtBytes(Number(big[2]))}——点「下载」或「另存为」即可完整保存。`;
  }
  const s = explainNetworkError(err);
  if (s) return s;
  return raw;
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
  // 归一：页面里取到的链接可能已被网关包装（双重包装会 404，见 crypto/webvpn.normalizeWebvpnUrl）
  const target = withLearnCsrf(normalizeWebvpnUrl(url));
  const jarCookies = http.jar
    .getCookies(new URL(target))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const { invoke } = await import("@tauri-apps/api/core");
  // 预览上限与超时按文件预览调（默认 8MB/12s 是给正文图片的）：桌面放宽到 48MB，
  // 安卓因 base64 IPC 限制收紧到 10MB（见 PREVIEW_MAX_BYTES_ANDROID 注释）。
  const out = await invoke<{ mime: string; data: string }>("fetch_binary", {
    url: target,
    cookies: jarCookies,
    maxBytes: previewCap(),
    timeoutSecs: 60,
  });
  const mime = (out.mime || "application/octet-stream").split(";")[0]?.trim() || "application/octet-stream";
  return { mime, dataUrl: `data:${mime};base64,${out.data}`, b64: out.data };
}

/* ---------- Office 本地解析（docx/xlsx/pptx） ---------- */

/** mammoth 只在浏览器用 convertToHtml；独立接口避免拖进 Node 类型 */
interface MammothLike {
  convertToHtml(input: { arrayBuffer: ArrayBuffer }, options?: { styleMap?: string[] }): Promise<{ value: string }>;
}

interface XlsxSheetView {
  name: string;
  rows: string[][];
  totalRows: number;
  truncatedRows: boolean;
  truncatedCols: boolean;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as unknown as ArrayBuffer;
}

/** mammoth 输出做一遍轻量消毒：去脚本类标签与内联事件，防意外注入 */
function sanitizeDocxHtml(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("script,style,iframe,object,embed,link,meta,base").forEach((el) => el.remove());
    doc.querySelectorAll("*").forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        const n = attr.name.toLowerCase();
        if (n.startsWith("on") || (n === "href" && attr.value.trim().toLowerCase().startsWith("javascript:"))) {
          el.removeAttribute(attr.name);
        }
      }
    });
    return doc.body.innerHTML;
  } catch {
    return html.replace(/<script[\s\S]*?<\/script>/gi, "");
  }
}

/** docx 基础排版（标题/段落/表格边框/图片自适应），挂在 .docx-preview 作用域内 */
const DOCX_CSS = `
.docx-preview{font-size:13px;line-height:1.7}
.docx-preview h1,.docx-preview h2,.docx-preview h3,.docx-preview h4,.docx-preview h5,.docx-preview h6{margin:.8em 0 .4em;line-height:1.35}
.docx-preview h1{font-size:1.5em}.docx-preview h2{font-size:1.3em}.docx-preview h3{font-size:1.15em}
.docx-preview p{margin:.45em 0}
.docx-preview table{border-collapse:collapse;margin:.6em 0;max-width:100%}
.docx-preview td,.docx-preview th{border:1px solid var(--border,#d9d9d9);padding:4px 8px;font-size:12.5px}
.docx-preview img{max-width:100%;height:auto;border-radius:6px}
.docx-preview ul,.docx-preview ol{margin:.4em 0;padding-left:1.6em}
.docx-preview a{color:var(--accent,#1677ff)}
`;

interface ZipPayload {
  bytes: Uint8Array;
  entries: ZipEntry[];
}

type OfficeView =
  | { kind: "docx"; html: string; zip: ZipPayload; size: number }
  | { kind: "xlsx"; sheets: XlsxSheetView[]; zip: ZipPayload; size: number }
  | { kind: "pptx"; slides: PptxSlide[]; zip: ZipPayload; size: number };

/** 按扩展名本地解析 Office；任何失败抛 Error，由调用方回退内部文件树 */
async function parseOffice(name: string, zip: ZipPayload, size: number): Promise<OfficeView> {
  const ext = extOf(name);

  if (ext === "docx") {
    const mod = (await import("mammoth")) as unknown as { default?: MammothLike } & Partial<MammothLike>;
    const mammoth = mod.default?.convertToHtml ? mod.default : mod;
    if (!mammoth.convertToHtml) throw new Error("mammoth 模块加载失败");
    const res = await mammoth.convertToHtml({ arrayBuffer: bytesToArrayBuffer(zip.bytes) });
    return { kind: "docx", html: sanitizeDocxHtml(res.value), zip, size };
  }

  if (ext === "xlsx") {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(zip.bytes, { type: "array" });
    const sheets: XlsxSheetView[] = [];
    for (const sn of wb.SheetNames) {
      const ws = wb.Sheets[sn];
      if (!ws) continue;
      let rows: unknown[][] = [];
      try {
        rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: false });
      } catch {
        continue; // 单表解析失败跳过，不影响其他表
      }
      const totalCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
      sheets.push({
        name: sn,
        rows: rows.slice(0, XLSX_ROW_LIMIT).map((r) =>
          Array.from({ length: Math.min(r.length, XLSX_COL_LIMIT) }, (_, i) => String(r[i] ?? "")),
        ),
        totalRows: rows.length,
        truncatedRows: rows.length > XLSX_ROW_LIMIT,
        truncatedCols: totalCols > XLSX_COL_LIMIT,
      });
    }
    if (!sheets.length) throw new Error("未能读取任何工作表");
    return { kind: "xlsx", sheets, zip, size };
  }

  if (ext === "pptx") {
    const slides = await extractPptxSlides(zip.bytes, zip.entries);
    return { kind: "pptx", slides, zip, size };
  }

  throw new Error("未知 Office 格式");
}

/* ---------- 渲染态 ---------- */

type ReadyView =
  | { kind: "image"; dataUrl: string; mime: string; size: number }
  | { kind: "pdf"; dataUrl: string; size: number }
  | { kind: "text"; text: string; mojibake: boolean; size: number }
  | { kind: "zip"; zip: ZipPayload; office: boolean; notice?: string; size: number }
  | OfficeView
  | { kind: "other"; mime: string; size: number };

type Phase =
  | { s: "loading" }
  /** msg = 给人看的话；raw = 原生/网络的原话（同一句话就不重复显示） */
  | { s: "error"; msg: string; raw?: string }
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
      return { kind: "zip", zip: { bytes, entries: readZipEntries(bytes) }, office: OFFICE_EXTS.has(ext), size };
    }
    const text = new TextDecoder("utf-8").decode(bytes);
    const mojibake = text.includes("\ufffd");
    return { kind: "text", text, mojibake, size };
  }

  return { kind: "other", mime: bin.mime, size };
}

/* ---------- zip 层级树浏览（逐层进入 + 面包屑 + 文本条目内联预览） ---------- */

interface EntryPreviewState {
  path: string;
  name: string;
  size: number;
  phase: "loading" | "done" | "error";
  text?: string;
  mojibake?: boolean;
  err?: string;
}

const zipRowStyle: CSSProperties = {
  display: "flex", gap: 8, alignItems: "baseline", padding: "4px 2px",
  borderBottom: "1px solid var(--border, #f0f0f0)", fontSize: 12.5,
};
const zipNameStyle: CSSProperties = { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const zipMetaStyle: CSSProperties = { color: "var(--text-3, #9aa1ac)", flexShrink: 0, fontSize: 11.5 };

function crumbStyle(active: boolean): CSSProperties {
  return {
    cursor: "pointer", background: "none", border: "none", padding: 0, fontSize: 12.5,
    color: active ? "var(--text-1, #1f2329)" : "var(--accent, #1677ff)",
    fontWeight: active ? 600 : 400,
  };
}

function chipStyle(active: boolean): CSSProperties {
  return {
    padding: "3px 12px", borderRadius: 999, fontSize: 12, cursor: "pointer",
    border: `1px solid ${active ? "var(--accent, #1677ff)" : "var(--border, #e0e0e0)"}`,
    background: active ? "var(--accent-soft, rgba(22,119,255,.08))" : "transparent",
    color: active ? "var(--accent, #1677ff)" : "var(--text-2, #57606a)",
    flexShrink: 0,
  };
}

function ZipTreeView({ zip, notice }: { zip: ZipPayload; notice?: string }) {
  const [dirPath, setDirPath] = useState<string[]>([]);
  const [preview, setPreview] = useState<EntryPreviewState | null>(null);
  const previewSeq = useRef(0);
  const root = useMemo(() => buildZipTree(zip.entries), [zip.entries]);
  const node = resolveZipNode(root, dirPath) ?? root;
  const children = node.children ?? [];
  const shown = children.slice(0, ZIP_ROW_CAP);

  const jump = (path: string[]): void => {
    setPreview(null);
    setDirPath(path);
  };
  const enter = (seg: string): void => {
    setPreview(null);
    setDirPath((p) => [...p, seg]);
  };

  const openEntry = (n: ZipNode): void => {
    const raw = zip.entries.find((e) => e.name === n.path);
    const id = ++previewSeq.current;
    setPreview({ path: n.path, name: n.name, size: n.size, phase: "loading" });
    void (async () => {
      try {
        if (!raw) throw new Error("在压缩包目录中找不到该条目");
        if (raw.size > ZIP_TEXT_LIMIT) throw new Error(`超过内联预览上限 ${fmtBytes(ZIP_TEXT_LIMIT)}，请下载查看`);
        const data = await extractEntryBytes(zip.bytes, raw, ZIP_TEXT_LIMIT + 1);
        const text = new TextDecoder("utf-8").decode(data);
        if (previewSeq.current !== id) return; // 已点了别的条目，丢弃过期结果
        setPreview({ path: n.path, name: n.name, size: n.size, phase: "done", text, mojibake: text.includes("\ufffd") });
      } catch (err) {
        if (previewSeq.current !== id) return;
        setPreview({ path: n.path, name: n.name, size: n.size, phase: "error", err: errMsg(err) });
      }
    })();
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "10px 14px 14px" }}>
      {notice ? (
        <div style={{ fontSize: 12.5, color: "var(--amber, #ff9f1a)", background: "var(--accent-soft, rgba(255,159,26,.08))", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
          {notice}
        </div>
      ) : null}

      {/* 面包屑：根 / 一级目录 / 子目录，可点击回跳 */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, marginBottom: 4 }}>
        <button style={crumbStyle(dirPath.length === 0)} onClick={() => jump([])}>根</button>
        {dirPath.map((seg, i) => (
          <span key={`${i}-${seg}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ color: "var(--text-3, #9aa1ac)" }}>/</span>
            <button style={crumbStyle(i === dirPath.length - 1)} onClick={() => jump(dirPath.slice(0, i + 1))}>{seg}</button>
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--text-3, #9aa1ac)", flexShrink: 0 }}>
          当前层 {children.length} 项 · 全部 {root.fileCount} 个文件
        </span>
      </div>

      {preview ? (
        /* 单条文本条目的内联预览面板（替代列表展示） */
        <div style={{ border: "1px solid var(--border, #e5e5e5)", borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 8, flex: 1, minHeight: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            <button className="btn" onClick={() => setPreview(null)}>← 返回列表</button>
            <span style={{ ...zipNameStyle, fontSize: 12 }} title={preview.path}>📄 {preview.path}</span>
            <span style={zipMetaStyle}>{fmtBytes(preview.size)}</span>
          </div>
          {preview.phase === "loading" ? <Empty text="正在解压该条目…" /> : null}
          {preview.phase === "error" ? (
            <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
              <Empty text={`无法内联预览：${preview.err ?? "未知错误"}`} />
            </div>
          ) : null}
          {preview.phase === "done" ? (
            <div style={{ overflowY: "auto", minHeight: 0 }}>
              {preview.mojibake ? (
                <div style={{ fontSize: 12, color: "var(--amber, #ff9f1a)", marginBottom: 8 }}>
                  条目可能不是 UTF-8 编码（如 GBK），部分字符可能显示为乱码。
                </div>
              ) : null}
              <pre
                style={{
                  margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 12.5,
                  lineHeight: 1.6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                {preview.text}
              </pre>
            </div>
          ) : null}
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {shown.map((c, i) => {
            if (c.isDir) {
              return (
                <div
                  key={`d${i}-${c.path}`}
                  style={{ ...zipRowStyle, cursor: "pointer" }}
                  onClick={() => enter(c.name)}
                  title={`进入 ${c.name}`}
                >
                  <span style={{ flexShrink: 0 }}>📁</span>
                  <span style={zipNameStyle}>{c.name}</span>
                  <span style={zipMetaStyle}>{c.fileCount} 项 · {fmtBytes(c.size) || "0 B"}</span>
                </div>
              );
            }
            const previewable = TEXT_EXTS.has(extOf(c.name)) && c.size <= ZIP_TEXT_LIMIT;
            return (
              <div
                key={`f${i}-${c.path}`}
                style={{ ...zipRowStyle, cursor: previewable ? "pointer" : "default" }}
                onClick={previewable ? () => openEntry(c) : undefined}
                title={previewable ? "点击内联预览" : undefined}
              >
                <span style={{ flexShrink: 0 }}>📄</span>
                <span
                  style={{
                    ...zipNameStyle,
                    textDecoration: previewable ? "underline dotted" : "none",
                    textDecorationColor: "rgba(127,127,127,.45)",
                  }}
                >
                  {c.name}
                </span>
                {previewable ? (
                  <span style={{ fontSize: 11, color: "var(--accent, #1677ff)", flexShrink: 0 }}>预览</span>
                ) : null}
                <span style={zipMetaStyle}>{fmtBytes(c.size) || "0 B"}</span>
              </div>
            );
          })}
          {children.length > ZIP_ROW_CAP ? (
            <div style={{ paddingTop: 8, fontSize: 12, color: "var(--text-3, #9aa1ac)" }}>
              当前层还有 {children.length - ZIP_ROW_CAP} 项未显示，可下载查看完整内容
            </div>
          ) : null}
          {!children.length ? <Empty text="该目录为空" /> : null}
        </div>
      )}
    </div>
  );
}

/* ---------- Office 视图（内容预览 / 内部文件树 切换） ---------- */

function OfficeShell({ zip, children }: { zip: ZipPayload; children: ReactNode }) {
  const [tab, setTab] = useState<"doc" | "tree">("doc");
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "10px 14px 8px", flexShrink: 0 }}>
        <button style={chipStyle(tab === "doc")} onClick={() => setTab("doc")}>内容预览</button>
        <button style={chipStyle(tab === "tree")} onClick={() => setTab("tree")}>内部文件</button>
        <span style={{ fontSize: 11, color: "var(--text-3, #9aa1ac)" }}>本地解析渲染，可切换查看文档内部文件</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflowY: "auto" }}>
        {tab === "doc" ? children : <ZipTreeView zip={zip} />}
      </div>
    </div>
  );
}

function XlsxView({ sheets }: { sheets: XlsxSheetView[] }) {
  const [idx, setIdx] = useState(0);
  if (!sheets.length) return <Empty text="工作簿中没有可显示的工作表" />;
  const sheet = sheets[Math.min(idx, sheets.length - 1)] ?? sheets[0]!;
  const thStyle: CSSProperties = {
    border: "1px solid var(--border, #e0e0e0)", padding: "4px 8px", textAlign: "left",
    fontWeight: 600, whiteSpace: "nowrap", background: "var(--surface-3, rgba(127,127,127,.06))",
  };
  const tdStyle: CSSProperties = {
    border: "1px solid var(--border, #e0e0e0)", padding: "4px 8px",
    verticalAlign: "top", maxWidth: 320, overflowWrap: "break-word",
  };
  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {sheets.map((s, i) => (
          <button key={`${i}-${s.name}`} style={chipStyle(i === idx)} onClick={() => setIdx(i)}>{s.name}</button>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-3, #9aa1ac)" }}>
        工作表「{sheet.name}」共 {sheet.totalRows} 行
        {sheet.truncatedRows ? `，仅显示前 ${XLSX_ROW_LIMIT} 行` : ""}
        {sheet.truncatedCols ? `；列过多，仅显示前 ${XLSX_COL_LIMIT} 列` : ""}
      </div>
      {sheet.rows.length ? (
        <table style={{ borderCollapse: "collapse", fontSize: 12, alignSelf: "flex-start" }}>
          <tbody>
            {sheet.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) =>
                  ri === 0 ? (
                    <th key={ci} style={thStyle}>{cell}</th>
                  ) : (
                    <td key={ci} style={tdStyle}>{cell}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty text="该工作表为空" />
      )}
    </div>
  );
}

function PptxView({ slides }: { slides: PptxSlide[] }) {
  if (!slides.length) return <Empty text="未解析到幻灯片内容" />;
  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      {slides.map((s) => (
        <div
          key={s.no}
          style={{ border: "1px solid var(--border, #e5e5e5)", borderRadius: 10, padding: "10px 14px" }}
        >
          <div style={{ fontSize: 11, color: "var(--text-3, #9aa1ac)" }}>幻灯片 {s.no}</div>
          <div style={{ fontWeight: 700, fontSize: 14, margin: "2px 0 6px", wordBreak: "break-word" }}>
            {s.title || "（无标题）"}
          </div>
          {s.bullets.length ? (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7, display: "flex", flexDirection: "column", gap: 2 }}>
              {s.bullets.map((b, i) => (
                <li key={i} style={{ wordBreak: "break-word" }}>{b}</li>
              ))}
            </ul>
          ) : null}
          {s.notes ? (
            <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px dashed var(--border, #eee)", fontSize: 11.5, color: "var(--text-3, #9aa1ac)" }}>
              备注：{s.notes}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* ---------- 宿主 + 弹窗（表面样式同 zhjwxk/Courses.tsx 的 maskStyle/panelStyle） ---------- */

const maskStyle: CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1000,
  display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
};
const panelStyle: CSSProperties = {
  width: "100%", maxWidth: 920, maxHeight: "88vh", display: "flex", flexDirection: "column",
  background: "var(--surface, #ffffff)", color: "var(--text-1, #1f2329)",
  borderRadius: 14, boxShadow: "0 18px 50px rgba(0,0,0,.28)", overflow: "hidden",
};
const headStyle: CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
  borderBottom: "1px solid var(--border, #eee)", flexShrink: 0,
  // 窄屏（手机）把按钮换到第二行，而不是把 ✕ 挤出屏幕：三个按钮 + 文件名 + 元信息
  // 在 360dp 上挤不下，flex 不换行时最后一个按钮会被顶到面板外面
  flexWrap: "wrap", rowGap: 8,
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
  const [dlPath, setDlPath] = useState("");  // R23：下载成功的目标路径（供「打开文件/目录」按钮）
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

  // 打开即抓取：按扩展名分流；Office 先尝试真预览，失败回退内部文件树
  useEffect(() => {
    if (!cur) return;
    let alive = true;
    setPhase({ s: "loading" });
    void (async () => {
      try {
        const bin = await fetchBinary(cur.url);
        if (!alive) return;
        let view = routeByExt(cur.name, bin);
        if (view.kind === "zip" && view.office) {
          const size = view.size;
          const zip = view.zip;
          try {
            view = await parseOffice(cur.name, zip, size);
          } catch (err) {
            if (!alive) return;
            // 依赖挂了/解析异常：回退"内部文件树 + 下载"兜底
            view = {
              kind: "zip", zip, office: true, size,
              notice: `Office 预览失败（${errMsg(err)}），已回退为内部文件列表，可下载查看`,
            };
          }
        }
        if (!alive) return;
        setPhase({ s: "ready", view });
      } catch (err) {
        if (!alive) return;
        const raw = rawErrorText(err).trim();
        setPhase({ s: "error", msg: errMsg(err), raw: raw && raw !== errMsg(err) ? raw : undefined });
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
      setDlPath(path);
    } catch (err) {
      setDlMsg("下载失败：" + errMsg(err));
      setDlPath("");
    } finally {
      setDlBusy(false);
    }
  }, [cur, dlBusy]);

  /** 另存为：这一次落哪儿由用户当场选（桌面保存对话框 / Android「保存到…」） */
  const doSaveAs = useCallback(async () => {
    if (!cur || dlBusy) return;
    setDlBusy(true);
    setDlMsg("");
    try {
      const path = await saveLearnUrlAs(cur.url, cur.name || "download");
      setDlMsg(path ? `已保存到：${path}` : "已取消另存为。");
      setDlPath(path ?? "");
    } catch (err) {
      setDlMsg("另存为失败：" + errMsg(err));
    } finally {
      setDlBusy(false);
    }
  }, [cur, dlBusy]);

  /* PDF 渲染通道：**全平台统一 pdf.js 自绘**（2026-09-21 用户令：「统一成安卓那种」）。
   *
   * 为什么删掉 <embed> 这条曾经「观感最好」的路：
   *   - Windows/WebView2 上 <embed type=application/pdf> 点开直接白屏（用户实录），
   *     且 data: URL 在 Chromium 系对 PDF 加载限制严格（曾试 blob: URL 也只是换一种脆弱）；
   *   - 安卓 WebView 本来就没有内置查看器，一直走自绘；
   *   - 自绘是**我们完全可控**的一条路：字体、缩放、翻页、失败降级都在手里，
   *     唯一的代价是没有浏览器自带的打印/目录，需要时用「系统应用打开」拿到原生体验。
   * 于是三条路变两条：自绘（默认）/ 系统应用（人工出口）。 */
  const [pdfBusy, setPdfBusy] = useState(false);
  const openPdfExternally = async (): Promise<void> => {
    if (!cur || pdfBusy) return;
    setPdfBusy(true);
    setDlMsg("");
    try {
      const path = await downloadLearnUrl(cur.url, cur.name || "preview.pdf");
      await openLocalPath(path);
    } catch (err) {
      setDlMsg("打开失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setPdfBusy(false);
    }
  };

  // 诊断：PDF 一律自绘；把平台与内核信号落一行日志（客户端排查时不用猜）。
  // ⚠️ 必须在下方 `if (!cur) return null` **之前**——Hook 不能条件调用：放在早返回之后
  // 会让「打开预览」这次渲染比上一次多一个 Hook，React 直接抛
  // 「Rendered more hooks than during the previous render」并**整窗白屏**
  // （上游 98f863d 引入的回归，各端点预览即崩，Windows 最明显）。
  const pdfDiagKey = phase.s === "ready" && phase.view.kind === "pdf" ? phase.view.dataUrl : null;
  useEffect(() => {
    if (!pdfDiagKey) return;
    void import("../lib/clients.js")
      .then((m) => m.logLine(`PDF-MODE canvas android=${IS_ANDROID_HOST} windows=${IS_WINDOWS_HOST} viewer=${String(PDF_VIEWER_ENABLED)}`))
      .catch(() => undefined);
  }, [pdfDiagKey]);

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
      <style>{DOCX_CSS}</style>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headStyle} className="fp-head">
          <b style={{ flex: "1 1 120px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }} title={cur.name}>
            {cur.name || "文件预览"}
          </b>
          {metaBits.length ? (
            <span style={{ fontSize: 11, color: "var(--text-3, #9aa1ac)", flexShrink: 0 }}>{metaBits.join(" · ")}</span>
          ) : null}
          {/* 按钮组整体靠右且不收缩：空间不够时整组换行，✕ 永远在面板内 */}
          <span className="fp-actions" style={{ display: "flex", gap: 8, flexShrink: 0, marginLeft: "auto" }}>
            <button className="btn" disabled={dlBusy} onClick={() => void doDownload()}>
              {dlBusy ? "下载中…" : "下载"}
            </button>
            <button className="btn btn-ghost" disabled={dlBusy} title="这次保存到哪里由你选" onClick={() => void doSaveAs()}>
              另存为
            </button>
            <button className="btn" onClick={close} aria-label="关闭预览">✕</button>
          </span>
        </div>

        <div style={bodyStyle}>
          {phase.s === "loading" ? <Empty text="正在加载文件…" /> : null}

          {phase.s === "error" ? (
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
              <Empty text={`预览加载失败：${phase.msg}`} />
              {phase.raw ? (
                <div style={{ fontSize: 11, color: "var(--text-3, #9aa1ac)", maxWidth: 640, textAlign: "center", overflowWrap: "anywhere" }}>
                  原生返回：{phase.raw}
                </div>
              ) : null}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" onClick={retry}>重试</button>
                <button className="btn" disabled={dlBusy} onClick={() => void doDownload()}>
                  {dlBusy ? "下载中…" : "下载查看"}
                </button>
                <button className="btn btn-ghost" disabled={dlBusy} onClick={() => void doSaveAs()}>
                  另存为…
                </button>
              </div>
            </div>
          ) : null}

          <PreviewErrorBoundary onRetry={retry} note={IS_WINDOWS_HOST ? WIN_PREVIEW_NOTE : undefined}>

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
            /* 全平台统一：pdf.js canvas 自绘（modern→legacy 两级兜底）；
               「系统应用打开」是唯一的人工作为出口（要打印/目录时用） */
            <PdfCanvasView
              dataUrl={view.dataUrl}
              onOpenExternally={openPdfExternally}
              pdfBusy={pdfBusy}
              dlMsg={dlMsg}
            />
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
            <ZipTreeView key={`z${cur.seq}`} zip={view.zip} notice={view.notice} />
          ) : null}

          {view?.kind === "docx" ? (
            <OfficeShell key={`d${cur.seq}`} zip={view.zip}>
              <div className="docx-preview" style={{ padding: "14px 18px" }} dangerouslySetInnerHTML={{ __html: view.html }} />
            </OfficeShell>
          ) : null}

          {view?.kind === "xlsx" ? (
            <OfficeShell key={`x${cur.seq}`} zip={view.zip}>
              <XlsxView sheets={view.sheets} />
            </OfficeShell>
          ) : null}

          {view?.kind === "pptx" ? (
            <OfficeShell key={`p${cur.seq}`} zip={view.zip}>
              <PptxView slides={view.slides} />
            </OfficeShell>
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
              <button className="btn btn-ghost" disabled={dlBusy} onClick={() => void doSaveAs()}>
                另存为…
              </button>
            </div>
          ) : null}
          </PreviewErrorBoundary>
        </div>

        {dlMsg ? (
          /* 面板底部下载/另存为提示：右侧挂「打开文件 / 打开目录」（R23 需求；此前误加在
             PDF 画布内部与 Windows 门闸里，用户看到的这条反而没有按钮） */
          <div style={{ flexShrink: 0, padding: "6px 14px", fontSize: 12, borderTop: "1px solid var(--border, #eee)", color: "var(--accent)", wordBreak: "break-all", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span>{dlMsg}</span>
            {dlPath ? <DownloadOpenButtons path={dlPath} /> : null}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
