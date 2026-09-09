import { Shell, BrandLogo } from "./components/Layout.js";
import { useEffect } from "react";
import { FilePreviewHost } from "./components/FilePreview.js";
import { LearnPage } from "./pages/Learn.js";
import { AssignmentDetailPage } from "./pages/learn/AssignmentDetailPage.js";
import { AssignmentsPage } from "./pages/learn/AssignmentsPage.js";
import { CourseDetailPage } from "./pages/learn/CourseDetailPage.js";
import { FileDetailPage } from "./pages/learn/FileDetailPage.js";
import { FilesPage } from "./pages/learn/FilesPage.js";
import { NoticeDetailPage } from "./pages/learn/NoticeDetailPage.js";
import { ForumThreadPage } from "./pages/learn/Forum.js";
import { NoticesPage } from "./pages/learn/NoticesPage.js";
import { SearchPage } from "./pages/learn/SearchPage.js";
import { SemesterSelectionPage } from "./pages/learn/SemesterSelectionPage.js";
import { LoginPage, TwoFactorPage } from "./pages/Login.js";
import { SchedulePage } from "./pages/Schedule.js";
import { MailPage } from "./pages/MailPage.js";
import CloudPage from "./pages/CloudPage.js";
import { useToastHost, hideToast } from "./state/toast.js";
import type { ReactNode } from "react";
import { TracePage } from "./pages/Trace.js";
import { SettingsPage } from "./pages/Settings.js";
import { PluginsPage } from "./pages/Plugins.js";
import { TodayPage } from "./pages/Today.js";
import { OtherInfoPage } from "./pages/OtherInfoPage.js";
import { InfoPage } from "./pages/info/InfoPage.js";
import { LifePage } from "./pages/info/LifePage.js";
import { ReservePage } from "./pages/info/ReservePage.js";
import { ZhjwxkCoursesPage } from "./pages/zhjwxk/Courses.js";
import { FolderPage } from "./pages/FolderPage.js";
import { AppProvider } from "./state/app.js";
import { FavsProvider } from "./state/favs.js";
import { useApp } from "./state/context.js";
import { setNavBridge, setStatusBridge } from "./plugins/bridges.js";
import { ChatDock } from "./plugins/ChatDock.js";
import { refreshLearnDataSilently, startLearnAutoRefresh, stopLearnAutoRefresh } from "./state/data.js";

/** 插件桥回填：每帧把 navigate/status 同步给插件门面（bridges 无任何反向依赖） */
function PluginBridge() {
  const { status, navigate } = useApp();
  setNavBridge((page, params) => navigate(page as never, params as never));
  setStatusBridge(() => status);
  return null;
}

function Routed() {
  const { status, page } = useApp();

  // learnX 式后台更新：登录后每 30 分钟静默重拉 learn 数据（作业 DDL/提交状态
  // 变化 → 日历同步、灵动岛文案、挂载中的页面自动跟进）；启动 90 秒后先来一轮，
  // 不用等满 30 分钟。demo 模式数据是静态的，不刷。
  useEffect(() => {
    if (status !== "ready") return;
    const kick = setTimeout(() => void refreshLearnDataSilently(), 90_000);
    startLearnAutoRefresh();
    return () => {
      clearTimeout(kick);
      stopLearnAutoRefresh();
    };
  }, [status]);

  const body = (() => {
    if (status === "booting") {
      return (
        <div className="login-wrap">
          <BrandLogo size={40} />
          <div style={{ color: "var(--ink-3)", fontSize: "var(--text-sm)", marginTop: 18 }}>正在恢复会话…</div>
        </div>
      );
    }

    if (status === "2fa") {
      return <TwoFactorPage />;
    }

    if (status === "logged-out" || status === "connecting") {
      return <LoginPage />;
    }

    return (
      <Shell>
        {page === "today" && <TodayPage />}
        {page === "learn" && <LearnPage />}
        {page === "schedule" && <SchedulePage />}
        {page === "mail" && <MailPage />}
        {page === "cloud" && <CloudPage />}
        {page === "trace" && <TracePage />}
        {page === "otherinfo" && <OtherInfoPage />}
        {page === "info" && <InfoPage />}
        {page === "life" && <LifePage />}
        {page === "reserve" && <ReservePage />}
        {page === "zhjwxk" && <ZhjwxkCoursesPage />}
        {page === "folder" && <FolderPage />}
        {page === "settings" && <SettingsPage />}
        {page === "plugins" && <PluginsPage />}
        {page === "learn-course" && <CourseDetailPage />}
        {page === "learn-assignments" && <AssignmentsPage />}
        {page === "learn-notices" && <NoticesPage />}
        {page === "learn-files" && <FilesPage />}
        {page === "learn-search" && <SearchPage />}
        {page === "learn-semester" && <SemesterSelectionPage />}
        {page === "learn-assignment-detail" && <AssignmentDetailPage />}
        {page === "learn-notice-detail" && <NoticeDetailPage />}
        {page === "learn-forum-thread" && <ForumThreadPage />}
        {page === "learn-file-detail" && <FileDetailPage />}
      </Shell>
    );
  })();

  return (
    <>
      {body}
      <PluginBridge />
      {(status === "ready" || status === "demo") && <ChatDock />}
      <FilePreviewHost />
      <ToastHost />
    </>
  );
}

/** 全局轻提示（原子操作反馈）：单条覆盖式，点按关闭 */
function ToastHost(): ReactNode {
  const msg = useToastHost();
  if (!msg) return null;
  return (
    <div className="toast-host" onClick={hideToast} role="status">{msg}</div>
  );
}

export function App() {
  return (
    <AppProvider>
      <FavsProvider>
        <Routed />
      </FavsProvider>
    </AppProvider>
  );
}
