#!/usr/bin/env node
/**
 * A2 护栏：触感只有一个入口，且「效果矩阵 / 降级链 / PC 静默 / 节流 / 调用点」齐全。
 *
 * 由来：触感调用点会越来越多（底栏、tab、开关、普通按钮、长按、作业流切卡…），
 * 一旦有人在自己组件里再写一遍 `invoke("ui_haptic_tick")` 或 `navigator.vibrate`，
 * 降级链与节流就会分叉（有的振两下、有的 PC 上刷日志）。所以本护栏做源码级断言：
 *
 *   1. 全仓只有 apps/desktop/src/lib/haptics.ts 碰 `ui_haptic_tick` 与 `navigator.vibrate`；
 *   2. 前端 `HAPTIC_EFFECTS` 与 Kotlin `predefinedId` 的效果集合**必须一致**，且五档都指向
 *      系统预定义效果（霖 2026-09-30 #5 返工口径：自绘波形只是「震」，系统标定才有真触感）；
 *   3. `haptic()` 第一句就是 PC 提前 return，且 Rust 桌面分支静默返回 not-android、不打日志；
 *   4. 同一瞬间只发一次：`THROTTLE_MS = 60` 且弱者让位给强者（防一次点击振两下）；
 *   5. 五个调用点齐全：底栏 / tab / 开关 / 普通按钮 / 作业流切卡。
 *      （A3 的长按菜单落地后，这里再把 `haptic("longPress")` 钉进来——文件存在就断言。）
 *   6. 探针（`hapticProbe` → `ui_haptic_probe`）必须只有诊断入口这一条，正式路径一次都不许调。
 *   7. 老机型（无物理触感）静默策略：白名单只有 longPress + tick 两个**调用点**、判定点唯一、
 *      结果只探一次、探针失败保持现状（unknown 不静默）、静默判断在节流记账之前、dev 覆盖开关双向可用。
 *      （霖 2026-10-04 老机型适配；b29 收紧：「只保留长按反馈与作业瀑布流切卡反馈」）
 *   8. b29：判据是**能力组合**（lib/hapticCaps.ts 的纯函数，真值表直接跑）——ampCtl=false 判老机型；
 *      ampCtl=true 时 primsN/extFx 两项都为 0 才判老机型；缺字段/解析失败判 unknown。
 *      保留档必须**按调用点**收口：切卡显式 `legacyKeep`，普通按钮委托（`.btn`）不传、老机型静默。
 *      走自动判据（覆盖开关只做双向对照的旁路）。
 *
 * 跑法：node tools/haptics-test.mjs ｜ 退出码 0（通过）/ 1（违规）
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/* b29 判据是纯函数（零依赖），护栏直接跑真值表——不是源码级「看起来对」 */
const { decodeHapticCaps, silenceOnLegacy } = await import("../apps/desktop/src/lib/hapticCaps.ts");
const KEEP = ["longPress", "tick"];

const HAPTICS = "apps/desktop/src/lib/haptics.ts";
const LAYOUT = "apps/desktop/src/components/Layout.tsx";
const TASKS = "apps/desktop/src/pages/TasksPage.tsx";
const CONTEXT_MENU = "apps/desktop/src/components/ContextMenu.tsx";
const KOTLIN =
  "apps/desktop/src-tauri/plugins/onethu-mobile/android/src/main/java/app/onethu/mobile/OnethuMobilePlugin.kt";
const RUST = "apps/desktop/src-tauri/src/lib.rs";
/** 与文档 A2 的效果矩阵一致（顺序无关，比对前排序） */
const EXPECTED = ["click", "heavy", "longPress", "reject", "tick"];

/** 注释按等长空格遮蔽：注释里提到 navigator.vibrate / log 都不算正文（曾被自己写的注释误报） */
const maskComments = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
const read = (p) => maskComments(readFileSync(p, "utf8"));
const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
};

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p.split("\\").join("/"));
  }
  return out;
}

const haptics = read(HAPTICS);
const kotlin = read(KOTLIN);
const rust = read(RUST);
const layout = read(LAYOUT);

