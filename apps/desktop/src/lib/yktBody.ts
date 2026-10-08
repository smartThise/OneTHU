/**
 * R20-B3：雨课堂题干 / 我的作答 HTML 的**本地内联渲染管线**（纯逻辑，零依赖）。
 *
 * 约定同 ./yktDetail.ts：无 React / 无 Tauri / 无 katex —— tools/ykt-body-test.mjs 用
 * Node 直引做回归测试。所有「判定 / 拼装」口径收敛在本模块；IO（字体下载落盘、图片
 * 代理抓取）在 ./yktAssets.ts；katex 懒加载在 ./yktKatex.ts；React 组件在
 * components/exthw/ProblemBody.tsx。
 *
 * 渲染方案（docs 28.10）：每块内容渲染进一个 **sandbox="allow-scripts" 的 srcdoc iframe**
 * （桌面 WebView2/WKWebView/WebKitGTK 与 Android 系统 WebView 同源支持，两端一套代码）。
 * 本模块负责把服务端 HTML 加工成那份内联文档：
 *  1. sanitize：去 <script> / on* 事件 / javascript: 链 / iframe 等容器（内容与官方页同源
 *     信任级别，仍做去活性兜底；沙箱本身无 allow-same-origin，双保险）；
 *  2. LaTeX：文本节点里 $…$ / $$…$$ 交给注入的渲染器（katex glue 在组件层），渲染失败
 *     / 无渲染器 → 原样保留，绝不白屏；
 *  3. 加密字体：有 xuetangx-com-encrypted-font 且拿到字体 data URL → @font-face；拿不到
 *     字体 → 剥掉加密 class（普通字体兜底显示原文，宁错字不丢字）；
 *  4. 图片：<img> 补 referrerpolicy="no-referrer"（防盗链常用口径：CDN 多放行空 Referer），
 *     加载失败由文档内脚本 postMessage 回组件，组件走代理重试，再失败显示占位框+文件名；
 *  5. 字体缓存判定：键 / TTL / magic 校验 / 失败退避，全部纯函数，供 yktAssets 调用。
 */

/* ────────────────────────── 常量 ────────────────────────── */

/** 加密 span 的 class（docs 28.1/28.4 实测，真字靠 data.font 字体渲染） */
export const YKT_ENCRYPTED_FONT_CLASS = "xuetangx-com-encrypted-font";

/** 内联文档里的 <base>：相对 URL（图片等）按雨课堂站内解析 */
export const YKT_DOC_BASE = "https://pro.yuketang.cn/";

/** 加密字体的 font-family 名（文档内 @font-face 与 span 规则共用） */
export const YKT_FONT_FAMILY = "YktEncrypted";

/**
 * 文档内正文字体栈（body 与加密 span 的回退栈共用同一常量，不许漂移）。
 * ⚠️ 加密 span 规则必须写成 `font-family:"YktEncrypted",<本栈>`——CSS 全局关键字
 * （inherit/initial/unset/…）**不能**作为 font-family 列表的一项，出现即整条声明
 * 在解析期被静默丢弃：R20-B3 曾写 `",inherit"`，导致规则全平台失效、span 永远用
 * 正文字体渲染加密原字符（= 乱码），且 @font-face 因无人引用保持 unloaded、
 * document.fonts.load 却仍成功 → 就绪判定误报 OK、无任何降级信号（霖 PC 实测根因）。
 */
export const YKT_DOC_FONT_STACK =
  "-apple-system,'PingFang SC','Microsoft YaHei','Noto Sans CJK SC',system-ui,sans-serif";

/** 字体缓存 TTL：超期自动重取（URL 每份作业唯一，TTL 主要兜 CDN 换 key 与脏缓存） */
export const YKT_FONT_CACHE_TTL_MS = 7 * 24 * 3600 * 1000;

/** 字体下载失败后的退避窗口（期间不再打网络，直接普通字体兜底） */
export const YKT_FONT_FAIL_BACKOFF_MS = 10 * 60 * 1000;

/** 字体 base64 长度上限（≈3MB 二进制）：防止把异常大文件/垃圾响应当字体缓存 */
export const YKT_FONT_MAX_B64_LEN = 4 * 1024 * 1024;

/** iframe 高度钳制（文档内脚本量不到高度时保持下限，异常大不无界） */
export const YKT_FRAME_MIN_H = 40;
export const YKT_FRAME_MAX_H = 20000;

/** LaTeX 渲染器签名：返回 null = 渲染失败（调用方保留原文兜底） */
export type LatexRender = (tex: string, displayMode: boolean) => string | null;

/* ────────────────────────── HTML 遍历（标签 / 文本分流） ────────────────────────── */

