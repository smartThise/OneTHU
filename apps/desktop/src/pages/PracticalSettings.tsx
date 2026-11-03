import { t as i18n, useLocale as useUiLocale } from "../i18n/index.js";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Btn, Select, SettingsList, SettingsRow } from "@onethu/gui";
import { Card, SectionHead, focusSettingsTarget } from "../components/Layout.js";
import { ExperienceModeControl } from "../components/SimpleExperience.js";
import { LanguageControl } from "../components/LanguageControl.js";
import { MobileLayoutChoice } from "../components/MobileLayoutChoice.js";
import { PrivacySettings } from "../components/PrivacyNotice.js";
import { CalendarSyncSettings } from "../components/CalendarSyncSettings.js";
import { ExtHwSettingsSection } from "../components/ExtHwSettingsSection.js";
import { NotifySettingsSection } from "../components/NotifySettingsSection.js";
import { WidgetSettingsSection } from "../components/WidgetSettingsSection.js";
import { HelpSection } from "../components/HelpSection.js";
import { SoftwareUpdateSection } from "../components/SoftwareUpdateSection.js";
import { ExplorerPrefsSection } from "../components/ExplorerPrefsSection.js";
import { useIsPhone } from "../state/phoneSheets.js";
import { resetActiveOnboarding } from "../state/onboarding.js";
import {
  consumeSettingsSectionRequest,
  consumeSettingsTabRequest,
  SETTINGS_TAB_ORDER,
  settingsLabel,
  settingsTabDescription,
  subscribeSettingsConsume,
} from "../state/settingsMode.js";
import {
  AccountRow,
  AppearanceSection,
  AppVersionRow,
  DiagnosticsRow,
  DownloadSettings,
  EidBindingRow,
  SavedPasswordRow,
  SETTINGS_TAB_ICONS,
  WallpaperSection,
} from "./Settings.js";

/**
 * 实用模式的设置页（2026-10-28 用户要求：另开一个界面，结构照搬完整模式的「个人设置」）。
 *
 * 为什么不用一份设置页加开关：完整模式的设置是 7 个页签 + 三栏几何，实用模式要的正是这套
 * 结构——而不是「把完整设置塞进简洁单页」。两者的差别只有内容清单，所以这里只做编排：
 * 每个分节都复用完整模式那一个实现（外观、壁纸、下载、账户、电子身份、记住的密码、版本、
 * 诊断、通知、小组件、外部作业源、帮助、云同步），不存在第二份控件逻辑。
 *
 * 刻意不做（完整模式独有，实用模式里没有对应对象）：
 *  · 首页布局（白板/OnePage）、OneShot 快捷入口、收藏夹（OneGO）、管理栏目（页签显隐）
 *  · 标签栏默认样式（实用模式没有标签页，AppearanceSection 内部按 practical 不渲染这一行）
 *  · 极客模式（用户明确不要）
 *  · 帮助的第一条（白板/暂存箱/组织导览，用户明确不要）
 * Harness 不在这里：它是设置浮层里的另一段，与完整模式共用同一个 OhSettingsPage。
 */

/** 与完整模式同款的分节容器：常驻挂载，只用 hidden 收放，切页签/切语言都不丢已填内容。 */
function Group({ tab, active, section, children }: {
  tab: string; active: string; section: string; children: ReactNode;
}) {
  return <section data-settings-section={section} data-settings-tab={tab} data-set-id={`sec-${section}`} hidden={active !== tab}>
    {children}
  </section>;
}

