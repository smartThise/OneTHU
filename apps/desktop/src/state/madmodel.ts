import { webvpnWrap } from "@onethu/core";
import { http, info } from "../lib/clients.js";
import { getPlugin, updatePlugin } from "../plugins/registry.js";
import { logLine } from "../lib/clients.js";

/** 清华 MadModel（校园网免费 DeepSeek）token 泵 + 校外兜底。
 *  站点语义（2026-10-08 本机复测；thu-tok-auto 同日实测记录一致）：
 *  - 换 token 的唯一入口是**统一认证发票**：带 id 会话 GET 服务表单
 *    （app id = md5('DEEPSEEK')）→ checkSingle 指纹确认 → 成功页带 ?ticket= →
 *    GET /model-api/auth-login/check?ticket= 换 6h JWT；票据单次有效。
 *  - 站点 2026-09-29 起关闭免登录签发：无凭据 GET /check 恒返回 10001
 *    「ticket已过期或无效」——依赖它的旧实现已失效。
 *  - 校外 IP 全域 307 弹 SSO（IP 门禁在 token 校验之前）；webvpn **收录**该域。
 *    校外对话通道走**宿主侧回环中继**：应用进程里起 127.0.0.1 小服务（
 *    src-tauri/src/madmodel_relay.rs），用共享原生 client（原生 cookie 仓 + 与 webview
 *    一致的 UA）转发到包装域；OH 只连 127.0.0.1。实测依据：wengine 会话需要**完整
 *    cookie 集**（refresh/heartbeat/票/show_*）且活体只在原生仓，把单张票注入 ureq
 *    必被弹回登录页。取票与兑换本身仍走应用自身管线（校外兑换 URL 手动包一层）。
 *  - 两处直连白名单（core PUBLIC_DIRECT_HOSTS / transport 包装排除）刻意保留：
 *    可达性探测必须保持直连才看得见 IP 门禁，包装由本模块显式完成。
 *  本模块：探针判定校内可达性 → 免费档/自费自动调度。 */

const SITE = "https://madmodel.cs.tsinghua.edu.cn";
const REFRESH_MS = 5 * 3600_000 + 50 * 60_000;
const HARNESS_ID = "onethu.harness";
/** 统一认证里 MadModel 侧的 app id：站点前端用 md5('DEEPSEEK') 拼登录表单地址
 *  （2026-10-08 与站点 bundle 逐字符一致），回调 = 站点 SPA 的 authLogin 路由。 */
const DEEPSEEK_APP_ID = "d736f067a6705ab942df52f958a0f23b";
const ID_TICKET_FORM = `https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/${DEEPSEEK_APP_ID}/0?/authLogin`;

let pumping = false;

/** 是否处于 madmodel 免费档语义（显式 custom 或「未显式但已填 key」则免打扰） */
function madmodelActive(): boolean {
  const s = getPlugin(HARNESS_ID)?.settings ?? {};
  const provider = String(s.provider ?? "");
  if (provider === "custom") return false;
  if (!provider && s.apiKey) return false; // 老用户迁移安全：维持自费
  return true;
}

export type MmChannel = "direct" | "webvpn";

/** 通道判定（唯一真源 = 可达性探针结果：madmodelReachable "1" 校内 / "0" 校外）。
 *  校内直连；校外包装。探测本身必须保持直连——IP 门禁只在直连链上可见。 */
export function madmodelChannel(): MmChannel {
  const s = getPlugin(HARNESS_ID)?.settings ?? {};
  return String(s.madmodelReachable ?? "") === "0" ? "webvpn" : "direct";
}

/** 当前 webvpn 会话票：仅在中继不可用（非 Tauri 环境或中继启动失败）时作为退化路径
 *  交给 Rust 直接使用。注意单张票通常不够——wengine 还要 refresh/heartbeat/show_*。 */
function wengineTicket(): string {
  try {
    return http.jar.getCookies(new URL("https://webvpn.tsinghua.edu.cn/")).find((c) => c.name === "wengine_vpn_ticket")?.value ?? "";
  } catch {
    return "";
  }
}

/** 宿主侧回环中继端口（0 = 未启动）。 */
let relayPort = 0;

/** 校外通道预热：经应用自身运输层对包装域发一次 GET，让原生 cookie 仓先完成
 *  wengine（必要时含统一认证）会话的建立/续期。缺这一步时，刚启动或刚登录后的首次
 *  上游请求会落在尚未建立的会话上、被弹回登录页——表现为「首次对话报 webvpn 会话已
 *  失效，重载插件后又好了」（2026-10-08 校外实录）。 */
