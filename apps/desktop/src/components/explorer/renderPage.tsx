/**
 * 标签页内容渲染开关（dev-explorer）：从 App.tsx 原样抽出的一级/二级页 → 组件映射。
 * TabHost 给每个标签页一个常驻容器，页内导航时 key=page 重新挂载（保留原转场语义），
 * 切标签页时只切 display（工作上下文保留——React 组件状态与插件容器都活着）。
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Page } from "../../state/app.js";
import { LearnPage } from "../../pages/Learn.js";
import { AssignmentDetailPage } from "../../pages/learn/AssignmentDetailPage.js";
import { YktAssignmentDetailPage } from "../../pages/learn/YktAssignmentDetailPage.js";
import { YktCoursePage } from "../../pages/learn/YktCoursePage.js";
import { AssignmentsPage } from "../../pages/learn/AssignmentsPage.js";
import { CourseDetailPage } from "../../pages/learn/CourseDetailPage.js";
import { FileDetailPage } from "../../pages/learn/FileDetailPage.js";
import { FilesPage } from "../../pages/learn/FilesPage.js";
import { NoticeDetailPage } from "../../pages/learn/NoticeDetailPage.js";
import { ForumThreadPage } from "../../pages/learn/Forum.js";
import { NoticesPage } from "../../pages/learn/NoticesPage.js";
import { SearchPage } from "../../pages/learn/SearchPage.js";
import { SemesterSelectionPage } from "../../pages/learn/SemesterSelectionPage.js";
import { SchedulePage } from "../../pages/Schedule.js";
import { HomeTab } from "./HomeTab.js";
import { BoardListPage } from "../../pages/BoardListPage.js";
import { ContactsPage } from "../../pages/Contacts.js";
import { OrganizationPage } from "../../pages/Organization.js";
import { VaultPage } from "../vault/VaultPage.js";
import { OnePageSurface } from "../FreeBoard.js";
import { MailPage } from "../../pages/MailPage.js";
import CloudPage from "../../pages/CloudPage.js";
import GitLabPage from "../../pages/GitLabPage.js";
import ThubookPage from "../../pages/ThubookPage.js";
import { XiaodaPage } from "../../pages/xiaoda/XiaodaPage.js";
import { TracePage } from "../../pages/Trace.js";
import { SettingsPage } from "../../pages/Settings.js";
import { PluginsPage } from "../../pages/Plugins.js";
import { OtherInfoPage } from "../../pages/OtherInfoPage.js";
import { InfoPage } from "../../pages/info/InfoPage.js";
import { LifePage } from "../../pages/info/LifePage.js";
import { ReservePage } from "../../pages/info/ReservePage.js";
import { ThosPage } from "../../pages/info/ThosPage.js";
import { ZhjwxkCoursesPage } from "../../pages/zhjwxk/Courses.js";
import { FolderPage } from "../../pages/FolderPage.js";
import { ServicesPage } from "../../pages/ServicesPage.js";
import { TasksPage } from "../../pages/TasksPage.js";
import { FavsHomePage } from "../../pages/FavsHomePage.js";
import { installedPlugins, subscribe } from "../../plugins/loader.js";
import { getPluginTab, lastTabError, setTabRoot } from "../../plugins/tabs.js";
import { t as i18n } from "../../i18n/index.js";


/** 二级页（列表→详情、插件页）：转场走横向滑入，与顶层页签的纵向淡入区分开 */
export function isSubPage(p: string): boolean {
  return p.startsWith("learn-") || p.startsWith("plugin:");
}

/** 插件动态 tab 宿主：挂容器登记进 tabs.ts，插件经 ui.onTabReady/getTabRoot 拿 DOM 全权渲染。
 *  容器常驻（React 不销毁），仅切页时 display 切换——插件内部状态保留。 */
