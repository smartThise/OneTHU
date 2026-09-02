/**
 * courseX 课程信息共享计划客户端（tsinghua.app / 星期四 Thursday）。
 *
 * courseX 的课程时间地点数据来自众包共享：learnX 用户授权后将自己网络学堂
 * 已选课程的时间地点（v_wlkc_xk_sjddb）上传至共享库，全校用户合起来覆盖
 * 全部开课。接口结论验证自 robertying/tsinghua.app-web（api/course.ts）与
 * learnX（src/helpers/coursex.ts）开源实现：
 *
 * - GraphQL：POST https://api.tsinghua.app/v1/graphql（匿名无任何权限，须
 *   Bearer accessToken）
 * - 换 token：POST https://tsinghua.app/api/auth/session {refreshToken}
 *   → { accessToken, expireAt }（秒级时间戳）
 * - 搜索：course(name/teacher.name _ilike %q%)，详情含 time_location（JSON
 *   字符串数组）与 course_reviews 均分
 * - 上传：insert_course(on_conflict course_pkey → 更新 time_location)
 *
 * courseX 为第三方公开服务，无需校内会话，不走 HttpClient（避免被 WebVPN
 * 包装）——与 washer/water 同款 FetchLike 直连。
 */
import type { FetchLike } from "../http.js";

const SITE = "https://tsinghua.app";
const GRAPHQL = "https://api.tsinghua.app/v1/graphql";

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

/** 上传对象：字段与 learnX uploadCourses 一一对应（id = 网络学堂课程 id）。
 *  teacherId/teacherName 可选：网络学堂列表接口偶尔不回传教师号（jsh），
 *  缺号时不嵌套 teacher 对象，避免 teacher_pkey 空主键。 */
export interface CourseXUploadCourse {
  id: string;
  name: string;
  englishName?: string;
  teacherId?: string;
  teacherName?: string;
  timeLocation: string[];
  semesterId: string;
  number: string;
  index: number;
}

export class CourseXAuthError extends Error {
  constructor(message = "课程共享计划凭证无效或已过期，请更新 refresh token") {
    super(message);
  }
}

/* ── 换 token（learnX 同款：POST /api/auth/session {refreshToken}） ── */

interface SessionResponse {
  accessToken?: string;
  expireAt?: number;
}

