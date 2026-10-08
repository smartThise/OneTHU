/**
 * 字节数的显示口径（云盘用量等共用一处）。
 * 云盘页与「我的」页的「已用 / 总量」必须同一份实现，否则两处会各写一套小数位。
 */
export function fmtSize(b: number): string {
  if (!Number.isFinite(b) || b < 0) return "-";
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}
