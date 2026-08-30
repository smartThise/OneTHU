/**
 * 体育场馆预约 —— SportsTab（thu-info-app sports 系列（sportsDetail/sportsRecord）移植）。
 * 两段式只读 + 预约：
 * ① 场馆 chips + 日期（默认今天）→ 时段 × 场地状态表（绿=可约，点击选中）；
 * ② 底部预约卡：手机号（core 返回预填，可「保存到体育系统」）→ 预约按钮 →
 *    验证码面板（图可点刷新 + 输入框 + 提交，交互复用 NetworkTab usereg 面板；
 *    验证码图由 core 携会话拉 PNG 转 base64，webview 直挂 URL 只会得到登录页）；
 * ③ 我的预约记录列表（含退订，退订需 confirm 确认）。
 * 支付流不接（免费场景 skipPayment=true，返回的支付码弃用），记录只展示状态；
 * 线上支付/稍后支付（paySportsReservation）暂不入口。
 *
 * 错误铁律：ServiceUnavailable → 「体育预约服务暂不可用（info app 同样无法使用）」
 * 静态提示 + 重试；空记录 → 「暂无预约记录」；绝不自动整页刷新、绝不失登自愈。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { sportsIdInfoList, type SportsIdInfo } from "@onethu/core";
import { Card, ErrorNote, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { info } from "../../lib/clients.js";
import { useApp } from "../../state/context.js";
import { TabEmpty, isServiceUnavailable, logTabErr, tabErrorText } from "./tabStates.js";

type LoadState = "idle" | "loading" | "error" | "ready";
/** core getSportsResources → { count, init, phone, data }（lib SportsResourcesInfo 同源） */
type SportsResourcesInfoT = Awaited<ReturnType<typeof info.getSportsResources>>;
type SportsResourceT = SportsResourcesInfoT["data"][number];
type SportsRecordT = Awaited<ReturnType<typeof info.getSportsReservationRecords>>[number];

/** 场馆元数据表 = core sportsIdInfoList（lib sportsIdInfoList 逐字，index.ts 再导出） */
const SPORTS_VENUES: SportsIdInfo[] = sportsIdInfoList;

function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 可预约判定：无 bookId、未锁定、允许网络预约 */
function bookable(r: SportsResourceT): boolean {
  return !r.bookId && !r.locked && r.canNetBook;
}

const SPORTS_UNAVAILABLE = "体育预约服务暂不可用（info app 同样无法使用）";
const PHONE_RE = /^(1[3-9][0-9]|15[036789]|18[89])\d{8}$/;

