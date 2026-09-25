//! OneTHU 桌面壳 —— 网络层走 Rust（reqwest），前端零 CORS 限制。

use serde::{Deserialize, Serialize};

/// 桌面端通知实现（macOS/Windows）。Android 走 onethu-mobile 插件的 Kotlin 侧，
/// 故整个模块按桌面端门控——否则 Android 目标下会编进一堆用不到的桌面实现。
#[cfg(desktop)]
mod notify;
#[cfg(target_os = "macos")]
mod notify_macos;
#[cfg(target_os = "windows")]
mod notify_windows;
mod mail;
mod seafile;
mod downloads;
mod harness_embed;
mod plugins;
use std::collections::HashMap;
use std::error::Error as _;
use std::time::Duration;
use tauri::Manager;

#[derive(Deserialize)]
struct HttpInput {
    url: String,
    #[serde(default = "default_method")]
    method: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    #[serde(default)]
    body: Option<String>,
    /// 二进制请求体（base64）：FormData multipart 含文件时前端走此通道，
    /// 避免 UTF-8 字符串通道损坏字节流。
    #[serde(default)]
    body_b64: Option<String>,
    #[serde(default)]
    timeout_ms: Option<u64>,
}

fn default_method() -> String {
    "GET".into()
}

/// 拼接 error 的 source 链（R17 23.4）：reqwest 的 `Display` 只输出
/// `error sending request for url (...)`，真正原因（`operation timed out` 等）
/// 藏在 `source()` 链里被吞掉——逐层拼接，杜绝「看不出原因」的网络错误。
fn error_chain(e: &dyn std::error::Error) -> String {
    let mut out = e.to_string();
    let mut src = e.source();
    while let Some(s) = src {
        let text = s.to_string();
        if !text.is_empty() && !out.contains(&text) {
            out.push_str(": ");
            out.push_str(&text);
        }
        src = s.source();
    }
    out
}

#[derive(Serialize)]
struct HttpOutput {
    status: u16,
    status_text: String,
    /// 除 Set-Cookie 外的响应头（小写键）
    headers: HashMap<String, String>,
    /// Set-Cookie 单独回传（多值，顺序保留）
    set_cookies: Vec<String>,
    /// 逐跳 Set-Cookie（http_native 专用）：(所在跳 URL, 原始 Set-Cookie 行)，
    /// 供 TS 侧按真实域分桶入账——两套 cookie 世界（Rust 原生仓/TS jar）的桥。
    set_cookie_hops: Option<Vec<(String, String)>>,
    /// 最终 URL（跟随内部无重定向，此处即请求 URL）
    url: String,
    body: String,
    /// 二进制响应体（UTF-8 非法时走此通道，body 为空字符串）——验证码图/发票 PDF
    /// 等二进制资源经字符串通道会被 lossy 解码损坏（0x89→U+FFFD 实证）
    body_b64: Option<String>,
}

/// 单次 HTTP 请求：不跟随重定向（由前端带着最新 Cookie 逐跳处理），
/// 显式透传请求头（含 Cookie —— 浏览器 fetch 的禁改头，这里无此限制）。
/// 读任意本地文本文件（Rust 插件 manifest.json）：路径经系统文件对话框获得
#[tauri::command]
fn read_file_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("读取失败：{e}"))
}

// ── 寻迹：高德 Web 服务 Key（编译期经 build.rs 注入；XOR 0x5A 混淆）──
// 常量来自 OUT_DIR/trace_key.rs，由 build.rs 从环境变量 TRACE_AMAP_KEY 或
// src-tauri/.env 生成（.env 已 gitignore，见 .env.example）——源码/仓库/JS
// bundle 零明文，二进制无 32 位连续 hex 特征。防扫库不防逆向/抓包：
// 个人 key、免费档、泄露损失 = 烧一天配额后重置发版。
// 配置：cp src-tauri/.env.example src-tauri/.env，填 TRACE_AMAP_KEY 后重启构建。
include!(concat!(env!("OUT_DIR"), "/trace_key.rs"));

// ── 寻迹：macOS 原生定位 ──────────────────────────────────────────────────
// tauri-plugin-geolocation 桌面端无实现（desktop.rs 返回 Position::default()=(0,0)），
// WKWebView 的 JS 定位亦不可用；此桥经 native/location.m 走 CoreLocation。
// 移动端仍用官方插件（mobile.rs 有真实现），JS 侧级联调用。
#[cfg(target_os = "macos")]
mod onethu_location_ffi {
    #[link(name = "onethu_location")]
    extern "C" {
        // 返回码：1 成功 | 0 超时/失败 | -1 系统定位服务关闭 | -2 权限被拒
        pub fn onethu_location(
            lat: *mut f64,
            lng: *mut f64,
            acc: *mut f64,
            timeout_sec: f64,
        ) -> i32;
    }
    // CoreLocation 常量（kCLErrorDomain 等）是直接符号引用，类符号走 objc runtime
    // 不链框架也能过，但常量不行——必须显式链框架。注意：build.rs 的
    // rustc-link-framework 在 dylib 链接场景未生效，须用属性方式
    // （与本二进制里 EventKit/AppKit 等 crate 同一模式）。
    #[link(name = "CoreLocation", kind = "framework")]
    extern "C" {}
}

/// 一次性定位：[lat, lng, accuracy]（WGS-84）。内部在阻塞线程泵 runloop 等系统授权窗。
#[tauri::command]
async fn macos_location() -> Result<Vec<f64>, String> {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(|| {
            let (mut lat, mut lng, mut acc) = (0f64, 0f64, 0f64);
            let rc = unsafe {
                onethu_location_ffi::onethu_location(&mut lat, &mut lng, &mut acc, 15.0)
            };
            match rc {
                1 => Ok(vec![lat, lng, acc]),
                -2 => Err("定位权限被拒（系统设置 → 隐私与安全性 → 定位服务）".into()),
                -1 => Err("系统定位服务未开启".into()),
                _ => Err("定位超时（首次需在系统授权窗点允许，重试即可）".into()),
            }
        })
        .await
        .map_err(|e| format!("定位任务失败：{e}"))?
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("此平台无原生定位命令".into())
    }
}

// ── 灵动岛语音输入：macOS 原生语音识别（SFSpeechRecognizer）──────────────
// 长按胶囊 → speech_start（授权窗由系统弹，需 bundle + Info.plist 描述串，
// 与定位同机理）→ JS 每 ~200ms speech_poll 拿部分转写 → 松手 speech_stop。
// iOS 未建工程；Android/Windows 由各自平台分支处理（见命令体）。
#[cfg(target_os = "macos")]
mod onethu_speech_ffi {
    // 框架必须走 #[link] 属性：build.rs 的 rustc-link-framework 指令对最终 dylib
    // 链接不生效（CoreLocation 同坑，2024-09 已验证）。
    #[link(name = "AVFoundation", kind = "framework")]
    #[link(name = "Speech", kind = "framework")]
    extern "C" {}

    #[link(name = "onethu_speech")]
    extern "C" {
        pub fn onethu_speech_supported() -> i32;
        pub fn onethu_speech_start() -> i32; // 1 成功 0 无权限 -1 引擎/模型失败
        pub fn onethu_speech_poll() -> *const std::ffi::c_char;
        pub fn onethu_speech_stop();
    }
}

#[tauri::command]
fn speech_supported() -> bool {
    #[cfg(target_os = "macos")]
    unsafe { onethu_speech_ffi::onethu_speech_supported() == 1 }
    #[cfg(not(target_os = "macos"))]
    { false }
}

/// 开始一次识别（阻塞至授权窗点选，需在异步命令里跑）。
#[tauri::command]
async fn speech_start() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(|| {
            match unsafe { onethu_speech_ffi::onethu_speech_start() } {
                1 => Ok(()),
                0 => Err("无语音权限（系统设置 → 隐私与安全性 → 麦克风/语音识别）".into()),
                _ => Err("语音引擎启动失败（中文语音模型未下载或无网络）".into()),
            }
        })
        .await
        .map_err(|e| format!("语音任务失败：{e}"))?
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("此平台暂不支持原生语音识别".into())
    }
}

/// 读取当前转写（部分结果实时更新）。
#[tauri::command]
fn speech_poll() -> String {
    #[cfg(target_os = "macos")]
    unsafe {
        let p = onethu_speech_ffi::onethu_speech_poll();
        if p.is_null() { String::new() } else { std::ffi::CStr::from_ptr(p).to_string_lossy().into_owned() }
    }
    #[cfg(not(target_os = "macos"))]
    {
        String::new()
    }
}

/// 停止识别（此后 poll 仍能拿到一次最终文本，直到下次 start）。
#[tauri::command]
fn speech_stop() {
    #[cfg(target_os = "macos")]
    unsafe { onethu_speech_ffi::onethu_speech_stop() }
}

#[tauri::command]
fn trace_key() -> String {
    TRACE_KEY_OBF
        .iter()
        .map(|h| (u8::from_str_radix(h, 16).unwrap_or(0) ^ 0x5a) as char)
        .collect()
}

/// 调试日志文件路径：所有写点统一走这里（Windows 下 /tmp 语义为「当前盘根 \tmp\」）。
const DEBUG_LOG_PATH: &str = "/tmp/onethu-debug.log";

/// 调试日志落点。R21：安卓此前只有 logcat（无 /tmp），用户拿不到日志、真机问题
/// 全靠猜（2026-09-21「在线服务跳浏览器」「校内启动 20s」两个实录的教训）——
/// 现在安卓落 app_data_dir/logs/onethu-debug.log，设置页可一键转存系统下载。
fn debug_log_path() -> std::path::PathBuf {
    if let Some(app) = LOG_APP.get() {
        #[cfg(target_os = "android")]
        {
            use tauri::Manager;
            if let Ok(dir) = app.path().app_data_dir() {
                return dir.join("logs").join("onethu-debug.log");
            }
        }
        let _ = app;
    }
    std::path::PathBuf::from(DEBUG_LOG_PATH)
}

/// setup 时注入全局句柄（命令/内部日志统一取落点，不必层层穿参）
static LOG_APP: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

/// Rust 侧直接写调试日志（逐跳计时 / THOS-SEED / VENUEVIEW 等）——与 JS log_debug 同一落点。
fn debug_log_line(line: &str) {
    let path = debug_log_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let ok = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .ok()
        .and_then(|mut f| std::io::Write::write_all(&mut f, format!("{line}\n").as_bytes()).ok());
    // Android：**始终**镜像一份到 logcat（tag=onethu）。落盘文件在应用私有目录，
    // 真机 adb 读不到（release 包 run-as 不可用、导出要用户手点），而排查真机问题恰恰
    // 需要实时现场 → `adb logcat -s onethu:V` 即可跟着复现看日志。
    #[cfg(target_os = "android")]
    unsafe {
        extern "C" {
            fn __android_log_write(prio: i32, tag: *const u8, text: *const u8) -> i32;
        }
        let full = format!("{line}\0");
        __android_log_write(4, b"onethu\0".as_ptr(), full.as_ptr() as *const u8);
    }
    let _ = ok;
}

/// 打开调试日志（append）。写前先 `create_dir_all(parent)`——Windows 上 `\tmp\`
/// 常不存在，此前 `File::create` 失败被 `let _` 吞掉，霖机器整条调试链静默失效
/// （R10 15.1-3：log_debug / thos_log / venue_log 三处统一走本 helper）。
#[tauri::command]
fn log_debug(line: String) -> Result<(), String> {
    // 体积闸门：超 16MB 轮转为 .old（防 HTML dump 类循环刷盘——曾灌到 1GB）
    let path = debug_log_path();
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > 16 * 1024 * 1024 {
            let _ = std::fs::rename(&path, path.with_extension("log.old"));
        }
    }
    debug_log_line(&line);
    Ok(())
}

/// 导出调试日志：安卓转存系统「下载」（复用 saveDownload 桥），桌面落下载目录。
/// 返回用户可说的落点（「下载/onethu-debug.log」或桌面绝对路径）。
#[tauri::command]
fn debug_log_export(app: tauri::AppHandle) -> Result<String, String> {
    let src = debug_log_path();
    let bytes = std::fs::read(&src).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "还没有日志：先复现一次问题再导出".to_string()
        } else {
            format!("读取日志失败: {e}")
        }
    })?;
    let name = "onethu-debug.log";
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let dir = app
            .path()
            .app_cache_dir()
            .map_err(|e| format!("无法定位缓存目录: {e}"))?
            .join("onethu-dl");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let tmp = dir.join(name);
        std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
        let handle = app
            .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
            .0
            .clone();
        let r: serde_json::Value = handle
            .run_mobile_plugin(
                "saveDownload",
                serde_json::json!({ "path": tmp.to_string_lossy(), "name": name }),
            )
            .map_err(|e| e.to_string())?;
        if let Some(dir) = r.get("dir").and_then(|v| v.as_str()) {
            return Ok(format!("{dir}/{name}"));
        }
        return Ok(tmp.to_string_lossy().into_owned());
    }
    #[cfg(not(target_os = "android"))]
    {
        let dir = downloads::directory(&app)?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = dir.join(name);
        std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
        Ok(path.to_string_lossy().into_owned())
    }
}

/* ---------------- 外链系统浏览器 ----------------
 * WebView 内 window.open / <a target=_blank> 均无效，必须交给系统默认浏览器。
 * 主通道是官方 opener 插件；open_external 是免 ACL 的自写兜底（插件异常时前端降级调用）。 */

/// 用系统默认程序打开 URL（平台分派：open / start / xdg-open）
#[cfg(target_os = "macos")]
fn spawn_system_open(url: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("调用系统 open 失败: {e}"))
}

#[cfg(target_os = "windows")]
fn spawn_system_open(url: &str) -> Result<(), String> {
    // start 的第一个引号参数是窗口标题，必须占位空串，否则 URL 被吞
    use std::os::windows::process::CommandExt; // creation_flags 仅 Windows 提供
    std::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW，不闪控制台黑框
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("调用系统 start 失败: {e}"))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn spawn_system_open(url: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("调用 xdg-open 失败: {e}"))
}

#[cfg(not(any(
    target_os = "macos",
    target_os = "windows",
    all(unix, not(target_os = "macos"))
)))]
fn spawn_system_open(_url: &str) -> Result<(), String> {
    Err("当前平台不支持外部打开".into())
}

/* ---------------- 本地文件：打开 / 定位（免 ACL 的自写命令） ----------------
 * 官方 opener 插件的 open_path / reveal_item_in_dir 除命令权限外，还需要 capability 里配
 * **路径 scope**（allow 列表里给具体路径通配项，例如用户主目录下的 glob）；
 * 只给 `opener:allow-open-path` 会直接报 "Not allowed to open path ..."。而下载与「另存为」
 * 的落盘位置由用户决定（任意盘符/目录），白名单式 scope 覆盖不全，故自写命令直接交给系统
 * shell —— 自定义命令不受插件 ACL 约束。
 * 安全：只接受**绝对路径**且**必须已存在**；不放行任何 URL/scheme；不做 shell 字符串拼接
 * （Windows 用 raw_arg 逐段追加、路径整体加引号，空格与特殊字符都不会被重新解析）。 */

fn validate_local_path(path: &str) -> Result<std::path::PathBuf, String> {
    if path.trim().is_empty() {
        return Err("路径为空".into());
    }
    let p = std::path::PathBuf::from(path);
    if !p.is_absolute() {
        return Err(format!("只接受绝对路径：{path}"));
    }
    if !p.exists() {
        return Err(format!("文件不存在或已被移动：{path}"));
    }
    Ok(p)
}

/// 用系统默认应用打开本地文件
#[tauri::command]
fn onethu_open_path(path: String) -> Result<(), String> {
    let p = validate_local_path(&path)?;
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new("cmd");
        c.raw_arg("/C");
        c.raw_arg("start");
        c.raw_arg("\"\""); // start 的第一个引号参数是窗口标题，必须占位，否则路径被吞
        c.raw_arg(format!("\"{}\"", p.display()));
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW，不闪控制台黑框
        c.spawn().map(|_| ()).map_err(|e| format!("调用系统打开失败: {e}"))
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&p)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("调用系统 open 失败: {e}"))
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&p)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("调用 xdg-open 失败: {e}"))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", all(unix, not(target_os = "macos")))))]
    {
        let _ = p;
        Err("当前平台不支持打开本地文件".into())
    }
}

/// 在文件管理器中定位并选中本地文件
#[tauri::command]
fn onethu_reveal_path(path: String) -> Result<(), String> {
    let p = validate_local_path(&path)?;
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new("explorer");
        // explorer 只认 `/select,"路径"` 这种一整段参数形式：raw_arg 原样追加，避免被引号转义破坏
        c.raw_arg(format!("/select,\"{}\"", p.display()));
        c.creation_flags(0x0800_0000);
        c.spawn().map(|_| ()).map_err(|e| format!("调用资源管理器失败: {e}"))
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&p)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("调用 Finder 失败: {e}"))
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Linux 无统一的「定位选中」语义：退化为打开所在目录
        let dir = p
            .parent()
            .map(|d| d.to_path_buf())
            .unwrap_or_else(|| std::path::PathBuf::from("/"));
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("调用 xdg-open 失败: {e}"))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", all(unix, not(target_os = "macos")))))]
    {
        let _ = p;
        Err("当前平台不支持定位本地文件".into())
    }
}

