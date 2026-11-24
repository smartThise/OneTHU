import { t as i18n, useLocale as useUiLocale } from "../i18n/index.js";
/** 应用全局状态：登录（含 2FA）→ 会话 → 轻路由 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import * as clients from "../lib/clients.js";
import { explainNetworkError, formatNetworkError } from "../lib/transport.js";
import type { TwoFactorMethod } from "@onethu/core";

/** 轻路由：一级页（含选课系统 zhjwxk）+ 网络学堂子页（learnX 移植） */
export type Page =
  | "homepage"
  | "learn"
  | "schedule"
  | "trace" // 寻迹：今日日程地图（POI 标注 + ETA + 前往导航）
  | "otherinfo" // 其他 Info 应用（门户原始应用导航的功能化重排，静态目录 + 内嵌尝试）
  | "info" // 信息门户聚合页（成绩 / 考试 / 新闻 / 个人信息）
  | "life" // 生活聚合页（宿舍电费/订水 · 洗衣机 · 校园卡）
  | "reserve" // 预约（图书馆座位；游泳/健身房等场馆陆续接入）
  | "zhjwxk" // 选课系统（已选课程 / 候补队列；不可拆分原子）
  | "thos" // 在线服务（THOS 服务大厅原生化：事项列表 + 服务目录）
  | "mail" // 邮箱（IMAP 收 / SMTP 发，复用云日历凭据）
  | "cloud" // 清华云盘（Seafile Web API）
  | "gitlab" // 清华 GitLab（git.tsinghua.edu.cn REST API v4）
  | "thubook" // THUBook（清华手册 thubook.help 内嵌阅读器 + OH 工具）
  | "xiaoda" // 清小搭（校园 AI 学伴；实验性第三方复刻页，纯 OneGUI）
  | "folder" // 用户收藏夹页（navParams.folderId 指向具体收藏夹）
  | "tasks" // 待办聚合页（UI/UX 改造 §2.2 M1：作业+预约+考试+余额的"今天该管的事"）
  | "services" // 服务分组目录页（UI/UX 改造 §2.2 M1：底部导航「服务」直达）
  | "favs" // 收藏首页（UI/UX 改造 §2.2 M1：底部导航「收藏」直达，根收藏夹列表）
  | "settings"
  | "plugins" // 旧插件页路由：§4.4b 起并进设置页，进来即跳「设置 → 插件」
  | "learn-course" // 课程详情（courseId）
  | "learn-assignments" // 全部作业
  | "learn-notices" // 全部通知
  | "learn-files" // 全部文件
  | "learn-search" // 全局搜索
  | "learn-semester" // 学期切换
  | "learn-assignment-detail" // 作业只读详情（courseId+itemId）
  | "learn-notice-detail" // 通知只读详情（courseId+itemId）
  | "learn-forum-thread" // 讨论区话题阅读/回复（courseId+threadId）
  | "learn-file-detail" // 文件详情（courseId+itemId）
  | `plugin:${string}` // 插件动态 tab（plugins/tabs.ts 注册表；pageKey = plugin:<pluginId>:<tabId>）
  | "learn-ykt-detail" // R20-B2：雨课堂作业原生详情（只读；navParams.ykt 必带）
  | "learn-ykt-course" // R25：雨课堂课程内容页（该课全部内容；navParams.extCourseId 缺省取最近打开的课程）
  /* 白板（霖的原子收藏升级）：boards = 收藏夹列表页，board = 某一块白板 */
  | "boards"
  | "board"
  | "contacts"
  | "org" // 组织主页（成员邮箱 / 资料库 / GitLab 仓库；navParams.orgId）
  | "vault"; // 暂存箱（万物皆可收纳；Phase 1：混合对象清单 + 分享口令）

/** 返回目标：页内返回键（BackButton）与顶栏返回键共用同一条数据 */
export interface BackTarget {
  to: Page;
  label?: string;
  params?: LearnNav;
}