export function SportsTab() {
  const { status } = useApp();

  /* —— 场馆/日期选择 —— */
  const [venue, setVenue] = useState(SPORTS_VENUES[0]!);
  const [date, setDate] = useState(todayStr);

  /* —— 资源（时段×场地） —— */
  const [res, setRes] = useState<SportsResourcesInfoT | null>(null);
  const [resState, setResState] = useState<LoadState>("idle");
  const [resUnavailable, setResUnavailable] = useState(false);
  const [resError, setResError] = useState<string | null>(null);

  /* —— 选中场地 —— */
  const [picked, setPicked] = useState<SportsResourceT | null>(null);

  /* —— 预约表单 + 验证码面板 —— */
  const [phone, setPhone] = useState("");
  const [phoneMsg, setPhoneMsg] = useState<string | null>(null);
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [captchaOpen, setCaptchaOpen] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [captchaErr, setCaptchaErr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [booking, setBooking] = useState(false);

  /* —— 我的预约记录 —— */
  const [records, setRecords] = useState<SportsRecordT[] | null>(null);
  const [recState, setRecState] = useState<LoadState>("loading");
  const [recUnavailable, setRecUnavailable] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [unsubbing, setUnsubbing] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  /* —— 资源加载 —— */
  const loadResources = useCallback(
    async (v: { gymId: string; itemId: string }, d: string) => {
      setResState("loading");
      setResUnavailable(false);
      setResError(null);
      setPicked(null);
      setCaptchaOpen(false);
      try {
        const data = await info.getSportsResources(v.gymId, v.itemId, d);
        setRes(data);
        setPhone(data.phone ?? "");
        setResState("ready");
      } catch (err) {
        logTabErr("SPORTS-RES", err);
        setResUnavailable(isServiceUnavailable(err));
        setResError(tabErrorText(err));
        setResState("error");
      }
    },
    [],
  );

  useEffect(() => {
    if (status === "ready") void loadResources(venue, date);
    // 仅挂载时拉一次；场馆/日期变化由交互回调触发（日期输入中途不连发请求）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  /* —— 我的预约记录 —— */
  const fetchRecords = useCallback(async () => {
    setRecState("loading");
    setRecUnavailable(false);
    setRecError(null);
    try {
      setRecords(await info.getSportsReservationRecords());
      setRecState("ready");
    } catch (err) {
      logTabErr("SPORTS-RECORDS", err);
      setRecUnavailable(isServiceUnavailable(err));
      setRecError(tabErrorText(err));
      setRecState("error");
    }
  }, []);

  useEffect(() => {
    if (status === "ready") void fetchRecords();
  }, [status, fetchRecords]);

  /* —— 退订（confirm 确认后调用） —— */
  const unsubscribe = useCallback(
    async (bookId: string) => {
      setUnsubbing(bookId);
      setNoticeMsg(null);
      try {
        await info.unsubscribeSportsReservation(bookId);
        setNoticeMsg("已退订。");
        await Promise.all([
          fetchRecords(),
          loadResources(venue, date),
        ]);
      } catch (err) {
        logTabErr("SPORTS-UNSUB", err);
        setNoticeMsg(isServiceUnavailable(err) ? SPORTS_UNAVAILABLE : `退订失败：${tabErrorText(err)}`);
      } finally {
        setUnsubbing(null);
      }
    },
    [fetchRecords, loadResources, venue, date],
  );

  /* —— 手机号保存（updateSportsPhoneNumber；core 侧同样校验格式） —— */
  const savePhone = useCallback(async () => {
    const p = phone.trim();
    if (!PHONE_RE.test(p)) {
      setPhoneMsg("请输入正确的 11 位手机号");
      return;
    }
    setPhoneBusy(true);
    setPhoneMsg(null);
    try {
      await info.updateSportsPhoneNumber(p);
      setPhoneMsg("手机号已保存到体育系统");
    } catch (err) {
      logTabErr("SPORTS-PHONE", err);
      setPhoneMsg(isServiceUnavailable(err) ? SPORTS_UNAVAILABLE : `保存失败：${tabErrorText(err)}`);
    } finally {
      setPhoneBusy(false);
    }
  }, [phone]);

  /* —— 验证码面板（图可点刷新） —— */
  const refreshCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    setCaptchaErr(null);
    try {
      // core 携 webvpn 会话拉 PNG → base64 data URL（getSportsCaptchaUrlMethod）
      setCaptcha(await info.getSportsCaptchaUrlMethod());
    } catch (err) {
      logTabErr("SPORTS-CAPTCHA", err);
      setCaptcha(null);
      setCaptchaErr(isServiceUnavailable(err) ? SPORTS_UNAVAILABLE : `验证码拉取失败：${tabErrorText(err)}`);
    } finally {
      setCaptchaLoading(false);
    }
  }, []);

  const openCaptcha = useCallback(() => {
    if (!picked) return;
    setCaptchaOpen(true);
    setCode("");
    setCaptchaErr(null);
    void refreshCaptcha();
  }, [picked, refreshCaptcha]);

  /* —— 提交预约（下单段；免费/跳过支付时 core 不走支付链） —— */
  const doBook = useCallback(async () => {
    if (!picked || !code.trim()) return;
    setBooking(true);
    setCaptchaErr(null);
    try {
      // makeSportsReservation(totalCost, phone, receiptTitle, gymId, itemId, date, captcha, resHashId, skipPayment)
      await info.makeSportsReservation(
        picked.cost ?? 0,
        phone.trim(),
        undefined, // 收据抬头仅线上申领发票用；免费场景不接支付流
        venue.gymId,
        venue.itemId,
        date,
        code.trim(),
        picked.resHash,
        true, // skipPayment：用户场景免费，不接支付流
      );
      setNoticeMsg(`预约成功：${venue.name} · ${date} · ${picked.timeSession} · ${picked.fieldName}（免费场地无需支付；如需付费请到体育系统办理）`);
      setCaptchaOpen(false);
      setCode("");
      await Promise.all([loadResources(venue, date), fetchRecords()]);
    } catch (err) {
      logTabErr("SPORTS-BOOK", err);
      setCaptchaErr(isServiceUnavailable(err) ? SPORTS_UNAVAILABLE : `预约失败：${tabErrorText(err)}（可点击验证码图刷新后重试）`);
      void refreshCaptcha();
    } finally {
      setBooking(false);
    }
  }, [picked, code, phone, venue, date, loadResources, fetchRecords, refreshCaptcha]);

  /* 时段分组（按起始时间排序） */
  const sessions = useMemo(() => {
    const bySession = new Map<string, SportsResourceT[]>();
    for (const r of res?.data ?? []) {
      const list = bySession.get(r.timeSession);
      if (list) list.push(r);
      else bySession.set(r.timeSession, [r]);
    }
    return [...bySession.entries()].sort((a, b) => {
      const ta = a[0].split("-")[0]?.trim() ?? "";
      const tb = b[0].split("-")[0]?.trim() ?? "";
      return ta.localeCompare(tb, "zh-Hans-CN", { numeric: true });
    });
  }, [res]);

  if (status === "demo") {
    return <TabEmpty text="演示模式不提供体育预约，登录后可预约体育场馆。" />;
  }

  const closed = res !== null && res.init <= 0;
  const phoneOk = PHONE_RE.test(phone.trim());

  return (
    <>
      <SectionHead title="场馆与日期" aside={res?.count ? `最多可约 ${res.count} 片` : "体育系统 · 网上预约"} />
      <div className="chips" style={{ marginBottom: 10 }}>
        {SPORTS_VENUES.map((v) => (
          <button
            key={v.itemId}
            className={"chip" + (venue.itemId === v.itemId ? " chip-blue" : "")}
            onClick={() => {
              setVenue(v);
              void loadResources(v, date);
            }}
          >
            {v.name}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
        <input
          className="input"
          style={{ width: 170 }}
          type="date"
          value={date}
          onChange={(e) => {
            const d = e.target.value;
            setDate(d);
            if (d) void loadResources(venue, d);
          }}
          aria-label="预约日期"
        />
        <button className="btn btn-ghost" onClick={() => void loadResources(venue, date)} disabled={resState === "loading"}>
          刷新
        </button>
      </div>

      <SectionHead title={`时段与场地 · ${venue.name}`} aside={closed ? "当前不在开放预约时段" : undefined} />
      {resState === "error" ? (
        resUnavailable ? (
          <ErrorNote text={SPORTS_UNAVAILABLE} onRetry={() => void loadResources(venue, date)} />
        ) : (
          <ErrorNote text={resError ?? ""} onRetry={() => void loadResources(venue, date)} />
        )
      ) : null}
      {resState === "loading" ? (
        <SkeletonRows rows={5} />
      ) : resState === "ready" && sessions.length === 0 ? (
        <TabEmpty text="该场馆当日暂无可预约时段（可能未开放或已约满）。" />
      ) : resState === "ready" ? (
        <>
          {closed ? (
            <Card style={{ marginBottom: 12 }}>
              <div className="empty">当前不在开放预约时段（开放时间以体育系统为准），以下仅展示现状。</div>
            </Card>
          ) : null}
          {sessions.map(([session, fields]) => (
            <div key={session} style={{ marginBottom: 14 }}>
              <Card style={{ padding: 0, overflow: "hidden" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{session}</th>
                      <th className="num">状态</th>
                      <th className="num">费用</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((r, i) => (
                      <tr
                        key={r.resId || i}
                        style={{ animationDelay: `${Math.min(i, 12) * 25}ms`, cursor: bookable(r) ? "pointer" : "default" }}
                        onClick={() => bookable(r) && setPicked(r)}
                      >
                        <td className="cell-title">{r.fieldName}</td>
                        <td className="num">
                          <span
                            className={
                              picked?.resId === r.resId
                                ? "chip chip-blue"
                                : bookable(r)
                                  ? "chip chip-green"
                                  : "chip chip-gray"
                            }
                          >
                            {picked?.resId === r.resId ? "已选" : r.bookId ? "已预约" : r.locked ? "锁定" : bookable(r) ? "可约" : "不可约"}
                          </span>
                        </td>
                        <td className="num">{r.cost === undefined ? "–" : r.cost === 0 ? "免费" : `¥${r.cost}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          ))}
        </>
      ) : null}

      {/* 预约卡（选中场地后出现） */}
      {picked ? (
        <>
          <SectionHead title="预约" aside={`${venue.name} · ${date} · ${picked.timeSession} · ${picked.fieldName}`} />
          <Card style={{ marginBottom: 16 }}>
            <div className="field">
              <label htmlFor="sports-phone">手机号（用于接收预约通知）</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  id="sports-phone"
                  className="input"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="11 位手机号"
                  inputMode="numeric"
                />
                <button className="btn btn-ghost" onClick={() => void savePhone()} disabled={phoneBusy || !phoneOk} title="保存到体育系统，接收短信通知">
                  {phoneBusy ? "保存中…" : "保存"}
                </button>
              </div>
            </div>
            {phoneMsg ? <div style={{ marginTop: -6, marginBottom: 8, fontSize: 12, color: "var(--text-3)" }}>{phoneMsg}</div> : null}
            <button className="btn btn-primary" onClick={openCaptcha} disabled={!phoneOk}>
              {phoneOk ? "预约（下一步：验证码）" : "请先填写 11 位手机号"}
            </button>
          </Card>
        </>
      ) : null}

      {/* 验证码面板（交互复用 NetworkTab usereg 验证码面板：图可点刷新 + 输入 + 提交） */}
      {captchaOpen && picked ? (
        <Card style={{ marginBottom: 16, padding: 18 }}>
          <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>预约验证码</div>
          <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 14, lineHeight: 1.6 }}>
            {venue.name} · {date} · {picked.timeSession} · {picked.fieldName}
            {picked.cost ? ` · ¥${picked.cost}` : " · 免费"}；点击右侧图可刷新验证码。
          </div>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
            <div
              onClick={() => !captchaLoading && void refreshCaptcha()}
              style={{
                width: 150,
                height: 48,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid var(--border, #ccc)",
                borderRadius: 8,
                cursor: "pointer",
                overflow: "hidden",
                flexShrink: 0,
              }}
              title="点击刷新验证码"
            >
              {captchaLoading ? (
                <span style={{ fontSize: 12, opacity: 0.6 }}>加载中…</span>
              ) : captcha ? (
                <img src={captcha} alt="验证码" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <span style={{ fontSize: 12, opacity: 0.6 }}>点击重试</span>
              )}
            </div>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void doBook();
              }}
              placeholder="验证码"
              style={{ width: 130, height: 38, padding: "0 10px", borderRadius: 8, border: "1px solid var(--border, #ccc)", fontSize: 14 }}
            />
            <button className="btn btn-primary" onClick={() => void doBook()} disabled={booking || !code.trim()}>
              {booking ? "提交中…" : "确认预约"}
            </button>
            <button className="btn btn-ghost" onClick={() => { setCaptchaOpen(false); setCode(""); }}>
              取消
            </button>
          </div>
          {captchaErr ? <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.5, color: "#d33" }}>{captchaErr}</div> : null}
        </Card>
      ) : null}

      <SectionHead title="我的预约" aside="未支付/已支付记录（不接支付流，仅展示状态）" />
      {recState === "error" ? (
        recUnavailable ? (
          <ErrorNote text={SPORTS_UNAVAILABLE} onRetry={() => void fetchRecords()} />
        ) : (
          <ErrorNote text={recError ?? ""} onRetry={() => void fetchRecords()} />
        )
      ) : null}
      {recState === "loading" && !records ? (
        <SkeletonRows rows={4} />
      ) : (records?.length ?? 0) === 0 ? (
        <TabEmpty text="暂无预约记录。" />
      ) : (
        <>
          {noticeMsg ? (
            <Card style={{ marginBottom: 10 }}>
              <div className="empty">{noticeMsg}</div>
            </Card>
          ) : null}
          <Card className="list">
            {records!.map((r, i) => (
              <div className="row" key={`${r.name}-${r.time}-${i}`} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                <span className={/未支付/.test(r.method) ? "chip chip-amber" : "chip chip-green"}>{r.method || "已预约"}</span>
                <div className="row-main">
                  <div className="row-title">{r.name} · {r.field}</div>
                  <div className="row-sub">{r.time}{r.price ? ` · ¥${r.price}` : ""}</div>
                </div>
                {r.bookId ? (
                  <button
                    className="btn btn-ghost"
                    disabled={unsubbing !== null}
                    onClick={() => {
                      if (globalThis.confirm?.(`确定退订「${r.name} ${r.field} ${r.time}」？`)) {
                        void unsubscribe(r.bookId!);
                      }
                    }}
                  >
                    {unsubbing === r.bookId ? "退订中…" : "退订"}
                  </button>
                ) : null}
              </div>
            ))}
          </Card>
        </>
      )}
    </>
  );
}
