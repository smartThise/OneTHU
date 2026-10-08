import { http } from "../lib/clients.js";
import { getPlugin, updatePlugin } from "../plugins/registry.js";
import { logLine } from "../lib/clients.js";

/** 清华 MadModel（校园网免费 DeepSeek）token 泵 + 校外兜底。
 *  站点语义（thu-tok-auto 实测定案 + 本机复测）：
 *  - GET /model-api/auth-login/check 校园网内免登录签发 6h JWT；
 *  - 校外 IP 全域 307 弹 SSO（IP 门禁在 token 校验之前；webvpn 未收录该域，
 *    SSO ticket 兑换同样被拦）——校外唯一出路是校园网/学校 VPN（EasyConnect），
 *    或切自费 API。本模块：探针判定校内可达性 → 免费档/自费自动调度。 */

const SITE = "https://madmodel.cs.tsinghua.edu.cn";
const REFRESH_MS = 5 * 3600_000 + 50 * 60_000;
const REACH_TTL_MS = 10 * 60_000;
const HARNESS_ID = "onethu.harness";

let pumping = false;

/** 是否处于 madmodel 免费档语义（显式 custom 或「未显式但已填 key」则免打扰） */
function madmodelActive(): boolean {
  const s = getPlugin(HARNESS_ID)?.settings ?? {};
  const provider = String(s.provider ?? "");
  if (provider === "custom") return false;
  if (!provider && s.apiKey) return false; // 老用户迁移安全：维持自费
  return true;
}

/** 是否该续期 token（5h50min 阈值，6h 寿命留 10 分钟缓冲） */
export function madmodelDue(): boolean {
  const s = getPlugin(HARNESS_ID)?.settings ?? {};
  const at = Number(s.madmodelAt ?? 0);
  return !at || Date.now() - at > REFRESH_MS;
}

/** 校内可达性探针：直连 GET /check（绕 webvpn 包装、不跟随重定向）。
 *  200=校内可达；30x=IP 门禁（校外）；异常=网络不通，同样按校外处理。 */
async function probeReachable(): Promise<boolean> {
  try {
    const res = await http.request(`${SITE}/model-api/auth-login/check`, { redirect: "manual", direct: true });
    const ok = res.status === 200;
    void logLine(`[MADMODEL] 可达性探针：HTTP ${res.status} → ${ok ? "校内" : "校外（IP 门禁）"}`).catch(() => undefined);
    return ok;
  } catch (e) {
    void logLine(`[MADMODEL] 可达性探针异常（按校外处理）：${e instanceof Error ? e.message : e}`).catch(() => undefined);
    return false;
  }
}

function writeSettings(patch: Record<string, string>): void {
  const prev = getPlugin(HARNESS_ID)?.settings ?? {};
  updatePlugin(HARNESS_ID, { settings: { ...prev, ...patch } });
}

