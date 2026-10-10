import { Shell, BrandLogo } from "./components/Layout.js";
import { isAndroidNavigator } from "./lib/androidHost.js";
import { NotifyBridge } from "./components/NotifyBridge.js";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FilePreviewHost } from "./components/FilePreview.js";
import { LearnPage } from "./pages/Learn.js";
import { AssignmentDetailPage } from "./pages/learn/AssignmentDetailPage.js";
import { YktAssignmentDetailPage } from "./pages/learn/YktAssignmentDetailPage.js";
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
import ThubookPage from "./pages/ThubookPage.js";
import { OnboardingTour } from "./components/OnboardingTour.js";
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
import { ThosPage } from "./pages/info/ThosPage.js";
import { ZhjwxkCoursesPage } from "./pages/zhjwxk/Courses.js";
import { FolderPage } from "./pages/FolderPage.js";
import { ServicesPage } from "./pages/ServicesPage.js";
import { TasksPage } from "./pages/TasksPage.js";
import { FavsHomePage } from "./pages/FavsHomePage.js";
import { AppProvider } from "./state/app.js";
import { FavsProvider } from "./state/favs.js";
import { useApp } from "./state/context.js";
import { setNavBridge, setStatusBridge } from "./plugins/bridges.js";
import { installedPlugins, subscribe } from "./plugins/loader.js";
import { getPluginTab, lastTabError, setTabRoot } from "./plugins/tabs.js";
import type { Page } from "./state/app.js";
import { ChatDock } from "./plugins/ChatDock.js";
import { refreshLearnDataSilently, startLearnAutoRefresh, stopLearnAutoRefresh } from "./state/data.js";
import { useNavDirection } from "./lib/motion.js";

/** 二级页（列表→详情、插件页）：转场走横向滑入，与顶层页签的纵向淡入区分开 */
function isSubPage(p: string): boolean {
  return p.startsWith("learn-") || p.startsWith("plugin:");
}

/** 插件桥回填：每帧把 navigate/status 同步给插件门面（bridges 无任何反向依赖） */
function PluginBridge() {
  const { status, navigate } = useApp();
  setNavBridge((page, params) => navigate(page as never, params as never));
  setStatusBridge(() => status);
  return null;
}

