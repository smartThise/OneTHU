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
  StatTile,
  Surface,
  Tag,
  Text,
  TextArea,
  Input,
  Banner,
} from "@onethu/gui";
/**
 * 选课工作台 —— nextthuxk v1.4.9 布局复刻（单屏两栏）：
 * 左栏 = 搜索/筛选chips/筛选selects/课程列表；右栏 = 学分统计·课表预览·暂存草稿·候补·AI。
 * UI 用 OneGUI（Btn/Input/Select/Card/Row/Chip/Tag/Banner/Modal/Text/Inline/Stack/Progress/StatTile）。
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
import { t as i18n } from "../../i18n/index.js";


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
  if (pri) out = `优先${pri}/${out}`;
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
  return { prob: p.label === "无数据" ? "无数据" : `${p.percentLabel} · ${p.ratioLabel}`, color: p.color, bg: p.bg, probNum: p.prob };
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
    <Modal open onClose={onClose} title={i18n("auto.pages.zhjwxk.Courses.1")} size="lg" scope="zhjwxk.detail">
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
      {loading ? <Empty text="正在加载课程简介…" /> : !data ? <Empty text="暂无课程简介信息（该课缺教师号，无法拉取）" /> : (
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
    <Modal open onClose={onClose} title={`${name} · 社区点评`} scope="zhjwxk.reviews">
      {entry && entry.count ? (
        <Inline gap={2} vAlign="baseline">
          <Text slot="title" tone="warning" weight="bold">{Number(entry.avg).toFixed(1)}</Text>
          <Text tone="warning">{tbStars(entry.avg)}</Text>
          <Text slot="label" tone="faint"> {entry.count} {i18n("auto.pages.zhjwxk.Courses.2")}{entry.kkdw ? ` · ${entry.kkdw}` : ""}</Text>
        </Inline>
      ) : (
        <Text tone="faint">{i18n("auto.pages.zhjwxk.Courses.3")}</Text>
      )}
      <Inline gap={2} wrap>
        <Btn variant="outline" href={courseUrl} onClick={(e) => { e.preventDefault(); void openExternal(courseUrl); }}>{i18n("auto.pages.zhjwxk.Courses.4")}</Btn>
        <Btn variant="outline" tone="brand" href={tbWriteUrl(entry)} onClick={(e) => { e.preventDefault(); void openExternal(tbWriteUrl(entry)); }}>{i18n("auto.pages.zhjwxk.Courses.5")}</Btn>
      </Inline>
      <Text slot="micro" tone="faint">
        {i18n("auto.pages.zhjwxk.Courses.6")}{" "}
        <a className="og-text--t-brand" href={courseUrl} onClick={(e) => { e.preventDefault(); void openExternal(courseUrl); }}>{i18n("auto.pages.zhjwxk.Courses.7")}</a>
        {" "}{i18n("auto.pages.zhjwxk.Courses.8")}{" "}
        <a className="og-text--t-brand" href="https://creativecommons.org/licenses/by-nc/4.0/deed.zh" onClick={(e) => { e.preventDefault(); void openExternal("https://creativecommons.org/licenses/by-nc/4.0/deed.zh"); }}>CC BY-NC 4.0</a>
        {" "}{i18n("auto.pages.zhjwxk.Courses.9")}</Text>
      {entry ? (
        phase === "loading" ? <Empty text="拉取正文…" /> : phase === "fail" ? <Empty text="点评加载失败（网络原因），稍后重试" /> :
        !data?.results.length ? <Empty text="暂无点评正文" /> : (
          <List divided gap={2}>
            {data.results.map((r, i) => (
              <Row key={i} size="sm"
                title={
                  <Inline as="div" gap={2} vAlign="baseline" wrap>
                    <Text tone="warning">{tbStars(r.rating ?? 0)}</Text>
                    <Text weight="bold">{Number(r.rating ?? 0)}</Text>
                    {r.score ? <Chip size="sm">{i18n("auto.pages.zhjwxk.Courses.10")}{String(r.score).slice(0, 8)}</Chip> : null}
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
    return { pct: 50, collapsed: "none" };
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
    <>
      <PageHead
        title={i18n("auto.pages.zhjwxk.Courses.11")}
        meta={[
          wb.semester ?? "选课系统",
          wb.phase ? "课余量模式" : "预选模式",
          `已选 ${wb.selected.length} 门 · ${selCredits} 学分`,
          `已浏览 ${wb.searchRows.length} 门（实时）`,
        ].filter(Boolean).join(" · ")}
        actions={
          <>
            <PageAtomStar atomKey="zhjwxk" title={i18n("auto.pages.zhjwxk.Courses.11")} />
            <Select value={wb.semester ?? ""} onChange={(value) => void wb.setSemesterOverride(value)}>{(wb.semesterOptions ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
            {wb.phase ? <Btn variant="outline" onClick={() => void wb.refreshQueue()} disabled={wb.queueState === "loading"}>{i18n("auto.pages.zhjwxk.Courses.12")}</Btn> : null}
            <Btn variant="outline" onClick={() => void wb.refresh()} disabled={wb.coreState === "loading"}><IconRefresh width={14} height={14} />{i18n("auto.pages.zhjwxk.Courses.13")}</Btn>
          </>
        }
      />
      {wb.coreState === "error" ? <ErrorNote text={wb.error ?? ""} onRetry={() => void wb.refresh()} /> : null}
      {wb.toast ? (
        <Banner tone="info" action={<Btn variant="outline" size="sm" onClick={() => wb.setToast(null)}>{i18n("auto.pages.zhjwxk.Courses.14")}</Btn>}>{wb.toast}</Banner>
      ) : null}
      {wb.progress ? <Banner tone="warning">{wb.progress}</Banner> : null}

      {/* ── 桌面：双栏（左查找 / 右管理+AI）── */}
      <div className="xk-two-col" ref={colRef} style={{ display: "flex", gap: 6, alignItems: "stretch", flexWrap: "nowrap", width: "100%", maxWidth: "100%", overflow: "hidden", userSelect: "none" }}>
        {/* 塌缩用 display:none 藏身（绝不卸载）：筛选/搜索/滚动状态全保留 */}
        <div
          className="xk-left"
          style={{
            maxHeight: "calc(100vh - 150px)",
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
            title={i18n("auto.pages.zhjwxk.Courses.15")}
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
          <Btn variant="outline" titleAttr={i18n("auto.pages.zhjwxk.Courses.16")} onClick={() => setSplitP({ pct: 50, collapsed: "none" })}>‹›
          </Btn>
        )}
        <div
          className="xk-right"
          style={{
            maxHeight: "calc(100vh - 150px)",
            display: split.collapsed === "right" ? "none" : "flex",
            flexDirection: "column",
            gap: 10,
            flex: split.collapsed === "left" ? "1 1 0%" : "1 1 0%",
            minWidth: 0,
            maxWidth: "none",
          }}
        >
          <PlanSection wb={wb} />
          <PreviewSection wb={wb} />
          <StageSection wb={wb} />
          <QueueSection wb={wb} />
        </div>
      </div>

      {/* ── 竖屏：双页签（课程查找 / 选课管理），跳转关系由 jump 联动 ── */}
      <div className="xk-mobile-tabs">
        <SegmentedOverflow ariaLabel="选课分栏">
          {([["find", "课程查找"], ["manage", "选课管理"]] as const).map(([k, label]) => (
            <Btn key={k} size="sm" variant={mTab === k ? "tonal" : "ghost"} role="tab" aria-selected={mTab === k} onClick={() => setMTab(k)}>
              {label}
            </Btn>
          ))}
        </SegmentedOverflow>
        {mTab === "find" ? <CourseListPanel wb={wb} jump={jump} jumpSeq={jumpSeq} /> : null}
        {mTab === "manage" ? (
          <Stack gap={2}>
            <PlanSection wb={wb} />
            <PreviewSection wb={wb} />
            <StageSection wb={wb} />
            <QueueSection wb={wb} />
          </Stack>
        ) : null}
      </div>

      <DetailModal wb={wb} code={detailCode} tid={detailTid} onClose={() => setDetailCode(null)} />
      <ReviewsModal code={reviewCode?.code ?? null} seq={reviewCode?.seq ?? ""} name={reviewCode?.name ?? ""} teacher={reviewCode?.teacher ?? ""} onClose={() => setReviewCode(null)} />
    </>
  );
}

