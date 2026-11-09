/** Public routing contract of the library's registered SAML application. */
export const DISCOVER_ORIGIN = 'https://discover.lib.tsinghua.edu.cn';
export const DISCOVER_IDENTITY_URL = 'https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/f2841607a1c6b880847ee635cc5046f0/1';
export const DISCOVER_IDP_ORIGIN = 'https://idp.tsinghua.edu.cn';
export const DISCOVER_ACS = DISCOVER_ORIGIN + '/samlsp/saml/SSO';

function cleanUrl(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\x00-\x20\x7f\\]/.test(value) || value.includes('#')) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.href !== value) return null;
    return url;
  } catch { return null; }
}
function uniqueKeys(params, allowed) {
  const seen = new Set();
  for (const [key, value] of params) {
    if (!allowed.has(key) || seen.has(key) || /[\x00-\x1f\x7f\\]/.test(value)) return false;
    seen.add(key);
  }
  return true;
}
function safeHistory(value) {
  const url = cleanUrl(value);
  if (!url || url.origin !== DISCOVER_ORIGIN) return false;
  // The login handoff may return to public search or a library workspace,
  // never to another authentication endpoint or a backend API action.
  return url.pathname === '/' || /^\/entrance\/(?:[A-Za-z0-9_.~-]+\/)*[A-Za-z0-9_.~-]*$/.test(url.pathname)
    && !url.pathname.split('/').some(part => part === '.' || part === '..');
}
export function parseDiscoverLogin(input) {
  const url = cleanUrl(input);
  if (!url || url.origin !== DISCOVER_ORIGIN) return null;
  let targetUrl, serviceUrl, startUrl, language=null;
  if(url.pathname==='/login' && uniqueKeys(url.searchParams,new Set(['history','lang']))){
    targetUrl=url.searchParams.get('history')??DISCOVER_ORIGIN+'/';
    language=url.searchParams.get('lang');
    if(language!==null&&!/^[a-z]{2}(?:[_-][A-Za-z]{2,4})?$/.test(language))return null;
    serviceUrl=DISCOVER_ORIGIN+'/transition?targetUrl='+encodeURIComponent(targetUrl);
    if(language!==null)serviceUrl+='&lang='+encodeURIComponent(language);
    startUrl=DISCOVER_ORIGIN+'/samlsp/redirectLogin?service='+encodeURIComponent(serviceUrl);
  }else if(url.pathname==='/samlsp/redirectLogin' && url.searchParams.size===1 && url.searchParams.has('service')){
    serviceUrl=url.searchParams.get('service');
    const service=cleanUrl(serviceUrl);
    if(!service||service.origin!==DISCOVER_ORIGIN||service.pathname!=='/transition'
      ||!uniqueKeys(service.searchParams,new Set(['targetUrl','lang']))||!service.searchParams.has('targetUrl'))return null;
    language=service.searchParams.get('lang');
    if(language!==null&&!/^[a-z]{2}(?:[_-][A-Za-z]{2,4})?$/.test(language))return null;
    targetUrl=service.searchParams.get('targetUrl');startUrl=input;
  }else return null;
  if (!safeHistory(targetUrl)) return null;
  return {entry:input,targetUrl,serviceUrl,startUrl,language};
}
export function normalizeDiscoverCallback(input) {
  const url = cleanUrl(input);
  if (!url || url.origin !== DISCOVER_IDP_ORIGIN || url.pathname!=='/idp/Authn/External/info'
    || !uniqueKeys(url.searchParams, new Set(['ticket', 'conversation']))) return null;
  const ticket = url.searchParams.get('ticket');
  return ticket && /^[A-Za-z0-9._~+/-]{1,4096}={0,2}$/.test(ticket) ? url.href : null;
}
export function isDiscoverTransition(input, entry) {
  const login = parseDiscoverLogin(entry), url = cleanUrl(input);
  if (!login || !url || url.origin !== DISCOVER_ORIGIN || url.pathname !== '/transition'
    || !uniqueKeys(url.searchParams, new Set(['targetUrl', 'ticket','lang']))) return false;
  const ticket = url.searchParams.get('ticket');
  return url.searchParams.get('targetUrl') === login.targetUrl && url.searchParams.get('lang')===login.language && ticket !== null
    && /^[A-Za-z0-9._~+/-]{1,4096}={0,2}$/.test(ticket);
}
