/**
 * 界面偏好（本机持久化；与收藏、主题各存各的，互不影响）。
 * 目前一项：PC 侧边栏折叠态（§2.8.1「折叠后 72px 图标态」）。
 */
import { useEffect, useState } from "react";

const SIDEBAR_KEY = "onethu.sidebar.collapsed.v1";

export function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

export function useSidebarCollapsed(): [boolean, (v: boolean) => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => readSidebarCollapsed());
  useEffect(() => {
    const onStorage = (e: StorageEvent): void => {
      if (e.key === SIDEBAR_KEY) setCollapsed(readSidebarCollapsed());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const set = (v: boolean): void => {
    try {
      localStorage.setItem(SIDEBAR_KEY, v ? "1" : "0");
    } catch {
      /* 隐私模式/配额失败：本机偏好丢了不影响功能 */
    }
    setCollapsed(v);
  };
  return [collapsed, set];
}