/* ① 唯一入口 ---------------------------------------------------------------- */
for (const f of walk("apps/desktop/src")) {
  if (f === HAPTICS) continue;
  const src = read(f);
  ok(!src.includes("ui_haptic_tick"), `${f} 直接调 ui_haptic_tick：触感必须走 lib/haptics.ts`);
  ok(!/navigator\.vibrate/.test(src), `${f} 直接用 navigator.vibrate：兜底只允许在 lib/haptics.ts`);
}
ok(
  /invoke<\{ ok\?: boolean; mode\?: string \}>\("ui_haptic_tick", \{ effect \}\)/.test(haptics),
  "haptics.ts 没有把 effect 透传给命令",
);
ok(/void import\("@tauri-apps\/api\/core"\)/.test(haptics), "haptics.ts 应动态引入 Tauri API（浏览器预览不该被打包进来）");

/* ② 效果矩阵：前端白名单 == Kotlin 分支集合 ---------------------------------- */
const listMatch = /export const HAPTIC_EFFECTS: readonly HapticEffect\[\] = \[([^\]]+)\]/.exec(haptics);
const jsEffects = listMatch ? [...listMatch[1].matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]).sort() : [];
ok(
  JSON.stringify(jsEffects) === JSON.stringify(EXPECTED),
  `HAPTIC_EFFECTS 白名单与 A2 矩阵不一致：${jsEffects.join("/") || "（解析不到）"}`,
);
const ktNames = new Set([...kotlin.matchAll(/"([a-zA-Z]+)" ->/g)].map((m) => m[1]));
for (const name of EXPECTED) {
  ok(ktNames.has(name), `Kotlin 效果矩阵缺 ${name}（前端白名单与 Kotlin 分支必须一一对应）`);
}
/* 五档 → 系统预定义效果 id（0–5 来自 /vendor/etc/Hapticsconfig.xml 的原始 PCM；167/186 是厂商标定 id）
   2026-10-01 霖强弱微调后：click=POP(4)、tick=THUD(3)。 */
