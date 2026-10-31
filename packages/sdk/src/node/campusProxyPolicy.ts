import { GatewayError } from '@onethu/gateway/policy';

const reject = (): never => { throw new GatewayError('GATEWAY_AUTH_REQUIRED', 401); };
const IDENTITY_HOSTS = new Set(['id.tsinghua.edu.cn', 'oauth.tsinghua.edu.cn']);
const LEARN_AUTH_ACTIONS = new Set([
  'j_spring_security_check', 'j_spring_security_logout', 'j_spring_security_thauth_roaming_entry',
]);
const INFO_ROAM = '/b/yyfw/vyyfwxx/info/portal_fg/common/onlineappredirect';

/** Decode ASCII routing syntax without rejecting legacy non-UTF-8 filenames.
 * This is only a policy view; the original request URL is never rewritten. */
function routingText(input: string): string {
  let value = input;
  for (let count = 0; count < 8; count++) {
    const decoded = value.replace(/%([0-9a-f]{2})/gi, (encoded, hex: string) => {
      const byte = Number.parseInt(hex, 16);
      return byte < 128 ? String.fromCharCode(byte) : encoded;
    });
    if (decoded === value) {
      if (/[\x00-\x1f\x7f]/.test(value)) reject();
      return value.toLowerCase();
    }
    value = decoded;
  }
  // Unusually deep escaping must not hide an account-control endpoint.
  return reject();
}

function routePath(pathname: string): string {
  const segments: string[] = [];
  for (const segment of routingText(pathname).replaceAll('\\', '/').split('/')) {
    // Java servlet matrix parameters do not change the underlying action.
    const name = segment.split(';', 1)[0]!;
    if (!name || name === '.') continue;
    if (name === '..') segments.pop();
    else segments.push(name);
  }
  return '/' + segments.join('/');
}

/** The browser may perform campus business operations, but authentication and
 * ticket redemption belong to the SDK account authority. Call before fetching
 * so rejected responses cannot change its cookie jar under an unchanged epoch.
 * Keep these hosts in PAC scope: removing them would fall back to DIRECT. */
export function assertCampusBrowserTarget(target: URL, method = 'GET'): void {
  const host = target.hostname.toLowerCase();
  if (IDENTITY_HOSTS.has(host)) reject();
  const path = routePath(target.pathname);
  const segments = path.split('/');
  if (host === 'learn.tsinghua.edu.cn') {
    // core/auth/cas.ts LEARN_LOGOUT/LEARN_ROAM and Learn's credential form.
    if (path === '/f/login' || path.startsWith('/f/login/') || segments.some(segment => LEARN_AUTH_ACTIONS.has(segment))) reject();
  } else if (host === 'info.tsinghua.edu.cn') {
    // The same portal endpoint also handles ordinary yyfwid navigation.
    if ((path === INFO_ROAM || path.startsWith(INFO_ROAM + '/')) &&
        (!['GET', 'HEAD'].includes(method.toUpperCase()) || [...target.searchParams.keys()].some(name => routingText(name) === 'ticket'))) reject();
  } else if (host === 'zhjwxk.cic.tsinghua.edu.cn' && segments.includes('j_acegi_formlogin_xsxk.do')) {
    // info-lib/constants/strings.ts CR_LOGIN_SUBMIT_URL.
    reject();
  }
}
