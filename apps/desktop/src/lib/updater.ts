/**
 * 应用更新——清单获取 / 版本比较 / 下载编排 / 拉起安装页。
 *
 * ## 数据源：**官方双源，写死，不让用户配置**（2026-10-12 用户拍板）
 * 1. **主源 = GitHub Releases**：`.../releases/latest/download/latest.json`（外网可达时首选）；
 * 2. **备用 / 校内源 = 清华云盘官方镜像**：`https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/`
 *    （公开分享，**无需登录、无需选库**）。先试 `/latest.json`（发布方放了就用，带 sha256/说明），
 *    没有就**按实测目录形态直接解析**：`/Android/OneTHU_<版本>_<arch>.apk`、
 *    `/macOS/OneTHU_<版本>_<arch>.dmg`、`/Windows/OneTHU_<版本>_<arch>-setup.exe`。
 * 第一条可用即用；失败自动换下一条，并在结果里**注明走了哪条 + 为什么换**。
 *
 * 用户要用自己的私源时才展开「高级：自定义更新源」（一个清单 URL）——默认收起。
 *
 * 清单形状（GitHub 资产 / 云盘 latest.json 同款；`url` 可写相对名，前端按源解析成绝对地址）：
 * `{ "version": "0.10.1", "minVersion": "0.9.0", "url": "OneTHU_0.10.1_aarch64.dmg",
 *    "size": 9516505, "sha256": "…", "notes": "更新说明", "releasedAt": "2026-10-12",
 *    "assets": { "android": { "url": "OneTHU_0.10.1_arm64.apk", "size": 20255475 } } }`
 *
 * ## 红线
 * - **必须用户触发**：本模块没有后台轮询；只有点「检查更新」才请求，点「下载并安装」才下载；
 * - **绝不静默安装**：`installDownloaded()` 只把系统安装器拉到前台（安卓 = ROM 自己的确认页）；
 * - 失败一律结构化返回 + 人话原因（不抛给 UI）。
 */
import { invoke } from "@tauri-apps/api/core";
import { universalFetch } from "./transport.js";
import { isAndroidNavigator } from "./androidHost.js";
import { currentVersion, isNewer } from "./update.js";
import { logLine } from "./clients.js";
import { t as i18n } from "../i18n/index.js";


/* ── 官方地址（写死；改地址=改这里） ── */
export const GITHUB_MANIFEST_URL = "https://github.com/smartThise/OneTHU/releases/latest/download/latest.json";
export const GITHUB_ASSET_BASE = "https://github.com/smartThise/OneTHU/releases/latest/download/";
export const CLOUD_SHARE_BASE = "https://cloud.tsinghua.edu.cn";
export const CLOUD_SHARE_TOKEN = "56f78a2a0b144a6ab737";
/** 云盘镜像里各平台目录（实测形态，2026-10-12） */
const CLOUD_PLATFORM_DIR: Record<PlatformKey, string> = {
  android: "/Android", macos: "/macOS", windows: "/Windows", linux: "/macOS",
};

export type PlatformKey = "android" | "macos" | "windows" | "linux";
export type UpdateSource = "github" | "cloud" | "custom";

export const SOURCE_LABEL: Record<UpdateSource, string> = {
  github: "GitHub Releases（外网）",
  cloud: "清华云盘（官方镜像 · 校内可达）",
  custom: "自定义更新源",
};

export interface CloudAsset {
  /** 清单里的地址（相对名或 http(s) 直链；源差异由本模块解析成绝对 URL） */
  url: string;
  size?: number;
  sha256?: string;
  name?: string;
}

export interface CloudUpdateManifest {
  version: string;
  minVersion?: string;
  url?: string;
  size?: number;
  sha256?: string;
  notes?: string;
  releasedAt?: string;
  assets?: Partial<Record<PlatformKey, CloudAsset>>;
}

export interface UpdateAttempt {
  source: UpdateSource;
  label: string;
  ok: boolean;
  error?: string;
}

