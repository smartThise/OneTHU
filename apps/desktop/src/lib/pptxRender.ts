/**
 * pptx 本地渲染模型（R26，零第三方依赖）。
 *
 * 目标：把 .pptx 真正**渲染成幻灯片页面**（不是文字大纲）——绝对定位文本框、图片、表格，
 * 几何按幻灯片实际尺寸换算；渲染不了的元素（图表 / SmartArt / 媒体）给占位框并计数，
 * 由调用方在页面上提示"部分内容未渲染"，绝不静默丢内容。
 *
 * 为什么自写而不引第三方：npm 上的 pptx 预览库（pptx-preview 等）依赖 echarts + lodash +
 * uuid、无类型无仓库，对安装包体积与维护都是负担；而本仓库已有完整 ZIP（central directory
 * + DecompressionStream）与 XML 解析能力，复用即可。
 *
 * 覆盖范围（按真实课件的高频元素排序）：
 *  1. 文本：`p:sp` 的 `p:txBody` —— 段落对齐/层级、run 的字号/粗斜/颜色、项目符号、换行；
 *  2. 几何：`a:xfrm` 的 off/ext（EMU）；**没有显式 xfrm 的占位符**按 slide→layout→master
 *     继承位置（这是真实 pptx 的常态：标题/正文位置写在版式里）；
 *  3. 图片：`p:pic` 的 blip r:embed → 从 zip 里取 media → data URL；
 *  4. 表格：`p:graphicFrame/a:tbl` → 行列文本；
 *  5. 组合：`p:grpSp` 的 chOff/chExt → 子元素坐标变换；
 *  6. 主题色：theme1.xml 的 clrScheme（accent1..6 / dk / lt）+ master 的 clrMap。
 * 不渲染：图表、SmartArt、动画、渐变/图案填充（退化为纯色或占位框）。
 *
 * 本模块**纯函数、不碰 DOM**：自带极简 XML 解析器，Node 单测可直接跑
 * （tools/pptx-render-test.mjs）。
 */
import { extractEntryBytes, type ZipEntry } from "./zipTree.js";
import { t as i18n } from "../i18n/index.js";


/* ══════════════ 极简 XML 解析（OOXML 子集，零依赖） ══════════════ */

export interface XmlNode {
  /** 本地名（去掉命名空间前缀，如 `p:sp` → `sp`） */
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** 直接文本（不含子元素） */
  text: string;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body.toLowerCase()] ?? m;
  });
}

function localName(raw: string): string {
  const i = raw.indexOf(":");
  return i >= 0 ? raw.slice(i + 1) : raw;
}

/**
 * 解析 XML 为节点树。只处理 OOXML 会用到的子集：声明、注释、CDATA、自闭合、
 * 单/双引号属性、实体。畸形输入不抛错，尽量返回已解析部分（预览不该因一处坏 XML 崩掉）。
 */
export function parseXmlTree(xml: string): XmlNode {
  const root: XmlNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  let i = 0;
  const n = xml.length;

  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) break;
    if (lt > i) {
      const raw = xml.slice(i, lt);
      stack[stack.length - 1]!.text += decodeEntities(raw);
    }
    // 注释 / CDATA / 声明 / DOCTYPE
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      stack[stack.length - 1]!.text += end < 0 ? xml.slice(lt + 9) : xml.slice(lt + 9, end);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (xml.startsWith("<?", lt) || xml.startsWith("<!", lt)) {
      const end = xml.indexOf(">", lt);
      i = end < 0 ? n : end + 1;
      continue;
    }
    const gt = xml.indexOf(">", lt);
    if (gt < 0) break;
    const inner = xml.slice(lt + 1, gt);
    i = gt + 1;

    if (inner.startsWith("/")) {
      // 闭合标签：弹到匹配的祖先（容错：找不到就忽略）
      const name = localName(inner.slice(1).trim());
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k]!.name === name) {
          stack.length = k;
          break;
        }
      }
      continue;
    }

    const selfClose = inner.endsWith("/");
    const body = selfClose ? inner.slice(0, -1) : inner;
    const sp = body.search(/\s/);
    const rawName = sp < 0 ? body : body.slice(0, sp);
    const node: XmlNode = { name: localName(rawName.trim()), attrs: {}, children: [], text: "" };
    if (sp >= 0) {
      const attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      const attrSrc = body.slice(sp);
      let m: RegExpExecArray | null;
      while ((m = attrRe.exec(attrSrc))) {
        node.attrs[localName(m[1]!)] = decodeEntities(m[3] ?? m[4] ?? "");
      }
    }
    stack[stack.length - 1]!.children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root;
}

