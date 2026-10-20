/** 插件门面：把应用原子操作按权限包装成 onethu.* 公共接口 */
import { info, learn, http, loadRemembered, currentFingerprint } from "../lib/clients.js";
import { InfoClient, caldav } from "@onethu/core";
import { universalFetch } from "../lib/transport.js";
import { navGo, sessionStatus } from "./bridges.js";
import { venueClient } from "../lib/venue.js";
import { openExternal } from "../pages/info/openExternal.js";
import { normalizeServiceName, serviceScore } from "../lib/serviceMatch.js";
import { explainNetworkError } from "../lib/transport.js";
import { getPlugin, pluginStorageKey, updatePlugin } from "./registry.js";
import { PluginPermissionError, type OnethuApi, type PluginPermission } from "./types.js";

import { invoke } from "@tauri-apps/api/core";
import { activateTheme, setDayNightTheme, setFollowSystem, activeThemeId, listThemes, themeSchedule } from "../state/theme.js";
import { currentThemeIsDark } from "../state/theme.js";
import { refreshExtHw } from "../state/exthw.js";
import { session as appSession, logLine, http as campusHttp, learn as campusLearn } from "../lib/clients.js";
import { AuthRequiredError } from "@onethu/core";
import type { FormField } from "../lib/formModal.js";
import { mcpServersJsonForSettings } from "../lib/mcpStore.js";
import { getTabRoot, onTabReady } from "./tabs.js";
import { getPluginAtom, pluginAtomKindOf, pluginAtomKinds, registerStaticAtomItem, staticAtomKinds } from "./pluginAtoms.js";
import * as pluginWidgets from "./pluginWidgets.js";
import { atomKeyOf, atomRefFromKey, createFolder, loadFavs, saveFavs } from "../state/favorites.js";
import {
  activateUserTheme,
  deleteFlow,
  deleteTheme,
  deleteTool,
  runFlow as runFlowSteps,
  runTool as runToolSteps,
  sanitizeUserHtml,
  setPhoneWidget,
  registerFlowExecutor,
  setFlowEnabled,
  startScheduler,
  updateFlow,
  upsertFlow,
  upsertTool,
  deleteWidget,
  upsertTheme,
  upsertWidget,
  userExtSnapshot,
  startUserThemeWatch,
  type ExtStep,
} from "../state/userext.js";
import { addItem, freeBoardSnapshot, removeItem } from "../state/freeBoard.js";
import {
  addAtomToBoard, addAtomToHome,
  allOnePages, createOnePage, mutateBoards, notifyBoardsChanged,
  openOnePage, removeOnePage, renameOnePage,
} from "../state/onePage.js";
import { SYSTEM_BOARD_ID, rectFromCell } from "../state/boardCore.js";
import { renameBoard } from "../state/boardOps.js";
import {
  allSphereEntries, dockSphere, sphereEntry, spheresSnapshot, undockSphere,
} from "../state/homeSpheres.js";
import {
  closeLiveWorkspace, closeTab, createLiveWorkspace, deleteWorkspace, dissolveWorkspace,
  duplicateTab, explorerSnapshot, focusTab, isKnownPage, openTab, openWorkspace, patchLiveWorkspace, saveWorkspace,
} from "../state/explorer.js";
import {
  setGlobalWallpaper, wallpaperSnapshot, BUILTIN_WALLPAPERS,
} from "../state/wallpaper.js";
import { readVoicePrefs, setVoicePrefs } from "../state/voicePrefs.js";
import { explorerPrefsSnapshot, setExplorerPrefs } from "../state/explorerPrefs.js";
import { loadNotifySettings, saveNotifySettings } from "../state/notifySettings.js";
import { setHwDefault, setHwReminder } from "../state/hwRemind.js";
import { requestVisitDraft } from "../state/visitDraft.js";
import * as geek from "../lib/geekBrowser.js";

/** ext.tabOpen 允许打开的一级页（子页是 tab 内导航，不走新标签）。
 *  清小搭（xiaoda，2026-10-15）：一级页里 OH 要开就得在这张表里 ⇒ 进坞/进搜索栏之外，
 *  这是「OH 可调用」的那一环（ext_tab op=open 与其它走 tabOpen 的链路共用）。 */
const TOP_PAGES = new Set([
  "homepage", "learn", "schedule", "trace", "otherinfo", "info", "life", "reserve", "zhjwxk", "thos",
  "mail", "cloud", "gitlab", "thubook", "xiaoda", "tasks", "services", "favs", "boards", "board",
  "learn-assignments", "learn-notices", "learn-files", "learn-search", "learn-semester",
]);
import {
  getCloudCalConfig, getCloudEvents, getLocalEvents, msSinceSync, syncCloudCal,
  putCloudEvent, deleteCloudEvent, putLocalEvent, deleteLocalEvent,
} from "../state/cloudCal.js";
import { refreshMail, readMail, mailSearch, sendMail, mailFolderTotal } from "../state/mail.js";
import {
  memoryAppend, memoryDelete, memoryEdit, memoryList, memoryRead, memoryReady,
  memoryRefresh, memorySearch, memoryWrite,
} from "../memory/operations.js";
import { getLearnSnapshot } from "../state/data.js";
import { getExtHwSnapshot, toHomework } from "../state/exthw.js";
import { parseLearnTime } from "@onethu/core";
import { ensureSeafileLoaded, getSeafileToken } from "../state/seafile.js";
import type { GitlabIssueState } from "../state/gitlab.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

function gate(perms: Set<string>, perm: PluginPermission, what: string): void {
  if (!perms.has(perm)) throw new PluginPermissionError(perm, what);
}
function wrap<T extends Record<string, unknown>>(obj: T, perms: Set<string>, perm: PluginPermission): T {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    out[k] = typeof v === "function"
      ? (...args: unknown[]) => {
          gate(perms, perm, String(k));
          return (v as (...a: unknown[]) => unknown)(...args);
        }
      : v;
  }
  return out as T;
}


import type { WidgetBinding } from "../state/widgetInstances.js";
import { t as i18n } from "../i18n/index.js";


/** 校验插件传来的绑定：目标必须真实存在，否则拒绝（改了配置却指向不存在的东西最糟） */
async function normalizeBinding(raw: unknown): Promise<WidgetBinding | null> {
  const b = raw as { kind?: string; folderId?: string; atom?: { kind?: string; key?: string } } | null;
  if (!b || typeof b !== "object") return null;
  if (b.kind === "today") return { kind: "today" };
  if (b.kind === "folder") {
    const { loadFavs } = await import("../state/favorites.js");
    const id = String(b.folderId ?? "");
    return id && loadFavs().folders[id] ? { kind: "folder", folderId: id } : null;
  }
  if (b.kind === "detail" || b.kind === "shortcut") {
    const { resolveAtom } = await import("../state/atoms.js");
    const kind = String(b.atom?.kind ?? "");
    const key = String(b.atom?.key ?? "");
    if (!kind || !key || !resolveAtom({ kind, key })) return null;
    return { kind: b.kind, atom: { kind, key } };
  }
  return null;
}

async function fallbackBinding(): Promise<WidgetBinding> {
  const { loadWidgetInstances } = await import("../state/widgetInstances.js");
  return loadWidgetInstances().fallback;
}

/** ext_onepage_add 的 kind+payload → WidgetSpec（白板组件三形态）。
 *  atom 校验走动态 import（facade↔atoms 模块环，与同文件其余入口同法）。 */
async function buildSpec(kind: string, payload: unknown): Promise<import("../state/boardCore.js").WidgetSpec | null> {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (kind === "text") {
    const text = String(p.text ?? "");
    if (!text) return null;
    return { kind: "text", text, variant: p.variant === "title" ? "title" : "label" };
  }
  if (kind === "atom-link") {
    /* ref 格式 = "kind|key"（favorites.atomRefFromKey 的存储格式），解析后必须能在注册表查到 */
    const ref = String(p.ref ?? "");
    const a = atomRefFromKey(ref);
    if (!a) return null;
    const { resolveAtom } = await import("../state/atoms.js");
    if (!resolveAtom(a)) return null;
    return { kind: "atom-link", ref };
  }
  if (kind === "custom") {
    const id = String(p.id ?? "");
    if (!id) return null;
    return { kind: "custom", id };
  }
  return null;
}

