export interface SemesterInfo {
  id: string;
}

/** 校历学期（demo parseCalendarData：kssj 对齐到所在教学周的周一） */
export interface CalendarSemester {
  /** 第一周周一，yyyy-MM-dd */
  firstDay: string;
  semesterId: string;
  semesterName: string;
  weekCount: number;
}

/** 校历（当前学期 + 未来学期列表） */
export interface CalendarData extends CalendarSemester {
  nextSemesterList: CalendarSemester[];
}

export interface CourseInfo {
  id: string;
  name: string;
  englishName: string;
  courseNumber: string;
  courseIndex: number;
  teacherName: string;
  timeAndLocation: string[];
  url: string;
  /** Official homepage counters; undefined means the endpoint did not supply a value. */
  summary?: { unreadNotices?: number; unreadFiles?: number; pendingHomework?: number; answeredQuestions?: number; pendingQuestionnaires?: number; participatedThreads?: number; startedThreads?: number };
}

export interface Homework {
  id: string;
  /** 作业基础 id（zyid），查详情用 */
  baseId?: string;
  courseId: string;
  title: string;
  /** 作业说明（HTML，来自列表 nr 字段 base64 解码） */
  content: string;
  publishTime: string;
  deadline: string;
  lateDeadline?: string;
  /** 是否补交 */
  lateSubmission?: boolean;
  /** 1=个人完成 2=小组完成（zywcfs） */
  completionType?: number;
  submitted: boolean;
  graded: boolean;
  /** 提交时间（scsj，未交为空） */
  submitTime?: string;
  /** 分数（cj；负数为等级码） */
  grade?: string | number;
  /** 批改人（jsm） */
  graderName?: string;
  /** 批语（pynr） */
  gradeContent?: string;
  /** 批改时间（pysj） */
  gradeTime?: string;
  url: string;
  /** 外部来源；网络学堂作业为 undefined（见 exthw） */
  source?: import("../exthw/types.js").ExtHwSourceId;
  /** 外部详情链接 */
  externalUrl?: string;
  /** 外部作业的课程名（网络学堂作业从 courses 映射，不需要本字段） */
  courseName?: string;
  /** 外部作业作答进度（如 "5/5"；仅外部作业，用于来源徽标 tooltip） */
  externalProgress?: string;
  /** 外部作业类型：考试 / 普通作业（仅外部作业，透出自 ExternalHomework.kind） */
  kind?: "homework" | "exam" | "quiz";
  /** 外部作业所属课堂是否旁听（仅外部作业，透出自 ExternalHomework.audited） */
  audited?: boolean;
  /** 外部考试得分 / 卷面满分（仅已提交且已出分的考试；R20-B3 起已批改雨课堂作业同口径：
   *  score = 已批改题得分合计、totalScore = 卷面满分；未批改不设 → 入口不显示） */
  score?: number;
  totalScore?: number;
  /** R20-B2：雨课堂原生详情页拉取参数 leaf_type_id（仅 yuketang 透出自
   *  ExternalHomework.leafTypeId；缺失时 UI 回退网页打开，其余源恒 undefined） */
  externalLeafTypeId?: string;
  /** R20-B2：雨课堂 classroom_id（与 externalLeafTypeId 成对出现，仅 yuketang） */
  externalClassroomId?: string;
}

/** 可下载附件（thu-learn-lib RemoteFile 精简版） */
export interface LearnAttachment {
  /** 文件 id（fileId/wjid 参数） */
  id: string;
  name: string;
  /** 完整下载地址（含 LEARN_PREFIX） */
  downloadUrl: string;
  /** 人类可读大小（页面 span 文本） */
  size?: string;
}

export interface LearnRoleAttachment extends LearnAttachment {
  role: "teacher" | "answer" | "submission" | "grade";
}

/** 作业详情页（/f/wlxt/kczy/zy/student/viewCj HTML）解析结果。
 *  附件四类与 thu-learn-lib parseHomeworkAtUrl 对应（div.list.fujian.clearfix 顺序）。 */
