/**
 * 侧栏一级导航序列（2026-09-06 用户需求：今日入口与一级收藏夹同待遇——
 * 可调上下序、可折叠隐藏）：
 * - 统一序列 = 页面（"p:<page>"）+ 根收藏夹（"f:<id>"）交错，localStorage
 *   onethu.nav.order.v1 持久化；今日不再钉死最上，设置仍钉底不参与序列；
 * - 归一化：失效条目剔除（收藏夹已删/未知键）、缺失条目按默认序追加
 *   （页面先按 NAV 序、收藏夹按 favs.order），渲染永不漏项；
 * - 收藏夹相对顺序以 favs.data.order（收藏夹页 上移/下移）为真源：order
 *   变化时把序列里的 f 条目按其相对序重投影（槽位保持）；侧栏编辑只调
 *   页面条目位置（可与收藏夹行交错），两条路互不覆盖。
 */

import type { Page } from "../state/app.js";

const KEY = "onethu.nav.order.v1";

export const pageKey = (p: Page): string => "p:" + p;
export const folderKey = (id: string): string => "f:" + id;

export function loadNavOrder(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function saveNavOrder(seq: string[]): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(seq));
  } catch {
    /* 隐私模式/配额：仅会话内生效 */
  }
}

/** 归一化：剔除失效、缺失按默认序追加（页面 NAV 序在前，收藏夹 favs.order 在后） */
export function normalizeNavOrder(seq: string[], pages: Page[], folderOrder: string[]): string[] {
  const valid = new Set<string>([...pages.map(pageKey), ...folderOrder.map(folderKey)]);
  const kept = seq.filter((e) => valid.has(e));
  const missing = [...pages.map(pageKey), ...folderOrder.map(folderKey)].filter((e) => !kept.includes(e));
  return [...kept, ...missing];
}

/** 收藏夹相对序重投影：序列里 f 条目的相对顺序改成 folderOrder（槽位保持）。
 *  前置条件：seq 已归一化（f 条目数 = folderOrder 数，否则原样返回）。 */
export function restabilizeFolders(seq: string[], folderOrder: string[]): string[] {
  const slots: number[] = [];
  seq.forEach((e, i) => {
    if (e.startsWith("f:")) slots.push(i);
  });
  const want = folderOrder.map(folderKey).filter((k) => seq.includes(k));
  if (slots.length !== want.length) return seq;
  const out = [...seq];
  want.forEach((k, i) => {
    out[slots[i]!] = k;
  });
  return out;
}
