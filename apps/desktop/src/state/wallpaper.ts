/**
 * 壁纸系统（2026-10-14 定案：单一全屏档 + 亮度自适应 + 壁纸库 + 视频动态壁纸）。
 *
 * 数据模型 v2（localStorage: onethu.wallpaper.v1）：
 *   {
 *     v: 2,
 *     global: string | null,           // 壳层壁纸——整个软件的底色，面板/栏体透出它
 *     library: WallpaperLibItem[],     // 壁纸库（用户自收录；内置渐变不入库，读取时并列展示）
 *   }
 * 范围定案：壁纸只有全局一份——右键菜单、壁纸库、插件改的都是它；画法统一在壳层
 * （ShellWallpaperLayer fixed 铺满），面板与内容层永远透明透出它（消灭 per-tab「本页」档：
 * 各自为政的纱/文字分支全部移除，详见 TabHost/explorer.css）。旧档里的 tabs 键不再保有
 * 渲染出口：global 为空时把一张（优先 home）提升为全屏档，绝不丢用户壁纸。
 *
 * ref 形态（三选一）："builtin:<id>"（内置渐变）| "data:image/…"（压缩后的图片）| "data:video/…"（视频）。
 * 应用壁纸时存**具体 ref**而不是 "lib:<id>" 间接层：库里删掉某张后，已应用的壁纸不失效；
 * 代价是同图在「库」与「应用处」各存一份 dataURL（压缩后百 KB 级，库上限 12 张内可控）。
 * 图片写入前经 canvas 压到 ≤1600px 宽、JPEG 0.82；视频读为 dataURL，上限 12MB（见 VIDEO_MAX_BYTES）。
 *
 * 亮度自适应：图片壁纸首次被用到时 canvas 采样平均亮度（只算一次，按 ref 缓存），
 * 纱的深浅随亮度走（亮壁纸→深纱、暗壁纸→几乎无纱），并经 shellWallpaperSnapshot 把
 * "dark|light" 交给壳层打 data-wallpaper-lum，栏体文字色据此分支（见 explorer.css）。
 * 内置渐变与视频直接按暗处理（视频固定叠 20% 暗纱保证可读）。
 *
 * 存储容量：全部数据在 localStorage，库上限 12 张 + 图片压缩；写不进（配额满）时保留内存态
 * 并提示用户删几张——壁纸是装饰，绝不因它崩数据。
 */
import { showToast } from "./toast.js";
import { convertFileSrc } from "@tauri-apps/api/core";
import { t as i18n } from "../i18n/index.js";


export interface WallpaperLibItem {
  id: string;
  ref: string;
  name: string;
  /** 入库时间戳（库里按新在前展示） */
  at: number;
}

export interface WallpaperDoc {
  v: 2;
  global: string | null;
  library: WallpaperLibItem[];
}

const KEY = "onethu.wallpaper.v1";
/** 动态壁纸声音开关（默认关；浏览器自动播放策略要求先静音起播，用户手势里再放开） */
const SOUND_KEY = "onethu.wallpaper.videosound";
/** 壁纸库容量（张）：满了提示并拒绝入库 */
export const LIBRARY_MAX = 12;
/** 视频壁纸单文件上限（字节）：超限拒绝入库/应用 */
export const VIDEO_MAX_BYTES = 12 * 1024 * 1024;

/** Uint8Array → base64（分块防 call stack 爆；FileReader 的替代，避免多读一遍） */
function toB64(u8: Uint8Array): string {
  let out = "";
  for (let i = 0; i < u8.length; i += 0x8000) {
    out += String.fromCharCode(...Array.from(u8.subarray(i, i + 0x8000)));
  }
  return btoa(out);
}

const isWallpaperRef = (v: unknown): v is string =>
  typeof v === "string" &&
  (v.startsWith("data:image/") || v.startsWith("data:video/") || v.startsWith("builtin:") || v.startsWith("local:"));

/** 磁盘存档 ref（"local:<绝对路径>"；2026-10-13 根治 dataURL 爆 localStorage 与渲染端大串解码） */
const isLocalVideo = (ref: string): boolean => {
  if (!ref.startsWith("local:")) return false;
  const low = ref.toLowerCase();
  return low.endsWith(".mp4") || low.endsWith(".webm");
};

export const isVideoRef = (ref: string): boolean => ref.startsWith("data:video/") || isLocalVideo(ref);

/** ref → 能直接喂给 <img>/<video>/CSS url() 的地址：local: 转 tauri asset 通道，其余原样 */
export function displayRef(ref: string): string {
  const path = ref.startsWith("local:") ? ref.slice("local:".length) : null;
  return path ? convertFileSrc(path) : ref;
}

