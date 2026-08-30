/**
 * 教学评估 —— thu-info-lib basics.ts getAssessmentList / getAssessmentForm /
 * postAssessmentForm + models/home/assessment.ts 的纯解析/序列化层（逐字移植）。
 * I/O 与 jxgl.cic 业务漫游（yyfw 0D8B99BA…）在 client.ts 挂载。
 *
 * 解析对照：
 * - 列表：$("tbody").children() 逐行取 td[5]=课程名、td[9]=是否已评（"是"）、
 *   td[11] 首个带 onclick 元素 → href = ASSESSMENT_BASE_URL + onclick 内
 *   Body('…') 与 ') })' 之间的路径。
 * - 表单：#xswjtxFormid 直接 input 子节点 = basics；#kcpgjgDtos[0].jtjy 文本 =
 *   整体建议；#kcpjfs = 整体评分输入；.tab-pane 第 1/3 个 pane = 教师/助教
 *   （lib first().next().next()），pane 内逐个 table = 一个被评人，行内 input 按
 *   「有 class → 建议 / ul 直下 → 评分 / 其余无 avgfs → others」归类。
 * - 错误语义：lib AssessmentError 在此层不存在 —— 「现在不是填写问卷时间」与
 *   空列表一律返回空数组（UI 显示「暂无」），结构解析失败抛普通 Error。
 */
import type { AssessmentForm, AssessmentInputGroup, AssessmentInputTag, AssessmentPerson } from "./types.js";
import {
  cellText,
  findAttr,
  miniFindById,
  miniFindByClass,
  miniText,
  miniWalk,
  parseMiniFragment,
  tdInners,
  type MiniEl,
} from "./htmltext.js";

/** lib 原文判据：非评估期的页面文案（命中 → 空列表而非报错） */
export const ASSESSMENT_NOT_IN_PERIOD = "对不起，现在不是填写问卷时间";

/**
 * 评估课程列表（lib getAssessmentList）。
 * 返回 [课程名, 是否已评, 评估表单 URL] 三元组数组；无数据/非评估期 → []。
 */
