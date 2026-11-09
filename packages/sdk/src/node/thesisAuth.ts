/** Private, account-fenced ticket exchange for the university thesis service. */
import { load } from 'cheerio';
import { webvpnWrap, type CookieJar, type CookieRecord } from '@onethu/core';
import { GatewayError } from '@onethu/gateway/policy';
import { THESIS_ORIGIN, THESIS_IDENTITY_URL, parseThesisLogin, normalizeThesisCallback } from '@onethu/gateway/thesis-auth';
import { createNodeTransport } from './transport.js';
import { campusDirectFetch } from './campusDirect.js';
import { mergeServiceCookies } from './serviceCookies.js';

const HOME = THESIS_ORIGIN + '/home/qh/index';
const MAX_RESPONSE = 512 * 1024;
type Stage = 'ENTRY' | 'PROBE' | 'CALLBACK' | 'EXCHANGE' | 'VERIFY' | 'COOKIE_MERGE';
interface ThesisRuntime {
  jar: CookieJar;
  epoch(): number;
  assertCurrent(epoch: number): void;
  requestCallback(signal: AbortSignal): Promise<string | null>;
  fetch?: typeof globalThis.fetch;
}
function fail(code = 'GATEWAY_SERVICE_SSO_REQUIRED', status = 401): never {
  throw new GatewayError(code, status);
}
function serviceUrl(input: string, base?: string): URL {
  if (input.length > 8192 || /[\x00-\x20\x7f\\]/.test(input) || input.includes('#')) fail('GATEWAY_SERVICE_TARGET_REJECTED');
  let url: URL;
  try { url = new URL(input, base); } catch { return fail('GATEWAY_SERVICE_TARGET_REJECTED'); }
  if (url.origin !== THESIS_ORIGIN || url.username || url.password || url.port || url.hash) fail('GATEWAY_SERVICE_TARGET_REJECTED');
  return url;
}
function loggedIn(html: string): boolean {
  const $ = load(html);
  const header = $('.topLogin').first();
  if (!header.length || header.find('.cd-popup-trigger0').length) return false;
  header.find('script,style,template,noscript').remove();
  // Anonymous pages also include a hidden administrative password form and
  // login modal. Only the actual account controls establish this session.
  return header.find('a,button,input').toArray().some(element => {
    const control = $(element), label = (control.attr('value') ?? control.text()).trim();
    if (/^(?:安全)?(?:退出|注销)(?:登录|登陆)?$|^(?:sign\s*out|log\s*out)$/i.test(label)) return true;
    return /(?:^|[/._])(?:logout|logoff|signout)(?:[.?/_]|$)/i.test(control.attr('href') ?? '');
  });
}
function identityEntry(html: string): boolean {
  const $ = load(html), destinations: string[] = [];
  $('script').each((_index, element) => {
    for (const match of $(element).text().matchAll(/window\.location(?:\.href)?\s*=\s*(["'])([^"']+)\1/g)) destinations.push(match[2]!);
  });
  $('meta[http-equiv]').each((_index, element) => {
    if ($(element).attr('http-equiv')?.toLowerCase() !== 'refresh') return;
    const match = /^\s*0\s*;\s*url\s*=\s*(.*?)\s*$/i.exec($(element).attr('content') ?? '');
    if (match) destinations.push(match[1]!.replace(/^(["'])(.*)\1$/, '$2'));
  });
  return destinations.length === 1 && destinations[0] === THESIS_IDENTITY_URL;
}
async function cancellable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void promise.catch(() => undefined); fail('GATEWAY_CANCELLED', 499); }
  let abort = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new GatewayError('GATEWAY_CANCELLED', 499));
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([promise, cancelled]); }
  finally { signal.removeEventListener('abort', abort); }
}

export async function resolveThesisLogin(runtime: ThesisRuntime, entry: string, signal?: AbortSignal): Promise<string> {
  const login = parseThesisLogin(entry);
  if (!login) throw Object.assign(new GatewayError('GATEWAY_SERVICE_TARGET_REJECTED', 401), { serviceReason: 'CAMPUS_SERVICE_THESIS_ENTRY' });
  const expected = runtime.epoch();
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 30_000); timer.unref();
  const active = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  const check = () => {
    runtime.assertCurrent(expected);
    if (active.aborted) fail(signal?.aborted ? 'GATEWAY_CANCELLED' : 'GATEWAY_TIMEOUT', signal?.aborted ? 499 : 504);
  };
  const initial = runtime.jar.serialize();
  const transport = createNodeTransport({ fetch: runtime.fetch ?? campusDirectFetch, epoch: runtime.epoch,
    assertCurrent: runtime.assertCurrent, maxResponseBytes: MAX_RESPONSE, timeoutMs: 30_000 });
  transport.jar.hydrate(initial);
  let stage: Stage = 'PROBE';
  const fetchPage = async (url: string) => {
    check();
    const response = await cancellable(transport.fetch(url, { method: 'GET', redirect: 'manual', signal: active }), active);
    check(); return response;
  };
  const readPage = async (response: Response) => {
    const html = await cancellable(response.text(), active);
    check(); return html;
  };
  const verify = async () => {
    const response = await fetchPage(HOME);
    if (!response.ok || !/\btext\/html\b/i.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel(); return false;
    }
    return loggedIn(await readPage(response));
  };
  try {
    check();
    if (!await verify()) {
      const host = new URL(THESIS_ORIGIN).hostname;
      const prefixes = ['http:', 'https:'].map(scheme => new URL(webvpnWrap(scheme + '//' + host + '/')).pathname.replace(/\/$/, ''));
      transport.jar.hydrate(JSON.stringify((JSON.parse(transport.jar.serialize()) as CookieRecord[]).filter(cookie => cookie.domain !== host
        && !(cookie.domain === 'webvpn.tsinghua.edu.cn' && prefixes.some(prefix => cookie.path === prefix || cookie.path.startsWith(prefix + '/'))))));
      stage = 'ENTRY';
      const response = await fetchPage(login.entry);
      const location = response.headers.get('location');
      if ([301, 302, 303, 307, 308].includes(response.status) && location) {
        await response.body?.cancel();
        if (new URL(location, entry).href !== THESIS_IDENTITY_URL) fail('GATEWAY_SERVICE_TARGET_REJECTED');
      } else if (!response.ok || !identityEntry(await readPage(response))) fail('GATEWAY_SERVICE_TARGET_REJECTED');
      stage = 'CALLBACK';
      const callback = await cancellable(runtime.requestCallback(active), active); check();
      const validated = callback && normalizeThesisCallback(callback);
      if (!validated) fail('GATEWAY_IDENTITY_SESSION_REQUIRED');
      let url = validated;
      const visited = new Set<string>();
      for (let hop = 0; hop < 8; hop++) {
        stage = 'EXCHANGE';
        const target = serviceUrl(url);
        if (visited.has(target.href)) fail('GATEWAY_SERVICE_REDIRECT_LOOP');
        visited.add(target.href);
        const exchange = await fetchPage(target.href);
        const destination = exchange.headers.get('location');
        if ([301, 302, 303, 307, 308].includes(exchange.status) && destination) {
          await exchange.body?.cancel();
          url = serviceUrl(destination, target.href).href;
          if (hop === 7) fail('GATEWAY_SERVICE_REDIRECT_LIMIT');
          continue;
        }
        await exchange.body?.cancel();
        if (!exchange.ok) fail();
        break;
      }
      stage = 'VERIFY';
      if (!await verify()) fail();
    }
    stage = 'COOKIE_MERGE';
    check(); mergeServiceCookies(runtime.jar, transport.jar, initial, THESIS_ORIGIN); check();
    return login.redirectUrl;
  } catch (error) {
    if (active.aborted) error = new GatewayError(signal?.aborted ? 'GATEWAY_CANCELLED' : 'GATEWAY_TIMEOUT', signal?.aborted ? 499 : 504);
    if (error instanceof Error) Object.assign(error, { serviceReason: 'CAMPUS_SERVICE_THESIS_' + stage });
    throw error;
  } finally { clearTimeout(timer); transport.close(); transport.jar.clear(); }
}
