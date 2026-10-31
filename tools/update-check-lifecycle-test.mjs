/** Actual updater state machine; synthetic manifests and hanging/late transports only. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync('apps/desktop/src/lib/updater.ts','utf8');
const ast=ts.createSourceFile('updater.ts',source,ts.ScriptTarget.Latest,true);
const code=ast.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(ast)).join('\n');
const comparisonSource=readFileSync('apps/desktop/src/lib/update.ts','utf8');
const comparisonAst=ts.createSourceFile('update.ts',comparisonSource,ts.ScriptTarget.Latest,true);
const comparisonCode=comparisonAst.statements.filter(n=>ts.isFunctionDeclaration(n)&&['toTuple','isNewer'].includes(n.name?.text)).map(n=>n.getText(comparisonAst)).join('\n');
const {isNewer}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(comparisonCode,{compilerOptions:{module:ts.ModuleKind.ES2022}}).outputText).toString('base64'));

const CURRENT='0.11.4-fix-1';
let github='ok',cloud='ok',githubVersion='0.12.0',cloudVersion='0.12.0',calls=[];
const manifest=(version,url)=>({version,assets:{android:{name:`OneTHU_${version}_arm64.apk`,url,size:123,sha256:'a'.repeat(64)}}});
Object.defineProperty(globalThis,'navigator',{value:{platform:'Android',userAgent:'Android'},configurable:true});
globalThis.__updateFixture={
 i18n:(key,params)=>key+JSON.stringify(params??{}),currentVersion:()=>CURRENT,isNewer,isAndroidNavigator:()=>true,logLine:async()=>{},
 nativeSessionEpoch:async()=>17,assertNativeSessionEpoch:async epoch=>assert.equal(epoch,17),
 universalFetch:async()=>{calls.push('github');if(github==='hang')return new Promise(()=>{});if(github==='error')throw Error('offline');return new Response(JSON.stringify(manifest(githubVersion,'/Android/github.apk')));},
 invoke:async(command,{input,epoch})=>{assert.equal(epoch,17,'native epoch must be supplied');assert.equal(command,'http_native');assert.equal(input.method,'GET');calls.push('cloud');if(cloud==='hang')return new Promise(()=>{});if(cloud==='error')throw Error('cloud offline');const url=new URL(input.url);if(url.pathname.includes('dirents')){const body=url.searchParams.get('path')==='/'?{dirent_list:[{file_name:'latest.json',is_dir:false,file_path:'/latest.json'}]}:{dirent_list:[]};return {status:200,headers:{},body:JSON.stringify(body)};}return {status:200,headers:{},body:JSON.stringify(manifest(cloudVersion,'/Android/cloud.apk'))};},
};
const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const prelude='const {i18n,currentVersion,isNewer,isAndroidNavigator,logLine,universalFetch,invoke,nativeSessionEpoch,assertNativeSessionEpoch}=globalThis.__updateFixture;\n';
const updater=await import('data:text/javascript;base64,'+Buffer.from(prelude+js).toString('base64'));
const {checkForUpdate,selectUpdateSource}=updater;
let checks=0;const check=(value,label)=>{assert.ok(value,label);checks++;console.log('✓ '+label);};

/* ── 选源规则（纯函数）：两侧都成功时的优先级 ── */
check(selectUpdateSource([])===null,'no result selects no source');
check(selectUpdateSource([{source:'github',latest:'0.12.0'}])==='github','only GitHub → GitHub');
check(selectUpdateSource([{source:'cloud',latest:'0.12.0'}])==='cloud','only cloud → cloud');
check(selectUpdateSource([{source:'github',latest:'0.12.0'},{source:'cloud',latest:'0.12.0'}])==='cloud','same version → cloud mirror');
check(selectUpdateSource([{source:'github',latest:'0.12.0'},{source:'cloud',latest:'0.11.5'}])==='github','strictly newer GitHub → GitHub');
check(selectUpdateSource([{source:'github',latest:'0.11.5'},{source:'cloud',latest:'0.12.0'}])==='cloud','newer cloud → cloud');