for (const [name, lit] of [
  ["click", "ID_POP"],
  ["reject", "ID_REJECT_DEEP"],
  ["tick", "ID_THUD"],
  ["longPress", "ID_BOUNCE"],
  ["heavy", "ID_POP"],
]) {
  ok(
    new RegExp(`"${name}" -> ${lit}`).test(kotlin),
    `Kotlin 预定义效果映射缺/错 ${name} → ${lit}（霖定的口径：click=POP、tick=THUD、heavy=POP、longPress=167、reject=186）`,
  );
}
for (const [lit, n] of [["ID_CLICK", 0], ["ID_POP", 4], ["ID_THUD", 3], ["ID_TICK", 2], ["ID_BOUNCE", 167], ["ID_REJECT_DEEP", 186]]) {
  ok(new RegExp(`private val ${lit} = ${n}\\b`).test(kotlin), `${lit} 不是 ${n}（id 必须与厂商表/霖的选型一致）`);
}
/* 第二跳：厂商 id 不被该 ROM 支持时要退回 AOSP 标定 id，不能直接掉到自绘波形 */
for (const [name, lit] of [
  ["click", "ID_POP"],
  ["reject", "ID_DOUBLE_CLICK"],
  ["tick", "ID_THUD"],
  ["longPress", "ID_THUD"],
  ["heavy", "ID_HEAVY_CLICK"],
]) {
  ok(
    new RegExp(`private fun aospId\\(effect: String\\): Int = when \\(effect\\) \\{[\\s\\S]{0,240}?"${name}" -> ${lit}`).test(kotlin),
    `aospId 缺 ${name} → ${lit}（厂商 id 在别家 ROM 上可能不存在）`,
  );
}
ok(
  /listOf\(predefinedId\(effect\), aospId\(effect\)\)\.distinct\(\)/.test(kotlin),
  "playHaptic 没有按「厂商 id → AOSP id」的顺序逐个试（直接落到自绘就是「只是震」的老毛病）",
);
ok(
  !/VibrationEffect\.EFFECT_(THUD|POP|LONG_PRESS|REJECT|GESTURE_END)/.test(kotlin),
  "又用回了非公开常量（EFFECT_THUD/EFFECT_POP/EFFECT_LONG_PRESS/EFFECT_REJECT 在 compileSdk 36 里解析不到，会编译失败）",
);
ok(/class HapticArgs \{\s*\n\s*var effect: String\? = null/.test(kotlin), "Kotlin 没有 HapticArgs.effect 参数");
ok(/invoke\.parseArgs\(HapticArgs::class\.java\)\.effect \?: "tick"/.test(kotlin), "Kotlin 没有解析 effect（旧调用点应兜底 tick）");
ok(/json!\(\{ "effect": effect \}\)/.test(rust), "Rust 没有把 effect 透传给移动插件");

/* ③ PC 静默 ----------------------------------------------------------------- */
const hapticBody = /export function haptic\(effect: HapticEffect, opts\?: HapticOptions\): void \{([\s\S]*?)\n\}/.exec(haptics);
ok(!!hapticBody, "解析不到 haptic() 函数体");
if (hapticBody) {
  ok(
    /^\s*if \(!isMobileShell\(\)\) return;/.test(hapticBody[1]),
    "haptic() 的第一句必须是 PC 提前 return（非 Android 宿主直接跳过、不打日志）",
  );
}
ok(/import \{ isTauri \} from "\.\/transport\.js"/.test(haptics), "haptics.ts 应复用 transport 的 isTauri");
ok(/isAndroidNavigator\(/.test(haptics), "isMobileShell 必须同时要求 Android 宿主");
const desktop = /#\[cfg\(desktop\)\][\s\S]{0,400}?fn ui_haptic_tick\(effect: Option<String>\) -> serde_json::Value \{([\s\S]*?)\n\}/.exec(
  rust,
);
ok(!!desktop && /not-android/.test(desktop[1]), "Rust 桌面分支没有静默返回 not-android");
if (desktop) ok(!/log|println|eprintln/.test(desktop[1]), "Rust 桌面分支在刷日志：PC 上不许打日志");

/* ④ 节流 -------------------------------------------------------------------- */
ok(/const THROTTLE_MS = 60;/.test(haptics), "缺少 60ms 节流常量（防连点风暴）");
ok(
  /now - lastAt < THROTTLE_MS && strength <= lastStrength/.test(haptics),
  "节流没有按强度让位：底栏 CLICK 之后全局委托的 TICK 会再振一下",
);
ok(/const STRENGTH: Record<HapticEffect, number>/.test(haptics), "缺少强度分档表");

/* ⑤ 调用点 ------------------------------------------------------------------ */
const bottomNav = /function BottomNav\([\s\S]*?\n\}/.exec(layout);
ok(!!bottomNav && /haptic\("click"\)/.test(bottomNav[0]), "底栏项目没有 CLICK 触感（A2 调用点①）");
ok(/useEffect\(\(\) => installGlobalHaptics\(\), \[\]\)/.test(layout), "Layout 没有安装全局委托（调用点②③④的落点）");
ok(
  /t\.closest\('\[role="switch"\]'\)[\s\S]{0,80}?haptic\("heavy"\)/.test(haptics),
  "开关没有 HEAVY_CLICK：缺物理「咔哒」的实感（调用点③）",
);
ok(
  /t\.closest\('\[role="tab"\]'\)[\s\S]{0,80}?haptic\("click"\)/.test(haptics),
  "tab 切换没有 CLICK（调用点②）",
);
ok(/t\.closest\("\.btn"\)\)\s*haptic\("tick"\)/.test(haptics), "普通按钮没有 TICK（调用点④）");
/* b29：普通按钮委托是**通用** tick，不许声明 legacyKeep——老机型上它必须静默
   （霖：老机型只保留长按 + 作业瀑布流切卡）。声明了就把「按调用点收口」又打回按档位。 */
ok(
  !/t\.closest\("\.btn"\)\)\s*haptic\("tick"[^)]*legacyKeep/.test(haptics),
  "普通按钮（.btn）委托声明了 legacyKeep：老机型上按钮会继续有轻触感（应按调用点只放行切卡）",
);
ok(/t\.closest\("\.bottom-nav"\)\) return;/.test(haptics), "全局委托没给底栏让路：底栏会振两下");
ok(/haptic\("tick", \{ legacyKeep: true \}\)/.test(read(TASKS)), "作业流切卡没有触感（调用点⑤）");
if (existsSync(CONTEXT_MENU)) {
  /* 霖 2026-10-02：长按恢复自己发 LONG_PRESS（手感更好），代价是必须让宿主先关掉 WebView
     那条系统长按反馈——两头缺一就是「连振两下」或「一声都没有」。 */
  ok(/haptic\("longPress"\)/.test(read(CONTEXT_MENU)), "长按菜单没有 LONG_PRESS（A3 调用点）");
  ok(/ui_web_haptics_off/.test(read("apps/desktop/src/lib/haptics.ts")), "挂载时没有关掉 WebView 的系统长按反馈（会和本仓那条叠成两声）");
}

