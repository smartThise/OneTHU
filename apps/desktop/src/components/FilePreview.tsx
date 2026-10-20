import { Banner, Btn, Chip, Inline, KeyValue, List, Row, Stack, Spacer, Text } from "@onethu/gui";
/**
 * 统一文件预览（全局唯一弹窗，module-level opener 通道，同 zhjwxk/Courses.tsx 的 _detailOpen 做法）：
 * openFilePreview({ name, url }) 任意处调用 → FilePreviewHost（App 级挂载一次）createPortal 渲染。
 * 抓取走「webvpn 包装域 + 原生通道」（webview 直挂 learn 地址只会得到登录页；直连 learn 域
 * 本身也没有会话——2026-10-12 真机根因，详见 lib/clients.ts 的 sessionUrl 注释），按扩展名分流渲染：
 * 图片 / PDF / 文本 / zip·jar 层级目录树（可逐层进入+文本条目内联预览）/
 * Office 真预览（docx→mammoth HTML、xlsx→SheetJS 表格、pptx→解包 slideN.xml 抽大纲）/
 * 其他（下载兜底）。
 * Office 全部本地解析（mammoth/SheetJS 动态 import + zipTree 解包），不外传文件内容；
 * 任一环节失败（依赖加载失败/格式异常/算法不支持）都回退"内部文件树 + 下载"兜底，绝不白屏。
 *
 * 样式来源（OneGUI 收编）：本文件的可见对象一律来自 OneGUI（组件 + --og-* 语义令牌）；
 * 两类**内容视口**按 MailPage 判例豁免——①DOCX_CSS（mammoth 产出的伪 docx DOM 排版，
 * 相当于文档渲染器的内容文档样式）②PDF/PPTX 的"纸面"（恒白文档纸，换肤不换纸）与
 * PptxShapeView 渲染内容的默认色（渲染数据，非 UI）。判定细节见迁移汇报。
 */
import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useExitPhase } from "../lib/motion.js";
import { useExpanded } from "../state/usePlatformLayout.js";
import { downloadLearnUrl, saveLearnUrlAs, sessionUrl, isLoginWallBody, bytesToBase64 } from "../lib/clients.js";
import { isAndroidHost } from "../lib/yktWebview.js";
import { isAndroidNavigator, isWindowsNavigator } from "../lib/androidHost.js";
import { explainNetworkError, nativeFetch, rawErrorText } from "../lib/transport.js";
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
import { parsePptxModel } from "../lib/pptxRender.js";
import type { PptxModel, PptxPara, PptxShape } from "../lib/pptxRender.js";
import { ensurePdfRuntimeShims, hasModernPdfRuntime } from "../lib/pdf-runtime.js";
import { t as i18n } from "../i18n/index.js";


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
  /** cancel()：pdf.js 的 RenderTask 取消接口——换缩放/离开渲染窗口时必须先取消并等 promise
   *  结束，否则同一 canvas 上的并发 render() 会抛 "Cannot use the same canvas..." */
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number }; transform?: number[] }): { promise: Promise<void>; cancel: () => void };
}
interface PdfDocLike {
  numPages: number;
  getPage(n: number): Promise<PdfPageLike>;
}

/** pdf.js 现代版构建对内核要求很高（Promise.withResolvers、Math.sumPrecise 等），
 *  老内核 WebView 会在渲染期抛错或静默退化成系统字体——按内核**原生**能力挑构建，
 *  缺 API 时优先 legacy（自带面向旧环境的转译与垫片），两轮都失败才把错误交回 UI。
 *  留痕用 console（安卓上可被 logcat 抓到），便于下次排障。 */
async function loadPdfDoc(dataUrl: string): Promise<PdfDocLike> {
  // 顺序要紧：先探测内核**原生**能力，再补垫片。
  // 垫片只作用于主线程；pdf.js 的字体修复（checkAndRepair → Math.sumPrecise）跑在 worker，
  // 那是独立 realm，主线程的垫片进不去。若先补垫片，探测会被自己的垫片污染成 true，
  // 于是选中现代构建、worker 里再抛异常并静默退化成系统字体（R27 手机乱码的真因）。
  const modernOk = hasModernPdfRuntime();
  ensurePdfRuntimeShims();
  const modern = { mod: () => import("pdfjs-dist"), worker: () => import("pdfjs-dist/build/pdf.worker.min.mjs?url"), tag: "modern" } as const;
  const legacy = {
    mod: () => import("pdfjs-dist/legacy/build/pdf.mjs"),
    worker: () => import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
    tag: "legacy",
  } as const;
  // 内核缺新 API 时先上 legacy（自带垫片）；否则先用体积更小的现代构建
  const variants = modernOk ? ([modern, legacy] as const) : ([legacy, modern] as const);
  // 控制台诊断行（不是界面文案）：内核缺 pdf.js v6 依赖的新 API 时先上 legacy 构建
  if (!modernOk) console.info("[FILE-PREVIEW] 内核缺新 API，优先 legacy 构建"); // ui-copy-lint-ok: 控制台诊断行
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
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "出现未知问题，请重新打开"));
}

/* ---------- 共享样式源（OneGUI 语义令牌；内容视口豁免见文件头） ---------- */

/** 文档纸面底座（预览画布的凹槽托底）：比纸暗一档的面 + 四边留白，值全部来自语义令牌 */
const CANVAS_PANE_STYLE: CSSProperties = {
  paddingBlock: "var(--og-space-2) var(--og-space-0)",
  paddingInline: "var(--og-space-3)",
  background: "var(--og-surface-3)",
};

/** 页码/缩放条框：只承一条分隔线与统一网格的内边距（原 6/10 随手值 → space 网格） */
const PREVIEW_BAR_STYLE: CSSProperties = {
  flexShrink: 0,
  borderTop: "1px solid var(--og-line-1)",
  paddingBlock: "var(--og-space-1)",
  paddingInline: "var(--og-space-2)",
};

/** 文本内容视口的 <pre>：等宽栈/字阶取 OG 结构令牌（阅读行距 1.6 是内容排版，保留） */
const TEXT_PRE_STYLE: CSSProperties = {
  marginInline: 0,
  marginBlock: 0,
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  fontFamily: "var(--og-font-mono)",
  fontSize: "var(--og-text-label)",
  lineHeight: 1.6,
};

/** 不收缩的小件包裹（Trailing 元信息等） */
const SHRINK_STYLE: CSSProperties = { flexShrink: 0 };