export interface UpdateCheckResult {
  ok: boolean;
  /** 给人看的原因（ok=false 时必有；双源都失败会把两条原因都列上） */
  error?: string;
  current: string;
  /** 实际用了哪条源 */
  source?: UpdateSource;
  sourceLabel?: string;
  /** 主源失败改走备用时的原因（UI 注明「外网不可达，已用校内镜像」用） */
  fallbackReason?: string;
  attempts?: UpdateAttempt[];
  latest?: string;
  hasUpdate?: boolean;
  belowMin?: boolean;
  notes?: string;
  releasedAt?: string;
  manifest?: CloudUpdateManifest;
  asset?: CloudAsset;
  /** 最终下载地址（绝对）与文件名 */
  downloadUrl?: string;
  downloadName?: string;
  /** 清单是否提供了 sha256（云盘镜像目录解析出来的没有；下载后按大小校验） */
  hashAvailable?: boolean;
}

export interface UpdateProgress {
  phase: string;
  received: number;
  total: number;
  percent: number;
  path?: string;
}

/** 当前平台（安卓优先判定：主窗口 UA 被伪装成 Windows，必须多信号先问） */
export function platformKey(): PlatformKey {
  const nav = typeof navigator === "undefined" ? null : navigator;
  if (isAndroidNavigator(nav)) return "android";
  const uaData = (nav as unknown as { userAgentData?: { platform?: string } } | null)?.userAgentData;
  const p = String(uaData?.platform ?? nav?.platform ?? "");
  const ua = String(nav?.userAgent ?? "");
  if (/mac|darwin/i.test(p) || /Macintosh|Mac OS X/i.test(ua)) return "macos";
  if (/win/i.test(p) || /Windows/i.test(ua)) return "windows";
  return "linux";
}

export const PLATFORM_LABEL: Record<PlatformKey, string> = {
  android: "安卓", macos: "macOS", windows: "Windows", linux: "Linux",
};

/** 清单 → 当前平台的包（assets[平台] 优先，回落顶层 url/size） */
export function pickAsset(m: CloudUpdateManifest, key: PlatformKey = platformKey()): CloudAsset | undefined {
  const a = m.assets?.[key];
  if (a?.url) return { url: a.url, size: a.size ?? m.size, sha256: a.sha256 ?? m.sha256, name: a.name };
  if (m.url) return { url: m.url, size: m.size, sha256: m.sha256, name: m.assets?.[key]?.name };
  return undefined;
}

/** 容错解析清单：缺字段/坏 JSON 都给可读原因，绝不把坏清单当「已是最新」 */
export function parseManifest(raw: string): { ok: true; manifest: CloudUpdateManifest } | { ok: false; error: string } {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return { ok: false, error: "清单不是合法 JSON" };
  }
  const o = (j ?? {}) as Record<string, unknown>;
  const version = typeof o.version === "string" ? o.version.trim() : "";
  if (!version) return { ok: false, error: "清单缺 version 字段" };
  const str = (k: string): string | undefined =>
    typeof o[k] === "string" && String(o[k]).trim() ? String(o[k]).trim() : undefined;
  const num = (k: string): number | undefined => (typeof o[k] === "number" && (o[k] as number) > 0 ? (o[k] as number) : undefined);
  const assetsRaw = (o.assets ?? {}) as Record<string, unknown>;
  const assets: CloudUpdateManifest["assets"] = {};
  for (const key of ["macos", "windows", "linux", "android"] as PlatformKey[]) {
    const a = assetsRaw[key] as Record<string, unknown> | undefined;
    if (a && typeof a.url === "string" && a.url.trim()) {
      assets[key] = {
        url: a.url.trim(),
        size: typeof a.size === "number" && a.size > 0 ? a.size : undefined,
        sha256: typeof a.sha256 === "string" ? a.sha256.trim() : undefined,
        name: typeof a.name === "string" && a.name.trim() ? a.name.trim() : undefined,
      };
    }
  }
  return {
    ok: true,
    manifest: {
      version,
      minVersion: str("minVersion"),
      url: str("url"),
      size: num("size"),
      sha256: str("sha256"),
      notes: str("notes"),
      releasedAt: str("releasedAt"),
      ...(Object.keys(assets).length ? { assets } : {}),
    },
  };
}

