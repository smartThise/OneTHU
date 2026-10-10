/**
 * 全部课程通知（learnX Notices）：按发布时间倒序，可筛重要/未读。
 *
 * R32：雨课堂公告并入同一列表后，**点击行为与网络学堂通知完全一致**——都进
 * learn-notice-detail 站内详情页（同一套 UI）；正文来源差异由详情页处理。
 */
import { useMemo, useState } from "react";
import { PageAtomStar } from "../..//components/Collect.js";
import { SegmentedOverflow, Card, Empty, ErrorNote, PageHead, SkeletonRows } from "../../components/Layout.js";
import { useApp } from "../../state/context.js";
import { IconRefresh } from "../../components/Icons.js";
import { useLearnData } from "../../state/data.js";
import { BackButton, NoticeRow, semesterText } from "./shared.js";
import { useLearnNavSemester } from "./shared.js";
import { noticeHasRead, useNoticeReadVersion } from "../../lib/noticeRead.js";
import { useExternalNotices } from "../../state/exthw.js";

type Filter = "all" | "important" | "unread";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "important", label: "重要" },
  { key: "unread", label: "未读" },
];

export function NoticesPage() {
  useLearnNavSemester();
  const { data, state, error, reload } = useLearnData();
  /** 雨课堂公告（R26：并入通知聚合；未登录雨课堂时为空数组，零回归） */
  const extNotices = useExternalNotices();
  const [filter, setFilter] = useState<Filter>("all");

  /** 课程 id → 课程名（外部公告的行副标题自带课程名，不经此表） */
  const byCourse = useMemo(
    () => new Map((data?.courses ?? []).map((c) => [c.id, c.name] as const)),
    [data],
  );

  // R23：本地已读覆盖也要参与（打开过的通知立刻移出「未读」，不等服务端 sfyd 刷新）
  const readVersion = useNoticeReadVersion();
  const groups = useMemo(() => {
    // R26：网络学堂通知 + 雨课堂公告合并（同一列表、同一「重要/未读」口径）
    const ns = [...(data?.notifications ?? []), ...extNotices].sort((a, b) =>
      b.publishTime.localeCompare(a.publishTime),
    );
    const hasRead = (n: { courseId: string; id: string; hasRead?: boolean }): boolean =>
      noticeHasRead(n.hasRead, n.courseId, n.id);
    return {
      all: ns,
      important: ns.filter((n) => n.important),
      unread: ns.filter((n) => !hasRead(n)),
    };
    // readVersion 参与依赖：本地置读后立即重算分组与计数
  }, [data, extNotices, readVersion]);

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
          {/* R32：两来源同一行组件、同一打开方式（都进站内详情页） */}
          {list.map((n, i) => (
            <NoticeRow
              key={`${n.courseId}-${n.id}`}
              n={n}
              courseName={byCourse.get(n.courseId)}
              sem={data?.semester.id}
              from="learn-notices"
              style={{ animationDelay: `${i * 25}ms` }}
            />
          ))}
        </Card>
      )}
    </>
  );
}
