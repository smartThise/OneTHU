/**
 * 动态取色（§3.4）——原生取色 + 注入 + 降级链。
 *
 * 链路：Android 12+ 读系统 Material You 调色板（onethu-mobile 插件）
 *   → rolesFromPalette 映射成 System 角色 → 写进 <style id="onethu-dynamic-color">
 *   → 全部 Compat 变量自动跟随（Compat 层引用的就是这些 System 角色）。
 * 不可用时（桌面 / Android < 12 / ROM 裁掉调色板）降级到「清华紫」主题。
 *
 * 注入选择器用 html:root[data-dynamic="on"]，特异性 (0,2,1) —— 高于令牌的 :root (0,1,0)、
 * 暗色套 (0,2,0) 与主题注入 (0,2,0)，所以取色生效时不被任何一方翻掉；关掉开关即整体移除。
 */
import { invoke } from "@tauri-apps/api/core";
import { rolesFromPalette, type DynamicPalette, type DynamicRoles } from "./dynamicRoles.js";
import { fetchWallpaperPalette } from "./wallpaperPalette.js";
import { dynamicPlan, paletteUsable } from "./dynamicPlan.js";
import {
  activateTheme,
  activeThemeId,
  setFallbackTheme,
  detachAppliedTheme,
  hasTheme,
  reapplyActiveTheme,
} from "../state/theme.js";
import { subscribeWallpaper, wallpaperSnapshot } from "../state/wallpaper.js";

const PREF_KEY = "onethu.dynamicColor";
/** 智能取色来源：system = 系统 Material You；wallpaper = OneTHU 当前壁纸。 */
export type DynamicSource = "system" | "wallpaper";
const SOURCE_KEY = "onethu.dynamicColor.source";
/** 开启取色时被顶掉的外观状态，关掉时还给用户。
 *  存 JSON：必须能表达"用户当时没选主题（基础令牌）"，不能与"没记过快照"混为一谈。 */
const RESTORE_KEY = "onethu.dynamicColor.restore";
const STYLE_ID = "onethu-dynamic-color";
/** 取色不可用时的降级主题（§3.4 降级链：系统取色 → 清华紫） */
export const DYNAMIC_FALLBACK_THEME = "onethu.theme.tsinghua";

const readSource = (): DynamicSource => {
  try {
    return localStorage.getItem(SOURCE_KEY) === "wallpaper" ? "wallpaper" : "system";
  } catch {
    return "system";
  }
};
const writeSource = (source: DynamicSource): void => {
  try {
    localStorage.setItem(SOURCE_KEY, source);
  } catch {
    /* 隐私模式：本次会话仍按已有选择运行 */
  }
};

const readPref = (): boolean => {
  try {
    return localStorage.getItem(PREF_KEY) === "1";
  } catch {
    return false;
  }
};
const writePref = (on: boolean): void => {
  try {
    localStorage.setItem(PREF_KEY, on ? "1" : "0");
  } catch {
    /* 隐私模式下 localStorage 不可用：本次会话仍然生效 */
  }
};
interface RestoreSnapshot {
  /** 用户手动选中的主题；null = 当时是"基础令牌（默认外观）" */
  activeId: string | null;
}
const readRestore = (): RestoreSnapshot | null => {
  try {
    const raw = localStorage.getItem(RESTORE_KEY);
    if (!raw) return null;
    // 旧格式是裸 id 字符串：继续认，避免升级后把老用户的主题弄丢
    if (!raw.startsWith("{")) return { activeId: raw };
    const p = JSON.parse(raw) as { activeId?: unknown };
    return { activeId: typeof p?.activeId === "string" ? p.activeId : null };
  } catch {
    return null;
  }
};
const writeRestore = (snap: RestoreSnapshot | null): void => {
  try {
    if (snap) localStorage.setItem(RESTORE_KEY, JSON.stringify(snap));
    else localStorage.removeItem(RESTORE_KEY);
  } catch {
    /* 同上 */
  }
};

export const dynamicSource = readSource;

/** 切换取色来源；若智能取色正开着，立即按新来源重算。 */
export function setDynamicSource(source: DynamicSource): void {
  writeSource(source);
  if (isDynamicEnabled()) void enableDynamicColor(source);
}

/** 读系统调色板：任何失败（桌面没有这条命令、旧机型、插件异常）都当作"不可用" */
export async function fetchSystemPalette(): Promise<DynamicPalette | null> {
  try {
    const p = await invoke<DynamicPalette | null>("dynamic_color");
    return p && typeof p === "object" ? p : null;
  } catch {
    return null;
  }
}

const render = (roles: DynamicRoles): string => {
  const decl = (bag: Record<string, string>): string =>
    Object.entries(bag)
      .map(([k, v]) => k + ": " + v + ";")
      .join(" ");
  return (
    "html:root[data-dynamic=\"on\"] { " + decl(roles.light) + " }\n" +
    "html:root[data-dynamic=\"on\"][data-scheme=\"dark\"] { " + decl(roles.dark) + " }\n"
  );
};

/** 结构描边固定中性：智能取色的 palette 会把 outline 染成壁纸色，
 *  结果设置面板/卡片出现一圈“主题色外描边”。强调色用于按钮和选中态，
 *  边框/分隔线必须是中性灰，避免整页被描边包住。 */
