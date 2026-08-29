/** 应用全局状态：登录（含 2FA）→ 会话 → 轻路由 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import * as clients from "../lib/clients.js";
import { explainNetworkError } from "../lib/transport.js";
import type { TwoFactorMethod } from "@onethu/core";

/** 轻路由：一级页（含选课系统 zhjwxk）+ 网络学堂子页（learnX 移植） */
export type Page =
  | "today"
  | "learn"
  | "schedule"
  | "info" // 信息门户聚合页（成绩 / 考试 / 新闻 / 个人信息）
  | "life" // 生活聚合页（宿舍电费/订水 · 洗衣机 · 校园卡）
  | "reserve" // 预约（图书馆座位；游泳/健身房等场馆陆续接入）
  | "zhjwxk" // 选课系统（已选课程 / 候补队列）
  | "settings"
  | "learn-course" // 课程详情（courseId）
  | "learn-assignments" // 全部作业
  | "learn-notices" // 全部通知
  | "learn-files" // 全部文件
  | "learn-search" // 全局搜索
  | "learn-semester" // 学期切换
  | "learn-assignment-detail" // 作业只读详情（courseId+itemId）
  | "learn-notice-detail" // 通知只读详情（courseId+itemId）
  | "learn-file-detail"; // 文件详情（courseId+itemId）

/** 子页导航参数：详情页按 id 在已缓存数据中查找实体 */
export interface LearnNav {
  courseId?: string;
  itemId?: string;
  /** 详情页返回目标（默认对应列表页） */
  from?: Page;
}

const TOP_PAGES = ["today", "learn", "schedule", "info", "life", "reserve", "zhjwxk", "settings"] as const;

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

export function AppProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("booting");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [page, setPage] = useState<Page>(pageFromHash);
  const [navParams, setNavParams] = useState<LearnNav | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [twoFactor, setTwoFactor] = useState<AppState["twoFactor"]>(null);

  useEffect(() => {
    const onHash = () => {
      setPage(pageFromHash());
      setNavParams(null);
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
    // hash 只承载一级页：子页刷新后落回所属入口，避免丢参数的死链
    location.hash = `#/${topLevelPage(p)}`;
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

