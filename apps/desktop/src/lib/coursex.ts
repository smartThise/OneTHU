/**
 * 课程共享计划（courseX / tsinghua.app）桌面端配置与会话。
 *
 * refresh token 由用户在 tsinghua.app 网站登录后从浏览器 cookie
 * （__Host-refresh_token）复制、在设置页粘贴；accessToken 只在内存
 * （core CourseXSession），不落盘。存储口径与 onethu.custom-courses.v1
 * 等 localStorage 配置一致。
 */
import { CourseXSession } from "@onethu/core";
import { universalFetch } from "./transport.js";

const KEY = "onethu.coursex.v1";

export interface CourseXConfig {
  refreshToken: string;
  /** 登录网络学堂后自动共享本学期课程（二期开关，一期手动触发） */
  autoShare: boolean;
  /** 上次手动/自动共享成功的时间与行数（设置页状态展示） */
  lastSharedAt?: number;
  lastSharedCount?: number;
}

export function loadCourseXConfig(): CourseXConfig | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<CourseXConfig> | null;
    if (!raw || typeof raw.refreshToken !== "string" || !raw.refreshToken) return null;
    return { refreshToken: raw.refreshToken, autoShare: raw.autoShare === true };
  } catch {
    return null;
  }
}

export function saveCourseXConfig(cfg: CourseXConfig | null): void {
  if (!cfg) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(cfg));
}

/** 会话单例：随 refreshToken 变化重建（token 更新后旧会话自然作废） */
let sessionSingleton: { token: string; session: CourseXSession } | null = null;

export function getCourseXSession(refreshToken?: string): CourseXSession | null {
  const token = refreshToken ?? loadCourseXConfig()?.refreshToken;
  if (!token) return null;
  if (!sessionSingleton || sessionSingleton.token !== token) {
    sessionSingleton = { token, session: new CourseXSession(universalFetch, token) };
  }
  return sessionSingleton.session;
}
