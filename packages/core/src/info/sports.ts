/**
 * 体育场馆预约 —— thu-info-lib src/lib/sports.ts 全量移植（382 行逐字对照）。
 *
 * 分工：本模块 = 纯解析 + 常量（可单测）；fetch/漫游/错误分类在 client.ts
 * （#serviceRoamed(SPORTS_ROAM_ID) 承担 lib roamingWrapperWithMocks("default",
 * 5539ECF8…)）。端点见 urls.ts SPORTS_*（lib webvpn 常量逐字）。
 *
 * DOM 语义（无 cheerio 的等价实现，见 PORTED.md「已知偏差」微 DOM 条目）：
 * - getCheerioText(el, i) = el.children[i] 首个文本节点 trim —— 等价于取 td 内
 *   首个标签前文本段 trim（lib 页面 td 间无空白节点，children[i] 即 td[i]）；
 * - tr[style='display:none'] 的嵌套 table 用 <tr>/<tbody> 深度扫描取完整块；
 * - onclick 提取按支付方式分支正则（payNow / unsubscribeOnline / unsubscribe，
 *   后者负向后行断言排除 unsubscribeOnline）；
 * - 响应编码：支付表单页为 GBK —— 桌面传输层（reqwest charset）已转 UTF-8；
 *   请求体中文（xm 收据抬头）按 UTF-8 上送（lib 为 GBK 编码）。
 */
import type { SportsResource, SportsReservationRecord, SportsIdInfo } from "./types.js";

/** 收据抬头（线上支付申领发票用；UI 标注线下支付为主） */
export const VALID_RECEIPT_TITLES = ["清华大学", "清华大学工会", "清华大学教育基金会"] as const;
export type ValidReceiptTitle = (typeof VALID_RECEIPT_TITLES)[number];

/** 场馆元数据表（lib sportsIdInfoList 逐字） */
export const sportsIdInfoList: SportsIdInfo[] = [
  { name: "气膜馆羽毛球场", gymId: "3998000", itemId: "4045681" },
  { name: "气膜馆乒乓球场", gymId: "3998000", itemId: "4037036" },
  { name: "综体篮球场", gymId: "4797914", itemId: "4797898" },
  { name: "综体羽毛球场", gymId: "4797914", itemId: "4797899" },
  { name: "西体羽毛球场", gymId: "4836273", itemId: "4836196" },
  { name: "西体台球", gymId: "4836273", itemId: "14567218" },
  { name: "紫荆网球场", gymId: "5843934", itemId: "5845263" },
  { name: "西网球场", gymId: "5843934", itemId: "10120539" },
];

/* ----------------------------- 限额页（getSportsResourceLimit 解析半边） ----------------------------- */

/** var limitBookCount / limitBookInit；缺标记 → null（上游结构变，client 归类报错） */
export function parseSportsResourceLimit(html: string): { count: number; init: number } | null {
  const countSearch = /var limitBookCount = '(\d+?)';/.exec(html);
  const initSearch = /var limitBookInit = '(\d+?)';/.exec(html);
  if (countSearch === null || initSearch === null) return null;
  return { count: Number(countSearch[1] ?? ""), init: Number(initSearch[1] ?? "") };
}

/* ----------------------------- 资源页（getSportsResourceData 解析半边，四步逐字） ----------------------------- */

export function parseSportsResourceData(html: string): SportsResource[] {
  const result = new Map<string, SportsResource>();

  // Step one: get total resources（lib p1 逐字：id 与 resourcesm key 一致才收录）
  const p1 = /resourceArray\.push\({id:'(.*?)',time_session:'(.*?)',field_name:'(.*?)',overlaySize:'(.*?)',can_net_book:'(.*?)'}\);[\s\S]+?resourcesm\.put\('(.*?)', '(.*?)'\)/gm;
  for (let r1 = p1.exec(html); r1 !== null; r1 = p1.exec(html)) {
    const id = r1[1] ?? "";
    if (id !== "" && id === r1[6]) {
      result.set(id, {
        resId: id,
        resHash: r1[7] ?? "",
        timeSession: r1[2] ?? "",
        fieldName: r1[3] ?? "",
        overlaySize: Number(r1[4] ?? 0),
        canNetBook: r1[5] === "1",
      });
    }
  }

  // Step two: update cost
  const p2 = /addCost\('(.*?)','(.*?)'\);/g;
  for (let r2 = p2.exec(html); r2 !== null; r2 = p2.exec(html)) {
    const cur = result.get(r2[1] ?? "");
    if (cur) cur.cost = Number(r2[2] ?? "");
  }

  // Step three: mark res status
  const p3 = /markResStatus\('(.*?)','(.*?)','(.*?)'\);/g;
  for (let r3 = p3.exec(html); r3 !== null; r3 = p3.exec(html)) {
    const cur = result.get(r3[2] ?? "");
    if (cur) {
      cur.bookId = r3[1];
      cur.locked = r3[3] === "1";
    }
  }

  // Step four: mark status color
  const p4 = /markStatusColor\('(.*?)','(.*?)','(.*?)','(.*?)'\);/g;
  for (let r4 = p4.exec(html); r4 !== null; r4 = p4.exec(html)) {
    const cur = result.get(r4[1] ?? "");
    if (cur) {
      cur.userType = r4[2];
      cur.paymentStatus = r4[3] === "1";
    }
  }

  return [...result.values()];
}

