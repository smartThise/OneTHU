/**
 * 微信通道适配器（iLink 官方 Bot，扫码登录）。
 *
 * 体验对标 reasonix / openclaw：**用户只需扫码**（微信扫一下），不需要任何 App ID/Secret——
 * 协议走腾讯官方 iLink 通道（Tencent/openclaw-weixin MIT 移植，见 wechatProto.ts）。
 *
 * 形态：扫码 confirmed → bot_token 落本机密文存储 → 长轮询 getUpdates（游标记忆）→
 * 消息交 registry（绑定/白名单/单飞队列/OH）→ sendMessage 原路回复。
 * 风控：ret/errcode -14 → 通道挂起 1 小时（官方同款行为，如实上报 UI）。
 */
import { logLine } from "../lib/clients.js";
import { patchImConfig } from "./store.js";
import { reportChannelStatus } from "./registry.js";
import {
  ILINK_API_BASE, MessageType, buildTextMessage, extractAttachments, extractText, fetchBotQrcode,
  getUpdates, pollQrcodeStatus, sendMessage, type QrcodeStatus, type WeixinMessage,
} from "./wechatProto.js";
import type { ChannelAdapter, ChannelId, InboundMessage } from "./types.js";

const SUSPEND_MS = 60 * 60_000; // -14 风控：暂停 1 小时（官方行为）

export class WechatChannel implements ChannelAdapter {
  readonly id: ChannelId = "wechat";
  readonly label = "微信（iLink 官方 Bot）";

  private running = false;
  private buf = "";
  private baseUrl = ILINK_API_BASE;
  private token = "";
  /** 最近 context_token（按发送者），回复时带回（官方 quote 机制的最小版） */
  private ctx = new Map<string, string>();
  /** 暂停到什么时候（风控） */
  private suspendUntil = 0;

  constructor(private readonly getCreds: () => { token: string; baseUrl: string } | null) {}

  probe(): { configured: boolean; missing: string } {
    const c = this.getCreds();
    if (c?.token) return { configured: true, missing: "" };
    return { configured: false, missing: "未扫码登录（设置页点「扫码登录」）" };
  }

  async start(onInbound: (msg: InboundMessage) => void): Promise<void> {
    const creds = this.getCreds();
    if (!creds?.token) throw new Error("未扫码登录");
    this.token = creds.token;
    this.baseUrl = creds.baseUrl || ILINK_API_BASE;
    this.buf = "";
    this.running = true;
    void this.loop(onInbound);
  }

  async stop(): Promise<void> {
    this.running = false; // 长轮询最长 35s 后自然退出，无需强杀
  }

  async send(orig: InboundMessage, text: string): Promise<void> {
    if (!this.token) throw new Error("微信通道未登录");
    await sendMessage(this.baseUrl, this.token, buildTextMessage(orig.sender, text, this.ctx.get(orig.sender)));
  }

  private async loop(onInbound: (msg: InboundMessage) => void): Promise<void> {
    while (this.running) {
      if (Date.now() < this.suspendUntil) {
        await sleep(5_000);
        continue;
      }
      try {
        const r = await getUpdates(this.baseUrl, this.token, this.buf);
        if (r.ret === -14 || r.errcode === -14) {
          this.suspendUntil = Date.now() + SUSPEND_MS;
          reportChannelStatus(this.id, "suspended", "微信风控（-14）：暂停 1 小时后自动恢复");
          continue;
        }
        if (r.ret && r.ret !== 0) {
          reportChannelStatus(this.id, "reconnecting", `getUpdates ret=${r.ret} ${r.errmsg ?? ""}`);
          await sleep(3_000);
          continue;
        }
        if (r.get_updates_buf) this.buf = r.get_updates_buf;
        reportChannelStatus(this.id, "online", "");
        for (const m of r.msgs ?? []) {
          this.dispatch(m, onInbound);
        }
      } catch (e) {
        if (!this.running) break;
        reportChannelStatus(this.id, "reconnecting", e instanceof Error ? e.message : String(e));
        await sleep(3_000);
      }
    }
  }

