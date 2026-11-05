import { t as i18n, useLocale as useUiLocale } from "../../i18n/index.js";
/**
 * R20-B3：题干 / 我的作答正文渲染组件（docs 28.10）。
 *
 * 方案：**本地内联沙箱文档**——把服务端 HTML 加工成一份完整 HTML 文档字符串
 * （yktBody.buildYktProblemDoc：sanitize → 加密字体 → KaTeX → 图片加固），塞进
 * `sandbox="allow-scripts"`（**无 allow-same-origin**，opaque origin）的 srcdoc iframe。
 * 选 iframe 而非应用内 WebView 的理由（成本最低且两端一致）：
 *  - 桌面（WebView2 / WKWebView / WebKitGTK）与移动（Android System WebView）对
 *    srcdoc + sandbox + postMessage + document.fonts 支持完全同源，**一套代码两端跑**，
 *    不需要「桌面 iframe / 移动再起一套 WebView 桥」的平台分叉；
 *  - 内容是外部平台 HTML，opaque origin 天然隔离（碰不到应用存储 / Cookie / DOM），
 *    比同源 dangerouslySetInnerHTML 少一整层注入面；
 *  - 高度自适应、图片二次代理、字体失效强刷全部走 postMessage 与父组件通信。
 *
 * 降级链（永不白屏，任一环失败都只降级该环）：
 *  1. katex 加载 / 单公式解析失败 → 原样保留 $…$ 原文（yktKatex + safeRender）；
 *  2. 加密字体拿不到（404 / 超时 / 退避窗口 / 非字体 magic）→ stripEncryptedFontClass
 *     剥加密 span，普通字体显示原文（宁错字不丢字）；
 *  3. 字体挂上了但 iframe 内 document.fonts 校验失败 → force 重取一次，仍失败保持剥 class 形态；
 *  4. 图片直挂失败 → fetch_binary 带 Referer/Cookie 代理重试一次 → 仍失败占位框 + 文件名。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_YKT_DOC_THEME,
  YKT_DOC_BASE,
  YKT_FRAME_MIN_H,
  buildYktProblemDoc,
  clampDocHeight,
  needsEncryptedFont,
  sanitizeDocColor,
  type YktDocTheme,
} from "../../lib/yktBody.js";
import { stripInlineBackgrounds, stripInlineColors } from "../../lib/htmlTheme.js";
import { fetchYktImageAsDataUrl, loadYktFont } from "../../lib/yktAssets.js";
import { loadYktLatexBundle, type YktLatexBundle } from "../../lib/yktKatex.js";
import { openExternal } from "../../pages/info/openExternal.js";

export interface ProblemBodyProps {
  /** 服务端 HTML（题干 bodyHtml / 我的作答 contentHtml / 作业说明 description） */
  html: string;
  /** 整卷加密字体 URL（YkExerciseDetail.fontUrl；缺省 = 放弃字体，直接剥 class 兜底） */
  fontUrl?: string;
  /** 雨课堂会话 Cookie（字体下载与图片代理用；不向非雨课堂域附加） */
  cookies: string;
  /** 无障碍标题（iframe title） */
  title?: string;
  className?: string;
}

/** 文档内发来的消息（与 yktBody.YKT_DOC_SCRIPT_TEMPLATE 一一对应） */
interface YktDocMessage {
  type?: string;
  h?: unknown;
  src?: unknown;
  href?: unknown;
  dataUrl?: unknown;
}

/* ──────────────── 主题配色读取（R20-B3 fix ②） ──────────────── */

/** 颜色归一化画布（惰性建一次）：任意 CSS 颜色串（oklch/color(srgb)/color-mix/…）
 *  交给引擎自己解析，读回的 computed 值必是 hex/rgba 字面量——下游纯函数只认这些。 */
