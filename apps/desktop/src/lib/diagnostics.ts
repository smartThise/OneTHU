/** 一键诊断摘要（2026-09-23，#42 取证口径）。
 *
 * 为什么单独做这个：运行日志里有学号、姓名、课程数据，用户不愿意交（这是对的），
 * 但「会话已失效」这类问题没有现场就只能猜。这里只取判断故障所需的那几件事——
 * 版本、运行环境、登录状态、回页种类、页面长度——学号、姓名、票据一律遮蔽或根本
 * 不取。用户点一下复制，粘到反馈里即可。
 */

import { APP_CODENAME } from "./update.js";
import { isAndroidNavigator } from "./androidHost.js";
import { isTauri, loadRemembered, learn, session } from "./clients.js";
import { lastErrorText } from "./transport.js";

declare const __APP_VERSION__: string;

/** 学号/课程号等长数字、票据值、邮箱一律遮蔽——摘要要能公开贴出来。 */
export function redactDiagnostics(text: string): string {
  return String(text ?? "")
    .replace(/(_csrf|JSESSIONID|XSRF-TOKEN|ticket|wengine_vpn_ticket)=[^&\s;"']+/gi, "$1=***")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, "***@***")
    .replace(/\b\d{7,}\b/g, (m) => `${m.slice(0, 3)}${"*".repeat(m.length - 3)}`);
}

function hostLabel(): string {
  if (!isTauri) return "浏览器预览";
  return isAndroidNavigator(navigator) ? "Android" : "桌面";
}

function oneLine(s: string, max: number): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : "-";
}

/** 摘要正文（纯文本，可直接粘贴到反馈里）。 */
export async function buildDiagnostics(): Promise<string> {
  const remembered = await loadRemembered().catch(() => null);
  const rows: Array<[string, string]> = [
    ["版本", `OneTHU ${__APP_VERSION__} “${APP_CODENAME}”`],
    ["环境", `${hostLabel()} · ${navigator.userAgent.slice(0, 90)}`],
    ["时间", new Date().toISOString()],
    ["登录状态", `${session.state} · 已保存密码 ${remembered ? "是" : "否"}`],
    ["学习会话", learn.lastCsrfDebug || "本次运行没有取过"],
    ["课程页", oneLine(learn.lastDebug, 200)],
    ["分组页", oneLine(learn.lastGroupsDebug, 140)],
    ["讨论区", oneLine(learn.lastBbsThreadDebug, 140)],
    ["详情页", oneLine(learn.lastPageDetailDebug, 140)],
    ["最近报错", oneLine(lastErrorText(), 200)],
  ];
  return redactDiagnostics(rows.map(([k, v]) => `${k}：${v}`).join("\n"));
}
