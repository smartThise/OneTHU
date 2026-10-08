/**
 * 原子图标 → 原生可画的 PNG（data URL）。
 *
 * 小组件进程里没有 WebView，插件的 SVG 图标与宿主 React 图标在那里都不存在；原生能画的
 * 只有 Bitmap，因此图标必须在**应用前台**栅格化后随快照推过去：
 *   渲染 React 图标 → 序列化成 SVG 串 → 交给 <img> → canvas 出 PNG。
 *
 * 结果按「原子 + 尺寸」缓存（内存 + localStorage）：一次前台刷新不该为同一批图标反复
 * 栅格化，重启后也不必重来。任何一步失败都返回 null——原生退回系统默认图标，绝不因为
 * 一个图标把整块小组件弄成空白。
 */
import { createElement, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { AtomRef } from "./favorites.js";

const CACHE_KEY = "onethu.widget.icons.v1";
/** 持久化上限：图标很小（几 KB），但 localStorage 有配额，超了就只留内存 */
const CACHE_MAX = 80;

const memo = new Map<string, string | null>();
let persistedLoaded = false;
let persisted: Record<string, string> = {};

function loadPersisted(): void {
  if (persistedLoaded) return;
  persistedLoaded = true;
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as Record<string, string> | null;
    if (raw && typeof raw === "object") persisted = raw;
  } catch {
    persisted = {};
  }
}

function putPersisted(key: string, dataUrl: string): void {
  loadPersisted();
  persisted[key] = dataUrl;
  const keys = Object.keys(persisted);
  if (keys.length > CACHE_MAX) for (const k of keys.slice(0, keys.length - CACHE_MAX)) delete persisted[k];
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(persisted));
  } catch {
    /* 配额满：内存缓存照常工作 */
  }
}

function client(): typeof import("react-dom/client") | null {
  return typeof document === "undefined" ? null : { createRoot } as typeof import("react-dom/client");
}

/** 原子图标的 PNG data URL；解析不出图标或环境不支持时返回 null */
export async function atomIconPng(ref: AtomRef, size = 96): Promise<string | null> {
  const key = `${ref.kind}:${ref.key}@${size}`;
  if (memo.has(key)) return memo.get(key) ?? null;
  loadPersisted();
  if (persisted[key]) {
    memo.set(key, persisted[key]!);
    return persisted[key]!;
  }
  if (!client()) return null;

  // 动态引：原子注册表带着整套组件（.tsx），这里只在实际栅格化时才需要它
  const { resolveAtom } = await import("./atoms.js");
  const view = resolveAtom(ref);
  if (!view) {
    memo.set(key, null);
    return null;
  }

  let host: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;
  try {
    host = document.createElement("div");
    // 固定深色描边：小组件背景是浅色的，图标在深色应用主题下若沿用 currentColor 会看不见
    host.setAttribute("style", "position:fixed;left:-9999px;top:0;color:#0F1115;pointer-events:none");  /* token-ok: 小组件图标离屏光栅化：固定深描边（小组件背景恒浅） */
    document.body.appendChild(host);
    root = createRoot(host);
    const Icon = view.icon as ComponentType<{ width?: number; height?: number }>;
    // flushSync：图标必须在这一刻就渲染出 DOM，不能等 React 的调度
    flushSync(() => root?.render(createElement(Icon, { width: size, height: size })));
    const svg = host.querySelector("svg");
    if (!svg) return null;
    const svgText = new XMLSerializer().serializeToString(svg);
    const png = await rasterize(svgText, size);
    memo.set(key, png);
    if (png) putPersisted(key, png);
    return png;
  } catch {
    memo.set(key, null);
    return null;
  } finally {
    try {
      root?.unmount();
      host?.remove();
    } catch {
      /* 清理失败无妨：容器在屏幕外 */
    }
  }
}

/** SVG 串 → canvas → PNG data URL */
function rasterize(svgText: string, size: number): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          if (!ctx) return resolve(null);
          ctx.drawImage(img, 0, 0, size, size);
          resolve(canvas.toDataURL("image/png"));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
    } catch {
      resolve(null);
    }
  });
}

/** 调试/测试用：清空缓存 */
export function __clearWidgetIconCache(): void {
  memo.clear();
  persisted = {};
  persistedLoaded = true;
}