function sanitize(raw: unknown): WallpaperDoc {
  const base: WallpaperDoc = { v: 2, global: null, library: [] };
  if (!raw || typeof raw !== "object") return base;
  const r = raw as (Partial<WallpaperDoc> & { tabs?: Record<string, unknown> });
  /* 单档化迁移（2026-10-14）：「本页」档已无渲染出口，但**不能把用户壁纸丢了**——
     global 为空而旧 tabs 非空时，把一张提升为全屏档（优先常驻 home 键，否则取第一张），
     其余本页档丢弃。此后全局唯一壁纸，旧档每次读入都收敛到同一结果。 */
  let migrated = isWallpaperRef(r.global) ? r.global : null;
  if (!migrated && r.tabs && typeof r.tabs === "object") {
    const entries = Object.entries(r.tabs as Record<string, string>).filter(([, v]) => isWallpaperRef(v));
    const pick = entries.find(([k]) => k === "home") ?? entries[0];
    if (pick) migrated = pick[1];
  }
  /* library 只留合法 ref，超上限截断（防手改存储撑爆） */
  const lib = Array.isArray(r.library) ? r.library : [];
  return {
    v: 2,
    global: migrated,
    library: lib
      .filter((it): it is WallpaperLibItem =>
        !!it && typeof it === "object" && typeof it.id === "string" && isWallpaperRef(it.ref))
      .slice(0, LIBRARY_MAX),
  };
}

function load(): WallpaperDoc {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return sanitize(JSON.parse(raw));
  } catch {
    /* 脏数据当没有 */
  }
  return { v: 2, global: null, library: [] };
}

let doc: WallpaperDoc = load();
let docVersion = 0;
const listeners = new Set<() => void>();

function commit(next: WallpaperDoc): void {
  doc = next;
  docVersion++;
  let saved = true;
  try {
    localStorage.setItem(KEY, JSON.stringify(doc));
  } catch {
    saved = false; // 存储满：内存态保留到刷新，但必须让用户知道（尤其刚入库的图）
  }
  if (!saved) showToast(i18n("auto.state.wallpaper.msg1"));
  shellCacheKey = ""; // 壳层快照失效（见下方 memo）
  listeners.forEach((f) => f());
}

export function subscribeWallpaper(f: () => void): () => void {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

export function wallpaperSnapshot(): WallpaperDoc {
  return doc;
}

export function setGlobalWallpaper(ref: string | null): void {
  commit({ ...doc, global: ref });
}

/** 整档替换（云盘恢复用）：内容过 sanitize，不是对象返回 false（调用方提示重试） */
export function replaceWallpaperDoc(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  commit(sanitize(raw));
  return true;
}

/* ── 内置渐变壁纸（轻量免图选项；值是 CSS background 简写，按 "builtin:<id>" 引用） ── */

export const BUILTIN_WALLPAPERS: Array<{ id: string; label: string; css: string }> = [
  { id: "aurora", label: "极光", css: "linear-gradient(135deg, #1a2340 0%, #233a5c 45%, #1c4a4a 100%)" },
  { id: "dusk", label: "暮色", css: "linear-gradient(160deg, #2b2140 0%, #4a2c4d 55%, #6b3a3f 100%)" },
  { id: "matcha", label: "抹茶", css: "linear-gradient(150deg, #22332a 0%, #2f4a38 60%, #3d5a45 100%)" },
  { id: "ink", label: "墨", css: "linear-gradient(180deg, #17181c 0%, #23252b 100%)" },
];

export function builtinCss(ref: string): string | null {
  if (!ref.startsWith("builtin:")) return null;
  return BUILTIN_WALLPAPERS.find((b) => "builtin:" + b.id === ref)?.css ?? null;
}

/* ── 亮度自适应（canvas 采样，按 ref 缓存，只算一次） ── */

export type WallpaperLum = "dark" | "light";
const lumCache = new Map<string, WallpaperLum>();
const lumPending = new Set<string>();
let lumVersion = 0;

/** 暗档判定：内置渐变/视频按暗处理；图片看采样结果（没算完时先按暗，算完发一次变更） */
export function wallpaperLum(ref: string): WallpaperLum {
  if (ref.startsWith("data:image/") || ref.startsWith("local:")) return lumCache.get(ref) ?? "dark";
  return "dark";
}

/** 亮度 → 「light」的阈值：平均亮度高于它算亮壁纸（栏体文字转深色分支） */
const LUM_LIGHT_AT = 0.6;

/** 图片 → 平均亮度（0..1，Rec.709 加权）；解码失败按 0（暗档） */
function sampleLuma(ref: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const S = 24;
        const canvas = document.createElement("canvas");
        canvas.width = S;
        canvas.height = S;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(0);
        ctx.drawImage(img, 0, 0, S, S);
        const d = ctx.getImageData(0, 0, S, S).data;
        let sum = 0;
        for (let i = 0; i + 2 < d.length; i += 4) {
          const r0 = d[i] ?? 0;
          const g0 = d[i + 1] ?? 0;
          const b0 = d[i + 2] ?? 0;
          sum += (0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0) / 255;
        }
        resolve(sum / (d.length / 4));
      } catch {
        resolve(0); // 跨域/画布污染等：按暗档兜底
      }
    };
    img.onerror = () => resolve(0);
    img.src = displayRef(ref);
  });
}

