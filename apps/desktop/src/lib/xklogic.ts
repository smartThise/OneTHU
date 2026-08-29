/**
 * nextthuxk v1.4.9 纯函数层移植（docs/nextthuxk-v149-display-state-spec.md §3/§4/§6）。
 * 全部为纯函数，供 useMemo 使用；语义与插件逐条对齐。
 */
import type { QueueCandidate, XkCourse, XkLevelTableRow, XkQueueInfo, XkSelectedRow, XkVolInfo } from "@onethu/core";
import { parseVolStr, ZY_LIMITS } from "@onethu/core";

export type XkFlag = "bx" | "xx" | "rx" | "ty";

/* ── §3.1 时间解析 ─────────────────────────────────────────── */
export interface TimeSlot { day: number; slot: number }
const DAY_NAMES = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
export const SLOT_NAMES = ["1-2节", "3-4节", "5-6节", "7-8节", "9-10节", "11-12节"];
const slotsCache = new Map<string, TimeSlot[]>();
export function parseTimeSlots(time: string): TimeSlot[] {
  if (!time) return [];
  const hit = slotsCache.get(time);
  if (hit) return hit;
  const out: TimeSlot[] = [];
  const re = /(\d+)\s*[-–—]\s*(\d+)\s*\([^)]*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(time)) !== null) {
    const day = parseInt(m[1]!), slot = parseInt(m[2]!);
    if (day >= 1 && day <= 7 && slot >= 1 && slot <= 6) out.push({ day, slot });
  }
  slotsCache.set(time, out);
  return out;
}
export const dayName = (d: number): string => DAY_NAMES[d] ?? "";

/* ── §4.4 课型与志愿名额 ────────────────────────────────────── */
export const typeCodeToFlag = (tc: string): XkFlag =>
  tc === "006" ? "bx" : tc === "008" ? "xx" : tc === "007" ? "rx" : tc === "ty" ? "ty" : "bx";
/** isSportsCourse（data.js 同语义） */
export const isSportsCourse = (c: { attr?: string; typeLabel?: string; typeCode?: string; department?: string; name?: string }): boolean =>
  (c.attr ?? "") === "体育" || c.typeLabel === "体育" || c.typeCode === "ty" ||
  (c.department ?? "").includes("体育") || (c.department ?? "").includes("体武") || (c.name ?? "").includes("体育");
/** courseFlag：attr 必修/限选/任选/体育 → flag，attr 空（不在培养方案）默认 rx */
export const courseFlagOf = (c: { attr?: string }): XkFlag =>
  (c.attr ?? "").trim() === "限选" ? "xx" : (c.attr ?? "").trim() === "任选" ? "rx"
    : (c.attr ?? "").trim() === "体育" ? "ty" : (c.attr ?? "").trim() === "必修" ? "bx" : "rx";
export const baseFlagOf = (c: { attr?: string; typeLabel?: string; typeCode?: string; department?: string; name?: string }): XkFlag =>
  isSportsCourse(c) ? "ty" : courseFlagOf(c);
export const zyTypeOf = baseFlagOf;
/** allowedFlags：ty→[ty]、bx→[bx,xx,rx]、xx→[xx,rx]、rx→[rx] */
export function allowedFlags(flag: XkFlag): XkFlag[] {
  if (flag === "ty") return ["ty"];
  if (flag === "bx") return ["bx", "xx", "rx"];
  if (flag === "xx") return ["xx", "rx"];
  return ["rx"];
}
export const FLAG_LABELS: Record<XkFlag, string> = { bx: "必修", xx: "限选", rx: "任选", ty: "体育" };

/* ── §6 概率模型 ────────────────────────────────────────────── */
export interface VolStrings { volRequired: string; volElective: string; volOptional: string; volSports: string }
export interface ProbResult { prob: number; label: string; percentLabel: string; ratioLabel: string; color: string; bg: string }
const P_GREEN = "#07c160", P_AMBER = "#ff9f1a", P_RED = "#ee4d4d", P_GRAY = "#9aa1ac";
export const probBg = (color: string): string => color + "22";

