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

/** 服务端订阅条件列表（thu-info-lib NEWS_SUBSCRIPTION_LIST_URL 直连版；
 *  GET ?_csrf= → object.{id,fbdwmcList,lmmcList,pxz,titile,bt}[]，
 *  fbdwmcList[0] 即发布单位名，id 即按订阅取新闻的 dyid） */
export const NEWS_SUBSCRIPTION_LIST = () =>
  `${INFO_PREFIX}/b/info/gxfw_fg/common/querySubscribeConditionNameList/XXFB`;

/** 新建服务端订阅条件（thu-info-lib NEWS_ADD_SUBSCRIPTION_URL 直连版；
 *  POST 表单 dygz=<JSON {lmid?,fbdwnm?,bt}>&mkid=XXFB&_csrf= → {result:"success"}，
 *  fbdwnm 传发布单位 id（querySubscribeInformationUnitList 的 id）） */
export const NEWS_ADD_SUBSCRIPTION = () =>
  `${INFO_PREFIX}/b/info/gxfw_fg/common/addSubscribeCondition`;

/** 按订阅条件取新闻（thu-info-lib NEWS_LIST_BY_SUBSCRIPTION_URL 直连版；
 *  POST 表单 currentPage&dyid&_csrf= → object.resultList，字段与新闻列表接口一致） */
export const NEWS_LIST_BY_SUBSCRIPTION = () =>
  `${INFO_PREFIX}/b/info/gxfw_fg/common/querySubscribeInfomationPageList`;

/** 删除服务端订阅条件（thu-info-lib NEWS_REMOVE_SUBSCRIPTION_URL_FORMAT 直连版；
 *  GET …/{id}/XXFB?_csrf= → {result:"success"}） */
export const NEWS_REMOVE_SUBSCRIPTION = (id: string) =>
  `${INFO_PREFIX}/b/info/gxfw_fg/common/deleteSubscribeCondition/${id}/XXFB`;

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

/* ------------------------------------------------------------------ */
/* 财务三件 / 体测 / 教学评估 / 教室资源 / 校历 / 宿舍卫生 / 校园网 ——
 * thu-info-lib basics.ts / network.ts / dorm.ts(getDormScore) / schedule.ts(getCalendar)
 * 逐条移植。lib 内为 webvpn 硬编码 hex（core.ts HOST_MAP，AES key=wrdvpnisthebest!
 * 已逐一解码核实真实域），此处存真实域 URL，由 HttpClient 按分流规则动态包装：
 * 校内非公网域名（jxgl.cic/zhjw.cic/dzpj/yhdf/zzjl.graduate/m.myhome/usereg）恒走
 * WebVPN；app.cs.tsinghua.edu.cn 为公网站点（lib 亦直连），调用方须 direct:true。 */
/* ------------------------------------------------------------------ */

/** 教学评估（jxgl.cic —— lib ASSESSMENT_*；yyfw 业务漫游 id 0D8B99BA…） */
export const JXGL_PREFIX = "http://jxgl.cic.tsinghua.edu.cn";
export const ASSESSMENT_ROAM_ID = "0D8B99BA23FD2BA22428D9C8AA0AB508";
/** 评估课程列表（lib ASSESSMENT_LIST_URL；HTML 表） */
export const ASSESSMENT_LIST = () => `${JXGL_PREFIX}/jxpg/f/jxpg/wj/xs/pgkcList`;
/** 评估表单提交（lib ASSESSMENT_SUBMIT_URL；POST 表单，响应 {result,msg}） */
export const ASSESSMENT_SUBMIT = () => `${JXGL_PREFIX}/jxpg/b/jxpg/pgjg/xs/zancunjs`;

/** 体测成绩（zhjw —— lib PHYSICAL_EXAM_URL；yyfw 业务漫游 id 8BF4F9A7…；JSON） */
export const PHYSICAL_EXAM_ROAM_ID = "8BF4F9A706589060488B6B6179E462E5";
export const PHYSICAL_EXAM = () => `${ZHJW_PREFIX}/tyjx.tyjx_tc_xscjb.do?m=jsonCj`;

/** 教室资源（zhjw —— lib CLASSROOM_*；yyfw 业务漫游 id 40470BB4…；HTML） */
export const CLASSROOM_ROAM_ID = "40470BB47E0849E9EF717983490BC964";
/** 教学楼列表页（lib CLASSROOM_LIST_URL；链接 href 内嵌 classroom=…&weeknumber=…） */
export const CLASSROOM_LIST = () =>
  `${ZHJW_PREFIX}/portal3rd.do?url=/portal3rd.do&m=jasJy_Xs_Js_index`;