/** 确保某 ref 的亮度已入缓存（幂等；算完发一次变更让订阅方重画纱与属性） */
export function ensureWallpaperLum(ref: string): void {
  if ((!ref.startsWith("data:image/") && !/^local:.+\.(jpe?g|png|webp)$/i.test(ref)) || lumCache.has(ref) || lumPending.has(ref)) return;
  lumPending.add(ref);
  void sampleLuma(ref).then((v) => {
    lumPending.delete(ref);
    lumCache.set(ref, v > LUM_LIGHT_AT ? "light" : "dark");
    lumVersion++;
    shellCacheKey = "";
    listeners.forEach((f) => f());
  });
}

/** 纱的透明度：视频固定 20%（保证动态画面上的可读性）；亮图片壁纸叠 0.3 深纱、
 *  暗图片壁纸 0.08 轻纱（暗壁纸不需要再压亮度）；内置渐变自带深色不叠纱。
 *  还没采完样时用 0.14（一期默认），采样完成发变更后重画自然收敛。 */
export function veilOpacityFor(ref: string): number {
  if (isVideoRef(ref)) return 0.2;
  if (builtinCss(ref)) return 0;
  const l = lumCache.get(ref);
  if (l == null) return 0.14;
  return l === "light" ? 0.3 : 0.08;
}

/* ── 渲染取值 ── */

export interface ShellWallpaper {
  ref: string;
  kind: "builtin" | "image" | "video";
  /** builtin/image：可直接挂 style.backgroundImage（已含纱）；video 为 null（渲染 <video> 层） */
  backgroundImage: string | null;
  lum: WallpaperLum;
}

/** 「全屏档」快照（壳层壁纸层 + data-wallpaper-lum 的唯一取值口）。
 *  useSyncExternalStore 要求快照引用稳定：按 (docVersion, lumVersion) memo。 */
let shellCacheKey = "";
let shellCache: ShellWallpaper | null = null;
export function shellWallpaperSnapshot(): ShellWallpaper | null {
  const key = docVersion + ":" + lumVersion;
  if (shellCacheKey === key) return shellCache;
  const ref = doc.global;
  if (!ref) {
    shellCacheKey = key;
    shellCache = null;
    return null;
  }
  const veil = veilOpacityFor(ref);
  const css = builtinCss(ref);
  const next: ShellWallpaper = isVideoRef(ref)
    ? { ref, kind: "video", backgroundImage: null, lum: "dark" }
    : css
      ? { ref, kind: "builtin", backgroundImage: css, lum: "dark" }
      : {
          ref,
          kind: "image",
          backgroundImage: `linear-gradient(rgba(0, 0, 0, ${veil}), rgba(0, 0, 0, ${veil})), url(${displayRef(ref)})`,
          lum: wallpaperLum(ref),
        };
  shellCacheKey = key;
  shellCache = next;
  return next;
}

/* ── 壁纸库（内置渐变虚拟入列，用户条目存 doc.library，上限 LIBRARY_MAX） ── */

export interface LibraryEntry {
  id: string;
  ref: string;
  name: string;
  /** 内置渐变：不可删除 */
  builtin: boolean;
}

/** 库全量（内置在前，用户条目新在前）——缩略图网格的数据源 */
export function libraryItems(): LibraryEntry[] {
  const builtins: LibraryEntry[] = BUILTIN_WALLPAPERS.map((b) => ({
    id: "builtin:" + b.id,
    ref: "builtin:" + b.id,
    name: b.label,
    builtin: true,
  }));
  const mine = [...doc.library].sort((a, b) => b.at - a.at).map((it) => ({ id: it.id, ref: it.ref, name: it.name, builtin: false }));
  return [...builtins, ...mine];
}

/** 入库：满员/重复给文案（调用方 toast），成功返回 null */
export function addToLibrary(ref: string, name: string): string | null {
  if (!isWallpaperRef(ref) || ref.startsWith("builtin:")) return null; // 内置渐变常驻，不入库
  if (doc.library.length >= LIBRARY_MAX) return `壁纸库满员（${LIBRARY_MAX} 张），删一张再入库`;
  if (doc.library.some((it) => it.ref === ref)) return null; // 已在库里，静默当成功
  const item: WallpaperLibItem = {
    id: "lib-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
    ref,
    name: name.trim() || "自选壁纸",
    at: Date.now(),
  };
  commit({ ...doc, library: [...doc.library, item] });
  return null;
}

