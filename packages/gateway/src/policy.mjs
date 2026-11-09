import { isIP } from 'node:net';
import { GITLAB_ORIGIN } from './routes.mjs';
import { parseStuAuthEntry } from './stuAuth.mjs';
import { parseCabAuthEntry } from './cabAuth.mjs';
import { parseDiscoverLogin } from './discoverAuth.mjs';
import { parseXiaodaLogin } from './xiaodaAuth.mjs';
import { parseThesisLogin, THESIS_ORIGIN } from './thesisAuth.mjs';

export class GatewayError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'GatewayError';
    this.code = code;
    this.status = status;
  }
}

const reject = (code = 'GATEWAY_TARGET_REJECTED', status = 403) => { throw new GatewayError(code, status); };
const HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const METHOD_NAMES = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const IDENTITY_HOSTS = new Set(['id.tsinghua.edu.cn', 'idp.tsinghua.edu.cn', 'oauth.tsinghua.edu.cn', 'webvpn.tsinghua.edu.cn']);
export const isCampusIdentityHost = hostname => IDENTITY_HOSTS.has(hostname);
export function isDynamicCampusOrigin(origin) {
  if (typeof origin !== 'string') return false;
  try {
    const url = cleanUrl(origin);
    return origin === url.origin && url.hostname.endsWith('.tsinghua.edu.cn') && !isCampusIdentityHost(url.hostname);
  } catch { return false; }
}

/** Membership queries never enroll a host. Only the account adapter can grant
 * a service, after validating its authenticated official portal response. */
export function originMembership(staticOrigins, authorizeTarget) {
  return Object.freeze({ has(origin) {
    if (staticOrigins.has(origin)) return !isCampusIdentityHost(new URL(origin).hostname);
    if (typeof authorizeTarget !== 'function' || !isDynamicCampusOrigin(origin)) return false;
    try {
      const result = authorizeTarget(`${origin}/`);
      if (result && typeof result.then === 'function') void Promise.resolve(result).catch(() => {});
      return result === true;
    } catch { return false; }
  } });
}
const CAMPUS_LANDINGS = new Map([
  ['https://info.tsinghua.edu.cn/', 'info-home'],
  ['https://info.tsinghua.edu.cn/f/login', 'info-entry'],
  ['https://info.tsinghua.edu.cn/f/info/xxfb_fg/xnzx/stu/index', 'info-news'],
  ['https://info.tsinghua.edu.cn/f/info/gxfw_fg/common/index', 'info-workbench'],
  ['https://info.tsinghua.edu.cn/f/info/portal_fg/student/yyfwxxindex', 'info-apps'],
  ['https://learn.tsinghua.edu.cn/f/wlxt/index/course/student/', 'learn-home'],
  ['https://learn.tsinghua.edu.cn/f/wlxt/index/course/student', 'learn-home'],
  ['https://learn.tsinghua.edu.cn/f/wlxt/index/course/teacher/', 'learn-home'],
  ['https://learn.tsinghua.edu.cn/f/wlxt/index/course/teacher', 'learn-home'],
  ['https://learn.tsinghua.edu.cn/f/redirectByStuOrTeacher', 'learn-entry'],
  ['https://seat.lib.tsinghua.edu.cn/home/web/f_second', 'library-seat'],
  ['https://myhome.tsinghua.edu.cn/web_netweb_user/noLogin.aspx', 'myhome-login'],
  [THESIS_ORIGIN + '/home/qh/index', 'thesis-home'],
  [THESIS_ORIGIN + '/qh/qhSearch/QbIndex', 'thesis-search'],
  [GITLAB_ORIGIN + '/', 'gitlab-home'],
]);
const cloudFolderShare = target => target?.origin === 'https://cloud.tsinghua.edu.cn' && /^\/d\/[a-f0-9]{20}\/$/.test(target.pathname);

/** Official Info route IDs select a saved destination, never a caller URL. */
export function isInfoRouteLanding(target) {
  const id=target?.searchParams.get('id');
  return target?.origin==='https://info.tsinghua.edu.cn' && target.pathname==='/f/info/route'
    && typeof id==='string' && /^(?:route)?[a-f0-9]{32}$/i.test(id)
    && target.href===target.origin+target.pathname+'?id='+id;
}

/** @param {URL} target */
export function isInfoNewsLanding(target) {
  const id = target?.searchParams.get('xxid');
  return target?.origin === 'https://info.tsinghua.edu.cn'
    && target.pathname === '/f/info/xxfb_fg/xnzx/template/detail'
    && typeof id === 'string' && /^[a-f0-9]{32}$/i.test(id)
    && target.href === target.origin + target.pathname + '?xxid=' + id;
}