/** 校内直连签发一枚新 token。失败（校外/网络不通）→ reachable=0 交给 config 回退。 */
export async function ensureMadModelToken(force = false): Promise<string> {
  if (pumping && !force) throw new Error("续期进行中");
  pumping = true;
  try {
    let token = "";
    try {
      const res = await http.request(`${SITE}/model-api/auth-login/check`, { redirect: "manual", direct: true });
      const j = (await res.json().catch(() => null)) as { success?: boolean; data?: unknown } | null;
      if (res.status === 200 && j?.success === true && typeof j.data === "string" && j.data) token = j.data;
    } catch (e) {
      void logLine(`[MADMODEL] 直连签发异常：${e instanceof Error ? e.message : e}`).catch(() => undefined);
    }
    if (token) {
      writeSettings({ madmodelToken: token, madmodelAt: String(Date.now()), madmodelReachable: "1", madmodelReachableAt: String(Date.now()), madmodelBase: "", madmodelCookie: "" });
      void logLine(`[MADMODEL] token 已续期（len=${token.length}，校内直连）`).catch(() => undefined);
      return token;
    }
    // 校外/失败：保留旧 token（回校自动复用），可达性置 0——config 自动回退自费或报提醒
    writeSettings({ madmodelReachable: "0", madmodelReachableAt: String(Date.now()) });
    throw new Error("校外环境（MadModel IP 门禁 307），免费档不可用");
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
  const at = Number(s.madmodelReachableAt ?? 0);
  if (!at || Date.now() - at > REACH_TTL_MS) {
    const ok = await probeReachable();
    writeSettings({ madmodelReachable: ok ? "1" : "0", madmodelReachableAt: String(Date.now()) });
  }
  // token 为空但「未到期」只可能是设置被外部写坏（如手改设置页覆盖）——此时明确报出来
  if (!tok) return freeTierHint("免费档还没有取到登录信息（可稍后重试，或切到自费 API）");
  return null;
}

/** 免费档不可用时的用户可读说明：把真实原因说清楚，而不是让人以为「没填 API Key」。 */
function freeTierHint(why: string): string {
  return [
    "清华免费档（MadModel）暂不可用：" + why + "。",
    "· 校园网内会自动续期（本应用每 10 分钟自动检查一次），可稍候重试；",
    "· 校外 / 走了代理或 VPN 时 IP 门禁会拦（MadModel 仅限校内 IP）——请连校园网或学校 VPN（EasyConnect），",
    "  或在 设置 → 插件 → OneTHU Harness 填入自费 API Key 并把模型源切到「自费 API」。",
  ].join("\n");
}

/** 外部强制重签（run 遇 307 漏判兜底）：刷新 token/可达性，下一条对话即恢复正确通道 */
export async function forceRemint(): Promise<void> {
  await ensureMadModelToken(true).catch((e) =>
    void logLine(`[MADMODEL] 强制重签：${e instanceof Error ? e.message : String(e)}`).catch(() => undefined),
  );
}

/** 连续「校外 / 拿不到登录信息」时快速重试的退避（b25 收紧）。
 *  b25 真机实测（前台静置 5 分钟）：旧的「60s 无条件快试」在已知校外的情况下仍每 60s
 *  发一轮 3 跳请求 + 4 行日志（`[MADMODEL] 续期失败：校外环境…`），而「校外 IP 门禁」
 *  这个结论不会随分钟变化。收紧为按连续失败次数指数退避：首次仍是 60s（保住「刚连上
 *  校园网/刚回校」的快速恢复），此后 2 → 4 → **5 分钟封顶**；拿到登录信息或探针判校内
 *  立即复位。10 分钟的大巡检（上面的 `tick`）与对话前的按需 `preflightMadModel()` 都不受影响。 */
let fastRetryBackoffMs = 60_000;
let fastRetryAt = 0;

/** 续期泵：启动即试一枚 + 每 10 分钟巡检（到期才真拉；顺带保持可达性新鲜） */
export function startMadModelPump(): void {
  const tick = (): void => {
    void preflightMadModel().catch((e) =>
      void logLine(`[MADMODEL] 泵巡检：${e instanceof Error ? e.message : String(e)}`).catch(() => undefined),
    );
  };
  void tick();
  setInterval(tick, 10 * 60_000).unref?.();
  // 免费档没签出来时的快速重试（校园网刚连上/刚回校的场景，不必等满 10 分钟）
  setInterval(() => {
    if (!madmodelActive()) return;
    if (String(getPlugin(HARNESS_ID)?.settings?.madmodelToken ?? "")) {
      fastRetryBackoffMs = 60_000;
      fastRetryAt = 0;
      return;
    }
    if (Date.now() < fastRetryAt) return;
    void preflightMadModel()
      .then(() => {
        const st = getPlugin(HARNESS_ID)?.settings ?? {};
        if (String(st.madmodelToken ?? "") || st.madmodelReachable === "1") {
          fastRetryBackoffMs = 60_000;
          fastRetryAt = 0;
          return;
        }
        fastRetryBackoffMs = Math.min(fastRetryBackoffMs * 2, 5 * 60_000);
        fastRetryAt = Date.now() + fastRetryBackoffMs;
      })
      .catch(() => {
        fastRetryAt = Date.now() + fastRetryBackoffMs;
      });
  }, 60_000).unref?.();
}
