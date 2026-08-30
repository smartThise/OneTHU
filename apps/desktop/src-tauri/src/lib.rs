//! OneTHU 桌面壳 —— 网络层走 Rust（reqwest），前端零 CORS 限制。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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

#[derive(Serialize)]
struct HttpOutput {
    status: u16,
    status_text: String,
    /// 除 Set-Cookie 外的响应头（小写键）
    headers: HashMap<String, String>,
    /// Set-Cookie 单独回传（多值，顺序保留）
    set_cookies: Vec<String>,
    /// 最终 URL（跟随内部无重定向，此处即请求 URL）
    url: String,
    body: String,
    /// 二进制响应体（UTF-8 非法时走此通道，body 为空字符串）——验证码图/发票 PDF
    /// 等二进制资源经字符串通道会被 lossy 解码损坏（0x89→U+FFFD 实证）
    body_b64: Option<String>,
}

/// 单次 HTTP 请求：不跟随重定向（由前端带着最新 Cookie 逐跳处理），
/// 显式透传请求头（含 Cookie —— 浏览器 fetch 的禁改头，这里无此限制）。
#[tauri::command]
fn log_debug(line: String) -> Result<(), String> {
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/onethu-debug.log")
        .map_err(|e| e.to_string())?;
    let _ = writeln!(f, "{}", line);
    Ok(())
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

/// 兜底外链打开：Rust 侧再校验一次 scheme，仅放行 http/https
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(format!("拒绝打开非 http(s) 链接: {url}"));
    }
    spawn_system_open(&url)
}

/* ---------------- 本机状态文件（appData/state 下的 JSON 文件） ----------------
 * WKWebView 的 localStorage 会被系统驱逐/清空（会话状态时有时无的根源），
 * 会话快照与「记住密码」一律镜像到应用数据目录的普通文件，启动时优先
 * localStorage、缺失则从文件回灌。 */

fn state_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
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
fn state_write(app: tauri::AppHandle, name: String, content: String) -> Result<(), String> {
    let path = state_dir(&app)?.join(format!("{}.json", safe_name(&name)));
    // 原子写：临时文件 + rename，强退/断电不留半截 JSON
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, content.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn state_read(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    let path = state_dir(&app)?.join(format!("{}.json", safe_name(&name)));
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn state_delete(app: tauri::AppHandle, name: String) -> Result<(), String> {
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

/// 带会话 Cookie 下载文件到 ~/Downloads（learn 直连；登录失效/空文件识别拒绝）。
/// 落盘名：响应 Content-Disposition 真名优先，其次调用方传入名（title.fileType）。
#[tauri::command]
async fn download_file(url: String, cookies: String, filename: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&url)
        .header("Cookie", cookies)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let content_disposition = resp
        .headers()
        .get(reqwest::header::CONTENT_DISPOSITION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.is_empty() {
        return Err("下载失败：文件内容为空（mobile 同款 bytesWritten==0 校验）".into());
    }
    // 登录失效/会话重定向中转页：状态码 200 但内容是 HTML 跳转页
    // （mobile fs.downloadFile：bytesWritten<100 且含 location.href → 失败）
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]);
    let head = head.trim_start_matches('\u{feff}').trim_start();
    let looks_html = head.starts_with("<!DOCTYPE") || head.starts_with("<!doctype") || head.starts_with("<html");
    let login_redirect = bytes.len() < 4096 && head.contains("location.href");
    if looks_html || login_redirect {
        return Err("会话已失效，需要重新登录".into());
    }
    // 落盘名：Content-Disposition 真名优先（服务器知道真实文件名），
    // 其次调用方名；服务端真名通常自带扩展名，不重复追加
    let name = content_disposition
        .as_deref()
        .and_then(parse_cd_filename)
        .filter(|n| !n.trim().is_empty())
        .unwrap_or(filename);
    let home = std::env::var("HOME").map_err(|_| "无法定位主目录")?;
    let dir = std::path::Path::new(&home).join("Downloads");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe_name: String = name
        .chars()
        .map(|c| if c == '/' || c == ':' { '_' } else { c })
        .collect();
    let path = dir.join(&safe_name);
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
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
async fn fetch_binary(url: String, cookies: String) -> Result<BinaryOut, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&url)
        .header("Cookie", cookies)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
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
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
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

#[tauri::command]
async fn http_request(input: HttpInput) -> Result<HttpOutput, String> {
    let method: reqwest::Method = input
        .method
        .to_uppercase()
        .parse()
        .map_err(|e| format!("非法 HTTP 方法: {e}"))?;

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
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

    let resp = req.send().await.map_err(|e| format!("网络错误: {e}"))?;
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
    let body_bytes = resp.bytes().await.map_err(|e| format!("读取响应失败: {e}"))?;
    let (body, body_b64) = match std::str::from_utf8(&body_bytes) {
        Ok(text) => (text.to_string(), None),
        Err(_) => {
            use base64::Engine as _;
            (String::new(), Some(base64::engine::general_purpose::STANDARD.encode(&body_bytes)))
        }
    };

    Ok(HttpOutput {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers,
        set_cookies,
        url: input.url,
        body,
        body_b64,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
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
            log_debug,http_request,download_file,fetch_binary,state_read,state_write,state_delete,
            open_external])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
