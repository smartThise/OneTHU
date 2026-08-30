export interface BasicUserInfo {
  name: string;
  studentId: string;
  gender?: string;
  department?: string;
  major?: string;
  /** 校园邮箱（demo 同款：'addr':'…@mails.tsinghua.edu.cn'） */
  email?: string;
}

export interface ScheduleEntry {
  courseName: string;
  teacher?: string;
  /** "2025-02-24" */
  date?: string;
  /** 星期 1-7 */
  dayOfWeek?: number;
  /** 起始节次 */
  startSection?: number;
  endSection?: number;
  location?: string;
  weekText?: string;
  /** 条目分类（zhjw fl 字段：课程 / 考试 / 个人日历 …） */
  category?: string;
  /** "08:00"（zhjw kssj，全角冒号已归一） */
  startTime?: string;
  endTime?: string;
  raw: Record<string, unknown>;
}

/** 成绩行 —— 字段与 thu-info-lib models/home/report Course 对齐（本科索引） */
export interface ReportRow {
  /** 课程名（td[3]） */
  name: string;
  /** 学分（td[5]） */
  credit: number;
  /** 等级制成绩（td[7]） */
  grade: string;
  /** 学分绩点（td[9]） */
  point: number;
  /** 学期（td[11]，如 "2024-2025秋"） */
  semester: string;
  /** 原始单元格文本（顺序保留） */
  raw: string[];
}

/** 校园卡余额/状态 —— thu-info-lib models/card/info CardInfo 子集 */
export interface CardInfo {
  userId: string;
  userName: string;
  departmentName?: string;
  /** 元（服务端为分） */
  balance: number;
  cardId: string;
  /** 卡状态（如 "正常"） */
  cardStatus?: string;
  lastTransactionTimestamp?: Date;
  /** 单日消费上限（元） */
  maxDailyTransactionAmount?: number;
  /** 单笔消费上限（元） */
  maxOneTimeTransactionAmount?: number;
}

/** 校园卡流水 —— thu-info-lib models/card/transaction CardTransaction 对齐 */
export interface CardTransaction {
  id: string;
  summary: string;
  timestamp: Date;
  /** 元（服务端为分；消费为负、充值为正） */
  amount: number;
  /** 交易后余额（元） */
  balance: number;
  address?: string;
  /** 商户/场所名 */
  name?: string;
  /** 交易类型名（消费 / 圈存 …） */
  txName?: string;
}

/** 考试安排 —— 取自课表 JSONP 中分类为「考试」的条目（thu-info-lib parseJSON 同源数据） */
export interface ExamEntry {
  courseName: string;
  /** "2025-06-20" */
  date: string;
  /** "14:00" */
  startTime?: string;
  endTime?: string;
  location?: string;
  /** 原始分类（"考试"） */
  category?: string;
  raw: Record<string, unknown>;
}

/** 校内新闻 —— thu-info-lib models/news NewsSlice 对齐 */
export interface NewsItem {
  name: string;
  xxid: string;
  /** 详情页绝对 URL（系统浏览器打开） */
  url?: string;
  date?: string;
  source?: string;
  topped?: boolean;
  /** 栏目 ID（LM_JWGG …） */
  channel?: string;
}

/** 新闻附件（xxDto.fjs_template 单项：wjmc 文件名 + wjid 文件 id，thu-info-lib 同源） */
export interface NewsAttachment {
  /** 文件名（如「附件一：校园秩序及交通管理示意图.jpg」） */
  name: string;
  /** 下载端点绝对 URL（/b/info/wj/download/{wjid}?_csrf=…，即 thu-info-lib FILE_DOWNLOAD_URL 的 info 直连版） */
  url: string;
}

/** 新闻详情（getNewsDetail：NEWS_DETAIL?xxid=…&_csrf=… → object.xxDto） */
export interface NewsDetail {
  title: string;
  /** 正文 HTML（已去 script/style、相对路径补全为 info 绝对地址；交给 RichContent） */
  html: string;
  /** 纯文本摘要（兜底展示） */
  plain: string;
  /** 附件（fjs_template 解析；无附件恒为空数组不报错） */
  attachments: NewsAttachment[];
}

/** 新闻来源（getNewsSourceList：querySubscribeInformationUnitList?lmid= → object.{id,text}） */
export interface NewsSource {
  sourceId: string;
  sourceName: string;
}

/**
 * 首页「倒计时提醒」事项（INFO_DEADLINE：/b/info/gxfw_fg/common/deadline/list →
 * {object:[{djsbt,djskssj,djsjzsj,djsurl}]}，thu-info-lib getCrTimetable 同源）：
 * title=倒计时标题（选课/退课/推研等学期重要节点），begin/end=起止时间
 * （"YYYY-MM-DD HH:mm"），url=事项通知链接；date/raw 保留旧解析兼容。
 */
