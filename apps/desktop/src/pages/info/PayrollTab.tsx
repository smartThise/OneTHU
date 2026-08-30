/**
 * 银行代发 —— info.getBankPayment（thu-info-app bankPayment.tsx 移植）。
 * 按月分组的工资/奖金发放记录（部门 · 项目 · 实发）。空数据/维护态铁律见 tabStates.tsx。
 */
import { useCallback, useEffect, useState } from "react";
import { Card, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { info } from "../../lib/clients.js";
import { useApp } from "../../state/context.js";
import { TabEmpty, TabError, isServiceUnavailable, logTabErr, tabErrorText } from "./tabStates.js";

type LoadState = "loading" | "error" | "ready";
/** core getBankPayment → 按月分组（month 形如 "2021年12月"） */
type PayrollMonth = Awaited<ReturnType<typeof info.getBankPayment>>[number];

export function PayrollTab() {
  const { status } = useApp();
  const [months, setMonths] = useState<PayrollMonth[] | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (status !== "ready") return;
    setState("loading");
    setUnavailable(false);
    setError(null);
    try {
      setMonths(await info.getBankPayment(false, true)); // loadPartial=true：最近 3 个年份（lib loadPartial 语义）
      setState("ready");
    } catch (err) {
      logTabErr("PAYROLL", err);
      setUnavailable(isServiceUnavailable(err));
      setError(tabErrorText(err));
      setState("error");
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  if (status === "demo") {
    return <TabEmpty text="演示模式不提供银行代发数据，登录后可查看发放记录。" />;
  }

  return (
    <>
      {state === "error" ? (
        <TabError unavailable={unavailable} text={error} onRetry={() => void load()} />
      ) : null}

      {state === "loading" && !months ? (
        <SkeletonRows rows={5} />
      ) : state !== "ready" ? null : (months?.length ?? 0) === 0 ? (
        <TabEmpty text="暂无银行代发记录（工资条可能尚未生成，或无代发项目）。" />
      ) : (
        months!.map((m) => (
          <div key={m.month} style={{ marginBottom: 18 }}>
            <SectionHead title={m.month} aside={`${m.payment.length} 笔`} />
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>项目</th>
                    <th>说明</th>
                    <th className="num">实发</th>
                  </tr>
                </thead>
                <tbody>
                  {m.payment.map((r, i) => (
                    <tr key={`${m.month}-${i}`} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                      <td className="cell-title">{r.project || r.usage || "代发"}</td>
                      <td>{r.department || r.description || "–"}</td>
                      <td className="num">{r.actual || "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        ))
      )}
    </>
  );
}
