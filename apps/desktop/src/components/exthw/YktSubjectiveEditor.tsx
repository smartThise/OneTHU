/**
 * R20-C2 P3：雨课堂主观题原生作答编辑器（docs §31.2 / §31.5 / §32）。
 *
 * 能力（官方主观题工具栏对齐：加粗/斜体/下划线/前后景色/有序无序列表/代码块/插图/公式）：
 *  - 插图四通道：工具栏插图按钮（选图）/ **拍照上传**（capture=environment 直调后置相机，
 *    移动端刚需，docs §32.1）/ 粘贴（截图 Ctrl+V）/ 拖拽——全部走官方正文插图通道
 *    （get_aliyun_oss_token 表单直传，AI 判卷读正文图片）；
 *  - 公式按钮：LaTeX 输入 + KaTeX 实时预览 → 编辑器内插 img.kfformula（data-latex 保留，
 *    src 用 SVG 芯片展示 TeX 源码，官方渲染端只读 data-latex，src 不参与）；
 *  - 提交序列化 toSubmitHtml()：img.kfformula → 官方形态（1px gif src + data-latex）+
 *    `<div class="custom_ueditor_cn_body">` 包裹（§31.5.3）。
 *
 * ⛔ 学术红线（docs §32）：本组件**不做任何内容生成/补全/续写**；提交动作由父组件在
 *  用户显式点击「提交」并通过确认对话框后发起——编辑器只负责撰写与排版。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactQuill, { Quill } from "react-quill-new";
import "react-quill-new/dist/quill.snow.css";
import { prepImageForUpload, uploadFileName } from "../../lib/yktImagePrep.js";
import { uploadYktInlineImage } from "../../state/exthw.js";
import { loadYktLatexBundle } from "../../lib/yktKatex.js";
import { isAndroidNavigator } from "../../lib/androidHost.js";
import { hardenYktImgs } from "../../lib/yktBody.js";

/* ── Quill 定制 blot：img.kfformula（官方公式图）作为一等 embed，编辑中不被误改 ── */

/* eslint-disable @typescript-eslint/no-explicit-any */
const ImageBlot: any = Quill.import("formats/image");

/** 编辑器内的公式芯片 src：中性灰芯片显示 TeX 源码（半透明底 + 中灰字，亮暗主题都可读；
 *  img 无法读 CSS 变量，故用双主题中立色；提交时换官方 1px gif，src 不参与官方渲染）。 */
