/** 应用全局状态：登录（含 2FA）→ 会话 → 轻路由 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as clients from "../lib/clients.js";
import { explainNetworkError } from "../lib/transport.js";
import type { TwoFactorMethod } from "@onethu/core";

/** 轻路由：一级页（含选课系统 zhjwxk）+ 网络学堂子页（learnX 移植） */
export type Page =
  | "today"
  | "learn"
  | "schedule"
  | "otherinfo" // 其他 Info 应用（门户原始应用导航的功能化重排，静态目录 + 内嵌尝试）
  | "info" // 信息门户聚合页（成绩 / 考试 / 新闻 / 个人信息）
  | "life" // 生活聚合页（宿舍电费/订水 · 洗衣机 · 校园卡）
  | "reserve" // 预约（图书馆座位；游泳/健身房等场馆陆续接入）
  | "zhjwxk" // 选课系统（已选课程 / 候补队列；不可拆分原子）
  | "folder" // 用户收藏夹页（navParams.folderId 指向具体收藏夹）
  | "settings"
  | "learn-course" // 课程详情（courseId）
  | "learn-assignments" // 全部作业
  | "learn-notices" // 全部通知
  | "learn-files" // 全部文件
  | "learn-search" // 全局搜索
  | "learn-semester" // 学期切换
  | "learn-assignment-detail" // 作业只读详情（courseId+itemId）
  | "learn-notice-detail" // 通知只读详情（courseId+itemId）
  | "learn-forum-thread" // 讨论区话题阅读/回复（courseId+threadId）
  | "learn-file-detail"; // 文件详情（courseId+itemId）

/** 子页导航参数：详情页按 id 在已缓存数据中查找实体 */
export interface LearnNav {
  courseId?: string;
  itemId?: string;
  /** 讨论区：话题所属板块 id（viewTlById 原生链接必带 tabbh+bqid，缺失会被甩登录壳页） */
  bqid?: string;
  /** 课程详情「各回各家」：三级页返回时携带的目标 tab（notices/assignments/files/groups/forum），
   *  课程页挂载时据此初始化 tab，而不是恒落第一个 */
  courseTab?: string;
  /** 详情页返回目标（默认对应列表页） */
  from?: Page;
  /** 学期切换显式携带：learn 列表页据此校验数据学期一致（防缓存/竞态残留旧学期） */
  semesterId?: string;
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
  lifeTab?: "dorm" | "washer" | "hygiene" | "card" | "invoice" | "payroll" | "gradincome" | "network";
  reserveTab?: "lib" | "room" | "classroom" | "sports" | "kongjian";
  /* ═══ 实体原子深链（万物原子化）：跳进 tab 后自动选中/高亮特定实体 ═══
     仅作挂载/数据就绪后的自动落点，页内手动切换不回写；不带参数行为与旧版一致。 */
  /** 洗衣机：自动选中的楼栋 id（washer tab 楼栋下拉） */
  washerBuildingId?: string;
  /** 楼栋展示名兜底（原子 key 里自带，列表未就绪时也能显示） */
  washerBuildingName?: string;
  /** 楼栋是否海乐生活点位（key 自带） */
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

const TOP_PAGES = ["today", "learn", "schedule", "info", "life", "reserve", "zhjwxk", "folder", "settings"] as const;

/** 子页归属的一级页（侧栏高亮 / hash 用） */
export function topLevelPage(p: Page): Page {
  return (TOP_PAGES as readonly string[]).includes(p) ? p : "learn";
}

export type SessionStatus = "booting" | "logged-out" | "connecting" | "2fa" | "ready" | "demo";

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
  enterDemo: () => void;
  backToLogin: () => void;
  logout: () => Promise<void>;
  dismissError: () => void;
}

import { Ctx } from "./context.js";

