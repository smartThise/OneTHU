/**
 * 校园网 thos/usereg —— thu-info-lib network.ts 的纯解析层 + RSA 公钥加密
 * （逐字移植；I/O 在 client.ts 挂载。上游服务当前已瘫痪：解析失败由 client 层
 * 统一抛 ServiceUnavailableError，登录页特征仍按会话失效归类）。
 *
 * - RSA：lib loginUsereg 用 jsencrypt 对密码做 RSA(PKCS#1 v1.5) 加密；OneTHU core
 *   不新增依赖，此处以 BigInt + 最小 ASN.1 DER 解析自实现（支持 PKCS#1 RSAPublicKey
 *   与 SPKI SubjectPublicKeyInfo 两种 DER 形态，输出与 jsencrypt 同为 base64 密文）。
 * - 页面解析对照（lib cheerio 选择器）：
 *   /login           meta[name=csrf-token]、#public 公钥、input[name=_csrf-8800]
 *   /home            #w1-container 表 tr[data-key] = 在线设备（td 0-4）；
 *                    #w3-container 首行 td 0-4 = 余额/流量；
 *                    .glyphicon-info-sign 后首个 <a> = 账号状态
 *   /users           #w0 表 td 索引 0/1/2/3/5/6/7 = 账号资料
 *   /user/online-num .glyphicon-exclamation-sign 父节点文本首个数字 = 可认证设备数
 *   /home/delete     #w5-success-0 / #w5-danger-0
 *   /certification   #w0-success-0 / #w0-error-0
 */
import type { NetworkBalance, NetworkDevice } from "./types.js";
import { cellText, innerOfTd, tdCells, tdInners } from "./htmltext.js";

/** lib webVPNTitle：落在 WebVPN 门户页（client 层按会话失效处理） */
export const NETH_WEBVPN_TITLE = "<title>清华大学WebVPN</title>";

/** lib ensureNetworkLoggedIn 判据：出现 loginform-verifycode = 需验证码登录 */
export function nethNeedsVerifyCode(page: string): boolean {
  return page.includes("loginform-verifycode");
}

export function nethLandsWebvpnPortal(page: string): boolean {
  return page.includes(NETH_WEBVPN_TITLE);
}

