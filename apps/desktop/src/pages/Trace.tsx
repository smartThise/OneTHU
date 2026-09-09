/**
 * 寻迹：今日日程的地图投送。
 * - 数据：今日课程/考试（教务）+ 云日历 + 本地日程（同一合并口径，与日程页一致）
 * - 地点：locationQuery 别名展开 → 高德 POI 检索（限北京海淀）→ GCJ-02 坐标
 * - 地图：Leaflet + 高德瓦片（GCJ-02 原生对齐，无需纠偏）
 * - 标注：时间+ETA（选定交通方式），颜色=时间紧迫度；点击放大弹跳 + 详情卡（前往）
 * - 导航：右上角默认地图 App 深链（高德/腾讯/百度/苹果），不自研导航
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { caldav, type ScheduleEntry } from "@onethu/core";
import { useApp } from "../state/context.js";
import { useCampusData } from "../state/data.js";
import { useCloudCal } from "../state/cloudCal.js";
import { PageHead } from "../components/Layout.js";
import { PageAtomStar } from "../components/Collect.js";
import { openExternal } from "./info/openExternal.js";
import {
  fmtEta, locationQuery, navUrl, routeEta, searchPoi, wgs84ToGcj02, traceKeyReady,
  MAP_APPS, TRAVEL_MODES, type MapApp, type Poi, type TravelMode,
} from "../lib/trace.js";

/* ───────── 常量 ───────── */

/** 清华园中心（GCJ-02）：默认视野与未定位时的回退原点 */
const CAMPUS_CENTER: [number, number] = [39.99973, 116.32615];
const LS_MODE = "onethu.trace.mode";
const LS_APP = "onethu.trace.mapapp";
const LS_POS = "onethu.trace.pos";

type Urgency = "ok" | "warn" | "urgent" | "live" | "done";
const URGENCY_COLOR: Record<Urgency, string> = {
  ok: "#2e9e5b",      // 裕量 > 30min
  warn: "#d9a406",    // 10–30min
  urgent: "#e5484d",  // < 10min
  live: "#e5484d",    // 已开始
  done: "#8a8f98",    // 已结束
};
const URGENCY_LABEL: Record<Urgency, string> = {
  ok: "充裕", warn: "留意", urgent: "紧张", live: "进行中", done: "已结束",
};

interface TraceEvent {
  title: string;
  startMs: number;
  endMs: number;
  kind: "course" | "exam" | "cloud" | "local";
  location: string;
}
interface MarkerData {
  id: string;
  poi: Poi;
  events: TraceEvent[];        // 该地点今日全部事件（按开始时间升序）
  next: TraceEvent;            // 下一个（或进行中）事件——紧迫度依据
  etaSec: number | null;
  urgency: Urgency;
}

