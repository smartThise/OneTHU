/**
 * 研究生收入 —— info.getGraduateIncome（thu-info-app income.tsx 移植）。
 * 近 12 个月助研津贴/补助发放记录（发放日期 · 项目 · 实发）。
 * core 返回 null = 无权限/无数据（本科生常态）→ 「研究生专项目」空态，绝不报失登。
 * 空数据/维护态铁律见 tabStates.tsx；绝不自动整页刷新。
 */
import { useCallback, useEffect, useState } from "react";
import { Card, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { info } from "../../lib/clients.js";
import { useApp } from "../../state/context.js";
import { TabEmpty, TabError, isServiceUnavailable, logTabErr, tabErrorText } from "./tabStates.js";

type LoadState = "loading" | "error" | "ready" | "none";
/** core getGraduateIncome → 发放记录（ym=发放日期中文，afterTax=实发） */
type GradIncomeRow = NonNullable<Awaited<ReturnType<typeof info.getGraduateIncome>>>[number];

/** 近 12 个月窗口（YYYYMMDD，core getGraduateIncome(begin, end) 参数约定） */
function recentRange(): { begin: string; end: string } {
  const p = (n: number) => String(n).padStart(2, "0");
  const end = new Date();
  const begin = new Date(end.getFullYear(), end.getMonth() - 11, 1);
  return {
    begin: `${begin.getFullYear()}${p(begin.getMonth() + 1)}${p(begin.getDate())}`,
    end: `${end.getFullYear()}${p(end.getMonth() + 1)}${p(end.getDate())}`,
  };
}

export function GradIncomeTab() {
  const { status } = useApp();
  const [rows, setRows] = useState<GradIncomeRow[] | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (status !== "ready") return;
    setState("loading");
    setUnavailable(false);
    setError(null);
    try {
      const range = recentRange();
      const data = await info.getGraduateIncome(range.begin, range.end);
      if (data === null) {
        setRows(null);
        setState("none"); // 研究生专项目（本科生无权限/无数据）：友好空态，绝非错误
      } else {
        setRows(data);
        setState("ready");
      }
    } catch (err) {
      logTabErr("GRADINCOME", err);
      setUnavailable(isServiceUnavailable(err));
      setError(tabErrorText(err));
      setState("error");
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  if (status === "demo") {
    return <TabEmpty text="演示模式不提供研究生收入数据，登录后可查看发放记录。" />;
  }

  const total = (rows ?? []).reduce((s, r) => s + (r.afterTax ?? 0), 0);

  return (
    <>
      <SectionHead title="近 12 个月发放记录" aside="财务系统 · 计税后实发" />
      {state === "error" ? (
        <TabError unavailable={unavailable} text={error} onRetry={() => void load()} />
      ) : null}

      {state === "loading" && !rows ? (
        <SkeletonRows rows={5} />
      ) : state === "none" ? (
        <TabEmpty text="研究生专项目，本科生无此数据。" />
      ) : state !== "ready" ? null : (rows?.length ?? 0) === 0 ? (
        <TabEmpty text="暂无收入记录（助研津贴等发放后才可查询）。" />
      ) : (
        <>
          <Card className="stat-card" style={{ marginBottom: 12 }}>
            <div className="row-main">
              <div className="stat-num">¥{total.toFixed(2)}</div>
              <div className="stat-label">近 12 个月实发合计</div>
            </div>
          </Card>
          <Card className="list">
            {rows!.map((r, i) => (
              <div className="row" key={`${r.id}-${i}`} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                <div className="row-when">
                  <b>{r.ym || r.date || "–"}</b>
                </div>
                <div className="row-main">
                  <div className="row-title">{r.name || "发放"}</div>
                  <div className="row-sub">
                    {r.department || ""}
                    {r.tax ? ` · 计税 ¥${r.tax.toFixed(2)}` : ""}
                  </div>
                </div>
                <div className="row-amount">
                  <b className="amount-pos">+¥{(r.afterTax ?? 0).toFixed(2)}</b>
                </div>
              </div>
            ))}
          </Card>
          <div style={{ marginTop: 12 }}>
            <Card>
              <div className="empty">仅展示近 12 个月记录；更早记录请在财务系统查询。</div>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
