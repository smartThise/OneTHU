/**
 * 校园卡页 —— getCardInfo + getCardTransactions（thu-info-lib card.ts 移植）。
 * 余额与卡状态置顶；最近 30 天消费流水；充值（cardRechargeFromBank /
 * cardRechargeQrcode，链路逐条移植自 thu-info-lib）。
 * 金额约定（thu-info-app expenditure.tsx 实证）：服务端金额恒为正，
 * 按「名称」分类——充值/圈存/补助=收入（+绿），其余=消费（−红）。
 *
 * 充值安全红线（支付链路）：
 * - 本应用只「下单 + 展示官方收款链」，支付动作完全发生在支付宝/微信/银行侧，不经手资金；
 * - 下单请求不自动重试；响应（学号/收款链接）不写入任何调试日志；
 * - 二次确认明示金额与方式；结果以校园卡余额/流水为准，UI 不宣称「已到账」。
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import type { CardTransaction } from "@onethu/core";
import { Card, Empty, ErrorNote, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { IconCard } from "../../components/Icons.js";
import { useApp } from "../../state/context.js";
import { useCard } from "../../state/data.js";
import { info } from "../../lib/clients.js";
import { openAlipayDeepLink, openExternal } from "./openExternal.js";

/** 移动端判定（安卓 WebView UA 恒含 Android）：决定出「调起支付宝」还是纯扫码 UI */
const isAndroid = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);

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

/* ---------------- 充值弹窗（form → confirm → qr / bankDone） ---------------- */

type RchChannel = "alipay" | "wechat" | "bank";
type RchStep = "form" | "confirm" | "qr" | "bankDone";

const RCH_CHANNELS: Array<{ key: RchChannel; label: string; hint: string }> = [
  { key: "alipay", label: "支付宝", hint: "生成官方收款码，手机支付宝扫码支付" },
  { key: "wechat", label: "微信", hint: "生成微信收银台二维码，手机微信扫码支付" },
  { key: "bank", label: "银行卡圈存", hint: "从卡系统绑定的银行卡直接划转（限 6:00~20:40）" },
];

const maskStyle: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 };
const panelStyle: React.CSSProperties = { width: "100%", maxWidth: 380, maxHeight: "78vh", overflowY: "auto", background: "var(--bg-elev, #ffffff)", color: "var(--text, #1f2329)", borderRadius: 14, boxShadow: "0 18px 50px rgba(0,0,0,.28)", padding: "16px 18px" };

