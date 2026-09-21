/**
 * OneTHU 插件系统类型（v1）
 *
 * 插件 = 一个 ES 模块文本（.js），导出 `manifest`（清单）与 `default`（activate 函数）。
 * 安装后由 loader 以 blob URL 动态 import，在应用同域执行（插件是受信代码——
 * 权限门禁只约束 OnethuApi 的可见面，不是代码沙箱）。
 *
 * 设计约束（用户定案）：插件可安装/可删除，但不得改变应用架构；
 * 一切操作走公共原子接口（onethu.*），不触碰内部状态与 DOM 结构。
 */

/** 权限标识（manifest.permissions 声明，安装时用户逐项确认） */
export type PluginPermission =
  | "user:read" // 基本信息 + 会话状态
  | "info:read" // 成绩/考试/新闻/校历/空教室/缴费等只读查询
  | "card:read" // 校园卡余额与流水（只读）
  | "dorm:read" // 宿舍电费/卫生分（只读）
  | "library:read" // 图书馆楼层/区域/座位/记录查询 + 研讨间查询
  | "library:book" // 图书馆座位预约/取消 + 研讨间预约/取消（写操作）
  | "network:read" // 校园网账户/设备/余额（只读）
  | "learn:read" // 网络学堂课程/作业/通知/文件/讨论区（只读）
  | "learn:write" // 网络学堂讨论区发帖/回帖（写操作，需确认）
  | "venue:read" // 体育场馆场景/场地/我的预约（只读）
  | "venue:book" // 体育场馆预约/取消（写操作）
  | "xk:read" // 选课目录/已选/志愿/社区评价（只读）
  | "kongjian:book" // 宿舍公共空间预约/取消（写操作）
  | "cal:read" // 日程（云同步日历+本地日程）只读查询
  | "cal:write" // 日程新建/编辑/删除（云或本地）
  | "mail:read" // 清华邮箱收件/读信/搜索（复用云同步授权码）
  | "mail:write" // 清华邮箱发信（写操作，需确认）
  | "cloud:read" // 清华云盘资料库/目录/搜索/下载（Seafile）
  | "cloud:write" // 清华云盘上传/分享（写操作，需确认）
  | "nav" // 应用内页面跳转
  | "ui" // toast 提示
  | "storage" // 插件私有键值存储
  | "net:external" // 外部网络请求（大模型 API 等）
  | "tsinghua:sdk" // 以用户登录态访问任意清华校内服务（自定义服务接入 SDK；安装时重点确认）
  | "clipboard:read" // 读取系统剪贴板（敏感：可读密码管理器复制的口令）
  | "plugins:call" // 列出并执行其他已启用插件的命令（联动插件；OH 对话工具化需要）
  | "css" // 注入全局样式（影响整个应用外观，包括宿主界面；安装时重点确认）
  | "llm" // 经内置 Harness 的 LLM 对话（清华 MadModel 免费档 / 自费 API，自动调度）
  | "theme" // 主题查询与应用、昼夜跟随调度（可改变全局外观）
  | "exthw:read" // 外部作业源（雨课堂/TUOJ 系/Tyche/DSA OJ）状态与作业快照
  | "exthw:refresh" // 触发外部作业源刷新（网络请求）
  | "webview" // 应用内 WebView 模态（Android 桌面模式浏览；桌面自动降级系统浏览器）
  | "widget" // 声明 Android 桌面小组件（只声明显示什么，渲染由宿主与原生完成）
  | "notify"; // 发送系统通知（三端；内容与时刻由插件自定）

