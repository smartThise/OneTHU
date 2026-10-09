/**
 * 微信 iLink Bot 协议客户端。
 *
 * 移植自 Tencent/openclaw-weixin（MIT，Copyright (C) 2026 Tencent；协议字段与请求构造
 * 依据其 src/api/*.ts 与 docs/protocol_zh_CN.md，2026-10-09）。WebView 适配：
 * - HTTP 走 OneTHU 的 http.request（Tauri reqwest，无 CORS 问题）；
 * - 随机数用 crypto.getRandomValues（替代 node:crypto）；
 * - 登录会话状态在模块级 Map（UI 驱动轮询），不落盘中间态。
 *
 * 协议要点（官方文档）：
 * - 扫码：POST /ilink/bot/get_bot_qrcode?bot_type=3 → { qrcode, qrcode_img_content }
 * - 轮询：GET  /ilink/bot/get_qrcode_status?qrcode=&verify_code= → status/bot_token/baseurl
 * - 收发：POST /ilink/bot/getupdates（长轮询，游标 get_updates_buf）、POST /ilink/bot/sendmessage
 * - 风控：ret/errcode === -14 → 账号会话暂停 1 小时（官方 monitor 行为）
 */
import { http } from "../lib/clients.js";
import type { AttachmentRef } from "./mediaPipe.js";

export const ILINK_API_BASE = "https://ilinkai.weixin.qq.com";
/** 媒体 CDN（协议默认；服务端返回 full_url 时优先用 full_url） */
export const ILINK_CDN_BASE = "https://novac2c.cdn.weixin.qq.com/c2c";
export const ILINK_BOT_TYPE = "3";
const CHANNEL_VERSION = "0.1.0";
const APP_ID = "bot";
/** 0x00MMNNPP：0.1.0 */
const APP_CLIENT_VERSION = 65536;

export const MessageItemType = { NONE: 0, TEXT: 1, IMAGE: 2, VOICE: 3, FILE: 4, VIDEO: 5 } as const;
export const MessageType = { NONE: 0, USER: 1, BOT: 2 } as const;
export const MessageState = { NEW: 0, GENERATING: 1, FINISH: 2 } as const;

export interface TextItem {
  text?: string;
}
export interface MessageItem {
  type?: number;
  text_item?: TextItem;
  image_item?: Record<string, unknown>;
  voice_item?: { text?: string } & Record<string, unknown>;
  file_item?: Record<string, unknown>;
  video_item?: Record<string, unknown>;
}
export interface WeixinMessage {
  seq?: number;
  message_id?: string;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  session_id?: string;
  group_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: MessageItem[];
  context_token?: string;
  run_id?: string;
}

export type QrcodeStatus =
  | "wait" | "scaned" | "confirmed" | "expired"
  | "need_verifycode" | "verify_code_blocked" | "scaned_but_redirect" | "binded_redirect";

export interface QrcodeLoginResult {
  status: QrcodeStatus;
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
  redirect_host?: string;
}

export interface GetUpdatesResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

/** 随机 uint32（十进制字符串）再 base64——官方 X-WECHAT-UIN */
function randomWechatUin(): string {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  const v = (((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0).toString(10);
  return btoa(v);
}

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
    "iLink-App-Id": APP_ID,
    "iLink-App-ClientVersion": String(APP_CLIENT_VERSION),
  };
  if (token?.trim()) h.Authorization = `Bearer ${token.trim()}`;
  return h;
}

function baseInfo(): { channel_version: string; bot_agent: string } {
  return { channel_version: CHANNEL_VERSION, bot_agent: "OneTHU" };
}