export function buildApi(pluginId: string, perms: Set<string>): OnethuApi {
  const storageNs = {
    get<T = string>(key: string): T | null {
      gate(perms, "storage", "storage.get");
      const raw = localStorage.getItem(pluginStorageKey(pluginId, key));
      return raw == null ? null : (JSON.parse(raw) as T);
    },
    set<T = string>(key: string, value: T): void {
      gate(perms, "storage", "storage.set");
      localStorage.setItem(pluginStorageKey(pluginId, key), JSON.stringify(value));
    },
    keys(): string[] {
      gate(perms, "storage", "storage.keys");
      const prefix = `onethu.plugin.${pluginId}.`;
      return Object.keys(localStorage).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
    },
    remove(key: string): void {
      gate(perms, "storage", "storage.remove");
      localStorage.removeItem(pluginStorageKey(pluginId, key));
    },
  };

  /** 日程（云同步日历 + 本地手动）：OH 与插件的统一日程入口 */
  const calNs = {
    agenda(startYmd?: string, endYmd?: string): Promise<Array<Record<string, unknown>>> {
      gate(perms, "cal:read", "cal.agenda");
      return (async () => {
        // 缓存陈旧（>10 分钟或从未同步）且已配置：先静默刷一遍再答
        if (getCloudCalConfig() && msSinceSync() > 10 * 60_000) {
          await syncCloudCal().catch(() => undefined);
        }
        const parse = (ymdStr: string, endOfDay = false): number => {
          const d = new Date(Number(ymdStr.slice(0, 4)), Number(ymdStr.slice(5, 7)) - 1, Number(ymdStr.slice(8, 10)));
          return endOfDay ? d.getTime() + 86_399_999 : d.getTime();
        };
        const today = new Date();
        const padN = (n: number): string => String(n).padStart(2, "0");
        const fmtD = (d: Date): string => `${d.getFullYear()}-${padN(d.getMonth() + 1)}-${padN(d.getDate())}`;
        const from = parse(startYmd && /^\d{4}-\d{2}-\d{2}$/.test(startYmd) ? startYmd : fmtD(today));
        const endBase = endYmd && /^\d{4}-\d{2}-\d{2}$/.test(endYmd) ? endYmd : fmtD(new Date(today.getTime() + 14 * 86_400_000));
        const to = parse(endBase, true);
        const rows: Array<Record<string, unknown>> = [];
        for (const [evts, source] of [[getCloudEvents(), "cloud"], [getLocalEvents(), "local"]] as const) {
          for (const o of caldav.expandEventSet(evts, from, to)) {
            const wall = (ms: number) => caldav.epochToWall("Asia/Shanghai", ms);
            const hm = (ms: number): string => {
              const w = wall(ms);
              return `${String(w.h).padStart(2, "0")}:${String(w.mi).padStart(2, "0")}`;
            };
            const w = wall(o.start);
            rows.push({
              uid: o.uid, title: o.summary,
              date: `${w.y}-${String(w.mo).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`,
              start: o.allDay ? "全天" : hm(o.start),
              end: o.allDay ? "全天" : hm(o.end),
              allDay: !!o.allDay, location: o.location, note: o.description, source,
            });
          }
        }
        // 作业 DDL 实时并入（learn + exthw 外部源统一 Homework）：纯内存只读，
        // 绝不上云（用户拍板 2026-09-19：作业像课表一样没必要上云）。窗口内
        // 未交作业 → DDL 当刻 15 分钟事件，来源标 hw/hw-ext，OH 可答「还有什么没交」。
        const snap = getLearnSnapshot();
        const courseName = new Map((snap?.courses ?? []).map((c) => [c.id, c.name]));
        const hwAll = [
          ...(snap?.homework ?? []),
          ...getExtHwSnapshot().items.map(toHomework),
        ];
        for (const h of hwAll) {
          if (h.submitted) continue;
          const dl = parseLearnTime(h.deadline)?.getTime();
          if (!dl || dl < from || dl > to) continue;
          const startHm = h.deadline.slice(11, 16) || "23:59";
          rows.push({
            uid: `hw:${h.id}`, title: `作业截止 · ${h.courseName || courseName.get(h.courseId) || ""} ${h.title}`.trim(),
            date: h.deadline.slice(0, 10), start: startHm,
            end: startHm, allDay: false, location: "",
            note: h.source?.startsWith("ext:") ? "外部平台作业 DDL" : "网络学堂作业 DDL",
            source: h.source?.startsWith("ext:") ? "hw-ext" : "hw",
          });
        }
        return rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.start).localeCompare(String(b.start)));
      })();
    },
    add(title: string, dateYmd: string, startHm: string, endHm: string, opts?: {
      location?: string; note?: string; allDay?: boolean; local?: boolean;
    }): Promise<{ uid: string; where: "cloud" | "local" }> {
      gate(perms, "cal:write", "cal.add");
      return (async () => {
        if (!title?.trim()) throw new Error("标题不能为空");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd ?? "")) throw new Error("dateYmd 需要 YYYY-MM-DD");
        const d = new Date(Number(dateYmd.slice(0, 4)), Number(dateYmd.slice(5, 7)) - 1, Number(dateYmd.slice(8, 10)));
        const [sh, sm] = (startHm ?? "08:00").split(":").map(Number);
        const [eh, em] = (endHm ?? "09:35").split(":").map(Number);
        const allDay = !!opts?.allDay;
        const start = allDay ? d.getTime() : new Date(d.getFullYear(), d.getMonth(), d.getDate(), sh || 0, sm || 0).getTime();
        let end = allDay ? d.getTime() + 86_400_000 : new Date(d.getFullYear(), d.getMonth(), d.getDate(), eh || 23, em || 59).getTime();
        if (!allDay && end <= start) end = start + 45 * 60_000;
        const uid = `onethu-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@onethu`;
        const ev: caldav.IcsEvent = {
          uid, summary: title.trim(), start, end, allDay,
          location: opts?.location?.trim() || undefined,
          description: opts?.note?.trim() || undefined,
          onethuSource: "manual",
        };
        const toLocal = opts?.local === true || !getCloudCalConfig();
        if (toLocal) await putLocalEvent(ev);
        else await putCloudEvent(ev);
        return { uid, where: toLocal ? "local" : "cloud" };
      })();
    },
    remove(uid: string): Promise<{ removed: true }> {
      gate(perms, "cal:write", "cal.remove");
      return (async () => {
        if (getCloudEvents().some((e) => e.uid === uid)) await deleteCloudEvent(uid);
        else if (getLocalEvents().some((e) => e.uid === uid)) await deleteLocalEvent(uid);
        else throw new Error(`日程不存在：${uid}`);
        return { removed: true as const };
      })();
    },
    edit(uid: string, ch: {
      title?: string; date?: string; start?: string; end?: string;
      location?: string; note?: string; allDay?: boolean; toCloud?: boolean;
    }): Promise<{ uid: string; where: "cloud" | "local" }> {
      gate(perms, "cal:write", "cal.edit");
      return (async () => {
        const cloudEv = getCloudEvents().find((e) => e.uid === uid);
        const src = cloudEv ?? getLocalEvents().find((e) => e.uid === uid);
        if (!src) throw new Error(`日程不存在：${uid}（先用 cal.agenda 拿最近日程的 uid）`);
        const originalCloud = !!cloudEv;
        const allDay = ch.allDay ?? src.allDay;
        // 日期：ch.date（YYYY-MM-DD）否则沿用原事件日期
        const p2 = (x: number): string => String(x).padStart(2, "0");
        const ymd = ch.date && /^\d{4}-\d{2}-\d{2}$/.test(ch.date)
          ? ch.date
          : (() => { const w = caldav.epochToWall("Asia/Shanghai", src.start); return `${w.y}-${p2(w.mo)}-${p2(w.d)}`; })();
        const d = new Date(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
        let start: number;
        let end: number;
        if (allDay) {
          start = d.getTime();
          end = start + 86_400_000;
        } else {
          // 时间：ch.start/ch.end（HH:MM）否则沿用原时刻（原为全天则 08:00/09:35）
          const hm = (v: string | undefined, fb: [number, number]): [number, number] => {
            const m = /^(\d{1,2}):(\d{1,2})$/.exec((v ?? "").trim());
            return m ? [Number(m[1]), Number(m[2])] : fb;
          };
          const ow = caldav.epochToWall("Asia/Shanghai", src.start);
          const ew = caldav.epochToWall("Asia/Shanghai", src.end);
          const [sh, sm] = hm(ch.start, src.allDay ? [8, 0] : [ow.h, ow.mi]);
          const [eh, em] = hm(ch.end, src.allDay ? [9, 35] : [ew.h, ew.mi]);
          start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), sh, sm).getTime();
          end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), eh, em).getTime();
          if (end <= start) end = start + 45 * 60_000;
        }
        const ev: caldav.IcsEvent = {
          ...src,
          summary: (ch.title ?? src.summary).trim() || src.summary,
          start, end, allDay,
          location: ch.location !== undefined ? (ch.location.trim() || undefined) : src.location,
          description: ch.note !== undefined ? (ch.note.trim() || undefined) : src.description,
        };
        // 云↔本地迁移（同 UI 编辑器语义）：先删原侧再写新侧；toCloud 缺省=保持原侧
        const toCloud = ch.toCloud ?? originalCloud;
        if (originalCloud && !toCloud) await deleteCloudEvent(uid);
        if (!originalCloud && toCloud) await deleteLocalEvent(uid);
        if (toCloud) await putCloudEvent(ev);
        else await putLocalEvent(ev);
        return { uid, where: toCloud ? "cloud" : "local" };
      })();
    },
  };

  const mailRead = wrap({
    list: async (folder: string, limit: number) => {
      const heads = await refreshMail(folder);
      const cap = Math.min(Math.max(limit, 1), 50);
      return { total: mailFolderTotal(folder), mails: heads.slice(0, cap) };
    },
    read: async (folder: string, uid: number) => readMail(folder, uid),
    search: async (folder: string, query: string) => mailSearch(folder, query),
  }, perms, "mail:read");
  const cloudToken = async (): Promise<string> => {
    await ensureSeafileLoaded();
    const t = getSeafileToken();
    if (!t) throw new Error("云盘未配置：请先在应用的「云盘」页连接（Seafile API Token）");
    return t;
  };
  const cloudRead = wrap({
    repos: async () => invoke("seafile_repos", { token: await cloudToken() }) as Promise<Array<{ id: string; name: string; mtime: number; size: number }>>,
    list: async (repoId: string, path: string) => invoke("seafile_dir", { token: await cloudToken(), repoId, path }) as Promise<Array<{ name: string; kind: "dir" | "file"; size: number; mtime: number }>>,
    search: async (repoId: string, query: string) => invoke("seafile_search", { token: await cloudToken(), repoId, query }) as Promise<Array<{ name: string; kind: "dir" | "file"; size: number; mtime: number }>>,
    download: async (repoId: string, path: string) => invoke("seafile_download", { token: await cloudToken(), repoId, path }) as Promise<string>,
  }, perms, "cloud:read");
  const cloudWrite = wrap({
    upload: async (repoId: string, parentDir: string, localPath: string, replace: boolean) => invoke("seafile_upload", { token: await cloudToken(), repoId, parentDir, localPath, replace }) as Promise<{ size: number }>,
    share: async (repoId: string, path: string, expireDays: number) => invoke("seafile_share", { token: await cloudToken(), repoId, path, expireDays, password: "" }) as Promise<{ link: string; token: string }>,
  }, perms, "cloud:write");

  // 记忆（OH-Memory 镜像引擎；写操作的两段式确认由 harness 工具层负责，facade 只做权限闸）
  const memoryReadNs = wrap({
    search: async (q: Record<string, unknown>) => memorySearch(q as never),
    read: async (permalink: string) => memoryRead(permalink),
    list: async (opts: Record<string, unknown>) => memoryList((opts ?? {}) as never),
    refresh: async () => memoryRefresh(),
    ready: async () => memoryReady(),
  }, perms, "memory:read");
  const memoryWriteNs = wrap({
    write: async (input: Record<string, unknown>) => memoryWrite(input as never),
    append: async (permalink: string, category: string, text: string, context?: string) => {
      await memoryAppend(permalink, category, text, context);
      return { ok: true as const };
    },
    edit: async (permalink: string, find: string, replace: string) => {
      await memoryEdit(permalink, find, replace);
      return { ok: true as const };
    },
    delete: async (permalink: string, reason?: string) => memoryDelete(permalink, reason),
  }, perms, "memory:write");

  const mailWrite = wrap({
    send: async (to: string, cc: string, subject: string, body: string) => {
      await sendMail(to, cc, subject, body);
      return { sent: true as const };
    },
  }, perms, "mail:write");

  /** GitLab：读方法用页号（每页 50 条），写方法在应用内页面之外也能调，
   *  安装时需向用户说明——写操作直接改远端仓库状态。 */
  const gitlabRead = wrap({
    projects: async (page = 1) => (await import("../state/gitlab.js")).gitlabProjectsPage(page),
    starred: async (page = 1) => (await import("../state/gitlab.js")).gitlabStarredPage(page),
    search: async (search: string, page = 1) => (await import("../state/gitlab.js")).gitlabSearchPage(String(search ?? ""), page),
    project: async (id: number) => (await import("../state/gitlab.js")).gitlabProject(Number(id)),
    branches: async (id: number) => (await import("../state/gitlab.js")).gitlabBranches(Number(id)),
    tree: async (id: number, path: string, ref: string, page = 1) =>
      (await import("../state/gitlab.js")).gitlabTreePage(Number(id), String(path ?? ""), String(ref ?? ""), page),
    file: async (id: number, sha: string) => (await import("../state/gitlab.js")).gitlabFile(Number(id), String(sha ?? "")),
    issues: async (id: number, opts?: { state?: GitlabIssueState; search?: string; page?: number }) =>
      (await import("../state/gitlab.js")).gitlabIssuesPage(Number(id), opts?.state ?? "opened", String(opts?.search ?? ""), opts?.page ?? 1),
    issue: async (id: number, iid: number) => (await import("../state/gitlab.js")).gitlabIssue(Number(id), Number(iid)),
    issueNotes: async (id: number, iid: number) => (await import("../state/gitlab.js")).gitlabIssueNotes(Number(id), Number(iid)),
    mergeRequests: async (id: number, opts?: { state?: GitlabIssueState; search?: string; page?: number }) =>
      (await import("../state/gitlab.js")).gitlabMergeRequestsPage(Number(id), opts?.state ?? "opened", String(opts?.search ?? ""), opts?.page ?? 1),
    mergeRequest: async (id: number, iid: number) => (await import("../state/gitlab.js")).gitlabMergeRequest(Number(id), Number(iid)),
    mergeRequestNotes: async (id: number, iid: number) => (await import("../state/gitlab.js")).gitlabMergeRequestNotes(Number(id), Number(iid)),
    pipelines: async (id: number, opts?: { ref?: string; page?: number }) =>
      (await import("../state/gitlab.js")).gitlabPipelinesPage(Number(id), String(opts?.ref ?? ""), opts?.page ?? 1),
    jobs: async (id: number, pipelineId: number) => (await import("../state/gitlab.js")).gitlabPipelineJobs(Number(id), Number(pipelineId)),
    jobTrace: async (id: number, jobId: number) => (await import("../state/gitlab.js")).gitlabJobTrace(Number(id), Number(jobId)),
    discussions: async (kind: "issue" | "mr", id: number, iid: number, page = 1) =>
      (await import("../state/gitlab.js")).gitlabDiscussions(kind === "mr" ? "mr" : "issue", Number(id), Number(iid), Math.max(1, page)),
    awards: async (kind: "issue" | "mr", id: number, iid: number, noteId?: number) =>
      (await import("../state/gitlab.js")).gitlabAwards(kind === "mr" ? "mr" : "issue", Number(id), Number(iid), noteId === undefined ? undefined : Number(noteId)),
    mergeRequestChanges: async (id: number, iid: number) =>
      (await import("../state/gitlab.js")).gitlabMergeRequestChanges(Number(id), Number(iid)),
    requestCounts: async (kind: "issue" | "mr", id: number) =>
      (await import("../state/gitlab.js")).gitlabRequestCounts(kind === "mr" ? "mr" : "issue", Number(id)),
  }, perms, "gitlab:read");
  const gitlabWrite = wrap({
    createIssue: async (id: number, title: string, description: string) =>
      (await import("../state/gitlab.js")).gitlabCreateIssue(Number(id), String(title ?? ""), String(description ?? "")),
    comment: async (kind: "issue" | "mr", id: number, iid: number, body: string) =>
      (await import("../state/gitlab.js")).gitlabAddNote(kind === "mr" ? "mr" : "issue", Number(id), Number(iid), String(body ?? "")),
    updateComment: async (kind: "issue" | "mr", id: number, iid: number, noteId: number, body: string) =>
      (await import("../state/gitlab.js")).gitlabUpdateNote(kind === "mr" ? "mr" : "issue", Number(id), Number(iid), Number(noteId), String(body ?? "")),
    reply: async (kind: "issue" | "mr", id: number, iid: number, discussionId: string, body: string) =>
      (await import("../state/gitlab.js")).gitlabReply(kind === "mr" ? "mr" : "issue", Number(id), Number(iid), String(discussionId ?? ""), String(body ?? "")),
    deleteComment: async (kind: "issue" | "mr", id: number, iid: number, discussionId: string, noteId: number) => {
      await (await import("../state/gitlab.js")).gitlabDeleteNote(kind === "mr" ? "mr" : "issue", Number(id), Number(iid), String(discussionId ?? ""), Number(noteId));
    },
    resolveDiscussion: async (kind: "issue" | "mr", id: number, iid: number, discussionId: string, resolved: boolean) => {
      await (await import("../state/gitlab.js")).gitlabResolveDiscussion(kind === "mr" ? "mr" : "issue", Number(id), Number(iid), String(discussionId ?? ""), resolved !== false);
    },
    assignees: async (kind: "issue" | "mr", id: number, iid: number, userIds: number[]) => {
      const ids = (Array.isArray(userIds) ? userIds : []).map((n) => Number(n)).filter((n) => Number.isFinite(n));
      await (await import("../state/gitlab.js")).gitlabAssign(kind === "mr" ? "mr" : "issue", Number(id), Number(iid), ids);
    },
    react: async (kind: "issue" | "mr", id: number, iid: number, name: string, noteId?: number) =>
      (await import("../state/gitlab.js")).gitlabAddAward(kind === "mr" ? "mr" : "issue", Number(id), Number(iid), String(name ?? ""), noteId === undefined ? undefined : Number(noteId)),
    unreact: async (kind: "issue" | "mr", id: number, iid: number, awardId: number, noteId?: number) => {
      await (await import("../state/gitlab.js")).gitlabRemoveAward(kind === "mr" ? "mr" : "issue", Number(id), Number(iid), Number(awardId), noteId === undefined ? undefined : Number(noteId));
    },
    createMergeRequest: async (id: number, sourceBranch: string, targetBranch: string, title: string, description: string) =>
      (await import("../state/gitlab.js")).gitlabCreateMergeRequest(Number(id), String(sourceBranch ?? ""), String(targetBranch ?? ""), String(title ?? ""), String(description ?? "")),
    mergeMergeRequest: async (id: number, iid: number) =>
      (await import("../state/gitlab.js")).gitlabMerge(Number(id), Number(iid)),
    setState: async (kind: "issue" | "mr", id: number, iid: number, state: "close" | "reopen") => {
      await (await import("../state/gitlab.js")).gitlabSetState(kind === "mr" ? "mr" : "issue", Number(id), Number(iid), state === "reopen" ? "reopen" : "close");
    },
  }, perms, "gitlab:write");

  const api: OnethuApi = {
    cal: calNs as unknown as OnethuApi["cal"],
    mail: { ...mailRead, ...mailWrite } as OnethuApi["mail"],
    cloud: { ...cloudRead, ...cloudWrite } as OnethuApi["cloud"],
    memory: { ...memoryReadNs, ...memoryWriteNs } as OnethuApi["memory"],
    /** 临时来访人员报备（visit.tsinghua.edu.cn 的「亲友来访报备」）。
   *  OH 只做**填草稿 + 打开**：提交是真实政务动作，永远由用户在页面上勾选确认后自己点。
   *  WHY 不在这里直接提交：报备内容的真实性由申请人负责（学校须知原文），代提交会让人误以为
   *  「系统替他背书」。与 venue.jump「预约在官方页面完成」同一条边界。 */
  visit: {
    /** 默认只填草稿 + 打开页面；submit: true = 用户已授权自动报备（页面填完直接提交）。 */
    fill: (patch_: unknown, opts?: { open?: boolean; submit?: boolean }): { ok: boolean; opened: boolean; submit: boolean; filled: string[] } => {
      gate(perms, "nav", "visit.fill");
      const p = (patch_ ?? {}) as Record<string, unknown>;
      requestVisitDraft(p as never, { submit: opts?.submit === true });
      const opened = opts?.open === false ? false : navGo("reserve", { reserveTab: "visit" });
      return { ok: true, opened, submit: opts?.submit === true, filled: Object.keys(p) };
    },
  },
  gitlab: { ...gitlabRead, ...gitlabWrite } as unknown as OnethuApi["gitlab"],
    session: {
      status: () => {
        gate(perms, "user:read", "session.status");
        return sessionStatus();
      },
      username: () => {
        gate(perms, "user:read", "session.username");
        return appSession.username || null;
      },
    },
    user: wrap({
      info: () => info.getUserInfo(),
    }, perms, "user:read") as OnethuApi["user"],
    info: wrap({
      schedule: (s: string, e: string) => info.getSchedule(s, e),
      report: () => info.getReport(),
      exams: () => info.getExams(),
      deadlines: () => info.getDeadlines(),
      news: (page = 1) => info.getNews(page),
      newsDetail: (xxid: string) => info.getNewsDetail(xxid),
      newsSub: (page = 1, subscriptionId?: string) => info.getNewsListBySubscription(page, subscriptionId),
      searchNews: (kw: string, page = 1) => info.searchNews(kw, page),
      schoolCalendar: () => info.getSchoolCalendar(),
      classroomList: () => info.getClassroomList(),
      classroomState: (b: string, w: number) => info.getClassroomState(b, w),
      invoices: (page: number) => info.getInvoiceList(page),
      bankPayments: () => info.getBankPayment(),
      graduateIncome: (b: string, e: string) => info.getGraduateIncome(b, e),
      dormScore: () => info.getDormScore(),
      physicalExam: () => info.getPhysicalExamResult(),
      assessmentList: () => info.getAssessmentList(),
    }, perms, "info:read") as OnethuApi["info"],
    learn: wrap({
      semesters: () => learn.getSemesterIdList(),
      courses: async (semesterId?: string) => {
        const sem = semesterId || (await learn.getCurrentSemester()).id;
        return { semester: sem, courses: await learn.getCourseList(sem) };
      },
      homework: async (semesterId?: string) => {
        const sem = semesterId || (await learn.getCurrentSemester()).id;
        const courses = await learn.getCourseList(sem);
        const hw = await learn.getAllHomework(courses.map((c) => c.id));
        const nameOf = new Map(courses.map((c) => [c.id, c.name]));
        return hw.map((h) => ({ ...h, courseName: nameOf.get(h.courseId) ?? "" }));
      },
      notifications: async (semesterId?: string) => {
        const sem = semesterId || (await learn.getCurrentSemester()).id;
        const courses = await learn.getCourseList(sem);
        const list = await learn.getAllNotifications(courses.map((c) => c.id));
        const nameOf = new Map(courses.map((c) => [c.id, c.name]));
        return list.map((n) => ({ ...n, courseName: nameOf.get(n.courseId) ?? "" }));
      },
      files: async (courseId: string, semesterId?: string) => {
        if (semesterId) {
          const courses = await learn.getCourseList(semesterId);
          if (!courses.some((c) => c.id === courseId)) {
            throw new Error(`课程 ${courseId} 不在学期 ${semesterId} 的课程列表中（跨学期请确认 semesterId）`);
          }
        }
        return learn.getFileList(courseId);
      },
      /** 下载课件/附件到下载目录（Files Hub 源①：字节不过 JS，带会话 Cookie 直连） */
      download: async (fileId: string, filename?: string) => {
        const { downloadLearnFile } = await import("../lib/clients.js");
        const name = filename?.trim() || `learn-${fileId}`;
        return downloadLearnFile(fileId, name);
      },
      reply: (wlkcid: string, threadId: string, content: string) => {
        gate(perms, "learn:write", "learn.reply");
        return learn.postBbsReply(wlkcid, threadId, content);
      },
      post: (wlkcid: string, bqid: string, title: string, html: string) => {
        gate(perms, "learn:write", "learn.post");
        return learn.postBbsThread(wlkcid, { bqid, title, html });
      },
      bbsBoards: (wlkcid: string) => learn.getBbsBoards(wlkcid),
      bbsThreads: (wlkcid: string, opts?: { bqid?: string; kind?: "yb" | "jh" | "cy"; start?: number; length?: number }) =>
        learn.getBbsThreads(wlkcid, {
          bqid: opts?.bqid ?? "",
          kind: opts?.kind ?? "yb",
          start: opts?.start ?? 0,
          length: opts?.length ?? 30,
        }),
      bbsThread: (wlkcid: string, threadId: string, bqId?: string) => learn.getBbsThread(wlkcid, threadId, bqId),
      bbsPosts: (wlkcid: string, threadId: string, pageNum = 1) => learn.getBbsThreadPosts(wlkcid, threadId, pageNum),
    }, perms, "learn:read") as OnethuApi["learn"],
    venue: {
      scenes: () => { gate(perms, "venue:read", "venue.scenes"); return venue.sceneList(); },
      currentPage: (params: Record<string, unknown>) => { gate(perms, "venue:read", "venue.currentPage"); return venue.currentPage(params as never); },
      myRecords: (page = 1) => { gate(perms, "venue:read", "venue.myRecords"); return venue.myRecords(page, 10); },
      cancel: (resvUuid: string) => { gate(perms, "venue:book", "venue.cancel"); return venue.cancelReserve(resvUuid); },
      jump: (sceneUuid: string) => {
        gate(perms, "venue:read", "venue.jump");
        const url = `https://www.sports.tsinghua.edu.cn/venue/index.html#/reserveList?uuid=${encodeURIComponent(sceneUuid)}`;
        void openExternal(url);
        return url;
      },
    } as OnethuApi["venue"],
    xk: {
      search: async (opts: { kcm?: string; kch?: string; teacher?: string; semester?: string; page?: number }) => {
        gate(perms, "xk:read", "xk.search");
        const { searchXkCourses } = await import("@onethu/core");
        return searchXkCourses(await xkSession(), opts);
      },
      catalog: async (sem?: string) => {
        gate(perms, "xk:read", "xk.catalog");
        const { getXkCatalog } = await import("@onethu/core");
        return getXkCatalog(await xkSession(), sem ? { semester: sem } : {});
      },
      selected: async (sem?: string) => {
        gate(perms, "xk:read", "xk.selected");
        const { getSelectedCourses } = await import("@onethu/core");
        return getSelectedCourses(await xkSession(), sem ? { semester: sem } : {});
      },
      detail: async (teacherId: string, code: string) => {
        gate(perms, "xk:read", "xk.detail");
        const { getXkCourseDetail } = await import("@onethu/core");
        return getXkCourseDetail(await xkSession(), { teacherId, code });
      },
      reviews: async (course: string, teacher?: string) => {
        gate(perms, "xk:read", "xk.reviews");
        const xkr = await import("../lib/xkreviews.js");
        await xkr.tbEnsureIndex();
        const entry = xkr.tbMatch(course, teacher ?? "");
        if (!entry) return null;
        return { course: entry.kcm, teacher: entry.jsm, count: entry.count, avg: entry.avg, reviews: await xkr.tbFetchReviews(entry.sqid) };
      },
    } as OnethuApi["xk"],
    coursex: wrap({
      semesters: async () => {
        const { getCourseXSemesters } = await import("@onethu/core");
        return withExternalTimeout(getCourseXSemesters(universalFetch));
      },
      search: async (q: string, semester?: string) => {
        const { searchCourseXPublic } = await import("@onethu/core");
        return withExternalTimeout(searchCourseXPublic(universalFetch, q, semester));
      },
      detail: async (id: string) => {
        const { getCourseXDetailPublic } = await import("@onethu/core");
        try {
          const d = await withExternalTimeout(getCourseXDetailPublic(universalFetch, id));
          if (!d) return { id, error: "详情页无可解析卡片（页面结构变更?）" };
          return d;
        } catch (e) {
          return { id, error: explainNetworkError(e) };
        }
      },
    }, perms, "info:read") as OnethuApi["coursex"],
    card: wrap({
      info: () => info.getCardInfo(),
      transactions: (s: string, e: string) => info.getCardTransactions(s, e),
    }, perms, "card:read") as OnethuApi["card"],
    dorm: wrap({
      eleRemainder: () => info.getEleRemainder(),
      elePayRecord: () => info.getElePayRecord(),
    }, perms, "dorm:read") as OnethuApi["dorm"],
    kongjian: {
      page: (opts: { spaceId?: string; roomId?: string; date?: string } = {}) => {
        gate(perms, "dorm:read", "kongjian.page");
        return info.kongjianPage(opts);
      },
      my: () => { gate(perms, "dorm:read", "kongjian.my"); return info.kongjianMy(); },
      book: (bookUrl: string, info_: { name: string; sid: string; tel: string; other: string }) => {
        gate(perms, "kongjian:book", "kongjian.book");
        return info.kongjianBook(bookUrl, info_);
      },
      cancel: (target: string) => { gate(perms, "kongjian:book", "kongjian.cancel"); return info.kongjianCancel(target); },
    } as OnethuApi["kongjian"],
    library: wrap({
      list: () => info.getLibraryList(),
      floors: async (libraryId: number, dateChoice: 0 | 1 = 0) => {
        const lib = { id: libraryId, zhName: "", idPath: "", zhNameTrace: "", guanmingyuan: "", comments: "" } as any;
        try {
          return await info.getLibraryFloorList(lib, dateChoice);
        } catch (e) {
          // R10：座位系统回「停用区域」空壳（childArea:null）= 会话陈旧——强制重建漫游链再试一次
          await info.forceEnsure("library").catch(() => undefined);
          return await info.getLibraryFloorList(lib, dateChoice);
        }
      },
      sections: (floor: { id: number; zhNameTrace: string }, dateChoice: 0 | 1 = 0) =>
        info.getLibrarySectionList(floor, dateChoice),
      seats: (section: { id: number; zhNameTrace: string }, dateChoice: 0 | 1 = 0) =>
        info.getLibrarySeatList(section, dateChoice),
      records: async () => {
        try {
          return await info.getLibBookRecords();
        } catch (e) {
          await info.forceEnsure("library").catch(() => undefined);
          return await info.getLibBookRecords();
        }
      },
      book: async (seat: { id: number; type?: string }, sectionId: number, dateChoice: 0 | 1 = 0) => {
        try {
          return await info.bookLibrarySeat(seat, sectionId, dateChoice, appSession.username);
        } catch (e) {
          // R10：「没有登录或登录已超时」= token/会话陈旧；此错意味着首次必然未订上，重试安全
          const msg = e instanceof Error ? e.message : String(e);
          if (!/登录|超时|会话/.test(msg)) throw e;
          let ensured = "forceEnsure ok";
          try {
            await info.forceEnsure("library");
          } catch (ie) {
            ensured = `forceEnsure 失败: ${ie instanceof Error ? ie.message : String(ie)}`;
          }
          try {
            return await info.bookLibrarySeat(seat, sectionId, dateChoice, appSession.username);
          } catch (e2) {
            const m2 = e2 instanceof Error ? e2.message : String(e2);
            throw new Error(`${m2}（重试前会话重建: ${ensured}；座位系统 uid=${InfoClient.libUserid || "?"}）`);
          }
        }
      },
      cancel: async (recordId: string) => {
        try {
          return await info.cancelLibBooking(recordId, appSession.username);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!/登录|超时|会话/.test(msg)) throw e;
          await info.forceEnsure("library").catch(() => undefined);
          return await info.cancelLibBooking(recordId, appSession.username);
        }
      },
    }, perms, "library:read") as OnethuApi["library"],
    libroom: wrap({
      list: () => info.getLibRoomInfoList(appSession.username),
      resources: (date: string, kindId: number) => info.getLibRoomResourceList(appSession.username, date, kindId),
      records: () => info.getLibRoomRecords(appSession.username),
      book: (roomRes: any, start: string, end: string, memberAccNos: number[] = []) =>
        info.bookLibRoom(appSession.username, roomRes, start, end, memberAccNos),
      cancel: (uuid: string) => info.cancelLibRoomBooking(appSession.username, uuid),
      fuzzyMember: (kw: string) => info.fuzzySearchLibRoomMember(appSession.username, kw),
    }, perms, "library:read") as OnethuApi["libroom"],
    network: wrap({
      balance: () => nethGuard(() => info.getNetworkBalance()),
      devices: () => nethGuard(() => info.getOnlineDevices()),
      deviceCount: () => nethGuard(() => info.getNetworkDeviceCount()),
      accountInfo: () => nethGuard(() => info.getNetworkAccountInfo()),
    }, perms, "network:read") as OnethuApi["network"],
    nav: {
      go: (page: string, params?: Record<string, unknown>) => {
        gate(perms, "nav", "nav.go");
        /* 旧文档/提示词里的 "today" 是 homepage 的别名（app.tsx 早就没有 today 页了）。
           不映射会在非首页标签里 navigateInTab("today") → 渲染兜底成 LearnPage。 */
        const pageId = String(page ?? "") === "today" ? "homepage" : page;
        const want = params ?? {};
        /* 白板带参（2026-10-15 OH 接线）：`board` + {boardId} → **先把那块板设成当前板**再开白板页。
           白板页渲染的是「当前板」（BoardDoc.activeBoardId），所以只传 params 不切板 —— 以前 OH
           说「打开 XX 白板」实际打开的还是上一块。这里与 `#/board/<板 id>` 深链（explorer 的
           openBoardFromHash）和 ext.onePageOpen 走同一条链：setActiveBoard + openTab。 */
        const bid = String(pageId ?? "") === "board" ? String(want.boardId ?? want.id ?? "") : "";
        if (bid) {
          const hit = allOnePages().find((b) => b.id === bid);
          if (!hit) throw new Error(`没有这块白板：${bid}（先用 ext.onepage_list 拿板 id；列表页用 page=\"boards\"）`);
          openOnePage(bid);
          openTab("board", null, { title: hit.name });
          return true;
        }
        if (!navGo(pageId, want)) throw new Error("导航桥未就绪（应用启动中）");
        return true;
      },
      /** 原子检索：静态注册表（功能页/今日组件/操作）+ 本机缓存（课程/作业/通知/在线服务…）。
       *  动态 import 与 normalizeBinding 同法，回避 facade↔atoms 的模块环。 */
      searchAtoms: async (query: string, limit?: number) => {
        gate(perms, "nav", "nav.searchAtoms");
        const { searchAtoms } = await import("../state/atoms.js");
        const n = Number.isFinite(limit) ? Math.max(1, Math.min(50, Number(limit))) : 12;
        return searchAtoms(String(query ?? ""), n).map((h) => ({ kind: h.kind, key: h.key, title: h.title, sub: h.sub, group: h.group }));
      },
      /** 使用统计：只读本机 localStorage 的点击记录（不含校园数据），用于「用户常用什么」 */
      usage: async (limit?: number) => {
        gate(perms, "nav", "nav.usage");
        const { usageStats, topAtomUses, recentAtomUses } = await import("../lib/usage.js");
        const n = Number.isFinite(limit) ? Math.max(1, Math.min(50, Number(limit))) : 10;
        const s = usageStats();
        return {
          total: s.total,
          kinds: s.kinds,
          top: topAtomUses(n).map((e) => ({
            kind: e.kind, key: e.key, title: e.title ?? e.key, group: e.group ?? "", n: e.n, last: e.last,
          })),
          recent: recentAtomUses(n).map((e) => ({
            kind: e.kind, key: e.key, title: e.title ?? e.key, n: e.n, last: e.last,
          })),
        };
      },
      clearUsage: async () => {
        gate(perms, "nav", "nav.clearUsage");
        const { clearUsage } = await import("../lib/usage.js");
        clearUsage();
      },
      /** 检索行级直达（OH 的 ui_navigate 用）：与检索条点行**同一条链路**（goSearchRow）。
       *  查无/多义 → ok:false + reason + candidates，让 OH 自己改口，不硬猜。需 nav 权限 */
      searchRow: async (ref: { routeId?: string; query?: string }) => {
        gate(perms, "nav", "nav.searchRow");
        const { allSearchRows, matchSearchRows, goSearchRow, ohRouteTable } = await import("../state/searchRows.js");
        const rows = allSearchRows();
        const arg = ref ?? {};
        /* routeId 精确直配；query 走与检索条同源的打分（首位=自己才算命中） */
        if (arg.routeId) {
          const row = rows.find((r) => r.id === arg.routeId);
          if (!row) {
            const near = ohRouteTable().filter((e) => e.id.includes(String(arg.routeId).toLowerCase())).slice(0, 5)
              .map((e) => ({ id: e.id, title: e.title }));
            return { ok: false, reason: `没有 id 为「${arg.routeId}」的检索行`, candidates: near };
          }
          const res = goSearchRow(row);
          return { ok: true, id: row.id, title: row.title, breadcrumb: res.breadcrumb, landedOn: res.landedOn, note: res.note ?? "" };
        }
        const q = String(arg.query ?? "").trim();
        if (!q) return { ok: false, reason: "缺 routeId 或 query：说明要跳的行（如「多模态」「管理主题」）" };
        const hits = matchSearchRows(q, 2);
        if (hits.length === 0) {
          return { ok: false, reason: `没有命中任何检索行：「${q}」。可换行名关键词，或先用 ui_navigate 列候选` };
        }
        const first = hits[0]!;
        const row = first.row;
        const candidates = hits.slice(1).map((h) => ({ id: h.row.id, title: h.row.title }));
        const res = goSearchRow(row);
        return { ok: true, id: row.id, title: row.title, breadcrumb: res.breadcrumb, landedOn: res.landedOn, note: res.note ?? "", candidates };
      },
      /** 路由表投影（有缓存兜底时 Rust 侧离线可用） */
      routeTable: async () => {
        gate(perms, "nav", "nav.routeTable");
        const { ohRouteTable } = await import("../state/searchRows.js");
        return ohRouteTable();
      },
      /** 打开原子：复用收藏夹那套 view.open(nav)，故插件点开的页面与用户自己点收藏完全一致 */
      openAtom: async (ref: { kind: string; key: string }) => {
        gate(perms, "nav", "nav.openAtom");
        const kind = String(ref?.kind ?? "");
        const key = String(ref?.key ?? "");
        if (!kind || !key) return false;
        const { resolveAtom } = await import("../state/atoms.js");
        const view = resolveAtom({ kind, key });
        if (!view) return false;
        /* 以前无条件 true：页面导航桥没就绪/页面 id 不认时 OH 照旧回"已打开"。改成如实返回。 */
        let ok = false;
        view.open((page, params) => { ok = navGo(page, params as Record<string, unknown> | undefined); });
        return ok;
      },
    },
    services: {
      /** 在线服务目录检索：本机原子缓存搜不到时的兜底（会发一次校园请求）。
       *  匹配容忍口语简称，命中判据见 serviceScore；结果顺带写回原子缓存。 */
      search: async (query: string, limit?: number) => {
        gate(perms, "info:read", "services.search");
        const q = normalizeServiceName(String(query ?? ""));
        if (!q) return [];
        const { initInfoLib } = await import("../lib/infoLib.js");
        const helper = initInfoLib();
        await helper.prepareThosSession();
        const page = await helper.getThosServices();
        const items = (page?.items ?? []).filter((s) => s.name);
        const n = Number.isFinite(limit) ? Math.max(1, Math.min(50, Number(limit))) : 10;
        // 目录整份写回本机缓存：之后 OH / 收藏搜索都能离线命中同一批服务
        if (items.length > 0) {
          const { noteAtomCache } = await import("../state/atoms.js");
          noteAtomCache({
            thosServices: items.map((x) => ({ id: x.id, name: x.name, department: x.department, url: x.url })),
          });
        }
        return items
          .map((s) => ({ s, score: serviceScore(s.name, q) }))
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score || a.s.name.length - b.s.name.length)
          .slice(0, n)
          .map(({ s, score }) => ({ id: s.id, name: s.name, department: s.department, url: s.url, score }));
      },
      /** 应用内打开服务官方页：与用户点在线服务那一条完全同一条链路（同一登录态） */
      open: async (service: { id?: string; name?: string; url?: string }) => {
        gate(perms, "info:read", "services.open");
        const url = String(service?.url ?? "");
        if (!/^https?:\/\//.test(url)) return false;
        const { openThosInApp } = await import("../lib/thosOpen.js");
        await openThosInApp(url);
        return true;
      },
    },
    ui: {
      toast: (text: string) => {
        gate(perms, "ui", "ui.toast");
        showToast(text);
      },
      /** 应用内 WebView 模态打开 URL（Android 桌面模式浏览；桌面无此能力抛错，
       *  调用方应 catch 后降级 onethu.nav 外链或系统浏览器）。需 webview 权限。 */
      webModal: async (url: string): Promise<void> => {
        gate(perms, "webview", "ui.webModal");
        if (!/^https:\/\//.test(url)) throw new Error("webModal 仅支持 https:// 链接");
        await invoke("open_web_modal", { url, dark: currentThemeIsDark() });
      },
      /** 应用内确认弹窗（Promise 化）：resolve 用户是否确认。opts.danger 为危险操作样式；
       *  danger 时 `title` / `confirmText` 应由插件按场景提供（宿主只提供通用兜底措辞）。 */
      confirm: async (
        msg: string,
        opts?: { danger?: boolean; title?: string; confirmText?: string },
      ): Promise<boolean> => {
        gate(perms, "ui", "ui.confirm");
        const { confirmOk, confirmDanger } = await import("../lib/confirm.js");
        return opts?.danger
          ? confirmDanger(String(msg ?? ""), {
              title: typeof opts.title === "string" ? opts.title : undefined,
              confirmText: typeof opts.confirmText === "string" ? opts.confirmText : undefined,
            })
          : confirmOk(String(msg ?? ""));
      },
      /** 通用表单弹窗：字段定义见类型 FormField；resolve 键值对象，取消 resolve null。 */
      form: async (title: string, fields: FormField[]): Promise<Record<string, string> | null> => {
        gate(perms, "ui", "ui.form");
        const { openFormModal } = await import("../lib/formModal.js");
        return openFormModal(String(title ?? "请填写"), Array.isArray(fields) ? fields : []);
      },
      /** 剪贴板：写无需确认；read 需 clipboard:read 权限（敏感，可读密码管理器内容）。 */
      clipboard: {
        write: async (text: string): Promise<void> => {
          gate(perms, "ui", "ui.clipboard.write");
          await navigator.clipboard.writeText(String(text ?? ""));
        },
        read: async (): Promise<string> => {
          gate(perms, "clipboard:read", "ui.clipboard.read");
          return navigator.clipboard.readText();
        },
      },
      /** 本插件 tab 的挂载容器（同步；未挂载 null）。pageKey 须以 plugin:<本插件id>: 开头 */
      getTabRoot: (pageKey: string): HTMLElement | null => {
        gate(perms, "ui", "ui.getTabRoot");
        const key = String(pageKey ?? "");
        if (!key.startsWith(`plugin:${pluginId}:`)) throw new Error("getTabRoot 仅限本插件注册的 tab");
        return getTabRoot(key);
      },
      /** 订阅 tab 容器就绪（已就绪立即回调；返回退订函数） */
      onTabReady: (pageKey: string, cb: (root: HTMLElement) => void): (() => void) => {
        gate(perms, "ui", "ui.onTabReady");
        const key = String(pageKey ?? "");
        if (!key.startsWith(`plugin:${pluginId}:`)) throw new Error("onTabReady 仅限本插件注册的 tab");
        if (typeof cb !== "function") return () => undefined;
        return onTabReady(key, cb);
      },
    },
    /** 用户扩展层（OH 自我进化元工具，2026-10-13）：用户工具/OneFlow/用户生成组件。
     *  权限口径：本命名空间要求 ui 权限；步骤内部调用的其他 ns 不再逐 gate——
     *  OH 是受信执行体，用户在对话里对它下达的指令视同用户操作。 */
    ext: {
      toolCreate: (name: string, description: string, steps: unknown): void => {
        gate(perms, "ui", "ext.toolCreate");
        upsertTool({
          id: "ut." + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          name: String(name),
          description: String(description),
          steps: Array.isArray(steps) ? (steps as ExtStep[]) : [],
        });
      },
      toolList: (): Array<{ id: string; name: string; description: string }> =>
        userExtSnapshot().tools.map((t) => ({ id: t.id, name: t.name, description: t.description })),
      toolRun: (id: string): Promise<{ ok: boolean; error?: string }> => runToolSteps(id, execTool),
      toolDelete: (id: string): void => deleteTool(id),
      flowCreate: (name: string, trigger: unknown, steps: unknown): { id: string } => {
        gate(perms, "ui", "ext.flowCreate");
        const trg = trigger as import("../state/userext.js").FlowTrigger;
        if (!trg || (trg.kind !== "manual" && trg.kind !== "cron" && trg.kind !== "event")) {
          throw new Error("trigger 必须是 {kind:manual} / {kind:cron,everyMinutes} / {kind:event,event}");
        }
        const list = Array.isArray(steps) ? (steps as ExtStep[]) : [];
        if (!list.length) throw new Error("OneFlow 至少要有 1 个步骤");
        const id = "fl." + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        upsertFlow({ id, name: String(name), trigger: trg, steps: list });
        return { id };
      },
      flowList: (): Array<{ id: string; name: string; trigger: unknown; enabled: boolean; lastRun?: number; lastOk?: boolean; lastError?: string }> =>
        userExtSnapshot().flows.map((f) => ({ id: f.id, name: f.name, trigger: f.trigger, enabled: f.enabled !== false, lastRun: f.lastRun, lastOk: f.lastOk, lastError: f.lastError })),
      flowRun: (id: string): Promise<{ ok: boolean; error?: string }> => {
        gate(perms, "ui", "ext.flowRun");
        return runFlowSteps(id, execTool);
      },
      flowUpdate: (id: string, patch: { name?: string; trigger?: unknown; steps?: unknown; enabled?: boolean }): { ok: boolean } => {
        gate(perms, "ui", "ext.flowUpdate");
        const p: { name?: string; trigger?: import("../state/userext.js").FlowTrigger; steps?: ExtStep[]; enabled?: boolean } = {};
        if (typeof patch?.name === "string") p.name = patch.name;
        if (patch?.trigger) p.trigger = patch.trigger as import("../state/userext.js").FlowTrigger;
        if (Array.isArray(patch?.steps)) p.steps = patch.steps as ExtStep[];
        if (typeof patch?.enabled === "boolean") p.enabled = patch.enabled;
        const ok = updateFlow(String(id), p);
        if (!ok) throw new Error("没有这个 OneFlow");
        return { ok };
      },
      flowSetEnabled: (id: string, on: boolean): { ok: boolean } => {
        gate(perms, "ui", "ext.flowSetEnabled");
        const ok = setFlowEnabled(String(id), Boolean(on));
        if (!ok) throw new Error("没有这个 OneFlow");
        return { ok };
      },
      flowDelete: (id: string): void => {
        gate(perms, "ui", "ext.flowDelete");
        if (!userExtSnapshot().flows.some((f) => f.id === String(id))) throw new Error("没有这个 OneFlow（id 来自 ext_flow_list）");
        deleteFlow(String(id));
      },
      widgetCreate: (name: string, html: string, x?: number, y?: number): { id: string } => {
        gate(perms, "ui", "ext.widgetCreate");
        const uid = "uw." + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        upsertWidget({ id: uid, name: String(name), html: sanitizeUserHtml(String(html)) });
        addItem({ kind: "custom", id: "usergen:" + uid }, x ?? 60, y ?? 360, 240, 160);
        return { id: uid };
      },
      widgetList: (): Array<{ id: string; name: string; createdAt: number }> =>
        userExtSnapshot().widgets.map((w) => ({ id: w.id, name: w.name, createdAt: w.createdAt })),
      widgetDelete: (id: string): void => {
        gate(perms, "ui", "ext.widgetDelete");
        deleteWidget(String(id));
        const ref = "usergen:" + String(id);
        /* 自由白板上的实例一并清掉 */
        for (const it of freeBoardSnapshot().items) {
          if (it.spec.kind === "custom" && it.spec.id === ref) removeItem(it.id);
        }
        /* 各 OnePage 白板上的实例一并清掉 */
        mutateBoards((doc) => {
          let touched = false;
          const boards = doc.boards.map((b) => {
            const prev = b.cells.portrait ?? [];
            const portrait = prev.filter((it) => !(it.spec.kind === "custom" && it.spec.id === ref));
            if (portrait.length !== prev.length) {
              touched = true;
              return { ...b, cells: { ...b.cells, portrait } };
            }
            return b;
          });
          return touched ? { ...doc, boards } : null;
        });
        notifyBoardsChanged();
      },
      onePageCreate: (name: string, icon?: string): { id: string } => {
        gate(perms, "ui", "ext.onePageCreate");
        const id = createOnePage(String(name), icon ? String(icon) : "star");
        return { id };
      },
      onePageList: (): Array<{ id: string; name: string; kind: string; icon: string }> =>
        allOnePages().map((b) => ({ id: b.id, name: b.name, kind: b.kind, icon: b.icon })),
      onePageAddItem: async (boardId: string, kind: string, payload: unknown, x: number, y: number, w?: number, h?: number): Promise<{ id: string }> => {
        gate(perms, "ui", "ext.onePageAdd");
        const spec = await buildSpec(kind, payload);
        if (!spec) throw new Error("不认识的组件类型或引用无效，可用：text / atom-link / custom");
        const iid = "it." + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        let placed = false;
        mutateBoards((doc) => {
          const boards = doc.boards.map((b) => {
            if (b.id !== String(boardId)) return b;
            placed = true;
            const items = b.cells.portrait ?? [];
            return {
              ...b,
              cells: {
                ...b.cells,
                portrait: [...items, { id: iid, spec, cell: { x: Math.max(0, x | 0), y: Math.max(0, y | 0), w: w ?? 2, h: h ?? 1 } }],
              },
            };
          });
          return placed ? { ...doc, boards } : null;
        });
        if (!placed) throw new Error("找不到这块 OnePage（id 不对或已删除）");
        return { id: iid };
      },
      themeApply: (name: string, vars: unknown): { id: string } => {
        gate(perms, "ui", "ext.themeApply");
        const clean: Record<string, string> = {};
        for (const [k, v] of Object.entries((vars ?? {}) as Record<string, unknown>)) {
          if (k.startsWith("--") && typeof v === "string" && v.length < 128) clean[k] = v;
        }
        const id = "uth." + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        upsertTheme({ id, name: String(name), vars: clean });
        activateUserTheme(id);
        return { id };
      },
      themeList: (): Array<{ id: string; name: string; active: boolean }> =>
        userExtSnapshot().themes.map((t) => ({ id: t.id, name: t.name, active: userExtSnapshot().activeThemeId === t.id })),
      themeActivate: (id: string | null): void => activateUserTheme(id),
      themeDelete: (id: string): void => deleteTheme(id),
      /** 手机桌面小组件自定义内容：rows 为空数组即清除；持久化在 userext，App 前台算好随快照推送 */
      phoneWidgetSet: (title: string, rows: unknown): { ok: boolean; rows: number } => {
        gate(perms, "ui", "ext.phoneWidgetSet");
        const list = Array.isArray(rows) ? (rows as Array<{ text?: unknown; sub?: unknown }>) : [];
        setPhoneWidget(String(title ?? ""), list);
        return { ok: true, rows: userExtSnapshot().phone?.rows.length ?? 0 };
      },
      /* ── OnePage 白板管理（v2 覆盖面） ── */
      onePageDelete: (id: string): { ok: boolean; reason?: string } => {
        gate(perms, "ui", "ext.onePageDelete");
        const reason = removeOnePage(String(id));
        return reason ? { ok: false, reason } : { ok: true };
      },
      onePageRename: (id: string, name: string): void => {
        gate(perms, "ui", "ext.onePageRename");
        if (!String(name ?? "").trim()) throw new Error("需要一个新名字");
        renameOnePage(String(id), String(name));
      },
      /** 换 OnePage 图标（TabStrip/OneGO/列表页都读 Board.icon；图标键来自 FOLDER_ICONS） */
      onePageSetIcon: (id: string, icon: string): { ok: boolean } => {
        gate(perms, "ui", "ext.onePageSetIcon");
        const b = allOnePages().find((x) => x.id === String(id));
        if (!b) throw new Error("没找到这块 OnePage");
        if (!String(icon ?? "").trim()) throw new Error("需要一个图标键");
        mutateBoards((doc) => renameBoard(doc, b.id, b.name, String(icon)));
        return { ok: true };
      },
      onePageOpen: (id: string): void => {
        gate(perms, "ui", "ext.onePageOpen");
        openOnePage(String(id));
        openTab("board", null, { title: allOnePages().find((b) => b.id === String(id))?.name ?? "白板" });
      },
      onePageMoveItem: (boardId: string, itemId: string, x: number, y: number): void => {
        gate(perms, "ui", "ext.onePageMoveItem");
        const nx = Math.max(0, Math.trunc(Number(x) || 0));
        const ny = Math.max(0, Math.trunc(Number(y) || 0));
        let found = false;
        const moved = mutateBoards((doc) => {
          const board = doc.boards.find((b) => b.id === String(boardId));
          if (!board) return null;
          /* 白板渲染以 px rect 为准（rectOf 优先 item.rect，saveBoard 会给无 rect 的条目补 rect）；
             只改 cell 用户看不到任何变化。移动必须 withRect 同一套：cell 派生 + rect 落地。
             两个朝向都有这个条目时一起挪（同一个 x/y 语义）。 */
          const cells: typeof board.cells = { ...board.cells };
          for (const o of ["portrait", "landscape"] as const) {
            const items = cells[o];
            if (!items) continue;
            let hit = false;
            const next = items.map((it) => {
              if (it.id !== String(itemId)) return it;
              hit = true;
              const cell = { ...it.cell, x: nx, y: ny };
              const rect = rectFromCell(cell);
              return { ...it, cell, rect, manual: true, fitted: undefined };
            });
            if (hit) {
              cells[o] = next;
              found = true;
            }
          }
          return found ? { ...doc, boards: doc.boards.map((b) => (b.id === board.id ? { ...b, cells } : b)) } : null;
        });
        if (!moved || !found) throw new Error("没找到这块板或这个组件（id 对照 ext_onepage_list 的板与组件 id）");
      },
      onePageRemoveItem: (boardId: string, itemId: string): void => {
        gate(perms, "ui", "ext.onePageRemoveItem");
        const gone = mutateBoards((doc) => {
          const boards = doc.boards.map((b) => {
            if (b.id !== String(boardId)) return b;
            const prev = b.cells.portrait ?? [];
            const portrait = prev.filter((it) => it.id !== String(itemId));
            if (portrait.length === prev.length) return b;
            return { ...b, cells: { ...b.cells, portrait } };
          });
          return boards === doc.boards ? null : { ...doc, boards };
        });
        if (!gone) throw new Error("没找到这块板或这个组件");
      },
      /** 某块 OnePage 的组件清单（OH 调位/删除前按图索骥） */
      onePageItems: (boardId: string): Array<{ id: string; kind: string; text?: string; x: number; y: number; w: number; h: number }> => {
        gate(perms, "ui", "ext.onePageItems");
        const b = allOnePages().find((x) => x.id === String(boardId));
        if (!b) throw new Error("没找到这块 OnePage");
        return (b.cells.portrait ?? []).map((it) => ({
          id: it.id,
          kind: it.spec.kind,
          text: it.spec.kind === "text" ? it.spec.text : undefined,
          x: it.cell.x,
          y: it.cell.y,
          w: it.cell.w,
          h: it.cell.h,
        }));
      },
      /* ── 收藏落点（2026-10-15 接线）：收藏「元素」先选落点 = 首页 / 已有 OnePage ──
         与 components/Collect.tsx 那张落点面板**同一份实现**：只调 state/onePage.ts 的
         高阶函数（addAtomToHome / addAtomToBoard，自带查重 + findFreeCell 落位，被压到的
         向下推）。门面**不碰 cells/坐标** —— 白板坐标语义由 board 那一层说了算（4 列网格契约）。 */
      onePageAddAtom: (
        target: { to?: string; boardId?: string } | null,
        atomKey: string,
      ): { ok: boolean; boardId: string; added?: string; reason?: string } => {
        gate(perms, "ui", "ext.onePageAddAtom");
        /* 存储格式唯一：kind|key。旧工具文案写 kind:key，OH 会照抄成永久失效的 ref——
           这里把首个 ':' 归一成 '|'，并拒绝解析不了的引用。 */
        let key = String(atomKey ?? "").trim();
        if (!key) throw new Error("atomKey 不能为空：原子引用形如 kind|key（也接受 kind:key）");
        if (!key.includes("|")) {
          const i = key.indexOf(":");
          if (i > 0) key = key.slice(0, i) + "|" + key.slice(i + 1);
        }
        const ref = atomRefFromKey(key);
        if (!ref || !ref.kind || !ref.key) throw new Error("atomKey 形如 kind|key（如 course|123）；可从 list_favorite_kinds 或 nav.searchAtoms 拿");
        const want = String(target?.boardId ?? "").trim();
        /* 不带 boardId = 落首页（首页画的就是系统板）；带 boardId = 落那块 OnePage */
        const r = want ? addAtomToBoard(want, key) : addAtomToHome(key);
        const boardId = want || SYSTEM_BOARD_ID;
        if (!r.added) {
          const reason = r.reason === "duplicate" ? "duplicate" : r.reason === "no-board" ? "no-board" : (r.reason ?? "unknown");
          return { ok: false, boardId, reason };
        }
        return { ok: true, boardId, added: r.added.id };
      },
      /* ── 首页程序坞（2026-10-15 接线）：NAV 一级页 ∪ 插件功能页同权，可停靠/取消停靠 ──
         实现只有一处：state/homeSpheres.ts 的 dockSphere/undockSphere（首页「更多功能」
         小窗的 ＋/× 走的就是它）。不传 pageId = 只读快照（坞上有哪些球 + 还能停哪些，
         带名字，OH 才能把「打卡页」对到 page id 上）。
         **可调用形态**：门面的 rpc 分发是平铺两段式（plugins/rust.ts 的 api[ns][method]），
         嵌套命名空间到不了 —— 所以 homeDock 本身可调用（与 .set 同一实现），
         插件作者写 `ext.homeDock.set(…)`、OH 侧走 `onethu.call("ext","homeDock",[…])` 两种都通。 */
      homeDock: (() => {
        type DockEntry = { page: string; label: string; plugin: boolean };
        type DockOut = { ok: boolean; pageId: string; label: string; docked: string[]; dockable: string[]; entries: DockEntry[] };
        const impl = (pageId?: string, on?: boolean): DockOut => {
          gate(perms, "ui", "ext.homeDock");
          const all = allSphereEntries();
          const entries: DockEntry[] = all.map((e) => ({
            page: String(e.page),
            label: String(e.label ?? ""),
            plugin: String(e.page).startsWith("plugin:"),
          }));
          const dockable = entries.map((e) => e.page);
          const id = String(pageId ?? "").trim();
          if (!id) {
            return { ok: true, pageId: "", label: "", docked: [...spheresSnapshot().docked], dockable, entries };
          }
          const entry = sphereEntry(id);
          if (!entry) {
            throw new Error(`不认识这个页面：${id}（可停靠的只有首页一级页与本机插件功能页；当前可停靠：${dockable.slice(0, 40).join(" / ")}）`);
          }
          if (on === true) dockSphere(id);
          else undockSphere(id);
          return { ok: true, pageId: id, label: String(entry.label ?? ""), docked: [...spheresSnapshot().docked], dockable, entries };
        };
        return Object.assign((pageId?: string, on?: boolean): DockOut => impl(pageId, on), {
          set: (pageId?: string, on?: boolean): DockOut => impl(pageId, on),
        });
      })(),
      /* ── 工作区 ── */
      workspaceList: (): Array<{ id: string; name: string; live: boolean; tabs: number }> =>
        explorerSnapshot().workspaces.map((w) => ({ id: w.id, name: w.name, live: w.live === true, tabs: w.tabs.length })),
      workspaceCreate: (name: string, tabIds: unknown): { id: string } => {
        gate(perms, "ui", "ext.workspaceCreate");
        const ids = Array.isArray(tabIds) ? (tabIds as unknown[]).map(String).filter(Boolean) : null;
        /* 给了成员标签 → 现场建活工作区并归属；没给 → 把当前页签存成工作区；两者都空 → 建一块空活底板 */
        let id = ids && ids.length > 0
          ? createLiveWorkspace({ name: String(name ?? ""), color: "#5b8def", icon: "fist" }, ids)
          : saveWorkspace(String(name ?? ""));
        if (!id) id = createLiveWorkspace({ name: String(name ?? ""), color: "#5b8def", icon: "fist" }, []);
        return { id };
      },
      workspaceOpen: (id: string): boolean => {
        gate(perms, "ui", "ext.workspaceOpen");
        if (!explorerSnapshot().workspaces.some((x) => x.id === String(id))) return false;
        openWorkspace(String(id));
        return true;
      },
      /** 收起活板：只折叠（不关成员标签、不删定义）——OH「把工作区收起来」的语义。 */
      workspaceCollapse: (id: string): boolean => {
        gate(perms, "ui", "ext.workspaceCollapse");
        const w = explorerSnapshot().workspaces.find((x) => x.id === String(id));
        if (!w) return false;
        patchLiveWorkspace(String(id), { collapsed: true });
        return true;
      },
      /** 真正的关闭活板：关成员标签并移除定义（破坏性，UI 大关闭按钮同义）。 */
      workspaceClose: (id: string): boolean => {
        gate(perms, "ui", "ext.workspaceClose");
        const w = explorerSnapshot().workspaces.find((x) => x.id === String(id));
        if (!w) return false;
        closeLiveWorkspace(String(id));
        return true;
      },
      workspaceDissolve: (id: string): boolean => {
        gate(perms, "ui", "ext.workspaceDissolve");
        const w = explorerSnapshot().workspaces.find((x) => x.id === String(id));
        if (!w) return false;
        dissolveWorkspace(String(id));
        return true;
      },
      workspaceDelete: (id: string): boolean => {
        gate(perms, "ui", "ext.workspaceDelete");
        const w = explorerSnapshot().workspaces.find((x) => x.id === String(id));
        if (!w) return false;
        deleteWorkspace(String(id));
        return true;
      },
      /* ── 标签页 ── */
      tabList: (): Array<{ id: string; title: string; page: string }> => [
        { id: "home", title: i18n("auto.plugins.facade.p1"), page: "homepage" },
        ...explorerSnapshot().tabs.map((t) => ({ id: t.id, title: t.title, page: String(t.page) })),
      ],
      tabOpen: (page: string): { id: string } => {
        gate(perms, "ui", "ext.tabOpen");
        const top = String(page ?? "").trim() === "today" ? "homepage" : String(page ?? "").trim();
        /* 白名单只留一处真源（explorer.KNOWN_PAGES）；子页/详情页也是合法打开目标。 */
        if (!isKnownPage(top)) throw new Error("不认识的页面，可用：" + [...TOP_PAGES].join(" / "));
        return { id: openTab(top as import("../state/app.js").Page) };
      },
      tabClose: (id: string): boolean => {
        gate(perms, "ui", "ext.tabClose");
        return closeTab(String(id));
      },
      tabDuplicate: (id: string): { id: string } => {
        gate(perms, "ui", "ext.tabDuplicate");
        const id2 = duplicateTab(String(id));
        if (!id2) throw new Error("这个标签不能复制（首页或标签不存在）");
        return { id: id2 };
      },
      tabFocus: (id: string): boolean => {
        gate(perms, "ui", "ext.tabFocus");
        return focusTab(String(id));
      },
      /* ── 低风险设置 ── */
      /* 壁纸只剩全屏一档（2026-10-14 定案）：scope 只认 "global"，其它值报错说清 */
      wallpaperSet: (scope: string, ref: string | null): void => {
        gate(perms, "ui", "ext.wallpaperSet");
        if (scope !== "global") throw new Error("壁纸只有全屏一档（scope=\"global\"）；原来的「本页」档已删除");
        const val = String(ref ?? "");
        if (val) {
          if (!val.startsWith("builtin:")) throw new Error("目前只接受内置壁纸（builtin:aurora/dusk/matcha/ink），本地图请从设置→壁纸上传");
          if (!BUILTIN_WALLPAPERS.some((b) => "builtin:" + b.id === val)) throw new Error("没有这块内置壁纸，可选：" + BUILTIN_WALLPAPERS.map((b) => "builtin:" + b.id).join("、"));
        }
        setGlobalWallpaper(val || null);
      },
      wallpaperGet: (): { global: string | null } => {
        gate(perms, "ui", "ext.wallpaperGet");
        return { global: wallpaperSnapshot().global ?? null };
      },
      voiceSet: (patch: unknown): { autoSpeak: boolean; voiceName: string; pitch: number; rate: number; backend: string } => {
        gate(perms, "ui", "ext.voiceSet");
        const p = setVoicePrefs((patch ?? {}) as Record<string, never>);
        return { autoSpeak: p.autoSpeak, voiceName: p.voiceName, pitch: p.pitch, rate: p.rate, backend: p.backend };
      },
      voiceGet: (): ReturnType<OnethuApi["ext"]["voiceSet"]> => {
        gate(perms, "ui", "ext.voiceGet");
        const p = readVoicePrefs();
        return { autoSpeak: p.autoSpeak, voiceName: p.voiceName, pitch: p.pitch, rate: p.rate, backend: p.backend };
      },
      prefSet: (patch: unknown): void => {
        gate(perms, "ui", "ext.prefSet");
        setExplorerPrefs((patch ?? {}) as Record<string, never>);
      },
      prefGet: (): { capsuleTap: string; voiceTarget: string } => {
        gate(perms, "ui", "ext.prefGet");
        return { capsuleTap: explorerPrefsSnapshot().capsuleTap, voiceTarget: explorerPrefsSnapshot().voiceTarget };
      },
      themeScheduleSet: (opts: unknown): { followSystem: boolean; dayThemeId: string | null; nightThemeId: string | null } => {
        gate(perms, "ui", "ext.themeScheduleSet");
        const o = (opts ?? {}) as { followSystem?: unknown; dayThemeId?: unknown; nightThemeId?: unknown };
        if (typeof o.followSystem === "boolean") setFollowSystem(o.followSystem);
        if (o.dayThemeId !== undefined || o.nightThemeId !== undefined) setDayNightTheme(o.dayThemeId ? String(o.dayThemeId) : null, o.nightThemeId ? String(o.nightThemeId) : null);
        return themeSchedule();
      },
      notifySet: (patch: unknown): unknown => {
        gate(perms, "ui", "ext.notifySet");
        const p = (patch ?? {}) as Record<string, unknown>;
        const clean: Record<string, unknown> = {};
        if (typeof p.enabled === "boolean") clean.enabled = p.enabled;
        if (typeof p.ddl === "boolean") clean.ddl = p.ddl;
        if (typeof p.classLead === "number") clean.classLead = p.classLead;
        if (typeof p.briefingAt === "string") clean.briefingAt = p.briefingAt;
        if (typeof p.quietFrom === "string") clean.quietFrom = p.quietFrom;
        if (typeof p.quietTo === "string") clean.quietTo = p.quietTo;
        if (typeof p.horizonDays === "number") clean.horizonDays = p.horizonDays;
        if (typeof p.maxItems === "number") clean.maxItems = p.maxItems;
        return saveNotifySettings(clean);
      },
      notifyGet: (): unknown => {
        gate(perms, "ui", "ext.notifyGet");
        return loadNotifySettings();
      },
      hwTimelineSet: (minutes: number): { minutes: number } => {
        gate(perms, "ui", "ext.hwTimelineSet");
        const m = Math.max(0, Math.min(20160, Math.trunc(Number(minutes) || 0)));
        setHwDefault(m);
        return { minutes: m };
      },
      hwReminderSet: (id: string, minutes: number | null): void => {
        gate(perms, "ui", "ext.hwReminderSet");
        setHwReminder(String(id ?? ""), minutes === null ? null : Math.max(0, Math.min(20160, Math.trunc(Number(minutes) || 0))));
      },
      eventAdd: async (ev: unknown): Promise<{ uid: string }> => {
        gate(perms, "ui", "ext.eventAdd");
        const e = (ev ?? {}) as { summary?: unknown; start?: unknown; end?: unknown; location?: unknown; allDay?: unknown; alarmMinutes?: unknown; onethuWidget?: unknown };
        const summary = String(e.summary ?? "").trim();
        if (!summary) throw new Error("日程需要标题 summary");
        const toMs = (v: unknown): number => {
          if (typeof v === "number" && Number.isFinite(v)) return v;
          const s = String(v ?? "").trim().replace(" ", "T");
          const t = new Date(s).getTime();
          if (!Number.isFinite(t)) throw new Error("时间得是「2026-10-14 09:00」格式或毫秒数");
          return t;
        };
        const start = toMs(e.start);
        const end = toMs(e.end ?? e.start);
        if (end < start) throw new Error("结束时间早于开始时间");
        const uid = "evt." + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        await putLocalEvent({
          uid,
          summary,
          start,
          end,
          location: e.location ? String(e.location) : undefined,
          allDay: e.allDay === true || undefined,
          alarmMinutes: typeof e.alarmMinutes === "number" ? e.alarmMinutes : undefined,
          onethuWidget: e.onethuWidget === true || undefined,
          onethuSource: "manual",
        } as never);
        return { uid };
      },
      eventDelete: async (uid: string): Promise<void> => {
        gate(perms, "ui", "ext.eventDelete");
        await deleteLocalEvent(String(uid ?? ""));
      },
      /** 本地日程（未来 7 天内）：OH 增删日程前按图索骥 uid */
      eventList: (): Array<{ uid: string; summary: string; start: number; end: number; allDay?: boolean }> => {
        gate(perms, "ui", "ext.eventList");
        const now = Date.now();
        const horizon = now + 7 * 86_400_000;
        return getLocalEvents()
          .filter((e) => e.start <= horizon && e.end >= now - 86_400_000)
          .sort((a, b) => a.start - b.start)
          .map((e) => ({ uid: e.uid, summary: e.summary, start: e.start, end: e.end, allDay: e.allDay === true || undefined }));
      },
      /* ── 插件生命周期（安装/启停/删除；代码本体走市场管线） ── */
      pluginInstalledList: async (): Promise<Array<{ id: string; name: string; enabled: boolean }>> => {
        gate(perms, "plugins:call", "ext.pluginInstalledList");
        const { installedPlugins } = await import("./loader.js");
        return installedPlugins().map((p) => ({ id: p.manifest.id, name: p.manifest.name, enabled: p.enabled }));
      },
      pluginInstallFromRepo: async (repo: string, entry?: string): Promise<{ id: string; name: string }> => {
        gate(perms, "plugins:call", "ext.pluginInstallFromRepo");
        const m = await import("../lib/market.js");
        const ref = m.parseRepoInput(String(repo ?? ""));
        if (!ref.owner) throw new Error("仓库地址不认识（支持 user/repo、user/repo@dev、完整 URL）");
        const code = await m.fetchEntryFromRepo(ref, entry ? String(entry) : undefined);
        const { installPlugin } = await import("./loader.js");
        const man = await installPlugin(code, { repo: m.normalizeRepoUrl(String(repo ?? "")) });
        return { id: man.id, name: man.name };
      },
      pluginEnableToggle: async (id: string, on: boolean): Promise<void> => {
        gate(perms, "plugins:call", "ext.pluginEnableToggle");
        const { enablePlugin, disablePlugin } = await import("./loader.js");
        if (on) await enablePlugin(String(id));
        else await disablePlugin(String(id));
      },
      pluginUninstall: async (id: string): Promise<void> => {
        gate(perms, "plugins:call", "ext.pluginUninstall");
        const { uninstallPlugin } = await import("./loader.js");
        await uninstallPlugin(String(id));
      },
    },
    favorites: {
      /** 收藏本插件原子（key = "<tabId>~<原子key>"；展示元数据走 registerAtom.resolve） */
      add: (key: string, folderId?: string): void => {
        gate(perms, "ui", "favorites.add");
        const k = String(key ?? "");
        if (!k) throw new Error("favorites.add 需要 key");
        let d = loadFavs();
        let fid: string | undefined = folderId ? String(folderId) : d.order[0];
        if (!fid || !d.folders[fid]) {
          const next = createFolder(d, "我的收藏", null);
          fid = next.order.find((x) => !d.order.includes(x));
          if (!fid) throw new Error("创建收藏夹失败");
          saveFavs(next);
          window.dispatchEvent(new Event("onethu.favs.changed"));
          d = loadFavs();
        }
        const f = d.folders[fid];
        if (!f) throw new Error("收藏夹不存在");
        const atomKey = atomKeyOf({ kind: pluginAtomKindOf(pluginId), key: k });
        if (!f.items.some((it) => it.t === "a" && atomKeyOf(it.atom) === atomKey)) {
          f.items.push({ t: "a" as const, atom: { kind: pluginAtomKindOf(pluginId), key: k } });
          saveFavs(d);
          window.dispatchEvent(new Event("onethu.favs.changed"));
        }
      },
      /** 收藏任意已注册种类的原子（跨插件；meta 非空且该种类未注册时内联注册静态种类，
       *  供 OH 等无 ctx 通道的调用方使用） */
      addAtom: (ref: { kind: string; key: string }, meta?: { title: string; sub?: string; group?: string; iconSvg?: string }, folderId?: string): void => {
        gate(perms, "ui", "favorites.addAtom");
        const kind = String(ref?.kind ?? "");
        const key = String(ref?.key ?? "");
        if (!kind.startsWith("plugin:") || !kind.slice("plugin:".length) || !key) {
          throw new Error("addAtom 需要 { kind: \"plugin:<插件id>\", key }");
        }
        if (meta && typeof meta.title === "string" && meta.title && !getPluginAtom(kind)) {
          registerStaticAtomItem(kind, key, meta);
        }
        const d = loadFavs();
        const fid = folderId ? String(folderId) : d.order[0];
        const f = fid ? d.folders[fid] : undefined;
        if (!f) throw new Error("收藏夹不存在（先在收藏夹页创建）");
        const atomKey = atomKeyOf({ kind, key });
        if (!f.items.some((it) => it.t === "a" && atomKeyOf(it.atom) === atomKey)) {
          f.items.push({ t: "a" as const, atom: { kind, key } });
          saveFavs(d);
          window.dispatchEvent(new Event("onethu.favs.changed"));
        }
      },
      /** 列出全部可收藏的插件原子种类（供调用方发现；OH 工具化用） */
      kinds: (): Array<{ kind: string; group: string; source: "registered" | "static" }> => {
        gate(perms, "ui", "favorites.kinds");
        const reg = new Set(pluginAtomKinds());
        return [
          ...[...reg].map((kind) => ({ kind, group: getPluginAtom(kind)?.group ?? "插件", source: "registered" as const })),
          ...staticAtomKinds().filter((x) => !reg.has(x.kind)).map((x) => ({ kind: x.kind, group: x.group, source: "static" as const })),
        ];
      },
      /** 列出本插件被收藏的原子 */
      list: (): Array<{ folderId: string; folderTitle: string; key: string }> => {
        gate(perms, "ui", "favorites.list");
        const kind = pluginAtomKindOf(pluginId);
        const d = loadFavs();
        const out: Array<{ folderId: string; folderTitle: string; key: string }> = [];
        for (const [fid, f] of Object.entries(d.folders)) {
          for (const it of f.items) {
            if (it.t === "a" && it.atom.kind === kind) {
              out.push({ folderId: fid, folderTitle: f.title, key: it.atom.key });
            }
          }
        }
        return out;
      },
    },
    llm: {
      /** 单轮对话（经内置 Harness：清华 MadModel 免费档 ↔ 自费 API 自动调度）。
       *  免费档不可用（校外且无自费 Key）时抛带引导文案的错误。需 llm 权限。 */
      chat: async (input: string): Promise<{ text: string; model: string; provider: string }> => {
        gate(perms, "llm", "llm.chat");
        // 动态 import 断 loader→facade 的环；经内置 Harness 的 chat 命令
        //（免费档↔自费自动调度、可达性兜底、会话与工具链全在 Rust 侧）
        const { runCommand } = await import("./loader.js");
        const out = (await runCommand("onethu.harness", "chat", String(input ?? ""))) as {
          type?: string; ok?: boolean; error?: string; answer?: string; model?: string;
        };
        if (!out || out.ok !== true) {
          throw new Error(String(out?.error ?? "Harness 对话失败"));
        }
        return { text: String(out.answer ?? ""), model: String(out.model ?? ""), provider: "harness" };
      },
      /** 当前 Harness 的模型源设置（"madmodel" | "custom" | ""=自动） */
      provider: async (): Promise<string> => {
        gate(perms, "llm", "llm.provider");
        const { getPlugin } = await import("./registry.js");
        const st = getPlugin("onethu.harness")?.settings ?? {};
        const provider = String(st.provider ?? "");
        if (provider) return provider;
        return st.apiKey ? "custom" : "madmodel";
      },
    },
    theme: {
      list: async () => {
        gate(perms, "theme", "theme.list");
        return listThemes().map((t) => ({ id: t.id, name: t.name, version: t.version, dark: t.dark === true }));
      },
      active: async () => {
        gate(perms, "theme", "theme.list");
        return activeThemeId();
      },
      apply: async (id: string | null) => {
        gate(perms, "theme", "theme.apply");
        if (id === null) {
          const { deactivateTheme } = await import("../state/theme.js");
          deactivateTheme();
          return;
        }
        activateTheme(String(id));
      },
      schedule: async () => {
        gate(perms, "theme", "theme.list");
        return themeSchedule();
      },
      setFollowSystem: async (on: boolean) => {
        gate(perms, "theme", "theme.apply");
        setFollowSystem(on === true);
      },
      setDayNight: async (dayId: string | null, nightId: string | null) => {
        gate(perms, "theme", "theme.apply");
        setDayNightTheme(dayId ?? null, nightId ?? null);
      },
    },
    plugins: {
      /** 列出已启用 JS 插件及其命令（供 OH 等调用方做工具发现）。需 plugins:call 权限 */
      list: async (): Promise<Array<{ pluginId: string; pluginName: string; commands: Array<{ id: string; title: string; inputLabel?: string }> }>> => {
        gate(perms, "plugins:call", "plugins.list");
        const { liveCommands } = await import("./loader.js");
        const byPlugin = new Map<string, { pluginName: string; commands: Array<{ id: string; title: string; inputLabel?: string }> }>();
        for (const [key, cmd] of liveCommands) {
          const pid = key.split(":")[0] ?? "";
          if (!pid || pid === "onethu.harness") continue;
          const rec = getPlugin(pid);
          if (!rec?.enabled) continue;
          const entry = byPlugin.get(pid) ?? { pluginName: rec.manifest.name, commands: [] };
          entry.commands.push({ id: cmd.id, title: cmd.title, inputLabel: cmd.inputLabel });
          byPlugin.set(pid, entry);
        }
        return [...byPlugin.entries()].map(([pluginId, v]) => ({ pluginId, ...v }));
      },
      /** 执行已启用插件的命令（input 为文本参数）。高危：命令可能含写操作，
       *  由各插件内部的两段确认与权限门禁兜底。需 plugins:call 权限 */
      call: async (pluginId: string, cmdId: string, input?: string): Promise<unknown> => {
        gate(perms, "plugins:call", "plugins.call");
        const { runCommand } = await import("./loader.js");
        return runCommand(String(pluginId ?? ""), String(cmdId ?? ""), String(input ?? ""));
      },
    },
    /* 极客模式：浏览器探索（桌面 Only；能力最小面：launch/navigate/eval/snapshot/close；全走 ui 门） */
    browser: {
      probe: async (): Promise<unknown> => {
        gate(perms, "ui", "browser.probe");
        const m = geek as never;
        return (m as { probeGeek: () => unknown }).probeGeek();
      },
      launch: async (mode: string): Promise<unknown> => {
        gate(perms, "ui", "browser.launch");
        if (typeof navigator !== "undefined" && /android/i.test(navigator.userAgent)) {
          throw new Error("手机端不开放浏览器探索（桌面端专属）。");
        }
        return geek.launchGeek(String(mode ?? "system"));
      },
      navigate: async (url: string): Promise<void> => {
        gate(perms, "ui", "browser.navigate");
        const u = String(url ?? "");
        if (!/^https?:\/\//.test(u)) throw new Error("url 要以 http(s):// 开头");
        await geek.geekNavigate(u);
      },
      eval: async (js: string): Promise<unknown> => {
        gate(perms, "ui", "browser.eval");
        return geek.geekEval(String(js ?? ""));
      },
      snapshot: async (): Promise<unknown> => {
        gate(perms, "ui", "browser.snapshot");
        return geek.geekSnapshot();
      },
      close: async (): Promise<unknown> => {
        gate(perms, "ui", "browser.close");
        return geek.closeGeek();
      },
    },
    ts: {
      /** 会话探活：learn 可达即视为主会话可用（wengine SSO 透明建立）。 */
      status: async (): Promise<"ready" | "expired" | "logged-out"> => {
        gate(perms, "tsinghua:sdk", "ts.status");
        if (!appSession.username) return "logged-out";
        const ok = await campusLearn.resume().catch(() => false);
        return ok ? "ready" : "expired";
      },
      /** 确保主会话可用：探活 + 透明建立；失败抛 AuthRequiredError（宿主统一口径）。 */
      ensure: async (): Promise<void> => {
        gate(perms, "tsinghua:sdk", "ts.ensure");
        const ok = await campusLearn.resume().catch(() => false);
        if (!ok) {
          throw new AuthRequiredError("清华登录状态未能建立：请在 OneTHU 中重新登录后再试。");
        }
      },
      username: async (): Promise<string | null> => {
        gate(perms, "tsinghua:sdk", "ts.username");
        return appSession.username ?? null;
      },
      /** 清华服务 HTTP 客户端：共享宿主 HttpClient（cookie 池 / webvpn 分流 /
       *  45s 超时 / 会话失效自动重登重放）。mode 覆盖分流判定。 */
      client: (opts?: { mode?: "auto" | "webvpn" | "direct" }) => {
        gate(perms, "tsinghua:sdk", "ts.client");
        const mode = opts?.mode ?? "auto";
        const client = {
          fetch: async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
            gate(perms, "tsinghua:sdk", "ts.client.fetch");
            const target = campusHttp.resolveUrl(String(url), { mode });
            const res = await campusHttp.request(target, { ...(init ?? {}), direct: mode === "direct" || undefined });
            return res;
          },
          resolve: (url: string): string => {
            return campusHttp.resolveUrl(String(url), { mode });
          },
        };
        return client;
      },
    },
    exthw: {
      snapshot: async () => {
        gate(perms, "exthw:read", "exthw.snapshot");
        const snap = getExtHwSnapshot();
        return {
          items: snap.items.map((h) => ({
            source: String(h.source),
            course: String(h.courseName ?? ""),
            title: String(h.title ?? ""),
            deadline: h.deadline ?? null,
            url: h.url ?? null,
            submitted: h.submitted === true,
            graded: (h as { graded?: boolean }).graded === true,
            score: (h as { score?: number | null }).score ?? null,
          })),
          errors: snap.errors as Record<string, string>,
          state: String(snap.state),
          lastAt: snap.lastAt,
          configured: snap.configured === true,
        };
      },
      refresh: async () => {
        gate(perms, "exthw:refresh", "exthw.refresh");
        await refreshExtHw();
      },
    },
    storage: storageNs,
    notify: {
      /** 排一条插件通知。id 归插件所有（plugin:<pluginId>:<key>）：宿主同步不会撤它，
       *  插件停用/卸载时由 loader 收回。需 notify 权限。 */
      send: async (opts: { title: string; body?: string; afterSeconds?: number; key?: string; page?: string }): Promise<{ ok: boolean; id: string; reason?: string }> => {
        gate(perms, "notify", "notify.send");
        const title = String(opts?.title ?? "").trim();
        if (!title) throw new Error("notify.send 需要 title");
        const key = String(opts?.key ?? "").trim() || `n${Date.now().toString(36)}`;
        const { sendPluginNotification } = await import("../state/pluginNotify.js");
        return sendPluginNotification({
          pluginId,
          key,
          title: title.slice(0, 80),
          body: String(opts?.body ?? "").slice(0, 200),
          afterSeconds: typeof opts?.afterSeconds === "number" ? opts.afterSeconds : 60,
          page: String(opts?.page ?? ""),
        });
      },
      cancel: async (key: string): Promise<boolean> => {
        gate(perms, "notify", "notify.cancel");
        const { cancelPluginNotification } = await import("../state/pluginNotify.js");
        const { pluginNotifyId } = await import("../state/notifyIds.js");
        return cancelPluginNotification(pluginNotifyId(pluginId, String(key ?? "").trim()));
      },
      status: async (request = false): Promise<{ ok: boolean; backend: string; granted: boolean; exact: boolean; reason?: string }> => {
        gate(perms, "notify", "notify.status");
        const { pluginNotifyStatus } = await import("../state/pluginNotify.js");
        return pluginNotifyStatus(request === true);
      },
    },
    widget: {
      /** 本插件已声明的小组件及所占槽位（未占槽位 = 有更早的插件把槽位占满了） */
      list: (): Array<{ id: string; title: string; slot: string | null }> => {
        gate(perms, "widget", "widget.list");
        const { pluginWidgetDefs, collectWidgetSlots } = pluginWidgets;
        const slots = new Map(collectWidgetSlots().map((s) => [`${s.pluginId}#${s.widgetId}`, s.slot]));
        return pluginWidgetDefs(pluginId).map((w) => ({
          id: w.id,
          title: w.title,
          slot: slots.get(`${pluginId}#${w.id}`) ?? null,
        }));
      },
      /** 本平台预留的槽位总数 */
      slots: (): number => {
        gate(perms, "widget", "widget.slots");
        return pluginWidgets.PLUGIN_WIDGET_SLOTS;
      },
      /** 桌面上每一块小组件及其绑定的内容（插件据此做「一键把本插件内容放上桌面」之类的功能） */
      instances: async (): Promise<Array<{ id: string; shape: string; binding: unknown }>> => {
        gate(perms, "widget", "widget.instances");
        const [{ fetchWidgetInstances }, { loadWidgetInstances, bindingOf }] = await Promise.all([
          import("../state/widgetBridge.js"),
          import("../state/widgetInstances.js"),
        ]);
        const list = (await fetchWidgetInstances()) ?? [];
        const map = loadWidgetInstances();
        return list.map((i) => ({ id: String(i.id), shape: String(i.provider ?? ""), binding: bindingOf(i.id, map) }));
      },
      /** 新放上桌面、还没选的块用哪份默认内容 */
      getFallback: async (): Promise<unknown> => {
        gate(perms, "widget", "widget.getFallback");
        const { loadWidgetInstances } = await import("../state/widgetInstances.js");
        return loadWidgetInstances().fallback;
      },
      setFallback: async (binding: unknown): Promise<boolean> => {
        gate(perms, "widget", "widget.setFallback");
        const { setWidgetFallback } = await import("../state/widgetInstances.js");
        const b = await normalizeBinding(binding);
        if (!b) return false;
        setWidgetFallback(b);
        return true;
      },
      /** 绑定某一块的显示内容；传 null 恢复默认。id 不存在或目标失效返回 false */
      bind: async (id: string, binding: unknown): Promise<boolean> => {
        gate(perms, "widget", "widget.bind");
        const [{ fetchWidgetInstances }, { bindWidgetInstance }] = await Promise.all([
          import("../state/widgetBridge.js"),
          import("../state/widgetInstances.js"),
        ]);
        const list = (await fetchWidgetInstances()) ?? [];
        if (!list.some((i) => String(i.id) === String(id))) return false;
        if (binding === null) {
          bindWidgetInstance(id, (await fallbackBinding()));
          return true;
        }
        const b = await normalizeBinding(binding);
        if (!b) return false;
        bindWidgetInstance(id, b);
        return true;
      },
      /** 解除绑定（回到默认内容） */
      unbind: async (id: string): Promise<boolean> => {
        gate(perms, "widget", "widget.unbind");
        const { unbindWidgetInstance } = await import("../state/widgetInstances.js");
        unbindWidgetInstance(id);
        return true;
      },
    },
    settings: {
      get: () => {
        gate(perms, "storage", "settings.get");
        const out = { ...(getPlugin(pluginId)?.settings ?? {}) };
        // MCP 服务器由宿主管理 UI 逐条维护（lib/mcpStore.ts），此处注入 JSON 供 OH 读取
        if (pluginId === "onethu.harness") {
          try {
            out["mcpServers"] = mcpServersJsonForSettings();
          } catch {
            /* 存储不可用时留空 */
          }
          // OH MCP **服务器**开关（用户 2026-10-15）：把 OneTHU 自己暴露成本机 MCP server。
          // sidecar 每次 activate/run 读一次这个值，决定 127.0.0.1 上起不起 listener。
          out["mcpServer"] = userExtSnapshot().mcpServer ? "true" : "false";
          // 创造模式（2026-10-13）：userext 的开关随 settings 泵进 OH 引擎——
          // Rust Config::from_settings 每轮 run 实时读 creativeMode，切按钮 = 下轮对话生效。
          // 存字符串贴合 settings map 的 Record<string,string> 口径（Rust 侧 as_str 读取）。
          out["creativeMode"] = userExtSnapshot().creative ? "true" : "false";
        }
        return out;
      },
    },
    net: {
      fetch: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
        gate(perms, "net:external", `net.fetch ${url.slice(0, 80)}`);
        return universalFetch(url, {
          method: (init?.method ?? "GET") as RequestInit["method"],
          headers: init?.headers,
          body: init?.body,
        });
      },
    },
    ws: {
      /** 宿主 WS 桥不可用（旧宿主构建）时，回落页面级 WebSocket（实现同一 open/send/recv/close 语义） */
      open: async (url: string, opts?: { headers?: Record<string, string>; connectTimeoutMs?: number }) => {
        gate(perms, "ws:external", `ws.open ${url.slice(0, 80)}`);
        try {
          const out = await callWsBridge<{ session: string }>("ws_open", { owner: pluginId, url, headers: opts?.headers ?? null, connectTimeoutMs: opts?.connectTimeoutMs ?? null });
          return String(out.session);
        } catch (e) {
          return await jsWsOpen(pluginId, url);
        }
      },
      send: async (session: string, data: string, encoding?: "text" | "b64") => {
        gate(perms, "ws:external", "ws.send");
        const enc: "text" | "b64" = encoding ?? "text";
        try {
          await callWsBridge("ws_send", { session, [enc]: data });
        } catch (e) {
          await jsWsSend(session, data, enc);
        }
      },
      recv: async (session: string, timeoutMs?: number) => {
        gate(perms, "ws:external", "ws.recv");
        try {
          return await callWsBridge("ws_recv", { session, timeoutMs: timeoutMs ?? null });
        } catch {
          return await jsWsRecv(session, timeoutMs ?? 10_000);
        }
      },
      close: async (session: string) => {
        gate(perms, "ws:external", "ws.close");
        try { await callWsBridge("ws_close", { session }); } catch { await jsWsClose(session); }
      },
      closeAll: async () => {
        gate(perms, "ws:external", "ws.closeAll");
        try { await callWsBridge("ws_close_owner", { owner: pluginId }); } catch { await jsWsCloseOwner(pluginId); }
      },
    },
  };
  // 读接口上的写操作（book/cancel）需要更高权限：library:read 只读，library:book 可写
  const lib = api.library as any;
  const room = api.libroom as any;
  for (const obj of [lib, room]) {
    for (const k of ["book", "cancel"]) {
      const raw = obj[k];
      if (typeof raw === "function") {
        obj[k] = (...args: unknown[]) => {
          gate(perms, "library:book", `${k}`);
          return raw(...args);
        };
      }
    }
  }
  /* 用户主题监听挂一次（模块级幂等在函数内用 started 守卫） */
  startUserThemeWatch();
  /** 用户扩展执行器：步骤里 "ns.method" 调用插件门面自身（单对象参数） */
  const execTool = (tool: string, args: Record<string, unknown> | unknown[]): Promise<unknown> => {
    const dot = tool.indexOf(".");
    if (dot <= 0) return Promise.reject(new Error("工具名需要 ns.method 形式（如 nav.go / ext.onePageAddAtom）"));
    const nsObj = (api as unknown as Record<string, Record<string, ((...a: unknown[]) => unknown) | undefined>>)[tool.slice(0, dot)];
    const fn = nsObj?.[tool.slice(dot + 1)];
    if (typeof fn !== "function") return Promise.reject(new Error("没有这个方法：" + tool));
    /* 数组=位置参数（推荐，能调多参方法）；对象=单参数（老步骤兼容） */
    const payload = Array.isArray(args) ? args : [args];
    return Promise.resolve(fn(...payload));
  };
  /* OneFlow 执行器只由 harness 注册：谁先 build 谁注册会让步骤用错插件的权限/门面。
     调度器同理只由 harness 起一次（startScheduler 内部 started 幂等）。 */
  if (pluginId === "onethu.harness") {
    registerFlowExecutor(execTool);
    startScheduler(execTool);
  }
  return api;
}

