/**
 * R20-C2 P3：作答图片上传前预处理（桌面/移动一致）。
 *
 * 目标：相机照片 / 截图直接可交——太大（3-5MB 手机原图）既慢又费用户流量，
 * 压到 AI 判卷能读清字迹的最低成本形态：
 *  - 最长边 > 1600px 等比缩到 1600（作业本照片 1600px 足够 AI 读清手写字）；
 *  - 照片类（jpeg/heic/webp 相机源）转 image/jpeg 质量 0.85；
 *  - 截图类（image/png）保持 PNG——文字锐利优先，PNG 无损且截图天然小；
 *  - 已经足够小（≤400KB 且尺寸达标）的原样直传，免一次重编码损失。
 *
 * 无 React / 无 Tauri 依赖：纯 Web API（createImageBitmap + canvas），webview 可用。
 */

/** 最长边阈值：超过则等比缩放 */
const MAX_EDGE = 1600;
/** 小于该字节数且尺寸达标 → 原样直传 */
const PASS_THROUGH_BYTES = 400 * 1024;
/** JPEG 压缩质量 */
const JPEG_QUALITY = 0.85;

export interface PreppedImage {
  bytes: Uint8Array;
  fileName: string;
  mime: string;
}

/** 是否值得保 PNG（截图/UI 图：文字锐利优先） */
function keepPng(mime: string): boolean {
  return mime === "image/png";
}

export async function prepImageForUpload(file: Blob, baseName: string): Promise<PreppedImage> {
  const srcMime = file.type || "image/jpeg";
  const isPng = keepPng(srcMime);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // 解不出位图（罕见编码）→ 原字节直传，交由服务端/官方通道处置
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { bytes, fileName: baseName, mime: srcMime };
  }
  try {
    const needScale = Math.max(bitmap.width, bitmap.height) > MAX_EDGE;
    if (!needScale && file.size <= PASS_THROUGH_BYTES) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return { bytes, fileName: baseName, mime: srcMime };
    }
    const scale = needScale ? MAX_EDGE / Math.max(bitmap.width, bitmap.height) : 1;
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 不可用");
    // PNG 截图保透明无意义（作业图），白底更稳；JPEG 必须白底（透明会变黑）
    ctx.fillStyle = "#ffffff";  /* token-ok: Canvas 2D fillStyle 不解析 CSS 变量 */
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const outMime = isPng ? "image/png" : "image/jpeg";
    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("图片编码失败"))),
        outMime,
        outMime === "image/jpeg" ? JPEG_QUALITY : undefined,
      );
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const outName = baseName.replace(/\.[^.]*$/, "") + (outMime === "image/png" ? ".png" : ".jpg");
    return { bytes, fileName: outName, mime: outMime };
  } finally {
    bitmap.close?.();
  }
}

/** 生成上传用文件名（毫秒时间戳前缀，与官方 key 拼法一致语义） */
export function uploadFileName(prefix: string, mime: string): string {
  const ext = mime === "image/png" ? "png" : mime === "image/gif" ? "gif" : "jpg";
  return `${Date.now()}-${prefix}.${ext}`;
}
