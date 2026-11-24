import type { ReactElement } from "react";
import { t as i18n, useLocale as useUiLocale } from "../../i18n/index.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAuthError, type ElePayRecord, type EleRemainder } from "@onethu/core";
import { Card, Empty, ErrorNote, ListWindow, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { info, logLine } from "../../lib/clients.js";
import { explainNetworkError } from "../../lib/transport.js";
import { useApp } from "../../state/context.js";
import { recoverCampusSession, softRecover } from "../../lib/reload.js";
import { cacheGet, cacheSet } from "../../state/cache.js";

function logErr(tag: string, err: unknown): void {
  void logLine("PAGE-ERR " + tag + " " + (err instanceof Error ? err.message : String(err))).catch(() => undefined);
}
type LoadState = "loading" | "error" | "ready";
const STATUS_CHIP: Record<string, string> = { 已成功: "chip chip-green", 已失败: "chip chip-red", 处理中: "chip chip-amber" };
const ELEC_KEY = "dorm:elec.v2";
const ELEC_BALANCE_KEY = "dorm:elec.balance.v1";
const ELEC_TTL = 5 * 60 * 1000;

function useWideCardLayout(): boolean {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(min-width: 1024px)").matches);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = (): void => setWide(mq.matches);
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);
  return wide;
}

export function ElectricityTab(): ReactElement {
  const uiLocale = useUiLocale();

  const { status } = useApp();
  const wide = useWideCardLayout();

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

  /** 左卡指标：近 30 天充值金额（从现有缴费流水派生；用电量接口未提供，不伪造）。 */
  const recentRecharge = useMemo(() => {
    const from = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let sum = 0;
    for (const r of records ?? []) {
      const at = Date.parse(r.time.replace(/-/g, "/"));
      if (!Number.isFinite(at) || at < from) continue;
      const amount = Number(String(r.value).replace(/[^\d.-]/g, ""));
      if (Number.isFinite(amount)) sum += Math.abs(amount);
    }
    return sum;
  }, [records, uiLocale]);

  return (
      <div className="dorm-elec card-two-col" data-sec="ele">
        <div className="card-col-main">
          <SectionHead title={i18n("pages.info.dormtab.ab8cff9a597a")} aside={i18n("pages.info.dormtab.a0d22c766730")} />
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
            <>
              <Card className="elec-hero">
                <div className="elec-hero-label">{i18n("pages.info.dormtab.90f23f891fd1")}</div>
                <div className="elec-hero-value">
                  {Number.isFinite(remainder.remainder) ? remainder.remainder.toFixed(2) : "–"}
                  <span className="elec-unit">{i18n("pages.info.dormtab.e24a9725df82")}</span>
                </div>
                <div className="elec-hero-meta">
                  {remainder.updateTime
                    ? i18n("pages.info.dormtab.6f97390b28f3", { time: String(remainder.updateTime) })
                    : i18n("pages.info.dormtab.a0d22c766730")}
                </div>
              </Card>
              <div className="elec-metrics">
                <Card className="stat-card">
                  <div>
                    <div className="stat-num">¥{recentRecharge.toFixed(2)}</div>
                    <div className="stat-label">{i18n("pages.info.dormtab.b55720d8da5e")}</div>
                  </div>
                </Card>
                <Card className="stat-card">
                  <div>
                    <div className="stat-num">{records?.length ?? "—"}</div>
                    <div className="stat-label">{i18n("pages.info.dormtab.f940c740fd14")}</div>
                  </div>
                </Card>
              </div>
            </>
          ) : (
            <Card>
              <Empty text={i18n("pages.info.dormtab.5a62d9779585")} />
            </Card>
          )}
        </div>

        <div className="card-col-side">
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
            wide ? (
              <ListWindow fill>{records.map((r, i) => (
                <div className="row" key={`${r.id}-${i}`}>
                  <span className={STATUS_CHIP[r.status] ?? "chip chip-gray"}>{r.status || i18n("pages.info.dormtab.658c536de644")}</span>
                  <div className="row-main"><div className="row-title">{r.name || i18n("pages.info.dormtab.f06a3f64f717")}</div><div className="row-sub">{r.time || "–"}{r.channel ? ` · ${r.channel}` : ""}</div></div>
                  <div className="row-amount"><b>{r.value || "–"}</b></div>
                </div>
              ))}</ListWindow>
            ) : (
              <Card className="list">{records.map((r, i) => (
                <div className="row" key={`${r.id}-${i}`}>
                  <span className={STATUS_CHIP[r.status] ?? "chip chip-gray"}>{r.status || i18n("pages.info.dormtab.658c536de644")}</span>
                  <div className="row-main"><div className="row-title">{r.name || i18n("pages.info.dormtab.f06a3f64f717")}</div><div className="row-sub">{r.time || "–"}{r.channel ? ` · ${r.channel}` : ""}</div></div>
                  <div className="row-amount"><b>{r.value || "–"}</b></div>
                </div>
              ))}</Card>
            )
          ) : (
            <Card>
              <Empty text={i18n("pages.info.dormtab.d962ed9d270e")} />
            </Card>
          )}
        </div>
      </div>
  );
}
