import { getLocale as getUiLocale } from "../i18n/index.js";
import { t as i18n, msg as i18nMsg } from "../i18n/index.js";
/**
 * 原子注册表（万物原子化 · 唯一事实来源）。
 *
 * 三类原子：
 * - page   一级/二级页面入口（信息/生活/预约各 tab、学堂子页、课表、选课…）——
 *          点击跳原位功能页（LearnNav 子栏契约），默认入口不可拆分；
 * - widget 今日组件原子（自持取数版，HomeWidgets *Widget）——收藏夹里整卡直播，
 *          点标题跳回今日对应卡片来源页；
 * - entity 实体原子（某门课/某作业/某文件/某通知/某讨论区话题/某条新闻/
 *          某楼洗衣机/某台洗衣机/某教学楼/某教室/某场馆/某类研讨间/某图书馆）——
 *          key 里自带展示元数据（~ 分隔，enc/dec），点击深链到原位功能页的特定位置。
 *
 * 搜索（AtomPicker）：静态注册表 + 动态缓存（noteAtomCache 由各实体页写入，
 * 只搜本机已见过的数据——搜索框绝不主动轰炸校内服务）。
 */
import type { ReactNode } from "react";
import { openThosInApp } from "../lib/thosOpen.js";
import { IconBell, IconBook, IconCalendar, IconCard, IconCheck, IconCloud, IconExternal, IconFile, IconFlag, IconFolder, IconGitLab, IconIn, IconInfo, IconLearn, IconMail, IconPen, IconPin, IconRefresh, IconSchedule, IconSearch, IconSpark, IconTabsCards, IconThos, IconToday, IconTrace, IconXiaoda, IconXk } from "../components/Icons.js";
import {
  AgendaWidget, CardBalanceWidget, HomeworkWidget, RecentNoticesWidget, SubsNewsWidget,
  TodayClassesWidget, TodayOverviewWidget, TodayResvWidget,
} from "../components/HomeWidgets.js";
import type { LearnNav, Page } from "./app.js";
import { cacheGet } from "./cache.js";
import { getPluginAtom, pluginAtomKindOf } from "../plugins/pluginAtoms.js";
import { WASHER_PROVIDER_LABEL, washerProviderCode, washerProviderOf } from "@onethu/core";
import { getPluginTab } from "../plugins/tabs.js";
import { resolveTabTitle } from "./tabTitles.js";
import { FAVS_MAX_DEPTH, loadFavs, type AtomRef } from "./favorites.js";
import { setSelectedSemester } from "./data.js";
import { WasherTileStatus, ClassroomTileStatus, ClassroomRoomToday } from "../components/LiveTiles.js";
import { INFO_APPS, infoAppUrl } from "../lib/infoApps.js";
import { openExternal } from "../pages/info/openExternal.js";
import { recordAtomUse } from "../lib/usage.js";
import { getMailHead } from "./mail.js";
import { syncCloudCal, syncHwToCloud } from "./cloudCal.js";
import { showToast } from "./toast.js";

/** 图标最小接口（与 homeCards 的 HomeCardIcon 同口径） */
export type AtomIcon = (p: { width?: number; height?: number; className?: string }) => ReactNode;

/** 轻路由签名 */
export type Nav = (page: Page, params?: LearnNav) => void;

/** 解析后的原子视图（渲染/跳转全走它） */
export interface AtomView {
  atom: AtomRef;
  title: string;
  /** 第二行说明 */
  sub?: string;
  icon: AtomIcon;
  /** 点击跳转（原位功能页；widget 的标题点击也走这里） */
  open: (nav: Nav) => void;
  /** 自持组件卡体（widget 原子专用；挂收藏夹瀑布流时整卡直播） */
  widget?: () => ReactNode;
  /** 方卡实时状态件（洗衣机/教室等实体原子：收藏后卡片上直播状态） */
  tileLive?: () => ReactNode;
  /** 收藏夹缺省方卡（细粒度实体缺省方卡，页面/组件缺省长卡） */
  defaultSq?: boolean;
  /** 搜索分类标签（AtomPicker 右侧灰字） */
  group: string;
}

/* ══════════ key 编解码（实体原子元数据内嵌；~ 分隔） ══════════ */

export function enc(...parts: Array<string | number | undefined>): string {
  return parts.map((p) => String(p ?? "").replace(/~/g, "-")).join("~");
}

export function dec(key: string): string[] {
  return key.split("~");
}

/* 标签页原子（kind = "tab"）：任何工作标签页都能一星收藏成独立 OnePage（用户定案：
   一星 = 页面本体成为 OnePage；打开即本页）。key = page + "~" + 编码后的 params JSON。 */
export function tabAtomKey(page: string, params?: object | null): string {
  const keys = Object.keys(params ?? {}).filter((k) => (params as Record<string, unknown>)[k] !== undefined).sort();
  const clean: Record<string, unknown> = {};
  for (const k of keys) clean[k] = (params as Record<string, unknown>)[k];
  const body = keys.length ? encodeURIComponent(JSON.stringify(clean)).replace(/~/g, "%7E") : "";
  return page + "~" + body;
}

export function parseTabAtomKey(key: string): { page: string; params: Record<string, unknown> | undefined } | null {
  const i = key.indexOf("~");
  if (i < 0) return null;
  const page = key.slice(0, i);
  const body = key.slice(i + 1);
  if (!page) return null;
  if (!body) return { page, params: undefined };
  try {
    return { page, params: JSON.parse(decodeURIComponent(body)) as Record<string, unknown> };
  } catch {
    return null;
  }
}

/* ══════════ 动态缓存（实体页加载成功后 note；只读用于搜索） ══════════ */

export interface AtomDynCache {
  /** 洗衣机楼栋组（WasherTab groups 就绪后写入） */
  washerGroups?: Array<{ gname: string; id: string; name: string; provider?: string }>;
  /** 教学楼（ClassroomTab 就绪后写入） */
  classroomBuildings?: Array<{ searchName: string; name: string }>;
  /** 体育场馆 scene（VenueSportsTab 就绪后写入；uuid 为原子 key） */
  sportsScenes?: Array<{ uuid: string; name: string }>;
  /** 新闻列表（NewsTab 就绪后写入） */
  newsItems?: Array<{ xxid: string; name: string; source?: string }>;
  /** 研讨间类型（LibRoomTab 就绪后写入） */
  libroomKinds?: Array<{ kindId: number; kindName: string }>;
  /** 图书馆（LibraryTab 就绪后写入） */
  libraries?: Array<{ id: number; name: string }>;
  /** 新闻订阅源（NewsTab 条目就绪后写入；按源收藏整源新闻） */
  newsSources?: Array<{ name: string }>;
  /** 公共空间楼宇/空间与具体房间（KongjianTab 就绪后写入） */
  kjSpaces?: Array<{ id: string; name: string }>;
  kjRooms?: Array<{ spaceId: string; spaceName: string; id: string; name: string }>;
  /** courseX 课程（CourseInfoTab 搜索就绪后写入；时间地点在收藏时经详情补齐） */
  courseXCourses?: Array<{ sem: string; id: string; name: string; teacher?: string }>;
  /** 讨论区板块（BbsPanel 板块列表就绪后写入） */
  bbsBoards?: Array<{ courseId: string; bqid: string; name: string; courseName?: string; sem?: string }>;
  /** 在线服务目录（ThosPage 就绪后写入；id 为原子 key，url 供打开） */
  thosServices?: Array<{ id: string; name: string; department?: string; url?: string }>;
  /** 讨论区话题（BbsPanel 列表页就绪后写入；bqid 为所属板块） */
  bbsThreads?: Array<{ courseId: string; bqid: string; id: string; title: string; courseName?: string; sem?: string }>;
  /** GitLab 项目 / Issue / 合并请求（GitLab 页就绪后写入） */
  gitlabProjects?: Array<{ id: number; name: string }>;
  gitlabIssues?: Array<{ projectId: number; iid: number; title: string }>;
  gitlabMergeRequests?: Array<{ projectId: number; iid: number; title: string }>;
}