/** 直接子元素（按本地名） */
export function child(n: XmlNode | undefined, name: string): XmlNode | undefined {
  return n?.children.find((c) => c.name === name);
}
/** 全部直接子元素（按本地名） */
export function children(n: XmlNode | undefined, name: string): XmlNode[] {
  return n ? n.children.filter((c) => c.name === name) : [];
}
/** 深度优先找第一个后代（含自身） */
export function find(n: XmlNode | undefined, name: string): XmlNode | undefined {
  if (!n) return undefined;
  if (n.name === name) return n;
  for (const c of n.children) {
    const hit = find(c, name);
    if (hit) return hit;
  }
  return undefined;
}
/** 深度优先找全部后代（含自身） */
export function findAll(n: XmlNode | undefined, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (x: XmlNode): void => {
    if (x.name === name) out.push(x);
    x.children.forEach(walk);
  };
  if (n) walk(n);
  return out;
}
/** 节点全部文本（含后代），用于 a:t 收集 */
export function allText(n: XmlNode | undefined): string {
  if (!n) return "";
  let s = n.text;
  for (const c of n.children) s += allText(c);
  return s;
}
function num(v: string | undefined, dflt = 0): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : dflt;
}

/* ══════════════ 渲染模型 ══════════════ */

export interface PptxRun {
  text: string;
  /** 字号（pt，未指定则继承/默认） */
  sizePt?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** #rrggbb */
  color?: string;
}

export interface PptxPara {
  runs: PptxRun[];
  align?: "l" | "ctr" | "r" | "just";
  /** 缩进层级 0..8 */
  lvl: number;
  /** 项目符号字符；null = 明确无符号；undefined = 用默认（正文占位符默认有符号） */
  bullet?: string | null;
}

/** 几何一律用 EMU（1 英寸 = 914400） */
export interface PptxBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PptxShape =
  | (PptxBox & { kind: "text"; paras: PptxPara[]; fill?: string; anchor?: "t" | "ctr" | "b"; placeholder?: boolean })
  /** 直线/连接线（模板里的分隔线）：按方向画一条细线，不占"未渲染"计数 */
  | (PptxBox & { kind: "line"; color?: string })
  | (PptxBox & { kind: "image"; dataUrl: string })
  | (PptxBox & { kind: "table"; rows: PptxPara[][][] })
  | (PptxBox & { kind: "unsupported"; label: string });

export interface PptxSlideModel {
  no: number;
  shapes: PptxShape[];
  notes: string;
}

export interface PptxModel {
  /** 幻灯片宽度/高度（EMU） */
  cx: number;
  cy: number;
  slides: PptxSlideModel[];
  /** 未能渲染的元素数（图表/SmartArt 等），页面据此提示 */
  unsupported: number;
}

const DEFAULT_CX = 12_192_000; // 16:9
const DEFAULT_CY = 6_858_000;
const MEDIA_LIMIT = 8 * 1024 * 1024;
/** 全部图片 data URL 的累计预算：超了就不再解后续图片（给占位标签），防超大课件吃满内存 */
const MEDIA_TOTAL_BUDGET = 32 * 1024 * 1024;
const XML_LIMIT = 8 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/** 主题配色（clrScheme 名 → #rrggbb），来自 ppt/theme/theme1.xml */
export interface PptxTheme {
  colors: Record<string, string>;
}

