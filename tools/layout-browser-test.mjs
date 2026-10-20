/** Real-browser regression for viewport clipping and overlapping chrome.
 * Run with Vite: node tools/layout-browser-test.mjs [http://127.0.0.1:5180]
 * Requires Playwright and Chrome (CHROME_BIN overrides the executable).
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const base = process.argv[2] ?? 'http://127.0.0.1:5180';
const out = process.env.ONETHU_TEST_OUTPUT ?? fileURLToPath(new URL('../docs/onegui/layout-fixes/', import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];
const errors = [];
let assertions = 0;
function check(value, label) { assert.ok(value, label); assertions++; }
const rect = (el) => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, w:r.width, h:r.height, right:r.right, bottom:r.bottom }; };
async function go(page, query) {
  await page.goto(`${base}/?explorer-preview=${query}`, { waitUntil:'domcontentloaded' });
  await page.waitForSelector('.explorer-topbar');
  await page.waitForTimeout(1500);
}
async function shot(page, name) { await page.screenshot({ path:out+name+'.png' }); }
async function scrollEnd(page, selector) {
  return page.locator(selector).evaluate(async (el) => {
    el.scrollTop = el.scrollHeight;
    await new Promise(requestAnimationFrame);
    return { scrollTop:el.scrollTop, max:el.scrollHeight-el.clientHeight };
  });
}
async function panelCheck(page, selector, label) {
  const r = await page.locator(selector).evaluate(rect);
  const vp = page.viewportSize();
  check(r.x >= -1 && r.y >= -1 && r.right <= vp.width+1 && r.bottom <= vp.height+1, label+' fits viewport '+JSON.stringify(r));
  return r;
}
async function headCheck(page) {
  const info = await page.locator('.dock-head').evaluate((head) => {
    const r = head.getBoundingClientRect();
    const buttons = [...head.querySelectorAll('button')].filter(e=>e.getClientRects().length).map(e=>({t:e.getAttribute('aria-label')||e.textContent, r:e.getBoundingClientRect()}));
    const outside = buttons.filter(b=>b.r.left<r.left-1||b.r.right>r.right+1||b.r.top<r.top-1||b.r.bottom>r.bottom+1).map(b=>b.t);
    const overlap=[];
    for(let i=0;i<buttons.length;i++)for(let j=i+1;j<buttons.length;j++){
      const a=buttons[i].r,b=buttons[j].r;
      if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)overlap.push([buttons[i].t,buttons[j].t]);
    }
    return {outside,overlap};
  });
  check(!info.outside.length && !info.overlap.length, 'OH buttons contained and separate '+JSON.stringify(info));
}
try {
  for (const [name,w,h] of [['desktop',1280,720],['small',900,600],['phone',390,844],['landscape',844,390],['narrow',320,568]].filter(([name])=>!process.env.LAYOUT_CASES||process.env.LAYOUT_CASES.split(',').includes(name))) {
    const page = await browser.newPage({ viewport:{width:w,height:h}, isMobile:w<600||h<600, hasTouch:w<600||h<600 });
    page.on('pageerror', e=>errors.push({name,message:e.message}));
    await page.addInitScript(()=>{
      localStorage.setItem('onethu.onboarded.phone','1');
      localStorage.setItem('onethu.dock.panelHeight','1600');
    });
    await go(page,'page&page=tasks');
    // A constrained ancestor must not hide the lower part of a tab.
    const clips = await page.locator('.tasks-body').evaluate(el=>{
      const issues=[];
      for(let e=el;e&&e!==document.body;e=e.parentElement){const s=getComputedStyle(e);if(['hidden','clip'].includes(s.overflowY)&&e.scrollHeight>e.clientHeight+2)issues.push({class:e.className,h:e.clientHeight,sh:e.scrollHeight});}
      return issues;
    });
    check(!clips.length, name+' task ancestors do not crop '+JSON.stringify(clips));
    await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
    const taskBottom = await page.locator('.tasks-body').evaluate(rect);
    const bar = await page.locator('.ex-bbar').evaluate(rect);
    check(taskBottom.bottom <= (h<600||w<600?bar.y:h)+1, name+' task bottom reachable above navigation');
    if(name==='landscape')await shot(page,'landscape-tasks-bottom');
    // Switch back with the mounted task tab still present: no hidden-tab :has() lock.
    await page.getByRole('button',{name:'首页',exact:true}).click();
    await page.waitForSelector('.home-tab');
    const homeClip = await page.locator('.explorer-content').evaluate(e=>({overflow:getComputedStyle(e).overflowY,h:e.clientHeight,sh:e.scrollHeight}));
    check(!['hidden','clip'].includes(homeClip.overflow)||homeClip.sh<=homeClip.h+2,name+' background task tab cannot lock home');
    const homePanel = page.locator('.explorer-panel.is-home-canvas');
    await page.waitForTimeout(400);
    const firstHomeHeight = await homePanel.evaluate(e=>e.clientHeight);
    await page.waitForTimeout(400);
    check(Math.abs(firstHomeHeight-await homePanel.evaluate(e=>e.clientHeight))<=2,name+' canvas height settles without observer feedback');
    const homeScroll = await homePanel.evaluate(e=>({h:e.clientHeight,sh:e.scrollHeight}));
    check(homeScroll.sh<=homeScroll.h+2,name+' home has no nested fixed-height vertical viewport');
    const intro = await page.locator('[data-item-id="home.services"]').evaluate(rect);
    check(intro.y>=0,name+' switching from a scrolled task tab restores home position');
    if(name==='phone')await shot(page,'phone-home');
    await go(page,'search');
    await panelCheck(page,'.dock-panel',name+' restored tall OH');
    await headCheck(page);
    await page.locator('.dock-panel').getByRole('tab',{name:'OH',exact:true}).click();
    await page.waitForSelector('.dock-oh-missing');
    await headCheck(page);
    // 「不裁」= 每一段都够得到：要么内容装得下，要么面板自己可滚。
    // 矮视口（横屏 844×390）面板被胶囊夹到 ~230px，头 + 输入区就要 270px+，
    // 现在按 @media (max-height:520px) 放开成 overflow-y:auto —— 可滚即不裁。
    const clamp = await page.locator('.dock-panel').evaluate(e=>({h:e.getBoundingClientRect().height,sh:e.scrollHeight,ch:e.clientHeight,oy:getComputedStyle(e).overflowY}));
    check(clamp.sh<=clamp.ch+2 || clamp.oy==='auto' || clamp.oy==='scroll',name+' OH shell does not crop chrome');
    // Dragging must respect available room as well as a saved height.
    const grip = await page.locator('.dock-handle').boundingBox();
    await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();
    await page.mouse.move(grip.x+grip.width/2,grip.y+(w>=600&&h>=600?500:-500),{steps:6});await page.mouse.up();
    await panelCheck(page,'.dock-panel',name+' dragged OH');
    if(name==='phone')await shot(page,'phone-oh');
    if(name==='landscape')await shot(page,'landscape-oh');
    await page.locator('.dock-panel').getByRole('button',{name:'收起',exact:true}).click();
    await page.waitForSelector('.dock-panel',{state:'detached'});
    await go(page,'overlay-plugins');
    await panelCheck(page,'.settings-panel',name+' plugin settings');
    const plugin = await page.locator('.explorer-settings-body').evaluate(el=>{
      const p=el.getBoundingClientRect(),title=el.querySelector('.og-pagehead-main').getBoundingClientRect();
      return {pad:title.left-p.left,mainW:title.width,sw:el.scrollWidth,cw:el.clientWidth,duplicates:el.querySelectorAll('.level-box').length};
    });
    check(plugin.pad>=12&&plugin.mainW>=148&&plugin.sw<=plugin.cw+1&&!plugin.duplicates,name+' plugin header readable '+JSON.stringify(plugin));
    const end = await scrollEnd(page,'.explorer-settings-body');check(Math.abs(end.scrollTop-end.max)<=1,name+' plugin last content scrollable');
    if(name==='phone'){await page.locator('.explorer-settings-body').evaluate(e=>e.scrollTop=0);await shot(page,'phone-plugins');}
    await go(page,'settings-tab');
    const tabs = page.locator('.workbench-settings-tabs [role=tab]');
    for(let i=0;i<await tabs.count();i++){
      await page.locator('.explorer-settings-body').evaluate(e=>e.scrollTop=0);
      await tabs.nth(i).click();
      const info = await page.locator('.explorer-settings-body').evaluate(e=>({sw:e.scrollWidth,cw:e.clientWidth}));
      check(info.sw<=info.cw+1,name+' settings tab '+i+' no horizontal loss');
      const clippedControls = await page.locator('.workbench-settings-content').evaluate(e=>[...e.querySelectorAll('.og-settings-row-control')].filter(e=>e.getClientRects().length && e.scrollWidth>e.clientWidth+2).map(e=>e.textContent));
      check(!clippedControls.length,name+' settings tab '+i+' controls fit their row '+JSON.stringify(clippedControls));
      const e=await scrollEnd(page,'.explorer-settings-body');check(Math.abs(e.scrollTop-e.max)<=1,name+' settings tab '+i+' bottom reachable');
    }
    await go(page,'onego');
    await panelCheck(page,'.ex-sheet',name+' OneGO half');
    const shell = await page.locator('.ex-sheet').evaluate(e=>({sh:e.scrollHeight,ch:e.clientHeight}));
    check(shell.sh<=shell.ch+2,name+' OneGO body fits, chrome stays visible '+JSON.stringify(shell));
    const bodyRect = await page.locator('.ex-sheet-body').evaluate(rect);
    check(bodyRect.h>=64,name+' OneGO half leaves a usable reading area');
    const e=await scrollEnd(page,'.ex-sheet-body');check(Math.abs(e.scrollTop-e.max)<=1,name+' OneGO bottom reachable');
    if(name==='landscape')await shot(page,'landscape-onego');
    if(w<600||h<600){
      const g=await page.locator('.ex-sheet-grip').boundingBox();await page.mouse.move(g.x+g.width/2,g.y+g.height/2);await page.mouse.down();await page.mouse.move(g.x+g.width/2,2,{steps:6});await page.mouse.up();
      await page.waitForTimeout(350);
      await panelCheck(page,'.ex-sheet',name+' OneGO full');
    }
    results.push({name,w,h,passed:true});console.log(name+' passed');await page.close();
  }
  // Edge menu and keyboard-height regression on a phone viewport.
  const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await page.addInitScript(()=>localStorage.setItem('onethu.onboarded.phone','1'));
  await go(page,'page&page=tasks');
  await page.locator('.explorer-panel[data-tab-page="tasks"]').evaluate(e=>e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:386,clientY:840})));
  await page.waitForTimeout(150);
  await panelCheck(page,'.explorer-ctxmenu','bottom-right context menu');await shot(page,'edge-menu');
  await page.keyboard.press('Escape');
  await go(page,'search');
  await page.evaluate(()=>{
    const viewport = window.visualViewport;
    Object.defineProperties(viewport,{height:{configurable:true,value:420},offsetTop:{configurable:true,value:0}});
    viewport.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(100);
  const keyboardPanel=await page.locator('.dock-panel').evaluate(rect);
  check(keyboardPanel.bottom<=420&&keyboardPanel.y>=0,'OH fits simulated keyboard visual viewport '+JSON.stringify(keyboardPanel));
  await page.close();
  const penPage = await browser.newPage({viewport:{width:1280,height:720}});
  await penPage.addInitScript(()=>localStorage.setItem('onethu.onboarded.phone','1'));
  await go(penPage,'home');
  const originalBoard = await penPage.evaluate(()=>localStorage.getItem('onethu.board.v1'));
  check(await penPage.locator('.board-pen').count()===0,'inactive empty pen does not create invisible scroll overflow');
  await penPage.getByRole('button',{name:'画笔',exact:true}).click();
  const pen = penPage.locator('.board-pen');
  check((await pen.evaluate(rect)).h===2400,'pen keeps its existing coordinate height');
  await penPage.mouse.move(200,610);await penPage.mouse.down();await penPage.mouse.move(260,640,{steps:6});await penPage.mouse.up();
  await penPage.waitForTimeout(100);
  check(await pen.locator('polyline').count()>0,'pen drawing persists a stroke');
  await penPage.getByRole('button',{name:'放大',exact:true}).click();
  check((await pen.evaluate(rect)).h===2400,'zoom does not stretch stored pen coordinates');
  await penPage.getByRole('button',{name:'画笔',exact:true}).click();
  check(await pen.isVisible(),'stored marks remain visible with pen off');
  check(await penPage.evaluate(()=>localStorage.getItem('onethu.board.v1'))===originalBoard,'pen and zoom preserve saved card positions');
  await penPage.getByRole('button',{name:'画笔',exact:true}).click();
  await penPage.locator('.free-pen-panel').getByRole('button',{name:'清空',exact:true}).click();
  await penPage.getByRole('button',{name:'画笔',exact:true}).click();
  check(await penPage.locator('.board-pen').count()===0,'cleared inactive pen releases blank scroll area');
  await penPage.close();
  check(errors.length===0,'no runtime errors '+JSON.stringify(errors));
  writeFileSync(out+'report.json',JSON.stringify({assertions,results,errors},null,2));
  console.log(`${assertions} browser assertions passed`);
} finally { await browser.close(); }
