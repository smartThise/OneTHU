/**
 * CampusSession —— OneTHU 统一会话。
 *
 * 登录 = demoLogin（webvpn-poc/server.js 逐行移植，全程 WebVPN）。
 * 登录成功后把 WebVPN Cookie 灌入 CookieJar，learn / info 直接 resume
 * （WebVPN 会话下系统内认证在代理链中透明完成）。
 */
import { HttpClient } from "../http.js";
import {
  webvpnRequest,
  demoLogin,
  demoEnterLearn,
  demoFinishLearn,
  demoReenterLearn,
  demoRoamId,
  demoRoamCard,
  demoListMethods,
  demoSendCode,
  demoTrustDevice,
  demoVerify2fa,
  newDemoSession,
  type DemoSession,
} from "./demoLogin.js";
import type { FetchLike } from "../http.js";
import type { LearnClient } from "../learn/client.js";
import type { InfoClient } from "../info/client.js";
import { makeFingerprint } from "./store.js";

export type SessionState = "idle" | "need-2fa" | "need-learn-2fa" | "ready";

export interface TwoFactorMethod {
  type: string;
  name: string;
  detail?: string;
}

export type LoginResult =
  | { state: "ready" }
  | { state: "need-2fa"; methods: TwoFactorMethod[]; debugHtml: string };

export interface CampusSessionOptions {
  http: HttpClient;
  learn: LearnClient;
  info: InfoClient;
  fetchLike: FetchLike;
  fingerprint?: string;
  requireInfo?: boolean;
}

const METHOD_NAMES: Record<string, string> = {
  wechat: "企业微信",
  mobile: "手机短信",
  totp: "TOTP 验证器",
  wx: "企业微信",
  sms: "手机短信",
};

export class CampusSession {
  readonly http: HttpClient;
  readonly learn: LearnClient;
  readonly info: InfoClient;
  readonly fetchLike: FetchLike;
  fingerprint: string;

  state: SessionState = "idle";
  username = "";
  /** 仅内存保存，logout 即清；learn-lib 模型的第二次登录 POST 需要 */
  #password = "";
  #renewInFlight: Promise<boolean> | null = null;
  /** 受信凭据（SAVE_FINGER 响应），持久化后下次登录免 2FA */
  finger3 = "";

  /** 只读：demo 会话的 Cookie 字符串（webvpnRequest 所用同款）。
   *  供 zhjwxk 等旁路客户端直接发起选课系统请求；只读不回写，不改登录状态机。 */
  get demoCookies(): string {
    return this.#demo.webvpnCookies;
  }

  #demo: DemoSession = newDemoSession();
  #requireInfo: boolean;
  /** roam-id 完成时的 cookie 串快照（含 info 会话 JSESSIONID）——
   *  learn 登录会覆盖字符串里的 JSESSIONID，info/webvpn 桶必须用此快照灌 jar */
  #infoEraCookies = "";

  /** roam-id：thu-info-lib login() 收尾的 webvpn 服务绑定二次登录（真 demo 金标准）。
   *  CAS 会话装进 wengine 的正门——包装的 info/zhjw/card 透明 SSO 依赖它。
   *  非致命：失败只记独立诊断 idRoamDebug（不并入 debug，防覆盖）。 */
  async #roamId(): Promise<void> {
    if (!this.#password) {
      this.#dbg("ROAM-ID skip: 无内存密码（resume 路径不适用）");
      return;
    }
    // id 主会话快照必须在 roam-id 之前：lb-auth 落地链会用 webvpn 的
    // JSESSIONID 覆盖字符串里的 id 会话，事后抓到的是错的
    this.#demo.idJsid ||= /JSESSIONID=([^;\s]+)/.exec(this.#demo.webvpnCookies)?.[1] ?? "";
    await demoRoamId(this.fetchLike, this.#demo, this.username, this.#password, this.fingerprint, this.finger3);
    this.#dbg(this.#demo.idRoamDebug);
    // info 会话（含 LB 链下发的 cookie）只在此时存在于字符串中，learn 登录后会覆盖
    this.#infoEraCookies = this.#demo.webvpnCookies;
    this.#dbg("INFO-ERA cookies=" + this.#infoEraCookies.split(";").map((x) => x.trim().split("=")[0]).filter(Boolean).join(","));
  }