export interface DeadlineItem {
  title: string;
  begin?: string;
  end?: string;
  url?: string;
  date?: string;
  raw?: Record<string, unknown>;
}

/* ---------------- 宿舍 / 家园网（dorm.ts 移植） ---------------- */

/** 电费余额 —— dorm.ts getEleRemainder（Netweb_Home_electricity_Detail 页内 label） */
export interface EleRemainder {
  /** 剩余电量（度） */
  remainder: number;
  /** 抄表时间（页面原文） */
  updateTime: string;
}

/** 电费缴费记录行 —— dorm.ts getElePayRecord（.myTable 行 6 列，顺序保留） */
export interface ElePayRecord {
  name: string;
  id: string;
  time: string;
  channel: string;
  value: string;
  status: string;
  raw: string[];
}

/* ---------------- 图书馆座位（library.ts 移植） ---------------- */

/** 馆 —— library.ts getLibraryList */
export interface Library {
  id: number;
  zhName: string;
  zhNameTrace: string;
  enName?: string;
  enNameTrace?: string;
  valid: boolean;
}

/** 楼层 —— library.ts getLibraryFloorList（available/total 由各区域求和） */
export interface LibraryFloor {
  id: number;
  zhName: string;
  zhNameTrace: string;
  valid: boolean;
  parentId: number;
  available: number;
  total: number;
}

/** 区域 —— library.ts getLibrarySectionList */
export interface LibrarySection {
  id: number;
  zhName: string;
  zhNameTrace: string;
  valid: boolean;
  total: number;
  available: number;
}

/** 座位可用性 —— spaces_old 每座位 status/status_name 归一化
 *  （实测：1=空闲 → usable；2=已预约 → booked；4=维护 → maintain；其余 unknown） */
export type LibrarySeatAvailability = "usable" | "booked" | "maintain" | "unknown";

/** 座位 —— library.ts getLibrarySeatList（status===1 可预约） */
export interface LibrarySeat {
  id: number;
  zhName: string;
  zhNameTrace: string;
  valid: boolean;
  /** 区域类型（area_type 原文） */
  type?: string;
  /** 插座状态（app.cs 侧附带数据；无则 undefined） */
  status?: string;
  /** 可用性（spaces_old status/status_name 归一化，见 LibrarySeatAvailability） */
  availability?: LibrarySeatAvailability;
  /** 座位原始状态名（空闲/已预约/维护…，spaces_old status_name） */
  statusName?: string;
  /** 有电源插座：座位 type 名含「电源/插座/插头」，或 app.cs 插座表含该座 */
  hasPower?: boolean;
}

/** 座位预约记录 —— library.ts getBookingRecords（user/index/book 表） */
export interface LibBookRecord {
  id: string;
  pos: string;
  time: string;
  status: string;
  /** 可取消记录的取消标识（menuDel('…')） */
  delId?: string;
}

/* ---------------- 研讨间（cab.lib ic-web，library.ts 移植） ---------------- */

/** 房型下的单个房间 —— library.ts getLibraryRoomBookingInfoList（roomInfos 项） */
export interface LibRoom {
  devId: number;
  devName: string;
  /** 最短预约时长（分钟，resvRule.minResvTime 原文 minResvTime） */
  minReserveTime: number;
}

/** 房型（研讨间/研读间大类） —— library.ts getLibraryRoomBookingInfoList */
export interface LibRoomInfo {
  kindId: number;
  kindName: string;
  rooms: LibRoom[];
}

/** 已占用时段 —— library.ts getLibraryRoomBookingResourceList（resvInfo 项） */
export interface LibRoomUsage {
  /** 预约标识（resvId） */
  id: number;
  start: Date;
  end: Date;
  title: string;
  owner: string;
  ownerId: string;
}

/** 可约资源（某房型某日期的一个房间 + 当日开放时间与占用） —— library.ts 同名 */
export interface LibRoomRes {
  devId: number;
  devName: string;
  kindId: number;
  kindName: string;
  labId: number;
  labName: string;
  roomId: number;
  roomName: string;
  /** resvRule.limit */
  limit: number;
  /** 最长预约时长（分钟，resvRule.maxResvTime） */
  maxMinute: number;
  /** 最短预约时长（分钟，resvRule.minResvTime） */
  minMinute: number;
  /** 开始前可取消时限（分钟，resvRule.cancelTime） */
  cancelMinute: number;
  maxUser: number;
  minUser: number;
  /** 开放时段 HH:mm（null = 当日不开放） */
  openStart: string | null;
  openEnd: string | null;
  usage: LibRoomUsage[];
}

