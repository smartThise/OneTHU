/** 插件门面：把应用原子操作按权限包装成 onethu.* 公共接口 */
import { info } from "../lib/clients.js";
import { universalFetch } from "../lib/transport.js";
import { navGo, sessionStatus } from "./bridges.js";
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
    card: wrap({
      info: () => info.getCardInfo(),
      transactions: (s: string, e: string) => info.getCardTransactions(s, e),
    }, perms, "card:read") as OnethuApi["card"],
    dorm: wrap({
      eleRemainder: () => info.getEleRemainder(),
      elePayRecord: () => info.getElePayRecord(),
    }, perms, "dorm:read") as OnethuApi["dorm"],
    library: wrap({
      list: () => info.getLibraryList(),
      floors: (libraryId: number, dateChoice: 0 | 1 = 0) => {
        const lib = { id: libraryId, zhName: "", idPath: "", zhNameTrace: "", guanmingyuan: "", comments: "" } as any;
        return info.getLibraryFloorList(lib, dateChoice);
      },
      sections: (floor: { id: number; zhNameTrace: string }, dateChoice: 0 | 1 = 0) =>
        info.getLibrarySectionList(floor, dateChoice),
      seats: (section: { id: number; zhNameTrace: string }, dateChoice: 0 | 1 = 0) =>
        info.getLibrarySeatList(section, dateChoice),
      records: () => info.getLibBookRecords(),
      book: (seat: { id: number; type?: string }, sectionId: number, dateChoice: 0 | 1 = 0) =>
        info.bookLibrarySeat(seat, sectionId, dateChoice, appSession.username),
      cancel: (recordId: string) => info.cancelLibBooking(recordId, appSession.username),
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
      balance: () => info.getNetworkBalance(),
      devices: () => info.getOnlineDevices(),
      deviceCount: () => info.getNetworkDeviceCount(),
      accountInfo: () => info.getNetworkAccountInfo(),
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

