/** Practical mode service library: search, browse, open, or pin to one of four slots. */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Btn, IconBtn, Modal, SearchField, Text } from "@onethu/gui";
import { IconPlus, IconLearn, IconSchedule, IconInfo } from "../Icons.js";
import { NAV } from "../Layout.js";
import { NAV_CATEGORIES, navCategoryLabel, navName, navNote, NAV_REGISTRY } from "../../state/navigation.js";
import { openTab } from "../../state/explorer.js";
import { quickEntries } from "../../state/quickAccess.js";
import { compactPageAllowed } from "../../state/experienceMode.js";
import type { NavEntry } from "../../state/navigation.js";
import { t as i18n } from "../../i18n/index.js";


function FeatureIcon({page}:{page:string}) {
 const Icon=NAV.find(n=>n.page===page||n.activePages?.includes(page as NavEntry["page"]))?.icon ?? (page.startsWith("learn")?IconLearn:page.startsWith("schedule")?IconSchedule:IconInfo);
 return <span className="practical-feature-icon" aria-hidden="true"><Icon/></span>;
}
export function PracticalFeaturesPanel({open,onClose,slots,onPlace}:{
 open:boolean;onClose:()=>void;slots:string[];onPlace:(feature:{id:string;title:string})=>void;
}):ReactNode {
 const [query,setQuery]=useState("");
 const [category,setCategory]=useState("全部");
 useEffect(()=>{if(open){setQuery("");setCategory("全部");}},[open]);
 const entries=useMemo(()=>NAV_REGISTRY.filter(e=>compactPageAllowed(e.page)&&e.page!=="settings"),[]);
 const categories=NAV_CATEGORIES.filter(c=>entries.some(e=>e.category===c));
 const search=query.trim().toLocaleLowerCase();
 const groups=categories.map(name=>({name,entries:entries.filter(e=>e.category===name&&(category==="全部"||category===name)&&(!search||[e.name,navName(e),navNote(e)??"",...e.keywords].join(" ").toLocaleLowerCase().includes(search)))})).filter(g=>g.entries.length);
 const shortcuts=quickEntries();
 const place=(entry:NavEntry)=>onPlace({id:"page:"+entry.id,title:navName(entry)});
 return <Modal open={open} onClose={onClose} title={i18n("auto.components.explorer.PracticalFeatures.1")} className="practical-library" size="lg">
 <div className="practical-library-intro"><span className="practical-library-kicker">{i18n("auto.components.explorer.PracticalFeatures.2")}</span><Text tone="faint">{i18n("auto.components.explorer.PracticalFeatures.3")}</Text></div>
 <div className="practical-pinned"><span className="practical-section-label">{i18n("auto.components.explorer.PracticalFeatures.4")}</span><div className="practical-pinned-grid">{slots.map((id,i)=>{const e=shortcuts.find(e=>e.id===id);return <div className="practical-pinned-item" key={i}><span className="practical-slot-number">0{i+1}</span><span>{e?.title??"入口已失效"}</span></div>;})}</div></div>
 <div className="practical-library-search"><SearchField aria-label={i18n("auto.components.explorer.PracticalFeatures.5")} placeholder={i18n("auto.components.explorer.PracticalFeatures.6")} value={query} onChange={setQuery}/></div>
 <div className="practical-library-layout">
 <nav className="practical-categories" aria-label={i18n("auto.components.explorer.PracticalFeatures.7")}>{["全部",...categories].map(c=><Btn key={c} variant="ghost" aria-pressed={category===c} onClick={()=>setCategory(c)}>{c}<span>{c==="全部"?entries.length:entries.filter(e=>e.category===c).length}</span></Btn>)}</nav>
 <div className="practical-library-results" aria-live="polite">
 {groups.length?groups.map(group=><section className="practical-service-group" key={group.name}><header><h3>{navCategoryLabel(group.name)}</h3><span>{group.entries.length} {i18n("auto.components.explorer.PracticalFeatures.8")}</span></header><div className="practical-service-grid">{group.entries.map(entry=>{
 const slot=slots.indexOf("page:"+entry.id);
 return <div className="practical-feature-row" key={entry.id}>
 <Btn className="workbench-catalog-entry practical-feature-open" variant="ghost" onClick={()=>{openTab(entry.page,entry.params??null,{title:navName(entry)});onClose();}}>
 <FeatureIcon page={entry.page}/><span className="practical-feature-copy"><strong>{navName(entry)}</strong><small>{navNote(entry)||entry.keywords.filter(k=>k!==entry.name).slice(0,3).join(" · ")||i18n("misc.practical.openService")}</small></span>
 </Btn><IconBtn size="sm" variant="ghost" className={"practical-feature-pin"+(slot>=0?" is-pinned":"")} label={i18n("misc.practical.pinAdd", { name: navName(entry) })} titleAttr={slot>=0?i18n("misc.practical.pinAt", { n: slot+1 }):i18n("misc.practical.pin")} icon={slot>=0?<span>{slot+1}</span>:<IconPlus width={14} height={14}/>} onClick={()=>place(entry)}/>
 </div>;
 })}</div></section>):<div className="practical-no-results"><strong>{i18n("auto.components.explorer.PracticalFeatures.9")}{query}”</strong><Text tone="faint">{i18n("auto.components.explorer.PracticalFeatures.10")}</Text><Btn variant="outline" onClick={()=>{setQuery("");setCategory("全部");}}>{i18n("auto.components.explorer.PracticalFeatures.11")}</Btn></div>}
 </div></div>
 <Text className="practical-library-footnote" slot="micro" tone="faint">{i18n("auto.components.explorer.PracticalFeatures.12")}</Text>
 </Modal>;
}
