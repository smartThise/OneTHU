/**
 * IM 附件管道（两段式，对齐「不要一股脑直接存」的用户口径）：
 *   ① stage：下载（Rust im_fetch_media，含微信 CDN 解密）→ 读文本预览（im_peek_text）
 *      → 规则建议目录（看内容/文件名，判断不了才回默认 /IM/{channel}）；
 *   ② commit：用户确认（或指定目录）后 → mkdir -p → 上传 → 分享链接。
 *
 * 职责切分：适配器把平台附件翻译成「可执行下载指令」（fetchUrl/headers/aesKey），
 * 本模块只负责执行、建议与入库，不碰平台细节。
 */
import { invoke } from "@tauri-apps/api/core";
import { logLine } from "../lib/clients.js";
import { ensureSeafileLoaded, getSeafileToken } from "../state/seafile.js";
import { loadImConfig, patchImConfig } from "./store.js";

export interface AttachmentRef {
  /** 直链（微信 CDN full_url / cdn download；飞书 messages resources） */
  fetchUrl: string;
  /** 附加请求头（飞书 Authorization） */
  headers?: Array<[string, string]>;
  /** 微信加密媒体 aes_key（base64 16B 或 base64(hex32)） */
  aesKey?: string;
}

export interface StagedAttachment {
  channel: "wechat" | "feishu";
  name: string;
  localPath: string;
  sizeNote: string;
  /** 文本类预览（前 ~300 字；非文本为 null） */
  preview: string | null;
  /** 建议目录与理由（用户可改） */
  suggest: { dir: string; reason: string };
}

/** 文件名安全化（与 Rust safe_name 同规则，保证上传/分享路径一致） */
export function safeName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const cleaned = base
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/[\u0000-\u001f]/g, "_")
    .trim()
    .replace(/^\.+|\.+$/g, "");
  return cleaned || "attachment.bin";
}

async function token(): Promise<string> {
  await ensureSeafileLoaded();
  const t = getSeafileToken();
  if (!t) throw new Error("云盘未配置：先在应用的「云盘」页连接");
  return t;
}

/** 目标资料库：优先 IM 配置；否则自动挑一个（名字含 file/文件/OneTHU 优先）并记住（返回 id+名字） */
export async function targetRepo(): Promise<{ repoId: string; repoName: string }> {
  const tk = await token();
  const cfg = await loadImConfig();
  const repos = await invoke<Array<{ id: string; name: string }>>("seafile_repos", { token: tk });
  if (!repos.length) throw new Error("云盘里没有资料库（先在网页端建一个）");
  if (cfg.seafile?.repoId) {
    const hit = repos.find((r) => r.id === cfg.seafile!.repoId);
    if (hit) return { repoId: hit.id, repoName: hit.name };
  }
  const pick = repos.find((r) => /file|文件|OneTHU/i.test(r.name)) ?? repos[0]!;
  await patchImConfig((c) => {
    c.seafile = { repoId: pick.id, dir: c.seafile?.dir || "/IM" };
  });
  return { repoId: pick.id, repoName: pick.name };
}

/* ── 目录建议（看文件名/扩展名/预览内容；判断不了回默认） ── */

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|bmp|tiff?|svg)$/i;
const DOC_EXT = /\.(pdf|docx?|pptx?|xlsx?|md|txt|rtf|odt)$/i;
const ZIP_EXT = /\.(zip|rar|7z|tar|gz|bz2)$/i;
const CODE_EXT = /\.(js|ts|tsx|jsx|py|rs|c|cpp|h|java|kt|go|html?|css|json|ya?ml|xml|csv|sql|sh)$/i;

export function suggestDir(name: string, preview: string | null): { dir: string; reason: string } {
  const text = `${name}\n${preview ?? ""}`;
  if (/(发票|账单|收据|报销|receipt|invoice)/i.test(text)) return { dir: "/账单", reason: "文件名/内容含发票或账单字样" };
  if (/(作业|homework|\bhw[\s_-]?\d|assignment)/i.test(text)) return { dir: "/文档/作业", reason: "文件名/内容含作业字样" };
  if (/(课件|讲义|lecture|slides|第\s*\d+\s*讲)/i.test(text)) return { dir: "/文档/课件", reason: "文件名/内容含课件讲义字样" };
  if (/(简历|resume|cv)[^a-z]/i.test(text)) return { dir: "/文档", reason: "疑似简历文档" };
  if (IMAGE_EXT.test(name)) return { dir: "/图片", reason: "图片文件" };
  if (ZIP_EXT.test(name)) return { dir: "/压缩包", reason: "压缩包" };
  if (DOC_EXT.test(name)) return { dir: "/文档", reason: "文档文件" };
  if (CODE_EXT.test(name)) return { dir: "/文档/代码与数据", reason: "代码/数据文件" };
  return { dir: "", reason: "类型不明确（存默认位置）" };
}