function probResult(rem: number, applicants: number): ProbResult {
  let prob: number, color: string;
  if (rem <= 0) { prob = 0; color = P_RED; }
  else if (applicants === 0) { prob = 1; color = P_GREEN; }
  else { prob = Math.min(1, rem / applicants); color = prob >= 0.8 ? P_GREEN : prob >= 0.5 ? P_AMBER : P_RED; }
  const r = Math.max(0, Math.round(rem)), a = Math.max(0, Math.round(applicants));
  return { prob, label: `${Math.round(prob * 100)}%`, percentLabel: `${Math.round(prob * 100)}%`, ratioLabel: `${r}/${a}`, color, bg: probBg(color) };
}

/** calcProb：体育独立级联；必/限/任全局级联（bx→xx→rx 依次扣满三志愿，rx 的 priority 为第 0 志愿） */
export function calcProb(
  cap: number, vol: VolStrings | undefined, flag: XkFlag, zy: number,
): ProbResult {
  if (!cap || !vol) return { prob: -1, label: "无数据", percentLabel: "", ratioLabel: "", color: P_GRAY, bg: probBg(P_GRAY) };
  if (flag === "ty") {
    const arr = parseVolStr(vol.volSports || "");
    if (!arr || arr.counts.length < 3) return { prob: -1, label: "无数据", percentLabel: "", ratioLabel: "", color: P_GRAY, bg: probBg(P_GRAY) };
    let rem = cap;
    for (let i = 0; i < zy - 1; i++) rem -= arr.counts[i] ?? 0;
    return probResult(rem, arr.counts[zy - 1] ?? 0);
  }
  const req = parseVolStr(vol.volRequired || "");
  const ele = parseVolStr(vol.volElective || "");
  const opt = parseVolStr(vol.volOptional || "");
  let rem = cap;
  const deductFull = (arr: ReturnType<typeof parseVolStr> | null): void => {
    if (!arr) return;
    for (let i = 0; i < 3; i++) rem -= arr.counts[i] ?? 0;
  };
  const deductTo = (arr: ReturnType<typeof parseVolStr> | null, uptoZy: number, hasPriority: boolean): void => {
    if (!arr) return;
    if (hasPriority) rem -= arr.prefix;
    for (let i = 0; i < uptoZy - 1; i++) rem -= arr.counts[i] ?? 0;
  };
  // 路过段全扣；rx 查询先扣 priority（第 0 志愿）再扣 zy-1 档
  if (flag !== "bx") deductFull(req);
  else { deductTo(req, zy, false); return probResult(rem, req?.counts[zy - 1] ?? 0); }
  if (flag !== "xx") deductFull(ele);
  else { deductTo(ele, zy, false); return probResult(rem, ele?.counts[zy - 1] ?? 0); }
  deductTo(opt, zy, true);
  return probResult(rem, opt?.counts[zy - 1] ?? 0);
}

/* ── §5 合并行实体 ──────────────────────────────────────────── */
export interface XkRow {
  key: string;
  c: XkCourse;
  vol?: XkVolInfo;
  q?: XkQueueInfo;
  sel?: XkSelectedRow;
  cand?: QueueCandidate;
  selected: boolean;
  isCandidate: boolean;
  available: boolean;
  flag: XkFlag;
  zy: number;
  time: string;
  name: string;
  teacher: string;
  credits: number;
  tongshiGroup: string;
  feature: string;
  grade: string;
  teacherId: string;
  note: string;
}
/* ── 一级课表先行管线（levelTable-first：最小行秒渲染 → 全量目录合并替换）──── */

/** sk 规范键（code_seq0 归一，与 buildRows 同一约定） */
const skKey = (code: string, seq: string): string => `${code}_${seq || "0"}`;

/** 一级课表 → 课型表（与 core parseXkLevelTypes 同语义：code_seq → typeCode） */
export function levelTypesOf(table: Record<string, XkLevelTableRow>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(table)) {
    if (v && typeof v === "object") out[k] = v.typeCode;
  }
  return out;
}

