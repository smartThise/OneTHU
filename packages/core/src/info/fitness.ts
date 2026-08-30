/**
 * 体测成绩 —— thu-info-lib basics.ts getPhysicalExamResult + physicalExamResultTotal
 * 的纯映射层（逐字移植；I/O 与 zhjw 业务漫游 yyfw 8BF4F9A7… 在 client.ts 挂载）。
 *
 * 错误语义（core 铁律）：lib 的 success==="false" 分支返回 [["状态","暂无可查成绩"]]
 * —— 此处返回 null，client 层转空数组（UI 自行显示「暂无」）；
 * 会话失效/服务瘫痪的归类在 client 层完成。
 */

/** 参考总分（lib physicalExamResultTotal 逐字公式） */
export function physicalExamTotal(json: Record<string, unknown>): number {
  return (
    Number(json.fhltzfs) * 0.15 +
    Number(json.wsmpfs) * 0.2 +
    Number(json.zwtqqfs) * 0.1 +
    Number(json.ldtyfs) * 0.1 +
    Number(json.ytxsfs) * 0.1 +
    Number(json.yqmpfs) * 0.2 +
    Number(json.ywqzfs) * 0.1 +
    Number(json.bbmpfs) * 0.2 +
    Number(json.sgtzfs) * 0.15
  );
}

const s = (json: Record<string, unknown>, key: string): string => String(json[key] ?? "");

/**
 * 体测响应 → JSON。实测存在两种形态：裸 JSON 与 JSONP 括号包裹
 * `({'success':'false'})`，且括号内是**单引号非严格 JSON**。
 * 剥首尾括号（及可能的 `;`）→ 严格 parse → 失败则单引号归一为双引号再 parse
 * （成绩字段为数字/汉字，值内不含单引号，整体替换安全）。
 */
export function parsePhysicalExamJson(text: string): Record<string, unknown> {
  let t = text.trim();
  const open = t.indexOf("(");
  const close = t.lastIndexOf(")");
  if (open >= 0 && close > open) t = t.slice(open + 1, close).trim().replace(/;\s*$/, "");
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    return JSON.parse(t.replace(/'/g, '"')) as Record<string, unknown>;
  }
}

/**
 * 体测 JSON → [项目, 结果] 行（lib getPhysicalExamResult 逐字段对照）。
 * success === "false"（注意是字符串形态）→ null = 暂无可查成绩。
 */
export function parsePhysicalExamResult(
  json: Record<string, unknown>,
): Array<[string, string]> | null {
  if (String(json.success ?? "") === "false") return null;
  const total = physicalExamTotal(json);
  return [
    ["是否免测", s(json, "sfmc")],
    ["免测原因", s(json, "mcyy")],
    ["总分", s(json, "zf")],
    ["标准分", s(json, "bzf")],
    ["附加分", s(json, "fjf")],
    ["长跑附加分", s(json, "cpfjf")],
    // 参考总分：lib 直接内插数字；NaN（缺项）时给空串避免渲染 "NaN"
    [
      "参考成绩（APP自动结算，仅供参考）",
      Number.isFinite(total) ? String(total) : "",
    ],
    ["身高", s(json, "sg")],
    ["体重", s(json, "tz")],
    ["身高体重分数", s(json, "sgtzfs")],
    ["肺活量", s(json, "fhl")],
    ["肺活量分数", s(json, "fhltzfs")],
    ["800M跑", s(json, "bbmp")],
    ["800M跑分数", s(json, "bbmpfs")],
    ["1000M跑", s(json, "yqmp")],
    ["1000M跑分数", s(json, "yqmpfs")],
    ["50M跑", s(json, "wsmp")],
    ["50M跑分数", s(json, "wsmpfs")],
    ["立定跳远", s(json, "ldty")],
    ["立定跳远分数", s(json, "ldtyfs")],
    ["坐位体前屈", s(json, "zwtqq")],
    ["坐位体前屈分数", s(json, "zwtqqfs")],
    ["仰卧起坐", s(json, "ywqz")],
    ["仰卧起坐分数", s(json, "ywqzfs")],
    ["引体向上", s(json, "ytxs")],
    ["引体向上分数", s(json, "ytxsfs")],
    ["体育课成绩", s(json, "tykcj")],
  ];
}