/** /login 页 meta[name=csrf-token] content（lib $("meta[name=csrf-token]").attr） */
export function parseNethCsrfMeta(page: string): string | undefined {
  const meta = [...page.matchAll(/<meta\b[^>]*>/gi)].find((m) =>
    /\bname\s*=\s*["']csrf-token["']/i.test(m[0] ?? ""),
  )?.[0];
  if (!meta) return undefined;
  return /\bcontent\s*=\s*["']([^"']*)["']/i.exec(meta)?.[1];
}

/** /login 页 input[name=_csrf-8800] value（name/value 两种属性顺序都兼容） */
export function parseNethCsrf8800(page: string): string | undefined {
  const tag = /<input\b[^>]*name=["']_csrf-8800["'][^>]*>/i.exec(page)?.[0];
  if (tag) return /\bvalue=["']([^"']*)["']/i.exec(tag)?.[1];
  const reversed = /<input\b[^>]*value=["']([^"']*)["'][^>]*name=["']_csrf-8800["'][^>]*>/i.exec(page);
  return reversed?.[1];
}

/** /login 页 #public 公钥（input value 属性或 textarea 文本两种形态） */
export function parseNethPublicKey(page: string): string | undefined {
  const input = /<input\b[^>]*id=["']public["'][^>]*>/i.exec(page)?.[0];
  if (input) {
    const v = /\bvalue=["']([^"']*)["']/i.exec(input)?.[1];
    if (v) return v;
  }
  const ta = /<textarea\b[^>]*id=["']public["'][^>]*>([\s\S]*?)<\/textarea>/i.exec(page)?.[1];
  if (ta) return ta.trim();
  return undefined;
}

/** 截取 id 锚点之后到其后第一张表结束的区块（#w1/#w3 容器内即该表） */
function sectionAround(html: string, marker: string): string | null {
  const idx = html.indexOf(marker);
  if (idx < 0) return null;
  const tableEnd = html.indexOf("</table>", idx);
  if (tableEnd < 0) return html.slice(idx);
  return html.slice(idx, tableEnd + "</table>".length);
}

/**
 * 在线设备（lib getOnlineDevices：#w1-container table tbody tr，td 0-4 依序为
 * v4/v6/上线时间/认证权限/MAC）。容器缺失返回 []（无设备，lib 空集语义）。
 */
export function parseOnlineDevices(homeHtml: string): NetworkDevice[] {
  const section = sectionAround(homeHtml, "w1-container");
  if (section === null) return [];
  const out: NetworkDevice[] = [];
  for (const m of section.matchAll(/<tr\b[^>]*data-key=["']?(\d+)["']?[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = tdInners(m[2] ?? "");
    out.push({
      key: Number(m[1] ?? 0),
      ip4: cellText(cells[0] ?? ""),
      ip6: cellText(cells[1] ?? ""),
      loggedAt: cellText(cells[2] ?? ""),
      authPermission: cellText(cells[3] ?? ""),
      mac: cellText(cells[4] ?? ""),
    });
  }
  return out;
}

/** 主页健康度：w1/w3 容器都没有 = 上游页面结构不存在（client 层抛服务不可用） */
export function nethHomeLooksAlive(homeHtml: string): boolean {
  return homeHtml.includes("w1-container") || homeHtml.includes("w3-container");
}

/**
 * 余额/流量（lib getNetworkBalance：#w3-container 首行 td 0-4 依序为
 * 产品名/已用流量/已用时长/账户余额/结算日期，原文未归一）。
 */
export function parseNetworkBalance(homeHtml: string): NetworkBalance {
  const section = sectionAround(homeHtml, "w3-container");
  if (section === null) throw new Error("上网主页缺少 #w3-container 余额区块（上游页面结构变化）");
  const firstRow = /<tr\b[^>]*>([\s\S]*?)<\/tr>/i.exec(section)?.[1] ?? "";
  const cells = tdInners(firstRow);
  return {
    productName: cellText(cells[0] ?? ""),
    usedBytes: cellText(cells[1] ?? ""),
    usedSeconds: cellText(cells[2] ?? ""),
    accountBalance: cellText(cells[3] ?? ""),
    settlementDate: cellText(cells[4] ?? ""),
  };
}

/** 账号状态（lib getNetworkAccountInfo：.glyphicon-info-sign 父节点内 <a> 文本） */
export function parseNethStatus(homeHtml: string): string {
  const idx = homeHtml.indexOf("glyphicon-info-sign");
  if (idx < 0) return "";
  const chunk = homeHtml.slice(idx, idx + 600);
  const m = /<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(chunk);
  return m === null ? "" : cellText(m[1] ?? "");
}

/** 账号资料（lib getNetworkAccountInfo：#w0 表 td 索引 0/1/2/3/5/6/7） */
export function parseNethAccountInfo(usersHtml: string): {
  username: string;
  contactEmail: string;
  contactPhone: string;
  contactLandline: string;
  realName: string;
  userGroup: string;
  location: string;
} {
  const section = sectionAround(usersHtml, 'id="w0"') ?? sectionAround(usersHtml, "id=w0");
  if (section === null && !usersHtml.includes("<td")) {
    throw new Error("上网账号资料页无 #w0 数据表（上游页面结构变化）");
  }
  const tds = (section ?? "").length > 0 ? tdCells(section ?? "") : [];
  const at = (i: number): string => {
    const td = tds[i];
    return td === undefined ? "" : cellText(innerOfTd(td));
  };
  return {
    username: at(0),
    contactEmail: at(1),
    contactPhone: at(2),
    location: at(3),
    contactLandline: at(5),
    realName: at(6),
    userGroup: at(7),
  };
}

/** 可认证设备数（lib：.glyphicon-exclamation-sign 父节点文本首个数字，缺省 0） */
export function parseNethAllowedDevices(onlineNumHtml: string): number {
  const idx = onlineNumHtml.indexOf("glyphicon-exclamation-sign");
  if (idx < 0) return 0;
  const text = cellText(onlineNumHtml.slice(idx, idx + 600));
  const m = /(\d+)/.exec(text);
  return m === null ? 0 : Number(m[1]);
}

/**
 * 操作结果判读（lib logoutNetwork / loginNetwork）：命中 success-0 锚 → 成功；
 * 锚点后区块文本按空行分段取第 2 段（lib .text().split("\n\n")[1] 等价，缺省
 * 回退第 1 段）；两者皆无 → null（调用方抛 Unknown error）。
 */
export function parseNethActionResult(
  html: string,
  scope: "w0" | "w5",
): { ok: boolean; message: string } | null {
  const okIdx = html.indexOf(`${scope}-success-0`);
  const errIdx = html.indexOf(`${scope}-error-0`);
  if (okIdx < 0 && errIdx < 0) return null;
  const idx = okIdx >= 0 ? okIdx : errIdx;
  const raw = html
    .slice(idx, idx + 1500)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+/g, " ");
  const parts = raw.split(/\n{2,}/);
  return { ok: okIdx >= 0, message: (parts[1] ?? parts[0] ?? "").trim() };
}

/* ------------------------- RSA PKCS#1 v1.5（无依赖自实现） ------------------------- */

function base64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, "");
  const len = clean.length;
  const out = new Uint8Array(Math.floor((len / 4) * 3));
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const c0 = B64_IDX(clean[i] ?? "=");
    const c1 = B64_IDX(clean[i + 1] ?? "=");
    const c2 = B64_IDX(clean[i + 2] ?? "=");
    const c3 = B64_IDX(clean[i + 3] ?? "=");
    if (p < out.length) out[p++] = (c0 << 2) | (c1 >> 4);
    if (i + 2 < len && p < out.length) out[p++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    if (i + 3 < len && p < out.length) out[p++] = ((c2 & 0x03) << 6) | c3;
  }
  return out.subarray(0, p);
}

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function B64_IDX(ch: string | undefined): number {
  const i = ch === undefined ? -1 : B64_CHARS.indexOf(ch);
  return i < 0 ? 0 : i;
}

interface DerTlv {
  tag: number;
  content: Uint8Array;
  next: number;
}

/** 最小 DER TLV 读取（短/长长度均支持） */
function derRead(bytes: Uint8Array, pos: number): DerTlv {
  if (pos + 2 > bytes.length) throw new Error("RSA 公钥 DER 截断");
  const tag = bytes[pos] ?? 0;
  let lenByte = bytes[pos + 1] ?? 0;
  let len = lenByte & 0x7f;
  let contentStart = pos + 2;
  if (len === 0x80) throw new Error("RSA 公钥 DER 不支持不定长");
  if ((lenByte & 0x80) !== 0) {
    const n = len;
    len = 0;
    for (let i = 0; i < n; i++) {
      len = len * 256 + (bytes[contentStart + i] ?? 0);
    }
    contentStart += n;
  }
  if (contentStart + len > bytes.length) throw new Error("RSA 公钥 DER 长度越界");
  return { tag, content: bytes.subarray(contentStart, contentStart + len), next: contentStart + len };
}

function os2ip(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

function i2osp(v: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let x = v;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

/** base64 DER（可带 PEM 头）→ {n, e}；兼容 PKCS#1 与 SPKI 两种形态 */
export function parseRsaPublicKeyDer(publicKeyB64: string): { n: bigint; e: bigint } {
  const b64 = publicKeyB64.replace(/-----[^-]*-----/g, "").replace(/\s+/g, "");
  const bytes = base64ToBytes(b64);
  const root = derRead(bytes, 0);
  if (root.tag !== 0x30) throw new Error("RSA 公钥 DER 应以 SEQUENCE 开头");
  const items: DerTlv[] = [];
  for (let pos = 0; pos < root.content.length; ) {
    const tlv = derRead(root.content, pos);
    items.push(tlv);
    pos = tlv.next;
  }
  const ints = items.filter((t) => t.tag === 0x02);
  if (ints.length >= 2) {
    // PKCS#1 RSAPublicKey：SEQ { INT n, INT e }
    const nBytes = ints[0]!.content;
    const eBytes = ints[1]!.content;
    return {
      n: os2ip(nBytes[0] === 0 ? nBytes.subarray(1) : nBytes),
      e: os2ip(eBytes[0] === 0 ? eBytes.subarray(1) : eBytes),
    };
  }
  // SPKI：SEQ { SEQ{alg}, BIT STRING { 00 || RSAPublicKey } }
  const bit = items.find((t) => t.tag === 0x03);
  if (!bit || bit.content.length < 2) throw new Error("RSA 公钥 DER 缺少 BIT STRING");
  const inner = bit.content.subarray(1); // 首字节 = 未用位数
  const seq = derRead(inner, 0);
  if (seq.tag !== 0x30) throw new Error("RSA 公钥 BIT STRING 内非 RSAPublicKey");
  let n = 0n;
  let e = 0n;
  for (let pos = 0, k = 0; pos < seq.content.length && k < 2; k++) {
    const tlv = derRead(seq.content, pos);
    if (tlv.tag !== 0x02) throw new Error("RSA 公钥缺少模数/指数");
    const bytesN = tlv.content;
    const v = os2ip(bytesN[0] === 0 ? bytesN.subarray(1) : bytesN);
    if (k === 0) n = v;
    else e = v;
    pos = tlv.next;
  }
  if (n === 0n || e === 0n) throw new Error("RSA 公钥模数/指数为空");
  return { n, e };
}

function randomNonZeroBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const g = globalThis.crypto;
  if (g && typeof g.getRandomValues === "function") {
    g.getRandomValues(out);
    for (let i = 0; i < n; i++) if (out[i] === 0) out[i] = 1 + ((i * 37) % 254);
  } else {
    for (let i = 0; i < n; i++) out[i] = 1 + Math.floor(Math.random() * 254);
  }
  return out;
}

/**
 * RSA PKCS#1 v1.5 加密（lib jsencrypt encrypt 等价）：EM = 00 || 02 || 非零随机
 * 填充 || 00 || 消息，c = m^e mod n，输出定长 base64 密文。
 */
export function rsaEncryptPkcs1v15(publicKeyB64: string, message: string): string {
  const { n, e } = parseRsaPublicKeyDer(publicKeyB64);
  const k = Math.ceil(n.toString(2).length / 8);
  const m = new TextEncoder().encode(message);
  if (m.length > k - 11) throw new Error("RSA 待加密明文过长");
  const ps = randomNonZeroBytes(k - m.length - 3);
  const em = new Uint8Array(k);
  em[0] = 0x00;
  em[1] = 0x02;
  em.set(ps, 2);
  em[k - m.length - 1] = 0x00;
  em.set(m, k - m.length);
  const c = modPow(os2ip(em), e, n);
  const out = new Uint8Array(k);
  let x = c;
  for (let i = k - 1; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return base64FromBytes(out);
}

// 局部引入 finance 的 base64 编码会形成 info 模块间依赖；此处独立小实现避免环。
function base64FromBytes(bytes: Uint8Array): string {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const has1 = i + 1 < bytes.length;
    const has2 = i + 2 < bytes.length;
    out += A[b0 >> 2];
    out += A[((b0 & 0x03) << 4) | (has1 ? b1 >> 4 : 0)];
    out += has1 ? A[((b1 & 0x0f) << 2) | (has2 ? b2 >> 6 : 0)] : "=";
    out += has2 ? A[b2 & 0x3f] : "=";
  }
  return out;
}