const dyn: AtomDynCache = {};

/** 实体页取数成功后调用（浅合并）；绝不主动发起网络请求 */
export function noteAtomCache(patch: AtomDynCache): void {
  Object.assign(dyn, patch);
}

/** 学堂实体原子打开前的学期校准：带学期尾参的原子先 setSelectedSemester
 *  （内部清 learn 缓存，useLearnData 会按该学期重拉全量包），再跳原位。
 *  无学期尾参的旧原子保持现状（跟随用户当前所选学期）。 */
function openLearn(nav: Nav, page: Page, params: LearnNav, sem?: string): void {
  if (sem) setSelectedSemester(sem);
  nav(page, params);
}

/* ══════════ 静态注册表：操作原子（用户拍板「OH 的操作原子化」） ══════════
 * 点击即执行（非跳转）：动作跑完 toast 反馈结果。与页面原子一样可搜、可收藏——
 * 收藏夹里的操作卡点一下就是一次执行。 */
interface ActionAtom {
  kind: "action";
  key: string;
  title: string;
  sub?: string;
  icon: AtomIcon;
  group: string;
  run: () => Promise<string>;
}

export const ACTION_ATOMS: ActionAtom[] = [
  {
    kind: "action", key: "cal-sync-hw", get title() { return i18n("state.atoms.f3849df7f168"); }, get sub() { return i18n("state.atoms.7132ae7d734a"); },
    icon: IconBell, group: "操作",
    run: async () => {
      const r = await syncHwToCloud();
      return r.skipped ? i18n("state.atoms.8ae04d950861", { value: String(r.written === 0 ? i18n("state.atoms.0ab15a1cb720") : i18n("state.atoms.253f54401fa7")) }) : i18n("state.atoms.7f2090267b41", { written: String(r.written), removed: String(r.removed) });
    },
  },
  {
    kind: "action", key: "cal-sync-scan", get title() { return i18n("state.atoms.07c9a15ad13f"); }, get sub() { return i18n("state.atoms.b9d8c8f7b02f"); },
    icon: IconRefresh, group: "操作",
    run: async () => {
      const r = await syncCloudCal();
      return i18n("state.atoms.d25aafa6ed3f", { total: String(r.total), added: String(r.added), updated: String(r.updated), removed: String(r.removed) });
    },
  },
];

/* ══════════ 静态注册表：页面原子 ══════════ */

interface StaticAtom {
  kind: string;
  key: string;
  title: string;
  sub?: string;
  icon: AtomIcon;
  group: string;
  page: Page;
  params?: LearnNav;
  defaultSq?: boolean;
}

