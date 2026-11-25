/**
 * 本机记住密码的加密存储。
 *
 * 旧实现是固定串 XOR+base64——拿到 credentials 文件就能离线还原明文。
 * 这里改为 WebCrypto AES-GCM；密钥是 **non-extractable CryptoKey**，只存在于
 * IndexedDB，不能通过脚本导出。攻击者只拿到 credentials 文件无法解密；
 * 若同时拿到整个应用数据目录（含 IndexedDB）仍可能解密——完整方案需要
 * OS 钥匙串（DPAPI/Keychain/libsecret），这是当前 WebView 能力下的最小改进。
 */

const DB_NAME = "onethu-secure";
const STORE = "keys";
const KEY_ID = "remembered-password-v1";
const PREFIX = "aes-gcm-v1:";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

async function key(): Promise<CryptoKey> {
  const db = await openDb();
  try {
    const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY_ID);
      req.onsuccess = () => resolve(req.result as CryptoKey | undefined);
      req.onerror = () => reject(req.error);
    });
    if (existing) return existing;
    const created = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false, // non-extractable
      ["encrypt", "decrypt"],
    );
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(created, KEY_ID);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return created;
  } finally {
    db.close();
  }
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encryptSecret(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(plain)));
  return PREFIX + b64(iv) + ":" + b64(ct);
}

export async function decryptSecret(stored: string): Promise<string> {
  if (!stored.startsWith(PREFIX)) return "";
  const [ivPart, ctPart] = stored.slice(PREFIX.length).split(":");
  if (!ivPart || !ctPart) return "";
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(ivPart) as BufferSource },
      await key(),
      unb64(ctPart) as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    return "";
  }
}

export function isEncryptedSecret(stored: string): boolean {
  return stored.startsWith(PREFIX);
}
