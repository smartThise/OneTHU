/** Real translated messages and updater methods with synthetic IPC/network only. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { t as i18n, msg as i18nMsg, resolveMessage, setLocale } from '../apps/desktop/src/i18n/index.ts';

const source=readFileSync('apps/desktop/src/lib/updater.ts','utf8');
const ast=ts.createSourceFile('updater.ts',source,ts.ScriptTarget.Latest,true);
const code=ast.statements.filter(node=>!ts.isImportDeclaration(node)).map(node=>node.getText(ast)).join('\n');
let installerCalls=0;
globalThis.__updateLocaleFixture={i18n,i18nMsg,resolveMessage,currentVersion:()=> '0.11.2',isNewer:(a,b)=>a!==b,isAndroidNavigator:()=>true,logLine:async()=>{},
 nativeSessionEpoch:async()=>17,assertNativeSessionEpoch:async epoch=>assert.equal(epoch,17),
 universalFetch:async()=>new Promise(()=>{}),
 invoke:async(command,args)=>{if(command==='http_native'){assert.equal(args.epoch,17);return new Promise(()=>{});}assert.equal(command,'updater_open_installer');installerCalls++;},
};
const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const updater=await import('data:text/javascript;base64,'+Buffer.from('const {i18n,i18nMsg,resolveMessage,currentVersion,isNewer,isAndroidNavigator,logLine,universalFetch,invoke,nativeSessionEpoch,assertNativeSessionEpoch}=globalThis.__updateLocaleFixture;\n'+js).toString('base64'));
const uiSource=readFileSync('apps/desktop/src/components/SoftwareUpdateSection.tsx','utf8');
const uiAst=ts.createSourceFile('SoftwareUpdateSection.tsx',uiSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const noticeFn=uiAst.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='resolveUpdateNotice');
assert.ok(noticeFn);
const noticeJs=ts.transpileModule(noticeFn.getText(uiAst),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const resolveNotice=new Function('resolveMessage',noticeJs+';return resolveUpdateNotice;')(resolveMessage);
let checks=0;const check=(value,label)=>{assert.ok(value,label);checks++;console.log('✓ '+label);};
setLocale('en-US');
const failed=await updater.checkForUpdate({sourceTimeoutMs:5});
check(!failed.ok && failed.attempts.every(attempt=>attempt.errorKind==='source-timeout'),'real timeout paths retain their machine error kind');
const fallback={ok:true,source:'cloud',sourceLabel:updater.SOURCE_LABEL.cloud,attempts:[failed.attempts[0]],notes:'Original release notes / 原始说明'};
const englishFailure=updater.updateFailureText(failed),englishFallback=updater.updateFallbackText(fallback);
const notice={text:i18nMsg('components.softwareupdatesection.1e178bb2ba4b',{path:'/fixture/installer'}),params:{value:i18nMsg('components.softwareupdatesection.78ed0342345e')}};
const englishNotice=resolveNotice(notice);
const external={text:i18nMsg('components.softwareupdatesection.6dd57693b44a'),params:{value:'External error with 原文'}};
setLocale('zh-CN');
check(updater.updateFailureText(failed)!==englishFailure && updater.updateFailureText(failed).includes(i18n('update.sourceTimeout',{source:updater.SOURCE_LABEL.github})),'stored timeout results rebuild translated source names and diagnostics');
check(updater.updateFallbackText(fallback)!==englishFallback,'fallback text follows the current language after the check completes');
check(updater.updateSourceLabel(fallback)===updater.SOURCE_LABEL.cloud && updater.updateSourceLabel(fallback)!==fallback.sourceLabel,'cached sourceLabel is replaced by the live label for its source ID');
check(resolveNotice(notice)!==englishNotice && resolveNotice(notice).includes('/fixture/installer'),'stored notices resolve both their template and nested app-owned hint at render time');
check(resolveNotice(external).includes('External error with 原文') && fallback.notes==='Original release notes / 原始说明','native/external reasons and release notes remain unchanged');
const launched=await updater.installDownloaded('/fixture/installer');
const zhHint=resolveMessage(launched.hintMessage);setLocale('en-US');
check(launched.ok && installerCalls===1 && resolveMessage(launched.hintMessage)!==zhHint,'installer hint remains translatable after the real launch method returns');
setLocale('zh-CN');
console.log(`Update language: ${checks} checks passed; no download or installer launched.`);