/** 成员模糊搜索结果 —— library.ts fuzzySearchLibraryId */
export interface LibFuzzySearchResult {
  /** 账号号（accNo，提交预约 resvMember 用，非学号） */
  id: number;
  label: string;
  department: string;
}

/** 研讨间预约记录 —— library.ts getLibraryRoomBookingRecord */
export interface LibRoomBookRecord {
  uuid: string;
  rsvId: number;
  owner: string;
  ownerId: string;
  /** 预约日期（resvDate 原文） */
  date: string;
  begin: Date;
  end: Date;
  devName: string;
  kindName: string;
  members: Array<{ name: string; userId: string }>;
}

/* ---------------- 财务三件（finance.ts 移植：lib models/home/invoice.ts / bank.ts） ---------------- */

/** 电子发票 —— lib models/home/invoice.ts Invoice 逐字段对齐（getList.do 原始字段） */
export interface Invoice {
  bill_amount: number;
  bmdm: string;
  bus_no: string;
  cust_email: string;
  cust_mob: string;
  cust_name: string;
  cust_tax_no: string;
  cust_ts_cardno: string;
  cust_type: string;
  file_name: string;
  financial_dept_name: string;
  financial_item_name: string;
  inv_amount: number;
  inv_code: string;
  inv_crc: string;
  inv_data_id: number;
  inv_date: string;
  inv_isred: string;
  inv_no: string;
  inv_note: string;
  inv_red_no: string;
  inv_type: string;
  inv_typeStr: string;
  is_allow_reimbursement: string;
  ists: string;
  payment_item_type_name: string;
  red_bus_no: string;
  tax_amount: number;
  uuid: number;
}

/** 发票分页 —— lib getInvoiceList 返回形状（getList.do {data,count}） */
export interface InvoicePage {
  data: Invoice[];
  count: number;
}

/** 银行代发单条 —— lib models/home/bank.ts BankPayment 逐字段对齐 */
export interface BankPayment {
  /** 代发部门 */
  department: string;
  /** 代发项目 */
  project: string;
  /** 代发用途 */
  usage: string;
  /** 代发说明 */
  description: string;
  /** 开户银行 */
  bank: string;
  /** 计税时间 */
  time: string;
  /** 应发金额 */
  total: string;
  /** 扣税金额 */
  deduction: string;
  /** 实发金额 */
  actual: string;
  /** 存折金额 */
  deposit: string;
  /** 现金金额 */
  cash: string;
}

/** 银行代发按月分组 —— lib models/home/bank.ts BankPaymentByMonth */
export interface BankPaymentByMonth {
  /** "2021年12月" */
  month: string;
  payment: BankPayment[];
}

/** 研究生收入 —— lib models/home/bank.ts GraduateIncome 逐字段对齐（pageList row 字段） */
export interface GraduateIncome {
  id: string;
  /** 发放年（ffnf） */
  year: string;
  /** 发放月（ffyf） */
  month: string;
  /** 发放日期（ffrq） */
  date: string;
  /** 发放日期中文（ffrqChs） */
  ym: string;
  /** 项目名（dfytmc） */
  name: string;
  /** 部门（xmssbmmc） */
  department: string;
  /** 应发（yfje） */
  beforeTax: number;
  /** 实发（sfje） */
  afterTax: number;
  /** 扣税（ksje） */
  tax: number;
}

/* ---------------- 教学评估（evaluation.ts 移植：lib models/home/assessment.ts） ---------------- */

/** 表单最小单元 —— lib assessment.ts InputTag（name=字段名，value=分值/文本） */
export interface AssessmentInputTag {
  name: string;
  value: string;
}

/** 单个题项 —— lib assessment.ts InputGroup */
export interface AssessmentInputGroup {
  question: string;
  /** 建议输入（页内唯一带 class 的 input） */
  suggestion: AssessmentInputTag;
  /** 评分输入（ul 直下唯一 input） */
  score: AssessmentInputTag;
  /** 其余隐藏 input（无 class、无 avgfs 属性） */
  others: AssessmentInputTag[];
}

/** 被评人（教师/助教） —— lib assessment.ts Person */
export interface AssessmentPerson {
  name: string;
  inputGroups: AssessmentInputGroup[];
}

/** 评估表单 —— lib assessment.ts Form（overall.suggestion 为整体建议文本，
 *  字段名固定 kcpgjgDtos[0].jtjy；score 为整体评分输入） */
export interface AssessmentForm {
  basics: AssessmentInputTag[];
  overall: { suggestion: string; score: AssessmentInputTag };
  teachers: AssessmentPerson[];
  assistants: AssessmentPerson[];
}

/* ---------------- 教室资源（classroom.ts 移植：lib models/home/classroom.ts） ---------------- */

