/**
 * 智能取色 · OneTHU 壁纸源。
 *
 * 从当前全屏壁纸（内置渐变 / 图片 / 视频当前帧）提取一个可用的强调色和中性色，
 * 再展开成与系统 Material You 同形的 tone 调色板，复用 dynamicRoles 的角色映射。
 * 纯函数部分（paletteFromSeeds）可单测；取像素部分只在浏览器/Tauri 运行时执行。
 */
import { builtinCss, displayRef, wallpaperSnapshot } from "../state/wallpaper.js";
import type { DynamicPalette } from "./dynamicRoles.js";

type Rgb = [number, number, number];
interface Hsl { h: number; s: number; l: number }

export interface WallpaperSeeds {
  accent: string;
  neutral: string;
}

const clamp = (n: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, n));
const hex = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

function rgbToHex([r, g, b]: Rgb): string {
  return "#" + hex(r) + hex(g) + hex(b);
}

function hexToRgb(raw: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw.trim());
  if (!m) return null;
  const body = m[1] as string;
  const full = body.length === 3 ? body.split("").map((c) => c + c).join("") : body;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl([r, g, b]: Rgb): Hsl {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0);
  else if (max === gg) h = (bb - rr) / d + 2;
  else h = (rr - gg) / d + 4;
  return { h: h * 60, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const seg = Math.floor(((h % 360) + 360) % 360 / 60) % 6;
  const [r, g, b] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][seg] as Rgb;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** 一组 M3 tone 0…1000；0 黑、1000 白（dynamicRoles 会自检方向，这里保持 AOSP 正序） */
function family(seed: Hsl): Record<string, string> {
  const out: Record<string, string> = {};
  for (let tone = 0; tone <= 1000; tone += 100) {
    const l = tone / 1000;
    /* 高/低两端降饱和：真实 M3 的 chroma 在中间段最大，纯色端点不应是霓虹 */
    const s = seed.s * (0.25 + 0.75 * (1 - Math.abs(2 * l - 1)));
    out[String(tone)] = rgbToHex(hslToRgb({ h: seed.h, s, l: clamp(l, 0.01, 0.99) }));
  }
  return out;
}

/** 种子 → 与系统调色板同形的 family 包。纯函数，供单测与运行时共用。 */
export function paletteFromSeeds(seeds: WallpaperSeeds): DynamicPalette {
  const accentRgb = hexToRgb(seeds.accent) ?? [15, 118, 110];
  const neutralRgb = hexToRgb(seeds.neutral) ?? [120, 120, 120];
  const accent = rgbToHsl(accentRgb);
  const neutral = rgbToHsl(neutralRgb);
  const primary: Hsl = {
    h: accent.h,
    s: Math.max(0.35, Math.min(0.78, accent.s)),
    l: Math.max(0.32, Math.min(0.58, accent.l)),
  };
  const secondary: Hsl = {
    h: (primary.h + 32) % 360,
    s: Math.max(0.18, Math.min(0.55, primary.s * 0.62)),
    l: Math.max(0.35, Math.min(0.62, primary.l + 0.04)),
  };
  const neutralSeed: Hsl = {
    h: neutral.h,
    s: 0.06,
    l: Math.max(0.38, Math.min(0.58, neutral.l)),
  };
  return {
    primary: family(primary),
    secondary: family(secondary),
    neutral: family(neutralSeed),
    neutralVariant: family({ ...neutralSeed, s: 0.09 }),
  };
}

function parseCssColors(css: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)) {
    const raw = m[0];
    let rgb: Rgb | null = null;
    if (raw.startsWith("#")) {
      const body = raw.slice(1);
      rgb = hexToRgb("#" + (body.length === 8 ? body.slice(0, 6) : body));
    } else {
      const nums = raw.match(/[\d.]+/g)?.map(Number) ?? [];
      if (nums.length >= 3) rgb = [nums[0] as number, nums[1] as number, nums[2] as number];
    }
    if (rgb) out.push(rgbToHex(rgb));
  }
  return out;
}

