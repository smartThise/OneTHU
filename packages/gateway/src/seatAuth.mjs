/** ISeating's registered university identity callback. */
export const SEAT_ORIGIN = 'https://seat.lib.tsinghua.edu.cn';
export const SEAT_IDENTITY_URL = 'https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/ef84f6d6784f6b834e5214f432d6173f/0?/api/id_tsinghua_callback';
const HTTP_ORIGIN = 'http://seat.lib.tsinghua.edu.cn';
const CALLBACK_PATH = '/api/id_tsinghua_callback';

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

/** Retain the school's wire scheme. A private transport consumes the ticket. */
export function normalizeSeatCallback(input) {
  if (!safeText(input) || /[\x00-\x20\x7f]/.test(input) || input.includes('#')) return null;
  const origin = input.startsWith(SEAT_ORIGIN + CALLBACK_PATH + '?') ? SEAT_ORIGIN
    : input.startsWith(HTTP_ORIGIN + CALLBACK_PATH + '?') ? HTTP_ORIGIN : null;
  if (!origin) return null;
  let url;
  try { url = new URL(input); } catch { return null; }
  if (url.origin !== origin || url.pathname !== CALLBACK_PATH || url.port || url.username || url.password || url.href !== input) return null;
  const parameters = [...url.searchParams];
  if (parameters.length !== 1 || parameters[0][0] !== 'ticket') return null;
  const ticket = parameters[0][1];
  if (!/^[A-Za-z0-9._~+/-]{1,4096}={0,2}$/.test(ticket) || /^(?:ERROR|BAD_CREDENTIALS)$/i.test(ticket)) return null;
  return input;
}