/// 兜底外链打开：Rust 侧再校验一次 scheme，仅放行 http/https
#[tauri::command]
fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    // Android intent:// 深链（地图导航跳 App）：标准 intent 格式 + package 校验后放行
    #[cfg(target_os = "android")]
    {
        if url.starts_with("intent://") && url.contains("#Intent;") && url.contains("package=") {
            use tauri::Manager;
            let handle = app
                .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
                .0
                .clone();
            let _: serde_json::Value = handle
                .run_mobile_plugin("openIntent", serde_json::json!({ "url": url }))
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    #[cfg(not(target_os = "android"))]
    let _ = &app;
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(format!("拒绝打开非 http(s) 链接: {url}"));
    }
    spawn_system_open(&url)
}

/* ---------------- 本机状态文件（appData/state 下的 JSON 文件） ----------------
 * WKWebView 的 localStorage 会被系统驱逐/清空（会话状态时有时无的根源），
 * 会话快照与「记住密码」一律镜像到应用数据目录的普通文件，启动时优先
 * localStorage、缺失则从文件回灌。 */

fn state_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录: {e}"))?
        .join("state");
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建状态目录: {e}"))?;
    Ok(dir)
}

/// 文件名白名单化，防路径穿越
fn safe_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '_'
            }
        })
        .collect()
}

#[tauri::command]
fn state_write<R: tauri::Runtime>(app: tauri::AppHandle<R>, name: String, content: String) -> Result<(), String> {
    let path = state_dir(&app)?.join(format!("{}.json", safe_name(&name)));
    // 原子写：临时文件 + rename，强退/断电不留半截 JSON
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, content.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn state_read<R: tauri::Runtime>(app: tauri::AppHandle<R>, name: String) -> Result<Option<String>, String> {
    let path = state_dir(&app)?.join(format!("{}.json", safe_name(&name)));
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn state_delete<R: tauri::Runtime>(app: tauri::AppHandle<R>, name: String) -> Result<(), String> {
    let path = state_dir(&app)?.join(format!("{}.json", safe_name(&name)));
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Content-Disposition 文件名解析：filename*=UTF-8''…（RFC 5987）优先，其次 filename=…
/// （learn 下载端点会回真名；mobile 未用此头但取 URL 真名等价，落盘名以服务器为准）。
fn parse_cd_filename(cd: &str) -> Option<String> {
    for part in cd.split(';') {
        let p = part.trim();
        if let Some(rest) = p.strip_prefix("filename*=") {
            let mut seg = rest.splitn(3, '\'');
            let _charset = seg.next().unwrap_or("utf-8");
            let _lang = seg.next().unwrap_or("");
            if let Some(raw) = seg.next() {
                if let Some(decoded) = percent_decode(raw) {
                    if !decoded.is_empty() {
                        return Some(decoded);
                    }
                }
            }
        }
    }
    for part in cd.split(';') {
        let p = part.trim();
        if let Some(rest) = p.strip_prefix("filename=") {
            let v = rest.trim().trim_matches('"');
            if !v.is_empty() {
                return Some(percent_decode(v).unwrap_or_else(|| v.to_string()));
            }
        }
    }
    None
}

/// 百分号解码（%XX → 字节；非法序列原样保留）
fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut i = 0usize;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = std::str::from_utf8(&b[i + 1..i + 3]).ok()?;
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8(out).ok()
}

/* ═══ 插件目录（R10 架构）：运行时唯一插件根 = appData/plugins/<id>/ ═══
 *  一切导入的插件（js/rust）与内置插件（OH sidecar）统一落在自己的子目录；
 *  注册表里的 binPath 恒指向该目录，不再散落用户下载/临时目录。 */

/// 插件根目录（不存在则创建）
pub fn plugins_root(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let dir = base.join("plugins");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// 取插件子目录（不存在则创建）；id 防路径穿越（只允许字母数字.-_）
fn plugin_dir(app: &tauri::AppHandle, id: &str) -> Result<std::path::PathBuf, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_alphanumeric() || matches!(c, '.' | '-' | '_')) {
        return Err(format!("非法插件 id：{id}"));
    }
    Ok(plugins_root(app)?.join(id))
}

/// 导入 rust 插件（文件夹形态）：把所选目录全部文件复制进 plugins/<id>/，
/// 返回新 binPath。manifest.json + 二进制 + logo.svg 整包随行。
#[tauri::command]
fn plugin_dir_install_rust(
    app: tauri::AppHandle,
    id: String,
    manifest_dir: String,
    bin: String,
) -> Result<String, String> {
    use std::path::Path;
    let dir = plugin_dir(&app, &id)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let src = Path::new(&manifest_dir);
    let rd = std::fs::read_dir(src).map_err(|e| format!("读取目录失败：{e}"))?;
    for entry in rd {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name();
        let data = std::fs::read(entry.path()).map_err(|e| format!("读取 {:?} 失败：{e}", name))?;
        std::fs::write(dir.join(&name), data).map_err(|e| format!("写入 {:?} 失败：{e}", name))?;
    }
    let bin_path = dir.join(&bin);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&bin_path, std::fs::Permissions::from_mode(0o755));
    }
    Ok(bin_path.to_string_lossy().to_string())
}

/// zip 防路径穿越（zip-slip）：展开路径必须留在目标目录内
fn zip_safe_path(dir: &std::path::Path, name: &str) -> Result<std::path::PathBuf, String> {
    let rel = std::path::Path::new(name);
    if name.starts_with('/') || name.contains('\\') && name.contains("..")
        || rel.components().any(|c| matches!(c, std::path::Component::ParentDir | std::path::Component::RootDir | std::path::Component::Prefix(_)))
    {
        return Err(format!("zip 内非法路径：{name}"));
    }
    Ok(dir.join(rel))
}

/// 导入插件压缩包（rust/js 通用）：安全解包进 plugins/<id>/ 并返回登记所需信息。
/// rust → binPath；js → 返回入口 js 源码（注册表仍存 code，目录留存文件与 logo）。
#[tauri::command]
fn plugin_dir_import_zip(
    app: tauri::AppHandle,
    zip_path: String,
) -> Result<serde_json::Value, String> {
    use std::io::Read;
    let file = std::fs::File::open(&zip_path).map_err(|e| format!("打开压缩包失败：{e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("读取压缩包失败：{e}"))?;
    // 先读 manifest.json 定 id（支持根目录或单一一级子目录）
    let mut manifest_text: Option<String> = None;
    let mut prefix = String::new();
    {
        for i in 0..archive.len() {
            let mut e = archive.by_index(i).map_err(|e| e.to_string())?;
            let name = e.name().to_string();
            if e.is_dir() { continue; }
            let parts: Vec<&str> = name.split('/').filter(|p| !p.is_empty()).collect();
            if parts.last() == Some(&"manifest.json") && parts.len() <= 2 {
                let mut text = String::new();
                e.read_to_string(&mut text).map_err(|er| er.to_string())?;
                manifest_text = Some(text);
                prefix = if parts.len() == 2 { format!("{}/", parts[0]) } else { String::new() };
                break;
            }
        }
    }
    let manifest_text = manifest_text.ok_or("压缩包根目录未找到 manifest.json")?;
    let manifest: serde_json::Value =
        serde_json::from_str(&manifest_text).map_err(|e| format!("manifest.json 解析失败：{e}"))?;
    let id = manifest
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("manifest.json 缺 id")?
        .to_string();
    let kind = manifest.get("kind").and_then(|v| v.as_str()).unwrap_or("js").to_string();
    let dir = plugin_dir(&app, &id)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // 整包解压（prefix 剥离一级目录）
    for i in 0..archive.len() {
        let mut e = archive.by_index(i).map_err(|er| er.to_string())?;
        let name = e.name().to_string();
        if e.is_dir() { continue; }
        let rel = name.strip_prefix(&prefix).unwrap_or(&name).to_string();
        if rel.is_empty() { continue; }
        let out = zip_safe_path(&dir, &rel)?;
        if let Some(pp) = out.parent() {
            std::fs::create_dir_all(pp).map_err(|er| er.to_string())?;
        }
        let mut w = std::fs::File::create(&out).map_err(|er| er.to_string())?;
        std::io::copy(&mut e, &mut w).map_err(|er| format!("解压 {rel} 失败：{er}"))?;
    }
    if kind == "rust" {
        let bin = manifest
            .get("bin")
            .and_then(|v| v.as_str())
            .ok_or("rust 插件 manifest 缺 bin")?
            .to_string();
        let bin_path = dir.join(&bin);
        if !bin_path.exists() {
            return Err(format!("压缩包内缺二进制：{bin}"));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&bin_path, std::fs::Permissions::from_mode(0o755));
        }
        return Ok(serde_json::json!({
            "kind": "rust", "manifest": manifest, "binPath": bin_path.to_string_lossy(),
        }));
    }
    // js：入口 = manifest.entry 或根目录唯一 .js
    let entry = manifest
        .get("entry")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            std::fs::read_dir(&dir)
                .ok()?
                .filter_map(|r| r.ok())
                .map(|r| r.file_name().to_string_lossy().to_string())
                .filter(|n| n.ends_with(".js"))
                .collect::<Vec<_>>()
                .into_iter()
                .next()
        })
        .ok_or("js 插件包缺入口（manifest.entry 或根目录 .js）")?;
    let code = std::fs::read_to_string(dir.join(&entry)).map_err(|e| format!("读取 {entry} 失败：{e}"))?;
    Ok(serde_json::json!({ "kind": "js", "manifest": manifest, "code": code }))
}

/// 插件 logo 读取（logo 随插件包走：plugins/<id>/logo.svg|png）→ dataURL
#[tauri::command]
fn plugin_logo_data(app: tauri::AppHandle, id: String) -> Result<Option<String>, String> {
    use base64::Engine as _;
    // 候选：插件目录（正式落位）→ 打包资源 → 源码侧 resources/（dev）
    let mut dirs: Vec<std::path::PathBuf> = vec![plugin_dir(&app, &id)?];
    if let Ok(rd) = app.path().resource_dir() {
        dirs.push(rd.join("plugins").join(&id));
    }
    dirs.push(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("plugins")
            .join(&id),
    );
    for dir in &dirs {
        for (name, mime) in [("logo.svg", "image/svg+xml"), ("logo.png", "image/png")] {
            let p = dir.join(name);
            if let Ok(bytes) = std::fs::read(&p) {
                return Ok(Some(format!(
                    "data:{mime};base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(bytes)
                )));
            }
        }
    }
    Ok(None)
}

/// 卸载时清插件目录
#[tauri::command]
fn plugin_dir_remove(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let dir = plugin_dir(&app, &id)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 编译期平台判定（2026-09-19）：主 WebView UA 被 tauri.conf.json 硬编码成
/// Windows Chrome 79（wengine 指纹），Android 上 navigator.userAgent 不含
/// "Android"——JS 的 UA 判定恒 false，内嵌种入/自愈分支从未执行。改用本命令。
#[tauri::command]
fn os_is_android() -> bool {
    cfg!(target_os = "android")
}

/// 内置 OH sidecar 安装：把打包资源里的二进制复制进 plugins/onethu.harness/，
/// 返回新 binPath；资源缺失（未打包 sidecar）返回 None。跨平台：win 取 .exe。
#[tauri::command]
fn builtin_sidecar_install(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use std::path::Path;
    let exe_name = if cfg!(windows) { "onethu-harness.exe" } else { "onethu-harness" };
    // R10 实录：dev 下 resource_dir() 直接 Err("unknown path")——不能 ? 打断，
    // 候选列表逐个探测：打包资源 → 源码侧 resources/（编译期路径常量，dev 必中）
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(rd) = app.path().resource_dir() {
        candidates.push(rd.join("plugins").join("onethu.harness").join(exe_name));
    }
    candidates.push(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("plugins")
            .join("onethu.harness")
            .join(exe_name),
    );
    let res = match candidates.iter().find(|p| p.exists()) {
        Some(p) => p.clone(),
        None => return Ok(None),
    };
    let dir = plugin_dir(&app, "onethu.harness")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dst = dir.join(exe_name);
    // 内容一致则跳过复制（重复开机免写）
    let need = match std::fs::read(&res) {
        Ok(src) => std::fs::read(&dst).map(|d| d != src).unwrap_or(true),
        Err(_) => false,
    };
    if need {
        std::fs::copy(&res, &dst).map_err(|e| format!("内置 sidecar 复制失败：{e}"))?;
    }
    // logo 随包（logo.svg 与二进制同目录打包在资源里）
    if let Some(logo) = res.parent().map(|pp| pp.join("logo.svg")) {
        if logo.exists() {
            let _ = std::fs::copy(&logo, dir.join("logo.svg"));
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dst, std::fs::Permissions::from_mode(0o755));
    }
    Ok(Some(dst.to_string_lossy().to_string()))
}

/// 文本落盘（dock 导出会话等用）：系统「存储」对话框让用户自选位置。
/// Tauri WKWebView 不支持 a[download] blob 点击下载（无下载管理器，静默无效）。
/// ⚠️ 必须用回调式 save_file + oneshot 等待：Tauri v2 同步命令跑在主线程，
/// blocking_save_file 会自堵死锁（实测：对话框一弹全 App 冻结）。
/// async 命令跑在异步运行时线程，回调把结果经 oneshot 送回。用户取消返回 None。
#[tauri::command]
async fn save_text_file(
    app: tauri::AppHandle,
    filename: String,
    contents: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<tauri_plugin_dialog::FilePath>>();
    app.dialog()
        .file()
        .set_file_name(&filename)
        .save_file(move |path| {
            let _ = tx.send(path);
        });
    let picked = rx.await.map_err(|e| e.to_string())?;
    let Some(path) = picked else {
        return Ok(None); // 用户取消
    };
    let real = path.into_path().map_err(|e| e.to_string())?;
    if let Some(parent) = real.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&real, contents).map_err(|e| e.to_string())?;
    Ok(Some(real.to_string_lossy().to_string()))
}

/// 抓附件字节（download_file / save_file_as 共用）：
/// 会话失效识别、真名解析、空文件校验都收敛在这里——两处走同一套判断，
/// 免得出现「下载能识别会话失效、另存为却把登录页当文件写盘」这种不一致。
///
/// 会话失效的两种形态都要认：状态码 200 但内容是登录跳转页（HTML）、以及 HTML 里带
/// location.href 的短响应。但**附件本身就是 .html 时要放行**（用户就是来下网页的），
/// 故先看 Content-Type 与落盘名，再决定要不要按内容开头判。
pub(crate) async fn fetch_attachment(
    url: &str,
    cookies: &str,
    fallback_name: &str,
) -> Result<(String, Vec<u8>), String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        // 全部目标域均为 *.tsinghua.edu.cn，直连即可：强制绕过系统代理（reqwest 0.12
        // 默认读 Windows/ macOS 系统代理，全局模式梯子会把清华流量送出境触发风控）。
        // 仅救系统代理场景；TUN 网络层接管无解（参考 PR #2，user-A100）。
        .no_proxy()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(url)
        .header("Cookie", cookies)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        // 带上 URL：404 必须能一眼看出是哪条链接（历史上正是靠这条线索才发现走错了端点）
        eprintln!("[onethu] fetch_attachment {} {}", resp.status(), url);
        return Err(format!("HTTP {} — {}", resp.status(), url));
    }
    let content_disposition = resp
        .headers()
        .get(reqwest::header::CONTENT_DISPOSITION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.is_empty() {
        return Err("下载失败：文件内容为空（mobile 同款 bytesWritten==0 校验）".into());
    }
    let name = content_disposition
        .as_deref()
        .and_then(parse_cd_filename)
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| fallback_name.to_string());
    let name_is_html = {
        let lower = name.to_ascii_lowercase();
        lower.ends_with(".html") || lower.ends_with(".htm")
    };
    if !name_is_html {
        let head = String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]);
        let head = head.trim_start_matches('\u{feff}').trim_start();
        let looks_html = head.starts_with("<!DOCTYPE")
            || head.starts_with("<!doctype")
            || head.starts_with("<html");
        let login_redirect = bytes.len() < 4096 && head.contains("location.href");
        if content_type.starts_with("text/html") || looks_html || login_redirect {
            return Err("会话已失效，需要重新登录".into());
        }
    }
    Ok((name, bytes.to_vec()))
}

/// 带会话 Cookie 下载文件到设置中的下载目录（learn 直连；登录失效/空文件识别拒绝）。
/// 落盘名：响应 Content-Disposition 真名优先，其次调用方传入名（title.fileType）。
#[tauri::command]
async fn download_file(
    app: tauri::AppHandle,
    url: String,
    cookies: String,
    filename: String,
) -> Result<String, String> {
    let (name, bytes) = fetch_attachment(&url, &cookies, &filename).await?;
    let safe_name: String = name
        .chars()
        .map(|c| if c == '/' || c == ':' { '_' } else { c })
        .collect();
    // Android：先落应用缓存，再经系统桥转存「系统下载」（MediaStore，用户可见）
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let dir = app
            .path()
            .app_cache_dir()
            .map_err(|e| format!("无法定位缓存目录: {e}"))?
            .join("onethu-dl");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let tmp = dir.join(&safe_name);
        std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
        let handle = app
            .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
            .0
            .clone();
        let r: serde_json::Value = handle
            .run_mobile_plugin(
                "saveDownload",
                serde_json::json!({ "path": tmp.to_string_lossy(), "name": safe_name }),
            )
            .map_err(|e| e.to_string())?;
        if let Some(dir) = r.get("dir").and_then(|v| v.as_str()) {
            return Ok(format!("{dir}/{safe_name}"));
        }
        // 桥失败：缓存文件兜底（至少文件是完整的）
        return Ok(tmp.to_string_lossy().into_owned());
    }
    #[cfg(not(target_os = "android"))]
    {
        let dir = downloads::directory(&app)?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = dir.join(&safe_name);
        std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
        Ok(path.to_string_lossy().into_owned())
    }
}

