/**
 * 系统日历原生同步状态层（learnX 模型）。
 *
 * 平台：Android（CalendarProvider 插件）/ macOS（EventKit 插件）；其他平台
 * systemCalSupported() = false（前端退 .ics 导出）。
 *
 * 模型：
 * - 专属日历「OneTHU 日程」（本地账户，不碰用户日历、不与云同步冲突）；
 * - 幂等：窗口内清旧重写（窗口 = 过去 90 天 ~ 未来 18 个月 ∪ 学期范围）；
 * - 一次开启后自动跟随：云/本日程或课表任何变更 → 防抖 5s → 指纹未变则跳过；
 * - 课表/考试带提前 15 分钟提醒，手动日程不带。
 *
 * 存储：syscal.cfg { enabled, lastSyncAt, lastCount, lastError, fingerprint }。
 */
import { useEffect, useState } from "react";
import { caldav } from "@onethu/core";
import type { CalendarSemester } from "@onethu/core";
import { fileRead, fileWrite, info } from "../lib/clients.js";
import { getCloudEvents, getLocalEvents, buildSemesterEvents, onCloudCalChange } from "./cloudCal.js";
import { parseLearnTime } from "@onethu/core";
import { getLearnSnapshot, subscribeLearnData } from "./data.js";
import { getHwRemindState, subscribeHwRemind, type HwRemindState } from "./hwRemind.js";
import { getCachedCalendar } from "./data.js";

const CFG_FILE = "syscal.cfg";
/** 与 Rust/Kotlin 侧 CALENDAR_TITLE 保持一致 */
export const CALENDAR_TITLE = "OneTHU 日程";

const DAY = 86_400_000;
/** 同步窗口：过去 90 天（滚动） */
const PAST_WINDOW = 90 * DAY;
/** 同步窗口：未来 18 个月（滚动，RRULE 展开上限） */
const FUTURE_WINDOW = 550 * DAY;
/** 事件数上限（课表 ~600 + 手动日程；超出直接中止，防止事故性大批量写入） */
const MAX_EVENTS = 4000;
/** 课表/考试提醒（learnX 同款 -15 分钟） */
const ALARM_MINUTES = 15;

/* ---------- 载荷类型（与插件 camelCase 对齐） ---------- */

interface SysCalEventArg {
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  location?: string;
  notes?: string;
  alarmMinutes?: number;
}

interface SyncPayloadArg {
  calendarTitle: string;
  windowStartMs: number;
  windowEndMs: number;
  events: SysCalEventArg[];
}

interface SysCalCfg {
  enabled: boolean;
  /** 用户明确点过「停止自动同步」（手动同步成功后不再自动重新开启） */
  stopped: boolean;
  lastSyncAt: number;
  lastCount: number;
  lastError: string | null;
  fingerprint: string | null;
}

/** 状态文件版本：2 = 幂等修复（清旧改标题匹配）+ 自动跟随随同步开启。老版本指纹作废，强制全量重写一次自愈重复事件 */
const CFG_VERSION = 2;

/* ---------- 模块状态 ---------- */

let loaded = false;
let cfg: SysCalCfg = { enabled: false, stopped: false, lastSyncAt: 0, lastCount: 0, lastError: null, fingerprint: null };
let supportedCache: boolean | null = null;
let syncing = false;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((fn) => fn());

async function persistCfg(): Promise<void> {
  await fileWrite(CFG_FILE, JSON.stringify({ version: CFG_VERSION, ...cfg }));
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await fileRead(CFG_FILE);
    if (raw) {
      const j = JSON.parse(raw) as Partial<SysCalCfg> & { version?: number };
      if (typeof j.enabled === "boolean") {
        const legacy = j.version !== CFG_VERSION; // 老数据：指纹作废 → 下次同步全量重写（清掉重复事件）
        cfg = {
          enabled: j.enabled,
          stopped: j.stopped === true,
          lastSyncAt: legacy ? 0 : typeof j.lastSyncAt === "number" ? j.lastSyncAt : 0,
          lastCount: legacy ? 0 : typeof j.lastCount === "number" ? j.lastCount : 0,
          lastError: legacy ? null : typeof j.lastError === "string" ? j.lastError : null,
          fingerprint: legacy ? null : typeof j.fingerprint === "string" ? j.fingerprint : null,
        };
      }
    }
  } catch {
    /* 坏文件视作未开启 */
  }
  emit();
}

/* ---------- 插件桥 ---------- */

async function invokePlugin<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<T>(`plugin:onethu-calendar|${cmd}`, args);
}

/** 当前平台是否支持原生系统日历读写（非 Tauri 环境也返回 false） */
export async function systemCalSupported(): Promise<boolean> {
  if (supportedCache === null) {
    try {
      supportedCache = await invokePlugin<boolean>("supported");
    } catch {
      supportedCache = false;
    }
  }
  return supportedCache;
}

/* ---------- 载荷构建 ---------- */

function parseYmd(s: string): Date {
  return new Date(s.replace(/-/g, "/"));
}

