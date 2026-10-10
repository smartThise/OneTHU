/**
 * OH 记忆知识格式：三段式 markdown（frontmatter + observations + relations）。
 *
 * 借鉴 basic-memory 的 NOTE-FORMAT 语法约定（AGPL-3.0 项目，仅借鉴格式思想、零代码复制，
 * 见 docs/memory-cloud/01-memory-system.md §2.2）：
 * - observation：`- [category] 内容 #tag (context)`，category 必填，#tag/(context) 可选；
 * - relation：`- rel [[目标]] (context)`，多词关系类型用引号；裸 `- [[目标]]` = links_to；
 * - frontmatter：title/type/permalink/tags/created/modified 标准字段 + 任意自定义字段。
 *
 * 本文件保持纯净（无 Tauri/无 DOM 依赖，仅 Web Crypto 全局）——可脱离 App 在 Node 里自测
 * （scripts/memory-selftest.mjs）。
 */

/** 一条观察（ categorized fact ） */
export interface Observation {
  category: string;
  text: string;
  tags: string[];
  context?: string;
}

/** 一条关系（指向另一实体的 wikilink ） */
export interface Relation {
  rel: string;
  target: string;
  context?: string;
}

/** 记忆实体（= 镜像里的一个 .md 文件） */
export interface MemoryNote {
  title: string;
  type: string;
  permalink: string;
  tags: string[];
  /** ISO 8601，统一带 +08:00 偏移（见 03 文档 §6 时钟纪律） */
  created: string;
  modified: string;
  origin?: string;
  sensitivity?: "normal" | "sensitive";
  /** frontmatter 其余自定义字段（原样保留） */
  extra: Record<string, string>;
  observations: Observation[];
  relations: Relation[];
  /** 结构化区块以外的自由文本（原样保留） */
  body: string;
}

/* ── frontmatter（YAML 子集：key: value / [a, b] 列表 / 引号字符串） ── */

function parseFmValue(raw: string): string[] | string {
  const s = raw.trim();
  if (s.startsWith("[") && s.endsWith("]")) {
    return s
      .slice(1, -1)
      .split(",")
      .map((x) => unquote(x.trim()))
      .filter(Boolean);
  }
  return unquote(s);
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/** 解析 frontmatter 文本块（不含 --- 围栏）→ 平铺键值（列表值转 string[]） */
export function parseFrontmatter(block: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const value = m[2];
    if (!key || value == null) continue;
    if (value.trim() === "") {
      out[key] = "";
    } else {
      out[key] = parseFmValue(value);
    }
  }
  return out;
}

/* ── 观察行：`- [category] 内容 #tag (context)` ── */

const OBS_RE = /^-\s+\[([^\[\]]+)\]\s+(.*)$/;

/** 拆出正文里的 #tag 与行尾 (context) */
function splitObsRest(rest: string): { text: string; tags: string[]; context?: string } {
  let context: string | undefined;
  const ctxM = rest.match(/\s*\(([^)]*)\)\s*$/);
  if (ctxM) {
    context = ctxM[1]?.trim() || undefined;
    rest = rest.slice(0, ctxM.index);
  }
  const tags: string[] = [];
  rest = rest.replace(/(?:^|\s)#([^\s#（(]+)/g, (_all, tag: string) => {
    tags.push(tag);
    return " ";
  });
  return { text: rest.trim(), tags, context };
}

/** 判断是否不是观察（排除 checkbox / markdown 链接 / 空类别） */
function isNonObservation(category: string, rest: string): boolean {
  const c = category.trim().toLowerCase();
  if (c === "" || c === "x" || c === " ") return true; // checkbox `- [ ]` / `- [x]`
  // `- [text](url)` 是 markdown 链接不是观察（basic-memory 同款排除规则）
  if (/^\((https?:|mailto:|onethu:|onethu-)/i.test(rest.trim())) return true;
  return false;
}

/* ── 关系行：`- rel [[目标]] (context)` / `- "多词 rel" [[目标]]` / 裸 `- [[目标]]` ── */

const REL_RE = /^-\s+(?:(?:"([^"]+)"|'([^']+)'|([A-Za-z_][\w-]*))\s+)?\[\[([^\]]+)\]\]\s*(?:\(([^)]*)\))?\s*$/;

/* ── 解析整篇 ── */

/** 解析一篇记忆 markdown。无 frontmatter / 空 → null（坏文件进「损坏清单」，绝不静默修复） */
export function parseNote(raw: string): MemoryNote | null {
  const text = raw.replace(/\r\n/g, "\n");
  const fm = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fm) return null;
  const kv = parseFrontmatter(fm[1] ?? "");
  const rest = text.slice(fm[0].length);

  const str = (k: string, d = ""): string => {
    const v = kv[k];
    return typeof v === "string" ? v : d;
  };
  const title = str("title").trim();
  const permalink = str("permalink").trim();
  if (!title || !permalink) return null; // 语义主键缺失视作坏文件

  const tags = Array.isArray(kv.tags) ? kv.tags : kv.tags ? String(kv.tags).split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [];
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(kv)) {
    if (["title", "type", "permalink", "tags", "created", "modified", "origin", "sensitivity"].includes(k)) continue;
    extra[k] = Array.isArray(v) ? v.join(", ") : v;
  }

  const observations: Observation[] = [];
  const relations: Relation[] = [];
  const bodyLines: string[] = [];
  for (const line of rest.split("\n")) {
    const obsM = line.match(OBS_RE);
    const obsCat = obsM?.[1];
    const obsRest = obsM?.[2] ?? "";
    if (obsCat && !isNonObservation(obsCat, obsRest)) {
      const { text: t, tags: tt, context } = splitObsRest(obsRest);
      if (t) observations.push({ category: obsCat.trim(), text: t, tags: tt, context });
      continue;
    }
    const relM = line.match(REL_RE);
    if (relM) {
      const rel = (relM[1] ?? relM[2] ?? relM[3] ?? "links_to").trim() || "links_to";
      relations.push({ rel, target: relM[4] ?? "", context: relM[5]?.trim() || undefined });
      continue;
    }
    bodyLines.push(line);
  }

  return {
    title,
    type: str("type", "note") || "note",
    permalink,
    tags,
    created: str("created"),
    modified: str("modified"),
    origin: str("origin") || undefined,
    sensitivity: str("sensitivity") === "sensitive" ? "sensitive" : "normal",
    extra,
    observations,
    relations,
    body: bodyLines.join("\n").replace(/^\n+|\n+$/g, ""),
  };
}