/// 另存为：这一次下载落哪儿由用户当场决定（桌面 = 系统保存对话框；
/// Android = ACTION_CREATE_DOCUMENT）。取消返回 Ok(None)——用户改主意不是错误。
#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn save_file_as<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    url: String,
    cookies: String,
    filename: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (name, bytes) = fetch_attachment(&url, &cookies, &filename).await?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("另存为")
        .set_file_name(&name)
        .save_file(move |path| {
            let _ = tx.send(path);
        });
    let Some(picked) = rx.await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn save_file_as(
    app: tauri::AppHandle,
    url: String,
    cookies: String,
    filename: String,
) -> Result<Option<String>, String> {
    use tauri::Manager;
    let (name, bytes) = fetch_attachment(&url, &cookies, &filename).await?;
    // 先落应用缓存，再由 Activity 用 ACTION_CREATE_DOCUMENT 把字节写进用户挑的位置
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("无法定位缓存目录: {e}"))?
        .join("onethu-dl");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(&name);
    std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    let handle = app
        .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
        .0
        .clone();
    let r: serde_json::Value = handle
        .run_mobile_plugin_async(
            "saveAsDocument",
            serde_json::json!({ "path": tmp.to_string_lossy(), "name": name }),
        )
        .await
        .map_err(|e| e.to_string())?;
    if r.get("cancelled").and_then(|v| v.as_bool()).unwrap_or(false) {
        return Ok(None);
    }
    Ok(r.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()))
}

#[derive(Serialize)]
struct BinaryOut {
    /// 响应 Content-Type（去掉参数，如 image/png）
    mime: String,
    /// 字节流 base64
    data: String,
}

/// 带会话 Cookie 抓取二进制资源（learn 正文图片等），base64 回传给前端转 dataURL。
/// webview 的 <img> 不携带应用会话 Cookie，直挂 learn 地址只会得到登录页/401。
#[tauri::command]
async fn fetch_binary(
    url: String,
    cookies: String,
    referer: Option<String>,
    // 允许的最大字节数（默认 8MB，图片用；文件预览显式放大）：二进制要以 base64 经 IPC
    // 回传，几十 MB 的文件在这条路上会拖死 WebView——与其卡死，不如早拒并引导「下载后查看」。
    max_bytes: Option<u64>,
    // 超时秒数（默认 12；文件预览传大一些，图片的超时对文件不够用）
    timeout_secs: Option<u64>,
) -> Result<BinaryOut, String> {
    // 共享 client + 超时（2026-09-13 用户实锤「其他服务变慢」：每调用新建
    // client 无连接复用（每次全量 TLS 握手）且无任何超时——校外不可达直连
    // 挂到 OS 级 75s TCP 超时，反复开关通知=悬挂连接与 async 任务堆积）。
    // once_cell 懒初始化：连接池复用，connect 5s / 总 12s 硬顶。
    static CLIENT: std::sync::LazyLock<reqwest::Client> = std::sync::LazyLock::new(|| {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::limited(10))
            .no_proxy() // 同 download_file：清华域直连，绕系统代理（参考 PR #2）
            .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
            .connect_timeout(std::time::Duration::from_secs(5))
            // 单请求总超时在下面按参数设置（客户端是 static，读不到运行时的值）
            .build()
            .expect("fetch_binary client build")
    });
    let client = &*CLIENT;
    // learn 端点部分校验同域 Referer——统一带上首页引用页（防御性，实测无害）
    // Referer（2026-09-13 用户保存网页样本破案：downloadFiles 附件端点校验
    // 来源，webvpn 包装 URL 不含 learn 字样导致漏带 → 44ms「会话已失效」）。
    // 优先调用方显式传入；直连 learn 域 URL 兜底默认引用页。
    let mut req = client.get(&url).header("Cookie", cookies);
    let referer = referer.or_else(|| {
        if url.contains("learn.tsinghua.edu.cn") {
            Some("https://learn.tsinghua.edu.cn/f/wlxt/index.jsp".to_string())
        } else {
            None
        }
    });
    if let Some(r) = referer {
        req = req.header("Referer", r);
    }
    // 单请求超时：图片 12 秒够，文件预览要更宽（大 PDF 在这条路上本来就慢）
    let req = req.timeout(std::time::Duration::from_secs(timeout_secs.unwrap_or(12)));
    let resp = req
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        eprintln!("[onethu] fetch_binary {} {}", resp.status(), url);
        return Err(format!("HTTP {} — {}", resp.status(), url));
    }
    let mime = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    // 大小闸门：二进制要以 base64 经 IPC 回传，几十 MB 的文件在这条路上会拖死 WebView。
    // 先看 Content-Length，服务器没给就在读完后再判；超限返回带 "too-large" 标记的错误，
    // 前端据此提示「文件较大，请下载后查看」而不是丢一个网络错误。
    let limit = max_bytes.unwrap_or(8 * 1024 * 1024);
    if let Some(len) = resp.content_length() {
        if len > limit {
            return Err(format!("too-large:{}:{}", len, limit));
        }
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err(format!("too-large:{}:{}", bytes.len(), limit));
    }
    if bytes.is_empty() {
        return Err("预览失败：文件内容为空".into());
    }
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]);
    let head = head.trim_start_matches('\u{feff}').trim_start();
    let looks_html = head.starts_with("<!DOCTYPE") || head.starts_with("<!doctype") || head.starts_with("<html");
    let login_redirect = bytes.len() < 4096 && head.contains("location.href");
    if looks_html || login_redirect {
        return Err("会话已失效，需要重新登录".into());
    }
    use base64::Engine as _;
    Ok(BinaryOut {
        mime: if mime.is_empty() { "application/octet-stream".into() } else { mime },
        data: base64::engine::general_purpose::STANDARD.encode(&bytes),
    })
}

/// 真·cookie 引擎（2026-09-17 定案）：cookie_store crate——reqwest 内建仓
/// 背后的同一实现（RFC6265 域/路径/过期全语义，okHttp 级）。手搓 HashMap 仓
/// 的主域归并/属性忽略是当晚一切串票怪病的根因。种子/清仓走本类型真 API。
struct SharedNativeJar(std::sync::RwLock<cookie_store::CookieStore>, std::sync::atomic::AtomicBool);

/// cookie 仓落盘（2026-09-17：纯内存仓每次进程重启丢光 id 信任票据 →
/// 服务器反复索要 2FA；持久化后冷启动直接带票复用，登录/2FA 频率大幅下降）。
/// 行格式：domain<TAB>path<TAB>secure<TAB>name=value（Domain/Path 显式回种，
/// 不存 Expires——加载即会话票，运行期由服务器重新盖章续命）。
impl SharedNativeJar {
    fn seed_line(&self, url: &str, line: &str) {
        let Ok(u) = reqwest::Url::parse(url) else { return };
        let _ = self.0.write().unwrap().parse(line, &u);
        self.1.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    fn clear(&self) {
        self.0.write().unwrap().clear();
        self.1.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    fn save_to_file(&self, path: &std::path::Path) {
        let g = self.0.read().unwrap();
        let mut out = String::new();
        for c in g.iter_unexpired() {
            let domain = c.domain().unwrap_or("");
            let path = c.path().unwrap_or("/");
            let host = domain.trim_start_matches('.');
            if host.is_empty() { continue; }
            let line = format!(
                "{domain}\t{path}\t{}\t{}={}",
                if c.secure().unwrap_or(false) { "1" } else { "0" },
                c.name(),
                c.value()
            );
            out.push_str(&line);
            out.push('\n');
        }
        let _ = std::fs::write(path, out);
        self.1.store(false, std::sync::atomic::Ordering::Relaxed);
    }
    fn load_from_file(&self, path: &std::path::Path) {
        let Ok(text) = std::fs::read_to_string(path) else { return };
        let mut g = self.0.write().unwrap();
        for line in text.lines() {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() != 4 { continue; }
            let (domain, cpath, secure, kv) = (parts[0], parts[1], parts[2], parts[3]);
            let host = domain.trim_start_matches('.');
            let scheme = if secure == "1" { "https" } else { "http" };
            let Ok(u) = reqwest::Url::parse(&format!("{scheme}://{host}{cpath}")) else { continue };
            let set_cookie = format!("{kv}; Domain={domain}; Path={cpath}");
            let _ = g.parse(&set_cookie, &u);
        }
        self.1.store(false, std::sync::atomic::Ordering::Relaxed);
    }
    fn save_if_dirty(&self, path: &std::path::Path) {
        if self.1.load(std::sync::atomic::Ordering::Relaxed) {
            self.save_to_file(path);
        }
    }
}

fn jar_store_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.path().app_data_dir().unwrap_or_else(|_| std::path::PathBuf::from(".")).join("native-jar.tsv")
}

impl reqwest::cookie::CookieStore for SharedNativeJar {
    fn set_cookies(&self, cookie_headers: &mut dyn Iterator<Item = &reqwest::header::HeaderValue>, url: &reqwest::Url) {
        let mut g = self.0.write().unwrap();
        for h in cookie_headers {
            if let Ok(line) = h.to_str() {
                let _ = g.parse(line, url);
            }
        }
        self.1.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    fn cookies(&self, url: &reqwest::Url) -> Option<reqwest::header::HeaderValue> {
        let g = self.0.read().unwrap();
        let header = g
            .get_request_values(url)
            .map(|(n, v)| format!("{n}={v}"))
            .collect::<Vec<_>>()
            .join("; ");
        if header.is_empty() { None } else { reqwest::header::HeaderValue::from_str(&header).ok() }
    }
}

fn build_native_client() -> reqwest::Client {
    reqwest::Client::builder()
        .cookie_provider(std::sync::Arc::clone(&*NATIVE_JAR_ARC))
        .redirect(reqwest::redirect::Policy::none())
        // UA 必须与主 webview（tauri.conf.json windows[].userAgent）完全一致：
        // wengine webvpn 会话票绑定 UA 指纹，rust 与 webview 不一致时票被判无效
        // → THOS portal webview 打开即跳登录页（上游 thu-info-app 同构问题，
        // 它用 lib USER_AGENT 常量喂 RN WebView userAgent 解决）。
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.88 Safari/537.36")
        // 同 http_request：清华域直连，绕系统代理
        .no_proxy()
        .build()
        .expect("native client build")
}

static NATIVE_JAR_ARC: std::sync::LazyLock<std::sync::Arc<SharedNativeJar>> = std::sync::LazyLock::new(|| {
    std::sync::Arc::new(SharedNativeJar(
        std::sync::RwLock::new(cookie_store::CookieStore::default()),
        std::sync::atomic::AtomicBool::new(false),
    ))
});

static NATIVE_CLIENT: std::sync::LazyLock<std::sync::RwLock<reqwest::Client>> =
    std::sync::LazyLock::new(|| std::sync::RwLock::new(build_native_client()));

/// 原生浏览器语义通道（2026-09-17）：共享 reqwest client（cookie_store 原生
/// 分域仓，等价 RN okhttp 仓）+ Rust 手动跳循环（等价原生重定向跟随）。
/// thu-info-lib 全部请求走此通道。手动跳而非 Policy::limited 的原因：
/// 要把每一跳的 Set-Cookie（含中间跳）按 (所在跳URL, 原始行) 回传 TS——
/// Rust 原生仓与 TS jar 两套 cookie 世界的桥（TS 侧按真实域分桶入账）。
#[tauri::command]
async fn http_native(
    app: tauri::AppHandle,
    input: HttpInput,
) -> Result<HttpOutput, String> {
    let method: reqwest::Method = input
        .method
        .to_uppercase()
        .parse()
        .map_err(|e| format!("非法 HTTP 方法: {e}"))?;


    let mut url: reqwest::Url = input.url.parse().map_err(|e| format!("非法 URL: {e}"))?;
    let mut method_cur = method;
    let mut body_bytes: Option<Vec<u8>> = if let Some(b64) = &input.body_b64 {
        use base64::Engine as _;
        Some(
            base64::engine::general_purpose::STANDARD
                .decode(b64)
                .map_err(|e| format!("请求体 base64 解码失败: {e}"))?,
        )
    } else {
        input.body.clone().map(|s| s.into_bytes())
    };

    let mut hops_out: Vec<(String, String)> = Vec::new();
    let mut final_status = reqwest::StatusCode::OK;
    let mut final_headers: HashMap<String, String> = HashMap::new();
    let mut final_set_cookies: Vec<String> = Vec::new();
    let mut final_body: Vec<u8> = Vec::new();
    let mut final_url = url.to_string();

    for _hop in 0..=25u32 {
        let client = NATIVE_CLIENT.read().unwrap().clone();
        let mut req = client.request(method_cur.clone(), url.clone());
        // 诊断：首跳外发 cookie 名单 + 逐跳 URL/状态（铸票断链定位）
        if _hop == 0 {
            let sent = reqwest::cookie::CookieStore::cookies(NATIVE_JAR_ARC.as_ref(), &url)
                .and_then(|c: reqwest::header::HeaderValue| c.to_str().ok().map(|s: &str| s.to_string()))
                .unwrap_or_else(|| "(无)".into());
            debug_log_line(&format!("[NATIVE-STORE] {} → {}", url.host_str().unwrap_or("?"), sent));
        }
        for (k, v) in &input.headers {
            let lower = k.to_lowercase();
            // Cookie 由原生仓管理，手动传入反而跨跳污染
            if matches!(lower.as_str(), "host" | "content-length" | "cookie") {
                continue;
            }
            req = req.header(k, v);
        }
        if let Some(b) = &body_bytes {
            req = req.body(b.clone());
        }
        let hop_t0 = std::time::Instant::now();
        let resp = req.send().await.map_err(|e| format!("网络错误: {}", error_chain(&e)))?;
        let hop_ms = hop_t0.elapsed().as_millis();
        let status = resp.status();
        final_status = status;
        final_url = resp.url().to_string();
        // R21 逐跳计时入文件：定位「校内启动 20s」吃在哪一跳（logcat 读不到的旧痛）
        debug_log_line(&format!("[NATIVE-HOP{}] {} {}ms {} {}", _hop, status.as_u16(), hop_ms, method_cur.as_str(), resp.url().as_str().chars().take(210).collect::<String>()));

        let mut headers = HashMap::new();
        let mut set_cookies = Vec::new();
        for (name, value) in resp.headers().iter() {
            let v = value.to_str().unwrap_or("").to_string();
            if name.as_str().eq_ignore_ascii_case("set-cookie") {
                set_cookies.push(v.clone());
                hops_out.push((resp.url().to_string(), v));
            } else {
                headers.insert(name.as_str().to_lowercase(), v);
            }
        }

        // 跟随重定向（浏览器语义：303 一律 GET；301/302 的 POST 转 GET）
        if status.is_redirection() {
            if let Some(loc) = headers.get("location").cloned() {
                let next = url.join(&loc).map_err(|e| format!("重定向地址解析失败: {e}"))?;
                if status.as_u16() == 303
                    || ((status.as_u16() == 301 || status.as_u16() == 302)
                        && method_cur == reqwest::Method::POST)
                {
                    method_cur = reqwest::Method::GET;
                    body_bytes = None;
                }
                url = next;
                continue;
            }
        }

        final_headers = headers;
        final_set_cookies = set_cookies;
        let body_url_tag = resp.url().as_str().to_string();
        final_body = resp.bytes().await.map_err(|e| format!("读取响应失败: {}", error_chain(&e)))?.to_vec();
        // learn zyList POST 完整外发请求转储（400 根因对照老运输层）
        if (body_url_tag.contains("kczy") || body_url_tag.contains("bbs") || body_url_tag.contains("pageFzList") || body_url_tag.contains("checkSingle")) && method_cur.as_str() == "POST" {
            let mut hdr_dump = String::new();
            for (k, v) in &input.headers {
                hdr_dump.push_str(&format!("{}={:?}; ", k, v));
            }
            let body_str = body_bytes.as_ref().map(|b| String::from_utf8_lossy(b).chars().take(180).collect::<String>()).unwrap_or_default();
            println!("[NATIVE-REQ] {} HEADERS[{}] BODY[{}]", &body_url_tag[..body_url_tag.len().min(130)], hdr_dump, body_str);
        }
        // learn 域响应体首段（2026-09-17：200 装 HTML 的会话死法专诊）
        {
            let u = &body_url_tag;
            if u.contains("wlxt") {
                let head = String::from_utf8_lossy(&final_body[..final_body.len().min(1400)]).replace(['\n', '\r', '\t'], " ");
                println!("[NATIVE-BODY] {} | {}", &u[u.len().saturating_sub(70)..], head);
            }
        }
        break;
    }

    let ctype = final_headers.get("content-type").cloned().unwrap_or_default();
    let looks_text = ctype.starts_with("text/")
        || ctype.contains("html")
        || ctype.contains("json")
        || ctype.contains("xml");
    let (body, body_b64) = if looks_text {
        let charset = ctype
            .split(';')
            .rev()
            .find_map(|part| {
                let part = part.trim();
                part.strip_prefix("charset=").map(|c| c.trim_matches('"').trim().to_string())
            });
        let decoded = match charset.as_deref().and_then(|c| encoding_rs::Encoding::for_label(c.as_bytes())) {
            Some(enc) => enc.decode(&final_body).0.into_owned(),
            None => String::from_utf8_lossy(&final_body).into_owned(),
        };
        (decoded, None)
    } else {
        use base64::Engine as _;
        (String::new(), Some(base64::engine::general_purpose::STANDARD.encode(&final_body)))
    };
    Ok(HttpOutput {
        status: final_status.as_u16(),
        status_text: final_status.canonical_reason().unwrap_or("").to_string(),
        url: final_url,
        headers: final_headers,
        set_cookies: final_set_cookies,
        set_cookie_hops: Some(hops_out),
        body,
        body_b64,
    })
}

/// 原生 cookie 仓清空（换新匿名身份）。2026-09-17 实录：登录风暴后 id 服务器
/// 按会话 cookie 封锁设备（同 IP 的无 cookie 客户端正常）——被封锁时唯一解法。
#[tauri::command]
fn http_native_clear_cookies() -> Result<(), String> {
    NATIVE_JAR_ARC.clear();
    Ok(())
}

/// 按域后缀清 cookie（id 单点互踢根治）：lib 重登/选课自愈只清 id/oauth，
/// learn/info/教务/webvpn 的会话票全保——重建后各页秒恢复，不再红条几秒。
#[tauri::command]
fn http_native_clear_cookies_domain(suffixes: Vec<String>) -> Result<(), String> {
    let suffixes: Vec<String> = suffixes.iter().map(|s| s.to_lowercase()).collect();
    let keep: Vec<String> = {
        let g = NATIVE_JAR_ARC.0.read().unwrap();
        let mut lines = Vec::new();
        for c in g.iter_unexpired() {
            let domain = c.domain().unwrap_or("").trim_start_matches('.').to_lowercase();
            if domain.is_empty() { continue; }
            let hit = suffixes.iter().any(|s| domain == *s || domain.ends_with(&format!(".{}", s)));
            if hit { continue; }
            let path = c.path().unwrap_or("/").to_string();
            let secure = if c.secure().unwrap_or(false) { "1" } else { "0" };
            lines.push(format!("{}\t{}\t{}\t{}={}", c.domain().unwrap_or(""), path, secure, c.name(), c.value()));
        }
        lines
    };
    NATIVE_JAR_ARC.clear();
    {
        let mut g = NATIVE_JAR_ARC.0.write().unwrap();
        for line in &keep {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() != 4 { continue; }
            let (domain, cpath, secure, kv) = (parts[0], parts[1], parts[2], parts[3]);
            let host = domain.trim_start_matches('.');
            let scheme = if secure == "1" { "https" } else { "http" };
            let Ok(u) = reqwest::Url::parse(&format!("{scheme}://{host}{cpath}")) else { continue };
            let set_cookie = format!("{kv}; Domain={domain}; Path={cpath}");
            let _ = g.parse(&set_cookie, &u);
        }
    }
    NATIVE_JAR_ARC.1.store(true, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

/// jar → rust 播种（wengine 引导页票种等不经 Set-Cookie 的会话）
#[tauri::command]
fn http_native_seed(url: String, lines: Vec<String>) -> Result<(), String> {
    for l in &lines {
        NATIVE_JAR_ARC.seed_line(&url, l);
    }
    Ok(())
}

/// JNI 诊断辅助：当前线程名（不炸线程，失败返回 ?）
#[cfg(target_os = "android")]
fn thread_name(env: &mut jni::JNIEnv) -> String {
    use jni::objects::JString;
    let tc = match env.find_class("java/lang/Thread") {
        Ok(c) => c,
        Err(_) => return "?".into(),
    };
    let cur = match env.call_static_method(tc, "currentThread", "()Ljava/lang/Thread;", &[]) {
        Ok(v) => v,
        Err(_) => return "?".into(),
    };
    let cur = match cur.l() {
        Ok(o) => o,
        Err(_) => return "?".into(),
    };
    let nm = match env.call_method(&cur, "getName", "()Ljava/lang/String;", &[]) {
        Ok(v) => v,
        Err(_) => return "?".into(),
    };
    let nm = match nm.l() {
        Ok(o) => o,
        Err(_) => return "?".into(),
    };
    let js = JString::from(nm);
    env.get_string(&js)
        .map(|cs| cs.to_string_lossy().to_string())
        .unwrap_or_else(|_| "?".into())
}

/// JNI 诊断辅助：当前 pending 异常的 toString（调用方先 exception_check）
#[cfg(target_os = "android")]
fn throwable_to_string(env: &mut jni::JNIEnv) -> String {
    use jni::objects::JString;
    let t = match env.exception_occurred() {
        Ok(t) => t,
        Err(_) => return "?".into(),
    };
    let _ = env.exception_clear();
    let m = match env.call_method(&t, "toString", "()Ljava/lang/String;", &[]) {
        Ok(v) => v,
        Err(_) => return "?".into(),
    };
    let m = match m.l() {
        Ok(o) => o,
        Err(_) => return "?".into(),
    };
    let js = JString::from(m);
    env.get_string(&js)
        .map(|cs| cs.to_string_lossy().to_string())
        .unwrap_or_else(|_| "?".into())
}

/// probe 当前 webview 页面：href + 是否 wengine 登录壳（页面含 OAUTH 字样）
async fn webview_probe(webview: &tauri::Webview) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    let tx2 = tx.clone();
    let probe = r#"JSON.stringify({h: location.href, l: !!(document.body && document.body.innerText && document.body.innerText.indexOf('OAUTH') >= 0)})"#;
    webview
        .eval_with_callback(probe, move |v| {
            if let Ok(mut g) = tx2.lock() {
                if let Some(t) = g.take() {
                    let _ = t.send(v);
                }
            }
        })
        .ok()?;
    tokio::time::timeout(std::time::Duration::from_millis(700), rx)
        .await
        .ok()?
        .ok()
}

/// 统一认证登录页（id.tsinghua.edu.cn）自动填表脚本。
/// 页面真实结构（用户存档 HTML 实证）：字段 i_user/i_pass、验证码 i_code
/// （#c_code hidden 时免）、SM2 公钥 #sm2publicKey、提交函数 doLogin()
/// （内部完成 sm2Util.doEncryptStr + 指纹 + theform.submit）。
/// 上游 open_eid_window 的 username/password 字段属于电子身份 OAuth 另一页面，
/// 直接照抄从未咬合——这就是 THOS 自动登录一直失败的根因。
fn eid_fill_script(username: &str, password: &str) -> String {
    format!(
        r#"(function() {{
  try {{
    if (window.__ONETHU_EID_DONE) return;
    function fill() {{
      var u = document.getElementById("i_user");
      var p = document.getElementById("i_pass");
      if (!u || !p) return;
      window.__ONETHU_EID_DONE = true;
      function setv(el, v) {{
        var d = Object.getOwnPropertyDescriptor(el.__proto__, "value");
        d && d.set ? d.set.call(el, v) : (el.value = v);
        el.dispatchEvent(new Event("input", {{ bubbles: true }}));
        el.dispatchEvent(new Event("change", {{ bubbles: true }}));
      }}
      var hasCred = "{u}" !== "" && "{p}" !== "";
      if (!hasCred) {{ window.__ONETHU_EID_DONE = true; return; }}   // 无凭据：用户手输
      setv(u, {u:?});
      setv(p, {p:?});
      setTimeout(function() {{
        try {{
          if (typeof doLogin === "function") {{ doLogin(); return; }}
        }} catch (e) {{}}
        var b = document.querySelector("a[onclick*='doLogin'],button[onclick*='doLogin']");
        b && b.click();
      }}, 600);
    }}
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fill);
    else fill();
    setTimeout(fill, 1200);
  }} catch (e) {{}}
}})();"#,
        u = username,
        p = password
    )
}

