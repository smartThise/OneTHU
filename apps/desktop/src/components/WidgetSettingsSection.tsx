import { Btn } from "@onethu/gui";
/**
 * 设置页「桌面小组件」区块：桌面上每一块显示什么，在这里一眼看全并逐个改。
 *
 * 与上一版的关键差别：内容**按块**绑定（以前是一份全局配置，导致桌面上所有 OneTHU 小组件
 * 长得一样）。这里列出原生报回的每一块：形态、当前内容、换内容 / 恢复默认。
 *
 * 平台口径：小组件只有 Android 有承载，桌面端明确不做——非 Android 显示一行说明，不给假开关。
 */
import { defineSearchRows } from "../state/searchRows.js";
import { useEffect, useState, type ReactNode } from "react";
import { useFavs } from "../state/favs.js";
import { isAndroidNavigator } from "../lib/androidHost.js";
import { ensureWidgetRuntime } from "../state/notifySources.js";
import { fetchWidgetStatus, pinWidget, type NativeWidgetStatus } from "../state/widgetBridge.js";
import { showToast } from "../state/toast.js";
import type { WidgetInstanceInfo } from "../state/widgetRuntime.js";
import { fetchWidgetInstances } from "../state/widgetBridge.js";
import {
  bindingOf, loadWidgetInstances, setWidgetFallback, unbindWidgetInstance,
} from "../state/widgetInstances.js";
import { requestWidgetBind } from "../state/widgetBindUi.js";
import { FavAtomPicker } from "./FavAtomPicker.js";
import { bindingSummary, shapeLabel } from "./WidgetBindModal.js";
import { useNotifyBackend } from "./useNotifyBackend.js";
import { t as i18n } from "../i18n/index.js";


/** 系统报回的 provider 名（宿主 1×1 / 槽位 2）→ 用户看得懂的尺寸名 */
function plainShapeName(name: string): string {
  return name.replace(/^宿主\s*/, "").replace(/^槽位\s*/, "可自选 ");
}


/* task-19：桌面小组件设置行注册 */
defineSearchRows([
  { id: "widget-main", tab: "桌面小组件", section: "桌面小组件", title: "桌面小组件", aliases: ["小组件", "widget", "桌面组件"], desc: "添加到桌面的 OneTHU 小组件与内容设置" , breadcrumb: ["设置", "桌面小组件", "桌面小组件", "桌面小组件"] },
  {
    id: "widget-slots", tab: "桌面小组件", section: "桌面小组件", title: "小组件槽位", aliases: ["槽位", "插件小组件"], desc: "选择每个槽位显示哪块插件小组件",
    breadcrumb: ["设置", "桌面小组件", "桌面小组件", "小组件槽位"],
    /* 槽位只在 Android 原生承载里存在：桌面端没有这行，别让 goSearchRow 报 row 级命中。 */
    visible: () => isAndroidNavigator(typeof navigator !== "undefined" ? navigator : undefined),
    fallbackNote: "「小组件槽位」仅 Android 版可用；已到「桌面小组件」。",
  },
]);