function RechargeDialog({ open, onClose, onPaid }: { open: boolean; onClose: () => void; onPaid: () => void }) {
  const [step, setStep] = useState<RchStep>("form");
  const [amount, setAmount] = useState("50");
  const [channel, setChannel] = useState<RchChannel>("alipay");
  const [webUrl, setWebUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!open) return null;

  const amt = Number(amount);
  const valid = Number.isFinite(amt) && amt >= 1 && amt <= 1000 && Math.round(amt * 100) === amt * 100;
  const close = () => {
    setStep("form");
    setErr("");
    setWebUrl("");
    setBusy(false);
    onClose();
  };
  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      if (channel === "bank") {
        await info.cardRechargeFromBank(amt);
        setStep("bankDone");
        onPaid();
      } else {
        setWebUrl(await info.cardRechargeQrcode(amt, channel));
        setStep("qr");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div style={maskStyle} onClick={close}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <b>校园卡充值</b>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={close}>✕</button>
        </div>

        {step === "form" ? (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              {[20, 50, 100, 200].map((v) => (
                <button key={v} className={`btn${amount === String(v) ? " btn-primary" : ""}`} style={{ flex: 1 }} onClick={() => setAmount(String(v))}>¥{v}</button>
              ))}
            </div>
            <input
              className="input"
              inputMode="decimal"
              placeholder="自定义金额（1 ~ 1000 元）"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={{ marginBottom: 10 }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
              {RCH_CHANNELS.map((c) => (
                <label key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                  <input type="radio" checked={channel === c.key} onChange={() => setChannel(c.key)} />
                  <span>
                    <b>{c.label}</b>
                    <span style={{ opacity: 0.6 }}> · {c.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {err ? <div style={{ color: "#d33", fontSize: 12, marginBottom: 8 }}>{err}</div> : null}
            <button className="btn btn-primary" style={{ width: "100%" }} disabled={!valid || busy} onClick={() => setStep("confirm")}>
              下一步
            </button>
            {!valid ? <div style={{ fontSize: 11, opacity: 0.55, marginTop: 6 }}>金额需为 1 ~ 1000 元（最多两位小数）</div> : null}
          </>
        ) : null}

        {step === "confirm" ? (
          <>
            <div style={{ fontSize: 14, lineHeight: 1.8, marginBottom: 10 }}>
              确认为校园卡充值 <b style={{ color: "var(--accent)" }}>¥{amt.toFixed(2)}</b>（{RCH_CHANNELS.find((c) => c.key === channel)?.label}）？
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                {channel === "bank"
                  ? "圈存资金从卡系统绑定的银行卡直接划转，仅限 6:00~20:40。"
                  : "下一步将生成官方收款码，支付在支付宝/微信 App 内完成，本应用不经手资金。"}
              </div>
            </div>
            {err ? <div style={{ color: "#d33", fontSize: 12, marginBottom: 8 }}>{err}</div> : null}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" style={{ flex: 1 }} disabled={busy} onClick={() => setStep("form")}>返回</button>
              <button className="btn btn-primary" style={{ flex: 2 }} disabled={busy} onClick={() => void submit()}>
                {busy ? "下单中…" : "确认"}
              </button>
            </div>
          </>
        ) : null}

        {step === "qr" ? (
          <>
            <div style={{ textAlign: "center", marginBottom: 10 }}>
              <div style={{ background: "#fff", display: "inline-block", padding: 10, borderRadius: 10 }}>
                <QRCodeSVG value={webUrl} size={176} level="M" />
              </div>
              <div style={{ fontSize: 13, marginTop: 8 }}>
                请用<b>{channel === "alipay" ? "支付宝" : "微信"}</b>扫码支付 ¥{amt.toFixed(2)}
              </div>
              <div style={{ fontSize: 11, opacity: 0.55, wordBreak: "break-all", marginTop: 4 }}>到账通常实时，请以校园卡余额为准</div>
            </div>
            {err ? <div style={{ color: "#d33", fontSize: 12, marginBottom: 8 }}>{err}</div> : null}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {channel === "alipay" && isAndroid ? (
                <button
                  className="btn btn-primary"
                  onClick={async () => {
                    const ok = await openAlipayDeepLink(webUrl);
                    if (!ok) setErr("未检测到支付宝 App，请用另一台手机扫码支付");
                  }}
                >
                  调起支付宝 App 支付
                </button>
              ) : null}
              {webUrl.startsWith("http") ? (
                <button className="btn" onClick={() => void openExternal(webUrl)}>
                  {channel === "wechat" && isAndroid ? "在浏览器打开（微信支付）" : "在浏览器打开收款页"}
                </button>
              ) : null}
              <button
                className={channel === "alipay" && isAndroid ? "btn" : "btn btn-primary"}
                onClick={() => { onPaid(); close(); }}
              >
                我已完成支付，刷新余额
              </button>
            </div>
          </>
        ) : null}

        {step === "bankDone" ? (
          <>
            <div style={{ fontSize: 13, lineHeight: 1.8, marginBottom: 10 }}>
              圈存请求已提交。资金到账以校园卡<b>余额 / 流水</b>为准；若未到账请稍后在「最近消费」中查看圈存记录。
            </div>
            <button className="btn btn-primary" style={{ width: "100%" }} onClick={close}>好的</button>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/* --------------------------------- 主组件 --------------------------------- */

export function CardTab({ active = true }: { active?: boolean }) {
  const { status } = useApp();
  const { data, state, error, reload } = useCard(30);
  const [rchOpen, setRchOpen] = useState(false);
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
            {status !== "demo" ? (
              <button className="btn btn-primary" style={{ marginLeft: "auto", height: 30 }} onClick={() => setRchOpen(true)}>
                充值
              </button>
            ) : null}
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
            <div className="stat-num">¥{spent.toFixed(2)}</div>
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
                  {signedAmount(t) < 0 ? "−" : "+"}¥{Math.abs(signedAmount(t)).toFixed(2)}
                </b>
              </div>
            </div>
          ))}
        </Card>
      )}

      <RechargeDialog open={rchOpen} onClose={() => setRchOpen(false)} onPaid={() => void reload()} />
    </>
  );
}
