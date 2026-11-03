import { t as i18n } from "../i18n/index.js";
/**
 * 云同步状态层 —— 清华邮箱 CalDAV 日程（M2/M3 地基）。
 *
 * 存储布局（Tauri state 文件，绕开 WKWebView localStorage 驱逐）：
 * - caldav.cfg    { email, authCode(混淆) }        —— 与 credentials 同通道
 * - caldav.cache  { email, savedAt, events: IcsEvent[] }   —— 云端事件全量镜像（含 href/etag）
 * - caldav.local  { events: IcsEvent[] }            —— 不上云的本地手动日程
 *
 * 同步策略（服务器无 CTAG/sync-token）：每次全量 Depth:1 etag 扫描，本地
 * etag 缓存比对，仅 GET 变更资源 —— 学生量级毫秒级。
 */
import { useEffect, useState } from "react";
import { CalDavClient, caldav } from "@onethu/core";
import { universalFetch } from "../lib/transport.js";
import { fileRead as readStateFile, fileWrite as writeStateFile, fileDelete as deleteStateFile, obfuscateSecret, deobfuscateSecret, info } from "../lib/clients.js";
import { getCalendarSnapshot } from "./data.js";
import type { HwRemindState } from "./hwRemind.js";

import { readCalendarDocument as fileRead, writeCalendarDocument } from "./sharedCalendar.js";
import { usesSharedRuntime } from "../lib/sharedRuntime.js";
const fileWrite = async (name:string,content:string) => {
  try { await writeCalendarDocument(name,content); }
  catch(error) { if(String(error).includes("CLI_TRANSFER_BUSY"))throw new Error(i18n("cli.package.removing")); if(String(error).includes("APP_DATA_CHANGED")){loaded=false;credentialsLoaded=false;throw new Error(i18n("calendar.shared.changed"));} throw error; }
};
const fileDelete = (name:string) => writeCalendarDocument(name,null);

const CFG_FILE = "caldav.cfg";
const CACHE_FILE = "caldav.cache";
const LOCAL_FILE = "caldav.local";

export interface CloudCalConfig {
  email: string;
  authCode: string;
}

interface CacheShape {
  email: string;
  savedAt: number;
  events: caldav.IcsEvent[];
}

/* -------------- 模块级单例（跨页面/组件共享同一份内存） -------------- */

let credentialsLoaded = false;
let credentialsPromise: Promise<void> | null = null;
let loaded = false;
let loadPromise: Promise<void> | null = null;
let accountEpoch = 0;
let configIntent = 0;
let operationTail: Promise<unknown> = Promise.resolve();
let credentialWriteTail: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const result = operationTail.then(fn);
  operationTail = result.catch(() => undefined);
  return result;
}
function assertAccount(epoch: number): void {
  if (epoch !== accountEpoch) throw new Error(i18n("state.cloudcal.5a6208164ba7"));
}
const accountKey = (email: string): string => email.trim().toLowerCase();
const configListeners = new Set<() => void>();
const emitConfig = (): void => configListeners.forEach((fn) => fn());
let cfg: CloudCalConfig | null = null;
let cloudEvents: caldav.IcsEvent[] = [];
let localEvents: caldav.IcsEvent[] = [];
let lastSyncAt = 0;
let mirrorReady = false;
let syncing = false;
let lastError: string | null = null;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((fn) => fn());
/** 内容变更订阅（真变了才触发；见 onCloudCalChange 注释） */
const changeListeners = new Set<() => void>();

/**
 * 批量变更闸门：批量期间只记账、不广播，结束时统一广播一次。
 *
 * 显式批量导出先写新数据再清过期项；只有整批结束才通知系统日历等跟随方，
 * 避免把中途镜像当成完整日历。失败时仍通知已成功持久化的部分。 */
let batchDepth = 0;
let batchDirty = false;
function emitChange(): void {
  if (batchDepth > 0) {
    batchDirty = true;
    return;
  }
  changeListeners.forEach((fn) => fn());
}
/** 把一段会多次改动镜像的操作收成一次广播（成功与否都收口，失败时已改的部分照常广播） */
async function withBatch<T>(fn: () => Promise<T>): Promise<T> {
  batchDepth++;
  try {
    return await fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0 && batchDirty) {
      batchDirty = false;
      changeListeners.forEach((f) => f());
    }
  }
}

