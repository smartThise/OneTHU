/**
 * 外部作业源（荷塘雨课堂 / TUOJ / Tyche）统一类型。
 *
 * 设计约束（见 docs/外部作业源-需求与实现方案.md 5.2）：
 * - core 层只做**只读**拉取：不依赖 DOM / localStorage；
 * - 网络一律走宿主注入的 `FetchLike`（desktop 传 universalFetch，即 Tauri 传输层，
 *   无 CORS、可显式透传 Cookie 头）；
 * - 凭据由 desktop 层从 localStorage 读出后注入，core 不碰存储。
 *
 * 服务端地址（base URL）**一律硬编码**在各源文件里，凭据结构不再暴露服务器字段。
 */
import type { FetchLike, HttpClient } from "../http.js";

export type ExtHwSourceId = "yuketang" | "tuoj" | "tuojClassic" | "tyche" | "dsa";

/** TUOJ 系（共用同一套客户端与清华统一认证漫游，仅 base/id/name 不同） */
export type TuojSourceId = "tuoj" | "tuojClassic";

/** 源展示名（UI 徽标 / 设置页统一口径） */
export const SOURCE_NAMES: Record<ExtHwSourceId, string> = {
  yuketang: "雨课堂",
  tuoj: "TUOJ（AI 版）",
  tuojClassic: "TUOJ（经典版）",
  tyche: "Tyche",
  dsa: "DSA OJ",
};

/** 源大类：`courseware` = 课程平台（雨课堂，人人可用）；
 *  `oj` = OJ 评测平台（按个人情况，不是每个 THUer 都有账号）。 */
export type ExtHwCategory = "courseware" | "oj";

/** 源 → 大类注册表（信息架构元数据；**不参与**凭据存储与拉取链路）。
 *  新增源只在此登记 category，设置页即可按大类自动归组。 */
export const SOURCE_CATEGORIES: Record<ExtHwSourceId, ExtHwCategory> = {
  yuketang: "courseware",
  tuoj: "oj",
  tuojClassic: "oj",
  tyche: "oj",
  dsa: "oj",
};

/** 大类展示名（设置页分组标题） */
export const SOURCE_CATEGORY_NAMES: Record<ExtHwCategory, string> = {
  courseware: "雨课堂",
  oj: "OJ 平台",
};

export interface ExternalHomework {
  /** 源内稳定唯一 id，用于 React key / 去重（不含 `ext:` 前缀） */
  id: string;
  source: ExtHwSourceId;
  courseName: string;
  title: string;
  /** 统一为 "YYYY-MM-DD HH:MM"（本地时区） */
  deadline: string;
  kind: "homework" | "exam";
  /** 详情链接（可空；三源均按 id/classroom 拼） */
  url?: string;
  /** 是否已提交（**真实判定**：三源各自查提交状态得出）。
   *  查询失败 / 无法判定（如雨课堂「试卷」类叶子无权限）时**保守为 false**。 */
  submitted: boolean;
  /** 已提交的题目数（可选，仅雨课堂有精确数据） */
  submittedCount?: number;
  /** 题目总数（可选，仅雨课堂有精确数据） */
  totalCount?: number;
  /** 是否已批改（R16 21.1；仅雨课堂能判定，其余源缺省 = 未批改，保守）。
   *  雨课堂作业：已提交且不存在「已作答但未批改」的题；试卷：已提交且已出分。 */
  graded?: boolean;
  /** 是否旁听课堂（雨课堂 courses/list `role===6`；role 5=正式、未知 role 不标，保守） */
  audited?: boolean;
  /** 得分（仅已提交且已出分/已批改时设置，避免误导性显示为 0 分）：
   *  考试 = /v/exam/cover 的 result.score（R9）；已批改作业 = 已批改题 my_score 合计（R20-B3） */
  score?: number;
  /** 卷面满分（与 score 成对出现）：考试 = /v/exam/cover 的 total_score；
   *  已批改作业 = 题面 content.score 合计（R20-B3；题面分值全缺失时不设） */
  totalScore?: number;
  /** R20-B2：雨课堂作业详情参数 leaf_type_id（get_exercise_list 路径段；仅 yuketang 源设置，
   *  其余源恒缺省）。移动端原生详情页（YktAssignmentDetailPage）据此拉整卷明细。 */
  leafTypeId?: string;
  /** R20-B2：雨课堂 classroom_id（与 leafTypeId 成对出现；仅 yuketang 源设置） */
  classroomId?: string;
}

