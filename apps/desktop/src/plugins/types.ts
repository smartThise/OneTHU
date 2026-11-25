import { t as i18n } from "../i18n/index.js";
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
  | "contacts:read" // OneTHU 好友与收到的名片
  | "org:read" // 组织目录、成员、项目、公告及资源引用
  | "org:write" // 组织资料、项目与公告编辑
  | "xiaoda:read" // 清小搭智能体、技能广场和已安装技能
  | "xiaoda:manage" // 导入并启停清小搭技能
  | "xiaoda:chat" // 向清小搭智能体发送问题并创建会话
  | "vault:read" // 暂存箱摘要与内容
  | "vault:write" // 暂存箱增删改及显式分享/接收
  | "info:read" // 成绩/考试/新闻/校历/空教室/缴费等只读查询
  | "card:read" // 校园卡余额与流水（只读）
  | "dorm:read" // 宿舍电费/卫生分（只读）
  | "library:read" // 图书馆楼层/区域/座位/记录查询 + 研讨间查询
  | "library:book" // 图书馆座位预约/取消 + 研讨间预约/取消（写操作）
  | "network:read" // 校园网账户/设备/余额（只读）
  | "font:read" // 读取系统自带字体文件（PDF 字形轮廓匹配用；仅白名单路径，只读）
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
  | "memory:read" // OH 记忆检索/读取/清单（只读）
  | "memory:write" // OH 记忆写入/追加/改写/归档（写操作，需确认）
  | "gitlab:read" // 清华 GitLab 项目/仓库文件/Issue/合并请求/流水线（只读）
  | "gitlab:write" // 清华 GitLab 新建 Issue、评论、关闭或重开（写操作，需确认）
  | "nav" // 应用内页面跳转
  | "ui" // toast 提示
  | "storage" // 插件私有键值存储
  | "net:external" // 外部网络请求（大模型 API 等）
  | "ws:external" // 外部 WebSocket 长连接（宿主 Rust WS 桥；WebView 的 WS 在 macOS 26.5 受限环境不可用）
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
  { id: "user:read", get label() { return i18n("plugins.types.db8046b7bb4f"); }, get desc() { return i18n("plugins.types.dd2d1636c619"); } },
  { id: "contacts:read", get label() { return i18n("permissions.contacts.label"); }, get desc() { return i18n("permissions.contacts.desc"); } },
  { id: "org:read", get label() { return i18n("permissions.org.label"); }, get desc() { return i18n("permissions.org.desc"); } },
  { id: "org:write", get label() { return i18n("permissions.orgWrite.label"); }, get desc() { return i18n("permissions.orgWrite.desc"); } },
  { id: "xiaoda:read", get label() { return i18n("permissions.xiaoda.label"); }, get desc() { return i18n("permissions.xiaoda.desc"); } },
  { id: "xiaoda:manage", get label() { return i18n("permissions.xiaodaManage.label"); }, get desc() { return i18n("permissions.xiaodaManage.desc"); } },
  { id: "xiaoda:chat", get label() { return i18n("permissions.xiaodaChat.label"); }, get desc() { return i18n("permissions.xiaodaChat.desc"); } },
  { id: "vault:read", get label() { return i18n("permissions.vault.label"); }, get desc() { return i18n("permissions.vault.desc"); } },
  { id: "vault:write", get label() { return i18n("permissions.vaultWrite.label"); }, get desc() { return i18n("permissions.vaultWrite.desc"); } },
  { id: "info:read", get label() { return i18n("plugins.types.92acc8140843"); }, get desc() { return i18n("plugins.types.e98935ae658f"); } },
  { id: "font:read", get label() { return i18n("permissions.fontRead.label"); }, get desc() { return i18n("permissions.fontRead.desc"); } },
  { id: "learn:read", get label() { return i18n("plugins.types.cf01361e883f"); }, get desc() { return i18n("plugins.types.d7ca0f2e28a2"); } },
  { id: "learn:write", get label() { return i18n("plugins.types.112f4f9c033a"); }, get desc() { return i18n("plugins.types.eeb2d48d3eaa"); } },
  { id: "venue:read", get label() { return i18n("plugins.types.6dc54a9470ed"); }, get desc() { return i18n("plugins.types.c958b2f88de5"); } },
  { id: "venue:book", get label() { return i18n("plugins.types.1004769bdb4e"); }, get desc() { return i18n("plugins.types.5171b9b529e4"); } },
  { id: "xk:read", get label() { return i18n("plugins.types.27922c7aab59"); }, get desc() { return i18n("plugins.types.1ff6bbfc90da"); } },
  { id: "kongjian:book", get label() { return i18n("plugins.types.2cc9c0bad3d7"); }, get desc() { return i18n("plugins.types.3fb5a1122255"); } },
  { id: "cal:read", get label() { return i18n("plugins.types.056ff6cc3d7e"); }, get desc() { return i18n("plugins.types.bb44113c1bc4"); } },
  { id: "cal:write", get label() { return i18n("plugins.types.dcaf20f7619c"); }, get desc() { return i18n("plugins.types.c4aa15d951ce"); } },
  { id: "mail:read", get label() { return i18n("plugins.types.08eccad108d6"); }, get desc() { return i18n("plugins.types.efe0261e5829"); } },
  { id: "mail:write", get label() { return i18n("plugins.types.b15c42776a94"); }, get desc() { return i18n("plugins.types.556c5fcee2ec"); } },
  { id: "cloud:read", get label() { return i18n("plugins.types.627dd0f3fd6e"); }, get desc() { return i18n("plugins.types.9f61b41430d2"); } },
  { id: "cloud:write", get label() { return i18n("plugins.types.48e21aca2214"); }, get desc() { return i18n("plugins.types.b5df04d0e95e"); } },
  { id: "memory:read", get label() { return i18n("plugins.types.7ad8378abec1"); }, get desc() { return i18n("plugins.types.9665288d3db6"); } },
  { id: "memory:write", get label() { return i18n("plugins.types.9f78589bce11"); }, get desc() { return i18n("plugins.types.0e3c0e14077d"); } },
  { id: "gitlab:read", get label() { return i18n("plugins.types.3821452a894a"); }, get desc() { return i18n("plugins.types.0b0aeead7381"); } },
  { id: "gitlab:write", get label() { return i18n("plugins.types.48ad7913a562"); }, get desc() { return i18n("plugins.types.c4fad583342d"); } },
  { id: "card:read", get label() { return i18n("plugins.types.0dc09ebd6c0e"); }, get desc() { return i18n("plugins.types.584c7658f468"); } },
  { id: "dorm:read", get label() { return i18n("plugins.types.78a788aeb3ed"); }, get desc() { return i18n("plugins.types.3c455efb9961"); } },
  { id: "library:read", get label() { return i18n("plugins.types.14dceca5d51a"); }, get desc() { return i18n("plugins.types.feef1c678595"); } },
  { id: "library:book", get label() { return i18n("plugins.types.5d78a4c234e1"); }, get desc() { return i18n("plugins.types.c6cb8feb5896"); } },
  { id: "network:read", get label() { return i18n("plugins.types.27d28e1cb812"); }, get desc() { return i18n("plugins.types.b47c2c0ce65a"); } },
  { id: "nav", get label() { return i18n("plugins.types.781fead7e82d"); }, get desc() { return i18n("plugins.types.4b9d52da5277"); } },
  { id: "ui", get label() { return i18n("plugins.types.b2101414fb98"); }, get desc() { return i18n("plugins.types.c0c4378797b8"); } },
  { id: "storage", get label() { return i18n("plugins.types.7015255aa19b"); }, get desc() { return i18n("plugins.types.062675c673b0"); } },
  { id: "net:external", get label() { return i18n("plugins.types.b0709765f8a8"); }, get desc() { return i18n("plugins.types.b4ccc4a10048"); } },
  { id: "ws:external", get label() { return i18n("plugins.types.6f73980048f5"); }, get desc() { return i18n("plugins.types.c6990190c123"); } },
  { id: "widget", get label() { return i18n("plugins.types.28b0433b1b95"); }, get desc() { return i18n("plugins.types.e821edec359c"); } },
  { id: "notify", get label() { return i18n("plugins.types.c26692150916"); }, get desc() { return i18n("plugins.types.0b73861126d5"); } },
  { id: "css", get label() { return i18n("plugins.types.db1b60955a4e"); }, get desc() { return i18n("plugins.types.94d7e3d8ab44"); } },
  { id: "clipboard:read", get label() { return i18n("plugins.types.e059f380bf07"); }, get desc() { return i18n("plugins.types.50500d372141"); } },
  { id: "plugins:call", get label() { return i18n("plugins.types.1a2130a92d14"); }, get desc() { return i18n("plugins.types.c73bd6334e39"); } },
  { id: "tsinghua:sdk", get label() { return i18n("plugins.types.2601413e9019"); }, get desc() { return i18n("plugins.types.ef2ab4dbea94"); } },
  { id: "theme", get label() { return i18n("plugins.types.33a65099fe72"); }, get desc() { return i18n("plugins.types.01e0b2699c29"); } },
  { id: "llm", get label() { return i18n("plugins.types.4bcb26f88d39"); }, get desc() { return i18n("plugins.types.2f907548af0c"); } },
  { id: "exthw:read", get label() { return i18n("plugins.types.1daf510cf2b5"); }, get desc() { return i18n("plugins.types.5bbe605e0a01"); } },
  { id: "exthw:refresh", get label() { return i18n("plugins.types.ec461a12a38e"); }, get desc() { return i18n("plugins.types.40a17d15ad1e"); } },
  { id: "webview", get label() { return i18n("plugins.types.a245f4a0189e"); }, get desc() { return i18n("plugins.types.e41be5c33320"); } },
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
  /** select 选项**运行时**从实时 settings 取 JSON 数组（如 MadModel 站点清单实况），
   *  与静态 options 合并；该项缺失或解析失败就退回静态 options */
  optionsFrom?: string;
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
  /* ── 视觉/身份字段（2026-10-11 市场升级，**全部可选、向后兼容**：老插件不写照常显示）── */
  /** 作者 logo：URL 或仓库相对路径（svg/png 都行）；列表与详情都用它 */
  logo?: string;
  /** 列表缩略图（比 logo 更"图片化"的那张）；缺失回落 logo，再缺失回落 monogram */
  thumbnail?: string;
  /** 详情页简介图（可多张，按数组顺序展示；点开可放大） */
  screenshots?: string[];
  /** 详情正文（markdown；缺失回落 description） */
  readme?: string;
  /** 主页/文档地址 */
  homepage?: string;
  /** 许可证标识（MIT / Apache-2.0 …） */
  license?: string;
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

