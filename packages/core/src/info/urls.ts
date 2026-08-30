/** 信息门户 / 教务端点（验证自 thu-info-lib，docs/API-NOTES.md §3） */
export const INFO_PREFIX = "https://info.tsinghua.edu.cn";
/** 教务网关只监听 80 端口（webvpn 走 /http/ 段，与 thu-info-lib 一致） */
export const ZHJW_PREFIX = "http://zhjw.cic.tsinghua.edu.cn";

/** 个人信息（HTML） */
export const INFO_USER_DATA = () => `${INFO_PREFIX}/b/info/gxfw_fg/common/grjbxx`;

/** 校历 */
export const INFO_CALENDAR = () => `${INFO_PREFIX}/b/info/gxfw_fg/common/xl`;

/** 倒计时/重要日期 */
export const INFO_DEADLINE = () => `${INFO_PREFIX}/b/info/gxfw_fg/common/deadline/list`;

/** 校内新闻（JSON 分页） */
export const INFO_NEWS_LIST = (type = "xs", source = "") =>
  `${INFO_PREFIX}/b/info/xxfb_fg/xnzx/template/more?oType=${type}&lydw=${source}`;

/** wengine 取 info 域 XSRF-TOKEN cookie（webvpn 原生端点，勿包装） */
export const GET_COOKIE_URL = () =>
  "https://webvpn.tsinghua.edu.cn/wengine-vpn/cookie?method=get&host=info.tsinghua.edu.cn&scheme=https&path=/f/info/gxfw_fg/common/index";

/** info 门户 yyfw 漫游（thu-info-lib 同款；payload=教务课表 287C0C6D…） */
export const ROAMING_URL = () =>
  `${INFO_PREFIX}/b/yyfw/vyyfwxx/info/portal_fg/common/onlineAppRedirect`;

export const JXRL_ROAM_ID = "287C0C6D90ABB364CD5FDF1495199962";
/** 个人信息/邮箱业务漫游 id（demo basics.getUserInfo 同款 payload） */
export const YYFW_USERINFO_ROAM_ID = "F315577F5BF20E1B1668EDD594B2C04F";
/** 本科成绩查询业务漫游 id（demo basics.getReport 同款 payload） */
export const BKS_REPORT_ROAM_ID = "B7EF0ADF9406335AD7905B30CD7B49B1";

/** 新闻详情 JSON（thu-info-lib NEWS_DETAIL_URL 的 info 直连版） */
export const NEWS_DETAIL = () => `${INFO_PREFIX}/b/info/xxfb_fg/xnzx/template/detail`;

/** 新闻服务端搜索（thu-info-lib SEARCH_NEWS_LIST_URL 的 info 直连版；
 *  POST 表单 esParamClass=<ES 参数 JSON>，_csrf 走 query，响应 object.resultsList） */
export const NEWS_SEARCH = () =>
  `${INFO_PREFIX}/b/xnzx/search/info/xxfb_fg/teacher/getMobilePageList`;

/** 新闻来源（发布单位）列表（thu-info-lib NEWS_SOURCE_LIST_URL 直连版；
 *  GET ?lmid=&_csrf= → object.{id,text}[]，供订阅管理勾选） */
export const NEWS_SOURCE_LIST = () =>
  `${INFO_PREFIX}/b/info/gxfw_fg/common/querySubscribeInformationUnitList`;

/** 课表 JSONP（本科；先 JXRL_ROAM_BKS） */
export const ZHJW_SCHEDULE_JSONP = (startDate: string, endDate: string) =>
  `${ZHJW_PREFIX}/jxmh_out.do?m=bks_jxrl_all&p_start_date=${startDate}&p_end_date=${endDate}&jsoncallback=m`;

/** 成绩报表（HTML 表格，本科，中文成绩；flag=di1 与 thu-info-lib getReport 一致） */
export const ZHJW_REPORT = (flag = 1) => `${ZHJW_PREFIX}/cj.cjCjbAll.do?m=bks_cjdcx&cjdlx=zw&flag=di${flag}`;

/** 必修/限选成绩（thu-info-lib BKS_REPORT_BXR_URL，用于成绩筛选） */
export const ZHJW_REPORT_BXR = () => `${ZHJW_PREFIX}/cj.cjCjbAll.do?m=bks_yxkccj`;

/** 二级课表查询页 */
export const ZHJW_SECONDARY = () => `${ZHJW_PREFIX}/portal3rd.do?m=bks_ejkbSearch`;

/* ------------------------------------------------------------------ */
/* 校园卡（card.tsinghua.edu.cn —— URL 逐条移植自 thu-info-lib card.ts；
 * POST JSON，响应可能是 AES-128-ECB 加密（密钥 = data 前 16 字符）。 */
/* ------------------------------------------------------------------ */

/** 校园卡站点首页（会话引导用） */
export const CARD_HOME = () => "https://card.tsinghua.edu.cn/";