/* ⑥ 降级链：预烘焙优先，自绘波形只做该 ROM 不认预烘焙时的兜底 ------------------ */
ok(/createPredefined\(id\)/.test(kotlin), "Kotlin 没有预烘焙路径（EFFECT_* 才是跨 ROM 一致手感的来源）");
ok(
  !/shapedOnly|effect in shaped/.test(kotlin),
  "又出现了「按效果名跳过预烘焙」的分支：自绘波形只许做兜底（霖 2026-09-30 #5 返工口径）",
);
{
  const play = /private fun playHaptic\(effect: String, vib: android\.os\.Vibrator\): String \{([\s\S]*?)\n    \}/.exec(kotlin);
  ok(!!play, "解析不到 playHaptic() 函数体");
  if (play) {
    const pre = play[1].indexOf("createPredefined(id)");
    const wave = play[1].indexOf("waveformFor(effect)");
    ok(pre >= 0, "playHaptic 里没有预烘焙调用");
    ok(wave > pre, "playHaptic 先走了自绘波形：五档必须先试系统预定义效果，波形只能是兜底");
  }
}
ok(
  /vibrateWith\(vib, waveformFor\(effect\)\)/.test(kotlin),
  "兜底波形没有走 vibrateWith（应带 USAGE_TOUCH，跟随系统触感开关与强度）",
);
for (const [name, lit] of [
  ["tick", "longArrayOf\\(0, 20\\)"],
  ["longPress", "longArrayOf\\(0, 35\\)"],
  ["heavy", "longArrayOf\\(0, 60\\)"],
  ["reject", "longArrayOf\\(0, 16, 60, 24\\)"],
]) {
  ok(new RegExp(`"${name}" -> \{ timings = ${lit}`).test(kotlin), `自绘波形缺 ${name} 的分档值（五档必须互相可区分）`);
}
ok(/createWaveform\(timings, amps, -1\)/.test(kotlin), "Kotlin 没有自绘波形兜底");
ok(/vib\.vibrate\(legacyMs\(effect\)\)/.test(kotlin), "Kotlin 没有 API<26 的旧式 vibrate 兜底");
ok(!/EFFECT_LONG_PRESS|EFFECT_REJECT/.test(kotlin), "又用回了不存在的 VibrationEffect.EFFECT_LONG_PRESS/EFFECT_REJECT（会编译失败）");
ok(
  /private fun attrsFor\(usage: String\)[\s\S]{0,300}?else -> android\.os\.VibrationAttributes\.USAGE_TOUCH/.test(kotlin),
  "usage 映射没有把默认（touch）落到 USAGE_TOUCH（会绕过用户触感强度设置）",
);
ok(
  /private fun vibrateWith\(vib: android\.os\.Vibrator, effect: android\.os\.VibrationEffect, usage: String = "touch"\)/.test(kotlin),
  "vibrateWith 的 usage 默认值不是 touch（生产路径会被探针参数污染）",
);
ok(
  /vibrateWith\(vib, android\.os\.VibrationEffect\.createPredefined\(id\)\)/.test(kotlin),
  "生产路径的预烘焙调用带了 usage 参数（生产必须恒为 USAGE_TOUCH，强度差异只能由霖定档的 scale 决定）",
);
ok(/return "prebaked"/.test(kotlin) && /return "waveform"/.test(kotlin) && /return "legacy"/.test(kotlin), "Kotlin 没有回传实际降级路径（跨机型排查要用）");