function isInfoApplicationLanding(target) {
  if (target?.origin !== 'https://info.tsinghua.edu.cn'
    || target.pathname !== '/f/info/portal_fg/teacher/roamingToApp' || target.hash) return false;
  const params = target.searchParams;
  return params.getAll('yyfwid').length === 1 && /^[a-f0-9]{32}$/i.test(params.get('yyfwid') ?? '')
    && params.getAll('bz').length <= 1 && (!params.has('bz') || params.get('bz') === 'app')
    && [...params.keys()].every(key => key === 'yyfwid' || key === 'bz');
}

const myhomeNotice = target => target?.origin==='https://myhome.tsinghua.edu.cn'
  && target.pathname==='/Netweb_List/News_notice_Detail.aspx'
  && /^\?code=[0-9]{1,12}$/.test(target.search) && !target.hash;
const libraryWorkspace = target => target?.origin==='https://discover.lib.tsinghua.edu.cn'
  && /^\/entrance(?:\/[A-Za-z0-9_-]+)*\/?$/.test(target.pathname)
  && !target.search && !target.hash;

const LIBRARY_SEARCH_FIELDS = new Set([
  'query', 'tab', 'search_scope', 'vid', 'lang', 'offset', 'sortBy',
  'qInclude', 'multiFacets', 'pcAvailability', 'value', 'mode', 'pfilter',
  'detailMark', 'isOpenDialog', 'dispinfo',
]);
function librarySearch(target) {
  if (target?.origin !== 'https://discover.lib.tsinghua.edu.cn'
    || !/^\/entrance\/searchEntrance\/(?:sortList|classificationList)$/.test(target.pathname)
    || target.href.length > 8192 || target.hash || /%(?![a-f0-9]{2})/i.test(target.search)) return false;
  const counts = new Map();
  let count = 0;
  for (const [key, value] of target.searchParams) {
    const occurrences = (counts.get(key) ?? 0) + 1;
    // Advanced search repeats query/pfilter for its separate search clauses.
    if (!LIBRARY_SEARCH_FIELDS.has(key) || ++count > 32
      || occurrences > (key === 'query' || key === 'pfilter' ? 16 : 1)
      || value.length > 4096 || /[\x00-\x1f\x7f\\\ufffd]/.test(value)) return false;
    if (['tab', 'search_scope', 'vid', 'sortBy', 'pcAvailability'].includes(key)
      && !/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) return false;
    if (key === 'offset' && !/^(?:0|[1-9][0-9]{0,6})$/.test(value)) return false;
    if (key === 'lang' && !/^[a-z]{2}(?:[_-][A-Za-z]{2,4})?$/.test(value)) return false;
    if (['detailMark', 'isOpenDialog'].includes(key) && !['true', 'false'].includes(value)) return false;
    if (key === 'mode' && !['basic', 'advanced'].includes(value)) return false;
    counts.set(key, occurrences);
  }
  return count > 0;
}

/** The library homepage submits an empty POST to its public search URL.
 * Canonicalize only this official form to a GET; never replay its body or
 * forward a cross-origin POST with the shared account. */
export function isLibrarySearchFormNavigation(headers, target, origins, navigation) {
  if (!librarySearch(target) || !origins.has(target.origin) || !origins.has('https://lib.tsinghua.edu.cn')
    || navigation?.method !== 'POST' || navigation?.hasBody !== false
    || headers['sec-fetch-site'] !== 'same-site' || headers['sec-fetch-mode'] !== 'navigate'
    || headers['sec-fetch-dest'] !== 'document' || headers['sec-fetch-user'] !== '?1'
    || headers.origin !== 'https://lib.tsinghua.edu.cn'
    || !/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i.test(headers['content-type'] ?? '')) return false;
  try { return cleanUrl(headers.referer).origin === headers.origin; } catch { return false; }
}

function isCampusNavigationLanding(target) {
  // Folder-share IDs select a read-only landing page, never an API/action URL.
  // Comparing href also rejects empty query/fragment markers that URL.search
  // and URL.hash would otherwise normalize to an empty string.
  return target.href === target.origin + '/' || CAMPUS_LANDINGS.has(target.href)
    || cloudFolderShare(target) && target.href === `${target.origin}${target.pathname}`
    || isInfoRouteLanding(target) || isInfoNewsLanding(target) || isInfoApplicationLanding(target) || myhomeNotice(target) || libraryWorkspace(target) || librarySearch(target)
    || parseStuAuthEntry(target.href) !== null || parseCabAuthEntry(target.href) !== null || parseDiscoverLogin(target.href) !== null
    || parseXiaodaLogin(target.href) !== null || parseThesisLogin(target.href) !== null;
}