/** 判断 html 里 offset 处的 "<" 是否开启一个标签（字母 / ! / / / ? 才算，否则当字面 <） */
function isTagStart(html: string, lt: number): boolean {
  const c = html.charCodeAt(lt + 1);
  if (Number.isNaN(c)) return false;
  return (
    (c >= 65 && c <= 90) || // A-Z
    (c >= 97 && c <= 122) || // a-z
    c === 33 || // !
    c === 47 || // /
    c === 63 // ?
  );
}

/** 把 html 分成标签 / 文本两类节点分别变换（标签保持原样传入 mapTag）。
 *  简化：属性值内的 ">" 不做引号感知（服务端 Body 未观测到该形态，注释已记入设计文档）。 */
function mapNodes(html: string, mapText: (t: string) => string, mapTag: (t: string) => string): string {
  let out = "";
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      out += mapText(html.slice(i));
      break;
    }
    out += mapText(html.slice(i, lt));
    if (!isTagStart(html, lt)) {
      out += "<";
      i = lt + 1;
      continue;
    }
    // 注释整体直通（含 ">" 的注释体不拆）
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt);
      if (end < 0) {
        out += html.slice(lt);
        break;
      }
      out += html.slice(lt, end + 3);
      i = end + 3;
      continue;
    }
    const gt = html.indexOf(">", lt);
    if (gt < 0) {
      out += mapText(html.slice(lt));
      break;
    }
    out += mapTag(html.slice(lt, gt + 1));
    i = gt + 1;
  }
  return out;
}

/* ────────────────────────── LaTeX $…$ / $$…$$ ────────────────────────── */

/** 解基本 HTML 实体（喂给 LaTeX 前还原真字符；&amp; 必须最后替换） */
export function decodeBasicEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&(apos|#0*39|#x0?27);/gi, "'")
    .replace(/&amp;/g, "&");
}

/** 单个渲染尝试：渲染器抛错一律按失败（null → 原文兜底，永不白屏） */
function safeRender(render: LatexRender, tex: string, displayMode: boolean): string | null {
  try {
    return render(decodeBasicEntities(tex.trim()), displayMode);
  } catch {
    return null;
  }
}

/** 文本段里的 $…$ / $$…$$ 替换。定界约定（防误伤）：
 *  - $$…$$：显示模式；未配对则两个 $ 都按字面继续扫；
 *  - $…$：行内；开/关定界符**内侧不能是空白**（「价格 $5 与 $6」不误判），\$ 转义不闭合；
 *  - 渲染失败 / 未配对：该 $ 按字面保留，从下一字符继续（绝不吃内容）。 */
function renderTextSegment(seg: string, render: LatexRender): string {
  if (!seg.includes("$")) return seg;
  let out = "";
  let i = 0;
  const len = seg.length;
  while (i < len) {
    const start = seg.indexOf("$", i);
    if (start < 0) {
      out += seg.slice(i);
      break;
    }
    // 显示模式 $$…$$
    if (seg.charCodeAt(start + 1) === 36 /* $ */) {
      const end = seg.indexOf("$$", start + 2);
      if (end > start + 2) {
        const rendered = safeRender(render, seg.slice(start + 2, end), true);
        if (rendered !== null) {
          out += seg.slice(i, start) + rendered;
          i = end + 2;
          continue;
        }
      }
    }
    // 行内 $…$：只认最近的 $ 作为闭合候选（不合法则本 $ 按字面，后续另起扫描）
    if (seg.charCodeAt(start + 1) !== 32 /* 空白开界不放行 */) {
      let closed = -1;
      for (let j = start + 1; j < len; j++) {
        const c = seg.charCodeAt(j);
        if (c === 92 /* \ */) {
          j++; // 转义：\$ 不闭合
          continue;
        }
        if (c === 36 /* $ */) {
          if (j === start + 1) break; // 空段（$$ 已试过）
          if (seg.charCodeAt(j - 1) === 32) break; // 关界内侧空白 → 不算
          closed = j;
          break;
        }
      }
      if (closed > 0) {
        const rendered = safeRender(render, seg.slice(start + 1, closed), false);
        if (rendered !== null) {
          out += seg.slice(i, start) + rendered;
          i = closed + 1;
          continue;
        }
      }
    }
    // 不成立：字面保留这一个 $，从下一字符继续
    out += seg.slice(i, start + 1);
    i = start + 1;
  }
  return out;
}

/** 全文 LaTeX 替换（只动文本节点，不碰标签与属性）；render 缺省恒 null = 纯原文直通 */
export function renderLatexInHtml(html: string, render: LatexRender): string {
  if (!html.includes("$")) return html;
  return mapNodes(html, (t) => renderTextSegment(t, render), (t) => t);
}

