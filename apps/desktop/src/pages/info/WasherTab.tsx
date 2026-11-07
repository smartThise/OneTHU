import { t as i18n, useLocale as useUiLocale } from "../../i18n/index.js";
import { Input } from "@onethu/gui";
/**
 * 洗衣机页 —— 楼栋分组 → 楼层设备状态。
 * thu-info-app 移植：捷利（api.cleverschool.cn）+ 海乐生活（yshz-user.haier-ioc.com）
 * + 小兰智慧（wash-ltd-thu.aajax.top）三处公开接口，无需校内会话。
 * 设备状态：空闲（绿）/ 运行中·剩余分钟（琥珀）/ 待机·离线（灰）/ 故障（红）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { WasherBuilding, WasherBuildingGroup, WasherDevice } from "@onethu/core";
import {
  getWasherBuildingGroups, getWasherDevices, WASHER_PROVIDER_LABEL,
  washerProviderCode, washerProviderOf,
} from "@onethu/core";
import { Card, Empty, ErrorNote, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { logLine } from "../../lib/clients.js";
import { explainNetworkError, universalFetch } from "../../lib/transport.js";
import { useApp } from "../../state/context.js";
import { CollectStar } from "../../components/Collect.js";
import { enc, noteAtomCache } from "../../state/atoms.js";
import { getWasherChoice, setWasherChoice } from "../../state/washerPref.js";

function logErr(tag: string, err: unknown): void {
  void logLine(
    "PAGE-ERR " + tag + " " + (err instanceof Error ? err.message : String(err)),
  ).catch(() => undefined);
}

type LoadState = "loading" | "error" | "ready";
type DeviceState = "idle" | "loading" | "error" | "ready";

/** 设备编号 → 设备名称（用户 2026-11-01 提供）：he 波轮 / hr 滚筒 / wm 洗鞋机 / dr 烘干机；
 *  hs 与纯数字编号含义未解，保持原编号显示。设备稳定身份（收藏/deep-link）仍用原 name。 */
const WASHER_NAME_PREFIXES: Array<[RegExp, () => string]> = [
  [/^he/i, () => i18n("pages.info.washertab.9fe9fba680f9")],
  [/^hr/i, () => i18n("pages.info.washertab.74f4be674518")],
  [/^wm/i, () => i18n("pages.info.washertab.e74dc4afd0bb")],
  [/^dr/i, () => i18n("pages.info.washertab.972ddf82a152")],
];

export function washerDisplayName(name: string): string | null {
  const raw = name.trim();
  for (const [pattern, label] of WASHER_NAME_PREFIXES) {
    if (pattern.test(raw)) return label();
  }
  return null;
}

type WasherKind = "top" | "front" | "shoe" | "dryer" | "other";

/** 设备类型 → 图标；优先看设备名前缀（he/hr/wm/dr），再看 type 中文。 */
function washerKind(w: WasherDevice): WasherKind {
  const name = w.name.trim();
  const raw = name + " " + w.type;
  if (/洗鞋|shoe/i.test(raw) || /^wm/i.test(name)) return "shoe";
  if (/烘干|dryer/i.test(raw) || /^dr/i.test(name)) return "dryer";
  if (/滚筒|front/i.test(raw) || /^hr/i.test(name)) return "front";
  if (/波轮|top/i.test(raw) || /^he/i.test(name)) return "top";
  return "other";
}