/** 今天落在哪个学期（假期则回落当前学期）；校历未加载返回 null */
function currentSemester(): CalendarSemester | null {
  const cal = getCachedCalendar();
  if (!cal) return null;
  const list: CalendarSemester[] = [{ ...cal }, ...cal.nextSemesterList];
  const now = Date.now();
  for (const s of list) {
    const start = parseYmd(s.firstDay).getTime();
    if (now >= start && now < start + s.weekCount * 7 * DAY) return s;
  }
  return cal;
}

async function buildPayload(): Promise<SyncPayloadArg> {
  const now = Date.now();
  const all = [...getCloudEvents(), ...getLocalEvents()];

  // 窗口：滚动窗口 ∪ 学期范围 ∪ 单场事件极值（RRULE 展开上限 = 滚动上限）
  let windowStart = now - PAST_WINDOW;
  let windowEnd = now + FUTURE_WINDOW;
  const sem = currentSemester();
  if (sem) {
    windowStart = Math.min(windowStart, parseYmd(sem.firstDay).getTime());
    windowEnd = Math.max(windowEnd, parseYmd(sem.firstDay).getTime() + (sem.weekCount * 7 - 1) * DAY);
  }
  for (const e of all) {
    windowStart = Math.min(windowStart, e.start - DAY);
    windowEnd = Math.max(windowEnd, e.start + DAY);
  }

  // 云/本日程展开为单场（覆盖实例自动接管；提醒不带）
  const events: SysCalEventArg[] = [];
  for (const occ of caldav.expandEventSet(all, windowStart, windowEnd)) {
    events.push({
      title: occ.summary,
      startMs: occ.start,
      endMs: occ.end,
      allDay: !!occ.allDay,
      location: occ.location,
      notes: occ.description,
    });
  }

  // 课表/考试（-15 分钟提醒）；获取失败整体中止——防止半量镜像清掉已有内容
  if (sem) {
    const { events: courseEvents } = await buildSemesterEvents(sem, (st, en) => info.getSchedule(st, en));
    for (const ev of courseEvents) {
      events.push({
        title: ev.summary,
        startMs: ev.start,
        endMs: ev.end,
        allDay: !!ev.allDay,
        location: ev.location,
        notes: ev.description,
        alarmMinutes: ALARM_MINUTES,
      });
    }
  }

  // 网络学堂作业 DDL（learnX 模式）
  events.push(...buildHwEvents(getLearnSnapshot(), getHwRemindState(), windowStart, windowEnd));

  events.sort((a, b) => a.startMs - b.startMs);
  if (events.length > MAX_EVENTS) throw new Error(`事件数 ${events.length} 超出上限 ${MAX_EVENTS}，已中止系统日历同步`);
  return { calendarTitle: CALENDAR_TITLE, windowStartMs: windowStart, windowEndMs: windowEnd, events };
}

/** 作业 DDL → 系统日历事件（纯函数可测）：未交才生成；闹钟 = 单作业覆盖 ?? 全局默认
 *  （用户拍板：先设所有作业共用的节点，想单独改再改；改完全局/覆盖都会触发重推）。 */
export function buildHwEvents(
  snap: { courses?: Array<{ id: string; name: string }>; homework?: Array<{ id: string; courseId: string; title: string; deadline: string; submitted: boolean }> } | null,
  hwRemind: HwRemindState,
  windowStart: number,
  windowEnd: number,
): SysCalEventArg[] {
  if (!snap) return [];
  const courseName = new Map((snap.courses ?? []).map((c) => [c.id, c.name]));
  const out: SysCalEventArg[] = [];
  for (const h of snap.homework ?? []) {
    if (h.submitted) continue; // 已交：不占日历（写完即清）
    const dl = parseLearnTime(h.deadline)?.getTime();
    if (!dl || dl < windowStart || dl > windowEnd) continue;
    out.push({
      title: `作业截止 · ${courseName.get(h.courseId) ?? ""} ${h.title}`.trim(),
      startMs: dl,
      endMs: dl + 15 * 60_000,
      allDay: false,
      notes: `网络学堂作业，${h.deadline} 截止。提交完成后自动从日历移除。`,
      alarmMinutes: hwRemind.items[h.id] ?? hwRemind.default, // 覆盖优先，全局默认兜底
    });
  }
  return out;
}

/** 载荷指纹（内容无变化则跳过原生写入） */
export function fingerprintOf(p: SyncPayloadArg): string {
  let h = 5381;
  const feed = `${p.windowStartMs}|${p.windowEndMs}|` + p.events.map((e) => `${e.title}@${e.startMs}-${e.endMs}!${e.alarmMinutes ?? 0}`).join(",");
  for (let i = 0; i < feed.length; i++) h = ((h << 5) + h + feed.charCodeAt(i)) >>> 0;
  return `${p.events.length}-${h.toString(36)}`;
}

/* ---------- 同步动作 ---------- */

export interface SystemCalSyncOutcome {
  added: number;
  removed: number;
  /** 指纹未变跳过了原生写入 */
  skipped: boolean;
}