/* ────────────────────────── 加密字体 span ────────────────────────── */

/** 是否需要加密字体（bodyHtml 里出现加密 class 才下载/挂 @font-face） */
export function needsEncryptedFont(html: string): boolean {
  return html.includes(YKT_ENCRYPTED_FONT_CLASS);
}

/** 剥掉加密 class（字体不可用时的兜底：span 还原成普通行内元素，普通字体显示原文）。
 *  只删该 token，其余 class 保留；class 值删空则整属性连前导空白一起移除。返回删除 token 数。 */
export function stripEncryptedFontClass(html: string): { html: string; removed: number } {
  let removed = 0;
  const out = html.replace(
    /(\s*)\bclass\s*=\s*("([^"]*)"|'([^']*)')/gi,
    (_full, lead: string, _q, dq: string, sq: string) => {
      const value = dq ?? sq ?? "";
      const keep = value
        .split(/\s+/)
        .filter((tok) => {
          if (tok.toLowerCase() === YKT_ENCRYPTED_FONT_CLASS) {
            removed++;
            return false;
          }
          return tok.length > 0;
        });
      return keep.length > 0 ? `${lead}class="${keep.join(" ")}"` : "";
    },
  );
  return { html: out, removed };
}

/* ────────────────────────── sanitize（去活性兜底） ────────────────────────── */

/** 服务端 HTML 进内联文档前的去活性兜底：
 *  - <script> 整块（含内容）移除；
 *  - iframe/object/embed/link/meta/base/form 容器标签剔除（干扰文档头/嵌套文档）；
 *  - on* 事件属性剥离、javascript: 链改 "#"（沙箱已无 allow-same-origin，双保险）。 */
export function sanitizeForInlineDoc(html: string): string {
  let out = html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "");
  out = out.replace(/<\/?(script|iframe|object|embed|link|meta|base|form)\b[^>]*>/gi, "");
  return mapNodes(
    out,
    (t) => t,
    (tag) =>
      tag
        .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
        .replace(/\s(href|xlink:href)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]*)/gi, ' href="#"'),
  );
}

/* ────────────────────────── <img> 加固 ────────────────────────── */

/** 每个 <img> 补 referrerpolicy="no-referrer"（已有则不动）：
 *  雨课堂/xuetangx 图床的防盗链多为「Referer 白名单」，空 Referer 通常放行；
 *  文档头另有 <meta name="referrer" content="no-referrer"> 双保险。 */
export function hardenYktImgs(html: string): string {
  return mapNodes(
    html,
    (t) => t,
    (tag) => {
      if (!/^<img\b/i.test(tag) || /\breferrerpolicy\s*=/i.test(tag)) return tag;
      return tag.replace(/^<img/i, '<img referrerpolicy="no-referrer"');
    },
  );
}

/** 提取 <img src>（去重；跳过 data:/blob: 内联源）。测试与诊断用。 */
export function imgSrcsOf(html: string): string[] {
  const out: string[] = [];
  const re = /<img\b[^>]*?\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const src = (m[2] ?? m[3] ?? m[4] ?? "").trim();
    if (src && !/^(data|blob):/i.test(src) && !out.includes(src)) out.push(src);
  }
  return out;
}

/** 图片占位框里的文件名：URL 最后段解码，截 48 字符；取不到 → 「图片」 */
export function imgFileName(src: string): string {
  const s = (src ?? "").trim();
  if (!s) return "图片";
  let name = "";
  try {
    const u = new URL(s, YKT_DOC_BASE);
    name = u.pathname.split("/").pop() ?? "";
  } catch {
    name = s.split("/").pop() ?? "";
  }
  try {
    name = decodeURIComponent(name);
  } catch {
    /* 解码失败保留原样（非法百分号序列） */
  }
  name = (name.split("?")[0] ?? "").trim();
  if (!name) return "图片";
  return name.length > 48 ? `${name.slice(0, 45)}…` : name;
}

/** 图片代理是否值得带雨课堂会话 Cookie（仅雨课堂/xuetangx 自有域，不外泄第三方） */
export function shouldAttachYktCookies(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "yuketang.cn" || h.endsWith(".yuketang.cn") || h === "xuetangx.com" || h.endsWith(".xuetangx.com");
  } catch {
    return false;
  }
}

/* ────────────────────────── 字体缓存判定（纯） ────────────────────────── */

/** appData/state/<key>.json 里存的一条字体缓存（yktAssets 写，isFontCacheFresh 验） */
export interface YktFontCacheRecord {
  v: 1;
  /** 原字体 URL（读出后核对，防哈希碰撞/串档） */
  url: string;
  /** font/ttf | font/otf | font/woff | font/woff2（按 magic 判定） */
  mime: string;
  /** 字体二进制 base64 */
  data: string;
  savedAt: number;
}