/** 教室占用状态（lib CLASSROOM_STATE_PREFIX/MIDDLE；classroom 参数由调用方做
 *  GB2312 百分号编码，见 classroom.ts arbitraryEncodeGb2312） */
export const CLASSROOM_STATE = (encodedBuilding: string, week: number) =>
  `${ZHJW_PREFIX}/pk.classroomctrl.do?m=qyClassroomState&classroom=${encodedBuilding}&weeknumber=${week}`;

/** 电子发票（dzpj —— lib INVOICE_*；yyfw 业务漫游 id 625B81A7…。
 *  lib roam("default") 对 dzpj 特判：漫游页内 ("ticket").value = '…' 取票后
 *  POST /roam/roamAuth.do {ticket} 兑付建立 dzpj 会话，再访问业务端点。） */
export const INVOICE_ROAM_ID = "625B81A7A9D148B01DA59185CC4074E1";
export const INVOICE_PREFIX = "https://dzpj.tsinghua.edu.cn";
/** 发票列表（lib INVOICE_LIST_URL；POST 表单 page/limit/columnName/sort → {data,count}） */
export const INVOICE_LIST = () => `${INVOICE_PREFIX}/invoiceSys/getList.do`;
/** 发票 PDF（lib INVOICE_CONTENT_URL；响应 PDF 字节 → base64） */
export const INVOICE_CONTENT = (uuid: string | number) =>
  `${INVOICE_PREFIX}/invoice/showInvPdf.do?uuid=${uuid}`;
/** 电子票据会话兑付（lib INVOICE_LOGIN_URL；POST 表单 {ticket}） */
export const INVOICE_LOGIN = () => `${INVOICE_PREFIX}/roam/roamAuth.do`;

/** 银行代发（yhdf —— lib BANK_PAYMENT_SEARCH_URL / FOUNDATION_BANK_PAYMENT_SEARCH_URL。
 *  普通代发与基金会（经建会）是两个 yyfw 业务 id；查询页 option 提供年份多选，
 *  POST year=…&year=… 检索，响应 HTML 按月分块解析。） */
export const BANK_ROAM_ID = "2A5182CB3F36E80395FC2091001BDEA6";
export const BANK_FOUNDATION_ROAM_ID = "C1ADD6B60D050B64E0C7B8F195CE89EC";
export const YHDF_PREFIX = "http://yhdf.tsinghua.edu.cn";
export const BANK_PAYMENT_SEARCH = () => `${YHDF_PREFIX}/yhdfcx/search.do`;
export const FOUNDATION_BANK_PAYMENT_SEARCH = () => `${YHDF_PREFIX}/yhdfcx_jjh/search.do`;

/** 研究生收入（zzjl.graduate —— lib GRADUATE_INCOME_URL；yyfw 业务漫游 id C0AE458C…；
 *  POST 表单 ffkssj/ffjssj/nd/rows/page/sidx/sord → {object:{rows}}） */
export const GRADUATE_INCOME_ROAM_ID = "C0AE458CEACD0912982A09DDF0C136DA";
export const GRADUATE_INCOME = () =>
  "http://zzjl.graduate.tsinghua.edu.cn/b/yjsjzxt/v_yjszzjl_yjscwdfmx_cx/pageList";

/** 校历（数据版 learn + 图片版 app.cs —— lib getCalendar / getSchoolCalendarYear /
 *  getCalendarImageUrl。learn 走 yyfw 业务漫游 3E401364…（HttpClient 对 learn 域恒直连）。 */
export const LEARN_CALENDAR_ROAM_ID = "3E401364BDD7AEA7EBF1EDE3F15ED4B7";
/** 网络学堂首页（lib LEARN_HOME_URL；页内 _csrf 供学期接口） */
export const LEARN_HOME = () => "https://learn.tsinghua.edu.cn/f/wlxt/index/course/student/index";
/** 当前及下学期列表（lib SEMESTER_LIST_URL；GET ?_csrf= → {message,result,resultList}） */
export const SEMESTER_LIST = () =>
  "https://learn.tsinghua.edu.cn/b/kc/zhjw_v_code_xnxq/getCurrentAndNextSemester?_csrf=";
