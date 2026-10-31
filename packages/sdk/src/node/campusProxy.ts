/** Browser-facing adapter over the one live account transport; owns no jar. */
import { PUBLIC_DIRECT_HOSTS, webvpnWrap, webvpnDecodeUrl } from '@onethu/core';
import { GatewayError, normalizeAllowedOrigins, parseProxyTarget, sanitizeRequestHeaders, validateMethod } from '@onethu/gateway/policy';
import { DEFAULT_UPSTREAM_ORIGINS } from '@onethu/gateway/routes';
import type { NodeSession } from './session.js';
import { unwrapWebvpnScripts } from './webvpnScripts.js';
import { assertCampusBrowserTarget } from './campusProxyPolicy.js';

const VPN = 'https://webvpn.tsinghua.edu.cn';
const MAX_DOWNLOAD = 4 * 1024 ** 3;
const LEARN='https://learn.tsinghua.edu.cn';
const LEARN_DOCUMENT=/^\/f\/wlxt\/index\/course\/(?:student|teacher)(?:\/course)?\/?$/;
const CSRF_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (code:string, status=403):never => { throw new GatewayError(code,status); };
type Runtime = Pick<NodeSession,'fetch'|'epoch'|'assertCurrent'|'status'|'http'> & Partial<Pick<NodeSession,'ensureCampusService'>>;
type GatewayRequest = RequestInit & {duplex?:'half';preserveResponseBytes?:boolean};

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
function rewriteBytes(body:ReadableStream<Uint8Array>, replacements:Map<string,string>, check:()=>void, html:boolean) {
  const entries=[...replacements].sort(([a],[b])=>b.length-a.length);
  const urls='(?:'+entries.map(([key])=>key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')(?=[/\\\\?#\\s"\'<>);,]|$)';
  // The gateway's browser runtime would wrap already-logical URLs again. Only
  // remove its exact external script family; application scripts remain intact.
  const injection='<script\\b[^>]{0,2048}\\bsrc\\s*=\\s*["\'](?:https?:)?(?://webvpn\\.tsinghua\\.edu\\.cn)?/wengine-vpn/js/[^"\']{0,2048}["\'][^>]{0,2048}>\\s{0,256}</script\\s*>';
  const expression=new RegExp(html?injection+'|'+urls:urls,'gi');
  const overlap=Math.max(html?8192:0,...entries.map(([key])=>key.length))+1;
  const replace=(value:string)=>/^<script/i.test(value)?'':replacements.get(value.toLowerCase())??value;
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
  const upstreamOrigin=(origin:string)=>upstreamOrigins[origin]??origin;
  const browserOrigin=(origin:string)=>Object.entries(upstreamOrigins).find(([alias,upstream])=>upstream===origin&&origins.has(alias))?.[0]??origin;
  const replacements=new Map<string,string>();
  for(const origin of origins){
    const logical=browserOrigin(origin),wrapped=webvpnWrap(upstreamOrigin(origin)).replace(/\/$/,'');
    for(const prefix of [wrapped,wrapped.slice('https:'.length),wrapped.slice(VPN.length)]){
      replacements.set(prefix,logical);
      replacements.set(prefix.replaceAll('/','\\/'),logical.replaceAll('/','\\/'));
    }
    if(origin!==logical){replacements.set(origin,logical);replacements.set(origin.replaceAll('/','\\/'),logical.replaceAll('/','\\/'));}
  }
  const mapUrl=(value:string,physical:string):string=>{
    const url=new URL(value,physical);
    if(url.origin===VPN){
      for(const origin of origins){
        const prefix=webvpnWrap(upstreamOrigin(origin)).replace(/\/$/,'');
        if(url.href===prefix||url.href.startsWith(prefix+'/')||url.href.startsWith(prefix+'?')||url.href.startsWith(prefix+'#'))return browserOrigin(origin)+url.href.slice(prefix.length);
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
      if(!token||token.httpOnly!==false||!token.value||token.value.length>4096||!/^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]+$/.test(token.value))return [];
      current(expected);return [{name:'XSRF-TOKEN',value:token.value}];
    },
    async request(input:string,init:GatewayRequest={}) {
      // Validate before wrapping: the core encoder intentionally ignores ports.
      const host=(()=>{try{return new URL(input).host;}catch{return fail('GATEWAY_TARGET_REJECTED');}})();
      const target=parseProxyTarget(input,host,origins) as URL;
      const upstream=new URL(upstreamOrigin(target.origin)+target.href.slice(target.origin.length));
      const method=(init.method??'GET').toUpperCase();validateMethod(method);
      assertCampusBrowserTarget(target,method);
      const expected=runtime.epoch();current(expected);
      const check=()=>{current(expected);if(init.signal?.aborted)fail('GATEWAY_CANCELLED',499);};
      const physical=PUBLIC_DIRECT_HOSTS.has(upstream.hostname)?upstream.href:webvpnWrap(upstream.href);
      const rawHeaders:string[]=[];new Headers(init.headers).forEach((value,key)=>rawHeaders.push(key,value));
      const headers=sanitizeRequestHeaders(rawHeaders) as Headers;
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
      let response=await runtime.fetch(physical,request);check();
      try {
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
          const destination=new URL(mapUrl(response.headers.get('location')!,physical));
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
          body=rewriteBytes(body,replacements,check,html);
          for(const header of ['content-length','etag','content-md5','digest','content-digest','repr-digest'])output.delete(header);
        }
        check();return new Response(body,{status:response.status,statusText:response.statusText,headers:output});
      } catch(error) { await response.body?.cancel().catch(()=>undefined);throw error; }
    },
  };
}
