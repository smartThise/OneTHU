/**
 * A2 触感唯一入口（唯一允许 invoke `ui_haptic_tick` 的地方）。
 *
 * 为什么收口：触感调用点只会越来越多（底栏、tab、开关、普通按钮、长按、作业流切卡…），
 * 每个点各写一遍 invoke + 降级 + 日志会立刻长成一片；这里收成一处，调用点只写
 * `haptic("click")`。护栏 tools/haptics-test.mjs 断言全仓只有这一处邀请那条命令。
 *
 * 效果矩阵（与 Kotlin 侧 predefinedId 一一对应，改一边必须改另一边）——**五档全走系统
 * 预定义效果**（霖 2026-09-30 #5：自绘波形只是「震」，系统标定波形才有真触感；
 * 该系统只有 6 个标定效果，见 Kotlin 注释里的 Hapticsconfig/HapticsPolicy 取证）：
 *   click     底栏项、tab 切换（胶囊是弹性动画，所以触感要「弹」而不是拖长）→ EFFECT_CLICK(0)
 *   reject    操作被拒绝（双脉冲，语义就是「不行」）                        → EFFECT_DOUBLE_CLICK(1)
 *   tick      轻量按钮 / 涟漪                                             → EFFECT_TICK(2)
 *   longPress 长按触发（闷一点的「按住」）                                 → EFFECT_THUD(3)
 *   heavy     开关切换（物理开关「咔哒」的实感）                            → EFFECT_HEAVY_CLICK(5)
 *
 * 降级链：Kotlin 预烘焙 → 自绘波形 → 旧式 vibrate；**整条 invoke 失败**才回落到
 * `navigator.vibrate`。PC（非 Android 宿主）直接 return，**不打日志**（PC 上没有振动，
 * 刷日志只会把开发面板淹掉）。
 *
 * 节流：同一瞬间只发一次，且强度分档——弱者不覆盖强者。底栏自己发 CLICK 之后，
 * 全局委托补发的 TICK 会被吃掉，避免一次点击振两下。
 *
 * 老机型（霖 2026-10-04 老机型适配，b29 收紧）：转子/无物理触感的机器上，把调校过的五档
 * 全部回放成一声「不符合直觉的震动」，所以要**按调用点**只放行两处——长按反馈，以及作业
 * 瀑布流切卡反馈；其余一律静默（不振动、不打日志、不报错）。`tick` 同时是全局委托给普通
 * 按钮（`.btn`）的通用档，所以它必须由调用点显式声明 `legacyKeep` 才放行（见 `haptic()`），
 * 这样老机型上普通按钮点击静默、切卡仍有反馈。判定走一次性能力探针（结果缓存，绝不每次
 * 调用再探）；探针失败/字段缺失一律保持现状——绝不允许因为探测失败把现代机型的触感全关掉。
 */
import { isAndroidNavigator } from "./androidHost.js";
import { isTauri } from "./transport.js";
import { decodeHapticCaps, silenceOnLegacy, type HapticCaps } from "./hapticCaps.js";

export type HapticEffect = "tick" | "click" | "heavy" | "longPress" | "reject";

/** 效果白名单（tools/haptics-test.mjs 会与 Kotlin 侧分支集合比对，两边必须一致） */
export const HAPTIC_EFFECTS: readonly HapticEffect[] = ["tick", "click", "heavy", "longPress", "reject"];

/** 强度分档：数字越大越「重」，节流窗口内弱者让位给强者 */
const STRENGTH: Record<HapticEffect, number> = { tick: 1, click: 2, heavy: 3, longPress: 3, reject: 3 };

/**
 * 老机型（无物理触感）静默白名单：只放行这两档的**调用点**。
 *   · `longPress` — 长按触发（components/ContextMenu.tsx），无条件放行；
 *   · `tick`      — 作业瀑布流切卡（pages/TasksPage.tsx，该处显式传 `legacyKeep: true`）。
 * `tick` 同时是全局委托给普通按钮（`.btn`）的档位（lib/haptics.ts 的 installGlobalHaptics），
 * 那一处**不传** `legacyKeep`，因此在老机型上被静默——这正是霖「只保留长按 + 作业瀑布流
 * 切卡」的按调用点口径。其余 effect 在判定为老机型时直接静默返回。
 */