function PluginTabHost({ pageKey }: { pageKey: Page }): ReactNode {
  const plugins = useSyncExternalStore(subscribe, installedPlugins);
  const tab = getPluginTab(pageKey);
  const ref = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setFailed(null);
    const pluginId = tab?.pluginId ?? "";
    const rec = plugins.find((x) => x.manifest.id === pluginId);
    if (!tab || !rec) {
      setFailed("该插件 tab 所属插件未安装或已停用");
      setTabRoot(pageKey, null);
      return;
    }
    el.dataset.plg = pluginId;
    setTabRoot(pageKey, el);
    // 渲染回调异常时把错误显示在页面（插件回调被 tabs.ts 捕获，这里取最近错误）
    const t = window.setTimeout(() => {
      if (lastTabError.key === pageKey) setFailed(`插件渲染异常：${lastTabError.message}`);
    }, 50);
    return () => {
      window.clearTimeout(t);
      setTabRoot(pageKey, null);
    };
  }, [pageKey, tab?.pluginId, plugins]);
  const icon = tab?.iconSvg;
  return (
    <div className="page-body plg-tab-page">
      <div className="plg-tab-head">
        <span className="plg-svg-icon" dangerouslySetInnerHTML={{ __html: icon ?? "" }} />
        <b>{tab?.title ?? "插件页"}</b>
        {tab ? <span className="plg-tab-src">{i18n("auto.components.explorer.renderPage.1")}{tab.pluginId}</span> : null}
      </div>
      {failed ? <div className="plg-hint">{failed}</div> : null}
      <div ref={ref} className="plg-tab-root" data-pagekey={pageKey} />
    </div>
  );
}

/** 页面 → 组件（App.tsx 原映射，一字未改语义；settings/plugins 不再是标签页，
 *  这两个分支只为兜底——正常都会被 explorer 拦去设置浮层）。 */
export function renderPage(page: Page): ReactNode {
  switch (page) {
    case "homepage":
      /* 首页 = 与标签页首页同一块画布（2026-10-15 起 page id 就叫 home）。
         旧 case "today" 渲染的 TodayPage 已随"今日页"一起删除 —— 那条路只会让人以为
         还存在一张"今日页"，实际是旧的一套卡片页。 */
      return <HomeTab />;
    /* 白板（PR 55 原子收藏升级）：收藏夹列表页 + 某一块白板 */
    case "boards":
      return <BoardListPage />;
    case "contacts": return <ContactsPage />;
    case "org": return <OrganizationPage />;
    case "vault":
      return <VaultPage />;
    case "board":
      /* 一块 OnePage = 一块自由白板（与首页同一画布）；页面 id 与深链 #/board/<板 id> 不变 */
      return <OnePageSurface />;
    case "learn":
      return <LearnPage />;
    case "schedule":
      return <SchedulePage />;
    case "mail":
      return <MailPage />;
    case "cloud":
      return <CloudPage />;
    case "gitlab":
      return <GitLabPage />;
    case "thubook":
      return <ThubookPage />;
    case "xiaoda":
      return <XiaodaPage />;
    case "trace":
      return <TracePage />;
    case "otherinfo":
      return <OtherInfoPage />;
    case "info":
      return <InfoPage />;
    case "life":
      return <LifePage />;
    case "reserve":
      return <ReservePage />;
    case "thos":
      return <ThosPage />;
    case "zhjwxk":
      return <ZhjwxkCoursesPage />;
    case "folder":
      return <FolderPage />;
    case "tasks":
      return <TasksPage />;
    case "services":
      return <ServicesPage />;
    case "favs":
      return <FavsHomePage />;
    case "settings":
      return <SettingsPage />;
    case "plugins":
      return <PluginsPage />;
    case "learn-course":
      return <CourseDetailPage />;
    case "learn-assignments":
      return <AssignmentsPage />;
    case "learn-notices":
      return <NoticesPage />;
    case "learn-files":
      return <FilesPage />;
    case "learn-search":
      return <SearchPage />;
    case "learn-semester":
      return <SemesterSelectionPage />;
    case "learn-assignment-detail":
      return <AssignmentDetailPage />;
    case "learn-notice-detail":
      return <NoticeDetailPage />;
    case "learn-forum-thread":
      return <ForumThreadPage />;
    case "learn-file-detail":
      return <FileDetailPage />;
    case "learn-ykt-detail":
      return <YktAssignmentDetailPage />;
    case "learn-ykt-course":
      return <YktCoursePage />;
    default:
      if (page.startsWith("plugin:")) return <PluginTabHost pageKey={page} />;
      return <LearnPage />;
  }
}