/* ═══ WS 桥：宿主命令 + 页面级 WebSocket 回退 ═══ */
// 宿主命令缺失（旧构建/未重编）时回落页面级 WebSocket：同一行列语义。
// （页内 WS 在 macOS 26.5 的 custom scheme 页面会被上游 WebKit/wry 拒掉，
// 故 SDS 优先走宿主；只回落不阻塞。）
type WsFrameLike = { kind: "text" | "binary" | "closed"; text?: string; b64?: string };
type JsWsSession = { ws: WebSocket; queue: WsFrameLike[]; closed: boolean; waiters: Array<(f: WsFrameLike | null) => void> };

const _jsWsSessions = new Map<string, JsWsSession>();

function callWsBridge<T = unknown>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const ti = (window as unknown as { __TAURI_INTERNALS__?: { invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> } }).__TAURI_INTERNALS__;
  if (!ti || typeof ti.invoke !== "function") throw new Error("NO_WS_HOST_BRIDGE");
  return ti.invoke<T>(cmd, { args });
}

function jsWsFrameFromEvent(data: unknown): WsFrameLike {
  if (typeof data === "string") return { kind: "text", text: data };
  if (data instanceof ArrayBuffer) {
    const u8 = new Uint8Array(data);
    let bin = "";
    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]!);
    return { kind: "binary", b64: btoa(bin) };
  }
  return { kind: "closed" };
}

