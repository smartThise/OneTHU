/**
 * 校园财务三件 —— thu-info-lib basics.ts getInvoiceList / getInvoicePDF /
 * getBankPayment(+Parellize) / parseAndFilterBankPayment / getGraduateIncome 的
 * 纯解析层（逐字移植；I/O 与业务漫游在 client.ts 挂载）。
 *
 * - 发票：dzpj getList.do POST {page,limit:20,columnName:"inv_date",sort:"desc"}
 *   → {data,count}；PDF 端点响应字节 → base64（lib uFetch base64 路径等价）。
 * - 银行代发：查询页 <option value=年份> 多选，POST year=…&year=…（UTF-8 编码，
 *   同名重复键），响应 HTML 逐月分块：<strong>YYYY年MM月银行代发结果</strong>
 *   后随 <table>，行切片(1,-1) 去表头/合计，列 1-6 全文本、列 7-11 取首个子元素
 *   文本（lib getCheerioText(td.children[0])），行内反序（lib .get().reverse()）。
 * - 研究生收入：zzjl pageList POST → {object:{rows}} 字段逐一映射。
 * - 错误语义：无数据一律空数组/空对象，不抛会话错误；结构异常抛普通 Error
 *   由 client 层归类。
 */
import type { BankPaymentByMonth, GraduateIncome, Invoice, InvoicePage } from "./types.js";
import { cellText, decodeHtmlEntities, firstChildText, tdInners } from "./htmltext.js";

/* --------------------------- base64（发票 PDF 用） --------------------------- */

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** 字节 → base64（无 padding 省略；lib uFetch base64 路径等价，RN/Node 通用） */
export function base64FromBytes(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const has1 = i + 1 < bytes.length;
    const has2 = i + 2 < bytes.length;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | (has1 ? b1 >> 4 : 0)];
    out += has1 ? B64_ALPHABET[((b1 & 0x0f) << 2) | (has2 ? b2 >> 6 : 0)] : "=";
    out += has2 ? B64_ALPHABET[b2 & 0x3f] : "=";
  }
  return out;
}

/* ------------------------------- 电子发票 ------------------------------- */

/** 发票列表 JSON 容错映射（lib getInvoiceList：uFetch(...).then(JSON.parse) 原样） */
export function parseInvoiceList(json: unknown): InvoicePage {
  const j = json as { data?: unknown; count?: unknown };
  const data = Array.isArray(j.data) ? (j.data as Invoice[]) : [];
  const count = Number(j.count ?? data.length);
  return { data, count: Number.isFinite(count) ? count : data.length };
}

/* ------------------------------- 银行代发 ------------------------------- */

/** 查询页年份选项（lib $("option").map(attribs.value)：仅取带 value 属性者） */
export function parseBankYearOptions(html: string): string[] {
  return [...html.matchAll(/<option\b[^>]*\bvalue=["']([^"']*)["'][^>]*>/gi)].map(
    (m) => decodeHtmlEntities(m[1] ?? ""),
  );
}

/**
 * 代发结果 HTML → 按月分组（lib parseAndFilterBankPayment 逐字移植）。
 * <strong>YYYY年MM月银行代发结果</strong> 命中的，取其后至下一个 strong 之间
 * 的第一张表（lib 以 strong 父节点的下下个兄弟节点必须是 table 为界 —— 同页逐月
 * block 相邻，此为等价实现），行切片(1,-1) 后逐列映射并反序。
 */
export function parseBankPayment(html: string): BankPaymentByMonth[] {
  const out: BankPaymentByMonth[] = [];
  const strongs = [...html.matchAll(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi)];
  for (let i = 0; i < strongs.length; i++) {
    const strong = strongs[i]!;
    const res = /(\d+年\d+月)银行代发结果/.exec(cellText(strong[1] ?? ""));
    if (res === null) continue;
    const from = (strong.index ?? 0) + strong[0].length;
    const to = i + 1 < strongs.length ? (strongs[i + 1]!.index ?? html.length) : html.length;
    const table = /<table\b[^>]*>([\s\S]*?)<\/table>/i.exec(html.slice(from, to))?.[1];
    if (table === undefined) continue;
    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1] ?? "");
    const body = rows.slice(1, rows.length - 1); // lib slice(1, -1)：去表头与合计行
    const payment = body
      .map((row) => {
        const cells = tdInners(row);
        return {
          department: cellText(cells[1] ?? ""),
          project: cellText(cells[2] ?? ""),
          usage: cellText(cells[3] ?? ""),
          description: cellText(cells[4] ?? ""),
          bank: cellText(cells[5] ?? ""),
          time: cellText(cells[6] ?? ""),
          // 金额五列：lib getCheerioText((columns[N]).children[0], 0) —— 取首个子元素文本
          total: firstChildText(cells[7] ?? ""),
          deduction: firstChildText(cells[8] ?? ""),
          actual: firstChildText(cells[9] ?? ""),
          deposit: firstChildText(cells[10] ?? ""),
          cash: firstChildText(cells[11] ?? ""),
        };
      })
      .reverse(); // lib .get().reverse()
    out.push({ month: res[1] ?? "", payment });
  }
  return out;
}

/**
 * 银行代发检索的并行分块（lib getBankPaymentParellize 逐字移植）：
 * loadPartial → 前 3 个月一次请求；否则全部年份按 ceil(n/3) 均分为 3 份并行。
 */
export function splitBankYearBatches(
  options: string[],
  loadPartial: boolean,
): string[][] {
  const PARTIAL_NUM = 3;
  const MAX_PARALLEL_TASKS = 3;
  if (loadPartial) {
    return [options.slice(0, Math.min(PARTIAL_NUM, options.length))];
  }
  const chunk = Math.ceil(options.length / MAX_PARALLEL_TASKS);
  return Array.from({ length: MAX_PARALLEL_TASKS }, (_, i) =>
    options.slice(i * chunk, (i + 1) * chunk),
  );
}

/* ------------------------------ 研究生收入 ------------------------------ */

/** pageList 响应 → 收入记录（lib getGraduateIncome 字段映射逐字） */
export function parseGraduateIncome(text: string): GraduateIncome[] {
  const j = JSON.parse(text) as {
    object?: { rows?: Array<Record<string, unknown>> };
  };
  const rows = j.object?.rows;
  if (!Array.isArray(rows)) {
    throw new Error(`研究生收入响应缺少 object.rows（resp=${text.slice(0, 80).replace(/\s+/g, " ")}）`);
  }
  return rows.map((row) => ({
    id: String(row.id ?? ""),
    year: String(row.ffnf ?? ""), // 发放年
    month: String(row.ffyf ?? ""), // 发放月
    date: String(row.ffrq ?? ""), // 发放日期
    ym: String(row.ffrqChs ?? ""), // 发放日期中文
    name: String(row.dfytmc ?? ""), // 项目名
    department: String(row.xmssbmmc ?? ""), // 部门
    beforeTax: Number(row.yfje ?? 0), // 应发
    afterTax: Number(row.sfje ?? 0), // 实发
    tax: Number(row.ksje ?? 0), // 扣税
  }));
}
