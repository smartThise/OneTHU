export const XIAODA_ORIGIN: 'https://www.xiaoda.tsinghua.edu.cn';
export const XIAODA_IDENTITY_URL: string;
export function parseXiaodaLogin(input: string): {
  entry: string;
  redirectPath: string;
  redirectUrl: string;
} | null;
export function xiaodaCallbackUrl(ticket: string): string | null;
export function normalizeXiaodaCallback(input: string): string | null;
export function parseXiaodaTokenExchange(input: string): { ticket: string; type: 0 } | null;