async function persistCredentials(next: CloudCalConfig | null): Promise<void> {
  if (!next) {
    await fileDelete(CFG_FILE);
    return;
  }
  await fileWrite(CFG_FILE, JSON.stringify({ email: next.email, secret: obfuscateSecret(next.authCode, next.email) }));
}
async function persistCache(): Promise<void> {
  await fileWrite(CACHE_FILE, JSON.stringify({ email: cfg?.email ?? "", savedAt: lastSyncAt, events: cloudEvents } satisfies CacheShape));
}
/** 邮箱仅依赖凭据，不需要读取或修复日历内容缓存。配置自身错误不能吞掉。 */
export async function ensureCloudCalCredentialsLoaded(): Promise<void> {
  if (credentialsLoaded) return;
  if (credentialsPromise) return credentialsPromise;
  credentialsPromise = (async () => {
    const epoch = accountEpoch;
    const raw = await fileRead(CFG_FILE);
    // 显式重配/断开已经成功提交时，慢读取不能再恢复旧凭据。
    if (epoch !== accountEpoch) return;
    let restored: CloudCalConfig | null = null;
    if (raw !== null) {
      const stored = JSON.parse(raw) as { email?: unknown; secret?: unknown } | null;
      if (!stored || typeof stored.email !== "string" || !stored.email.trim() || typeof stored.secret !== "string" || !stored.secret) throw new Error(i18n("state.cloudcal.6d9090d5290b"));
      const authCode = deobfuscateSecret(stored.secret, stored.email);
      if (!authCode) throw new Error(i18n("state.cloudcal.5b53abc907c9"));
      restored = { email: stored.email, authCode };
    }
    cfg = restored;
    credentialsLoaded = true;
    emit(); emitConfig();
  })();
  try { await credentialsPromise; }
  finally { credentialsPromise = null; }
}

/** 日历内容独立恢复，失败时不影响已经可用的邮箱凭据。 */
async function ensureLoaded(): Promise<void> {
  if (loaded) { await refreshSharedCalendar(); return; }
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    await ensureCloudCalCredentialsLoaded();
    const epoch = accountEpoch;
    // 内容全部读完才发布；I/O/损坏文件不能伪装成空日历覆盖系统镜像。
    const [cacheRaw, localRaw] = await Promise.all([fileRead(CACHE_FILE), fileRead(LOCAL_FILE)]);
    const cache = cacheRaw ? JSON.parse(cacheRaw) as Partial<CacheShape> : null;
    const local = localRaw ? JSON.parse(localRaw) as { events?: caldav.IcsEvent[] } : null;
    if (cache && !Array.isArray(cache.events)) throw new Error(i18n("state.cloudcal.fe20ed20d492"));
    if (local && !Array.isArray(local.events)) throw new Error(i18n("state.cloudcal.33de4f649f2f"));
    assertAccount(epoch);
    // 旧无账号缓存不可证明归属，重新同步；本地日程独立保留。
    const matched = cfg && cache?.email && accountKey(cache.email) === accountKey(cfg.email);
    cloudEvents = matched ? cache.events ?? [] : [];
    lastSyncAt = matched ? cache.savedAt ?? 0 : 0;
    mirrorReady = !cfg || (!!matched && lastSyncAt > 0);
    localEvents = local?.events ?? [];
    loaded = true;
    emit();
    if (cloudEvents.length || localEvents.length) emitChange();
  })();
  try { await loadPromise; }
  catch (error) { lastError = i18n("state.cloudcal.6b8367664e76"); emit(); throw error; }
  finally { loadPromise = null; }
}

