/**
 * 云端壁纸备份的图片重编码（只在上传备份这一路做一次，本地永远存原图）。
 *
 * 为什么备份要压：本地存原始字节后，12 张 4K 照片的备份会顶到整包上限（见 wallpArchive 的额度）。
 * 为什么不在本地压：壁纸是要铺满整窗的照片，1600px + JPEG 0.82 在 2× 屏上会被放大到发虚；
 * 透明 PNG 还会被 JPEG 做成黑底（见 wallpaper.ts 的导入注释）。
 *
 * 这一档的口径（2026-10-28 用户定案「第二档」）：
 *  - 最长边 ≤ min(3840, max(2560, 2 × 窗口物理宽))：按当前屏幕算，天花板是 4K；
 *  - 不透明图走 JPEG 0.9；带 alpha 的图走 WebP 0.92（JPEG 没有 alpha 通道）；
 *  - 原图本来就不大（≤1.2MB）且尺寸不超过上限时不动它：避免白丢一次代际损失。
 *
 * 返回 null 表示「不压，按原始字节走」——不是图片、解码失败、或上面那条不用压。
 */

const QUALITY_PHOTO = 0.9;
const QUALITY_ALPHA = 0.92;
const KEEP_BYTES = 1.2 * 1024 * 1024;
const EDGE_FLOOR = 2560;
const EDGE_CEIL = 3840;

function targetEdge(): number {
  const physical = (globalThis.innerWidth || 1280) * (globalThis.devicePixelRatio || 1);
  const wanted = Math.round(physical * 2);
  return Math.min(EDGE_CEIL, Math.max(EDGE_FLOOR, wanted));
}

function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function toB64(u8: Uint8Array): string {
  let out = "";
  for (let i = 0; i < u8.length; i += 0x8000) out += String.fromCharCode(...Array.from(u8.subarray(i, i + 0x8000)));
  return btoa(out);
}

/** 采样判断有没有真正用到的透明像素（整幅 getImageData 在 4K 下太重，隔点取样足够）。
 *  GIF/WebP 的“声明支持透明”不等于图里真用了透明——没用透明就走 JPEG，文件小一截。 */
function hasTransparency(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  try {
    const data = ctx.getImageData(0, 0, width, height).data;
    const step = Math.max(1, Math.floor((width * height) / 200_000)) * 4;
    for (let i = 3; i < data.length; i += step) if (data[i]! < 255) return true;
    return false;
  } catch {
    /* 取不到像素就当作有透明，宁可用 WebP 也不要压成黑底 */
    return true;
  }
}

export interface ShrunkImage {
  b64: string;
  mime: string;
}

export async function shrinkWallpaperForCloud(b64: string, mime: string): Promise<ShrunkImage | null> {
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return null;
  if (!mime.startsWith("image/")) return null;
  const edge = targetEdge();
  try {
    const bytes = fromB64(b64);
    const source = new Blob([bytes], { type: mime });
    const bitmap = await createImageBitmap(source);
    const longest = Math.max(bitmap.width, bitmap.height);
    if (bytes.length <= KEEP_BYTES && longest <= edge && (mime === "image/jpeg" || mime === "image/webp")) {
      bitmap.close?.();
      return null;
    }
    const scale = Math.min(1, edge / longest);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) {
      bitmap.close?.();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const alpha = mime === "image/png" || mime === "image/webp" || mime === "image/gif"
      ? hasTransparency(ctx, canvas.width, canvas.height)
      : false;
    bitmap.close?.();
    const outMime = alpha ? "image/webp" : "image/jpeg";
    const quality = alpha ? QUALITY_ALPHA : QUALITY_PHOTO;
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), outMime, quality));
    if (!out || out.size === 0) return null;
    return { b64: toB64(new Uint8Array(await out.arrayBuffer())), mime: outMime };
  } catch {
    return null;
  }
}
