/** 插件 ↔ 应用桥：navigate/status 由应用侧（App.tsx 的 PluginBridge 组件）每帧回填。
 *  插件门面只读这里——不 import React 状态，避免与 app 状态机构成环。 */

/* eslint-disable @typescript-eslint/no-explicit-any */
let navFn: ((page: string, params?: Record<string, unknown>) => void) | null = null;
let statusFn: (() => string) | null = null;

export function setNavBridge(fn: (page: string, params?: Record<string, unknown>) => void): void {
  navFn = fn;
}
export function setStatusBridge(fn: () => string): void {
  statusFn = fn;
}
export function navGo(page: string, params?: Record<string, unknown>): boolean {
  if (!navFn) return false;
  navFn(page, params);
  return true;
}
export function sessionStatus(): string {
  return statusFn ? statusFn() : "unknown";
}