/** 课程内容大类（各源 `activities[].type` 归一）。
 *  作业/试卷之外的类型同样属于「课程内容」——它们不进作业聚合，但可以按课程展示。 */
export type ExtContentKind =
  | "homework"
  | "exam"
  | "courseware"
  | "material"
  | "video"
  | "poll"
  | "discussion"
  | "announcement"
  | "other";

/** 源侧的「课程内容」实体（作业 / 试卷 / 课件 / 投票 / 讨论 / 公告 …）。
 *  与 `ExternalHomework` 的区别：那个是**作业聚合**的输入（带提交状态、参与未交统计），
 *  这个是**课程内容目录**的输入（只要是该课发布的内容就列出，不看提交状态）。 */
export interface ExternalContent {
  /** 源内稳定唯一 id，用于 React key / 去重 */
  id: string;
  source: ExtHwSourceId;
  /** 所属课程 id（雨课堂 = classroom_id） */
  courseId: string;
  courseName: string;
  /** 源侧原始类型值（雨课堂 = activities[].type，未知类型原样保留供诊断） */
  rawType: number;
  kind: ExtContentKind;
  /** 类型展示名（雨课堂已确认的：作业 / 试卷 / 课件 / 投票；未知类型回落「其他」） */
  kindText: string;
  title: string;
  /** 时间信息："YYYY-MM-DD HH:MM"（源未给则不设） */
  deadline?: string;
  /** 该内容在平台网页端的地址（可空） */
  url?: string;
  /** 作业 / 试卷的原生详情参数（有则宿主可走站内详情页） */
  leafTypeId?: string;
  /** 课件 / 视频等「叶子」的 id（源侧 content.leaf_id）：站内叶子路由与
   *  leaf_info 详情接口都用它（路由形如 /lms/{classroomId}/{segment}/{leafId}） */
  leafId?: string;
  /** 公告 id（源侧 content 里的 notice/link id 任一命中）：公告详情页用它 */
  noticeId?: string;
  /** 公告 id 的**候选列表**（源侧字段名不固定：notice/topic/link/article… 递归收集，
   *  按可能性排序）。详情取数按候选逐个试，命中即止——避免猜错字段名导致取不到正文。 */
  noticeIdCandidates?: string[];
  /** 公告正文直接内联在学习日志里的形态（有则前端无需再请求详情） */
  inlineBodyHtml?: string;
  /** 诊断：公告活动与 content 的**字段名**（不含值）——id 字段名未知时据此适配 */
  noticeShape?: string[];
  skuId?: string;
  /** 是否旁听课堂（与作业同口径） */
  audited?: boolean;
}

export interface HomeworkSource {
  id: ExtHwSourceId;
  /** 展示名：雨课堂 / TUOJ / Tyche */
  name: string;
  /** 拉取；失败必须 throw，由调用方隔离（单源失败不影响其他源） */
  fetch(): Promise<ExternalHomework[]>;
  /** 可选：拉取该源的**课程**列表（当前仅雨课堂提供；OJ 平台只有题目、无课程概念，缺省不实现）。
   *  失败必须 throw，由调用方隔离；与 `fetch()` 共用同一份课程列表请求（不额外打接口）。 */
  fetchCourses?(): Promise<ExternalCourse[]>;
  /** 可选：拉取该源的**全部课程内容**（作业/试卷之外的课件、投票、讨论…也算）。
   *  只读目录用途，不含提交状态；失败必须 throw，由调用方隔离。
   *  与 `fetch()` 共用同一份学习日志请求（不额外打接口）。 */
  fetchContents?(): Promise<ExternalContent[]>;
}

