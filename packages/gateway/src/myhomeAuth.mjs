/** MyHome's legacy Netweb service redeems its school ticket over WebVPN HTTP. */
export const MYHOME_ORIGIN = 'https://myhome.tsinghua.edu.cn';
export const MYHOME_IDENTITY_URL = 'https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/0a993de7e533cd43a594459abdcab27d/1';
const HTTP_ORIGIN = 'http://myhome.tsinghua.edu.cn';

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

/** Only the registered root ticket callback may enter the private HTTP route.
 * Preserve the original double slash and raw ticket encoding during conversion. */
export function normalizeMyhomeCallback(input) {
  if (!safeText(input) || /[\x00-\x20\x7f]/.test(input) || input.includes('#')) return null;
  const origin = input.startsWith(HTTP_ORIGIN + '/') ? HTTP_ORIGIN
    : input.startsWith(MYHOME_ORIGIN + '/') ? MYHOME_ORIGIN : null;
  if (!origin) return null;
  let url;
  try { url = new URL(input); } catch { return null; }
  if (url.origin !== origin || url.port || url.username || url.password || url.href !== input
      || !['/', '//'].includes(url.pathname)) return null;
  const entries = [...url.searchParams];
  if (entries.length !== 1 || entries[0][0] !== 'ticket') return null;
  const ticket = entries[0][1];
  if (!/^[A-Za-z0-9._~+/-]{1,4096}={0,2}$/.test(ticket)
      || /^(?:ERROR|BAD_CREDENTIALS)$/i.test(ticket)) return null;
  return HTTP_ORIGIN + input.slice(origin.length);
}