/// ── 在线服务（THOS）内嵌官方页：rust 仓 cookie → 系统 WebView CookieManager ──
/// wry 0.55 的 set_cookie 在 Android 是空壳（Unsupported），只能走 JNI 直调
/// android.webkit.CookieManager.setCookie（tauri Webview::jni_handle 提供
/// webview 线程的 JNIEnv + WebView 对象，见 tauri 2.11 webview/mod.rs:2359）。
/// 注入后 webview 加载 webvpn/thos URL 即带完整会话——用户零二次登录，
/// 与上游 thu-info-app #950（RN WebView 共享平台 CookieManager）同构。
/// THOS 链日志直写调试日志（println 的 stdout 在 wrapper 下落点不明；安卓可导出）
fn thos_log(line: &str) {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    debug_log_line(&format!("THOS-LOG {ts} | {line}"));
}

/// 深色主题下把官方页「正文黑字」涂白（与 Kotlin 侧 DARK_INJECT_JS 同一份脚本；
/// tools/dark-inject-test.mjs 断言两者一致，防止漂移）。
/// 桌面用 WebviewWindowBuilder::initialization_script 注入，Android 用 onPageFinished 注入。
const DARK_PAINT_JS: &str = r#"(function(){
  if (window.__othDark) { window.__othPaint && window.__othPaint(); return; }
  window.__othDark = 1;
  var INK = '#E9E9E9', LINK = '#7AA2F7', PALE = 0.55;
  function lum(c){
    var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || '');
    if (!m) return null;
    return (0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]) / 255;
  }
  function paint(){
    var de = document.documentElement, b = document.body;
    de.style.setProperty('background-color', '#111315', 'important');
    if (b) b.style.setProperty('background-color', '#111315', 'important');
    var els = (b || de).querySelectorAll('*');
    for (var i = 0; i < els.length; i++){
      var el = els[i], t = el.tagName;
      if (t === 'IMG' || t === 'VIDEO' || t === 'CANVAS' || t === 'IFRAME' || t === 'SVG' || t === 'PATH') continue;
      try {
        var cs = getComputedStyle(el);
        var l = lum(cs.color);
        if (l !== null && l < PALE) el.style.setProperty('color', (t === 'A' ? LINK : INK), 'important');
        var bg = lum(cs.backgroundColor);
        if (bg !== null && bg > PALE) el.style.setProperty('background-color', 'transparent', 'important');
      } catch (e) {}
    }
  }
  window.__othPaint = paint;
  paint();
  document.addEventListener('DOMContentLoaded', paint);
  setTimeout(paint, 600); setTimeout(paint, 2000); setTimeout(paint, 5000);
  try {
    var t = null;
    new MutationObserver(function(){ if (t) return; t = setTimeout(function(){ t = null; paint(); }, 300); })
      .observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
})()"#;

/// 桌面端：独立子窗口打开官方服务页，并在导航前种入会话票（macOS / Windows）。
/// ⚠️ 线程模型（Windows 古老白屏 bug 的最终结论，2026-09-21）：**建窗必须走 async
/// 命令（tokio 工作线程），绝不能在 sync 命令 / 主线程里 build**——Tauri 官方文档
/// 明文警告「Windows 上 WebviewWindowBuilder 在同步命令与事件处理器中会死锁」
///（WebView2 创建要泵消息，主线程正被 sync 命令占着 → 白屏无响应、缩放黑块、
/// 关不掉、进程拖死，eid/作答/sports 三个 sync 命令与 R18b 的雨课堂窗口全是此病）。
/// 窗口工作线程内部自建自管（set_cookie/navigate 同线程），前端 invoke 透明。
#[cfg(desktop)]
async fn thos_portal_window(
    app: &tauri::AppHandle,
    seeds: &[(String, String)],
    target: &str,
    dark: bool,
) -> Result<(), String> {
    use tauri::webview::Cookie;
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    if !(target.starts_with("http://") || target.starts_with("https://")) {
        return Err("拒绝在应用内打开非 http(s) 链接".into());
    }
    let label = "thosportal";
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.close();
    }
    // UA 必须与主窗口一致（tauri.conf.json 里硬编码的 Chrome/79）：
    // **wengine 按客户端指纹（UA）管会话**，UA 不同就是另一个客户端，我们种进去的
    // webvpn 票不算数 → 子窗口照样被弹登录页（2026-09-20 实测：日志显示「已种 8 条」
    // 但页面仍要求登录）。这里直接沿用主窗口配置的 UA。
    let main_ua = app
        .config()
        .app
        .windows
        .first()
        .and_then(|w| w.user_agent.clone());
    let mut builder = WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::External("https://webvpn.tsinghua.edu.cn/".parse().unwrap()),
    )
    .title("在线服务 · OneTHU")
    .inner_size(1100.0, 820.0);
    if let Some(ua) = main_ua.as_deref() {
        builder = builder.user_agent(ua);
    }
    if dark {
        builder = builder.initialization_script(DARK_PAINT_JS);
    }
    let win = builder.build().map_err(|e| e.to_string())?;
    // 逐条注入（绝不打印 Cookie 值）。**每条都必须带自己的 Domain**：
    //   ① 三组票分属 webvpn / thos / id 三个域，缺域就全落到当前页 origin（webvpn），
    //      id/thos 的票等于没种；
    //   ② wry 的 set_cookie 对「无域 cookie」是**静默丢弃**——返回 Ok、计数照涨，
    //      日志看着"种了 8 条"而页面依旧弹登录（2026-09-20 两度踩坑：一次是漏 Domain，
    //      一次是这份修复只存在于工作区没入库，重建二进制后回归）。
    let mut seeded = 0usize;
    for (base, header) in seeds {
        let host = match url::Url::parse(base).ok().and_then(|u| u.host_str().map(str::to_string)) {
            Some(h) if !h.is_empty() => h,
            _ => continue,
        };
        for pair in header.split("; ") {
            let pair = pair.trim();
            if pair.is_empty() || !pair.contains('=') {
                continue;
            }
            if let Ok(c) = Cookie::parse(format!("{pair}; Domain={host}; Path=/")) {
                if win.set_cookie(c).is_ok() {
                    seeded += 1;
                }
            }
        }
    }
    thos_log(&format!(
        "[THOS-SEED] 独立窗口已种 {seeded} 条会话票（UA={}）→ {}",
        if main_ua.is_some() { "同主窗口" } else { "默认" },
        &target[..target.len().min(60)]
    ));
    Ok(())
}

