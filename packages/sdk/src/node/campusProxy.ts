/** Browser-facing adapter over the one live account transport; owns no jar. */
import { PUBLIC_DIRECT_HOSTS, webvpnWrap, webvpnDecodeUrl } from '@onethu/core';
import { GatewayError, normalizeAllowedOrigins, parseProxyTarget, sanitizeRequestHeaders, validateMethod, isInfoRouteLanding, isInfoNewsLanding } from '@onethu/gateway/policy';
import { DEFAULT_UPSTREAM_ORIGINS, GITLAB_ORIGIN } from '@onethu/gateway/routes';
import type { NodeSession } from './session.js';
import { unwrapWebvpnScripts } from './webvpnScripts.js';
import { assertCampusBrowserTarget } from './campusProxyPolicy.js';
import { validateCampusCalendarRead } from './campusCalendar.js';
import { createCampusServiceTokenLedger } from './campusServiceTokens.js';
import { isDynamicCampusOrigin } from '@onethu/gateway/policy';
import type { CampusPortalResult } from '@onethu/core';
import { createHash } from 'node:crypto';
import { createNodeTransport } from './transport.js';
import { campusDirectFetch } from './campusDirect.js';
import { mergeServiceCookies } from './serviceCookies.js';
import { STU_ORIGIN, parseStuAuthEntry, validStuCallback } from '@onethu/gateway/stu-auth';
import { CAB_ORIGIN, parseCabAuthEntry, parseCabIdentity, normalizeCabCallback, normalizeCabExchange } from '@onethu/gateway/cab-auth';
import { DISCOVER_ORIGIN, parseDiscoverLogin } from '@onethu/gateway/discover-auth';
import { resolveDiscoverLogin } from './discoverAuth.js';
import { MYHOME_ORIGIN } from '@onethu/gateway/myhome-auth';
import { resolveMyhomeLogin } from './myhomeAuth.js';
import { SEAT_ORIGIN } from '@onethu/gateway/seat-auth';
import { resolveSeatLogin } from './seatAuth.js';
import { XIAODA_ORIGIN, XIAODA_IDENTITY_URL, parseXiaodaLogin, xiaodaCallbackUrl, normalizeXiaodaCallback, parseXiaodaTokenExchange } from '@onethu/gateway/xiaoda-auth';
import { THESIS_ORIGIN, THESIS_IDENTITY_URL, parseThesisLogin } from '@onethu/gateway/thesis-auth';
import { resolveThesisLogin } from './thesisAuth.js';

const VPN = 'https://webvpn.tsinghua.edu.cn';
const MAX_DOWNLOAD = 4 * 1024 ** 3;
const LEARN='https://learn.tsinghua.edu.cn';
const INFO_ARCHIVE='https://info2021.tsinghua.edu.cn';
const MADMODEL='https://madmodel.cs.tsinghua.edu.cn';
const MADMODEL_PORTAL='19D04E39D96B36C494F2E48A1A4741FD';
const SELECTION_PORTAL='a7298655396722ef78ba5b5fb0b5482a';
const LEARN_DOCUMENT=/^\/f\/wlxt\/index\/course\/(?:student|teacher)(?:\/course)?\/?$/;
const CSRF_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (code:string, status=403):never => { throw new GatewayError(code,status); };
type Runtime = Pick<NodeSession,'fetch'|'epoch'|'assertCurrent'|'status'|'http'>
  & Partial<Pick<NodeSession,'session'|'persist'|'ensureCampusService'|'resolveCampusPortal'|'fetchCampusDirect'|'fetchWithoutSession'|'loadGatewayState'|'saveGatewayState'|'noteInfoSessionRequired'>>
  & {
    requestXiaodaTicket?:(signal?:AbortSignal)=>Promise<string|null>;
    requestMadmodelTicket?:()=>Promise<string|null>;
    requestStuCallback?:(entry:string,signal?:AbortSignal)=>Promise<string|null>;
    requestCabCallback?:(entry:string,identityUrl:string,signal?:AbortSignal)=>Promise<string|null>;
    requestDiscoverCallback?:(identityUrl:string,signal?:AbortSignal)=>Promise<string|null>;
    requestMyhomeCallback?:(signal?:AbortSignal)=>Promise<string|null>;
    requestSeatCallback?:(signal?:AbortSignal)=>Promise<string|null>;
    requestThesisCallback?:(signal?:AbortSignal)=>Promise<string|null>;
  };
type GatewayRequest = RequestInit & {duplex?:'half';preserveResponseBytes?:boolean};
type ServiceGrant = CampusPortalResult & { learned?:boolean };

function navigationDocument(destination:string,title:string){
  const escape=(value:string)=>value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const href=escape(destination);
  return new Response('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url='+href+'"><title>'+escape(title)+'</title><a href="'+href+'">Continue</a>',{
    headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'strict-origin',
      'content-security-policy':"default-src 'none'; base-uri 'none'; frame-ancestors 'none'"},
  });
}

function csrfCookieScopes(target:URL){
  const secure=new URL(target.href);secure.protocol='https:';
  const legacy=new URL(target.href);legacy.protocol='http:';
  return [secure,new URL(webvpnWrap(secure.href)),new URL(webvpnWrap(legacy.href))];
}

function streamFrom(reader:ReadableStreamDefaultReader<Uint8Array>, initial:Uint8Array[], check:()=>void) {
  return new ReadableStream<Uint8Array>({
    async pull(target) {
      try {
        check();
        const part=initial.length?{done:false,value:initial.shift()!}:await reader.read();
        check();if(part.done){target.close();reader.releaseLock();}else target.enqueue(part.value!);
      } catch(error) { void reader.cancel().catch(()=>undefined);target.error(error); }
    },
    async cancel(reason) { await reader.cancel(reason); },
  });
}

/** Inspect only a tiny complete bootstrap page; normal pages keep streaming. */
async function inspectPrefix(response:Response, check:()=>void) {
  if(!response.body)return {response,bootstrap:''};
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];
  let count=0,done=false;
  try {
    while(count<4096&&!done){check();const part=await reader.read();check();done=part.done;if(part.value){chunks.push(part.value);count+=part.value.length;}}
  } catch(error) { await reader.cancel().catch(()=>undefined);throw error; }
  const text=done&&count<4000?Buffer.concat(chunks).toString('utf8'):'';
  const visible=text.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,'');
  const business=/<(?:a|article|button|div|footer|form|iframe|img|input|main|nav|p|section|span|table|ul)\b/i.test(visible)||!!visible.replace(/<[^>]*>/g,'').trim();
  const bootstrap=text.includes('__vpn_hostname_data')&&text.includes('__vpn_app_hostname_data')&&!business&&!/电子身份服务系统|用户登陆超时|casLogin|登录成功|j_acegi/i.test(text)?text:'';
  const body=streamFrom(reader,chunks,check);
  return {response:new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers}),bootstrap};
}

/** The authenticated Learn document can contain a newer public CSRF nonce than
 * WebVPN's client-side cookie mirror. Read only its bounded prefix before
 * headers are sent, preserving the original bytes and the remaining stream. */
