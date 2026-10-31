import { t as i18n, rich as i18nRich, msg as i18nMsg, useLocale as useUiLocale } from "../i18n/index.js";
import { LanguageControl } from "../components/LanguageControl.js";
import { ExperienceModeControl } from "../components/SimpleExperience.js";
import { Btn, IconBell, IconBook, IconDownload, IconHelpCircle, IconPalette, IconSun, IconWrench, IconUser, Inline, Input, List, Row, Segment, Select, SettingsList, SettingsRow, Stack, Tag, Text as OGText, TextArea } from "@onethu/gui";
import { defineSearchRows } from "../state/searchRows.js";
import {
  subscribeWallpaper,
  videoSoundSnapshot,
  setVideoSound,
  libraryItems,
  setWallpaperSlot,
  wallpaperDay,
  wallpaperNight,
} from "../state/wallpaper.js";
import { useExplorerState, allTabs } from "../state/explorer.js";
import { WallpaperLibrary } from "../components/explorer/WallpaperLibrary.js";
import { getGlassLevel, glassLevels, setGlassLevel, subscribeGlassLevel, type GlassLevel } from "../lib/glassLevel.js";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useIsPhone } from "../state/phoneSheets.js";
import { MobileLayoutChoice } from "../components/MobileLayoutChoice.js";
import { loadTabLayout, saveTabLayout, type TabLayout } from "../lib/tabLayout.js";
import type { ReactNode } from "react";
import { Card, SectionHead, Switch } from "../components/Layout.js";
import { setTabLayoutDefault, useTabLayoutDefault } from "../state/tabLayout.js";
import { SoftwareUpdateSection } from "../components/SoftwareUpdateSection.js";
import { ExtHwSettingsSection } from "../components/ExtHwSettingsSection.js";
import { TabManageModal } from "../components/TabManageModal.js";
import { NotifySettingsSection } from "../components/NotifySettingsSection.js";
import { WidgetSettingsSection } from "../components/WidgetSettingsSection.js";
import { OneShotSettings } from "../components/explorer/OneShot.js";
import { NameCardSection } from "../components/NameCardSection.js";
import { invoke } from "@tauri-apps/api/core";
import { showToast } from "../state/toast.js";
import { openUrl } from "@tauri-apps/plugin-opener";
import { clearRemembered, loadRemembered, session, isTauri } from "../lib/clients.js";
import { resetHomeBoard } from "../state/board.js";
import { useFavs } from "../state/favs.js";
import { activateTheme, deactivateTheme, setDayNightTheme, setFollowSystem, useThemes } from "../state/theme.js";
import { focusSettingsTarget } from "../components/Layout.js";
import { ExplorerPrefsSection } from "../components/ExplorerPrefsSection.js";
import { ThemeChoice } from "../components/ThemePickerModal.js";
import { consumeSettingsSectionRequest, consumeSettingsTabRequest, SETTINGS_TAB_ORDER, settingsLabel, settingsTabDescription, subscribeSettingsConsume } from "../state/settingsMode.js";
import { installedPlugins, subscribe as subscribePlugins } from "../plugins/loader.js";
import { requestPluginsView } from "./Plugins.js";
import { isThemeEntry } from "../lib/market.js";
import { ThemePickerModal } from "../components/ThemePickerModal.js";
import { PrivacySettings } from "../components/PrivacyNotice.js";
import { HelpSection } from "../components/HelpSection.js";
import { parseFavs, resetFavs } from "../state/favorites.js";
import { confirmOk } from "../lib/confirm.js";
import { useApp } from "../state/context.js";
import { displayStudentId } from "../lib/privacy.js";
import { CalendarSyncSettings } from "../components/CalendarSyncSettings.js";
import { APP_CODENAME, APP_VERSION_LABEL } from "../lib/update.js";
import { YktQrPanel, YktWebLoginPanel } from "../components/ExtHwLoginModal.js";
import { YKT_WEB_LOGIN_AVAILABLE } from "../lib/yktWebview.js";
import {
  disableDynamicColor,
  enableDynamicColor,
  fetchSystemPalette,
  isDynamicEnabled,
} from "../lib/dynamicColor.js";
import { subscribeThemes } from "../state/theme.js";
import {
  clearTuojAutoStatus,
  clearTycheLogoutSuppress,
  consumeExtHwScrollRequest,
  ensureExtHwCredsLoaded,
  extHwLogin,
  removeExtHwCreds,
  runYktSessionCheck,
  saveExtHwCreds,
  refreshExtHw,
  useExternalHomework,
} from "../state/exthw.js";
import { buildYktCookieExportJson, parseYktCookieExportJson, SOURCE_CATEGORY_NAMES, SOURCE_NAMES } from "@onethu/core";
import type { ExtHwCreds, ExtHwSourceId, TuojSourceId } from "@onethu/core";
import { ErrorLine } from "../components/Details.js";
import { downloadThreadChoices, readDownloadThreads, writeDownloadThreads } from "../lib/downloadPrefs.js";
import { resetActiveOnboarding } from "../state/onboarding.js";

/** Stable route metadata controls visibility; translated DOM text never selects a tab.
 * Keep every section mounted so switching categories or language preserves drafts. */
function SettingsGroup({ tab, active, section, children }: {
  tab: string; active: string; section: string; children: ReactNode;
}) {
  return <section data-settings-section={section} data-settings-tab={tab} data-set-id={`sec-${section}`} hidden={active !== tab}>
    {children}
  </section>;
}

/** 页签图标：与页签语义一一对应；左导航与页签管理都用同一份。 */
const SETTINGS_TAB_ICONS: Record<string, ReactNode> = {
  账号: <IconUser />,
  通知: <IconBell />,
  功能: <IconWrench />,
  外观: <IconPalette />,
  下载: <IconDownload />,
  帮助: <IconBook />,
  关于: <IconHelpCircle />,
};