#[tauri::command]
async fn thos_open_portal(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    url: String,
    username: String,
    password: String,
    dark: Option<bool>,
) -> Result<(), String> {
    // 1) 从原生仓收集三大域的未过期 cookie。
    //    注意：不能用 c.domain() 过滤——host-only cookie（服务器 Set-Cookie 不带
    //    Domain 属性，wengine_vpn_ticket 正是）的 domain() 返回 None，会全军覆没。
    //    用 CookieStore::matches(url)（RFC6265 域+路径匹配，host-only 也正确命中）。
    let seeds: Vec<(String, String)> = {
        let jar = NATIVE_JAR_ARC.0.read().unwrap();
        let mut out: Vec<(String, String)> = Vec::new();
        for base in [
            "https://webvpn.tsinghua.edu.cn/",
            "https://thos.tsinghua.edu.cn/",
            "https://id.tsinghua.edu.cn/",
        ] {
            let u: url::Url = base.parse().map_err(|e| format!("base url: {e}"))?;
            let header = jar
                .matches(&u)
                .iter()
                .map(|c| format!("{}={}", c.name(), c.value()))
                .collect::<Vec<_>>()
                .join("; ");
            if !header.is_empty() {
                out.push((base.to_string(), header));
            }
        }
        out
    };
    if seeds.is_empty() {
        return Err("本机会话为空：请先在 OneTHU 登录再打开在线服务".into());
    }

    // 1.5) 桌面端（macOS / Windows）：开**独立子 WebView 窗口**并在导航前逐条种会话票
    //      （与雨课堂官方页 open_ykt_submit_window 同一套做法）。此前桌面是把主 webview
    //      导航到目标页后立刻跳回 app，等于用户根本没看到页面，实际只能去系统浏览器裸奔
    //      → 每次都要二次验证（用户 2026-09-20 提问「mac 和 win 怎么办」）。
    //      窗口方式：先建在 webvpn 源根（同源）→ set_cookie（原生 jar 的 webvpn/thos/id 票）
    //      → 再导航到目标页，首跳就带会话，永不二次登录；深色时用 initialization_script
    //      注入涂白脚本（顺带解决官方页深色下黑字）。
    #[cfg(desktop)]
    {
        match thos_portal_window(&app, &seeds, &url, dark.unwrap_or(false)).await {
            Ok(()) => return Ok(()),
            Err(e) => {
                thos_log(&format!("[THOS-SEED] 独立窗口方式失败（{e}）→ 回退 JS 种票链"));
            }
        }
    }

    // 2) 移动端（Android）：开**全屏 Dialog WebView**（独立于主界面，关闭即回 app——
    //    绝不像上一版那样把主 webview 导航走），并在 loadUrl 之前用原生
    //    android.webkit.CookieManager 把会话票种进去（非反射，避免华为 WebView glue 的
    //    NoSuchMethodError）。信息来自 info app：它的官方页永不二次验证，是因为 RN 网络层与
    //    WebView 共用同一个 CookieManager；我们这里是两套存储，所以显式做「进页面种票、
    //    出页面回灌」的双向桥。
    //    关闭后：把 WebView 侧可能已刷新的 webvpn/id 票读回来灌进原生 jar（反向共享登录态）。
    #[cfg(mobile)]
    {
        let handle = app
            .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
            .0
            .clone();
        // 目标 origin 决定 cookie 归属域；webvpn/id/thos 的票一并种入（wengine 需要）
        let target_origin = url::Url::parse(&url)
            .map(|u| format!("{}://{}/", u.scheme(), u.host_str().unwrap_or("")))
            .unwrap_or_else(|_| "https://webvpn.tsinghua.edu.cn/".to_string());
        let combined = seeds
            .iter()
            .map(|(_, h)| h.as_str())
            .collect::<Vec<_>>()
            .join("; ");
        thos_log(&format!(
            "[THOS-SEED] 移动端全屏浏览：种 {} 组票（{} 条）→ {}",
            seeds.len(),
            combined.split("; ").filter(|x| x.contains('=')).count(),
            &url[..url.len().min(60)]
        ));
        // 错误必须冒出去：以前这里把 Result 丢进 `_`，插件侧一旦拒绝（Kotlin 抛错、
        // 活动不可用等）JS 侧仍当成功 → 用户看到的是"点了没反应"（2026-09-20 实录）。
        let opened: Result<serde_json::Value, _> = handle
            .run_mobile_plugin_async(
                "openWebModal",
                serde_json::json!({
                    "url": url,
                    "dark": dark.unwrap_or(false),
                    "cookie": combined,
                    "cookieUrl": target_origin,
                }),
            )
            .await;
        if let Err(e) = &opened {
            thos_log(&format!("[THOS-SEED] 应用内浏览窗口打开失败：{e}"));
        }
        opened.map_err(|e| format!("应用内浏览窗口打开失败：{e}"))?;
        // 对话框已关闭 → 反向回灌（用户在官方页里做的登录/续期同步回原生 jar）
        for base in [
            "https://webvpn.tsinghua.edu.cn/",
            "https://id.tsinghua.edu.cn/",
            "https://thos.tsinghua.edu.cn/",
        ] {
            let got: Result<serde_json::Value, _> = handle
                .run_mobile_plugin_async(
                    "readWebViewCookies",
                    serde_json::json!({ "url": base }),
                )
                .await;
            if let Ok(v) = got {
                if let Some(header) = v.get("cookie").and_then(|x| x.as_str()) {
                    if !header.is_empty() {
                        // seed_line 是 SharedNativeJar（自持锁）的方法，不是读锁 guard 上的
                        let mut n = 0;
                        for pair in header.split("; ") {
                            let pair = pair.trim();
                            if pair.contains('=') {
                                NATIVE_JAR_ARC.seed_line(base, pair);
                                n += 1;
                            }
                        }
                        thos_log(&format!("[THOS-SEED] 回灌 {base} ← {n} 条"));
                    }
                }
            }
        }
        return Ok(());
    }

    // 2) 注入 + 导航（Android）：纯 JS 方案——JNI CookieManagerAdapter 的
    //    setCookie 签名在华为新版 chromium glue 里已变（NoSuchMethodError
    //    实锤），改用 webview eval 在目标 origin 的 document 上写
    //    document.cookie（脚本写非 httpOnly 会话票合法且服务器照常受理，
    //    与上游 RN「WebView 与网络层共享平台 cookie」目标同构）。
    {
        // 记录来路：链完成后跳回 app 页面（dev=5180，prod=tauri.localhost，通用）
        let origin_url = {
            let (tx, rx) = tokio::sync::oneshot::channel::<String>();
            let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
            let _ = webview.eval_with_callback("location.origin + location.hash", move |v| {
                if let Ok(mut g) = tx.lock() {
                    if let Some(t) = g.take() {
                        let _ = t.send(v);
                    }
                }
            });
            tokio::time::timeout(std::time::Duration::from_millis(700), rx)
                .await
                .ok()
                .and_then(|r| r.ok())
                .map(|v| v.trim_matches('"').to_string())
                .unwrap_or_else(|| "http://tauri.localhost/#/thos".to_string())
        };
        thos_log(&format!("[THOS-SEED] 链启动 url={} 来路={}", &url[..url.len().min(60)], origin_url));
        let (seed_host, seed_header) = {
            // 目标 URL 的域决定在哪个 origin 种 cookie（webvpn 模式=webvpn 域，
            // 直连模式=thos 域）；webvpn 域优先级最高——全程代理域
            let u = url::Url::parse(&url).map_err(|e| format!("target url: {e}"))?;
            let host = u.host_str().unwrap_or("").to_string();
            let base = format!("https://{host}/");
            match seeds.iter().find(|(b, _)| b.contains(&host)) {
                Some((b, h)) => (b.clone(), h.clone()),
                None => (base, String::new()),
            }
        };
        if seed_header.is_empty() {
            return Err("本机无该域会话票：请先在 OneTHU 内打开一次在线服务列表".into());
        }

        // 2a) 第一跳：wengine-vpn/cookie 端点（wengine 自有路径，不被 auth
        //     filter 重定向 → 200 直达 webvpn origin，拿到可写 document.cookie
        //     的同源 document）。直接跳域根会被甩到 id OAuth form（probe 实锤）。
        let land_url = format!(
            "https://webvpn.tsinghua.edu.cn/wengine-vpn/cookie?method=get&host=thos.tsinghua.edu.cn&scheme=https&path=%2F"
        );
        webview
            .eval(&format!("location.href = {:?}", land_url))
            .map_err(|e| format!("导航落点: {e}"))?;

        // 2b) 域驱动注入循环：webview 无票时 webvpn 会把 OAuth 链甩到
        //     id.tsinghua.edu.cn（probe 实锤：auth/login/form 页）。策略 =
        //     probe 当前 document 的域 → 把仓里该域的会话票种上去（幂等）→
        //     reload 让请求带票重来 → id 有票则 302 回 webvpn callback →
        //     webvpn 票落地 → 继续前进，直到落在目标域。
        let extract_host = |v: &str| -> String {
            // v 形如 {"h":"https://id.x/y","r":"complete"}——取 h 值里 scheme://host
            if let Some(p) = v.find("https://") {
                let rest = &v[p + 8..];
                let end = rest.find('"').unwrap_or(rest.len());
                rest[..end].split('/').next().unwrap_or("").to_string()
            } else {
                String::new()
            }
        };
        let target_host = url::Url::parse(&url)
            .ok()
            .and_then(|u| u.host_str().map(|h| h.to_string()))
            .unwrap_or_default();
        let mut seeded_host = String::new();
        let mut landed = false;
        for round in 0..30 {
            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
            let (tx, rx) = tokio::sync::oneshot::channel::<String>();
            let probe = r#"JSON.stringify({h: location.href, r: document.readyState})"#;
            let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
            let tx2 = tx.clone();
            if webview
                .eval_with_callback(probe, move |v| {
                    if let Ok(mut g) = tx2.lock() {
                        if let Some(t) = g.take() {
                            let _ = t.send(v);
                        }
                    }
                })
                .is_err()
            {
                continue;
            }
            let v = match tokio::time::timeout(std::time::Duration::from_millis(350), rx).await {
                Ok(Ok(v)) => v,
                _ => {
                    if round < 4 {
                        println!("[THOS-SEED] probe#{round}: <无回调/超时>");
                    }
                    continue;
                }
            };
            if round < 6 {
                println!("[THOS-SEED] probe#{round}: {}", v.chars().take(150).collect::<String>());
            }
            let cur_host = extract_host(&v);
            // webvpn 域：种 rust 仓的会话票（一次），让后续导航全部带票
            // （必须先于 landed 判断——wengine 落点页本身就在 webvpn 域，
            //  先 landed 会直接 break 导致种票永不执行）
            if cur_host.contains("webvpn.tsinghua") && seeded_host != cur_host {
                let hdr = seeds
                    .iter()
                    .find(|(b, _)| b.contains("webvpn.tsinghua"))
                    .map(|(_, h)| h.clone());
                if let Some(hdr) = hdr {
                    let mut inject = String::from("(function(){try{");
                    for pair in hdr.split("; ") {
                        inject.push_str(&format!(
                            "document.cookie={:?};",
                            format!("{pair}; Path=/")
                        ));
                    }
                    inject.push_str("}catch(e){}})()");
                    webview.eval(&inject).ok();
                    seeded_host = cur_host.clone();
                    println!("[THOS-SEED] 已种 webvpn 会话票（{} 条）", hdr.split("; ").count());
                    // 落点页本身不需要前进；直接进入 3) 强跳目标
                    break;
                }
            }
            // id 域：EID 自动填表（页面自带 SM2 + submitForm）。webview 建立
            // 自己的会话（独立 UA 指纹，见 conf userAgent——wengine 按客户端
            // 指纹管会话，与 rust 的 Chrome79 会话共存，互不 logoutByOther）。
            if cur_host.contains("id.tsinghua") {
                let eid = eid_fill_script(&username, &password);
                if seeded_host != cur_host {
                    println!("[THOS-SEED] id 表单页 → 注入 EID 自动填表");
                    seeded_host = cur_host.clone();
                }
                webview.eval(&eid).ok();
                continue;
            }
        }
        println!("[THOS-SEED] 域循环结束 landed={landed}");

        // 3) 严格借票验证：webview 永不建立新 webvpn 会话（OAUTH/EID 自动登录
        //    会触发 logoutByOther 把 rust 端踢下线——实测互踢源头）。种票后开门
        //    户验证：登录壳 = 票死 → 重种一次（rust 端 401 自愈已续新票）→ 仍死
        //    → 回退报错。前端重试时种到的是 rust 刚续的活票，必过。
        webview
            .eval("location.href = \"https://webvpn.tsinghua.edu.cn/\"")
            .ok();
        let mut portal_ok = false;
        let mut diag_done = false;
        for round in 0..40 {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let v = match webview_probe(&webview).await {
                Some(v) => v,
                None => continue,
            };
            let is_login = v.contains("\"l\":true");
            let on_webvpn = v.contains("webvpn.tsinghua.edu.cn")
                && !v.contains("wengine-vpn/cookie");
            let cur_host = if let Some(p) = v.find("https://") {
                let rest = &v[p + 8..];
                let end = rest.find('"').unwrap_or(rest.len());
                rest[..end].split('/').next().unwrap_or("").to_string()
            } else {
                String::new()
            };
            if round < 6 {
                println!(
                    "[THOS-SEED] portal#{round}: {} login={is_login}",
                    v.chars().take(110).collect::<String>()
                );
            }
            if on_webvpn && !is_login {
                portal_ok = true;
                break;
            }
            if is_login {
                // wengine 登录壳：自动点 OAUTH 统一身份认证登录 → 链到 id
                let click = r#"(function(){var bs=document.querySelectorAll('button,a,div[onclick],input[type=button],span');for(var i=0;i<bs.length;i++){if((bs[i].innerText||'').indexOf('OAUTH')>=0){bs[i].click();return 'clicked'}}return 'no-btn'})()"#;
                webview.eval(click).ok();
                continue;
            }
            if cur_host.contains("id.tsinghua") {
                // 诊断：form 页真实 DOM（字段 id/name、iframe、按钮）——
                // 跳转刚发生时 document 还空着，拿到非空结构才停
                if !diag_done {
                    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
                    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
                    let tx2 = tx.clone();
                    let diag = r#"JSON.stringify({u:!!document.getElementById("username"),p:!!document.getElementById("password"),inputs:Array.from(document.querySelectorAll("input")).slice(0,8).map(i=>i.id+"|"+i.name+"|"+i.type),iframes:document.querySelectorAll("iframe").length,btns:Array.from(document.querySelectorAll("button,[onclick],input[type=submit]")).slice(0,5).map(b=>(b.getAttribute("onclick")||b.tagName)+":"+((b.innerText||"").slice(0,10)))})"#;
                    let ok = webview
                        .eval_with_callback(diag, move |v| {
                            if let Ok(mut g) = tx2.lock() {
                                if let Some(t) = g.take() {
                                    let _ = t.send(v);
                                }
                            }
                        })
                        .is_ok();
                    if ok {
                        match tokio::time::timeout(std::time::Duration::from_millis(1200), rx).await {
                            Ok(Ok(v)) => {
                                let filled = v.contains("inputs\":[{");
                                if filled {
                                    diag_done = true;
                                }
                                println!(
                                    "[THOS-SEED] ID-FORM 诊断: {}",
                                    v.chars().take(400).collect::<String>()
                                );
                            }
                            _ => println!("[THOS-SEED] ID-FORM 诊断: <无回调>"),
                        }
                    }
                }
                let eid = eid_fill_script(&username, &password);
                webview.eval(&eid).ok();
                continue;
            }
        }
        println!("[THOS-SEED] 门户确认 portal_ok={portal_ok}");

        // 3.5) 会话没通过：不把用户撂在登录壳——退回 app 让用户重试一次
        //      （webvpn 单会话互踢所致：第一次点击链路已把票落地 webview，
        //      第二次点击必过——把"退出去再点一下"自动化）
        if !portal_ok {
            // history.back() 只退到 OAuth 链的中间页（白屏）——直接强跳回 app
            webview
                .eval(&format!("location.href = {}", serde_json::to_string(&origin_url).unwrap_or_default()))
                .ok();
            return Err("在线服务会话未建立，请再点一次".into());
        }

        // 3.8) webview 会话回灌主 jar（桌面 id checkSingle 死结的总解）：THOS
        //      链在 webview 里建立的 webvpn/id 会话是活的，主 jar 的会话被账
        //      号级确认态卡死且登录链无法解除。cookies_for_url 读回灌进主 jar，
        //      全服务立即恢复（id 域无 wengine 指纹绑定，跨客户端搬运安全）。
        {
            let jar = &*NATIVE_JAR_ARC;
            for dom in ["https://webvpn.tsinghua.edu.cn/", "https://id.tsinghua.edu.cn/"] {
                let du = match url::Url::parse(dom) {
                    Ok(u) => u,
                    Err(_) => continue,
                };
                match webview.cookies_for_url(du.clone()) {
                    Ok(cookies) if !cookies.is_empty() => {
                        for c in &cookies {
                            jar.seed_line(du.as_str(), &format!("{}={}", c.name(), c.value()));
                        }
                        thos_log(&format!("[THOS-SEED] 回灌 {} → {} 条", dom, cookies.len()));
                    }
                    _ => thos_log(&format!("[THOS-SEED] 回灌 {} → 空", dom)),
                }
            }
        }

        // 4) 带会话进目标页
        webview
            .eval(&format!("location.href = {}", serde_json::to_string(&url).unwrap_or_default()))
            .map_err(|e| format!("导航目标: {e}"))?;
        thos_log(&format!("[THOS-SEED] 会话链完成 → {}", &url[..url.len().min(60)]));
        // 5) 桌面统一：跳回 app 页面（THOS 官方页由系统浏览器打开的需求后续再议）
        webview
            .eval(&format!("location.href = {}", serde_json::to_string(&origin_url).unwrap_or_default()))
            .ok();
        thos_log(&format!("[THOS-SEED] 已跳回 {}", origin_url));
        Ok(())
    }
}

#[tauri::command]
async fn http_request(input: HttpInput) -> Result<HttpOutput, String> {
    let method: reqwest::Method = input
        .method
        .to_uppercase()
        .parse()
        .map_err(|e| format!("非法 HTTP 方法: {e}"))?;

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        // 主网络通道：全部目标域均为 *.tsinghua.edu.cn（webvpn/id/learn/info/card…），
        // 直连即可。reqwest 0.12 默认读 Windows/macOS 系统代理——全局模式梯子会把
        // 清华流量送出境：id 风控慢响应（转圈）、验证码与会话出口 IP 不一致（对码
        // 判错）、响应被代理拦截（点重发反而直接进入，#1 实录）。
        // ⚠️ 只救系统代理场景：TUN 模式在网络层接管，应用层无解（参考 PR #2）。
        .no_proxy()
        .timeout(Duration::from_millis(input.timeout_ms.unwrap_or(20000)))
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client.request(method, &input.url);
    for (k, v) in &input.headers {
        // 跳过宿主自动管理的头，避免重复/冲突
        let lower = k.to_lowercase();
        if matches!(lower.as_str(), "host" | "content-length") {
            continue;
        }
        req = req.header(k, v);
    }
    let body_bytes: Option<Vec<u8>> = if let Some(b64) = &input.body_b64 {
        use base64::Engine as _;
        Some(
            base64::engine::general_purpose::STANDARD
                .decode(b64)
                .map_err(|e| format!("请求体 base64 解码失败: {e}"))?,
        )
    } else {
        input.body.clone().map(|s| s.into_bytes())
    };
    if let Some(b) = body_bytes {
        req = req.body(b);
    }

    let resp = req.send().await.map_err(|e| format!("网络错误: {}", error_chain(&e)))?;
    let status = resp.status();
    let mut headers = HashMap::new();
    let mut set_cookies = Vec::new();
    for (name, value) in resp.headers().iter() {
        let v = value.to_str().unwrap_or("").to_string();
        if name.as_str().eq_ignore_ascii_case("set-cookie") {
            set_cookies.push(v);
        } else {
            headers.insert(name.as_str().to_lowercase(), v);
        }
    }
    let body_bytes = resp.bytes().await.map_err(|e| format!("读取响应失败: {}", error_chain(&e)))?;
    // 分流规则：文本类（text/*、html/json/xml）按 Content-Type charset 解码为字符串
    // （reqwest text() 原语义，gb2312 教务页依赖此通道）；其余（图片/PDF/流）且非合法
    // UTF-8 时走 base64 字节通道——字符串通道会把 0x89 等 lossy 成 U+FFFD 损坏二进制。
    let ctype = headers.get("content-type").cloned().unwrap_or_default();
    let looks_text = ctype.starts_with("text/")
        || ctype.contains("html")
        || ctype.contains("json")
        || ctype.contains("xml");
    let (body, body_b64) = if looks_text {
        // reqwest text() 原语义：按 Content-Type charset 解码（gb2312 教务页依赖），
        // 无 charset 或未知标签时回退 UTF-8 lossy
        let charset = ctype
            .split(';')
            .rev()
            .find_map(|part| {
                let part = part.trim();
                part.strip_prefix("charset=").map(|c| c.trim_matches('"').trim().to_string())
            });
        let decoded = match charset.as_deref().and_then(|c| encoding_rs::Encoding::for_label(c.as_bytes())) {
            Some(enc) => enc.decode(&body_bytes).0.into_owned(),
            None => String::from_utf8_lossy(&body_bytes).into_owned(),
        };
        (decoded, None)
    } else {
        match std::str::from_utf8(&body_bytes) {
            Ok(text) => (text.to_string(), None),
            Err(_) => {
                use base64::Engine as _;
                (String::new(), Some(base64::engine::general_purpose::STANDARD.encode(&body_bytes)))
            }
        }
    };

    Ok(HttpOutput {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers,
        set_cookies,
        set_cookie_hops: None,
        url: input.url,
        body,
        body_b64,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
#[tauri::command]
async fn open_eid_window(
    app: tauri::AppHandle,
    username: String,
    password: String,
) -> Result<String, String> {
    use tauri::webview::WebviewWindowBuilder;
    use tauri::WebviewUrl;
    let label = "eid";
    if app.get_webview_window(label).is_some() {
        return Ok("exists".into());
    }
    // 初始化脚本：登录表单存在时自动填账号密码；无图形验证码时自动提交。
    // sessionStorage 守卫防循环（登录后跳转的页面不再自动提交）。
    let script = format!(
        r#"(function() {{
  try {{
    if (window.__ONETHU_EID_DONE) return;
    function fill() {{
      var u = document.getElementById("username");
      var p = document.getElementById("password");
      if (!u || !p) return;
      window.__ONETHU_EID_DONE = true;
      function setv(el, v) {{
        var d = Object.getOwnPropertyDescriptor(el.__proto__, "value");
        d && d.set ? d.set.call(el, v) : (el.value = v);
        el.dispatchEvent(new Event("input", {{ bubbles: true }}));
        el.dispatchEvent(new Event("change", {{ bubbles: true }}));
      }}
      setv(u, {u:?});
      setv(p, {p:?});
      var cap = document.getElementById("i_code");
      var capBox = cap && cap.offsetParent !== null;
      if (!capBox) {{
        setTimeout(function() {{
          var b = document.querySelector("button[onclick*='submitForm']");
          b && b.click();
        }}, 400);
      }}
    }}
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fill);
    else fill();
    setTimeout(fill, 1200);
  }} catch (e) {{}}
}})();"#,
        u = username,
        p = password,
    );
    let win = WebviewWindowBuilder::new(
        &app,
        label,
        WebviewUrl::External("https://id.tsinghua.edu.cn/f/login".parse().unwrap()),
    )
    .title("清华电子身份 · 账户设置")
    .inner_size(430.0, 640.0)
    .initialization_script(&script)
    .build()
    .map_err(|e| e.to_string())?;
    let _ = win.set_focus();
    Ok("opened".into())
}

