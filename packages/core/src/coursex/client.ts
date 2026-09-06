/**
 * courseX 课程信息查询客户端（tsinghua.app / 星期四 Thursday）。
 *
 * courseX 是众包课程时间地点库：learnX 用户将自己网络学堂已选课程的时间
 * 地点（v_wlkc_xk_sjddb）上传共享，全校合起来覆盖大部分开课。OneTHU 只做
 * **免凭证查询**：tsinghua.app 网页是服务端渲染（Next.js RSC 流），搜索
 * 结果与课程详情（含时间地点）直接渲染在公开 HTML 里，浏览器匿名可访问。
 * 不走 HttpClient（避免被 WebVPN 包装）——与 washer/water 同款 FetchLike 直连。
 *
 * 接口结论验证自 robertying/gpa.wtf（courseX 网页源码）与 learnX
 * （src/helpers/coursex.ts）开源实现。
 *
 * 上传回馈不接入：tsinghua.app 没有任何登录界面（/login 404，线上无 auth
 * UI，旧 thu.community Cognito 登录已死），refresh token 只在 learnX 作者
 * 手里（预埋进 learnX 构建环境），普通用户无从获取——上传链路对我们不可达。
 * 页面解析实测形态（2026-09）：
 * - GET /courses?q={关键词}   → <tbody><tr><td>教师</td><td>课名<br/>
 *   <span…>英文名</span></td><td>…href="/courses/{学年-课程id}"…
 * - GET /courses/{id}         → 流内 <div hidden id="S:N"><main…><div class=…card…>
 *   <p>学期</p><p>课号-课序</p><h1>课名</h1><p>英文名</p><h2>教师</h2>
 *   <ul><li>时间地点</li>…</ul>
 */
import { decodeHtmlEntities } from "../info/htmltext.js";
import type { FetchLike } from "../http.js";

const SITE = "https://tsinghua.app";

export interface CourseXSummary {
  id: string;
  name: string;
  englishName?: string;
  teacherName: string;
  semesterId: string;
}

export interface CourseXDetail {
  id: string;
  name: string;
  englishName?: string;
  teacherName: string;
  semesterId: string;
  /** 时间地点条目（如「星期五第3节 六教6B206」）；库中缺失为空数组 */
  timeLocation: string[];
  reviewAvg: number | null;
  reviewCount: number;
}

/* ── 学期文案（tsinghua.app-web lib/format getSemesterTextFromId 同义） ── */

/** "2025-2026-1" → "2025-2026 学年秋季学期"；不认识的形态原样返回 */
export function courseXSemesterText(id: string): string {
  const m = /^(\d{4}-\d{4})-([123])$/.exec(id);
  if (!m) return id;
  const term = { "1": "秋季学期", "2": "春季学期", "3": "夏季学期" }[m[2] as "1" | "2" | "3"];
  return `${m[1]} 学年${term}`;
}

/** 课程卡文本字段：剥注释/标签（沿用旧语义）+ 全量命名/数值实体
 *  （—— 渲染成 &mdash;&mdash; 的 2026-09-06 修复；残留实体再收一轮防双重转义） */
function decodeText(s: string): string {
  const stripped = s.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, "");
  const once = decodeHtmlEntities(stripped);
  return (/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/.test(once) ? decodeHtmlEntities(once) : once).trim();
}

/** 请求头：必须用真实浏览器 UA——自定义 UA（如 Mozilla/5.0 (OneTHU)）实测被
 *  服务端拦截返回空结果页（2026-09 实测 19 行 → 0 行）。 */
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
};

/** 免 Key 学期列表：解析 /courses 首页 <select id="semester-select">，
 *  selected 项即当前学期（列表第一项）。 */
export interface CourseXSemester {
  id: string;
  label: string;
  current: boolean;
}

