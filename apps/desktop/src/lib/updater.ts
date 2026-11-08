import { t as i18n, msg as i18nMsg, resolveMessage, type UiText } from "../i18n/index.js";
/**
 * 应用更新——清单获取 / 版本比较 / 下载编排 / 拉起安装页。
 *
 * ## 数据源：**官方双源，写死，不让用户配置**（2026-10-12 用户拍板）
 * 1. **GitHub Releases**：`.../releases/latest/download/latest.json`（外网源）；
 * 2. **清华云盘官方镜像**：`https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/`
 *    （公开分享，**无需登录、无需选库**）。先试 `/latest.json`（发布方放了就用，带 sha256/说明），
 *    没有就**按实测目录形态直接解析**：`/Android/OneTHU_<版本>_<arch>.apk`、
 *    `/macOS/OneTHU_<版本>_<arch>.dmg`、`/Windows/OneTHU_<版本>_<arch>-setup.exe`。
 * 失败或超时自动用另一侧，并在结果里**注明实际走了哪条 + 为什么换**。
 *
 * 用户要用自己的私源时才展开「高级：自定义更新源」（一个清单 URL）——默认收起。
 *
 * ## 双源优先级（2026-10-28 用户拍板）
 * 两侧**并行查询**（各自保留 source timeout / AbortSignal / attempts 语义），拿到结果后比较 latest：
 * 1. **两侧版本号相同 → 清华云盘**（校内直连更稳，下载不再绕外网）；
 * 2. **GitHub 严格更新（版本号更高）才用 GitHub**；
 * 3. 云盘版本更高 → 云盘；**一侧失败用另一侧**，两侧都失败才报错并列出两条原因。
 *
 * 清单形状（GitHub 资产 / 云盘 latest.json 同款；`url` 可写相对名，前端按源解析成绝对地址）：
 * `{ "version": "0.10.1", "minVersion": "0.9.0", "url": "OneTHU_0.10.1_aarch64.dmg",
 *    "size": 9516505, "sha256": "…", "notes": "更新说明", "releasedAt": "2026-10-12",
 *    "assets": { "android": { "url": "OneTHU_0.10.1_arm64.apk", "size": 20255475 } } }`
 *
 * ## 红线
 * - 版本检查支持启动提醒与设置手动检查；点击「下载并安装」后才下载；
 * - **绝不静默安装**：`installDownloaded()` 只把系统安装器拉到前台（安卓 = ROM 自己的确认页）；
 * - 失败一律结构化返回 + 人话原因（不抛给 UI）。
 */
import { invoke } from "@tauri-apps/api/core";
import { universalFetch, nativeSessionEpoch, assertNativeSessionEpoch } from "./transport.js";
import { isAndroidNavigator } from "./androidHost.js";
import { currentVersion, isNewer } from "./update.js";
import { logLine } from "./clients.js";
import { normalizeDownloadThreads } from "./downloadPrefs.js";

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
  get github() { return i18n("lib.updater.71c70711a602"); },
  get cloud() { return i18n("lib.updater.9fa399af02de"); },
  get custom() { return i18n("lib.updater.d7fb13f125e5"); },
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
  /** Legacy 0.11.4 compares three numeric parts only. Official hotfix manifests
   * may advertise a numeric compatibility version plus the actual release. */
  displayVersion?: string;
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
  /** Application-owned timeout stays structured; remote/native reasons stay raw. */
  errorKind?: "source-timeout";
}

class UpdateSourceTimeout extends Error {}

export function updateSourceLabel(result: UpdateCheckResult): string {
  return result.source ? SOURCE_LABEL[result.source] : result.sourceLabel ?? "";
}

export function updateAttemptError(attempt: UpdateAttempt): string {
  return attempt.errorKind === "source-timeout"
    ? i18n("update.sourceTimeout", { source: SOURCE_LABEL[attempt.source] })
    : attempt.error ?? i18n("lib.updater.a1a9da9ee6ed");
}

export function updateFallbackText(result: UpdateCheckResult): string {
  const failed = result.attempts?.find(attempt => !attempt.ok);
  return failed
    ? i18n("lib.updater.ab90d58874ee", { label: SOURCE_LABEL[failed.source], value: updateAttemptError(failed) })
    : result.fallbackReason ?? "";
}