function parseTheme(xml: string): PptxTheme {
  const root = parseXmlTree(xml);
  const scheme = find(root, "clrScheme");
  const colors: Record<string, string> = {};
  if (scheme) {
    for (const c of scheme.children) {
      // 主题色两种写法：srgbClr@val（显式）或 sysClr@lastClr（系统色回退值）
      const srgb = child(c, "srgbClr");
      const sys = child(c, "sysClr");
      const val = srgb?.attrs.val
        ? `#${srgb.attrs.val.toLowerCase()}`
        : sys?.attrs.lastClr
          ? `#${sys.attrs.lastClr.toLowerCase()}`
          : undefined;
      if (val) colors[c.name] = val;
    }
  }
  return { colors };
}

/** 方案色 → 具体色（tx1/bg1 走 clrMap，其余直取） */
function schemeColor(name: string, theme: PptxTheme, clrMap: Record<string, string>): string | undefined {
  const mapped = clrMap[name] ?? name;
  return theme.colors[mapped];
}

/** 形状填充/文字颜色：srgbClr 优先，其次 schemeClr */
function solidColor(host: XmlNode | undefined, theme: PptxTheme, clrMap: Record<string, string>): string | undefined {
  const fill = child(host, "solidFill");
  if (!fill) return undefined;
  const direct = (() => {
    const srgb = child(fill, "srgbClr");
    return srgb?.attrs.val ? `#${srgb.attrs.val.toLowerCase()}` : undefined;
  })();
  if (direct) return direct;
  const sc = child(fill, "schemeClr");
  if (sc?.attrs.val) return schemeColor(sc.attrs.val, theme, clrMap);
  return undefined;
}

interface Xfrm extends PptxBox {}

function readXfrm(host: XmlNode | undefined): Xfrm | undefined {
  const xfrm = child(host, "xfrm");
  if (!xfrm) return undefined;
  const off = child(xfrm, "off");
  const ext = child(xfrm, "ext");
  if (!off || !ext) return undefined;
  return { x: num(off.attrs.x), y: num(off.attrs.y), w: num(ext.attrs.cx), h: num(ext.attrs.cy) };
}

/* ══════════════ 版式/母版占位符继承 ══════════════ */

interface PhInfo {
  key: string;
  box?: Xfrm;
  sizePt?: number;
  bold?: boolean;
  color?: string;
}

/** 占位符标识：type 缺省为 "body"（OOXML 规定），idx 缺省为 0 */
function phKey(ph: XmlNode): string {
  const type = ph.attrs.type ?? "body";
  const idx = ph.attrs.idx ?? "0";
  return `${type}#${idx}`;
}

function phKeyLoose(ph: XmlNode): string {
  return `${ph.attrs.type ?? "body"}#`;
}

/** 从 layout/master 的 spTree 收集占位符几何与默认文字样式 */
function collectPlaceholders(root: XmlNode, theme: PptxTheme, clrMap: Record<string, string>, into: Map<string, PhInfo>): void {
  const spTree = find(root, "spTree");
  if (!spTree) return;
  for (const sp of children(spTree, "sp")) {
    const nv = find(sp, "nvSpPr");
    const ph = nv ? find(nv, "ph") : undefined;
    if (!ph) continue;
    const box = readXfrm(child(sp, "spPr"));
    const lst = find(sp, "lstStyle");
    const lvl1 = lst ? child(lst, "lvl1pPr") : undefined;
    const defRPr = lvl1 ? child(lvl1, "defRPr") : undefined;
    const info: PhInfo = {
      key: phKey(ph),
      box,
      sizePt: defRPr?.attrs.sz ? num(defRPr.attrs.sz) / 100 : undefined,
      bold: defRPr?.attrs.b === "1" ? true : undefined,
      color: defRPr ? solidColor(defRPr, theme, clrMap) : undefined,
    };
    into.set(info.key, info);
    // 宽松键（只有 type）：仅在没有精确键时兜底
    const loose = phKeyLoose(ph);
    if (!into.has(loose)) into.set(loose, { ...info, key: loose });
  }
}

/* ══════════════ 文本 ══════════════ */

