/**
 * 清华 GitLab 冒烟脚本（真连 git.tsinghua.edu.cn）。
 *
 * A 段（无凭据也跑）：漫游链首跳是否仍然成立——
 *    GET /users/sign_in  → meta[name=csrf-token]
 *    用该令牌 POST /users/auth/thuid → 期望 302 到 oauth.tsinghua.edu.cn/thu-oauth/auth
 *    跟随该跳 → 落到 id.tsinghua.edu.cn 登录表单（含 #sm2publicKey）
 *   这三步正是 packages/info-lib/src/lib/core.ts 里 roam("gitlab") 依赖的前提；
 *   校方改版（换 CSRF 位置、换 OAuth 入口）时这里先红。
 *
 * B 段（需凭据）：经 info-lib helper 走完整「GitLab → 清华 OAuth → id → 回调换票」，
 *   然后拉「我参与的项目」并逐项打印 Issue / 合并请求 / 流水线条数。
 *
 * 账号开了二次认证时，B 段停在这一步：用 `--2fa=<wechat|mobile|totp>` 指定方式，脚本
 * 会发出验证码并把进程留在原地等——把收到的码写进 tools/.smoke/gitlab-2fa.txt 即续跑
 * （最长等 5 分钟）。也可用 `--2fa=totp --2fa-code=123456` 一次给全。
 * 登录链会做两次 CAS 认证（webvpn 与信息门户各一次），未信任设备时两次都要验证码；
 * 而 lib 对整条链设了 3 分钟上限，所以两次都手输很容易超时。加 `--trust` 让脚本在第一次
 * 验证通过后签发并复用受信凭据（等价应用里勾选「信任此设备，30 天内免二次认证」，
 * 会在账号的设备列表里留一条名为 OneTHU smoke 的记录）。
 *
 * 运行：
 *   node tools/gitlab-smoke.mjs
 *   TSINGHUA_USER=2025xxxxxx TSINGHUA_PASS=... node tools/gitlab-smoke.mjs --2fa=mobile
 *   或核对 API 面（免二次认证、不受验证码时限约束）：
 *   GITLAB_TOKEN=glpat-... node tools/gitlab-smoke.mjs
 *
 * 两种 B 段：账号密码模式走完整 roam("gitlab") 漫游；GITLAB_TOKEN 模式用个人访问令牌
 * （GitLab 设置 → 访问令牌，勾 api 范围）直接核对每个端点，不碰统一认证。
 *
 * 传输层：等价应用内的 Rust 原生通道（手动逐跳 + 分域 cookie 仓）——
 * 桌面端由 reqwest cookie_store 承担同样职责。
 *
 * info-lib 的构建产物按打包器规则互相引用（相对路径不带扩展名），Node 直跑解析不了，
 * 故注册一个解析钩子补 .js；这属于跑脚本的脚手架，与应用内的解析无关。
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";

register("data:text/javascript," + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (e) {
    if (e?.code !== "ERR_MODULE_NOT_FOUND") throw e;
    const relative = specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/");
    if (relative) {
      for (const ext of [".js", ".ts", ".tsx"]) {
        try { return await next(specifier + ext, context); } catch {}
      }
    }
    throw e;
  }
}
`));

const GITLAB = "https://git.tsinghua.edu.cn";
/** 个人访问令牌（GitLab 设置 → 访问令牌，勾 api 范围）：给号即跳过统一认证，
 *  用 PRIVATE-TOKEN 头核对 API 面（`roam("gitlab")` 那条链由无令牌模式覆盖） */
const TOKEN = process.env.GITLAB_TOKEN ?? "";
const JAR = new Map();

function jarFor(host) {
  if (!JAR.has(host)) JAR.set(host, new Map());
  return JAR.get(host);
}

function cookieHeader(url) {
  const u = new URL(url);
  const pairs = [];
  for (const [host, jar] of JAR) {
    if (!(u.hostname === host || u.hostname.endsWith("." + host))) continue;
    for (const [k, v] of jar) pairs.push(`${k}=${v}`);
  }
  return pairs.length ? pairs.join("; ") : undefined;
}

function absorb(res) {
  const lines = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const line of lines) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const domain = /;\s*domain=([^;]+)/i.exec(line);
    const host = domain ? domain[1].trim().replace(/^\./, "") : new URL(res.url).hostname;
    const jar = jarFor(host);
    if (value === "" || /expires=Thu, 01 Jan 1970/i.test(line)) jar.delete(name);
    else jar.set(name, value);
  }
}

