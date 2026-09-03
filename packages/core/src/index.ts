/** @onethu/core —— One THUer should have OneTHU. */

// 传输层
export { HttpClient, MemoryCookieJar, AuthRequiredError, DEFAULT_USER_AGENT, onAuthRequired, suspendAuthBroadcast } from "./http.js";
export type { CookieJar, CookieRecord, FetchLike, HttpClientOptions } from "./http.js";

// 加密
export * as webvpn from "./crypto/webvpn.js";
export { encodeUrl as webvpnEncodeUrl, decodeUrl as webvpnDecodeUrl, webvpnWrap } from "./crypto/webvpn.js";
export * as sm2crypto from "./crypto/sm2.js";
export { decryptResponse } from "./crypto/decryptResponse.js";

// 授权
export { MemoryCredentialStore, LocalStorageCredentialStore, makeFingerprint } from "./auth/store.js";
export type { CredentialStore, SessionData } from "./auth/store.js";
export {
  CasError,
  TwoFactorRequired,
  extractCasReason,
  fetchCasForm,
  submitCasLogin,
  parseCasFormHtml,
  list2FAMethods,
  send2FACode,
  verify2FACode,
  trustDevice,
  ID_PREFIX,
  CAS_LOGIN_FORM,
  CAS_LOGIN_CHECK,
  DOUBLE_AUTH_URL,
  LEARN_ROAM,
  INFO_ROAM,
} from "./auth/cas.js";
export type { CasCredential, CasFormInfo, CasSubmitResult, TwoFactorMethod } from "./auth/cas.js";
export { CampusSession } from "./auth/session.js";
export type { SessionState, LoginResult, CampusSessionOptions } from "./auth/session.js";

// 网络学堂
export { LearnClient, parseLearnTime } from "./learn/client.js";
export * as learnUrls from "./learn/urls.js";
export type {
  CourseInfo,
  CourseFile,
  CalendarData,
  CalendarSemester,
  Homework,
  HomeworkPageDetail,
  LearnAttachment,
  LearnGroup,
  Notification,
  NotificationPageDetail,
  SemesterInfo,
  LearnBbsBoard,
  LearnBbsThreadSummary,
  LearnBbsPostAttachment,
  LearnBbsPost,
  LearnBbsThreadDetail,
} from "./learn/types.js";

// 信息门户
export { InfoClient, isAuthError, ServiceUnavailableError } from "./info/client.js";
export * as infoUrls from "./info/urls.js";
export type {
  AssessmentForm,
  AssessmentInputGroup,
  AssessmentInputTag,
  AssessmentPerson,
  BasicUserInfo,
  BankPayment,
  BankPaymentByMonth,
  CardInfo,
  CardTransaction,
  Classroom,
  ClassroomState,
  ClassroomStateResult,
  DeadlineItem,
  ElePayRecord,
  EleRemainder,
  ExamEntry,
  GraduateIncome,
  Invoice,
  InvoicePage,
  LibBookRecord,
  LibFuzzySearchResult,
  LibRoom,
  LibRoomBookRecord,
  LibRoomInfo,
  LibRoomRes,
  LibRoomUsage,
  Library,
  LibraryFloor,
  LibrarySeat,
  LibrarySeatAvailability,
  LibrarySection,
  NetworkAccountInfo,
  NetworkBalance,
  NetworkDevice,
  NewsAttachment,
  NewsDetail,
  NewsItem,
  ReportRow,
  SchoolCalendarData,
  SchoolSemester,
  ScheduleEntry,
  SportsIdInfo,
  SportsReservationRecord,
  SportsResource,
  SportsResourcesInfo,
} from "./info/types.js";
export type { ValidReceiptTitle } from "./info/sports.js";
/* 学生宿舍公共空间（共享家园网 kongjian，WebForms） */
export type { KongjianSpace, KongjianSlot, KongjianPage, KongjianRecord } from "./info/kongjian.js";
export { VALID_RECEIPT_TITLES, sportsIdInfoList } from "./info/sports.js";
export { ClassroomStatus } from "./info/types.js";

// 洗衣机（thu-info-app washer.tsx 移植：捷利 + 海乐生活公开接口，无需校内会话）
export { getWasherBuildingGroups, getWasherDevices } from "./info/washer.js";
export type { WasherBuilding, WasherBuildingGroup, WasherDevice } from "./info/washer.js";

// 订水（thu-info-app network/water.ts 移植：清华水站公开接口）
export {
  WATER_BRANDS,
  WATER_SUB_URL,
  WATER_USER_URL,
  getWaterUserInformation,
  submitWaterOrder,
} from "./info/water.js";
export type { WaterUserInformation } from "./info/water.js";

// 选课系统（zhjwxk，经 WebVPN 旁路：demo server.js 逐行移植 + nextthuxk v1.4.9 管线）
export {
  getSelectedCourses,
  getQueueStatus,
  resolveZhjwxkSemester,
  searchXkCourses,
  type XkSearchResult,
  semesterFromDate,
  parseSelectedCourses,
  parseQueueCandidates,
  getXkCatalog,
  getXkCourseDetail,
  getXkPlan,
  getXkLevelTable,
  getXkSelectedFull,
  getXkVolunteer,
  getXkQueueData,
  getXkLevelTypes,
  submitXkCourse,
  dropXkCourse,
  changeXkVolunteer,
  parseVolStr,
  setZhjwxkDebug,
  ZY_LIMITS,
} from "./zhjwxk/client.js";
export type {
  ZhjwxkSession,
  SelectedCourse,
  QueueCandidate,
  XkCourse,
  XkCourseDetail,
  XkPlanItem,
  XkLevelTableRow,
  XkSelectedRow,
  XkVolInfo,
  XkQueueInfo,
  XkWriteResult,
  XkFlag,
} from "./zhjwxk/client.js";

export { LEARN_FILE_DOWNLOAD, LEARN_PREFIX } from "./learn/urls.js";
export { setWebvpnLog } from "./auth/demoLogin.js";

/* courseX（tsinghua.app 课表共享库）——免凭证公开查询，上传不接入（无公开登录渠道） */
export { courseXSemesterText, getCourseXDetailPublic, getCourseXSemesters, searchCourseXPublic } from "./coursex/client.js";
export type { CourseXDetail, CourseXSemester, CourseXSummary } from "./coursex/client.js";

/* 体育场馆系统（sports.tsinghua.edu.cn unifound-venue）—— 独立 token 鉴权 */
export { VenueClient, VenueAuthRequiredError, VenueApiError, VENUE_BASE, fmtVenueDate, venueTokenExpiresAt } from "./venue/client.js";
export { md5hex, buildVenueSign, venueSignQuery, VENUE_APP_ID, VENUE_SIGN_KEY } from "./venue/sign.js";
export type { VenueBuilding, VenueDevKind, VenueSameLevel, VenueScene, VenueSession, VenueSite, VenueRecord, VenueUser } from "./venue/types.js";
