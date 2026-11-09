/** Commit a verified service transaction without replacing unrelated sessions. */
import { webvpnWrap, type CookieJar, type CookieRecord } from '@onethu/core';

function cookieKey(cookie: CookieRecord): string {
  return `${cookie.domain}|${cookie.path}|${cookie.name}`;
}

export function mergeServiceCookies(shared: CookieJar, candidate: CookieJar, beforeSnapshot: string, origin: string): void {
  const host = new URL(origin).hostname;
  const prefixes = ['http:', 'https:'].map(scheme => new URL(webvpnWrap(`${scheme}//${host}/`)).pathname.replace(/\/$/, ''));
  const belongs = (cookie: CookieRecord) => cookie.domain === host || cookie.domain === 'webvpn.tsinghua.edu.cn'
    && prefixes.some(prefix => cookie.path === prefix || cookie.path.startsWith(prefix + '/'));
  const now = Date.now();
  const snapshot = (text: string, activeOnly = false) => new Map((JSON.parse(text) as CookieRecord[])
    .filter(cookie => belongs(cookie) && (!activeOnly || cookie.expiresAt === undefined || cookie.expiresAt > now))
    .map(cookie => [cookieKey(cookie), cookie]));
  const before = snapshot(beforeSnapshot);
  const incoming = snapshot(candidate.serialize(), true);
  const merged = new Map((JSON.parse(shared.serialize()) as CookieRecord[]).map(cookie => [cookieKey(cookie), cookie]));
  for (const key of new Set([...before.keys(), ...incoming.keys()])) {
    const previous = JSON.stringify(before.get(key));
    const next = incoming.get(key);
    // An unchanged candidate contributes nothing. A concurrent shared update
    // owns its value even when this transaction changes or removes that key.
    if (JSON.stringify(next) === previous || JSON.stringify(merged.get(key)) !== previous) continue;
    if (next) merged.set(key, next);
    else merged.delete(key);
  }
  shared.hydrate(JSON.stringify([...merged.values()]));
}
