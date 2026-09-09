/**
 * 寻迹（trace）：高德 Web 服务 REST 客户端 + 坐标换算 + 导航深链。
 *
 * 数据面：
 * - POI 检索 place/text（citylimit 北京，adname 过滤海淀）→ 事件地点 → 经纬度（GCJ-02）
 * - 路径规划 walking/bicycling/driving（v3）→ 指定交通方式的 ETA
 * - POI 结果落 localStorage 永久缓存（POI 不动；ETA 每次现场算）
 *
 * 坐标系约定：全链路 GCJ-02（高德 POI / 路线 / 瓦片 / 深链一致，无需转换）。
 * 唯一例外：navigator.geolocation 返回 WGS-84，进图/进路线前经 wgs84ToGcj02 归一。
 *
 * Key 策略（用户拍板）：个人 Web 服务 key 混淆后内置（量小，非安全边界，仅防脚本扫库）。
 */
import { universalFetch } from "./transport.js";

/* ── Key 通道：运行时注入 → Rust trace_key 命令（XOR 0x5A 混淆存储）──
 * 明文 key 三不落：git 仓库（混淆 hex 分段）、JS bundle（不编译进前端资产）、
 * Rust 二进制（无 32 位连续 hex 特征）。release 构建不开 webview devtools，
 * JS 侧无法旁听 invoke 回传。防扫库而非防逆向——个人 key 随时可重置。 */
const RUST_PLACEHOLDER = "0000000000000000000000000000dead"; // 未配置标记值
let keyCache: string | null = null;

function amapKey(): string | null {
  const raw = (globalThis as Record<string, unknown>).__ONETHU_TRACE_KEY__ as string | undefined;
  return raw ?? keyCache;
}

/** 取 key（幂等）：Tauri trace_key 命令 → 内存缓存。返回是否已配置。 */
export async function ensureTraceKey(): Promise<boolean> {
  if (amapKey()) return true;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const k = (await invoke("trace_key")) as string;
    if (k && k !== RUST_PLACEHOLDER) {
      keyCache = k;
      return true;
    }
  } catch {
    /* 非 Tauri 环境（node 测试/纯 web）→ 未配置 */
  }
  return false;
}

/** key 是否就绪（同步；ensureTraceKey 成功后为 true） */
export function traceKeyReady(): boolean {
  return !!amapKey();
}

/** 测试/构建注入用 */
export function setTraceKey(k: string): void {
  (globalThis as Record<string, unknown>).__ONETHU_TRACE_KEY__ = k;
}

const REST = "https://restapi.amap.com/v3";

/* ── WGS-84 → GCJ-02（火星坐标，国测局算法；中国境外恒等） ── */
const PI = Math.PI;
const A = 6378245.0;
const EE = 0.00669342162296594323;

function outOfChina(lng: number, lat: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}
function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}
function transformLng(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0;
  return ret;
}
export function wgs84ToGcj02(lng: number, lat: number): [number, number] {
  if (outOfChina(lng, lat)) return [lng, lat];
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return [lng + dLng, lat + dLat];
}

/* ── 校园地点别名：课表地点串 → 高德可检索的 POI 关键词 ──
 * 课表地点是「六教6C201」「李文正馆北402」这类教学楼+房间号；房间号对检索是噪音，
 * 剥掉后再补「清华大学」限定，高德楼栋级 POI 命中率极高。 */
