import path from 'node:path';
import os from 'node:os';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { load } from 'cheerio';
import { webvpnWrap } from '@onethu/core';
import { createNodeSession, type NodeSessionOptions } from './node/session.js';
import { createStore } from './store.js';
import { createLearnService } from './learn.js';
import { createNodeDownloader } from './download.js';
import { createSchoolServices } from './services/school.js';
import { createExtendedServices } from './services/extended.js';
import { createLocalServices } from './services/local.js';
import { type ServiceOperation, type OperationContext, tuple, string, object } from './services/types.js';
import { validate } from './validation.js';
import { publicError, publicResult } from './publicResult.js';
import { confirmationMode } from './policy.js';
import { createPluginHost } from './plugins/index.mjs';
import { createNotificationService } from './notifications/index.mjs';
import { createImGateway } from './im/index.mjs';
import { createAssistant } from './assistant/index.mjs';
import { createTaskManager, type TaskGrant } from './tasks/index.js';
import { createDesktopBridge } from './desktop.js';
import { taskOperations, invokeTaskOperation } from './tasks/operations.js';

export { createNodeSession } from './node/session.js';
export { createLearnService } from './learn.js';
export { createTaskManager } from './tasks/index.js';
export { createPluginHost } from './plugins/index.mjs';
export { createNotificationService } from './notifications/index.mjs';
export { createImGateway } from './im/index.mjs';
export { createAssistant } from './assistant/index.mjs';
export type { ServiceOperation, OperationContext } from './services/types.js';
export const VERSION = '0.11.4-fix-3';
export function defaultDataDir() {
  return path.join(process.platform === 'win32' ? (process.env.LOCALAPPDATA || path.join(os.homedir(),'AppData','Local')) : process.platform === 'darwin' ? path.join(os.homedir(),'Library','Application Support') : (process.env.XDG_DATA_HOME || path.join(os.homedir(),'.local','share')), 'OneTHU CLI');
}
export type CallSource = 'local' | 'mcp' | 'plugin' | 'im' | 'agent';
export interface CallOptions { source?:CallSource; permissions?:Set<string>; signal?:AbortSignal; beforeWrite?:()=>Promise<void> }
export interface CallRequest { operation:string; args?:unknown[]; confirm?:boolean; deadlineUnixMs?:number }
type CallContext = OperationContext & { source:CallSource|'task'; approved:boolean; permissions?:Set<string> };
const digest = (s:string) => createHash('sha256').update(s).digest('hex');

/** One independently owned account runtime; the GUI, CLI, MCP and IM adapters
 * compose this service rather than maintaining separate implementations. */