export const PLUGIN_PERMISSIONS: ReadonlyArray<{ id: PluginPermission; label: string; desc: string }> = [
  { id: "user:read", label: "读取基本信息", desc: "姓名/学号/院系与登录会话状态" },
  { id: "info:read", label: "读取信息门户", desc: "成绩、考试、新闻、校历、空教室、缴费记录等只读查询" },
  { id: "learn:read", label: "读取网络学堂", desc: "课程/作业/通知/文件/讨论区只读查询" },
  { id: "learn:write", label: "网络学堂发帖", desc: "讨论区发帖/回帖（写操作，需确认）" },
  { id: "venue:read", label: "读取体育场馆", desc: "场馆场景/可约场地/我的预约只读查询" },
  { id: "venue:book", label: "预约与取消场馆", desc: "体育场馆预约与取消（写操作，需确认）" },
  { id: "xk:read", label: "读取选课数据", desc: "选课目录/已选/志愿/社区评价只读查询" },
  { id: "kongjian:book", label: "预约公共空间", desc: "宿舍公共空间预约与取消（写操作，需确认）" },
  { id: "cal:read", label: "读取日程", desc: "云同步日历与本地日程的只读查询" },
  { id: "cal:write", label: "管理日程", desc: "新建/编辑/删除日程（云或本地，写操作）" },
  { id: "mail:read", label: "读取邮箱", desc: "清华邮箱收件箱/已发送查询、读信与全箱搜索" },
  { id: "mail:write", label: "发邮件", desc: "从清华邮箱发信（写操作，需确认）" },
  { id: "cloud:read", label: "读取云盘", desc: "清华云盘资料库、目录浏览、库内搜索与下载" },
  { id: "cloud:write", label: "上传/分享云盘", desc: "上传文件到云盘、生成分享链接（写操作，需确认）" },
  { id: "card:read", label: "读取校园卡", desc: "余额与消费流水（只读，不含充值）" },
  { id: "dorm:read", label: "读取宿舍信息", desc: "电费余额/缴费记录/卫生分（只读）" },
  { id: "library:read", label: "查询图书馆", desc: "楼层/区域/座位分布/预约记录 + 研讨间资源查询" },
  { id: "library:book", label: "预约图书馆", desc: "座位与研讨间的预约/取消（写操作）" },
  { id: "network:read", label: "读取校园网账户", desc: "余额/在线设备/账号信息（只读）" },
  { id: "nav", label: "应用内跳转", desc: "跳转到应用的任意页面与子栏" },
  { id: "ui", label: "显示提示", desc: "弹出 toast 消息" },
  { id: "storage", label: "本地存储", desc: "插件私有键值存储（卸载即清除）" },
  { id: "net:external", label: "外部网络请求", desc: "直接请求任意外部 HTTP(S) 接口（大模型 API 等）" },
  { id: "widget", label: "桌面小组件", desc: "向 Android 桌面小组件声明要显示的内容（渲染与取值由宿主完成，插件不写原生代码）" },
  { id: "notify", label: "发送系统通知", desc: "向系统通知中心推送通知（三端），内容与时刻由插件决定" },
  { id: "css", label: "注入全局样式", desc: "注入影响整个应用外观的 CSS（安装时重点确认）" },
  { id: "clipboard:read", label: "读取剪贴板", desc: "读取系统剪贴板内容（敏感：可能读到密码管理器复制的口令）" },
  { id: "plugins:call", label: "调用其他插件", desc: "列出并执行其他已启用插件的命令（含写操作）" },
  { id: "tsinghua:sdk", label: "访问任意校内服务", desc: "以你的登录态访问任意清华校内系统（自定义服务接入）" },
  { id: "theme", label: "主题控制", desc: "查询与应用主题、参与昼夜跟随调度（可改变全局外观）" },
  { id: "llm", label: "模型对话", desc: "经内置 Harness 调用大模型（清华免费档或你的自费 API）" },
  { id: "exthw:read", label: "读取外部作业源", desc: "雨课堂 / TUOJ / Tyche / DSA OJ 的作业快照" },
  { id: "exthw:refresh", label: "刷新外部作业源", desc: "触发外部作业源网络刷新" },
  { id: "webview", label: "应用内网页", desc: "在应用内打开网页（Android 桌面模式浏览）" },
];

/** 插件设置项：安装后由应用代为渲染表单（插件不自带 UI） */
export interface PluginSettingField {
  key: string;
  label: string;
  /** 自动维护字段（宿主/插件自己写入，如 MadModel token）：设置面板只读展示，
   *  且保存时**不**用面板草稿覆盖——否则打开面板后泵刚签发的值会被草稿清空 */
  auto?: boolean;
  type?: "text" | "password" | "textarea" | "select";
  /** select 类型的选项集 */
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  default?: string;
}

export interface PluginManifest {
  /** 唯一 id（建议反域名，如 onethu.harness） */
  id: string;
  /** 骨干形态：js（webview 模块，默认）| rust（sidecar 进程，课程 R1：
   *  agent 主控循环/LLM 编排/token 统计全在 Rust 二进制内，宿主 JSON-RPC 喂数据） */
  kind?: "js" | "rust";
  /** rust 专用：二进制文件名（安装时随 manifest.json 同目录选取） */
  bin?: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  /** 源码仓库地址（可选）：管理页据此提供「仓库」跳转 */
  repo?: string;
  permissions: PluginPermission[];
  settings?: PluginSettingField[];
  /** 插件类别（2026-09-13 主题系统立项）：theme=主题插件（导出 theme 定义，
   *  免 default(ctx)），general=通用能力插件（默认，导出 default(ctx)） */
  category?: "general" | "theme";
}

