export const CAB_ORIGIN: 'https://cab.lib.tsinghua.edu.cn';
export interface CabAuthEntry { entry: string; redirectUrl: string }
export interface CabIdentity extends CabAuthEntry { identityUrl: string; callbackPath: string }
export function parseCabAuthEntry(input: string): CabAuthEntry | null;
export function parseCabIdentity(entry: string, identityUrl: string): CabIdentity | null;
export function normalizeCabCallback(callback: string, entry: string, identityUrl: string): string | null;
export function normalizeCabExchange(input: string, entry: string): string | null;