/** 子页导航参数：详情页按 id 在已缓存数据中查找实体 */
export interface LearnNav {
  /** 通讯录内的组织直达入口。 */
  section?: "cards" | "friends" | "orgs";
  /** 组织主页：org id（page=org 时必带） */
  orgId?: string;
  traceTarget?: {title:string;location:string;date?:string;startTime?:string;endTime?:string};
  courseId?: string;
  itemId?: string;
  /** R20-B2：雨课堂作业原生详情页（learn-ykt-detail）参数（必带） */
  ykt?: YktNav;
  /** 雨课堂课程筛选（全部作业页）：携带 classroom_id 时只列该课程的作业与试卷；
   *  extCourseName 仅作文案兜底（课程数据未就绪时也能说明「正在看哪门课」）。 */
  extCourseId?: string;
  extCourseName?: string;
  /** 讨论区：话题所属板块 id（viewTlById 原生链接必带 tabbh+bqid，缺失会被甩登录壳页） */
  bqid?: string;
  /** 讨论区板块直达（板块原子深链）：课程详情落 forum tab 且 BbsPanel 初始选中该板块 */
  bbsBoard?: string;
  /** 课程详情「各回各家」：三级页返回时携带的目标 tab（notices/assignments/files/groups/forum），
   *  课程页挂载时据此初始化 tab，而不是恒落第一个 */
  courseTab?: string;
  /** 详情页返回目标（默认对应列表页） */
  from?: Page;
  /** 学期切换显式携带：learn 列表页据此校验数据学期一致（防缓存/竞态残留旧学期） */
  semesterId?: string;
  /** 云盘直达资料库：进入云盘页时自动打开该库（原子深链） */
  cloudRepo?: string;
  /** Optional folder within an authenticated shared library. */
  cloudPath?: string;
  /** GitLab 直达项目（原子深链） */
  gitlabProject?: number;
  /** GitLab 项目内页签（缺省 code） */
  gitlabTab?: "code" | "issues" | "mrs" | "pipelines";
  /** GitLab 实体深链：kind 指明页签归属，iid 为 Issue 或合并请求的内部编号 */
  gitlabKind?: "issue" | "mr";
  gitlabIid?: number;
  /** 网络学堂首页直达 DDL 提醒设置：携带 true 时「DDL 提醒」卡自动弹开设置层（原子深链） */
  learnOpenHwRemind?: boolean;
  /** 邮箱页直达写信：携带 true 时挂载即弹写信层（原子深链） */
  mailCompose?: boolean;
  /** 邮件实体原子深链：落在该文件夹并直接打开这封（收藏夹/原子点击用） */
  mailFolder?: string;
  mailUid?: number;
  /** 信息页新闻直达：携带 xxid 时 InfoPage 初始落在新闻 tab，并把该条新闻打开详情。
   *  不带此参数时 InfoPage 行为与旧版完全一致（默认成绩 tab）。 */
  infoNewsId?: string;
  /** 信息页新闻搜索直达：携带关键词时 InfoPage 落在新闻 tab 并以此词立即触发搜索（选课·外校课卡片「查通知」用） */
  infoNewsQuery?: string;
  /** 聚合页初始子栏（首页入口化直达）：各聚合页 segmented 的初始 tab。
   *  仅作挂载初始落点 / 已挂载时的直达落点，页内切换不回写；不带对应参数时
   *  各页保持原默认（info=成绩 / life=宿舍 / reserve=图书馆座位）。
   *  reserveTab 的 "lib"/"room"/"classroom"/"sports" 分别对应 ReservePage 页内 library/libroom/classroom/sports 栏。 */
  infoTab?: "report" | "fitness" | "exams" | "evaluation" | "calendar" | "news" | "profile" | "courseinfo";
  lifeTab?: "elec" | "water" | "washer" | "hygiene" | "card" | "invoice" | "payroll" | "gradincome" | "network";
  reserveTab?: "lib" | "room" | "classroom" | "sports" | "kongjian" | "visit";
  /* ═══ 实体原子深链（万物原子化）：跳进 tab 后自动选中/高亮特定实体 ═══
     仅作挂载/数据就绪后的自动落点，页内手动切换不回写；不带参数行为与旧版一致。 */
  /** 洗衣机：自动选中的楼栋 id（washer tab 楼栋下拉） */
  washerBuildingId?: string;
  /** 楼栋展示名兜底（原子 key 里自带，列表未就绪时也能显示） */
  washerBuildingName?: string;
  /** 楼栋是否海乐生活点位（key 自带） */
  /** 洗衣机楼栋所属数据源（"0" 捷利 / "1" 海乐生活 / "2" 小兰智慧）；缺省按捷利 */
  washerBuildingProvider?: string;
  /** @deprecated 旧深链只带布尔（true = 海乐生活）：保留读取，新的都走 washerBuildingProvider */
  washerBuildingHlsh?: boolean;
  /** 洗衣机：楼内要高亮滚动的设备名 */
  washerMachine?: string;
  /** 空教室：自动选中的教学楼（searchName） */
  classroomBuilding?: string;
  /** 教学楼展示名兜底 */
  classroomBuildingName?: string;
  /** 空教室：要高亮滚动的教室名 */
  classroomRoom?: string;
  /** 体育：自动选中的场馆 scene uuid（VenueScene.uuid） */
  sportsScene?: string;
  /** 研讨间：自动选中的类型 kindId */
  libroomKind?: number;
  /** 图书馆：自动选中的馆 libId */
  libraryId?: number;
  /** 图书馆：自动选中的楼层/区域 id（楼层就绪后选楼层，区域随楼层链路就绪后选区域） */
  libraryFloorId?: number;
  librarySectionId?: number;
  /** 宿舍页：深链定位区块（ele=电费 / water=订水，滚动+高亮） */
  dormSection?: "ele" | "water";
  /** 新闻：订阅动态栏预选的订阅源名（匹配条件 label 后切 seg+chip） */
  newsSubSource?: string;
  /** 公共空间：自动选中的空间/房间 id（页面就绪后依次 pickSpace → pickRoom） */
  kongjianSpace?: string;
  kongjianRoom?: string;
  /** 用户收藏夹页：folder id（page=folder 时必带） */
  folderId?: string;
}