/* ── 渲染（规范序，语义保真即可不字节保真） ── */

function fmEscape(v: string): string {
  return /[:#\[\]{},"']/.test(v) ? `"${v.replace(/"/g, "'")}"` : v;
}

export function renderNote(note: MemoryNote): string {
  const lines: string[] = ["---"];
  lines.push(`title: ${fmEscape(note.title)}`);
  lines.push(`type: ${fmEscape(note.type)}`);
  lines.push(`permalink: ${fmEscape(note.permalink)}`);
  if (note.tags.length > 0) lines.push(`tags: [${note.tags.map(fmEscape).join(", ")}]`);
  if (note.created) lines.push(`created: ${note.created}`);
  if (note.modified) lines.push(`modified: ${note.modified}`);
  if (note.origin) lines.push(`origin: ${note.origin}`);
  if (note.sensitivity === "sensitive") lines.push(`sensitivity: sensitive`);
  for (const [k, v] of Object.entries(note.extra)) lines.push(`${k}: ${fmEscape(v)}`);
  lines.push("---", "");
  lines.push(`# ${note.title}`, "");
  if (note.observations.length > 0) {
    lines.push("## Observations");
    for (const o of note.observations) {
      let line = `- [${o.category}] ${o.text}`;
      for (const t of o.tags) line += ` #${t}`;
      if (o.context) line += ` (${o.context})`;
      lines.push(line);
    }
    lines.push("");
  }
  if (note.relations.length > 0) {
    lines.push("## Relations");
    for (const r of note.relations) {
      const rel = /[\s]/.test(r.rel) ? `"${r.rel}"` : r.rel;
      lines.push(`- ${rel} [[${r.target}]]${r.context ? ` (${r.context})` : ""}`);
    }
    lines.push("");
  }
  if (note.body) lines.push(note.body, "");
  return lines.join("\n");
}

/* ── permalink 生成：语义 slug + 短哈希（CJK 保留） ── */

export async function sha1Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 保留 CJK 与字母数字的 slug；空则退 note；尾接 4 位哈希保证唯一 */
export async function genPermalink(title: string, salt: string): Promise<string> {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[\s（）()·、,，.。:：!！?？/\\]+/g, "-")
    .replace(/[^\w\u4e00-\u9fff-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const h = (await sha1Hex(`${title}|${salt}`)).slice(0, 4);
  return `${slug || "note"}-${h}`;
}

/* ── 隐私黑名单（引擎层硬拦，提示词之外的最后一道闸） ── */

const BLACKLIST: Array<{ re: RegExp; what: string }> = [
  { re: /sk-[A-Za-z0-9]{20,}/, what: "疑似 LLM API Key（sk-…）" },
  { re: /gh[pousr]_[A-Za-z0-9]{30,}/, what: "疑似 GitHub Token" },
  { re: /Bearer\s+[A-Za-z0-9._-]{20,}/i, what: "疑似 HTTP Bearer Token" },
  { re: /\d{15,}/, what: "连续 15+ 位数字（疑似证件号/卡号）" },
  { re: /(验证码|校验码)[\s:：]*\d{3,8}/, what: "疑似验证码" },
  { re: /(密码|口令)[\s:：是为]+\S{4,}/, what: "疑似明文密码" },
];

/** 命中返回违规描述；干净返回 null */
export function memoryBlacklist(text: string): string | null {
  for (const b of BLACKLIST) {
    if (b.re.test(text)) return b.what;
  }
  return null;
}

/* ── 文件名（title → 安全文件名） ── */

export function safeFileName(title: string): string {
  const cleaned = title
    .trim()
    .replace(/[/\\:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "未命名") + ".md";
}