const pad = (n: number): string => String(n).padStart(2, "0");
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function hmOf(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 紧迫度：综合事件开始时间与到达预估 */
function urgencyOf(ev: TraceEvent, etaSec: number | null, now: number): Urgency {
  if (ev.endMs <= now) return "done";
  if (ev.startMs <= now) return "live";
  const etaMs = (etaSec ?? 0) * 1000;
  const slack = ev.startMs - now - etaMs;
  if (slack > 30 * 60_000) return "ok";
  if (slack > 10 * 60_000) return "warn";
  return "urgent";
}

/* ───────── 页面 ───────── */

export function TracePage(): React.ReactNode {
  const { status } = useApp();
  const campus = useCampusData();
  const cal = useCloudCal();

  const [mode, setMode] = useState<TravelMode>(() => (localStorage.getItem(LS_MODE) as TravelMode) ?? "walk");
  const [mapApp, setMapApp] = useState<MapApp>(() => (localStorage.getItem(LS_APP) as MapApp) ?? "amap");
  const [origin, setOrigin] = useState<{ lng: number; lat: number; source: "gps" | "saved" | "default" } | null>(null);
  const [markers, setMarkers] = useState<MarkerData[] | null>(null);
  const [unresolved, setUnresolved] = useState<string[]>([]);   // 检索不到/无地点的原始地点串
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const mapDivRef = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef<string | null>(null); // Leaflet 事件闭包读最新选中
  const lastFitRef = useRef<MarkerData[] | null>(null); // fitBounds 仅随数据集变化触发
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const originLayerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<MarkerData[] | null>(null);
  markersRef.current = markers;

  /* 每分钟刷新紧迫度（不打接口，纯本地重算） */
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  /* ── 定位：先试 GPS（WGS-84→GCJ-02），失败回退默认校园中心 ── */
  const locate = useCallback(async () => {
    let got: { lng: number; lat: number; source: "gps" } | null = null;
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      got = await new Promise((resolve) => {
        const timer = window.setTimeout(() => resolve(null), 10_000);
        navigator.geolocation.getCurrentPosition(
          (p) => {
            window.clearTimeout(timer);
            const [lng, lat] = wgs84ToGcj02(p.coords.longitude, p.coords.latitude);
            resolve({ lng, lat, source: "gps" });
          },
          () => {
            window.clearTimeout(timer);
            resolve(null);
          },
          { enableHighAccuracy: true, timeout: 9000, maximumAge: 5 * 60_000 },
        );
      });
    }
    if (got) {
      try { localStorage.setItem(LS_POS, JSON.stringify({ ...got, at: Date.now() })); } catch { /* 忽略 */ }
      setOrigin(got);
      return;
    }
    try {
      const saved = localStorage.getItem(LS_POS);
      if (saved) {
        const p = JSON.parse(saved) as { lng: number; lat: number; at: number };
        if (Date.now() - p.at < 12 * 3600_000) {
          setOrigin({ lng: p.lng, lat: p.lat, source: "saved" });
          return;
        }
      }
    } catch { /* 忽略 */ }
    setOrigin({ lng: CAMPUS_CENTER[1], lat: CAMPUS_CENTER[0], source: "default" });
  }, []);
  useEffect(() => { void locate(); }, [locate]);

  /* ── 今日事件（课程/考试 + 云 + 本地，与日程页同口径） ── */
  const todayEvents = useMemo<TraceEvent[]>(() => {
    const today = ymd(new Date());
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = dayStart.getTime() + 86_400_000 - 1;
    const out: TraceEvent[] = [];
    const sched = (campus.data?.schedule ?? []) as ScheduleEntry[];
    for (const e of sched) {
      if (!e.location || e.date !== today) continue;
      const s = e.startTime ?? null;
      const t = e.endTime ?? null;
      if (!s) continue;
      const startMs = new Date(`${today}T${s}:00`).getTime();
      const endMs = t ? new Date(`${today}T${t}:00`).getTime() : startMs + 45 * 60_000;
      out.push({
        title: e.courseName,
        startMs, endMs,
        kind: e.category?.includes("考试") ? "exam" : "course",
        location: e.location,
      });
    }
    for (const [evts, kind] of [[cal.cloudEvents, "cloud"], [cal.localEvents, "local"]] as const) {
      for (const occ of caldav.expandEventSet(evts, dayStart.getTime(), dayEnd)) {
        if (!occ.location) continue;
        out.push({
          title: occ.summary,
          startMs: occ.start,
          endMs: occ.end,
          kind,
          location: occ.location,
        });
      }
    }
    return out.sort((a, b) => a.startMs - b.startMs);
  }, [campus.data?.schedule, cal.cloudEvents, cal.localEvents]);

  /* ── 地点解析 + ETA（origin/mode/事件变化时重算） ── */
  useEffect(() => {
    if (!origin) return;
    if (!traceKeyReady()) { setMarkers([]); setUnresolved([]); return; }
    let alive = true;
    setErr(null);
    (async () => {
      // 1) 唯一地点串 → POI（缓存命中率极高：楼栋不变）
      const byQuery = new Map<string, Promise<Poi | null>>();
      for (const ev of todayEvents) {
        const q = locationQuery(ev.location);
        if (!byQuery.has(q)) byQuery.set(q, searchPoi(q));
      }
      const poiByQuery = new Map<string, Poi | null>();
      await Promise.all([...byQuery.keys()].map(async (q) => {
        poiByQuery.set(q, await byQuery.get(q)!);
      }));
      if (!alive) return;

      // 2) 事件按 POI 分组（同楼多事件合并到同一标注）
      const groups = new Map<string, { poi: Poi; events: TraceEvent[] }>();
      const bad: string[] = [];
      for (const ev of todayEvents) {
        const q = locationQuery(ev.location);
        const poi = poiByQuery.get(q) ?? null;
        if (!poi) {
          if (!bad.includes(ev.location)) bad.push(ev.location);
          continue;
        }
        const key = `${poi.lng.toFixed(5)},${poi.lat.toFixed(5)}`;
        const g = groups.get(key) ?? { poi, events: [] };
        g.events.push(ev);
        groups.set(key, g);
      }
      setUnresolved(bad);

      // 3) ETA（并发小：今日去过的楼就几处）
      const entries = [...groups.values()];
      const etas = await Promise.all(entries.map((g) => routeEta(origin, g.poi, mode)));
      if (!alive) return;

      const nowMs = Date.now();
      const ms: MarkerData[] = entries.map((g, i) => {
        const events = [...g.events].sort((a, b) => a.startMs - b.startMs);
        // 紧迫度代表事件：进行中的优先，否则下一个未开始的，否则最后一个（已结束）
        // 分组必有 ≥1 事件；末位兜底非空断言安全
        const next = events.find((e) => e.startMs <= nowMs && e.endMs > nowMs)
          ?? events.find((e) => e.startMs > nowMs)
          ?? events[events.length - 1]!;
        return {
          id: `${g.poi.lng.toFixed(5)},${g.poi.lat.toFixed(5)}`,
          poi: g.poi,
          events,
          next,
          etaSec: etas[i] ?? null,
          urgency: urgencyOf(next, etas[i] ?? null, nowMs),
        };
      });
      ms.sort((a, b) => a.next.startMs - b.next.startMs);
      setMarkers(ms);
      if (ms.length === 0 && bad.length === 0 && todayEvents.length === 0) setErr(null);
    })().catch(() => {
      if (alive) setErr("地点解析失败，请稍后重试。");
    });
    return () => { alive = false; };
  }, [todayEvents, origin, mode]);

  /* ── Leaflet 初始化（一次） ── */
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;
    const map = L.map(mapDivRef.current, {
      center: CAMPUS_CENTER,
      zoom: 15,
      zoomControl: false,
      attributionControl: false,
    });
    L.tileLayer("https://webrd0{s}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scale=1&style=8", {
      subdomains: ["1", "2", "3", "4"],
      maxZoom: 18,
    }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    originLayerRef.current = L.layerGroup().addTo(map);
    map.on("move zoom", () => {
      if (!selectedIdRef.current) return;
      const m = markersRef.current?.find((x) => x.id === selectedIdRef.current);
      if (m) setAnchor(pointOf(map, m));
    });
    map.on("click", () => {
      selectedIdRef.current = null;
      setSelectedId(null);
      setAnchor(null);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  function pointOf(map: L.Map, m: MarkerData): { x: number; y: number } {
    const p = map.latLngToContainerPoint(L.latLng(m.poi.lat, m.poi.lng));
    return { x: p.x, y: p.y };
  }

  /* ── 绘制：事件标注 + 用户位置 ── */
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const markersChanged = lastFitRef.current !== markers;
    lastFitRef.current = markers;
    if (!markers || markers.length === 0) return;

    for (const m of markers) {
      const color = URGENCY_COLOR[urgencyOf(m.next, m.etaSec, now)];
      const sel = m.id === selectedId;
      const urg = urgencyOf(m.next, m.etaSec, now);
      const timeLabel = hmOf(m.next.startMs);
      const etaLabel = urg === "done" ? URGENCY_LABEL.done : fmtEta(m.etaSec);
      const html = `
        <div class="trace-pin${sel ? " is-sel" : ""}" style="--pin:${color}">
          <div class="trace-pin-label">${timeLabel} · ${etaLabel}</div>
          <div class="trace-pin-head"></div>
          <div class="trace-pin-tip"></div>
        </div>`;
      const icon = L.divIcon({
        className: "trace-pin-wrap",
        html,
        iconSize: [26, 34],
        iconAnchor: [13, 34],
      });
      const mk = L.marker(L.latLng(m.poi.lat, m.poi.lng), { icon, keyboard: false });
      mk.on("click", (e) => {
        L.DomEvent.stopPropagation(e as unknown as Event);
        selectedIdRef.current = m.id;
        setSelectedId(m.id);
        setAnchor(pointOf(map, m));
      });
      layer.addLayer(mk);
    }
    // 视野：标注 + 我的位置
    if (markersChanged) {
      const pts: L.LatLngExpression[] = markers.map((m) => [m.poi.lat, m.poi.lng]);
      if (origin) pts.push([origin.lat, origin.lng]);
      map.fitBounds(L.latLngBounds(pts).pad(0.25), { animate: true });
    }
  }, [markers, selectedId, origin, now]);

  /* 用户位置标注（蓝点脉冲） */
  useEffect(() => {
    const map = mapRef.current;
    const layer = originLayerRef.current;
    if (!map || !layer || !origin) return;
    layer.clearLayers();
    L.marker(L.latLng(origin.lat, origin.lng), {
      icon: L.divIcon({ className: "trace-me-wrap", html: `<div class="trace-me"><i></i></div>`, iconSize: [16, 16], iconAnchor: [8, 8] }),
      interactive: false,
    }).addTo(layer);
  }, [origin]);

  /* ── 详情卡（锚定标注屏幕坐标，越界钳制） ── */
  const selected = markers?.find((m) => m.id === selectedId) ?? null;
  useEffect(() => {
    if (!selected || !anchor) return;
    // 卡片尺寸 260×自适应：x 居中钳制在容器内
    const el = mapDivRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.max(140, Math.min(anchor.x, r.width - 140));
    const y = anchor.y - 12; // 卡底对准标注头顶
    setAnchorClamped({ x, y: Math.max(10, y) });
  }, [selected, anchor]);
  const [anchorClamped, setAnchorClamped] = useState<{ x: number; y: number } | null>(null);

  const onGo = (m: MarkerData): void => {
    void openExternal(navUrl(mapApp, { lng: m.poi.lng, lat: m.poi.lat, name: m.poi.name }));
  };

  const setModePersist = (m: TravelMode): void => {
    setMode(m);
    localStorage.setItem(LS_MODE, m);
  };
  const setAppPersist = (a: MapApp): void => {
    setMapApp(a);
    localStorage.setItem(LS_APP, a);
  };

  const modeLabel = TRAVEL_MODES.find((m) => m.id === mode)?.label ?? "步行";
  const appLabel = MAP_APPS.find((a) => a.id === mapApp)?.label ?? "高德";

  return (
    <>
      <PageHead
        title="寻迹"
        meta={`今日 ${todayEvents.length} 个日程 · ${markers?.length ?? "…"} 处地点${unresolved.length > 0 ? ` · ${unresolved.length} 处未识别` : ""}`}
        actions={
          <>
            <PageAtomStar atomKey="trace" title="寻迹" />
            <label className="trace-opt" title="常用交通方式（决定标注上的路程时间）">
              <select value={mode} onChange={(e) => setModePersist(e.target.value as TravelMode)}>
                {TRAVEL_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
              <span>{modeLabel}时间</span>
            </label>
            <label className="trace-opt" title="前往时调起的地图应用">
              <select value={mapApp} onChange={(e) => setAppPersist(e.target.value as MapApp)}>
                {MAP_APPS.map((a) => <option key={a.id} value={a.id}>{a.label}地图</option>)}
              </select>
              <span>用{appLabel}前往</span>
            </label>
          </>
        }
      />

      {!traceKeyReady() ? (
        <div className="trace-note trace-note-err">
          高德 Web 服务 Key 未配置：POI 定位与路程估算不可用（地图与今日日程仍可查看）。请发布前在 src/lib/trace.ts 注入 Key。
        </div>
      ) : null}
      {err ? <div className="trace-note trace-note-err">{err}</div> : null}
      {origin?.source === "default" ? (
        <div className="trace-note">未获取到定位（已回退清华园中心），ETA 以此计算。
          <button className="btn trace-retry" onClick={() => void locate()}>重试定位</button>
        </div>
      ) : null}
      {origin?.source === "saved" ? (
        <div className="trace-note">使用最近一次定位的位置计算 ETA。<button className="btn trace-retry" onClick={() => void locate()}>重新定位</button></div>
      ) : null}
      {unresolved.length > 0 ? (
        <div className="trace-note" title={unresolved.join("、")}>未在海淀区找到地点：{unresolved.join("、")}</div>
      ) : null}

      <div className="trace-map-wrap">
        <div ref={mapDivRef} className="trace-map" />
        {markers != null && markers.length === 0 ? (
          <div className="trace-empty">
            {todayEvents.length === 0 ? "今天没有带地点的日程。" : "今日日程的地点都没能定位到海淀区的 POI。"}
          </div>
        ) : null}

        {/* 详情卡：锚定选中标注 */}
        {selected && anchorClamped ? (
          <div className="trace-card" style={{ left: anchorClamped.x, top: anchorClamped.y }}>
            <div className="trace-card-title">
              <span className="trace-card-dot" style={{ background: URGENCY_COLOR[selected.urgency] }} />
              {selected.poi.name}
              <button className="trace-card-x" aria-label="关闭" onClick={() => { setSelectedId(null); setAnchor(null); }}>✕</button>
            </div>
            <div className="trace-card-sub">
              {selected.poi.address || "清华大学"} · {URGENCY_LABEL[selected.urgency]}
              {selected.urgency !== "done" && selected.etaSec != null ? ` · ${modeLabel} ${fmtEta(selected.etaSec)}` : ""}
            </div>
            <div className="trace-card-evs">
              {selected.events.map((ev, i) => {
                const u = urgencyOf(ev, selected.etaSec, now);
                return (
                  <div className="trace-card-ev" key={i} style={{ "--ev": URGENCY_COLOR[u] } as React.CSSProperties}>
                    <span className="trace-card-ev-time">{hmOf(ev.startMs)}–{hmOf(ev.endMs)}</span>
                    <span className="trace-card-ev-title">{ev.title}</span>
                    <span className="trace-card-ev-kind">{ev.kind === "exam" ? "考试" : ev.kind === "course" ? "课程" : "日程"}</span>
                  </div>
                );
              })}
            </div>
            <button className="btn btn-primary trace-card-go" onClick={() => onGo(selected)}>
              前往（{appLabel}地图）
            </button>
          </div>
        ) : null}

        {/* 图例 */}
        <div className="trace-legend">
          {[["ok", "裕量>30分"], ["warn", "≤30分"], ["urgent", "≤10分"], ["live", "进行中"], ["done", "已结束"]].map(([u, label]) => (
            <span key={u} className="trace-legend-item"><i style={{ background: URGENCY_COLOR[u as Urgency] }} />{label}</span>
          ))}
        </div>
      </div>
    </>
  );
}