/** FNV-1a 32 位（Math.imul 保证 32 位语义） */
function fnv1a32(s: string, basis: number): number {
  let h = basis >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 双 basis FNV-1a 拼成 16 hex（64 位强度；缓存键用途足够，避免引 Node crypto） */
export function fnv1a64Hex(s: string): string {
  const a = fnv1a32(s, 0x811c9dc5).toString(16).padStart(8, "0");
  const b = fnv1a32(s, 0x1b873593).toString(16).padStart(8, "0");
  return `${a}${b}`;
}

/** 缓存键：URL 文件名 slug（安全化，兼容 Rust state_write 的 safe_name 白名单）
 *  + 全 URL 64bit 指纹 → ykt-font-<slug>-<hash>（Rust 侧自动补 .json）。 */
export function yktFontCacheKey(url: string): string {
  const raw = (url.split("?")[0] ?? "").split("/").pop() ?? "";
  const slug = raw.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40) || "font";
  return `ykt-font-${slug}-${fnv1a64Hex(url)}`;
}

/** base64 头部 → 字体 MIME（magic 判定）；不是已知字体格式 → null（404 页/HTML/垃圾） */
export function fontMimeFromBase64(b64: string): string | null {
  const s = (b64 ?? "").replace(/^data:[^,]*,/, "").trim();
  if (s.length < 8) return null;
  const head64 = s.slice(0, 16);
  const padded = head64 + "=".repeat((4 - (head64.length % 4)) % 4);
  let bin: string;
  try {
    bin = atob(padded);
  } catch {
    return null;
  }
  const b: number[] = [];
  for (let i = 0; i < bin.length; i++) b.push(bin.charCodeAt(i));
  const at = (n: number): number => b[n] ?? -1;
  const tag = (n: number): string => String.fromCharCode(at(n), at(n + 1), at(n + 2), at(n + 3));
  if (at(0) === 0 && at(1) === 1 && at(2) === 0 && at(3) === 0) return "font/ttf";
  if (tag(0) === "OTTO") return "font/otf";
  if (tag(0) === "wOFF") return "font/woff";
  if (tag(0) === "wOF2") return "font/woff2";
  return null;
}

/** 缓存是否可信可用：形状 / url 对档 / 未过期 / magic 是字体。任何不满足 → 视为无缓存。 */
export function isFontCacheFresh(
  rec: unknown,
  url: string,
  now: number,
  ttlMs: number = YKT_FONT_CACHE_TTL_MS,
): rec is YktFontCacheRecord {
  if (rec === null || typeof rec !== "object") return false;
  const r = rec as Record<string, unknown>;
  if (r["v"] !== 1) return false;
  if (typeof r["url"] !== "string" || r["url"] !== url) return false;
  if (typeof r["mime"] !== "string" || !r["mime"].startsWith("font/")) return false;
  if (typeof r["data"] !== "string" || r["data"].length < 80) return false;
  if (typeof r["savedAt"] !== "number" || !Number.isFinite(r["savedAt"])) return false;
  const age = now - r["savedAt"];
  if (age < 0) return false; // 时钟回拨 → 保守重取
  if (age >= ttlMs) return false; // 过期
  if (fontMimeFromBase64(r["data"]) === null) return false; // 内容不是字体（污染/截断）
  return true;
}

/** 现在是否允许发起字体下载（上次失败后退避窗口内不再打网络） */
export function fontDownloadAllowed(
  lastFailAt: number | undefined,
  now: number,
  backoffMs: number = YKT_FONT_FAIL_BACKOFF_MS,
): boolean {
  return lastFailAt === undefined || now - lastFailAt >= backoffMs;
}

/* ────────────────────────── 内联文档拼装 ────────────────────────── */

export interface YktDocBuildOptions {
  /** 服务端原始 HTML（bodyHtml / myAnswerHtml / description） */
  html: string;
  /** 字体 data URL（有加密 span 且拿到才挂 @font-face；拿不到 → 自动剥加密 class） */
  fontDataUrl?: string;
  /** LaTeX 渲染器（组件层注入 katex；不传 = 原样保留 $…$） */
  render?: LatexRender;
  /**
   * 额外样式（如 vendor/katex 的 katexInlineCss，srcdoc iframe 是 opaque origin，
   * 加载不了应用包内资源，样式必须随文档字符串进）。仅当 LaTeX 真渲染出了内容
   * （产物含 class="katex）才拼入，无公式 / 渲染全失败的文档零开销。
   */
  extraCss?: string;
  /**
   * 主题配色（R20-B3 fix ②）：组件层从**运行时实际生效的设计令牌**读取
   * （主题是可插拔的，暗色不止一个、浅色也可能是米白等自定义底色，不能假设
   * 明暗二元）。缺省 = 历史浅色定稿（DEFAULT_YKT_DOC_THEME），行为与旧版一致。
   */
  theme?: YktDocTheme;
  /**
   * 剥行内色器（暗底主题用，上游 1861e4e 同源能力）：暗底时把官方正文写死的
   * color/bgcolor 剥掉，交给主题档配色。做成**注入式**是为了保持本模块零依赖
   * （stripInlineColors 在 lib/htmlTheme.ts，走 DOMParser；yktBody 要能被 Node
   * 直引测试）。不传 = 不剥（亮底无需）。
   */
  stripColors?: (html: string) => string;
}

