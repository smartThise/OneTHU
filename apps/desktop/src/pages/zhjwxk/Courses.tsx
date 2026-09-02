/**
 * 选课工作台 —— nextthuxk v1.4.9 布局复刻（单屏两栏）：
 * 左栏 = 搜索/筛选chips/筛选selects/课程列表；右栏 = 学分统计·课表预览·暂存草稿·候补·AI。
 * UI 用 OneTHU 设计系统（Card/list/row/chip/btn/input）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Card, Empty, ErrorNote, PageHead, SegmentedOverflow, SkeletonRows } from "../../components/Layout.js";
import { IconRefresh } from "../../components/Icons.js";
import { useXkWorkbench, type XkSearchMeta, type XkStageItem } from "../../state/data.js";
import type { XkCourseDetail } from "@onethu/core";
import { tbEnsureIndex, tbFetchReviews, tbMatch, tbStars, tbCourseUrl, tbWriteUrl, type TbEntry, type TbReviews } from "../../lib/xkreviews.js";
import { openExternal } from "../info/openExternal.js";
import { callAi, extractJsonArray, loadAiConfig, saveAiConfig, type AiConfig } from "../../lib/xkai.js";
import {
  allowedFlags, calcProb, checkPlanCoverage, dayName, findPreviewConflicts, typeCodeToFlag,
  FLAG_LABELS, parseTimeSlots, SLOT_NAMES, type PlanCoverageItem, type SlotItem, type XkFlag, type XkRow, zyTypeOf,
} from "../../lib/xklogic.js";

const TS_GROUPS: Array<[string, string]> = [["TS1", "人文课组"], ["TS2", "社科课组"], ["TS3", "艺术课组"], ["TS4", "科学课组"]];
const FEATURES: Array<[string, string]> = [
  ["专题研讨课", "专题研讨课"], ["全外文授课", "全外文授课"], ["外文授课比例≥50%", "双语课(外文≥50%)"], ["外文教材", "双语课(外文教材)"],
  ["实践课", "实践课"], ["实验课", "实验课"], ["挑战性学习", "挑战性学习课程"], ["文化素质核心课", "文化素质核心课"],
  ["文化素质课", "文化素质课"], ["新生研讨课", "新生研讨课"], ["混合式教学", "混合式教学"], ["精品课", "精品课"],
  ["认证外文课", "认证外文课"], ["通识荣誉课", "通识荣誉课"], ["通识选修课", "通识选修课"], ["语言类", "语言类课程"],
  ["通识英语", "通识英语"], ["公共英语", "公共英语"],
];
const fmtVol = (v: string): string => {
  const m = /\((\d+)\)([\d,]*)/.exec(v);
  return m ? `优先${m[1]}/${m[2]!.split(",").join("/")}` : v;
};
const heat = (applied: number, cap: number): string => (!cap ? "inherit" : applied / cap <= 0.8 ? "var(--green)" : applied / cap <= 1.2 ? "var(--amber)" : "var(--red)");
const tbBadge = (r: XkRow): string => {
  const e = tbMatch(r.name, r.teacher);
  return e && e.count > 0 ? `${tbStars(e.avg)} ${e.avg ? e.avg.toFixed(1) : ""}(${e.count})` : "";
};
const itemProb = (wb: ReturnType<typeof useXkWorkbench>, code: string, seq: string, flag: XkFlag, zy: number): { prob: string; color: string; bg: string } => {
  const row = wb.courses.find((r) => r.c.code === code && r.c.seq === seq);
  const vol = row?.vol;
  const cap = vol?.capacity || row?.c.capacity || 0;
  const p = calcProb(cap, vol, flag, zy);
  return { prob: p.label === "无数据" ? "无数据" : `${p.percentLabel} · ${p.ratioLabel}`, color: p.color, bg: p.bg };
};
/* 跳转/弹窗 opener（module-level 轻通道） */
let _jump = "";
let _jumpSetter: ((v: string) => void) | null = null;
let _detailOpen: ((code: string) => void) | null = null;
let _reviewOpen: ((v: { code: string; seq: string; name: string; teacher: string }) => void) | null = null;
const jumpTo = (code: string): void => { _jump = code; _jumpSetter?.(code); };
const openDetail = (code: string): void => { _detailOpen?.(code); };
const openReviews = (v: { code: string; seq: string; name: string; teacher: string }): void => { _reviewOpen?.(v); };

/* ══════════ 弹窗（自带表面色，不依赖 Card 上下文变量）══════════ */
const maskStyle: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 };
const panelStyle: React.CSSProperties = { width: "100%", maxWidth: 620, maxHeight: "78vh", display: "flex", flexDirection: "column", background: "var(--bg-elev, #ffffff)", color: "var(--text, #1f2329)", borderRadius: 14, boxShadow: "0 18px 50px rgba(0,0,0,.28)" };
const panelHead: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--border, #eee)" };
const panelBody: React.CSSProperties = { padding: "12px 16px", overflowY: "auto", fontSize: 13, lineHeight: 1.65 };