/* ----------------------------- 预约记录（getSportsReservationRecords 解析半边） ----------------------------- */

/** 从 start（<tag…> 起）按同名标签深度扫描取完整块（嵌套 table/tr 安全） */
function extractElement(html: string, start: number, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, "gi");
  re.lastIndex = start;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[0][1] === "/") {
      depth -= 1;
      if (depth === 0) return html.slice(start, m.index + m[0].length);
    } else {
      depth += 1;
    }
  }
  return null;
}

/** 块内区（去首尾标签） */
function innerOfBlock(block: string, tag: string): string {
  const openEnd = block.indexOf(">") + 1;
  const closeStart = block.lastIndexOf(`</${tag}>`);
  return closeStart > openEnd ? block.slice(openEnd, closeStart) : block.slice(openEnd);
}

/** 一行内的兄弟 td 内区序列（lib children[i] = td[i]，td 间无文本节点） */
function splitTds(inner: string): string[] {
  const tds: string[] = [];
  const re = /<td\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    const block = extractElement(inner, m.index, "td");
    if (!block) break;
    tds.push(innerOfBlock(block, "td"));
    re.lastIndex = m.index + block.length;
  }
  return tds;
}

/** getCheerioText 等价：td 内首个标签前文本段 trim（首个文本节点即此段） */
function cellText(inner: string): string {
  const m = /^([^<]*)/.exec(inner);
  return (m?.[1] ?? "").trim();
}

