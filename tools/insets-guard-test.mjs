/**
 * 系统栏 inset 适配护栏（2026-09-21 实录：demo 版顶栏被状态栏压住，正式版正常）。
 *
 * 根因：wry/Tauri 内部强制 edge-to-edge，WebView 铺到状态栏底下；正式工程的 MainActivity
 * 里有一段手写补丁把 inset 转成内容 padding，而 demo 工程是纯生成的（只有 enableEdgeToEdge()）
 * → 同一份前端、两种观感。
 *
 * 契约：这条能力必须**随插件入库**（与具体生成工程无关）——Kotlin 命令 + Rust 桥 + 启动调用，
 * 且 IME inset 必须一并取 max（键盘不盖输入框）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const kt = read("apps/desktop/src-tauri/plugins/onethu-mobile/android/src/main/java/app/onethu/mobile/OnethuMobilePlugin.kt");
const rs = read("apps/desktop/src-tauri/src/lib.rs");
const app = read("apps/desktop/src/App.tsx");

/* ---------- Kotlin：命令存在 + 语义正确 ---------- */
assert.ok(/fun applyContentInsets\(invoke: Invoke\)/.test(kt), "插件必须提供 applyContentInsets 命令");
assert.ok(/setOnApplyWindowInsetsListener/.test(kt), "必须真正监听 window insets");
assert.ok(/Type\.systemBars\(\)/.test(kt), "必须取 systemBars insets");
assert.ok(/Type\.ime\(\)/.test(kt), "必须取 IME insets（键盘不能盖住输入框）");
assert.ok(/maxOf\(bars\.bottom, imeBottom\)/.test(kt), "底垫要取 max(系统栏, 键盘)");
assert.ok(/setPadding\(bars\.left, bars\.top, bars\.right/.test(kt), "必须把 inset 垫成内容 padding");
assert.ok(/requestApplyInsets\(\)/.test(kt), "注册后要主动请求一次应用（否则首帧不生效）");
assert.ok(/SDK_INT >= 30/.test(kt), "旧系统要有降级分支（API<30 用 systemWindowInset*）");

/* ---------- Rust：桥接 + 注册 ---------- */
assert.ok(/async fn ui_apply_insets\(app: tauri::AppHandle\)/.test(rs), "Rust 侧必须有 ui_apply_insets 移动端实现");
assert.ok(/fn ui_apply_insets\(\) -> serde_json::Value/.test(rs), "Rust 侧必须有桌面端桩（如实报 not-android）");
assert.ok(/ui_apply_insets,/.test(rs), "命令必须注册进 invoke_handler");
assert.ok(/run_mobile_plugin_async\("applyContentInsets"/.test(rs), "Rust 桥必须转发到 Kotlin 的 applyContentInsets");

/* ---------- 前端：启动时调一次，且只在 Android ---------- */
assert.ok(/invoke\("ui_apply_insets"\)/.test(app), "前端启动时必须调用 ui_apply_insets");
assert.ok(/isAndroidNavigator/.test(app), "调用必须按平台判定（桌面端不调）");

console.log("insets-guard-test: 全部断言通过（Kotlin 命令 + Rust 桥 + 启动调用 + IME 一并取 max）");