  private dispatch(m: WeixinMessage, onInbound: (msg: InboundMessage) => void): void {
    if (m.message_type !== MessageType.USER) return; // 只收用户消息（BOT 自己的回声丢弃）
    const from = m.from_user_id ?? "";
    const text = extractText(m);
    const hasMedia = (m.item_list ?? []).some((it) => it.type === 2 || it.type === 4 || it.type === 5);
    if (!from || (!text && !hasMedia)) return;
    if (m.context_token) this.ctx.set(from, m.context_token);
    const attachments = extractAttachments(m).map((a) => ({
      kind: a.kind,
      name: a.name,
      ref: a.ref,
      messageId: m.message_id ?? "",
    }));
    onInbound({
      eventId: m.message_id ?? `${from}:${m.create_time_ms ?? Date.now()}`,
      channel: "wechat",
      sender: from,
      chat: { kind: "dm", id: from },
      text,
      attachments,
      ts: m.create_time_ms ?? Date.now(),
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/* ── 扫码登录会话（UI 驱动；模块级状态，会话内有效） ── */

interface LoginSession {
  qrcode: string;
  imgContent: string;
  baseUrl: string;
  startedAt: number;
  verifyCode?: string;
}

let login: LoginSession | null = null;
const LOGIN_TTL_MS = 5 * 60_000;

/** 发起扫码：取二维码（UI 渲染 imgContent/qrcode），返回给设置页 */
export async function wechatLoginStart(): Promise<{ qrcode: string; imgContent: string }> {
  const r = await fetchBotQrcode();
  login = { qrcode: r.qrcode, imgContent: r.qrcode_img_content, baseUrl: ILINK_API_BASE, startedAt: Date.now() };
  void logLine("[IM] 微信扫码登录已发起").catch(() => undefined);
  return { qrcode: r.qrcode, imgContent: r.qrcode_img_content };
}

/** 轮询扫码状态；confirmed 时保存凭据（密文）并返回 done=true */
export async function wechatLoginPoll(): Promise<{ status: QrcodeStatus; note: string; done: boolean }> {
  if (!login) return { status: "expired", note: "未发起登录", done: false };
  if (Date.now() - login.startedAt > LOGIN_TTL_MS) {
    login = null;
    return { status: "expired", note: "二维码已过期，请重新发起", done: false };
  }
  const r = await pollQrcodeStatus(login.qrcode, {
    baseUrl: login.baseUrl,
    verifyCode: login.verifyCode,
  });
  if (r.status === "scaned_but_redirect" && r.redirect_host) {
    login.baseUrl = `${r.redirect_host.startsWith("http") ? "" : "https://"}${r.redirect_host}`;
  }
  if (r.status === "confirmed" && r.bot_token) {
    const baseUrl = r.baseurl?.trim() || ILINK_API_BASE;
    await patchImConfig((c) => {
      c.channels.wechat = {
        botToken: r.bot_token!,
        baseUrl,
        botId: r.ilink_bot_id ?? "",
        userId: r.ilink_user_id ?? "",
      };
      c.bindings.wechat = r.ilink_user_id ?? c.bindings.wechat; // 扫码者默认即主人（P0 单主人）
      c.enabled.wechat = true;
    });
    login = null;
    void logLine(`[IM] 微信扫码登录成功（bot=${r.ilink_bot_id ?? "?"}）`).catch(() => undefined);
    return { status: "confirmed", note: "登录成功，通道已启用", done: true };
  }
  const notes: Record<string, string> = {
    wait: "等待扫码…",
    scaned: "已扫码，请在手机上确认",
    need_verifycode: "需要在手机上输入验证码后重试",
    expired: "二维码已过期，请重新发起",
    verify_code_blocked: "验证失败次数过多，请重新发起",
    binded_redirect: "该 Bot 已绑定到本机",
    scaned_but_redirect: "已扫码（切换接入点）…",
  };
  return { status: r.status, note: notes[r.status] ?? r.status, done: false };
}

/** 提交手机上的验证码（need_verifycode 时）并继续轮询 */
export async function wechatLoginVerify(code: string): Promise<void> {
  if (login) login.verifyCode = code.trim();
}

export function wechatLoginCancel(): void {
  login = null;
}
