/**
 * 收藏夹方卡的实时状态件（万物原子化：实体原子 live 化）。
 * - WasherTileStatus：收藏的洗衣机设备 → 空闲 / 使用中·剩 N 分钟；
 * - ClassroomTileStatus：收藏的教室 → 本节（按当前时间落在哪个大节）空闲/占用，
 *   课间给下一节的状态，晚上给「今日课程已结束」；
 * - ClassroomRoomToday：教室长卡体 → 今日 6 大节占用总览（chips + 当前节提示）。
 * 数据走 SWR 缓存层（cacheGet 新鲜度 + cacheFetch 单飞）：同楼栋/同楼的
 * 多张收藏卡共享一个请求；洗衣机 60s / 教室列表 10min / 教室状态 3min 新鲜期。
 * 仅登录态（status==="ready"）抓取；demo/未登录渲染 null（方卡回落静态 sub）。
 * key 解码用本地 split（与 atoms.dec 同一 ~ 分隔语义），避免 atoms ↔ 本件循环引用。
 */
import { useEffect, useState } from "react";
import { getWasherDevices } from "@onethu/core";
import { useApp } from "../state/context.js";
import { cacheGet, cacheFetch } from "../state/cache.js";
import { universalFetch } from "../lib/transport.js";
import { info } from "../lib/clients.js";

const splitKey = (key: string): string[] => key.split("~");
const WASHER_TTL = 60_000;
const CLS_LIST_TTL = 10 * 60_000;
const CLS_STATE_TTL = 3 * 60_000;
/** core ClassroomStatus.AVAILABLE = 5（ClassroomTab 同款数值枚举） */
const AVAILABLE = 5;
/** 大节近似钟点（分钟）：清华本科作息，边界 ±10 分钟不影响「有没有占用」的判读 */
const SLOT_TIMES: Array<[number, number]> = [
  [480, 585], // 第1节 08:00–09:45
  [600, 705], // 第2节 10:00–11:45
  [840, 945], // 第3节 14:00–15:45
  [960, 1065], // 第4节 16:00–17:45
  [1140, 1245], // 第5节 19:00–20:45
  [1260, 1335], // 第6节 21:00–22:15
];

type Tone = "ok" | "busy" | "bad" | "muted";
interface Live {
  text: string;
  tone: Tone;
}

/** 新鲜度 + 单飞：缓存条目在 TTL 内直接用，过期静默重验 */
async function fetchFresh<T>(key: string, ttlMs: number, f: () => Promise<T>): Promise<T> {
  const e = cacheGet<T>(key);
  if (e && Date.now() - e.at < ttlMs) return e.data;
  return cacheFetch(key, f);
}

const fmt = (mins: number): string =>
  String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0");

function StatusLine({ live, loading }: { live: Live | null; loading: boolean }): React.ReactNode {
  if (!loading && !live) return null;
  const tone: Tone = loading ? "muted" : (live as Live).tone;
  const text = loading ? "状态查询中…" : (live as Live).text;
  return (
    <span className="live-line">
      <span className={"live-dot live-" + tone} aria-hidden />
      {text}
    </span>
  );
}

/* ══════════ 洗衣机设备（方卡实时状态） ══════════ */