/** 插件注册的命令：显示在插件管理页，可带一段文本输入（agent prompt 等） */
/** 命令/面板的结构化结果：runCommand 与 ui 面板均可返回，
 *  宿主按区块渲染（纯 string 入参时自动包成 { text }）。 */
export interface CommandResult {
  /** 纯文本摘要（渲染在区块顶部） */
  text?: string;
  /** Markdown 正文（react-markdown + GFM：表格/列表/代码块/链接） */
  markdown?: string;
  /** 条目列表（每条 title 必填，subtitle/meta 为次要行） */
  items?: Array<{ title: string; subtitle?: string; meta?: string }>;
  /** 键值对（小型状态/汇总展示） */
  kv?: Array<{ k: string; v: string }>;
}

export interface PluginCommand {
  id: string;
  title: string;
  /** 输入框占位文案；不填则无输入框 */
  inputLabel?: string;
  inputPlaceholder?: string;
  /** rust 插件可选：标记为对话面板命令（宿主左下角 dock 据此渲染） */
  dock?: boolean;
}

/** 传给插件 activate(ctx) 的完整上下文 */
export interface PluginContext {
  onethu: OnethuApi;
  /** 注册命令（管理页展示、用户点击执行） */
  registerCommand(cmd: PluginCommand, run: (input: string) => Promise<unknown> | unknown): void;
  /** 注册侧栏功能页（UI 自由化）：应用导航出现本插件的 tab；
   *  页面内容由插件在容器内全权渲染（onethu.ui.onTabReady / getTabRoot 拿 DOM）。 */
  registerTab(tab: { id: string; title: string; iconSvg?: string }): void;
  /** 注入插件样式（天马行空 CSS）：全局 <style>，插件停用即移除。
   *  作用域规约：选择器用 [data-plg="<pluginId>"] 包裹，避免污染宿主界面。需 css 权限。 */
  registerCss(css: string): void;
  /** 注册原子种类（万物原子化）：使插件结果可收进用户收藏夹、进 AtomPicker。
   *  resolve(key) 返回展示元数据；key 约定 "<tabId>~<原子key>"（点击深链到对应 tab）。 */
  registerAtom(def: {
    group: string;
    iconSvg?: string;
    resolve: (key: string) => { title: string; sub?: string } | null;
  }): void;
  /** 声明一个桌面小组件（Android）：只声明「显示什么」，渲染由宿主与原生完成。
   *  rows 里可用 { atom } 引用本插件注册的原子（key 约定同收藏夹 "<tabId>~<原子key>"），
   *  宿主解析后交给原生；有 3 个预留槽位，按声明顺序占位。需 widget 权限。 */
  registerWidget(def: {
    id: string;
    title: string;
    rows: Array<{ text: string; sub?: string } | { atom: string }>;
    target?: string;
  }): void;
  /** 写日志（进应用调试通道：桌面 /tmp/onethu-debug.log，Android logcat tag=onethu） */
  log(line: string): void;
}