function formulaChipSrc(latex: string): string {
  const w = Math.min(640, Math.max(40, Math.ceil(latex.length * 7.4) + 20));
  const esc = latex
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="26">` +
    `<rect width="100%" height="100%" rx="4" fill="rgba(128,132,140,0.16)" stroke="rgba(128,132,140,0.35)"/>` +
    `<text x="7" y="18" font-family="monospace" font-size="12.5" fill="#9aa0a8">${esc}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

class KfformulaBlot extends ImageBlot {
  static blotName = "kfformula";
  static className = "kfformula";
  static tagName = "img";
  static create(value: unknown): HTMLElement {
    const v = (value ?? {}) as { src?: string; latex?: string; display?: string };
    const node: HTMLElement =
      typeof value === "string" ? ImageBlot.create(value) : ImageBlot.create(v.src ?? formulaChipSrc(v.latex ?? ""));
    node.setAttribute("class", "kfformula");
    node.setAttribute("data-latex", v.latex ?? "");
    node.setAttribute("data-display", v.display ?? "inline");
    return node;
  }
  static value(node: HTMLElement): { src: string; latex: string; display: string } {
    return {
      src: node.getAttribute("src") ?? "",
      latex: node.getAttribute("data-latex") ?? "",
      display: node.getAttribute("data-display") ?? "inline",
    };
  }
  format(name: string, value: unknown): void {
    if (name === "data-latex" || name === "data-display") {
      if (value != null) this.domNode.setAttribute(name, String(value));
      return;
    }
    super.format(name, value);
  }
}
Quill.register(KfformulaBlot, true);

/** 1px 透明 gif（官方 kfformula 提交态 src 语义：渲染端不读 src） */
const OFFICIAL_GIF_SRC =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** 编辑器 HTML → 提交态 HTML：公式换官方形态 + 图片防盗链加固 + UEditor 包裹层（§31.5.3）。 */
export function toSubmitHtml(editorHtml: string): string {
  const doc = new DOMParser().parseFromString(editorHtml, "text/html");
  doc.querySelectorAll("img.kfformula").forEach((img) => {
    img.setAttribute("src", OFFICIAL_GIF_SRC);
    img.setAttribute("class", "kfformula");
    if (!img.getAttribute("data-display")) img.setAttribute("data-display", "inline");
    img.removeAttribute("width");
    img.removeAttribute("height");
  });
  // 防盗链：CDN 为 Referer 白名单 + 放行空 Referer，官方页 Referer 在白名单内；
  // 但本应用 WebView 来源（tauri.localhost）会被 403——提交态一并带上 no-referrer，
  // 保证任何渲染方（含官方页）都不因 Referer 丢图（与 yktBody.hardenYktImgs 同口径）。
  const inner = hardenYktImgs(doc.body.innerHTML.trim());
  if (inner.includes("custom_ueditor_cn_body")) return inner;
  return `<div class="custom_ueditor_cn_body">${inner}</div>`;
}

/* ── 组件 ── */

/** 判定所需的宿主信号（androidHost.AndroidHostSignals 的结构子集） */
interface AndroidHostSignalsLike {
  userAgent?: string;
  platform?: string;
  userAgentData?: { platform?: string } | null;
}

export interface YktSubjectiveEditorProps {
  /** 受控 HTML（Quill root innerHTML 语义） */
  value: string;
  onChange: (html: string) => void;
  classroomId: string;
  /** 上传通道占用数变化（父组件据此禁用提交） */
  onUploadingChange?: (count: number) => void;
  /** 上传/插入失败提示（父组件展示） */
  onError?: (msg: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

/** 工具栏（官方主观题能力对齐，无标题/链接——官方没有） */
const TOOLBAR = {
  container: [
    ["bold", "italic", "underline"],
    [{ color: [] }, { background: [] }],
    [{ list: "ordered" }, { list: "bullet" }],
    ["code-block", "image"],
    ["clean"],
  ],
  handlers: {} as Record<string, () => void>,
};

const FORMATS = ["bold", "italic", "underline", "color", "background", "list", "bullet", "code-block", "image", "kfformula"];

export function YktSubjectiveEditor(props: YktSubjectiveEditorProps) {
  const { value, onChange, classroomId, onUploadingChange, onError, disabled } = props;
  // 桌面 = 从文件上传；Android 宿主 = 拍照上传（isAndroidNavigator 多信号判定，
  // tauri.conf 伪装 UA 也不误判，见 androidHost.ts 头注）
  const isAndroid = useMemo(() => isAndroidNavigator(navigator as AndroidHostSignalsLike), []);
  const quillRef = useRef<ReactQuill | null>(null);
  const pickRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(0);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [formulaTex, setFormulaTex] = useState("");
  const [formulaDisplay, setFormulaDisplay] = useState(false);
  const [latexBundle, setLatexBundle] = useState<Awaited<ReturnType<typeof loadYktLatexBundle>>>(null);

  useEffect(() => {
    onUploadingChange?.(uploading);
  }, [uploading, onUploadingChange]);

  const getQuill = useCallback((): Quill | null => quillRef.current?.getEditor() ?? null, []);

  /* 插图上传：预处理 → 官方插图通道 → 插入 <img src=file_url> */
  const handleFiles = useCallback(
    async (files: Iterable<File>, at?: number) => {
      const quill = getQuill();
      if (!quill) return;
      for (const f of Array.from(files)) {
        if (!f.type.startsWith("image/")) continue;
        setUploading((n) => n + 1);
        try {
          const baseName = f.name && f.name !== "blob" ? f.name : `ykt-${Date.now()}`;
          const prepped = await prepImageForUpload(f, baseName);
          const { fileUrl } = await uploadYktInlineImage({
            classroomId,
            fileName: uploadFileName("img", prepped.mime),
            mime: prepped.mime,
            bytes: prepped.bytes,
          });
          const idx = typeof at === "number" ? at : quill.getLength();
          quill.insertEmbed(idx, "image", fileUrl, "user");
          // 防盗链（真机实录）：CDN 放行空 Referer，但 WebView 来源 Referer 被 403——
          // 图片一进来就补 no-referrer，避免显示破损图标（与 yktBody.hardenYktImgs 同口径）
          const leaf = quill.getLeaf(idx)[0] as unknown as { domNode?: HTMLElement } | undefined;
          leaf?.domNode?.setAttribute?.("referrerpolicy", "no-referrer");
          quill.insertText(idx + 1, "\n", "user");
          quill.setSelection(idx + 2, 0, "user");
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          onError?.(`插图上传失败：${msg}`);
        } finally {
          setUploading((n) => n - 1);
        }
      }
    },
    [classroomId, getQuill, onError],
  );

  /* 编辑器初始化：粘贴/拖拽/公式按钮挂载（WeakSet 防重复挂载——ref 回调可能多次触发） */
  const attached = useRef<WeakSet<Quill>>(new WeakSet());
  const attachEditor = useCallback(
    (el: ReactQuill | null) => {
      quillRef.current = el;
      if (!el) return;
      const quill = el.getEditor();
      if (attached.current.has(quill)) return;
      attached.current.add(quill);

      // 防盗链统一加固：任何路径进来的 <img>（插入/粘贴/拖拽/受控值重渲染/草稿回填）
      // 都补 referrerpolicy="no-referrer"——CDN Referer 白名单放行空 Referer，
      // 而 WebView 来源（tauri.localhost）会被 403 显示破损图标（真机实录）。
      const hardenImgs = (): void => {
        quill.root.querySelectorAll("img:not([referrerpolicy])").forEach((img) => {
          img.setAttribute("referrerpolicy", "no-referrer");
        });
      };
      hardenImgs();
      quill.on("text-change", hardenImgs);

      // 粘贴：文件/截图直接走上传通道（放行纯文本与富文本）
      quill.root.addEventListener("paste", (ev: ClipboardEvent) => {
        const files = ev.clipboardData?.files;
        if (files && files.length > 0 && Array.from(files).some((f) => f.type.startsWith("image/"))) {
          ev.preventDefault();
          ev.stopPropagation();
          const range = quill.getSelection(true);
          void handleFiles(files, range?.index);
        }
      });
      // 拖拽：图片文件拦截上传（v1 插入末尾；其余拖拽行为不动）
      quill.root.addEventListener("drop", (ev: DragEvent) => {
        const files = ev.dataTransfer?.files;
        if (files && files.length > 0 && Array.from(files).some((f) => f.type.startsWith("image/"))) {
          ev.preventDefault();
          ev.stopPropagation();
          void handleFiles(files);
        }
      });
      // 富文本粘贴里的 data: 图片（截图以 HTML 形态粘贴）→ 剥出上传
      const DeltaCtor = Quill.import("delta") as any;
      quill.clipboard.addMatcher("IMG", (node: Node, delta: any) => {
        const src = (node as HTMLElement).getAttribute?.("src") ?? "";
        if (src.startsWith("data:image/")) {
          void (async () => {
            try {
              const blob = await (await fetch(src)).blob();
              await handleFiles([new File([blob], "paste.png", { type: blob.type || "image/png" })]);
            } catch {
              onError?.("粘贴的图片读取失败，请用「插图」按钮重试");
            }
          })();
          return new DeltaCtor();
        }
        return delta;
      });

      // 公式按钮：挂进 Quill 工具栏（官方主观题能力里的「公式」，§31.5）
      const toolbar = quill.getModule("toolbar") as { addHandler: (f: string, h: () => void) => void } | undefined;
      const tEl = quill.container.querySelector(".ql-toolbar");
      if (tEl && !tEl.querySelector(".ql-kfformula")) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ql-kfformula";
        btn.title = "插入公式（LaTeX）";
        btn.textContent = "ƒ(x)";
        btn.addEventListener("click", () => {
          const sel = quill.getSelection();
          const node = sel ? (quill.getLeaf(sel.index)?.[0] as { domNode?: HTMLElement } | null)?.domNode : null;
          const img = node?.closest?.("img.kfformula");
          setFormulaDisplay(false);
          setFormulaTex(img?.getAttribute("data-latex") ?? "");
          setFormulaOpen(true);
        });
        tEl.appendChild(btn);
      }
      toolbar?.addHandler("image", () => pickRef.current?.click());
    },
    [handleFiles, onError],
  );

  /* 公式对话框打开时懒加载 KaTeX（与题干渲染同一分包，无公式不加载） */
  useEffect(() => {
    if (!formulaOpen || latexBundle) return;
    let alive = true;
    void loadYktLatexBundle().then((b) => {
      if (alive) setLatexBundle(b);
    });
    return () => {
      alive = false;
    };
  }, [formulaOpen, latexBundle]);

  const insertFormula = useCallback(() => {
    const quill = getQuill();
    const tex = formulaTex.trim();
    if (!quill || !tex) return;
    const sel = quill.getSelection(true);
    const idx = sel?.index ?? quill.getLength();
    quill.insertEmbed(
      idx,
      "kfformula",
      { src: formulaChipSrc(tex), latex: tex, display: formulaDisplay ? "block" : "inline" },
      "user",
    );
    quill.insertText(idx + 1, "\n", "user");
    quill.setSelection(idx + 2, 0, "user");
    setFormulaOpen(false);
    setFormulaTex("");
  }, [formulaDisplay, formulaTex, getQuill]);

  const modules = useMemo(() => ({ toolbar: TOOLBAR }), []);
  const previewHtml = useMemo(() => {
    if (!formulaTex.trim() || !latexBundle) return null;
    try {
      return latexBundle.render(formulaTex.trim(), formulaDisplay);
    } catch {
      return null;
    }
  }, [formulaTex, formulaDisplay, latexBundle]);

  return (
    <div className={`ykt-editor${disabled ? " ykt-editor-disabled" : ""}`}>
      <ReactQuill
        ref={attachEditor}
        theme="snow"
        value={value}
        onChange={onChange}
        modules={modules}
        formats={FORMATS}
        placeholder={props.placeholder ?? "在此作答…"}
        readOnly={disabled}
      />
      {/* 隐藏文件入口：选图（桌面）+ 拍照（移动端 capture 直调相机，docs §32.1） */}
      <input
        ref={pickRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files) void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files) void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="ykt-editor-foot">
        {uploading > 0 ? (
          <span className="ykt-editor-uploading">图片上传中…</span>
        ) : (
          <button
            type="button"
            className="btn btn-sm ykt-img-btn"
            disabled={disabled}
            onClick={() => (isAndroid ? cameraRef.current?.click() : pickRef.current?.click())}
          >
            {isAndroid ? "📷 拍照上传" : "📎 从文件上传"}
          </button>
        )}
      </div>

      {formulaOpen ? (
        <div className="ykt-formula-mask" onClick={() => setFormulaOpen(false)}>
          <div className="ykt-formula-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="ykt-formula-head">
              <b>插入公式（LaTeX）</b>
              <button type="button" className="btn btn-sm" onClick={() => setFormulaOpen(false)}>
                关闭
              </button>
            </div>
            <textarea
              className="ykt-formula-tex"
              rows={3}
              value={formulaTex}
              autoFocus
              placeholder="例如：\vec{u}=(1,2,3)  或  \frac{a}{b}"
              onChange={(e) => setFormulaTex(e.target.value)}
            />
            <label className="ykt-formula-display">
              <input type="checkbox" checked={formulaDisplay} onChange={(e) => setFormulaDisplay(e.target.checked)} />
              独立成行（display 模式）
            </label>
            <div className="ykt-formula-preview">
              {previewHtml != null ? (
                <div className="ykt-formula-preview-body" dangerouslySetInnerHTML={{ __html: previewHtml }} />
              ) : (
                <span className="ykt-formula-preview-empty">{latexBundle ? "预览：输入 LaTeX 后实时显示" : "渲染器加载中…"}</span>
              )}
            </div>
            {latexBundle ? <style>{latexBundle.inlineCss}</style> : null}
            <div className="ykt-formula-actions">
              <button type="button" className="btn btn-sm" onClick={() => setFormulaOpen(false)}>
                取消
              </button>
              <button type="button" className="btn btn-sm btn-primary" disabled={!formulaTex.trim()} onClick={insertFormula}>
                插入公式
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