const TOP_PAGES = ["homepage", "learn", "schedule", "trace", "mail", "cloud", "gitlab", "thubook", "xiaoda", "info", "life", "reserve", "zhjwxk", "thos", "otherinfo", "plugins", "folder", "settings", "services", "favs", "tasks", "boards", "board", "vault", "contacts", "org"] as const; // boards/board：白板列表与单块白板（2026-10-15 补：漏了它们 → topLevelPage 兜到 learn，白板标签的 hash 写成 #/learn、深链也恢复不回来） // services/favs：M1 新 IA 底栏直达页（漏过会落到 learn 兜底） // trace/otherinfo 各漏过一次：不加的话侧栏/标题/hash 全落到 learn 兜底

/**
 * R20-B2：雨课堂作业原生详情页参数。
 * 拉取参数（leafTypeId+classroomId）来自列表行的 core R20-B2 透出字段；
 * 其余为列表行已知信息，仅作「详情未回来时」的头部兜底（详情回来后以详情数据为准）。
 */
export interface YktNav {
  /** get_exercise_list 的 leaf_type_id（core getExerciseDetail 第一参；缺失页面渲染参数缺失错误态） */
  leafTypeId: string;
  /** classroom_id（core getExerciseDetail 第二参） */
  classroomId: string;
  /** 官方网页直链（「浏览器打开」备用出口，R20-A 分流不变；可空） */
  externalUrl?: string;
  /** 作业名（列表行 title；详情 name 覆盖） */
  title?: string;
  /** 截止时间 "YYYY-MM-DD HH:MM"（列表行 deadline；详情响应无整卷截止字段，恒用列表值） */
  deadline?: string;
  /** 课程名（列表行 courseName） */
  courseName?: string;
  /** 作业类型（列表行 kind；exam=试卷 —— 红线：试卷页同样不渲染任何提交相关入口） */
  kind?: "homework" | "exam" | "quiz";
  /** R29：从**网络学堂课程页**进来的雨课堂作业——返回时带回该课程 id，
   *  否则详情页返回会因缺 courseId 渲染成空页（课程页合并后新增的返回路径）。 */
  fromCourseId?: string;
}