export interface OnethuApi {
  session: {
    /** "booting"|"connecting"|"2fa"|"logged-out"|"ready" */
    status(): string;
    /** 当前登录名（学号/用户名；未登录 null） */
    username(): string | null;
  };
  user: {
    /** 基本信息（姓名/学号/院系/邮箱） */
    info(): Promise<import("@onethu/core").BasicUserInfo>;
  };
  info: {
    /** 课表（YYYY-MM-DD 起/止） */
    schedule(startDate: string, endDate: string): Promise<import("@onethu/core").ScheduleEntry[]>;
    /** 成绩单 */
    report(): Promise<import("@onethu/core").ReportRow[]>;
    exams(): Promise<import("@onethu/core").ExamEntry[]>;
    /** 学校重要事项（倒计时列表） */
    deadlines(): Promise<import("@onethu/core").DeadlineItem[]>;
    /** 新闻列表（page 从 1 起） */
    news(page?: number): Promise<import("@onethu/core").NewsItem[]>;
    newsDetail(xxid: string): Promise<import("@onethu/core").NewsDetail>;
    searchNews(keyword: string, page?: number): Promise<import("@onethu/core").NewsItem[]>;
    /** 订阅动态（用户在信息页配置的订阅源聚合流） */
    newsSub(page?: number, subscriptionId?: string): Promise<import("@onethu/core").NewsItem[]>;
    /** 校历节点 */
    schoolCalendar(): Promise<import("@onethu/core").SchoolCalendarData>;
    /** 空教室：楼栋列表 / 指定周次各教室占用 */
    classroomList(): Promise<import("@onethu/core").Classroom[]>;
    classroomState(building: string, week: number): Promise<import("@onethu/core").ClassroomStateResult>;
    /** 电子发票 / 银行代扣 / 助研津贴 */
    invoices(page: number): Promise<import("@onethu/core").InvoicePage>;
    bankPayments(): Promise<import("@onethu/core").BankPaymentByMonth[]>;
    graduateIncome(begin: string, end: string): Promise<import("@onethu/core").GraduateIncome[] | null>;
    dormScore(): Promise<string | null>;
    physicalExam(): Promise<Array<[string, string]>>;
    assessmentList(): Promise<Array<[string, boolean, string]>>;
  };
  learn: {
    semesters(): Promise<string[]>;
    courses(semesterId?: string): Promise<{ semester: string; courses: import("@onethu/core").CourseInfo[] }>;
    homework(semesterId?: string): Promise<Array<import("@onethu/core").Homework & { courseName: string }>>;
    notifications(semesterId?: string): Promise<Array<import("@onethu/core").Notification & { courseName: string }>>;
    files(courseId: string, semesterId?: string): Promise<import("@onethu/core").CourseFile[]>;
    reply(wlkcid: string, threadId: string, content: string): Promise<void>;
    post(wlkcid: string, bqid: string, title: string, html: string): Promise<void>;
    bbsBoards(wlkcid: string): Promise<import("@onethu/core").LearnBbsBoard[]>;
    bbsThreads(wlkcid: string, opts?: { bqid?: string; kind?: "yb" | "jh" | "cy"; start?: number; length?: number }): Promise<{ total: number; threads: import("@onethu/core").LearnBbsThreadSummary[] }>;
    bbsThread(wlkcid: string, threadId: string, bqId?: string): Promise<import("@onethu/core").LearnBbsThreadDetail>;
    bbsPosts(wlkcid: string, threadId: string, pageNum: number): Promise<import("@onethu/core").LearnBbsPost[]>;
  };
  venue: {
    scenes(): Promise<import("@onethu/core").VenueScene[]>;
    currentPage(params: { sceneUuid: string; reserveDate: string; classTypeUuid?: string; siteType?: string }): Promise<import("@onethu/core").VenueSite[] | null>;
    myRecords(page?: number): Promise<import("@onethu/core").VenueRecord[]>;
    cancel(resvUuid: string): Promise<void>;
    jump(sceneUuid: string): string;
  };
  xk: {
    search(opts: { kcm?: string; kch?: string; teacher?: string; semester?: string; page?: number }): Promise<import("@onethu/core").XkSearchResult>;
    catalog(sem?: string): Promise<import("@onethu/core").XkCourse[]>;
    selected(sem?: string): Promise<import("@onethu/core").SelectedCourse[]>;
    detail(teacherId: string, code: string): Promise<import("@onethu/core").XkCourseDetail | null>;
    reviews(course: string, teacher?: string): Promise<{
      course: string; teacher: string; count: number; avg: number;
      reviews: { count?: number; results: Array<Record<string, unknown>> };
    } | null>;
  };
  cal: {
    /** 时间窗内的日程出现（云+本地合并展开；日期缺省=今天起 14 天） */
    agenda(startYmd?: string, endYmd?: string): Promise<Array<{
      uid: string; title: string; date: string; start: string; end: string; allDay: boolean;
      location?: string; note?: string; source: "cloud" | "local";
    }>>;
    /** 新建日程（云同步已配置且 local≠true 时写云端，否则本地） */
    add(title: string, dateYmd: string, startHm: string, endHm: string, opts?: {
      location?: string; note?: string; allDay?: boolean; local?: boolean;
    }): Promise<{ uid: string; where: "cloud" | "local" }>;
    /** 修改已有日程：只传要改的字段（未传的保留原值）；location/note 传空串=清除 */
    edit(uid: string, ch: {
      title?: string; date?: string; start?: string; end?: string;
      location?: string; note?: string; allDay?: boolean; toCloud?: boolean;
    }): Promise<{ uid: string; where: "cloud" | "local" }>;
    /** 删除日程（按 uid，自动路由云端/本地） */
    remove(uid: string): Promise<{ removed: true }>;
  };
  mail: {
    /** 最新邮件（folder="INBOX"|"Sent Items"；返回总数+头列表） */
    list(folder: string, limit: number): Promise<{
      total: number;
      mails: Array<{ uid: number; subject: string; from: string; dateMs: number; seen: boolean }>;
    }>;
    /** 读一封（读后自动标已读） */
    read(folder: string, uid: number): Promise<{
      subject: string; from: string; to: string; dateMs: number; text: string; html: string | null;
    }>;
    /** 全箱搜索（服务器端主题/发件人） */
    search(folder: string, query: string): Promise<Array<{ uid: number; subject: string; from: string; dateMs: number; seen: boolean }>>;
    /** 发信（to/cc 多址由应用侧拆分） */
    send(to: string, cc: string, subject: string, body: string): Promise<{ sent: true }>;
  };
  cloud: {
    /** 资料库列表 */
    repos(): Promise<Array<{ id: string; name: string; mtime: number; size: number }>>;
    /** 目录内容 */
    list(repoId: string, path: string): Promise<Array<{ name: string; kind: "dir" | "file"; size: number; mtime: number }>>;
    /** 库内搜索（文件名） */
    search(repoId: string, query: string): Promise<Array<{ name: string; kind: "dir" | "file"; size: number; mtime: number }>>;
    /** 下载到 ~/Downloads，返回本地路径 */
    download(repoId: string, path: string): Promise<string>;
    /** 上传（localPath 支持 ~） */
    upload(repoId: string, parentDir: string, localPath: string, replace: boolean): Promise<{ size: number }>;
    /** 分享链接（expireDays=0 永久） */
    share(repoId: string, path: string, expireDays: number): Promise<{ link: string; token: string }>;
  };
  kongjian: {
    page(opts?: { spaceId?: string; roomId?: string; date?: string }): Promise<import("@onethu/core").KongjianPage>;
    my(): Promise<import("@onethu/core").KongjianRecord[]>;
    book(bookUrl: string, info_: { name: string; sid: string; tel: string; other: string }): Promise<string>;
    cancel(target: string): Promise<void>;
  };
  coursex: {
    semesters(): Promise<import("@onethu/core").CourseXSemester[]>;
    search(q: string, semester?: string): Promise<import("@onethu/core").CourseXSummary[]>;
    detail(id: string): Promise<import("@onethu/core").CourseXDetail | { id: string; error: string } | null>;
  };
  card: {
    info(): Promise<import("@onethu/core").CardInfo>;
    /** 消费流水（YYYY-MM-DD 起/止） */
    transactions(start: string, end: string): Promise<import("@onethu/core").CardTransaction[]>;
  };
  dorm: {
    eleRemainder(): Promise<import("@onethu/core").EleRemainder>;
    elePayRecord(): Promise<import("@onethu/core").ElePayRecord[]>;
  };
  library: {
    list(): Promise<import("@onethu/core").Library[]>;
    /** 楼层（dateChoice：0=今天 1=明天） */
    floors(libraryId: number, dateChoice?: 0 | 1): Promise<import("@onethu/core").LibraryFloor[]>;
    /** 区域（floor = floors() 返回的元素） */
    sections(floor: { id: number; zhNameTrace: string }, dateChoice?: 0 | 1): Promise<import("@onethu/core").LibrarySection[]>;
    seats(section: { id: number; zhNameTrace: string }, dateChoice?: 0 | 1): Promise<import("@onethu/core").LibrarySeat[]>;
    /** 我的预约记录 */
    records(): Promise<import("@onethu/core").LibBookRecord[]>;
    /** 预约座位（seat = seats() 元素；sectionId 为所属区域 id） */
    book(seat: { id: number; type?: string }, sectionId: number, dateChoice?: 0 | 1): Promise<{ status?: number; msg?: string }>;
    cancel(recordId: string): Promise<void>;
  };
  libroom: {
    /** 研讨间类型列表 */
    list(): Promise<import("@onethu/core").LibRoomInfo[]>;
    /** 某日某类型的可预约资源（date=YYYY-MM-DD） */
    resources(date: string, kindId: number): Promise<import("@onethu/core").LibRoomRes[]>;
    records(): Promise<import("@onethu/core").LibRoomBookRecord[]>;
    /** 预约（start/end = "YYYY-MM-DD HH:00"；memberAccNos 为成员 accNo 列表，可空） */
    book(roomRes: import("@onethu/core").LibRoomRes, start: string, end: string, memberAccNos?: number[]): Promise<void>;
    cancel(uuid: string): Promise<void>;
    /** 按姓名/学号模糊搜成员（拼团用） */
    fuzzyMember(keyword: string): Promise<import("@onethu/core").LibFuzzySearchResult[]>;
  };
  network: {
    balance(): Promise<import("@onethu/core").NetworkBalance>;
    devices(): Promise<import("@onethu/core").NetworkDevice[]>;
    deviceCount(): Promise<number>;
    accountInfo(): Promise<import("@onethu/core").NetworkAccountInfo>;
  };
  nav: {
    /** 应用内跳转（page 见接口指南「页面路由」；params 如 { reserveTab: "room" }） */
    go(page: string, params?: Record<string, unknown>): void;
    /** 按关键词检索全应用可跳转原子（功能页面 / 今日组件 / 本机已见过的课程·作业·通知·
     *  在线服务等）。只查静态注册表 + 本机缓存，**绝不发起校园请求**；
     *  与 nav.openAtom 配对即「一句话直达」。需 nav 权限 */
    searchAtoms(query: string, limit?: number): Promise<Array<{ kind: string; key: string; title: string; sub?: string; group: string }>>;
    /** 打开一个原子（等价用户点收藏夹里的那一项：跳功能页 / 切聚合页页签 / 开服务页）。
     *  该原子未注册或已失效时返回 false——**不会跳空白页**，调用方据此回话。需 nav 权限 */
    openAtom(ref: { kind: string; key: string }): Promise<boolean>;
    /** 本机使用统计（只含「点过什么」，不含任何校园数据）：总次数、种类数、
     *  使用最多的若干项（带 kind/key，可直接交给 nav.openAtom 打开）。需 nav 权限 */
    usage(limit?: number): Promise<{
      total: number;
      kinds: number;
      top: Array<{ kind: string; key: string; title: string; group: string; n: number; last: number }>;
      recent: Array<{ kind: string; key: string; title: string; n: number; last: number }>;
    }>;
    /** 清空本机使用统计（用户主动要求「别再记了」时用）。需 nav 权限 */
    clearUsage(): Promise<void>;
  };
  ui: {
    toast(text: string): void;
    /** 应用内确认弹窗（Promise 化）；opts.danger 走危险操作样式（红色确认钮）。需 ui 权限 */
    /** 危险样式（`danger: true`）时应显式提供 `title` 与 `confirmText`：
     *  宿主兜底文案为「此操作不可撤销，请确认 / 确认执行」，多场景共用同一句会削弱
     *  提示的针对性（R21c 实录：忽略作业弹窗曾显示「即将退选 / 确认退选」）。 */
    confirm(
      msg: string,
      opts?: { danger?: boolean; title?: string; confirmText?: string },
    ): Promise<boolean>;
    /** 通用表单弹窗：fields 为 FormField[]（text/textarea/password/select），
     *  resolve 键值对象；用户取消 resolve null。需 ui 权限 */
    form(title: string, fields: Array<{
      key: string; label: string;
      kind?: "text" | "textarea" | "password" | "select";
      placeholder?: string; default?: string; required?: boolean;
      options?: Array<{ value: string; label: string }>;
    }>): Promise<Record<string, string> | null>;
    /** 应用内 WebView 模态打开 URL（Android 桌面模式浏览；桌面端抛错由调用方降级）。需 webview 权限 */
    webModal(url: string): Promise<void>;
    /** 剪贴板：write 需 ui 权限；read 需 clipboard:read 权限（敏感） */
    clipboard: {
      write(text: string): Promise<void>;
      read(): Promise<string>;
    };
    /** 本插件 tab 的挂载容器（未挂载时 null）——拿到后可全权渲染 DOM */
    getTabRoot(pageKey: string): HTMLElement | null;
    /** 订阅 tab 容器就绪（已就绪立即回调；返回退订函数） */
    onTabReady(pageKey: string, cb: (root: HTMLElement) => void): () => void;
  };
  /** 万物原子化收藏（对齐宿主收藏夹体系）：插件结果可收进用户收藏夹，点击深链回插件 tab。需 ui 权限 */
  favorites: {
    /** 收藏本插件原子。key 即 registerAtom 约定的 "<tabId>~<原子key>"（本插件 kind 自动补全）；
     *  folderId 缺省收进第一个根收藏夹（无根夹时自动建「我的收藏」） */
    add(key: string, folderId?: string): void;
    /** 列出本插件已被收藏的原子的收藏夹与 key */
    list(): Array<{ folderId: string; folderTitle: string; key: string }>;
    /** 收藏任意已注册种类的原子（跨插件）；meta 提供展示元数据（该种类未注册时内联注册） */
    addAtom(ref: { kind: string; key: string }, meta?: { title: string; sub?: string; group?: string; iconSvg?: string }, folderId?: string): void;
    /** 列出全部可收藏的插件原子种类 */
    kinds(): Array<{ kind: string; group: string; source: "registered" | "static" }>;
  };
  /** 在线服务（服务大厅）目录：本机缓存检索不到时的兜底通道。需 info:read */
  services: {
    /** 按名字检索服务目录（**会发起校园请求**：先校验会话再取目录，仅在没有本地缓存时才该调用）。
     *  匹配容忍口语简称（「亲友预约」能命中「亲友来访预约」，甚至「亲友入校报备」这类
     *  换了后半截的名字也会以低分进候选），最多 limit 条（缺省 10、上限 50）。
     *  `score` 见 lib/serviceMatch.ts：≥40 = 有把握可直达，20~39 = 只作候选，务必先向用户确认。
     *  结果同时写入本机原子缓存，之后 nav.searchAtoms / nav.openAtom 即可离线命中 */
    search(query: string, limit?: number): Promise<Array<{ id: string; name: string; department?: string; url: string; score: number }>>;
    /** 在应用内打开某个服务官方页（桌面独立窗口 / Android 全屏 WebView，共享同一登录态）。
     *  url 必须来自 search 结果；打不开（无 url / 宿主不支持）返回 false */
    open(service: { id?: string; name?: string; url?: string }): Promise<boolean>;
  };
  /** 系统通知（三端）：插件自定内容与时刻；通知 id 归插件所有，宿主重排不会撤它 */
  notify: {
    /** 排一条通知；afterSeconds 缺省 60（至少 1 秒后，避免"过去时刻"被系统拒绝）。
     *  需 notify 权限。返回 ok=false 时 reason 说明原因（未授权 / 平台不支持 / 排程失败） */
    send(opts: { title: string; body?: string; afterSeconds?: number; key?: string; page?: string }): Promise<{
      ok: boolean;
      /** 通知 id（撤销时用） */
      id: string;
      reason?: string;
    }>;
    /** 撤销一条自己的通知（key 与 send 时一致） */
    cancel(key: string): Promise<boolean>;
    /** 后端与权限状态；request=true 时顺带发起授权请求（用户主动行为时才传） */
    status(request?: boolean): Promise<{ ok: boolean; backend: string; granted: boolean; exact: boolean; reason?: string }>;
  };
  /** 桌面小组件（Android）：查询本插件声明的小组件与所占槽位 */
  widget: {
    /** 列出本插件已声明的小组件及槽位号（未占槽位时 slot 为 null） */
    list(): Array<{ id: string; title: string; slot: string | null }>;
    /** 本平台的槽位总数（用于提示用户「放到第 N 个小组件」） */
    slots(): number;
    /** 桌面上每一块小组件（appWidgetId）及其绑定的内容 */
    instances(): Promise<Array<{ id: string; shape: string; binding: unknown }>>;
    /** 新放置、还没选的块用哪份默认内容 */
    getFallback(): Promise<unknown>;
    /** 改默认内容；目标不存在（收藏夹被删 / 原子解析不出）返回 false */
    setFallback(binding: { kind: "today" } | { kind: "folder"; folderId: string } | { kind: "detail" | "shortcut"; atom: { kind: string; key: string } } | null): Promise<boolean>;
    /** 绑定某一块的显示内容（id 为 instances() 报回的 id）；目标失效返回 false */
    bind(id: string, binding: { kind: "today" } | { kind: "folder"; folderId: string } | { kind: "detail" | "shortcut"; atom: { kind: string; key: string } } | null): Promise<boolean>;
    /** 解除绑定（回到默认内容） */
    unbind(id: string): Promise<boolean>;
  };
  storage: {
    get<T = string>(key: string): T | null;
    set<T = string>(key: string, value: T): void;
    keys(): string[];
    remove(key: string): void;
  };
  /** 本插件设置项的当前值（用户在管理页填写） */
  settings: {
    get(): Record<string, string>;
  };
  net: {
    /** 外部 HTTP(S) 请求（经应用传输层，无 CORS 限制；需 net:external 权限）。
     *  返回标准 Response（可用 res.json()/res.text()）。 */
    fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<Response>;
  };
  plugins: {
    /** 列出已启用 JS 插件及其命令（联动插件工具发现）。需 plugins:call 权限 */
    list(): Promise<Array<{ pluginId: string; pluginName: string; commands: Array<{ id: string; title: string; inputLabel?: string }> }>>;
    /** 执行已启用插件的命令（高危：命令可能含写操作，由插件内部两段确认兜底）。需 plugins:call 权限 */
    call(pluginId: string, cmdId: string, input?: string): Promise<unknown>;
  };
  ts: {
    /** 会话探活：返回主会话当前可用性。需 tsinghua:sdk 权限。 */
    status(): Promise<"ready" | "expired" | "logged-out">;
    /** 确保主会话可用（探活 + 透明建立）；不可用时抛 AuthRequiredError。 */
    ensure(): Promise<void>;
    /** 当前登录名（未登录为 null）。 */
    username(): Promise<string | null>;
    /** 创建清华服务 HTTP 客户端：共享宿主主会话 cookie 池与自愈守卫，
     *  自动处理 webvpn 包装与直连分流。CAS 对接的系统在会话存活时自动过票。 */
    client(opts?: { mode?: "auto" | "webvpn" | "direct" }): {
      /** 发起请求。init 为标准 RequestInit 子集；返回标准 Response。
       *  响应含登录页特征时宿主自动重登并重放一次。 */
      fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<Response>;
      /** 返回按分流规则解析后的实际请求 URL（调试与展示用）。 */
      resolve(url: string): string;
    };
  };
  llm: {
    /** 单轮对话（经内置 Harness：清华 MadModel 免费档 ↔ 自费 API 自动调度）。
     *  返回回复文本与本次实际使用的模型/模型源；免费档不可用（校外且无自费 Key）
     *  时抛带引导文案的错误。需 llm 权限。 */
    chat(input: string): Promise<{ text: string; model: string; provider: string }>;
    /** 当前 Harness 的模型源设置（"madmodel" | "custom" | ""=自动） */
    provider(): Promise<string>;
  };
  theme: {
    /** 已安装主题列表（含 dark 声明） */
    list(): Promise<Array<{ id: string; name: string; version: string; dark: boolean }>>;
    /** 当前手动选中的主题 id（昼夜跟随模式下实际生效看 schedule().systemDark） */
    active(): Promise<string | null>;
    /** 应用某主题（null=基础令牌；会自动退出昼夜跟随） */
    apply(id: string | null): Promise<void>;
    /** 昼夜调度状态（followSystem/两档 id/系统当前暗亮） */
    schedule(): Promise<{ followSystem: boolean; dayThemeId: string | null; nightThemeId: string | null; systemDark: boolean }>;
    /** 开关「跟随系统昼夜」 */
    setFollowSystem(on: boolean): Promise<void>;
    /** 设置日/夜两档主题（null=基础令牌） */
    setDayNight(dayId: string | null, nightId: string | null): Promise<void>;
  };
  exthw: {
    /** 外部作业源快照：各源作业条目/错误/自动登录状态/上次刷新时间 */
    snapshot(): Promise<{
      items: Array<{ source: string; course: string; title: string; deadline: string | null; url: string | null; submitted: boolean; graded: boolean; score: number | null }>;
      errors: Record<string, string>;
      state: string;
      lastAt: number;
      configured: boolean;
    }>;
    /** 触发全源刷新（网络请求；各源按自身频控） */
    refresh(): Promise<void>;
  };
}

/** 安装记录（localStorage 持久化） */
export interface PluginRecord {
  manifest: PluginManifest;
  /** js 插件的模块文本；rust 插件为空串 */
  code: string;
  /** 来源仓库（市场/GitHub 直装时记录；清单自声明 repo 亦可） */
  repo?: string;
  /** rust 插件：二进制绝对路径（manifest 在其同目录 manifest.json） */
  binPath?: string;
  /** 内置插件（OH）：App 的一部分，管理页不可卸载 */
  builtin?: boolean;
  /** 内嵌插件：Rust 核心直接编进 App 进程（Android 内置），无 sidecar 二进制 */
  embedded?: boolean;
  enabled: boolean;
  settings: Record<string, string>;
  installedAt: number;
}

/** 权限不足时抛出 */
export class PluginPermissionError extends Error {
  constructor(permission: string, what: string) {
    super(`插件未获授权「${permission}」，无法执行：${what}`);
  }
}
