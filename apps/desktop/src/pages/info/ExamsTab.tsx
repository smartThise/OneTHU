/**
 * 考试安排页 —— getExams（zhjw 课表 JSONP 中分类 fl="考试" 的条目，
 * 与 thu-info-lib parseJSON 同源数据；RN 端同样以课表分类呈现考试）。
 */
import { useMemo } from "react";
import type { ExamEntry } from "@onethu/core";
import { Card, Empty, ErrorNote, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { useExams } from "../../state/data.js";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function weekdayOf(date: string): string {
  const d = new Date(date.replace(/-/g, "/"));
  return Number.isNaN(d.getTime()) ? "" : `周${WEEKDAYS[d.getDay()]}`;
}

function countdown(date: string, startTime?: string): { text: string; cls: string } {
  const base = startTime ? `${date}T${startTime}` : date.replace(/-/g, "/");
  const t = new Date(base).getTime();
  if (Number.isNaN(t)) return { text: "时间待定", cls: "chip-gray" };
  const days = Math.ceil((t - Date.now()) / 86400000);
  if (days < 0) return { text: "已结束", cls: "chip-gray" };
  if (days === 0) return { text: "今天", cls: "chip-red" };
  if (days <= 3) return { text: `${days} 天后`, cls: "chip-amber" };
  if (days <= 14) return { text: `${days} 天后`, cls: "chip-blue" };
  return { text: `${days} 天后`, cls: "chip-gray" };
}

/** "2025-06-20" → "6月20日 周五" */
function dateTitle(date: string): string {
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  return `${month}月${day}日 ${weekdayOf(date)}`;
}

export function ExamsTab() {
  const { data, state, error, reload } = useExams();

  const groups = useMemo(() => {
    if (!data) return [];
    const byDate = new Map<string, ExamEntry[]>();
    for (const exam of data) {
      const list = byDate.get(exam.date);
      if (list) list.push(exam);
      else byDate.set(exam.date, [exam]);
    }
    return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  const upcoming = useMemo(
    () => (data ?? []).filter((e) => countdown(e.date, e.startTime).cls !== "chip-gray").length,
    [data],
  );

  return (
    <>
      <SectionHead
        title="考试安排"
        aside={state === "ready" && data ? `${data.length} 场 · ${upcoming} 场待考 · 本学年` : "本学年"}
      />
      {state === "error" ? <ErrorNote text={error ?? ""} onRetry={() => void reload()} /> : null}
      {state === "loading" && !data ? (
        <SkeletonRows rows={4} />
      ) : (data?.length ?? 0) === 0 ? (
        <Card>
          <Empty text="本学年暂无考试安排。" />
        </Card>
      ) : (
        groups.map(([date, exams]) => (
          <div key={date} style={{ marginBottom: 18 }}>
            <SectionHead title={dateTitle(date)} aside={`${exams.length} 场`} />
            <Card className="list">
              {exams.map((e, i) => {
                const chip = countdown(e.date, e.startTime);
                return (
                  <div
                    className="row"
                    key={`${e.courseName}-${i}`}
                    style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}
                  >
                    <div className="row-when">
                      <b>{e.startTime ?? "--:--"}</b>
                      <span>至 {e.endTime ?? "--:--"}</span>
                    </div>
                    <div className="row-main">
                      <div className="row-title">{e.courseName}</div>
                      <div className="row-sub">{e.location || "地点待定"}</div>
                    </div>
                    <span className={`chip ${chip.cls}`}>
                      <span className="dot" />
                      {chip.text}
                    </span>
                  </div>
                );
              })}
            </Card>
          </div>
        ))
      )}
    </>
  );
}