/** 逐跳请求（浏览器语义：303 一律 GET，301/302 的 POST 转 GET） */
async function hop(url, init = {}) {
  let cur = url;
  let method = init.method ?? "GET";
  let body = init.body;
  for (let i = 0; i < 12; i++) {
    const headers = { "User-Agent": "Mozilla/5.0 (compatible; OneTHU gitlab-smoke)", ...(init.headers ?? {}) };
    if (TOKEN && new URL(cur).hostname.endsWith("tsinghua.edu.cn")) headers["PRIVATE-TOKEN"] = TOKEN;
    const cookie = cookieHeader(cur);
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(cur, { method, body, headers, redirect: "manual" });
    absorb(res);
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      const next = new URL(res.headers.get("location"), cur).toString();
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
      }
      cur = next;
      continue;
    }
    const text = await res.text();
    return { status: res.status, text, url: cur };
  }
  throw new Error(`重定向次数超限：${url}`);
}

/* ══════════ A 段：漫游链首跳 ══════════ */

const page = await hop(`${GITLAB}/users/sign_in`);
if (page.status !== 200) throw new Error(`GitLab 登录页返回 ${page.status}`);
if (!page.text.includes("/users/auth/thuid")) {
  console.log("A 段：登录页没有清华登录入口——本校 GitLab 可能已改版，roam(\"gitlab\") 需要复核");
  process.exit(1);
}
const csrf = /name="csrf-token"\s+content="([^"]+)"/.exec(page.text)?.[1] ?? "";
if (!csrf) throw new Error("登录页没有 meta[name=csrf-token]：漫游链取令牌的方式需要复核");
console.log(`A 段：登录页正常（CSRF 令牌 ${csrf.length} 字符）`);

const oauth = await hop(`${GITLAB}/users/auth/thuid`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ authenticity_token: csrf }).toString(),
});
if (!oauth.url.startsWith("https://oauth.tsinghua.edu.cn/thu-oauth/") && !oauth.url.startsWith("https://id.tsinghua.edu.cn/")) {
  throw new Error(`thuid 未跳到清华 OAuth，落点：${oauth.url}`);
}
if (!oauth.text.includes("sm2publicKey")) {
  throw new Error(`OAuth 链未落到 id 登录表单（缺 #sm2publicKey），落点：${oauth.url}`);
}
console.log(`A 段：OAuth 链落到 id 登录表单（${new URL(oauth.url).host}）`);

/* ══════════ B 段：全链数据 ══════════ */

const user = process.env.TSINGHUA_USER ?? "";
const pass = process.env.TSINGHUA_PASS ?? "";
if (!TOKEN && (!user || !pass)) {
  console.log("B 段：未提供 GITLAB_TOKEN 或 TSINGHUA_USER / TSINGHUA_PASS，跳过全链数据（A 段已通过）");
  process.exit(0);
}

const { setPlatformFetch } = await import("../packages/info-lib/dist/utils/network.js");
const { login } = await import("../packages/info-lib/dist/lib/core.js");
const {
  getRecentProjects, getProjectDetail, getProjectBranches, getProjectTree, getProjectFileBlob,
  getProjectIssues, getProjectIssue, getIssueNotes, getProjectMergeRequests, getProjectMergeRequest,
  getMergeRequestNotes, getProjectPipelines, getPipelineJobs, getJobTrace,
} = await import("../packages/info-lib/dist/lib/gitlab.js");

setPlatformFetch(async (url, init) => {
  const r = await hop(url, { method: init.method, body: init.body, headers: init.headers });
  return {
    status: r.status,
    headers: [],
    text: r.text,
    finalUrl: r.url,
  };
});

/** 按 lib 的 helper 契约构造最小实例（应用内由 InfoHelper 承担同样角色） */
const argOf = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : "";
};
/** 验证码交接：进程留在原地轮询这个文件，写进去即续跑（lib 对整条登录链设了 3 分钟上限，
 *  配合 --trust 只需一次验证码，60 秒足够） */
