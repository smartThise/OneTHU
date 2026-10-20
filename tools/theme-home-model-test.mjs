import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {StyleDirector} from '../packages/gui/src/pipeline/director.ts';
import {themeFromVars} from '../packages/gui/src/pipeline/theme.ts';
import {parseColor,contrast} from '../packages/gui/src/pipeline/color.ts';
import {homeStarterItems,migrateHomeCanvas,defaultBoardDoc,rectOf,SYSTEM_BOARD_ID,pxBoardItem} from '../apps/desktop/src/state/boardCore.ts';
let checks=0;const check=(c,m)=>{assert.ok(c,m);checks++};
const src=readFileSync('apps/desktop/src/state/theme.ts','utf8');
const builtins=Function(src.slice(src.indexOf('const BUILTIN_THEMES:'),src.indexOf('const STORE_KEY')).replace('const BUILTIN_THEMES: ThemeDef[]','const BUILTIN_THEMES')+'return BUILTIN_THEMES;')();
const props=new Map(),root={dataset:{},style:{setProperty:(k,v)=>props.set(k,v),removeProperty:k=>props.delete(k)}};
const d=new StyleDirector();d.mount(root,{storage:null});
for(const def of builtins){
 const theme=themeFromVars(def.id,def.vars,def.dark?'dark':'light',def.fonts);d.set({theme,scheme:def.dark?'dark':'light'});
 for(const role of ['surface-0','surface-1','surface-2','surface-3','surface-4','surface-overlay'])if(theme.roles[role])check(props.get('--og-'+role)===theme.roles[role],def.id+' '+role);
 if(theme.roles['surface-1'])for(const ink of ['content-1','content-2','content-3'])check(contrast(parseColor(theme.roles[ink]),parseColor(theme.roles['surface-1']))>=4.49,def.id+' readable '+ink);
 check(!props.has('--og-action')&&!props.has('--og-action-on'),'themes cannot overwrite action pair');
 d.set({theme:null});check(props.size===0,'clear whole palette '+def.id);
}
const custom=themeFromVars('test',{'--surface':'#202030','--text-1':'#242424','--font-ui':'Example, sans-serif','--r-md':'18px','--og-action':'#ff0000','--og-content-2':'#303030'},'dark');
d.set({theme:custom});check(props.get('--og-font-ui')==='Example, sans-serif','custom font injected');check(props.get('--og-radius-md')==='18px','custom shape injected');check(contrast(parseColor(custom.roles['content-2']),parseColor(custom.roles['surface-1']))>=4.49,'partial palette repairs contrast');d.set({theme:themeFromVars('next',{},'light')});check(!props.has('--og-font-ui')&&!props.has('--og-radius-md'),'partial theme clears previous typography/shape');
const starter=homeStarterItems();check(starter.length===13,'thirteen starter components');check(starter.every((a,i)=>starter.every((b,j)=>i===j||rectOf(a).x+rectOf(a).w<=rectOf(b).x||rectOf(b).x+rectOf(b).w<=rectOf(a).x||rectOf(a).y+rectOf(a).h<=rectOf(b).y||rectOf(b).y+rectOf(b).h<=rectOf(a).y)),'starter no overlaps');
const note=pxBoardItem('authored-note',{kind:'custom',id:'note',props:{text:'keep my note',tone:'yellow'}},{x:220,y:138,w:286,h:176});
const doc={v:1,order:{},activeBoardId:SYSTEM_BOARD_ID,boards:[{id:SYSTEM_BOARD_ID,name:'首页',kind:'system',icon:'today',cells:{portrait:[note]}},{id:'user',name:'user',kind:'user',icon:'today',cells:{portrait:[note]}}]};
const migrated=migrateHomeCanvas(doc);check(migrated.boards[0].cells.portrait.length===4,'adds former fixed chrome');const kept=migrated.boards[0].cells.portrait.find(it=>it.id==='authored-note');check(kept.spec.props.text==='keep my note'&&kept.rect.x===220&&kept.rect.w===286,'migration preserves authored note');check(migrated.boards[1]===doc.boards[1],'user board unchanged');check(migrateHomeCanvas(migrated)===migrated,'migration idempotent');const deleted={...migrated,boards:[{...migrated.boards[0],cells:{portrait:[kept]}},migrated.boards[1]]};check(migrateHomeCanvas(deleted)===deleted,'deletions never resurrect');
console.log(`${checks} theme/home model assertions passed`);
