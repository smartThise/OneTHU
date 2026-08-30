/**
 * 教学评估 —— info.getAssessmentList（thu-info-app evaluation.tsx 移植，只读进度）。
 * 本端只读：展示课程评估完成情况（不代填问卷）。空数据/维护态铁律见 tabStates.tsx。
 */
import { useCallback, useEffect, useState } from "react";
import { Card, SkeletonRows } from "../../components/Layout.js";
import { info } from "../../lib/clients.js";
import { useApp } from "../../state/context.js";
import { TabEmpty, TabError, isServiceUnavailable, logTabErr, tabErrorText } from "./tabStates.js";

type LoadState = "loading" | "error" | "ready";
/** core getAssessmentList → [课程名, 是否已评, 表单 URL] 三元组列表 */
type AssessmentRow = Awaited<ReturnType<typeof info.getAssessmentList>>[number];

export function EvaluationTab() {
  const { status } = useApp();
  const [rows, setRows] = useState<AssessmentRow[] | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (status !== "ready") return;
    setState("loading");
    setUnavailable(false);
    setError(null);
    try {
      setRows(await info.getAssessmentList());
      setState("ready");
    } catch (err) {
      logTabErr("EVALUATION", err);
      setUnavailable(isServiceUnavailable(err));
      setError(tabErrorText(err));
      setState("error");
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  if (status === "demo") {
    return <TabEmpty text="演示模式不提供教学评估数据，登录后可查看问卷进度。" />;
  }

  const pending = (rows ?? []).filter((r) => !r[1]).length;

  return (
    <>
      {state === "error" ? (
        <TabError unavailable={unavailable} text={error} onRetry={() => void load()} />
      ) : null}

      {state === "loading" && !rows ? (
        <SkeletonRows rows={5} />
      ) : (rows?.length ?? 0) === 0 ? (
        <TabEmpty text="暂无评估问卷（当前不在评估期，或本学期无需评估课程）。" />
      ) : (
        <>
          <Card className="stat-card" style={{ marginBottom: 12 }}>
            <div className="row-main">
              <div className="stat-num">{pending}</div>
              <div className="stat-label">待评估课程（请在信息门户「教学评估」内填写，本页仅展示进度）</div>
            </div>
          </Card>
          <Card className="list">
            {rows!.map((r, i) => (
              <div className="row" key={`${r[0]}-${i}`} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                <span className={r[1] ? "chip chip-green" : "chip chip-amber"}>
                  {r[1] ? "已评估" : "待评估"}
                </span>
                <div className="row-main">
                  <div className="row-title">{r[0]}</div>
                </div>
              </div>
            ))}
          </Card>
        </>
      )}
    </>
  );
}
