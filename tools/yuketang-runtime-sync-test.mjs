/** Private bridge orchestration; no school network, real accounts or local credentials. */
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
function fixture() {
  const state={session:{username:'account-a',state:'ready'},creds:{yuketang:{cookie:'sessionid=FIXTURE',uvId:'2598'},days:30},owner:'account-a',authorized:true,enabled:true,requests:[],events:new Set(),guard:async()=>{}};
  const status={epoch:1,username:'account-a'};
  const subscribe=fn=>{state.events.add(fn);return()=>state.events.delete(fn);};
  const imports={
    '../lib/clients.js':{session:state.session},
    '../lib/sharedRuntime.js':{usesSharedRuntime:()=>true,sharedRuntimeSnapshot:()=>status,subscribeSharedRuntime:()=>()=>{},
      sharedAccountGuard:async username=>{await state.guard();if(username!==status.username)throw Error('CLI_SHARED_SESSION_CHANGED');return{expectedAccount:username,expectedEpoch:status.epoch};},
      sharedRuntimeRequest:async(method,params)=>{state.requests.push({method,params});return{status:params.credential?'synced':'disconnected'};}},
    './exthw.js':{ensureExtHwCredsLoaded:async()=>state.creds,getExtHwCreds:()=>state.creds,subscribeExtHw:subscribe,bindLegacyYuketangOwner:()=>{},yuketangCredentialOwner:()=>state.owner},
    './privacyConsent.js':{ohAuthorized:()=>state.authorized,subscribePrivacy:subscribe},
    './userext.js':{mcpServerEnabled:()=>state.enabled,subscribeUserExt:subscribe},
  };
  const source=readFileSync(new URL('../apps/desktop/src/state/yuketangRuntime.ts',import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};new Function('exports','require',code)(exports,name=>{assert.ok(name in imports,name);return imports[name];});
  return{...exports,state};
}
test('GUI sync is private, account fenced and deduplicated; disconnect transfers null',async()=>{
  const f=fixture();await f.syncYuketangRuntime();await f.syncYuketangRuntime();
  assert.equal(f.state.requests.length,1);assert.equal(f.state.requests[0].method,'yuketangSync');
  assert.equal(f.state.requests[0].params.expectedAccount,'account-a');assert.equal(f.state.requests[0].params.expectedEpoch,1);
  f.state.creds={};await f.syncYuketangRuntime();assert.equal(f.state.requests.at(-1).params.credential,null);
});
test('revoked consent and another account source never transfer credentials',async()=>{
  for(const [key,value]of[['authorized',false],['owner','account-b']]){
    const f=fixture();f.state[key]=value;await f.syncYuketangRuntime();assert.equal(f.state.requests.length,0);
  }
});
test('a changed credential during session guard discards the captured credential and transfers the latest',async()=>{
  const f=fixture();let guards=0;
  f.state.guard=async()=>{if(guards++===0)f.state.creds={yuketang:{cookie:'sessionid=REPLACED',uvId:'2598'}};};
  await f.syncYuketangRuntime();assert.equal(f.state.requests.length,1);assert.equal(f.state.requests[0].params.credential.cookie,'sessionid=REPLACED');
});
test('consent revoked while awaiting the account guard blocks the transfer',async()=>{
  const f=fixture();f.state.guard=async()=>{f.state.authorized=false;};await f.syncYuketangRuntime();assert.equal(f.state.requests.length,0);
});
test('a connection failure can be retried without clearing the school session',async()=>{
  const f=fixture();let guards=0;f.state.guard=async()=>{if(guards++===0)throw Error('CLI_DAEMON_UNAVAILABLE');};
  await assert.rejects(f.syncYuketangRuntime(),/CLI_DAEMON_UNAVAILABLE/);assert.equal(f.state.session.state,'ready');
  await f.syncYuketangRuntime();assert.equal(f.state.requests.length,1);
});

test('external CLI access may be off while OH shares authorized Rain Classroom data',async()=>{const f=fixture();f.state.enabled=false;await f.syncYuketangRuntime();assert.equal(f.state.requests.length,1);});
