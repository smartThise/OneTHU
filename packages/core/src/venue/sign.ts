/**
 * 体育场馆系统（sports.tsinghua.edu.cn unifound-venue）请求签名。
 *
 * 逆向自前端 bundle（getKeys/getSign，2026-08-31 抓包逐字验证）：
 * - key = getKeys() 三段拼接：57325972627 + c40bd8c + 77296d39293705
 * - sign = md5(`appId=${appId}&nonce=${nonce}&timeStamp=${ts}&key=${key}`)
 * - 每个请求的 query 必带 appId / timeStamp / nonce / sign，缺签一律拒绝
 */

/** 纯 TS MD5（RFC 1321；无依赖，返回 32 位小写 hex） */
export function md5hex(input: string): string {
  return md5Bytes(new TextEncoder().encode(input));
}

function md5Bytes(bytes: Uint8Array): string {
  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K = new Int32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);

  // 预处理：append 0x80, pad zeros, 64-bit little-endian bit length
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, bitLen >>> 0, true);
  dv.setUint32(padded.length - 4, Math.floor(bitLen / 4294967296), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const M = new Int32Array(16);
  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getInt32(chunk + i * 4, true);
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i]! + M[g]!) | 0;
      A = D;
      D = C;
      C = B;
      B = (B + ((F << s[i]!) | (F >>> (32 - s[i]!)))) | 0;
    }
    a0 = (a0 + A) | 0;
    b0 = (b0 + B) | 0;
    c0 = (c0 + C) | 0;
    d0 = (d0 + D) | 0;
  }
  // 摘要 = 四个字的 little-endian 字节序（RFC 1321）
  const out = new Uint8Array(16);
  const dvOut = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((w, i) => dvOut.setUint32(i * 4, w >>> 0, true));
  return [...out].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const VENUE_APP_ID = "1497016617475903488";
/** getKeys() 三段拼接（前端混淆常量，抓包验证 2026-08-31） */
export const VENUE_SIGN_KEY = "57325972627c40bd8c77296d39293705";

const NONCE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function randomNonce(len = 32): string {
  let out = "";
  for (let i = 0; i < len; i++) out += NONCE_CHARS[Math.floor(Math.random() * NONCE_CHARS.length)];
  return out;
}

/** 一次签名（每次请求重新生成；timeStamp 毫秒） */
export function buildVenueSign(now = Date.now()): { appId: string; timeStamp: number; nonce: string; sign: string } {
  const appId = VENUE_APP_ID;
  const timeStamp = now;
  const nonce = randomNonce();
  const raw = `appId=${appId}&nonce=${nonce}&timeStamp=${timeStamp}&key=${VENUE_SIGN_KEY}`;
  return { appId, timeStamp, nonce, sign: md5hex(raw) };
}

/** 追加到请求 URL 的签名 query 串（不 encoding，与前端行为一致） */
export function venueSignQuery(now = Date.now()): string {
  const s = buildVenueSign(now);
  return `appId=${s.appId}&timeStamp=${s.timeStamp}&nonce=${s.nonce}&sign=${s.sign}`;
}