/** 全部二级页面入口（=旧 homeCards entry 全集 + 课程信息栏 + 学堂一级） */
export const PAGE_ATOMS: StaticAtom[] = [
  /* 一级页兜底原子（2026-10-17）：以前只有部分一级页进了注册表，OH 的 open_page
     搜「THUBook / 在线服务 / 白板」全是空的；这里补全所有可导航一级入口。 */
  { kind: "page", key: "homepage", get title() { return i18n("state.atoms.203c08e0d44a"); }, get sub() { return i18n("state.atoms.c6460a02e85e"); }, icon: IconToday, group: "页面", page: "homepage" },
  { kind: "page", key: "thubook", title: "THUBook", get sub() { return i18n("state.atoms.53646ecea274"); }, icon: IconBook, group: "页面", page: "thubook" },
  { kind: "page", key: "thos", get title() { return i18n("state.atoms.1760b98532ec"); }, get sub() { return i18n("state.atoms.0f045b9615fc"); }, icon: IconThos, group: "页面", page: "thos" },
  { kind: "page", key: "otherinfo", get title() { return i18n("state.atoms.4ebe692f5dbb"); }, get sub() { return i18n("state.atoms.d8e3dfbe5f8a"); }, icon: IconExternal, group: "页面", page: "otherinfo" },
  { kind: "page", key: "tasks", get title() { return i18n("state.atoms.52fdbbaeda4c"); }, get sub() { return i18n("state.atoms.371c1b0109ee"); }, icon: IconCheck, group: "页面", page: "tasks" },
  { kind: "page", key: "services", get title() { return i18n("state.atoms.ec309ab207ef"); }, get sub() { return i18n("state.atoms.7eacf1926832"); }, icon: IconSpark, group: "页面", page: "services" },
  { kind: "page", key: "favs", get title() { return i18n("state.atoms.60a53514eb92"); }, get sub() { return i18n("state.atoms.75ed5296c3b6"); }, icon: IconPin, group: "页面", page: "favs" },
  { kind: "page", key: "boards", get title() { return i18n("state.atoms.0f591af87c35"); }, get sub() { return i18n("state.atoms.1cb2f2a7577c"); }, icon: IconTabsCards, group: "页面", page: "boards" },
  { kind: "page", key: "board", title: "OnePage", get sub() { return i18n("state.atoms.b208d9df4fca"); }, icon: IconTabsCards, group: "页面", page: "board" },
  { kind: "page", key: "contacts", get title() { return i18n("state.atoms.06657c279571"); }, get sub() { return i18n("state.atoms.37d169b450b9"); }, icon: IconIn, group: "页面", page: "contacts" },
  { kind: "page", key: "vault", get title() { return i18n("state.atoms.804002a9c49a"); }, get sub() { return i18n("state.atoms.8bfa2692305a"); }, icon: IconIn, group: "页面", page: "vault" },
  { kind: "page", key: "folder", get title() { return i18n("state.atoms.aeddd0584371"); }, get sub() { return i18n("state.atoms.d5a374a5b103"); }, icon: IconFolder, group: "页面", page: "folder" },
  { kind: "page", key: "info-root", get title() { return i18n("state.atoms.e7028601e7da"); }, get sub() { return i18n("state.atoms.8fff9a5b021b"); }, icon: IconInfo, group: "页面", page: "info" },
  { kind: "page", key: "life-root", get title() { return i18n("state.atoms.15d208d1b4c9"); }, get sub() { return i18n("state.atoms.dcd2bf114535"); }, icon: IconToday, group: "页面", page: "life" },
  { kind: "page", key: "reserve-root", get title() { return i18n("state.atoms.352cdc807892"); }, get sub() { return i18n("state.atoms.452f594e3f7c"); }, icon: IconCalendar, group: "页面", page: "reserve" },
  { kind: "page", key: "schedule", get title() { return i18n("state.atoms.a14f23af7016"); }, get sub() { return i18n("state.atoms.8efd83feacc8"); }, icon: IconSchedule, group: "页面", page: "schedule" },
  { kind: "page", key: "trace", get title() { return i18n("state.atoms.60458dfb4c14"); }, get sub() { return i18n("state.atoms.5c9d7b5dddae"); }, icon: IconTrace, group: "页面", page: "trace" },
  { kind: "page", key: "mail", get title() { return i18n("state.atoms.73075237fd0f"); }, get sub() { return i18n("state.atoms.4c30e45ecab2"); }, icon: IconMail, group: "页面", page: "mail" },
  { kind: "page", key: "mail-compose", get title() { return i18n("state.atoms.ed80f9723a5a"); }, get sub() { return i18n("state.atoms.ac7a24ae899f"); }, icon: IconPen, group: "页面", page: "mail", params: { mailCompose: true } },
  { kind: "page", key: "cloud", get title() { return i18n("state.atoms.f75562426e77"); }, get sub() { return i18n("state.atoms.a43f6d78f983"); }, icon: IconCloud, group: "页面", page: "cloud" },
  { kind: "page", key: "gitlab", title: "GitLab", get sub() { return i18n("state.atoms.f951111a412f"); }, icon: IconGitLab, group: "页面", page: "gitlab" },
  { kind: "page", key: "zhjwxk", get title() { return i18n("state.atoms.fd17d86dd268"); }, get sub() { return i18n("state.atoms.87a17e3b9851"); }, icon: IconXk, group: "页面", page: "zhjwxk" },
  /* 清小搭（2026-10-15 用户点名「搜索栏注册可搜索」）：一级页只有进了页面原子，
     搜索栏/命令面板/底栏检索条与 OH 的 open_page 才认得出它（否则只能靠注册表名字命中，
     且 OH 按名打开会找不到）；顺带解锁页头星标收藏与「最近使用」回跳。 */
  { kind: "page", key: "xiaoda", get title() { return i18n("state.atoms.b1abb3dc2271"); }, get sub() { return i18n("state.atoms.13d31ddcce2b"); }, icon: IconXiaoda, group: "页面", page: "xiaoda" },
  { kind: "page", key: "learn", get title() { return i18n("state.atoms.aa39cac2b409"); }, get sub() { return i18n("state.atoms.bb7b63b39fd4"); }, icon: IconLearn, group: "页面", page: "learn" },
  { kind: "page", key: "learn-assignments", get title() { return i18n("state.atoms.a1cabc0664cf"); }, get sub() { return i18n("state.atoms.b3ed0c353c77"); }, icon: IconPen, group: "页面", page: "learn-assignments" },
  { kind: "page", key: "learn-notices", get title() { return i18n("state.atoms.bdac834d0ba2"); }, get sub() { return i18n("state.atoms.14e681cbe318"); }, icon: IconBell, group: "页面", page: "learn-notices" },
  { kind: "page", key: "learn-files", get title() { return i18n("state.atoms.fa8fe752727c"); }, get sub() { return i18n("state.atoms.0e68f2517080"); }, icon: IconFile, group: "页面", page: "learn-files" },
  { kind: "page", key: "learn-search", get title() { return i18n("state.atoms.62fd8d15cf0a"); }, get sub() { return i18n("state.atoms.1599af41d9c3"); }, icon: IconSearch, group: "页面", page: "learn-search" },
  { kind: "page", key: "learn-semester", get title() { return i18n("state.atoms.231ff6cd9b63"); }, get sub() { return i18n("state.atoms.13a9d4b0c392"); }, icon: IconRefresh, group: "页面", page: "learn-semester" },
  { kind: "page", key: "learn-hwremind", get title() { return i18n("state.atoms.3df7b5791ab9"); }, get sub() { return i18n("state.atoms.c141273da51a"); }, icon: IconBell, group: "页面", page: "learn", params: { learnOpenHwRemind: true } },
  { kind: "page", key: "info-report", get title() { return i18n("state.atoms.ede028d7ec64"); }, get sub() { return i18n("state.atoms.95ce4af97b93"); }, icon: IconCheck, group: "页面", page: "info", params: { infoTab: "report" } },
  { kind: "page", key: "info-fitness", get title() { return i18n("state.atoms.316da6d69b7d"); }, get sub() { return i18n("state.atoms.cce40ddbb7b9"); }, icon: IconCheck, group: "页面", page: "info", params: { infoTab: "fitness" } },
  { kind: "page", key: "info-exams", get title() { return i18n("state.atoms.88df420f8207"); }, get sub() { return i18n("state.atoms.5531576bd063"); }, icon: IconFlag, group: "页面", page: "info", params: { infoTab: "exams" } },
  { kind: "page", key: "info-evaluation", get title() { return i18n("state.atoms.14384c9d60cc"); }, get sub() { return i18n("state.atoms.02cb99cb0282"); }, icon: IconPen, group: "页面", page: "info", params: { infoTab: "evaluation" } },
  { kind: "page", key: "info-calendar", get title() { return i18n("state.atoms.4792ab1440aa"); }, get sub() { return i18n("state.atoms.fc7c1ff5f380"); }, icon: IconCalendar, group: "页面", page: "info", params: { infoTab: "calendar" } },
  { kind: "page", key: "info-news", get title() { return i18n("state.atoms.10d6105303f8"); }, get sub() { return i18n("state.atoms.7ca0b3673bc7"); }, icon: IconExternal, group: "页面", page: "info", params: { infoTab: "news" } },
  { kind: "page", key: "info-profile", get title() { return i18n("state.atoms.640803d89773"); }, get sub() { return i18n("state.atoms.961b6374e9a5"); }, icon: IconInfo, group: "页面", page: "info", params: { infoTab: "profile" } },
  { kind: "page", key: "info-courseinfo", title: "courseX", get sub() { return i18n("state.atoms.192b490632ec"); }, icon: IconInfo, group: "页面", page: "info", params: { infoTab: "courseinfo" } },
  { kind: "page", key: "life-dorm", get title() { return i18n("state.atoms.3a74de9a9014"); }, get sub() { return i18n("state.atoms.1c1ece1ebe90"); }, icon: IconToday, group: "页面", page: "life", params: { lifeTab: "elec" } },
  { kind: "page", key: "life-electricity", get title() { return i18n("state.atoms.ab8cff9a597a"); }, get sub() { return i18n("state.atoms.56c68de9eced"); }, icon: IconCard, group: "页面", page: "life", params: { lifeTab: "elec" } },
  { kind: "page", key: "life-water", get title() { return i18n("state.atoms.bb8c939d0fcd"); }, get sub() { return i18n("state.atoms.4df0d6b1cd95"); }, icon: IconToday, group: "页面", page: "life", params: { lifeTab: "water" } },
  { kind: "page", key: "life-washer", get title() { return i18n("state.atoms.6acfa1db6a62"); }, get sub() { return i18n("state.atoms.390251ce8a9d"); }, icon: IconRefresh, group: "页面", page: "life", params: { lifeTab: "washer" } },
  { kind: "page", key: "life-hygiene", get title() { return i18n("state.atoms.41d497d6e07e"); }, get sub() { return i18n("state.atoms.cf05dea41f42"); }, icon: IconFlag, group: "页面", page: "life", params: { lifeTab: "hygiene" } },
  { kind: "page", key: "life-card", get title() { return i18n("state.atoms.caf1f095b108"); }, get sub() { return i18n("state.atoms.fe7dbfcadf51"); }, icon: IconCard, group: "页面", page: "life", params: { lifeTab: "card" } },
  { kind: "page", key: "life-invoice", get title() { return i18n("state.atoms.92341cf02c56"); }, get sub() { return i18n("state.atoms.e703d13e3468"); }, icon: IconFile, group: "页面", page: "life", params: { lifeTab: "invoice" } },
  { kind: "page", key: "life-payroll", get title() { return i18n("state.atoms.24be2018df29"); }, get sub() { return i18n("state.atoms.838814f1139e"); }, icon: IconToday, group: "页面", page: "life", params: { lifeTab: "payroll" } },
  { kind: "page", key: "life-gradincome", get title() { return i18n("state.atoms.336dbe5fd82f"); }, get sub() { return i18n("state.atoms.53090df93da8"); }, icon: IconCard, group: "页面", page: "life", params: { lifeTab: "gradincome" } },
  { kind: "page", key: "life-network", get title() { return i18n("state.atoms.dd94488f5269"); }, get sub() { return i18n("state.atoms.8e46dccaa4fb"); }, icon: IconExternal, group: "页面", page: "life", params: { lifeTab: "network" } },
  { kind: "page", key: "reserve-lib", get title() { return i18n("state.atoms.31c17158ebdb"); }, get sub() { return i18n("state.atoms.3b7240a9d253"); }, icon: IconSchedule, group: "页面", page: "reserve", params: { reserveTab: "lib" } },
  { kind: "page", key: "reserve-room", get title() { return i18n("state.atoms.e4d40b4d6759"); }, get sub() { return i18n("state.atoms.411769324590"); }, icon: IconCalendar, group: "页面", page: "reserve", params: { reserveTab: "room" } },
  { kind: "page", key: "reserve-classroom", get title() { return i18n("state.atoms.ecc11c8afea8"); }, get sub() { return i18n("state.atoms.00a42a995295"); }, icon: IconSearch, group: "页面", page: "reserve", params: { reserveTab: "classroom" } },
  { kind: "page", key: "reserve-sports", get title() { return i18n("state.atoms.07a0fa11958e"); }, get sub() { return i18n("state.atoms.ee6388006cb5"); }, icon: IconSchedule, group: "页面", page: "reserve", params: { reserveTab: "sports" } },
  { kind: "page", key: "reserve-kongjian", get title() { return i18n("state.atoms.e81059e1a712"); }, get sub() { return i18n("state.atoms.3e668eb1a6ae"); }, icon: IconCalendar, group: "页面", page: "reserve", params: { reserveTab: "kongjian" } },
  /* 临时来访人员报备（2026-10-15）：key 与 navigation.ts 的 reserve-visit 同名（搜索点行两边必须同参数）。 */
  { kind: "page", key: "reserve-visit", get title() { return i18n("state.atoms.99f047c591bb"); }, get sub() { return i18n("state.atoms.3fb35cdc3085"); }, icon: IconFlag, group: "页面", page: "reserve", params: { reserveTab: "visit" } },
];

