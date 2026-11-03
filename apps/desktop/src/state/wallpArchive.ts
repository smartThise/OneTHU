import type { WallpaperDoc, WallpaperLibItem } from "./wallpaper.js";

/** Portable format. Device paths never enter an archive; repeated media refs
 * share one asset so the active wallpaper is not encoded twice. */
export interface WallpaperArchive {
  v: 3;
  global: string | null;
  day?: string | null;
  night?: string | null;
  library: WallpaperLibItem[];
  assets: Record<string, string>;
}
export const WALLPAPER_MEDIA_MAX_BYTES = 16 * 1024 * 1024;
/* 额度（2026-10-28 上调）：本地改存原图后，备份这一路才压（见 lib/cloudWallpaperImage.ts）。
   单张 16 MiB 容得下 4K JPEG 0.9（约 2–4 MB）与 12 MB 内的视频；整包 64 MiB 给 12 张留余量。 */
export const WALLPAPER_ARCHIVE_MAX_BYTES = 64 * 1024 * 1024;
const LIBRARY_MAX = 12;
const BUILTIN = /^builtin:(aurora|dusk|matcha|ink)$/;
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/webm": "webm",
};
const EXT_MIME = Object.fromEntries(Object.entries(MIME_EXT).map(([mime, ext]) => [ext, mime]));
function invalid(): never { throw new Error("wallpaper-invalid-archive"); }
function media(value: string): { b64: string; ext: string } {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match || !MIME_EXT[match[1]!] || !match[2] || match[2].length % 4 !== 0) return invalid();
  const bytes = match[2].length / 4 * 3 - (match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0);
  if (bytes > WALLPAPER_MEDIA_MAX_BYTES) throw new Error("wallpaper-archive-too-large");
  return { b64: match[2], ext: MIME_EXT[match[1]!]! };
}
function shape(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function library(value: unknown): WallpaperLibItem[] {
  if (!Array.isArray(value) || value.length > LIBRARY_MAX) return invalid();
  const ids = new Set<string>();
  return value.map(item => {
    const row = shape(item);
    if (typeof row.id !== "string" || !row.id || row.id.length > 256 || ids.has(row.id)
      || typeof row.ref !== "string" || typeof row.name !== "string" || row.name.length > 512
      || typeof row.at !== "number" || !Number.isFinite(row.at)) return invalid();
    ids.add(row.id);
    return { id: row.id, ref: row.ref, name: row.name, at: row.at };
  });
}

/** 备份图片的可选重编码：只在上传云盘时用，本地与还原后的文件都保持原样。
 *  注入而非内联，是因为存档模块要在无 DOM 的环境里也能跑（见 tools/wallpaper-sync-test.mjs）。 */
export interface WallpaperArchiveOptions {
  /** 返回 null 表示不压，沿用原始字节 */
  shrink?: (b64: string, mime: string) => Promise<{ b64: string; mime: string } | null>;
}

export async function exportWallpaperArchive(doc: WallpaperDoc, readLocal: (path: string) => Promise<string>, options: WallpaperArchiveOptions = {}): Promise<WallpaperArchive> {
  const assets: Record<string, string> = {};
  const refs = new Map<string, string>();
  const rows = library(doc.library);
  let budget = 4096 + new TextEncoder().encode(JSON.stringify(rows.map(({ref: _ref, ...meta}) => meta))).length;
  async function portable(ref: string): Promise<string> {
    if (BUILTIN.test(ref)) return ref;
    const previous = refs.get(ref);
    if (previous) return previous;
    let value = ref;
    if (ref.startsWith("local:")) {
      const extension = ref.slice(ref.lastIndexOf(".") + 1).toLowerCase();
      const mime = extension === "jpeg" ? "image/jpeg" : EXT_MIME[extension];
      if (!mime) return invalid();
      let b64 = await readLocal(ref.slice(6));
      let outMime = mime;
      if (options.shrink && mime.startsWith("image/")) {
        const shrunk = await options.shrink(b64, mime);
        if (shrunk && MIME_EXT[shrunk.mime]) {
          b64 = shrunk.b64;
          outMime = shrunk.mime;
        }
      }
      value = `data:${outMime};base64,${b64}`;
    }
    media(value);
    budget += value.length;
    if (budget > WALLPAPER_ARCHIVE_MAX_BYTES) throw new Error("wallpaper-archive-too-large");
    const id = `asset:${Object.keys(assets).length}`;
    assets[id] = value;
    refs.set(ref, id);
    return id;
  }
  const global = doc.global === null ? null : await portable(doc.global);
  const day = doc.day == null ? null : await portable(doc.day);
  const night = doc.night == null ? null : await portable(doc.night);
  const entries: WallpaperLibItem[] = [];
  for (const row of rows) entries.push({ ...row, ref: await portable(row.ref) });
  return { v: 3, global, day, night, library: entries, assets };
}

/** Validate every field before the first filesystem write. Old inline archives
 * remain readable; old device-path-only backups need a fresh upload on source. */
export async function importWallpaperArchive(raw: unknown, save: (b64: string, extension: string) => Promise<string>): Promise<WallpaperDoc> {
  const input = shape(raw);
  if (input.v !== 2 && input.v !== 3) return invalid();
  if (input.global !== null && typeof input.global !== "string") return invalid();
  const day = input.day === undefined ? null : input.day;
  const night = input.night === undefined ? null : input.night;
  if ((day !== null && typeof day !== "string") || (night !== null && typeof night !== "string")) return invalid();
  const rows = library(input.library);
  const assets = input.v === 3 ? shape(input.assets) : {};
  if (Object.keys(assets).length > LIBRARY_MAX + 3) return invalid();
  const decoded = new Map<string, { b64: string; ext: string }>();
  const references = [input.global, day, night, ...rows.map(row => row.ref)];
  for (const ref of references) {
    if (ref === null || (typeof ref === "string" && BUILTIN.test(ref))) continue;
    if (typeof ref !== "string") return invalid();
    if (ref.startsWith("local:")) throw new Error("wallpaper-legacy-local-archive");
    const value = input.v === 3 && Object.prototype.hasOwnProperty.call(assets, ref) ? assets[ref] : ref;
    if (typeof value !== "string" || (input.v === 3 && !/^asset:\d+$/.test(ref))) return invalid();
    decoded.set(ref, media(value));
  }
  const local = new Map<string, string>();
  for (const [ref, value] of decoded) local.set(ref, `local:${await save(value.b64, value.ext)}`);
  const resolved = (ref: string): string => local.get(ref) ?? ref;
  return {
    v: 3,
    global: input.global === null ? null : resolved(input.global as string),
    day: day === null ? null : resolved(day as string),
    night: night === null ? null : resolved(night as string),
    library: rows.map(row => ({ ...row, ref: resolved(row.ref) })),
  };
}