export function campusLandingCategory(target) {
  return target ? CAMPUS_LANDINGS.get(`${target.origin}${target.pathname}`)
    ?? (cloudFolderShare(target) ? 'cloud-folder-share' : isInfoRouteLanding(target) ? 'info-route' : isInfoNewsLanding(target) ? 'info-news-detail' : myhomeNotice(target) ? 'myhome-notice' : librarySearch(target) ? 'library-search' : 'other') : 'other';
}

function safeHostname(hostname) {
  if (!hostname || hostname.length > 253 || isIP(hostname) || hostname.startsWith('[') || hostname.endsWith('.') || hostname === 'localhost' || hostname.endsWith('.localhost')) reject();
  if (!hostname.includes('.') || !hostname.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) reject();
  return hostname;
}

function cleanUrl(value) {
  if (typeof value !== 'string' || value.length > 16384 || /[\x00-\x20\x7f\\]/.test(value) || value.includes('#')) reject();
  const authority = /^https?:\/\/([^/?#]*)/i.exec(value)?.[1];
  if (!authority || /[%@]/.test(authority)) reject();
  let url;
  try { url = new URL(value); } catch { reject(); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.port) reject();
  safeHostname(url.hostname);
  return url;
}

export function normalizeAllowedOrigins(origins) {
  if (!Array.isArray(origins) || !origins.length || origins.length > 256) reject('GATEWAY_CONFIG_INVALID', 400);
  try {
    return new Set(origins.map(value => {
      const url = cleanUrl(value);
      if (url.pathname !== '/' || url.search) reject();
      return url.origin;
    }));
  } catch { reject('GATEWAY_CONFIG_INVALID', 400); }
}

function allowed(url, origins) {
  // Browser identity pages use the browser's own session and original network
  // route. A custom campus allowlist must never borrow the SDK identity jar.
  if (isCampusIdentityHost(url.hostname)) reject('GATEWAY_AUTH_REQUIRED', 401);
  if (!origins.has(url.origin)) reject();
  return url;
}

function hostUrl(value, protocol) {
  if (typeof value !== 'string' || !value || /[\s\/@?#%\\]/.test(value)) reject('GATEWAY_HOST_REJECTED');
  return cleanUrl(`${protocol}//${value}/`);
}

export function parseProxyTarget(value, host, origins) {
  const url = allowed(cleanUrl(value), origins);
  if (hostUrl(host, url.protocol).origin !== url.origin) reject('GATEWAY_HOST_REJECTED');
  return url;
}

export function parseConnectAuthority(value, host, origins) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9.-]+:443$/.test(value)) reject();
  const url = allowed(cleanUrl(`https://${value}/`), origins);
  if (hostUrl(host, 'https:').origin !== url.origin) reject('GATEWAY_HOST_REJECTED');
  return url;
}

/** Campus CONNECT authorities handed to transparent passthrough may carry a
 * non-443 port: the campus PAC routes every *.tsinghua.edu.cn HTTPS URL to the
 * listener regardless of port, and native campus clients legitimately use
 * services such as the traffic map on 8443. cleanUrl() forbids ports, so this
 * parser validates the authority directly. Identity hosts stay excluded and
 * membership never enrolls a host; passthrough keeps opaque end-to-end TLS. */
export function parseCampusConnectAuthority(value, host) {
  const match = typeof value === 'string' ? /^([A-Za-z0-9.-]+):([0-9]{1,5})$/.exec(value) : null;
  if (!match) reject();
  const port = Number(match[2]);
  if (port < 1 || port > 65535) reject();
  const hostname = match[1].toLowerCase();
  if (isCampusIdentityHost(hostname)) reject('GATEWAY_AUTH_REQUIRED', 401);
  if (!hostname.endsWith('.tsinghua.edu.cn') || hostname.length === '.tsinghua.edu.cn'.length) reject();
  safeHostname(hostname);
  const header = typeof host === 'string' ? host.toLowerCase() : '';
  if (header !== value.toLowerCase() && header !== hostname) reject('GATEWAY_HOST_REJECTED');
  return { hostname, port, origin: port === 443 ? `https://${hostname}` : `https://${hostname}:${port}` };
}

export function parseTunnelTarget(value, host, tunnel, origins) {
  if (typeof value !== 'string' || !value || /[\x00-\x20\x7f\\]/.test(value) || value.includes('#') || value.startsWith('//')) reject();
  const url = value.startsWith('/') ? cleanUrl(`${tunnel.origin}${value}`) : cleanUrl(value);
  if (url.protocol !== 'https:' || url.origin !== tunnel.origin || hostUrl(host, 'https:').origin !== tunnel.origin) reject('GATEWAY_TUNNEL_TARGET_REJECTED');
  return allowed(url, origins);
}

export function isCampusCalendarRead(target, method) {
  if (!(target instanceof URL) || target.origin !== 'https://learn.tsinghua.edu.cn' || target.username || target.password ||
      target.href.includes('?') || target.href.includes('#')) return false;
  // Only the two collection queries actually used by Learn's calendar client.
  // Body/namespace validation is owned by the authoritative SDK adapter.
  const id = '[A-Za-z0-9][A-Za-z0-9._@-]{0,127}';
  return method === 'PROPFIND' && new RegExp(`^/calendars/${id}/$`).test(target.pathname) ||
    method === 'REPORT' && new RegExp(`^/principals/${id}$`).test(target.pathname);
}

export function validateMethod(method, target) {
  if (!METHOD_NAMES.has(method) && !isCampusCalendarRead(target, method)) reject('GATEWAY_METHOD_REJECTED', 405);
}

export function validateFetchMetadata(headers, target, origins = new Set([target.origin]), navigation) {
  const site = headers['sec-fetch-site'];
  if (isLibrarySearchFormNavigation(headers, target, origins, navigation)) return;
  // A user gesture may arrive from another campus subdomain or another site.
  // Only these verified read-only landing URLs may borrow the session in that
  // case. Exact href matching excludes even an empty query or fragment marker.
  if (['same-site', 'cross-site'].includes(site) && origins.has(target.origin) && isCampusNavigationLanding(target) &&
      ['GET', 'HEAD'].includes(navigation?.method) && navigation?.hasBody === false && headers.origin === undefined &&
      headers['sec-fetch-mode'] === 'navigate' && headers['sec-fetch-dest'] === 'document' && headers['sec-fetch-user'] === '?1') return;
  // Cached browser proxy credentials are sent even for attacker-triggered
  // requests. Missing provenance must not authorize a borrowed school session.
  if (site === undefined && headers.origin === undefined) reject('GATEWAY_PROVENANCE_REQUIRED');
  if (site !== undefined && (!['same-origin', 'same-site', 'none'].includes(site))) reject('GATEWAY_CROSS_SITE_REJECTED');
  // Sibling campus subdomains share a site but are not all authorized callers.
  // A GET subresource has no Origin, so require an allowlisted Referer here.
  if (site === 'same-site' && headers.origin === undefined) {
    let referrer;
    try { referrer = cleanUrl(headers.referer); } catch { reject('GATEWAY_PROVENANCE_REQUIRED'); }
    if (!origins.has(referrer.origin)) reject('GATEWAY_CROSS_SITE_REJECTED');
  }
  const origin = headers.origin;
  if (origin !== undefined) {
    let url;
    try { url = cleanUrl(origin); } catch { reject('GATEWAY_CROSS_SITE_REJECTED'); }
    if (url.origin !== target.origin || url.pathname !== '/' || url.search || origin !== url.origin) reject('GATEWAY_CROSS_SITE_REJECTED');
  }
}

function connectionHeaders(value) {
  const result = new Set(HOP_HEADERS);
  for (const name of String(value ?? '').split(',')) {
    const normalized = name.trim().toLowerCase();
    if (normalized) result.add(normalized);
  }
  return result;
}

export function sanitizeRequestHeaders(rawHeaders, { allowAuthorization = false } = {}) {
  const source = new Headers();
  for (let index = 0; index < rawHeaders.length; index += 2) source.append(rawHeaders[index], rawHeaders[index + 1]);
  const remove = connectionHeaders(source.get('connection'));
  const witnessedBearer = allowAuthorization === true && /^(?:Bearer|Token) [A-Za-z0-9._~+/-]{1,4096}={0,2}$/i.test(source.get('authorization') ?? '');
  for (const name of [...source.keys()]) {
    if (remove.has(name) || ['host', 'cookie', 'expect'].includes(name) || name === 'authorization' && !witnessedBearer || name.startsWith('proxy-') || name.startsWith('x-onethu-')) source.delete(name);
  }
  source.set('accept-encoding', 'identity');
  return source;
}

export function sanitizeResponseHeaders(headers) {
  const source = new Headers(headers);
  const remove = connectionHeaders(source.get('connection'));
  const encoding = source.get('content-encoding')?.trim();
  const decoded = encoding && encoding.toLowerCase() !== 'identity';
  const encodedValidators = new Set(['etag', 'content-md5', 'digest', 'content-digest', 'repr-digest']);
  const result = {};
  for (const [name, value] of source) {
    // The adapter supplies Fetch-decoded bytes, so upstream transfer lengths
    // and compression metadata cannot describe the bytes sent to this client.
    if (remove.has(name) || ['set-cookie', 'set-cookie2', 'content-length', 'content-encoding'].includes(name) || name.startsWith('proxy-') || name.startsWith('x-onethu-') || decoded && encodedValidators.has(name)) continue;
    result[name] = value;
  }
  result['cache-control'] = 'no-store';
  result.pragma = 'no-cache';
  result.expires = '0';
  result.connection = 'close';
  return result;
}