let sharedRefresh: Promise<void> | undefined;
/** Read the canonical account records after terminal writes and app resume. */
async function refreshSharedCalendar(): Promise<void> {
  if (!usesSharedRuntime() || !loaded) return;
  return sharedRefresh ??= enqueue(async () => {
    const epoch=accountEpoch;
    const [configRaw,localRaw,cacheRaw]=await Promise.all([fileRead(CFG_FILE),fileRead(LOCAL_FILE),fileRead(CACHE_FILE)]);
    assertAccount(epoch);
    const stored=configRaw?JSON.parse(configRaw):null;
    const nextCfg=stored?{email:stored.email,authCode:deobfuscateSecret(stored.secret,stored.email)}:null;
    const nextLocal=localRaw?JSON.parse(localRaw).events:[];
    const cache=cacheRaw?JSON.parse(cacheRaw):null;
    if(!Array.isArray(nextLocal))throw new Error(i18n("state.cloudcal.33de4f649f2f"));
    const configChanged=JSON.stringify(nextCfg)!==JSON.stringify(cfg);
    const nextCloud=nextCfg&&cache?.email&&accountKey(cache.email)===accountKey(nextCfg.email)?cache.events:[];
    const changed=configChanged||JSON.stringify(nextLocal)!==JSON.stringify(localEvents)||JSON.stringify(nextCloud)!==JSON.stringify(cloudEvents);
    cfg=nextCfg;localEvents=nextLocal;cloudEvents=nextCloud;lastSyncAt=cache?.savedAt??0;
    mirrorReady=!cfg||lastSyncAt>0;
    if(configChanged)emitConfig();if(changed){emit();emitChange();}
  }).finally(()=>{sharedRefresh=undefined;});
}

if(typeof window!=="undefined")window.addEventListener("onethu-cli-installation",()=>{
  accountEpoch++;loaded=false;credentialsLoaded=false;
  void Promise.allSettled([loadPromise,credentialsPromise,operationTail]).then(()=>{
    loaded=false;credentialsLoaded=false;return ensureLoaded();
  }).catch(()=>{lastError=i18n("state.cloudcal.6b8367664e76");emit();});
});

/** 仅配置生命周期通知，邮箱等凭据消费者不再订阅日程内容。 */
export function onCloudCalConfigChange(fn: () => void): () => void {
  configListeners.add(fn);
  return () => { configListeners.delete(fn); };
}

/** 已配置的 CalDAV / 邮箱地址（同步可读，未配置为 null）。 */
export function getCloudCalEmail(): string | null {
  return cfg?.email ?? null;
}

/** 日历配置与内容均恢复；邮箱请使用独立的 CredentialsLoaded 屏障。 */
export async function ensureCloudCalLoaded(): Promise<void> {
  await ensureLoaded();
}

/** 系统日历等破坏性镜像消费者不能把未拉取的新账号当成空远端。 */
export async function ensureCloudCalMirrorReady(): Promise<void> {
  await ensureLoaded();
  // 在队列外等待已开始的写入/批次；期间若又排入操作，继续等到稳定边界。
  for (;;) {
    const pending = operationTail;
    await pending;
    if (pending === operationTail) break;
  }
  if (cfg && !mirrorReady) await syncCloudCal();
}

/**
 * 订阅云/本日程**内容变更**（同步后发现真变了、增删改、首次从盘上装载）——
 * 系统日历自动跟随、通知/小组件重算用。返回退订函数。
 *
 * 与 emit()（React 状态：syncing / lastSyncAt，每次同步都要走一遍）**分开**：
 * 原先两者共用 emit()，于是「云同步扫了一遍、added/updated/removed 全 0」也把跟随方
 * 叫醒一次——白跑一轮载荷重建（拉整学期课表），叠上指纹失效就是白写一遍系统日历。
 * 现在只有内容真变了才广播。
 */
export function onCloudCalChange(fn: () => void): () => void {
  changeListeners.add(fn);
  return () => {
    changeListeners.delete(fn);
  };
}

export function getCloudCalConfig(): CloudCalConfig | null {
  return cfg;
}

/** 门面（OH）读取用：当前云端事件镜像 */
export function getCloudEvents(): caldav.IcsEvent[] {
  return cloudEvents;
}

/** 门面（OH）读取用：距上次同步毫秒数（Infinity=从未） */
export function msSinceSync(): number {
  return lastSyncAt ? Date.now() - lastSyncAt : Number.POSITIVE_INFINITY;
}

function makeClient(beforeWrite?: () => Promise<void>): CalDavClient | null {
  if (!cfg) return null;
  const epoch = accountEpoch;
  // The client may discover its calendar asynchronously before issuing PUT.
  // Keep this guard local to this request; ordinary UI clients stay independent.
  const fetcher: typeof universalFetch = beforeWrite ? async (input, init) => {
    if (["PUT", "DELETE", "POST", "MKCOL", "MKCALENDAR", "PROPPATCH"].includes(String(init?.method ?? "GET").toUpperCase())) {
      await beforeWrite();
      assertAccount(epoch);
    }
    return universalFetch(input, init);
  } : universalFetch;
  return new CalDavClient(fetcher, { email: cfg.email, authCode: cfg.authCode });
}

