/**
 * 日程视图（Schedule 页第二模式）—— 月历 + 当日时间线。
 * 四路数据源合并：INFO 课表/考试（只读）· CalDAV 云端（双向）· 本地手动（可上云）。
 * 与课表网格共用页面（Schedule.tsx 顶部模式切换）。
 */
import { useEffect, useMemo, useState } from "react";
import { caldav } from "@onethu/core";
import { Card, Empty, ErrorNote } from "../components/Layout.js";
import { IconRefresh } from "../components/Icons.js";
import {
  useCloudCal, syncCloudCal, putCloudEvent, deleteCloudEvent, putLocalEvent, deleteLocalEvent, exportSemesterToCloud,
} from "../state/cloudCal.js";
import { info } from "../lib/clients.js";
import { confirmOk } from "../lib/confirm.js";
import { useApp } from "../state/context.js";
import type { ScheduleEntry } from "@onethu/core";

const TZ = "Asia/Shanghai";
const DAY_MS = 86_400_000;

/* ---------- 日期工具（本地时区，repo 无 dayjs 约定） ---------- */
const pad = (n: number): string => String(n).padStart(2, "0");
const ymd = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s: string): Date => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const dayStart = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const wall = (ms: number) => caldav.epochToWall(TZ, ms);
const hmOf = (ms: number): string => `${pad(wall(ms).h)}:${pad(wall(ms).mi)}`;
const MONTHS = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
const WEEK_SHORT = ["一", "二", "三", "四", "五", "六", "日"];

/* ---------- 展示条目 ---------- */
type Kind = "course" | "exam" | "cloud" | "local";
interface AgendaItem {
  kind: Kind;
  startMs: number;
  endMs: number;
  title: string;
  location?: string;
  note?: string;
  uid?: string; // cloud/local 可编辑
  allDay?: boolean;
}
const KIND_LABEL: Record<Kind, string> = { course: "课程", exam: "考试", cloud: "云", local: "本" };
const KIND_COLOR: Record<Kind, string> = { course: "#6d7ff0", exam: "#e5484d", cloud: "#1fa487", local: "#8a8f98" };

function fmtRange(a: number, b: number, allDay?: boolean): string {
  if (allDay) return "全天";
  const md = (ms: number): string => {
    const w = wall(ms);
    return `${w.mo}/${w.d}`;
  };
  const sameDay = ymd(new Date(a)) === ymd(new Date(b - 1));
  return sameDay ? `${hmOf(a)} – ${hmOf(b)}` : `${md(a)} ${hmOf(a)} – ${md(b)} ${hmOf(b)}`;
}

/* ---------- 编辑器 ---------- */
interface Draft {
  uid?: string;
  title: string;
  date: string; // YYYY-MM-DD
  start: string; // HH:MM
  end: string; // HH:MM
  allDay: boolean;
  location: string;
  note: string;
  toCloud: boolean;
  originalCloud: boolean; // 编辑的是云端事件
}
const emptyDraft = (date: string, canCloud: boolean): Draft => ({
  title: "", date, start: "08:00", end: "09:35", allDay: false, location: "", note: "",
  toCloud: canCloud, originalCloud: false,
});