function readRuns(para: XmlNode, theme: PptxTheme, clrMap: Record<string, string>, no: number): PptxRun[] {
  const runs: PptxRun[] = [];
  for (const c of para.children) {
    if (c.name === "r") {
      const rPr = child(c, "rPr");
      const t = child(c, "t");
      runs.push({
        text: t ? allText(t) : "",
        sizePt: rPr?.attrs.sz ? num(rPr.attrs.sz) / 100 : undefined,
        bold: rPr?.attrs.b === "1" ? true : undefined,
        italic: rPr?.attrs.i === "1" ? true : undefined,
        underline: rPr?.attrs.u && rPr.attrs.u !== "none" ? true : undefined,
        color: rPr ? solidColor(rPr, theme, clrMap) : undefined,
      });
    } else if (c.name === "br") {
      runs.push({ text: "\n" });
    } else if (c.name === "fld") {
      // 页码字段在 XML 里是 "‹#›" 之类的占位符，直接渲染会露馅 → 换成真实页码
      const t = child(c, "t");
      const type = c.attrs.type ?? "";
      if (type === "slidenum") runs.push({ text: String(no) });
      else if (t) runs.push({ text: allText(t) });
    }
  }
  return runs;
}

function readParas(txBody: XmlNode | undefined, theme: PptxTheme, clrMap: Record<string, string>, no: number): PptxPara[] {
  if (!txBody) return [];
  const out: PptxPara[] = [];
  for (const p of children(txBody, "p")) {
    const pPr = child(p, "pPr");
    const runs = readRuns(p, theme, clrMap, no);
    // 段落级默认字体（pPr/defRPr）回填到没写 rPr 的 run
    const defRPr = pPr ? child(pPr, "defRPr") : undefined;
    if (defRPr) {
      const sizePt = defRPr.attrs.sz ? num(defRPr.attrs.sz) / 100 : undefined;
      const color = solidColor(defRPr, theme, clrMap);
      for (const r of runs) {
        if (r.sizePt === undefined) r.sizePt = sizePt;
        if (r.color === undefined) r.color = color;
        if (r.bold === undefined && defRPr.attrs.b === "1") r.bold = true;
      }
    }
    let bullet: string | null | undefined;
    if (pPr) {
      if (child(pPr, "buNone")) bullet = null;
      else if (child(pPr, "buChar")) bullet = child(pPr, "buChar")!.attrs.char ?? "•";
      else if (child(pPr, "buAutoNum")) bullet = "•";
    }
    if (!runs.length) continue;
    out.push({
      runs,
      align: (pPr?.attrs.algn as PptxPara["align"]) ?? undefined,
      lvl: num(pPr?.attrs.lvl, 0),
      bullet,
    });
  }
  return out;
}

/* ══════════════ 形状 ══════════════ */

interface SlideCtx {
  theme: PptxTheme;
  clrMap: Record<string, string>;
  /** relId → zip 内路径 */
  rels: Map<string, string>;
  bytes: Uint8Array;
  entries: ZipEntry[];
  ph: Map<string, PhInfo>;
  unsupported: { n: number };
  /** 图片 data URL 累计字节（全局预算，见 MEDIA_TOTAL_BUDGET） */
  mediaBudget: { n: number };
  /** 当前页页码（供 slidenum 字段显示真实页码） */
  no: number;
}