/* -------------- 动作 -------------- */

/** 配置并立即验证（设置页「保存并测试」） */
export async function configureCloudCal(email: string, authCode: string): Promise<string[]> {
  const intent = ++configIntent;
  const next = { email: email.trim(), authCode: authCode.trim() };
  if (!next.email || !next.authCode) throw new Error(i18n("state.cloudcal.5e7a239fbc21"));
  const probe = new CalDavClient(universalFetch, next);
  const names = (await probe.testConnection()).calendars;
  await commitCredentials(next, intent);
  return names;
}

export async function disconnectCloudCal(): Promise<void> {
  await commitCredentials(null, ++configIntent);
}

/** 显式恢复入口只替换凭据；日历坏文件保留，仍须通过内容就绪检查。 */
async function commitCredentials(next: CloudCalConfig | null, intent: number): Promise<void> {
  const pending = credentialWriteTail.then(async () => {
    if (intent !== configIntent) throw new Error(i18n("state.cloudcal.f3f8e2d173eb"));
    // 不等待远端扫描，也不预先发布“已连接”；写失败保留原连接状态。
    await persistCredentials(next);
    const changed = !next || !cfg || accountKey(cfg.email) !== accountKey(next.email);
    accountEpoch++;
    cfg = next;
    credentialsLoaded = true;
    if (changed) { cloudEvents = []; lastSyncAt = 0; mirrorReady = !next && loaded; }
    lastError = null;
    emit(); emitConfig();
    if (changed) emitChange();
  });
  credentialWriteTail = pending.catch(() => undefined);
  await pending;
}

export interface SyncResult { added: number; updated: number; removed: number; total: number }
let syncFlight: { epoch: number; promise: Promise<SyncResult> } | null = null;

async function readCloud(client: CalDavClient, epoch: number): Promise<SyncResult> {
  const metas = await client.listEvents();
  assertAccount(epoch);
  const resources = new Map<string, caldav.IcsEvent[]>();
  for (const event of cloudEvents) {
    if (event.href) resources.set(event.href, [...resources.get(event.href) ?? [], event]);
  }
  const next: caldav.IcsEvent[] = [];
  let added = 0, updated = 0;
  for (const meta of metas) {
    const old = resources.get(meta.href);
    if (old?.length && meta.etag && old.every(e => e.etag === meta.etag)) next.push(...old);
    else {
      const ics = await client.getIcs(meta.href);
      assertAccount(epoch);
      if (!/BEGIN:VCALENDAR/i.test(ics) || !/END:VCALENDAR/i.test(ics)) throw new Error(i18n("state.cloudcal.72574f41faea"));
      next.push(...caldav.parseIcs(ics).map(ev => ({ ...ev, href: meta.href, etag: meta.etag })));
      if (old) updated++; else added++;
    }
  }
  const removed = [...resources.keys()].filter(href => !metas.some(meta => meta.href === href)).length;
  const changed = JSON.stringify(next) !== JSON.stringify(cloudEvents);
  const savedAt = Date.now();
  assertAccount(epoch);
  await fileWrite(CACHE_FILE, JSON.stringify({ email: cfg!.email, savedAt, events: next } satisfies CacheShape));
  assertAccount(epoch);
  cloudEvents = next; lastSyncAt = savedAt; mirrorReady = true;
  if (changed) emitChange();
  return { added, updated, removed, total: next.length };
}

/** 同账号并发刷新共享同一结果，所有写操作与扫描串行。 */
export async function syncCloudCal(): Promise<SyncResult> {
  await ensureLoaded();
  const epoch = accountEpoch;
  const client = makeClient();
  if (!client) throw new Error(i18n("state.cloudcal.253f54401fa7"));
  if (syncFlight?.epoch === epoch) return syncFlight.promise;
  const promise = enqueue(async () => {
    assertAccount(epoch); syncing = true; lastError = null; emit();
    try { return await readCloud(client, epoch); }
    catch (error) { if (epoch === accountEpoch) lastError = error instanceof Error ? error.message : String(error); throw error; }
    finally { syncing = false; emit(); }
  });
  const flight = { epoch, promise }; syncFlight = flight;
  try { return await promise; } finally { if (syncFlight === flight) syncFlight = null; }
}

