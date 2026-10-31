import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { DaemonClient, dispatchDesktop } from '../src/daemon.mjs';

const entry=fileURLToPath(new URL('../bin/onethu.mjs',import.meta.url));
test('resident daemon works without GUI, guards loopback credentials and closes cleanly',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'onethu-daemon-中文 '));
  const child=spawn(process.execPath,[entry,'daemon','serve','--data-dir',dir],{env:{...process.env,ONETHU_ENDPOINT:''},stdio:['ignore','pipe','pipe']});
  const closed=once(child,'close');let stderr='';child.stderr.on('data',x=>stderr+=x);
  t.after(async()=>{if(child.exitCode===null)child.kill('SIGTERM');await closed;await rm(dir,{recursive:true,force:true});});
  const lines=createInterface({input:child.stdout});
  const ready=await Promise.race([once(lines,'line'),closed.then(()=>{throw Error(stderr||'daemon exited before ready');}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('daemon startup timeout')),15000);timer.unref();})]);
  assert.equal(JSON.parse(ready[0]).running,true);lines.close();
  const file=path.join(dir,'daemon-access.json');const record=JSON.parse(await readFile(file,'utf8'));
  if(process.platform!=='win32')assert.equal((await stat(file)).mode&0o077,0);
  const client=new DaemonClient(record,5000);
  const daemonStatus=await client.call('daemon.status');
  assert.equal(daemonStatus.running,true);
  assert.equal(daemonStatus.desktopProtocolVersion,1);
  const desktopStatus=await client.call('desktop.status');
  assert.equal(desktopStatus.protocolVersion,1);
  const emptySession=await client.call('desktop.exportSession');
  assert.equal(emptySession.snapshot,null);
  const ops=await client.call('service/list');assert.equal(ops.mode,'standalone');assert(ops.operations.some(x=>x.name==='tasks.create'));
  const gateway=await client.call('gateway.control',{action:'status'});
  assert.equal(gateway.running,false);assert.equal(gateway.endpoint,null);
  assert(!JSON.stringify(gateway).includes('password'));
  await assert.rejects(client.call('gateway.control',{action:'setup'}),{code:'GATEWAY_CONFIRM_REQUIRED'});
  const url=`http://127.0.0.1:${record.port}/cli/v1`,body=JSON.stringify({jsonrpc:'2.0',id:1,method:'daemon.status'});
  for(const [token,origin] of [['é'.repeat(64),undefined],['0'.repeat(64),undefined],[record.token,'https://example.invalid']]){
    const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body});
    assert.equal(response.status,403);await response.text();
  }
  assert.equal((await client.call('daemon.status')).running,true,'malformed token must not terminate daemon');
  const mcp=JSON.parse((await client.post('/mcp',{jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'onethu_call',arguments:{operation:'agent.configure',args:[{}],confirm:true}}})).text);
  assert.equal(mcp.result.isError,true);assert.match(JSON.stringify(mcp),/CLI_LOCAL_CONFIGURATION_REQUIRED/);
  const privateViaMcp=JSON.parse((await client.post('/mcp',{jsonrpc:'2.0',id:5,method:'desktop.exportSession'})).text);
  assert.equal(privateViaMcp.error.code,-32601);
  const privateRain=JSON.parse((await client.post('/mcp',{jsonrpc:'2.0',id:7,method:'desktop.yuketangSync',params:{credential:{cookie:'private-fixture'}}})).text);
  assert.equal(privateRain.error.code,-32601);
  const privateGateway=JSON.parse((await client.post('/mcp',{jsonrpc:'2.0',id:8,method:'gateway.control',params:{action:'credentials',confirm:true}})).text);
  assert.equal(privateGateway.error.code,-32601);
  const toolPrivate=JSON.parse((await client.post('/mcp',{jsonrpc:'2.0',id:6,method:'tools/call',params:{name:'onethu_call',arguments:{operation:'desktop.exportSession',args:[],confirm:true}}})).text);
  assert.equal(toolPrivate.result.isError,true);
  assert.match(JSON.stringify(toolPrivate),/UNKNOWN_OPERATION/);
  assert(!ops.operations.some(op=>op.name.startsWith('desktop.')),'private identity transfer never appears in public registry');
  assert(!ops.operations.some(op=>op.name.startsWith('gateway.')),'private proxy control never appears in public registry');
  await assert.rejects(client.call('desktop.constructor'),/DAEMON UNKNOWN METHOD/);
  await client.call('policy.set',{enabled:true,confirm:true});
  assert.equal((await client.call('service/list')).confirmationMode,'automatic');
  await assert.rejects(client.call('policy.enabled',{enabled:false}),/CLI LOCAL APPROVAL REQUIRED/);
  await client.call('policy.enabled',{enabled:false,confirm:true});
  assert.equal((await client.call('desktop.status')).policy.enabled,false);
  await client.call('policy.enabled',{enabled:true,confirm:true});
  assert.equal((await client.call('desktop.status')).policy.enabled,true);
  await client.call('daemon.stop');assert.equal((await closed)[0],0);
  await assert.rejects(readFile(file),{code:'ENOENT'});
  assert.equal(stderr,'');
});

test('daemon client forwards its deadline to service execution',async()=>{
  const client=new DaemonClient({port:1,token:'0'.repeat(64)},200);let seen;
  client.post=async(route,body)=>{seen=body;return{text:JSON.stringify({jsonrpc:'2.0',id:body.id,result:true})};};
  const before=Date.now();await client.call('service/call',{operation:'learn.courses',args:[]});
  assert(seen.params.deadlineUnixMs>=before+200&&seen.params.deadlineUnixMs<=Date.now()+200);
});

test('desktop dispatch uses an exact private allowlist and forwards cancellation and bounded deadlines',async()=>{
  const controller=new AbortController();let received;
  const runtime={desktop:{call:async(input,opts)=>{received={input,opts};return {ok:true};},exportSession:()=>({snapshot:null})}};
  assert.deepEqual(await dispatchDesktop(runtime,'desktop.call',{operation:'tasks.list',deadlineUnixMs:Infinity},controller.signal),{ok:true});
  assert.equal(received.opts.signal,controller.signal);
  assert(received.input.deadlineUnixMs<=Date.now()+150000);
  for(const method of ['desktop.constructor','desktop.__proto__','desktop.call.extra','call','auth.login'])await assert.rejects(dispatchDesktop(runtime,method,{},controller.signal),{code:'DAEMON_UNKNOWN_METHOD'});
  await assert.rejects(dispatchDesktop({},'desktop.status',{},controller.signal),{code:'DESKTOP_RUNTIME_UPDATE_REQUIRED'});
});

test('desktop client preserves the shorter caller deadline',async()=>{
  const client=new DaemonClient({port:1,token:'0'.repeat(64)},5000);let seen;
  client.post=async(route,body)=>{seen=body;return{text:JSON.stringify({jsonrpc:'2.0',id:body.id,result:true})};};
  const deadline=Date.now()+50;await client.call('desktop.call',{operation:'tasks.run',args:['id'],deadlineUnixMs:deadline});
  assert.equal(seen.params.deadlineUnixMs,deadline);
});
