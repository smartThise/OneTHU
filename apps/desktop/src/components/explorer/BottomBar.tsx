import { useIsSimpleLike } from "../../state/experienceMode.js";
/**
 * 底栏三入口（dev-explorer）：标签页 | OH 胶囊 | OneGO。
 * 所有平台恒显示（革命口径：手机与桌面同一套交互架构，桌面顶栏另有 TabStrip）。
 * - 标签页：打开 TabDrawer（角标 = 打开的工作标签数，首页不计）；
 * - 中央 OhCapsule：搜索 + OH 二合一（explorer-oh 实现，这里只放插槽）；
 * - OneGO：打开 OneGoSheet。
 */
import { IconTabsCards } from "../../components/Icons.js";
import type { ReactNode } from "react";
import { useIsPhone } from "../../state/phoneSheets.js";
import { openSettings } from "../../state/explorer.js";
import { IconUser } from "@onethu/gui";
import { IconFist } from "../Icons.js";
import { OhCapsule } from "./OhCapsule.js";
import { openOneGoSheet, useOneGoSheetOpen } from "./OneGoSheet.js";
import { openTabDrawer, useTabDrawerOpen } from "./TabDrawer.js";
import { useExplorerTabs } from "./TabStrip.js";
import { t as i18n } from "../../i18n/index.js";


export function BottomBar(): ReactNode {
  const simple = useIsSimpleLike();
  const phone = useIsPhone();
  const { tabs } = useExplorerTabs();
  const count = tabs.filter((t) => t.kind === "page").length;
  const drawerOpen = useTabDrawerOpen();
  const onegoOpen = useOneGoSheetOpen();
  return (
    <nav className="ex-bbar" aria-label={i18n("auto.components.explorer.BottomBar.1")}>
      {!simple && <button id="ex-bbar-tabs-btn" className={"ex-bbar-btn" + (drawerOpen ? " is-open" : "")} onClick={openTabDrawer} aria-expanded={drawerOpen} aria-label={`标签页（${count} 个）`}>
        <span className="ex-bbar-icon">
          <IconTabsCards width={20} height={20} />
          {count > 0 ? <i className="ex-bbar-badge" aria-hidden="true">{count > 99 ? "99+" : count}</i> : null}
        </span>
        <span className="ex-bbar-label">{i18n("auto.components.explorer.BottomBar.2")}</span>
        <span className="workbench-wordmark" aria-hidden="true">{i18n("auto.components.explorer.BottomBar.2")}</span>
      </button>}
      <div className="ex-bbar-center">
        <OhCapsule />
      </div>
      {!simple && <button id="ex-bbar-onego-btn" className={"ex-bbar-btn" + (onegoOpen ? " is-open" : "")} onClick={() => phone ? openOneGoSheet() : openSettings("profile")} aria-expanded={phone ? onegoOpen : undefined} aria-label={phone ? "OneGO!" : "我的"}>
        <span className="ex-bbar-icon">
          {phone ? <IconFist width={20} height={20} /> : <IconUser />}
        </span>
        <span className="ex-bbar-label">{phone ? "OneGO!" : "我的"}</span>
      </button>}
    </nav>
  );
}
