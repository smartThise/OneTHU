/**
 * 校园卡页 —— getCardInfo + getCardTransactions（thu-info-lib card.ts 移植）。
 * 余额与卡状态置顶；最近 30 天消费流水；充值（cardRechargeFromBank /
 * cardRechargeQrcode，链路逐条移植自 thu-info-lib）；支出统计（THU-EAT
 * stats.py/api_summary 口径，今日/本周/本年/总支出区间，均排除充值/圈存/补助）。
 * 金额约定（thu-info-app expenditure.tsx 实证）：服务端金额恒为正，
 * 按「名称」分类——充值/圈存/补助=收入（+绿），其余=消费（−红）。
 *
 * 请求纪律（PR #13 反馈口径）：首屏仍只拉 30 天；本年/总支出等大窗口
 * 一律用户点击对应统计后才按精确区间拉取（getCardTxWindow，TTL 缓存 +
 * in-flight 去重）——轻量请求、不重锤校内服务。
 *
 * 充值安全红线（支付链路）：
 * - 本应用只「下单 + 展示官方收款链」，支付动作完全发生在支付宝/微信/银行侧，不经手资金；
 * - 下单请求不自动重试；响应（学号/收款链接）不写入任何调试日志；
 * - 二次确认明示金额与方式；结果以校园卡余额/流水为准，UI 不宣称「已到账」。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import type { CardTransaction } from "@onethu/core";
import { Card, Empty, ErrorNote, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { IconCard } from "../../components/Icons.js";
import { useApp } from "../../state/context.js";
import { getCardTxWindow, useCard } from "../../state/data.js";
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
/** Date → "YYYY-MM-DD"（date input 受控值 / 流水接口入参同格式） */
const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* —— 支出统计口径（THU-EAT api_summary 同语义，均排除收入）—— */

const dayFloor = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const sumOf = (txs: CardTransaction[]) => txs.reduce((s, t) => s + Math.abs(t.amount), 0);

type TodayMode = "today" | "week" | "year";
const TODAY_LABEL: Record<TodayMode, string> = { today: "今日支出", week: "本周支出", year: "本年支出" };

/** 「全部」口径的兜底窗口：4 年（仅用户点击总支出后才拉取） */
const ALL_YEARS_DAYS = 365 * 4 + 1;