/* ── task-19：设置页各分节的设置行注册（声明式；与页签一一对应）── */
defineSearchRows([
  { id: "set-theme-board", tab: "外观", section: "主题", get title() { return i18n("pages.settings.788db1cfec2a"); }, aliases: ["换主题", "配色", "主题板", "暗色", "夜间"], get desc() { return i18n("pages.settings.4a944ac462b1"); } , breadcrumb: ["设置", "外观", "主题", "主题"] },
  { id: "set-theme-install", tab: "外观", section: "主题", get title() { return i18n("pages.settings.c3abbc2eb455"); }, aliases: ["主题市场", "装主题"], get desc() { return i18n("pages.settings.0240f8fe7f39"); } , breadcrumb: ["设置", "外观", "主题", "安装主题"], go: () => requestPluginsView({ view: "market", category: "theme" }) },
  { id: "set-theme-manage", tab: "外观", section: "主题", get title() { return i18n("pages.settings.5aeb7a87addf"); }, aliases: ["启用主题", "停用主题"], get desc() { return i18n("pages.settings.47a5ccceaeca"); } , breadcrumb: ["设置", "外观", "主题", "管理主题"], go: () => requestPluginsView({ view: "mine", category: "theme" }) },
  { id: "set-theme-follow", tab: "外观", section: "主题", get title() { return i18n("pages.settings.b073567bc2e0"); }, aliases: ["昼夜", "白天主题", "黑夜主题", "自动切换"], get desc() { return i18n("pages.settings.590151cbdb54"); } , breadcrumb: ["设置", "外观", "主题", "跟随系统昼夜"] },
  { id: "set-appearance", tab: "外观", section: "外观", get title() { return i18n("pages.settings.86a63f23a076"); }, aliases: ["密度", "字号", "圆角", "主题色"], get desc() { return i18n("pages.settings.1cb7f269cc24"); } , breadcrumb: ["设置", "外观", "外观", "外观"] },
  { id: "set-wallpaper", tab: "外观", section: "外观", get title() { return i18n("pages.settings.bbaa9f06378b"); }, aliases: ["墙纸", "背景", "背景图", "动态壁纸", "上传壁纸", "壁纸库"], get desc() { return i18n("pages.settings.46ec3a81bd34"); } , breadcrumb: ["设置", "外观", "外观", "壁纸"] },
  { id: "set-wallpaper-sound", tab: "外观", section: "外观", get title() { return i18n("pages.settings.b34bc798190c"); }, aliases: ["视频壁纸声音", "壁纸静音"], get desc() { return i18n("pages.settings.4e66e6c598d5"); } , breadcrumb: ["设置", "外观", "外观", "动态壁纸声音"] },
  { id: "set-tabbar-style", tab: "外观", section: "外观", get title() { return i18n("pages.settings.1d08854948f4"); }, aliases: ["标签栏", "竖栏", "横栏", "标签栏默认"], get desc() { return i18n("pages.settings.a6514da1828c"); } , breadcrumb: ["设置", "外观", "外观", "标签栏样式"] },
  { id: "set-glass-level", tab: "外观", section: "外观", get title() { return i18n("pages.settings.865d7ae4c9e6"); }, aliases: ["玻璃", "材质", "毛玻璃", "透明", "透彻", "玻璃质感"], get desc() { return i18n("pages.settings.c85fea7bf89f"); } , breadcrumb: ["设置", "外观", "外观", "玻璃程度"] },
  { id: "set-dyn-color", tab: "外观", section: "外观", get title() { return i18n("pages.settings.3d5af6644ab2"); }, aliases: ["动态取色", "壁纸取色", "系统取色", "动态颜色"], get desc() { return i18n("pages.settings.3c23082caeac"); } , breadcrumb: ["设置", "外观", "外观", "跟随系统取色"] },
  { id: "set-capsule-tap", tab: "功能", section: "工作空间", get title() { return i18n("pages.settings.464f0207d4ff"); }, aliases: ["胶囊", "胶囊默认动作", "搜索与胶囊", "底栏胶囊"], get desc() { return i18n("pages.settings.1354e42a5f65"); } , breadcrumb: ["设置", "功能", "工作空间", "点击胶囊默认打开"] },
  { id: "set-search-history", tab: "功能", section: "工作空间", get title() { return i18n("pages.settings.461301d93770"); }, aliases: ["搜索历史", "清空搜索记录"], get desc() { return i18n("pages.settings.b953890db0b9"); } , breadcrumb: ["设置", "功能", "工作空间", "最近搜索记录"] },
  { id: "set-geek", tab: "功能", section: "极客模式", get title() { return i18n("pages.settings.53b5c5c16016"); }, aliases: ["极客", "探索浏览器", "playwright", "浏览器自动化"], get desc() { return i18n("pages.settings.931d5e245827"); } , breadcrumb: ["设置", "功能", "极客模式", "极客模式（浏览器探索）"] },
  { id: "set-geek-download", tab: "功能", section: "极客模式", get title() { return i18n("pages.settings.46195ccac72d"); }, aliases: ["playwright 下载", "下载浏览器", "浏览器环境"], get desc() { return i18n("pages.settings.4c2f3a5e0a01"); } , breadcrumb: ["设置", "功能", "极客模式", "探索浏览器环境"], landOn: { section: "极客模式", get note() { return i18n("pages.settings.52af44747494"); } } },
  { id: "set-home-layout", tab: "外观", section: "首页布局", get title() { return i18n("pages.settings.e7fd632d4dec"); }, aliases: ["首页", "卡片顺序"], get desc() { return i18n("pages.settings.853b03f039d3"); } , breadcrumb: ["设置", "外观", "首页布局", "首页布局"] },
  { id: "set-favs", tab: "功能", section: "收藏夹", get title() { return i18n("pages.settings.796d20e91588"); }, aliases: ["收藏", "导入收藏", "导出收藏"], get desc() { return i18n("pages.settings.da4f90828ea3"); } , breadcrumb: ["设置", "功能", "收藏夹", "收藏夹"] },
  { id: "set-cloud", tab: "账号", section: "云同步", get title() { return i18n("pages.settings.888977c201d1"); }, aliases: ["同步", "云盘同步", "备份"], get desc() { return i18n("pages.settings.02bd4c1bfaf2"); } , breadcrumb: ["设置", "账号", "云同步", "云同步"] },
  { id: "set-exthw", tab: "账号", section: "外部作业源", get title() { return i18n("pages.settings.d4d78d3b38d0"); }, aliases: ["作业源", "OJ", "课件"], get desc() { return i18n("pages.settings.ec7b5bd71b2c"); } , breadcrumb: ["设置", "账号", "外部作业源", "外部作业源"] },
  { id: "set-download", tab: "下载", section: "下载", get title() { return i18n("pages.settings.4673a2306165"); }, aliases: ["存储", "缓存", "清理"], get desc() { return i18n("pages.settings.44e3feed902f"); } , breadcrumb: ["设置", "下载", "下载", "下载"] },
  { id: "set-notify", tab: "通知", section: "通知", get title() { return i18n("pages.settings.4b6ded8a7f18"); }, aliases: ["提醒", "推送"], get desc() { return i18n("pages.settings.15047c91eb6c"); } , breadcrumb: ["设置", "通知", "通知", "通知"] },
  { id: "set-account", tab: "账号", section: "账号与绑定", get title() { return i18n("pages.settings.07812d003706"); }, aliases: ["登录", "学号", "绑定"], get desc() { return i18n("pages.settings.ee17e69edae5"); } , breadcrumb: ["设置", "账号", "账号与绑定", "账号与绑定"] },
  { id: "set-security", tab: "账号", section: "安全", get title() { return i18n("pages.settings.afb63a620bdc"); }, aliases: ["密码", "记住密码"], get desc() { return i18n("pages.settings.372fbc07354b"); } , breadcrumb: ["设置", "账号", "安全", "安全"] },
  { id: "set-about", tab: "关于", section: "关于", get title() { return i18n("pages.settings.52d25a9e30ba"); }, aliases: ["版本", "更新", "开源"], get desc() { return i18n("pages.settings.ccdb042ac3e2"); } , breadcrumb: ["设置", "关于", "关于", "关于"] },
  { id: "set-account-row", tab: "账号", section: "账户", get title() { return i18n("pages.settings.061246bd31e0"); }, aliases: ["已登录", "退出登录"], get desc() { return i18n("pages.settings.1ffc3a676204"); } , breadcrumb: ["设置", "账号", "账户", "账户"] },
  { id: "set-saved-pwd", tab: "账号", section: "安全", get title() { return i18n("pages.settings.b7d8cb31eeb8"); }, aliases: ["保存密码", "清除密码"], get desc() { return i18n("pages.settings.8f655a35cb99"); } , breadcrumb: ["设置", "账号", "安全", "记住的密码"] },
  { id: "set-tab-manage", tab: "功能", section: "功能", get title() { return i18n("pages.settings.12526376d387"); }, aliases: ["栏目显隐", "页签排序"], get desc() { return i18n("pages.settings.ba9385e7fd13"); } , breadcrumb: ["设置", "功能", "管理栏目", "管理栏目"] },
  { id: "set-tour", tab: "关于", section: "关于", get title() { return i18n("pages.settings.c8877a829fab"); }, aliases: ["重新运行引导", "新手引导"], get desc() { return i18n("pages.settings.06f03258229a"); } , breadcrumb: ["设置", "关于", "关于", "导览"] },
  { id: "set-update", tab: "关于", section: "关于", get title() { return i18n("pages.settings.b34d6b6c1193"); }, aliases: ["本体更新", "版本更新"], get desc() { return i18n("pages.settings.b07a37146f79"); } , breadcrumb: ["设置", "关于", "关于", "检查 OneTHU 更新"] },
  { id: "set-cloud-reconnect", tab: "账号", section: "云同步", get title() { return i18n("pages.settings.752d61201dda"); }, aliases: ["重新连接云盘", "token"], get desc() { return i18n("pages.settings.48b3252fa3bf"); } , breadcrumb: ["设置", "账号", "云同步", "云盘重连"], landOn: { section: "云同步", get note() { return i18n("pages.settings.4b7a59bc4d83"); } } },
  { id: "set-exthw-creds", tab: "账号", section: "外部作业源", get title() { return i18n("pages.settings.0d8ce603b616"); }, aliases: ["作业源凭据", "OJ 登录"], get desc() { return i18n("pages.settings.63c3e2b4bea1"); } , breadcrumb: ["设置", "账号", "外部作业源", "外部作业源登录"], landOn: { section: "外部作业源", get note() { return i18n("pages.settings.a52019e2a526"); } } },
  { id: "set-dl-dir", tab: "下载", section: "下载", get title() { return i18n("pages.settings.807f19bf853b"); }, aliases: ["缓存", "存储占用", "清理"], get desc() { return i18n("pages.settings.2cc0a2c950df"); } , breadcrumb: ["设置", "下载", "下载", "下载目录 / 缓存清理"], landOn: { section: "下载", get note() { return i18n("pages.settings.08a2cb9cf64f"); } } },
  { id: "set-help", tab: "帮助", section: "帮助", get title() { return i18n("pages.settings.a57cfcb8428d"); }, aliases: ["教程", "导览"], get desc() { return i18n("pages.settings.2e7fa452ef24"); } , breadcrumb: ["设置", "帮助", "帮助", "帮助"] },
]);

