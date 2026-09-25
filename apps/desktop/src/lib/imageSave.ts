/**
 * 手机端「保存图片到相册」的字节通道。
 *
 * 为什么字节必须由前端交出去：屏幕上这张图的 src 有三种来路，其中两种只有前端知道——
 *  ① dataURL：正文图片（通知/作业/讨论区、信息门户成绩单与校历）是应用侧带会话
 *     Cookie 抓回来内联的（pages/learn/shared.tsx 的 RichContent），原生侧拿不到这条
 *     会话通道，也无从知道它对应哪个地址；
 *  ② blob:：同上，抓取链的中间产物；
 *  ③ http(s)：确实可以抛给 Rust 重新抓一遍，但「看到的」与「存下的」会变成两次请求，
 *     会话过期或站点改版时两者还会不一致。
 * 所以统一在 JS 侧把图变成字节，再交给 Rust 落到相册（Android 走 MediaStore.Images，
 * 见插件 Kotlin 侧 saveImage）。
 *
 * 字节过 IPC 用 base64：与反方向的 fetch_binary 同一口径（那条命令也是 base64 回传），
 * 上限两边一致（16MB base64 ≈ 12MB 原图），超限时明确报错而不是把 WebView 拖住。
 */
import { invoke } from "@tauri-apps/api/core";
import { fetchImageAsDataUrl, fetchImageByUrl } from "./clients.js";

/** base64 字符串上限（Rust 侧 decode_image_base64 同值） */
const MAX_B64_LEN = 16 * 1024 * 1024;

/** 已知图片类型的落盘扩展名；其余按 mime 子类型推导 */
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

/** 字节 → base64（分段，避免一次展开整个数组把调用栈撑爆） */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x2000;
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** dataURL → { mime, base64 }；不是 dataURL 返回 null（支持 base64 与百分号两种编码） */
export function splitDataUrl(src: string): { mime: string; base64: string } | null {
  const m = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(src);
  if (!m) return null;
  const mime = m[1] || "image/png";
  const payload = m[3] ?? "";
  if (m[2]) return { mime, base64: payload };
  try {
    return { mime, base64: bytesToBase64(new TextEncoder().encode(decodeURIComponent(payload))) };
  } catch {
    return null;
  }
}

/** 相册里的文件名：优先用 alt（用户认得出是哪张图），否则用时间戳；
 *  路径分隔符与 Windows/安卓都不接受的字符一律换成空格。 */
export function imageFileName(mime: string, alt?: string, now = new Date()): string {
  const lower = (mime || "").toLowerCase();
  const sub = lower.startsWith("image/") ? lower.slice(6).replace(/[^a-z0-9]/g, "") : "";
  const ext = EXT[lower] || sub || "png";
  const base = (alt ?? "").replace(/[\\/:*?"<>|\r\n\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  const name = base || `onethu-${stamp(now)}`;
  return name.toLowerCase().endsWith(`.${ext}`) ? name : `${name}.${ext}`;
}

function stamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 屏幕上的图片 → 字节。dataURL 直接用，blob 就地读，http(s) 复用正文图片的抓取链
 *  （会话 Cookie + WebVPN 包装 + 直连兜底，失败时抛出由调用方提示）。 */
export async function resolveImageBase64(src: string): Promise<{ mime: string; base64: string }> {
  const inline = splitDataUrl(src);
  if (inline) return inline;
  if (/^blob:/i.test(src)) {
    const blob = await (await fetch(src)).blob();
    return { mime: blob.type || "image/png", base64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) };
  }
  const dataUrl = await fetchImageAsDataUrl(src).catch(() => fetchImageByUrl(src));
  const out = splitDataUrl(dataUrl);
  if (!out) throw new Error("图片内容无法解析");
  return out;
}

/** 保存到系统相册；返回落点显示名（Android 为「相册/OneTHU」），失败抛出原因。 */
export async function saveImageToGallery(src: string, alt?: string): Promise<string> {
  const { mime, base64 } = await resolveImageBase64(src);
  if (!base64) throw new Error("图片内容为空");
  if (base64.length > MAX_B64_LEN) throw new Error("图片过大，无法保存");
  const r = await invoke<{ dir?: string }>("save_image_to_gallery", {
    data: base64,
    mime,
    name: imageFileName(mime, alt),
  });
  return r?.dir ?? "";
}
