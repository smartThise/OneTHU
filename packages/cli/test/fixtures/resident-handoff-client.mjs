/** A short-lived native-adapter stand-in using the actual private daemon RPC. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DaemonClient } from '../../src/daemon.mjs';
const [profile,action,taskId]=process.argv.slice(2);
const record=JSON.parse(await readFile(path.join(profile,'daemon-access.json'),'utf8'));
const client=new DaemonClient(record,10000);
if(action==='handoff'){
  const empty=await client.call('desktop.status');
  if(empty.username!==null||!empty.bootstrapAllowed)throw Error('FIXTURE_PROFILE_NOT_EMPTY');
  const snapshot={username:'90000001',fingerprint:'d'.repeat(32),finger3:'synthetic-shared-trust',savedAt:Date.now(),cookiesJson:JSON.stringify([
    {name:'sid',value:'synthetic-session',domain:'id.tsinghua.edu.cn',path:'/',secure:true,hostOnly:true},
    {name:'XSRF-TOKEN',value:'synthetic-csrf',domain:'webvpn.tsinghua.edu.cn',path:'/',secure:true,hostOnly:true},
  ])};
  const adopted=await client.call('desktop.adoptSession',{snapshot,expectedEpoch:empty.epoch,reason:'bootstrap'});
  const guard={expectedAccount:adopted.username,expectedEpoch:adopted.epoch};
  await client.call('desktop.policy',{...guard,enabled:true,appEnabled:true,automatic:false});
  const runAt=Date.now()+1200;
  const task=await client.call('desktop.call',{...guard,operation:'tasks.create',confirm:true,args:[{
    name:'Synthetic background school identity check',schedule:{kind:'once',runAt:new Date(runAt).toISOString()},
    template:{kind:'operation',operation:'user.info',args:[],channels:['inbox']},
  }]});
  await client.close();
  // Output contains no session snapshot, cookie, credential or daemon token.
  process.stdout.write(JSON.stringify({clientPid:process.pid,taskId:task.id,runAt,finishedAt:Date.now()})+'\n');
}else if(action==='inspect'){
  const shared=await client.call('desktop.exportSession');
  if(shared.username!=='90000001'||shared.session.state!=='ready')throw Error('FIXTURE_SHARED_SESSION_MISSING');
  const guard={expectedAccount:shared.username,expectedEpoch:shared.epoch};
  const task=await client.call('desktop.call',{...guard,operation:'tasks.get',args:[taskId]});
  const history=await client.call('desktop.call',{...guard,operation:'tasks.history',args:[taskId]});
  const inbox=await client.call('desktop.call',{...guard,operation:'notifications.inbox',args:[]});
  await client.close();
  process.stdout.write(JSON.stringify({clientPid:process.pid,task,history,inboxCount:inbox.messages.length,inboxText:inbox.messages[0]?.text})+'\n');
}else if(action==='stop'){
  await client.call('daemon.stop');await client.close();process.stdout.write('{"stopped":true}\n');
}else throw Error('FIXTURE_ACTION_INVALID');