export const LEGACY_HAPTIC_KEEP: readonly HapticEffect[] = ["longPress", "tick"];

/** 同一控件 60ms 内只触发一次（防连点风暴） */
const THROTTLE_MS = 60;

/** invoke 整条链失败时的兜底脉冲（ms）：与 Kotlin 侧 <26 的 legacy 口径一致 */
const FALLBACK_MS: Record<HapticEffect, number> = { tick: 15, click: 20, heavy: 30, longPress: 30, reject: 25 };

/** `haptic()` 的调用点选项。`legacyKeep`：本档位在白名单内、且**这一处**要在老机型上放行
 *  （用于 `tick`：切卡放行、普通按钮不放行）。现代机型上该参数不参与任何判断。 */
export interface HapticOptions {
  legacyKeep?: boolean;
}

let lastAt = 0;
let lastStrength = 0;
let failureLogged = false;

/**
 * 老机型判定结果：`yes`=支持物理触感 / `no`=不支持（转子等）/ `unknown`=没探到。
 * 初值是 `unknown`，也就是「探针没落地」——此时行为与探针落地前**完全一致**（不静默）。
 * 取值由 lib/hapticCaps.ts 的 `decodeHapticCaps()` 决定（能力组合，见那个文件）。
 */
let hapticCaps: HapticCaps = "unknown";
let hapticCapsProbed = false;

/**
 * 一次性能力探测（结果缓存进 `hapticCaps`，绝不在每次触感调用时再探）。
 *
 * 判据是 lib/hapticCaps.ts 的能力组合（`ampCtl` + 组合原语数 + 厂商标定扩展效果块），
 * 不是机型名单。失败兜底（护栏钉住）：invoke 抛错 / `ok !== true` / `detail` 缺字段 /
 * 正则匹配不上 → 一律保持 `unknown`，**不静默**。绝不允许探测失败把现代机型的触感全关掉。
 */
function probeHapticCapsOnce(): void {
  if (hapticCapsProbed) return;
  hapticCapsProbed = true;
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke<{ ok?: boolean; detail?: string }>("ui_haptic_probe", { kind: "caps" }))
    .then((r) => {
      if (r?.ok !== true) return;
      hapticCaps = decodeHapticCaps(String(r?.detail ?? ""));
    })
    .catch(() => undefined);
}

/**
 * 老机型判定结果的**唯一事实**：dev 覆盖开关优先（真机取证用，不是用户可见设置）。
 * `window.__onethuHapticCapsOverride = false` 强制「无物理触感」；`= true` 强制现代机；
 * 其余（含 undefined）用一次性探测结果——`unknown` 会一路走到「不静默」（保持现状）。
 */
function capsState(): HapticCaps {
  const ov = (globalThis as { __onethuHapticCapsOverride?: unknown }).__onethuHapticCapsOverride;
  if (ov === true) return "yes";
  if (ov === false) return "no";
  return hapticCaps;
}

/** **唯一判定点**：老机型上是否要静默这一档。判定本体是纯函数 `silenceOnLegacy()`（可跑真值表）：
 *  白名单外的档一律静默；`longPress` 无条件放行；共用档 `tick` 只有调用点显式声明 `legacyKeep`
 *  才放行——`tick` 的通用按钮委托不声明，所以老机型上普通按钮静默。 */
function shouldSilenceLegacy(effect: HapticEffect, legacyKeep: boolean): boolean {
  return silenceOnLegacy(capsState(), effect, LEGACY_HAPTIC_KEEP, legacyKeep);
}

/** 移动外壳：Android 宿主 + Tauri 注入，缺任一都不发命令（Android 浏览器预览也不发） */
function isMobileShell(): boolean {
  if (!isTauri) return false;
  return isAndroidNavigator(typeof navigator !== "undefined" ? navigator : undefined);
}