/** docx 内容视口的容器内边距（原 14/18 随手值 → space 网格） */
const DOCX_PANE_STYLE: CSSProperties = {
  paddingBlock: "var(--og-space-3)",
  paddingInline: "var(--og-space-3) var(--og-space-4)",
};


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
      /* 错误卡（Banner）：红色主提示 tone error、说明/原文弱化（content 弱档）；重试在右件。 */
      <Banner
        tone="error"
        action={<Btn variant="outline" tone="error" size="sm" onClick={() => {
            this.setState({ err: null });
            this.props.onRetry?.();
          }}>{i18n("auto.components.FilePreview.1")}</Btn>}
      >
        <Text as="div" slot="label" tone="error">{i18n("auto.components.FilePreview.2")}</Text>
        {this.props.note ? (
          <Text as="div" slot="label" tone="faint">{this.props.note}</Text>
        ) : null}
        <div style={{ wordBreak: "break-all" }}>
          <Text as="div" slot="micro" tone="faint">{this.state.err.slice(0, 300)}</Text>
        </div>
      </Banner>
    );
  }
}

/** 单页画布：只有落在"当前页 ±2"窗口内才渲染，离开窗口卸载（一页 1000×1400 约 5MB 位图，
 *  长讲义几十页全渲染会把 WebView 拖爆）；卸载后回到视野会自动重渲染。 */
