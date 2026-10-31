import { isIP } from 'node:net';

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
const IDENTITY_HOSTS = new Set(['id.tsinghua.edu.cn', 'oauth.tsinghua.edu.cn']);
export const isCampusIdentityHost = hostname => IDENTITY_HOSTS.has(hostname);
const CAMPUS_LANDINGS = new Map([
  ['https://info.tsinghua.edu.cn/', 'info-home'],
  ['https://info.tsinghua.edu.cn/f/info/xxfb_fg/xnzx/stu/index', 'info-news'],
  ['https://learn.tsinghua.edu.cn/f/wlxt/index/course/student/', 'learn-home'],
]);

export function campusLandingCategory(target) {
  return target ? CAMPUS_LANDINGS.get(`${target.origin}${target.pathname}`) ?? 'other' : 'other';
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

export function parseTunnelTarget(value, host, tunnel, origins) {
  if (typeof value !== 'string' || !value || /[\x00-\x20\x7f\\]/.test(value) || value.includes('#') || value.startsWith('//')) reject();
  const url = value.startsWith('/') ? cleanUrl(`${tunnel.origin}${value}`) : cleanUrl(value);
  if (url.protocol !== 'https:' || url.origin !== tunnel.origin || hostUrl(host, 'https:').origin !== tunnel.origin) reject('GATEWAY_TUNNEL_TARGET_REJECTED');
  return allowed(url, origins);
}

export function validateMethod(method) {
  if (!METHOD_NAMES.has(method)) reject('GATEWAY_METHOD_REJECTED', 405);
}

export function validateFetchMetadata(headers, target, origins = new Set([target.origin]), navigation) {
  const site = headers['sec-fetch-site'];
  // Browser/extension user gestures can mark a top-level entry as cross-site.
  // Only these verified read-only landing URLs may borrow the session in that
  // case. Exact href matching excludes even an empty query or fragment marker.
  if (site === 'cross-site' && origins.has(target.origin) && CAMPUS_LANDINGS.has(target.href) &&
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

export function sanitizeRequestHeaders(rawHeaders) {
  const source = new Headers();
  for (let index = 0; index < rawHeaders.length; index += 2) source.append(rawHeaders[index], rawHeaders[index + 1]);
  const remove = connectionHeaders(source.get('connection'));
  for (const name of [...source.keys()]) {
    if (remove.has(name) || ['host', 'cookie', 'authorization', 'expect'].includes(name) || name.startsWith('proxy-') || name.startsWith('x-onethu-')) source.delete(name);
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
