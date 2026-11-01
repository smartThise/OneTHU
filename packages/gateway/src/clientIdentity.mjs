import { GatewayError } from './policy.mjs';

export const MINI_PROGRAMS = Object.freeze({
  wxc607b8a0063e7426: 'xiaoda', wx3cfa534a23db4039: 'xingzai',
});
export const CLIENT_IDENTITY_HOST = 'id.tsinghua.edu.cn';
export const CLIENT_BUSINESS_HOSTS = Object.freeze(['www.xiaoda.tsinghua.edu.cn', 'visit.tsinghua.edu.cn']);
const services = Object.freeze({ d982b795884e882abfa8ff3167aeb03e: 'xiaoda', '04655f71b042b9d2d8d10cd566bd9c39': 'visit' });
const fail = () => { throw new GatewayError('GATEWAY_CLIENT_REQUEST_REJECTED', 403); };

/** Fixed enums only: never retain URLs, query values, AppIDs, cookies or tokens. */
export function describeMiniRequest(target, headers) {
  let ref;
  try { ref = new URL(headers.referer); } catch {}
  const native = ref && /^\/(wx[0-9a-f]{16})(?:\/|$)/.exec(ref.pathname);
  const app = native ? MINI_PROGRAMS[native[1]] ?? 'other' : 'none';
  const form = /^\/do\/off\/ui\/auth\/login\/form\/([0-9a-fA-F]{30,32})(?:\/([0-9]{1,2}))?(\/?)$/.exec(target.pathname);
  let callback = target.search.slice(1), encoded = false;
  try { const decoded = decodeURIComponent(callback); encoded = decoded !== callback; callback = decoded; } catch {}
  return {
    host: [CLIENT_IDENTITY_HOST, ...CLIENT_BUSINESS_HOSTS].includes(target.hostname) ? target.hostname : null,
    path: form ? 'identity-form' : /^\/do\/off\/ui\/auth\/login\/(?:check|checkSingle)$/.test(target.pathname) ? 'identity-check'
      : target.hostname === CLIENT_IDENTITY_HOST ? 'identity-other' : target.pathname === '/api/token/login' ? 'token-exchange' : 'business-other',
    service: form ? services[form[1].toLowerCase()] ?? 'other' : 'none',
    entryMode: form ? form[2]===undefined?'default':['0','1'].includes(form[2]) ? form[2] : 'other' : 'none',
    serviceCase:form ? form[1]===form[1].toLowerCase()?'lower':'mixed-or-upper':'none',
    trailingSlash: !!form?.[3],
    callback: callback === '' ? 'none' : callback === '/login.html' ? 'xiaoda' : callback === '/visitor/mobile/sso' ? 'visit' : 'other',
    callbackEncoded: encoded,
    referrer: !ref ? 'missing-or-invalid' : ref.hostname === 'servicewechat.com' ? 'servicewechat'
      : ref.hostname === 'www.servicewechat.com' ? 'www-servicewechat' : ref.origin === 'https://visit.tsinghua.edu.cn' ? 'visit'
      : ref.origin === 'https://id.tsinghua.edu.cn' ? 'identity' : 'other',
    referrerApp: app,
    referrerLayout: !ref ? 'none' : /^\/wx[0-9a-f]{16}\/(?:\d+|devtools)\/page-frame\.html$/.test(ref.pathname) ? 'page-frame' : 'other',
    fetchSite: ['same-origin','same-site','cross-site','none'].includes(headers['sec-fetch-site']) ? headers['sec-fetch-site'] : headers['sec-fetch-site'] === undefined ? 'missing' : 'other',
    fetchMode: ['navigate','cors','no-cors','same-origin'].includes(headers['sec-fetch-mode']) ? headers['sec-fetch-mode'] : headers['sec-fetch-mode'] === undefined ? 'missing' : 'other',
    fetchDest: ['document','iframe','frame','empty','script','style','image'].includes(headers['sec-fetch-dest']) ? headers['sec-fetch-dest'] : headers['sec-fetch-dest'] === undefined ? 'missing' : 'other',
  };
}

