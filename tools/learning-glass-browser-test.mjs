/** Learning material regression: real UI, fictional accounts, synthetic wallpaper only. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setup, call, close, browser } from './capture-public-preview.mjs';
import { closeTestBrowser } from './lib/onboarding-browser-steps.mjs';
const out = process.env.ONETHU_TEST_OUT ?? '/tmp/onethu-learning-glass';
mkdirSync(out, { recursive: true });
const checks = [], samples = [], errors = [];
const check = (value, label) => { assert.ok(value, label); checks.push(label); console.log('✓ '+label); };
const material = locator => locator.evaluate(e => {
 const s = getComputedStyle(e); const chain=[];
 for(let p=e.parentElement;p;p=p.parentElement){const a=getComputedStyle(p);if(a.maskImage!=='none'||a.filter!=='none'||Number(a.opacity)<1||a.backdropFilter!=='none')chain.push({cls:p.className,mask:a.maskImage,filter:a.filter,opacity:a.opacity,blur:a.backdropFilter});}
 return {bg:s.backgroundColor,blur:s.backdropFilter,mask:s.maskImage,border:s.borderColor,padding:s.padding,ancestors:chain};
});
async function wallpaper(page, dark) {
 const image=await page.evaluate(dark=>{
   const c=document.createElement('canvas');c.width=1617;c.height=1073;const x=c.getContext('2d');
   const g=x.createLinearGradient(0,0,c.width,c.height);g.addColorStop(0,dark?'#182b48':'#f1d4c7');g.addColorStop(.5,dark?'#3d263e':'#b8d6ed');g.addColorStop(1,dark?'#123a36':'#d7e0b9');x.fillStyle=g;x.fillRect(0,0,c.width,c.height);
   // Fine linework deliberately stresses translucency; it contains no personal image.
   for(let yy=0;yy<c.height;yy+=12)for(let xx=0;xx<c.width;xx+=12){x.fillStyle=(xx/12+yy/12)%2===0?(dark?'#f0d5b899':'#15395677'):(dark?'#10182599':'#faf0df99');x.fillRect(xx,yy,6,6);}
   return c.toDataURL();
 },dark);
 await page.evaluate(async image=>{
   const source=await (await fetch('/src/components/explorer/WallpaperVideo.tsx')).text();
   const url=[...source.matchAll(/"([^" ]+)"/g)].map(m=>m[1]).find(u=>u.startsWith('/src/state/wallpaper.ts'));
   (await import(url)).setGlobalWallpaper(image);
 },image);
 await page.evaluate(dark=>{document.documentElement.dataset.scheme=dark?'dark':'light';},dark);
 await call(page,'/src/lib/glassLevel.ts','setGlassLevel',['clear']);
 await page.waitForTimeout(1600);
}
let passed=false, active;
try {
 for (const [width,height,label] of [[1617,1073,'tablet'],[390,844,'phone']]) {
  const {page,context}=await setup(width,height,'full',{hasTouch:true});active=page;
  page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(async()=>{
   const source=await (await fetch('/src/pages/learn/AssignmentDetailPage.tsx')).text();
   const url=[...source.matchAll(/"([^" ]+)"/g)].map(m=>m[1]).find(u=>u.startsWith('/src/lib/clients.ts'));
   const {learn}=await import(url??'/src/lib/clients.ts');
   learn.getHomeworkPageDetail=async()=>({hasSubmitForm:true,description:'示例作业说明'});
  });
  await call(page,'/src/state/explorer.ts','openTab',['tasks']);
  const scope=page.locator('[data-tab-page="tasks"]:visible');
  await scope.locator('.hw-card.is-cur').waitFor();
  if(label==='tablet') {
   await scope.locator('.hw-card.is-cur').click();
   await scope.locator('.tasks-detail-slot:not(.is-hidden) .og-pagehead').waitFor();
  }
  for(const dark of [false,true]) {
   await wallpaper(page,dark);
   const mode=dark?'dark':'light';
   const selected = scope.locator('.hw-card.is-cur');
   const surfaces={card:await material(selected),filter:await material(scope.locator('.hw-filter-select')),notice:await material(scope.locator('.notice-strip'))};
   if(label==='tablet')surfaces.header=await material(scope.locator('.tasks-detail-slot:not(.is-hidden) .og-pagehead'));
   samples.push({label,mode,surfaces});
   // Cards may use the shared lens filter (url(#og-lens-*), blur inside SVG) instead of a raw blur().
   const hasBlur = blur => blur.includes('blur(') || /url\(["']?#og-lens-/.test(blur);
   for(const [name,s] of Object.entries(surfaces))check(hasBlur(s.blur)&&s.bg!=='rgba(0, 0, 0, 0)'&&!s.bg.endsWith('/ 1)'),`${label} ${mode} ${name} uses translucent material`);
   check(surfaces.card.ancestors.length===0,`${label} ${mode} carousel samples wallpaper without a masked backdrop root`);
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${label} ${mode} fits viewport width`);
   const probe=await selected.locator('.hw-card-title').evaluate(e=>window.__txProbe(e));
   samples.push({label,mode,probe});
   samples.push({label,mode,cardText:await selected.locator('.hw-card-course,.hw-card-title,.hw-card-ddl-big,.hw-card-ddl-sub,.hw-card-act').evaluateAll(es=>es.map(e=>({class:e.className,probe:window.__txProbe(e),opacity:getComputedStyle(e).opacity,rect:e.getBoundingClientRect().toJSON()})))});
   check(probe.kind==='image'&&probe.layers.length>0,`${label} ${mode} contrast engine samples the real synthetic wallpaper and card layers`);
   await page.screenshot({path:`${out}/${label}-${mode}.png`});
   if(label==='tablet'&&!dark){
    await selected.screenshot({path:`${out}/card-blur.png`});
    const oldMask=await page.addStyleTag({content:'html:root[data-og-skin="glass"] .tasks-body .hw-carousel {mask-image:linear-gradient(to bottom,transparent 0%,black 16%,black 84%,transparent 100%);-webkit-mask-image:linear-gradient(to bottom,transparent 0%,black 16%,black 84%,transparent 100%)}'});
    await selected.screenshot({path:`${out}/card-old-mask.png`});await oldMask.evaluate(e=>e.remove());
    const ownMask=await page.addStyleTag({content:'html:root[data-og-skin="glass"] .tasks-body .hw-card {mask-image:linear-gradient(to bottom,transparent 0%,currentColor 16%,currentColor 84%,transparent 100%)}'});
    await selected.screenshot({path:`${out}/card-own-mask.png`});await ownMask.evaluate(e=>e.remove());
   }
  }
  if(label==='tablet'){
   const overlayBefore=await material(scope.locator('.notice-strip'));
   await call(page,'/src/lib/glassLevel.ts','setGlassLevel',['deep']);await page.waitForTimeout(400);
   check((await material(scope.locator('.notice-strip'))).bg!==overlayBefore.bg,'material intensity still changes notification opacity');
   const cdp=await context.newCDPSession(page);
   await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});await page.waitForTimeout(200);
   const reduced=await material(scope.locator('.notice-strip'));
   check(reduced.blur==='none'&&!reduced.bg.includes('/'),'reduced transparency uses opaque fallback without blur');
   await cdp.send('Emulation.setEmulatedMedia',{features:[]});
   await call(page,'/src/lib/glassLevel.ts','setGlassLevel',['balanced']);await page.waitForTimeout(200);
   check((await material(scope.locator('.hw-carousel'))).mask!=='none','neutral material keeps the original carousel edge mask');
   await call(page,'/src/lib/glassLevel.ts','setGlassLevel',['clear']);
   await page.waitForTimeout(400);
   check(await scope.locator('.hw-card').evaluateAll(es=>es.every(e=>getComputedStyle(e).opacity==='1')),'all visible carousel materials stay outside opacity backdrop groups');
   const beforeDrag=await scope.locator('.hw-card.is-cur').innerText();
   const rect=await scope.locator('.hw-card.is-cur').boundingBox();
   const point={x:rect.x+rect.width/2,y:rect.y+rect.height/2};
   await page.evaluate(()=>{window.__glassPointer=[];for(const t of ['pointerdown','pointermove','pointerup','pointercancel'])document.addEventListener(t,e=>window.__glassPointer.push({t,cls:e.target?.className,y:e.clientY,at:Date.now()}),true);});
   const hit=await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.className,point);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
   // The capture fixture freezes Date.now for deadlines; advance it explicitly
   // so the gesture's velocity estimator sees a real 30 ms interval.
   for(let n=1;n<=12;n++){await page.clock.setFixedTime(new Date(Date.parse('2026-10-21T02:00:00Z')+n*30));await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x,y:point.y-230*n/12}]});await page.waitForFunction(n=>window.__glassPointer.filter(e=>e.t==='pointermove').length>=n,n);}
   await page.waitForTimeout(120);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(1200);
   samples.push({gesture:{point,hit,before:beforeDrag,after:await scope.locator('.hw-card.is-cur').innerText(),events:await page.evaluate(()=>window.__glassPointer),cards:await scope.locator('.hw-card').evaluateAll(es=>es.map(e=>({text:e.textContent,style:e.getAttribute('style')})))}});
   check(await scope.locator('.hw-card.is-cur').innerText()!==beforeDrag,'actual touch swipe still advances the carousel');
   const before=await scope.locator('.hw-card.is-cur').innerText();
   await scope.locator('.hw-filter-select').selectOption({label:before.includes('数据结构')?'高等数学（1）':'数据结构（1）'});await page.waitForTimeout(500);
   check((await scope.locator('.hw-card.is-cur').innerText())!==before,'course filtering still changes the homework carousel');
  } else {
   await scope.locator('.hw-card.is-cur').click();
   const heading=page.locator('.page-anim[data-page="learn-assignment-detail"]:visible .page-head-host > .og-pagehead');
   await heading.waitFor();
   check((await material(heading)).blur.includes('blur('),'phone standalone homework heading receives the same reading surface');
   await page.screenshot({path:`${out}/phone-detail-dark.png`});
  }
  await close(page,context);active=null;
 }
 check(errors.length===0,'no page runtime errors');passed=true;
} catch(error) {
 if(active)await active.screenshot({path:`${out}/failure.png`}).catch(()=>{});
 throw error;
} finally {
 writeFileSync(`${out}/report.json`,JSON.stringify({passed,checks,samples,errors},null,2));
 await closeTestBrowser(browser);
}
