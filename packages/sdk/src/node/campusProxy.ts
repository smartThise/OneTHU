/** Browser-facing adapter over the one live account transport; owns no jar. */
import { PUBLIC_DIRECT_HOSTS, webvpnWrap, webvpnDecodeUrl } from '@onethu/core';
import { GatewayError, normalizeAllowedOrigins, parseProxyTarget, sanitizeRequestHeaders, validateMethod } from '@onethu/gateway/policy';
import { DEFAULT_UPSTREAM_ORIGINS } from '@onethu/gateway/routes';
import type { NodeSession } from './session.js';
import { unwrapWebvpnScripts } from './webvpnScripts.js';
import { assertCampusBrowserTarget } from './campusProxyPolicy.js';
import { validateCampusCalendarRead } from './campusCalendar.js';
import { createCampusServiceTokenLedger } from './campusServiceTokens.js';
import { isDynamicCampusOrigin } from '@onethu/gateway/policy';
import type { CampusPortalResult } from '@onethu/core';
import { createHash } from 'node:crypto';

const VPN = 'https://webvpn.tsinghua.edu.cn';
const MAX_DOWNLOAD = 4 * 1024 ** 3;
const LEARN='https://learn.tsinghua.edu.cn';
const LEARN_DOCUMENT=/^\/f\/wlxt\/index\/course\/(?:student|teacher)(?:\/course)?\/?$/;
const CSRF_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (code:string, status=403):never => { throw new GatewayError(code,status); };
type Runtime = Pick<NodeSession,'fetch'|'epoch'|'assertCurrent'|'status'|'http'> & Partial<Pick<NodeSession,'session'|'ensureCampusService'|'resolveCampusPortal'|'fetchCampusDirect'|'loadGatewayState'|'saveGatewayState'>>;
type GatewayRequest = RequestInit & {duplex?:'half';preserveResponseBytes?:boolean};
type ServiceGrant = CampusPortalResult & { learned?:boolean };

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
  let saveCache=()=>{};
  const ledger=createCampusServiceTokenLedger(runtime.epoch,Date.now,()=>saveCache());
  let grantEpoch=runtime.epoch();
  function refreshGrants(){
    if(grantEpoch===runtime.epoch())return;
    for(const origin of grants.keys())if(!staticOrigins.has(origin))origins.delete(origin);
    grants.clear();grantEpoch=runtime.epoch();
    saveCache();
  }
  const upstreamOrigin=(origin:string)=>grants.get(origin)?.upstreamOrigin??upstreamOrigins[origin]??origin;
  const browserOrigin=(origin:string)=>[...grants].find(([,value])=>value.upstreamOrigin===origin)?.[0]??Object.entries(upstreamOrigins).find(([alias,upstream])=>upstream===origin&&origins.has(alias))?.[0]??origin;
  const replacements=new Map<string,string>();
  for(const origin of origins){
    const logical=browserOrigin(origin),wrapped=webvpnWrap(upstreamOrigin(origin)).replace(/\/$/,'');
    for(const prefix of [wrapped,wrapped.slice('https:'.length),wrapped.slice(VPN.length)]){
      replacements.set(prefix,logical);
      replacements.set(prefix.replaceAll('/','\\/'),logical.replaceAll('/','\\/'));
    }
    if(origin!==logical){replacements.set(origin,logical);replacements.set(origin.replaceAll('/','\\/'),logical.replaceAll('/','\\/'));}
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
  async function portal(selector:string,expected:number):Promise<CampusPortalResult>{
    const resolve=runtime.resolveCampusPortal;
    if(!resolve)return fail('GATEWAY_SERVICE_UNSUPPORTED',502);
    try{const result=await resolve(selector);current(expected);grant(result);return result;}
    catch(error){
      current(expected);
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
  async function recoverService(origin:string,expected:number){
    const prepare=runtime.ensureCampusService;
    if(!prepare)return fail('GATEWAY_AUTH_REQUIRED',401);
    const previous=recovering.get(origin);
    if(previous?.epoch===expected){
      if(previous.pending){await previous.pending;current(expected);return;}
      if(Date.now()-previous.at<30_000)fail('GATEWAY_AUTH_REQUIRED',401);
    }
    const state:{epoch:number;at:number;pending?:Promise<void>}={epoch:expected,at:Date.now()};
    const promise=prepare(origin).then(()=>current(expected)).catch(()=>fail('GATEWAY_AUTH_REQUIRED',401));
    state.pending=promise;recovering.set(origin,state);
    try{await promise;}finally{state.pending=undefined;}
  }
  async function bootstrap(target:URL,expected:number,signal?:AbortSignal|null){
    let merged=0;
    // Application HTML is untrusted. Its __vpn_app_hostname_data value must
    // never select a different cookie bucket (for example the identity host).
    for(const host of [target.hostname]){
      current(expected);
      const query=new URLSearchParams({method:'get',host,scheme:target.protocol.slice(0,-1),path:target.pathname+target.search,vpn_timestamp:String(Date.now())});
      const response=await runtime.fetch(VPN+'/wengine-vpn/cookie?'+query,{redirect:'manual',signal,maxResponseBytes:16384,preserveResponseBytes:true} as RequestInit);
      current(expected);
      if(!response.ok){await response.body?.cancel();continue;}
      const text=await response.text();current(expected);
      if(/[<>]/.test(text))continue;
      for(const pair of text.split(/;|\n/).map(value=>value.trim())){
        if(!/^[A-Za-z0-9_.%-]+=(?:[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*|"[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*")$/.test(pair))continue;
        const name=pair.slice(0,pair.indexOf('='));
        if(/^(?:domain|path|expires|max-age|secure|httponly|samesite|partitioned|wengine_vpn_ticket|heartbeat|refresh)$/i.test(name)||name.startsWith('show_'))continue;
        current(expected);runtime.http.jar.setRaw(new URL(target.origin),pair+'; Path=/'+(target.protocol==='https:'?'; Secure':''),{httpOnly:null});merged++;
      }
      if(merged)break;
    }
    return merged;
  }
  return {
    epoch:runtime.epoch,
    assertCurrent:current,
    status:()=>{const value=runtime.status();return {authenticated:value.authenticated,state:value.state,epoch:value.epoch,account:value.account};},
    allowedOrigins(){refreshGrants();return [...origins];},
    authorizeTarget(input:string){refreshGrants();try{return runtime.status().authenticated&&grants.has(new URL(input).origin);}catch{return false;}},
    authorizeBrowserCredential(input:string,name:string,value:string){refreshGrants();try{const origin=new URL(input).origin;return runtime.status().authenticated&&grants.has(origin)&&ledger.permits(origin,name,value);}catch{return false;}},
    browserCookies(input:string){
      const host=(()=>{try{return new URL(input).host;}catch{return fail('GATEWAY_TARGET_REJECTED');}})();
      const target=parseProxyTarget(input,host,origins) as URL;
      const expected=runtime.epoch();current(expected);
      if(!['https://learn.tsinghua.edu.cn','https://info.tsinghua.edu.cn'].includes(target.origin))return [];
      // This nonce was already public in a known Learn course document. Keep
      // it for its assets/API responses so a stale private cookie mirror cannot
      // overwrite the browser's current nonce. No cookie metadata is changed.
      if(target.origin===LEARN&&learnPublicNonce?.epoch===expected)return [{name:'XSRF-TOKEN',value:learnPublicNonce.value}];
      // Learn and Info JS read this anti-CSRF value before issuing requests. It
      // is the only browser-visible projection; authentication cookies remain
      // exclusively in the live jar. Unknown legacy HttpOnly metadata is not
      // enough to authorize disclosure, and percent encoding stays unchanged.
      const physical=new URL(webvpnWrap(target.origin+'/'));
      const physicalToken=runtime.http.jar.getCookies(physical).find(cookie=>
        cookie.name==='XSRF-TOKEN'&&cookie.domain===physical.hostname&&cookie.path===physical.pathname);
      const token=physicalToken??runtime.http.jar.getCookies(new URL(target.origin+'/')).find(cookie=>
        cookie.name==='XSRF-TOKEN'&&cookie.domain===target.hostname&&cookie.path==='/');
      // Info's own JS reads this specifically named public anti-CSRF UUID.
      // WebVPN's Cookie body omits its attributes on restoration. Project that
      // nonce without changing jar metadata; explicit HttpOnly remains private.
      const restoredInfoNonce=target.origin==='https://info.tsinghua.edu.cn'&&token!==undefined&&token.httpOnly===undefined&&CSRF_UUID.test(token.value);
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
        const result=await portal(selector,expected);check();
        return Response.json({result:'success',object:{roamingurl:result.url,isOnline:'no'}},{headers:{'cache-control':'no-store','referrer-policy':'strict-origin'}});
      }
      assertCampusBrowserTarget(target,method);
      if(target.origin==='https://info.tsinghua.edu.cn'&&target.pathname==='/f/info/portal_fg/teacher/roamingToApp'&&['GET','HEAD'].includes(method)){
        if(method!=='GET'||[...target.searchParams.keys()].some(key=>!['yyfwid','bz'].includes(key))||target.searchParams.getAll('yyfwid').length!==1||target.searchParams.getAll('bz').length>1||target.searchParams.has('bz')&&target.searchParams.get('bz')!=='app')fail('GATEWAY_SERVICE_TARGET_REJECTED');
        const selector=target.searchParams.get('yyfwid')??'';
        if(!/^[0-9a-f]{32}$/i.test(selector))fail('GATEWAY_SERVICE_TARGET_REJECTED');
        const result=await portal(selector,expected);check();
        return new Response(null,{status:302,headers:{location:result.url,'cache-control':'no-store','referrer-policy':'strict-origin'}});
      }
      if(['PROPFIND','REPORT'].includes(method)){
        init=await validateCampusCalendarRead(target,method,init,check) as GatewayRequest;
        check();
      }
      const direct=grants.get(target.origin)?.transport==='direct';
      let physical=direct||PUBLIC_DIRECT_HOSTS.has(upstream.hostname)?upstream.href:webvpnWrap(upstream.href);
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
          headers.set('referer',PUBLIC_DIRECT_HOSTS.has(ref.hostname)?real:webvpnWrap(real));
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
          'https://zhjwxk.cic.tsinghua.edu.cn':'/xklogin.do',
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
        if(grants.has(target.origin))response=ledger.observeResponse(target.origin,response,check);
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
        const textual=/^(?:text\/(?:html|css|javascript)|application\/(?:javascript|x-javascript|json|xml|xhtml\+xml))(?:;|$)/i.test(output.get('content-type')??'');
        let body:ReadableStream<Uint8Array>|null=response.body;
        if(textual&&body&&response.status!==206&&!output.has('content-range')){
          const html=/\b(?:text\/html|application\/xhtml\+xml)\b/i.test(output.get('content-type')??'');
          const script=/^(?:text|application)\/(?:x-)?(?:java|ecma)script(?:;|$)/i.test(output.get('content-type')??'');
          if(html||script)body=unwrapWebvpnScripts(body,html,check);
          body=rewriteBytes(body,replacements,check,html,html&&method==='GET'&&target.origin===LEARN&&target.pathname==='/roam.php'&&response.status===200);
          for(const header of ['content-length','etag','content-md5','digest','content-digest','repr-digest'])output.delete(header);
        }
        check();return new Response(body,{status:response.status,statusText:response.statusText,headers:output});
      } catch(error) { await response.body?.cancel().catch(()=>undefined);throw error; }
    },
  };
}
