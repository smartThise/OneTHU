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

/** 新闻详情（getNewsDetail：NEWS_DETAIL?xxid=…&_csrf=… → object.xxDto） */
export interface NewsDetail {
  title: string;
  /** 正文 HTML（已去 script/style、相对路径补全为 info 绝对地址；交给 RichContent） */
  html: string;
  /** 纯文本摘要（兜底展示） */
  plain: string;
  /** 附件文件名列表 */
  files: string[];
}

/** 新闻来源（getNewsSourceList：querySubscribeInformationUnitList?lmid= → object.{id,text}） */
export interface NewsSource {
  sourceId: string;
  sourceName: string;
}

export interface DeadlineItem {
  title: string;
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
