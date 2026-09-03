/**
 * 应用图标（设置 → 主题）：运行时切换主窗口/任务栏图标。
 *
 * 选择持久化在 localStorage（onethu.app-icon.v1），启动时静默恢复；
 * 实际换图标走 Rust 命令 set_app_icon（图标 PNG 内嵌在二进制里，
 * 此处 import 仅作选择器预览展示——单一图源，两处共用同一文件）。
 * 自定义图标（"+"上传）经画布规整为 256×256 PNG，base64 存 Rust 状态文件
 * （WKWebView 的 localStorage 会被系统驱逐，状态文件才是可靠层），
 * 应用时走 set_app_icon_custom。Android 桌面图标需编译期预置 alias，
 * 自定义图标仅桌面端支持。非 Tauri 环境（浏览器预览）只记录选择、不 invoke。
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./transport.js";
import { logLine } from "./clients.js";

const KEY = "onethu.app-icon.v1";
const STATE_NAME = "onethu.app-icon.custom";
export const CUSTOM_ICON_ID = "custom";

/** 缩略图直接引用 src-tauri/icons 下的同一 PNG（Vite 构建期内联） */
import iconOnethu from "../../src-tauri/icons/icon.png";
import iconThuinfo from "../../src-tauri/icons/icon-thuinfo.png";

export interface AppIconOption {
  id: string;
  label: string;
  src: string;
}

/** 内置图标注册表：新增图标 = icons/ 放 PNG + Rust match 加一行 + 这里加一行 */
export const APP_ICON_OPTIONS: AppIconOption[] = [
  { id: "onethu", label: "OneTHU 默认", src: iconOnethu },
  { id: "thuinfo", label: "THU Info", src: iconThuinfo },
];

export function loadAppIconId(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v && (v === CUSTOM_ICON_ID || APP_ICON_OPTIONS.some((o) => o.id === v))) return v;
  } catch {
    /* 隐私模式等读取失败按默认 */
  }
  return "onethu";
}

/** 应用图标（即时生效）；persistent=false 供启动恢复时不落盘 */
export async function applyAppIcon(id: string, persistent = true): Promise<void> {
  const known = id === CUSTOM_ICON_ID || APP_ICON_OPTIONS.some((o) => o.id === id);
  if (!known) return;
  if (persistent) {
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* 忽略 */
    }
  }
  if (!isTauri) return;
  try {
    if (id === CUSTOM_ICON_ID) {
      const b64 = await loadCustomIconB64();
      if (b64) await invoke("set_app_icon_custom", { pngB64: b64 });
    } else {
      await invoke("set_app_icon", { name: id });
    }
  } catch (err) {
    void logLine(`PAGE-ERR APP-ICON ${err instanceof Error ? err.message : String(err)}`).catch(
      () => undefined,
    );
  }
}

/** 读回已保存的自定义图标（base64 PNG，无则 null） */
export async function loadCustomIconB64(): Promise<string | null> {
  if (!isTauri) return null;
  try {
    const v = await invoke<string | null>("state_read", { name: STATE_NAME });
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

/** 图片文件 → 居中裁方 → 256×256 PNG dataURL（base64 部分） */
async function fileToPngB64(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("图片解码失败，请换一张 PNG/JPG"));
      el.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    const SIZE = 256; // 任务栏图标足够；过大只会浪费状态文件体积
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("画布初始化失败");
    ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
    const dataUrl = canvas.toDataURL("image/png");
    const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    if (b64.length > 512 * 1024) throw new Error("图片处理后仍过大，请换一张");
    return b64;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 上传自定义图标：规整 → 持久化（状态文件）→ 应用并记录选择 */
export async function saveCustomIcon(file: File): Promise<void> {
  const b64 = await fileToPngB64(file);
  if (isTauri) await invoke("state_write", { name: STATE_NAME, content: b64 });
  await applyAppIcon(CUSTOM_ICON_ID);
}

/** 移除自定义图标：删状态文件；若当前正用在用它则回退默认 */
export async function removeCustomIcon(): Promise<void> {
  if (isTauri) {
    try {
      await invoke("state_delete", { name: STATE_NAME });
    } catch {
      /* 文件不存在等，忽略 */
    }
  }
  if (loadAppIconId() === CUSTOM_ICON_ID) await applyAppIcon("onethu");
}
