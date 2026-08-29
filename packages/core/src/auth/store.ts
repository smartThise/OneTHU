/**
 * 凭证与会话持久化 —— 绝不明文落盘密码。
 * Web 端用 LocalStorage；Tauri 桌面接系统钥匙串；RN 接 Keychain/Keystore（实现同一接口）。
 */
export interface SessionData {
  username: string;
  fingerprint: string;
  /** doubleAuth SAVE_FINGER 返回的受信凭据（finger3），下次登录免 2FA */
  finger3?: string;
  /** CookieJar.serialize() 的结果 */
  cookiesJson: string;
  /** demo 字符串会话（登录链全量 Cookie），重启恢复用 */
  demoCookies?: string;
  /** roam-id 完成时的 cookie 串快照（info 会话）——重启后 info/webvpn 桶灌 jar 用 */
  infoCookies?: string;
  /** id CAS 主会话（JSESSIONID，SSO 主凭据）——learn 会话过期后用它重新漫游 */
  idJsid?: string;
  savedAt: number;
}

export interface CredentialStore {
  loadSession(): Promise<SessionData | null>;
  saveSession(session: SessionData): Promise<void>;
  clearSession(): Promise<void>;
  /** 可选：仅当用户显式开启"记住密码"时使用；实现方必须用系统安全存储 */
  loadSecret?(): Promise<string | null>;
  saveSecret?(password: string): Promise<void>;
  clearSecret?(): Promise<void>;
}

export class MemoryCredentialStore implements CredentialStore {
  #session: SessionData | null = null;
  #secret: string | null = null;

  async loadSession(): Promise<SessionData | null> {
    return this.#session;
  }
  async saveSession(s: SessionData): Promise<void> {
    this.#session = s;
  }
  async clearSession(): Promise<void> {
    this.#session = null;
  }
  async loadSecret(): Promise<string | null> {
    return this.#secret;
  }
  async saveSecret(p: string): Promise<void> {
    this.#secret = p;
  }
  async clearSecret(): Promise<void> {
    this.#secret = null;
  }
}

export class LocalStorageCredentialStore implements CredentialStore {
  constructor(
    private readonly storage: Storage,
    private readonly keyPrefix = "onethu.",
  ) {}

  async loadSession(): Promise<SessionData | null> {
    const raw = this.storage.getItem(this.keyPrefix + "session");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SessionData;
    } catch {
      return null;
    }
  }

  async saveSession(session: SessionData): Promise<void> {
    this.storage.setItem(this.keyPrefix + "session", JSON.stringify(session));
  }

  async clearSession(): Promise<void> {
    this.storage.removeItem(this.keyPrefix + "session");
  }

  async loadSecret(): Promise<string | null> {
    return this.storage.getItem(this.keyPrefix + "secret");
  }

  async saveSecret(password: string): Promise<void> {
    this.storage.setItem(this.keyPrefix + "secret", password);
  }

  async clearSecret(): Promise<void> {
    this.storage.removeItem(this.keyPrefix + "secret");
  }
}

/** 设备指纹：随机 32 hex，首次生成后随会话持久保存（CAS 信任设备用） */
export function makeFingerprint(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
