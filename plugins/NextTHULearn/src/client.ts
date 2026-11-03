import { LearnClient } from '../../../packages/core/src/learn/client.js';
import type { HttpClient } from '../../../packages/core/src/http.js';

// The OneTHU client owns parsing, pagination and session classification. The
// browser owns cookies; this adapter only permits same-origin Learn traffic.
export function directUrl(raw: string): string {
  const u = new URL(raw, location.origin);
  const prefix = '/https/77726476706e69737468656265737421fcf2408e297e7c4377068ea48d546d30ca8cc97bcc';
  if (u.hostname === 'webvpn.tsinghua.edu.cn' && u.pathname.startsWith(prefix + '/')) {
    u.pathname = u.pathname.slice(prefix.length); u.host = location.host; u.protocol = location.protocol;
  }
  if (u.origin !== location.origin) throw new Error('不允许访问网络学堂以外的地址');
  return u.href;
}
export function originalUrl(raw: string): string {
  const u = new URL(directUrl(raw));
  u.searchParams.delete('_csrf');
  if (u.pathname.startsWith('/f/')) u.searchParams.set('ntl', 'original');
  return u.href;
}
let active = 0;
const waiting: Array<() => void> = [];
async function limited<T>(work: () => Promise<T>): Promise<T> {
  if (active >= 4) await new Promise<void>(resolve => waiting.push(resolve));
  else active++;
  try { return await work(); } finally { const next = waiting.shift(); if (next) next(); else active--; }
}
const transport = {
  webVPNEncoder: null,
  async request(url: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.delete('Referer');
    const response = await limited(() => fetch(directUrl(url), {...init, headers, credentials: 'same-origin'}));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  },
  async text(url: string, init: RequestInit = {}) { return (await this.request(url, init)).text(); },
  async postForm(url: string, body: FormData | URLSearchParams) { return this.text(url, {method:'POST',body,headers:{'X-Requested-With':'XMLHttpRequest'}}); },
};
export const client = new LearnClient(transport as unknown as HttpClient);

export function resourceUrl(raw: string): string {
  const u = new URL(directUrl(raw));
  if (u.pathname.startsWith('/b/') && client.csrfToken) u.searchParams.set('_csrf', client.csrfToken);
  return u.href;
}
