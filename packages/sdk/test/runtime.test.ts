import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, mkdir, writeFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openSessionStorage } from '../src/node/storage.js';
import { webvpnDecodeUrl } from '@onethu/core';
// Exercise the independently distributable bundle, including CJS dependencies.
const {createOneThu,createPluginHost}=await import('../dist/index.mjs');
async function setup(t:any) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'onethu-runtime-test-'));
  const storage=await openSessionStorage(dir);
  await storage.save({version:1,device:{fingerprint:'b'.repeat(32),account:'12345678'},session:{username:'12345678',fingerprint:'b'.repeat(32),cookiesJson:'[]',savedAt:1}});
  await storage.close();
  let fetches=0;
  const runtime=await createOneThu({dataDir:dir,fetch:async(raw:string)=>{
    fetches++;const physical=new URL(raw);const url=new URL(/^\/https?\/[a-f0-9]{32,}\//.test(physical.pathname)?webvpnDecodeUrl(raw)??raw:raw);
    if(url.pathname==='/wengine-vpn/cookie')return new Response('XSRF-TOKEN=fixture-csrf;');
    if(url.pathname.endsWith('/grjbxx'))return Response.json({object:{ryh:'12345678'}});
    if(url.pathname.includes('/f/wlxt/index/course/student'))return new Response('<html><a href="/f/wlxt/index/course/student/?_csrf=fixture-learn">courses</a></html>');
    throw new Error('FIXTURE_NETWORK_UNEXPECTED');
  }});
  t.after(async()=>{await runtime.close();await rm(dir,{recursive:true,force:true});});
  return {runtime,dir,fetches:()=>fetches};
}
test('independent discovery works offline and excludes privileged configuration from MCP',async t=>{
  const {runtime,fetches}=await setup(t);
  assert.equal(fetches(),0);const names=runtime.list().operations.map((x:any)=>x.name);
  assert(names.includes('learn.resources'));assert(names.includes('library.book'));assert(names.includes('mail.send'));assert(names.includes('plugins.install'));assert(names.includes('agent.run'));
  assert.equal(new Set(names).size,names.length);
  assert(!runtime.list('mcp').operations.some((x:any)=>x.localOnly));
  await assert.rejects(runtime.call({operation:'agent.configure',args:[{}],confirm:true},{source:'mcp'}),/CLI_LOCAL_CONFIGURATION_REQUIRED/);
  assert.equal(fetches(),0);
});
test('local confirmation and automatic policy are enforced at the same non-GUI service',async t=>{
  const {runtime}=await setup(t);
  const args=['Fixture','2026-10-25','10:00','11:00',{local:true}];
  await assert.rejects(runtime.call({operation:'cal.add',args}),/CONFIRMATION_REQUIRED/);
  await assert.rejects(runtime.call({operation:'cal.add',args,confirm:true},{source:'mcp'}),/CLI_LOCAL_APPROVAL_REQUIRED/);
  await assert.rejects(runtime.call({operation:'cal.add',args,confirm:true},{source:'plugin',permissions:new Set(['cal:read'])}),/PERMISSION_REQUIRED/);
  const result=await runtime.call({operation:'cal.add',args,confirm:true});assert.equal(result.where,'local');
  await runtime.setAutomatic(true,{confirm:true});
  await runtime.call({operation:'cal.add',args},{source:'mcp'});
  const rows=await runtime.call({operation:'cal.agenda',args:['2026-10-25','2026-10-25']});assert.equal(rows.length,2);
  await runtime.setAutomatic(false,{confirm:true});
  await assert.rejects(runtime.call({operation:'cal.add',args},{source:'mcp'}),/CLI_LOCAL_APPROVAL_REQUIRED/);
});
test('approved persistent task executes through the actual router and local notification ledger',async t=>{
  const {runtime}=await setup(t);
  const channels=await runtime.call({operation:'tasks.channels',args:[]});
  assert(channels.some((channel:any)=>channel.id==='inbox'&&channel.available));
  const task=await runtime.call({operation:'tasks.create',confirm:true,args:[{name:'Calendar watch',schedule:{kind:'interval',everyMinutes:30},template:{kind:'operation',operation:'cal.agenda',args:['2026-10-25','2026-10-25'],channels:['inbox']}}]});
  const first=await runtime.call({operation:'tasks.run',args:[task.id],confirm:true});assert.equal(first.status,'succeeded');assert.equal(first.notified,1);
  const second=await runtime.call({operation:'tasks.run',args:[task.id],confirm:true});assert.equal(second.notified,0);
  const history=await runtime.call({operation:'tasks.history',args:[task.id]});assert.equal(history.length,2);
  const inbox=await runtime.call({operation:'notifications.inbox',args:[]});assert(Array.isArray(inbox.messages));assert.equal(inbox.messages.length,1);
  await runtime.call({operation:'tasks.pause',args:[task.id],confirm:true});
  await assert.rejects(runtime.call({operation:'tasks.run',args:[task.id],confirm:true}),/TASK_PAUSED/);
});
test('neither JSON nor untrusted model sources can forge task grants',async t=>{
  const {runtime}=await setup(t);
  await assert.rejects(runtime.call({operation:'cal.add',args:[],confirmationGrant:{assertActive(){}}}),/INVALID_ARGUMENTS/);
  const draft={name:'Unsafe',schedule:{kind:'interval',everyMinutes:30},template:{kind:'operation',operation:'mail.send',args:['a@example.com','x','x',{}],channels:[]}};
  await assert.rejects(runtime.call({operation:'tasks.create',args:[draft],confirm:true}),/TASK_MUTATION_NOT_ALLOWED|INVALID_ARGUMENTS/);
  await assert.rejects(runtime.call({operation:'tasks.create',args:[draft],confirm:true},{source:'agent'}),/CLI_LOCAL_APPROVAL_REQUIRED/);
});
test('task history persists across a real runtime close and re-open, without a GUI',async t=>{
  const {runtime,dir}=await setup(t);
  const task=await runtime.call({operation:'tasks.create',confirm:true,args:[{name:'Persistent',schedule:{kind:'interval',everyMinutes:30},template:{kind:'operation',operation:'cal.agenda',args:[],channels:[]}}]});
  await runtime.close();
  const reopened=await createOneThu({dataDir:dir,fetch:async(raw:string)=>{
    if(raw.includes('/wengine-vpn/cookie'))return new Response('XSRF-TOKEN=fixture;');
    if(raw.includes('grjbxx'))return Response.json({object:{ryh:'12345678'}});
    return new Response('<html><a href="/f/wlxt/index/course/student/?_csrf=fixture">courses</a></html>');
  }});t.after(()=>reopened.close());
  const tasks=await reopened.call({operation:'tasks.list',args:[]});assert.equal(tasks[0].id,task.id);
  await reopened.close();assert((await readdir(dir)).includes('tasks.json'));
});