/* —— 卡片显隐持久化（默认全显，只记隐藏项）—— */
const HIDDEN_KEY = "onethu.card-hidden.v1";
type CardKey = "balance" | "today" | "last30" | "total" | "count";
const CARD_LABELS: Array<{ key: CardKey; label: string }> = [
  { key: "balance", label: "校园卡余额" },
  { key: "today", label: "今日支出（可切换本周/本年）" },
  { key: "last30", label: "近 30 天消费" },
  { key: "total", label: "总支出（可选日期区间，按需拉取）" },
  { key: "count", label: "近 30 天笔数" },
];
function loadHidden(): CardKey[] {
  try {
    const raw = globalThis.localStorage?.getItem(HIDDEN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((k) => CARD_LABELS.some((c) => c.key === k)) : [];
  } catch {
    return [];
  }
}
function saveHidden(list: CardKey[]): void {
  try {
    globalThis.localStorage?.setItem(HIDDEN_KEY, JSON.stringify(list));
  } catch {
    /* 存储不可用：会话内仍生效 */
  }
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

/* ---------------- 总支出区间选择弹窗（选完才拉取，带加载/错误态） ---------------- */

function RangeDialog({
  open,
  onClose,
  busy,
  err,
  rangeStart,
  rangeEnd,
  setRange,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  busy: boolean;
  err: string;
  rangeStart: string;
  rangeEnd: string;
  setRange: (start: string, end: string) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;
  return createPortal(
    <div style={maskStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <b>总支出统计区间</b>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>✕</button>
        </div>
        <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 10 }}>
          选择区间后才会向校园卡服务发起对应窗口的流水请求（结果缓存 10 分钟）。
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <button
            className="btn"
            onClick={() => {
              const s = new Date();
              s.setDate(s.getDate() - ALL_YEARS_DAYS + 1);
              setRange(isoDate(s), isoDate(new Date()));
            }}
          >
            全部（近 4 年）
          </button>
          <button
            className="btn"
            onClick={() => {
              const y = new Date().getFullYear();
              setRange(`${y}-01-01`, isoDate(new Date()));
            }}
          >
            本年
          </button>
          <button
            className="btn"
            onClick={() => {
              const s = new Date();
              s.setDate(s.getDate() - 364);
              setRange(isoDate(s), isoDate(new Date()));
            }}
          >
            近一年
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <span style={{ color: "var(--text-3, #9aa1ac)", fontSize: 12 }}>自定</span>
          <input className="input" type="date" value={rangeStart} onChange={(e) => setRange(e.target.value, rangeEnd)} />
          <span>至</span>
          <input className="input" type="date" value={rangeEnd} onChange={(e) => setRange(rangeStart, e.target.value)} />
        </div>
        {err ? <div style={{ color: "#d33", fontSize: 12, marginBottom: 8 }}>{err}</div> : null}
        <button className="btn btn-primary" style={{ width: "100%" }} disabled={busy || !rangeStart || !rangeEnd} onClick={onSubmit}>
          {busy ? "拉取流水中…" : "统计该区间支出"}
        </button>
      </div>
    </div>,
    document.body,
  );
}

/* --------------------------------- 主组件 --------------------------------- */

export function CardTab({ active = true }: { active?: boolean }) {
  const { status } = useApp();
  const demo = status === "demo";
  const { data, state, error, reload } = useCard(30);
  const [rchOpen, setRchOpen] = useState(false);
  // 切回本栏时若上次报错（如会话过期）则自动重试一次，不再让用户手动点刷新
  useEffect(() => { if (active && state === "error") void reload(); }, [active]);

  /** 首屏 30 天窗口内的消费流水（排除收入，时间倒序）——今日/本周/近30天/笔数全在此算，零额外请求 */
  const spentTxs = useMemo(
    () =>
      (data?.transactions ?? [])
        .filter((t) => !isIncome(t))
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()),
    [data],
  );
  const last30 = useMemo(() => sumOf(spentTxs), [spentTxs]);

  /* —— 今日/本周/本年（点击切换，自然周期口径）—— */
  const [todayMode, setTodayMode] = useState<TodayMode>("today");
  const [yearTxs, setYearTxs] = useState<CardTransaction[] | null>(null);
  const [yearState, setYearState] = useState<"idle" | "loading" | "error">("idle");

  // 本年超出 30 天首屏窗口 → 按需拉取 [1月1日, 今天]；ref 守卫防 effect 自触发循环，
  // 失败清守卫 → 用户切走再切回本年即重试（缓存命中时 getCardTxWindow 不发请求）
  const yearTried = useRef(false);
  useEffect(() => {
    if (todayMode !== "year" || yearTried.current) return;
    yearTried.current = true;
    let alive = true;
    setYearState("loading");
    const jan1 = new Date(new Date().getFullYear(), 0, 1);
    getCardTxWindow(jan1, new Date(), demo)
      .then((txs) => {
        if (!alive) return;
        setYearTxs(txs.filter((t) => !isIncome(t)));
        setYearState("idle");
      })
      .catch(() => {
        yearTried.current = false;
        if (alive) setYearState("error");
      });
    return () => {
      alive = false;
    };
  }, [todayMode, demo]);

  const periodSum = useMemo(() => {
    const now = new Date();
    if (todayMode === "today") return sumOf(spentTxs.filter((t) => t.timestamp.getTime() >= dayFloor(now)));
    if (todayMode === "week") {
      const monday = dayFloor(new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)));
      return sumOf(spentTxs.filter((t) => t.timestamp.getTime() >= monday));
    }
    return sumOf(yearTxs ?? []);
  }, [spentTxs, todayMode, yearTxs]);

  /* —— 总支出：默认不拉取，卡片保留占位；点击选区间后才请求对应窗口 —— */
  const [totalTxs, setTotalTxs] = useState<CardTransaction[] | null>(null);
  const [totalLabel, setTotalLabel] = useState("");
  const [totalBusy, setTotalBusy] = useState(false);
  const [totalErr, setTotalErr] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [rangeOpen, setRangeOpen] = useState(false);
  const totalSum = useMemo(() => sumOf(totalTxs ?? []), [totalTxs]);

  const submitRange = async () => {
    setTotalBusy(true);
    setTotalErr("");
    // "YYYY-MM-DD" → 本地零点（避免 new Date("2026-01-01") 按 UTC 解析偏一天）
    const parse = (s: string) => new Date(s.replace(/-/g, "/"));
    try {
      const txs = await getCardTxWindow(parse(rangeStart), parse(rangeEnd), demo);
      setTotalTxs(txs.filter((t) => !isIncome(t)));
      setTotalLabel(`${rangeStart} ~ ${rangeEnd}`);
      setRangeOpen(false);
    } catch (e) {
      setTotalErr(e instanceof Error ? e.message : String(e));
    } finally {
      setTotalBusy(false);
    }
  };

  /* —— 卡片显隐管理 —— */
  const [hidden, setHidden] = useState<CardKey[]>(loadHidden);
  const [manageOpen, setManageOpen] = useState(false);
  const show = (k: CardKey) => !hidden.includes(k);
  const toggleHidden = (k: CardKey) => {
    const next = hidden.includes(k) ? hidden.filter((x) => x !== k) : [...hidden, k];
    setHidden(next);
    saveHidden(next);
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <button className="btn" onClick={() => setManageOpen(true)} title="选择要显示的统计卡片">
          管理卡片
        </button>
      </div>

      <div className="stats stats-hero">
        {show("balance") ? (
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
              {!demo ? (
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
        ) : null}
        {show("today") ? (
          <Card
            className="stat-card"
            style={{ cursor: "pointer" }}
            onClick={() => setTodayMode((m) => (m === "today" ? "week" : m === "week" ? "year" : "today"))}
            title="点击切换：今日 → 本周 → 本年"
          >
            <span className="stat-icon">
              <IconCard width={17} height={17} />
            </span>
            <div>
              <div className="stat-num">
                {todayMode === "year" && yearState === "loading" ? "…" : todayMode === "year" && yearState === "error" ? "–" : `¥${periodSum.toFixed(2)}`}
              </div>
              <div className="stat-label">
                {TODAY_LABEL[todayMode]}
                {todayMode === "year" && yearState === "loading" ? " · 拉取中"
                  : todayMode === "year" && yearState === "error" ? " · 拉取失败，切回再试"
                  : " · 点击切换"}
              </div>
            </div>
          </Card>
        ) : null}
        {show("last30") ? (
          <Card className="stat-card">
            <span className="stat-icon red">
              <IconCard width={17} height={17} />
            </span>
            <div>
              <div className="stat-num">¥{last30.toFixed(2)}</div>
              <div className="stat-label">近 30 天消费</div>
            </div>
          </Card>
        ) : null}
        {show("total") ? (
          <Card
            className="stat-card"
            style={{ cursor: "pointer" }}
            onClick={() => setRangeOpen(true)}
            title="点击选择统计区间（选择后才会拉取对应窗口流水）"
          >
            <span className="stat-icon amber">
              <IconCard width={17} height={17} />
            </span>
            <div>
              <div className="stat-num">{totalTxs ? `¥${totalSum.toFixed(2)}` : "¥–"}</div>
              <div className="stat-label">
                总支出{totalTxs ? ` · ${totalLabel}` : " · 点击选区间拉取"}
              </div>
            </div>
          </Card>
        ) : null}
        {show("count") ? (
          <Card className="stat-card">
            <span className="stat-icon">
              <IconCard width={17} height={17} />
            </span>
            <div>
              <div className="stat-num">{spentTxs.length}</div>
              <div className="stat-label">近 30 天笔数</div>
            </div>
          </Card>
        ) : null}
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

      <RangeDialog
        open={rangeOpen}
        onClose={() => setRangeOpen(false)}
        busy={totalBusy}
        err={totalErr}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        setRange={(s, e) => {
          setRangeStart(s);
          setRangeEnd(e);
        }}
        onSubmit={() => void submitRange()}
      />

      {/* 卡片管理弹窗 */}
      {manageOpen
        ? createPortal(
            <div style={maskStyle} onClick={() => setManageOpen(false)}>
              <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <b>管理统计卡片</b>
                  <span style={{ flex: 1 }} />
                  <button className="btn" onClick={() => setManageOpen(false)}>✕</button>
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                  {CARD_LABELS.map((c) => (
                    <label key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer" }}>
                      <input type="checkbox" checked={show(c.key)} onChange={() => toggleHidden(c.key)} />
                      {c.label}
                    </label>
                  ))}
                  <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
                    <button
                      className="btn"
                      onClick={() => {
                        setHidden([]);
                        saveHidden([]);
                      }}
                    >
                      恢复默认
                    </button>
                    <button className="btn btn-primary" onClick={() => setManageOpen(false)}>完成</button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
