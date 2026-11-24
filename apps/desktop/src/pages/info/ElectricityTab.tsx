import type { ReactElement } from "react";
import { t as i18n, useLocale as useUiLocale } from "../../i18n/index.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import { isAuthError, type ElePayRecord, type EleRemainder } from "@onethu/core";
import { Card, Empty, ErrorNote, ListWindow, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { Btn, Input } from "@onethu/gui";
import { IconBolt, IconCard, IconRefresh } from "../../components/Icons.js";
import { info, logLine } from "../../lib/clients.js";
import { helper } from "../../lib/infoLib.js";
import { isAndroidNavigator } from "../../lib/androidHost.js";
import { openAlipayDeepLink, openExternal } from "./openExternal.js";
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

type EleStep = "form" | "qr";

/** 电费充值：info-lib 的 getEleRechargePayCode 直接生成支付宝 pay code。
 *  支付链路只做「下单 → 二维码」，结果以家园网到账为准；不自动重试。 */
function EleRechargeDialog({ open, onClose, onPaid }: { open: boolean; onClose: () => void; onPaid: () => void }): ReactElement | null {
  const [step, setStep] = useState<EleStep>("form");
  const [amount, setAmount] = useState("50");
  const [payUrl, setPayUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const amt = Number(amount);
  const valid = Number.isInteger(amt) && amt >= 10 && amt <= 1000;
  const isAndroid = isAndroidNavigator(typeof navigator !== "undefined" ? navigator : undefined);
  useEffect(() => {
    if (!open) return;
    setStep("form"); setAmount("50"); setPayUrl(""); setBusy(false); setErr("");
  }, [open]);
  if (!open) return null;
  const submit = async (): Promise<void> => {
    if (!valid || busy) return;
    setBusy(true); setErr("");
    try {
      const code = await helper.getEleRechargePayCode(amt);
      const codeText = String(code ?? "").trim();
      if (!codeText) throw new Error(i18n("pages.info.dormtab.4185184229fa"));
      setPayUrl(codeText.startsWith("http") ? codeText : `https://qr.alipay.com/${encodeURIComponent(codeText)}`);
      setStep("qr");
    } catch (e) {
      setErr(explainNetworkError(e));
    } finally {
      setBusy(false);
    }
  };
  return createPortal(
    <div className="rch-mask" style={{ position: "fixed", inset: 0, background: "var(--og-scrim)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={onClose}>
      <div className="rch-panel" style={{ width: "100%", maxWidth: 380, maxHeight: "78vh", overflowY: "auto", background: "var(--og-surface-overlay)", color: "var(--og-content-1)", borderRadius: "var(--og-radius-xl)", boxShadow: "var(--og-elev-menu)", padding: "16px 18px" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <b>{i18n("pages.info.dormtab.f06a3f64f717")}</b><span style={{ flex: 1 }} />
          <Btn variant="outline" onClick={onClose}>✕</Btn>
        </div>
        {step === "form" ? (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              {[20, 50, 100, 200].map((v) => (
                <button key={v} className={`btn${amount === String(v) ? " btn-primary" : ""}`} style={{ flex: 1 }} onClick={() => setAmount(String(v))}>¥{v}</button>
              ))}
            </div>
            <label htmlFor="ele-rch-amount" style={{ display: "block", fontSize: 12, color: "var(--text-2)", marginBottom: 4 }}>{i18n("pages.info.dormtab.c7aab75d07c4")}</label>
            <div className="elec-rch-amount">
              <Input id="ele-rch-amount" inputMode="numeric" placeholder={i18n("pages.info.dormtab.a9897ad6c436")} value={amount} onChange={(value) => setAmount(value)} />
            </div>
            {!valid ? <div style={{ fontSize: 12, color: "var(--red, #c04848)", margin: "8px 0" }}>{i18n("pages.info.dormtab.4185184229fa")}</div> : null}
            {err ? <div style={{ color: "#d33", fontSize: 12, marginBottom: 8 }}>{err}</div> : null}
            <Btn variant="solid" tone="brand" disabled={!valid || busy} onClick={() => void submit()}>{busy ? i18n("pages.info.cardtab.bc1beaa93a7d") : i18n("pages.info.dormtab.c354a744b8cc")}</Btn>
            <div style={{ fontSize: 11, opacity: 0.55, marginTop: 8 }}>{i18n("pages.info.dormtab.b83be644b065")}</div>
          </>
        ) : (
          <>
            <div style={{ textAlign: "center", marginBottom: 10 }}>
              <div style={{ background: "#fff", display: "inline-block", padding: 10, borderRadius: 10 }}><QRCodeSVG value={payUrl} size={176} level="M" /></div>
              <div style={{ fontSize: 13, marginTop: 8 }}>{i18n("pages.info.dormtab.9739c55bbbf4")}</div>
              <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4 }}>{i18n("pages.info.dormtab.b83be644b065")}</div>
            </div>
            {err ? <div style={{ color: "#d33", fontSize: 12, marginBottom: 8 }}>{err}</div> : null}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {isAndroid ? <Btn variant="solid" tone="brand" onClick={async () => { if (!await openAlipayDeepLink(payUrl)) setErr(i18n("pages.info.cardtab.02defd2c3032")); }}>{i18n("pages.info.cardtab.6fe44db82dfb")}</Btn> : null}
              <Btn variant="outline" onClick={() => void openExternal(payUrl)}>{i18n("pages.info.cardtab.d4507373a0ce")}</Btn>
              <Btn variant="outline" onClick={() => { onPaid(); onClose(); }}>{i18n("pages.info.cardtab.02b9568dd9b0")}</Btn>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function ElectricityTab(): ReactElement {
  const uiLocale = useUiLocale();

  const { status } = useApp();
  const wide = useWideCardLayout();
  const [rchOpen, setRchOpen] = useState(false);

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
    <>
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
              <div className="stats stats-hero">
                <Card className="card-hero">
                  <div className="card-hero-main">
                    <span className="stat-icon amber"><IconBolt width={17} height={17} /></span>
                    <div>
                      <div className="card-hero-amount">
                        {Number.isFinite(remainder.remainder) ? remainder.remainder.toFixed(2) : "–"}
                        <span className="elec-unit">{i18n("pages.info.dormtab.e24a9725df82")}</span>
                      </div>
                      <div className="stat-label">{i18n("pages.info.dormtab.90f23f891fd1")}</div>
                    </div>
                    <Btn variant="solid" tone="brand" onClick={() => setRchOpen(true)}>{i18n("pages.info.dormtab.f06a3f64f717")}</Btn>
                    <Btn variant="outline" onClick={() => { void loadBalance(); void loadRecords(); }}>{i18n("pages.info.cardtab.aee887434131")}</Btn>
                  </div>
                  <div className="card-hero-meta">
                    <span>{remainder.updateTime
                      ? i18n("pages.info.dormtab.6f97390b28f3", { time: String(remainder.updateTime) })
                      : i18n("pages.info.dormtab.a0d22c766730")}</span>
                  </div>
                </Card>
                <Card className="stat-card">
                  <span className="stat-icon amber"><IconCard width={17} height={17} /></span>
                  <div>
                    <div className="stat-num">¥{recentRecharge.toFixed(2)}</div>
                    <div className="stat-label">{i18n("pages.info.dormtab.b55720d8da5e")}</div>
                  </div>
                </Card>
                <Card className="stat-card">
                  <span className="stat-icon green"><IconRefresh width={17} height={17} /></span>
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
      <EleRechargeDialog open={rchOpen} onClose={() => setRchOpen(false)} onPaid={() => { void loadBalance(); void loadRecords(); }} />
    </>
  );
}