test('a rejected concurrent write never releases the active writer’s lock',async t=>{
  const {runtime}=await setup(t);await runtime.auth.restore();
  let release!:()=>void,entered!:()=>void,count=0;
  const hold=new Promise<void>(resolve=>{release=resolve;});
  const inside=new Promise<void>(resolve=>{entered=resolve;});
  const request={operation:'cal.add',args:['Lock','2026-10-25','10:00','11:00',{local:true}],confirm:true};
  const first=runtime.call(request,{beforeWrite:async()=>{if(++count===2){entered();await hold;}}});
  await inside;
  try {
    await assert.rejects(runtime.call(request),/CLI_WRITE_BUSY/);
    await assert.rejects(runtime.call(request),/CLI_WRITE_BUSY/);
  }finally{release();}
  await first;
  const rows=await runtime.call({operation:'cal.agenda',args:['2026-10-25','2026-10-25']});assert.equal(rows.length,1);
});

test('policy changed while an asynchronous guard waits prevents the final write',async t=>{
  const {runtime}=await setup(t);await runtime.auth.restore();let count=0;
  await assert.rejects(runtime.call({operation:'cal.add',args:['Cancelled','2026-10-25','10:00','11:00',{local:true}],confirm:true},{beforeWrite:async()=>{
    if(++count===2)await runtime.setAutomatic(false,{confirm:true});
  }}),/CLI_SESSION_CHANGED/);
  const rows=await runtime.call({operation:'cal.agenda',args:['2026-10-25','2026-10-25']});assert.equal(rows.length,0);
});