/** 沙箱文档配色（R20-B3 fix ②）：由组件层读当前主题令牌注入，纯数据便于直测 */
export interface YktDocTheme {
  /** 正文文字色（--text-1） */
  text: string;
  /** 次要文字色（--text-2：占位框文字等） */
  textSoft: string;
  /** 文档底色：容器链上第一个不透明背景色（亮主题通常白、暗主题随主题面） */
  bg: string;
  /** 边线色（表格 / 占位框虚线，--border） */
  border: string;
  /** 链接色（--accent） */
  link: string;
  /** 占位框底色（--surface-3） */
  fallbackBg: string;
}

/** 历史浅色定稿（buildYktProblemDoc 未传 theme 时的缺省，观感与旧版逐字节一致） */
export const DEFAULT_YKT_DOC_THEME: YktDocTheme = {
  text: "#222",  /* token-ok: srcdoc 是 opaque origin，CSS 变量进不去，只能字面量（主题色由组件层探针注入） */
  textSoft: "#666",  /* token-ok: srcdoc 是 opaque origin，CSS 变量进不去，只能字面量（主题色由组件层探针注入） */
  bg: "transparent",
  border: "#ddd",  /* token-ok: srcdoc 是 opaque origin，CSS 变量进不去，只能字面量（主题色由组件层探针注入） */
  link: "#1a73e8",  /* token-ok: srcdoc 是 opaque origin，CSS 变量进不去，只能字面量（主题色由组件层探针注入） */
  fallbackBg: "#fafafa",  /* token-ok: srcdoc 是 opaque origin，CSS 变量进不去，只能字面量（主题色由组件层探针注入） */
};

/**
 * 颜色令牌净化（纯）：只放行像颜色的值（#hex / rgb() / rgba() / hsl() / hsla() /
 * color() / transparent），其余一律回退。主题变量的值来自插件（受信代码），但
 * 这些值要拼进 srcdoc 的 <style>，一个畸形/恶意值就能把样式表揉碎——净化是
 * 低成本高收益的最后防线。不接受 var(...) / light-dark(...) 等引用形态：srcdoc
 * 是 opaque origin，引用外部令牌毫无意义，只能是要字面量。
 */
