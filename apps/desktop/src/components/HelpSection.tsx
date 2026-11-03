import { t as i18n, useLocale as useUiLocale } from "../i18n/index.js";
import { replayOnboarding } from "./OnboardingTour.js";
import { Btn, SettingsRow } from "@onethu/gui";
/**
 * 使用帮助（§4.6）：按「我想做什么」组织，不做功能罗列。
 *
 * 条目只引用功能注册表（state/navigation.ts）的 id，跳转目标由注册表给出——
 * 帮助页不硬编码路由，功能改名、换页面时这里自动跟着走，不会变成又一份过期清单。
 * 注册表里没有的（比如"改通知"）走设置页签请求，同样不写死栏目序号。
 */
import type { ReactNode } from "react";
import { NAV_REGISTRY, type NavEntry } from "../state/navigation.js";
import { useApp } from "../state/context.js";
import { requestSettingsTab } from "../state/settingsMode.js";

const byId = new Map(NAV_REGISTRY.map((e) => [e.id, e]));

/** 一件事一行：标题是用户嘴里的话，按钮是注册表里的功能名 */
const TASKS: Array<{ title: string; desc: string; ids: string[]; settingsTab?: string }> = [
  {
    get title() { return i18n("components.helpsection.8b4f5f124179"); },
    get desc() { return i18n("components.helpsection.5ba6014f3e9c"); },
    ids: ["info-report", "info-exams"],
  },
  {
    get title() { return i18n("components.helpsection.09e7cf41dd47"); },
    get desc() { return i18n("components.helpsection.ebaa5fad9de2"); },
    ids: ["learn-assignments", "yuketang-homework", "oj-homework"],
  },
  {
    get title() { return i18n("components.helpsection.0478e4ba85fb"); },
    get desc() { return i18n("components.helpsection.bd78a657da8a"); },
    ids: ["life-electricity", "life-card"],
  },
  {
    get title() { return i18n("components.helpsection.f96e2a787c76"); },
    get desc() { return i18n("components.helpsection.cfab57dc28e1"); },
    ids: ["reserve-lib", "reserve-room", "reserve-sports"],
  },
  {
    get title() { return i18n("components.helpsection.abd9b1221963"); },
    get desc() { return i18n("components.helpsection.7e5d9d2915e9"); },
    ids: ["life-network"],
  },
  {
    get title() { return i18n("components.helpsection.0a9dea0904bb"); },
    get desc() { return i18n("components.helpsection.b8c8d955a2a8"); },
    ids: ["schedule", "mail"],
  },
  {
    get title() { return i18n("components.helpsection.31689de9b7b3"); },
    get desc() { return i18n("components.helpsection.faf8fc496688"); },
    ids: [],
    settingsTab: "通知",
  },
  {
    /* 2026-10-11 设置重构：桌面小组件从「通知与提醒」独立成栏，直达目标跟着换 */
    get title() { return i18n("components.helpsection.7a25374f5630"); },
    get desc() { return i18n("components.helpsection.9889374af97c"); },
    ids: [],
    settingsTab: "功能",
  },
];

/** 实用模式的设置页复用同一份帮助，只摘掉第一条「白板、暂存箱与组织怎么用？」——
 *  这三样在实用模式里本来就不出现，留着只会把人带去完整模式的导览。 */
export function HelpSection({ compact = false }: { compact?: boolean } = {}): ReactNode {
  const uiLocale = useUiLocale();

  const { navigate } = useApp();
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {compact ? null : <SettingsRow title={i18n("components.helpsection.5dadf7093a8f")} sub={`${i18n("components.helpsection.e4699249f613")} ${i18n("nfc.unstableNotice")}`} control={<Btn variant="outline" onClick={replayOnboarding}>{i18n("components.helpsection.eea78fdb74ce")}</Btn>}/>}
      {TASKS.map((task) => {
        const entries = task.ids
          .map((id) => byId.get(id))
          .filter((e): e is NavEntry => e !== undefined);
        return (
          <div key={task.title} className="setting-row" style={{ alignItems: "flex-start" }}>
            <div>
              <div className="setting-title">{task.title}</div>
              <div className="setting-desc">{task.desc}</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {entries.map((e) => (
                <button key={e.id} className="btn" onClick={() => navigate(e.page, e.params)}>
                  {e.name}
                </button>
              ))}
              {task.settingsTab ? (
                <Btn variant="outline" onClick={() => requestSettingsTab(task.settingsTab as string)}>{task.settingsTab}</Btn>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
