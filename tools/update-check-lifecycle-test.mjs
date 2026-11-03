/** Actual updater state machine; synthetic manifests and hanging/late transports only. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync('apps/desktop/src/lib/updater.ts','utf8');
const ast=ts.createSourceFile('updater.ts',source,ts.ScriptTarget.Latest,true);
const code=ast.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(ast)).join('\n');
let github='hang',cloud='ok',calls=[];
const manifest={version:'0.12.0',assets:{android:{name:'OneTHU_0.12.0_arm64.apk',url:'/Android/OneTHU_0.12.0_arm64.apk',size:123,sha256:'a'.repeat(64)}}};
Object.defineProperty(globalThis,'navigator',{value:{platform:'Android',userAgent:'Android'},configurable:true});
globalThis.__updateFixture={
 i18n:(k,p)=>k+JSON.stringify(p??{}),currentVersion:()=> '0.11.0',isNewer:(a,b)=>a!==b,isAndroidNavigator:()=>true,logLine:async()=>{},
 nativeSessionEpoch:async()=>17,assertNativeSessionEpoch:async epoch=>assert.equal(epoch,17),
 universalFetch:async()=>{calls.push('github');if(github==='hang')return new Promise(()=>{});if(github==='error')throw Error('offline');return new Response(JSON.stringify(manifest));},
 invoke:async(command,{input,epoch})=>{assert.equal(epoch,17,'native epoch must be supplied');assert.equal(command,'http_native');assert.equal(input.method,'GET');calls.push('cloud');if(cloud==='hang')return new Promise(()=>{});if(cloud==='error')throw Error('cloud offline');const url=new URL(input.url);const body=url.pathname.includes('dirents')?{dirent_list:url.searchParams.get('path')==='/'?[{file_name:'latest.json',is_dir:false,file_path:'/latest.json'}]:[]}:manifest;return {status:200,headers:{},body:JSON.stringify(body)};},
};
const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {checkForUpdate}=await import('data:text/javascript;base64,'+Buffer.from('const {i18n,currentVersion,isNewer,isAndroidNavigator,logLine,universalFetch,invoke,nativeSessionEpoch,assertNativeSessionEpoch}=globalThis.__updateFixture;\n'+js).toString('base64'));
const attempts=[];let result=await checkForUpdate({sourceTimeoutMs:20,onSource:s=>attempts.push(s)});
assert.equal(result.ok,true);assert.equal(result.source,'cloud');assert.deepEqual(attempts,['github','cloud']);assert.equal(result.attempts[0].ok,false);console.log('✓ hanging GitHub falls back to cloud within the source deadline');
github='hang';cloud='hang';const began=Date.now();result=await checkForUpdate({sourceTimeoutMs:20});assert.equal(result.ok,false);assert.equal(result.attempts.length,2);assert.ok(Date.now()-began<1000);console.log('✓ both hung sources return an actionable failure');
const controller=new AbortController();calls=[];const pending=checkForUpdate({signal:controller.signal,sourceTimeoutMs:5000});controller.abort();await assert.rejects(pending,e=>e.name==='AbortError');assert.deepEqual(calls,['github']);console.log('✓ cancelling a pending check stops fallback and settles immediately');
const already=new AbortController();already.abort();calls=[];await assert.rejects(checkForUpdate({signal:already.signal}),e=>e.name==='AbortError');assert.deepEqual(calls,[]);console.log('✓ an already cancelled check performs no network work');
github='ok';cloud='ok';result=await checkForUpdate({sourceTimeoutMs:20});assert.equal(result.ok,true);assert.equal(result.source,'github');console.log('✓ a fresh check succeeds after failure or cancellation');
