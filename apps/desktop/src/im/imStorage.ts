/**
 * 「AES-GCM 信封 + PBKDF2 派生密钥」的通用加密存储器——加解密算法与安全
 * 口径逐行照抄 state/exthw.ts（外部作业源那套），参数化为可复用叶子：
 * 明文对象整体 JSON 序列化后加密，localStorage 里只有 {v,iv,ct} 信封。
 */
import { useEffect, useState } from "react";

const subtle: SubtleCrypto | undefined =
  typeof crypto !== "undefined" ? (crypto.subtle as SubtleCrypto | undefined) : undefined;

function b64encode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 密文信封（落盘的唯一形态） */
interface Envelope {
  v: 1;
  /** base64(iv)，12 字节 */
  iv: string;
  /** base64(ciphertext) */
  ct: string;
}

export class ImStorage<T extends object> {
  private snapshotValue: T | null = null;
  private loading: Promise<T> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly key: string,
    private readonly saltKey: string,
    private readonly kdfPass: string,
    private readonly kdfIter: number,
    private readonly fallback: () => T,
  ) {}

  /* ── 订阅（useSyncExternalStore/useState 皆可消费） ── */
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  snapshot(): T | null {
    return this.snapshotValue;
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  /* ── WebCrypto（与 exthw 相同的三段式） ── */

  private getOrCreateSalt(): Uint8Array {
    try {
      const cur = localStorage.getItem(this.saltKey);
      if (cur) {
        const bytes = b64decode(cur);
        if (bytes.length >= 8) return bytes;
      }
    } catch {
      /* 忽略，重建 */
    }
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    try {
      localStorage.setItem(this.saltKey, b64encode(salt));
    } catch {
      /* 存储不可用：salt 仅本次会话内有效 */
    }
    return salt;
  }

  private async deriveKey(salt: Uint8Array): Promise<CryptoKey> {
    if (!subtle) throw new Error("当前环境不支持 WebCrypto");
    const base = await subtle.importKey("raw", new TextEncoder().encode(this.kdfPass), "PBKDF2", false, [
      "deriveKey",
    ]);
    return subtle.deriveKey(
      { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: this.kdfIter, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  private async encrypt(value: T): Promise<Envelope> {
    if (!subtle) throw new Error("当前环境不支持 WebCrypto");
    const key = await this.deriveKey(this.getOrCreateSalt());
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    const data = new TextEncoder().encode(JSON.stringify(value));
    const ct = await subtle.encrypt({ name: "AES-GCM", iv: iv as unknown as BufferSource }, key, data);
    return { v: 1, iv: b64encode(iv), ct: b64encode(new Uint8Array(ct)) };
  }

  private async decrypt(env: Envelope): Promise<T> {
    if (!subtle) throw new Error("当前环境不支持 WebCrypto");
    const key = await this.deriveKey(this.getOrCreateSalt());
    const pt = await subtle.decrypt(
      { name: "AES-GCM", iv: b64decode(env.iv) as unknown as BufferSource },
      key,
      b64decode(env.ct) as unknown as BufferSource,
    );
    const j = JSON.parse(new TextDecoder().decode(pt)) as T;
    return j && typeof j === "object" ? j : this.fallback();
  }

  /* ── 读写（内存快照 + 变更广播；解密失败按未配置对待，不炸启动） ── */

  async load(): Promise<T> {
    if (this.snapshotValue) return this.snapshotValue;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      let value = this.fallback();
      try {
        const raw = localStorage.getItem(this.key);
        if (raw) {
          const env = JSON.parse(raw) as Envelope;
          if (env && env.v === 1 && env.iv && env.ct) {
            value = await this.decrypt(env);
          }
        }
      } catch {
        /* 坏信封/解密失败：按未配置对待（凭据可重填，不至于卡死启动） */
      }
      this.snapshotValue = value;
      return value;
    })();
    return this.loading;
  }

  async save(next: T): Promise<void> {
    const env = await this.encrypt(next);
    localStorage.setItem(this.key, JSON.stringify(env));
    this.snapshotValue = next;
    this.emit();
  }

  async clear(): Promise<void> {
    localStorage.removeItem(this.key);
    this.snapshotValue = this.fallback();
    this.emit();
  }
}

/** 便捷 hook：快照 + 变更即重渲染 */
export function useEncryptedStore<T extends object>(store: ImStorage<T>): T | null {
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = (): void => tick((n) => n + 1);
    const unsub = store.subscribe(fn);
    void store.load();
    return unsub;
  }, [store]);
  return store.snapshot();
}
