export const STU_ORIGIN: 'https://stu.cs.tsinghua.edu.cn';
export function parseStuAuthEntry(input: string): {
  entry: string;
  returnTo: string;
  identityUrl: string;
} | null;
export function validStuCallback(callback: string, entry: string): boolean;
export function normalizeStuCallback(callback: string, entry: string): string | null;
