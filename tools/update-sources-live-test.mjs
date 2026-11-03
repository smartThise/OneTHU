#!/usr/bin/env node
/** Read-only live probe of the actual updater functions. Never downloads via native installer IPC. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const path='apps/desktop/src/lib/updater.ts',source=readFileSync(path,'utf8');
const expectedVersion=process.env.ONETHU_EXPECT_VERSION??JSON.parse(readFileSync('apps/desktop/package.json','utf8')).version;
const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);
const code=ast.statements.filter(node=>!ts.isImportDeclaration(node)).map(node=>node.getText(ast)).join('\n');
let platform='macos',offlineGitHub=false;
const comparisonSource=readFileSync('apps/desktop/src/lib/update.ts','utf8');
const comparisonAst=ts.createSourceFile('update.ts',comparisonSource,ts.ScriptTarget.Latest,true);
const comparisonCode=comparisonAst.statements.filter(n=>ts.isFunctionDeclaration(n)&&['toTuple','isNewer'].includes(n.name?.text)).map(n=>n.getText(comparisonAst)).join('\n');
const {isNewer}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(comparisonCode,{compilerOptions:{module:ts.ModuleKind.ES2022}}).outputText).toString('base64'));
globalThis.__liveUpdater={
 i18n:key=>key, currentVersion:()=> '0.10.0',isNewer,logLine:async()=>{},isAndroidNavigator:()=>platform==='android',
 nativeSessionEpoch:async()=>17,assertNativeSessionEpoch:async epoch=>assert.equal(epoch,17),
 universalFetch:async(url,options)=>{if(offlineGitHub)throw Error('deliberately unavailable GitHub');return fetch(url,{...options,signal:AbortSignal.timeout(30000)});},
 invoke:async(command,{input,epoch})=>{assert.equal(epoch,17,'native epoch must be supplied');assert.equal(command,'http_native','Only read-only HTTP IPC is permitted');assert.equal(input.method,'GET');const r=await fetch(input.url,{redirect:'manual',signal:AbortSignal.timeout(30000)});return {status:r.status,headers:Object.fromEntries(r.headers),body:await r.text()};},
};
const compiled=ts.transpileModule(code+'\nexport {fromCloud,fromGitHub};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const prelude='const {i18n,currentVersion,isNewer,logLine,isAndroidNavigator,universalFetch,invoke,nativeSessionEpoch,assertNativeSessionEpoch}=globalThis.__liveUpdater;\n';
const updater=await import(`data:text/javascript;base64,${Buffer.from(prelude+compiled).toString('base64')}`);
for(platform of ['macos','windows','android']){
 Object.defineProperty(globalThis,'navigator',{value:{platform:platform==='macos'?'MacIntel':'Win32',userAgent:platform==='android'?'Android':'',},configurable:true});
 const github=await updater.fromGitHub(platform),cloud=await updater.fromCloud(platform);
 for(const result of [github,cloud]){assert.equal(result.latest,expectedVersion);assert.equal(result.hasUpdate,true);assert.equal(result.hashAvailable,true);assert.match(result.asset.sha256,/^[a-f0-9]{64}$/);}
 assert.equal(cloud.asset.sha256,github.asset.sha256);assert.equal(cloud.downloadName,github.downloadName);
 assert.ok(cloud.downloadUrl.includes(encodeURIComponent(cloud.asset.url)));
 offlineGitHub=true;const fallback=await updater.checkForUpdate({});offlineGitHub=false;
 assert.equal(fallback.ok,true);assert.equal(fallback.source,'cloud');assert.equal(fallback.latest,expectedVersion);assert.equal(fallback.hashAvailable,true);assert.equal(fallback.attempts.length,2);
 console.log(`✓ ${platform}: real GitHub/cloud manifests, matching SHA256, GitHub failure falls back to cloud`);
}
