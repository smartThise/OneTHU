/**
 * 设置页「通知」区块：提醒开关、提前量、静默时段、权限状态与「试一下」。
 *
 * 设计口径：
 *   · 一切改动立即落盘并立刻重排（不等用户点保存）——提醒这类东西改了没生效最恼人；
 *   · 权限状态如实展示，不假装可用：macOS 未授权 / Android 精确闹钟被拒时把原因与
 *     去处理的方式写清楚（Android 14 起精确闹钟默认拒绝，这条是常态不是异常）；
 *   · 计划预览给出「即将提醒什么」，让用户能自证调度链真的在工作。
 */
import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Switch } from "./Layout.js";
import { loadNotifySettings, saveNotifySettings } from "../state/notifySettings.js";
import {
  cancelNotifications, fetchNotifyStatus, fetchPendingIds, openNotifySettings,
  scheduleNotifications, sendTestNotification, type NativeNotifyStatus,
} from "../state/notifyBridge.js";
import { fetchWidgetStatus } from "../state/widgetBridge.js";
import { notifyHint } from "../state/notifyStatus.js";
import { groupPluginNotifications } from "../state/notifyIds.js";
import { runNotifyDoctor, type DoctorReport } from "../state/notifyDoctor.js";
import { ensureNotifyRuntime } from "../state/notifySources.js";
import type { NotifyPlanItem, NotifySettings } from "../state/notifyPlan.js";
import { Btn, Select as OGSelect, SettingsRow, Switch as OGSwitch, Text } from "@onethu/gui";
import { t as i18n } from "../i18n/index.js";


/** 常用提前量（分钟）；0 = 不提醒课程 */
const CLASS_LEADS: Array<[number, string]> = [
  [0, "不提醒"],
  [5, "5 分钟"],
  [10, "10 分钟"],
  [15, "15 分钟"],
  [30, "30 分钟"],
];

/** 早报时刻候选；null = 关闭 */
const BRIEFING_OPTIONS: Array<[string | null, string]> = [
  [null, "关闭"],
  ["07:00", "07:00"],
  ["07:30", "07:30"],
  ["08:00", "08:00"],
  ["12:00", "12:00"],
];

const QUIET_FROM = ["21:00", "22:00", "23:00", "00:00"];
const QUIET_TO = ["06:00", "07:00", "08:00", "09:00"];