/**
 * 一级课表 → 最小目录行（代码+序号+课程名+类型/属性）。
 * teacher/credits 为列表页邻位尽力提取值，time 恒空（列表版式无时间列），
 * 余量未知 → partial 标记；buildRows 对缺 teacher/time 的行宽容（空串安全）。
 */
export function levelRowsToCatalog(table: Record<string, XkLevelTableRow>): XkCourse[] {
  const out: XkCourse[] = [];
  for (const [key, v] of Object.entries(table)) {
    if (!v || typeof v !== "object") continue;
    const i = key.indexOf("_");
    out.push({
      department: "",
      code: key.slice(0, i),
      seq: key.slice(i + 1) || "0",
      name: v.name ?? "",
      credits: v.credits ?? 0,
      teacher: v.teacher ?? "",
      teacherId: "",
      capacity: 0,
      remaining: 0,
      gradCapacity: 0,
      gradRemaining: 0,
      time: "",
      note: "",
      feature: "",
      grade: "",
      tongshiGroup: "",
      attr: v.attr || (v.typeCode === "ty" ? "体育" : ""),
      partial: true,
    });
  }
  return out;
}

/**
 * 全量目录到达后与一级课表按 sk(code,seq) 合并：
 * 命中行保留一级课表提供的 attr/类型信息（体育行 attr 空 → 按 typeCode 补"体育"）；
 * 一级课表有而全量目录没有的行（候补/特殊课）以最小行保留——类型信息不丢。
 */
export function mergeLevelIntoCatalog(catalog: XkCourse[], table: Record<string, XkLevelTableRow>): XkCourse[] {
  const entries = Object.entries(table).filter(([_, v]) => v && typeof v === "object");
  if (!entries.length) return catalog;
  const seen = new Set(catalog.map((c) => skKey(c.code, c.seq)));
  const merged = catalog.map((c) => {
    const v = table[skKey(c.code, c.seq)];
    if (!v) return c;
    return { ...c, attr: v.attr || (v.typeCode === "ty" ? "体育" : c.attr), partial: false };
  });
  const rest: Record<string, XkLevelTableRow> = {};
  for (const [k, v] of entries) if (!seen.has(k)) rest[k] = v;
  return [...merged, ...levelRowsToCatalog(rest)];
}

