import { GatewayError } from './policy.mjs';

export const MINI_PROGRAMS = Object.freeze({
  wxc607b8a0063e7426: 'xiaoda', wx3cfa534a23db4039: 'xingzai',
});
export const CLIENT_IDENTITY_HOST = 'id.tsinghua.edu.cn';
export const CLIENT_BUSINESS_HOSTS = Object.freeze(['www.xiaoda.tsinghua.edu.cn', 'visit.tsinghua.edu.cn']);
const services = Object.freeze({ d982b795884e882abfa8ff3167aeb03e: 'xiaoda', '04655f71b042b9d2d8d10cd566bd9c39': 'visit' });
const fail = () => { throw new GatewayError('GATEWAY_CLIENT_REQUEST_REJECTED', 403); };

export function miniProgramRequest(target, headers, method = 'GET') {
  if (!(target instanceof URL) || target.protocol !== 'https:' || target.port || target.username || target.password || target.hash) fail();
  // Browser-generated cross-site Fetch Metadata never becomes a native-client
  // exemption, even when the request originated in a signed WeChat process.
  let ref; try { ref = new URL(headers.referer); } catch { fail(); }
  if (ref.username || ref.password || ref.hash || ref.protocol !== 'https:' || ref.port) fail();
  const native = ref.hostname === 'servicewechat.com' && /^\/(wx[0-9a-f]{16})\/(?:\d+|devtools)\/page-frame\.html$/.exec(ref.pathname);
  const app = native ? MINI_PROGRAMS[native[1]] : null;
  const visitWeb = ref.origin === 'https://visit.tsinghua.edu.cn';
  const visitLanding = target.origin === 'https://visit.tsinghua.edu.cn' && /^\/visitor\/mobile\/?$/.test(target.pathname) && !target.search;
  if (headers['sec-fetch-site'] === 'cross-site' && !(app === 'xingzai' && visitLanding && method === 'GET' && headers['sec-fetch-dest'] === 'document')) fail();
  if (target.hostname === CLIENT_IDENTITY_HOST) {
    const match = /^\/do\/off\/ui\/auth\/login\/form\/([0-9a-f]{30,32})\/0$/.exec(target.pathname);
    const service = match && services[match[1]];
    if (!['GET', 'HEAD'].includes(method) || !service || !(service === 'xiaoda' && app === 'xiaoda' || service === 'visit' && (app === 'xingzai' || visitWeb))) fail();
    const callback = target.search;
    if (callback && callback !== (service === 'xiaoda' ? '?/login.html' : '?/visitor/mobile/sso')) fail();
    return Object.freeze({ service, app: service === 'xiaoda' ? 'xiaoda' : 'xingzai', identity: true });
  }
  if (target.hostname === 'www.xiaoda.tsinghua.edu.cn' && app === 'xiaoda') return Object.freeze({ service: 'xiaoda', app, identity: false });
  // Only official visitor web content / Xingzai may enter this native route.
  if (target.hostname === 'visit.tsinghua.edu.cn' && (app === 'xingzai' || visitWeb)) return Object.freeze({ service: 'visit', app: 'xingzai', identity: false });
  const visitCallback = target.origin === 'https://visit.tsinghua.edu.cn' && target.pathname === '/visitor/mobile/sso' && method === 'GET' &&
    ref.origin === 'https://id.tsinghua.edu.cn' && (ref.pathname==='/' || /^\/do\/off\/ui\/auth\/login\/(?:checkSingle|form\/04655f71b042b9d2d8d10cd566bd9c39\/0)$/.test(ref.pathname));
  if (visitCallback) return Object.freeze({service:'visit',app:'xingzai',identity:false});
  fail();
}

export function parseClientTarget(value, host, tunnel) {
  if (typeof value !== 'string' || !value || /[\x00-\x20\x7f\\]/.test(value) || value.startsWith('//') || value.includes('#')) fail();
  let target; try { target = new URL(value, tunnel.origin); } catch { fail(); }
  if (target.origin !== tunnel.origin || ![target.hostname, `${target.hostname}:443`].includes(host?.toLowerCase()) || target.username || target.password || target.hash) fail();
  return target;
}
