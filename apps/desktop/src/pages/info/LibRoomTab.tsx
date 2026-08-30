/**
 * 研讨间预约（cab.lib.tsinghua.edu.cn ic-web，thu-info-app libRoomSelect/libRoomBook/
 * libRoomPerformBook 桌面化移植）：
 * - 房型（kindId/kindName）选择 + 未来 5 天日期选择（lib validDateNum=5）
 * - 可约资源列表：每房间开放时段条（占段=红/空闲=绿，convertUsageToSegments 同款）
 * - 选时段（开始/结束 5 分钟粒度、min/max 时长与占用约束，libRoomPerformBook 同算法）
 *   → 提交预约（ic-web/reserve POST JSON，sysKind=1 等字段为 lib 源码字面值）
 * - 我的预约（未来 6 天 resvInfo 列表）+ 取消（POST /reserve/delete {uuid}）
 * - 成员：仅以本人 accNo 提交（minUser>1 的多人房间给出说明，成员搜索端点已在
 *   InfoClient.fuzzySearchLibRoomMember 移植，UI 暂不开放）
 * - 首次预约报「填写邮箱地址」→ getUserInfo 邮箱确认 → ic-web/account/update 绑定后重试
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAuthError, type LibRoomBookRecord, type LibRoomRes } from "@onethu/core";
import { Card, Empty, ErrorNote, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { info, logLine, session } from "../../lib/clients.js";
import { explainNetworkError } from "../../lib/transport.js";
import { useApp } from "../../state/context.js";

/* 整页重载式自愈（用户语义：等同手动右键刷新，从头载入）。
   sessionStorage 节流：2 分钟内只自动重载一次，防止坏会话死循环；超限亮红交给用户。 */
export function autoFullReload(scope: string): boolean {
  try {
    const key = `onethu.autoreload.${scope}`;
    const last = Number(sessionStorage.getItem(key) ?? "0");
    if (Date.now() - last < 120_000) return false;
    sessionStorage.setItem(key, String(Date.now()));
  } catch { /* sessionStorage 不可用就保守放行一次 */ }
  setTimeout(() => location.reload(), 150);
  return true;
}


function logErr(tag: string, err: unknown): void {
  void logLine(
    "PAGE-ERR " + tag + " " + (err instanceof Error ? err.message : String(err)),
  ).catch(() => undefined);
}

type LoadState = "loading" | "error" | "ready";

const VALID_DATE_NUM = 5; // lib libRoomSelect validDateNum

