/**
 * 洗衣机页 —— 楼栋分组 → 楼层设备状态。
 * thu-info-app washer.tsx 移植：捷利（api.cleverschool.cn）+ 海乐生活
 * （yshz-user.haier-ioc.com）公开接口，无需校内会话。
 * 设备状态：空闲（绿）/ 运行中·剩余分钟（灰）/ 故障（红）。
 */
import { useCallback, useEffect, useState } from "react";
import type { WasherBuilding, WasherBuildingGroup, WasherDevice } from "@onethu/core";
import { getWasherBuildingGroups, getWasherDevices } from "@onethu/core";
import { Card, Empty, ErrorNote, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { logLine } from "../../lib/clients.js";
import { explainNetworkError, universalFetch } from "../../lib/transport.js";
import { useApp } from "../../state/context.js";

function logErr(tag: string, err: unknown): void {
  void logLine(
    "PAGE-ERR " + tag + " " + (err instanceof Error ? err.message : String(err)),
  ).catch(() => undefined);
}

type LoadState = "loading" | "error" | "ready";
type DeviceState = "idle" | "loading" | "error" | "ready";

/** 设备视觉（状态点 + 徽标 + 文案）：空闲绿 / 运行中呼吸灰 / 故障红 */
function deviceVisual(w: WasherDevice): { dot: string; chip: string; text: string } {
  if (w.status === "idle") return { dot: "is-idle", chip: "chip chip-green", text: "空闲" };
  if (w.status === "working")
    return { dot: "is-working", chip: "chip chip-amber", text: w.eta > 0 ? `剩余 ${w.eta} 分` : "运行中" };
  return { dot: "is-error", chip: "chip chip-red", text: "故障" };
}

export function WasherTab() {
  const { status } = useApp();

  const [groups, setGroups] = useState<WasherBuildingGroup[] | null>(null);
  const [gState, setGState] = useState<LoadState>("loading");
  const [gError, setGError] = useState<string | null>(null);

  const [sel, setSel] = useState<WasherBuilding | null>(null);
  const [floors, setFloors] = useState<Array<{ floor: string; washers: WasherDevice[] }> | null>(null);
  const [dState, setDState] = useState<DeviceState>("idle");
  const [dError, setDError] = useState<string | null>(null);

  const [ddOpen, setDdOpen] = useState(false);
  const [query, setQuery] = useState("");

  const loadGroups = useCallback(async () => {
    if (status !== "ready") return;
    setGState("loading");
    setGError(null);
    try {
      setGroups(await getWasherBuildingGroups(universalFetch));
      setGState("ready");
    } catch (err) {
      logErr("WASHER-G", err);
      setGState("error");
      setGError(explainNetworkError(err));
    }
  }, [status]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const loadDevices = useCallback(async (b: WasherBuilding) => {
    setSel(b);
    setDState("loading");
    setDError(null);
    try {
      setFloors(await getWasherDevices(universalFetch, b));
      setDState("ready");
    } catch (err) {
      logErr("WASHER-D", err);
      setDState("error");
      setDError(explainNetworkError(err));
    }
  }, []);

  if (status === "demo") {
    return <Empty text="演示模式不提供洗衣机数据，登录后可查看宿舍楼设备状态。" />;
  }

  return (
    <>
      <SectionHead
        title="洗衣机"
        aside="捷利 cleverschool · 海乐生活 haier-ioc（公开接口）"
      />
      {gState === "error" ? <ErrorNote text={gError ?? ""} onRetry={() => void loadGroups()} /> : null}
      {gState === "loading" && !groups ? (
        <SkeletonRows rows={3} />
      ) : (
        (() => {
          /* 楼栋搜索：按楼栋名/分组名模糊匹配（大小写不敏感），命中分组名时展开整组 */
          const q = query.trim().toLowerCase();
          const matched = (groups ?? [])
            .filter((g) => g.buildings.length > 0)
            .map((g) => ({
              ...g,
              buildings: q
                ? g.buildings.filter(
                    (b) =>
                      b.name.toLowerCase().includes(q) || g.name.toLowerCase().includes(q),
                  )
                : g.buildings,
            }))
            .filter((g) => g.buildings.length > 0);
          const pick = (b: WasherBuilding) => {
            setDdOpen(false);
            setQuery("");
            void loadDevices(b);
          };
          return (
            <div className="filter-dd">
              <button
                type="button"
                className="input filter-dd-btn"
                onClick={() => setDdOpen((o) => !o)}
              >
                <span>{sel ? sel.name : "选择楼栋…"}</span>
                <span style={{ opacity: 0.55 }}>▾</span>
              </button>
              {ddOpen ? (
                <>
                  <div className="seg-menu-backdrop" onClick={() => setDdOpen(false)} />
                  <div className="filter-dd-panel">
                    <input
                      className="input washer-dd-search"
                      placeholder="搜索楼栋…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <div className="washer-dd-list">
                      {matched.length === 0 ? (
                        <div className="washer-dd-empty">无匹配楼栋</div>
                      ) : (
                        matched.map((g) => (
                          <div key={g.name}>
                            <div className="washer-dd-group">{g.name}</div>
                            {g.buildings.map((b) => (
                              <button
                                type="button"
                                key={`${g.name}-${b.id}`}
                                className={`filter-dd-opt washer-dd-opt${sel && b.id === sel.id && !!b.hlsh === !!sel.hlsh ? " is-sel" : ""}`}
                                onClick={() => pick(b)}
                              >
                                {b.name}
                              </button>
                            ))}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          );
        })()
      )}

      {sel ? (
        <>
          <SectionHead title={sel.name} aside={sel.hlsh ? "海乐生活点位" : "捷利楼栋"} />
          {dState === "loading" ? <SkeletonRows rows={4} /> : null}
          {dState === "error" ? <ErrorNote text={dError ?? ""} onRetry={() => void loadDevices(sel)} /> : null}
          {dState === "ready" && (floors ?? []).length === 0 ? (
            <Card>
              <Empty text="该楼栋暂无设备数据。" />
            </Card>
          ) : null}
          {(floors ?? []).map((f) => {
            const free = f.washers.filter((x) => x.status === "idle").length;
            return (
              <div key={f.floor}>
                <SectionHead title={f.floor} aside={`${f.washers.length} 台设备 · 空闲 ${free} 台`} />
                <div className="washer-grid">
                  {f.washers.map((w, i) => {
                    const v = deviceVisual(w);
                    const title = w.name || w.location || w.type || "设备";
                    const sub = [
                      w.location && w.location !== title ? w.location : "",
                      w.type,
                      w.updateTime ? `更新 ${w.updateTime}` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <Card className={`washer-card ${v.dot}`} key={`${w.name}-${i}`}>
                        <span className="washer-dot" aria-hidden />
                        <div className="washer-main">
                          <div className="washer-name">{title}</div>
                          {sub ? <div className="washer-sub">{sub}</div> : null}
                        </div>
                        <span className={v.chip}>{v.text}</span>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </>
      ) : null}
    </>
  );
}