/** 由会话取当前登录用户（card.ts CARD_USER_BY_TOKEN_URL） */
export const CARD_USER_BY_TOKEN = () => "https://card.tsinghua.edu.cn/login/getUserInfoFromToken";

/** 持卡人信息（含余额；card.ts CARD_INFO_BY_USER_URL） */
export const CARD_INFO_BY_USER = () => "https://card.tsinghua.edu.cn/business/getCardUserinfo";

/** 消费/流水记录（card.ts CARD_TRANSACTION_URL） */
export const CARD_TRANSACTIONS = () => "https://card.tsinghua.edu.cn/business/querySelfTradeList";

/* ------------------------------------------------------------------ */
/* 宿舍 / 家园网（thu-info-lib dorm.ts。lib 内为 webvpn 硬编码 hex —— 解码回
 * 真实域（AES key/iv=wrdvpnisthebest! 实证）后由 HttpClient 动态包装，端点与
 * 参数与 lib 逐条一致。） */
/* ------------------------------------------------------------------ */

/** 家园网 CAS 服务表单（dorm.ts roam policy "id" payload 0a993de7…/1）：
 *  已认证 id 会话 GET 该表单 → 302 发票 → 兑付后建立家园网会话。 */
export const DORM_CAS_FORM = () =>
  "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/0a993de7e533cd43a594459abdcab27d/1";

/** 家园网 Netweb 只监听 80 端口（lib 包装段为 /http/，同 zhjw 约定） */
export const MYHOME_PREFIX = "http://myhome.tsinghua.edu.cn";

/** 电费余额（dorm.ts ELE_REMAINDER_URL；未登录时页面含 net_Default_LoginCtrl1_txtUserName） */
export const ELE_REMAINDER = () => `${MYHOME_PREFIX}/Netweb_List/Netweb_Home_electricity_Detail.aspx`;

/** 电费缴费记录（dorm.ts ELE_PAY_RECORD_URL；.myTable 表，首末行为表头/合计） */
export const ELE_PAY_RECORD = () => `${MYHOME_PREFIX}/Netweb_List/netweb_ele_pay_record.aspx`;

/* ------------------------------------------------------------------ */
/* 图书馆座位（seat.lib.tsinghua.edu.cn —— thu-info-lib library.ts；
 * yyfw 漫游 id ef84f6d6…，api.php 系列接口统一返回 {data:{list}}。） */
/* ------------------------------------------------------------------ */

/** 座位系统 id CAS 服务表单 hash（library.ts roam("id") payload；
 *  注意这是 CAS 表单 hash 而非 yyfw 业务 id，不能用于 ROAMING_URL 漫游） */
export const LIBRARY_ROAM_ID = "ef84f6d6784f6b834e5214f432d6173f";

/** 座位系统 id CAS service 表单（library.ts getAccessToken roam("id") payload
 *  "ef84f6d6…/0?/api/id_tsinghua_callback"；已认证 id 会话 GET → 302 发票 → 兑付建立 seat.lib 会话） */
export const LIBRARY_CAS_FORM = () =>
  "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/ef84f6d6784f6b834e5214f432d6173f/0?/api/id_tsinghua_callback";

export const LIBRARY_PREFIX = "https://seat.lib.tsinghua.edu.cn";

/** 座位系统首页（access_token 内嵌于此页；library.ts LIBRARY_HOME_URL） */
export const LIBRARY_HOME = () => `${LIBRARY_PREFIX}/home/web/f_second`;

/** 馆列表（library.ts LIBRARY_LIST_URL） */
export const LIBRARY_LIST = () => `${LIBRARY_PREFIX}/api.php/areas/1/tree/1`;

/** 馆/楼层区域（library.ts LIBRARY_AREAS_URL + id [+ /date/YYYY-MM-DD]） */
export const LIBRARY_AREAS = (id: number | string, date?: string) =>
  `${LIBRARY_PREFIX}/api.php/areas/${id}${date ? `/date/${date}` : ""}`;

/** 区域开放时段（library.ts LIBRARY_DAYS_URL + id） */
export const LIBRARY_DAYS = (id: number | string) => `${LIBRARY_PREFIX}/api.php/areadays/${id}`;

/** 座位列表（library.ts LIBRARY_SEATS_URL；query: area/segment/day/startTime/endTime） */
export const LIBRARY_SEATS = () => `${LIBRARY_PREFIX}/api.php/spaces_old`;

/** 预约座位（library.ts LIBRARY_BOOK_URL_PREFIX + seatId + /book；form POST） */
export const LIBRARY_BOOK_SEAT = (seatId: number | string) =>
  `${LIBRARY_PREFIX}/api.php/spaces/${seatId}/book`;

/** 我的预约记录页（library.ts LIBRARY_BOOK_RECORD_URL；HTML 表） */
export const LIBRARY_BOOK_RECORD = () => `${LIBRARY_PREFIX}/user/index/book`;