export function SettingsPage() {
  const uiLocale = useUiLocale();

  /** 当前二级页签（默认第一个栏目） */
  const [tab, setTab] = useState<string>(SETTINGS_TAB_ORDER[0] ?? "账号");
  /** 手机端判定：插件入口在「我的」页里也要有一份（与桌面侧栏同款框） */
  const settingsTabLayout: TabLayout = loadTabLayout("settings", SETTINGS_TAB_ORDER);
  const settingsTabHidden = settingsTabLayout.hidden;
  const [manageOpen, setManageOpen] = useState(false);
  const [tabLayout, setTabLayout] = useState<TabLayout>(() => settingsTabLayout);
  const applyTabLayout = (l: TabLayout): void => {
    setTabLayout(l);
    saveTabLayout("settings", l);
  };

  const settingsRef = useRef<HTMLDivElement>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consumePendingRequests = useCallback((): void => {
    const wantTab = consumeSettingsTabRequest();
    if (wantTab) setTab(wantTab);
    const wantSection = consumeSettingsSectionRequest();
    const externalHomework = consumeExtHwScrollRequest();
    if (externalHomework) setTab("账号");
    const target = wantSection ?? (externalHomework ? "外部作业源" : null);
    if (!target) return;
    if (focusTimer.current !== null) clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => {
      focusTimer.current = null;
      focusSettingsTarget(target, settingsRef.current ?? undefined);
    }, 160);
  }, []);
  useEffect(() => {
    consumePendingRequests();
    const unsubscribe = subscribeSettingsConsume(consumePendingRequests);
    return () => {
      unsubscribe();
      if (focusTimer.current !== null) clearTimeout(focusTimer.current);
    };
  }, [consumePendingRequests]);

  // Keep the selected category fully visible in the horizontal phone strip.
  useEffect(() => {
    const row = document.querySelector<HTMLElement>(".workbench-settings-tabs");
    const active = row?.querySelector<HTMLElement>("[aria-selected=true]");
    if (!row || !active || row.scrollWidth <= row.clientWidth) return;
    const r = row.getBoundingClientRect(), a = active.getBoundingClientRect();
    row.scrollLeft += a.left - r.left - (r.width - a.width) / 2;
  }, [tab]);

  const { user, logout, navigate } = useApp();
  const favs = useFavs();
  const [favMsg, setFavMsg] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [hasSaved, setHasSaved] = useState(false);
  const [clearing, setClearing] = useState(false);
  // 首页布局恢复：点击后短暂显示「已恢复默认」，到点回位
  const [homeResetAt, setHomeResetAt] = useState(0);
  const [eidMsg, setEidMsg] = useState<string | null>(null);
  useEffect(() => {
    void loadRemembered().then((r) => setHasSaved(!!r));
  }, []);

  useEffect(() => {
    if (!homeResetAt) return;
    const t = setTimeout(() => setHomeResetAt(0), 2400);
    return () => clearTimeout(t);
  }, [homeResetAt]);

  const onClear = async () => {
    setClearing(true);
    try {
      await clearRemembered();
      setHasSaved(false);
    } finally {
      setClearing(false);
    }
  };

  const isPhone = useIsPhone();
  const visibleSettingTabs = settingsTabLayout.order.filter((t) => SETTINGS_TAB_ORDER.includes(t) && !tabLayout.hidden.includes(t));

  return (
    <div className="workbench-settings" ref={settingsRef}>
      {/* 页头已移除（2026-10-24 用户定案）：设置页只剩标题栏 + 左导航 + 右内容。
          「导览 / 管理栏目」的功能暂时移入「关于」分节，后续再重新分类。 */}
      {/* 完整模式的续签/模型源都在 OH 高级配置里调，这里不再放模型源条（用户 2026-10-19 拍板） */}
      {isPhone ? (
        <div className="workbench-settings-phone-nav">
          <Select
            aria-label={i18n("pages.settings.92dd1d1f77db")}
            value={tab}
            options={visibleSettingTabs.map((t) => ({ value: t, label: settingsLabel(t) }))}
            onChange={setTab}
          />
        </div>
      ) : null}
      <div className="workbench-settings-layout">
      {isPhone ? null : <nav className="workbench-settings-nav" aria-label={i18n("pages.settings.92dd1d1f77db")}>
      <div className="workbench-settings-tabs" role="tablist" aria-label={i18n("pages.settings.92dd1d1f77db")} onKeyDown={event => {
        if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]"));
        const index = tabs.indexOf(event.target as HTMLButtonElement);
        if (index < 0) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
          : (index + (["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 1) + tabs.length) % tabs.length;
        tabs[next]?.focus(); tabs[next]?.click();
      }}>
        {visibleSettingTabs
          .map((t) => (
            <Btn
              key={t}
              role="tab"
              aria-selected={tab === t}
              aria-controls="workbench-settings-panel"
              tabIndex={tab === t ? 0 : -1}
              className={tab === t ? "is-active" : ""}
              onClick={() => setTab(t)}
            >
              <span className="workbench-settings-tab-icon" aria-hidden="true">{SETTINGS_TAB_ICONS[t] ?? null}</span>
              {settingsLabel(t)}
            </Btn>
          ))}
      </div>
      </nav>}
      <div className="workbench-settings-content" id="workbench-settings-panel" role="tabpanel" aria-label={settingsLabel(tab)}>
      <div className="workbench-settings-title"><h2>{settingsLabel(tab)}</h2><p>{settingsTabDescription(tab)}</p></div>
      <SettingsGroup tab="帮助" active={tab} section="帮助">
      <SectionHead id="row-set-help" title={i18n("pages.settings.a57cfcb8428d")} />
      <Card>
        <HelpSection />
      </Card>

      </SettingsGroup>
      <SettingsGroup tab="关于" active={tab} section="关于">
      <SectionHead id="row-set-about" title={i18n("pages.settings.52d25a9e30ba")} />
      <div data-set-id="row-set-update"><SoftwareUpdateSection /></div>
      <Card>
        <SettingsRow
          title={<>OneTHU {APP_VERSION_LABEL} “{APP_CODENAME}”</>}
          sub={i18n("pages.settings.05662029b925")}
          control={<Btn variant="outline" size="sm" onClick={() => void openUrl("https://github.com/smartThise/OneTHU")}>{i18n("pages.settings.8502353c15ac")}</Btn>}
        />
        {/* 运行日志导出属开发者功能：正式版不显示（真机取证走 adb logcat -s onethu:V，
            或改用开发者构建的右上角面板导出）。要恢复成正式版也显示，去掉这层门控即可。 */}
        {__ONETHU_DEV__ ? <DebugLogRow /> : null}
        <DiagnosticsRow />
        {/* 原页头按钮暂时归入「关于」（2026-10-24 用户要求，后续重新分类）。 */}
        <SettingsRow
          id="row-set-tour"
          title={i18n("pages.settings.c8877a829fab")}
          sub={i18n("pages.settings.06f03258229a")}
          control={<Btn variant="outline" size="sm" onClick={() => { resetActiveOnboarding(); location.reload(); }}>{i18n("pages.settings.c8877a829fab")}</Btn>}
        />
      </Card>

      </SettingsGroup>
      <SettingsGroup tab="账号" active={tab} section="账户">
      <SectionHead id="row-set-account-row" title={i18n("pages.settings.061246bd31e0")} />
      <Card>
        <SettingsRow
          title={i18n("pages.settings.99e398c6de5c")}
          sub={user?.displayName || displayStudentId(user?.username) || i18n("pages.settings.c1f658373079")}
          control={<Btn variant="outline" size="sm" onClick={() => void logout()}>{i18n("pages.settings.3ab8cc15939f")}</Btn>}
        />
      </Card>


      </SettingsGroup>
      <SettingsGroup tab="账号" active={tab} section="账号与绑定">
      <SectionHead id="row-set-account" title={i18n("pages.settings.07812d003706")} />
      <SettingsList>
        <SettingsRow
          title={i18n("pages.settings.c38372ef73d3")}
          sub={
            <>{i18n("pages.settings.05b2d326099e")}<b>{i18n("pages.settings.79a6fb7736ce")}</b>{i18nRich("pages.settings.c820e3820a04", { value: eidMsg ? <ErrorLine text={eidMsg} tone="quiet" /> : null })}</>
          }
          control={<Btn variant="outline" size="sm" onClick={() => {
              const creds = session.getIdCredentials();
              if (!creds) {
                void openUrl("https://id.tsinghua.edu.cn/do/outoflogin/login/mainUi/login")
                  .then(() => setEidMsg(i18n("pages.settings.3dc0bb7cf271")))
                  .catch((e: unknown) => setEidMsg(i18n("pages.settings.f2e2b5ad5926", { value: String(e instanceof Error ? e.message : String(e)) })));
                return;
              }
              const openInBrowser = () =>
                openUrl("https://id.tsinghua.edu.cn/do/outoflogin/login/mainUi/login")
                  .then(() => setEidMsg(i18n("pages.settings.7b994af5120a")))
                  .catch((e: unknown) => setEidMsg(i18n("pages.settings.f2e2b5ad5926", { value: String(e instanceof Error ? e.message : String(e)) })));
              void invoke("open_eid_window", { username: creds.username, password: creds.password })
                .then(() => setEidMsg(i18n("pages.settings.56a9e30d6963")))
                .catch(() => void openInBrowser());
            }}>{i18n("pages.settings.50efca8dcb36")}</Btn>
          }
        />
      </SettingsList>





      </SettingsGroup>
      <SettingsGroup tab="账号" active={tab} section="云同步">
      <SectionHead id="row-set-cloud" title={i18n("pages.settings.888977c201d1")} />
      <CalendarSyncSettings />
      </SettingsGroup>
      <SettingsGroup tab="账号" active={tab} section="外部作业源">
      <SectionHead id="row-set-exthw" title={i18n("pages.settings.d4d78d3b38d0")} />
      <ExtHwSettingsSection />

      </SettingsGroup>
      <SettingsGroup tab="下载" active={tab} section="下载">
      <DownloadSettings />

      </SettingsGroup>
      <SettingsGroup tab="外观" active={tab} section="首页布局">
      <SectionHead id="row-set-home-layout" title={i18n("pages.settings.e7fd632d4dec")} />
      <SettingsList>
        <SettingsRow
          title={i18n("pages.settings.188df41c178b")}
          sub={i18n("pages.settings.1d360021dfc2")}
          control={<Btn variant="outline" size="sm" onClick={() => { resetHomeBoard(); setHomeResetAt(Date.now()); }}>{homeResetAt ? i18n("pages.settings.b047bf296ada") : i18n("pages.settings.77ef57e1d1d3")}</Btn>}
        />
      </SettingsList>

      </SettingsGroup>
      <SettingsGroup tab="功能" active={tab} section="使用模式">
      <SectionHead id="row-set-mode" title={i18n("settings.label.mode")} />
      <ExperienceModeControl />
      </SettingsGroup>
      <SettingsGroup tab="功能" active={tab} section="语言">
      <SectionHead id="row-set-language" title={i18n("settings.label.language")} />
      <LanguageControl />
      </SettingsGroup>
      <SettingsGroup tab="功能" active={tab} section="管理栏目">
      <SectionHead id="row-set-tab-manage-sec" title={i18n("pages.settings.12526376d387")} />
      <Card>
        <SettingsRow
          id="row-set-tab-manage"
          title={i18n("pages.settings.12526376d387")}
          sub={i18n("pages.settings.fa0124c14866")}
          control={<Btn variant="outline" size="sm" onClick={() => setManageOpen(true)}>{i18n("pages.settings.12526376d387")}</Btn>}
        />
      </Card>
      </SettingsGroup>
      <SettingsGroup tab="功能" active={tab} section="工作空间">
      <SectionHead title={i18n("pages.settings.6fed7e860168")} />
      <ExplorerPrefsSection />

      </SettingsGroup>
      <SettingsGroup tab="功能" active={tab} section="收藏夹">
      <SectionHead id="row-set-favs" title={i18n("pages.settings.796d20e91588")} />
      <SettingsList>
        <SettingsRow
          title={i18n("pages.settings.7ea56ac4a13f")}
          sub={
            <>{i18nRich("pages.settings.c2c3d838b52c", { value: favMsg ? <>　{favMsg}</> : null })}</>
          }
          control={
            <Inline gap={2} wrap>
              <Btn variant="outline" onClick={() => {
                  const json = JSON.stringify(favs.data);
                  const clip = navigator.clipboard;
                  if (!clip?.writeText) {
                    setFavMsg(i18n("pages.settings.8c01e1c26f88"));
                    return;
                  }
                  void clip
                    .writeText(json)
                    .then(() => setFavMsg(i18n("pages.settings.fa7ee5600601") + favs.data.order.length + i18n("pages.settings.0e6d36a185c2")))
                    .catch(() => setFavMsg(i18n("pages.settings.376c845be416")));
                }}>{i18n("pages.settings.f9ee669dc9d6")}</Btn>
              <Btn variant="outline" onClick={() => { setImportOpen((o) => !o); setImportText(""); setFavMsg(null); }}>{i18n("pages.settings.576d81bb0631")}</Btn>
              <Btn variant="outline" onClick={() =>
                  void confirmOk(i18nMsg("pages.settings.636849c8095c")).then((ok) => {
                    if (!ok) return;
                    favs.replaceAll(resetFavs());
                    setFavMsg(i18n("pages.settings.7ec009b7a942"));
                  })
                }>{i18n("pages.settings.ba2e93e73037")}</Btn>
            </Inline>
          }
        />
        {importOpen ? (
          <div className="og-settings-row" style={{ alignItems: "stretch" }}>
            <span className="og-settings-row-main">
              <TextArea placeholder={i18n("pages.settings.d26529fe64b3")} value={importText} onChange={(value) => setImportText(value)} />
              <Inline gap={2}>
                <Btn variant="solid" tone="brand" disabled={!importText.trim()} onClick={() => {
                    const parsed = parseFavs(importText);
                    if (!parsed) {
                      setFavMsg(i18n("pages.settings.47fcb97b9b6b"));
                      return;
                    }
                    favs.replaceAll(parsed);
                    setImportOpen(false);
                    setImportText("");
                    setFavMsg(i18n("pages.settings.2a9010137d7b") + parsed.order.length + i18n("pages.settings.1f0f8de12177"));
                  }}>{i18n("pages.settings.d8ff71d6c093")}</Btn>
                <Btn variant="ghost" onClick={() => setImportOpen(false)}>{i18n("pages.settings.2cd0f3be8738")}</Btn>
              </Inline>
            </span>
          </div>
        ) : null}
      </SettingsList>

      </SettingsGroup>
      <SettingsGroup tab="外观" active={tab} section="外观">
      <SectionHead id="row-set-appearance" title={i18n("pages.settings.86a63f23a076")} />
      <SettingsList>
        <AppearanceSection />
      </SettingsList>
      <Card>
        <WallpaperSection />
      </Card>
      </SettingsGroup>
      <SettingsGroup tab="功能" active={tab} section="OneShot 快捷入口">
      {isPhone ? <MobileLayoutChoice/> : null}
      <SectionHead title={i18n("pages.settings.ac32447aadc3")} />
      <SettingsList>
        <OneShotSettings />
      </SettingsList>
      </SettingsGroup>
      <SettingsGroup tab="通知" active={tab} section="通知">
      <SectionHead id="row-set-notify" title={i18n("pages.settings.4b6ded8a7f18")} />
      <Card>
        <NotifySettingsSection />
      </Card>
      </SettingsGroup>
      <SettingsGroup tab="功能" active={tab} section="桌面小组件">
      <SectionHead id="row-widget-main" title={i18n("pages.settings.28b0433b1b95")} />
      <Card>
        <WidgetSettingsSection />
      </Card>
      </SettingsGroup>
      <SettingsGroup tab="功能" active={tab} section="极客模式">
      <SectionHead title={i18n("pages.settings.ef5a51b132b3")} />
      <GeekSection />
      {/* 2026-10-11（用户纠正）：OH **不是设置页的二级**，而是**插件页的二级子页面**
          （基础设置 / 高级配置）——分节与页签都已从这里移除，见 pages/Plugins.tsx 的 OH 入口。 */}
      </SettingsGroup>
      <SettingsGroup tab="账号" active={tab} section="安全">
      <PrivacySettings/>
      <SectionHead id="row-set-security" title={i18n("pages.settings.afb63a620bdc")} />
      <Card>
        <SettingsRow id="row-set-saved-pwd"
          title={i18n("pages.settings.b7d8cb31eeb8")}
          sub={hasSaved ? i18n("pages.settings.f5f631c6c63e") : i18n("pages.settings.92094cd0c4c7")}
          control={
            hasSaved ? (
              <Btn variant="outline" size="sm" disabled={clearing} onClick={() => void onClear()}>{clearing ? i18n("pages.settings.cd23a528a4cd") : i18n("pages.settings.bce2377283c2")}</Btn>
            ) : null
          }
        />
      </Card>
      </SettingsGroup>
      </div>
      </div>
      <TabManageModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        title={i18n("pages.settings.e60a5d5f84bc")}
        tabs={SETTINGS_TAB_ORDER.map((id) => ({ id, label: settingsLabel(id) }))}
        layout={tabLayout}
        onApply={applyTabLayout}
        onReset={() => applyTabLayout({ order: SETTINGS_TAB_ORDER, hidden: [] })}
      />

    </div>
  );
}

/* ── 下载位置（网络学堂附件与云盘文件落盘处）──
 * 桌面端：系统文件夹选择器 + 本机保存；Android：SAF 目录树（见 onethu-mobile 插件）。
 * 这里只做「读当前值 / 让用户改」，真正的落盘判断在原生侧（downloads.rs / 插件）。 */
type DownloadDirectory = { path: string; isDefault: boolean };

function DownloadSettings() {
  const uiLocale = useUiLocale();

  const [available, setAvailable] = useState(isTauri);
  const [directory, setDirectory] = useState<DownloadDirectory | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /* 多线程下载线程数：设备本地偏好，更新下载时由 SoftwareUpdateSection 读取并传给原生侧；
     后续附件/云盘下载可复用同一个 readDownloadThreads()。 */
  const [threads, setThreads] = useState<number>(() => readDownloadThreads());

  useEffect(() => {
    if (!available) return;
    let active = true;
    void invoke<DownloadDirectory | null>("download_directory_get")
      .then((value) => {
        if (!active) return;
        setDirectory(value);
        if (!value) setAvailable(false);   // 该平台不支持（如未接入的形态）：不显示这一块
      })
      .catch((e: unknown) => {
        if (active) setMessage(i18n("pages.settings.b5e1a19b3c87", { value: String(e instanceof Error ? e.message : String(e)) }));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [available]);

  const changeDirectory = async (reset: boolean): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      const value = await invoke<DownloadDirectory | null>(
        reset ? "download_directory_reset" : "download_directory_pick",
      );
      if (value) {
        setDirectory(value);
        setMessage(reset ? i18n("pages.settings.9c5584655501") : i18n("pages.settings.52de8e2d0c2c"));
      }
    } catch (e) {
      setMessage(i18n("pages.settings.2e2f517b4d18", { value: String(e instanceof Error ? e.message : String(e)) }));
    } finally {
      setBusy(false);
    }
  };

  if (!available) return null;
  return (
    <>
      <SectionHead id="row-set-download" title={i18n("pages.settings.4673a2306165")} />
      <Card>
        <SettingsRow
          title={i18n("pages.settings.12e704c78ced")}
          sub={
            <>
              {loading ? i18n("pages.settings.86b6d0d63062") : directory?.path || i18n("pages.settings.646c8247d71f")}
              <OGText slot="label" tone="faint">{i18n("pages.settings.66097d01fcac")}</OGText>
              {message ? <OGText slot="label" tone="quiet" as="span">{message}</OGText> : null}
            </>
          }
          control={
            <>
              <Btn variant="outline" size="sm" disabled={loading || busy} onClick={() => void changeDirectory(false)}>{i18n("pages.settings.0d6fad8138e7")}</Btn>
              <Btn variant="outline" size="sm" disabled={loading || busy || directory?.isDefault} onClick={() => void changeDirectory(true)}>{i18n("pages.settings.ba2e93e73037")}</Btn>
            </>
          }
        />
      </Card>
      <Card>
        <SettingsRow
          title={i18n("pages.settings.f28df1344b6a")}
          sub={i18n("pages.settings.93bf833076bf")}
          control={
            <Select
              value={String(threads)}
              aria-label={i18n("pages.settings.f28df1344b6a")}
              onChange={(value) => setThreads(writeDownloadThreads(value))}
              options={downloadThreadChoices().map((count) => ({ value: String(count), label: i18n("pages.settings.803fd2fd23f1", { value: String(count) }) }))}
            />
          }
        />
      </Card>
    </>
  );
}

/* ── 运行日志导出（真机问题取证：安卓日志落应用数据目录，一键转存系统下载）── */
function DebugLogRow() {
  const uiLocale = useUiLocale();

  const [busy, setBusy] = useState(false);
  const [where, setWhere] = useState<string | null>(null);
  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      const path = await invoke<string>("debug_log_export");
      setWhere(path);
      showToast(i18nMsg("pages.settings.e11c7e0889b4"));
    } catch (err) {
      showToast(String(err instanceof Error ? err.message : err).slice(0, 60));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsRow
      title={i18n("pages.settings.fc08fa260979")}
      sub={where ? i18n("pages.settings.212735f5be92", { where: String(where) }) : i18n("pages.settings.ce93302dab64")}
      control={<Btn variant="outline" size="sm" disabled={busy} onClick={() => void run()}>{busy ? i18n("pages.settings.dce6e572314e") : i18n("pages.settings.b8f32d284848")}</Btn>}
    />
  );
}

/* ── 诊断摘要（2026-09-23）：反馈问题时一键复制，用户不必交出运行日志 ── */
function DiagnosticsRow() {
  const uiLocale = useUiLocale();

  const [busy, setBusy] = useState(false);
  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      const { buildDiagnostics } = await import("../lib/diagnostics.js");
      await navigator.clipboard.writeText(await buildDiagnostics());
      showToast(i18nMsg("pages.settings.7f10cbe7fe17"));
    } catch (err) {
      showToast(String(err instanceof Error ? err.message : err).slice(0, 60));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsRow
      title={i18n("pages.settings.1cb15b820a0a")}
      sub={i18n("pages.settings.c1be461c4aa2")}
      control={<Btn variant="outline" size="sm" disabled={busy} onClick={() => void run()}>{busy ? i18n("pages.settings.43312083da55") : i18n("pages.settings.dfcf6a05ab29")}</Btn>}
    />
  );
}




