import { Btn } from "@onethu/gui";
/** 全部课程文件（learnX Files）：按上传时间倒序，可按课程筛选 */
import { useMemo, useState } from "react";
import { PageAtomStar } from "../..//components/Collect.js";
import { Card, Empty, ErrorNote, PageHead, SkeletonRows } from "../../components/Layout.js";
import { IconRefresh } from "../../components/Icons.js";
import { useLearnData } from "../../state/data.js";
import { BackButton, FileRow, semesterText } from "./shared.js";
import { useLearnNavSemester } from "./shared.js";
import { t as i18n } from "../../i18n/index.js";


export function FilesPage() {
  useLearnNavSemester();
  const { data, state, error, reload } = useLearnData();
  const [courseId, setCourseId] = useState("");

  const byCourse = useMemo(
    () => new Map((data?.courses ?? []).map((c) => [c.id, c.name])),
    [data],
  );

  const files = useMemo(() => {
    const fs = [...(data?.files ?? [])].sort((a, b) => b.uploadTime.localeCompare(a.uploadTime));
    return courseId ? fs.filter((f) => f.courseId === courseId) : fs;
  }, [data, courseId]);

  return (
    <>
      <PageHead
        title={i18n("auto.pages.learn.FilesPage.1")}
        meta={data ? `${semesterText(data.semester.id)} · 共 ${data.files.length} 个文件` : "按上传时间倒序"}
        actions={
          <>
            <PageAtomStar atomKey="learn-files" title={i18n("auto.pages.learn.FilesPage.2")} />
            <BackButton to="learn" label={i18n("auto.pages.learn.FilesPage.3")} />
            <Btn variant="outline" onClick={() => void reload()} disabled={state === "loading"}><IconRefresh width={14} height={14} />{i18n("auto.pages.learn.FilesPage.4")}</Btn>
          </>
        }
      />

      {state === "error" ? <ErrorNote text={error ?? ""} onRetry={() => void reload()} /> : null}

      {(data?.courses.length ?? 0) > 1 ? (
        <div className="field" style={{ maxWidth: 260 }}>
          <label htmlFor="file-course-filter">{i18n("auto.pages.learn.FilesPage.5")}</label>
          <select
            id="file-course-filter"
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
          >
            <option value="">{i18n("auto.pages.learn.FilesPage.6")}</option>
            {(data?.courses ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      ) : null}

      {state === "loading" && !data ? (
        <SkeletonRows rows={6} />
      ) : state === "error" && !data ? null : files.length === 0 ? (
        <Card><Empty text={courseId ? "该课程暂无文件。" : "暂无课程文件。"} /></Card>
      ) : (
        <Card className="list">
          {files.map((f, i) => (
            <FileRow key={`${f.courseId}-${f.id}`} f={f} courseName={byCourse.get(f.courseId)} sem={data?.semester.id} from="learn-files" style={{ animationDelay: `${i * 25}ms` }} />
          ))}
        </Card>
      )}
    </>
  );
}