async function writeCloud(ev: caldav.IcsEvent, epoch: number, beforeWrite?: () => Promise<void>): Promise<void> {
  assertAccount(epoch);
  const client = makeClient(beforeWrite);
  if (!client) throw new Error(i18n("state.cloudcal.253f54401fa7"));
  const previous = cloudEvents.find(e => e.uid === ev.uid && e.recurrenceId === ev.recurrenceId);
  const resource = previous?.href ? cloudEvents.filter(e => e.href === previous.href) : [];
  if (previous && !previous.etag) throw new Error(i18n("state.cloudcal.812d9e62ba2d"));
  const merged = { ...previous, ...ev };
  const content = resource.length ? resource.map(e => e === previous ? merged : e) : [merged];
  const meta = await client.putIcs(ev.uid, caldav.serializeCalendar(content), previous
    ? { href: previous.href, etag: ev.etag || previous.etag } : { createOnly: true });
  assertAccount(epoch);
  const next = [...cloudEvents.filter(e => previous?.href ? e.href !== previous.href : e.uid !== ev.uid), ...content.map(e => ({ ...e, ...meta }))];
  await fileWrite(CACHE_FILE, JSON.stringify({ email: cfg!.email, savedAt: lastSyncAt, events: next } satisfies CacheShape));
  assertAccount(epoch);
  cloudEvents = next; emit(); emitChange();
}
async function removeCloud(uid: string, epoch: number, expectedEtag?: string, beforeWrite?: () => Promise<void>): Promise<void> {
  assertAccount(epoch);
  const client = makeClient(beforeWrite);
  if (!client) throw new Error(i18n("state.cloudcal.253f54401fa7"));
  const target = cloudEvents.find(e => e.uid === uid);
  if (!target) throw new Error(i18n("state.cloudcal.bd5ff99826df"));
  if (!target.href || !target.etag) throw new Error(i18n("state.cloudcal.fc42ba627dce"));
  await client.deleteEvent(target.href, expectedEtag || target.etag);
  assertAccount(epoch);
  const next = cloudEvents.filter(e => e.href !== target.href);
  await fileWrite(CACHE_FILE, JSON.stringify({ email: cfg!.email, savedAt: lastSyncAt, events: next } satisfies CacheShape));
  assertAccount(epoch);
  cloudEvents = next; emit(); emitChange();
}
export async function putCloudEvent(ev: caldav.IcsEvent, beforeWrite?: () => Promise<void>): Promise<void> {
  await ensureLoaded(); const epoch = accountEpoch;
  await enqueue(() => writeCloud(ev, epoch, beforeWrite));
}
export async function deleteCloudEvent(uid: string, expectedEtag?: string, beforeWrite?: () => Promise<void>): Promise<void> {
  await ensureLoaded(); const epoch = accountEpoch;
  await enqueue(() => removeCloud(uid, epoch, expectedEtag, beforeWrite));
}
export function getLocalEvents(): caldav.IcsEvent[] { return localEvents; }
async function writeLocal(events: caldav.IcsEvent[], beforeWrite?: () => Promise<void>): Promise<void> {
  await beforeWrite?.();
  await fileWrite(LOCAL_FILE, JSON.stringify({ events }));
  localEvents = events; emit(); emitChange();
}
export async function putLocalEvent(ev: caldav.IcsEvent, beforeWrite?: () => Promise<void>): Promise<void> {
  await ensureLoaded();
  await enqueue(() => writeLocal([...localEvents.filter(e => e.uid !== ev.uid || e.recurrenceId !== ev.recurrenceId), ev], beforeWrite));
}
export async function deleteLocalEvent(uid: string, beforeWrite?: () => Promise<void>): Promise<void> {
  await ensureLoaded();
  await enqueue(() => writeLocal(localEvents.filter(e => e.uid !== uid), beforeWrite));
}

