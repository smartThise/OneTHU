/**
 * 设置分层（§4.4）：标准模式 / 高级模式。
 *
 * 标准模式（默认）只留日常项：账号与绑定、通知与提醒、外观与布局、数据与同步、下载与存储、关于。
 * 高级模式（设置 → 关于 → 高级模式开关）才露出插件系统等进阶设置。
 *
 * 这是**可见性**分层，不是功能删减：能力都在，只是默认不摆在一个普通用户面前。
 * 存 localStorage，订阅让侧栏与设置页签同步收放。
 */
import { useSyncExternalStore } from "react";

/** 设置页签的**唯一清单**（顺序即展示顺序）：设置页、命令面板、护栏都取这一份。
 *  放在 state 层而不是 Settings.tsx：命令面板要用它，而 state 不该反向依赖 pages。 */
export const SETTINGS_TAB_ORDER = ["账号", "通知与提醒", "外观与布局", "数据与同步", "下载与存储", "帮助", "插件", "关于"];

/** 只有高级模式才露出的页签（可见性分层，不是功能删减，§4.4）。
 *  2026-10-09 用户拍板：插件升回一级菜单（侧栏），此处不再隐藏任何页签。 */
export const ADVANCED_SETTINGS_TABS: string[] = [];

const KEY = "onethu.settings.advanced";

const listeners = new Set<() => void>();

export function isAdvancedMode(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setAdvancedMode(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* 存不进去也要让界面响应（本次会话内生效） */
  }
  for (const f of listeners) f();
}

export function subscribeSettingsMode(f: () => void): () => void {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

/**
 * 请求切到某个设置页签（页面外的入口用：插件页从侧栏撤掉后，
 * 旧链接与外部跳转都要落到「设置 → 插件」而不是设置页第一栏）。
 * 与外部作业源那条消费请求同形：写下 → 设置页挂载时取走。
 */
let pendingTab: string | null = null;

export function requestSettingsTab(tab: string): void {
  pendingTab = tab;
}

export function consumeSettingsTabRequest(): string | null {
  const t = pendingTab;
  pendingTab = null;
  return t;
}

export function useAdvancedMode(): boolean {
  return useSyncExternalStore(subscribeSettingsMode, isAdvancedMode, () => false);
}
