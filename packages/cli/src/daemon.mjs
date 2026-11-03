import http from 'node:http';
import { readFile, lstat, open, unlink, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { CliError, MAX_REQUEST_BYTES } from './client.mjs';
import { loadSdk, handleMcp, sdkError } from './standalone.mjs';
import { configureAutostart } from './service.mjs';
const accessName='daemon-access.json';
const code=(name)=>new CliError(name,name.replace(/_/g,' '),3);
export const DESKTOP_PROTOCOL_VERSION = 1;
const desktopMethods = new Set(['status','exportSession','adoptSession','logout','policy','migrateTasks','call','notificationsSync','yuketangSync','dataRead','dataWrite','dataBootstrap','retire','unretire','cloudSync']);
const MAX_DESKTOP_REQUEST_BYTES = 8 * 1024 * 1024;
async function runtimeIdentity() {
  try {
    const meta=JSON.parse(await readFile(new URL('../runtime.json',import.meta.url),'utf8'));
    if(typeof meta.buildId==='string'&&/^[a-zA-Z0-9._-]{1,128}$/.test(meta.buildId))return meta.buildId;
  } catch { /* Source and npm installations need no desktop bundle manifest. */ }
  return null;
}
/** Private device adapter. It is deliberately absent from the public service
 * registry and MCP handlers. The native main-window bridge owns its credential. */
export async function dispatchDesktop(runtime, method, params, signal) {
  const name=method.slice('desktop.'.length);
  if(!method.startsWith('desktop.')||!desktopMethods.has(name))throw code('DAEMON_UNKNOWN_METHOD');
  if(!runtime.desktop||typeof runtime.desktop[name]!=='function')throw code('DESKTOP_RUNTIME_UPDATE_REQUIRED');
  if(name==='call')params={...params,deadlineUnixMs:Math.min(params?.deadlineUnixMs??Infinity,Date.now()+150000)};
  return runtime.desktop[name](params,{signal});
}
async function access(dataDir) {
  const file=path.join(dataDir,accessName);
  try{
    const meta=await lstat(file);if(!meta.isFile()||meta.isSymbolicLink()||meta.nlink!==1||meta.size>4096)throw code('DAEMON_ACCESS_INVALID');
    if(process.platform!=='win32'&&((meta.mode&0o077)!==0||meta.uid!==process.getuid()))throw code('DAEMON_ACCESS_PERMISSIONS');
    const h=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));let record;try{record=JSON.parse(await h.readFile('utf8'));}finally{await h.close();}
    if(!Number.isSafeInteger(record.port)||record.port<1||record.port>65535||!/^[a-f0-9]{64}$/.test(record.token)||!Number.isSafeInteger(record.pid))throw code('DAEMON_ACCESS_INVALID');
    return record;
  }catch(error){if(error.code==='ENOENT')return null;throw error;}
}
export class DaemonClient {
  constructor(record,timeout=120000){this.record=record;this.timeout=Number(timeout);this.sequence=0;this.endpoint={origin:`http://127.0.0.1:${record.port}`};}
  async post(route,message){
    const body=JSON.stringify(message);const limit=route==='/cli/v1'&&message.method?.startsWith('desktop.')?MAX_DESKTOP_REQUEST_BYTES:MAX_REQUEST_BYTES;if(Buffer.byteLength(body)>limit)throw code('DAEMON_REQUEST_TOO_LARGE');
    return new Promise((resolve,reject)=>{
      const req=http.request({host:'127.0.0.1',port:this.record.port,path:route,method:'POST',agent:false,headers:{Authorization:`Bearer ${this.record.token}`,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{
        const chunks=[];let count=0;res.on('data',chunk=>{count+=chunk.length;if(count>16*1024*1024)req.destroy(code('DAEMON_RESPONSE_TOO_LARGE'));else chunks.push(chunk);});
        res.on('error',()=>reject(code('DAEMON_CONNECTION_INTERRUPTED')));
        res.on('end',()=>{if(res.statusCode!==200&&res.statusCode!==204){reject(code('DAEMON_REQUEST_REJECTED'));return;}resolve({contentType:'application/json',text:Buffer.concat(chunks).toString('utf8')});});
      });
      req.setTimeout(this.timeout,()=>req.destroy(code('DAEMON_REQUEST_TIMEOUT')));
      req.on('error',error=>reject(error instanceof CliError?error:code('DAEMON_UNAVAILABLE')));req.end(body);
    });
  }
  async call(method,params){if(method==='service/call'||method==='desktop.call')params={...params,deadlineUnixMs:Math.min(params?.deadlineUnixMs??Infinity,Date.now()+this.timeout)};const id=++this.sequence;const res=JSON.parse((await this.post('/cli/v1',{jsonrpc:'2.0',id,method,params})).text);if(res.id!==id)throw code('DAEMON_RESPONSE_INVALID');if(res.error)throw new CliError(res.error.data?.code??'DAEMON_ERROR',res.error.message,1);return res.result;}
  async close(){}
  get runtime(){return {auth:{status:()=>this.call('auth.status'),restore:()=>this.call('auth.restore'),login:input=>this.call('auth.login',input),logout:()=>this.call('auth.logout'),twoFactor:{chooseMethod:type=>this.call('auth.choose',{type}),verify:(type,value,trustDevice)=>this.call('auth.verify',{type,code:value,trustDevice}),cancel:()=>this.call('auth.cancel')}},setAutomatic:(enabled,opts)=>this.call('policy.set',{enabled,...opts}),setEnabled:(enabled,opts)=>this.call('policy.enabled',{enabled,...opts})};}
}
export async function connectDaemon(dataDir,timeout){const record=await access(dataDir);if(!record)return null;const client=new DaemonClient(record,timeout);try{await client.call('daemon.status');return client;}catch(error){try{process.kill(record.pid,0);}catch(probe){if(probe.code==='ESRCH')return null;}throw error;}}
export async function serve(options,{stdout=process.stdout,stderr=process.stderr}={}) {
  const sdk=await loadSdk();const runtime=await sdk.createOneThu({dataDir:options.dataDir});
  const token=randomBytes(32).toString('hex');let stopping=false,stopPromise;
  const runtimeId=await runtimeIdentity();
  let restoring=true,startPromise=Promise.resolve();
  const server=http.createServer(async(req,res)=>{
    const supplied=String(req.headers.authorization??'').replace(/^Bearer /,'');
    if(req.method!=='POST'||req.headers.origin||!['/cli/v1','/mcp'].includes(req.url)||!/^[a-f0-9]{64}$/.test(supplied)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token))){res.writeHead(403).end();return;}
    if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??'')){res.writeHead(415).end();return;}
    const controller=new AbortController();
    req.once('aborted',()=>controller.abort());res.once('close',()=>{if(!res.writableEnded)controller.abort();});
    const chunks=[];let size=0;let message;
    try{
      for await(const chunk of req){size+=chunk.length;if(size>(req.url==='/cli/v1'?MAX_DESKTOP_REQUEST_BYTES:MAX_REQUEST_BYTES)){res.writeHead(413).end();return;}chunks.push(chunk);}
      message=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!message||Array.isArray(message)||message.jsonrpc!=='2.0'||typeof message.method!=='string')throw code('DAEMON_INVALID_REQUEST');
      if(size>MAX_REQUEST_BYTES&&!(req.url==='/cli/v1'&&message.method.startsWith('desktop.')&&desktopMethods.has(message.method.slice(8)))){res.writeHead(413).end();return;}
      if(req.url==='/mcp'){const result=await handleMcp(runtime,message,{signal:controller.signal});res.writeHead(result?200:204,{'Content-Type':'application/json'}).end(result?JSON.stringify(result):'');return;}
      let result;const p=message.params;
      if(stopping&&message.method!=='daemon.status')throw code('DAEMON_STOPPING');
      if(message.method==='service/list')result=runtime.list();
      else if(message.method==='service/call')result=await runtime.call(p,{source:'local',signal:controller.signal});
      else if(message.method==='daemon.status')result={running:!stopping,pid:process.pid,version:sdk.VERSION,desktopProtocolVersion:runtime.desktop?DESKTOP_PROTOCOL_VERSION:0,runtimeId,restoring,session:runtime.auth.status()};
      else if(message.method==='daemon.stop'){result={stopping:true};setTimeout(()=>void stop(),50);}
      else if(message.method.startsWith('desktop.')){
        // Snapshot reads and explicit account control must remain available
        // while an optional startup network probe is pending. Epoch fencing in
        // the SDK makes logout/adoption supersede that older probe.
        if(!['desktop.status','desktop.exportSession','desktop.adoptSession','desktop.logout','desktop.policy'].includes(message.method))await startPromise;
        if(controller.signal.aborted)throw code('DAEMON_REQUEST_CANCELLED');
        result=await dispatchDesktop(runtime,message.method,p,controller.signal);
        if(message.method==='desktop.status'||message.method==='desktop.exportSession')result={...result,runtimeId,restoring};
      }
      else if(message.method==='auth.status')result=runtime.auth.status();
      else if(message.method==='auth.restore')result=await runtime.auth.restore();
      else if(message.method==='auth.login'){if(!p||typeof p.username!=='string'||typeof p.password!=='string')throw code('AUTH_INVALID_CREDENTIALS');result=await runtime.auth.login(p);}
      else if(message.method==='auth.choose')result=await runtime.auth.twoFactor.chooseMethod(p?.type);
      else if(message.method==='auth.verify')result=await runtime.auth.twoFactor.verify(p?.type,p?.code,p?.trustDevice);
      else if(message.method==='auth.cancel')result=await runtime.auth.twoFactor.cancel();
      else if(message.method==='auth.logout')result=await runtime.auth.logout();
      else if(message.method==='policy.set')result=await runtime.setAutomatic(p?.enabled,{confirm:p?.confirm});
      else if(message.method==='policy.enabled')result=await runtime.setEnabled(p?.enabled,{confirm:p?.confirm});
      else throw code('DAEMON_UNKNOWN_METHOD');
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({jsonrpc:'2.0',id:message.id,result}));
    }catch(error){const e=sdkError(error);res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:message?.id??null,error:{code:-32000,message:e.message,data:{code:e.code}}}));}
  });
  server.requestTimeout=150000;server.headersTimeout=10000;server.keepAliveTimeout=1000;server.maxConnections=32;
  const file=path.join(runtime.dataDir,accessName);
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    // Runtime's exclusive lock proves an old daemon cannot own this profile.
    const old=await access(runtime.dataDir);if(old)await unlink(file);
    const h=await open(file,'wx',0o600);try{await h.writeFile(JSON.stringify({port:server.address().port,token,pid:process.pid}));await h.sync();}finally{await h.close();}
  }catch(error){server.close();await runtime.close();throw error;}
  const finished=new Promise(resolve=>server.once('close',resolve));
  function stop(){if(stopPromise)return stopPromise;stopping=true;stopPromise=(async()=>{server.close();server.closeIdleConnections();try{await runtime.close();}finally{const current=await access(runtime.dataDir).catch(()=>null);if(current?.token===token)await unlink(file).catch(()=>{});}})();return stopPromise;}
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  stdout.write(JSON.stringify({running:true,pid:process.pid,dataDir:runtime.dataDir})+'\n');
  startPromise=runtime.start().catch(error=>stderr.write(JSON.stringify({error:{code:sdkError(error).code}})+'\n')).finally(()=>{restoring=false;});
  await finished;await stop();process.off('SIGTERM',stop);process.off('SIGINT',stop);return 0;
}
export async function daemonCommand(action,options,io){
  const sdk=await loadSdk();const dataDir=options.dataDir??sdk.defaultDataDir();
  if(action==='serve')return serve({...options,dataDir},io);
  const client=await connectDaemon(dataDir,options.timeout);
  if(action==='status')return client?client.call('daemon.status'):{running:false};
  if(action==='stop')return client?client.call('daemon.stop'):{running:false};
  if(action==='start'){
    if(client)return client.call('daemon.status');
    const child=spawn(process.execPath,[fileURLToPath(new URL('../bin/onethu.mjs',import.meta.url)),'daemon','serve','--data-dir',dataDir],{detached:true,stdio:'ignore',windowsHide:true});
    child.unref();
    for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,100));const found=await connectDaemon(dataDir,options.timeout).catch(()=>null);if(found)return found.call('daemon.status');}
    throw code('DAEMON_START_FAILED');
  }
  if(action==='install'||action==='uninstall'){
    if(!options.confirm)throw new CliError('CONFIRMATION_REQUIRED','Autostart changes require --confirm.',2);
    return configureAutostart(action,dataDir);
  }
  throw new CliError('INVALID_ARGUMENT','Use daemon start, stop, status, serve, install or uninstall.',2);
}
