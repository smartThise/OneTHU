import { getLocale as getUiLocale } from "../../i18n/index.js";
import { labelForId } from "../../i18n/staticLabels.js";
import { t as i18n, rich as i18nRich, msg as i18nMsg, useLocale as useUiLocale } from "../../i18n/index.js";
import {
  Btn,
  Card as OGCard,
  Chip,
  Divider,
  Field,
  Grow,
  IconBtn,
  IconX,
  Inline,
  List,
  Modal,
  Progress,
  Row,
  Select,
  Spacer,
  Stack,
  Surface,
  Tag,
  Text,
  TextArea,
  Input,
  Banner,
} from "@onethu/gui";
/**
 * 选课工作台：课程查找与计划管理并排，窄屏切换同一组面板。
 * 搜索和常用筛选常驻，高级筛选、公告与补充详情按需展开。
 * UI 用 OneGUI（Btn/Input/Select/Card/Row/Chip/Tag/Banner/Modal/Text/Inline/Stack/Progress）。
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { PageAtomStar } from "../..//components/Collect.js";
import { Card, Empty, ErrorNote, PageHead, SegmentedOverflow, SkeletonRows } from "../../components/Layout.js";
import { IconRefresh } from "../../components/Icons.js";
import { nextVolCheckpoint, useXkWorkbench, type XkSearchMeta, type XkStageItem } from "../../state/data.js";
import { useApp } from "../../state/context.js";
import type { XkCourseDetail } from "@onethu/core";   // 【教评#31冻结】XkRatingRow 已注释
import { tbEnsureIndex, tbFetchReviews, tbMatch, tbStars, tbCourseUrl, tbWriteUrl, type TbEntry, type TbReviews } from "../../lib/xkreviews.js";
import { CONFIRM_DROP_COURSE as DROP_CONFIRM, confirmOk, confirmDanger } from "../../lib/confirm.js";
import { openExternal } from "../info/openExternal.js";
import {
  allowedFlags, calcProb, checkPlanCoverage, dayName, findPreviewConflicts, fullProbGrid, occupancyOf, typeCodeToFlag, volColor,
  FLAG_LABELS, parseTimeSlots, SLOT_NAMES, type PlanCoverageItem, type SlotItem, type XkFlag, type XkRow, zyTypeOf, isSportsCourse } from "../../lib/xklogic.js";

const TS_GROUPS: Array<[string, string]> = [["TS1", "人文课组"], ["TS2", "社科课组"], ["TS3", "艺术课组"], ["TS4", "科学课组"]];
const FEATURES: Array<[string, string]> = [
  ["专题研讨课", "专题研讨课"], ["全外文授课", "全外文授课"], ["外文授课比例≥50%", "双语课(外文≥50%)"], ["外文教材", "双语课(外文教材)"],
  ["实践课", "实践课"], ["实验课", "实验课"], ["挑战性学习", "挑战性学习课程"], ["文化素质核心课", "文化素质核心课"],
  ["文化素质课", "文化素质课"], ["新生研讨课", "新生研讨课"], ["混合式教学", "混合式教学"], ["精品课", "精品课"],
  ["认证外文课", "认证外文课"], ["通识荣誉课", "通识荣誉课"], ["通识选修课", "通识选修课"], ["语言类", "语言类课程"],
  ["通识英语", "通识英语"], ["公共英语", "公共英语"],
];
/* ── 时间轴常量（对齐正式课表 Schedule.tsx；清华节次表）── */
const PV_BEGIN = ["", "08:00", "08:50", "09:50", "10:40", "11:30", "13:30", "14:20", "15:20", "16:10", "17:05", "17:55", "19:20", "20:10", "21:00"];
const PV_END = ["", "08:45", "09:35", "10:35", "11:25", "12:15", "14:15", "15:05", "16:05", "16:55", "17:50", "18:40", "20:05", "20:55", "21:45"];
const pvToMin = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** 大节 N → [起始分钟, 结束分钟]（1:小节1-2, 2:3-5, 3:6-7, 4:8-9, 5:10-11, 6:12-14） */
const SLOT_RANGE: Array<[number, number]> = [
  [pvToMin(PV_BEGIN[1]!), pvToMin(PV_END[2]!)],
  [pvToMin(PV_BEGIN[3]!), pvToMin(PV_END[5]!)],
  [pvToMin(PV_BEGIN[6]!), pvToMin(PV_END[7]!)],
  [pvToMin(PV_BEGIN[8]!), pvToMin(PV_END[9]!)],
  [pvToMin(PV_BEGIN[10]!), pvToMin(PV_END[11]!)],
  [pvToMin(PV_BEGIN[12]!), pvToMin(PV_END[14]!)],
];
const PV_PX_PER_MIN = 0.72;
const PV_AXIS_BEGIN = 8 * 60;
const PV_AXIS_END = pvToMin(PV_END[14]!);
const pvY = (min: number): number => (min - PV_AXIS_BEGIN) * PV_PX_PER_MIN;
const pvHm = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const PV_HALF_HOURS: number[] = Array.from({ length: Math.floor((PV_AXIS_END - PV_AXIS_BEGIN) / 30) + 1 }, (_, i) => PV_AXIS_BEGIN + i * 30);
/** 外校钟点解析 v2（北大/北外官方 xlsx 时间描述全格式实证）：
 *  支持周X/星期X、复合日「周二、四」「星期二/星期日」、多段「、;；」分隔、
 *  破折号—–-通吃、全角括号、课级/段级「单周」「双周」、周段「(1-16周)」。
 *  返回钟点块 + 展示标签（单双周/周段）。 */
interface ClockRange { day: number; begin: number; end: number; tag: string }
function clockRangesOf(note: string, time: string): ClockRange[] {
  const raw = `${note || ""} ${time || ""}`;
  if (!raw.trim()) return [];
  // 归一化：星期→周、全角括号→半角、破折号→-、分号→;
  const s = raw.replace(/星期/g, "周").replace(/（/g, "(").replace(/）/g, ")").replace(/[—–]/g, "-").replace(/；/g, ";").replace(/[{}]/g, "(").replace(/」/g, ")");
  const dayChar = "一二三四五六日天";
  const dayIdx: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
  const parityOf = (t: string): string => (/单周/.test(t) ? "单周" : /双周/.test(t) ? "双周" : "");
  // 段级标记：带时间的段内的单双周只管本段；「;单周」独立尾段/全局标记管全部
  const out: ClockRange[] = [];
  let globalParity = "";
  for (const seg of s.split(";")) {
    const re = /((?:周?[一二三四五六日天][、\/,]?)+)\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g;
    let m: RegExpExecArray | null;
    let segHit = false;
    while ((m = re.exec(seg)) !== null) {
      const days = [...m[1]!].filter((ch) => dayChar.includes(ch)).map((ch) => dayIdx[ch]!);
      const begin = Number(m[2]) * 60 + Number(m[3]);
      const end = Number(m[4]) * 60 + Number(m[5]);
      // 周段：时间后紧邻的 (N-M周)
      const after = seg.slice(m.index + m[0].length, m.index + m[0].length + 12);
      const wk = /\((\d+-\d+周?)\)/.exec(after)?.[1] ?? "";
      const parity = parityOf(seg.slice(m.index));
      if (!parity && !segHit) { /* 段内无标记，稍后回落课级 */ }
      for (const day of days) {
        if (day >= 1 && end > begin) {
          const bits = [parity, wk].filter(Boolean);
          out.push({ day, begin, end, tag: bits.join("·") });
          segHit = true;
        }
      }
    }
    if (!segHit) {
      const p = parityOf(seg);
      if (p) globalParity = p; // 「;单周」独立尾段 → 管全部段
    }
  }
  if (globalParity) for (const r of out) if (!r.tag.includes("周") || /\d+-\d+/.test(r.tag)) r.tag = [globalParity, ...r.tag.split("·").filter((t) => !/^(单周|双周)$/.test(t))].filter(Boolean).join("·");
  return out;
}

/** 课块配色：课块不再按课名取色（旧 courseColor 调色板收编为 OG 语义令牌——
 *  普通课块走 accent-soft 一族，候选/占用/概率走 warning/error/自定义线，见预览课块 render）。
 *  正式课表页仍用 lib/courseColor 的共享口径，本页预览不再消费。 */

/** 外校课程标注：课号前缀 PK=北大本科、GPK=北大研究生（2026 秋 38 门）、BW=北外（形如 BW3w0007） */
type Origin = "北大" | "北大研" | "北外" | "";
const originOf = (code: string): Origin => (code.startsWith("GPK") ? "北大研" : code.startsWith("PK") ? "北大" : code.startsWith("BW") ? "北外" : "");
/** 来源色 tone（旧暗红 → error 族；旧藏蓝 → info 族；无来源不渲染标签） */
const ORIGIN_TONE: Record<Exclude<Origin, "">, "error" | "info"> = { 北大: "error", 北大研: "error", 北外: "info" };

const fmtVol = (v: string): string => {
  // NextTHUxk 2.0 probability.js 逐字：全零且无优先 → 空（不上屏）；优先 (N) 前缀
  if (!v) return "";
  const priMatch = /^\((\d+)\)/.exec(v);
  const pri = priMatch ? parseInt(priMatch[1] ?? "") : 0;
  const cleaned = v.replace(/^\(\d+\)/, "");
  const parts = cleaned.split(",").map((n) => parseInt(n) || 0);
  if (parts.every((n) => n === 0) && !pri) return "";
  let out = parts.join("/");
  if (pri) out = i18n("pages.zhjwxk.courses.afb7bec1c0e2", { pri: String(pri), out: String(out) });
  return out;
};
const heatTone = (applied: number, cap: number): "success" | "warning" | "error" | undefined =>
  !cap ? undefined : applied / cap <= 0.8 ? "success" : applied / cap <= 1.2 ? "warning" : "error";
/** 概率 tone：与 lib/xklogic.calcProb 的三色门槛一致（≥0.8 绿 / ≥0.5 黄 / 其余红；<0 无数据=弱灰） */
const probTone = (prob: number): "success" | "warning" | "error" | "faint" =>
  prob < 0 ? "faint" : prob >= 0.8 ? "success" : prob >= 0.5 ? "warning" : "error";
/** 竞争色阶 tone：volColor 的 level 四档（easy 绿 / medium 黄 / hard 红 / unknown 弱灰） */
const levelTone = (level: "easy" | "medium" | "hard" | "unknown"): "success" | "warning" | "error" | "faint" =>
  level === "easy" ? "success" : level === "medium" ? "warning" : level === "hard" ? "error" : "faint";
/** 概率 tone → 课块 tone（预览网格用） */
const toBlockTone = (t: "success" | "warning" | "error" | "faint"): "good" | "warn" | "bad" | "off" =>
  t === "success" ? "good" : t === "warning" ? "warn" : t === "error" ? "bad" : "off";
/** 课块 tone → OG 语义令牌面/线（无独立"每课一色"档：候选=warning 族、概率分级=success/warning/error 族、
 *  占用=accent 强线、普通课块=accent-soft/soft-line；demo of "课表格子的浅紫底 = --og-accent-soft"） */
const BLOCK_LICENSE: Record<"normal" | "good" | "warn" | "bad", { fill: string; line: string }> = {
  normal: { fill: "var(--og-accent-soft)", line: "var(--og-accent-soft-line)" },
  good: { fill: "var(--og-success-soft)", line: "var(--og-success-line)" },
  warn: { fill: "var(--og-warning-soft)", line: "var(--og-warning-line)" },
  bad: { fill: "var(--og-error-soft)", line: "var(--og-error-line)" },
};
const tbBadge = (r: XkRow): string => {
  const e = tbMatch(r.name, r.teacher);
  return e && e.count > 0 ? `${tbStars(e.avg)} ${e.avg ? e.avg.toFixed(1) : ""}(${e.count})` : "";
};
// 【特性冻结 2026-09-10】官方教评（#31）暂停：xgpg 端点对登录会话全 500。（辅助函数注释保留）
// /* 官方教评（#31）：课号 → 教师行择优（教师命中 → 最大样本），1-7 分制 */
// const xkPick = (rows: XkRatingRow[] | undefined, teacher: string): XkRatingRow | null => {
//   if (!rows || !rows.length) return null;
//   const t = String(teacher || "").trim();
//   if (t) {
//     const hit = rows.find((x) => x.teacher === t) || rows.find((x) => x.teacher.includes(t) || t.includes(x.teacher));
//     if (hit) return hit;
//   }
//   return rows.reduce((best, x) => (x.total > best.total ? x : best), rows[0]!);
// };
// const xkAvgColor = (avg: number): string => (avg >= 6 ? "var(--green)" : avg >= 5 ? "var(--amber)" : "var(--red)");
// const xkBadge = (ratings: Record<string, XkRatingRow[]>, r: XkRow): string => {
//   const m = xkPick(ratings[r.c.code], r.teacher);
//   return m && m.total > 0 ? `教评 ${m.average.toFixed(1)}(${m.total})` : "";
// };
const itemProb = (wb: ReturnType<typeof useXkWorkbench>, code: string, seq: string, flag: XkFlag, zy: number): { prob: string; color: string; bg: string; probNum: number } => {
  const row = wb.courses.find((r) => r.c.code === code && r.c.seq === seq);
  const vol = row?.vol;
  const cap = vol ? vol.capacity : row?.c.capacity || 0; // 缺志愿行=无数据，不拿 kkxx 容量造 0/N 宽松（2.0 定稿）
  const p = calcProb(cap, vol, flag, zy);
  return { prob: p.prob < 0 ? i18n("pages.zhjwxk.courses.ab9ba6d10394") : `${p.percentLabel} · ${p.ratioLabel}`, color: p.color, bg: p.bg, probNum: p.prob };
};
/* 跳转/弹窗 opener（module-level 轻通道） */
let _jump = "";
let _jumpChip = "all";
let _jumpSeq = "";   // #23：课表块/暂存/候补点击带课序——高亮与定位到具体班次，不再全课序泛高亮
let _jumpSetter: ((v: string, seq?: string) => void) | null = null;
let _detailOpen: ((code: string, teacherId: string) => void) | null = null;
let _reviewOpen: ((v: { code: string; seq: string; name: string; teacher: string }) => void) | null = null;
const jumpTo = (code: string, chip = "all", seq = ""): void => { _jump = code; _jumpChip = chip; _jumpSeq = String(seq || ""); _jumpSetter?.(code, _jumpSeq); };
/** 培养方案/暂存条目 → 按课号发起真实搜索（切回全部 chip）；回调由主页面注册 */
/** 条目点击统一入口：jumpTo 注入搜索栏（复用已验证 jump 通路 setQuery(jump)）+ 按课号真实搜索 */
const openDetail = (code: string, teacherId: string): void => { _detailOpen?.(code, teacherId); };
const openReviews = (v: { code: string; seq: string; name: string; teacher: string }): void => { _reviewOpen?.(v); };

/* ══════════ 弹窗（OneGUI Modal：遮罩/面板/退场/Esc/滚动锁全部由库承担） ══════════ */

