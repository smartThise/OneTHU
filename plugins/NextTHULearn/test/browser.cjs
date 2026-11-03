const path=require('path'),assert=require('node:assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:[process.cwd(),path.resolve(__dirname,'../../../..')]}));
const bundle=path.resolve(__dirname,'../extension/content.js');
const app='https://learn.tsinghua.edu.cn/f/wlxt/index/course/student/';
const html='<html><body><input name="_csrf" value="test-token"><a href="/f/wlxt/index/course/student/">学堂</a></body></html>';
const soon=new Date(Date.now()+6*3600000);const deadline=soon.getFullYear()+'-'+String(soon.getMonth()+1).padStart(2,'0')+'-'+String(soon.getDate()).padStart(2,'0')+' '+String(soon.getHours()).padStart(2,'0')+':'+String(soon.getMinutes()).padStart(2,'0');
const courses=[{wlkcid:'c1',kcm:'数据结构',kch:'3024',kxhnumber:1,jsm:'张老师',sjddb:'周一 8:00 教学楼',xggs:1,xkjs:2,wjzys:1},{wlkcid:'c2',kcm:'线性代数',kch:'1042',kxhnumber:2,jsm:'李老师',xggs:0,xkjs:1,wjzys:0}];
(async()=>{
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
for(const size of [{width:1600,height:1000},{width:390,height:844}]){
 const page=await browser.newPage({viewport:size});const errors=[];let submitted=false,writes=0,rejectFirst=true,nativeAborted=false;const posted=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://learn.tsinghua.edu.cn/**',async route=>{
  const req=route.request(),u=new URL(req.url()),p=u.pathname;
  const json=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  const web=body=>route.fulfill({contentType:'text/html',body});
  if(p==='/f/wlxt/index/course/student/')return web(html);
  if(p.includes('getCurrentAndNextSemester'))return json({result:{id:'2026-2027-1'}});
  if(p.includes('queryxnxq'))return json(['2026-2027-1','2025-2026-2']);
  if(p.includes('loadCourseBySemesterId'))return json({resultList:p.includes('2025-2026-2')?[courses[1]]:courses});
  const ao=req.postData()?.startsWith('aoData=')?JSON.parse(new URLSearchParams(req.postData()).get('aoData')):[];
  const cid=ao.find(x=>x.name==='wlkcid')?.value||u.searchParams.get('wlkcid');
  if(p.includes('zyList')){
   if(cid==='c2'&&p.endsWith('zyListWj'))return route.fulfill({status:500,body:'error'});
   const yes=p.endsWith('zyListYjwg')&&submitted||p.endsWith('zyListWj')&&!submitted;
   return json({object:cid==='c1'&&yes?[{wlkcid:'c1',zyid:'h0',xszyid:'h1',bt:'第一次作业',jzsjStr:deadline}]:[]});
  }
  if(p.includes('pageListXsbyYgq'))return json({object:{aaData:cid==='c1'?[{ggid:'n2',bt:'往期通知',ggnr:Buffer.from('<p>过期通知正文</p>').toString('base64'),fbsjStr:'2025-10-20',wlkcid:'c1',sfyd:'是'}]:[],iTotalRecords:cid==='c1'?1:0}});
  if(p.includes('pageListXsbyWgq'))return json({object:{aaData:cid==='c1'?[{ggid:'n1',bt:'课程通知',ggnr:Buffer.from('<p>重要通知正文</p>').toString('base64'),fbsjStr:'2026-10-20',wlkcid:'c1',sfyd:'否'}]:[],iTotalRecords:cid==='c1'?1:0}});
  if(p.includes('kjxxbByWlkcid'))return json({object:cid==='c1'?[{wjid:'f1',bt:'课件第一讲',wjlx:'pdf',scsj:'2026-10-20'}]:[]});
  if(p.includes('downloadFile'))return route.fulfill({contentType:'application/pdf',body:'%PDF-1.4\n%%EOF'});
  if(p.endsWith('/detail'))return json({msg:'<p>请完成作业正文。<img src="x" onerror="alert(1)"><script>alert(2)</script></p>'});
  if(p.includes('/tijiao')||p.includes('/viewCj'))return web('<html><body><div class="c55">作业正文</div><textarea name="zynr"></textarea><div class="list fujian clearfix"><a href="/b/wlxt/kczy/zy/student/downloadFile?wjid=att1">教师附件.pdf</a></div></body></html>');
  if(p.includes('beforeViewXs'))return web('<html><body><a href="/b/wlxt/kcgg/wlkc_ggb/student/downloadFile?wjid=na1">通知附件.pdf</a></body></html>');
  if(p.endsWith('/tjzy')){writes++;posted.push(req.postData());if(rejectFirst){rejectFirst=false;return json({result:'failure',msg:'模拟拒绝：请核对附件'});}submitted=true;return json({result:'success'});}
  if(p.includes('bqListByWlkcid'))return json([{bqid:'b1',bqmc:'课程交流'}]);
  if(p.endsWith('ybtlPageList'))return json({object:{aaData:[{tltid:'t1',bt:'第一个讨论',fbrxm:'同学',bqid:'b1',hfcs:0}],iTotalRecords:1}});
  if(p.endsWith('viewTlById'))return web('<div id="tlbt"><span title="第一个讨论">第一个讨论</span></div><div class="louzhuu"><span class="name">同学</span><div class="right"><p>讨论正文</p></div></div>');
  if(p.includes('saveEdit')||p.includes('saveTl')){writes++;posted.push(req.postData());return json({result:'success'});}
  if(p.includes('beforePageWdfzList'))return web('<html><body>暂无分组</body></html>');
  if(p.includes('pageFzList'))return json({object:{aaData:[]}});
  if(p.includes('beforePageList_wks')&&!nativeAborted){nativeAborted=true;return route.abort('aborted');}
  if(p.includes('/f/'))return web('<html><head><style>.rtcon{padding-left:240px}.navlef{width:220px;float:left}#banner{height:60px;background:blue}</style></head><body><div id="banner">学校页头</div><div class="content"><div class="navlef">学校侧栏</div><div class="rtcon"><div id="content"><form><label>学校原生功能<input name="native"></label><button>保存</button></form></div></div></div></body></html>');
  return route.fulfill({status:404,body:'not found'});
 });
 await page.goto(app);await page.addScriptTag({path:bundle});const root=page.locator('#nextthulearn-root');
 await root.locator('.course-card').first().waitFor();await root.locator('[data-open=homework]').first().waitFor();
 assert.equal(await root.locator('.brand-logo>.word').textContent(),'One');assert.equal(await root.locator('.brand-logo>.u').count(),3);assert.equal(await root.locator('.nav-icon svg').count(),5);assert.equal(await root.locator('.metric.has-count').count(),3);assert.equal(await root.locator('.metric').count(),3);assert.deepEqual(await root.locator('.metric b').allTextContents(),['1','1','3']);
 assert.equal(await root.locator('.overview-columns .panel').count(),3);assert.equal(await root.locator('.course-stats').count(),2);assert.equal(writes,0);assert.equal(await root.locator('.task-soon').count(),1);assert.match(await root.locator('.deadline.soon').innerText(),/小时/);
 await page.screenshot({path:`/Users/st/NextTHULearn-release/overview-${size.width}.png`});
 await root.locator('[data-pin=c2]').click();assert.equal(await root.locator('.course-card').first().locator('.course-title').innerText(),'线性代数');
 await page.reload();await page.addScriptTag({path:bundle});await root.locator('[data-open=homework]').first().waitFor();assert.equal(await root.locator('.course-card').first().locator('.course-title').innerText(),'线性代数');assert.equal(await root.locator('[data-pin=c2].is-pinned').count(),1);
 if(size.width===1600){await root.locator('[data-action=toggle-theme]').click();assert.equal(await root.getAttribute('data-theme'),'dark');await page.screenshot({path:'/Users/st/NextTHULearn-release/overview-dark.png'});await root.locator('[data-action=toggle-theme]').click();}
 await root.locator('[data-view=homework]').click();await root.locator('#resource-course').selectOption('c2');assert.equal(await root.locator('[data-open=homework]').count(),0);await root.locator('#resource-course').selectOption('');
 await root.locator('[data-ignore=h1]').click();assert.equal(await root.locator('[data-open=homework]').count(),0);await page.reload();await page.addScriptTag({path:bundle});await root.locator('[data-filter=ignored]').click();await root.locator('[data-ignore=h1]').waitFor();assert.match(await root.locator('[data-ignore=h1]').innerText(),/恢复/);await root.locator('[data-ignore=h1]').click();await root.locator('[data-filter=pending]').click();
 await root.getByText('1 门课程读取失败',{exact:false}).waitFor();
 await root.locator('[data-open=homework]').first().click();await root.locator('#homework-form').waitFor();
 assert.match(await root.locator('.detail-body').innerText(),/请完成作业正文/);assert.equal(await root.locator('.detail-body script').count(),0);assert.equal(await root.locator('.detail-body [onerror]').count(),0);
 await root.locator('#hw-content').fill('模拟提交内容');await root.locator('#hw-file').setInputFiles({name:'answer.txt',mimeType:'text/plain',buffer:Buffer.from('fixture answer')});
 await root.locator('#homework-form [type=submit]').click();await root.getByText('模拟拒绝：请核对附件').waitFor();assert.equal(writes,1);assert.match(await root.locator('#hw-content').innerText(),/模拟提交内容/);await root.locator('#homework-form [type=submit]').click();await root.getByText('作业已提交，已核对学校状态').waitFor();assert.equal(writes,2);assert.match(posted[0],/answer.txt/);assert.match(posted[0],/xszyid/);
 page.on('dialog',d=>d.accept());await root.locator('[data-action=close-detail]').click();
 await root.locator('[data-view=notices]').click();await root.locator('[data-filter=expired]').click();await root.getByText('往期通知',{exact:true}).waitFor();await root.locator('[data-filter=all]').click();await root.locator('[data-open=notices]').click();await root.getByText('重要通知正文').waitFor();assert.equal(await root.locator('.attachment').count(),1);await root.locator('[data-action=close-detail]').click();
 await root.locator('[data-view=files]').click();await root.locator('[data-open=files]').click();await root.locator('.attachment').waitFor();assert.match(await root.locator('.attachment').getAttribute('href'),/_csrf=test-token/);await root.locator('[data-action=preview-file]').click();await root.locator('.file-preview').waitFor();assert.match(await root.locator('.file-preview').getAttribute('src'),/^blob:/);await root.locator('[data-action=close-detail]').click();
 await root.locator('[data-view=courses]').click();await root.locator('[data-action=forum]').first().click();await root.getByText('第一个讨论',{exact:true}).waitFor();await root.locator('[data-action=thread]').click();await root.getByText('讨论正文',{exact:true}).waitFor();await root.locator('#reply-content').fill('模拟回复');await root.locator('#reply-form [type=submit]').click();await root.getByText('回复已发送').waitFor();assert.equal(writes,3);await root.locator('[data-action=close-detail]').click();
 await root.locator('[data-section=courses][data-cid=c1]').first().click();await root.locator('[data-course-tab=questionnaires]').click();await root.locator('#native-frame').waitFor();assert.match(await root.locator('#native-frame').getAttribute('src'),/beforePageList_wks/);await page.frameLocator('#native-frame').locator('form').waitFor();const native=page.frames().find(f=>f!==page.mainFrame()&&f.url().includes('beforePageList_wks'));await native.locator('form').waitFor();await native.addScriptTag({path:bundle});assert.equal(await native.locator('#banner').isVisible(),false);assert.equal(await native.locator('.navlef').isVisible(),false);assert.equal(await native.evaluate(()=>Math.abs(document.querySelector('#content').getBoundingClientRect().width-document.body.getBoundingClientRect().width)<2),true);
 await page.reload();await page.addScriptTag({path:bundle});await root.locator('#native-frame').waitFor();assert.match(await root.locator('#native-frame').getAttribute('src'),/beforePageList_wks/);
 await root.locator('[data-view=courses]').click();await root.locator('#semester').selectOption('2025-2026-2');await page.waitForFunction(()=>document.querySelector('#nextthulearn-root').shadowRoot.querySelectorAll('.course-card').length===1);
 assert.equal(await page.evaluate(()=>{const s=document.querySelector('#nextthulearn-root').shadowRoot;return s.querySelector('.main').scrollWidth>s.querySelector('.main').clientWidth}),false);assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).overflow),'hidden');assert.deepEqual(errors,[]);
 console.log(size.width,'passed: brand, SVG, urgency, counters, course filter, persisted pin/ignore, expired notices, details, simulated writes, native service, semester');await page.close();
}
await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
