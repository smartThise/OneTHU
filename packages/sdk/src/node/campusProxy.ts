/** Browser-facing adapter over the one live account transport; owns no jar. */
import { PUBLIC_DIRECT_HOSTS, webvpnWrap } from '@onethu/core';
import { GatewayError, normalizeAllowedOrigins, parseProxyTarget, sanitizeRequestHeaders, validateMethod } from '@onethu/gateway/policy';
import { DEFAULT_UPSTREAM_ORIGINS } from '@onethu/gateway/routes';
import type { NodeSession } from './session.js';
import { unwrapWebvpnScripts } from './webvpnScripts.js';
import { assertCampusBrowserTarget } from './campusProxyPolicy.js';

const VPN = 'https://webvpn.tsinghua.edu.cn';
const MAX_DOWNLOAD = 4 * 1024 ** 3;
const fail = (code:string, status=403):never => { throw new GatewayError(code,status); };
type Runtime = Pick<NodeSession,'fetch'|'epoch'|'assertCurrent'|'status'|'http'>;
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
  const bootstrap=text.includes('__vpn_hostname_data')&&text.includes('__vpn_app_hostname_data')&&!/电子身份服务系统|用户登陆超时|casLogin|登录成功|j_acegi/i.test(text)?text:'';
  const body=streamFrom(reader,chunks,check);
  return {response:new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers}),bootstrap};
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
      if(target.origin!=='https://learn.tsinghua.edu.cn')return [];
      // Learn's own JS reads this anti-CSRF value before issuing requests. It
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
      let response=await runtime.fetch(physical,request);check();
      try {
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