async function jsWsOpen(owner: string, url: string): Promise<string> {
  const session = `${owner}::js-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  const sessionRec: JsWsSession = { ws, queue: [], closed: false, waiters: [] };
  _jsWsSessions.set(session, sessionRec);
  await new Promise<void>((resolve, reject) => {
    const to = setTimeout(() => { ws.close(); reject(new Error("页内 WS 连接超时")); }, 10_000);
    ws.onopen = () => { clearTimeout(to); resolve(); };
    ws.onerror = () => { clearTimeout(to); reject(new Error("页内 WS 连接失败")); };
    ws.onclose = () => {
      sessionRec.closed = true;
      sessionRec.queue.push({ kind: "closed" });
      for (const w of sessionRec.waiters.splice(0)) w(sessionRec.queue.shift() ?? { kind: "closed" });
    };
    ws.onmessage = (ev) => {
      const frame = jsWsFrameFromEvent(ev.data);
      const waiter = sessionRec.waiters.shift();
      if (waiter) waiter(frame);
      else sessionRec.queue.push(frame);
    };
  });
  return session;
}

function jsWsSend(session: string, data: string, encoding: "text" | "b64"): Promise<void> {
  const s = _jsWsSessions.get(session);
  if (!s) return Promise.reject(new Error("会话不存在"));
  if (encoding === "b64") {
    const bin = atob(data);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    s.ws.send(u8);
  } else {
    s.ws.send(data);
  }
  return Promise.resolve();
}

async function jsWsRecv(session: string, timeoutMs: number): Promise<WsFrameLike | null> {
  const s = _jsWsSessions.get(session);
  if (!s) throw new Error("会话不存在");
  if (s.queue.length) return s.queue.shift() ?? null;
  return await new Promise<WsFrameLike | null>((resolve) => {
    let timer = 0;
    const waiter = (f: WsFrameLike | null) => { clearTimeout(timer); resolve(f); };
    s.waiters.push(waiter);
    timer = window.setTimeout(() => {
      const i = s.waiters.indexOf(waiter);
      if (i >= 0) { s.waiters.splice(i, 1); resolve(null); }
    }, Math.max(50, timeoutMs));
  });
}

function jsWsClose(session: string): Promise<void> {
  const s = _jsWsSessions.get(session);
  if (s) { s.closed = true; try { s.ws.close(); } catch { /* noop */ } _jsWsSessions.delete(session); }
  return Promise.resolve();
}

function jsWsCloseOwner(owner: string): Promise<void> {
  for (const [k] of Array.from(_jsWsSessions.entries())) {
    if (k.startsWith(`${owner}::`)) void jsWsClose(k);
  }
  return Promise.resolve();
}

/* ═══ 小OH 扩展（learn/venue/xk/kongjian）辅助 ═══ */
/**
 * zhjwxk 会话：本机记住的凭据 + 设备指纹。必须模块级缓存同一个对象——
 * core 的入口缓存按会话对象（WeakMap）存，每次新建对象=每次重跑整条
 * xklogin 链（最多 25 跳）：又慢又容易「登录未落地」（2026-09-07 19:29 实录）。
 */
let _xkSession: import("@onethu/core").ZhjwxkSession | null = null;
async function xkSession(): Promise<import("@onethu/core").ZhjwxkSession> {
  const cred = await loadRemembered();
  if (!cred) throw new Error("本机无记住的密码：请开启「记住密码」并重新登录一次后使用选课功能");
  if (_xkSession && _xkSession.username === cred.username && _xkSession.password === cred.password) {
    return _xkSession;
  }
  _xkSession = { http, username: cred.username, password: cred.password, fingerprint: await currentFingerprint(), isoFetch: universalFetch, finger3: await (await import("../lib/clients.js")).loadFinger3Safe() };
  return _xkSession;
}

/** 外网公网站点（CourseX tsinghua.app）无 SLA：统一 8s 超时，防无限挂起拖死桥 */
async function withExternalTimeout<T>(p: Promise<T>, ms = 8000, label = "CourseX"): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} 响应超时（${ms / 1000} 秒），站点可能限流，稍后再试`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
const venue = venueClient;

/** R10：校园网查询撞「需要验证码」时自动把用户带到验证码面板
 *  （navGo life/network，NetworkTab 开屏即拉图），dock 链路不再把裸错误甩给
 *  模型；10s 去重防四路并发查询齐弹。改抛给模型的是可执行指引。 */
let nethCaptchaNavTs = 0;
async function nethGuard<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/需要验证码登录/.test(msg)) throw e;
    const now = Date.now();
    if (now - nethCaptchaNavTs > 10_000) {
      nethCaptchaNavTs = now;
      if (navGo("life", { lifeTab: "network" })) {
        showToast(i18n("auto.plugins.facade.msg1"));
      }
    }
    throw new Error(
      "校园网需要验证码登录：已自动打开校园网页面并展示验证码，请让用户在验证码面板输入图中字符完成登录，登录成功后重试本查询",
    );
  }
}

/* ═══ toast（DOM 直挂，最小侵入；不动 React 树） ═══ */
function showToast(text: string): void {
  const host = document.querySelector(".plugin-toast-host") as HTMLDivElement | null
    ?? (() => {
      const d = document.createElement("div");
      d.className = "plugin-toast-host";
      document.body.appendChild(d);
      return d;
    })();
  const t = document.createElement("div");
  t.className = "plugin-toast";
  t.textContent = text;
  host.appendChild(t);
  setTimeout(() => {
    t.classList.add("out");
    setTimeout(() => t.remove(), 300);
  }, 3200);
}

