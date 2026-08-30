/**
 * 体测成绩 —— info.getPhysicalExamResult（thu-info-app physicalExam.tsx 移植，
 * zhjw tyjx 键值对展示）。三态与铁律见 tabStates.tsx：空数据=友好文案；
 * ServiceUnavailableError=静态提示+重试；绝不自动整页刷新、绝不触发失登自愈。
 */
import { useCallback, useEffect, useState } from "react";
import { Card, SkeletonRows } from "../../components/Layout.js";
import { info } from "../../lib/clients.js";
import { useApp } from "../../state/context.js";
import { TabEmpty, TabError, isServiceUnavailable, logTabErr, tabErrorText } from "./tabStates.js";

type LoadState = "loading" | "error" | "ready";
/** core getPhysicalExamResult → [项目, 成绩] 对列表 */
type FitnessRow = Awaited<ReturnType<typeof info.getPhysicalExamResult>>[number];

export function FitnessTab() {
  const { status } = useApp();
  const [rows, setRows] = useState<FitnessRow[] | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (status !== "ready") return;
    setState("loading");
    setUnavailable(false);
    setError(null);
    try {
      setRows(await info.getPhysicalExamResult());
      setState("ready");
    } catch (err) {
      logTabErr("FITNESS", err);
      setUnavailable(isServiceUnavailable(err));
      setError(tabErrorText(err));
      setState("error");
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  if (status === "demo") {
    return <TabEmpty text="演示模式不提供体测数据，登录后可查看体质测试成绩。" />;
  }

  return (
    <>
      {state === "error" ? (
        <TabError unavailable={unavailable} text={error} onRetry={() => void load()} />
      ) : null}

      {state === "loading" && !rows ? (
        <SkeletonRows rows={5} />
      ) : (rows?.length ?? 0) === 0 ? (
        <TabEmpty text="暂无成绩（本学期体测成绩可能尚未发布）。" />
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>项目</th>
                <th className="num">成绩</th>
              </tr>
            </thead>
            <tbody>
              {rows!.map(([k, v], i) => (
                <tr key={`${k}-${i}`} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                  <td className="cell-title">{k}</td>
                  <td className="num">{v || "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
