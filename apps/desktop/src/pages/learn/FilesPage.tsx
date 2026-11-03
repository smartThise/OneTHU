import { courseDisplayName, courseSearchNames } from "../../lib/learnLanguage.js";
import { t as i18n, useLocale as useUiLocale } from "../../i18n/index.js";
import { Btn, Select } from "@onethu/gui";
/** 全部课程文件（learnX Files）：按上传时间倒序，可按课程筛选 */
import { useMemo, useState } from "react";
import { PageAtomStar } from "../..//components/Collect.js";
import { Card, Empty, ErrorNote, ListWindow, PageHead, SkeletonRows } from "../../components/Layout.js";
import { IconRefresh } from "../../components/Icons.js";
import { useLearnData } from "../../state/data.js";
import { BackButton, FileRow, semesterText } from "./shared.js";
import { useLearnNavSemester } from "./shared.js";

export function FilesPage() {
  const uiLocale = useUiLocale();

  useLearnNavSemester();
  const { data, state, error, reload } = useLearnData();
  const [courseId, setCourseId] = useState("");

  const byCourse = useMemo(
    () => new Map((data?.courses ?? []).map((c) => [c.id, c])),
    [uiLocale, data],
  );

  const files = useMemo(() => {
    const fs = [...(data?.files ?? [])].sort((a, b) => b.uploadTime.localeCompare(a.uploadTime));
    return courseId ? fs.filter((f) => f.courseId === courseId) : fs;
  }, [uiLocale, data, courseId]);

  return (
    <>
      <PageHead
        title={i18n("pages.learn.filespage.2bb745fb2e6f")}
        meta={data ? i18n("pages.learn.filespage.9ab43df26f19", { value: String(semesterText(data.semester.id)), length: String(data.files.length) }) : i18n("pages.learn.filespage.a890de7b178d")}
        actions={
          <>
            <PageAtomStar atomKey="learn-files" title={i18n("pages.learn.filespage.fa8fe752727c")} />
            <BackButton to="learn" label={i18n("pages.learn.filespage.e5da2c107242")} />
            <Btn variant="outline" onClick={() => void reload()} disabled={state === "loading"}><IconRefresh width={14} height={14} />{i18n("pages.learn.filespage.aee887434131")}</Btn>
          </>
        }
      />

      {state === "error" ? <ErrorNote text={error ?? ""} onRetry={() => void reload()} /> : null}

      {(data?.courses.length ?? 0) > 1 ? (
        <div className="field" style={{ maxWidth: 260 }}>
          <label htmlFor="file-course-filter">{i18n("pages.learn.filespage.54fc6c3ebb09")}</label>
          <Select
            id="file-course-filter"
            value={courseId}
            onChange={setCourseId}
          >
            <option value="">{i18n("pages.learn.filespage.dc62910bd1d2")}</option>
            {(data?.courses ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </div>
      ) : null}

      {state === "loading" && !data ? (
        <SkeletonRows rows={6} />
      ) : state === "error" && !data ? null : files.length === 0 ? (
        <Card><Empty text={courseId ? i18n("pages.learn.filespage.6b0161276931") : i18n("pages.learn.filespage.0dcb4c625d8b")} /></Card>
      ) : (
        <ListWindow className="learn-file-window">
          {/* 固定视口窗口：高度由 ListWindow 按底栏实测，滚动发生在卡片内部。 */}
          {files.map((f, i) => (
            <FileRow key={`${f.courseId}-${f.id}`} f={f} courseName={courseDisplayName(byCourse.get(f.courseId))} identityCourseName={byCourse.get(f.courseId)?.name} sem={data?.semester.id} from="learn-files" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }} />
          ))}
        </ListWindow>
      )}
    </>
  );
}
