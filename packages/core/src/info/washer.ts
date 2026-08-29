/**
 * 洗衣机 —— thu-info-app 真实实现移植（apps/thu-info-app/src/ui/home/washer.tsx）。
 * dorm.ts 内无洗衣机实现：端点以 RN 端 UI 内 fetch 为准逐字段移植。
 * 捷利/海乐生活为第三方公开服务，无需校内会话，不走 HttpClient（避免被 WebVPN 包装）。
 *
 * - 捷利：POST https://api.cleverschool.cn/washapi4/device/tower   楼栋列表
 *         POST https://api.cleverschool.cn/washapi4/device/status  按楼栋设备状态
 *         GET  https://app.cs.tsinghua.edu.cn/Api/JieliWashers?building=…  安装位置（best-effort）
 * - 海乐生活：POST https://yshz-user.haier-ioc.com/position/nearPosition        点位
 *            POST https://yshz-user.haier-ioc.com/position/deviceDetailPage    设备
 */
import type { FetchLike } from "../http.js";

export interface WasherBuilding {
  name: string;
  id: string;
  /** true = 海乐生活（海尔 IoT），false = 捷利 */
  hlsh: boolean;
}

export interface WasherBuildingGroup {
  name: string;
  buildings: WasherBuilding[];
}

export interface WasherDevice {
  /** 设备类型（洗衣机 / 洗鞋机 / 烘干机 / 捷利 macUnionCode 前段） */
  type: string;
  name: string;
  floor: string;
  status: "idle" | "working" | "error";
  /** 剩余分钟（捷利；海乐无 → -1） */
  eta: number;
  /** 状态更新时间（原文，如 "10:32"） */
  updateTime: string;
  /** 安装位置（thu-info app 后端，best-effort） */
  location?: string;
}

async function postJson<T>(fetchLike: FetchLike, url: string, body: unknown): Promise<T> {
  const res = await fetchLike(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`洗衣机服务响应异常（HTTP ${res.status}）`);
  }
}

