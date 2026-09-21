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
import { atomKeyOf, createFolder, loadFavs, saveFavs } from "../state/favorites.js";
import {
  getCloudCalConfig, getCloudEvents, getLocalEvents, msSinceSync, syncCloudCal,
  putCloudEvent, deleteCloudEvent, putLocalEvent, deleteLocalEvent,
} from "../state/cloudCal.js";
import { refreshMail, readMail, mailSearch, sendMail, mailFolderTotal } from "../state/mail.js";
import { getLearnSnapshot } from "../state/data.js";
import { getExtHwSnapshot, toHomework } from "../state/exthw.js";
import { parseLearnTime } from "@onethu/core";
import { ensureSeafileLoaded, getSeafileToken } from "../state/seafile.js";

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

  const mailWrite = wrap({
    send: async (to: string, cc: string, subject: string, body: string) => {
      await sendMail(to, cc, subject, body);
      return { sent: true as const };
    },
  }, perms, "mail:write");

  const api: OnethuApi = {
    cal: calNs as unknown as OnethuApi["cal"],
    mail: { ...mailRead, ...mailWrite } as OnethuApi["mail"],
    cloud: { ...cloudRead, ...cloudWrite } as OnethuApi["cloud"],
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
        if (!navGo(page, params)) throw new Error("导航桥未就绪（应用启动中）");
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
      /** 打开原子：复用收藏夹那套 view.open(nav)，故插件点开的页面与用户自己点收藏完全一致 */
      openAtom: async (ref: { kind: string; key: string }) => {
        gate(perms, "nav", "nav.openAtom");
        const kind = String(ref?.kind ?? "");
        const key = String(ref?.key ?? "");
        if (!kind || !key) return false;
        const { resolveAtom } = await import("../state/atoms.js");
        const view = resolveAtom({ kind, key });
        if (!view) return false;
        view.open((page, params) => navGo(page, params as Record<string, unknown> | undefined));
        return true;
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
          throw new AuthRequiredError("清华会话未能建立：请在 OneTHU 中重新登录后再试。");
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
  return api;
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
        showToast("校园网需要验证码登录，请输入图中验证码");
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

