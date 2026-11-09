/** Fixed legacy campus SSO flows with private exchange and verified cookie merge. */
import { load } from 'cheerio';
import { webvpnDecodeUrl, webvpnWrap, type CookieJar, type CookieRecord } from '@onethu/core';
import { GatewayError } from '@onethu/gateway/policy';
import { MYHOME_ORIGIN, normalizeMyhomeCallback } from '@onethu/gateway/myhome-auth';
import { SEAT_ORIGIN, normalizeSeatCallback } from '@onethu/gateway/seat-auth';
import { parseLibrarySession } from '../../../core/src/info/librarySession.js';
import { createNodeTransport } from './transport.js';
import { campusDirectFetch } from './campusDirect.js';
import { mergeServiceCookies } from './serviceCookies.js';

const VPN_ORIGIN = 'https://webvpn.tsinghua.edu.cn';
const OAUTH_ENTRY = 'https://oauth.tsinghua.edu.cn/lb-auth/lbredirect';
const MAX_RESPONSE = 512 * 1024;
type Stage = 'PROBE' | 'CALLBACK' | 'ROUTE' | 'EXCHANGE' | 'VERIFY' | 'COOKIE_MERGE';
export interface LegacyCampusRuntime {
  jar: CookieJar;
  expectedAccount?: string;
  epoch(): number;
  assertCurrent(epoch: number): void;
  requestCallback(): Promise<string | null>;
  fetch?: typeof globalThis.fetch;
}
function fail(code = 'GATEWAY_SERVICE_SSO_REQUIRED', status = 401): never {
  throw new GatewayError(code, status);
}
function safeUrl(input: string, base?: string): URL {
  if (input.length > 8192 || /[\x00-\x20\x7f\\]/.test(input) || input.includes('#')) fail('GATEWAY_SERVICE_TARGET_REJECTED');
  let url: URL;
  try { url = new URL(input, base); } catch { return fail('GATEWAY_SERVICE_TARGET_REJECTED'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.hash) fail('GATEWAY_SERVICE_TARGET_REJECTED');
  return url;
}
function physicalService(input: string, host: string, forceProtocol?: 'http:'): string {
  const physical = safeUrl(input);
  const decoded = physical.origin === VPN_ORIGIN ? webvpnDecodeUrl(physical.href) : undefined;
  if (physical.origin === VPN_ORIGIN && !decoded) fail('GATEWAY_SERVICE_TARGET_REJECTED');
  const logical = safeUrl(decoded ?? physical.href);
  if (logical.hostname !== host) fail('GATEWAY_SERVICE_TARGET_REJECTED');
  // MyHome's Netweb application listens on HTTP. Only the private WebVPN
  // transport sees that scheme; the browser-facing origin stays HTTPS.
  if (physical.origin === VPN_ORIGIN) {
    // The generic decoder canonicalizes leading double slashes. Validate its
    // host, then retain the original wire suffix containing the callback URI.
    const wire = /^\/(https?)\/[a-f0-9]+(\/.*)$/i.exec(physical.pathname);
    if (!wire) fail('GATEWAY_SERVICE_TARGET_REJECTED');
    const protocol = forceProtocol ?? (wire[1] + ':');
    return webvpnWrap(protocol + '//' + host + '/').replace(/\/$/, '') + wire[2] + physical.search;
  }
  if (forceProtocol) logical.protocol = forceProtocol;
  return webvpnWrap(logical.href);
}
function myhomeLoggedIn(html: string): boolean {
  const $ = load(html);
  if ($('input[type=password],input[name="net_Default_LoginCtrl1$txtUserName"],#net_Default_LoginCtrl1_txtUserName').length) return false;
  $('script,style,title,template,noscript').remove();
  const exit = $('a,button,input[type=button],input[type=submit]').toArray().some(element => {
    const control = $(element), text = (control.attr('value') ?? control.text()).trim();
    if (/^(?:安全)?(?:退出|注销)(?:登录|登陆)?$|^(?:sign\s*out|log\s*out)$/i.test(text)) return true;
    const href = control.attr('href') ?? '';
    return /(?:^|[/_])(?:logout|logoff|signout)(?:[.?/_]|$)/i.test(href);
  });
  if (exit) return true;
  // A generic homepage welcome/title is also present for anonymous visitors.
  // Only the service's login control may supply a personalized user label.
  return $('[id]').toArray().some(element => {
    const label = $(element), id = label.attr('id') ?? '';
    if (!/^(?:net_)?(?:Default_)?LoginCtrl\d*_(?:lbl|lab)(?:UserName|RealName|Name|User)$/i.test(id)) return false;
    const text = label.text().trim();
    return text.length > 0 && text.length <= 80 && !/^(?:用户名|姓名|用户|请登录|登录|user|username)$/i.test(text);
  });
}
function seatLoggedIn(html: string, expectedAccount?: string): boolean {
  const session = parseLibrarySession(html);
  if (!session?.token || !session.userId) return false;
  return !expectedAccount || !/^\d+$/.test(expectedAccount) || session.userId === expectedAccount;
}

const SERVICES = {
  myhome: {
    origin: MYHOME_ORIGIN, upstreamOrigin: 'http://myhome.tsinghua.edu.cn', probePath: '/',
    normalize: normalizeMyhomeCallback, loggedIn: myhomeLoggedIn,
    forceProtocol: 'http:' as const, reuseExisting: false, reason: 'MYHOME',
  },
  seat: {
    origin: SEAT_ORIGIN, upstreamOrigin: SEAT_ORIGIN, probePath: '/home/web/f_second',
    normalize: normalizeSeatCallback, loggedIn: seatLoggedIn,
    forceProtocol: undefined, reuseExisting: true, reason: 'SEAT',
  },
};

async function cancellable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  const abortError = () => new GatewayError('GATEWAY_CANCELLED', 499);
  if (signal.aborted) throw abortError();
  let abort = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(abortError());
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([promise, cancelled]); }
  finally { signal.removeEventListener('abort', abort); }
}

