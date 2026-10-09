/**
 * IM 附件管道：平台引用 → 下载（Rust im_fetch_media：含微信 CDN AES 解密）→
 * 上传云盘 → 分享链接 → 回复用户。
 *
 * 职责切分（对齐适配器契约）：适配器把平台附件翻译成「可执行下载指令」
 * （fetchUrl/headers/aesKey），本模块只负责执行与入库，不碰平台细节。
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

/** 文件名安全化（与 Rust safe_name 同规则，保证上传/分享路径一致） */
export function safeName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const cleaned = base.replace(/[/\\:*?"<>|]/g, "_").replace(/[\u0000-\u001f]/g, "_").trim().replace(/^\.+|\.+$/g, "");
  return cleaned || "attachment.bin";
}

async function token(): Promise<string> {
  await ensureSeafileLoaded();
  const t = getSeafileToken();
  if (!t) throw new Error("云盘未配置：先在应用的「云盘」页连接");
  return t;
}

/** 目标资料库：优先 IM 配置；否则自动挑一个（名字含 file/文件/OneTHU 优先）并记住 */
async function targetRepo(): Promise<{ repoId: string; dir: string }> {
  const cfg = await loadImConfig();
  if (cfg.seafile?.repoId) return { repoId: cfg.seafile.repoId, dir: cfg.seafile.dir || "/IM" };
  const tk = await token();
  const repos = await invoke<Array<{ id: string; name: string }>>("seafile_repos", { token: tk });
  if (!repos.length) throw new Error("云盘里没有资料库（先在网页端建一个）");
  const pick = repos.find((r) => /file|文件|OneTHU/i.test(r.name)) ?? repos[0]!;
  await patchImConfig((c) => {
    c.seafile = { repoId: pick.id, dir: "/IM" };
  });
  return { repoId: pick.id, dir: "/IM" };
}

export interface StoredAttachment {
  link: string;
  path: string;
  sizeNote: string;
}

/** 下载 → 上传 → 分享；返回链接与云盘路径 */
export async function storeAttachment(
  channel: "wechat" | "feishu",
  rawName: string,
  ref: AttachmentRef,
): Promise<StoredAttachment> {
  const name = safeName(rawName);
  const localPath = await invoke<string>("im_fetch_media", {
    url: ref.fetchUrl,
    headers: ref.headers ?? null,
    aesKeyB64: ref.aesKey ?? null,
    fileName: name,
  });
  const tk = await token();
  const { repoId, dir } = await targetRepo();
  const parentDir = `${dir.replace(/\/+$/, "")}/${channel}`;
  const up = await invoke<{ size: number }>("seafile_upload", {
    token: tk,
    repoId,
    parentDir,
    localPath,
    replace: true,
  });
  const share = await invoke<{ link: string }>("seafile_share", {
    token: tk,
    repoId,
    path: `${parentDir}/${name}`,
    expireDays: 0,
    password: "",
  });
  void logLine(`[IM] 附件入库：${parentDir}/${name}（${up.size} 字节）`).catch(() => undefined);
  return {
    link: share.link,
    path: `${parentDir}/${name}`,
    sizeNote: up.size > 1024 * 1024 ? `${(up.size / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(up.size / 1024))}KB`,
  };
}