/** 触发一次触感：PC 静默跳过，失败一律静默，绝不阻塞主线程。 */
export function haptic(effect: HapticEffect, opts?: HapticOptions): void {
  if (!isMobileShell()) return;
  probeHapticCapsOnce();
  /* 老机型（无物理触感）静默：必须放在节流记账**之前**——被静默的一档若占掉 60ms 窗口，
     会把紧随其后的长按反馈（白名单内）一起压掉。 */
  if (shouldSilenceLegacy(effect, opts?.legacyKeep === true)) return;
  const now = performance.now();
  const strength = STRENGTH[effect];
  if (now - lastAt < THROTTLE_MS && strength <= lastStrength) return;
  lastAt = now;
  lastStrength = strength;
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke<{ ok?: boolean; mode?: string }>("ui_haptic_tick", { effect }))
    .then((r) => {
      /* 跨机型排查：只记一次实际路径。prebaked=各 ROM 自家标定波形（理想）；
         waveform/legacy=该机 HAL 不认预烘焙，已降级自绘波形（手感会略弱）。 */
      if (r?.mode && r.mode !== "prebaked" && !failureLogged) {
        failureLogged = true;
        void import("./clients.js")
          .then((m) => m.logLine(`[HAPTIC] 预烘焙不可用，降级路径=${r.mode}`))
          .catch(() => undefined);
      }
    })
    .catch(() => {
      try {
        navigator.vibrate?.(FALLBACK_MS[effect]);
      } catch {
        /* 静默 */
      }
    });
}

/**
 * A2 触感探针（**只诊断用，正式路径不调用**；霖 2026-09-30 #5 要求把这条探针随包发出）。
 *
 * 起因：自绘波形在这台机器上怎么调都只是「震」，而系统设置里那些「弹性/波纹/咔嗒/清脆碰撞」
 * 才是真触感。真机事实（`dumpsys vibrator_manager` + `/vendor/etc/Hapticsconfig.xml`）：
 *   · `supportedPrimitives = []`、`HapticsPolicy.xml` 的 `hapticsComposeAPI` 为空 → 组合原语没戏；
 *   · `hapticsPerformAPI` 放行 `effect_id = 0,1,2,3,4,5` → 只有这 6 个预定义效果是系统标定过的。
 * 所以探针按 id 逐个试预定义效果（附 hfc / wave / caps 三种对照与能力表），
 * 用 `dumpsys vibrator_manager` 的记录 + 手感挑档位。
 */
export async function hapticProbe(spec: {
  kind: "caps" | "prebaked" | "hfc" | "wave" | "primitive";
  id?: number;
  constant?: number;
  ms?: number;
  amp?: number;
  ops?: string; usage?: string;
}): Promise<unknown> {
  if (!isMobileShell()) return { ok: false, reason: "not-android" };
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke("ui_haptic_probe", spec);
  } catch {
    return { ok: false, reason: "invoke-failed" };
  }
}

/**
 * 全局委托：开关、tab、普通按钮三族在 DOM 里数量太大（光 `.btn` 就近 500 处），
 * 逐个加调用点不现实，统一在**捕获阶段**按最近的语义祖先发一次——比组件自己的 onClick
 * 更早，手感是「按下即反馈」而不是「处理完才反馈」。
 *
 * 底栏（`.bottom-nav`）由 BottomNav 自己发 CLICK，这里跳过，别振两下。
 */
export function installGlobalHaptics(): () => void {
  /* 老机型判定要在第一次交互前就拿到：挂载时先探一次（结果缓存，后续零开销） */
  probeHapticCapsOnce();
  /* 长按触感恢复（霖 2026-10-02）：先把 WebView 自己那条系统长按反馈关掉，
     否则本仓恢复的 longPress 会与它叠成两声。只影响 View 层反馈，本仓触感不受影响；
     非移动外壳静默跳过（PC 上没有这条路）。 */
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("ui_web_haptics_off"))
    .catch(() => undefined);
  const onClick = (e: MouseEvent): void => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest('[role="switch"]')) {
      haptic("heavy");
      return;
    }
    if (t.closest('[role="tab"]')) {
      haptic("click");
      return;
    }
    if (t.closest(".bottom-nav")) return;
    /* 普通按钮的通用轻触档：老机型上必须静默，所以**不传** `legacyKeep`
       （作业瀑布流切卡那一处单独在 TasksPage 里显式放行）。 */
    if (t.closest(".btn")) haptic("tick");
  };
  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}
