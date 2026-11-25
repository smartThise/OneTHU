#!/usr/bin/env node
/** 自动重登 10 项缺陷的静态/纯逻辑回归（R1 的 HTTP 行为另有 http-replay.smoke）。 */
import { readFile } from "node:fs/promises";

const fails = [];
const ok = (c, m) => { if (!c) { fails.push(m); } };
const read = (p) => readFile(new URL("../" + p, import.meta.url), "utf8");

const [clients, infoLib, reload, secure, http, core, loginGate, lifecycle] = await Promise.all([
  read("apps/desktop/src/lib/clients.ts"),
  read("apps/desktop/src/lib/infoLib.ts"),
  read("apps/desktop/src/lib/reload.ts"),
  read("apps/desktop/src/lib/secureSecret.ts"),
  read("packages/core/src/http.ts"),
  read("packages/info-lib/src/lib/core.ts"),
  read("apps/desktop/src/lib/loginGate.ts"),
  read("apps/desktop/src/lib/sessionLifecycle.ts"),
]);

/* R2：登出是运行时权威位 */
ok(lifecycle.includes("signedOut = true") && lifecycle.includes("export function isSignedOut"), "R2 运行时标志存在");
ok(clients.includes("markSignedOut()") && clients.includes("markSignedIn()"), "R2 登录/登出维护标志");
ok(infoLib.includes("isSignedOut()") && reload.includes("isSignedOut()"), "R2 守卫/保活读取标志");

/* R3：后台恢复禁止交互式 2FA，且登录挂起时早退 */
ok(infoLib.includes("withNonInteractiveRecovery") && infoLib.includes("AUTH_2FA_REQUIRED"), "R3 后台 2FA 快速失败");
ok(infoLib.includes("libLoginPending()") && infoLib.includes("LIB-ENSURE skip: login pending"), "R3 登录挂起时不让路");

/* R4：只读探针不再报活 */
ok(infoLib.includes("probe=unknown") && infoLib.includes("return false;"), "R4 网关票按 unknown fail-closed");

/* R5：正文特征必须有登录语境（核心行为由 http-replay 覆盖） */
ok(http.includes("HTTP-AUTH-SUSPECT"), "R5 误判可观测");

/* R6：登录冷却按账号隔离（源码级契约；运行时逻辑在浏览器） */
ok(loginGate.includes("function keyOf(account") && loginGate.includes("STORAGE_PREFIX"), "R6 冷却键按账号");
ok(infoLib.includes("loginCooldownLeftMs(helper.userId)"), "R6 会话守卫按账号查冷却");

/* R7：记住密码不再走可逆 XOR 落盘 */
ok(secure.includes("non-extractable") && secure.includes("AES-GCM"), "R7 使用不可导出 WebCrypto 密钥");
ok(clients.includes("await encryptSecret(pendingSecret.password)") && clients.includes("password not persisted"), "R7 加密失败不落盘");
ok(!clients.includes("secret: obfuscateSecret(pendingSecret.password"), "R7 密码路径不写 XOR");

/* R8：强制重登受冷却约束 */
ok(infoLib.includes("FORCE-RELOGIN skip: login cooldown") && infoLib.includes("loginCooldownLeftMs(account)"), "R8 强制重登检查冷却");

/* R9：并发接力后重探目标域 */
ok(core.includes("verifyAndReLogin") && core.includes("probeUserDataAlive"), "R9 接力后重探");

/* R10：窗口内排队 + 看门狗退避 */
ok(reload.includes("queueRecovery") && reload.includes("RECOVERY_BACKOFF"), "R10 排队/退避");
ok(reload.includes("20_000 - (now - lastAttempt)"), "R10 窗口内排到窗口结束");

if (fails.length) {
  console.error("auth-auto-relogin-regression: " + fails.length + " 项失败");
  for (const f of fails) console.error(" ✗ " + f);
  process.exit(1);
}
console.log("auth-auto-relogin-regression: 全部通过");
