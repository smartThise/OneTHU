/**
 * 「AES-GCM 信封 + PBKDF2 派生密钥」的通用加密存储器——加解密算法与安全
 * 口径逐行照抄 state/exthw.ts（外部作业源那套），参数化为可复用叶子：
 * 明文对象整体 JSON 序列化后加密，持久层只有 {v,iv,ct} 信封。
 *
 * 持久层（2026-10-10 教训）：**应用数据目录文件**（state_read/state_write，与
 * session/credentials 同款），不再用 localStorage——WKWebView 清缓存/系统清理
 * 会把 localStorage 连根拔掉，IM 凭据/绑定随之全丢（用户实录：清 WebKit 缓存
 * 后微信/飞书配置全没）。salt 与信封同文件存放（本地混淆口径不变，见 store.ts
 * 顶部诚实声明）；localStorage 里的旧数据在加载时迁移一次后移除。
 */
import { useEffect, useState } from "react";
import { fileRead, fileWrite, fileDelete } from "../lib/clients.js";

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

  private saltBytes: Uint8Array | null = null;

  /** salt 与信封同文件（im.salt 段）；localStorage 旧值一次性迁移 */
  private async getOrCreateSalt(): Promise<Uint8Array> {
    if (this.saltBytes && this.saltBytes.length >= 8) return this.saltBytes;
    // ① 持久文件里的 salt（随 save 写入）
    try {
      const raw = await fileRead(this.fileName());
      if (raw) {
        const parsed = JSON.parse(raw) as { salt?: string; env?: unknown };
        if (parsed.salt) {
          const bytes = b64decode(parsed.salt);
          if (bytes.length >= 8) {
            this.saltBytes = bytes;
            return bytes;
          }
        }
      }
    } catch {
      /* ignore */
    }
    // ② localStorage 旧 salt 迁移（老用户升级路径）
    try {
      const cur = localStorage.getItem(this.saltKey);
      if (cur) {
        const bytes = b64decode(cur);
        if (bytes.length >= 8) {
          this.saltBytes = bytes;
          return bytes;
        }
      }
    } catch {
      /* ignore */
    }
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    this.saltBytes = salt;
    return salt;
  }

  /** 持久文件名（app 数据目录 state/ 下，与 session/credentials 同目录） */
  private fileName(): string {
    // key 形如 onethu.im.v1 → 文件 im.cfg；saltKey 同文件，不需要第二个文件
    return "im.cfg";
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
    const key = await this.deriveKey(await this.getOrCreateSalt());
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    const data = new TextEncoder().encode(JSON.stringify(value));
    const ct = await subtle.encrypt({ name: "AES-GCM", iv: iv as unknown as BufferSource }, key, data);
    return { v: 1, iv: b64encode(iv), ct: b64encode(new Uint8Array(ct)) };
  }

  private async decrypt(env: Envelope): Promise<T> {
    if (!subtle) throw new Error("当前环境不支持 WebCrypto");
    const key = await this.deriveKey(await this.getOrCreateSalt());
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
      let saltSource: "file" | "legacy" | "none" = "none";
      // ① 持久文件（新）
      try {
        const raw = await fileRead(this.fileName());
        if (raw) {
          const parsed = JSON.parse(raw) as { salt?: string; env?: Envelope | null };
          if (parsed.salt) {
            const bytes = b64decode(parsed.salt);
            if (bytes.length >= 8) this.saltBytes = bytes;
          }
          if (parsed.env && parsed.env.v === 1 && parsed.env.iv && parsed.env.ct) {
            value = await this.decrypt(parsed.env);
            saltSource = "file";
          }
        }
      } catch {
        /* 坏信封/解密失败：按未配置对待（凭据可重填，不至于卡死启动） */
      }
      // ② localStorage 旧数据迁移（一次；成功后清掉旧键，防再次被清缓存丢配置）
      if (saltSource === "none") {
        try {
          const raw = localStorage.getItem(this.key);
          if (raw) {
            const env = JSON.parse(raw) as Envelope;
            if (env && env.v === 1 && env.iv && env.ct) {
              value = await this.decrypt(env);
              // 迁移 salt：老 salt 在 localStorage
              try {
                const legacySalt = localStorage.getItem(this.saltKey);
                if (legacySalt) this.saltBytes = b64decode(legacySalt);
              } catch {
                /* ignore */
              }
              await this.save(value); // 写入持久文件（内部会重新加密落盘）
              localStorage.removeItem(this.key);
              localStorage.removeItem(this.saltKey);
            }
          }
        } catch {
          /* ignore */
        }
      }
      this.snapshotValue = value;
      return value;
    })();
    return this.loading;
  }

  async save(next: T): Promise<void> {
    const salt = await this.getOrCreateSalt();
    const env = await this.encrypt(next);
    await fileWrite(this.fileName(), JSON.stringify({ salt: b64encode(salt), env }));
    this.snapshotValue = next;
    this.emit();
  }

  async clear(): Promise<void> {
    await fileDelete(this.fileName());
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