export async function resolveLegacyCampusLogin(runtime: LegacyCampusRuntime, service: keyof typeof SERVICES, signal?: AbortSignal): Promise<void> {
  const config = SERVICES[service];
  const probe = webvpnWrap(config.upstreamOrigin + config.probePath);
  const host = new URL(config.origin).hostname;
  const expectedAccount = runtime.expectedAccount;
  const expected = runtime.epoch();
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 30_000); timer.unref();
  const active = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  let stage: Stage = 'PROBE';
  const check = () => {
    runtime.assertCurrent(expected);
    if (active.aborted) fail(signal?.aborted ? 'GATEWAY_CANCELLED' : 'GATEWAY_TIMEOUT', signal?.aborted ? 499 : 504);
  };
  const initial = runtime.jar.serialize();
  const transport = createNodeTransport({ fetch: runtime.fetch ?? campusDirectFetch, epoch: runtime.epoch,
    assertCurrent: runtime.assertCurrent, maxResponseBytes: MAX_RESPONSE, timeoutMs: 30_000 });
  transport.jar.hydrate(initial);
  const fetchPage = async (url: string) => {
    check();
    const response = await transport.fetch(url, { method: 'GET', redirect: 'manual', signal: active });
    check(); return response;
  };
  const verify = async () => {
    const response = await fetchPage(probe);
    if (!response.ok) { await response.body?.cancel(); return false; }
    const html = await response.text(); check(); return config.loggedIn(html, expectedAccount);
  };
  try {
    check();
    // An old session can bypass native renewal only with a stable, matching
    // account identifier. MyHome exposes no reliable account ID in this page.
    const reusable = config.reuseExisting && !!expectedAccount && /^\d+$/.test(expectedAccount);
    if (!reusable || !await verify()) {
      // A stale service cookie can override a new university ticket. Clear it
      // only in this transaction, retaining unrelated services and WebVPN SSO.
      const prefixes = ['http:', 'https:'].map(scheme => new URL(webvpnWrap(scheme + '//' + host + '/')).pathname.replace(/\/$/, ''));
      const cookies = JSON.parse(transport.jar.serialize()) as CookieRecord[];
      transport.jar.hydrate(JSON.stringify(cookies.filter(cookie => cookie.domain !== host
        && !(cookie.domain === 'webvpn.tsinghua.edu.cn'
          && prefixes.some(prefix => cookie.path === prefix || cookie.path.startsWith(prefix + '/'))))));
      stage = 'CALLBACK';
      const callback = await cancellable(runtime.requestCallback(), active); check();
      const target = callback && config.normalize(callback);
      if (!target) fail('GATEWAY_IDENTITY_SESSION_REQUIRED');
      const url = new URL(target);
      // The official gateway concatenates uri directly. Encoding this complete
      // value would turn the callback path into a literal percent-escaped path.
      const scheme = url.protocol.slice(0, -1);
      const port = scheme === 'https' ? '443' : '80';
      const oauth = OAUTH_ENTRY + '?scheme=' + scheme + '&host=' + host + '&port=' + port + '&uri=' + url.pathname + url.search;
      let current = oauth;
      const visited = new Set<string>();
      let completed = false;
      for (let hop = 0; hop < 8; hop++) {
        stage = 'ROUTE'; check();
        const route = safeUrl(current);
        const physical = route.href === oauth ? route.href : physicalService(route.href, host, config.forceProtocol);
        if (visited.has(physical)) fail('GATEWAY_SERVICE_REDIRECT_LOOP');
        visited.add(physical);
        stage = 'EXCHANGE';
        const response = await fetchPage(physical);
        const location = response.headers.get('location');
        if ([301, 302, 303, 307, 308].includes(response.status) && location) {
          await response.body?.cancel();
          const next = safeUrl(location, physical);
          // OAuth has one fixed, freshly constructed entry. All later hops
          // stay in this service's private WebVPN route.
          if (next.origin === 'https://oauth.tsinghua.edu.cn' && next.href !== oauth) fail('GATEWAY_SERVICE_TARGET_REJECTED');
          current = next.href;
          continue;
        }
        await response.body?.cancel();
        if (!response.ok || physical === oauth) fail();
        completed = true;
        break;
      }
      if (!completed) fail('GATEWAY_SERVICE_REDIRECT_LIMIT');
      stage = 'VERIFY';
      if (!await verify()) fail();
    }
    stage = 'COOKIE_MERGE';
    check(); mergeServiceCookies(runtime.jar, transport.jar, initial, config.origin); check();
  } catch (error) {
    if (active.aborted) {
      const failure = new GatewayError(signal?.aborted ? 'GATEWAY_CANCELLED' : 'GATEWAY_TIMEOUT', signal?.aborted ? 499 : 504);
      throw Object.assign(failure, { serviceReason: 'CAMPUS_SERVICE_' + config.reason + '_' + stage });
    }
    if (error instanceof Error) Object.assign(error, { serviceReason: 'CAMPUS_SERVICE_' + config.reason + '_' + stage });
    throw error;
  } finally {
    clearTimeout(timer); transport.close(); transport.jar.clear();
  }
}
