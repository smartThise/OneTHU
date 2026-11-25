/**
 * 登录冷却：按账号隔离，避免换号后继承上一个账号的 20s 冷却。
 * 只存时间戳，不存账号以外的任何凭据；sessionStorage 键带账号哈希不可逆前缀。
 */
const STORAGE_PREFIX = "onethu.login-attempt-at:";
const COOLDOWN_MS = 20_000;
const memory = new Map<string, number>();

export class LoginCooldownError extends Error {
  readonly code = "AUTH_COOLDOWN";
  constructor(readonly retryAfterMs: number) {
    super("Please wait before starting another login attempt.");
    this.name = "LoginCooldownError";
  }
}

function keyOf(account?: string): string {
  const accountKey = (account ?? "").trim() || "anonymous";
  let hash = 2166136261;
  for (let i = 0; i < accountKey.length; i += 1) {
    hash ^= accountKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${STORAGE_PREFIX}${(hash >>> 0).toString(36)}`;
}

export function loginCooldownLeftMs(account?: string): number {
  const now = Date.now();
  const key = keyOf(account);
  let saved = 0;
  try { saved = Number(globalThis.sessionStorage?.getItem(key)); } catch { /* memory fallback */ }
  // A clock change or corrupt storage must not lock the user out indefinitely.
  const valid = (at: number): number => Number.isFinite(at) && at > 0 && at <= now ? at : 0;
  const last = Math.max(valid(memory.get(key) ?? 0), valid(saved));
  if (last) memory.set(key, last);
  return Math.max(0, COOLDOWN_MS - (now - last));
}

/** Call once before a new full login chain, never for a 2FA continuation. */
export function markLoginAttempt(account?: string): void {
  const remaining = loginCooldownLeftMs(account);
  if (remaining > 0) throw new LoginCooldownError(remaining);
  const key = keyOf(account);
  memory.set(key, Date.now());
  try { globalThis.sessionStorage?.setItem(key, String(Date.now())); } catch { /* memory fallback */ }
}

/** A verified completed login is not a failed attempt awaiting another password. */
export function markLoginSucceeded(account?: string): void {
  const key = keyOf(account);
  memory.delete(key);
  try { globalThis.sessionStorage?.removeItem(key); } catch { /* memory fallback */ }
}

/** Logout/account-switch clears this account's cooldown, not the next account's. */
export function clearLoginCooldown(account?: string): void {
  markLoginSucceeded(account);
}