/** 最新校历年（lib CALENDAR_YEAR_URL；app.cs 公网直连 → {year}） */
export const SCHOOL_CALENDAR_YEAR = () => "https://app.cs.tsinghua.edu.cn/Api/SchoolCalendarYear";
/** 校历图片（lib CALENDAR_IMAGE_URL 拼法：/xiaoli/{lang}/{year}-{1|2}.jpg，公网直连） */
export const CALENDAR_IMAGE = (lang: "zh" | "en", year: number, term: 1 | 2) =>
  `https://app.cs.tsinghua.edu.cn/xiaoli/${lang}/${year}-${term}.jpg`;

/** 宿舍卫生成绩（m.myhome 微信端 —— lib dorm.ts getDormScore。
 *  roam("id", 0a993de7…/0)：与电费的 /1 同 hash 不同兑付路径，兑付目标为 m.myhome。 */
export const HYGIENE_CAS_FORM = () =>
  "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/0a993de7e533cd43a594459abdcab27d/0";
/** 卫生检查折线图页（lib DORM_SCORE_URL；页内 #weixin_health_linechartCtrl1_Chart1
 *  的 src 即图表图片（webvpn 相对路径），抓字节转 base64） */
export const HYGIENE_SCORE = () =>
  "https://m.myhome.tsinghua.edu.cn/weixin/weixin_health_linechart.aspx?id=0";

/* ------------------------------------------------------------------ */
/* 校园网 thos/usereg（lib network.ts 逐条移植。上游服务已瘫痪：照抄移植，
 * 解析失败由 client 层统一抛 ServiceUnavailableError。 */
/* ------------------------------------------------------------------ */

export const NETH_PREFIX = "https://usereg.tsinghua.edu.cn";

/** 验证码（lib NETWORK_VERIFICATION_CODE_URL；先 GET ?refresh=1 再取 ?_=ts） */
export const NETH_CAPTCHA = () => `${NETH_PREFIX}/site/captcha`;
export const NETH_ONLINE_NUM = () => `${NETH_PREFIX}/user/online-num`;
export const NETH_CHGPWD = () => `${NETH_PREFIX}/user/change-password`;
/** 登录页（lib NETWORK_LOGIN_URL；含 loginform-verifycode = 需验证码登录） */
export const NETH_LOGIN = () => `${NETH_PREFIX}/login`;
/** 账密校验（lib NETWORK_VALIDATE_USER_URL；需 X-CSRF-Token + X-Requested-With 头） */
export const NETH_VALIDATE_USER = () => `${NETH_PREFIX}/site/validate-user`;
/** 上网主页（lib NETWORK_HOME_URL；#w1-container 在线设备 / #w3-container 余额） */
export const NETH_HOME = () => `${NETH_PREFIX}/home`;
/** 下线设备（lib NETWORK_HOME_DELETE_URL；POST 表单 _csrf-8800） */
export const NETH_HOME_DELETE = (id: number | string, mac: string) =>
  `${NETH_PREFIX}/home/delete?id=${id}&user_mac=${mac}`;
/** 导入/认证设备（lib NETWORK_IMPORT_DEVICE_URL；POST CertificationForm[ip] 等） */
export const NETH_IMPORT_DEVICE = () => `${NETH_PREFIX}/certification`;
/** 账号资料（lib NETWORK_USER_INFO_URL；#w0 表 td 索引映射） */
export const NETH_USER_INFO = () => `${NETH_PREFIX}/users`;
/** 可认证设备数（lib NETWORK_ALLOWED_DEVICES_URL；.glyphicon-exclamation-sign 文案） */
export const NETH_ALLOWED_DEVICES = () => `${NETH_PREFIX}/user/online-num`;

/* ---------------- 体育场馆预约（lib constants/strings.ts SPORTS_* 逐字照抄。
 *  URL 已是 webvpn 包装形态：/http/ 段 = 体育部 gymbook 服务器（lib HOST_MAP["50"]，
 *  原 IP:50 直连的包装版）；zjjs 支付两段 = 财务 fa-online（HOST_MAP["fa-online"]）。
 *  HttpClient 原样请求，勿再包装。漫游 yyfw id = SPORTS_ROAM_ID（lib
 *  roamingWrapperWithMocks("default", 5539ECF8…)） ---------------- */
