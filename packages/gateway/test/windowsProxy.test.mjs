import test from 'node:test';
import assert from 'node:assert/strict';
import {windowsProxyPlan} from '../src/windowsProxy.mjs';
test('Windows manual per-scheme proxy and bypass are preserved in a planned PAC',()=>{
 const config={autoDetect:false,autoConfigUrl:'',proxy:'http=127.0.0.1:7897;https=127.0.0.1:7897;socks=127.0.0.1:7898',proxyBypass:'<local>;*.local;127.*'};
 const plan=windowsProxyPlan(config,{});assert.equal(plan.services[0].name,'CurrentUser');
 assert.deepEqual(plan.services[0].fallback.https,{host:'127.0.0.1',port:7897});assert.deepEqual(plan.services[0].fallback.bypass,['<local>','*.local','127.*']);
 assert.notEqual(windowsProxyPlan({...config,proxyBypass:'localhost'},{}).fingerprint,plan.fingerprint);
});
test('Windows rejects PAC, WPAD, embedded credentials and ambiguous proxy rules before mutation',()=>{
 for(const change of [{autoDetect:true},{autoConfigUrl:'https://corporate.example/proxy.pac'},{proxy:'http=user:secret@host:8080'},{proxy:'https=a:1;https=b:2'},{proxy:'ftp=proxy.example:8080'}])assert.throws(()=>windowsProxyPlan({autoDetect:false,autoConfigUrl:'',proxy:'',...change},{}));
});
