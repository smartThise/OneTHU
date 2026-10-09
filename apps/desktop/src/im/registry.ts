/**
 * IM 通道注册表与核心策略层。
 *
 * 职责切分（照 openclaw 契约，docs/im-cloud/00 §3）：**策略都在 core**——
 * 绑定/白名单/命令/OH 对接在这里；适配器只做平台翻译，不能自判放行。
 *
 * P0 单主人模型：一台机器每通道只绑定一个发送者（/bind 限时码，借鉴 zcode）。
 * 未绑定者收到限频的引导回复（防骚扰放大），已绑定者进 OH 单飞队列。
 */
import { useSyncExternalStore } from "react";
import { loadImConfig, patchImConfig, configSnapshot, type ImConfig } from "./store.js";
import { askOh } from "./oh.js";
import { logLine } from "../lib/clients.js";
import type { ChannelAdapter, ChannelId, ChannelStatus, InboundMessage } from "./types.js";

/* ── 适配器注册（feishu/wechat 由 boot.ts 装配注册——避免设置页打开即
 *    拉起全部协议代码；registry 不反向 import 任何适配器） ── */
const adapters = new Map<ChannelId, ChannelAdapter>();

export function registerAdapter(a: ChannelAdapter): void {
  adapters.set(a.id, a);
}

export function getAdapter(id: ChannelId): ChannelAdapter | undefined {
  return adapters.get(id);
}

/* ── 状态存储（UI 订阅源） ── */
const statuses = new Map<ChannelId, ChannelStatus>();
const statusListeners = new Set<() => void>();

const offStatus = (): ChannelStatus => ({ phase: "off", note: "", lastInboundAt: 0, lastOutboundAt: 0, at: 0 });

function setStatus(id: ChannelId, patch: Partial<ChannelStatus>): void {
  const prev = statuses.get(id) ?? offStatus();
  statuses.set(id, { ...prev, ...patch, at: Date.now() });
  for (const l of statusListeners) l();
}

export function channelStatus(id: ChannelId): ChannelStatus {
  return statuses.get(id) ?? offStatus();
}

