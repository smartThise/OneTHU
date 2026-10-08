/** 全部课程通知（learnX Notices）：按发布时间倒序，可筛重要/未读 */
import { useMemo, useState } from "react";
import { usePageCollect } from "../../components/Collect.js";
import { pageAtomRef } from "../../state/atoms.js";
import type { PageMenuItem } from "../../state/pageChrome.js";
import { SegmentedOverflow, Card, Empty, ErrorNote, PageHead, SkeletonRows } from "../../components/Layout.js";
import { useApp } from "../../state/context.js";
import { IconRefresh, IconSearch } from "../../components/Icons.js";
import { useLearnData } from "../../state/data.js";
import { BackButton, NoticeRow, semesterText } from "./shared.js";
import { useLearnNavSemester } from "./shared.js";
import { noticeHasRead, useNoticeReadVersion } from "../../lib/noticeRead.js";

type Filter = "all" | "important" | "unread";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "important", label: "重要" },
  { key: "unread", label: "未读" },
];

export function NoticesPage() {
  useLearnNavSemester();
  const { data, state, error, reload } = useLearnData();
  const [filter, setFilter] = useState<Filter>("all");

  const byCourse = useMemo(
    () => new Map((data?.courses ?? []).map((c) => [c.id, c.name])),
    [data],
  );

  // R23：本地已读覆盖也要参与（打开过的通知立刻移出「未读」，不等服务端 sfyd 刷新）
  const readVersion = useNoticeReadVersion();
  const groups = useMemo(() => {
    const ns = [...(data?.notifications ?? [])].sort((a, b) => b.publishTime.localeCompare(a.publishTime));
    const hasRead = (n: { courseId: string; id: string; hasRead?: boolean }): boolean =>
      noticeHasRead(n.hasRead, n.courseId, n.id);
    return {
      all: ns,
      important: ns.filter((n) => n.important),
      unread: ns.filter((n) => !hasRead(n)),
    };
    // readVersion 参与依赖：本地置读后立即重算分组与计数
  }, [data, readVersion]);

  const list = groups[filter];

  const { navigate } = useApp();
  const collect = usePageCollect(pageAtomRef("learn-notices"), "全部通知");
  return (
    <>
      {collect.modal}
      <PageHead
        title="课程通知"
        meta={data ? `${semesterText(data.semester.id)} · 共 ${groups.all.length} 条` : "按发布时间倒序"}
        back={<BackButton to="learn" label="课程列表" />}
        menu={[
          collect.item,
          { key: "search", label: "搜索", icon: <IconSearch width={16} height={16} />, onSelect: () => navigate("learn-search", { from: "learn-notices" }) },
          {
            key: "refresh",
            label: "刷新",
            icon: <IconRefresh width={16} height={16} />,
            disabled: state === "loading",
            onSelect: () => void reload(),
          },
        ].filter(Boolean) as PageMenuItem[]}
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
        <Card className="list swap-in">
          {list.map((n, i) => (
            <NoticeRow key={`${n.courseId}-${n.id}`} n={n} courseName={byCourse.get(n.courseId)} sem={data?.semester.id} from="learn-notices" style={{ animationDelay: `${i * 25}ms` }} />
          ))}
        </Card>
      )}
    </>
  );
}