/** 线框图标：波轮俯视 / 滚筒侧视 / 鞋 / 热气。 */
function WasherTypeIcon({ kind }: { kind: WasherKind }) {
  if (kind === "front") return (
    <svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="7.5" y="3.5" width="17" height="25" rx="3.5" />
      <circle cx="16" cy="17" r="7" />
      <circle cx="16" cy="17" r="3.6" />
      <path d="M11 28.5h10" strokeLinecap="round" />
    </svg>
  );
  if (kind === "shoe") return (
    <svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4.5 23.5c0-3.2 2.2-5.3 5.4-5.3 1.9 0 3.2 1 4.3 2.2l2.9 3.1 5.4 1.4c3.1.8 4.9 2 4.9 4.1H4.5v-5.5Z" strokeLinejoin="round" />
      <path d="M9.8 18.2v-3.4c0-1.2 1-2.2 2.2-2.2h2.1" strokeLinecap="round" />
      <path d="M13.5 19.8l2.4 1.8" strokeLinecap="round" />
    </svg>
  );
  if (kind === "dryer") return (
    <svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="5.5" y="3.5" width="21" height="25" rx="3.5" />
      <circle cx="16" cy="17.5" r="6.2" />
      <path d="M9.5 9c1.8-1.7 3.7-1.7 5.5 0s3.7 1.7 5.5 0 3.7-1.7 4 0" strokeLinecap="round" />
      <path d="M12 28.5h8" strokeLinecap="round" />
    </svg>
  );
  if (kind === "top") return (
    <svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="5.5" y="4.5" width="21" height="23" rx="4" />
      <circle cx="16" cy="16" r="8" />
      <circle cx="16" cy="16" r="1.5" fill="currentColor" stroke="none" />
      <path d="M16 8.5c2.7 0 4.8 1.8 5 4.3-1.2-1.2-2.7-1.8-4.2-1.6M23.2 19.4c-1 2.5-3.2 4.1-5.8 4.1-1.5 0-2.9-.5-4-1.4M9 21.2c-.6-1.2-.9-2.5-.8-4 .2-2.4 1.8-4.4 4-5.2" strokeLinecap="round" />
    </svg>
  );
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="5.5" y="4.5" width="21" height="23" rx="4" />
      <circle cx="16" cy="16" r="8" />
      <circle cx="16" cy="16" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 设备视觉（状态点 + 徽标 + 文案）：空闲绿 / 运行中琥珀 / 待机离线灰 / 故障红。
 *  待机与离线不能都算「故障」——前者随时可用、后者是网络掉线，含义完全不同。 */
function deviceVisual(w: WasherDevice): { dot: string; chip: string; text: string } {
  if (w.status === "idle") return { dot: "is-idle", chip: "chip chip-green", text: i18n("pages.info.washertab.dae661d17c2d") };
  if (w.status === "working")
    return { dot: "is-working", chip: "chip chip-amber", text: w.eta > 0 ? i18n("pages.info.washertab.4d5ffe182d08", { eta: String(w.eta) }) : i18n("pages.info.washertab.1f0eb99b7ed0") };
  if (w.status === "standby") return { dot: "is-idle", chip: "chip chip-gray", text: i18n("pages.info.washertab.bed4c87f1838") };
  if (w.status === "offline") return { dot: "is-error", chip: "chip chip-gray", text: i18n("pages.info.washertab.be1b4f3c6c1c") };
  if (w.status === "unknown") return { dot: "is-error", chip: "chip chip-gray", text: i18n("pages.info.washertab.93e474c68ed5") };
  return { dot: "is-error", chip: "chip chip-red", text: i18n("pages.info.washertab.5a0cc6c04776") };
}

export function WasherTab({
  deepBuildingId, deepBuildingName, deepProvider, deepHlsh, deepMachine,
}: {
  /** 深链（实体原子）：自动选中的楼栋 id */
  deepBuildingId?: string;
  /** 楼栋展示名兜底 */
  deepBuildingName?: string;
  /** 楼栋所属数据源（"0"/"1"/"2"）；缺省按捷利 */
  deepProvider?: string;
  /** @deprecated 旧深链只带布尔：true = 海乐生活 */
  deepHlsh?: boolean;
  /** 要高亮滚动的设备名 */
  deepMachine?: string;
} = {}) {
  const uiLocale = useUiLocale();

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
      const list = await getWasherBuildingGroups(universalFetch);
      setGroups(list);
      setGState("ready");
      // 原子搜索缓存：楼栋目录只在本 tab 加载后入库（搜索框不主动请求）
      noteAtomCache({
        washerGroups: list.flatMap((g) =>
          g.buildings.map((b) => ({ gname: g.name, id: b.id, name: b.name, provider: washerProviderCode(b.provider) })),
        ),
      });
    } catch (err) {
      logErr("WASHER-G", err);
      setGState("error");
      setGError(explainNetworkError(err));
    }
  }, [status]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  /* 深链：设备列表就绪后高亮并滚动到目标设备 */
  useEffect(() => {
    if (dState !== "ready" || !deepMachine) return;
    const el = Array.from(document.querySelectorAll<HTMLElement>("[data-dev]")).find(
      (n) => n.getAttribute("data-dev") === deepMachine,
    );
    if (!el) return;
    el.classList.add("fav-dl-flash");
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [dState, floors, deepMachine]);

  /** 选中楼栋所属分组名（星标原子 sub 用） */
  const groupOfBuilding = (b: WasherBuilding): string | undefined =>
    (groups ?? []).find((g) => g.buildings.some((x) => x.id === b.id && x.provider === b.provider))?.name;

  const loadDevices = useCallback(async (b: WasherBuilding) => {
    setSel(b);
    // 记下这栋（首启导览问过的那栋也走这里）：下次进来自动落回，不用重选
    setWasherChoice({ provider: washerProviderCode(b.provider), id: b.id, name: b.name });
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
  /* 深链：楼栋目录就绪后自动选中目标楼栋（只落一次）。
     数据源也要一起匹配：楼栋 id 在不同数据源之间可能重名，只按 id 会选到另一家的楼栋。
     旧深链只带布尔（deepHlsh）→ 折算成 "1"/"0"，老收藏照常回原位。 */
  const deepApplied = useRef(false);
  const wantProvider = deepProvider ?? (deepHlsh === undefined ? undefined : deepHlsh ? "1" : "0");
  useEffect(() => {
    if (deepApplied.current || gState !== "ready" || !groups || !deepBuildingId) return;
    deepApplied.current = true;
    const want = washerProviderOf(wantProvider);
    for (const g of groups) {
      const b =
        g.buildings.find((x) => x.id === deepBuildingId && x.provider === want) ??
        g.buildings.find((x) => x.id === deepBuildingId);   // 数据源对不上时退而求其次：至少进到这个 id
      if (b) {
        void loadDevices(b);
        return;
      }
    }
  }, [groups, gState, deepBuildingId, wantProvider, loadDevices]);

  /* 楼栋列表就绪后，若还没选，就落回上次那栋（首启问过的那栋） */
  useEffect(() => {
    if (gState !== "ready" || sel !== null) return;
    const want = getWasherChoice();
    if (!want) return;
    const all = (groups ?? []).flatMap((g) => g.buildings);
    const hit =
      all.find((b) => b.id === want.id && washerProviderCode(b.provider) === want.provider) ??
      all.find((b) => b.name === want.name);
    if (hit) void loadDevices(hit);
  }, [gState, groups, sel, loadDevices]);

  return (
    <>
      <SectionHead
        title={i18n("pages.info.washertab.6acfa1db6a62")}
        aside={i18n("pages.info.washertab.eb6e062fe2c4")}
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
                <span>{sel ? sel.name : i18n("pages.info.washertab.20f1ae81c877")}</span>
                <span style={{ opacity: 0.55 }}>▾</span>
              </button>
              {ddOpen ? (
                <>
                  <div className="seg-menu-backdrop" onClick={() => setDdOpen(false)} />
                  <div className="filter-dd-panel">
                    <Input placeholder={i18n("pages.info.washertab.a537eecd2300")} value={query} onChange={(value) => setQuery(value)} />
                    <div className="washer-dd-list">
                      {matched.length === 0 ? (
                        <div className="washer-dd-empty">{i18n("pages.info.washertab.883871884efe")}</div>
                      ) : (
                        matched.map((g) => (
                          <div key={g.name}>
                            <div className="washer-dd-group">{g.name}</div>
                            {g.buildings.map((b) => (
                              <button
                                type="button"
                                key={`${g.name}-${b.id}`}
                                className={`filter-dd-opt washer-dd-opt${sel && b.id === sel.id && b.provider === sel.provider ? " is-sel" : ""}`}
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
          <SectionHead
            title={sel.name}
            aside={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span>{WASHER_PROVIDER_LABEL[sel.provider]}</span>
                <CollectStar
                  atom={{ kind: "washer-b", key: enc(sel.id, sel.name, washerProviderCode(sel.provider), groupOfBuilding(sel) ?? "") }}
                  title={sel.name}
                />
              </span>
            }
          />
          {dState === "loading" ? <SkeletonRows rows={4} /> : null}
          {dState === "error" ? <ErrorNote text={dError ?? ""} onRetry={() => void loadDevices(sel)} /> : null}
          {dState === "ready" && (floors ?? []).length === 0 ? (
            <Card>
              <Empty text={i18n("pages.info.washertab.d98a7674edd7")} />
            </Card>
          ) : null}
          {(floors ?? []).map((f) => {
            const free = f.washers.filter((x) => x.status === "idle").length;
            return (
              <div key={f.floor}>
                <SectionHead title={f.floor} aside={i18n("pages.info.washertab.f2ac9226cb38", { length: String(f.washers.length), free: String(free) })} />
                <div className="washer-grid">
                  {f.washers.map((w, i) => {
                    const v = deviceVisual(w);
                    // Persisted AtomRef/deep-link identities must survive locale changes.
                    const deviceKey = w.name || w.location || w.type || "设备";
                    const mapped = washerDisplayName(w.name);
                    const title = mapped ?? (w.name || w.location || w.type || i18n("pages.info.washertab.e1506406a5bd"));
                    const sub = [
                      w.location && w.location !== title ? w.location : "",
                      mapped ? "" : w.type,
                      w.updateTime ? i18n("pages.info.washertab.14f31582e7ec", { updateTime: String(w.updateTime) }) : "",
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <Card className={`washer-card ${v.dot}`} key={`${w.name}-${i}`}>
                        <span className="washer-type-icon" aria-hidden="true">
                          <WasherTypeIcon kind={washerKind(w)} />
                          <span className="washer-dot" />
                        </span>
                        <div className="washer-main" data-dev={deviceKey}>
                          <div className="washer-name">{title}</div>
                          {sub ? <div className="washer-sub">{sub}</div> : null}
                        </div>
                        <span className={v.chip}>{v.text}</span>
                        <CollectStar
                          atom={{ kind: "washer-m", key: enc(sel.id, sel.name, washerProviderCode(sel.provider), deviceKey) }}
                          title={sel.name + " · " + title}
                        />
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