/* ── 两段式：暂存 → 确认 → 入库 ── */

const MAX_PREVIEW_FILE = 2 * 1024 * 1024;

/** ① 下载暂存 + 预览 + 建议（不落云盘，等用户确认） */
export async function stageAttachment(
  channel: "wechat" | "feishu",
  rawName: string,
  ref: AttachmentRef,
): Promise<StagedAttachment> {
  const name = safeName(rawName);
  const localPath = await invoke<string>("im_fetch_media", {
    url: ref.fetchUrl,
    headers: ref.headers ?? null,
    aesKeyB64: ref.aesKey ?? null,
    fileName: name,
  });
  let sizeNote = "";
  let preview: string | null = null;
  try {
    // clean=true：HTML 等做净化（抽 title、去标签），预览是人能读的正文
    preview =
      (await invoke<string | null>("im_peek_text", { path: localPath, maxLen: 1_500, clean: true })) ?? null;
  } catch {
    preview = null;
  }
  try {
    const size = (await invoke<number | null>("im_stat_file", { path: localPath })) ?? 0;
    sizeNote = size > 0 ? (size > 1024 * 1024 ? `${(size / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(size / 1024))}KB`) : "";
  } catch {
    sizeNote = "";
  }
  const suggest = suggestDir(name, preview);
  return { channel, name, localPath, sizeNote, preview, suggest };
}

/** mkdir -p（逐级；已存在忽略） */
async function ensureDirs(tk: string, repoId: string, dir: string): Promise<void> {
  const parts = dir.split("/").filter(Boolean);
  let cur = "";
  for (const p of parts) {
    cur += `/${p}`;
    try {
      await invoke("seafile_mkdir", { token: tk, repoId, path: cur });
    } catch {
      /* 已存在等错误忽略——上传会给出真实结果 */
    }
  }
}

/**
 * ② 用户确认后入库：mkdir -p → 上传。
 * **默认不生成任何公开分享链接**（隐私红线）：文件只躺在你自己的私有资料库里；
 * 需要公开链接时用户明确回「要链接」再由 shareLast() 按需生成（7 天有效）。
 * targetDir 为空则按建议目录，建议也为空则默认 /IM/{channel}。
 */
export async function commitStored(
  staged: StagedAttachment,
  targetDir?: string,
): Promise<{ path: string; repoId: string; repoName: string; size: number }> {
  const tk = await token();
  const { repoId, repoName } = await targetRepo();
  const cfg = await loadImConfig();
  const base = (cfg.seafile?.dir || "/IM").replace(/\/+$/, "");
  const rawDir = (targetDir ?? staged.suggest.dir ?? "").trim();
  const dir = rawDir
    ? rawDir.startsWith("/") ? rawDir.replace(/\/+$/, "") : `${base}/${rawDir.replace(/\/+$/, "")}`
    : `${base}/${staged.channel}`;
  await ensureDirs(tk, repoId, dir);
  const size = await invoke<number>("seafile_upload", {
    token: tk,
    repoId,
    parentDir: dir,
    localPath: staged.localPath,
    replace: true,
  });
  void logLine(`[IM] 附件入库：库《${repoName}》 ${dir}/${staged.name}（${size} 字节）`).catch(() => undefined);
  return { path: `${dir}/${staged.name}`, repoId, repoName, size: typeof size === "number" ? size : 0 };
}

/** 兼容旧调用名（registry 用 commitStored；保留导出避免遗漏引用） */
export const commitStaged = commitStored;

/** 按需生成公开分享链接（7 天有效）——仅用户明确要求时调用 */
export async function shareLast(repoId: string, path: string): Promise<string> {
  const tk = await token();
  const share = await invoke<{ link: string }>("seafile_share", {
    token: tk,
    repoId,
    path,
    expireDays: 7,
    password: "",
  });
  return share.link;
}

/** 读附件全文（净化后，供文件问答/摘要；非文本返回 null） */
export async function readAttachmentText(localPath: string, maxLen = 12_000): Promise<string | null> {
  try {
    return (await invoke<string | null>("im_peek_text", { path: localPath, maxLen, clean: true })) ?? null;
  } catch {
    return null;
  }
}
