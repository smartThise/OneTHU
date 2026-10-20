import { SimpleSettings } from "../SimpleSettings.js";
import { useIsSimpleLike } from "../../state/experienceMode.js";
import { IconBtn, IconUser } from "@onethu/gui";
/**
 * 设置浮层（dev-explorer）：个人设置 / 插件 / OneTHU Harness 三段合一。
 *
 * 用户拍板（2026-10-12）：它们**不是任何标签页，高于任何标签页**——顶栏齿轮
 * 打开，段内切换走 goEntry（= explorer overlay store，旧 Entry 状态机的本体）。
 * 手机=全屏浮层，桌面=右侧推入面板（同 TabManageModal 的 PC 形态语言）。
 */
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useExitPhase } from "../../lib/useExitPhase.js";
import { useExpanded } from "../../state/usePlatformLayout.js";
import { closeSettings, openSettings, useOverlayEntry, type OverlayEntry } from "../../state/explorer.js";
import { markSettingsRows } from "../Layout.js";
import { NameCardSection } from "../NameCardSection.js";
import { SettingsPage } from "../../pages/Settings.js";
import { PluginsPage } from "../../pages/Plugins.js";
import { IconSettings, IconX } from "../Icons.js";
import { HarnessMark } from "../HarnessMark.js";
import { IconPlug } from "../Icons.js";
import { t as i18n } from "../../i18n/index.js";


const SEGMENTS: Array<{ id: OverlayEntry; label: string; icon: ReactNode }> = [
  { id: "profile", label: "我的名片", icon: <IconUser size="sm" /> },
  { id: "settings", label: "个人设置", icon: <IconSettings width={14} height={14} /> },
  { id: "plugins", label: "插件", icon: <IconPlug width={14} height={14} /> },
  { id: "oh", label: "Harness", icon: <HarnessMark size={12} /> },
];

export function SettingsOverlay(): ReactNode {
  const simple = useIsSimpleLike();
  const entry = useOverlayEntry(); // null = 关闭
  const expanded = useExpanded();
  /** 退场动画（TabManageModal 同款：先播淡出再卸载） */
  const [closing, requestClose] = useExitPhase(closeSettings, entry !== null);

  /* Esc 关闭 */
  useEffect(() => {
    if (entry === null) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [entry, requestClose]);

  /* 入口态变化（开关/换段）都会换内容挂载 → 重打设置行 id（幂等），供检索直达精确落点 */
  useEffect(() => {
    if (entry === null) return;
    const t = window.setTimeout(markSettingsRows, 60);
    return () => window.clearTimeout(t);
  }, [entry]);

  if (entry === null) return null;

  const mask = "settings-mask" + (closing ? " is-closing" : "");
  const panel = "settings-panel" + (expanded ? " is-desktop" : "") + (closing ? " is-closing" : "");

  return createPortal(
    <div className={mask} onClick={requestClose}>
      <div className={panel} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={i18n("auto.components.explorer.SettingsOverlay.1")}>
        <div className="settings-head">
          <span className="workbench-settings-brand">OneTHU</span>
          {!simple && <div className="settings-seg" role="tablist" aria-label={i18n("auto.components.explorer.SettingsOverlay.2")}>
            {SEGMENTS.map((s) => (
              <button
                key={s.id}
                className={"settings-seg-item" + (entry === s.id ? " is-active" : "")}
                onClick={() => openSettings(s.id)}
                title={s.label}
                aria-current={entry === s.id ? "true" : undefined}
              >
                {s.icon}
                <span>{s.label}</span>
              </button>
            ))}
          </div>}
          <IconBtn label={i18n("auto.components.explorer.SettingsOverlay.3")} size="sm" variant="outline" titleAttr={i18n("auto.components.explorer.SettingsOverlay.4")} icon={<IconX width={14} height={14} />} onClick={requestClose} />
        </div>
        <div className={"explorer-settings-body" + (entry === "settings" ? "" : " workbench-plugin-settings")}>
          {simple ? <SimpleSettings/> : entry === "profile" ? <NameCardSection view="personal" /> : entry === "settings" ? <SettingsPage /> : <PluginsPage />}
        </div>
      </div>
    </div>,
    document.body,
  );
}
