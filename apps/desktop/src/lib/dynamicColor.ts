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
import { activateTheme } from "../state/theme.js";

const PREF_KEY = "onethu.dynamicColor";
const STYLE_ID = "onethu-dynamic-color";
/** 取色不可用时的降级主题（§3.4 降级链：系统取色 → 清华紫） */
export const DYNAMIC_FALLBACK_THEME = "onethu.theme.tsinghua";

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

/** 把映射结果注入文档并打开开关（纯 DOM，可重复调用=切主题后重注入） */
export function applyDynamicColor(palette: DynamicPalette): void {
  const roles = rolesFromPalette(palette);
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = render(roles);
  document.documentElement.dataset.dynamic = "on";
  // 亮暗两套都在上面注入了，但 <html> 的 colorScheme 由主题引擎负责——
  // 取色生效时按系统亮暗走（跟随系统），避免"暗色壁纸配亮色表单控件"。
  document.documentElement.style.colorScheme = prefersDark() ? "dark" : "light";
}

export function clearDynamicColor(): void {
  delete document.documentElement.dataset.dynamic;
  document.getElementById(STYLE_ID)?.remove();
}

const prefersDark = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;

export const isDynamicEnabled = readPref;

/** 打开开关：取色成功返回 true；不可用则清场并降级到清华紫主题，返回 false */
export async function enableDynamicColor(): Promise<boolean> {
  const palette = await fetchSystemPalette();
  if (!palette || Object.keys(palette).length === 0) {
    clearDynamicColor();
    writePref(false);
    activateTheme(DYNAMIC_FALLBACK_THEME);
    return false;
  }
  applyDynamicColor(palette);
  writePref(true);
  return true;
}

export function disableDynamicColor(): void {
  clearDynamicColor();
  writePref(false);
}

/** 开机自举：上次开着就重开（取色失败自动降级，不会留半套配色） */
export function initDynamicColor(): void {
  if (readPref()) void enableDynamicColor();
}

/** 系统亮暗变化时重注入（只改 colorScheme；亮暗两套角色已在同一份样式里） */
export function watchDynamicColor(): () => void {
  if (typeof matchMedia !== "function") return () => undefined;
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const onChange = (): void => {
    if (document.documentElement.dataset.dynamic === "on") {
      document.documentElement.style.colorScheme = mq.matches ? "dark" : "light";
    }
  };
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