export async function getCourseXSemesters(fetchLike: FetchLike): Promise<CourseXSemester[]> {
  const res = await fetchLike(`${SITE}/courses`, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`课程共享计划学期列表失败（HTTP ${res.status}）`);
  const html = await res.text();
  const select = /<select[^>]*id="semester-select"[\s\S]*?<\/select>/.exec(html)?.[0] ?? "";
  const out: CourseXSemester[] = [];
  const optRe = /<option value="([^"]+)"([^>]*)>([^<]*)<\/option>/g;
  let m: RegExpExecArray | null;
  while ((m = optRe.exec(select)) !== null) {
    const id = m[1] ?? "";
    const label = decodeText(m[3] ?? "");
    if (id && label) out.push({ id, label, current: /selected/.test(m[2] ?? "") });
  }
  return out;
}

/** 免 Key 搜索：解析 /courses?q=（&s=学期，缺省=当前学期）服务端渲染结果表。
 *  课程 id 形如 {学期id}-{课号课序}，semesterId 取前三段。 */
export async function searchCourseXPublic(
  fetchLike: FetchLike,
  query: string,
  semester?: string,
): Promise<CourseXSummary[]> {
  const s = semester ? `&s=${encodeURIComponent(semester)}` : "";
  const res = await fetchLike(`${SITE}/courses?q=${encodeURIComponent(query)}${s}`, {
    headers: BROWSER_HEADERS,
  });
  if (!res.ok) throw new Error(`课程共享计划搜索失败（HTTP ${res.status}）`);
  const html = await res.text();
  const out: CourseXSummary[] = [];
  // 行形态：<tr><td>教师</td><td>课名<br/><span…>英文名</span></td><td>…href="/courses/{id}"
  const rowRe =
    /<tr><td>([\s\S]*?)<\/td><td>([\s\S]*?)<\/td><td[\s\S]*?href="\/courses\/([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const id = m[3] ?? "";
    const nameCell = m[2] ?? "";
    const nameMatch = /^([\s\S]*?)(?:<br\/?>|$)/.exec(nameCell);
    const name = decodeText(nameMatch?.[1] ?? nameCell);
    if (!id || !name) continue;
    const english = /<span[^>]*>([\s\S]*?)<\/span>/.exec(nameCell)?.[1];
    out.push({
      id,
      name,
      englishName: english ? decodeText(english) || undefined : undefined,
      teacherName: decodeText(m[1] ?? ""),
      semesterId: id.split("-").slice(0, 3).join("-"),
    });
  }
  return out;
}

/** 免 Key 详情：解析 /courses/{id} 流内卡片（学期/课号课序/课名/英文名/教师/时间地点） */
export async function getCourseXDetailPublic(
  fetchLike: FetchLike,
  id: string,
): Promise<CourseXDetail | null> {
  const res = await fetchLike(`${SITE}/courses/${encodeURIComponent(id)}`, {
    headers: BROWSER_HEADERS,
  });
  if (!res.ok) throw new Error(`课程共享计划详情失败（HTTP ${res.status}）`);
  const html = await res.text();
  // 数据在流式渲染的隐藏块里：<div hidden id="S:N"><main …card…>…</main></div>
  const card = /<div hidden id="S:\d+"><main[\s\S]*?<\/main>/.exec(html)?.[0]
    ?? /<main[\s\S]*?card[\s\S]*?<\/main>/.exec(html)?.[0]
    ?? "";
  if (!card) return null;
  const pick = (re: RegExp): string => decodeText(re.exec(card)?.[1] ?? "");
  const ps = [...card.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((x) => decodeText(x[1] ?? ""));
  const lis = [...card.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => decodeText(x[1] ?? ""));
  const name = pick(/<h1>([\s\S]*?)<\/h1>/);
  if (!name) return null;
  const teacherName = pick(/<h2>([\s\S]*?)<\/h2>/);
  const englishName = pick(/<\/h1><p>([\s\S]*?)<\/p>/) || undefined;
  return {
    id,
    name,
    englishName,
    teacherName,
    semesterId: ps[0] ?? "",
    timeLocation: lis,
    reviewAvg: null,
    reviewCount: 0,
  };
}
