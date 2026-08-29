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
  /** 1=线上提交 2=线下提交（zytjfs） */
  submissionType?: number;
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

/** 作业详情页（/f/wlxt/kczy/zy/student/viewCj HTML）解析结果。
 *  附件四类与 thu-learn-lib parseHomeworkAtUrl 对应（div.list.fujian.clearfix 顺序）。 */
export interface HomeworkPageDetail {
  /** 页面作业说明（c55 div，一般与 JSON msg 一致；优先用 JSON msg） */
  description?: string;
  /** 教师附件 */
  attachment?: LearnAttachment;
  /** 答案附件 */
  answerAttachment?: LearnAttachment;
  /** 我的提交附件 */
  submittedAttachment?: LearnAttachment;
  /** 批改附件 */
  gradeAttachment?: LearnAttachment;
}

/** 通知详情页（beforeViewXs HTML）解析结果 */
export interface NotificationPageDetail {
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
