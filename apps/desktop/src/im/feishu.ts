/**
 * 飞书通道适配器（自建应用机器人）。
 *
 * 手写精简客户端（WebView 里没有 Node SDK；HTTP 一律走 tauriFetch 规避 CORS）：
 * - tenant_access_token 刷新（internal 端点，2h 有效，提前 20 分钟续）
 * - 事件订阅走 **WS 长连接**（免公网入口）：端点发现 → protobuf 帧
 *   （feishuProto.ts 手写编解码）→ PING/PONG 保活 → 分片重组 → ACK 回帧
 * - 协议依据：官方 SDK 源码（larksuite/oapi-sdk-python ws/client.py）与开放平台文档
 *   https://open.feishu.cn/document/server-docs/event-subscription-guide/overview
 *
 * P0 范围：仅单聊（p2p）文本；群聊 @ 与卡片流式后续（docs/im-cloud/00 §7）。
 */
import { tauriFetch } from "../lib/transport.js";
import { logLine } from "../lib/clients.js";
import { loadImConfig } from "./store.js";
import { reportChannelStatus } from "./registry.js";
import type { ChannelAdapter, InboundMessage } from "./types.js";
import {
  decodeFrame,
  encodeFrame,
  headerOf,
  pingFrame,
  FEISHU_FRAME_CONTROL,
  FEISHU_FRAME_DATA,
  type WsFrame,
} from "./feishuProto.js";

const FEISHU_BASE = "https://open.feishu.cn";
const ENDPOINT_URI = "/callback/ws/endpoint";

/* ── token 管理 ── */

let tokenState: { token: string; expiresAt: number } | null = null;
let tokenLoading: Promise<string> | null = null;

