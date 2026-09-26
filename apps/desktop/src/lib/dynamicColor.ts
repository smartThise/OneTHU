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
import {
  activateTheme,
  activeThemeId,
  deactivateTheme,
  hasTheme,
  reapplyActiveTheme,
} from "../state/theme.js";

const PREF_KEY = "onethu.dynamicColor";
/** 开启取色时被顶掉的主题，关掉时还给用户 */
const RESTORE_KEY = "onethu.dynamicColor.restore";
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
const readRestore = (): string | null => {
  try {
    return localStorage.getItem(RESTORE_KEY);
  } catch {
    return null;
  }
};
const writeRestore = (id: string | null): void => {
  try {
    if (id) localStorage.setItem(RESTORE_KEY, id);
    else localStorage.removeItem(RESTORE_KEY);
  } catch {
    /* 同上 */
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
  // 亮/暗两套角色都在上面注入了，选哪一套看 data-scheme——取色期间按系统亮暗走。
  syncScheme();
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

/** 打开开关：取色成功返回 true；不可用则清场并降级到清华紫主题，返回 false */
export async function enableDynamicColor(): Promise<boolean> {
  const palette = await fetchSystemPalette();
  if (!palette || Object.keys(palette).length === 0) {
    clearDynamicColor();
    writePref(false);
    activateTheme(DYNAMIC_FALLBACK_THEME);
    return false;
  }
  /* 主题必须让位：主题注入的 :root[data-theme] 块（特异度 0,2,0）自己声明了 --accent/--bg 这些
     兼容变量，而取色只改 System 角色——两者并存会得到"半套取色"（面跟随壁纸、强调色还是主题的）。
     真机验证时就是这样：--md-sys-color-surface 变了，--accent 还是凝夜的蓝。 */
  /* 只在"用户主动开启"时快照：开机自举时主题已被上一轮让位（activeThemeId() 为 null），
     若在这里覆盖快照就会把用户真正选的主题弄丢（真机残留过一次 restore=violet 配 pref=0，
     那种状态再关掉会把"跟随昼夜"的用户错误地拉到 violet）。 */
  if (!readPref()) writeRestore(activeThemeId());
  deactivateTheme();
  applyDynamicColor(palette);
  writePref(true);
  return true;
}

export function disableDynamicColor(): void {
  clearDynamicColor();
  writePref(false);
  const prev = readRestore();
  writeRestore(null);
  if (prev && hasTheme(prev)) activateTheme(prev);
  // 没有可恢复的手动主题时，把昼夜调度（或"基础令牌"）的状态接回来
  else reapplyActiveTheme();
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
    if (document.documentElement.dataset.dynamic === "on") syncScheme();
  };
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
