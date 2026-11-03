import { t as i18n, rich as i18nRich, useLocale as useUiLocale } from "../i18n/index.js";
import { MobileFeatureNavigation } from "./MobileFeatureNavigation.js";
import { ExperienceModePicker, MODE_OPTIONS } from "./ExperienceModePicker.js";
import { useMemo, useState } from "react";
import { Btn, SettingsList, SettingsRow, Text, Stack } from "@onethu/gui";
import { Ctx, useApp } from "../state/context.js";
import { useSimpleRoute, navigateSimple, useExperienceMode, setExperienceMode } from "../state/experienceMode.js";
import { openSettings } from "../state/explorer.js";
import { renderPage } from "./explorer/renderPage.js";
import { HomeworkWidget, TodayClassesWidget } from "./HomeWidgets.js";
/** 设置里的模式选择：与其它设置行同构——小标题在外，行内显示「当前模式」，
    点「切换模式」才展开三张模式卡（不长期占一大块）。 */
export function ExperienceModeControl() {
  const uiLocale = useUiLocale();

 const mode=useExperienceMode();
 const [open,setOpen]=useState(false);
 const current=MODE_OPTIONS.find(m=>m.id===mode)??MODE_OPTIONS[2];
 return <div data-mode-control>
  <SettingsList>
   <SettingsRow
    title={current.name}
    sub={current.description}
    control={<Btn variant={open?"ghost":"outline"} size="sm" onClick={()=>setOpen(v=>!v)} aria-expanded={open}>{open?i18n("components.simpleexperience.afd4b783536b"):i18n("components.simpleexperience.c5e8fe3d1aed")}</Btn>}
   />
  </SettingsList>
  {open?<Stack gap={3}><ExperienceModePicker value={mode} onChange={(m)=>{setExperienceMode(m);setOpen(false);}}/><Text slot="micro" tone="faint">{i18n("components.simpleexperience.a77ab9efa020")}</Text></Stack>:null}
 </div>;
}

export function SimpleHeader(){
  const uiLocale = useUiLocale();
/* data-tx="keep"：简单壳的栏体与首页标题不走「壁纸亮度反色锁」，字色只跟主题令牌走
   （2026-10-28 用户点名：夜主题下大字小字仍是深色，正是被这条内联锁定的）。 */
return <header className="simple-header" data-tx="keep"><MobileFeatureNavigation/><Btn variant="ghost" aria-label={i18n("components.simpleexperience.203c08e0d44a")} onClick={()=>navigateSimple("homepage")}><span className="simple-wordmark">OneTHU</span><span className="simple-home-label">{i18n("components.simpleexperience.203c08e0d44a")}</span></Btn><span className="simple-header-date">{new Intl.DateTimeFormat(uiLocale,{month:"long",day:"numeric",weekday:"long"}).format(new Date())}</span><Btn variant="ghost" onClick={()=>openSettings("settings")}>{i18n("components.simpleexperience.df3d58c7d84b")}</Btn></header>;}
export function SimpleHost(){
  const uiLocale = useUiLocale();

 const outer=useApp(), route=useSimpleRoute();
 const value=useMemo(()=>({...outer,page:route.page,navParams:route.params,navigate:(page:typeof route.page,params?:NonNullable<typeof route.params>)=>{if(page==="settings"||page==="plugins")openSettings("settings");else navigateSimple(page,params);}}),[uiLocale, outer, route]);
 return <Ctx.Provider value={value}><div className="explorer-panel simple-panel" data-simple-page={route.page}><div className="page-anim" key={route.page} data-page={route.page}>
 {route.page==="homepage"?<div className="simple-home" data-tx="keep"><section><header className="simple-section-head"><span>{i18n("components.simpleexperience.be835793d3f3")}</span><h2>{i18n("components.simpleexperience.23530d9f428a")}</h2></header><HomeworkWidget/></section><section><header className="simple-section-head"><span>{i18n("components.simpleexperience.1db098f84eb2")}</span><h2>{i18n("components.simpleexperience.119099ab1bad")}</h2></header><TodayClassesWidget upcoming/></section></div>:renderPage(route.page)}
 </div></div></Ctx.Provider>;
}