function Routed() {
  const { status, page } = useApp();
  // 转场方向（进详情=前进、回列表=后退）：只影响曲线，不影响任何状态语义
  const navDir = useNavDirection(page, isSubPage);

  // learnX 式后台更新：登录后每 30 分钟静默重拉 learn 数据（作业 DDL/提交状态
  // 变化 → 日历同步、灵动岛文案、挂载中的页面自动跟进）；启动 90 秒后先来一轮，
  // 不用等满 30 分钟，前台恢复即刷。
  useEffect(() => {
    if (status !== "ready") return;
    const kick = setTimeout(() => void refreshLearnDataSilently(), 90_000);
    startLearnAutoRefresh();
    return () => {
      clearTimeout(kick);
      stopLearnAutoRefresh();
    };
  }, [status]);

  // Android：把系统栏 inset 垫成内容 padding（启动一次即可，原生 listener 会跟随旋转/键盘）。
  // 为什么需要（2026-09-21）：wry 内部强制 edge-to-edge，而生成工程的 MainActivity 未必有
  // inset 处理——demo 版顶栏因此被状态栏压住，正式版恰好有手写补丁所以正常。能力入库后与
  // 生成工程无关：两条线、任何工程都对齐。
  useEffect(() => {
    if (!isAndroidNavigator(typeof navigator !== "undefined" ? navigator : undefined)) return;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("ui_apply_insets"))
      .catch(() => undefined);
  }, []);

  // IM 通道装配（无后端主案）：登录就绪后按配置自动连接（App 常驻 = bot 在线）。
  // 动态 import：未就绪时不加载协议代码（与 ChatDock 懒加载同习惯）。
  useEffect(() => {
    if (status !== "ready") return;
    void import("./im/boot.js").then((m) => m.bootIm()).catch(() => undefined);
  }, [status]);

  // OH 记忆云盘同步（OH-Memory 资料库，没有就建）：启动 pull + 本地新内容 push。
  // 云盘未连接时静默降级——本地记忆照常。
  useEffect(() => {
    if (status !== "ready") return;
    void import("./memory/sync.js").then((m) => m.memoryBootSync()).catch(() => undefined);
    // 共享主对话：云盘 pull（远端较新则恢复）+ push（本地新内容）——所有 IM 入口与
    // ChatDock 共用 active 会话，云盘让它跨设备（用户定案 2026-10-09）
    void import("./im/sessionSync.js").then((m) => m.sessionBootSync()).catch(() => undefined);
    // 云盘自动连接（2026-10-10 定案：静默直连链——checkSingle 自动确认 +
    // auth-token-by-session 只读取票，零窗口零输入；失败静默，云盘页/导览一键重试）
    void import("./state/seafileAuto.js")
      .then(async (m) => {
        const { getSeafileToken } = await import("./state/seafile.js");
        if (getSeafileToken()) return;
        const r = await m.silentConnectSeafile();
        if (r.ok) {
          const { showToast } = await import("./state/toast.js");
          showToast(`云盘已自动连接：${r.account?.name ?? ""}`);
        }
      })
      .catch(() => undefined);
  }, [status]);

  const body = (() => {
    if (status === "booting") {
      return (
        <div className="login-wrap">
          <BrandLogo size={40} />
          <div style={{ color: "var(--text-3)", fontSize: "var(--text-sm)", marginTop: 18 }}>正在恢复登录状态…</div>
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
        {/* local/anim-delight：切页转场。key=page 让容器重新挂载并播一次 CSS 进场；
            旧页直接卸载，不做快照叠加（整页快照交叉淡入会出现旧页残影，实测有闪烁）。 */}
        <div className="page-anim" key={page} data-page={page} data-dir={navDir} data-level={isSubPage(page) ? "sub" : undefined}>
          {page === "today" && <TodayPage />}
          {page === "learn" && <LearnPage />}
          {page === "schedule" && <SchedulePage />}
          {page === "mail" && <MailPage />}
          {page === "cloud" && <CloudPage />}
          {page === "thubook" && <ThubookPage />}
          {page === "trace" && <TracePage />}
          {page === "otherinfo" && <OtherInfoPage />}
          {page === "info" && <InfoPage />}
          {page === "life" && <LifePage />}
          {page === "reserve" && <ReservePage />}
          {page === "thos" && <ThosPage />}
          {page === "zhjwxk" && <ZhjwxkCoursesPage />}
          {page === "folder" && <FolderPage />}
          {page === "tasks" && <TasksPage />}
          {page === "services" && <ServicesPage />}
          {page === "favs" && <FavsHomePage />}
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
          {/* R20-B2：雨课堂作业原生只读详情页（移动端雨课堂条目直达；桌面亦可打开） */}
          {page === "learn-ykt-detail" && <YktAssignmentDetailPage />}
          {page.startsWith("plugin:") && <PluginTabHost pageKey={page} />}
        </div>
      </Shell>
    );
  })();

  return (
    <>
      {body}
      <PluginBridge />
      <NotifyBridge />
      {(status === "ready") && <ChatDock />}
      {status === "ready" ? <OnboardingTour /> : null}
      <FilePreviewHost />
      <ToastHost />
    </>
  );
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
        {tab ? <span className="plg-tab-src">来自插件 {tab.pluginId}</span> : null}
      </div>
      {failed ? <div className="plg-hint">{failed}</div> : null}
      <div ref={ref} className="plg-tab-root" data-pagekey={pageKey} />
    </div>
  );
}

/** 全局轻提示（原子操作反馈）：单条覆盖式，点按关闭；center 的是屏幕正中的强调提示。退出时先播淡出再卸载 */
function ToastHost(): ReactNode {
  const { msg, closing, center } = useToastHost();
  if (!msg) return null;
  return (
    <div
      className={"toast-host" + (center ? " is-center" : "") + (closing ? " is-closing" : "")}
      onClick={hideToast}
      role="status"
    >
      {msg}
    </div>
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