export function WasherTileStatus({ atomKey }: { atomKey: string }): React.ReactNode {
  const { status } = useApp();
  const [bId, bName, hlsh, dev] = splitKey(atomKey);
  const [live, setLive] = useState<Live | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (status !== "ready" || !bId || !dev) {
      setLive(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    fetchFresh("fav.washer." + bId + "." + (hlsh === "1" ? "h" : "j"), WASHER_TTL, () =>
      getWasherDevices(universalFetch, { id: bId, name: bName ?? "", hlsh: hlsh === "1" }),
    )
      .then((floors) => {
        if (!alive) return;
        const w = floors
          .flatMap((f) => f.washers)
          .find((x) => (x.name || x.location || x.type || "设备") === dev);
        if (!w) setLive({ text: "未找到该设备", tone: "muted" });
        else if (w.status === "idle") setLive({ text: "空闲", tone: "ok" });
        else if (w.status === "working")
          setLive({ text: w.eta > 0 ? "使用中 · 剩 " + w.eta + " 分钟" : "使用中", tone: "busy" });
        else setLive({ text: "状态未知", tone: "muted" });
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setLive({ text: "状态未知", tone: "muted" });
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [status, bId, bName, hlsh, dev]);
  return <StatusLine live={live} loading={loading} />;
}

/* ══════════ 教室（方卡当前节 + 长卡今日总览） ══════════ */

interface RoomDay {
  /** 42 格状态（7 天 × 6 节，周一起）；未找到教室 = null */
  grid: number[] | null;
  week: number | null;
}

async function loadRoomDay(searchName: string, room: string): Promise<RoomDay> {
  const list = await fetchFresh("fav.cls.list", CLS_LIST_TTL, () => info.getClassroomList());
  const b = list.find((x) => x.searchName === searchName);
  if (!b) return { grid: null, week: null };
  const res = await fetchFresh(
    "fav.cls.state." + searchName + "." + b.weekNumber,
    CLS_STATE_TTL,
    () => info.getClassroomState(searchName, b.weekNumber),
  );
  const row = res.classroomStates.find((r) => r.name === room);
  return { grid: row ? [...row.status] : null, week: res.currentWeekNumber };
}

/** 今天那一列的 6 格（周一=0） */
function todayColumn(grid: number[] | null): number[] | null {
  if (!grid) return null;
  const col = (new Date().getDay() + 6) % 7;
  return grid.slice(col * 6, col * 6 + 6);
}

export function ClassroomTileStatus({ atomKey }: { atomKey: string }): React.ReactNode {
  const { status } = useApp();
  const [searchName, , room] = splitKey(atomKey);
  const [live, setLive] = useState<Live | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (status !== "ready" || !searchName || !room) {
      setLive(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    loadRoomDay(searchName, room)
      .then(({ grid }) => {
        if (!alive) return;
        const day = todayColumn(grid);
        if (!day) {
          setLive({ text: "未找到该教室", tone: "muted" });
          return;
        }
        const mins = new Date().getHours() * 60 + new Date().getMinutes();
        const cur = SLOT_TIMES.findIndex(([s, e]) => mins >= s && mins < e);
        const free = (si: number) => day[si] === AVAILABLE;
        if (cur >= 0) setLive({ text: "本节" + (free(cur) ? "空闲" : "占用"), tone: free(cur) ? "ok" : "bad" });
        else {
          const next = SLOT_TIMES.findIndex(([s]) => mins < s);
          if (next < 0) setLive({ text: "今日课程已结束", tone: "muted" });
          else setLive({ text: "第 " + (next + 1) + " 节起" + (free(next) ? "空闲" : "占用"), tone: free(next) ? "ok" : "bad" });
        }
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setLive({ text: "状态未知", tone: "muted" });
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [status, searchName, room]);
  return <StatusLine live={live} loading={loading} />;
}

/** 教室长卡体：今日 6 大节占用总览（chips + 当前节提示） */
export function ClassroomRoomToday({ atomKey }: { atomKey: string }): React.ReactNode {
  const { status } = useApp();
  const [searchName, , room] = splitKey(atomKey);
  const [day, setDay] = useState<number[] | null>(null);
  const [week, setWeek] = useState<number | null>(null);
  const [err, setErr] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (status !== "ready" || !searchName || !room) {
      setDay(null);
      setErr(false);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setErr(false);
    loadRoomDay(searchName, room)
      .then((r) => {
        if (!alive) return;
        setDay(todayColumn(r.grid));
        setWeek(r.week);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setErr(true);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [status, searchName, room]);
  if (loading) return <div className="live-note">今日情况查询中…</div>;
  if (err) return <div className="live-note">今日情况获取失败，可下拉重进刷新。</div>;
  if (!day) return null;
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const cur = SLOT_TIMES.findIndex(([s, e]) => mins >= s && mins < e);
  const freeCnt = SLOT_TIMES.filter((_, si) => day[si] === AVAILABLE).length;
  return (
    <div className="live-today">
      <div className="live-today-head">
        {week ? "第 " + week + " 教学周 · " : ""}周{"日一二三四五六"[now.getDay()]} · 空闲 {freeCnt}/6 节
      </div>
      <div className="live-chip-row">
        {SLOT_TIMES.map(([s, e], si) => {
          const free = day[si] === AVAILABLE;
          return (
            <span
              key={si}
              className={"live-chip " + (free ? "is-free" : "is-busy") + (si === cur ? " is-now" : "")}
              title={"第" + (si + 1) + "节 " + fmt(s) + "–" + fmt(e) + (free ? " · 空闲" : " · 占用")}
            >
              {si + 1}
            </span>
          );
        })}
      </div>
      <div className="live-note">
        {cur >= 0 ? "当前第 " + (cur + 1) + " 节" + (day[cur] === AVAILABLE ? "空闲" : "有课") : "当前无课"}
      </div>
    </div>
  );
}