/** 先确保目的侧已落盘，再清源侧。清理失败时两侧都保留，绝不先删唯一副本。 */
export async function saveCalendarEvent(ev: caldav.IcsEvent, options: { cloud: boolean; originalCloud?: boolean }, beforeWrite?: () => Promise<void>): Promise<void> {
  await ensureLoaded(); const epoch = accountEpoch;
  await enqueue(() => withBatch(async () => {
    const source = (options.originalCloud ? cloudEvents : localEvents).find(e => e.uid === ev.uid && e.recurrenceId === ev.recurrenceId);
    const merged = { ...source, ...ev };
    if (options.originalCloud !== undefined && options.originalCloud !== options.cloud && (source?.rrule || source?.recurrenceId !== undefined || (options.originalCloud ? cloudEvents : localEvents).filter(e => e.uid === ev.uid).length > 1)) {
      throw new Error(i18n("state.cloudcal.6600b7092f4c"));
    }
    if (options.cloud) await writeCloud(merged, epoch, beforeWrite);
    else { const { href: _href, etag: _etag, ...local } = merged; await writeLocal([...localEvents.filter(e => e.uid !== ev.uid || e.recurrenceId !== ev.recurrenceId), local], beforeWrite); }
    if (options.originalCloud === undefined || options.originalCloud === options.cloud) return;
    try {
      if (options.originalCloud) await removeCloud(ev.uid, epoch, ev.etag || source?.etag, beforeWrite);
      else await writeLocal(localEvents.filter(e => e.uid !== ev.uid), beforeWrite);
    } catch { throw new Error(i18n("state.cloudcal.892291a664b5")); }
  }));
}

/* -------------- React 钩子 -------------- */

export interface CloudCalState {
  ready: boolean;
  configured: boolean;
  email: string | null;
  cloudEvents: caldav.IcsEvent[];
  localEvents: caldav.IcsEvent[];
  lastSyncAt: number;
  syncing: boolean;
  error: string | null;
}

export function useCloudCal(): CloudCalState {
  const [snapshot, setSnapshot] = useState<CloudCalState>(() => ({
    ready: false,
    configured: !!cfg,
    email: cfg?.email ?? null,
    cloudEvents,
    localEvents,
    lastSyncAt,
    syncing,
    error: lastError,
  }));
  useEffect(() => {
    void ensureLoaded().catch(() => undefined);
    const update = (): void =>
      setSnapshot({
        ready: loaded,
        configured: !!cfg,
        email: cfg?.email ?? null,
        cloudEvents,
        localEvents,
        lastSyncAt,
        syncing,
        error: lastError,
      });
    listeners.add(update);
    const refresh=()=>{if(document.visibilityState!=="hidden")void refreshSharedCalendar().catch(error=>{lastError=String(error).includes("APP_DATA_CHANGED")?i18n("calendar.shared.changed"):i18n("state.cloudcal.6b8367664e76");emit();});};
    const timer=setInterval(refresh,5000);
    window.addEventListener("focus",refresh);
    window.addEventListener("onethu-cli-installation",refresh);
    update();
    return () => {
      listeners.delete(update);clearInterval(timer);window.removeEventListener("focus",refresh);window.removeEventListener("onethu-cli-installation",refresh);
    };
  }, []);
  return snapshot;
}

/* -------------- 课表写入云日历（M4） -------------- */

import type { ScheduleEntry } from "@onethu/core";

/** 节次兜底时刻（与课表网格 BEGIN_TIME/END_TIME 同源） */
const SECTION_BEGIN = ["", "08:00", "08:50", "09:50", "10:40", "11:30", "13:30", "14:20", "15:20", "16:10", "17:05", "17:55", "19:20", "20:10", "21:00"];
const SECTION_END = ["", "08:45", "09:35", "10:35", "11:25", "12:15", "14:15", "15:05", "16:05", "16:55", "17:50", "18:40", "20:05", "20:55", "21:45"];

function sig32(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const MIN = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const AT = (date: string, minutes: number): number => caldav.wallToEpoch(caldav.CAMPUS_TZ, {
  y: Number(date.slice(0, 4)), mo: Number(date.slice(5, 7)), d: Number(date.slice(8, 10)),
  h: Math.floor(minutes / 60), mi: minutes % 60, s: 0,
});

function validDate(date: string | undefined): date is string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date;
}
function semesterRange(semester: { firstDay: string; weekCount: number }): { start: string; end: string } {
  if (!validDate(semester.firstDay) || !Number.isInteger(semester.weekCount) || semester.weekCount < 1 || semester.weekCount > 60) throw new Error(i18n("state.cloudcal.e2f9152c9203"));
  const end = Date.parse(`${semester.firstDay}T00:00:00Z`) + (semester.weekCount * 7 - 1) * 86_400_000;
  return { start: semester.firstDay, end: new Date(end).toISOString().slice(0, 10) };
}

