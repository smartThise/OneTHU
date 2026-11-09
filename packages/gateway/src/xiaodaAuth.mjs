/** Website routing contract shared with the existing Qingxiaoda ticket broker.
 * These validators check shape only. Tickets must originate in the private
 * same-account broker before a browser exchange can be authorized. */
export const XIAODA_ORIGIN = 'https://www.xiaoda.tsinghua.edu.cn';
export const XIAODA_IDENTITY_URL = 'https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/d982b795884e882abfa8ff3167aeb03e/0?/login.html';

function cleanOuterUrl(input) {
  if (typeof input !== 'string' || input.length > 8192 || /[\x00-\x20\x7f\\]/.test(input) || input.includes('#')) return null;
  try {
    const url = new URL(input);
    return url.origin === XIAODA_ORIGIN && !url.username && !url.password && !url.port && url.href === input ? url : null;
  } catch { return null; }
}
function uniqueParams(params, keys) {
  const seen = new Set();
  for (const key of params.keys()) {
    if (!keys.includes(key) || seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}
function validTicket(ticket) {
  return typeof ticket === 'string' && /^[A-Za-z0-9._~+/-]{1,4096}={0,2}$/.test(ticket)
    && !/^(?:ERROR|BAD_CREDENTIALS)$/i.test(ticket);
}
function safeRelative(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > 4096) return false;
  let decoded = value;
  for (let depth = 0; depth < 8; depth++) {
    if (/[\x00-\x1f\x7f\\]/.test(decoded) || decoded.startsWith('//')) return false;
    const path = decoded.split(/[?#]/, 1)[0];
    if (path.split('/').some(part => part === '.' || part === '..')
      || /^\/(?:login(?:\.html)?(?:\/|$)|api\/token\/(?:login|logout)(?:\/|$))/i.test(path)) return false;
    const next = decoded.replace(/%([0-9a-f]{2})/gi, (encoded, hex) => {
      const code = Number.parseInt(hex, 16);
      return code < 128 ? String.fromCharCode(code) : encoded;
    });
    if (next === decoded) {
      try { return new URL(value, XIAODA_ORIGIN).origin === XIAODA_ORIGIN; } catch { return false; }
    }
    decoded = next;
  }
  return false;
}

export function parseXiaodaLogin(input) {
  const url = cleanOuterUrl(input);
  if (!url || url.pathname !== '/login' || !uniqueParams(url.searchParams, ['redirect'])) return null;
  const redirectPath = url.searchParams.get('redirect') || '/';
  if (!safeRelative(redirectPath)) return null;
  return { entry: input, redirectPath, redirectUrl: new URL(redirectPath, XIAODA_ORIGIN).href };
}

export function xiaodaCallbackUrl(ticket) {
  return validTicket(ticket) ? XIAODA_ORIGIN + '/login.html?' + new URLSearchParams({ ticket }) : null;
}

export function normalizeXiaodaCallback(input) {
  const url = cleanOuterUrl(input);
  if (!url || url.pathname !== '/login.html' || !uniqueParams(url.searchParams, ['ticket'])) return null;
  return xiaodaCallbackUrl(url.searchParams.get('ticket'));
}

export function parseXiaodaTokenExchange(input) {
  const url = cleanOuterUrl(input);
  if (!url || url.pathname !== '/api/token/login' || !uniqueParams(url.searchParams, ['ticket', 'type'])
    || url.searchParams.has('type') && url.searchParams.get('type') !== '0') return null;
  const ticket = url.searchParams.get('ticket');
  return validTicket(ticket) ? { ticket, type: 0 } : null;
}