/* ---------------- R18 24.2：雨课堂「官方网页登录」WebView 通道 ----------------
 * 打开应用内原生窗口指向 pro.yuketang.cn/web，用户在其中完成扫码或
 * 「手机号 + 图形验证码 + 短信」登录；随后主窗口点「我已登录，读取会话」→
 * read_ykt_cookies 从同一 webview 数据目录读取 Cookie（含 HttpOnly，wry/tauri
 * 的 cookies_for_url 支持），前端经 yuketangBuildCookie 补齐清华字段后保存。
 * 读不到（浏览器预览 / 未登录 / 平台不支持）→ 前端回退「高级：手动粘贴 Cookie」。
 *
 * R18b 25.3.2：原先裸 WebviewWindowBuilder（无注入脚本、无回传通道）在 Windows
 * 实测白屏、缩放不重绘、关不掉（主线程卡死）。改为复用 open_eid_window /
 * open_sports_window 已验证的窗口套路：注入脚本 + document.title 回传 + 后台
 * 线程轮询（远程页无 IPC 权限，title 是最稳的回传通道）；cookie 读取在后台线程
 * 走 cookies_for_url（Windows 主线程读会死锁），不占主线程。 */

#[cfg(desktop)]
#[tauri::command]
async fn open_ykt_window(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::webview::WebviewWindowBuilder;
    use tauri::WebviewUrl;
    let label = "yktlogin";
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.set_focus();
        return Ok("exists".into());
    }
    // 初始化脚本：远程登录页右下角注入固定「我已登录，读取会话」按钮，点击后把
    // 标记写进 document.title（与 open_sports_window 同款 title 回传通道）。
    // 仅注入一次；登录后跳转的页面不再重复注入（用 window 标记守卫）。
    let script = r#"(function() {
  if (window.__ONETHU_YKT_BTN) return;
  window.__ONETHU_YKT_BTN = true;
  function mount() {
    try {
      if (!document.body || document.getElementById("onethu-ykt-read")) return;
      var b = document.createElement("button");
      b.id = "onethu-ykt-read";
      b.textContent = "我已登录，读取会话";
      b.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:10px 16px;border:0;border-radius:8px;background:#1a6fd4;color:#fff;font-size:14px;box-shadow:0 4px 16px rgba(0,0,0,.3)";
      b.onclick = function() { document.title = "ONETHU_YKT_READY"; };
      document.body.appendChild(b);
    } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();"#;
    let win = WebviewWindowBuilder::new(
        &app,
        label,
        WebviewUrl::External("https://pro.yuketang.cn/web".parse().unwrap()),
    )
    .title("雨课堂 · 官方网页登录")
    .inner_size(480.0, 760.0)
    .initialization_script(script)
    .build()
    .map_err(|e| e.to_string())?;
    let _ = win.set_focus();
    // 轮询窗口标题：发现「我已登录」标记 → 在**后台线程**用 cookies_for_url 读
    // Cookie（Windows 主线程读会死锁）→ 拿到 sessionid 就 emit + 关窗；没拿到
    // 则复位标题让用户重试。最长 10 分钟（与 open_sports_window 一致）。
    std::thread::spawn(move || {
        for _ in 0..600 {
            std::thread::sleep(std::time::Duration::from_millis(1000));
            let Some(w) = app.get_webview_window(label) else {
                return; // 用户已关窗
            };
            if w.title().unwrap_or_default() != "ONETHU_YKT_READY" {
                continue;
            }
            let header = url::Url::parse("https://pro.yuketang.cn/")
                .ok()
                .and_then(|u| w.cookies_for_url(u).ok())
                .map(|cs| {
                    cs.iter()
                        .map(|c| format!("{}={}", c.name(), c.value()))
                        .collect::<Vec<_>>()
                        .join("; ")
                })
                .unwrap_or_default();
            if header.contains("sessionid=") {
                let _ = w.close();
                use tauri::Emitter;
                let _ = app.emit("ykt-cookie", header);
                return;
            }
            // 尚未登录：复位标题，注入按钮可再次点击
            let _ = w.eval("document.title='雨课堂 · 官方网页登录'");
        }
    });
    Ok("opened".into())
}

/// 读取 yktlogin 窗口内 `pro.yuketang.cn` 的 Cookie（含 HttpOnly），返回 `name=value; …` 原文。
/// ⚠️ Windows 上必须在异步命令 / 非主线程读取，否则 WebView2 死锁（Tauri 文档）。
/// ⚠️ Android 不支持该 API（恒返回空），移动端走 `#[cfg(mobile)]` 的 CookieManager 桥。
#[cfg(desktop)]
#[tauri::command]
async fn read_ykt_cookies(app: tauri::AppHandle) -> Result<String, String> {
    let win = app
        .get_webview_window("yktlogin")
        .ok_or_else(|| "雨课堂登录窗口未打开".to_string())?;
    let url = url::Url::parse("https://pro.yuketang.cn/").map_err(|e| e.to_string())?;
    let cookies = win.cookies_for_url(url).map_err(|e| e.to_string())?;
    let header = cookies
        .iter()
        .map(|c| format!("{}={}", c.name(), c.value()))
        .collect::<Vec<_>>()
        .join("; ");
    if header.is_empty() {
        return Err(
            "未读到 pro.yuketang.cn 的 Cookie：请先在窗口内完成登录，或改用「高级：手动粘贴 Cookie」"
                .into(),
        );
    }
    Ok(header)
}

#[cfg(desktop)]
#[tauri::command]
fn close_ykt_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("yktlogin") {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}


#[cfg(desktop)]
#[tauri::command]
async fn open_sports_window(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::webview::WebviewWindowBuilder;
    use tauri::WebviewUrl;
    let label = "venueauth";
    if let Some(old) = app.get_webview_window(label) {
        let _ = old.close();
    }
    // 初始化脚本：轮询 localStorage.headers 里的 JWT（体育系统 SPA 登录成功后写入），
    // 拿到后写 document.title 标记（远程页面无 IPC 权限，title 是最稳的回传通道）。
    let script = r#"(function() {
  if (window.__ONETHU_VPOLL) return;
  window.__ONETHU_VPOLL = true;
  function poll() {
    try {
      var h = window.localStorage.getItem("headers");
      if (h) {
        var t = JSON.parse(h).token;
        if (t && t.length > 40) {
          document.title = "ONETHU_VTOKEN::" + t;
        }
      }
    } catch (e) {}
    setTimeout(poll, 500);
  }
  poll();
})();"#;
    let win = WebviewWindowBuilder::new(
        &app,
        label,
        WebviewUrl::External("https://www.sports.tsinghua.edu.cn/venue/index.html".parse().unwrap()),
    )
    .title("清华体育系统 · 登录授权")
    .inner_size(520.0, 720.0)
    .initialization_script(script)
    .build()
    .map_err(|e| e.to_string())?;
    let _ = win.set_focus();
    // 轮询窗口标题，发现 token 标记 → emit "sports-token" → 关窗（最长 10 分钟）
    std::thread::spawn(move || {
        for _ in 0..600 {
            std::thread::sleep(std::time::Duration::from_millis(1000));
            let Some(w) = app.get_webview_window(label) else {
                return; // 用户已关窗
            };
            let title = w.title().unwrap_or_default();
            if let Some(token) = title.strip_prefix("ONETHU_VTOKEN::") {
                let token = token.to_string();
                let _ = w.close();
                use tauri::Emitter;
                let _ = app.emit("sports-token", token);
                return;
            }
        }
    });
    Ok("opened".into())
}

#[cfg(mobile)]
#[tauri::command]
fn open_eid_window(_app: tauri::AppHandle, _username: String, _password: String) -> Result<String, String> {
    // 移动端无多窗口：前端捕获本错误后改用 opener 跳系统浏览器
    Err("移动端请在系统浏览器打开电子身份".into())
}

/* R18 24.2 移动端：应用内 WebView 由 onethu-mobile 插件（Kotlin）以 Dialog 呈现，
 * Cookie 走 android.webkit.CookieManager（Tauri 的 cookies_for_url 在 Android 恒空）。 */

#[cfg(mobile)]
#[tauri::command]
async fn open_ykt_window(app: tauri::AppHandle) -> Result<String, String> {
    let handle = app
        .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
        .0
        .clone();
    // R18b 25.3.1：全屏 Dialog 内的「我已登录，读取会话」直接读回 Cookie 原文并
    // 在此 resolve；用户直接关闭则为空串。用 async 版本等待，不阻塞工作线程。
    let r: serde_json::Value = handle
        .run_mobile_plugin_async("openYktWebLogin", serde_json::json!({}))
        .await
        .map_err(|e| e.to_string())?;
    Ok(r.get("cookie")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string())
}

#[cfg(mobile)]
#[tauri::command]
async fn read_ykt_cookies(app: tauri::AppHandle) -> Result<String, String> {
    let handle = app
        .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
        .0
        .clone();
    let r: serde_json::Value = handle
        .run_mobile_plugin("readYktCookies", serde_json::json!({}))
        .map_err(|e| e.to_string())?;
    let cookie = r.get("cookie").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if cookie.is_empty() {
        return Err(
            "未读到 pro.yuketang.cn 的 Cookie：请先在窗口内完成登录，或改用「高级：手动粘贴 Cookie」"
                .into(),
        );
    }
    Ok(cookie)
}

#[cfg(mobile)]
#[tauri::command]
fn close_ykt_window(_app: tauri::AppHandle) -> Result<(), String> {
    // 移动端是应用内 Dialog WebView，由用户自行关闭
    Ok(())
}

/* R18c：扫码期间 Android 前台服务保活（QrKeepAliveService）。
 * 前端 YktQrPanel 在二维码就绪时 start、成功/取消/过期/卸载时 stop。
 * 桌面端无此机制，返回 {ok:false, reason:"not-android"}，前端零行为变化。 */

#[cfg(desktop)]
#[tauri::command]
fn start_qr_keep_alive() -> serde_json::Value {
    serde_json::json!({ "ok": false, "reason": "not-android" })
}

#[cfg(desktop)]
#[tauri::command]
fn stop_qr_keep_alive() -> serde_json::Value {
    serde_json::json!({ "ok": true, "reason": "not-android" })
}

#[cfg(mobile)]
#[tauri::command]
async fn start_qr_keep_alive(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let handle = app
        .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
        .0
        .clone();
    // API 33+ 通知权限弹窗需等用户操作，故用 async 版本等待，不阻塞工作线程。
    handle
        .run_mobile_plugin_async("startQrKeepAlive", serde_json::json!({}))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(mobile)]
#[tauri::command]
async fn stop_qr_keep_alive(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let handle = app
        .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
        .0
        .clone();
    handle
        .run_mobile_plugin_async("stopQrKeepAlive", serde_json::json!({}))
        .await
        .map_err(|e| e.to_string())
}

/* 桌面小组件（Android）：JS 把渲染好的快照推给原生，原生存 SharedPreferences 并重画
 * 已放置的小组件；启动后取走「用户点的是哪个落点」。桌面端无小组件，一律返回 not-android。 */

#[cfg(desktop)]
#[tauri::command]
fn widget_push(_snapshot: String) -> serde_json::Value {
    serde_json::json!({ "ok": false, "reason": "not-android" })
}

#[cfg(desktop)]
#[tauri::command]
fn widget_clear() -> serde_json::Value {
    serde_json::json!({ "ok": false, "reason": "not-android" })
}

#[cfg(desktop)]
#[tauri::command]
fn widget_take_target() -> serde_json::Value {
    serde_json::json!({ "ok": false, "reason": "not-android", "target": "" })
}

#[cfg(mobile)]
#[tauri::command]
async fn widget_push(app: tauri::AppHandle, snapshot: String) -> Result<serde_json::Value, String> {
    let handle = app
        .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
        .0
        .clone();
    handle
        .run_mobile_plugin_async("widgetPush", serde_json::json!({ "snapshot": snapshot }))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(mobile)]
#[tauri::command]
async fn widget_clear(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let handle = app
        .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
        .0
        .clone();
    handle
        .run_mobile_plugin_async("widgetClear", serde_json::json!({}))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(mobile)]
#[tauri::command]
async fn widget_take_target(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let handle = app
        .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
        .0
        .clone();
    handle
        .run_mobile_plugin_async("widgetTakeTarget", serde_json::json!({}))
        .await
        .map_err(|e| e.to_string())
}

/* 系统通知（三端）：JS 侧 notifyPlan.ts 算出「什么时候发什么」，这里只做投递。
 *
 * Android：经 onethu-mobile 插件落到 AlarmManager（进程被杀也送得到，重启后重排）。
 * 桌面端 macOS / Windows 由本 crate 的 notify 模块实现（见 src/notify.rs）。
 * 权限状态、精确闹钟可用性由各后端回报，设置页据此提示用户去系统设置。 */