/**
 * 本学期课表/考试写入云日历（每场次一个 VEVENT，按日期精确展开——单双周
 * 语义零风险）。UID 稳定派生；显式导出先条件更新，再清理过期项。
 * 任一新日程写入失败时保留尚未清理的旧课程。
 */
/** 构建整学期逐场事件（课表上云 / 系统日历导出共用）：date|time|课名 稳定 uid */
export async function buildSemesterEvents(
  semester: { firstDay: string; weekCount: number },
  fetchSchedule: (start: string, end: string) => Promise<ScheduleEntry[]>,
): Promise<{ events: caldav.IcsEvent[]; skipped: number }> {
  const range = semesterRange(semester);
  const entries = await fetchSchedule(range.start, range.end);
  const isExam = (e: ScheduleEntry): boolean => !!e.category && e.category.includes("考试");

  const events: caldav.IcsEvent[] = [];
  let skipped = 0;
  for (const e of entries) {
    const date = e.date!;
    const s = e.startTime ?? SECTION_BEGIN[e.startSection ?? 1];
    const t = e.endTime ?? SECTION_END[e.endSection ?? e.startSection ?? 1];
    if (!validDate(date) || !s || !t || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t)) {
      skipped++;
      continue;
    }
    const start = AT(date, MIN(s));
    const end = Math.max(AT(date, MIN(t)), start + 45 * 60_000);
    const exam = isExam(e);
    events.push({
      uid: `onethu-${exam ? "exam" : "course"}-${sig32(`${date}|${s}|${e.courseName}`)}@onethu`,
      summary: exam ? `【考试】${e.courseName}` : e.courseName,
      start,
      end,
      location: e.location,
      description: [e.teacher && `教师：${e.teacher}`, e.weekText && `周次：${e.weekText}`].filter(Boolean).join("\n") || undefined,
      categories: [exam ? "ONETHU-EXAM" : "ONETHU-COURSE"],
      onethuSource: exam ? "exam" : "course",
    });
  }
  return { events, skipped };
}

export async function exportSemesterToCloud(
  semester: { firstDay: string; weekCount: number },
  fetchSchedule: (start: string, end: string) => Promise<ScheduleEntry[]>,
  onProgress?: (done: number, total: number, phase: "清理旧数据" | "写入日程") => void,
): Promise<{ written: number; removed: number; skipped: number }> {
  await ensureLoaded(); const epoch = accountEpoch;
  return enqueue(() => withBatch(async () => {
    assertAccount(epoch);
    const client = makeClient();
    if (!client) throw new Error(i18n("state.cloudcal.253f54401fa7"));
    const { events, skipped } = await buildSemesterEvents(semester, fetchSchedule);
    // 部分/损坏的源数据不能被当成完整学期去删除远端课程。
    if (skipped) throw new Error(i18n("state.cloudcal.8120a4a0177c"));
    await readCloud(client, epoch);
    const stale = cloudEvents.filter(e => (e.onethuSource === "course" || e.onethuSource === "exam") && !events.some(w => w.uid === e.uid));
    let written = 0, removed = 0;
    onProgress?.(0, events.length, "写入日程");
    // 全部写入成功后才删除过期项；任一失败向用户报告，不伪装同步成功。
    for (const ev of events) { await writeCloud(ev, epoch); written++; onProgress?.(written, events.length, "写入日程"); }
    onProgress?.(0, stale.length, "清理旧数据");
    for (const uid of new Set(stale.map(e => e.uid))) { await removeCloud(uid, epoch); removed++; onProgress?.(removed, stale.length, "清理旧数据"); }
    return { written, removed, skipped: 0 };
  }));
}

/* ══════════ 作业 DDL 上云（用户 2026-09-09 拍板：DDL 不能只进本地系统日历） ══════════
 * 与课表 exportSemesterToCloud 同思路，但全自动：learn 数据 / 两级提醒任何变化
 * → 防抖重推（指纹相同跳过）。未交才写，交完即删；闹钟 = 单作业覆盖 ?? 全局默认
 * （IcsEvent.alarmMinutes → VALARM）。未配置云同步时全程静默。 */

/** 作业 DDL → 云日历事件（纯函数可测）
 *  2026-09-19 停用：作业 DDL 改由日程网格 hw 块承担（重叠自动缩略，见
 *  Schedule.tsx clusterize）。固定返回 []，不恢复已退役的自动上传。
 *  历史云事件保留，清理由用户显式操作。 */
