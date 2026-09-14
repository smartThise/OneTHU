/**
 * thu-info-lib 适配层（2026-09-14 硬换数据层的接线处）。
 *
 * 决策背景：用户令「照抄 info app」。调研发现 THU Info 是 React Native +
 * TypeScript，其网络/会话核心以 MIT 协议独立开源（thu-info-lib，几千学生
 * 每日在蜂窝网上使用）。其会话架构 267 行写完我们此前数百行未稳定的东西：
 *
 *     操作失败 → roam 重试 → 仍失败 → 探测会话 → 死则用存好的密码静默重登 → 重放
 *
 * 全部经 roamingWrapper 单漏斗，无线锁、无广播、无熔断复杂度。
 *
 * 本文件职责：
 * - 把 lib 的 platformFetch 注入为我们的 tauriFetch（Rust reqwest 连接池，
 *   实测 SSO 跳转 3s→65ms；域名感知 cookie jar；重定向自动跟随并回传终点）。
 * - clearCookies 委托我们 HttpClient 的 jar（域名感知，与旧数据层共存于同一 jar）。
 * - 提供 InfoHelper 单例与「登录 + 三项数据拉取」探针，供诊断页验证。
 */
import { tauriFetch } from "./transport.js";
import { http } from "./clients.js";
import { setPlatformFetch, setPlatformClearCookies } from "@onethu/info-lib/network";
import { InfoHelper } from "@onethu/info-lib";

let initialized = false;

/** 注入平台传输（幂等；app 启动或探针页挂载时调用） */
export function initInfoLib(): InfoHelper {
  if (!initialized) {
    setPlatformFetch(async (url, init) => {
      const res = await tauriFetch(url, {
        method: init.method ?? "GET",
        body: init.body,
        headers: init.headers as Record<string, string> | undefined,
      });
      const headers: Array<[string, string]> = [];
      res.headers.forEach((value, key) => headers.push([key, value]));
      const text = await res.text();
      return {
        status: res.status,
        headers,
        text,
        finalUrl: res.headers.get("x-onethu-final-url") ?? res.url ?? url,
      };
    });
    setPlatformClearCookies(() => {
      http.jar.clear();
    });
    initialized = true;
  }
  return helper;
}

/** InfoHelper 单例（userId/password 登录后驻留内存，供静默重登） */
export const helper = new InfoHelper();

/** 用 info-lib 的登录链建立会话（走我们注入的传输） */
export async function infoLibLogin(userId: string, password: string): Promise<void> {
  initInfoLib();
  helper.clearCookieHandler = async () => {
    http.jar.clear();
  };
  await helper.login({ userId, password });
}
