/**
 * 全局悬浮球设置（需求 5）：开关 + 授权状态 + 「本次关闭」说明。
 * 真源在原生侧（SharedPreferences，安卓系统悬浮层）/ 悬浮球窗口（桌面），
 * 这里只做入口：打开 = overlayShow()（同时清掉前端的「本次已关闭」标记）。
 *
 * 2026-10-14 换血：骨架换成 OneGUI（SettingsList / SettingsRow / Switch / Btn）。
 * 检索直达锚点从自定义的 data-set-id 改用标准 id（`row-开启悬浮球`），
 * focusSettingsTarget() 两族都认 —— 行为不变。
 */
import { defineSearchRows } from "../state/searchRows.js";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Btn, SettingsList, SettingsRow, Switch } from "@onethu/gui";
import { isOverlayClosedByUser, overlayHide, setOverlayClosedByUser, overlayShow, overlaySupported, syncOverlayPreference } from "../lib/overlay.js";
import { hasOverlayPermission, requestOverlayPermission } from "../lib/overlayAndroid.js";
import { isAndroidNavigator } from "../lib/androidHost.js";
import { goOhRow } from "./OhSettingsPage.js";
import { t as i18n } from "../i18n/index.js";



/* task-19/22：悬浮球设置行注册。
   双形态：开关行的标题是「在其他应用上层显示 OH 悬浮球」（JSX 已钉 id="row-开启悬浮球"），
   平台不支持时该开关不出现 → visible 条件隐藏：落 OH 基础档根（TierSwitch 锚点）+ 一句解释。 */
defineSearchRows([
  {
    id: "overlay-on", tab: "OneTHU Harness", section: "悬浮球", title: "开启悬浮球", aliases: ["悬浮球", "浮窗", "overlay", "权限"], desc: "浮在其他应用上层的 OH 球；需要悬浮窗权限" , breadcrumb: ["插件", "OneTHU Harness", "基础设置", "悬浮球", "开启悬浮球"], displayRoot: "设置",
    visible: () => isAndroidNavigator(typeof navigator !== "undefined" ? navigator : undefined),
    fallbackNote: "当前平台不支持在其他应用上层显示悬浮球（仅安卓可用）；已带到 OH「悬浮球」分节。",
    /* 落点=OH 基础档的档位按钮（OhSettingsPage 的 TierSwitch，data-set-id=`row-基础设置`）。
       注意：focusSettingsTarget 会自己补 `row-`/`sec-` 前缀 —— 这里传**档位名**，不是锚点全名
       （旧值 "oh-tier-basic" 会被拼成 `row-oh-tier-basic`，谁都命中不了）。 */
    root: "基础设置",
    go: () => goOhRow("开启悬浮球", "basic"),
  },
]);

export function OverlaySettingsSection(): ReactNode {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [open, setOpen] = useState<boolean>(!isOverlayClosedByUser());
  const [perm, setPerm] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  void busy; // 开关本身不做禁用态（并发点击由 toggle 内的 await 自然串行）

  useEffect(() => {
    void (async () => {
      const sup = await overlaySupported();
      setSupported(sup);
      setPerm(await hasOverlayPermission().catch(() => null));
      /* 开关默认按偏好显示「开」，但原生端不会自己 show：进来时补一次真正的显示，
         并把状态回写（安卓未授权 → 如实显示为关，避免「开了却看不见」）。 */
      if (sup && !isOverlayClosedByUser()) {
        const shown = await syncOverlayPreference();
        setOpen(shown);
      }
    })();
  }, []);

  const toggle = useCallback(async (next: boolean): Promise<void> => {
    setBusy(true);
    try {
      if (next) {
        if (!(await hasOverlayPermission().catch(() => false))) {
          await requestOverlayPermission().catch(() => undefined);
        }
        setOverlayClosedByUser(false);
        await overlayShow();
        setOpen(true);
      } else {
        setOverlayClosedByUser(true);
        await overlayHide();
        setOpen(false);
      }
    } finally {
      setBusy(false);
    }
  }, []);

  if (supported === false) {
    return (
      <SettingsList>
        <SettingsRow
          title={i18n("auto.components.OverlaySettingsSection.1")}
          sub={i18n("auto.components.OverlaySettingsSection.2")}
        />
      </SettingsList>
    );
  }

  return (
    <SettingsList>
      {/* task-22 检索直达：注册表按「开启悬浮球」检索，这里钉标准 id，让这条行无论叫什么都落点唯一 */}
      <SettingsRow
        id="row-开启悬浮球"
        title={i18n("auto.components.OverlaySettingsSection.3")}
        sub={`单击展开对话，长按说话；在别的应用里也能用，不会把你拉回 OneTHU。${perm === false ? "（需要先授予「显示在其他应用上层」权限）" : ""}`}
        control={<Switch checked={open} aria-label={i18n("auto.components.OverlaySettingsSection.3")} onChange={(v) => void toggle(v)} />}
      />
      {open ? (
        <SettingsRow
          title={i18n("auto.components.OverlaySettingsSection.4")}
          sub={i18n("auto.components.OverlaySettingsSection.5")}
          control={<Btn variant="ghost" size="sm" onClick={() => void toggle(false)}>{i18n("auto.components.OverlaySettingsSection.6")}</Btn>}
        />
      ) : null}
    </SettingsList>
  );
}
