import { Input } from "@onethu/gui";
import { Btn } from "@onethu/gui";
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
import { Card, Empty, ErrorNote, SectionHead, SkeletonRows, Switch } from "../../components/Layout.js";
import { IconCard } from "../../components/Icons.js";
import { useApp } from "../../state/context.js";
import { useCard } from "../../state/data.js";
import {
  CARD_WARN_MAX_COOLDOWN,
  CARD_WARN_MAX_THRESHOLD,
  applyCardWarnChange,
  cardWarnStatusText,
  loadCardWarnSettings,
  loadCardWarnState,
  saveCardWarnSettings,
  subscribeCardWarn,
  type CardWarnSettings,
} from "../../state/cardWarn.js";
import { info } from "../../lib/clients.js";
import { openAlipayDeepLink, openExternal } from "./openExternal.js";
import { isAndroidNavigator } from "../../lib/androidHost.js";
import { t as i18n } from "../../i18n/index.js";


/** 移动端判定（R21：多信号——主窗口 UA 被伪装成 Windows，裸 UA 正则恒 false，
 *  曾让真机上「调起支付宝」通道从不出现）：决定出「调起支付宝」还是纯扫码 UI */
const isAndroid = isAndroidNavigator(typeof navigator !== "undefined" ? navigator : undefined);

/** 「x 前」相对时间（数据新鲜度展示用；与提醒文案无关，粒度够粗即可） */
function fmtAgo(at: number): string {
  const min = Math.floor((Date.now() - at) / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}
/** 硬过期：超过 6 小时未更新即提示（与 state/data.ts 的 CARD_HARD_STALE 同口径） */
const isStale = (at: number | null): boolean => at !== null && Date.now() - at > 6 * 60 * 60 * 1000;

const incomeRe = /充值|圈存|补助/;
const isIncome = (t: CardTransaction): boolean =>
  incomeRe.test(`${t.name ?? ""} ${t.summary ?? ""} ${t.txName ?? ""}`);
/** 金额取值：缓存/接口给到 null/字符串/NaN 时一律归 0（2026-10-12 校园卡易崩专项：
 *  单个字段异常不该把整页带走——此前 `.toFixed` / `Math.abs(undefined)` 会把整棵
 *  React 树交给根错误边界，用户看到的是「崩了」。 */
const amtOf = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
/** 安全金额文本（null/NaN/字符串都不抛错） */
const money = (v: unknown, digits = 2): string => amtOf(v).toFixed(digits);
const intText = (v: unknown, fallback = "–"): string => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? String(Math.round(n)) : fallback;
};
const signedAmount = (t: CardTransaction): number =>
  isIncome(t) ? Math.abs(amtOf(t.amount)) : -Math.abs(amtOf(t.amount));

