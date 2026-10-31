import { HttpClient, type FetchLike } from '../http.js';
import { decodeUrl, webvpnWrap } from '../crypto/webvpn.js';
import { ROAMING_URL } from './urls.js';

const INFO='https://info.tsinghua.edu.cn',ID='https://id.tsinghua.edu.cn',VPN='https://webvpn.tsinghua.edu.cn';
const IDENTITY=new Set(['id.tsinghua.edu.cn','oauth.tsinghua.edu.cn']);
const LIMIT=128*1024;
export interface CampusPortalResult { url:string;origin:string;upstreamOrigin:string;transport:'direct'|'webvpn' }
export interface CampusPortalContext { csrf:string;fingerprint:string;finger3?:string;assertCurrent:()=>void;fetchDirect?:FetchLike }
function reject(code='CAMPUS_SERVICE_SSO_REQUIRED'):never{throw Object.assign(new Error(code),{code});}

/** Only a URL supplied by the authenticated Info response may enter this flow.
 * The selector is a portal application ID, never a caller-provided URL. */
export function isCampusServiceOrigin(value:string):boolean{
  try{const url=new URL(value);return url.origin===value&&['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.port&&
    /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*tsinghua\.edu\.cn$/.test(url.hostname)&&
    !IDENTITY.has(url.hostname)&&url.hostname!=='webvpn.tsinghua.edu.cn';}catch{return false;}
}
type Route={logical:URL;physical:URL;transport:'direct'|'webvpn'};
function route(value:string,base?:URL):Route{
  if(value.length>8192||/[\x00-\x20\x7f\\]/.test(value))reject('CAMPUS_SERVICE_TARGET_REJECTED');
  let physical:URL;try{physical=new URL(value.replaceAll('&amp;','&'),base);}catch{return reject('CAMPUS_SERVICE_TARGET_REJECTED');}
  if(physical.username||physical.password||physical.port||physical.hash||!['http:','https:'].includes(physical.protocol))reject('CAMPUS_SERVICE_TARGET_REJECTED');
  const wrapped=physical.origin===VPN;
  const decoded=wrapped?decodeUrl(physical.href):undefined;
  if(wrapped&&!decoded)reject('CAMPUS_SERVICE_ENTRY_UNDECODABLE');
  const logical=new URL(decoded??physical.href);
  if(logical.username||logical.password||logical.port||logical.hash)reject('CAMPUS_SERVICE_TARGET_REJECTED');
  if(IDENTITY.has(logical.hostname)){
    if(logical.protocol!=='https:')reject('CAMPUS_SERVICE_TARGET_REJECTED');
    if(logical.hostname==='id.tsinghua.edu.cn'&&!/^\/do\/off\/ui\/auth\/login\/form\/[0-9a-f]{32}\/[01]$/i.test(logical.pathname))reject('CAMPUS_SERVICE_IDENTITY_ROUTE_UNSUPPORTED');
    // The authenticated portal also uses /thu-oauth/inforoam (including cloud).
    // Accept this official SSO protocol family without a per-application path
    // list; account/logout operations remain outside the read-only bridge.
    if(logical.hostname==='oauth.tsinghua.edu.cn'&&(!/^\/thu-oauth\/[A-Za-z0-9_/-]+$/.test(logical.pathname)&&logical.pathname!=='/lb-auth/lbredirect'||/(?:logout|account|password|revoke|delete)/i.test(logical.pathname)))reject('CAMPUS_SERVICE_IDENTITY_ROUTE_UNSUPPORTED');
  }else if(!isCampusServiceOrigin(logical.origin))reject('CAMPUS_SERVICE_TARGET_REJECTED');
  return {logical,physical,transport:wrapped?'webvpn':'direct'};
}
async function bounded(response:Response,check:()=>void):Promise<string>{
  if(!response.body)return '';
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{while(true){check();const part=await reader.read();check();if(part.done)break;size+=part.value.byteLength;if(size>LIMIT)reject('CAMPUS_SERVICE_RESPONSE_TOO_LARGE');parts.push(part.value);}
    const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return new TextDecoder().decode(bytes);
  }catch(error){await reader.cancel().catch(()=>undefined);throw error;}finally{reader.releaseLock();}
}
function ticket(url:URL){return ['ticket','code','uniToken'].some(name=>url.searchParams.has(name));}
function assertNoSecondFactor(body:string){
  const visible=body.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->/gi,'');
  if(/二次认证|二次验证|双因素|双因子|two.factor.authentication/i.test(visible))reject('CAMPUS_SERVICE_VERIFICATION_REQUIRED');
}
function result(destination:Route,allowDirect:boolean):CampusPortalResult{
  if(!isCampusServiceOrigin(destination.logical.origin)||destination.logical.origin===INFO)reject();
  const upstreamOrigin=destination.logical.origin;
  const url=new URL(destination.logical);if(url.protocol==='http:')url.protocol='https:';
  return {url:url.href,origin:url.origin,upstreamOrigin,transport:allowDirect&&destination.logical.protocol==='https:'?destination.transport:'webvpn'};
}

/** Resolve an official application through the existing account's cookies.
 * Identity confirmation posts only the existing device fingerprint. A service
 * callback is returned to that service's original browser application; shared
 * identity cookies and passwords never leave the account transport. */
