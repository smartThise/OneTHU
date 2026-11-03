import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStore} from '../src/store.js';
import {createAppData} from '../src/appData.js';
import {createCalendarServices} from '../src/services/calendar.js';
function event(uid:string,title=uid){return {uid,summary:title,start:1792800000000,end:1792803600000,onethuSource:'manual'};}
async function fixture(t:any){
 const dir=await mkdtemp(path.join(os.tmpdir(),'onethu-app-data-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const runtime:any={session:{username:'fixture-a',state:'ready'},epoch:()=>1,assertCurrent:()=>{},fetch:async()=>{throw Error('UNEXPECTED_NETWORK');}};
 const store=createStore(dir),data=createAppData(runtime,store),ops=createCalendarServices(runtime,store);
 const ctx={beforeWrite:async()=>{},signal:new AbortController().signal,deadline:Date.now()+10000};
 return {runtime,store,data,run:(name:string,args:any[]=[])=>ops.find(op=>op.name===name)!.run(args,ctx)};
}
test('GUI bootstrap and headless calendar address the same events in both directions',async t=>{
 const f=await fixture(t);await f.data.bootstrap('caldav.local',JSON.stringify({events:[event('gui')]}),()=>{});
 const rows:any=await f.run('cal.agenda',['2026-10-24','2026-10-24']);assert.equal(rows.length,1);
 await f.run('cal.add',['Terminal','2026-10-24','10:00','11:00',{local:true}]);
 const document=await f.data.read('caldav.local');assert.equal(JSON.parse(document.content!).events.length,2);
 const events=JSON.parse(document.content!).events.filter((e:any)=>e.uid!=='gui');
 await f.data.write('caldav.local',JSON.stringify({events}),document.revision,()=>{});
 assert.equal((await f.run('cal.agenda',['2026-10-24','2026-10-24']) as any[]).length,1);
});
test('stale GUI writes cannot overwrite a newer CLI change',async t=>{
 const f=await fixture(t);const old=await f.data.read('caldav.local');
 await f.run('cal.add',['Terminal','2026-10-24','10:00','11:00',{local:true}]);
 await assert.rejects(f.data.write('caldav.local',JSON.stringify({events:[]}),old.revision,()=>{}),/APP_DATA_CHANGED/);
 assert.equal(JSON.parse((await f.data.read('caldav.local')).content!).events.length,1);
});
test('reinstall merges offline edits, additions and deletions without resurrecting old events',async t=>{
 const f=await fixture(t);const base=JSON.stringify({events:[event('a'),event('b')]});
 await f.data.bootstrap('caldav.local',base,()=>{});
 let current=await f.data.read('caldav.local');
 await f.data.write('caldav.local',JSON.stringify({events:[event('a'),event('b'),event('cli')]}),current.revision,()=>{});
 await f.data.bootstrap('caldav.local',JSON.stringify({events:[event('b','Edited offline'),event('gui')]}),()=>{},base);
 const items=JSON.parse((await f.data.read('caldav.local')).content!).events;
 assert.deepEqual(items.map((e:any)=>e.uid).sort(),['b','cli','gui']);assert.equal(items.find((e:any)=>e.uid==='b').summary,'Edited offline');
});
test('conflicting edits, other accounts and arbitrary document names are fenced',async t=>{
 const f=await fixture(t);const base=JSON.stringify({events:[event('a')]});await f.data.bootstrap('caldav.local',base,()=>{});
 const current=await f.data.read('caldav.local');await f.data.write('caldav.local',JSON.stringify({events:[event('a','CLI')]}),current.revision,()=>{});
 await assert.rejects(f.data.bootstrap('caldav.local',JSON.stringify({events:[event('a','GUI')]}),()=>{},base),/MIGRATION_CONFLICT/);
 f.runtime.session.username='fixture-b';assert.equal((await f.data.read('caldav.local')).content,null);
 await assert.rejects(f.data.read('credentials'),/NAME_DENIED/);
});
test('mail configuration uses the same private record and is absent from calendar results',async t=>{
 const f=await fixture(t);const key='mail-'+(await import('node:crypto')).createHash('sha256').update('fixture-a').digest('hex').slice(0,24);
 await f.store.write(key,{email:'fixture@mails.tsinghua.edu.cn',authCode:'fixture-private-secret'});
 const doc=await f.data.read('caldav.cfg');assert(!doc.content!.includes('fixture-private-secret'));
 await f.data.write('caldav.cfg',doc.content,doc.revision,()=>{});
 assert.deepEqual(await f.store.read(key,null),{email:'fixture@mails.tsinghua.edu.cn',authCode:'fixture-private-secret'});
});

test('authorized cloud configuration is shared and independent CLI changes are preserved',async t=>{
 const f=await fixture(t);const {syncCloudConfig}=await import('../src/configSync.js');
 const cfg={email:'fixture@mails.tsinghua.edu.cn',token:'fixture-private-cloud'};
 assert.equal((await syncCloudConfig(f.runtime,f.store,cfg,()=>{})).status,'synced');
 const hash=(await import('node:crypto')).createHash('sha256').update('fixture-a').digest('hex').slice(0,24);
 assert.deepEqual(await f.store.read('cloud-'+hash,null),cfg);
 await f.store.write('cloud-'+hash,{email:'independent@mails.tsinghua.edu.cn',token:'other-fixture'});
 assert.equal((await syncCloudConfig(f.runtime,f.store,null,()=>{})).status,'conflict');
 assert.equal((await f.store.read<any>('cloud-'+hash,null)).email,'independent@mails.tsinghua.edu.cn');
 f.runtime.session.username='fixture-b';assert.equal((await syncCloudConfig(f.runtime,f.store,null,()=>{})).status,'disconnected');
});