function subscribeStatus(fn: () => void): () => void {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

function statusSnapshot(): Map<ChannelId, ChannelStatus> {
  return statuses;
}

export function useChannelStatus(id: ChannelId): ChannelStatus {
  const snap = useSyncExternalStore(subscribeStatus, statusSnapshot);
  return snap.get(id) ?? offStatus();
}

/* ── 生命周期 ── */

const running = new Set<ChannelId>();

/** 启动一个通道（幂等：已在跑则先停再启——配置变更路径复用同一入口） */
export async function startChannel(id: ChannelId): Promise<void> {
  const adapter = adapters.get(id);
  if (!adapter) throw new Error(`通道未注册：${id}`);
  const cfg = await loadImConfig();
  if (!cfg.enabled[id]) throw new Error("通道未启用");
  const probe = adapter.probe();
  if (!probe.configured) throw new Error(`配置不完整：缺 ${probe.missing}`);
  await stopChannel(id);
  running.add(id);
  setStatus(id, { phase: "connecting", note: "" });
  try {
    await adapter.start((msg) => void handleInbound(msg));
    setStatus(id, { phase: "online", note: "" });
    void logLine(`[IM] ${id} 已连接`);
  } catch (e) {
    running.delete(id);
    const note = e instanceof Error ? e.message : String(e);
    setStatus(id, { phase: "error", note });
    throw e;
  }
}

export async function stopChannel(id: ChannelId): Promise<void> {
  const adapter = adapters.get(id);
  if (adapter && running.has(id)) {
    running.delete(id);
    try {
      await adapter.stop();
    } catch (e) {
      void logLine(`[IM] ${id} 停止异常：${String(e).slice(0, 120)}`);
    }
  }
  setStatus(id, { phase: "off", note: "" });
}

/** 适配器内部状态上报（重连/暂停/错误——不改变 running 语义，仅反映连接健康度） */
export function reportChannelStatus(id: ChannelId, phase: ChannelStatus["phase"], note = ""): void {
  setStatus(id, { phase, note });
}

export function isChannelRunning(id: ChannelId): boolean {
  return running.has(id);
}

/* ── 绑定码（内存态，10 分钟有效；设置页生成，IM 内发送 /bind 码完成绑定） ── */
let bindCode: { code: string; expiresAt: number } | null = null;

export function newBindCode(): string {
  // 去混淆字符集（无 0/O/1/I/L），6 位
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  const rand = new Uint8Array(6);
  crypto.getRandomValues(rand);
  for (let i = 0; i < 6; i++) code += alphabet[rand[i]! % alphabet.length];
  bindCode = { code, expiresAt: Date.now() + 10 * 60 * 1000 };
  return code;
}

export function bindCodeInfo(): { code: string; expiresAt: number } | null {
  return bindCode;
}

export async function unbind(channel: ChannelId): Promise<void> {
  await patchImConfig((cfg) => {
    delete cfg.bindings[channel];
  });
}

/* ── 入站策略（core 唯一入口） ── */

/** 未绑定发送者的引导回复限频：每发送者 60 秒最多一条 */
const noticeAt = new Map<string, number>();

async function handleInbound(msg: InboundMessage): Promise<void> {
  const cfg = configSnapshot() ?? (await loadImConfig());
  setStatus(msg.channel, { lastInboundAt: Date.now() });
  const text = msg.text.trim();
  if (!text && msg.attachments.length === 0) return;

  /* 命令层：/bind、/status（core 终结，不进 OH） */
  if (text.startsWith("/bind")) {
    const code = text.slice(5).trim().toUpperCase();
    if (!bindCode || Date.now() > bindCode.expiresAt) {
      await replyTo(msg, "绑定码已过期：请在电脑端重新生成后发送「/bind 码」。");
      return;
    }
    if (code !== bindCode.code) {
      await replyTo(msg, "绑定码不正确，请核对后重发「/bind 码」。");
      return;
    }
    bindCode = null;
    await patchImConfig((c) => {
      c.bindings[msg.channel] = msg.sender;
    });
    await replyTo(msg, "绑定成功，这台电脑的 OneTHU 现在听你指挥。发送 /status 查看状态。");
    void logLine(`[IM] ${msg.channel} 完成绑定 sender=${msg.sender.slice(0, 10)}…`);
    return;
  }
  if (text === "/status") {
    const bound = cfg.bindings[msg.channel] === msg.sender ? "已绑定" : "未绑定";
    await replyTo(msg, `[OneTHU] ${msg.channel} 通道在线，${bound}。电脑保持开机与 OneTHU 运行，我才会回复。`);
    return;
  }

  /* 白名单：仅绑定者可驱动 OH（默认 allowlist——R2 安全红线，docs/im-cloud/00 §8） */
  if (cfg.bindings[msg.channel] !== msg.sender) {
    const key = `${msg.channel}:${msg.sender}`;
    const last = noticeAt.get(key) ?? 0;
    if (Date.now() - last > 60_000) {
      noticeAt.set(key, Date.now());
      await replyTo(msg, "这台电脑的 OneTHU 未与你绑定：请让机主在 设置 → IM 机器人 生成绑定码，再发送「/bind 码」。");
    }
    return;
  }

  /* 附件（M3 转存云盘管线上线前的占位回复） */
  if (msg.attachments.length > 0) {
    const { storeAttachment } = await import("./mediaPipe.js");
    const adapter = adapters.get(msg.channel);
    const lines: string[] = [];
    for (const att of msg.attachments) {
      try {
        let ref = att.ref as import("./mediaPipe.js").AttachmentRef | null;
        if (adapter?.resolveAttachment) {
          ref = await adapter.resolveAttachment(att.ref, att.messageId);
        }
        if (!ref?.fetchUrl) {
          lines.push(`- ${att.name}：该类型暂不支持转存（首版支持图片/文件/视频）`);
          continue;
        }
        const r = await storeAttachment(msg.channel as "wechat" | "feishu", att.name, ref);
        lines.push(`- ${att.name}（${r.sizeNote}）已存入云盘 ${r.path}\n  链接：${r.link}`);
      } catch (e) {
        lines.push(`- ${att.name}：转存失败（${e instanceof Error ? e.message : String(e)}）`);
      }
    }
    await replyTo(msg, `收到 ${msg.attachments.length} 个附件，已转存云盘：\n${lines.join("\n")}`);
    return;
  }
  if (!text) return;

  /* OH 单飞队列（两段式确认：confirm 卡片 → 回复「确认/取消」即下一轮 chat 输入，
   * 与 ChatDock 的确认按钮同一映射） */
  const r = await askOh(text);
  const parts: string[] = [];
  if (r.error) parts.push(`⚠ ${r.error}`);
  if (r.answer) parts.push(r.answer);
  if (r.confirm?.summary) parts.push(`${r.confirm.summary}\n（回复「确认」执行，「取消」放弃）`);
  await replyTo(msg, parts.join("\n\n") || "(空响应)");
}

/** core 内部回复（命令/引导语/OH 应答统一走适配器出口） */
async function replyTo(orig: InboundMessage, text: string): Promise<void> {
  const adapter = adapters.get(orig.channel);
  if (!adapter) return;
  try {
    await adapter.send(orig, text);
    setStatus(orig.channel, { lastOutboundAt: Date.now() });
  } catch (e) {
    void logLine(`[IM] ${orig.channel} 回复失败：${String(e).slice(0, 120)}`);
  }
}

/* ── boot：App 启动恢复已启用通道（设置开关驱动启停） ── */
export async function bootChannels(): Promise<void> {
  const cfg: ImConfig = await loadImConfig();
  for (const id of Object.keys(cfg.enabled) as ChannelId[]) {
    if (!cfg.enabled[id]) continue;
    const adapter = adapters.get(id);
    if (!adapter || !adapter.probe().configured) continue;
    void startChannel(id).catch((e: unknown) => {
      void logLine(`[IM] ${id} 启动失败：${String(e).slice(0, 120)}`);
    });
  }
}
