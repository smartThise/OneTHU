/**
 * 全量搜索的组合层（§2.2 / §2.8.4）：功能（注册表）+ 原子（页面/实体/在线服务）+ 设置页签。
 *
 * 为什么单独一层：服务页的顶部搜索结果与 PC 的命令面板**必须是同一份结果**——
 * 两处各写一套，迟早出现「面板搜得到、服务页搜不到」或者反过来（ADR 第 6 条防的就是这个）。
 * 这里只做组合；匹配实现仍在 navigation.ts（matchNavQuery）与 atoms.tsx（searchAtoms）。
 */
import { searchAtoms, type AtomHit } from "./atoms.js";
import { matchNavQuery, type NavEntry } from "./navigation.js";
import { ADVANCED_SETTINGS_TABS, SETTINGS_TAB_ORDER, isAdvancedMode } from "./settingsMode.js";

export interface SearchAllResult {
  /** 注册表命中（功能） */
  entries: NavEntry[];
  /** 原子命中（页面 / 实体 / 在线服务），已与注册表去重 */
  atoms: AtomHit[];
  /** 设置页签命中 */
  tabs: string[];
}

export function searchAll(q: string, limit = 14): SearchAllResult {
  const query = q.trim();
  const entries = matchNavQuery(query);
  // 与导航命中去重：页面/组件原子已在注册表里的不再重复出
  const navIds = new Set(entries.map((e) => e.id));
  const atoms = searchAtoms(query, limit).filter(
    (a) => !((a.kind === "page" || a.kind === "widget") && navIds.has(a.key)),
  );
  const standard = SETTINGS_TAB_ORDER.filter((t) => isAdvancedMode() || !ADVANCED_SETTINGS_TABS.includes(t));
  const tabs = query ? standard.filter((t) => t.includes(query)) : [];
  return { entries, atoms, tabs };
}
