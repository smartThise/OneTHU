/** Registered sign-in and callback contract for the university thesis service. */
export const THESIS_ORIGIN = 'https://newetds.lib.tsinghua.edu.cn';
export const THESIS_IDENTITY_URL = 'https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/4bf1579bc0410fc7dff3fd1db40d399e/0?/qh/thesis/tsinghua/Login';
const LOGIN_PATH = '/qh/thesis/toLogin/';
const CALLBACK_PATH = '/qh/thesis/tsinghua/Login';
const DEFAULT_RETURN_PATH = '/qh/qhSearch/QbIndex';

function serviceUrl(input) {
  if (typeof input !== 'string' || input.length > 8192 || /[\x00-\x20\x7f\\]/.test(input) || input.includes('#')) return null;
  try {
    const url = new URL(input);
    return url.origin === THESIS_ORIGIN && !url.username && !url.password && !url.port && url.href === input ? url : null;
  } catch { return null; }
}

function uniqueParams(params, allowed) {
  const seen = new Set();
  for (const key of params.keys()) {
    if (!allowed.includes(key) || seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function safeReturnPath(value) {
  if (typeof value !== 'string' || value.length > 4096 || !value.startsWith('/')) return false;
  let decoded = value;
  for (let depth = 0; depth < 8; depth++) {
    if (decoded.startsWith('//') || /[\x00-\x1f\x7f\\]/.test(decoded) || /%(?![a-f0-9]{2})/i.test(decoded)) return false;
    const pathname = decoded.split(/[?#]/, 1)[0];
    if (pathname.split('/').some(part => part === '.' || part === '..')
      || /\/thesis\/(?:toLogin|tsinghua\/Login|logout|logoff)(?:\/|$)/i.test(pathname)) return false;
    const next = decoded.replace(/%([a-f0-9]{2})/gi, (encoded, hex) => {
      const byte = Number.parseInt(hex, 16);
      return byte < 128 ? String.fromCharCode(byte) : encoded;
    });
    if (next === decoded) {
      try {
        const url = new URL(value, THESIS_ORIGIN);
        return url.origin === THESIS_ORIGIN && !url.username && !url.password && !url.hash;
      } catch { return false; }
    }
    decoded = next;
  }
  return false;
}

export function parseThesisLogin(input) {
  const url = serviceUrl(input);
  if (!url || url.pathname !== LOGIN_PATH || !uniqueParams(url.searchParams, ['loginto', 'beforepage'])
    || url.searchParams.get('loginto') !== 'tsinghua') return null;
  const redirectPath = url.searchParams.get('beforepage') || DEFAULT_RETURN_PATH;
  if (!safeReturnPath(redirectPath)) return null;
  return { entry: input, redirectUrl: new URL(redirectPath, THESIS_ORIGIN).href };
}

/** Normalize only the registered callback. Ticket bytes remain unchanged. */
export function normalizeThesisCallback(input) {
  if (typeof input !== 'string') return null;
  const secure = input.startsWith('http://newetds.lib.tsinghua.edu.cn' + CALLBACK_PATH + '?')
    ? 'https:' + input.slice('http:'.length) : input;
  const url = serviceUrl(secure);
  if (!url || url.pathname !== CALLBACK_PATH || !/^\?ticket=/.test(url.search)
    || !uniqueParams(url.searchParams, ['ticket'])) return null;
  const ticket = url.searchParams.get('ticket');
  return ticket && /^[A-Za-z0-9._~+/-]{1,4096}={0,2}$/.test(ticket)
    && !/^(?:ERROR|BAD_CREDENTIALS)$/i.test(ticket) ? secure : null;
}