async function warmUpWebvpn(): Promise<void> {
  try {
    const { nativeFetch } = await import("../lib/transport.js");
    await nativeFetch(webvpnWrap(`${SITE}/model-api/auth-login/check`), { method: "GET", timeoutMs: 20000 });
  } catch {
    /* 预热失败不阻断：后续中继上游的 502 分类会给出可读错误 */
  }
}

/** 取校外通道参数：优先起中继（幂等，失败重试一次）。
 *  Tauri 环境里中继起不来时**不再退化为「包装域 + 单张票」**——该路径实测必被弹回登录页
 *  （wengine 需要完整 cookie 集），静默退化只会把用户留给一句「webvpn 会话已失效」。
 *  此时留空基址，由 Rust 预检给出可操作提示；非 Tauri（单测/浏览器）才保留退化路径。 */
async function channelParamsForVpn(): Promise<{ base: string; cookie: string }> {
  const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const port = await invoke<number>("madmodel_relay_start", { upstreamBase: webvpnWrap(`${SITE}/v1`) });
      const fresh = port !== relayPort;
      relayPort = port;
      if (fresh) await warmUpWebvpn();
      return { base: `http://127.0.0.1:${port}/v1`, cookie: "" };
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  relayPort = 0;
  if (inTauri) {
    void logLine(`[MADMODEL] 中继启动失败，校外通道不可用：${lastErr instanceof Error ? lastErr.message : String(lastErr)}`).catch(() => undefined);
    return { base: "", cookie: "" };
  }
  return { base: webvpnWrap(`${SITE}/v1`), cookie: wengineTicket() };
}

/** 通道自愈：预热 webvpn 会话并刷新通道参数。供宿主在「通道类失败」后自动重试一次
 *  （把过去需要用户手动重载插件的场景收敛成一次透明重试）。 */
export async function healMadModelChannel(): Promise<void> {
  if (madmodelChannel() !== "webvpn") return;
  await warmUpWebvpn();
  await refreshChannelParams();
}

/** 是否属于「通道类」错误（可自动重试一次）：中继/包装域被弹回登录页，或直连吃 IP 门禁。 */
export function isChannelError(message: string): boolean {
  return message.includes("webvpn 会话已失效") || message.includes("307");
}

/** 切回直连时收掉中继（幂等）。 */
async function stopRelay(): Promise<void> {
  if (!relayPort) return;
  relayPort = 0;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("madmodel_relay_stop");
  } catch {
    /* 非 Tauri 环境忽略 */
  }
}

/** 校外通道参数刷新：每次对话前调用（中继幂等启动；退化路径则重取会话票，随响应轮换）。
 *  与现值相同则跳过写盘，避免每次对话都扰动设置。 */
async function refreshChannelParams(): Promise<void> {
  const ch = madmodelChannel();
  let base = "";
  let cookie = "";
  if (ch === "webvpn") {
    const got = await channelParamsForVpn();
    base = got.base;
    cookie = got.cookie;
  } else {
    await stopRelay();
  }
  const s = getPlugin(HARNESS_ID)?.settings ?? {};
  if (String(s.madmodelBase ?? "") === base && String(s.madmodelCookie ?? "") === cookie) return;
  writeSettings({ madmodelBase: base, madmodelCookie: cookie });
  if (base) void logLine(`[MADMODEL] 校外通道参数已更新：base=${base}`).catch(() => undefined);
}

/** 是否该续期 token（5h50min 阈值，6h 寿命留 10 分钟缓冲） */
export function madmodelDue(): boolean {
  const s = getPlugin(HARNESS_ID)?.settings ?? {};
  const at = Number(s.madmodelAt ?? 0);
  return !at || Date.now() - at > REFRESH_MS;
}

/** 直连请求是否被「弹进」统一认证/webvpn：传输层是手动逐跳跟随（Rust hop loop），
 *  `redirect: "manual"` 拦不住它——校外时 307 → oauth lb-auth → webvpn 包装域，终态 200。
 *  只看状态码会把校外误判成校内（2026-10-08 校外实录：探针报「校内」，通道走直连吃 307）。 */
function bouncedIntoWebvpn(res: Response): boolean {
  const finalUrl = res.headers.get("x-onethu-final-url") ?? res.url ?? "";
  return /webvpn\.tsinghua\.edu\.cn|oauth\.tsinghua\.edu\.cn\/lb-auth/.test(finalUrl);
}

/** 校内可达性探针：直连 GET /check。200 且**终点仍在直连域**=校内可达；被弹入 webvpn、
 *  30x 或异常=校外（IP 门禁）。 */
