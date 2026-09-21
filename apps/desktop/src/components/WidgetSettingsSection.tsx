/**
 * 设置页「桌面小组件」区块：桌面上每一块显示什么，在这里一眼看全并逐个改。
 *
 * 与上一版的关键差别：内容**按块**绑定（以前是一份全局配置，导致桌面上所有 OneTHU 小组件
 * 长得一样）。这里列出原生报回的每一块：形态、当前内容、换内容 / 恢复默认。
 *
 * 平台口径：小组件只有 Android 有承载，桌面端明确不做——非 Android 显示一行说明，不给假开关。
 */
import { useEffect, useState, type ReactNode } from "react";
import { useFavs } from "../state/favs.js";
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

export function WidgetSettingsSection(): ReactNode {
  const favs = useFavs();
  const backend = useNotifyBackend();
  const [instances, setInstances] = useState<WidgetInstanceInfo[] | null>(null);
  /** null = 读取失败（与「读到 0 块」是两回事，不能都显示成「正在读取」） */
  const [readFailed, setReadFailed] = useState(false);
  const [status, setStatus] = useState<NativeWidgetStatus | null>(null);
  const [map, setMap] = useState(() => loadWidgetInstances());
  const [msg, setMsg] = useState<string | null>(null);
  /** 默认内容选「快捷方式」时要挑原子 */
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
          <div className="setting-title">桌面小组件</div>
          <div className="setting-desc">
            桌面小组件由 Android 版提供：日程与 DDL、某个原子的详情、收藏夹图标组、1×1 快捷方式；
            当前平台不支持。
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="setting-row">
        <div>
          <div className="setting-title">桌面上的小组件</div>
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
          <button
            className="btn"
            title="调用系统方式直接在桌面放一块标准形态小组件"
            onClick={() => {
              void (async () => {
                const r = await pinWidget();
                if (r.requested) {
                  showToast("已请求系统添加到桌面，请查看桌面");
                  void refresh();
                } else if (r.supported) {
                  showToast("系统未接受放置请求，请长按桌面 → 小组件 → OneTHU 手动添加", 6000);
                } else {
                  showToast("当前启动器不支持一键添加，请长按桌面 → 小组件 → OneTHU", 6000);
                }
              })();
            }}
          >
            放到桌面
          </button>
          <button className="btn btn-ghost" onClick={() => void pushNow()}>立即刷新</button>
          <button className="btn btn-ghost" onClick={() => void refresh()}>重新载入</button>
        </div>
      </div>

      {/* 形态登记情况：选择器里「看不到某个尺寸」时，先确认系统到底登记了哪几个 provider */}
      {status ? (
        <div className="setting-row">
          <div>
            <div className="setting-title">系统已登记的小组件形态</div>
            <div className="setting-desc">
              {status.providersRegistered.length === 0
                ? "未登记任何形态，请将本行内容反馈给开发者"
                : `${status.providersRegistered.length} 个：${status.providersRegistered.join("、")}`}
              <span style={{ color: "var(--text-3)" }}>　桌面「小组件」列表中可选的即以下形态。</span>
            </div>
          </div>
        </div>
      ) : null}

      {(instances ?? []).map((inst) => (
        <div className="setting-row" key={inst.id}>
          <div>
            <div className="setting-title">{shapeLabel(inst)}</div>
            <div className="setting-desc">
              {bindingSummary(bindingOf(inst.id, map), favs.data)}
              {inst.bound === false ? <span style={{ color: "var(--text-3)" }}>　尚未选择内容（桌面显示「点一下选择」）</span> : null}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flex: "none" }}>
            <button className="btn" onClick={() => requestWidgetBind({ to: "instance", id: String(inst.id) })}>换内容</button>
            {map.byId[String(inst.id)] ? (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  unbindWidgetInstance(inst.id);
                  setMap(loadWidgetInstances());
                  void pushNow();
                }}
              >
                恢复默认
              </button>
            ) : null}
          </div>
        </div>
      ))}

      <div className="setting-row">
        <div>
          <div className="setting-title">新小组件的默认内容</div>
          <div className="setting-desc">
            刚放上桌面、还没选的块用它兜底：{bindingSummary(map.fallback, favs.data)}。
            <span style={{ color: "var(--text-3)" }}>　添加时系统会自动弹出选择层，通常无需设置。</span>
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
          title="默认内容用哪个原子做快捷方式"
          hint="尚未选择内容时，桌面小组件先显示此项。"
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