/** 从像素数组找“有颜色”的主色；找不到返回 null（灰度壁纸交给系统/主题兜底） */
function pickAccent(pixels: Uint8ClampedArray): { accent: string; neutral: string } | null {
  type Bucket = { weight: number; r: number; g: number; b: number };
  const buckets = new Map<number, Bucket>();
  let nr = 0, ng = 0, nb = 0, n = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3] as number;
    if (a < 200) continue;
    const rgb: Rgb = [pixels[i] as number, pixels[i + 1] as number, pixels[i + 2] as number];
    const hsl = rgbToHsl(rgb);
    nr += rgb[0]; ng += rgb[1]; nb += rgb[2]; n++;
    if (hsl.s < 0.18 || hsl.l < 0.1 || hsl.l > 0.9) continue;
    const key = Math.round(hsl.h / 30) % 12;
    const weight = hsl.s * (0.5 + 1 - Math.abs(hsl.l - 0.5));
    const b = buckets.get(key) ?? { weight: 0, r: 0, g: 0, b: 0 };
    b.weight += weight; b.r += rgb[0] * weight; b.g += rgb[1] * weight; b.b += rgb[2] * weight;
    buckets.set(key, b);
  }
  if (!n) return null;
  const neutral = rgbToHex([nr / n, ng / n, nb / n]);
  let best: Bucket | null = null;
  for (const b of buckets.values()) if (!best || b.weight > best.weight) best = b;
  if (!best || best.weight <= 0) return null;
  const accent = rgbToHex([best.r / best.weight, best.g / best.weight, best.b / best.weight]);
  return { accent, neutral };
}

function canvasPixels(source: CanvasImageSource, sw: number, sh: number): Uint8ClampedArray | null {
  if (!sw || !sh) return null;
  const size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const scale = Math.max(size / sw, size / sh);
  const dw = sw * scale, dh = sh * scale;
  ctx.drawImage(source, (size - dw) / 2, (size - dh) / 2, dw, dh);
  try {
    return ctx.getImageData(0, 0, size, size).data;
  } catch {
    return null;
  }
}

async function imagePixels(src: string): Promise<Uint8ClampedArray | null> {
  try {
    const r = await fetch(src);
    if (r.ok) {
      const blob = await r.blob();
      if (blob.size) {
        const bmp = await createImageBitmap(blob);
        return canvasPixels(bmp, bmp.width, bmp.height);
      }
    }
  } catch { /* fall through */ }
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = "anonymous";
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("wallpaper image decode failed"));
      el.src = src;
    });
    return canvasPixels(img, img.naturalWidth || 1, img.naturalHeight || 1);
  } catch {
    return null;
  }
}

const cache = new Map<string, Promise<DynamicPalette | null>>();

/** 读取当前 OneTHU 壁纸并产出调色板；没有可用颜色/没有壁纸时返回 null。 */
export function fetchWallpaperPalette(): Promise<DynamicPalette | null> {
  const wp = wallpaperSnapshot();
  const ref = wp?.global ?? null;
  if (!ref) return Promise.resolve(null);
  if (ref.startsWith("builtin:")) {
    const css = builtinCss(ref) ?? "";
    const colors = parseCssColors(css);
    if (!colors.length) return Promise.resolve(null);
    const seeds = pickAccent(new Uint8ClampedArray(
      colors.flatMap((c) => {
        const rgb = hexToRgb(c) ?? [0, 0, 0];
        return [rgb[0], rgb[1], rgb[2], 255];
      }),
    ));
    return Promise.resolve(seeds ? paletteFromSeeds(seeds) : null);
  }
  if (ref.startsWith("data:video/") || (ref.startsWith("local:") && /\.(mp4|webm)$/i.test(ref))) {
    /* 视频：采样壳层正在播放的当前帧；拿不到就交给系统/主题兜底 */
    const video = document.querySelector<HTMLVideoElement>(".shell-wallpaper video");
    const pixels = video && video.readyState >= 2 ? canvasPixels(video, video.videoWidth, video.videoHeight) : null;
    const seeds = pixels ? pickAccent(pixels) : null;
    return Promise.resolve(seeds ? paletteFromSeeds(seeds) : null);
  }
  const hit = cache.get(ref);
  if (hit) return hit;
  const job = imagePixels(displayRef(ref)).then((pixels) => {
    const seeds = pixels ? pickAccent(pixels) : null;
    return seeds ? paletteFromSeeds(seeds) : null;
  }).catch(() => null);
  cache.set(ref, job);
  return job;
}