function pageFromHash(): Page {
  const h = location.hash.replace(/^#\/?/, "");
  return (TOP_PAGES as readonly string[]).includes(h) ? (h as Page) : "today";
}

/** hash → 收藏夹页参数（#/folder/<id>；无 id 或 id 形态不对返回 null） */
function folderParamsFromHash(): LearnNav | null {
  const h = location.hash.replace(/^#\/?/, "");
  const m = /^folder\/(f_[A-Za-z0-9_]+)$/.exec(h);
  return m ? { folderId: m[1] } : null;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("booting");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [page, setPage] = useState<Page>(pageFromHash);
  const [navParams, setNavParams] = useState<LearnNav | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [twoFactor, setTwoFactor] = useState<AppState["twoFactor"]>(null);
  /** navigate 自身写入的 hash：它触发的 hashchange 必须忽略，否则跨一级页进子页
   *  （如 今日 → 作业详情，hash #/today → #/learn）时异步回调会把刚设置的
   *  page/navParams 冲回顶层列表页 + 空参——详情页"闪回列表/空白"的根源。 */
  const selfNavHashRef = useRef<string | null>(null);

  useEffect(() => {
    const onHash = (ev: HashChangeEvent) => {
      // 用事件自带的 newURL 对账：只忽略"确实是 navigate 写入的那个 hash"的事件；
      // 连续两次导航时，先到的旧事件 newURL 与最新目标不符，也不会误伤最新状态
      const target = (() => {
        try {
          return new URL(ev.newURL).hash;
        } catch {
          return location.hash;
        }
      })();
      if (selfNavHashRef.current !== null && target === selfNavHashRef.current) {
        selfNavHashRef.current = null; // 自身导航触发的 hashchange：状态已由 navigate 设定
        return;
      }
      const fp = folderParamsFromHash();
      setPage(fp ? "folder" : pageFromHash());
      setNavParams(fp);
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let ok = false;
      try {
        ok = await clients.resumeSession();
      } catch {
        ok = false;
      }
      if (cancelled) return;
      if (ok) {
        const saved = await clients.store.loadSession();
        setUser({ username: saved?.username ?? "" });
        setStatus("ready");
        return;
      }
      // 恢复失败（learn/id 会话过期是常态）且勾选了记住密码 → 静默重登一次，免输密码
      const silent = await clients.trySilentRelogin().catch(() => false);
      if (cancelled) return;
      if (silent) {
        const saved = await clients.store.loadSession();
        setUser({ username: saved?.username ?? "" });
        setStatus("ready");
      } else {
        setStatus("logged-out");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const navigate = useCallback((p: Page, params?: LearnNav) => {
    // hash 只承载一级页：子页刷新后落回所属入口，避免丢参数的死链；
    // 记录本次写入，onHash 对自身触发的 hashchange 直接忽略（见 selfNavHashRef）。
    // hash 本就相同时没有新事件，但此前可能仍有同目标旧事件挂起——保留对账标记等它到达。
    const h = p === "folder" && params?.folderId ? `#/folder/${params.folderId}` : `#/${topLevelPage(p)}`;
    if (location.hash === h) {
      if (selfNavHashRef.current !== h) selfNavHashRef.current = null;
    } else {
      selfNavHashRef.current = h;
      location.hash = h;
    }
    setPage(p);
    setNavParams(params ?? null);
  }, []);

  const login = useCallback(
    async (username: string, password: string, remember = true) => {
      setStatus("connecting");
      setError(null);
      try {
        const result = await clients.login(username, password, { remember });
        if (result.state === "need-2fa") {
          setTwoFactor({ username, password, methods: result.methods });
          setStatus("2fa");
          return;
        }
        setUser({ username });
        setStatus("ready");
        navigate("today");
      } catch (err) {
        setStatus("logged-out");
        setError(explainNetworkError(err));
      }
    },
    [navigate],
  );

  const send2FA = useCallback(async (type: string) => {
    await clients.send2FA(type);
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
          navigate("today");
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
        navigate("today");
      } catch (err) {
        setError(explainNetworkError(err));
      }
    },
    [twoFactor, navigate],
  );

  const backToLogin = useCallback(() => {
    setTwoFactor(null);
    setError(null);
    setStatus("logged-out");
  }, []);

  const enterDemo = useCallback(() => {
    setUser({ username: "demo", displayName: "演示账户" });
    setStatus("demo");
    navigate("today");
  }, [navigate]);

  const logout = useCallback(async () => {
    await clients.logout();
    setUser(null);
    setTwoFactor(null);
    setStatus("logged-out");
    navigate("today");
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
      enterDemo,
      backToLogin,
      logout,
      dismissError: () => setError(null),
    }),
    [status, user, page, navParams, error, twoFactor, navigate, login, submit2FA, send2FA, sendLearn2FA, enterDemo, backToLogin, logout],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