function resolveTarget(baseDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = baseDir.split("/").filter(Boolean);
  for (const seg of target.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

async function mediaDataUrl(ctx: SlideCtx, target: string): Promise<string | undefined> {
  const ext = target.slice(target.lastIndexOf(".") + 1).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) return undefined; // emf/wmf/tiff 等：交给占位框
  const entry = ctx.entries.find((e) => e.name === target);
  if (!entry) return undefined;
  try {
    const bytes = await extractEntryBytes(ctx.bytes, entry, MEDIA_LIMIT);
    if (ctx.mediaBudget.n + bytes.length > MEDIA_TOTAL_BUDGET) return undefined;
    ctx.mediaBudget.n += bytes.length;
    return `data:${mime};base64,${bytesToBase64(bytes)}`;
  } catch {
    return undefined;
  }
}

/** Uint8Array → base64（分块，避免逐字节字符串拼接的 O(n²) 行为） */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function groupTransform(grpSp: XmlNode): { off: Xfrm; ch: Xfrm } | undefined {
  const xfrm = find(child(grpSp, "grpSpPr") ?? grpSp, "xfrm");
  if (!xfrm) return undefined;
  const off = child(xfrm, "off");
  const ext = child(xfrm, "ext");
  const chOff = child(xfrm, "chOff");
  const chExt = child(xfrm, "chExt");
  if (!off || !ext || !chOff || !chExt) return undefined;
  return {
    off: { x: num(off.attrs.x), y: num(off.attrs.y), w: num(ext.attrs.cx), h: num(ext.attrs.cy) },
    ch: { x: num(chOff.attrs.x), y: num(chOff.attrs.y), w: num(chExt.attrs.cx) || 1, h: num(chExt.attrs.cy) || 1 },
  };
}

function applyGroup(box: Xfrm, g: { off: Xfrm; ch: Xfrm }): Xfrm {
  const sx = g.off.w / g.ch.w;
  const sy = g.off.h / g.ch.h;
  return {
    x: g.off.x + (box.x - g.ch.x) * sx,
    y: g.off.y + (box.y - g.ch.y) * sy,
    w: box.w * sx,
    h: box.h * sy,
  };
}

/** 递归解析一个 spTree 的子形状（组合会下钻并做坐标变换） */
async function readShapes(node: XmlNode, ctx: SlideCtx, group?: { off: Xfrm; ch: Xfrm }): Promise<PptxShape[]> {
  const out: PptxShape[] = [];
  const place = (box: Xfrm): Xfrm => (group ? applyGroup(box, group) : box);

  for (const c of node.children) {
    if (c.name === "grpSp") {
      const g = groupTransform(c);
      const nested = g
        ? group
          ? { off: applyGroup(g.off, group), ch: g.ch }
          : g
        : group;
      out.push(...(await readShapes(c, ctx, nested)));
      continue;
    }

    if (c.name === "sp") {
      const nv = find(c, "nvSpPr");
      const ph = nv ? find(nv, "ph") : undefined;
      const spPr = child(c, "spPr");
      let box = readXfrm(spPr);
      let inherited: PhInfo | undefined;
      if (!box && ph) {
        inherited = ctx.ph.get(phKey(ph)) ?? ctx.ph.get(phKeyLoose(ph));
        box = inherited?.box;
      }
      const txBody = child(c, "txBody");
      const paras = readParas(txBody, ctx.theme, ctx.clrMap, ctx.no);
      if (!paras.length) {
        // 无文字的装饰形状：有填充就画个色块，否则忽略（不占 unsupported 计数）
        const fillOnly = spPr ? solidColor(spPr, ctx.theme, ctx.clrMap) : undefined;
        if (box && fillOnly) out.push({ ...place(box), kind: "text", paras: [], fill: fillOnly });
        continue;
      }
      if (!box) {
        // 完全没有几何信息：给一个整幅默认框，保证文字可见（真实文件极少走到这里）
        box = { x: 0, y: 0, w: DEFAULT_CX, h: DEFAULT_CY };
      }
      // 占位符默认字号（版式/母版没写时的兜底）
      if (inherited?.sizePt !== undefined || inherited?.color !== undefined) {
        for (const p of paras) {
          for (const r of p.runs) {
            if (r.sizePt === undefined) r.sizePt = inherited?.sizePt;
            if (r.color === undefined) r.color = inherited?.color;
          }
        }
      }
      const bodyPh = (ph?.attrs.type ?? "body") === "body" || ph?.attrs.type === "subTitle";
      for (const p of paras) {
        if (p.bullet === undefined && bodyPh) p.bullet = "•";
      }
      const isTitle = ph?.attrs.type === "title" || ph?.attrs.type === "ctrTitle";
      if (isTitle) {
        for (const p of paras) {
          for (const r of p.runs) {
            if (r.sizePt === undefined) r.sizePt = 32;
            if (r.bold === undefined) r.bold = true;
          }
        }
      } else {
        for (const p of paras) {
          for (const r of p.runs) if (r.sizePt === undefined) r.sizePt = 18;
        }
      }
      const anchorRaw = child(txBody, "bodyPr")?.attrs.anchor;
      out.push({
        ...place(box),
        kind: "text",
        paras,
        fill: spPr ? solidColor(spPr, ctx.theme, ctx.clrMap) : undefined,
        anchor: anchorRaw === "ctr" ? "ctr" : anchorRaw === "b" ? "b" : "t",
        placeholder: Boolean(ph),
      });
      continue;
    }

    if (c.name === "pic") {
      const spPr = child(c, "spPr");
      const box = readXfrm(spPr);
      if (!box) continue;
      const blip = find(child(c, "blipFill") ?? c, "blip");
      const embed = blip?.attrs.embed ?? blip?.attrs.link;
      const target = embed ? ctx.rels.get(embed) : undefined;
      const dataUrl = target ? await mediaDataUrl(ctx, target) : undefined;
      if (dataUrl) out.push({ ...place(box), kind: "image", dataUrl });
      else {
        ctx.unsupported.n++;
        const known = target ? MIME_BY_EXT[target.slice(target.lastIndexOf(".") + 1).toLowerCase()] : undefined;
        out.push({ ...place(box), kind: "unsupported", label: known ? "图片过大未渲染" : "图片（格式不支持）" });
      }
      continue;
    }

    if (c.name === "graphicFrame") {
      const box = readXfrm(c); // graphicFrame 的 p:xfrm 是直接子元素
      const tbl = find(c, "tbl");
      if (tbl && box) {
        const rows: PptxPara[][][] = [];
        for (const tr of children(tbl, "tr")) {
          const cells: PptxPara[][] = [];
          for (const tc of children(tr, "tc")) {
            cells.push(readParas(child(tc, "txBody"), ctx.theme, ctx.clrMap, ctx.no));
          }
          rows.push(cells);
        }
        out.push({ ...place(box), kind: "table", rows });
        continue;
      }
      if (box) {
        ctx.unsupported.n++;
        const isChart = Boolean(find(c, "chart")) || /chart/i.test(find(c, "graphicData")?.attrs.uri ?? "");
        const isDgm = Boolean(find(c, "relIds"));
        out.push({ ...place(box), kind: "unsupported", label: isChart ? "图表" : isDgm ? "SmartArt" : "对象" });
      }
      continue;
    }

    if (c.name === "cxnSp") {
      // 直线/连接线：很多模板用 0 高度的连接线做分隔，画成细线比占位框更接近原样
      const spPr = child(c, "spPr");
      const box = readXfrm(spPr);
      if (box) {
        const line = find(spPr, "ln");
        out.push({ ...place(box), kind: "line", color: line ? solidColor(line, ctx.theme, ctx.clrMap) : undefined });
      }
      continue;
    }

    if (c.name === "contentPart") {
      const box = readXfrm(child(c, "spPr"));
      if (box) {
        ctx.unsupported.n++;
        out.push({ ...place(box), kind: "unsupported", label: i18n("auto.lib.pptxRender.p1") });
      }
    }
  }
  return out;
}

/* ══════════════ 入口 ══════════════ */

async function readZipText(ctx: SlideCtx, path: string): Promise<string | undefined> {
  const entry = ctx.entries.find((e) => e.name === path);
  if (!entry) return undefined;
  try {
    return new TextDecoder("utf-8").decode(await extractEntryBytes(ctx.bytes, entry, XML_LIMIT));
  } catch {
    return undefined;
  }
}

function readRels(xml: string | undefined, baseDir: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!xml) return map;
  for (const rel of findAll(parseXmlTree(xml), "Relationship")) {
    const id = rel.attrs.Id;
    const target = rel.attrs.Target;
    if (id && target && !rel.attrs.TargetMode) map.set(id, resolveTarget(baseDir, target));
  }
  return map;
}