let normCtx: CanvasRenderingContext2D | null | undefined;
function normalizeColor(v: string): string {
  if (!v) return v;
  try {
    if (normCtx === undefined) {
      const c = document.createElement("canvas");
      c.width = 1;
      c.height = 1;
      normCtx = c.getContext("2d");
    }
    if (!normCtx) return v;
    normCtx.fillStyle = "#000000"; // 先放一个必成功的值，防上一次非法赋值残留
    normCtx.fillStyle = v;
    return normCtx.fillStyle;
  } catch {
    return v;
  }
}

/** 探针读值：把 CSS 值（通常 `var(--x, fallback)`）挂进真实容器读 computed color——var 链 / color-mix /
 *  回退值全部由引擎解析完，再画布归一化。比直接读 :root 变量更彻底（变量可能在
 *  非 :root 层定义，或值是引用形态）。 */
function probeColor(container: Element | null, cssValue: string): string {
  try {
    const probe = document.createElement("span");
    probe.style.color = cssValue;
    probe.style.display = "none";
    (container ?? document.body).appendChild(probe);
    const v = getComputedStyle(probe).color;
    probe.remove();
    return normalizeColor(v);
  } catch {
    return "";
  }
}

/** computed backgroundColor → alpha。同时认识旧式 8 位分量语法与现代
 *  color(srgb … / a)（Chromium 对 color-mix 的序列化形态）；无法解析按不透明。 */
function bgAlpha(color: string): number {
  if (!color || color === "transparent") return 0;
  const slash = /\/\s*([0-9.]+)(%?)\s*\)$/.exec(color);
  if (slash) return slash[2] ? Number(slash[1]) / 100 : Number(slash[1]);
  const legacy = /^(?:rgba|hsla)\(([^)]+)\)$/i.exec(color);
  const body = legacy?.[1];
  if (!body) return 1;
  const parts = body.split(/[,/\s]+/).filter(Boolean);
  return parts.length < 4 ? 1 : Number(parts[3]);
}

/** 从 el 沿祖先链判定沙箱文档底色。
 *
 *  只有**真正不透明**（alpha ≥ 0.995）的祖先才被复制进 srcdoc：那是"纸面"，
 *  复制一份不会改变观感。半透明填充（玻璃材质的 color-mix / rgba）**绝不复制**——
 *  它在父层已经画过一次，iframe 再画一次就是用户看到的「公式块背后多一层玻璃」，
 *  而且两层 alpha 叠加会把透彻档悄悄变成实色块。半透明时让 iframe 画布保持透明，
 *  玻璃只出现一次；`flush=true` 通知 yktBody 不要补不透明暗纸面。
 *
 *  全链透明（理论不该发生）→ transparent，同样交给画布自身兜底。 */
export function resolveEffectiveBg(el: Element | null): { bg: string; flush: boolean } {
  let cur: Element | null = el;
  while (cur) {
    let bg = "";
    try {
      bg = getComputedStyle(cur).backgroundColor;
    } catch {
      return { bg: "transparent", flush: false };
    }
    // computed 值可能是旧式分量语法或现代 color(srgb … / a)。只按 alpha 判定材质，
    // 不能因为语法不认识就把半透明当成纸面（那正是双层玻璃的来源）。
    const alpha = bgAlpha(bg);
    if (alpha < 0.01) { cur = cur.parentElement; continue; }          // 全透明：继续向上
    if (alpha < 0.995) return { bg: "transparent", flush: true };      // 玻璃：不复制
    return { bg: normalizeColor(bg), flush: false };                    // 纸面：沿用
  }
  return { bg: "transparent", flush: false };
}

/** 从当前 DOM 读一份沙箱配色（所有值过 sanitizeDocColor，畸形值回退浅色定稿）。
 *  主题可插拔（暗色不止一个、浅色可能是米白），所以只信运行时 computed 值，
 *  绝不假设「明/暗」二元。 */
