/** Node fetch with per-hop cookie ownership, bounded reads and epoch fencing. */
import { MemoryCookieJar, DEFAULT_USER_AGENT, PUBLIC_DIRECT_HOSTS, webvpnDecodeUrl, webvpnWrap } from '@onethu/core';
import type { CookieJar, FetchLike } from '@onethu/core';
import { authError } from './storage.js';
export interface NodeTransportOptions {
  fetch?: typeof globalThis.fetch; jar?: CookieJar; userAgent?: string;
  timeoutMs?: number; maxResponseBytes?: number;
  epoch: () => number; assertCurrent: (epoch: number) => void;
}
const gatewayControl = (name: string) => name === 'wengine_vpn_ticket' || name.startsWith('show_') || name === 'heartbeat' || name === 'refresh';
const gatewayHost = 'webvpn.tsinghua.edu.cn';
function logicalUrl(url: URL): URL {
  if(url.hostname!=='webvpn.tsinghua.edu.cn'||!/^\/https?\/[a-f0-9]{32,}(?:\/|$)/i.test(url.pathname))return url;
  try { return new URL(webvpnDecodeUrl(url.href) ?? url.href); } catch { return url; }
}
export function createNodeTransport(options: NodeTransportOptions) {
  const jar = options.jar ?? new MemoryCookieJar();
  const rawFetch = options.fetch ?? globalThis.fetch;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  let controller = new AbortController();
  let closed = false;
  function assert(epoch: number) { if (closed) throw authError('AUTH_SESSION_CLOSED'); options.assertCurrent(epoch); }
  function cookieHeader(physical: URL): string {
    const logical = logicalUrl(physical);
    const cookies = [...jar.getCookies(logical), ...(logical.host === physical.host ? [] : jar.getCookies(physical))].sort((a,b)=>b.path.length-a.path.length);
    const seen = new Set<string>();
    // The authenticated gateway ticket is required by /wengine-vpn/cookie.
    // Only its physical gateway scope may supply control cookies. Ticket value
    // prefixes do not establish authentication; the read-only identity probe
    // verifies snapshots, while HTTP Set-Cookie retains server semantics.
    return cookies.filter(c=>{
      if(gatewayControl(c.name)&&(physical.hostname!==gatewayHost||c.domain!==gatewayHost))return false;
      if(seen.has(c.name))return false;seen.add(c.name);return true;
    }).map(c=>`${c.name}=${c.value}`).join('; ');
  }
  function storeCookies(physical: URL, headers: Headers) {
    const lines = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
    for (const line of lines) {
      if (/[\r\n\0]/.test(line)) continue;
      const name = /^([^=;\s]+)=/.exec(line)?.[1]; if (!name) continue;
      const logical = logicalUrl(physical);
      const control = gatewayControl(name);
      if(control&&physical.hostname!==gatewayHost)continue;
      const target = control ? physical : logical;
      const domain = /;\s*domain=([^;]+)/i.exec(line)?.[1]?.trim().replace(/^\./,'').toLowerCase();
      const physicalDomain = logical.host!==physical.host&&domain===physical.hostname;
      if (domain && (control ? domain!==gatewayHost : !physicalDomain&&(!(target.hostname === domain || target.hostname.endsWith('.'+domain)) || domain.split('.').length < (domain.endsWith('.edu.cn') ? 3 : 2)))) continue;
      let safe = line;
      if(physicalDomain&&!control)safe=safe.replace(/;\s*domain=[^;]*/ig,'');
      if (!/;\s*path=/i.test(safe)) safe += `; Path=${target.pathname.slice(0,target.pathname.lastIndexOf('/')+1)||'/'}`;
      if (logical.host !== physical.host && !control) safe=safe.replace(/(;\s*path=)\/(?:https?|https?-\d+)\/[a-f0-9]+(?=\/|;|$)/i,'$1');
      jar.setRaw(target,safe);
      if(logical.host!==physical.host&&!control){
        // Retain a native-compatible physical copy for desktop handback, scoped
        // to this application. Root JSESSIONIDs must not collide across apps.
        const prefix=/^\/(?:http|https)\/[a-f0-9]+/i.exec(physical.pathname)?.[0];
        const path=/;\s*path=([^;]*)/i.exec(safe)?.[1]?.trim()||'/';
        if(prefix&&path.startsWith('/')){
          const scoped=safe.replace(/;\s*domain=[^;]*/ig,'').replace(/(;\s*path=)[^;]*/i,`$1${prefix}${path}`);
          jar.setRaw(physical,scoped);
        }
      }
    }
  }
  const fetch: FetchLike = async (input, init = {}) => {
    const epoch = options.epoch(); assert(epoch);
    let url: URL;try{url=new URL(input);}catch{throw authError('NETWORK_URL_INVALID');}
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw authError('NETWORK_URL_REJECTED');
    const local = new AbortController();
    const activeSignal = controller.signal;
    let release = () => {};
    const stop = () => { local.abort(); release(); };
    activeSignal.addEventListener('abort',stop,{once:true});init.signal?.addEventListener('abort',stop,{once:true});
    if (activeSignal.aborted || init.signal?.aborted) stop();
    const requestOptions=init as RequestInit & {timeoutMs?:number;maxResponseBytes?:number;preserveResponseBytes?:boolean};
    const requestedTimeout=requestOptions.timeoutMs;
    const maxBytes=requestOptions.maxResponseBytes??options.maxResponseBytes??64*1024*1024;
    if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>4*1024*1024*1024){activeSignal.removeEventListener('abort',stop);init.signal?.removeEventListener('abort',stop);throw authError('NETWORK_RESPONSE_LIMIT_INVALID');}
    const timeout = setTimeout(stop, Math.min(180_000,Math.max(1,requestedTimeout??options.timeoutMs??45_000)));
    const cleanup = () => { clearTimeout(timeout);activeSignal.removeEventListener('abort',stop);init.signal?.removeEventListener('abort',stop); };
    release = cleanup;
    if(local.signal.aborted)cleanup();
    const check=()=>{assert(epoch);if(local.signal.aborted)throw authError(init.signal?.aborted?'NETWORK_ABORTED':'NETWORK_TIMEOUT');};
    let method = (init.method ?? 'GET').toUpperCase(); let body = init.body;
    let vpnChain=logicalUrl(url).origin!==url.origin;
    const headers = new Headers(init.headers);headers.delete('cookie');headers.delete('host');headers.set('user-agent',userAgent);
    try {
      for (let hop=0;hop<=25;hop++) {
        check();
        const requestHeaders=new Headers(headers);const cookie=cookieHeader(url);if(cookie)requestHeaders.set('cookie',cookie);
        let response: Response;
        try { response=await rawFetch(url.href,{...init,method,body,headers:requestHeaders,redirect:'manual',signal:local.signal}); }
        catch { assert(epoch);throw authError(local.signal.aborted?'NETWORK_TIMEOUT':'NETWORK_REQUEST_FAILED'); }
        check();storeCookies(url,response.headers);
        if ([301,302,303,307,308].includes(response.status) && response.headers.has('location') && init.redirect!=='manual') {
          // Every redirect decision releases its body, including rejected hops.
          await response.body?.cancel();
          if(init.redirect==='error'){await response.body?.cancel();throw authError('NETWORK_REDIRECT_REJECTED');}
          let next=new URL(response.headers.get('location')!,url);
          // Keep an established gateway chain on its campus route. Public SSO
          // hops remain direct; arbitrary external hosts are never VPN-wrapped.
          if(vpnChain&&next.hostname.endsWith('.tsinghua.edu.cn')&&!PUBLIC_DIRECT_HOSTS.has(next.hostname))next=new URL(webvpnWrap(next.href));
          if(!['http:','https:'].includes(next.protocol)||next.username||next.password||(url.protocol==='https:'&&next.protocol!=='https:'))throw authError('NETWORK_REDIRECT_REJECTED');
          if(hop===25)throw authError('NETWORK_REDIRECT_LIMIT');
          if(response.status===303&&method!=='HEAD'||[301,302].includes(response.status)&&method==='POST'){method='GET';body=undefined;headers.delete('content-type');headers.delete('content-length');}
          if(next.origin!==url.origin||logicalUrl(next).origin!==logicalUrl(url).origin){
            if(body!=null&&body!=='')throw authError('NETWORK_REDIRECT_BODY_REJECTED');
            for(const name of [...headers.keys()])if(!['accept','accept-language','accept-encoding','user-agent'].includes(name.toLowerCase()))headers.delete(name);
          }
          await response.body?.cancel();url=next;vpnChain||=logicalUrl(url).origin!==url.origin;continue;
        }
        const outHeaders=new Headers(response.headers);outHeaders.delete('set-cookie');outHeaders.delete('x-onethu-set-cookie');outHeaders.delete('x-onethu-set-cookie-hops');outHeaders.set('x-onethu-final-url',url.href);
        const reader=response.body?.getReader();let bytes=0;
        if(!reader){cleanup();const empty=new Response(null,{status:response.status,statusText:response.statusText,headers:outHeaders});Object.defineProperty(empty,'url',{value:url.href});return empty;}
        const stream=new ReadableStream<Uint8Array>({
          async pull(target){try{check();const part=await reader.read();check();if(part.done){cleanup();target.close();return;}bytes+=part.value.byteLength;if(bytes>maxBytes)throw authError('NETWORK_RESPONSE_TOO_LARGE');target.enqueue(part.value);}catch(error){await reader.cancel().catch(()=>undefined);cleanup();const code=(error as {code?:unknown})?.code;target.error(typeof code==='string'&&/^[A-Z][A-Z0-9_]+$/.test(code)?error:authError(local.signal.aborted?'NETWORK_TIMEOUT':'NETWORK_RESPONSE_FAILED'));}},
          async cancel(){cleanup();await reader.cancel();},
        });
        const result=new Response(stream,{status:response.status,statusText:response.statusText,headers:outHeaders});
        Object.defineProperty(result,'url',{value:url.href});
        const charset=/charset\s*=\s*["']?([^;\s"']+)/i.exec(outHeaders.get('content-type')??'')?.[1];
        if(!requestOptions.preserveResponseBytes&&charset&&!/^(?:utf-?8|us-ascii)$/i.test(charset)){
          const bytes=await result.arrayBuffer();assert(epoch);
          let decoded:string;try{decoded=new TextDecoder(charset).decode(bytes);}catch{throw authError('NETWORK_CHARSET_UNSUPPORTED');}
          outHeaders.delete('content-length');const decodedResult=new Response(decoded,{status:response.status,statusText:response.statusText,headers:outHeaders});Object.defineProperty(decodedResult,'url',{value:url.href});return decodedResult;
        }
        return result;
      }
      throw authError('NETWORK_REDIRECT_LIMIT');
    } catch(error){cleanup();throw error;}
  };
  return { jar, fetch, cookieHeader, rotate(){controller.abort();controller=new AbortController();}, close(){closed=true;controller.abort();} };
}
