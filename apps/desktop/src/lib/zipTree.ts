/**
 * ZIP 层级树 + 按需解压 + pptx 大纲提取（零第三方依赖，纯浏览器能力）：
 * - 目录/解压：手写 EOCD → central directory 解析（带 method/compSize/local header 偏移），
 *   deflate 条目用标准 DecompressionStream("deflate-raw") 解压，store 条目直接拷贝；
 * - 树结构：buildZipTree 把平铺条目组织成目录树（目录行带后代文件数/合计大小），resolveZipNode 按路径下钻；
 * - pptx：解压 ppt/slides/slideN.xml + notesSlides，用 DOMParser 抽 a:t 文本，
 *   按 p:ph 占位符类型区分标题/要点（解析失败退正则抽 a:t），渲染"幻灯片大纲"卡片。
 * 所有函数只抛 Error（中文文案），调用方 catch 后回退到"内部文件列表 + 下载"兜底。
 */

/* ---------- ZIP 条目解析（central directory） ---------- */

export interface ZipEntry {
  /** 完整路径，目录条目以 / 结尾 */
  name: string;
  /** 未压缩大小 */
  size: number;
  /** 压缩后大小 */
  compSize: number;
  /** 压缩算法：0=store 8=deflate */
  method: number;
  isDir: boolean;
  /** central directory 记录的 local file header 偏移（解压时定位数据） */
  localOff: number;
}

function readU16(b: Uint8Array, off: number): number {
  return (b[off] ?? 0) | ((b[off + 1] ?? 0) << 8);
}

function readU32(b: Uint8Array, off: number): number {
  return ((b[off] ?? 0) | ((b[off + 1] ?? 0) << 8) | ((b[off + 2] ?? 0) << 16) | ((b[off + 3] ?? 0) << 24)) >>> 0;
}