/** URL 里的文件名（清单没写 name 时兜底） */
export function fileNameFor(asset: CloudAsset, version: string): string {
  const fromUrl = (asset.name || asset.url).split("?")[0]?.split("/").pop() ?? "";
  if (fromUrl && fromUrl.includes(".")) return fromUrl;
  const ext = platformKey() === "android" ? "apk" : platformKey() === "windows" ? "exe" : "dmg";
  return `OneTHU_${version}.${ext}`;
}

/* ═══════════ 云盘官方镜像（公开分享链接；无需登录/无需选库） ═══════════
 * ⚠️ 必须走**裸通道**：`universalFetch` 会把一切 `*.tsinghua.edu.cn` 包进
 * webvpn 包装域（lib/transport.ts 的域名分流）——公开分享链接没有会话票，
 * 被包装后服务器直接回 **403**（2026-10-12 用户实测的 403 就是这么来的；
 * 同一 URL 匿名 curl 直连是 200/302 全通）。所以这里直接调 Rust `http_native`
 * 并**手工跟随跳转**（该命令是否自动跟随不作假设，逐跳读 location 更稳）。 */

interface RawResp { status: number; text: string }

async function httpNativeGet(url: string, headers: Record<string, string> = {}, hop = 0): Promise<RawResp> {
  const out = await invoke<{
    status: number; status_text: string; headers: Record<string, string>; body: string; body_b64?: string | null; url: string;
  }>("http_native", {
    input: { url, method: "GET", headers: { Accept: "*/*", ...headers }, body: null, body_b64: null },
  });
  const loc = Object.entries(out.headers ?? {}).find(([k]) => k.toLowerCase() === "location")?.[1];
  if (out.status >= 300 && out.status < 400 && loc && hop < 3) {
    const next = loc.startsWith("http") ? loc : new URL(loc, url).toString();
    return httpNativeGet(next, headers, hop + 1);
  }
  const text = out.body_b64
    ? new TextDecoder("utf-8").decode(Uint8Array.from(atob(out.body_b64), (c) => c.charCodeAt(0)))
    : (out.body ?? "");
  return { status: out.status, text };
}

/** 分享接口的人话错误（用户没法自查 403/404 的含义） */
function shareErr(what: string, status: number): string {
  if (status === 403) return `${what} 不可达（403）——官方端点若变更请检查 share-links API（本模块用的是匿名 dirents 接口）`;
  if (status === 404) return `${what} 不存在（404）——镜像上还没有这个文件`;
  if (status >= 500) return `${what} 服务端错误（HTTP ${status}）——云盘侧暂时不可用，稍后重试`;
  return `${what} 失败（HTTP ${status}）`;
}

interface ShareDirent {
  file_name: string;
  file_path: string;
  is_dir: boolean;
  size: number;
  last_modified: string;
}

/** 分享目录列表（公开 API，实测 `GET /api/v2.1/share-links/<token>/dirents/?path=/` 返回 dirent_list） */
async function shareDirents(path: string): Promise<ShareDirent[]> {
  const url = `${CLOUD_SHARE_BASE}/api/v2.1/share-links/${CLOUD_SHARE_TOKEN}/dirents/?path=${encodeURIComponent(path)}`;
  let r: RawResp;
  try {
    r = await httpNativeGet(url, { Accept: "application/json" });
  } catch (e) {
    throw new Error(`镜像目录不可达：${e instanceof Error ? e.message : String(e)}（校外环境请确认网络；该接口无需登录）`);
  }
  if (r.status !== 200) throw new Error(shareErr(`镜像目录 ${path}`, r.status));
  try {
    const j = JSON.parse(r.text) as unknown;
    // 实测两种形态都出现过：裸数组 与 {dirent_list:[…]}
    const list = Array.isArray(j) ? (j as ShareDirent[]) : ((j as { dirent_list?: ShareDirent[] }).dirent_list ?? []);
    return Array.isArray(list) ? list : [];
  } catch {
    throw new Error(`镜像目录返回的不是 JSON（${path}）——官方接口形态可能变了`);
  }
}

