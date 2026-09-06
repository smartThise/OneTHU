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
  | "nav" // 应用内页面跳转
  | "ui" // toast 提示
  | "storage" // 插件私有键值存储
  | "net:external"; // 外部网络请求（大模型 API 等）

export const PLUGIN_PERMISSIONS: ReadonlyArray<{ id: PluginPermission; label: string; desc: string }> = [
  { id: "user:read", label: "读取基本信息", desc: "姓名/学号/院系与登录会话状态" },
  { id: "info:read", label: "读取信息门户", desc: "成绩、考试、新闻、校历、空教室、缴费记录等只读查询" },
  { id: "card:read", label: "读取校园卡", desc: "余额与消费流水（只读，不含充值）" },
  { id: "dorm:read", label: "读取宿舍信息", desc: "电费余额/缴费记录/卫生分（只读）" },
  { id: "library:read", label: "查询图书馆", desc: "楼层/区域/座位分布/预约记录 + 研讨间资源查询" },
  { id: "library:book", label: "预约图书馆", desc: "座位与研讨间的预约/取消（写操作）" },
  { id: "network:read", label: "读取校园网账户", desc: "余额/在线设备/账号信息（只读）" },
  { id: "nav", label: "应用内跳转", desc: "跳转到应用的任意页面与子栏" },
  { id: "ui", label: "显示提示", desc: "弹出 toast 消息" },
  { id: "storage", label: "本地存储", desc: "插件私有键值存储（卸载即清除）" },
  { id: "net:external", label: "外部网络请求", desc: "直接请求任意外部 HTTP(S) 接口（大模型 API 等）" },
];

/** 插件设置项：安装后由应用代为渲染表单（插件不自带 UI） */
export interface PluginSettingField {
  key: string;
  label: string;
  type?: "text" | "password" | "textarea";
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
  permissions: PluginPermission[];
  settings?: PluginSettingField[];
}

/** 插件注册的命令：显示在插件管理页，可带一段文本输入（agent prompt 等） */
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
  /** 写日志（进应用调试通道：桌面 /tmp/onethu-debug.log，Android logcat tag=onethu） */
  log(line: string): void;
}

export interface OnethuApi {
  session: {
    /** "booting"|"connecting"|"2fa"|"logged-out"|"ready"|"demo" */
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
  };
  ui: {
    toast(text: string): void;
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
}

/** 安装记录（localStorage 持久化） */
export interface PluginRecord {
  manifest: PluginManifest;
  /** js 插件的模块文本；rust 插件为空串 */
  code: string;
  /** rust 插件：二进制绝对路径（manifest 在其同目录 manifest.json） */
  binPath?: string;
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