/** 楼栋名排序：先按名字里的数字，再按字典序（washer.tsx 同款规则） */
function compareBuilding(a: WasherBuilding, b: WasherBuilding): number {
  const an = /\d+/.exec(a.name)?.[0];
  const bn = /\d+/.exec(b.name)?.[0];
  if (an !== undefined && bn !== undefined) {
    const diff = Number.parseInt(an, 10) - Number.parseInt(bn, 10);
    if (diff !== 0) return diff;
  }
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * 楼栋分组（washer.tsx：紫荆/南区/双清按名字包含归类，其余入「其他位置」；
 * 海乐生活点位固定清华坐标 nearPosition，名字含「清华」者入选）。海乐失败不影响捷利列表。
 */
export async function getWasherBuildingGroups(fetchLike: FetchLike): Promise<WasherBuildingGroup[]> {
  const jieli: WasherBuildingGroup[] = [
    { name: "紫荆公寓", buildings: [] },
    { name: "南区宿舍", buildings: [] },
    { name: "双清公寓", buildings: [] },
    { name: "其他位置", buildings: [] },
  ];
  const towers = await postJson<{
    errorCode?: unknown;
    errorMsg?: string;
    data?: Array<{ text?: string; value?: string }>;
  }>(fetchLike, "https://api.cleverschool.cn/washapi4/device/tower", {});
  if (towers.errorCode != null) {
    throw new Error(towers.errorMsg || "洗衣机楼栋列表获取失败");
  }
  const byName = new Map(jieli.map((g) => [g.name, g]));
  for (const b of towers.data ?? []) {
    const text = String(b.text ?? "");
    const value = String(b.value ?? "");
    if (!text || value === "0" || value === "") continue;
    const building: WasherBuilding = { name: text, id: value, hlsh: false };
    const group = text.includes("紫荆")
      ? byName.get("紫荆公寓")
      : text.includes("南区")
        ? byName.get("南区宿舍")
        : text.includes("双清")
          ? byName.get("双清公寓")
          : byName.get("其他位置");
    group?.buildings.push(building);
  }
  for (const g of jieli) g.buildings.sort(compareBuilding);

  const haier: WasherBuildingGroup = { name: "海乐生活", buildings: [] };
  try {
    const near = await postJson<{ code?: number; data?: { items?: Array<{ id?: string; name?: string }> } }>(
      fetchLike,
      "https://yshz-user.haier-ioc.com/position/nearPosition",
      { lng: 116.32697, lat: 40.00281, page: 1, pageSize: 30 },
    );
    if (near.code === 0) {
      for (const b of near.data?.items ?? []) {
        const name = String(b.name ?? "");
        if (name && name.includes("清华") && b.id !== undefined) {
          haier.buildings.push({ name, id: String(b.id), hlsh: true });
        }
      }
      haier.buildings.sort(compareBuilding);
    }
  } catch {
    /* 海乐生活点位失败可容忍（washer.tsx 同款：静默跳过） */
  }
  return [...jieli, haier];
}

/**
 * 楼栋内设备（washer.tsx WasherDetailScreen 同款解析）：
 * - 捷利 status 串解析：待机→idle；工作/运转→working；其余→error；
 *   「剩余:NN分钟」→ eta；「更新:HH:MM」→ updateTime。
 * - 海乐按品类 00/01/02 分页拉全，state 1/2/3 → idle/working/error。
 */
export async function getWasherDevices(
  fetchLike: FetchLike,
  building: WasherBuilding,
): Promise<Array<{ floor: string; washers: WasherDevice[] }>> {
  if (building.hlsh) {
    const typeNames: Record<string, string> = { "00": "洗衣机", "01": "洗鞋机", "02": "烘干机" };
    const statusMap: Record<number, "idle" | "working" | "error"> = { 1: "idle", 2: "working", 3: "error" };
    const washers: WasherDevice[] = [];
    for (const catCode of ["00", "01", "02"]) {
      const detail = await postJson<{ code?: number; data?: { items?: Array<{ name?: string; state?: number }> } }>(
        fetchLike,
        "https://yshz-user.haier-ioc.com/position/deviceDetailPage",
        { positionId: building.id, categoryCode: catCode, page: 1, floorCode: "", pageSize: 100 },
      ).catch(() => null);
      if (!detail || detail.code !== 0) continue;
      for (const w of detail.data?.items ?? []) {
        washers.push({
          type: typeNames[catCode] ?? "洗衣机",
          name: String(w.name ?? ""),
          floor: "海乐生活",
          status: statusMap[Number(w.state)] ?? "error",
          eta: -1,
          updateTime: "",
        });
      }
    }
    washers.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return [{ floor: "海乐生活", washers }];
  }

  const [statusRes, locRes] = await Promise.allSettled([
    postJson<{
      errorCode?: unknown;
      errorMsg?: string;
      data?: Array<{ floorName?: string; macUnionCode?: string; status?: string }>;
    }>(fetchLike, "https://api.cleverschool.cn/washapi4/device/status", { towerKey: building.id }),
    fetchLike(`https://app.cs.tsinghua.edu.cn/Api/JieliWashers?building=${encodeURIComponent(building.id)}`)
      .then((r) => r.json() as Promise<Record<string, string>>)
      .catch(() => ({} as Record<string, string>)),
  ]);
  if (statusRes.status === "rejected") {
    throw statusRes.reason instanceof Error ? statusRes.reason : new Error("洗衣机状态获取失败");
  }
  const payload = statusRes.value;
  if (payload.errorCode != null) {
    throw new Error(payload.errorMsg || "洗衣机状态获取失败");
  }

  const byFloor = new Map<string, WasherDevice[]>();
  for (const item of payload.data ?? []) {
    const floor = String(item.floorName ?? "未知楼层");
    const statusStr = String(item.status ?? "");
    const parts = statusStr.split(" ");
    let status: "idle" | "working" | "error" = "error";
    let eta = 0;
    let updateTime = "";
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i] ?? "";
      if (seg.includes("剩余")) {
        eta = Number(/\d+/.exec(seg)?.[0] ?? 0) || 0;
      } else if (seg.includes("更新")) {
        // "更新:10:32" → "10:32"（原文保留展示）
        updateTime = seg.split(":").slice(1).join(":").trim();
      } else if (seg.includes("待机")) {
        status = "idle";
      } else if (seg.includes("工作") || seg.includes("运转")) {
        status = "working";
      }
    }
    const code = String(item.macUnionCode ?? "").split(" ");
    const list = byFloor.get(floor) ?? [];
    list.push({
      type: code[0] ?? "",
      name: code[1] ?? code[0] ?? "",
      floor,
      status,
      eta,
      updateTime,
      location: locRes.status === "fulfilled" ? (locRes.value as Record<string, string>)[code[1] ?? ""] : undefined,
    });
    byFloor.set(floor, list);
  }
  const out: Array<{ floor: string; washers: WasherDevice[] }> = [];
  for (const [floor, washers] of byFloor) {
    washers.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    out.push({ floor, washers });
  }
  return out;
}