export function buildRows(
  catalog: XkCourse[], volMap: Record<string, XkVolInfo>, queueMap: Record<string, XkQueueInfo>,
  selected: XkSelectedRow[], candidates: QueueCandidate[], levelTypes: Record<string, string>,
): XkRow[] {
  // seq 归一：目录 seq 可为空串、已选/一级课表为 "0" —— 统一 code_seq0 键（时间未定假象的根源）
  const sk = (code: string, seq: string): string => `${code}_${seq || "0"}`;
  const selByKey = new Map<string, XkSelectedRow>(selected.map((s) => [sk(s.code, s.seq), s]));
  const candByCode = new Map(candidates.map((s) => [s.code, s] as const));
  const rows: XkRow[] = catalog.map((c) => {
    const key = sk(c.code, c.seq);
    const sel = selByKey.get(key);
    const cand = candByCode.get(c.code);
    const vol = volMap[key] ?? volMap[`${c.code}_${c.seq}`];
    const q = queueMap[key] ?? queueMap[`${c.code}_${c.seq}`];
    const typeCode = sel?.typeCode || levelTypes[key] || (cand ? "ty" : "");
    return {
      key, c, vol, q, sel, cand,
      selected: !!sel, isCandidate: !!cand,
      // 一级课表最小行（partial）余量未知：按"未知≠已满"宽容处理；全量目录合并后回归真实余量
      available: c.partial ? true : (c.remaining ?? 0) > 0,
      flag: typeCode ? typeCodeToFlag(typeCode) : baseFlagOf(c),
      zy: sel?.zy ?? 0,
      // 已选表时间列常为空/格式异常（"程序设计训练 时间未定"实锤）——解析不出槽位时回退目录时间
      time: sel?.time && parseTimeSlots(sel.time).length ? sel.time : c.time || sel?.time || "",
      name: sel?.name || c.name, teacher: sel?.teacher || c.teacher,
      credits: sel?.credits || c.credits, tongshiGroup: c.tongshiGroup, feature: c.feature, grade: c.grade,
      teacherId: c.teacherId, note: c.note,
    } satisfies XkRow;
  });
  // 已选/候补课不在目录（罕见）：补行
  const inCat = new Set(rows.map((r) => r.key));
  const catByCode = new Map(catalog.map((c) => [c.code, c] as const));
  for (const s of selected) {
    const key = sk(s.code, s.seq);
    if (inCat.has(key)) continue;
    const c0 = catByCode.get(s.code); // 同课号不同班：借用目录元数据（时间等）
    rows.push({
      key, c: { department: c0?.department ?? "", code: s.code, seq: s.seq || "0", name: s.name || c0?.name || "", credits: s.credits || c0?.credits || 0, teacher: s.teacher || c0?.teacher || "", teacherId: c0?.teacherId ?? "", capacity: c0?.capacity ?? 0, remaining: c0?.remaining ?? 0, gradCapacity: c0?.gradCapacity ?? 0, gradRemaining: c0?.gradRemaining ?? 0, time: s.time && parseTimeSlots(s.time).length ? s.time : c0?.time || s.time || "", note: c0?.note ?? "", feature: c0?.feature ?? "", grade: c0?.grade ?? "", tongshiGroup: c0?.tongshiGroup ?? "", attr: c0?.attr ?? "" },
      selected: true, isCandidate: false, available: false,
      flag: typeCodeToFlag(s.typeCode), zy: s.zy, time: s.time && parseTimeSlots(s.time).length ? s.time : c0?.time || s.time || "", name: s.name || c0?.name || "", teacher: s.teacher || c0?.teacher || "", credits: s.credits || c0?.credits || 0,
      tongshiGroup: c0?.tongshiGroup ?? "", feature: c0?.feature ?? "", grade: c0?.grade ?? "", teacherId: c0?.teacherId ?? "", note: c0?.note ?? "",
    });
  }
  return rows;
}

/* ── §3.2 冲突 ─────────────────────────────────────────────── */
export interface SlotItem { name: string; code: string; seq: string; manual?: boolean }
export function buildSlotIndex(items: Array<SlotItem & { time: string }>, out: Map<string, SlotItem[]>): void {
  for (const it of items) {
    for (const { day, slot } of parseTimeSlots(it.time)) {
      const k = `${day}|${slot}`;
      const arr = out.get(k) ?? [];
      arr.push({ name: it.name, code: it.code, seq: it.seq, manual: it.manual });
      out.set(k, arr);
    }
  }
}
export interface Conflict { day: number; slot: number; a: string; b: string }
export function detectConflicts(items: Array<SlotItem & { time: string }>): Conflict[] {
  const slotMap = new Map<string, string[]>();
  const out: Conflict[] = [];
  for (const it of items) {
    for (const { day, slot } of parseTimeSlots(it.time)) {
      const k = `${day}|${slot}`;
      const arr = slotMap.get(k) ?? [];
      if (arr.length) out.push({ day, slot, a: arr[0]!, b: it.name });
      arr.push(it.name);
      slotMap.set(k, arr);
    }
  }
  return out;
}
/** findPreviewConflicts：与当前预览集合比对（跳过同 code+seq；按 课名|天|槽 去重） */
export function findPreviewConflicts(
  course: { code: string; seq: string; time: string; name: string }, previewIndex: Map<string, SlotItem[]>,
): Conflict[] {
  const out: Conflict[] = [];
  const seen = new Set<string>();
  for (const { day, slot } of parseTimeSlots(course.time)) {
    for (const it of previewIndex.get(`${day}|${slot}`) ?? []) {
      if (it.code === course.code && it.seq === course.seq) continue;
      const dk = `${it.name}|${day}|${slot}`;
      if (seen.has(dk)) continue;
      seen.add(dk);
      out.push({ day, slot, a: course.name, b: it.name });
    }
  }
  return out;
}

