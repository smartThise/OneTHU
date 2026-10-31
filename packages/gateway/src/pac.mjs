import { isIP } from 'node:net';
import { GatewayError, normalizeAllowedOrigins, isCampusIdentityHost } from './policy.mjs';

const invalid = () => { throw new GatewayError('GATEWAY_PROXY_FALLBACK_INVALID', 400); };
function proxy(value, kind) {
  if (value == null) return null;
  if (typeof value.host !== 'string' || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) invalid();
  const host = value.host;
  if (!isIP(host) && (!/^[A-Za-z0-9.-]{1,253}$/.test(host) || host.split('.').some(part => !part || part.startsWith('-') || part.endsWith('-')))) invalid();
  return `${kind} ${isIP(host) === 6 ? `[${host}]` : host}:${value.port}`;
}
function bypassEntry(value) {
  if (typeof value !== 'string' || !value || value.length > 253 || /[\x00-\x20\x7f]/.test(value)) invalid();
  if (value === '<local>') return { local: true };
  if (value.includes('/')) {
    const [ip, prefix, extra] = value.split('/');
    // macOS ships abbreviated defaults such as 169.254/16.
    const parts = ip.split('.');
    if (extra !== undefined || parts.length > 4 || parts.some(part => !/^(?:0|[1-9][0-9]{0,2})$/.test(part) || Number(part) > 255) || !/^(?:[0-9]|[12][0-9]|3[0-2])$/.test(prefix)) invalid();
    while (parts.length < 4) parts.push('0');
    const bits = Number(prefix), mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    const maskText = [24, 16, 8, 0].map(shift => mask >>> shift & 255).join('.');
    return { network: parts.join('.'), mask: maskText };
  }
  if (!/^[A-Za-z0-9.*?:\[\]-]+$/.test(value)) invalid();
  return { pattern: value.toLowerCase() };
}

/** Campus hosts never fall back to an unauthenticated direct connection.
 * Non-campus rules reproduce the selected network service's original manual
 * proxy and bypass configuration, without evaluating another app's PAC code. */
export function createPacScript(origins, endpoint, fallback = {}, { campusPassthrough = false, trustedClients = false } = {}) {
  const allowed = [...normalizeAllowedOrigins(origins)];
  if (endpoint.host !== '127.0.0.1' || !Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) invalid();
  // Identity pages retain the user's original proxy/bypass route, including
  // Clash. Do not force DIRECT or let custom allowlists intercept their login.
  const hosts = [...new Set(allowed.map(origin => new URL(origin).hostname))].filter(host => !isCampusIdentityHost(host));
  const rules = { http: proxy(fallback.http, 'PROXY'), https: proxy(fallback.https, 'PROXY'), socks: proxy(fallback.socks, 'SOCKS5') };
  const exclusions = fallback.bypass ?? [];
  if (!Array.isArray(exclusions) || exclusions.length > 256) invalid();
  const bypass = exclusions.map(bypassEntry);
  return `function FindProxyForURL(url, host) {
  var hosts = ${JSON.stringify(hosts)};
  var rules = ${JSON.stringify(rules)};
  var bypass = ${JSON.stringify(bypass)};
  host = host.toLowerCase();
  ${trustedClients ? `if (url.substring(0, 6).toLowerCase() === "https:" && host === "id.tsinghua.edu.cn") return "PROXY 127.0.0.1:${endpoint.port}";` : ''}
  for (var i = 0; i < hosts.length; i++) {
    if (host === hosts[i]) return "PROXY 127.0.0.1:${endpoint.port}";
  }
  ${campusPassthrough ? `if (url.substring(0, 6).toLowerCase() === "https:" && /\\.tsinghua\\.edu\\.cn$/.test(host) && host !== "id.tsinghua.edu.cn" && host !== "oauth.tsinghua.edu.cn" && host !== "webvpn.tsinghua.edu.cn") return "PROXY 127.0.0.1:${endpoint.port}";` : ''}
  for (var j = 0; j < bypass.length; j++) {
    var rule = bypass[j];
    if (rule.local && isPlainHostName(host)) return "DIRECT";
    if (rule.pattern && shExpMatch(host, rule.pattern)) return "DIRECT";
    if (rule.network && isInNet(host, rule.network, rule.mask)) return "DIRECT";
  }
  var scheme = url.substring(0, url.indexOf(":")).toLowerCase();
  return (scheme === "https" ? rules.https : scheme === "http" ? rules.http : null) || rules.socks || "DIRECT";
}
`;
}