/* ── 两侧并行查询：同版本优先云盘，attempts 记录两条成功 ── */
github='ok';cloud='ok';githubVersion='0.12.0';cloudVersion='0.12.0';calls=[];
let result=await checkForUpdate({sourceTimeoutMs:200});
check(result.ok&&result.source==='cloud','equal versions choose the cloud mirror');
check(result.attempts.length===2&&result.attempts.every(attempt=>attempt.ok),'both parallel attempts are recorded as successful');
check(!result.fallbackReason,'no fallback reason when both sources answered');
check(calls[0]==='github'&&calls.includes('cloud'),'both sources are queried concurrently');

/* ── GitHub 严格更新才选 GitHub ── */
githubVersion='0.12.0';cloudVersion='0.11.5';calls=[];
result=await checkForUpdate({sourceTimeoutMs:200});
check(result.ok&&result.source==='github'&&result.latest==='0.12.0','strictly newer GitHub wins');

/* ── 云盘更新时选云盘 ── */
githubVersion='0.11.5';cloudVersion='0.12.0';calls=[];
result=await checkForUpdate({sourceTimeoutMs:200});
check(result.ok&&result.source==='cloud'&&result.latest==='0.12.0','newer cloud mirror wins');

/* ── 一侧失败用另一侧：onSource 以最终选中的源收尾 ── */
githubVersion='0.12.0';cloudVersion='0.12.0';github='hang';cloud='ok';calls=[];
const sources=[];result=await checkForUpdate({sourceTimeoutMs:20,onSource:source=>sources.push(source)});
check(result.ok&&result.source==='cloud','hanging GitHub falls back to cloud within the source deadline');
check(result.attempts[0].ok===false&&result.attempts[0].errorKind==='source-timeout'&&result.attempts[1].ok,'timeout stays structured and cloud attempt succeeds');
check(Boolean(result.fallbackReason),'fallback reason is reported when one side fails');
check(sources[0]==='github'&&sources[1]==='cloud'&&sources.at(-1)==='cloud','onSource reports both launches and settles on the live source');

github='ok';cloud='error';calls=[];
result=await checkForUpdate({sourceTimeoutMs:200});
check(result.ok&&result.source==='github','cloud failure falls back to GitHub');
check(result.attempts[1].ok===false&&Boolean(result.fallbackReason),'cloud failure is recorded with a fallback reason');

/* ── 两侧都挂：快速失败并列出两条原因 ── */
github='hang';cloud='hang';const began=Date.now();
result=await checkForUpdate({sourceTimeoutMs:20});
check(!result.ok&&result.attempts.length===2&&Date.now()-began<1000,'both hung sources return an actionable failure quickly');

/* ── 取消语义：立刻中止，且不再发起新请求 ── */
github='ok';cloud='ok';calls=[];
const controller=new AbortController();
const pending=checkForUpdate({signal:controller.signal,sourceTimeoutMs:5000});
controller.abort();
await assert.rejects(pending,error=>error.name==='AbortError');
const callsAfterAbort=calls.length;
check(callsAfterAbort===2,'parallel transports start before disposition');
await new Promise(resolve=>setTimeout(resolve,30));
check(calls.length===callsAfterAbort,'an aborted check starts no further work');

const already=new AbortController();already.abort();calls=[];
await assert.rejects(checkForUpdate({signal:already.signal}),error=>error.name==='AbortError');
check(calls.length===0,'an already cancelled check performs no network work');

/* ── 失败/取消后还能重新检查 ── */
github='ok';cloud='ok';result=await checkForUpdate({sourceTimeoutMs:200});
check(result.ok&&result.source==='cloud','a fresh check succeeds after failure or cancellation');

/* ── 自定义源仍只查一条 ── */
calls=[];result=await checkForUpdate({customManifestUrl:'https://example.com/latest.json',sourceTimeoutMs:200});
check(result.source==='custom'&&calls.length===1,'custom manifest source stays single-shot');

console.log(`update check lifecycle: ${checks} checks passed (parallel dual-source priority).`);
