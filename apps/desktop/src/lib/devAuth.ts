/**
 * dev-only: 主动制造各账户的“登录失效”，用于验证自动重登。
 *
 * 只做“删除/破坏当前会话 + 触发对应的正常恢复入口”，不直接调用登录 API、
 * 不伪造成功；因此按钮的结果就是产品真实自愈链路的结果。
 *
 * 只在 DevPanel 动态加载，正式构建不包含本模块。
 */
import { invoke } from "@tauri-apps/api/core";
import { http } from "./clients.js";

export type DevAuthId =
  | "unified"
  | "learn"
  | "yuketang"
  | "gitlab"
  | "cloud"
  | "tuoj"
  | "tuojClassic"
  | "tyche"
  | "dsa"
  | "visit"
  | "xiaoda"
  | "venue"
  | "madmodel"
  | "all";

export interface DevAuthTarget {
  id: DevAuthId;
  label: string;
  hint: string;
}

export const DEV_AUTH_TARGETS: DevAuthTarget[] = [
  { id: "unified", label: "Unified", hint: "ID/WebVPN + info/card/library/dorm/zhjw" },
  { id: "learn", label: "Learn", hint: "learn session + CSRF" },
  { id: "yuketang", label: "Yuketang", hint: "dead sessionid, keep UserID/Auth" },
  { id: "gitlab", label: "GitLab", hint: "git session + id/oauth auth" },
  { id: "cloud", label: "Cloud", hint: "Seafile token + auto connect" },
  { id: "tuoj", label: "TUOJ", hint: "AI TUOJ cookie/session" },
  { id: "tuojClassic", label: "TUOJ Classic", hint: "classic TUOJ cookie/session" },
  { id: "tyche", label: "Tyche", hint: "Tyche cookie + remembered password" },
  { id: "dsa", label: "DSA", hint: "DSA cookie (manual relogin)" },
  { id: "visit", label: "Visit", hint: "visitor report ITS token" },
  { id: "xiaoda", label: "Xiaoda", hint: "Xiaoda token" },
  { id: "venue", label: "Venue", hint: "sports venue token" },
  { id: "madmodel", label: "MADModel", hint: "MADModel JWT / pump" },
  { id: "all", label: "All", hint: "run every target in order" },
];

async function clearCookieDomains(domains: string[]): Promise<void> {
  for (const domain of domains) http.jar.clear(domain);
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  try {
    await invoke("http_native_clear_cookies_domain", { suffixes: domains });
  } catch {
    /* dev 入口：原生清理不可用时仍继续走 JS jar / 业务恢复 */
  }
}

async function expireUnified(): Promise<string> {
  await clearCookieDomains([
    "id.tsinghua.edu.cn",
    "oauth.tsinghua.edu.cn",
    "webvpn.tsinghua.edu.cn",
    "info.tsinghua.edu.cn",
    "card.tsinghua.edu.cn",
    "myhome.tsinghua.edu.cn",
    "seat.lib.tsinghua.edu.cn",
    "cab.lib.tsinghua.edu.cn",
    "zhjw.cic.tsinghua.edu.cn",
    "zhjwxk.cic.tsinghua.edu.cn",
  ]);
  const { softRecover } = await import("./reload.js");
  const ok = await softRecover("dev-unified");
  return `unified: cleared; auto-recover=${ok ? "ok" : "FAILED (see log)"}`;
}

async function expireLearn(): Promise<string> {
  await clearCookieDomains(["learn.tsinghua.edu.cn"]);
  const { learn } = await import("./clients.js");
  learn.applyCsrf("");
  const { ensureLearnSession } = await import("./reload.js");
  const ok = await ensureLearnSession();
  return `learn: cleared; auto-recover=${ok ? "ok" : "FAILED (see log)"}`;
}

async function expireYuketang(): Promise<string> {
  const { ensureExtHwCredsLoaded, getExtHwCreds, saveExtHwCreds, runYktSessionCheck } = await import(
    "../state/exthw.js"
  );
  const cur = await ensureExtHwCredsLoaded();
  const ykt = cur.yuketang;
  if (!ykt?.cookie) return "yuketang: not configured";
  const deadCookie = /(?:^|;\s*)sessionid=/.test(ykt.cookie)
    ? ykt.cookie.replace(/(^|;\s*)sessionid=[^;]*/, "$1sessionid=dev-expired")
    : `${ykt.cookie}; sessionid=dev-expired`;
  await saveExtHwCreds({
    ...cur,
    yuketang: { ...ykt, cookie: deadCookie },
  });
  const state = await runYktSessionCheck();
  if (state?.alive === true) return "yuketang: invalidated; auto-renew=ok";
  if (ykt.auth && ykt.userId) return "yuketang: invalidated; auto-renew=FAILED (see log)";
  return "yuketang: invalidated; no UserID/Auth (scan once to enable renewal)";
}