/* ⑦ 探针：只许诊断，不许被正式路径调用 ---------------------------------------- */
ok(/fun hapticProbe\(invoke: Invoke\)/.test(kotlin), "Kotlin 没有 hapticProbe 命令（挑档位要靠它逐个试系统预定义效果）");
ok(/class HapticProbeArgs/.test(kotlin) && /createPredefined\(a\.id\)/.test(kotlin), "探针不能按 id 打单个预定义效果");
ok(/private fun capsText\(/.test(kotlin), "探针没有能力表（supportedPrimitives / areAllEffectsSupported 要真机读回来）");
ok(/areAllPrimitivesSupported/.test(kotlin), "能力表没查组合原语支持（本机为空正是「波形只是震」的根因）");
ok(/fn ui_haptic_probe\(/.test(rust) && /"hapticProbe"/.test(rust), "Rust 没有 ui_haptic_probe 或没透传给移动插件");
ok(
  /generate_handler!\([\s\S]*?ui_haptic_probe[\s\S]*?\)/.test(rust) || /ui_haptic_probe/.test(rust.split("generate_handler!")[1] ?? ""),
  "ui_haptic_probe 没有注册进 invoke_handler",
);
ok(/export async function hapticProbe\(/.test(haptics) && /invoke\("ui_haptic_probe"/.test(haptics), "haptics.ts 没有 hapticProbe 入口");
{
  const callers = walk("apps/desktop/src").filter((f) => f !== HAPTICS && /hapticProbe/.test(read(f)));
  ok(callers.length === 0, `探针被正式路径调用了：${callers.join(" / ")}（诊断入口只许人工触发）`);
}

/* ⑧ 老机型（无物理触感）静默策略 --------------------------------------------- */
/* 口径（霖 2026-10-04，b29 收紧）：老机型上**按调用点**只放行长按反馈与作业瀑布流切卡反馈，
   其余静默。必须满足：判据是能力组合、判定点唯一、结果只探一次、探针失败保持现状
   （绝不因探测失败把现代机型触感全关掉）。 */
const keepMatch = /export const LEGACY_HAPTIC_KEEP: readonly HapticEffect\[\] = \[([^\]]+)\]/.exec(haptics);
const keepList = keepMatch ? [...keepMatch[1].matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]).sort() : [];
ok(
  JSON.stringify(keepList) === JSON.stringify(["longPress", "tick"]),
  `老机型静默白名单必须只有 longPress（长按反馈）+ tick（作业瀑布流切卡那一档），实际：${keepList.join("/") || "（解析不到）"}`,
);
/* 两档的调用点必须真实存在且对得上（防「白名单写了个没人用的档」） */
ok(/haptic\("longPress"\)/.test(read(CONTEXT_MENU)), "白名单里的 longPress 在长按菜单里没有实际调用点");
ok(
  /haptic\("tick", \{ legacyKeep: true \}\)/.test(read(TASKS)),
  "白名单里的 tick（作业瀑布流切卡）没有实际调用点，或没有显式声明 legacyKeep",
);
/* 保留档恰好是这两处：全仓 `legacyKeep` 只允许出现在切卡那一处 */
{
  const legacyKeepHits = walk("apps/desktop/src").filter((f) => /legacyKeep:\s*true/.test(read(f)));
  ok(
    JSON.stringify(legacyKeepHits) === JSON.stringify([TASKS.replaceAll("\\", "/")]),
    `legacyKeep 只允许出现在作业流切卡（${TASKS}），实际：${legacyKeepHits.join(" / ") || "（一处都没有）"}`,
  );
}
/* 判定点唯一：定义一次 + haptic() 里调用一次，别处不许再判 */
{
  const hits = [...haptics.matchAll(/shouldSilenceLegacy\(/g)].length;
  ok(hits === 2, `老机型判定点不唯一：shouldSilenceLegacy 应只出现「定义 + haptic() 唯一一次调用」，实际 ${hits} 处`);
  const sil = /function shouldSilenceLegacy\(effect: HapticEffect, legacyKeep: boolean\): boolean \{([\s\S]*?)\n\}/.exec(haptics);
  ok(!!sil, "缺少唯一判定点 shouldSilenceLegacy(effect, legacyKeep)（签名必须显式收 legacyKeep）");
  if (sil) {
    ok(
      /silenceOnLegacy\(capsState\(\), effect, LEGACY_HAPTIC_KEEP, legacyKeep\)/.test(sil[1]),
      "判定点没有委托给纯函数 silenceOnLegacy(capsState(), effect, LEGACY_HAPTIC_KEEP, legacyKeep)",
    );
  }
}
/* haptic() 里的次序：静默判断必须在节流记账与任何发振/兜底之前
   （否则被静默的一档会占掉 60ms 窗口，把紧随其后的长按反馈一起压掉） */
if (hapticBody) {
  const iSilence = hapticBody[1].indexOf("shouldSilenceLegacy(effect, opts?.legacyKeep === true)");
  const iThrottle = hapticBody[1].indexOf("const now = performance.now()");
  const iVibrate = hapticBody[1].indexOf("navigator.vibrate");
  ok(iSilence >= 0, "haptic() 里没有调用老机型判定点（或没把 legacyKeep 传下去）");
  ok(iSilence >= 0 && iThrottle > iSilence, "老机型静默必须放在节流记账之前（否则静默档会占掉 60ms 窗口）");
  ok(
    iVibrate < 0 || iVibrate > iSilence,
    "navigator.vibrate 兜底出现在静默判定之前：老机型存在绕过静默的旁路",
  );
  ok(!/ui_haptic_probe/.test(hapticBody[1]), "haptic() 里直接探测了能力：必须走一次性缓存，绝不允许每次触感再探");
}
/* 结果只探一次 + 失败保持现状 */
{
  const probeFn = /function probeHapticCapsOnce\(\): void \{([\s\S]*?)\n\}/.exec(haptics);
  ok(!!probeFn, "缺少一次性能力探测 probeHapticCapsOnce()");
  ok(/if \(hapticCapsProbed\) return;/.test(haptics), "能力探测没有「只探一次」守卫（会每次触感都探）");
  ok(/let hapticCaps: HapticCaps = "unknown";/.test(haptics), "判定结果初值必须是 unknown（探针落地前行为与现状一致）");
  const assigns = [...haptics.matchAll(/hapticCaps = ([^;]+);/g)].map((m) => m[1].trim());
  ok(
    assigns.length === 1 && /^decodeHapticCaps\(String\(r\?\.detail \?\? ""\)\)$/.test(assigns[0]),
    `hapticCaps 只能由 decodeHapticCaps() 赋值一次（探针失败不赋值 → 保持 unknown）：实际 ${JSON.stringify(assigns)}`,
  );
  ok(
    /r\?\.ok !== true\) return;/.test(haptics) && /\.catch\(\(\) => undefined\)/.test(haptics),
    "探针失败（ok!=true / invoke 抛错）没有保持 unknown 的兜底",
  );
  ok(/kind: "caps"/.test(haptics), "一次性探测没有走既有探针的 caps 能力表");
  ok(
    /return hapticCaps;/.test(haptics) && /if \(ov === true\) return "yes";/.test(haptics),
    "老机型判定没有「覆盖开关优先 / 其余用探测结果」的口径",
  );
}
/* ⑧b 判据与放行真值表（纯函数，直接跑；含真机两台机器的 caps 读数） ------------------ */
{
  const cases = [
    /* K30 型（退役机真机读数：sdk=31 / ampCtl=true / primsN=0 / extFx=0）→ 老机型 */
    ["sdk=31 id=-1 ampCtl=true effects9=[0,1,2,3,4,5,6,7,8] primsN=0 extFx=0", "no", "K30 型 caps 必须判 legacy"],
    /* K90 型（日常机真机读数：sdk=36 / ampCtl=true / primsN=0 / extFx=32）→ 支持 */
    ["sdk=36 id=-1 ampCtl=true effects9=[0,1,2,3,4,5,6,7,8] prims=[] primsN=0 extFx=32", "yes", "K90 型 caps 必须判 support"],
    /* 无幅度控制（纯转子）→ 老机型（b29 父会话补的方向性口径） */
    ["sdk=31 id=-1 ampCtl=false effects9=[0,1,2,3,4,5,6,7,8] primsN=0 extFx=0", "no", "ampCtl=false 必须判 legacy（无幅度控制 = 无法表达强度）"],
    /* 有组合原语 → 支持（哪怕没有扩展效果块） */
    ["sdk=33 id=0 ampCtl=true primsN=3 extFx=0", "yes", "有系统组合原语必须判 support"],
    /* 字段缺失 → unknown（保持现状，不静默） */
    ["sdk=36 id=-1 ampCtl=true effects9=[0,1,2,3,4,5,6,7,8] prims=[] primsN=0", "unknown", "缺 extFx 必须判 unknown"],
    ["sdk=36 id=-1 effects9=[0,1,2,3,4,5,6,7,8] prims=[] primsN=0 extFx=32", "unknown", "缺 ampCtl 必须判 unknown"],
    ["", "unknown", "空 detail 必须判 unknown（探针失败保持现状）"],
    ["no-vibrator", "unknown", "探针 reason 串必须判 unknown"],
  ];
  for (const [detail, want, why] of cases) {
    const got = decodeHapticCaps(detail);
    ok(got === want, `${why}：decodeHapticCaps(${JSON.stringify(detail)}) = ${got}，应为 ${want}`);
  }
  /* 放行真值表：老机型（caps=no）上「长按 + 切卡那一档」放行、普通按钮档拦掉；
     unknown / 现代机一律不静默（现代机型逐档不变）。 */
  const keepCases = [
    ["no", "longPress", false, false, "老机型长按必须放行（真机 b29 首跑曾把它拦掉）"],
    ["no", "tick", true, false, "老机型切卡（显式 legacyKeep）必须放行"],
    ["no", "tick", false, true, "老机型普通按钮的通用 tick 必须静默（不显式声明就不放行）"],
    ["no", "click", false, true, "老机型底栏/tab 的 click 必须静默"],
    ["no", "heavy", false, true, "老机型开关的 heavy 必须静默"],
    ["no", "reject", false, true, "老机型 reject 必须静默"],
    ["no", "click", true, true, "legacyKeep 不能把白名单外的档捞回来"],
    ["yes", "tick", false, false, "现代机 tick（普通按钮）不得静默：行为与改动前一致"],
    ["yes", "click", false, false, "现代机 click 不得静默"],
    ["yes", "heavy", false, false, "现代机 heavy 不得静默"],
    ["unknown", "click", false, false, "unknown 一律不静默（探针没落地时行为与现状一致）"],
    ["unknown", "tick", false, false, "unknown 下 tick 也不静默"],
  ];
  for (const [caps, effect, legacyKeep, want, why] of keepCases) {
    const got = silenceOnLegacy(caps, effect, KEEP, legacyKeep);
    ok(got === want, `${why}：silenceOnLegacy(${caps}, ${effect}, KEEP, ${legacyKeep}) = ${got}，应为 ${want}`);
  }
}
/* 能力表字段（Kotlin capsText）必须真的输出判据需要的三项 */
ok(/private val EXT_EFFECT_IDS = \(161\.\.192\)\.toList\(\)/.test(kotlin), "Kotlin 能力表没有厂商标定扩展效果块 161..192（判据的 extFx 来源）");
ok(/private val PRIMITIVE_IDS = intArrayOf\(1, 2, 3, 4, 5, 6, 7, 8\)/.test(kotlin), "Kotlin 能力表没有组合原语 id 表（判据的 primsN 来源）");
ok(/sb\.append\(" primsN="\)/.test(kotlin) && /sb\.append\(" extFx="\)/.test(kotlin), "Kotlin capsText 没有输出 primsN / extFx（前端会一直判 unknown）");
ok(
  /EXT_EFFECT_IDS\.count \{ vib\.areAllEffectsSupported\(it\) == android\.os\.Vibrator\.VIBRATION_EFFECT_SUPPORT_YES \}/.test(kotlin),
  "extFx 不是按「HAL 明确承认（YES）」计数：UNKNOWN 会被算成支持（判据会误判）",
);
/* dev 覆盖开关（真机取证用，不做进用户可见设置） */
ok(/__onethuHapticCapsOverride/.test(haptics), "缺少 dev 可注入的覆盖开关 __onethuHapticCapsOverride（真机取证要用）");
ok(
  /ov === true[\s\S]{0,80}?return "yes";[\s\S]{0,80}?ov === false[\s\S]{0,80}?return "no";/.test(haptics),
  "覆盖开关语义必须支持 true=强制现代机 / false=强制老机型 两个方向（真机要双向对照）",
);

/* 输出 ---------------------------------------------------------------------- */
console.log("触感护栏：唯一入口 + 五档走系统预定义效果 + PC 静默 + 60ms 节流 + 五个调用点 + 探针只诊断 ✓");
console.log("触感护栏（b29）：能力组合判据真值表 + 保留档按调用点收口（切卡放行 / 普通按钮静默）✓");

/* 探针的 usage 通道（强度微调：系统演示页用的是 hardware 反馈）：三端必须贯通 */
ok(/private fun attrsFor\(usage: String\)[\s\S]{0,300}?"hardware" -> android\.os\.VibrationAttributes\.USAGE_HARDWARE_FEEDBACK/.test(kotlin), "Kotlin 探针缺 hardware usage 分支");
ok(/\"usage\": usage\.unwrap_or_else/.test(rust), "Rust 没有把 usage 透传给插件（参数会静默丢）");
ok(/usage\?: string/.test(haptics), "前端 hapticProbe 的类型没加 usage");

if (fails.length) {
  console.error("触感护栏 ✗");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
