/** HTTPS browser origins for legacy campus applications. The upstream scheme
 * follows the existing core URL catalog; WebVPN's wire connection stays TLS. */
export const DEFAULT_UPSTREAM_ORIGINS = Object.freeze({
  'https://zhjw.cic.tsinghua.edu.cn': 'http://zhjw.cic.tsinghua.edu.cn',
  'https://myhome.tsinghua.edu.cn': 'http://myhome.tsinghua.edu.cn',
  'https://jxgl.cic.tsinghua.edu.cn': 'http://jxgl.cic.tsinghua.edu.cn',
  'https://yhdf.tsinghua.edu.cn': 'http://yhdf.tsinghua.edu.cn',
  'https://zzjl.graduate.tsinghua.edu.cn': 'http://zzjl.graduate.tsinghua.edu.cn',
});

/** @param {readonly string[]} origins */
export function withSecureCampusOrigins(origins) {
  const result = new Set(origins);
  for (const [alias, upstream] of Object.entries(DEFAULT_UPSTREAM_ORIGINS)) if (result.has(upstream)) result.add(alias);
  return [...result];
}
