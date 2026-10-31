/** Recognize display labels only; submitted form names and IDs stay unchanged. */
const HEADERS = {
  department: ["院系", "department", "school", "offeringdepartment"],
  code: ["课号", "课程编号", "coursecode", "courseno", "coursenumber", "courseid"],
  seq: ["课序号", "课序", "classnumber", "classno", "section", "sectionno", "sectionnumber", "coursesequence"],
  name: ["课程名称", "课程名", "coursename", "coursetitle"],
  credits: ["学分", "credit", "credits"],
  teacher: ["教师", "任课教师", "instructor", "instructors", "teacher", "teachers"],
  time: ["时间地点", "上课时间", "时间", "classtime", "timeandlocation", "schedule", "time"],
  type: ["课程属性", "课程类型", "类型", "属性", "coursetype", "coursecategory", "type", "category"],
  volunteer: ["志愿", "preference", "priority", "choice"],
  capacity: ["本科生容量", "本科容量", "undergraduatecapacity"],
  remaining: ["本科生余量", "本科余量", "undergraduatevacancies", "undergraduateavailability", "undergraduateremaining"],
  gradCapacity: ["研究生容量", "graduatecapacity", "postgraduatecapacity"],
  gradRemaining: ["研究生余量", "graduatevacancies", "graduateavailability", "postgraduateremaining"],
  note: ["说明", "备注", "notes", "note", "remarks", "remark"],
  feature: ["课程特色", "特色", "coursefeatures", "features"],
  grade: ["年级", "year", "grade"],
  tongshi: ["通识", "generaleducation", "generaleducationgroup"],
} as const;
export type XkColumn = keyof typeof HEADERS;
const normalized = (text: string): string => text.replace(/&nbsp;|&#160;/gi, " ").replace(/[\s.():：/\\_-]+/g, "").toLowerCase();

export function xkColumnIndex(cells: string[], key: XkColumn): number {
  const aliases: readonly string[] = HEADERS[key];
  return cells.findIndex(cell => {
    const value = normalized(cell);
    return aliases.some(alias => /[\u3400-\u9fff]/.test(alias) ? value.includes(alias) : value === alias);
  });
}

export function xkHeaderCells(html: string): string[] {
  const row = /<tr\b[^>]*class=["'][^"']*\btrr1\b[^"']*["'][^>]*>([\s\S]*?)<\/tr>/i.exec(html)?.[1]
    ?? /<thead\b[^>]*>[\s\S]*?<tr\b[^>]*>([\s\S]*?)<\/tr>/i.exec(html)?.[1]
    ?? "";
  return [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
    .map(match => (match[1] ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

/** An empty error page is not an empty selected-course table. */
export function isXkCourseTable(html: string): boolean {
  const cells = xkHeaderCells(html);
  return xkColumnIndex(cells, "code") >= 0 && xkColumnIndex(cells, "name") >= 0;
}

export function xkVisibleMessage(html: string): string {
  const alert = /\balert\s*\(\s*["']([^"']{1,500})["']\s*\)/i.exec(html)?.[1];
  return (alert ?? html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ""))
    .replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/\s+/g, " ").trim();
}

export function isXkEnglishSessionError(html: string): boolean {
  return /\b(?:session (?:has )?expired|session (?:has )?timed out|login timed out|please (?:log|sign) in again|access denied)\b/i.test(xkVisibleMessage(html));
}

/** WebVPN injects its variables into authenticated pages as well as guides.
 * Classify rendered authentication/error markup before interpreting its loader. */
export function isXkIdentityPage(html: string): boolean {
  const markup = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  return /<(?:input|div|span)\b[^>]*(?:name\s*=\s*["']i_pass["']|id\s*=\s*["']sm2publicKey["'])|<form\b[^>]*action\s*=\s*["'][^"']*\/do\/off\/ui\/auth\/login\/|<title\b[^>]*>[^<]*电子身份服务系统/i.test(markup);
}

export function isXkConfirmationPage(html: string): boolean {
  const markup=html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  return /<form\b[^>]*action\s*=\s*["'][^"']*\/do\/off\/ui\/auth\/login\/checkSingle(?:[?"'#])/i.test(markup);
}

export function isXkSessionError(html: string): boolean {
  const markup = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const visible = xkVisibleMessage(markup);
  if (/accessDenied|用户登陆超时或访问内容不存在/i.test(visible) || isXkEnglishSessionError(markup)) return true;
  if (isXkIdentityPage(markup)) return true;
  const business = /<(?:form|input|textarea|table|iframe|frame|frameset)\b/i.test(markup)
    || /<a\b[^>]*href=["'][^"']*(?:xkBks\.|jhBks\.|js\.vjs)/i.test(markup)
    || /\b(?:var|let|const)\s+gridData\d*\s*=\s*\[/i.test(html);
  if (!business && /<(?:a|meta)\b[^>]*(?:href|content)=["'][^"']*\/do\/off\/ui\/auth\/login\//i.test(markup)) return true;
  return !business && html.length < 4000 && html.includes('__vpn_hostname_data') && html.includes('__vpn_app_hostname_data');
}

/** Deliberately no success-by-absence: unknown English responses need read-back. */
export function xkRejectionMessage(html: string): string | null {
  const message = xkVisibleMessage(html);
  const zh = /时间冲突|上课时间冲突|先修|不符合|不允许|无法选课|选课失败|提交失败|余量不足|课余量不足|人数已满|已选满|请先|验证码|超出|达不到|不满足|存在冲突|已选过|重复选课|操作被拒绝|被拒绝|失败|上限|已选课程学分/;
  const en = /\b(?:failed|failure|denied|not permitted|not allowed|cannot|unable to|unsuccessful|conflict|prerequisite|insufficient|already (?:selected|registered|enrolled)|duplicate (?:registration|selection)|(?:course|class|capacity) (?:is )?full|credit limit|exceed(?:s|ed)?|not eligible|not successful|must .{0,60} first)\b/i;
  return zh.test(message) || en.test(message) ? message.slice(0, 160) : null;
}