async function inspectLearnNonce(response:Response,check:()=>void){
  if(!response.body)return {response,nonce:undefined};
  const reader=response.body.getReader(),initial:Uint8Array[]=[],prefix=Buffer.allocUnsafe(64*1024);
  let size=0;
  try{
    while(size<prefix.length){
      check();const part=await reader.read();check();if(part.done)break;
      initial.push(part.value);const count=Math.min(part.value.length,prefix.length-size);
      prefix.set(part.value.subarray(0,count),size);size+=count;
    }
    const nonces=new Set<string>(),html=prefix.subarray(0,size).toString('latin1');
    for(const match of html.matchAll(/(["'])([^"'<>\s]{0,4096}(?:[?&]|&amp;)_csrf=[^"'<>\s]{1,4096})\1/g)){
      const value=match[2]!.replaceAll('&amp;','&').replaceAll('\\/','/');
      try{
        const url=new URL(value,/^\/https?\/[0-9a-f]+\//i.test(value)?VPN:LEARN);
        const logical=new URL(webvpnDecodeUrl(url.href)??url.href);
        if(logical.origin!==LEARN||logical.username||logical.password||!/^\/(?:b\/(?:wlxt|kc)\/|f\/wlxt\/index\/course\/)/.test(logical.pathname))continue;
        for(const nonce of logical.searchParams.getAll('_csrf'))if(CSRF_UUID.test(nonce))nonces.add(nonce);
      }catch{/* A quoted non-URL value cannot supply a public nonce. */}
    }
    return {response:new Response(streamFrom(reader,initial,check),{status:response.status,statusText:response.statusText,headers:response.headers}),nonce:nonces.size===1?[...nonces][0]:undefined};
  }catch(error){await reader.cancel().catch(()=>undefined);throw error;}
}

/** Latin-1 is a byte-preserving view, not a charset conversion. Keep only the
 * longest possible URL prefix between chunks. Binary/range responses bypass it. */
function rewriteBytes(body:ReadableStream<Uint8Array>, replacements:Map<string,string>, check:()=>void, html:boolean, calendarRoam=false) {
  const entries=[...replacements].sort(([a],[b])=>b.length-a.length);
  const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const urls='(?:'+entries.map(([key])=>key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')(?=[/\\\\?#\\s"\'<>);,]|$)';
  // The gateway's browser runtime would wrap already-logical URLs again. Only
  // remove its exact external script family; application scripts remain intact.
  const injection='<script\\b[^>]{0,2048}\\bsrc\\s*=\\s*["\'](?:https?:)?(?://webvpn\\.tsinghua\\.edu\\.cn)?/wengine-vpn/js/[^"\']{0,2048}["\'][^>]{0,2048}>\\s{0,256}</script\\s*>';
  // Learn's calendar client parses this success response with an exact regex.
  // WebVPN changes both the root link and its quote style. Restore only the
  // already-successful anchor on the fixed roaming endpoint, never its result.
  const calendarRoot=webvpnWrap(LEARN+'/');
  const calendarAnchor='<a\\s+href\\s*=\\s*(["\'])(?:'+[calendarRoot,calendarRoot.slice(VPN.length),calendarRoot.slice('https:'.length),LEARN+'/','/'].map(escape).join('|')+')\\1>OK ([A-Za-z0-9._@-]{1,128})</a>';
  const success=calendarRoam?new RegExp(calendarAnchor,'i'):undefined;
  const expression=new RegExp((calendarRoam?calendarAnchor+'|':'')+(html?injection+'|'+urls:urls),'gi');
  const overlap=Math.max(html?8192:0,...entries.map(([key])=>key.length))+1;
  const replace=(value:string)=>{const match=success?.exec(value);return match?"<a href='/'>OK "+match[2]+"</a>":/^<script/i.test(value)?'':replacements.get(value.toLowerCase())??value;};
  const reader=body.getReader();let pending='',finished=false;
  const iterator=(async function*(){
    try {
      while(true){
        check();const part=await reader.read();check();
        if(part.done){finished=true;if(pending)yield Buffer.from(pending.replace(expression,replace),'latin1');return;}
        // Bound the working string even if a transport supplies a huge chunk.
        for(let offset=0;offset<part.value.length;offset+=32768){
          check();pending+=Buffer.from(part.value.subarray(offset,offset+32768)).toString('latin1');
          let end=Math.max(0,pending.length-overlap);
          expression.lastIndex=0;
          for(const match of pending.matchAll(expression)){if(match.index!<end&&match.index!+match[0].length>end){end=match.index!;break;}}
          if(end){const ready=pending.slice(0,end);pending=pending.slice(end);yield Buffer.from(ready.replace(expression,replace),'latin1');}
        }
      }
    } finally { if(!finished)await reader.cancel().catch(()=>undefined);reader.releaseLock(); }
  })();
  return new ReadableStream<Uint8Array>({
    async pull(target){try{const part=await iterator.next();check();if(part.done)target.close();else target.enqueue(part.value);}catch(error){target.error(error);}},
    async cancel(){await reader.cancel().catch(()=>undefined);await iterator.return();},
  });
}

export function createCampusProxySession(runtime:Runtime, allowedOrigins:readonly string[], upstreamOrigins:Readonly<Record<string,string>>=DEFAULT_UPSTREAM_ORIGINS) {
  const origins=normalizeAllowedOrigins([...allowedOrigins]) as Set<string>;
  const staticOrigins=new Set(origins);
  const grants=new Map<string,ServiceGrant>();
  const stuGrant:ServiceGrant={url:STU_ORIGIN+'/',origin:STU_ORIGIN,upstreamOrigin:STU_ORIGIN,transport:'direct'};
  if(staticOrigins.has(STU_ORIGIN))grants.set(STU_ORIGIN,stuGrant);
  const discoverGrant:ServiceGrant={url:DISCOVER_ORIGIN+'/',origin:DISCOVER_ORIGIN,upstreamOrigin:DISCOVER_ORIGIN,transport:'direct'};
  if(staticOrigins.has(DISCOVER_ORIGIN))grants.set(DISCOVER_ORIGIN,discoverGrant);
  const thesisGrant:ServiceGrant={url:THESIS_ORIGIN+'/',origin:THESIS_ORIGIN,upstreamOrigin:THESIS_ORIGIN,transport:'direct'};
  if(staticOrigins.has(THESIS_ORIGIN))grants.set(THESIS_ORIGIN,thesisGrant);
  const discoverTickets=new Map<string,number>();
  const xiaodaGrant:ServiceGrant={url:XIAODA_ORIGIN+'/',origin:XIAODA_ORIGIN,upstreamOrigin:XIAODA_ORIGIN,transport:'direct'};
  if(staticOrigins.has(XIAODA_ORIGIN))grants.set(XIAODA_ORIGIN,xiaodaGrant);
  const xiaodaTickets=new Map<string,number>();
  const browserPreparation=new Set([MADMODEL]);
  let saveCache=()=>{};
  const ledger=createCampusServiceTokenLedger(runtime.epoch,Date.now,()=>saveCache());
  let grantEpoch=runtime.epoch();
  function refreshGrants(){
    if(grantEpoch===runtime.epoch())return;
    for(const origin of grants.keys())if(!staticOrigins.has(origin))origins.delete(origin);
    grants.clear();grantEpoch=runtime.epoch();
    if(staticOrigins.has(STU_ORIGIN))grants.set(STU_ORIGIN,stuGrant);
    if(staticOrigins.has(DISCOVER_ORIGIN))grants.set(DISCOVER_ORIGIN,discoverGrant);
    if(staticOrigins.has(THESIS_ORIGIN))grants.set(THESIS_ORIGIN,thesisGrant);
    if(staticOrigins.has(XIAODA_ORIGIN))grants.set(XIAODA_ORIGIN,xiaodaGrant);
    discoverTickets.clear();
    xiaodaTickets.clear();
    browserPreparation.clear();browserPreparation.add(MADMODEL);
    saveCache();
  }
  const upstreamOrigin=(origin:string)=>grants.get(origin)?.upstreamOrigin??upstreamOrigins[origin]??origin;
  const browserOrigin=(origin:string)=>[...grants].find(([,value])=>value.upstreamOrigin===origin)?.[0]??Object.entries(upstreamOrigins).find(([alias,upstream])=>upstream===origin&&origins.has(alias))?.[0]??origin;
  const replacements=new Map<string,string>();
  for(const origin of origins){
    const logical=browserOrigin(origin);
    const upstreams=new Set([upstreamOrigin(origin)]);
    if(isDynamicCampusOrigin(origin)){
      upstreams.add('http://'+new URL(origin).hostname);
      upstreams.add('https://'+new URL(origin).hostname);
    }
    for(const upstream of upstreams){
      const wrapped=webvpnWrap(upstream).replace(/\/$/,'');
      for(const prefix of [wrapped,wrapped.slice('https:'.length),wrapped.slice(VPN.length)]){
        replacements.set(prefix,logical);
        replacements.set(prefix.replaceAll('/','\\/'),logical.replaceAll('/','\\/'));
      }
    }
    if(origin!==logical){replacements.set(origin,logical);replacements.set(origin.replaceAll('/','\\/'),logical.replaceAll('/','\\/'));}
  }
  // Keep the official non-root login page and its BroadcastChannel return
  // handling. Its sign-in popup enters the same-origin ticket bridge.
  if(staticOrigins.has(XIAODA_ORIGIN)){
    const loginBridge=XIAODA_ORIGIN+'/login?redirect=/';
    replacements.set(XIAODA_IDENTITY_URL,loginBridge);
    replacements.set(XIAODA_IDENTITY_URL.replaceAll('/','\\/'),loginBridge.replaceAll('/','\\/'));
  }
  if(staticOrigins.has(THESIS_ORIGIN)){
    const entry=THESIS_ORIGIN+'/qh/thesis/toLogin/?loginto=tsinghua&beforepage=%2Fhome%2Fqh%2Findex';
    replacements.set(THESIS_IDENTITY_URL.toLowerCase(),entry);
    replacements.set(THESIS_IDENTITY_URL.replaceAll('/','\\/').toLowerCase(),entry.replaceAll('/','\\/'));
  }
  function grant(result:ServiceGrant,persist=true,learned=false){
    refreshGrants();
    if(!isDynamicCampusOrigin(result.origin)||!isDynamicCampusOrigin(result.upstreamOrigin)||
      new URL(result.url).origin!==result.origin||!['direct','webvpn'].includes(result.transport)||
      result.origin!==result.upstreamOrigin&&result.origin!==result.upstreamOrigin.replace(/^http:/,'https:')||
      !grants.has(result.origin)&&grants.size>=256)fail('GATEWAY_SERVICE_TARGET_REJECTED');
    const previous=grants.get(result.origin);
    const selected=!learned&&previous?.learned?{...result,upstreamOrigin:previous.upstreamOrigin,transport:previous.transport,learned:true}:{...result,learned:learned||result.learned===true};
    grants.set(result.origin,{...selected,url:result.origin+'/'});origins.add(result.origin);
    for(const scheme of ['http:','https:']){
      const alias=scheme+'//'+new URL(result.origin).hostname;
      const wrapped=webvpnWrap(alias).replace(/\/$/,'');
      for(const prefix of [wrapped,wrapped.slice('https:'.length),wrapped.slice(VPN.length)]){
        replacements.set(prefix,result.origin);replacements.set(prefix.replaceAll('/','\\/'),result.origin.replaceAll('/','\\/'));
      }
      if(alias!==result.origin){replacements.set(alias,result.origin);replacements.set(alias.replaceAll('/','\\/'),result.origin.replaceAll('/','\\/'));}
    }
    if(result.origin!==selected.upstreamOrigin)replacements.set(selected.upstreamOrigin,result.origin);
    if(persist)saveCache();
  }
  const owner=()=>runtime.session?.username?createHash('sha256').update(runtime.session.username).digest('hex'):'';
  saveCache=()=>{
    if(!owner()||!runtime.saveGatewayState)return;
    runtime.saveGatewayState({version:1,owner:owner(),epoch:runtime.epoch(),routes:[...grants.values()],tokens:ledger.snapshot()});
  };
  // Restore only same-owner/same-epoch routing and token hashes from the
  // authority's private atomic session storage. Callback URLs and raw browser
  // tokens never enter this cache. Account changes invalidate it immediately.
  try{
    const cache=runtime.loadGatewayState?.() as {version?:number;owner?:string;epoch?:number;routes?:ServiceGrant[];tokens?:unknown}|undefined;
    if(owner()&&cache?.version===1&&cache.owner===owner()&&cache.epoch===runtime.epoch()&&Array.isArray(cache.routes)&&cache.routes.length<=256){
      for(const route of cache.routes){try{grant(route,false);}catch{/* Invalid optional cache entries cannot grant access. */}}
      ledger.restore(cache.tokens,origin=>grants.has(origin));
    }
  }catch{/* A missing discovery cache never invalidates university login. */}
  async function portal(selector:string,expected:number,signal?:AbortSignal):Promise<CampusPortalResult>{
    const resolve=runtime.resolveCampusPortal;
    if(!resolve)return fail('GATEWAY_SERVICE_UNSUPPORTED',502);
    const check=()=>{
      current(expected);
      if(signal?.aborted)fail('GATEWAY_CANCELLED',499);
    };
    try{
      check();
      const result=await resolve(selector);
      check();
      grant(result);
      return result;
    }
    catch(error){
      check();
      if(selector.toLowerCase()===SELECTION_PORTAL&&(error as {code?:string}).code==='CAMPUS_SERVICE_IDENTITY_REQUIRED'
        &&runtime.ensureCampusService){
        try{
          await runtime.ensureCampusService('https://zhjwxk.cic.tsinghua.edu.cn',signal);
          check();
          const result=await resolve(selector);
          check();
          grant(result);
          return result;
        }catch(recoveryError){
          check();
          error=recoveryError;
        }
      }
      const code=(error as {code?:string}).code;
      const failure=new GatewayError(code==='CAMPUS_SERVICE_VERIFICATION_REQUIRED'?'GATEWAY_VERIFICATION_REQUIRED':code==='CAMPUS_SERVICE_IDENTITY_REQUIRED'?'GATEWAY_IDENTITY_SESSION_REQUIRED':code==='AUTH_SESSION_CHANGED'?'GATEWAY_SESSION_CHANGED':'GATEWAY_SERVICE_SSO_REQUIRED',401);
      if(typeof code==='string'&&/^(?:CAMPUS_SERVICE|NETWORK|AUTH)_[A-Z0-9_]{1,64}$/.test(code))Object.assign(failure,{serviceReason:code});
      throw failure;
    }
  }
  const mapUrl=(value:string,physical:string):string=>{
    const url=new URL(value,physical);
    if(url.origin===VPN){
      for(const origin of origins){
        const prefix=webvpnWrap(upstreamOrigin(origin)).replace(/\/$/,'');
        if(url.href===prefix||url.href.startsWith(prefix+'/')||url.href.startsWith(prefix+'?')||url.href.startsWith(prefix+'#'))return browserOrigin(origin)+url.href.slice(prefix.length);
      }
      const decoded=webvpnDecodeUrl(url.href);
      if(decoded){
        const logical=new URL(decoded),facade=browserOrigin(logical.origin);
        if(!logical.username&&!logical.password&&!logical.port&&origins.has(facade))return facade+logical.href.slice(logical.origin.length);
      }
      const destinationHost=decoded?new URL(decoded).hostname:undefined;
      if(destinationHost&&!['id.tsinghua.edu.cn','oauth.tsinghua.edu.cn'].includes(destinationHost)){
        const error=new GatewayError('GATEWAY_SERVICE_UNSUPPORTED',502);
        // Diagnostic metadata excludes the ticket, query, path and credentials.
        if(destinationHost.length<=253&&/^[a-z0-9.-]+$/i.test(destinationHost))Object.assign(error,{destinationHost});
        throw error;
      }
      fail('GATEWAY_AUTH_REQUIRED',401);
    }
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port)fail('GATEWAY_REDIRECT_REJECTED');
    return browserOrigin(url.origin)+url.href.slice(url.origin.length);
  };
  function current(expected:number){runtime.assertCurrent(expected);if(!runtime.status().authenticated)fail('GATEWAY_AUTH_REQUIRED',401);}
  let learnPublicNonce:{epoch:number;value:string}|undefined;
  const recovering=new Map<string,{epoch:number;at:number;pending?:Promise<void>}>();
  let browserAuthentication:Promise<unknown>=Promise.resolve();
  let thesisPreparedEpoch:number|undefined;
  async function authenticateThesis(entry:string,init:GatewayRequest,check:()=>void){
    const headers=new Headers(init.headers),renew=runtime.requestThesisCallback;
    if(!parseThesisLogin(entry)||init.body!=null||(init.method??'GET').toUpperCase()!=='GET'
      ||headers.get('sec-fetch-dest')!=='document'&&!/text\/html/i.test(headers.get('accept')??''))fail('GATEWAY_AUTH_REQUIRED',401);
    if(!renew)fail('GATEWAY_IDENTITY_SESSION_REQUIRED',401);
    const expected=runtime.epoch();
    const operation=browserAuthentication.catch(()=>undefined).then(async()=>{
      check();
      const destination=await resolveThesisLogin({jar:runtime.http.jar,epoch:runtime.epoch,assertCurrent:current,
        requestCallback:signal=>renew!(signal),fetch:runtime.fetchWithoutSession},entry,init.signal??undefined);
      check();await runtime.persist?.();check();
      thesisPreparedEpoch=expected;
      return destination;
    });
    browserAuthentication=operation;return operation;
  }
  async function authenticateXiaoda(target:URL,init:GatewayRequest,check:()=>void){
    const entry=parseXiaodaLogin(target.href);
    const headers=new Headers(init.headers);
    if(!entry||entry.redirectPath!=='/'||(init.method??'GET').toUpperCase()!=='GET'||init.body!=null
      ||headers.get('sec-fetch-dest')!=='document')fail('GATEWAY_AUTH_REQUIRED',401);
    const authenticate=async()=>{
      check();
      const ticket=await runtime.requestXiaodaTicket?.(init.signal??undefined);
      check();
      const callback=ticket?xiaodaCallbackUrl(ticket):null;
      if(!callback)fail('GATEWAY_IDENTITY_SESSION_REQUIRED',401);
      const now=Date.now();
      for(const [key,expires] of xiaodaTickets)if(expires<=now)xiaodaTickets.delete(key);
      if(xiaodaTickets.size>=32)fail('GATEWAY_BUSY',503);
      xiaodaTickets.set(createHash('sha256').update(ticket!).digest('hex'),now+60_000);
      return navigationDocument(callback!,'清小搭');
    };
    const result=browserAuthentication.then(authenticate,authenticate);
    browserAuthentication=result.then(()=>undefined,()=>undefined);
    return result;
  }
  async function authenticateStu(target:URL,init:GatewayRequest,check:()=>void){
    const entry=parseStuAuthEntry(target.href);
    const headers=new Headers(init.headers);
    if(!entry||init.body!=null||(init.method??'GET').toUpperCase()!=='GET'
      ||headers.get('sec-fetch-dest')!=='document'&&!/text\/html/i.test(headers.get('accept')??''))fail('GATEWAY_AUTH_REQUIRED',401);
    const fetch=runtime.fetchCampusDirect,renew=runtime.requestStuCallback;
    if(!fetch||!renew)fail('GATEWAY_IDENTITY_SESSION_REQUIRED',401);
    const operation=browserAuthentication.catch(()=>undefined).then(async()=>{
      check();
      const options={method:'GET',redirect:'manual' as const,signal:init.signal,headers:{accept:'text/html'}};
      const initial=await fetch!(entry!.entry,options);check();
      const location=initial.headers.get('location');
      await initial.body?.cancel();
      if(!location||![301,302,303].includes(initial.status)
        ||new URL(location,entry!.entry).href!==entry!.identityUrl)fail('GATEWAY_SERVICE_SSO_REQUIRED',401);
      const callback=await renew!(entry!.entry,init.signal??undefined);check();
      if(!callback||!validStuCallback(callback,entry!.entry))fail('GATEWAY_IDENTITY_SESSION_REQUIRED',401);
      // Only the current account authority redeems the school's ticket. The
      // callback cookie remains private, and OAuth resumes with the exact
      // state/nonce/PKCE context supplied by this particular browser tab.
      const response=await fetch!(callback!,options);check();
      const returned=response.headers.get('location');
      await response.body?.cancel();
      const destination=new URL(entry!.returnTo,STU_ORIGIN).href;
      if(!returned||![301,302,303].includes(response.status)
        ||new URL(returned,STU_ORIGIN).href!==destination)fail('GATEWAY_SERVICE_SSO_REQUIRED',401);
      // A redirect inherited from a cross-site entry keeps Chromium's
      // cross-site taint through the entire OAuth chain. Commit this verified
      // same-origin document first, then resume the real upstream destination.
      return navigationDocument(destination,'CSNova');
    });
    browserAuthentication=operation;
    return operation;
  }
  async function authenticateCab(target:URL,init:GatewayRequest,check:()=>void){
    const entry=parseCabAuthEntry(target.href),headers=new Headers(init.headers);
    if(!entry||init.body!=null||(init.method??'GET').toUpperCase()!=='GET'
      ||headers.get('sec-fetch-dest')!=='document'&&!/text\/html/i.test(headers.get('accept')??''))fail('GATEWAY_AUTH_REQUIRED',401);
    const renew=runtime.requestCabCallback;
    if(!renew)fail('GATEWAY_IDENTITY_SESSION_REQUIRED',401);
    const operation=browserAuthentication.catch(()=>undefined).then(async()=>{
      let stage='ENTRY';
      const before=runtime.http.jar.serialize();
      const transaction=createNodeTransport({fetch:runtime.fetchWithoutSession??campusDirectFetch,epoch:runtime.epoch,assertCurrent:current});
      transaction.jar.hydrate(before);
      try{
        check();
        const options={method:'GET',redirect:'manual' as const,signal:init.signal,headers:{accept:'text/html, application/json'},maxResponseBytes:256*1024};
        const initial=await transaction.fetch(webvpnWrap(entry!.entry),options);check();
        const location=initial.headers.get('location');await initial.body?.cancel();
        if(!location||![301,302,303].includes(initial.status))fail('GATEWAY_SERVICE_SSO_REQUIRED',401);
        const physicalIdentity=new URL(location!,webvpnWrap(entry!.entry)).href;
        const identityUrl=webvpnDecodeUrl(physicalIdentity)??physicalIdentity;
        stage='IDENTITY';
        if(!parseCabIdentity(entry!.entry,identityUrl))fail('GATEWAY_SERVICE_SSO_REQUIRED',401);
        const callback=await renew!(entry!.entry,identityUrl,init.signal??undefined);check();
        if(!callback||normalizeCabCallback(callback,entry!.entry,identityUrl)!==callback)fail('GATEWAY_IDENTITY_SESSION_REQUIRED',401);
        let next=callback!;
        let exchanged=false;
        const visited=new Set<string>();
        for(let hop=0;hop<4;hop++){
          stage=hop===0?'CALLBACK':'TOKEN';
          if(visited.has(next))fail('GATEWAY_SERVICE_SSO_REQUIRED',401);
          visited.add(next);
          exchanged ||= next===entry!.redirectUrl || normalizeCabExchange(next,entry!.entry)!==null;
          const response=await transaction.fetch(webvpnWrap(next),options);check();
          const redirect=response.headers.get('location');await response.body?.cancel();
          if(![301,302,303].includes(response.status)||!redirect){
            if(!response.ok)fail('GATEWAY_SERVICE_SSO_REQUIRED',401);
            if(!exchanged){next=entry!.redirectUrl;continue;}
            break;
          }
          const physical=new URL(redirect,webvpnWrap(next)).href;
          const destination=webvpnDecodeUrl(physical)??physical;
          stage='REDIRECT';
          const tokenTarget=webvpnDecodeUrl(webvpnWrap(entry!.redirectUrl))??entry!.redirectUrl;
          const tokenExchange=normalizeCabExchange(destination,entry!.entry);
          if(destination!==entry!.redirectUrl&&destination!==tokenTarget&&destination!==CAB_ORIGIN+'/'){
            if(!tokenExchange)fail('GATEWAY_SERVICE_SSO_REQUIRED',401);
          }
          next=tokenExchange??(destination===tokenTarget?entry!.redirectUrl:destination);
        }
        stage='PROBE';
        const probe=await transaction.fetch(webvpnWrap(CAB_ORIGIN+'/ic-web/auth/userInfo'),options);check();
        if(!probe.ok){await probe.body?.cancel();fail('GATEWAY_IDENTITY_SESSION_REQUIRED',401);}
        let account;try{account=await probe.json();}catch{fail('GATEWAY_UPSTREAM_INVALID',502);}check();
        if(account?.code!==0||!account.data)fail('GATEWAY_IDENTITY_SESSION_REQUIRED',401);
        const owner=runtime.session?.username;
        if(owner&&/^\d+$/.test(owner)&&String(account.data.pid)!==owner)fail('GATEWAY_SESSION_CHANGED',409);
        mergeServiceCookies(runtime.http.jar,transaction.jar,before,CAB_ORIGIN);
        await runtime.persist?.();check();
        return navigationDocument(CAB_ORIGIN+'/','Library rooms');
      }catch(error){
        if(error instanceof GatewayError)Object.assign(error,{serviceReason:'CAMPUS_SERVICE_CAB_'+stage});
        throw error;
      }finally{
        transaction.close();transaction.jar.clear();
      }
    });
    browserAuthentication=operation;return operation;
  }
  async function authenticateDiscover(target:URL,init:GatewayRequest,check:()=>void){
    const headers=new Headers(init.headers),renew=runtime.requestDiscoverCallback;
    if(!parseDiscoverLogin(target.href)||init.body!=null||(init.method??'GET').toUpperCase()!=='GET'
      ||headers.get('sec-fetch-dest')!=='document'&&!/text\/html/i.test(headers.get('accept')??''))fail('GATEWAY_AUTH_REQUIRED',401);
    if(!renew)fail('GATEWAY_IDENTITY_SESSION_REQUIRED',401);
    const operation=browserAuthentication.catch(()=>undefined).then(async()=>{
      check();
      const destination=await resolveDiscoverLogin({jar:runtime.http.jar,epoch:runtime.epoch,assertCurrent:current,
        requestCallback:(identityUrl,signal)=>renew!(identityUrl,signal),fetch:runtime.fetchWithoutSession},target.href,init.signal??undefined);
      check();
      for(const [ticket,expiry] of discoverTickets)if(expiry<Date.now())discoverTickets.delete(ticket);
      if(discoverTickets.size>=16)discoverTickets.delete(discoverTickets.keys().next().value!);
      discoverTickets.set(createHash('sha256').update(new URL(destination).searchParams.get('ticket')!).digest('hex'),Date.now()+60000);
      saveCache();
      await runtime.persist?.();check();
      return navigationDocument(destination,'Library');
    });
    browserAuthentication=operation;return operation;
  }
  async function authenticateMyhome(target:URL,init:GatewayRequest,check:()=>void){
    const headers=new Headers(init.headers),renew=runtime.requestMyhomeCallback;
    if(target.search||target.hash||init.body!=null||(init.method??'GET').toUpperCase()!=='GET'
      ||headers.get('sec-fetch-dest')!=='document'&&!/text\/html/i.test(headers.get('accept')??''))fail('GATEWAY_AUTH_REQUIRED',401);
    if(!renew)fail('GATEWAY_IDENTITY_SESSION_REQUIRED',401);
    const operation=browserAuthentication.catch(()=>undefined).then(async()=>{
      check();
      await resolveMyhomeLogin({jar:runtime.http.jar,epoch:runtime.epoch,assertCurrent:current,
        requestCallback:()=>renew!(init.signal??undefined),fetch:runtime.fetchWithoutSession},init.signal??undefined);
      check();await runtime.persist?.();check();
      return navigationDocument(MYHOME_ORIGIN+'/','MyHome');
    });
    browserAuthentication=operation;return operation;
  }
  async function authenticateSeat(init:GatewayRequest,check:()=>void){
    const renew=runtime.requestSeatCallback;
    if(!renew)fail('GATEWAY_IDENTITY_SESSION_REQUIRED',401);
    const operation=browserAuthentication.catch(()=>undefined).then(async()=>{
      check();
      await resolveSeatLogin({jar:runtime.http.jar,expectedAccount:runtime.session?.username,epoch:runtime.epoch,assertCurrent:current,
        requestCallback:()=>renew!(init.signal??undefined),fetch:runtime.fetchWithoutSession},init.signal??undefined);
      check();await runtime.persist?.();check();
    });
    browserAuthentication=operation;return operation;
  }
  async function recoverService(origin:string,expected:number){
    const prepare=runtime.ensureCampusService;
    const code=origin===GITLAB_ORIGIN?'GATEWAY_IDENTITY_SESSION_REQUIRED':'GATEWAY_AUTH_REQUIRED';
    if(!prepare)return fail(code,401);
    const previous=recovering.get(origin);
    if(previous?.epoch===expected){
      if(previous.pending){await previous.pending;current(expected);return;}
      if(Date.now()-previous.at<30_000)fail(code,401);
    }
    const state:{epoch:number;at:number;pending?:Promise<void>}={epoch:expected,at:Date.now()};
    const promise=prepare(origin).then(()=>current(expected)).catch(()=>fail(code,401));
    state.pending=promise;recovering.set(origin,state);
    try{await promise;}finally{state.pending=undefined;}
  }
  async function bootstrap(target:URL,expected:number,signal?:AbortSignal|null,publicCsrf=false){
    const check=()=>{current(expected);if(signal?.aborted)fail('GATEWAY_CANCELLED',499);};
    let merged=0;
    // Application HTML is untrusted. Its __vpn_app_hostname_data value must
    // never select a different cookie bucket (for example the identity host).
    for(const host of [target.hostname]){
      check();
      const query=new URLSearchParams({method:'get',host,scheme:target.protocol.slice(0,-1),path:target.pathname+target.search,vpn_timestamp:String(Date.now())});
      const response=await runtime.fetch(VPN+'/wengine-vpn/cookie?'+query,{redirect:'manual',signal,maxResponseBytes:16384,preserveResponseBytes:true} as RequestInit);
      check();
      if(!response.ok){await response.body?.cancel();continue;}
      const text=await response.text();check();
      if(/[<>]/.test(text))continue;
      for(const pair of text.split(/;|\n/).map(value=>value.trim())){
        if(!/^[A-Za-z0-9_.%-]+=(?:[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*|"[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*")$/.test(pair))continue;
        const name=pair.slice(0,pair.indexOf('='));
        if(/^(?:domain|path|expires|max-age|secure|httponly|samesite|partitioned|wengine_vpn_ticket|heartbeat|refresh)$/i.test(name)||name.startsWith('show_'))continue;
        const logicalRoot=new URL(target.origin+'/');
        const physicalRoot=new URL(webvpnWrap(target.origin+'/'));
        const privateNonce=name==='XSRF-TOKEN'&&csrfCookieScopes(target).some(scope=>
          runtime.http.jar.getCookies(scope).some(cookie=>cookie.name===name&&cookie.httpOnly===true));
        const metadata={httpOnly:privateNonce?true:null};
        check();runtime.http.jar.setRaw(logicalRoot,pair+'; Path=/'+(target.protocol==='https:'?'; Secure':''),metadata);merged++;
        // The native transport prefers the longer physical cookie path. Keep
        // this public nonce's two service scopes current before its scripts run.
        if(publicCsrf&&name==='XSRF-TOKEN'&&CSRF_UUID.test(pair.slice(pair.indexOf('=')+1))){
          check();
          runtime.http.jar.setRaw(physicalRoot,pair+'; Path='+physicalRoot.pathname+'; Secure',metadata);
        }
      }
      if(merged)break;
    }
    return merged;
  }
  function independentCredential(input:string,name:string,value:string){
    refreshGrants();
    try{
      const target=new URL(input);
      return runtime.status().authenticated&&!!runtime.fetchWithoutSession
        &&name.toLowerCase()==='authorization'&&/^(?:Bearer|Token) [A-Za-z0-9._~+/-]{16,4096}={0,2}$/.test(value)
        &&grants.get(target.origin)?.transport==='direct'&&!ledger.permits(target.origin,name,value);
    }catch{return false;}
  }
  return {
    epoch:runtime.epoch,
    assertCurrent:current,
    status:()=>{const value=runtime.status();return {authenticated:value.authenticated,state:value.state,epoch:value.epoch,account:value.account};},
    allowedOrigins(){refreshGrants();return [...origins];},
    authorizeTarget(input:string){refreshGrants();try{return runtime.status().authenticated&&grants.has(new URL(input).origin);}catch{return false;}},
    authorizeBrowserCredential(input:string,name:string,value:string){refreshGrants();try{const origin=new URL(input).origin;return runtime.status().authenticated&&grants.has(origin)&&ledger.permits(origin,name,value);}catch{return false;}},
    authorizeIndependentBrowserCredential:independentCredential,
    prepareBrowserSite(hostname:string){
      if(hostname===new URL(MADMODEL).hostname)browserPreparation.add(MADMODEL);
    },
    async requestIndependent(input:string,init:GatewayRequest={}){
      const headers=new Headers(init.headers);
      if(!independentCredential(input,'authorization',headers.get('authorization')??''))return fail('GATEWAY_SERVICE_TOKEN_REQUIRED',401);
      const target=parseProxyTarget(input,new URL(input).host,origins) as URL;
      assertCampusBrowserTarget(target,init.method??'GET');
      const expected=runtime.epoch();current(expected);
      // This token belongs to the browser. Forward it with an empty cookie
      // context and never store its response in the OneTHU account's jar.
      headers.delete('cookie');
      const response=await runtime.fetchWithoutSession!(target.href,{...init,headers,redirect:'manual'});
      try{current(expected);return response;}catch(error){await response.body?.cancel();throw error;}
    },
    browserCookies(input:string){
      const host=(()=>{try{return new URL(input).host;}catch{return fail('GATEWAY_TARGET_REJECTED');}})();
      const target=parseProxyTarget(input,host,origins) as URL;
      const expected=runtime.epoch();current(expected);
      if(!['https://learn.tsinghua.edu.cn','https://info.tsinghua.edu.cn',INFO_ARCHIVE].includes(target.origin))return [];
      // This nonce was already public in a known Learn course document. Keep
      // it for its assets/API responses so a stale private cookie mirror cannot
      // overwrite the browser's current nonce. No cookie metadata is changed.
      if(target.origin===LEARN&&learnPublicNonce?.epoch===expected)return [{name:'XSRF-TOKEN',value:learnPublicNonce.value}];
      // Learn and Info JS read this anti-CSRF value before issuing requests. It
      // is the only browser-visible projection; authentication cookies remain
      // exclusively in the live jar. Unknown legacy HttpOnly metadata is not
      // enough to authorize disclosure, and percent encoding stays unchanged.
      const physical=new URL(webvpnWrap(upstreamOrigin(target.origin)+'/'));
      const physicalToken=runtime.http.jar.getCookies(physical).find(cookie=>
        cookie.name==='XSRF-TOKEN'&&cookie.domain===physical.hostname&&cookie.path===physical.pathname);
      const logicalToken=runtime.http.jar.getCookies(new URL(target.origin+'/')).find(cookie=>
        cookie.name==='XSRF-TOKEN'&&cookie.domain===target.hostname&&cookie.path==='/');
      if(target.origin===INFO_ARCHIVE&&csrfCookieScopes(target).some(scope=>
        runtime.http.jar.getCookies(scope).some(cookie=>cookie.name==='XSRF-TOKEN'&&cookie.httpOnly===true)))return [];
      const token=physicalToken??logicalToken;
      // Info's own JS reads this specifically named public anti-CSRF UUID.
      // WebVPN's Cookie body omits its attributes on restoration. Project that
      // nonce without changing jar metadata; explicit HttpOnly remains private.
      const restoredInfoNonce=[INFO_ARCHIVE,'https://info.tsinghua.edu.cn'].includes(target.origin)&&token!==undefined&&token.httpOnly===undefined&&CSRF_UUID.test(token.value);
      if(!token||token.httpOnly!==false&&!restoredInfoNonce||!token.value||token.value.length>4096||!/^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]+$/.test(token.value))return [];
      current(expected);return [{name:'XSRF-TOKEN',value:token.value}];
    },
    async request(input:string,init:GatewayRequest={}) {
      refreshGrants();
      // Validate before wrapping: the core encoder intentionally ignores ports.
      const host=(()=>{try{return new URL(input).host;}catch{return fail('GATEWAY_TARGET_REJECTED');}})();
      const target=parseProxyTarget(input,host,origins) as URL;
      const upstream=new URL(upstreamOrigin(target.origin)+target.href.slice(target.origin.length));
      const method=(init.method??'GET').toUpperCase();validateMethod(method,target);
      const expected=runtime.epoch();current(expected);
      const check=()=>{current(expected);if(init.signal?.aborted)fail('GATEWAY_CANCELLED',499);};
      if(target.origin===THESIS_ORIGIN){
        if(/^\/qh\/thesis\/toLogin\/?$/.test(target.pathname)){
          return navigationDocument(await authenticateThesis(target.href,init,check),'学位论文');
        }
        if(method==='GET'&&init.body==null&&new Headers(init.headers).get('sec-fetch-dest')==='document'
          &&['/','/home/qh/index','/qh/index','/qh/qhSearch/QbIndex'].includes(target.pathname)&&thesisPreparedEpoch!==expected){
          const entry=THESIS_ORIGIN+'/qh/thesis/toLogin/?'+new URLSearchParams({loginto:'tsinghua',beforepage:target.pathname+target.search});
          await authenticateThesis(entry,init,check);
        }
      }
      let validatedXiaodaAuthentication=false;
      if(target.origin===XIAODA_ORIGIN){
        if(target.pathname==='/login'){
          const entry=parseXiaodaLogin(target.href);
          if(!entry||method!=='GET'||init.body!=null)return fail('GATEWAY_AUTH_REQUIRED',401);
          if(entry.redirectPath==='/')return authenticateXiaoda(target,init,check);
          validatedXiaodaAuthentication=true;
        }
        if(target.pathname==='/login.html'||target.pathname==='/api/token/login'){
          const callback=target.pathname==='/login.html';
          const exchange=callback?normalizeXiaodaCallback(target.href):parseXiaodaTokenExchange(target.href);
          const ticket=target.searchParams.get('ticket');
          const key=ticket?createHash('sha256').update(ticket).digest('hex'):'';
          if(method!=='GET'||init.body!=null||!exchange||!ticket||(xiaodaTickets.get(key)??0)<=Date.now())fail('GATEWAY_AUTH_REQUIRED',401);
          if(!callback)xiaodaTickets.delete(key);
          validatedXiaodaAuthentication=true;
        }
      }
      if(target.origin===STU_ORIGIN&&target.pathname==='/api/user/tsinghua-auth-redirect')return authenticateStu(target,init,check);
      if(target.origin===CAB_ORIGIN&&target.pathname==='/authcenter/toLoginPage')return authenticateCab(target,init,check);
      if(target.origin===DISCOVER_ORIGIN&&['/login','/samlsp/redirectLogin'].includes(target.pathname))return authenticateDiscover(target,init,check);
      if(target.origin===MYHOME_ORIGIN&&target.pathname==='/web_netweb_user/noLogin.aspx')return authenticateMyhome(target,init,check);
      if(target.origin===SEAT_ORIGIN&&target.pathname==='/home/web/f_second'&&method==='GET'&&new Headers(init.headers).get('sec-fetch-dest')==='document')await authenticateSeat(init,check);
      if(target.origin===DISCOVER_ORIGIN&&target.pathname==='/tsinghuasearch/primo/samlTicket'){
        const ticket=target.searchParams.get('ticket');
        const key=ticket?createHash('sha256').update(ticket).digest('hex'):'';
        if(method!=='GET'||init.body!=null||!ticket||[...target.searchParams.keys()].some(key=>key!=='ticket')||target.searchParams.getAll('ticket').length!==1
          ||(discoverTickets.get(key)??0)<Date.now())fail('GATEWAY_AUTH_REQUIRED',401);
        discoverTickets.delete(key);
      }
      const infoEntry=target.origin==='https://info.tsinghua.edu.cn'&&target.pathname==='/f/login';
      const learnEntry=target.origin===LEARN&&target.pathname==='/f/redirectByStuOrTeacher';
      if(infoEntry||learnEntry){
        if(!['GET','HEAD'].includes(method)||target.href!==target.origin+target.pathname||init.body!=null)fail('GATEWAY_AUTH_REQUIRED',401);
        if(infoEntry)return new Response(null,{status:302,headers:{
          location:'https://info.tsinghua.edu.cn/f/info/gxfw_fg/common/index','cache-control':'no-store',
        }});
      }
      if(target.origin===MADMODEL&&target.pathname==='/'&&!target.search&&method==='GET'
        &&new Headers(init.headers).get('sec-fetch-dest')==='document'&&browserPreparation.has(MADMODEL)){
        browserPreparation.delete(MADMODEL);
        try{
          let prepared:CampusPortalResult;
          try{prepared=await portal(MADMODEL_PORTAL,expected);}
          catch(error){
            check();
            const ticket=await runtime.requestMadmodelTicket?.();check();
            if(!ticket)throw error;
            prepared={url:MADMODEL+'/authLogin?'+new URLSearchParams({ticket}),origin:MADMODEL,upstreamOrigin:MADMODEL,transport:'direct'};
            grant(prepared);
          }
          check();
          const destination=new URL(prepared.url);
          if(destination.origin!==MADMODEL||destination.pathname!=='/authLogin'||!destination.searchParams.get('ticket')){
            return fail('GATEWAY_SERVICE_SSO_REQUIRED',401);
          }
          const href=destination.href.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
          // Commit a same-origin document before the callback so the official
          // SPA can exchange its real one-use ticket and replace its own token.
          return new Response('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url='+href+'"><title>MadModel</title><a href="'+href+'">MadModel</a>',{
            headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'same-origin',
              'content-security-policy':"default-src 'none'; base-uri 'none'; frame-ancestors 'none'"},
          });
        }catch(error){browserPreparation.add(MADMODEL);throw error;}
      }
      if(target.origin==='https://info.tsinghua.edu.cn'&&target.pathname==='/b/yyfw/vyyfwxx/info/portal_fg/common/onlineAppRedirect'&&['GET','POST'].includes(method)&&target.searchParams.has('yyfwid')){
        if([...target.searchParams.keys()].some(key=>!['yyfwid','machine','_csrf'].includes(key))||target.searchParams.getAll('yyfwid').length!==1||target.searchParams.has('machine')&&target.searchParams.get('machine')!=='p')return fail('GATEWAY_SERVICE_TARGET_REJECTED');
        if(init.body!=null){
          const reader=new Response(init.body).body!.getReader(),parts:Uint8Array[]=[];let size=0;
          try{while(true){check();const part=await reader.read();check();if(part.done)break;size+=part.value.byteLength;if(size>2048)return fail('GATEWAY_SERVICE_TARGET_REJECTED');parts.push(part.value);}}
          finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
          const body=new URLSearchParams(Buffer.concat(parts).toString('utf8'));
          if([...body.keys()].some(key=>key!=='_csrf'))return fail('GATEWAY_AUTH_REQUIRED',401);
        }
        const selector=target.searchParams.get('yyfwid')??'';
        if(!/^[0-9a-f]{32}$/i.test(selector))return fail('GATEWAY_SERVICE_TARGET_REJECTED');
        const result=await portal(selector,expected,init.signal??undefined);check();
        return Response.json({result:'success',object:{roamingurl:result.url,isOnline:'no'}},{headers:{'cache-control':'no-store','referrer-policy':'strict-origin'}});
      }
      if(!learnEntry&&!validatedXiaodaAuthentication)assertCampusBrowserTarget(target,method);
      if(target.origin==='https://info.tsinghua.edu.cn'&&target.pathname==='/f/info/portal_fg/teacher/roamingToApp'&&['GET','HEAD'].includes(method)){
        if(method!=='GET'||[...target.searchParams.keys()].some(key=>!['yyfwid','bz'].includes(key))||target.searchParams.getAll('yyfwid').length!==1||target.searchParams.getAll('bz').length>1||target.searchParams.has('bz')&&target.searchParams.get('bz')!=='app')fail('GATEWAY_SERVICE_TARGET_REJECTED');
        const selector=target.searchParams.get('yyfwid')??'';
        if(!/^[0-9a-f]{32}$/i.test(selector))fail('GATEWAY_SERVICE_TARGET_REJECTED');
        const result=await portal(selector,expected,init.signal??undefined);check();
        if(new Headers(init.headers).get('sec-fetch-dest')==='document')return navigationDocument(result.url,'OneTHU');
        return new Response(null,{status:302,headers:{location:result.url,'cache-control':'no-store','referrer-policy':'strict-origin'}});
      }
      if(['PROPFIND','REPORT'].includes(method)){
        init=await validateCampusCalendarRead(target,method,init,check) as GatewayRequest;
        check();
      }
      const gitlab=target.origin===GITLAB_ORIGIN;
      const direct=gitlab||target.origin===STU_ORIGIN||grants.get(target.origin)?.transport==='direct';
      // A portal ticket belongs to the route that issued it. In particular,
      // zhjw may issue a WebVPN ticket even though public timetable requests
      // normally use the legacy direct-host default.
      let physical=direct||!grants.has(target.origin)&&PUBLIC_DIRECT_HOSTS.has(upstream.hostname)?upstream.href:webvpnWrap(upstream.href);
      const rawHeaders:string[]=[];new Headers(init.headers).forEach((value,key)=>rawHeaders.push(key,value));
      const incoming=new Headers(init.headers);
      // Preserve application-specific headers as a transparent proxy. A field
      // called "token" can be an existing business session or a public key;
      // its semantics belong to that application. Only standard Authorization
      // enters the gateway's explicit shared-credential witness policy.
      if(grants.has(target.origin)&&incoming.has('authorization'))ledger.validateHeaders(target.origin,new Headers({authorization:incoming.get('authorization')!}));
      const headers=sanitizeRequestHeaders(rawHeaders,{allowAuthorization:grants.has(target.origin)&&ledger.permits(target.origin,'authorization',incoming.get('authorization')??'')}) as Headers;
      if(physical!==target.href){
        if(headers.has('origin'))headers.set('origin',new URL(physical).origin);
        if(headers.has('referer')){try{const ref=new URL(headers.get('referer')!);if(origins.has(ref.origin)){
          const real=upstreamOrigin(ref.origin)+ref.href.slice(ref.origin.length);
          const referrerGrant=grants.get(ref.origin);
          const directReferrer=referrerGrant?referrerGrant.transport==='direct':PUBLIC_DIRECT_HOSTS.has(ref.hostname);
          headers.set('referer',directReferrer?real:webvpnWrap(real));
        }else headers.delete('referer');}catch{headers.delete('referer');}}
      }
      const request={...init,method,headers,redirect:'manual' as const,preserveResponseBytes:true,maxResponseBytes:MAX_DOWNLOAD};
      if(['GET','HEAD'].includes(method)&&target.origin==='https://card.tsinghua.edu.cn'&&target.pathname==='/'){
        await recoverService(target.origin,expected);check();
        return new Response(null,{status:302,headers:{location:target.origin+'/userindex'}});
      }
      const fetch=direct?runtime.fetchCampusDirect:runtime.fetch;
      if(!fetch)return fail('GATEWAY_SERVICE_UNSUPPORTED',502);
      let response=await fetch(physical,request);check();
      try {
        if(learnEntry&&[301,302,303,307,308].includes(response.status)){
          const location=response.headers.get('location');
          await response.body?.cancel();
          if(!location)return fail('GATEWAY_IDENTITY_SESSION_REQUIRED',401);
          const redirected=new URL(location,physical);
          const destination=new URL(redirected.origin===VPN?(webvpnDecodeUrl(redirected.href)??redirected.href):redirected.href);
          if(destination.origin!==LEARN||!/^\/f\/wlxt\/index\/course\/(?:student|teacher)\/?$/.test(destination.pathname)){
            fail('GATEWAY_IDENTITY_SESSION_REQUIRED',401);
          }
          const home=destination.origin+destination.pathname.replace(/\/?$/,'/');
          return new Response(null,{status:302,headers:{location:home,'cache-control':'no-store'}});
        }
        const gitlabSignIn=(reply:Response)=>{
          const location=reply.headers.get('location');
          if(!location||![301,302,303,307,308].includes(reply.status))return false;
          const next=new URL(location,physical);
          return next.origin===GITLAB_ORIGIN&&next.pathname==='/users/sign_in';
        };
        if(gitlab&&gitlabSignIn(response)){
          await response.body?.cancel();
          // Renew only when opening a document. Never resubmit a mutation or
          // turn background fetches and resource loads into login attempts.
          const destination=incoming.get('sec-fetch-dest');
          if(method!=='GET'||/^\/api(?:\/|$)/.test(target.pathname)
            ||(destination?destination!=='document':!/text\/html/i.test(incoming.get('accept')??''))){
            return fail('GATEWAY_IDENTITY_SESSION_REQUIRED',401);
          }
          await recoverService(target.origin,expected);check();
          response=await fetch(physical,request);check();
          if(gitlabSignIn(response))return fail('GATEWAY_IDENTITY_SESSION_REQUIRED',401);
        }
        // Canonical HTTP/HTTPS redirects inside WebVPN can map to the same
        // browser URL. Resolve only this GET/HEAD transport change here. A
        // repeated wire route gets one pinned HTTPS attempt, with the same
        // account jar, instead of an endless browser self-redirect.
        if(grants.has(target.origin)&&['GET','HEAD'].includes(method)){
          const seen=new Set([physical]);let triedDirect=direct;
          for(let attempt=0;attempt<3&&physical.startsWith(VPN+'/')&&[301,302,303,307,308].includes(response.status)&&response.headers.has('location');attempt++){
            const destination=new URL(response.headers.get('location')!,physical);
            const decoded=destination.origin===VPN?webvpnDecodeUrl(destination.href):undefined;
            if(!decoded)break;
            const logical=new URL(decoded),facade=new URL(logical);facade.protocol='https:';
            if(logical.hostname!==target.hostname||logical.username||logical.password||logical.port||facade.href!==target.href)break;
            let next=webvpnWrap(logical.href),directAttempt=false;
            if(seen.has(next)){
              if(triedDirect||!runtime.fetchCampusDirect)break;
              directAttempt=true;triedDirect=true;next=target.href;
            }
            await response.body?.cancel();check();
            const again=directAttempt?runtime.fetchCampusDirect!:runtime.fetch;
            const nextHeaders=new Headers(request.headers);
            if(directAttempt){if(nextHeaders.has('origin'))nextHeaders.set('origin',target.origin);if(nextHeaders.has('referer'))nextHeaders.set('referer',incoming.get('referer')??target.origin+'/');}
            response=await again(next,{...request,headers:nextHeaders});check();physical=next;seen.add(next);
            grant({url:target.origin+'/',origin:target.origin,upstreamOrigin:directAttempt?target.origin:logical.origin,transport:directAttempt?'direct':'webvpn'},true,true);
          }
        }
        // Legacy applications can redirect their HTTPS SSO callback to the
        // HTTP service behind WebVPN. Learn the same-host wire scheme from
        // that authenticated response while retaining HTTPS in the browser.
        if(grants.has(target.origin)&&[301,302,303,307,308].includes(response.status)&&response.headers.has('location')){
          const redirected=new URL(response.headers.get('location')!,physical);
          const decoded=redirected.origin===VPN?webvpnDecodeUrl(redirected.href):undefined;
          if(decoded){const logical=new URL(decoded);
            if(logical.protocol==='http:'&&logical.hostname===target.hostname&&!logical.port&&!logical.username&&!logical.password){
              const facade=new URL(logical);facade.protocol='https:';
              grant({url:facade.href,origin:target.origin,upstreamOrigin:logical.origin,transport:'webvpn'},true,true);
            }
          }
        }
        // Only the account authority may redeem service SSO tickets. Browser
        // identity endpoints stay blocked; an ordinary service GET can ask the
        // current runtime for one cookie-only preparation, then return home.
        const serviceHome:Record<string,string>={
          'https://cab.lib.tsinghua.edu.cn':'/',
          'https://seat.lib.tsinghua.edu.cn':'/home/web/f_second',
          'https://zhjwxk.cic.tsinghua.edu.cn':'/xkBks.vxkBksXkbBs.do?m=main',
          'https://card.tsinghua.edu.cn':'/userindex',
        };
        if(['GET','HEAD'].includes(method)&&serviceHome[target.origin]&&[301,302,303,307,308].includes(response.status)&&response.headers.has('location')){
          const redirected=new URL(response.headers.get('location')!,physical);
          // Classification does not grant browser access to the identity host.
          // Its wrapped form must be recognized even when identity is excluded
          // from the shared proxy's allowlist and uses the ordinary browser.
          const destination=new URL(redirected.origin===VPN?(webvpnDecodeUrl(redirected.href)??redirected.href):redirected.href);
          if(['id.tsinghua.edu.cn','oauth.tsinghua.edu.cn'].includes(destination.hostname)){
            await response.body?.cancel();await recoverService(target.origin,expected);check();
            response=new Response(null,{status:302,headers:{location:target.origin+serviceHome[target.origin]}});
          }
        }
        if(physical.startsWith(VPN+'/')&&/\btext\/html\b/i.test(response.headers.get('content-type')??'')&&response.body){
          const inspected=await inspectPrefix(response,check);response=inspected.response;
          if(inspected.bootstrap){
            await response.body?.cancel();
            // Never replay a submitted form or other browser mutation.
            if(!['GET','HEAD'].includes(method)||!await bootstrap(upstream,expected,init.signal))fail('GATEWAY_AUTH_REQUIRED',401);
            check();response=await runtime.fetch(physical,request);check();
            const retried=await inspectPrefix(response,check);response=retried.response;
            if(retried.bootstrap)fail('GATEWAY_AUTH_REQUIRED',401);
          }
        }
        if(method==='GET'&&target.origin===LEARN&&LEARN_DOCUMENT.test(target.pathname)&&response.status===200&&/\btext\/html\b/i.test(response.headers.get('content-type')??'')&&!response.headers.has('content-range')){
          const inspected=await inspectLearnNonce(response,check);response=inspected.response;check();
          if(inspected.nonce)learnPublicNonce={epoch:expected,value:inspected.nonce};
        }
        const fetchDestination=incoming.get('sec-fetch-dest');
        if(method==='GET'&&init.body==null&&target.origin===INFO_ARCHIVE&&target.pathname.startsWith('/f/info/')
          &&(fetchDestination==='document'||!fetchDestination&&/\btext\/html\b/i.test(incoming.get('accept')??''))
          &&(response.status===304||response.status===200&&/\btext\/html\b/i.test(response.headers.get('content-type')??''))){
          // Info's customized jQuery captures XSRF-TOKEN during evaluation.
          // Prepare it before returning either a fresh or cached document.
          await bootstrap(upstream,expected,init.signal,true);check();
        }
        if(grants.has(target.origin))response=ledger.observeResponse(target.origin,response,check);
        if(target.origin==='https://info.tsinghua.edu.cn'&&[301,302,303,307,308].includes(response.status)&&response.headers.has('location')){
          const next=new URL(response.headers.get('location')!,physical);
          const logical=new URL(next.origin===VPN?(webvpnDecodeUrl(next.href)??next.href):next.href);
          if(['id.tsinghua.edu.cn','oauth.tsinghua.edu.cn'].includes(logical.hostname)||logical.origin===VPN&&/^\/(?:login(?:\/|$)|$)/.test(logical.pathname)){runtime.noteInfoSessionRequired?.();fail('GATEWAY_IDENTITY_SESSION_REQUIRED',401);}
          if((isInfoRouteLanding(target)||isInfoNewsLanding(target))&&['GET','HEAD'].includes(method)&&init.body==null&&isDynamicCampusOrigin(logical.origin)){
            // Learn only the destination that this account's official saved
            // Info route or news article returned. Browser input cannot grant a URL.
            if(logical.username||logical.password||logical.port||logical.hash)fail('GATEWAY_SERVICE_TARGET_REJECTED');
            if(logical.origin!==target.origin){
              const facade=new URL(logical.href);facade.protocol='https:';
              grant({url:facade.href,origin:facade.origin,upstreamOrigin:logical.origin,
                transport:next.origin===VPN||logical.protocol==='http:'?'webvpn':'direct'});
              check();
              if(method==='GET'){
                await response.body?.cancel();
                return navigationDocument(facade.href,'OneTHU');
              }
            }
          }
        }
        const output=new Headers(response.headers);
        output.delete('set-cookie');output.delete('set-cookie2');output.delete('x-onethu-final-url');
        if(output.has('location'))output.set('location',mapUrl(output.get('location')!,physical));
        if(output.has('content-location'))output.set('content-location',mapUrl(output.get('content-location')!,physical));
        if(output.has('refresh'))output.set('refresh',output.get('refresh')!.replace(/(url\s*=\s*)(["']?)([^"']+)\2/i,(_all,prefix,quote,url)=>prefix+quote+mapUrl(url.trim(),physical)+quote));
        if(output.has('link'))output.set('link',output.get('link')!.replace(/<([^>]+)>/g,(_all,url)=>'<'+mapUrl(url,physical)+'>'));
        // Retain CSP directives/nonces/hashes. Map gateway source URLs back to
        // the original origin instead of disabling the upstream policy.
        for(const name of ['content-security-policy','content-security-policy-report-only'])if(output.has(name)){
          let value=output.get(name)!;
          for(const [from,to] of [...replacements].sort(([a],[b])=>b.length-a.length))value=value.replaceAll(from,to);
          output.set(name,value.replaceAll(VPN,target.origin));
        }
        if(physical!==target.href&&output.get('access-control-allow-origin')===VPN)output.set('access-control-allow-origin',target.origin);
        const textual=/^(?:text\/(?:html|css|javascript)|application\/(?:javascript|x-javascript|json|xml|xhtml\+xml)|javascript\/x-javascript)(?:;|$)/i.test(output.get('content-type')??'');
        // Legacy JSP scripts use this nonstandard MIME. Preserve any charset
        // while exposing the restored JavaScript with a browser-supported type.
        if(/^javascript\/x-javascript(?:;|$)/i.test(output.get('content-type')??''))output.set('content-type',output.get('content-type')!.replace(/^javascript\/x-javascript/i,'application/javascript'));
        let body:ReadableStream<Uint8Array>|null=response.body;
        if(textual&&body&&response.status!==206&&!output.has('content-range')){
          const html=/\b(?:text\/html|application\/xhtml\+xml)\b/i.test(output.get('content-type')??'');
          const script=/^(?:(?:text|application)\/(?:x-)?(?:java|ecma)script|javascript\/x-javascript)(?:;|$)/i.test(output.get('content-type')??'');
          if(html||script)body=unwrapWebvpnScripts(body,html,check);
          body=rewriteBytes(body,replacements,check,html,html&&method==='GET'&&target.origin===LEARN&&target.pathname==='/roam.php'&&response.status===200);
          for(const header of ['content-length','etag','content-md5','digest','content-digest','repr-digest'])output.delete(header);
        }
        check();return new Response(body,{status:response.status,statusText:response.statusText,headers:output});
      } catch(error) { await response.body?.cancel().catch(()=>undefined);throw error; }
    },
  };
}
