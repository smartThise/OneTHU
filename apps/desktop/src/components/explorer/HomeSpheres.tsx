/** Home chrome: service navigation and clock share the OneGUI workbench.
 * Stored dock order/opacity and navigation targets remain authoritative.
 * All dialogs use OneGUI's focus, Escape, dismissal and surface contract.
 */
import { Btn, Chip, IconBtn, Modal } from "@onethu/gui";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { fmtMonthDayWeek } from "../../lib/dateText.js";
import { allSphereEntries, dockSphere, sphereEntry, spheresSnapshot, subscribeSpheres, undockSphere } from "../../state/homeSpheres.js";
import { byCategory, NAV_CATEGORIES, navName, navNote, pluginCatalogEntries } from "../../state/navigation.js";
import { pluginTabsSnapshot, subscribePluginTabs } from "../../plugins/tabs.js";
import { openTab } from "../../state/explorer.js";
import { IconChevron, IconMore, IconPlus, IconX } from "../Icons.js";
import { useT } from "../../i18n/index.js";
import { navLabel } from "../Layout.js";
import { t as i18n } from "../../i18n/index.js";


type Entry = NonNullable<ReturnType<typeof sphereEntry>>;
/** 目录分组名 → 文案键（byCategory 仍以中文名作分组标识，显示时才翻译）。 */
const CAT_KEY: Record<string, string> = {
  学习: "cat.study",
  日程: "cat.schedule",
  生活: "cat.life",
  预约: "cat.reserve",
  行政: "cat.admin",
  插件: "cat.plugins",
};

export function HomeClockWidget(): ReactNode {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return <div className="chrome-clock" aria-label={i18n("auto.components.explorer.HomeSpheres.1")}>
    <div className="chrome-clock-date">{fmtMonthDayWeek(now)}</div>
    <div className="chrome-clock-time">{String(now.getHours()).padStart(2, "0")}<span className="chrome-clock-colon">:</span>{String(now.getMinutes()).padStart(2, "0")}</div>
  </div>;
}

function ServiceEntry({ entry, onNavigate }: { entry: Entry; onNavigate: () => void }): ReactNode {
  const Icon = entry.icon as (props: { width?: number; height?: number }) => ReactNode;
  return <Btn className="sphere hs-dock-sphere" titleAttr={navLabel(entry)} onClick={onNavigate}>
    <span className="sphere-ball"><Icon width={20} height={20} /></span>
    <span className="sphere-name">{navLabel(entry)}</span>
  </Btn>;
}

export function HomeServicesWidget(): ReactNode {
  const tr = useT();
  const doc = useSyncExternalStore(subscribeSpheres, spheresSnapshot, spheresSnapshot);
  const pluginTabs = useSyncExternalStore(subscribePluginTabs, pluginTabsSnapshot, pluginTabsSnapshot);
  const [moreOpen, setMoreOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const docked = doc.docked.map(sphereEntry).filter((e): e is Entry => e !== null);
  const dockedSet = new Set(doc.docked);
  const go = (entry: { page: import("../../state/app.js").Page; label: string }): void => {
    openTab(entry.page, null, { title: entry.label }); setMoreOpen(false); setDetailOpen(false);
  };
  const groups = [
    ...NAV_CATEGORIES.map(name => ({ name, entries: byCategory(name) })),
    { name: "插件", entries: pluginCatalogEntries(pluginTabs) },
  ].filter(group => group.entries.length > 0);

  return <>
      <div className="home-services-widget" style={{ opacity: doc.dockOpacity }}>
        <div className="workbench-section-label">{tr("shell.services")}</div>
        <div className="hs-dock-row" data-coach="home-dock">
          {docked.map(entry => <ServiceEntry key={entry.page} entry={entry} onNavigate={() => go({ page: entry.page, label: navLabel(entry) })} />)}
        </div>
        <div className="hs-dock-actions">
          <Chip size="sm" selected={moreOpen} onClick={() => setMoreOpen(true)} icon={<IconMore width={14} height={14} />}>{tr("shell.more")}</Chip>
          <Chip size="sm" selected={detailOpen} onClick={() => setDetailOpen(true)}>{tr("shell.details")}</Chip>
        </div>
      </div>

    <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title={tr("shell.services")} aria-label={tr("shell.more")} size="lg" foot={tr("shell.servicesFoot")}>
      <div className="workbench-service-library">
        {allSphereEntries().map(entry => {
          const inHome = dockedSet.has(entry.page);
          return <div className="workbench-service-cell" key={entry.page}>
            <ServiceEntry entry={entry} onNavigate={() => go({ page: entry.page, label: navLabel(entry) })} />
            <IconBtn className="workbench-service-toggle" size="sm" label={inHome ? tr("shell.removeFromHome", { name: navLabel(entry) }) : tr("shell.addToHome", { name: navLabel(entry) })}
              icon={inHome ? <IconX width={14} height={14} /> : <IconPlus width={14} height={14} />}
              onClick={() => inHome ? undockSphere(entry.page) : dockSphere(entry.page)} />
          </div>;
        })}
      </div>
    </Modal>
    <Modal open={detailOpen} onClose={() => setDetailOpen(false)} title={tr("shell.catalog")} aria-label={tr("shell.details")} size="lg">
      <div className="workbench-catalog">
        {groups.map(group => <section className="workbench-catalog-group" key={group.name}>
          <h3>{tr(CAT_KEY[group.name] ?? group.name)}</h3>
          {group.entries.map(entry => <Btn key={entry.id} className="workbench-catalog-entry" titleAttr={navNote(entry) ?? navName(entry)}
            iconRight={<IconChevron width={14} height={14} />} onClick={() => go({ page: entry.page, label: navName(entry) })}>
            <span>{navName(entry)}</span>{navNote(entry) ? <small>{navNote(entry)}</small> : null}
          </Btn>)}
        </section>)}
      </div>
    </Modal>
  </>;
}
