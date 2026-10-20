/** Theme/material and editable home regression. Vite must run on 5180. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const base=process.argv[2]??'http://127.0.0.1:5180', out='docs/onegui/theme-home';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
let checks=0;const errors=[],results=[];const check=(c,m)=>{assert.ok(c,m);checks++;};
const fixture={semester:{id:'2026-2027-1'},courses:[{id:'c1',name:'数据结构'},{id:'c2',name:'计算机系统'}],homework:Array.from({length:4},(_,i)=>({id:'hw'+i,courseId:i%2?'c2':'c1',title:['图与最短路径','缓存与存储层次','平衡树练习','系统实验报告'][i],deadline:`2026-10-${19+i} 23:59:00`,submitted:false,graded:false,audited:false})),notifications:[],files:[],schedule:[]};
const setup=async(p)=>{
 p.on('pageerror',e=>errors.push(e.message));await p.addInitScript(()=>localStorage.setItem('onethu.onboarded.phone','1'));
 await p.route('**/src/state/data.ts*',async route=>{const response=await route.fetch();let body=await response.text();for(const name of ['useLearnData','useCampusData'])body=body.replace(`export function ${name}() {`,`export function ${name}() { return {data:${JSON.stringify(fixture)},state:'ready',error:null,reload:async()=>{}};`);await route.fulfill({response,body});});
};
// Use Vite's actual module URL (including its HMR version). A second unversioned
// import creates a separate store, which cannot validate the mounted application.
const call=async(p,path,name,args=[])=>p.evaluate(async({path,name,args})=>{const url=performance.getEntriesByType('resource').map(r=>r.name).find(u=>new URL(u).pathname.endsWith(path));if(!url)throw Error('module not mounted '+path);const m=await import(url);return m[name](...args);},{path,name,args});
const go=async(p,q)=>{await p.goto(`${base}/?explorer-preview=${q}`,{waitUntil:'domcontentloaded'});await p.waitForSelector('.explorer-shell');await p.waitForTimeout(900);};
const board=async p=>p.evaluate(()=>JSON.parse(localStorage.getItem('onethu.board.v1')).boards.find(b=>b.id==='board.today').cells.portrait);
try{
 const p=await browser.newPage({viewport:{width:1280,height:840}});await setup(p);await go(p,'home');
 await p.screenshot({path:`${out}/home-1280.png`,fullPage:true});
 let items=await board(p);check(items.length===7,'default home has seven components');check(items.map(x=>x.spec.id??x.spec.kind).join(',')==='clock,text,services,homework,classes,news,cardEntry','requested default order');
 check(await p.locator('.homework-carousel-widget .hw-card').count()>1,'home reuses real homework carousel');
 const before=await board(p);const card=p.locator('.homework-carousel-widget .hw-carousel');await card.scrollIntoViewIfNeeded();const box=await card.boundingBox();await p.mouse.move(box.x+180,box.y+160);await p.mouse.down();await p.mouse.move(box.x+180,box.y+30,{steps:10});await p.mouse.up();await p.waitForTimeout(500);check(JSON.stringify(before)===JSON.stringify(await board(p)),'carousel gesture never moves board');
 const toolbar=p.locator('.board-viewport-tools');let tr=await toolbar.boundingBox();check(tr.y+tr.height<840,'toolbar inside viewport');await p.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await p.waitForTimeout(100);let tr2=await toolbar.boundingBox();check(Math.abs(tr.y-tr2.y)<1,'toolbar fixed while scrolling');
 check(await toolbar.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+30,r.y+20))}),'toolbar above board content');
 // Direct manipulation is the only mode now: drag the card body, then pull a corner.
 await p.locator('[data-item-id="home.clock"]').scrollIntoViewIfNeeded();
 const body=p.locator('[data-item-id="home.clock"] .chrome-clock-time');const br=await body.boundingBox();const old=(await board(p)).find(x=>x.id==='home.clock').rect;
 await p.mouse.move(br.x+br.width/2,br.y+br.height/2);await p.mouse.down();await p.mouse.move(br.x+br.width/2+90,br.y+br.height/2+48,{steps:10});await p.mouse.up();await p.waitForTimeout(150);
 const moved=(await board(p)).find(x=>x.id==='home.clock').rect;check(moved.x>old.x+60&&moved.y>old.y+30,'direct body drag moves persisted geometry');
 const resize=p.locator('[data-item-id="home.clock"] .fh-se');const rr=await resize.boundingBox();await p.mouse.move(rr.x+rr.width/2,rr.y+rr.height/2);await p.mouse.down();await p.mouse.move(rr.x+rr.width/2+48,rr.y+rr.height/2+24,{steps:6});await p.mouse.up();await p.waitForTimeout(150);const resized=(await board(p)).find(x=>x.id==='home.clock').rect;check(resized.w>moved.w&&resized.h>moved.h,'selected corner resize changes both dimensions');
 await p.keyboard.press('Shift+ArrowDown');await p.waitForTimeout(80);check((await board(p)).find(x=>x.id==='home.clock').rect.h>resized.h,'keyboard resizing');
 await p.locator('[data-item-id="home.clock"] .free-toolbar button[title="删除"]').click();await p.reload();await p.waitForTimeout(700);check(!(await board(p)).some(x=>x.spec.id==='clock'),'deleted clock stays deleted after reload');
 await toolbar.getByRole('button',{name:'放大',exact:true}).click();const zoomText=await toolbar.innerText();check(/125%/.test(zoomText),'viewport zoom works');await toolbar.getByRole('button',{name:'缩小',exact:true}).click();
 await p.screenshot({path:`${out}/home-carousel.png`});results.push('desktop gestures, fixed tools and persistence');
 // Actual theme UI, all builtins, all material levels, instant segment switches.
 await go(p,'settings-tab&settings-tab=外观与布局');const choices=p.locator('.theme-choice-main');check(await choices.count()===7,'one default theme entry');check((await choices.first().innerText()).includes('石墨'),'default renamed graphite');
 for(let i=0;i<await choices.count();i++){
  await choices.nth(i).click();await p.waitForTimeout(80);
  const palette=await p.evaluate(()=>({theme:document.documentElement.dataset.theme,style:document.documentElement.style.cssText,dark:document.documentElement.dataset.ogScheme}));
  if(i>0)check(/--og-surface-1:/.test(palette.style),'complete palette injected '+i);else check(!/--og-surface-1:/.test(palette.style),'default clears surface overrides');
  const bounds=await choices.nth(i).evaluate(e=>{const r=e.getBoundingClientRect(),s=e.querySelector('.theme-swatch').getBoundingClientRect();return {w:r.width,sw:s.width,left:s.left-r.left,right:s.right<=r.right};});check(bounds.w>260&&bounds.sw>50&&bounds.left>=0&&bounds.right,'swatch fits card '+i);
  const segments = await p.locator('.og-segment-item.is-active, .segmented button.is-active').evaluateAll(nodes => nodes.filter(e => e.getClientRects().length).map(e => ({fg:getComputedStyle(e).color,bg:getComputedStyle(e).backgroundColor})));
  check(segments.length > 0 && segments.every(c => c.fg !== c.bg && c.bg !== 'rgba(0, 0, 0, 0)'), 'segments own fill/ink across theme ' + i);
  for(const level of ['balanced','clear','rich','deep']){
   await call(p,'/src/lib/glassLevel.ts','setGlassLevel',[level]);await p.waitForTimeout(20);
   const mat=await p.locator('.settings-panel').evaluate(e=>({bg:getComputedStyle(e).backgroundColor,blur:getComputedStyle(e).backdropFilter}));check(level==='balanced'?mat.blur==='none':mat.blur!=='none'&&/\/|rgba/.test(mat.bg),'material applied '+i+level);
  }
 }
 await call(p,'/src/state/theme.ts','setDayNightTheme',['onethu.theme.celadon','onethu.theme.night']);
 await call(p,'/src/state/theme.ts','setFollowSystem',[true]);await p.waitForTimeout(40);
 check(await p.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--og-surface-1').trim())==='#fdfffe','day/night uses effective theme palette');
 await choices.filter({hasText:'紫水晶'}).click();check(!(await call(p,'/src/state/theme.ts','themeSchedule')).followSystem,'manual selection exits schedule');
 await p.evaluate(()=>{const root=document.documentElement;const style=document.createElement('style');style.id='onethu-dynamic-color';style.textContent='html[data-dynamic="on"]{--md-sys-color-secondary:#16604f;--md-sys-color-background:#eaf4ee;--md-sys-color-surface:#f0faf4;--md-sys-color-on-surface:#14352b;} html[data-dynamic="on"][data-scheme="dark"]{--md-sys-color-secondary:#8fd5b1;--md-sys-color-surface:#172c23;}';document.head.append(style);delete root.dataset.scheme;root.dataset.dynamic='on';window.dispatchEvent(new Event('onethu:dynamic-palette'));});await p.waitForTimeout(40);
 check(await p.evaluate(()=>document.documentElement.style.getPropertyValue('--og-surface-1'))==='#f0faf4','dynamic palette uses producer surfaces');
 await choices.first().click();check(!/--og-(surface|content|line|font|accent)-[\w-]+:/.test(await p.evaluate(()=>document.documentElement.style.cssText)),'returning graphite clears whole palette');
 await choices.filter({hasText:'清华紫'}).click();await call(p,'/src/lib/glassLevel.ts','setGlassLevel',['clear']);await p.screenshot({path:`${out}/theme-picker.png`});
 await call(p,'/src/state/explorer.ts','closeSettings');await p.waitForTimeout(300);
 await p.evaluate(()=>{const shell=document.querySelector('.explorer-shell');shell.classList.add('has-shell-wallpaper');const bg=document.createElement('div');bg.dataset.materialFixture='true';Object.assign(bg.style,{position:'fixed',inset:'0',zIndex:'0',background:'repeating-linear-gradient(125deg, #ced9ec 0px, #ced9ec 90px, #e5d5cb 90px, #e5d5cb 180px, #d2dfd3 180px, #d2dfd3 270px)'});shell.prepend(bg);});
 await p.screenshot({path:`${out}/glass-material.png`});
 await go(p,'page&page=tasks');await p.waitForTimeout(300);
 // Inspect foreground/background on actual active controls, not only token strings.
 for(const name of ['学习','生活','学习']){const btn=p.locator('.segmented button, .og-segment-item').filter({hasText:name}).first();if(await btn.count()){await btn.click();const c=await btn.evaluate(e=>({fg:getComputedStyle(e).color,bg:getComputedStyle(e).backgroundColor}));check(c.fg!==c.bg&&c.bg!=='rgba(0, 0, 0, 0)','active segment owns contrasting fill '+name);}}
 await p.close();
 for(const width of [900,390,320]){
  const m=await browser.newPage({viewport:{width,height:844}});await setup(m);await go(m,'home');await m.screenshot({path:`${out}/home-${width}.png`,fullPage:width<840});
  check(await m.locator('.board-viewport-tools').count()===1,'one toolbar '+width);
  if(width<840){const service=m.locator('[data-widget="services"]');const r=await service.boundingBox();check(r.height>=340,'services have room for all rows '+width);await service.scrollIntoViewIfNeeded();const all=await service.locator('.hs-dock-sphere').count();check(all===9,'all primary services present '+width);await m.locator('[data-item-id="home.clock"]').scrollIntoViewIfNeeded();await m.locator('[data-item-id="home.clock"] .chrome-clock-time').click();const _sorted=[...await board(m)].sort((a,b)=>a.rect.y-b.rect.y||a.rect.x-b.rect.x);const _next=_sorted[_sorted.findIndex(x=>x.id==='home.clock')+1];await m.locator('[data-item-id="home.clock"] button[title="下移"]').click();check((await board(m)).find(x=>x.id==='home.clock').rect.x===_next.rect.x,'phone can reorder clock '+width);}
  check(await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no document horizontal clipping '+width);await m.close();
 }
 check(errors.length===0,'no browser runtime errors: '+errors.join(';'));
 writeFileSync(`${out}/report.json`,JSON.stringify({checks,results,errors},null,2));console.log(`${checks} browser assertions passed`);
}finally{await browser.close();}