/**
 * 分享内文件 → 下载直链。
 * **2026-10-12 匿名 curl 实测（本实例）**：`/d/<token>/files/?p=<path>&dl=1` → **302** →
 * `https://cloud.tsinghua.edu.cn/seafhttp/files/<uuid>/<name>` → 支持 Range（`206` +
 * `content-range: bytes 0-1023/9516505`）。
 * 而 `/api/v2.1/share-links/<token>/dirents/download/`、`…/files/`、`…/download/` 三种
 * "API 版下载端点"在这台服务器上**全部 404**（只有 `…/dirents/?path=` 是 200）——
 * 别再把这里"修"回 API 形态。下载由 Rust `updater_download` 执行（reqwest 自动跟随 302）。
 */
export function shareDownloadUrl(innerPath: string): string {
  const p = innerPath.startsWith("/") ? innerPath : `/${innerPath}`;
  return `${CLOUD_SHARE_BASE}/d/${CLOUD_SHARE_TOKEN}/files/?p=${encodeURIComponent(p)}&dl=1`;
}

/** 分享内文件内容（小文件：清单） */
async function shareFileText(innerPath: string): Promise<string> {
  const r = await httpNativeGet(shareDownloadUrl(innerPath));
  if (r.status !== 200) throw new Error(shareErr(`镜像文件 ${innerPath}`, r.status));
  return r.text;
}

const EXT_RE: Record<PlatformKey, RegExp> = {
  android: /\.apk$/i,
  windows: /\.(exe|msi)$/i,
  macos: /\.(dmg|zip)$/i,
  linux: /\.(appimage|deb|tar\.gz|zip|dmg)$/i,
};
/** 同版本多架构时的优先序（镜像里实测同时存在 aarch64/x64 的可能） */
const ARCH_PREF: Record<PlatformKey, RegExp[]> = {
  macos: [/aarch64|arm64/i, /x64|x86_64|universal/i],
  android: [/arm64|aarch64/i, /universal|arm/i],
  windows: [/x64|x86_64|setup/i, /arm64/i],
  linux: [/x86_64|amd64/i, /aarch64|arm64/i],
};

/** 从文件名解析版本：`OneTHU_0.10.0_arm64.apk` / `OneTHU-0.10.1.dmg` → "0.10.0" */
export function versionFromName(name: string): string | null {
  const m = /^OneTHU[_-]?v?(\d+\.\d+(?:\.\d+)?)/i.exec(name.trim());
  return m?.[1] ?? null;
}

/** 目录解析兜底：镜像目录（无 latest.json）也能查出「最新版 + 对应包」 */
export function synthFromDir(
  list: ShareDirent[],
  key: PlatformKey,
  current = currentVersion(),
): { manifest: CloudUpdateManifest; asset: CloudAsset } | null {
  const files = list
    .filter((d) => !d.is_dir && EXT_RE[key].test(d.file_name))
    .map((d) => ({ ...d, version: versionFromName(d.file_name) }))
    .filter((d): d is typeof d & { version: string } => Boolean(d.version));
  if (files.length === 0) return null;
  const newest = files.reduce((best, f) => (isNewer(f.version, best.version) ? f : best), files[0]!);
  const sameVer = files.filter((f) => f.version === newest.version);
  let picked = sameVer[0]!;
  for (const pref of ARCH_PREF[key]) {
    const hit = sameVer.find((f) => pref.test(f.file_name));
    if (hit) { picked = hit; break; }
  }
  void current;
  const asset: CloudAsset = { url: picked.file_path, size: picked.size, name: picked.file_name };
  const manifest: CloudUpdateManifest = {
    version: newest.version,
    url: picked.file_path,
    size: picked.size,
    notes: "",
    releasedAt: picked.last_modified.slice(0, 10),
    assets: { [key]: asset },
  };
  return { manifest, asset };
}

/* ═══════════ 检查（双源自动切换） ═══════════ */

type Resolved = Omit<UpdateCheckResult, "ok" | "error" | "current" | "attempts" | "source" | "sourceLabel" | "fallbackReason">;

