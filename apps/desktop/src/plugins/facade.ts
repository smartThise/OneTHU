/** 插件门面：把应用原子操作按权限包装成 onethu.* 公共接口 */
import { info, learn, http, loadRemembered, currentFingerprint } from "../lib/clients.js";
import { InfoClient } from "@onethu/core";
import { universalFetch } from "../lib/transport.js";
import { navGo, sessionStatus } from "./bridges.js";
import { venueClient } from "../lib/venue.js";
import { openExternal } from "../pages/info/openExternal.js";
import { getPlugin, pluginStorageKey, updatePlugin } from "./registry.js";
import { PluginPermissionError, type OnethuApi, type PluginPermission } from "./types.js";

import { session as appSession, logLine } from "../lib/clients.js";

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

  const api: OnethuApi = {
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
      files: (courseId: string) => learn.getFileList(courseId),
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
        return getCourseXSemesters(universalFetch);
      },
      search: async (q: string, semester?: string) => {
        const { searchCourseXPublic } = await import("@onethu/core");
        return searchCourseXPublic(universalFetch, q, semester);
      },
      detail: async (id: string) => {
        const { getCourseXDetailPublic } = await import("@onethu/core");
        return getCourseXDetailPublic(universalFetch, id);
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
    },
    ui: {
      toast: (text: string) => {
        gate(perms, "ui", "ui.toast");
        showToast(text);
      },
    },
    storage: storageNs,
    settings: {
      get: () => {
        gate(perms, "storage", "settings.get");
        return { ...(getPlugin(pluginId)?.settings ?? {}) };
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
/** zhjwxk 会话：本机记住的凭据 + 设备指纹按需构建（零存储，函数内短命） */
async function xkSession(): Promise<import("@onethu/core").ZhjwxkSession> {
  const cred = await loadRemembered();
  if (!cred) throw new Error("本机无记住的密码：请开启「记住密码」并重新登录一次后使用选课功能");
  return { http, username: cred.username, password: cred.password, fingerprint: await currentFingerprint() };
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

