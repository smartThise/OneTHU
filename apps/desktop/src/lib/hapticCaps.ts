/**
 * 老机型（无物理触感）能力判据（**纯函数、零依赖**，便于 tools/haptics-test.mjs 直接跑真值表）。
 *
 * 输入是壳侧探针 `ui_haptic_probe {kind:"caps"}` 回传的 `detail` 一行文本，输出三态：
 *   · `no`      = 判为老机型（静默白名单外全部档位）；
 *   · `yes`     = 现代机（现代机型行为一字不变）；
 *   · `unknown` = 探不到（探针失败 / 字段缺失 / 解析失败）→ 保持现状，**不静默**。
 *
 * 判据是**能力组合**（绝不做机型名单）：
 *   1. `ampCtl=false`（`Vibrator.hasAmplitudeControl()` 为假）→ `no`：连幅度控制都没有，
 *      无法表达强度，直接按老机型处理；
 *   2. `ampCtl=true` 时再看两项能力位——系统组合原语个数 `primsN`、厂商标定扩展效果块
 *      `extFx`（161..192；本仓 A2 调音选用的 167/186 就在这一块里）。两项都为 0 → `no`；
 *   3. 三段字段缺任一段 → `unknown`（绝不允许探测失败把现代机型的触感全部关掉）。
 *
 * 真机读数（2026-10-04，两台机器上的 dev 包直调探针，未用覆盖开关）：
 *   · 退役机（Android 12）：`sdk=31 ampCtl=true primsN=0 extFx=0` → `no`；
 *   · 日常机（Android 16）：`sdk=36 ampCtl=true primsN=0 extFx=32` → `yes`。
 *   两台机器的 `mSupportedPrimitives` / `mMaxAmplitudes count` / `mResonantFrequency` 都为空或
 *   NaN，公开 API 里能区分两者的能力位只有 HAL 标定扩展效果表；`maxAmplitudesCount` 在
 *   android.jar 里没有任何公开读法（`Vibrator` 只有 ampCtl / areAll(Primitives|Effects)Supported
 *   / getPrimitiveDurations，`getResonantFrequency`/`getQFactor` 是 API 34 且日常机返回 NaN），
 *   因此不采用。代价（已在文档 §21 登记）：个别 API 31–33、既无 primitives 又无该扩展块的机器
 *   会被判老机型（过度静默）——失败方向是「安静」而不是「乱震」。
 */
export type HapticCaps = "yes" | "no" | "unknown";

/** detail 单行能力表 → 三态。纯函数：同输入恒同输出，无副作用。 */
export function decodeHapticCaps(detail: string): HapticCaps {
  const amp = /(?:^|\s)ampCtl=(true|false)(?:\s|$)/.exec(detail);
  if (!amp) return "unknown";
  /* ① 无幅度控制：直接老机型（不再要求后两段——这一段单独就是充分条件） */
  if (amp[1] === "false") return "no";
  /* ② 有幅度控制：必须同时拿到两项能力位，缺任一项保持 unknown */
  const prims = /(?:^|\s)primsN=(\d+)(?:\s|$)/.exec(detail);
  const ext = /(?:^|\s)extFx=(\d+)(?:\s|$)/.exec(detail);
  if (!prims || !ext) return "unknown";
  return Number(prims[1]) > 0 || Number(ext[1]) > 0 ? "yes" : "no";
}

/**
 * 老机型上「这一档要不要静默」的**纯判定**（与 lib/haptics.ts 的唯一判定点同源，便于护栏跑真值表）。
 *
 *   · `caps !== "no"`（支持 / 没探到）→ 一律不静默（现代机型逐档不变；unknown 保持现状）；
 *   · 白名单外 → 静默；
 *   · `longPress` → 放行（这一档语义唯一，没有共用来源）；
 *   · 白名单内的**共用档**（`tick` 同时被普通按钮委托复用）→ 只有调用点显式声明
 *     `legacyKeep` 才放行，否则静默。`legacyKeep` **不能**把白名单外的档捞回来。
 */
export function silenceOnLegacy(
  caps: HapticCaps,
  effect: string,
  keep: readonly string[],
  legacyKeep: boolean,
): boolean {
  if (caps !== "no") return false;
  if (!keep.includes(effect)) return true;
  if (effect === "longPress") return false;
  return !legacyKeep;
}
