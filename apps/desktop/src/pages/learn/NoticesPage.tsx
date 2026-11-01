import { courseDisplayName, courseSearchNames } from "../../lib/learnLanguage.js";
import { t as i18n, useLocale as useUiLocale } from "../../i18n/index.js";
import { Tabs, Btn } from "@onethu/gui";
/**
 * 全部课程通知（learnX Notices）：按发布时间倒序，可筛重要/未读。
 *
 * R32：雨课堂公告并入同一列表后，**点击行为与网络学堂通知完全一致**——都进
 * learn-notice-detail 站内详情页（同一套 UI）；正文来源差异由详情页处理。
 */
import { useMemo, useState } from "react";
import { PageAtomStar } from "../..//components/Collect.js";
import { Card, Empty, ErrorNote, ListWindow, PageHead, SkeletonRows } from "../../components/Layout.js";
import { useApp } from "../../state/context.js";
import { IconRefresh } from "../../components/Icons.js";
import { useLearnData } from "../../state/data.js";
import { BackButton, NoticeRow, semesterText } from "./shared.js";
import { useLearnNavSemester } from "./shared.js";
import { noticeHasRead, useNoticeReadVersion } from "../../lib/noticeRead.js";
import { useExternalNotices } from "../../state/exthw.js";

type Filter = "all" | "important" | "unread";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", get label() { return i18n("pages.learn.noticespage.5c55a67935af"); } },
  { key: "important", get label() { return i18n("pages.learn.noticespage.a8cd9642aa48"); } },
  { key: "unread", get label() { return i18n("pages.learn.noticespage.4d0680f9efae"); } },
];

export function NoticesPage() {
  const uiLocale = useUiLocale();

  useLearnNavSemester();
  const { data, state, error, reload } = useLearnData();
  /** 雨课堂公告（R26：并入通知聚合；未登录雨课堂时为空数组，零回归） */
  const extNotices = useExternalNotices();
  const [filter, setFilter] = useState<Filter>("all");

  /** 课程 id → 课程名（外部公告的行副标题自带课程名，不经此表） */
  const byCourse = useMemo(
    () => new Map((data?.courses ?? []).map((c) => [c.id, c] as const)),
    [uiLocale, data],
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
  }, [uiLocale, data, extNotices, readVersion]);

  const list = groups[filter];

  const { navigate } = useApp();
  return (
    <>
      <PageHead
        title={i18n("pages.learn.noticespage.f37a13fc55b3")}
        meta={data ? i18n("pages.learn.noticespage.e4341164a295", { value: String(semesterText(data.semester.id)), length: String(groups.all.length) }) : i18n("pages.learn.noticespage.414526331795")}
        actions={
          <>
            <PageAtomStar atomKey="learn-notices" title={i18n("pages.learn.noticespage.bdac834d0ba2")} />
            <BackButton to="learn" label={i18n("pages.learn.noticespage.e5da2c107242")} />
            <Btn variant="outline" onClick={() => navigate("learn-search", { from: "learn-notices" })}>{i18n("pages.learn.noticespage.44ce7ae909bb")}</Btn>
            <Btn variant="outline" onClick={() => void reload()} disabled={state === "loading"}><IconRefresh width={14} height={14} />{i18n("pages.learn.noticespage.aee887434131")}</Btn>
          </>
        }
      />

      {state === "error" ? <ErrorNote text={error ?? ""} onRetry={() => void reload()} /> : null}

      <Tabs
        variant="segmented"
        block
        value={filter}
        onChange={(key) => setFilter(key as Filter)}
        items={FILTERS.map(({ key, label }) => ({ id: key, label, badge: groups[key].length }))}
      />

      {state === "loading" && !data ? (
        <SkeletonRows rows={6} />
      ) : state === "error" && !data ? null : list.length === 0 ? (
        <Card><Empty text={filter === "all" ? i18n("pages.learn.noticespage.6e378c022f21") : i18n("pages.learn.noticespage.ea0294759b72")} /></Card>
      ) : (
        <ListWindow>
          {/* R32：两来源同一行组件、同一打开方式（都进站内详情页） */}
          {list.map((n, i) => (
            <NoticeRow
              key={`${n.courseId}-${n.id}`}
              n={n}
              courseName={courseDisplayName(byCourse.get(n.courseId))} identityCourseName={byCourse.get(n.courseId)?.name}
              sem={data?.semester.id}
              from="learn-notices"
              style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}
            />
          ))}
        </ListWindow>
      )}
    </>
  );
}
