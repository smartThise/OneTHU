/**
 * 飞书「扫码一键创建应用」客户端（OAuth Device-Code 流）。
 *
 * 移植自 openclaw extensions/feishu/src/app-registration.ts（2026-10-09 版；
 * 端点与参数依据其源码 + 飞书官方文档 mcp_open_tools/scan-to-create-an-app-in-one-click）。
 *
 * 流程（对标 zcode Bot Channel 的「扫码创建应用」体验）：
 *  1. begin：POST accounts.feishu.cn/oauth/v1/app/registration {action:begin,
 *     archetype:PersonalAgent, auth_method:client_secret, request_user_info:open_id}
 *     → { device_code, verification_uri_complete, interval, expire_in }
 *  2. 展示 verification_uri_complete 二维码 → 用户手机飞书扫码 → 确认创建智能体应用
 *  3. poll：POST {action:poll, device_code} → 成功返回 client_id/client_secret
 *     （即 App ID / App Secret）与 open_id（应用所有者，用于锁定 allowlist）
 *
 * 错误码：authorization_pending（继续等）/ slow_down（+5s）/ access_denied / expired_token。
 * 海外 Lark：poll 返回 user_info.tenant_brand === "lark" 时切到 accounts.larksuite.com。
 */
import { http } from "../lib/clients.js";
import { t as i18n } from "../i18n/index.js";


const FEISHU_ACCOUNTS = "https://accounts.feishu.cn";
const LARK_ACCOUNTS = "https://accounts.larksuite.com";
const PATH = "/oauth/v1/app/registration";

function accountsBase(domain: "feishu" | "lark"): string {
  return domain === "lark" ? LARK_ACCOUNTS : FEISHU_ACCOUNTS;
}

async function postRegistration(base: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await http.request(`${base}${PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    direct: true,
  });
  // 轮询中/错误态也返回 JSON（可能 4xx）——按文本解析，解析不了才抛 HTTP 错
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`app-registration HTTP ${res.status}: ${text.slice(0, 160)}`);
  }
}

export interface FeishuRegSession {
  deviceCode: string;
  qrUrl: string;
  intervalSec: number;
  expireInSec: number;
}

/** 第 1-2 步：取二维码 URL（用户手机飞书扫码 → 确认创建应用） */
export async function beginFeishuRegistration(): Promise<FeishuRegSession> {
  const r = await postRegistration(FEISHU_ACCOUNTS, {
    action: "begin",
    archetype: "PersonalAgent",
    auth_method: "client_secret",
    request_user_info: "open_id",
  });
  const uri = String(r.verification_uri_complete ?? "");
  if (!uri) throw new Error(`begin 未返回二维码地址：${JSON.stringify(r).slice(0, 160)}`);
  const qrUrl = new URL(uri);
  qrUrl.searchParams.set("from", "oc_onboard");
  qrUrl.searchParams.set("tp", "ob_cli_app");
  return {
    deviceCode: String(r.device_code ?? ""),
    qrUrl: qrUrl.toString(),
    intervalSec: Number(r.interval ?? 5) || 5,
    expireInSec: Number(r.expire_in ?? 600) || 600,
  };
}

export interface FeishuRegResult {
  status: "success" | "pending" | "access_denied" | "expired" | "error";
  appId?: string;
  appSecret?: string;
  openId?: string;
  note: string;
}

/** 第 3 步：单次轮询（UI 驱动；由调用方按 interval 节奏重复调用） */
export async function pollFeishuRegistration(
  s: FeishuRegSession,
  domain: "feishu" | "lark" = "feishu",
): Promise<FeishuRegResult> {
  const r = (await postRegistration(accountsBase(domain), {
    action: "poll",
    device_code: s.deviceCode,
  })) as {
    client_id?: string;
    client_secret?: string;
    user_info?: { open_id?: string; tenant_brand?: string };
    error?: string;
    error_description?: string;
  };

  // 海外租户：切 Lark 域重试（下次轮询生效——返回 pending 让调用方继续）
  if (r.user_info?.tenant_brand === "lark" && domain === "feishu") {
    return { status: "pending", note: i18n("auto.im.feishuReg.p1") };
  }
  if (r.client_id && r.client_secret) {
    return {
      status: "success",
      appId: r.client_id,
      appSecret: r.client_secret,
      openId: r.user_info?.open_id,
      note: i18n("auto.im.feishuReg.p2"),
    };
  }
  switch (r.error) {
    case undefined:
    case "authorization_pending":
      return { status: "pending", note: i18n("auto.im.feishuReg.p3") };
    case "slow_down":
      return { status: "pending", note: i18n("auto.im.feishuReg.p4") };
    case "access_denied":
      return { status: "access_denied", note: i18n("auto.im.feishuReg.p5") };
    case "expired_token":
      return { status: "expired", note: i18n("auto.im.feishuReg.p6") };
    default:
      return { status: "error", note: `${r.error}: ${r.error_description ?? "未知原因"}` };
  }
}