export interface HomeworkPageDetail {
  /** All visible attachments; legacy single slots below retain their first entry. */
  attachments?: LearnRoleAttachment[];
  /** 页面作业说明（c55 div，一般与 JSON msg 一致；优先用 JSON msg） */
  description?: string;
  /** 上次提交的正文内容（boxbox 结构，learn-lib submittedContent 同源；提交面板预填用） */
  submittedContent?: string;
  /** 教师附件 */
  attachment?: LearnAttachment;
  /** 答案附件 */
  answerAttachment?: LearnAttachment;
  /** 我的提交附件 */
  submittedAttachment?: LearnAttachment;
  /** 批改附件 */
  gradeAttachment?: LearnAttachment;
  /** 本作业详情页是否存在提交表单（解析自 viewCj 页面真实控件，判定细则见
   *  client.getHomeworkPageDetail 注释）。学生端列表接口没有提交方式字段，
   *  UI 只按此页面事实渲染提交卡；提交/撤回后随 viewCj 重新解析即时刷新——
   *  已提交作业的页面表单会变化（如变为可再次提交/撤回附件），以重取结果为准。 */
  hasSubmitForm: boolean;
}

/** 通知详情页（beforeViewXs HTML）解析结果 */
export interface NotificationPageDetail {
  attachments?: LearnAttachment[];
  attachment?: LearnAttachment;
}

export interface Notification {
  id: string;
  courseId: string;
  title: string;
  /** 正文 HTML（列表 ggnr 字段 base64 解码） */
  content?: string;
  publisher: string;
  publishTime: string;
  /** 截止/过期时间（jzsj） */
  expireTime?: string;
  /** 标记为重要（sfqd） */
  important?: boolean;
  /** 服务端已读标记（sfyd） */
  hasRead?: boolean;
  /** 附件文件名（fjmc），下载功能暂未实现 */
  attachmentName?: string;
  url: string;
}

/** 课程「我的分组」（/f/wlxt/qz/v_wlkc_qzcyb/student/beforePageWdfzList 页及其
 *  DataTables 数据源 /b/wlxt/qz/v_wlkc_qzcyb/student/pageFzList） */
export interface LearnGroup {
  /** 组 id（qzid；接口不回传时以组名兜底） */
  id: string;
  /** 组名（qzmc，如 "Section-Section 1"） */
  name: string;
  /** 组成员（qzmp 逗号/空格分隔的姓名列表） */
  members: Array<{
    /** 姓名 */
    name: string;
    /** 学号（现有接口不提供，预留） */
    sid?: string;
    /** 角色标注（如创建人 czr 命中成员姓名时标 "创建人"） */
    role?: string;
  }>;
  /** 讨论区话题数（现有接口不提供，预留） */
  topicCount?: number;
  /** 创建人（czr） */
  creator?: string;
  /** 创建时间（czsj，如 "2026-03-03"） */
  createTime?: string;
}

export interface CourseFile {
  id: string;
  courseId: string;
  title: string;
  uploadTime: string;
  downloadUrl: string;
  /** 文件类型/扩展名（wjlx） */
  fileType?: string;
  /** 人类可读大小（fileSize，如 "2.3MB"） */
  size?: string;
  /** 说明（ms） */
  description?: string;
  /** 标记为重要（sfqd） */
  important?: boolean;
}

/* ───── 讨论区（网络学堂 bbs_tltb） ───── */

/** 话题板块（bqListByWlkcid；bqid 形如 INITTL… 默认板或课程自建板） */
export interface LearnBbsBoard {
  bqid: string;
  name: string;
}

/** 话题列表行（ybtl/jhtl/cytlPageList DataTables 1.9 服务端协议 aaData 行：
 *  bt=标题，fbrx / fbsj=作者 / 时间，sfjh=精华，sfzd=置顶，hfcs=回复数） */
export interface LearnBbsThreadSummary {
  id: string;
  title: string;
  author: string;
  time: string;
  replies: number;
  /** 精华（站点字段 sfjh == "是"） */
  essence: boolean;
  /** 置顶（站点字段 sfzd == "是"） */
  pinned: boolean;
  bqid?: string;
}

/** 附件（帖子层只有一个：wjid/wjmc） */
export interface LearnBbsPostAttachment {
  wjid: string;
  wjmc: string;
}

/** 楼层（含楼中楼 children） */
export interface LearnBbsPost {
  hhid: string;
  author: string;
  time: string;
  /** 服务端消毒过的富文本（nr_str） */
  html: string;
  attachments: LearnBbsPostAttachment[];
  children: LearnBbsPost[];
}

/** 话题头（楼主块 + 分页上下文 + 服务端渲染的首屏回复） */
export interface LearnBbsThreadDetail {
  id: string;
  title: string;
  author: string;
  time: string;
  html: string;
  /** 首屏回复（viewTlById HTML 服务端渲染，≤8 条；翻页走 getBbsThreadPosts 且 pageNum 从 1 起） */
  posts: LearnBbsPost[];
  replyCount: number;
  tabbh: string;
  tabid: string;
  bqid: string;
}