/** 解析 ZIP central directory，返回全部条目（失败抛 Error） */
export function readZipEntries(bytes: Uint8Array): ZipEntry[] {
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
  if (count === 0xffff || off === 0xffffffff) throw new Error("暂不支持 ZIP64 格式，请下载查看");
  const utf8 = new TextDecoder("utf-8");
  const latin1 = new TextDecoder("latin1");
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count && off + 46 <= bytes.length; i++) {
    if (readU32(bytes, off) !== 0x02014b50) break;
    const flags = readU16(bytes, off + 8);
    const method = readU16(bytes, off + 10);
    const compSize = readU32(bytes, off + 20);
    const size = readU32(bytes, off + 24);
    const nameLen = readU16(bytes, off + 28);
    const extraLen = readU16(bytes, off + 30);
    const commentLen = readU16(bytes, off + 32);
    const localOff = readU32(bytes, off + 42);
    const raw = bytes.subarray(off + 46, off + 46 + nameLen);
    // flag bit 11 = UTF-8 文件名；否则 utf8 优先，出现替换符再退 latin1（cp437/gbk 不强求）
    let name: string;
    if (flags & 0x0800) {
      name = utf8.decode(raw);
    } else {
      const t = utf8.decode(raw);
      name = t.includes("\ufffd") ? latin1.decode(raw) : t;
    }
    entries.push({ name, size, compSize, method, isDir: name.endsWith("/"), localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  if (!entries.length) throw new Error("ZIP 目录为空或解析失败");
  return entries;
}

/* ---------- 解压单个条目 ---------- */

/**
 * 解压一个条目（只支持 store/deflate），输出超过 maxOut 字节直接抛错（防解压炸弹）。
 * docx/xlsx/pptx 由 mammoth/SheetJS 自行解包，这里只服务 zip 内文本条目与 pptx XML。
 */
export async function extractEntryBytes(fileBytes: Uint8Array, entry: ZipEntry, maxOut: number): Promise<Uint8Array> {
  if (entry.isDir) throw new Error("该条目是目录，无法解压");
  if (entry.size > maxOut) throw new Error("解压后内容超过预览大小限制");
  const off = entry.localOff;
  if (off + 30 > fileBytes.length || readU32(fileBytes, off) !== 0x04034b50) {
    throw new Error("ZIP 局部文件头损坏，无法解压该条目");
  }
  const nameLen = readU16(fileBytes, off + 26);
  const extraLen = readU16(fileBytes, off + 28);
  const start = off + 30 + nameLen + extraLen;
  const end = start + entry.compSize;
  if (end > fileBytes.length) throw new Error("ZIP 数据越界，文件可能损坏");
  const comp = fileBytes.subarray(start, end);

  if (entry.method === 0) {
    // store：原样存储
    if (comp.length > maxOut) throw new Error("解压后内容超过预览大小限制");
    return comp.slice();
  }
  if (entry.method !== 8) throw new Error(`不支持的压缩算法（method=${entry.method}），请下载查看`);
  if (typeof DecompressionStream === "undefined") {
    throw new Error("当前环境不支持解压（缺 DecompressionStream），请下载查看");
  }
  // comp.slice()：subarray 视图的 buffer 是 ArrayBufferLike，BlobPart 要 Uint8Array<ArrayBuffer>
  const stream = new Blob([comp.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const ab = await new Response(stream).arrayBuffer();
  if (ab.byteLength > maxOut) throw new Error("解压后内容超过预览大小限制");
  return new Uint8Array(ab);
}

/* ---------- 目录树 ---------- */

export interface ZipNode {
  name: string;
  /** 相对 zip 根的路径；根节点为 "" */
  path: string;
  isDir: boolean;
  /** 文件：自身大小；目录：后代文件合计 */
  size: number;
  /** 文件：1；目录：后代文件数（供文件夹行展示"内含条目数"） */
  fileCount: number;
  /** 目录子节点（目录在前、文件在后，各自按名称排序）；文件为 null */
  children: ZipNode[] | null;
}

interface TreeAcc {
  dirs: Map<string, TreeAcc>;
  files: ZipNode[];
}

/** 把平铺条目组织成目录树（隐式目录自动补齐，目录条目也占位） */
export function buildZipTree(entries: ZipEntry[]): ZipNode {
  const root: TreeAcc = { dirs: new Map(), files: [] };

  function ensureDir(acc: TreeAcc, seg: string): TreeAcc {
    let child = acc.dirs.get(seg);
    if (!child) {
      child = { dirs: new Map(), files: [] };
      acc.dirs.set(seg, child);
    }
    return child;
  }

  for (const e of entries) {
    const segs = e.name.split("/").filter((s) => s.length > 0);
    if (!segs.length) continue;
    let acc = root;
    const upto = e.isDir ? segs.length : segs.length - 1;
    for (let i = 0; i < upto; i++) acc = ensureDir(acc, segs[i] ?? "");
    if (!e.isDir) {
      const fname = segs[segs.length - 1] ?? "";
      acc.files.push({
        name: fname,
        path: segs.join("/"),
        isDir: false,
        size: e.size,
        fileCount: 1,
        children: null,
      });
    }
  }

  const sortFn = (a: ZipNode, b: ZipNode): number =>
    a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true });

  const finalize = (acc: TreeAcc, name: string, path: string): ZipNode => {
    const dirs = Array.from(acc.dirs.entries()).map(([dn, dacc]) =>
      finalize(dacc, dn, path ? `${path}/${dn}` : dn),
    );
    dirs.sort(sortFn);
    const files = [...acc.files].sort(sortFn);
    let size = 0;
    let fileCount = 0;
    for (const d of dirs) {
      size += d.size;
      fileCount += d.fileCount;
    }
    for (const f of files) {
      size += f.size;
      fileCount += 1;
    }
    return { name, path, isDir: true, size, fileCount, children: [...dirs, ...files] };
  };

  return finalize(root, "", "");
}

/** 按目录段路径从根下钻；找不到返回 null（调用方回退根目录） */
export function resolveZipNode(root: ZipNode, dirPath: string[]): ZipNode | null {
  let node = root;
  for (const seg of dirPath) {
    const next = node.children?.find((c) => c.isDir && c.name === seg);
    if (!next) return null;
    node = next;
  }
  return node;
}

/* ---------- pptx 幻灯片大纲提取 ---------- */

export interface PptxSlide {
  /** 幻灯片序号（1 起） */
  no: number;
  /** 标题（标题占位符文本；没有则取第一段） */
  title: string;
  /** 要点列表（正文段落） */
  bullets: string[];
  /** 备注页文本（无备注为 ""） */
  notes: string;
}

const SLIDE_RE = /^ppt\/slides\/slide(\d+)\.xml$/i;
const NOTES_RE = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/i;
/** pptx 内单份 XML 的解压上限，防异常超大文件 */
const PPTX_XML_LIMIT = 8 * 1024 * 1024;

/**
 * 提取 pptx 每页幻灯片的"大纲"：标题 + 要点 + 备注。
 * 没有找到 slideN.xml、条目损坏、算法不支持等一律抛 Error，由调用方回退内部文件列表。
 */
export async function extractPptxSlides(fileBytes: Uint8Array, entries: ZipEntry[]): Promise<PptxSlide[]> {
  const slideEntries = entries
    .filter((e) => !e.isDir && SLIDE_RE.test(e.name))
    .sort((a, b) => slideNo(a.name) - slideNo(b.name));
  if (!slideEntries.length) throw new Error("压缩包内未找到 ppt/slides/slideN.xml（可能不是 .pptx）");

  const notesMap = new Map<number, ZipEntry>();
  for (const e of entries) {
    const m = NOTES_RE.exec(e.name);
    if (e && !e.isDir && m?.[1]) notesMap.set(Number(m[1]), e);
  }

  const out: PptxSlide[] = [];
  for (const se of slideEntries) {
    const no = slideNo(se.name);
    const xml = new TextDecoder("utf-8").decode(await extractEntryBytes(fileBytes, se, PPTX_XML_LIMIT));
    const doc = parseXml(xml);
    const { title, bullets } = doc ? slidePartsFromDom(doc) : slidePartsFromRegex(xml);

    let notes = "";
    const ne = notesMap.get(no);
    if (ne) {
      try {
        const nxml = new TextDecoder("utf-8").decode(await extractEntryBytes(fileBytes, ne, PPTX_XML_LIMIT));
        const ndoc = parseXml(nxml);
        notes = ndoc ? collectAllText(ndoc) : regexAllTexts(nxml).join(" ").replace(/\s+/g, " ").trim();
      } catch {
        // 备注解压失败不影响主体大纲
      }
    }
    out.push({ no, title, bullets, notes });
  }
  return out;
}

function slideNo(name: string): number {
  return Number(SLIDE_RE.exec(name)?.[1] ?? 0) || 0;
}

function parseXml(text: string): Document | null {
  try {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    return doc.getElementsByTagName("parsererror").length > 0 ? null : doc;
  } catch {
    return null;
  }
}

/** 占位符类型为页码/日期/页脚的形状不参与标题与要点 */
const SKIP_PH = new Set(["sldnum", "dt", "ftr"]);

function slidePartsFromDom(doc: Document): { title: string; bullets: string[] } {
  const titleParas: string[] = [];
  const bodyParas: string[] = [];
  for (const sp of Array.from(doc.getElementsByTagName("p:sp"))) {
    const phType = (sp.getElementsByTagName("p:ph")[0]?.getAttribute("type") ?? "").toLowerCase();
    if (SKIP_PH.has(phType)) continue;
    const paras: string[] = [];
    for (const p of Array.from(sp.getElementsByTagName("a:p"))) {
      const t = Array.from(p.getElementsByTagName("a:t"))
        .map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim())
        .join("")
        .trim();
      if (t) paras.push(t);
    }
    if (!paras.length) continue;
    if (phType === "title" || phType === "ctrtitle") titleParas.push(...paras);
    else bodyParas.push(...paras);
  }
  let title: string;
  let bullets: string[];
  if (titleParas.length) {
    title = titleParas[0] ?? "";
    bullets = [...titleParas.slice(1), ...bodyParas];
  } else {
    // 无标题占位符：第一段作标题，其余作要点
    const all = bodyParas;
    title = all[0] ?? "";
    bullets = all.slice(1);
  }
  return { title, bullets: bullets.filter((b) => b !== title) };
}

function slidePartsFromRegex(xml: string): { title: string; bullets: string[] } {
  const all = regexAllTexts(xml);
  const title = all[0] ?? "";
  return { title, bullets: all.slice(1).filter((b) => b !== title) };
}

/** DOM 解析失败时退正则抽 a:t（顺带兼容非常规命名空间前缀） */
function regexAllTexts(xml: string): string[] {
  const out: string[] = [];
  const re = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const t = decodeXmlEntities(m[1] ?? "").replace(/\s+/g, " ").trim();
    if (t) out.push(t);
  }
  return out;
}

function collectAllText(doc: Document): string {
  return Array.from(doc.getElementsByTagName("a:t"))
    .map((n) => (n.textContent ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeFromCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => safeFromCode(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function safeFromCode(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}