/* ══════════ 左栏：搜索 + 筛选 + 列表 ══════════ */
function CourseListPanel({ wb, jump, jumpSeq }: { wb: ReturnType<typeof useXkWorkbench>; jump: string; jumpSeq: string }) {
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
  const [picks, setPicks] = useState<Record<string, { flag: XkFlag; zy: number }>>({});
  const [highlight, setHighlight] = useState("");
  const { navigate } = useApp();

  /* 服务端筛选映射：课程号(纯数字)/课程名→文本框，通识课组→p_rxklxm，课程特色→p_kctsm，
   * 年级→p_ssnj，星期→p_skxq，大节→p_skjc，本/研余量→p_bkskyl_ig/p_yjskyl_ig。
   * 其余（冲突/学分/评价/文字说明/chips）为本地叠加，作用于已取回的页。 */
  const serverKey = useMemo(() => JSON.stringify([
    query.trim(), tongshi, feature, grade, day, period, bksrem === "1", yjsrem === "1",
  ]), [query, tongshi, feature, grade, day, period, bksrem, yjsrem]);
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
  }, [wb.searchRows, wb.searchState, wb.courses, wb.previewIndex, query, chip, credits, day, period, conflictF, tongshi, feature, grade, bksrem, yjsrem, xknote, reviewsF, sortBy]);

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
  }, [rows, chip, wb.searchRaw]);
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
    [listRows, searchMode, curPage],
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
  const goJump = () => {
    const n = parseInt(goPage, 10);
    if (!Number.isFinite(n) || n < 1) return;
    if (searchMode) setUiPage(Math.min(n, totalPages));
    else void wb.gotoPage(n);
    setGoPage("");
  };

  return (
    <>
      {/* 吸顶通告：geometry（sticky/top/z）走内联，材质走 OG Banner */}
      <div style={{ position: "sticky", top: 0, zIndex: 8 }}>
        <Banner tone="warning">
          {i18n("auto.pages.zhjwxk.Courses.17")}<b>{i18n("auto.pages.zhjwxk.Courses.18")}</b>{i18n("auto.pages.zhjwxk.Courses.19")}<Inline gap={1} wrap>
            <Btn variant="outline" size="sm" onClick={() => navigate("info", { infoNewsQuery: "北京大学 北京外国语大学" })}>{i18n("auto.pages.zhjwxk.Courses.20")}</Btn>
            <Btn variant="outline" size="sm" onClick={() => navigate("info", { infoNewsQuery: "北京大学 研究生" })}>{i18n("auto.pages.zhjwxk.Courses.21")}</Btn>
          </Inline>
        </Banner>
      </div>
      <Stack gap={2}>
        <OGCard pad="sm">
          <Stack gap={2}>
            <Inline gap={2}>
              <Grow>{<Input placeholder={i18n("auto.pages.zhjwxk.Courses.22")} value={query} onChange={(value) => setQuery(value)} />}</Grow>
              {query ? <Btn variant="outline" onClick={() => setQuery("")}>×</Btn> : null}
            </Inline>
            <Inline gap={2} wrap>
              {([["all", "全部"], ["available", "可选"], ["selected", "已选"], ["required", "必修"], ["elective", "限选"], ["sports", "体育"], ["queue", "我的队列"], ["plan", "培养方案"]] as const).map(([k, label]) => (
                <Chip key={k} size="sm" selected={chip === k} onClick={() => setChip(k)}>{label}</Chip>
              ))}
            </Inline>
            <Inline gap={2} wrap>
              <Grow><Select size="sm" value={conflictF} onChange={setConflictF}><option value="">{i18n("auto.pages.zhjwxk.Courses.23")}</option><option value="noconflict">{i18n("auto.pages.zhjwxk.Courses.24")}</option><option value="conflict">{i18n("auto.pages.zhjwxk.Courses.25")}</option></Select></Grow>
              <Grow><Select size="sm" value={credits} onChange={setCredits}><option value="">{i18n("auto.pages.zhjwxk.Courses.26")}</option>{["1", "2", "3", "4", "5+"].map((v) => <option key={v} value={v}>{v === "5+" ? "5+学分" : `${v}学分`}</option>)}</Select></Grow>
              <Grow><Select size="sm" value={day} onChange={setDay}><option value="">{i18n("auto.pages.zhjwxk.Courses.27")}</option>{[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{dayName(d)}</option>)}</Select></Grow>
              <Grow><Select size="sm" value={period} onChange={setPeriod}><option value="">{i18n("auto.pages.zhjwxk.Courses.28")}</option>{SLOT_NAMES.map((n, i) => <option key={i} value={i + 1}>{i18n("auto.pages.zhjwxk.Courses.29")}{i + 1}{i18n("auto.pages.zhjwxk.Courses.30")}</option>)}</Select></Grow>
            </Inline>
            <Inline gap={2} wrap>
              <Grow><Select size="sm" value={reviewsF} onChange={setReviewsF}><option value="">{i18n("auto.pages.zhjwxk.Courses.31")}</option><option value="has">{i18n("auto.pages.zhjwxk.Courses.32")}</option><option value="cnt5">{i18n("auto.pages.zhjwxk.Courses.33")}</option><option value="r45">{i18n("auto.pages.zhjwxk.Courses.34")}</option><option value="r40">★≥4.0</option><option value="low">{i18n("auto.pages.zhjwxk.Courses.35")}</option></Select></Grow>
              <Grow><Select size="sm" value={sortBy} onChange={setSortBy}><option value="">{i18n("auto.pages.zhjwxk.Courses.36")}</option><option value="rate_desc">{i18n("auto.pages.zhjwxk.Courses.37")}</option><option value="rate_asc">{i18n("auto.pages.zhjwxk.Courses.38")}</option><option value="cnt_desc">{i18n("auto.pages.zhjwxk.Courses.39")}</option>{/* 【教评#31冻结】教评排序选项 <option value="xk_desc">官方教评 高→低</option><option value="xk_asc">官方教评 低→高</option> */}</Select></Grow>
            </Inline>
            <Inline gap={2} wrap>
              <Grow><Select size="sm" value={tongshi} onChange={setTongshi}><option value="">{i18n("auto.pages.zhjwxk.Courses.40")}</option>{TS_GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Grow>
              <Grow><Select size="sm" value={feature} onChange={setFeature}><option value="">{i18n("auto.pages.zhjwxk.Courses.41")}</option>{FEATURES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Grow>
              <Grow><Select size="sm" value={grade} onChange={setGrade}><option value="">{i18n("auto.pages.zhjwxk.Courses.42")}</option>{["2026", "2025", "2024", "2023", "2022", "2021", "2020", "2019"].map((g) => <option key={g} value={g}>{g}{i18n("auto.pages.zhjwxk.Courses.43")}</option>)}</Select></Grow>
              <Grow><Select size="sm" value={bksrem} onChange={setBksrem}><option value="">{i18n("auto.pages.zhjwxk.Courses.44")}</option><option value="1">{i18n("auto.pages.zhjwxk.Courses.45")}</option></Select></Grow>
              <Grow><Select size="sm" value={yjsrem} onChange={setYjsrem}><option value="">{i18n("auto.pages.zhjwxk.Courses.46")}</option><option value="1">{i18n("auto.pages.zhjwxk.Courses.47")}</option></Select></Grow>
            </Inline>
            <Input placeholder={i18n("auto.pages.zhjwxk.Courses.48")} value={xknote} onChange={(value) => setXknote(value)} />
          </Stack>
        </OGCard>

        {chip === "plan" ? <PlanView wb={wb} query={query} onSearchCode={(code) => jumpTo(code, "all")} /> : wb.searchState === "idle" || wb.searchState === "loading" ? (
          <Card><SkeletonRows rows={6} /><Empty text="正在实时查询教务系统（搜索/翻页各 1 个往返，即搜即得）…" /></Card>
        ) : wb.searchState === "error" && rows.length === 0 ? (
          <ErrorNote text={wb.searchError ?? ""} onRetry={() => void wb.retrySearch()} />
        ) : rows.length === 0 ? (
          <Card><Empty text={wb.searchError || "暂无匹配课程。"} /></Card>
        ) : (
          <>
            {/* SWR 语义：刷新失败但旧结果在——保留列表只挂黄条（红条只在无结果时露脸） */}
            {wb.searchState === "error" ? (
              <Banner tone="warning" action={<Btn variant="outline" size="sm" onClick={() => void wb.retrySearch()}>{i18n("auto.pages.zhjwxk.Courses.49")}</Btn>}>
                {i18n("auto.pages.zhjwxk.Courses.50")}{wb.searchError}
              </Banner>
            ) : null}
            {wb.searchIncomplete ? (
              <Banner tone="warning" action={<Btn variant="outline" size="sm" disabled={busy} onClick={() => void wb.loadAllSearch()}>{busy ? "加载中…" : "加载当前关键词全部"}</Btn>}>
                {i18n("auto.pages.zhjwxk.Courses.51")}{listRows.length} {i18n("auto.pages.zhjwxk.Courses.52")}{wb.searchTotalPages > 0 ? `，教务共 ${wb.searchTotalPages} 页${wb.searchTotalRows > 0 ? `（共 ${wb.searchTotalRows} 门）` : ""}` : "，还有更多"}
              </Banner>
            ) : null}
            <Card className="list">
              {pagedRows.map((r, i) => <PickCard key={r.key} wb={wb} r={r} i={i} picks={picks} setPicks={setPicks} highlight={r.c.code === highlight && (jumpSeq === "" || String(r.c.seq || "0") === String(jumpSeq || "0"))} />)}
              {pagedRows.length === 0 && !pageLoaded ? (
                <Empty text="此页未加载——点上方「加载全部」后可查看。" />
              ) : null}
            </Card>
            <Inline gap={3} justify="center" wrap>
              <Btn variant="outline" size="sm" disabled={busy || (searchMode ? curPage <= 1 : wb.searchPage <= 1)} onClick={() => (searchMode ? setUiPage(curPage - 1) : void wb.gotoPage(wb.searchPage - 1))}>{i18n("auto.pages.zhjwxk.Courses.53")}</Btn>
              <Text slot="label" tone="faint">
                {i18n("auto.pages.zhjwxk.Courses.29")}{curPage} {i18n("auto.pages.zhjwxk.Courses.54")}{totalPages} {i18n("auto.pages.zhjwxk.Courses.55")}{searchMode && !wb.searchIncomplete ? `（${listRows.length} 门）` : ""}
              </Text>
              <Btn variant="outline" size="sm" disabled={busy || (searchMode ? curPage >= totalPages : !wb.searchHasMore && !(wb.searchTotalPages > wb.searchPage))} onClick={() => {
                  if (searchMode) setUiPage(curPage + 1);
                  else void wb.gotoPage(wb.searchPage + 1);
                }}>{i18n("auto.pages.zhjwxk.Courses.56")}</Btn>
              <Text slot="label" tone="faint">{i18n("auto.pages.zhjwxk.Courses.57")}</Text>
              <Input size="sm" value={goPage} onChange={(value) => setGoPage(value.replace(/[^0-9]/g, ""))} onKeyDown={(e) => e.key === "Enter" && goJump()} />
              <Btn variant="outline" size="sm" disabled={busy || !goPage} onClick={goJump}>GO</Btn>
            </Inline>
          </>
        )}
      </Stack>
    </>
  );
}

/* ══════════ 培养方案视图（render.js renderPlanView 逐行移植）══════════ */
function PlanView({ wb, query, onSearchCode }: { wb: ReturnType<typeof useXkWorkbench>; query: string; onSearchCode: (code: string) => void }) {
  const coverage = useMemo(() => checkPlanCoverage(wb.plan, wb.courses, wb.stageCart, wb.savedDrafts.map((d) => d.courses), (wb.semester ?? "").endsWith("2")),
    [wb.plan, wb.courses, wb.stageCart, wb.savedDrafts, wb.semester]);
  useEffect(() => {
    planGroupClick = () => { setPresetGroupChip?.("plan"); };
    return () => { planGroupClick = null; };
  }, []);
  if (wb.plan.length === 0 && wb.searchState !== "ready") {
    return <Card><SkeletonRows rows={4} /><Empty text="培养方案加载中（实时模式：随核心数据一并秒取）…" /></Card>;
  }
  if (!coverage.length) {
    return (
      <Card>
        <Empty text="暂无培养方案数据（该学期可能未配置，或登录已过期）" />
        <Inline justify="center">
          <Btn variant="outline" onClick={() => void wb.refresh()}>{i18n("auto.pages.zhjwxk.Courses.49")}</Btn>
        </Inline>
      </Card>
    );
  }
  const q = query.trim().toLowerCase();
  const filtered = q ? coverage.filter((p) => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q) || (p.attr || "").includes(q)) : coverage;
  const groups = new Map<string, PlanCoverageItem[]>();
  for (const p of filtered) {
    const g = p.group || p.attr || "其他";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(p);
  }
  const totalCr = coverage.reduce((s, c) => s + c.credits, 0);
  const coveredCr = coverage.filter((c) => c.covered).reduce((s, c) => s + c.credits, 0);
  const coveredN = coverage.filter((c) => c.covered).length;
  return (
    <>
      <OGCard pad="sm">
        <Text slot="label" weight="bold">
          {i18n("auto.pages.zhjwxk.Courses.58")}{coveredN}/{coverage.length}{i18n("auto.pages.zhjwxk.Courses.59")}{coveredCr}/{totalCr}{i18n("auto.pages.zhjwxk.Courses.60")}</Text>
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
                <Text slot="label" tone={gCovered >= gTotal ? "success" : "faint"}>{gCovered}/{gTotal}{i18n("auto.pages.zhjwxk.Courses.60")}</Text>
              </Inline>
            </Surface>
            {courses.map((p) => (
              <Row key={p.code} size="sm" titleAttr={`点击搜索 ${p.code}`} onClick={() => onSearchCode(p.code)}
                leading={<Text slot="label" tone={p.covered ? "success" : "error"}>{p.covered ? "✓" : "✗"}</Text>}
                title={p.name}
                meta={<Text slot="micro" tone="faint">{p.code}</Text>}
                trailing={
                  <Inline gap={2}>
                    <Text slot="label" tone="faint" nowrap>{p.credits}{i18n("auto.pages.zhjwxk.Courses.60")}</Text>
                    {p.covered
                      ? <Text slot="label" tone="success" nowrap>{p.coveredBy || "已满足"}</Text>
                      : <Text slot="label" tone="error">{i18n("auto.pages.zhjwxk.Courses.61")}</Text>}
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
    <div className="row" data-xk-row={r.key} style={{ animationDelay: `${Math.min(i, 20) * 20}ms`, ...(highlight ? { outline: "2px solid var(--accent)" } : {}) }}>
      <div className="row-when">
        <Text as="b" weight="bold" tone={wb.phase && q ? (q.qRemaining > 0 ? "success" : q.qQueue > 0 ? "warning" : "error") : heatTone(applied, cap)}>
          {wb.phase ? (q?.qRemaining ?? r.c.remaining) : r.c.remaining}
        </Text>
        <span>{wb.phase ? "余量" : "余量"}</span>
      </div>
      <div className="row-main">
        <Stack gap={1}>
          <div className="row-title" style={{ whiteSpace: "normal" }}>
            {(() => { const o = originOf(r.c.code); return o
              ? <Tag tone={ORIGIN_TONE[o]}>{o}</Tag>
              : null; })()}
            {r.name}

            {r.teacherId ? <Btn variant="outline" size="sm" onClick={() => openDetail(r.c.code, r.teacherId)}>{i18n("auto.pages.zhjwxk.Courses.62")}</Btn> : null}
            {tbBadge(r) ? (
              <Btn variant="outline" size="sm" onClick={() => openReviews({ code: r.c.code, seq: r.c.seq, name: r.name, teacher: r.teacher })}>{tbBadge(r)}</Btn>
            ) : null}
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
          <Inline gap={1} wrap>
            <Chip size="sm"><Text mono slot="micro">{r.c.code}{r.c.seq && r.c.seq !== "0" ? `·${r.c.seq}班` : ""}</Text></Chip>
            {/* 纯数字教师=教务多教师格解析未明（取证中，见 xkParseDebug）——隐藏不误导 */}
            {r.teacher && !/^\d{1,3}$/.test(r.teacher) ? <Text as="b" weight="semibold">{r.teacher}</Text> : null}
            {r.time ? <Chip size="sm" tone="brand">{r.time}</Chip> : null}
            {r.credits ? <Text slot="label" tone="quiet">{r.credits} {i18n("auto.pages.zhjwxk.Courses.60")}</Text> : null}
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
            <Surface sunken radius="sm">
              <Text>
                <Text as="b" slot="label" tone="brand" weight="bold">{i18n("auto.pages.zhjwxk.Courses.63")}</Text>
                {"　"}
                {r.c.note}
              </Text>
            </Surface>
          ) : null}
          {wb.phase ? (
            r.cand ? <div className="row-sub" style={{ whiteSpace: "normal" }}>{r.cand.myPos ? `我的排队 第${r.cand.myPos}名 / 共${r.cand.queueTotal}人` : "候选中（队列未出位次）"}</div> : null
          ) : r.vol ? (
            <div className="row-sub" style={{ whiteSpace: "normal" }}>
              {(() => {
                // 志愿统计行（NextTHUxk 2.0 render.js 同款）：体/必/限/任 前缀，
                // '0,0,0' 全零段滤除（fmtVol 全零也返回空，双保险）
                const parts: string[] = [];
                if (isSportsCourse(r) && r.vol.volSports && r.vol.volSports !== "0,0,0") {
                  const v = fmtVol(r.vol.volSports);
                  if (v) parts.push(`体 ${v}`);
                } else {
                  if (r.vol.volRequired && r.vol.volRequired !== "0,0,0") { const v = fmtVol(r.vol.volRequired); if (v) parts.push(`必 ${v}`); }
                  if (r.vol.volElective && r.vol.volElective !== "0,0,0") { const v = fmtVol(r.vol.volElective); if (v) parts.push(`限 ${v}`); }
                  if (r.vol.volOptional && r.vol.volOptional !== "0,0,0") { const v = fmtVol(r.vol.volOptional); if (v) parts.push(`任 ${v}`); }
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
              {[r.c.capacity ? `容量 ${r.c.capacity}` : "", typeof r.c.remaining === "number" ? `余量 ${r.c.remaining}` : ""].filter(Boolean).join(" · ")}
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
                  <Text slot="label" tone={tone} weight="bold" nowrap>
                    {i18n("auto.pages.zhjwxk.Courses.64")}{q.qRemaining}/{q.qCapacity}{q.qQueue > 0 ? ` · 排队${q.qQueue}人` : ""}
                  </Text>
                </Inline>
              );
            }
            const occ = occupancyOf({ capacity: r.c.capacity, remaining: r.c.remaining, vol: r.vol }, wb.phase);
            if (!occ.cap) return null;
            const vc = volColor(occ.applied, occ.cap);
            const tone = levelTone(vc.level);
            const barTone = vc.level === "unknown" ? "accent" as const : (tone === "faint" ? "accent" : tone) as "accent" | "success" | "warning" | "error";
            const label = vc.level === "easy" ? "竞争宽松" : vc.level === "medium" ? "竞争适中" : vc.level === "hard" ? "竞争激烈" : "";
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
                  <Text key={zi} slot="micro" tone={probTone(p.prob)} weight={p.prob >= 0 ? "semibold" : "regular"}>
                    {zi + 1}{i18n("auto.pages.zhjwxk.Courses.65")}{p.label}{p.prob >= 0 && p.ratioLabel ? ` · ${p.ratioLabel}` : ""}
                  </Text>
                ))}
              </Inline>
            ))}
          </Stack> : null}
          {(() => { const o = originOf(r.c.code); if (!o) return null;
            if (clockRangesOf(r.c.note, r.time).length > 0) return null; // 时间已解析上时间轴，不废话
            return (
            <Inline gap={2} vAlign="start">
              <Text slot="label" tone="warning">{o}{i18n("auto.pages.zhjwxk.Courses.66")}</Text>
              <Grow>
                <Btn variant="outline" size="sm" onClick={() => navigate("info", { infoNewsQuery: o === "北大研" ? "北京大学 研究生" : "北京大学 北京外国语大学" })}>{i18n("auto.pages.zhjwxk.Courses.67")}{o === "北大研" ? "北京大学面向我校研究生开放课程" : "北大、北外课程"}{i18n("auto.pages.zhjwxk.Courses.68")}</Btn>
              </Grow>
            </Inline>
            ); })()}
          {confs.length ? (
            <div className="row-sub" style={{ whiteSpace: "normal" }}>
              <Text slot="label" tone="error">{i18n("auto.pages.zhjwxk.Courses.69")}{confs.slice(0, 3).map((c) => `${dayName(c.day)} ${SLOT_NAMES[c.slot - 1]} ${c.b}`).join(" · ")}</Text>
            </div>
          ) : null}
          {state === "selected" ? (
            <Inline gap={1} wrap>
              {r.zy ? <Text slot="label" tone="faint">{FLAG_LABELS[r.flag]} {i18n("auto.pages.zhjwxk.Courses.70")}{r.zy}{i18n("auto.pages.zhjwxk.Courses.71")}</Text> : null}
              <Btn variant="outline" size="sm" disabled={!(r.zy > 1 && wb.canAdjustZy(r.c.code, r.c.seq, r.zy - 1)) || wb.busy !== null} titleAttr={r.zy > 1 && wb.canAdjustZy(r.c.code, r.c.seq, r.zy - 1) ? "" : "该志愿名额已满"} onClick={() => void wb.changeZy(r.c.code, r.c.seq, r.zy - 1)}>▲</Btn>
              <Btn variant="outline" size="sm" disabled={!(r.zy < 3 && wb.canAdjustZy(r.c.code, r.c.seq, r.zy + 1)) || wb.busy !== null} titleAttr={r.zy < 3 && wb.canAdjustZy(r.c.code, r.c.seq, r.zy + 1) ? "" : "该志愿名额已满"} onClick={() => void wb.changeZy(r.c.code, r.c.seq, r.zy + 1)}>▼</Btn>
              <Btn variant="outline" size="sm" disabled={inStage} onClick={() => wb.addToStage(r, r.flag, r.zy || 3)}>{inStage ? "已暂存" : "暂存"}</Btn>
              <Btn variant="outline" size="sm" disabled={wb.busy !== null} onClick={() => void (async () => { if (await confirmDanger(`「${r.name}」（${r.c.code}_${r.c.seq || "0"}）\n退选是真实退课操作，立即生效；补退选阶段退掉的名额可能立刻被抢走。`, DROP_CONFIRM)) await wb.drop(r.c.code, r.c.seq, false); })()}>{i18n("auto.pages.zhjwxk.Courses.72")}</Btn>
            </Inline>
          ) : state === "candidate" ? (
            <Inline gap={2}>
              <Text slot="label" tone="warning">{r.cand ? (r.cand.myPos ? `排队第${r.cand.myPos}名 / 共${r.cand.queueTotal}人` : "候选中") : "候选中"}</Text>
              {r.teacherId ? <Btn variant="outline" size="sm" onClick={() => openDetail(r.c.code, r.teacherId)}>{i18n("auto.pages.zhjwxk.Courses.62")}</Btn> : null}
              <Btn variant="outline" size="sm" disabled={wb.busy !== null} onClick={() => void wb.drop(r.c.code, r.c.seq, true)}>{i18n("auto.pages.zhjwxk.Courses.73")}</Btn>
            </Inline>
          ) : (
            <Inline gap={1} wrap>
              {state === "full" ? <Text slot="label" tone="error">{i18n("auto.pages.zhjwxk.Courses.74")}</Text> : null}
              <Select size="sm" value={pick.flag} disabled={wb.busy !== null} onChange={(value) => setPicks((m) => ({ ...m, [key]: { ...pick, flag: value as XkFlag } }))}>{allowedFlags(pick.flag).map((f) => <option key={f} value={f}>{FLAG_LABELS[f]}</option>)}</Select>
              {!wb.phase ? <Select size="sm" value={String(pick.zy)} disabled={wb.busy !== null} onChange={(value) => setPicks((m) => ({ ...m, [key]: { ...pick, zy: Number(value) } }))}>{[3, 2, 1].map((z) => <option key={z} value={z}>{z}{i18n("auto.pages.zhjwxk.Courses.71")}</option>)}</Select> : null}
              {!wb.phase ? (
                <Text slot="label" tone={probTone(prob.probNum)}>{prob.prob}</Text>
              ) : null}
              <Btn variant="outline" size="sm" disabled={wb.busy !== null} onClick={() => void wb.submit(r.c.code, r.c.seq, pick.zy, pick.flag)}>{wb.busy === `submit-${r.c.code}-${r.c.seq}` ? "提交中…" : state === "full" ? "排队选课" : "选课"}</Btn>
              <Btn variant="outline" size="sm" disabled={inStage} onClick={() => wb.addToStage(r, pick.flag, pick.zy)}>{inStage ? "已暂存" : "暂存"}</Btn>
            </Inline>
          )}
        </Stack>
      </div>
      <Chip size="sm" tone={r.selected ? "success" : r.isCandidate ? "warning" : state === "full" ? "error" : "neutral"}>
        {r.selected ? `已选${r.zy ? ` · ${r.zy}志愿` : ""}` : r.isCandidate ? (r.cand?.myPos ? `候补 第${r.cand.myPos}名` : "候选") : state === "full" ? "已满" : r.available ? "可选" : "已满"}
      </Chip>
    </div>
  );
}

