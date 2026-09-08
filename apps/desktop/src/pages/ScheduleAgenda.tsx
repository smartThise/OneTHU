/**
 * 日程 · 列表视图 —— 月历 + 所选日的当日清单。
 * 纯展示组件：同步/课表上云/添加/编辑入口在页面层（两种视图共用），
 * 本组件只负责月历点标与当日条目渲染，点击条目回调 onEdit。
 */
import { useEffect, useMemo, useState } from "react";
import { caldav } from "@onethu/core";
import type { ScheduleEntry } from "@onethu/core";
import { Card, Empty } from "../components/Layout.js";
import { useCloudCal } from "../state/cloudCal.js";
import { useApp } from "../state/context.js";
import { info } from "../lib/clients.js";

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
export type AgendaKind = "course" | "exam" | "cloud" | "local";
export interface AgendaItem {
  kind: AgendaKind;
  startMs: number;
  endMs: number;
  title: string;
  location?: string;
  note?: string;
  uid?: string; // cloud/local 可编辑
  allDay?: boolean;
}
const KIND_LABEL: Record<AgendaKind, string> = { course: "课程", exam: "考试", cloud: "云", local: "本" };
const KIND_COLOR: Record<AgendaKind, string> = { course: "#6d7ff0", exam: "#e5484d", cloud: "#1fa487", local: "#8a8f98" };

function fmtRange(a: number, b: number, allDay?: boolean): string {
  if (allDay) return "全天";
  const md = (ms: number): string => {
    const w = wall(ms);
    return `${w.mo}/${w.d}`;
  };
  const sameDay = ymd(new Date(a)) === ymd(new Date(b - 1));
  return sameDay ? `${hmOf(a)} – ${hmOf(b)}` : `${md(a)} ${hmOf(a)} – ${md(b)} ${hmOf(b)}`;
}

export function ScheduleAgenda({
  courses,
  monthAnchor,
  onMonthAnchor,
  selected,
  onSelect,
  onEdit,
}: {
  /** campus 缓存课程（今天±3 周，作为月窗口取数未就绪时的兜底） */
  courses: ScheduleEntry[];
  /** 月历锚点（页面级状态：学期切换时页面可联动跳月） */
  monthAnchor: Date;
  onMonthAnchor: (d: Date) => void;
  /** 所选日 YYYY-MM-DD */
  selected: string;
  onSelect: (day: string) => void;
  /** 点击可编辑条目（云/本） */
  onEdit: (it: AgendaItem) => void;
}) {
  const cal = useCloudCal();
  const { status } = useApp();
  const [monthSchedule, setMonthSchedule] = useState<ScheduleEntry[] | null>(null);
  const todayStr = ymd(new Date());

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
    const mark = (day: string, k: AgendaKind) => {
      const m = marks.get(day) ?? { course: false, exam: false, cloud: false, local: false };
      m[k] = true;
      marks.set(day, m);
    };
    for (const e of effectiveCourses) if (e.date && from <= parseYmd(e.date).getTime() && parseYmd(e.date).getTime() <= to) mark(e.date, e.category?.includes("考试") ? "exam" : "course");
    for (const o of cloudOcc) mark(ymd(new Date(o.start)), "cloud");
    for (const o of localOcc) mark(ymd(new Date(o.start)), "local");
    return marks;
  }, [monthAnchor, effectiveCourses, cal.cloudEvents, cal.localEvents]);

  /* ---------- 所选日清单 ---------- */
  const dayItems = useMemo<AgendaItem[]>(() => {
    const from = dayStart(parseYmd(selected));
    const to = from + DAY_MS - 1;
    const items: AgendaItem[] = [];
    for (const e of effectiveCourses) {
      if (!e.date || e.date !== selected) continue;
      const s = e.startTime ? new Date(`${e.date.replace(/-/g, "/")} ${e.startTime}`).getTime() : from;
      const en = e.endTime ? new Date(`${e.date.replace(/-/g, "/")} ${e.endTime}`).getTime() : from + 3_600_000;
      items.push({
        kind: e.category?.includes("考试") ? "exam" : "course",
        startMs: Number.isNaN(s) ? from : s,
        endMs: Number.isNaN(en) ? from + 3_600_000 : en,
        title: e.courseName,
        location: e.location,
        note: e.teacher ? `教师：${e.teacher}` : e.weekText,
      });
    }
    for (const [evts, kind] of [[cal.cloudEvents, "cloud"], [cal.localEvents, "local"]] as const) {
      for (const o of caldav.expandEventSet(evts, from, to)) {
        items.push({
          kind, startMs: o.start, endMs: o.end, title: o.summary,
          location: o.location, note: o.description, uid: o.uid, allDay: o.allDay,
        });
      }
    }
    return items.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  }, [selected, effectiveCourses, cal.cloudEvents, cal.localEvents]);

  /* ---------- 月历渲染数据 ---------- */
  const gridDays = useMemo(() => {
    const first = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7; // 周一为始
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const cells: Array<{ day: string; num: number } | null> = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: ymd(new Date(first.getFullYear(), first.getMonth(), d)), num: d });
    }
    return cells;
  }, [monthAnchor]);

  const selD = parseYmd(selected);

  return (
    <>
      {/* 月历 */}
      <Card style={{ padding: 12, marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 8, gap: 8 }}>
          <button className="btn" onClick={() => onMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() - 1, 1))}>‹</button>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{monthAnchor.getFullYear()} 年 {MONTHS[monthAnchor.getMonth()]}</span>
          <button className="btn" onClick={() => onMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 1))}>›</button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => { const n = new Date(); onMonthAnchor(new Date(n.getFullYear(), n.getMonth(), 1)); onSelect(ymd(n)); }}>今天</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, textAlign: "center" }}>
          {WEEK_SHORT.map((w) => (
            <div key={w} style={{ fontSize: 11, color: "var(--text-3, #999)", padding: "2px 0" }}>{w}</div>
          ))}
          {gridDays.map((c, i) =>
            c ? (
              <button
                key={c.day}
                onClick={() => onSelect(c.day)}
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

      {/* 所选日清单 */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: selected === todayStr ? "var(--accent, #6d7ff0)" : undefined }}>
          {selD.getMonth() + 1}月{selD.getDate()}日
        </span>
        <span style={{ fontSize: 12, color: "var(--text-3, #999)" }}>
          {selected === todayStr ? "今天 · " : ""}周{WEEK_SHORT[(selD.getDay() + 6) % 7]} · {dayItems.length} 项
        </span>
      </div>
      {dayItems.length === 0 ? (
        <Card><Empty text="这一天没有日程。点右上「添加日程」新建。" /></Card>
      ) : (
        <Card style={{ padding: 4 }}>
          {dayItems.map((it, i) => (
            <button
              key={`${it.kind}-${it.uid ?? it.title}-${i}`}
              onClick={() => onEdit(it)}
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
    </>
  );
}
