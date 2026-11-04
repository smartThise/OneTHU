import { t as i18n, useLocale as useUiLocale } from "../../i18n/index.js";
import { Btn } from "@onethu/gui";
import { Input } from "@onethu/gui";
import { Select } from "@onethu/gui";
/**
 * 宿舍页 —— 电费余额/缴费记录 + 订水。
 * - 电费：thu-info-lib dorm.ts 移植（家园网 myhome 会话，ELE_REMAINDER / ELE_PAY_RECORD）；
 *   余额卡自动加载，缴费记录失败降级为空列表（余额为准）。
 * - 订水：thu-info-app network/water.ts 移植（清华水站 dingshui.bjqzhd.com 公开接口），
 *   订水编号查询联系人/地址后提交；dorm.ts 内无订水端点，端点以 RN 端 network/water.ts 为准。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ElePayRecord, EleRemainder } from "@onethu/core";
import { WATER_BRANDS, getWaterUserInformation, isAuthError, submitWaterOrder } from "@onethu/core";
import { Card, Empty, ErrorNote, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { info, logLine } from "../../lib/clients.js";
import { explainNetworkError, universalFetch } from "../../lib/transport.js";
import { useApp } from "../../state/context.js";
import { recoverCampusSession, softRecover } from "../../lib/reload.js";
import { cacheGet, cacheSet } from "../../state/cache.js";

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

const ELEC_KEY = "dorm:elec.v2";
const ELEC_BALANCE_KEY = "dorm:elec.balance.v1";
const ELEC_TTL = 5 * 60 * 1000;

export function DormTab({ deepSection }: { deepSection?: "ele" | "water" } = {}) {
  const uiLocale = useUiLocale();

  const { status } = useApp();

  /* ---------------- 电费余额（家园网 ELE_REMAINDER） ----------------
   * 2026-11-03：用户确认余额页可用（统一认证登录家园网后），恢复请求；
   * 旧注释“接口长期不可用”已过时。余额与充值记录各自缓存/恢复。 */
  const [remainder, setRemainder] = useState<EleRemainder | null>(() => cacheGet<EleRemainder>(ELEC_BALANCE_KEY)?.data ?? null);
  const [balanceState, setBalanceState] = useState<LoadState>(() => (cacheGet<EleRemainder>(ELEC_BALANCE_KEY) ? "ready" : "loading"));
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const balanceRecover = useRef(0);

  const loadBalance = useCallback(async (silent = false) => {
    if (status !== "ready") return;
    if (!silent) {
      setBalanceState("loading");
      setBalanceError(null);
    }
    try {
      const next = await info.getEleRemainder();
      cacheSet(ELEC_BALANCE_KEY, next);
      balanceRecover.current = 0;
      setRemainder(next);
      setBalanceState("ready");
    } catch (err) {
      logErr("ELE-BALANCE", err);
      if (isAuthError(err) && (await recoverCampusSession("dorm"))) return loadBalance();
      if (isAuthError(err) && (await softRecover("dorm"))) return loadBalance();
      if (isAuthError(err) && balanceRecover.current < 1) {
        balanceRecover.current += 1;
        await info.forceEnsure("dorm").catch((renewErr: unknown) => {
          logErr("ELEC-BALANCE-RENEW", renewErr);
        });
        return loadBalance();
      }
      if (silent && remainder !== null) return;
      setBalanceState("error");
      setBalanceError(explainNetworkError(err));
    }
  }, [status, remainder]);

  useEffect(() => {
    if (status !== "ready") return;
    const cached = cacheGet<EleRemainder>(ELEC_BALANCE_KEY);
    if (!cached) void loadBalance(false);
    else if (Date.now() - cached.at > ELEC_TTL) void loadBalance(true);
  }, [status, loadBalance]);

  /* ---------------- 充值记录（家园网会话 + SWR 缓存） ---------------- */
  const [records, setRecords] = useState<ElePayRecord[] | null>(() => cacheGet<ElePayRecord[]>(ELEC_KEY)?.data ?? null);
  const [recState, setRecState] = useState<LoadState>(() => (cacheGet<ElePayRecord[]>(ELEC_KEY) ? "ready" : "loading"));
  const [recError, setRecError] = useState<string | null>(null);
  /* 登录态丢失静默自愈：成功清零，同一次失败最多自动恢复 1 次（手动重试清零重计） */
  const elecRecover = useRef(0);

  const loadRecords = useCallback(async (silent = false) => {
    if (status !== "ready") return;
    if (!silent) {
      setRecState("loading");
      setRecError(null);
    }
    try {
      const recs = await info.getElePayRecord();
      cacheSet(ELEC_KEY, recs);
      elecRecover.current = 0;
      setRecords(recs);
      setRecState("ready");
    } catch (err) {
      logErr("ELE-RECORD", err);
      // 登录态丢失：不闪红，静默强制重建家园网会话后自动重载一次；仍失败才亮 ErrorNote
      // 登录态丢失：softRelogin 透明全链重建 → 原地重拉
      if (isAuthError(err) && (await recoverCampusSession("dorm"))) return loadRecords();
      if (isAuthError(err) && (await softRecover("dorm"))) return loadRecords();
      // softRecover 失败/节流 → 落回数据级恢复兜底
      if (isAuthError(err) && elecRecover.current < 1) {
        elecRecover.current += 1;
        await info.forceEnsure("dorm").catch((renewErr: unknown) => {
          logErr("ELEC-RENEW", renewErr);
        });
        return loadRecords();
      }
      // 已有旧数据（缓存/上次成功）时不闪红：SWR 语义，保留旧值下轮挂载再重验证
      if (silent && records !== null) return;
      setRecState("error");
      setRecError(explainNetworkError(err));
    }
  }, [status, records]);

  useEffect(() => {
    if (status !== "ready") return;
    const cached = cacheGet<ElePayRecord[]>(ELEC_KEY);
    if (!cached) void loadRecords(false);
    else if (Date.now() - cached.at > ELEC_TTL) void loadRecords(true);
  }, [status, loadRecords]);

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
      setWaterMsg(i18n("pages.info.dormtab.e115f82b905e"));
      return;
    }
    setWaterState("busy");
    setWaterMsg("");
    try {
      const u = await getWaterUserInformation(universalFetch, waterId);
      setContact(u.name ?? "");
      setAddress(u.address ?? "");
      setWaterState("ok");
      setWaterMsg(u.name || u.address ? i18n("pages.info.dormtab.3dd6c0cbae44") : i18n("pages.info.dormtab.dd57d5ccb2f3"));
    } catch (err) {
      logErr("WATER-Q", err);
      setWaterState("error");
      setWaterMsg(explainNetworkError(err));
    }
  };

  const submitWater = async (): Promise<void> => {
    if (!waterId.trim() || !address.trim()) {
      setWaterState("error");
      setWaterMsg(i18n("pages.info.dormtab.cdf03a9a9579"));
      return;
    }
    setWaterState("busy");
    setWaterMsg("");
    try {
      await submitWaterOrder(universalFetch, { id: waterId, num, num1, lid: brand, address });
      setWaterState("ok");
      setWaterMsg(i18n("pages.info.dormtab.40819c08f4e1"));
    } catch (err) {
      logErr("WATER-SUB", err);
      setWaterState("error");
      setWaterMsg(explainNetworkError(err));
    }
  };

  /* 电费/订水原子深链：滚动定位对应区块并高亮一次 */
  useEffect(() => {
    if (!deepSection) return;
    const el = document.querySelector<HTMLElement>('[data-sec="' + deepSection + '"]');
    if (!el) return;
    el.classList.add("fav-dl-flash");
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [deepSection]);

  return (
    <>
      <div data-sec="ele">
        <SectionHead title={i18n("pages.info.dormtab.ab8cff9a597a")} aside={i18n("pages.info.dormtab.a0d22c766730")} />
      </div>
      {balanceState === "error" ? (
        <ErrorNote
          text={balanceError ?? ""}
          onRetry={() => {
            balanceRecover.current = 0;
            void loadBalance();
          }}
        />
      ) : balanceState === "loading" && remainder === null ? (
        <SkeletonRows rows={1} />
      ) : remainder ? (
        <Card className="elec-balance-card">
          <div className="row">
            <div className="row-main">
              <div className="row-title">{i18n("pages.info.dormtab.90f23f891fd1")}</div>
              <div className="row-sub">
                {remainder.updateTime
                  ? i18n("pages.info.dormtab.6f97390b28f3", { time: String(remainder.updateTime) })
                  : i18n("pages.info.dormtab.a0d22c766730")}
              </div>
            </div>
            <div className="row-amount">
              <b>{Number.isFinite(remainder.remainder) ? remainder.remainder.toFixed(2) : "–"}</b>
              <span className="elec-unit">{i18n("pages.info.dormtab.e24a9725df82")}</span>
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <Empty text={i18n("pages.info.dormtab.5a62d9779585")} />
        </Card>
      )}
      <SectionHead title={i18n("pages.info.dormtab.3da69f3bb5a2")} aside={i18n("pages.info.dormtab.337269e5b07c")} />
      {recState === "error" ? (
        <ErrorNote
          text={recError ?? ""}
          onRetry={() => {
            elecRecover.current = 0;
            void loadRecords();
          }}
        />
      ) : null}
      {recState === "loading" && records === null ? (
        <SkeletonRows rows={2} />
      ) : records && records.length > 0 ? (
        <Card className="list">
          {records.map((r, i) => (
            <div className="row" key={`${r.id}-${i}`}>
              <span className={STATUS_CHIP[r.status] ?? "chip chip-gray"}>{r.status || i18n("pages.info.dormtab.658c536de644")}</span>
              <div className="row-main">
                <div className="row-title">{r.name || i18n("pages.info.dormtab.f06a3f64f717")}</div>
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
      ) : (
        <Card>
          <Empty text={i18n("pages.info.dormtab.d962ed9d270e")} />
        </Card>
      )}

      <div data-sec="water">
        <SectionHead title={i18n("pages.info.dormtab.bb8c939d0fcd")} aside={i18n("pages.info.dormtab.8d6ebc4e3453")} />
      </div>
      <Card style={{ padding: 18 }}>
        <div className="field">
          <label htmlFor="water-id">{i18n("pages.info.dormtab.fbfad2e4053e")}</label>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>{<Input value={waterId} onChange={(value) => setWaterId(value)} placeholder={i18n("pages.info.dormtab.c3fc6114b55c")} />}</div>
            <Btn variant="outline" onClick={() => void queryWater()} disabled={waterState === "busy"}>{i18n("pages.info.dormtab.bcd6771e08ec")}</Btn>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0 14px" }}>
          <div className="field">
            <label htmlFor="water-contact">{i18n("pages.info.dormtab.3303b56982a0")}</label>
            <Input value={contact} onChange={(value) => setContact(value)} />
          </div>
          <div className="field">
            <label htmlFor="water-num">{i18n("pages.info.dormtab.6cb5a329f274")}</label>
            <input id="water-num" className="input" type="number" min={1} value={num} onChange={(e) => setNum(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="water-num1">{i18n("pages.info.dormtab.e7d4e116f779")}</label>
            <input id="water-num1" className="input" type="number" min={0} value={num1} onChange={(e) => setNum1(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="water-brand">{i18n("pages.info.dormtab.3a37484d933f")}</label>
          <Select id="water-brand" value={brand} onChange={(value) => setBrand(value)}>{Object.entries(WATER_BRANDS).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}</Select>
        </div>
        <div className="field">
          <label htmlFor="water-addr">{i18n("pages.info.dormtab.d872b26584ac")}</label>
          <Input value={address} onChange={(value) => setAddress(value)} placeholder={i18n("pages.info.dormtab.b09dff2cb1cb")} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Btn variant="solid" tone="brand" onClick={() => void submitWater()} disabled={waterState === "busy"}>{waterState === "busy" ? i18n("pages.info.dormtab.18931020ad52") : i18n("pages.info.dormtab.d189e0a2a1c5")}</Btn>
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
