import {useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent} from "react";
import {useExperienceMode} from "../../state/experienceMode.js";
import {DEFAULT_ONESHOT,MORE_FEATURES_SLOT,setPracticalOneShot,usePracticalEntries,useQuickEntries,openQuickEntry,setOneShot,type QuickEntry} from '../../state/quickAccess.js';
import {Btn, Select, SettingsRow} from '@onethu/gui';
import {NAV} from '../Layout.js';
import {FolderIcon, IconSpark} from '../Icons.js';
import {IconMore} from '../Icons.js';
import {PracticalFeaturesPanel} from './PracticalFeatures.js';
import {showToast} from '../../state/toast.js';
import { t as i18n } from "../../i18n/index.js";

export function QuickIcon({entry}:{entry?:QuickEntry}){const Icon=NAV.find(n=>n.page===entry?.page)?.icon;return Icon?<Icon/>:<FolderIcon name={entry?.kind==='workspace'?'folder':'star'} width={18} height={18}/>;}

/** 课表页「快捷」小按钮的拖动位置（离默认位往上拖了多少 px）；跨会话记住，按设备存。 */
const SCHEDULE_OFFSET_KEY = "onethu.quickbar.schedule-offset.v1";
const TOGGLE_TOP_MARGIN = 96; /* 拖动上限：按钮顶部不高于这条线（避开顶栏与标签条） */
function readScheduleOffset(): number {
  try {
    const v = Number(localStorage.getItem(SCHEDULE_OFFSET_KEY));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch { return 0; }
}

/** 五个超级快捷入口。极简=固定五个；实用=左边四个可改 + 第五格「更多功能」；完整=用户自选五个。
 *  课表页（scheduleMode）：默认收成一枚小按钮浮在「日程设置」上方，不压住底部日程；
 *  按钮可上下拖动（位置记忆），点开/收起带展开动效。 */
export function OneShot({scheduleMode=false}:{scheduleMode?:boolean}){
  const {entries,slots:saved}=useQuickEntries();
  const {slots:practical}=usePracticalEntries();
  const mode=useExperienceMode();
  const practicalMode=mode==="practical";
  const [moreOpen,setMoreOpen]=useState(false);
  /** 「放进入口」进行中：面板收起，底部四个入口亮编号，点哪个就放进哪个；Esc 取消。 */
  const [placing,setPlacing]=useState<{id:string;title:string}|null>(null);
  /** 课表页专用：五连条默认收起，避免压住底部日程。 */
  const [scheduleOpen,setScheduleOpen]=useState(false);
  /** 课表页小按钮的上拖距离（px）与拖动中标记。 */
  const [dragOffset,setDragOffset]=useState<number>(readScheduleOffset);
  const [dragging,setDragging]=useState(false);
  const dragRef=useRef<{startY:number;startOffset:number;top:number;moved:boolean}|null>(null);
  const skipClick=useRef(false);
  useEffect(()=>{setScheduleOpen(false);},[scheduleMode]);
  useEffect(()=>{
    if(!placing)return;
    const onKey=(e:KeyboardEvent)=>{if(e.key==="Escape")setPlacing(null);};
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[placing]);
  useEffect(()=>{setMoreOpen(false);setPlacing(null);},[mode]);
  /* 窗口变小/旋转时把拖动位置收回可用范围（按钮顶部不低于 TOGGLE_TOP_MARGIN） */
  useEffect(()=>{
    if(!scheduleMode)return;
    const onResize=()=>{
      setDragOffset((v)=>{
        if(v<=0)return v;
        const el=document.querySelector<HTMLElement>(".oneshot-schedule-toggle");
        if(!el)return v;
        const over=TOGGLE_TOP_MARGIN-el.getBoundingClientRect().top;
        return over>0?Math.max(0,v-over):v;
      });
    };
    window.addEventListener("resize",onResize);
    return()=>window.removeEventListener("resize",onResize);
  },[scheduleMode]);
  const place=(i:number)=>{if(!placing)return;setPracticalOneShot(i,placing.id);showToast(`已放进入口 ${i+1}（${placing.title}）`);setPlacing(null);};
  const slots=mode==="simple"?DEFAULT_ONESHOT:practicalMode?[...practical,MORE_FEATURES_SLOT]:saved;
  const collapsed=scheduleMode&&!scheduleOpen&&!placing;
  const slotNodes=slots.map((id,i)=>{
    if(practicalMode&&id===MORE_FEATURES_SLOT)return <Btn key={i} className="oneshot-button" icon={<IconMore width={18} height={18}/>} aria-expanded={moreOpen} onClick={()=>setMoreOpen(true)} titleAttr={i18n("auto.components.explorer.OneShot.1")}>{i18n("auto.components.explorer.OneShot.2")}</Btn>;
    if(placing&&i<4)return <Btn key={i} className="oneshot-button is-place-target" onClick={()=>place(i)} titleAttr={`用「${placing.title}」替换「${entries.find(e=>e.id===id)?.title??"此入口"}」`} aria-label={`入口 ${i+1}：放${placing.title}`}><span className="oneshot-place-badge" aria-hidden="true">{i+1}</span>{entries.find(e=>e.id===id)?.title??"此入口"}</Btn>;
    const e=entries.find(x=>x.id===id);
    return <Btn key={i} className="oneshot-button" icon={<QuickIcon entry={e}/>} onClick={()=>e&&openQuickEntry(e)} disabled={!e} titleAttr={e?.title??'此快捷入口已删除，请在「更多功能」里重新选择'}>{e?.title??'入口已删除'}</Btn>;
  });
  const featuresPanel=practicalMode?<PracticalFeaturesPanel open={moreOpen} onClose={()=>setMoreOpen(false)} slots={practical} onPlace={(f)=>{setMoreOpen(false);setPlacing(f);}}/>:null;
  const placementBar=placing?<div className="oneshot-placement" role="status"><span>{i18n("auto.components.explorer.OneShot.3")}<strong>{placing.title}</strong> {i18n("auto.components.explorer.OneShot.4")}</span><Btn variant="ghost" size="sm" onClick={()=>setPlacing(null)}>{i18n("auto.components.explorer.OneShot.5")}</Btn></div>:null;

  /* ── 课表页：小按钮可上下拖动（记住位置），点按展开/收起 ── */
  const onTogglePointerDown=(e:ReactPointerEvent<HTMLSpanElement>)=>{
    if(e.button!==0)return;
    const el=e.currentTarget;
    const rect=el.getBoundingClientRect();
    dragRef.current={startY:e.clientY,startOffset:dragOffset,top:rect.top,moved:false};
    el.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onTogglePointerMove=(e:ReactPointerEvent<HTMLSpanElement>)=>{
    const d=dragRef.current;
    if(!d)return;
    const dy=d.startY-e.clientY;
    if(Math.abs(dy)>3)d.moved=true;
    const maxUp=Math.max(0,d.startOffset+(d.top-TOGGLE_TOP_MARGIN));
    setDragOffset(Math.max(0,Math.min(d.startOffset+dy,maxUp)));
  };
  const onTogglePointerUp=(e:ReactPointerEvent<HTMLSpanElement>)=>{
    const d=dragRef.current;
    if(!d)return;
    dragRef.current=null;
    setDragging(false);
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
    if(!d.moved)return;
    skipClick.current=true;
    try{localStorage.setItem(SCHEDULE_OFFSET_KEY,String(Math.round(dragOffset)));}catch{/* 存不下就只记内存 */}
  };
  const onToggleClick=()=>{
    if(skipClick.current){skipClick.current=false;return;}
    setScheduleOpen(v=>!v);
  };

  if(scheduleMode)return <nav
    className={"oneshot is-schedule"+(collapsed?" is-collapsed":"")+(placing?" is-placing":"")+(dragging?" is-dragging":"")}
    aria-label={i18n("auto.components.explorer.OneShot.6")}
    style={{"--oneshot-drag":`${dragOffset}px`} as CSSProperties}
  >
    {placementBar}
    <div className={"oneshot-slots-wrap"+(collapsed?" is-collapsed":"")} aria-hidden={collapsed||undefined}>
      <div className="oneshot-slots">{slotNodes}</div>
    </div>
    <span
      className="oneshot-schedule-drag"
      onPointerDown={onTogglePointerDown}
      onPointerMove={onTogglePointerMove}
      onPointerUp={onTogglePointerUp}
      onPointerCancel={onTogglePointerUp}
      onClick={onToggleClick}
    >
      <Btn
        className="oneshot-schedule-toggle"
        variant="solid" tone="brand" size="sm"
        icon={<IconSpark width={16} height={16}/>}
        aria-expanded={!collapsed}
        aria-label={collapsed?"展开快捷入口":"收起快捷入口"}
        titleAttr={collapsed?"快捷入口：点开展开；按住可上下拖动位置":"收起快捷入口；按住可上下拖动位置"}
      >{i18n("auto.components.explorer.OneShot.7")}</Btn>
    </span>
    {featuresPanel}
  </nav>;

  return <nav className={"oneshot"+(placing?" is-placing":"")} aria-label={i18n("auto.components.explorer.OneShot.6")}>
    {placementBar}
    {slotNodes}
    {featuresPanel}
  </nav>;
}
export function OneShotSettings(){const {entries,slots}=useQuickEntries();return <div className="oneshot-settings">{slots.map((id,i)=><SettingsRow key={i} title={`快捷按钮 ${i+1}`} control={<Select aria-label={`OneShot 快捷按钮 ${i+1}`} value={id} onChange={v=>setOneShot(i,v)}>{!entries.some(e=>e.id===id)?<option value={id}>{i18n("auto.components.explorer.OneShot.8")}</option>:null}{(['page','board','workspace'] as const).map(kind=><optgroup key={kind} label={kind==='page'?'功能与服务':kind==='board'?'OnePage':'工作区'}>{entries.filter(e=>e.kind===kind).map(e=><option key={e.id} value={e.id}>{e.title}</option>)}</optgroup>)}</Select>}/> )}</div>;}