/** 幂等同步（清窗口旧 + 全量重写） */
export async function syncSystemCalendar(opts?: { silent?: boolean }): Promise<SystemCalSyncOutcome> {
  if (syncing) throw new Error("系统日历正在同步中");
  syncing = true;
  try {
    // 运行时权限先行（单一收口）：课程表页「同步到系统日历」直进本函数，
    // 不经 enableSystemCalendar 的请求步骤——Android 上没授权直接 sync 会被
    // 原生侧拒绝（真机实锤）。request_permission 幂等：已授权立即返回 true。
    if (await systemCalSupported()) {
      const granted = await invokePlugin<boolean>("request_permission");
      if (!granted) throw new Error("未获得系统日历权限（可到系统设置里重新允许 OneTHU 访问日历）");
    }
    const payload = await buildPayload();
    const fingerprint = fingerprintOf(payload);
    // 静默自动推送内容未变则跳过；手动同步永远真跑（用于用户主动重建/修复系统日历）
    if (opts?.silent && cfg.fingerprint === fingerprint) {
      return { added: 0, removed: 0, skipped: true };
    }
    const r = await invokePlugin<{ added: number; removed: number }>("sync", { payload });
    // 任何一次成功同步都自动开启跟随（除非用户明确停止过）——对齐 learnX：写过一次就一直最新
    cfg = {
      ...cfg,
      enabled: cfg.stopped ? cfg.enabled : true,
      lastSyncAt: Date.now(),
      lastCount: payload.events.length,
      lastError: null,
      fingerprint,
    };
    await persistCfg();
    emit();
    return { added: r.added, removed: r.removed, skipped: false };
  } catch (err) {
    cfg = { ...cfg, lastError: err instanceof Error ? err.message : String(err) };
    await persistCfg();
    emit();
    throw err;
  } finally {
    syncing = false;
  }
}

/** 开启：请求权限 → 首次全量同步 → 记 enabled（此后自动跟随） */
export async function enableSystemCalendar(): Promise<void> {
  if (!(await systemCalSupported())) throw new Error("当前平台不支持系统日历原生同步（可从日程页导出 .ics 文件）");
  const granted = await invokePlugin<boolean>("request_permission");
  if (!granted) throw new Error("未获得系统日历权限（可到系统设置里重新允许 OneTHU 访问日历）");
  await syncSystemCalendar();
  cfg = { ...cfg, enabled: true, stopped: false };
  await persistCfg();
  emit();
}

/** 停止自动跟随（保留已写入的系统日历与事件；此后手动同步不再自动重新开启） */
export async function disableSystemCalendar(): Promise<void> {
  cfg = { ...cfg, enabled: false, stopped: true };
  await persistCfg();
  emit();
}

/** 清除：删除系统里的「OneTHU 日程」日历并重置状态 */
export async function removeSystemCalendar(): Promise<void> {
  await invokePlugin<unknown>("remove_calendar");
  cfg = { ...cfg, enabled: false, stopped: false, lastSyncAt: 0, lastCount: 0, lastError: null, fingerprint: null };
  await persistCfg();
  emit();
}

/* ---------- 自动跟随 ---------- */

let autoTimer: ReturnType<typeof setTimeout> | null = null;

async function autoPush(): Promise<void> {
  if (!cfg.enabled || syncing) return;
  if (!(await systemCalSupported())) return;
  try {
    await syncSystemCalendar({ silent: true });
  } catch {
    /* 已记入 lastError，Settings 可见 */
  }
}

function scheduleAutoPush(): void {
  if (autoTimer !== null) clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    autoTimer = null;
    void autoPush();
  }, 5000);
}

let initialized = false;

/** 应用启动时调用一次：订阅日程/课表变更 → 防抖自动重推 */
export function initSystemCalAutoSync(): void {
  if (initialized) return;
  initialized = true;
  void (async () => {
    await ensureLoaded();
    onCloudCalChange(scheduleAutoPush);
    // 作业数据（提交状态/新 DDL）与提醒档位变化 → 同样防抖重推
    subscribeLearnData(scheduleAutoPush);
    subscribeHwRemind(scheduleAutoPush);
    // 启动兜底：登录/云同步触发 emit 之外，20s 后补推一次（指纹未变会秒跳过）
    setTimeout(() => void autoPush(), 20_000);
  })();
}

/* ---------- React 绑定 ---------- */

export interface SystemCalState {
  ready: boolean;
  enabled: boolean;
  syncing: boolean;
  lastSyncAt: number;
  lastCount: number;
  lastError: string | null;
}

export function useSystemCal(): SystemCalState {
  const [snapshot, setSnapshot] = useState<SystemCalState>(() => ({
    ready: false,
    enabled: cfg.enabled,
    syncing,
    lastSyncAt: cfg.lastSyncAt,
    lastCount: cfg.lastCount,
    lastError: cfg.lastError,
  }));
  useEffect(() => {
    void ensureLoaded();
    const update = (): void =>
      setSnapshot({
        ready: true,
        enabled: cfg.enabled,
        syncing,
        lastSyncAt: cfg.lastSyncAt,
        lastCount: cfg.lastCount,
        lastError: cfg.lastError,
      });
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);
  return snapshot;
}
