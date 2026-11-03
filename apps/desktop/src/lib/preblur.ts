/** Precomputed blurred wallpaper for page-level glass.
 *
 * Large page cards can read a single pre-blurred bitmap instead of each running
 * its own backdrop-filter. The bitmap is generated once per image wallpaper,
 * at the three glass-tier radii, and applied as a fixed background by
 * styles/preblur.css. Settings/OH search/vault/topbar/tabbar deliberately opt
 * back into live backdrop-filter because they sit above changing content.
 */
import { displayRef, veilOpacityFor } from "../state/wallpaper.js";

export interface PreblurSet {
  deep: string;
  rich: string;
  clear: string;
}

const RADII: Array<[keyof PreblurSet, number]> = [
  ["deep", 24],
  ["rich", 14],
  ["clear", 6],
];

const cache = new Map<string, Promise<PreblurSet>>();

type BlurSource = HTMLImageElement | ImageBitmap;

async function loadImage(src: string): Promise<BlurSource> {
  /* local: / asset: wallpapers are best fetched as a blob and decoded off the
     image element, so canvas is never tainted by a cross-origin asset URL. */
  try {
    const response = await fetch(src);
    if (response.ok) {
      const blob = await response.blob();
      if (blob.size) return await createImageBitmap(blob);
    }
  } catch {
    /* fall through to <img> for data: or servers without fetch CORS */
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("wallpaper image failed to load"));
    img.src = src;
  });
}

/** Generate all three tiers from one wallpaper image. Cached by ref so theme
 * changes and re-renders do not re-blur a 1920px photo. */
export function preblurWallpaper(ref: string): Promise<PreblurSet> {
  const hit = cache.get(ref);
  if (hit) return hit;
  const job = (async (): Promise<PreblurSet> => {
    const img = await loadImage(displayRef(ref));
    const sourceW = "naturalWidth" in img ? (img.naturalWidth || img.width) : img.width;
    const sourceH = "naturalHeight" in img ? (img.naturalHeight || img.height) : img.height;
    if (!sourceW || !sourceH) throw new Error("wallpaper has no pixels");
    const scale = Math.min(1, 1600 / Math.max(sourceW, sourceH));
    const w = Math.max(2, Math.round(sourceW * scale));
    const h = Math.max(2, Math.round(sourceH * scale));
    const veil = veilOpacityFor(ref);
    const out = {} as PreblurSet;
    for (const [tier, radius] of RADII) {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx || typeof ctx.filter !== "string") throw new Error("canvas filter unavailable");
      ctx.filter = `blur(${Math.max(1, radius * scale)}px)`;
      ctx.drawImage(img, 0, 0, w, h);
      ctx.filter = "none";
      if (veil > 0) {
        ctx.fillStyle = `rgba(0, 0, 0, ${veil})`;
        ctx.fillRect(0, 0, w, h);
      }
      out[tier] = canvas.toDataURL("image/jpeg", 0.82);
    }
    return out;
  })();
  cache.set(ref, job);
  job.catch(() => cache.delete(ref));
  return job;
}