async function expireGitlab(): Promise<string> {
  const { gitlabResetAuth, gitlabEnsureSession } = await import("../state/gitlab.js");
  await gitlabResetAuth();
  const ok = await gitlabEnsureSession();
  return `gitlab: cleared; auto-recover=${ok ? "ok" : "FAILED (see log)"}`;
}

async function expireCloud(): Promise<string> {
  const { clearSeafileToken } = await import("../state/seafile.js");
  const { silentConnectSeafile } = await import("../state/seafileAuto.js");
  await clearSeafileToken();
  const r = await silentConnectSeafile();
  return `cloud: token cleared; auto-connect=${String((r as { kind?: string }).kind ?? r)}`;
}

async function expireExtHw(id: "tuoj" | "tuojClassic" | "tyche" | "dsa"): Promise<string> {
  const { ensureExtHwCredsLoaded, getExtHwCreds, saveExtHwCreds, refreshExtHw } = await import(
    "../state/exthw.js"
  );
  const cur = await ensureExtHwCredsLoaded();
  const cred = cur[id];
  if (!cred) return `${id}: not configured`;
  const domains =
    id === "tuoj" ? ["ai.tuoj.thusaac.com"] :
      id === "tuojClassic" ? ["oj.cs.tsinghua.edu.cn"] :
        id === "tyche" ? ["166.111.236.164"] :
          ["dsa.cs.tsinghua.edu.cn"];
  await clearCookieDomains(domains);
  await saveExtHwCreds({ ...cur, [id]: { ...cred, cookie: "dev-expired" } });
  await refreshExtHw();
  return `${id}: invalidated; refresh triggered (see log)`;
}

async function expireVisit(): Promise<string> {
  const { visitSignOut, visitEnsureLogin } = await import("./visit.js");
  visitSignOut();
  const user = await visitEnsureLogin();
  return `visit: cleared; auto-login=${user ? "ok" : "need login"}`;
}

async function expireXiaoda(): Promise<string> {
  const { xiaodaClient, xiaodaEnsureLogin } = await import("./xiaoda.js");
  try {
    globalThis.localStorage?.removeItem("onethu.xiaodaToken");
  } catch {
    /* 忽略 */
  }
  xiaodaClient.setToken("");
  const user = await xiaodaEnsureLogin();
  return `xiaoda: cleared; auto-login=${user ? "ok" : "need login"}`;
}

async function expireVenue(): Promise<string> {
  const { clearVenueToken, ensureVenueToken } = await import("./venue.js");
  clearVenueToken();
  const ok = await ensureVenueToken();
  return `venue: token cleared; auto-login=${ok ? "ok" : "FAILED (see log)"}`;
}

async function expireMadModel(): Promise<string> {
  const { getPlugin, updatePlugin } = await import("../plugins/registry.js");
  const prev = getPlugin("onethu.harness")?.settings ?? {};
  updatePlugin("onethu.harness", {
    settings: { ...prev, madmodelToken: "", madmodelBase: "", madmodelNextAttemptAt: "" },
  });
  const { forceRemint } = await import("../state/madmodel.js");
  await forceRemint();
  return "madmodel: token cleared; remint triggered (see log)";
}

/** 执行一个 dev 失效目标；返回可读结果。 */
export async function expireDevAuth(id: DevAuthId): Promise<string> {
  if (id === "all") {
    const out: string[] = [];
    for (const target of DEV_AUTH_TARGETS) {
      if (target.id === "all") continue;
      try {
        out.push(await expireDevAuth(target.id));
      } catch (e) {
        out.push(`${target.id}: ERROR ${e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120)}`);
      }
    }
    return out.join(" | ");
  }
  switch (id) {
    case "unified": return expireUnified();
    case "learn": return expireLearn();
    case "yuketang": return expireYuketang();
    case "gitlab": return expireGitlab();
    case "cloud": return expireCloud();
    case "tuoj":
    case "tuojClassic":
    case "tyche":
    case "dsa": return expireExtHw(id);
    case "visit": return expireVisit();
    case "xiaoda": return expireXiaoda();
    case "venue": return expireVenue();
    case "madmodel": return expireMadModel();
  }
}