export function PracticalSettings(): ReactNode {
  const uiLocale = useUiLocale();

  const [tab, setTab] = useState<string>(SETTINGS_TAB_ORDER[0] ?? "账号");
  const isPhone = useIsPhone();
  const rootRef = useRef<HTMLDivElement>(null);
  const focusTimer = useRef<number | null>(null);

  /** 页面外的跳转请求（帮助里的「通知/功能」、OH 行、检索直达）落到对应页签 + 分节。 */
  const consumeRequests = useCallback((): void => {
    const wantTab = consumeSettingsTabRequest();
    if (wantTab && SETTINGS_TAB_ORDER.includes(wantTab)) setTab(wantTab);
    const wantSection = consumeSettingsSectionRequest();
    if (!wantSection) return;
    if (focusTimer.current !== null) window.clearTimeout(focusTimer.current);
    focusTimer.current = window.setTimeout(() => {
      focusTimer.current = null;
      focusSettingsTarget(wantSection, rootRef.current ?? undefined);
    }, 160);
  }, []);
  useEffect(() => {
    consumeRequests();
    const unsubscribe = subscribeSettingsConsume(consumeRequests);
    return () => {
      unsubscribe();
      if (focusTimer.current !== null) window.clearTimeout(focusTimer.current);
    };
  }, [consumeRequests]);

  // 手机横条：选中的页签滚进可视区（与完整模式同一套行为）。
  useEffect(() => {
    const row = document.querySelector<HTMLElement>(".practical-settings .workbench-settings-tabs");
    const active = row?.querySelector<HTMLElement>("[aria-selected=true]");
    if (!row || !active || row.scrollWidth <= row.clientWidth) return;
    const r = row.getBoundingClientRect(), a = active.getBoundingClientRect();
    row.scrollLeft += a.left - r.left - (r.width - a.width) / 2;
  }, [tab]);

  return (
    <div className="workbench-settings practical-settings" ref={rootRef}>
      {isPhone ? (
        <div className="workbench-settings-phone-nav">
          <Select
            aria-label={i18n("pages.settings.92dd1d1f77db")}
            value={tab}
            options={SETTINGS_TAB_ORDER.map((t) => ({ value: t, label: settingsLabel(t) }))}
            onChange={setTab}
          />
        </div>
      ) : null}
      <div className="workbench-settings-layout">
        {isPhone ? null : <nav className="workbench-settings-nav" aria-label={i18n("pages.settings.92dd1d1f77db")}>
          <div className="workbench-settings-tabs" role="tablist" aria-label={i18n("pages.settings.92dd1d1f77db")} onKeyDown={(event) => {
            if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]"));
            const index = tabs.indexOf(event.target as HTMLButtonElement);
            if (index < 0) return;
            event.preventDefault();
            const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
              : (index + (["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 1) + tabs.length) % tabs.length;
            tabs[next]?.focus(); tabs[next]?.click();
          }}>
            {SETTINGS_TAB_ORDER.map((t) => (
              <Btn
                key={t}
                role="tab"
                aria-selected={tab === t}
                aria-controls="practical-settings-panel"
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
        <div className="workbench-settings-content" id="practical-settings-panel" role="tabpanel" aria-label={settingsLabel(tab)}>
          <div className="workbench-settings-title"><h2>{settingsLabel(tab)}</h2><p>{
            /* 「外观 / 功能」的页签说明在完整模式里会提到首页布局、快捷入口与收藏夹，
               实用模式没有这三样，用一句只描述实际分节的说明，别让人去找不存在的东西。 */
            tab === "外观" ? i18n("settings.tab.desc.appearance.practical")
              : tab === "功能" ? i18n("settings.tab.desc.features.practical")
                : settingsTabDescription(tab)
          }</p></div>

          <Group tab="账号" active={tab} section="账户">
            <SectionHead id="row-set-account-row" title={i18n("pages.settings.061246bd31e0")} />
            <Card>
              <AccountRow />
            </Card>
          </Group>

          <Group tab="账号" active={tab} section="账号与绑定">
            <SectionHead id="row-set-account" title={i18n("pages.settings.07812d003706")} />
            <SettingsList>
              <EidBindingRow />
            </SettingsList>
          </Group>

          <Group tab="账号" active={tab} section="云同步">
            <SectionHead id="row-set-cloud" title={i18n("pages.settings.888977c201d1")} />
            <CalendarSyncSettings />
          </Group>

          <Group tab="账号" active={tab} section="外部作业源">
            <SectionHead id="row-set-exthw" title={i18n("pages.settings.d4d78d3b38d0")} />
            <ExtHwSettingsSection />
          </Group>

          <Group tab="账号" active={tab} section="安全">
            <PrivacySettings />
            <SectionHead id="row-set-security" title={i18n("pages.settings.afb63a620bdc")} />
            <Card>
              <SavedPasswordRow />
            </Card>
          </Group>

          <Group tab="通知" active={tab} section="通知">
            <SectionHead id="row-set-notify" title={i18n("pages.settings.4b6ded8a7f18")} />
            <Card>
              <NotifySettingsSection />
            </Card>
          </Group>

          <Group tab="功能" active={tab} section="使用模式">
            <SectionHead id="row-set-mode" title={i18n("settings.label.mode")} />
            <ExperienceModeControl />
          </Group>

          <Group tab="功能" active={tab} section="语言">
            <SectionHead id="row-set-language" title={i18n("settings.label.language")} />
            <LanguageControl />
          </Group>

          {isPhone ? (
            <Group tab="功能" active={tab} section="手机布局">
              <Card>
                <MobileLayoutChoice />
              </Card>
            </Group>
          ) : null}

          <Group tab="功能" active={tab} section="工作空间">
            <SectionHead title={i18n("pages.settings.6fed7e860168")} />
            {/* 实用模式没有 OneShot/标签页：「点击胶囊默认打开」那一行不进来，搜索记录照旧可清。 */}
            <ExplorerPrefsSection hideCapsule />
          </Group>

          <Group tab="功能" active={tab} section="桌面小组件">
            <SectionHead id="row-widget-main" title={i18n("pages.settings.28b0433b1b95")} />
            <Card>
              <WidgetSettingsSection />
            </Card>
          </Group>

          <Group tab="外观" active={tab} section="外观">
            <SectionHead id="row-set-appearance" title={i18n("pages.settings.86a63f23a076")} />
            <SettingsList>
              <AppearanceSection practical />
            </SettingsList>
            <Card>
              <WallpaperSection />
            </Card>
          </Group>

          <Group tab="下载" active={tab} section="下载">
            <DownloadSettings />
          </Group>

          <Group tab="帮助" active={tab} section="帮助">
            <SectionHead id="row-set-help" title={i18n("pages.settings.a57cfcb8428d")} />
            <Card>
              <HelpSection compact />
            </Card>
          </Group>

          <Group tab="关于" active={tab} section="关于">
            <SectionHead id="row-set-about" title={i18n("pages.settings.52d25a9e30ba")} />
            <div data-set-id="row-set-update"><SoftwareUpdateSection /></div>
            <Card>
              <AppVersionRow />
              <DiagnosticsRow />
              <SettingsRow
                id="row-set-tour"
                title={i18n("pages.settings.c8877a829fab")}
                sub={i18n("pages.settings.06f03258229a")}
                control={<Btn variant="outline" size="sm" onClick={() => { resetActiveOnboarding(); location.reload(); }}>{i18n("pages.settings.c8877a829fab")}</Btn>}
              />
            </Card>
          </Group>
        </div>
      </div>
    </div>
  );
}
