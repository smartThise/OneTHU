/**
 * CalDAV 客户端 —— 清华邮箱（Coremail）日程云同步。
 *
 * 实测能力边界（2026-09 探针，tools/caldav-probe.sh）：
 * - 端点发现：PROPFIND /.well-known/caldav → 302 Location = 真实 DAV 根
 *   （/coremail/dav/users/<email>/），手工跟随（重定向语义要自己掌控）。
 * - 认证：HTTP Basic，用户名=完整邮箱，密码=webmail 生成的客户端专用密码。
 * - 无 CTAG / sync-token → 同步策略=每次全量 Depth:1 getetag 扫描 + 本地
 *   etag 缓存比对，学生量级（百级事件）毫秒级完成。
 * - PUT 资源名必须=UID：服务器按 UID 重写文件名。客户端一律 PUT 到 <uid>.ics。
 * - MKCALENDAR 假 200 不建集合 → 只使用账号自带 default 日历；配置同步
 *   走 IMAP 独立文件夹（另一条线）。
 * - 服务器规范化响应：注入 VTIMEZONE / METHOD:PUBLISH —— 解析宽容处理。
 */

import type { FetchLike } from "../http.js";

export interface CalDavAccount {
  /** 完整邮箱地址（例：someone@mails.tsinghua.edu.cn） */
  email: string;
  /** webmail 生成的客户端专用密码（授权码） */
  authCode: string;
}

export interface CalendarInfo {
  /** 绝对 URL（事件 PUT/GET 直接在其下拼接） */
  url: string;
  displayName: string;
}

export interface EventMeta {
  href: string;
  etag: string;
  /** 从资源名还原的 UID（服务器保证 资源名=UID.ics） */
  uid: string;
}

export class CalDavError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "CalDavError";
    this.status = status;
  }
}

const xmlDecode = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

/** 前缀无关取首个元素文本（d:/D:/cal: 前缀服务器自选） */
function xmlText(xml: string, local: string): string | undefined {
  const m = new RegExp(`<(?:[A-Za-z0-9]+:)?${local}(?:\\s[^>]*)?>([^<]*)<`, "i").exec(xml);
  return m && m[1] !== undefined ? xmlDecode(m[1]) : undefined;
}

export class CalDavClient {
  readonly #fetch: FetchLike;
  readonly #account: CalDavAccount;
  readonly #host: string;
  #root: string | null = null;
  #calendar: CalendarInfo | null = null;

  constructor(fetchLike: FetchLike, account: CalDavAccount, host = "https://mails.tsinghua.edu.cn") {
    this.#fetch = fetchLike;
    this.#account = account;
    this.#host = host.replace(/\/$/, "");
  }