function fmtTime(input: Date | string | number | null | undefined): string {
  const d = input instanceof Date ? input : new Date((input ?? NaN) as string | number);
  if (!Number.isFinite(d.getTime())) return "–"; // 时间戳缺失/非法（旧缓存里是字符串）不抛错
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

const maskStyle: React.CSSProperties = { position: "fixed", inset: 0, background: "var(--og-scrim)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 };
const panelStyle: React.CSSProperties = { width: "100%", maxWidth: 380, maxHeight: "78vh", overflowY: "auto", background: "var(--og-surface-overlay)", color: "var(--og-content-1)", borderRadius: "var(--og-radius-xl)", boxShadow: "var(--og-elev-menu)", padding: "16px 18px" };

function RechargeDialog({ open, onClose, onPaid }: { open: boolean; onClose: () => void; onPaid: () => void }) {
  const [step, setStep] = useState<RchStep>("form");
  const [amount, setAmount] = useState("50");
  const [channel, setChannel] = useState<RchChannel>("alipay");
  const [webUrl, setWebUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  /* 退场相位：先播 200ms 淡出再真正关闭（此前无退场动画，弹窗"啪"地消失） */
  const [closing, setClosing] = useState(false);
  // 重新打开必须复位退场相位：父级只把 open 置 false、组件并不卸载，
  // 残留的 closing=true 会让第二次打开后永远关不掉（霖实测）。
  useEffect(() => {
    if (open) setClosing(false);
  }, [open]);
  useEffect(() => {
    if (!open) setClosing(false);
  }, [open]);
  if (!open) return null;

  const amt = Number(amount);
  // 全渠道下限统一 10 元（2026-09-20 定案）：银行卡圈存服务端本就拒 10 元以下
  // （cardpay.inputtxamtgreater10，2026-09-17 实录），微信/支付宝官方收银台同样
  // 起步 10 元（真机实录「至少充 10 块」）——三端统一成一条规则，不再分渠道。
  const minAmt = 10;
  const valid = Number.isFinite(amt) && amt >= minAmt && amt <= 1000 && Math.round(amt * 100) === amt * 100;
  const requestClose = (): void => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => onClose(), 200); // 与 CSS 退场时长一致（--dur-2 = short-4 = 200ms）
  };

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
    // 圈存时段本地预检（6:00~20:40，2026-09-17 21 点实测窗外必拒）：
    // 窗外直接提示，不浪费一次服务端往返
    if (channel === "bank") {
      const h = new Date().getHours() + new Date().getMinutes() / 60;
      if (h < 6 || h >= 20 + 40 / 60) {
        setErr("银行卡圈存限 6:00~20:40：请改用扫码充值，或明天再试。");
        setBusy(false);
        return;
      }
    }
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
    <div className={"rch-mask" + (closing ? " is-closing" : "")} style={maskStyle} onClick={requestClose}>
      <div className={"rch-panel" + (closing ? " is-closing" : "")} style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <b>{i18n("auto.pages.info.CardTab.1")}</b>
          <span style={{ flex: 1 }} />
          <Btn variant="outline" onClick={requestClose}>✕</Btn>
        </div>

        {step === "form" ? (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              {[20, 50, 100, 200].map((v) => (
                <button key={v} className={`btn${amount === String(v) ? " btn-primary" : ""}`} style={{ flex: 1 }} onClick={() => setAmount(String(v))}>¥{v}</button>
              ))}
            </div>
            <Input inputMode="decimal" placeholder={i18n("auto.pages.info.CardTab.2")} value={amount} onChange={(value) => setAmount(value)} />
            {!valid ? (
              <div style={{ fontSize: 12, color: "var(--red, #c04848)", marginBottom: 8 }}>
                {i18n("auto.pages.info.CardTab.3")}</div>
            ) : null}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
              {RCH_CHANNELS.map((c) => (
                <label key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                  <input type="radio" checked={channel === c.key} onChange={() => {
                    setChannel(c.key);
                    if (Number(amount) < 10) setAmount("20"); // 全渠道下限 10 元，低于则抬到 20
                  }} />
                  <span>
                    <b>{c.label}</b>
                    <span style={{ opacity: 0.6 }}> · {c.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {err ? <div style={{ color: "#d33", fontSize: 12, marginBottom: 8 }}>{err}</div> : null}
            <Btn variant="solid" tone="brand" disabled={!valid || busy} onClick={() => setStep("confirm")}>{i18n("auto.pages.info.CardTab.4")}</Btn>
            {!valid ? <div style={{ fontSize: 11, opacity: 0.55, marginTop: 6 }}>{channel === "bank" ? "银行卡圈存最低 10 元；金额需 1 ~ 1000 元（最多两位小数）" : "金额需为 1 ~ 1000 元（最多两位小数）"}</div> : null}
          </>
        ) : null}

        {step === "confirm" ? (
          <>
            <div style={{ fontSize: 14, lineHeight: 1.8, marginBottom: 10 }}>
              {i18n("auto.pages.info.CardTab.5")}<b style={{ color: "var(--accent)" }}>¥{amt.toFixed(2)}</b>（{RCH_CHANNELS.find((c) => c.key === channel)?.label}）？
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                {channel === "bank"
                  ? "圈存资金从卡系统绑定的银行卡直接划转，仅限 6:00~20:40。"
                  : "下一步将生成官方收款码，支付在支付宝/微信 App 内完成，本应用不经手资金。"}
              </div>
            </div>
            {err ? <div style={{ color: "#d33", fontSize: 12, marginBottom: 8 }}>{err}</div> : null}
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="outline" disabled={busy} onClick={() => setStep("form")}>{i18n("auto.pages.info.CardTab.6")}</Btn>
              <Btn variant="solid" tone="brand" disabled={busy} onClick={() => void submit()}>{busy ? "下单中…" : "确认"}</Btn>
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
                {i18n("auto.pages.info.CardTab.7")}<b>{channel === "alipay" ? "支付宝" : "微信"}</b>{i18n("auto.pages.info.CardTab.8")}{amt.toFixed(2)}
              </div>
              <div style={{ fontSize: 11, opacity: 0.55, wordBreak: "break-all", marginTop: 4 }}>{i18n("auto.pages.info.CardTab.9")}</div>
            </div>
            {err ? <div style={{ color: "#d33", fontSize: 12, marginBottom: 8 }}>{err}</div> : null}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {channel === "alipay" && isAndroid ? (
                <Btn variant="solid" tone="brand" onClick={async () => {
                    const ok = await openAlipayDeepLink(webUrl);
                    if (!ok) setErr("未检测到支付宝 App，请用另一台手机扫码支付");
                  }}>{i18n("auto.pages.info.CardTab.10")}</Btn>
              ) : null}
              {webUrl.startsWith("http") ? (
                <Btn variant="outline" onClick={() => void openExternal(webUrl)}>{channel === "wechat" && isAndroid ? "在浏览器打开（微信支付）" : "在浏览器打开收款页"}</Btn>
              ) : null}
              <Btn variant="outline" onClick={() => { onPaid(); close(); }}>{i18n("auto.pages.info.CardTab.11")}</Btn>
            </div>
          </>
        ) : null}

        {step === "bankDone" ? (
          <>
            <div style={{ fontSize: 13, lineHeight: 1.8, marginBottom: 10 }}>
              {i18n("auto.pages.info.CardTab.12")}<b>{i18n("auto.pages.info.CardTab.13")}</b>{i18n("auto.pages.info.CardTab.14")}</div>
            <Btn variant="solid" tone="brand" onClick={requestClose}>{i18n("auto.pages.info.CardTab.15")}</Btn>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------- 余额预警卡 ------------------------------- */

/** 金额输入的统一提交口径：非法输入回落原值，合法值夹到上限内 */
function useNumberDraft(initial: number, commit: (v: number) => void) {
  const [draft, setDraft] = useState(() => String(initial));
  const submit = (min: number, max: number, round = false): void => {
    const raw = Number(draft);
    if (!Number.isFinite(raw)) {
      setDraft(String(initial));
      return;
    }
    let next = Math.min(Math.max(raw, min), max);
    if (round) next = Math.round(next);
    setDraft(String(next));
    if (next !== initial) commit(next);
  };
  return { draft, setDraft, submit };
}

/**
 * 余额预警卡（排在「最近消费」之前）：预警线、提醒冷却与「余额未变化不重复」三个设置，
 * 外加一行当前状态。判定与投递都在 state/cardWarn.ts，这里只负责取值与展示。
 */
function BalanceWarnCard({ balance }: { balance: number | null }) {
  const [s, setS] = useState<CardWarnSettings>(() => loadCardWarnSettings());
  const [st, setSt] = useState(() => loadCardWarnState());

  // 判定发生在取数层（任何一次刷新），状态变化由订阅回传，卡片据此重画状态行
  useEffect(() => subscribeCardWarn(() => setSt(loadCardWarnState())), []);

  const patch = (p: Partial<CardWarnSettings>): void => {
    setS(saveCardWarnSettings(p));
    void applyCardWarnChange(balance);
  };

  const threshold = useNumberDraft(s.threshold, (v) => patch({ threshold: v }));
  const cooldown = useNumberDraft(s.cooldownMin, (v) => patch({ cooldownMin: v }));

  // 打开本栏已拿到余额时按当前设置过一遍：与刷新走同一条判定（冷却与「未变化不重复」照旧生效）。
  // 只跟开关联动——余额变化时判定已由取数层做过，这里再跟一次会与它抢同一毫秒。
  useEffect(() => {
    if (s.enabled) void applyCardWarnChange(balance);
  }, [s.enabled]);

  const status = cardWarnStatusText({ settings: s, state: st, balance, now: Date.now() });

  return (
    <Card className="card-warn">
      <div className="card-warn-head">
        <div>
          <div className="setting-title">{i18n("auto.pages.info.CardTab.16")}</div>
          <div className="setting-desc">{i18n("auto.pages.info.CardTab.17")}</div>
        </div>
        <Switch on={s.enabled} onChange={(v) => patch({ enabled: v })} label={i18n("auto.pages.info.CardTab.16")} />
      </div>

      {s.enabled ? (
        <div className="card-warn-body">
          <div className="card-warn-field">
            <span className="card-warn-label">{i18n("auto.pages.info.CardTab.18")}</span>
            <span className="card-warn-ctl">
              <span className="card-warn-prefix">¥</span>
              <input
                className="input card-warn-num"
                inputMode="decimal"
                aria-label={i18n("auto.pages.info.CardTab.19")}
                value={threshold.draft}
                onChange={(e) => threshold.setDraft(e.target.value)}
                onBlur={() => threshold.submit(0, CARD_WARN_MAX_THRESHOLD)}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              />
            </span>
            <span className="card-warn-unit">{i18n("auto.pages.info.CardTab.20")}</span>
          </div>

          {/* 冷却只在「定时重复」模式下有意义：开着「不重复提醒」时余额一变就立刻提醒，
              冷却设了也不会生效，故直接置灰并说明原因（避免出现「设了没用」的字段） */}
          <div className={"card-warn-field" + (s.skipUnchanged ? " is-off" : "")}>
            <span className="card-warn-label">{i18n("auto.pages.info.CardTab.21")}</span>
            <span className="card-warn-ctl">
              <input
                className="input card-warn-num"
                inputMode="numeric"
                aria-label={i18n("auto.pages.info.CardTab.22")}
                disabled={s.skipUnchanged}
                value={cooldown.draft}
                onChange={(e) => cooldown.setDraft(e.target.value)}
                onBlur={() => cooldown.submit(1, CARD_WARN_MAX_COOLDOWN, true)}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              />
            </span>
            <span className="card-warn-unit">{i18n("auto.pages.info.CardTab.23")}</span>
          </div>

          <div className="card-warn-field">
            <span className="card-warn-label">{i18n("auto.pages.info.CardTab.24")}</span>
            <Switch
              on={s.skipUnchanged}
              onChange={(v) => patch({ skipUnchanged: v })}
              label={i18n("auto.pages.info.CardTab.25")}
            />
            <span className="card-warn-unit">{i18n("auto.pages.info.CardTab.26")}</span>
          </div>
        </div>
      ) : null}

      {s.enabled ? <div className="card-warn-status">{status}</div> : null}
    </Card>
  );
}

/* --------------------------------- 主组件 --------------------------------- */

export function CardTab({ active = true }: { active?: boolean }) {
  const { data, state, error, reload, updatedAt, refreshError } = useCard(30);
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
                {state === "loading" && !data ? "–" : `¥${money(data?.info?.balance)}`}
              </div>
              <div className="stat-label">
                {i18n("auto.pages.info.CardTab.27")}{data?.info.userName || "–"}
                {data?.info.cardStatus ? ` · ${data.info.cardStatus}` : ""}
              </div>
            </div>
            <Btn variant="outline" disabled={state === "loading"} titleAttr={i18n("auto.pages.info.CardTab.28")} onClick={() => void reload()}>{state === "loading" ? "刷新中…" : "刷新"}</Btn>
            <Btn variant="solid" tone="brand" onClick={() => setRchOpen(true)}>{i18n("auto.pages.info.CardTab.29")}</Btn>
          </div>
          <div className="card-hero-meta">
            <span>{i18n("auto.pages.info.CardTab.30")}{data?.info.cardId || "–"}</span>
            {/* R21c：数据时间必须可见——此前用户被旧缓存压着 1–6 天却无从察觉 */}
            {updatedAt ? <span title={new Date(updatedAt).toLocaleString()}>{i18n("auto.pages.info.CardTab.31")}{fmtAgo(updatedAt)}</span> : null}
            {data?.info.departmentName ? <span>{data.info.departmentName}</span> : null}
            {data?.info?.maxOneTimeTransactionAmount != null ? (
              <span>{i18n("auto.pages.info.CardTab.32")}{intText(data.info.maxOneTimeTransactionAmount)}</span>
            ) : null}
            {/* 字段级透明：缺关键字段时明说，而不是让用户以为「卡就是这样」 */}
            {data && (!data.info?.cardId || !data.info?.userName || data.info?.balance == null) ? (
              <span title={i18n("auto.pages.info.CardTab.33")}>
                {i18n("auto.pages.info.CardTab.34")}</span>
            ) : null}
          </div>
        </Card>
        <Card className="stat-card">
          <span className="stat-icon red">
            <IconCard width={17} height={17} />
          </span>
          <div>
            <div className="stat-num">¥{money(spent)}</div>
            <div className="stat-label">{i18n("auto.pages.info.CardTab.35")}</div>
          </div>
        </Card>
        <Card className="stat-card">
          <span className="stat-icon amber">
            <IconCard width={17} height={17} />
          </span>
          <div>
            <div className="stat-num">{(data?.transactions ?? []).length}</div>
            <div className="stat-label">{i18n("auto.pages.info.CardTab.36")}</div>
          </div>
        </Card>
      </div>

      {state === "error" ? <ErrorNote text={error ?? ""} onRetry={() => void reload()} /> : null}
      {state !== "error" && (refreshError || isStale(updatedAt)) ? (
        <Card>
          <div className="exthw-note is-warn" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span>
              {refreshError
                ? `刷新失败，当前显示 ${updatedAt ? fmtAgo(updatedAt) : "上次"}的数据（${refreshError}）`
                : `数据已超过 6 小时未更新（${updatedAt ? fmtAgo(updatedAt) : "未知时间"}），可能不是最新`}
            </span>
            <Btn variant="outline" onClick={() => void reload()}>{i18n("auto.pages.info.CardTab.37")}</Btn>
          </div>
        </Card>
      ) : null}

      <BalanceWarnCard balance={data?.info.balance ?? null} />

      <SectionHead title={i18n("auto.pages.info.CardTab.38")} aside="最近 30 天（数据源：card.tsinghua.edu.cn）" />
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
                  {signedAmount(t) < 0 ? "−" : "+"}¥{money(Math.abs(signedAmount(t)))}
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