const codeFile = path.join(import.meta.dirname, ".smoke", "gitlab-2fa.txt");
const waitCode = async () => {
  const alive = Date.now() + 120_000;
  process.stdout.write(`等待验证码：把收到的码写入 ${codeFile}（最长 120 秒）...\n`);
  while (Date.now() < alive) {
    if (existsSync(codeFile)) {
      const code = readFileSync(codeFile, "utf8").trim();
      if (code) {
        rmSync(codeFile);
        console.log(`已取得验证码（${code.length} 位）`);
        return code;
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("等待验证码超时");
};

const deviceFile = path.join(import.meta.dirname, ".smoke", "gitlab-device.json");
/** 复用在 --trust 那次登录里拿到的受信凭据：同一指纹 + 信任令牌再登录即可免二次认证 */
const device = existsSync(deviceFile) ? JSON.parse(readFileSync(deviceFile, "utf8")) : null;

const helper = {
  // 令牌模式下 userId/password 只是占位：lib 的漫游包装器要求它们非空，
  // 而请求本身靠 PRIVATE-TOKEN 头通过认证（不会触发漫游）
  userId: user || "token-mode",
  password: pass || "token-mode",
  fingerprint: device?.fingerprint || randomBytes(16).toString("base64").slice(0, 22),
  fingerGenPrint: device?.finger3 || "",
  MOCK: "8888",
  mocked: () => false,
  graduate: () => false,
  clearCookieHandler: async () => undefined,
  twoFactorMethodHook: async (hasWeChatBool, phone, hasTotp) => {
    const available = [
      hasWeChatBool ? "wechat" : "",
      phone ? "mobile" : "",
      hasTotp ? "totp" : "",
    ].filter(Boolean);
    console.log(`该账号需要二次认证，可用方式：${available.join(" / ")}`);
    const want = argOf("2fa");
    if (!want) throw new Error("用 --2fa=<方式> 指定一种二次认证方式后重跑");
    if (!available.includes(want)) throw new Error(`账号不支持 --2fa=${want}`);
    return want;
  },
  twoFactorAuthHook: async () => {
    const inline = argOf("2fa-code");
    return inline || (await waitCode());
  },
  trustFingerprintHook: async () => process.argv.includes("--trust"),
  trustFingerprintNameHook: async () => "OneTHU smoke",
};

mkdirSync(path.dirname(codeFile), { recursive: true });

if (TOKEN) {
  // 令牌模式：不做统一认证（A 段已覆盖漫游链的前提，roam 链由上一种模式实测）
  console.log("B 段：使用 GITLAB_TOKEN，跳过统一认证");
} else {
  await login(helper, user, pass);
  if (helper.fingerGenPrint) {
    writeFileSync(deviceFile, JSON.stringify({ fingerprint: helper.fingerprint, finger3: helper.fingerGenPrint }));
  }
  console.log("B 段：统一认证登录成功");
}

const projects = await getRecentProjects(helper, 1);
console.log(`B 段：我参与的项目 ${projects.length} 个`);
if (projects.length === 0) throw new Error("账号下没有任何项目，无法核对仓库与流水线端点");
for (const p of projects.slice(0, 5)) {
  const detail = await getProjectDetail(helper, p.id);
  const branches = await getProjectBranches(helper, p.id);
  // 逐层进到第一个文件：目录树 → blob 原文（README 渲染走的就是这条链）
  let path = "";
  let blobSha = "";
  let filePath = "";
  for (let depth = 0; depth < 4 && !blobSha; depth++) {
    const entries = await getProjectTree(helper, p.id, path, detail.default_branch, 1);
    const file = entries.find((e) => e.type === "blob");
    const dir = entries.find((e) => e.type === "tree");
    if (file) {
      blobSha = file.id;
      filePath = file.path;
    } else if (dir) path = dir.path;
    else break;
  }
  const blob = blobSha ? await getProjectFileBlob(helper, p.id, blobSha) : "";
  const [issues, issuesAll, mrs, mrsAll] = await Promise.all([
    getProjectIssues(helper, p.id, "opened", "", 1),
    getProjectIssues(helper, p.id, "all", "", 1),
    getProjectMergeRequests(helper, p.id, "opened", "", 1),
    getProjectMergeRequests(helper, p.id, "all", "", 1),
  ]);
  const pipelines = await getProjectPipelines(helper, p.id, "", 1);
  const jobs = pipelines[0] ? await getPipelineJobs(helper, p.id, pipelines[0].id) : [];
  const trace = jobs[0] ? (await getJobTrace(helper, p.id, jobs[0].id)).length : 0;
  // 详情端点：有数据才点得进去
  const issueDetail = issuesAll[0] ? await getProjectIssue(helper, p.id, issuesAll[0].iid) : null;
  const issueNotes = issueDetail ? await getIssueNotes(helper, p.id, issueDetail.iid) : [];
  const mrDetail = mrsAll[0] ? await getProjectMergeRequest(helper, p.id, mrsAll[0].iid) : null;
  const mrNotes = mrDetail ? await getMergeRequestNotes(helper, p.id, mrDetail.iid) : [];
  console.log(
    `  · ${p.path_with_namespace}（${detail.visibility}${detail.empty_repo ? " 空仓库" : ""}）默认分支 ${detail.default_branch} · 分支 ${branches.length}` +
      `\n      仓库：${filePath ? `${filePath}（${blob.length} 字符）` : "没取到文件"}` +
      `\n      Issue：进行中 ${issues.length} / 全部 ${issuesAll.length}${issueDetail ? ` · 详情 !${issueDetail.iid}「${issueDetail.title}」评论 ${issueNotes.length}` : "（无）"}` +
      `\n      合并请求：进行中 ${mrs.length} / 全部 ${mrsAll.length}${mrDetail ? ` · 详情 !${mrDetail.iid}「${mrDetail.title}」评论 ${mrNotes.length}` : "（无）"}` +
      `\n      流水线 ${pipelines.length}${jobs.length ? `（首个 #${pipelines[0].id} → ${jobs.length} 个作业，作业日志 ${trace} 字符）` : ""}`,
  );
}
console.log("gitlab-smoke: 全链数据读取通过");