/**
 * 页面级使用统计（侧边栏 / 今日入口卡进页面时调用）：把 (page, params) 对回
 * PAGE_ATOMS 里最贴切的那条页面原子并记一笔——「最近使用」卡要能点回去，
 * 就必须落成原子（页面 id 本身不是原子）。
 * 匹配优先级：page 相同且参数子集完全命中 > page 相同。params 里的 tab 类字段
 * 也参与比较，故「生活页 → 洗衣机」和「生活页 → 宿舍」分得清。
 */
export function recordPageAtomUse(page: Page, params?: LearnNav | null): void {
  const same = PAGE_ATOMS.filter((a) => a.page === page);
  if (same.length === 0) return;
  const keys = Object.keys(params ?? {}) as Array<keyof LearnNav>;
  let best: (typeof same)[number] | null = null;
  let bestScore = -1;
  for (const a of same) {
    const ap = (a.params ?? {}) as LearnNav;
    let score = 0;
    for (const k of keys) if (ap[k] !== undefined && ap[k] === (params as LearnNav)[k]) score += 2;
    if (a.params && Object.keys(a.params).length === 0) score += 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  if (!best) return;
  recordAtomUse({ kind: "page", key: best.key }, { title: best.title, sub: best.sub, group: best.group });
}

/** 页头星标用：key 命中 PAGE_ATOMS 才返回引用（防手写 key 漂移出野原子） */
export function pageAtomRef(key: string): AtomRef | null {
  return PAGE_ATOMS.some((a) => a.key === key) ? { kind: "page", key } : null;
}

/* ══════════ 静态注册表：组件原子（今日组件自持版） ══════════ */

interface WidgetAtom {
  kind: "widget";
  key: string;
  title: string;
  sub?: string;
  icon: AtomIcon;
  group: string;
  body: () => ReactNode;
  page: Page;
  params?: LearnNav;
}

/** 点击标题跳回组件数据来源页（与今日页各卡点击行为同口径） */
export const WIDGET_ATOMS: WidgetAtom[] = [
  { kind: "widget", key: "today-overview", get title() { return i18n("state.atoms.211d36ccbe1e"); }, get sub() { return i18n("state.atoms.14259c8a65a8"); }, icon: IconToday, group: "组件", body: () => <TodayOverviewWidget />, page: "homepage" },
  { kind: "widget", key: "agenda", get title() { return i18n("state.atoms.c730a0bada79"); }, get sub() { return i18n("state.atoms.acbe926d0b5c"); }, icon: IconCalendar, group: "组件", body: () => <AgendaWidget />, page: "schedule" },
  { kind: "widget", key: "homework", get title() { return i18n("state.atoms.8bb50166823f"); }, get sub() { return i18n("state.atoms.61a292c2a4a0"); }, icon: IconPen, group: "组件", body: () => <HomeworkWidget />, page: "learn-assignments" },
  { kind: "widget", key: "notices", get title() { return i18n("state.atoms.33005938adb3"); }, get sub() { return i18n("state.atoms.959f2f8d7f57"); }, icon: IconBell, group: "组件", body: () => <RecentNoticesWidget />, page: "learn" },
  { kind: "widget", key: "cardEntry", get title() { return i18n("state.atoms.c0c6bb8b8618"); }, get sub() { return i18n("state.atoms.5f2cfbfecf9f"); }, icon: IconCard, group: "组件", body: () => <CardBalanceWidget />, page: "life", params: { lifeTab: "card" } },
  { kind: "widget", key: "resv", get title() { return i18n("state.atoms.9e6a260920fb"); }, get sub() { return i18n("state.atoms.499fc8e68d81"); }, icon: IconSchedule, group: "组件", body: () => <TodayResvWidget />, page: "reserve" },
  { kind: "widget", key: "classes", get title() { return i18n("state.atoms.119099ab1bad"); }, get sub() { return i18n("state.atoms.4d8a9ed9bf01"); }, icon: IconToday, group: "组件", body: () => <TodayClassesWidget />, page: "schedule" },
  { kind: "widget", key: "news", get title() { return i18n("state.atoms.10d6105303f8"); }, get sub() { return i18n("state.atoms.7755e6257a48"); }, icon: IconExternal, group: "组件", body: () => <SubsNewsWidget />, page: "info", params: { infoTab: "news" } },
];

/* ══════════ 实体原子工厂 ══════════ */

/**
 * 原子视图工厂：**所有**解析出来的原子都在这里统一包一层「使用记录」（今日页
 * 「最近使用 / 猜你喜欢」的数据源）。放这儿是因为收藏夹点击、OH（nav.openAtom）、
 * 桌面小组件、搜索弹层最终都走 view.open —— 一处包好，全链路都记上。
 * 与收藏无关：统计只写本机 localStorage，绝不自动改动用户的收藏夹。
 */
function view(partial: Omit<AtomView, "atom"> & { atom: AtomRef }): AtomView {
  const inner = partial.open;
  return {
    ...partial,
    open: (nav) => {
      recordAtomUse(partial.atom, { title: partial.title, sub: partial.sub, group: partial.group });
      inner(nav);
    },
  };
}

/** 解析原子：注册表未知的 kind/key 返回 null（渲染处直接丢弃） */
/** inline SVG 字符串 → AtomIcon（插件原子图标；异常降级拼图占位） */
function svgIcon(svg: string | undefined): AtomIcon {
  return ({ width = 16, height = 16, className }) => (
    <span
      className={"plg-svg-icon" + (className ? ` ${className}` : "")}
      style={{ width, height, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
      dangerouslySetInnerHTML={{ __html: svg ?? FALLBACK_TAB_SVG }}
    />
  );
}

const FALLBACK_TAB_SVG = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 2.5 4.2 6l-2.4 4.5L6 13.5l3-2 3 2 2.2-3-2.4-4.5L10 2.5l-4 0z"/></svg>';

export function resolveAtom(ref: AtomRef): AtomView | null {
  const { kind, key } = ref;
  // 插件动态原子（kind = plugin:<pluginId>；key 编解码由插件自持）
  if (kind.startsWith("plugin:")) {
    const def = getPluginAtom(kind);
    if (!def) return null;
    const meta = (() => {
      try {
        return def.resolve(key);
      } catch {
        return null;
      }
    })();
    // 约定：插件原子 key = "<tabId>~<原子key>"——点击深链到插件对应 tab
    const tabId = key.split("~")[0] ?? "";
    const target: Page = `plugin:${kind.slice("plugin:".length)}:${tabId}`;
    return {
      atom: ref,
      title: meta?.title ?? i18n("state.atoms.4e2ebf869a50"),
      sub: meta?.sub ?? def.group,
      icon: svgIcon(def.iconSvg),
      group: def.group,
      open: (nav) => {
        // 目标 tab 未注册（插件停用/无 tab 形态如 OH）→ 降级提示而非跳空白页
        if (!getPluginTab(target)) {
          showToast(i18nMsg("state.atoms.716b8504f013"));
          return;
        }
        nav(target, undefined);
      },
    };
  }
  if (kind === "page") {
    const s = PAGE_ATOMS.find((a) => a.key === key);
    if (!s) return null;
    return view({
      atom: ref, title: s.title, sub: s.sub, icon: s.icon, group: s.group,
      open: (nav) => nav(s.page, s.params ? { ...s.params } : undefined),
    });
  }
  if (kind === "tab") {
    const parsed = parseTabAtomKey(key);
    if (!parsed) return null;
    const page = parsed.page as Page;
    const params = parsed.params as LearnNav | undefined;
    const t = resolveTabTitle(page, params ?? null);
    return view({
      atom: ref, title: t.label, sub: t.full, icon: IconFile, group: "标签页",
      open: (nav) => nav(page, params ? { ...params } as LearnNav : undefined),
    });
  }
  if (kind === "widget") {
    const w = WIDGET_ATOMS.find((a) => a.key === key);
    if (!w) return null;
    return view({
      atom: ref, title: w.title, sub: w.sub, icon: w.icon, group: w.group,
      widget: w.body,
      open: (nav) => nav(w.page, w.params ? { ...w.params } : undefined),
    });
  }
  if (kind === "thos-service") {
    const [id, name, department] = dec(key);
    if (!id) return null;
    return view({
      atom: ref,
      title: name || i18n("state.atoms.1760b98532ec"),
      sub: department ? i18n("state.atoms.7ecb4f45c64b") + department : i18n("state.atoms.1760b98532ec"),
      icon: IconThos,
      group: "在线服务",
      open: () => {
        const svc = (dyn.thosServices ?? []).find((x) => x.id === id);
        if (svc?.url) void openThosInApp(svc.url);
      },
    });
  }
  if (kind === "course") {
    const [id, name, teacher, sem] = dec(key);
    if (!id || !name) return null;
    return view({
      atom: ref, title: name, sub: teacher ? i18n("state.atoms.b08512fcc283") + teacher : i18n("state.atoms.60db1afb4022"), icon: IconLearn, group: "网络学堂",
      open: (nav) => openLearn(nav, "learn-course", { courseId: id }, sem),
    });
  }
  if (kind === "assignment" || kind === "notice" || kind === "file") {
    const [courseId, itemId, title, courseName, sem] = dec(key);
    if (!courseId || !itemId) return null;
    const conf = {
      assignment: { t: i18n("state.atoms.b0dff016ff17"), icon: IconPen, page: "learn-assignment-detail" as Page },
      notice: { t: i18n("state.atoms.4b6ded8a7f18"), icon: IconBell, page: "learn-notice-detail" as Page },
      file: { t: i18n("state.atoms.39932f24fe11"), icon: IconFile, page: "learn-file-detail" as Page },
    }[kind];
    return view({
      atom: ref, title: title || conf.t, sub: (courseName ? courseName + " · " : "") + conf.t, icon: conf.icon, group: "网络学堂",
      open: (nav) => openLearn(nav, conf.page, { courseId, itemId }, sem),
    });
  }
  if (kind === "bbs-board") {
    const [courseId, bqid, name, courseName, sem] = dec(key);
    if (!courseId || !bqid) return null;
    return view({
      atom: ref, title: name || i18n("state.atoms.b80e3dfb7fba"), sub: (courseName ? courseName + " · " : "") + i18n("state.atoms.b80e3dfb7fba"), icon: IconLearn, group: "网络学堂",
      open: (nav) => openLearn(nav, "learn-course", { courseId, courseTab: "forum", bbsBoard: bqid }, sem),
    });
  }
  if (kind === "forum") {
    const [courseId, threadId, bqid, title, courseName, sem] = dec(key);
    if (!courseId || !threadId) return null;
    return view({
      atom: ref, title: title || i18n("state.atoms.564f7a2748bb"), sub: (courseName ? courseName + " · " : "") + i18n("state.atoms.9c92c9d08b05"), icon: IconLearn, group: "网络学堂",
      open: (nav) => openLearn(nav, "learn-forum-thread", { courseId, itemId: threadId, bqid: bqid || undefined }, sem),
    });
  }
  if (kind === "gitlab-proj") {
    const [id, name] = dec(key);
    const pid = Number(id);
    if (!pid) return null;
    return view({
      atom: ref, title: name || i18n("state.atoms.6aa71ddd8364"), sub: i18n("state.atoms.6aa71ddd8364"), icon: IconGitLab, group: "GitLab",
      open: (nav) => nav("gitlab", { gitlabProject: pid }),
    });
  }
  if (kind === "gitlab-issue" || kind === "gitlab-mr") {
    const [pid, iid, title] = dec(key);
    const projectId = Number(pid);
    const iidNum = Number(iid);
    if (!projectId || !iidNum) return null;
    const isIssue = kind === "gitlab-issue";
    return view({
      atom: ref, title: title || (isIssue ? "Issue" : i18n("state.atoms.dd42589239f7")),
      sub: "GitLab " + (isIssue ? "Issue" : i18n("state.atoms.dd42589239f7")), icon: isIssue ? IconPen : IconGitLab, group: "GitLab",
      open: (nav) => nav("gitlab", {
        gitlabProject: projectId,
        gitlabTab: isIssue ? "issues" : "mrs",
        gitlabKind: isIssue ? "issue" : "mr",
        gitlabIid: iidNum,
      }),
    });
  }
  if (kind === "news") {
    const [xxid, title, source] = dec(key);
    if (!xxid) return null;
    return view({
      atom: ref, title: title || i18n("state.atoms.d39567b2b9f1"), sub: source || i18n("state.atoms.6699d0be5ff8"), icon: IconExternal, group: "新闻",
      open: (nav) => nav("info", { infoNewsId: xxid }),
    });
  }
  if (kind === "washer-b") {
    const [id, name, hlsh, gname] = dec(key);
    const provider = washerProviderOf(hlsh);
    if (!id) return null;
    return view({
      atom: ref, title: name || i18n("state.atoms.762ef1dd111f"), sub: (gname ? gname + " · " : "") + WASHER_PROVIDER_LABEL[provider], icon: IconRefresh, group: "洗衣机",
      open: (nav) => nav("life", { lifeTab: "washer", washerBuildingId: id, washerBuildingName: name, washerBuildingProvider: washerProviderCode(provider) }),
    });
  }
  if (kind === "washer-m") {
    const [bId, bName, hlsh, dev] = dec(key);
    const provider = washerProviderOf(hlsh);
    if (!bId || !dev) return null;
    return view({
      atom: ref, title: dev, sub: (bName || "") + " · " + WASHER_PROVIDER_LABEL[provider], icon: IconRefresh, group: "洗衣机", defaultSq: true,
      tileLive: () => <WasherTileStatus atomKey={key} />,
      open: (nav) => nav("life", { lifeTab: "washer", washerBuildingId: bId, washerBuildingName: bName, washerBuildingProvider: washerProviderCode(provider), washerMachine: dev }),
    });
  }
  if (kind === "classroom-b") {
    const [searchName, name] = dec(key);
    if (!searchName) return null;
    return view({
      atom: ref, title: name || searchName, sub: i18n("state.atoms.2498d064346e"), icon: IconSearch, group: "空教室",
      open: (nav) => nav("reserve", { reserveTab: "classroom", classroomBuilding: searchName, classroomBuildingName: name }),
    });
  }
  if (kind === "classroom-r") {
    const [searchName, bName, room] = dec(key);
    if (!searchName || !room) return null;
    return view({
      atom: ref, title: room, sub: (bName || "") + i18n("state.atoms.02c6d939cacb"), icon: IconSearch, group: "空教室", defaultSq: true,
      tileLive: () => <ClassroomTileStatus atomKey={key} />,
      widget: () => <ClassroomRoomToday atomKey={key} />,
      open: (nav) => nav("reserve", { reserveTab: "classroom", classroomBuilding: searchName, classroomBuildingName: bName, classroomRoom: room }),
    });
  }
  if (kind === "sports-v") {
    const [uuid, name] = dec(key);
    if (!uuid) return null;
    return view({
      atom: ref, title: name || i18n("state.atoms.e00b99270be7"), sub: i18n("state.atoms.21c882a8b432"), icon: IconSchedule, group: "体育",
      open: (nav) => nav("reserve", { reserveTab: "sports", sportsScene: uuid }),
    });
  }
  if (kind === "libroom-k") {
    const [id, name] = dec(key);
    if (!id) return null;
    return view({
      atom: ref, title: name || i18n("state.atoms.e4d40b4d6759"), sub: i18n("state.atoms.64050df899dd"), icon: IconCalendar, group: "研讨间",
      open: (nav) => nav("reserve", { reserveTab: "room", libroomKind: Number(id) || undefined }),
    });
  }
  if (kind === "library") {
    const [id, name] = dec(key);
    if (!id) return null;
    return view({
      atom: ref, title: name || i18n("state.atoms.266e6cb77079"), sub: i18n("state.atoms.c7811f3d9d70"), icon: IconSchedule, group: "图书馆",
      open: (nav) => nav("reserve", { reserveTab: "lib", libraryId: Number(id) || undefined }),
    });
  }
  if (kind === "library-f") {
    const [libId, libName, fId, fName] = dec(key);
    if (!libId || !fId) return null;
    return view({
      atom: ref, title: fName || i18n("state.atoms.ce3b386bd714"), sub: (libName || "") + i18n("state.atoms.914722c592ca"), icon: IconSchedule, group: "图书馆",
      open: (nav) => nav("reserve", { reserveTab: "lib", libraryId: Number(libId) || undefined, libraryFloorId: Number(fId) || undefined }),
    });
  }
  if (kind === "library-a") {
    const [libId, libName, fId, fName, aId, aName] = dec(key);
    if (!libId || !fId || !aId) return null;
    return view({
      atom: ref, title: aName || i18n("state.atoms.3382870bc4ad"), sub: (libName || "") + (fName ? " · " + fName : "") + i18n("state.atoms.d648ae3059c3"), icon: IconSchedule, group: "图书馆",
      open: (nav) => nav("reserve", { reserveTab: "lib", libraryId: Number(libId) || undefined, libraryFloorId: Number(fId) || undefined, librarySectionId: Number(aId) || undefined }),
    });
  }
  if (kind === "kj-space") {
    const [id, name] = dec(key);
    if (!id) return null;
    return view({
      atom: ref, title: name || id, sub: i18n("state.atoms.0b2a360ee083"), icon: IconCalendar, group: "公共空间",
      open: (nav) => nav("reserve", { reserveTab: "kongjian", kongjianSpace: id }),
    });
  }
  if (kind === "kj-room") {
    const [spId, spName, rId, rName] = dec(key);
    if (!spId || !rId) return null;
    return view({
      atom: ref, title: rName || rId, sub: (spName || "") + i18n("state.atoms.a40906b8e7b9"), icon: IconCalendar, group: "公共空间",
      open: (nav) => nav("reserve", { reserveTab: "kongjian", kongjianSpace: spId, kongjianRoom: rId }),
    });
  }
  if (kind === "news-src") {
    const [name] = dec(key);
    if (!name) return null;
    return view({
      atom: ref, title: name, sub: i18n("state.atoms.70508e3eba69"), icon: IconExternal, group: "新闻",
      open: (nav) => nav("info", { infoTab: "news", newsSubSource: name }),
    });
  }
  if (kind === "infoapp") {
    const [cat, name, id] = dec(key);
    if (!id || !name) return null;
    return view({
      atom: ref, title: name, sub: (cat || i18n("state.atoms.d4f7864690bb")) + i18n("state.atoms.c94cd3fab151"), icon: IconExternal, group: "Info 应用",
      /* 门户拒绝内嵌（X-Frame-Options 实证）：点击直接系统浏览器打开漫游链 */
      open: () => void openExternal(infoAppUrl(id)),
    });
  }
  if (kind === "action") {
    const a = ACTION_ATOMS.find((x) => x.key === key);
    if (!a) return null;
    return view({
      atom: ref, title: a.title, sub: a.sub, icon: a.icon, group: a.group,
      open: () => {
        showToast(`${a.title}…`);
        void a.run().then(showToast).catch((e: unknown) => showToast(i18nMsg("state.atoms.7af0a2bf2e39", { value: String(e instanceof Error ? e.message : String(e)) })));
      },
    });
  }
  if (kind === "mail") {
    // 邮件实体原子（key = folder#uid；标题/发件人/时间取列表头缓存——收藏时已见过）
    const hi = key.lastIndexOf("#");
    if (hi <= 0) return null;
    const folder = key.slice(0, hi);
    const uid = Number(key.slice(hi + 1));
    if (!Number.isFinite(uid) || uid <= 0) return null;
    const h = getMailHead(folder, uid);
    if (!h) return null; // 缓存冷（清库/换机）：星标还在但不可解析——收藏夹渲染层会自然显示失效
    return view({
      atom: ref, title: h.subject, sub: `${h.from || i18n("state.atoms.51c306bd3174")} · ${new Date(h.dateMs).toLocaleString(getUiLocale(), { hour12: false })}`,
      icon: IconMail, group: "邮件",
      open: (nav) => nav("mail", { mailFolder: folder, mailUid: uid }),
    });
  }
  if (kind === "folder") {
    // 收藏夹跳转原子（用户拍板：收藏夹本身也要原子化——搜索/深链直达根夹与子夹；
    // 改名/删除在收藏夹页编辑模式，此处只是入口层跳转）
    const [id] = dec(key);
    if (!id) return null;
    const favs = loadFavs();
    const f = favs.folders[id];
    if (!f) return null;
    const parentOf = (fid: string): string | null => {
      for (const node of Object.values(favs.folders)) {
        if (node.items.some((it) => it.t === "f" && it.id === fid)) return node.id;
      }
      return null;
    };
    const path: string[] = [];
    let p = parentOf(id);
    let guard = 0;
    while (p && guard++ < FAVS_MAX_DEPTH) {
      const pn = favs.folders[p];
      if (!pn) break;
      path.unshift(pn.title);
      p = parentOf(p);
    }
    return view({
      atom: ref, title: f.title,
      sub: (path.length > 0 ? path.join(" / ") + " · " : "") + i18n("state.atoms.d66273bca391"),
      icon: IconFolder, group: "我的收藏夹",
      open: (nav) => nav("folder", { folderId: id }),
    });
  }
  if (kind === "courseX-c") {
    const [sem, cid, name, teacher, tl] = dec(key);
    if (!cid || !name) return null;
    const tls = tl ? tl.split("；") : [];
    return view({
      atom: ref, title: name, sub: (teacher ? teacher + " · " : "") + (tls.length > 0 ? tls.join("；") : i18n("state.atoms.3dcd26a9ba45")), icon: IconInfo, group: "courseX",
      open: (nav) => nav("info", { infoTab: "courseinfo" }),
    });
  }
  return null;
}

/* ══════════ 搜索（AtomPicker 数据源；只搜静态表 + 本机缓存） ══════════ */

export interface AtomHit extends AtomRef {
  title: string;
  sub?: string;
  group: string;
  icon: AtomIcon;
}

function hit(v: { atom: AtomRef; title: string; sub?: string; icon: AtomIcon; group: string }): AtomHit {
  return { ...v.atom, title: v.title, sub: v.sub, icon: v.icon, group: v.group };
}

/** 按关键词搜原子（标题/说明子串匹配，大小写不敏感；最多 limit 条） */
export function searchAtoms(query: string, limit = 24): AtomHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: AtomHit[] = [];
  const seen = new Set<string>();
  const push = (h: AtomHit | null) => {
    if (!h) return;
    const k = h.kind + "|" + h.key;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(h);
  };
  const match = (...fields: Array<string | undefined>) => fields.some((f) => (f ?? "").toLowerCase().includes(q));

  for (const s of PAGE_ATOMS) if (match(s.title, s.sub)) push(hit({ atom: { kind: s.kind, key: s.key }, title: s.title, sub: s.sub, icon: s.icon, group: s.group }));
  for (const a of ACTION_ATOMS) if (match(a.title, a.sub)) push(hit({ atom: { kind: a.kind, key: a.key }, title: a.title, sub: a.sub, icon: a.icon, group: a.group }));
  for (const w of WIDGET_ATOMS) if (match(w.title, w.sub)) push(hit({ atom: { kind: w.kind, key: w.key }, title: w.title, sub: w.sub, icon: w.icon, group: w.group }));

  // —— 动态：本机缓存里已见过的实体（campus 缓存 + noteAtomCache）——
  const campus = cacheGet<{ courses: Array<{ id: string; name: string; teacherName?: string }>; homework: Array<{ courseId: string; id: string; title: string; submitted: boolean }>; notifications: Array<{ courseId: string; id: string; title: string }>; files: Array<{ courseId: string; id: string; title: string }> }>("campus")?.data;
  if (campus) {
    for (const c of campus.courses ?? []) if (match(c.name, c.teacherName)) push(hit({ atom: { kind: "course", key: enc(c.id, c.name, c.teacherName) }, title: c.name, sub: i18n("state.atoms.60db1afb4022") + (c.teacherName ? " · " + c.teacherName : ""), icon: IconLearn, group: "网络学堂" }));
    for (const h of campus.homework ?? []) if (!h.submitted && match(h.title)) push(hit({ atom: { kind: "assignment", key: enc(h.courseId, h.id, h.title) }, title: h.title, sub: i18n("state.atoms.b0dff016ff17"), icon: IconPen, group: "网络学堂" }));
    for (const n of campus.notifications ?? []) if (match(n.title)) push(hit({ atom: { kind: "notice", key: enc(n.courseId, n.id, n.title) }, title: n.title, sub: i18n("state.atoms.f37a13fc55b3"), icon: IconBell, group: "网络学堂" }));
    for (const f of campus.files ?? []) if (match(f.title)) push(hit({ atom: { kind: "file", key: enc(f.courseId, f.id, f.title) }, title: f.title, sub: i18n("state.atoms.2bb745fb2e6f"), icon: IconFile, group: "网络学堂" }));
  }
  for (const b of dyn.washerGroups ?? []) if (match(b.name, b.gname)) push(hit({ atom: { kind: "washer-b", key: enc(b.id, b.name, b.provider ?? "0", b.gname) }, title: b.name, sub: b.gname, icon: IconRefresh, group: "洗衣机" }));
  for (const b of dyn.classroomBuildings ?? []) if (match(b.name)) push(hit({ atom: { kind: "classroom-b", key: enc(b.searchName, b.name) }, title: b.name, sub: i18n("state.atoms.5c8d010fd9a3"), icon: IconSearch, group: "空教室" }));
  for (const s of dyn.sportsScenes ?? []) if (match(s.name)) push(hit({ atom: { kind: "sports-v", key: enc(s.uuid, s.name) }, title: s.name, sub: i18n("state.atoms.e00b99270be7"), icon: IconSchedule, group: "体育" }));
  for (const n of dyn.newsItems ?? []) if (match(n.name, n.source)) push(hit({ atom: { kind: "news", key: enc(n.xxid, n.name, n.source) }, title: n.name, sub: n.source || i18n("state.atoms.6699d0be5ff8"), icon: IconExternal, group: "新闻" }));
  for (const k of dyn.libroomKinds ?? []) if (match(k.kindName)) push(hit({ atom: { kind: "libroom-k", key: enc(k.kindId, k.kindName) }, title: k.kindName, sub: i18n("state.atoms.e4d40b4d6759"), icon: IconCalendar, group: "研讨间" }));
  for (const l of dyn.libraries ?? []) if (match(l.name)) push(hit({ atom: { kind: "library", key: enc(l.id, l.name) }, title: l.name, sub: i18n("state.atoms.266e6cb77079"), icon: IconSchedule, group: "图书馆" }));
  for (const s of dyn.newsSources ?? []) if (match(s.name)) push(hit({ atom: { kind: "news-src", key: enc(s.name) }, title: s.name, sub: i18n("state.atoms.b22b34bd6f57"), icon: IconExternal, group: "新闻" }));
  for (const s of dyn.kjSpaces ?? []) if (match(s.name)) push(hit({ atom: { kind: "kj-space", key: enc(s.id, s.name) }, title: s.name, sub: i18n("state.atoms.e81059e1a712"), icon: IconCalendar, group: "公共空间" }));
  for (const r of dyn.kjRooms ?? []) if (match(r.name, r.spaceName)) push(hit({ atom: { kind: "kj-room", key: enc(r.spaceId, r.spaceName, r.id, r.name) }, title: r.name, sub: (r.spaceName || "") + i18n("state.atoms.aae558c4b8aa"), icon: IconCalendar, group: "公共空间" }));
  for (const c of dyn.courseXCourses ?? []) if (match(c.name, c.teacher)) push(hit({ atom: { kind: "courseX-c", key: enc(c.sem, c.id, c.name, c.teacher, "") }, title: c.name, sub: "courseX" + (c.teacher ? " · " + c.teacher : ""), icon: IconInfo, group: "courseX" }));
  for (const b of dyn.bbsBoards ?? []) if (match(b.name, b.courseName)) push(hit({ atom: { kind: "bbs-board", key: enc(b.courseId, b.bqid, b.name, b.courseName ?? "", b.sem ?? "") }, title: b.name, sub: (b.courseName ? b.courseName + " · " : "") + i18n("state.atoms.b80e3dfb7fba"), icon: IconLearn, group: "网络学堂" }));
  for (const t of dyn.bbsThreads ?? []) if (match(t.title, t.courseName)) push(hit({ atom: { kind: "forum", key: enc(t.courseId, t.id, t.bqid, t.title, t.courseName ?? "", t.sem ?? "") }, title: t.title, sub: (t.courseName ? t.courseName + " · " : "") + i18n("state.atoms.564f7a2748bb"), icon: IconLearn, group: "网络学堂" }));
  for (const a of INFO_APPS) if (match(a.name, a.cat)) push(hit({ atom: { kind: "infoapp", key: enc(a.cat, a.name, a.id) }, title: a.name, sub: a.cat + i18n("state.atoms.c94cd3fab151"), icon: IconExternal, group: "Info 应用" }));
  // 在线服务目录（ThosPage 打开过一次即入缓存）——OH「一句话打开亲友来访」即命中这里
  for (const s of dyn.thosServices ?? []) if (match(s.name, s.department)) push(hit({ atom: { kind: "thos-service", key: enc(s.id, s.name, s.department ?? "") }, title: s.name, sub: (s.department ? s.department + " · " : "") + i18n("state.atoms.1760b98532ec"), icon: IconThos, group: "在线服务" }));
  for (const p of dyn.gitlabProjects ?? []) if (match(p.name)) push(hit({ atom: { kind: "gitlab-proj", key: enc(p.id, p.name) }, title: p.name, sub: i18n("state.atoms.6aa71ddd8364"), icon: IconGitLab, group: "GitLab" }));
  for (const i of dyn.gitlabIssues ?? []) if (match(i.title)) push(hit({ atom: { kind: "gitlab-issue", key: enc(i.projectId, i.iid, i.title) }, title: i.title, sub: "GitLab Issue", icon: IconPen, group: "GitLab" }));
  for (const m of dyn.gitlabMergeRequests ?? []) if (match(m.title)) push(hit({ atom: { kind: "gitlab-mr", key: enc(m.projectId, m.iid, m.title) }, title: m.title, sub: i18n("state.atoms.e642c7fc3df2"), icon: IconGitLab, group: "GitLab" }));
  // 收藏夹跳转原子（全部夹：根 + 子，标题命中即出）
  for (const f of Object.values(loadFavs().folders)) if (match(f.title)) push(hit({ atom: { kind: "folder", key: f.id }, title: f.title, sub: i18n("state.atoms.855afaa70605"), icon: IconFolder, group: "我的收藏夹" }));

  return out.slice(0, limit);
}