/* ══════════ 右栏⓪：培养方案（render.js renderPlan 同款卡片网格）══════════ */
function PlanSection({ wb }: { wb: ReturnType<typeof useXkWorkbench> }) {
  const coverage = useMemo(() => checkPlanCoverage(wb.plan, wb.courses, wb.stageCart, wb.savedDrafts.map((d) => d.courses), (wb.semester ?? "").endsWith("2")),
    [wb.plan, wb.courses, wb.stageCart, wb.savedDrafts, wb.semester]);
  if (!wb.plan.length) return null;
  const groups = new Map<string, PlanCoverageItem[]>();
  for (const c of coverage) {
    const g = c.group || c.attr || "其他";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(c);
  }
  const totalCr = coverage.reduce((s, c) => s + c.credits, 0);
  const coveredCr = coverage.filter((c) => c.covered).reduce((s, c) => s + c.credits, 0);
  return (
    <Sec title={i18n("auto.pages.zhjwxk.Courses.75")}>
      <Stack gap={0}>
        {[...groups.entries()].map(([g, items]) => {
          const cr = items.reduce((a, c) => a + c.credits, 0);
          const cov = items.filter((c) => c.covered).reduce((a, c) => a + c.credits, 0);
          return (
            <StatTile key={g} label={`${g} (${items.length}门)`}
              value={<Text slot="title" tone={cov >= cr ? "success" : "brand"} weight="bold">{cov}</Text>}
              unit={`/${cr}学分`} onClick={() => { planGroupClick?.(g); }} />
          );
        })}
      </Stack>
      <Text slot="label" tone="faint">{i18n("auto.pages.zhjwxk.Courses.76")}{coverage.length} {i18n("auto.pages.zhjwxk.Courses.77")}{coveredCr}/{totalCr} {i18n("auto.pages.zhjwxk.Courses.78")}</Text>
    </Sec>
  );
}
let planGroupClick: ((g: string) => void) | null = null;