export function miniProgramRequest(target, headers, method = 'GET') {
  if (!(target instanceof URL) || target.protocol !== 'https:' || target.port || target.username || target.password || target.hash) fail();
  // Called only after operating-system verification of the WeChat process.
  // Native wx.request uses the official servicewechat app Referer and may
  // legitimately carry cross-site metadata on current Mac WeChat builds.
  let ref; try { ref = new URL(headers.referer); } catch { fail(); }
  if (ref.username || ref.password || ref.hash || ref.protocol !== 'https:' || ref.port) fail();
  const native = ref.hostname === 'servicewechat.com' && /^\/(wx[0-9a-f]{16})\/(?:\d+|devtools)\/page-frame\.html$/.exec(ref.pathname);
  const app = native ? MINI_PROGRAMS[native[1]] : null;
  const visitWeb = ref.origin === 'https://visit.tsinghua.edu.cn';
  const refForm=/^\/do\/off\/ui\/auth\/login\/form\/([0-9a-fA-F]{30,32})(?:\/[01])?\/?$/.exec(ref.pathname);
  const refService=refForm?services[refForm[1].toLowerCase()]:null;
  if (headers['sec-fetch-site'] === 'cross-site' && !app) fail();
  if (target.hostname === CLIENT_IDENTITY_HOST) {
    const match = /^\/do\/off\/ui\/auth\/login\/form\/([0-9a-fA-F]{30,32})(?:\/([01]))?\/?$/.exec(target.pathname);
    const service = match && services[match[1].toLowerCase()];
    if (!['GET', 'HEAD'].includes(method) || !service || !(service === 'xiaoda' && app === 'xiaoda' || service === 'visit' && (app === 'xingzai' || visitWeb))) fail();
    const callback = target.search;
    if (callback && callback !== (service === 'xiaoda' ? '?/login.html' : '?/visitor/mobile/sso')) fail();
    return Object.freeze({ service, app: service === 'xiaoda' ? 'xiaoda' : 'xingzai', identity: true,entryMode:match[2]===undefined?'default':Number(match[2]) });
  }
  if (target.hostname === 'www.xiaoda.tsinghua.edu.cn' && app === 'xiaoda') return Object.freeze({ service: 'xiaoda', app, identity: false });
  if (target.origin === 'https://www.xiaoda.tsinghua.edu.cn' && ref.origin === target.origin) return Object.freeze({service:'xiaoda',app:'xiaoda',identity:false});
  // Only official visitor web content / Xingzai may enter this native route.
  if (target.hostname === 'visit.tsinghua.edu.cn' && (app === 'xingzai' || visitWeb)) return Object.freeze({ service: 'visit', app: 'xingzai', identity: false });
  const visitCallback = target.origin === 'https://visit.tsinghua.edu.cn' && target.pathname === '/visitor/mobile/sso' && method === 'GET' &&
    ref.origin === 'https://id.tsinghua.edu.cn' && (ref.pathname==='/' || ref.pathname==='/do/off/ui/auth/login/checkSingle' || refService==='visit');
  if (visitCallback) return Object.freeze({service:'visit',app:'xingzai',identity:false});
  if (target.origin === 'https://www.xiaoda.tsinghua.edu.cn' && target.pathname === '/login.html' && method === 'GET' &&
      ref.origin === 'https://id.tsinghua.edu.cn' && (ref.pathname === '/' || ref.pathname==='/do/off/ui/auth/login/checkSingle' || refService==='xiaoda'))
    return Object.freeze({service:'xiaoda',app:'xiaoda',identity:false});
  fail();
}

/** A native mini program can open ITS in a new web view without a Referer.
 * Bind that one navigation to its recent, app-proven native request: same
 * verified OS process, account epoch, registered service, and a 10-second TTL.
 * This never authorizes arbitrary no-Referer requests or credential POSTs. */
export function createMiniNavigationGrants({now=()=>performance.now(),ttlMs=10000}={}) {
  const grants=new Map();let generation;
  const peerKey=client=>client?.application==='wechat'&&['darwin','win32'].includes(client.platform)&&Number.isSafeInteger(client.pid)&&client.pid>0?`${client.platform}:${client.pid}`:null;
  return {
    authorize(target,headers,method,client,epoch,{hasBody=false}={}){
      if(!Number.isSafeInteger(epoch))fail();
      if(generation!==epoch){grants.clear();generation=epoch;}
      const time=now();for(const [key,grant]of grants)if(grant.expires<=time)grants.delete(key);
      const peer=peerKey(client);
      try{
        const request=miniProgramRequest(target,headers,method);
        const ref=(()=>{try{return new URL(headers.referer);}catch{return null;}})();
        if(peer&&!request.identity&&ref?.origin==='https://servicewechat.com'){
          const key=peer+':'+request.service;grants.delete(key);grants.set(key,{expires:time+ttlMs});
          if(grants.size>64)grants.delete(grants.keys().next().value);
        }
        return request;
      }catch(error){
        if(!peer||target.origin!=='https://id.tsinghua.edu.cn'||target.username||target.password||target.hash||hasBody||method!=='GET'||headers.referer!==undefined||headers.origin!==undefined||
          headers['sec-fetch-site']!=='none'||headers['sec-fetch-mode']!=='navigate'||headers['sec-fetch-dest']!=='document'||
          headers['sec-fetch-user']!==undefined&&headers['sec-fetch-user']!=='?1')throw error;
        const info=describeMiniRequest(target,headers);
        if(info.path!=='identity-form'||!['xiaoda','visit'].includes(info.service)||!['default','0','1'].includes(info.entryMode)||info.callbackEncoded||
          info.callback!=='none'&&info.callback!==info.service)throw error;
        const key=peer+':'+info.service,grant=grants.get(key);
        if(!grant||grant.expires<=time)throw error;
        grants.delete(key);
        return Object.freeze({service:info.service,app:info.service==='xiaoda'?'xiaoda':'xingzai',identity:true,entryMode:info.entryMode==='default'?'default':Number(info.entryMode),navigationHandoff:true});
      }
    },
  };
}

export function parseClientTarget(value, host, tunnel) {
  if (typeof value !== 'string' || !value || /[\x00-\x20\x7f\\]/.test(value) || value.startsWith('//') || value.includes('#')) fail();
  let target; try { target = new URL(value, tunnel.origin); } catch { fail(); }
  if (target.origin !== tunnel.origin || ![target.hostname, `${target.hostname}:443`].includes(host?.toLowerCase()) || target.username || target.password || target.hash) fail();
  return target;
}