function finish(m: CloudUpdateManifest, key: PlatformKey, asset: CloudAsset, abs: (rel: string) => string): Resolved {
  const cur = currentVersion();
  return {
    latest: m.version,
    hasUpdate: isNewer(m.version, cur),
    belowMin: Boolean(m.minVersion && isNewer(m.minVersion, cur)),
    notes: m.notes,
    releasedAt: m.releasedAt,
    manifest: m,
    asset,
    downloadUrl: abs(asset.url),
    downloadName: fileNameFor(asset, m.version),
    hashAvailable: Boolean(asset.sha256),
  };
}

async function fromGitHub(key: PlatformKey): Promise<Resolved> {
  const res = await universalFetch(GITHUB_MANIFEST_URL, {
    method: "GET",
    headers: { Accept: "application/json, text/plain, */*", "User-Agent": "OneTHU-UpdateCheck" },
  });
  if (!res.ok) {
    throw new Error(res.status === 404 ? "HTTP 404（Releases 还没挂 latest.json 资产）" : `HTTP ${res.status}`);
  }
  const parsed = parseManifest(await res.text());
  if (!parsed.ok) throw new Error(parsed.error);
  const m = parsed.manifest;
  const asset = pickAsset(m, key);
  if (!asset) throw new Error(`清单 v${m.version} 没有当前平台（${key}）的包`);
  return finish(m, key, asset, (rel) =>
    /^https?:/i.test(rel) ? rel : GITHUB_ASSET_BASE + encodeURIComponent(rel.split("/").pop() ?? rel));
}

async function fromCloud(key: PlatformKey): Promise<Resolved> {
  const dir = CLOUD_PLATFORM_DIR[key];
  // 两个目录列表都要：根目录放 latest.json 时也要能发现；平台目录用来解析安装包
  const rootList = await shareDirents("/");
  const dirList = await shareDirents(`${dir}/`);
  const hasManifest = (list: ShareDirent[], name: string): boolean => list.some((d) => !d.is_dir && d.file_name === name);
  // ① 发布方若放了清单（根目录或平台目录），优先用它（带 sha256 / 更新说明）
  const candidates = [
    ...(hasManifest(rootList, "latest.json") ? ["/latest.json"] : []),
    ...(hasManifest(dirList, "latest.json") ? [`${dir}/latest.json`] : []),
  ];
  for (const cand of candidates) {
    try {
      const text = await shareFileText(cand);
      const parsed = parseManifest(text);
      if (!parsed.ok) continue;
      const m = parsed.manifest;
      const asset = pickAsset(m, key);
      if (!asset) continue;
      return finish(m, key, asset, (rel) => (/^https?:/i.test(rel) ? rel : shareDownloadUrl(rel)));
    } catch {
      /* 清单读不到 → 走目录解析（镜像当前的真实形态就是只有安装包） */
    }
  }
  // ② 目录解析兜底（镜像实测形态：OneTHU_<版本>_<arch>.<ext>）
  const synth = synthFromDir(dirList, key);
  if (!synth) {
    const ext = key === "android" ? "apk" : key === "windows" ? "exe" : "dmg";
    throw new Error(`${dir}/ 里没有可识别的安装包（期望 OneTHU_<版本>_<arch>.${ext}；目录里现有 ${dirList.length} 项）`);
  }
  return finish(synth.manifest, key, synth.asset, (rel) => shareDownloadUrl(rel));
}

/**
 * 检查更新：主源 GitHub → 备用云盘镜像，自动切换。**不下载、不安装**。
 * `customManifestUrl` 非空时只走自定义源（「高级」里用户自己填的）。
 */