async function removeFileForRef(ref: string): Promise<void> {
  if (!ref.startsWith("local:")) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("wallpaper_delete", { path: ref.slice("local:".length) });
  } catch {
    /* 磁盘清理失败不阻塞：壁纸文件体量小，漏一个不至于伤数据 */
  }
}

export function removeFromLibrary(id: string): void {
  const gone = doc.library.find((it) => it.id === id);
  if (gone?.ref.startsWith("local:")) void removeFileForRef(gone.ref);
  commit({ ...doc, library: doc.library.filter((it) => it.id !== id) });
}

/* ── 文件导入（图片压缩 / 视频验限） ── */

export interface ImportResult {
  ref: string | null;
  /** 不为 null 时 ref 必为 null，文案给调用方 toast */
  error: string | null;
}

/** 文件 → 壁纸 ref：图片压到 ≤1600px 宽、JPEG 0.82；mp4/webm 读为 dataURL（≤12MB，超限拒绝）。
 *  压缩/解码失败不落库——宁可设不上也不要把存储撑爆。 */
export async function importWallpaperFile(file: File): Promise<ImportResult> {
  if (file.type.startsWith("video/")) {
    const okType = file.type === "video/mp4" || file.type === "video/webm";
    if (!okType) return Promise.resolve({ ref: null, error: "动态壁纸只认 mp4 / webm" });
    if (file.size > VIDEO_MAX_BYTES) return Promise.resolve({ ref: null, error: "视频超过 12MB，请先剪短再试" });
    /* 存档落盘（local:<绝对路径>）：整串 base64 塞 localStorage 必爆 blob 上限，
       渲染端对超大 dataURL 也常拒 —— 用户实测「动态壁纸坏 / 灰一大片」的根因。
       2026-10-15 补刀：invoke 参数曾写成 data_base64（Tauri v2 要 camelCase），
       命令必然失败 → 一路回落到 dataURL → 用户实测「小于 12MB 也说存不下、刷新就没了」。 */
    const buf = await file.arrayBuffer();
    const b64 = toB64(new Uint8Array(buf));
    const ext = file.type === "video/mp4" ? "mp4" : "webm";
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const path = await invoke<string>("wallpaper_save", { name: `wp-${Date.now()}.${ext}`, dataBase64: b64 });
      return { ref: `local:${path}`, error: null };
    } catch {
      /* 非 Tauri/写盘失败：回落 dataURL（小视频可用，大视频仍会失败——但至少不比旧路差） */
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const r = typeof reader.result === "string" && reader.result.startsWith("data:video/") ? reader.result : null;
          resolve(r ? { ref: r, error: null } : { ref: null, error: "这个视频读不出来，换一个试试" });
        };
        reader.onerror = () => resolve({ ref: null, error: "这个视频读不出来，换一个试试" });
        reader.readAsDataURL(file);
      });
    }
  }
  if (!file.type.startsWith("image/")) return Promise.resolve({ ref: null, error: "壁纸只认图片或视频" });
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = async () => {
      try {
        const MAX = 1600;
        const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve({ ref: null, error: "这张图处理失败，换一张试试" });
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        /* 图片同样落盘存档（local:）：与视频同根因；写盘失败回落 dataURL */
        const blob = await new Promise<Blob | null>((rb) => canvas.toBlob((b) => rb(b), "image/jpeg", 0.82));
        if (blob) {
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            const b64 = toB64(new Uint8Array(await blob.arrayBuffer()));
            const path = await invoke<string>("wallpaper_save", { name: `wp-${Date.now()}.jpg`, dataBase64: b64 });
            resolve({ ref: `local:${path}`, error: null });
            return;
          } catch {
            /* 回落 dataURL */
          }
        }
        resolve({ ref: canvas.toDataURL("image/jpeg", 0.82), error: null });
      } catch {
        resolve({ ref: null, error: "这张图处理失败，换一张试试" });
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ ref: null, error: "这张图处理失败，换一张试试" });
    };
    img.src = url;
  });
}

/* ── 动态壁纸声音（独立小开关，默认关；与壁纸文档同频发布变更） ── */

export function getVideoSound(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === "1";
  } catch {
    return false;
  }
}

export function setVideoSound(on: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, on ? "1" : "0");
  } catch {
    /* 存不进就本次有效 */
  }
  shellCacheKey = "";
  listeners.forEach((f) => f());
}

/** 声音开关快照（返回原始值 boolean，引用天然稳定，供 useSyncExternalStore 用） */
export function videoSoundSnapshot(): boolean {
  return getVideoSound();
}