export async function fetchCourseXAccessToken(
  fetchLike: FetchLike,
  refreshToken: string,
): Promise<{ accessToken: string; expireAt: number }> {
  const res = await fetchLike(`${SITE}/api/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (res.status === 401 || res.status === 422) throw new CourseXAuthError();
  const text = await res.text();
  let json: SessionResponse;
  try {
    json = JSON.parse(text) as SessionResponse;
  } catch {
    throw new Error(`课程共享计划服务响应异常（HTTP ${res.status}）`);
  }
  if (!json.accessToken) throw new CourseXAuthError();
  return { accessToken: json.accessToken, expireAt: (json.expireAt ?? 0) * 1000 };
}

/**
 * courseX 会话：内存缓存 accessToken，到期前 60 秒自动重换。
 * refreshToken 由调用方持久化（桌面端凭证存储），此处只在内存持有 token。
 */
export class CourseXSession {
  #fetchLike: FetchLike;
  #refreshToken: string;
  #token: string | null = null;
  #expireAt = 0;

  constructor(fetchLike: FetchLike, refreshToken: string) {
    this.#fetchLike = fetchLike;
    this.#refreshToken = refreshToken;
  }

  get refreshToken(): string {
    return this.#refreshToken;
  }

  async getAccessToken(force = false): Promise<string> {
    if (!force && this.#token && Date.now() < this.#expireAt - 60_000) {
      return this.#token;
    }
    const { accessToken, expireAt } = await fetchCourseXAccessToken(
      this.#fetchLike,
      this.#refreshToken,
    );
    this.#token = accessToken;
    this.#expireAt = expireAt || Date.now() + 10 * 60_000;
    return accessToken;
  }
}

/* ── GraphQL 基座 ── */

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: Array<{ message: string }>;
}

async function gql<T>(
  fetchLike: FetchLike,
  session: CourseXSession,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const run = async (token: string): Promise<Response> =>
    fetchLike(GRAPHQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
    });
  let res = await run(await session.getAccessToken());
  if (res.status === 401) {
    // token 失效自愈：强制重换一次
    res = await run(await session.getAccessToken(true));
  }
  if (res.status === 401) throw new CourseXAuthError();
  const text = await res.text();
  let json: GraphQLResponse<T>;
  try {
    json = JSON.parse(text) as GraphQLResponse<T>;
  } catch {
    throw new Error(`课程共享计划服务响应异常（HTTP ${res.status}）`);
  }
  if (json.errors?.length) {
    const msg = json.errors[0]?.message ?? "";
    if (/jwt|authorization|token/i.test(msg)) throw new CourseXAuthError(msg);
    throw new Error(`课程共享计划查询失败：${msg}`);
  }
  if (!json.data) throw new Error("课程共享计划查询失败：无数据");
  return json.data;
}

/* ── 查询（tsinghua.app-web api/course.ts GET_COURSES / GET_COURSE 同款） ── */

interface CourseRow {
  id: string;
  name: string;
  semester_id: string;
  teacher?: { name: string } | null;
}

const SEARCH_QUERY = `
  query OneTHUSearchCourses($query: String!) {
    course(
      where: { _or: [{ name: { _ilike: $query } }, { teacher: { name: { _ilike: $query } } }] }
      order_by: [{ semester_id: desc }, { updated_at: desc }]
      limit: 100
    ) {
      id
      name
      semester_id
      teacher { name }
    }
  }
`;

export async function searchCourseX(
  fetchLike: FetchLike,
  session: CourseXSession,
  query: string,
): Promise<CourseXSummary[]> {
  const data = await gql<{ course: CourseRow[] }>(fetchLike, session, SEARCH_QUERY, {
    query: `%${query}%`,
  });
  return data.course.map((c) => ({
    id: c.id,
    name: c.name,
    teacherName: c.teacher?.name ?? "",
    semesterId: c.semester_id,
  }));
}

const DETAIL_QUERY = `
  query OneTHUGetCourse($id: String!) {
    course_by_pk(id: $id) {
      id
      name
      englishName
      semester_id
      time_location
      teacher { name }
      course_reviews_aggregate {
        aggregate {
          count
          avg { rating }
        }
      }
    }
  }
`;

function parseTimeLocation(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === "string");
  } catch {
    /* 空间非 JSON（脏数据）按无地点处理 */
  }
  return [];
}

export async function getCourseXDetail(
  fetchLike: FetchLike,
  session: CourseXSession,
  id: string,
): Promise<CourseXDetail | null> {
  const data = await gql<{
    course_by_pk: ({
      englishName?: string | null;
      time_location?: string | null;
      course_reviews_aggregate?: {
        aggregate?: { count?: number; avg?: { rating?: number | null } | null } | null;
      } | null;
    } & CourseRow) | null;
  }>(fetchLike, session, DETAIL_QUERY, { id });
  const c = data.course_by_pk;
  if (!c) return null;
  const agg = c.course_reviews_aggregate?.aggregate;
  return {
    id: c.id,
    name: c.name,
    englishName: c.englishName || undefined,
    teacherName: c.teacher?.name ?? "",
    semesterId: c.semester_id,
    timeLocation: parseTimeLocation(c.time_location),
    reviewAvg: agg?.avg?.rating ?? null,
    reviewCount: agg?.count ?? 0,
  };
}

/* ── 上传（learnX coursex.ts insert_course 同款，回馈共享库） ── */

const UPLOAD_MUTATION = `
  mutation OneTHUAddCourses($objects: [course_insert_input!]!) {
    insert_course(
      objects: $objects
      on_conflict: { constraint: course_pkey, update_columns: ["time_location", "name", "englishName"] }
    ) {
      affected_rows
    }
  }
`;

/** 上传本学期课程的时间地点；返回受影响行数。权限不足时服务端报错原样抛出。 */
export async function uploadCoursesToCourseX(
  fetchLike: FetchLike,
  session: CourseXSession,
  courses: CourseXUploadCourse[],
): Promise<number> {
  const objects = courses.map((c) => ({
    id: c.id,
    name: c.name,
    englishName: c.englishName,
    ...(c.teacherId
      ? {
          teacher: {
            data: { id: c.teacherId, name: c.teacherName ?? "" },
            on_conflict: { constraint: "teacher_pkey", update_columns: ["name"] },
          },
        }
      : {}),
    time_location: JSON.stringify(c.timeLocation),
    semester_id: c.semesterId,
    number: c.number,
    index: c.index,
  }));
  const data = await gql<{ insert_course: { affected_rows: number } }>(
    fetchLike,
    session,
    UPLOAD_MUTATION,
    { objects },
  );
  return data.insert_course?.affected_rows ?? 0;
}

/* ── 学期文案（tsinghua.app-web lib/format getSemesterTextFromId 同义） ── */

/** "2025-2026-1" → "2025-2026 学年秋季学期"；不认识的形态原样返回 */
export function courseXSemesterText(id: string): string {
  const m = /^(\d{4}-\d{4})-([123])$/.exec(id);
  if (!m) return id;
  const term = { "1": "秋季学期", "2": "春季学期", "3": "夏季学期" }[m[2] as "1" | "2" | "3"];
  return `${m[1]} 学年${term}`;
}

/* ────────────────────────────────────────────────────────────────
 * 免凭证公开查询：tsinghua.app 网页是服务端渲染（Next.js RSC 流），
 * 搜索结果与课程详情（含时间地点）直接渲染在公开 HTML 里，浏览器
 * 匿名可访问——GraphQL 才需要 token。OneTHU 查询一律走这条免 Key
 * 路径；token 仅用于上传回馈。
 *
 * 实测页面形态（2026-09）：
 * - GET /courses?q={关键词}   → <tbody><tr><td>教师</td><td>课名<br/>
 *   <span…>英文名</span></td><td>…href="/courses/{学年-课程id}"…
 * - GET /courses/{id}         → 流内 <div hidden id="S:N"><main…><div class=…card…>
 *   <p>学期</p><p>课号-课序</p><h1>课名</h1><p>英文名</p><h2>教师</h2>
 *   <ul><li>时间地点</li>…</ul>
 * ──────────────────────────────────────────────────────────────── */

function decodeEntities(s: string): string {
  return s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
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
    const label = decodeEntities(m[3] ?? "");
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
    const name = decodeEntities(nameMatch?.[1] ?? nameCell);
    if (!id || !name) continue;
    const english = /<span[^>]*>([\s\S]*?)<\/span>/.exec(nameCell)?.[1];
    out.push({
      id,
      name,
      englishName: english ? decodeEntities(english) || undefined : undefined,
      teacherName: decodeEntities(m[1] ?? ""),
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
  const pick = (re: RegExp): string => decodeEntities(re.exec(card)?.[1] ?? "");
  const ps = [...card.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((x) => decodeEntities(x[1] ?? ""));
  const lis = [...card.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => decodeEntities(x[1] ?? ""));
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