async function postJson<T>(
  baseUrl: string,
  endpoint: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<T> {
  const res = await http.request(`${baseUrl.replace(/\/+$/, "")}/${endpoint}`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ ...body, base_info: baseInfo() }),
    direct: true,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${endpoint} HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

async function getJson<T>(baseUrl: string, endpoint: string, token?: string): Promise<T> {
  const res = await http.request(`${baseUrl.replace(/\/+$/, "")}/${endpoint}`, {
    headers: headers(token),
    direct: true,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${endpoint} HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

/* ── 扫码登录 ── */

export async function fetchBotQrcode(botType = ILINK_BOT_TYPE): Promise<{ qrcode: string; qrcode_img_content: string }> {
  return postJson(`${ILINK_API_BASE}`, `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`, {
    local_token_list: [],
  });
}

export async function pollQrcodeStatus(
  qrcode: string,
  opts: { baseUrl?: string; verifyCode?: string } = {},
): Promise<QrcodeLoginResult> {
  const base = opts.baseUrl ?? ILINK_API_BASE;
  let q = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
  if (opts.verifyCode) q += `&verify_code=${encodeURIComponent(opts.verifyCode)}`;
  return getJson(base, q);
}

/* ── Bot API ── */

export async function getUpdates(baseUrl: string, token: string, buf: string): Promise<GetUpdatesResp> {
  return postJson(baseUrl, "ilink/bot/getupdates", { get_updates_buf: buf }, token);
}

export function buildTextMessage(to: string, text: string, contextToken?: string): WeixinMessage {
  const id = `onethu:${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  return {
    from_user_id: "",
    to_user_id: to,
    client_id: id,
    message_type: MessageType.BOT,
    message_state: MessageState.FINISH,
    item_list: text ? [{ type: MessageItemType.TEXT, text_item: { text } }] : undefined,
    context_token: contextToken,
  };
}

export async function sendMessage(
  baseUrl: string,
  token: string,
  msg: WeixinMessage,
): Promise<{ ret?: number; errmsg?: string; message_id?: string }> {
  const r = await postJson<{ ret?: number; errmsg?: string; message_id?: string }>(
    baseUrl, "ilink/bot/sendmessage", { msg }, token,
  );
  if (r.ret && r.ret !== 0) throw new Error(`sendMessage ret=${r.ret} errmsg=${r.errmsg ?? "(none)"}`);
  return r;
}

/** 文本提取（官方 inbound.ts bodyFromItemList 同款：TEXT 优先，语音转文字兜底） */
export function extractText(msg: WeixinMessage): string {
  for (const item of msg.item_list ?? []) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) return String(item.text_item.text);
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) return item.voice_item.text;
  }
  return "";
}

/* ── 入站附件提取（图片/文件；语音首版跳过——silk 转码另做） ── */

interface CdnMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  full_url?: string;
}

function cdnFetchUrl(media?: CdnMedia): string | null {
  if (!media) return null;
  if (media.full_url) return media.full_url;
  if (media.encrypt_query_param) {
    return `${ILINK_CDN_BASE}/download?encrypted_query_param=${encodeURIComponent(media.encrypt_query_param)}`;
  }
  return null;
}

/** hex 字符串 → base64（官方：image_item.aeskey 是 hex 形态的 16 字节 key） */
function hexToBase64(hex: string): string | null {
  const clean = hex.trim();
  if (!/^[0-9a-fA-F]{32}$/.test(clean)) return null;
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return btoa(String.fromCharCode(...bytes));
}

export interface WeixinAttachment {
  kind: "image" | "file" | "video" | "audio";
  name: string;
  ref: AttachmentRef;
}

/** 从一条消息的 item_list 提取可转存附件（对齐官方 media-download.ts 的引用形态） */
export function extractAttachments(msg: WeixinMessage): WeixinAttachment[] {
  const out: WeixinAttachment[] = [];
  for (const item of msg.item_list ?? []) {
    if (item.type === MessageItemType.IMAGE) {
      const img = item.image_item as { media?: CdnMedia; aeskey?: string } | undefined;
      const url = cdnFetchUrl(img?.media);
      if (!url) continue;
      const aesKey = img?.aeskey ? (hexToBase64(img.aeskey) ?? img.media?.aes_key) : img?.media?.aes_key;
      out.push({ kind: "image", name: `image-${Date.now()}.jpg`, ref: { fetchUrl: url, aesKey: aesKey ?? undefined } });
    } else if (item.type === MessageItemType.FILE) {
      const f = item.file_item as { media?: CdnMedia; file_name?: string } | undefined;
      const url = cdnFetchUrl(f?.media);
      if (!url) continue;
      out.push({
        kind: "file",
        name: f?.file_name || `file-${Date.now()}.bin`,
        ref: { fetchUrl: url, aesKey: f?.media?.aes_key ?? undefined },
      });
    } else if (item.type === MessageItemType.VIDEO) {
      const v = item.video_item as { media?: CdnMedia } | undefined;
      const url = cdnFetchUrl(v?.media);
      if (!url) continue;
      out.push({ kind: "video", name: `video-${Date.now()}.mp4`, ref: { fetchUrl: url, aesKey: v?.media?.aes_key ?? undefined } });
    }
    // VOICE：silk 需转码，首版不转存（registry 会如实回执）
  }
  return out;
}
