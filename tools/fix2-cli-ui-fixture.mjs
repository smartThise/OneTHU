/** Render the production settings component with synthetic native ports only.
 * Open the printed loopback URL for visual/interaction acceptance. */
import {createRequire} from 'node:module';
const {build}=createRequire(new URL('../packages/sdk/package.json',import.meta.url))('esbuild');
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
const requireDesktop=createRequire(new URL('../apps/desktop/package.json',import.meta.url));
const root=process.cwd(),out=path.join(root,'output/fix2-ui-fixture');await mkdir(out,{recursive:true});
const state=`import React from 'react';
const phone=new URLSearchParams(location.search).has('phone');
export const isTauri=true;export const isAndroidNavigator=()=>phone;
let installed=false;export const refreshCliInstallation=async()=>({installed,available:installed,version:'0.11.4-fix-2',expectedVersion:'0.11.4-fix-2'});
export async function changeCliInstallation(action){await new Promise(resolve=>setTimeout(resolve,1200));installed=action==='install';}
let requested=false,automatic=false;const listeners=new Set();const notify=()=>listeners.forEach(fn=>fn());
export const subscribeUserExt=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
export const cliAutoExecuteEnabled=()=>automatic;export const setCliAutoExecute=value=>{automatic=value;notify();};
export const setMcpServer=value=>{requested=value;notify();};
export const syncCliRuntime=async()=>{};
export function useCliRuntime(){React.useSyncExternalStore(subscribeUserExt,()=>requested);return {requested,authorized:true,phase:'ready',reachableNow:requested};}
export function CliTasksSettings(){return React.createElement('p',{'data-testid':'app-tasks'},phone?'应用内任务 · 无需 CLI':'应用内任务 / In-app tasks · available with CLI access off');}
`;
const imports=new Set(['../lib/sharedRuntime.js','../lib/transport.js','../lib/androidHost.js','../state/userext.js','../state/cliRuntime.js','./CliTasksSettings.js']);
await build({alias:{react:path.dirname(requireDesktop.resolve('react/package.json')),'react-dom':path.dirname(requireDesktop.resolve('react-dom/package.json'))},nodePaths:[path.join(root,'apps/desktop/node_modules')],stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{SettingsList}from'@onethu/gui';import{CliServerSettings}from'./apps/desktop/src/components/CliServerSettings.tsx';import{setLocale}from'./apps/desktop/src/i18n/index.ts';import'@onethu/ui/tokens.css';import'@onethu/gui/gui.css';setLocale(new URLSearchParams(location.search).get('lang')==='en'?'en-US':'zh-CN');createRoot(document.getElementById('root')).render(<SettingsList><CliServerSettings/></SettingsList>);`,loader:'tsx',resolveDir:root},outfile:path.join(out,'fixture.js'),bundle:true,format:'esm',jsx:'automatic',plugins:[{name:'synthetic-native-ports',setup(build){build.onResolve({filter:/.*/},args=>imports.has(args.path)&&args.importer.includes('/components/Cli')?{path:'ports',namespace:'fixture'}:undefined);build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:state,loader:'tsx',resolveDir:root}));}}]});
await writeFile(path.join(out,'index.html'),`<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;padding:24px;background:#f7f7f5;color:#222;font:15px system-ui}main{max-width:820px;margin:32px auto}nav{display:flex;gap:12px;flex-wrap:wrap}a{color:inherit}h1{font-size:26px}@media(max-width:500px){body{padding:16px}main{margin:24px auto}}</style><nav><a href="/">中文 · 桌面</a><a href="/?lang=en">English · Desktop</a><a href="/?phone=1">中文 · 手机</a><a href="/?phone=1&lang=en">English · Phone</a></nav><main><h1>CLI 安装与应用内服务 · 验收夹具</h1><div id="root"></div></main><script type="module" src="/fixture.js"></script></html>`);
http.createServer(async(req,res)=>{const name=req.url.split('?')[0];if(!['/','/fixture.js','/fixture.css'].includes(name)){res.writeHead(404).end();return;}try{res.setHeader('content-type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(await readFile(path.join(out,name==='/'?'index.html':name.slice(1))));}catch{res.writeHead(500).end();}}).listen(5199,'127.0.0.1',()=>console.log('Synthetic native ports, no account data: http://127.0.0.1:5199/'));
