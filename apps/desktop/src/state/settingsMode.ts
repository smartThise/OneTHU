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

export function useAdvancedMode(): boolean {
  return useSyncExternalStore(subscribeSettingsMode, isAdvancedMode, () => false);
}
