import { decodeUrl as webvpnDecodeUrl } from '../crypto/webvpn.js';
import type { CookieRecord } from '../http.js';

/** Only scopes of this completed service transaction may replace live cookies.
 * All unrelated cookies come from the current authority, not an old snapshot. */
export function mergeSelectionCookies(current:CookieRecord[],incoming:CookieRecord[],identityRenewed:boolean){
  return mergeScopedCookies(current,incoming,new Set(['zhjwxk.cic.tsinghua.edu.cn',...(identityRenewed?['id.tsinghua.edu.cn','oauth.tsinghua.edu.cn']:[])]),false);
}

export function mergeUniversityCookies(current:CookieRecord[],incoming:CookieRecord[]){
  return mergeScopedCookies(current,incoming,new Set(['info.tsinghua.edu.cn','id.tsinghua.edu.cn','oauth.tsinghua.edu.cn']),true);
}

function mergeScopedCookies(current:CookieRecord[],incoming:CookieRecord[],hosts:Set<string>,gateway:boolean){
  const decodedScope=(cookie:CookieRecord)=>webvpnDecodeUrl('https://webvpn.tsinghua.edu.cn'+cookie.path)
    ?? webvpnDecodeUrl('https://webvpn.tsinghua.edu.cn'+cookie.path+'/');
  const scoped=(cookie:CookieRecord)=>{
    if(/^(?:wengine_vpn_ticket|heartbeat|refresh)$/.test(cookie.name)||cookie.name.startsWith('show_'))return gateway&&cookie.domain==='webvpn.tsinghua.edu.cn'&&cookie.path==='/';
    if(hosts.has(cookie.domain))return true;
    if(cookie.domain!=='webvpn.tsinghua.edu.cn'||!/^\/https?\/[a-f0-9]{32,}(?:\/|$)/i.test(cookie.path))return false;
    try{return hosts.has(new URL(decodedScope(cookie)??'https://invalid/').hostname);}catch{return false;}
  };
  const selected=incoming.filter(scoped);
  if(!selected.length)return {cookies:current,changed:false};
  const logical=(cookie:CookieRecord):CookieRecord=>{
    if(cookie.domain!=='webvpn.tsinghua.edu.cn')return cookie;
    const decoded=decodedScope(cookie);if(!decoded)return cookie;
    const url=new URL(decoded);
    return {...cookie,domain:url.hostname,path:url.pathname,secure:url.protocol==='https:',hostOnly:true};
  };
  const key=(cookie:CookieRecord)=>[cookie.domain,cookie.path,cookie.name].join('\n');
  const replacements=new Map(selected.map(cookie=>{const normalized=logical(cookie);return[key(normalized),normalized];}));
  // Explicit native logical cookies take precedence over derived physical ones.
  for(const cookie of selected)replacements.set(key(cookie),cookie);
  const family=(cookie:CookieRecord)=>[logical(cookie).domain,cookie.name].join('\n');
  const families=new Set(selected.map(family));
  // Replace observed cookie families, including obsolete longer paths that
  // would otherwise shadow a renewed root JSESSIONID. Unobserved names/scopes
  // remain owned by the current authority.
  const merged=current.filter(cookie=>!scoped(cookie)||!families.has(family(cookie)));
  merged.push(...replacements.values());
  const stable=(cookies:CookieRecord[])=>JSON.stringify([...cookies].sort((a,b)=>key(a).localeCompare(key(b))).map(cookie=>({
    name:cookie.name,value:cookie.value,domain:cookie.domain,path:cookie.path,secure:cookie.secure,hostOnly:cookie.hostOnly,
    httpOnly:cookie.httpOnly??null,expiresAt:cookie.expiresAt??null,
  })));
  return {cookies:merged,changed:stable(current)!==stable(merged)};
}