/** 外观：昼夜主题调度——跟随系统暗/亮自动切日夜两档主题 */

/* ══════════ 壁纸（2026-10-14 定案：单一全屏档 + 壁纸库）══════════
   卡体 = 库面板（WallpaperLibrary panel）+ 动态壁纸声音开关：
   库网格（内置渐变 + 自收录）、点图=设为全屏、上传入库、删除、云盘同步/恢复
   （wallpsync）；「本页」档已随功能删除，壁纸只画在壳层、全窗共用。 */
function WallpaperSection(): ReactNode {
  const uiLocale = useUiLocale();

  const sound = useSyncExternalStore(subscribeWallpaper, videoSoundSnapshot, videoSoundSnapshot);
  return (
    <div className="wall-section" data-set-id="row-set-wallpaper">
      <div className="setting-title">{i18n("pages.settings.bbaa9f06378b")}</div>
      <div className="setting-desc">{i18n("pages.settings.1fa08e82bab2")}</div>
      <WallpaperLibrary variant="panel" />
      <div className="wall-sound-row" data-set-id="row-set-wallpaper-sound">
        <div>
          <div className="setting-title">{i18n("pages.settings.b34bc798190c")}</div>
          <div className="setting-desc">{i18n("pages.settings.a94d4e09776c")}</div>
        </div>
        <Switch on={sound} onChange={(v) => setVideoSound(v)} label={i18n("pages.settings.b34bc798190c")} />
      </div>
    </div>
  );
}

