/** The library room service's registered identity flow and per-browser nonce. */
export const CAB_ORIGIN = 'https://cab.lib.tsinghua.edu.cn';
const ENTRY_PATH = '/authcenter/toLoginPage';
const ID_FORM = 'https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/979ef8ab2cb121846385bad28db48fac/0';
const CALLBACK_PATH = /^\/authcenter\/doAuth\/[a-f0-9]{32}$/i;

function safeText(value) {
  if (typeof value !== 'string' || !value || value.length > 8192) return false;
  let text = value;
  for (let count = 0; count < 8; count++) {
    if (/[\x00-\x1f\x7f\\]/.test(text)) return false;
    const decoded = text.replace(/%([0-9a-f]{2})/gi, (_match, byte) => String.fromCharCode(Number.parseInt(byte, 16)));
    if (decoded === text) return true;
    text = decoded;
  }
  return false;
}

function strictUrl(input, origin) {
  if (!safeText(input) || /[\x00-\x20\x7f]/.test(input) || input.includes('#') || !input.startsWith(origin + '/')) return null;
  try {
    const url = new URL(input);
    return url.origin === origin && !url.port && !url.username && !url.password && url.href === input ? url : null;
  } catch { return null; }
}

function uniqueParams(params, allowed) {
  const keys = new Set();
  for (const [key, value] of params) {
    if (!allowed.has(key) || keys.has(key) || value && !safeText(value)) return false;
    keys.add(key);
  }
  return true;
}

/** Accept only a service-issued browser token callback, retaining raw bytes. */
export function parseCabAuthEntry(input) {
  const entry = strictUrl(input, CAB_ORIGIN);
  if (!entry || entry.pathname !== ENTRY_PATH || !uniqueParams(entry.searchParams, new Set(['redirectUrl', 'extInfo']))) return null;
  const redirectUrl = entry.searchParams.get('redirectUrl');
  if (!redirectUrl || entry.searchParams.get('extInfo') !== '') return null;
  const destination = strictUrl(redirectUrl, CAB_ORIGIN);
  if (!destination || !/^\/ic-web\/{1,2}auth\/token$/.test(destination.pathname)
      || !uniqueParams(destination.searchParams, new Set(['uuid']))
      || !/^[a-f0-9]{32}$/i.test(destination.searchParams.get('uuid') ?? '')) return null;
  return { entry: input, redirectUrl };
}

/** The actual ID URL is observed from this entry's official 302 response. */
export function parseCabIdentity(entry, identityUrl) {
  const request = parseCabAuthEntry(entry);
  const identity = strictUrl(identityUrl, 'https://id.tsinghua.edu.cn');
  if (!request || !identity || identity.pathname !== new URL(ID_FORM).pathname) return null;
  const callbackPath = identity.search.slice(1);
  if (!CALLBACK_PATH.test(callbackPath) || identityUrl !== ID_FORM + '?' + callbackPath) return null;
  return { ...request, identityUrl, callbackPath };
}

/** Upgrade only the school's fixed callback to HTTPS and keep its ticket intact. */
export function normalizeCabCallback(callback, entry, identityUrl) {
  const request = parseCabIdentity(entry, identityUrl);
  if (!request || typeof callback !== 'string') return null;
  const expectedPath = request.callbackPath;
  const secure = callback.startsWith('http://cab.lib.tsinghua.edu.cn' + expectedPath + '?')
    ? 'https:' + callback.slice('http:'.length) : callback;
  const target = strictUrl(secure, CAB_ORIGIN);
  if (!target || target.pathname !== expectedPath || !uniqueParams(target.searchParams, new Set(['ticket']))) return null;
  const ticket = target.searchParams.get('ticket');
  if (!ticket || !/^[A-Za-z0-9._~+/-]{1,4096}={0,2}$/.test(ticket) || /^(?:ERROR|BAD_CREDENTIALS)$/i.test(ticket)) return null;
  return secure;
}

/** The callback issues a second one-use token for the original browser UUID.
 * Only the account transport may follow it; retain the exact official URL. */
export function normalizeCabExchange(input, entry) {
  const request = parseCabAuthEntry(entry);
  const target = strictUrl(input, CAB_ORIGIN);
  if (!request || !target || !/^\/ic-web\/{1,2}auth\/token$/.test(target.pathname)
      || !uniqueParams(target.searchParams, new Set(['uuid', 'uniToken']))) return null;
  const expected = new URL(request.redirectUrl);
  if (target.searchParams.get('uuid') !== expected.searchParams.get('uuid')) return null;
  const token = target.searchParams.get('uniToken');
  if (!token || !/^[A-Za-z0-9._~+/-]{1,4096}={0,2}$/.test(token)
      || /^(?:ERROR|BAD_CREDENTIALS)$/i.test(token)) return null;
  return input;
}
