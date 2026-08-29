/**
 * WebVPN 编码器金标准回归 —— 期望值取自 thu-info-lib 线上验证过的硬编码前缀。
 * 运行：node --experimental-strip-types test/webvpn.smoke.mjs
 */
import { encryptHost, encodeUrl, decodeUrl } from "../src/crypto/webvpn.ts";

const CASES = [
  ["info.tsinghua.edu.cn", "77726476706e69737468656265737421f9f9479369247b59700f81b9991b2631506205de"],
  ["learn.tsinghua.edu.cn", "77726476706e69737468656265737421fcf2408e297e7c4377068ea48d546d30ca8cc97bcc"],
  ["zhjw.cic.tsinghua.edu.cn", "77726476706e69737468656265737421eaff4b8b69336153301c9aa596522b20bc86e6e559a9b290"],
  ["id.tsinghua.edu.cn", "77726476706e69737468656265737421f9f30f8834396657761d88e29d51367bcfe7"],
];

let pass = 0;
for (const [host, expect] of CASES) {
  const got = encryptHost(host);
  const ok = got === expect;
  console.log(ok ? "PASS" : "FAIL", host, ok ? "" : `\n  got:    ${got}\n  expect: ${expect}`);
  if (ok) pass++;
}

const url = "http://zhjwxk.cic.tsinghua.edu.cn/xklogin.do?m=1";
const enc = encodeUrl(url);
const dec = decodeUrl(enc);
const rt = dec === url;
console.log(rt ? "PASS" : "FAIL", "roundtrip:", enc);
console.log(`${pass}/${CASES.length} host cases pass`);
process.exit(pass === CASES.length && rt ? 0 : 1);
