export const THESIS_ORIGIN: 'https://newetds.lib.tsinghua.edu.cn';
export const THESIS_IDENTITY_URL: string;
export function parseThesisLogin(input: string): { entry: string; redirectUrl: string } | null;
export function normalizeThesisCallback(input: string): string | null;