test('bundled plugin host finds and executes its distributed worker outside the source tree',async t=>{
  const dir=await mkdtemp(path.join(await realpath(os.tmpdir()),'onethu-bundled-plugin-'));
  const source=path.join(dir,'source');await mkdir(source);
  const manifest={id:'fixture.bundle',name:'Bundle fixture',version:'1.0.0',permissions:[],entry:'plugin.js'};
  await writeFile(path.join(source,'manifest.json'),JSON.stringify(manifest));
  await writeFile(path.join(source,'plugin.js'),`export const manifest=${JSON.stringify(manifest)};export default ctx=>ctx.registerCommand({id:'hello',title:'Hello'},()=>({message:'bundle works'}));`);
  const host=createPluginHost({rootDir:path.join(dir,'installed'),dispatch:async()=>{throw Error('UNEXPECTED_CALL');},resolveOperation:()=>undefined});
  t.after(async()=>{await host.close();await rm(dir,{recursive:true,force:true});});
  await host.install(source,{confirm:true});await host.enable('fixture.bundle',{confirm:true});
  assert.deepEqual(await host.call('fixture.bundle','hello'),{message:'bundle works'});
});

test('storage errors during shutdown still release the exclusive account lock',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'onethu-shutdown-test-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const runtime=await createOneThu({dataDir:dir});
  await mkdir(path.join(dir,'execution-policy.json'));
  await assert.rejects(runtime.setAutomatic(true,{confirm:true}),/STORAGE_UNSAFE_FILE/);
  assert.equal(runtime.list().confirmationMode,'per-request','a failed policy save must not enable automatic execution');
  await assert.rejects(runtime.close(),/STORAGE_UNSAFE_FILE/);
  await rm(path.join(dir,'execution-policy.json'),{recursive:true});
  const reopened=await createOneThu({dataDir:dir});await reopened.close();
});

test('private desktop bridge shares account, tasks, policy and cancellation without exposing session methods in MCP',async t=>{
  const {runtime}=await setup(t);await runtime.auth.restore();
  const status=runtime.desktop.status(),fence={expectedAccount:status.username,expectedEpoch:status.epoch};
  assert.equal(status.protocolVersion,1);assert.equal(status.policy.configured,false);
  assert.equal(runtime.list('mcp').operations.some((row:any)=>row.name.startsWith('desktop.')),false);
  await runtime.desktop.policy({...fence,enabled:true,automatic:false,appEnabled:true});
  const created=await runtime.desktop.call({...fence,operation:'tasks.create',confirm:true,args:[{name:'Shared',schedule:{kind:'interval',everyMinutes:30},template:{kind:'operation',operation:'cal.agenda',args:[],channels:['inbox']}}]});
  const fromCli=await runtime.call({operation:'tasks.list'});assert.equal(fromCli[0].id,created.id);
  assert.throws(()=>runtime.desktop.call({...fence,expectedAccount:'87654321',operation:'tasks.list'}),/CLI_ACCOUNT_CHANGED/);
  const aborted=new AbortController();aborted.abort();await assert.rejects(runtime.desktop.call({...fence,operation:'tasks.list'},{signal:aborted.signal}),/CLI_DEADLINE_OR_CANCELLED/);
  await runtime.desktop.policy({...fence,enabled:false,automatic:false});
  assert.throws(()=>runtime.desktop.call({...fence,operation:'tasks.list'}),/OH_AUTHORIZATION_REQUIRED/);
  await assert.rejects(runtime.call({operation:'tasks.run',args:[created.id],confirm:true}),/CLI_DISABLED/);
  await runtime.desktop.policy({...fence,enabled:true,automatic:true});assert.equal(runtime.desktop.status().policy.configured,true);
  assert.equal((await runtime.call({operation:'tasks.list'}))[0].id,created.id);
  const exported=runtime.desktop.exportSession();assert.equal(exported.snapshot.username,status.username);
  await runtime.desktop.logout(fence);assert.equal(runtime.desktop.status().tombstone,true);
  assert.throws(()=>runtime.desktop.call({...fence,operation:'tasks.list'}),/AUTH_SESSION_CHANGED/);
});