export function ScheduleAgenda({
  courses,
  semester,
}: {
  courses: ScheduleEntry[];
  /** 当前学期校历（课表上云用）；无校历数据时隐藏上云入口 */
  semester: { firstDay: string; weekCount: number } | null;
}) {
  const cal = useCloudCal();
  const { status } = useApp();
  const [monthAnchor, setMonthAnchor] = useState<Date>(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  /** 月历窗口课程（campus 数据只有今天±3 周，翻月自取整月窗口） */
  const [monthSchedule, setMonthSchedule] = useState<ScheduleEntry[] | null>(null);
  const [selected, setSelected] = useState<string>(ymd(new Date()));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [exporting, setExporting] = useState<{ phase: string; done: number; total: number } | null>(null);

  // 翻月拉取该月课程/考试（失败静默：云日程仍显示，课程点标退化为 campus 窗口）
  useEffect(() => {
    if (status === "demo") {
      setMonthSchedule(null);
      return;
    }
    let alive = true;
    const first = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const f2 = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    setMonthSchedule(null);
    info
      .getSchedule(f2(first), f2(last))
      .then((rows) => {
        if (alive) setMonthSchedule(rows);
      })
      .catch(() => {
        if (alive) setMonthSchedule([]);
      });
    return () => {
      alive = false;
    };
  }, [monthAnchor, status]);

  const todayStr = ymd(new Date());
  /** 展示用课程：月窗口数据优先（整月覆盖），未就绪退 campus（±3 周窗口） */
  const effectiveCourses = monthSchedule ?? courses;

  /* ---------- 月历格：每天的来源点标 ---------- */
  const monthMarks = useMemo(() => {
    const first = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1);
    const from = dayStart(first);
    const to = dayStart(new Date(first.getFullYear(), first.getMonth() + 1, 1)) - 1;
    const cloudOcc = caldav.expandEventSet(cal.cloudEvents, from, to);
    const localOcc = caldav.expandEventSet(cal.localEvents, from, to);
    const marks = new Map<string, { course: boolean; exam: boolean; cloud: boolean; local: boolean }>();
    const mark = (day: string, k: "course" | "exam" | "cloud" | "local") => {
      const m = marks.get(day) ?? { course: false, exam: false, cloud: false, local: false };
      m[k] = true;
      marks.set(day, m);
    };
    for (const e of effectiveCourses) if (e.date && from <= parseYmd(e.date).getTime() && parseYmd(e.date).getTime() <= to) mark(e.date, e.category?.includes("考试") ? "exam" : "course");
    for (const o of cloudOcc) mark(ymd(new Date(o.start)), "cloud");
    for (const o of localOcc) mark(ymd(new Date(o.start)), "local");
    return marks;
  }, [monthAnchor, effectiveCourses, cal.cloudEvents, cal.localEvents]);

  /* ---------- 列表模式：整月按天分组的事件流 ---------- */
  const monthFlow = useMemo<Array<{ day: string; num: number; weekday: number; isToday: boolean; items: AgendaItem[] }>>(() => {
    const first = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1);
    const from = dayStart(first);
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    /** 单日条目：课程/考试（读源）+ 云/本（展开） */
    const itemsOfDay = (day: string): AgendaItem[] => {
      const d = parseYmd(day);
      const dFrom = dayStart(d);
      const dTo = dFrom + DAY_MS - 1;
      const items: AgendaItem[] = [];
      for (const e of effectiveCourses) {
        if (!e.date || e.date !== day) continue;
        const s = e.startTime ? new Date(`${e.date.replace(/-/g, "/")} ${e.startTime}`).getTime() : dFrom;
        const en = e.endTime ? new Date(`${e.date.replace(/-/g, "/")} ${e.endTime}`).getTime() : dFrom + 3_600_000;
        items.push({
          kind: e.category?.includes("考试") ? "exam" : "course",
          startMs: Number.isNaN(s) ? dFrom : s,
          endMs: Number.isNaN(en) ? dFrom + 3_600_000 : en,
          title: e.courseName,
          location: e.location,
          note: e.teacher ? `教师：${e.teacher}` : e.weekText,
        });
      }
      for (const [evts, kind] of [[cal.cloudEvents, "cloud"], [cal.localEvents, "local"]] as const) {
        for (const o of caldav.expandEventSet(evts, dFrom, dTo)) {
          items.push({
            kind, startMs: o.start, endMs: o.end, title: o.summary,
            location: o.location, note: o.description, uid: o.uid, allDay: o.allDay,
          });
        }
      }
      return items.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    };
    const sections: Array<{ day: string; num: number; weekday: number; isToday: boolean; items: AgendaItem[] }> = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const day = ymd(new Date(first.getFullYear(), first.getMonth(), d));
      const items = itemsOfDay(day);
      const isToday = day === todayStr;
      if (items.length === 0 && !isToday) continue; // 无事之日不占位（今天除外：留"无日程"锚点）
      sections.push({ day, num: d, weekday: (parseYmd(day).getDay() + 6) % 7, isToday, items });
    }
    return sections;
  }, [monthAnchor, effectiveCourses, cal.cloudEvents, cal.localEvents, todayStr]);

  /** 月历点击 → 选中并滚动到该日分组 */
  const scrollToDay = (day: string): void => {
    requestAnimationFrame(() => {
      document.querySelector(`[data-day="${day}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  /* ---------- 月历渲染数据 ---------- */
  const gridDays = useMemo(() => {
    const first = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7; // 周一为始
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const cells: Array<{ day: string; num: number; inMonth: boolean } | null> = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: ymd(new Date(first.getFullYear(), first.getMonth(), d)), num: d, inMonth: true });
    }
    return cells;
  }, [monthAnchor]);

  const canCloud = cal.configured;

  /* ---------- 动作 ---------- */
  const onSync = async (): Promise<void> => {
    setMsg(null);
    try {
      const r = await syncCloudCal();
      setMsg(`已同步：云端共 ${r.total} 个日程（新增 ${r.added}、更新 ${r.updated}、移除 ${r.removed}）。`);
    } catch (err) {
      setMsg(`同步失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const openEdit = (it: AgendaItem): void => {
    if (!it.uid) return;
    const src = it.kind === "cloud" ? cal.cloudEvents.find((e) => e.uid === it.uid) : cal.localEvents.find((e) => e.uid === it.uid);
    if (!src) return;
    const w = wall(src.start);
    const we = wall(src.end);
    setDraft({
      uid: src.uid, title: src.summary, date: ymd(new Date(src.start)),
      start: `${pad(w.h)}:${pad(w.mi)}`, end: `${pad(we.h)}:${pad(we.mi)}`,
      allDay: !!src.allDay, location: src.location ?? "", note: src.description ?? "",
      toCloud: it.kind === "cloud", originalCloud: it.kind === "cloud",
    });
  };

  const onSave = async (): Promise<void> => {
    if (!draft || !draft.title.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const d = parseYmd(draft.date);
      const [sh, sm] = draft.start.split(":").map(Number);
      const [eh, em] = draft.end.split(":").map(Number);
      const allDay = draft.allDay;
      const start = allDay ? dayStart(d) : new Date(d.getFullYear(), d.getMonth(), d.getDate(), sh ?? 0, sm ?? 0).getTime();
      let end = allDay ? dayStart(d) + DAY_MS : new Date(d.getFullYear(), d.getMonth(), d.getDate(), eh ?? 23, em ?? 59).getTime();
      if (!allDay && end <= start) end = start + 45 * 60_000;
      const uid = draft.uid ?? `onethu-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@onethu`;
      const ev: caldav.IcsEvent = {
        uid, summary: draft.title.trim(), start, end, allDay,
        location: draft.location.trim() || undefined,
        description: draft.note.trim() || undefined,
        onethuSource: "manual",
      };
      // 跨集合移动（云↔本地）：先删原侧再写新侧
      if (draft.uid && draft.originalCloud && !draft.toCloud) await deleteCloudEvent(draft.uid);
      if (draft.uid && !draft.originalCloud && draft.toCloud) await deleteLocalEvent(draft.uid);
      if (draft.toCloud) await putCloudEvent(ev);
      else await putLocalEvent(ev);
      setDraft(null);
      setMsg("已保存。");
    } catch (err) {
      setMsg(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (): Promise<void> => {
    if (!draft?.uid || busy) return;
    setBusy(true);
    try {
      if (draft.originalCloud) await deleteCloudEvent(draft.uid);
      else await deleteLocalEvent(draft.uid);
      setDraft(null);
      setMsg("已删除。");
    } catch (err) {
      setMsg(`删除失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const lastSyncText = cal.lastSyncAt ? `上次同步 ${new Date(cal.lastSyncAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : "未同步过";

  const onExport = async (): Promise<void> => {
    if (!semester || exporting) return;
    const yes = await confirmOk(
      `把本学期课表与考试写入云日历？\n\n· 写入 ${semester.weekCount} 周的全部课程（按日期逐场展开）\n· 之前由 OneTHU 写入的课表会被清理后重写（幂等）\n· 写入后系统日历 / 其他设备（添加同一邮箱账号）即可见\n· 手动添加的日程不受影响`,
    );
    if (!yes) return;
    setExporting({ phase: "准备", done: 0, total: 0 });
    setMsg(null);
    try {
      const r = await exportSemesterToCloud(
        semester,
        (st, en) => info.getSchedule(st, en),
        (done, total, phase) => setExporting({ phase, done, total }),
      );
      setMsg(`课表上云完成：写入 ${r.written} 场（清理旧 ${r.removed} 场${r.skipped ? `，跳过 ${r.skipped} 场` : ""}）。`);
    } catch (err) {
      setMsg(`课表上云失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(null);
    }
  };

  return (
    <>
      {/* 同步状态条 */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <button className="btn" onClick={() => void onSync()} disabled={!canCloud || cal.syncing}>
          <IconRefresh width={14} height={14} />
          {cal.syncing ? "同步中…" : "同步云日历"}
        </button>
        <span className="page-indicator">
          {canCloud ? `${cal.email} · ${lastSyncText}` : "云同步未配置（设置页开启）"}
        </span>
        <span style={{ flex: 1 }} />
        {canCloud && semester ? (
          <button className="btn" onClick={() => void onExport()} disabled={!!exporting}>
            {exporting ? `${exporting.phase} ${exporting.done}/${exporting.total}` : "课表上云"}
          </button>
        ) : null}
        <button className="btn btn-primary" onClick={() => setDraft(emptyDraft(selected, canCloud))}>
          ＋ 添加日程
        </button>
      </div>
      {msg ? (
        <div style={{ fontSize: 12.5, color: "var(--text-2)", marginBottom: 8, whiteSpace: "pre-wrap" }}>{msg}</div>
      ) : null}

      {/* 月历 */}
      <Card style={{ padding: 12, marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 8, gap: 8 }}>
          <button className="btn" onClick={() => setMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() - 1, 1))}>‹</button>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{monthAnchor.getFullYear()} 年 {MONTHS[monthAnchor.getMonth()]}</span>
          <button className="btn" onClick={() => setMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 1))}>›</button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => { const n = new Date(); setMonthAnchor(new Date(n.getFullYear(), n.getMonth(), 1)); setSelected(ymd(n)); scrollToDay(ymd(n)); }}>今天</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, textAlign: "center" }}>
          {WEEK_SHORT.map((w) => (
            <div key={w} style={{ fontSize: 11, color: "var(--text-3, #999)", padding: "2px 0" }}>{w}</div>
          ))}
          {gridDays.map((c, i) =>
            c ? (
              <button
                key={c.day}
                onClick={() => { setSelected(c.day); scrollToDay(c.day); }}
                style={{
                  position: "relative", border: "none", background: c.day === selected ? "var(--accent, #6d7ff0)" : c.day === todayStr ? "rgba(109,127,240,0.10)" : "transparent",
                  color: c.day === selected ? "#fff" : "inherit", borderRadius: 7, padding: "5px 0 7px", cursor: "pointer",
                }}
              >
                <span style={{ fontSize: 12.5, fontWeight: c.day === todayStr || c.day === selected ? 700 : 400 }}>{c.num}</span>
                <span style={{ display: "flex", justifyContent: "center", gap: 2, height: 4, marginTop: 2 }}>
                  {(["course", "exam", "cloud", "local"] as const)
                    .filter((k) => monthMarks.get(c.day)?.[k])
                    .map((k) => (
                      <i key={k} style={{ width: 4, height: 4, borderRadius: 2, background: c.day === selected ? "#fff" : KIND_COLOR[k], display: "inline-block" }} />
                    ))}
                </span>
              </button>
            ) : (
              <div key={`pad-${i}`} />
            ),
          )}
        </div>
      </Card>

      {/* 按天分组的日程流 */}
      {monthFlow.length === 0 ? (
        <Card><Empty text="本月没有日程。点击右上「添加日程」新建。" /></Card>
      ) : (
        monthFlow.map((sec) => (
        <div key={sec.day} data-day={sec.day} style={{ marginBottom: 10, scrollMarginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6, padding: "0 2px" }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: sec.isToday ? "var(--accent, #6d7ff0)" : undefined }}>
              {parseYmd(sec.day).getMonth() + 1}月{sec.num}日
            </span>
            <span style={{ fontSize: 12, color: "var(--text-3, #999)" }}>
              {sec.isToday ? "今天 · " : ""}周{WEEK_SHORT[sec.weekday]} · {sec.items.length} 项
            </span>
          </div>
          {sec.items.length === 0 ? (
            <Card style={{ padding: "10px 12px" }}>
              <span style={{ fontSize: 12.5, color: "var(--text-3, #999)" }}>无日程</span>
            </Card>
          ) : (
          <Card style={{ padding: 4 }}>
            {sec.items.map((it, i) => (
            <button
              key={`${it.kind}-${it.uid ?? it.title}-${i}`}
              onClick={() => openEdit(it)}
              disabled={!it.uid}
              style={{
                display: "flex", width: "100%", gap: 10, alignItems: "stretch", textAlign: "left",
                background: "transparent", border: "none", padding: "8px 10px", borderRadius: 8, cursor: it.uid ? "pointer" : "default",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", fontSize: 12, color: "var(--text-2)", fontVariantNumeric: "tabular-nums", minWidth: 96, justifyContent: "flex-start" }}>
                {fmtRange(it.startMs, it.endMs, it.allDay)}
              </div>
              <div style={{ width: 3, borderRadius: 2, background: KIND_COLOR[it.kind], flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{it.title}</span>
                  <span style={{ fontSize: 10, color: "#fff", background: KIND_COLOR[it.kind], borderRadius: 4, padding: "1px 5px", flexShrink: 0 }}>{KIND_LABEL[it.kind]}</span>
                </div>
                {it.location ? <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 1 }}>📍 {it.location}</div> : null}
                {it.note ? <div style={{ fontSize: 11.5, color: "var(--text-3, #999)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.note}</div> : null}
              </div>
            </button>
            ))}
          </Card>
          )}
        </div>
        ))
      )}

      {/* 编辑器 */}
      {draft ? (
        <Card style={{ padding: 14, marginTop: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>{draft.uid ? "编辑日程" : "新建日程"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label style={{ gridColumn: "1 / -1", fontSize: 12, color: "var(--text-2)" }}>
              标题
              <input className="input" style={{ marginTop: 4, width: "100%" }} value={draft.title} placeholder="要做什么…" onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
            <label style={{ fontSize: 12, color: "var(--text-2)" }}>
              日期
              <input className="input" type="date" style={{ marginTop: 4, width: "100%" }} value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
            </label>
            <label style={{ fontSize: 12, color: "var(--text-2)", display: "flex", alignItems: "flex-end", gap: 6, paddingBottom: 6 }}>
              <input type="checkbox" checked={draft.allDay} onChange={(e) => setDraft({ ...draft, allDay: e.target.checked })} />
              全天
            </label>
            {!draft.allDay ? (
              <>
                <label style={{ fontSize: 12, color: "var(--text-2)" }}>
                  开始
                  <input className="input" type="time" style={{ marginTop: 4, width: "100%" }} value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
                </label>
                <label style={{ fontSize: 12, color: "var(--text-2)" }}>
                  结束
                  <input className="input" type="time" style={{ marginTop: 4, width: "100%" }} value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
                </label>
              </>
            ) : null}
            <label style={{ gridColumn: "1 / -1", fontSize: 12, color: "var(--text-2)" }}>
              地点
              <input className="input" style={{ marginTop: 4, width: "100%" }} value={draft.location} placeholder="可选" onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
            </label>
            <label style={{ gridColumn: "1 / -1", fontSize: 12, color: "var(--text-2)" }}>
              备注
              <input className="input" style={{ marginTop: 4, width: "100%" }} value={draft.note} placeholder="可选" onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
            </label>
          </div>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--text-2)", margin: "10px 0 2px" }}>
            <input type="checkbox" checked={draft.toCloud} disabled={!canCloud} onChange={(e) => setDraft({ ...draft, toCloud: e.target.checked })} />
            同步到云日历{canCloud ? "（其他设备 / 系统日历可见）" : "（未配置——设置页开启云同步）"}
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="btn btn-primary" disabled={!draft.title.trim() || busy} onClick={() => void onSave()}>
              {busy ? "保存中…" : "保存"}
            </button>
            <button className="btn" onClick={() => setDraft(null)}>取消</button>
            <span style={{ flex: 1 }} />
            {draft.uid ? (
              <button className="btn" style={{ color: "#e5484d" }} disabled={busy} onClick={() => void onDelete()}>
                删除
              </button>
            ) : null}
          </div>
        </Card>
      ) : null}
    </>
  );
}