export async function checkForUpdate(opts: { customManifestUrl?: string } = {}): Promise<UpdateCheckResult> {
  const current = currentVersion();
  const key = platformKey();
  const attempts: UpdateAttempt[] = [];
  const custom = (opts.customManifestUrl ?? "").trim();
  const plan: Array<{ source: UpdateSource; run: () => Promise<Resolved> }> = custom
    ? [{ source: "custom", run: async () => {
        const res = await universalFetch(custom, { method: "GET", headers: { Accept: "application/json, text/plain, */*" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const parsed = parseManifest(await res.text());
        if (!parsed.ok) throw new Error(parsed.error);
        const m = parsed.manifest;
        const asset = pickAsset(m, key);
        if (!asset) throw new Error(`清单 v${m.version} 没有当前平台（${key}）的包`);
        return finish(m, key, asset, (rel) => (/^https?:/i.test(rel) ? rel : rel));
      } }]
    : [{ source: "github", run: () => fromGitHub(key) }, { source: "cloud", run: () => fromCloud(key) }];

  for (const step of plan) {
    try {
      const r = await step.run();
      attempts.push({ source: step.source, label: SOURCE_LABEL[step.source], ok: true });
      const failed = attempts.find((a) => !a.ok);
      void logLine(`[更新] 检查完成 · 源=${SOURCE_LABEL[step.source]} · v${r.latest}（当前 v${current}，${r.hasUpdate ? "有新版本" : "已是最新"}）`).catch(
        () => undefined,
      );
      return {
        ok: true, current, ...r,
        source: step.source,
        sourceLabel: SOURCE_LABEL[step.source],
        attempts,
        ...(failed ? { fallbackReason: `${failed.label} 不可用：${failed.error ?? "未知原因"}` } : {}),
      };
    } catch (e) {
      attempts.push({ source: step.source, label: SOURCE_LABEL[step.source], ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const detail = attempts.map((a) => `· ${a.label}：${a.error ?? "未知原因"}`).join("\n");
  return { ok: false, current, attempts, error: `两个更新源都没取到清单：\n${detail}` };
}

/* ═══════════ 下载 / 取消 / 拉起安装页 ═══════════ */

/**
 * 下载更新包（用户点了才调）。进度经 `onethu-updater://progress` 回传。
 * `expectSha256` 非空时由 Rust 侧流式校验，**不符即丢弃文件并报错**（不会交给安装器）。
 */
export async function downloadUpdate(opts: {
  url: string;
  fileName: string;
  expectSize?: number;
  expectSha256?: string;
  onProgress?: (p: UpdateProgress) => void;
}): Promise<{ ok: boolean; path?: string; dir?: string; size?: number; sha256?: string; verified?: boolean; error?: string; cancelled?: boolean }> {
  let unlisten: (() => void) | undefined;
  try {
    if (typeof opts.onProgress === "function") {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<UpdateProgress>("onethu-updater://progress", (ev) => {
        const p = ev.payload;
        if (p && typeof p.received === "number") opts.onProgress?.(p);
      });
    }
    const r = await invoke<{ path: string; dir: string; size: number; sha256: string; verified: boolean }>("updater_download", {
      url: opts.url,
      fileName: opts.fileName,
      expectSize: opts.expectSize ?? null,
      expectSha256: opts.expectSha256 ?? null,
    });
    return { ok: true, path: r.path, dir: r.dir, size: r.size, sha256: r.sha256, verified: r.verified };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, cancelled: /已取消/.test(msg) };
  } finally {
    unlisten?.();
  }
}

/** 取消进行中的下载（任何时刻都能点；Rust 侧清掉 `.part`） */
export async function cancelUpdateDownload(): Promise<void> {
  await invoke("updater_cancel_download").catch(() => undefined);
}

export interface InstallLaunchResult {
  ok: boolean;
  hint?: string;
  error?: string;
}

/**
 * 把已下载的安装包拉到系统安装页。**只拉起，不静默安装**：
 * - 安卓：`updater_open_installer` → Kotlin FileProvider → `content://` → ACTION_VIEW
 *   （`application/vnd.android.package-archive`）；「安装未知应用」授权由系统弹；
 * - 桌面：`onethu_open_path`（macOS 挂 DMG 弹安装窗 / Windows 进安装向导）。
 */
export async function installDownloaded(path: string): Promise<InstallLaunchResult> {
  if (!path) return { ok: false, error: "没有可安装的本地路径" };
  const key = platformKey();
  try {
    if (key === "android") {
      await invoke("updater_open_installer", { path });
      return { ok: true, hint: i18n("auto.lib.updater.p1") };
    }
    await invoke("onethu_open_path", { path });
    return { ok: true, hint: key === "macos" ? "已用系统默认方式打开：若是 DMG，把应用拖进「应用程序」即完成更新。" : "已用系统默认方式打开安装包。" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void logLine(`[更新] 拉起安装页失败：${msg}`).catch(() => undefined);
    return { ok: false, error: msg };
  }
}