test('desktop outbound sync verifies recipient mapping and only removes bindings it still owns',async t=>{
  const {runtime}=await setup(t);await runtime.auth.restore();
  const {createHash}=await import('node:crypto');const status=runtime.desktop.status(),fence={expectedAccount:status.username,expectedEpoch:status.epoch};
  const config={appId:'fixture-app',appSecret:'fixture-secret',chatId:'ou_fixture',receiveIdType:'open_id'};
  const legacyId='feishu:'+createHash('sha256').update(JSON.stringify([status.username,'feishu',config.appId,config.chatId])).digest('hex');
  await assert.rejects(runtime.desktop.notificationsSync({...fence,channels:[{channel:'feishu',config,legacyId:'feishu:wrong'}]}),/TASK_NOTIFICATION_BINDING_CHANGED/);
  const synced=await runtime.desktop.notificationsSync({...fence,channels:[{channel:'feishu',config,legacyId}]});assert.match(synced.channelMap[legacyId],/^feishu:[a-f0-9]{64}$/);
  await assert.rejects(runtime.desktop.migrateTasks({...fence,origin:'fixture',state:{version:1,tasks:[]},channelMap:{'feishu:unverified':synced.channelMap[legacyId]}}),/TASK_CHANNEL_MAPPING_UNVERIFIED/);
  await runtime.desktop.notificationsSync({...fence,channels:[{channel:'feishu',config:null}]});assert.equal((await runtime.call({operation:'notifications.list'})).find((row:any)=>row.channel==='feishu').configured,false);
  await runtime.desktop.notificationsSync({...fence,channels:[{channel:'feishu',config,legacyId}]});
  await runtime.call({operation:'notifications.configure',args:['feishu',{...config,chatId:'ou_other'}],confirm:true});
  assert.deepEqual((await runtime.desktop.notificationsSync({...fence,channels:[{channel:'feishu',config:null}]})).conflicts,['feishu']);
  assert.equal((await runtime.call({operation:'notifications.list'})).find((row:any)=>row.channel==='feishu').configured,true);
});

test('explicit CLI enabled policy restores the shared runtime after desktop disabling',async t=>{
  const {runtime}=await setup(t);await runtime.auth.restore();
  await assert.rejects(runtime.setEnabled(false),/CLI_LOCAL_APPROVAL_REQUIRED/);
  await runtime.setEnabled(false,{confirm:true});assert.equal(runtime.list().enabled,false);
  assert.equal((await runtime.call({operation:'config.get'})).enabled,false);
  await runtime.setEnabled(true,{confirm:true});assert.equal((await runtime.call({operation:'config.get'})).enabled,true);
  assert.equal(runtime.desktop.status().policy.enabled,true);
});

test('desktop migration waits for an exact usable notification binding before marking old task migrated',async t=>{
  const {runtime}=await setup(t);await runtime.auth.restore();
  const status=runtime.desktop.status(),fence={expectedAccount:status.username,expectedEpoch:status.epoch};
  const task=await runtime.call({operation:'tasks.create',args:[{name:'Source',schedule:{kind:'interval',everyMinutes:30},template:{kind:'operation',operation:'cal.agenda',args:[],channels:['inbox']}}],confirm:true});
  const {readFile}=await import('node:fs/promises');const state=JSON.parse(await readFile(path.join(runtime.dataDir,'tasks.json'),'utf8'));
  await runtime.call({operation:'tasks.remove',args:[task.id],confirm:true});state.tasks[0].template.channels=['wechat:missing'];state.tasks[0].scope.channels=['wechat:missing'];
  const result=await runtime.desktop.migrateTasks({...fence,origin:'desktop-v1',state});
  assert.deepEqual(result.conflicts,[{id:task.id,reason:'notification-binding-required'}]);assert.equal((await runtime.call({operation:'tasks.list'})).length,0);
  state.tasks[0].template.channels=['inbox'];state.tasks[0].scope.channels=['inbox'];assert.deepEqual((await runtime.desktop.migrateTasks({...fence,origin:'desktop-v1',state})).imported,[task.id]);
});