export async function resolveCampusPortal(http:HttpClient,selector:string,context:CampusPortalContext):Promise<CampusPortalResult>{
  if(!/^[0-9a-f]{32}$/i.test(selector))reject('CAMPUS_SERVICE_SELECTOR_REJECTED');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30_000);
  const check=()=>{context.assertCurrent();if(controller.signal.aborted)reject('CAMPUS_SERVICE_TIMEOUT');};
  const guarded=async(response:Response)=>{try{check();return response;}catch(error){await response.body?.cancel().catch(()=>undefined);throw error;}};
  const fetchRoute=async(destination:Route)=>{
    check();
    const init={redirect:'manual' as const,signal:controller.signal};
    if(!IDENTITY.has(destination.logical.hostname)&&destination.logical.origin!==INFO&&destination.transport==='direct'&&destination.logical.protocol==='https:'&&context.fetchDirect){
      return guarded(await context.fetchDirect(destination.logical.href,init));
    }
    if(!IDENTITY.has(destination.logical.hostname)&&destination.transport==='direct'){
      destination.transport='webvpn';destination.physical=new URL(webvpnWrap(destination.logical.href));
    }
    return guarded(await http.request(destination.physical.href,{...init,direct:true}));
  };
  try{
    check();
    const entry=new URL(ROAMING_URL());entry.search=new URLSearchParams({yyfwid:selector,_csrf:context.csrf,machine:'p'}).toString();
    const response=await guarded(await http.request(entry.href,{redirect:'manual',signal:controller.signal}));
    if(!response.ok){await response.body?.cancel();reject('CAMPUS_SERVICE_PORTAL_HTTP_'+response.status);}
    let destination:unknown;try{destination=(JSON.parse(await bounded(response,check)) as {object?:{roamingurl?:unknown}}).object?.roamingurl;}catch(error){check();throw error instanceof SyntaxError?Object.assign(new Error('CAMPUS_SERVICE_SSO_REQUIRED'),{code:'CAMPUS_SERVICE_SSO_REQUIRED'}):error;}
    if(typeof destination!=='string'||!destination)reject('CAMPUS_SERVICE_ENTRY_MISSING');
    let current=route(destination,new URL(ROAMING_URL()));
    let serviceOrigin:string|undefined,identitySeen=false,confirmed=false;
    const visited=new Set<string>();
    for(let hop=0;hop<8;hop++){
      check();if(visited.has(current.physical.href))reject('CAMPUS_SERVICE_REDIRECT_LOOP');visited.add(current.physical.href);
      const identity=IDENTITY.has(current.logical.hostname);
      if(identity)identitySeen=true;
      else if(current.logical.origin!==INFO){
        if(identitySeen&&serviceOrigin&&current.logical.origin!==serviceOrigin){
          const entry=new URL(serviceOrigin);
          // Some legacy HTTP services advertise an HTTPS CAS callback although
          // their application only exists on the original HTTP wire route.
          // Retain the exact host learned before identity authentication; this
          // cannot authorize another host or downgrade an HTTPS service.
          if(entry.protocol!=='http:'||current.logical.protocol!=='https:'||entry.hostname!==current.logical.hostname)reject('CAMPUS_SERVICE_CALLBACK_REJECTED');
          current.logical.protocol='http:';
          current.physical=new URL(webvpnWrap(current.logical.href));
          current.transport='webvpn';
        }
        serviceOrigin=current.logical.origin;
        if(ticket(current.logical))return result(current,!!context.fetchDirect);
      }
      let res=await fetchRoute(current);
      if([301,302,303,307,308].includes(res.status)&&res.headers.has('location')){
        const location=res.headers.get('location')!;await res.body?.cancel();current=route(location,current.physical);continue;
      }
      if(!res.ok){await res.body?.cancel();reject('CAMPUS_SERVICE_HTTP_'+res.status);}
      let body=await bounded(res,check);
      if(current.logical.origin===ID){
        assertNoSecondFactor(body);
        if(!confirmed&&/checkSingle/.test(body)&&!/(?:name\s*=\s*["']i_pass["']|sm2publicKey|二次认证|双因素)/i.test(body)){
          confirmed=true;check();
          const action=current.transport==='webvpn'?webvpnWrap(ID+'/do/off/ui/auth/login/checkSingle'):ID+'/do/off/ui/auth/login/checkSingle';
          res=await guarded(await http.request(action,{method:'POST',body:new URLSearchParams({i_rememberme:'on',fingerPrint:context.fingerprint,fingerGenPrint:context.finger3??''}),headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},redirect:'manual',direct:true,signal:controller.signal}));
          if([301,302,303,307,308].includes(res.status)&&res.headers.has('location')){const location=res.headers.get('location')!;await res.body?.cancel();current=route(location,new URL(action));continue;}
          body=await bounded(res,check);if(!res.ok)reject();assertNoSecondFactor(body);
        }
        const anchor=/<a\b[^>]*\bhref\s*=\s*(["'])([^"'<>]*(?:[?&]|&amp;)(?:ticket|code)=[^"'<>]+)\1/i.exec(body)?.[2];
        if(anchor){current=route(anchor,current.physical);continue;}
        reject('CAMPUS_SERVICE_IDENTITY_REQUIRED');
      }
      if(identity||current.logical.origin===INFO){
        // Some official bridge pages use a refresh or a literal navigation.
        // Do not evaluate JavaScript, submit arbitrary forms, or extract links
        // from business content to authorize additional services.
        const refresh=/<meta\b[^>]*http-equiv\s*=\s*["']refresh["'][^>]*content\s*=\s*["'][^"']*url\s*=\s*([^"'<>\s]+)["']/i.exec(body)?.[1];
        const navigation=/(?:window\.)?location(?:\.href)?\s*=\s*(["'])(https?:\/\/[^"'<>\s]+)\1\s*;/.exec(body)?.[2];
        const next=refresh??navigation;if(next){current=route(next,current.physical);continue;}reject('CAMPUS_SERVICE_BRIDGE_UNSUPPORTED');
      }
      return result(current,!!context.fetchDirect);
    }
    reject('CAMPUS_SERVICE_REDIRECT_LIMIT');
  }finally{clearTimeout(timer);}
}