function DetailModal({ wb, code, onClose }: { wb: ReturnType<typeof useXkWorkbench>; code: string | null; onClose: () => void }) {
  const [data, setData] = useState<XkCourseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!code) return;
    setLoading(true);
    setData(null);
    void wb.loadDetail(code).then((d) => { setData(d); setLoading(false); });
  }, [code]);
  if (!code) return null;
  const order = ["课程编号", "课程名称", "总学时数", "总学分", "课程内容简介", "Course Description", "考核安排", "联系人", "教材及参考书", "上课教师", "选课指导语", "先修要求", "教师教学特色", "Office Hour", "成绩评定标准", "参考书"];
  const entries = data ? Object.entries(data.fields) : [];
  entries.sort((a, b) => {
    const ia = order.indexOf(a[0]), ib = order.indexOf(b[0]);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return createPortal(
    <div style={maskStyle} className="xk-mask" onClick={onClose}>
      <div style={panelStyle} className="xk-panel" onClick={(e) => e.stopPropagation()}>
        <div style={panelHead}><b>课程简介</b><span style={{ flex: 1 }} /><button className="btn" onClick={onClose}>✕</button></div>
        <div style={panelBody}>
          {loading ? <Empty text="正在加载课程简介…" /> : !data ? <Empty text="暂无课程简介信息（该课缺教师号，无法拉取）" /> : entries.map(([k, v]) => (
            <div key={k} style={{ display: "flex", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--border, #f0f0f0)" }}>
              <div style={{ width: 108, flexShrink: 0, color: "var(--text-3, #9aa1ac)", fontSize: 12 }}>{k}</div>
              <div style={{ flex: 1, whiteSpace: "pre-wrap" }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
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
  // Esc 关闭（插件 modal 同款：mask 点击/Esc 均可退出）
  useEffect(() => {
    if (!code) return;
    const onKey = (ev: KeyboardEvent): void => { if (ev.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [code, onClose]);
  // 未打开时绝不渲染（重写时弄丢的守卫 —— 空态也渲染遮罩且永远关不掉，就是糊脸黑罩的根因）
  if (!code) return null;

  const headBits: React.ReactNode[] = [];
  if (entry && entry.count) {
    headBits.push(
      <div key="h" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: "var(--amber, #ff9f1a)" }}>{Number(entry.avg).toFixed(1)}</span>
        <span>
          <span style={{ color: "var(--amber, #ff9f1a)", letterSpacing: 1 }}>{tbStars(entry.avg)}</span>
          <span style={{ fontSize: 12, color: "var(--text-3, #9aa1ac)" }}> {entry.count} 条点评{entry.kkdw ? ` · ${entry.kkdw}` : ""}</span>
        </span>
      </div>,
    );
  } else {
    headBits.push(<div key="h" style={{ fontSize: 13, color: "var(--text-3, #9aa1ac)" }}>这门课在 THU选课社区还没有点评</div>);
  }
  const courseUrl = entry ? tbCourseUrl(entry) : tbCourseUrl(entry!);
  headBits.push(
    <div key="a" style={{ display: "flex", gap: 10, marginTop: 8 }}>
      <a className="btn" href={courseUrl} onClick={(e) => { e.preventDefault(); void openExternal(courseUrl); }}>查看课程页 ↗</a>
      <a className="btn" style={{ borderColor: "var(--accent)", color: "var(--accent)" }} href={tbWriteUrl(entry)} onClick={(e) => { e.preventDefault(); void openExternal(tbWriteUrl(entry)); }}>✎ 去写点评</a>
    </div>,
    <div key="l" style={{ marginTop: 8, fontSize: 11, color: "var(--text-3, #9aa1ac)" }}>
      点评数据来自 <a href={courseUrl} onClick={(e) => { e.preventDefault(); void openExternal(courseUrl); }} style={{ color: "var(--accent)" }}>THU选课社区</a> 贡献者，以{" "}
      <a href="https://creativecommons.org/licenses/by-nc/4.0/deed.zh" onClick={(e) => { e.preventDefault(); void openExternal("https://creativecommons.org/licenses/by-nc/4.0/deed.zh"); }} style={{ color: "var(--accent)" }}>CC BY-NC 4.0</a> 提供 · 仅限非商业用途
    </div>,
  );
  return createPortal(
    <div style={maskStyle} className="xk-mask" onClick={onClose}>
      <div style={panelStyle} className="xk-panel" onClick={(e) => e.stopPropagation()}>
        <div style={panelHead}><b>{name} · 社区点评</b><span style={{ flex: 1 }} /><button className="btn" onClick={onClose}>✕</button></div>
        <div style={panelBody}>
          {headBits}
          {entry ? (
            phase === "loading" ? <Empty text="拉取正文…" /> : phase === "fail" ? <Empty text="点评加载失败（网络原因），稍后重试" /> :
            !data?.results.length ? <Empty text="暂无点评正文" /> : (
              <div style={{ marginTop: 10 }}>
                {data.results.map((r, i) => (
                  <div key={i} style={{ borderTop: "1px solid var(--border, #f0f0f0)", padding: "8px 0" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ color: "var(--amber, #ff9f1a)", letterSpacing: 1 }}>{tbStars(r.rating ?? 0)}</span>
                      <span style={{ fontWeight: 700 }}>{Number(r.rating ?? 0)}</span>
                      {r.score ? <span className="chip" style={{ fontSize: 10 }}>给分 {String(r.score).slice(0, 8)}</span> : null}
                      <span style={{ fontSize: 11, color: "var(--text-3, #9aa1ac)", marginLeft: "auto" }}>{r.created_at ?? ""}</span>
                    </div>
                    <div style={{ marginTop: 4, whiteSpace: "pre-wrap", fontSize: 12.5 }}>{String(r.comment ?? "").trim()}</div>
                  </div>
                ))}
              </div>
            )
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ══════════ 右栏小节标题 ══════════ */
function Sec({ title, extra, children }: { title: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card style={{ padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <b style={{ fontSize: 13 }}>{title}</b>
        <span style={{ flex: 1 }} />
        {extra}
      </div>
      {children}
    </Card>
  );
}

/* ══════════ 主页面：单屏两栏 ══════════ */
export function ZhjwxkCoursesPage() {
  const wb = useXkWorkbench();
  const [detailCode, setDetailCode] = useState<string | null>(null);
  const [reviewCode, setReviewCode] = useState<{ code: string; seq: string; name: string; teacher: string } | null>(null);
  const [jump, setJump] = useState("");
  // 竖屏三页签：课程查找 / 选课管理 / AI 选课（桌面仍为双栏，此状态仅移动端消费）
  const [mTab, setMTab] = useState<"find" | "manage" | "ai">("find");
  useEffect(() => {
    void tbEnsureIndex().catch(() => undefined);
    _jumpSetter = setJump;
    _detailOpen = setDetailCode;
    _reviewOpen = setReviewCode;
    return () => { _jumpSetter = null; _detailOpen = null; _reviewOpen = null; };
  }, []);

  useEffect(() => {
    if (jump) setMTab("find"); // 点课表/暂存里的课 → 跳回「课程查找」页签
  }, [jump]);

  const selCredits = wb.selected.reduce((a, s) => a + (s.credits || 0), 0);
  return (
    <>
      <PageHead
        title="选课"
        meta={[
          wb.semester ?? "选课系统",
          wb.phase ? "课余量模式" : "预选模式",
          `已选 ${wb.selected.length} 门 · ${selCredits} 学分`,
          `已浏览 ${wb.searchRows.length} 门（实时）`,
        ].filter(Boolean).join(" · ")}
        actions={
          <>
            <select className="input" style={{ height: 28, fontSize: 12 }} value={wb.semester ?? ""} onChange={(e) => void wb.setSemesterOverride(e.target.value)}>
              {(wb.semesterOptions ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {wb.phase ? <button className="btn" onClick={() => void wb.refreshQueue()} disabled={wb.queueState === "loading"}>刷新队列</button> : null}
            <button className="btn" onClick={() => void wb.refresh()} disabled={wb.coreState === "loading"}>
              <IconRefresh width={14} height={14} />
              刷新数据
            </button>
          </>
        }
      />
      {wb.coreState === "error" ? <ErrorNote text={wb.error ?? ""} onRetry={() => void wb.refresh()} /> : null}
      {wb.toast ? (
        <Card style={{ padding: "8px 14px", borderColor: "var(--accent)", marginBottom: 10 }}>
          <span style={{ fontSize: "var(--text-sm)" }}>{wb.toast}</span>
          <button className="btn" style={{ marginLeft: 10 }} onClick={() => wb.setToast(null)}>知道了</button>
        </Card>
      ) : null}
      {wb.progress ? <Card style={{ padding: "8px 14px", borderColor: "var(--amber)", marginBottom: 10 }}><span style={{ fontSize: "var(--text-sm)" }}>{wb.progress}</span></Card> : null}

      {/* ── 桌面：双栏（左查找 / 右管理+AI）── */}
      <div className="xk-two-col" style={{ display: "flex", gap: 12, alignItems: "stretch", flexWrap: "nowrap", width: "100%", maxWidth: "100%", overflow: "hidden" }}>
        <div className="xk-left" style={{ maxHeight: "calc(100vh - 150px)" }}>
          <CourseListPanel wb={wb} jump={jump} />
        </div>
        <div className="xk-right" style={{ maxHeight: "calc(100vh - 150px)", display: "flex", flexDirection: "column", gap: 10 }}>
          <PlanSection wb={wb} />
          <StatsSection wb={wb} />
          <PreviewSection wb={wb} />
          <StageSection wb={wb} />
          <QueueSection wb={wb} />
          <AiSections wb={wb} />
        </div>
      </div>

      {/* ── 竖屏：三页签（课程查找 / 选课管理 / AI 选课），跳转关系由 jump 联动 ── */}
      <div className="xk-mobile-tabs">
        <SegmentedOverflow ariaLabel="选课分栏">
          {([["find", "课程查找"], ["manage", "选课管理"], ["ai", "AI 选课"]] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={mTab === k} className={mTab === k ? "is-active" : ""} onClick={() => setMTab(k)}>
              {label}
            </button>
          ))}
        </SegmentedOverflow>
        {mTab === "find" ? <CourseListPanel wb={wb} jump={jump} /> : null}
        {mTab === "manage" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <PlanSection wb={wb} />
            <StatsSection wb={wb} />
            <PreviewSection wb={wb} />
            <StageSection wb={wb} />
            <QueueSection wb={wb} />
          </div>
        ) : null}
        {mTab === "ai" ? <AiSections wb={wb} /> : null}
      </div>

      <DetailModal wb={wb} code={detailCode} onClose={() => setDetailCode(null)} />
      <ReviewsModal code={reviewCode?.code ?? null} seq={reviewCode?.seq ?? ""} name={reviewCode?.name ?? ""} teacher={reviewCode?.teacher ?? ""} onClose={() => setReviewCode(null)} />
    </>
  );
}

/* ══════════ 左栏：搜索 + 筛选 + 列表 ══════════ */
function CourseListPanel({ wb, jump }: { wb: ReturnType<typeof useXkWorkbench>; jump: string }) {
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

  /* 服务端筛选映射：课程号(纯数字)/课程名→文本框，通识课组→p_rxklxm，课程特色→p_kctsm，
   * 年级→p_ssnj，星期→p_skxq，大节→p_skjc，本/研余量→p_bkskyl_ig/p_yjskyl_ig。
   * 其余（冲突/学分/评价/文字说明/chips）为本地叠加，作用于已取回的页。 */
  const serverKey = useMemo(() => JSON.stringify([
    query.trim(), tongshi, feature, grade, day, period, bksrem === "1", yjsrem === "1",
  ]), [query, tongshi, feature, grade, day, period, bksrem, yjsrem]);
  const firstSearchRef = useRef(false);
  useEffect(() => {
    const kw = query.trim();
    const meta: XkSearchMeta = {
      kcm: /^\d{4,}$/.test(kw) ? "" : kw,
      teacher: "",
      department: "",
      weekday: day || "",
      section: period || "",
      grade,
      rxklxm: tongshi || "",
      kctsm: FEATURES.some(([label]) => label === feature) ? feature : "",
      onlyAvailable: bksrem === "1",
      gradAvail: yjsrem === "1",
      kch: /^\d{4,}$/.test(kw) ? kw : "",
    };
    const t = setTimeout(() => {
      firstSearchRef.current = true;
      void wb.newSearch(meta);
    }, firstSearchRef.current ? 500 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);
  useEffect(() => {
    if (!jump) return;
    setQuery(jump);
    setChip("all");
    setHighlight(jump);
    const t = setTimeout(() => setHighlight(""), 1800);
    return () => clearTimeout(t);
  }, [jump]);

  const rows = useMemo<XkRow[]>(() => {
    if (wb.searchState === "idle" || wb.searchState === "loading") return [];
    const q = query.trim().toLowerCase();
    const dayRe = day && period ? new RegExp(`${day}-${period}\\(`) : day ? new RegExp(`${day}-\\d`) : period ? new RegExp(`\\d+-${period}\\(`) : null;
    const base = wb.searchRows
      .filter((r) => {
        if (q && !(r.name.toLowerCase().includes(q) || r.c.code.includes(q) || r.teacher.toLowerCase().includes(q))) return false;
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
    else scored.sort((a, b) => ((a.e?.avg ?? 6) - (b.e?.avg ?? 6)) || ((b.e?.count ?? 0) - (a.e?.count ?? 0)));
    return scored.map((x) => x.r);
  }, [wb.searchRows, wb.searchState, wb.previewIndex, query, chip, credits, day, period, conflictF, tongshi, feature, grade, bksrem, yjsrem, xknote, reviewsF, sortBy]);

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
  const totalPages = wb.searchTotalPages || Math.max(1, Math.ceil(listRows.length / 20));
  const curPage = searchMode ? Math.min(uiPage, totalPages) : wb.searchPage;
  const pagedRows = useMemo(
    () => (searchMode ? listRows.slice((curPage - 1) * 20, curPage * 20) : listRows),
    [listRows, searchMode, curPage],
  );
  const busy = wb.searchState === "loading" || wb.searchState === "loadingMore";
  const pageLoaded = !searchMode || !wb.searchIncomplete || curPage * 20 <= listRows.length;
  const goJump = () => {
    const n = parseInt(goPage, 10);
    if (!Number.isFinite(n) || n < 1) return;
    if (searchMode) setUiPage(Math.min(n, totalPages));
    else void wb.gotoPage(n);
    setGoPage("");
  };

  const selSel = "input";
  const selStyle: React.CSSProperties = { height: 26, fontSize: 12, flex: 1, minWidth: 96 };
  return (
    <>
      <Card style={{ padding: 10, marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input className="input" style={{ flex: 1 }} placeholder="搜索课程名称、教师、课程号…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query ? <button className="btn" onClick={() => setQuery("")}>×</button> : null}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          {([["all", "全部"], ["available", "可选"], ["selected", "已选"], ["required", "必修"], ["elective", "限选"], ["sports", "体育"], ["queue", "我的队列"], ["plan", "培养方案"]] as const).map(([k, label]) => (
            <button key={k} className={"btn" + (chip === k ? " is-active" : "")} onClick={() => setChip(k)}>{label}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <select className={selSel} style={selStyle} value={conflictF} onChange={(e) => setConflictF(e.target.value)}><option value="">不限制冲突</option><option value="noconflict">仅无冲突</option><option value="conflict">仅冲突</option></select>
          <select className={selSel} style={selStyle} value={credits} onChange={(e) => setCredits(e.target.value)}><option value="">全部学分</option>{["1", "2", "3", "4", "5+"].map((v) => <option key={v} value={v}>{v === "5+" ? "5+学分" : `${v}学分`}</option>)}</select>
          <select className={selSel} style={selStyle} value={day} onChange={(e) => setDay(e.target.value)}><option value="">不限周次</option>{[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{dayName(d)}</option>)}</select>
          <select className={selSel} style={selStyle} value={period} onChange={(e) => setPeriod(e.target.value)}><option value="">不限大节</option>{SLOT_NAMES.map((n, i) => <option key={i} value={i + 1}>第{i + 1}大节</option>)}</select>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
          <select className={selSel} style={selStyle} value={reviewsF} onChange={(e) => setReviewsF(e.target.value)}><option value="">社区评价: 不限</option><option value="has">有点评</option><option value="cnt5">点评≥5条</option><option value="r45">★≥4.5 好评</option><option value="r40">★≥4.0</option><option value="low">★≤3.0 避雷线</option></select>
          <select className={selSel} style={selStyle} value={sortBy} onChange={(e) => setSortBy(e.target.value)}><option value="">排序: 默认目录序</option><option value="rate_desc">社区评分 高→低</option><option value="rate_asc">社区评分 低→高</option><option value="cnt_desc">点评数 多→少</option></select>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
          <select className={selSel} style={selStyle} value={tongshi} onChange={(e) => setTongshi(e.target.value)}><option value="">通识课组: 不限</option>{TS_GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select className={selSel} style={selStyle} value={feature} onChange={(e) => setFeature(e.target.value)}><option value="">课程特色: 不限</option>{FEATURES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select className={selSel} style={selStyle} value={grade} onChange={(e) => setGrade(e.target.value)}><option value="">年级: 不限</option>{["2026", "2025", "2024", "2023", "2022", "2021", "2020", "2019"].map((g) => <option key={g} value={g}>{g}级</option>)}</select>
          <select className={selSel} style={selStyle} value={bksrem} onChange={(e) => setBksrem(e.target.value)}><option value="">本科余量: 不限</option><option value="1">本科余量&gt;0</option></select>
          <select className={selSel} style={selStyle} value={yjsrem} onChange={(e) => setYjsrem(e.target.value)}><option value="">研院余量: 不限</option><option value="1">研院余量&gt;0</option></select>
        </div>
        <div style={{ marginTop: 6 }}>
          <input className="input" style={{ width: "100%", height: 28, fontSize: 12 }} placeholder="选课文字说明搜索" value={xknote} onChange={(e) => setXknote(e.target.value)} />
        </div>
      </Card>

      {chip === "plan" ? <PlanView wb={wb} query={query} /> : wb.searchState === "idle" || wb.searchState === "loading" ? (
        <Card><SkeletonRows rows={6} /><Empty text="正在实时查询教务系统（搜索/翻页各 1 个往返，即搜即得）…" /></Card>
      ) : wb.searchState === "error" ? (
        <ErrorNote text={wb.searchError ?? ""} onRetry={() => void wb.retrySearch()} />
      ) : rows.length === 0 ? (
        <Card><Empty text={wb.searchError || "暂无匹配课程。"} /></Card>
      ) : (
        <>
          <Card className="list">
            {pagedRows.map((r, i) => <PickCard key={r.key} wb={wb} r={r} i={i} picks={picks} setPicks={setPicks} highlight={r.c.code === highlight} />)}
            {pagedRows.length === 0 && !pageLoaded ? (
              <Empty text="此页未加载——点下方「加载全部」后可查看。" />
            ) : null}
          </Card>
          {wb.searchIncomplete ? (
            <div style={{ textAlign: "center", padding: "8px 0", fontSize: 12, color: "var(--amber)" }}>
              数据不完整：已加载前 {Math.ceil(listRows.length / 20)} 页（{listRows.length} 门），教务共 {wb.searchTotalPages} 页
              <button className="btn" style={{ marginLeft: 8 }} disabled={busy} onClick={() => void wb.loadAllSearch()}>
                {busy ? "加载中…" : "加载当前关键词全部"}
              </button>
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 10, justifyContent: "center", alignItems: "center", padding: "10px 0", flexWrap: "wrap" }}>
            <button className="btn" disabled={busy || (searchMode ? curPage <= 1 : wb.searchPage <= 1)}
              onClick={() => (searchMode ? setUiPage(curPage - 1) : void wb.gotoPage(wb.searchPage - 1))}>上一页</button>
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>
              第 {curPage} 页 / 共 {totalPages} 页{!searchMode || !wb.searchIncomplete ? `（${listRows.length} 门）` : ""}
            </span>
            <button className="btn" disabled={busy || (searchMode ? curPage >= totalPages : !wb.searchHasMore && !(wb.searchTotalPages > wb.searchPage))}
              onClick={() => {
                if (searchMode) setUiPage(curPage + 1);
                else void wb.gotoPage(wb.searchPage + 1);
              }}>下一页</button>
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>跳至</span>
            <input className="input" style={{ width: 52, height: 24, fontSize: 12 }} value={goPage}
              onChange={(e) => setGoPage(e.target.value.replace(/[^0-9]/g, ""))} onKeyDown={(e) => e.key === "Enter" && goJump()} />
            <button className="btn" disabled={busy || !goPage} onClick={goJump}>GO</button>
          </div>
        </>
      )}
    </>
  );
}

/* ══════════ 培养方案视图（render.js renderPlanView 逐行移植）══════════ */
function PlanView({ wb, query }: { wb: ReturnType<typeof useXkWorkbench>; query: string }) {
  const coverage = useMemo(() => checkPlanCoverage(wb.plan, wb.courses, wb.stageCart, wb.savedDrafts.map((d) => d.courses)),
    [wb.plan, wb.courses, wb.stageCart, wb.savedDrafts]);
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
        <Empty text="暂无培养方案数据（可能该学期未配置培养方案，或会话已过期）" />
        <div style={{ textAlign: "center", paddingBottom: 10 }}>
          <button className="btn" onClick={() => void wb.refresh()}>重试</button>
        </div>
      </Card>
    );
  }
  const q = query.trim().toLowerCase();
  const filtered = q ? coverage.filter((p) => p.name.toLowerCase().includes(q) || p.code.includes(q) || (p.attr || "").includes(q)) : coverage;
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
      <Card style={{ marginBottom: 12, padding: "12px 16px", fontSize: 13 }}>
        <b>培养方案进度</b>: {coveredN}/{coverage.length}门 · {coveredCr}/{totalCr}学分
        <div style={{ marginTop: 6, height: 6, background: "rgba(0,0,0,.06)", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${totalCr ? Math.round((coveredCr / totalCr) * 100) : 0}%`, background: "var(--accent)", borderRadius: 3 }} />
        </div>
      </Card>
      {[...groups.entries()].map(([g, courses]) => {
        const gTotal = courses.reduce((s, c) => s + c.credits, 0);
        const gCovered = courses.filter((c) => c.covered).reduce((s, c) => s + c.credits, 0);
        return (
          <div key={g} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, padding: "5px 12px", background: "rgba(127,127,127,.06)", borderRadius: 8, display: "flex", justifyContent: "space-between" }}>
              <span>{g}</span>
              <span style={{ fontSize: 11, fontWeight: 400, color: gCovered >= gTotal ? "var(--green)" : "var(--text-3)" }}>{gCovered}/{gTotal}学分</span>
            </div>
            {courses.map((p) => {
              const bg = p.covered ? "rgba(7,193,96,.06)" : "rgba(238,77,77,.04)";
              return (
                <div key={p.code} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", borderRadius: 10, background: bg, marginBottom: 3, fontSize: 12 }}>
                  <span style={{ fontSize: 12 }}>{p.covered ? "✓" : "✗"}</span>
                  <span style={{ flex: 1, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name} <span style={{ color: "var(--text-3)", fontSize: 10 }}>{p.code}</span></span>
                  <span style={{ fontSize: 10, color: "var(--text-3)", whiteSpace: "nowrap" }}>{p.credits}学分</span>
                  {p.covered
                    ? <span style={{ color: "var(--green)", fontSize: 11, whiteSpace: "nowrap" }}>{p.coveredBy || "已满足"}</span>
                    : <span style={{ color: "var(--red)", fontSize: 11 }}>未满足</span>}
                </div>
              );
            })}
          </div>
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
  const key = r.key;
  const inStage = wb.stageCart.some((s) => s.code === r.c.code && s.seq === r.c.seq);
  const pick = picks[key] ?? { flag: allowedFlags(r.flag)[0]!, zy: 3 };
  const cap = r.vol?.capacity || r.c.capacity || 0;
  const applied = r.vol?.applied ?? 0;
  const prob = itemProb(wb, r.c.code, r.c.seq, pick.flag, pick.zy);
  const confs = findPreviewConflicts({ code: r.c.code, seq: r.c.seq, time: r.time, name: r.name }, wb.previewIndex);
  const state = r.selected ? "selected" : r.isCandidate ? "candidate" : wb.phase && r.q && r.q.qRemaining === 0 && r.q.qQueue === 0 ? "full" : "available";

  return (
    <div className="row" style={{ animationDelay: `${Math.min(i, 20) * 20}ms`, ...(highlight ? { outline: "2px solid var(--accent)" } : {}) }}>
      <div className="row-when">
        <b style={{ color: wb.phase && r.q ? (r.q.qRemaining > 0 ? "var(--green)" : r.q.qQueue > 0 ? "var(--amber)" : "var(--red)") : heat(applied, cap) }}>
          {wb.phase ? (r.q?.qRemaining ?? r.c.remaining) : r.c.remaining}
        </b>
        <span>{wb.phase ? "余量" : "余量"}</span>
      </div>
      <div className="row-main">
        <div className="row-title" style={{ whiteSpace: "normal" }}>
          {r.name}
          {r.teacherId ? <button className="btn" style={{ padding: "0 6px", marginLeft: 6, fontSize: 11 }} onClick={() => openDetail(r.c.code)}>简介</button> : null}
          {tbBadge(r) ? (
            <button className="btn" style={{ padding: "0 6px", marginLeft: 6, fontSize: 11, color: "var(--amber)" }} onClick={() => openReviews({ code: r.c.code, seq: r.c.seq, name: r.name, teacher: r.teacher })}>{tbBadge(r)}</button>
          ) : null}
        </div>
        <div className="row-sub" style={{ whiteSpace: "normal" }}>{[r.c.code, r.c.seq && r.c.seq !== "0" ? `第${r.c.seq}班` : "", r.teacher, `${r.credits} 学分`, r.time, r.c.department].filter(Boolean).join(" · ")}</div>
        {wb.phase && r.q ? (
          <div className="row-sub" style={{ whiteSpace: "normal" }}>{[cap ? `容量 ${cap}` : "", r.q.qQueue ? `排队 ${r.q.qQueue}` : "", r.cand ? `排队第 ${r.cand.myPos}/${r.cand.queueTotal}` : ""].filter(Boolean).join(" · ")}</div>
        ) : r.vol ? (
          <div className="row-sub" style={{ whiteSpace: "normal" }}>
            {[r.vol.volRequired && fmtVol(r.vol.volRequired), r.vol.volElective && fmtVol(r.vol.volElective), r.vol.volOptional && fmtVol(r.vol.volOptional)].filter(Boolean).join(" · ")}
            <span style={{ marginLeft: 8, color: prob.color }}>{prob.prob}</span>
          </div>
        ) : null}
        {confs.length ? <div className="row-sub" style={{ color: "var(--red)", whiteSpace: "normal" }}>冲突: {confs.slice(0, 3).map((c) => `周${dayName(c.day)} ${SLOT_NAMES[c.slot - 1]} ${c.b}`).join(" · ")}</div> : null}
        {state === "selected" ? (
          <div className="row-sub" style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
            {r.zy ? <span style={{ fontSize: 12, color: "var(--text-3)" }}>{FLAG_LABELS[r.flag]} · 第{r.zy}志愿</span> : null}
            <button className="btn" disabled={!(r.zy > 1 && wb.canAdjustZy(r.c.code, r.c.seq, r.zy - 1)) || wb.busy !== null} title={r.zy > 1 && wb.canAdjustZy(r.c.code, r.c.seq, r.zy - 1) ? "" : "该志愿名额已满"} onClick={() => void wb.changeZy(r.c.code, r.c.seq, r.zy - 1)}>▲</button>
            <button className="btn" disabled={!(r.zy < 3 && wb.canAdjustZy(r.c.code, r.c.seq, r.zy + 1)) || wb.busy !== null} title={r.zy < 3 && wb.canAdjustZy(r.c.code, r.c.seq, r.zy + 1) ? "" : "该志愿名额已满"} onClick={() => void wb.changeZy(r.c.code, r.c.seq, r.zy + 1)}>▼</button>
            <button className="btn" disabled={inStage} onClick={() => wb.addToStage(r, r.flag, r.zy || 3)}>{inStage ? "已暂存" : "暂存"}</button>
            <button className="btn" disabled={wb.busy !== null} onClick={() => void wb.drop(r.c.code, r.c.seq, false)}>退选</button>
          </div>
        ) : state === "candidate" ? (
          <div className="row-sub" style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center" }}>
            <span style={{ color: "var(--amber)", fontSize: 12 }}>排队第{r.cand!.myPos}名 / 共{r.cand!.queueTotal}人</span>
            <button className="btn" disabled={wb.busy !== null} onClick={() => void wb.drop(r.c.code, r.c.seq, true)}>删除</button>
          </div>
        ) : (
          <div className="row-sub" style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
            {state === "full" ? <span style={{ color: "var(--red)", fontSize: 12 }}>已满</span> : null}
            <select className="input" style={{ height: 26, fontSize: 12, maxWidth: 76 }} value={pick.flag} disabled={wb.busy !== null} onChange={(e) => setPicks((m) => ({ ...m, [key]: { ...pick, flag: e.target.value as XkFlag } }))}>
              {allowedFlags(pick.flag).map((f) => <option key={f} value={f}>{FLAG_LABELS[f]}</option>)}
            </select>
            <select className="input" style={{ height: 26, fontSize: 12, maxWidth: 76 }} value={String(pick.zy)} disabled={wb.busy !== null} onChange={(e) => setPicks((m) => ({ ...m, [key]: { ...pick, zy: Number(e.target.value) } }))}>
              {[3, 2, 1].map((z) => <option key={z} value={z}>{z}志愿</option>)}
            </select>
            <span style={{ fontSize: 12, color: prob.color, minWidth: 96 }}>{prob.prob}</span>
            <button className="btn" disabled={wb.busy !== null} onClick={() => void wb.submit(r.c.code, r.c.seq, pick.zy, pick.flag)}>
              {wb.busy === `submit-${r.c.code}-${r.c.seq}` ? "提交中…" : state === "full" ? "排队选课" : "选课"}
            </button>
            <button className="btn" disabled={inStage} onClick={() => wb.addToStage(r, pick.flag, pick.zy)}>{inStage ? "已暂存" : "暂存"}</button>
          </div>
        )}
      </div>
      <span className={"chip " + (r.selected ? "chip-green" : r.isCandidate ? "chip-amber" : "")}>
        <span className="dot" />
        {r.selected ? `已选${r.zy ? ` · ${r.zy}志愿` : ""}` : r.isCandidate ? `候补 ${r.cand?.myPos ?? ""}` : state === "full" ? "已满" : r.available ? "可选" : "已满"}
      </span>
    </div>
  );
}

/* ══════════ 右栏⓪：培养方案（render.js renderPlan 同款卡片网格）══════════ */
function PlanSection({ wb }: { wb: ReturnType<typeof useXkWorkbench> }) {
  const coverage = useMemo(() => checkPlanCoverage(wb.plan, wb.courses, wb.stageCart, wb.savedDrafts.map((d) => d.courses)),
    [wb.plan, wb.courses, wb.stageCart, wb.savedDrafts]);
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
    <Sec title="我的培养方案">
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {[...groups.entries()].map(([g, items]) => {
          const cr = items.reduce((a, c) => a + c.credits, 0);
          const cov = items.filter((c) => c.covered).reduce((a, c) => a + c.credits, 0);
          return (
            <div key={g} style={{ padding: "10px 14px", borderRadius: 16, background: "var(--bg-elev, #fff)", boxShadow: "inset 0 0 0 1px rgba(127,127,127,.12), 0 4px 18px rgba(28,39,64,.06)", flex: 1, minWidth: 100, cursor: "pointer" }} onClick={() => { planGroupClick?.(g); }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: cov >= cr ? "var(--green)" : "var(--accent)" }}>{cov}<small style={{ fontSize: 12, fontWeight: 400, color: "var(--text-3)" }}>/{cr}学分</small></div>
              <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{g} ({items.length}门)</div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-3)" }}>共 {coverage.length} 门，{coveredCr}/{totalCr} 学分已覆盖</div>
    </Sec>
  );
}
let planGroupClick: ((g: string) => void) | null = null;

/* ══════════ 右栏①：学分统计 ══════════ */
function StatsSection({ wb }: { wb: ReturnType<typeof useXkWorkbench> }) {
  const byFlag: Record<string, { n: number; cr: number }> = {};
  for (const s of wb.selected) {
    const f = s.typeCode === "006" ? "bx" : s.typeCode === "008" ? "xx" : s.typeCode === "007" ? "rx" : "ty";
    byFlag[f] = { n: (byFlag[f]?.n ?? 0) + 1, cr: (byFlag[f]?.cr ?? 0) + (s.credits || 0) };
  }
  const total = wb.selected.reduce((a, s) => a + (s.credits || 0), 0);
  return (
    <Sec title="我的已选统计">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span className="chip chip-green"><span className="dot" />{wb.selected.length} 门 · {total} 学分</span>
        {(["bx", "xx", "rx", "ty"] as const).map((f) => byFlag[f] ? (
          <span className="chip" key={f}><span className="dot" />{FLAG_LABELS[f]} {byFlag[f]!.n}门/{byFlag[f]!.cr}学分</span>
        ) : null)}
      </div>
    </Sec>
  );
}

/* ══════════ 右栏②：课表预览（render.js renderPreviewTT 逐行移植）══════════ */
function PreviewSection({ wb }: { wb: ReturnType<typeof useXkWorkbench> }) {
  const [mOpen, setMOpen] = useState(false);
  const [mName, setMName] = useState("");
  const [mDay, setMDay] = useState("1");
  const [mSlot, setMSlot] = useState("1");
  const mode = wb.previewMode;

  // getPreviewCourses：selected 模式用 allCourses 里 selected 的合并行（目录时间），而非原始已选行
  const courses = useMemo<Array<{ name: string; teacher?: string; code: string; seq: string; time: string; credits: number; zy: number; manual?: boolean; id?: string; flag?: XkFlag; typeCode?: string; isCandidate?: boolean }>>(() => {
    if (mode === "selected") {
      return wb.courses.filter((r) => r.selected).map((r) => ({
        name: r.name, teacher: r.teacher, code: r.c.code, seq: r.c.seq || "0", time: r.time,
        credits: r.credits, zy: r.zy, typeCode: r.sel?.typeCode, isCandidate: false,
      }));
    }
    if (mode === "stage") return wb.stageCart.map((s) => ({ name: s.name, teacher: s.teacher, code: s.code, seq: s.seq || "0", time: s.time, credits: s.credits, zy: s.zy, flag: s.flag }));
    return (wb.savedDrafts[wb.previewDraftIdx]?.courses ?? []).map((s) => ({ name: s.name, teacher: s.teacher, code: s.code, seq: s.seq || "0", time: s.time, credits: s.credits, zy: s.zy, flag: s.flag }));
  }, [mode, wb]);

  const grid = useMemo(() => {
    const manualEvents = wb.manualEvents;
    const tt: Record<string, Record<string, {
      label?: string; conflict?: boolean; items?: Array<{ label: string; code: string; seq: string; color: string; probLabel: string; probBgColor: string; manual?: boolean; id?: string }>;
      color?: string; probLabel?: string; probBgColor?: string;
    }>> = {};
    const undet: Array<{ lbl: string; code: string; seq: string; credits: number; zy: number; manual: boolean; id?: string }> = [];
    courses.concat(manualEvents.map((e) => ({ name: e.name, code: e.code, seq: e.seq, time: e.time, credits: e.credits, zy: 0, manual: true, id: e.id }))).forEach((c) => {
      const lbl = c.teacher ? `${c.name}(${c.teacher})` : c.name;
      let cellColor = "", probLabel = "", probBgColor = "";
      if (c.manual) {
        cellColor = "#8b5cf6"; probLabel = "自定义"; probBgColor = "rgba(139,92,246,.14)";
      } else if (wb.phase) {
        const qKey = `${c.code}_${c.seq || "0"}`;
        const r = wb.courses.find((x) => x.c.code === c.code && String(x.c.seq || "0") === String(c.seq || "0"));
        const qd = wb.queueMap[qKey] ?? r?.q;
        const cand = wb.candidates.find((cc) => cc.code === c.code && String(cc.seq) === String(c.seq || "0"));
        if (cand) {
          cellColor = "#ff9f1a"; probLabel = `排队第${cand.myPos}/${cand.queueTotal}人`; probBgColor = "rgba(255,159,26,.14)";
        } else if (mode === "selected") {
          probLabel = "已选"; cellColor = "#07c160"; probBgColor = "rgba(7,193,96,.14)";
        } else if (qd) {
          if (qd.qRemaining > 0) { cellColor = "#07c160"; probLabel = `余${qd.qRemaining}`; probBgColor = "rgba(7,193,96,.14)"; }
          else if (qd.qQueue > 0) { cellColor = "#ff9f1a"; probLabel = `排队${qd.qQueue}人`; probBgColor = "rgba(255,159,26,.14)"; }
          else { cellColor = "#ee4d4d"; probLabel = "已满"; probBgColor = "rgba(238,77,77,.14)"; }
        }
      } else if (mode === "selected" && c.zy) {
        const sf = (c.typeCode ? typeCodeToFlag(c.typeCode) : (c.flag ?? "bx")) as XkFlag;
        const vol = r2vol(wb, c.code, c.seq);
        const p = calcProb(vol?.capacity || 0, vol, sf, c.zy);
        if (p.prob >= 0) { cellColor = p.color; probLabel = p.percentLabel || p.label; probBgColor = p.bg; }
      } else if ((mode === "stage" || mode === "draft") && c.flag && c.zy) {
        const vol = r2vol(wb, c.code, c.seq);
        const p = calcProb(vol?.capacity || 0, vol, c.flag, c.zy);
        if (p.prob >= 0) { cellColor = p.color; probLabel = p.percentLabel || p.label; probBgColor = p.bg; }
      }
      const slots = parseTimeSlots(c.time);
      if (!slots.length) undet.push({ lbl, code: c.code, seq: c.seq || "0", credits: c.credits || 0, zy: c.zy || 0, manual: !!c.manual, id: c.id });
      for (const { day, slot } of slots) {
        if (!tt[day]) tt[day] = {};
        const entry = { label: lbl, code: c.code, seq: c.seq || "0", color: cellColor, probLabel, probBgColor, manual: c.manual, id: c.id };
        const existingCell = tt[day]![slot];
        if (existingCell) {
          const existing = existingCell.conflict && existingCell.items ? existingCell.items : existingCell.items ?? [];
          if (existing.some((e) => e.code === entry.code && e.seq === entry.seq)) return;
          const labels = existing.concat([entry]);
          tt[day]![slot] = { label: labels.map((e) => e.label).join(" / "), conflict: true, items: labels };
        } else {
          tt[day]![slot] = { items: [entry] };
        }
      }
    });
    return { tt, undet, manualEvents };
  }, [courses, mode, wb]);

  // handlePreviewRemove（state.js:461 逐行移植）
  const removeItem = async (code: string, seq: string): Promise<void> => {
    if (mode === "selected") {
      const c = wb.courses.find((x) => x.c.code === code && String(x.c.seq || "0") === String(seq));
      const name = c?.name || code;
      if (!globalThis.confirm?.(`确认退选「${name}」？`)) return;
      await wb.drop(code, seq, false);
    } else if (mode === "stage") {
      const s = wb.stageCart.find((x) => x.code === code && String(x.seq) === String(seq));
      if (!globalThis.confirm?.(`从暂存区移除「${s?.name || code}」？`)) return;
      wb.removeFromStage(code, seq);
    } else {
      const d = wb.savedDrafts[wb.previewDraftIdx];
      if (!d) return;
      const s = d.courses.find((x) => x.code === code && String(x.seq) === String(seq));
      if (!globalThis.confirm?.(`从草稿移除「${s?.name || code}」？`)) return;
      wb.removeFromDraft(wb.previewDraftIdx, code, seq);
    }
  };
  const cellItems = (val: NonNullable<ReturnType<typeof getCell>>): Array<{ label: string; code: string; seq: string; color: string; probLabel: string; probBgColor: string; manual?: boolean; id?: string }> =>
    val.items ?? [];
  function getCell(d: number, s: number) { return grid.tt[d]?.[s]; }

  const cr = courses.reduce((a, c) => a + (c.credits || 0), 0);
  const label = mode === "selected" ? "当前已选" : mode === "stage" ? "暂存车预览" : `草稿「${wb.savedDrafts[wb.previewDraftIdx]?.name ?? ""}」预览`;
  return (
    <Sec title="课表预览" extra={<span style={{ fontSize: 11, color: "var(--text-3)" }}>{label}</span>}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        <button className={"btn" + (mode === "selected" ? " is-active" : "")} onClick={() => wb.setPreview("selected")}>当前已选</button>
        <button className={"btn" + (mode === "stage" ? " is-active" : "")} onClick={() => wb.setPreview("stage")}>预览暂存</button>
        {wb.savedDrafts.map((d, i) => (
          <button key={i} className={"btn" + (mode === "draft" && wb.previewDraftIdx === i ? " is-active" : "")} onClick={() => wb.setPreview("draft", i)}>{d.name}</button>
        ))}
      </div>
      {!courses.length && !grid.manualEvents.length ? (
        <div style={{ fontSize: 12, color: "var(--text-3)" }}>暂无课程</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 3, fontSize: 11, tableLayout: "fixed" }}>
            <thead>
              <tr>
                <th style={{ padding: 4, fontSize: 10, fontWeight: 600, color: "var(--text-3)", textAlign: "center" }}></th>
                {["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((d) => (
                  <th key={d} style={{ padding: 4, fontSize: 10, fontWeight: 600, color: "var(--text-3)", textAlign: "center" }}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {["1-2节", "3-4节", "5-6节", "7-8节", "9-10节", "11-12节"].map((sl, si) => (
                <tr key={sl}>
                  <th style={{ padding: 4, fontSize: 10, fontWeight: 600, color: "var(--text-3)", textAlign: "center" }}>{sl}</th>
                  {Array.from({ length: 7 }, (_, di) => {
                    const val = getCell(di + 1, si + 1);
                    if (!val) return <td key={di} style={{ padding: "6px 3px", borderRadius: 8, verticalAlign: "top", background: "var(--bg-elev, #fff)", boxShadow: "inset 0 0 0 1px rgba(127,127,127,.08)" }} />;
                    const isC = !!val.conflict;
                    const items = cellItems(val);
                    const head = items[0];
                    return (
                      <td key={di} style={{ padding: "6px 4px", borderRadius: 8, verticalAlign: "top", background: isC ? "color-mix(in srgb, var(--red) 8%, var(--bg-elev, #fff))" : head && head.color && !head.manual ? `color-mix(in srgb, ${head.color} 10%, var(--bg-elev, #fff))` : "var(--bg-elev, #fff)", boxShadow: `inset 0 0 0 1px ${isC ? "rgba(238,77,77,.3)" : "rgba(127,127,127,.08)"}` }}>
                        <div>
                          {items.map((it, k) => (
                            <div key={k} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, marginBottom: 3, borderRadius: 6, padding: "2px 1px", background: it.manual ? undefined : `color-mix(in srgb, ${it.color} 10%, transparent)`, color: it.color, cursor: it.manual ? undefined : "pointer" }}
                              title={it.manual ? undefined : "在左侧课程列表中查看"}
                              onClick={() => { if (!it.manual) jumpTo(it.code); }}>
                              <span style={{ fontSize: 10, lineHeight: 1.3, wordBreak: "break-all", color: it.manual ? "#7c3aed" : "var(--text)" }}>{it.label}</span>
                              {it.probLabel ? <span style={{ padding: "1px 6px", borderRadius: 999, fontSize: 9, fontWeight: 700, background: it.probBgColor, color: it.color }}>{it.probLabel}</span> : null}
                              <button className="btn" style={{ padding: "0 4px", fontSize: 9, opacity: 0.6 }} title={`移除 ${it.label}`} onClick={(e) => { e.stopPropagation(); if (it.manual && it.id) wb.removeManualEvent(it.id); else void removeItem(it.code, it.seq); }}>✕</button>
                            </div>
                          ))}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {grid.undet.length ? (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>时间未定 / 无固定时段（{grid.undet.length} 门，不含在上方网格中）</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {grid.undet.map((u, i) => (
              <span key={i} className="chip" style={{ fontSize: 11, cursor: "pointer" }} title="点击移除" onClick={() => { if (!u.manual) void removeItem(u.code, u.seq); }}>
                {u.lbl} · {u.credits}学分{u.zy ? ` · 第${u.zy}志愿` : ""} <i>✕</i>
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {grid.manualEvents.length ? (
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>自定义占用</span>
          {grid.manualEvents.map((e) => {
            const slots = parseTimeSlots(e.time || "");
            const when = slots.map((s) => `${s.day} ${s.slot}`).join("、");
            return (
              <button key={e.id} className="chip" style={{ borderRadius: 999, padding: "3px 10px", background: "rgba(139,92,246,.12)", color: "#7c3aed", fontSize: 11, cursor: "pointer", border: "none" }} title="删除此占用" onClick={() => wb.removeManualEvent(e.id)}>
                {e.name}{when ? ` · ${when}` : ""} ✕
              </button>
            );
          })}
        </div>
      ) : null}
      <div style={{ marginTop: 6, fontSize: 11, color: "var(--green)" }}>{courses.length}门课 · {cr}学分{grid.manualEvents.length ? ` · 自定义占用${grid.manualEvents.length}项` : ""}</div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8, flexWrap: "wrap", fontSize: 12 }}>
        <button className="btn" onClick={() => setMOpen((v) => !v)}>＋ 添加占用</button>
      </div>
      {mOpen ? (
        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 600, color: "var(--text-3)" }}>
            活动名称
            <input className="input" style={{ height: 30 }} placeholder="例如：社团例会" value={mName} onChange={(e) => setMName(e.target.value)} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 600, color: "var(--text-3)" }}>
            星期
            <select className="input" style={{ height: 30 }} value={mDay} onChange={(e) => setMDay(e.target.value)}>{[1,2,3,4,5,6,7].map((d) => <option key={d} value={d}>{["周一","周二","周三","周四","周五","周六","周日"][d-1]}</option>)}</select>
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 600, color: "var(--text-3)" }}>
            时间段
            <select className="input" style={{ height: 30 }} value={mSlot} onChange={(e) => setMSlot(e.target.value)}>{["1-2节","3-4节","5-6节","7-8节","9-10节","11-12节"].map((n, i) => <option key={i} value={i + 1}>{n}</option>)}</select>
          </label>
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>自定义占用会保存在本地，并参与课程冲突检测。</div>
          <button className="btn" style={{ borderColor: "var(--accent)", color: "var(--accent)" }} onClick={() => { wb.addManualEvent(mName, Number(mDay), Number(mSlot)); setMName(""); setMOpen(false); }}>添加到课表</button>
        </div>
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
      {wb.stageCart.length === 0 ? <div style={{ fontSize: 12, color: "var(--text-3)" }}>暂无暂存课程</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {wb.stageCart.map((s) => {
            const p = itemProb(wb, s.code, s.seq, s.flag, s.zy);
            return (
              <div key={s.code + s.seq} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "4px 6px", borderRadius: 8, background: "var(--bg-elev, #f7f7f8)" }}>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }} title={s.name} onClick={() => jumpTo(s.code)}>{s.name}<span style={{ color: "var(--text-3)" }}> {s.teacher}</span></span>
                <span style={{ fontSize: 10, color: wb.phase ? "var(--text-3)" : p.color, whiteSpace: "nowrap" }}>{wb.phase ? (wb.courses.find((r) => r.c.code === s.code)?.q?.qRemaining ?? "—") : p.prob}</span>
                <select className="input" style={{ height: 22, fontSize: 10, maxWidth: 60 }} value={s.flag} onChange={(e) => wb.updateStageItem(s.code, s.seq, { flag: e.target.value as XkFlag })}>
                  {allowedFlags(s.flag).map((f) => <option key={f} value={f}>{FLAG_LABELS[f]}</option>)}
                </select>
                <select className="input" style={{ height: 22, fontSize: 10, maxWidth: 52 }} value={s.zy} onChange={(e) => wb.updateStageItem(s.code, s.seq, { zy: Number(e.target.value) })}>
                  {[3, 2, 1].map((z) => <option key={z} value={z}>{z}</option>)}
                </select>
                <button className="btn" style={{ padding: "0 5px", fontSize: 10 }} onClick={() => wb.removeFromStage(s.code, s.seq)}>✕</button>
              </div>
            );
          })}
        </div>
      )}
      {conflicts.length ? <div style={{ color: "var(--red)", fontSize: 11, marginTop: 6 }}>冲突: {conflicts.slice(0, 5).map((c) => `周${dayName(c.day)} ${SLOT_NAMES[c.slot - 1]} ${c.a}/${c.b}`).join(" · ")}</div> : null}
      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        <input className="input" style={{ flex: 1, height: 26, fontSize: 12, minWidth: 110 }} placeholder="草稿名称（如：方案A）" value={draftName} onChange={(e) => setDraftName(e.target.value)} />
        <button className="btn" onClick={() => { if (draftName.trim()) { wb.saveDraft(draftName.trim()); setDraftName(""); } }}>保存草稿</button>
        <button className="btn" onClick={() => { const n = globalThis.prompt?.("草稿名称", "我的课表"); if (n) wb.saveCurrentAsDraft(n); }}>存当前选课</button>
        <button className="btn" onClick={() => wb.setPreview("stage")}>预览暂存</button>
        <button className="btn" onClick={() => setImportOpen((v) => !v)}>导入</button>
      </div>
      {importOpen ? (
        <div style={{ marginTop: 6 }}>
          <textarea className="input" style={{ width: "100%", height: 60, fontSize: 11 }} placeholder="粘贴导出的课表数据…" value={importText} onChange={(e) => setImportText(e.target.value)} />
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <button className="btn" onClick={putImport}>确认导入到暂存区</button>
            <button className="btn" style={{ color: "var(--red)" }} onClick={() => setImportOpen(false)}>取消</button>
          </div>
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 6, flexDirection: "column", marginTop: 8 }}>
        {wb.savedDrafts.map((d, idx) => (
          <div key={idx} style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <b>{d.name}</b>
              <span style={{ color: "var(--text-3)", fontSize: 11 }}>{d.courses.length} 门 · {d.courses.reduce((a, c) => a + (c.credits || 0), 0)} 学分</span>
              <span style={{ flex: 1 }} />
              {confirmIdx === idx ? (
                <>
                  <button className="btn" onClick={() => { setConfirmIdx(-1); void wb.submitDraft(idx); }}>确认提交</button>
                  <button className="btn" onClick={() => setConfirmIdx(-1)}>取消</button>
                </>
              ) : (
                <button className="btn" onClick={() => setConfirmIdx(idx)}>提交</button>
              )}
              <button className="btn" onClick={() => wb.setPreview("draft", idx)}>预览</button>
              <button className="btn" onClick={() => void wb.exportDraft(idx)}>导出</button>
              <button className="btn" onClick={() => wb.deleteDraft(idx)}>删除</button>
            </div>
          </div>
        ))}
        {wb.savedDrafts.length ? <div style={{ fontSize: 10, color: "var(--text-3)" }}>提交将先退选所有已选课程，再逐门选入（每门间隔 2s 防验证码）</div> : null}
      </div>
    </Sec>
  );
}

/* ══════════ 右栏④：我的候补 ══════════ */
function QueueSection({ wb }: { wb: ReturnType<typeof useXkWorkbench> }) {
  if (!wb.candidates.length) return null;
  return (
    <Sec title={`我的候补（${wb.candidates.length}）`}>
      {wb.candidates.map((c, i) => (
        <div key={`${c.code}-${i}`} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
          <span className="chip chip-amber" style={{ fontSize: 10 }}>第{c.myPos || "—"}位/{c.queueTotal}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
          <button className="btn" style={{ padding: "0 5px", fontSize: 10 }} disabled={wb.busy !== null} onClick={() => void wb.drop(c.code, c.seq, true)}>删除</button>
        </div>
      ))}
    </Sec>
  );
}

/* ══════════ 右栏⑤：AI 三件套（配置/搜索推荐/智能排课）══════════ */
function AiSections({ wb }: { wb: ReturnType<typeof useXkWorkbench> }) {
  const [cfg, setCfg] = useState<AiConfig>(() => loadAiConfig());
  const [saved, setSaved] = useState(false);
  const [searchPrompt, setSearchPrompt] = useState("");
  const [searchSt, setSearchSt] = useState("");
  const [searchRes, setSearchRes] = useState<Array<{ code: string; seq?: string; reason?: string }>>([]);
  const [aiSt, setAiSt] = useState("");
  const [aiRes, setAiRes] = useState<Array<{ code: string; seq?: string; flag?: string; zy?: number }>>([]);

  const courseBrief = (r: XkRow): string =>
    `${r.c.code}|${r.c.seq}|${r.name}|${r.teacher}|${r.credits}学分|${FLAG_LABELS[r.flag]}|${r.time}|余${r.c.remaining}${r.vol ? `|报${r.vol.applied}` : ""}${tbBadge(r) ? `|评${tbBadge(r)}` : ""}`;

  const runSearch = async (): Promise<void> => {
    setSearchSt("AI 正在分析…");
    setSearchRes([]);
    try {
      const pool = wb.courses.filter((r) => !r.selected && (r.available || !wb.phase)).slice(0, 400);
      const conflicts = new Set(wb.previewIndex.keys());
      const free = pool.filter((r) => parseTimeSlots(r.time).every((s) => !conflicts.has(`${s.day}-${s.slot}`)));
      const sys = "你是清华选课助手。根据用户偏好，从候选课程里推荐。只输出 JSON 数组 [{\"code\":\"课号\",\"seq\":\"班号\",\"reason\":\"一句话理由\"}]，最多 10 条，不要输出其他文字。";
      const user = `我的偏好：${cfg.pref || "无"}\n本次需求：${searchPrompt || "推荐合适的课"}\n当前已选：${wb.selected.map((s) => s.name).join("、") || "无"}\n候选（课号|班号|课名|教师|学分|类型|时间|余量|评价）：\n${free.slice(0, 300).map(courseBrief).join("\n")}`;
      const raw = await callAi(cfg, sys, user);
      setSearchRes(extractJsonArray<{ code: string; seq?: string; reason?: string }>(raw));
      setSearchSt("");
    } catch (e) {
      setSearchSt(e instanceof Error ? e.message : String(e));
    }
  };
  const runSchedule = async (): Promise<void> => {
    setAiSt("AI 正在排课…");
    setAiRes([]);
    try {
      const must = wb.courses.filter((r) => r.selected || zyTypeOf(r) === "bx" || zyTypeOf(r) === "ty");
      const pool = wb.courses.filter((r) => !r.selected).slice(0, 400);
      const sys = "你是清华智能排课助手。给定必须保留的课程和候选池，生成一学期完整课表（总量 20-30 学分，时间不冲突，符合用户偏好）。只输出 JSON 数组 [{\"code\":\"课号\",\"seq\":\"班号\",\"flag\":\"bx|xx|rx|ty\",\"zy\":1}]，不要输出其他文字。";
      const user = `用户偏好：${cfg.pref || "无"}\n必须包含（已选/必修/体育）：\n${must.slice(0, 80).map(courseBrief).join("\n")}\n候选池：\n${pool.slice(0, 300).map(courseBrief).join("\n")}`;
      const raw = await callAi(cfg, sys, user);
      setAiRes(extractJsonArray<{ code: string; seq?: string; flag?: string; zy?: number }>(raw));
      setAiSt("");
    } catch (e) {
      setAiSt(e instanceof Error ? e.message : String(e));
    }
  };
  const stageFromAi = (code: string, seq?: string, flag?: string, zy?: number): void => {
    const row = wb.courses.find((r) => r.c.code === code && (!seq || r.c.seq === seq));
    if (!row) { wb.setToast(`没找到 ${code}（可能不在当前目录）`); return; }
    wb.addToStage(row, (flag as XkFlag) ?? row.flag, zy ?? 3);
  };

  const inp: React.CSSProperties = { height: 26, fontSize: 12, width: "100%" };
  return (
    <>
      <Sec title="AI 配置">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <input className="input" style={inp} placeholder="API Base URL（如 https://api.deepseek.com/v1）" value={cfg.base} onChange={(e) => setCfg({ ...cfg, base: e.target.value })} />
          <input className="input" style={inp} placeholder="模型名称（如 deepseek-chat、gpt-4o-mini）" value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} />
          <input className="input" style={inp} type="password" placeholder="API Token" value={cfg.token} onChange={(e) => setCfg({ ...cfg, token: e.target.value })} />
          <textarea className="input" style={{ ...inp, height: 48 }} placeholder="我的选课偏好（如：周五下午空出来、优先给分好的老师、学分凑满30）" value={cfg.pref} onChange={(e) => setCfg({ ...cfg, pref: e.target.value })} />
          <button className="btn" onClick={() => { saveAiConfig(cfg); setSaved(true); setTimeout(() => setSaved(false), 1500); }}>{saved ? "已保存 ✓" : "保存配置"}</button>
        </div>
      </Sec>
      <Sec title="AI 课程搜索">
        <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 6 }}>基于当前筛选结果 + 当前预览课表，AI 在不冲突的课程中推荐</div>
        <textarea className="input" style={{ ...inp, height: 52 }} placeholder="描述你想要的课（如：想选一门好拿A的通识课、周四下午有空的任选…）" value={searchPrompt} onChange={(e) => setSearchPrompt(e.target.value)} />
        <button className="btn" style={{ marginTop: 6, borderColor: "var(--accent)", color: "var(--accent)" }} onClick={() => void runSearch()}>AI 搜索推荐</button>
        {searchSt ? <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{searchSt}</div> : null}
        {searchRes.length ? (
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
            {searchRes.map((x, i) => {
              const row = wb.courses.find((r) => r.c.code === x.code && (!x.seq || r.c.seq === x.seq));
              return (
                <div key={i} style={{ fontSize: 11, padding: "4px 6px", borderRadius: 6, background: "var(--bg-elev, #f7f7f8)", display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>{row ? row.name : x.code}<span style={{ color: "var(--text-3)" }}> · {x.reason}</span></span>
                  <button className="btn" style={{ padding: "0 5px", fontSize: 10 }} onClick={() => stageFromAi(x.code, x.seq)}>暂存</button>
                </div>
              );
            })}
          </div>
        ) : null}
      </Sec>
      <Sec title="AI 智能排课">
        <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 6 }}>AI 根据必修/体育课 + 偏好自动生成完整课表方案</div>
        <button className="btn" style={{ borderColor: "var(--accent)", color: "var(--accent)" }} onClick={() => void runSchedule()}>AI 智能排课</button>
        {aiSt ? <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{aiSt}</div> : null}
        {aiRes.length ? (
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 11, color: "var(--text-3)" }}>生成 {aiRes.length} 门 · <button className="btn" style={{ padding: "0 5px", fontSize: 10 }} onClick={() => { for (const x of aiRes) stageFromAi(x.code, x.seq, x.flag, x.zy); }}>全部暂存</button></div>
            {aiRes.map((x, i) => {
              const row = wb.courses.find((r) => r.c.code === x.code && (!x.seq || r.c.seq === x.seq));
              return (
                <div key={i} style={{ fontSize: 11, padding: "4px 6px", borderRadius: 6, background: "var(--bg-elev, #f7f7f8)", display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>{row ? `${row.name}(${row.teacher}) ${row.time}` : `${x.code}${x.flag ? ` ${x.flag}` : ""}`}</span>
                  <button className="btn" style={{ padding: "0 5px", fontSize: 10 }} onClick={() => stageFromAi(x.code, x.seq, x.flag, x.zy)}>暂存</button>
                </div>
              );
            })}
          </div>
        ) : null}
      </Sec>
    </>
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
