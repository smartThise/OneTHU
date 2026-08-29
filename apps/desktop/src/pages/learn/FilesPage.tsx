/** 全部课程文件（learnX Files）：按上传时间倒序，可按课程筛选 */
import { useMemo, useState } from "react";
import { Card, Empty, ErrorNote, PageHead, SkeletonRows } from "../../components/Layout.js";
import { IconRefresh } from "../../components/Icons.js";
import { useLearnData } from "../../state/data.js";
import { BackButton, FileRow, semesterText } from "./shared.js";

export function FilesPage() {
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
        title="课程文件"
        meta={data ? `${semesterText(data.semester.id)} · 共 ${data.files.length} 个文件` : "按上传时间倒序"}
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

      {(data?.courses.length ?? 0) > 1 ? (
        <div className="field" style={{ maxWidth: 260 }}>
          <label htmlFor="file-course-filter">按课程筛选</label>
          <select
            id="file-course-filter"
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
          >
            <option value="">全部课程</option>
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
            <FileRow key={`${f.courseId}-${f.id}`} f={f} courseName={byCourse.get(f.courseId)} from="learn-files" style={{ animationDelay: `${i * 25}ms` }} />
          ))}
        </Card>
      )}
    </>
  );
}
