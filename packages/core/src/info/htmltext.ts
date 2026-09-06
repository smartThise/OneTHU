/**
 * 新移植模块（finance/evaluation/classroom/fitness/hygiene/neth/calendar）共享的
 * 轻量 HTML 文本/属性工具 —— thu-info-lib cheerio + getCheerioText 的正则等价物。
 * 只覆盖移植所需的最小语义：单元格文本、属性读取、逐标签扫描、微 DOM。
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  ldquo: "\u201c",
  rdquo: "\u201d",
  lsquo: "\u2018",
  rsquo: "\u2019",
  middot: "\u00b7",
  bull: "\u2022",
  times: "\u00d7",
  divide: "\u00f7",
  plusmn: "\u00b1",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  deg: "\u00b0",
  micro: "\u00b5",
  para: "\u00b6",
  sect: "\u00a7",
  laquo: "\u00ab",
  raquo: "\u00bb",
  cent: "\u00a2",
  pound: "\u00a3",
  euro: "\u20ac",
  yen: "\u00a5",
  sup2: "\u00b2",
  sup3: "\u00b3",
  frac12: "\u00bd",
  frac14: "\u00bc",
  frac34: "\u00be",
  iexcl: "\u00a1",
  iquest: "\u00bf",
  ordf: "\u00aa",
  ordm: "\u00ba",
  not: "\u00ac",
  shy: "\u00ad",
  macr: "\u00af",
  acute: "\u00b4",
  cedil: "\u00b8",
  uml: "\u00a8",
  prime: "\u2032",
  dagger: "\u2020",
  Dagger: "\u2021",
  permil: "\u2030",
  lsaquo: "\u2039",
  rsaquo: "\u203a",
  alpha: "\u03b1",
  beta: "\u03b2",
  gamma: "\u03b3",
  delta: "\u03b4",
  theta: "\u03b8",
  lambda: "\u03bb",
  pi: "\u03c0",
  sigma: "\u03c3",
  omega: "\u03c9",
};

/** 常见 HTML 实体解码（lib 侧 cheerio/he.decode 的最小子集） */
export function decodeHtmlEntities(s: string): string {
  return s.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (all, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const n = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : all;
    }
    if (body.startsWith("#")) {
      const n = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[body.toLowerCase()] ?? all;
  });
}

/** 去标签（先剥 script/style；cheerio .text() 的近似等价，保留原始空白） */
export function stripTags(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]+>/g, "");
}

/** 单元格文本：去标签 + 实体解码 + 空白归一（cheerio .text().trim() 的等价物） */
export function cellText(html: string): string {
  return decodeHtmlEntities(stripTags(html)).replace(/\s+/g, " ").trim();
}

/** 逐个捕获某标签的完整元素（<tag …>…</tag>）；非贪婪，不处理嵌套同名标签 */
export function matchElements(html: string, tag: string): string[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, "gi"))].map(
    (m) => m[0] ?? "",
  );
}

/** 逐行捕获行内全部 td 的完整元素（<td …>…</td>），保序 */
export function tdCells(rowHtml: string): string[] {
  return matchElements(rowHtml, "td");
}

/** td 完整元素 → 内部 HTML */
export function innerOfTd(tdFull: string): string {
  return tdFull.replace(/^<td\b[^>]*>/i, "").replace(/<\/td>\s*$/i, "");
}

/** 行内全部 td 的内部 HTML（保序） */
export function tdInners(rowHtml: string): string[] {
  return [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1] ?? "");
}

/**
 * 在 HTML 片段中找第一个出现的 attr="…" 属性值（lib cheerio attribs 读取的近似等价；
 * 属性值做实体解码 —— onclick 内 &#39; 变体依赖此步）。
 */
export function findAttr(html: string, attr: string): string | undefined {
  const m = new RegExp(
    `(?:^|\\s)${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
    "i",
  ).exec(html);
  const raw = m?.[1] ?? m?.[2] ?? m?.[3];
  return raw === undefined ? undefined : decodeHtmlEntities(raw);
}

/**
 * lib getCheerioText(td.children[0]) 等价：取 td 内部第一个子元素的文本
 * （金额列常被 <div>/<span>/<font> 包裹）；无元素包裹时回退全文本。
 */
export function firstChildText(tdInner: string): string {
  const m = /^\s*<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(tdInner);
  return cellText(m ? (m[2] ?? "") : tdInner);
}

/* --------------------------- 微 DOM（评估表单解析用） --------------------------- */

/** 极简元素节点：tag/attrs + 子元素 kids + 直接文本片段 texts */
export interface MiniEl {
  tag: string;
  attrs: Record<string, string>;
  kids: MiniEl[];
  texts: string[];
}

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr",
]);

function parseAttrs(s: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of s.matchAll(
    /([a-zA-Z_:@][a-zA-Z0-9_:.@-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g,
  )) {
    const name = (m[1] ?? "").toLowerCase();
    if (!name || name in attrs) continue;
    attrs[name] = decodeHtmlEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/**
 * HTML 片段 → 微 DOM 树（合成 #root 根）。只处理移植所需语义：
 * 元素嵌套、属性、直接文本；script/style 内容整体跳过。
 */
export function parseMiniFragment(html: string): MiniEl {
  const root: MiniEl = { tag: "#root", attrs: {}, kids: [], texts: [] };
  const stack: MiniEl[] = [root];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const full = m[0];
    const closing = (m[1] ?? "") === "/";
    const tag = (m[2] ?? "").toLowerCase();
    const attrStr = m[3] ?? "";
    const text = html.slice(last, m.index);
    if (text.length > 0) {
      stack[stack.length - 1]?.texts.push(decodeHtmlEntities(text));
    }
    last = m.index + full.length;
    if (closing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i]?.tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const el: MiniEl = { tag, attrs: parseAttrs(attrStr), kids: [], texts: [] };
    stack[stack.length - 1]?.kids.push(el);
    if (tag === "script" || tag === "style") {
      const cm = new RegExp(`</${tag}\\s*>`, "i").exec(html.slice(last));
      if (cm) last += cm.index + cm[0].length;
      continue;
    }
    if (!VOID_TAGS.has(tag)) stack.push(el);
  }
  return root;
}

/** 节点及其后代的全部文本（cheerio .text() 等价，不归一空白） */
export function miniText(el: MiniEl | undefined): string {
  if (!el) return "";
  let out = el.texts.join("");
  for (const k of el.kids) out += miniText(k);
  return out;
}

/** 深度优先遍历（带父节点） */
export function miniWalk(
  el: MiniEl,
  parent: MiniEl | null,
  visit: (e: MiniEl, parent: MiniEl | null) => void,
): void {
  visit(el, parent);
  for (const k of el.kids) miniWalk(k, el, visit);
}

/** 按 id 找第一个元素 */
export function miniFindById(root: MiniEl, id: string): MiniEl | undefined {
  let hit: MiniEl | undefined;
  miniWalk(root, null, (el) => {
    if (!hit && el.attrs.id === id) hit = el;
  });
  return hit;
}

/** 按 class 收集全部元素（保文档序） */
export function miniFindByClass(root: MiniEl, cls: string): MiniEl[] {
  const out: MiniEl[] = [];
  miniWalk(root, null, (el) => {
    if (el.attrs.class?.split(/\s+/).includes(cls)) out.push(el);
  });
  return out;
}