  constructor(options: CampusSessionOptions) {
    this.http = options.http;
    this.learn = options.learn;
    this.info = options.info;
    this.fetchLike = options.fetchLike;
    this.fingerprint = options.fingerprint ?? makeFingerprint();
    this.#requireInfo = options.requireInfo ?? false;
    // 会话过期时 InfoClient 经此回调重跑 roam 流程（登录会话内密码在内存可用）
    this.info.setRenewers({
      info: () => this.renewInfo(),
      card: () => this.renewCard(),
    });
    // dorm/library 按 lib roam("id") 账密直登 id 需要原始凭据（仅内部数据层使用，勿外传；
    // 重启恢复等无密码场景返回空串，InfoClient 自动回退 SSO 发票路径）
    this.info.setIdCredentials(() => ({
      username: this.username,
      password: this.#password,
      fingerprint: this.fingerprint,
    }));
    // HttpClient 失登自动重登录：任何 text() 命中登录页特征（电子身份/超时/sm2 表单）
    // 时先免密重漫游一次；仍失败由 http 抛 AuthRequired → 桌面端看门狗整页重载。
    // 并发去重：多个并行请求同时失登只漫游一次。
    this.http.onAuthRequired(() => {
      if (!this.#renewInFlight) {
        this.#renewInFlight = this.renewInfo()
          .catch(() => false)
          .finally(() => { this.#renewInFlight = null; });
      }
      return this.#renewInFlight.then(() => undefined);
    });
  }

  /** 电子身份窗口自动填入用凭据（仅内存有密码时可用；重启恢复场景返回 null——
   *  调用方据此降级为手动输入）。仅本机窗口初始化脚本使用，绝不落盘。 */
  getIdCredentials(): { username: string; password: string } | null {
    if (!this.username || !this.#password) return null;
    return { username: this.username, password: this.#password };
  }

  /** 登录（demo 流程：全程 WebVPN）。返回 need-2fa 时继续 verify2FA。 */
  async login(username: string, password: string): Promise<LoginResult> {
    this.username = username;
    this.#password = password;
    this.#demo = newDemoSession();
    this.#infoEraCookies = "";
    this.#cardEraCookies = "";
    this.#learnEraCookies = "";
    // 清空 jar：demo 用自己的 Cookie 字符串，jar 由登录成功后统一灌入
    this.http.jar.clear();

    const result = await demoLogin(this.fetchLike, username, password, this.#demo, this.fingerprint, this.finger3);
    if (typeof result === "object") {
      const err = new Error(result.error);
      (err as Error & { debug?: string }).debug = this.#demo.debug;
      throw err;
    }
    this.#seedJar();

    if (result === "need_2fa") {
      // FIND 失败（如"未知异常"）＝会话上并无待验证状态——多半是受信登录的 302 落地链
      // 被网络抖动截断，代码误判成 need_2fa。此时探测 webvpn 根：落地即已登录，续走 learn。
      let approaches;
      try {
        approaches = await demoListMethods(this.fetchLike, this.#demo);
      } catch (findErr) {
        const probe = await webvpnRequest(this.fetchLike, "GET", "https://webvpn.tsinghua.edu.cn/", {
          cookies: this.#demo.webvpnCookies,
        }).catch(() => null);
        const landed = !!probe && !/\/login(\/|\b|$)/.test(probe.url);
        this.#dbg(
          "NEED2FA-FIND-FAIL " + String(findErr) + " probe终=" + (probe ? probe.url.slice(0, 90) : "(请求失败)") +
            " landed=" + landed,
        );
        if (probe && landed) {
          await this.#roamId();
          const csrf = await demoEnterLearn(
            this.fetchLike, this.#demo, this.username, this.#password, this.fingerprint, this.finger3,
          );
          this.learn.applyCsrf(csrf);
      this.#learnEraCookies = this.#demo.webvpnCookies;
          this.#dbg(this.#demo.debug);
          this.#seedJar();
          await this.info.resume().catch(() => undefined);
          this.state = "ready";
          return { state: "ready" };
        }
        throw findErr;
      }
      this.state = "need-2fa";
      const methods = approaches.map((a) => ({
        type: a.id,
        name: METHOD_NAMES[a.id] ?? a.label,
        detail: a.hint,
      }));
      this.#firstRoundMethods = methods;
      return { state: "need-2fa", methods, debugHtml: this.#demo.twoFaHtml };
    }

    let csrf: string;
    try {
      await this.#roamId();
      csrf = await demoEnterLearn(this.fetchLike, this.#demo, this.username, this.#password, this.fingerprint, this.finger3);
    } catch (e) {
      this.#dbg("ENTER-LEARN-FAIL " + String(e) + "\n" + this.#demo.debug);
      throw e;
    }
    this.learn.applyCsrf(csrf);
      this.#learnEraCookies = this.#demo.webvpnCookies;
    this.#dbg(this.#demo.debug);
    this.#seedJar();
    await this.info.resume().catch(() => undefined);
    this.state = "ready";
    return { state: "ready" };
  }

  #twoFaType = "totp";
  #firstRoundMethods: TwoFactorMethod[] = [];
  #learnMethods: TwoFactorMethod[] = [];

  /** 2FA：发送验证码（字符串模型 SEND_CODE） */
  async send2FA(type: string): Promise<void> {
    this.#twoFaType = type;
    await demoSendCode(this.fetchLike, this.#demo, type);
  }

  /** 2FA 验证（字符串模型）：VERITY → redirectUrl 落地 → 回调 → learn 入口。
   *  返回 null=完成；返回方式列表=learn 需要第二轮验证。 */
  async verify2FA(code: string, trust = false): Promise<TwoFactorMethod[] | null> {
    try {
      await demoVerify2fa(this.fetchLike, this.#demo, this.#twoFaType, code);
      if (trust) {
        this.finger3 = await demoTrustDevice(this.fetchLike, this.#demo, this.fingerprint);
      }
      this.#dbg("SAVE-FINGER: " + this.#demo.debug + " finger3=" + (this.finger3 ? "yes" : "no"));
      await this.#roamId();
      const csrf = await demoEnterLearn(this.fetchLike, this.#demo, this.username, this.#password, this.fingerprint, this.finger3);
      if (csrf === "need-2fa") {
        // learn-lib 兜底路径触发了该服务的二次验证 → 进入第二轮。
        // 复用第一轮方式列表（该服务流程的 FIND_APPROACHES 实测会被拒）。
        this.state = "need-learn-2fa";
        this.#learnMethods = this.#firstRoundMethods.length ? this.#firstRoundMethods : [];
        return this.#learnMethods;
      }
      this.learn.applyCsrf(csrf);
      this.#learnEraCookies = this.#demo.webvpnCookies;
      this.#dbg(this.#demo.debug);
      this.#seedJar();
      await this.info.resume().catch(() => undefined);
      this.state = "ready";
      return null; // 无需第二轮
    } catch (e) {
      this.#dbg("VERIFY-FAIL " + String(e) + "\n" + this.#demo.debug);
      throw e;
    }
  }

  /** learn 第二轮验证：发送验证码（作用于 learn 流程会话） */
  async sendLearn2FA(type: string): Promise<void> {
    this.#twoFaType = type;
    await demoSendCode(this.fetchLike, this.#demo, type);
  }

  /** learn 第二轮验证完成 + 收尾 */
  async verifyLearn2FA(code: string): Promise<void> {
    try {
      await demoVerify2fa(this.fetchLike, this.#demo, this.#twoFaType, code);
      this.#dbg(this.#demo.debug);
      const csrf = await demoFinishLearn(this.fetchLike, this.#demo);
      this.learn.applyCsrf(csrf);
      this.#learnEraCookies = this.#demo.webvpnCookies;
      this.#dbg(this.#demo.debug);
      this.#seedJar();
      await this.info.resume().catch(() => undefined);
      this.state = "ready";
    } catch (e) {
      this.#dbg("LEARN2FA-FAIL " + String(e) + "\n" + this.#demo.debug);
      throw e;
    }
  }

  /** demo 字符串会话快照（持久化用） */
  get demoSnapshot(): string {
    return this.#demo?.webvpnCookies ?? "";
  }

  /** id CAS 主会话快照（持久化用；demoEnterLearn 首次进入时抓取——彼时字符串里的
   *  JSESSIONID 尚是 id 的，进入 learn 后会被同名覆盖） */
  get idJsidSnapshot(): string {
    return this.#demo.idJsid ?? "";
  }

  /** 重启恢复：注入持久化的 demo 字符串会话（含 id CAS 主会话，重漫游主凭据） */
  restoreDemo(cookies: string, idJsid = ""): void {
    if (!this.#demo) return;
    if (cookies) this.#demo.webvpnCookies = cookies;
    if (idJsid && !this.#demo.idJsid) this.#demo.idJsid = idJsid;
  }

  /** roam-id 完成时的 cookie 串快照（持久化用：重启后 info/webvpn 桶灌入用） */
  get infoEraSnapshot(): string {
    return this.#infoEraCookies;
  }

  /** 重启恢复：注入持久化的 info 会话 cookie 串（learn 会话过期无碍，info 会话更长命） */
  restoreInfoCookies(cookies: string): void {
    if (cookies) this.#infoEraCookies = cookies;
  }

  /** 桌面端「记住密码」注入（仅内存，不落盘到 core）：重启恢复的 cookie 会话过期后，
   *  renewInfo / renewCard / dorm-library 的 id 账密直登（#idCredentials）需要原始凭据。
   *  与完整 login() 的区别：不重置 jar、不走登录链——只补上内存密码让按需续期可用。 */
  injectCredentials(username: string, password: string): void {
    if (username) this.username = username;
    this.#password = password;
  }

  /** resume 恢复后重灌 jar（info/webvpn 桶用 #infoEraCookies 快照） */
  reseed(): void {
    this.#seedJar();
  }

  /** resume 后 learn 会话过期的重漫游：用持久化的 id CAS 主会话重新发票→漫游→csrf
   *  （不需密码，SSO 随要随发票）。返回 true = learn 会话已重建。 */
  /** 选课系统 id-bounce 重登需要原始凭据（仅内部数据层使用，勿外传） */
  get xkCredentials(): { username: string; password: string; fingerprint: string } {
    return { username: this.username, password: this.#password, fingerprint: this.fingerprint };
  }

  async relearnRoam(): Promise<boolean> {
    const jsid = this.#demo.idJsid;
    if (!jsid) {
      this.#dbg("RE-ROAM skip: 无持久化 id 主会话");
      return false;
    }
    try {
      const csrf = await demoReenterLearn(this.fetchLike, this.#demo, jsid);
      this.learn.applyCsrf(csrf);
      this.#learnEraCookies = this.#demo.webvpnCookies;
      this.#dbg("RE-ROAM ok\n" + this.#demo.debug);
      this.#seedJar();
      return true;
    } catch (e) {
      this.#dbg("RE-ROAM fail " + String(e) + "\n" + this.#demo.debug);
      return false;
    }
  }

  /** 重置内存会话（logout 用；finger3 属设备信任，保留在 store） */
  reset(): void {
    this.#demo = newDemoSession();
    this.#password = "";
    this.#infoEraCookies = "";
    this.#cardEraCookies = "";
    this.#learnEraCookies = "";
    this.state = "idle";
    this.http.jar.clear();
  }

  async relogin(username: string, password: string): Promise<void> {
    await this.login(username, password);
  }

  /** 把 demo 会话的 Cookie 字符串灌入 jar，后续 HttpClient 请求自动携带 */
  #seedJar(): void {
    // demo 会话模型：一个字符串走天下。除 webvpn 域（wrapped 请求全量携带）外，
    // 还需挂到各直连域——learn/id 等直连请求才能带上各自会话。
    // ⚠ 字符串里只有一个 JSESSIONID：learn 登录会覆盖 roam-id 刚建立的 info 会话。
    //   webvpn/info 两桶必须用 roam-id 完成时的快照（#infoEraCookies）灌入，
    //   否则包装 info 请求带的是 learn 的 JSESSIONID → 应用级 403（18:52 实测）。
    const infoSide = this.#infoEraCookies || this.#demo.webvpnCookies;
    const domains: Array<[string, string]> = [
      ["https://webvpn.tsinghua.edu.cn/", infoSide],
      ["https://learn.tsinghua.edu.cn/", this.#learnEraCookies || this.#demo.webvpnCookies],
      ["https://id.tsinghua.edu.cn/", this.#demo.webvpnCookies],
      ["https://oauth.tsinghua.edu.cn/", infoSide],
      ["https://info.tsinghua.edu.cn/", infoSide],
      ["https://card.tsinghua.edu.cn/", this.#cardEraCookies || this.#demo.webvpnCookies],
    ];
    for (const [d, source] of domains) {
      const url = new URL(d);
      for (const pair of source.split(";")) {
        const t = pair.trim();
        if (!t || !t.includes("=")) continue;
        try {
          this.http.jar.setRaw(url, t + "; Path=/");
        } catch {
          /* 容忍个别坏值 */
        }
      }
    }
  }

  /** learn 专属 service 的 CAS 表单（learn-lib 同款哈希） */
  static readonly LEARN_CAS_FORM =
    "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/bb5df85216504820be7bba2b0ae1535b/0";

  /** 卡片会话 era 快照（demoRoamCard 完成时；card 桶灌 jar 用） */
  #cardEraCookies = "";
  /** learn 会话 era 快照（demoEnterLearn/relearnRoam 成功时；learn 桶灌 jar 用）——
   *  其后的 info 续期会把字符串 JSESSIONID 变成 info 的，learn 桶必须用本快照 */
  #learnEraCookies = "";

  /** card 会话续期：demo cardLogin 等价（card service 登录 → 锚点直连兑付） */
  async #roamCard(): Promise<void> {
    if (!this.#password) {
      this.#dbg("ROAM-CARD skip: 无内存密码");
      return;
    }
    await demoRoamCard(this.fetchLike, this.#demo, this.username, this.#password, this.fingerprint, this.finger3);
    this.#dbg(this.#demo.idRoamDebug);
    this.#cardEraCookies = this.#demo.webvpnCookies;
  }

  /** InfoClient 会话过期回调：重跑两段式 roam-id 并重灌 jar。返回是否续期成功。 */
  async renewInfo(): Promise<boolean> {
    if (!this.#password) return false;
    await this.#roamId();
    this.#seedJar();
    return true;
  }

  /** InfoClient 校园卡会话回调：card service 登录 + 直连兑付 + 重灌 jar。 */
  async renewCard(): Promise<boolean> {
    if (!this.#password) return false;
    await this.#roamCard();
    this.#seedJar();
    return true;
  }

  async #establish(): Promise<void> {
    await this.#roamLearn();
    if (this.#requireInfo) {
      await this.info.resume();
    } else {
      await this.info.resume().catch(() => undefined);
    }
    this.state = "ready";
  }

  /** 逐步诊断记录（clients 落盘到 /tmp/onethu-debug.log） */
  readonly debugLog: string[] = [];

  #dbg(line: string): void {
    this.debugLog.push(line);
    const g = (globalThis as unknown as { __oneTHUdbg?: string[] }).__oneTHUdbg;
    if (g && g.length) {
      for (const h of g.splice(0)) this.debugLog.push(h);
    }
  }

  /** 用已认证的 id 会话换 learn ticket 并漫游（learn-lib: form→ticket→roaming_entry→课程页） */
  async #roamLearn(): Promise<void> {
    let ticket = "";
    try {
      const res = await this.http.request(CampusSession.LEARN_CAS_FORM, {
        redirect: "manual",
        direct: true, // id 会话在 id 域（登录 POST 直连建立），绝不能经 WebVPN 包装
      });
      const loc = res.headers.get("location");
      const authFlag = /"authenticated"\s*:\s*(true|false)/.exec(await res.clone().text())?.[1] ?? "?";
      const cookieSent = this.http.jar
        .getCookies(new URL("https://id.tsinghua.edu.cn/"))
        .map((c) => c.name + "@" + (c.domain || "?"))
        .join(",");
      this.#dbg(
        "[v4.9] CAS-FORM status=" + res.status + " loc=" + (loc ?? "(none)") +
        " authenticated=" + authFlag + " cookies=" + (cookieSent || "(none)"),
      );
      if (loc) {
        ticket = loc.split("=").slice(-1)[0] ?? "";
      } else {
        const html = await res.text();
        const anchor = /<a[^>]+href="([^"]*ticket=[^"]*)"/i.exec(html)?.[1];
        if (anchor) ticket = anchor.split("=").slice(-1)[0] ?? "";
        this.#dbg("CAS-FORM anchor=" + (anchor ?? "(none)"));
      }
    } catch (e) {
      this.#dbg("CAS-FORM error " + String(e));
    }
    if (ticket && ticket.length > 8) {
      try {
        await this.learn.roam(ticket);
        this.#dbg("[v4.9] ROAM ok ticket=" + ticket.slice(0, 24) + "…");
        return;
      } catch (e) {
        this.#dbg("ROAM error " + String(e) + " page=" + this.learn.lastDebug.slice(0, 300));
      }
    } else {
      this.#dbg("ROAM skip: no ticket");
    }
    // WebVPN 代理路径：漫游入口（不带 ticket）— webvpn 服务端持有回调建立的 CAS 会话，
    // 会替我们完成 票据流程（浏览器打开网络学堂就是这个链路）。直连模式下等价于让 learn 自己跳 CAS。
    try {
      const wrappedEntry = this.http.webVPNEncoder
        ? this.http.webVPNEncoder("https://learn.tsinghua.edu.cn/b/j_spring_security_thauth_roaming_entry")
        : "https://learn.tsinghua.edu.cn/b/j_spring_security_thauth_roaming_entry";
      const wcookie = this.http.jar
        .getCookies(new URL(wrappedEntry))
        .map((c) => c.name + "=" + c.value.slice(0, 8) + "…")
        .join("; ");
      this.#dbg("[v4.12] ROAM-ENTRY req-url=" + wrappedEntry.slice(0, 90));
      this.#dbg("[v4.12] ROAM-ENTRY req-cookies=" + (wcookie || "(none)"));
      const r = await this.http.request(
        "https://learn.tsinghua.edu.cn/b/j_spring_security_thauth_roaming_entry",
        { redirect: "follow" },
      );
      const body = await r.text();
      this.#dbg(
        "[v4.12] ROAM-ENTRY status=" + r.status + " body=" + body.slice(0, 260).replace(/\s+/g, " "),
      );
    } catch (e) {
      this.#dbg("[v4.12] ROAM-ENTRY error " + String(e));
    }
    const ok = await this.learn.resume();
    this.#dbg("[v4.9] RESUME ok=" + ok + " page=" + this.learn.lastDebug.slice(0, 300));
    if (!ok) {
      throw new Error("网络学堂会话建立失败（详情见诊断日志）");
    }
  }
}