const CAMPUS_ALIAS: Array<[RegExp, string]> = [
  [/^一教/, "清华大学第一教学楼"],
  [/^二教/, "清华大学第二教学楼"],
  [/^三教/, "清华大学第三教学楼"],
  [/^四教/, "清华大学第四教学楼"],
  [/^五教/, "清华大学第五教学楼"],
  [/^六教/, "清华大学第六教学楼"],
  [/^主楼(后|东|西)?/, "清华大学主楼"],
  [/^新水利馆/, "清华大学新水利馆"],
  [/^旧水利馆/, "清华大学旧水利馆"],
  [/^李文正馆|^北馆/, "清华大学李文正馆（北馆）"],
  [/^逸夫馆|^逸夫图书馆/, "清华大学逸夫图书馆"],
  [/^文科馆/, "清华大学人文社科图书馆"],
  [/^金融馆/, "清华大学五道口金融学院"],
  [/^经管馆/, "清华大学经济管理学院"],
  [/^建馆/, "清华大学建筑馆"],
  [/^美院|^艺术博物馆/, "清华大学美术学院"],
  [/^蒙楼|^蒙民伟楼/, "清华大学蒙民伟楼"],
  [/^罗姆楼/, "清华大学罗姆楼"],
  [/^何添楼/, "清华大学何添楼"],
  [/^明理楼/, "清华大学明理楼"],
  [/^清华学堂/, "清华学堂"],
  [/^大礼堂/, "清华大学大礼堂"],
  [/^西体|^西体育馆/, "清华大学西体育馆"],
  [/^综体|^综合体育馆/, "清华大学综合体育馆"],
  [/^气膜馆/, "清华大学气膜运动馆"],
  [/^游泳馆/, "清华大学游泳馆"],
  [/^紫操|^紫荆操场/, "清华大学紫荆操场"],
  [/^东操|^东大操场/, "清华大学东大操场"],
  [/^西操/, "清华大学西区体育场"],
  [/^工字厅/, "清华大学工字厅"],
];

/** 课表/日程地点串 → 检索关键词（剥房间号 + 别名展开） */
export function locationQuery(raw: string): string {
  const s = raw.trim().replace(/[\s()（）]/g, "");
  if (!s) return s;
  for (const [re, name] of CAMPUS_ALIAS) {
    if (re.test(s)) return name;
  }
  // 「XX楼/馆123」→ 剥尾部屋号层级：六教6C201→六教；舜德楼北102→舜德楼北
  const stripped = s.replace(/[0-9０-９]+[a-zA-Z]?[0-9０-９]*$/, "");
  return stripped ? `清华大学${stripped}` : `清华大学${s}`;
}

/* ── POI 检索（限北京市海淀区）+ 永久缓存 ── */

export interface Poi {
  lng: number;
  lat: number;
  name: string;
  address: string;
  district: string;
}

const POI_CACHE_PREFIX = "onethu.trace.poi.";

function poiCacheKey(q: string): string {
  return POI_CACHE_PREFIX + q;
}

/** 检索关键词 → 海淀区 POI（取海淀候选第一个） */
export async function searchPoi(query: string): Promise<Poi | null> {
  const q = query.trim();
  if (!q) return null;
  const cached = readPoiCache(q);
  if (cached) return cached.hit ? cached.poi : null; // 负缓存：查不到也记住，防反复打接口

  let pois: Poi[] = [];
  const key = amapKey();
  if (!key) return null;
  try {
    const url = `${REST}/place/text?keywords=${encodeURIComponent(q)}&city=${encodeURIComponent("北京市")}&citylimit=true&offset=10&page=1&key=${key}`;
    const res = await universalFetch(url, { method: "GET" });
    const json = (await res.json()) as { status?: string; pois?: Array<{ location?: string; name?: string; address?: string; pname?: string; adname?: string }> };
    if (json.status === "1" && Array.isArray(json.pois)) {
      pois = json.pois
        .filter((p) => p.location && p.name)
        .map((p) => {
          const [lng = 0, lat = 0] = (p.location ?? "0,0").split(",").map(Number);
          return { lng, lat, name: p.name ?? "", address: p.address ?? "", district: p.adname ?? "" };
        });
    }
  } catch {
    return null; // 网络错误不落负缓存
  }
  // 海淀区限定（adname 含海淀）
  const pick = pois.find((p) => p.district.includes("海淀")) ?? null;
  writePoiCache(q, pick);
  return pick;
}

function readPoiCache(q: string): { hit: boolean; poi: Poi | null } | null {
  try {
    const raw = localStorage.getItem(poiCacheKey(q));
    if (raw == null) return null;
    return JSON.parse(raw) as { hit: boolean; poi: Poi | null };
  } catch {
    return null;
  }
}
function writePoiCache(q: string, poi: Poi | null): void {
  try {
    localStorage.setItem(poiCacheKey(q), JSON.stringify({ hit: !!poi, poi }));
  } catch { /* 配额满：静默 */ }
}

/* ── 路径规划 ETA（秒） ── */

export type TravelMode = "walk" | "bike" | "drive";
export const TRAVEL_MODES: Array<{ id: TravelMode; label: string }> = [
  { id: "walk", label: "步行" },
  { id: "bike", label: "骑行" },
  { id: "drive", label: "驾车" },
];

