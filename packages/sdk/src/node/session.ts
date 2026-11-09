/** Shared standalone runtime: Node transport + existing OneTHU authentication. */
import { CampusSession, HttpClient, LearnClient, InfoClient, makeFingerprint, webvpnWrap } from '@onethu/core';
import { InfoHelper, clearOutstandingLogin, roam } from '@onethu/info-lib';
import { setPlatformFetch, setPlatformClearCookies, uFetch } from '@onethu/info-lib/network';
import { createNodeTransport } from './transport.js';
import { authError, openSessionStorage, type DeviceIdentity } from './storage.js';
import { createAuthFlow } from '../auth/flow.js';
import { trustDeviceName } from './deviceName.js';
import type { SessionData } from '@onethu/core';
import { validateDesktopSession } from './storage.js';
import type { TwoFactorType } from '../auth/flow.js';
import { probeUniversityIdentity } from './identityProbe.js';
import { campusDirectFetch } from './campusDirect.js';
import { mergeSelectionCookies, mergeUniversityCookies } from '@onethu/core';
import { GITLAB_ORIGIN } from '@onethu/gateway/routes';
import { isXkSessionError } from '../../../core/src/zhjwxk/html-language.js';
let activeRuntime = false;
export interface NodeSessionOptions {
  dataDir: string; fetch?: typeof globalThis.fetch; userAgent?: string;
  lockTimeoutMs?: number; timeoutMs?: number; maxResponseBytes?: number;
}
function safeAuthError(error:unknown):Error {
  const e=error as {code?:unknown;reason?:unknown;stage?:unknown;status?:unknown};
  const code=typeof e?.code==='string'&&/^[A-Z][A-Z0-9_]{2,80}$/.test(e.code)?e.code:'AUTH_REQUEST_FAILED';
  const out: Error & {code:string;reason?:string;stage?:string;status?:number}=authError(code);
  if(typeof e?.reason==='string'&&/^[a-z-]{1,60}$/.test(e.reason))out.reason=e.reason;
  if(typeof e?.stage==='string'&&/^[a-z-]{1,60}$/.test(e.stage))out.stage=e.stage;
  if(typeof e?.status==='number'&&e.status>=100&&e.status<=599)out.status=e.status;
  return out;
}
export async function createNodeSession(options:NodeSessionOptions) {
  if(activeRuntime)throw authError('AUTH_RUNTIME_IN_USE');
  activeRuntime=true;
  let storage:Awaited<ReturnType<typeof openSessionStorage>>;
  try { storage=await openSessionStorage(options.dataDir,options.lockTimeoutMs); }
  catch(error){activeRuntime=false;throw error;}
  let closed=false, closing=false, generation=0, explicitLogout=false;
  const epoch=()=>generation;
  const assertCurrent=(expected:number)=>{if(closed||closing)throw authError('AUTH_SESSION_CLOSED');if(expected!==generation)throw authError('AUTH_SESSION_CHANGED');};
  const transport=createNodeTransport({...options,epoch,assertCurrent});
  const fetchWithoutSession=options.fetch??campusDirectFetch;
  const campusDirect=createNodeTransport({...options,jar:transport.jar,fetch:fetchWithoutSession,epoch,assertCurrent});
  // Third-party platform credentials must never enter the shared school jar or
  // its desktop handoff. Each read owns an isolated, equally fenced transport.
  const services=new Set<ReturnType<typeof createNodeTransport>>();
  function createServiceTransport(){
    assertCurrent(epoch());
    const isolated=createNodeTransport({...options,epoch,assertCurrent});
    services.add(isolated);
    return {...isolated,close(){isolated.close();services.delete(isolated);}};
  }
  const http=new HttpClient({fetch:transport.fetch,jar:transport.jar,userAgent:options.userAgent});http.webVPNEncoder=webvpnWrap;
  const learn=new LearnClient(http), info=new InfoClient(http), helper=new InfoHelper();
  // The production SDK has no magic account that can return fabricated data.
  helper.MOCK='__ONE_THU_SDK_NO_MOCK__';
  const session=new CampusSession({http,learn,info,fetchLike:transport.fetch});
  let device:DeviceIdentity={fingerprint:makeFingerprint()};
  let saved:Awaited<ReturnType<typeof storage.load>>=null;
  let gatewayState:unknown;
  let lastLoginAttempt=0;
  const warnings=new Set<string>();
  let cookieRevision=0;
  let learnPreparation:{revision:number;promise:Promise<void>}|null=null;
  function invalidateLearn(){cookieRevision++;learnPreparation=null;learn.applyCsrf('');}
  function rotate(){generation++;gatewayState=undefined;for(const service of services)service.close();services.clear();transport.rotate();campusDirect.rotate();invalidateLearn();info.resetStaticSessionCaches();}
  /** Authentication proves the account, while Learn needs its own page CSRF.
   * Prepare it once on demand, without a password path or replaying operations. */
  async function ensureLearnReady():Promise<void>{
    const current=epoch(),revision=cookieRevision,owner=session.username;
    const check=()=>{assertCurrent(current);if(revision!==cookieRevision||session.username!==owner||session.state!=='ready')throw authError('AUTH_SESSION_CHANGED');};
    assertCurrent(current);
    if(!owner||session.state!=='ready')throw authError('SCHOOL_SESSION_REQUIRED');
    if(learn.csrfToken)return;
    if(!learnPreparation||learnPreparation.revision!==revision){
      // A separate client prevents an obsolete, late preparation from setting
      // the live client's CSRF after same-account renewal or account switching.
      // With no credential provider or host login hook, resume only uses GET
      // and the existing cookie session, including Learn's SSO entry fallback.
      const candidate=new LearnClient(http);
      const promise=(async()=>{
        try{
          const ready=await candidate.resume();check();
          if(!ready||!candidate.csrfToken)throw authError('LEARN_SESSION_UNAVAILABLE');
          learn.applyCsrf(candidate.csrfToken);warnings.delete('LEARN_SESSION_UNAVAILABLE');
        }catch(error){
          check();warnings.add('LEARN_SESSION_UNAVAILABLE');
          const code=(error as {code?:unknown})?.code;
          throw typeof code==='string'?error:authError('LEARN_SESSION_UNAVAILABLE');
        }finally{if(learnPreparation?.revision===revision)learnPreparation=null;}
      })();
      learnPreparation={revision,promise};
    }
    await learnPreparation.promise;check();
  }
  /** Service SSO for browser navigation, using this account's cookies only.
   * The separate client never receives the in-memory password or renew hooks. */
  async function ensureCampusService(origin:string,signal?:AbortSignal):Promise<void>{
    const expected=epoch(),revision=cookieRevision,owner=session.username;
    const check=()=>{assertCurrent(expected);signal?.throwIfAborted();if(revision!==cookieRevision||session.username!==owner||session.state!=='ready')throw authError('AUTH_SESSION_CHANGED');};
    check();if(!owner)throw authError('SCHOOL_SESSION_REQUIRED');
    if(!['https://cab.lib.tsinghua.edu.cn','https://seat.lib.tsinghua.edu.cn','https://zhjwxk.cic.tsinghua.edu.cn','https://card.tsinghua.edu.cn'].includes(origin))throw authError('CAMPUS_SERVICE_UNSUPPORTED');
    const candidate=new InfoClient(http);
    candidate.setIdCredentials(()=>{check();return {username:owner,password:'',fingerprint:device.fingerprint,finger3:device.finger3};});
    if(origin==='https://cab.lib.tsinghua.edu.cn')await candidate.getLibRoomInfoList(owner,{readOnlyInitialization:true});
    else if(origin==='https://seat.lib.tsinghua.edu.cn')await candidate.getLibraryList();
    else if(origin==='https://zhjwxk.cic.tsinghua.edu.cn'){
      // The business session can outlive the ID session. Check it before SSO,
      // and use the same home after redemption instead of restarting xklogin.
      const selectionReady=async()=>{
        const page=await http.text('http://zhjwxk.cic.tsinghua.edu.cn/xkBks.vxkBksXkbBs.do?m=main',{signal});check();
        return !isXkSessionError(page)&&/(?:xk\/top\.html|xkBks\.|p_xnxq)/i.test(page);
      };
      const ready=await selectionReady().catch(()=>{check();return false;});
      if(!ready){
        if(!await candidate.resumeBrowserService('selection'))throw authError('CAMPUS_SERVICE_SSO_REQUIRED');check();
        if(!await selectionReady())throw authError('CAMPUS_SERVICE_SSO_REQUIRED');
      }
    }else{
      if(!await candidate.resumeBrowserService('card'))throw authError('CAMPUS_SERVICE_SSO_REQUIRED');check();
      await candidate.forceEnsure('card');
    }
    check();await persist();check();
  }
  async function renewGitlabSession(borrow:()=>Promise<string|null>){
    const expected=epoch(),revision=cookieRevision,owner=session.username;
    const check=()=>{
      assertCurrent(expected);
      if(revision!==cookieRevision||!owner||session.username!==owner||session.state!=='ready')throw authError('AUTH_SESSION_CHANGED');
    };
    check();
    const value=await borrow();check();
    if(!value)throw authError('CAMPUS_SERVICE_SSO_REQUIRED');
    const origin=new URL(GITLAB_ORIGIN);
    const name='_gitlab_session';
    const setCookie=(ticket:string)=>name+'='+ticket+'; Path=/; Secure; HttpOnly';
    // The desktop hands back only the GitLab cookie. Verify it in isolation
    // before it can affect the authoritative account or any other service.
    const candidate=createNodeTransport({...options,fetch:options.fetch??campusDirectFetch,epoch,assertCurrent});
    try{
      candidate.jar.setRaw(origin,setCookie(value));
      const response=await candidate.fetch(new URL('/api/v4/user',origin).href,{
        redirect:'manual',timeoutMs:6000,maxResponseBytes:65536,
      } as RequestInit);
      check();
      if(response.status!==200||!/^application\/json\b/i.test(response.headers.get('content-type')??'')){
        await response.body?.cancel();
        throw authError('CAMPUS_SERVICE_SSO_REQUIRED');
      }
      const account=await response.json();check();
      const ticket=candidate.jar.getCookies(origin).find(cookie=>cookie.name===name&&cookie.domain===origin.hostname&&cookie.path==='/');
      if(!Number.isSafeInteger(account?.id)||account.id<=0||!ticket?.value)throw authError('CAMPUS_SERVICE_SSO_REQUIRED');
      http.jar.setRaw(origin,setCookie(ticket.value));
      await persist();check();
    }finally{candidate.close();}
  }
  async function resolveCampusPortal(selector:string){
    const expected=epoch(),revision=cookieRevision,owner=session.username;
    const check=()=>{assertCurrent(expected);if(revision!==cookieRevision||session.username!==owner||session.state!=='ready')throw authError('AUTH_SESSION_CHANGED');};
    check();if(!owner)throw authError('SCHOOL_SESSION_REQUIRED');
    const candidate=new InfoClient(http);
    candidate.setIdCredentials(()=>{check();return {username:owner,password:'',fingerprint:device.fingerprint,finger3:device.finger3};});
    try{
      const result=await candidate.resumeCampusPortal(selector,check,{fetchDirect:campusDirect.fetch});check();
      await persist();check();return result;
    }catch(error){check();if((error as {code?:string}).code==='CAMPUS_SERVICE_PORTAL_HTTP_302')warnings.add('CAMPUS_INFO_SESSION_REQUIRED');throw error;}
  }
  async function persist(){
    if(closed)throw authError('AUTH_SESSION_CLOSED');
    await storage.save({version:1,epoch:generation,explicitLogout,device:{...device},gatewayState,session:session.username&&device.account===session.username?{
      username:session.username,fingerprint:device.fingerprint,finger3:device.finger3,
      cookiesJson:http.jar.serialize(),savedAt:Date.now(),
    }:null});
  }
  try {
    saved=await storage.load();
    gatewayState=saved?.gatewayState;
    if(saved){generation=saved.epoch??0;explicitLogout=saved.explicitLogout===true;device=saved.device;session.fingerprint=device.fingerprint;session.finger3=device.finger3??'';helper.fingerprint=device.fingerprint;helper.fingerGenPrint=device.finger3??'';if(saved.session){session.username=saved.session.username;helper.userId=saved.session.username;http.jar.hydrate(saved.session.cookiesJson);}}
    else {session.fingerprint=device.fingerprint;helper.fingerprint=device.fingerprint;await persist();}
  }catch(error){transport.close();campusDirect.close();await storage.close().catch(()=>undefined);activeRuntime=false;throw error;}
  setPlatformFetch(async(url,init)=>{
    const res=await transport.fetch(url,{method:init.method??'GET',body:init.body,headers:init.headers,...({timeoutMs:init.timeoutMs} as object)});
    const type=res.headers.get('content-type')??'';
    const body=/image\/|pdf|octet-stream/i.test(type)?Buffer.from(await res.arrayBuffer()).toString('base64'):await res.text();
    return{status:res.status,headers:[...res.headers],text:body,finalUrl:res.headers.get('x-onethu-final-url')??url};
  });
  // Same-account login keeps the established gateway/browser identity. Account
  // switching and explicit logout rotate the epoch and clear every service jar.
  setPlatformClearCookies(()=>undefined);
  helper.beforeLoginAttemptHook=async()=>{
    if(closed||closing)throw authError('AUTH_SESSION_CLOSED');
    if(Date.now()-lastLoginAttempt<1500)throw authError('AUTH_LOGIN_COOLDOWN');
    lastLoginAttempt=Date.now();helper.fingerprint=device.fingerprint;
  };
  async function probe():Promise<boolean>{
    const current=epoch();if(!session.username)return false;
    const identity=await probeUniversityIdentity(transport.fetch,http.jar,()=>assertCurrent(current));
    if(identity===null)return false;
    if(identity!==session.username){rotate();http.jar.clear();session.reset();session.username='';helper.userId='';helper.password='';await persist();throw authError('AUTH_SESSION_CONFLICT');}
    return true;
  }
  const flow=createAuthFlow({helper,trustDeviceName,
    async prepare(username,password){
      rotate();explicitLogout=false;
      if(device.account!==username){http.jar.clear();device={fingerprint:device.fingerprint,account:username};session.finger3='';helper.fingerGenPrint='';}
      session.username=username;session.injectCredentials(username,password);session.state='idle';helper.fingerprint=device.fingerprint;helper.fingerGenPrint=device.finger3??'';
      await persist();
    },
    async ready(){
      session.state='ready';session.finger3=helper.fingerGenPrint??'';device={fingerprint:device.fingerprint,account:session.username,finger3:session.finger3};
      // Login completion is authoritative for this account; service-specific
      // readiness stays separate. A gateway outage must not erase a good login.
      await persist();
    },
    failed(){session.state='idle';session.injectCredentials(session.username,'');helper.password='';},
    cancel(){clearOutstandingLogin();rotate();session.state='idle';session.injectCredentials(session.username,'');helper.password='';},
    async resend(type){const text=await uFetch('https://id.tsinghua.edu.cn/b/doubleAuth/login',{action:'SEND_CODE',type});let data;try{data=JSON.parse(text);}catch{throw authError('AUTH_2FA_SEND_FAILED');}if(data.result!=='success')throw authError('AUTH_2FA_SEND_FAILED');},
  });
  learn.reloginHook=async()=>{
    if(session.state!=='ready'||flow.status().pending)return false;
    try{await roam(helper,'id','bb5df85216504820be7bba2b0ae1535b/0');return true;}catch{return false;}
  };
  // Recovery does not have a second password path. The explicit login API owns
  // credentials/2FA; read-only identity verification supplies renewal evidence.
  info.setRenewers({info:probe,card:probe});
  function status(){return{state:closed?'closed':session.state,account:session.username?'***'+session.username.slice(-4):null,epoch:generation,authenticated:!closed&&session.state==='ready',twoFactor:flow.status(),warnings:[...warnings]};}
  let restoration:{epoch:number;promise:Promise<ReturnType<typeof status>>}|null=null;
  function restore():Promise<ReturnType<typeof status>> {
    const expected=epoch();assertCurrent(expected);
    if(session.state==='ready'||flow.status().pending||!saved?.session)return Promise.resolve(status());
    if(restoration?.epoch===expected)return restoration.promise;
    const promise=(async()=>{
      try {
        const ok=await probe();assertCurrent(expected);
        session.state=ok?'ready':'idle';
        // Learn is a separate service. Its CSRF is established lazily by the
        // requested Learn operation, so an outage cannot hold school sign-in.
        if(ok)await persist();
        assertCurrent(expected);return status();
      }catch(error){throw safeAuthError(error);}
    })();
    restoration={epoch:expected,promise};
    const clear=()=>{if(restoration?.promise===promise)restoration=null;};
    void promise.then(clear,clear);return promise;
  }
  async function login(input:{username:string;password:string;trustDevice?:boolean}){assertCurrent(epoch());try{const result=await flow.login(input);if(result.state==='need-2fa')session.state='need-2fa';return result;}catch(error){throw safeAuthError(error);}}
  const twoFactor={
    async chooseMethod(type:TwoFactorType){assertCurrent(epoch());try{return await flow.chooseMethod(type);}catch(error){throw safeAuthError(error);}},
    async sendCode(type:TwoFactorType){assertCurrent(epoch());try{return await flow.sendCode(type);}catch(error){throw safeAuthError(error);}},
    async verify(type:TwoFactorType,code:string,trustDevice?:boolean){assertCurrent(epoch());try{return await flow.verify(type,code,trustDevice);}catch(error){throw safeAuthError(error);}},
    async cancel(){assertCurrent(epoch());flow.cancel();http.jar.clear();await persist();return status();},
  };
  async function logout(){assertCurrent(epoch());explicitLogout=true;flow.cancel();http.jar.clear();session.reset();session.username='';helper.userId='';helper.password='';await persist();return status();}
  function desktopStatus(){return {username:session.username||null,epoch:generation,explicitLogout,tombstone:explicitLogout,bootstrapAllowed:!explicitLogout&&!session.username,session:status()};}
  function exportSession(){
    assertCurrent(epoch());
    const snapshot:SessionData|null=session.username&&device.account===session.username ? {
      username:session.username,fingerprint:device.fingerprint,finger3:device.finger3,cookiesJson:http.jar.serialize(),savedAt:Date.now(),
    }:null;
    return {...desktopStatus(),snapshot};
  }
  async function adoptSession(input:{snapshot:SessionData;expectedEpoch:number;reason:'bootstrap'|'login';service?:{name:'selection'|'university';identityRenewed:boolean}},beforeReplace?:()=>Promise<void>){
    if(!input||!Number.isSafeInteger(input.expectedEpoch)||!['bootstrap','login'].includes(input.reason))throw authError('AUTH_HANDOFF_INVALID');
    assertCurrent(input.expectedEpoch);
    if(flow.status().pending)throw authError('AUTH_LOGIN_IN_PROGRESS');
    const snapshot=validateDesktopSession(input.snapshot);
    if(input.service!==undefined&&(!input.service||input.reason!=='login'||!['selection','university'].includes(input.service.name)||typeof input.service.identityRenewed!=='boolean'||Object.keys(input.service).some(key=>!['name','identityRenewed'].includes(key))))throw authError('AUTH_HANDOFF_INVALID');
    const serviceOnly=input.service!==undefined;
    let serviceRevision=cookieRevision;
    const checkService=()=>{assertCurrent(input.expectedEpoch);if(cookieRevision!==serviceRevision)throw authError('AUTH_SESSION_CHANGED');if(explicitLogout||!(input.service?.name==='university'?['ready','idle'].includes(session.state):session.state==='ready')||session.username!==snapshot.username||device.fingerprint!==snapshot.fingerprint)throw authError('AUTH_SESSION_CONFLICT');};
    if(serviceOnly)checkService();
    if(input.reason==='bootstrap'){
      if(explicitLogout)throw authError('AUTH_HANDOFF_LOGGED_OUT');
      if(session.username&&session.username!==snapshot.username)throw authError('AUTH_SESSION_CONFLICT');
      // An existing daemon session is authoritative, including any renewed cookies.
      if(session.username){if(session.state!=='ready')await restore();return desktopStatus();}
    }
    const candidate=createNodeTransport({...options,epoch,assertCurrent});candidate.jar.hydrate(snapshot.cookiesJson);
    try{
      let identity: string | null;
      try { identity=await probeUniversityIdentity(candidate.fetch,candidate.jar,()=>assertCurrent(input.expectedEpoch)); }
      catch(error) {
        if((error as {code?:string}).code==='AUTH_PROBE_UNAVAILABLE')throw authError('AUTH_HANDOFF_UNVERIFIED');
        throw error;
      }
      if(identity!==snapshot.username)throw authError('AUTH_HANDOFF_UNVERIFIED');
      if(serviceOnly){
        checkService();
        const university=input.service!.name==='university';
        const merged=university?mergeUniversityCookies(JSON.parse(http.jar.serialize()),JSON.parse(candidate.jar.serialize())):mergeSelectionCookies(JSON.parse(http.jar.serialize()),JSON.parse(candidate.jar.serialize()),input.service!.identityRenewed);
        if(merged.changed||university){
          transport.rotate();campusDirect.rotate();cookieRevision++;learnPreparation=null;
          serviceRevision=cookieRevision;
          http.jar.hydrate(JSON.stringify(merged.cookies));await persist();checkService();
        }
        if(university){session.state='ready';warnings.delete('CAMPUS_INFO_SESSION_REQUIRED');}
        return desktopStatus();
      }
      const changed=session.username!==snapshot.username||session.state!=='ready';
      if(changed){await beforeReplace?.();assertCurrent(input.expectedEpoch);rotate();}
      else {transport.rotate();invalidateLearn();}
      // Retire requests from the old cookie session before they can publish a
      // late Set-Cookie or cached service token. The account/grant epoch stays
      // stable; read recovery remains bounded and dispatched writes stay final.
      // Same-account renewal keeps the grant epoch and device identity. The
      // new verified cookie jar refreshes services without cancelling tasks.
      device={account:snapshot.username,fingerprint:snapshot.fingerprint,finger3:snapshot.finger3||(snapshot.fingerprint===device.fingerprint&&device.account===snapshot.username?device.finger3:undefined)};
      session.username=snapshot.username;session.fingerprint=device.fingerprint;session.finger3=device.finger3??'';
      session.injectCredentials(snapshot.username,'');session.state='ready';
      helper.userId=snapshot.username;helper.password='';helper.fingerprint=device.fingerprint;helper.fingerGenPrint=device.finger3??'';
      http.jar.hydrate(candidate.jar.serialize());explicitLogout=false;
      // Service tokens belong to the replaced cookie session even when the
      // account/grant epoch stays stable. Let each service's bounded lazy
      // establishment obtain fresh tokens on its next request.
      info.resetStaticSessionCaches();
      saved={version:1,epoch:generation,explicitLogout,device:{...device},session:{...snapshot,cookiesJson:http.jar.serialize()}};
      await persist();return desktopStatus();
    }finally{candidate.close();}
  }
  async function close(){
    if(closed||closing)return;
    // Capture a good ready snapshot before cancellation clears its state; a
    // pending login cannot escape the lifetime of this process via a password.
    if(flow.status().pending){flow.cancel();http.jar.clear();}
    // Closing the process cancels requests through the closed/closing guard and
    // transport abort. Persist the account epoch unchanged so an upgrade does
    // not invalidate pending desktop handoff or authorized resident tasks.
    closing=true;for(const service of services)service.close();services.clear();transport.close();campusDirect.close();clearOutstandingLogin();
    try{await persist();}finally{closed=true;session.reset();helper.password='';try{await storage.close();}finally{activeRuntime=false;}}
  }
  return{session,http,learn,info,helper,fetch:transport.fetch,fetchCampusDirect:campusDirect.fetch,fetchWithoutSession,createServiceTransport,restore,login,twoFactor,logout,status,persist,close,epoch,assertCurrent,desktopStatus,exportSession,adoptSession,ensureLearnReady,ensureCampusService,renewGitlabSession,resolveCampusPortal,noteInfoSessionRequired(){if(session.username&&!explicitLogout)warnings.add('CAMPUS_INFO_SESSION_REQUIRED');},loadGatewayState:()=>gatewayState,saveGatewayState(value:unknown){gatewayState=value;void persist().catch(()=>warnings.add('GATEWAY_CACHE_UNAVAILABLE'));},guardGeneration:epoch,dataDir:storage.directory};
}
export type NodeSession = Awaited<ReturnType<typeof createNodeSession>>;
