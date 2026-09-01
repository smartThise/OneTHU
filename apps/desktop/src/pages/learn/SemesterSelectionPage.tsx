/** 学期切换（learnX SemesterSelection）：列表 + 最新/当前标记，选择后回到课程列表 */
import { useMemo } from "react";
import { Card, Empty, ErrorNote, PageHead, SkeletonRows } from "../../components/Layout.js";
import { IconCheck, IconRefresh } from "../../components/Icons.js";
import { useApp } from "../../state/context.js";
import { getSelectedSemester, setSelectedSemester, useLearnData, useSemesters } from "../../state/data.js";
import { BackButton, semesterText } from "./shared.js";

export function SemesterSelectionPage() {
  const { navigate } = useApp();
  const { data: bundle } = useLearnData();
  const { list, current, state, error, reload } = useSemesters();

  // 正在展示的学期：已选学期 ?? 数据实际加载的学期
  const active = useMemo(
    () => getSelectedSemester() ?? bundle?.semester.id ?? current ?? null,
    [bundle, current],
  );

  const choose = (id: string | null) => {
    setSelectedSemester(id);
    // 显式把所选学期带给 learn 列表页：数据按新学期重拉后，页面据此自校验
    // （缓存被清 → 重挂载 loading → 新学期 bundle；学期不符时 LearnPage 还会兜底重校验）
    navigate("learn", id ? { semesterId: id } : undefined);
  };

  return (
    <>
      <PageHead
        title="切换学期"
        
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

      {state === "loading" && !list ? (
        <SkeletonRows rows={5} />
      ) : state === "error" && !list ? null : (
        <Card className="list">
          {current && !list?.includes(current) ? (
            <SemesterRow
              id={current}
              active={active === current}
              badge="最新"
              onChoose={() => choose(current)}
            />
          ) : null}
          {(list ?? []).map((id) => (
            <SemesterRow
              key={id}
              id={id}
              active={active === id}
              badge={id === current ? "最新" : undefined}
              onChoose={() => choose(id)}
            />
          ))}
          {!getSelectedSemester() && current ? null : (
            <div
              className="row row-click"
              role="button"
              tabIndex={0}
              onClick={() => choose(null)}
              onKeyDown={(e) => e.key === "Enter" && choose(null)}
            >
              <div className="row-main">
                <div className="row-title">跟随最新学期{current ? `（${semesterText(current)}）` : ""}</div>
                <div className="row-sub">默认跟随学校当前学期</div>
              </div>
              {!getSelectedSemester() ? (
                <span className="chip chip-blue"><IconCheck width={12} height={12} />当前</span>
              ) : null}
            </div>
          )}
          {(list ?? []).length === 0 && !current ? <Empty text="暂无可选学期。" /> : null}
        </Card>
      )}
    </>
  );
}

function SemesterRow({ id, active, badge, onChoose }: { id: string; active: boolean; badge?: string; onChoose: () => void }) {
  return (
    <div
      className="row row-click"
      role="button"
      tabIndex={0}
      onClick={onChoose}
      onKeyDown={(e) => e.key === "Enter" && onChoose()}
    >
      <div className="row-main">
        <div className="row-title">{semesterText(id)}</div>
        <div className="row-sub">{id}</div>
      </div>
      {badge ? <span className="chip chip-gray">{badge}</span> : null}
      {active ? (
        <span className="chip chip-blue"><IconCheck width={12} height={12} />正在查看</span>
      ) : null}
    </div>
  );
}
