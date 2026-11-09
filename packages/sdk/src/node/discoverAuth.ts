/** Per-transaction SAML bridge for the library. All assertions stay on the
 * registered IdP/SP chain; only the service's real final ticket reaches its SPA. */
import { load } from 'cheerio';
import type { CookieJar, CookieRecord } from '@onethu/core';
import { GatewayError } from '@onethu/gateway/policy';
import {
  DISCOVER_ORIGIN, DISCOVER_IDP_ORIGIN, DISCOVER_IDENTITY_URL, DISCOVER_ACS,
  parseDiscoverLogin, normalizeDiscoverCallback, isDiscoverTransition,
} from '@onethu/gateway/discover-auth';
import { createNodeTransport } from './transport.js';
import { campusDirectFetch } from './campusDirect.js';
import { mergeServiceCookies } from './serviceCookies.js';

const SSO = DISCOVER_IDP_ORIGIN + '/idp/profile/SAML2/POST/SSO';
const MAX_RESPONSE = 512 * 1024;
type DiscoveryStage = 'ENTRY' | 'ROUTE' | 'START' | 'FORM' | 'SAML_REQUEST' | 'IDP' | 'IDP_STORAGE' | 'ITS' | 'CALLBACK' | 'SAML_RESPONSE' | 'ACS' | 'TRANSITION' | 'COOKIE_MERGE';
const STORAGE_FIELDS = new Set([
  'csrf_token', '_eventId_proceed', 'shib_idp_ls_supported',
  'shib_idp_ls_exception.shib_idp_session_ss', 'shib_idp_ls_success.shib_idp_session_ss', 'shib_idp_ls_value.shib_idp_session_ss',
  'shib_idp_ls_exception.shib_idp_persistent_ss', 'shib_idp_ls_success.shib_idp_persistent_ss', 'shib_idp_ls_value.shib_idp_persistent_ss',
]);
interface Runtime {
  jar: CookieJar;
  epoch(): number;
  /** Must reject logout/account replacement as well as an epoch change. */
  assertCurrent(epoch: number): void;
  requestCallback(identityUrl: string, signal: AbortSignal): Promise<string | null>;
  fetch?: typeof globalThis.fetch;
}
function fail(code = 'GATEWAY_SERVICE_SSO_REQUIRED', status = 401): never { throw new GatewayError(code, status); }
function exactUrl(input: string, base?: string): URL {
  if (input.length > 8192 || /[\x00-\x20\x7f\\]/.test(input) || input.includes('#')) fail('GATEWAY_SERVICE_TARGET_REJECTED');
  let url: URL;
  try { url = new URL(input, base); } catch { return fail('GATEWAY_SERVICE_TARGET_REJECTED'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) fail('GATEWAY_SERVICE_TARGET_REJECTED');
  return url;
}
function xmlRoot(encoded: string, name: string) {
  if (!/^[A-Za-z0-9+/\r\n]+={0,2}$/.test(encoded) || encoded.length > MAX_RESPONSE) fail('GATEWAY_SERVICE_SAML_INVALID');
  const compact = encoded.replace(/[\r\n]/g, '');
  const bytes = Buffer.from(compact, 'base64');
  if (bytes.toString('base64') !== compact) fail('GATEWAY_SERVICE_SAML_INVALID');
  const source = bytes.toString('utf8');
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) fail('GATEWAY_SERVICE_SAML_INVALID');
  const $ = load(source, { xml: true });
  const elements = $.root().children();
  const root = elements.first();
  if (elements.length !== 1 || root.prop('tagName')?.split(':').at(-1)?.toLowerCase() !== name.toLowerCase()) fail('GATEWAY_SERVICE_SAML_INVALID');
  return { $, root };
}
function fieldsFor(form: ReturnType<ReturnType<typeof load>>, $: ReturnType<typeof load>) {
  const values = new URLSearchParams();
  form.find('input[name]').each((_index, element) => {
    const input = $(element), name = input.attr('name')!;
    if (values.has(name) || !['hidden', 'submit'].includes((input.attr('type') ?? '').toLowerCase())) fail('GATEWAY_SERVICE_FORM_REJECTED');
    values.set(name, input.attr('value') ?? '');
  });
  if (values.toString().length > MAX_RESPONSE) fail('GATEWAY_SERVICE_FORM_REJECTED');
  return values;
}