/** 取消预约（library.ts CANCEL_BOOKING_URL + id；form POST _method=delete） */
export const LIBRARY_CANCEL_BOOKING = () => `${LIBRARY_PREFIX}/api.php/profile/books/`;

/** 座位插座状态（library.ts APP_SOCKET_STATUS_URL；清华 app 后端，失败可容忍） */
export const APP_SOCKET_STATUS = () => "https://app.cs.tsinghua.edu.cn/api/socket";

/** 座位分布图（libraryMap.tsx / librarySeat.tsx 的 LIBRARY_IMAGE_BASE 拼法：
 *  `${base}${areaId}/floor.jpg` = 楼层平面图，`${base}${areaId}/seat-free.jpg` =
 *  区域空闲座位图；base 即 seat.lib /Public/home/images/web/area/。图片无独立
 *  接口，须带 webvpn 会话经 fetch_binary 抓字节转 dataURL 内联。） */
export const LIBRARY_AREA_IMAGE = (areaId: number | string, kind: "floor" | "seat-free") =>
  `${LIBRARY_PREFIX}/Public/home/images/web/area/${areaId}/${kind}.jpg`;

/* ------------------------------------------------------------------ */
/* 研讨间预约（cab.lib.tsinghua.edu.cn ic-web —— thu-info-lib library.ts
 * cabLogin / getLibraryRoomBooking* / bookLibraryRoom 逐条移植。lib 内为
 * webvpn 硬编码 hex 根 + ic-web 路径，此处存真实域 URL，由 HttpClient 动态
 * 包装（分流规则：cab.lib 非公网 host，恒走 WebVPN）。 */
/* ------------------------------------------------------------------ */

export const LIBROOM_PREFIX = "https://cab.lib.tsinghua.edu.cn";

/** SSO 入口地址查询（library.ts LIBRARY_ROOM_BOOKING_QUERY_AUTH_ADDRESS_URL）：
 *  返回 {code:0,data:"https://cab.lib.tsinghua.edu.cn/…"}，data 即 cab SSO 地址
 *  （跟随其重定向链落到 id CAS 登录表单，payload 取 /login/form/ 后缀）。 */
export const LIBROOM_AUTH_ADDRESS = () =>
  `${LIBROOM_PREFIX}/ic-web/auth/address?finalAddress=https:%2F%2Fcab.lib.tsinghua.edu.cn&errPageUrl=https:%2F%2Fcab.lib.tsinghua.edu.cn%2F%23%2Ferror&manager=false&consoleType=16`;

/** 当前登录用户（library.ts LIBRARY_ROOM_BOOKING_USER_INFO_URL；校验 pid + 取 accNo） */
export const LIBROOM_USER_INFO = () => `${LIBROOM_PREFIX}/ic-web/auth/userInfo`;

/** 房型/房间列表（library.ts LIBRARY_ROOM_BOOKING_ROOM_INFO_URL） */
export const LIBROOM_ROOM_INFO = () => `${LIBROOM_PREFIX}/ic-web/roomDevice/roomInfos`;

/** 可约资源（library.ts LIBRARY_ROOM_BOOKING_RESOURCE_LIST_URL；追加
 *  &resvDates=yyyyMMdd&kindIds=<kindId>，sysKind=1 固定） */
export const LIBROOM_RESOURCE_LIST = () => `${LIBROOM_PREFIX}/ic-web/reserve?sysKind=1`;

/** 成员模糊搜索（library.ts LIBRARY_FUZZY_SEARCH_ID_URL；key= 关键字） */
export const LIBROOM_FUZZY_SEARCH = () =>
  `${LIBROOM_PREFIX}/ic-web/account/getMembers?page=1&pageNum=10&key=`;

/** 提交预约（library.ts LIBRARY_ROOM_BOOKING_ACTION_URL；POST JSON） */
export const LIBROOM_ACTION = () => `${LIBROOM_PREFIX}/ic-web/reserve`;

/** 我的预约（library.ts LIBRARY_ROOM_BOOKING_RECORD_URL；追加
 *  &beginDate=YYYY-MM-DD&endDate=YYYY-MM-DD） */
export const LIBROOM_RECORD = () =>
  `${LIBROOM_PREFIX}/ic-web/reserve/resvInfo?needStatus=8454&orderKey=gmt_create&orderModel=desc`;

/** 取消预约（library.ts LIBRARY_CANCEL_BOOKING_URL；POST JSON {uuid}） */
export const LIBROOM_CANCEL = () => `${LIBROOM_PREFIX}/ic-web/reserve/delete`;

/** 首次预约前须绑定邮箱（library.ts LIBRARY_ROOM_UPDATE_EMAIL_URL；POST JSON {email}） */
export const LIBROOM_UPDATE_EMAIL = () => `${LIBROOM_PREFIX}/ic-web/account/update`;