function fmtAt(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  const today = new Date();
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  return `${sameDay ? "今天" : `${d.getMonth() + 1}/${d.getDate()}`} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function NotifySettingsSection(): ReactNode {
  const [s, setS] = useState<NotifySettings>(() => loadNotifySettings());
  const [status, setStatus] = useState<NativeNotifyStatus | null>(null);
  const [plan, setPlan] = useState<NotifyPlanItem[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<DoctorReport | null>(null);
  /** 插件排下的待投递通知（按插件归组）：用户能看见、能撤 */
  const [pluginNotifs, setPluginNotifs] = useState<Array<{ pluginId: string; ids: string[] }>>([]);

  const patch = (p: Partial<NotifySettings>): void => {
    const next = saveNotifySettings(p);
    setS(next);
    // 开启提醒时顺带请求授权（此时用户意图明确，弹框不唐突）
    if (p.enabled === true) void refreshStatus(true);
    // 改动即重排：关掉总开关时运行时内部会「撤干净」而不是留着旧排程
    void (async () => {
      const rt = await ensureNotifyRuntime();
      const r = await rt.syncNow();
      setPlan(rt.plan());
      setMsg(r.error ? `重排失败：${r.error}` : `已更新（排程 ${r.scheduled} 条 / 撤销 ${r.cancelled} 条）`);
    })();
  };

  /** 只查状态（request=false）：首次打开设置页不该弹系统授权框 */
  const refreshStatus = async (request = false): Promise<void> => {
    setStatus(await fetchNotifyStatus(request));
  };

  const refreshPluginNotifs = async (): Promise<void> => {
    setPluginNotifs(groupPluginNotifications(await fetchPendingIds()));
  };

  useEffect(() => {
    void refreshStatus();
    void refreshPluginNotifs();
    void (async () => {
      const rt = await ensureNotifyRuntime();
      await rt.syncNow();
      setPlan(rt.plan());
    })().catch(() => undefined);
  }, []);

  const onTest = async (): Promise<void> => {
    setBusy(true);
    try {
      // 测试即用户主动行为：先补一次授权请求（未授权时会弹系统框）
      const st = await fetchNotifyStatus(true);
      setStatus(st);
      const sent = await sendTestNotification();
      setMsg(sent ? "测试通知已发送；未收到请检查系统通知设置" : `测试失败：${st.granted ? "投递失败，请运行诊断查看原因" : "通知权限未开启，请在系统设置中打开"}`);
    } catch (e) {
      setMsg(`测试失败：${String(e).slice(0, 80)}`);
    } finally {
      setBusy(false);
    }
  };

  const hint = notifyHint({
    backend: status?.backend ?? "none",
    granted: status?.granted === true,
    exact: status?.exact !== false,
  });

  /** 一键自检：逐层探（后端/授权/精确提醒/小组件/排程回读/真实投递），给出可贴回的结论 */
  const onDiagnose = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await runNotifyDoctor({
        status: fetchNotifyStatus,
        scheduleProbe: (probe) => scheduleNotifications([{ ...probe, channel: "briefing", target: "" }]),
        pending: fetchPendingIds,
        cancel: cancelNotifications,
        testSend: sendTestNotification,
        widgetStatus: fetchWidgetStatus,
      });
      setReport(r);
      setMsg(null);
      // R21：诊断即刷新状态——此前「自检」与「重新检测」两个按钮语义重叠
      void refreshStatus();
      void refreshPluginNotifs();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SettingsRow
        title={i18n("auto.components.NotifySettingsSection.1")}
        sub={i18n("auto.components.NotifySettingsSection.2")}
        control={<OGSwitch checked={s.enabled} onChange={(v) => patch({ enabled: v })} aria-label={i18n("auto.components.NotifySettingsSection.3")} />}
      />

      {s.enabled ? (
      <>
      <SettingsRow
        title={i18n("auto.components.NotifySettingsSection.4")}
        sub={i18n("auto.components.NotifySettingsSection.5")}
        control={
          <OGSelect
            size="sm"
            value={String(s.classLead)}
            onChange={(v) => patch({ classLead: Number(v) })}
            options={CLASS_LEADS.map(([v, label]) => ({ value: String(v), label }))}
          />
        }
      />

      <SettingsRow
        title={i18n("auto.components.NotifySettingsSection.6")}
        sub={i18n("auto.components.NotifySettingsSection.7")}
        control={<OGSwitch checked={s.ddl} onChange={(v) => patch({ ddl: v })} aria-label={i18n("auto.components.NotifySettingsSection.6")} />}
      />

      <SettingsRow
        title={i18n("auto.components.NotifySettingsSection.8")}
        sub={i18n("auto.components.NotifySettingsSection.9")}
        control={
          <OGSelect
            size="sm"
            value={s.briefingAt ?? ""}
            onChange={(v) => patch({ briefingAt: v === "" ? null : v })}
            options={BRIEFING_OPTIONS.map(([v, label]) => ({ value: v ?? "", label }))}
          />
        }
      />

      <div className="setting-row">
        <div>
          <div className="setting-title">{i18n("auto.components.NotifySettingsSection.10")}</div>
          <div className="setting-desc">{i18n("auto.components.NotifySettingsSection.11")}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <OGSelect size="sm" value={s.quietFrom} onChange={(v) => patch({ quietFrom: v })} options={QUIET_FROM.map((v) => ({ value: v, label: v }))} />
          <Text slot="label" tone="faint">—</Text>
          <OGSelect size="sm" value={s.quietTo} onChange={(v) => patch({ quietTo: v })} options={QUIET_TO.map((v) => ({ value: v, label: v }))} />

        </div>
      </div>
      </>
      ) : null}

      <SettingsRow
        title={i18n("auto.components.NotifySettingsSection.12")}
        sub={
          status === null
            ? "检测中…"
            : hint.level === "error"
              ? <Text slot="label" tone="error">{hint.text}</Text>
              : hint.text
        }
        control={
          <>
            <Btn variant="outline" size="sm" disabled={busy || status?.backend === "none"} onClick={() => void onTest()}>
              {i18n("auto.components.NotifySettingsSection.13")}</Btn>
            <Btn variant="ghost" size="sm" disabled={busy} titleAttr={i18n("auto.components.NotifySettingsSection.14")} onClick={() => void onDiagnose()}>
              {busy ? "检查中…" : "诊断"}
            </Btn>
            {hint.action ? (
              <Btn
                variant="ghost"
                size="sm"
                titleAttr={`打开：${hint.action.label}`}
                onClick={() => {
                  void openNotifySettings(hint.action!.kind).then((okOpen) => {
                    if (!okOpen) setMsg(i18n("auto.components.NotifySettingsSection.msg1"));
                  });
                }}
              >
                {hint.action.label}
              </Btn>
            ) : null}
          </>
        }
      />

      {pluginNotifs.length > 0 ? (
      <SettingsRow
        title={i18n("auto.components.NotifySettingsSection.15")}
        sub={
          <>
            {pluginNotifs.map((g) => `${g.pluginId}（${g.ids.length} 条）`).join("；")}
            <Text slot="label" tone="faint">　{i18n("auto.components.NotifySettingsSection.16")}</Text>
          </>
        }
        control={
          <>
            <Btn variant="ghost" size="sm" onClick={() => void refreshPluginNotifs()}>{i18n("auto.components.NotifySettingsSection.17")}</Btn>
            <Btn
              variant="ghost"
              tone="error"
              size="sm"
              onClick={() => {
                const all = pluginNotifs.flatMap((g) => g.ids);
                void cancelNotifications(all).then(() => {
                  setMsg(`已撤销 ${all.length} 条插件通知`);
                  return refreshPluginNotifs();
                });
              }}
            >
              {i18n("auto.components.NotifySettingsSection.18")}</Btn>
          </>
        }
      />
      ) : null}

      {s.enabled ? (
      <SettingsRow
        title={i18n("auto.components.NotifySettingsSection.19")}
        sub={
          plan.length === 0
            ? "近期没有需要提醒的事项。"
            : plan.slice(0, 3).map((it) => `${fmtAt(it.at)} ${it.title}`).join("；") +
              (plan.length > 3 ? ` …共 ${plan.length} 条` : "")
        }
        control={
          <Btn
            variant="ghost"
            size="sm"
            onClick={() => {
              void (async () => {
                const rt = await ensureNotifyRuntime();
                const r = await rt.syncNow();
                setPlan(rt.plan());
                setMsg(r.error ? `重排失败：${r.error}` : `已重排（排程 ${r.scheduled} 条 / 撤销 ${r.cancelled} 条）`);
              })();
            }}
          >
            {i18n("auto.components.NotifySettingsSection.20")}</Btn>
        }
      />
      ) : null}

      {report ? (
        <div style={{ padding: "8px 2px", borderTop: "1px solid var(--border-soft)", marginTop: 6 }}>
          <div style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: report.ok ? "var(--text-1)" : "var(--red)", marginBottom: 6 }}>
            {report.summary}
          </div>
          {report.steps.map((st) => (
            <div key={st.id} style={{ display: "flex", gap: 8, fontSize: "var(--text-xs)", lineHeight: "18px", marginTop: 3 }}>
              <span style={{ flex: "none", width: 54, color: st.status === "fail" ? "var(--red)" : st.status === "warn" ? "var(--amber)" : "var(--green)" }}>
                {st.status === "fail" ? "不通过" : st.status === "warn" ? "提示" : "通过"}
              </span>
              <span style={{ flex: "none", width: 76, color: "var(--text-2)" }}>{st.label}</span>
              <span style={{ color: "var(--text-3)", minWidth: 0 }}>{st.detail}</span>
            </div>
          ))}
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-3)", marginTop: 6 }}>
            {i18n("auto.components.NotifySettingsSection.21")}</div>
        </div>
      ) : null}

      {msg ? (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-3)", padding: "6px 2px" }}>{msg}</div>
      ) : null}
    </>
  );
}