const pad2 = (n: number): string => String(n).padStart(2, "0");
const hhmm = (d: Date): string => {
  if (Number.isNaN(d.getTime())) throw new Error("invalid date");
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
/** 记录渲染专用：服务端时间字段异常时不抛错（渲染层绝不 crash） */
const hhmmSafe = (d: Date): string => {
  try {
    return hhmm(d);
  } catch {
    return "–";
  }
};
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

interface DayChoice {
  offset: number;
  /** 查询用 yyyyMMdd */
  compact: string;
  /** 预约/展示用 yyyy-MM-dd */
  iso: string;
  label: string;
}

function dayChoices(): DayChoice[] {
  const out: DayChoice[] = [];
  for (let k = 0; k < VALID_DATE_NUM; k++) {
    const d = new Date();
    d.setDate(d.getDate() + k);
    out.push({
      offset: k,
      compact: `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`,
      iso: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
      label: k === 0 ? "今天" : `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${WEEKDAYS[d.getDay()]}`,
    });
  }
  return out;
}

/* ------------- 时段切分（libRoomBookTimeIndicator 逐行移植） ------------- */

/** [start, duration(分钟), occupied] —— lib convertUsageToSegments */
type Segment = [string, number, boolean];

const timeDiff = (start: string, end: string): number => {
  const sh = Number(start.slice(0, 2));
  const sm = Number(start.slice(3, 5));
  const eh = Number(end.slice(0, 2));
  const em = Number(end.slice(3, 5));
  return eh * 60 + em - (sh * 60 + sm);
};

const convertUsageToSegments = (res: LibRoomRes): Segment[] => {
  if (res.openStart === null || res.openEnd === null) return [];
  try {
    const sorted = [...res.usage].sort((a, b) => (a.start < b.start ? -1 : 1));
    const result: Segment[] = [];
    let lastTime = res.openStart;
    for (const u of sorted) {
      const beginTime = hhmm(u.start);
      const endTime = hhmm(u.end);
      if (beginTime > lastTime) result.push([lastTime, timeDiff(lastTime, beginTime), false]);
      result.push([beginTime, timeDiff(beginTime, endTime), true]);
      lastTime = endTime;
    }
    if (res.openEnd > lastTime) result.push([lastTime, timeDiff(lastTime, res.openEnd), false]);
    return result;
  } catch {
    return [[res.openStart, timeDiff(res.openEnd, res.openStart), false]];
  }
};

/* ------------- 可选开始/结束时刻（libRoomPerformBook 同算法，下拉替代滚轮） ------------- */

interface TimePoint {
  start: string;
  duration: number;
}

const fmtPoint = (h: number, m: number): string => `${pad2(h)}:${pad2(m)}`;

const validBegins = (res: LibRoomRes, iso: string): TimePoint[] => {
  const now = new Date();
  const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const nowHm = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  return convertUsageToSegments(res)
    .filter(([_, duration, occupied]) => duration >= res.minMinute && !occupied)
    .flatMap(([start, duration]) => {
      const startH = Number(start.slice(0, 2));
      const startM = Number(start.slice(3, 5));
      const out: TimePoint[] = [];
      const count = Math.floor((duration - res.minMinute) / 5) + 1;
      for (let k = 0; k < count; k++) {
        let m = startM + k * 5;
        const h = startH + Math.floor(m / 60);
        m -= Math.floor(m / 60) * 60;
        out.push({ start: fmtPoint(h, m), duration: duration - k * 5 });
      }
      return out;
    })
    .filter(({ start }) => iso > today || start > nowHm);
};

const validEnds = (res: LibRoomRes, begs: TimePoint[], beg: string): TimePoint[] => {
  const item = begs.find((e) => e.start === beg) ?? begs[0];
  if (!item) return [];
  const result: TimePoint[] = [];
  let h = Number(beg.slice(0, 2));
  let m = Number(beg.slice(3, 5)) + res.minMinute;
  const count = Math.floor((item.duration - res.minMinute - timeDiff(item.start, beg)) / 5) + 1;
  for (let i = 0; i < count; i++) {
    h += Math.floor(m / 60);
    m -= Math.floor(m / 60) * 60;
    result.push({ start: fmtPoint(h, m), duration: -1 });
    m += 5;
  }
  return result;
};

/** 开放时段条（libRoomBookTimeIndicator 桌面化：占段红 / 空闲绿） */
function UsageBar({ res }: { res: LibRoomRes }) {
  if (res.openStart === null || res.openEnd === null) {
    return <div style={{ fontSize: 12, color: "var(--text-3)" }}>当日不开放</div>;
  }
  const segments = convertUsageToSegments(res);
  return (
    <div
      style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", marginTop: 6 }}
      role="img"
      aria-label={`开放 ${res.openStart}~${res.openEnd}`}
    >
      {segments.map(([start, duration, occupied]) => (
        <div
          key={start}
          title={`${start} 起 ${duration} 分钟${occupied ? " · 已占用" : " · 空闲"}`}
          style={{ flex: duration, background: occupied ? "var(--red)" : "var(--green-soft)" }}
        />
      ))}
    </div>
  );
}

interface BookTarget {
  res: LibRoomRes;
  day: DayChoice;
}

export function LibRoomTab() {
  const { status } = useApp();
  const userId = session.username;

  /* 房型 */
  const [kinds, setKinds] = useState<Array<{ kindId: number; kindName: string }> | null>(null);
  const [kindState, setKindState] = useState<LoadState>("loading");
  const [kindError, setKindError] = useState<string | null>(null);
  const [kindId, setKindId] = useState<number | null>(null);

  /* 日期 + 资源 */
  const days = useMemo(dayChoices, []);
  const [day, setDay] = useState<DayChoice>(days[0]!);
  const [resources, setResources] = useState<LibRoomRes[] | null>(null);
  const [resState, setResState] = useState<LoadState>("loading");
  const [resError, setResError] = useState<string | null>(null);
  const [resTick, setResTick] = useState(0);

  /* 预约面板 */
  const [target, setTarget] = useState<BookTarget | null>(null);
  const [beg, setBeg] = useState<string>("");
  const [end, setEnd] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  /* 我的预约 */
  const [records, setRecords] = useState<LibRoomBookRecord[] | null>(null);
  const [recState, setRecState] = useState<LoadState>("loading");
  const [recError, setRecError] = useState<string | null>(null);

  /* 登录态丢失静默自愈：每条加载链路独立计数（成功清零），同一次失败最多自动恢复 1 次；
   * 恢复中保持 loading 骨架不闪红，自动恢复也失败才亮 ErrorNote（手动重试清零重计）。 */
  const kindRecover = useRef(0);
  const resRecover = useRef(0);
  const recRecover = useRef(0);

  const loadKinds = useCallback(async () => {
    if (status !== "ready" || !userId) return;
    setKindState("loading");
    setKindError(null);
    try {
      const list = await info.getLibRoomInfoList(userId);
      if (list.length === 0) throw new Error("房型列表为空（ic-web 未返回数据，请稍后重试）");
      kindRecover.current = 0;
      setKinds(list);
      setKindState("ready");
      setKindId((prev) => prev ?? list[0]!.kindId);
    } catch (err) {
      logErr("LIBROOM-KIND", err);
      // 登录态丢失：不闪红，静默重建研讨间 cab 会话后自动重载一次；仍失败才亮 ErrorNote
      if (isAuthError(err) && autoFullReload("libroom")) return;
      // 整页重载被 2 分钟节流 → 落回数据级恢复兜底
      if (isAuthError(err) && kindRecover.current < 1) {
        kindRecover.current += 1;
        await info.forceEnsure("libroom", userId).catch((renewErr: unknown) => {
          logErr("LIBROOM-RENEW", renewErr);
        });
        return loadKinds();
      }
      setKindState("error");
      setKindError(explainNetworkError(err));
    }
  }, [status, userId]);

  const loadRecords = useCallback(async () => {
    if (status !== "ready" || !userId) return;
    setRecState("loading");
    setRecError(null);
    try {
      setRecords(await info.getLibRoomRecords(userId));
      recRecover.current = 0;
      setRecState("ready");
    } catch (err) {
      logErr("LIBROOM-REC", err);
      // 登录态丢失：静默重建会话后自动重载一次（保持骨架，不闪红）
      if (isAuthError(err) && autoFullReload("libroom")) return;
      // 整页重载被 2 分钟节流 → 落回数据级恢复兜底
      if (isAuthError(err) && recRecover.current < 1) {
        recRecover.current += 1;
        await info.forceEnsure("libroom", userId).catch((renewErr: unknown) => {
          logErr("LIBROOM-RENEW", renewErr);
        });
        return loadRecords();
      }
      setRecState("error");
      setRecError(explainNetworkError(err));
    }
  }, [status, userId]);

  useEffect(() => {
    void loadKinds();
    void loadRecords();
  }, [loadKinds, loadRecords]);

  /* 资源：随房型/日期变化 */
  useEffect(() => {
    if (kindId === null || status !== "ready" || !userId) return;
    let alive = true;
    setResState("loading");
    setResError(null);
    setTarget(null);
    setResources(null);
    info
      .getLibRoomResourceList(userId, day.compact, kindId)
      .then((list) => {
        if (!alive) return;
        resRecover.current = 0;
        setResources(list);
        setResState("ready");
      })
      .catch((err: unknown) => {
        logErr("LIBROOM-RES", err);
        if (!alive) return;
        if (isAuthError(err) && autoFullReload("libroom")) return;
        // 整页重载被 2 分钟节流 → 落回数据级恢复兜底
        if (isAuthError(err) && resRecover.current < 1) {
          // 登录态丢失：静默重建研讨间会话后自动重取一次（保持骨架，不闪红）
          resRecover.current += 1;
          info
            .forceEnsure("libroom", userId)
            .catch((renewErr: unknown) => logErr("LIBROOM-RENEW", renewErr))
            .finally(() => setResTick((n) => n + 1));
          return;
        }
        setResState("error");
        setResError(explainNetworkError(err));
      });
    return () => {
      alive = false;
    };
  }, [kindId, day, status, userId, resTick]);

  /* 预约面板：目标/日期变化时重置时段选择 */
  const begins = useMemo(() => (target ? validBegins(target.res, target.day.iso) : []), [target]);
  useEffect(() => {
    setBeg(begins[0]?.start ?? "");
    setEnd("");
  }, [begins]);
  const ends = useMemo(
    () => (target && beg ? validEnds(target.res, begins, beg) : []),
    [target, begins, beg],
  );
  useEffect(() => {
    setEnd(ends[0]?.start ?? "");
  }, [ends]);

  const pickRoom = (res: LibRoomRes): void => {
    setBookError(null);
    setPendingEmail(null);
    setNotice(null);
    setTarget({ res, day });
  };

  const doBook = useCallback(
    async (t: BookTarget, begin: string, finish: string): Promise<void> => {
      const accNo = info.getLibRoomAccNo();
      if (!userId) {
        setBookError("需要登录会话（未获取到学号）");
        return;
      }
      if (accNo === null) {
        setBookError("研讨间账号信息缺失（accNo），请重试");
        return;
      }
      if (t.res.minUser > 1) {
        setBookError(`该房间需 ${t.res.minUser}~${t.res.maxUser} 人成组，本应用暂不支持添加成员，请到图书馆研讨间系统网页端预约`);
        return;
      }
      setBusy(true);
      setBookError(null);
      try {
        // lib bookLibraryRoom：`${date} ${beg}:00`，成员以 accNo（非学号）提交
        await info.bookLibRoom(userId, t.res, `${t.day.iso} ${begin}:00`, `${t.day.iso} ${finish}:00`, [
          accNo,
        ]);
        setNotice({ ok: true, text: `${t.res.roomName} ${t.day.iso} ${begin}~${finish} 预约成功，请留意图书馆邮件通知` });
        setTarget(null);
        void loadRecords();
        setResTick((n) => n + 1);
      } catch (err) {
        logErr("LIBROOM-BOOK", err);
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("填写邮箱地址")) {
          // lib libRoomPerformBook 同款流程：绑定邮箱后自动重试一次
          try {
            const userInfo = await info.getUserInfo();
            if (userInfo.email) {
              setPendingEmail(userInfo.email);
              setBookError("首次预约需绑定邮箱地址，请确认下方邮箱后重试");
              return;
            }
          } catch (emailErr) {
            logErr("LIBROOM-EMAIL", emailErr);
          }
          setBookError("首次预约需绑定邮箱地址（未能自动获取邮箱），请先在图书馆研讨间系统网页端绑定后重试");
          return;
        }
        setBookError(explainNetworkError(err));
      } finally {
        setBusy(false);
      }
    },
    [userId, loadRecords],
  );

  const confirmEmailAndRetry = async (): Promise<void> => {
    if (!userId || !pendingEmail || !target || !beg || !end) return;
    setBusy(true);
    try {
      await info.updateLibRoomEmail(userId, pendingEmail);
      setPendingEmail(null);
      await doBook(target, beg, end);
    } catch (err) {
      logErr("LIBROOM-EMAIL-SET", err);
      setBookError(explainNetworkError(err));
    } finally {
      setBusy(false);
    }
  };

  const cancelRecord = async (r: LibRoomBookRecord): Promise<void> => {
    if (!userId) return;
    setNotice(null);
    try {
      await info.cancelLibRoomBooking(userId, r.uuid);
      setNotice({ ok: true, text: "已取消该预约" });
      void loadRecords();
      setResTick((n) => n + 1);
    } catch (err) {
      logErr("LIBROOM-CANCEL", err);
      setNotice({ ok: false, text: explainNetworkError(err) });
    }
  };

  if (status === "demo") {
    return <Empty text="演示模式不提供研讨间数据，登录后可查询与预约。" />;
  }

  const canSubmit =
    target !== null && beg !== "" && end !== "" && !busy && target.res.minUser <= 1;

  return (
    <>
      <SectionHead title="研讨间" aside="cab.lib.tsinghua.edu.cn · ic-web" />
      {kindState === "error" ? (
        <ErrorNote
          text={kindError ?? ""}
          onRetry={() => {
            kindRecover.current = 0;
            void loadKinds();
          }}
        />
      ) : null}
      {kindState === "loading" && !kinds ? <SkeletonRows rows={2} /> : null}

      {kinds && kinds.length > 0 ? (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <div className="field" style={{ margin: 0, minWidth: 220 }}>
              <label htmlFor="libroom-kind">房型</label>
              <select
                id="libroom-kind"
                className="input"
                value={kindId ?? ""}
                onChange={(e) => setKindId(Number(e.target.value) || null)}
              >
                {kinds.map((k) => (
                  <option key={k.kindId} value={k.kindId}>
                    {k.kindName}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="libroom-date">日期</label>
              <select
                id="libroom-date"
                className="input"
                value={day.offset}
                onChange={(e) => setDay(days[Number(e.target.value)] ?? days[0]!)}
              >
                {days.map((d) => (
                  <option key={d.offset} value={d.offset}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <SectionHead title="可约房间" aside={`${day.label} · 时段条 红=已占用 绿=空闲`} />
          {resState === "loading" ? <SkeletonRows rows={4} /> : null}
          {resState === "error" ? (
            <ErrorNote
              text={resError ?? ""}
              onRetry={() => {
                resRecover.current = 0;
                setResTick((n) => n + 1);
              }}
            />
          ) : null}
          {resState === "ready" && (resources ?? []).length === 0 ? (
            <Card>
              <Empty text="该房型当日暂无可约房间。" />
            </Card>
          ) : null}
          {resState === "ready" && (resources ?? []).length > 0 ? (
            <Card className="list">
              {(resources ?? []).map((r) => (
                <div className="row" key={r.devId}>
                  <div className="row-main">
                    <div className="row-title">
                      {r.roomName}
                      {r.maxUser > 1 ? `（${r.minUser}~${r.maxUser} 人）` : ""}
                      {r.kindName.includes("暂未开放") ? "（暂未开放）" : ""}
                    </div>
                    <div className="row-sub">
                      {r.openStart && r.openEnd
                        ? `开放 ${r.openStart}~${r.openEnd} · 单次 ${r.minMinute}~${r.maxMinute} 分钟`
                        : "当日不开放"}
                      {r.usage.length > 0 ? ` · 已约 ${r.usage.length} 段` : ""}
                    </div>
                    <UsageBar res={r} />
                  </div>
                  <div className="row-amount">
                    <button
                      className="btn btn-primary"
                      style={{ height: 28 }}
                      disabled={r.kindName.includes("暂未开放") || r.openStart === null}
                      onClick={() => pickRoom(r)}
                    >
                      预约
                    </button>
                  </div>
                </div>
              ))}
            </Card>
          ) : null}
        </>
      ) : null}

      {/* 选房后的预约面板 */}
      {target ? (
        <Card style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            预约 <b>{target.res.roomName}</b> · {target.day.iso}
            {target.res.maxUser > 1 ? `（${target.res.minUser}~${target.res.maxUser} 人）` : ""}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="libroom-beg">开始</label>
              <select
                id="libroom-beg"
                className="input"
                value={beg}
                onChange={(e) => setBeg(e.target.value)}
                disabled={begins.length === 0}
              >
                {begins.length === 0 ? <option value="">无可约时段</option> : null}
                {begins.map((b) => (
                  <option key={b.start} value={b.start}>
                    {b.start}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="libroom-end">结束</label>
              <select
                id="libroom-end"
                className="input"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                disabled={ends.length === 0}
              >
                {ends.length === 0 ? <option value="">–</option> : null}
                {ends.map((p) => (
                  <option key={p.start} value={p.start}>
                    {p.start}
                  </option>
                ))}
              </select>
            </div>
            <span style={{ flex: 1 }} />
            <button
              className="btn btn-primary"
              style={{ height: 32 }}
              disabled={!canSubmit}
              onClick={() => {
                if (target && beg && end) void doBook(target, beg, end);
              }}
            >
              {busy ? "提交中…" : "提交预约"}
            </button>
            <button className="btn" style={{ height: 32 }} onClick={() => setTarget(null)}>
              取消
            </button>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 8 }}>
            成员：本人（accNo {info.getLibRoomAccNo() ?? "–"}）。
            {target.res.minUser > 1
              ? ` 该房间需 ${target.res.minUser}~${target.res.maxUser} 人成组，本应用暂不支持添加成员，请到图书馆研讨间系统网页端预约。`
              : ` 单次可约 ${target.res.minMinute}~${target.res.maxMinute} 分钟，5 分钟粒度。`}
          </div>
        </Card>
      ) : null}

      {pendingEmail ? (
        <Card style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 13 }}>
            绑定邮箱 <b>{pendingEmail}</b> 并重试预约？
          </span>
          <span style={{ flex: 1 }} />
          <button
            className="btn btn-primary"
            style={{ height: 28 }}
            disabled={busy}
            onClick={() => void confirmEmailAndRetry()}
          >
            确认并重试
          </button>
          <button className="btn" style={{ height: 28 }} onClick={() => setPendingEmail(null)}>
            取消
          </button>
        </Card>
      ) : null}

      {bookError ? <ErrorNote text={bookError} /> : null}
      {notice ? (
        <Card style={{ marginTop: 12 }}>
          <span className={notice.ok ? "" : "t-red"} style={{ fontSize: 13 }}>
            {notice.text}
          </span>
        </Card>
      ) : null}

      <SectionHead title="我的预约" aside="研讨间预约记录（未来 6 天）" />
      {recState === "loading" ? <SkeletonRows rows={2} /> : null}
      {recState === "error" ? (
        <ErrorNote
          text={recError ?? ""}
          onRetry={() => {
            recRecover.current = 0;
            void loadRecords();
          }}
        />
      ) : null}
      {recState === "ready" && (records ?? []).length === 0 ? (
        <Card>
          <Empty text="暂无研讨间预约记录。" />
        </Card>
      ) : null}
      {recState === "ready" && (records ?? []).length > 0 ? (
        <Card className="list">
          {(records ?? []).map((r) => (
            <div className="row" key={r.uuid || r.rsvId}>
              <div className="row-main">
                <div className="row-title">
                  {r.devName || "研讨间"}
                  {r.kindName ? ` · ${r.kindName}` : ""}
                </div>
                <div className="row-sub">
                  {r.date} {hhmmSafe(r.begin)}~{hhmmSafe(r.end)}
                  {r.members.length > 0 ? ` · 成员 ${r.members.map((m) => m.name).join("、")}` : ""}
                </div>
              </div>
              <div className="row-amount">
                {r.uuid ? (
                  <button className="btn" style={{ height: 28 }} onClick={() => void cancelRecord(r)}>
                    取消
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </Card>
      ) : null}
    </>
  );
}