#[cfg(mobile)]
#[tauri::command]
async fn notify_permission(
    app: tauri::AppHandle,
    request: Option<bool>,
) -> Result<serde_json::Value, String> {
    let handle = app
        .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
        .0
        .clone();
    handle
        .run_mobile_plugin_async(
            "notifyPermission",
            serde_json::json!({ "request": request.unwrap_or(false) }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[cfg(mobile)]
#[tauri::command]
async fn notify_schedule(app: tauri::AppHandle, items: String) -> Result<serde_json::Value, String> {
    let handle = app
        .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
        .0
        .clone();
    handle
        .run_mobile_plugin_async("notifySchedule", serde_json::json!({ "items": items }))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(mobile)]
#[tauri::command]
async fn notify_cancel(app: tauri::AppHandle, ids: String) -> Result<serde_json::Value, String> {
    let handle = app
        .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
        .0
        .clone();
    handle
        .run_mobile_plugin_async("notifyCancel", serde_json::json!({ "ids": ids }))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(mobile)]
#[tauri::command]
async fn notify_pending(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let handle = app
        .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
        .0
        .clone();
    handle
        .run_mobile_plugin_async("notifyPending", serde_json::json!({}))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(mobile)]
#[tauri::command]
async fn notify_test(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let handle = app
        .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
        .0
        .clone();
    handle
        .run_mobile_plugin_async("notifyTest", serde_json::json!({}))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(mobile)]
#[tauri::command]
async fn notify_take_target(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let handle = app
        .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
        .0
        .clone();
    handle
        .run_mobile_plugin_async("notifyTakeTarget", serde_json::json!({}))
        .await
        .map_err(|e| e.to_string())
}

/* 桌面端（macOS / Windows）：暂以 not-implemented 占位，由 src/notify.rs 实现后替换。
 * 返回结构与其他未实现路径一致（ok:false + reason），前端据此在设置页显示「本平台暂不支持」。 */

/// 本机通知后端类型（前端据此决定是否启动调度链；macOS/Windows/Android 各不同）
#[cfg(mobile)]
#[tauri::command]
fn notify_backend() -> String {
    "android".into()
}

#[cfg(desktop)]
#[tauri::command]
fn notify_backend() -> String {
    notify::backend()
}

/// 小组件落地状态（桌面上放了几个 / 快照时间 / 各槽位标题）——诊断链路用
#[cfg(mobile)]
#[tauri::command]
async fn widget_status(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let handle = app
        .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
        .0
        .clone();
    handle
        .run_mobile_plugin_async("widgetStatus", serde_json::json!({}))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(desktop)]
#[tauri::command]
fn widget_status() -> serde_json::Value {
    // 桌面端明确不做小组件：如实回报而不是假装成功
    serde_json::json!({ "ok": false, "reason": "not-android" })
}

/// 桌面上每一块宿主机小组件的清单（id / provider / 占位宽高 / 是否已有内容）。
///
/// 内容按实例绑定，所以「桌面上有哪几块」必须先问原生——AppWidgetManager 才知道。
/// 这条命令曾经漏接（Kotlin 与 JS 都写好了，中间的 Rust 桥没补），后果是运行时拿不到实例、
/// 推不出去任何内容：桌面永远显示「点一下选择内容」，点开又让用户绑定，形成死循环。
/// 把系统栏 inset 垫成内容视图 padding（edge-to-edge 下的正确姿势；见插件里同名命令的注释）。
/// demo 版顶栏被状态栏压住就是因为生成工程的 MainActivity 没有这段处理——能力入库后与工程无关。
#[cfg(mobile)]
#[tauri::command]
async fn ui_apply_insets(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let handle = app
        .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
        .0
        .clone();
    handle
        .run_mobile_plugin_async("applyContentInsets", serde_json::json!({}))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(desktop)]
#[tauri::command]
fn ui_apply_insets() -> serde_json::Value {
    serde_json::json!({ "ok": false, "reason": "not-android" })
}

/* ── 手机端「保存图片到相册」──
 * 字节由前端交过来（base64）：屏幕上那张图的 src 多半是应用侧带会话抓回来的 dataURL，
 * 原生侧重现不了那条通道（详见 apps/desktop/src/lib/imageSave.ts 顶部说明）。
 * Rust 只把它落成应用缓存里的一个文件，再交 onethu-mobile 插件写进系统相册
 * （MediaStore.Images + Pictures/OneTHU，见插件 Kotlin 侧 saveImage）。
 * 桌面端没有相册概念，落到用户设置的「下载」目录——同一条命令在三端都不空转。 */

/// base64 → 字节。上限与前端 imageSave.ts 的 MAX_B64_LEN 同口径（16MB ≈ 12MB 原图）：
/// 字节以 base64 经 IPC 传过来，再大的图片会把 WebView 拖住，早拒比卡死好。
fn decode_image_base64(data: &str) -> Result<Vec<u8>, String> {
    use base64::Engine as _;
    const MAX_B64_LEN: usize = 16 * 1024 * 1024;
    if data.is_empty() {
        return Err("图片内容为空".into());
    }
    if data.len() > MAX_B64_LEN {
        return Err("图片过大，无法保存".into());
    }
    base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("图片内容解析失败：{e}"))
}

#[cfg(mobile)]
#[tauri::command]
async fn save_image_to_gallery(
    app: tauri::AppHandle,
    data: String,
    mime: String,
    name: String,
) -> Result<serde_json::Value, String> {
    use tauri::Manager;
    let bytes = decode_image_base64(&data)?;
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("无法定位缓存目录: {e}"))?
        .join("onethu-img");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(&name);
    std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    let handle = app
        .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
        .0
        .clone();
    handle
        .run_mobile_plugin_async(
            "saveImage",
            serde_json::json!({ "path": tmp.to_string_lossy(), "name": name, "mime": mime }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[cfg(desktop)]
#[tauri::command]
async fn save_image_to_gallery<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    data: String,
    mime: String,
    name: String,
) -> Result<serde_json::Value, String> {
    // 桌面端不区分「相册」：扩展名已由前端拼进 name，mime 只用于安卓侧建媒体条目
    let _ = mime;
    let bytes = decode_image_base64(&data)?;
    let dir = downloads::directory(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(&name);
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "name": name,
        "dir": path.parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
    }))
}

/// 一键把标准形态小组件放到桌面（requestPinAppWidget；ColorOS 等启动器选择器行为不一致
/// 时用户「绑定完桌面上没有」，这条由启动器直接落卡片）。
#[cfg(mobile)]
#[tauri::command]
async fn widget_pin(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let handle = app
        .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
        .0
        .clone();
    handle
        .run_mobile_plugin_async("widgetPin", serde_json::json!({}))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(desktop)]
#[tauri::command]
fn widget_pin() -> serde_json::Value {
    serde_json::json!({ "ok": false, "reason": "not-android", "supported": false })
}

#[cfg(mobile)]
#[tauri::command]
async fn widget_instances(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let handle = app
        .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
        .0
        .clone();
    handle
        .run_mobile_plugin_async("widgetInstances", serde_json::json!({}))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(desktop)]
#[tauri::command]
fn widget_instances() -> serde_json::Value {
    serde_json::json!({ "ok": false, "reason": "not-android", "instances": [] })
}

/* 立即投递与撤回已展示的通知（事件驱动：校园卡余额预警）。
 * 与 notify_schedule/notify_cancel 的分工：那两条是「将来某刻发 / 撤待投递」，
 * 这两条是「现在发 / 撤已弹出的那一条」。 */

#[cfg(mobile)]
#[tauri::command]
async fn notify_post(
    app: tauri::AppHandle,
    id: String,
    title: String,
    body: String,
    channel: Option<String>,
    target: Option<String>,
) -> Result<serde_json::Value, String> {
    let handle = app
        .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
        .0
        .clone();
    handle
        .run_mobile_plugin_async(
            "notifyPost",
            serde_json::json!({
                "id": id,
                "title": title,
                "body": body,
                "channel": channel.unwrap_or_default(),
                "target": target.unwrap_or_default(),
            }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[cfg(mobile)]
#[tauri::command]
async fn notify_dismiss(app: tauri::AppHandle, ids: String) -> Result<serde_json::Value, String> {
    let handle = app
        .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
        .0
        .clone();
    handle
        .run_mobile_plugin_async("notifyDismiss", serde_json::json!({ "ids": ids }))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(desktop)]
#[tauri::command]
fn notify_post(
    id: String,
    title: String,
    body: String,
    channel: Option<String>,
    target: Option<String>,
) -> serde_json::Value {
    notify::post(&id, &title, &body, &channel.unwrap_or_default(), &target.unwrap_or_default())
}

#[cfg(desktop)]
#[tauri::command]
fn notify_dismiss(ids: String) -> serde_json::Value {
    notify::dismiss(&ids)
}

/// 打开系统通知设置页（渠道管理 / 精确闹钟授权都在系统设置里，应用只能带路）
#[cfg(mobile)]
#[tauri::command]
async fn notify_open_settings(
    app: tauri::AppHandle,
    what: Option<String>,
    channel: Option<String>,
) -> Result<serde_json::Value, String> {
    let handle = app
        .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
        .0
        .clone();
    handle
        .run_mobile_plugin_async(
            "notifyOpenSettings",
            serde_json::json!({
                "what": what.unwrap_or_else(|| "channels".into()),
                "channel": channel.unwrap_or_default(),
            }),
        )
        .await
        .map_err(|e| e.to_string())
}

#[cfg(desktop)]
#[tauri::command]
fn notify_open_settings(what: Option<String>) -> serde_json::Value {
    notify::open_settings(&what.unwrap_or_else(|| "channels".into()))
}

/// 查询/请求通知授权。`request=false` 只查状态（首次打开设置页不该弹系统框），
/// 用户在设置页主动开启提醒或点「试一下」时才传 true。
#[cfg(desktop)]
#[tauri::command]
fn notify_permission(request: Option<bool>) -> serde_json::Value {
    notify::permission(request.unwrap_or(false))
}

#[cfg(desktop)]
#[tauri::command]
fn notify_schedule(items: String) -> serde_json::Value {
    notify::schedule(&items)
}

#[cfg(desktop)]
#[tauri::command]
fn notify_cancel(ids: String) -> serde_json::Value {
    notify::cancel(&ids)
}

#[cfg(desktop)]
#[tauri::command]
fn notify_pending() -> serde_json::Value {
    notify::pending()
}

#[cfg(desktop)]
#[tauri::command]
fn notify_test() -> serde_json::Value {
    notify::test()
}

#[cfg(desktop)]
#[tauri::command]
fn notify_take_target() -> serde_json::Value {
    notify::take_target()
}

/* R20-A：外部作业「桌面模式」内嵌浏览（救急）。移动端点击外部作业详情链接时
 * 不丢给系统浏览器，改走 onethu-mobile 插件（Kotlin openWebModal）的全屏 Dialog
 * WebView：桌面 UA + useWideViewPort/概览模式 + 可缩放，只读浏览（不注入脚本、
 * 不回读 Cookie），底部固定「在系统浏览器打开」兜底与「关闭」，关闭才 destroy。
 * 与 R18 雨课堂登录通道（openYktWebLogin / readYktCookies）各自独立，互不影响。 */

#[cfg(desktop)]
#[tauri::command]
fn open_web_modal(url: String) -> Result<(), String> {
    // 桌面端无内嵌 WebView 模态（保持 openExternal 现状）：前端只在 Android 宿主
    // 调本命令；真被调到（宿主误判等）就报错，由前端降级回系统浏览器。
    let _ = url;
    Err("桌面端无内嵌浏览窗口，请使用系统浏览器".into())
}

/// 打开系统「应用详情」（权限被永久拒绝后的唯一出路；仅 Android 有实现）
#[cfg(mobile)]
#[tauri::command]
async fn open_app_settings(app: tauri::AppHandle) -> Result<(), String> {
    let handle = app
        .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
        .0
        .clone();
    let _: serde_json::Value = handle
        .run_mobile_plugin_async("openAppSettings", serde_json::json!({}))
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
async fn open_app_settings() -> Result<(), String> {
    Err("桌面端请在「系统设置 → 隐私与安全性」里授权".into())
}

#[cfg(mobile)]
#[tauri::command]
async fn open_web_modal(app: tauri::AppHandle, url: String, dark: Option<bool>) -> Result<(), String> {
    // scheme 白名单：非 http(s) 一律拒绝（Kotlin 侧再兜底一次）
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(format!("拒绝在应用内 WebView 打开非 http(s) 链接: {url}"));
    }
    let handle = app
        .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
        .0
        .clone();
    // 用户关闭（按钮 / 返回键）才 resolve，Dialog 生命周期即本次浏览；
    // async 版本等待，不阻塞工作线程（与 open_ykt_window 同款写法）。
    let _: serde_json::Value = handle
        .run_mobile_plugin_async(
            "openWebModal",
            // dark：应用当前是否深色主题 → Kotlin 侧开「算法暗化」，让官方页（THUbook/
            // 在线服务）自带的黑字在深色下变白（2026-09-20 用户实录：字看不见）
            serde_json::json!({ "url": url, "dark": dark.unwrap_or(false) }),
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/* R20-C1：雨课堂官方作答页「应用内 WebView」通道（写操作，但只打开官方页——
 * 提交仍由官方页自身逻辑完成，不替代、不绕过其确认/拦截）。
 * 与 R20-A 只读浏览（open_web_modal）分开：本命令额外**注入当前会话 Cookie**
 * （桌面走 wry set_cookie，移动走 Kotlin CookieManager），URL 用 R16b 学生端直链。
 * Cookie 只在 invoke 参数 / 内存中传递，绝不打印、不落盘、不进 log_debug。
 * 关闭/返回后 emit "ykt-submit-closed"，前端据此重新拉真实状态（禁止乐观更新）。 */

#[cfg(desktop)]
#[tauri::command]
async fn open_ykt_submit_window(app: tauri::AppHandle, url: String, cookie: String) -> Result<(), String> {
    use tauri::webview::{Cookie, WebviewWindowBuilder};
    use tauri::WebviewUrl;
    // scheme 白名单：非 http(s) 一律拒绝
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("拒绝在应用内 WebView 打开非 http(s) 链接".into());
    }
    let label = "yktsubmit";
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.close();
    }
    // 先建在雨课堂源根（同域），注入会话 Cookie 后再导航到官方作答页——避免首跳
    // 无 Cookie 被弹登录。窗口独立于主窗口 / 登录窗口，互不影响。
    let win = WebviewWindowBuilder::new(
        &app,
        label,
        WebviewUrl::External("https://pro.yuketang.cn/".parse().unwrap()),
    )
    .title("雨课堂 · 作答 / 提交")
    .inner_size(1024.0, 780.0)
    .build()
    .map_err(|e| e.to_string())?;
    // 逐条注入：`name=value; …` → Cookie(Domain=.yuketang.cn, Path=/)。解析失败的条目
    // 静默跳过（官方页会自行要求重新登录），绝不把 Cookie 值写进任何日志。
    for pair in cookie.split(';') {
        let pair = pair.trim();
        if pair.is_empty() || !pair.contains('=') {
            continue;
        }
        if let Ok(c) = Cookie::parse(format!("{pair}; Domain=.yuketang.cn; Path=/")) {
            let _ = win.set_cookie(c);
        }
    }
    let _ = win.set_focus();
    let target = match url.parse() {
        Ok(u) => u,
        Err(e) => {
            let _ = win.close();
            return Err(format!("官方作答页地址非法: {e}"));
        }
    };
    if let Err(e) = win.navigate(target) {
        let _ = win.close();
        return Err(e.to_string());
    }
    // 后台轮询窗口存在性：用户关闭 → emit 一次（前端据此重拉详情，不乐观更新）。
    let app2 = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(700));
        if app2.get_webview_window(label).is_none() {
            use tauri::Emitter;
            let _ = app2.emit("ykt-submit-closed", ());
            return;
        }
    });
    Ok(())
}

#[cfg(mobile)]
#[tauri::command]
async fn open_ykt_submit_window(app: tauri::AppHandle, url: String, cookie: String) -> Result<(), String> {
    // scheme 白名单：非 http(s) 一律拒绝（Kotlin 侧再兜底一次）
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(format!("拒绝在应用内 WebView 打开非 http(s) 链接: {url}"));
    }
    let handle = app
        .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
        .0
        .clone();
    // 移动端 Kotlin 全屏 Dialog WebView：Cookie 走 CookieManager 注入，关闭才 resolve。
    // async 版本等待，不阻塞工作线程（与 open_web_modal 同款写法）。
    let _: serde_json::Value = handle
        .run_mobile_plugin_async("openWebModal", serde_json::json!({ "url": url, "cookie": cookie }))
        .await
        .map_err(|e| e.to_string())?;
    use tauri::Emitter;
    let _ = app.emit("ykt-submit-closed", ());
    Ok(())
}

/* 体育官方预约已改为主窗口 tab 内 iframe（URL ?token= 携带 JWT，官方 SPA
 * 开机即认的 SSO 载体），不再需要独立弹窗命令——独立窗注入 localStorage.headers
 * 对官方 SPA 无效（它开机只读 URL 参数），已删除。 */

/* ---------------- 体育官方页本地反代（venueview://） ----------------
 * 官方站响应带 x-frame-options: SAMEORIGIN，iframe 直嵌 https 会被拦成白屏
 * （实测）。本协议做透明管道：venueview://localhost/<path><query> →
 * https://www.sports.tsinghua.edu.cn<path><query>，原样转交官方页自己发出的
 * 全部请求（预约点击仍是用户在官方页面上手动完成），响应剥掉 XFO/CSP 等
 * 阻止内嵌的头。仅限该一个主机，不作任意代理原语。第 12 条红线不变。 */
const VENUE_ORIGIN: &str = "https://www.sports.tsinghua.edu.cn";

/// venueview 反代留痕（与 log_debug 同文件，便于一次点击全链路取证）
fn venue_log(msg: &str) {
    debug_log_line(&format!("{} | [VENUEVIEW] {}", chrono_now(), msg));
}

/// 场馆内嵌页 SSO token（前端开 iframe 前推给 Rust；反代对每个 HTML 文档
/// 注入——自定义协议源的 localStorage 不可靠（实测写入不保活），改为每个
/// 文档开机前都重写登录态，页面无论怎么自跳转都有登录态）。
pub type VenueSsoState = std::sync::Mutex<Option<String>>;

#[tauri::command]
fn venue_sso_set(
    state: tauri::State<'_, VenueSsoState>,
    token: String,
) -> Result<(), String> {
    *state.lock().map_err(|e| e.to_string())? = Some(token);
    Ok(())
}

/* ---------------- 体育官方预约页：应用内「共享登录态」窗口 ----------------
 * 用户拍板（2026-09-20）：照在线服务的经验办——**复用凭据**：手机端全屏 WebView、
 * 电脑端独立窗口，两边都带同一登录态，不再把用户丢去系统浏览器重登一遍。
 * 官方 SPA（hash 路由）开机读 localStorage["token"] / ["headers"]（venue.ts 实录：
 * getParams→storage.getItem，?token= 启动逻辑并不解析），因此注入必须在**页面脚本
 * 之前**：桌面走 initialization_script（每次导航都先跑），Android 走 Kotlin 注入。
 * 注入的 JWT 只在 invoke 参数与内存中传递，绝不打印、不落盘。
 * 预约动作仍由用户在官方页面上手动完成（体育部公告第 12 条红线不变）。 */

/// 把体育 JWT 写进当前 origin 的 localStorage（与 Kotlin 侧 VENUE_SEED_JS 同语义）
fn venue_seed_js(token: &str) -> String {
    let t = serde_json::to_string(token).unwrap_or_else(|_| "\"\"".to_string());
    format!(
        r#"(function(){{try{{var t={t};localStorage.setItem("token",JSON.stringify(t));localStorage.setItem("headers",JSON.stringify(JSON.stringify({{token:t}})));localStorage.setItem("refreshToken",JSON.stringify(""));}}catch(e){{}}}})();"#
    )
}