export async function createOneThu(options: Partial<NodeSessionOptions> & {dataDir?:string} = {}) {
  const runtime = await createNodeSession({...options,dataDir:options.dataDir ?? defaultDataDir()});
  try {
  const store = createStore(runtime.dataDir), contexts = new AsyncLocalStorage<CallContext>();
  const savedPolicy = await store.read<{automatic:boolean;enabled?:boolean;configured?:boolean}|null>('execution-policy',null);
  const initial=savedPolicy??{automatic:false,enabled:true,configured:false};
  let appEnabled=(savedPolicy as any)?.appEnabled===true;
  let enabled=initial.enabled!==false, configured=savedPolicy!==null&&initial.configured!==false, automatic = initial.automatic === true, policyEpoch = 0, closed = false, closing = false, resident = false;
  let closePromise:Promise<void>|undefined;
  let retiring=await store.read<boolean>("desktop-retired",false);
  const writes = new Set<string>(), controllers=new Set<AbortController>();
  let stateQueue:Promise<unknown>=Promise.resolve();
  function exclusive<T>(work:()=>Promise<T>):Promise<T>{const next=stateQueue.catch(()=>undefined).then(work);stateQueue=next;return next;}
  let dataQueue:Promise<unknown>=Promise.resolve();
  function dataExclusive<T>(work:()=>Promise<T>):Promise<T>{const next=dataQueue.catch(()=>undefined).then(work);dataQueue=next;return next;}
  const requireContext = () => {const ctx=contexts.getStore();if(!ctx)throw new Error('CLI_CONTEXT_REQUIRED');return ctx;};
  const check = () => requireContext().beforeWrite();
  const resources = new Map<string,Map<string,any>>();
  const resourceVersions=new Map<string,number>();
  async function flushResources(owner:string){
    const version=resourceVersions.get(owner);if(version===undefined)return;
    await store.write(`resources-${digest(owner)}`,[...resources.get(owner)!.values()]);
    if(resourceVersions.get(owner)===version)resourceVersions.delete(owner);
  }
  async function resourceCache(owner:string) {
    if (!resources.has(owner)) resources.set(owner,new Map((await store.read<any[]>(`resources-${digest(owner)}`,[])).map(row=>[row.reference.resourceRef,row])));
    return resources.get(owner)!;
  }
  const sharedLearn = createLearnService({
    learn:runtime.learn,http:runtime.http,session:runtime.session,sessionUrl:webvpnWrap,
    authorize:()=>{if(closed||closing)throw new Error('CLI_RUNTIME_CLOSED');},
    epoch:async()=>runtime.epoch(),assertEpoch:async n=>{runtime.assertCurrent(n);await check();},
    parseElements:html=>{const $=load(html);return $('a,img,video,audio,source,iframe').toArray().map(el=>({tagName:el.tagName.toUpperCase(),getAttribute:(name:string)=>$(el).attr(name)??null}));},
    download:createNodeDownloader(runtime,check),
    loadResources:async owner=>[...await resourceCache(owner)].map(([,row])=>row),
    saveResource:async(owner,row)=>{const cache=await resourceCache(owner);if(JSON.stringify(cache.get(row.reference.resourceRef))===JSON.stringify(row))return;cache.set(row.reference.resourceRef,row);resourceVersions.set(owner,(resourceVersions.get(owner)??0)+1);},
  });
  const operations = new Map<string,ServiceOperation>();
  function register(op:ServiceOperation) {if(operations.has(op.name))throw new Error(`CLI_DUPLICATE_OPERATION:${op.name}`);operations.set(op.name,op);}
  for(const op of createSchoolServices(runtime))register(op);
  for(const op of await createExtendedServices(runtime,store))register(op);
  for(const op of createLocalServices(runtime,store))register(op);
  for(const op of sharedLearn.operations)register({...op,name:`learn.${op.name.replace(/^learn\./,'')}`,permission:'learn:read',authenticated:true,
    run:(args,ctx)=>op.name==='download'||op.name==='downloadMany'||op.name==='learn.download'||op.name==='learn.downloadMany'
      ? sharedLearn.runDownload(`learn.${op.name.replace(/^learn\./,'')}` as 'learn.download'|'learn.downloadMany',args,ctx.deadline,ctx.beforeWrite,ctx.signal):op.run(...args)});
  const controls=(name:string,description:string,parameters:any,run:ServiceOperation['run'],mutation=false,localOnly=false,authenticated=true)=>register({name,description,parameters,permission:name.split('.')[0]+':'+(mutation?'write':'read'),mutation,localOnly,authenticated,run});
  const notificationHosts = new Map<string,ReturnType<typeof createNotificationService>>();
  const pluginHosts = new Map<string,ReturnType<typeof createPluginHost>>();
  async function ownerDir() {const owner=runtime.session.username;if(!owner)throw new Error('SCHOOL_SESSION_REQUIRED');const root=path.join(runtime.dataDir,'accounts',digest(owner));await mkdir(root,{recursive:true,mode:0o700});return root;}
  async function notifications() {const root=await ownerDir();if(!notificationHosts.has(root))notificationHosts.set(root,createNotificationService({dataDir:root}));return notificationHosts.get(root)!;}
  async function plugins() {
    const root=await ownerDir();
    if(!pluginHosts.has(root))pluginHosts.set(root,createPluginHost({rootDir:path.join(root,'plugins'),
      getSession:()=>({status:runtime.session.state,username:runtime.session.username}),
      resolveOperation:(name:string)=>{const op=operations.get(name);return op?{permission:op.permission,mutation:op.mutation,supported:!op.localOnly}:undefined;},
      dispatch:(operation:string,args:unknown[],opts:any)=>call({operation,args,confirm:opts.confirm},{source:'plugin',permissions:new Set(opts.permissions),signal:opts.signal,beforeWrite:opts.beforeWrite}),
    }));
    return pluginHosts.get(root)!;
  }
  let taskManager:Awaited<ReturnType<typeof createTaskManager>>;
  const liveGrants=new WeakSet<TaskGrant>();
  async function call(input:CallRequest,opts:CallOptions = {},grant?:TaskGrant, internal=false):Promise<any> {
    validate(input,{type:'object',required:['operation'],properties:{operation:string,args:{type:'array',maxItems:16},confirm:{type:'boolean'},deadlineUnixMs:{type:'integer',minimum:1}},additionalProperties:false});
    const op=operations.get(input.operation);if(!op)throw new Error('UNKNOWN_OPERATION');
    const args=structuredClone(input.args??[]);validate(args,op.parameters);
    if(JSON.stringify(args).length>100000)throw new Error('CLI_ARGUMENTS_TOO_LARGE');
    const source=grant?'task':opts.source??'local';
    if(op.localOnly&&source!=='local')throw new Error('CLI_LOCAL_CONFIGURATION_REQUIRED');
    if(opts.permissions&&!opts.permissions.has(op.permission))throw new Error(`PERMISSION_REQUIRED:${op.permission}`);
    if(op.authenticated!==false&&runtime.session.state!=='ready')await runtime.restore();
    if(op.authenticated!==false&&runtime.session.state!=='ready')throw new Error('SCHOOL_SESSION_REQUIRED');
    const epoch=runtime.epoch(), owner=runtime.session.username, revision=policyEpoch;
    const deadline=Math.min(input.deadlineUnixMs??Date.now()+110000,Date.now()+150000);
    const controller=new AbortController();controllers.add(controller);
    const abort=()=>controller.abort();opts.signal?.addEventListener('abort',abort,{once:true});
    if(opts.signal?.aborted)controller.abort();
    const timer=setTimeout(abort,Math.max(1,deadline-Date.now()));
    const approved=!op.mutation||automatic||(source==='local'&&input.confirm===true)||!!grant&&liveGrants.has(grant);
    const stillCurrent=()=>{
      if(closed||closing)throw new Error('CLI_RUNTIME_CLOSED');
      if(retiring)throw new Error('CLI_RUNTIME_RETIRING');
      if(!(internal?appEnabled:enabled)&&op.authenticated!==false)throw new Error('CLI_DISABLED');
      if(policyEpoch!==revision||runtime.session.username!==owner)throw new Error('CLI_SESSION_CHANGED');
      if(controller.signal.aborted||Date.now()>=deadline)throw new Error('CLI_DEADLINE_OR_CANCELLED');
      runtime.assertCurrent(epoch);
    };
    const beforeWrite=async()=>{
      stillCurrent();
      if(grant){if(!liveGrants.has(grant))throw new Error('TASK_GRANT_INVALID');await grant.assertAllowed(op.name,args);}
      await opts.beforeWrite?.();
      stillCurrent();
    };
    let acquired=false;
    try {
      await beforeWrite();
      if(!approved)throw new Error(source==='local'?'CONFIRMATION_REQUIRED':'CLI_LOCAL_APPROVAL_REQUIRED');
      // Nested plugin tool calls and scheduler callbacks have their own policy.
      // The parent context never grants arbitrary model-generated writes.
      if(op.mutation&&writes.has(op.name))throw new Error('CLI_WRITE_BUSY');
      if(op.mutation){writes.add(op.name);acquired=true;}
      const result=await contexts.run({source,approved,permissions:opts.permissions,beforeWrite,signal:controller.signal,deadline},async()=>{
        if(op.name.startsWith('learn.')){await runtime.ensureLearnReady();await beforeWrite();}
        return /^(cal|caldav|cloud)\./.test(op.name) ? dataExclusive(async()=>op.run(args,{beforeWrite,signal:controller.signal,deadline})) : op.run(args,{beforeWrite,signal:controller.signal,deadline});
      });
      await beforeWrite();return publicResult(result??null);
    }catch(error){throw publicError(error);}
    finally{controllers.delete(controller);clearTimeout(timer);opts.signal?.removeEventListener('abort',abort);if(acquired)writes.delete(op.name);await flushResources(owner);}
  }
  taskManager=await createTaskManager({
    storage:{load:()=>store.read('tasks',null),save:state=>store.write('tasks',state)},
    getOwner:()=>runtime.session.state==='ready'?{id:runtime.session.username,epoch:runtime.epoch()}:null,
    authorizeGrant:async()=>{const ctx=contexts.getStore();if(!ctx?.approved||ctx.source==='task'||ctx.source==='plugin')return false;await ctx.beforeWrite();return true;},
    resolveOperation:name=>{const op=operations.get(name);return op&&!op.localOnly&&!/^(tasks|plugins|notifications|im|agent|auth|config)\./.test(name)?{mutation:!!op.mutation,validate:args=>validate(args,op.parameters)}:undefined;},
    dispatch:async(operation,args,{confirmationGrant,signal})=>{liveGrants.add(confirmationGrant);return call({operation,args},{signal},confirmationGrant,appEnabled);},
    notify:async(channel,text,idempotencyKey,{confirmationGrant,signal})=>{
      await confirmationGrant.assertActive();if(!confirmationGrant.channels.includes(channel))throw new Error('TASK_CHANNEL_OUTSIDE_GRANT');
      const result=await (await notifications()).sendTask(channel,{text,idempotencyKey},{confirm:true,signal,beforeWrite:()=>confirmationGrant.assertActive()});
      if(!['accepted','stored'].includes(result.status))throw new Error(`TASK_NOTIFICATION_${result.status.toUpperCase()}`);
    },
  });
  controls('auth.status','Local account and authentication status',tuple([]),()=>runtime.status(),false,false,false);
  controls('config.get','Device-local CLI execution policy',tuple([]),()=>({enabled,automatic,configured,confirmationMode:confirmationMode(automatic)}),false,true,false);
  // This is deliberately outside service/call: changing the policy invalidates
  // requests, including the request that requested the change.
  for(const op of taskOperations)controls(op.name,op.description,op.parameters,args=>invokeTaskOperation(taskManager,op.name,args),!!op.mutation);
  controls('tasks.channels','List stable recipient binding IDs for task notification channels; inbox is always available',tuple([]),async()=> (await notifications()).taskChannels());
  controls('notifications.list','List configured notification channels',tuple([]),async()=> (await notifications()).list());
  controls('notifications.inbox','Read the local notification inbox',tuple([object],0),async([opts])=>(await notifications()).inbox(opts));
  controls('notifications.configure','Configure a channel on this device',tuple([string,object]),async([channel,config],ctx)=>{await ctx.beforeWrite();return (await notifications()).configure(channel,config,{confirm:true,beforeWrite:ctx.beforeWrite});},true,true);
  controls('notifications.remove','Remove a notification channel',tuple([string]),async([channel],ctx)=>{await ctx.beforeWrite();return (await notifications()).remove(channel,{confirm:true,beforeWrite:ctx.beforeWrite});},true,true);
  controls('notifications.send','Send one idempotent notification to a configured channel',tuple([object]),async([message],ctx)=>(await notifications()).send(message,{confirm:true,signal:ctx.signal,beforeWrite:ctx.beforeWrite}),true);
  controls('plugins.list','List installed plugins and compatibility',tuple([]),async()=>(await plugins()).list());
  controls('plugins.inspect','Inspect a local plugin package before installation',tuple([string]),async([source])=>(await plugins()).inspect(source),false,true);
  controls('plugins.install','Install a local plugin package, initially disabled',tuple([string]),async([source],ctx)=>{await ctx.beforeWrite();return (await plugins()).install(source,{confirm:true});},true,true);
  controls('plugins.enable','Enable trusted native plugin code',tuple([string,object],1),async([id,settings],ctx)=>{await ctx.beforeWrite();return (await plugins()).enable(id,{confirm:true,settings,signal:ctx.signal,beforeWrite:ctx.beforeWrite});},true,true);
  controls('plugins.disable','Stop a plugin',tuple([string]),async([id])=>(await plugins()).disable(id),true,true);
  controls('plugins.uninstall','Remove an installed plugin',tuple([string]),async([id],ctx)=>{await ctx.beforeWrite();return (await plugins()).uninstall(id,{confirm:true});},true,true);
  controls('plugins.commands','List commands provided by an enabled plugin',tuple([string]),async([id])=>(await plugins()).commands(id));
  controls('plugins.call','Run a command from an enabled plugin',tuple([string,string,{type:'string'}],2),async([id,command,input=''],ctx)=>(await plugins()).call(id,command,input,{confirm:true,signal:ctx.signal,beforeWrite:ctx.beforeWrite}),true);
  const assistant=createAssistant({store,
    getAccount:()=>runtime.session.state==='ready'?runtime.session.username:null,
    listOperations:()=>[...operations.values()],
    dispatch:(operation:string,args:unknown[],control:any)=>call({operation,args},{source:'agent',signal:control.signal,beforeWrite:control.beforeWrite}),
  });
  controls('agent.status','Inspect the assistant model configuration',tuple([]),()=>assistant.status());
  controls('agent.configure','Configure a model and explicit tool allowlist on this device',tuple([object]),async([config],ctx)=>{await ctx.beforeWrite();return assistant.configure(config,{confirm:true});},true,true);
  controls('agent.clear','Clear this account’s short conversation history',tuple([string],0),([id])=>assistant.clear(id,{confirm:true}),true);
  controls('agent.run','Ask the personal campus assistant to use authorized campus tools',tuple([{type:'string',minLength:1,maxLength:16000},string],1),([text,sessionId],ctx)=>assistant.run(text,{signal:ctx.signal,beforeWrite:ctx.beforeWrite,sessionId}));
  const gateway=createImGateway({dataDir:runtime.dataDir,
    notifications:{configure:async(...args:any[])=>(await notifications()).configure(...args),remove:async(...args:any[])=>(await notifications()).remove(...args),send:async(...args:any[])=>(await notifications()).send(...args)},
    getAccount:()=>runtime.session.state==='ready'?runtime.session.username:null,
    dispatch:async(event:any,control:any)=>{
      await control.assertBound();
      if(event.text.trim()==='/status')return `OneTHU · ${runtime.session.state}`;
      if(event.text.trim()==='/tasks')return JSON.stringify(await call({operation:'tasks.list',args:[]},{source:'im',signal:control.signal,beforeWrite:control.assertBound}),null,2).slice(0,3000);
      const command=/^\/(pause|resume|check)\s+([a-zA-Z0-9-]+)$/.exec(event.text.trim());
      if(command){await call({operation:`tasks.${command[1]==='check'?'run':command[1]}`,args:[command[2]]},{source:'im',signal:control.signal,beforeWrite:control.assertBound});return 'OneTHU · OK';}
      const result=await assistant.run(event.text,{signal:control.signal,beforeWrite:control.assertBound,sessionId:`${event.channel}:${event.chatId??''}:${event.senderId}`});
      return String(result.text||result.errorCode||'OneTHU · No response').slice(0,3000);
    },
  });
  controls('im.status','Inspect bound IM gateways',tuple([]),()=>gateway.status());
  controls('im.configure','Bind one IM sender and chat to the signed-in university account',tuple([string,object]),async([channel,config],ctx)=>{await ctx.beforeWrite();if(config?.binding?.account!==runtime.session.username)throw new Error('IM_ACCOUNT_MISMATCH');return gateway.configure(channel,config,{confirm:true,beforeWrite:ctx.beforeWrite});},true,true);
  controls('im.start','Start configured IM reception',tuple([string],0),([channel])=>gateway.start(channel),true,true);
  controls('im.stop','Stop IM reception and cancel its active requests',tuple([string],0),([channel])=>gateway.stop(channel),true,true);
  controls('im.remove','Permanently remove an IM binding and its reception configuration',tuple([string]),([channel])=>gateway.remove(channel,{confirm:true}),true,true);
  async function resumeResident(){if(!retiring&&(enabled||appEnabled)&&resident&&runtime.session.state==='ready'){taskManager.start();if(enabled)await gateway.start();}}
  async function stopResident(){policyEpoch++;for(const controller of controllers)controller.abort();await gateway.stop();await taskManager.stop();}
  const policy=()=>({enabled,appEnabled,automatic,configured,confirmationMode:confirmationMode(automatic)});
  async function setPolicy(input:{enabled:boolean;automatic:boolean;appEnabled?:boolean}){
    if(closed||closing)throw new Error('CLI_RUNTIME_CLOSED');
    await stopResident();
    // Revocation takes effect even if persistence fails; enabling takes effect
    // only after the complete device-local policy has reached disk.
    if(!input.enabled)enabled=false;if(!input.automatic)automatic=false;if(!input.appEnabled)appEnabled=false;
    await store.write('execution-policy',{...input,configured:true});
    enabled=input.enabled;appEnabled=input.appEnabled??false;automatic=input.automatic;configured=true;
    await resumeResident();return policy();
  }
  const desktop=createDesktopBridge({runtime,tasks:taskManager,policy,setPolicy,stop:stopResident,resume:resumeResident,exclusive,dataExclusive,store,
    retire:async()=>{retiring=true;await stopResident();await store.write("desktop-retired",true);},unretire:async()=>{await store.write("desktop-retired",false);retiring=false;await resumeResident();},
    call:(input,beforeWrite,signal)=>call(input,{source:'local',beforeWrite,signal},undefined,true),notifications});
  function list(source:CallSource='local') {
    return {name:'OneTHU CLI',version:VERSION,platform:process.platform,mode:'standalone',session:runtime.status(),enabled,confirmationMode:confirmationMode(automatic),
      operations:[...operations.values()].filter(op=>source==='local'||!op.localOnly).map(({run,...op})=>({...op,mutation:!!op.mutation})),
      guiOnly:['nav.go','services.open','canvas.*'],
    };
  }
  return {
    desktop,dataDir:runtime.dataDir,auth:{status:runtime.status,restore:runtime.restore,
      async login(input:Parameters<typeof runtime.login>[0]){return exclusive(async()=>{await stopResident();const result=await runtime.login(input);if(result.state==='ready')await resumeResident();return result;});},
      twoFactor:{...runtime.twoFactor,async verify(...args:Parameters<typeof runtime.twoFactor.verify>){const result=await runtime.twoFactor.verify(...args);if(result.state==='ready')await resumeResident();return result;}},
      async logout(){return exclusive(async()=>{await stopResident();return runtime.logout();});}},
    list,call,tasks:taskManager,
    async setEnabled(value:boolean,opts:{confirm?:boolean}={}) {
      if(opts.confirm!==true||typeof value!=='boolean')throw new Error('CLI_LOCAL_APPROVAL_REQUIRED');
      if(closed||closing)throw new Error('CLI_RUNTIME_CLOSED');
      return exclusive(async()=>{if(value){await store.write("desktop-retired",false);retiring=false;}return setPolicy({enabled:value,automatic,appEnabled});});
    },
    async setAutomatic(value:boolean,opts:{confirm?:boolean}={}) {
      if(opts.confirm!==true||typeof value!=='boolean')throw new Error('CLI_LOCAL_APPROVAL_REQUIRED');
      if(closed||closing)throw new Error('CLI_RUNTIME_CLOSED');
      return exclusive(async()=>{await setPolicy({enabled,automatic:value,appEnabled});return {confirmationMode:confirmationMode(automatic)};});
    },
    async start(){resident=true;await runtime.restore();await resumeResident();},
    async close(){
      if(closePromise)return closePromise;
      closing=true;policyEpoch++;for(const controller of controllers)controller.abort();
      closePromise=(async()=>{
        let failure:unknown;
        // Storage failures must not leave child processes or the profile lock alive.
        const cleanup=[()=>gateway.close(),()=>assistant.close(),()=>taskManager.close(),
          ...[...pluginHosts.values()].map(host=>()=>host.close()),
          ...[...notificationHosts.values()].map(host=>()=>host.close()),()=>store.flush(),()=>runtime.close()];
        for(const finish of cleanup)try{await finish();}catch(error){failure??=error;}
        closed=true;if(failure)throw publicError(failure);
      })();return closePromise;
    },
  };
  } catch (error) { await runtime.close().catch(()=>undefined); throw error; }
}
export type OneThuRuntime = Awaited<ReturnType<typeof createOneThu>>;