export function parseAssessmentList(html: string, baseUrl: string): Array<[string, boolean, string]> {
  const out: Array<[string, boolean, string]> = [];
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const tds = tdInners(tr[1] ?? "");
    if (tds.length < 12) continue;
    const onclick = findAttr(tds[11] ?? "", "onclick");
    if (!onclick) continue;
    const start = onclick.indexOf("Body('");
    const end = onclick.indexOf("') })");
    if (start < 0 || end < 0 || end <= start + 6) continue;
    const path = onclick.substring(start + 6, end);
    const href = /^https?:/i.test(path) ? path : `${baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
    out.push([cellText(tds[5] ?? ""), cellText(tds[9] ?? "") === "是", href]);
  }
  return out;
}

function miniToInputTag(el: MiniEl): AssessmentInputTag {
  return { name: el.attrs.name ?? "", value: el.attrs.value ?? "" };
}

/**
 * pane 内逐个 table 解析为被评人（lib models/home/assessment.ts toPersons 逐字移植）：
 * 从首个 table 起逐个兄弟元素推进，遇到无子节点的元素停止；每个 table 的 tbody
 * 行序 = 首行含姓名单元格，且首行同样作为题项参与解析（与 lib 循环一致）。
 */
function toPersons(pane: MiniEl): AssessmentPerson[] {
  const persons: AssessmentPerson[] = [];
  let idx = pane.kids.findIndex((k) => k.tag === "table");
  if (idx < 0) return persons;
  while (idx < pane.kids.length && pane.kids[idx]!.kids.length > 0) {
    const table = pane.kids[idx]!;
    if (table.tag === "table") {
      const tbody = table.kids.find((k) => k.tag === "tbody") ?? table;
      const rows = tbody.kids.filter((k) => k.tag === "tr");
      const person = parsePersonRows(rows);
      if (person) persons.push(person);
    }
    idx++;
  }
  return persons;
}

function parsePersonRows(rows: MiniEl[]): AssessmentPerson | null {
  if (rows.length === 0) return null;
  const first = rows[0]!;
  // lib：name = tr.children().first().text()（首行首个单元格文本）
  const firstCell = first.kids.find((k) => k.tag === "td" || k.tag === "th");
  const name = miniText(firstCell).trim();
  const inputGroups: AssessmentInputGroup[] = [];
  for (const row of rows) {
    // lib：while ((children = tr.children()).length > 0) —— 空行终止
    if (row.kids.length === 0) break;
    const cells = row.kids.filter((k) => k.tag === "td" || k.tag === "th");
    if (cells.length === 0) continue;
    // lib：4 格行取第 2 格为题干，否则取第 1 格
    const question = (cells.length === 4 ? miniText(cells[1]) : miniText(cells[0])).trim();
    const inputs: Array<{ el: MiniEl; parent: MiniEl | null }> = [];
    miniWalk(row, null, (el, parent) => {
      if (el.tag === "input") inputs.push({ el, parent });
    });
    const withClass = inputs.filter((it) => it.el.attrs.class !== undefined);
    if (withClass.length !== 1) {
      throw new Error(`评估表单题项解析失败（「${question}」带 class 的输入框数量=${withClass.length}，期望 1）`);
    }
    const suggestion = miniToInputTag(withClass[0]!.el);
    const noClass = inputs.filter((it) => it.el.attrs.class === undefined);
    const scoreHits = noClass.filter((it) => it.parent?.tag === "ul");
    if (scoreHits.length !== 1) {
      throw new Error(`评估表单题项解析失败（「${question}」ul 直下评分输入框数量=${scoreHits.length}，期望 1）`);
    }
    const score = miniToInputTag(scoreHits[0]!.el);
    // lib：others = 无 class 输入再滤掉带 avgfs 属性者（评分输入通常带 avgfs，被自然排除）
    const others = noClass
      .filter((it) => it.el.attrs.avgfs === undefined)
      .map((it) => miniToInputTag(it.el));
    inputGroups.push({ question, suggestion, score, others });
  }
  return { name, inputGroups };
}

/**
 * 评估表单（lib getAssessmentForm）。url 页面 → 表单结构；
 * 结构异常（无 tab-pane 等）返回空骨架而非抛错，提交前由 invalid() 把关。
 */
export function parseAssessmentForm(html: string): AssessmentForm {
  const root = parseMiniFragment(html);
  // basics：#xswjtxFormid 的直接 input 子节点（lib $("#xswjtxFormid > input")）
  const form = miniFindById(root, "xswjtxFormid");
  const basics = (form ? form.kids.filter((k) => k.tag === "input") : []).map(miniToInputTag);
  // 整体建议：#kcpgjgDtos[0].jtjy 的文本（lib .text()，不 trim）
  const suggEl = miniFindById(root, "kcpgjgDtos[0].jtjy");
  const overallSuggestion = suggEl ? miniText(suggEl) : "";
  // 整体评分：#kcpjfs 元素的 name/value
  const scoreEl = miniFindById(root, "kcpjfs");
  const overallScore: AssessmentInputTag = {
    name: scoreEl?.attrs.name ?? "",
    value: scoreEl?.attrs.value ?? "",
  };
  const panes = miniFindByClass(root, "tab-pane");
  const firstPane = panes[0];
  const teachers = firstPane ? toPersons(firstPane) : [];
  // lib：tabPanes.first().next().next() —— 按 DOM 兄弟位次向后跳两个元素取助教
  // pane（不要求中间元素也是 pane，页面常插占位块）
  let assistants: AssessmentPerson[] = [];
  if (firstPane) {
    const loc = locateIn(root, firstPane);
    const target = loc ? loc.parent.kids[loc.idx + 2] : undefined;
    assistants = target ? toPersons(target) : [];
  }
  return { basics, overall: { suggestion: overallSuggestion, score: overallScore }, teachers, assistants };
}

/** 在微 DOM 树中定位元素的父节点与子序（兄弟位次跳转用） */
function locateIn(root: MiniEl, target: MiniEl): { parent: MiniEl; idx: number } | null {
  const stack: MiniEl[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    for (let i = 0; i < node.kids.length; i++) {
      const kid = node.kids[i];
      if (kid === target) return { parent: node, idx: i };
      if (kid) stack.push(kid);
    }
  }
  return null;
}

/** 评分是否越界（lib InputTag.outOfRange 逐字：parseInt 后 <1 或 >7；NaN 不算越界） */
export function assessmentInputOutOfRange(tag: AssessmentInputTag): boolean {
  const val = Number.parseInt(tag.value, 10);
  return val < 1 || val > 7;
}

/** 提交前校验（lib Form.invalid 逐字）：返回原因串，合法返回 undefined */
export function assessmentFormInvalid(form: AssessmentForm): string | undefined {
  const personOutOfRange = (p: AssessmentPerson): boolean =>
    p.inputGroups.some((g) => assessmentInputOutOfRange(g.score));
  if (assessmentInputOutOfRange(form.overall.score)) return "overallOutOfRange";
  if (form.teachers.some(personOutOfRange)) return "teachersOutOfRange";
  if (form.assistants.length > 0 && form.assistants.every(personOutOfRange)) {
    return "assistantsOutOfRange";
  }
  return undefined;
}

/** 一键打分（lib Person.autoScore）：该被评人全部题项 score.value = String(score) */
export function autoScoreAssessmentPerson(person: AssessmentPerson, score = 7): void {
  for (const g of person.inputGroups) g.score.value = String(score);
}

/** 统一填写建议文本（lib Person.suggestion setter）：写入该被评人全部题项 */
export function setAssessmentPersonSuggestion(person: AssessmentPerson, text: string): void {
  for (const g of person.inputGroups) g.suggestion.value = text;
}

/**
 * 序列化为可提交表单（lib Form.serialize 逐字）：basics → overall（建议字段名
 * 固定 kcpgjgDtos[0].jtjy，随后评分输入）→ 教师/助教（每组 others → suggestion →
 * score）。对象赋值语义（同名后值覆盖前值）与 lib Object 一致。
 */
export function serializeAssessmentForm(form: AssessmentForm): URLSearchParams {
  const obj: Record<string, string> = Object.create(null);
  const put = (tag: AssessmentInputTag): void => {
    obj[tag.name] = tag.value;
  };
  form.basics.forEach(put);
  obj["kcpgjgDtos[0].jtjy"] = form.overall.suggestion;
  put(form.overall.score);
  for (const person of [...form.teachers, ...form.assistants]) {
    for (const group of person.inputGroups) {
      group.others.forEach(put);
      put(group.suggestion);
      put(group.score);
    }
  }
  return new URLSearchParams(Object.entries(obj));
}

/** 提交响应判读（lib postAssessmentForm）：{result!=="success"} → 抛 msg */
export function assessmentSubmitError(text: string): string | null {
  let json: { result?: unknown; msg?: unknown };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    return `教学评估提交响应异常（resp=${text.slice(0, 80).replace(/\s+/g, " ")}）`;
  }
  if (json.result === "success") return null;
  return typeof json.msg === "string" && json.msg ? json.msg : "教学评估提交失败";
}