  /** Basic 头（凭据只在请求头里出现，绝不进日志/错误消息） */
  get #authHeader(): Record<string, string> {
    return { Authorization: "Basic " + btoa(this.#account.email + ":" + this.#account.authCode) };
  }

  async #request(method: string, url: string, body?: string, headers: Record<string, string> = {}, manual = true): Promise<Response> {
    const res = await this.#fetch(url, {
      method,
      headers: { ...this.#authHeader, ...headers },
      body,
      redirect: "manual",
    } as RequestInit);
    return res;
  }

  /**
   * 端点发现：well-known 302 → 真实 DAV 根。
   * 401 = 授权码错/失效；非 302 且非 207 直接抛带状态码的错误。
   */
  async discover(): Promise<string> {
    if (this.#root) return this.#root;
    const res = await this.#request("PROPFIND", `${this.#host}/.well-known/caldav`,
      '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>',
      { Depth: "0", "Content-Type": "application/xml" });
    if (res.status === 401 || res.status === 403) throw new CalDavError("授权失败：请检查邮箱地址与客户端专用密码（webmail 设置中生成/重发）", res.status);
    let root: string | undefined;
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (loc) root = new URL(loc, `${this.#host}/.well-known/caldav`).toString();
    } else if (res.status === 207) {
      root = `${this.#host}/.well-known/caldav`;
    }
    if (!root) throw new CalDavError(`端点发现失败（HTTP ${res.status}）`, res.status);
    // 验证根可用（401 在这层同样报授权失败）
    const probe = await this.#request("PROPFIND", root,
      '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><C:calendar-home-set/></D:prop></D:propfind>',
      { Depth: "0", "Content-Type": "application/xml" });
    if (probe.status === 401 || probe.status === 403) throw new CalDavError("授权失败：请检查邮箱地址与客户端专用密码", probe.status);
    if (probe.status !== 207) throw new CalDavError(`DAV 根不可用（HTTP ${probe.status}）`, probe.status);
    this.#root = root;
    return root;
  }

  /** calendar-home-set（principal 上取） */
  async #homeSet(): Promise<string> {
    const root = await this.discover();
    const res = await this.#request("PROPFIND", root,
      '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><C:calendar-home-set/></D:prop></D:propfind>',
      { Depth: "0", "Content-Type": "application/xml" });
    if (res.status !== 207) throw new CalDavError(`读取 calendar-home-set 失败（HTTP ${res.status}）`, res.status);
    const xml = await res.text();
    const href = /<(?:[A-Za-z0-9]+:)?calendar-home-set[^>]*>\s*<(?:[A-Za-z0-9]+:)?href[^>]*>([^<]*)</i.exec(xml)?.[1];
    if (!href) throw new CalDavError("服务器未返回 calendar-home-set");
    return new URL(xmlDecode(href.trim()), root).toString();
  }

  /** 列出账号下全部日历集合（当前服务器只有 default 一个） */
  async listCalendars(): Promise<CalendarInfo[]> {
    const home = await this.#homeSet();
    const res = await this.#request("PROPFIND", home,
      '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:displayname/><D:resourcetype/></D:prop></D:propfind>',
      { Depth: "1", "Content-Type": "application/xml" });
    if (res.status !== 207) throw new CalDavError(`日历列表读取失败（HTTP ${res.status}）`, res.status);
    const xml = await res.text();
    const out: CalendarInfo[] = [];
    for (const block of xml.split(/<(?:[A-Za-z0-9]+:)?response[\s>]/i).slice(1)) {
      if (!/<(?:[A-Za-z0-9]+:)?calendar\s*\/>/i.test(block)) continue;
      const href = /<(?:[A-Za-z0-9]+:)?href[^>]*>([^<]*)</i.exec(block)?.[1];
      if (!href) continue;
      const url = new URL(xmlDecode(href.trim()), home).toString();
      out.push({ url, displayName: xmlText(block, "displayname") ?? decodeURIComponent(url.split("/").filter(Boolean).pop() ?? "日历") });
    }
    return out;
  }

  /** 主日历（第一个；当前服务器=default「Calendar」）。结果缓存。 */
  async mainCalendar(): Promise<CalendarInfo> {
    if (this.#calendar) return this.#calendar;
    const list = await this.listCalendars();
    if (list.length === 0) throw new CalDavError("账号下没有可用日历集合");
    // 优先 default
    const pick = list.find((c) => /\/default\/?$/.test(c.url)) ?? list[0];
    if (!pick) throw new CalDavError("账号下没有可用日历集合");
    this.#calendar = pick;
    return pick;
  }

  /** 事件资源清单（全量 etag 扫描——本服务器无增量通道） */
  async listEvents(): Promise<EventMeta[]> {
    const cal = await this.mainCalendar();
    const res = await this.#request("PROPFIND", cal.url,
      '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:getetag/></D:prop></D:propfind>',
      { Depth: "1", "Content-Type": "application/xml" });
    if (res.status !== 207) throw new CalDavError(`事件清单读取失败（HTTP ${res.status}）`, res.status);
    const xml = await res.text();
    const base = cal.url;
    const out: EventMeta[] = [];
    for (const block of xml.split(/<(?:[A-Za-z0-9]+:)?response[\s>]/i).slice(1)) {
      const href = /<(?:[A-Za-z0-9]+:)?href[^>]*>([^<]*)</i.exec(block)?.[1];
      if (!href || !href.endsWith(".ics")) continue;
      const clean = xmlDecode(href.trim());
      const etag = (xmlText(block, "getetag") ?? "").replace(/^"|"$/g, "");
      const name = clean.split("/").pop() ?? "";
      const uid = decodeURIComponent(name.replace(/\.ics$/, ""));
      out.push({ href: new URL(clean, base).toString(), etag, uid });
    }
    return out;
  }

  /** 拉取单个事件原始 ICS */
  async getIcs(href: string): Promise<string> {
    const res = await this.#request("GET", href);
    if (res.status !== 200) throw new CalDavError(`事件读取失败（HTTP ${res.status}）`, res.status);
    return res.text();
  }

  /** 写入/覆盖事件（资源名=UID，服务器按 UID 落盘） */
  async putIcs(uid: string, ics: string): Promise<void> {
    const cal = await this.mainCalendar();
    const res = await this.#request("PUT", `${cal.url.replace(/\/?$/, "/")}${encodeURIComponent(uid)}.ics`, ics,
      { "Content-Type": "text/calendar; charset=utf-8" });
    if (res.status !== 201 && res.status !== 204 && res.status !== 200) {
      throw new CalDavError(`事件写入失败（HTTP ${res.status}）`, res.status);
    }
  }

  /** 删除事件 */
  async deleteEvent(href: string): Promise<void> {
    const res = await this.#request("DELETE", href);
    if (res.status !== 204 && res.status !== 200 && res.status !== 404) {
      throw new CalDavError(`事件删除失败（HTTP ${res.status}）`, res.status);
    }
  }

  /** 连接测试：发现+列日历，返回日历名（供设置页展示） */
  async testConnection(): Promise<{ ok: true; calendars: string[] }> {
    const list = await this.listCalendars();
    return { ok: true, calendars: list.map((c) => c.displayName) };
  }
}