/** 源侧的「课程」实体（与 `ExternalHomework` 的作业条目区分开）：
 *  用于把平台课程卡片展示在宿主页面里（如网络学堂页的「雨课堂课程」一节）。 */
export interface ExternalCourse {
  /** 源内稳定唯一 id（雨课堂 = classroom_id），用于 React key / 去重 */
  id: string;
  source: ExtHwSourceId;
  /** 源侧课堂全名（雨课堂 = `name`，形如「2026秋-线性代数-8」）——官方卡片里的小标题 */
  name: string;
  /** 课程本名（雨课堂 = `course.name`，形如「线性代数」）——官方卡片里的大标题；
   *  源未提供时缺省，调用方回落 `name`。 */
  title?: string;
  /** 授课教师名（雨课堂 = `teacher.name`） */
  teacher?: string;
  /** 是否旁听课堂（雨课堂 courses/list 的 role===6；其余源缺省） */
  audited?: boolean;
  /** 该课程在平台网页端的入口（可空） */
  url?: string;
}

/** 组装后的源：在基础源上附带大类元数据（由 createExternalSources 按
 *  `SOURCE_CATEGORIES` 登记，设置页据此归组；不影响拉取链路）。 */
export interface RegisteredHomeworkSource extends HomeworkSource {
  category: ExtHwCategory;
}

/** 凭据（由 desktop 层从 localStorage 读出后注入；core 不碰存储） */
export interface ExtHwCreds {
  /** 登录后拼好的会话 Cookie；`phone` 仅用于设置页回填 */
  yuketang?: { cookie: string; uvId?: string; phone?: string };
  /** 登录后拼好的会话 Cookie；`username` 仅用于设置页回填。
   *  `via`: "cas" = 清华统一认证漫游（会话在 HttpClient 的 jar 里，cookie 可空）；
   *         "password" = TUOJ 账号密码登录。 */
  tuoj?: TuojCreds;
  /** 经典 TUOJ（oj.cs.tsinghua.edu.cn）：同 AI 版结构（复用同一客户端）。 */
  tuojClassic?: TuojCreds;
  /** DSA OJ（dsa.cs.tsinghua.edu.cn）：邮箱 + 密码登录，会话 Cookie；
   *  `username`（邮箱）仅用于设置页回填。 */
  dsa?: { cookie: string; username?: string };
  /** 登录后拼好的会话 Cookie；Basic 头已硬编码，不在此暴露。
   *  R21-A：`password` = 「记住密码」勾选后保存的 Tyche 登录口令（**明文参数，只存在于
   *  本结构内存态**；落盘走 desktop 的 AES-GCM 信封 `onethu.exthw.v1`，与既有凭据同路——
   *  信封整体加密，不存在明文落盘）。会话失效（status=login / 401 / 跳登录页）时
   *  desktop 用 username+password 静默自动重登一次；未记住（缺省）则保持旧行为=手动。 */
  tyche?: { cookie: string; username?: string; password?: string };
  /** 只保留未来 N 天（默认 30）；已过期的仍保留（属"未提交"） */
  days?: number;
}

/** TUOJ 系凭据（AI 版 / 经典版共用） */
export interface TuojCreds {
  cookie: string;
  username?: string;
  via?: "cas" | "password";
}

/** 组装三源（只组装已配置 cookie / 已漫游的源），并附上 `category` 大类元数据 */
export type CreateExternalSources = (deps: {
  creds: ExtHwCreds;
  fetchLike: FetchLike;
  /** 带 CookieJar 的 core HttpClient（TUOJ 的清华统一认证漫游会话在 jar 里） */
  http?: HttpClient;
}) => RegisteredHomeworkSource[];
