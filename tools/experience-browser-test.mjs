import { installFakeOrganization } from './lib/fake-org.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {installXiaodaTourFixture} from './lib/xiaoda-tour-fixture.mjs';
import {installFakeCloud} from './lib/fake-cloud.mjs';
import {walkFullOnboarding,closeTestBrowser,advanceOnboardingLanguage} from './lib/onboarding-browser-steps.mjs';
const out='docs/onegui/experience-mode';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-updater-scheduler']});
let passed=false;const checks=[],errors=[];const check=(v,n)=>{assert.ok(v,n);checks.push(n);console.log('✓ '+n);};
const call=(p,path,name,args=[])=>p.evaluate(async({path,name,args})=>{const url=performance.getEntriesByType('resource').map(x=>x.name).find(x=>new URL(x).pathname.endsWith(path));if(!url)throw Error(path);return (await import(url))[name](...args);},{path,name,args});
async function setup(width=1280,height=860){const p=await browser.newPage({viewport:{width,height},hasTouch:width<600});p.setDefaultTimeout(10000);await p.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/,()=>{});p.on('pageerror',e=>{if(!/reading 'invoke'/.test(e.message))errors.push(e.message);});await installFakeCloud(p);await installXiaodaTourFixture(p);await installFakeOrganization(p);await p.addInitScript(()=>{performance.setResourceTimingBufferSize(10000);localStorage.setItem('onethu.onboarded.phone','1');Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>window.__copied=t}});});await p.route('**/src/state/data.ts*',async route=>{const r=await route.fetch();let body=await r.text();for(const n of ['useLearnData','useCampusData'])body=body.replace(`export function ${n}() {`,`export function ${n}() {return {data:{semester:{id:'x'},courses:[],homework:[],notifications:[],files:[],schedule:[]},state:'ready',error:null,reload:async()=>{}};`);await route.fulfill({response:r,body});});await p.goto('http://127.0.0.1:5180/?explorer-preview=home');await p.locator('.explorer-shell').waitFor();await p.waitForTimeout(800);return p;}
const mode=(p,m)=>call(p,'/src/state/experienceMode.ts','setExperienceMode',[m]);
const toastWait=(p,text)=>p.locator('.toast-host').filter({hasText:text}).first().waitFor({timeout:6000});const nav=(p,page,params=null)=>call(p,'/src/state/explorer.ts','openTab',[page,params]);
try{
 const p=await setup();
 check(await p.locator('.oneshot button').count()===5,'完整模式五个 OneShot');
 await nav(p,'learn');await nav(p,'life');await p.waitForTimeout(500);
 const saved=await p.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>/explorer|board|oneshot|onepage/.test(k))));
 await mode(p,'simple');await p.locator('.simple-home').waitFor();
 check(JSON.stringify(await p.locator('.oneshot button').allTextContents())===JSON.stringify(['学习','预约','生活','信息','课表']),'极简五个固定入口');
 check(await p.locator('.explorer-topbar,.ex-rail,.onego-bookmarks,.vault-box-button').count()===0,'极简隐藏标签、OneGO 和暂存箱');
 check(await p.locator('.simple-home section').count()===2,'固定首页仅待办和课程');
 await p.screenshot({path:out+'/simple-desktop.png'});
 await p.locator('.oneshot button').nth(4).click();await p.locator('[data-simple-page="schedule"]').waitFor();
 check(await p.locator('.simple-panel .schedule-workspace').isVisible(),'极简课表可导航');
 await p.screenshot({path:out+'/simple-schedule.png'});
 /* 课表页：OneShot 收成一枚小按钮，浮在「日程设置」上方，不压住底部日程；点开可展开、可拖动 */
 check(await p.locator('.oneshot.is-schedule.is-collapsed .oneshot-schedule-toggle').count()===1,'课表页 OneShot 默认收起成小按钮');
 const slotH=()=>p.locator('.oneshot-slots').evaluate(e=>e.getBoundingClientRect().height);
 check((await slotH())<1,'收起时五连条高度归零');
 const oneshotGeo=await p.evaluate(()=>{const t=document.querySelector('.oneshot-schedule-toggle')?.getBoundingClientRect();const d=document.querySelector('.schedule-dock')?.getBoundingClientRect();return t&&d?{toggleBottom:Math.round(t.bottom),dockTop:Math.round(d.top)}:null;});
 check(!!oneshotGeo&&oneshotGeo.toggleBottom<=oneshotGeo.dockTop,'收起按钮在日程设置上方，未压住日程');
 await p.screenshot({path:out+'/simple-schedule-oneshot-collapsed.png'});
 await p.locator('.oneshot-schedule-toggle').click();await p.waitForTimeout(90);
 const midH=await slotH();await p.waitForTimeout(420);
 const openH=await slotH();
 check(openH>16&&midH>0.5&&midH<openH-1,'展开有过渡动效（中途高度在两者之间）');
 check(await p.locator('.oneshot-slots .oneshot-button').count()===5,'点开小按钮恢复五连条');
 await p.screenshot({path:out+'/simple-schedule-oneshot-expanded.png'});
 await p.locator('.oneshot-schedule-toggle').click();await p.waitForTimeout(450);
 check((await slotH())<1,'再点一次可收起');
 const oneshotTop=()=>p.locator('.oneshot-schedule-toggle').evaluate(e=>e.getBoundingClientRect().top);
 const topBeforeDrag=await oneshotTop();
 const tb=await p.locator('.oneshot-schedule-toggle').boundingBox();
 await p.mouse.move(tb.x+tb.width/2,tb.y+tb.height/2);await p.mouse.down();
 for(let i=1;i<=6;i++){await p.mouse.move(tb.x+tb.width/2,tb.y+tb.height/2-20*i,{steps:2});await p.waitForTimeout(20);}
 await p.mouse.up();await p.waitForTimeout(400);
 const topAfterDrag=await oneshotTop();
 const savedOffset=Number(await p.evaluate(()=>localStorage.getItem('onethu.quickbar.schedule-offset.v1')));
 check(topBeforeDrag-topAfterDrag>80&&savedOffset>80,'快捷按钮可上下拖动并记住位置');
 check((await slotH())<1,'拖动不会误触发展开');
 await nav(p,'vault');check(await p.locator('[data-simple-page="schedule"]').count()===1,'完整模式专属页不会泄露到极简');
 await p.getByRole('button',{name:'设置',exact:true}).click();await p.locator('.simple-settings').waitFor();
 check(await p.locator('.settings-seg').count()===0,'极简设置无名片或插件分栏');
 await p.screenshot({path:out+'/simple-settings.png'});
 await p.getByRole('button',{name:'关闭设置',exact:true}).click();await p.waitForTimeout(300);
 await mode(p,'full');await p.waitForTimeout(350);
 const restored=await p.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>/explorer|board|oneshot|onepage/.test(k))));
 console.log('changed stores',Object.keys({...saved,...restored}).filter(k=>saved[k]!==restored[k]).map(k=>({key:k,before:saved[k],after:restored[k]})));check(JSON.stringify(saved)===JSON.stringify(restored),'往返模式和极简导航不改完整存档');
 await call(p,'/src/components/OnboardingTour.tsx','replayOnboarding');await advanceOnboardingLanguage(p);await p.getByRole('dialog',{name:'OneTHU 使用导览'}).waitFor();
 await p.getByRole('button',{name:'极简模式',exact:true}).click();await p.getByRole('button',{name:'按此模式开始'}).click();
 await p.getByRole('heading',{name:'搜索、OH 与插件',exact:true}).waitFor();await p.getByRole('button',{name:'下一步',exact:true}).click();check(await p.getByRole('heading',{name:'首页，只关心今天'}).isVisible(),'极简导览正确分流');
 await p.getByRole('button',{name:'下一步',exact:true}).click();check(await p.getByRole('heading',{name:'五个功能，固定在手边'}).isVisible(),'极简导览精简');
 await p.getByRole('button',{name:'下一步',exact:true}).click();check(await p.getByRole('heading',{name:'需要时，再连接'}).isVisible(),'接入步骤可选');check(await p.getByRole('switch',{name:'OH MCP 服务器开关'}).count()===0,'极简导览隐藏高级 MCP 开关');
 await p.getByRole('button',{name:'开始使用',exact:true}).click();await p.waitForTimeout(300);
 await call(p,'/src/components/OnboardingTour.tsx','replayOnboarding');await advanceOnboardingLanguage(p);await p.getByRole('button',{name:'完整模式',exact:true}).click();await p.getByRole('button',{name:'按此模式开始'}).click();
 await walkFullOnboarding(p,check);
 await p.getByRole('button',{name:'开始使用',exact:true}).click();await p.waitForTimeout(300);
 await nav(p,'contacts',{section:'orgs'});await p.getByRole('button',{name:'新建组织',exact:true}).click();await p.locator('.plg-form-modal input').first().fill('测试组织');await p.getByRole('button',{name:'提交',exact:true}).click();
 /* 组织是完整页面（2026-10-19）：不再有管理弹层 */
 await p.getByRole('heading',{name:'测试组织',exact:true}).waitFor({timeout:10000});
 await p.getByRole('button',{name:'启用多人协作',exact:true}).click();await p.waitForFunction(()=>JSON.parse(localStorage.getItem('onethu.orgs.v1')).orgs[0]?.collaboration?.status==='ready');
 await p.getByRole('radio',{name:'成员',exact:true}).click();
 await p.getByRole('button',{name:'添加成员',exact:true}).click();await p.locator('.plg-form-modal input').nth(0).fill('lisi');await p.locator('.plg-form-modal input').nth(1).fill('lisi@mails.tsinghua.edu.cn');await p.getByRole('button',{name:'提交',exact:true}).click();await p.waitForTimeout(400);check(await p.getByText('lisi@mails.tsinghua.edu.cn',{exact:false}).isVisible(),'组织成员按真实邮箱管理');
 await p.getByRole('radio',{name:'项目',exact:true}).click();await p.getByRole('button',{name:'新建项目'}).click();await p.locator('.plg-form-modal input').first().fill('迎新活动');await p.getByRole('button',{name:'提交',exact:true}).click();await p.waitForTimeout(300);check(await p.getByText('迎新活动',{exact:true}).isVisible(),'组织项目创建');
 await p.getByRole('radio',{name:'公告',exact:true}).click();await p.getByRole('button',{name:'发布公告'}).click();await p.locator('.plg-form-modal input').first().fill('会议安排');await p.locator('.plg-form-modal textarea').fill('周五见');await p.getByRole('button',{name:'提交',exact:true}).click();await p.waitForTimeout(300);check(await p.getByText('周五见',{exact:true}).isVisible(),'组织公告保存');
 await p.getByRole('radio',{name:'概览',exact:true}).click();check(await p.locator('.identity-card-name').innerText()==='测试组织','组织自动绑定名片');await p.screenshot({path:out+'/organization.png'});
 const state=await call(p,'/src/state/org.ts','orgSnapshot');const o=state.orgs[0];check(!await call(p,'/src/state/org.ts','removeOrgMember',[o.id,o.members[0].id]),'最后一位负责人保护');
 await call(p,'/src/state/vault.ts','addToVault',[{type:'text',title:'分享测试',text:'内容'}]);await nav(p,'vault');await p.getByRole('button',{name:'分享口令',exact:true}).click();
 const share=p.getByRole('dialog',{name:'分享内容',exact:true});
 await share.getByRole('button',{name:'生成分享口令',exact:true}).click();await share.locator('.vault-exchange-code').waitFor();
 check(/^ON(-[A-Z0-9]{4}){4}$/.test(await share.locator('.vault-exchange-code').innerText()),'标签页共享入口生成短口令');await p.keyboard.press('Escape');await share.waitFor({state:'hidden'});
 await p.getByRole('button',{name:/^暂存箱，/}).click();await p.locator('.vault-manager').waitFor();check(await p.locator('.vault-accept-halo').count()===0,'点击暂存箱直接打开管理，不显示接收光环');await p.locator('.vault-manager').getByRole('button',{name:'分享口令',exact:true}).click();await share.getByRole('button',{name:'生成分享口令',exact:true}).click();await share.locator('.vault-exchange-code').waitFor();check(await share.locator('.vault-exchange-code').isVisible(),'管理面板共享入口生成短口令');
 await p.keyboard.press('Escape');await share.waitFor({state:'hidden'});await p.locator('.vault-manager').getByRole('button',{name:'关闭',exact:true}).click();await p.locator('.vault-manager').waitFor({state:'hidden'});
 /* ── 实用模式：极简壳 + 第五格「更多功能」 ── */
 await call(p,'/src/state/experienceMode.ts','navigateSimple',['homepage']);await p.waitForTimeout(350);
 await mode(p,'practical');await p.waitForTimeout(450);
 check(JSON.stringify(await p.locator('.oneshot button').allTextContents())===JSON.stringify(['学习','预约','生活','课表','更多功能']),'实用模式五入口：「信息」换成「更多功能」且在最右');
 check(await p.locator('.explorer-topbar,.ex-rail,.onego-bookmarks,.vault-box-button').count()===0,'实用模式同样隐藏标签、OneGO 和暂存箱（其余与极简一致）');
 await p.getByRole('button',{name:'首页',exact:true}).click();await p.waitForTimeout(400);
 check(await p.locator('.simple-home section').count()===2,'实用模式首页仍只有待办和课程');
 check(await p.locator('#ex-bbar-tabs-btn,#ex-bbar-onego-btn,.board-viewport-tools').count()===0,'实用模式无残留标签按钮及白板浮动工具');
 await p.locator('.oneshot button').nth(4).click();
 const more=p.getByRole('dialog',{name:'更多功能'});await more.waitFor();
 check(await more.getByRole('heading',{name:'学习'}).count()===1&&await more.getByRole('heading',{name:'生活'}).count()===1,'更多功能按功能目录分组展开');
 check(await more.getByText('暂存箱、通讯录、白板、插件页与清小搭是完整模式功能').count()===1,'完整模式专属功能不进面板（脚注说明）');
 check(await more.locator('.workbench-catalog-entry').filter({hasText:'校园卡'}).count()===1,'功能目录里的功能可点开');
 await p.waitForTimeout(400);await p.screenshot({path:out+'/practical-library-desktop.png'});
 await more.getByRole('textbox',{name:'搜索功能'}).fill('研讨间');
 check(await more.locator('.practical-feature-row').count()===1,'功能目录搜索收敛到对应服务');
 await more.getByRole('textbox',{name:'搜索功能'}).fill('不存在的功能xyz');
 check(await more.getByText('没有找到“').count()===1,'无匹配显示清楚的空结果');
 await more.getByRole('button',{name:'查看全部',exact:true}).click();
 check(await more.locator('.practical-feature-row').count()>20,'清空筛选恢复目录');
 await p.keyboard.press('Escape');await p.waitForTimeout(300);
 /* 把任意功能换进四个入口里的任意一个 */
 await p.locator('.oneshot button').nth(4).click();await more.waitFor();
 await more.getByRole('button',{name:'把宿舍电费放进快捷入口'}).click();
 /* 面板收起，底部四入口亮编号；点哪个放哪个 */
 await p.locator('.oneshot.is-placing').waitFor();
 check(await p.locator('.oneshot.is-placing .oneshot-place-badge').count()===4,'四个入口亮出放置编号');
 await p.locator('.oneshot > button').nth(1).click();
 await toastWait(p,'已放进入口 2');
 /* 提示条正好悬在入口条上方：等它退场，否则会吃掉下一次点击 */
 await p.waitForSelector('.toast-host', { state: 'detached', timeout: 6000 }).catch(() => {});
 check((await p.locator('.oneshot button').allTextContents())[1]==='宿舍电费','功能换进入口 2 生效');
 await p.reload({waitUntil:'domcontentloaded'});await p.locator('.explorer-shell').waitFor();await p.waitForTimeout(600);
 check((await p.locator('.oneshot button').allTextContents())[1]==='宿舍电费','实用模式入口配置持久化（独立存档）');
 const routeSeq=await p.evaluate(async()=>{
   const url=performance.getEntriesByType('resource').map(x=>x.name).find(x=>new URL(x).pathname.endsWith('/src/state/experienceMode.ts'));
   const m=await import(url);const seq=[];
   for(let i=0;i<20;i++){const pg=m.simpleRoute().page;if(seq[seq.length-1]!==pg)seq.push(pg);await new Promise(r=>setTimeout(r,60));}
   return seq;
 });
 await p.locator('.oneshot > button').nth(1).click();await p.waitForTimeout(600);
 const routeAfter=await call(p,'/src/state/experienceMode.ts','simpleRoute');
 if(await p.locator('[data-simple-page="life"]').count()===0){
   const probe=await p.evaluate(()=>{const b=[...document.querySelectorAll('.oneshot button')][1];const r=b.getBoundingClientRect();const el=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)},top:el?(el.className||el.tagName).toString().slice(0,60):null,fixed: [...document.querySelectorAll('body > *')].map(e=>({cls:(e.className||e.tagName).toString().slice(0,40),pe:getComputedStyle(e).pointerEvents,z:getComputedStyle(e).zIndex})).filter(x=>x.pe!=='none')};});
   console.log('   [诊断] data-simple-page=',await p.locator('.simple-panel').getAttribute('data-simple-page'),'| oneshot=',JSON.stringify(await p.locator('.oneshot button').allTextContents()));
   console.log('   [诊断] 点击前后 route 序列=',JSON.stringify(routeSeq),'→ 现在',routeAfter.page,'| 命中:',JSON.stringify(probe));
 }
 check(await p.locator('[data-simple-page="life"]').count()===1,'换过的入口可正常打开对应页');
 /* 面板里点功能直接打开 */
 await p.locator('.oneshot button').nth(4).click();await more.waitFor();
 await more.locator('.workbench-catalog-entry').filter({hasText:'图书馆座位'}).click();
 check(await p.locator('[data-simple-page="reserve"]').count()===1,'更多功能里点名称直接打开该功能');
 /* 切回极简/完整：各自的入口互不被污染 */
 await mode(p,'simple');await p.waitForTimeout(400);
 check(JSON.stringify(await p.locator('.oneshot button').allTextContents())===JSON.stringify(['学习','预约','生活','信息','课表']),'极简五入口不受实用模式配置影响');
 await mode(p,'full');await p.waitForTimeout(400);
 check(await p.locator('.oneshot button').count()===5,'完整模式仍是五个自选入口');
 await mode(p,'practical');await p.waitForTimeout(400);
 check((await p.locator('.oneshot button').allTextContents())[1]==='宿舍电费','切回实用模式配置还在');
 /* 实用模式导览 */
 await call(p,'/src/components/OnboardingTour.tsx','replayOnboarding');await advanceOnboardingLanguage(p);
 await p.getByRole('dialog',{name:'OneTHU 使用导览'}).waitFor();
 await p.waitForTimeout(400);await p.screenshot({path:out+'/mode-picker-desktop.png'});
 check(await p.getByRole('button',{name:'实用模式',exact:true}).count()===1,'导览提供实用模式选项');
 await p.getByRole('button',{name:'实用模式',exact:true}).click();await p.getByRole('button',{name:'按此模式开始'}).click();
 await p.getByRole('heading',{name:'搜索、OH 与插件',exact:true}).waitFor();await p.getByRole('button',{name:'下一步',exact:true}).click();await p.getByRole('heading',{name:'首页，只关心今天'}).waitFor();check(true,'实用导览第 1 课');
 await p.getByRole('button',{name:'下一步',exact:true}).click();await p.getByRole('heading',{name:'更多功能：所有基础功能都在这里'}).waitFor();check(true,'实用导览第 2 课：更多功能');await p.getByRole('button',{name:'展开更多功能',exact:true}).click();await more.waitFor();check(await more.getByRole('textbox',{name:'搜索功能'}).isVisible(),'实用导览真实展开更多功能');await p.keyboard.press('Escape');await more.waitFor({state:'hidden'});await p.getByRole('button',{name:'继续导览',exact:true}).click();
 await p.getByRole('button',{name:'下一步',exact:true}).click();await p.getByRole('heading',{name:'四个入口，随你安排'}).waitFor();check(true,'实用导览第 3 课：换入口');
 await p.getByRole('button',{name:'下一步',exact:true}).click();await p.getByRole('heading',{name:'需要时，再连接'}).waitFor();check(true,'实用导览接入步骤可选');check(await p.getByRole('switch',{name:'OH MCP 服务器开关'}).count()===0,'实用导览隐藏高级 MCP 开关');
 await p.getByRole('button',{name:'开始使用',exact:true}).click();await p.waitForTimeout(300);
 await p.getByRole('button',{name:'首页',exact:true}).click();await p.waitForTimeout(450);await p.screenshot({path:out+'/practical-desktop.png'});
 await p.unrouteAll({behavior:"ignoreErrors"});await p.request.dispose();await p.close();
 for(const width of [390,320]){const p=await setup(width,844);await mode(p,'simple');await p.waitForTimeout(350);const geom=await p.locator('.oneshot button').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,right:r.right,bottom:r.bottom,width:r.width,text:e.innerText};}));check(geom.length===5&&geom.every(r=>r.x>=0&&r.right<=width&&r.width>40),width+' 手机五入口可见');check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),width+' 无横向溢出');await p.screenshot({path:out+'/simple-phone-'+width+'.png'});
 check(await p.locator('.board-viewport-tools').count()===0,width+' 手机无白板工具泄露');
 const labels=await p.locator('.oneshot-button .og-btn-label').evaluateAll(es=>es.map(e=>({sw:e.scrollWidth,cw:e.clientWidth})));
 check(labels.every(r=>r.sw<=r.cw+1),width+' 默认五入口文字无截断');
 await mode(p,'practical');await p.locator('.oneshot > button').last().click();
 await p.getByRole('dialog',{name:'更多功能'}).waitFor();await p.waitForTimeout(300);
 await p.screenshot({path:out+'/practical-library-phone-'+width+'.png'});
 const fits=await p.getByRole('dialog',{name:'更多功能'}).evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&r.top>=0;});check(fits,width+' 手机功能目录完整位于屏幕内');
 await p.keyboard.press('Escape');await p.waitForTimeout(300);
 await p.getByRole('button',{name:'设置',exact:true}).click();
 check(await p.locator('.practical-settings').count()===1,width+' 实用模式设置走完整模式同款结构（不是简洁单页）');
 check(await p.locator('.practical-settings .workbench-settings-tabs [role=tab]').count()===7,width+' 实用模式设置七个页签齐全');
 check(await p.locator('[data-settings-section="外部作业源"],[data-settings-section="通知"],[data-settings-section="桌面小组件"]').count()===3,width+' 实用模式补齐了作业源/通知/小组件');
 check(await p.locator('[data-settings-section="极客模式"],[data-settings-section="首页布局"],[data-settings-section="收藏夹"]').count()===0,width+' 完整模式独有分节不进实用模式');
 await p.getByRole('button',{name:'关闭设置',exact:true}).click();await p.waitForTimeout(300);

 await call(p,'/src/components/OnboardingTour.tsx','replayOnboarding');await advanceOnboardingLanguage(p);await p.getByRole('dialog',{name:'OneTHU 使用导览'}).waitFor();await p.waitForTimeout(300);await p.screenshot({path:out+'/mode-picker-phone-'+width+'.png'});await p.unrouteAll({behavior:"ignoreErrors"});await p.request.dispose();await p.close();}
 check(errors.length===0,'无新增浏览器错误 '+JSON.stringify(errors));passed=true;
}catch(error){errors.push(String(error));console.error(error);console.error("Browser errors:",errors);throw error;}finally{try{await closeTestBrowser(browser);}catch(error){passed=false;errors.push(String(error));throw error;}finally{writeFileSync(out+'/report.json',JSON.stringify({passed,checks,errors},null,2));}}
