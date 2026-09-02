/**
 * 课程信息 —— courseX 课程信息共享计划（tsinghua.app / 星期四）查询页。
 * 众包共享库：learnX 用户把自己网络学堂课程的时间地点共享出来，这里按
 * 课程名/教师搜索任意开课并查看上课时间与地点。
 *
 * 纯查询页：走 tsinghua.app 公开网页（服务端渲染，免凭证——与浏览器直接
 * 搜等价）。上传回馈不在 OneTHU 范围内——tsinghua.app 没有公开登录渠道，
 * token 只有 learnX 作者私有，普通用户无从参与上传。数据为第三方众包，
 * 覆盖不全时诚实提示，不造数据。
 */
import { Fragment, useCallback, useEffect, useState } from "react";
import type { CourseXDetail, CourseXSemester, CourseXSummary } from "@onethu/core";
import {
  courseXSemesterText,
  getCourseXDetailPublic,
  getCourseXSemesters,
  searchCourseXPublic,
} from "@onethu/core";
import { Card, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { IconSearch } from "../../components/Icons.js";
import { SearchSelect } from "../../components/SearchSelect.jsx";
import { useApp } from "../../state/context.js";
import { universalFetch } from "../../lib/transport.js";
import { TabEmpty, TabError, logTabErr, tabErrorText } from "./tabStates.js";

type SearchState = "idle" | "loading" | "error" | "ready";

/** 行展开详情（一次只展开一行） */
interface DetailState {
  key: string;
  loading: boolean;
  data: CourseXDetail | null;
  error: string | null;
}

export function CourseInfoTab() {
  const { status } = useApp();

  const [input, setInput] = useState("");
  const [semesters, setSemesters] = useState<CourseXSemester[] | null>(null);
  const [semester, setSemester] = useState<string>("");
  const [courses, setCourses] = useState<CourseXSummary[] | null>(null);
  const [state, setState] = useState<SearchState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);

  /** 学期列表（挂载即拉，默认当前学期——与 courseX 网页一致的交互） */
  useEffect(() => {
    if (status !== "ready") return;
    getCourseXSemesters(universalFetch)
      .then((list) => {
        if (list.length > 0) {
          setSemesters(list);
          setSemester(list.find((s) => s.current)?.id ?? list[0]!.id);
        }
      })
      .catch((err: unknown) => logTabErr("COURSEX-SEMESTERS", err));
  }, [status]);

  const runSearch = useCallback(
    async (q: string, semOverride?: string) => {
      if (!q.trim()) return;
      setState("loading");
      setError(null);
      setDetail(null);
      try {
        const sem = semOverride ?? semester;
        setCourses(await searchCourseXPublic(universalFetch, q.trim(), sem || undefined));
        setState("ready");
      } catch (err) {
        logTabErr("COURSEX-SEARCH", err);
        setError(tabErrorText(err));
        setState("error");
      }
    },
    [semester],
  );

  const openDetail = useCallback(async (c: CourseXSummary) => {
    // 再点同一行 = 收起
    setDetail((d) => (d?.key === c.id ? null : { key: c.id, loading: true, data: null, error: null }));
    try {
      const data = await getCourseXDetailPublic(universalFetch, c.id);
      setDetail({ key: c.id, loading: false, data, error: null });
    } catch (err) {
      logTabErr("COURSEX-DETAIL", err);
      setDetail({ key: c.id, loading: false, data: null, error: tabErrorText(err) });
    }
  }, []);

  if (status === "demo") {
    return <TabEmpty text="演示模式不提供课程共享查询，登录后可搜索全校开课的上课地点。" />;
  }

  return (
    <>
      <SectionHead
        title="课程信息"
        aside="课程共享计划 · courseX · 众包数据，覆盖不全时请多包涵"
      />

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {semesters && semesters.length > 0 ? (
          <SearchSelect
            value={semester}
            onChange={(v) => {
              setSemester(v);
              // 已有搜索词时切学期立即重查（与 courseX 网页同款交互）
              if (input.trim()) void runSearch(input, v);
            }}
            placeholder="选择学期…"
            options={semesters.map((s) => ({ value: s.id, label: s.label }))}
          />
        ) : null}
        <div className="search-box" style={{ flex: 1, minWidth: 160 }}>
          <IconSearch width={15} height={15} />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runSearch(input);
            }}
            placeholder="搜索课程名 / 教师姓名（如：微积分 / 冯铃）"
            aria-label="搜索课程"
          />
          {input ? (
            <button className="btn btn-ghost" onClick={() => setInput("")}>
              清除
            </button>
          ) : null}
        </div>
        <button className="btn" disabled={state === "loading"} onClick={() => void runSearch(input)}>
          搜索
        </button>
      </div>

      {state === "error" ? (
        <TabError unavailable={false} text={error} onRetry={() => void runSearch(input)} />
      ) : null}

      {state === "loading" ? (
        <SkeletonRows rows={6} />
      ) : state === "ready" ? (
        (courses?.length ?? 0) === 0 ? (
          <TabEmpty text="共享库中未找到匹配的课程——换个关键词试试，或该课尚未被共享（覆盖取决于大家的参与）。" />
        ) : (
          <>
            <SectionHead title="搜索结果" aside={`共 ${courses!.length} 条 · 点行查看时间地点`} />
            <Card style={{ padding: 0, overflow: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>课程</th>
                    <th>教师</th>
                    <th>学期</th>
                  </tr>
                </thead>
                <tbody>
                  {courses!.map((c, i) => (
                    <Fragment key={c.id}>
                      <tr
                        style={{ animationDelay: `${Math.min(i, 12) * 25}ms`, cursor: "pointer" }}
                        onClick={() => void openDetail(c)}
                      >
                        <td className="cell-title">
                          {c.name}
                          {c.englishName ? (
                            <span style={{ opacity: 0.55, marginLeft: 6, fontSize: 12 }}>{c.englishName}</span>
                          ) : null}
                        </td>
                        <td>{c.teacherName || "—"}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{courseXSemesterText(c.semesterId)}</td>
                      </tr>
                      {detail?.key === c.id ? (
                        <tr>
                          <td colSpan={3} style={{ background: "rgba(0,0,0,0.02)" }}>
                            {detail.loading ? (
                              <span style={{ opacity: 0.6 }}>正在加载时间地点…</span>
                            ) : detail.error ? (
                              <span style={{ color: "var(--red)" }}>{detail.error}</span>
                            ) : detail.data ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "4px 0" }}>
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "baseline" }}>
                                  <span style={{ fontWeight: 600 }}>{detail.data.name}</span>
                                  {detail.data.teacherName ? (
                                    <span style={{ opacity: 0.7 }}>{detail.data.teacherName}</span>
                                  ) : null}
                                  {detail.data.semesterId ? (
                                    <span className="chip chip-gray">{detail.data.semesterId}</span>
                                  ) : null}
                                </div>
                                {detail.data.timeLocation.length > 0 ? (
                                  detail.data.timeLocation.map((t, ti) => (
                                    <div key={ti} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                                      <span className="chip chip-green">时间地点</span>
                                      <span>{t}</span>
                                    </div>
                                  ))
                                ) : (
                                  <span style={{ opacity: 0.6 }}>
                                    共享库暂无该课的时间地点——数据覆盖取决于 learnX 等客户端用户的共享参与。
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span style={{ opacity: 0.6 }}>共享库中无此课程详情。</span>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )
      ) : null}
    </>
  );
}