async function feishuToken(force = false): Promise<string> {
  if (!force && tokenState && Date.now() < tokenState.expiresAt) return tokenState.token;
  if (!force && tokenLoading) return tokenLoading;
  tokenLoading = (async () => {
    const cfg = await loadImConfig();
    const creds = cfg.channels.feishu;
    if (!creds?.appId || !creds.appSecret) throw new Error("飞书应用信息未配置");
    const res = await tauriFetch(`${FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: creds.appId, app_secret: creds.appSecret }),
    });
    const j = (await res.json()) as { code?: number; msg?: string; tenant_access_token?: string; expire?: number };
    if (j.code !== 0 || !j.tenant_access_token) {
      throw new Error(`飞书登录失败(code=${j.code ?? res.status})：${j.msg ?? "请检查 App ID / App Secret"}`);
    }
    // 官方 expire=7200s；提前 20 分钟视为过期
    const expireMs = Math.max(60, (j.expire ?? 7200) - 1200 / 2 - 0) * 1000 - 0; // ~ (expire-600)s
    tokenState = { token: j.tenant_access_token, expiresAt: Date.now() + expireMs };
    return j.tenant_access_token;
  })();
  try {
    return await tokenLoading;
  } finally {
    tokenLoading = null;
  }
}

/* ── 端点发现 ── */

interface ClientConfig {
  ReconnectCount?: number;
  ReconnectInterval?: number;
  ReconnectNonce?: number;
  PingInterval?: number;
}

interface EndpointResp {
  code: number;
  msg?: string;
  data?: { URL?: string; ClientConfig?: ClientConfig | null };
}

async function discoverEndpoint(): Promise<{ url: string; config: ClientConfig }> {
  const cfg = await loadImConfig();
  const creds = cfg.channels.feishu;
  if (!creds?.appId || !creds.appSecret) throw new Error("飞书应用信息未配置");
  const res = await tauriFetch(`${FEISHU_BASE}${ENDPOINT_URI}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", locale: "zh" },
    body: JSON.stringify({ AppID: creds.appId, AppSecret: creds.appSecret }),
  });
  const j = (await res.json()) as EndpointResp;
  if (j.code !== 0 || !j.data?.URL) {
    throw new Error(`飞书长连接建立失败(code=${j.code})：${j.msg ?? "请检查应用信息与长连接权限"}`);
  }
  return { url: j.data.URL, config: j.data.ClientConfig ?? {} };
}

/* ── 适配器 ── */

class FeishuChannel implements ChannelAdapter {
  readonly id = "feishu" as const;
  readonly label = "飞书";

  private stopped = true;
  private ws: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private serviceId = 0;
  /** 分片重组缓存（官方 SDK 同款：msg_id → 分片缓冲，短 TTL） */
  private fragments = new Map<string, { parts: Array<Uint8Array | null>; expiresAt: number }>();
  /** 事件幂等去重（at-least-once 投递） */
  private seenEvents = new Set<string>();
  private onInbound: ((msg: InboundMessage) => void) | null = null;
  /** 外发串行队列（同人/群 5 QPS 限频 → 保守 250ms 间隔） */
  private sendQueue: Array<() => Promise<void>> = [];
  private sending = false;

  probe(): { configured: boolean; missing: string } {
    const cfg = loadImConfigCached();
    const creds = cfg?.channels.feishu;
    if (creds?.appId && creds.appSecret) return { configured: true, missing: "" };
    return { configured: false, missing: "App ID / App Secret" };
  }

  async start(onInbound: (msg: InboundMessage) => void): Promise<void> {
    this.stopped = false;
    this.onInbound = onInbound;
    await this.connect();
  }

  private async connect(): Promise<void> {
    const { url, config } = await discoverEndpoint();
    const serviceId = Number(new URL(url).searchParams.get("service_id") ?? "0");
    this.serviceId = Number.isFinite(serviceId) ? serviceId : 0;
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.binaryType = "arraybuffer";
      const onFail = (e: unknown): void => {
        cleanup();
        reject(new Error(`飞书长连接无法建立：${String((e as Event)?.type ?? e)}`));
      };
      const onOpen = (): void => {
        cleanup();
        this.startPing(config.PingInterval ?? 120);
        resolve();
      };
      const cleanup = (): void => {
        ws.removeEventListener("open", onOpen);
        ws.removeEventListener("error", onFail);
      };
      ws.addEventListener("open", onOpen);
      ws.addEventListener("error", onFail);
      ws.addEventListener("message", (ev) => this.onFrame(ev));
      ws.addEventListener("close", () => this.onClose(config));
    });
  }

  private startPing(intervalSec: number): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      try {
        this.ws?.send(pingFrame(this.serviceId));
      } catch {
        /* 发送失败交给 close 事件重连 */
      }
    }, intervalSec * 1000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private onFrame(ev: MessageEvent): void {
    try {
      const frame = decodeFrame(new Uint8Array(ev.data as ArrayBuffer));
      if (frame.method === FEISHU_FRAME_CONTROL) {
        // pong：可能携带新的 ClientConfig（官方 SDK 在 pong payload 里下发）
        if (frame.payload && frame.payload.length > 0) {
          try {
            const conf = JSON.parse(new TextDecoder().decode(frame.payload)) as ClientConfig;
            if (conf.PingInterval) this.startPing(conf.PingInterval);
          } catch {
            /* 非 JSON 载荷忽略 */
          }
        }
        return;
      }
      if (frame.method === FEISHU_FRAME_DATA) {
        void this.handleData(frame);
      }
    } catch (e) {
      void logLine(`[IM:feishu] 帧解码异常：${String(e).slice(0, 120)}`);
    }
  }

  private async handleData(frame: WsFrame): Promise<void> {
    const type = headerOf(frame, "type") ?? "";
    if (type !== "event" && type !== "card") {
      this.ack(frame);
      return;
    }
    const messageId = headerOf(frame, "message_id") ?? `${Date.now()}`;
    const sum = Number(headerOf(frame, "sum") ?? "1");
    const seq = Number(headerOf(frame, "seq") ?? "0");
    let payload: Uint8Array | null;
    if (sum > 1) {
      payload = this.combine(messageId, sum, seq, frame.payload ?? new Uint8Array());
      if (!payload) {
        this.ack(frame); // 分片未齐也先 ACK（官方 SDK 分片路径不回帧；稳妥起见照单全收）
        return;
      }
    } else {
      payload = frame.payload ?? new Uint8Array();
    }
    this.ack(frame);
    if (type === "card") return; // 卡片交互回调 P0 不处理（回复文本无按钮）
    this.dispatchEvent(new TextDecoder().decode(payload));
  }

  /** 分片重组（官方 _combine 同款：5 秒过期） */
  private combine(msgId: string, sum: number, seq: number, bs: Uint8Array): Uint8Array | null {
    this.gcFragments();
    let entry = this.fragments.get(msgId);
    if (!entry) {
      entry = { parts: new Array<Uint8Array | null>(sum).fill(null), expiresAt: Date.now() + 5000 };
      this.fragments.set(msgId, entry);
    }
    entry.parts[seq] = bs;
    if (entry.parts.some((p) => !p)) return null;
    const total = entry.parts.reduce((acc, p) => acc + (p?.length ?? 0), 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of entry.parts) {
      out.set(p!, off);
      off += p!.length;
    }
    this.fragments.delete(msgId);
    return out;
  }

  private gcFragments(): void {
    const now = Date.now();
    for (const [k, v] of this.fragments) if (v.expiresAt < now) this.fragments.delete(k);
  }

  /** ACK 回帧：同帧字段 + biz_rt 头 + {code:200}（官方 SDK 的应答契约） */
  private ack(frame: WsFrame): void {
    try {
      const reply = encodeFrame({
        seqId: frame.seqId,
        logId: frame.logId,
        service: frame.service,
        method: frame.method,
        headers: [
          ...frame.headers.filter((h) => h.key === "type" || h.key === "message_id" || h.key === "trace_id"),
          { key: "biz_rt", value: "1" },
        ],
        payload: new TextEncoder().encode(JSON.stringify({ code: 200 })),
      });
      this.ws?.send(reply);
    } catch {
      /* 连接已断时交给重连 */
    }
  }

  /* ── 事件分发：只认 im.message.receive_v1 的 p2p 消息 ── */

  private dispatchEvent(json: string): void {
    let ev: {
      header?: { event_id?: string; event_type?: string };
      event?: {
        sender?: { sender_id?: { open_id?: string }; sender_type?: string };
        message?: {
          message_id?: string;
          chat_id?: string;
          chat_type?: string;
          message_type?: string;
          content?: string;
          create_time?: string;
          mentions?: Array<{ key?: string }>;
        };
      };
    };
    try {
      ev = JSON.parse(json);
    } catch {
      return;
    }
    if (ev.header?.event_type !== "im.message.receive_v1") return;
    const eventId = ev.header.event_id ?? "";
    if (eventId) {
      if (this.seenEvents.has(eventId)) return; // at-least-once → 幂等
      this.seenEvents.add(eventId);
      if (this.seenEvents.size > 500) {
        const it = this.seenEvents.values().next();
        if (!it.done) this.seenEvents.delete(it.value);
      }
    }
    const message = ev.event?.message;
    const senderId = ev.event?.sender?.sender_id?.open_id ?? "";
    if (!message || !senderId) return;
    if (ev.event?.sender?.sender_type !== "user") return; // 其他 bot 的消息不接
    if (message.chat_type !== "p2p") return; // P0 仅单聊（群聊 @ 后续）

    const mtype = message.message_type ?? "text";
    const msg: InboundMessage = {
      eventId: eventId || `${message.message_id ?? Date.now()}`,
      channel: "feishu",
      sender: senderId,
      chat: { kind: "dm", id: message.chat_id ?? "" },
      text: "",
      attachments: [],
      ts: Number(message.create_time ?? Date.now() / 1000) * 1000 || Date.now(),
    };
    if (mtype === "text") {
      try {
        const content = JSON.parse(message.content ?? "{}") as { text?: string };
        let text = content.text ?? "";
        // @机器人 占位符（@_user_N）剥掉，正文保留
        for (const m of message.mentions ?? []) if (m.key) text = text.split(m.key).join("");
        msg.text = text.trim();
      } catch {
        msg.text = "";
      }
    } else if (mtype === "image" || mtype === "file" || mtype === "audio" || mtype === "media") {
      let name = mtype === "image" ? "图片" : mtype === "media" ? "视频" : mtype === "audio" ? "语音" : "文件";
      let ref = "";
      try {
        const content = JSON.parse(message.content ?? "{}") as { file_key?: string; image_key?: string; file_name?: string };
        ref = content.file_key ?? content.image_key ?? "";
        if (content.file_name) name = content.file_name;
      } catch {
        /* 保留默认名 */
      }
      msg.attachments.push({
        kind: mtype === "media" ? "video" : mtype === "image" ? "image" : mtype === "audio" ? "audio" : "file",
        name,
        ref,
        messageId: message.message_id ?? "",
      });
    } else {
      return; // sticker/post 等富类型 P0 忽略
    }
    if (!msg.text && msg.attachments.length === 0) return;
    this.onInbound?.(msg);
  }

  /* ── 外发 ── */

  async send(orig: InboundMessage, text: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.sendQueue.push(() => this.doSend(orig.chat.id, text));
      this.pumpSendQueue(reject);
      resolve();
    });
  }

  private pumpSendQueue(_reject: (e: unknown) => void): void {
    if (this.sending) return;
    this.sending = true;
    void (async () => {
      for (;;) {
        const job = this.sendQueue.shift();
        if (!job) break;
        try {
          await job();
        } catch (e) {
          void logLine(`[IM:feishu] 外发失败：${String(e).slice(0, 140)}`);
        }
        await new Promise((r) => setTimeout(r, 250)); // 同会话 5 QPS → 保守串行
      }
      this.sending = false;
    })();
  }

  private async doSend(chatId: string, text: string): Promise<void> {
    const token = await feishuToken();
    const body = {
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text }),
      uuid: crypto.randomUUID().slice(0, 50),
    };
    const call = (): Promise<Response> =>
      tauriFetch(`${FEISHU_BASE}/open-apis/im/v1/messages?receive_id_type=chat_id`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(body),
      });
    let res = await call();
    let j = (await res.json().catch(() => ({}))) as { code?: number; msg?: string };
    if (j.code === 230020) {
      // 限频：退避 1.2s 重试一次（同人/群 5 QPS）
      await new Promise((r) => setTimeout(r, 1200));
      res = await call();
      j = (await res.json().catch(() => ({}))) as { code?: number; msg?: string };
    }
    if (j.code !== 0) {
      throw new Error(`飞书发送失败(code=${j.code ?? res.status})：${j.msg ?? "未知原因"}`);
    }
  }

  /* ── 断线重连（指数退避封顶 30s；每次重连重新发现端点） ── */

  private onClose(config: ClientConfig): void {
    this.stopPing();
    if (this.stopped) return;
    const nonceSec = Math.min(config.ReconnectNonce ?? 30, 5);
    const intervalSec = Math.min(config.ReconnectInterval ?? 120, 30);
    void (async () => {
      await new Promise((r) => setTimeout(r, nonceSec * 1000 * Math.random()));
      let delay = 2000;
      while (!this.stopped) {
        reportChannelStatus("feishu", "reconnecting", `连接断开，${Math.round(delay / 1000)} 秒后重连`);
        await new Promise((r) => setTimeout(r, delay));
        if (this.stopped) return;
        try {
          await this.connect();
          reportChannelStatus("feishu", "online", "");
          void logLine("[IM:feishu] 长连接已恢复");
          return;
        } catch (e) {
          void logLine(`[IM:feishu] 重连失败：${String(e).slice(0, 100)}`);
          delay = Math.min(delay * 2, intervalSec * 1000);
        }
      }
    })();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.stopPing();
    try {
      this.ws?.close(1000, "client-stop");
    } catch {
      /* 已断开 */
    }
    this.ws = null;
  }
}

/** probe 是同步的：读内存快照（boot 已 load 过；设置页保存后快照即刻刷新） */
function loadImConfigCached() {
  return configSnapshotSafe();
}

function configSnapshotSafe(): ReturnType<typeof import("./store.js").configSnapshot> {
  try {
    // 动态引用避免 store 循环依赖（store 不依赖本模块，实际安全；保守起见走快照）
    const { configSnapshot } = require_store();
    return configSnapshot();
  } catch {
    return null;
  }
}

// store 模块单例引用（避免顶部循环 import：store ← registry ← 本模块）
import * as storeMod from "./store.js";
function require_store(): typeof storeMod {
  return storeMod;
}

export const feishuChannel = new FeishuChannel();