/// 桌面端：独立子窗口 + 页面脚本前注入登录态（同 UA——官方系统按客户端指纹管会话）
#[cfg(desktop)]
async fn venue_open_portal_impl(
    app: &tauri::AppHandle,
    token: &str,
    url: &str,
    dark: bool,
) -> Result<(), String> {
    use tauri::webview::Cookie;
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    let label = "venueportal";
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.close();
    }
    let main_ua = app
        .config()
        .app
        .windows
        .first()
        .and_then(|w| w.user_agent.clone());
    // 顺带把原生 jar 里 sports 域的票种进去（官方页若用 Cookie 走 SSO，这里就一并共享）
    let pairs: Vec<String> = {
        let jar = NATIVE_JAR_ARC.0.read().unwrap();
        match format!("{VENUE_ORIGIN}/").parse() {
            Ok(u) => jar
                .matches(&u)
                .iter()
                .map(|c| format!("{}={}", c.name(), c.value()))
                .collect(),
            Err(_) => Vec::new(),
        }
    };
    // 先建在体育系统源根（同 origin），注入脚本与 Cookie 都落在同一个域上
    let mut builder = WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::External(format!("{VENUE_ORIGIN}/venue/index.html").parse().unwrap()),
    )
    .title("场馆预约 · OneTHU")
    .inner_size(1100.0, 820.0)
    .initialization_script(venue_seed_js(token));
    if let Some(ua) = main_ua.as_deref() {
        builder = builder.user_agent(ua);
    }
    if dark {
        builder = builder.initialization_script(DARK_PAINT_JS);
    }
    let win = builder.build().map_err(|e| e.to_string())?;
    let mut seeded = 0usize;
    for pair in &pairs {
        if let Ok(c) = Cookie::parse(format!("{pair}; Domain=www.sports.tsinghua.edu.cn; Path=/")) {
            if win.set_cookie(c).is_ok() {
                seeded += 1;
            }
        }
    }
    venue_log(&format!(
        "[VENUE-PORTAL] 独立窗口：注入登录态（{} 字节）+ {seeded} 条 Cookie，UA={}",
        token.len(),
        if main_ua.is_some() { "同主窗口" } else { "默认" }
    ));
    win.navigate(url.parse().map_err(|e| format!("目标 URL 解析失败: {e}"))?)
        .map_err(|e| e.to_string())?;
    let _ = win.set_focus();
    Ok(())
}

/// Android：全屏 Dialog WebView + Kotlin 侧注入同一份登录态脚本
#[cfg(mobile)]
async fn venue_open_portal_impl(
    app: &tauri::AppHandle,
    token: &str,
    url: &str,
    dark: bool,
) -> Result<(), String> {
    let handle = app
        .state::<tauri_plugin_onethu_mobile::OnethuMobile<tauri::Wry>>()
        .0
        .clone();
    // R21 用户实录：移动 UA 下体育部系统会把桌面路由（/venue/index.html#/reserveList）
    // 302 到「移动版已登录首页」——桌面路由在移动端不存在。移动 WebView 一律重写到
    // 移动 SPA 的同义直达路由（uuid 参数同名），配合移动 UA 出正常移动版布局。
    let url = if url.contains("/venue/index.html") {
        let rewritten = url
            .replace("/venue/index.html", "/venue/mobile/index.html")
            .replace("#/reserveList?", "#/pagesReserve/reserveDetail/newIndex?");
        venue_log(&format!("[VENUE-PORTAL] 移动端路由重写 → {}", &rewritten[..rewritten.len().min(80)]));
        rewritten
    } else {
        url.to_string()
    };
    venue_log(&format!(
        "[VENUE-PORTAL] 移动端全屏浏览：注入登录态（{} 字节）→ {}",
        token.len(),
        &url[..url.len().min(60)]
    ));
    let opened: Result<serde_json::Value, _> = handle
        .run_mobile_plugin_async(
            "openWebModal",
            serde_json::json!({
                "url": url,
                "dark": dark,
                "injectJs": venue_seed_js(token),
            }),
        )
        .await;
    if let Err(e) = &opened {
        venue_log(&format!("[VENUE-PORTAL] 应用内浏览窗口打开失败：{e}"));
    }
    opened.map_err(|e| format!("应用内浏览窗口打开失败：{e}"))?;
    Ok(())
}

/// 体育官方预约页：应用内打开（桌面独立窗口 / Android 全屏 WebView），共享同一登录态。
#[tauri::command]
async fn venue_open_portal(
    app: tauri::AppHandle,
    token: String,
    url: String,
    dark: Option<bool>,
) -> Result<(), String> {
    if token.len() < 20 {
        return Err("体育系统登录态缺失：请先完成登录".into());
    }
    if !url.starts_with(VENUE_ORIGIN) {
        return Err("拒绝在应用内打开非体育系统链接".into());
    }
    venue_open_portal_impl(&app, &token, &url, dark.unwrap_or(false)).await
}

fn chrono_now() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
        .to_string()
}

async fn venue_proxy_fetch(
    sso: Option<String>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::header::CONTENT_TYPE;
    let upstream_err = |msg: String| {
        tauri::http::Response::builder()
            .status(502)
            .header(CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(msg.into_bytes())
            .unwrap_or_else(|_| tauri::http::Response::new(b"venue proxy error".to_vec()))
    };
    let pq = request
        .uri()
        .path_and_query()
        .map(|x| x.as_str().to_string())
        .unwrap_or_else(|| "/".into());
    let auth_len = request
        .headers()
        .get("authorization")
        .or_else(|| request.headers().get("token"))
        .map(|v| v.len())
        .unwrap_or(0);
    venue_log(&format!(
        "REQ {} {} auth={}",
        request.method(),
        pq.split('&').next().unwrap_or(""),
        auth_len
    ));
    // 页面请求 query 里的 ?token=<JWT>：官方 SPA 开机从 localStorage["token"]
    // 读登录态（getParams→storage.getItem；?token= 本身并不被启动逻辑解析）。
    // 注入源优先取 Rust 状态（venue_sso_set，前端开 iframe 前推送），兼容 query。
    let sso_token: Option<String> = sso.or_else(|| {
        request.uri().query().and_then(|q| {
            q.split('&').find_map(|kv| {
                let (k, v) = kv.split_once('=')?;
                (k == "token" && v.len() > 20).then(|| v.to_string())
            })
        })
    });
    let url = format!("{VENUE_ORIGIN}{pq}");
    let method = request.method().clone();
    let client = match reqwest::Client::builder()
        // 主网络通道同 http_request：清华域直连，禁系统代理（#1 风控实录）
        .no_proxy()
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(Duration::from_secs(30))
        .build()
    {
        Ok(c) => c,
        Err(e) => return upstream_err(format!("proxy client: {e}")),
    };
    let mut req = client
        .request(method, &url)
        .header("origin", VENUE_ORIGIN)
        .header("referer", format!("{VENUE_ORIGIN}/venue/index.html"));
    for (k, v) in request.headers() {
        let lower = k.as_str().to_lowercase();
        if matches!(
            lower.as_str(),
            "content-type" | "accept" | "accept-language" | "cookie" | "user-agent"
        ) {
            if let Ok(vs) = v.to_str() {
                req = req.header(k.clone(), vs);
            }
        }
    }
    let body = request.into_body();
    if !body.is_empty() {
        req = req.body(body);
    }
    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            venue_log(&format!("ERR upstream {e} {pq}"));
            return upstream_err(format!("upstream: {e}"));
        }
    };
    let status = resp.status();
    let ct = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "application/octet-stream".into());
    match resp.bytes().await {
        Ok(b) => {
            let mut body = b.to_vec();
            // HTML 文档 + 带 SSO token：在 <head> 后注入 localStorage 预置脚本
            // （严格镜像官方 SET_TOKEN 的存储格式：token 存 JSON 字符串、
            // headers 存「字符串化的 JSON 对象」再整体 JSON 字符串化）
            let mut injected = false;
            if ct.starts_with("text/html") {
                // 剥离页面内 CSP meta（若官方模板自带，会拦掉我们的内联预置脚本）
                if let Some(rel) = body.windows(9).position(|w| w.eq_ignore_ascii_case(b"http-equiv")) {
                    let start = body[..rel].iter().rposition(|&b| b == b'<').unwrap_or(0);
                    let end = body[rel..]
                        .iter()
                        .position(|&b| b == b'>')
                        .map(|p| rel + p + 1)
                        .unwrap_or(body.len());
                    let tag = String::from_utf8_lossy(&body[start..end]).to_lowercase();
                    if tag.contains("content-security-policy") {
                        body.copy_within(end.., start);
                        body.truncate(body.len() - (end - start));
                        venue_log("STRIP csp meta");
                    }
                }
                if let Some(jwt) = &sso_token {
                    // 预置登录态（token + refreshToken 空值兜底）+ 读写监听探针：
                    // hook getItem("token")/removeItem/clear，回执经 __rd/__clr/__rm
                    // 图片请求进日志——谁读、读到多长、谁删，全部留痕。
                    let script = format!(
                        r#"<script>(function(){{var t="{jwt}";var ok=0,err="";try{{localStorage.setItem("token",JSON.stringify(t));localStorage.setItem("headers",JSON.stringify(JSON.stringify({{token:t}})));localStorage.setItem("refreshToken",JSON.stringify(""));ok=localStorage.getItem("token")===JSON.stringify(t)?1:0;}}catch(e){{err=String(e);}}try{{new Image().src="/venue/index.html?__probe=1&ok="+ok+"&err="+encodeURIComponent(err)+"&ts="+Date.now();}}catch(e){{}}try{{var og=Storage.prototype.getItem;Storage.prototype.getItem=function(k){{var v=og.call(this,k);if(k==="token"){{try{{new Image().src="/venue/index.html?__rd=1&len="+(v?v.length:0)+"&ts="+Date.now();}}catch(e){{}}}}return v;}};var oc=Storage.prototype.clear;Storage.prototype.clear=function(){{try{{new Image().src="/venue/index.html?__clr=1&ts="+Date.now();}}catch(e){{}}return oc.call(this);}};var orm=Storage.prototype.removeItem;Storage.prototype.removeItem=function(k){{if(k==="token"){{try{{new Image().src="/venue/index.html?__rm=1&ts="+Date.now();}}catch(e){{}}}}return orm.call(this,k);}};}}catch(e){{}}}})();</script>"#
                    );
                    let bytes = script.as_bytes();
                    let head_pos = body
                        .windows(6)
                        .position(|w| w.eq_ignore_ascii_case(b"<head>"))
                        .map(|p| p + 6)
                        .unwrap_or(0);
                    let mut out = Vec::with_capacity(body.len() + bytes.len());
                    out.extend_from_slice(&body[..head_pos]);
                    out.extend_from_slice(bytes);
                    out.extend_from_slice(&body[head_pos..]);
                    body = out;
                    injected = true;
                }
            }
            venue_log(&format!(
                "RSP {} {} ct={} len={} inject={} tok={}",
                status,
                pq.split('&').next().unwrap_or(""),
                ct,
                body.len(),
                injected,
                sso_token.is_some()
            ));
            // 小 JSON 体直接记内容（未登录/错误判词一眼可见）
            if ct.starts_with("application/json") && body.len() <= 400 {
                venue_log(&format!(
                    "BODY {}",
                    String::from_utf8_lossy(&body).replace('\n', " ")
                ));
            }
            tauri::http::Response::builder()
                .status(status)
                .header(CONTENT_TYPE, ct)
                .header("access-control-allow-origin", "*")
                .body(body)
                .unwrap_or_else(|_| tauri::http::Response::new(b"venue proxy error".to_vec()))
        }
        Err(e) => upstream_err(format!("upstream body: {e}")),
    }
}

#[cfg(mobile)]
#[tauri::command]
fn open_sports_window(_: tauri::AppHandle) -> Result<String, String> {
    Err("场馆登录多窗口仅桌面端可用".into())
}

tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_geolocation::init())
        .plugin(tauri_plugin_onethu_mobile::init())
        .plugin(tauri_plugin_onethu_calendar::init())
        .plugin(tauri_plugin_onethu_speech::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(std::sync::Mutex::new(None::<String>) as VenueSsoState)
        .manage(plugins::PluginHost::default())
        .manage(harness_embed::HarnessHost::default())
        .register_asynchronous_uri_scheme_protocol("venueview", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                let sso = app
                    .state::<VenueSsoState>()
                    .lock()
                    .ok()
                    .and_then(|g| g.clone());
                responder.respond(venue_proxy_fetch(sso, request).await);
            });
        })
        .setup(|app| {
            let _ = LOG_APP.set(app.handle().clone());
            // R21 网络诊断：解析结果落日志（v4/v6 混合与否是「校内每请求 5s」的
            // 关键证据——IPv6 先超时再回落 v4 的连接 stall 每条新连接付一次）
            {
                let app2 = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    match tokio::net::lookup_host("webvpn.tsinghua.edu.cn:443").await {
                        Ok(addrs) => {
                            let list = addrs.map(|a| a.to_string()).collect::<Vec<_>>().join(", ");
                            crate::debug_log_line(&format!("[NET-RESOLVE] webvpn.tsinghua.edu.cn → {list}"));
                        }
                        Err(e) => crate::debug_log_line(&format!("[NET-RESOLVE] webvpn 解析失败: {e}")),
                    }
                });
            }
            // R21 dev 构建守卫（用户实录：有 Windows 同学拿到的是 dev/手动 cargo 构建，
            // 双击打开就是 127.0.0.1:5180 拒绝连接——`is_dev()` 构建里资产不打进程序，
            // devUrl 编译期烤死，WebView 一定去连它；vite 没跑就是浏览器错误页）。
            // 与 0.7.2 安卓事故同根：判据只能是构建方式，不能用 strings 找端点串。
            // 有了这个对话框，拿到错误构建的用户第一眼就知道该去装正式版。
            if tauri::is_dev() {
                let dev_up = std::net::TcpStream::connect_timeout(
                    &"127.0.0.1:5180".parse().expect("static addr"),
                    std::time::Duration::from_millis(800),
                )
                .is_ok();
                if !dev_up {
                    eprintln!("[ONETHU] dev build but dev server 127.0.0.1:5180 unreachable");
                    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
                    app.dialog()
                        .message("这是开发版构建，界面资源没有打进程序（需要先启动开发服务器）。日常使用请安装正式版：从发布页下载安装包，或联系分发者要 tauri build 的产物。")
                        .title("OneTHU 开发版")
                        .kind(MessageDialogKind::Warning)
                        .blocking_show();
                    app.handle().exit(1);
                    return Ok(());
                }
            }
            // 桌面端通知：macOS 尽早装 delegate 并读回落点表——用户可能正是
            // 「点通知把应用冷启动」的那条路径，晚一步这次点击的落点就丢了。
            #[cfg(desktop)]
            notify::init();
            // cookie 仓持久化：启动回种 + 30s 周期落盘（dirty 才写）
            {
                let handle = app.handle().clone();
                let path = jar_store_path(&handle);
                NATIVE_JAR_ARC.load_from_file(&path);
                tauri::async_runtime::spawn(async move {
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                        NATIVE_JAR_ARC.save_if_dirty(&path);
                    }
                });
            }
            #[cfg(debug_assertions)]
            {
                use tauri::LogicalPosition;
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.set_position(LogicalPosition::new(80.0, 60.0));
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            http_native_clear_cookies,
            http_native_clear_cookies_domain,
            thos_open_portal,
            http_native_seed,
            downloads::download_directory_get,downloads::download_directory_pick,downloads::download_directory_reset,save_file_as,
            log_debug,debug_log_export,read_file_text,trace_key,macos_location,speech_supported,speech_start,speech_poll,speech_stop,mail::mail_list,mail::mail_read,mail::mail_mark_seen,mail::mail_send,mail::mail_search,seafile::seafile_account,seafile::seafile_repos,seafile::seafile_dir,seafile::seafile_download,seafile::seafile_upload,seafile::seafile_mkdir,seafile::seafile_share,seafile::seafile_search,seafile::seafile_pick_upload,http_request,http_native,download_file,fetch_binary,save_text_file,plugin_dir_install_rust,builtin_sidecar_install,plugin_dir_import_zip,plugin_logo_data,os_is_android,plugin_dir_remove,state_read,state_write,state_delete,
            open_external,onethu_open_path,onethu_reveal_path,open_eid_window,open_ykt_window,read_ykt_cookies,close_ykt_window,start_qr_keep_alive,stop_qr_keep_alive,widget_push,widget_clear,widget_take_target,widget_status,widget_instances,widget_pin,ui_apply_insets,save_image_to_gallery,notify_backend,notify_open_settings,notify_permission,notify_schedule,notify_cancel,notify_pending,notify_test,notify_take_target,notify_post,notify_dismiss,open_web_modal,open_app_settings,open_ykt_submit_window,open_sports_window,venue_sso_set,venue_open_portal,
            plugins::plugin_spawn,plugins::plugin_call,plugins::plugin_notify,plugins::plugin_rpc_reply,plugins::plugin_kill,
            harness_embed::harness_start,harness_embed::harness_bridge_take,harness_embed::harness_call,harness_embed::harness_notify,harness_embed::harness_rpc_reply,harness_embed::harness_stop])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


/// 探针钩子：只在 `notify-probe` feature 下暴露 macOS 通知原生链路，
/// 供 src/bin/notify_probe.rs 在 .app 包内实测（默认构建不含此模块）。
#[cfg(all(feature = "notify-probe", target_os = "macos"))]
pub mod notify_probe_hooks {
    pub fn status(request: bool) -> Result<bool, String> {
        crate::notify_macos::status(request)
    }
    pub fn add(id: &str, at: i64, title: &str, body: &str, target: &str) -> Result<(), String> {
        crate::notify_macos::add(id, at, title, body, target)
    }
    pub fn pending_ids() -> Result<Vec<String>, String> {
        crate::notify_macos::pending_ids()
    }
    pub fn cancel(ids: &[String]) {
        crate::notify_macos::cancel(ids)
    }
}