export async function resolveDiscoverLogin(runtime: Runtime, entry: string, signal?: AbortSignal): Promise<string> {
  let stage: DiscoveryStage = 'ENTRY';
  const login = parseDiscoverLogin(entry);
  if (!login) throw Object.assign(new GatewayError('GATEWAY_SERVICE_TARGET_REJECTED', 401), { serviceReason: 'CAMPUS_SERVICE_DISCOVER_ENTRY' });
  const expected = runtime.epoch();
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 30_000); timer.unref();
  const active = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  const check = () => {
    runtime.assertCurrent(expected);
    if (active.aborted) fail(signal?.aborted ? 'GATEWAY_CANCELLED' : 'GATEWAY_TIMEOUT', signal?.aborted ? 499 : 504);
  };
  try { check(); } catch (error) { clearTimeout(timer); throw error; }
  const initial = runtime.jar.serialize();
  const transport = createNodeTransport({ fetch: runtime.fetch ?? campusDirectFetch, epoch: runtime.epoch, assertCurrent: runtime.assertCurrent,
    maxResponseBytes: MAX_RESPONSE, timeoutMs: 30_000 });
  const idpHost = new URL(DISCOVER_IDP_ORIGIN).hostname;
  // Every transaction starts a fresh IdP conversation. An older IdP session
  // (including a parent-domain cookie) cannot silently select another user.
  transport.jar.hydrate(JSON.stringify((JSON.parse(initial) as CookieRecord[]).filter(cookie =>
    (cookie.hostOnly ? cookie.domain !== idpHost : cookie.domain !== idpHost && !idpHost.endsWith('.' + cookie.domain))
    && !(cookie.domain===new URL(DISCOVER_ORIGIN).hostname && (cookie.name==='mujinaSpSessionId'||cookie.path.startsWith('/samlsp'))))));
  let url = login!.startUrl, init: RequestInit = { method: 'GET' }, requestId = '', identityUsed = false, assertionPosted = false;
  let relayState: string | null = null;
  let storagePosts = 0;
  let resumedSavedRequest = false;
  const visited = new Set<string>();
  const idpUrl = (value: URL) => value.origin === DISCOVER_IDP_ORIGIN && (
    value.pathname === '/idp/profile/SAML2/POST/SSO'
      && [...value.searchParams.keys()].every(key => key === 'execution' || key === '_eventId_proceed')
      && value.searchParams.getAll('execution').length <= 1
      && (!value.searchParams.has('execution') || /^[A-Za-z0-9_.-]{1,128}$/.test(value.searchParams.get('execution')!))
      && value.searchParams.getAll('_eventId_proceed').length<=1
      && (!value.searchParams.has('_eventId_proceed') || ['', '1'].includes(value.searchParams.get('_eventId_proceed')!))
    || value.pathname === '/idp/external.jsp'
      && value.searchParams.size === 1 && /^[A-Za-z0-9_.-]{1,128}$/.test(value.searchParams.get('conversation') ?? '')
    || normalizeDiscoverCallback(value.href) !== null
  );
  try {
    for (let hop = 0; hop < 20; hop++) {
      stage = 'ROUTE';
      check();
      const target = exactUrl(url);
      if (isDiscoverTransition(target.href, entry)) {
        stage = 'TRANSITION';
        if (!identityUsed || !assertionPosted) fail('GATEWAY_SERVICE_SAML_INVALID');
        stage = 'COOKIE_MERGE';
        check(); mergeServiceCookies(runtime.jar, transport.jar, initial, DISCOVER_ORIGIN); check();
        // The official SPA re-encodes every query field when lang is present,
        // turning its already-encoded targetUrl into an invalid relative path.
        // Keep the verified ticket and original target, with one encoding pass.
        const canonical=new URL(target.href);
        canonical.searchParams.delete('lang');
        canonical.searchParams.set('targetUrl',login!.targetUrl);
        return canonical.href;
      }
      if (target.href === DISCOVER_IDENTITY_URL) {
        stage = 'ITS';
        if (identityUsed || !requestId) fail('GATEWAY_SERVICE_SAML_INVALID');
        identityUsed = true;
        const callback = await runtime.requestCallback(target.href, active); check();
        stage = 'CALLBACK';
        const validated = callback && normalizeDiscoverCallback(callback);
        if (!validated) fail('GATEWAY_IDENTITY_SESSION_REQUIRED');
        url = validated; init = { method: 'GET' }; continue;
      }
      const isDiscover = target.origin === DISCOVER_ORIGIN && (
        target.href === login!.startUrl || target.href === DISCOVER_ORIGIN + '/samlsp/user.html'
        || target.href === DISCOVER_ACS && init.method === 'POST' && assertionPosted
      );
      if (!isDiscover && !idpUrl(target)) fail('GATEWAY_SERVICE_TARGET_REJECTED');
      const key = `${init.method ?? 'GET'} ${target.href}`;
      if (visited.has(key)) {
        if (assertionPosted && !resumedSavedRequest && init.method === 'GET' && target.href === DISCOVER_ORIGIN + '/samlsp/user.html') resumedSavedRequest = true;
        else fail('GATEWAY_SERVICE_REDIRECT_LOOP');
      }
      visited.add(key);
      stage = target.href === DISCOVER_ACS ? 'ACS' : target.origin === DISCOVER_IDP_ORIGIN ? (normalizeDiscoverCallback(target.href) ? 'CALLBACK' : 'IDP') : 'START';
      const response = await transport.fetch(target.href, { ...init, redirect: 'manual', signal: active }); check();
      const location = response.headers.get('location');
      if ([301, 302, 303, 307, 308].includes(response.status) && location) {
        await response.body?.cancel();
        if (init.method === 'POST' && [307, 308].includes(response.status)) fail('GATEWAY_SERVICE_FORM_REJECTED');
        url = exactUrl(location, target.href).href; init = { method: 'GET' }; continue;
      }
      if (!response.ok) { await response.body?.cancel(); fail(); }
      const html = await response.text(); check();
      stage = 'FORM';
      const $ = load(html), forms = $('form');
      if (forms.length !== 1 || $('input[type=password],input[name=i_pass]').length) fail('GATEWAY_IDENTITY_SESSION_REQUIRED');
      const form = forms.first(), action = exactUrl(form.attr('action') ?? '', target.href);
      if ((form.attr('method') ?? 'GET').toUpperCase() !== 'POST') fail('GATEWAY_SERVICE_FORM_REJECTED');
      const values = fieldsFor(form, $);
      if (target.origin === DISCOVER_ORIGIN && action.href === SSO && values.has('SAMLRequest')) {
        stage = 'SAML_REQUEST';
        if (requestId || [...values.keys()].some(key => !['SAMLRequest', 'RelayState'].includes(key))) fail('GATEWAY_SERVICE_FORM_REJECTED');
        const { $, root } = xmlRoot(values.get('SAMLRequest')!, 'AuthnRequest');
        requestId = root.attr('ID') ?? '';
        relayState = values.get('RelayState');
        if (!/^[A-Za-z0-9_.-]{1,128}$/.test(requestId) || root.attr('Destination') !== SSO || root.attr('AssertionConsumerServiceURL') !== DISCOVER_ACS
          || root.attr('ProtocolBinding') !== 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST'
          || root.find('*').filter((_i, node) => $(node).prop('tagName')?.split(':').at(-1)?.toLowerCase() === 'issuer').text() !== DISCOVER_ORIGIN + '/samlsp') fail('GATEWAY_SERVICE_SAML_INVALID');
      } else if (target.origin === DISCOVER_IDP_ORIGIN && action.href === DISCOVER_ACS && values.has('SAMLResponse')) {
        stage = 'SAML_RESPONSE';
        if (!identityUsed || !requestId || assertionPosted || values.get('RelayState') !== relayState || [...values.keys()].some(key => !['SAMLResponse', 'RelayState'].includes(key))) fail('GATEWAY_SERVICE_FORM_REJECTED');
        const { root } = xmlRoot(values.get('SAMLResponse')!, 'Response');
        if (root.attr('InResponseTo') !== requestId || root.attr('Destination') !== DISCOVER_ACS) fail('GATEWAY_SERVICE_SAML_INVALID');
        assertionPosted = true;
      } else if (target.origin === DISCOVER_IDP_ORIGIN && action.origin === DISCOVER_IDP_ORIGIN
        && action.pathname === '/idp/profile/SAML2/POST/SSO' && idpUrl(action)
        && values.has('shib_idp_ls_supported') && values.has('_eventId_proceed') && values.has('csrf_token')) {
        stage = 'IDP_STORAGE';
        if (++storagePosts > 2 || [...values.keys()].some(key => !STORAGE_FIELDS.has(key))) fail('GATEWAY_SERVICE_FORM_REJECTED');
      } else fail('GATEWAY_SERVICE_FORM_REJECTED');
      url = action.href;
      init = { method: 'POST', body: values.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', origin: target.origin, referer: target.href } };
    }
    return fail('GATEWAY_SERVICE_REDIRECT_LIMIT');
  } catch (error) {
    if (error instanceof GatewayError) Object.assign(error, { serviceReason: 'CAMPUS_SERVICE_DISCOVER_' + stage });
    throw error;
  } finally { clearTimeout(timer); transport.close(); transport.jar.clear(); }
}
