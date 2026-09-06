/**
 * 侧栏一级导航序列（2026-09-06 用户需求：今日入口与一级收藏夹同待遇——
 * 可调上下序、可隐藏）。纯函数层；序列本体存 FavsData.navOrder（favs 存储
 * 随 saveFavs 落盘），交互入口两处：
 * - 页面页头 上移/下移（今日页先行，收藏夹页同款交互）——moveNavPage；
 * - 收藏夹相对序真源 = 收藏夹页 上移/下移（moveRoot 改 favs.order），
 *   navSeqOf 每次渲染把 f 条目按其相对序重投影（槽位保持），两条路互不覆盖。
 * 交互铁律：SSR/首帧无 effect，视图必须渲染期就地归一化（navSeqOf 纯函数）。
 */

import type { Page } from "../state/app.js";

/** 一级页面默认序（Layout NAV 的 page 集；标签/图标仍归 Layout NAV） */
export const NAV_PAGES: Page[] = ["today", "learn", "schedule", "info", "life", "reserve", "zhjwxk", "otherinfo"];

const pageKey = (p: Page): string => "p:" + p;
const folderKey = (id: string): string => "f:" + id;

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