const SLIDE_RE = /^ppt\/slides\/slide(\d+)\.xml$/i;

/**
 * 解析 pptx 为渲染模型。找不到幻灯片/解析失败抛 Error（调用方回退大纲或提示）。
 */
export async function parsePptxModel(fileBytes: Uint8Array, entries: ZipEntry[]): Promise<PptxModel> {
  const slideEntries = entries
    .filter((e) => !e.isDir && SLIDE_RE.test(e.name))
    .sort((a, b) => num(SLIDE_RE.exec(a.name)?.[1]) - num(SLIDE_RE.exec(b.name)?.[1]));
  if (!slideEntries.length) throw new Error("压缩包内未找到 ppt/slides/slideN.xml（可能不是 .pptx）");

  const baseCtx: SlideCtx = {
    theme: { colors: {} },
    clrMap: {},
    rels: new Map(),
    bytes: fileBytes,
    entries,
    ph: new Map(),
    unsupported: { n: 0 },
    mediaBudget: { n: 0 },
    no: 1,
  };

  // 主题
  const themeXml = await readZipText(baseCtx, "ppt/theme/theme1.xml");
  baseCtx.theme = themeXml ? parseTheme(themeXml) : { colors: {} };

  // 幻灯片尺寸 + 母版 clrMap
  const presXml = await readZipText(baseCtx, "ppt/presentation.xml");
  let cx = DEFAULT_CX;
  let cy = DEFAULT_CY;
  if (presXml) {
    const pres = parseXmlTree(presXml);
    const sz = find(pres, "sldSz");
    if (sz) {
      cx = num(sz.attrs.cx, DEFAULT_CX) || DEFAULT_CX;
      cy = num(sz.attrs.cy, DEFAULT_CY) || DEFAULT_CY;
    }
  }
  const masterXml = await readZipText(baseCtx, "ppt/slideMasters/slideMaster1.xml");
  if (masterXml) {
    const master = parseXmlTree(masterXml);
    const map = find(master, "clrMap");
    if (map) for (const [k, v] of Object.entries(map.attrs)) baseCtx.clrMap[k] = v;
    collectPlaceholders(master, baseCtx.theme, baseCtx.clrMap, baseCtx.ph);
  }

  const slides: PptxSlideModel[] = [];
  for (const se of slideEntries) {
    const no = num(SLIDE_RE.exec(se.name)?.[1]);
    const slideXml = await readZipText(baseCtx, se.name);
    if (!slideXml) continue;
    const root = parseXmlTree(slideXml);

    // 幻灯片自己的 rels（图片/版式）
    const relsPath = `ppt/slides/_rels/${se.name.slice("ppt/slides/".length)}.rels`;
    const rels = readRels(await readZipText(baseCtx, relsPath), "ppt/slides");

    // 版式占位符（叠加在母版之上：版式优先）
    const ph = new Map(baseCtx.ph);
    const layoutTarget = [...rels.values()].find((p) => /slideLayouts\/slideLayout\d+\.xml$/i.test(p));
    if (layoutTarget) {
      const layoutXml = await readZipText(baseCtx, layoutTarget);
      if (layoutXml) {
        const layout = parseXmlTree(layoutXml);
        const map = find(layout, "clrMap");
        const layoutClrMap = { ...baseCtx.clrMap };
        if (map) for (const [k, v] of Object.entries(map.attrs)) layoutClrMap[k] = v;
        collectPlaceholders(layout, baseCtx.theme, layoutClrMap, ph);
      }
    }

    const ctx: SlideCtx = { ...baseCtx, rels, ph, no };
    const spTree = find(root, "spTree");
    const shapes = spTree ? await readShapes(spTree, ctx) : [];

    let notes = "";
    const notesEntry = entries.find((e) => new RegExp(`^ppt/notesSlides/notesSlide${no}\\.xml$`, "i").test(e.name));
    if (notesEntry) {
      const nxml = await readZipText(ctx, notesEntry.name);
      if (nxml) {
        notes = findAll(parseXmlTree(nxml), "t")
          .map((t) => allText(t))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
      }
    }
    slides.push({ no, shapes, notes });
  }

  if (!slides.length) throw new Error("未能解析任何幻灯片");
  return { cx, cy, slides, unsupported: baseCtx.unsupported.n };
}