/** 教学楼 —— lib classroom.ts Classroom */
export interface Classroom {
  /** 教学楼名（链接文本） */
  name: string;
  /** 链接内嵌的当前周次 */
  weekNumber: number;
  /** 查询用名（href classroom= 参数原文，查询时按 GB2312 编码） */
  searchName: string;
}

/** 教室状态 —— lib ClassroomStatus 数值枚举（const 对象保持数值，兼容 node --experimental-strip-types） */
export const ClassroomStatus = {
  TEACHING: 0,
  EXAM: 1,
  BORROWED: 2,
  DISABLED: 3,
  RESERVED_FOR_COMPAT: 4,
  AVAILABLE: 5,
} as const;
export type ClassroomStatus = (typeof ClassroomStatus)[keyof typeof ClassroomStatus];

/** 单间教室一周状态 —— lib classroom.ts ClassroomState（status=42 个状态，周一起） */
export interface ClassroomState {
  name: string;
  status: ClassroomStatus[];
}

/** 教室状态查询结果 —— lib classroom.ts ClassroomStateResult */
export interface ClassroomStateResult {
  validWeekNumbers: number[];
  currentWeekNumber: number;
  /** 周一到周日 7 个日期串（页面 colspan=6 单元格括号内） */
  datesOfCurrentWeek: [string, string, string, string, string, string, string];
  classroomStates: ClassroomState[];
}

/* ---------------- 校历（calendar.ts 移植：lib models/schedule/calendar.ts） ---------------- */

/** 学期 —— lib calendar.ts Semester（firstDay 对齐到教学周周一） */
export interface SchoolSemester {
  /** "YYYY-MM-DD"（教学周第一天=周一） */
  firstDay: string;
  /** 学期号（如 "2024-2025-1"） */
  semesterId: string;
  /** 学期名（如 "2024-2025秋季学期"） */
  semesterName: string;
  /** 教学周数 */
  weekCount: number;
}

/** 校历数据 —— lib calendar.ts CalendarData（改名避开 learn 模块 CalendarData） */
export interface SchoolCalendarData extends SchoolSemester {
  nextSemesterList: SchoolSemester[];
}

/* ---------------- 校园网 thos/usereg（neth.ts 移植：lib models/network/*） ---------------- */

/** 在线设备 —— lib models/network/device.ts Device */
export interface NetworkDevice {
  key: number;
  ip4: string;
  ip6: string;
  loggedAt: string;
  mac: string;
  authPermission: string;
}

/** 流量/余额 —— lib models/network/balance.ts Balance（页面原文，未归一） */
export interface NetworkBalance {
  productName: string;
  usedBytes: string;
  usedSeconds: string;
  accountBalance: string;
  settlementDate: string;
}

/** 上网账号资料 —— lib models/network/account.ts AccountInfo */
export interface NetworkAccountInfo {
  username: string;
  contactEmail: string;
  contactPhone: string;
  contactLandline: string;
  realName: string;
  status: string;
  userGroup: string;
  location: string;
  allowedDevices: number;
}

/* ---------------- 体育场馆预约（sports.ts 移植：lib models/home/sports.ts 逐字段） ---------------- */

/** 单个可预约资源（lib SportsResource 字段一一对应） */
export interface SportsResource {
  /** 场地资源 id */
  resId: string;
  /** 资源 hash（下单 allFieldTime 用） */
  resHash: string;
  /** 关联订单 id；未预约 → undefined */
  bookId?: string;
  /** 时段，如 "5:00-6:00" */
  timeSession: string;
  /** 场地名 */
  fieldName: string;
  overlaySize: number;
  /** 是否可网上预约 */
  canNetBook: boolean;
  /** 费用（元） */
  cost?: number;
  /** 是否被锁（他人预约中） */
  locked?: boolean;
  /** 占用者用户类型；未占用 → undefined */
  userType?: string;
  /** 是否已支付；未占用 → undefined */
  paymentStatus?: boolean;
}

/** 场馆资源页（lib SportsResourcesInfo）：init ≤ 0 = 当前不可约；count=0 时 init 为未支付订单数 */
export interface SportsResourcesInfo {
  /** 最多可约场地数 */
  count: number;
  init: number;
  /** 手机号；未配置 → undefined */
  phone: string | undefined;
  data: SportsResource[];
}

/** 场馆元数据（sportsIdInfoList 项） */
export interface SportsIdInfo {
  name: string;
  gymId: string;
  itemId: string;
}

/** 预约记录（lib SportsReservationRecord 字段一一对应） */
export interface SportsReservationRecord {
  name: string;
  field: string;
  time: string;
  price: string;
  /** 网上支付 / 现场支付 / 已支付 */
  method: string;
  bookTimestamp: number | undefined;
  /** 退订用；不可退 → undefined */
  bookId: string | undefined;
  /** 支付用；仅网上支付记录有 */
  payId: string | undefined;
}