async function probeReachable(): Promise<boolean> {
  try {
    const res = await http.request(`${SITE}/model-api/auth-login/check`, { redirect: "manual", direct: true });
    const bounced = bouncedIntoWebvpn(res);
    const ok = res.status === 200 && !bounced;
    void logLine(`[MADMODEL] 可达性探针：HTTP ${res.status}${bounced ? "（被弹入 webvpn/统一认证）" : ""} → ${ok ? "校内" : "校外（IP 门禁）"}`).catch(() => undefined);
    return ok;
  } catch (e) {
    void logLine(`[MADMODEL] 可达性探针异常（按校外处理）：${e instanceof Error ? e.message : e}`).catch(() => undefined);
    return false;
  }
}

/** 定时器在浏览器是 number、在 Node 侧才有 unref；统一收窄一次，免得每处各写一层断言 */
function unrefTimer(t: unknown): void {
  (t as { unref?: () => void }).unref?.();
}

function writeSettings(patch: Record<string, string>): void {
  const prev = getPlugin(HARNESS_ID)?.settings ?? {};
  updatePlugin(HARNESS_ID, { settings: { ...prev, ...patch } });
}

/** 续期一枚新 token：统一认证发票 → 票据兑换（校内直连）。
 *  站点 2026-09-29 起关闭了免登录签发（无凭据 GET /check 恒返回 10001），
 *  换 token 只剩「SSO 发票」一途；票据单次有效，每次续期都要新取一张。 */
