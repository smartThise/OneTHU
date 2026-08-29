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
