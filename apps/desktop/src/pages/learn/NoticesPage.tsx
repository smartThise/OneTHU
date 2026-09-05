/** 全部课程通知（learnX Notices）：按发布时间倒序，可筛重要/未读 */
import { useMemo, useState } from "react";
import { PageAtomStar } from "../..//components/Collect.js";
import { SegmentedOverflow, Card, Empty, ErrorNote, PageHead, SkeletonRows } from "../../components/Layout.js";
import { useApp } from "../../state/context.js";
import { IconRefresh } from "../../components/Icons.js";
import { useLearnData } from "../../state/data.js";
import { BackButton, NoticeRow, semesterText } from "./shared.js";

type Filter = "all" | "important" | "unread";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "important", label: "重要" },
  { key: "unread", label: "未读" },
];

export function NoticesPage() {
  const { data, state, error, reload } = useLearnData();
  const [filter, setFilter] = useState<Filter>("all");

  const byCourse = useMemo(
    () => new Map((data?.courses ?? []).map((c) => [c.id, c.name])),
    [data],
  );

  const groups = useMemo(() => {
    const ns = [...(data?.notifications ?? [])].sort((a, b) => b.publishTime.localeCompare(a.publishTime));
    return {
      all: ns,
      important: ns.filter((n) => n.important),
      unread: ns.filter((n) => !n.hasRead),
    };
  }, [data]);

  const list = groups[filter];

  const { navigate } = useApp();
  return (
    <>
      <PageHead
        title="课程通知"
        meta={data ? `${semesterText(data.semester.id)} · 共 ${groups.all.length} 条` : "按发布时间倒序"}
        actions={
          <>
            <PageAtomStar atomKey="learn-notices" title="全部通知" />
            <BackButton to="learn" label="课程列表" />
            <button className="btn" onClick={() => navigate("learn-search", { from: "learn-notices" })}>搜索</button>
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
        <Card><Empty text={filter === "all" ? "暂无课程通知。" : "该分组暂无通知。"} /></Card>
      ) : (
        <Card className="list">
          {list.map((n, i) => (
            <NoticeRow key={`${n.courseId}-${n.id}`} n={n} courseName={byCourse.get(n.courseId)} from="learn-notices" style={{ animationDelay: `${i * 25}ms` }} />
          ))}
        </Card>
      )}
    </>
  );
}