export async function ensureMadModelToken(force = false): Promise<string> {
  if (pumping && !force) throw new Error("续期进行中");
  pumping = true;
  try {
    const ticketUrl = await info.idServiceTicketUrl(ID_TICKET_FORM);
    const ticket = ticketUrl ? (/[?&]ticket=([^&#]+)/.exec(ticketUrl)?.[1] ?? "") : "";
    if (!ticket) {
      // 与「校外 IP 门禁」区分：这里是统一认证侧没给票（会话失效 / 需重新登录）
      // 诊断细因随行：no-id-credentials = 无内存凭据（未勾选「记住密码」或会话未恢复完成），
      // 其余为账密直登两变体的现场——用于区分「根本没凭据」与「直登被拒」
      void logLine(`[MADMODEL] 统一认证未给出票据（会话失效或需重新登录）：${String(info.lastDebug ?? "").replace(/\s+/g, " ").slice(0, 220)}`).catch(() => undefined);
      throw new Error("统一认证未给出票据——请先在 OneTHU 重新登录清华账号（勾选「信任此设备」可免二次认证）");
    }
    const ch = madmodelChannel();
    const redeemUrl = `${SITE}/model-api/auth-login/check?ticket=${encodeURIComponent(ticket)}`;
    // 校外自己先包成 webvpn URL 再发；direct:true 只是阻止 core 再包一层
    const res = await http.request(ch === "webvpn" ? webvpnWrap(redeemUrl) : redeemUrl, {
      redirect: "manual",
      direct: true,
    });
    const j = (await res.json().catch(() => null)) as { success?: boolean; data?: unknown; message?: string } | null;
    if (res.status === 200 && j?.success === true && typeof j.data === "string" && j.data) {
      const token = j.data;
      const patch: Record<string, string> = { madmodelToken: token, madmodelAt: String(Date.now()) };
      if (ch === "webvpn") {
        const got = await channelParamsForVpn(); // 校外：中继（或退化路径）
        patch.madmodelBase = got.base;
        patch.madmodelCookie = got.cookie;
      } else {
        // 校内：直连语义（清空通道参数并收掉中继）；reachable 由探针拥有
        patch.madmodelBase = "";
        patch.madmodelCookie = "";
        patch.madmodelReachable = "1";
        patch.madmodelReachableAt = String(Date.now());
        await stopRelay();
      }
      writeSettings(patch);
      void logLine(`[MADMODEL] token 已续期（len=${token.length}，SSO 票据兑换，通道=${ch}${ch === "webvpn" ? "，base=" + patch.madmodelBase : ""}）`).catch(() => undefined);
      return token;
    }
    if (res.status >= 300 && res.status < 400 || bouncedIntoWebvpn(res)) {
      // 校外 IP 门禁（307；或被弹进 webvpn 的那一跳）：保留旧 token（回校自动复用），
      // 可达性置 0 → config 回退自费或出提醒，下一轮对话即改走包装/中继通道
      writeSettings({ madmodelReachable: "0", madmodelReachableAt: String(Date.now()) });
      throw new Error("校外环境（MadModel IP 门禁 307），免费档不可用");
    }
    if (res.status === 200 && (res.headers.get("content-type") ?? "").includes("text/html")) {
      // 包装通道把兑换弹回了登录页：网络没问题，是 webvpn 会话未就绪
      throw new Error("webvpn 会话未就绪：兑换被弹回登录页——请先在 OneTHU 重新登录清华账号后重试");
    }
    throw new Error(`兑换被拒（HTTP ${res.status}${j?.message ? "：" + j.message : ""}）——请重新登录清华账号后重试`);
  } finally {
    pumping = false;
  }
}

/** 对话前兜底：免费档语义下保证「可达性状态新鲜 + token 到期即续」。
 *  - token 到期：完整重签（顺带刷新可达性）；
 *  - token 新鲜但可达性判定超 10 分钟：轻探针刷新（网络切换 10 分钟内自动纠正）。 */
export async function preflightMadModel(): Promise<string | null> {
  if (!madmodelActive()) return null;
  if (madmodelDue()) {
    try {
      await ensureMadModelToken();
      return null;
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      void logLine(`[MADMODEL] 续期失败：${why}`).catch(() => undefined);
      return freeTierHint(why);
    }
  }
  const s = getPlugin(HARNESS_ID)?.settings ?? {};
  const tok = String(s.madmodelToken ?? "");
  // 每次对话前都探一次（2026-10-08 校外实录复盘）：按 10 分钟 TTL 缓存会留下致命窗口——
  // 刚离校时判定仍是「校内」→ 通道算直连、清空 madmodelBase → 请求直奔校外 IP 吃 307。
  // 探测是一次直连 GET（约 20ms），换来通道判定永远跟得上网络切换。
  const ok = await probeReachable();
  writeSettings({ madmodelReachable: ok ? "1" : "0", madmodelReachableAt: String(Date.now()) });
  // 校外通道：每次对话前刷新（中继幂等；退化路径补会话票）——否则 Rust 侧可能
  // 拿到几小时前的死票（表现为「webvpn 会话已失效」）
  await refreshChannelParams();
  // token 为空但「未到期」只可能是设置被写坏（如手改设置页覆盖）——此时明确报出来
  if (!tok) return freeTierHint("设置里没有 madmodelToken");
  return null;
}

/** 免费档不可用时的用户可读说明：把真实原因说清楚，而不是让人以为「没填 API Key」。 */
function freeTierHint(why: string): string {
  return [
    "清华免费档（MadModel）暂不可用：" + why + "。",
    "· 换 token 需要清华统一认证会话：应用会自动发票并续期（每 10 分钟巡检）；若持续失败请重新登录清华账号；",
    "· 校外环境会自动改走应用内中继（webvpn 包装通道），无需连校园网；若该通道也不可用，",
    "  可连校园网/学校 VPN（EasyConnect），或在 设置 → 插件 → OneTHU Harness 切到「自费 API」。",
  ].join("\n");
}

/** 外部强制重签（run 遇 307 漏判兜底）：刷新 token/可达性，下一条对话即恢复正确通道 */
export async function forceRemint(): Promise<void> {
  await ensureMadModelToken(true).catch((e) =>
    void logLine(`[MADMODEL] 强制重签：${e instanceof Error ? e.message : String(e)}`).catch(() => undefined),
  );
}

/** 续期泵：启动即试一枚 + 每 10 分钟巡检（到期才真拉；顺带保持可达性新鲜） */
export function startMadModelPump(): void {
  const tick = (): void => {
    void preflightMadModel().catch((e) =>
      void logLine(`[MADMODEL] 泵巡检：${e instanceof Error ? e.message : String(e)}`).catch(() => undefined),
    );
  };
  void tick();
  // 冷启动竞态（2026-10-08 实测）：泵在模块加载即跑，而账密（CampusSession）要等
  // resumeSession 注入 → 首次必然「统一认证未给出票据」，要等下面 60s 那轮才补上。
  // 两次前导重试把可用窗口从 60s 压到秒级；稳态仍由这两条定时器兜底。
  for (const ms of [8_000, 20_000]) unrefTimer(setTimeout(tick, ms));
  unrefTimer(setInterval(tick, 10 * 60_000));
  // 免费档没签出来时 60s 快速重试（校园网刚连上/刚回校的场景，不必等满 10 分钟）
  unrefTimer(setInterval(() => {
    if (!madmodelActive()) return;
    if (String(getPlugin(HARNESS_ID)?.settings?.madmodelToken ?? "")) return;
    void preflightMadModel().catch(() => undefined);
  }, 60_000));
}