export function sanitizeDocColor(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const s = v.trim().toLowerCase();
  if (!s || s.length > 64) return fallback;
  if (s === "transparent") return s;
  if (/^#[0-9a-f]{3,8}$/.test(s)) return s;
  if (/^(rgba?|hsla?|color)\([^()]*\)$/.test(s)) return s;
  return fallback;
}

/** 底色是否偏暗（纯）：算相对亮度，暗底 → 需要剥官方行内色 + 行内色兜底规则。
 *  合并纪要：上游 1861e4e 用「明/暗两档」布尔驱动同样的事；本实现按霖口径不假设
 *  明暗二元（主题可插拔、浅色也可能自定义），故以**解析出的实际底色亮度**判定，
 *  任何主题下语义一致。解析不出（transparent / 畸形值）→ 视为亮色不剥（保守）。 */
/** sRGB 相对亮度（纯）：解析不出 → null。hex（3/4/6/8 位）与 rgb()/rgba() 字面量。 */
export function cssColorLuminance(v: string): number | null {
  const s = sanitizeDocColor(v, "");
  if (!s || s === "transparent") return null;
  let r = -1;
  let g = -1;
  let b = -1;
  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    const h = hex[1] ?? "";
    const d = (i: number): number =>
      h.length <= 4
        ? parseInt(h.charAt(i).repeat(2), 16)
        : parseInt(h.slice(i * 2, i * 2 + 2), 16);
    r = d(0);
    g = d(1);
    b = d(2);
  } else {
    const m = /^(rgba?)\(([^)]*)\)$/.exec(s);
    if (!m) return null;
    const parts = (m[2] ?? "").split(/[,/\s]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const num = (x: string): number => (x.endsWith("%") ? (parseFloat(x) / 100) * 255 : parseFloat(x));
    r = num(parts[0] ?? "");
    g = num(parts[1] ?? "");
    b = num(parts[2] ?? "");
  }
  if (![r, g, b].every((x) => Number.isFinite(x) && x >= 0 && x <= 255)) return null;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** 底色是否偏暗（纯）：亮度 < 0.5。解析不出 → false（保守视亮）。 */
export function isDarkBgColor(bg: string): boolean {
  const l = cssColorLuminance(bg);
  return l !== null && l < 0.5;
}

/** 文字是否为亮色（纯）：亮度 > 0.65 —— 亮字意味着外面是暗主题（R20-B3 fix② 真机回归） */
export function isLightTextColor(v: string): boolean {
  const l = cssColorLuminance(v);
  return l !== null && l > 0.65;
}

/** 沙箱文档该不该走暗底（纯）：底色暗 ∨ 文字亮。底色解析失败（transparent）时
 *  亮文字是暗主题的最后信号——绝不允许再出现「白画布黑字」（霖真机 2026-09-21）。 */
export function yktDocIsDark(t: YktDocTheme): boolean {
  return isDarkBgColor(t.bg) || isLightTextColor(t.text);
}

/** 文档内样式：按主题配色拼装（浅色定稿 = DEFAULT_YKT_DOC_THEME 的输出） */
export function yktDocCss(t: YktDocTheme = DEFAULT_YKT_DOC_THEME): string {
  const dark = yktDocIsDark(t);
  // 暗底自检兜底：底色没解析出来（transparent）→ 强制中性暗纸面（对齐上游 night 档）；
  // 文字是暗色（解析失败回退 #222 之类）→ 强制亮墨，暗底上不可见字比白底更伤
  const bg = dark && (!t.bg || t.bg === "transparent") ? "#16181d" : t.bg;  /* token-ok: srcdoc 是 opaque origin，CSS 变量进不去，只能字面量（主题色由组件层探针注入） */
  const text = dark && (cssColorLuminance(t.text) ?? 1) < 0.35 ? "#e8ebf2" : t.text;  /* token-ok: srcdoc 是 opaque origin，CSS 变量进不去，只能字面量（主题色由组件层探针注入） */
  return [
    "html,body{margin:0;padding:0}",
    // 底色必须显式给定（不能 transparent 兜底）：Chromium 系对 color-scheme 为
    // light 的 srcdoc 画布会刷白——暗色主题下「题干白底」的 R20-B3 fix ② 根因
    `body{font:14px/1.65 ${YKT_DOC_FONT_STACK};`,
    `color:${text};background:${bg};overflow:hidden;word-break:break-word;-webkit-text-size-adjust:100%}`,
    // color-scheme 跟档：画布默认色 / 滚动条 / 表单控件随暗底（画布兜底第二道）
    dark ? "html{color-scheme:dark}" : "",
    "p{margin:0 0 8px}p:last-child{margin-bottom:0}",
    "img{max-width:100%;height:auto;border-radius:4px}",
    `table{border-collapse:collapse;max-width:100%}th,td{border:1px solid ${t.border};padding:4px 8px;font-size:12px}`,
    "pre{white-space:pre-wrap;overflow-wrap:anywhere}",
    `a{color:${t.link};text-decoration:underline}`,
    // 暗底再兜一层（上游 1861e4e 引入）：漏剥的官方/KaTeX 行内色压不过主题配色
    dark ? "body,body *{color:inherit!important;background-color:transparent!important}" : "",
    // 回退栈必须与 body 同栈（YKT_DOC_FONT_STACK）：字体加载失败/未覆盖的字符 ≈ 普通正文观感
    `.${YKT_ENCRYPTED_FONT_CLASS}{font-family:"${YKT_FONT_FAMILY}",${YKT_DOC_FONT_STACK}}`,
    `.ykt-img-fallback{display:flex;align-items:center;gap:6px;padding:10px 12px;margin:4px 0;border:1px dashed ${t.border};border-radius:6px;color:${t.textSoft};font-size:12px;background:${t.fallbackBg};overflow-wrap:anywhere}`,
    // 长公式横向滚动（上游 1861e4e 引入），任何主题下都适用
    ".katex-display{overflow-x:auto;overflow-y:hidden}",
  ].join("");
}

/** 旧常量名保留：未传主题时的文档样式（= 浅色定稿），既有测试与调用兼容 */
export const YKT_DOC_CSS = yktDocCss(DEFAULT_YKT_DOC_THEME);

/**
 * 文档内脚本（静态字符串，buildYktProblemDoc 里把 __YKT_FONT__ 换成字体族名）。
 * 职责（经 postMessage 与组件通信，消息类型与组件层一一对应）：
 *  - ykt:height      内容高度（load/ResizeObserver/延时三保险，组件据其设 iframe 高）；
 *  - ykt:img-fail    图片直挂失败 → 组件代理重试（fetch_binary 带 Referer）；
 *  - ykt:img-data/-giveup：代理结果回填 / 放弃 → 占位框+文件名；
 *  - ykt:font-fail/-ok   加密字体实装校验（document.fonts 载入 + 计算样式生效双确认），
 *    失败触发组件强刷重取；
 *  - ykt:link        链接点击 → 组件用系统浏览器打开（防 iframe 内跳走）。
 */
export const YKT_DOC_SCRIPT_TEMPLATE = [
  "(function(){'use strict';",
  'var FAMILY="__YKT_FONT__";var lastH=0;',
  'function post(m){try{parent.postMessage(m,"*")}catch(e){}}',
  'function h(){var d=document.documentElement,b=document.body;var v=Math.max(d?d.scrollHeight:0,b?b.scrollHeight:0);if(v&&v!==lastH){lastH=v;post({type:"ykt:height",h:v})}}',
  'function fname(src){try{var u=new URL(src||"",location.href);var p=u.pathname.split("/").pop()||"";try{p=decodeURIComponent(p)}catch(e){}return (p||"图片").slice(0,48)}catch(e){return "图片"}}',
  'function failImg(img){var d=document.createElement("div");d.className="ykt-img-fallback";d.textContent="\\u{1F5BC} "+fname(img.getAttribute("src"))+"（图片加载失败）";if(img.parentNode){img.parentNode.replaceChild(d,img)}else{img.style.display="none"}h()}',
  'var pending={};',
  'function bySrc(src){return pending[src]||[]}',
  'function onErr(img){if(img.dataset.yktDead){return}img.dataset.yktDead="1";var src=img.getAttribute("src")||"";',
  'if(/^(data|blob):/i.test(src)){failImg(img);return}',
  '(pending[src]=pending[src]||[]).push(img);post({type:"ykt:img-fail",src:src});',
  'setTimeout(function(){if(img.dataset.yktDead==="1"&&!img.dataset.yktOk){var l=pending[src]||[];pending[src]=l.filter(function(x){return x!==img});failImg(img)}},15000)}',
  'function arm(img){if(img.dataset.yktArm){return}img.dataset.yktArm="1";img.addEventListener("error",function(){onErr(img)});img.addEventListener("load",function(){img.dataset.yktOk="1";h()})}',
  'function armAll(){var l=document.querySelectorAll("img");for(var i=0;i<l.length;i++){arm(l[i])}}',
  'window.addEventListener("message",function(ev){var d=(ev&&ev.data)||{};var src=(d.src||"")+"";',
  'if(d.type==="ykt:img-data"&&src){var l=bySrc(src);delete pending[src];for(var i=0;i<l.length;i++){var im=l[i];if(im&&im.dataset){im.dataset.yktOk="1";im.src=d.dataUrl||""}}h()}',
  'else if(d.type==="ykt:img-giveup"&&src){var g=bySrc(src);delete pending[src];for(var j=0;j<g.length;j++){failImg(g[j])}}});',
  'document.addEventListener("click",function(e){var t=e.target;while(t&&t.nodeType===1&&t.tagName!=="A"){t=t.parentNode}',
  'if(t&&t.tagName==="A"){var href=t.getAttribute("href")||"";if(href){e.preventDefault();post({type:"ykt:link",href:href})}}},true);',
  'function fontCheck(){var spans=document.querySelectorAll(".xuetangx-com-encrypted-font");var has=false;',
  'for(var i=0;i<spans.length;i++){if((spans[i].textContent||"").replace(/\\s/g,"").length){has=true;break}}',
  'if(!has||!document.fonts||!document.fonts.load){return}',
  'document.fonts.load(\'16px "\'+FAMILY+\'"\').then(function(fs){var ok=false;for(var k=0;k<fs.length;k++){if(fs[k].status==="loaded"){ok=true}}',
  // 双确认：字体载入成功还不够，font-family 规则必须真的生效（计算样式含加密族）。
  // 规则被引擎丢弃/类名不匹配时 document.fonts.load 照样成功——R20-B3 的静默乱码正是
  // 「字体 loaded + 规则失效」的组合，只查 fonts 会误报 OK。
  'if(ok){var el=null;for(var m=0;m<spans.length;m++){if((spans[m].textContent||"").replace(/\\s/g,"").length){el=spans[m];break}}',
  'if(el&&(getComputedStyle(el).fontFamily||"").indexOf(FAMILY)<0){ok=false}}',
  'post({type:ok?"ykt:font-ok":"ykt:font-fail"});h()}).catch(function(){post({type:"ykt:font-fail"})})}',
  'function boot(){armAll();fontCheck();h();window.addEventListener("load",h);',
  'if("ResizeObserver" in window){try{new ResizeObserver(h).observe(document.documentElement)}catch(e){}}',
  'setTimeout(h,350);setTimeout(h,1500);setTimeout(h,4000)}',
  'if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",boot)}else{boot()}',
  "})();",
].join("\n");

/** R20-C2：官方 img.kfformula 公式 → $…$ / $$…$$ 文本，交给既有 KaTeX 管线渲染。
 *  官方提交态公式是 `<img class="kfformula" src=data:… data-latex="…" data-display="…">`，
 *  官方渲染端只读 data-latex（§31.5）；本应用沙箱直接转成 TeX 定界文本走 renderLatexInHtml。
 *  属性顺序不定 → 逐 attr 抓取；src 忽略（kityformula 截图，我们用 KaTeX 重排）。
 *  纯字符串变换（零依赖），在 sanitize **之前**跑（sanitize 会剥 data-* 丢公式）。 */
export function convertKfformulaToTex(html: string): string {
  if (!html.includes("kfformula")) return html;
  const unescapeAttr = (s: string): string =>
    s
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  return html.replace(/<img\b[^>]*\bclass="[^"]*\bkfformula\b[^"]*"[^>]*>/gi, (tag) => {
    const raw = /\bdata-latex="([^"]*)"/i.exec(tag)?.[1];
    if (raw === undefined) return tag;
    const tex = unescapeAttr(raw).trim();
    if (!tex) return "";
    const display = /\bdata-display="([^"]*)"/i.exec(tag)?.[1] ?? "inline";
    return display === "block" ? `\n$$${tex}$$\n` : `$${tex}$`;
  });
}