export async function routeEta(
  origin: { lng: number; lat: number },
  dest: { lng: number; lat: number },
  mode: TravelMode,
): Promise<number | null> {
  const o = `${origin.lng},${origin.lat}`;
  const d = `${dest.lng},${dest.lat}`;
  const api = mode === "walk" ? "walking" : mode === "bike" ? "bicycling" : "driving";
  const key = amapKey();
  if (!key) return null;
  try {
    const url = `${REST}/direction/${api}?origin=${o}&destination=${d}&key=${key}`;
    const res = await universalFetch(url, { method: "GET" });
    const json = (await res.json()) as {
      status?: string;
      route?: { paths?: Array<{ duration?: string | number }> };
    };
    if (json.status !== "1") return null;
    const dur = Number(json.route?.paths?.[0]?.duration ?? 0);
    return dur > 0 ? dur : null;
  } catch {
    return null;
  }
}

/* ── 导航深链（GCJ-02 直传；高德/腾讯原生 GCJ，百度声明 coord_type，苹果中国图源同为 GCJ） ── */

export type MapApp = "amap" | "qq" | "baidu" | "apple";
export const MAP_APPS: Array<{ id: MapApp; label: string }> = [
  { id: "amap", label: "高德" },
  { id: "qq", label: "腾讯" },
  { id: "baidu", label: "百度" },
  { id: "apple", label: "苹果" },
];

export function navUrl(app: MapApp, dest: { lng: number; lat: number; name: string }): string {
  const n = encodeURIComponent(dest.name);
  const c = `${dest.lng},${dest.lat}`;
  switch (app) {
    case "amap":
      return `https://uri.amap.com/navigation?to=${c},${n}&policy=1&src=onethu&coordinate=gaode`;
    case "qq":
      return `https://apis.map.qq.com/uri/v1/routeplan?type=drive&to=${n}&tocoord=${c}&policy=1&referer=onethu`;
    case "baidu":
      return `https://api.map.baidu.com/direction?destination=${encodeURIComponent(`${n}|${c}`)}&coord_type=gcj02&output=html&src=onethu`;
    case "apple":
      return `https://maps.apple.com/?daddr=${dest.lat},${dest.lng}&dname=${n}&dirflg=r`;
  }
}

/** Android 判定（语音桥同款 UA 判别） */
const IS_ANDROID = typeof navigator !== "undefined" && /Android/.test(navigator.userAgent);

/**
 * 导航链接（平台感知）：
 * - Android：intent:// App 深链（高德/腾讯/百度直跳 App；未装经 browser_fallback_url 落网页版）
 * - 桌面 / 其他：网页版 URI（原行为）
 * 坐标 GCJ-02 直传（高德原生；腾讯 tocoord、百度 destination 均按「纬度,经度」约定）。
 */
export function navOpenUrl(app: MapApp, dest: { lng: number; lat: number; name: string }): string {
  const web = navUrl(app, dest);
  if (!IS_ANDROID) return web;
  const n = encodeURIComponent(dest.name);
  const lat = dest.lat.toFixed(6);
  const lng = dest.lng.toFixed(6);
  const fb = encodeURIComponent(web);
  switch (app) {
    case "amap":
      // dev=0：坐标已是高德加密坐标（GCJ-02）
      return `intent://navi?sourceApplication=onethu&lat=${lat}&lon=${lng}&dev=0&style=2#Intent;scheme=androidamap;package=com.autonavi.minimap;S.browser_fallback_url=${fb};end`;
    case "qq":
      return `intent://map/routeplan?type=drive&to=${n}&tocoord=${lat},${lng}&policy=1&referer=onethu#Intent;scheme=qqmap;package=com.tencent.map;S.browser_fallback_url=${fb};end`;
    case "baidu":
      return `intent://map/direction?destination=${n}%7C${lat},${lng}&coord_type=gcj02&mode=driving&src=onethu#Intent;scheme=bdapp;package=com.baidu.BaiduMap;S.browser_fallback_url=${fb};end`;
    case "apple":
      return web; // Android 无苹果地图，保持网页
  }
}

/** ETA 秒 → 紧凑显示（分钟为主） */
export function fmtEta(sec: number | null): string {
  if (sec == null) return "?";
  const m = Math.round(sec / 60);
  if (m < 1) return "<1分";
  if (m < 60) return `${m}分`;
  return `${Math.floor(m / 60)}时${m % 60}分`;
}
