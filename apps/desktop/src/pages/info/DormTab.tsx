/**
 * 宿舍页 —— 电费余额/缴费记录 + 订水。
 * - 电费：thu-info-lib dorm.ts 移植（家园网 myhome 会话，ELE_REMAINDER / ELE_PAY_RECORD）；
 *   余额卡自动加载，缴费记录失败降级为空列表（余额为准）。
 * - 订水：thu-info-app network/water.ts 移植（清华水站 dingshui.bjqzhd.com 公开接口），
 *   订水编号查询联系人/地址后提交；dorm.ts 内无订水端点，端点以 RN 端 network/water.ts 为准。
 */
import { useCallback, useEffect, useState } from "react";
import type { ElePayRecord, EleRemainder } from "@onethu/core";
import { WATER_BRANDS, getWaterUserInformation, submitWaterOrder } from "@onethu/core";
import { Card, Empty, ErrorNote, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { info, logLine } from "../../lib/clients.js";
import { explainNetworkError, universalFetch } from "../../lib/transport.js";
import { useApp } from "../../state/context.js";

function logErr(tag: string, err: unknown): void {
  void logLine(
    "PAGE-ERR " + tag + " " + (err instanceof Error ? err.message : String(err)),
  ).catch(() => undefined);
}

interface ElecBundle {
  remainder: EleRemainder;
  records: ElePayRecord[];
}

type LoadState = "loading" | "error" | "ready";

/** 缴费状态徽标（getElePayRecord 严格过滤后的三种合法状态） */
const STATUS_CHIP: Record<string, string> = {
  已成功: "chip chip-green",
  已失败: "chip chip-red",
  处理中: "chip chip-amber",
};

export function DormTab() {
  const { status } = useApp();

  /* ---------------- 电费（家园网会话） ---------------- */
  const [elec, setElec] = useState<ElecBundle | null>(null);
  const [elecState, setElecState] = useState<LoadState>("loading");
  const [elecError, setElecError] = useState<string | null>(null);

  const loadElec = useCallback(async () => {
    if (status !== "ready") return;
    setElecState("loading");
    setElecError(null);
    try {
      const remainder = await info.getEleRemainder();
      // 缴费记录失败不影响余额展示（dorm.ts 两个端点相互独立）
      const records = await info.getElePayRecord().catch((err: unknown) => {
        logErr("ELE-RECORD", err);
        return [] as ElePayRecord[];
      });
      setElec({ remainder, records });
      setElecState("ready");
    } catch (err) {
      logErr("ELEC", err);
      setElecState("error");
      setElecError(explainNetworkError(err));
    }
  }, [status]);

  useEffect(() => {
    void loadElec();
  }, [loadElec]);

  /* ---------------- 订水（公开接口） ---------------- */
  const [waterId, setWaterId] = useState("");
  const [contact, setContact] = useState("");
  const [address, setAddress] = useState("");
  const [brand, setBrand] = useState("6");
  const [num, setNum] = useState("1");
  const [num1, setNum1] = useState("0");
  const [waterState, setWaterState] = useState<"idle" | "busy" | "ok" | "error">("idle");
  const [waterMsg, setWaterMsg] = useState("");

  const queryWater = async (): Promise<void> => {
    if (!waterId.trim()) {
      setWaterState("error");
      setWaterMsg("请输入订水编号");
      return;
    }
    setWaterState("busy");
    setWaterMsg("");
    try {
      const u = await getWaterUserInformation(universalFetch, waterId);
      setContact(u.name ?? "");
      setAddress(u.address ?? "");
      setWaterState("ok");
      setWaterMsg(u.name || u.address ? "已载入联系人/地址" : "水站未返回该编号信息，可手动填写");
    } catch (err) {
      logErr("WATER-Q", err);
      setWaterState("error");
      setWaterMsg(explainNetworkError(err));
    }
  };

  const submitWater = async (): Promise<void> => {
    if (!waterId.trim() || !address.trim()) {
      setWaterState("error");
      setWaterMsg("订水编号与送达地址必填");
      return;
    }
    setWaterState("busy");
    setWaterMsg("");
    try {
      await submitWaterOrder(universalFetch, { id: waterId, num, num1, lid: brand, address });
      setWaterState("ok");
      setWaterMsg("订水提交成功");
    } catch (err) {
      logErr("WATER-SUB", err);
      setWaterState("error");
      setWaterMsg(explainNetworkError(err));
    }
  };

  if (status === "demo") {
    return <Empty text="演示模式不提供宿舍数据，登录后可查询电费与订水。" />;
  }

  return (
    <>
      <SectionHead title="电费" aside="家园网 myhome.tsinghua.edu.cn · 宿舍绑定房间" />
      {elecState === "error" ? (
        <ErrorNote text={elecError ?? ""} onRetry={() => void loadElec()} />
      ) : null}
      {elecState === "loading" && !elec ? (
        <SkeletonRows rows={2} />
      ) : elec ? (
        <>
          <div className="stats stats-hero">
            <Card className="card-hero">
              <div className="card-hero-main">
                <div>
                  <div className="card-hero-amount">
                    {Number.isFinite(elec.remainder.remainder) ? elec.remainder.remainder : "–"}
                    <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 6 }}>度</span>
                  </div>
                  <div className="stat-label">宿舍剩余电量</div>
                </div>
              </div>
              <div className="card-hero-meta">
                <span>抄表时间：{elec.remainder.updateTime || "–"}</span>
              </div>
              <button
                className="btn btn-ghost"
                style={{ position: "absolute", right: 14, top: 14 }}
                onClick={() => void loadElec()}
                disabled={elecState === "loading"}
              >
                刷新
              </button>
            </Card>
          </div>
          <SectionHead title="缴费记录" aside="Netweb 缴费流水" />
          {elec.records.length === 0 ? (
            <Card>
              <Empty text="暂无缴费记录。" />
            </Card>
          ) : (
            <Card className="list">
              {elec.records.map((r, i) => (
                <div className="row" key={`${r.id}-${i}`}>
                  <span className={STATUS_CHIP[r.status] ?? "chip chip-gray"}>{r.status || "缴费"}</span>
                  <div className="row-main">
                    <div className="row-title">{r.name || "电费充值"}</div>
                    <div className="row-sub">
                      {r.time || "–"}
                      {r.channel ? ` · ${r.channel}` : ""}
                    </div>
                  </div>
                  <div className="row-amount">
                    <b>{r.value || "–"}</b>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </>
      ) : null}

      <SectionHead title="订水" aside="清华水站 dingshui.bjqzhd.com · 公开接口" />
      <Card>
        <div className="field">
          <label htmlFor="water-id">订水编号（水站用户编号）</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              id="water-id"
              className="input"
              value={waterId}
              onChange={(e) => setWaterId(e.target.value)}
              placeholder="水站发票/标签上的用户编号"
            />
            <button className="btn" onClick={() => void queryWater()} disabled={waterState === "busy"}>
              查询
            </button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="water-contact">联系人</label>
            <input id="water-contact" className="input" value={contact} onChange={(e) => setContact(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="water-num">订水量（桶）</label>
            <input id="water-num" className="input" type="number" min={1} value={num} onChange={(e) => setNum(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="water-num1">水票数</label>
            <input id="water-num1" className="input" type="number" min={0} value={num1} onChange={(e) => setNum1(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="water-brand">水种</label>
          <select id="water-brand" className="input" value={brand} onChange={(e) => setBrand(e.target.value)}>
            {Object.entries(WATER_BRANDS).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="water-addr">送达地址（楼栋 + 房间号）</label>
          <input
            id="water-addr"
            className="input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="如：紫荆 1 号楼 301A"
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="btn btn-primary" onClick={() => void submitWater()} disabled={waterState === "busy"}>
            {waterState === "busy" ? "提交中…" : "提交订水"}
          </button>
          {waterMsg ? (
            <span className={waterState === "error" ? "t-red" : ""} style={{ fontSize: 13 }}>
              {waterMsg}
            </span>
          ) : null}
        </div>
      </Card>
    </>
  );
}
