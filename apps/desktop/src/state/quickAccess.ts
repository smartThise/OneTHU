import {useEffect, useState, useSyncExternalStore} from "react";
import {navName,NAV_REGISTRY} from "./navigation.js";
import {explorerSnapshot, openTab, openWorkspace, subscribeExplorer} from "./explorer.js";
import {openOnePage, userOnePages} from "./onePage.js";
import type {LearnNav, Page} from "./app.js";
export type QuickEntry = {id:string; title:string; kind:"page"|"board"|"workspace"; page?:Page; params?:LearnNav; target?:string};
const KEY="onethu.oneshot.v1", ORDER="onethu.onego.order.v1";
export const DEFAULT_ONESHOT=["page:learn","page:reserve","page:life","page:info","page:schedule"];
const defaults=DEFAULT_ONESHOT;
function read(key:string,fallback:string[]):string[]{try{const a=JSON.parse(localStorage.getItem(key)??"null");return Array.isArray(a)&&a.every(x=>typeof x==='string')?a:fallback;}catch{return fallback;}}
const stored=read(KEY,defaults);
const legacy=["page:learn","page:schedule","page:tasks","page:life"];
let shot=(JSON.stringify(stored)===JSON.stringify(legacy)?defaults:stored).slice(0,5);
while(shot.length<5)shot.push(defaults.find(x=>!shot.includes(x))??defaults[shot.length]!);

/* ── 实用模式：极简五入口里的「信息」换成「更多功能」，左边四个可自由改 ── */
export const MORE_FEATURES_SLOT="more";
const PRACTICAL_KEY="onethu.oneshot.practical.v1";
/** 实用模式四个可配置入口的默认值（极简五入口去掉「信息」；第五格固定「更多功能」）。 */
export const PRACTICAL_DEFAULTS=["page:learn","page:reserve","page:life","page:schedule"];
let practical=read(PRACTICAL_KEY,PRACTICAL_DEFAULTS).slice(0,4);
while(practical.length<4)practical.push(PRACTICAL_DEFAULTS.find(x=>!practical.includes(x))??PRACTICAL_DEFAULTS[practical.length]!);
export function practicalSlots():string[]{return practical;}
/** 把任意功能放进实用模式的第 index 个入口（0..3；第五格固定是「更多功能」）。 */
export function setPracticalOneShot(index:number,id:string):void{
  if(index<0||index>3||!id||id===MORE_FEATURES_SLOT)return;
  practical=practical.map((x,i)=>i===index?id:x);
  try{localStorage.setItem(PRACTICAL_KEY,JSON.stringify(practical));}catch{}
  emit();
}
let order=read(ORDER,[]);
const listeners=new Set<()=>void>();
const emit=()=>listeners.forEach(f=>f());
export const subscribeQuick=(f:()=>void)=>{listeners.add(f);return()=>{listeners.delete(f);};};
export function setOneShot(index:number,id:string):void{if(index<0||index>4)return;shot=shot.map((x,i)=>i===index?id:x);try{localStorage.setItem(KEY,JSON.stringify(shot));}catch{}emit();}
export function moveQuickEntry(id:string,before:string):void{const all=quickEntries().filter(e=>e.kind!=="page").map(e=>e.id);const next=all.filter(x=>x!==id);const at=next.indexOf(before);if(at<0)return;next.splice(at,0,id);order=next;try{localStorage.setItem(ORDER,JSON.stringify(order));}catch{}emit();}
export function quickEntries():QuickEntry[]{
 const pages=NAV_REGISTRY.map(e=>({id:'page:'+e.id,title:({learn:'学习',reserve:'预约',life:'生活',info:'信息',schedule:'课表'} as Record<string,string>)[e.id]??navName(e),kind:'page' as const,page:e.page,params:e.params}));
 for(const [id,title] of [["reserve","预约"],["info","信息"]] as const){if(!pages.some(p=>p.id==="page:"+id))pages.push({id:"page:"+id,title,kind:"page",page:id,params:undefined});}
 const saved:QuickEntry[]=[...userOnePages().map(b=>({id:'board:'+b.id,title:b.name,kind:'board' as const,target:b.id})),...explorerSnapshot().workspaces.map(w=>({id:'workspace:'+w.id,title:w.name,kind:'workspace' as const,target:w.id}))];
 saved.sort((a,b)=>(order.indexOf(a.id)<0?1e6:order.indexOf(a.id))-(order.indexOf(b.id)<0?1e6:order.indexOf(b.id)));
 return [...pages,...saved];
}
export function useQuickEntries():{entries:QuickEntry[];slots:string[]}{
 const slots=useSyncExternalStore(subscribeQuick,()=>shot,()=>shot);useEntryListVersion();
 return {entries:quickEntries(),slots};
}
/** 实用模式的四个入口 + 全量功能清单（第五格「更多功能」不参与配置）。 */
export function usePracticalEntries():{entries:QuickEntry[];slots:string[]}{
 const slots=useSyncExternalStore(subscribeQuick,practicalSlots,practicalSlots);useEntryListVersion();
 return {entries:quickEntries(),slots};
}
/** 功能清单会随 explorer（工作区）/ OnePage / 快捷变化，订阅一次供两个 hook 共用。 */
function useEntryListVersion():void{
 const [,tick]=useState(0);
 useEffect(()=>{const f=()=>tick(x=>x+1);const a=subscribeExplorer(f),b=subscribeQuick(f);window.addEventListener('onethu.boards.changed',f);return()=>{a();b();window.removeEventListener('onethu.boards.changed',f);};},[]);
}
export function openQuickEntry(e:QuickEntry):void{
 if(e.kind==='workspace'&&e.target)openWorkspace(e.target);
 else if(e.kind==='board'&&e.target){openOnePage(e.target);openTab('board',null,{title:e.title});}
 else if(e.page)openTab(e.page,e.params??null,{title:e.title});
}