export function updateFailureText(result: UpdateCheckResult): string {
  const attempts = result.attempts?.filter(attempt => !attempt.ok);
  return attempts?.length
    ? i18n("lib.updater.2985491184cc", { detail: attempts.map(attempt => `· ${SOURCE_LABEL[attempt.source]}：${updateAttemptError(attempt)}`).join("\n") })
    : result.error ?? i18n("components.softwareupdatesection.4f6f06254d16");
}

export interface UpdateCheckResult {
  ok: boolean;
  /** 给人看的原因（ok=false 时必有；双源都失败会把两条原因都列上） */
  error?: string;
  current: string;
  /** 实际用了哪条源 */
  source?: UpdateSource;
  sourceLabel?: string;
  /** 采用一侧时另一侧失败/超时的原因（UI 注明「另一源不可达，已用当前源」用） */
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
  get android() { return i18n("lib.updater.2f939477c47e"); }, macos: "macOS", windows: "Windows", linux: "Linux",
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
    return { ok: false, error: i18n("lib.updater.3d383f5a5c29") };
  }
  const o = (j ?? {}) as Record<string, unknown>;
  const advertised = typeof o.version === "string" ? o.version.trim() : "";
  const display = typeof o.displayVersion === "string" ? o.displayVersion.trim() : "";
  const version = /^\d+\.\d+\.\d+-fix-\d+$/.test(display) ? display : advertised;
  if (!version) return { ok: false, error: i18n("lib.updater.fab43f07fa2d") };
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
      ...(display ? {displayVersion:display} : {}),
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

/** 取消后立刻停止后续分享接口请求（invoke 本身不可中止，但不再发新请求）。 */
function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
}

async function httpNativeGet(url: string, headers: Record<string, string> = {}, hop = 0, requestEpoch?: number, signal?: AbortSignal): Promise<RawResp> {
  throwIfCancelled(signal);
  const epoch = requestEpoch ?? await nativeSessionEpoch();
  const out = await invoke<{
    status: number; status_text: string; headers: Record<string, string>; body: string; body_b64?: string | null; url: string;
  }>("http_native", {
    epoch,
    input: { url, method: "GET", headers: { Accept: "*/*", ...headers }, body: null, body_b64: null, timeout_ms: 10_000 },
  });
  throwIfCancelled(signal);
  await assertNativeSessionEpoch(epoch);
  const loc = Object.entries(out.headers ?? {}).find(([k]) => k.toLowerCase() === "location")?.[1];
  if (out.status >= 300 && out.status < 400 && loc && hop < 3) {
    const next = loc.startsWith("http") ? loc : new URL(loc, url).toString();
    return httpNativeGet(next, headers, hop + 1, epoch, signal);
  }
  const text = out.body_b64
    ? new TextDecoder("utf-8").decode(Uint8Array.from(atob(out.body_b64), (c) => c.charCodeAt(0)))
    : (out.body ?? "");
  return { status: out.status, text };
}

/** 分享接口的人话错误（用户没法自查 403/404 的含义） */
function shareErr(what: string, status: number): string {
  if (status === 403) return i18n("lib.updater.01e9ed6e0882", { what: String(what) });
  if (status === 404) return i18n("lib.updater.361980a5e6ce", { what: String(what) });
  if (status >= 500) return i18n("lib.updater.072f4658615f", { what: String(what), status: String(status) });
  return i18n("lib.updater.dae2c06aec63", { what: String(what), status: String(status) });
}

interface ShareDirent {
  file_name: string;
  file_path: string;
  is_dir: boolean;
  size: number;
  last_modified: string;
}

