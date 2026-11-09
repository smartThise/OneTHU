export const DISCOVER_ORIGIN: 'https://discover.lib.tsinghua.edu.cn';
export const DISCOVER_IDP_ORIGIN: 'https://idp.tsinghua.edu.cn';
export const DISCOVER_IDENTITY_URL: 'https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/f2841607a1c6b880847ee635cc5046f0/1';
export const DISCOVER_ACS: string;
export function parseDiscoverLogin(input: string): {
  entry: string;
  targetUrl: string;
  serviceUrl: string;
  startUrl: string;
  language: string | null;
} | null;
export function normalizeDiscoverCallback(input: string): string | null;
export function isDiscoverTransition(input: string, entry: string): boolean;
