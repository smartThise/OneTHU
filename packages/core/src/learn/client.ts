/**
 * 网络学堂客户端（本科生视角）。
 * 登录 = CAS ticket 漫游 → 课程列表页抓 _csrf；接口失效自动重登录（retryAfterLogin）。
 */
import { AuthRequiredError, HttpClient } from "../http.js";
import * as urls from "./urls.js";
import type {
  CalendarData,
  CalendarSemester,
  CourseFile,
  CourseInfo,
  Homework,
  HomeworkPageDetail,
  LearnAttachment,
  LearnGroup,
  Notification,
  NotificationPageDetail,
  SemesterInfo,
} from "./types.js";

interface LearnJson {
  result?: string;
  message?: string;
  resultList?: unknown[];
  object?: { aaData?: unknown[] } | unknown[];
  [k: string]: unknown;
}

function decodeHtml(s: unknown): string {
  const raw = String(s ?? "");
  if (!raw) return "";
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function decodeBase64Utf8(b64: string): string {
  try {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") {
    const o = v as { aaData?: unknown; resultsList?: unknown };
    // learn 各列表端点三种形态：裸数组 / object.aaData（DataTables）/ object.resultsList（通知/讨论）
    if (Array.isArray(o.aaData)) return o.aaData;
    if (Array.isArray(o.resultsList)) return o.resultsList;
  }
  return [];
}

const str = (v: unknown) => String(v ?? "");

/* ---------- 我的分组（v_wlkc_qzcyb）解析 ----------
 * 金标准样例：分组页 beforePageWdfzList 为 DataTables（bServerSide）壳子，行由
 * /b/wlxt/qz/v_wlkc_qzcyb/student/pageFzList AJAX 注入（qzmc=组名 / qzmp=逗号分隔
 * 成员 / czr=创建人 / czsj=创建时间）；静态 HTML 里通常只有空 tbody。
 * 因此解析顺序：HTML 表格行 → 卡片/原始行兜底 → pageFzList JSON（页面自身数据源）。 */

/** 登录页特征（HttpClient #looksLoggedOut 同源标记）：命中说明会话失效 */
function looksLikeLoginHtml(html: string): boolean {
  return /j_spring_security_check|id="sm2publicKey"|name="i_pass"|\/do\/off\/ui\/auth\/login\//i.test(html);
}

/** 成员串 → 姓名数组：qzmp 逗号分隔（页面渲染时 replace(/,/g," ")），表格里为空格分隔 */
function splitMemberNames(s: string): string[] {
  return decodeHtml(s)
    .split(/[,，、;；\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function toMembers(names: string[], creator: string): LearnGroup["members"] {
  return names.map((n) => ({ name: n, role: creator && n === creator ? "创建人" : undefined }));
}

/** 宽容解析 HTML 表格行：td0=组名 td1=成员 td2=创建人 td3=创建时间 */
function parseGroupTables(html: string): LearnGroup[] {
  const out: LearnGroup[] = [];
  for (const tb of html.matchAll(/<tbody[^>]*>([\s\S]*?)<\/tbody>/gi)) {
    for (const tr of tb[1]!.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...tr[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((t) =>
        decodeHtml(t[1]!.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(),
      );
      const [name = "", membersRaw = "", creator = "", time = ""] = cells;
      if (!name && !membersRaw) continue;
      const names = splitMemberNames(membersRaw);
      if (!name && names.length === 0) continue;
      out.push({
        id: name || `group-${out.length}`,
        name: name || "未命名分组",
        members: toMembers(names, creator),
        creator: creator || undefined,
        createTime: time || undefined,
      });
    }
  }
  return out;
}

/** 表格也提不出结构时的最后兜底：取分组区块（searchcon 前最后一个 .detail）去掉标签，
 *  把剩余原始文本行塞进 members[].name（卡片式改版至少能看到内容），全噪声则返回空 */
const GROUP_LINE_NOISE =
  /^(我所在组|组成员|创建人|创建时间|我的分组|正在获取数据.*|暂无数据|没有您要搜索的内容|共\s*\d+\s*条.*|显示\s*\d+.*|第\s*\d+.*|首页|上页|下页|末页)$/;

function parseGroupRawLines(html: string): LearnGroup[] {
  // 取 searchcon（课内搜索面板）之前最后一个 .detail 区块 = 分组表格所在块；
  // 样例页上部还有隐藏的同 class 结构，取第一个会混入导航/模板噪声
  const stop = html.indexOf('id="searchcon"');
  let start = 0;
  if (stop > 0) {
    for (const m of html.matchAll(/class=["'][^"']*\bdetail\b[^"']*["']/gi)) {
      if (m.index >= stop) break;
      start = m.index;
    }
  } else {
    start = /class=["'][^"']*\bdetail\b[^"']*["']/i.exec(html)?.index ?? 0;
  }
  const region = html.slice(start, stop > 0 ? stop : Math.min(html.length, start + 30000));
  const lines = decodeHtml(
    region
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, "\n"),
  )
    .split(/\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    // {} <> 为漏网模板/标签碎片；长度 ≥2 过滤零散符号
    .filter((s) => s.length >= 2 && !/[{}<>]/.test(s) && !GROUP_LINE_NOISE.test(s));
  if (lines.length === 0) return [];
  return [
    {
      id: "raw",
      name: "分组信息（页面结构未识别，原始行）",
      members: lines.map((n) => ({ name: n })),
    },
  ];
}

/** pageFzList JSON 行 → LearnGroup（demo learnApi fetchGroupList 同源字段） */
function parseGroupJsonRow(raw: unknown, idx: number): LearnGroup | undefined {
  const d = raw as Record<string, unknown>;
  const rawMembers = d.qzmp ?? d.members;
  const memberStr = Array.isArray(rawMembers) ? rawMembers.map(str).join(",") : str(rawMembers);
  const names = splitMemberNames(memberStr);
  const name = decodeHtml(d.qzmc ?? d.fzmc ?? d.name).trim();
  if (!name && names.length === 0) return undefined;
  const creator = decodeHtml(d.czr ?? d.czz).trim();
  return {
    id: str(d.qzid ?? d.fzid ?? d.id) || name || `group-${idx}`,
    name: name || "未命名分组",
    members: toMembers(names, creator),
    creator: creator || undefined,
    createTime: str(d.czsj).trim() || undefined,
  };
}

export class LearnClient {
  #http: HttpClient;
  #csrf: string | null = null;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** 会话建立流程（demo 字符串模型）外部完成时，直接注入 _csrf */
  applyCsrf(token: string): void {
    this.#csrf = token;
  }

  /** 用统一会话下发的 CAS ticket 漫游网络学堂，并提取 _csrf。 */
  async roam(ticket: string): Promise<void> {
    await this.#http.request(
      "https://learn.tsinghua.edu.cn/b/j_spring_security_thauth_roaming_entry?ticket=" + ticket,
      { redirect: "follow" },
    );
    const csrf = await this.#fetchCsrf();
    if (!csrf) throw new AuthRequiredError("漫游后未能获取网络学堂会话");
    this.#csrf = csrf;
  }

  /** 手动恢复已保存会话（CookieJar hydrate 后调用） */
  async resume(): Promise<boolean> {
    const csrf = await this.#fetchCsrf();
    this.#csrf = csrf;
    return csrf !== null;
  }

  /** 诊断现场：最后一次课程页内容（csrf 提取失败时用于定位） */
  lastDebug = "";

  /** 诊断现场：最近一次 getCourseGroups 的解析情况（返回空数组时用于定位） */
  lastGroupsDebug = "";

  async #fetchCsrf(): Promise<string | null> {
    try {
      const html = await this.#http.text(this.#withCsrf(urls.LEARN_COURSE_LIST_PAGE()));
      this.lastDebug = html.slice(0, 1200);
      const m = /_csrf=([^&"\x27\s<]+)/.exec(html);
      return m?.[1] ?? null;
    } catch (e) {
      this.lastDebug = "FETCH-ERROR " + String(e);
      return null;
    }
  }

  /** 会话失效直接上抛，由 CampusSession/UI 决定是否重登录（密码不落盘，core 不自动重试） */
  async #withRelogin<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  #requireCsrf(): string {
    if (!this.#csrf) throw new AuthRequiredError();
    return this.#csrf;
  }

  /** learn-lib addCSRFTokenToUrl：learn 接口一律要求 _csrf 查询参数，缺失时返回 HTML 错误页 */
  #withCsrf(url: string): string {
    const u = new URL(url);
    u.searchParams.set("_csrf", this.#requireCsrf());
    return u.toString();
  }

  async getCurrentSemester(): Promise<SemesterInfo> {
    return this.#withRelogin(async () => {
      this.#requireCsrf();
      const json = await this.#http.json<LearnJson>(this.#withCsrf(urls.LEARN_CURRENT_SEMESTER()));
      const result = json.result as { xnxq?: string } | string | undefined;
      const id = typeof result === "object" && result ? result.xnxq : result;
      if (!id) throw new AuthRequiredError();
      return { id: String(id) };
    });
  }

  /** 校历（demo getCalendar：getCurrentAndNextSemester 的 result/resultList，kssj 对齐周一） */
  async getCalendarData(): Promise<CalendarData> {
    return this.#withRelogin(async () => {
      this.#requireCsrf();
      type CalSem = { id?: string; xnxqmc?: string; kssj?: string; jssj?: string };
      const json = await this.#http.json<{
        message?: string;
        result?: CalSem;
        resultList?: CalSem[];
      }>(this.#withCsrf(urls.LEARN_CURRENT_SEMESTER()));
      if (json.message && json.message !== "success") throw new AuthRequiredError();
      if (!json.result || !json.result.kssj || !json.result.id) throw new AuthRequiredError();
      const fmt = (x: Date): string =>
        `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
      const parse = (o: CalSem): CalendarSemester => {
        // kssj 对齐到所在教学周的周一（周二~五→本周一；周六日→下周一；demo 同款）
        const start = new Date(String(o.kssj).replace(/-/g, "/"));
        const wd = start.getDay();
        const delta = wd === 0 ? 1 : wd === 6 ? 2 : 1 - wd;
        const firstDay = fmt(new Date(start.getTime() + delta * 86400000));
        const end = new Date(String(o.jssj ?? o.kssj).replace(/-/g, "/"));
        const weekCount = Math.max(
          1,
          Math.floor((end.getTime() - start.getTime() + delta * 86400000) / (7 * 86400000)) + 1,
        );
        return {
          firstDay,
          semesterId: String(o.id ?? ""),
          semesterName: String(o.xnxqmc ?? ""),
          weekCount,
        };
      };
      return {
        ...parse(json.result),
        nextSemesterList: (json.resultList ?? []).map(parse),
      };
    });
  }

  async getSemesterIdList(): Promise<string[]> {
    return this.#withRelogin(async () => {
      this.#requireCsrf();
      const list = await this.#http.json<string[]>(this.#withCsrf(urls.LEARN_SEMESTER_LIST()));
      return Array.isArray(list) ? list : [];
    });
  }

  async getCourseList(semesterId: string): Promise<CourseInfo[]> {
    return this.#withRelogin(async () => {
      this.#requireCsrf();
      const json = await this.#http.json<LearnJson>(this.#withCsrf(urls.LEARN_COURSE_LIST(semesterId)));
      const rows = Array.isArray(json.resultList) ? json.resultList : [];
      return rows.map((raw) => {
        const c = raw as Record<string, unknown>;
        const id = str(c.wlkcid);
        return {
          id,
          name: decodeHtml(c.kcm) || decodeHtml(c.zywkcm),
          englishName: decodeHtml(c.ywkcm),
          courseNumber: str(c.kch),
          courseIndex: Number(c.kxh ?? 0),
          teacherName: decodeHtml(c.jsm),
          timeAndLocation: [],
          url: urls.LEARN_COURSE_PAGE(id),
        };
      });
    });
  }

  /** 全部课程的作业（未交 + 已交未批 + 已批） */
  async getAllHomework(courseIds: string[]): Promise<Homework[]> {
    this.#requireCsrf();
    const groups = await Promise.all(
      courseIds.map((courseId) =>
        Promise.all(
          (["new", "submitted", "graded"] as const).map((kind) =>
            this.#fetchHomeworkKind(courseId, kind).catch(() => []),
          ),
        ),
      ),
    );
    return groups.flat(2);
  }

  async #fetchHomeworkKind(courseId: string, kind: "new" | "submitted" | "graded"): Promise<Homework[]> {
    return this.#withRelogin(async () => {
      const json = await this.#http.json<LearnJson>(this.#withCsrf(urls.LEARN_HOMEWORK_LIST[kind]), {
        method: "POST",
        body: this.#aoData({ wlkcid: courseId }),
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      });
      return asArray(json.object ?? json.resultList).map((raw) => {
        const d = raw as Record<string, unknown>;
        const baseId = str(d.zyid);
        const studentId = str(d.xszyid) || baseId;
        return {
          id: studentId,
          baseId,
          courseId: str(d.wlkcid) || courseId,
          title: decodeHtml(d.bt),
          content: decodeBase64Utf8(str(d.nr)),
          publishTime: str(d.fbsj),
          deadline: str(d.jzsj),
          lateDeadline: d.bjjzsj ? str(d.bjjzsj) : undefined,
          lateSubmission: str(d.sfbj) === "1" || str(d.sfbj) === "Y",
          completionType: d.zywcfs === undefined || d.zywcfs === null ? undefined : Number(d.zywcfs),
          submissionType: d.zytjfs === undefined || d.zytjfs === null ? undefined : Number(d.zytjfs),
          submitted: kind !== "new",
          graded: kind === "graded",
          submitTime: d.scsj === undefined || d.scsj === null || str(d.scsj) === "" ? undefined : str(d.scsj),
          grade: d.cj === undefined || d.cj === null || str(d.cj) === "" ? undefined : (d.cj as string | number),
          graderName: str(d.jsm).trim() || undefined,
          gradeContent: decodeHtml(d.pynr).trim() || undefined,
          gradeTime: d.pysj === undefined || d.pysj === null || str(d.pysj) === "" ? undefined : str(d.pysj),
          url: urls.LEARN_HOMEWORK_PAGE(str(d.wlkcid) || courseId, studentId),
        };
      });
    });
  }

  /** 单个作业的说明详情（thu-learn-lib getHomeworkDetail：POST id=zyid，msg 即说明） */
  /** 提交作业（thu-learn-lib LEARN_HOMEWORK_SUBMIT_FORM_DATA 同款）：
   *  POST /b/wlxt/kczy/zy/student/tjzy，multipart FormData 字段序 xszyid/zynr/
   *  fileupload/isDeleted；无附件时 fileupload 也要占位（字面 "undefined"，
   *  网页端空文件输入的原样 —— thu-learn-lib 与 thu-app learnApi 均如此）。 */
  async submitHomework(
    studentHomeworkId: string,
    opts: { content?: string; file?: File | null; remove?: boolean },
  ): Promise<{ ok: boolean; msg?: string }> {
    return this.#withRelogin(async () => {
      const fd = new FormData();
      fd.append("xszyid", studentHomeworkId);
      fd.append("zynr", opts.content ?? "");
      if (opts.file) fd.append("fileupload", opts.file, opts.file.name);
      else fd.append("fileupload", "undefined");
      fd.append("isDeleted", opts.remove ? "1" : "0");
      const url = this.#withCsrf(urls.LEARN_PREFIX + "/b/wlxt/kczy/zy/student/tjzy");
      const res = await this.#http.postForm(url, fd);
      try {
        const data = JSON.parse(res) as { result?: string; msg?: string };
        if (data.result === "error") return { ok: false, msg: data.msg ?? "提交失败" };
        return { ok: true };
      } catch {
        return { ok: false, msg: "返回非 JSON（可能未登录或接口变更）" };
      }
    });
  }

  async getHomeworkDetail(baseId: string): Promise<{ description: string }> {
    return this.#withRelogin(async () => {
      this.#requireCsrf();
      const body = new URLSearchParams({ id: baseId });
      const json = await this.#http.json<LearnJson>(this.#withCsrf(urls.LEARN_HOMEWORK_DETAIL()), {
        method: "POST",
        body,
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      });
      const msg = typeof json.message === "string" ? json.message : str(json.msg);
      return { description: decodeHtml(msg) };
    });
  }

  /** 从 HTML 块提取附件（thu-learn-lib parseHomeworkFile 的正则等价）：
   *  锚点 href 带 fileId/downloadUrl 参数；downloadUrl 参数优先（URL 编码的服务器路径）。 */
  #parseAttachmentAnchor(block: string): LearnAttachment | undefined {
    const anchor = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!anchor) return undefined;
    const href = decodeHtml(anchor[1]!);
    const name = decodeHtml(anchor[2]!.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    const q = href.indexOf("?");
    const params = new URLSearchParams(q >= 0 ? href.slice(q + 1) : "");
    const id = params.get("fileId") ?? params.get("wjid") ?? "";
    const dl = params.get("downloadUrl");
    const path = dl ?? href;
    const downloadUrl = path.startsWith("http")
      ? path
      : urls.LEARN_PREFIX + (path.startsWith("/") ? path : "/" + path);
    const size = decodeHtml(/<span[^>]*class="[^"]*color[^"]*"[^>]*>([^<]*)<\/span>/i.exec(block)?.[1] ?? "").trim();
    if (!id && !name) return undefined;
    return { id, name, downloadUrl, size: size || undefined };
  }

  /** 作业详情页（viewCj HTML）附件解析 —— thu-learn-lib parseHomeworkAtUrl 等价。
   *  附件只存在于 HTML 页（div.list.fujian.clearfix 四块：附件/答案/我的提交/批改），
   *  列表 JSON 与 detail JSON 均不含——这正是此前"作业文件消失"的原因。 */
  async getHomeworkPageDetail(courseId: string, studentHomeworkId: string): Promise<HomeworkPageDetail> {
    this.#requireCsrf();
    const html = await this.#http.text(urls.LEARN_HOMEWORK_PAGE(courseId, studentHomeworkId));
    const out: HomeworkPageDetail = {};
    // 以 class="list …" 区块起点切分页面，取 fujian 块（文档序 = 四类附件顺序）
    const starts = [...html.matchAll(/<div[^>]*class=["']list[^"']*["'][^>]*>/gi)].map((m) => ({
      idx: m.index ?? 0,
      fujian: /fujian/i.test(m[0]),
    }));
    const keys = ["attachment", "answerAttachment", "submittedAttachment", "gradeAttachment"] as const;
    let kindIdx = 0;
    for (let i = 0; i < starts.length && kindIdx < keys.length; i++) {
      if (!starts[i]!.fujian) continue;
      const end = i + 1 < starts.length ? starts[i + 1]!.idx : Math.min(html.length, starts[i]!.idx + 30000);
      const a = this.#parseAttachmentAnchor(html.slice(starts[i]!.idx, end));
      const k = keys[kindIdx];
      if (a && k) out[k] = a;
      kindIdx++;
    }
    return out;
  }

  /** 通知详情页（beforeViewXs HTML）附件解析 —— thu-learn-lib parseNotificationDetail 等价。
   *  学生版附件锚点带 class="ml-10"（href 含 wjid）；fjmc 只有文件名，下载地址在页面里。 */
  async getNotificationPageDetail(courseId: string, notificationId: string): Promise<NotificationPageDetail> {
    this.#requireCsrf();
    const html = await this.#http.text(urls.LEARN_NOTIFICATION_DETAIL(courseId, notificationId));
    const anchors = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
    const pick =
      anchors.find((m) => /ml-10/i.test(m[0]) || /[?&]wjid=/.test(m[1]!)) ??
      anchors.find((m) => /wjid/i.test(m[0]));
    if (!pick) return {};
    const href = decodeHtml(pick[1]!);
    const q = href.indexOf("?");
    const params = new URLSearchParams(q >= 0 ? href.slice(q + 1) : "");
    const id = params.get("wjid") ?? params.get("fileId") ?? "";
    const dl = params.get("downloadUrl");
    const path = dl ?? href;
    const downloadUrl = path.startsWith("http")
      ? path
      : urls.LEARN_PREFIX + (path.startsWith("/") ? path : "/" + path);
    const name = decodeHtml(pick[2]!.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    const size = decodeHtml(
      /id="attachment"[^>]*>[\s\S]*?<span[^>]*class="[^"]*color[^"]*"[^>]*>([^<]*)<\/span>/i.exec(html)?.[1] ?? "",
    ).trim();
    if (!id && !name) return {};
    return { attachment: { id, name, downloadUrl, size: size || undefined } };
  }

  /** 通知（全部课程或指定课程）；expired=已过期 */
  async getAllNotifications(courseIds: string[], expired = false): Promise<Notification[]> {
    this.#requireCsrf();
    const groups = await Promise.all(
      courseIds.map((courseId) =>
        this.#withRelogin(async () => {
          const json = await this.#http.json<LearnJson>(this.#withCsrf(urls.LEARN_NOTIFICATION_LIST(expired)), {
            method: "POST",
            body: this.#aoData({ wlkcid: courseId, iDisplayStart: 0, iDisplayLength: 50 }),
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          });
          return asArray(json.object ?? json.resultList).map((raw) => {
            const d = raw as Record<string, unknown>;
            const cid = str(d.wlkcid) || courseId;
            const nid = str(d.ggid ?? d.id);
            return {
              id: nid,
              courseId: cid,
              title: decodeHtml(d.bt ?? d.ggbt),
              content: decodeBase64Utf8(str(d.ggnr)),
              publisher: decodeHtml(d.fbrxm),
              publishTime: str(d.fbsj),
              expireTime: d.jzsj ? str(d.jzsj) : undefined,
              important: str(d.sfqd) === "1",
              hasRead: str(d.sfyd) === "1" || str(d.sfyd) === "Y",
              attachmentName: str(d.fjmc).trim() || undefined,
              url: urls.LEARN_NOTIFICATION_DETAIL(cid, nid),
            };
          });
        }).catch(() => [] as Notification[]),
      ),
    );
    return groups.flat();
  }

  async getFileList(courseId: string): Promise<CourseFile[]> {
    return this.#withRelogin(async () => {
      this.#requireCsrf();
      const json = await this.#http.json<LearnJson>(this.#withCsrf(urls.LEARN_FILE_LIST(courseId)));
      // 学生端点返回 object 为行数组（thu-learn-lib getFileList 同源）；
      // 解析 resultList 会导致文件列表恒为空（"文件消失"根因）。
      const rows = Array.isArray(json.object)
        ? json.object
        : Array.isArray(json.resultList)
          ? json.resultList
          : [];
      return rows.map((raw) => {
        const d = raw as Record<string, unknown>;
        const fid = str(d.wjid);
        const rawType = str(d.wjlx).trim().replace(/^\./, "");
        return {
          id: fid,
          courseId,
          title: decodeHtml(d.bt ?? d.kjbt),
          uploadTime: str(d.scsj ?? d.fxsj ?? d.scj),
          downloadUrl: urls.LEARN_FILE_DOWNLOAD(fid),
          fileType: rawType || undefined,
          size: str(d.fileSize).trim() || undefined,
          description: decodeHtml(d.ms).trim() || undefined,
          important: str(d.sfqd) === "1",
        };
      });
    });
  }

  /** 课程「我的分组」（beforePageWdfzList HTML 宽容解析 → pageFzList JSON 兜底）。
   *  两路都提不出结构时返回 []，现场写入 lastGroupsDebug；
   *  分组页被重定向到登录页时抛 AuthRequiredError（与相邻 HTML 方法风格一致）。 */
  async getCourseGroups(wlkcid: string): Promise<LearnGroup[]> {
    return this.#withRelogin(async () => {
      this.#requireCsrf();
      const debug: string[] = [];
      // ① 任务规定的页面请求：GET /f/wlxt/qz/v_wlkc_qzcyb/student/beforePageWdfzList?wlkcid=
      //    （/f/ 静态页同 getHomeworkPageDetail/getNotificationPageDetail，直接 text 不带 _csrf）
      const pageUrl =
        urls.LEARN_PREFIX + "/f/wlxt/qz/v_wlkc_qzcyb/student/beforePageWdfzList?wlkcid=" + encodeURIComponent(wlkcid);
      const html = await this.#http.text(pageUrl);
      if (looksLikeLoginHtml(html)) {
        this.lastGroupsDebug = "GROUPS login-page len=" + html.length + " " + html.slice(0, 300).replace(/\s+/g, " ");
        throw new AuthRequiredError("网络学堂会话已失效（分组页返回登录页）");
      }
      const table = parseGroupTables(html);
      if (table.length > 0) {
        this.lastGroupsDebug = "GROUPS ok source=html-table rows=" + table.length;
        return table;
      }
      const rawLines = parseGroupRawLines(html);
      if (rawLines.length > 0) {
        this.lastGroupsDebug = "GROUPS ok source=html-rawlines rows=" + rawLines.length;
        return rawLines;
      }
      const tbody = /<tbody[^>]*>([\s\S]{0,400})/i.exec(html)?.[1] ?? "";
      debug.push("html len=" + html.length + " tbody=" + tbody.replace(/\s+/g, " ").slice(0, 200));
      // ② 兜底：分组页 DataTables 的数据源（页面自身 fnServerData 同款 POST aoData）。
      //    静态 HTML 只有空 tbody，行数据必须从这里拿。
      try {
        const json = await this.#http.json<LearnJson>(
          this.#withCsrf(urls.LEARN_PREFIX + "/b/wlxt/qz/v_wlkc_qzcyb/student/pageFzList"),
          {
            method: "POST",
            body: this.#aoData({ wlkcid, iDisplayStart: 0, iDisplayLength: 100 }),
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          },
        );
        const rows = asArray(json.object);
        const groups = rows.map(parseGroupJsonRow).filter((g): g is LearnGroup => g !== undefined);
        if (groups.length > 0) {
          this.lastGroupsDebug = "GROUPS ok source=json rows=" + groups.length;
          return groups;
        }
        debug.push("json rows=" + rows.length + " result=" + str(json.result));
      } catch (e) {
        // 页面 HTML 正常而 JSON 端点异常（404/改版）≠ 会话失效：不外抛，留现场
        debug.push("json-ERR " + String(e).slice(0, 200));
      }
      this.lastGroupsDebug = "GROUPS empty " + debug.join(" | ").slice(0, 1200);
      return [];
    });
  }

  #aoData(params: Record<string, unknown>): URLSearchParams {
    return new URLSearchParams({
      aoData: JSON.stringify(Object.entries(params).map(([name, value]) => ({ name, value }))),
    });
  }
}