export function buildHwCloudEvents(
  snap: { courses?: Array<{ id: string; name: string }>; homework?: Array<{ id: string; courseId: string; title: string; deadline: string; submitted: boolean }> } | null,
  hwRemind: HwRemindState,
): caldav.IcsEvent[] {
  void snap; void hwRemind;
  return [];
}

/** 已退役：保留调用兼容，但不再因学习数据更新静默删除远端历史日程。 */
export async function syncHwToCloud(): Promise<{ written: number; removed: number; skipped: boolean }> {
  return { written: 0, removed: 0, skipped: true };
}

/* 已退役自动订阅；保留显式操作原子兼容，调用时对账所有内容字段。 */
let semesterCloudBusy = false;
let semesterAutoInfo: { at: number; written: number; removed: number; skipped: boolean; reason?: string } | null = null;

/** 导出目标学期：今天落在哪学期用哪个（无匹配退当前学期）——与日程页按钮口径一致 */
function pickExportSemester(cal: NonNullable<ReturnType<typeof getCalendarSnapshot>>): { firstDay: string; weekCount: number; semesterId?: string; semesterName?: string } | null {
  const list = [{ ...cal }, ...(cal.nextSemesterList ?? [])];
  const now = Date.now();
  for (const s of list) {
    const start = new Date(`${s.firstDay}T00:00:00+08:00`).getTime();
    if (!Number.isFinite(start) || !s.weekCount) continue;
    if (now >= start && now < start + s.weekCount * 7 * 86_400_000) return s;
  }
  return cal.firstDay && cal.weekCount ? cal : null;
}

/** 显式课表 → 云：对账一致不重写。名称保留兼容，模块不自动调用。 */
export async function syncSemesterToCloudAuto(): Promise<{ written: number; removed: number; skipped: boolean; reason?: string }> {
  await ensureLoaded();
  if (semesterCloudBusy) return { written: 0, removed: 0, skipped: true, reason: "进行中" };
  if (!makeClient()) return { written: 0, removed: 0, skipped: true, reason: "未配置云同步" };
  const cal = getCalendarSnapshot();
  if (!cal) return { written: 0, removed: 0, skipped: true, reason: "校历未加载" };
  const sem = pickExportSemester(cal);
  if (!sem) return { written: 0, removed: 0, skipped: true, reason: "无学期信息" };
  semesterCloudBusy = true;
  try {
    const epoch = accountEpoch;
    const range = semesterRange(sem);
    const entries = await info.getSchedule(range.start, range.end);
    assertAccount(epoch);
    const { events, skipped } = await buildSemesterEvents(sem, async () => entries);
    if (skipped) throw new Error(i18n("state.cloudcal.8120a4a0177c"));
    await syncCloudCal();
    assertAccount(epoch);
    // 标题、地点、结束时刻变动也必须更新。
    const signature = (e: caldav.IcsEvent): string => JSON.stringify([e.summary, e.start, e.end, e.location ?? "", e.description ?? "", e.onethuSource]);
    const want = new Map(events.map((e) => [e.uid, signature(e)] as const));
    const have = cloudEvents.filter((e) => e.onethuSource === "course" || e.onethuSource === "exam");
    if (have.length === want.size && have.every((e) => want.get(e.uid) === signature(e))) {
      semesterAutoInfo = { at: Date.now(), written: 0, removed: 0, skipped: true, reason: "云端已是最新" };
      return semesterAutoInfo;
    }
    const r = await exportSemesterToCloud(sem, async () => entries);
    semesterAutoInfo = { at: Date.now(), written: r.written, removed: r.removed, skipped: false };
    emit();
    return semesterAutoInfo;
  } finally {
    semesterCloudBusy = false;
  }
}

/** 自动上云状态（日程页状态条显示用；onCloudCalChange 变化时重读） */
export function getSemesterAutoInfo(): { at: number; written: number; removed: number; skipped: boolean; reason?: string } | null {
  return semesterAutoInfo;
}

/* 课表上云已退役（2026-09-13 用户决策）：系统日历自动同步覆盖全部场景，
   云端/本地双源重复日程治理不达标准（日历紊乱实锤）。自动推送订阅与
   scheduleSemesterCloudSync 守护一并拆除；syncSemesterToCloudAuto 保留
   导出仅供清除云端残留用途，不再有任何触发点。 */