/* ══════════ 右栏②：课表预览（render.js renderPreviewTT 逐行移植）══════════ */
function PreviewSection({ wb }: { wb: ReturnType<typeof useXkWorkbench> }) {
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
  }, [mode, wb]);

  // 概率/余量信息：返回 OG 语义 tone + 原始标签（色块不再由 hex 决定，
  // 由渲染侧按 tone/family 映射 --og-success/warning/error/accent 一族）
  const probOf = (c: { code: string; seq: string; zy: number; manual?: boolean; flag?: XkFlag; typeCode?: string }): { tone: "good" | "warn" | "bad" | "off"; label: string } => {
    if (c.manual) return { tone: "off", label: i18n("auto.pages.zhjwxk.Courses.p1") };
    if (wb.phase) {
      const qKey = `${c.code}_${c.seq || "0"}`;
      const r = wb.courses.find((x) => x.c.code === c.code && String(x.c.seq || "0") === String(c.seq || "0"));
      const qd = wb.queueMap[qKey] ?? r?.q;
      const cand = wb.candidates.find((cc) => cc.code === c.code && String(cc.seq) === String(c.seq || "0"));
      if (cand) return { tone: "warn", label: cand.myPos ? `排队第${cand.myPos}/${cand.queueTotal}人` : "候选" };
      if (mode === "selected") return { tone: "good", label: i18n("auto.pages.zhjwxk.Courses.p2") };
      if (qd) {
        if (qd.qRemaining > 0) return { tone: "good", label: `余${qd.qRemaining}` };
        if (qd.qQueue > 0) return { tone: "warn", label: `排队${qd.qQueue}人` };
        return { tone: "bad", label: i18n("auto.pages.zhjwxk.Courses.p3") };
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
      const lbl = (c.cand ? "候选：" : "") + (c.teacher ? `${c.name}(${c.teacher})` : c.name);
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
  }, [courses, mode, wb.phase, wb.queueMap, wb.candidates, wb.manualEvents]);

  const removeItem = async (code: string, seq: string): Promise<void> => {
    if (mode === "selected") {
      const c = wb.courses.find((x) => x.c.code === code && String(x.c.seq || "0") === String(seq));
      const name = c?.name || code;
      if (!(await confirmDanger(`「${name}」（${code}_${seq || "0"}）\n退选是真实退课操作，立即生效；补退选阶段退掉的名额可能立刻被抢走。`, DROP_CONFIRM))) return;
      await wb.drop(code, seq, false);
    } else if (mode === "stage") {
      const x = wb.stageCart.find((y) => y.code === code && String(y.seq || "0") === String(seq || "0"));
      if (!(await confirmOk(`从暂存区移除「${x?.name || code}」？`))) return;
      wb.removeFromStage(code, seq);
    } else {
      const d = wb.savedDrafts[wb.previewDraftIdx];
      if (!d) return;
      const x = d.courses.find((y) => y.code === code && String(y.seq || "0") === String(seq || "0"));
      if (!(await confirmOk(`从草稿移除「${x?.name || code}」？`))) return;
      wb.removeFromDraft(wb.previewDraftIdx, code, seq);
    }
  };

  const cr = courses.reduce((a, c) => a + (c.credits || 0), 0);
  const label = mode === "selected" ? "当前已选" : mode === "stage" ? `暂存车预览（暂存车${wb.stageCart.length}门${wb.stageCart.length ? "：" + wb.stageCart.map((x) => x.code).join("、") : ""}）` : `草稿「${wb.savedDrafts[wb.previewDraftIdx]?.name ?? ""}」预览`;
  const canvasH = pvY(PV_AXIS_END) + 12;
  const todayIdx = (() => { const d = new Date().getDay(); return d === 0 ? 6 : d - 1; })();
  return (
    <Sec title={i18n("auto.pages.zhjwxk.Courses.79")} extra={<Text slot="label" tone="faint">{label}</Text>}>
      <Inline gap={1} wrap>
        <Chip size="sm" selected={mode === "selected"} onClick={() => wb.setPreview("selected")}>{i18n("auto.pages.zhjwxk.Courses.80")}</Chip>
        <Chip size="sm" selected={mode === "stage"} onClick={() => wb.setPreview("stage")}>{i18n("auto.pages.zhjwxk.Courses.81")}</Chip>
        {wb.savedDrafts.map((d, i) => (
          <Chip key={i} size="sm" selected={mode === "draft" && wb.previewDraftIdx === i} onClick={() => wb.setPreview("draft", i)}>{d.name}</Chip>
        ))}
      </Inline>
      {!courses.length && !wb.manualEvents.length ? (
        <Text slot="label" tone="faint">{i18n("auto.pages.zhjwxk.Courses.82")}</Text>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 560 }}>
            <div style={{ display: "flex", marginBottom: 8, alignItems: "flex-end" }}>
              <div style={{ width: 34, flexShrink: 0 }} />
              {["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((name, i) => (
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
                      <Btn variant="outline" size="sm" titleAttr={b.cand ? "退出候补" : "移除"} onClick={(e) => { e.stopPropagation(); if (b.manual && b.id) wb.removeManualEvent(b.id); else if (b.cand && b.code && b.seq) void wb.drop(b.code, b.seq, true); else if (b.code && b.seq) void removeItem(b.code, b.seq); }}>✕</Btn>
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
          <Text slot="label" tone="faint">{i18n("auto.pages.zhjwxk.Courses.83")}{undet.length} {i18n("auto.pages.zhjwxk.Courses.84")}</Text>
          <Inline gap={1} wrap>
            {undet.map((u, i) => (
              <span key={i} title={i18n("auto.pages.zhjwxk.Courses.85")}>
                <Chip size="sm" onClick={() => void removeItem(u.code, u.seq)}>
                  {u.lbl} · {u.credits}{i18n("auto.pages.zhjwxk.Courses.60")}{u.zy ? ` · 第${u.zy}志愿` : ""} ✕
                </Chip>
              </span>
            ))}
          </Inline>
        </Stack>
      ) : null}
      {wb.manualEvents.length ? (
        <Inline gap={1} wrap>
          <Text slot="label" tone="faint">{i18n("auto.pages.zhjwxk.Courses.86")}</Text>
          {wb.manualEvents.map((e) => {
            const slots = parseTimeSlots(e.time || "");
            const when = e.begin && e.end ? `${["周一","周二","周三","周四","周五","周六","周日"][(e.day ?? 1) - 1]} ${e.begin}–${e.end}` : slots.map((x) => `${x.day}第${x.slot}大节`).join("、");
            return (
              <span key={e.id} title={i18n("auto.pages.zhjwxk.Courses.87")}>
                <Chip tone="brand" onRemove={() => wb.removeManualEvent(e.id)}>
                  {e.name}{when ? ` · ${when}` : ""}
                </Chip>
              </span>
            );
          })}
        </Inline>
      ) : null}
      <Text slot="label" tone="success">{courses.length}{i18n("auto.pages.zhjwxk.Courses.88")}{cr}{i18n("auto.pages.zhjwxk.Courses.60")}{wb.manualEvents.length ? ` · 自定义占用${wb.manualEvents.length}项` : ""}</Text>
      <Inline gap={1} wrap>
        <Btn variant="outline" size="sm" onClick={() => setMOpen((v) => !v)}>{i18n("auto.pages.zhjwxk.Courses.89")}</Btn>
      </Inline>
      {mOpen ? (
        <Stack gap={2}>
          <Field label={i18n("auto.pages.zhjwxk.Courses.90")}>
            <Input placeholder={i18n("auto.pages.zhjwxk.Courses.91")} value={mName} onChange={(value) => setMName(value)} />
          </Field>
          <Field label={i18n("auto.pages.zhjwxk.Courses.92")}>
            <Select value={mDay} onChange={setMDay}>{[1,2,3,4,5,6,7].map((d) => <option key={d} value={d}>{["周一","周二","周三","周四","周五","周六","周日"][d-1]}</option>)}</Select>
          </Field>
          <Inline gap={2}>
            <Grow>
              <Field label={i18n("auto.pages.zhjwxk.Courses.93")}>
                <Select value={mBegin} onChange={setMBegin}>{PV_HALF_HOURS.slice(0, -1).map((m) => <option key={m} value={pvHm(m)}>{pvHm(m)}</option>)}</Select>
              </Field>
            </Grow>
            <Grow>
              <Field label={i18n("auto.pages.zhjwxk.Courses.94")}>
                <Select value={mEnd} onChange={setMEnd}>{PV_HALF_HOURS.slice(1).map((m) => <option key={m} value={pvHm(m)}>{pvHm(m)}</option>)}</Select>
              </Field>
            </Grow>
          </Inline>
          <Text slot="label" tone="faint">{i18n("auto.pages.zhjwxk.Courses.95")}</Text>
          <Btn variant="outline" disabled={!(mBegin < mEnd)} onClick={() => { wb.addManualEventRange(mName, Number(mDay), mBegin, mEnd); setMName(""); setMOpen(false); }}>{i18n("auto.pages.zhjwxk.Courses.96")}</Btn>
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
      if (!Array.isArray(incoming)) throw new Error("缺少 courses");
      for (const c of incoming) wb.importStageItem(c);
      setImportText(""); setImportOpen(false);
    } catch (e) { wb.setToast(`导入失败: ${e instanceof Error ? e.message : String(e)}`); }
  };
  return (
    <Sec title={`暂存课表（${wb.stageCart.length}）`}>
      {/* 志愿数据检查点同步状态（NextTHUxk 2.0 回移：8/12/16/20 点对齐 + 手动补拉） */}
      {wb.volState === "loading" ? <Text slot="label" tone="faint">{i18n("auto.pages.zhjwxk.Courses.97")}</Text>
        : wb.volState === "error" ? (
          <Inline gap={2}>
            <Text slot="label" tone="faint">{i18n("auto.pages.zhjwxk.Courses.98")}</Text>
            <Btn variant="outline" size="sm" onClick={() => void wb.refreshVol(wb.stageCart.map((st) => ({ code: st.code, seq: st.seq || "0", department: "" })), true)}>{i18n("auto.pages.zhjwxk.Courses.49")}</Btn>
          </Inline>
        ) : wb.volLastSync ? (
          <Text slot="label" tone="faint">
            {i18n("auto.pages.zhjwxk.Courses.99")}{new Date(wb.volLastSync).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} {i18n("auto.pages.zhjwxk.Courses.100")}{nextVolCheckpoint().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
          </Text>
        ) : null}
      {wb.stageCart.length === 0 ? <Text slot="label" tone="faint">{i18n("auto.pages.zhjwxk.Courses.101")}</Text> : (
        <List gap={1}>
          {wb.stageCart.map((s, i) => {
            const p = itemProb(wb, s.code, s.seq, s.flag, s.zy);
            // 余量按 (课号,班次) 精确匹配——同课号多班次只按课号会串行（简介串台同款病）
            const vol = wb.courses.find((r) => r.c.code === s.code && String(r.c.seq || "0") === String(s.seq || "0"))?.q?.qRemaining;
            return (
              <Row key={`${s.code}_${s.seq || "0"}_${i}`} size="sm" titleAttr={`点击搜索：${s.name}（${s.code}）`} onClick={() => jumpTo(s.code, "all", s.seq)}
                title={s.name}
                sub={s.teacher ? s.teacher : undefined}
                trailing={
                  <Inline gap={2}>
                    {s.credits ? <Text slot="label" tone="faint" nowrap>{s.credits}{i18n("auto.pages.zhjwxk.Courses.60")}</Text> : null}
                    <IconBtn label={i18n("auto.pages.zhjwxk.Courses.102")} size="sm" icon={<IconX size="sm" />} titleAttr={i18n("auto.pages.zhjwxk.Courses.102")} onClick={() => wb.removeFromStage(s.code, s.seq)} />
                  </Inline>
                }
              >
                <Inline gap={2} wrap>
                  <Select size="sm" value={s.flag} onChange={(value) => wb.updateStageItem(s.code, s.seq, { flag: value as XkFlag })}>{allowedFlags(s.flag).map((f) => <option key={f} value={f}>{FLAG_LABELS[f]}</option>)}</Select>
                  <Select size="sm" value={s.zy} onChange={(value) => wb.updateStageItem(s.code, s.seq, { zy: Number(value) })}>{[3, 2, 1].map((z) => <option key={z} value={z}>{z}{i18n("auto.pages.zhjwxk.Courses.71")}</option>)}</Select>
                  <Text slot="label" tone={wb.phase ? "faint" : probTone(p.probNum)} nowrap>
                    {wb.phase ? (vol ?? "—") : p.prob}
                  </Text>
                </Inline>
              </Row>
            );
          })}
        </List>
      )}
      {conflicts.length ? <Text slot="label" tone="error">{i18n("auto.pages.zhjwxk.Courses.69")}{conflicts.slice(0, 5).map((c) => `${dayName(c.day)} ${SLOT_NAMES[c.slot - 1]} ${c.a}/${c.b}`).join(" · ")}</Text> : null}
      <Inline gap={1} wrap>
        <Grow><Input size="sm" placeholder={i18n("auto.pages.zhjwxk.Courses.103")} value={draftName} onChange={(value) => setDraftName(value)} /></Grow>
        <Btn variant="outline" size="sm" onClick={() => { if (draftName.trim()) { wb.saveDraft(draftName.trim()); setDraftName(""); } }}>{i18n("auto.pages.zhjwxk.Courses.104")}</Btn>
        <Btn variant="outline" size="sm" onClick={() => { const n = globalThis.prompt?.("草稿名称", "我的课表"); if (n) wb.saveCurrentAsDraft(n); }}>{i18n("auto.pages.zhjwxk.Courses.105")}</Btn>
        <Btn variant="outline" size="sm" onClick={() => wb.setPreview("stage")}>{i18n("auto.pages.zhjwxk.Courses.81")}</Btn>
        <Btn variant="outline" size="sm" disabled={!wb.stageCart.length && !wb.manualEvents.length} onClick={() => { void (async () => { if (await confirmOk(`清空暂存车 ${wb.stageCart.length} 门 + 自定义占用 ${wb.manualEvents.length} 项？`)) { for (const s of [...wb.stageCart]) wb.removeFromStage(s.code, s.seq); wb.clearManualEvents(); } })()}}>{i18n("auto.pages.zhjwxk.Courses.106")}</Btn>
        <Btn variant="outline" size="sm" onClick={() => setImportOpen((v) => !v)}>{i18n("auto.pages.zhjwxk.Courses.107")}</Btn>
      </Inline>
      {importOpen ? (
        <Stack gap={1}>
          <TextArea placeholder={i18n("auto.pages.zhjwxk.Courses.108")} value={importText} onChange={(value) => setImportText(value)} />
          <Inline gap={1}>
            <Btn variant="outline" size="sm" onClick={putImport}>{i18n("auto.pages.zhjwxk.Courses.109")}</Btn>
            <Btn variant="outline" size="sm" onClick={() => setImportOpen(false)}>{i18n("auto.pages.zhjwxk.Courses.110")}</Btn>
          </Inline>
        </Stack>
      ) : null}
      <Stack gap={1}>
        {wb.savedDrafts.map((d, idx) => (
          <OGCard key={idx} pad="sm">
            <Inline gap={2} wrap spread>
              <Text weight="bold">{d.name}</Text>
              <Text slot="label" tone="faint">{d.courses.length} {i18n("auto.pages.zhjwxk.Courses.59")}{d.courses.reduce((a, c) => a + (c.credits || 0), 0)} {i18n("auto.pages.zhjwxk.Courses.60")}</Text>
              {confirmIdx === idx ? (
                <Inline gap={1}>
                  <Btn variant="outline" size="sm" onClick={() => { setConfirmIdx(-1); void wb.submitDraft(idx); }}>{i18n("auto.pages.zhjwxk.Courses.111")}</Btn>
                  <Btn variant="outline" size="sm" onClick={() => setConfirmIdx(-1)}>{i18n("auto.pages.zhjwxk.Courses.110")}</Btn>
                </Inline>
              ) : (
                <Btn variant="outline" size="sm" onClick={() => setConfirmIdx(idx)}>{i18n("auto.pages.zhjwxk.Courses.112")}</Btn>
              )}
              <Btn variant="outline" size="sm" onClick={() => wb.setPreview("draft", idx)}>{i18n("auto.pages.zhjwxk.Courses.113")}</Btn>
              <Btn variant="outline" size="sm" onClick={() => void wb.exportDraft(idx)}>{i18n("auto.pages.zhjwxk.Courses.114")}</Btn>
              <Btn variant="outline" size="sm" onClick={() => wb.deleteDraft(idx)}>{i18n("auto.pages.zhjwxk.Courses.73")}</Btn>
            </Inline>
          </OGCard>
        ))}
        {wb.savedDrafts.length ? <Text slot="label" tone="faint">{i18n("auto.pages.zhjwxk.Courses.115")}</Text> : null}
      </Stack>
    </Sec>
  );
}

/* ══════════ 右栏④：我的候补 ══════════ */
function QueueSection({ wb }: { wb: ReturnType<typeof useXkWorkbench> }) {
  if (!wb.candidates.length) return null;
  return (
    <Sec title={`我的候补（${wb.candidates.length}）`}>
      <List divided>
        {wb.candidates.map((c, i) => (
          <Row key={`${c.code}-${i}`} size="sm"
            leading={<Chip size="sm" tone="warning">{c.myPos ? `第${c.myPos}位/${c.queueTotal}` : "候选"}</Chip>}
            title={c.name}
            titleAttr={`${c.name}（${c.code}${c.seq && c.seq !== "0" ? `·${c.seq}` : ""}）`}
            meta={<Text slot="label" tone="faint">{c.code}{c.seq && c.seq !== "0" ? `·${c.seq}` : ""}</Text>}
            trailing={<Btn variant="outline" size="sm" disabled={wb.busy !== null} onClick={() => void wb.drop(c.code, c.seq, true)}>{i18n("auto.pages.zhjwxk.Courses.73")}</Btn>}
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