test('missing frontend WeChat context retains only the same previously synced bot and recipient',async t=>{
  const {runtime}=await setup(t);await runtime.auth.restore();const {createHash}=await import('node:crypto');
  const status=runtime.desktop.status(),fence={expectedAccount:status.username,expectedEpoch:status.epoch};
  const config={botToken:'fixture-token',userId:'fixture-user',contextToken:'fixture-context'};
  const legacyId='wechat:'+createHash('sha256').update(JSON.stringify([status.username,'wechat','fixture-bot',config.userId])).digest('hex');
  const synced=await runtime.desktop.notificationsSync({...fence,channels:[{channel:'wechat',config,sourceIdentity:'fixture-bot',legacyId}]});
  const retained=await runtime.desktop.notificationsSync({...fence,channels:[{channel:'wechat',config:null,retainLegacyId:legacyId}]});
  assert.equal(retained.channelMap[legacyId],synced.channelMap[legacyId]);
  assert.equal((await runtime.call({operation:'notifications.list'})).find((row:any)=>row.channel==='wechat').configured,true);
  await runtime.desktop.notificationsSync({...fence,channels:[{channel:'wechat',config:null,retainLegacyId:'wechat:new-bot-or-user'}]});
  assert.equal((await runtime.call({operation:'notifications.list'})).find((row:any)=>row.channel==='wechat').configured,false);
});

test('actual CLI Learn routes prepare the handed-off session once before reads and never replay a write',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'onethu-learn-handoff-'));let pages=0,writes=0;
  const runtime=await createOneThu({dataDir:dir,fetch:async(raw:string,init:RequestInit={})=>{
    const physical=new URL(raw);const url=new URL(/^\/https?\/[a-f0-9]{32,}\//.test(physical.pathname)?webvpnDecodeUrl(raw)??raw:raw);
    if(url.pathname==='/wengine-vpn/cookie')return new Response('XSRF-TOKEN=info-fixture;');
    if(url.pathname.endsWith('/grjbxx'))return Response.json({object:{ryh:'12345678'}});
    if(/^\/f\/wlxt\/index\/course\/student\/?$/.test(url.pathname)){pages++;assert.equal(init.method??'GET','GET');return new Response('<input name="_csrf" value="learn-fixture">');}
    assert.equal(url.searchParams.get('_csrf'),'learn-fixture');
    if(url.pathname.endsWith('/getCurrentAndNextSemester'))return Response.json({result:{id:'2026-2027-1'}});
    if(url.pathname.includes('/loadCourseBySemesterId/'))return Response.json({resultList:[{wlkcid:'course-fixture',kcm:'Fixture course'}]});
    if(url.pathname.endsWith('/queryxnxq'))return Response.json(['2026-2027-1']);
    if(url.pathname.includes('/saveTl')){writes++;throw new Error('synthetic connection loss after dispatch');}
    throw new Error('unexpected synthetic Learn operation');
  }});t.after(async()=>{await runtime.close();await rm(dir,{recursive:true,force:true});});
  const snapshot={username:'12345678',fingerprint:'c'.repeat(32),cookiesJson:JSON.stringify([{name:'sid',value:'fixture',domain:'id.tsinghua.edu.cn',path:'/',secure:true,hostOnly:true}]),savedAt:Date.now()};
  await runtime.desktop.adoptSession({snapshot,expectedEpoch:runtime.desktop.status().epoch,reason:'bootstrap'});assert.equal(pages,0);
  const results=await Promise.all([runtime.call({operation:'learn.courses'}),runtime.call({operation:'learn.semesters'}),runtime.call({operation:'learn.currentSemester'})]);
  assert.equal(results[0].count,1);assert.equal(results[0].rows[0].id,'course-fixture');assert.deepEqual(results[1],['2026-2027-1']);assert.equal(results[2].id,'2026-2027-1');assert.equal(pages,1);
  await runtime.call({operation:'learn.courses'});assert.equal(pages,1);
  await runtime.desktop.adoptSession({snapshot,expectedEpoch:runtime.desktop.status().epoch,reason:'login'});
  const post={operation:'learn.post',args:['course-fixture','board-fixture','Fixture title','Fixture body']};
  await assert.rejects(runtime.call(post),/CONFIRMATION_REQUIRED/);assert.equal(pages,1);assert.equal(writes,0);
  await assert.rejects(runtime.call({...post,confirm:true}),/NETWORK_REQUEST_FAILED/);
  assert.equal(pages,2);assert.equal(writes,1);assert.equal(runtime.desktop.status().session.authenticated,true);
});


