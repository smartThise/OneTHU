/** Production updater + epoch functions against a strict Rust IPC signature fixture. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const read=p=>readFileSync(p,'utf8');
const rust=read('apps/desktop/src-tauri/src/lib.rs');
assert.match(rust.slice(rust.indexOf('async fn http_native('),rust.indexOf('async fn http_native(')+180),/epoch:\s*u64/);
function functions(file,names){const source=read(file),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);return names.map(name=>{const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(node,name);return node.getText(ast);}).join('\n');}
const code=ts.transpileModule(functions('apps/desktop/src/lib/transport.ts',['nativeSessionChanged','nativeSessionEpoch','assertNativeSessionEpoch'])+'\n'+functions('apps/desktop/src/lib/updater.ts',['httpNativeGet']),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture({epoch:initial=0,response}={}){
 let epoch=initial;const calls=[];
 const invoke=async(command,args)=>{
  if(command==='http_native_epoch')return epoch;
  assert.equal(command,'http_native');assert.ok(Object.hasOwn(args,'epoch'),'http_native missing required key epoch');
  assert.ok(Number.isSafeInteger(args.epoch)&&args.epoch>=0,'epoch must satisfy Rust u64');assert.equal(args.epoch,epoch,'stale IPC epoch');
  assert.equal(args.input.method,'GET');assert.equal(args.input.body,null);assert.equal(args.input.body_b64,null);calls.push(args);
  return response?response(args,calls.length):{status:200,headers:{},body:'public update'};
 };
 const get=new Function('exports','require','isTauri','invoke',code+'\nreturn httpNativeGet;')({},()=>({invoke}),true,invoke);
 return {get,calls,switchAccount:()=>epoch++};
}
let count=0;async function test(name,fn){await fn();count++;console.log('PASS '+name);}
await test('signed-out epoch zero reaches the public mirror with all required native args',async()=>{
 const h=fixture();assert.equal((await h.get('https://cloud.tsinghua.edu.cn/api/v2.1/share-links/public/dirents/')).text,'public update');assert.equal(h.calls[0].epoch,0);assert.equal(h.calls[0].input.url.startsWith('https://cloud.tsinghua.edu.cn/'),true);
});
await test('redirects keep the original epoch and stay on direct URLs',async()=>{
 const h=fixture({epoch:7,response:(_args,n)=>n===1?{status:302,headers:{Location:'/seafhttp/files/public/latest.json'},body:''}:{status:200,headers:{},body:'manifest'}});
 assert.equal((await h.get('https://cloud.tsinghua.edu.cn/d/public/files/')).text,'manifest');assert.deepEqual(h.calls.map(c=>c.epoch),[7,7]);assert.equal(h.calls[1].input.url,'https://cloud.tsinghua.edu.cn/seafhttp/files/public/latest.json');
});
await test('an account change while waiting rejects a response instead of reusing it',async()=>{
 let release;const gate=new Promise(r=>release=r);const h=fixture({epoch:4,response:async()=>{await gate;return {status:200,headers:{},body:'old epoch'};}});
 const pending=h.get('https://cloud.tsinghua.edu.cn/');while(!h.calls.length)await new Promise(r=>setTimeout(r,0));h.switchAccount();release();await assert.rejects(pending,e=>e.code==='AUTH_SESSION_CHANGED');
});
await test('an account change before redirect prevents a request under the new owner',async()=>{
 let h;h=fixture({epoch:4,response:()=>{h.switchAccount();return {status:302,headers:{location:'/next'},body:''};}});
 await assert.rejects(h.get('https://cloud.tsinghua.edu.cn/'),e=>e.code==='AUTH_SESSION_CHANGED');assert.equal(h.calls.length,1);
});
await test('binary public response decoding preserves manifest text',async()=>{
 const h=fixture({response:()=>({status:200,headers:{},body:'',body_b64:Buffer.from('更新 metadata').toString('base64')})});assert.equal((await h.get('https://cloud.tsinghua.edu.cn/')).text,'更新 metadata');
});
console.log(`${count} updater native IPC checks passed; no school or account data used`);
