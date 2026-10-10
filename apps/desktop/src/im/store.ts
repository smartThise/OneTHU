/**
 * IM 通道配置与凭据存储。
 *
 * 存储：`onethu.im.v1` 只存**密文**（AES-GCM）。密钥由「随机 salt（`onethu.im.salt.v1`
 * 存 localStorage）+ 固定串」经 PBKDF2(SHA-256, 12 万次) 派生——与外部作业源
 * （state/exthw.ts）同一套安全口径。
 * ⚠️ 诚实声明（照抄 exthw）：这**只是本地混淆，不是真正的安全**——密钥与密文
 * 同在本机同一份 localStorage 里，能读 localStorage 的人同样能解出明文。它只防止
 * 「凭据以肉眼可读的形式躺在存储里被顺手看到 / 被同步导出」。真要保密，请用
 * 系统级凭据库（未实现）。
 */
import { ImStorage } from "./imStorage.js";

/** 明文配置（内存中的唯一权威形态；落盘前整体加密） */
export interface ImConfig {
  channels: {
    feishu?: { appId: string; appSecret: string };
    wechat?: {
      botToken: string;
      /** iLink 后端地址（扫码应答下发，默认 https://ilinkai.weixin.qq.com） */
      baseUrl: string;
      botId: string;
      /** 扫码用户 ID（默认绑定主人候选） */
      userId: string;
    };
  };
  enabled: Record<"feishu" | "wechat", boolean>;
  /** 每通道已绑定的发送者（P0 单主人模型：一台机器只认一个人） */
  bindings: { feishu?: string; wechat?: string };
  /** M3：附件落云盘的资料库与目录（与 Files Hub 目录约定对齐） */
  seafile?: { repoId: string; dir: string };
}

export function defaultImConfig(): ImConfig {
  return {
    channels: {},
    enabled: { feishu: false, wechat: false },
    bindings: {},
  };
}

const KEY = "onethu.im.v1";
const SALT_KEY = "onethu.im.salt.v1";
const KDF_PASS = "onethu-im-local-obfuscation-v1";
const PBKDF2_ITER = 120_000;

const store = new ImStorage<ImConfig>(KEY, SALT_KEY, KDF_PASS, PBKDF2_ITER, defaultImConfig);

/* ── 配置读写（UI 与通道运行时共用；变更即持久化并广播） ── */

export async function loadImConfig(): Promise<ImConfig> {
  return store.load();
}

export async function saveImConfig(next: ImConfig): Promise<void> {
  await store.save(next);
}

/** 就地修补（读-改-写原子性由单写者约定保证：设置页与启动流程不会并发改） */
export async function patchImConfig(fn: (cfg: ImConfig) => void): Promise<ImConfig> {
  const cfg = await store.load();
  fn(cfg);
  await store.save(cfg);
  return cfg;
}

export function subscribeImConfig(fn: () => void): () => void {
  return store.subscribe(fn);
}

export function configSnapshot(): ImConfig | null {
  return store.snapshot();
}
