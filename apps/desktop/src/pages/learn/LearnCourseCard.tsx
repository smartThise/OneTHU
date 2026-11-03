import { t as i18n, rich as i18nRich, useLocale as useUiLocale } from "../../i18n/index.js";
import type { ReactNode } from "react";
import { Btn, Card, Tag } from "@onethu/gui";
import { IconChevron } from "../../components/Icons.js";
import type { CourseTabKey } from "./courseMerge.js";

export interface LearnCourseCardProps {
  courseId: string;
  title: string;
  details?: string;
  schedule?: string;
  source: "learn" | "yuketang";
  stats: { hw: number; notices: number; files: number };
  officialUnread?: { notices?: number; files?: number };
  audited?: boolean;
  aside?: ReactNode;
  onOpen: () => void;
  onOpenSection: (section: CourseTabKey) => void;
  yktEntry?: { title: string; onOpen: () => void };
}

/** Both sources share one card. Independent actions are siblings of the main
 * course button, so click, Enter and Space never open two different pages. */
export function LearnCourseCard({
  courseId, title, details, schedule, source, stats, officialUnread, audited, aside, onOpen, onOpenSection, yktEntry,
}: LearnCourseCardProps): ReactNode {
  const uiLocale = useUiLocale();

  return (
    <Card flush className="learn-course-card" data-learn-course-id={courseId} data-learn-source={source}>
      <div className="learn-course-main">
        <Btn
          variant="ghost"
          className="learn-course-open"
          onClick={onOpen}
          aria-label={i18n("pages.learn.learncoursecard.171ea726b9c3", { title: String(title) })}
        >
          <span className="learn-course-heading">
            <span className="learn-course-title">{title}</span>
            <IconChevron className="learn-course-caret" />
          </span>
          <span className="learn-course-details">{details}</span>
          <span className="learn-course-schedule">{schedule}</span>
        </Btn>
        {aside ? <div className="learn-course-save">{aside}</div> : null}
      </div>
      <div className="learn-course-footer">
        <div className="learn-course-sources">
          <Btn
            variant="tonal"
            tone="info"
            size="sm"
            onClick={onOpen}
            aria-label={i18n("pages.learn.learncoursecard.ae4bb5c2fa1d", { value: String(source === "learn" ? i18n("pages.learn.learncoursecard.aa39cac2b409") : i18n("pages.learn.learncoursecard.38b9eabcae1b")), title: String(title) })}
            iconRight={<IconChevron />}
          >
            {source === "learn" ? i18n("pages.learn.learncoursecard.aa39cac2b409") : i18n("pages.learn.learncoursecard.38b9eabcae1b")}
          </Btn>
          {yktEntry ? (
            <Btn
              variant="tonal"
              tone="info"
              size="sm"
              onClick={yktEntry.onOpen}
              aria-label={i18n("pages.learn.learncoursecard.254d16a47628", { title: String(yktEntry.title) })}
              iconRight={<IconChevron />}
            >{i18n("pages.learn.learncoursecard.38b9eabcae1b")}</Btn>
          ) : null}
          {audited ? <Tag>{i18n("pages.learn.learncoursecard.f8308b0b2728")}</Tag> : null}
        </div>
        <div className="learn-course-counts">
          {(officialUnread?.notices ?? 0) > 0 ? <Tag tone="info">{i18n("learn.course.unreadNotices", { count: String(officialUnread!.notices) })}</Tag> : null}
          {(officialUnread?.files ?? 0) > 0 ? <Tag tone="info">{i18n("learn.course.unreadFiles", { count: String(officialUnread!.files) })}</Tag> : null}
          <Btn
            variant="tonal"
            tone={stats.hw > 0 ? "error" : "default"}
            size="sm"
            onClick={() => onOpenSection("assignments")}
            aria-label={i18n("pages.learn.learncoursecard.9187830bb5bc", { title: String(title) })}
          >{i18nRich("pages.learn.learncoursecard.dea60e85a8f1", { hw: stats.hw })}</Btn>
          <Btn variant="tonal" size="sm" onClick={() => onOpenSection("notices")} aria-label={i18n("pages.learn.learncoursecard.15a3d11ecad1", { title: String(title) })}>{i18nRich("pages.learn.learncoursecard.1af0c0f9ddc6", { notices: stats.notices })}</Btn>
          <Btn variant="tonal" size="sm" onClick={() => onOpenSection("files")} aria-label={i18n("pages.learn.learncoursecard.ae17ace48bb0", { title: String(title) })}>{i18nRich("pages.learn.learncoursecard.d7f369480e77", { files: stats.files })}</Btn>
        </div>
      </div>
    </Card>
  );
}
