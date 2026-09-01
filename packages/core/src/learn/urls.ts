/** 网络学堂端点（验证自 thu-learn-lib，docs/API-NOTES.md §2） */
export const LEARN_PREFIX = "https://learn.tsinghua.edu.cn";

export const LEARN_COURSE_LIST_PAGE = () => `${LEARN_PREFIX}/f/wlxt/index/course/student/`;

export const LEARN_SEMESTER_LIST = () =>
  `${LEARN_PREFIX}/b/wlxt/kc/v_wlkc_xs_xktjb_coassb/queryxnxq`;

export const LEARN_CURRENT_SEMESTER = () =>
  `${LEARN_PREFIX}/b/kc/zhjw_v_code_xnxq/getCurrentAndNextSemester`;

export const LEARN_COURSE_LIST = (semester: string, lang: "zh" | "en" = "zh") =>
  `${LEARN_PREFIX}/b/wlxt/kc/v_wlkc_xs_xkb_kcb_extend/student/loadCourseBySemesterId/${semester}/${lang}`;

export const LEARN_COURSE_TIME_LOCATION = (courseId: string) =>
  `${LEARN_PREFIX}/b/kc/v_wlkc_xk_sjddb/detail?id=${courseId}`;

export const LEARN_COURSE_PAGE = (courseId: string) =>
  `${LEARN_PREFIX}/f/wlxt/index/course/student/course?wlkcid=${courseId}`;

export const LEARN_FILE_LIST = (courseId: string, size = 200) =>
  `${LEARN_PREFIX}/b/wlxt/kj/wlkc_kjxxb/student/kjxxbByWlkcidAndSizeForStudent?wlkcid=${courseId}&size=${size}`;

export const LEARN_FILE_DOWNLOAD = (fileId: string) =>
  `${LEARN_PREFIX}/b/wlxt/kj/wlkc_kjxxb/student/downloadFile?sfgk=0&wjid=${fileId}`;

export const LEARN_NOTIFICATION_LIST = (expired: boolean) =>
  `${LEARN_PREFIX}/b/wlxt/kcgg/wlkc_ggb/student/pageListXsby${expired ? "Ygq" : "Wgq"}`;

export const LEARN_NOTIFICATION_DETAIL = (courseId: string, notificationId: string) =>
  `${LEARN_PREFIX}/f/wlxt/kcgg/wlkc_ggb/student/beforeViewXs?wlkcid=${courseId}&id=${notificationId}`;

export const LEARN_HOMEWORK_LIST = {
  /** 未提交 */
  new: `${LEARN_PREFIX}/b/wlxt/kczy/zy/student/zyListWj`,
  /** 已交未批 */
  submitted: `${LEARN_PREFIX}/b/wlxt/kczy/zy/student/zyListYjwg`,
  /** 已批 */
  graded: `${LEARN_PREFIX}/b/wlxt/kczy/zy/student/zyListYpg`,
} as const;

export const LEARN_HOMEWORK_PAGE = (courseId: string, homeworkId: string) =>
  `${LEARN_PREFIX}/f/wlxt/kczy/zy/student/viewCj?wlkcid=${courseId}&xszyid=${homeworkId}`;

/** 作业详情（form POST id=zyid，响应 msg 为说明 HTML）—— thu-learn-lib LEARN_HOMEWORK_DETAIL */
export const LEARN_HOMEWORK_DETAIL = () => `${LEARN_PREFIX}/b/wlxt/kczy/zy/student/detail`;

/* ───── 讨论区（bbs_tltb）—— 2026-09 HAR 逆向（讨论区示例/learn.tsinghua.edu.cn.har） ───── */

/** 话题列表页（服务端渲染 HTML）。tabid = 板块（课程讨论/答疑区等），tabbh 恒 2 */
export const LEARN_BBS_THREAD_LIST = (courseId: string, tabId?: string) =>
  `${LEARN_PREFIX}/f/wlxt/bbs/bbs_tltb/student/beforePageTlList?wlkcid=${courseId}${tabId ? `&tabbh=2&tabid=${tabId}` : ""}`;

/** 话题阅读页（HTML：楼主块 + 首屏回复；分页走 LEARN_BBS_POSTS_PAGE） */
export const LEARN_BBS_THREAD_VIEW = (courseId: string, threadId: string) =>
  `${LEARN_PREFIX}/f/wlxt/bbs/bbs_tltb/student/viewTlById?wlkcid=${courseId}&id=${threadId}`;

/** 回复分页 JSON。注意路径里 bbs_tltb 出现两次——站点原样。hhid 留空 = 主楼层流 */
export const LEARN_BBS_POSTS_PAGE = (courseId: string, threadId: string, pageNum: number) =>
  `${LEARN_PREFIX}/b/wlxt/bbs/bbs_tltb/bbs_tltb/student/pageViewTlById?wlkcid=${courseId}&id=${threadId}&hhid=&pageNum=${pageNum}`;

/** 发表回复（表单 POST：wlkcid/tltid/nr [+fhhid/_fhhid 楼中楼]）—— addHf→saveEdit */
export const LEARN_BBS_SAVE_REPLY = (courseId: string) =>
  `${LEARN_PREFIX}/b/wlxt/bbs/bbs_tltb/student/saveEdit?wlkcid=${courseId}`;

/** 发新话题表单页（发表在浏览器完成，表单 schema 未采样） */
export const LEARN_BBS_NEW_THREAD_PAGE = (courseId: string) =>
  `${LEARN_PREFIX}/f/wlxt/bbs/bbs_tltb/student/beforeEditTl?wlkcid=${courseId}`;

/** 话题附件下载（学生） */
export const LEARN_BBS_ATTACHMENT = (courseId: string, wjid: string) =>
  `${LEARN_PREFIX}/b/wlxt/bbs/bbs_tltb/student/downloadFileByTlForStu?wlkcid=${courseId}&wjid=${wjid}`;