/** 分享目录列表（公开 API，实测 `GET /api/v2.1/share-links/<token>/dirents/?path=/` 返回 dirent_list） */
async function shareDirents(path: string, signal?: AbortSignal): Promise<ShareDirent[]> {
  const url = `${CLOUD_SHARE_BASE}/api/v2.1/share-links/${CLOUD_SHARE_TOKEN}/dirents/?path=${encodeURIComponent(path)}`;
  let r: RawResp;
  try {
    r = await httpNativeGet(url, { Accept: "application/json" }, 0, undefined, signal);
  } catch (e) {
    throwIfCancelled(signal);
    throw new Error(i18n("lib.updater.bf52642dd8c4", { value: String(e instanceof Error ? e.message : String(e)) }));
  }
  if (r.status !== 200) throw new Error(shareErr(i18n("lib.updater.194b24406399", { path: String(path) }), r.status));
  try {
    const j = JSON.parse(r.text) as unknown;
    // 实测两种形态都出现过：裸数组 与 {dirent_list:[…]}
    const list = Array.isArray(j) ? (j as ShareDirent[]) : ((j as { dirent_list?: ShareDirent[] }).dirent_list ?? []);
    return Array.isArray(list) ? list : [];
  } catch {
    throw new Error(i18n("lib.updater.cfc1ecb75eaf", { path: String(path) }));
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
async function shareFileText(innerPath: string, signal?: AbortSignal): Promise<string> {
  throwIfCancelled(signal);
  const r = await httpNativeGet(shareDownloadUrl(innerPath), {}, 0, undefined, signal);
  if (r.status !== 200) throw new Error(shareErr(i18n("lib.updater.fa872c6a802a", { innerPath: String(innerPath) }), r.status));
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
  const m = /^OneTHU[_-]?v?(\d+\.\d+(?:\.\d+)?(?:-fix-\d+)?)/i.exec(name.trim());
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

/* ═══════════ 检查（双源并行 + 优先级选源） ═══════════ */

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

async function fromGitHub(key: PlatformKey, signal?: AbortSignal): Promise<Resolved> {
  throwIfCancelled(signal);
  const res = await universalFetch(GITHUB_MANIFEST_URL, {
    method: "GET",
    headers: { Accept: "application/json, text/plain, */*", "User-Agent": "OneTHU-UpdateCheck" },
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) {
    throw new Error(res.status === 404 ? i18n("lib.updater.2d2cad3f99ea") : `HTTP ${res.status}`);
  }
  const parsed = parseManifest(await res.text());
  if (!parsed.ok) throw new Error(parsed.error);
  const m = parsed.manifest;
  const asset = pickAsset(m, key);
  if (!asset) throw new Error(i18n("lib.updater.b331bcbd6083", { version: String(m.version), key: String(key) }));
  return finish(m, key, asset, (rel) =>
    /^https?:/i.test(rel) ? rel : GITHUB_ASSET_BASE + encodeURIComponent(rel.split("/").pop() ?? rel));
}

async function fromCloud(key: PlatformKey, signal?: AbortSignal): Promise<Resolved> {
  const dir = CLOUD_PLATFORM_DIR[key];
  // 两个目录列表都要：根目录放 latest.json 时也要能发现；平台目录用来解析安装包
  const rootList = await shareDirents("/", signal);
  throwIfCancelled(signal);
  const dirList = await shareDirents(`${dir}/`, signal);
  throwIfCancelled(signal);
  const hasManifest = (list: ShareDirent[], name: string): boolean => list.some((d) => !d.is_dir && d.file_name === name);
  // ① 发布方若放了清单（根目录或平台目录），优先用它（带 sha256 / 更新说明）
  const candidates = [
    ...(hasManifest(rootList, "latest.json") ? ["/latest.json"] : []),
    ...(hasManifest(dirList, "latest.json") ? [`${dir}/latest.json`] : []),
  ];
  for (const cand of candidates) {
    try {
      throwIfCancelled(signal);
      const text = await shareFileText(cand, signal);
      const parsed = parseManifest(text);
      if (!parsed.ok) continue;
      const m = parsed.manifest;
      const asset = pickAsset(m, key);
      if (!asset) continue;
      return finish(m, key, asset, (rel) => (/^https?:/i.test(rel) ? rel : shareDownloadUrl(rel)));
    } catch (error) {
      // 取消不是「清单读不到」：继续走目录解析会掩盖取消语义。
      if (signal?.aborted) throw error;
      /* 清单读不到 → 走目录解析（镜像当前的真实形态就是只有安装包） */
    }
  }
  // ② 目录解析兜底（镜像实测形态：OneTHU_<版本>_<arch>.<ext>）
  const synth = synthFromDir(dirList, key);
  if (!synth) {
    const ext = key === "android" ? "apk" : key === "windows" ? "exe" : "dmg";
    throw new Error(i18n("lib.updater.4bffec153a88", { dir: String(dir), ext: String(ext), length: String(dirList.length) }));
  }
  return finish(synth.manifest, key, synth.asset, (rel) => shareDownloadUrl(rel));
}

interface SourcePlan {
  source: UpdateSource;
  run: () => Promise<Resolved>;
}

/** 单个源的超时：GitHub 快、云盘接口多一次目录列举，给得更宽。覆盖值对所有源生效。 */
function sourceTimeoutMs(source: UpdateSource, override?: number): number {
  return override ?? (source === "github" ? 8_000 : 15_000);
}

/**
 * 单源竞速：把「源的网络请求」与「应用侧超时 / 用户取消」赛跑。
 * 超时用结构化 errorKind 标记（UI 可重新本地化）；取消统一抛 AbortError。
 */
function guardSource(step: SourcePlan, opts: { signal?: AbortSignal; sourceTimeoutMs?: number }): Promise<Resolved> {
  return new Promise<Resolved>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = (): void => finish(() => reject(new DOMException("Cancelled", "AbortError")));
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      action();
    };
    timer = setTimeout(
      () => finish(() => reject(new UpdateSourceTimeout(i18n("update.sourceTimeout", { source: SOURCE_LABEL[step.source] })))),
      sourceTimeoutMs(step.source, opts.sourceTimeoutMs),
    );
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    step.run().then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
  });
}

/**
 * 双源都成功时的选源规则（导出供测试/诊断复用）：
 * - 只有 GitHub 成功 → GitHub；只有云盘成功 → 云盘；
 * - 两侧版本号相同 → **云盘**（校内直连更稳，下载不绕外网）；
 * - GitHub 严格更新（版本号更高）→ GitHub；
 * - 云盘版本更高 → 云盘。
 * 返回 null 表示没有任何可用结果。
 */
export function selectUpdateSource(candidates: Array<{ source: UpdateSource; latest?: string }>): UpdateSource | null {
  if (candidates.length === 0) return null;
  const github = candidates.find(candidate => candidate.source === "github");
  const cloud = candidates.find(candidate => candidate.source === "cloud");
  if (github && !cloud) return "github";
  if (!github && cloud) return "cloud";
  if (!github || !cloud) return candidates[0]!.source;
  // 两侧都成功：只有拿得到版本号且 GitHub 严格更高才选 GitHub，其余（含同版本）都走云盘。
  return github.latest && cloud.latest && isNewer(github.latest, cloud.latest) ? "github" : "cloud";
}

interface SettledSource {
  source: UpdateSource;
  resolved: Resolved | null;
  error: unknown;
}

function attemptFor(settled: SettledSource): UpdateAttempt {
  if (settled.resolved) return { source: settled.source, label: SOURCE_LABEL[settled.source], ok: true };
  const error = settled.error;
  return {
    source: settled.source,
    label: SOURCE_LABEL[settled.source],
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    ...(error instanceof UpdateSourceTimeout ? { errorKind: "source-timeout" as const } : {}),
  };
}

/**
 * 检查更新：**并行**查询 GitHub 与云盘，按优先级选源。**不下载、不安装**。
 * `customManifestUrl` 非空时只走自定义源（「高级」里用户自己填的）。
 */
export async function checkForUpdate(opts: {
  customManifestUrl?: string;
  signal?: AbortSignal;
  onSource?: (source: UpdateSource) => void;
  sourceTimeoutMs?: number;
} = {}): Promise<UpdateCheckResult> {
  const current = currentVersion();
  const key = platformKey();
  const custom = (opts.customManifestUrl ?? "").trim();
  const plan: SourcePlan[] = custom
    ? [{
        source: "custom",
        run: async () => {
          throwIfCancelled(opts.signal);
          const res = await universalFetch(custom, { method: "GET", headers: { Accept: "application/json, text/plain, */*" }, ...(opts.signal ? { signal: opts.signal } : {}) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const parsed = parseManifest(await res.text());
          if (!parsed.ok) throw new Error(parsed.error);
          const m = parsed.manifest;
          const asset = pickAsset(m, key);
          if (!asset) throw new Error(i18n("lib.updater.b331bcbd6083", { version: String(m.version), key: String(key) }));
          return finish(m, key, asset, (rel) => (/^https?:/i.test(rel) ? rel : rel));
        },
      }]
    : [
        { source: "github", run: () => fromGitHub(key, opts.signal) },
        { source: "cloud", run: () => fromCloud(key, opts.signal) },
      ];

  if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  // 两侧同时开查：先按计划顺序报告一次「开始查谁」，选源确定后再报告最终源，
  // 让「正在检查 X…」的 UI 在两个源都查完后落到真正被采用的那一侧。
  for (const step of plan) opts.onSource?.(step.source);
  const outcomes = await Promise.all(
    plan.map(step => guardSource(step, opts).then(
      (resolved): SettledSource => ({ source: step.source, resolved, error: null }),
      (error): SettledSource => ({ source: step.source, resolved: null, error }),
    )),
  );
  if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");

  const attempts = outcomes.map(attemptFor);
  const succeeded = outcomes.flatMap(outcome => (outcome.resolved ? [{ source: outcome.source, resolved: outcome.resolved }] : []));
  if (succeeded.length === 0) {
    const detail = attempts.map((attempt) => `· ${attempt.label}：${attempt.error ?? i18n("lib.updater.a1a9da9ee6ed")}`).join("\n");
    return { ok: false, current, attempts, error: i18n("lib.updater.2985491184cc", { detail: String(detail) }) };
  }
  const selectedSource = selectUpdateSource(succeeded.map(item => ({ source: item.source, latest: item.resolved.latest })))!;
  const chosen = succeeded.find(item => item.source === selectedSource) ?? succeeded[0]!;
  opts.onSource?.(selectedSource);
  const failed = attempts.find((attempt) => !attempt.ok);
  void logLine(i18n("lib.updater.ddfe8fdf02cb", {
    value: String(SOURCE_LABEL[selectedSource]),
    latest: String(chosen.resolved.latest),
    current: String(current),
    value2: String(chosen.resolved.hasUpdate ? i18n("lib.updater.daedea385864") : i18n("lib.updater.4219a7449e26")),
  })).catch(() => undefined);
  return {
    ok: true,
    current,
    ...chosen.resolved,
    source: selectedSource,
    sourceLabel: SOURCE_LABEL[selectedSource],
    attempts,
    ...(failed ? { fallbackReason: i18n("lib.updater.ab90d58874ee", { label: String(failed.label), value: String(updateAttemptError(failed)) }) } : {}),
  };
}

/** Dev diagnostics: probe every official source independently. Unlike
 * checkForUpdate this does not select/fallback — the caller sees each row. */
export interface UpdateSourceProbe {
  source: UpdateSource;
  label: string;
  ok: boolean;
  latest?: string;
  hasUpdate?: boolean;
  error?: string;
  ms: number;
}

export async function probeUpdateSources(opts: { signal?: AbortSignal; sourceTimeoutMs?: number } = {}): Promise<UpdateSourceProbe[]> {
  const key = platformKey();
  const plan: SourcePlan[] = [
    { source: "github", run: () => fromGitHub(key, opts.signal) },
    { source: "cloud", run: () => fromCloud(key, opts.signal) },
  ];
  const started = Date.now();
  const settled = await Promise.all(plan.map(async (step): Promise<UpdateSourceProbe> => {
    const at = Date.now();
    try {
      const result = await guardSource(step, opts);
      return { source: step.source, label: SOURCE_LABEL[step.source], ok: true, latest: result.latest, hasUpdate: result.hasUpdate, ms: Date.now() - at };
    } catch (error) {
      return {
        source: step.source,
        label: SOURCE_LABEL[step.source],
        ok: false,
        error: error instanceof UpdateSourceTimeout
          ? i18n("update.sourceTimeout", { source: SOURCE_LABEL[step.source] })
          : error instanceof Error ? error.message : String(error),
        ms: Date.now() - at,
      };
    }
  }));
  void started;
  return settled;
}

/* ═══════════ 下载 / 取消 / 拉起安装页 ═══════════ */

/**
 * 下载更新包（用户点了才调）。进度经 `onethu-updater://progress` 回传。
 * `expectSha256` 非空时由 Rust 侧流式校验，**不符即丢弃文件并报错**（不会交给安装器）。
 */
let activeUpdateDownload: { token: symbol; fileName: string } | null = null;

export async function downloadUpdate(opts: {
  url: string;
  fileName: string;
  expectSize?: number;
  expectSha256?: string;
  /** 分段并发数（1..16，缺省 8）。原生侧探测到服务器不支持 Range 时会自动回落单流。 */
  threads?: number;
  onProgress?: (p: UpdateProgress) => void;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; path?: string; dir?: string; size?: number; sha256?: string; verified?: boolean; error?: string; cancelled?: boolean }> {
  if (opts.signal?.aborted) return { ok: false, cancelled: true };
  if (activeUpdateDownload) return { ok: false, error: i18n("components.softwareupdatesection.faa2f14dfa0b", { downloadName: activeUpdateDownload.fileName }) };
  const token = Symbol("update-download");
  activeUpdateDownload = { token, fileName: opts.fileName };
  let unlisten: (() => void) | undefined;
  let nativeStarted = false;
  const abort = (): void => {
    if (nativeStarted && activeUpdateDownload?.token === token) void cancelUpdateDownload();
  };
  opts.signal?.addEventListener("abort", abort, { once: true });
  try {
    if (typeof opts.onProgress === "function") {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<UpdateProgress>("onethu-updater://progress", (ev) => {
        const p = ev.payload;
        if (!opts.signal?.aborted && p && typeof p.received === "number") opts.onProgress?.(p);
      });
    }
    // Registration itself is asynchronous. A close/cancel during it must not
    // start a new native download after the cancellation command has passed.
    if (opts.signal?.aborted) return { ok: false, cancelled: true };
    nativeStarted = true;
    const r = await invoke<{ path: string; dir: string; size: number; sha256: string; verified: boolean }>("updater_download", {
      url: opts.url,
      fileName: opts.fileName,
      expectSize: opts.expectSize ?? null,
      expectSha256: opts.expectSha256 ?? null,
      // 归一化在共享模块里做（设置页写入的也是同一套合法值）；原生侧仍会再夹紧一次。
      threads: normalizeDownloadThreads(opts.threads),
    });
    if (opts.signal?.aborted) return { ok: false, cancelled: true };
    return { ok: true, path: r.path, dir: r.dir, size: r.size, sha256: r.sha256, verified: r.verified };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, cancelled: opts.signal?.aborted || /已取消/.test(msg) };
  } finally {
    opts.signal?.removeEventListener("abort", abort);
    unlisten?.();
    if (activeUpdateDownload?.token === token) activeUpdateDownload = null;
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
  hintMessage?: UiText;
  errorMessage?: UiText;
}

/**
 * 把已下载的安装包拉到系统安装页。**只拉起，不静默安装**：
 * - 安卓：`updater_open_installer` → Kotlin FileProvider → `content://` → ACTION_VIEW
 *   （`application/vnd.android.package-archive`）；「安装未知应用」授权由系统弹；
 * - 桌面：同一原生入口复核已下载文件后打开系统安装器。
 */
export async function installDownloaded(path: string): Promise<InstallLaunchResult> {
  if (!path) {
    const errorMessage = i18nMsg("lib.updater.42b98aa3fae8");
    return { ok: false, error: resolveMessage(errorMessage), errorMessage };
  }
  const key = platformKey();
  try {
    await invoke("updater_open_installer", { path });
    const hintMessage = key === "android" ? i18nMsg("lib.updater.2da47c897e30") : key === "macos" ? i18nMsg("lib.updater.185680ad27cd") : i18nMsg("lib.updater.95bc488982b2");
    return { ok: true, hint: resolveMessage(hintMessage), hintMessage };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void logLine(i18n("lib.updater.c57372e35f51", { msg: String(msg) })).catch(() => undefined);
    return { ok: false, error: msg };
  }
}
