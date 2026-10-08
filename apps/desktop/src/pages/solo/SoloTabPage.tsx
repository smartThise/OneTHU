/**
 * G2：旧多 tab 页里的 23 个 tab 的**独立页**（薄壳，docs/ui-ux-polish-detailed.md §12 G2）。
 *
 * 由来：服务页点「成绩」原先进的是「信息」页再切到成绩页签——标题写着「信息」、页内还挂着
 * 8 个 tab；「校园卡」进的是「生活」页。本文件把 23 个 tab 各自立成一页：自己的标题、自己的
 * 路由（可深链）、没有 tab 条、返回键按 G1 在顶栏。
 *
 * 三条纪律：
 * - **薄壳不许复制 tab 实现**：这里只做「PageHead（自己的标题）+ 渲染既有 tab 组件 +
 *   把该 tab 需要的 navParams 透传」，实现全在原 tab 组件里；
 * - **手机分流只有一处**：`state/navigation.ts` 的 `NavEntry.soloPage` + `app.tsx` 的
 *   `navigate()` 判定档位（compact/medium 走独立页，expanded 走旧多 tab 页）；
 * - **旧页与旧深链原样保留**：手机上直接开 `#/info` 仍是旧多 tab 页；PC 侧栏同理。
 *
 * 收藏：菜单里的收藏星走既有页面原子（`pageAtomRef("info-report")` 这类），所以 PC 端在旧页
 * 收藏的、手机端在独立页收藏的，是同一颗原子——收藏夹里的入口两边都能开。
 */
import type { ReactNode } from "react";
import { PageHead } from "../../components/Layout.js";
import { usePageCollect } from "../../components/Collect.js";
import { pageAtomRef } from "../../state/atoms.js";
import type { PageMenuItem } from "../../state/pageChrome.js";
import type { LearnNav, Page } from "../../state/app.js";
import { useApp } from "../../state/context.js";
import { BackButton } from "../learn/shared.js";
import { ExamsTab } from "../info/ExamsTab.js";
import { NewsTab } from "../info/NewsTab.js";
import { ProfileTab } from "../info/ProfileTab.js";
import { ReportTab } from "../info/ReportTab.js";
import { FitnessTab } from "../info/FitnessTab.js";
import { EvaluationTab } from "../info/EvaluationTab.js";
import { CalendarTab } from "../info/CalendarTab.js";
import { CourseInfoTab } from "../info/CourseInfoTab.js";
import { CardTab } from "../info/CardTab.js";
import { DormTab } from "../info/DormTab.js";
import { WasherTab } from "../info/WasherTab.js";
import { HygieneTab } from "../info/HygieneTab.js";
import { InvoiceTab } from "../info/InvoiceTab.js";
import { PayrollTab } from "../info/PayrollTab.js";
import { GradIncomeTab } from "../info/GradIncomeTab.js";
import { NetworkTab } from "../info/NetworkTab.js";
import { LibraryTab } from "../info/LibraryTab.js";
import { LibRoomTab } from "../info/LibRoomTab.js";
import { ClassroomTab } from "../info/ClassroomTab.js";
import { VenueSportsTab } from "../info/VenueSportsTab.js";
import { KongjianTab } from "../info/KongjianTab.js";
import { XkFindSoloPage, XkManageSoloPage } from "../zhjwxk/Courses.js";

/** 23 个独立页的 id（与 Page 联合类型里的同名成员一一对应） */
export type SoloPage =
  | "grade" | "fitness" | "exams" | "evaluation" | "calendar" | "news" | "profile" | "course-info"
  | "dorm" | "washer" | "hygiene" | "campus-card" | "invoice" | "payroll" | "grad-income" | "campus-net"
  | "lib-seat" | "lib-room" | "classroom" | "sports" | "public-space"
  | "xk-find" | "xk-manage";

interface SoloTabSpec {
  /** 页面标题（= 顶栏标题 / PC 页内 h1；不再显示「信息」「生活」这类聚合页名） */
  title: string;
  /** 收藏用的既有页面原子 key（同一颗星，PC 旧页与手机独立页共用） */
  atom: string;
  /** 渲染既有 tab 组件（透传该 tab 需要的 navParams） */
  render: (nav: LearnNav | null) => ReactNode;
}