export function WidgetSettingsSection(): ReactNode {
  const favs = useFavs();
  const backend = useNotifyBackend();
  const [instances, setInstances] = useState<WidgetInstanceInfo[] | null>(null);
  /** null = 读取失败（与「读到 0 块」是两回事，不能都显示成「正在读取」） */
  const [readFailed, setReadFailed] = useState(false);
  const [status, setStatus] = useState<NativeWidgetStatus | null>(null);
  const [map, setMap] = useState(() => loadWidgetInstances());
  const [msg, setMsg] = useState<string | null>(null);
  /** 默认内容选「快捷方式」时要挑收藏项 */
  const [fallbackPicker, setFallbackPicker] = useState(false);

  const android = backend === "android";

  const refresh = async (): Promise<void> => {
    const list = await fetchWidgetInstances();
    setReadFailed(list === null);
    setInstances(list ?? []);
    setMap(loadWidgetInstances());
    setStatus(await fetchWidgetStatus());
  };

  useEffect(() => {
    if (android) void refresh();
  }, [android]);

  const pushNow = async (): Promise<void> => {
    const rt = await ensureWidgetRuntime();
    const okNow = await rt.syncNow();
    await refresh();
    setMsg(okNow ? "桌面小组件已刷新" : "刷新失败，详情见运行日志");
  };

  if (!android) {
    return (
      <div className="setting-row">
        <div>
          <div className="setting-title">{i18n("auto.components.WidgetSettingsSection.1")}</div>
          <div className="setting-desc">
            {i18n("auto.components.WidgetSettingsSection.2")}</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="setting-row">
        <div>
          <div className="setting-title">{i18n("auto.components.WidgetSettingsSection.3")}</div>
          <div className="setting-desc">
            {readFailed
              ? "读取失败；若为刚安装的版本，请完全退出应用后重新打开"
              : instances === null
                ? "正在读取…"
                : instances.length === 0
                  ? "尚未添加小组件：桌面长按 → 小组件 → OneTHU，添加后可选择显示内容"
                  : `共 ${instances.length} 块，每块各显示各的（点「换内容」改这一块）。`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flex: "none" }}>
          {/* R21c：ColorOS 等启动器上「绑定完桌面上没有」——直接请求系统放一块，
              绕开各家行为不一致的选择器；不支持时给出明确的手动路径。 */}
          <Btn variant="outline" titleAttr={i18n("auto.components.WidgetSettingsSection.4")} onClick={() => {
              void (async () => {
                const r = await pinWidget();
                if (r.requested) {
                  showToast(i18n("auto.components.WidgetSettingsSection.msg1"));
                  void refresh();
                } else if (r.supported) {
                  showToast(i18n("auto.components.WidgetSettingsSection.msg2"), 6000);
                } else {
                  showToast(i18n("auto.components.WidgetSettingsSection.msg3"), 6000);
                }
              })();
            }}>{i18n("auto.components.WidgetSettingsSection.5")}</Btn>
          <Btn variant="ghost" onClick={() => void pushNow()}>{i18n("auto.components.WidgetSettingsSection.6")}</Btn>
          <Btn variant="ghost" onClick={() => void refresh()}>{i18n("auto.components.WidgetSettingsSection.7")}</Btn>
        </div>
      </div>

      {/* 形态登记情况：选择器里「看不到某个尺寸」时，先确认系统到底登记了哪几个尺寸 */}
      {status ? (
        <div className="setting-row">
          <div>
            <div className="setting-title">{i18n("auto.components.WidgetSettingsSection.8")}</div>
            <div className="setting-desc">
              {status.providersRegistered.length === 0
                ? "还没读到任何可用尺寸，请把这一行内容反馈给开发者"
                : `${status.providersRegistered.length} 种：${status.providersRegistered.map(plainShapeName).join("、")}`}
              <span style={{ color: "var(--text-3)" }}>　{i18n("auto.components.WidgetSettingsSection.9")}</span>
              {status.romSignals ? (
                <>
                  <br />
                  <span style={{ color: "var(--text-3)" }}>{i18n("auto.components.WidgetSettingsSection.10")}{status.rom}{i18n("auto.components.WidgetSettingsSection.11")}{status.romSignals}）</span>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* task-22 检索直达：小组件槽位 = 每一块的「换内容」行集合；display:contents 不改布局 */}
      <div data-set-id="row-小组件槽位" style={{ display: "contents" }}>
      {(instances ?? []).map((inst) => (
        <div className="setting-row" key={inst.id}>
          <div>
            <div className="setting-title">{shapeLabel(inst)}</div>
            <div className="setting-desc">
              {bindingSummary(bindingOf(inst.id, map), favs.data)}
              {inst.bound === false ? <span style={{ color: "var(--text-3)" }}>　{i18n("auto.components.WidgetSettingsSection.12")}</span> : null}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flex: "none" }}>
            <Btn variant="outline" onClick={() => requestWidgetBind({ to: "instance", id: String(inst.id) })}>{i18n("auto.components.WidgetSettingsSection.13")}</Btn>
            {map.byId[String(inst.id)] ? (
              <Btn variant="ghost" onClick={() => {
                  unbindWidgetInstance(inst.id);
                  setMap(loadWidgetInstances());
                  void pushNow();
                }}>{i18n("auto.components.WidgetSettingsSection.14")}</Btn>
            ) : null}
          </div>
        </div>
      ))}
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-title">{i18n("auto.components.WidgetSettingsSection.15")}</div>
          <div className="setting-desc">
            {i18n("auto.components.WidgetSettingsSection.16")}{bindingSummary(map.fallback, favs.data)}。
            <span style={{ color: "var(--text-3)" }}>　{i18n("auto.components.WidgetSettingsSection.17")}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flex: "none" }}>
          {(["today", "shortcut"] as const).map((k) => (
            <button
              key={k}
              className={"btn" + (map.fallback.kind === k ? "" : " btn-ghost")}
              onClick={() => {
                if (k === "today") {
                  setWidgetFallback({ kind: "today" });
                  setMap(loadWidgetInstances());
                  void pushNow();
                } else {
                  setFallbackPicker(true);
                }
              }}
            >
              {k === "today" ? "日程与 DDL" : "快捷方式…"}
            </button>
          ))}
        </div>
      </div>

      {msg ? <div style={{ fontSize: "var(--text-sm)", color: "var(--text-3)", padding: "6px 2px" }}>{msg}</div> : null}

      {fallbackPicker ? (
        <FavAtomPicker
          title={i18n("auto.components.WidgetSettingsSection.18")}
          hint={i18n("auto.components.WidgetSettingsSection.19")}
          onPick={(atom) => {
            setFallbackPicker(false);
            setWidgetFallback({ kind: "shortcut", atom });
            setMap(loadWidgetInstances());
            void pushNow();
          }}
          onClose={() => setFallbackPicker(false)}
        />
      ) : null}
    </>
  );
}