function neutralizeOutlines(roles: DynamicRoles): void {
  const pairs: Array<[Record<string, string>, string, string, string, string]> = [
    [roles.light, "#7a7a7a", "rgba(0, 0, 0, 0.10)", "rgba(0, 0, 0, 0.05)", "rgba(0, 0, 0, 0.18)"],
    /* 暗色不能沿用亮色描边的实色明度：深底上 #9a9a9a 会变成一圈突兀的白边。
       改用低透明度白叠色，和默认暗色 line 角色同一数量级。 */
    /* 暗色下结构描边直接透明：智能取色的深色界面靠面阶/阴影分层，
       保留任何白线都会被解读为“主题色外描边”。 */
    [roles.dark, "rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"],
  ];
  for (const [bag, outline, variant, soft, strong] of pairs) {
    bag["--md-sys-color-outline"] = outline;
    bag["--md-sys-color-outline-variant"] = variant;
    bag["--md-sys-color-outline-soft"] = soft;
    bag["--md-sys-color-outline-strong"] = strong;
  }
}

/** 把映射结果注入文档并打开开关（纯 DOM，可重复调用=切主题后重注入） */
export function applyDynamicColor(palette: DynamicPalette): void {
  const roles = rolesFromPalette(palette);
  neutralizeOutlines(roles);
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = render(roles);
  document.documentElement.dataset.dynamic = "on";
  // 亮/暗两套角色都在上面注入了，选哪一套看 data-scheme——取色期间按系统亮暗走。
  syncScheme();
  window.dispatchEvent(new Event("onethu:dynamic-palette"));
}

export function clearDynamicColor(): void {
  delete document.documentElement.dataset.dynamic;
  document.getElementById(STYLE_ID)?.remove();
}

const prefersDark = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;

/** 取色生效期间由取色自己驱动 §3.3 的暗色套开关：主题已让位，没人再设 data-scheme 了 */
const syncScheme = (): void => {
  const root = document.documentElement;
  if (prefersDark()) root.dataset.scheme = "dark";
  else delete root.dataset.scheme;
  root.style.colorScheme = prefersDark() ? "dark" : "light";
};

export const isDynamicEnabled = readPref;

/** 打开开关。取到调色板就注入角色；取不到就降级到「清华紫」主题。两种情况下开关都是"开"。*/
export async function enableDynamicColor(source: DynamicSource = readSource()): Promise<void> {
  writeSource(source);
  let palette = source === "wallpaper" ? await fetchWallpaperPalette() : await fetchSystemPalette();
  if (source === "wallpaper" && !paletteUsable(palette)) {
    /* 壁纸没有可用彩色（纯灰/解码失败/没壁纸）时退回系统取色；系统也没有才降级主题。 */
    palette = await fetchSystemPalette();
  }
  const usable = paletteUsable(palette);
  const plan = dynamicPlan(usable, readPref(), activeThemeId());
  if (plan.restore.action === "set") writeRestore({ activeId: plan.restore.activeId });
  /* 主题必须让位：主题注入的 :root[data-theme] 块（特异度 0,2,0）自己声明了 --accent/--bg 这些
     兼容变量，而取色只改 System 角色——两者并存会得到"半套取色"（面跟随壁纸、强调色还是主题的）。
     真机验证时就是这样：--md-sys-color-surface 变了，--accent 还是凝夜的蓝。 */
  /* 用 detachAppliedTheme 而不是 deactivateTheme：后者会顺手把 followSystem 关掉，
     跟随昼夜的用户一旦开关取色，调度就被永久清空（关掉取色后主题不回来）。 */
  detachAppliedTheme();
  if (plan.mode === "palette" && palette) {
    applyDynamicColor(palette);
  } else {
    clearDynamicColor();
    /* 视觉应用降级主题，但**不改用户选择**：activateTheme 会把 activeId 占成清华紫、
       还会把跟随昼夜关掉，关掉开关后就回不到用户原来的调度（用户实录「要手动再选一次」）。 */
    setFallbackTheme(DYNAMIC_FALLBACK_THEME);
  }
  writePref(true);
}

export function disableDynamicColor(): void {
  clearDynamicColor();
  writePref(false);
  const prev = readRestore();
  writeRestore(null);
  if (!prev) {
    // 没记过快照（开机自举）：把昼夜调度（或"基础令牌"）的状态接回来
    reapplyActiveTheme();
    return;
  }
  /* 如实恢复"手动选中的主题"，**包括 null（基础令牌）**：
     早期版本只在 id 非空时恢复，于是"基础令牌 + 取色降级到清华紫"这条路上，
     activeId 被降级主题占住，关掉开关就停在清华紫不动（用户看到的"要手动再选一次才刷新"）。 */
  if (prev.activeId && hasTheme(prev.activeId)) activateTheme(prev.activeId);
  else detachAppliedTheme();
  // 跟随昼夜生效时把调度接回来；也兜住 applyTheme 的任何早退
  reapplyActiveTheme();
}

/** 开机自举：上次开着就重开（取不到调色板会自动降级到清华紫，不会留半套配色） */
export function initDynamicColor(): void {
  if (readPref()) void enableDynamicColor();
}

/** 系统亮暗变化时重注入（只改 colorScheme；亮暗两套角色已在同一份样式里） */
export function watchDynamicColor(): () => void {
  const offs: Array<() => void> = [];
  let lastWallpaper = wallpaperSnapshot()?.global ?? null;
  if (typeof matchMedia === "function") {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => {
      if (document.documentElement.dataset.dynamic === "on") syncScheme();
    };
    mq.addEventListener("change", onChange);
    offs.push(() => mq.removeEventListener("change", onChange));
  }
  /* 壁纸取色源：换壁纸后重算；同一 ref 的亮度/主题更新不重复取像素。 */
  offs.push(subscribeWallpaper(() => {
    const next = wallpaperSnapshot()?.global ?? null;
    if (next === lastWallpaper) return;
    lastWallpaper = next;
    if (isDynamicEnabled() && readSource() === "wallpaper") void enableDynamicColor("wallpaper");
  }));
  return () => { for (const off of offs) off(); };
}