/** 未支付单行（12 列：1/3/5/7/9 文本 + 11 动作格）；列数不足 → null（嵌套杂行跳过） */
function parseUnpaidRow(rowInner: string): SportsReservationRecord | null {
  const tds = splitTds(rowInner);
  if (tds.length < 12) return null;
  const name = cellText(tds[1] ?? "");
  const field = cellText(tds[3] ?? "");
  const time = cellText(tds[5] ?? "");
  const price = cellText(tds[7] ?? "");
  const method = cellText(tds[9] ?? "");
  const actions = tds[11] ?? "";
  const ts = /<span[^>]*\btime=["']([^"']*)["']/i.exec(actions)?.[1];
  const bookTimestamp = ts === undefined ? undefined : Number(ts);
  let payId: string | undefined;
  let bookId: string | undefined;
  if (method === "网上支付") {
    payId = /payNow\('(.+?)'/.exec(actions)?.[1];
    bookId = /unsubscribeOnline\('(.+?)'/.exec(actions)?.[1];
  } else if (method === "现场支付") {
    bookId = /(?<!Online)unsubscribe\('(.+?)'/.exec(actions)?.[1];
  }
  return { name, field, time, price, method, bookTimestamp, bookId, payId };
}

/** 未支付订单页 → 记录；页面无 table → null（lib $("table").length===0 → SportsError） */
export function parseSportsUnpaidRecords(html: string): SportsReservationRecord[] | null {
  if (!/<table/i.test(html)) return null;
  const rows: SportsReservationRecord[] = [];
  const tbodyRe = /<tbody\b[^>]*>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = tbodyRe.exec(html)) !== null) {
    const tbodyBlock = extractElement(html, tm.index, "tbody");
    if (!tbodyBlock) continue;
    tbodyRe.lastIndex = tm.index + tbodyBlock.length;
    const inner = innerOfBlock(tbodyBlock, "tbody");
    const trRe = /<tr\b[^>]*>/gi;
    let rm: RegExpExecArray | null;
    while ((rm = trRe.exec(inner)) !== null) {
      const trBlock = extractElement(inner, rm.index, "tr");
      if (!trBlock) break;
      trRe.lastIndex = rm.index + trBlock.length;
      const rec = parseUnpaidRow(innerOfBlock(trBlock, "tr"));
      if (rec) rows.push(rec);
    }
  }
  return rows;
}

/** 已支付订单页（tr[style='display:none'] 嵌套表首个 tbody tr 的 td 2-5） */
export function parseSportsPaidRecords(html: string): SportsReservationRecord[] {
  const out: SportsReservationRecord[] = [];
  const hiddenRe = /<tr\b[^>]*style=(["'])\s*display:none\s*\1[^>]*>/gi;
  let hm: RegExpExecArray | null;
  while ((hm = hiddenRe.exec(html)) !== null) {
    const trBlock = extractElement(html, hm.index, "tr");
    if (!trBlock) break;
    hiddenRe.lastIndex = hm.index + trBlock.length;
    const inner = innerOfBlock(trBlock, "tr");
    // lib cheerio.load(e)("tbody tr").first()：parse5 会补 tbody —— 显式 tbody 或首个 tr 兜底
    const tbody = /<tbody\b[^>]*>/i.exec(inner);
    const rowSource = tbody ? innerOfBlock(extractElement(inner, tbody.index, "tbody") ?? "", "tbody") : inner;
    const firstTr = /<tr\b[^>]*>/i.exec(rowSource);
    const contentRow = firstTr ? extractElement(rowSource, firstTr.index, "tr") : null;
    if (!contentRow) continue;
    const tds = splitTds(innerOfBlock(contentRow, "tr"));
    if (tds.length < 6) continue;
    out.push({
      name: cellText(tds[2] ?? ""),
      field: cellText(tds[3] ?? ""),
      time: cellText(tds[4] ?? ""),
      price: cellText(tds[5] ?? ""),
      method: "已支付",
      bookTimestamp: undefined,
      bookId: undefined,
      payId: undefined,
    });
  }
  return out;
}

/* ----------------------------- 支付链（makeSportsReservation 后半 + paySportsReservation + generalGetPayCode 解析半边） ----------------------------- */

/** 属性值（双引/单引/裸值） */
function attrValue(tag: string, attr: string): string | undefined {
  const re = new RegExp(`\\b${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = re.exec(tag);
  return m?.[1] ?? m?.[2] ?? m?.[3];
}

/** 首个 <form> 的 action（lib $("form").attr().action）；缺 → null */
export function firstFormAction(html: string): string | null {
  const m = /<form\b[^>]*>/i.exec(html);
  if (!m) return null;
  const action = attrValue(m[0], "action");
  return action === undefined || action === "" ? null : action;
}

/** 表单控件 name→value（lib inputs.each + attribs 覆盖式赋值）。
 *  无 formId = 首个 form（lib $("form")）；formId = 该 id 的 form（#payForm）。 */
export function formInputs(html: string, formId?: string): Record<string, string> {
  const fm =
    formId === undefined
      ? /<form\b[^>]*>/i.exec(html)
      : new RegExp(`<form\\b[^>]*\\bid=["']?${formId}["']?[^>]*>`, "i").exec(html);
  const block = fm ? extractElement(html, fm.index, "form") : null;
  if (!block) return {};
  const scope = innerOfBlock(block, "form");
  const out: Record<string, string> = {};
  const re = /<input\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scope)) !== null) {
    const name = attrValue(m[0], "name");
    if (name === undefined) continue;
    out[name] = attrValue(m[0], "value") ?? "";
  }
  return out;
}

/** lib generalGetPayCode 前半：webPay 响应页 → 首个 form action + biz_content 值 */
export function parsePayEntry(paymentHtml: string): { action: string; bizContent: string } | null {
  const action = firstFormAction(paymentHtml);
  const bizContent = formInputs(paymentHtml)["biz_content"];
  if (action === null || bizContent === undefined) return null;
  return { action, bizContent };
}

/** lib generalGetPayCode 后半：qrCode input value → 取最后一个 "/" 后的支付码 */
export function parsePayQrCode(html: string): string | null {
  const m = /<input\b[^>]*\bname=["']qrCode["'][^>]*>/i.exec(html);
  if (!m) return null;
  const value = attrValue(m[0], "value") ?? "";
  return value.slice(value.lastIndexOf("/") + 1);
}