export function readYktDocTheme(container: Element | null): YktDocTheme {
  /* 题干永远让父层卡片提供底色：首帧容器可能还没拿到半透明材质，
     祖先此刻若正好是白色面，srcdoc 会被写成白底；之后主题/皮肤切换才重建。
     用户实测「新开雨课堂作业一片白，切实心+主题后才消失」就是这条首帧竞态。
     iframe 自身一律透明，只让父层材质出现一次。 */
  return {
    text: sanitizeDocColor(probeColor(container, "var(--text-1, #222)"), DEFAULT_YKT_DOC_THEME.text),
    textSoft: sanitizeDocColor(probeColor(container, "var(--text-2, #666)"), DEFAULT_YKT_DOC_THEME.textSoft),
    bg: "transparent",
    flush: true,
    border: sanitizeDocColor(probeColor(container, "var(--border, #ddd)"), DEFAULT_YKT_DOC_THEME.border),
    link: sanitizeDocColor(probeColor(container, "var(--accent, #1a73e8)"), DEFAULT_YKT_DOC_THEME.link),
    fallbackBg: sanitizeDocColor(probeColor(container, "var(--surface-3, #fafafa)"), DEFAULT_YKT_DOC_THEME.fallbackBg),
  };
}

export function ProblemBody({ html, fontUrl, cookies, title = i18n("components.exthw.problembody.cd833817789d"), className }: ProblemBodyProps) {
  const uiLocale = useUiLocale();

  const [doc, setDoc] = useState("");
  const [height, setHeight] = useState(YKT_FRAME_MIN_H);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  /** 外层容器：主题底色 / 变更观测的锚点（iframe 自身可能尚未挂载） */
  const wrapRef = useRef<HTMLDivElement | null>(null);
  /** 当前生效的 katex 产物（渲染器 + 内联样式；字体强刷重建文档时复用，避免二次加载） */
  const bundleRef = useRef<YktLatexBundle | null>(null);
  /** 构建序号：html/fontUrl 变更后，旧异步结果一律作废 */
  const buildSeq = useRef(0);
  /** 字体强刷只许一次（防「缓存坏 → 强刷 → 又坏」打转） */
  const fontRetried = useRef(false);
  /** 主题代数：主题/容器底色变化时 +1 触发文档重建（R20-B3 fix ②） */
  const [themeTick, setThemeTick] = useState(0);

  /** 用当前入参 + 已加载的渲染器/字体 + **当下实时主题**重建文档（初建与强刷共用） */
  const rebuild = useCallback(
    (fontDataUrl: string | undefined) => {
      const theme = readYktDocTheme(wrapRef.current);
      setDoc(
        buildYktProblemDoc({
          html,
          fontDataUrl,
          render: bundleRef.current?.render,
          extraCss: bundleRef.current?.inlineCss,
          theme,
          stripColors: stripInlineColors,
          // 官方正文里的行内实底（白底纸块、表格 bgcolor）会与页面材质脱节：浅色纸面
          // 下是一块白板，深色/玻璃下更刺眼。所有皮肤与明暗模式统一剥掉，底色跟随
          // 卡片材质；正文文字色仍按 stripColors 单独处理。
          stripBackgrounds: stripInlineBackgrounds,
        }),
      );
      setHeight(YKT_FRAME_MIN_H);
    },
    [html, themeTick, uiLocale],
  );

  /* 首建：渲染器与字体并行取，任一失败各自降级，不影响另一环 */
  useEffect(() => {
    const seq = ++buildSeq.current;
    fontRetried.current = false; // 新一轮构建重置强刷额度（每份文档允许一次 force 重取）
    const fu = fontUrl; // 局部别名：闭包内窄化（fontUrl?: string）
    void (async () => {
      /* 不能只判断 $：雨课堂大量公式只用 \( … \) / \[ … \]，
         以及实体/双反斜杠形态；漏判会让渲染器根本不加载，全部退回原文。 */
      const needsLatex = /[$]|\\[()\[\]]|&#0*36;|&#x0*24;|&#0*92;|&#x0*5c;/.test(html);
      const [bundle, font] = await Promise.all([
        needsLatex ? loadYktLatexBundle() : Promise.resolve(null),
        fu && needsEncryptedFont(html) ? loadYktFont(fu, { cookies }) : Promise.resolve(null),
      ]);
      if (seq !== buildSeq.current) return; // 期间入参已变，丢弃
      bundleRef.current = bundle;
      rebuild(font?.dataUrl);
    })();
  }, [html, fontUrl, cookies, rebuild]);

  /* 文档 → 组件消息：高度 / 图片失败代理 / 字体校验强刷 / 链接外开 */
  useEffect(() => {
    const onMsg = (ev: MessageEvent): void => {
      if (ev.source !== frameRef.current?.contentWindow) return; // 只认自己的 iframe
      const d = (ev.data ?? {}) as YktDocMessage;
      if (typeof d.type !== "string") return;
      if (d.type === "ykt:height") {
        setHeight(clampDocHeight(d.h));
        return;
      }
      if (d.type === "ykt:img-fail" && typeof d.src === "string") {
        const src = d.src;
        // 图片二次机会：fetch_binary 带 Referer/Cookie 代理（无 CORS 限制）
        fetchYktImageAsDataUrl(src, cookies)
          .then((dataUrl) => {
            frameRef.current?.contentWindow?.postMessage({ type: "ykt:img-data", src, dataUrl }, "*");
          })
          .catch(() => {
            frameRef.current?.contentWindow?.postMessage({ type: "ykt:img-giveup", src }, "*");
          });
        return;
      }
      if (d.type === "ykt:font-fail") {
        // 字体挂上了但 iframe 内校验失败（缓存污染 / CDN 换 key）：force 绕缓存重取一次
        if (!fontUrl || fontRetried.current) return;
        fontRetried.current = true;
        const seq = buildSeq.current;
        void loadYktFont(fontUrl, { force: true, cookies }).then((f) => {
          if (seq === buildSeq.current && f) rebuild(f.dataUrl);
          // f 为空：维持现状（若初建就没字体，文档已是剥 class 的兜底形态）
        });
        return;
      }
      if (d.type === "ykt:link" && typeof d.href === "string") {
        const href = d.href.trim();
        if (!href) return;
        try {
          const abs = new URL(href, YKT_DOC_BASE);
          if (abs.protocol === "http:" || abs.protocol === "https:") void openExternal(abs.toString());
        } catch {
          /* 相对地址解析失败 → 忽略（不外开非法链接） */
        }
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [cookies, fontUrl, rebuild]);

  /* 主题切换 → 重建文档（R20-B3 fix ②）：观测点与 theme.ts applyTheme 的三条写入路径
   * 一一对应——① documentElement 的 data-theme / style（colorScheme）属性；② 主题
   * <style id="onethu-theme-style"> 的文本被整体替换（characterData / childList）；
   * ③ 该 style 元素被创建 / 挪动（head childList）。触发时先比对实时配色，真变了才
   * setThemeTick，避免无关 DOM 抖动打出无意义的重建。 */
  useEffect(() => {
    let lastKey = "";
    const fire = (): void => {
      const t = readYktDocTheme(wrapRef.current);
      const key = JSON.stringify(t);
      if (key === lastKey) return;
      const first = lastKey === "";
      lastKey = key;
      if (!first) setThemeTick((n) => n + 1); // 首次只是登记基线，初建 effect 自会用当下主题
    };
    fire();
    const root = document.documentElement;
    const mo = new MutationObserver(fire);
    mo.observe(root, { attributes: true, attributeFilter: ["data-theme", "style", "class", "data-og-skin", "data-og-skin-level", "data-glass"] });
    const head = document.head;
    if (head) mo.observe(head, { childList: true });
    let styleEl = document.getElementById("onethu-theme-style");
    if (styleEl) mo.observe(styleEl, { characterData: true, childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  if (!html) return null;
  return (
    <div className={className} ref={wrapRef}>
      <iframe
        ref={frameRef}
        title={title}
        sandbox="allow-scripts"
        srcDoc={doc}
        loading="lazy"
        style={{ width: "100%", height, border: 0, display: "block", background: "transparent", colorScheme: "normal" }}
      />
    </div>
  );
}