export const SOLO_TABS: Record<SoloPage, SoloTabSpec> = {
  /* —— 信息门户（8）—— */
  grade: { title: "成绩", atom: "info-report", render: () => <ReportTab /> },
  fitness: { title: "体测成绩", atom: "info-fitness", render: () => <FitnessTab /> },
  exams: { title: "考试", atom: "info-exams", render: () => <ExamsTab /> },
  evaluation: { title: "教学评估", atom: "info-evaluation", render: () => <EvaluationTab /> },
  calendar: { title: "校历", atom: "info-calendar", render: () => <CalendarTab /> },
  /* 新闻：详情/搜索直达参数与旧页同源（onConsume* 省略——独立页不需要清参数，
     详情留在本页上是期望行为） */
  news: {
    title: "新闻",
    atom: "info-news",
    render: (nav) => (
      <NewsTab newsId={nav?.infoNewsId ?? null} initialQuery={nav?.infoNewsQuery ?? null} deepSubSource={nav?.newsSubSource} />
    ),
  },
  profile: { title: "个人信息", atom: "info-profile", render: () => <ProfileTab /> },
  "course-info": { title: "课程信息", atom: "info-courseinfo", render: () => <CourseInfoTab /> },
  /* —— 生活（8）—— */
  dorm: { title: "宿舍", atom: "life-dorm", render: (nav) => <DormTab deepSection={nav?.dormSection} /> },
  washer: {
    title: "洗衣机",
    atom: "life-washer",
    render: (nav) => (
      <WasherTab
        deepBuildingId={nav?.washerBuildingId}
        deepBuildingName={nav?.washerBuildingName}
        deepProvider={nav?.washerBuildingProvider}
        deepHlsh={nav?.washerBuildingHlsh}
        deepMachine={nav?.washerMachine}
      />
    ),
  },
  hygiene: { title: "卫生成绩", atom: "life-hygiene", render: () => <HygieneTab /> },
  "campus-card": { title: "校园卡", atom: "life-card", render: () => <CardTab /> },
  invoice: { title: "电子发票", atom: "life-invoice", render: () => <InvoiceTab /> },
  payroll: { title: "银行代发", atom: "life-payroll", render: () => <PayrollTab /> },
  "grad-income": { title: "研究生收入", atom: "life-gradincome", render: () => <GradIncomeTab /> },
  "campus-net": { title: "校园网", atom: "life-network", render: () => <NetworkTab /> },
  /* —— 预约（5；「更多场馆」不提取，留在旧预约页）—— */
  "lib-seat": {
    title: "图书馆座位",
    atom: "reserve-lib",
    render: (nav) => <LibraryTab deepLib={nav?.libraryId} deepFloor={nav?.libraryFloorId} deepSection={nav?.librarySectionId} />,
  },
  "lib-room": { title: "研讨间", atom: "reserve-room", render: (nav) => <LibRoomTab deepKind={nav?.libroomKind} /> },
  classroom: {
    title: "空教室",
    atom: "reserve-classroom",
    render: (nav) => (
      <ClassroomTab deepBuilding={nav?.classroomBuilding} deepBuildingName={nav?.classroomBuildingName} deepRoom={nav?.classroomRoom} />
    ),
  },
  sports: { title: "体育预约", atom: "reserve-sports", render: (nav) => <VenueSportsTab deepScene={nav?.sportsScene} /> },
  "public-space": {
    title: "公共空间",
    atom: "reserve-kongjian",
    render: (nav) => <KongjianTab kongjianSpace={nav?.kongjianSpace} kongjianRoom={nav?.kongjianRoom} />,
  },
  /* —— 选课（2）—— */
  "xk-find": { title: "课程查找", atom: "xk-find", render: () => <XkFindSoloPage /> },
  "xk-manage": { title: "选课管理", atom: "xk-manage", render: () => <XkManageSoloPage /> },
};

/** 独立页 id 判定（App.tsx 路由与护栏共用一份清单） */
export function isSoloPage(page: Page): page is SoloPage {
  return Object.prototype.hasOwnProperty.call(SOLO_TABS, page);
}

/**
 * 独立页外壳：PageHead（自己的标题 + 收藏菜单）+ 既有 tab 组件。
 * 返回键按 G1 走顶栏；PC 页内的返回键在这里退化成「返回服务」（独立页没有多 tab 骨架，
 * 归属仍是原聚合页的底栏项）。
 */
export function SoloTabPage({ id }: { id: SoloPage }) {
  const spec = SOLO_TABS[id];
  const { navParams } = useApp();
  const collect = usePageCollect(pageAtomRef(spec.atom), spec.title);
  return (
    <>
      {collect.modal}
      <PageHead
        title={spec.title}
        back={<BackButton to="services" label="服务" />}
        menu={[collect.item].filter(Boolean) as PageMenuItem[]}
      />
      {spec.render(navParams)}
    </>
  );
}
