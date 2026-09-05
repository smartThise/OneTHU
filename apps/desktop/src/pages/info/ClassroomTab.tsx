/**
 * 空教室 —— info.getClassroomList + getClassroomState（thu-info-app
 * classroomList/classroomDetail 移植）。两级只读视图：教学楼列表 → 本周状态，
 * 今天 6 大节空闲格（绿=空闲）。空数据/维护态铁律见 tabStates.tsx。
 */
import { useCallback, useEffect, useState } from "react";
import { Card, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { SearchSelect } from "../../components/SearchSelect.jsx";
import { info } from "../../lib/clients.js";
import { useApp } from "../../state/context.js";
import { CollectStar } from "../../components/Collect.js";
import { enc, noteAtomCache } from "../../state/atoms.js";
import { TabEmpty, TabError, isServiceUnavailable, logTabErr, tabErrorText } from "./tabStates.js";

type LoadState = "loading" | "error" | "ready";
/** core getClassroomList → 教学楼（name=显示名，weekNumber=当前周，searchName=查询参数） */
type ClassroomBuilding = Awaited<ReturnType<typeof info.getClassroomList>>[number];
type ClassroomResult = Awaited<ReturnType<typeof info.getClassroomState>>;

const SLOT_LABELS = ["第1节", "第2节", "第3节", "第4节", "第5节", "第6节"];

/** 大节筛选：勾选框下拉（可多选大节，只看所选大节全空闲的教室） */
function SlotFilterDropdown({ value, onChange }: { value: Set<number>; onChange: (s: Set<number> | ((prev: Set<number>) => Set<number>)) => void }) {
  const [open, setOpen] = useState(false);
  const label =
    value.size === 0
      ? "大节筛选：全部教室"
      : `大节筛选：${[...value].sort((a, b) => a - b).map((i) => SLOT_LABELS[i]).join("、")}`;
  return (
    <div className="filter-dd">
      <button type="button" className="input filter-dd-btn" onClick={() => setOpen((o) => !o)}>
        <span>{label}</span>
        <span style={{ opacity: 0.55 }}>▾</span>
      </button>
      {open ? (
        <>
          <div className="seg-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="filter-dd-panel">
            {SLOT_LABELS.map((s, si) => (
              <label key={s} className="filter-dd-opt">
                <input
                  type="checkbox"
                  checked={value.has(si)}
                  onChange={() =>
                    onChange(() => {
                      const next = new Set(value);
                      if (next.has(si)) next.delete(si);
                      else next.add(si);
                      return next;
                    })
                  }
                />
                {s}
              </label>
            ))}
            {value.size > 0 ? (
              <button type="button" className="btn btn-ghost" style={{ marginTop: 4 }} onClick={() => onChange(new Set())}>
                清空（显示全部）
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** core ClassroomStatus.AVAILABLE = 5（数值枚举，42 格=7 天 × 6 节，周一起） */
const AVAILABLE = 5;

export function ClassroomTab({
  deepBuilding, deepBuildingName, deepRoom,
}: {
  /** 深链（实体原子）：自动选中的教学楼 searchName */
  deepBuilding?: string;
  deepBuildingName?: string;
  /** 要高亮滚动的教室名 */
  deepRoom?: string;
} = {}) {
  const { status } = useApp();

  /* —— 一级：教学楼列表 —— */
  const [buildings, setBuildings] = useState<ClassroomBuilding[] | null>(null);
  const [bState, setBState] = useState<LoadState>("loading");
  const [bUnavailable, setBUnavailable] = useState(false);
  const [bError, setBError] = useState<string | null>(null);

  /* —— 二级：选中教学楼的本周状态 —— */
  const [sel, setSel] = useState<ClassroomBuilding | null>(null);
  const [result, setResult] = useState<ClassroomResult | null>(null);
  const [rState, setRState] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [rUnavailable, setRUnavailable] = useState(false);
  const [rError, setRError] = useState<string | null>(null);

  /* 大节筛选：空集=显示全部 6 节；选中集合=只显示所选大节列 */
  const [selSlots, setSelSlots] = useState<Set<number>>(new Set());

  /* 深链只落一次的把关（对象 ref 即可，无需触发渲染） */
  const deepApplied = { current: false };
  const loadBuildings = useCallback(async () => {
    if (status !== "ready") return;
    setBState("loading");
    setBUnavailable(false);
    setBError(null);
    try {
      const list = await info.getClassroomList();
      setBuildings(list);
      setBState("ready");
      noteAtomCache({ classroomBuildings: list.map((b) => ({ searchName: b.searchName, name: b.name })) });
      // 深链：目录就绪后自动选中目标教学楼
      if (deepBuilding && !deepApplied.current) {
        const b = list.find((x) => x.searchName === deepBuilding);
        if (b) {
          deepApplied.current = true;
          void loadState(b);
        }
      }
    } catch (err) {
      logTabErr("CLASSROOM-LIST", err);
      setBUnavailable(isServiceUnavailable(err));
      setBError(tabErrorText(err));
      setBState("error");
    }
  }, [status]);

  const loadState = useCallback(async (b: ClassroomBuilding) => {
    setSel(b);
    setRState("loading");
    setRUnavailable(false);
    setRError(null);
    try {
      setResult(await info.getClassroomState(b.searchName, b.weekNumber));
      setRState("ready");
    } catch (err) {
      logTabErr("CLASSROOM-STATE", err);
      setRUnavailable(isServiceUnavailable(err));
      setRError(tabErrorText(err));
      setRState("error");
    }
  }, []);

  useEffect(() => {
    void loadBuildings();
  }, [loadBuildings]);

  /** 今天在 7 天列中的下标（周一=0） */
  const todayCol = (new Date().getDay() + 6) % 7;
  const allRows = result?.classroomStates ?? [];
  /** 大节筛选语义（用户定案）：选中若干大节 → 只显示这些大节（今日）全部空闲的教室行 */
  const rows =
    selSlots.size > 0
      ? allRows.filter((r) =>
          [...selSlots].every((si) => (r.status?.[todayCol * 6 + si] ?? -1) === AVAILABLE),
        )
      : allRows;
  const freeToday = rows.filter((r) =>
    SLOT_LABELS.some((_, s) => (r.status?.[todayCol * 6 + s] ?? -1) === AVAILABLE),
  ).length;

  /* 深链：教室状态就绪后高亮并滚动到目标教室行 */
  useEffect(() => {
    if (rState !== "ready" || !deepRoom) return;
    const el = Array.from(document.querySelectorAll<HTMLElement>("[data-room]")).find(
      (n) => n.getAttribute("data-room") === deepRoom,
    );
    if (!el) return;
    el.classList.add("fav-dl-flash");
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [rState, rows, deepRoom]);

  if (status === "demo") {
    return <TabEmpty text="演示模式不提供空教室数据，登录后可查询本周空闲教室。" />;
  }

  return (
    <>
      <SectionHead
        title="教学楼"
        aside={bState === "ready" ? `${buildings?.length ?? 0} 栋 · 点击查询本周状态` : "教学 Tina · 教室资源"}
      />
      {bState === "error" ? (
        <TabError unavailable={bUnavailable} text={bError} onRetry={() => void loadBuildings()} />
      ) : null}
      {bState === "loading" && !buildings ? (
        <SkeletonRows rows={4} />
      ) : (buildings?.length ?? 0) === 0 ? (
        <TabEmpty text="暂无教室资源数据（可能不在上课周期，或服务暂未开放）。" />
      ) : (
        <SearchSelect
          value={sel?.searchName ?? ""}
          onChange={(v) => {
            const b = buildings!.find((x) => x.searchName === v);
            if (b) void loadState(b);
          }}
          placeholder="选择教学楼…"
          options={buildings!.map((b) => ({ value: b.searchName, label: b.name }))}
        />
      )}

      {sel ? (
        <>
          <SectionHead
            title={`${sel.name} · 本周`}
            aside={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span>{result?.currentWeekNumber
                ? `第 ${result.currentWeekNumber} 教学周 · 今日空闲 ${freeToday} 间${selSlots.size > 0 ? ` · 所选 ${selSlots.size} 节全空闲 ${rows.length} 间` : ""}（下表为今日）`
                : undefined
            }</span>
              <CollectStar atom={{ kind: "classroom-b", key: enc(sel.searchName, sel.name) }} title={sel.name} />
            </span>
          }
          />
          {rState === "error" ? (
            <TabError unavailable={rUnavailable} text={rError} onRetry={() => void loadState(sel)} />
          ) : null}
          {rState === "loading" ? (
            <SkeletonRows rows={6} />
          ) : rState === "ready" ? (
            <>
              {/* 筛选栏常驻 ready 态——空结果也保留，否则没法取消筛选 */}
              <SlotFilterDropdown value={selSlots} onChange={setSelSlots} />
              {rows.length === 0 ? (
                <TabEmpty
                  text={
                    selSlots.size > 0
                      ? "没有教室在所选大节全部空闲——试着少选几节或清空筛选。"
                      : "该教学楼本周暂无教室状态数据（可能不在上课周期）。"
                  }
                />
              ) : (
              <Card style={{ padding: 0, overflow: "auto" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>教室</th>
                      {SLOT_LABELS.map((sl) => (
                        <th key={sl} className="num">
                          {sl}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={`${r.name}-${i}`} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }} data-room={r.name}>
                        <td className="cell-title" style={{ whiteSpace: "nowrap" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                            {r.name}
                            <CollectStar atom={{ kind: "classroom-r", key: enc(sel.searchName, sel.name, r.name) }} title={r.name} />
                          </span>
                        </td>
                        {SLOT_LABELS.map((sl, si) => {
                          const free = (r.status?.[todayCol * 6 + si] ?? -1) === AVAILABLE;
                          return (
                            <td key={sl} className="num">
                              <span className={free ? "chip chip-green" : "chip chip-gray"}>{free ? "空闲" : "占用"}</span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              )}
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}