/** 子页归属的一级页（侧栏高亮 / hash 用）；插件动态 tab（plugin:<id>:<tabId>）保持原值直通 */
export function topLevelPage(p: Page): Page {
  if (p.startsWith("plugin:")) return p;
  return (TOP_PAGES as readonly string[]).includes(p) ? p : "learn";
}

export type SessionStatus = "booting" | "logged-out" | "connecting" | "2fa" | "ready";

export interface SessionUser {
  username: string;
  displayName?: string;
}

export interface AppState {
  status: SessionStatus;
  user: SessionUser | null;
  page: Page;
  /** 子页导航参数（learn-course 的 courseId、详情页的 itemId） */
  navParams: LearnNav | null;
  error: string | null;
  /** 2FA 上下文 */
  twoFactor: {
    username: string;
    password: string;
    methods: TwoFactorMethod[];
    /** 1=统一认证验证；2=网络学堂验证（极少触发） */
    round?: number;
  } | null;
  navigate: (page: Page, params?: LearnNav) => void;
  login: (username: string, password: string, remember?: boolean) => Promise<void>;
  submit2FA: (type: string, code: string, trust: boolean) => Promise<void>;
  send2FA: (type: string) => Promise<void>;
  sendLearn2FA: (type: string) => Promise<void>;
  backToLogin: () => void;
  logout: () => Promise<void>;
  dismissError: () => void;
}

import { Ctx } from "./context.js";
import { activeTab, explorerNavigate, subscribeExplorer, type ExplorerTab } from "./explorer.js";