export type { AgentHintMode, AgentHintRequest, AgentHintTrigger, PluginAgentHint, SelectedAgentHint } from "./agentHints.js";

export interface PluginCommand {
  id: string;
  title: string;
  /** 输入框占位文案；不填则无输入框 */
  inputLabel?: string;
  inputPlaceholder?: string;
  /** rust 插件可选：标记为对话面板命令（宿主左下角 dock 据此渲染） */
  dock?: boolean;
  /** 给 OH / Agent 的命令能力说明：告诉模型「什么时候该用、怎么续读」。
   *  会随 `plugins.list` 进入 Harness 的 `list_plugin_cmds`；由插件自己维护，
   *  宿主不写死任何插件名或领域逻辑。纯文本，建议 ≤ 600 字。 */
  agentHint?: string;
}

/** 传给插件 activate(ctx) 的完整上下文 */
export interface PluginContext {
  onethu: OnethuApi;
  /** 注册命令（管理页展示、用户点击执行） */
  registerCommand(cmd: PluginCommand, run: (input: string) => Promise<unknown> | unknown): void;
  /** 注册「主动提示」：仅在这些时机由宿主筛入上下文，不直接改系统提示。 */
  registerAgentHint(hint: import("./agentHints.js").PluginAgentHint): void;
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
  contacts: {
    /** List saved OneTHU friends, optionally filter by name/note. Excludes organization cards by default. */
    list(query?: string, kind?: "personal" | "organization" | "all"): Promise<unknown>;
    /** Read an actual contact id from list, without shared-channel credentials or card images. */
    get(id: string): Promise<unknown>;
  };
  organizations: {
    /** List the current OneTHU organization index. Detailed remote membership is verified by get. */
    list(query?: string): Promise<unknown>;
    /** Read members, projects, announcements and cloud/GitLab resource ids. Verifies live membership for remote organizations. */
    get(id: string): Promise<unknown>;
    /** Create a local organization index and owner record. Shared collaboration is enabled explicitly in the organization page. Requires confirmation. */
    create(name: string, brief?: string): Promise<unknown>;
    /** Edit organization name/description with live owner authorization and revision checks for shared organizations. Requires confirmation. */
    update(id: string, patch: { name?: string; brief?: string }): Promise<unknown>;
    /** Create/update an organization project. id comes from get when editing; remote edits verify membership and use revision checks. Requires confirmation. */
    saveProject(id: string, name: string, description: string, status: "planned" | "active" | "done", owner: string, projectId?: string): Promise<unknown>;
    /** Remove one organization project entry; preserves linked repositories and files. Requires confirmation. */
    removeProject(id: string, projectId: string): Promise<unknown>;
    /** Create/update an organization announcement. announcementId comes from get when editing. Requires confirmation. */
    saveAnnouncement(id: string, title: string, body: string, pinned?: boolean, announcementId?: string): Promise<unknown>;
    /** Remove one organization announcement. Requires confirmation. */
    removeAnnouncement(id: string, announcementId: string): Promise<unknown>;
  };
  xiaoda: {
    /** Read current Qingxiaoda account availability and name without returning its token. */
    status(): Promise<unknown>;
    /** List Qingxiaoda built-in agents after authenticating the current account. */
    agents(): Promise<unknown>;
    /** Read Qingxiaoda model choices and account credit balance. */
    models(): Promise<unknown>;
    balance(): Promise<unknown>;
    /** List this account's Qingxiaoda conversations with official pagination. */
    conversations(page?: number): Promise<unknown>;
    /** Read the full messages of a real conversation id from conversations. */
    conversation(id: string): Promise<unknown>;
    /** Browse/search the Qingxiaoda skill plaza. page starts at 1; response includes school pagination metadata. */
    skills(query?: string, page?: number): Promise<unknown>;
    /** Read skill plaza details using the actual id from skills. */
    skill(id: string): Promise<unknown>;
    /** List all locally installed skills, including disabled and external-agent-only skills with requirements. */
    installed(): Promise<unknown>;
    /** Download and inspect a skill into the private local skill library; enable it separately after checking compatibility. Requires confirmation. */
    importSkill(id: string): Promise<unknown>;
    /** Enable/disable an installed skill. Unsupported runtimes remain unavailable. Requires confirmation. */
    enableSkill(id: string, enabled: boolean): Promise<unknown>;
    /** Remove one installed skill from this account's private library. Requires confirmation. */
    removeSkill(id: string): Promise<unknown>;
    /** Send a question to an actual Qingxiaoda agent from agents, creating a separate conversation. Requires explicit consent and confirmation. */
    ask(agentId: string, question: string): Promise<unknown>;
  };
  vault: {
    /** List OneTHU temporary boxes without their share codes. */
    list(): Promise<unknown>;
    /** Read a box's text, titles and file/atom references; excludes credentials, payload internals and local staged paths. */
    items(id: string): Promise<unknown>;
    /** Read one selected item including safe text/payload metadata. References can be followed with school/cloud tools. */
    item(id: string, itemId: string): Promise<unknown>;
    /** Read a known stored UTF-8 text file in explicit character ranges, with totalChars/nextOffset/complete. Binary formats require the file preview. */
    readText(id: string, itemId: string, offset?: number, maxChars?: number): Promise<unknown>;
    /** Create a named temporary box. Requires confirmation. */
    create(name: string): Promise<unknown>;
    /** Rename a real box from list. Requires confirmation. */
    rename(id: string, name: string): Promise<unknown>;
    /** Store text in a real box. Requires confirmation. */
    addText(id: string, title: string, text: string): Promise<unknown>;
    /** Store a real registered atom reference (kind/key), using its actual title. Requires confirmation. */
    addAtom(id: string, kind: string, key: string): Promise<unknown>;
    /** Store a verified cloud file reference after checking the actual parent directory. Requires cloud read permission and confirmation. */
    addFile(id: string, repoId: string, path: string): Promise<unknown>;
    /** Remove one selected stored item; preserves the source object and files. Requires confirmation. */
    removeItem(id: string, itemId: string): Promise<unknown>;
    /** Generate/reuse an online short sharing code for a box. Requires vault/cloud write permission and confirmation. */
    share(id: string): Promise<unknown>;
    /** Receive a vault sharing code into a new box. Never replaces the active box or accepts unrelated contact/org invites. Requires confirmation. */
    importCode(code: string): Promise<unknown>;
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
  /** 系统字体（PDF 文本抽取补全用，2026-11）：部分 LaTeX 中文 PDF 没有 /ToUnicode，
   *  只能靠"嵌入字形轮廓 ↔ 系统同款字体字形"的指纹匹配还原 Unicode。只读白名单路径，
   *  需 `font:read`；找不到/读失败返回 null，插件按无法还原降级。 */
  fonts: {
    system(family: string): Promise<{ family: string; path: string; b64: string } | null>;
  };
  learn: {
    semesters(): Promise<string[]>;
    courses(semesterId?: string): Promise<{ semester: string; courses: import("@onethu/core").CourseInfo[] }>;
    homework(semesterId?: string): Promise<Array<import("@onethu/core").Homework & { courseName: string }>>;
    notifications(semesterId?: string): Promise<Array<import("@onethu/core").Notification & { courseName: string }>>;
    files(courseId: string, semesterId?: string): Promise<import("@onethu/core").CourseFile[]>;
    /** 下载课件/附件到下载目录，返回本地路径（fileId/filename 来自 files 列表） */
    download(fileId: string, filename?: string): Promise<string>;
    /** 读取课件/附件原始字节（base64；PDF 等二进制解析用）。与 download 同一 learn 专线会话 */
    fileContent(fileId: string, filename?: string): Promise<{ name: string; mime: string; size: number; b64: string }>;
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
  memory: {
    /** 四段检索（无向量）：query 空格分词 + tags/type/folder 过滤 → 命中列表 */
    search(q: { query?: string; tags?: string[]; type?: string; folder?: string; limit?: number }): Promise<Array<{
      permalink: string; title: string; type: string; tags: string[]; path: string;
      modified: string; score: number; snippet: string; via?: string;
    }>>;
    /** 按 permalink 读全文（超 8KB 截断） */
    read(permalink: string): Promise<string>;
    /** 目录/标签清单（不读正文） */
    list(opts?: { folder?: string; tag?: string }): Promise<Array<{
      permalink: string; title: string; type: string; folder: string; tags: string[]; modified: string;
    }>>;
    /** 全量重扫重建账本（排障/同步后对齐） */
    refresh(): Promise<{ count: number }>;
    ready(): Promise<boolean>;
    /** 新建实体（title 重复会拒绝并引导 append） */
    write(input: {
      title: string;
      observations: Array<{ category: string; text: string; context?: string }>;
      relations?: Array<{ rel: string; target: string; context?: string }>;
      tags?: string[];
      type?: string;
      folder?: string;
      origin?: string;
    }): Promise<{ permalink: string; path: string }>;
    append(permalink: string, category: string, text: string, context?: string): Promise<{ ok: true }>;
    edit(permalink: string, find: string, replace: string): Promise<{ ok: true }>;
    /** 软删除 → .trash/ */
    delete(permalink: string, reason?: string): Promise<{ trashedTo: string }>;
  };
  /** 用户扩展层（OH 元工具）：用户工具 / OneFlow / 用户生成组件 */
  ext: {
    skillSearch(query?: string): Promise<unknown>;
    skillCompute(code: string, input: unknown): Promise<unknown>;
    skillRun(id: string, path: string, input: unknown): Promise<unknown>;
    skillLoad(id: string): Promise<unknown>;
    skillReadFile(id: string, path: string): Promise<unknown>;
    toolCreate(name: string, description: string, steps: unknown): void;
    toolList(): Array<{ id: string; name: string; description: string }>;
    toolRun(id: string): Promise<{ ok: boolean; error?: string }>;
    toolDelete(id: string): void;
    flowCreate(name: string, trigger: unknown, steps: unknown): { id: string };
    flowList(): Array<{ id: string; name: string; trigger: unknown; enabled: boolean; lastRun?: number; lastOk?: boolean; lastError?: string }>;
    flowRun(id: string): Promise<{ ok: boolean; error?: string }>;
    /** 改名字 / 触发方式 / 步骤 / 启停（OH 的 ext_flow_update；UI 启停开关同一条） */
    flowUpdate(id: string, patch: { name?: string; trigger?: unknown; steps?: unknown; enabled?: boolean }): { ok: boolean };
    flowSetEnabled(id: string, on: boolean): { ok: boolean };
    flowDelete(id: string): void;
    widgetCreate(name: string, html: string, x?: number, y?: number): { id: string };
    widgetList(): Array<{ id: string; name: string; createdAt: number }>;
    widgetDelete(id: string): void;
    /** 在白板上放一张「插件交互卡片」：点一下执行本插件的 `tapCmdId`，卡片左上角显示命令返回的状态文本。
     *  `cardId` 为插件内唯一标识：同 id 重复调用是就地更新（不会长两张）；`boardId` 缺省 = 首页系统板
     *  （`onePageList()` 里 `kind === "system"` 那块）。只能调用本插件自己的命令；卡片内容全按纯文本渲染。
     *  典型用途：电子木鱼、打卡计数器、小游戏入口。 */
    actionCard(input: {
      cardId: string; title: string; tapCmdId: string; statusCmdId?: string;
      icon?: string; input?: string; boardId?: string;
      x?: number; y?: number; w?: number; h?: number;
    }): Promise<{ id: string; boardId: string; reused: boolean }>;
    /** 移除本插件之前放的交互卡片（只删自己的；不传 boardId = 所有板）。 */
    actionCardRemove(cardId: string, boardId?: string): Promise<{ ok: boolean }>;
    onePageCreate(name: string, icon?: string): { id: string };
    onePageList(): Array<{ id: string; name: string; kind: string; icon: string }>;
    onePageDelete(id: string): { ok: boolean; reason?: string };
    onePageRename(id: string, name: string): void;
    onePageSetIcon(id: string, icon: string): { ok: boolean };
    onePageOpen(id: string): void;
    onePageItems(boardId: string): Array<{ id: string; kind: string; text?: string; x: number; y: number; w: number; h: number }>;
    onePageAddItem(boardId: string, kind: string, payload: unknown, x: number, y: number, w?: number, h?: number): Promise<{ id: string }>;
    onePageMoveItem(boardId: string, itemId: string, x: number, y: number): void;
    onePageRemoveItem(boardId: string, itemId: string): void;
    /** 收藏落点（2026-10-15）：把一颗原子放到**首页**（不给 boardId）或某块 OnePage
     *  （给 boardId）。与收藏面板同一份实现，自带查重与落位；返回 ok=false + reason
     *  （duplicate = 板上已经有它；no-board = 板不存在）。不碰坐标。 */
    onePageAddAtom(target: { to?: string; boardId?: string } | null, atomKey: string): { ok: boolean; boardId: string; added?: string; reason?: string };
    /** 首页程序坞（2026-10-15）：一级页 ∪ 插件功能页（pageId 形如 plugin:<插件>:<页>）
     *  停靠/取消停靠一颗球；不传 pageId = 只读快照（含可停靠清单与名字）。
     *  认不出的 pageId 抛错并列出可停靠项。可调用形态与 .set 同一实现（rpc 分发是平铺两段式）。 */
    homeDock: ((pageId?: string, on?: boolean) => {
      ok: boolean;
      pageId: string;
      label: string;
      docked: string[];
      dockable: string[];
      entries: Array<{ page: string; label: string; plugin: boolean }>;
    }) & {
      set(pageId?: string, on?: boolean): {
        ok: boolean;
        pageId: string;
        label: string;
        docked: string[];
        dockable: string[];
        entries: Array<{ page: string; label: string; plugin: boolean }>;
      };
    };
    workspaceList(): Array<{ id: string; name: string; live: boolean; tabs: number }>;
    workspaceCreate(name: string, tabIds?: unknown): { id: string };
    workspaceOpen(id: string): boolean;
    /** 收起活板（只折叠，不关标签/不删定义） */
    workspaceCollapse(id: string): boolean;
    /** 真正关闭活板（关成员标签 + 移除定义；破坏性） */
    workspaceClose(id: string): boolean;
    workspaceDissolve(id: string): boolean;
    workspaceDelete(id: string): boolean;
    tabList(): Array<{ id: string; title: string; page: string }>;
    tabOpen(page: string): { id: string };
    tabClose(id: string): boolean;
    tabDuplicate(id: string): { id: string };
    tabFocus(id: string): boolean;
    wallpaperSet(scope: string, ref: string | null): void;
    wallpaperGet(): { global: string | null };
    voiceSet(patch: unknown): { autoSpeak: boolean; voiceName: string; pitch: number; rate: number; backend: string };
    voiceGet(): { autoSpeak: boolean; voiceName: string; pitch: number; rate: number; backend: string };
    prefSet(patch: unknown): void;
    prefGet(): { capsuleTap: string; voiceTarget: string };
    themeScheduleSet(opts: unknown): { followSystem: boolean; dayThemeId: string | null; nightThemeId: string | null };
    notifySet(patch: unknown): unknown;
    notifyGet(): unknown;
    hwTimelineSet(minutes: number): { minutes: number };
    hwReminderSet(id: string, minutes: number | null): void;
    eventAdd(ev: unknown): Promise<{ uid: string }>;
    eventDelete(uid: string): Promise<void>;
    eventList(): Array<{ uid: string; summary: string; start: number; end: number; allDay?: boolean }>;
    pluginInstalledList(): Promise<Array<{ id: string; name: string; enabled: boolean }>>;
    pluginInstallFromRepo(repo: string, entry?: string): Promise<{ id: string; name: string }>;
    pluginEnableToggle(id: string, on: boolean): Promise<void>;
    pluginUninstall(id: string): Promise<void>;
    themeApply(name: string, vars: unknown): { id: string };
    themeList(): Array<{ id: string; name: string; active: boolean }>;
    themeActivate(id: string | null): void;
    themeDelete(id: string): void;
    phoneWidgetSet(title: string, rows: unknown): { ok: boolean; rows: number };
  };
  kongjian: {
    page(opts?: { spaceId?: string; roomId?: string; date?: string }): Promise<import("@onethu/core").KongjianPage>;
    my(): Promise<import("@onethu/core").KongjianRecord[]>;
    book(bookUrl: string, info_: { name: string; sid: string; tel: string; other: string }): Promise<string>;
    cancel(target: string): Promise<void>;
  };
  /** 清华 GitLab（git.tsinghua.edu.cn）：项目、仓库文件、Issue、合并请求与流水线。
   *  id 为项目数字 id（`projects()` / `search()` 返回元素的 id），iid 为项目内编号
   *  （Issue 与合并请求各自计数，等于网页地址里的那个号）。 */
  /** 临时来访人员报备（visit.tsinghua.edu.cn）：只填充「报备草稿」并把预约页切到该栏；
   *  提交由用户在页面上确认后完成（不受人代劳）。 */
  visit: {
    fill(patch: Record<string, unknown>, opts?: { open?: boolean }): { ok: boolean; opened: boolean; filled: string[] };
  };
  gitlab: {
    /** 我参与的项目（page 从 1 起，每页 50 条） */
    projects(page?: number): Promise<import("@onethu/info-lib").GitProject[]>;
    /** 我星标的项目 */
    starred(page?: number): Promise<import("@onethu/info-lib").GitProject[]>;
    /** 按名称搜索项目 */
    search(search: string, page?: number): Promise<import("@onethu/info-lib").GitProject[]>;
    /** 项目详情 */
    project(id: number): Promise<import("@onethu/info-lib").GitProjectDetail>;
    /** 分支列表（默认分支排在最前） */
    branches(id: number): Promise<import("@onethu/info-lib").GitBranch[]>;
    /** 目录内容：path 传空串表示根目录，ref 传分支名 */
    tree(id: number, path: string, ref: string, page?: number): Promise<import("@onethu/info-lib").GitFile[]>;
    /** 文件正文（sha 取自 tree 返回元素的 id；二进制文件会得到乱码） */
    file(id: number, sha: string): Promise<string>;
    issues(id: number, opts?: { state?: "opened" | "closed" | "all"; search?: string; page?: number }): Promise<import("@onethu/info-lib").GitIssue[]>;
    issue(id: number, iid: number): Promise<import("@onethu/info-lib").GitIssue>;
    /** Issue 评论（含系统动态，`system: true` 的条目为状态变更记录） */
    issueNotes(id: number, iid: number): Promise<import("@onethu/info-lib").GitNote[]>;
    mergeRequests(id: number, opts?: { state?: "opened" | "closed" | "all"; search?: string; page?: number }): Promise<import("@onethu/info-lib").GitMergeRequest[]>;
    mergeRequest(id: number, iid: number): Promise<import("@onethu/info-lib").GitMergeRequest>;
    mergeRequestNotes(id: number, iid: number): Promise<import("@onethu/info-lib").GitNote[]>;
    /** 流水线记录（ref 传分支名，空串为全部） */
    pipelines(id: number, opts?: { ref?: string; page?: number }): Promise<import("@onethu/info-lib").GitPipeline[]>;
    /** 某次流水线的作业 */
    jobs(id: number, pipelineId: number): Promise<import("@onethu/info-lib").GitJob[]>;
    /** 作业日志（纯文本，带 ANSI 颜色码） */
    jobTrace(id: number, jobId: number): Promise<string>;
    /** 新建 Issue（写操作） */
    createIssue(id: number, title: string, description: string): Promise<import("@onethu/info-lib").GitIssue>;
    /** 评论 Issue 或合并请求（写操作） */
    comment(kind: "issue" | "mr", id: number, iid: number, body: string): Promise<import("@onethu/info-lib").GitNote>;
    /** 改写自己已有的评论（写操作；noteId 取自 issueNotes / mergeRequestNotes 的元素 id，
     *  GitLab 只允许作者本人改） */
    updateComment(kind: "issue" | "mr", id: number, iid: number, noteId: number, body: string): Promise<import("@onethu/info-lib").GitNote>;
    /** 讨论（评论线程）：首条评论 + 回复；`individual_note` 为真的讨论只有一条 */
    discussions(kind: "issue" | "mr", id: number, iid: number, page?: number): Promise<import("@onethu/info-lib").GitDiscussion[]>;
    /** 回复某条评论（写操作，附在该讨论末尾） */
    reply(kind: "issue" | "mr", id: number, iid: number, discussionId: string, body: string): Promise<import("@onethu/info-lib").GitNote>;
    /** 删除一条评论（写操作；GitLab 只允许作者本人删） */
    deleteComment(kind: "issue" | "mr", id: number, iid: number, discussionId: string, noteId: number): Promise<void>;
    /** 解决 / 重新打开整个讨论（写操作；GitLab 网页上评论右侧那个 Resolve） */
    resolveDiscussion(kind: "issue" | "mr", id: number, iid: number, discussionId: string, resolved: boolean): Promise<void>;
    /** 指派（写操作；userIds 传空数组取消全部指派） */
    assignees(kind: "issue" | "mr", id: number, iid: number, userIds: number[]): Promise<void>;
    /** 议题 / 合并请求的条数（服务端 x-total：进行中 / 已关闭 / 全部） */
    requestCounts(kind: "issue" | "mr", id: number): Promise<{ opened: number; closed: number; all: number }>;
    /** 表情回应（award emoji）：挂在议题 / 合并请求本体，或挂在某条评论上（传 noteId） */
    awards(kind: "issue" | "mr", id: number, iid: number, noteId?: number): Promise<import("@onethu/info-lib").GitAward[]>;
    /** 贴一个表情回应（写操作；name 取 thumbsup / thumbsdown / laugh / hooray / confused / heart / eyes / rocket） */
    react(kind: "issue" | "mr", id: number, iid: number, name: string, noteId?: number): Promise<import("@onethu/info-lib").GitAward>;
    /** 取消某个表情回应（写操作；awardId 取自 awards 元素的 id） */
    unreact(kind: "issue" | "mr", id: number, iid: number, awardId: number, noteId?: number): Promise<void>;
    /** 合并请求的文件变更与差异 */
    mergeRequestChanges(id: number, iid: number): Promise<import("@onethu/info-lib").GitMergeRequestChanges>;
    /** 新建合并请求（写操作；源分支与目标分支不能相同） */
    createMergeRequest(id: number, sourceBranch: string, targetBranch: string, title: string, description: string): Promise<import("@onethu/info-lib").GitMergeRequest>;
    /** 合入合并请求（写操作；不代删源分支、不改提交信息） */
    mergeMergeRequest(id: number, iid: number): Promise<import("@onethu/info-lib").GitMergeRequest>;
    /** 关闭或重新打开（写操作；kind 取 "issue" 或 "mr"，state 取 "close" 或 "reopen"） */
    setState(kind: "issue" | "mr", id: number, iid: number, state: "close" | "reopen"): Promise<void>;
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
    go(page: string, params?: Record<string, unknown>): boolean;
    /** 按关键词检索全应用可跳转原子（功能页面 / 今日组件 / 本机已见过的课程·作业·通知·
     *  在线服务等）。只查静态注册表 + 本机缓存，**绝不发起校园请求**；
     *  与 nav.openAtom 配对即「一句话直达」。需 nav 权限 */
    searchAtoms(query: string, limit?: number): Promise<Array<{ kind: string; key: string; title: string; sub?: string; group: string }>>;
    /** 检索行级直达（2026-10-12 task-22）：routeId 或 query → searchRows 注册表唯一命中 →
     *  与检索条点行完全同链（goSearchRow：家族 → OH 档位/插件视图 → 行滚动高亮）。
     *  查无 → { ok:false, reason }，调用方（OH）应改口复述而不是硬猜。需 nav 权限 */
    searchRow(ref: { routeId?: string; query?: string }): Promise<{ ok: boolean; id?: string; title?: string; breadcrumb?: string[]; landedOn?: string; note?: string; reason?: string; candidates?: Array<{ id: string; title: string }> }>;
    /** 检索行路由表（searchRows 唯一真源的只读投影，routes.json 同形）——
     *  给 Rust 侧 ui_navigate 做本地匹配与缓存兜底。需 nav 权限 */
    routeTable(): Promise<Array<{ id: string; title: string; desc: string; aliases: string[]; breadcrumb: string[]; kind: string; tier: string; view: string; tab: string; section: string; note: string }>>;
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
  ws: {
    /** 打开外部 WebSocket（宿主 Rust 桥；需 ws:external 权限）。返回 sessionId。
     *  头部可注入 Origin 等任意握手头（宿主无跨源限制）。10 分钟空闲会被宿主自动清扫；每插件并发上限 8。 */
    open(url: string, opts?: { headers?: Record<string, string>; connectTimeoutMs?: number }): Promise<string>;
    /** 发一帧：text=文本帧；b64=二进制帧（base64） */
    send(session: string, data: string, encoding?: "text" | "b64"): Promise<void>;
    /** 拉一帧（阻塞至超时）。kind: "text"|"binary"|"closed"；超时抛「recv 超时」。 */
    recv(session: string, timeoutMs?: number): Promise<{ kind: "text" | "binary" | "closed"; text?: string; b64?: string } | null>;
    /** 关闭一条会话 */
    close(session: string): Promise<void>;
    /** 清空本插件全部会话（停用/卸载自动调用；也可插件自选提前清） */
    closeAll(): Promise<void>;
  };
  plugins: {
    /** 列出已启用 JS 插件及其命令（联动插件工具发现）。需 plugins:call 权限 */
    list(): Promise<Array<{ pluginId: string; pluginName: string; commands: Array<{ id: string; title: string; inputLabel?: string; agentHint?: string }> }>>;
    /** 执行已启用插件的命令（高危：命令可能含写操作，由插件内部两段确认兜底）。需 plugins:call 权限 */
    call(pluginId: string, cmdId: string, input?: string): Promise<unknown>;
    /** OH Harness 获取当前时机命中的插件提示；宿主完成筛选/限流。 */
    agentHints(input: import("./agentHints.js").AgentHintRequest): Promise<import("./agentHints.js").SelectedAgentHint[]>;
  };
  /** 极客模式：浏览器探索（桌面 Only；能力最小面） */
  browser: {
    probe(): Promise<unknown>;
    launch(mode: string): Promise<unknown>;
    navigate(url: string): Promise<void>;
    eval(js: string): Promise<unknown>;
    snapshot(): Promise<unknown>;
    close(): Promise<unknown>;
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
  yuketang: {
    /** 雨课堂 / Rain Classroom 登录配置状态与扫码入口，不返回 Cookie。 */
    status(): Promise<unknown>;
    /** 雨课堂全部课程，含课堂 id、名称、教师；供后续内容查询定位。 */
    courses(): Promise<unknown>;
    /** 雨课堂 / Rain Classroom 全部可获取内容目录：课件、视频、作业、试卷、公告等；可按课堂筛选。 */
    contents(classroomId?: string): Promise<unknown>;
    /** 雨课堂作业与截止／提交状态：保留既往作业，未来截止默认30天以内，days 可扩展到3660。 */
    homework(classroomId?: string, days?: number): Promise<unknown>;
    /** 雨课堂作业题目与已有作答详情；参数取自 homework/contents，不提交作业。 */
    homeworkDetail(classroomId: string, leafTypeId: string): Promise<unknown>;
    /** 雨课堂课件／视频／图文详情；参数取自 contents。 */
    leafDetail(classroomId: string, leafId: string): Promise<unknown>;
    /** 雨课堂公告正文；noticeIds 取自 contents 的 noticeIdCandidates 或 noticeId。 */
    noticeDetail(classroomId: string, noticeIds: string[]): Promise<unknown>;
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
  /** 公告热通道（manifest.announce 启用；notice.digest 变化视为新公告；宿主负责拉取与展示） */
  notice?: { digest: string; at: number; text: string };
}

/** 权限不足时抛出 */
export class PluginPermissionError extends Error {
  constructor(permission: string, what: string) {
    super(i18n("plugins.types.0a267e07b231", { permission: permission, action: what }));
  }
}
