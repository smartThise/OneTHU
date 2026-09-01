/**
 * 学生宿舍公共空间预约（myhome 共享家园网 kongjian WebForms 链路）。
 *
 * 交互（对齐官网 kj_yuyue.aspx）：
 * ① 公共空间 chips（54 项）→ ② 房间 chips → ③ 日期 chips（今起 7 天）→
 * ④ 场次胶囊（时间 + 状态；可约的点击出确认卡）→ ⑤ 确认卡（姓名/学号/电话/用途）提交
 * ⑥ 我的预约 + 取消（WebForms 回传）。
 * 首次进入自动过 agreement 协议（core 内处理）。
 */
import { useCallback, useEffect, useState } from "react";
import type { KongjianPage, KongjianRecord, KongjianSlot } from "@onethu/core";
import { Card, ErrorNote, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { info } from "../../lib/clients.js";
import { useApp } from "../../state/context.js";
import { TabEmpty, isServiceUnavailable, logTabErr, tabErrorText } from "./tabStates.js";

type LoadState = "loading" | "error" | "ready";

const MYHOME_KEY = "onethu.kongjian.profile";

function loadProfile(): { name: string; sid: string; tel: string } {
  try {
    return JSON.parse(localStorage.getItem(MYHOME_KEY) ?? "{}") as { name: string; sid: string; tel: string };
  } catch {
    return { name: "", sid: "", tel: "" };
  }
}

/** 场次可约：有确认链接即视为可约（状态文案服务端给啥显示啥） */
function slotBookable(slot: KongjianSlot): boolean {
  return Boolean(slot.bookUrl);
}

export function KongjianTab() {
  const { status } = useApp();
  const [page, setPage] = useState<KongjianPage | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState<string>("");
  const [roomId, setRoomId] = useState<string>("");
  const [date, setDate] = useState<string>("");
  const [picked, setPicked] = useState<KongjianSlot | null>(null);
  const [profile, setProfile] = useState(loadProfile);
  const [purpose, setPurpose] = useState("活动");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [records, setRecords] = useState<KongjianRecord[] | null>(null);
  const [recState, setRecState] = useState<LoadState>("loading");

  const fail = useCallback((err: unknown) => {
    logTabErr("KONGJIAN", err);
    setUnavailable(isServiceUnavailable(err));
    setError(tabErrorText(err));
    setState("error");
  }, []);

  const loadSpaces = useCallback(async () => {
    if (status !== "ready") return;
    setState("loading");
    setUnavailable(false);
    setError(null);
    try {
      const p = await info.kongjianPage();
      setPage(p);
      setSpaceId(p.selectedSpace ?? "");
      setState("ready");
      if (p.spaces.length === 0) {
        // 空列表多半是门户页兜底未命中：走 logTabErr 的硬刷新守卫（20s 内最多 2 次）
        logTabErr("KONGJIAN", new Error("公共空间列表为空（门户页兜底未命中）"));
      }
    } catch (err) {
      fail(err);
    }
  }, [status, fail]);

  const loadSlots = useCallback(
    async (sp: string, rm: string, d: string) => {
      setState("loading");
      setUnavailable(false);
      setError(null);
      setPicked(null);
      try {
        const p = await info.kongjianPage({ spaceId: sp, roomId: rm, date: d });
        setPage(p);
        setState("ready");
      } catch (err) {
        fail(err);
      }
    },
    [fail],
  );

  const loadRecords = useCallback(async () => {
    setRecState("loading");
    try {
      const list = await info.kongjianMy();
      setRecords(list);
      setRecState("ready");
    } catch (err) {
      logTabErr("KONGJIAN-MY", err);
      setRecords([]);
      setRecState("ready"); // 我的预约拉不到不阻塞主流程
    }
  }, []);

  useEffect(() => {
    void loadSpaces();
    void loadRecords();
  }, [loadSpaces, loadRecords]);

  const pickSpace = (id: string) => {
    setSpaceId(id);
    setRoomId("");
    setDate("");
    void loadSlots(id, "", "");
  };
  const pickRoom = (id: string) => {
    setRoomId(id);
    void loadSlots(spaceId, id, date);
  };
  const pickDate = (d: string) => {
    setDate(d);
    void loadSlots(spaceId, roomId, d);
  };

  const submit = useCallback(async () => {
    if (!picked?.bookUrl) return;
    setBusy(true);
    setNotice(null);
    try {
      const msg = await info.kongjianBook(picked.bookUrl, {
        name: profile.name,
        sid: profile.sid,
        tel: profile.tel,
        other: purpose,
      });
      localStorage.setItem(MYHOME_KEY, JSON.stringify(profile));
      setNotice(`${msg}：${picked.date} ${picked.time}（${picked.state || "已提交"}）`);
      setPicked(null);
      void loadRecords();
    } catch (err) {
      setNotice(`提交失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [picked, profile, purpose, loadRecords]);

  const cancel = useCallback(
    async (rec: KongjianRecord) => {
      if (!rec.cancelTarget) return;
      if (!window.confirm(`取消预约：${rec.space} ${rec.time}？`)) return;
      try {
        await info.kongjianCancel(rec.cancelTarget);
        void loadRecords();
      } catch (err) {
        window.alert(`取消失败：${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [loadRecords],
  );

  const spaces = page?.spaces ?? [];
  // 场次按上下午分块展示（对齐体育页风格：块内时间胶囊）
  const slots = page?.slots ?? [];
  const buckets: Array<[string, KongjianSlot[]]> = [
    ["上午", slots.filter((x) => Number(String(x.time).split(":")[0]) < 12)],
    ["下午", slots.filter((x) => { const h = Number(String(x.time).split(":")[0]); return h >= 12 && h < 17; })],
    ["晚上", slots.filter((x) => Number(String(x.time).split(":")[0]) >= 17)],
  ];

  return (
    <>
      <SectionHead title="宿舍公共空间" aside="共享家园网 · 活动空间预约" />
      {state === "error" ? (
        <ErrorNote
          text={unavailable ? "共享家园网暂不可用，请稍后重试。" : (error ?? "")}
          onRetry={() => (spaceId ? void loadSlots(spaceId, roomId, date) : void loadSpaces())}
        />
      ) : null}
      {state === "loading" ? <SkeletonRows rows={4} /> : null}
      {state === "ready" && (page?.spaces.length ?? 0) === 0 ? (
        <TabEmpty text="未获取到公共空间列表（可能未开放或登录态失效）。" />
      ) : null}

      {state === "ready" && page && page.spaces.length > 0 ? (
        <>
          <Card style={{ marginBottom: 12, padding: "12px 14px" }}>
            <div className="field" style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 12, opacity: 0.7 }}>公共空间</label>
              <select
                className="input"
                value={spaceId}
                onChange={(e) => pickSpace(e.target.value)}
                style={{ height: 34, fontSize: 13 }}
              >
                <option value="">选择空间（{page.spaces.length} 个）…</option>
                {spaces.map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.name}
                  </option>
                ))}
              </select>
            </div>
            {page.rooms.length > 0 ? (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>房间</div>
                <select
                  className="input filter-select"
                  value={roomId || page.selectedRoom || ""}
                  onChange={(e) => pickRoom(e.target.value)}
                >
                  <option value="">全部房间…</option>
                  {page.rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {page.dates.length > 0 ? (
              <div>
                <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>日期</div>
                <select
                  className="input filter-select"
                  value={date}
                  onChange={(e) => pickDate(e.target.value)}
                >
                  {page.dates.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {page.info ? (
              <div style={{ fontSize: 11, opacity: 0.6, marginTop: 8 }}>{page.info}</div>
            ) : null}
          </Card>

          {slots.length === 0 && (spaceId || page.selectedRoom) ? (
            <Card style={{ marginBottom: 12 }}>
              <div className="empty">该房间/日期暂无开放场次。</div>
            </Card>
          ) : null}
          {buckets
            .filter(([, list]) => list.length > 0)
            .map(([label, list]) => (
              <Card key={label} style={{ marginBottom: 12, padding: "12px 14px" }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{label}</div>
                <div className="slot-grid">
                  {list.map((slot, i) => {
                    const bookable = slotBookable(slot);
                    const pickedNow = picked?.date === slot.date && picked?.time === slot.time;
                    return (
                      <button
                        key={`${slot.date}-${slot.time}-${i}`}
                        className={"slot-cell" + (pickedNow ? " picked" : bookable ? "" : " taken")}
                        title={slot.state}
                        disabled={!bookable}
                        onClick={() => bookable && setPicked(slot)}
                      >
                        <b>{slot.time}</b>
                        <small>{bookable ? "可约" : slot.state || "不可约"}</small>
                      </button>
                    );
                  })}
                </div>
              </Card>
            ))}

          {picked ? (
            <>
              <SectionHead title="确认预约" aside={`${picked.date} ${picked.time}`} />
              <Card style={{ marginBottom: 14, padding: "12px 14px" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                <input className="input" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} placeholder="姓名" style={{ flex: 1, minWidth: 120, height: 32, fontSize: 13 }} />
                <input className="input" value={profile.sid} onChange={(e) => setProfile({ ...profile, sid: e.target.value })} placeholder="学号" style={{ flex: 1, minWidth: 120, height: 32, fontSize: 13 }} />
                <input className="input" value={profile.tel} onChange={(e) => setProfile({ ...profile, tel: e.target.value })} placeholder="电话" style={{ flex: 1, minWidth: 120, height: 32, fontSize: 13 }} />
              </div>
              <textarea className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="用途（选填）" rows={2} style={{ width: "100%", fontSize: 13, padding: "8px 10px", marginBottom: 8, boxSizing: "border-box", resize: "vertical" }} />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="btn" style={{ height: 28 }} onClick={() => setPicked(null)}>
                  取消
                </button>
                  <button className="btn" style={{ height: 28 }} onClick={() => setPicked(null)}>
                    取消
                  </button>
                  <button className="btn btn-primary" style={{ height: 28 }} disabled={busy} onClick={() => void submit()}>
                    {busy ? "提交中…" : "确定预约"}
                  </button>
                </div>
              </Card>
            </>
          ) : null}

          {notice ? (
            <Card style={{ marginBottom: 12 }}>
              <div className="empty">{notice}</div>
            </Card>
          ) : null}

          <SectionHead title="我的预约" aside="公共空间预约记录" />
          {recState === "loading" && !records ? <SkeletonRows rows={3} /> : null}
          {records && records.length === 0 ? <TabEmpty text="暂无预约记录。" /> : null}
          {records && records.length > 0 ? (
            records.map((rec, i) => (
              <Card key={i} style={{ marginBottom: 8, padding: "10px 14px" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{rec.space}</div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>{rec.time}</div>
                  <div style={{ marginLeft: "auto", fontSize: 12, opacity: 0.75 }}>{rec.status}</div>
                </div>
                {rec.cancelTarget ? (
                  <div style={{ marginTop: 6, textAlign: "right" }}>
                    <button className="btn" style={{ height: 26, fontSize: 12 }} onClick={() => void cancel(rec)}>
                      取消预约
                    </button>
                  </div>
                ) : null}
              </Card>
            ))
          ) : null}
        </>
      ) : null}
    </>
  );
}