function DetailModal({ wb, code, tid, onClose }: { wb: ReturnType<typeof useXkWorkbench>; code: string | null; tid: string; onClose: () => void }) {
  const uiLocale = useUiLocale();

  const [data, setData] = useState<XkCourseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  // const [rrows, setRrows] = useState<XkRatingRow[] | null | undefined>(undefined);   // 【教评#31冻结】
  useEffect(() => {
    if (!code) return;
    setLoading(true);
    setData(null);
    void wb.loadDetail(code, tid).then((d) => { setData(d); setLoading(false); });
    // 【教评#31冻结】教评一并拉
    // let alive = true;
    // setRrows(undefined);
    // void wb.getRatings(code).then((v) => { if (alive) setRrows(v); });
    // return () => { alive = false; };
  }, [code, tid]);
  if (!code) return null;
  const order = ["课程编号", "课程名称", "总学时数", "总学分", "课程内容简介", "Course Description", "考核安排", "联系人", "教材及参考书", "上课教师", "选课指导语", "先修要求", "教师教学特色", "Office Hour", "成绩评定标准", "参考书"];
  const entries = data ? Object.entries(data.fields) : [];
  entries.sort((a, b) => {
    const ia = order.indexOf(a[0]), ib = order.indexOf(b[0]);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return (
    <Modal open onClose={onClose} title={i18n("pages.zhjwxk.courses.19368dbee54d")} size="lg" scope="zhjwxk.detail">
      {/* 【教评#31冻结】教评三态块（整块注释保留，教务修好解开；内联外观已随 UI 收编改为 OG 件）
       {rrows === undefined ? <Text slot="label" tone="faint">正在获取官方教评…</Text> : null}
       {rrows === null ? <Text slot="label" tone="error">官方教评获取未成功（教务登录或网络问题），请稍后重试</Text> : null}
       {rrows && rrows.length > 0 ? (
         <Stack gap={2}>
           <Text slot="label" weight="bold">官方教评 · 选课学生推荐度（1-7 分）</Text>
           {rrows.map((row) => (
             <Stack key={row.teacher + row.total} gap={1}>
               <Inline gap={2} vAlign="baseline">
                 <Text slot="label" weight="semibold">{row.teacher || "（未署名教师）"}</Text>
                 <Text slot="label" tone={row.average >= 6 ? "success" : row.average >= 5 ? "warning" : "error"} weight="bold">{row.average.toFixed(2)} / 7</Text>
                 <Text slot="label" tone="faint">{row.total} 人评分 · 高分率 {(row.highRatio * 100).toFixed(0)}%</Text>
               </Inline>
               <Progress value={row.average / 7} tone={row.average >= 6 ? "success" : row.average >= 5 ? "warning" : "error"} size="sm" />
             </Stack>
           ))}
           <Text slot="micro" tone="faint">数据来自教务 xgpg 学生评教；绿=6/7 分，黄=4/5 分，红=1-3 分</Text>
         </Stack>
       ) : rrows ? <Text slot="label" tone="faint">该课暂无官方教评数据</Text> : null}

      */}
      {loading ? <Empty text={i18n("pages.zhjwxk.courses.ebc1a817b794")} /> : !data ? <Empty text={i18n("pages.zhjwxk.courses.aa7f2e6b23d5")} /> : (
        <Stack gap={1}>
          {entries.map(([k, v]) => (
            <Inline key={k} gap={3} vAlign="start">
              <span style={{ width: 108, flexShrink: 0 }}>
                <Text slot="label" tone="faint" nowrap>{k}</Text>
              </span>
              <span style={{ whiteSpace: "pre-wrap" }}>
                <Text>{v}</Text>
              </span>
            </Inline>
          ))}
        </Stack>
      )}
    </Modal>
  );
}

function ReviewsModal({ code, seq, name, teacher, onClose }: { code: string | null; seq: string; name: string; teacher: string; onClose: () => void }) {
  const uiLocale = useUiLocale();

  const [phase, setPhase] = useState<"loading" | "ready" | "fail">("loading");
  const [entry, setEntry] = useState<TbEntry | null>(null);
  const [data, setData] = useState<TbReviews | null>(null);
  // 匹配只用 props（课名/教师）——依赖行对象引用会被后台数据刷新反复触发（卡死根因）
  const nameKey = `${name}\u0001${teacher}`;
  useEffect(() => {
    if (!code) return;
    setPhase("loading");
    setEntry(null);
    setData(null);
    let alive = true;
    void (async () => {
      try { await tbEnsureIndex(); } catch { /* 索引失败走无匹配分支 */ }
      if (!alive) return;
      const e = tbMatch(name, teacher);
      setEntry(e);
      setPhase("ready");
      if (!e) return;
      try {
        const d = await tbFetchReviews(e.sqid);
        if (!alive) return;
        setData(d);
      } catch { if (alive) { setData({ count: 0, results: [] }); setPhase("fail"); } }
    })();
    return () => { alive = false; };
  }, [code, nameKey, name, teacher]);
  // 未打开时绝不渲染（重写时弄丢的守卫 —— 空态也渲染遮罩且永远关不掉，就是糊脸黑罩的根因）
  if (!code) return null;

  const courseUrl = entry ? tbCourseUrl(entry) : tbCourseUrl(entry!);
  return (
    <Modal open onClose={onClose} title={i18n("pages.zhjwxk.courses.d28b333318b4", { name: String(name) })} scope="zhjwxk.reviews">
      {entry && entry.count ? (
        <Inline gap={2} vAlign="baseline">
          <Text slot="title" tone="warning" weight="bold">{Number(entry.avg).toFixed(1)}</Text>
          <Text tone="warning">{tbStars(entry.avg)}</Text>
          <Text slot="label" tone="faint">{i18nRich("pages.zhjwxk.courses.ef8963e02e96", { count: entry.count, value: entry.kkdw ? ` · ${entry.kkdw}` : "" })}</Text>
        </Inline>
      ) : (
        <Text tone="faint">{i18n("pages.zhjwxk.courses.5bbcf9e26267")}</Text>
      )}
      <Inline gap={2} wrap>
        <Btn variant="outline" href={courseUrl} onClick={(e) => { e.preventDefault(); void openExternal(courseUrl); }}>{i18n("pages.zhjwxk.courses.ccd11f27c335")}</Btn>
        <Btn variant="outline" tone="brand" href={tbWriteUrl(entry)} onClick={(e) => { e.preventDefault(); void openExternal(tbWriteUrl(entry)); }}>{i18n("pages.zhjwxk.courses.cc5250e00330")}</Btn>
      </Inline>
      <Text slot="micro" tone="faint">{i18n("pages.zhjwxk.courses.3a94b84beb0c")}<a className="og-text--t-brand" href={courseUrl} onClick={(e) => { e.preventDefault(); void openExternal(courseUrl); }}>{i18n("pages.zhjwxk.courses.ce1aa25eb717")}</a>{i18n("pages.zhjwxk.courses.99b048211611")}<a className="og-text--t-brand" href="https://creativecommons.org/licenses/by-nc/4.0/deed.zh" onClick={(e) => { e.preventDefault(); void openExternal("https://creativecommons.org/licenses/by-nc/4.0/deed.zh"); }}>CC BY-NC 4.0</a>{i18n("pages.zhjwxk.courses.31ba5905672b")}</Text>
      {entry ? (
        phase === "loading" ? <Empty text={i18n("pages.zhjwxk.courses.0fe3db929495")} /> : phase === "fail" ? <Empty text={i18n("pages.zhjwxk.courses.5739e3851d0e")} /> :
        !data?.results.length ? <Empty text={i18n("pages.zhjwxk.courses.2071a95cf2d7")} /> : (
          <List divided gap={2}>
            {data.results.map((r, i) => (
              <Row key={i} size="sm"
                title={
                  <Inline as="div" gap={2} vAlign="baseline" wrap>
                    <Text tone="warning">{tbStars(r.rating ?? 0)}</Text>
                    <Text weight="bold">{Number(r.rating ?? 0)}</Text>
                    {r.score ? <Chip size="sm">{i18nRich("pages.zhjwxk.courses.55e82546e619", { value: String(r.score).slice(0, 8) })}</Chip> : null}
                  </Inline>
                }
                trailing={<Text slot="micro" tone="faint">{r.created_at ?? ""}</Text>}
              >
                <span style={{ whiteSpace: "pre-wrap" }}>
                  <Text>{String(r.comment ?? "").trim()}</Text>
                </span>
              </Row>
            ))}
          </List>
        )
      ) : null}
    </Modal>
  );
}

/* ══════════ 右栏小节标题 ══════════ */
function Sec({ title, extra, children }: { title: string; extra?: React.ReactNode; children: React.ReactNode }) {
  const uiLocale = useUiLocale();

  return (
    <OGCard pad="sm">
      <Inline gap={2}>
        <Text slot="label" weight="bold">{title}</Text>
        <Spacer />
        {extra}
      </Inline>
      <Stack gap={1}>{children}</Stack>
    </OGCard>
  );
}

/* ══════════ 主页面：单屏两栏 ══════════ */
export function ZhjwxkCoursesPage() {
  const uiLocale = useUiLocale();

  const wb = useXkWorkbench();
  const [detailCode, setDetailCode] = useState<string | null>(null);
  const [detailTid, setDetailTid] = useState("");
  const [reviewCode, setReviewCode] = useState<{ code: string; seq: string; name: string; teacher: string } | null>(null);
  const [jump, setJump] = useState("");
  const [jumpSeq, setJumpSeq] = useState("");
  // 竖屏双页签：课程查找 / 选课管理（AI 能力已并入小OH 助手；桌面仍为双栏，此状态仅移动端消费）
  const [mTab, setMTab] = useState<"find" | "manage">("find");
  useEffect(() => {
    void tbEnsureIndex().catch(() => undefined);
    // 跳转唯一权威通路：注入搜索栏（setJump → jump effect）+ 按课号真实搜索
    //（此前三通道并存 = 注入时灵时不灵；newSearch 稳定 useCallback，闭包捕获安全）
    _jumpSetter = (code: string, seq?: string) => {
      setJump(code);
      setJumpSeq(String(seq || ""));
      void wb.newSearch({ kcm: "", kch: code, teacher: "", department: "", weekday: "", section: "", grade: "", rxklxm: "", kctsm: "", onlyAvailable: false, gradAvail: false });
    };
    _detailOpen = (code, tid) => { setDetailCode(code); setDetailTid(tid); };
    _reviewOpen = setReviewCode;
    return () => { _jumpSetter = null; _detailOpen = null; _reviewOpen = null; };
  }, []);

  useEffect(() => {
    if (jump) setMTab("find"); // 点课表/暂存里的课 → 跳回「课程查找」页签
  }, [jump]);

  const selCredits = wb.selected.reduce((a, s) => a + (s.credits || 0), 0);

  // 横屏双栏分割条：拖动改宽度；拖过阈值（<30% / >70%）塌缩为只显示左栏/右栏；状态持久化
  const [split, setSplit] = useState<{ pct: number; collapsed: "none" | "left" | "right" }>(() => {
    try {
      const v = JSON.parse(localStorage.getItem("onethu.xk.split") ?? "null") as { pct?: number; collapsed?: string } | null;
      if (v && typeof v.pct === "number" && (v.collapsed === "none" || v.collapsed === "left" || v.collapsed === "right")) {
        return { pct: Math.min(78, Math.max(22, v.pct)), collapsed: v.collapsed };
      }
    } catch { /* ignore */ }
    return { pct: 66, collapsed: "none" };
  });
  const splitRef = useRef(split);
  splitRef.current = split;
  const colRef = useRef<HTMLDivElement | null>(null);
  const setSplitP = (v: { pct: number; collapsed: "none" | "left" | "right" }): void => {
    setSplit(v);
    try { localStorage.setItem("onethu.xk.split", JSON.stringify(v)); } catch { /* ignore */ }
  };
  const onSepDown = (e: RPointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.currentTarget.dataset.dragging = "1";
    e.currentTarget.setPointerCapture(e.pointerId);
    setSplitP({ pct: splitRef.current.pct, collapsed: "none" });
  };
  const onSepMove = (e: RPointerEvent<HTMLDivElement>): void => {
    if (e.currentTarget.dataset.dragging !== "1") return;
    const rect = colRef.current?.getBoundingClientRect();
    if (!rect || rect.width < 200) return;
    const pct = Math.min(78, Math.max(22, ((e.clientX - rect.left) / rect.width) * 100));
    setSplitP({ pct, collapsed: "none" });
  };
  const onSepUp = (e: RPointerEvent<HTMLDivElement>): void => {
    if (e.currentTarget.dataset.dragging !== "1") return;
    e.currentTarget.dataset.dragging = "0";
    const { pct } = splitRef.current;
    if (pct < 30) setSplitP({ pct: 30, collapsed: "left" }); // 只显示左栏
    else if (pct > 70) setSplitP({ pct: 70, collapsed: "right" }); // 只显示右栏
  };

  return (
    <div className="xk-workbench">
      <PageHead
        title={i18n("pages.zhjwxk.courses.fd17d86dd268")}
        meta={[
          wb.semester ?? i18n("pages.zhjwxk.courses.c6b20f53de3e"),
          wb.phase ? i18n("pages.zhjwxk.courses.9a512330e94a") : i18n("pages.zhjwxk.courses.ba23721689b0"),
          i18n("pages.zhjwxk.courses.960b5a9f210e", { length: String(wb.selected.length), selCredits: String(selCredits) }),
          i18n("pages.zhjwxk.courses.cc4aef94b28b", { length: String(wb.searchRows.length) }),
        ].filter(Boolean).join(" · ")}
        actions={
          <>
            <PageAtomStar atomKey="zhjwxk" title={i18n("pages.zhjwxk.courses.fd17d86dd268")} />
            <Select size="sm" value={wb.semester ?? ""} onChange={(value) => void wb.setSemesterOverride(value)}>{(wb.semesterOptions ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
            {wb.phase ? <Btn variant="outline" size="sm" onClick={() => void wb.refreshQueue()} disabled={wb.queueState === "loading"}>{i18n("pages.zhjwxk.courses.65fb020bd6ee")}</Btn> : null}
            <Btn variant="outline" size="sm" onClick={() => void wb.refresh()} disabled={wb.coreState === "loading"}><IconRefresh width={14} height={14} />{i18n("pages.zhjwxk.courses.0468ee76ee3d")}</Btn>
          </>
        }
      />
      {wb.coreState === "error" ? <ErrorNote text={wb.error ?? ""} onRetry={() => void wb.refresh()} /> : null}
      {wb.toast ? (
        <Banner tone="info" action={<Btn variant="outline" size="sm" onClick={() => wb.setToast(null)}>{i18n("pages.zhjwxk.courses.de32e20193ad")}</Btn>}>{wb.toast}</Banner>
      ) : null}
      {wb.progress ? <Banner tone="warning">{wb.progress}</Banner> : null}

      {/* ── 竖屏：双页签（课程查找 / 选课管理），跳转关系由 jump 联动 ── */}
      <div className="xk-mobile-tabs">
        <SegmentedOverflow ariaLabel={i18n("pages.zhjwxk.courses.7594fdb2ae0d")}>
          {([["find", i18n("pages.zhjwxk.courses.c518420d2110")], ["manage", i18n("pages.zhjwxk.courses.7e37a0b0d351")]] as const).map(([k, label]) => (
            <Btn key={k} size="sm" variant={mTab === k ? "tonal" : "ghost"} role="tab" aria-selected={mTab === k} onClick={() => setMTab(k)}>
              {label}
            </Btn>
          ))}
        </SegmentedOverflow>
      </div>

      {/* ── 桌面：双栏（左查找 / 右管理+AI）── */}
      <div className="xk-two-col" ref={colRef} data-mobile-panel={mTab}>
        {/* 塌缩用 display:none 藏身（绝不卸载）：筛选/搜索/滚动状态全保留 */}
        <div
          className="xk-left"
          style={{
            display: split.collapsed === "left" ? "none" : undefined,
            flex: split.collapsed === "right" ? "1 1 0%" : "0 0 auto",
            width: split.collapsed === "right" ? "auto" : `calc(${split.pct}% - 3px)`,
            minWidth: 0,
          }}
        >
          <CourseListPanel wb={wb} jump={jump} jumpSeq={jumpSeq} />
        </div>
        {split.collapsed === "none" ? (
          <div
            role="separator"
            aria-orientation="vertical"
            title={i18n("pages.zhjwxk.courses.9aa48e0ea5e2")}
            onPointerDown={onSepDown}
            onPointerMove={onSepMove}
            onPointerUp={onSepUp}
            onPointerCancel={onSepUp}
            style={{ flex: "0 0 6px", cursor: "col-resize", position: "relative", touchAction: "none", display: "flex", justifyContent: "center" }}
          >
            {/* 竖分隔线：OG Divider（--og-line-1介质），横排居中是纯几何 */}
            <Divider vertical />
          </div>
        ) : (
          <Btn variant="outline" titleAttr={i18n("pages.zhjwxk.courses.290d10efc55e")} onClick={() => setSplitP({ pct: 50, collapsed: "none" })}>‹›
          </Btn>
        )}
        <div
          className="xk-right"
          style={{
            display: split.collapsed === "right" ? "none" : "flex",
            flex: split.collapsed === "left" ? "1 1 0%" : "1 1 0%",
            minWidth: 0,
            maxWidth: "none",
          }}
        >
          <PreviewSection wb={wb} />
          <StageSection wb={wb} />
          <QueueSection wb={wb} />
          <PlanSection wb={wb} />
        </div>
      </div>

      <DetailModal wb={wb} code={detailCode} tid={detailTid} onClose={() => setDetailCode(null)} />
      <ReviewsModal code={reviewCode?.code ?? null} seq={reviewCode?.seq ?? ""} name={reviewCode?.name ?? ""} teacher={reviewCode?.teacher ?? ""} onClose={() => setReviewCode(null)} />
    </div>
  );
}

/* ══════════ 左栏：搜索 + 筛选 + 列表 ══════════ */
function CourseListPanel({ wb, jump, jumpSeq }: { wb: ReturnType<typeof useXkWorkbench>; jump: string; jumpSeq: string }) {
  const uiLocale = useUiLocale();

  const [query, setQuery] = useState("");
  const [chip, setChip] = useState("all");
  const [credits, setCredits] = useState("");
  const [day, setDay] = useState("");
  const [period, setPeriod] = useState("");
  const [conflictF, setConflictF] = useState("");
  const [tongshi, setTongshi] = useState("");
  const [feature, setFeature] = useState("");
  const [grade, setGrade] = useState("");
  const [bksrem, setBksrem] = useState("");
  const [yjsrem, setYjsrem] = useState("");
  const [xknote, setXknote] = useState("");
  const [reviewsF, setReviewsF] = useState("");
  const [sortBy, setSortBy] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [picks, setPicks] = useState<Record<string, { flag: XkFlag; zy: number }>>({});
  const [highlight, setHighlight] = useState("");
  const { navigate } = useApp();

  /* 服务端筛选映射：课程号(纯数字)/课程名→文本框，通识课组→p_rxklxm，课程特色→p_kctsm，
   * 年级→p_ssnj，星期→p_skxq，大节→p_skjc，本/研余量→p_bkskyl_ig/p_yjskyl_ig。
   * 其余（冲突/学分/评价/文字说明/chips）为本地叠加，作用于已取回的页。 */
  const serverKey = useMemo(() => JSON.stringify([
    query.trim(), tongshi, feature, grade, day, period, bksrem === "1", yjsrem === "1",
  ]), [uiLocale, query, tongshi, feature, grade, day, period, bksrem, yjsrem]);
  const firstSearchRef = useRef(false);
  useEffect(() => {
    const kw = query.trim();
    // 课号识别：无中文 + 含数字 + 长度≥5 → 课号检索。覆盖本校 10421315（含 -0 序号后缀，
    // 截掉后缀发课号）、北大 PK00334770、北外 BW3w0007；中文课名/教师名不受影响。
    const codeLike = kw.length >= 5 && !/[\u4e00-\u9fff]/.test(kw) && /\d/.test(kw) && /^[A-Za-z0-9][-A-Za-z0-9]*$/.test(kw);
    const meta: XkSearchMeta = {
      kcm: codeLike ? "" : kw,
      teacher: "",
      department: "",
      weekday: day || "",
      section: period || "",
      grade,
      rxklxm: tongshi || "",
      kctsm: FEATURES.some(([label]) => label === feature) ? feature : "",
      onlyAvailable: bksrem === "1",
      gradAvail: yjsrem === "1",
      kch: codeLike ? kw.split(/[-–]/)[0]!.trim() : "",
    };
    const t = setTimeout(() => {
      firstSearchRef.current = true;
      void wb.newSearch(meta);
    }, firstSearchRef.current ? 500 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);
  const [jumpTarget, setJumpTarget] = useState<{ code: string; seq: string; at: number } | null>(null);
  const jumpLocateRef = useRef(0);
  useEffect(() => {
    if (!jump) return;
    setQuery(jump);
    setChip(_jumpChip as typeof chip);
    setHighlight(jump);
    setJumpTarget(jumpSeq ? { code: jump, seq: jumpSeq, at: Date.now() } : null);
    // 高亮瞬时清除；搜索词保留（2026-09-03 用户定稿：课号注入搜索栏并保持——
    // 旧的 1.8s setQuery("") 就是「过一会刷回第一页」的实锤根因。残留词用搜索框 × 清）
    const t = setTimeout(() => setHighlight(""), 1800);
    return () => clearTimeout(t);
  }, [jump, jumpSeq]);
  // 培养方案/暂存条目点击 → 按课号真实搜索（新搜索替换当前关键词，语义同手输）
  useEffect(() => {
    // 右栏「我的培养方案」卡片 → 切 plan chip（此前 setPresetGroupChip 从未赋值，点击全静默无效）
    setPresetGroupChip = (v: string) => { setChip(v); };
    return () => { setPresetGroupChip = null; };
  }, [wb]);

  const rows = useMemo<XkRow[]>(() => {
    // 我的队列/已选不依赖已加载的搜索页：改用工作台全量池（目录+已选/候补补行）
    // ——候选课不在已翻页里时这两个 chip 永远空（「我的队列被吃了十年」实证）
    const fullPool = chip === "queue" || chip === "selected";
    if (!fullPool && (wb.searchState === "idle" || wb.searchState === "loading")) return [];
    const q = query.trim().toLowerCase();
    const dayRe = day && period ? new RegExp(`${day}-${period}\\(`) : day ? new RegExp(`${day}-\\d`) : period ? new RegExp(`\\d+-${period}\\(`) : null;
    const base = (fullPool ? wb.courses : wb.searchRows)
      .filter((r) => {
        if (q && !(r.name.toLowerCase().includes(q) || r.c.code.toLowerCase().includes(q) || r.teacher.toLowerCase().includes(q))) return false;
        if (chip === "available" && !r.available) return false;
        if (chip === "selected" && !(r.selected || r.isCandidate)) return false;
        if (chip === "required" && zyTypeOf(r) !== "bx") return false;
        if (chip === "elective" && zyTypeOf(r) !== "xx") return false;
        if (chip === "sports" && zyTypeOf(r) !== "ty") return false;
        if (chip === "queue" && !r.isCandidate) return false;
        if (credits && (credits === "5+" ? !(r.credits >= 5) : r.credits !== parseInt(credits))) return false;
        if (dayRe && !dayRe.test(r.time)) return false;
        if (conflictF) {
          const n = findPreviewConflicts({ code: r.c.code, seq: r.c.seq, time: r.time, name: r.name }, wb.previewIndex).length;
          if (conflictF === "noconflict" && n > 0) return false;
          if (conflictF === "conflict" && n === 0) return false;
        }
        if (tongshi && !r.tongshiGroup.includes(TS_GROUPS.find(([k]) => k === tongshi)![1])) return false;
        if (feature && !r.feature.includes(feature)) return false;
        if (grade && !r.grade.includes(grade)) return false;
        if (bksrem && !((r.c.remaining ?? 0) > 0)) return false;
        if (yjsrem && !((r.c.gradRemaining ?? 0) > 0)) return false;
        if (xknote && !r.c.note.toLowerCase().includes(xknote.toLowerCase())) return false;
        if (reviewsF) {
          const e = tbMatch(r.name, r.teacher);
          if (reviewsF === "has" && (!e || e.count <= 0)) return false;
          if (reviewsF === "cnt5" && (!e || e.count < 5)) return false;
          if (reviewsF === "r45" && (!e || e.avg < 4.5)) return false;
          if (reviewsF === "r40" && (!e || e.avg < 4)) return false;
          if (reviewsF === "low" && (!e || e.avg > 3)) return false;
        }
        return true;
      });
    if (!sortBy) return base;
    const scored: Array<{ r: XkRow; e: TbEntry | null }> = base.map((r) => ({ r, e: tbMatch(r.name, r.teacher) }));
    if (sortBy === "cnt_desc") scored.sort((a, b) => (b.e?.count ?? -1) - (a.e?.count ?? -1));
    else if (sortBy === "rate_desc") scored.sort((a, b) => ((b.e?.avg ?? -1) - (a.e?.avg ?? -1)) || ((b.e?.count ?? 0) - (a.e?.count ?? 0)));
//     else if (sortBy === "xk_desc" || sortBy === "xk_asc") {
//       // 官方教评排序（#31）：教师匹配行均分；无教评的课沉底（高→低）/
//       // 浮顶无意义——低→高同样无教评沉底，避免误导「0 分」
//       const xv = (r: XkRow): number => {
//         const m = xkPick(wb.ratings[r.c.code], r.teacher);
//         return m && m.total > 0 ? m.average : -1;
//       };
//       scored.sort((a, b) => (sortBy === "xk_desc" ? xv(b.r) - xv(a.r) : xv(a.r) - xv(b.r)));
//     }
    else scored.sort((a, b) => ((a.e?.avg ?? 6) - (b.e?.avg ?? 6)) || ((b.e?.count ?? 0) - (a.e?.count ?? 0)));
    return scored.map((x) => x.r);
  }, [uiLocale, wb.searchRows, wb.searchState, wb.courses, wb.previewIndex, query, chip, credits, day, period, conflictF, tongshi, feature, grade, bksrem, yjsrem, xknote, reviewsF, sortBy]);

  // 志愿数据渲染行按需补拉（NextTHUxk 2.0 搜索行合并尾部同款触发点）：
  // 可见行到位/翻页/筛选 → 60ms 防抖 → 院系定向增量（只拉「正在看的行」
  // 涉及的院系，已拉 doneMap 去重；不触发则搜索回来的新行永远无数据——用户十一报）。
  // 已选/候补行恒在池：预览课块的概率不该依赖「恰好被搜过」（用户实录：
  // 点别的搜索后早就选好的课概率闪没）
  useEffect(() => {
    if (wb.phase) return;
    const seen = new Set<string>();
    const pool: Array<{ code: string; seq: string; department?: string }> = [];
    const push = (code: string, seq: string, department?: string): void => {
      const k = `${code}_${seq || "0"}`;
      if (!code || seen.has(k)) return;
      seen.add(k);
      pool.push({ code, seq: seq || "0", department });
    };
    for (const r of rows) push(r.c.code, r.c.seq || "0", r.c.department);
    for (const r of wb.courses) if (r.selected || r.isCandidate) push(r.c.code, r.c.seq || "0", r.c.department);
    if (!pool.length) return;
    const t = setTimeout(() => void wb.refreshVol(pool), 60);
    return () => clearTimeout(t);
  }, [rows, wb.courses, wb.phase]);

  /* ── 分页（教务同款）：
   *  · 浏览模式：curPage = 服务端页码，翻页 = wb.gotoPage(n)（点哪页爬哪页），总页数 = 服务端「共 N 页」；
   *  · 搜索模式：本地翻页（已加载池在手，翻页零请求）；总页数/总数用服务端真值；
   *    未加载的尾部页显示提示，点「加载全部」补齐。── */
  const searchMode = Boolean(query.trim() || tongshi || feature || grade || day || period || bksrem === "1" || yjsrem === "1");
  const [uiPage, setUiPage] = useState(1);
  const [goPage, setGoPage] = useState("");
  useEffect(() => { setUiPage(1); setGoPage(""); }, [wb.searchRunId]); // 新搜索回第 1 页
  // 已选/候补兜底行只属于对应 chip 的列表——主列表（全部/可选/筛选）按纯搜索结果分页，
  // 否则 buildRows 追加的已选行会污染总数与页数（70≠60 的教训）
  const listRows = useMemo(() => {
    if (chip === "selected" || chip === "queue") return rows;
    const pk = new Set(wb.searchRaw.map((c) => `${c.code}_${c.seq || "0"}`));
    return rows.filter((r) => pk.has(r.key));
  }, [uiLocale, rows, chip, wb.searchRaw]);
//   // 官方教评按需拉（#31）：当前页可见行课号 → 500ms 间隔顺序抓（data 层节流），
//   // 教评学期内不变 → localStorage 按学期缓存，越用越快
//   useEffect(() => {
//     if (!listRows.length) return;
//     const codes = [...new Set(listRows.map((r) => r.c.code))];
//     const t = setTimeout(() => wb.fetchRatings(codes), 600);
//     return () => clearTimeout(t);
//   }, [listRows, wb.fetchRatings]);

  const totalPages = wb.searchTotalPages || Math.max(1, Math.ceil(listRows.length / 20));
  const curPage = searchMode ? Math.min(uiPage, totalPages) : wb.searchPage;
  const pagedRows = useMemo(
    () => (searchMode ? listRows.slice((curPage - 1) * 20, curPage * 20) : listRows),
    [uiLocale, listRows, searchMode, curPage],
  );
  // #23 收口：搜索落地后定位到具体课序行——翻到所在页 + 滚动到行；
  // 行不在已加载池且数据不完整 → 自动「加载全部」一轮（保险丝防循环），
  // 而不是停在课号结果顶端等用户自己翻（原 #23 全量三症状的根）。
  useEffect(() => {
    if (!jumpTarget || wb.searchState !== "ready") return;
    // #23 归一比对：课表块 seq（已选页 "1"）vs 搜索行 seq（"01"）两套前导零——
    // 裸 String 比对永远 miss，「加载全部」兜底也救不回（数据本来就全）
    const nseq = (s: string) => String(parseInt(s, 10) || 0);
    const idx = listRows.findIndex((r) => r.c.code === jumpTarget.code && nseq(r.c.seq || "0") === nseq(jumpTarget.seq || "0"));
    if (idx < 0) {
      if (wb.searchIncomplete && jumpLocateRef.current !== jumpTarget.at) {
        jumpLocateRef.current = jumpTarget.at;
        void wb.loadAllSearch();
      }
      return;
    }
    const page = Math.floor(idx / 20) + 1;
    if (searchMode && curPage !== page) setUiPage(page);
    requestAnimationFrame(() => {
      // 用命中行自己的 key 查 DOM（拿 jumpTarget.seq 拼键会因前导零对不上行键）
      const rowKey = listRows[idx]!.key;
      const el = document.querySelector(`[data-xk-row="${CSS.escape(rowKey)}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [jumpTarget, wb.searchState, listRows, wb.searchIncomplete, wb.loadAllSearch, searchMode, curPage]);

  const busy = wb.searchState === "loading" || wb.searchState === "loadingMore";
  const pageLoaded = !searchMode || !wb.searchIncomplete || curPage * 20 <= listRows.length;
  const extraFilters = [conflictF, credits, day, period, reviewsF, sortBy, tongshi, feature, grade, bksrem, yjsrem, xknote].filter(Boolean).length;
  const goJump = () => {
    const n = parseInt(goPage, 10);
    if (!Number.isFinite(n) || n < 1) return;
    if (searchMode) setUiPage(Math.min(n, totalPages));
    else void wb.gotoPage(n);
    setGoPage("");
  };

  return (
    <div className="xk-course-list">
      <div className="xk-course-tools">
        <details className="xk-notice">
          <summary>{i18n("pages.zhjwxk.courses.noticeTitle")}</summary>
          <Banner tone="warning">{i18n("pages.zhjwxk.courses.930f9dfb61f1")}<b>{i18n("pages.zhjwxk.courses.02e289f65f4d")}</b>{i18n("pages.zhjwxk.courses.69a6f2c141f6")}<Inline gap={1} wrap>
            <Btn variant="outline" size="sm" onClick={() => navigate("info", { infoNewsQuery: "北京大学 北京外国语大学" })}>{i18n("pages.zhjwxk.courses.2702f7fc3c8a")}</Btn>
            <Btn variant="outline" size="sm" onClick={() => navigate("info", { infoNewsQuery: "北京大学 研究生" })}>{i18n("pages.zhjwxk.courses.a7d043c48d9b")}</Btn>
          </Inline></Banner>
        </details>
        <OGCard pad="sm">
          <Stack gap={2}>
            <Inline gap={2} className="xk-search-row">
              <Grow>{<Input size="sm" placeholder={i18n("pages.zhjwxk.courses.2da0f8388f67")} value={query} onChange={(value) => setQuery(value)} />}</Grow>
              {query ? <Btn variant="outline" size="sm" onClick={() => setQuery("")}>×</Btn> : null}
              <Btn variant={filtersOpen ? "tonal" : "outline"} size="sm" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((v) => !v)}>{i18n("pages.zhjwxk.courses.moreFilters")}{extraFilters ? ` · ${extraFilters}` : ""}</Btn>
            </Inline>
            <Inline gap={2} className="xk-category-tabs">
              {([["all", i18n("pages.zhjwxk.courses.5c55a67935af")], ["available", i18n("pages.zhjwxk.courses.537352400c49")], ["selected", i18n("pages.zhjwxk.courses.7ecf1cde6486")], ["required", i18n("pages.zhjwxk.courses.5def9905e85f")], ["elective", i18n("pages.zhjwxk.courses.4aa68593661e")], ["sports", i18n("pages.zhjwxk.courses.ef7be5be3c13")], ["queue", i18n("pages.zhjwxk.courses.b584dd846f9a")], ["plan", i18n("pages.zhjwxk.courses.59f317cfa0db")]] as const).map(([k, label]) => (
                <Chip key={k} size="sm" selected={chip === k} onClick={() => setChip(k)}>{label}</Chip>
              ))}
            </Inline>
            <div className="xk-filter-details" hidden={!filtersOpen}>
            <div className="xk-filter-grid">
              <Grow><Select size="sm" value={conflictF} onChange={setConflictF}><option value="">{i18n("pages.zhjwxk.courses.51da637dced9")}</option><option value="noconflict">{i18n("pages.zhjwxk.courses.5261eed6794b")}</option><option value="conflict">{i18n("pages.zhjwxk.courses.ea29940ac15a")}</option></Select></Grow>
              <Grow><Select size="sm" value={credits} onChange={setCredits}><option value="">{i18n("pages.zhjwxk.courses.14a8f4b49e16")}</option>{["1", "2", "3", "4", "5+"].map((v) => <option key={v} value={v}>{v === "5+" ? i18n("pages.zhjwxk.courses.44843497379a") : i18n("pages.zhjwxk.courses.4380e27691cb", { v: String(v) })}</option>)}</Select></Grow>
              <Grow><Select size="sm" value={day} onChange={setDay}><option value="">{i18n("pages.zhjwxk.courses.610b3a3bb0aa")}</option>{[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{dayName(d)}</option>)}</Select></Grow>
              <Grow><Select size="sm" value={period} onChange={setPeriod}><option value="">{i18n("pages.zhjwxk.courses.6d77fe629c45")}</option>{SLOT_NAMES.map((n, i) => <option key={i} value={i + 1}>{i18nRich("pages.zhjwxk.courses.873290bd40ad", { value: i + 1 })}</option>)}</Select></Grow>
              <Grow><Select size="sm" value={reviewsF} onChange={setReviewsF}><option value="">{i18n("pages.zhjwxk.courses.3808d3b1f577")}</option><option value="has">{i18n("pages.zhjwxk.courses.9ab2a2d8455a")}</option><option value="cnt5">{i18n("pages.zhjwxk.courses.6adf7277bdd2")}</option><option value="r45">{i18n("pages.zhjwxk.courses.62fe195d6158")}</option><option value="r40">★≥4.0</option><option value="low">{i18n("pages.zhjwxk.courses.8a0c890e2957")}</option></Select></Grow>
              <Grow><Select size="sm" value={sortBy} onChange={setSortBy}><option value="">{i18n("pages.zhjwxk.courses.71b1a0997a52")}</option><option value="rate_desc">{i18n("pages.zhjwxk.courses.3cf587997516")}</option><option value="rate_asc">{i18n("pages.zhjwxk.courses.9eefcbca074f")}</option><option value="cnt_desc">{i18n("pages.zhjwxk.courses.ba401db1483e")}</option>{/* 【教评#31冻结】教评排序选项 <option value="xk_desc">官方教评 高→低</option><option value="xk_asc">官方教评 低→高</option> */}</Select></Grow>
              <Grow><Select size="sm" value={tongshi} onChange={setTongshi}><option value="">{i18n("pages.zhjwxk.courses.a0876e50b428")}</option>{TS_GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Grow>
              <Grow><Select size="sm" value={feature} onChange={setFeature}><option value="">{i18n("pages.zhjwxk.courses.c799be2fc953")}</option>{FEATURES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Grow>
              <Grow><Select size="sm" value={grade} onChange={setGrade}><option value="">{i18n("pages.zhjwxk.courses.d826fde21582")}</option>{["2026", "2025", "2024", "2023", "2022", "2021", "2020", "2019"].map((g) => <option key={g} value={g}>{i18nRich("pages.zhjwxk.courses.cf2dd5254476", { g: g })}</option>)}</Select></Grow>
              <Grow><Select size="sm" value={bksrem} onChange={setBksrem}><option value="">{i18n("pages.zhjwxk.courses.ae4b6316156e")}</option><option value="1">{i18n("pages.zhjwxk.courses.07ee656ca409")}</option></Select></Grow>
              <Grow><Select size="sm" value={yjsrem} onChange={setYjsrem}><option value="">{i18n("pages.zhjwxk.courses.312e77e57076")}</option><option value="1">{i18n("pages.zhjwxk.courses.e66200d4cbbd")}</option></Select></Grow>
              </div>
              <Input size="sm" placeholder={i18n("pages.zhjwxk.courses.b17cb44f0c38")} value={xknote} onChange={(value) => setXknote(value)} />
            </div>
          </Stack>
        </OGCard>
      </div>
      <div className="xk-course-results">
      <Stack gap={2}>
        {chip === "plan" ? <PlanView wb={wb} query={query} onSearchCode={(code) => jumpTo(code, "all")} /> : wb.searchState === "idle" || wb.searchState === "loading" ? (
          <Card><SkeletonRows rows={6} /><Empty text={i18n("pages.zhjwxk.courses.ac86b7d1284b")} /></Card>
        ) : wb.searchState === "error" && rows.length === 0 ? (
          <ErrorNote text={wb.searchError ?? ""} onRetry={() => void wb.retrySearch()} />
        ) : rows.length === 0 ? (
          <Card><Empty text={wb.searchError || i18n("pages.zhjwxk.courses.df8ffc573e08")} /></Card>
        ) : (
          <>
            {/* SWR 语义：刷新失败但旧结果在——保留列表只挂黄条（红条只在无结果时露脸） */}
            {wb.searchState === "error" ? (
              <Banner tone="warning" action={<Btn variant="outline" size="sm" onClick={() => void wb.retrySearch()}>{i18n("pages.zhjwxk.courses.b8784c8dd563")}</Btn>}>{i18nRich("pages.zhjwxk.courses.878421afac2a", { searchError: wb.searchError })}</Banner>
            ) : null}
            {wb.searchIncomplete ? (
              <Banner tone="warning" action={<Btn variant="outline" size="sm" disabled={busy} onClick={() => void wb.loadAllSearch()}>{busy ? i18n("pages.zhjwxk.courses.4927a53bcc88") : i18n("pages.zhjwxk.courses.d56768244576")}</Btn>}>{i18nRich("pages.zhjwxk.courses.4ae716384a8e", { length: listRows.length, value: wb.searchTotalPages > 0 ? i18n("pages.zhjwxk.courses.56a7b5abaea4", { searchTotalPages: String(wb.searchTotalPages), value: String(wb.searchTotalRows > 0 ? i18n("pages.zhjwxk.courses.f723ce33054e", { searchTotalRows: String(wb.searchTotalRows) }) : "") }) : i18n("pages.zhjwxk.courses.9896d1a50a30") })}</Banner>
            ) : null}
            <Card className="list">
              {pagedRows.map((r, i) => <PickCard key={r.key} wb={wb} r={r} i={i} picks={picks} setPicks={setPicks} highlight={r.c.code === highlight && (jumpSeq === "" || String(r.c.seq || "0") === String(jumpSeq || "0"))} />)}
              {pagedRows.length === 0 && !pageLoaded ? (
                <Empty text={i18n("pages.zhjwxk.courses.7bce208862bb")} />
              ) : null}
            </Card>
            <Inline gap={2} justify="center" wrap className="xk-pagination">
              <Btn variant="outline" size="sm" disabled={busy || (searchMode ? curPage <= 1 : wb.searchPage <= 1)} onClick={() => (searchMode ? setUiPage(curPage - 1) : void wb.gotoPage(wb.searchPage - 1))}>{i18n("pages.zhjwxk.courses.c9b9ae7a6144")}</Btn>
              <Text slot="label" tone="faint">{i18nRich("pages.zhjwxk.courses.096a7bc0a88d", { curPage: curPage, totalPages: totalPages, value: searchMode && !wb.searchIncomplete ? i18n("pages.zhjwxk.courses.1d58af91498f", { length: String(listRows.length) }) : "" })}</Text>
              <Btn variant="outline" size="sm" disabled={busy || (searchMode ? curPage >= totalPages : !wb.searchHasMore && !(wb.searchTotalPages > wb.searchPage))} onClick={() => {
                  if (searchMode) setUiPage(curPage + 1);
                  else void wb.gotoPage(wb.searchPage + 1);
                }}>{i18n("pages.zhjwxk.courses.8a8542f69648")}</Btn>
              <Inline gap={1} className="xk-page-jump-group">
                <Text slot="label" tone="faint" nowrap>{i18n("pages.zhjwxk.courses.83954f3e3c76")}</Text>
                <Input size="sm" className="xk-page-jump" inputMode="numeric" value={goPage} onChange={(value) => setGoPage(value.replace(/[^0-9]/g, ""))} onKeyDown={(e) => e.key === "Enter" && goJump()} />
                <Btn variant="outline" size="sm" disabled={busy || !goPage} onClick={goJump}>GO</Btn>
              </Inline>
            </Inline>
          </>
        )}
      </Stack>
      </div>
    </div>
  );
}

/* ══════════ 培养方案视图（render.js renderPlanView 逐行移植）══════════ */
function PlanView({ wb, query, onSearchCode }: { wb: ReturnType<typeof useXkWorkbench>; query: string; onSearchCode: (code: string) => void }) {
  const uiLocale = useUiLocale();

  const coverage = useMemo(() => checkPlanCoverage(wb.plan, wb.courses, wb.stageCart, wb.savedDrafts.map((d) => d.courses), (wb.semester ?? "").endsWith("2")),
    [uiLocale, wb.plan, wb.courses, wb.stageCart, wb.savedDrafts, wb.semester]);
  useEffect(() => {
    planGroupClick = () => { setPresetGroupChip?.("plan"); };
    return () => { planGroupClick = null; };
  }, []);
  if (wb.plan.length === 0 && wb.searchState !== "ready") {
    return <Card><SkeletonRows rows={4} /><Empty text={i18n("pages.zhjwxk.courses.49e9e6d0c944")} /></Card>;
  }
  if (!coverage.length) {
    return (
      <Card>
        <Empty text={i18n("pages.zhjwxk.courses.8ade52e3ff55")} />
        <Inline justify="center">
          <Btn variant="outline" onClick={() => void wb.refresh()}>{i18n("pages.zhjwxk.courses.b8784c8dd563")}</Btn>
        </Inline>
      </Card>
    );
  }
  const q = query.trim().toLowerCase();
  const filtered = q ? coverage.filter((p) => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q) || (p.attr || "").includes(q)) : coverage;
  const groups = new Map<string, PlanCoverageItem[]>();
  for (const p of filtered) {
    const g = p.group || p.attr || i18n("pages.zhjwxk.courses.d2909f1647e7");
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(p);
  }
  const totalCr = coverage.reduce((s, c) => s + c.credits, 0);
  const coveredCr = coverage.filter((c) => c.covered).reduce((s, c) => s + c.credits, 0);
  const coveredN = coverage.filter((c) => c.covered).length;
  return (
    <>
      <OGCard pad="sm">
        <Text slot="label" weight="bold">{i18nRich("pages.zhjwxk.courses.f391fe0280a5", { coveredN: coveredN, length: coverage.length, coveredCr: coveredCr, totalCr: totalCr })}</Text>
        <Stack gap={1}>
          <Progress value={totalCr ? coveredCr / totalCr : 0} size="sm" />
        </Stack>
      </OGCard>
      {[...groups.entries()].map(([g, courses]) => {
        const gTotal = courses.reduce((s, c) => s + c.credits, 0);
        const gCovered = courses.filter((c) => c.covered).reduce((s, c) => s + c.credits, 0);
        return (
          <Stack key={g} gap={1}>
            {/* 组头：Surface sunken 承担旧「灰底圆角条」的材质（--og-surface-3） */}
            <Surface sunken radius="sm">
              <Inline gap={2} pad={1}>
                <Text slot="label" weight="bold">{g}</Text>
                <Spacer />
                <Text slot="label" tone={gCovered >= gTotal ? "success" : "faint"}>{i18nRich("pages.zhjwxk.courses.03132616defc", { gCovered: gCovered, gTotal: gTotal })}</Text>
              </Inline>
            </Surface>
            {courses.map((p) => (
              <Row key={p.code} size="sm" titleAttr={i18n("pages.zhjwxk.courses.4e2b44f1e949", { code: String(p.code) })} onClick={() => onSearchCode(p.code)}
                leading={<Text slot="label" tone={p.covered ? "success" : "error"}>{p.covered ? "✓" : "✗"}</Text>}
                title={p.name}
                meta={<Text slot="micro" tone="faint">{p.code}</Text>}
                trailing={
                  <Inline gap={2}>
                    <Text slot="label" tone="faint" nowrap>{i18nRich("pages.zhjwxk.courses.93fbcc41041a", { credits: p.credits })}</Text>
                    {p.covered
                      ? <Text slot="label" tone="success" nowrap>{p.coveredBy || i18n("pages.zhjwxk.courses.a42029434c65")}</Text>
                      : <Text slot="label" tone="error">{i18n("pages.zhjwxk.courses.ec9205286c3d")}</Text>}
                  </Inline>
                }
              />
            ))}
          </Stack>
        );
      })}
    </>
  );
}
let setPresetGroupChip: ((v: string) => void) | null = null;

/* ══════════ 课程卡（四态）══════════ */
function PickCard({ wb, r, i, picks, setPicks, highlight }: {
  wb: ReturnType<typeof useXkWorkbench>; r: XkRow; i: number;
  picks: Record<string, { flag: XkFlag; zy: number }>;
  setPicks: (f: (m: Record<string, { flag: XkFlag; zy: number }>) => Record<string, { flag: XkFlag; zy: number }>) => void;
  highlight: boolean;
}) {
  const uiLocale = useUiLocale();

  const { navigate } = useApp();
  const key = r.key;
  const inStage = wb.stageCart.some((s) => s.code === r.c.code && String(s.seq || "0") === String(r.c.seq || "0"));
  const pick = picks[key] ?? { flag: allowedFlags(r.flag)[0]!, zy: 3 };
  const cap = r.vol?.capacity || r.c.capacity || 0;
  const applied = r.vol?.applied ?? 0;
  const prob = itemProb(wb, r.c.code, r.c.seq, pick.flag, pick.zy);
  const confs = findPreviewConflicts({ code: r.c.code, seq: r.c.seq, time: r.time, name: r.name }, wb.previewIndex);
  // 队列阶段缺 queueMap 条目 → 行数据合成（NextTHUxk render.js 同款）：按需
  // 查询模型下搜索行天然不在 map（查询集=已选+候补+暂存），不合成会整个
  // 掉进志愿统计分支——课余量模式卡片显示志愿数据的怪象（2026-09-14 实锤）
  const q = r.q ?? (wb.phase ? { qRemaining: r.c.remaining, qCapacity: r.c.capacity, qQueue: 0 } : undefined);
  const state = r.selected ? "selected" : r.isCandidate ? "candidate" : wb.phase && q && q.qRemaining === 0 && q.qQueue === 0 ? "full" : "available";
  const showInlineProb = state === "selected" || state === "candidate"; // 可用行操作行已有概率 chip，不双显

  return (
    <div className="row xk-course-row" data-xk-row={r.key} style={{ animationDelay: `${Math.min(i, 20) * 20}ms`, ...(highlight ? { outline: "2px solid var(--accent)" } : {}) }}>
      <div className="row-when">
        <Text as="b" weight="bold" tone={wb.phase && q ? (q.qRemaining > 0 ? "success" : q.qQueue > 0 ? "warning" : "error") : heatTone(applied, cap)}>
          {wb.phase ? (q?.qRemaining ?? r.c.remaining) : r.c.remaining}
        </Text>
        <span>{wb.phase ? i18n("pages.zhjwxk.courses.628a729f6d7c") : i18n("pages.zhjwxk.courses.628a729f6d7c")}</span>
      </div>
      <div className="row-main">
        <Stack gap={1}>
          <div className="row-title" style={{ whiteSpace: "normal" }}>
            {(() => { const o = originOf(r.c.code); return o
              ? <Tag tone={ORIGIN_TONE[o]}>{labelForId(o)}</Tag>
              : null; })()}
            <span className="xk-course-name">{r.name}</span>
      <Chip size="sm" tone={r.selected ? "success" : r.isCandidate ? "warning" : state === "full" ? "error" : "neutral"}>
        {r.selected ? i18n("pages.zhjwxk.courses.aa21e6887117", { value: String(r.zy ? i18n("pages.zhjwxk.courses.2ea763bbee3e", { zy: String(r.zy) }) : "") }) : r.isCandidate ? (r.cand?.myPos ? i18n("pages.zhjwxk.courses.4d4f91afcd66", { myPos: String(r.cand.myPos) }) : i18n("pages.zhjwxk.courses.64af28c77281")) : state === "full" ? i18n("pages.zhjwxk.courses.0ba6b11d9de0") : r.available ? i18n("pages.zhjwxk.courses.537352400c49") : i18n("pages.zhjwxk.courses.0ba6b11d9de0")}
      </Chip>

            {/* 【教评#31冻结】行内教评徽章（整块注释保留，教务修好解开；外观改走 OG Tag/tone）
             {(() => {
               const m = xkPick(wb.ratings[r.c.code], r.teacher);
               if (!m || m.total <= 0) return null;
               const dist = m.distribution.map((v, i) => `${i + 1}分:${v}`).join(" ");
               return (
                 <Tag tone={m.average >= 6 ? "success" : m.average >= 5 ? "warning" : "error"}
                   title={`官方教评 · ${m.teacher}：均分 ${m.average.toFixed(2)} / 7 · ${m.total} 人评分 · 高分率 ${(m.highRatio * 100).toFixed(0)}%\n${dist}\n（选课学生推荐度，教务 xgpg 数据）`}
                 >教评 {m.average.toFixed(1)}({m.total})</Tag>
               );
             })()}

            */}
          </div>
          {/* 元数据分属性表述（用户实锤「一堆灰字挤在一起看不清」）：课号班次=等宽
              chip；教师=加粗主色正文；时间=accent chip；学分=中性小字；院系=弱化尾注 */}
          <Inline gap={1} wrap className="xk-course-meta">
            {/* 纯数字教师=教务多教师格解析未明（取证中，见 xkParseDebug）——隐藏不误导 */}
            {r.teacher && !/^\d{1,3}$/.test(r.teacher) ? <Text as="b" weight="semibold" nowrap>{r.teacher}</Text> : null}
            {r.time ? <Chip size="sm" tone="brand">{r.time}</Chip> : null}
            {r.credits ? <Text slot="label" tone="quiet" nowrap>{i18nRich("pages.zhjwxk.courses.2cb6ebd1ab1f", { credits: r.credits })}</Text> : null}
          </Inline>
          {(() => { const o = originOf(r.c.code); if (!o) return null;
            if (clockRangesOf(r.c.note, r.time).length > 0) return null; // 时间已解析上时间轴，不废话
            return (
            <Inline gap={2} vAlign="start">
              <Text slot="label" tone="warning">{i18nRich("pages.zhjwxk.courses.4583bde5e031", { o: labelForId(o) })}</Text>
              <Grow>
                <Btn variant="outline" size="sm" onClick={() => navigate("info", { infoNewsQuery: o === "北大研" ? "北京大学 研究生" : "北京大学 北京外国语大学" })}>{i18nRich("pages.zhjwxk.courses.3cd7d874f722", { value: o === "北大研" ? i18n("pages.zhjwxk.courses.44a94cb2b71a") : i18n("pages.zhjwxk.courses.06ac33331166") })}</Btn>
              </Grow>
            </Inline>
            ); })()}
          {confs.length ? (
            <div className="row-sub" style={{ whiteSpace: "normal" }}>
              <Text slot="label" tone="error">{i18nRich("pages.zhjwxk.courses.06f610639057", { value: confs.slice(0, 3).map((c) => `${dayName(c.day)} ${SLOT_NAMES[c.slot - 1]} ${c.b}`).join(" · ") })}</Text>
            </div>
          ) : null}
          <div className="xk-course-content">
            <Stack gap={1} className="xk-course-description">
                <Inline gap={2} wrap>
            {r.teacherId ? <Btn variant="outline" size="sm" onClick={() => openDetail(r.c.code, r.teacherId)}>{i18n("pages.zhjwxk.courses.8131eafd0239")}</Btn> : null}
            {tbBadge(r) ? (
              <Btn variant="outline" size="sm" onClick={() => openReviews({ code: r.c.code, seq: r.c.seq, name: r.name, teacher: r.teacher })}>{tbBadge(r)}</Btn>
            ) : null}
                </Inline>
                <Inline gap={2} wrap>
            <Chip size="sm"><Text mono slot="micro">{r.c.code}{r.c.seq && r.c.seq !== "0" ? i18n("pages.zhjwxk.courses.6503ee4eb9dd", { seq: String(r.c.seq) }) : ""}</Text></Chip>
            {r.c.department ? <Text slot="label" tone="faint">{r.c.department}</Text> : null}
                </Inline>
          {/* 课程特色标签行（NextTHUxk nx-tag 同款）：独立成行、一段一标签、
              flexWrap 换行——挂标题行内会被 nowrap+overflow 裁出 CSS 省略号
              （用户实锤：复制是全文、看到的是「文化素质…」） */}
          {(() => {
            // 源数据服务端截断（"新生研讨…"）：剥省略点 → 筛选器规范全值表前缀补全
            const canon = (seg: string): string => {{
              if (seg.length < 3) return seg;
              const hit = FEATURES.map(([v]) => v).filter((v) => v.startsWith(seg) && v !== seg).sort((a, b) => a.length - b.length)[0];
              return hit ?? seg;
            }};
            const segs = (r.c.feature || "")
              .split(/[;；,，]/)
              .map((t) => t.replace(/[\s.。…·—-]/g, "").trim())
              .filter(Boolean)
              .map(canon);
            return segs.length ? (
              <Inline gap={1} wrap>
                {segs.map((t) => (
                  <Tag key={t} tone="brand">{t}</Tag>
                ))}
              </Inline>
            ) : null;
          })()}
          {r.c.note ? (
            <div className="xk-course-note">
              <Text>
                <Text as="b" slot="label" tone="brand" weight="bold">{i18n("pages.zhjwxk.courses.6ad41e5d286b")}</Text>
                {"　"}
                {r.c.note}
              </Text>
            </div>
          ) : null}
            </Stack>
            <Stack gap={1} className="xk-course-statistics">
          {wb.phase ? (
            r.cand ? <div className="row-sub" style={{ whiteSpace: "normal" }}>{r.cand.myPos ? i18n("pages.zhjwxk.courses.f09113c77540", { myPos: String(r.cand.myPos), queueTotal: String(r.cand.queueTotal) }) : i18n("pages.zhjwxk.courses.90c4b556f895")}</div> : null
          ) : r.vol ? (
            <div className="row-sub" style={{ whiteSpace: "normal" }}>
              {(() => {
                // 志愿统计行（NextTHUxk 2.0 render.js 同款）：体/必/限/任 前缀，
                // '0,0,0' 全零段滤除（fmtVol 全零也返回空，双保险）
                const parts: string[] = [];
                if (isSportsCourse(r) && r.vol.volSports && r.vol.volSports !== "0,0,0") {
                  const v = fmtVol(r.vol.volSports);
                  if (v) parts.push(i18n("pages.zhjwxk.courses.7325240aedc4", { v: String(v) }));
                } else {
                  if (r.vol.volRequired && r.vol.volRequired !== "0,0,0") { const v = fmtVol(r.vol.volRequired); if (v) parts.push(i18n("pages.zhjwxk.courses.c7acb7331269", { v: String(v) })); }
                  if (r.vol.volElective && r.vol.volElective !== "0,0,0") { const v = fmtVol(r.vol.volElective); if (v) parts.push(i18n("pages.zhjwxk.courses.cd80acb3d16b", { v: String(v) })); }
                  if (r.vol.volOptional && r.vol.volOptional !== "0,0,0") { const v = fmtVol(r.vol.volOptional); if (v) parts.push(i18n("pages.zhjwxk.courses.4b1d2df912f5", { v: String(v) })); }
                }
                return parts.join("　");
              })()}
              {showInlineProb ? <Text slot="label" tone={probTone(prob.probNum)}>{prob.prob}</Text> : null}
            </div>
          ) : (r.c.capacity || r.c.remaining) ? (
            // 队列阶段未开放/志愿接口被拦（xkqkSearch 弹「功能未开放」→ volMap 恒空）
            // 时用目录行自带容量/余量兜底——插件 probInline 同源（kkxxSearch td6/td7）。
            // 不兜底则所有卡片的容量行整体消失（2026-09-03 实录）
            <div className="row-sub" style={{ whiteSpace: "normal" }}>
              {[r.c.capacity ? i18n("pages.zhjwxk.courses.4c0f5dc662f8", { capacity: String(r.c.capacity) }) : "", typeof r.c.remaining === "number" ? i18n("pages.zhjwxk.courses.e5e83906ac41", { remaining: String(r.c.remaining) }) : ""].filter(Boolean).join(" · ")}
              {showInlineProb ? <Text slot="label" tone={probTone(prob.probNum)}>{prob.prob}</Text> : null}
            </div>
          ) : null}
          {/* 竞争条（NextTHUxk 2.0 compHtml 回移）：占用对按阶段取数（occupancyOf），
              已满(余0)绝不显示 0/N 宽松假象；比例 ≤0.8 绿 / ≤1.2 黄 / 其余红。
              仅预选模式——队列阶段概率走排队/余量模型（插件同款阶段门控），
              志愿竞争条混在课余量模式是「志愿数据怪象」的残余（2026-09-14 实锤） */}
          {(() => {
            if (wb.phase) {
              // 队列阶段：余量/排队进度条（用户实锤要求醒目化）：余>0 绿、有排队
              // 黄、满且无队 红；条长=满员度，右侧粗体 余X/帽Y·排队N人
              if (!q || !q.qCapacity) return null;
              const used = Math.max(0, q.qCapacity - q.qRemaining);
              const pct = Math.min(100, Math.round((used / q.qCapacity) * 100));
              const tone = q.qRemaining > 0 ? "success" : q.qQueue > 0 ? "warning" : "error";
              return (
                <Inline gap={2}>
                  <Grow><Progress value={pct / 100} tone={tone} size="sm" /></Grow>
                  <Text slot="label" tone={tone} weight="bold" nowrap>{i18nRich("pages.zhjwxk.courses.e371bb0c700d", { qRemaining: q.qRemaining, qCapacity: q.qCapacity, value: q.qQueue > 0 ? i18n("pages.zhjwxk.courses.a1065b209234", { qQueue: String(q.qQueue) }) : "" })}</Text>
                </Inline>
              );
            }
            const occ = occupancyOf({ capacity: r.c.capacity, remaining: r.c.remaining, vol: r.vol }, wb.phase);
            if (!occ.cap) return null;
            const vc = volColor(occ.applied, occ.cap);
            const tone = levelTone(vc.level);
            const barTone = vc.level === "unknown" ? "accent" as const : (tone === "faint" ? "accent" : tone) as "accent" | "success" | "warning" | "error";
            const label = vc.level === "easy" ? i18n("pages.zhjwxk.courses.8490de9e4f0a") : vc.level === "medium" ? i18n("pages.zhjwxk.courses.5ca6cb21cd29") : vc.level === "hard" ? i18n("pages.zhjwxk.courses.135fef5e1db6") : "";
            return (
              <Inline gap={2}>
                <Grow><Progress value={vc.pct / 100} tone={barTone} size="sm" /></Grow>
                <Text slot="micro" tone={tone} nowrap>{occ.applied}/{occ.cap}{label ? ` · ${label}` : ""}</Text>
              </Inline>
            );
          })()}
          {/* 三行概率网格（NextTHUxk 2.0 fullProbGrid 回移）：必修/限选/任选 ×
              1/2/3 志愿全显，无数据格灰显——显示侧全开（用户十六报拍板）。
              仅预选模式（队列阶段志愿数据无意义——排队模型阶段门控） */}
          {!wb.phase ? <Stack gap={1}>
            {fullProbGrid(cap, r.vol, isSportsCourse(r)).map((row) => (
              <Inline key={row.flag} gap={2} vAlign="baseline">
                <Text slot="micro" tone="faint">{FLAG_LABELS[row.flag]}</Text>
                {row.cells.map((p, zi) => (
                  <Text key={zi} slot="micro" tone={probTone(p.prob)} weight={p.prob >= 0 ? "semibold" : "regular"}>{i18nRich("pages.zhjwxk.courses.04071043a9de", { value: zi + 1, label: p.label, value2: p.prob >= 0 && p.ratioLabel ? ` · ${p.ratioLabel}` : "" })}</Text>
                ))}
              </Inline>
            ))}
          </Stack> : null}
            </Stack>
          </div>
            <div className="xk-course-controls">
          {state === "selected" ? (
            <Inline gap={1} wrap>
              {r.zy ? <Text slot="label" tone="faint">{i18nRich("pages.zhjwxk.courses.6dfa4700bf10", { value: FLAG_LABELS[r.flag], zy: r.zy })}</Text> : null}
              <Btn variant="outline" size="sm" disabled={!(r.zy > 1 && wb.canAdjustZy(r.c.code, r.c.seq, r.zy - 1)) || wb.busy !== null} titleAttr={r.zy > 1 && wb.canAdjustZy(r.c.code, r.c.seq, r.zy - 1) ? "" : i18n("pages.zhjwxk.courses.0bc08374ab3a")} onClick={() => void wb.changeZy(r.c.code, r.c.seq, r.zy - 1)}>▲</Btn>
              <Btn variant="outline" size="sm" disabled={!(r.zy < 3 && wb.canAdjustZy(r.c.code, r.c.seq, r.zy + 1)) || wb.busy !== null} titleAttr={r.zy < 3 && wb.canAdjustZy(r.c.code, r.c.seq, r.zy + 1) ? "" : i18n("pages.zhjwxk.courses.0bc08374ab3a")} onClick={() => void wb.changeZy(r.c.code, r.c.seq, r.zy + 1)}>▼</Btn>
              <Btn variant="outline" size="sm" disabled={inStage} onClick={() => wb.addToStage(r, r.flag, r.zy || 3)}>{inStage ? i18n("pages.zhjwxk.courses.847d376afd41") : i18n("pages.zhjwxk.courses.e57b6dbedea3")}</Btn>
              <Btn variant="outline" size="sm" disabled={wb.busy !== null} onClick={() => void (async () => { if (await confirmDanger(i18nMsg("pages.zhjwxk.courses.5b1ff08354a0", { name: String(r.name), code: String(r.c.code), value: String(r.c.seq || "0") }), DROP_CONFIRM)) await wb.drop(r.c.code, r.c.seq, false); })()}>{i18n("pages.zhjwxk.courses.639c677f0c52")}</Btn>
            </Inline>
          ) : state === "candidate" ? (
            <Inline gap={2}>
              <Text slot="label" tone="warning">{r.cand ? (r.cand.myPos ? i18n("pages.zhjwxk.courses.519d719dc036", { myPos: String(r.cand.myPos), queueTotal: String(r.cand.queueTotal) }) : i18n("pages.zhjwxk.courses.def2a886248f")) : i18n("pages.zhjwxk.courses.def2a886248f")}</Text>
              {r.teacherId ? <Btn variant="outline" size="sm" onClick={() => openDetail(r.c.code, r.teacherId)}>{i18n("pages.zhjwxk.courses.8131eafd0239")}</Btn> : null}
              <Btn variant="outline" size="sm" disabled={wb.busy !== null} onClick={() => void wb.drop(r.c.code, r.c.seq, true)}>{i18n("pages.zhjwxk.courses.2f9daa828907")}</Btn>
            </Inline>
          ) : (
            <Inline gap={1} wrap>
              {state === "full" ? <Text slot="label" tone="error">{i18n("pages.zhjwxk.courses.0ba6b11d9de0")}</Text> : null}
              <Select size="sm" value={pick.flag} disabled={wb.busy !== null} onChange={(value) => setPicks((m) => ({ ...m, [key]: { ...pick, flag: value as XkFlag } }))}>{allowedFlags(pick.flag).map((f) => <option key={f} value={f}>{FLAG_LABELS[f]}</option>)}</Select>
              {!wb.phase ? <Select size="sm" value={String(pick.zy)} disabled={wb.busy !== null} onChange={(value) => setPicks((m) => ({ ...m, [key]: { ...pick, zy: Number(value) } }))}>{[3, 2, 1].map((z) => <option key={z} value={z}>{i18nRich("pages.zhjwxk.courses.b2af275db60a", { z: z })}</option>)}</Select> : null}
              {!wb.phase ? (
                <Text slot="label" tone={probTone(prob.probNum)}>{prob.prob}</Text>
              ) : null}
              <Btn variant="outline" size="sm" disabled={wb.busy !== null} onClick={() => void wb.submit(r.c.code, r.c.seq, pick.zy, pick.flag)}>{wb.busy === `submit-${r.c.code}-${r.c.seq}` ? i18n("pages.zhjwxk.courses.18931020ad52") : state === "full" ? i18n("pages.zhjwxk.courses.2e486022e4f8") : i18n("pages.zhjwxk.courses.fd17d86dd268")}</Btn>
              <Btn variant="outline" size="sm" disabled={inStage} onClick={() => wb.addToStage(r, pick.flag, pick.zy)}>{inStage ? i18n("pages.zhjwxk.courses.847d376afd41") : i18n("pages.zhjwxk.courses.e57b6dbedea3")}</Btn>
            </Inline>
          )}
          </div>
        </Stack>
      </div>

    </div>
  );
}

/* ══════════ 右栏⓪：培养方案（render.js renderPlan 同款卡片网格）══════════ */
function PlanSection({ wb }: { wb: ReturnType<typeof useXkWorkbench> }) {
  const uiLocale = useUiLocale();

  const coverage = useMemo(() => checkPlanCoverage(wb.plan, wb.courses, wb.stageCart, wb.savedDrafts.map((d) => d.courses), (wb.semester ?? "").endsWith("2")),
    [uiLocale, wb.plan, wb.courses, wb.stageCart, wb.savedDrafts, wb.semester]);
  if (!wb.plan.length) return null;
  const groups = new Map<string, PlanCoverageItem[]>();
  for (const c of coverage) {
    const g = c.group || c.attr || i18n("pages.zhjwxk.courses.d2909f1647e7");
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(c);
  }
  const totalCr = coverage.reduce((s, c) => s + c.credits, 0);
  const coveredCr = coverage.filter((c) => c.covered).reduce((s, c) => s + c.credits, 0);
  return (
    <OGCard pad="sm">
      <details className="xk-plan-summary">
        <summary><Text slot="label" weight="bold">{i18n("pages.zhjwxk.courses.c97657457226")}</Text><Text slot="micro" tone="faint">{i18nRich("pages.zhjwxk.courses.5c1672e6a3bf", { length: coverage.length, coveredCr, totalCr })}</Text></summary>
        <List gap={0}>
        {[...groups.entries()].map(([g, items]) => {
          const cr = items.reduce((a, c) => a + c.credits, 0);
          const cov = items.filter((c) => c.covered).reduce((a, c) => a + c.credits, 0);
          return (
            <Row key={g} size="sm" title={i18n("pages.zhjwxk.courses.3c3926abccf0", { g: String(g), length: String(items.length) })}
              trailing={<Text slot="label" tone={cov >= cr ? "success" : "brand"}>{cov}/{cr}</Text>}
              onClick={() => { planGroupClick?.(g); }} />
          );
        })}
        </List>
      </details>
    </OGCard>
  );
}
let planGroupClick: ((g: string) => void) | null = null;

/* ══════════ 右栏②：课表预览（render.js renderPreviewTT 逐行移植）══════════ */
function PreviewSection({ wb }: { wb: ReturnType<typeof useXkWorkbench> }) {
  const uiLocale = useUiLocale();

  const [mOpen, setMOpen] = useState(false);
  const [mName, setMName] = useState("");
  const [mDay, setMDay] = useState("1");
  // 默认值必须是真实选项值（19:20/20:55 非半小时刻度曾致 select 视觉回落 08:00/08:30 而 state 不变——实测事故）
  const [mBegin, setMBegin] = useState("08:00");
  const [mEnd, setMEnd] = useState("08:30");
  const mode = wb.previewMode;

  // 课程池：selected 模式用合并行（含 note——北大/北外真实钟点在 note 里），stage/draft 用暂存/草稿
  const courses = useMemo<Array<{ name: string; teacher?: string; code: string; seq: string; time: string; note: string; credits: number; zy: number; manual?: boolean; id?: string; flag?: XkFlag; typeCode?: string; isCandidate?: boolean; cand?: boolean }>>(() => {
    if (mode === "selected") {
      // 已选视图含候补课（参照插件 renderCourses 已选筛选：selected ∪ 候选键）——
      // 琥珀块与正式课重叠时 lane 分道共处。时间正源 = 候选自带（格子坐标已抽），
      // 目录仅兜底。注意：候选只属于已选视图——暂存/草稿是纯暂存车（插件语义）
      return [
        ...wb.courses.filter((r) => r.selected).map((r) => ({
          name: r.name, teacher: r.teacher, code: r.c.code, seq: r.c.seq || "0", time: r.time, note: r.c.note ?? "",
          credits: r.credits, zy: r.zy, typeCode: r.sel?.typeCode, isCandidate: false,
        })),
        ...wb.candidates.map((x) => {
          const cat = wb.courses.find((r) => r.c.code === x.code);
          const time = parseTimeSlots(x.time).length ? x.time : cat?.time && parseTimeSlots(cat.time).length ? cat.time : x.time;
          return { name: x.name, teacher: x.teacher || cat?.teacher || undefined, code: x.code, seq: x.seq || "0", time, note: "", credits: 0, zy: 0, isCandidate: true, cand: true };
        }),
      ];
    }
    // 外校课真实时间在 note 里：暂存/草稿必须带回（旧数据无 note → 回查目录兜底）
    const noteOf = (x: { code: string; seq: string; note?: string }): string =>
      x.note ?? wb.courses.find((y) => y.c.code === x.code && String(y.c.seq || "0") === String(x.seq || "0"))?.c.note ?? "";
    // 暂存/草稿时间缺口回查目录（插件 stageCart 行吃 allCourses 全量元数据同款语义）：
    // 暂存时行 time 为空（目录未及）会整块掉「时间未定」区——预览更不完整实录
    const timeOf = (x: { code: string; seq: string; time?: string }): string =>
      x.time && parseTimeSlots(x.time).length ? x.time : wb.courses.find((y) => y.c.code === x.code && String(y.c.seq || "0") === String(x.seq || "0"))?.time || x.time || "";
    if (mode === "stage") return wb.stageCart.map((x) => ({ name: x.name, teacher: x.teacher, code: x.code, seq: x.seq || "0", time: timeOf(x), note: noteOf(x), credits: x.credits, zy: x.zy, flag: x.flag }));
    return (wb.savedDrafts[wb.previewDraftIdx]?.courses ?? []).map((x) => ({ name: x.name, teacher: x.teacher, code: x.code, seq: x.seq || "0", time: timeOf(x), note: noteOf(x), credits: x.credits, zy: x.zy, flag: x.flag }));
  }, [uiLocale, mode, wb]);

  // 概率/余量信息：返回 OG 语义 tone + 原始标签（色块不再由 hex 决定，
  // 由渲染侧按 tone/family 映射 --og-success/warning/error/accent 一族）
  const probOf = (c: { code: string; seq: string; zy: number; manual?: boolean; flag?: XkFlag; typeCode?: string }): { tone: "good" | "warn" | "bad" | "off"; label: string } => {
    if (c.manual) return { tone: "off", label: i18n("pages.zhjwxk.courses.c0aa76aebce6") };
    if (wb.phase) {
      const qKey = `${c.code}_${c.seq || "0"}`;
      const r = wb.courses.find((x) => x.c.code === c.code && String(x.c.seq || "0") === String(c.seq || "0"));
      const qd = wb.queueMap[qKey] ?? r?.q;
      const cand = wb.candidates.find((cc) => cc.code === c.code && String(cc.seq) === String(c.seq || "0"));
      if (cand) return { tone: "warn", label: cand.myPos ? i18n("pages.zhjwxk.courses.1a01e52411e2", { myPos: String(cand.myPos), queueTotal: String(cand.queueTotal) }) : i18n("pages.zhjwxk.courses.64af28c77281") };
      if (mode === "selected") return { tone: "good", label: i18n("pages.zhjwxk.courses.7ecf1cde6486") };
      if (qd) {
        if (qd.qRemaining > 0) return { tone: "good", label: i18n("pages.zhjwxk.courses.fab993c6ff6f", { qRemaining: String(qd.qRemaining) }) };
        if (qd.qQueue > 0) return { tone: "warn", label: i18n("pages.zhjwxk.courses.57273d4232a7", { qQueue: String(qd.qQueue) }) };
        return { tone: "bad", label: i18n("pages.zhjwxk.courses.0ba6b11d9de0") };
      }
      return { tone: "off", label: "" };
    }
    if (mode === "selected" && c.zy) {
      const sf = (c.typeCode ? typeCodeToFlag(c.typeCode) : (c.flag ?? "bx")) as XkFlag;
      const vol = r2vol(wb, c.code, c.seq);
      const p = calcProb(vol?.capacity || 0, vol, sf, c.zy);
      return { tone: p.prob >= 0 ? toBlockTone(probTone(p.prob)) : "off", label: p.prob >= 0 ? (p.percentLabel || p.label) : "" };
    }
    if ((mode === "stage" || mode === "draft") && c.flag && c.zy) {
      const vol = r2vol(wb, c.code, c.seq);
      const p = calcProb(vol?.capacity || 0, vol, c.flag, c.zy);
      return { tone: p.prob >= 0 ? toBlockTone(probTone(p.prob)) : "off", label: p.prob >= 0 ? (p.percentLabel || p.label) : "" };
    }
    return { tone: "off", label: "" };
  };

  // 时间轴课块：清华课按大节→钟点；北大/北外等外校课 time 列无槽位，从 note 解析「周X HH:MM—HH:MM」
  const { placed, undet } = useMemo(() => {
    type PvBlock = { key: string; day: number; begin: number; end: number; label: string; tone: "normal" | "good" | "warn" | "bad"; cand: boolean; manual: boolean; probLabel?: string; id?: string; code?: string; seq?: string; origin?: string; tag?: string };
    const raw: PvBlock[] = [];
    const undet: Array<{ lbl: string; code: string; seq: string; credits: number; zy: number; manual: boolean; id?: string }> = [];
    type PvCourse = { name: string; teacher?: string; code: string; seq: string; time: string; note: string; credits: number; zy: number; manual?: boolean; id?: string; flag?: XkFlag; typeCode?: string; begin?: string; end?: string; day?: number; cand?: boolean };
    const all: PvCourse[] = [
      ...courses,
      ...wb.manualEvents.map((e): PvCourse => ({ name: e.name, teacher: undefined, code: e.code, seq: e.seq, time: e.time, note: "", credits: e.credits, zy: 0, manual: true, id: e.id, begin: e.begin, end: e.end, day: e.day })),
    ];
    for (const c of all) {
      const lbl = (c.cand ? i18n("pages.zhjwxk.courses.fa33afcd5d0c") : "") + (c.teacher ? `${c.name}(${c.teacher})` : c.name);
      const prob = probOf(c);
      // 填充族：候选=warning、手动占用=normal（渲染层再加 accent 强线）、
      // 概率分档=good/warn/bad、普通课=normal；未命中概率=normal
      const family: PvBlock["tone"] = c.cand ? "warn" : c.manual ? "normal" : prob.tone === "off" || !prob.label ? "normal" : (prob.tone as "good" | "warn" | "bad");
      const mk = (day: number, begin: number, end: number, tag: string): PvBlock => ({
        key: `${c.code}_${c.seq || "0"}_${tag}`, day, begin, end, label: lbl, tone: family, cand: Boolean(c.cand), manual: Boolean(c.manual),
        probLabel: prob.label || undefined, id: c.id, code: c.code, seq: c.seq, origin: originOf(c.code),
      });
      let n = 0;
      for (const { day, slot } of parseTimeSlots(c.time)) {
        const range = SLOT_RANGE[slot - 1];
        if (!range) continue;
        raw.push(mk(day, range[0], range[1], `${slot}`));
        n += 1;
      }
      if (n === 0 && c.manual && c.begin && c.end && c.day && pvToMin(c.begin) < pvToMin(c.end)) {
        raw.push(mk(c.day, pvToMin(c.begin), pvToMin(c.end), "clock"));
        n += 1;
      }
      if (n === 0) {
        for (const cr of clockRangesOf(c.note, c.time)) {
          const b = { ...mk(cr.day, cr.begin, cr.end, `c${cr.begin}`), tag: cr.tag };
          raw.push(b);
          n += 1;
        }
      }
      if (n === 0 && !c.manual) undet.push({ lbl, code: c.code, seq: c.seq || "0", credits: c.credits || 0, zy: c.zy || 0, manual: false });
    }
    // 同日重叠分道（区间图着色，同正式课表）。
    // 旧实现 lanes = 全日 laneEnds 总数：当天任意时刻开过第 2 道，全天所有块都被劈半
    // （2026-09-03 实录：大学物理B(2) 自己那格毫无冲突也只占左半）。改为按「重叠簇」
    // 切分——簇 = 首尾相接/重叠的块序列，簇内独立分道，lanes = 本簇深度；孤立块满宽。
    const lanesOf = new Map<string, { lane: number; lanes: number }>();
    for (let day = 1; day <= 7; day++) {
      const list = raw.filter((b) => b.day === day).sort((a, b) => a.begin - b.begin || a.end - b.end);
      let cluster: typeof list = [];
      let clusterEnd = -1;
      const flush = (): void => {
        const ends: number[] = [];
        for (const b of cluster) {
          let lane = ends.findIndex((le) => le <= b.begin);
          if (lane === -1) { lane = ends.length; ends.push(b.end); }
          else ends[lane] = b.end;
          lanesOf.set(b.key, { lane, lanes: ends.length });
        }
        for (const b of cluster) {
          const e = lanesOf.get(b.key);
          if (e) lanesOf.set(b.key, { lane: e.lane, lanes: ends.length });
        }
        cluster = [];
        clusterEnd = -1;
      };
      for (const b of list) {
        if (cluster.length && b.begin >= clusterEnd) flush();
        cluster.push(b);
        clusterEnd = Math.max(clusterEnd, b.end);
      }
      flush();
    }
    const placed = raw.map((b) => ({ ...b, ...(lanesOf.get(b.key) ?? { lane: 0, lanes: 1 }) }));
    return { placed, undet };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiLocale, courses, mode, wb.phase, wb.queueMap, wb.candidates, wb.manualEvents]);

  const removeItem = async (code: string, seq: string): Promise<void> => {
    if (mode === "selected") {
      const c = wb.courses.find((x) => x.c.code === code && String(x.c.seq || "0") === String(seq));
      const name = c?.name || code;
      if (!(await confirmDanger(i18nMsg("pages.zhjwxk.courses.5b1ff08354a0", { name: String(name), code: String(code), value: String(seq || "0") }), DROP_CONFIRM))) return;
      await wb.drop(code, seq, false);
    } else if (mode === "stage") {
      const x = wb.stageCart.find((y) => y.code === code && String(y.seq || "0") === String(seq || "0"));
      if (!(await confirmOk(i18nMsg("pages.zhjwxk.courses.989a65fefd6f", { value: String(x?.name || code) })))) return;
      wb.removeFromStage(code, seq);
    } else {
      const d = wb.savedDrafts[wb.previewDraftIdx];
      if (!d) return;
      const x = d.courses.find((y) => y.code === code && String(y.seq || "0") === String(seq || "0"));
      if (!(await confirmOk(i18nMsg("pages.zhjwxk.courses.ed67b28e1e78", { value: String(x?.name || code) })))) return;
      wb.removeFromDraft(wb.previewDraftIdx, code, seq);
    }
  };

  const cr = courses.reduce((a, c) => a + (c.credits || 0), 0);
  const label = mode === "selected" ? i18n("pages.zhjwxk.courses.6266b6f08df5") : mode === "stage" ? i18n("pages.zhjwxk.courses.59294a8dd125", { length: String(wb.stageCart.length), value: String(wb.stageCart.length ? "：" + wb.stageCart.map((x) => x.code).join("、") : "") }) : i18n("pages.zhjwxk.courses.6cfbf1f20072", { value: String(wb.savedDrafts[wb.previewDraftIdx]?.name ?? "") });
  const canvasH = pvY(PV_AXIS_END) + 12;
  const todayIdx = (() => { const d = new Date().getDay(); return d === 0 ? 6 : d - 1; })();
  return (
    <Sec title={i18n("pages.zhjwxk.courses.1bf3158a977b")} extra={<Text slot="label" tone="faint">{label}</Text>}>
      <Inline gap={1} wrap>
        <Chip size="sm" selected={mode === "selected"} onClick={() => wb.setPreview("selected")}>{i18n("pages.zhjwxk.courses.6266b6f08df5")}</Chip>
        <Chip size="sm" selected={mode === "stage"} onClick={() => wb.setPreview("stage")}>{i18n("pages.zhjwxk.courses.24f0b1d35bb6")}</Chip>
        {wb.savedDrafts.map((d, i) => (
          <Chip key={i} size="sm" selected={mode === "draft" && wb.previewDraftIdx === i} onClick={() => wb.setPreview("draft", i)}>{d.name}</Chip>
        ))}
      </Inline>
      {!courses.length && !wb.manualEvents.length ? (
        <Text slot="label" tone="faint">{i18n("pages.zhjwxk.courses.1f5350ec49f1")}</Text>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 560 }}>
            <div style={{ display: "flex", marginBottom: 8, alignItems: "flex-end" }}>
              <div style={{ width: 34, flexShrink: 0 }} />
              {[i18n("pages.zhjwxk.courses.c430f4c12eaa"), i18n("pages.zhjwxk.courses.d1378a68e620"), i18n("pages.zhjwxk.courses.2961168962be"), i18n("pages.zhjwxk.courses.e9d3b01a5a00"), i18n("pages.zhjwxk.courses.572388f3b096"), i18n("pages.zhjwxk.courses.f9aa11dbb15c"), i18n("pages.zhjwxk.courses.ee239f394329")].map((name, i) => (
                <div key={name} className={"tt-head" + (i === todayIdx ? " is-today" : "")} style={{ flex: 1, textAlign: "center" }}>{name}</div>
              ))}
            </div>
            <div style={{ display: "flex" }}>
              <div style={{ width: 34, flexShrink: 0, position: "relative", height: canvasH }}>
                {PV_HALF_HOURS.filter((m) => m % 60 === 0).map((m) => (
                  <span key={m} style={{ position: "absolute", top: Math.max(0, pvY(m) - 6), right: 6 }}>
                    <Text slot="micro" tone="faint">{pvHm(m)}</Text>
                  </span>
                ))}
              </div>
              <div style={{ flex: 1, position: "relative", height: canvasH }}>
                {Array.from({ length: 7 }, (_, day) => (
                  <div key={`col-${day}`} style={{ position: "absolute", left: `${(day * 100) / 7}%`, width: `${100 / 7}%`, top: 0, height: canvasH, borderLeft: day === 0 ? "none" : "1px solid var(--og-line-1)", background: day === todayIdx ? "color-mix(in srgb, var(--og-accent) 6%, transparent)" : undefined }} />
                ))}
                {PV_HALF_HOURS.map((m) => (
                  <div key={`gl-${m}`} style={{ position: "absolute", left: 0, right: 0, top: pvY(m), borderTop: m % 60 === 0 ? "1px solid var(--og-line-2)" : "1px solid var(--og-line-1)" }} />
                ))}
                {placed.map((b) => {
                  const laneW = 100 / b.lanes;
                  const leftPct = (((b.day - 1) * 100) + b.lane * laneW) / 7;
                  const widthPct = laneW / 7;
                  const top = pvY(b.begin) + 2;
                  const height = Math.max((b.end - b.begin) * PV_PX_PER_MIN - 5, 22);
                  const compact = height < 40;
                  const license = b.manual ? BLOCK_LICENSE.normal : BLOCK_LICENSE[b.tone];
                  const fill = b.manual ? "var(--og-surface-4)" : license.fill;
                  const line = b.manual ? "1px dashed var(--og-accent-soft-line)" : `1px solid ${license.line}`;
                  return (
                    <div key={b.key} title={`${b.label}（${pvHm(b.begin)}–${pvHm(b.end)}）${b.probLabel ? " · " + b.probLabel : ""}`}
                      style={{ position: "absolute", left: `calc(${leftPct}% + 3px)`, width: `calc(${widthPct}% - 6px)`, top, height, background: fill, border: line, borderRadius: 5, padding: compact ? "2px 4px" : "3px 5px", color: "var(--og-content-on-soft)", overflow: "hidden", boxSizing: "border-box", zIndex: 6, cursor: b.manual ? undefined : "pointer", display: "flex", flexDirection: "column", gap: 1 }}
                      onClick={() => { if (!b.manual && b.code) jumpTo(b.code, "all", b.seq || ""); }}>
                      <Text slot="micro" weight="bold" truncate>{b.label}</Text>
                      {!compact ? <Text slot="micro" tone="quiet">{pvHm(b.begin)}–{pvHm(b.end)}{b.tag ? ` ${b.tag}` : ""}</Text> : null}
                      {b.probLabel && height > 44 ? <Chip size="sm">{b.probLabel}</Chip> : null}
                      <Btn variant="outline" size="sm" titleAttr={b.cand ? i18n("pages.zhjwxk.courses.9ea04b6a9425") : i18n("pages.zhjwxk.courses.6135d4159e89")} onClick={(e) => { e.stopPropagation(); if (b.manual && b.id) wb.removeManualEvent(b.id); else if (b.cand && b.code && b.seq) void wb.drop(b.code, b.seq, true); else if (b.code && b.seq) void removeItem(b.code, b.seq); }}>✕</Btn>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
      {undet.length ? (
        <Stack gap={1}>
          <Text slot="label" tone="faint">{i18nRich("pages.zhjwxk.courses.f3477d357ef2", { length: undet.length })}</Text>
          <Inline gap={1} wrap>
            {undet.map((u, i) => (
              <span key={i} title={i18n("pages.zhjwxk.courses.96fc74daea7d")}>
                <Chip size="sm" onClick={() => void removeItem(u.code, u.seq)}>{i18nRich("pages.zhjwxk.courses.f7486a1ba60e", { lbl: u.lbl, credits: u.credits, value: u.zy ? i18n("pages.zhjwxk.courses.4a640209de60", { zy: String(u.zy) }) : "" })}</Chip>
              </span>
            ))}
          </Inline>
        </Stack>
      ) : null}
      {wb.manualEvents.length ? (
        <Inline gap={1} wrap>
          <Text slot="label" tone="faint">{i18n("pages.zhjwxk.courses.2ef9b1789eaf")}</Text>
          {wb.manualEvents.map((e) => {
            const slots = parseTimeSlots(e.time || "");
            const when = e.begin && e.end ? `${[i18n("pages.zhjwxk.courses.c430f4c12eaa"),i18n("pages.zhjwxk.courses.d1378a68e620"),i18n("pages.zhjwxk.courses.2961168962be"),i18n("pages.zhjwxk.courses.e9d3b01a5a00"),i18n("pages.zhjwxk.courses.572388f3b096"),i18n("pages.zhjwxk.courses.f9aa11dbb15c"),i18n("pages.zhjwxk.courses.ee239f394329")][(e.day ?? 1) - 1]} ${e.begin}–${e.end}` : slots.map((x) => i18n("pages.zhjwxk.courses.dc9b0041ffc7", { day: String(x.day), slot: String(x.slot) })).join("、");
            return (
              <span key={e.id} title={i18n("pages.zhjwxk.courses.49b95727fe16")}>
                <Chip tone="brand" onRemove={() => wb.removeManualEvent(e.id)}>
                  {e.name}{when ? ` · ${when}` : ""}
                </Chip>
              </span>
            );
          })}
        </Inline>
      ) : null}
      <Text slot="label" tone="success">{i18nRich("pages.zhjwxk.courses.3c48d4b889f5", { length: courses.length, cr: cr, value: wb.manualEvents.length ? i18n("pages.zhjwxk.courses.5dbc7a39b365", { length: String(wb.manualEvents.length) }) : "" })}</Text>
      <Inline gap={1} wrap>
        <Btn variant="outline" size="sm" onClick={() => setMOpen((v) => !v)}>{i18n("pages.zhjwxk.courses.c4c21f2c783f")}</Btn>
      </Inline>
      {mOpen ? (
        <Stack gap={2}>
          <Field label={i18n("pages.zhjwxk.courses.30db88b23b2e")}>
            <Input placeholder={i18n("pages.zhjwxk.courses.33fabd4ae4d8")} value={mName} onChange={(value) => setMName(value)} />
          </Field>
          <Field label={i18n("pages.zhjwxk.courses.c398134d7d1f")}>
            <Select value={mDay} onChange={setMDay}>{[1,2,3,4,5,6,7].map((d) => <option key={d} value={d}>{[i18n("pages.zhjwxk.courses.c430f4c12eaa"),i18n("pages.zhjwxk.courses.d1378a68e620"),i18n("pages.zhjwxk.courses.2961168962be"),i18n("pages.zhjwxk.courses.e9d3b01a5a00"),i18n("pages.zhjwxk.courses.572388f3b096"),i18n("pages.zhjwxk.courses.f9aa11dbb15c"),i18n("pages.zhjwxk.courses.ee239f394329")][d-1]}</option>)}</Select>
          </Field>
          <Inline gap={2}>
            <Grow>
              <Field label={i18n("pages.zhjwxk.courses.d2bb025a2e51")}>
                <Select value={mBegin} onChange={setMBegin}>{PV_HALF_HOURS.slice(0, -1).map((m) => <option key={m} value={pvHm(m)}>{pvHm(m)}</option>)}</Select>
              </Field>
            </Grow>
            <Grow>
              <Field label={i18n("pages.zhjwxk.courses.c7b24e7997e9")}>
                <Select value={mEnd} onChange={setMEnd}>{PV_HALF_HOURS.slice(1).map((m) => <option key={m} value={pvHm(m)}>{pvHm(m)}</option>)}</Select>
              </Field>
            </Grow>
          </Inline>
          <Text slot="label" tone="faint">{i18n("pages.zhjwxk.courses.aba7797394c4")}</Text>
          <Btn variant="outline" disabled={!(mBegin < mEnd)} onClick={() => { wb.addManualEventRange(mName, Number(mDay), mBegin, mEnd); setMName(""); setMOpen(false); }}>{i18n("pages.zhjwxk.courses.54b72e846d49")}</Btn>
        </Stack>
      ) : null}
    </Sec>
  );
}

/** 行 vol 快速取（预览概率用） */
function r2vol(wb: ReturnType<typeof useXkWorkbench>, code: string, seq: string) {
  const r = wb.courses.find((x) => x.c.code === code && String(x.c.seq || "0") === String(seq || "0"));
  return r?.vol;
}

/* ══════════ 右栏③：暂存课表 + 草稿 ══════════ */
function StageSection({ wb }: { wb: ReturnType<typeof useXkWorkbench> }) {
  const uiLocale = useUiLocale();

  // 暂存条目也可能不在当前渲染行里（从培养方案/详情暂存）——单独补拉，
  // department 缺省走逐课 p_kch 兜底（2.0：暂存条概率一会有一会没的根因）
  useEffect(() => {
    if (!wb.stageCart.length || wb.phase) return;
    const pool = wb.stageCart.map((st) => ({ code: st.code, seq: st.seq || "0", department: "" }));
    const t = setTimeout(() => void wb.refreshVol(pool), 60);
    return () => clearTimeout(t);
  }, [wb.stageCart, wb.phase]);
  const [draftName, setDraftName] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [confirmIdx, setConfirmIdx] = useState(-1);
  const conflicts = detectConflictsOf(wb.stageCart);
  const putImport = (): void => {
    try {
      const obj = JSON.parse(importText) as { name?: string; courses?: XkStageItem[] };
      const incoming = obj.courses;
      if (!Array.isArray(incoming)) throw new Error(i18n("pages.zhjwxk.courses.1ad3aeaef070"));
      for (const c of incoming) wb.importStageItem(c);
      setImportText(""); setImportOpen(false);
    } catch (e) { wb.setToast(i18n("pages.zhjwxk.courses.579d5468a97a", { value: String(e instanceof Error ? e.message : String(e)) })); }
  };
  return (
    <Sec title={i18n("pages.zhjwxk.courses.c42dc6f6316f", { length: String(wb.stageCart.length) })}>
      {/* 志愿数据检查点同步状态（NextTHUxk 2.0 回移：8/12/16/20 点对齐 + 手动补拉） */}
      {wb.volState === "loading" ? <Text slot="label" tone="faint">{i18n("pages.zhjwxk.courses.25de4f1abc92")}</Text>
        : wb.volState === "error" ? (
          <Inline gap={2}>
            <Text slot="label" tone="faint">{i18n("pages.zhjwxk.courses.912ee0b6d057")}</Text>
            <Btn variant="outline" size="sm" onClick={() => void wb.refreshVol(wb.stageCart.map((st) => ({ code: st.code, seq: st.seq || "0", department: "" })), true)}>{i18n("pages.zhjwxk.courses.b8784c8dd563")}</Btn>
          </Inline>
        ) : wb.volLastSync ? (
          <Text slot="label" tone="faint">{i18nRich("pages.zhjwxk.courses.6a79b6b079b0", { value: new Date(wb.volLastSync).toLocaleTimeString(getUiLocale(), { hour: "2-digit", minute: "2-digit" }), value2: nextVolCheckpoint().toLocaleTimeString(getUiLocale(), { hour: "2-digit", minute: "2-digit" }) })}</Text>
        ) : null}
      {wb.stageCart.length === 0 ? <Text slot="label" tone="faint">{i18n("pages.zhjwxk.courses.7bdbe718ba55")}</Text> : (
        <List gap={1}>
          {wb.stageCart.map((s, i) => {
            const p = itemProb(wb, s.code, s.seq, s.flag, s.zy);
            // 余量按 (课号,班次) 精确匹配——同课号多班次只按课号会串行（简介串台同款病）
            const vol = wb.courses.find((r) => r.c.code === s.code && String(r.c.seq || "0") === String(s.seq || "0"))?.q?.qRemaining;
            return (
              <Row key={`${s.code}_${s.seq || "0"}_${i}`} size="sm" titleAttr={i18n("pages.zhjwxk.courses.83820da93bbb", { name: String(s.name), code: String(s.code) })} onClick={() => jumpTo(s.code, "all", s.seq)}
                title={s.name}
                sub={s.teacher ? s.teacher : undefined}
                trailing={
                  <Inline gap={2}>
                    {s.credits ? <Text slot="label" tone="faint" nowrap>{i18nRich("pages.zhjwxk.courses.93fbcc41041a", { credits: s.credits })}</Text> : null}
                    <IconBtn label={i18n("pages.zhjwxk.courses.d0b3c2123cf2")} size="sm" icon={<IconX size="sm" />} titleAttr={i18n("pages.zhjwxk.courses.d0b3c2123cf2")} onClick={() => wb.removeFromStage(s.code, s.seq)} />
                  </Inline>
                }
              >
                <Inline gap={2} wrap>
                  <Select size="sm" value={s.flag} onChange={(value) => wb.updateStageItem(s.code, s.seq, { flag: value as XkFlag })}>{allowedFlags(s.flag).map((f) => <option key={f} value={f}>{FLAG_LABELS[f]}</option>)}</Select>
                  <Select size="sm" value={s.zy} onChange={(value) => wb.updateStageItem(s.code, s.seq, { zy: Number(value) })}>{[3, 2, 1].map((z) => <option key={z} value={z}>{i18nRich("pages.zhjwxk.courses.b2af275db60a", { z: z })}</option>)}</Select>
                  <Text slot="label" tone={wb.phase ? "faint" : probTone(p.probNum)} nowrap>
                    {wb.phase ? (vol ?? "—") : p.prob}
                  </Text>
                </Inline>
              </Row>
            );
          })}
        </List>
      )}
      {conflicts.length ? <Text slot="label" tone="error">{i18nRich("pages.zhjwxk.courses.06f610639057", { value: conflicts.slice(0, 5).map((c) => `${dayName(c.day)} ${SLOT_NAMES[c.slot - 1]} ${c.a}/${c.b}`).join(" · ") })}</Text> : null}
      <details className="xk-stage-actions" open={wb.stageCart.length > 0 || wb.savedDrafts.length > 0 || undefined}>
        <summary>{i18n("pages.zhjwxk.courses.draftActions")}</summary>
      <Inline gap={1} wrap>
        <Grow><Input size="sm" placeholder={i18n("pages.zhjwxk.courses.f31a1706ec82")} value={draftName} onChange={(value) => setDraftName(value)} /></Grow>
        <Btn variant="outline" size="sm" onClick={() => { if (draftName.trim()) { wb.saveDraft(draftName.trim()); setDraftName(""); } }}>{i18n("pages.zhjwxk.courses.5329e3f0ee46")}</Btn>
        <Btn variant="outline" size="sm" onClick={() => { const n = globalThis.prompt?.(i18n("pages.zhjwxk.courses.a2658663724d"), i18n("pages.zhjwxk.courses.bbb5405f0e01")); if (n) wb.saveCurrentAsDraft(n); }}>{i18n("pages.zhjwxk.courses.9fd1ea01249e")}</Btn>
        <Btn variant="outline" size="sm" onClick={() => wb.setPreview("stage")}>{i18n("pages.zhjwxk.courses.24f0b1d35bb6")}</Btn>
        <Btn variant="outline" size="sm" disabled={!wb.stageCart.length && !wb.manualEvents.length} onClick={() => { void (async () => { if (await confirmOk(i18nMsg("pages.zhjwxk.courses.c853fddad79f", { length: String(wb.stageCart.length), length2: String(wb.manualEvents.length) }))) { for (const s of [...wb.stageCart]) wb.removeFromStage(s.code, s.seq); wb.clearManualEvents(); } })()}}>{i18n("pages.zhjwxk.courses.1ef3de06b32e")}</Btn>
        <Btn variant="outline" size="sm" onClick={() => setImportOpen((v) => !v)}>{i18n("pages.zhjwxk.courses.576d81bb0631")}</Btn>
      </Inline>
      {importOpen ? (
        <Stack gap={1}>
          <TextArea placeholder={i18n("pages.zhjwxk.courses.a8c7d1760ed1")} value={importText} onChange={(value) => setImportText(value)} />
          <Inline gap={1}>
            <Btn variant="outline" size="sm" onClick={putImport}>{i18n("pages.zhjwxk.courses.20b4ffc097d3")}</Btn>
            <Btn variant="outline" size="sm" onClick={() => setImportOpen(false)}>{i18n("pages.zhjwxk.courses.2cd0f3be8738")}</Btn>
          </Inline>
        </Stack>
      ) : null}
      </details>
      <Stack gap={1}>
        {wb.savedDrafts.map((d, idx) => (
          <OGCard key={idx} pad="sm">
            <Inline gap={2} wrap spread>
              <Text weight="bold">{d.name}</Text>
              <Text slot="label" tone="faint">{i18nRich("pages.zhjwxk.courses.78a83dfa97af", { length: d.courses.length, value: d.courses.reduce((a, c) => a + (c.credits || 0), 0) })}</Text>
              {confirmIdx === idx ? (
                <Inline gap={1}>
                  <Btn variant="outline" size="sm" onClick={() => { setConfirmIdx(-1); void wb.submitDraft(idx); }}>{i18n("pages.zhjwxk.courses.9ebe36f8cf23")}</Btn>
                  <Btn variant="outline" size="sm" onClick={() => setConfirmIdx(-1)}>{i18n("pages.zhjwxk.courses.2cd0f3be8738")}</Btn>
                </Inline>
              ) : (
                <Btn variant="outline" size="sm" onClick={() => setConfirmIdx(idx)}>{i18n("pages.zhjwxk.courses.08a85f4ab4ba")}</Btn>
              )}
              <Btn variant="outline" size="sm" onClick={() => wb.setPreview("draft", idx)}>{i18n("pages.zhjwxk.courses.13d61fea9f17")}</Btn>
              <Btn variant="outline" size="sm" onClick={() => void wb.exportDraft(idx)}>{i18n("pages.zhjwxk.courses.76420433f22d")}</Btn>
              <Btn variant="outline" size="sm" onClick={() => wb.deleteDraft(idx)}>{i18n("pages.zhjwxk.courses.2f9daa828907")}</Btn>
            </Inline>
          </OGCard>
        ))}
        {wb.savedDrafts.length ? <Text slot="label" tone="faint">{i18n("pages.zhjwxk.courses.2f53e8b4a58a")}</Text> : null}
      </Stack>
    </Sec>
  );
}

/* ══════════ 右栏④：我的候补 ══════════ */
function QueueSection({ wb }: { wb: ReturnType<typeof useXkWorkbench> }) {
  const uiLocale = useUiLocale();

  if (!wb.candidates.length) return null;
  return (
    <Sec title={i18n("pages.zhjwxk.courses.530701767bec", { length: String(wb.candidates.length) })}>
      <List divided>
        {wb.candidates.map((c, i) => (
          <Row key={`${c.code}-${i}`} size="sm"
            leading={<Chip size="sm" tone="warning">{c.myPos ? i18n("pages.zhjwxk.courses.c0587f566be1", { myPos: String(c.myPos), queueTotal: String(c.queueTotal) }) : i18n("pages.zhjwxk.courses.64af28c77281")}</Chip>}
            title={c.name}
            titleAttr={`${c.name}（${c.code}${c.seq && c.seq !== "0" ? `·${c.seq}` : ""}）`}
            meta={<Text slot="label" tone="faint">{c.code}{c.seq && c.seq !== "0" ? `·${c.seq}` : ""}</Text>}
            trailing={<Btn variant="outline" size="sm" disabled={wb.busy !== null} onClick={() => void wb.drop(c.code, c.seq, true)}>{i18n("pages.zhjwxk.courses.2f9daa828907")}</Btn>}
            onClick={() => jumpTo(c.code, "all", c.seq)}
          />
        ))}
      </List>
    </Sec>
  );
}

function detectConflictsOf(items: XkStageItem[]): Array<{ day: number; slot: number; a: string; b: string }> {
  const slotMap = new Map<string, string[]>();
  const out: Array<{ day: number; slot: number; a: string; b: string }> = [];
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
