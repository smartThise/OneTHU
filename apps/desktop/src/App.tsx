import { Shell } from "./components/Layout.js";
import { isAndroidNavigator } from "./lib/androidHost.js";
import { NotifyBridge } from "./components/NotifyBridge.js";
import { lazy, Suspense, useEffect } from "react";
import { FilePreviewHost } from "./components/FilePreview.js";
import { LoginPage, TwoFactorPage } from "./pages/Login.js";
import { OnboardingTour as OnboardingTourGate } from "./components/OnboardingTour.js";
import { useToastHost, hideToast } from "./state/toast.js";
import type { ReactNode } from "react";
import { BrandLogo } from "./components/Layout.js";
import { AppProvider } from "./state/app.js";
import { FavsProvider } from "./state/favs.js";
import { useApp } from "./state/context.js";
import { setNavBridge, setStatusBridge } from "./plugins/bridges.js";
import { ChatDock } from "./plugins/ChatDock.js";
import { GlobalOrb } from "./components/GlobalOrb.js";
import { refreshLearnDataSilently, startLearnAutoRefresh, stopLearnAutoRefresh } from "./state/data.js";
/* dev-explorer：标签页宿主 + explorer 导航语义（navigate 的实现转发到 explorer） */
import { TabHost } from "./components/explorer/TabHost.js";
import { explorerNavigate, initExplorerHashBridge, openTabFromBootHash } from "./state/explorer.js";
import { t as i18n, useLocale } from "./i18n/index.js";


/** OneGUI 画廊（?onegui-gallery=1）：dev 专用、免登录，用于组件与皮肤验收 */
const OneGUIGallery = import.meta.env.DEV ? lazy(() => import("./gallery/OneGUIGallery.js").then((m) => ({ default: m.OneGUIGallery }))) : null;

/** dev 视觉自检驱动（?explorer-preview=…）；正式版整块剥离 */
const ExplorerPreview = import.meta.env.DEV ? lazy(() => import("./components/explorer/ExplorerPreview.js")) : null;

/** 插件桥回填：每帧把 navigate/status 同步给插件门面（bridges 无任何反向依赖） */
function PluginBridge() {
  const { status, navigate } = useApp();
  setNavBridge((page, params) => navigate(page as never, params as never));
  setStatusBridge(() => status);
  return null;
}

function Routed() {
  const { status } = useApp();

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
  useEffect(() => {
    if (!isAndroidNavigator(typeof navigator !== "undefined" ? navigator : undefined)) return;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("ui_apply_insets"))
      .catch(() => undefined);
  }, []);

  // IM 通道装配（无后端主案）：登录就绪后按配置自动连接（App 常驻 = bot 在线）。
  useEffect(() => {
    if (status !== "ready") return;
    void import("./im/boot.js").then((m) => m.bootIm()).catch(() => undefined);
  }, [status]);

  // OH 记忆云盘同步 + 共享主对话同步 + 云盘自动连接（原样保留）
  useEffect(() => {
    if (status !== "ready") return;
    void import("./memory/sync.js").then((m) => m.memoryBootSync()).catch(() => undefined);
    void import("./im/sessionSync.js").then((m) => m.sessionBootSync()).catch(() => undefined);
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

  // Explorer hash 桥：外部深链/浏览器前进后退 → 开成独立标签页（本模块统一写 hash，
  // 自身写入经对账消费，不会误开标签页）。只注册一次。
  useEffect(() => initExplorerHashBridge(), []);
  // 启动深链：冷启动时 hash 里带着非首页目标 → 补开一个标签页
  useEffect(() => {
    openTabFromBootHash();
  }, []);

  // 悬浮球窗口：只出全局悬浮球（红线：这条路径绝不把主窗口拉到前台）
  if (IS_OVERLAY_WINDOW) return <GlobalOrb />;

  // OneGUI 画廊：开发期直接看组件矩阵（不走登录/标签页宿主）
  if (OneGUIGallery && new URLSearchParams(window.location.search).has("onegui-gallery")) {
    return (
      <Suspense fallback={null}>
        <OneGUIGallery />
      </Suspense>
    );
  }

  const body = (() => {
    if (status === "booting") {
      return (
        <div className="login-wrap">
          <BrandLogo size={40} />
          <div style={{ color: "var(--text-3)", fontSize: "var(--text-sm)", marginTop: 18 }}>{i18n("auto.App.1")}</div>
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
        {/* dev-explorer：所有标签页常驻挂载、display 切换；首页恒在 */}
        <TabHost />
      </Shell>
    );
  })();

  return (
    <>
      {body}
      <PluginBridge />
      <NotifyBridge />
      {(status === "ready") && <ChatDock />}
      {/* 首启导览（2026-10-19 起）：统一模式向导 OnboardingTour——先选极简/实用/完整，再按模式走课程（组件内部判是否首启） */}
      {status === "ready" ? <OnboardingTourGate /> : null}
      <FilePreviewHost />
      <ToastHost />
      {ExplorerPreview ? (
        <Suspense fallback={null}>
          <ExplorerPreview />
        </Suspense>
      ) : null}
    </>
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

// 悬浮球窗口：桌面悬浮窗 / 安卓系统悬浮层都以 index.html?window=overlay 装载本前端，
// 只渲染全局悬浮球，不装载主界面（也避免在后台窗口里跑登录/同步等重活）。
const IS_OVERLAY_WINDOW = typeof window !== "undefined"
  && new URLSearchParams(window.location.search).get("window") === "overlay";

export function App() {
  /* 语言切换：全量文案里大量是模块级 i18n()（不订阅 store），靠这里让整棵树重渲染一次。 */
  useLocale();
  return (
    <AppProvider>
      <FavsProvider>
        <Routed />
      </FavsProvider>
    </AppProvider>
  );
}
