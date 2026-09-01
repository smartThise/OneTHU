/** 全部作业（learnX Assignments）：按状态分组（未交/已交/已批改），组内按截止时间排序 */
import { useMemo, useState } from "react";
import { SegmentedOverflow, Card, Empty, ErrorNote, PageHead, SkeletonRows } from "../../components/Layout.js";
import { IconRefresh } from "../../components/Icons.js";
import { useLearnData } from "../../state/data.js";
import { BackButton, HomeworkRow, semesterText } from "./shared.js";

type Filter = "unfinished" | "submitted" | "graded" | "all";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "unfinished", label: "未提交" },
  { key: "submitted", label: "已提交" },
  { key: "graded", label: "已批改" },
  { key: "all", label: "全部" },
];

export function AssignmentsPage() {
  const { data, state, error, reload } = useLearnData();
  const [filter, setFilter] = useState<Filter>("unfinished");

  const byCourse = useMemo(
    () => new Map((data?.courses ?? []).map((c) => [c.id, c.name])),
    [data],
  );

  const groups = useMemo(() => {
    const hw = [...(data?.homework ?? [])].sort((a, b) => a.deadline.localeCompare(b.deadline));
    return {
      unfinished: hw.filter((h) => !h.submitted),
      submitted: hw.filter((h) => h.submitted && !h.graded),
      graded: hw.filter((h) => h.graded),
      all: hw,
    };
  }, [data]);

  const list = groups[filter];

  return (
    <>
      <PageHead
        title="全部作业"
        meta={data ? `${semesterText(data.semester.id)} · 未交 ${groups.unfinished.length} · 已交 ${groups.submitted.length} · 已批 ${groups.graded.length}` : "按截止时间排序"}
        actions={
          <>
            <BackButton to="learn" label="课程列表" />
            <button className="btn" onClick={() => void reload()} disabled={state === "loading"}>
              <IconRefresh width={14} height={14} />
              刷新
            </button>
          </>
        }
      />

      {state === "error" ? <ErrorNote text={error ?? ""} onRetry={() => void reload()} /> : null}

      <SegmentedOverflow>
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            role="tab"
            aria-selected={filter === key}
            className={filter === key ? "is-active" : ""}
            onClick={() => setFilter(key)}
          >
            {label}
            <span className="tab-count">{groups[key].length}</span>
          </button>
        ))}
      </SegmentedOverflow>

      {state === "loading" && !data ? (
        <SkeletonRows rows={6} />
      ) : state === "error" && !data ? null : list.length === 0 ? (
        <Card><Empty text={filter === "unfinished" ? "没有未提交的作业。" : "该分组暂无作业。"} /></Card>
      ) : (
        <Card className="list">
          {list.map((h, i) => (
            <HomeworkRow key={`${h.courseId}-${h.id}`} h={h} courseName={byCourse.get(h.courseId)} from="learn-assignments" style={{ animationDelay: `${i * 25}ms` }} />
          ))}
        </Card>
      )}
    </>
  );
}
