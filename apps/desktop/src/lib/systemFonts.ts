/**
 * 系统字体读取（给 PDF 文本抽取做"字形轮廓指纹"匹配用）。
 *
 * 背景：部分 pdfTeX/LaTeX 导出的中文 PDF 只嵌入了字体子集，但**没有 /ToUnicode**，
 * 字体里的 cmap 又是符号编码（0xF000+code → GID），任何阅读器都无法直接得到 Unicode
 * （pdftotext 也只是乱码）。这类 PDF 的"字"只存在于字形轮廓里。若系统装有同一款字体
 * （如 Windows 的楷体 simkai.ttf），把嵌入字形与系统字体的字形做轮廓指纹比对，就能
 * 精确还原 Unicode。
 *
 * 边界：
 *   - 只读**白名单路径**（Windows/macOS 常见字体），不接受任意路径；
 *   - 只读，不写系统目录；文件上限 26MB，返回 base64 由调用方解码；
 *   - 平台无关的候选列表：找不到就返回 null，插件按"无法还原"降级；
 *   - 结果按字体族缓存，避免同一文档重复读 10MB+ 文件。
 */
import { invoke } from "@tauri-apps/api/core";

export type SystemFontFamily = "kaiti" | "simsun" | "simhei" | "fangsong" | "yahei";

export interface SystemFontResult {
  family: SystemFontFamily;
  /** 实际命中的白名单路径 */
  path: string;
  /** 字体文件 base64（单文件上限 26MB） */
  b64: string;
}

const SYSTEM_FONT_MAX_BYTES = 26 * 1024 * 1024;

/** 字体族归一化：接受 "KaiTi" / "楷体" / "STKaiti" / "ABCDEF+KaiTi" 等写法。 */
export function normalizeSystemFontFamily(raw: string): SystemFontFamily | null {
  const name = String(raw ?? "").toLowerCase().replace(/^[a-z]{6}\+/, "").replace(/\s+/g, "");
  if (!name) return null;
  if (/kaiti|楷体|楷/.test(name)) return "kaiti";
  if (/simsun|songti|宋体|宋/.test(name)) return "simsun";
  if (/simhei|heiti|黑体|黑/.test(name)) return "simhei";
  if (/fangsong|仿宋/.test(name)) return "fangsong";
  if (/yahei|雅黑|msyh/.test(name)) return "yahei";
  return null;
}

/** 白名单候选路径（按优先级）。路径均为系统自带字体，不读用户目录。 */
const SYSTEM_FONT_CANDIDATES: Record<SystemFontFamily, string[]> = {
  kaiti: [
    "C:/Windows/Fonts/simkai.ttf",
    "C:/Windows/Fonts/STKAITI.TTF",
    "/System/Library/Fonts/Supplemental/Kaiti.ttc",
    "/System/Library/Fonts/STKaiti.ttf",
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
  ],
  simsun: [
    "C:/Windows/Fonts/simsun.ttc",
    "/System/Library/Fonts/Supplemental/Songti.ttc",
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
  ],
  simhei: [
    "C:/Windows/Fonts/simhei.ttf",
    "/System/Library/Fonts/Supplemental/Heiti.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  ],
  fangsong: ["C:/Windows/Fonts/simfang.ttf", "/System/Library/Fonts/Supplemental/FangSong.ttf"],
  yahei: ["C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/msyhbd.ttc"],
};

/** 纯函数：给字体族列出白名单候选（便于 node 护栏直接测）。 */
export function systemFontCandidates(family: string): string[] {
  const key = normalizeSystemFontFamily(family);
  return key ? [...SYSTEM_FONT_CANDIDATES[key]] : [];
}

const cache = new Map<SystemFontFamily, SystemFontResult | null>();

/**
 * 读取系统字体文件；找不到/读失败返回 null（不抛错，调用方降级）。
 * 结果按字体族缓存（含 null，避免反复探测不存在的字体）。
 */
export async function readSystemFont(family: string): Promise<SystemFontResult | null> {
  const key = normalizeSystemFontFamily(family);
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;
  for (const path of SYSTEM_FONT_CANDIDATES[key]) {
    try {
      const b64 = await invoke<string>("read_file_base64", { path, maxBytes: SYSTEM_FONT_MAX_BYTES });
      if (typeof b64 === "string" && b64.length > 0) {
        const result: SystemFontResult = { family: key, path, b64 };
        cache.set(key, result);
        return result;
      }
    } catch {
      /* 该路径不存在/不可读：继续下一个候选 */
    }
  }
  cache.set(key, null);
  return null;
}