/* ── canAdjustZy（§4.4）────────────────────────────────────── */
export function canAdjustZy(rows: XkRow[], code: string, seq: string, targetZy: number): boolean {
  const me = rows.find((r) => r.c.code === code && r.c.seq === seq);
  if (!me) return true;
  const zt = zyTypeOf(me);
  const limit = ZY_LIMITS[zt][targetZy - 1]?.[1] ?? 0;
  if (!Number.isFinite(limit)) return true;
  const count = rows.filter(
    (r) => r.selected && !(r.c.code === code && r.c.seq === seq) && zyTypeOf(r) === zt && r.zy === targetZy,
  ).length;
  return count < limit;
}

/* ── 培养方案覆盖检查（render.js checkPlanCoverage 移植）────── */
import type { XkPlanItem } from "@onethu/core";

export interface PlanCoverageItem extends XkPlanItem {
  covered: boolean;
  coveredBy: string;
}
interface StageLike { code: string; name: string }

export function checkPlanCoverage(
  plan: XkPlanItem[],
  allCourses: XkRow[],
  stageCart: StageLike[],
  drafts: StageLike[][],
): PlanCoverageItem[] {
  const codes = new Set<string>();
  const detail = new Map<string, { code: string; teacher?: string; name: string }>();
  const collect = (list: Array<{ code: string; teacher?: string; name: string }>): void => {
    for (const c of list) {
      codes.add(c.code);
      if (!detail.has(c.code)) detail.set(c.code, c);
    }
  };
  collect(allCourses.filter((r) => r.selected).map((r) => ({ code: r.c.code, teacher: r.teacher, name: r.name })));
  collect(stageCart);
  for (const d of drafts) collect(d);

  const courseByCode = new Map(allCourses.map((r) => [r.c.code, r] as const));
  const isSports = (code: string): boolean => {
    const c = courseByCode.get(code);
    return !!c && ((c.c.department || "").includes("体育") || (c.c.attr || "") === "体育");
  };
  const isSecondLang = (code: string): boolean => {
    const c = courseByCode.get(code);
    return !!c && (c.name.includes("第二外国语") || c.name.includes("二外"));
  };
  const isAdvEnglish = (code: string): boolean => {
    const c = courseByCode.get(code);
    return !!c && (c.name.includes("进阶读写") || c.name.includes("进阶"));
  };
  const isBasicEnglish = (code: string): boolean => {
    const c = courseByCode.get(code);
    return !!c && (c.name.includes("阅读写作") || c.name.includes("听说交流"));
  };
  const allCodes = [...codes];
  const hasSports = allCodes.some(isSports) || stageCart.some((c) => isSports(c.code));
  const hasSecondLang = allCodes.some(isSecondLang);
  const hasAdvEnglish = allCodes.some(isAdvEnglish);
  const hasBasicEnglish = allCodes.some(isBasicEnglish);

  return plan.map((p) => {
    let covered = codes.has(p.code);
    let coveredBy = covered && detail.get(p.code) ? detail.get(p.code)!.teacher || detail.get(p.code)!.name : "";
    if (!covered && (p.attr === "体育" || p.name.includes("体育") || p.group.includes("体育"))) {
      if (hasSports) { covered = true; coveredBy = "(已有体育课)"; }
    }
    if (!covered && /英语\(3\)/.test(p.name)) {
      if (hasAdvEnglish) { covered = true; coveredBy = "(英语进阶读写)"; }
      else if (hasSecondLang) { covered = true; coveredBy = "(第二外国语替代)"; }
    }
    if (!covered && /英语\([12]\)/.test(p.name)) {
      if (hasBasicEnglish) { covered = true; coveredBy = "(英语阅读写作/听说交流)"; }
    }
    return { ...p, covered, coveredBy };
  });
}