test('internal OH services and tasks remain available with external CLI access disabled',async t=>{
 const {runtime}=await setup(t);await runtime.auth.restore();const status=runtime.desktop.status();
 const fence={expectedAccount:status.username,expectedEpoch:status.epoch};
 await runtime.desktop.policy({...fence,enabled:false,automatic:false,appEnabled:true});
 await assert.rejects(runtime.call({operation:'cal.agenda',args:[]}),/CLI_DISABLED/);
 const created=await runtime.desktop.call({...fence,operation:'cal.add',args:['OH event','2026-10-25','08:00','09:00',{local:true}],confirm:true});
 assert.equal(created.where,'local');
 assert.equal((await runtime.desktop.call({...fence,operation:'cal.agenda',args:['2026-10-25','2026-10-25']})).length,1);
 assert.deepEqual(await runtime.desktop.call({...fence,operation:'tasks.list',args:[]}),[]);
 await runtime.desktop.policy({...fence,enabled:false,automatic:false,appEnabled:false});
 assert.throws(()=>runtime.desktop.call({...fence,operation:'tasks.list'}),/OH_AUTHORIZATION_REQUIRED/);
});

test('uninstall retires the sole scheduler and reinstallation adopts edits without duplicate tasks',async t=>{
 const {runtime,dir}=await setup(t);await runtime.auth.restore();const status=runtime.desktop.status();
 const fence={expectedAccount:status.username,expectedEpoch:status.epoch};
 await runtime.desktop.policy({...fence,enabled:true,automatic:false,appEnabled:true});
 const created=await runtime.desktop.call({...fence,operation:'tasks.create',confirm:true,args:[{name:'Resident task',schedule:{kind:'interval',everyMinutes:30},template:{kind:'operation',operation:'cal.agenda',args:[],channels:['inbox']}}]});
 const transferred=await runtime.desktop.retire(fence);assert.equal(transferred.state.tasks.length,1);
 await assert.rejects(runtime.call({operation:'tasks.list'}),/CLI_RUNTIME_RETIRING/);
 assert.equal(JSON.parse(await (await import('node:fs/promises')).readFile(path.join(dir,'desktop-retired.json'),'utf8')),true);
 transferred.state.tasks[0].name='Edited in app';
 const result=await runtime.desktop.migrateTasks({...fence,origin:'app-return',state:transferred.state,channelMap:{}});
 assert.deepEqual(result.conflicts,[]);
 const tasks=await runtime.call({operation:'tasks.list'});assert.equal(tasks.length,1);assert.equal(tasks[0].id,created.id);assert.equal(tasks[0].name,'Edited in app');
});


test('an empty task profile can be retired and reinstalled without remaining locked',async t=>{
 const {runtime}=await setup(t);await runtime.auth.restore();const status=runtime.desktop.status();const fence={expectedAccount:status.username,expectedEpoch:status.epoch};
 await runtime.desktop.policy({...fence,enabled:true,automatic:false,appEnabled:true});
 const retired=await runtime.desktop.retire(fence);assert.deepEqual(retired.state.tasks,[]);
 await runtime.desktop.migrateTasks({...fence,origin:'empty-reinstall',state:retired.state,channelMap:{}});
 assert.deepEqual(await runtime.call({operation:'tasks.list'}),[]);
});
