/** The registered CSNova client. Parse copies; forward the original query. */
export const STU_ORIGIN = 'https://stu.cs.tsinghua.edu.cn';

const ENTRY_PATH = '/api/user/tsinghua-auth-redirect';
const CALLBACK_PATH = '/api/user/tsinghua-auth-callback';
const AUTHORIZE_PATH = '/api/v2/authorize';
const CLIENT_ID = 'RCHFIyPfkGKjXbzxalGZTD79Gl0';
const REDIRECT_URI = STU_ORIGIN + '/csnova/oauth_authorized';
const IDENTITY_FORM = 'https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/084cc75356bf414dcfb0e6e259081f4f/0';
const AUTHORIZE_KEYS = new Set([
  'response_type', 'client_id', 'redirect_uri', 'state', 'nonce', 'status',
  'scope', 'code_challenge', 'code_challenge_method', 'prompt', 'response_mode',
]);

function safeText(value) {
  if (typeof value !== 'string' || value.length > 8192) return false;
  // Nested escaping must not conceal header controls or an alternative path
  // separator. Preserve ordinary percent-encoded state rather than decoding it.
  let text = value;
  for (let depth = 0; depth < 8; depth++) {
    if (/[\x00-\x1f\x7f\\]/.test(text)) return false;
    const decoded = text.replace(/%([0-9a-f]{2})/gi, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
    if (decoded === text) return true;
    text = decoded;
  }
  return false;
}

function uniqueParams(params, allowed) {
  const names = new Set();
  for (const [name, value] of params) {
    if (!allowed.has(name) || names.has(name) || !safeText(value)) return false;
    names.add(name);
  }
  return true;
}

function exactUrl(input, path) {
  if (!safeText(input) || /[\x00-\x20\x7f]/.test(input)
      || !input.startsWith(STU_ORIGIN + path + '?') || input.includes('#')) return null;
  try {
    const url = new URL(input);
    return url.origin === STU_ORIGIN && url.pathname === path && !url.username
      && !url.password && !url.port && url.href === input ? url : null;
  } catch { return null; }
}

/** Validate only the registered local OAuth client; retain byte-exact search. */
export function parseStuAuthEntry(input) {
  const entry = exactUrl(input, ENTRY_PATH);
  if (!entry || !uniqueParams(entry.searchParams, new Set(['returnto']))) return null;
  const returnTo = entry.searchParams.get('returnto');
  if (!returnTo || !returnTo.startsWith(AUTHORIZE_PATH + '?') || returnTo.includes('#')) return null;
  let authorize;
  try { authorize = new URL(returnTo, STU_ORIGIN); } catch { return null; }
  if (authorize.origin !== STU_ORIGIN || authorize.pathname !== AUTHORIZE_PATH
      || authorize.href !== STU_ORIGIN + returnTo
      || !uniqueParams(authorize.searchParams, AUTHORIZE_KEYS)
      || authorize.searchParams.get('response_type') !== 'code'
      || authorize.searchParams.get('client_id') !== CLIENT_ID
      || authorize.searchParams.get('redirect_uri') !== REDIRECT_URI) return null;
  const challenge = authorize.searchParams.get('code_challenge');
  const challengeMethod = authorize.searchParams.get('code_challenge_method');
  if (challenge !== null && !/^[A-Za-z0-9._~-]{43,128}$/.test(challenge)
      || challengeMethod !== null && !['plain', 'S256'].includes(challengeMethod)
      || challengeMethod !== null && challenge === null) return null;
  return {
    entry: input,
    returnTo,
    identityUrl: IDENTITY_FORM + '?' + CALLBACK_PATH + entry.search,
  };
}

/** An official ticket may be handed back only to its original local flow. */
export function validStuCallback(callback, entry) {
  const request = parseStuAuthEntry(entry);
  const target = exactUrl(callback, CALLBACK_PATH);
  if (!request || !target || !uniqueParams(target.searchParams, new Set(['ticket', 'returnto']))) return false;
  const ticket = target.searchParams.get('ticket');
  return target.searchParams.get('returnto') === request.returnTo && ticket !== null
    && /^[A-Za-z0-9._~+/-]{1,4096}={0,2}$/.test(ticket)
    && !/^(?:BAD_CREDENTIALS|ERROR)$/i.test(ticket);
}

/** The university's registered callback still uses HTTP. Upgrade only that
 * exact official service endpoint, retaining its original ticket/query bytes. */
export function normalizeStuCallback(callback, entry) {
  if (typeof callback !== 'string') return null;
  const secure = callback.startsWith('http://stu.cs.tsinghua.edu.cn' + CALLBACK_PATH + '?')
    ? 'https:' + callback.slice('http:'.length) : callback;
  return validStuCallback(secure, entry) ? secure : null;
}