function AppearanceSection(): ReactNode {
  const uiLocale = useUiLocale();

  const snap = useThemes();
  const glass = useSyncExternalStore(subscribeGlassLevel, getGlassLevel, getGlassLevel);
  /* 跟随系统昼夜：白天/黑夜各自可指定一张背景（空 = 沿用常驻壁纸）。 */
  const wallSlots = useSyncExternalStore(subscribeWallpaper, () => `${wallpaperDay() ?? ""}|${wallpaperNight() ?? ""}`);
  const [wallDay = "", wallNight = ""] = wallSlots.split("|");
  const wallpaperOptions = [
    { value: "", label: i18n("settings.wallpaper.inherit") },
    ...libraryItems().map((item) => ({ value: item.ref, label: item.name })),
  ];
  /* 手机端（dev-explorer 二轮 A1）：手机只有横标签页——横/竖栏选项不渲染（TabDrawer 分段同款） */
  const isPhone = typeof document !== "undefined" && document.documentElement.classList.contains("is-phone");
  const tabLayoutDefault = useTabLayoutDefault();
  /* 动态取色（§3.4）：原生探活一次决定开关是否可用。
     桌面与 Android < 12 都返回"不可用"——此时开关置灰而不是隐藏，让用户知道原因。 */
  const [dyn, setDyn] = useState(isDynamicEnabled());
  const [dynOk, setDynOk] = useState<boolean | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    void fetchSystemPalette().then((p) => {
      if (alive) setDynOk(!!p && Object.keys(p).length > 0);
    });
    return () => {
      alive = false;
    };
  }, []);
  /* 开关状态只认 local 偏好这一个真源：enable/disable 之后重新读，任何分支（含降级到清华紫、
     抛错）都不会留下"主题变了但开关还是关的"这种说谎状态。 */
  const toggleDyn = async (): Promise<void> => {
    try {
      if (isDynamicEnabled()) disableDynamicColor();
      else await enableDynamicColor();
    } finally {
      setDyn(isDynamicEnabled());
    }
  };
  // 别处（设置 → 外观 的主题列表）切主题会让取色退场：开关跟着回真
  useEffect(() => subscribeThemes(() => setDyn(isDynamicEnabled())), []);
  /* ① 主题规范（2026-10-11 用户拍板）：「外观与布局 → 主题」**只做切换**，
     且**只列已启用的主题**——数据源＝插件系统里 category==="theme" 且 enabled 的插件；
     未启用插件带来的主题直接不显示（不灰置、不占位）。启用/停用在「插件」页里做。 */
  const { navigate } = useApp();
  const allPl = useSyncExternalStore(subscribePlugins, installedPlugins);
  const enabledThemeOwners = new Set(
    allPl
      .filter((p) => isThemeEntry(p.manifest as { category?: string; themes?: unknown }) && p.enabled)
      .map((p) => p.manifest.id),
  );
  const visibleThemeDefs = snap.themes.filter(
    (t) => !t.owner || enabledThemeOwners.has(t.owner) || enabledThemeOwners.has(t.id),
  );
  const themes = [{ id: "", name: i18n("pages.settings.78c3900fe08f") }, ...visibleThemeDefs.map((t) => ({ id: t.id, name: t.dark ? i18n("pages.settings.b3aa4945927f", { name: String(t.name) }) : t.name }))];
  return (
    <Stack gap={4}>
      {/* 标签栏默认样式：横版（顶部一排）｜竖版（左侧栏）；标签栏上的切换钮可随时改，这里定的是默认值。
          手机（A1）：手机只能横标签页（竖栏永不出现），这一行整块不渲染。 */}
      {isPhone ? null : (
        <SettingsRow id="row-set-tabbar-style"
          title={i18n("pages.settings.1d08854948f4")}
          sub={i18n("pages.settings.a614894c6a8c")}
          control={
            <Segment
              size="sm"
              value={tabLayoutDefault}
              onChange={(v) => setTabLayoutDefault(v as "h" | "v")}
              options={[
                { value: "h", label: i18n("pages.settings.f807a7b72a2c") },
                { value: "v", label: i18n("pages.settings.f3683b41fe52") },
              ]}
            />
          }
        />
      )}
      {/* 玻璃程度：全站玻璃面材浓度四档（clear/balanced/rich/deep → data-glass 覆盖块） */}
      <SettingsRow id="row-set-glass-level"
        title={i18n("pages.settings.865d7ae4c9e6")}
        sub={i18n("pages.settings.bc5c3d6b77d8")}
        control={
          <Segment
            size="sm"
            value={glass}
            onChange={(v) => setGlassLevel(v as GlassLevel)}
            options={glassLevels().map((g) => ({ value: g.id, label: g.label }))}
          />
        }
      />
      {/* 主题（① 2026-10-11 用户拍板）：这里**只做切换**，且**只列已启用**的主题（未启用插件的不出现）；
          启用/停用在「插件」里，安装主题走右边那个按钮（跳市场 + 自动筛「主题」）。 */}
      <SettingsRow id="row-set-theme-board"
        title={i18n("pages.settings.788db1cfec2a")}
        sub={
          <>{i18nRich("pages.settings.45ef9193979e", { value: themes.find((th) => (snap.effectiveId ?? "") === th.id)?.name ?? i18n("pages.settings.693f87cd2777"), value2: dyn ? i18n("pages.settings.2579560d6e3d") : "", value3: i18n("pages.settings.2457458b07b5") })}</>
        }
        control={
          <Inline gap={2}>
            {/* ③ 两个按钮并列、同一套胶囊口径：安装（市场 + 主题筛选）｜管理（主题插件的启用/停用） */}
            <Btn data-set-id="row-set-theme-install" variant="solid" tone="brand" titleAttr={i18n("pages.settings.ccea37f61ff9")} onClick={() => {
                requestPluginsView({ view: "market", category: "theme" });
              }}>{i18n("pages.settings.c3abbc2eb455")}</Btn>
            <Btn data-set-id="row-set-theme-manage" variant="solid" tone="brand" titleAttr={i18n("pages.settings.6b91ee3ad1f4")} onClick={() => {
                /* 启用/停用界面＝插件页「我的插件 + 主题筛选」：那里每张主题卡都有开关语义 */
                requestPluginsView({ view: "mine", category: "theme" });
              }}>{i18n("pages.settings.5aeb7a87addf")}</Btn>
          </Inline>
        }
      />
      {/* ③ 主题板**恢复成原来那套**（用户给的旧图样式：色卡 + 名称 + 使用中/社区胶囊 + 应用按钮），
          只按新规范过滤掉未启用的主题；排版与 ThemePickerModal 里的板子保持一致。
          2026-10-14：手写选中框（内联边框+底色）→ List/Row 的 selected 状态层 + Tag 胶囊。 */}
      <div className="theme-choice-grid">
        <ThemeChoice name={i18n("pages.settings.78c3900fe08f")} description={i18n("pages.settings.e0ad632058d7")} selected={!snap.effectiveId || snap.effectiveId === "onethu.theme.ivory"} onSelect={() => deactivateTheme()} themeId="onethu.theme.ivory" />
        {visibleThemeDefs.filter(t => t.id !== "onethu.theme.ivory").map(t => <ThemeChoice key={t.id} name={t.name} description={t.description} vars={t.vars} selected={snap.effectiveId === t.id} onSelect={() => { activateTheme(t.id); showToast(i18n("pages.settings.e9b593117599") + t.name + "」"); }} themeId={t.id} />)}
      </div>
      <SettingsRow id="row-set-theme-follow"
        title={i18n("pages.settings.b073567bc2e0")}
        sub={
          <>{i18nRich("pages.settings.1d6e1d3ecceb", { value: snap.followSystem ? <>{i18nRich("pages.settings.f5d889222af1", { value: snap.systemDark ? i18n("pages.settings.a6b75d068032") : i18n("pages.settings.aa0819dfc4d8") })}</> : null })}</>
        }
        control={<Switch on={snap.followSystem} onChange={() => setFollowSystem(!snap.followSystem)} label={i18n("pages.settings.b073567bc2e0")} />}
      />
      {snap.followSystem ? (
        <>
          <SettingsRow title={i18n("pages.settings.1eacd04cef79")} control={<Select value={snap.dayThemeId ?? ""} onChange={(value) => setDayNightTheme(value || null, snap.nightThemeId)} disabled={dyn}>{themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>} />
          <SettingsRow title={i18n("pages.settings.061d30212032")} control={<Select value={snap.nightThemeId ?? ""} onChange={(value) => setDayNightTheme(snap.dayThemeId, value || null)} disabled={dyn}>{themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>} />
          <SettingsRow
            title={i18n("settings.wallpaper.day")}
            sub={i18n("settings.wallpaper.dayDesc")}
            control={<Select value={wallDay} options={wallpaperOptions} onChange={(value) => setWallpaperSlot("day", value || null)} />}
          />
          <SettingsRow
            title={i18n("settings.wallpaper.night")}
            sub={i18n("settings.wallpaper.nightDesc")}
            control={<Select value={wallNight} options={wallpaperOptions} onChange={(value) => setWallpaperSlot("night", value || null)} />}
          />
        </>
      ) : null}
      <SettingsRow id="row-set-dyn-color"
        title={i18n("pages.settings.3d5af6644ab2")}
        sub={
          dynOk === false ? (
            dyn ? i18n("pages.settings.dfb8c7f65098") : i18n("pages.settings.25bd968a4ec3")
          ) : i18n("pages.settings.41efcb0b8b84")
        }
        control={<Switch on={dyn} onChange={() => void toggleDyn()} label={i18n("pages.settings.3d5af6644ab2")} />}
      />
      {dyn ? <OGText slot="label" tone="faint">{i18n("pages.settings.d0a6f0c08b1a")}</OGText> : null}
      <ThemePickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </Stack>
  );
}


/* ══ 极客模式：浏览器探索（2026-10-13 用户点名；桌面 Only；风险自负明示）══
   能力：探测/一键下载 playwright 浏览器、独立登录态 profile 启停；CDP 读写（探索&自做插件）
   由 OH 的 geek_* 工具承载，本节只管「模式开关 + 环境就绪 + 风险提示」。 */

function GeekSection(): ReactNode {
  const uiLocale = useUiLocale();

  const st = useExplorerState();
  const at = allTabs().find((t) => t.id === st.activeId) ?? null;
  void at;
  const [probe, setProbe] = useState<{ browsers: string[]; playwrightReady: boolean; profileReady: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem("onethu.geek.on") === "1";
    } catch {
      return false;
    }
  });
  /* hooks 全部声明在前：早返回（isPhone）之前不得再挂 hook（hook-order 门禁） */
  const [mode, setMode] = useState<"system" | "playwright">("system");
  const isPhone = typeof document !== "undefined" && document.documentElement.classList.contains("is-phone");
  const refresh = useCallback(() => {
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("geek_browser_probe"))
      .then((r: unknown) => setProbe(r as { browsers: string[]; playwrightReady: boolean; profileReady: boolean }))
      .catch(() => setProbe(null));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  if (isPhone) return null;
  const toggle = (): void => {
    const next = !on;
    try {
      localStorage.setItem("onethu.geek.on", next ? "1" : "0");
    } catch {
      /* 存不进就本次有效 */
    }
    setOn(next);
    if (next) showToast(i18nMsg("pages.settings.16ca6dbf3de4"));
  };
  const download = async (): Promise<void> => {
    setBusy("dl");
    setMsg(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const r = await invoke<string>("geek_playwright_install");
      setMsg(r || i18n("pages.settings.c1c79b63f418"));
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(null);
      refresh();
    }
  };
  const launch = async (): Promise<void> => {
    setBusy("launch");
    setMsg(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const r = await invoke<{ port?: number }>("geek_browser_launch", { mode });
      setMsg(r.port ? i18n("pages.settings.e389a150e32e", { port: String(r.port) }) : i18n("pages.settings.4ef6221d6213"));
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(null);
      refresh();
    }
  };
  return (
    <SettingsList>
      <SettingsRow id="row-set-geek"
        title={i18n("pages.settings.53b5c5c16016")}
        sub={
          <>{i18n("pages.settings.6f3d8aba2f3c")}<OGText as="div" slot="label" tone="error">{i18n("pages.settings.862754facf23")}</OGText>
          </>
        }
        control={<Switch on={on} onChange={toggle} label={i18n("pages.settings.ef5a51b132b3")} />}
      />
      {on ? (
        <SettingsRow
          title={i18n("pages.settings.3268a6b55d67")}
          sub={
            probe
              ? probe.browsers.length > 0
                ? i18n("pages.settings.1e4072e67ba7", { length: String(probe.browsers.length), value: String(probe.playwrightReady ? i18n("pages.settings.e2f12da7faa6") : i18n("pages.settings.dccec95b65e1")) })
                : i18n("pages.settings.4d85ccc9814b")
              : i18n("pages.settings.339da995c389")
          }
          control={
            <Inline gap={2}>
              <Btn variant="ghost" disabled={busy !== null} onClick={() => void download()}>{busy === "dl" ? i18n("pages.settings.bcc2333dc631") : i18n("pages.settings.c1fc27cebdd4")}</Btn>
              <Btn variant="outline" disabled={busy !== null || !probe} onClick={() => void launch()}>{busy === "launch" ? i18n("pages.settings.fc89857ef917") : i18n("pages.settings.f3b9d4390ccf")}</Btn>
            </Inline>
          }
        />
      ) : null}
      {on ? (
        <SettingsRow
          title={i18n("pages.settings.6afd0ae3a811")}
          sub={i18n("pages.settings.61bf6fa12002")}
          control={
            <Segment
              size="sm"
              value={mode}
              onChange={(v) => setMode(v as "system" | "playwright")}
              options={[{ value: "system", label: i18n("pages.settings.96f1584f9196") }, { value: "playwright", label: i18n("pages.settings.a770b8f58676") }]}
            />
          }
        />
      ) : null}
      {msg ? <OGText as="div" slot="label" tone="faint">{msg}</OGText> : null}
    </SettingsList>
  );
}
