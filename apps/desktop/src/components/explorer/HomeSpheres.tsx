import { labelForId } from "../../i18n/staticLabels.js";
import { t as i18n, useLocale as useUiLocale } from "../../i18n/index.js";
/** Home chrome: service navigation and clock share the OneGUI workbench.
 * Stored dock order/opacity and navigation targets remain authoritative.
 * All dialogs use OneGUI's focus, Escape, dismissal and surface contract.
 */
import { Btn, Chip, IconBtn, Modal } from "@onethu/gui";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { fmtMonthDayWeek } from "../../lib/dateText.js";
import { allSphereEntries, dockSphere, sphereEntry, spheresSnapshot, subscribeSpheres, undockSphere } from "../../state/homeSpheres.js";
import { byCategory, NAV_CATEGORIES, pluginCatalogEntries } from "../../state/navigation.js";
import { pluginTabsSnapshot, subscribePluginTabs } from "../../plugins/tabs.js";
import { openTab } from "../../state/explorer.js";
import { IconChevron, IconMore, IconPlus, IconX } from "../Icons.js";

type Entry = NonNullable<ReturnType<typeof sphereEntry>>;

export function HomeClockWidget({ display = "minimal" }: { display?: string } = {}): ReactNode {
  const uiLocale = useUiLocale();

  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  /* 兼容旧 magazine/minimal；新样式用 serif|sans + left|center 的四个组合。 */
  const serif = display === "magazine" || display === "serif" || display.startsWith("serif");
  const centered = display === "minimal" || display.endsWith("center");
  const styleId = display === "magazine" ? "serif-left" : display === "minimal" ? "sans-center" : display;
  const time = <div className="chrome-clock-time">{String(now.getHours()).padStart(2, "0")}<span className="chrome-clock-colon">:</span>{String(now.getMinutes()).padStart(2, "0")}</div>;
  const date = <div className="chrome-clock-date">{fmtMonthDayWeek(now)}</div>;
  return <div
    className={"chrome-clock " + (serif ? "is-serif" : "is-sans") + (centered ? " is-center" : " is-left")}
    data-clock-style={styleId}
    aria-label={i18n("components.explorer.homespheres.8bc0ff588cb7")}
  >
    {centered ? <>{date}{time}</> : <>{time}{date}</>}
  </div>;
}

function ServiceEntry({ entry, onNavigate }: { entry: Entry; onNavigate: () => void }): ReactNode {
  const uiLocale = useUiLocale();

  const Icon = entry.icon as (props: { width?: number; height?: number }) => ReactNode;
  return <Btn className="sphere hs-dock-sphere" titleAttr={entry.label} onClick={onNavigate}>
    <span className="sphere-ball"><Icon width={20} height={20} /></span>
    <span className="sphere-name">{entry.label}</span>
  </Btn>;
}

export function HomeServicesWidget({ display = "grid" }: { display?: string }): ReactNode {
  const uiLocale = useUiLocale();

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
    { name: i18n("components.explorer.homespheres.e806fbbe8ec6"), entries: pluginCatalogEntries(pluginTabs) },
  ].filter(group => group.entries.length > 0);

  return <>
      <div className={"home-services-widget is-" + display} style={{ opacity: doc.dockOpacity }}>
        <div className="workbench-section-label">{i18n("components.explorer.homespheres.a45eee2e0119")}</div>
        <div className="hs-dock-row" data-coach="home-dock">
          {docked.map(entry => <ServiceEntry key={entry.page} entry={entry} onNavigate={() => go(entry)} />)}
        </div>
        <div className="hs-dock-actions">
          <Chip size="sm" selected={moreOpen} onClick={() => setMoreOpen(true)} icon={<IconMore width={14} height={14} />}>{i18n("components.explorer.homespheres.9c7a9fcee92f")}</Chip>
          <Chip size="sm" selected={detailOpen} onClick={() => setDetailOpen(true)}>{i18n("components.explorer.homespheres.005601165516")}</Chip>
        </div>
      </div>

    <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title={i18n("components.explorer.homespheres.a45eee2e0119")} aria-label={i18n("components.explorer.homespheres.9c7a9fcee92f")} size="lg" foot={i18n("components.explorer.homespheres.ee11e6f14326")}>
      <div className="workbench-service-library">
        {allSphereEntries().map(entry => {
          const inHome = dockedSet.has(entry.page);
          return <div className="workbench-service-cell" key={entry.page}>
            <ServiceEntry entry={entry} onNavigate={() => go(entry)} />
            <IconBtn className="workbench-service-toggle" size="sm" label={(inHome ? i18n("components.explorer.homespheres.ed9b9a23bf82") : i18n("components.explorer.homespheres.53d3695385a7")) + entry.label}
              icon={inHome ? <IconX width={14} height={14} /> : <IconPlus width={14} height={14} />}
              onClick={() => inHome ? undockSphere(entry.page) : dockSphere(entry.page)} />
          </div>;
        })}
      </div>
    </Modal>
    <Modal open={detailOpen} onClose={() => setDetailOpen(false)} title={i18n("components.explorer.homespheres.a6f3e6634e51")} aria-label={i18n("components.explorer.homespheres.005601165516")} size="lg">
      <div className="workbench-catalog">
        {groups.map(group => <section className="workbench-catalog-group" key={group.name}>
          <h3>{labelForId(group.name)}</h3>
          {group.entries.map(entry => <Btn key={entry.id} className="workbench-catalog-entry" titleAttr={entry.note ?? entry.name}
            iconRight={<IconChevron width={14} height={14} />} onClick={() => go({ page: entry.page, label: entry.name })}>
            <span>{entry.name}</span>{entry.note ? <small>{entry.note}</small> : null}
          </Btn>)}
        </section>)}
      </div>
    </Modal>
  </>;
}
