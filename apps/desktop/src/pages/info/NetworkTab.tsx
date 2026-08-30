/**
 * 校园网 —— info.getNetworkAccountInfo + getNetworkBalance（thu-info-app
 * network.tsx/networkDetail 移植，简化只读版）。上游服务当前已瘫痪（thu-info
 * 同坏）：任何失败都显示静态瘫痪文案 + 重试，绝不自动整页刷新、绝不失登自愈。
 */
import { useCallback, useEffect, useState } from "react";
import { Card, ErrorNote, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { info } from "../../lib/clients.js";
import { useApp } from "../../state/context.js";
import { TabEmpty, logTabErr } from "./tabStates.js";

type LoadState = "loading" | "error" | "ready";
type NetworkRow = [string, string];

export function NetworkTab() {
  const { status } = useApp();
  const [rows, setRows] = useState<NetworkRow[] | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  const load = useCallback(async () => {
    if (status !== "ready") return;
    setState("loading");
    try {
      // 两路互相独立：任一成功即展示可得信息；全失败才算失败
      const [acc, bal] = await Promise.allSettled([
        info.getNetworkAccountInfo(),
        info.getNetworkBalance(),
      ]);
      const out: NetworkRow[] = [];
      if (acc.status === "fulfilled") {
        const a = acc.value;
        out.push(
          ["账号", a.username || "–"],
          ["姓名", a.realName || "–"],
          ["状态", a.status || "–"],
          ["用户组", a.userGroup || "–"],
          ["位置", a.location || "–"],
          ["允许设备数", String(a.allowedDevices ?? "–")],
          ["联系邮箱", a.contactEmail || "–"],
        );
      }
      if (bal.status === "fulfilled") {
        const b = bal.value;
        out.push(
          ["套餐", b.productName || "–"],
          ["已用流量", b.usedBytes || "–"],
          ["已用时长", b.usedSeconds || "–"],
          ["账户余额", b.accountBalance || "–"],
          ["结算日期", b.settlementDate || "–"],
        );
      }
      if (acc.status === "rejected") logTabErr("NETWORK-ACC", acc.reason);
      if (bal.status === "rejected") logTabErr("NETWORK-BAL", bal.reason);
      setRows(out);
      setState(out.length > 0 ? "ready" : "error");
    } catch (err) {
      logTabErr("NETWORK", err);
      setRows(null);
      setState("error");
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  if (status === "demo") {
    return <TabEmpty text="演示模式不提供校园网数据，登录后可尝试查询账号与流量。" />;
  }

  return (
    <>
      <SectionHead title="校园网" aside="账号 · 流量（上游服务不稳定）" />
      {state === "error" ? (
        <ErrorNote text="该功能上游服务已瘫痪（thu-info 同样不可用）" onRetry={() => void load()} />
      ) : null}

      {state === "loading" ? (
        <SkeletonRows rows={3} />
      ) : state === "ready" && rows ? (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>项目</th>
                <th className="num">信息</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([k, v], i) => (
                <tr key={`${k}-${i}`} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                  <td className="cell-title">{k}</td>
                  <td className="num">{v || "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </>
  );
}