function PdfPage({
  doc,
  no,
  width,
  active,
  register,
}: {
  doc: PdfDocLike;
  no: number;
  width: number;
  active: boolean;
  register: (no: number, el: HTMLDivElement | null) => void;
}): React.ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** 当前页在飞的 render task：换缩放/离开窗口时先取消并等它结束，避免同 canvas 并发渲染 */
  const taskRef = useRef<{ cancel: () => void; promise: Promise<void> } | null>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // 先拿本页宽高比占位，保证滚动条长度稳定（失败退 A4 比例）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const base = (await doc.getPage(no)).getViewport({ scale: 1 });
        if (!cancelled && base.width > 0) setRatio(base.height / base.width);
      } catch {
        if (!cancelled) setRatio(1.414);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, no]);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setErr(null); // 重新进入渲染窗口：清掉上一轮的失败提示（缩放后通常能正常渲染）
    let cancelled = false;
    void (async () => {
      // 同一块 canvas 上不能并发 render()：缩放（width 变化）或进出渲染窗口都会重跑本效果，
      // 必须先把上一次的 render task 取消并**等它真正结束**，否则 pdf.js 直接抛
      // "Cannot use the same canvas during multiple render() operations"（霖实测第 3 页）。
      const prev = taskRef.current;
      taskRef.current = null;
      if (prev) {
        try {
          prev.cancel();
        } catch {
          // 已经结束：忽略
        }
        try {
          await prev.promise;
        } catch {
          // 取消/失败是预期路径，错误在下面按 cancelled 与异常类型过滤
        }
      }
      if (cancelled) return;
      try {
        const page = await doc.getPage(no);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: width / base.width });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(vp.width * dpr);
        canvas.height = Math.round(vp.height * dpr);
        canvas.style.width = `${Math.round(vp.width)}px`;
        canvas.style.height = `${Math.round(vp.height)}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx || cancelled) return;
        const task = page.render({
          canvasContext: ctx,
          viewport: vp,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        taskRef.current = task;
        await task.promise;
        if (taskRef.current === task) taskRef.current = null;
      } catch (e) {
        // 取消（滚动离开/缩放重排）不是错误，不该弹给用户
        const name = e instanceof Error ? e.name : "";
        if (!cancelled && name !== "RenderingCancelledException") {
          setErr(`第 ${no} 页渲染失败：${e instanceof Error ? e.message : String(e)}`.slice(0, 120));
        }
      }
    })();
    return () => {
      cancelled = true;
      const t = taskRef.current;
      if (t) {
        try {
          t.cancel();
        } catch {
          // 忽略：任务可能刚好完成
        }
      }
    };
  }, [doc, no, width, active]);

  /** PDF 纸面壳：几何（页宽/页高/居中）+ 纸材质。**纸恒白**（rgba 常量是内容视口的物理属性，
   *  换肤/换主题不换纸——同 MailPage 判例；材质走 OG 结构令牌 --og-radius-sm/--og-elev-1）。 */
  const paper = (w: number, h: number): CSSProperties => ({
    width: w,
    height: h,
    marginInline: "auto",
    marginBlock: "0 var(--og-space-3)",
    background: "#fff",
    borderRadius: "var(--og-radius-sm)",
    boxShadow: "var(--og-elev-1)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  });

  return (
    <div ref={(el) => register(no, el)} data-pdf-page={no} style={paper(width, Math.round(width * (ratio ?? 1.414)))}>
      {err ? (
        <div style={{ paddingBlock: "var(--og-space-3)", paddingInline: "var(--og-space-3)", textAlign: "center" }}>
          <Text slot="micro" tone="error">{err}</Text>
        </div>
      ) : active ? (
        <canvas ref={canvasRef} style={{ display: "block" }} />
      ) : (
        <Text slot="micro" tone="faint">{i18n("auto.components.FilePreview.3")}{no} {i18n("auto.components.FilePreview.4")}</Text>
      )}
    </div>
  );
}

/** PDF 预览：**连续滚动**（R26 霖需求：翻页不是必须的）+ 适应宽度/缩放 + 页码跳转。
 *  渲染策略：只渲染当前页 ±2，其余留等比占位——长讲义也不会把内存吃满。 */
function PdfCanvasView({ dataUrl, onOpenExternally, pdfBusy }: { dataUrl: string; onOpenExternally: () => Promise<void>; pdfBusy: boolean }): React.ReactNode {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const pagesRef = useRef(new Map<number, HTMLDivElement>());
  const [doc, setDoc] = useState<PdfDocLike | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fitW, setFitW] = useState(0);
  const [cur, setCur] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setErr(null);
    setCur(1);
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

  // 适应宽度基准：容器可用宽（窗口/面板尺寸变化要跟着重排）
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !doc) return;
    const update = () => setFitW(Math.max(220, el.clientWidth - 24));
    update();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [doc]);

  const width = Math.max(160, Math.round((fitW || 360) * zoom));

  /** 当前页 = 视口上沿（+40px 余量）之上最后一页 */
  const onScroll = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const probe = el.scrollTop + 40;
    let best = 1;
    for (const [no, node] of pagesRef.current) {
      if (node.offsetTop <= probe && no > best) best = no;
    }
    setCur(best);
  }, []);

  const register = useCallback((no: number, el: HTMLDivElement | null) => {
    if (el) pagesRef.current.set(no, el);
    else pagesRef.current.delete(no);
  }, []);

  const jump = useCallback(
    (n: number) => {
      if (!doc) return;
      const target = Math.min(doc.numPages, Math.max(1, n));
      const node = pagesRef.current.get(target);
      const wrap = wrapRef.current;
      if (node && wrap) wrap.scrollTo({ top: Math.max(0, node.offsetTop - 8), behavior: "smooth" });
      setCur(target);
    },
    [doc],
  );

  if (err) {
    return (
      <Stack fill justify="center" gap={2} pad={6}>
        <div style={{ maxWidth: "100%", textAlign: "center" }}>
          <Text slot="label" tone="error">{err}</Text>
        </div>
        <Inline wrap justify="center" gap={1}>
          <Btn variant="outline" disabled={pdfBusy} onClick={() => void onOpenExternally()}>{i18n("auto.components.FilePreview.5")}</Btn>
        </Inline>
      </Stack>
    );
  }
  if (!doc) {
    return (
      <Stack fill justify="center" align="center" pad={7}>
        <Text slot="label" tone="faint">{i18n("auto.components.FilePreview.6")}</Text>
      </Stack>
    );
  }
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* 连续滚动区：position:relative 让页码定位用 offsetTop（相对滚动容器） */}
      <div ref={wrapRef} onScroll={onScroll} style={{ flex: 1, minHeight: 0, position: "relative", overflow: "auto", ...CANVAS_PANE_STYLE }}>
        {Array.from({ length: doc.numPages }, (_, i) => i + 1).map((no) => (
          <PdfPage key={no} doc={doc} no={no} width={width} active={Math.abs(no - cur) <= 2} register={register} />
        ))}
        <div style={{ height: 8 }} />
      </div>
      <div style={PREVIEW_BAR_STYLE}>
        <Inline wrap justify="center" gap={2}>
          <Btn variant="outline" disabled={cur <= 1} titleAttr={i18n("auto.components.FilePreview.7")} onClick={() => jump(cur - 1)}>‹</Btn>
          <Chip size="sm" tone="quiet"><Text as="span" mono slot="label" tone="faint">{cur} / {doc.numPages}</Text></Chip>
          <Btn variant="outline" disabled={cur >= doc.numPages} titleAttr={i18n("auto.components.FilePreview.8")} onClick={() => jump(cur + 1)}>›</Btn>
          <Btn variant="ghost" titleAttr={i18n("auto.components.FilePreview.9")} disabled={zoom <= 0.5} onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.15) * 100) / 100))}>−</Btn>
          <Chip size="sm" tone="quiet"><Text as="span" mono slot="label" tone="faint">{Math.round(zoom * 100)}%</Text></Chip>
          <Btn variant="ghost" titleAttr={i18n("auto.components.FilePreview.10")} disabled={zoom >= 3} onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.15) * 100) / 100))}>＋</Btn>
          <Btn variant="ghost" disabled={zoom === 1} onClick={() => setZoom(1)}>{i18n("auto.components.FilePreview.11")}</Btn>
          <Btn variant="ghost" disabled={pdfBusy} titleAttr={i18n("auto.components.FilePreview.12")} onClick={() => void onOpenExternally()}>{pdfBusy ? "调起中…" : "系统应用打开"}</Btn>
        </Inline>
      </div>
    </div>
  );
}

/* ---------- opener 通道 ---------- */

export interface FilePreviewTarget {
  name: string;
  url: string;
  /** 云盘等无 URL 直达的来源：按需拉 base64（优先于 url 抓取）。
   *  b64 是纯 base64 段（无 dataURL 前缀），mime 由调用方给出。 */
  fetchB64?: () => Promise<{ mime: string; b64: string }>;
  /** 云盘等自定义下载通道（优先于 downloadLearnUrl）。返回落盘路径。 */
  download?: () => Promise<string>;
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
/** 旧版二进制 Office / WPS 格式：结构是 OLE 复合文档，应用内无法渲染——给出明确提示而不是
 *  笼统的"暂不支持在线预览"（霖 2026-09-22：「pptx 没法预览」的典型来源之一就是老师发的 .ppt） */
const LEGACY_OFFICE_HINT: Record<string, string> = {
  ppt: "旧版 .ppt 不支持应用内预览，请下载查看（另存为 .pptx 可预览）",
  doc: "旧版 .doc 不支持应用内预览，请下载查看（另存为 .docx 可预览）",
  xls: "旧版 .xls 不支持应用内预览，请下载查看（另存为 .xlsx 可预览）",
  dps: "旧版 .dps 不支持应用内预览，请下载查看（另存为 .pptx 可预览）",
  wps: "旧版 .wps 不支持应用内预览，请下载查看（另存为 .docx 可预览）",
  et: "旧版 .et 不支持应用内预览，请下载查看（另存为 .xlsx 可预览）",
};
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

/* ---------- 抓取（与正文图片同一取数形态：包装域 + 原生通道，mime 单独带回） ---------- */

interface FetchedBinary {
  mime: string;
  /** dataURL（可直接给 <img>/<embed>） */
  dataUrl: string;
  /** 纯 base64 段（按需解码字节） */
  b64: string;
}

async function fetchBinary(url: string): Promise<FetchedBinary> {
  // 取数形态与正文图片**完全一致**（2026-10-12 真机根因）：URL 先归一并按 host 分流换成
  // webvpn 包装形态（直连 learn 域没有会话——实测回 69 字节 `location.href="/"` 跳转页），
  // 再走原生通道取字节（原生 cookie 仓 + 主 webview UA）；旧路 fetch_binary 自带 Mac UA +
  // 只吃 JS 侧 cookie，wengine 按 UA 指纹校验票会把包装域请求判成「票无效」。
  // 上限与超时仍按文件预览调：桌面 48MB，安卓因 base64 IPC 限制收紧到 10MB（见上注释）。
  const resp = await nativeFetch(sessionUrl(url), { method: "GET", timeoutMs: 60_000 });
  const mime = (resp.headers.get("content-type") || "application/octet-stream").split(";")[0]?.trim() || "application/octet-stream";
  const buf = new Uint8Array(await resp.arrayBuffer());
  if (isLoginWallBody(mime, buf)) throw new Error("登录状态已失效，请重新登录后再预览");
  // 大小闸门与 Rust 侧同语（errMsg 认 too-large:<实际>:<上限> 给出「下载/另存为」出路）
  const cap = previewCap();
  if (buf.length > cap) throw new Error(`too-large:${buf.length}:${cap}`);
  const b64 = bytesToBase64(buf);
  return { mime, dataUrl: `data:${mime};base64,${b64}`, b64 };
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

/**
 * docx 排版模板 —— **保留（内容视口豁免，同 MailPage 判例）**。
 *
 * 判定：这 10 条规则的**每一条**选择器都落在 `.docx-preview` 作用域内的伪 docx DOM 上
 * （h1/h2/h3/…/p/table/td/th/img/ul/ol/a），它们是「Word 文档自身的版式」（标题层级、
 * 段落节奏、表格框线、图片自适应），不是预览器的 UI 铬件——预览器的工具条/页码/壳已经
 * 全部收编。等同于「渲染 docx 内容把内容写进容器」的文档渲染器：这些样式属于内容视口，
 * 拆掉就得换一种"再造 <style>/模板 CSS"的注入渠道（违反红线 4 后半句），渲染结果也会变。
 * 其中的表格框线/链接色还引用旧令牌（旧令牌桥仍可用），不属于 UI 字面色——整块原始保留，未做任何改写。
 */
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
  | { kind: "pptx"; model: PptxModel; zip: ZipPayload; size: number; notice?: string }
  /** 渲染模型失败时的退路：文字大纲（仍比"什么都没有"强，且明说已回退） */
  | { kind: "pptx-outline"; slides: PptxSlide[]; zip: ZipPayload; size: number; notice: string };

/** 按扩展名本地解析 Office；任何失败抛 Error，由调用方回退内部文件树 */
async function parseOffice(name: string, zip: ZipPayload, size: number): Promise<OfficeView> {
  const ext = extOf(name);

  if (ext === "docx") {
    const mod = (await import("mammoth")) as unknown as { default?: MammothLike } & Partial<MammothLike>;
    const mammoth = mod.default?.convertToHtml ? mod.default : mod;
    if (!mammoth.convertToHtml) throw new Error("docx 预览组件没有加载成功，请重新打开");
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
    try {
      const model = await parsePptxModel(zip.bytes, zip.entries);
      return { kind: "pptx", model, zip, size };
    } catch (e) {
      // 畸形/结构不常见的 pptx：退到文字大纲（页面仍能看到每页要点），并说明已回退
      const slides = await extractPptxSlides(zip.bytes, zip.entries);
      return { kind: "pptx-outline", slides, zip, size, notice: `幻灯片渲染失败（${errMsg(e)}），已回退为文字大纲` };
    }
  }

  throw new Error("未知 Office 格式");
}

/* ---------- 渲染态 ---------- */

/** §2.8.2 文件预览分端：侧边信息栏里的类型名（OfficeView 的细分 kind 走兜底直接用原值） */
const KIND_LABEL: Record<string, string> = {
  image: "图片",
  pdf: "PDF",
  text: "文本",
  zip: "压缩包",
  other: "其他",
  docx: "Word 文档",
  xlsx: "Excel 表格",
  pptx: "PowerPoint 演示",
};

type ReadyView =
  | { kind: "image"; dataUrl: string; mime: string; size: number }
  | { kind: "pdf"; dataUrl: string; size: number }
  | { kind: "text"; text: string; mojibake: boolean; size: number }
  | { kind: "zip"; zip: ZipPayload; office: boolean; notice?: string; size: number }
  | OfficeView
  | { kind: "other"; mime: string; size: number; hint?: string };

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
      return { kind: "other", mime: bin.mime, size, hint: LEGACY_OFFICE_HINT[ext] };
    }
    const bytes = base64ToBytes(bin.b64);
    if (isZip) {
      return { kind: "zip", zip: { bytes, entries: readZipEntries(bytes) }, office: OFFICE_EXTS.has(ext), size };
    }
    const text = new TextDecoder("utf-8").decode(bytes);
    const mojibake = text.includes("\ufffd");
    return { kind: "text", text, mojibake, size };
  }

  return { kind: "other", mime: bin.mime, size, hint: LEGACY_OFFICE_HINT[ext] };
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
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: "var(--og-space-2)", paddingBlock: "var(--og-space-2) var(--og-space-3)", paddingInline: "var(--og-space-3)" }}>
      {notice ? (
        <Banner tone="warning">{notice}</Banner>
      ) : null}

      {/* 面包屑：根 / 一级目录 / 子目录，可点击回跳（Chip selected 承"当前层"） */}
      <Inline wrap gap={1}>
        <Chip size="sm" selected={dirPath.length === 0} onClick={() => jump([])}>{i18n("auto.components.FilePreview.13")}</Chip>
        {dirPath.map((seg, i) => (
          <Chip key={`${i}-${seg}`} size="sm" selected={i === dirPath.length - 1} onClick={() => jump(dirPath.slice(0, i + 1))}>{seg}</Chip>
        ))}
        <Spacer />
        <span style={SHRINK_STYLE}>
          <Text nowrap slot="micro" tone="faint">{i18n("auto.components.FilePreview.14")}{children.length} {i18n("auto.components.FilePreview.15")}{root.fileCount} {i18n("auto.components.FilePreview.16")}</Text>
        </span>
      </Inline>

      {preview ? (
        /* 单条文本条目的内联预览面板（替代列表展示） */
        <Stack fill gap={2}>
          <Inline gap={2}>
            <Btn variant="outline" onClick={() => setPreview(null)}>{i18n("auto.components.FilePreview.17")}</Btn>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "var(--og-text-label)" }} title={preview.path}>📄 {preview.path}</span>
            <span style={SHRINK_STYLE}>
              <Text nowrap slot="micro" tone="faint">{fmtBytes(preview.size)}</Text>
            </span>
          </Inline>
          {preview.phase === "loading" ? <Empty text="正在解压该条目…" /> : null}
          {preview.phase === "error" ? (
            <Stack align="center" pad={3}>
              <Empty text={`无法内联预览：${preview.err ?? "出现未知问题，请重新打开"}`} />
            </Stack>
          ) : null}
          {preview.phase === "done" ? (
            <div style={{ overflowY: "auto", minHeight: 0, display: "flex", flexDirection: "column", gap: "var(--og-space-2)" }}>
              {preview.mojibake ? (
                <Text as="div" slot="label" tone="warning">
                  {i18n("auto.components.FilePreview.18")}</Text>
              ) : null}
              <pre style={TEXT_PRE_STYLE}>{preview.text}</pre>
            </div>
          ) : null}
        </Stack>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <List divided>
            {shown.map((c, i) => {
              if (c.isDir) {
                return (
                  <Row
                    key={`d${i}-${c.path}`}
                    size="sm"
                    flush
                    leading={<span aria-hidden="true">📁</span>}
                    title={c.name}
                    trailing={<Text nowrap slot="micro" tone="faint">{c.fileCount} {i18n("auto.components.FilePreview.19")}{fmtBytes(c.size) || "0 B"}</Text>}
                    titleAttr={`进入 ${c.name}`}
                    onClick={() => enter(c.name)}
                  />
                );
              }
              const previewable = TEXT_EXTS.has(extOf(c.name)) && c.size <= ZIP_TEXT_LIMIT;
              return (
                <Row
                  key={`f${i}-${c.path}`}
                  size="sm"
                  flush
                  leading={<span aria-hidden="true">📄</span>}
                  title={c.name}
                  trailing={
                    previewable ? (
                      <Inline gap={2}>
                        <Text nowrap slot="micro" tone="brand">{i18n("auto.components.FilePreview.20")}</Text>
                        <Text nowrap slot="micro" tone="faint">{fmtBytes(c.size) || "0 B"}</Text>
                      </Inline>
                    ) : (
                      <Text nowrap slot="micro" tone="faint">{fmtBytes(c.size) || "0 B"}</Text>
                    )
                  }
                  titleAttr={previewable ? "点击内联预览" : undefined}
                  onClick={previewable ? () => openEntry(c) : undefined}
                />
              );
            })}
          </List>
          {children.length > ZIP_ROW_CAP ? (
            <div style={{ paddingBlock: "var(--og-space-2) var(--og-space-0)" }}>
              <Text as="div" slot="label" tone="faint">{i18n("auto.components.FilePreview.21")}{children.length - ZIP_ROW_CAP} {i18n("auto.components.FilePreview.22")}</Text>
            </div>
          ) : null}
          {!children.length ? <Empty text="该目录为空" /> : null}
        </div>
      )}
    </div>
  );
}

/* ---------- Office 视图（内容预览 / 内部文件树 切换） ---------- */

/** Office 切换条框：只承内边距（值全部 space 网格） */
const OFFICE_TABBAR_STYLE: CSSProperties = {
  flexShrink: 0,
  paddingBlock: "var(--og-space-2)",
  paddingInline: "var(--og-space-3)",
};

function OfficeShell({ zip, children }: { zip: ZipPayload; children: ReactNode }) {
  const [tab, setTab] = useState<"doc" | "tree">("doc");
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={OFFICE_TABBAR_STYLE}>
        <Inline wrap gap={1}>
          <Chip size="sm" selected={tab === "doc"} onClick={() => setTab("doc")}>{i18n("auto.components.FilePreview.23")}</Chip>
          <Chip size="sm" selected={tab === "tree"} onClick={() => setTab("tree")}>{i18n("auto.components.FilePreview.24")}</Chip>
          <Text slot="micro" tone="faint">{i18n("auto.components.FilePreview.25")}</Text>
        </Inline>
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
  /* xlsx 表格是内容视口的"数据表"：边框/表头底/对齐走语义令牌，版式（顶对齐、320 列宽、
     自然宽表格）保持原判定，不用 OG Table 换排法——数据一行不差。 */
  const thStyle: CSSProperties = {
    border: "1px solid var(--og-line-1)",
    padding: "var(--og-space-1) var(--og-space-2)",
    textAlign: "left",
    fontWeight: "var(--og-weight-semibold)",
    whiteSpace: "nowrap",
    background: "var(--og-surface-3)",
  };
  const tdStyle: CSSProperties = {
    border: "1px solid var(--og-line-1)",
    padding: "var(--og-space-1) var(--og-space-2)",
    verticalAlign: "top",
    maxWidth: 320,
    overflowWrap: "break-word",
  };
  return (
    <div style={XLSX_VIEW_STYLE}>
      <Inline wrap gap={1}>
        {sheets.map((s, i) => (
          <Chip key={`${i}-${s.name}`} size="sm" selected={i === idx} onClick={() => setIdx(i)}>{s.name}</Chip>
        ))}
      </Inline>
      <Text as="div" slot="micro" tone="faint">
        {i18n("auto.components.FilePreview.26")}{sheet.name}{i18n("auto.components.FilePreview.27")}{sheet.totalRows} {i18n("auto.components.FilePreview.28")}{sheet.truncatedRows ? `，仅显示前 ${XLSX_ROW_LIMIT} 行` : ""}
        {sheet.truncatedCols ? `；列过多，仅显示前 ${XLSX_COL_LIMIT} 列` : ""}
      </Text>
      {sheet.rows.length ? (
        <table style={{ borderCollapse: "collapse", fontSize: "var(--og-text-label)", alignSelf: "flex-start" }}>
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
  /** 文字大纲的内容列表（ul/li 是文档大纲语义）：字号/行距是内容排版，缩进取结构令牌 */
  const outlineListStyle: CSSProperties = {
    marginBlock: 0,
    paddingLeft: "var(--og-space-4)",
    fontSize: "var(--og-text-label)",
    lineHeight: 1.7,
    display: "flex",
    flexDirection: "column",
    gap: "var(--og-geo-xs)",
  };
  return (
    <Stack fill={false} gap={2} pad={3}>
      {slides.map((s) => (
        <div key={s.no} style={PPTX_CARD_STYLE}>
          <Text as="div" slot="micro" tone="faint">{i18n("auto.components.FilePreview.29")}{s.no}</Text>
          <div style={{ marginBlock: "var(--og-geo-xs) var(--og-space-1)", wordBreak: "break-word", fontWeight: "var(--og-weight-bold)", fontSize: "var(--og-text-body)" }}>
            {s.title || "（无标题）"}
          </div>
          {s.bullets.length ? (
            <ul style={outlineListStyle}>
              {s.bullets.map((b, i) => (
                <li key={i} style={{ wordBreak: "break-word" }}>{b}</li>
              ))}
            </ul>
          ) : null}
          {s.notes ? (
            <div style={{ marginBlockStart: "var(--og-space-2)", paddingBlockStart: "var(--og-space-1)", borderTop: "1px dashed var(--og-line-1)" }}>
              <Text as="div" slot="micro" tone="faint">{i18n("auto.components.FilePreview.30")}{s.notes}</Text>
            </div>
          ) : null}
        </div>
      ))}
    </Stack>
  );
}

/* ---------- pptx 真渲染（R26）：按幻灯片几何绝对定位，等宽等比缩放 ---------- */

/** 逻辑页宽：16:9 时 1pt 恰好 ≈ 1px（12192000EMU = 13.333in → 960/13.333/72 = 1） */
const PPTX_LOGICAL_W = 960;

/*** ⚠️ PptxShapeView 整体是 pptx 自定义渲染器（红线 6 保护）：形状几何/颜色/字号/表格
 * 单元格的取值都来自解析出的 slide 数据，字面默认色（线/字/表格框）是**渲染数据**而不是
 * UI 铬件——改它们就是改渲染结果。本组件保留原实现。 ***/
/** 单个形状：几何从 EMU 换算成逻辑页 px，颜色/字号/对齐取自解析出的 run 属性 */
function PptxShapeView({ shape, model, pxPerPt }: { shape: PptxShape; model: PptxModel; pxPerPt: number }): React.ReactNode {
  const toPx = (emu: number): number => (emu / model.cx) * PPTX_LOGICAL_W;
  const box: CSSProperties = {
    position: "absolute",
    left: toPx(shape.x),
    top: toPx(shape.y),
    width: toPx(shape.w),
    height: toPx(shape.h),
  };

  if (shape.kind === "image") {
    return <img src={shape.dataUrl} alt="" style={{ ...box, objectFit: "contain" }} />;
  }

  if (shape.kind === "line") {
    // 直线/连接线：横线（高度≈0）或竖线（宽度≈0），按 1px 实线画
    const vertical = shape.h >= shape.w;
    return (
      <div
        style={{
          ...box,
          height: vertical ? box.height : 1,
          width: vertical ? 1 : box.width,
          background: shape.color ?? "#c9ced6",
        }}
      />
    );
  }

  if (shape.kind === "unsupported") {
    return (
      <div
        style={{
          ...box,
          border: "1px dashed var(--border, #c9ced6)",
          borderRadius: 4,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          color: "var(--text-3, #9aa1ac)",
          background: "rgba(127,127,127,.05)",
        }}
      >
        {shape.label}
      </div>
    );
  }

  if (shape.kind === "table") {
    return (
      <div style={{ ...box, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, color: "#111" }}>
          <tbody>
            {shape.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} style={{ border: "1px solid #b9bfc8", padding: "2px 5px", verticalAlign: "top" }}>
                    {cell.map((p, pi) => (
                      <div key={pi}>{p.runs.map((r) => r.text).join("")}</div>
                    ))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div
      style={{
        ...box,
        background: shape.fill,
        display: "flex",
        flexDirection: "column",
        justifyContent: shape.anchor === "ctr" ? "center" : shape.anchor === "b" ? "flex-end" : "flex-start",
        padding: 6,
        overflow: "hidden",
      }}
    >
      {shape.paras.map((p: PptxPara, pi: number) => (
        <div
          key={pi}
          style={{
            display: "flex",
            gap: 4,
            marginLeft: p.lvl * 16,
            textAlign: p.align === "ctr" ? "center" : p.align === "r" ? "right" : "left",
            justifyContent: p.align === "ctr" ? "center" : p.align === "r" ? "flex-end" : "flex-start",
          }}
        >
          {p.bullet ? <span style={{ flex: "none" }}>{p.bullet}</span> : null}
          <span style={{ flex: 1, wordBreak: "break-word" }}>
            {p.runs.map((r, ri) => (
              <span
                key={ri}
                style={{
                  fontSize: (r.sizePt ?? 18) * pxPerPt,
                  fontWeight: r.bold ? 700 : 400,
                  fontStyle: r.italic ? "italic" : undefined,
                  textDecoration: r.underline ? "underline" : undefined,
                  color: r.color ?? "#111",
                  whiteSpace: "pre-wrap",
                }}
              >
                {r.text}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

/** pptx 页面视图：**连续滚动**的多页渲染（与 PDF 同一交互），等比缩放适应面板宽度。 */
function PptxSlidesView({ model }: { model: PptxModel }): React.ReactNode {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState(1);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setFit(Math.max(0.2, (el.clientWidth || PPTX_LOGICAL_W) / PPTX_LOGICAL_W));
    update();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  if (!model.slides.length) return <Empty text="未解析到幻灯片内容" />;
  const pageH = Math.round((PPTX_LOGICAL_W * model.cy) / model.cx);
  const k = fit * zoom;
  const pxPerPt = PPTX_LOGICAL_W / (model.cx / 914400) / 72;

  /** pptx 纸面盒：**内容视口**——纸恒白（字面白保留：换肤不换纸），缩放/定位是渲染几何；
   *  材质档取 OG 结构令牌（--og-radius-sm/--og-elev-1）。 */
  const paper = (): CSSProperties => ({
    position: "absolute",
    top: 0,
    left: 0,
    width: PPTX_LOGICAL_W,
    height: pageH,
    background: "#fff",
    boxShadow: "var(--og-elev-1)",
    borderRadius: "var(--og-radius-sm)",
    overflow: "hidden",
    transform: `scale(${k})`,
    transformOrigin: "top left",
  });

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div ref={wrapRef} style={{ flex: 1, minHeight: 0, overflow: "auto", ...CANVAS_PANE_STYLE }}>
        {model.slides.map((sl) => (
          <div key={sl.no} style={{ marginInline: "auto", marginBlock: "0 var(--og-space-3)", width: Math.round(PPTX_LOGICAL_W * k) }}>
            <div style={{ paddingBlock: "var(--og-geo-xs) var(--og-space-0)" }}>
              <Text as="div" slot="micro" tone="faint">{i18n("auto.components.FilePreview.3")}{sl.no} {i18n("auto.components.FilePreview.31")}{model.slides.length} {i18n("auto.components.FilePreview.4")}</Text>
            </div>
            <div style={{ position: "relative", width: Math.round(PPTX_LOGICAL_W * k), height: Math.round(pageH * k) }}>
              <div
                data-pptx-page={sl.no}
                style={paper()}
              >
                {sl.shapes.map((sh, i) => (
                  <PptxShapeView key={i} shape={sh} model={model} pxPerPt={pxPerPt} />
                ))}
              </div>
            </div>
            {sl.notes ? (
              <div style={{ paddingBlock: "var(--og-space-1) var(--og-space-0)", paddingInline: "var(--og-geo-xs) var(--og-space-0)", wordBreak: "break-word" }}>
                <Text as="div" slot="micro" tone="faint">{i18n("auto.components.FilePreview.30")}{sl.notes}</Text>
              </div>
            ) : null}
          </div>
        ))}
        <div style={{ height: 8 }} />
      </div>
      <div style={PREVIEW_BAR_STYLE}>
        <Inline wrap justify="center" gap={2}>
          <Text slot="micro" tone="faint">{i18n("auto.components.FilePreview.32")}</Text>
          <Btn variant="ghost" titleAttr={i18n("auto.components.FilePreview.9")} disabled={zoom <= 0.5} onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.15) * 100) / 100))}>−</Btn>
          <Chip size="sm" tone="quiet"><Text as="span" mono slot="label" tone="faint">{Math.round(zoom * 100)}%</Text></Chip>
          <Btn variant="ghost" titleAttr={i18n("auto.components.FilePreview.10")} disabled={zoom >= 3} onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.15) * 100) / 100))}>＋</Btn>
          <Btn variant="ghost" disabled={zoom === 1} onClick={() => setZoom(1)}>{i18n("auto.components.FilePreview.11")}</Btn>
          {model.unsupported > 0 ? (
            <Text slot="micro" tone="faint">{model.unsupported} {i18n("auto.components.FilePreview.33")}</Text>
          ) : null}
        </Inline>
      </div>
    </div>
  );
}

/* ---------- 宿主 + 弹窗（AO 面样式来源：原 zhjwxk/Courses.tsx 同款的 maskStyle/panelStyle 已令牌化） ---------- */

const maskStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--og-scrim)",
  zIndex: "var(--og-z-modal)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "var(--og-space-6)",
};
const panelStyle: CSSProperties = {
  width: "100%",
  maxWidth: 920,
  maxHeight: "88vh",
  display: "flex",
  flexDirection: "column",
  background: "var(--og-surface-overlay)",
  backgroundImage: "var(--og-overlay-tint)",
  backdropFilter: "var(--og-overlay-blur)",
  WebkitBackdropFilter: "var(--og-overlay-blur)",
  color: "var(--og-content-1)",
  borderRadius: "var(--og-radius-xl)",
  boxShadow: "var(--og-elev-3)",
  overflow: "hidden",
};
/* PC（expanded）文件预览：居中大窗（§2.8.2）。同 TabManageModal——内联样式优先于类选择器，
   所以只能在组件里换样式对象，写 CSS 是白写。 */
const maskStyleWide: CSSProperties = { ...maskStyle, padding: "var(--og-space-7)" };
const panelStyleWide: CSSProperties = {
  ...panelStyle,
  width: "min(1120px, 92vw)",
  maxWidth: "none",
  height: "min(86vh, 920px)",
  maxHeight: "92vh",
  /* §2.8.2：PC 上正文 + 右侧附件信息栏两列。gridColumn 写在头部/底部提示上，
     窄屏（panelStyle 的 flex column）会直接忽略这两个属性。 */
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 264px",
  gridTemplateRows: "auto minmax(0, 1fr) auto",
};
const headStyle: CSSProperties = {
  gridColumn: "1 / -1",
  display: "flex",
  alignItems: "center",
  gap: "var(--og-space-2)",
  paddingBlock: "var(--og-space-2)",
  paddingInline: "var(--og-space-3)",
  borderBottom: "1px solid var(--og-line-1)",
  flexShrink: 0,
  // 窄屏（手机）把按钮换到第二行，而不是把 ✕ 挤出屏幕：三个按钮 + 文件名 + 元信息
  // 在 360dp 上挤不下，flex 不换行时最后一个按钮会被顶到面板外面
  flexWrap: "wrap",
  rowGap: "var(--og-space-2)",
};
const bodyStyle: CSSProperties = { flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" };

/** 大窗右侧信息栏：旧 .fp-info 的面/字/线已是 md-sys 老令牌——这里直接原地覆盖成 OG 语义令牌 */
const FP_INFO_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--og-space-3)",
  padding: "var(--og-space-4)",
  overflowY: "auto",
  borderLeft: "1px solid var(--og-line-1)",
  background: "var(--og-surface-2)",
};

/** 图片查看托底（原 6% 黑半透明底 → surface-3 凹槽面） */
const IMG_PANE_STYLE: CSSProperties = {
  padding: "var(--og-space-3)",
  background: "var(--og-surface-3)",
};

/** 图片内容自身的适配（contain + 圆角令牌） */
const IMG_FIT_STYLE: CSSProperties = {
  maxWidth: "100%",
  maxHeight: "66vh",
  objectFit: "contain",
  borderRadius: "var(--og-radius-md)",
};

/** xlsx 内容表格视图的容器底盘 */
const XLSX_VIEW_STYLE: CSSProperties = {
  padding: "var(--og-space-3)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--og-space-2)",
};

/** pptx 文字大纲（回退视图）单卡底盘 */
const PPTX_CARD_STYLE: CSSProperties = {
  border: "1px solid var(--og-line-1)",
  borderRadius: "var(--og-radius-md)",
  padding: "var(--og-space-3) var(--og-space-4)",
};

/** 底部下载/另存为提示条框：只承几何与分隔线，文案色彩由 Text tone 承担 */
const DL_HINT_STYLE: CSSProperties = {
  gridColumn: "1 / -1",
  flexShrink: 0,
  paddingBlock: "var(--og-space-1)",
  paddingInline: "var(--og-space-3)",
  borderTop: "1px solid var(--og-line-1)",
  wordBreak: "break-all",
  display: "flex",
  alignItems: "center",
  gap: "var(--og-space-2)",
  flexWrap: "wrap",
};

interface OpenState {
  name: string;
  url: string;
  /** 云盘等自定义字节源（优先于 url 抓取） */
  fetchB64?: () => Promise<{ mime: string; b64: string }>;
  /** 云盘等自定义下载通道（优先于 downloadLearnUrl） */
  download?: () => Promise<string>;
  /** 每次 open/重试自增，保证同一文件重复打开也会重新抓取 */
  seq: number;
}

export function FilePreviewHost() {
  const [cur, setCur] = useState<OpenState | null>(null);
  const [phase, setPhase] = useState<Phase>({ s: "loading" });
  const [dlBusy, setDlBusy] = useState(false);
  const expanded = useExpanded(); // 钩子必须在下方 if (!shown) 早返回之前
  const [dlMsg, setDlMsg] = useState("");
  const [dlPath, setDlPath] = useState("");  // R23：下载成功的目标路径（供「打开文件/目录」按钮）
  const seqRef = useRef(0);

  /* 退场相位（local/anim-delight）：关闭时 cur 先被置空，但面板还要多挂 200ms 播完淡出。
   * 必须在下面 `if (!cur) return null` **之前**调用——Hook 不能条件调用（见文件下方 pdfDiag 注释）。
   * 判定用 cur !== null：shown 是本组件内保留的"上一份内容"，不能拿它当开关。 */
  const { mounted, closing } = useExitPhase(cur !== null);
  /** 最后一次非空内容：退场期间 cur 已是 null，仍要拿它渲染，否则会闪成空白壳 */
  const lastRef = useRef<OpenState | null>(null);
  const shown = cur ?? lastRef.current;

  /* 下载/另存为结果提示（蓝色那条）的退场相位：setDlMsg("") 清空后多挂 200ms 播完淡出，
   * 而不是"啪"地消失。同样必须在下面的早返回之前调用（Hook 不能条件调用）。 */
  const { mounted: dlHintMounted, closing: dlHintClosing } = useExitPhase(dlMsg !== "", 200);
  const dlHintRef = useRef("");
  useEffect(() => {
    if (dlMsg) dlHintRef.current = dlMsg;
  }, [dlMsg]);

  useEffect(() => {
    _open = (t) => {
      seqRef.current += 1;
      setDlMsg("");
      const next: OpenState = { name: t.name, url: t.url, fetchB64: t.fetchB64, download: t.download, seq: seqRef.current };
      lastRef.current = next;
      setCur(next);
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
        // 云盘等自定义字节源优先；无则按 URL 抓取（带会话 cookie）
        const bin = cur.fetchB64
          ? await cur.fetchB64().then(({ mime, b64 }) => ({ mime, dataUrl: `data:${mime};base64,${b64}`, b64 }))
          : await fetchBinary(cur.url);
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
      const path = cur.download
        ? await cur.download()
        : await downloadLearnUrl(cur.url, cur.name || "download");
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

  // 从未打开过（shown 为空）就直接卸载；关闭后要等退场相位走完（mounted 变 false）再卸载，
  // 期间继续用 shown 渲染上一次的内容，动画收尾而不是"啪"地消失。
  if (!shown || (cur === null && !mounted)) return null;

  const retry = () => {
    if (!cur) return;
    seqRef.current += 1;
    setDlMsg("");
    setCur({ ...cur, seq: seqRef.current });
  };

  const view = phase.s === "ready" ? phase.view : null;
  /* 侧边信息栏的值（view 为空时显示占位符） */
  const kindLabel = view ? (KIND_LABEL[view.kind] ?? view.kind) : "";
  const mimeLabel = view && "mime" in view ? view.mime : "";
  const metaBits: string[] = [];
  if (view) {
    if (view.size) metaBits.push(fmtBytes(view.size));
    if (view.kind === "image" || view.kind === "other") metaBits.push(view.mime);
  }

  return createPortal(
    <div className={"confirm-mask" + (closing ? " is-closing" : "")} style={expanded ? maskStyleWide : maskStyle} onClick={close}>
      {/* 内容视口豁免（同 MailPage 判例）：DOCX_CSS 的选择器全是伪 docx DOM 的文档版式，
          见 DOCX_CSS 常量上方的判定注释——不是 UI 铬件，不迁不拆。 */}
      <style>{DOCX_CSS}</style>
      <div className={"confirm-card" + (closing ? " is-closing" : "")} style={expanded ? panelStyleWide : panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headStyle} className="fp-head">
          <b style={{ flex: "1 1 120px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "var(--og-text-label)" }} title={cur?.name ?? shown.name}>
            {cur?.name || shown.name || "文件预览"}
          </b>
          {metaBits.length ? (
            <span style={SHRINK_STYLE}>
              <Text nowrap slot="micro" tone="faint">{metaBits.join(" · ")}</Text>
            </span>
          ) : null}
          {/* 按钮组整体靠右且不收缩：空间不够时整组换行，✕ 永远在面板内 */}
          <span className="fp-actions" style={{ display: "flex", gap: "var(--og-space-2)", flexShrink: 0, marginLeft: "auto" }}>
            <Btn variant="outline" disabled={dlBusy} onClick={() => void doDownload()}>{dlBusy ? "下载中…" : "下载"}</Btn>
            <Btn variant="ghost" disabled={dlBusy} titleAttr={i18n("auto.components.FilePreview.34")} onClick={() => void doSaveAs()}>{i18n("auto.components.FilePreview.35")}</Btn>
            <Btn variant="outline" onClick={close} aria-label={i18n("auto.components.FilePreview.36")}>✕</Btn>
          </span>
        </div>

        <div style={bodyStyle}>
          {phase.s === "loading" ? <Empty text="正在加载文件…" /> : null}

          {phase.s === "error" ? (
            <Stack align="center" gap={2} pad={4}>
              <Empty text={`预览加载失败：${phase.msg}`} />
              {phase.raw ? (
                <div style={{ maxWidth: 640, textAlign: "center", overflowWrap: "anywhere" }}>
                  <Text as="div" slot="micro" tone="faint">{i18n("auto.components.FilePreview.37")}{phase.raw}</Text>
                </div>
              ) : null}
              <Inline gap={2} justify="center">
                <Btn variant="outline" onClick={retry}>{i18n("auto.components.FilePreview.1")}</Btn>
                <Btn variant="outline" disabled={dlBusy} onClick={() => void doDownload()}>{dlBusy ? "下载中…" : "下载查看"}</Btn>
                <Btn variant="ghost" disabled={dlBusy} onClick={() => void doSaveAs()}>{i18n("auto.components.FilePreview.38")}</Btn>
              </Inline>
            </Stack>
          ) : null}

          <PreviewErrorBoundary onRetry={retry} note={IS_WINDOWS_HOST ? WIN_PREVIEW_NOTE : undefined}>

          {view?.kind === "image" ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", ...IMG_PANE_STYLE, minHeight: 220 }}>
              <img
                src={view.dataUrl}
                alt={cur?.name ?? shown.name}
                style={IMG_FIT_STYLE}
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
            />
          ) : null}

          {view?.kind === "text" ? (
            <Stack pad={3} gap={2}>
              {view.mojibake ? (
                <Text as="div" slot="label" tone="warning">
                  {i18n("auto.components.FilePreview.39")}</Text>
              ) : null}
              <pre style={TEXT_PRE_STYLE}>{view.text}</pre>
            </Stack>
          ) : null}

          {view?.kind === "zip" ? (
            <ZipTreeView key={`z${cur?.seq ?? 0}`} zip={view.zip} notice={view.notice} />
          ) : null}

          {view?.kind === "docx" ? (
            <OfficeShell key={`d${cur?.seq ?? 0}`} zip={view.zip}>
              <div className="docx-preview" style={DOCX_PANE_STYLE} dangerouslySetInnerHTML={{ __html: view.html }} />
            </OfficeShell>
          ) : null}

          {view?.kind === "xlsx" ? (
            <OfficeShell key={`x${cur?.seq ?? 0}`} zip={view.zip}>
              <XlsxView sheets={view.sheets} />
            </OfficeShell>
          ) : null}

          {view?.kind === "pptx" || view?.kind === "pptx-outline" ? (
            <OfficeShell key={`p${cur?.seq ?? 0}`} zip={view.zip}>
              {view.kind === "pptx" ? <PptxSlidesView model={view.model} /> : <PptxView slides={view.slides} />}
              {"notice" in view && view.notice ? (
                <div style={{ paddingBlock: "var(--og-space-1) var(--og-space-2)", paddingInline: "var(--og-space-3)", wordBreak: "break-all" }}>
                  <Text as="div" slot="micro" tone="faint">{view.notice}</Text>
                </div>
              ) : null}
            </OfficeShell>
          ) : null}

          {view?.kind === "other" ? (
            <Stack fill align="center" justify="center" gap={3} pad={6}>
              <Empty text={view.hint ?? "该格式暂不支持在线预览"} />
              <div style={{ textAlign: "center" }}>
                <Text as="div" slot="label" tone="faint">
                  {view.mime}
                  {view.size ? ` · ${fmtBytes(view.size)}` : ""}
                </Text>
              </div>
              <Btn variant="outline" disabled={dlBusy} onClick={() => void doDownload()}>{dlBusy ? "下载中…" : "下载查看"}</Btn>
              <Btn variant="ghost" disabled={dlBusy} onClick={() => void doSaveAs()}>{i18n("auto.components.FilePreview.38")}</Btn>
            </Stack>
          ) : null}
          </PreviewErrorBoundary>
        </div>

        {expanded ? (
          <aside className="fp-info" aria-label={i18n("auto.components.FilePreview.40")} style={FP_INFO_STYLE}>
            <Text as="h3" slot="body" weight="semibold">{i18n("auto.components.FilePreview.40")}</Text>
            <div title={cur?.name || shown.name || "文件预览"} style={{ minWidth: 0 }}>
              <Text as="div" truncate slot="body">
                {cur?.name || shown.name || "文件预览"}
              </Text>
            </div>
            <KeyValue
              rows={[
                { k: "类型", v: kindLabel || "—" },
                { k: "大小", v: view?.size ? fmtBytes(view.size) : "—" },
                { k: "格式", v: mimeLabel || "—" },
              ]}
            />
            {IS_WINDOWS_HOST && WIN_PREVIEW_NOTE ? <Text as="p" slot="micro" tone="faint">{WIN_PREVIEW_NOTE}</Text> : null}
          </aside>
        ) : null}

        {dlMsg || dlHintMounted ? (
          /* 面板底部下载/另存为提示：右侧挂「打开文件 / 打开目录」（R23 需求；此前误加在
             PDF 画布内部与 Windows 门闸里，用户看到的这条反而没有按钮）。
             只留蓝色这一条（灰色那条在 PDF 画布里，同一信息渲染两遍，已删）。
             动效：入场从下浮起（.fp-dl-hint），清空后走 200ms 退场相位淡出（.is-closing）。 */
          <div
            className={"fp-dl-hint" + (dlHintClosing ? " is-closing" : "")}
            style={DL_HINT_STYLE}
          >
            <Text as="span" slot="label" tone="brand">{dlMsg || dlHintRef.current}</Text>
            {dlPath ? <DownloadOpenButtons path={dlPath} /> : null}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