/** dev 视觉自检（?explorer-preview=…）：跳过登录直进 Shell，供无头截图审样式 */
const PREVIEW_MODE = typeof window !== "undefined" && import.meta.env.DEV && new URLSearchParams(window.location.search).has("explorer-preview");
/* 视觉自检：模块期写导览完成标记——晚于任何组件挂载就输（OnboardingTourV3 挂载即读） */
if (PREVIEW_MODE) {
  try {
    localStorage.setItem("onethu.onboarded.flow3", "1");
    localStorage.setItem("onethu.onboarding.flow", "v3");
    localStorage.setItem("onethu.home.coach.v1", "done");
  } catch { /* 忽略 */ }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const uiLocale = useUiLocale();

  const [status, setStatus] = useState<SessionStatus>("booting");
  const [user, setUser] = useState<SessionUser | null>(null);
  // Keep the cause until render so changing language also updates an existing
  // application error. School-provided error details still pass through as-is.
  const [errorCause, setErrorCause] = useState<unknown>(null);
  const setError = useCallback((cause: unknown) => {
    if (cause !== null) explainNetworkError(cause);
    setErrorCause(cause);
  }, []);
  const error = errorCause === null ? null : formatNetworkError(errorCause);
  const [twoFactor, setTwoFactor] = useState<AppState["twoFactor"]>(null);
  const loginBusy = useRef(false);
  const authActionVersion = useRef(0);
  /* dev-explorer：page/navParams 不再是本地状态——直接派生自 explorer 活动标签页
     （订阅同一份 store）；navigate = explorer 语义（首页内开新标签页 / 页标签内导航 /
     设置类走浮层）。全库 useApp() 调用点零改动。 */
  const active: ExplorerTab | null = useSyncExternalStore(subscribeExplorer, () => activeTab(), () => activeTab());
  const page: Page = active.page;
  const navParams: LearnNav | null = active.params;

  useEffect(() => {
    if (PREVIEW_MODE) return;
    let stopped = false, busy = false;
    const refresh = async () => {
      if (busy || loginBusy.current) return;
      busy = true;
      const action = authActionVersion.current;
      try {
        const result = await clients.refreshSharedSession(() => {
          if (!stopped && action === authActionVersion.current) { setUser(null); setTwoFactor(null); setStatus("connecting"); }
        });
        if (!result || stopped || action !== authActionVersion.current) return;
        authActionVersion.current++;
        setTwoFactor(null);
        if (result.kind === "ready") { setUser({ username: result.username }); setStatus("ready"); setError(null); }
        else if (result.kind === "unavailable") { setUser(result.username ? { username: result.username } : null); setStatus(result.username ? "ready" : "logged-out"); setError(result.error); }
        else { setUser(null); setStatus("logged-out"); setError(null); }
      } catch (error) {
        // Leave the current page usable on a daemon outage; task settings also
        // show the connection failure, and no local scheduler is substituted.
        if (!stopped) setError(error);
      } finally { busy = false; }
    };
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    const timer = setInterval(onFocus, 15_000);
    return () => { stopped = true; clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [setError]);

  useEffect(() => {
    console.log("[explorer-preview] PREVIEW_MODE=", PREVIEW_MODE, "search=", window.location.search, "DEV=", import.meta.env?.DEV);
    if (PREVIEW_MODE) {
      setUser({ username: "preview" });
      setStatus("ready");
      return;
    }
    void import("../lib/clients.js").then(({ logLine }) => logLine("PROBE boot-effect")).catch(() => undefined);
    let cancelled = false;
    const actionVersion = authActionVersion.current;
    const ownsBoot = () => !cancelled && actionVersion === authActionVersion.current;
    const applyOutcome = async (outcome: clients.BootResumeOutcome): Promise<void> => {
      if (!ownsBoot()) return;
      if (outcome.kind === "ready") {
        setUser({ username: outcome.username });
        setStatus("ready");
        return;
      }
      if (outcome.kind === "unavailable") {
        // Keep the previous account's local view while its service is unavailable.
        // No saved account means the login screen remains available with the cause.
        setUser(outcome.username ? { username: outcome.username } : null);
        setStatus(outcome.username ? "ready" : "logged-out");
        if (!outcome.username) setError(outcome.error);
        return;
      }
      // Only confirmed missing authentication can submit remembered credentials.
      // A late 401 after the boot deadline also leaves the temporary cached view.
      setUser(null);
      setStatus("connecting");
      const TS = Date.now();
      type SilentResult = Awaited<ReturnType<typeof clients.trySilentRelogin>>;
      const silentResult: SilentResult = await Promise.race([
        clients.trySilentRelogin().catch((): SilentResult => ({ ok: false })),
        new Promise<SilentResult>((res) => setTimeout(() => res({ ok: false }), 15_000)),
      ]);
      const silent = silentResult.ok === true;
      void import("../lib/clients.js").then(({ logLine }) =>
        logLine(`BOOT-T trySilentRelogin(${silent ? i18n("state.app.053461ce86d2") : i18n("state.app.28384d7afd2e")}) +${Date.now() - TS}ms`),
      ).catch(() => undefined);
      if (!ownsBoot()) return;
      if (silent) {
        setUser({ username: clients.session.username });
        setStatus("ready");
      } else if (silentResult.twoFactor) {
        // 静默重登撞 2FA：直接弹 2FA 界面（凭据已在链上）——否则登录链停在
        // 半路成僵尸，用户手点「登录」只会 await 僵尸（Login timeout 实录）
        setTwoFactor({
          username: silentResult.twoFactor.username,
          password: silentResult.twoFactor.password,
          methods: silentResult.twoFactor.methods,
        });
        setStatus("2fa");
      } else {
        setStatus("logged-out");
      }
    };
    void (async () => {
      const { outcome, settlement } = await clients.resumeSessionForBoot();
      await applyOutcome(outcome);
      // Timeout ends the spinner; it does not abandon the original probe or
      // start a second password login alongside it.
      if (settlement) void settlement.then(applyOutcome);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 导航（dev-explorer 语义，详见 explorer.ts explorerNavigate） */
  const navigate = explorerNavigate;

  const login = useCallback(
    async (username: string, password: string, remember = true) => {
      if (loginBusy.current) return;
      authActionVersion.current++;
      loginBusy.current = true;
      void clients.logLine("AUTH-PHASE submit");
      setStatus("connecting");
      setError(null);
      const finish = (r: Awaited<ReturnType<typeof clients.login>>): void => {
        void clients.logLine(`AUTH-PHASE result=${r.state}`);
        if (r.state === "need-2fa") {
          setTwoFactor({ username, password, methods: r.methods });
          setStatus("2fa");
          return;
        }
        setUser({ username });
        setStatus("ready");
        navigate("homepage");
      };
      try {
        const result = await clients.login(username, password, { remember });
        finish(result);
      } catch (err) {
        // Do not replay credentials for bad passwords, throttling or unknown pages.
        setStatus("logged-out");
        setError(err);
      } finally {
        loginBusy.current = false;
      }
    },
    [navigate],
  );

  const send2FA = useCallback(async (type: string) => {
    setError(null);
    try { await clients.send2FA(type); }
    catch (err) { setError(err); throw err; }
  }, []);

  const sendLearn2FA = useCallback(async (type: string) => {
    await clients.sendLearn2FA(type);
  }, []);

  const submit2FA = useCallback(
    async (type: string, code: string, trust: boolean) => {
      if (!twoFactor) return;
      setError(null);
      const round = twoFactor.round ?? 1;
      try {
        if (round === 2) {
          await clients.verifyLearn2FA(code);
          setTwoFactor(null);
          setUser({ username: twoFactor.username });
          setStatus("ready");
          navigate("homepage");
          return;
        }
        const round2 = await clients.verify2FA(type, code, trust);
        if (round2) {
          // learn 需要第二轮验证（极少数情况：服务端策略无视既有会话）
          setTwoFactor({ ...twoFactor, round: 2, methods: round2 });
          return;
        }
        setTwoFactor(null);
        setUser({ username: twoFactor.username });
        setStatus("ready");
        navigate("homepage");
      } catch (err) {
        setError(err);
      }
    },
    [twoFactor, navigate],
  );

  const backToLogin = useCallback(async () => {
    if (PREVIEW_MODE) return; // 视觉自检：数据 effect 的「会话过期」误登出在无后端预览里必触发，屏蔽
    authActionVersion.current++;
    const { libAbandonLogin } = await import("../lib/infoLib.js");
    await libAbandonLogin();
    setTwoFactor(null);
    setError(null);
    setStatus("logged-out");
  }, []);

  const logout = useCallback(async () => {
    authActionVersion.current++;
    try {
      await clients.logout();
      setError(null);
    } catch (error) {
      setError(error);
    } finally {
      setUser(null);
      setTwoFactor(null);
      setStatus("logged-out");
      navigate("homepage");
    }
  }, [navigate]);

  const value = useMemo<AppState>(
    () => ({
      status,
      user,
      page,
      navParams,
      error,
      twoFactor,
      navigate,
      login,
      submit2FA,
      send2FA,
      sendLearn2FA,
      backToLogin,
      logout,
      dismissError: () => setError(null),
    }),
    [uiLocale, status, user, page, navParams, error, twoFactor, login, submit2FA, send2FA, sendLearn2FA, backToLogin, logout],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