export const SPORTS_ROAM_ID = "5539ECF8CD815C7D3F5A8EE0A2D72441";
/** 限额页（var limitBookCount / limitBookInit） */
export const SPORTS_BASE_URL = () =>
  "https://webvpn.tsinghua.edu.cn/http/77726476706e69737468656265737421a5a70f8834396657761d88e29d51367b6a00/gymbook/gymBookAction.do?ms=viewGymBook&viewType=m";
/** 资源页（resourceArray.push / addCost / markResStatus / markStatusColor） */
export const SPORTS_DETAIL_URL = () =>
  "https://webvpn.tsinghua.edu.cn/http/77726476706e69737468656265737421a5a70f8834396657761d88e29d51367b6a00/gymsite/cacheAction.do?ms=viewBook&userType=1";
/** 未支付订单（tbody tr 逐行） */
export const SPORTS_UNPAID_URL = () =>
  "https://webvpn.tsinghua.edu.cn/http/77726476706e69737468656265737421a5a70f8834396657761d88e29d51367b6a00/pay/payAction.do?ms=getOrdersForNopay";
/** 已支付订单（tr[style='display:none'] 嵌套表） */
export const SPORTS_PAID_URL = () =>
  "https://webvpn.tsinghua.edu.cn/http/77726476706e69737468656265737421a5a70f8834396657761d88e29d51367b6a00/pay/payAction.do?ms=getOrdersForUnpay";
/** 退订（POST bookId） */
export const SPORTS_UNSUBSCRIBE_URL = () =>
  "https://webvpn.tsinghua.edu.cn/http/77726476706e69737468656265737421a5a70f8834396657761d88e29d51367b6a00/gymbook/gymBookAction.do?ms=unsubscribe";
/** 手机号查询（明文 "do_not" = 未配置） */
export const SPORTS_QUERY_PHONE_URL = () =>
  "https://webvpn.tsinghua.edu.cn/http/77726476706e69737468656265737421a5a70f8834396657761d88e29d51367b6a00/gymbook/gymBookAction.do?ms=hadContactOrNot";
/** 手机号更新（URL 拼接 cell_phone=&gzzh=学号） */
export const SPORTS_UPDATE_PHONE_URL = () =>
  "https://webvpn.tsinghua.edu.cn/http/77726476706e69737468656265737421a5a70f8834396657761d88e29d51367b6a00/gymbook/gymBookAction.do?ms=doUpdateContactInformation&cell_phone=";
/** 预约验证码（Kaptcha.jpg；core 拉图转 data URL，勿裸 URL） */
export const SPORTS_CAPTCHA_BASE_URL = () =>
  "https://webvpn.tsinghua.edu.cn/http/77726476706e69737468656265737421a5a70f8834396657761d88e29d51367b6a00/Kaptcha.jpg";
/** 下单（POST 表单 → JSON {msg}；注意路径双段 gymbook/gymbook） */
export const SPORTS_MAKE_ORDER_URL = () =>
  "https://webvpn.tsinghua.edu.cn/http/77726476706e69737468656265737421a5a70f8834396657761d88e29d51367b6a00/gymbook/gymbook/gymBookAction.do?vpn-12-o1-50.tsinghua.edu.cn=&ms=saveGymBook";
/** 立即支付表单（GBK 响应，桌面传输层已转 UTF-8） */
export const SPORTS_MAKE_PAYMENT_URL = () =>
  "https://webvpn.tsinghua.edu.cn/http/77726476706e69737468656265737421a5a70f8834396657761d88e29d51367b6a00/pay/payAction.do?ms=newPay";
/** 稍后支付表单（paySportsReservation 用） */
export const SPORTS_MAKE_PAYMENT_LATER_URL = () =>
  "https://webvpn.tsinghua.edu.cn/http/77726476706e69737468656265737421a5a70f8834396657761d88e29d51367b6a00/pay/payAction.do?ms=newPayForLater";
/** 支付校验（POST id/token → JSON {code,message}） */
export const SPORTS_PAYMENT_CHECK_URL = () =>
  "https://webvpn.tsinghua.edu.cn/http/77726476706e69737468656265737421f6f60c93293c615e7b469dbf915b243daf0f96e17deaf447b4/zjjsfw/zjjs/check.do";
/** 支付动作（#payForm + channelId=0101 → 含 biz_content 表单页） */
export const SPORTS_PAYMENT_ACTION_URL = () =>
  "https://webvpn.tsinghua.edu.cn/http/77726476706e69737468656265737421f6f60c93293c615e7b469dbf915b243daf0f96e17deaf447b4/zjjsfw/zjjs/webPay.do";