/** 把服务端 HTML 加工成内联文档（sanitize → 加密字体 → LaTeX → 图片加固 → 拼装）。
 *  纯字符串拼装，任何一步失败都只影响该步的降级路径，不抛错。 */
export function buildYktProblemDoc(opts: YktDocBuildOptions): string {
  // R20-C2：kfformula 公式先转 TeX 文本再 sanitize（sanitize 会剥 data-* 属性丢公式）
  let body = convertKfformulaToTex(opts.html ?? "");
  body = sanitizeForInlineDoc(body);
  // 暗底主题：先剥掉官方正文里写死的颜色（上游 1861e4e 引入、与 THUbook 同源），
  // 由主题档样式接管配色——按解析出的底色亮度判定（isDarkBgColor），非明暗二元
  if (opts.theme && yktDocIsDark(opts.theme) && opts.stripColors) body = opts.stripColors(body);
  const hasEnc = needsEncryptedFont(body);
  let fontFace = "";
  if (hasEnc && opts.fontDataUrl) {
    // 字体可用：data URL 只含 base64 字母表，内联进 src 属性安全
    fontFace = `@font-face{font-family:"${YKT_FONT_FAMILY}";src:url(${opts.fontDataUrl});font-display:swap;}`;
  } else if (hasEnc) {
    // 字体不可用（404/超时/污染）：剥加密 class → 普通字体兜底显示原文（宁错字不丢字）
    body = stripEncryptedFontClass(body).html;
  }
  body = renderLatexInHtml(body, opts.render ?? (() => null));
  body = hardenYktImgs(body);
  // extraCss 只在 katex 真出了产物时才有意义（class="katex 是 KaTeX 输出的固定标志）
  const extra =
    opts.extraCss && body.includes('class="katex')
      ? opts.extraCss
      : "";
  // 配色：传了 theme 用主题色（组件层已净化），没传 = 历史浅色定稿
  const css = opts.theme ? yktDocCss(opts.theme) : YKT_DOC_CSS;
  const script = YKT_DOC_SCRIPT_TEMPLATE.split("__YKT_FONT__").join(YKT_FONT_FAMILY);
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<meta name="referrer" content="no-referrer">' +
    `<base href="${YKT_DOC_BASE}">` +
    `<style>${css}${extra}${fontFace}</style></head><body>${body}` +
    `<script>${script}</script></body></html>`
  );
}

/* ────────────────────────── 杂项判定 ────────────────────────── */

/** iframe 高度钳制：非数字/过小 → 下限；过大封顶 */
export function clampDocHeight(h: unknown): number {
  const n = typeof h === "number" && Number.isFinite(h) ? Math.round(h) : 0;
  return n < YKT_FRAME_MIN_H ? YKT_FRAME_MIN_H : Math.min(n, YKT_FRAME_MAX_H);
}
