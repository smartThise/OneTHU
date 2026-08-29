/**
 * 校园卡页 —— getCardInfo + getCardTransactions（thu-info-lib card.ts 移植）。
 * 余额与卡状态置顶；最近 30 天消费流水。
 * 金额约定（thu-info-app expenditure.tsx 实证）：服务端金额恒为正，
 * 按「名称」分类——充值/圈存/补助=收入（+绿），其余=消费（−红）。
 */
import { useMemo, useEffect } from "react";
import type { CardTransaction } from "@onethu/core";
import { Card, Empty, ErrorNote, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { IconCard } from "../../components/Icons.js";
import { useCard } from "../../state/data.js";

const incomeRe = /充值|圈存|补助/;
const isIncome = (t: CardTransaction): boolean =>
  incomeRe.test(`${t.name ?? ""} ${t.summary ?? ""} ${t.txName ?? ""}`);
const signedAmount = (t: CardTransaction): number =>
  isIncome(t) ? Math.abs(t.amount) : -Math.abs(t.amount);

function fmtTime(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${m}-${day} ${hh}:${mm}`;
}

export function CardTab({ active = true }: { active?: boolean }) {
  const { data, state, error, reload } = useCard(30);
  // 切回本栏时若上次报错（如会话过期）则自动重试一次，不再让用户手动点刷新
  useEffect(() => { if (active && state === "error") void reload(); }, [active]);

  const spent = useMemo(
    () =>
      (data?.transactions ?? [])
        .filter((t) => !isIncome(t))
        .reduce((sum, t) => sum + Math.abs(t.amount), 0),
    [data],
  );

  return (
    <>
      <div className="stats stats-hero">
        <Card className="card-hero">
          <div className="card-hero-main">
            <span className="stat-icon">
              <IconCard width={17} height={17} />
            </span>
            <div>
              <div className="card-hero-amount">
                {state === "loading" && !data ? "–" : `¥${(data?.info.balance ?? 0).toFixed(2)}`}
              </div>
              <div className="stat-label">
                校园卡余额 · {data?.info.userName || "–"}
                {data?.info.cardStatus ? ` · ${data.info.cardStatus}` : ""}
              </div>
            </div>
          </div>
          <div className="card-hero-meta">
            <span>卡号 {data?.info.cardId || "–"}</span>
            {data?.info.departmentName ? <span>{data.info.departmentName}</span> : null}
            {data?.info.maxOneTimeTransactionAmount !== undefined ? (
              <span>单笔上限 ¥{data.info.maxOneTimeTransactionAmount.toFixed(0)}</span>
            ) : null}
          </div>
        </Card>
        <Card className="stat-card">
          <span className="stat-icon red">
            <IconCard width={17} height={17} />
          </span>
          <div>
            <div className="stat-num">{spent < 0 ? `¥${(-spent).toFixed(2)}` : "¥0.00"}</div>
            <div className="stat-label">近 30 天消费</div>
          </div>
        </Card>
        <Card className="stat-card">
          <span className="stat-icon amber">
            <IconCard width={17} height={17} />
          </span>
          <div>
            <div className="stat-num">{data?.transactions.length ?? 0}</div>
            <div className="stat-label">流水笔数</div>
          </div>
        </Card>
      </div>

      {state === "error" ? <ErrorNote text={error ?? ""} onRetry={() => void reload()} /> : null}

      <SectionHead title="最近消费" aside="最近 30 天（数据源：card.tsinghua.edu.cn）" />
      {state === "loading" && !data ? (
        <SkeletonRows rows={6} />
      ) : (data?.transactions.length ?? 0) === 0 ? (
        <Card>
          <Empty text="近 30 天没有消费记录。" />
        </Card>
      ) : (
        <Card className="list">
          {data!.transactions.map((t, i) => (
            <div className="row" key={t.id || i} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
              <div className="row-when">
                <b>{fmtTime(t.timestamp).slice(0, 5)}</b>
                <span>{fmtTime(t.timestamp).slice(6)}</span>
              </div>
              <div className="row-main">
                <div className="row-title">{t.name || t.summary || t.txName || "交易"}</div>
                <div className="row-sub">
                  {t.txName ?? "交易"}
                  {t.address ? ` · ${t.address}` : ""}
                </div>
              </div>
              <div className="row-amount">
                <b className={signedAmount(t) < 0 ? "amount-neg" : "amount-pos"}>
                  {signedAmount(t) < 0 ? "−" : "+"}¥{Math.abs(t.amount).toFixed(2)}
                </b>
                <span>余额 ¥{t.balance.toFixed(2)}</span>
              </div>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
